/**
 * Timed count runners: `arm_curl_30s`, arm bends in 30 seconds (spec 4.2), and `chair_stand_30s`,
 * chair stands in 30 seconds (spec 4.4), contract v2 F part 3. Pure TS, no DOM. One arm curl runner
 * measures one arm; the chair stand has no sides and uses the side "none".
 *
 * Flow (both): calibration at rest (the arm hanging still, or seated still, for 1 s) → the practice
 * (2 slow practice bends or stands, a third one when the two differ by more than 15 percent), which
 * gives the personal range at the baseline or checks the baseline range of the series at later
 * checks (D-009) → a rest → check_ready and a short countdown → check_go and the 30 s trial →
 * check_time_stop. Counts are shown (`rep` events), never spoken: inside the trial the only cues are
 * check_go, check_ten_left (10 s before the end) and check_time_stop (spec 4.0); the lines of a
 * paused trial are `prompt` events, shown and not spoken. A `time` event comes once per whole second
 * of every timer (rest, countdown, trial).
 *
 * Counting (spec 4.2 and 4.4, `LineCounter`): progress p through the personal range; a rep counts
 * when p reaches the count line after p was at or under the return line since the previous counted
 * rep (or since go), so a hover never counts twice. Crossing times are interpolated between frames
 * for the end rules.
 *   arm curl     p = (today's resting hanging angle minus the elbow angle) ÷ X; count line 0.80,
 *                return line 0.20; a bend that peaks between 0.50 and 0.80 is partial, not counted
 *                (detail.partial); only crossings before 30.0 s after go count; compensated reps
 *                (the upper arm more than 20 degrees from its start orientation against the trunk
 *                line, or the trunk pitch changed more than 12 degrees) count and are stored in
 *                detail.compensated, "unknown" when the hips are hidden.
 *   chair stand  h = vertical mid ankle to mid hip distance ÷ the seated trunk length (the seated mid
 *                hip is the zero when the ankles are hidden); p = (h minus h_sit) ÷ R; count line
 *                0.85 with the shoulders over the hips (the vertical hip to shoulder distance at
 *                least 0.9 of the standing practice stand), return line 0.15; at 30.0 s a person
 *                rising at p 0.50 or more gets one more stand (halfwayCredited). Arms used in the
 *                standard or one arm version stop the test and ask pushedAsk.
 * D-009 at later checks (`fixedRange`): the arm curl counts against the baseline X anchored at
 * today's resting angle and flags range_below_baseline when a practice bend misses the count line
 * (after test_curl_full and the phone setup check); the chair stand measures h_sit again, counts
 * against the baseline R and flags range_mismatch when today's rise stays outside 0.85 to 1.15 of
 * it after one re-cue (test_stand_full).
 *
 * Why the workout RepEngine and Calibrator (src/engine/repEngine.ts, calibration.ts) are not used:
 * RepEngine counts when the movement returns, with lines at 0.50, 0.85 and 0.30 of its range,
 * while the check counts at the count line crossing (whose time the end rules need) with the spec's
 * own lines; the Calibrator takes a 5th to 95th percentile envelope of free movement, while the
 * check's personal range comes from each practice bend or stand (the more flexed bend, the larger
 * stand, the 15 percent third practice rule). Changing either would change the workouts. The
 * runners reuse the shared parts instead: the One Euro filter (spec 4.2 names it), the subject
 * lock, the quality gate and setup check, the check in detectors and the helpers of common.ts.
 */
