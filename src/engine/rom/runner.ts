/**
 * The range of motion runner (product v7 contract 2.6, stream B, step B1): one movement on one side,
 * from the start pose to the result. Pure, no DOM. Generalised from the v1 arm raise
 * (src/engine/modes/rangeTest.ts RangeTestRunner, which stays the v1 test and this runner's parity
 * oracle for shoulder_abduction) with its building blocks (SubjectTracker, CalibrationRounds,
 * RunningMedian, QualityMonitor, OneEuro, RANGE_RULES).
 *
 * rom-protocol 1.1, one measured attempt, step by step:
 *   1. «calibration: the start pose held still for 1 s (start angle, segment pixel lengths, trunk line,
 *      neutral head)»: the movement's calibrationSeconds when it writes one; v1's stillness band
 *      (RANGE_RULES.calibrationStillDeg) on v1's running median, widened by CalibrationRounds (O35);
 *      the arm raises start with the arm by the side (v1's relaxed angle, RANGE_RULES.relaxedMaxDeg).
 *   2. «One practice movement (not stored), then up to 3 scored attempts, 5 to 10 s apart»
 *      (engine.practice, engine.scoredAttemptsMax, restSec default engine.restBetweenAttemptsSeconds.min).
 *   3. «A live dial shows the angle (One Euro filtered)»: a `live` event every frame with an angle, the
 *      movement angle of the subject's landmarks after the existing One Euro filter (PoseSmoother, with the
 *      defaults it was tuned with for landmark coordinates). The hold, the plateau, the first movement and
 *      the compensation windows read that angle after v1's 0.3 s running median (RANGE_RULES.medianSec,
 *      rangeTest.ts measures through it before its hold rule): at 2 to 3 m in a portrait picture a still
 *      arm's angle jitters about 3 degrees frame to frame, more than the 3 degree band (change log B1-3).
 *   4. The hold (hold.ts): the `hold` event, phase ask_max, the local line ask_max.
 *   5. «هل هذا أقصى ما تستطيع؟»: answerMax (buttons or the coach, first answer per hold wins). Yes
 *      records the hold; not yet resumes the attempt («A later hold replaces the value only if it is
 *      further»); it hurts records the value as pain limited and asks the pain question (answerPain);
 *      «No answer within 10 s: the hold is recorded as unconfirmed» (engine.answerTimeoutSeconds).
 *   6. «ما الذي أوقفك أكثر؟» once per movement (answerCause), when the confirmed value is short of
 *      askCauseBelow (the controller passes null to switch it off).
 *   7. Compensation checks (compensations.ts): «A cue plays at most once per attempt; an invalid attempt
 *      is coached, not stored, and repeated (up to 2 extra), then not measured today (quality) as in v1.1.»
 *   8. «No hold within 20 s of the first movement: the attempt ends as no_hold and is repeated»
 *      (engine.attemptTimeoutSeconds; before any movement, 20 s from the attempt's start).
 *   9. «The movement result: best valid attempt, the median of valid attempts, the number valid, all
 *      attempts, and inconsistent when valid attempts spread more than E + 5 degrees.»
 * The quality gate (QualityMonitor with romQualityConfig) runs over each attempt up to its hold; a
 * failed gate repeats the attempt within the same 2 extra (v1.1 4.1). The pain rule is the one shared
 * rule (painStopRule, C-15).
 *
 * Engineering readings (each documented where it is used; none adds a clinical number):
 *   - Repeated attempts are not stored: `attempts` holds the scored attempts that counted (valid), each
 *     index once; a repeat is an `attempt` event with outcome invalid (a compensation) or retry (the
 *     quality gate or no hold), counted in `retries` (the budget, at most 2) and quality.retries (all).
 *     As v1 (SPEC-GAP retry-budget), once the budget is used the movement is not measured today, even
 *     with valid attempts kept for the record.
 *   - The practice is never repeated (v1): it ends at its hold, or at the timeout without one.
 *   - Two tries ending without a hold (the practice counts) switch to engine.wideHoldBandDeg, and a hold
 *     found with it carries wideHold.
 *   - A pause stops the clock; a resumed attempt starts again (same index, nothing stored), a resumed
 *     question asks again.
 *   - A pain stop keeps the hold in hand (asked, answered «it hurts», or kept after «not yet») as a pain
 *     limited attempt when the attempt passed its checks, and the movement stops with reason pain_stop.
 *   - A stop by the person (stop "user_stop", or finish before the end) keeps no value: status stopped,
 *     reason by_choice until the controller writes the stop list's reason (v1 resultOnStop).
 */
import { PoseSmoother } from "../oneEuro";
import { toPixelSpace } from "../geometry";
import { QualityMonitor, type QualityIssue, type QualityReport } from "../quality";
import { SubjectLock } from "../subject";
import type { Frame, Landmark } from "../types";
import {
  CalibrationRounds,
  median,
  round1,
  RunningMedian,
  SubjectTracker,
  type Tracked,
} from "../modes/common";
import { RANGE_RULES } from "../modes/rangeTest";
import type { FeedEnv, QualitySummary } from "../modes/types";
import { calibrate, cameraSide, MOVEMENT_ANGLES, type AngleContext, type RomCalibration } from "./angles";
import { CompensationTracker, type CompensationHit, type HoldVerdict } from "./compensations";
import { HoldDetector, holdOptions, PlateauDetector, type HoldFound, type HoldOptions } from "./hold";
import { movementLandmarks, romQualityConfig } from "./quality";
import type {
  AnswerResult,
  AnswerSource,
  LimitCause,
  PainResult,
  RomAnswer,
  RomAttempt,
  RomEvent,
  RomFlag,
  RomHold,
  RomMeasureResult,
  RomPhase,
  RomRunnerOptions,
} from "./types";
import { painStopRule } from "../../medical/pain-rule";
import type { RomReasonId } from "../../medical/rom-protocol";
import { ROM_DATA, ROM_ENGINE_VERSION } from "../../movements/rom";
import type { CompensationId, RomCopyKey, RomCueId, RomKind, RomMovementId } from "../../movements/rom/types";
import type { CheckCueId } from "../../movements/types";

