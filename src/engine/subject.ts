/**
 * Subject lock: which person in the picture is doing the movement check (spec 4.0, contract v2
 * section F). Pure TS, no DOM.
 *
 * Pose Landmarker runs with numPoses 2 for the check and returns the poses in no stable order.
 *   - `lock(poses, aspect)` at calibration picks the person nearest the frame centre and keeps
 *     that person's mid hip and body width.
 *   - `pick(poses)` then follows, frame to frame, the pose whose mid hip is nearest the subject's
 *     last trusted mid hip (the calibration mid hip at first). A second person who stays at the
 *     edge of the picture is ignored.
 *   - Scoring pauses (`paused`) when another pose's box overlaps the subject's by more than 20
 *     percent, or when the nearest mid hip jumped more than 0.5 shoulder widths in one frame (one
 *     frame of the 20 fps floor: a longer gap between frames allows the distance of the frames it
 *     spans). After a jump the pose is not trusted as the subject: no landmarks are returned and the
 *     reference stays where the subject was last seen. A frame without the subject is paused as well.
 *   - A landmark that is not a finite number is never visible (body.ts sanitizePose).
 *   - `pausedShare` covers the frames since `resetAttempt()`. Over 10 percent fails the attempt
 *     (quality.ts). `touched` is true when a second person touched the subject in any of those
 *     frames, which makes the attempt invalid.
 * All thresholds are marked tune at booth in the spec.
 *
 * The anchor (SubjectLockOptions.anchor): "hip", the default, is the above (v1). "body" is the v7
 * range runner's (D-034 item 1: seated at home 1.2 to 1.5 m from the phone, the legs and hips out of
 * the picture): the jump is the smaller of the mid hip's move (v1) and the median, over the face, the
 * shoulders and the hips (BODY_POINTS), of how far each point moved since the last trusted frame, each
 * read whatever its visibility, as v1 reads the mid hip. A swap to another person moves every point;
 * the model moving one or two of them, or a quick lean over still hips, does not. In the real model smoke the model moved single points with the arm: the guessed hips of
 * the seated arm raise to the front (Lite, the hips below the picture) by up to 0.13 of the picture's
 * height between two frames, and the near shoulder of the same raise seen a little turned (Full) by
 * more than half a shoulder width, so either anchor alone paused the attempt for the whole raise
 * (the reference stays put after a jump).
 *
 * One person per camera (D-037 item 4: the booth, many people in the picture). Every camera screen
 * follows its person with this lock: the range measurement (rom/runner.ts, one lock for the check's
 * range part), the walk (features/gait/controller.ts, `mode: "walk"`), the v1 check (modes/*) and the
 * camera workouts (app/Session.tsx), and the skeleton drawing (app/skeleton.ts) draws the person the
 * lock marked in the frame (`subjectOf`). The pose model looks for several people wherever a lock
 * runs (2 people, app/poseSource.ts LOCK_NUM_POSES), so another person never takes its one pose.
 *   - Taking the lock (`lock`, or by itself after a release): the person the step is for is the one
 *     in the picture (both shoulders inside it), not a small figure in the background (a trunk under
 *     half the largest one's), nearest the centre (`acquireIndex`). `lock` called again at the next
 *     calibration keeps the person it follows when they are still there.
 *   - Following: the subject is the pose that continues its body (the place, as above); everyone else
 *     is followed too, as "others", only so that they are never taken for the subject.
 *   - The subject unseen (the model lost them, or they left the picture): paused. A person who
 *     appears in the picture after that (never one already followed as another person) with a trunk
 *     of the subject's size (and its torso proportions to choose between two) is the subject coming
 *     back; in the walk only one who enters from the side the walker left by.
 *   - Released after `releaseMs` unseen (2 s; the walk 10 s, where leaving the picture at the end of
 *     a pass is normal): the person then in the picture is locked (`generation` counts the people
 *     locked), or the next one to come.
 * The pause and quality rules above are unchanged for the subject; others are only the overlap and
 * touch rules' other people.
 */
import {
  dist,
  finitePoint,
  isPerson,
  midHip,
  midShoulder,
  overlapShare,
  poseBox,
  Pt,
  sanitizePose,
  segmentDistance,
  VIEW_RATIO,
} from "./body";
import { effectiveAspect, toPixelSpace, VIS_MIN } from "./geometry";
import { Frame, Landmark, LM } from "./types";

