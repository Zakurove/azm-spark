/**
 * The standing calibration of a gait view (gait-rules 2.1 "Standing calibration"): 3 s standing still
 * in the view's position gives the zeros of the trailing limb angle, the foot pitch and the trunk
 * inclination (side views), of the pelvic obliquity and the trunk's lateral lean (front views), the
 * arm length for the arm swing and the standing height in pixels. Medians over the calibration's
 * samples, after the same pre-processing as the walk. Pure, no DOM.
 */
import { dropAt, leanAt, leftOnRight, pitchAt, tlaAt, trunkAt, distAt } from "./kinematics";
import { LEG, prepare, type Series } from "./preprocess";
import { standingHeightPx } from "./scale";
import type { GaitFrame } from "./types";
import { median, type LimbSide } from "./util";

export interface StandingZeros {
  /** The direction the person faced in a side view calibration (foot index ahead of the heel). */
  d: 1 | -1 | null;
  tla: Record<LimbSide, number | null>;
  pitch: Record<LimbSide, number | null>;
  trunk: number | null;
  /** Shoulder to wrist, units of the picture height. */
  armLength: Record<LimbSide, number | null>;
  /** The trunk's lateral lean toward the person's left (front views). */
  leanLeft: number | null;
  /** The pelvic obliquity of each stance side (front views). */
  drop: Record<LimbSide, number | null>;
  /** Standing height in pixels (units of the picture height), or null. */
  heightPx: number | null;
}

const NONE: Record<LimbSide, null> = { left: null, right: null };

function medianOf(s: Series, f: (k: number) => number): number | null {
  const xs: number[] = [];
  for (const [a, b] of s.bouts) for (let k = a; k < b; k++) xs.push(f(k));
  return median(xs);
}

/** The zeros of one view's standing calibration (null fields when it gives none). */
export function standingZeros(
  standing: readonly GaitFrame[],
  kind: "side" | "front",
  rollDeg: number | null,
): StandingZeros {
  const out: StandingZeros = {
    d: null,
    tla: { ...NONE },
    pitch: { ...NONE },
    trunk: null,
    armLength: { ...NONE },
    leanLeft: null,
    drop: { ...NONE },
    heightPx: standingHeightPx(standing, rollDeg),
  };
  if (standing.length < 2) return out;
  const s = prepare(standing, { rollDeg, labels: kind === "front" ? "facing" : "none" }).series;
  if (!s.bouts.length) return out;
  if (kind === "front") {
    out.leanLeft = medianOf(s, (k) => leanAt(s, k) * leftOnRight(s, k));
    for (const side of ["left", "right"] as const) out.drop[side] = medianOf(s, (k) => dropAt(s, side, k));
    return out;
  }
  let sum = 0;
  for (const [a, b] of s.bouts)
    for (let k = a; k < b; k++)
      for (const side of ["left", "right"] as const) {
        const v = s.x[LEG[side].toe][k] - s.x[LEG[side].heel][k];
        if (Number.isFinite(v)) sum += v;
      }
  const d = sum > 0 ? 1 : sum < 0 ? -1 : null;
  out.d = d;
  for (const side of ["left", "right"] as const) {
    out.armLength[side] = medianOf(s, (k) => distAt(s, LEG[side].shoulder, LEG[side].wrist, k));
    if (d === null) continue;
    out.tla[side] = medianOf(s, (k) => tlaAt(s, side, k, d));
    out.pitch[side] = medianOf(s, (k) => pitchAt(s, side, k, d));
  }
  if (d !== null) out.trunk = medianOf(s, (k) => trunkAt(s, k, d));
  return out;
}
