/**
 * Pose building for stream B's tests (tests/v7/b-*.test.ts): simple 2D bodies in a square picture
 * (aspect 1, so the normalized landmarks are already pixel space, D-003), in the views and positions the
 * range of motion movements are filmed in, and the geometric edits that set one compensation's measure
 * (a trunk tilt, a shorter segment, a hand near a joint, a bent knee). Clearly synthetic.
 */
import type { Landmark } from "../../src/engine/types";
import { calibrate, type AngleContext, type RomCalibration } from "../../src/engine/rom/angles";
import type { RomMovementId, RomSide } from "../../src/movements/rom/types";

export type Pt = { x: number; y: number };
type Pts = Partial<Record<number, Pt>>;
const RAD = Math.PI / 180;

/** 33 landmarks: the given points at their visibility (default 0.95), the rest unseen in the middle. */
export function pose(points: Pts, vis: Partial<Record<number, number>> = {}): Landmark[] {
  return Array.from({ length: 33 }, (_, i) => {
    const p = points[i];
    return p ? { x: p.x, y: p.y, z: 0, visibility: vis[i] ?? 0.95 } : { x: 0.5, y: 0.5, z: 0, visibility: 0 };
  });
}

/** The landmarks of the far side of a side view: offset a little and less visible, as the model reports them. */
function withFarSide(near: Pts, nearIds: number[], farOf: (i: number) => number, farVis = 0.7) {
  const pts: Pts = { ...near };
  const vis: Partial<Record<number, number>> = {};
  for (const i of nearIds) {
    const p = near[i];
    if (!p) continue;
    pts[farOf(i)] = { x: p.x - 0.012, y: p.y - 0.004 };
    vis[farOf(i)] = farVis;
  }
  return pose(pts, vis);
}

/** The model's left id of a right id (MediaPipe pairs). */
const leftOf = (i: number) =>
  i >= 11 ? i - 1 : ({ 4: 1, 5: 2, 6: 3, 8: 7, 10: 9 } as Record<number, number>)[i];
const RIGHT_IDS = [5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];

/**
 * Seated, side view, the person's right side nearest the phone, facing the picture's right: trunk
 * upright (0.25 long), arm hanging, thigh forward, shank down.
 */
export function sideSeated(): Landmark[] {
  return withFarSide(
    {
      0: { x: 0.56, y: 0.22 },
      5: { x: 0.548, y: 0.205 },
      6: { x: 0.545, y: 0.205 },
      8: { x: 0.495, y: 0.21 },
      10: { x: 0.55, y: 0.24 },
      12: { x: 0.5, y: 0.3 },
      14: { x: 0.5, y: 0.45 },
      16: { x: 0.5, y: 0.58 },
      18: { x: 0.5, y: 0.6 },
      20: { x: 0.505, y: 0.61 },
      22: { x: 0.505, y: 0.6 },
      24: { x: 0.5, y: 0.55 },
      26: { x: 0.68, y: 0.56 },
      28: { x: 0.68, y: 0.76 },
      30: { x: 0.665, y: 0.78 },
      32: { x: 0.73, y: 0.785 },
    },
    RIGHT_IDS,
    leftOf,
  );
}

/** Standing, side view, right side nearest, facing the picture's right; legs straight under the hips. */
export function sideStanding(): Landmark[] {
  return withFarSide(
    {
      0: { x: 0.56, y: 0.12 },
      5: { x: 0.548, y: 0.105 },
      6: { x: 0.545, y: 0.105 },
      8: { x: 0.495, y: 0.11 },
      10: { x: 0.55, y: 0.14 },
      12: { x: 0.5, y: 0.2 },
      14: { x: 0.5, y: 0.35 },
      16: { x: 0.5, y: 0.47 },
      18: { x: 0.5, y: 0.49 },
      20: { x: 0.505, y: 0.5 },
      22: { x: 0.505, y: 0.49 },
      24: { x: 0.5, y: 0.45 },
      26: { x: 0.5, y: 0.66 },
      28: { x: 0.5, y: 0.87 },
      30: { x: 0.485, y: 0.89 },
      32: { x: 0.56, y: 0.895 },
    },
    RIGHT_IDS,
    leftOf,
  );
}

/** Lying on the back, side view, right side nearest, head to the picture's left, face up. */
export function lyingSide(): Landmark[] {
  return withFarSide(
    {
      0: { x: 0.2, y: 0.54 },
      5: { x: 0.205, y: 0.535 },
      6: { x: 0.205, y: 0.535 },
      8: { x: 0.215, y: 0.6 },
      10: { x: 0.22, y: 0.55 },
      12: { x: 0.3, y: 0.6 },
      14: { x: 0.42, y: 0.61 },
      16: { x: 0.52, y: 0.62 },
      18: { x: 0.54, y: 0.62 },
      20: { x: 0.545, y: 0.62 },
      22: { x: 0.54, y: 0.615 },
      24: { x: 0.55, y: 0.6 },
      26: { x: 0.75, y: 0.6 },
      28: { x: 0.93, y: 0.6 },
      30: { x: 0.95, y: 0.61 },
      32: { x: 0.955, y: 0.55 },
    },
    RIGHT_IDS,
    leftOf,
  );
}

