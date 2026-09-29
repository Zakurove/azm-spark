/**
 * CameraController: the camera sequence of one test side (UX spec S34), pure TS with no DOM, so the
 * whole bridge between the engine and the flow is unit tested with fixture frames.
 *
 * The flow machine (flowMachine.ts) decides which part of S34 shows (cam.setup to cam.rest); the
 * engine runner (src/engine/modes createRunner) measures. The controller keeps the two in step:
 *
 *   - It keeps a copy of the flow model: every event it sends is applied to the copy with the real
 *     flowReducer, so it always knows the state its own events lead to, and `sync` replaces the
 *     copy with the model CheckApp renders.
 *   - Frames: the setup check (setupCheck over the last second, all checks passing for 2 s) on
 *     cam.setup; the runner is fed on the parts where it measures and never while an overlay (the
 *     stop list, the check in, the skip dialog) is open, so STOP pauses scoring at once.
 *   - Runner events become flow events: calibrated (CALIBRATED), the O35 offer (CALIBRATION_STILL),
 *     the practice done (PRACTICE_DONE), go (GO), a scored attempt (ATTEMPT_OK), a quality failure
 *     (QUALITY_FAIL with its issue), a moved picture (PHONE_MOVED), arms used (ARMS_USED), the end of
 *     a rest (REST_DONE), and the finished side (SIDE_RESULT, derived numbers only).
 *   - The screen's own timers: saved 1.5 s (SAVED_NEXT), the retry restart 6 s (RETRY, CONTINUE),
 *     and the rests the runner does not run (side change, the seated minute, before a redo).
 *   - The check in triggers of 4.8 (its own SubjectLock and CheckInDetector, armed by arming.ts) and,
 *     while S43 or S45 is open over the stage, the raised hand fine signal (CameraFine) as FINE.
 *   - Cues: the runner's cues and prompts, the setup issue cues (replayed at most every 6 s), the
 *     retry fix cue, the countdown numbers; interface lines (Good, helper beside you) as notes.
 *
 * The retry budget is the flow's (RETRIES, spec 2.10): the range and side lean runners get a copy of
 * the test definition with a budget they never reach, and the flow ends the side when its own budget
 * is used. The side lean runs one side per runner, as the flow runs it (one side, then S48, then the
 * other side).
 */
import type { I18nKey } from "../../../i18n";
import { isPerson } from "../../../engine/body";
import {
  CameraFine,
  CheckInDetector,
  checkInReference,
  FINE_RULES,
  swayMeasureFor,
  type FineSignalConfig,
} from "../../../engine/checkin";
import {
  createRunner,
  TRUNK_RULES,
  TrunkControlRunner,
  type RunnerOptions,
  type RunnerPhase,
  type TestEvent,
  type TestRunner,
} from "../../../engine/modes";
import {
  setupCheck,
  setupConfig,
  type SetupFrame,
  type SetupResult,
  type Tilt,
} from "../../../engine/quality";
import { nearestCentre, posesOf, SubjectLock } from "../../../engine/subject";
import type { Frame, Landmark } from "../../../engine/types";
import { testDef } from "../../../movements/assessments";
import type { CheckCueId, CheckPosition, Side, TestDef, TestId } from "../../../movements/types";
import { flowReducer, RETRIES, type FlowEvent, type FlowModel, type FlowState } from "../flowMachine";
import { armingFor, camPart, type CamPart } from "./arming";
import { cloneDeep } from "./cloneRunner";
import { cueClass, type CueClass, type CueRequest, type CueSeverity } from "./cues";
import { sideRecord, sideResultEvent } from "./payload";
import { camTiming, type CamTiming } from "./timing";
import {
  setupChips,
  SETUP_ISSUE_ORDER,
  setupIssueCue,
  retryIssueOf,
  fixOf,
  type AttemptDot,
  type ChipId,
  type ChipState,
  type PhaseWord,
  type ScreenSetupIssue,
} from "./view";

/* ================================================================ types */

export type CamStateKind =
  | "cam.setup"
  | "cam.calibrate"
  | "cam.practice"
  | "cam.countdown"
  | "cam.measure"
  | "cam.saved"
  | "cam.retry"
  | "cam.rest";

/** What the screen knows each frame besides the picture. */
export interface CamEnv {
  /** The phone tilt from the orientation sensor, or null without a reading. */
  tilt: Tilt | null;
  /** A phone held sideways: the test pauses (4.2). */
  landscape: boolean;
  /** A finger is on the screen: the retry restart waits (S34i). */
  touching: boolean;
  /** When the cue playing now is expected to end (ms), or 0 (the 4.8 grace). */
  cueEndsAt: number;
}

export const IDLE_ENV: CamEnv = { tilt: null, landscape: false, touching: false, cueEndsAt: 0 };

/** An interface line shown in the caption card (never a cue of the check data). */
export interface CamNote {
  key: I18nKey;
  severity: CueSeverity;
  /** Cleared after this long (the "Good" line of a fixed issue). */
  clearAfterMs?: number;
  /** Also said with a voice on the device (a line the spec asks to hear that has no recording). */
  speak?: boolean;
}

export interface CamOutput {
  events: FlowEvent[];
  cues: CueRequest[];
  notes: CamNote[];
}

/** Why scoring is paused (the paused HUD state): another person, the phone, or nobody seen. */
export type PausedWhy = "person" | "phone" | "lost" | null;

export interface SetupView {
  issues: ScreenSetupIssue[];
  chips: Record<ChipId, ChipState>;
  ok: boolean;
  /** 0 to 1 over the 2 s hold. */
  hold: number;
  waitedSec: number;
  helperSeen: boolean;
  justFixed: boolean;
  noPersonSec: number;
}

export interface CamSnapshot {
  kind: CamStateKind | null;
  part: CamPart;
  runnerPhase: RunnerPhase | null;
  setup: SetupView;
  /** Calibration stillness, 0 to 1. */
  calibrateHold: number;
  /** A calibration round passed without a still window (O35 offer). */
  calibrationOffer: boolean;
  /** Range test: the live angle (shown only behind the degrees flag, O3). */
  live: number | null;
  /** Range test hold ring, 0 to 1, and whether the hold registered. */
  hold: number;
  holdDone: boolean;
  phaseWord: PhaseWord | null;
  /** Timed tests. */
  count: number;
  trialRemaining: number | null;
  countdown: number | "go" | null;
  timeUp: boolean;
  /** Side lean. */
  leanDirection: "left" | "right";
  dots: AttemptDot[];
  attemptN: number;
  practice: boolean;
  paused: PausedWhy;
  rest: { remaining: number; total: number } | null;
  retry: { remaining: number; total: number; counting: boolean } | null;
}

