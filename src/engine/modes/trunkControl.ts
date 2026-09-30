/**
 * Trunk control runner: `trunk_control_seated`, the seated side lean (spec 4.3, contract v2 F).
 * Pure TS, no DOM. One runner measures both sides, because the leans alternate.
 *
 * Flow: upright baseline → one practice lean per side (may be skipped for fatigue) → 3 recorded
 * leans per side, alternating, starting toward the stronger side (support none: right), with a
 * rest between leans. After the last lean of each side the UI asks the contact question (event
 * `ask`) and answers with `setContact`.
 *
 * Measure (spec 4.3 "Measurement definition"):
 *   - Trunk lean L: angle of the mid hip to mid shoulder vector from the image vertical, pixel
 *     space, corrected by the phone roll when the orientation sensor gives one.
 *   - Upright baseline U: median of L over a 3 s still window (SD at most 2 degrees) before the first
 *     lean. Without a still window within 10 s, the 3 s window with the lowest SD, flagged
 *     upright_unsteady; over 5 degrees SD the test is not measured today (quality). Hips must be
 *     visible in the baseline window, otherwise not measured today with a setup tip.
 *   - Attempt value toward side s: maximum over time of the rolling 0.5 s window minimum of
 *     (L minus U) signed toward s, the sign taken from the shoulder labels at U. A peak lean beyond
 *     the centre band toward the other side is wrong_side: not stored, and the asked side is cued
 *     again.
 *   - Pivot: when the hips drop out of sight during the lean, the mid hip is fixed at its median
 *     baseline position.
 *   - Return: centre band U ± max(3, 2 × SD); returnSec from the peak until L stays in the band for
 *     1 s (stored, never shown). No return within 10 s: test_trunk_to_middle and flag no_return.
 *   - Invalid: projected trunk length shrinks over 15 percent or the nose drops (forward bend);
 *     shoulder width changes over 15 percent (rotation); mid hip moves sideways over 0.25 shoulder
 *     widths when hips are visible (sliding).
 *   - Flags: head only tilt, knee or foot movement, wrist on thigh or armrest, arm_support_likely
 *     (leaning side elbow over 150 degrees at the peak).
 *   - Abort with test_trunk_to_middle (coaching, not a safeguard): lean speed over 45 degrees per
 *     second for more than 0.2 s; a lean more than 15 degrees beyond this side's best at earlier
 *     checks; at the first check a lean over 30 degrees; shoulder or hip landmarks lost mid lean;
 *     the pelvis sliding. An aborted attempt is censored (value = the abort threshold).
 * No live number and no target are shown during this test: the runner emits no live or peak events.
 */
import type { CheckCueId, ReasonId, TrunkControlDef } from "../../movements/types";
import type { Pt } from "../body";
import { QualityMonitor, qualityConfig, type QualityIssue, type QualityReport } from "../quality";
import { SubjectLock } from "../subject";
import { Frame, Landmark, LM } from "../types";
import {
  acrossVector,
  DEG,
  dot,
  EventSink,
  inPicture,
  jointAngle,
  leanFromVertical,
  median,
  norm,
  otherSide,
  Persist,
  round1,
  round3,
  RunningMedian,
  sd,
  seen,
  sideLandmarks,
  sub,
  SubjectTracker,
  SustainedPeak,
  type Tracked,
} from "./common";
import type {
  AttemptRecord,
  BodySide,
  Detail,
  FeedEnv,
  RunnerOptions,
  RunnerPhase,
  SideResult,
  TestEvent,
  TestResult,
  TestRunner,
  TestSide,
} from "./types";

export const TRUNK_RULES = {
  /** Spec 4.3: the upright window, its still limit, the search time and the unsteady limit. */
  uprightWindowSec: 3,
  uprightStillSdDeg: 2,
  uprightSearchSec: 10,
  uprightMaxSdDeg: 5,
  /** Spec 4.3: centre band = U ± max(3 degrees, 2 × SD of the upright window). */
  bandMinDeg: 3,
  bandSdMultiple: 2,
  /** Spec 4.3: back in the band for 1 s is a return; no return within 10 s cues and flags. */
  returnHoldSec: 1,
  noReturnSec: 10,
  /** Spec 4.3 invalid rules. */
  trunkShrinkInvalid: 0.15,
  widthChangeInvalid: 0.15,
  hipSlideShoulderWidths: 0.25,
  // SPEC-GAP: nose-drop. "The nose drops" has no measure. It is the nose height along the trunk
  // axis (above the mid shoulder) shrinking by more than this share of its baseline height, the
  // same share as the trunk length rule. A pure side lean keeps it. Tune at booth.
  noseDropInvalid: 0.15,
  /** Spec 4.3: arm_support_likely when the leaning side elbow is over 150 degrees at the peak. */
  armSupportElbowDeg: 150,
  /** Spec 4.3 aborts: speed over 45 degrees per second for more than 0.2 s, best plus 15, 30 at the first check. */
  abortSpeedDegPerSec: 45,
  abortSpeedSec: 0.2,
  abortBeyondBestDeg: 15,
  abortFirstCheckDeg: 30,
  /** Lean speed is measured over this span (ms), which keeps landmark jitter out of the speed. */
  speedSpanMs: 100,
  // SPEC-GAP: head-tilt. Head only tilt has no measure: the ear line turns more than this from its
  // baseline while the shoulder midpoint moves less than headTiltShiftMax shoulder widths.
  headTiltDeg: 10,
  headTiltShiftMax: 0.1,
  // SPEC-GAP: knee-move. Knee or foot movement has no measure: a visible knee moves more than this
  // many baseline shoulder widths from its baseline place (the feet are usually out of the frame,
  // head to knees).
  kneeMoveShoulderWidths: 0.15,
  // SPEC-GAP: wrist-contact. "Wrist on thigh or armrest" has no measure: the leaning side wrist is
  // at the peak lower than the mid hip minus this many baseline trunk lengths, which is where the
  // thighs and the armrests are.
  wristZoneTrunks: 0.3,
  // SPEC-GAP: frame-persistence. Per frame invalid, flag and abort rules count once they hold for
  // this long (the speed rule has its own 0.2 s), so a one frame glitch never decides.
  persistSec: 0.2,
  /** A lean that never leaves the band ends after this long (engineering). */
  leanTimeoutSec: 15,
  /** A lean that never comes back ends this long after the peak (engineering; flagged no_return). */
  returnTimeoutSec: 20,
  /** Before each lean, wait at most this long for the person to be back in the band. */
  recentreMaxSec: 10,
  /** The pause cue plays once the lean moves slower than this (degrees per second) over pauseCueSec. */
  pauseCueDegPerSec: 10,
  pauseCueSec: 0.3,
  /** The return cue plays once the held window minimum is within this of the current lean. */
  returnCueWithinDeg: 3,
  /** A lean this far below its best has started back (degrees). */
  startedBackDeg: 5,
  /**
   * The time of the peak (for returnSec and the 10 s no return rule) moves only when the held lean
   * grows by more than this (degrees), so landmark jitter during a long hold does not keep
   * restarting the clock (engineering).
   */
  peakStepDeg: 1,
  maxGapMs: 250,
  /** L is the running median over this window (s) before the lean rules use it (as in rangeTest.ts). */
  medianSec: 0.3,
  // R3C-37 (2) (trunk-sway, confirmed 2026-09-30). Leaning is the task, so the check in's big sway limit during a lean is
  // the abort limit of that side plus this margin.
  swayMarginDeg: 15,
  onePersonCueEverySec: 5,
} as const;