/** Seated, front view, facing the phone: the person's right side on the picture's left; arms hanging. */
export function frontSeated(): Landmark[] {
  return pose({
    0: { x: 0.5, y: 0.26 },
    2: { x: 0.52, y: 0.24 },
    3: { x: 0.535, y: 0.24 },
    5: { x: 0.48, y: 0.24 },
    6: { x: 0.465, y: 0.24 },
    7: { x: 0.55, y: 0.25 },
    8: { x: 0.45, y: 0.25 },
    9: { x: 0.51, y: 0.28 },
    10: { x: 0.49, y: 0.28 },
    11: { x: 0.6, y: 0.4 },
    12: { x: 0.4, y: 0.4 },
    13: { x: 0.62, y: 0.55 },
    14: { x: 0.38, y: 0.55 },
    15: { x: 0.63, y: 0.68 },
    16: { x: 0.37, y: 0.68 },
    17: { x: 0.635, y: 0.7 },
    18: { x: 0.365, y: 0.7 },
    19: { x: 0.632, y: 0.71 },
    20: { x: 0.368, y: 0.71 },
    21: { x: 0.628, y: 0.7 },
    22: { x: 0.372, y: 0.7 },
    23: { x: 0.56, y: 0.7 },
    24: { x: 0.44, y: 0.7 },
    25: { x: 0.57, y: 0.82 },
    26: { x: 0.43, y: 0.82 },
    27: { x: 0.57, y: 0.95 },
    28: { x: 0.43, y: 0.95 },
  });
}

/** Standing, front view, facing the phone, feet together. */
export function frontStanding(): Landmark[] {
  return pose({
    0: { x: 0.5, y: 0.12 },
    2: { x: 0.52, y: 0.1 },
    5: { x: 0.48, y: 0.1 },
    7: { x: 0.55, y: 0.11 },
    8: { x: 0.45, y: 0.11 },
    11: { x: 0.58, y: 0.25 },
    12: { x: 0.42, y: 0.25 },
    13: { x: 0.6, y: 0.4 },
    14: { x: 0.4, y: 0.4 },
    15: { x: 0.61, y: 0.53 },
    16: { x: 0.39, y: 0.53 },
    23: { x: 0.545, y: 0.5 },
    24: { x: 0.455, y: 0.5 },
    25: { x: 0.545, y: 0.7 },
    26: { x: 0.455, y: 0.7 },
    27: { x: 0.545, y: 0.9 },
    28: { x: 0.455, y: 0.9 },
    29: { x: 0.545, y: 0.92 },
    30: { x: 0.455, y: 0.92 },
    31: { x: 0.545, y: 0.93 },
    32: { x: 0.455, y: 0.93 },
  });
}

/* ------------------------------------------------------------------ edits (each returns a new pose) */

/** The head, the shoulders, the arms and the hands. */
export const UPPER_BODY = Array.from({ length: 23 }, (_, i) => i);

export const point = (px: Landmark[], i: number): Pt => ({ x: px[i].x, y: px[i].y });
export const midOf = (px: Landmark[], a: number, b: number): Pt => ({
  x: (px[a].x + px[b].x) / 2,
  y: (px[a].y + px[b].y) / 2,
});

/** `p` turned by `deg` about `c` (positive turns the picture's right toward its bottom: clockwise on screen). */
export function turnPoint(p: Pt, c: Pt, deg: number): Pt {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const co = Math.cos(deg * RAD);
  const si = Math.sin(deg * RAD);
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
}

/** The landmarks `ids` turned by `deg` about `c`. */
export function rotate(px: Landmark[], ids: readonly number[], c: Pt, deg: number): Landmark[] {
  return px.map((q, i) => (ids.includes(i) ? { ...q, ...turnPoint(q, c, deg) } : { ...q }));
}

/** The landmarks `ids` moved by (dx, dy). */
export function shift(px: Landmark[], ids: readonly number[], dx: number, dy: number): Landmark[] {
  return px.map((q, i) => (ids.includes(i) ? { ...q, x: q.x + dx, y: q.y + dy } : { ...q }));
}

/**
 * The segment from `anchor` to `end` scaled to `ratio` of its length; the landmarks `carried` (the end and
 * what hangs from it) move with the end.
 */
export function scaleSegment(
  px: Landmark[],
  anchor: number,
  end: number,
  ratio: number,
  carried: readonly number[] = [end],
): Landmark[] {
  const dx = (px[end].x - px[anchor].x) * (ratio - 1);
  const dy = (px[end].y - px[anchor].y) * (ratio - 1);
  return shift(px, carried, dx, dy);
}

/** One landmark placed at `p` (visible). */
export function place(px: Landmark[], i: number, p: Pt, visibility = 0.95): Landmark[] {
  return px.map((q, k) => (k === i ? { ...q, x: p.x, y: p.y, visibility } : { ...q }));
}

/** Landmarks' visibility set to `v`. */
export function hide(px: Landmark[], ids: readonly number[], v = 0.1): Landmark[] {
  return px.map((q, i) => (ids.includes(i) ? { ...q, visibility: v } : { ...q }));
}

/* ------------------------------------------------------------------ calibration */

/** The context a runner would measure in after calibrating on `frames` copies of the start pose. */
export function calibratedContext(
  id: RomMovementId,
  side: RomSide,
  start: Landmark[],
  opts: { mirrored?: boolean; rollDeg?: number | null; frames?: Landmark[][] } = {},
): AngleContext {
  const base = { side, mirrored: !!opts.mirrored, rollDeg: opts.rollDeg ?? 0 };
  const frames = (opts.frames ?? Array.from({ length: 15 }, () => start)).map((px) => ({ px }));
  const calibration: RomCalibration | null = calibrate(id, frames, base);
  if (!calibration) throw new Error(`no calibration for ${id} on the start pose`);
  return { ...base, calibration };
}
