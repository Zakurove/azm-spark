/**
 * Check in for the movement check (spec 4.0 "Check in", contract v2 section F). Pure TS, no DOM.
 *
 * Triggers (CHECK_DATA.stopRouting.checkIn.triggers) run the check in, cue `check_are_you_ok`:
 *   - the person leaves the frame;
 *   - the hips drop toward the floor;
 *   - a big sideways sway;
 *   - no movement for 10 s during a test;
 *   - no answer to the stop list within 30 s (`CheckInFlow`).
 * Counts as fine (checkIn.okWhen): a wrist held above the same shoulder for 1 s (`RaisedHandDetector`),
 * a tap anywhere on the screen, or the spoken words where speech recognition exists (both UI).
 * No response within 15 s: a loud repeating tone and the full screen scr_no_response (`CheckInFlow`).
 *
 * These are prompts to ask, never a fall detector (spec 4.3: the app is not a fall detector).
 * Detectors measure in pixel space against a reference taken at calibration.
 */
import { CHECK_DATA } from "../movements/assessments";
import type { CheckCueId, ScreenId, TestId } from "../movements/types";
import { isPerson, leanDeg, midHip, Pt, shoulderPx, trunkPx, visible } from "./body";
import { toPixelSpace } from "./geometry";
import { Landmark, LM } from "./types";

const checkIn = CHECK_DATA.stopRouting.checkIn;

/** Timing of the check in. The first two are numbers in the data; the last two are in its prose. */
export const CHECKIN_TIMING = {
  /** No answer to the stop list within 30 s runs the check in (stopRouting.noAnswerSec). */
  noAnswerSec: CHECK_DATA.stopRouting.noAnswerSec,
  /** No response to the check in within 15 s (checkIn.noResponseSec, tune at booth). */
  noResponseSec: checkIn.noResponseSec,
  /** "no movement for 10 s during a test" (checkIn.triggers; tests/checkin.test.ts ties it to the text). */
  noMovementSec: 10,
  /** "a wrist held above the same shoulder for 1 s" (checkIn.okWhen; tied to the text by the test). */
  raisedHandSec: 1,
} as const;

/**
 * The check in cue at the booth for a person who may raise a hand, `check_are_you_ok`
 * (stopRouting.checkIn.cueSelection.booth.raiseAllowed). Revision 1.1 removed the single cue field.
 */
// SPEC-GAP: checkin-cue-selection. Revision 1.1 selects the cue by setting, raiseAllowed,
// noArmSignal, on device speech and the fall watch (cueSelection, O33 (f)); that selection belongs to
// the engine round (check in fine signal). The booth build asks raise allowed visitors with this
// form; evaluatePrecheck returns raiseAllowed and noArmSignal for the selection.
export const CHECKIN_CUE: CheckCueId = checkIn.cueSelection.booth.raiseAllowed;
/** The full screen after no response. */
export const NO_RESPONSE_SCREEN: ScreenId = "scr_no_response";

/**
 * Geometry of the triggers. The spec names the triggers but gives no measures; every value here is
 * a starting point to tune at booth.
 */
export const CHECKIN_TUNING = {
  // SPEC-GAP: leave-time. The subject is missing (or both shoulders unseen) for this long.
  leftFrameSec: 1,
  // SPEC-GAP: hips-drop. The mid hip is lower than at calibration by this many calibration trunk
  // lengths (about 17 cm for an adult). A seated pelvis stays on the seat, and a chair stand only
  // returns to the seat, so only a slide or a fall goes this low.
  hipsDropTrunks: 0.35,
  // SPEC-GAP: sway. A big sideways sway is a turn of this many degrees away from the calibration
  // angle, of the trunk line or of the shoulder line (see SwayMeasure). The side lean, where leaning
  // is the task, passes its own larger limit per frame (feed option swayDeg).
  swayDeg: 25,
  // SPEC-GAP: trigger-sustain. A hips drop or sway must last this long, so one bad frame is not a trigger.
  sustainSec: 0.3,
  // SPEC-GAP: no-movement. Still means every visible key point stays within this many trunk lengths
  // (about 5 cm) over the 10 s, measured on 0.5 s averages so model jitter is not movement.
  stillTrunks: 0.1,
  stillBinSec: 0.5,
  /**
   * The shoulder line has no direction when the shoulders overlap in the picture (a side view):
   * below this pixel shoulder width ÷ trunk length the shoulder measure is not taken.
   */
  shoulderLineMinRatio: 0.25,
} as const;

export type CheckInTuning = { -readonly [K in keyof typeof CHECKIN_TUNING]: number };
export type CheckInTrigger = "left_frame" | "hips_drop" | "sway" | "no_movement" | "no_answer";