/** The runner's own rules, each a number of the contract or of v1 (parity tested). */
export const RUNNER_RULES = {
  /** rom-protocol 1.1 step 1 and contract 2.6: «the start pose held still for 1 s» (v1 RANGE_RULES.calibrationSec). */
  calibrationSec: RANGE_RULES.calibrationSec,
  /** v1's stillness band of the start pose (SPEC-GAP calibration-still), on v1's running median. */
  calibrationStillDeg: RANGE_RULES.calibrationStillDeg,
  /** The arm raises' start pose, the arm by the side: v1's relaxed angle. */
  relaxedMaxDeg: RANGE_RULES.relaxedMaxDeg,
  medianSec: RANGE_RULES.medianSec,
  /** Contract 2.6 keepReaching: «Extends the attempt by 10 s». */
  keepReachingSec: 10,
  /** v1.1 maxRetries: «up to 2 extra» (rom-protocol 1.1 step 7; the server's MAX_RETRIES). */
  maxRetries: 2,
} as const;

/** The recorded value bounds of each kind (contract section 4, the server's ROM_VALUE_BOUNDS). */
export const ROM_VALUE_BOUNDS: Record<RomKind, readonly [number, number]> = {
  flexion: [0, 180],
  signed: [-90, 90],
  lack: [-30, 150],
};

/** The arm movements whose start pose is the arm by the side (rom-protocol startPose). */
const ARM_HANGING: ReadonlySet<RomMovementId> = new Set([
  "shoulder_flexion",
  "shoulder_abduction",
  "shoulder_extension",
]);

type Side = "left" | "right";
type Cue = RomCueId | RomCopyKey | CheckCueId;

/** A hold of a scored attempt with what the checks read at it. */
interface HeldValue {
  hold: RomHold;
  verdict: HoldVerdict;
  answer: RomAnswer | "unconfirmed" | null;
  source: AnswerSource | null;
}

interface Attempt {
  index: number;
  practice: boolean;
  t0: number;
  monitor: QualityMonitor;
  /** The quality gate reads the attempt up to its hold, and again after «not yet». */
  monitoring: boolean;
  /** The existing One Euro on the subject's landmarks (oneEuro.ts PoseSmoother): the dial's angle. */
  smoother: PoseSmoother;
  /** v1's running median over the dial's angle: the angle the hold, the plateau and the checks read. */
  median: RunningMedian;
  hold: HoldDetector;
  plateau: PlateauDetector;
  /** The first filtered angle and the time the movement started (it left the hold band around it). */
  startDeg: number | null;
  firstMove: number | null;
  /** Milliseconds added to the attempt's clock: questions, keep reaching. */
  extendMs: number;
  /** The hold asked about now (phase ask_max), or answered «it hurts» (phase ask_pain). */
  current: HeldValue | null;
  /** The furthest hold answered «not yet» (it stands unless a later hold is further). */
  kept: HeldValue | null;
  /** «not yet» was the last answer and keep reaching was not used since. */
  reachOpen: boolean;
  /** A pain answer or «it hurts» in this attempt. */
  pain: boolean;
  painLevel: number | null;
  /** When the current question opened. */
  askT: number;
}

const clampTo = (kind: RomKind, v: number) =>
  Math.max(ROM_VALUE_BOUNDS[kind][0], Math.min(ROM_VALUE_BOUNDS[kind][1], Math.round(v)));

export class RomRunner {
  readonly lock: SubjectLock;
  private readonly opts: RomRunnerOptions;
  private readonly kind: RomKind;
  private readonly tracker: SubjectTracker;
  private readonly comp: CompensationTracker;
  private readonly holdOpts: HoldOptions;
  private readonly restSec: number;
  private readonly calibrationSec: number;
  private readonly mirrored: boolean;
  private readonly sink: RomEvent[] = [];

  private phaseNow: RomPhase = "idle";
  private finished = false;
  private t0 = 0;
  private tLast = 0;
  private lastRoll: number | null = null;

  /* calibration */
  private readonly rounds = new CalibrationRounds();
  private relockPending = true;
  private calBuf: { t: number; px: Landmark[]; roll: number | null }[] = [];
  private cal: RomCalibration | null = null;
  private calRoll: number | null = null;
  private camSide: Side | null = null;

  /* attempts */
  private att: Attempt | null = null;
  private readonly scored: RomAttempt[] = [];
  private practiceRec: RomAttempt | null = null;
  private practiceDone = false;
  private retries = 0;
  private repeated = 0;
  private readonly retryIssues = new Set<QualityIssue>();
  private readonly reports: QualityReport[] = [];
  private noHoldTries = 0;
  private holdCount = 0;
  /** Every hold answered or timed out (first answer per hold wins, across attempts). */
  private readonly answered = new Set<string>();
  private restUntil = 0;
  private answerDeadline = 0;