export const SUBJECT_RULES = {
  /** Spec 4.0: a bounding box overlap over 20 percent pauses scoring (measure: body.ts overlapShare). */
  overlapMax: 0.2,
  /** Spec 4.0: a subject mid hip jump over 0.5 shoulder widths in one frame pauses scoring. */
  jumpShoulderWidths: 0.5,
  /** Spec 4.0: over 10 percent paused frames fails the attempt (applied by quality.ts). */
  maxPausedShare: 0.1,
  // SPEC-GAP: jump-width-side-view. "Shoulder widths" is a body measure. In a side view (the arm
  // curl) or the 45 degree chair stand view the shoulders overlap in the picture and the pixel
  // shoulder width shrinks toward zero, so the literal pixel reading would pause on normal jitter
  // and no side view attempt could pass. The width used is the larger of the pixel shoulder width
  // and this share of the trunk length (the smallest square on ratio, VIEW_RATIO.frontMin), which
  // equals the pixel reading in a front view. A swap to another person (at least a body width
  // away) still exceeds it.
  minWidthPerTrunk: 0.55,
  // SPEC-GAP: jump-per-time. "A jump over 0.5 shoulder widths in one frame" is read per frame of the
  // 20 fps floor of the timed tests (50 ms). A phone that delivers a frame late (a dropped frame, a
  // slow model step: 150 to 200 ms is common) moves the body several frames' worth between two
  // frames, so the limit grows with the time since the previous frame, up to jumpMaxFrames frames.
  // A swap to another person far away still pauses; a person rising from a chair does not.
  jumpNominalFrameMs: 50,
  jumpMaxFrames: 4,
  // R3C-25 (1) (touch-distance, confirmed 2026-09-30). "The second person touches the subject" has no measure in the spec.
  // A touch is a visible hand point (wrist, pinky, index or thumb) of another pose within this many
  // shoulder widths of a visible segment of the subject's body, in any frame. One camera cannot see
  // depth, so a hand passing in front of or behind the subject also counts (the safer reading).
  // Tune at booth.
  // R3C-25 (1) (touch-hover, confirmed 2026-09-30). The helper rules (spec 4.3, 4.4) ask for hands near the shoulder or waist
  // without touching. A hand that hovers within this distance of the body in the picture, or behind
  // it, reads as a touch; whether that happens with real spotting, and the distance and persistence
  // that tell it from a steadying catch (which must invalidate the attempt, spec 2.7), need the booth
  // study. For sign-off with the booth tuning.
  touchShoulderWidths: 0.15,
  // D-037 item 4 (one person per camera, the booth). Engineering choices, tune at the booth.
  /** The subject unseen this long (ms, the frames' clock) releases the lock (range, workouts, the check). */
  releaseMs: 2000,
  /** The walk: the walker leaves the picture at the end of each pass, so the lock waits this long. */
  walkReleaseMs: 10000,
  /** Taking the lock: people whose trunk is under this share of the largest one's are in the background. */
  backgroundShare: 0.5,
  /** The subject coming back: a new person whose trunk is within this ratio of the subject's. */
  returnSizeRatio: 1.5,
  /** The walk: ...who enters within this share of the picture's width from the side the walker left by. */
  returnEdgeShare: 0.35,
  /** Another person unseen this long (ms) is forgotten (one who comes back after it is new). */
  otherForgetMs: 3000,
  /** The walk: a walker lost inside the picture (behind someone) comes back within this share of the width a second. */
  walkReachPerSec: 0.5,
  /** Each person's place is predicted from their speed this far ahead at most (ms), so two people passing are told apart. */
  predictMs: 200,
  /** ignoreBehind: a trunk under this share of the subject's is behind the subject. */
  behindShare: 0.8,
} as const;

export type PauseReason = "unlocked" | "lost" | "jump" | "overlap";

export interface SubjectLockOptions {
  /** What the jump rule follows: "hip" (v1, the default) or "body" (v7 range, see above). */
  anchor?: "hip" | "body";
  /**
   * "stay" (the default): the person stays in place (range, workouts, the check), released after
   * releaseMs. "walk": the walker leaves the picture at each pass's end, released after walkReleaseMs,
   * and taken back only from the side they left by.
   */
  mode?: "stay" | "walk";
  /** The release time (ms) whatever the mode: the walk's capture keeps its walker's 10 s on every step. */
  releaseMs?: number;
  /**
   * D-037 item 4 (the v7 screens and the workouts): another person behind the subject (a trunk under
   * behindShare of the subject's in the picture: further from the phone) never pauses it, as they
   * hide nothing of the subject; one as near or nearer still pauses an overlap (spec 4.0, the v1
   * check's default).
   */
  ignoreBehind?: boolean;
}

export interface SubjectPick {
  /** The subject's landmarks, normalized as the model gave them, or null when not trusted in this frame. */
  lm: Landmark[] | null;
  /** Index of the subject in `poses`, or -1. */
  index: number;
  /** Scoring is paused in this frame. */
  paused: boolean;
  reason: PauseReason | null;
  /** Another person's hand touches the subject in this frame. */
  touching: boolean;
  /** Largest box overlap with another person (0 to 1). */
  overlap: number;
  /** Mid hip movement since the last trusted frame, in shoulder widths (0 when lost). */
  jump: number;
  /** Other people in the frame. */
  others: number;
}

/** The poses of a frame: `poses` from a multi pose source, else the single `lm` when it is a person. */
export function posesOf(frame: Frame): Landmark[][] {
  if (frame.poses) return frame.poses;
  return isPerson(frame.lm) ? [frame.lm] : [];
}