type AbortKind = "speed" | "limit" | "loss" | "slide";

interface LeanItem {
  side: BodySide;
  practice: boolean;
}

interface BaseSample {
  t: number;
  L: number;
  px: Landmark[];
  raw: Landmark[];
  aspect: number | undefined;
  roll: number | null;
}

interface Baseline {
  U: number;
  sd: number;
  halfBand: number;
  unsteady: boolean;
  fixedHip: Pt;
  midShoulder: Pt;
  shoulderWidth: number;
  trunk: number;
  noseHeight: number | null;
  earLine: number | null;
  knees: (Pt | null)[];
  /** +1 when leaning toward that side moves the shoulders to the image right. */
  dir: Record<BodySide, number>;
  roll: number | null;
}

interface LeanMeasure {
  L: number;
  pivotFixed: boolean;
  hipsOut: boolean;
  liveHip: Pt | null;
  ms: Pt;
  trunk: number;
  width: number;
  noseHeight: number | null;
  earLine: number | null;
  knees: (Pt | null)[];
  elbow: Record<BodySide, number | null>;
  wristY: Record<BodySide, number | null>;
  hipY: number;
}

interface LeanSample {
  t: number;
  x: number;
  L: number;
  shift: number;
  elbow: number | null;
  wristLow: boolean | null;
}

interface LeanState {
  item: LeanItem;
  index: number;
  t0: number;
  monitor: QualityMonitor;
  peak: SustainedPeak;
  opp: SustainedPeak;
  LMed: RunningMedian;
  samples: LeanSample[];
  leaned: boolean;
  back: boolean;
  /** Held lean and the time it was reached (see peakStepDeg). */
  peakValue: number;
  peakT: number | null;
  bandSince: number | null;
  returnSec: number | null;
  noReturn: boolean;
  abort: { kind: AbortKind; t: number; value: number } | null;
  frozenBest: { value: number; t: number; from: number } | null;
  speed: Persist;
  limit: Persist;
  loss: Persist;
  slide: Persist;
  shrink: Persist;
  nose: Persist;
  width: Persist;
  headTilt: Persist;
  knee: Persist;
  wrongSide: boolean;
  pivotFixed: boolean;
  said: Set<CheckCueId>;
  lastX: number;
  shrinkMax: number;
  widthMax: number;
  hipShiftMax: number;
}

const leanCue = (s: BodySide): CheckCueId =>
  s === "left" ? "test_trunk_lean_left" : "test_trunk_lean_right";

function sampleBefore<S extends { t: number }>(samples: readonly S[], at: number): S | null {
  for (let i = samples.length - 1; i >= 0; i--) if (samples[i].t <= at) return samples[i];
  return null;
}

/** Ear line angle from the image horizontal, the same whichever ear is on the left of the picture. */
function lineDeg(a: Pt, b: Pt): number {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (dx < 0) {
    dx = -dx;
    dy = -dy;
  }
  return Math.atan2(dy, dx) * DEG;
}

export class TrunkControlRunner implements TestRunner {
  readonly testId = "trunk_control_seated" as const;
  readonly kind = "trunk_control" as const;
  readonly sides: readonly BodySide[];
  readonly lock: SubjectLock;

  private readonly first: BodySide;
  private readonly minVis: number;
  private readonly restSec: number;
  private readonly mirrored: boolean;
  private readonly tracker: SubjectTracker;
  private readonly sink = new EventSink();

