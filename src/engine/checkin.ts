/**
 * Check in for the movement check (spec 4.0 "Check in", contract v2 section F, and the UX round
 * council decisions O34-1 to O34-5, O42, O33 and O5). Pure TS, no DOM.
 *
 * Triggers run the check in (cue chosen by `selectCheckInCue`):
 *   - the person leaves the frame; the hips drop toward the floor; a big sideways sway; no movement
 *     for 10 s during a test (`CheckInDetector`, armed by the UI per UX 4.8);
 *   - no answer to the stop list (S41) or to the faint follow up (S38b) within 30 s (`CheckInFlow`);
 *   - at home, the fall watch on S39 (phase 2): 60 s still while in view, or not seen seated or
 *     standing within 3 minutes (`FallWatch`, O42).
 * Counts as fine, in every state including no_response (O34-4): the «أنا بخير» button, a camera fine
 * signal (`CameraFine`: the raised hand held 1 s from anyone, and in phase 2 at home the fine zone
 * held 2 s), or the on device phrase (`phraseCounts`). A tap anywhere else never counts. Every camera
 * fine is refused while the other hand is at the chest, both hands are in zones, the hips drop is
 * active or the trunk is outside the sway limit (O34-1 (4)).
 * The check in escalates at 7 s (chime and the cue again) and at 15 s (the alarm, scr_no_response).
 *
 * These are prompts to ask, never a fall detector (spec 4.3: the app is not a fall detector).
 * Detectors measure in pixel space against a reference taken at calibration.
 */
import { CHECK_DATA } from "../movements/assessments";
import type { CheckCueId, ScreenId, TestId } from "../movements/types";
import {
  armPx,
  dist,
  isPerson,
  leanDeg,
  midHip,
  midPoint,
  midShoulder,
  Pt,
  segmentDistance,
  shoulderPx,
  trunkPx,
  visible,
} from "./body";
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
  /** Escalation inside the 15 s: a soft chime and the cue again at 7 s (O34-3, UX 4.8). */
  repeatSec: 7,
  /** One extra no answer timer after a camera fine on S41, S38b or S44 (O34-1 (6)). */
  extraTimerSec: 30,
  /**
   * R3C-05: at home, the no movement window of the answer zone states answered from the chair (S29,
   * S44, S47, S48, S49), the O42 (3) stillness value.
   */
  answerStillSec: 60,
} as const;

/**
 * The check in cue at the booth for a person who may raise a hand, `check_are_you_ok`
 * (stopRouting.checkIn.cueSelection.booth.raiseAllowed). Revision 1.1 removed the single cue field.
 */
// Revision 1.1 selects the cue by setting, raiseAllowed, noArmSignal, on device speech and the fall
// watch (cueSelection, O33 (f)): selectCheckInCue below. This is the default of CheckInFlow.
export const CHECKIN_CUE: CheckCueId = checkIn.cueSelection.booth.raiseAllowed;
/** The full screen after no response. */
export const NO_RESPONSE_SCREEN: ScreenId = "scr_no_response";

/**
 * Geometry of the triggers. The spec names the triggers but gives no measures; every value here is
 * a starting point to tune at booth.
 */
export const CHECKIN_TUNING = {
  // R3C-11 (leave-time, confirmed 2026-09-30). The subject is missing (or both shoulders unseen) for this long.
  leftFrameSec: 1,
  // R3C-11 (hips-drop, confirmed 2026-09-30). The mid hip is lower than at calibration by this many calibration trunk
  // lengths (about 17 cm for an adult). A seated pelvis stays on the seat, and a chair stand only
  // returns to the seat, so only a slide or a fall goes this low.
  hipsDropTrunks: 0.35,
  // R3C-11 (sway, confirmed 2026-09-30). A big sideways sway is a turn of this many degrees away from the calibration
  // angle, of the trunk line or of the shoulder line (see SwayMeasure). The side lean, where leaning
  // is the task, passes its own larger limit per frame (feed option swayDeg).
  swayDeg: 25,
  // R3C-11 (trigger-sustain, confirmed 2026-09-30). A hips drop or sway must last this long, so one bad frame is not a trigger.
  sustainSec: 0.3,
  // R3C-11 (no-movement, confirmed 2026-09-30). Still means every visible key point stays within this many trunk lengths
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
export type CheckInTrigger =
  | "left_frame"
  | "hips_drop"
  | "sway"
  | "no_movement"
  /** R3C-05: no movement for 60 s in an answer zone state at home. */
  | "answer_still"
  | "no_answer"
  | "faint_no_answer"
  | "fall_still"
  | "fall_timer";

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

// R3C-11 (sway-oblique, confirmed 2026-09-30). The spec lists a big sideways sway among the chair stand's camera
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
  /**
   * Evaluate the left frame rule in this frame (default true). The UX 4.8 arming table turns it off
   * in setup, rests, side changes and answer states, and on for the first 60 s after the chair
   * stand ends (O34-6 (3)).
   */
  leftFrame?: boolean;
  /**
   * R3C-05, home only: the no movement rule of the answer zone states, with its 60 s window (feed it
   * from the end of the question's speech plus the 3 s grace; off otherwise, and resetAnswerStill on
   * a touch or a zone entry).
   */
  answerStill?: boolean;
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
  private answerTrack: { t: number; pts: (Pt | null)[] }[] = [];
  private dropNow = false;
  private swayNow = false;
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
    this.answerTrack = [];
    this.dropNow = false;
    this.swayNow = false;
  }

  /** A touch or a zone entry: the 60 s of the answer stillness rule start again (R3C-05). */
  resetAnswerStill(): void {
    this.answerTrack = [];
    this.active.delete("answer_still");
  }

  /**
   * The conditions that refuse a camera fine (O34-1 (4)) in the last fed frame: the hips drop
   * trigger is active, or its condition holds now; the trunk is outside the current sway limit, or
   * the sway trigger is active.
   */
  fineBlockers(): { hipsDrop: boolean; swayOut: boolean } {
    return {
      hipsDrop: this.dropNow || this.active.has("hips_drop"),
      swayOut: this.swayNow || this.active.has("sway"),
    };
  }

  /**
   * One frame: the subject's landmarks (null when the subject lock has no trusted subject), time in
   * ms and the frame's aspect ratio.
   */
  feed(t: number, lm: Landmark[] | null, aspect?: number, opts: CheckInFeedOptions = {}): CheckInTrigger[] {
    const out: CheckInTrigger[] = [];
    const person = isPerson(lm) ? lm : null;
    const shouldersSeen = inView(person);
    const p = person ? toPixelSpace(person, aspect) : null;
    const ref = this.ref;
    const tu = this.tuning;

    const left = !shouldersSeen;
    this.timed("left_frame", left && opts.leftFrame !== false, t, tu.leftFrameSec, out);

    const drop = !left && !!ref && !!p && midHip(p).y - ref.hip.y > tu.hipsDropTrunks * ref.trunk;
    this.timed("hips_drop", drop, t, tu.sustainSec, out);
    this.dropNow = drop;

    const turn = !left && !!ref && !!p && opts.sway !== false ? this.swayTurn(p, ref) : null;
    const sway = turn !== null && turn > (opts.swayDeg ?? tu.swayDeg);
    this.timed("sway", sway, t, tu.sustainSec, out);
    this.swayNow = sway;

    if (left || !p || opts.movement === false) {
      this.track = [];
      this.active.delete("no_movement");
    } else {
      this.track.push({ t, pts: keyPointsOf(p) });
      const still = this.stillFor(t, ref?.trunk ?? trunkPx(p));
      if (still && !this.active.has("no_movement")) {
        this.active.add("no_movement");
        out.push("no_movement");
      } else if (!still) this.active.delete("no_movement");
    }

    if (left || !p || opts.answerStill !== true) this.resetAnswerStill();
    else {
      this.answerTrack.push({ t, pts: keyPointsOf(p) });
      const still = stillOver(
        this.answerTrack,
        t,
        CHECKIN_TIMING.answerStillSec * 1000,
        this.tuning.stillBinSec * 1000,
        this.tuning.stillTrunks * (ref?.trunk ?? trunkPx(p)),
      );
      if (still && !this.active.has("answer_still")) {
        this.active.add("answer_still");
        out.push("answer_still");
      } else if (!still) this.active.delete("answer_still");
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
    return stillOver(
      this.track,
      now,
      CHECKIN_TIMING.noMovementSec * 1000,
      this.tuning.stillBinSec * 1000,
      this.tuning.stillTrunks * trunk,
    );
  }
}