import type {
  ArmCurlDef,
  ArmCurlVariantId,
  ChairStandDef,
  ChairStandVariantId,
  CheckCueId,
  ReasonId,
  VariantId,
} from "../../movements/types";
import { midHip, midShoulder, segmentDistance, type Pt } from "../body";
import { CheckInDetector, checkInReference, swayMeasureFor } from "../checkin";
import { OneEuro } from "../oneEuro";
import {
  ACCEPTED_VIEWS,
  estimateTurnDeg,
  QualityMonitor,
  qualityConfig,
  retryCue,
  setupCheck,
  setupConfig,
  viewCue,
  viewOfRatio,
  viewRatio,
  type QualityIssue,
  type QualityReport,
  type SetupFrame,
} from "../quality";
import { posesOf, SubjectLock } from "../subject";
import type { Frame, Landmark } from "../types";
import {
  DEG,
  dot,
  downVector,
  EventSink,
  jointAngle,
  leanFromVertical,
  median,
  norm,
  otherSide,
  Persist,
  round1,
  round3,
  seen,
  sideLandmarks,
  sub,
  SubjectTracker,
  type SideLandmarks,
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

/**
 * Timing and geometry of the timed count runners. Values quoted from the spec are marked "Spec";
 * the rest are engineering choices (timeouts, filters, practice detection) or SPEC-GAP readings,
 * each explained where it is defined. tests/timed-count.test.ts ties the spec values to the text of
 * the check data.
 */
export const TIMED_RULES = {
  /** Spec 4.2 and 4.4: one 30 s trial. */
  trialSec: 30,
  /** Spec 4.0: check_ten_left, ten seconds before the end. */
  tenLeftSec: 10,
  /** Spec 4.2: count line 0.80, return line 0.20, a partial bend peaks between 0.50 and 0.80. */
  curlCountLine: 0.8,
  curlReturnLine: 0.2,
  curlPartialLine: 0.5,
  /** Spec 4.2 and 4.4: a third practice when the two excursions or rises differ by more than 15 percent. */
  practiceDiff: 0.15,
  /** Spec 4.2: an excursion X under 30 degrees after a setup check is not measured today (quality). */
  curlMinExcursionDeg: 30,
  /** Spec 4.2 compensation: upper arm against the trunk line over 20 degrees, trunk pitch over 12. */
  curlUpperArmDeg: 20,
  curlTrunkPitchDeg: 12,
  /** Spec 4.2 occlusion: over 20 percent of the 30 s unscored fails the quality gate. */
  maxUnscoredShare: 0.2,
  /** Spec 4.2: one repeat is offered after 2 minutes of rest. */
  repeatRestSec: 120,
  /** Spec 4.4: count line 0.85, return line 0.15, the halfway rule at 0.50. */
  standCountLine: 0.85,
  standReturnLine: 0.15,
  standHalfwayLine: 0.5,
  /** Spec 4.4: shoulders over hips, the vertical hip to shoulder distance at least 0.9 of the practice stand. */
  // SPEC-GAP: shoulders-over-hips-perspective. Implemented as written, flagged for the booth: with the
  // lens at seat to hip height, perspective hides most of a forward bend in the vertical hip to
  // shoulder distance (the shoulders come closer to the phone as they go down). On the fixture
  // camera a stand ending 35 degrees forward reads about 0.97 of the upright distance and counts;
  // only bends over about 50 degrees fall under 0.9 (tests/timed-count.test.ts uses 60).
  shouldersOverHips: 0.9,
  /** Spec 4.4 D-009: today's rise outside 0.85 to 1.15 of the baseline rise flags range_mismatch. */
  riseMatch: [0.85, 1.15] as const,
  /** Spec 4.4 arms used: wrist visibility 0.7, within 0.3 shoulder widths of the thigh line, 0.3 s. */
  armWristVisibility: 0.7,
  armThighShoulderWidths: 0.3,
  armSec: 0.3,
  /** Spec 4.4: 1 minute rest after the practice stands. */
  standPracticeRestSec: 60,
  /** Calibration: at rest for at least 1 s (spec 4.4 "median while still for at least 1 s"). */
  calibrationSec: 1,
  // SPEC-GAP: still-limits. "Still" has no measure. The arm curl's resting angle needs the filtered
  // elbow angle within 10 degrees over the second (the arm raise's calibration limit); the chair
  // stand's seated calibration needs the filtered mid hip height within 0.05 trunk lengths (about
  // 2.5 cm).
  curlStillDeg: 10,
  standStillTrunks: 0.05,
  /** Calibration gives up after this long (engineering): not measured today (quality). */
  calibrationTimeoutSec: 30,
  // SPEC-GAP: rest-guards. The spec assumes the calibration catches the person at rest; two guards
  // keep a wrong calibration from making every rep uncountable.
  /**
   * Engineering guards of the resting references. Chair stand: h this far under h_sit (trunk
   * lengths) for 0.5 s during the practice means the calibration caught the person standing: the
   * seated calibration runs again. Arm curl: when the hanging angle between the practice bends is
   * more than the return line share of X above the calibration angle, the arm was held bent at
   * calibration, and today's resting angle is the practice's hanging angle.
   */
  belowSeatTrunks: 0.3,
  belowSeatSec: 0.5,
  // SPEC-GAP: curl-practice-rest. Spec 4.2 gives no rest between the practice bends and the trial;
  // check_practice_done says "rest a moment", read as 10 s.
  curlPracticeRestSec: 10,
  // SPEC-GAP: pd-pause. "A pause after the first practice stand for Parkinson's" has no length;
  // 30 s seated, with test_stand_dizzy, before the second practice stand.
  pausePracticeSec: 30,
  // SPEC-GAP: countdown. "A countdown and a spoken go" has no length: 3 s, shown and not spoken.
  countdownSec: 3,
  /** The phone setup check between practice and trial: 1 s windows, at most 10 s (engineering). */
  setupWindowSec: 1,
  setupMaxSec: 10,
  /**
   * Practice detection (engineering, a starting point to tune at booth): a practice bend starts
   * when the elbow angle drops 15 degrees below the extension before it and ends when it comes back
   * within 20 percent of its excursion (the return line); a practice stand starts when h rises 0.25
   * trunk lengths above h_sit and ends when it is back within 0.1. The top of a stand is the part
   * within 10 percent of its highest rise.
   */
  practiceDipDeg: 15,
  practiceBendReturn: 0.2,
  practiceRiseTrunks: 0.25,
  practiceSeatedTrunks: 0.1,
  standTopShare: 0.1,
  /** A practice gives up after this long without its bends or stands (engineering). */
  practiceTimeoutSec: 30,
  /**
   * Smoothing of the measures, One Euro (spec 4.2 names it): cutoff = minCutoff + beta × speed.
   * Elbow angle in degrees (speed in degrees per second); h in trunk lengths. Tune at booth.
   */
  angleFilter: { minCutoff: 1.5, beta: 0.02 },
  riseFilter: { minCutoff: 1.5, beta: 3 },
  /** Frames further apart than this reset the filter and the crossing interpolation (ms). */
  maxGapMs: 250,
  // SPEC-GAP: frame-persistence. The per frame compensation, arms used (0.3 s, spec), swing and step
  // rules count only when they hold for this long, so a one frame landmark glitch never decides.
  persistSec: 0.2,
  // SPEC-GAP: comp-unknown. A counted curl knows its compensation when the tested side hip was seen
  // (visibility 0.6) in at least half of its scored frames; the stored count of compensated reps is
  // "unknown" when any counted rep does not know it.
  compKnownShare: 0.5,
  // SPEC-GAP: view-class. The arm curl stores side or anterolateral (spec 4.2) without a split. The
  // angle from the pure side view comes from the view ratio (quality.estimateTurnDeg); 15 degrees or
  // more, half of the 30 degree allowance, is anterolateral. The class is a blocking comparability
  // field, so a doubtful split only starts a new series.
  anterolateralFromDeg: 15,
  // SPEC-GAP: rising-measure. "If the person is rising" at 30.0 s reads as an uncounted rise in
  // progress (p left the return line since the last counted stand) whose p grew by more than 0.02
  // over the last 0.3 s.
  risingWindowSec: 0.3,
  risingMinGain: 0.02,
  /** Rising, for the arms used rule: p (or h) within this of its highest since the rise began. */
  risingNearTop: 0.05,
  // SPEC-GAP: arm-use-unknown. Arm use is stored as unknown (flag arm_use_unknown) when every
  // checked wrist was under 0.7 in more than half of the rising frames.
  armUnknownShare: 0.5,
  // SPEC-GAP: stand-flags. The stored only flags of spec 4.4 have no measures. Sideways lean: the
  // trunk turned toward the stronger side more than 10 degrees from its seated angle at the top of
  // the counted stands (median), front view only. Large forward swing: the vertical hip to shoulder
  // distance under 0.6 of the practice stand (about 53 degrees of trunk flexion) during a rise.
  // Fast sit down: from the count line down to the return line in under 0.35 s. A step at the top:
  // an ankle moved more than 0.25 body widths from its seated place while standing. Pause: p stayed
  // within 0.1 for 3 s or more after the first counted stand. Tune at booth.
  leanStrongerDeg: 10,
  swingShare: 0.6,
  fastSitSec: 0.35,
  stepBodyWidths: 0.25,
  pauseSec: 3,
  pauseBand: 0.1,
  /** The one person and visibility prompts at most this often (seconds). */
  promptEverySec: 5,
} as const;

/* ------------------------------------------------------------------ counting */

/** A completed count line crossing. */
export interface LineCross {
  /** Interpolated time of the crossing (ms). */
  t: number;
  /** The crossing came at or after the end of the trial: not counted. */
  late: boolean;
}

/**
 * The counting rule of both timed tests (spec 4.2 and 4.4): a rep counts when p reaches the count
 * line after p was at or under the return line since the previous counted rep (or since the
 * counter started), and while an extra condition holds (the chair stand's shoulders over hips). A
 * rise that peaks at or above the partial line and under the count line, then returns, is partial.
 */
export class LineCounter {
  count = 0;
  partial = 0;
  /** Interpolated crossing times of the counted reps (ms). */
  readonly times: number[] = [];
  private armed = false;
  private peak = -Infinity;
  private prev: { t: number; p: number } | null = null;

  constructor(
    readonly countLine: number,
    readonly returnLine: number,
    readonly partialLine: number,
  ) {}

  /** An uncounted rise is in progress: p left the return line since the last counted rep. */
  get rising(): boolean {
    return this.armed && this.prev !== null && this.prev.p > this.returnLine;
  }

  /** The highest p of the rise in progress (−Infinity when none). */
  get risePeak(): number {
    return this.rising ? this.peak : -Infinity;
  }

  get last(): { t: number; p: number } | null {
    return this.prev;
  }

  /** Frames were missing: the next crossing is not interpolated across the gap. */
  gap(): void {
    this.prev = null;
  }

  /**
   * One scored frame. `ok` is the extra condition of this frame; a crossing at or after `until`
   * (ms) is not counted. Returns the crossing when this frame completed a rep, otherwise null. A p
   * that is not a finite number is a gap, never a crossing.
   */
  push(t: number, p: number, ok = true, until = Infinity): LineCross | null {
    if (!Number.isFinite(p)) {
      this.gap();
      return null;
    }
    const prev = this.prev;
    this.prev = { t, p };
    if (p <= this.returnLine) {
      if (this.armed && this.peak >= this.partialLine && this.peak < this.countLine) this.partial++;
      this.armed = true;
      this.peak = -Infinity;
      return null;
    }
    if (!this.armed) return null;
    this.peak = Math.max(this.peak, p);
    if (p < this.countLine || !ok) return null;
    let tc = t;
    if (prev && prev.p < this.countLine && p > prev.p)
      tc = prev.t + ((this.countLine - prev.p) / (p - prev.p)) * (t - prev.t);
    if (tc >= until) return { t: tc, late: true };
    this.count++;
    this.times.push(tc);
    this.armed = false;
    this.peak = -Infinity;
    return { t: tc, late: false };
  }
}

/* ------------------------------------------------------------------ practice */

/** One practice bend of the arm curl (degrees). */
export interface PracticeBend {
  /** Hanging extension angle before the bend. */
  E: number;
  /** Most flexed angle of the bend. */
  F: number;
  X: number;
  t0: number;
  t1: number;
}

/** Finds the practice bends in the filtered elbow angle (see TIMED_RULES practice detection). */
export class BendTracker {
  readonly bends: PracticeBend[] = [];
  private ext: number | null = null;
  private inBend = false;
  private min = Infinity;
  private e0 = 0;
  private tb = 0;

  get bending(): boolean {
    return this.inBend;
  }

  push(t: number, angle: number): PracticeBend | null {
    const R = TIMED_RULES;
    if (!this.inBend) {
      this.ext = this.ext === null ? angle : Math.max(this.ext, angle);
      if (angle < this.ext - R.practiceDipDeg) {
        this.inBend = true;
        this.min = angle;
        this.e0 = this.ext;
        this.tb = t;
      }
      return null;
    }
    this.min = Math.min(this.min, angle);
    if (angle >= this.e0 - R.practiceBendReturn * (this.e0 - this.min)) {
      const b: PracticeBend = { E: this.e0, F: this.min, X: this.e0 - this.min, t0: this.tb, t1: t };
      this.bends.push(b);
      this.inBend = false;
      this.ext = angle;
      return b;
    }
    return null;
  }
}

/** One practice stand of the chair stand (h and v in seated trunk lengths). */
export interface PracticeStand {
  /** Median h over the top of the stand. */
  h: number;
  /** Median vertical hip to shoulder distance over the top of the stand. */
  v: number;
  /** Rise, h minus h_sit. */
  R: number;
  t0: number;
  t1: number;
}

/** Finds the practice stands in the filtered h (see TIMED_RULES practice detection). */
export class StandTracker {
  readonly stands: PracticeStand[] = [];
  private samples: { t: number; h: number; v: number }[] = [];
  private inStand = false;
  private top = -Infinity;
  /** When the highest h of the stand in progress last grew (ms). */
  peakT = 0;

  constructor(readonly hSit: number) {}

  get standing(): boolean {
    return this.inStand;
  }

  /** Highest h of the stand in progress. */
  get peak(): number {
    return this.inStand ? this.top : -Infinity;
  }

  push(t: number, h: number, v: number): PracticeStand | null {
    const R = TIMED_RULES;
    const up = h - this.hSit;
    if (!this.inStand) {
      if (up >= R.practiceRiseTrunks) {
        this.inStand = true;
        this.samples = [{ t, h, v }];
        this.top = h;
        this.peakT = t;
      }
      return null;
    }
    this.samples.push({ t, h, v });
    if (h > this.top) {
      this.top = h;
      this.peakT = t;
    }
    if (up > R.practiceSeatedTrunks) return null;
    this.inStand = false;
    // SPEC-GAP: practice-top. "Median during each practice stand held about 1 s with the trunk
    // upright" is read as the median over the top of the stand (within 10 percent of its highest
    // rise), where a person who was asked to stand up fully is upright; the same frames give the
    // vertical hip to shoulder reference of the shoulders over hips rule.
    const cut = this.hSit + (1 - R.standTopShare) * (this.top - this.hSit);
    const topFrames = this.samples.filter((s) => s.h >= cut);
    const hTop = median(topFrames.map((s) => s.h))!;
    const s: PracticeStand = {
      h: hTop,
      v: median(topFrames.map((x) => x.v))!,
      R: hTop - this.hSit,
      t0: this.samples[0].t,
      t1: t,
    };
    this.stands.push(s);
    this.samples = [];
    this.top = -Infinity;
    return s;
  }
}

/** True when two practice values differ by more than the share of the larger (spec 4.2 and 4.4). */
export function practiceDiffers(a: number, b: number, share: number = TIMED_RULES.practiceDiff): boolean {
  const big = Math.max(Math.abs(a), Math.abs(b));
  return big > 0 && Math.abs(a - b) > share * big;
}

/* ------------------------------------------------------------ count source */

export type CountSource = "auto" | "staff" | "self";

/**
 * A count confirmed or corrected by booth staff watching live (`staff`, usable as a baseline) or
 * by the person (`self`, stored and shown, never a baseline or a verdict) (spec 4.4 count source;
 * progress-rules reads detail.countSource). Returns a copy; the engine's own results are `auto`.
 */
export function applyCountSource(result: SideResult, source: CountSource, count: number): SideResult {
  if (!Number.isInteger(count) || count < 0 || count > 100)
    throw new Error("A count is a whole number from 0 to 100");
  if (result.unit !== "count") throw new Error("Only timed counts have a count source");
  return { ...result, value: count, detail: { ...result.detail, countSource: source } };
}

/* -------------------------------------------------------------- shared base */

interface TrialState {
  index: number;
  t0: number;
  tEnd: number;
  counter: LineCounter;
  monitor: QualityMonitor;
  lastRemaining: number;
  tenLeft: boolean;
  lastT: number | null;
  scoredMs: number;
  unscoredMs: number;
  /** p over the last second (for the rising test and the pause flag). */
  history: { t: number; p: number }[];
  lastScoredT: number | null;
  lastPrompt: number | null;
}

type Timer = { until: number; next: (t: number) => void };

/** The curl variants and the chair stand variants the runners accept. */
const CURL_VARIANTS: readonly ArmCurlVariantId[] = ["held", "cuff", "arm_only"];
const STAND_VARIANTS: readonly ChairStandVariantId[] = [
  "standard",
  "arms_assisted",
  "arms_assisted_steady",
  "one_arm_cross",
];

abstract class TimedCountBase implements TestRunner {
  abstract readonly testId: "arm_curl_30s" | "chair_stand_30s";
  readonly kind = "timed_count" as const;
  abstract readonly sides: readonly TestSide[];
  readonly lock: SubjectLock;

  protected readonly tracker: SubjectTracker;
  protected readonly sink = new EventSink();
  protected abstract readonly checkin: CheckInDetector;
  protected abstract readonly minVis: number;

  protected phaseNow: RunnerPhase = "idle";
  protected finished = false;
  protected t0 = 0;
  protected tLast = 0;
  protected lastRoll: number | null = null;
  protected notMeasured: ReasonId | null = null;
  protected readonly flagSet = new Set<string>();
  protected trial: TrialState | null = null;
  protected scored: AttemptRecord[] = [];
  protected retried: AttemptRecord[] = [];
  protected qualities: QualityReport[] = [];
  protected repeatOffered = false;
  /** The trial that was stopped early (finish during the trial). */
  protected stoppedTrial: AttemptRecord | null = null;
  private timer: Timer | null = null;
  private lastRemaining = -1;
  private setupFrames: SetupFrame[] = [];
  private setupStart = 0;
  private setupNext: ((t: number) => void) | null = null;
  protected calStart = 0;
  private relockPending = true;

  /** Locks the subject at the first calibration frame with a person; false until it could. */
  protected relockAt(frame: Frame): boolean {
    if (!this.relockPending) return true;
    if (!this.tracker.lockOn(frame)) return false;
    this.relockPending = false;
    return true;
  }

  constructor(
    readonly side: TestSide,
    readonly opts: RunnerOptions,
  ) {
    this.lock = opts.subject ?? new SubjectLock();
    this.tracker = new SubjectTracker(this.lock);
  }

  get phase(): RunnerPhase {
    return this.phaseNow;
  }

  get done(): boolean {
    return this.finished;
  }

  abstract start(t: number): TestEvent[];

  feed(frame: Frame, env: FeedEnv = {}): TestEvent[] {
    if (this.finished || this.phaseNow === "idle") return [];
    const t = frame.t;
    this.tLast = t;
    const roll = env.rollDeg ?? null;
    if (roll !== null && Number.isFinite(roll)) this.lastRoll = roll;
    switch (this.phaseNow) {
      case "calibrating":
        this.calibrating(frame, roll ?? this.lastRoll);
        break;
      case "practice":
        this.practicing(frame, roll ?? this.lastRoll);
        break;
      case "rest":
      case "ready":
        this.track(frame, false);
        this.timing(t);
        break;
      case "setup":
        this.track(frame, false);
        this.setupFrame(frame);
        break;
      case "ask":
        this.track(frame, false);
        break;
      case "attempt":
        this.trialFrame(frame, roll ?? this.lastRoll);
        break;
      default:
        break;
    }
    return this.sink.drain();
  }

  finish(t: number): TestResult {
    const completed = this.finished;
    this.tLast = Math.max(this.tLast, t);
    if (!completed && this.trial) this.stopTrial(t);
    return {
      testId: this.testId,
      kind: this.kind,
      results: [this.sideResult(completed)],
      completed,
      durationSec: round1((this.tLast - this.t0) / 1000),
    };
  }

  /**
   * The answer to the `repeat` ask after a trial that failed the quality gate: yes rests (2
   * minutes), takes the resting reference again and runs the trial once more; no ends the test,
   * not measured today (quality).
   */
  setRepeat(repeat: boolean, t: number): TestEvent[] {
    if (this.phaseNow !== "ask" || this.asking !== "repeat") return [];
    this.asking = null;
    if (!repeat) {
      this.notMeasured = "quality";
      this.end(t);
      return this.sink.drain();
    }
    this.startTimer("rest", this.opts.repeatRestSec ?? TIMED_RULES.repeatRestSec, t, (at) =>
      this.recalibrate(at),
    );
    return this.sink.drain();
  }

  /** The ask the runner waits for, or null. */
  protected asking: "practice_check" | "repeat" | "pushed" | null = null;

  /* ----------------------------------------------------------- phases */

  protected setPhase(phase: RunnerPhase, t: number, attempt?: number): void {
    // Every calibration (the first, after a practice check, after the repeat's rest) locks the
    // subject again (spec 4.0), also with a lock shared between runners: its reference must be the
    // picture the calibration is taken in.
    if (phase === "calibrating") this.relockPending = true;
    this.phaseNow = phase;
    this.sink.push({
      kind: "phase",
      phase,
      t,
      side: this.side,
      ...(attempt !== undefined ? { attempt } : {}),
    });
  }

  protected end(t: number): void {
    this.finished = true;
    this.phaseNow = "done";
    this.timer = null;
    this.sink.push({ kind: "phase", phase: "done", t, side: this.side });
    this.sink.push({ kind: "done", t });
  }

  protected flag(flag: string, t: number): void {
    if (this.flagSet.has(flag)) return;
    this.flagSet.add(flag);
    this.sink.push({ kind: "flag", flag, t, side: this.side });
  }

  /** Subject lock and check in for a frame; the one person line is a prompt inside the trial. */
  protected track(frame: Frame, movement: boolean): Tracked {
    const tr = this.tracker.track(frame);
    const p = tr.pick;
    if (p.paused && (p.reason === "overlap" || p.reason === "jump")) {
      if (this.trial) this.prompt("check_one_person", frame.t);
      else this.sink.cueEvery("check_one_person", frame.t, TIMED_RULES.promptEverySec);
    }
    for (const trigger of this.checkin.feed(frame.t, p.lm, frame.aspect, { movement }))
      this.sink.push({ kind: "checkin", trigger, t: frame.t });
    return tr;
  }

  /** A line shown and not spoken, at most every promptEverySec. */
  protected prompt(cue: CheckCueId, t: number): void {
    const tr = this.trial;
    if (tr && tr.lastPrompt !== null && t - tr.lastPrompt < TIMED_RULES.promptEverySec * 1000) return;
    if (tr) tr.lastPrompt = t;
    this.sink.push({ kind: "prompt", cue, t });
  }

  /** A timer phase (rest or ready) with a time event per whole second, then `next`. */
  protected startTimer(phase: "rest" | "ready", sec: number, t: number, next: (t: number) => void): void {
    this.setPhase(phase, t);
    this.lastRemaining = -1;
    if (sec <= 0) {
      next(t);
      return;
    }
    this.timer = { until: t + sec * 1000, next };
    this.timing(t);
  }

  private timing(t: number): void {
    const tm = this.timer;
    if (!tm) return;
    if (t < tm.until) {
      const remaining = Math.ceil((tm.until - t) / 1000);
      if (remaining !== this.lastRemaining) {
        this.lastRemaining = remaining;
        this.sink.push({ kind: "time", remainingSec: remaining, t });
      }
      return;
    }
    this.timer = null;
    tm.next(t);
  }

  protected ask(ask: "practice_check" | "repeat" | "pushed", t: number): void {
    this.asking = ask;
    this.setPhase("ask", t);
    const side = this.side;
    if (side === "none") {
      if (ask === "practice_check") throw new Error("The chair stand has no practice check");
      this.sink.push({ kind: "ask", ask, side, t });
    } else {
      if (ask === "pushed") throw new Error("The arm curl has no pushed question");
      this.sink.push({ kind: "ask", ask, side, t });
    }
  }

  /** The phone setup check (spec 4.2 D-009 and the X rule): cue its first issue until it passes. */
  protected runSetup(t: number, next: (t: number) => void): void {
    this.setupFrames = [];
    this.setupStart = t;
    this.setupNext = next;
    this.setPhase("setup", t);
  }

  private setupFrame(frame: Frame): void {
    const R = TIMED_RULES;
    const t = frame.t;
    this.setupFrames.push({ t, poses: posesOf(frame), aspect: frame.aspect });
    if (t - this.setupFrames[0].t < R.setupWindowSec * 1000) return;
    const res = setupCheck(this.setupFrames, this.setupConfig());
    this.setupFrames = [];
    const next = this.setupNext!;
    if (res.ok || t - this.setupStart >= R.setupMaxSec * 1000) {
      this.setupNext = null;
      next(t);
      return;
    }
    if (res.cue) this.sink.cueEvery(res.cue, t, R.promptEverySec);
  }

  /** The countdown, then go. */
  protected getReady(t: number): void {
    for (const c of this.readyCues()) this.sink.cue(c, t);
    this.startTimer("ready", this.opts.countdownSec ?? TIMED_RULES.countdownSec, t, (at) => this.go(at));
  }

  private go(t: number): void {
    const R = TIMED_RULES;
    const index = 1;
    this.lock.resetAttempt();
    this.trial = {
      index,
      t0: t,
      tEnd: t + R.trialSec * 1000,
      counter: this.newCounter(),
      // The gate uses the model's labels for the tested side (swapped on a mirrored camera); the
      // retry cues keep the person's own side.
      monitor: new QualityMonitor({ ...qualityConfig(this.definition(), this.side), gate: this.gate() }),
      lastRemaining: -1,
      tenLeft: false,
      lastT: null,
      scoredMs: 0,
      unscoredMs: 0,
      history: [],
      lastScoredT: null,
      lastPrompt: null,
    };
    this.onTrialStart(t);
    this.sink.cue("check_go", t);
    this.setPhase("attempt", t, index);
    this.trialTime(t);
  }

  private trialTime(t: number): void {
    const tr = this.trial!;
    const remaining = Math.max(0, Math.ceil((tr.tEnd - t) / 1000));
    if (remaining !== tr.lastRemaining) {
      tr.lastRemaining = remaining;
      this.sink.push({ kind: "time", remainingSec: remaining, t });
    }
    if (!tr.tenLeft && t >= tr.tEnd - TIMED_RULES.tenLeftSec * 1000) {
      tr.tenLeft = true;
      this.sink.cue("check_ten_left", t);
    }
  }

  private trialFrame(frame: Frame, roll: number | null): void {
    const tr = this.trial!;
    const t = frame.t;
    const track = this.track(frame, true);
    tr.monitor.feedPick(frame, track.pick);
    const raw = track.pick.paused ? null : this.progress(track, roll, t);
    const p = raw !== null && Number.isFinite(raw) ? raw : null;
    // Scored or unscored time, up to the end of the trial. Time without frames (a camera or model
    // stall, dropped frames) is unscored whatever the frame that ends it: nothing was seen then, and
    // a rep in it is lost (spec 4.2: over 20 percent of the 30 s unscored fails the gate).
    // SPEC-GAP: gap-time. A gap longer than maxGapMs between two frames counts whole as unscored.
    const upTo = Math.min(t, tr.tEnd);
    const dt = tr.lastT === null ? 0 : Math.max(0, upTo - tr.lastT);
    if (p === null || dt > TIMED_RULES.maxGapMs) tr.unscoredMs += dt;
    else tr.scoredMs += dt;
    tr.lastT = upTo;

    if (p === null) {
      tr.counter.gap();
      tr.lastScoredT = null;
      if (!track.pick.paused) this.prompt(this.unscoredPrompt(track), t);
    } else {
      if (tr.lastScoredT !== null && t - tr.lastScoredT > TIMED_RULES.maxGapMs) tr.counter.gap();
      tr.lastScoredT = t;
      const before = tr.counter.last;
      const ok = this.countOk(track, roll);
      const cross = tr.counter.push(t, p, ok, tr.tEnd);
      if (cross && !cross.late) {
        this.sink.push({ kind: "rep", count: tr.counter.count, t, side: this.side });
        this.onCount(cross.t, t);
      }
      if (t >= tr.tEnd && before) {
        // p at 30.0 s, between the last frame before the end and this one.
        const k = t > before.t ? (tr.tEnd - before.t) / (t - before.t) : 1;
        tr.history.push({ t: tr.tEnd, p: before.p + (p - before.p) * Math.min(1, Math.max(0, k)) });
      } else tr.history.push({ t: Math.min(t, tr.tEnd), p });
      while (tr.history.length > 1 && tr.history[0].t < t - 5000) tr.history.shift();
      this.onTrialFrame(track, p, roll, t);
      if (this.finished || this.phaseNow !== "attempt") return;
    }
    if (t >= tr.tEnd) {
      this.endTrial(t);
      return;
    }
    this.trialTime(t);
  }

  private unscoredPrompt(track: Tracked): CheckCueId {
    const px = track.px;
    const missing = this.gate().filter((i) => !seen(px, i, this.minVis));
    return retryCue("not_visible", this.testId, this.side, missing);
  }

  private endTrial(t: number): void {
    const tr = this.trial!;
    const R = TIMED_RULES;
    this.sink.push({ kind: "time", remainingSec: 0, t });
    this.sink.cue("check_time_stop", t);
    const extra = this.atTimeUp(tr);
    const q = tr.monitor.report();
    this.qualities.push(q);
    const unscored = this.unscoredShare(tr);
    const failed = !q.ok || unscored > R.maxUnscoredShare;
    const rec = this.trialRecord(tr, tr.counter.count + extra, t, q, false);
    this.trial = null;
    if (failed) {
      rec.outcome = "retry";
      rec.reasons = q.ok ? ["unscored"] : [...q.issues];
      this.retried.push(rec);
      this.sink.push(this.attemptEvent(rec, t));
      if (this.repeatOffered) {
        this.notMeasured = "quality";
        this.afterTrial(t);
        this.end(t);
        return;
      }
      // SPEC-GAP: stand-repeat. The one repeat after 2 minutes of rest is the arm curl's rule (spec
      // 4.2); the chair stand has no rule of its own beyond "repeated" (spec 4.0), so it gets the
      // same single repeat, the fewer the stands the safer.
      this.repeatOffered = true;
      if (q.cue) this.sink.cue(q.cue, t);
      this.ask("repeat", t);
      return;
    }
    rec.outcome = "valid";
    this.scored.push(rec);
    this.sink.push(this.attemptEvent(rec, t));
    this.afterTrial(t);
    this.end(t);
  }

  /** finish() during the trial: the trial ended early, its count is a lower bound (censored). */
  // SPEC-GAP: timed-censored. The spec defines censoring for the side lean only. For a timed count
  // `censored` marks a trial that ended before 30.0 s (a lower bound); the stop rules keep such a
  // count from being stored as a score (status stopped, or not measured with the reason).
  private stopTrial(t: number): void {
    const tr = this.trial!;
    const q = tr.monitor.report();
    this.qualities.push(q);
    const rec = this.trialRecord(tr, tr.counter.count, t, q, true);
    rec.outcome = "invalid";
    rec.reasons = ["stopped_early"];
    this.stoppedTrial = rec;
    this.trial = null;
  }

  /** Ends the test during the trial or the practice (arms used, support): no score. */
  protected stopEarly(t: number): void {
    const tr = this.trial;
    if (tr) this.stopTrial(t);
  }

  protected unscoredShare(tr: TrialState): number {
    const all = tr.scoredMs + tr.unscoredMs;
    return all > 0 ? tr.unscoredMs / all : 1;
  }

  private trialRecord(
    tr: TrialState,
    value: number,
    t: number,
    q: QualityReport,
    stopped: boolean,
  ): AttemptRecord {
    const secondsCompleted = round1((Math.min(t, tr.tEnd) - tr.t0) / 1000);
    const detail: Detail = {
      ...this.trialDetail(tr),
      partial: tr.counter.partial,
      unscoredShare: round3(this.unscoredShare(tr)),
      stoppedEarly: stopped,
      secondsCompleted,
    };
    return {
      side: this.side,
      index: tr.index,
      outcome: "valid",
      value,
      reasons: [],
      flags: [...this.flagSet],
      censored: stopped,
      detail,
      quality: q,
      t0: tr.t0,
      t1: t,
    };
  }

  protected attemptEvent(rec: AttemptRecord, t: number): TestEvent {
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

  /* ----------------------------------------------------------- result */

  private sideResult(completed: boolean): SideResult {
    const rec = this.scored[0] ?? this.stoppedTrial;
    const notMeasured: ReasonId | null =
      this.notMeasured ?? (completed && !this.scored.length ? "quality" : null);
    const status = notMeasured ? "not_measured" : completed ? "measured" : "stopped";
    const value = notMeasured || !rec ? null : rec.value;
    const censored = !!this.stoppedTrial && !completed;
    const fps = this.qualities.map((q) => q.fps).filter((f) => f > 0);
    const medianFps = fps.length ? round1(median(fps)!) : null;
    const issues = new Set<QualityIssue>();
    for (const r of this.retried) for (const i of r.quality.issues) issues.add(i);
    const detail: Detail = {
      countSource: "auto",
      ...this.rangeDetail(),
      ...(rec ? rec.detail : { stoppedEarly: false }),
      medianFps: medianFps ?? "unknown",
    };
    if (censored) detail.censored = true;
    return {
      testId: this.testId,
      side: this.side,
      unit: "count",
      variant: this.variantId,
      status,
      reason: notMeasured,
      value,
      median: null,
      nValid: status === "measured" && value !== null ? 1 : 0,
      censored,
      attempts: rec ? [rec] : [],
      practice: this.practiceRecords(),
      retried: [...this.retried],
      detail,
      flags: [...this.flagSet],
      quality: {
        ok: this.notMeasured !== "quality",
        retries: this.retried.length,
        issues: [...issues],
        medianFps,
        maxPausedShare: Math.max(0, ...this.qualities.map((q) => q.pausedShare)),
      },
      durationSec: round1((this.tLast - this.t0) / 1000),
    };
  }

  /* ----------------------------------------------------------- per test */

  protected abstract readonly variantId: VariantId;
  protected abstract definition(): ArmCurlDef | ChairStandDef;
  protected abstract gate(): number[];
  protected abstract setupConfig(): ReturnType<typeof setupConfig>;
  protected abstract calibrating(frame: Frame, roll: number | null): void;
  protected abstract practicing(frame: Frame, roll: number | null): void;
  /** Takes the resting reference again after the repeat's rest, then gets ready. */
  protected abstract recalibrate(t: number): void;
  protected abstract readyCues(): CheckCueId[];
  protected abstract newCounter(): LineCounter;
  protected abstract onTrialStart(t: number): void;
  /** Progress p of a scored frame, or null when the frame is not scored. */
  protected abstract progress(track: Tracked, roll: number | null, t: number): number | null;
  /** The extra count condition of the frame (the chair stand's shoulders over hips). */
  protected abstract countOk(track: Tracked, roll: number | null): boolean;
  protected abstract onCount(tCross: number, t: number): void;
  protected abstract onTrialFrame(track: Tracked, p: number, roll: number | null, t: number): void;
  /** Stands added at 30.0 s (the chair stand's halfway rule). */
  protected abstract atTimeUp(tr: TrialState): number;
  protected abstract afterTrial(t: number): void;
  protected abstract trialDetail(tr: TrialState): Detail;
  protected abstract rangeDetail(): Detail;
  protected abstract practiceRecords(): AttemptRecord[];
}

/* ------------------------------------------------------------------ arm curl */

interface CurlSample {
  t: number;
  angle: number;
  ratio: number | null;
  armTrunk: number | null;
  pitch: number | null;
  raw: Landmark[];
  aspect: number | undefined;
}

interface CurlCalibration {
  /** Today's resting hanging angle (degrees). */
  rest: number;
  /** Upper arm against the trunk line at rest, null when the hip was not seen. */
  armTrunk: number | null;
  /** Trunk line from the vertical at rest, null when the hip was not seen. */
  pitch: number | null;
  t: number;
}

interface CurlRepWindow {
  frames: number;
  known: number;
  comp: boolean;
  armPersist: Persist;
  pitchPersist: Persist;
}

const wrapDeg = (d: number) => {
  let x = d;
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x;
};

/**
 * `arm_curl_30s` (spec 4.2). Options: `variant` (held, cuff or arm_only), `fixedRange` (D-009),
 * `askPracticeCheck`, `mirrored`, `intro`, the timer lengths.
 */
export class ArmCurlRunner extends TimedCountBase {
  readonly testId = "arm_curl_30s" as const;
  readonly sides: readonly BodySide[];
  declare readonly side: BodySide;
  protected readonly checkin = new CheckInDetector();
  protected readonly minVis: number;
  protected variantId: ArmCurlVariantId;

  private readonly L: SideLandmarks;
  private readonly O: SideLandmarks;
  private filter: OneEuro;
  private lastAngleT: number | null = null;
  private calBuf: CurlSample[] = [];
  private cal: CurlCalibration | null = null;
  private bends = new BendTracker();
  private practiceStart = 0;
  private practiceRounds: PracticeBend[][] = [];
  /** The practice ran again after an excursion under 30 degrees. */
  private xRetried = false;
  private thirdAsked = false;
  /** After calibrating: practice, or straight to the countdown (the repeat). */
  private afterCal: "practice" | "ready" = "practice";
  /** Excursion X used for counting and the stored range. */
  private X: number | null = null;
  private range: { lo: number; hi: number } | null = null;
  private rep: CurlRepWindow | null = null;
  private pendingRep: CurlRepWindow | null = null;
  private repComp: (boolean | "unknown")[] = [];

  constructor(
    readonly def: ArmCurlDef,
    side: TestSide,
    opts: RunnerOptions = {},
  ) {
    if (side === "none") throw new Error("arm_curl_30s needs a side");
    super(side, opts);
    this.sides = [side];
    const v = opts.variant ?? "held";
    if (!(CURL_VARIANTS as readonly string[]).includes(v))
      throw new Error(`arm_curl_30s has no variant ${v}`);
    this.variantId = v as ArmCurlVariantId;
    this.L = sideLandmarks(side, !!opts.mirrored);
    this.O = sideLandmarks(otherSide(side), !!opts.mirrored);
    this.minVis = def.requiredLandmarks.minVisibility;
    this.filter = this.newFilter();
  }

  /** The practice bends and the calibration, once taken (for the record and the UI). */
  get calibration(): Readonly<CurlCalibration> | null {
    return this.cal;
  }

  get excursion(): number | null {
    return this.X;
  }

  private get loaded(): boolean {
    return this.variantId !== "arm_only";
  }

  protected definition(): ArmCurlDef {
    return this.def;
  }

  protected gate(): number[] {
    return [this.L.shoulder, this.L.elbow, this.L.wrist];
  }

  protected setupConfig() {
    const L = this.L;
    // Framing with the model's labels for the tested side (swapped on a mirrored camera).
    return { ...setupConfig(this.def, this.side), framing: [0, L.shoulder, L.elbow, L.wrist, L.hip] };
  }

  private newFilter(): OneEuro {
    const f = TIMED_RULES.angleFilter;
    return new OneEuro(f.minCutoff, f.beta);
  }

  start(t: number): TestEvent[] {
    this.t0 = t;
    this.tLast = t;
    this.calStart = t;
    this.setPhase("calibrating", t);
    if (this.opts.intro ?? true) this.sink.cue("test_curl_start", t);
    this.sink.cue(this.side === "left" ? "check_left_arm" : "check_right_arm", t);
    this.sink.cue("test_curl_elbow", t);
    if (this.loaded) this.sink.cue("test_curl_grip", t);
    return this.sink.drain();
  }

  /**
   * The answer to the practice check (spec 4.2 load selection): were both practice bends full,
   * without pain, and no harder than a moderate effort? No: the UI shows the step down line and the
   * person takes a lighter load (pass the new variant when it changes, for example arm_only); the
   * practice runs again with it.
   */
  setPracticeCheck(ok: boolean, t: number, variant?: ArmCurlVariantId): TestEvent[] {
    if (this.phaseNow !== "ask" || this.asking !== "practice_check") return [];
    this.asking = null;
    if (ok) {
      this.toRest(t);
      return this.sink.drain();
    }
    if (variant) this.variantId = variant;
    this.resetPractice();
    this.afterCal = "practice";
    this.calStart = t;
    this.setPhase("calibrating", t);
    if (this.loaded) this.sink.cue("test_curl_grip", t);
    return this.sink.drain();
  }

  private resetPractice(): void {
    this.bends = new BendTracker();
    this.thirdAsked = false;
    this.xRetried = false;
    this.X = null;
    this.range = null;
    this.flagSet.delete("range_below_baseline");
    this.cal = null;
    this.calBuf = [];
  }

  /* --------------------------------------------------------- measure */

  /** Elbow angle and the compensation measures of a frame; null when the gate is not seen. */
  private measure(
    px: Landmark[] | null,
    roll: number | null,
  ): { angle: number; armTrunk: number | null; pitch: number | null } | null {
    const L = this.L;
    const mv = this.minVis;
    if (!px || !seen(px, L.shoulder, mv) || !seen(px, L.elbow, mv) || !seen(px, L.wrist, mv)) return null;
    const S = px[L.shoulder];
    const E = px[L.elbow];
    const angle = jointAngle(S, E, px[L.wrist]);
    if (!Number.isFinite(angle)) return null;
    let armTrunk: number | null = null;
    let pitch: number | null = null;
    if (seen(px, L.hip, mv)) {
      const H = px[L.hip];
      const trunk = sub(H, S);
      const arm = sub(E, S);
      if (norm(trunk) > 1e-6 && norm(arm) > 1e-6)
        armTrunk = Math.atan2(trunk.x * arm.y - trunk.y * arm.x, dot(trunk, arm)) * DEG;
      pitch = leanFromVertical(H, S, roll ?? 0);
    }
    return { angle, armTrunk, pitch };
  }

  private filtered(t: number, angle: number): number {
    if (this.lastAngleT !== null && t - this.lastAngleT > TIMED_RULES.maxGapMs)
      this.filter = this.newFilter();
    this.lastAngleT = t;
    return this.filter.filter(angle, t);
  }

  /* ----------------------------------------------------- calibration */

  protected calibrating(frame: Frame, roll: number | null): void {
    const R = TIMED_RULES;
    const t = frame.t;
    if (t - this.calStart > R.calibrationTimeoutSec * 1000) {
      this.notMeasured = "quality";
      this.end(t);
      return;
    }
    if (!this.relockAt(frame)) return;
    const tr = this.track(frame, false);
    const m = tr.pick.paused ? null : this.measure(tr.px, roll);
    if (!m || !tr.raw) {
      this.calBuf = [];
      // The other side faces the phone: ask to turn (spec 4.0 side labelling).
      const px = tr.px;
      const O = this.O;
      if (px && seen(px, O.elbow, this.minVis) && seen(px, O.wrist, this.minVis))
        this.sink.cueEvery(viewCue(this.testId, this.side), t, R.promptEverySec);
      return;
    }
    const angle = this.filtered(t, m.angle);
    this.calBuf.push({
      t,
      angle,
      ratio: viewRatio(tr.raw, frame.aspect),
      armTrunk: m.armTrunk,
      pitch: m.pitch,
      raw: tr.raw,
      aspect: frame.aspect,
    });
    const from = t - R.calibrationSec * 1000;
    while (this.calBuf.length > 1 && this.calBuf[1].t <= from) this.calBuf.shift();
    if (this.calBuf[0].t > from) return;
    const angles = this.calBuf.map((s) => s.angle);
    if (Math.max(...angles) - Math.min(...angles) > R.curlStillDeg) return;
    const ratios = this.calBuf.map((s) => s.ratio).filter((r): r is number => r !== null);
    const view = viewOfRatio(ratios.length ? median(ratios) : null);
    if (!ACCEPTED_VIEWS[this.testId].includes(view)) {
      this.sink.cueEvery(viewCue(this.testId, this.side), t, R.promptEverySec);
      return;
    }
    this.calibrate(t);
  }

  private calibrate(t: number): void {
    const buf = this.calBuf;
    const withHip = buf.filter((s) => s.armTrunk !== null && s.pitch !== null);
    const hipKnown = withHip.length / buf.length >= 0.9;
    this.cal = {
      rest: median(buf.map((s) => s.angle))!,
      armTrunk: hipKnown ? median(withHip.map((s) => s.armTrunk!))! : null,
      pitch: hipKnown ? median(withHip.map((s) => s.pitch!))! : null,
      t,
    };
    const last = buf[buf.length - 1];
    this.checkin.setReference(checkInReference(last.raw, last.aspect));
    this.calBuf = [];
    if (this.afterCal === "ready") {
      this.getReady(t);
      return;
    }
    this.startPractice(t);
  }

  protected recalibrate(t: number): void {
    this.afterCal = "ready";
    this.cal = null;
    this.calBuf = [];
    this.calStart = t;
    this.setPhase("calibrating", t);
    this.sink.cue("test_curl_start", t);
  }

  /* -------------------------------------------------------- practice */

  private startPractice(t: number): void {
    this.bends = new BendTracker();
    this.practiceStart = t;
    this.setPhase("practice", t, 0);
    this.sink.cue("check_practice", t);
    this.sink.cue("test_curl_full", t);
  }

  /** Bends the practice needs now: 2, or 3 after the 15 percent rule at the baseline. */
  private get bendsNeeded(): number {
    return this.thirdAsked ? 3 : 2;
  }

  protected practicing(frame: Frame, roll: number | null): void {
    const R = TIMED_RULES;
    const t = frame.t;
    const tr = this.track(frame, true);
    const m = tr.pick.paused ? null : this.measure(tr.px, roll);
    if (m) {
      const done = this.bends.push(t, this.filtered(t, m.angle));
      if (done) this.onBend(t);
      if (this.phaseNow !== "practice") return;
    }
    if (t - this.practiceStart > R.practiceTimeoutSec * 1000 && !this.bends.bending) this.practiceDone(t);
  }

  private onBend(t: number): void {
    const b = this.bends.bends;
    if (b.length < this.bendsNeeded) return;
    if (!this.opts.fixedRange && b.length === 2 && practiceDiffers(b[0].X, b[1].X)) {
      // Spec 4.2: the two excursions differ by more than 15 percent: a third practice bend.
      this.thirdAsked = true;
      this.sink.cue("test_curl_full", t);
      return;
    }
    this.practiceDone(t);
  }

  private practiceDone(t: number): void {
    const R = TIMED_RULES;
    const bends = [...this.bends.bends];
    this.practiceRounds.push(bends);
    const cal = this.cal!;
    const fixed = this.opts.fixedRange;
    // The arm held bent at calibration: the practice's hanging angle is today's resting angle.
    const hang = median(bends.map((b) => b.E));
    const span = fixed
      ? Math.abs(fixed[0] - fixed[1])
      : hang === null
        ? 0
        : hang - Math.min(...bends.map((b) => b.F));
    if (hang !== null && hang - cal.rest > R.curlReturnLine * span) cal.rest = hang;
    if (fixed) {
      // D-009: X from the baseline of the series, anchored at today's resting angle.
      this.X = Math.abs(fixed[0] - fixed[1]);
      const reached = bends.length >= 2 && bends.every((b) => (cal.rest - b.F) / this.X! >= R.curlCountLine);
      // SPEC-GAP: practice-below-line. "If they do not reach the count line" is read as any practice
      // bend (or a missing one) under the count line: the flag keeps a verdict and the large drop
      // message away, the safer side.
      if (!reached) {
        this.flag("range_below_baseline", t);
        this.sink.cue("test_curl_full", t);
        this.runSetup(t, (at) => this.afterPractice(at));
        return;
      }
      this.afterPractice(t);
      return;
    }
    // SPEC-GAP: third-practice. With a third bend F is the most flexed and E the straightest of all
    // the practice bends, as with two ("F is the more flexed").
    const E = bends.length ? Math.max(...bends.map((b) => b.E)) : cal.rest;
    const F = bends.length ? Math.min(...bends.map((b) => b.F)) : cal.rest;
    const X = E - F;
    if (X < R.curlMinExcursionDeg) {
      if (!this.xRetried) {
        // Spec 4.2: after a setup check the practice runs again; X under 30 again: not measured.
        this.xRetried = true;
        this.thirdAsked = false;
        this.sink.cue("test_curl_full", t);
        this.runSetup(t, (at) => {
          this.afterCal = "practice";
          this.cal = null;
          this.calBuf = [];
          this.calStart = at;
          this.setPhase("calibrating", at);
        });
        return;
      }
      this.notMeasured = "quality";
      this.end(t);
      return;
    }
    this.X = X;
    this.range = { lo: E, hi: F };
    this.afterPractice(t);
  }

  private afterPractice(t: number): void {
    // SPEC-GAP: practice-check-when. The practice check belongs to the load selection at the
    // baseline (its "no" steps the load down), so it is asked at the baseline with a held or cuff
    // load unless the UI says otherwise.
    const askCheck = this.opts.askPracticeCheck ?? (!this.opts.fixedRange && this.loaded);
    if (askCheck) {
      this.ask("practice_check", t);
      return;
    }
    this.toRest(t);
  }

  private toRest(t: number): void {
    this.sink.cue("check_practice_done", t);
    this.startTimer("rest", this.opts.practiceRestSec ?? TIMED_RULES.curlPracticeRestSec, t, (at) =>
      this.getReady(at),
    );
  }

  protected readyCues(): CheckCueId[] {
    return ["test_curl_many", "check_breathe", "check_ready"];
  }

  /* ----------------------------------------------------------- trial */

  protected newCounter(): LineCounter {
    const R = TIMED_RULES;
    return new LineCounter(R.curlCountLine, R.curlReturnLine, R.curlPartialLine);
  }

  protected onTrialStart(): void {
    this.rep = null;
    this.pendingRep = null;
    this.repComp = [];
  }

  private newRepWindow(): CurlRepWindow {
    return {
      frames: 0,
      known: 0,
      comp: false,
      armPersist: new Persist(TIMED_RULES.persistSec),
      pitchPersist: new Persist(TIMED_RULES.persistSec),
    };
  }

  private lastMeasure: { armTrunk: number | null; pitch: number | null } | null = null;

  protected progress(track: Tracked, roll: number | null, t: number): number | null {
    const m = this.measure(track.px, roll);
    if (!m) {
      this.lastMeasure = null;
      return null;
    }
    this.lastMeasure = { armTrunk: m.armTrunk, pitch: m.pitch };
    const angle = this.filtered(t, m.angle);
    return (this.cal!.rest - angle) / this.X!;
  }

  protected countOk(): boolean {
    return true;
  }

  protected onCount(): void {
    // The rep's window runs on until the arm is back at the return line.
    this.pendingRep = this.rep ?? this.newRepWindow();
    this.rep = null;
  }

  protected onTrialFrame(_track: Tracked, p: number, _roll: number | null, t: number): void {
    const R = TIMED_RULES;
    const cal = this.cal!;
    const m = this.lastMeasure;
    if (p <= R.curlReturnLine) {
      // Back at the return line: the counted rep's window closes; a new window opens.
      if (this.pendingRep) this.closeRep(this.pendingRep);
      this.pendingRep = null;
      this.rep = this.newRepWindow();
    }
    const windows = [this.rep, this.pendingRep].filter((w): w is CurlRepWindow => !!w);
    for (const w of windows) {
      w.frames++;
      if (!m || m.armTrunk === null || m.pitch === null || cal.armTrunk === null || cal.pitch === null)
        continue;
      w.known++;
      const arm = Math.abs(wrapDeg(m.armTrunk - cal.armTrunk)) > R.curlUpperArmDeg;
      const pitch = Math.abs(wrapDeg(m.pitch - cal.pitch)) > R.curlTrunkPitchDeg;
      if (w.armPersist.update(t, arm) || w.pitchPersist.update(t, pitch)) w.comp = true;
    }
  }

  private closeRep(w: CurlRepWindow): void {
    const known =
      this.cal!.armTrunk !== null && w.frames > 0 && w.known / w.frames >= TIMED_RULES.compKnownShare;
    this.repComp.push(known ? w.comp : "unknown");
  }

  protected atTimeUp(): number {
    if (this.pendingRep) this.closeRep(this.pendingRep);
    this.pendingRep = null;
    return 0;
  }

  protected afterTrial(): void {}

  protected trialDetail(tr: TrialState): Detail {
    const R = TIMED_RULES;
    // A trial stopped early closes its open rep here.
    if (this.pendingRep) {
      this.closeRep(this.pendingRep);
      this.pendingRep = null;
    }
    const counted = this.repComp.slice(0, tr.counter.count);
    const compensated: number | "unknown" = counted.some((c) => c === "unknown")
      ? "unknown"
      : counted.filter((c) => c === true).length;
    const first10 = tr.counter.times.filter((x) => x - tr.t0 < 10000).length;
    const last10 = tr.counter.times.filter((x) => x - tr.t0 >= (R.trialSec - 10) * 1000).length;
    const q = tr.monitor.report();
    let view: string = "unknown";
    let viewAngle: number | "unknown" = "unknown";
    if (q.viewRatio !== null) {
      const fromSide = 90 - estimateTurnDeg(q.viewRatio);
      viewAngle = Math.round(Math.max(0, Math.min(90, fromSide)));
      view = fromSide >= R.anterolateralFromDeg ? "anterolateral" : "side";
    }
    return { compensated, first10sCount: first10, last10sCount: last10, view, viewAngle };
  }

  protected rangeDetail(): Detail {
    // Baseline: E and F of the practice. Later checks: the baseline X anchored at today's resting
    // angle, so X = rangeLo minus rangeHi in both.
    if (this.range) return { rangeLo: round1(this.range.lo), rangeHi: round1(this.range.hi) };
    if (this.opts.fixedRange && this.X !== null && this.cal)
      return { rangeLo: round1(this.cal.rest), rangeHi: round1(this.cal.rest - this.X) };
    return {};
  }

  protected practiceRecords(): AttemptRecord[] {
    return this.practiceRounds.flat().map((b) => ({
      side: this.side,
      index: 0,
      outcome: "practice" as const,
      value: null,
      reasons: [],
      flags: [],
      censored: false,
      detail: { E: round1(b.E), F: round1(b.F), X: round1(b.X) },
      quality: emptyQuality(),
      t0: b.t0,
      t1: b.t1,
    }));
  }
}

/* ---------------------------------------------------------------- chair stand */

interface StandSample {
  t: number;
  /** Filtered mid hip along the downward vertical, pixel space (for stillness). */
  still: number;
  hipDown: number;
  ankleDown: number | null;
  trunk: number;
  v: number;
  lean: number;
  ratio: number | null;
  ankles: [Pt, Pt] | null;
  raw: Landmark[];
  aspect: number | undefined;
}

interface StandCalibration {
  /** Seated trunk length, pixel space. */
  trunk: number;
  /** The ankles give the zero (else the seated mid hip is the zero). */
  ankleMode: boolean;
  /** Mid ankle along the downward vertical at calibration (ankle mode). */
  ankleDown: number;
  /** Mid hip along the downward vertical at calibration. */
  hipDown: number;
  /** h seated, trunk lengths (0 when the hip is the zero). */
  hSit: number;
  /** Trunk line angle from the vertical, seated (degrees). */
  lean: number;
  /** Ankle places seated, pixel space, null when not seen. */
  ankles: [Pt, Pt] | null;
  t: number;
}

/**
 * `chair_stand_30s` (spec 4.4). Options: `variant` (standard, arms_assisted,
 * arms_assisted_steady, one_arm_cross, or hands_allowed for arms_assisted), `fixedRange` (D-009),
 * `limbLossArm` (one_arm_cross), `pushHand`, `weakerSide`, `pausePractice`, `mirrored`, `intro`,
 * the timer lengths.
 */
export class ChairStandRunner extends TimedCountBase {
  readonly testId = "chair_stand_30s" as const;
  readonly sides: readonly TestSide[] = ["none"];
  protected readonly checkin = new CheckInDetector({}, { swayMeasure: swayMeasureFor("chair_stand_30s") });
  protected readonly minVis: number;
  protected readonly variantId: ChairStandVariantId;

  private filter: OneEuro;
  private lastHT: number | null = null;
  private calFilter: OneEuro;
  private below = new Persist(TIMED_RULES.belowSeatSec);
  private calBuf: StandSample[] = [];
  private cal: StandCalibration | null = null;
  private stands: StandTracker | null = null;
  private practiceStart = 0;
  private practiceStands: PracticeStand[] = [];
  private thirdAsked = false;
  private recued = false;
  /** Stands of the practice after the re-cue (D-009). */
  private recueFrom = 0;
  private paused = false;
  private afterCal: "practice" | "ready" = "practice";
  /** Rise used for counting, today's rise, and the standing vertical hip to shoulder reference. */
  private R: number | null = null;
  private riseToday: number | null = null;
  private vStand: number | null = null;
  /** Wrists checked for arm use (spec 4.4): both, or the intact one in one_arm_cross. */
  private readonly wrists: number[];
  private armPersist = new Persist(TIMED_RULES.armSec);
  /** Highest h since the person left the seat in the practice (for the arms used rule). */
  private riseTop = -Infinity;
  private armRising = 0;
  private armUnknown = 0;
  private handsUsed = false;
  private steadySaid = false;
  private halfway = false;
  // Stored only flags.
  private swing = new Persist(TIMED_RULES.persistSec);
  private step = new Persist(TIMED_RULES.persistSec);
  private topAt: number | null = null;
  private topLeans: number[] = [];
  private lastMeasure: StandMeasure | null = null;

  constructor(
    readonly def: ChairStandDef,
    side: TestSide = "none",
    opts: RunnerOptions = {},
  ) {
    if (side !== "none") throw new Error("chair_stand_30s has no sides");
    super("none", opts);
    const v = opts.variant === "hands_allowed" ? "arms_assisted" : (opts.variant ?? "standard");
    // SPEC-GAP: contract-variants. Contract v2 B names hands_allowed, which is not a data id; the
    // data's arms_assisted is labelled "Hands allowed", so hands_allowed runs as arms_assisted.
    if (!(STAND_VARIANTS as readonly string[]).includes(v))
      throw new Error(`chair_stand_30s has no variant ${v}`);
    this.variantId = v as ChairStandVariantId;
    if (this.variantId === "one_arm_cross" && !opts.limbLossArm)
      throw new Error("one_arm_cross needs limbLossArm (the intact wrist is the one checked)");
    const mirrored = !!opts.mirrored;
    this.wrists =
      this.variantId === "one_arm_cross"
        ? [sideLandmarks(otherSide(opts.limbLossArm!), mirrored).wrist]
        : [sideLandmarks("left", mirrored).wrist, sideLandmarks("right", mirrored).wrist];
    this.minVis = def.requiredLandmarks.minVisibility;
    this.filter = this.newFilter();
    this.calFilter = this.newFilter();
  }

  get calibration(): Readonly<StandCalibration> | null {
    return this.cal;
  }

  /** The rise used for counting (trunk lengths), once known. */
  get rise(): number | null {
    return this.R;
  }

  /** Standard and one arm versions: arms must not be used (spec 4.4). */
  private get armsCrossed(): boolean {
    return this.variantId === "standard" || this.variantId === "one_arm_cross";
  }

  private get assisted(): boolean {
    return this.variantId === "arms_assisted" || this.variantId === "arms_assisted_steady";
  }

  protected definition(): ChairStandDef {
    return this.def;
  }

  protected gate(): number[] {
    return [...this.def.requiredLandmarks.gate];
  }

  protected setupConfig() {
    return setupConfig(this.def, "none");
  }

  private newFilter(): OneEuro {
    const f = TIMED_RULES.riseFilter;
    return new OneEuro(f.minCutoff, f.beta);
  }

  start(t: number): TestEvent[] {
    this.t0 = t;
    this.tLast = t;
    this.calStart = t;
    this.setPhase("calibrating", t);
    if (this.opts.intro ?? true) this.sink.cue("test_stand_start", t);
    // SPEC-GAP: one-arm-cue. No cue fits one_arm_cross (test_stand_arms_cross asks for both arms);
    // its instruction card replaces step 5, so no arm cue is spoken for it.
    if (this.variantId === "standard") this.sink.cue("test_stand_arms_cross", t);
    if (this.assisted) this.sink.cue("test_stand_hands_ok", t);
    return this.sink.drain();
  }

  /**
   * The answer to pushedAsk after arms were used (spec 4.4): yes ends the test with needed_arms (no
   * score; the next check offers the hands allowed version); no makes the attempt a quality failure
   * (not measured today) and keeps the variant.
   */
  setPushed(pushed: boolean, t: number): TestEvent[] {
    if (this.phaseNow !== "ask" || this.asking !== "pushed") return [];
    this.asking = null;
    if (pushed) {
      this.notMeasured = "needed_arms";
      this.sink.cue("test_stand_hands_needed", t);
    } else this.notMeasured = "quality";
    this.end(t);
    return this.sink.drain();
  }

  /**
   * The person reached for the support in front (arms_assisted_steady, spec 4.4): the test ends
   * with needed_support and no score. Reported by the UI (the stop list or the helper).
   */
  // SPEC-GAP: reach-support. The spec gives no camera measure for reaching the support in front;
  // the UI reports it.
  reportSupport(t: number): TestEvent[] {
    if (this.finished) return [];
    this.stopEarly(t);
    this.notMeasured = "needed_support";
    this.end(t);
    return this.sink.drain();
  }

  /* --------------------------------------------------------- measure */

  private downOf(roll: number | null): Pt {
    return downVector(roll ?? 0);
  }

  /** The chair stand measures of a frame; null when the gate is not seen. */
  private measure(px: Landmark[] | null, roll: number | null): StandMeasure | null {
    const mv = this.minVis;
    if (!px || !this.def.requiredLandmarks.gate.every((i) => seen(px, i, mv))) return null;
    const down = this.downOf(roll);
    const hip = midHip(px);
    const sh = midShoulder(px);
    const trunk = norm(sub(sh, hip));
    const anklesSeen = seen(px, 27, mv) && seen(px, 28, mv);
    const ankles: [Pt, Pt] | null = anklesSeen ? [px[27], px[28]] : null;
    const ankleDown = ankles
      ? dot({ x: (ankles[0].x + ankles[1].x) / 2, y: (ankles[0].y + ankles[1].y) / 2 }, down)
      : null;
    return {
      hipDown: dot(hip, down),
      ankleDown,
      trunk,
      vRaw: dot(sub(hip, sh), down),
      lean: leanFromVertical(hip, sh, roll ?? 0),
      ankles,
      px,
      down,
    };
  }

  /** h and v in seated trunk lengths (after calibration). */
  private hv(m: StandMeasure): { h: number; v: number } {
    const c = this.cal!;
    const foot = c.ankleMode ? (m.ankleDown ?? c.ankleDown) : c.hipDown;
    return { h: (foot - m.hipDown) / c.trunk, v: m.vRaw / c.trunk };
  }

  private filtered(t: number, h: number): number {
    if (this.lastHT !== null && t - this.lastHT > TIMED_RULES.maxGapMs) this.filter = this.newFilter();
    this.lastHT = t;
    return this.filter.filter(h, t);
  }

  /* ----------------------------------------------------- calibration */

  protected calibrating(frame: Frame, roll: number | null): void {
    const R = TIMED_RULES;
    const t = frame.t;
    if (t - this.calStart > R.calibrationTimeoutSec * 1000) {
      this.notMeasured = "quality";
      this.end(t);
      return;
    }
    if (!this.relockAt(frame)) return;
    const tr = this.track(frame, false);
    const m = tr.pick.paused ? null : this.measure(tr.px, roll);
    if (!m || !tr.raw) {
      this.calBuf = [];
      this.calFilter = this.newFilter();
      // One side of the body only: the phone looks at the person side on.
      const px = tr.px;
      const oneSide = (a: number[], b: number[]) =>
        !!px && a.every((i) => seen(px, i, this.minVis)) && !b.some((i) => seen(px, i, this.minVis));
      if (oneSide([11, 23], [12, 24]) || oneSide([12, 24], [11, 23]))
        this.sink.cueEvery(viewCue(this.testId, "none"), t, R.promptEverySec);
      return;
    }
    this.calBuf.push({
      t,
      still: this.calFilter.filter(m.hipDown, t),
      hipDown: m.hipDown,
      ankleDown: m.ankleDown,
      trunk: m.trunk,
      v: m.vRaw,
      lean: m.lean,
      ratio: viewRatio(tr.raw, frame.aspect),
      ankles: m.ankles,
      raw: tr.raw,
      aspect: frame.aspect,
    });
    const from = t - R.calibrationSec * 1000;
    while (this.calBuf.length > 1 && this.calBuf[1].t <= from) this.calBuf.shift();
    if (this.calBuf[0].t > from) return;
    const hips = this.calBuf.map((s) => s.still);
    const trunk = median(this.calBuf.map((s) => s.trunk))!;
    if (Math.max(...hips) - Math.min(...hips) > R.standStillTrunks * trunk) return;
    const ratios = this.calBuf.map((s) => s.ratio).filter((r): r is number => r !== null);
    const view = viewOfRatio(ratios.length ? median(ratios) : null);
    if (!ACCEPTED_VIEWS[this.testId].includes(view)) {
      this.sink.cueEvery(viewCue(this.testId, "none"), t, R.promptEverySec);
      return;
    }
    this.calibrate(t);
  }

  private calibrate(t: number): void {
    const buf = this.calBuf;
    const trunk = median(buf.map((s) => s.trunk))!;
    const withAnkles = buf.filter((s) => s.ankleDown !== null);
    const ankleMode = withAnkles.length / buf.length >= 0.9;
    const hipDown = median(buf.map((s) => s.hipDown))!;
    const ankleDown = ankleMode ? median(withAnkles.map((s) => s.ankleDown!))! : hipDown;
    const anklesAt = (k: 0 | 1): Pt => ({
      x: median(withAnkles.map((s) => s.ankles![k].x))!,
      y: median(withAnkles.map((s) => s.ankles![k].y))!,
    });
    this.cal = {
      trunk,
      ankleMode,
      ankleDown,
      hipDown,
      hSit: ankleMode ? (ankleDown - hipDown) / trunk : 0,
      lean: median(buf.map((s) => s.lean))!,
      ankles: withAnkles.length / buf.length >= 0.5 ? [anklesAt(0), anklesAt(1)] : null,
      t,
    };
    const last = buf[buf.length - 1];
    this.checkin.setReference(checkInReference(last.raw, last.aspect));
    this.calBuf = [];
    // The filter restarts from the seated h.
    this.filter = this.newFilter();
    this.lastHT = null;
    if (this.afterCal === "ready") {
      this.getReady(t);
      return;
    }
    this.startPractice(t);
  }

  protected recalibrate(t: number): void {
    this.afterCal = "ready";
    this.cal = null;
    this.calBuf = [];
    this.calFilter = this.newFilter();
    this.calStart = t;
    this.setPhase("calibrating", t);
    this.sink.cue("test_stand_start", t);
  }

  /* -------------------------------------------------------- practice */

  private startPractice(t: number): void {
    this.stands = new StandTracker(this.cal!.hSit);
    this.practiceStart = t;
    this.steadySaid = false;
    this.setPhase("practice", t, 0);
    this.sink.cue("check_practice", t);
    this.sink.cue("test_stand_full", t);
  }

  private get standsNeeded(): number {
    if (this.recued) return this.recueFrom + 1;
    return this.thirdAsked ? 3 : 2;
  }

  protected practicing(frame: Frame, roll: number | null): void {
    const R = TIMED_RULES;
    const t = frame.t;
    const tr = this.track(frame, true);
    const m = tr.pick.paused ? null : this.measure(tr.px, roll);
    const st = this.stands!;
    if (m) {
      const { h: hRaw, v } = this.hv(m);
      const h = this.filtered(t, hRaw);
      if (this.below.update(t, h < this.cal!.hSit - R.belowSeatTrunks)) {
        // The calibration caught the person standing: calibrate seated again.
        this.below.reset();
        this.cal = null;
        this.calBuf = [];
        this.calFilter = this.newFilter();
        this.calStart = t;
        this.setPhase("calibrating", t);
        this.sink.cue("test_stand_start", t);
        return;
      }
      // Rising: off the seat (h above the seated band) and at or near the highest h since leaving it.
      const off = h > this.cal!.hSit + R.practiceSeatedTrunks;
      this.riseTop = off ? Math.max(this.riseTop, h) : -Infinity;
      const rising = off && h >= this.riseTop - R.risingNearTop;
      // SPEC-GAP: arms-practice. Arms used stop the test in the practice stands too (spec 4.4
      // "when arms are used the test stops"): a person who needs the hands stops before the trial.
      if (this.armCheck(m, rising, t)) return;
      const done = st.push(t, h, v);
      // arms_assisted_steady: test_stand_steady at each stand (spec 4.4), once the stand stopped
      // rising (its highest h did not grow for persistSec).
      if (
        this.variantId === "arms_assisted_steady" &&
        st.standing &&
        !this.steadySaid &&
        t - st.peakT >= R.persistSec * 1000
      ) {
        this.steadySaid = true;
        this.sink.cue("test_stand_steady", t);
      }
      if (done) {
        this.steadySaid = false;
        this.onStand(t);
        return;
      }
    }
    if (t - this.practiceStart > R.practiceTimeoutSec * 1000 && !st.standing) {
      // SPEC-GAP: no-stand. Without the practice stands within 30 s the test is not measured today.
      this.notMeasured = "quality";
      this.end(t);
    }
  }

  private onStand(t: number): void {
    const R = TIMED_RULES;
    const all = this.stands!.stands;
    this.practiceStands = [...all];
    this.practiceStart = t;
    if (all.length === 1 && this.opts.pausePractice && !this.paused) {
      // Spec 4.4: a pause after the first practice stand for Parkinson's.
      this.paused = true;
      this.sink.cue("test_stand_dizzy", t);
      this.startTimer("rest", this.opts.pausePracticeSec ?? R.pausePracticeSec, t, (at) => {
        this.practiceStart = at;
        this.setPhase("practice", at, 0);
      });
      return;
    }
    if (all.length < this.standsNeeded) return;
    const fixed = this.opts.fixedRange;
    if (!fixed) {
      if (all.length === 2 && practiceDiffers(all[0].R, all[1].R)) {
        // Spec 4.4: the two rises differ by more than 15 percent: a third practice stand.
        this.thirdAsked = true;
        this.sink.cue("test_stand_full", t);
        return;
      }
      // SPEC-GAP: third-practice. With a third stand the baseline R is the largest of the three, as
      // with two ("the larger of the two").
      this.R = Math.max(...all.map((x) => x.R));
      this.riseToday = this.R;
      this.practiceComplete(t);
      return;
    }
    const base = Math.abs(fixed[1] - fixed[0]);
    const recent = this.recued ? all.slice(this.recueFrom) : all.slice(0, 2);
    const today = Math.max(...recent.map((x) => x.R));
    this.riseToday = today;
    const [lo, hi] = R.riseMatch;
    const matches = today >= lo * base && today <= hi * base;
    if (!matches && !this.recued) {
      // SPEC-GAP: stand-recue. "After one re-cue" runs one more practice stand after
      // test_stand_full (fewer stands than a second full practice), and today's rise is that
      // stand's rise.
      this.recued = true;
      this.recueFrom = all.length;
      this.sink.cue("test_stand_full", t);
      return;
    }
    if (!matches) this.flag("range_mismatch", t);
    this.R = base;
    this.practiceComplete(t);
  }

  private practiceComplete(t: number): void {
    this.vStand = median(this.practiceStands.map((s) => s.v))!;
    this.sink.cue("check_rest_minute", t);
    this.startTimer("rest", this.opts.practiceRestSec ?? TIMED_RULES.standPracticeRestSec, t, (at) =>
      this.getReady(at),
    );
  }

  protected readyCues(): CheckCueId[] {
    return ["test_stand_many", "check_ready"];
  }

  /* ---------------------------------------------------------- arm use */

  /**
   * Arms used (spec 4.4): a wrist at visibility 0.7 or more at or below the mid hip, or within 0.3
   * shoulder widths of a thigh line, for 0.3 s while rising. Low wrist visibility is unknown, never
   * arms used. Standard and one arm versions stop and ask pushedAsk; the hands allowed versions only
   * record that the hands helped. Returns true when the test stopped.
   */
  private armCheck(m: StandMeasure, rising: boolean, t: number): boolean {
    if (!rising) {
      this.armPersist.update(t, false);
      return false;
    }
    const R = TIMED_RULES;
    const px = m.px;
    const width = this.lock.width ?? norm(sub(px[11], px[12]));
    const hip = midHip(px);
    const thighs: [number, number][] = [
      [23, 25],
      [24, 26],
    ];
    let seenAny = false;
    let used = false;
    for (const w of this.wrists) {
      if (!seen(px, w, R.armWristVisibility)) continue;
      seenAny = true;
      const q = px[w];
      if (dot(sub(q, hip), m.down) >= 0) used = true;
      for (const [h, k] of thighs) {
        if (!seen(px, h, this.minVis) || !seen(px, k, this.minVis)) continue;
        if (segmentDistance(q, px[h], px[k]) < R.armThighShoulderWidths * width) used = true;
      }
    }
    this.armRising++;
    if (!seenAny) this.armUnknown++;
    if (!this.armPersist.update(t, used)) return false;
    if (!this.armsCrossed) {
      this.handsUsed = true;
      return false;
    }
    // Spec 4.4: when arms are used the test stops; at home pushedAsk comes first.
    // SPEC-GAP: arms-stop-cue. The spec names no cue that stops the person; check_stop_now plays,
    // then pushedAsk is shown.
    this.stopEarly(t);
    this.flag("arms_used", t);
    this.sink.cue("check_stop_now", t);
    this.ask("pushed", t);
    return true;
  }

  /* ----------------------------------------------------------- trial */

  protected newCounter(): LineCounter {
    const R = TIMED_RULES;
    return new LineCounter(R.standCountLine, R.standReturnLine, R.standHalfwayLine);
  }

  protected onTrialStart(): void {
    // The stored flags describe the scored trial: those of a trial that is repeated go.
    for (const f of TRIAL_FLAGS) this.flagSet.delete(f);
    this.handsUsed = false;
    this.armRising = 0;
    this.armUnknown = 0;
    this.swing.reset();
    this.step.reset();
    this.armPersist.reset();
    this.steadySaid = false;
    this.halfway = false;
    this.topAt = null;
    this.topLeans = [];
  }

  protected progress(track: Tracked, roll: number | null, t: number): number | null {
    const m = this.measure(track.px, roll);
    this.lastMeasure = m;
    if (!m) return null;
    const { h } = this.hv(m);
    return (this.filtered(t, h) - this.cal!.hSit) / this.R!;
  }

  protected countOk(): boolean {
    const m = this.lastMeasure;
    if (!m) return false;
    return this.hv(m).v >= TIMED_RULES.shouldersOverHips * this.vStand!;
  }

  protected onCount(): void {
    const m = this.lastMeasure;
    if (m) this.topLeans.push(this.leanToward(m));
  }

  /** Trunk lean from its seated angle toward the stronger side (any side without one), degrees. */
  private leanToward(m: StandMeasure): number {
    const d = m.lean - this.cal!.lean;
    const weak = this.opts.weakerSide ?? null;
    if (!weak) return Math.abs(d);
    const strong = otherSide(weak);
    // Positive lean is toward the image right; the stronger shoulder's image side gives the sign.
    const S = sideLandmarks(strong, !!this.opts.mirrored).shoulder;
    const O = sideLandmarks(weak, !!this.opts.mirrored).shoulder;
    const sign = Math.sign(m.px[S].x - m.px[O].x) || 1;
    return d * sign;
  }

  protected onTrialFrame(_track: Tracked, p: number, _roll: number | null, t: number): void {
    const R = TIMED_RULES;
    const tr = this.trial!;
    const m = this.lastMeasure;
    if (!m) return;
    const c = tr.counter;
    const rising = c.rising && p >= c.risePeak - R.risingNearTop;
    if (this.armCheck(m, rising, t)) return;
    const { v } = this.hv(m);
    // Stored only flags (see TIMED_RULES stand-flags).
    if (this.swing.update(t, rising && v < R.swingShare * this.vStand!)) this.flag("forward_swing", t);
    if (p >= R.standCountLine) this.topAt = t;
    if (p <= R.standReturnLine && this.topAt !== null) {
      if (t - this.topAt < R.fastSitSec * 1000) this.flag("fast_sit", t);
      this.topAt = null;
    }
    const a = this.cal!.ankles;
    if (a && m.ankles && p >= R.standCountLine) {
      const width = this.lock.width ?? 0;
      const moved = Math.max(norm(sub(m.ankles[0], a[0])), norm(sub(m.ankles[1], a[1])));
      if (this.step.update(t, moved > R.stepBodyWidths * width)) this.flag("step", t);
    }
    const hist = tr.history.filter((x) => x.t >= t - R.pauseSec * 1000);
    if (c.count > 0 && hist.length > 1 && hist[0].t <= t - R.pauseSec * 1000 + 100) {
      const ps = hist.map((x) => x.p);
      if (Math.max(...ps) - Math.min(...ps) <= R.pauseBand) this.flag("pause", t);
    }
    // arms_assisted_steady: test_stand_steady at each stand (spec 4.4).
    // SPEC-GAP: steady-cue. The timed trial's voice gives only go, ten seconds left and stop (spec
    // 4.0), but the walking aid modifier plays test_stand_steady at each stand (spec 4.4); the
    // specific safety rule is kept and the cue plays once per stand when it reaches the count line.
    if (this.variantId === "arms_assisted_steady") {
      if (p >= R.standCountLine && !this.steadySaid) {
        this.steadySaid = true;
        this.sink.cue("test_stand_steady", t);
      } else if (p <= R.standReturnLine) this.steadySaid = false;
    }
  }

  protected atTimeUp(tr: TrialState): number {
    const R = TIMED_RULES;
    const c = tr.counter;
    const last = tr.history[tr.history.length - 1];
    if (!last || !c.rising) return 0;
    const back = [...tr.history].reverse().find((x) => x.t <= last.t - R.risingWindowSec * 1000);
    if (!back) return 0;
    // Spec 4.4: at 30.0 s, rising with p at 0.50 or more: one stand is added.
    if (last.p >= R.standHalfwayLine && last.p - back.p > R.risingMinGain) {
      this.halfway = true;
      return 1;
    }
    return 0;
  }

  protected afterTrial(t: number): void {
    const R = TIMED_RULES;
    const q = this.qualities[this.qualities.length - 1];
    if (this.armRising > 0 && this.armUnknown / this.armRising > R.armUnknownShare)
      this.flag("arm_use_unknown", t);
    if (this.handsUsed) this.flag("hands_used", t);
    if (q && q.view === "front") {
      const lean = median(this.topLeans);
      if (lean !== null && lean > R.leanStrongerDeg) this.flag("lean_stronger", t);
    } else this.flag("lean_unknown", t);
    if (this.opts.pausePractice) this.flag("pd_pause", t);
    this.sink.cue("check_sit_minute", t);
  }

  protected trialDetail(): Detail {
    return { halfwayCredited: this.halfway };
  }

  protected rangeDetail(): Detail {
    const c = this.cal;
    const d: Detail = {};
    if (this.opts.pushHand) d.pushHand = this.opts.pushHand;
    if (!c || this.R === null) return d;
    return {
      ...d,
      hSit: round3(c.hSit),
      rise: round3(this.R),
      riseToday: this.riseToday === null ? "unknown" : round3(this.riseToday),
      rangeLo: round3(c.hSit),
      rangeHi: round3(c.hSit + this.R),
    };
  }

  protected practiceRecords(): AttemptRecord[] {
    return this.practiceStands.map((s) => ({
      side: "none" as const,
      index: 0,
      outcome: "practice" as const,
      value: null,
      reasons: [],
      flags: [],
      censored: false,
      detail: { h: round3(s.h), R: round3(s.R), v: round3(s.v) },
      quality: emptyQuality(),
      t0: s.t0,
      t1: s.t1,
    }));
  }
}

/** Chair stand flags that describe one trial. */
const TRIAL_FLAGS = [
  "forward_swing",
  "fast_sit",
  "step",
  "pause",
  "hands_used",
  "lean_stronger",
  "lean_unknown",
  "arm_use_unknown",
] as const;

interface StandMeasure {
  hipDown: number;
  ankleDown: number | null;
  trunk: number;
  /** Vertical mid hip minus mid shoulder along the downward vertical (pixel space). */
  vRaw: number;
  /** Trunk line from the vertical, degrees, positive toward the image right. */
  lean: number;
  ankles: [Pt, Pt] | null;
  px: Landmark[];
  down: Pt;
}

/** The quality report of a practice record: the practice has no quality gate of its own. */
function emptyQuality(): QualityReport {
  return {
    ok: true,
    frames: 0,
    visibleShare: 0,
    windowVisibleShare: null,
    optionalVisibleShare: {},
    view: "unknown",
    viewRatio: null,
    viewOk: true,
    inFrameShare: 0,
    fps: 0,
    pausedShare: 0,
    touched: false,
    distance: null,
    distanceM: null,
    issues: [],
    missing: [],
    cue: null,
  };
}

export type TimedCountRunner = ArmCurlRunner | ChairStandRunner;

/** The timed count runner of a test definition. */
export function createTimedCountRunner(
  def: ArmCurlDef | ChairStandDef,
  side: TestSide,
  opts: RunnerOptions = {},
): TimedCountRunner {
  return def.id === "arm_curl_30s"
    ? new ArmCurlRunner(def, side, opts)
    : new ChairStandRunner(def, side, opts);
}