  private phaseNow: RunnerPhase = "idle";
  private finished = false;
  private t0 = 0;
  private tLast = 0;
  private lastRoll: number | null = null;
  private baseBuf: BaseSample[] = [];
  private bestWindow: { sd: number; samples: BaseSample[] } | null = null;
  private base: Baseline | null = null;
  private baseFailed = false;
  private queue: LeanItem[] = [];
  private lean: LeanState | null = null;
  private restUntil = 0;
  private recentreFrom: number | null = null;
  private lastRemaining = -1;
  private scored: Record<BodySide, AttemptRecord[]> = { left: [], right: [] };
  private practiceRecs: Record<BodySide, AttemptRecord[]> = { left: [], right: [] };
  private retried: Record<BodySide, AttemptRecord[]> = { left: [], right: [] };
  private retries: Record<BodySide, number> = { left: 0, right: 0 };
  private notMeasured: Record<BodySide, ReasonId | null> = { left: null, right: null };
  private contact: Record<BodySide, boolean | null> = { left: null, right: null };
  /** The next baseline frame locks the subject again (spec 4.0: locked at calibration). */
  private relockPending = true;
  private asked = new Set<BodySide>();
  /** The next lean's cue was already given (after a wrong side). */
  private cueGiven = false;
  private quality: Record<BodySide, QualityReport[]> = { left: [], right: [] };

  constructor(
    readonly def: TrunkControlDef,
    side: TestSide,
    readonly opts: RunnerOptions = {},
  ) {
    const wanted = opts.sides?.length ? opts.sides : (["left", "right"] as BodySide[]);
    // Start toward the stronger side; support none: toward the right (spec 4.3 sideRules).
    const preferred: BodySide = side === "none" ? "right" : side;
    this.first = wanted.includes(preferred) ? preferred : wanted[0];
    this.sides = wanted.includes(otherSide(this.first)) ? [this.first, otherSide(this.first)] : [this.first];
    this.minVis = def.requiredLandmarks.minVisibility;
    this.restSec = opts.restSec ?? def.restSec.betweenAttempts[0];
    this.mirrored = !!opts.mirrored;
    this.lock = opts.subject ?? new SubjectLock();
    this.tracker = new SubjectTracker(this.lock);
  }

  get phase(): RunnerPhase {
    return this.phaseNow;
  }

  get done(): boolean {
    return this.finished;
  }

  /** The upright baseline, once taken. */
  get baseline(): Readonly<Baseline> | null {
    return this.base;
  }

  /** The abort limit of a side (spec 4.3): 30 at the first check, else the earlier best plus 15. */
  abortLimit(side: BodySide): number {
    const prev = this.opts.previousBest?.[side];
    // R3C-37 (1) (abort-no-best, confirmed 2026-09-30). A later check with no earlier best for this side (it was skipped
    // before) uses the first check limit, the more conservative one.
    if ((this.opts.firstCheck ?? true) || prev === undefined) return TRUNK_RULES.abortFirstCheckDeg;
    return prev + TRUNK_RULES.abortBeyondBestDeg;
  }

  /** The contact answer for a side (spec 4.3 contactAsk): true censors that side's values. */
  setContact(side: BodySide, contact: boolean): void {
    this.contact[side] = contact;
  }

  /**
   * Skip the practice (S34e "Skip the practice", for fatigue) while the runner runs: before the
   * baseline the practice leans are never queued; during a practice lean (or its return) the lean is
   * dropped and the first recorded lean starts at once; during a rest the practice leans left are
   * dropped. The baseline is kept, so nothing is calibrated again.
   */
  skipPractice(t: number): TestEvent[] {
    if (this.finished) return [];
    this.practiceSkipped = true;
    this.queue = this.queue.filter((q) => !q.practice);
    const p = this.phaseNow;
    if (this.lean?.item.practice && (p === "practice" || p === "return")) {
      this.lean = null;
      this.nextLean(t);
    }
    return this.sink.drain();
  }

  /** The practice was skipped while the runner ran (skipPractice). */
  private practiceSkipped = false;

  start(t: number): TestEvent[] {
    this.t0 = t;
    this.tLast = t;
    this.relockPending = true;
    this.setPhase("calibrating", t);
    if (this.opts.intro ?? true) this.sink.cue("test_trunk_start", t);
    this.sink.cue("test_trunk_still", t);
    return this.sink.drain();
  }

  feed(frame: Frame, env: FeedEnv = {}): TestEvent[] {
    if (this.finished || this.phaseNow === "idle") return [];
    this.tLast = frame.t;
    const roll = env.rollDeg ?? null;
    if (roll !== null && Number.isFinite(roll)) this.lastRoll = roll;
    switch (this.phaseNow) {
      case "calibrating":
        this.baselining(frame, roll);
        break;
      case "practice":
      case "attempt":
      case "return":
        this.leaning(frame, roll);
        break;
      case "rest":
      case "recentre":
        this.resting(frame, roll);
        break;
      default:
        break;
    }
    return this.sink.drain();
  }

  finish(t: number): TestResult {
    const completed = this.finished;
    this.tLast = Math.max(this.tLast, t);
    return {
      testId: this.testId,
      kind: this.kind,
      results: this.sides.map((s) => this.sideResult(s, completed)),
      completed,
      durationSec: round1((this.tLast - this.t0) / 1000),
    };
  }

  /* --------------------------------------------------------------- phases */

  private setPhase(phase: RunnerPhase, t: number, side?: BodySide, attempt?: number): void {
    this.phaseNow = phase;
    this.sink.push({
      kind: "phase",
      phase,
      t,
      ...(side ? { side } : {}),
      ...(attempt !== undefined ? { attempt } : {}),
    });
  }

  private end(t: number): void {
    this.finished = true;
    this.phaseNow = "done";
    this.sink.push({ kind: "phase", phase: "done", t });
    this.sink.push({ kind: "done", t });
  }

  private track(frame: Frame): Tracked {
    const tr = this.tracker.track(frame);
    const p = tr.pick;
    if (p.paused && (p.reason === "overlap" || p.reason === "jump"))
      this.sink.cueEvery("check_one_person", frame.t, TRUNK_RULES.onePersonCueEverySec);
    return tr;
  }

  private rollFor(roll: number | null): number {
    if (!this.base) return roll ?? this.lastRoll ?? 0;
    return this.base.roll === null ? 0 : (roll ?? this.lastRoll ?? this.base.roll);
  }

