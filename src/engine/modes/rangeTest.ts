/**
 * Range test runner: `shoulder_abduction`, arm raise to the side (spec 4.1, contract v2 F).
 * Pure TS, no DOM. One runner measures one side.
 *
 * Flow: calibration (arms relaxed at the sides for at least 1 s) → one unscored practice lift →
 * 3 scored lifts with a rest between them. An attempt that fails the quality gate, or in which the
 * other arm moves, is repeated and not stored, up to 2 extra per side; after that the side is not
 * measured today (quality).
 *
 * Measure (spec 4.1 "Measurement definition"): the 2D angle in pixel space between the upper arm
 * (shoulder to elbow) and the downward trunk axis (mid shoulder to the mid hip fixed at its median
 * calibration position). 0 is the arm at the side, 180 straight overhead; an arm past the vertical
 * toward the head is clamped at 180 and flagged pastVertical, never folded back. When the hips
 * were not visible at calibration the downward vertical comes from the phone roll (gravity
 * reference); without a roll reading the side is not measured today. The attempt value is the
 * highest angle held for 0.5 s: the maximum over time of the rolling 0.5 s window minimum.
 *
 * Validity per attempt (tests[].validity, tune at booth): trunk lean change from calibration over
 * 5 degrees cues test_abd_still, over 10 is invalid (gravity reference: mid shoulder shift over
 * 0.08 and 0.15 shoulder widths); the plane check over the ascent (upper arm at least 0.85 of the
 * reference length for 0.3 s between 70 and 110 degrees; a pass from below 60 to above 120 without
 * such frames is plane_flexion and cues test_abd_side); shoulder width shrink over 15 percent is
 * invalid; the other hand near the tested arm is invalid; an elbow under 150 degrees flags
 * bentElbow; valid attempts spreading over 15 degrees flag inconsistent; the shrug is coaching and
 * logging only.
 */