/**
 * What the sway rule measures.
 *   - "trunk": the trunk line (mid hip to mid shoulder) from the image vertical. Right for a front
 *     view; in a side view it shows a big forward or backward sway, the only sway a side view sees.
 *   - "shoulders": the shoulder line from the image horizontal. For the chair stand's 45 degree
 *     view, where the trunk line mixes forward and sideways lean at about 0.71 each (spec 4.4), so
 *     every normal forward bend while rising would read as a sway. A forward bend keeps the shoulder
 *     line level; a sideways sway tilts it (by more than the lean itself in a turned view).
 */
export type SwayMeasure = "trunk" | "shoulders";

// SPEC-GAP: sway-oblique. The spec lists a big sideways sway among the chair stand's camera
// triggers but the trunk line cannot separate sideways from forward lean in its 45 degree view;
// the shoulder line is used there so the trigger stays on through every stand.
/** The sway measure of each test (the chair stand is filmed at 45 degrees). */
export function swayMeasureFor(testId: TestId): SwayMeasure {
  return testId === "chair_stand_30s" ? "shoulders" : "trunk";
}

/**
 * Shoulder line angle from the image horizontal in degrees, pixel space, the same whichever
 * shoulder is on the left of the picture; null when the shoulders are too close together in the
 * picture to give the line a direction.
 */