  private personShoulders(px: Landmark[]): Record<BodySide, Landmark> {
    return {
      left: px[sideLandmarks("left", this.mirrored).shoulder],
      right: px[sideLandmarks("right", this.mirrored).shoulder],
    };
  }

  private baselining(frame: Frame, roll: number | null): void {
    const t = frame.t;
    const R = TRUNK_RULES;
    if (t - this.t0 > R.uprightSearchSec * 1000) {
      this.settleBaseline(t);
      return;
    }
    // The upright baseline is this test's calibration: it locks the subject again (spec 4.0), also
    // with a lock shared with another runner, so the lock's reference is this picture.
    if (this.relockPending) {
      if (!this.tracker.lockOn(frame)) return;
      this.relockPending = false;
    }
    const tr = this.track(frame);
    const px = tr.px;
    const mv = this.minVis;
    const ok =
      !!px && !!tr.raw && [LM.l_shoulder, LM.r_shoulder, LM.l_hip, LM.r_hip].every((i) => seen(px, i, mv));
    if (!ok) {
      this.baseBuf = [];
      return;
    }
    const ms = { x: (px![11].x + px![12].x) / 2, y: (px![11].y + px![12].y) / 2 };
    const mh = { x: (px![23].x + px![24].x) / 2, y: (px![23].y + px![24].y) / 2 };
    const r = roll ?? this.lastRoll;
    this.baseBuf.push({
      t,
      L: leanFromVertical(mh, ms, r ?? 0),
      px: px!,
      raw: tr.raw!,
      aspect: frame.aspect,
      roll: r,
    });
    const from = t - R.uprightWindowSec * 1000;
    while (this.baseBuf.length > 1 && this.baseBuf[1].t <= from) this.baseBuf.shift();
    if (this.baseBuf[0].t > from) return;
    const s = sd(this.baseBuf.map((b) => b.L));
    if (!this.bestWindow || s < this.bestWindow.sd) this.bestWindow = { sd: s, samples: [...this.baseBuf] };
    if (s <= R.uprightStillSdDeg) this.setBaseline(this.baseBuf, s, false, t);
  }

  /** 10 s without a still window (spec 4.3). */
  private settleBaseline(t: number): void {
    const w = this.bestWindow;
    if (w && w.sd <= TRUNK_RULES.uprightMaxSdDeg) {
      this.setBaseline(w.samples, w.sd, true, t);
      return;
    }
    // Not measured today (quality). Without any window the hips were never seen together with the
    // shoulders: the setup tip.
    // SPEC-GAP: hips-setup-tip. Q13 has no tip text yet; check_whole_body is the closest cue.
    if (!w) this.sink.cue("check_whole_body", t);
    this.baseFailed = true;
    for (const s of this.sides) this.notMeasured[s] = "quality";
    this.end(t);
  }

  private setBaseline(samples: BaseSample[], sdL: number, unsteady: boolean, t: number): void {
    const R = TRUNK_RULES;
    const mv = this.minVis;
    const med = (f: (s: BaseSample) => number, of: BaseSample[] = samples) => median(of.map(f))!;
    const msOf = (p: Landmark[]) => ({ x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 });
    const mhOf = (p: Landmark[]) => ({ x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 });
    const fixedHip = { x: med((s) => mhOf(s.px).x), y: med((s) => mhOf(s.px).y) };
    const midShoulder = { x: med((s) => msOf(s.px).x), y: med((s) => msOf(s.px).y) };
    const noseSeen = samples.filter((s) => seen(s.px, LM.nose, mv));
    const earsSeen = samples.filter((s) => seen(s.px, LM.l_ear, mv) && seen(s.px, LM.r_ear, mv));
    const knees = [LM.l_knee, LM.r_knee].map((k) => {
      const kSeen = samples.filter((s) => seen(s.px, k, mv));
      return kSeen.length ? { x: med((s) => s.px[k].x, kSeen), y: med((s) => s.px[k].y, kSeen) } : null;
    });
    const xs = {
      left: med((s) => this.personShoulders(s.px).left.x),
      right: med((s) => this.personShoulders(s.px).right.x),
    };
    // The sign of a lean toward each side from the person's shoulder labels at U (spec 4.3).
    const dirLeft = Math.sign(xs.left - xs.right) || (this.mirrored ? -1 : 1);
    const rolls = samples.map((s) => s.roll).filter((r): r is number => r !== null);
    this.base = {
      U: median(samples.map((s) => s.L))!,
      sd: sdL,
      halfBand: Math.max(R.bandMinDeg, R.bandSdMultiple * sdL),
      unsteady,
      fixedHip,
      midShoulder,
      shoulderWidth: med((s) => norm(sub(s.px[11], s.px[12]))),
      trunk: med((s) => norm(sub(msOf(s.px), mhOf(s.px)))),
      noseHeight: noseSeen.length ? med((s) => this.noseHeight(s.px, mhOf(s.px)), noseSeen) : null,
      earLine: earsSeen.length ? med((s) => lineDeg(s.px[LM.r_ear], s.px[LM.l_ear]), earsSeen) : null,
      knees,
      dir: { left: dirLeft, right: -dirLeft },
      roll: median(rolls),
    };
    this.baseBuf = [];
    if (unsteady) this.sink.push({ kind: "flag", flag: "upright_unsteady", t });

    const order = this.sides;
    if (!this.opts.skipPractice && !this.practiceSkipped)
      for (const s of order) this.queue.push({ side: s, practice: true });
    for (let k = 0; k < this.def.attempts; k++)
      for (const s of order) this.queue.push({ side: s, practice: false });
    this.sink.cue("test_trunk_seat", t);
    this.sink.cue("test_trunk_light_touch", t);
    this.nextLean(t);
  }