  /* outcome */
  private notMeasured: RomReasonId | null = null;
  private stopReason: "pain_stop" | "user_stop" | null = null;
  private painStopped = false;
  private maxPain: number | null = null;
  private cause: LimitCause | null = null;
  private causeAsked = false;

  /* pause */
  private pausedFrom: RomPhase | null = null;

  constructor(opts: RomRunnerOptions) {
    if (opts.def.id !== opts.item.movementId)
      throw new Error(`RomRunner: item ${opts.item.movementId} with the definition of ${opts.def.id}`);
    this.opts = opts;
    this.kind = opts.def.kind;
    this.mirrored = !!opts.mirrored;
    this.lock = opts.subject ?? new SubjectLock();
    this.tracker = new SubjectTracker(this.lock);
    this.comp = new CompensationTracker(opts.def, opts.item.position);
    this.holdOpts = holdOptions(opts.def.kind);
    this.restSec = opts.restSec ?? ROM_DATA.engine.restBetweenAttemptsSeconds.min;
    this.calibrationSec = opts.def.calibrationSeconds ?? RUNNER_RULES.calibrationSec;
  }

  get phase(): RomPhase {
    return this.phaseNow;
  }

  get done(): boolean {
    return this.finished;
  }

  /** The hold the maximum question is about (phase ask_max), else null. */
  get currentHold(): RomHold | null {
    return this.phaseNow === "ask_max" ? (this.att?.current?.hold ?? null) : null;
  }

  /** The calibration of the start pose, once taken. */
  get calibration(): Readonly<RomCalibration> | null {
    return this.cal;
  }

  start(t: number): RomEvent[] {
    if (this.phaseNow !== "idle") return this.drain();
    this.t0 = t;
    this.tLast = t;
    const skipped = this.opts.item.skipped;
    if (skipped) {
      this.notMeasured = skipped;
      this.end(t);
      return this.drain();
    }
    if (this.opts.item.askCanMove) {
      this.setPhase("ask_can_move", t);
      this.cue("can_move_ask", t);
    } else this.beginCalibration(t);
    return this.drain();
  }

  feed(frame: Frame, env: FeedEnv = {}): RomEvent[] {
    if (this.finished || this.phaseNow === "idle" || this.phaseNow === "stopped") return [];
    const t = frame.t;
    this.tLast = Math.max(this.tLast, t);
    const roll = env.rollDeg ?? null;
    if (roll !== null && Number.isFinite(roll)) this.lastRoll = roll;
    switch (this.phaseNow) {
      case "calibrating":
        this.calibrating(frame);
        break;
      case "practice":
      case "attempt":
        this.attempting(frame);
        break;
      case "ask_max":
        this.askingMax(frame);
        break;
      case "rest":
        this.resting(frame);
        break;
      default:
        // ask_can_move, ask_pain, ask_cause, paused: the subject is followed, nothing is measured.
        this.track(frame);
        break;
    }
    return this.drain();
  }

  answerCanMove(canMove: boolean, t: number): RomEvent[] {
    if (this.phaseNow !== "ask_can_move") return [];
    this.tLast = Math.max(this.tLast, t);
    if (canMove) this.beginCalibration(t);
    else {
      this.notMeasured = "no_active_movement";
      this.cue("no_active_movement", t);
      this.end(t);
    }
    return this.drain();
  }

  answerMax(holdId: string, answer: RomAnswer, source: AnswerSource, t: number): AnswerResult {
    const a = this.att;
    if (this.phaseNow === "stopped") return this.reject("stopped");
    if (this.answered.has(holdId)) return this.reject("already_answered");
    if (this.phaseNow !== "ask_max" || !a?.current) return this.reject("wrong_phase");
    if (a.current.hold.holdId !== holdId) return this.reject("stale_hold");
    this.tLast = Math.max(this.tLast, t);
    const held = a.current;
    this.answered.add(holdId);
    held.answer = answer;
    held.source = source;
    a.extendMs += Math.max(0, t - a.askT);
    if (answer === "yes") {
      this.endWithValue(t, this.further(held, a.kept));
    } else if (answer === "not_yet") {
      if (!held.hold.smallExcursion || a.kept === null) a.kept = this.further(held, a.kept);
      a.current = null;
      a.reachOpen = true;
      a.monitoring = true;
      a.hold.rearm(t);
      this.setPhase("attempt", t);
      // safety never: «no prompt to push further after pain is reported»: no keep_going after a pain answer.
      if (!a.pain) this.cue("keep_going", t);
    } else {
      // «It hurts: the value is recorded as pain limited; the pain question follows (0 to 10).»
      a.current = this.further(held, a.kept);
      a.current.answer = "hurts";
      a.current.source = source;
      a.pain = true;
      a.reachOpen = false;
      a.askT = t;
      this.setPhase("ask_pain", t);
      this.cue("pain_ask", t);
    }
    return { accepted: true, events: this.drain() };
  }

