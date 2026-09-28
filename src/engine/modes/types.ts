/**
 * Engine modes of the movement check (architecture section 4 as superseded by contract v2 section
 * F). Pure TS, no DOM.
 *
 * A runner measures one test from the camera: it locks onto the subject, calibrates, guides the
 * practice and the scored attempts with voice cue ids, applies the spec's validity rules and
 * returns one result per side. The UI plays the cues, shows the events and stores the results.
 *
 * Differences from the section 4 sketch, all forced by the clinical spec (movement check v1):
 *   - `feed` takes the camera Frame (every pose, the aspect), not a MetricFrame: the subject lock
 *     (spec 4.0) needs every pose, and the rules need raw landmarks (the fixed mid hip, upper arm
 *     length, the other hand, ears, nose).
 *   - `finish` returns a TestResult with one SideResult per side. A side result carries what
 *     section 4 called AttemptResult (value, unit, detail, quality, durationSec) plus the stored
 *     fields of contract v2 E (median, nValid, attempts, flags). The seated side lean alternates
 *     sides (spec 4.3), so one trunk runner measures both sides.
 *   - Events add `flag`, `checkin` (contract v2 F), `attempt` (an attempt ended), `ask` (the side
 *     lean's contact question, spec 4.3; the arm curl's practice check and repeat offer, spec 4.2;
 *     the chair stand's pushed question, spec 4.4) and `prompt` (a line shown on screen and not
 *     spoken, because the voice of a timed trial gives only go, ten seconds left and stop, spec 4.0).
 *   - The chair stand has no sides: its result and events carry the side "none".
 */
import type { CheckCueId, ReasonId, TestDef, TestId, VariantId } from "../../movements/types";
import type { CheckInTrigger } from "../checkin";
import type { QualityIssue, QualityReport } from "../quality";
import type { SubjectLock } from "../subject";
import type { Frame } from "../types";

export type TestKind = TestDef["kind"];
export type TestUnit = TestDef["unit"];
export type BodySide = "left" | "right";
export type TestSide = BodySide | "none";

/**
 * Runner phases: calibrating (arms at the sides, the upright baseline, or seated still), practice,
 * attempt (a scored attempt; the 30 s trial of a timed count), return (the side lean coming back to
 * the middle), rest, recentre (waiting for the middle before the next lean), ready (the countdown
 * before go), ask (waiting for the answer to an `ask` event), setup (the phone setup check between
 * practice and trial), done.
 */
export type RunnerPhase =
  | "idle"
  | "calibrating"
  | "practice"
  | "attempt"
  | "return"
  | "rest"
  | "recentre"
  | "ready"
  | "ask"
  | "setup"
  /** Chair stand: up to 10 s after the end cue, watching for the person seated again (O34-6 (5)). */
  | "settle"
  | "done";

/**
 * How an attempt ended.
 *   valid: scored and stored.
 *   invalid: scored and stored as invalid (a validity rule), never the best.
 *   retry: not stored and repeated (quality gate, wrong arm, wrong side).
 *   practice: the unscored practice.
 */
export type AttemptOutcome = "valid" | "invalid" | "retry" | "practice";