  /** Nose height above the mid shoulder along the trunk axis (pixel space). */
  private noseHeight(px: Landmark[], pivot: Pt): number {
    const ms = { x: (px[11].x + px[12].x) / 2, y: (px[11].y + px[12].y) / 2 };
    const axis = sub(ms, pivot);
    const n = norm(axis);
    if (n < 1e-9) return 0;
    return dot(sub(px[LM.nose], ms), { x: axis.x / n, y: axis.y / n });
  }

  private nextLean(t: number): void {
    const item = this.queue.shift();
    if (!item) {
      this.end(t);
      return;
    }
    const side = item.side;
    const index = item.practice ? 0 : this.scored[side].length + 1;
    this.lean = {
      item,
      index,
      t0: t,
      monitor: new QualityMonitor(qualityConfig(this.def, side)),
      peak: new SustainedPeak(this.def.holdSec * 1000, TRUNK_RULES.maxGapMs),
      opp: new SustainedPeak(this.def.holdSec * 1000, TRUNK_RULES.maxGapMs),
      LMed: new RunningMedian(TRUNK_RULES.medianSec * 1000),
      samples: [],
      leaned: false,
      back: false,
      peakValue: -Infinity,
      peakT: null,
      bandSince: null,
      returnSec: null,
      noReturn: false,
      abort: null,
      frozenBest: null,
      speed: new Persist(TRUNK_RULES.abortSpeedSec),
      limit: new Persist(TRUNK_RULES.persistSec),
      loss: new Persist(TRUNK_RULES.persistSec),
      slide: new Persist(TRUNK_RULES.persistSec),
      shrink: new Persist(TRUNK_RULES.persistSec),
      nose: new Persist(TRUNK_RULES.persistSec),
      width: new Persist(TRUNK_RULES.persistSec),
      headTilt: new Persist(TRUNK_RULES.persistSec),
      knee: new Persist(TRUNK_RULES.persistSec),
      wrongSide: false,
      pivotFixed: false,
      said: new Set(),
      lastX: 0,
      shrinkMax: 0,
      widthMax: 0,
      hipShiftMax: 0,
    };
    this.setPhase(item.practice ? "practice" : "attempt", t, side, index);
    if (!this.cueGiven) this.sink.cue(leanCue(side), t);
    this.cueGiven = false;
  }

  private cueOnce(cue: CheckCueId, t: number): void {
    const a = this.lean!;
    if (a.said.has(cue)) return;
    a.said.add(cue);
    this.sink.cue(cue, t);
  }

  private measureLean(
    px: Landmark[] | null,
    raw: Landmark[] | null,
    roll: number | null,
  ): LeanMeasure | null {
    const b = this.base!;
    const mv = this.minVis;
    if (!px || !raw || !seen(px, LM.l_shoulder, mv) || !seen(px, LM.r_shoulder, mv)) return null;
    const ms = { x: (px[11].x + px[12].x) / 2, y: (px[11].y + px[12].y) / 2 };
    const hipsSeen = seen(px, LM.l_hip, mv) && seen(px, LM.r_hip, mv);
    const liveHip = hipsSeen ? { x: (px[23].x + px[24].x) / 2, y: (px[23].y + px[24].y) / 2 } : null;
    const pivot = liveHip ?? b.fixedHip;
    const L = leanFromVertical(pivot, ms, this.rollFor(roll));
    const elbow = {} as Record<BodySide, number | null>;
    const wristY = {} as Record<BodySide, number | null>;
    for (const s of ["left", "right"] as const) {
      const sl = sideLandmarks(s, this.mirrored);
      const ok = seen(px, sl.shoulder, mv) && seen(px, sl.elbow, mv) && seen(px, sl.wrist, mv);
      elbow[s] = ok ? jointAngle(px[sl.shoulder], px[sl.elbow], px[sl.wrist]) : null;
      wristY[s] = seen(px, sl.wrist, mv) ? px[sl.wrist].y : null;
    }
    return {
      L,
      pivotFixed: !liveHip,
      hipsOut: !inPicture(raw[LM.l_hip]) || !inPicture(raw[LM.r_hip]),
      liveHip,
      ms,
      trunk: norm(sub(ms, pivot)),
      width: norm(sub(px[11], px[12])),
      noseHeight: seen(px, LM.nose, mv) ? this.noseHeight(px, pivot) : null,
      earLine: seen(px, LM.l_ear, mv) && seen(px, LM.r_ear, mv) ? lineDeg(px[LM.r_ear], px[LM.l_ear]) : null,
      knees: [LM.l_knee, LM.r_knee].map((k) => (seen(px, k, mv) ? { x: px[k].x, y: px[k].y } : null)),
      elbow,
      wristY,
      hipY: pivot.y,
    };
  }

