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
  // SPEC-GAP: touch-distance. "The second person touches the subject" has no measure in the spec.
  // A touch is a visible hand point (wrist, pinky, index or thumb) of another pose within this many
  // shoulder widths of a visible segment of the subject's body, in any frame. One camera cannot see
  // depth, so a hand passing in front of or behind the subject also counts (the safer reading).
  // Tune at booth.
  // SPEC-GAP: touch-hover. The helper rules (spec 4.3, 4.4) ask for hands near the shoulder or waist
  // without touching. A hand that hovers within this distance of the body in the picture, or behind
  // it, reads as a touch; whether that happens with real spotting, and the distance and persistence
  // that tell it from a steadying catch (which must invalidate the attempt, spec 2.7), need the booth
  // study. For sign-off with the booth tuning.
  touchShoulderWidths: 0.15,
} as const;

export type PauseReason = "unlocked" | "lost" | "jump" | "overlap";

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
  /** Body width used for the jump and touch rules, pixel space (see minWidthPerTrunk). */
  width: number;
}

export class SubjectLock {
  private state: LockState | null = null;
  private frames = 0;
  private pausedFrames = 0;
  private run = 0;
  private touchedAny = false;

  constructor(private readonly rules: typeof SUBJECT_RULES = SUBJECT_RULES) {}

  get locked(): boolean {
    return this.state !== null;
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
   * Locks onto the person nearest the frame centre. Returns false (and stays unlocked) when there
   * is nobody. Calling it again re-locks, for example at the next calibration, and resets the
   * attempt statistics.
   */
  lock(poses: Landmark[][], aspect?: number): boolean {
    const a = effectiveAspect(aspect);
    const clean = poses.map(sanitizePose);
    const i = nearestCentre(clean, a);
    this.resetAttempt();
    const p = i < 0 ? null : toPixelSpace(clean[i], a);
    const hip = p ? trackPoint(p) : null;
    if (!p || !hip) {
      this.state = null;
      return false;
    }
    const shoulders = dist(p[LM.l_shoulder], p[LM.r_shoulder]);
    const trunk = dist(midShoulder(p), hip);
    const width = Math.max(
      Number.isFinite(shoulders) ? shoulders : 0,
      this.rules.minWidthPerTrunk * (Number.isFinite(trunk) ? trunk : 0),
      1e-3,
    );
    this.state = { aspect: a, lastT: null, anchor: hip, ref: { ...hip }, width };
    return true;
  }

  /** Forgets the subject. */
  unlock(): void {
    this.state = null;
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
   * (ms) is the frame time, which scales the jump limit after a late frame (jump-per-time).
   */
  pick(poses: Landmark[][], aspect?: number, t?: number): SubjectPick {
    const s = this.state;
    if (!s) {
      return {
        lm: null,
        index: -1,
        paused: true,
        reason: "unlocked",
        touching: false,
        overlap: 0,
        jump: 0,
        others: 0,
      };
    }
    const a = aspect === undefined ? s.aspect : effectiveAspect(aspect);
    const frames =
      t !== undefined && s.lastT !== null && t > s.lastT ? (t - s.lastT) / this.rules.jumpNominalFrameMs : 1;
    if (t !== undefined) s.lastT = t;
    const jumpLimit = this.rules.jumpShoulderWidths * Math.min(Math.max(1, frames), this.rules.jumpMaxFrames);
    const people: { i: number; raw: Landmark[]; px: Landmark[] }[] = [];
    poses.forEach((pose, i) => {
      const raw = sanitizePose(pose);
      if (isPerson(raw)) people.push({ i, raw, px: toPixelSpace(raw, a) });
    });

    this.frames++;
    if (!people.length) {
      return this.count({
        lm: null,
        index: -1,
        paused: true,
        reason: "lost",
        touching: false,
        overlap: 0,
        jump: 0,
        others: 0,
      });
    }

    let k = 0;
    let best = Infinity;
    people.forEach((p, j) => {
      const hip = trackPoint(p.px);
      const d = hip ? dist(hip, s.ref) : Infinity;
      if (d < best) {
        best = d;
        k = j;
      }
    });
    const subject = people[k];
    const others = people.filter((_, j) => j !== k);
    const jump = best / s.width;

    if (!(jump <= jumpLimit)) {
      return this.count({
        lm: null,
        index: -1,
        paused: true,
        reason: "jump",
        touching: false,
        overlap: 0,
        jump,
        others: people.length,
      });
    }

    s.ref = trackPoint(subject.px)!;
    const box = poseBox(subject.px);
    let overlap = 0;
    for (const o of others) {
      const ob = poseBox(o.px);
      if (box && ob) overlap = Math.max(overlap, overlapShare(box, ob));
    }
    const touchDist = this.rules.touchShoulderWidths * s.width;
    const touching = others.some((o) => handTouches(o.px, subject.px, touchDist));
    const paused = overlap > this.rules.overlapMax;
    if (touching) this.touchedAny = true;
    return this.count({
      lm: subject.raw,
      index: subject.i,
      paused,
      reason: paused ? "overlap" : null,
      touching,
      overlap,
      jump,
      others: others.length,
    });
  }

  private count(p: SubjectPick): SubjectPick {
    if (p.paused) {
      this.pausedFrames++;
      this.run++;
    } else this.run = 0;
    return p;
  }

  /** `pick` on a frame's poses, with the frame's aspect and time. */
  pickFrame(frame: Frame): SubjectPick {
    return this.pick(posesOf(frame), frame.aspect ?? this.state?.aspect, frame.t);
  }
}

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