/** The test side the controller runs, from the flow data. */
export interface CamTest {
  testId: TestId;
  i: number;
  sideIndex: number;
  side: "left" | "right" | "none";
  variant: string | null;
  weaker: Side | null;
  firstCheck: boolean;
  /** The arm curl is done with a load (the practice check, S29, follows the practice). */
  withLoad: boolean;
  pushHand?: Side;
  limbLossArm?: Side;
  setting: "booth" | "home";
  position: CheckPosition;
  checkIn: { raiseAllowed: boolean; noArmSignal: boolean; fineZoneSide: Side | null } | null;
  /** The first test side of the check (intro.howToStop is shown once there). */
  first: boolean;
}

/** The test side of a flow state, from its data (null outside the camera states). */
export function camTestOf(m: FlowModel): CamTest | null {
  const s = m.state as FlowState & { i?: number; side?: number };
  if (typeof s.i !== "number" || typeof s.side !== "number") return null;
  const run = m.data.tests[s.i];
  const item = run?.sides[s.side];
  if (!run || !item) return null;
  const d = m.data;
  const ctx = d.env?.ctx ?? null;
  const support = ctx?.support ?? "none";
  const pushHand = (item as { pushHand?: Side }).pushHand;
  const limb = d.env?.setup?.limbLoss?.arm;
  return {
    testId: run.testId,
    i: s.i,
    sideIndex: s.side,
    side: item.side,
    variant: item.variant ?? null,
    weaker: support === "none" ? null : support,
    firstCheck: d.env?.firstCheck ?? true,
    withLoad:
      run.testId === "arm_curl_30s" && d.setting === "home" && (item.variant ?? "held") !== "arm_only",
    ...(pushHand ? { pushHand } : {}),
    ...(limb ? { limbLossArm: limb } : {}),
    setting: d.setting,
    position: ctx?.position ?? "chair",
    checkIn: d.checkIn,
    first: s.i === 0 && s.side === 0,
  };
}

const TIMED: readonly TestId[] = ["arm_curl_30s", "chair_stand_30s"];

/* ================================================================ still meter */

/**
 * Stillness for the calibration ring (S34d): how long the shoulders and wrists have stayed within
 * a small share of the trunk length. It only draws the ring; the runner decides the calibration.
 */
class StillMeter {
  private anchor: { x: number; y: number }[] | null = null;
  private since: number | null = null;

  reset(): void {
    this.anchor = null;
    this.since = null;
  }

  push(t: number, lm: Landmark[] | null, aspect: number | undefined): void {
    if (!lm || !isPerson(lm)) {
      this.reset();
      return;
    }
    const a = aspect ?? 1;
    const pts = [11, 12, 15, 16].map((k) => ({ x: lm[k].x * a, y: lm[k].y }));
    const hip = { x: ((lm[23].x + lm[24].x) / 2) * a, y: (lm[23].y + lm[24].y) / 2 };
    const sh = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const trunk = Math.max(0.05, Math.hypot(sh.x - hip.x, sh.y - hip.y));
    const moved =
      !this.anchor ||
      pts.some((p, k) => Math.hypot(p.x - this.anchor![k].x, p.y - this.anchor![k].y) > 0.06 * trunk);
    if (moved) {
      this.anchor = pts;
      this.since = t;
    }
  }

  progress(t: number, needSec: number): number {
    if (this.since === null) return 0;
    return Math.max(0, Math.min(1, (t - this.since) / (needSec * 1000)));
  }
}

/* ================================================================ controller */

const EMPTY_SETUP: SetupView = {
  issues: [],
  chips: setupChips([], null),
  ok: false,
  hold: 0,
  waitedSec: 0,
  helperSeen: false,
  justFixed: false,
  noPersonSec: 0,
};

type Asking = "calibration" | "practice_check" | "repeat" | "pushed" | "contact" | null;

export interface ControllerOptions {
  timing?: CamTiming;
}

export class CameraController {
  readonly test: CamTest;
  readonly def: TestDef;
  private readonly timing: CamTiming;
  private model: FlowModel;
  private out: CamOutput = { events: [], cues: [], notes: [] };
  private enteredKey = "";
  private stateSince = 0;

  // Runner.
  private runner: TestRunner | null = null;
  private runnerPhase: RunnerPhase | null = null;
  private snapshotRunner: TestRunner | null = null;
  private asking: Asking = null;
  private posted = false;
  private lastScoredValid = false;

  // Subject and check in (the screen's own, 4.8).
  private readonly lock = new SubjectLock();
  private readonly detector: CheckInDetector;
  private readonly fine: CameraFine | null;
  private fineArmed = false;
  private lostWhileArmed = false;
  private practiceSkipped = false;
  private lockPending = true;
  private refPending = false;
  private lastLm: Landmark[] | null = null;
  private lastPoses: Landmark[][] = [];
  private paused: PausedWhy = null;
  private tiltRef: Tilt | null = null;
  private readonly still = new StillMeter();

  // Setup check.
  private setupFrames: SetupFrame[] = [];
  private setupEvalAt = -Infinity;
  private setupOkSince: number | null = null;
  private setupSent = false;
  private setupView: SetupView = EMPTY_SETUP;
  private lastIssue: ScreenSetupIssue | null = null;
  private lastIssueCueAt = -Infinity;
  private fixedUntil = 0;
  private noPersonSince: number | null = null;
  private said = new Set<string>();

  // Timers the screen runs.
  private savedUntil: number | null = null;
  private retryUntil: number | null = null;
  private rest: { until: number; total: number } | null = null;
  private runnerRest: { remaining: number; total: number } | null = null;

  // View data.
  private live: number | null = null;
  private holdStart: number | null = null;
  private holdAnchor: number | null = null;
  private phaseWord: PhaseWord | null = null;
  private count = 0;
  private trialRemaining: number | null = null;
  private countdown: number | "go" | null = null;
  private goAt: number | null = null;
  private endCueAt: number | null = null;
  private standEndedAt: number | null = null;
  private leanDirection: "left" | "right";
  private dots: AttemptDot[];
  private practiceNow = false;
  private recent = new Map<string, number>();
  private lastT = 0;