  private leaning(frame: Frame, roll: number | null): void {
    const a = this.lean!;
    const b = this.base!;
    const R = TRUNK_RULES;
    const t = frame.t;
    const s = a.item.side;
    const limit = this.abortLimit(s);
    const tr = this.track(frame);
    a.monitor.feedPick(frame, tr.pick);
    const m = tr.pick.paused ? null : this.measureLean(tr.px, tr.raw, roll);
    // Mid lean: still leaning out beyond the band, on the way out or on the way back.
    const out = a.leaned && a.lastX > b.halfBand;
    // SPEC-GAP: hip-loss. The abort for hip landmarks "lost mid lean" and the pivot rule (hips that
    // drop out of sight take the fixed pivot) overlap. Hips hidden by armrests use the fixed pivot;
    // the abort counts hips outside the picture, or the subject or the shoulders lost, mid lean.

    if (m && t - (a.samples[a.samples.length - 1]?.t ?? t) > R.maxGapMs) a.LMed.reset();
    if (!m) {
      a.peak.gap();
      a.opp.gap();
      a.LMed.reset();
      // Shoulder landmarks or the subject lost mid lean (not a pause for another person).
      const lost = !tr.pick.paused || tr.pick.reason === "lost" || tr.pick.reason === "jump";
      if (a.loss.update(t, out && lost)) this.abort("loss", t, null);
      this.timeouts(t);
      return;
    }

    const L = a.LMed.push(t, m.L);
    const x = (L - b.U) * b.dir[s];
    a.lastX = x;
    const across = acrossVector(this.rollFor(roll));
    const shift = (dot(sub(m.ms, b.midShoulder), across) / b.shoulderWidth) * b.dir[s];
    const wristY = m.wristY[s];
    a.samples.push({
      t,
      x,
      L,
      shift,
      elbow: m.elbow[s],
      wristLow: wristY === null ? null : wristY > m.hipY - R.wristZoneTrunks * b.trunk,
    });
    if (m.pivotFixed) a.pivotFixed = true;

    let wmin: number | null = null;
    if (!a.abort) {
      wmin = a.peak.push(t, x);
      a.opp.push(t, -x);
      const best = a.peak.best;
      if (best && best.value > a.peakValue + R.peakStepDeg) {
        a.peakValue = best.value;
        a.peakT = best.t;
      }
    }
    if (x > b.halfBand) a.leaned = true;

    // wrong_side (spec 4.3): the held lean goes beyond the band toward the other side.
    const toward = a.peak.best?.value ?? -Infinity;
    if (!a.abort && a.opp.best && a.opp.best.value > b.halfBand && a.opp.best.value > toward) {
      a.wrongSide = true;
      this.endLean(t);
      return;
    }

    // Aborts (coaching cues, not safeguards).
    const prev = sampleBefore(a.samples, t - R.speedSpanMs);
    let outward = false;
    if (prev && t - prev.t <= R.speedSpanMs + R.maxGapMs) {
      const v = (L - prev.L) / ((t - prev.t) / 1000);
      // R3C-37 (3) (speed-direction, confirmed 2026-09-30). The speed abort counts moving away from the middle before the
      // return: a quick return to the middle is what the abort cue asks for.
      outward = Math.abs(v) > R.abortSpeedDegPerSec && Math.sign(v) === Math.sign(L - b.U) && !a.back;
    }
    if (a.speed.update(t, outward)) this.abort("speed", t, x);
    if (a.limit.update(t, x > limit)) this.abort("limit", t, limit);
    if (a.loss.update(t, out && m.hipsOut)) this.abort("loss", t, x);
    const hipShift = m.liveHip ? Math.abs(dot(sub(m.liveHip, b.fixedHip), across)) / b.shoulderWidth : 0;
    a.hipShiftMax = Math.max(a.hipShiftMax, hipShift);
    if (a.slide.update(t, !!m.liveHip && hipShift > R.hipSlideShoulderWidths)) this.abort("slide", t, x);

    // Invalid rules.
    const shrink = 1 - m.trunk / b.trunk;
    a.shrinkMax = Math.max(a.shrinkMax, shrink);
    a.shrink.update(t, shrink > R.trunkShrinkInvalid);
    if (m.noseHeight !== null && b.noseHeight !== null && b.noseHeight > 1e-6)
      a.nose.update(t, 1 - m.noseHeight / b.noseHeight > R.noseDropInvalid);
    const widthChange = Math.abs(m.width / b.shoulderWidth - 1);
    a.widthMax = Math.max(a.widthMax, widthChange);
    a.width.update(t, widthChange > R.widthChangeInvalid);

    // Flags.
    if (m.earLine !== null && b.earLine !== null)
      a.headTilt.update(
        t,
        Math.abs(m.earLine - b.earLine) > R.headTiltDeg && Math.abs(shift) < R.headTiltShiftMax,
      );
    const kneeMoved = m.knees.some((k, i) => {
      const k0 = b.knees[i];
      return !!k && !!k0 && norm(sub(k, k0)) > R.kneeMoveShoulderWidths * b.shoulderWidth;
    });
    a.knee.update(t, kneeMoved);

    // Cues along the lean.
    if (!a.abort && x > b.halfBand && !a.said.has("test_trunk_pause")) {
      const back = sampleBefore(a.samples, t - R.pauseCueSec * 1000);
      if (back && t - back.t <= R.pauseCueSec * 1000 + R.maxGapMs) {
        const v = Math.abs(x - back.x) / ((t - back.t) / 1000);
        if (v < R.pauseCueDegPerSec) this.cueOnce("test_trunk_pause", t);
      }
    }
    if (a.said.has("test_trunk_pause") && !a.back && wmin !== null && wmin >= x - R.returnCueWithinDeg) {
      this.cueOnce("test_trunk_return", t);
      this.startBack(t);
    }
    if (a.leaned && !a.back && a.peak.best && x < a.peak.best.value - R.startedBackDeg) this.startBack(t);

    // Return to the centre band (spec 4.3).
    const inBand = Math.abs(L - b.U) <= b.halfBand;
    if (a.leaned && inBand) {
      a.bandSince ??= t;
      if (t - a.bandSince >= R.returnHoldSec * 1000) {
        const tPeak = a.peakT ?? a.abort?.t ?? a.bandSince;
        a.returnSec = Math.max(0, (a.bandSince - tPeak) / 1000);
        this.endLean(t);
        return;
      }
    } else a.bandSince = null;
    this.timeouts(t);
  }

  private startBack(t: number): void {
    const a = this.lean!;
    if (a.back) return;
    a.back = true;
    if (this.phaseNow !== "return") this.setPhase("return", t, a.item.side, a.index);
  }

