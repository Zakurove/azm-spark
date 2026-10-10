/**
 * The steady skeleton of the v7 camera screens (D-036 item 5): the range measurement, the block card's
 * preview, the walk's live view and its test page all draw the body's lines through this one helper,
 * smoothed as the v1 camera exercise (the shoulder press) smooths them.
 *
 * Why the v7 lines shook, lagged and jumped while v1's stayed calm (the v1 workout, Session.tsx through
 * WorkoutFlow, draws the One Euro filtered frame):
 *   - the v7 stage drew the model's raw landmarks, with no filter at all;
 *   - it drew `frame.lm`, the first pose of a two pose model (the check asks for 2, spec 4.0), whose
 *     order is not stable from one frame to the next: a second detection made the lines jump to it;
 *   - a joint showed or vanished at one visibility threshold (0.5), so a joint near it popped in and
 *     out, and with it every bone it ends.
 *
 * What this helper does instead, for display only (what the engines measure is unchanged):
 *   - one person, the screen's locked person (D-037 item 4: the booth, many people in the picture):
 *     the pose the screen's lock marked in the frame (subject.ts subjectOf: the range measurement,
 *     the walk), nothing while that person is not seen, and nobody else ever; a frame no lock read
 *     (a block card's preview) is followed by the skeleton's own SubjectLock, the same rules;
 *   - the v1 filter on every point: oneEuro.ts OneEuro with the defaults PoseSmoother uses (minCutoff
 *     1.7, beta 0.3), fed each camera frame once, on the frames' own clock;
 *   - a joint the model does not see keeps its last place (a guess never moves it), and one unseen for
 *     a while starts its filter again where it comes back, so it never glides across the picture;
 *   - visibility with two thresholds (shown from 0.5, hidden under 0.3) and a fade (in over about
 *     0.1 s, out over about 0.25 s) on the display's clock: joints fade, never jump.
 *
 * `drawSkeleton` paints the result on a canvas, from a requestAnimationFrame loop (never React state).
 * Pure apart from the canvas; no DOM is read here.
 */
import { isPerson } from "../engine/body";
import { OneEuro } from "../engine/oneEuro";
import { CROWD_LOCK, posesOf, SUBJECT_RULES, SubjectLock, subjectOf } from "../engine/subject";
import type { Frame, Landmark } from "../engine/types";

/** The body's lines: arms, trunk, legs and feet. */
export const SKELETON_BONES: readonly (readonly [number, number])[] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 31],
  [28, 32],
  [27, 29],
  [28, 30],
];
/** The joints drawn as dots (the nose stands for the head). */
export const SKELETON_JOINTS: readonly number[] = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

/** Every point the skeleton draws. */
const POINTS: readonly number[] = [...new Set([...SKELETON_JOINTS, ...SKELETON_BONES.flat()])].sort(
  (a, b) => a - b,
);

export const SKELETON_RULES = {
  /** A hidden joint shows again from this visibility. */
  showAt: 0.5,
  /** A shown joint hides under this visibility (between the two it keeps its state). */
  hideBelow: 0.3,
  /** Fade in and fade out time constants, in milliseconds of the display. */
  fadeInMs: 90,
  fadeOutMs: 200,
  /** A joint unseen this long (frame clock) starts its filter again where it comes back. */
  restartAfterMs: 400,
  /** Under this opacity a joint or a bone is not drawn. */
  minAlpha: 0.02,
} as const;

/** A pose ready to draw: normalized points (null before a point was ever seen) and their opacity. */
export interface SkeletonPose {
  pts: readonly ({ x: number; y: number } | null)[];
  alpha: readonly number[];
}

interface Track {
  fx: OneEuro;
  fy: OneEuro;
  x: number;
  y: number;
  /** Frame time of the last frame that saw it. */
  seenT: number;
}

const finite = (q: Landmark | undefined): q is Landmark =>
  !!q && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.visibility);

/**
 * The display pose of one camera stage: `push` each new camera frame once, `pose(now)` at each
 * animation frame (it advances the fades on the display's clock).
 */
export class SteadySkeleton {
  private tracks: (Track | null)[] = [];
  /** The joint is shown (the two thresholds' state). */
  private on: boolean[] = [];
  private alphaNow: number[] = [];
  private lastNow: number | null = null;
  private last: Frame | null = null;
  /** The person followed in frames no screen lock read (the same rules as the screens', D-037 item 4, D-038 item 2). */
  private lock = new SubjectLock(SUBJECT_RULES, CROWD_LOCK);

  constructor() {
    this.reset();
  }

  /** Forgets everything (a new person, a new camera). */
  reset(): void {
    this.tracks = Array.from({ length: 33 }, () => null);
    this.on = Array.from({ length: 33 }, () => false);
    this.alphaNow = Array.from({ length: 33 }, () => 0);
    this.lastNow = null;
    this.last = null;
    this.lock = new SubjectLock(SUBJECT_RULES, CROWD_LOCK);
  }