  constructor(model: FlowModel, test: CamTest, opts: ControllerOptions = {}) {
    this.model = model;
    this.test = test;
    this.def = testDef(test.testId);
    this.timing = opts.timing ?? camTiming();
    this.detector = new CheckInDetector({}, { swayMeasure: swayMeasureFor(test.testId) });
    this.leanDirection = test.side === "left" ? "left" : "right";
    this.dots = Array.from({ length: this.def.attempts }, () => "pending" as AttemptDot);
    const ci = test.checkIn;
    const raise = ci ? ci.raiseAllowed && !ci.noArmSignal : true;
    const cfg: FineSignalConfig = {
      setting: test.setting,
      // The fine zone ships with the answer zones (phase 2, never the booth build, 4.7).
      fineZone: false,
      fineZoneSide: ci?.fineZoneSide ?? null,
      zoneHoldSec: FINE_RULES.zoneHoldSec,
      raiseAllowed: raise,
      noArmSignal: ci?.noArmSignal ?? false,
      speech: false,
      limbLossArm: test.limbLossArm ?? null,
    };
    this.fine = raise ? new CameraFine(cfg, null) : null;
  }

  /* -------------------------------------------------------------- public */

  get timed(): boolean {
    return TIMED.includes(this.test.testId);
  }

  /** The flow state the controller acts on, or null when the flow has left this test side. */
  get state(): (FlowState & { kind: CamStateKind }) | null {
    const s = this.model.state as FlowState & { i?: number; side?: number };
    if (!s.kind.startsWith("cam.") || s.kind === "cam.problem") return null;
    if (s.i !== this.test.i || s.side !== this.test.sideIndex) return null;
    return s as FlowState & { kind: CamStateKind };
  }

  /** The model CheckApp renders: replaces the copy (it can only be at or past the copy). */
  sync(model: FlowModel, t: number): CamOutput {
    this.model = model;
    this.lastT = Math.max(this.lastT, t);
    this.enterIfChanged(t);
    this.timers(t);
    this.reconcile(t);
    return this.drain();
  }

  /** Time passing without a frame (loading, a slow camera): the screen's timers still run. */
  tick(t: number, env: CamEnv = IDLE_ENV): CamOutput {
    this.lastT = Math.max(this.lastT, t);
    if (this.state && this.state.kind === "cam.retry") this.retryTimer(t, env);
    this.timers(t);
    this.reconcile(t);
    return this.drain();
  }

  frame(f: Frame, env: CamEnv = IDLE_ENV, t: number = f.t): CamOutput {
    this.lastT = Math.max(this.lastT, t);
    const s = this.state;
    if (!s) return this.drain();
    const poses = posesOf(f);
    this.lastPoses = poses;
    let lm: Landmark[] | null;
    let pickPaused = false;
    let pickReason: string | null = null;
    if (this.lock.locked) {
      const pick = this.lock.pickFrame(f);
      lm = pick.lm;
      pickPaused = pick.paused;
      pickReason = pick.reason;
    } else {
      const k = nearestCentre(poses, f.aspect);
      lm = k >= 0 ? poses[k] : null;
    }
    this.lastLm = lm;
    this.still.push(t, lm, f.aspect);

    // The paused HUD (any kind): another person over the subject, the phone moved, nobody seen.
    const part = this.part();
    const scoring = part === "attempt" || part === "hold" || part === "practice";
    const phoneMoved = !!(env.tilt && this.tiltRef && tiltMoved(env.tilt, this.tiltRef));
    this.paused = !scoring
      ? null
      : phoneMoved
        ? "phone"
        : pickPaused && (pickReason === "overlap" || pickReason === "jump")
          ? "person"
          : pickPaused && pickReason === "lost"
            ? "lost"
            : null;
    if (this.paused === "phone") this.cueEvery("check_phone_still", "setup", t);

    const overlay = this.model.overlay;
    if (overlay) {
      // Scoring is paused under every overlay; the camera keeps watching for the fine signal.
      if (overlay.kind === "checkIn" || overlay.kind === "alarm") {
        // The raised hand counts from anyone in the picture (booth, O34-1), so the central person
        // stands in when the subject lock has lost the subject.
        const k = nearestCentre(poses, f.aspect);
        this.fineFrame(t, lm ?? (k >= 0 ? poses[k] : null), f.aspect);
      }
      if (s.kind === "cam.retry") this.retryTimer(t, env);
      this.timers(t);
      return this.drain();
    }
    this.fineArmed = false;

    this.checkInFrame(t, lm, f.aspect, env);
    if (s.kind === "cam.setup") this.setupFrame(t, poses, f.aspect, env);
    if (s.kind === "cam.retry") this.retryTimer(t, env);
    if (this.shouldFeed(env, phoneMoved)) this.feed(f, env, t);
    this.timers(t);
    this.reconcile(t);
    return this.drain();
  }

  /**
   * The answer states over the camera (S29 practice check, S47, S48): the check in keeps watching
   * with the answer zone arming of 4.8 (sway and hips drop on, no movement and left frame off), and
   * the raised hand counts as fine while S43 or S45 is open.
   */
  watch(f: Frame, t: number = f.t): CamOutput {
    this.lastT = Math.max(this.lastT, t);
    const s = this.model.state as FlowState & { i?: number; side?: number };
    if (s.i !== this.test.i || s.side !== this.test.sideIndex || this.state) return this.drain();
    const poses = posesOf(f);
    const k = nearestCentre(poses, f.aspect);
    const lm = this.lock.locked ? this.lock.pickFrame(f).lm : k >= 0 ? poses[k] : null;
    const overlay = this.model.overlay;
    if (overlay) {
      if (overlay.kind === "checkIn" || overlay.kind === "alarm")
        this.fineFrame(t, lm ?? (k >= 0 ? poses[k] : null), f.aspect);
      return this.drain();
    }
    this.fineArmed = false;
    if (this.detector.reference)
      for (const trigger of this.detector.feed(t, lm, f.aspect, {
        sway: true,
        movement: false,
        leftFrame: false,
      }))
        this.emit({ type: "TRIGGER", trigger }, t);
    return this.drain();
  }

  /**
   * Side lean only: the at the phone "Skip the practice" (spec 4.3, fatigue, P3). The runner starts
   * again without its practice leans; a calibration in progress starts again with it.
   */
  skipPractice(t: number): CamOutput {
    if (this.test.testId !== "trunk_control_seated" || this.practiceSkipped) return this.drain();
    this.practiceSkipped = true;
    const p = this.runnerPhase;
    if (
      this.runner &&
      (p === null || p === "idle" || p === "calibrating" || p === "practice" || p === "return")
    )
      this.startRunner(t);
    this.reconcile(t);
    return this.drain();
  }