export type TestEvent =
  /** The live measure (range test only; the side lean shows no live number, spec 4.3). */
  | { kind: "live"; value: number; t: number; side: BodySide }
  /** A new best sustained value in this attempt (range test only). */
  | { kind: "peak"; value: number; t: number; side: BodySide }
  /** Timed count increment (timed count runners): shown on screen, never spoken (spec 4.0). */
  | { kind: "rep"; count: number; t: number; side?: TestSide }
  /** Once per whole second while a rest, countdown or trial timer runs. */
  | { kind: "time"; remainingSec: number; t: number }
  | { kind: "phase"; phase: RunnerPhase; t: number; side?: TestSide; attempt?: number }
  /** A voice cue id for the UI to play. */
  | { kind: "cue"; cue: CheckCueId; t: number }
  /**
   * A check cue line the UI shows on screen WITHOUT speaking it: during a timed trial the voice
   * gives only check_go, check_ten_left and check_time_stop (spec 4.0), so the one person and
   * visibility prompts of a paused trial are shown, not spoken.
   */
  | { kind: "prompt"; cue: CheckCueId; t: number }
  /** A flag raised in this attempt (stored, never a verdict by itself). */
  | { kind: "flag"; flag: string; t: number; side?: TestSide }
  /** A camera trigger of the check in (spec 4.0); the UI runs CheckInFlow. */
  | { kind: "checkin"; trigger: CheckInTrigger; t: number }
  /** An attempt ended. `attempt` is 0 for the practice, 1 to 3 for scored attempts. */
  | {
      kind: "attempt";
      t: number;
      side: TestSide;
      attempt: number;
      outcome: AttemptOutcome;
      value: number | null;
      censored: boolean;
      reasons: string[];
    }
  /** The UI asks the contact question for this side and answers with setContact (spec 4.3). */
  | { kind: "ask"; ask: "contact"; side: BodySide; t: number }
  /**
   * O35: a calibration round passed without a still window. The stage offers «سأحاول مرة أخرى»
   * (retryCalibration) or skip; finishing instead ends the test, not measured today (quality).
   */
  | { kind: "ask"; ask: "calibration"; side: TestSide; t: number }
  /**
   * Arm curl (spec 4.2): `practice_check` asks the load's practice check (the UI answers with
   * setPracticeCheck); `repeat` offers the one repeat after a trial that failed the quality gate
   * (the UI answers with setRepeat).
   */
  | { kind: "ask"; ask: "practice_check" | "repeat"; side: BodySide; t: number }
  /**
   * Chair stand (spec 4.4): `pushed` asks pushedAsk after arms were used (setPushed); `repeat`
   * offers the one repeat after a trial that failed the quality gate (setRepeat).
   */
  | { kind: "ask"; ask: "pushed" | "repeat"; side: "none"; t: number }
  | { kind: "done"; t: number };

export type DetailValue = number | boolean | string;
/** Stored numbers and flags of an attempt or a side. An optional landmark that was not seen stores "unknown". */
export type Detail = Record<string, DetailValue>;

export interface AttemptRecord {
  side: TestSide;
  /** 0 for the practice, 1 to 3 for scored attempts; a retry carries the index it tried to fill. */
  index: number;
  outcome: AttemptOutcome;
  /**
   * In the test unit: whole degrees (null when nothing was held for the hold time), or the whole
   * count of a timed trial.
   */
  value: number | null;
  /** Why the attempt is invalid or was retried. */
  reasons: string[];
  flags: string[];
  /**
   * The value is a lower bound: side lean aborts and armrest contact (spec 4.3), or a timed trial
   * that ended before 30.0 s.
   */
  censored: boolean;
  detail: Detail;
  quality: QualityReport;
  /** Start and end, ms. */
  t0: number;
  t1: number;
}

export interface QualitySummary {
  /** The side was measured without running out of retries. */
  ok: boolean;
  /** Attempts repeated for quality, a wrong arm or a wrong side. */
  retries: number;
  /** Every quality issue that caused a retry. */
  issues: QualityIssue[];
  /** Median fps over the attempts, null without attempts. */
  medianFps: number | null;
  /** Largest paused share of the subject lock over the attempts. */
  maxPausedShare: number;
}

export type SideStatus = "measured" | "not_measured" | "stopped";

export interface SideResult {
  testId: TestId;
  side: TestSide;
  unit: TestUnit;
  /** The test variant measured (timed counts), stored in assessment_results.variant. */
  variant?: VariantId | null;
  /** stopped: finish() came before the runner was done (STOP or skip): the UI stores no score. */
  status: SideStatus;
  /** The reason shown when not measured (spec 3.6), for example quality. */
  reason: ReasonId | null;
  /** Best valid attempt, whole degrees, or the whole count of a timed trial; null when not measured. */
  value: number | null;
  /** Median of valid attempts (range test), null otherwise. */
  median: number | null;
  nValid: number;
  /** The value is a lower bound: shown as "more than {value}" (spec 4.3). */
  censored: boolean;
  /** Scored attempts only, at most 3 (API limit, spec 4.0). */
  attempts: AttemptRecord[];
  practice: AttemptRecord[];
  /** Attempts that were repeated and not stored. */
  retried: AttemptRecord[];
  detail: Detail;
  flags: string[];
  quality: QualitySummary;
  durationSec: number;
}

export interface TestResult {
  testId: TestId;
  kind: TestKind;
  results: SideResult[];
  /** The runner reached done before finish(). */
  completed: boolean;
  durationSec: number;
}