import type { CheckCueId, ReasonId, ShoulderAbductionDef } from "../../movements/types";
import { segmentDistance, type Pt } from "../body";
import { CheckInDetector, checkInReference } from "../checkin";
import { QualityMonitor, qualityConfig, type QualityIssue, type QualityReport } from "../quality";
import { SubjectLock } from "../subject";
import { Frame, Landmark } from "../types";
import {
  acrossVector,
  CalibrationRounds,
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
  RunningMedian,
  seen,
  sideLandmarks,
  signedAngle,
  sub,
  SubjectTracker,
  SustainedPeak,
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
 * Timing and geometry of the runner. Values quoted from the spec are marked; the rest are
 * engineering choices (timeouts) or SPEC-GAP readings, each explained where it is defined.
 */
export const RANGE_RULES = {
  /** Spec 4.1: arms relaxed at the sides for at least 1 s. */
  calibrationSec: 1,
  // SPEC-GAP: relaxed-arms. "Arms relaxed at the sides" has no angle. An arm counts as relaxed at
  // or below this angle from the downward vertical; the same angle marks the start of a lift and
  // its end (the arm back down). Tune at booth.
  relaxedMaxDeg: 30,
  // SPEC-GAP: calibration-still. Calibration needs the tested arm to stay within this range over
  // the whole second, so a moving arm is not taken as the resting reference.
  calibrationStillDeg: 10,
  /** Share of calibration frames with both hips visible for the trunk reference. */
  hipsVisibleShare: 0.9,
  /** Spec 4.1 plane check window and the flexion pass (degrees) and the minimum time. */
  planeWindow: [70, 110] as const,
  planeFlexionFrom: 60,
  planeFlexionTo: 120,
  planeMinSec: 0.3,
  /** Spec 4.1 gravity mode lean, mid shoulder shift ÷ shoulder width: cue and invalid. */
  gravityLeanCue: 0.08,
  gravityLeanInvalid: 0.15,
  // SPEC-GAP: assist-distance. "The other hand near the tested arm" has no distance. Near is a
  // visible wrist or hand point of the other side within this many calibration shoulder widths
  // (about 8 cm) of the tested upper arm or forearm while the arm is lifted. Tune at booth.
  assistShoulderWidths: 0.25,
  // SPEC-GAP: wrong-arm. The spec gives no angle for "the arm that moves". The other arm counts as
  // the one that moved when it is held at this angle or more for 0.5 s while the tested arm stays
  // relaxed.
  wrongArmDeg: 45,
  // SPEC-GAP: shrug-cue. The shrug is coaching and logging only, with no threshold. The coaching
  // cue plays once per attempt when the ear to shoulder distance shrinks by more than this share of
  // the resting shoulder width while the arm is lifted. Tune at booth.
  shrugCue: 0.15,
  // SPEC-GAP: frame-persistence. The per frame validity rules (lean, rotation, assisted lift, past
  // vertical) count only when they hold for this long, so a single frame landmark glitch never
  // invalidates an attempt. Tune at booth.
  persistSec: 0.2,
  /** The arm back below relaxedMaxDeg this long ends the attempt (engineering). */
  lowerHoldSec: 0.3,
  /** An attempt ends after this long (engineering); a person who cannot lift is measured as is. */
  // SPEC-GAP: no-lift. The spec has no rule for an attempt without a lift. It ends at this timeout
  // and is stored with what was held (a person who cannot lift the arm is measured as is).
  attemptTimeoutSec: 15,
  /** After the rest, wait this long at most for the arms to come down before the next attempt. */
  restWaitMaxSec: 10,
  /** The hold cue plays once the arm moves slower than this (degrees per second) over holdCueSec. */
  holdCueDegPerSec: 15,
  holdCueSec: 0.3,
  /** The lower cue plays once the held window minimum is within this of the attempt's highest angle. */
  lowerCueWithinDeg: 5,
  /** Frames further apart than this break the sustained window (ms). */
  maxGapMs: 250,
  /**
   * The angle, the upper arm length and the other arm are the running median over this window (s)
   * before the rules use them (engineering: removes landmark jitter without stretching a spike).
   */
  medianSec: 0.3,
  /** The one person cue at most this often while scoring is paused (seconds). */
  onePersonCueEverySec: 5,
  // SPEC-GAP: camera-moved. Spec 4.1 fixes the mid hip at calibration (trunk reference), so a
  // picture that shifts afterwards (a bumped stand, a sliding phone, front camera auto framing)
  // tilts the axis and biases every angle while the lean check stays quiet. When both hips are
  // seen, their mid point (running median) more than this many calibration shoulder widths from the
  // fixed mid hip, for persistSec, means the picture moved (or the pelvis slid on the seat): the
  // attempt is repeated with check_phone_still and the calibration is taken again. Tune at booth.
  cameraMovedShoulderWidths: 0.1,
  // SPEC-GAP: relock-after-jump. After a phone slip every frame reads as a jump (spec 4.0) and the
  // lock waits for a new calibration. With one person in the picture and the jump pause lasting this
  // long in a rest, the runner takes the calibration again (and the lock with it).
  relockAfterSec: 1,
} as const;

interface CalSample {
  t: number;
  px: Landmark[];
  raw: Landmark[];
  aspect: number | undefined;
  roll: number | null;
  angle: number;
}

interface Calibration {
  reference: "trunk" | "gravity";
  /** Fixed mid hip, pixel space (trunk reference). */
  fixedHip: Pt | null;
  midShoulder: Pt;
  shoulderWidth: number;
  /** Trunk lean at calibration (trunk reference), degrees. */
  lean: number;
  /** Median roll at calibration, null without readings. */
  roll: number | null;
  /** Tested side ear to shoulder distance, null when the ear was not seen. */
  earToShoulder: number | null;
  /** Tested upper arm length, pixel space. */
  upperArm: number;
  t: number;
}

interface Measure {
  angle: number;
  pastVertical: boolean;
  len: number;
  other: number | null;
  elbow: number | null;
  shrug: number | null;
  planeZ: number;
  /** Trunk reference: degrees from the calibration lean. Gravity: shift ratio. Signed. */
  lean: number;
  width: number;
  assist: boolean;
  roll: number | null;
}

interface Sample {
  t: number;
  angle: number;
  len: number;
  elbow: number | null;
  shrug: number | null;
  planeZ: number;
  lean: number;
  pastVertical: boolean;
}

interface AttemptState {
  practice: boolean;
  index: number;
  t0: number;
  monitor: QualityMonitor;
  peak: SustainedPeak;
  otherPeak: SustainedPeak;
  angleMed: RunningMedian;
  lenMed: RunningMedian;
  otherMed: RunningMedian;
  samples: Sample[];
  lifted: boolean;
  maxAngle: number;
  lowSince: number | null;
  below60: boolean;
  planeOkAny: boolean;
  planeFlexion: boolean;
  leanCoach: Persist;
  leanInvalid: Persist;
  leanMax: number;
  shrink: Persist;
  shrinkMax: number;
  assist: Persist;
  pastVertical: Persist;
  wrongArm: boolean;
  /** The picture moved during the attempt (camera-moved). */
  cameraMoved: boolean;
  said: Set<CheckCueId>;
  lastLive: number | null;
  lastPeakShown: number;
  rolls: number[];
  /** Live mid hip (running median per axis) and the camera moved rule (trunk reference). */
  hipMedX: RunningMedian;
  hipMedY: RunningMedian;
  moved: Persist;
}

const clampDeg = (x: number) => Math.max(0, Math.min(180, x));

/** The latest sample at or before `at`, or null. */
function sampleBefore<S extends { t: number }>(samples: readonly S[], at: number): S | null {
  for (let i = samples.length - 1; i >= 0; i--) if (samples[i].t <= at) return samples[i];
  return null;
}

export class RangeTestRunner implements TestRunner {
  readonly testId = "shoulder_abduction" as const;
  readonly kind = "range_test" as const;
  readonly sides: readonly BodySide[];
  readonly side: BodySide;
  readonly lock: SubjectLock;

  private readonly L: SideLandmarks;
  private readonly O: SideLandmarks;
  /** Gate landmarks of the tested side with the model's labels (swapped on a mirrored camera). */
  private readonly gateIds: number[];
  private readonly minVis: number;
  private readonly restSec: number;
  private readonly tracker: SubjectTracker;
  private readonly checkin = new CheckInDetector();
  private readonly sink = new EventSink();

  private phaseNow: RunnerPhase = "idle";
  private finished = false;
  private t0 = 0;
  private tLast = 0;
  private calBuf: CalSample[] = [];
  /** Running median of the tested arm's angle in the calibration window (the stillness rule). */
  private calMed = new RunningMedian(RANGE_RULES.medianSec * 1000);
  /** The rounds of the calibration (O35): the widened tolerance, the offer, the last round. */
  private readonly rounds = new CalibrationRounds();
  /** Waiting for the answer to the calibration offer (O35). */
  private offerOpen = false;
  /** The next calibration frame locks the subject again (spec 4.0: locked at calibration). */
  private relockPending = true;
  /** The attempt after this rest takes the calibration again first (the picture moved). */
  private recalAfterRest = false;
  /** Since when the subject lock has paused on a jump, null while it follows the subject. */
  private jumpSince: number | null = null;
  private cal: Calibration | null = null;
  private refLength = 0;
  private att: AttemptState | null = null;
  private scored: AttemptRecord[] = [];
  private practiceRecs: AttemptRecord[] = [];
  private retried: AttemptRecord[] = [];
  private retries = 0;
  private practiceDone = false;
  private restUntil = 0;
  private restEnded: number | null = null;
  /** The attempt after this rest repeats the practice (the practice lift used the wrong arm). */
  private nextPractice = false;
  private lastRemaining = -1;
  private notMeasured: ReasonId | null = null;
  private lastRoll: number | null = null;
  private allQuality: QualityReport[] = [];

  constructor(
    readonly def: ShoulderAbductionDef,
    side: TestSide,
    readonly opts: RunnerOptions = {},
  ) {
    if (side === "none") throw new Error("shoulder_abduction needs a side");
    this.side = side;
    this.sides = [side];
    this.L = sideLandmarks(side, !!opts.mirrored);
    this.O = sideLandmarks(otherSide(side), !!opts.mirrored);
    // The gate of spec 4.1 (both shoulders and the tested elbow) with the landmarks the runner
    // measures: on a mirrored camera the model labels the tested arm with the other side's ids.
    this.gateIds = [11, 12, this.L.elbow];
    this.minVis = def.requiredLandmarks.minVisibility;
    this.restSec = opts.restSec ?? def.restSec.betweenAttempts[0];
    this.lock = opts.subject ?? new SubjectLock();
    this.tracker = new SubjectTracker(this.lock);
  }

  get phase(): RunnerPhase {
    return this.phaseNow;
  }

  get done(): boolean {
    return this.finished;
  }

  /** The calibration, once taken (for the record and the UI). */
  get calibration(): Readonly<Calibration> | null {
    return this.cal;
  }

  start(t: number): TestEvent[] {
    this.t0 = t;
    this.tLast = t;
    this.rounds.begin(t);
    this.relockPending = true;
    this.setPhase("calibrating", t);
    if (this.opts.intro ?? true) this.sink.cue("test_abd_start", t);
    this.sink.cue(this.side === "left" ? "check_left_arm" : "check_right_arm", t);
    this.sink.cue("test_abd_arms_rest", t);
    return this.sink.drain();
  }

  feed(frame: Frame, env: FeedEnv = {}): TestEvent[] {
    if (this.finished || this.phaseNow === "idle") return [];
    const t = frame.t;
    this.tLast = t;
    const roll = env.rollDeg ?? null;
    if (roll !== null && Number.isFinite(roll)) this.lastRoll = roll;
    switch (this.phaseNow) {
      case "calibrating":
        this.calibrating(frame, roll);
        break;
      case "practice":
      case "attempt":
        this.attempting(frame, roll);
        break;
      case "rest":
        this.resting(frame, roll);
        break;
      case "ask":
        // The calibration offer is open: the check in stays armed.
        this.track(frame, false);
        break;
      default:
        break;
    }
    return this.sink.drain();
  }

  /**
   * «سأحاول مرة أخرى» on the calibration offer (O35): the next round of the calibration, with the
   * tolerance kept widened. The other answer, skip, is finish(): not measured today (quality).
   */
  retryCalibration(t: number): TestEvent[] {
    if (!this.offerOpen || this.finished) return [];
    this.offerOpen = false;
    this.rounds.retry(t);
    this.calBuf = [];
    this.calMed.reset();
    this.setPhase("calibrating", t);
    this.sink.cue("test_abd_arms_rest", t);
    return this.sink.drain();
  }

  finish(t: number): TestResult {
    // The calibration offer was left for skip: no calibration passed, so nothing was measured.
    if (this.offerOpen && !this.finished) {
      this.offerOpen = false;
      this.notMeasured = "quality";
      this.end(t);
    }
    const completed = this.finished;
    this.tLast = Math.max(this.tLast, t);
    return {
      testId: this.testId,
      kind: this.kind,
      results: [this.sideResult(completed)],
      completed,
      durationSec: round1((this.tLast - this.t0) / 1000),
    };
  }

  /* --------------------------------------------------------------- phases */

  private setPhase(phase: RunnerPhase, t: number, attempt?: number): void {
    this.phaseNow = phase;
    this.sink.push({
      kind: "phase",
      phase,
      t,
      side: this.side,
      ...(attempt !== undefined ? { attempt } : {}),
    });
  }

  private end(t: number): void {
    this.finished = true;
    this.phaseNow = "done";
    this.sink.push({ kind: "phase", phase: "done", t, side: this.side });
    this.sink.push({ kind: "done", t });
  }

  private track(frame: Frame, movement: boolean): Tracked {
    const tr = this.tracker.track(frame);
    const p = tr.pick;
    if (p.reason === "jump") this.jumpSince ??= frame.t;
    else this.jumpSince = null;
    if (p.paused && (p.reason === "overlap" || p.reason === "jump"))
      this.sink.cueEvery("check_one_person", frame.t, RANGE_RULES.onePersonCueEverySec);
    for (const trigger of this.checkin.feed(frame.t, p.lm, frame.aspect, { movement }))
      this.sink.push({ kind: "checkin", trigger, t: frame.t });
    return tr;
  }

  /** Upper arm angle from the downward vertical (before calibration), for the relaxed test. */
  private hangAngle(px: Landmark[], s: SideLandmarks, roll: number | null): number | null {
    if (!seen(px, s.shoulder, this.minVis) || !seen(px, s.elbow, this.minVis)) return null;
    const ms = { x: (px[11].x + px[12].x) / 2, y: (px[11].y + px[12].y) / 2 };
    const a = sub(px[s.elbow], px[s.shoulder]);
    const o = sub(px[s.shoulder], ms);
    return Math.abs(signedAngle(downVector(roll ?? 0), a, o));
  }

  // SPEC-GAP: calibration-per-side. Spec 4.1 calibrates once per check before the first attempt.
  // Each side's runner calibrates again (1 s, arms at the sides), which also re-locks the subject
  // after the rest between sides; every stored measure is the same.
  private calibrating(frame: Frame, roll: number | null): void {
    const t = frame.t;
    // O35: at the end of a round, the offer (try again or skip), or after the last, not measured.
    const due = this.rounds.due(t);
    if (due === "give_up") {
      this.notMeasured = "quality";
      this.end(t);
      return;
    }
    if (due === "offer") {
      this.offerOpen = true;
      this.setPhase("ask", t);
      this.sink.push({ kind: "ask", ask: "calibration", side: this.side, t });
      return;
    }
    // Every calibration locks the subject again, also with a lock shared between sides and after
    // a phone that moved: the lock's reference must be the picture the calibration is taken in.
    if (this.relockPending) {
      if (!this.tracker.lockOn(frame)) return;
      this.relockPending = false;
    }
    const tr = this.track(frame, false);
    const px = tr.px;
    const gateOk =
      !!px &&
      !!tr.raw &&
      seen(px, this.L.shoulder, this.minVis) &&
      seen(px, this.L.elbow, this.minVis) &&
      seen(px, this.O.shoulder, this.minVis);
    const angle = gateOk ? this.hangAngle(px!, this.L, roll ?? this.lastRoll) : null;
    const other = gateOk ? this.hangAngle(px!, this.O, roll ?? this.lastRoll) : null;
    const relaxed =
      angle !== null &&
      angle <= RANGE_RULES.relaxedMaxDeg &&
      (other === null || other <= RANGE_RULES.relaxedMaxDeg);
    if (!relaxed) {
      this.calBuf = [];
      this.calMed.reset();
      return;
    }
    // The stillness rule reads the running median of the angle, as the attempts do (landmark
    // jitter alone would otherwise spread the raw angles past the range at a high frame rate).
    this.calBuf.push({
      t,
      px: px!,
      raw: tr.raw!,
      aspect: frame.aspect,
      roll: roll ?? this.lastRoll,
      angle: this.calMed.push(t, angle!),
    });
    const from = t - RANGE_RULES.calibrationSec * 1000;
    while (this.calBuf.length > 1 && this.calBuf[1].t <= from) this.calBuf.shift();
    if (this.calBuf[0].t > from) return;
    const angles = this.calBuf.map((s) => s.angle);
    // O35: the tolerance doubles after 10 s without a still window; the reference stays the median.
    if (Math.max(...angles) - Math.min(...angles) > this.rounds.tolerance(RANGE_RULES.calibrationStillDeg, t))
      return;
    this.calibrate(t);
  }

  private calibrate(t: number): void {
    const buf = this.calBuf;
    const mv = this.minVis;
    const hipsSeen = buf.filter((s) => seen(s.px, 23, mv) && seen(s.px, 24, mv));
    const trunk = hipsSeen.length / buf.length >= RANGE_RULES.hipsVisibleShare;
    const rolls = buf.map((s) => s.roll).filter((r): r is number => r !== null);
    const roll = median(rolls);
    if (!trunk && roll === null) {
      // Spec 4.1: without an orientation reading gravity mode is not allowed: not measured today.
      this.notMeasured = "quality";
      this.end(t);
      return;
    }
    const med = (f: (s: CalSample) => number, of: CalSample[] = buf) => median(of.map(f))!;
    const fixedHip = trunk
      ? {
          x: med((s) => (s.px[23].x + s.px[24].x) / 2, hipsSeen),
          y: med((s) => (s.px[23].y + s.px[24].y) / 2, hipsSeen),
        }
      : null;
    const midShoulder = {
      x: med((s) => (s.px[11].x + s.px[12].x) / 2),
      y: med((s) => (s.px[11].y + s.px[12].y) / 2),
    };
    const shoulderWidth = med((s) => norm(sub(s.px[11], s.px[12])));
    const earSeen = buf.filter((s) => seen(s.px, this.L.ear, mv));
    const earToShoulder = earSeen.length
      ? med((s) => norm(sub(s.px[this.L.ear], s.px[this.L.shoulder])), earSeen)
      : null;
    const upperArm = med((s) => norm(sub(s.px[this.L.elbow], s.px[this.L.shoulder])));
    const lean = fixedHip
      ? med((s) =>
          leanFromVertical(
            fixedHip,
            { x: (s.px[11].x + s.px[12].x) / 2, y: (s.px[11].y + s.px[12].y) / 2 },
            roll ?? 0,
          ),
        )
      : 0;
    // A calibration taken again (the picture moved) keeps the practice's reference length, scaled
    // by the new upper arm length (a phone moved nearer or further changes every length alike).
    const before = this.cal;
    this.refLength =
      before && this.practiceDone
        ? Math.max(upperArm, (this.refLength * upperArm) / before.upperArm)
        : upperArm;
    this.cal = {
      reference: trunk ? "trunk" : "gravity",
      fixedHip,
      midShoulder,
      shoulderWidth,
      lean,
      roll,
      earToShoulder,
      upperArm,
      t,
    };
    const last = buf[buf.length - 1];
    this.checkin.setReference(checkInReference(last.raw, last.aspect));
    this.calBuf = [];
    this.calMed.reset();
    this.startAttempt(t, this.nextPractice || !this.practiceDone);
  }

  /** Takes the calibration again (and the subject lock with it), then goes on with the attempts. */
  private recalibrate(t: number): void {
    this.recalAfterRest = false;
    this.calBuf = [];
    this.calMed.reset();
    this.rounds.begin(t);
    this.relockPending = true;
    this.setPhase("calibrating", t);
    this.sink.cue("test_abd_arms_rest", t);
  }

  private startAttempt(t: number, practice: boolean): void {
    const index = practice ? 0 : this.scored.length + 1;
    this.att = {
      practice,
      index,
      t0: t,
      // The gate uses the model's labels for the tested side (swapped on a mirrored camera); the
      // retry cues keep the person's own side.
      monitor: new QualityMonitor({
        ...qualityConfig(this.def, this.side, { trunkReference: this.cal!.reference === "trunk" }),
        gate: [...this.gateIds],
      }),
      peak: new SustainedPeak(this.def.holdSec * 1000, RANGE_RULES.maxGapMs),
      otherPeak: new SustainedPeak(this.def.holdSec * 1000, RANGE_RULES.maxGapMs),
      angleMed: new RunningMedian(RANGE_RULES.medianSec * 1000),
      lenMed: new RunningMedian(RANGE_RULES.medianSec * 1000),
      otherMed: new RunningMedian(RANGE_RULES.medianSec * 1000),
      samples: [],
      lifted: false,
      maxAngle: 0,
      lowSince: null,
      below60: false,
      planeOkAny: false,
      planeFlexion: false,
      leanCoach: new Persist(RANGE_RULES.persistSec),
      leanInvalid: new Persist(RANGE_RULES.persistSec),
      leanMax: 0,
      shrink: new Persist(RANGE_RULES.persistSec),
      shrinkMax: 0,
      assist: new Persist(RANGE_RULES.persistSec),
      pastVertical: new Persist(RANGE_RULES.persistSec),
      wrongArm: false,
      cameraMoved: false,
      said: new Set(),
      lastLive: null,
      lastPeakShown: -1,
      rolls: [],
      hipMedX: new RunningMedian(RANGE_RULES.medianSec * 1000),
      hipMedY: new RunningMedian(RANGE_RULES.medianSec * 1000),
      moved: new Persist(RANGE_RULES.persistSec),
    };
    this.setPhase(practice ? "practice" : "attempt", t, index);
    if (practice && !this.practiceDone) this.sink.cue("test_abd_thumb", t);
    this.sink.cue("test_abd_raise", t);
  }

  private cueOnce(cue: CheckCueId, t: number): void {
    const a = this.att!;
    if (a.said.has(cue)) return;
    a.said.add(cue);
    this.sink.cue(cue, t);
  }

  /** The measures of one frame, or null when the frame cannot be scored. */
  private measure(px: Landmark[] | null, roll: number | null): Measure | null {
    const c = this.cal!;
    const mv = this.minVis;
    if (
      !px ||
      !seen(px, this.L.shoulder, mv) ||
      !seen(px, this.L.elbow, mv) ||
      !seen(px, this.O.shoulder, mv)
    )
      return null;
    const ms = { x: (px[11].x + px[12].x) / 2, y: (px[11].y + px[12].y) / 2 };
    let down: Pt;
    let lean: number;
    let rollUsed: number | null = null;
    if (c.reference === "trunk") {
      down = sub(c.fixedHip!, ms);
      const r = c.roll === null ? 0 : (roll ?? this.lastRoll ?? c.roll);
      if (c.roll !== null) rollUsed = r;
      lean = leanFromVertical(c.fixedHip!, ms, r) - c.lean;
    } else {
      const r = roll ?? this.lastRoll;
      if (r === null) return null;
      rollUsed = r;
      down = downVector(r);
      lean = dot(sub(ms, c.midShoulder), acrossVector(r)) / c.shoulderWidth;
    }
    if (norm(down) < 1e-6) return null;
    const S = px[this.L.shoulder];
    const E = px[this.L.elbow];
    const arm = sub(E, S);
    const theta = signedAngle(down, arm, sub(S, ms));
    const pastVertical = theta < -90;
    const angle = theta >= 0 ? theta : pastVertical ? 180 : 0;

    let other: number | null = null;
    if (seen(px, this.O.elbow, mv)) {
      const OS = px[this.O.shoulder];
      const th = signedAngle(down, sub(px[this.O.elbow], OS), sub(OS, ms));
      other = th >= 0 ? th : th < -90 ? 180 : 0;
    }
    const wristSeen = seen(px, this.L.wrist, mv);
    const elbow = wristSeen ? jointAngle(S, E, px[this.L.wrist]) : null;
    const shrug =
      c.earToShoulder !== null && seen(px, this.L.ear, mv)
        ? (c.earToShoulder - norm(sub(px[this.L.ear], S))) / c.shoulderWidth
        : null;
    const near = RANGE_RULES.assistShoulderWidths * c.shoulderWidth;
    const assist = this.O.hand.some(
      (h) =>
        seen(px, h, mv) &&
        (segmentDistance(px[h], S, E) < near ||
          (wristSeen && segmentDistance(px[h], E, px[this.L.wrist]) < near)),
    );
    return {
      angle,
      pastVertical,
      len: norm(arm),
      other,
      elbow,
      shrug,
      planeZ: E.z - S.z,
      lean,
      width: norm(sub(px[11], px[12])),
      assist,
      roll: rollUsed,
    };
  }

  private attempting(frame: Frame, roll: number | null): void {
    const a = this.att!;
    const t = frame.t;
    const tr = this.track(frame, true);
    a.monitor.feedPick(frame, tr.pick);
    const raw = tr.pick.paused ? null : this.measure(tr.px, roll);
    const R = RANGE_RULES;
    if (raw && t - (a.samples[a.samples.length - 1]?.t ?? t) > R.maxGapMs) {
      a.angleMed.reset();
      a.lenMed.reset();
      a.otherMed.reset();
    }
    if (!raw) {
      a.peak.gap();
      a.otherPeak.gap();
      a.angleMed.reset();
      a.lenMed.reset();
      a.otherMed.reset();
    } else {
      const m: Measure = {
        ...raw,
        angle: a.angleMed.push(t, raw.angle),
        len: a.lenMed.push(t, raw.len),
        other: raw.other === null ? null : a.otherMed.push(t, raw.other),
      };
      if (raw.other === null) a.otherMed.reset();
      const c = this.cal!;
      const gravity = c.reference === "gravity";
      a.samples.push({
        t,
        angle: m.angle,
        len: m.len,
        elbow: m.elbow,
        shrug: m.shrug,
        planeZ: m.planeZ,
        lean: m.lean,
        pastVertical: m.pastVertical,
      });
      if (m.roll !== null) a.rolls.push(m.roll);
      const live = Math.round(m.angle);
      if (live !== a.lastLive) {
        a.lastLive = live;
        this.sink.push({ kind: "live", value: live, t, side: this.side });
      }
      const wmin = a.peak.push(t, m.angle);
      if (a.peak.best) {
        const shown = Math.round(clampDeg(a.peak.best.value));
        if (shown > a.lastPeakShown) {
          a.lastPeakShown = shown;
          this.sink.push({ kind: "peak", value: shown, t, side: this.side });
        }
      }
      if (m.other !== null) a.otherPeak.push(t, m.other);
      else a.otherPeak.gap();
      if (m.angle >= R.relaxedMaxDeg) a.lifted = true;
      a.maxAngle = Math.max(a.maxAngle, m.angle);

      // Side labelling (spec 4.0): the other arm moved, the asked one stayed down.
      if (a.maxAngle < R.relaxedMaxDeg && a.otherPeak.best && a.otherPeak.best.value >= R.wrongArmDeg) {
        a.wrongArm = true;
        this.endAttempt(t);
        return;
      }

      // Plane check (spec 4.1): the reference length is the calibration length in the practice lift.
      const ref = a.practice ? c.upperArm : this.refLength;
      if (m.angle < R.planeFlexionFrom) a.below60 = true;
      if (
        m.angle >= R.planeWindow[0] &&
        m.angle <= R.planeWindow[1] &&
        m.len >= this.def.validity.upperArmLengthMinRatio * ref
      )
        a.planeOkAny = true;
      if (!a.planeFlexion && a.below60 && m.angle > R.planeFlexionTo && !a.planeOkAny) {
        a.planeFlexion = true;
        this.cueOnce("test_abd_side", t);
      }

      // The picture moved since the calibration (camera-moved): the live mid hip, when both hips
      // are seen, away from the fixed one.
      const px = tr.px!;
      if (!gravity && seen(px, 23, this.minVis) && seen(px, 24, this.minVis)) {
        const hx = a.hipMedX.push(t, (px[23].x + px[24].x) / 2);
        const hy = a.hipMedY.push(t, (px[23].y + px[24].y) / 2);
        const off = Math.hypot(hx - c.fixedHip!.x, hy - c.fixedHip!.y) / c.shoulderWidth;
        if (a.moved.update(t, off > R.cameraMovedShoulderWidths)) {
          a.cameraMoved = true;
          this.endAttempt(t);
          return;
        }
      }

      // Trunk lean from calibration (spec 4.1 validity).
      const leanAbs = Math.abs(m.lean);
      a.leanMax = Math.max(a.leanMax, leanAbs);
      const coach = gravity ? R.gravityLeanCue : this.def.validity.trunkLeanCoachDeg;
      const invalid = gravity ? R.gravityLeanInvalid : this.def.validity.trunkLeanInvalidDeg;
      if (a.leanCoach.update(t, leanAbs > coach)) this.cueOnce("test_abd_still", t);
      a.leanInvalid.update(t, leanAbs > invalid);

      // Rotation: shoulder width shrink.
      const shrink = 1 - m.width / c.shoulderWidth;
      a.shrinkMax = Math.max(a.shrinkMax, shrink);
      a.shrink.update(t, shrink > this.def.validity.shoulderWidthShrinkInvalid);

      // Assisted lift: the other hand near the tested arm while it is lifted.
      if (this.def.validity.otherHandNearTestedArmInvalid)
        a.assist.update(t, m.assist && m.angle >= R.relaxedMaxDeg);
      a.pastVertical.update(t, m.pastVertical);

      // Coaching only: the shrug.
      if (m.shrug !== null && m.shrug > R.shrugCue && m.angle >= R.relaxedMaxDeg)
        this.cueOnce("test_abd_relax_shoulder", t);

      // Hold and lower cues.
      if (a.lifted && !a.said.has("test_abd_hold") && m.angle >= R.relaxedMaxDeg) {
        const back = sampleBefore(a.samples, t - R.holdCueSec * 1000);
        if (back && t - back.t <= R.maxGapMs + R.holdCueSec * 1000) {
          const speed = Math.abs(m.angle - back.angle) / ((t - back.t) / 1000);
          if (speed < R.holdCueDegPerSec) this.cueOnce("test_abd_hold", t);
        }
      }
      if (a.said.has("test_abd_hold") && wmin !== null && wmin >= a.maxAngle - R.lowerCueWithinDeg)
        this.cueOnce("test_abd_lower", t);

      // End: the arm is back down.
      if (a.lifted && m.angle < R.relaxedMaxDeg) {
        a.lowSince ??= t;
        if (t - a.lowSince >= R.lowerHoldSec * 1000) {
          this.endAttempt(t);
          return;
        }
      } else a.lowSince = null;
    }
    if (t - a.t0 > R.attemptTimeoutSec * 1000) this.endAttempt(t);
  }

  // SPEC-GAP: plane-duration. "At least 0.3 s" is read as the total time of qualifying frames over
  // the ascent (from the attempt start to the end of the held peak), not one unbroken run, so one
  // noisy frame does not reset it. A flexion plane lift has no qualifying frames either way.
  /** Time over the ascent with the plane check met (spec 4.1: over the whole ascent, not at the peak). */
  private planeOkSec(a: AttemptState, ref: number, until: number): number {
    const R = RANGE_RULES;
    let sec = 0;
    for (let i = 1; i < a.samples.length; i++) {
      const s = a.samples[i];
      if (s.t > until) break;
      const dt = s.t - a.samples[i - 1].t;
      if (dt > R.maxGapMs) continue;
      if (
        s.angle >= R.planeWindow[0] &&
        s.angle <= R.planeWindow[1] &&
        s.len >= this.def.validity.upperArmLengthMinRatio * ref
      )
        sec += dt / 1000;
    }
    return sec;
  }

  private endAttempt(t: number): void {
    const a = this.att!;
    this.att = null;
    const q = a.monitor.report();
    this.allQuality.push(q);
    const R = RANGE_RULES;
    const best = a.peak.best;
    const value = best ? Math.round(clampDeg(best.value)) : null;
    const peakSamples = best ? a.samples.filter((s) => s.t >= best.from && s.t <= best.t) : [];
    const at = (f: (s: Sample) => number | null) =>
      median(peakSamples.map(f).filter((x): x is number => x !== null));
    const elbow = at((s) => s.elbow);
    const shrug = at((s) => s.shrug);
    const planeZ = at((s) => s.planeZ);
    const leanAtPeak = at((s) => s.lean);
    const gravity = this.cal!.reference === "gravity";
    const flags: string[] = [];
    const bentElbow = elbow === null ? "unknown" : elbow < this.def.validity.elbowFlagBelowDeg;
    if (bentElbow === true) flags.push("bentElbow");
    if (a.pastVertical.hit) flags.push("pastVertical");
    const ref = a.practice ? this.cal!.upperArm : this.refLength;
    const planeSec = this.planeOkSec(a, ref, best ? best.t : t);
    // SPEC-GAP: plane-below-window. Read literally, an attempt whose angle never reaches 70 degrees
    // has no frames in the window and would always be invalid, so a person with less range could
    // never be measured. The check needs the window: when the held value is below 70 the attempt
    // stays valid and is flagged planeUnchecked (a lift in front of the body reads lower in 2D, not
    // higher, below the window, spec 4.1 evidence notes). Flagged for sign-off.
    const planeApplies = value !== null && value >= R.planeWindow[0];
    if (!planeApplies) flags.push("planeUnchecked");
    const detail: Detail = {
      elbowDeg: elbow === null ? "unknown" : Math.round(elbow),
      bentElbow,
      pastVertical: a.pastVertical.hit,
      shrug: shrug === null ? "unknown" : round3(shrug),
      planeZ: planeZ === null ? "unknown" : round3(planeZ),
      planeOkSec: round1(planeSec),
      shoulderShrinkMax: round3(Math.max(0, a.shrinkMax)),
    };
    if (gravity) {
      detail.leanShiftMax = round3(a.leanMax);
      if (leanAtPeak !== null) detail.leanShiftAtPeak = round3(leanAtPeak);
      const roll = median(a.rolls);
      if (roll !== null) detail.phoneRollDeg = round1(roll);
    } else {
      detail.trunkLeanMax = round1(a.leanMax);
      if (leanAtPeak !== null) detail.trunkLeanAtPeak = round1(leanAtPeak);
    }
    const rec: AttemptRecord = {
      side: this.side,
      index: a.index,
      outcome: "practice",
      value,
      reasons: [],
      flags,
      censored: false,
      detail,
      quality: q,
      t0: a.t0,
      t1: t,
    };

    if (a.practice && !a.wrongArm && !a.cameraMoved) {
      // Reference length: the larger of the hanging length and the longest upper arm seen between
      // 70 and 110 degrees in the practice lift (spec 4.1).
      const inWindow = a.samples.filter((s) => s.angle >= R.planeWindow[0] && s.angle <= R.planeWindow[1]);
      this.refLength = Math.max(this.cal!.upperArm, ...inWindow.map((s) => s.len));
      this.practiceRecs.push(rec);
      this.practiceDone = true;
      this.sink.push(this.attemptEvent(rec, t));
      this.rest(t);
      return;
    }

    if (a.wrongArm || a.cameraMoved || !q.ok) {
      rec.outcome = "retry";
      rec.reasons = a.wrongArm ? ["wrong_arm"] : a.cameraMoved ? ["camera_moved"] : [...q.issues];
      this.retried.push(rec);
      this.sink.push(this.attemptEvent(rec, t));
      // SPEC-GAP: retry-budget. The wrong arm (and a wrong arm practice lift) uses the same 2 extra
      // attempts as a failed quality gate. Once they are used, the side is not measured today even
      // when earlier attempts were valid (the literal "then not measured today").
      if (this.retries >= this.def.maxRetries) {
        // Spec 4.1: failed attempts are repeated up to 2 extra per side, then not measured today.
        this.notMeasured = "quality";
        this.end(t);
        return;
      }
      this.retries++;
      if (a.cameraMoved) {
        // The calibration is taken again in the new picture before the next attempt.
        this.sink.cue("check_phone_still", t);
        this.recalAfterRest = true;
      } else if (!a.wrongArm && q.cue && q.cue !== "check_try_again") this.sink.cue(q.cue, t);
      this.sink.cue("check_try_again", t);
      this.rest(t, a.practice);
      return;
    }

    const reasons: string[] = [];
    if (a.planeFlexion) reasons.push("plane_flexion");
    else if (planeApplies && planeSec < R.planeMinSec) reasons.push("plane_unconfirmed");
    if (a.leanInvalid.hit) reasons.push("trunk_lean");
    if (a.shrink.hit) reasons.push("trunk_rotation");
    if (a.assist.hit) reasons.push("assisted");
    if (value === null) reasons.push("no_hold");
    rec.outcome = reasons.length ? "invalid" : "valid";
    rec.reasons = reasons;
    this.scored.push(rec);
    this.sink.push(this.attemptEvent(rec, t));
    for (const f of flags) this.sink.push({ kind: "flag", flag: f, t, side: this.side });
    if (rec.outcome === "valid") this.sink.cue("check_saved", t);
    if (this.scored.length >= this.def.attempts) {
      this.end(t);
      return;
    }
    this.rest(t);
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

  private rest(t: number, practiceAgain = false): void {
    this.nextPractice = practiceAgain;
    this.restUntil = t + this.restSec * 1000;
    this.restEnded = null;
    this.lastRemaining = -1;
    this.setPhase("rest", t);
    if (this.restSec > 0) this.sink.cue("check_rest_short", t);
  }

  private resting(frame: Frame, roll: number | null): void {
    const t = frame.t;
    const tr = this.track(frame, false);
    // A phone that slipped: one person in the picture and the lock pausing on a jump for a while.
    if (
      this.jumpSince !== null &&
      t - this.jumpSince >= RANGE_RULES.relockAfterSec * 1000 &&
      tr.pick.others === 1
    ) {
      this.sink.cue("check_phone_still", t);
      this.recalibrate(t);
      return;
    }
    if (t < this.restUntil) {
      const remaining = Math.ceil((this.restUntil - t) / 1000);
      if (remaining !== this.lastRemaining) {
        this.lastRemaining = remaining;
        this.sink.push({ kind: "time", remainingSec: remaining, t });
      }
      return;
    }
    this.restEnded ??= t;
    // The next attempt starts with both arms down, or after restWaitMaxSec anyway.
    const px = tr.px;
    const r = roll ?? this.lastRoll ?? this.cal!.roll;
    const tested = px ? this.hangAngle(px, this.L, r) : null;
    const other = px ? this.hangAngle(px, this.O, r) : null;
    const down =
      tested !== null &&
      tested <= RANGE_RULES.relaxedMaxDeg &&
      (other === null || other <= RANGE_RULES.relaxedMaxDeg);
    if (this.recalAfterRest) {
      this.recalibrate(t);
      return;
    }
    if (down || t - this.restEnded >= RANGE_RULES.restWaitMaxSec * 1000)
      this.startAttempt(t, this.nextPractice || !this.practiceDone);
  }

  /* --------------------------------------------------------------- result */

  private sideResult(completed: boolean): SideResult {
    const valid = this.scored.filter((a) => a.outcome === "valid" && a.value !== null);
    const values = valid.map((a) => a.value!);
    const gravity = this.cal?.reference === "gravity";
    // SPEC-GAP: no-valid-reason. With no valid attempt there is no value; the reason shown is
    // quality ("We could not measure this clearly today"), the closest reason of spec 3.6.
    const notMeasured: ReasonId | null = this.notMeasured ?? (completed && !values.length ? "quality" : null);
    const status = notMeasured ? "not_measured" : completed ? "measured" : "stopped";
    const value = !notMeasured && values.length ? Math.max(...values) : null;
    const med = !notMeasured && values.length ? Math.round(median(values)!) : null;
    const flags: string[] = [];
    const spread = values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
    if (values.length > 1 && spread > this.def.validity.attemptSpreadFlagDeg) flags.push("inconsistent");
    if (gravity) flags.push("gravity_reference");
    if (valid.some((a) => a.flags.includes("bentElbow"))) flags.push("bentElbow");
    if (valid.some((a) => a.flags.includes("pastVertical"))) flags.push("pastVertical");
    const bestRec = value === null ? null : valid.find((a) => a.value === value)!;
    const detail: Detail = {
      reference: this.cal ? this.cal.reference : "unknown",
      bentElbow: valid.some((a) => a.detail.bentElbow === true)
        ? true
        : valid.length && valid.every((a) => a.detail.bentElbow === "unknown")
          ? "unknown"
          : false,
      pastVertical: flags.includes("pastVertical"),
      spreadDeg: spread,
    };
    if (bestRec) {
      for (const k of ["planeZ", "elbowDeg", "shrug", "trunkLeanAtPeak", "leanShiftAtPeak", "phoneRollDeg"]) {
        if (bestRec.detail[k] !== undefined) detail[k] = bestRec.detail[k];
      }
    }
    const fps = this.allQuality.map((q) => q.fps).filter((f) => f > 0);
    const issues = new Set<QualityIssue>();
    for (const r of this.retried) for (const i of r.quality.issues) issues.add(i);
    return {
      testId: this.testId,
      side: this.side,
      unit: this.def.unit,
      status,
      reason: notMeasured,
      value,
      median: med,
      nValid: values.length,
      censored: false,
      attempts: [...this.scored],
      practice: [...this.practiceRecs],
      retried: [...this.retried],
      detail,
      flags,
      quality: {
        ok: this.notMeasured !== "quality",
        retries: this.retried.length,
        issues: [...issues],
        medianFps: fps.length ? round1(median(fps)!) : null,
        maxPausedShare: Math.max(0, ...this.allQuality.map((q) => q.pausedShare)),
      },
      durationSec: round1((this.tLast - this.t0) / 1000),
    };
  }
}