  /** The tracked person's landmarks in the last frame (the skeleton of setup and calibration). */
  subject(): Landmark[] | null {
    return this.lastLm;
  }

  /** The side lean practice was skipped (the button hides). */
  get practiceWasSkipped(): boolean {
    return this.practiceSkipped;
  }

  snapshot(t: number = this.lastT): CamSnapshot {
    const s = this.state;
    const trunk = this.test.testId === "trunk_control_seated";
    const holdSec = this.def.kind === "range_test" ? (this.def as { holdSec: number }).holdSec : 0.5;
    const hold = this.holdStart === null ? 0 : Math.min(1, (t - this.holdStart) / (holdSec * 1000));
    let rest: CamSnapshot["rest"] = null;
    if (this.rest)
      rest = { remaining: Math.max(0, Math.ceil((this.rest.until - t) / 1000)), total: this.rest.total };
    else if (this.runnerRest) rest = this.runnerRest;
    let retry: CamSnapshot["retry"] = null;
    if (s?.kind === "cam.retry") {
      const total = this.timing.retrySec;
      retry =
        this.retryUntil === null
          ? { remaining: total, total, counting: false }
          : { remaining: Math.max(0, Math.ceil((this.retryUntil - t) / 1000)), total, counting: true };
    }
    const saved = this.dots.filter((d) => d === "saved").length;
    return {
      kind: s?.kind ?? null,
      part: this.part(),
      runnerPhase: this.runnerPhase,
      setup: { ...this.setupView, justFixed: t < this.fixedUntil },
      calibrateHold: this.still.progress(t, trunk ? 3 : 1),
      calibrationOffer: s?.kind === "cam.calibrate" && (s as { offer: boolean }).offer,
      live: this.live,
      hold,
      holdDone: hold >= 1,
      phaseWord: this.phaseWord,
      count: this.count,
      trialRemaining: this.trialRemaining,
      countdown: this.countdown,
      timeUp: this.endCueAt !== null,
      leanDirection: this.leanDirection,
      dots: [...this.dots],
      attemptN: Math.min(this.def.attempts, saved + 1),
      practice: this.practiceNow,
      paused: this.paused,
      rest,
      retry,
    };
  }

  /** The screen was left for good (another test, the results): nothing is kept. */
  dispose(): void {
    this.runner = null;
    this.snapshotRunner = null;
  }

  /* -------------------------------------------------------------- flow */

  private emit(e: FlowEvent, t: number): void {
    this.out.events.push(e);
    this.model = flowReducer(this.model, { ...e, now: Date.now() });
    this.enterIfChanged(t);
  }

  private drain(): CamOutput {
    const o = this.out;
    this.out = { events: [], cues: [], notes: [] };
    return o;
  }

  private stateKey(s: FlowState): string {
    const x = s as FlowState & { offer?: boolean; purpose?: string; issue?: string; exhausted?: boolean };
    return [s.kind, x.offer, x.purpose, x.issue, x.exhausted].join(":");
  }

  private enterIfChanged(t: number): void {
    const s = this.state;
    const key = s ? this.stateKey(s) : "";
    if (key === this.enteredKey) return;
    this.enteredKey = key;
    this.stateSince = t;
    if (s) this.onEnter(s, t);
  }

  private part(): CamPart {
    const s = this.state;
    const holding = this.phaseWord === "hold" || this.phaseWord === "pause";
    return camPart(s?.kind ?? "", this.runnerPhase, holding);
  }

  private onEnter(s: FlowState & { kind: CamStateKind }, t: number): void {
    switch (s.kind) {
      case "cam.setup":
        this.setupFrames = [];
        this.setupOkSince = null;
        this.setupSent = false;
        this.setupView = { ...EMPTY_SETUP, chips: setupChips([], null) };
        this.lastIssue = null;
        this.lastIssueCueAt = -Infinity;
        this.noPersonSince = null;
        this.practiceNow = false;
        // Back after a camera stop or a check in: the attempt that was running starts again (S34 Er).
        if (this.midAttempt()) this.discardAttempt(t);
        // The arm curl practice check (S29) was answered at the phone: the flow says which answer.
        if (this.asking === "practice_check" && this.runner && "setPracticeCheck" in this.runner) {
          const ok = this.model.data.run.practiced;
          this.asking = null;
          this.handle(
            (
              this.runner as unknown as { setPracticeCheck(ok: boolean, t: number): TestEvent[] }
            ).setPracticeCheck(ok, t),
            t,
          );
        }
        break;
      case "cam.calibrate":
        if ((s as { offer: boolean }).offer) break;
        if (!this.runner) this.startRunner(t);
        else if (this.asking === "calibration") {
          this.asking = null;
          const r = this.runner as unknown as { retryCalibration?(t: number): TestEvent[] };
          if (r.retryCalibration) this.handle(r.retryCalibration(t), t);
        }
        break;
      case "cam.practice":
        if (!this.runner) this.startRunner(t);
        break;
      case "cam.saved":
        this.savedUntil = t + this.timing.savedSec * 1000;
        this.phaseWord = "saved";
        break;
      case "cam.retry": {
        this.retryUntil = t + this.timing.retrySec * 1000;
        const x = s as { issue: string };
        const fix = fixOf(x.issue, this.test.testId, this.test.side, this.test.weaker);
        this.pushCue(fix.cue, "retry", t);
        break;
      }
      case "cam.rest": {
        const purpose = (s as { purpose: string }).purpose;
        this.phaseWord = "rest";
        if (
          purpose === "retryRest" &&
          this.asking === "repeat" &&
          this.runner &&
          "setRepeat" in this.runner
        ) {
          this.asking = null;
          this.handle(
            (this.runner as unknown as { setRepeat(r: boolean, t: number): TestEvent[] }).setRepeat(true, t),
            t,
          );
        }
        if (purpose === "sideChange") {
          const sec = this.timing.sideChangeSec[this.test.testId] ?? 20;
          this.startRest(sec, t);
          this.pushCue(
            this.test.testId === "arm_curl_30s" ? "check_rest_minute" : "check_rest_short",
            "runner",
            t,
          );
        }
        if (purpose === "seated") {
          if (this.asking === "pushed" && this.runner && "setPushed" in this.runner) {
            // The pushed question (S48) was answered no: a quality failure of the trial (spec 4.4).
            this.asking = null;
            this.handle(
              (this.runner as unknown as { setPushed(p: boolean, t: number): TestEvent[] }).setPushed(
                false,
                t,
              ),
              t,
            );
            this.post(t);
          }
          this.startRest(this.timing.seatedSec, t);
          this.pushCue("check_sit_minute", "runner", t);
        }
        if (purpose === "redo") {
          this.discardAttempt(t);
          this.startRest(this.timed ? this.timing.redoSec.timed : this.timing.redoSec.range, t);
          this.pushCue(this.timed ? "check_rest_minute" : "check_rest_short", "runner", t);
        }
        break;
      }
      default:
        break;
    }
  }