  answerPain(level: number, sharp: boolean, _source: AnswerSource, t: number): PainResult {
    if (this.phaseNow === "stopped") return { ...this.reject("stopped"), action: "continue" };
    if (this.finished || this.phaseNow === "idle")
      return { ...this.reject("wrong_phase"), action: "continue" };
    this.tLast = Math.max(this.tLast, t);
    const stored = Number.isFinite(level) ? Math.max(0, Math.min(10, Math.round(level))) : 10;
    this.maxPain = Math.max(this.maxPain ?? 0, stored);
    const a = this.att;
    if (a) {
      a.pain = true;
      a.reachOpen = false;
      a.painLevel = Math.max(a.painLevel ?? 0, stored);
    }
    const rule = painStopRule(level, sharp, this.opts.painBefore ?? null);
    if (rule.stop) {
      this.painStop(t);
      return { accepted: true, action: "stop_movement", events: this.drain() };
    }
    if (this.phaseNow === "ask_pain" && a?.current) {
      // Below the rule: the pain limited value stands and the attempts go on.
      this.endWithValue(t, a.current);
    }
    return { accepted: true, action: "continue", events: this.drain() };
  }

  answerCause(cause: LimitCause, _source: AnswerSource, t: number): AnswerResult {
    if (this.phaseNow === "stopped") return this.reject("stopped");
    if (this.phaseNow !== "ask_cause")
      return this.reject(this.causeAsked && this.finished ? "already_answered" : "wrong_phase");
    this.tLast = Math.max(this.tLast, t);
    this.cause = cause;
    this.end(t);
    return { accepted: true, events: this.drain() };
  }

  keepReaching(t: number): AnswerResult {
    const a = this.att;
    if (this.phaseNow === "stopped") return this.reject("stopped");
    if (a && a.pain) return this.reject("after_pain");
    if (this.phaseNow !== "attempt" || !a || !a.reachOpen) return this.reject("wrong_phase");
    this.tLast = Math.max(this.tLast, t);
    a.reachOpen = false;
    a.extendMs += RUNNER_RULES.keepReachingSec * 1000;
    return { accepted: true, events: this.drain() };
  }

  pause(t: number): RomEvent[] {
    const p = this.phaseNow;
    if (this.finished || p === "idle" || p === "stopped" || p === "paused") return [];
    this.tLast = Math.max(this.tLast, t);
    this.pausedFrom = p;
    this.setPhase("paused", t);
    return this.drain();
  }

  resume(t: number): AnswerResult {
    if (this.phaseNow === "stopped") return this.reject("stopped");
    if (this.phaseNow !== "paused" || this.pausedFrom === null) return this.reject("wrong_phase");
    this.tLast = Math.max(this.tLast, t);
    const from = this.pausedFrom;
    this.pausedFrom = null;
    const a = this.att;
    switch (from) {
      case "calibrating":
        this.beginCalibration(t);
        break;
      case "practice":
      case "attempt":
        // The paused attempt starts again: nothing of it is stored and no extra attempt is used.
        this.att = null;
        this.startAttempt(t, from === "practice");
        break;
      case "ask_max":
        if (a) {
          a.askT = t;
          this.answerDeadline = t + ROM_DATA.engine.answerTimeoutSeconds * 1000;
        }
        this.setPhase("ask_max", t);
        this.cue("ask_max", t);
        break;
      case "rest":
        this.rest(t);
        break;
      default:
        // A question: asked again.
        this.setPhase(from, t);
        if (from === "ask_pain") this.cue("pain_ask", t);
        else if (from === "ask_cause") this.cue("what_stopped_ask", t);
        else if (from === "ask_can_move") this.cue("can_move_ask", t);
        break;
    }
    return { accepted: true, events: this.drain() };
  }

  stop(reason: "pain_stop" | "user_stop", t: number): RomEvent[] {
    if (this.finished || this.phaseNow === "stopped") return [];
    this.tLast = Math.max(this.tLast, t);
    if (reason === "pain_stop") this.painStop(t);
    else this.halt("user_stop", t);
    return this.drain();
  }

  finish(t: number): RomMeasureResult {
    this.tLast = Math.max(this.tLast, t);
    if (this.phaseNow === "ask_cause") {
      // The optional question left unanswered: the movement is complete.
      this.end(t);
      this.drain();
    }
    const completed = this.finished;
    if (!completed && this.phaseNow !== "stopped") this.stopReason ??= "user_stop";
    return this.result(completed);
  }

  /* ----------------------------------------------------------------------- events */

  private drain(): RomEvent[] {
    return this.sink.splice(0, this.sink.length);
  }

  private reject(reason: NonNullable<AnswerResult["reason"]>): AnswerResult {
    return { accepted: false, reason, events: this.drain() };
  }

  private cue(cue: Cue, t: number): void {
    this.sink.push({ kind: "cue", cue, t });
  }

  private setPhase(phase: RomPhase, t: number, attempt?: number): void {
    this.phaseNow = phase;
    this.sink.push({ kind: "phase", phase, t, attempt: attempt ?? this.att?.index ?? this.nextIndex() });
  }

  private nextIndex(): number {
    return this.practiceNeeded() ? 0 : this.scored.length + 1;
  }

  private practiceNeeded(): boolean {
    return ROM_DATA.engine.practice > 0 && !this.practiceDone;
  }

  private end(t: number): void {
    if (this.finished) return;
    this.att = null;
    this.finished = true;
    this.setPhase("done", t);
    this.sink.push({ kind: "done", t });
  }