  /**
   * The person of a frame this skeleton draws: the one the screen's lock marked (nobody while that
   * person is not seen), else the one its own lock follows. Never another person.
   */
  private pick(frame: Frame): Landmark[] | null {
    const poses = posesOf(frame);
    const marked = subjectOf(frame);
    if (marked !== undefined) {
      const lm = marked >= 0 ? (poses[marked] ?? null) : null;
      // The own lock stays on the screen's person, for a frame no lock reads later (taken again on
      // them when the screen's lock took someone new).
      if (lm && isPerson(lm) && !this.lock.lock([lm], frame.aspect, frame.t)) {
        this.lock.unlock();
        this.lock.lock([lm], frame.aspect, frame.t);
      }
      return lm && isPerson(lm) ? lm : null;
    }
    if (!this.lock.locked && !this.lock.lock(poses, frame.aspect, frame.t, frame.looks)) return null;
    return this.lock.pick(poses, frame.aspect, frame.t, frame.looks).lm;
  }

  /**
   * A new camera frame (each frame once; pushing the same frame again does nothing). The points it
   * sees go through the v1 filter; the others keep their last place.
   */
  push(frame: Frame): void {
    if (frame === this.last) return;
    this.last = frame;
    const t = frame.t;
    const lm = this.pick(frame);
    for (const i of POINTS) {
      const q = lm?.[i];
      const vis = finite(q) ? q.visibility : 0;
      // Two thresholds: a joint near one of them keeps its state instead of blinking.
      this.on[i] = this.on[i] ? vis >= SKELETON_RULES.hideBelow : vis >= SKELETON_RULES.showAt;
      if (!q || vis < SKELETON_RULES.hideBelow) continue;
      let tr = this.tracks[i];
      if (!tr || t - tr.seenT > SKELETON_RULES.restartAfterMs || t < tr.seenT) {
        // First seen, or back after a while: the filter starts where the joint is now.
        tr = { fx: new OneEuro(), fy: new OneEuro(), x: q.x, y: q.y, seenT: t };
        this.tracks[i] = tr;
      }
      tr.x = tr.fx.filter(q.x, t);
      tr.y = tr.fy.filter(q.y, t);
      tr.seenT = t;
    }
  }

  /** The pose to draw at display time `now` (ms), the fades advanced; null when nothing shows or fades in. */
  pose(now: number): SkeletonPose | null {
    const dt = this.lastNow === null ? 0 : Math.max(0, Math.min(250, now - this.lastNow));
    this.lastNow = now;
    let any = false;
    for (const i of POINTS) {
      const target = this.on[i] && this.tracks[i] ? 1 : 0;
      const tau = target > this.alphaNow[i] ? SKELETON_RULES.fadeInMs : SKELETON_RULES.fadeOutMs;
      const k = dt > 0 ? 1 - Math.exp(-dt / tau) : 0;
      this.alphaNow[i] += (target - this.alphaNow[i]) * k;
      if (Math.abs(target - this.alphaNow[i]) < 0.005) this.alphaNow[i] = target;
      // Something shows, or fades in.
      if (target === 1 || this.alphaNow[i] >= SKELETON_RULES.minAlpha) any = true;
    }
    if (!any) return null;
    return {
      pts: this.tracks.map((tr) => (tr ? { x: tr.x, y: tr.y } : null)),
      alpha: [...this.alphaNow],
    };
  }
}

export interface SkeletonStyle {
  /** Points drawn in gold (the joint being measured). */
  highlight?: ReadonlySet<number>;
  /** A smaller drawing (the block card's preview). */
  compact?: boolean;
}

/**
 * Paints a display pose: soft white halos, purple bones, white joints with a purple centre; the
 * measured joint's bones and joints in gold. `at` maps a normalized point to the canvas's CSS pixels
 * (the video's contain box), the canvas's transform already set for its pixel ratio.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  pose: SkeletonPose,
  at: (x: number, y: number) => { x: number; y: number },
  style: SkeletonStyle = {},
): void {
  const lit = style.highlight ?? new Set<number>();
  const k = style.compact ? 0.8 : 1;
  const P = pose.pts.map((p) => (p ? at(p.x, p.y) : null));
  const boneAlpha = (i: number, j: number) => (P[i] && P[j] ? Math.min(pose.alpha[i], pose.alpha[j]) : 0);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const passes: readonly [string, number, boolean][] = [
    ["rgba(255, 255, 255, 0.92)", 11 * k, false],
    ["rgba(128, 101, 173, 0.86)", 6 * k, false],
    ["#e9b52c", 7 * k, true],
  ];
  for (const [line, width, gold] of passes) {
    ctx.strokeStyle = line;
    ctx.lineWidth = width;
    for (const [i, j] of SKELETON_BONES) {
      if (gold && !(lit.has(i) && lit.has(j))) continue;
      const a = boneAlpha(i, j);
      if (a < SKELETON_RULES.minAlpha) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(P[i]!.x, P[i]!.y);
      ctx.lineTo(P[j]!.x, P[j]!.y);
      ctx.stroke();
    }
  }
  for (const i of SKELETON_JOINTS) {
    const q = P[i];
    const a = q ? pose.alpha[i] : 0;
    if (!q || a < SKELETON_RULES.minAlpha) continue;
    const on = lit.has(i);
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.arc(q.x, q.y, (on ? 9 : 6) * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = on ? "#e3ab1f" : "#6c56a5";
    ctx.arc(q.x, q.y, (on ? 6 : 4) * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