  /** The next flow event the runner's progress calls for, applied until none is due. */
  private reconcile(t: number): void {
    for (let guard = 0; guard < 8; guard++) {
      const e = this.due(t);
      if (!e) return;
      this.emit(e, t);
    }
  }

  private due(_t: number): FlowEvent | null {
    const s = this.state;
    if (!s || this.model.overlay) return null;
    const p = this.runnerPhase;
    const id = this.test.testId;
    switch (s.kind) {
      case "cam.setup":
        // A timed test after its practice runs its own setup check and countdown (spec 4.2).
        if (this.timed && this.runner && (p === "ready" || p === "attempt")) return { type: "SETUP_OK" };
        return null;
      case "cam.calibrate": {
        if ((s as { offer: boolean }).offer || !this.runner) return null;
        if (this.asking === "calibration") return { type: "CALIBRATION_STILL" };
        if (this.runner.done && !this.posted) return { type: "CALIBRATION_STILL" };
        if (p && p !== "calibrating" && p !== "idle" && p !== "ask" && p !== "done")
          return { type: "CALIBRATED" };
        return null;
      }
      case "cam.practice":
        if (!this.runner) return null;
        if (id === "arm_curl_30s") {
          if (this.asking === "practice_check") return { type: "PRACTICE_DONE", withLoad: true };
          if (p === "ready" || p === "attempt") return { type: "PRACTICE_DONE", withLoad: false };
          return null;
        }
        if (id === "chair_stand_30s")
          return p === "rest" || p === "setup" || p === "ready" || p === "attempt"
            ? { type: "PRACTICE_DONE" }
            : null;
        return p === "attempt" || p === "return" ? { type: "PRACTICE_DONE" } : null;
      case "cam.countdown":
        return p === "attempt" ? { type: "GO" } : null;
      case "cam.rest": {
        const purpose = (s as { purpose: string }).purpose;
        if (purpose === "attempt") return p === "attempt" || p === "practice" ? { type: "REST_DONE" } : null;
        if (purpose === "practice")
          return p === "setup" || p === "ready" || p === "attempt" ? { type: "REST_DONE" } : null;
        if (purpose === "retryRest")
          return p && p !== "rest" && p !== "ask" && p !== "idle" ? { type: "REST_DONE" } : null;
        return null;
      }
      default:
        return null;
    }
  }

  /* -------------------------------------------------------------- timers */

  private startRest(sec: number, t: number): void {
    this.rest = { until: t + sec * 1000, total: sec };
  }

  private retryTimer(t: number, env: CamEnv): void {
    const counting = !this.model.overlay && !env.touching;
    if (!counting) this.retryUntil = null;
    else if (this.retryUntil === null) this.retryUntil = t + this.timing.retrySec * 1000;
  }

  private timers(t: number): void {
    const s = this.state;
    if (!s) return;
    if (this.countdown === "go" && this.goAt !== null && t - this.goAt > 1000) this.countdown = null;
    if (this.model.overlay) return;
    if (s.kind === "cam.saved" && this.savedUntil !== null && t >= this.savedUntil) {
      this.savedUntil = null;
      this.emit({ type: "SAVED_NEXT" }, t);
      return;
    }
    if (s.kind === "cam.retry" && this.retryUntil !== null && t >= this.retryUntil) {
      this.retryUntil = null;
      const exhausted = (s as { exhausted: boolean }).exhausted;
      if (exhausted) {
        // The flow records the side as not measured today (quality); the runner is set aside.
        this.runner = null;
        this.emit({ type: "CONTINUE" }, t);
      } else this.emit({ type: "RETRY" }, t);
      return;
    }
    if (s.kind === "cam.rest" && this.rest && t >= this.rest.until) {
      const purpose = (s as { purpose: string }).purpose;
      this.rest = null;
      if (purpose === "seated") this.post(t);
      if (purpose === "sideChange") this.pushCue(this.sideCue(), "runner", t);
      this.emit({ type: "REST_DONE" }, t);
    }
  }

  private sideCue(): CheckCueId {
    const { testId, side, weaker } = this.test;
    if (testId === "arm_curl_30s")
      return side === "left" ? "check_left_side_to_phone" : "check_right_side_to_phone";
    if (testId === "shoulder_abduction") return side === "left" ? "check_left_arm" : "check_right_arm";
    void weaker;
    return "check_ready";
  }

  /* -------------------------------------------------------------- runner */

  private runnerOptions(): RunnerOptions {
    const t = this.test;
    const o: RunnerOptions = { ...this.timing.runner, intro: t.sideIndex === 0, firstCheck: t.firstCheck };
    if (t.testId === "trunk_control_seated" && t.side !== "none") o.sides = [t.side];
    if (t.testId === "trunk_control_seated" && this.practiceSkipped) o.skipPractice = true;
    if (t.testId === "arm_curl_30s") {
      o.variant = (t.variant ?? "held") as RunnerOptions["variant"];
      o.askPracticeCheck = t.withLoad;
      o.weakerSide = t.weaker;
    }
    if (t.testId === "chair_stand_30s") {
      o.variant = (t.variant ?? "standard") as RunnerOptions["variant"];
      o.weakerSide = t.weaker;
      if (t.pushHand) o.pushHand = t.pushHand;
      if (t.limbLossArm) o.limbLossArm = t.limbLossArm;
    }
    return o;
  }

  private startRunner(t: number): void {
    // SPEC-GAP: flow-retry-budget. The flow counts the quality retries of a side (RETRIES, map 2.10);
    // the range and side lean runners get a budget they never reach, so the two never disagree.
    const def = "maxRetries" in this.def ? ({ ...this.def, maxRetries: 99 } as TestDef) : this.def;
    this.runner = createRunner(def, this.test.side, this.runnerOptions());
    this.runnerPhase = null;
    this.asking = null;
    this.posted = false;
    this.lockPending = true;
    this.handle(this.runner.start(t), t);
  }