/** Per frame input besides the camera frame. */
export interface FeedEnv {
  /**
   * Roll of the picture from level, degrees, when the device orientation is known; null or absent
   * otherwise. Convention: the true downward vertical in the pixel space picture is the vector
   * (−sin r, cos r) (y grows downward). The app converts the device reading (quality.ts phoneTilt)
   * taking the camera facing and any mirroring into account. Used by the gravity reference of the
   * arm raise (spec 4.1) and the side lean's roll correction (spec 4.3).
   */
  rollDeg?: number | null;
}

export interface RunnerOptions {
  /**
   * The picture is mirrored (some front cameras). The model then labels the person's left side as
   * right, so the runner swaps the labels. Without it, a mirrored picture reads as the other arm or
   * the other side and the attempt is retried (spec 4.0 side labelling).
   */
  // SPEC-GAP: mirror-flag. The landmarks alone cannot tell a mirrored picture from a person moving
  // the other arm or leaning the other way (the model's labels swap with the picture), so the app
  // must pass what it knows about its camera stream; otherwise every attempt is retried.
  mirrored?: boolean;
  /**
   * A subject lock to use (the UI can watch it); a new one otherwise. The runner locks it again at
   * every calibration (and the side lean at its upright baseline), whatever it held before.
   */
  subject?: SubjectLock;
  /** Rest between attempts, seconds (default: the lower end of the test's restSec.betweenAttempts). */
  restSec?: number;
  /** Play the test's opening cue at start (default true). */
  intro?: boolean;
  /** Side lean: this is the first check of the series (default true: the 30 degree abort applies). */
  firstCheck?: boolean;
  /** Side lean: this side's best at earlier checks of the series (the best plus 15 abort, spec 4.3). */
  previousBest?: Partial<Record<BodySide, number>>;
  /** Side lean: skip the practice leans (fatigue, spec 4.3). */
  skipPractice?: boolean;
  /** Side lean: the sides to measure (default both). */
  sides?: BodySide[];

  /* Timed counts (timedCount.ts, spec 4.2 and 4.4). */

  /**
   * The test variant: arm curl held, cuff or arm_only (default held); chair stand standard,
   * arms_assisted, arms_assisted_steady, one_arm_cross, or hands_allowed as another name of
   * arms_assisted (contract v2 B) (default standard).
   */
  variant?: VariantId | "hands_allowed";
  /**
   * D-009: the baseline range of this series, [rangeLo, rangeHi] as stored at the baseline (the
   * server's baselineRanges). Arm curl: [hanging angle E, top of the bend F], so X = E minus F.
   * Chair stand: [hSit, hSit + rise], so R = hi minus lo. Absent at the baseline.
   */
  fixedRange?: readonly [number, number];
  /**
   * Arm curl: the end of trial rule (Q4); default TIMED_RULES.armCurlHalfwayCredit, the one config
   * flag. Given here only to test both rules.
   */
  armCurlHalfwayCredit?: boolean;
  /** Arm curl: ask the practice check after the practice bends (default: at the baseline with a load). */
  askPracticeCheck?: boolean;
  /** Chair stand: the person's weaker side (support), for the lean toward the stronger side flag. */
  weakerSide?: BodySide | null;
  /** Chair stand one_arm_cross: the side of the arm limb loss (its elbow and wrist are ignored). */
  limbLossArm?: BodySide;
  /** Chair stand hands allowed: the only hand that pushes (spec 4.4 pushing arm), stored as pushHand. */
  pushHand?: BodySide;
  /** Chair stand: pause after the first practice stand with test_stand_dizzy (Parkinson's, spec 4.4). */
  pausePractice?: boolean;
  /** Seconds of the rest between the practice and the trial (arm curl 10, chair stand 60). */
  practiceRestSec?: number;
  /** Seconds of the rest before the one repeat of a trial that failed the quality gate (120). */
  repeatRestSec?: number;
  /** Seconds of the Parkinson's pause after the first practice stand (30). */
  pausePracticeSec?: number;
  /** Seconds of the countdown between check_ready and check_go (3). */
  countdownSec?: number;
}

export interface TestRunner {
  readonly testId: TestId;
  readonly kind: TestKind;
  /** The sides this runner produces results for ("none" for the chair stand). */
  readonly sides: readonly TestSide[];
  readonly phase: RunnerPhase;
  readonly done: boolean;
  /** Starts the runner; returns the opening events (cues and the first phase). */
  start(t: number): TestEvent[];
  feed(frame: Frame, env?: FeedEnv): TestEvent[];
  /** May be called early (stop or skip); still returns every side with its quality. */
  finish(t: number): TestResult;
}