// SPEC-GAP: lock-centre. The spec says "nearest the frame centre" without the point or the axis.
// The phone sits at chest height, so a seated person's hips are well below the centre while a
// helper standing close beside has hips near it: a plain 2D distance can pick the helper. The
// distance used is horizontal, from the middle of the trunk (mean of mid shoulder and mid hip) to
// the vertical centre line, with the 2D distance only to break a tie.
/**
 * Index of the person nearest the frame centre, or -1 when there is nobody.
 */
export function nearestCentre(poses: Landmark[][], aspect?: number): number {
  const a = effectiveAspect(aspect);
  const centre = { x: a / 2, y: 0.5 };
  let best = -1;
  let bestKey: [number, number] = [Infinity, Infinity];
  poses.forEach((raw, i) => {
    if (!isPerson(raw)) return;
    const p = toPixelSpace(raw, a);
    const c = { x: (midShoulder(p).x + midHip(p).x) / 2, y: (midShoulder(p).y + midHip(p).y) / 2 };
    const key: [number, number] = [Math.abs(c.x - centre.x), dist(c, centre)];
    if (key[0] < bestKey[0] - 1e-9 || (Math.abs(key[0] - bestKey[0]) <= 1e-9 && key[1] < bestKey[1])) {
      best = i;
      bestKey = key;
    }
  });
  return best;
}

/** Body segments of the subject that another person's hand must not touch. */
const BODY_SEGMENTS: [number, number][] = [
  [LM.l_ear, LM.nose],
  [LM.nose, LM.r_ear],
  [LM.l_shoulder, LM.r_shoulder],
  [LM.l_shoulder, LM.l_elbow],
  [LM.l_elbow, LM.l_wrist],
  [LM.r_shoulder, LM.r_elbow],
  [LM.r_elbow, LM.r_wrist],
  [LM.l_shoulder, LM.l_hip],
  [LM.r_shoulder, LM.r_hip],
  [LM.l_hip, LM.r_hip],
  [LM.l_hip, LM.l_knee],
  [LM.r_hip, LM.r_knee],
  [LM.l_knee, LM.l_ankle],
  [LM.r_knee, LM.r_ankle],
];
/** Wrists and the coarse hand points (15 to 22). */
const HAND_POINTS = [15, 16, 17, 18, 19, 20, 21, 22];

/** True when a visible hand point of `other` is within `maxDist` of a visible segment of `subject` (pixel space). */
export function handTouches(other: Landmark[], subject: Landmark[], maxDist: number): boolean {
  const segs = BODY_SEGMENTS.filter(
    ([a, b]) => subject[a].visibility >= VIS_MIN && subject[b].visibility >= VIS_MIN,
  );
  for (const h of HAND_POINTS) {
    const q = other[h];
    if (!q || q.visibility < VIS_MIN) continue;
    for (const [a, b] of segs) if (segmentDistance(q, subject[a], subject[b]) < maxDist) return true;
  }
  return false;
}

interface LockState {
  aspect: number;
  /** Time of the previous frame (ms), null before the first one after the lock. */
  lastT: number | null;
  /** Calibration mid hip, pixel space. */
  anchor: Pt;
  /** Last trusted mid hip, pixel space. */
  ref: Pt;
  /** The anchor "body": the last trusted frame's BODY_POINTS (pixel space, null where not a finite number). */
  refBody: (Pt | null)[];
  /** Body width used for the jump and touch rules, pixel space (see minWidthPerTrunk). */
  width: number;
  /** The subject's last seen trunk length and torso proportions (shoulder width over trunk), pixel space. */
  size: number;
  ratio: number | null;
  /** Where the subject was last seen across the picture (share of its width). */
  xShare: number;
  /** When the subject was last seen (the frames' clock, ms), and the frame it was first missed in. */
  seenT: number;
  lostAt: number | null;
  /** The subject's speed in the picture (pixel space a millisecond), for its predicted place. */
  vel: Pt;
}

/**
 * Another person in the picture, followed only so that they are never taken for the subject: seen
 * with the subject ("others"), or seen while the subject was missed ("candidates", `born` when first
 * seen, to tell a person who came into the picture after the subject left it from one who was there).
 */
interface Other {
  ref: Pt;
  refBody: (Pt | null)[];
  seenT: number;
  born: number;
  vel: Pt;
  ratio: number | null;
}

/** What the place rule reads of a person followed: the last trusted place, its time and speed. */
type Track = Pick<LockState, "ref" | "refBody" | "seenT" | "vel">;

const ZERO: Pt = { x: 0, y: 0 };

/** A person of one frame: the index in the frame's poses, the raw and the pixel space landmarks. */
interface Person {
  i: number;
  raw: Landmark[];
  px: Landmark[];
}

const NO_PICK = {
  lm: null,
  index: -1,
  paused: true,
  touching: false,
  overlap: 0,
  jump: 0,
  others: 0,
} as const;

/** Which person of a frame the camera screen's lock follows (index in the frame's poses, -1 nobody). */
const MARKS = new WeakMap<Frame, number>();

/**
 * The person the camera screen's lock picked in this frame (`SubjectLock.pickFrame` marks it): the
 * index in `posesOf(frame)`, -1 when the subject is not in it, undefined when no lock read the frame.
 * The skeleton drawing (app/skeleton.ts) draws only that person.
 */
