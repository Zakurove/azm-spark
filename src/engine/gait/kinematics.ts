/**
 * The angle conventions of the gait rules (gait-rules 3.1, after Stenum et al. 2021), in pixel
 * space (D-003) with y along true down when the phone roll is known. Degrees. `d` is the walking
 * direction in the picture: +1 toward the picture's right, -1 toward its left. Pure, no DOM.
 *
 *   thigh  θT = atan2(d·(X knee − X hip), Y knee − Y hip): hip 0 vertical, flexion positive
 *   shank  θS = atan2(d·(X ankle − X knee), Y ankle − Y knee)
 *   knee   K = θT − θS: 0 straight, negative past straight
 *   TLA    atan2(d·(X hip − X ankle), Y ankle − Y hip): positive when the ankle trails the hip
 *   pitch  P = atan2(Y heel − Y foot index, d·(X foot index − X heel)): positive when the toes are up
 *   trunk  atan2(d·(X S − X H), Y H − Y S): forward positive (S mid shoulder, H mid hip)
 *
 * Front view: the trunk's lateral lean atan2(X S − X H, Y H − Y S) (toward the picture's right
 * positive) and the pelvic obliquity of a stance side, atan2(Y swing hip − Y stance hip,
 * |X left hip − X right hip|), positive when the swing side's hip is lower.
 */
import type { Series } from "./preprocess";
import { DEG, type LimbSide } from "./util";
import { LEG } from "./preprocess";

const ang = (dx: number, dy: number) => Math.atan2(dx, dy) * DEG;

export function thighAt(s: Series, side: LimbSide, k: number, d: number): number {
  const l = LEG[side];
  return ang(d * (s.x[l.knee][k] - s.x[l.hip][k]), s.y[l.knee][k] - s.y[l.hip][k]);
}

export function shankAt(s: Series, side: LimbSide, k: number, d: number): number {
  const l = LEG[side];
  return ang(d * (s.x[l.ankle][k] - s.x[l.knee][k]), s.y[l.ankle][k] - s.y[l.knee][k]);
}

export function kneeAt(s: Series, side: LimbSide, k: number, d: number): number {
  return thighAt(s, side, k, d) - shankAt(s, side, k, d);
}

export function tlaAt(s: Series, side: LimbSide, k: number, d: number): number {
  const l = LEG[side];
  return ang(d * (s.x[l.hip][k] - s.x[l.ankle][k]), s.y[l.ankle][k] - s.y[l.hip][k]);
}

export function pitchAt(s: Series, side: LimbSide, k: number, d: number): number {
  const l = LEG[side];
  return ang(s.y[l.heel][k] - s.y[l.toe][k], d * (s.x[l.toe][k] - s.x[l.heel][k]));
}

export const midX = (s: Series, a: number, b: number, k: number) => (s.x[a][k] + s.x[b][k]) / 2;
export const midY = (s: Series, a: number, b: number, k: number) => (s.y[a][k] + s.y[b][k]) / 2;

export function trunkAt(s: Series, k: number, d: number): number {
  return ang(d * (midX(s, 11, 12, k) - midX(s, 23, 24, k)), midY(s, 23, 24, k) - midY(s, 11, 12, k));
}

/** The trunk's lateral lean in the picture, toward the picture's right positive. */
export function leanAt(s: Series, k: number): number {
  return ang(midX(s, 11, 12, k) - midX(s, 23, 24, k), midY(s, 23, 24, k) - midY(s, 11, 12, k));
}

/** +1 when the person's left hip is on the picture's right (facing the phone), else -1. */
export function leftOnRight(s: Series, k: number): number {
  return s.x[23][k] > s.x[24][k] ? 1 : -1;
}

/** The pelvic obliquity of a stance side: positive when the other (swing) side's hip is lower. */
export function dropAt(s: Series, stance: LimbSide, k: number): number {
  const st = LEG[stance].hip;
  const sw = stance === "left" ? 24 : 23;
  return ang(s.y[sw][k] - s.y[st][k], Math.abs(s.x[23][k] - s.x[24][k]));
}

/** The distance between two landmarks at a sample (units of the picture height). */
export function distAt(s: Series, a: number, b: number, k: number): number {
  return Math.hypot(s.x[a][k] - s.x[b][k], s.y[a][k] - s.y[b][k]);
}

/** Mid shoulder to mid hip, the body size the motion and distance rules read. */
export function trunkLengthAt(s: Series, k: number): number {
  return Math.hypot(midX(s, 11, 12, k) - midX(s, 23, 24, k), midY(s, 11, 12, k) - midY(s, 23, 24, k));
}
