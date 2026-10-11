/**
 * A person's look in the picture (D-038 item 2: the crowd-proof lock, the booth full of people): the
 * colour of the torso and of the upper legs, read from a small copy of the camera picture a few times
 * a second (app/poseSource.ts). The lock (subject.ts) uses it with the size, the torso proportions and
 * the place to tell the locked person from the people around them: a pose whose look is clearly
 * another person's is never taken for them. Pure TS, no DOM: the picture comes in as RGBA bytes.
 *
 * What is read, for each pose:
 *   - the torso: a grid of points inside the shoulders and hips (30 to 70 percent across, 20 to 85
 *     percent down), so the background and the arms at its sides are left out;
 *   - the upper legs: points along each thigh, hip to knee (30, 50 and 70 percent);
 *   each region's colour is the median of its points inside the picture (a region with fewer than
 *   LOOK_RULES.minPoints points, or whose corners the model does not see, is not read).
 * How two looks compare (lookDistance): per region, the larger of the colour difference (chroma,
 * which a change of light hardly moves) and the brightness ratio, each over its edge of «the same»;
 * 1 is that edge. A region's distance is the person's when both regions differ (`min`), so a jacket
 * open in front and dark at the back, or a turn, never makes the person someone else as long as the
 * other region matches; the mean ranks the candidates.
 * All thresholds are engineering choices, tune at the booth.
 */
import type { Landmark } from "./types";

/** A region's colour: red, green and blue, 0 to 255. */
export type Rgb = readonly [number, number, number];

export interface Look {
  torso: Rgb | null;
  legs: Rgb | null;
}

export const LOOK_RULES = {
  /** Opponent chroma difference at the edge of «the same» (white against beige is about 0.07). */
  chroma: 0.08,
  /** Brightness ratio at the edge of «the same» (the camera's exposure moves less as a person nears it). */
  brightness: 1.6,
  /** A region is read from at least this many points inside the picture. */
  minPoints: 4,
  /** Its corner landmarks seen at least this much. */
  visibility: 0.5,
} as const;

interface P {
  x: number;
  y: number;
}

const lerp = (a: P, b: P, s: number): P => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s });
const ok = (q: Landmark | undefined): q is Landmark =>
  !!q && Number.isFinite(q.x) && Number.isFinite(q.y) && (q.visibility ?? 0) >= LOOK_RULES.visibility;

const TORSO_U = [0.3, 0.5, 0.7];
const TORSO_V = [0.2, 0.42, 0.64, 0.85];
const THIGH = [0.3, 0.5, 0.7];

/** The points a pose's look is read at (normalized), per region; a region the model does not see is empty. */
export function lookPoints(lm: Landmark[]): { torso: P[]; legs: P[] } {
  const torso: P[] = [];
  const [ls, rs, lh, rh] = [lm[11], lm[12], lm[23], lm[24]];
  // The shoulders seen, and the hips placed (a seated person close to the phone has them below it).
  if (ok(ls) && ok(rs) && Number.isFinite(lh?.x) && Number.isFinite(rh?.x))
    for (const v of TORSO_V) {
      const l = lerp(ls, lh, v);
      const r = lerp(rs, rh, v);
      for (const u of TORSO_U) torso.push(lerp(l, r, u));
    }
  const legs: P[] = [];
  for (const [h, k] of [
    [23, 25],
    [24, 26],
  ] as const)
    if (ok(lm[h]) && ok(lm[k])) for (const s of THIGH) legs.push(lerp(lm[h], lm[k], s));
  return { torso, legs };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** A region's colour from the picture: the median of its points inside it, or null with too few. */
function regionColour(rgba: ArrayLike<number>, w: number, h: number, pts: P[]): Rgb | null {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  for (const q of pts) {
    if (!(q.x >= 0 && q.x < 1 && q.y >= 0 && q.y < 1)) continue;
    const k = (Math.min(h - 1, Math.floor(q.y * h)) * w + Math.min(w - 1, Math.floor(q.x * w))) * 4;
    r.push(rgba[k]);
    g.push(rgba[k + 1]);
    b.push(rgba[k + 2]);
  }
  if (r.length < LOOK_RULES.minPoints) return null;
  return [median(r), median(g), median(b)];
}

/**
 * A pose's look in a picture of `w` by `h` RGBA pixels (the camera picture as the model saw it, not
 * mirrored; the landmarks normalized as the model gives them). Null when no region could be read.
 */
export function lookOf(rgba: ArrayLike<number>, w: number, h: number, lm: Landmark[]): Look | null {
  if (!(w > 0 && h > 0) || lm.length < 33) return null;
  const pts = lookPoints(lm);
  const torso = regionColour(rgba, w, h, pts.torso);
  const legs = regionColour(rgba, w, h, pts.legs);
  return torso || legs ? { torso, legs } : null;
}

/** One region's distance: the larger of the chroma and brightness differences, each over its edge (1). */
function regionDistance(a: Rgb, b: Rgb): number {
  const chroma = (c: Rgb): [number, number] => {
    const s = c[0] + c[1] + c[2] + 30;
    return [(c[0] - c[1]) / s, (c[0] + c[1] - 2 * c[2]) / (2 * s)];
  };
  const [a1, a2] = chroma(a);
  const [b1, b2] = chroma(b);
  const dc = Math.hypot(a1 - b1, a2 - b2) / LOOK_RULES.chroma;
  const la = (a[0] + a[1] + a[2]) / 3 + 12;
  const lb = (b[0] + b[1] + b[2]) / 3 + 12;
  const dl = Math.abs(Math.log(la / lb)) / Math.log(LOOK_RULES.brightness);
  return Math.max(dc, dl);
}

/**
 * How far apart two looks are over the regions both have: `mean` ranks, `min` decides (a person is
 * clearly another one only when every region shared differs). Null when no region is shared.
 */
export function lookDistance(a: Look | null, b: Look | null): { mean: number; min: number } | null {
  if (!a || !b) return null;
  const d: number[] = [];
  if (a.torso && b.torso) d.push(regionDistance(a.torso, b.torso));
  if (a.legs && b.legs) d.push(regionDistance(a.legs, b.legs));
  if (!d.length) return null;
  return { mean: d.reduce((s, x) => s + x, 0) / d.length, min: Math.min(...d) };
}

/** A look reference moved `share` of the way to a new sample (a region new to it is taken as it is). */
export function blendLook(ref: Look | null, now: Look, share: number): Look {
  if (!ref) return now;
  const mix = (a: Rgb | null, b: Rgb | null): Rgb | null =>
    a && b
      ? [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share, a[2] + (b[2] - a[2]) * share]
      : (a ?? b);
  return { torso: mix(ref.torso, now.torso), legs: mix(ref.legs, now.legs) };
}