  private shouldFeed(env: CamEnv, phoneMoved: boolean): boolean {
    const s = this.state;
    if (!s || !this.runner || this.runner.done || env.landscape) return false;
    const part = this.part();
    // SPEC-GAP: phone-moved-sensor. A phone tilted more than 5 degrees from where it was at the
    // calibration pauses scoring (map 2.12); the engine's own picture shift check discards and
    // repeats the attempt when the picture moved.
    if (phoneMoved && (part === "attempt" || part === "practice" || part === "hold")) return false;
    switch (s.kind) {
      case "cam.setup":
        return this.timed;
      case "cam.retry":
        return false;
      case "cam.rest": {
        const purpose = (s as { purpose: string }).purpose;
        if (purpose === "sideChange" || purpose === "redo") return false;
        if (purpose === "seated") return this.test.testId === "chair_stand_30s" && !this.posted;
        return true;
      }
      default:
        return true;
    }
  }

  private feed(f: Frame, env: CamEnv, t: number): void {
    const runner = this.runner!;
    if (this.lockPending && (this.runnerPhase === "calibrating" || this.runnerPhase === null)) {
      if (this.lock.lock(this.lastPoses, f.aspect)) this.lockPending = false;
    }
    this.handle(runner.feed(f, { rollDeg: env.tilt ? env.tilt.rollDeg : null }), t);
    if (this.refPending && this.lastLm) {
      this.detector.setReference(checkInReference(this.lastLm, f.aspect));
      this.tiltRef = env.tilt;
      this.refPending = false;
    }
  }

  private handle(events: TestEvent[], t: number): void {
    for (const e of events) {
      switch (e.kind) {
        case "cue":
          this.onCue(e.cue, t);
          break;
        case "prompt":
          this.pushCue(e.cue, "runner", t, false);
          break;
        case "live":
          this.onLive(e.value, t);
          break;
        case "rep":
          if (this.endCueAt === null) this.count = e.count;
          break;
        case "time":
          this.onTime(e.remainingSec, t);
          break;
        case "phase":
          this.onPhase(e.phase, e.side);
          break;
        case "attempt":
          this.onAttempt(e, t);
          break;
        case "ask":
          this.onAsk(e.ask, t);
          break;
        case "done":
          this.onDone(t);
          break;
        default:
          break;
      }
    }
  }

  private onCue(cue: CheckCueId, t: number): void {
    switch (cue) {
      case "test_abd_raise":
        this.phaseWord = "raise";
        this.holdStart = null;
        break;
      case "test_abd_hold":
        this.phaseWord = "hold";
        break;
      case "test_abd_lower":
        this.phaseWord = "lower";
        break;
      case "test_trunk_lean_left":
        this.leanDirection = "left";
        this.phaseWord = "leanLeft";
        break;
      case "test_trunk_lean_right":
        this.leanDirection = "right";
        this.phaseWord = "leanRight";
        break;
      case "test_trunk_pause":
        this.phaseWord = "pause";
        break;
      case "test_trunk_return":
        this.phaseWord = "return";
        break;
      case "check_go":
        this.goAt = t;
        this.countdown = "go";
        this.count = 0;
        this.phaseWord = "go";
        break;
      case "check_time_up_curl":
      case "check_time_up_stand":
        if (this.endCueAt === null) {
          this.endCueAt = t;
          this.phaseWord = "timeUp";
          if (cue === "check_time_up_stand") this.standEndedAt = t;
        }
        break;
      default:
        break;
    }
    this.pushCue(cue, "runner", t);
  }

  private onLive(value: number, t: number): void {
    this.live = value;
    const lifted = value >= 30;
    if (!lifted) {
      this.holdStart = null;
      this.holdAnchor = null;
      return;
    }
    if (this.holdAnchor === null || Math.abs(value - this.holdAnchor) > 4) {
      this.holdAnchor = value;
      this.holdStart = t;
    }
  }

  private onTime(remaining: number, t: number): void {
    const p = this.runnerPhase;
    if (p === "ready") {
      this.countdown = remaining;
      this.phaseWord = "ready";
      if (remaining >= 1 && remaining <= 3) this.pushCue(`count_${remaining}`, "runner", t, true, 900);
    } else if (p === "attempt") {
      this.trialRemaining = remaining;
    } else if (p === "rest") {
      const total = Math.max(remaining, this.runnerRest?.total ?? 0);
      this.runnerRest = { remaining, total };
    }
  }

  private onPhase(phase: RunnerPhase, side: string | undefined): void {
    const before = this.runnerPhase;
    this.runnerPhase = phase;
    if (phase !== "rest") this.runnerRest = null;
    if (phase === "calibrating") {
      this.lockPending = true;
      this.phaseWord = this.test.testId === "trunk_control_seated" ? "upright" : "still";
      this.practiceNow = false;
    }
    if (before === "calibrating" && phase !== "ask" && phase !== "done") this.refPending = true;
    if (phase === "practice") this.practiceNow = true;
    if (phase === "attempt") {
      this.practiceNow = false;
      this.live = null;
      this.holdStart = null;
      if (this.timed) this.trialRemaining = 30;
    }
    if (phase === "practice" || phase === "attempt") {
      if (side === "left" || side === "right") this.leanDirection = side;
      if (this.test.testId === "trunk_control_seated")
        this.phaseWord = this.leanDirection === "left" ? "leanLeft" : "leanRight";
      if (this.def.kind === "range_test") this.phaseWord = "raise";
    }
    if (phase === "return") this.phaseWord = "return";
    if ((phase === "rest" || phase === "recentre") && this.test.testId === "trunk_control_seated")
      this.phaseWord = "centred";
    if (phase === "rest" && this.def.kind === "range_test") this.phaseWord = "rest";
    if (phase === "ready") this.phaseWord = "ready";
    if (phase === "settle") this.phaseWord = "timeUp";
    // A copy of the range and side lean runners at every rest: a discarded attempt starts again here.
    if ((phase === "rest" || phase === "recentre") && !this.timed && this.runner)
      this.snapshotRunner = cloneDeep(this.runner);
  }