  private abort(kind: AbortKind, t: number, value: number | null): void {
    const a = this.lean!;
    if (a.abort) return;
    // Censoring (spec 4.3): value = the abort threshold for the lean limits.
    // SPEC-GAP: abort-value. Speed and landmark loss have no lean threshold; the stored lower bound
    // is the best lean held so far, or the lean at the abort when nothing was held.
    const held = a.peak.best?.value ?? null;
    const v = kind === "limit" ? value! : Math.max(held ?? value ?? 0, 0);
    a.abort = { kind, t, value: v };
    a.frozenBest = a.peak.best ? { ...a.peak.best } : null;
    this.sink.push({ kind: "flag", flag: `abort_${kind}`, t, side: a.item.side });
    this.cueOnce("test_trunk_to_middle", t);
    this.startBack(t);
  }

  private timeouts(t: number): void {
    const a = this.lean;
    if (!a) return;
    const R = TRUNK_RULES;
    const tPeak = a.peakT ?? a.abort?.t ?? null;
    if (a.leaned && tPeak !== null && !a.noReturn && t - tPeak > R.noReturnSec * 1000) {
      a.noReturn = true;
      this.cueOnce("test_trunk_to_middle", t);
      this.sink.push({ kind: "flag", flag: "no_return", t, side: a.item.side });
    }
    if (!a.leaned && t - a.t0 > R.leanTimeoutSec * 1000) this.endLean(t);
    else if (a.leaned && t - (tPeak ?? a.t0) > R.returnTimeoutSec * 1000) this.endLean(t);
  }

  private endLean(t: number): void {
    const a = this.lean!;
    this.lean = null;
    const side = a.item.side;
    const q = a.monitor.report();
    this.quality[side].push(q);
    const R = TRUNK_RULES;
    const best = a.frozenBest ?? a.peak.best;
    // The posture at the peak, or at the abort for an aborted lean (the held window may predate it).
    const hold = this.def.holdSec * 1000;
    const win = a.abort
      ? a.samples.filter((s) => s.t >= a.abort!.t - hold && s.t <= a.abort!.t)
      : best
        ? a.samples.filter((s) => s.t >= best.from && s.t <= best.t)
        : [];
    const at = <K extends "shift" | "elbow">(k: K) =>
      median(win.map((s) => s[k]).filter((x): x is number => x !== null));
    const shift = at("shift");
    const elbow = at("elbow");
    const wristVals = win.map((s) => s.wristLow).filter((x): x is boolean => x !== null);
    const wristLow = wristVals.length ? wristVals.filter(Boolean).length * 2 > wristVals.length : null;
    const armSupport = elbow === null ? "unknown" : elbow > R.armSupportElbowDeg;

    let value: number | null;
    let censored = false;
    if (a.abort && a.abort.kind !== "slide") {
      value = Math.round(a.abort.value);
      censored = true;
    } else value = best ? Math.round(Math.max(0, best.value)) : null;

    const flags: string[] = [];
    if (a.noReturn) flags.push("no_return");
    if (a.headTilt.hit) flags.push("head_only_tilt");
    if (a.knee.hit) flags.push("knee_or_foot_move");
    if (wristLow === true) flags.push("wrist_support");
    if (armSupport === true) flags.push("arm_support_likely");
    // SPEC-GAP: no-lean. A lean that never leaves the centre band is stored with what was held and
    // flagged no_lean; the spec has no rule for it.
    if (!a.leaned) flags.push("no_lean");
    if (a.pivotFixed) flags.push("fixed_pivot");

    const detail: Detail = {
      returnSec: a.returnSec === null ? "unknown" : round1(a.returnSec),
      shoulderShift: shift === null ? "unknown" : round3(shift),
      pivot: a.pivotFixed ? "fixed_pivot" : "visible_hip",
      elbowDeg: elbow === null ? "unknown" : Math.round(elbow),
      armSupportLikely: armSupport,
      wristSupport: wristLow === null ? "unknown" : wristLow,
      abort: a.abort ? a.abort.kind : "none",
      abortLimit: this.abortLimit(side),
      trunkShrinkMax: round3(Math.max(0, a.shrinkMax)),
      widthChangeMax: round3(a.widthMax),
      hipShiftMax: round3(a.hipShiftMax),
    };
    const rec: AttemptRecord = {
      side,
      index: a.index,
      outcome: "practice",
      value,
      reasons: [],
      flags,
      censored,
      detail,
      quality: q,
      t0: a.t0,
      t1: t,
    };

    if (a.item.practice && !a.wrongSide) {
      this.practiceRecs[side].push(rec);
      this.sink.push(this.attemptEvent(rec, t));
      this.rest(t);
      return;
    }

    if (a.wrongSide || !q.ok) {
      rec.outcome = "retry";
      rec.reasons = a.wrongSide ? ["wrong_side"] : [...q.issues];
      this.retried[side].push(rec);
      this.sink.push(this.attemptEvent(rec, t));
      // SPEC-GAP: retry-budget (as in rangeTest.ts): wrong side leans, practice included, use the same
      // 2 extra leans per side as a failed quality gate.
      if (this.retries[side] >= this.def.maxRetries) {
        // Out of retries: this side is not measured today (quality); the other side goes on.
        this.notMeasured[side] = "quality";
        this.queue = this.queue.filter((i) => i.side !== side);
      } else {
        this.retries[side]++;
        this.queue.unshift({ ...a.item });
        if (a.wrongSide) {
          // Spec 4.3: the asked side is cued again at once; the lean starts back in the middle.
          this.sink.cue(leanCue(side), t);
          this.cueGiven = true;
        } else {
          if (q.cue && q.cue !== "check_try_again") this.sink.cue(q.cue, t);
          this.sink.cue("check_try_again", t);
        }
      }
      this.afterLean(t, a.wrongSide);
      return;
    }

    const reasons: string[] = [];
    if (a.shrink.hit || a.nose.hit) reasons.push("forward_bend");
    if (a.width.hit) reasons.push("rotation");
    if (a.slide.hit) reasons.push("hip_slide");
    if (value === null) reasons.push("no_hold");
    rec.outcome = reasons.length ? "invalid" : "valid";
    rec.reasons = reasons;
    this.scored[side].push(rec);
    this.sink.push(this.attemptEvent(rec, t));
    for (const f of flags) this.sink.push({ kind: "flag", flag: f, t, side });
    if (rec.outcome === "valid") this.sink.cue("check_saved", t);
    if (this.scored[side].length >= this.def.attempts && !this.asked.has(side)) {
      // SPEC-GAP: contact-when. "After each side" with alternating leans is read as after that side's
      // last recorded lean.
      this.asked.add(side);
      this.sink.push({ kind: "ask", ask: "contact", side, t });
    }
    this.afterLean(t, false);
  }