  private halt(reason: "pain_stop" | "user_stop", t: number): void {
    this.att = null;
    this.stopReason = reason;
    this.phaseNow = "stopped";
    this.sink.push({ kind: "phase", phase: "stopped", t, attempt: this.nextIndex() });
    this.sink.push({ kind: "stop", reason, t });
  }

  private emitHits(hits: CompensationHit[]): void {
    for (const h of hits) {
      this.sink.push({
        kind: "compensation",
        id: h.id,
        level: h.level,
        value: Math.round(h.value * 100) / 100,
        t: h.t,
      });
      if (h.level === "cue" && h.cue !== null) this.cue(h.cue, h.t);
    }
  }

  private track(frame: Frame): Tracked {
    return this.tracker.track(frame);
  }

  /* ----------------------------------------------------------------- calibration */

  private beginCalibration(t: number): void {
    this.calBuf = [];
    this.rounds.begin(t);
    this.relockPending = true;
    this.setPhase("calibrating", t);
  }

  private ctxBase(rollDeg: number | null): Omit<AngleContext, "calibration"> {
    return { side: this.opts.item.side, mirrored: this.mirrored, rollDeg };
  }

  private context(): AngleContext {
    return { ...this.ctxBase(this.lastRoll ?? this.calRoll), calibration: this.cal! };
  }

  /** The start pose landmarks the calibration needs (the hip of the arm raise to the front may hide: gravity mode). */
  private calibrationGate(px: Landmark[]): boolean {
    const def = this.opts.def;
    const camera = def.axial && def.view === "side" ? cameraSide(px) : null;
    const { gate } = movementLandmarks(def, this.opts.item.side, {
      mirrored: this.mirrored,
      cameraSide: camera,
      gravityMode: true,
    });
    const vis = ROM_DATA.engine.visibilityMin;
    return gate.every(
      (i) => Number.isFinite(px[i]?.x) && Number.isFinite(px[i]?.y) && (px[i]?.visibility ?? 0) >= vis,
    );
  }

  private calibrating(frame: Frame): void {
    const t = frame.t;
    const due = this.rounds.due(t);
    if (due === "give_up") {
      // O35: no still start pose in the last round: not measured today (quality).
      this.notMeasured = "quality";
      this.end(t);
      return;
    }
    if (due === "offer") {
      // O35 offers another round; v7 has no question for it, so the next round starts (tolerance kept widened).
      this.rounds.retry(t);
      this.calBuf = [];
    }
    if (this.relockPending) {
      if (!this.tracker.lockOn(frame)) return;
      this.relockPending = false;
    }
    const tr = this.track(frame);
    const px = tr.pick.paused ? null : tr.px;
    if (!px || !this.calibrationGate(px)) {
      this.calBuf = [];
      return;
    }
    this.calBuf.push({ t, px, roll: this.lastRoll });
    const from = t - this.calibrationSec * 1000;
    while (this.calBuf.length > 1 && this.calBuf[1].t <= from) this.calBuf.shift();
    if (this.calBuf[0].t > from) return;
    const rolls = this.calBuf.map((s) => s.roll).filter((r): r is number => r !== null);
    const roll = median(rolls);
    const base = this.ctxBase(roll);
    const cal = calibrate(this.opts.def.id, this.calBuf, base);
    if (!cal) return;
    const fn = MOVEMENT_ANGLES[this.opts.def.id];
    const med = new RunningMedian(RUNNER_RULES.medianSec * 1000);
    const angles: number[] = [];
    for (const s of this.calBuf) {
      const a = fn(s.px, { ...base, calibration: cal });
      if (a === null || !Number.isFinite(a)) return;
      angles.push(med.push(s.t, a));
    }
    if (ARM_HANGING.has(this.opts.def.id) && !this.armsHanging(cal, base)) return;
    const spread = Math.max(...angles) - Math.min(...angles);
    if (spread > this.rounds.tolerance(RUNNER_RULES.calibrationStillDeg, t)) return;
    this.cal = { ...cal, t };
    this.calRoll = roll;
    this.camSide = this.majorityCameraSide();
    this.comp.calibrate(this.calBuf, { ...base, calibration: this.cal });
    this.calBuf = [];
    this.startAttempt(t, this.practiceNeeded());
  }

  /** v1 4.1: the arm by the side at the start (the tested arm, and both for the side arm raise), at or under the relaxed angle. */
  private armsHanging(cal: RomCalibration, base: Omit<AngleContext, "calibration">): boolean {
    const id = this.opts.def.id;
    const side = this.opts.item.side;
    const sides: ("left" | "right" | "none")[] =
      id === "shoulder_abduction" && side !== "none" ? [side, side === "left" ? "right" : "left"] : [side];
    return this.calBuf.every((s) =>
      sides.every((sd) => {
        const a = MOVEMENT_ANGLES[id](s.px, { ...base, side: sd, calibration: cal });
        // The other arm may be unseen (v1: a null other arm counts as relaxed).
        return a === null ? sd !== side : a <= RUNNER_RULES.relaxedMaxDeg;
      }),
    );
  }

  private majorityCameraSide(): Side | null {
    const def = this.opts.def;
    if (!(def.axial && def.view === "side") || !this.calBuf.length) return null;
    const left = this.calBuf.filter((s) => cameraSide(s.px) === "left").length;
    return left * 2 >= this.calBuf.length ? "left" : "right";
  }

  /* -------------------------------------------------------------------- attempts */