  private onAttempt(e: Extract<TestEvent, { kind: "attempt" }>, t: number): void {
    const s = this.state;
    if (e.outcome === "practice") return;
    if (e.outcome === "retry") {
      // A practice lift or lean with the wrong arm or side is repeated by the runner (no retry used).
      if (e.attempt === 0 || s?.kind === "cam.practice") return;
      if (e.attempt >= 1 && e.attempt <= this.dots.length) this.dots[e.attempt - 1] = "retry";
      if (e.reasons.includes("camera_moved")) {
        // Map 2.12: a moved picture discards the attempt without using a retry (the range test sets
        // up and calibrates again); a timed trial is repeated once as a quality failure.
        if (this.def.kind === "range_test") this.emit({ type: "PHONE_MOVED" }, t);
        else this.emit({ type: "QUALITY_FAIL", issue: "phone_moved" }, t);
        return;
      }
      this.emit({ type: "QUALITY_FAIL", issue: retryIssueOf(e.reasons) }, t);
      return;
    }
    // A scored attempt, valid or invalid: stored and counted (spec 4.0).
    if (e.attempt >= 1 && e.attempt <= this.dots.length) this.dots[e.attempt - 1] = "saved";
    this.lastScoredValid = true;
    if (this.runner?.done) this.post(t);
    this.emit({ type: "ATTEMPT_OK" }, t);
  }

  private onAsk(ask: string, t: number): void {
    switch (ask) {
      case "calibration":
        this.asking = "calibration";
        break;
      case "practice_check":
        this.asking = "practice_check";
        break;
      case "repeat":
        this.asking = "repeat";
        break;
      case "pushed":
        this.asking = "pushed";
        this.emit({ type: "ARMS_USED" }, t);
        break;
      case "contact":
        this.asking = "contact";
        break;
      default:
        break;
    }
  }

  private onDone(t: number): void {
    // The chair stand's result is ready once the person sat down after the end cue (O34-6 (5)).
    if (this.test.testId === "chair_stand_30s" && this.lastScoredValid && !this.posted) this.post(t);
  }

  /** Sends the side's result once (SIDE_RESULT): derived numbers only. */
  private post(t: number): void {
    if (this.posted || !this.runner) return;
    const res = this.runner.finish(t);
    const r = res.results.find((x) => x.side === this.test.side) ?? res.results[0];
    if (!r) return;
    this.posted = true;
    const run = this.model.data.tests[this.test.i];
    const item = run?.sides[this.test.sideIndex];
    if (!item) return;
    const extra: Record<string, string> = {};
    // SPEC-GAP: curl-load-object. The load chosen on S30 is not in the flow data yet; the booth runs
    // arm_only, which carries no load.
    if (this.test.testId === "arm_curl_30s" && (item.variant ?? "held") === "arm_only")
      extra.loadObject = "none";
    this.emit(sideResultEvent(sideRecord(r, item, this.model.data.device, extra)), t);
  }

  private midAttempt(): boolean {
    const p = this.runnerPhase;
    return !!this.runner && !this.runner.done && (p === "attempt" || p === "practice" || p === "return");
  }

  /**
   * Discards the attempt in progress: the range and side lean runners go back to their copy from the
   * last rest (the same attempt number starts again); a timed runner starts again from its
   * calibration, since its single trial has no earlier attempt to keep.
   */
  private discardAttempt(t: number): void {
    if (!this.midAttempt()) return;
    const n = this.dots.findIndex((d) => d !== "saved");
    if (n >= 0) this.dots[n] = "pending";
    this.live = null;
    this.holdStart = null;
    if (!this.timed && this.snapshotRunner) {
      this.runner = cloneDeep(this.snapshotRunner);
      this.runnerPhase = this.runner.phase;
      return;
    }
    if (this.timed) {
      this.count = 0;
      this.trialRemaining = null;
      this.goAt = null;
      this.endCueAt = null;
      this.startRunner(t);
    }
  }

  /* -------------------------------------------------------------- setup check */

  private setupFrame(t: number, poses: Landmark[][], aspect: number | undefined, env: CamEnv): void {
    const win = this.timing.setupWindowSec * 1000;
    this.setupFrames.push({ t, poses, aspect });
    while (this.setupFrames.length > 1 && this.setupFrames[0].t < t - win) this.setupFrames.shift();
    if (t - this.setupEvalAt < 150) return;
    this.setupEvalAt = t;
    const { testId, side, weaker } = this.test;
    let cfg = { ...setupConfig(this.def, side), weaker };
    const extra: ScreenSetupIssue[] = [];
    const hipsHidden = hipsHiddenShare(this.setupFrames) > 0.5;
    if (hipsHidden && testId === "shoulder_abduction" && this.test.position === "wheelchair") {
      // Map 2.9: an arm raise with the hips hidden by the wheelchair needs the gravity reference, so
      // the phone's orientation; without a reading the setup asks for motion access.
      if (env.tilt) cfg = { ...cfg, framing: cfg.framing.filter((k) => k !== 23 && k !== 24) };
      else extra.push("motion");
    } else if (hipsHidden && (testId === "shoulder_abduction" || testId === "chair_stand_30s")) {
      // P4 (5): hips hidden on a chair means something stands between the person and the phone.
      extra.push("blocked");
    }
    const res: SetupResult = setupCheck(this.setupFrames, cfg, { tilt: env.tilt });
    const issues = orderIssues([...res.issues, ...extra]);
    const ok = issues.length === 0 && !env.landscape && this.setupFrames.length > 1;
    if (ok) this.setupOkSince ??= t;
    else this.setupOkSince = null;
    const hold =
      this.setupOkSince === null
        ? 0
        : Math.min(1, (t - this.setupOkSince) / (this.timing.setupHoldSec * 1000));

    // Captions: the first issue's cue (at most every 6 s while it stays), Good when it clears.
    const first = env.landscape ? null : (issues[0] ?? null);
    if (first !== this.lastIssue) {
      if (first === null && this.lastIssue !== null) {
        this.fixedUntil = t + this.timing.fixedSec * 1000;
        this.out.notes.push({
          key: "assessment.setup.fixed",
          severity: "info",
          clearAfterMs: this.timing.fixedSec * 1000,
        });
      }
      this.lastIssue = first;
      this.lastIssueCueAt = -Infinity;
    }
    if (first && t - this.lastIssueCueAt >= this.timing.cueRepeatSec * 1000) {
      this.lastIssueCueAt = t;
      const cue = setupIssueCue(first, testId, side, weaker, res.cue);
      if (cue) this.pushCue(cue, "setup", t, true, undefined, true);
      else if (first === "motion") this.note("assessment.tips.wheelchair", "warn");
    }
    if (first === "no_person") this.noPersonSince ??= t;
    else this.noPersonSince = null;
    const noPersonSec = this.noPersonSince === null ? 0 : (t - this.noPersonSince) / 1000;
    if (noPersonSec >= this.timing.stillNoOneSec) this.noteOnce("assessment.setup.stillNoOne", "warn");
    const people = poses.filter((p) => isPerson(p)).length;
    const helperSeen = this.setupView.helperSeen || (people >= 2 && !issues.includes("second_person"));
    if (helperSeen && !this.setupView.helperSeen) this.noteOnce("assessment.setup.helperOk", "info");
    if (!env.tilt) this.noteOnce("assessment.camera.motionOff", "info");
    this.setupView = {
      issues,
      chips: setupChips(issues, env.tilt),
      ok,
      hold,
      waitedSec: (t - this.stateSince) / 1000,
      helperSeen,
      justFixed: t < this.fixedUntil,
      noPersonSec,
    };
    if (hold >= 1 && !this.setupSent) {
      // A timed test after its practice waits for the runner's own setup check and countdown.
      const waitRunner = this.timed && !!this.runner && this.model.data.run.practiced;
      if (!waitRunner) {
        this.setupSent = true;
        // SPEC-GAP: how-to-stop-booth. B2 gives the booth its own line (intro.howToStopBooth), which
        // the copy files do not have yet; the home line is said at the booth until it lands.
        if (this.test.first) this.noteOnce("assessment.intro.howToStop", "info", true);
        this.emit({ type: "SETUP_OK" }, t);
      }
    }
  }