  private afterLean(t: number, wrongSide: boolean): void {
    if (!this.queue.length) {
      this.end(t);
      return;
    }
    // After a wrong side the asked side is cued at once and the lean starts back in the middle.
    if (wrongSide) this.recentre(t);
    else this.rest(t);
  }

  private attemptEvent(rec: AttemptRecord, t: number): TestEvent {
    return {
      kind: "attempt",
      t,
      side: rec.side,
      attempt: rec.index,
      outcome: rec.outcome,
      value: rec.value,
      censored: rec.censored,
      reasons: [...rec.reasons],
    };
  }

  private rest(t: number): void {
    this.restUntil = t + this.restSec * 1000;
    this.recentreFrom = null;
    this.lastRemaining = -1;
    this.setPhase("rest", t);
    if (this.restSec > 0) this.sink.cue("check_rest_short", t);
  }

  private recentre(t: number): void {
    this.restUntil = t;
    this.recentreFrom = t;
    this.setPhase("recentre", t);
  }

  private resting(frame: Frame, roll: number | null): void {
    const t = frame.t;
    const tr = this.track(frame);
    if (t < this.restUntil) {
      const remaining = Math.ceil((this.restUntil - t) / 1000);
      if (remaining !== this.lastRemaining) {
        this.lastRemaining = remaining;
        this.sink.push({ kind: "time", remainingSec: remaining, t });
      }
      return;
    }
    if (this.phaseNow !== "recentre") this.recentre(t);
    const m = tr.pick.paused ? null : this.measureLean(tr.px, tr.raw, roll);
    const centred = !!m && Math.abs(m.L - this.base!.U) <= this.base!.halfBand;
    if (centred || t - this.recentreFrom! >= TRUNK_RULES.recentreMaxSec * 1000) this.nextLean(t);
  }

  /* --------------------------------------------------------------- result */

  private sideResult(side: BodySide, completed: boolean): SideResult {
    const b = this.base;
    const scored = this.scored[side];
    const valid = scored.filter((a) => a.outcome === "valid" && a.value !== null);
    const values = valid.map((a) => a.value!);
    // SPEC-GAP: no-valid-reason (as in rangeTest.ts): no valid lean reads not measured (quality).
    const notMeasured: ReasonId | null =
      this.notMeasured[side] ?? (completed && !values.length ? "quality" : null);
    const status = notMeasured ? "not_measured" : completed ? "measured" : "stopped";
    const value = !notMeasured && values.length ? Math.max(...values) : null;
    // The best is censored when a censored attempt reaches it (ties read "more than").
    const bestRecs = value === null ? [] : valid.filter((a) => a.value === value);
    const bestRec = bestRecs.find((a) => a.censored) ?? bestRecs[0] ?? null;
    const contact = this.contact[side];
    const censored = value !== null && (!!bestRec?.censored || contact === true);
    const flags: string[] = [];
    if (b?.unsteady) flags.push("upright_unsteady");
    if (valid.some((a) => a.flags.includes("no_return"))) flags.push("no_return");
    if (bestRec?.flags.includes("arm_support_likely")) flags.push("arm_support_likely");
    if (contact === true) flags.push("contact");
    // SPEC-GAP: contact-unanswered. Without an answer contact is stored as unknown and flagged, never
    // taken as no.
    if (contact === null && value !== null) flags.push("contact_unknown");
    if (censored) flags.push("censored");
    const detail: Detail = {
      upright: b ? round1(b.U) : "unknown",
      uprightSd: b ? round1(b.sd) : "unknown",
      band: b ? round1(b.halfBand) : "unknown",
      pivot: valid.some((a) => a.detail.pivot === "fixed_pivot") ? "fixed_pivot" : "visible_hip",
      contact: contact === null ? "unknown" : contact,
      censored,
      abortLimit: this.abortLimit(side),
    };
    if (bestRec) {
      for (const k of [
        "returnSec",
        "shoulderShift",
        "armSupportLikely",
        "wristSupport",
        "elbowDeg",
        "abort",
      ]) {
        if (bestRec.detail[k] !== undefined) detail[k] = bestRec.detail[k];
      }
    }
    const qs = this.quality[side];
    const fps = qs.map((q) => q.fps).filter((f) => f > 0);
    const issues = new Set<QualityIssue>();
    for (const r of this.retried[side]) for (const i of r.quality.issues) issues.add(i);
    return {
      testId: this.testId,
      side,
      unit: this.def.unit,
      status,
      reason: notMeasured,
      value,
      median: null,
      nValid: values.length,
      censored,
      attempts: [...scored],
      practice: [...this.practiceRecs[side]],
      retried: [...this.retried[side]],
      detail,
      flags,
      quality: {
        ok: this.notMeasured[side] !== "quality" && !this.baseFailed,
        retries: this.retried[side].length,
        issues: [...issues],
        medianFps: fps.length ? round1(median(fps)!) : null,
        maxPausedShare: Math.max(0, ...qs.map((q) => q.pausedShare)),
      },
      durationSec: round1((this.tLast - this.t0) / 1000),
    };
  }
}