  private startAttempt(t: number, practice: boolean): void {
    const index = practice ? 0 : this.scored.length + 1;
    const hold = new HoldDetector({ ...this.holdOpts, startDeg: this.cal?.startDeg ?? null });
    if (this.noHoldTries >= 2) hold.setBand(ROM_DATA.engine.wideHoldBandDeg);
    this.att = {
      index,
      practice,
      t0: t,
      monitor: new QualityMonitor(
        romQualityConfig(this.opts.def, this.opts.item.side, {
          mirrored: this.mirrored,
          cameraSide: this.camSide,
          gravityMode: !!this.cal?.gravityMode,
        }),
      ),
      monitoring: true,
      smoother: new PoseSmoother(),
      median: new RunningMedian(RUNNER_RULES.medianSec * 1000),
      hold,
      plateau: new PlateauDetector(this.holdOpts),
      startDeg: null,
      firstMove: null,
      extendMs: 0,
      current: null,
      kept: null,
      reachOpen: false,
      pain: false,
      painLevel: null,
      askT: t,
    };
    this.comp.startAttempt(practice);
    this.setPhase(practice ? "practice" : "attempt", t, index);
    this.cue(practice ? "practice" : "again", t);
  }

  /** «No hold within 20 s of the first movement» (before any movement, 20 s from the attempt's start), plus pauses for questions and keep reaching. */
  private deadline(a: Attempt): number {
    return (a.firstMove ?? a.t0) + ROM_DATA.engine.attemptTimeoutSeconds * 1000 + a.extendMs;
  }

  /**
   * The dial's angle: the movement angle of the subject's landmarks after the existing One Euro filter
   * (PoseSmoother, the defaults it was tuned with for landmark coordinates; on the angle in degrees the
   * same defaults hardly smooth, since its speed term would read degrees per second), null without one.
   */
  private dialAngle(a: Attempt, frame: Frame, tr: Tracked, ctx: AngleContext): number | null {
    if (!tr.raw) return null;
    const smoothed = toPixelSpace(a.smoother.smooth(tr.raw, frame.t), frame.aspect);
    const v = MOVEMENT_ANGLES[this.opts.def.id](smoothed, ctx);
    return v !== null && Number.isFinite(v) ? v : null;
  }

  private attempting(frame: Frame): void {
    const a = this.att!;
    const t = frame.t;
    const tr = this.track(frame);
    if (a.monitoring) a.monitor.feedPick(frame, tr.pick);
    const px = tr.pick.paused ? null : tr.px;
    const ctx = this.context();
    const angle = px ? MOVEMENT_ANGLES[this.opts.def.id](px, ctx) : null;
    const dial = px ? this.dialAngle(a, frame, tr, ctx) : null;
    if (px && angle !== null && Number.isFinite(angle) && dial !== null) {
      this.sink.push({ kind: "live", deg: round1(dial), t });
      const f = a.median.push(t, dial);
      if (a.startDeg === null) a.startDeg = f;
      else if (a.firstMove === null && Math.abs(f - a.startDeg) > this.holdOpts.bandDeg) a.firstMove = t;
      this.emitHits(this.comp.frame({ t, px, ctx, angle: f }));
      if (!a.practice && this.comp.invalid.length) {
        this.repeat(t, "invalid", this.comp.invalid);
        return;
      }
      if (!a.practice) {
        const p = a.plateau.push(t, f);
        if (p !== null) this.sink.push({ kind: "plateau", deg: round1(p), t, attempt: a.index });
      }
      const found = a.hold.push(t, f, angle);
      if (found) {
        this.onHold(found, t);
        return;
      }
    }
    if (t >= this.deadline(a)) this.timeout(t);
  }

  private onHold(found: HoldFound, t: number): void {
    const a = this.att!;
    const verdict = this.comp.atHold(found.from, found.to, found.deg);
    this.emitHits(verdict.hits);
    if (a.practice) {
      this.endPractice(t, found, verdict);
      return;
    }
    if (verdict.invalid.length) {
      this.repeat(t, "invalid", verdict.invalid);
      return;
    }
    const hold: RomHold = {
      holdId: `${a.index}:${++this.holdCount}`,
      deg: clampTo(this.kind, found.deg),
      t,
      attempt: a.index,
      excursionDeg: round1(found.excursionDeg),
      bandDeg: found.bandDeg === ROM_DATA.engine.wideHoldBandDeg ? 5 : 3,
      smallExcursion: found.smallExcursion,
    };
    a.current = { hold, verdict, answer: null, source: null };
    a.monitoring = false;
    a.reachOpen = false;
    a.askT = t;
    this.answerDeadline = t + ROM_DATA.engine.answerTimeoutSeconds * 1000;
    this.setPhase("ask_max", t);
    this.sink.push({ kind: "hold", hold });
    this.cue("ask_max", t);
  }

  private askingMax(frame: Frame): void {
    const a = this.att!;
    const t = frame.t;
    const tr = this.track(frame);
    const px = tr.pick.paused ? null : tr.px;
    const dial = px ? this.dialAngle(a, frame, tr, this.context()) : null;
    if (dial !== null) this.sink.push({ kind: "live", deg: round1(dial), t });
    if (t < this.answerDeadline || !a.current) return;
    // «No answer within 10 s: the hold is recorded as unconfirmed.» A small hold needs «نعم»: the attempt goes on.
    const held = a.current;
    this.answered.add(held.hold.holdId);
    if (held.hold.smallExcursion) {
      // No answer: the question's time counts toward the attempt's 20 s (only an answered question pauses it).
      a.current = null;
      a.monitoring = true;
      a.hold.rearm(t);
      this.setPhase("attempt", t);
      return;
    }
    a.extendMs += Math.max(0, t - a.askT);
    held.answer = "unconfirmed";
    held.source = "timeout";
    this.endWithValue(t, this.further(held, a.kept));
  }