export function subjectOf(frame: Frame): number | undefined {
  return MARKS.get(frame);
}

/** Marks the frame's subject for the drawing (see subjectOf). */
export function markSubject(frame: Frame, index: number): void {
  MARKS.set(frame, index);
}

/** A pose's trunk length (mid shoulder to mid hip), shoulder width and their ratio, pixel space. */
function trunkOf(px: Landmark[]): { size: number; ratio: number | null } {
  const sh = finitePoint(px[LM.l_shoulder]) && finitePoint(px[LM.r_shoulder]);
  const hip = trackPoint(px);
  const trunk = sh && hip ? dist(midShoulder(px), hip) : Number.NaN;
  const width = sh ? dist(px[LM.l_shoulder], px[LM.r_shoulder]) : Number.NaN;
  const size = trunk > 0 ? trunk : width > 0 ? width / VIEW_RATIO.nominalFront : Number.NaN;
  return { size, ratio: trunk > 0 && Number.isFinite(width) ? width / trunk : null };
}

/** The centre of a pose's trunk across the picture, as a share of its width (normalized x). */
function xShareOf(raw: Landmark[]): number {
  const xs = [LM.l_shoulder, LM.r_shoulder, LM.l_hip, LM.r_hip]
    .filter((i) => finitePoint(raw[i]))
    .map((i) => raw[i].x);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0.5;
}

/**
 * The person a camera step is for, when the lock is taken (D-037 item 4): of the people whose two
 * shoulders are placed inside the picture, one of them seen (a passer-by cut by its edge is not; a
 * seated person whose hips are below it, or a side view's far shoulder hidden, still is), those whose trunk is at least backgroundShare of the largest one's, the one nearest
 * the centre (nearestCentre's distance); everyone when nobody qualifies. -1 when there is nobody.
 */
export function acquireIndex(
  poses: Landmark[][],
  aspect?: number,
  rules: Pick<typeof SUBJECT_RULES, "backgroundShare"> = SUBJECT_RULES,
): number {
  const a = effectiveAspect(aspect);
  // Both shoulders placed inside the picture and one of them seen (a side view hides the far one).
  const inside = (q: Landmark | undefined) => finitePoint(q) && q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1;
  const people = poses
    .map((raw, i) => ({ i, raw }))
    .filter(({ raw }) => isPerson(raw))
    .map(({ i, raw }) => ({
      i,
      raw,
      inPicture:
        inside(raw[LM.l_shoulder]) &&
        inside(raw[LM.r_shoulder]) &&
        Math.max(raw[LM.l_shoulder].visibility, raw[LM.r_shoulder].visibility) >= VIS_MIN,
      size: trunkOf(toPixelSpace(raw, a)).size,
    }));
  if (!people.length) return -1;
  let pool = people.filter((p) => p.inPicture);
  if (!pool.length) pool = people;
  const largest = Math.max(...pool.map((p) => (Number.isFinite(p.size) ? p.size : 0)));
  if (largest > 0)
    pool = pool.filter((p) => !Number.isFinite(p.size) || p.size >= rules.backgroundShare * largest);
  const k = nearestCentre(
    pool.map((p) => p.raw),
    a,
  );
  return k < 0 ? -1 : pool[k].i;
}

export class SubjectLock {
  private state: LockState | null = null;
  private frames = 0;
  private pausedFrames = 0;
  private run = 0;
  private touchedAny = false;
  /** The frames' clock (ms): the last frame's time, or nominal frames for calls without one. */
  private clock = 0;
  /** Released with nobody in the picture: the next person to come is locked. */
  private searching = false;
  private others: Other[] = [];
  private candidates: Other[] = [];
  private gen = 0;

  private readonly anchorMode: "hip" | "body";
  private mode: "stay" | "walk";
  private readonly releaseOverride: number | null;
  private readonly ignoreBehind: boolean;

  constructor(
    private readonly rules: typeof SUBJECT_RULES = SUBJECT_RULES,
    opts: SubjectLockOptions = {},
  ) {
    this.anchorMode = opts.anchor ?? "hip";
    this.mode = opts.mode ?? "stay";
    this.releaseOverride = opts.releaseMs ?? null;
    this.ignoreBehind = opts.ignoreBehind ?? false;
  }

  get locked(): boolean {
    return this.state !== null;
  }

  /** The point the jump rule follows (SubjectLockOptions.anchor). */
  get anchorKind(): "hip" | "body" {
    return this.anchorMode;
  }

  /** Calibration mid hip in pixel space, or null before a lock. */
  get anchor(): Pt | null {
    return this.state ? { ...this.state.anchor } : null;
  }

  /** The body width the jump and touch rules use (pixel space), or null before a lock. */
  get width(): number | null {
    return this.state?.width ?? null;
  }

  /**
   * The rules from now on (SubjectLockOptions.mode): the walk's capture follows its walker with
   * "walk" while they walk across the picture and "stay" while they stand for a calibration.
   */
  setMode(mode: "stay" | "walk"): void {
    this.mode = mode;
  }

  /** How many times a person was locked (a new person after a release, or a new lock): 0 before any. */
  get generation(): number {
    return this.gen;
  }

