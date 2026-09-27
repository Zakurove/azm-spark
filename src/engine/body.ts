/**
 * Pixel space measures of one pose, shared by the subject lock (subject.ts), the quality gate
 * (quality.ts) and the check in detectors (checkin.ts). Pure TS, no DOM.
 *
 * Every function takes landmarks that are ALREADY in pixel space (x scaled by the aspect ratio,
 * see `toPixelSpace` in geometry.ts, D-003), so lengths and angles are true image proportions in
 * units of the image height. Callers convert once per pose with `toPixelSpace(lm, aspect)`.
 */
import { VIS_MIN } from "./geometry";
import { Landmark, LM } from "./types";

export interface Pt {
  x: number;
  y: number;
}

/** Axis aligned bounding box, pixel space. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * View classes by pixel space shoulder width ÷ trunk length (architecture section 5, tuned on the
 * generated fixtures of tests/fixtures/gen.ts; tune at booth). A turned body keeps its trunk length
 * but its shoulder width shrinks with the cosine of the turn. For a nominal adult (ratio about 0.68
 * square on) front means turned less than about 36 degrees and side means turned more than about
 * 54 degrees. The side limit sits midway between the two views the tests are filmed in: the arm
 * curl's anterolateral view (up to 30 degrees from the side, a turn of 60, ratio about 0.35) stays
 * "side", and the chair stand's 45 degree view (ratio about 0.47) stays "oblique", each with room
 * for about 14 percent broader or narrower shoulders than nominal.
 */
// SPEC-GAP: view-thresholds. The architecture names the measure but no values ("tune on
// fixtures"). No single limit separates the two filmed views for every body: a person with
// shoulders more than about 14 percent narrower than nominal reads "side" at 45 degrees (the
// chair stand then asks for the phone angle again), and one more than about 14 percent broader
// reads "oblique" at the curl's 30 degree allowance (the curl then asks the person to turn).
// Either way the attempt is retried, never scored in a doubtful view. Tune at booth.
export const VIEW_RATIO = {
  frontMin: 0.55,
  sideMax: 0.4,
  /** Nominal square on ratio, used only to estimate a turn angle for the record. */
  nominalFront: 0.7,
} as const;

export const midPoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Mid hip, from the model's hip estimates whatever their visibility: the model still places hips it
 * cannot see (a wheelchair's armrests and wheels hide them), and spec 4.0 anchors the subject on
 * the mid hip in every setup.
 */
export const midHip = (p: Landmark[]): Pt => midPoint(p[LM.l_hip], p[LM.r_hip]);
export const midShoulder = (p: Landmark[]): Pt => midPoint(p[LM.l_shoulder], p[LM.r_shoulder]);

export const visible = (p: Landmark[], i: number, min = VIS_MIN): boolean => (p[i]?.visibility ?? 0) >= min;

/** Landmarks that show a person is there: nose, shoulders, hips. */
const CORE = [LM.nose, LM.l_shoulder, LM.r_shoulder, LM.l_hip, LM.r_hip];

/** A real detection, not the empty pose a source sends when nobody was found. */
export function isPerson(p: Landmark[] | null | undefined): p is Landmark[] {
  return !!p && p.length >= 33 && CORE.some((i) => visible(p, i));
}

/** Box around the visible landmarks, or null when fewer than 2 are visible. */
export function poseBox(p: Landmark[], minVis = VIS_MIN): Box | null {
  let n = 0;
  const b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const q of p) {
    if (q.visibility < minVis) continue;
    n++;
    b.x0 = Math.min(b.x0, q.x);
    b.y0 = Math.min(b.y0, q.y);
    b.x1 = Math.max(b.x1, q.x);
    b.y1 = Math.max(b.y1, q.y);
  }
  return n >= 2 ? b : null;
}

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

// SPEC-GAP: overlap-measure. Spec 4.0 says "a bounding box overlap over 20 percent" without the
// measure. Of the readings (share of the subject's box, intersection over union, share of the
// smaller box) this is the most sensitive, so a small pose inside the subject's box (a child, a
// helper's partial pose) still pauses scoring. Tune at booth.
/**
 * How much two boxes overlap: the intersection as a share of the SMALLER box.
 */
export function overlapShare(a: Box, b: Box): number {
  const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (ix <= 0 || iy <= 0) return 0;
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 ? Math.min(1, (ix * iy) / smaller) : 0;
}

/** Mid shoulder to mid hip length (pixel space, units of image height). */
export const trunkPx = (p: Landmark[]): number => dist(midShoulder(p), midHip(p));

/** Shoulder to shoulder length (pixel space, units of image height). */
export const shoulderPx = (p: Landmark[]): number => dist(p[LM.l_shoulder], p[LM.r_shoulder]);

/** Shoulder to elbow length of one side (pixel space). */
export const upperArmPx = (p: Landmark[], side: "left" | "right"): number =>
  side === "left" ? dist(p[LM.l_shoulder], p[LM.l_elbow]) : dist(p[LM.r_shoulder], p[LM.r_elbow]);

/** Shoulder to elbow plus elbow to wrist of one side (pixel space). */
export const armPx = (p: Landmark[], side: "left" | "right"): number =>
  side === "left"
    ? dist(p[LM.l_shoulder], p[LM.l_elbow]) + dist(p[LM.l_elbow], p[LM.l_wrist])
    : dist(p[LM.r_shoulder], p[LM.r_elbow]) + dist(p[LM.r_elbow], p[LM.r_wrist]);

/**
 * Trunk angle from the image vertical in degrees (mid hip to mid shoulder), positive when the
 * shoulders are to the image right of the hips. Same definition as the `trunk_lean` metric.
 */
export function leanDeg(p: Landmark[]): number {
  const s = midShoulder(p);
  const h = midHip(p);
  return (Math.atan2(s.x - h.x, h.y - s.y) * 180) / Math.PI;
}

/** Distance from point q to the segment ab. */
export function segmentDistance(q: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const k = len2 > 1e-12 ? Math.min(1, Math.max(0, ((q.x - a.x) * vx + (q.y - a.y) * vy) / len2)) : 0;
  return Math.hypot(q.x - (a.x + k * vx), q.y - (a.y + k * vy));
}