  /** The further of a hold and the one kept after «not yet» (a later hold replaces the value only if further). */
  private further(held: HeldValue, kept: HeldValue | null): HeldValue {
    if (!kept) return held;
    const d = this.holdOpts.direction;
    return d * (held.hold.deg - kept.hold.deg) >= 0
      ? held
      : { ...kept, answer: held.answer, source: held.source };
  }

  /** The attempt's clock ran out: the value kept after «not yet» stands, else no hold. */
  private timeout(t: number): void {
    const a = this.att!;
    if (a.practice) {
      this.endPractice(t, null, null);
      return;
    }
    if (a.kept && !a.kept.hold.smallExcursion) {
      this.endWithValue(t, a.kept);
      return;
    }
    if (!a.kept) this.noHoldTries++;
    this.repeat(t, "no_hold", []);
  }

  private endPractice(t: number, found: HoldFound | null, verdict: HoldVerdict | null): void {
    const a = this.att!;
    this.att = null;
    const q = a.monitor.report();
    this.reports.push(q);
    if (!found) this.noHoldTries++;
    const flagged = verdict?.flagged ?? [];
    this.practiceRec = {
      index: 0,
      outcome: "practice",
      value: found ? clampTo(this.kind, found.deg) : null,
      answer: null,
      answerSource: null,
      painLimited: false,
      painLevel: a.painLevel,
      reasons: found
        ? [...new Set([...this.comp.invalid, ...flagged.filter((id) => id !== "bent_elbow")])]
        : ["no_hold"],
      flags: found ? this.holdFlags(found.smallExcursion, found.bandDeg, flagged, null) : [],
      quality: q,
      t0: a.t0,
      t1: t,
    };
    this.practiceDone = true;
    this.comp.endPractice();
    this.sink.push({ kind: "attempt", record: this.practiceRec });
    this.rest(t);
  }

  private holdFlags(
    small: boolean,
    band: number,
    flagged: CompensationId[],
    answer: RomAnswer | "unconfirmed" | null,
  ): RomFlag[] {
    const f: RomFlag[] = [];
    if (small) f.push("smallExcursion");
    if (band === ROM_DATA.engine.wideHoldBandDeg && band !== this.holdOpts.bandDeg) f.push("wideHold");
    if (flagged.includes("bent_elbow")) f.push("bentElbow");
    if (answer === "unconfirmed") f.push("unconfirmed");
    return f;
  }

  /** A scored attempt ends with a value: yes, unconfirmed, «not yet» at the timeout, or it hurts below the pain rule. */
  private endWithValue(t: number, held: HeldValue): void {
    const a = this.att!;
    const q = a.monitor.report();
    if (!q.ok) {
      this.repeat(t, "quality", [...q.issues], q);
      return;
    }
    this.att = null;
    this.reports.push(q);
    const painLimited = held.answer === "hurts" || a.pain;
    const rec: RomAttempt = {
      index: a.index,
      outcome: "valid",
      value: held.hold.deg,
      answer: held.answer,
      answerSource: held.source,
      painLimited,
      painLevel: a.painLevel,
      reasons: held.verdict.flagged.filter((id) => id !== "bent_elbow"),
      flags: this.holdFlags(held.hold.smallExcursion, held.hold.bandDeg, held.verdict.flagged, held.answer),
      quality: q,
      t0: a.t0,
      t1: t,
    };
    this.scored.push(rec);
    this.sink.push({ kind: "attempt", record: rec });
    this.cue("recorded", t);
    if (this.scored.length >= ROM_DATA.engine.scoredAttemptsMax) this.complete(t);
    else this.rest(t);
  }

  /**
   * A scored attempt that does not count: a compensation at its invalid level (outcome invalid, coached),
   * the quality gate or no hold (outcome retry). Repeated within the 2 extra, then not measured (quality).
   */
  private repeat(
    t: number,
    why: "invalid" | "quality" | "no_hold",
    ids: string[],
    report?: QualityReport,
  ): void {
    const a = this.att!;
    this.att = null;
    const q = report ?? a.monitor.report();
    this.reports.push(q);
    const reasons = why === "no_hold" ? ["no_hold", ...q.issues] : ids;
    // As v1: every quality issue of a repeated attempt is reported.
    for (const i of q.issues) this.retryIssues.add(i);
    const rec: RomAttempt = {
      index: a.index,
      outcome: why === "invalid" ? "invalid" : "retry",
      value: null,
      answer: null,
      answerSource: null,
      painLimited: false,
      painLevel: a.painLevel,
      reasons: [...new Set(reasons)],
      flags: [],
      quality: q,
      t0: a.t0,
      t1: t,
    };
    this.repeated++;
    this.sink.push({ kind: "attempt", record: rec });
    if (why === "quality" && q.issues.length) this.sink.push({ kind: "quality", issue: q.issues[0], t });
    if (this.retries >= RUNNER_RULES.maxRetries) {
      this.notMeasured = "quality";
      this.end(t);
      return;
    }
    this.retries++;
    this.rest(t);
  }