  /** How long (ms) the subject has been unseen: 0 while seen or before any lock. */
  get lostMs(): number {
    const s = this.state;
    return s && s.lostAt !== null ? Math.max(0, this.clock - s.seenT) : 0;
  }

  private get releaseMs(): number {
    return this.releaseOverride ?? (this.mode === "walk" ? this.rules.walkReleaseMs : this.rules.releaseMs);
  }

  /**
   * Takes the lock (at a calibration, at a step's start): keeps the person it follows when they are
   * in these poses, near where they were last seen and seen within the release time; else the person
   * the step is for (acquireIndex), never one followed as another person while the lock holds its
   * subject (they come back, or the lock is released). Returns false when there is nobody to take (a
   * lock not taken yet stays unlocked; a held one keeps its subject). Resets the attempt statistics
   * and sets the anchor (the calibration mid hip) to the person's place now. `t`: the frame's time
   * (ms), else the last one seen.
   */
  lock(poses: Landmark[][], aspect?: number, t?: number): boolean {
    const a = effectiveAspect(aspect);
    const clean = poses.map(sanitizePose);
    this.resetAttempt();
    if (t !== undefined) this.clock = Math.max(this.clock, t);
    const s = this.state;
    if (s && !this.searching && this.clock - s.seenT < this.releaseMs) {
      // The person followed, never another one followed (each person to the nearest of them).
      const people: Person[] = [];
      clean.forEach((raw, i) => {
        if (isPerson(raw)) people.push({ i, raw, px: toPixelSpace(raw, a) });
      });
      const { subject, fresh } = this.assign(
        people,
        s,
        this.rules.jumpShoulderWidths * this.rules.jumpMaxFrames,
        this.others,
      );
      if (subject && this.follow(subject.raw, a, true)) return true;
      const k = acquireIndex(
        fresh.map((p) => p.raw),
        a,
        this.rules,
      );
      return k >= 0 && this.follow(fresh[k].raw, a, false);
    }
    const i = acquireIndex(clean, a, this.rules);
    if (i < 0 || !this.follow(clean[i], a, false)) {
      this.state = null;
      this.searching = false;
      return false;
    }
    return true;
  }

  /**
   * Follows `raw` from now on (its place becomes the anchor and the reference); `same`: the person
   * already followed. False when the pose has no point to follow.
   */
  private follow(raw: Landmark[], a: number, same: boolean): boolean {
    const p = toPixelSpace(raw, a);
    const hip = trackPoint(p);
    if (!hip) return false;
    const shoulders = dist(p[LM.l_shoulder], p[LM.r_shoulder]);
    const trunk = dist(midShoulder(p), hip);
    const width = Math.max(
      Number.isFinite(shoulders) ? shoulders : 0,
      this.rules.minWidthPerTrunk * (Number.isFinite(trunk) ? trunk : 0),
      1e-3,
    );
    const body = trunkOf(p);
    this.state = {
      aspect: a,
      lastT: same && this.state ? this.state.lastT : null,
      anchor: hip,
      ref: { ...hip },
      refBody: bodyPoints(p),
      width,
      size: body.size,
      ratio: body.ratio,
      xShare: xShareOf(raw),
      seenT: this.clock,
      lostAt: null,
      vel: { ...ZERO },
    };
    this.searching = false;
    this.candidates = [];
    if (!same) {
      this.gen++;
      this.others = this.others.filter((o) => dist(o.ref, hip) > 1e-9);
    }
    return true;
  }

  /** Forgets the subject (and everyone followed with it). */
  unlock(): void {
    this.state = null;
    this.searching = false;
    this.others = [];
    this.candidates = [];
    this.resetAttempt();
  }

  /** Starts a new attempt: clears pausedShare and touched. */
  resetAttempt(): void {
    this.frames = 0;
    this.pausedFrames = 0;
    this.run = 0;
    this.touchedAny = false;
  }

  /** Share of frames since resetAttempt() in which scoring was paused (0 when no frames). */
  get pausedShare(): number {
    return this.frames ? this.pausedFrames / this.frames : 0;
  }

  /** A second person touched the subject in a frame since resetAttempt(). */
  get touched(): boolean {
    return this.touchedAny;
  }

  /** Frames seen since resetAttempt(). */
  get frameCount(): number {
    return this.frames;
  }

  /**
   * Paused frames in a row up to the last one. After a jump the lock keeps the subject's last
   * trusted place and stays paused until a pose comes back near it; when the phone itself moved,
   * none will, so a long run tells the flow to repeat the setup check and calibration (a new
   * `lock`), since every calibration reference was taken in the old picture.
   */
  get pausedRun(): number {
    return this.run;
  }