type Track = { t: number; pts: (Pt | null)[] }[];

/**
 * True when `track` covers the last `windowMs` and no key point moved beyond `limit` (pixel space),
 * measured on `binMs` averages so model jitter is not movement. Drops entries older than the window.
 */
function stillOver(track: Track, now: number, windowMs: number, binMs: number, limit: number): boolean {
  while (track.length > 1 && track[1].t <= now - windowMs) track.shift();
  if (!track.length || track[0].t > now - windowMs) return false;
  const inWindow = track.filter((e) => e.t >= now - windowMs);
  const points = inWindow[0]?.pts.length ?? 0;
  for (let k = 0; k < points; k++) {
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

const keyPointsOf = (p: Landmark[]): (Pt | null)[] =>
  KEY_POINTS.map((i) => (visible(p, i) ? { x: p[i].x, y: p[i].y } : null));

/** The subject is in view: a person with a shoulder visible inside the picture. */
function inView(person: Landmark[] | null): person is Landmark[] {
  return shouldersInView(person);
}

/** The subject's shoulders are in the picture (the left frame rule's own view test). */
export function shouldersInView(person: Landmark[] | null): person is Landmark[] {
  return (
    !!person &&
    isPerson(person) &&
    (visible(person, LM.l_shoulder) || visible(person, LM.r_shoulder)) &&
    [person[LM.l_shoulder], person[LM.r_shoulder]].some((q) => q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1)
  );
}

/** A wrist visibly above the shoulder of the same side (image y grows downward). */
export function wristAboveShoulder(lm: Landmark[], side: "left" | "right"): boolean {
  const w = side === "left" ? LM.l_wrist : LM.r_wrist;
  const s = side === "left" ? LM.l_shoulder : LM.r_shoulder;
  return visible(lm, w) && visible(lm, s) && lm[w].y < lm[s].y;
}

/**
 * The raised hand fine signal (the council's, accepted from anyone at the booth and at home): a
 * wrist held above the same shoulder for 1 s. `feed` returns true from the frame the hold reaches
 * 1 s; `side` says which hand. Reset it when the check in cue starts.
 */
// R3C-10 (1) (raised-hand-entry, confirmed 2026-09-30). O34-1 (3) writes the entry rule (counts only when the hand arrives
// after the cue starts) for the fine zone. The safest reading applies it to the raised hand too: a
// wrist already above the shoulder when the check in opens (an arm raise attempt in progress) must
// first be seen below the shoulder, so a raise in progress is never read as "fine".
export class RaisedHandDetector {
  private since: { left: number | null; right: number | null } = { left: null, right: null };
  private seenDown = { left: false, right: false };
  private raisedSide: "left" | "right" | null = null;

  /** @param requireEntry default true: a hand counts only after it was seen down since reset. */
  constructor(private readonly requireEntry = true) {}

  reset(): void {
    this.since = { left: null, right: null };
    this.seenDown = { left: false, right: false };
    this.raisedSide = null;
  }

  /** The hand that made the last raised hand signal, or null. */
  get side(): "left" | "right" | null {
    return this.raisedSide;
  }

  feed(t: number, lm: Landmark[] | null): boolean {
    let raised = false;
    this.raisedSide = null;
    for (const side of ["left", "right"] as const) {
      const w = side === "left" ? LM.l_wrist : LM.r_wrist;
      const up = !!lm && isPerson(lm) && wristAboveShoulder(lm, side);
      if (!up && lm && isPerson(lm) && visible(lm, w)) this.seenDown[side] = true;
      if (up && (this.seenDown[side] || !this.requireEntry)) {
        if (this.since[side] === null) this.since[side] = t;
        if (t - this.since[side]! >= CHECKIN_TIMING.raisedHandSec * 1000) {
          raised = true;
          this.raisedSide ??= side;
        }
      } else this.since[side] = null;
    }
    return raised;
  }
}

/* ------------------------------------------------------------------ the check in conversation */

export type CheckInPhase = "idle" | "question" | "asking" | "no_response";
/** A screen with its own 30 s no answer timer: the stop list, the faint follow up, go on (S44). */
export type QuestionScreen = "S41" | "S38b" | "S44";
/** Where a check in was raised from. */
export type CheckInOrigin = "test" | QuestionScreen | "fall_watch";
/**
 * How a person said fine. `tap` is a touch anywhere but the «أنا بخير» button and never counts
 * (O34-4): the flow refuses it in every state.
 */
export type FineSignal = "button" | "raised_hand" | "zone" | "speech" | "tap";
export type CheckInAction =
  | { kind: "ask"; cue: string; trigger: CheckInTrigger; origin: CheckInOrigin; t: number }
  /** 7 s: a soft chime and the cue again. */
  | { kind: "repeat"; cue: string; trigger: CheckInTrigger; t: number }
  | {
      kind: "fine";
      via: Exclude<FineSignal, "tap">;
      trigger: CheckInTrigger | null;
      origin: CheckInOrigin;
      /** Fine came on the alarm (scr_no_response); the Q2 tally counts it apart. */
      afterAlarm: boolean;
      /** The alarm was the «أحتاج مساعدة» help variant (O34-5). */
      help: boolean;
      /** A camera fine started the one extra 30 s timer on the origin screen (O34-1 (6)). */
      extraTimer: boolean;
      t: number;
    }
  | { kind: "no_response"; screen: ScreenId; trigger: CheckInTrigger; t: number }
  /** «أحتاج مساعدة»: the alarm at once, logged as help_requested (O34-5). */
  | { kind: "help"; screen: ScreenId; trigger: CheckInTrigger | null; t: number };

const CAMERA_FINES: ReadonlySet<FineSignal> = new Set(["raised_hand", "zone"]);
const QUESTION_SCREENS: ReadonlySet<CheckInOrigin> = new Set(["S41", "S38b", "S44"]);

export interface CheckInFlowOptions {
  /** The check in cue for this person and setting (`selectCheckInCue`); default check_are_you_ok. */
  cue?: string;
}

/**
 * The check in conversation, driven by time (ms):
 *   idle → question (S41 or S38b opened; any input restarts its 30 s) → idle when answered, or after
 *   30 s the check in (no_answer, or faint_no_answer on S38b);
 *   idle or question → asking on a trigger (play the cue); 7 s: the cue again (repeat);
 *   asking → idle on fine, or after 15 s → no_response (the alarm and scr_no_response);
 *   «أحتاج مساعدة» → no_response at once (help);
 *   no_response → idle on fine (the button, a camera fine or the phrase; never a tap elsewhere).
 * After a camera fine on a check in raised from S41, S38b or S44, the flow goes back to that screen
 * with one extra 30 s no answer timer; when it runs out the check in runs again, and a second camera
 * fine there ends the timers on that screen. A fine by the button or the phrase sets no new timer
 * (O14, O34-1 (6)).
 */
export class CheckInFlow {
  private phaseNow: CheckInPhase = "idle";
  private since = 0;
  private cause: CheckInTrigger | null = null;
  private from: CheckInOrigin = "test";
  private screen: QuestionScreen | null = null;
  private repeated = false;
  private helpVariant = false;
  private extraUsed = new Set<QuestionScreen>();
  private readonly cue: string;

  constructor(opts: CheckInFlowOptions = {}) {
    this.cue = opts.cue ?? CHECKIN_CUE;
  }

  get phase(): CheckInPhase {
    return this.phaseNow;
  }

  /** What started the current check in, or null. */
  get trigger(): CheckInTrigger | null {
    return this.cause;
  }

  /** Where the current check in was raised from. */
  get origin(): CheckInOrigin {
    return this.from;
  }

  /** The question screen whose timer runs, or null. */
  get question(): QuestionScreen | null {
    return this.phaseNow === "question" ? this.screen : null;
  }

  reset(): void {
    this.phaseNow = "idle";
    this.since = 0;
    this.cause = null;
    this.from = "test";
    this.screen = null;
    this.repeated = false;
    this.helpVariant = false;
    this.extraUsed.clear();
  }

  /**
   * S41 (the stop list: STOP pressed, a stop word, or a camera symptom stop) or S38b is shown. A
   * screen already open (the flow returned to it after a fine) keeps its timer.
   */
  openQuestion(screen: "S41" | "S38b", t: number): void {
    if (this.phaseNow === "no_response") return;
    if (this.phaseNow === "question" && this.screen === screen) return;
    this.phaseNow = "question";
    this.screen = screen;
    this.since = t;
    this.cause = null;
  }

  /** The stop list is shown. */
  openStopList(t: number): void {
    this.openQuestion("S41", t);
  }

  /** A touch, scroll, key press or focus change on the question screen restarts its 30 s. */
  activity(t: number): void {
    if (this.phaseNow === "question") this.since = t;
  }

  /** The question on screen was answered, or the screen was left: its timers end. */
  answerQuestion(): void {
    if (this.phaseNow === "question") this.phaseNow = "idle";
    if (this.phaseNow !== "asking" && this.phaseNow !== "no_response") this.screen = null;
    this.extraUsed.clear();
  }

  /** An option of the stop list was chosen. */
  answerStopList(): void {
    this.answerQuestion();
  }

  /**
   * A trigger from CheckInDetector or FallWatch. Starts the check in unless one is already running.
   * The origin is the open question screen, else `origin` (default "test"; S44 and the fall watch
   * pass theirs).
   */
  raise(trigger: CheckInTrigger, t: number, origin?: CheckInOrigin): CheckInAction | null {
    if (this.phaseNow === "asking" || this.phaseNow === "no_response") return null;
    this.from = this.phaseNow === "question" && this.screen ? this.screen : (origin ?? "test");
    this.phaseNow = "asking";
    this.since = t;
    this.cause = trigger;
    this.repeated = false;
    this.helpVariant = false;
    return { kind: "ask", cue: this.cue, trigger, origin: this.from, t };
  }

  /** «أحتاج مساعدة» (a zone, the button or a staff tap): the alarm at once, with no read back. */
  needHelp(t: number, origin?: CheckInOrigin): CheckInAction | null {
    if (this.phaseNow === "no_response") return null;
    if (this.phaseNow !== "asking") {
      this.from = this.phaseNow === "question" && this.screen ? this.screen : (origin ?? "test");
      this.cause = null;
    }
    this.phaseNow = "no_response";
    this.since = t;
    this.helpVariant = true;
    return { kind: "help", screen: NO_RESPONSE_SCREEN, trigger: this.cause, t };
  }

  /**
   * A fine signal ends a check in or the alarm: the «أنا بخير» button, a camera fine (raised hand
   * or zone, already cleared by `CameraFine`) or the on device phrase. A tap elsewhere never counts.
   */
  fine(via: FineSignal, t: number): CheckInAction | null {
    if (via === "tap") return null;
    if (this.phaseNow !== "asking" && this.phaseNow !== "no_response") return null;
    const action = {
      kind: "fine" as const,
      via,
      trigger: this.cause,
      origin: this.from,
      afterAlarm: this.phaseNow === "no_response",
      help: this.helpVariant,
      extraTimer: false,
      t,
    };
    const screen = QUESTION_SCREENS.has(this.from) ? (this.from as QuestionScreen) : null;
    this.cause = null;
    this.helpVariant = false;
    this.repeated = false;
    if (screen && CAMERA_FINES.has(via) && !this.extraUsed.has(screen)) {
      this.extraUsed.add(screen);
      this.phaseNow = "question";
      this.screen = screen;
      this.since = t;
      action.extraTimer = true;
    } else {
      this.phaseNow = "idle";
      this.screen = null;
    }
    return action;
  }

  /** Call regularly (every frame or every second). */
  tick(t: number): CheckInAction | null {
    if (this.phaseNow === "question" && t - this.since >= this.timerSec() * 1000) {
      return this.raise(this.screen === "S38b" ? "faint_no_answer" : "no_answer", t);
    }
    if (this.phaseNow === "asking") {
      if (t - this.since >= CHECKIN_TIMING.noResponseSec * 1000) {
        this.phaseNow = "no_response";
        return { kind: "no_response", screen: NO_RESPONSE_SCREEN, trigger: this.cause!, t };
      }
      if (!this.repeated && t - this.since >= CHECKIN_TIMING.repeatSec * 1000) {
        this.repeated = true;
        return { kind: "repeat", cue: this.cue, trigger: this.cause!, t };
      }
    }
    return null;
  }

  private timerSec(): number {
    return this.screen && this.extraUsed.has(this.screen)
      ? CHECKIN_TIMING.extraTimerSec
      : CHECKIN_TIMING.noAnswerSec;
  }
}

/* -------------------------------------------- who can signal fine (O34-1 (1), O34-2, O34-4 (3)) */

export type ArmSide = "left" | "right";
export type ArmFunction = "bend_hold" | "bend_no_hold" | "no_bend";
export type CheckSetting = "booth" | "home";

/** What the check knows about the arms: the setup and today's answers. */
export interface ArmAnswers {
  /** The declared weaker side (intake support). */
  weaker?: ArmSide | null;
  /** Upper limb loss (setup.limbLoss.arm). */
  limbLossArm?: ArmSide | null;
  /** pc_arm_pain_side answers of any area (setup.painSides); "both" counts for each arm. */
  painSides?: readonly (ArmSide | "both")[];
  /** pc_weak_lift: can the weaker hand be lifted off the lap. */
  weakLift?: "yes" | "no" | null;
  /** pc_weak_shoulder: the weaker shoulder is painful, loose or drops. */
  weakShoulder?: "yes" | "no" | null;
  /** pc_arm_function per arm (SCI). */
  armFunction?: Partial<Record<ArmSide, ArmFunction>> | null;
  /** The intake restriction no_overhead. */
  noOverhead?: boolean;
}

const SIDES: readonly ArmSide[] = ["left", "right"];

/**
 * raiseAllowed (O34-4 (3)): false when no_overhead applies, or when no arm is free of all of:
 * upper limb loss; the weaker side with pc_weak_lift no or pc_weak_shoulder yes; pc_arm_function
 * no_bend (SCI). It picks the cue; the raised hand itself stays accepted from anyone.
 */
export function raiseAllowed(a: ArmAnswers): boolean {
  if (a.noOverhead) return false;
  return SIDES.some(
    (s) =>
      a.limbLossArm !== s &&
      !(a.weaker === s && (a.weakLift === "no" || a.weakShoulder === "yes")) &&
      a.armFunction?.[s] !== "no_bend",
  );
}

/**
 * noArmSignal from the answers (O34-2 (1)): each arm has at least one of: upper limb loss on that
 * side; the declared weaker side with pc_weak_lift no; pc_arm_function no_bend (SCI). A failed
 * rehearsal sets it for today as well (`FinePractice`).
 */
export function noArmSignal(a: ArmAnswers): boolean {
  return SIDES.every(
    (s) => a.limbLossArm === s || (a.weaker === s && a.weakLift === "no") || a.armFunction?.[s] === "no_bend",
  );
}

const FUNCTION_RANK: Record<ArmFunction, number> = { bend_hold: 0, bend_no_hold: 1, no_bend: 2 };

/**
 * fineZoneSide (O34-1 (1), R3C-09): the stronger arm, not the declared weaker side, not a limb loss
 * side, not a pc_arm_pain_side; for SCI the arm with the better pc_arm_function answer; on a tie, the
 * right (the order: limb loss, weaker side, pain side, SCI arm function, then the right). It is never
 * null while an arm can signal (noArmSignal false): when every arm is excluded, the side excluded only
 * by pain, then the weaker side with pc_weak_lift yes, then the SCI arm with the better function, and
 * the rehearsal (O34-1 (7)) decides whether the zone is reached.
 */
export function fineZoneSide(a: ArmAnswers): ArmSide | null {
  const pain = (s: ArmSide) => (a.painSides ?? []).some((p) => p === s || p === "both");
  // An arm that can signal at all: not lost, not no_bend, not the weaker arm that cannot lift.
  const can = (s: ArmSide) =>
    a.limbLossArm !== s && a.armFunction?.[s] !== "no_bend" && !(a.weaker === s && a.weakLift === "no");
  const rank = (s: ArmSide) => (a.armFunction?.[s] ? FUNCTION_RANK[a.armFunction[s]!] : 0);
  // Right first, so a tie keeps the right.
  const best = (sides: ArmSide[]) =>
    sides.length ? sides.reduce((b, s) => (rank(s) < rank(b) ? s : b)) : null;
  const arms = (["right", "left"] as const).filter(can);
  return (
    best(arms.filter((s) => a.weaker !== s && !pain(s))) ??
    best(arms.filter((s) => a.weaker !== s)) ??
    best(arms.filter((s) => a.weaker === s && a.weakLift === "yes")) ??
    best(arms.filter((s) => a.armFunction?.[s] !== undefined)) ??
    best(arms)
  );
}

/** FineSignalConfig (O33 (a)): fixed at protocol freeze and passed to the check in. */
export interface FineSignalConfig {
  setting: CheckSetting;
  /** The fine zone: phase 2, at home with answer zones only; never in the booth build (7.2-1). */
  fineZone: boolean;
  fineZoneSide: ArmSide | null;
  zoneHoldSec: number;
  raiseAllowed: boolean;
  noArmSignal: boolean;
  /** On device speech recognition runs (never at the booth, O5). */
  speech: boolean;
  limbLossArm: ArmSide | null;
}

export function fineSignalConfig(
  a: ArmAnswers,
  opts: { setting: CheckSetting; answerZones: boolean; speech: boolean; rehearsalFailed?: boolean },
): FineSignalConfig {
  const side = fineZoneSide(a);
  const noArm = noArmSignal(a) || !!opts.rehearsalFailed;
  return {
    setting: opts.setting,
    fineZone: opts.setting === "home" && opts.answerZones && !noArm && side !== null,
    fineZoneSide: side,
    zoneHoldSec: FINE_RULES.zoneHoldSec,
    raiseAllowed: raiseAllowed(a),
    noArmSignal: noArm,
    speech: opts.setting === "home" && opts.speech,
    limbLossArm: a.limbLossArm ?? null,
  };
}

/** The check in cue map of revision 1.1 (stopRouting.checkIn.cueSelection). */
export const CHECKIN_CUE_SELECTION = {
  booth: { raiseAllowed: "check_are_you_ok", raiseNotAllowed: "check_are_you_ok_noraise" },
  home: {
    zones: "check_are_you_ok_zone",
    zonesWithSpeech: "check_are_you_ok_zone_speech",
    noArmSignal: "check_are_you_ok_helper",
  },
  fallWatch: {
    raiseAllowed: "check_are_you_ok_fall",
    raiseAllowedWithSpeech: "check_are_you_ok_fall_speech",
    raiseNotAllowedOrNoArmSignal: "check_are_you_ok_fall_noraise",
    raiseNotAllowedOrNoArmSignalWithSpeech: "check_are_you_ok_fall_noraise_speech",
  },
} as const;

/**
 * The check in cue (O33 (f)): at the booth check_are_you_ok or _noraise; at home the zone form, its
 * speech form, or the helper form with noArmSignal; in the fall watch its forms. No cue asks a
 * person whose raiseAllowed is false (or with noArmSignal) to raise a hand, and no home cue names
 * our team. The fall watch runs at home only.
 */
export function selectCheckInCue(
  cfg: Pick<FineSignalConfig, "setting" | "raiseAllowed" | "noArmSignal" | "speech"> & {
    /**
     * Whether the answer zones are drawn over the video (phase 2). Without them no home cue may name
     * the «أنا بخير» box: the home check in then asks as the fall watch does (a raised hand where it
     * may be asked for, never getting up), and the button answers at the phone.
     */
    zones?: boolean;
  },
  fallWatch = false,
): string {
  const c = CHECKIN_CUE_SELECTION;
  if (cfg.setting === "booth") return cfg.raiseAllowed ? c.booth.raiseAllowed : c.booth.raiseNotAllowed;
  // R3C-10 (7): no tap only home cue is added. This fall watch fallback names only the raised hand (the
  // helper form only speech) and stays as a guard: it is never a shipped home path, since home checks
  // open only with the zones (HOME_GATE2_READY, the client guard homeOpenOf).
  if (!fallWatch && cfg.zones === false && !cfg.noArmSignal) fallWatch = true;
  if (fallWatch) {
    const raise = cfg.raiseAllowed && !cfg.noArmSignal;
    if (raise) return cfg.speech ? c.fallWatch.raiseAllowedWithSpeech : c.fallWatch.raiseAllowed;
    return cfg.speech
      ? c.fallWatch.raiseNotAllowedOrNoArmSignalWithSpeech
      : c.fallWatch.raiseNotAllowedOrNoArmSignal;
  }
  if (cfg.noArmSignal) return c.home.noArmSignal;
  return cfg.speech ? c.home.zonesWithSpeech : c.home.zones;
}

/* ---------------------------------------------------- the fine zone and camera fines (O34-1) */

/** Starting values for the O33 (4) bench check. */
export const FINE_RULES = {
  /** Hold in the fine zone (O34-1 (3)). */
  zoneHoldSec: 2,
  /** Jitter tolerance on the median wrist over the hold, in shoulder widths. */
  jitterSw: 0.15,
  /** A wrist within the calibration rest positions plus this many shoulder widths never counts. */
  restSw: 0.3,
  /** A camera fine never counts while the other wrist is this close to the sternum. */
  sternumSw: 0.5,
  /** The inner edge at least this far lateral of the shoulder; the bench may move it outward only. */
  innerSw: 0.25,
  /** Zone width, before clipping to the arm's reach. */
  widthSw: 0.8,
  // R3C-10 (3) (zone-dropout, confirmed 2026-09-30). The spec does not say what a frame without the wrist does to a hold.
  // A gap up to this long keeps the hold; a longer one needs a new entry from outside.
  dropoutSec: 0.3,
  // SPEC-GAP: side-view-shoulder-width. In a side view the shoulders overlap and their width says
  // nothing about the body's size; below this share of the trunk, a nominal width is used instead.
  minShoulderPerTrunk: 0.25,
  nominalShoulderPerTrunk: 0.7,
  /** assessment.checkin.practiceSeen and the rehearsal repeat (O34-1 (7)). */
  practiceRepeatSec: 15,
} as const;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const inRect = (q: Pt, r: Rect, pad = 0) =>
  q.x >= r.x0 - pad && q.x <= r.x1 + pad && q.y >= r.y0 - pad && q.y <= r.y1 + pad;

/** Shoulder width for the fine rules, pixel space (see minShoulderPerTrunk). */
function fineShoulderWidth(p: Landmark[]): number {
  const trunk = trunkPx(p);
  const sw = shoulderPx(p);
  return trunk > 1e-6 && sw < FINE_RULES.minShoulderPerTrunk * trunk
    ? FINE_RULES.nominalShoulderPerTrunk * trunk
    : sw;
}

/** The fine zone of a person, in pixel space, from the calibration pose (O34-1 (2)). */
export interface FineZoneRef {
  side: ArmSide;
  zone: Rect;
  shoulderWidth: number;
  /** Calibration rest positions of both wrists (pixel space), when seen. */
  rest: Partial<Record<ArmSide, Pt>>;
  aspect: number;
}

/**
 * The fine zone from the calibration pose (take the median of each landmark over the calibration
 * window, O35) and the frame's aspect:
 *   top at chin height (halfway between the nose and the shoulder line); bottom at mid chest
 *   (halfway from the shoulder line to the hip line); inner edge at least 0.25 shoulder widths
 *   lateral of that shoulder and wholly outside the torso outline; outer edge 0.8 shoulder widths
 *   further, clipped to the arm's calibrated reach and to the picture.
 * `innerSw` is the bench check's inner edge (never less than 0.25). Null when the zone cannot be
 * placed (no nose or shoulders, or no room inside the picture and the arm's reach).
 */
// R3C-10 (4) (torso-outline, confirmed 2026-09-30). The landmarks give joints, not the body outline; the outline is taken as
// the polygon of both shoulders and both hips, so the inner edge is also outside that side's hip.
// R3C-10 (5) (reach-unknown, confirmed 2026-09-30). With the arm not seen at calibration the zone is not clipped to reach; a
// zone out of reach fails the rehearsal, which sets noArmSignal (a helper is then needed).
export function fineZoneRef(
  calibration: Landmark[],
  aspect: number | undefined,
  side: ArmSide,
  opts: { innerSw?: number } = {},
): FineZoneRef | null {
  if (!isPerson(calibration)) return null;
  const p = toPixelSpace(calibration, aspect);
  const a = aspect !== undefined && Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (![LM.nose, LM.l_shoulder, LM.r_shoulder].every((i) => visible(p, i))) return null;
  const sh = side === "left" ? p[LM.l_shoulder] : p[LM.r_shoulder];
  const hip = side === "left" ? p[LM.l_hip] : p[LM.r_hip];
  const mid = midShoulder(p);
  const dir = Math.sign(sh.x - mid.x);
  if (dir === 0) return null;
  const sw = fineShoulderWidth(p);
  const shoulderLine = mid.y;
  const hipLine = midHip(p).y;
  const top = (p[LM.nose].y + shoulderLine) / 2;
  const bottom = shoulderLine + (hipLine - shoulderLine) / 2;
  if (!(bottom > top)) return null;
  const innerSw = Math.max(FINE_RULES.innerSw, opts.innerSw ?? FINE_RULES.innerSw);
  const lateral = (x: number) => x * dir; // larger is further out on that side
  let inner = lateral(sh.x) + innerSw * sw;
  inner = Math.max(inner, lateral(hip.x), lateral(sh.x));
  let outer = inner + FINE_RULES.widthSw * sw;
  const w = side === "left" ? LM.l_wrist : LM.r_wrist;
  const e = side === "left" ? LM.l_elbow : LM.r_elbow;
  if (visible(p, w) && visible(p, e)) outer = Math.min(outer, lateral(sh.x) + armPx(p, side));
  // Clip to the picture (x runs 0 to aspect in pixel space).
  const edge = dir > 0 ? a : 0;
  outer = Math.min(outer, lateral(edge));
  if (!(outer > inner)) return null;
  const xs = [inner * dir, outer * dir].sort((m, n) => m - n);
  const rest: Partial<Record<ArmSide, Pt>> = {};
  if (visible(p, LM.l_wrist)) rest.left = { x: p[LM.l_wrist].x, y: p[LM.l_wrist].y };
  if (visible(p, LM.r_wrist)) rest.right = { x: p[LM.r_wrist].x, y: p[LM.r_wrist].y };
  return { side, zone: { x0: xs[0], y0: top, x1: xs[1], y1: bottom }, shoulderWidth: sw, rest, aspect: a };
}

/** The per landmark median of a calibration window of poses (O35: the reference is the median). */
export function medianPose(poses: readonly Landmark[][]): Landmark[] {
  const n = poses[0]?.length ?? 0;
  const med = (xs: number[]) => {
    const s = [...xs].sort((m, k) => m - k);
    const h = Math.floor(s.length / 2);
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  };
  return Array.from({ length: n }, (_, i) => {
    const seen = poses.map((p) => p[i]).filter((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y));
    if (!seen.length) return { x: 0, y: 0, z: 0, visibility: 0 };
    return {
      x: med(seen.map((q) => q.x)),
      y: med(seen.map((q) => q.y)),
      z: med(seen.map((q) => q.z)),
      visibility: med(seen.map((q) => q.visibility)),
    };
  });
}

/**
 * The fine zone hold (O34-1 (3)): the fine side's wrist held 2 s in the zone, judged on the median
 * wrist position over the hold with a jitter tolerance of 15% of shoulder width. It counts only
 * after the wrist entered the zone from outside after `arm` (the check in cue start). Never counted:
 * a wrist already in the zone when the sheet opens, a wrist within a calibration rest position plus
 * 0.3 shoulder widths, the other hand crossing the body (only the fine side's wrist is read) and a
 * second person (feed only the locked subject). `feed` returns true while a valid hold lasts.
 */
export class FineZoneDetector {
  private state: "unarmed" | "wait_outside" | "outside" | "holding" = "unarmed";
  private samples: { t: number; q: Pt }[] = [];
  private missingSince: number | null = null;
  private readonly holdMs: number;

  constructor(
    private readonly ref: FineZoneRef,
    holdSec: number = FINE_RULES.zoneHoldSec,
  ) {
    this.holdMs = holdSec * 1000;
  }

  /** The zone, pixel space. */
  get rect(): Rect {
    return this.ref.zone;
  }

  /** The check in cue starts (or the rehearsal cue): only an entry after this counts. */
  arm(): void {
    this.state = "wait_outside";
    this.samples = [];
    this.missingSince = null;
  }

  disarm(): void {
    this.state = "unarmed";
    this.samples = [];
  }

  feed(t: number, lm: Landmark[] | null, aspect?: number): boolean {
    if (this.state === "unarmed") return false;
    const w = this.ref.side === "left" ? LM.l_wrist : LM.r_wrist;
    if (!lm || !isPerson(lm) || !visible(lm, w)) {
      this.missingSince ??= t;
      if (t - this.missingSince > FINE_RULES.dropoutSec * 1000) {
        this.state = "wait_outside";
        this.samples = [];
      }
      return false;
    }
    this.missingSince = null;
    const p = toPixelSpace(lm, aspect);
    const q = { x: p[w].x, y: p[w].y };
    const sw = this.ref.shoulderWidth;
    const zone = this.ref.zone;
    const atRest = Object.values(this.ref.rest).some((r) => r && dist(q, r) <= FINE_RULES.restSw * sw);
    const inside = inRect(q, zone) && !atRest;
    switch (this.state) {
      case "wait_outside":
        if (!inRect(q, zone)) this.state = "outside";
        return false;
      case "outside":
        if (inside) {
          this.state = "holding";
          this.samples = [{ t, q }];
        }
        return false;
      case "holding": {
        if (!inRect(q, zone, FINE_RULES.jitterSw * sw)) {
          this.state = "outside";
          this.samples = [];
          return false;
        }
        this.samples.push({ t, q });
        while (this.samples.length > 1 && this.samples[1].t <= t - this.holdMs) this.samples.shift();
        if (t - this.samples[0].t < this.holdMs) return false;
        const m = {
          x: medianOf(this.samples.map((s) => s.q.x)),
          y: medianOf(this.samples.map((s) => s.q.y)),
        };
        const still = this.samples.every((s) => dist(s.q, m) <= FINE_RULES.jitterSw * sw);
        const restM = Object.values(this.ref.rest).some((r) => r && dist(m, r) <= FINE_RULES.restSw * sw);
        return still && inRect(m, zone) && !restM;
      }
    }
    return false;
  }
}

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

// SPEC-GAP: q2-tally. R3C-01 (9), R3C-05, R3C-10 (8) and R3C-25 (3) add lines to the Q2 safety tally:
// check ins after the S44 no answer timer, answer_still check ins, refused camera fines by reason and by
// test, touched retries by test and by whether a spotter was present. No tally recorder exists yet (the
// server keeps only the anonymous alarm, stop and answer counts, and a booth guest sends nothing,
// contract v3 I), so these counts wait for the tally's design before the booth study.
export type CameraFineBlock = "other_hand_chest" | "both_in_zones" | "hips_drop" | "sway";

/**
 * O34-1 (4): a camera fine (the zone or the raised hand) never counts while the other wrist is
 * within 0.5 shoulder widths of the sternum (between the shoulder midpoint and mid chest), while both
 * wrists are in zones, while the hips drop trigger is active, or while the trunk is outside the
 * current sway limit. Returns the first reason, or null. Never applied to the button or the phrase.
 */
// R3C-10 (2) (unseen-other-wrist, confirmed 2026-09-30). An other wrist the model does not see may be the hand at the chest;
// the safest reading refuses the camera fine, except when that arm is a limb loss side.
export function cameraFineBlocked(
  lm: Landmark[],
  aspect: number | undefined,
  signalling: ArmSide,
  ctx: { hipsDrop: boolean; swayOut: boolean; zones?: readonly Rect[]; limbLossArm?: ArmSide | null },
): CameraFineBlock | null {
  if (ctx.hipsDrop) return "hips_drop";
  if (ctx.swayOut) return "sway";
  const p = toPixelSpace(lm, aspect);
  const other: ArmSide = signalling === "left" ? "right" : "left";
  const ow = other === "left" ? LM.l_wrist : LM.r_wrist;
  if (ctx.limbLossArm !== other) {
    if (!visible(p, ow)) return "other_hand_chest";
    // Sternum: from the shoulder midpoint down to mid chest, halfway from the shoulder line to the
    // hip line on the midline (O34-1 (2)).
    const top = midShoulder(p);
    const chest = midPoint(top, midHip(p));
    const q = { x: p[ow].x, y: p[ow].y };
    if (segmentDistance(q, top, chest) <= FINE_RULES.sternumSw * fineShoulderWidth(p))
      return "other_hand_chest";
  }
  const zones = ctx.zones ?? [];
  if (zones.length) {
    const wristIn = (i: number) => visible(p, i) && zones.some((z) => inRect({ x: p[i].x, y: p[i].y }, z));
    if (wristIn(LM.l_wrist) && wristIn(LM.r_wrist)) return "both_in_zones";
  }
  return null;
}

/**
 * Camera fines for one person (O34-1, O34-4): the raised hand from anyone, and the fine zone when
 * the config has it, each cleared by the O34-1 (4) conditions. Call `arm` when the check in cue (or
 * the rehearsal cue) starts; `feed` returns the signal of the frame, or null, and `lastBlock` says
 * why a signal was refused.
 */
export class CameraFine {
  private readonly raised = new RaisedHandDetector();
  private readonly zone: FineZoneDetector | null;
  private block: CameraFineBlock | null = null;

  constructor(
    private readonly cfg: FineSignalConfig,
    zoneRef: FineZoneRef | null,
    private readonly answerZones: readonly Rect[] = [],
  ) {
    this.zone =
      cfg.fineZone && zoneRef && zoneRef.side === cfg.fineZoneSide
        ? new FineZoneDetector(zoneRef, cfg.zoneHoldSec)
        : null;
  }

  get hasZone(): boolean {
    return this.zone !== null;
  }

  get lastBlock(): CameraFineBlock | null {
    return this.block;
  }

  arm(): void {
    this.raised.reset();
    this.zone?.arm();
    this.block = null;
  }

  feed(
    t: number,
    lm: Landmark[] | null,
    aspect: number | undefined,
    blockers: { hipsDrop: boolean; swayOut: boolean },
  ): "raised_hand" | "zone" | null {
    const zoneHeld = this.zone?.feed(t, lm, aspect) ?? false;
    const hand = this.raised.feed(t, lm);
    this.block = null;
    if (!lm || (!zoneHeld && !hand)) return null;
    const zones = this.zone ? [...this.answerZones, this.zone.rect] : this.answerZones;
    const ctx = { ...blockers, zones, limbLossArm: this.cfg.limbLossArm };
    if (zoneHeld) {
      const b = cameraFineBlocked(lm, aspect, this.cfg.fineZoneSide!, ctx);
      if (!b) return "zone";
      this.block = b;
    }
    if (hand) {
      const b = cameraFineBlocked(lm, aspect, this.raised.side!, ctx);
      if (!b) return "raised_hand";
      this.block = b;
    }
    return null;
  }
}

/* -------------------------------------------------------- the fine rehearsal (O34-1 (7), O34-2) */

export type FinePracticeEvent =
  | { kind: "cue"; cue: "check_fine_practice"; t: number }
  /** assessment.checkin.practiceSeen */
  | { kind: "seen"; t: number }
  /** noArmSignal for today; assessment.checkin.practiceNoSignal, then pc_helper per test */
  | { kind: "no_signal"; t: number };

/**
 * Right after the first calibration of every home check: the zone is lit and check_fine_practice
 * plays. A zone fine (from `CameraFine`, so the same rules apply) is `seen`. Not held within 15 s:
 * the cue once more; a second 15 s without success sets noArmSignal for today.
 */
export class FinePractice {
  private startT: number | null = null;
  private repeated = false;
  private doneNow = false;

  get done(): boolean {
    return this.doneNow;
  }

  start(t: number): FinePracticeEvent[] {
    this.startT = t;
    this.repeated = false;
    this.doneNow = false;
    return [{ kind: "cue", cue: "check_fine_practice", t }];
  }

  /** `zoneFine` is true in a frame where CameraFine returned "zone". */
  feed(t: number, zoneFine: boolean): FinePracticeEvent[] {
    if (this.startT === null || this.doneNow) return [];
    if (zoneFine) {
      this.doneNow = true;
      return [{ kind: "seen", t }];
    }
    const repeatMs = FINE_RULES.practiceRepeatSec * 1000;
    if (t - this.startT >= 2 * repeatMs) {
      this.doneNow = true;
      return [{ kind: "no_signal", t }];
    }
    if (!this.repeated && t - this.startT >= repeatMs) {
      this.repeated = true;
      return [{ kind: "cue", cue: "check_fine_practice", t }];
    }
    return [];
  }
}

/* ---------------------------------------------------------------- the fall watch (O42, home) */

/** O42 values. */
export const FALL_WATCH = {
  /** The camera stays on this long after the S39 speech ends. */
  watchSec: 300,
  /** fall_still: no movement while in view, counted from the end of the last spoken line. */
  stillSec: 60,
  /** fall_timer: not seen seated or standing for 3 s within this long, and no touch. */
  notUpSec: 180,
  /** Seen seated or standing for this long (also re-arms the hips drop). */
  upHoldSec: 3,
  // R3C-10 (6) (fall-seat-tolerance, confirmed 2026-09-30). "hips at or above the calibration seat height" is read with a
  // tolerance of this many calibration trunk lengths, so model jitter on a seated person counts.
  seatToleranceTrunks: 0.1,
} as const;

export type FallWatchEnd = "fine" | "timeout" | "call" | "phone_moved" | "left_screen";
export type FallWatchEvent =
  | { kind: "checkin"; trigger: "fall_still" | "fall_timer" | "hips_drop"; t: number }
  | { kind: "end"; reason: FallWatchEnd; t: number };

/**
 * The fall watch on S39 at home (phase 2, O42). Never at the booth (the camera is off on S39 there).
 * The 10 s no movement trigger, sway and left frame are off. The hips drop arms only after the
 * person was seen with the hips at or above the calibration seat height for 3 s. fall_still: in
 * view and still for 60 s from the end of the last spoken line (out of view never starts it).
 * fall_timer: not seen seated or standing for 3 s and no touch within 3 minutes. It ends on a fine,
 * 997, the phone moved, leaving S39, or after 5 minutes.
 */
export class FallWatch {
  private startT: number | null = null;
  private spokeT = 0;
  private inViewSince: number | null = null;
  private upSince: number | null = null;
  private seenUp = false;
  private hipsArmed = false;
  private dropSince: number | null = null;
  private touchedScreen = false;
  private fired = { still: false, timer: false };
  private track: Track = [];
  private readonly tuning: CheckInTuning;

  constructor(
    readonly setting: CheckSetting,
    private readonly ref: CheckInReference | null,
    tuning: Partial<CheckInTuning> = {},
  ) {
    this.tuning = { ...CHECKIN_TUNING, ...tuning };
  }

  get active(): boolean {
    return this.startT !== null;
  }

  /** The S39 speech ended: the watch starts (home only). */
  start(t: number): void {
    if (this.setting !== "home") return;
    this.startT = t;
    this.spokeT = t;
  }

  /** A spoken line ended: fall_still counts from here. */
  spoke(t: number): void {
    this.spokeT = t;
    this.track = [];
  }

  /** The person touched the screen (cancels fall_timer). */
  touched(): void {
    this.touchedScreen = true;
  }

  stop(reason: FallWatchEnd, t: number): FallWatchEvent | null {
    if (this.startT === null) return null;
    this.startT = null;
    return { kind: "end", reason, t };
  }

  feed(t: number, lm: Landmark[] | null, aspect?: number): FallWatchEvent[] {
    if (this.startT === null) return [];
    const out: FallWatchEvent[] = [];
    if (t - this.startT >= FALL_WATCH.watchSec * 1000) {
      out.push(this.stop("timeout", t)!);
      return out;
    }
    const person = isPerson(lm) ? lm : null;
    const seen = inView(person);
    const p = seen ? toPixelSpace(person!, aspect) : null;
    const ref = this.ref;

    // Seen seated or standing: the hips at or above the calibration seat height.
    const up = !!p && !!ref && midHip(p).y <= ref.hip.y + FALL_WATCH.seatToleranceTrunks * ref.trunk;
    if (up) {
      this.upSince ??= t;
      if (t - this.upSince >= FALL_WATCH.upHoldSec * 1000) {
        this.seenUp = true;
        this.hipsArmed = true;
      }
    } else this.upSince = null;

    // Hips drop, only after a new time up (a new collapse).
    const drop =
      this.hipsArmed && !!p && !!ref && midHip(p).y - ref.hip.y > this.tuning.hipsDropTrunks * ref.trunk;
    if (drop) {
      this.dropSince ??= t;
      if (t - this.dropSince >= this.tuning.sustainSec * 1000) {
        this.hipsArmed = false;
        this.dropSince = null;
        out.push({ kind: "checkin", trigger: "hips_drop", t });
      }
    } else this.dropSince = null;

    // fall_still: in view and still for 60 s, from the end of the last spoken line.
    if (p) {
      this.inViewSince ??= t;
      this.track.push({ t, pts: keyPointsOf(p) });
      const from = Math.max(this.spokeT, this.inViewSince);
      const windowMs = FALL_WATCH.stillSec * 1000;
      if (
        !this.fired.still &&
        t - from >= windowMs &&
        stillOver(
          this.track,
          t,
          windowMs,
          this.tuning.stillBinSec * 1000,
          this.tuning.stillTrunks * (ref?.trunk ?? trunkPx(p)),
        )
      ) {
        this.fired.still = true;
        out.push({ kind: "checkin", trigger: "fall_still", t });
      }
    } else {
      this.inViewSince = null;
      this.track = [];
    }

    // fall_timer: 3 minutes without being seen seated or standing, and no touch.
    if (!this.fired.timer && t - this.startT >= FALL_WATCH.notUpSec * 1000) {
      this.fired.timer = true;
      if (!this.seenUp && !this.touchedScreen) out.push({ kind: "checkin", trigger: "fall_timer", t });
    }
    return out;
  }
}

/* ------------------------------------------------------------ the spoken fine phrase (O5) */

/** The recognizer is paused while app audio plays and for 0.5 s after it ends. */
export const RECOGNIZER_GUARD_SEC = 0.5;

/**
 * A fine phrase counts only when it does not overlap app audio playback or the 0.5 s after it
 * (O5): the phone must not hear its own voice as the person. Times in ms; `end` null = playing.
 */
export function phraseCounts(
  phrase: { start: number; end: number },
  playback: readonly { start: number; end: number | null }[],
): boolean {
  const guard = RECOGNIZER_GUARD_SEC * 1000;
  return playback.every((a) => phrase.end < a.start || phrase.start > (a.end ?? Infinity) + guard);
}