export function shoulderLineDeg(
  p: Landmark[],
  minRatio: number = CHECKIN_TUNING.shoulderLineMinRatio,
): number | null {
  const trunk = trunkPx(p);
  if (trunk < 1e-3 || shoulderPx(p) < minRatio * trunk) return null;
  let dx = p[LM.r_shoulder].x - p[LM.l_shoulder].x;
  let dy = p[LM.r_shoulder].y - p[LM.l_shoulder].y;
  if (dx < 0) {
    dx = -dx;
    dy = -dy;
  }
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * Calibration pose of the subject, pixel space. Take it in the calibration position the test
 * starts from, seated for every v1 test (the chair stand included), so the hips drop rule measures
 * from the seat.
 */
export interface CheckInReference {
  hip: Pt;
  /** Trunk angle from the image vertical (body.ts leanDeg). */
  lean: number;
  /** Shoulder line angle (shoulderLineDeg), null when it cannot be measured. */
  shoulders: number | null;
  /** Mid shoulder to mid hip length. */
  trunk: number;
}

/** The reference from a calibration pose, or null when it is not a person. */
export function checkInReference(lm: Landmark[], aspect?: number): CheckInReference | null {
  if (!isPerson(lm)) return null;
  const p = toPixelSpace(lm, aspect);
  const trunk = trunkPx(p);
  if (trunk < 1e-3) return null;
  return { hip: midHip(p), lean: leanDeg(p), shoulders: shoulderLineDeg(p), trunk };
}

export interface CheckInDetectorOptions {
  /** Default "trunk"; use swayMeasureFor(testId). */
  swayMeasure?: SwayMeasure;
}

export interface CheckInFeedOptions {
  /** Evaluate the sway rule in this frame (default true). */
  sway?: boolean;
  /** The sway limit in this frame, in degrees (default tuning.swayDeg). */
  swayDeg?: number;
  /**
   * Evaluate the no movement rule in this frame (default true). Feed only during a test; the
   * runner decides whether a rest between attempts counts.
   */
  movement?: boolean;
}

const KEY_POINTS = [LM.nose, 11, 12, 13, 14, 15, 16, 23, 24];

type Timed = "left_frame" | "hips_drop" | "sway";

/**
 * Detects the camera triggers frame by frame. `feed` returns the triggers that START in this frame:
 * each fires once, and fires again only after its condition has stayed clear for its own hold time,
 * so a reading that flickers around a limit does not fire again and again.
 */
export class CheckInDetector {
  private ref: CheckInReference | null = null;
  private since: Record<Timed, number | null> = { left_frame: null, hips_drop: null, sway: null };
  private clearSince: Record<Timed, number | null> = { left_frame: null, hips_drop: null, sway: null };
  private active = new Set<CheckInTrigger>();
  private track: { t: number; pts: (Pt | null)[] }[] = [];
  private readonly tuning: CheckInTuning;
  readonly swayMeasure: SwayMeasure;

  constructor(tuning: Partial<CheckInTuning> = {}, opts: CheckInDetectorOptions = {}) {
    this.tuning = { ...CHECKIN_TUNING, ...tuning };
    this.swayMeasure = opts.swayMeasure ?? "trunk";
  }

  setReference(ref: CheckInReference | null): void {
    this.ref = ref;
  }

  get reference(): CheckInReference | null {
    return this.ref;
  }

  reset(): void {
    this.since = { left_frame: null, hips_drop: null, sway: null };
    this.clearSince = { left_frame: null, hips_drop: null, sway: null };
    this.active.clear();
    this.track = [];
  }

  /**
   * One frame: the subject's landmarks (null when the subject lock has no trusted subject), time in
   * ms and the frame's aspect ratio.
   */
  feed(t: number, lm: Landmark[] | null, aspect?: number, opts: CheckInFeedOptions = {}): CheckInTrigger[] {
    const out: CheckInTrigger[] = [];
    const person = isPerson(lm) ? lm : null;
    const shouldersSeen =
      !!person &&
      (visible(person, LM.l_shoulder) || visible(person, LM.r_shoulder)) &&
      [person[LM.l_shoulder], person[LM.r_shoulder]].some(
        (q) => q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1,
      );
    const p = person ? toPixelSpace(person, aspect) : null;
    const ref = this.ref;
    const tu = this.tuning;

    const left = !shouldersSeen;
    this.timed("left_frame", left, t, tu.leftFrameSec, out);

    const drop = !left && !!ref && !!p && midHip(p).y - ref.hip.y > tu.hipsDropTrunks * ref.trunk;
    this.timed("hips_drop", drop, t, tu.sustainSec, out);

    const turn = !left && !!ref && !!p && opts.sway !== false ? this.swayTurn(p, ref) : null;
    const sway = turn !== null && turn > (opts.swayDeg ?? tu.swayDeg);
    this.timed("sway", sway, t, tu.sustainSec, out);

    if (left || !p || opts.movement === false) {
      this.track = [];
      this.active.delete("no_movement");
    } else {
      this.track.push({ t, pts: KEY_POINTS.map((i) => (visible(p, i) ? { x: p[i].x, y: p[i].y } : null)) });
      const still = this.stillFor(t, ref?.trunk ?? trunkPx(p));
      if (still && !this.active.has("no_movement")) {
        this.active.add("no_movement");
        out.push("no_movement");
      } else if (!still) this.active.delete("no_movement");
    }
    return out;
  }

  /** Degrees the measured line turned from the reference, or null when it cannot be measured. */
  private swayTurn(p: Landmark[], ref: CheckInReference): number | null {
    if (this.swayMeasure === "trunk") return Math.abs(leanDeg(p) - ref.lean);
    const now = shoulderLineDeg(p, this.tuning.shoulderLineMinRatio);
    return now === null || ref.shoulders === null ? null : Math.abs(now - ref.shoulders);
  }

  /** A trigger starts after its condition held `sec`, and re-arms after it stayed clear as long. */
  private timed(k: Timed, on: boolean, t: number, sec: number, out: CheckInTrigger[]): void {
    if (!on) {
      this.since[k] = null;
      if (this.active.has(k)) {
        if (this.clearSince[k] === null) this.clearSince[k] = t;
        if (t - this.clearSince[k]! >= sec * 1000) {
          this.active.delete(k);
          this.clearSince[k] = null;
        }
      }
      return;
    }
    this.clearSince[k] = null;
    if (this.since[k] === null) this.since[k] = t;
    if (!this.active.has(k) && t - this.since[k]! >= sec * 1000) {
      this.active.add(k);
      out.push(k);
    }
  }

  /** True when the track covers the last 10 s and no key point moved beyond the still band. */
  private stillFor(now: number, trunk: number): boolean {
    const windowMs = CHECKIN_TIMING.noMovementSec * 1000;
    const binMs = this.tuning.stillBinSec * 1000;
    while (this.track.length > 1 && this.track[1].t <= now - windowMs) this.track.shift();
    if (!this.track.length || this.track[0].t > now - windowMs) return false;
    const inWindow = this.track.filter((e) => e.t >= now - windowMs);
    const limit = this.tuning.stillTrunks * trunk;
    for (let k = 0; k < KEY_POINTS.length; k++) {
      const bins = new Map<number, { x: number; y: number; n: number }>();
      for (const e of inWindow) {
        const q = e.pts[k];
        if (!q) continue;
        const b = Math.floor((e.t - (now - windowMs)) / binMs);
        const acc = bins.get(b) ?? { x: 0, y: 0, n: 0 };
        acc.x += q.x;
        acc.y += q.y;
        acc.n++;
        bins.set(b, acc);
      }
      let x0 = Infinity,
        x1 = -Infinity,
        y0 = Infinity,
        y1 = -Infinity;
      for (const b of bins.values()) {
        const x = b.x / b.n;
        const y = b.y / b.n;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      if (bins.size && Math.max(x1 - x0, y1 - y0) > limit) return false;
    }
    return true;
  }
}

/** A wrist visibly above the shoulder of the same side (image y grows downward). */
export function wristAboveShoulder(lm: Landmark[], side: "left" | "right"): boolean {
  const w = side === "left" ? LM.l_wrist : LM.r_wrist;
  const s = side === "left" ? LM.l_shoulder : LM.r_shoulder;
  return visible(lm, w) && visible(lm, s) && lm[w].y < lm[s].y;
}

/**
 * The raised hand fine signal: a wrist held above the same shoulder for 1 s. `feed` returns true
 * from the frame the hold reaches 1 s. Reset it when the check in starts, so only a hand held
 * after the question counts.
 */
export class RaisedHandDetector {
  private since: { left: number | null; right: number | null } = { left: null, right: null };

  reset(): void {
    this.since = { left: null, right: null };
  }

  feed(t: number, lm: Landmark[] | null): boolean {
    let raised = false;
    for (const side of ["left", "right"] as const) {
      if (lm && isPerson(lm) && wristAboveShoulder(lm, side)) {
        if (this.since[side] === null) this.since[side] = t;
        if (t - this.since[side]! >= CHECKIN_TIMING.raisedHandSec * 1000) raised = true;
      } else this.since[side] = null;
    }
    return raised;
  }
}

export type CheckInPhase = "idle" | "stop_list" | "asking" | "no_response";
export type FineSignal = "raised_hand" | "tap" | "speech";
export type CheckInAction =
  | { kind: "ask"; cue: CheckCueId; trigger: CheckInTrigger; t: number }
  | { kind: "fine"; via: FineSignal; trigger: CheckInTrigger; t: number }
  | { kind: "no_response"; screen: ScreenId; trigger: CheckInTrigger; t: number };

/**
 * The check in conversation, driven by time (ms):
 *   idle → stop_list (STOP opened the one tap list) → idle when answered, or after 30 s the check in;
 *   idle or stop_list → asking on a trigger (play check_are_you_ok);
 *   asking → idle on a fine signal, or after 15 s → no_response (tone and scr_no_response; logged,
 *   and a staff alert at the booth). A tap on the no response screen closes it.
 */
export class CheckInFlow {
  private phaseNow: CheckInPhase = "idle";
  private since = 0;
  private cause: CheckInTrigger | null = null;

  get phase(): CheckInPhase {
    return this.phaseNow;
  }

  /** What started the current check in, or null. */
  get trigger(): CheckInTrigger | null {
    return this.cause;
  }

  reset(): void {
    this.phaseNow = "idle";
    this.since = 0;
    this.cause = null;
  }

  /** The stop list is shown (STOP pressed, a stop word, or a camera symptom stop). */
  openStopList(t: number): void {
    if (this.phaseNow === "no_response") return;
    this.phaseNow = "stop_list";
    this.since = t;
    this.cause = null;
  }

  /** An option of the stop list was chosen. */
  answerStopList(): void {
    if (this.phaseNow === "stop_list") this.phaseNow = "idle";
  }

  /** A trigger from CheckInDetector. Starts the check in unless one is already running. */
  raise(trigger: CheckInTrigger, t: number): CheckInAction | null {
    if (this.phaseNow === "asking" || this.phaseNow === "no_response") return null;
    this.phaseNow = "asking";
    this.since = t;
    this.cause = trigger;
    return { kind: "ask", cue: CHECKIN_CUE, trigger, t };
  }

  /**
   * A fine signal (raised hand, tap, spoken words) ends a check in. The no response screen asks for
   * a tap ("Tap here if you are fine", scr_no_response), so only a tap closes it.
   */
  fine(via: FineSignal, t: number): CheckInAction | null {
    if (this.phaseNow !== "asking" && this.phaseNow !== "no_response") return null;
    if (this.phaseNow === "no_response" && via !== "tap") return null;
    const trigger = this.cause!;
    this.phaseNow = "idle";
    this.cause = null;
    return { kind: "fine", via, trigger, t };
  }

  /** Call regularly (every frame or every second). */
  tick(t: number): CheckInAction | null {
    if (this.phaseNow === "stop_list" && t - this.since >= CHECKIN_TIMING.noAnswerSec * 1000) {
      return this.raise("no_answer", t);
    }
    if (this.phaseNow === "asking" && t - this.since >= CHECKIN_TIMING.noResponseSec * 1000) {
      this.phaseNow = "no_response";
      return { kind: "no_response", screen: NO_RESPONSE_SCREEN, trigger: this.cause!, t };
    }
    return null;
  }
}