  /**
   * Finds the subject among this frame's poses. `aspect` defaults to the one given at lock; `t`
   * (ms) is the frame time, which scales the jump limit after a late frame (jump-per-time) and runs
   * the release clock (without it, each call is one nominal frame).
   */
  pick(poses: Landmark[][], aspect?: number, t?: number): SubjectPick {
    const now = t ?? this.clock + this.rules.jumpNominalFrameMs;
    this.clock = Math.max(this.clock, now);
    if (!this.state && !this.searching) return { ...NO_PICK, reason: "unlocked" };
    const a = aspect === undefined ? (this.state?.aspect ?? 1) : effectiveAspect(aspect);
    const people: Person[] = [];
    poses.forEach((pose, i) => {
      const raw = sanitizePose(pose);
      if (isPerson(raw)) people.push({ i, raw, px: toPixelSpace(raw, a) });
    });
    this.frames++;

    // Released with nobody there: the next person to come is the subject.
    if (this.searching) {
      const k = acquireIndex(
        people.map((p) => p.raw),
        a,
        this.rules,
      );
      if (k < 0 || !this.follow(people[k].raw, a, false)) return this.count({ ...NO_PICK, reason: "lost" });
    }
    const s = this.state!;
    const frames =
      t !== undefined && s.lastT !== null && t > s.lastT ? (t - s.lastT) / this.rules.jumpNominalFrameMs : 1;
    if (t !== undefined) s.lastT = t;
    const jumpLimit = this.rules.jumpShoulderWidths * Math.min(Math.max(1, frames), this.rules.jumpMaxFrames);

    // Everyone followed: the subject and the others, nearest first, each person to one of them.
    const known = this.assign(people, s, jumpLimit, this.others);
    let subject = known.subject;
    let nearest = Infinity;
    for (const p of people) nearest = Math.min(nearest, this.distanceTo(p.px, s));
    const jump = people.length ? nearest / s.width : 0;

    if (!subject) {
      s.lostAt ??= this.clock;
      // The people seen while the subject is missed; one who came into the picture after the
      // subject was missed (never one there since, as the moved picture's person after a slip) may
      // be the subject coming back.
      const seen = this.assign(known.fresh, s, 0, this.candidates);
      for (const p of seen.fresh) {
        const ref = trackPoint(p.px);
        if (ref)
          this.candidates.push({
            ref,
            refBody: bodyPoints(p.px),
            seenT: this.clock,
            born: this.clock,
            vel: { ...ZERO },
            ratio: trunkOf(p.px).ratio,
          });
      }
      this.candidates = this.candidates.filter((c) => c.seenT === this.clock);
      const arrivals = known.fresh.filter((p) => {
        const ref = trackPoint(p.px);
        const c = ref && this.candidates.find((x) => dist(x.ref, ref) < 1e-9);
        return !!c && c.born > s.lostAt!;
      });
      subject = this.comingBack(arrivals, s);
      if (!subject && this.clock - s.seenT >= this.releaseMs) {
        // Released: the person now in the picture, or the next one to come.
        const k = acquireIndex(
          people.map((p) => p.raw),
          a,
          this.rules,
        );
        if (k >= 0 && this.follow(people[k].raw, a, false)) subject = people[k];
        else {
          this.state = null;
          this.searching = true;
        }
      }
    }
    // The people seen with the subject are the others (never taken for the subject).
    if (subject) this.remember(people.filter((p) => p !== subject));
    else this.others = this.others.filter((o) => this.clock - o.seenT <= this.rules.otherForgetMs);

    if (!subject) {
      return this.count({
        ...NO_PICK,
        reason: people.length ? "jump" : "lost",
        jump,
        others: people.length,
      });
    }
    const st = this.state!;
    // The subject's move since its last trusted place, in body widths (0 for a person just locked).
    const moved = st === s ? this.distanceTo(subject.px, s) / s.width : 0;
    const next = trackPoint(subject.px) ?? st.ref;
    st.vel = st === s && s.lostAt === null ? this.speed(st, next) : { ...ZERO };
    st.ref = next;
    st.refBody = bodyPoints(subject.px);
    const body = trunkOf(subject.px);
    if (Number.isFinite(body.size)) st.size = body.size;
    if (body.ratio !== null) st.ratio = body.ratio;
    st.xShare = xShareOf(subject.raw);
    st.seenT = this.clock;
    st.lostAt = null;

    // The anchor "body": a pose whose body lies on the subject's (its median point within the jump
    // limit) is the model finding the subject twice, not a second person (the real model smoke: a
    // ghost of the person while the arm rose, 1 to 2 percent of the frames): no overlap, no touch.
    const others = people.filter(
      (o) =>
        o !== subject &&
        !(this.anchorMode === "body" && this.sameBody(o.px, subject!.px, st.width, jumpLimit)),
    );
    const box = poseBox(subject.px);
    let overlap = 0;
    const behind = (o: Person) => {
      if (!this.ignoreBehind) return false;
      const size = trunkOf(o.px).size;
      return size > 0 && st.size > 0 && size < this.rules.behindShare * st.size;
    };
    for (const o of others) {
      const ob = poseBox(o.px);
      if (box && ob && !behind(o)) overlap = Math.max(overlap, overlapShare(box, ob));
    }
    const touchDist = this.rules.touchShoulderWidths * st.width;
    const touching = others.some((o) => handTouches(o.px, subject!.px, touchDist));
    const paused = overlap > this.rules.overlapMax;
    if (touching) this.touchedAny = true;
    return this.count({
      lm: subject.raw,
      index: subject.i,
      paused,
      reason: paused ? "overlap" : null,
      touching,
      overlap,
      jump: moved,
      others: others.length,
    });
  }