  private rest(t: number): void {
    this.restUntil = t + this.restSec * 1000;
    this.setPhase("rest", t, this.nextIndex());
  }

  private resting(frame: Frame): void {
    this.track(frame);
    if (frame.t >= this.restUntil) this.startAttempt(frame.t, this.practiceNeeded());
  }

  /** The scored attempts are done: the cause question once when the confirmed value is short, then done. */
  private complete(t: number): void {
    const below = this.opts.askCauseBelow;
    const best = this.best();
    const bestRec = best === null ? null : this.scored.find((a) => a.value === best)!;
    const short = best !== null && below !== null && this.holdOpts.direction * (best - below) < 0;
    const painLimited = this.scored.some((a) => a.painLimited);
    if (short && bestRec?.answer === "yes" && !painLimited && !this.causeAsked) {
      this.causeAsked = true;
      this.setPhase("ask_cause", t);
      this.cue("what_stopped_ask", t);
      return;
    }
    this.end(t);
  }

  /** The pain rule stopped the movement: the hold in hand counts as pain limited when its attempt passed its checks. */
  private painStop(t: number): void {
    const a = this.att;
    const held = a?.current ?? a?.kept ?? null;
    if (
      a &&
      !a.practice &&
      held &&
      !this.comp.invalid.length &&
      (!held.hold.smallExcursion || held.answer === "hurts")
    ) {
      const q = a.monitor.report();
      if (q.ok) {
        this.reports.push(q);
        const rec: RomAttempt = {
          index: a.index,
          outcome: "valid",
          value: held.hold.deg,
          answer:
            held.answer === "not_yet" || held.answer === "yes" || held.answer === "hurts"
              ? held.answer
              : null,
          answerSource: held.answer ? held.source : null,
          painLimited: true,
          painLevel: a.painLevel,
          reasons: held.verdict.flagged.filter((id) => id !== "bent_elbow"),
          flags: this.holdFlags(
            held.hold.smallExcursion,
            held.hold.bandDeg,
            held.verdict.flagged,
            held.answer,
          ),
          quality: q,
          t0: a.t0,
          t1: t,
        };
        this.scored.push(rec);
        this.sink.push({ kind: "attempt", record: rec });
      }
    }
    this.painStopped = true;
    this.cue("pain_stop", t);
    this.halt("pain_stop", t);
  }

  /* ----------------------------------------------------------------------- result */

  private best(): number | null {
    const values = this.scored.map((a) => a.value!).filter((v) => v !== null);
    if (!values.length) return null;
    return this.kind === "lack" ? Math.min(...values) : Math.max(...values);
  }

  private result(completed: boolean): RomMeasureResult {
    const item = this.opts.item;
    const def = this.opts.def;
    const values = this.scored.map((a) => a.value!);
    const stopped = !completed;
    let status: RomMeasureResult["status"];
    let reason: RomReasonId | null;
    if (this.notMeasured) {
      status = "not_measured";
      reason = this.notMeasured;
    } else if (stopped) {
      status = "stopped";
      reason = this.stopReason === "pain_stop" ? "pain_stop" : "by_choice";
    } else if (!values.length) {
      status = "not_measured";
      reason = "quality";
    } else {
      status = "measured";
      reason = null;
    }
    const keepsValue = status === "measured" || (status === "stopped" && this.painStopped);
    const best = keepsValue ? this.best() : null;
    const bestRec = best === null ? null : this.scored.find((a) => a.value === best)!;
    const flags = new Set<RomFlag>();
    if (this.cal?.gravityMode) flags.add("gravityMode");
    if (this.opts.poseModel === "lite") flags.add("modelLite");
    if (item.helperRequired) flags.add("helperPresent");
    if (this.scored.some((a) => a.flags.includes("bentElbow"))) flags.add("bentElbow");
    if (bestRec)
      for (const f of ["smallExcursion", "wideHold", "unconfirmed"] as const)
        if (bestRec.flags.includes(f)) flags.add(f);
    if (
      values.length > 1 &&
      Math.max(...values) - Math.min(...values) > def.E + ROM_DATA.engine.inconsistentSpread.plusE
    )
      flags.add("inconsistent");
    const fps = this.reports.map((q) => q.fps).filter((f) => f > 0);
    const quality: QualitySummary = {
      ok: this.notMeasured !== "quality",
      retries: this.repeated,
      issues: [...this.retryIssues],
      medianFps: fps.length ? round1(median(fps)!) : null,
      maxPausedShare: Math.max(0, ...this.reports.map((q) => q.pausedShare)),
    };
    const painLimited = this.painStopped || this.scored.some((a) => a.painLimited);
    return {
      movementId: def.id,
      side: item.side,
      position: item.position,
      status,
      reason,
      value: best,
      median: best === null ? null : Math.round(median(values)!),
      nValid: this.scored.length,
      painLimited,
      painLevel: this.maxPain,
      painBefore: this.opts.painBefore ?? null,
      cause: this.cause,
      attempts: [...this.scored],
      practice: this.practiceRec ? [this.practiceRec] : [],
      retries: this.retries,
      flags: [...flags],
      quality,
      poseModel: this.opts.poseModel,
      movementVersion: def.version,
      engineVersion: ROM_ENGINE_VERSION,
      durationSec: round1((this.tLast - this.t0) / 1000),
    };
  }
}