  /* -------------------------------------------------------------- check in */

  private checkInFrame(t: number, lm: Landmark[] | null, aspect: number | undefined, env: CamEnv): void {
    if (!this.detector.reference) return;
    const trunk = this.runner instanceof TrunkControlRunner ? this.runner : null;
    const leanSwayDeg =
      trunk && this.test.side !== "none"
        ? trunk.abortLimit(this.test.side) + TRUNK_RULES.swayMarginDeg
        : undefined;
    const opts = armingFor({
      part: this.part(),
      testId: this.test.testId,
      now: t,
      cueEndsAt: env.cueEndsAt,
      goAt: this.goAt,
      endCueAt: this.endCueAt,
      standEndedAt: this.standEndedAt,
      ...(leanSwayDeg !== undefined ? { leanSwayDeg } : {}),
      graceSec: this.timing.cueGraceSec,
      standLeftFrameSec: this.timing.standLeftFrameSec,
    });
    // SPEC-GAP: left-frame-carry. A person who leaves the picture during an armed part keeps the
    // left frame rule armed until they are seen again, even when the runner ends that attempt at once
    // and rests (a rest is not armed, 4.8): otherwise leaving mid attempt would never ask.
    const seen = !!lm && isPerson(lm);
    if (opts.leftFrame && !seen) this.lostWhileArmed = true;
    if (seen) this.lostWhileArmed = false;
    const feedOpts = this.lostWhileArmed ? { ...opts, leftFrame: true } : opts;
    for (const trigger of this.detector.feed(t, lm, aspect, feedOpts))
      this.emit({ type: "TRIGGER", trigger }, t);
  }

  /** While S43 or S45 is open: the raised hand held 1 s counts as «أنا بخير» (O34-1). */
  private fineFrame(t: number, lm: Landmark[] | null, aspect: number | undefined): void {
    if (!this.fine) return;
    if (!this.fineArmed) {
      this.fine.arm();
      this.fineArmed = true;
    }
    const got = this.fine.feed(t, lm, aspect, this.detector.fineBlockers());
    if (got === "raised_hand") {
      this.fineArmed = false;
      this.emit({ type: "FINE", via: "raisedHand" }, t);
    }
  }

  /* -------------------------------------------------------------- cues */

  private pushCue(
    id: string,
    source: "runner" | "setup" | "retry",
    t: number,
    speak = true,
    staleMs?: number,
    replay = false,
  ): void {
    // The same line within 3 s is said once (the runner and the retry state both name the fix).
    const last = this.recent.get(id);
    if (!replay && last !== undefined && t - last < 3000) return;
    this.recent.set(id, t);
    const cls: CueClass =
      id === "check_go" || id === "check_ten_left" || id.startsWith("check_time_up")
        ? "timer"
        : cueClass(id, source);
    // D-009: during the 30 s of a timed test the voice says only go, ten seconds left and the end
    // cue; every other line is shown, not spoken (safety and the check in still speak).
    const trial = this.timed && this.runnerPhase === "attempt" && this.endCueAt === null;
    const quiet = trial && cls !== "timer" && cls !== "safety" && cls !== "checkin";
    this.out.cues.push({ id, cls, speak: speak && !quiet, at: t, ...(staleMs ? { staleMs } : {}) });
  }

  private cueEvery(id: string, source: "setup", t: number): void {
    const last = this.recent.get(id);
    if (last !== undefined && t - last < this.timing.cueRepeatSec * 1000) return;
    this.pushCue(id, source, t, true, undefined, true);
  }

  private note(key: I18nKey, severity: CueSeverity, speak = false): void {
    this.out.notes.push({ key, severity, ...(speak ? { speak } : {}) });
  }

  private noteOnce(key: I18nKey, severity: CueSeverity, speak = false): void {
    if (this.said.has(key)) return;
    this.said.add(key);
    this.note(key, severity, speak);
  }
}

/* ================================================================ helpers */

function tiltMoved(now: Tilt, ref: Tilt): boolean {
  return Math.abs(now.rollDeg - ref.rollDeg) > 5 || Math.abs(now.pitchDeg - ref.pitchDeg) > 5;
}

/** The issues in the order of the S34c table: the first one is captioned and cued. */
function orderIssues(issues: readonly ScreenSetupIssue[]): ScreenSetupIssue[] {
  const unique = [...new Set(issues)];
  return SETUP_ISSUE_ORDER.filter((k) => unique.includes(k));
}

/** Share of frames whose central person has a hip under the minimum visibility. */
function hipsHiddenShare(frames: readonly SetupFrame[]): number {
  if (!frames.length) return 0;
  let hidden = 0;
  for (const f of frames) {
    const k = nearestCentre(f.poses, f.aspect);
    if (k < 0) continue;
    const p = f.poses[k];
    if ((p[23]?.visibility ?? 0) < 0.5 || (p[24]?.visibility ?? 0) < 0.5) hidden++;
  }
  return hidden / frames.length;
}

/** The retry budget left after the retries used (S34i: two more, one more). */
export function triesLeft(testId: TestId, used: number): number {
  return Math.max(0, RETRIES[testId] - used);
}