  /**
   * Each person to the subject or to another person followed, nearest first (the subject within the
   * jump limit of its last trusted place, as before; another person within twice its own limit), so
   * a person standing still is never taken for the subject while it is missing. `fresh`: the people
   * neither is followed by (new in the picture).
   */
  private assign(people: Person[], s: LockState, jumpLimit: number, others: Other[]) {
    type Pair = { person: Person; other: Other | null; d: number };
    const pairs: Pair[] = [];
    // The place first; the torso proportions tell apart two people at one place (one side on, one
    // facing the phone, as a walker passing someone who stands).
    const shape = (person: Person, ratio: number | null) => {
      const r = trunkOf(person.px).ratio;
      return r !== null && ratio !== null ? Math.abs(r - ratio) : 0;
    };
    for (const person of people) {
      const d = this.distanceTo(person.px, s) / s.width;
      if (d <= jumpLimit) pairs.push({ person, other: null, d: d + shape(person, s.ratio) });
      for (const o of others) {
        const steps = Math.max(1, (this.clock - o.seenT) / this.rules.jumpNominalFrameMs);
        const limit = 2 * this.rules.jumpShoulderWidths * Math.min(steps, this.rules.jumpMaxFrames);
        const od = this.distanceTo(person.px, o) / s.width;
        if (od <= limit) pairs.push({ person, other: o, d: od + shape(person, o.ratio) });
      }
    }
    pairs.sort((x, y) => x.d - y.d);
    const taken = new Set<Person>();
    const used = new Set<Other | null>();
    let subject: Person | null = null;
    for (const pr of pairs) {
      if (taken.has(pr.person) || used.has(pr.other)) continue;
      taken.add(pr.person);
      used.add(pr.other);
      if (pr.other === null) subject = pr.person;
      else {
        const next = trackPoint(pr.person.px) ?? pr.other.ref;
        pr.other.vel = this.speed(pr.other, next);
        pr.other.ref = next;
        pr.other.refBody = bodyPoints(pr.person.px);
        pr.other.seenT = this.clock;
        pr.other.ratio = trunkOf(pr.person.px).ratio ?? pr.other.ratio;
      }
    }
    return { subject, fresh: people.filter((p) => !taken.has(p)) };
  }

  /**
   * The subject coming back after it was missed (D-037 item 4): of the people new in the picture,
   * one whose trunk is within returnSizeRatio of the subject's (in the walk, entering within
   * returnEdgeShare of the width from the side the walker left by), the nearest in torso proportions.
   */
  private comingBack(fresh: Person[], s: LockState): Person | null {
    const r = this.rules.returnSizeRatio;
    const edge = s.xShare < 0.5 ? 0 : 1;
    // The walk: left the picture by an edge, back from that edge; lost inside it (behind someone), back
    // within a walker's reach of where they were.
    const atEdge = Math.abs(s.xShare - edge) <= this.rules.returnEdgeShare;
    const reach = 0.1 + (this.rules.walkReachPerSec * Math.max(0, this.clock - s.seenT)) / 1000;
    let best: Person | null = null;
    let bestKey = Infinity;
    for (const p of fresh) {
      const body = trunkOf(p.px);
      if (!(body.size > 0) || !(s.size > 0)) continue;
      const ratio = body.size / s.size;
      if (ratio > r || ratio < 1 / r) continue;
      const x = xShareOf(p.raw);
      if (
        this.mode === "walk" &&
        !(atEdge && Math.abs(x - edge) <= this.rules.returnEdgeShare) &&
        !(!atEdge && Math.abs(x - s.xShare) <= reach)
      )
        continue;
      const key = body.ratio !== null && s.ratio !== null ? Math.abs(body.ratio - s.ratio) : 1;
      if (key < bestKey) {
        bestKey = key;
        best = p;
      }
    }
    return best;
  }

  /** The people of this frame other than the subject are followed as others; long unseen ones are forgotten. */
  private remember(people: Person[]): void {
    for (const p of people) {
      const ref = trackPoint(p.px);
      if (!ref) continue;
      if (this.others.some((o) => o.seenT === this.clock && dist(o.ref, ref) < 1e-9)) continue;
      this.others.push({
        ref,
        refBody: bodyPoints(p.px),
        seenT: this.clock,
        born: this.clock,
        vel: { ...ZERO },
        ratio: trunkOf(p.px).ratio,
      });
    }
    this.others = this.others.filter((o) => this.clock - o.seenT <= this.rules.otherForgetMs);
  }

  /**
   * How far a pose's anchor moved from the subject's last trusted place (pixel space): the mid hip
   * (v1), or with the anchor "body" the smaller of that and the median move of BODY_POINTS (the class
   * comment): a swap to another person moves both, the model moving the hips alone, or a quick lean of
   * the upper body over still hips, moves one.
   */
  private distanceTo(px: Landmark[], s: Track): number {
    // From the last trusted place (v1), or from the place predicted from the person's speed a short
    // way ahead (predictMs), whichever is nearer: the same for a person who stands, and a walker
    // passing someone who stands is followed (D-037 item 4).
    const ahead = Math.min(Math.max(0, this.clock - s.seenT), this.rules.predictMs);
    const at = (dx: number, dy: number) => {
      const point = trackPoint(px);
      const hip = point ? Math.hypot(point.x - s.ref.x - dx, point.y - s.ref.y - dy) : Infinity;
      if (this.anchorMode === "body") {
        const now = bodyPoints(px);
        const moves = now.flatMap((q, k) => {
          const r = s.refBody[k];
          return q && r ? [Math.hypot(q.x - r.x - dx, q.y - r.y - dy)] : [];
        });
        if (moves.length >= BODY_MIN_POINTS) return Math.min(hip, median(moves));
      }
      return hip;
    };
    const still = at(0, 0);
    return ahead > 0 && (s.vel.x || s.vel.y) ? Math.min(still, at(s.vel.x * ahead, s.vel.y * ahead)) : still;
  }

  /** A person's speed from their last trusted place to `next` (smoothed), zero after a gap. */
  private speed(track: Track, next: Pt): Pt {
    const dt = this.clock - track.seenT;
    if (!(dt > 0) || dt > 3 * this.rules.predictMs) return { ...ZERO };
    return {
      x: 0.5 * track.vel.x + (0.5 * (next.x - track.ref.x)) / dt,
      y: 0.5 * track.vel.y + (0.5 * (next.y - track.ref.y)) / dt,
    };
  }

  /** Two poses on the same body: the median of their BODY_POINTS' distances within the jump limit. */
  private sameBody(a: Landmark[], b: Landmark[], width: number, limit: number): boolean {
    const pa = bodyPoints(a);
    const pb = bodyPoints(b);
    const d = pa.flatMap((q, k) => (q && pb[k] ? [dist(q, pb[k]!)] : []));
    return d.length >= BODY_MIN_POINTS && median(d) / width <= limit;
  }

  private count(p: SubjectPick): SubjectPick {
    if (p.paused) {
      this.pausedFrames++;
      this.run++;
    } else this.run = 0;
    return p;
  }

  /** `pick` on a frame's poses, with the frame's aspect and time; marks the frame's subject (subjectOf). */
  pickFrame(frame: Frame): SubjectPick {
    const pick = this.pick(posesOf(frame), frame.aspect ?? this.state?.aspect, frame.t);
    markSubject(frame, pick.lm ? pick.index : -1);
    return pick;
  }
}

/** The anchor "body": the nose, the eyes, the ears, the shoulders and the hips. */
const BODY_POINTS: readonly number[] = [
  LM.nose,
  LM.l_eye,
  LM.r_eye,
  LM.l_ear,
  LM.r_ear,
  LM.l_shoulder,
  LM.r_shoulder,
  LM.l_hip,
  LM.r_hip,
];
/** Fewer finite points than this: the anchor "body" reads the mid hip as v1. */
const BODY_MIN_POINTS = 5;

/** A pose's BODY_POINTS (pixel space), null where not a finite number. */
const bodyPoints = (p: Landmark[]): (Pt | null)[] =>
  BODY_POINTS.map((i) => (finitePoint(p[i]) ? { x: p[i].x, y: p[i].y } : null));

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The point the lock follows: the mid hip (whatever the hips' visibility, see body.ts midHip), or
 * one hip when the other is not a finite number, or null when neither is.
 */
function trackPoint(p: Landmark[]): Pt | null {
  const l = finitePoint(p[LM.l_hip]);
  const r = finitePoint(p[LM.r_hip]);
  if (l && r) return midHip(p);
  if (l) return { x: p[LM.l_hip].x, y: p[LM.l_hip].y };
  if (r) return { x: p[LM.r_hip].x, y: p[LM.r_hip].y };
  return null;
}

/** An empty pose (every landmark invisible), what a source sends when nobody was found. */
export const emptyPose = (): Landmark[] =>
  Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));

/** The frame as the subject's own: `lm` is the subject's pose, or an empty pose when not trusted. */
export function subjectFrame(frame: Frame, pick: SubjectPick): Frame {
  return { ...frame, lm: pick.lm ?? emptyPose() };
}

/**
 * A camera frame as its locked person's alone (D-037 item 4; the camera workouts, app/Session.tsx):
 * the lock is taken on the first person it can, then followed; `lm` and `poses` hold only that person
 * while trusted (never paused), else nobody, so the screen measures, draws and cues no one else.
 */
export function lockedFrame(lock: SubjectLock, frame: Frame): Frame {
  const poses = posesOf(frame);
  if (!lock.locked && (!poses.length || !lock.lock(poses, frame.aspect, frame.t))) {
    markSubject(frame, -1);
    return { ...frame, lm: emptyPose(), poses: [] };
  }
  const pick = lock.pickFrame(frame);
  const lm = pick.lm && !pick.paused ? pick.lm : null;
  return { ...frame, lm: lm ?? emptyPose(), poses: lm ? [lm] : [] };
}
