/**
 * Angle maths of the v7 range of motion check (product v7 contract 2.3, 6.1 and 6.2), in pixel
 * space (toPixelSpace, D-003); z is never used. Pure, no DOM.
 *
 * 1. The Pose2Sim primitives, ported: pointsToAngle (points_to_angles), fixedAngle (fixed_angles)
 *    and POSE2SIM_ANGLES (angle_dict) in MediaPipe terms, with the Sports2D side handling of
 *    compute_angles_for_person (resolveVisibleSide, the x flip, pose2simAngle). Checked against the
 *    Python functions on tests/golden/points_to_angles.json (scripts/golden/make_golden.py).
 * 2. unsignedAngle, the ang(u, v) of the clinical conventions.
 * 3. MOVEMENT_ANGLES and calibrate: the angle of each of the 16 measured movements, each AngleFn
 *    quoting its rom-protocol.json movements[].angle definition word for word.
 *
 * Upstream of part 1:
 *   - Pose2Sim, https://github.com/perfanalytics/pose2sim, Pose2Sim/common.py (angle_dict,
 *     points_to_angles, fixed_angles; the Neck and Hip midpoints of add_shoulder_neck_hip_coords),
 *     commit 0875d55ce0112b33f6469a2b257fb27101aa6ce9. File header: __author__ = "David Pagnon",
 *     __copyright__ = "Copyright 2021, Maya-Mocap", __license__ = "BSD 3-Clause License".
 *   - Sports2D, https://github.com/davidpagnon/Sports2D, Sports2D/process.py
 *     (compute_angles_for_person: the visible side and the x flip), commit
 *     4392177d75dff43b4da60514d3766029201a5c5e. File header: __author__ = "David Pagnon, HunMin
 *     Kim", __copyright__ = "Copyright 2023, Sports2D", __license__ = "BSD 3-Clause License".
 *   - The BlazePose keypoint names and ids of Pose2Sim/skeletons.py BLAZEPOSE (same commit).
 * Modified for Azm: ported to TypeScript for one 2D frame; angle names in snake case; the left wrist
 * takes the vertex at the wrist like the right wrist (upstream: ['LElbow', 'LIndex', 'LWrist'],
 * oss.md 3.1; a mirror test asserts left equals right); the Neck and Hip midpoints are plain means
 * (upstream takes absolute x values, which only differs left of the picture); the wraps return the
 * ranges upstream documents, (-180, 180] and (-90, 90] for pelvis and shoulders (upstream's modulo
 * returns [-180, 180) and [-90, 90), the same angle on the circle); "head" is left out, as BlazePose
 * has no Head keypoint.
 *
 * Upstream licence (identical LICENSE files in Pose2Sim and Sports2D):
 *
 *   BSD 3-Clause License
 *
 *   Copyright (c) 2022, perfanalytics
 *   All rights reserved.
 *
 *   Redistribution and use in source and binary forms, with or without
 *   modification, are permitted provided that the following conditions are met:
 *
 *   1. Redistributions of source code must retain the above copyright notice, this
 *      list of conditions and the following disclaimer.
 *
 *   2. Redistributions in binary form must reproduce the above copyright notice,
 *      this list of conditions and the following disclaimer in the documentation
 *      and/or other materials provided with the distribution.
 *
 *   3. Neither the name of the copyright holder nor the names of its
 *      contributors may be used to endorse or promote products derived from
 *      this software without specific prior written permission.
 *
 *   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 *   AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 *   IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 *   DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 *   FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 *   DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 *   SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 *   CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 *   OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 *   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
import { LM, type Landmark } from "../types";
import { finitePoint, visible } from "../body";
import { cross, dot, downVector, median, norm, signedAngle, sub } from "../modes/common";
import { ROM_DATA, movementDef } from "../../movements/rom";
import type { RomMovementDef, RomMovementId, RomSide } from "../../movements/rom/types";

export type Pt = { x: number; y: number };

export interface AngleContext {
  /** tested side, or bend direction for axial movements */
  side: RomSide;
  mirrored: boolean;
  /** FeedEnv.rollDeg, for the gravity reference */
  rollDeg: number | null;
  /** start pose medians (trunk line, hip position, segment lengths, neutral head) */
  calibration: RomCalibration;
}
export interface RomCalibration {
  t: number;
  startDeg: number;
  trunkLine: { top: Pt; base: Pt } | null;
  fixedHip: Pt | null;
  segmentPx: Partial<Record<"upperArm" | "forearm" | "thigh" | "shank" | "trunk" | "shoulderWidth", number>>;
  neutralHeadDeg: number | null;
  gravityMode: boolean;
}
/** The movement's angle on one pixel space frame, in the movement's convention (flexion, lack or signed); null when a gate landmark is unseen. */
export type AngleFn = (px: Landmark[], ctx: AngleContext) => number | null;

const DEG = 180 / Math.PI;

/** (-180, 180] */
function wrapTurn(a: number): number {
  const r = ((((a + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}

/** (-90, 90] */
function wrapHalfTurn(a: number): number {
  const r = ((((a + 90) % 180) + 180) % 180) - 90;
  return r === -90 ? 90 : r;
}

/* ------------------------------------------------------------------ 1. Pose2Sim and Sports2D */

/**
 * Pose2Sim points_to_angles in 2D. 2 points: segment against the horizontal, atan2(dy, dx) of a - b;
 * 3 points: angle at the middle point, from a to c around b; 4 points: angle between a->b and c->d.
 * The 3 and 4 point angles are -atan2(u x v, u . v) as upstream. Degrees in (-180, 180]; NaN for
 * fewer than 2 or more than 4 points.
 */
export function pointsToAngle(points: readonly Pt[]): number {
  if (points.length === 2) {
    const ux = points[0].x - points[1].x;
    const uy = points[0].y - points[1].y;
    return wrapTurn(Math.atan2(uy, ux) * DEG);
  }
  let ux: number, uy: number, vx: number, vy: number;
  if (points.length === 3) {
    ux = points[0].x - points[1].x;
    uy = points[0].y - points[1].y;
    vx = points[2].x - points[1].x;
    vy = points[2].y - points[1].y;
  } else if (points.length === 4) {
    ux = points[1].x - points[0].x;
    uy = points[1].y - points[0].y;
    vx = points[3].x - points[2].x;
    vy = points[3].y - points[2].y;
  } else return Number.NaN;
  const cross = ux * vy - uy * vx;
  const dot = ux * vx + uy * vy;
  return wrapTurn(-Math.atan2(cross, dot) * DEG);
}

/** Pose2Sim fixed_angles: (angle + offset) * scale, wrapped to (-180, 180]. */
export function fixedAngle(angle: number, offset: number, scale: number): number {
  return wrapTurn((angle + offset) * scale);
}

/** ang(u, v) of the clinical conventions: atan2(|u x v|, u . v), 0 to 180. */
export function unsignedAngle(u: Pt, v: Pt): number {
  return Math.atan2(Math.abs(u.x * v.y - u.y * v.x), u.x * v.x + u.y * v.y) * DEG;
}

/** A MediaPipe landmark index, or Pose2Sim's Neck (mid shoulders 11 and 12) or Hip (mid hips 23 and 24). */
export type Pose2SimPoint = number | "neck" | "hip";
export interface Pose2SimAngleDef {
  points: readonly Pose2SimPoint[];
  kind: "dorsiflexion" | "flexion" | "horizontal";
  offset: number;
  scale: number;
}

/**
 * Pose2Sim angle_dict in MediaPipe terms (BlazePose ids of Pose2Sim skeletons.py: BigToe is the foot
 * index, 31 and 32; Index the index finger, 19 and 20). The upstream names are in each comment.
 */
export const POSE2SIM_ANGLES = {
  // joint angles
  right_ankle: { points: [26, 28, 32, 30], kind: "dorsiflexion", offset: 90, scale: 1 }, // RKnee RAnkle RBigToe RHeel
  left_ankle: { points: [25, 27, 31, 29], kind: "dorsiflexion", offset: 90, scale: 1 }, // LKnee LAnkle LBigToe LHeel
  right_knee: { points: [28, 26, 24], kind: "flexion", offset: -180, scale: 1 }, // RAnkle RKnee RHip
  left_knee: { points: [27, 25, 23], kind: "flexion", offset: -180, scale: 1 }, // LAnkle LKnee LHip
  right_hip: { points: [26, 24, "hip", "neck"], kind: "flexion", offset: 0, scale: -1 }, // RKnee RHip Hip Neck
  left_hip: { points: [25, 23, "hip", "neck"], kind: "flexion", offset: 0, scale: -1 }, // LKnee LHip Hip Neck
  right_shoulder: { points: [14, 12, "hip", "neck"], kind: "flexion", offset: 0, scale: -1 }, // RElbow RShoulder Hip Neck
  left_shoulder: { points: [13, 11, "hip", "neck"], kind: "flexion", offset: 0, scale: -1 }, // LElbow LShoulder Hip Neck
  right_elbow: { points: [16, 14, 12], kind: "flexion", offset: 180, scale: -1 }, // RWrist RElbow RShoulder
  left_elbow: { points: [15, 13, 11], kind: "flexion", offset: 180, scale: -1 }, // LWrist LElbow LShoulder
  right_wrist: { points: [14, 16, 20], kind: "flexion", offset: -180, scale: 1 }, // RElbow RWrist RIndex
  // Upstream: ['LElbow', 'LIndex', 'LWrist'] (vertex at the index finger). Here as the right wrist.
  left_wrist: { points: [13, 15, 19], kind: "flexion", offset: -180, scale: 1 }, // LElbow LWrist LIndex
  // segment angles
  right_foot: { points: [32, 30], kind: "horizontal", offset: 0, scale: -1 }, // RBigToe RHeel
  left_foot: { points: [31, 29], kind: "horizontal", offset: 0, scale: -1 }, // LBigToe LHeel
  right_shank: { points: [28, 26], kind: "horizontal", offset: 0, scale: -1 }, // RAnkle RKnee
  left_shank: { points: [27, 25], kind: "horizontal", offset: 0, scale: -1 }, // LAnkle LKnee
  right_thigh: { points: [26, 24], kind: "horizontal", offset: 0, scale: -1 }, // RKnee RHip
  left_thigh: { points: [25, 23], kind: "horizontal", offset: 0, scale: -1 }, // LKnee LHip
  pelvis: { points: [23, 24], kind: "horizontal", offset: 0, scale: -1 }, // LHip RHip
  trunk: { points: ["neck", "hip"], kind: "horizontal", offset: 0, scale: -1 }, // Neck Hip
  shoulders: { points: [11, 12], kind: "horizontal", offset: 0, scale: -1 }, // LShoulder RShoulder
  right_arm: { points: [14, 12], kind: "horizontal", offset: 0, scale: -1 }, // RElbow RShoulder
  left_arm: { points: [13, 11], kind: "horizontal", offset: 0, scale: -1 }, // LElbow LShoulder
  right_forearm: { points: [16, 14], kind: "horizontal", offset: 0, scale: -1 }, // RWrist RElbow
  left_forearm: { points: [15, 13], kind: "horizontal", offset: 0, scale: -1 }, // LWrist LElbow
  right_hand: { points: [20, 16], kind: "horizontal", offset: 0, scale: -1 }, // RIndex RWrist
  left_hand: { points: [19, 15], kind: "horizontal", offset: 0, scale: -1 }, // LIndex LWrist
} as const satisfies Record<string, Pose2SimAngleDef>;
export type Pose2SimAngleId = keyof typeof POSE2SIM_ANGLES;

/** Sports2D visible_side: auto (from the feet), a side view, a front or back view, or none. */
export type VisibleSide = "auto" | "right" | "left" | "front" | "back" | "none";

/** The R prefixed and L prefixed BlazePose keypoints of Pose2Sim skeletons.py (flipped in front and back views). */
const RIGHT_KEYPOINTS: ReadonlySet<number> = new Set([24, 26, 28, 30, 32, 5, 12, 14, 16, 18, 20, 22]);
const LEFT_KEYPOINTS: ReadonlySet<number> = new Set([23, 25, 27, 29, 31, 2, 11, 13, 15, 17, 19, 21]);

/**
 * Sports2D compute_angles_for_person: with "auto", the side the person faces from the feet, right
 * when the summed toe minus heel x of both feet (foot index 31 and 32 minus heel 29 and 30) is 0 or
 * more, else left. Any other value is returned as it is.
 */
export function resolveVisibleSide(
  px: readonly Pt[],
  visibleSide: VisibleSide,
): "right" | "left" | "front" | "back" | "none" {
  if (visibleSide !== "auto") return visibleSide;
  const right = px[32].x - px[30].x;
  const left = px[31].x - px[29].x;
  return right + left >= 0 ? "right" : "left";
}

/**
 * One Pose2Sim angle of a pixel space pose after the Sports2D flip: x unchanged for a right side
 * view (or none), every x negated for a left side view (Neck and Hip included), and for a front
 * (back) view the x of the right (left) keypoints negated. Then fixed_angles, with pelvis and
 * shoulders wrapped to (-90, 90]. NaN when a point is not a finite number.
 */
export function pose2simAngle(
  id: Pose2SimAngleId,
  px: readonly Pt[],
  visibleSide: VisibleSide = "auto",
): number {
  const side = resolveVisibleSide(px, visibleSide);
  const def: Pose2SimAngleDef = POSE2SIM_ANGLES[id];
  const at = (p: Pose2SimPoint): Pt => {
    if (p === "neck") return { x: (px[11].x + px[12].x) / 2, y: (px[11].y + px[12].y) / 2 };
    if (p === "hip") return { x: (px[23].x + px[24].x) / 2, y: (px[23].y + px[24].y) / 2 };
    return px[p];
  };
  const flipped = def.points.map((p): Pt => {
    const q = at(p);
    const negate =
      side === "left" ||
      (side === "front" && typeof p === "number" && RIGHT_KEYPOINTS.has(p)) ||
      (side === "back" && typeof p === "number" && LEFT_KEYPOINTS.has(p));
    return negate ? { x: -q.x, y: q.y } : { x: q.x, y: q.y };
  });
  const raw = pointsToAngle(flipped);
  return id === "pelvis" || id === "shoulders"
    ? wrapHalfTurn((raw + def.offset) * def.scale)
    : fixedAngle(raw, def.offset, def.scale);
}

/* ------------------------------------------------------------------ 3. The movement angles */

/** A landmark counts as seen at this visibility or more (rom-protocol engine.visibilityMin). */
const VIS_MIN = ROM_DATA.engine.visibilityMin;

/**
 * Ears under this visibility: the neck side bend reads the eye line ("Eye line (2 to 5) when ear
 * visibility is below 0.5", its definition below). Read from the data: the freeze step copied the
 * number next to the angle prose (movements[neck_lateral_flexion].earLineMinVisibility, A3-4).
 */
export const EAR_LINE_MIN_VISIBILITY: number =
  movementDef("neck_lateral_flexion").earLineMinVisibility ??
  (() => {
    throw new Error("rom-v7.json: neck_lateral_flexion has no earLineMinVisibility");
  })();

/**
 * The arm raises measure against the trunk when the hips are seen in at least this share of the start
 * frames, else against gravity (v1.1 4.1 as the v1 RangeTestRunner reads it: RANGE_RULES.hipsVisibleShare,
 * parity tested).
 */
export const HIPS_SEEN_SHARE = 0.9;

type Side = "left" | "right";
const otherSide = (s: Side): Side => (s === "left" ? "right" : "left");
/** The model's label for one of the person's sides: swapped in a mirrored picture (as sideLandmarks, modes/common.ts). */
const modelSide = (side: Side, mirrored: boolean): Side => (mirrored ? otherSide(side) : side);

/** MediaPipe ids of the sided landmarks the calibration reads. */
const SIDE_IDS = {
  shoulder: { left: LM.l_shoulder, right: LM.r_shoulder },
  elbow: { left: LM.l_elbow, right: LM.r_elbow },
  wrist: { left: LM.l_wrist, right: LM.r_wrist },
  hip: { left: LM.l_hip, right: LM.r_hip },
  knee: { left: LM.l_knee, right: LM.r_knee },
  ankle: { left: LM.l_ankle, right: LM.r_ankle },
} as const;

const sign = (v: number): 1 | -1 | 0 => (v > 0 ? 1 : v < 0 ? -1 : 0);
const point = (q: Landmark): Pt => ({ x: q.x, y: q.y });
const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
/** Direction of a vector in degrees, (-180, 180] (picture axes, y down). */
const angleOf = (v: Pt) => wrapTurn(Math.atan2(v.y, v.x) * DEG);
/** The turn from u to v in degrees, (-180, 180], positive where u x v is positive. */
const turnFrom = (u: Pt, v: Pt) => wrapTurn(Math.atan2(cross(u, v), dot(u, v)) * DEG);

/** U: true vertical up in the picture, image up corrected by the phone roll (the picture's own up without a reading). */
function trueUp(rollDeg: number | null): Pt {
  const d = downVector(rollDeg ?? 0);
  return { x: -d.x, y: -d.y };
}

/**
 * The camera side (rom-protocol conventions.sides): "the side whose shoulder, hip and knee have the
 * higher mean visibility", in the model's labels (left on a tie).
 */
export function cameraSide(px: Landmark[]): Side {
  const v = (i: number) => (finitePoint(px[i]) && Number.isFinite(px[i].visibility) ? px[i].visibility : 0);
  return v(11) + v(23) + v(25) >= v(12) + v(24) + v(26) ? "left" : "right";
}

/**
 * Which side of the line through `a` along `d` the nose (landmark 0) is on: 1 or -1, null on the line
 * or when the nose is not a number. Read at any visibility, for orientation only.
 */
function noseSide(px: Landmark[], a: Pt, d: Pt): 1 | -1 | null {
  const n = px[0];
  if (!finitePoint(n)) return null;
  const s = sign(cross(d, sub(n, a)));
  return s === 0 ? null : s;
}

/** The landmark roles of one movement (its data's `landmarks`) on one frame, for one model side. */
class Roles {
  constructor(
    readonly def: RomMovementDef,
    readonly px: Landmark[],
    readonly side: Side | null,
  ) {}

  ids(role: string): number[] {
    const ref = this.def.landmarks[role];
    if (ref === undefined) throw new Error(`angles: ${this.def.id} has no landmark role ${role}`);
    if (typeof ref === "number") return [ref];
    if (Array.isArray(ref)) return [ref[0], ref[1]];
    if ("mid" in ref) return [ref.mid[0], ref.mid[1]];
    if (this.side === null) throw new Error(`angles: ${this.def.id} role ${role} needs a side`);
    if ("other" in ref) return [SIDE_IDS[ref.other][otherSide(this.side)]];
    return [ref[this.side]];
  }

  seen(role: string): boolean {
    return this.ids(role).every((i) => visible(this.px, i, VIS_MIN));
  }

  /** The role's point (the midpoint of a two landmark role), whatever its visibility. */
  at(role: string): Pt {
    const [a, b] = this.ids(role);
    return b === undefined ? point(this.px[a]) : midpoint(this.px[a], this.px[b]);
  }

  /** The two points of a line role ([a, b] in the data), in the data's order. */
  line(role: string): [Pt, Pt] {
    const [a, b] = this.ids(role);
    return [point(this.px[a]), point(this.px[b])];
  }

  /** Every gate role of the data is seen ({ anyOf }: one of them), except the roles in `skip`. */
  gate(skip: readonly string[] = []): boolean {
    return this.def.gate.every((g) =>
      typeof g === "string" ? skip.includes(g) || this.seen(g) : g.anyOf.some((r) => this.seen(r)),
    );
  }
}

/** A limb movement's roles on the tested side; null with no side. */
function limb(id: RomMovementId, px: Landmark[], ctx: AngleContext): Roles | null {
  return ctx.side === "none" ? null : new Roles(movementDef(id), px, modelSide(ctx.side, ctx.mirrored));
}

/** The arm raises' clamp (v1 RangeTestRunner): an arm behind the reference reads 0, past the vertical 180, never folded back. */
const clampRaise = (theta: number) => (theta >= 0 ? theta : theta < -90 ? 180 : 0);

/**
 * The gravity reference of the arm raises (the hips hidden at calibration; v1.1 4.1, review B16): the
 * start trunk line, from the shoulders to the model's hip estimates at calibration (accepted at low
 * visibility for orientation only). With the phone still, this is true vertical corrected for the
 * trunk's inclination at calibration. Without a start trunk line, true vertical from the phone roll;
 * null without a roll reading (not measured, as v1.1 4.1).
 */
function gravityDown(ctx: AngleContext): Pt | null {
  const tl = ctx.calibration.trunkLine;
  if (tl) return sub(tl.base, tl.top);
  return ctx.rollDeg === null ? null : downVector(ctx.rollDeg);
}

/*
 * shoulder_flexion. Definition: "theta = ang(E - S, H - S): the unsigned 2D angle between the upper
 * arm (shoulder to elbow) and the trunk line (shoulder to same side hip), in pixel space." Zero: "0 =
 * arm along the trunk; 180 = straight overhead. Clamped 0 to 180." Direction: "Flexion only while
 * the elbow lies on the face side of the trunk line (the side of the nose, landmark 0); otherwise
 * the attempt is extension and is not scored here."
 * Read as the arm's turn from the trunk line toward the nose: an elbow behind the trunk line reads 0,
 * an arm past overhead stays at 180. Gravity mode: against the start trunk line (gravityDown).
 */
const shoulderFlexion: AngleFn = (px, ctx) => {
  const gravity = ctx.calibration.gravityMode;
  const r = limb("shoulder_flexion", px, ctx);
  if (!r || !r.gate(gravity ? ["H"] : [])) return null;
  const S = r.at("S");
  const trunk = gravity ? gravityDown(ctx) : sub(r.at("H"), S);
  if (!trunk || norm(trunk) < 1e-9) return null;
  const face = noseSide(px, S, trunk);
  if (face === null) return null;
  return clampRaise(turnFrom(trunk, sub(r.at("E"), S)) * face);
};

/*
 * shoulder_abduction. Definition: "theta = ang(E - S, MHf - MS): the 2D angle between the upper arm
 * and the downward trunk axis from mid shoulder to the mid hip fixed at its calibration position
 * (v1.1 4.1)." Zero: "0 = arm at the side; 180 = straight overhead; clamped; pastVertical flagged."
 * Direction: "Elbow lateral to the shoulder (away from the midline) once theta exceeds 20 degrees."
 * Exactly the v1 RangeTestRunner measurement (rangeTest.ts measure): the arm's turn from the trunk
 * axis toward the tested side, an arm across the body 0, past the vertical 180 (the runner flags
 * pastVertical and checks the lateral elbow). Gravity mode: against the start trunk line (gravityDown).
 */
const shoulderAbduction: AngleFn = (px, ctx) => {
  const r = limb("shoulder_abduction", px, ctx);
  if (!r || !r.gate(["MHf"])) return null;
  const cal = ctx.calibration;
  const S = r.at("S");
  const MS = r.at("MS");
  const down = cal.gravityMode ? gravityDown(ctx) : cal.fixedHip ? sub(cal.fixedHip, MS) : null;
  if (!down || norm(down) < 1e-6) return null;
  return clampRaise(signedAngle(down, sub(r.at("E"), S), sub(S, MS)));
};

/*
 * shoulder_extension. Definition: "theta = ang(E - S, H - S), as shoulder flexion, scored only while
 * the elbow lies on the back side of the trunk line (opposite the nose)." Zero: "0 = arm along the
 * trunk." Direction: "Elbow behind the trunk line."
 * Read as the arm's turn from the trunk line away from the nose; 0 while the elbow is on the face side.
 */
const shoulderExtension: AngleFn = (px, ctx) => {
  const r = limb("shoulder_extension", px, ctx);
  if (!r || !r.gate()) return null;
  const S = r.at("S");
  const trunk = sub(r.at("H"), S);
  const face = noseSide(px, S, trunk);
  if (face === null) return null;
  const theta = turnFrom(trunk, sub(r.at("E"), S)) * face;
  return theta < 0 ? -theta : 0;
};

/*
 * elbow_extension. Definition: "alpha = ang(S - E, W - E); lack = 180 - alpha at the end range. If the
 * wrist crosses to the opposite side of the shoulder to elbow line from the side it bends toward
 * (learned in the practice movement), the elbow is past straight and lack is negative." Zero: "0 =
 * fully straight; positive = degrees short of straight; negative = past straight." Direction: "Bend
 * direction learned from the start pose (the elbow starts bent)."
 * The side it bends toward is taken as the face side of the shoulder to elbow line: the start pose
 * has the forearm forward with the upper arm by the side (rom-protocol startPose). RomCalibration has
 * no field for a side learned from the frames (contract gap, A3).
 */
const elbowExtension: AngleFn = (px, ctx) => {
  const r = limb("elbow_extension", px, ctx);
  if (!r || !r.gate()) return null;
  const S = r.at("S");
  const E = r.at("E");
  const W = r.at("W");
  const lack = 180 - unsignedAngle(sub(S, E), sub(W, E));
  const arm = sub(E, S);
  const bend = noseSide(px, S, arm);
  if (bend === null) return null;
  const wrist = sign(cross(arm, sub(W, S)));
  return wrist !== 0 && wrist === -bend ? -lack : lack;
};

/*
 * elbow_flexion. Definition: "flexion = 180 - ang(S - E, W - E) (v1.1 A.2)." Zero: "0 = straight."
 * Direction: "Hand toward the shoulder in front of the body."
 */
const elbowFlexion: AngleFn = (px, ctx) => {
  const r = limb("elbow_flexion", px, ctx);
  if (!r || !r.gate()) return null;
  const E = r.at("E");
  return 180 - unsignedAngle(sub(r.at("S"), E), sub(r.at("W"), E));
};

/*
 * hip_flexion. Definition: "flexion = 180 - ang(K - H, S - H): the thigh (hip to knee) against the
 * trunk line (hip to same side shoulder). Same construct as Pose2Sim hip flexion (R45)." Zero: "0 =
 * thigh in line with the trunk." Direction: "Knee toward the face side."
 */
const hipFlexion: AngleFn = (px, ctx) => {
  const r = limb("hip_flexion", px, ctx);
  if (!r || !r.gate()) return null;
  const H = r.at("H");
  return 180 - unsignedAngle(sub(r.at("K"), H), sub(r.at("S"), H));
};

/*
 * hip_extension. Definition: "extension = 180 - ang(K - H, S - H), positive while the knee is behind
 * the trunk line (opposite the nose), negative if the thigh cannot reach the trunk line (a hip that
 * stays bent)." Zero: "0 = thigh in line with the trunk." Direction: "Knee behind the trunk line."
 */
const hipExtension: AngleFn = (px, ctx) => {
  const r = limb("hip_extension", px, ctx);
  if (!r || !r.gate()) return null;
  const H = r.at("H");
  const thigh = sub(r.at("K"), H);
  const trunk = sub(r.at("S"), H);
  const e = 180 - unsignedAngle(thigh, trunk);
  const knee = sign(cross(trunk, thigh));
  if (knee === 0) return e;
  const face = noseSide(px, H, trunk);
  if (face === null) return null;
  return knee === face ? -e : e;
};

/*
 * hip_abduction. Definition: "abduction = ang(K - H, Hother - H) - 90: the thigh against the line
 * joining the two hip landmarks, as a goniometer uses the line between the two front pelvic points."
 * Zero: "0 = thigh perpendicular to the hip line." Direction: "Knee moving away from the midline."
 * A knee toward the midline reads 0 (the movement cannot be negative, canBeNegative false).
 */
const hipAbduction: AngleFn = (px, ctx) => {
  const r = limb("hip_abduction", px, ctx);
  if (!r || !r.gate()) return null;
  const H = r.at("H");
  return Math.max(0, unsignedAngle(sub(r.at("K"), H), sub(r.at("Hother"), H)) - 90);
};

/*
 * knee_flexion. Definition: "flexion = 180 - ang(H - K, A - K)." Zero: "0 = straight." Direction:
 * "Heel toward the buttock."
 */
const kneeFlexion: AngleFn = (px, ctx) => {
  const r = limb("knee_flexion", px, ctx);
  if (!r || !r.gate()) return null;
  const K = r.at("K");
  return 180 - unsignedAngle(sub(r.at("H"), K), sub(r.at("A"), K));
};

/*
 * knee_extension. Definition: "lack = 180 - ang(H - K, A - K) at the end range; negative if the knee
 * goes past straight (knee below the hip to ankle line on the bed side, by the sign of the cross
 * product against the bend direction)." Zero: "0 = straight; positive = degrees short of straight."
 * Direction: "Bend direction learned from the start pose."
 * The bed side is true down (the phone roll): a knee on the down side of the hip to ankle line is past
 * straight. Both positions (lying on the back, seated) start with the knee bent up, away from that
 * side; RomCalibration has no field for a side learned from the frames (contract gap, A3).
 */
const kneeExtension: AngleFn = (px, ctx) => {
  const r = limb("knee_extension", px, ctx);
  if (!r || !r.gate()) return null;
  const H = r.at("H");
  const K = r.at("K");
  const A = r.at("A");
  const lack = 180 - unsignedAngle(sub(H, K), sub(A, K));
  const line = sub(A, H);
  const knee = sign(cross(line, sub(K, H)));
  return knee !== 0 && knee === sign(cross(line, downVector(ctx.rollDeg ?? 0))) ? -lack : lack;
};

/*
 * ankle_dorsiflexion_lunge. Definition: "phi = ang(K − A, U): the shank (ankle to knee) against true
 * vertical U, the tibial axis construct. Also stored, not graded: phiHeel = ang(K − heel, U), the heel
 * to knee line that reproduces Okuno's trigonometric reference (R18), so either construct can be
 * graded after the bench check (review B03)." Zero: "0 = shank vertical." Direction: "Knee forward
 * over the toes (toe direction = heel to foot index)."
 * A knee behind the vertical reads 0 (canBeNegative false). phiHeel is ankleDorsiflexionHeel.
 */
function lungeAngle(from: "A" | "heel"): AngleFn {
  return (px, ctx) => {
    const r = limb("ankle_dorsiflexion_lunge", px, ctx);
    if (!r || !r.gate()) return null;
    const U = trueUp(ctx.rollDeg);
    const toes = sign(cross(U, sub(r.at("toe"), r.at("heel"))));
    if (toes === 0) return null;
    const line = sub(r.at("K"), r.at(from));
    return sign(cross(U, line)) === toes ? unsignedAngle(line, U) : 0;
  };
}
/** phiHeel of the lunge: the heel to knee line against true vertical (stored, not graded). */
export const ankleDorsiflexionHeel: AngleFn = lungeAngle("heel");

/*
 * trunk_lateral_flexion. Definition: "lambda = ang(MS - MH, U): the trunk axis (mid hip to mid
 * shoulder) against true vertical U (phone roll corrected), toward the named side." Zero: "0 =
 * upright." Direction: "Mid shoulder moving toward the named side."
 * The named side is the context's side (the bend direction): a bend the other way reads 0, and with
 * no side ("none") the bend reads either way. The person's sides in the picture come from the hips'
 * labels (the model's, swapped in a mirrored picture).
 */
const trunkLateralFlexion: AngleFn = (px, ctx) => {
  const r = new Roles(movementDef("trunk_lateral_flexion"), px, null);
  if (!r.gate()) return null;
  const U = trueUp(ctx.rollDeg);
  const trunk = sub(r.at("MS"), r.at("MH"));
  const lambda = unsignedAngle(trunk, U);
  if (ctx.side === "none") return lambda;
  const named = modelSide(ctx.side, ctx.mirrored);
  const toward = sub(px[SIDE_IDS.hip[named]], px[SIDE_IDS.hip[otherSide(named)]]);
  const bend = sign(cross(U, trunk));
  return bend !== 0 && bend === sign(cross(U, toward)) ? lambda : 0;
};

/*
 * trunk_flexion. Definition: "tau = ang(S - H, U): the trunk line (same side hip to shoulder, camera
 * side) against true vertical, toward the face side." Zero: "0 = upright." Direction: "Shoulder
 * moving to the face side."
 * Read as the trunk line's turn from true vertical toward the face (the side of the trunk line the
 * nose is on); a lean back reads 0 (canBeNegative false).
 */
const trunkFlexion: AngleFn = (px, ctx) => {
  const r = new Roles(movementDef("trunk_flexion"), px, cameraSide(px));
  if (!r.gate()) return null;
  const H = r.at("H");
  const trunk = sub(r.at("S"), H);
  const face = noseSide(px, H, trunk);
  if (face === null) return null;
  return Math.max(0, turnFrom(trueUp(ctx.rollDeg), trunk) * face);
};

/*
 * neck_lateral_flexion. Definition: "lateral flexion = |delta(ang_signed(SL, EL))| from neutral: the
 * change in the signed angle between the shoulder line SL (11 to 12) and the ear line EL (7 to 8).
 * Eye line (2 to 5) when ear visibility is below 0.5, flagged eyeLine (hair or a head scarf may cover
 * the ears)." Zero: "0 = neutral head position recorded at the start." Direction: "Named side ear
 * toward the same side shoulder."
 * The change is counted toward the named side (the context's side; a tilt the other way reads 0, and
 * with no side either way). In the model's labels a positive change tilts toward the model's left.
 * The neutral is the calibration's neutralHeadDeg, recorded with the line each start frame read: a
 * neutral of the ear line read against a frame of the eye line is off by the angle between the two
 * lines at neutral (no field records the line: contract gap, A3).
 */
const neckLateralFlexion: AngleFn = (px, ctx) => {
  const r = new Roles(movementDef("neck_lateral_flexion"), px, null);
  if (!r.gate()) return null;
  const neutral = ctx.calibration.neutralHeadDeg;
  if (neutral === null) return null;
  const delta = wrapTurn(headTilt(r) - neutral);
  if (ctx.side === "none") return Math.abs(delta);
  return Math.max(0, modelSide(ctx.side, ctx.mirrored) === "left" ? delta : -delta);
};

/** The neck side bend's line on a frame: the ear line, or the eye line with an ear under EAR_LINE_MIN_VISIBILITY (flag eyeLine). */
export function neckSideBendLine(px: Landmark[]): "ears" | "eyes" {
  const ears = movementDef("neck_lateral_flexion").landmarks.ears;
  const [a, b] = Array.isArray(ears) ? ears : [7, 8];
  return visible(px, a, EAR_LINE_MIN_VISIBILITY) && visible(px, b, EAR_LINE_MIN_VISIBILITY) ? "ears" : "eyes";
}

/** ang_signed(SL, EL): the turn from the shoulder line (11 to 12) to the ear line (7 to 8) or eye line (2 to 5). */
function headTilt(r: Roles): number {
  const [s1, s2] = r.line("shoulders");
  const [e1, e2] = r.line(neckSideBendLine(r.px));
  return turnFrom(sub(s2, s1), sub(e2, e1));
}

/*
 * neck_flexion. Definition: "flexion = delta head - delta trunk: the change from neutral in the angle
 * of the head line (camera side ear to camera side outer eye corner, 7 to 3 or 8 to 6) minus the
 * change in the trunk line (hip to shoulder) over the same time." Zero: "0 = neutral head position
 * recorded at the start." Direction: "Chin down toward the chest."
 * neck_extension. Definition: "extension = delta head - delta trunk, as chin to chest, in the opposite
 * direction." Zero: "0 = neutral." Direction: "Chin up."
 * The neutral head line is the calibration's neutralHeadDeg and the neutral trunk line its trunkLine.
 * Chin down turns the head the way the trunk turns when it bends toward the face (the neutral trunk
 * line's turn toward the neutral head line); each movement reads 0 the other way.
 */
function neckPitch(id: "neck_flexion" | "neck_extension", px: Landmark[], ctx: AngleContext): number | null {
  const r = new Roles(movementDef(id), px, cameraSide(px));
  if (!r.gate()) return null;
  const { neutralHeadDeg, trunkLine } = ctx.calibration;
  if (neutralHeadDeg === null || !trunkLine) return null;
  const trunk0 = sub(trunkLine.top, trunkLine.base);
  const head0 = { x: Math.cos(neutralHeadDeg / DEG), y: Math.sin(neutralHeadDeg / DEG) };
  const forward = sign(cross(trunk0, head0));
  if (forward === 0) return null;
  const dHead = wrapTurn(angleOf(sub(r.at("eyeOuter"), r.at("ear"))) - neutralHeadDeg);
  const dTrunk = wrapTurn(angleOf(sub(r.at("S"), r.at("H"))) - angleOf(trunk0));
  return wrapTurn(forward * (dHead - dTrunk));
}
const neckFlexion: AngleFn = (px, ctx) => {
  const f = neckPitch("neck_flexion", px, ctx);
  return f === null ? null : Math.max(0, f);
};
const neckExtension: AngleFn = (px, ctx) => {
  const f = neckPitch("neck_extension", px, ctx);
  return f === null ? null : Math.max(0, -f);
};

/** The angle of each measured movement on one pixel space frame, in its convention (2.3). */
export const MOVEMENT_ANGLES: Record<RomMovementId, AngleFn> = {
  shoulder_flexion: shoulderFlexion,
  shoulder_abduction: shoulderAbduction,
  shoulder_extension: shoulderExtension,
  elbow_extension: elbowExtension,
  elbow_flexion: elbowFlexion,
  hip_flexion: hipFlexion,
  hip_extension: hipExtension,
  hip_abduction: hipAbduction,
  knee_flexion: kneeFlexion,
  knee_extension: kneeExtension,
  ankle_dorsiflexion_lunge: lungeAngle("A"),
  trunk_lateral_flexion: trunkLateralFlexion,
  trunk_flexion: trunkFlexion,
  neck_lateral_flexion: neckLateralFlexion,
  neck_flexion: neckFlexion,
  neck_extension: neckExtension,
};

/* ------------------------------------------------------------------ calibration */

/** The movements with a gravity reference when the hips are hidden at calibration (v1.1 4.1, review B16). */
const GRAVITY_FALLBACK: ReadonlySet<RomMovementId> = new Set(["shoulder_flexion", "shoulder_abduction"]);

/** The median of angles in degrees, unwrapped around the first so that 179 and -179 meet at 180. */
function angleMedian(degs: number[]): number | null {
  if (!degs.length) return null;
  const ref = degs[0];
  return wrapTurn(median(degs.map((a) => ref + wrapTurn(a - ref)))!);
}

function pointMedian(points: Pt[]): Pt | null {
  if (!points.length) return null;
  return { x: median(points.map((p) => p.x))!, y: median(points.map((p) => p.y))! };
}

/**
 * The calibration a movement needs from the start pose frames (the medians over the still second the
 * runner passes), in pixel space:
 * - trunkLine: shoulder (top) to hip (base) medians, the mid shoulder and mid hip in a front view, the
 *   measured side's (axial side views: the camera side's) shoulder and hip in a side view, over the
 *   frames that see both. Gravity mode: the shoulder medians and the model's hip estimates at any
 *   visibility (gravityDown).
 * - gravityMode: shoulder flexion and abduction with the hip (abduction: both hips) seen in under
 *   HIPS_SEEN_SHARE of the frames. Without a hip estimate and without a roll reading: null.
 * - fixedHip: the median hip (mid hip in a front view, the side's hip in a side view) over the frames
 *   that see it; null in gravity mode.
 * - segmentPx: the side's upper arm, forearm, thigh and shank, the trunk and the shoulder width, each
 *   the median over the frames that see both ends; a length never seen is left out.
 * - neutralHeadDeg: the neck movements' neutral head angle (side bend: ang_signed of the shoulder and
 *   head lines; chin to chest and looking up: the head line's direction); null for the others.
 * - startDeg: the median angle of the start frames with this calibration.
 * Null when there is no frame, no neutral head for a neck movement, or no start angle. `t` is 0: the
 * frames carry no time, so the runner stamps it.
 */
export function calibrate(
  id: RomMovementId,
  frames: { px: Landmark[] }[],
  ctx: Omit<AngleContext, "calibration">,
): RomCalibration | null {
  if (!frames.length) return null;
  const def = movementDef(id);
  const front = def.view === "front";
  /** The side whose landmarks a frame reads: the tested side, the camera side of an axial side view, none in a front view of the trunk or neck. */
  const sideOf = (px: Landmark[]): Side | null => {
    if (def.axial) return front ? null : cameraSide(px);
    return ctx.side === "none" ? null : modelSide(ctx.side, ctx.mirrored);
  };
  const seenAll = (px: Landmark[], ids: number[]) => ids.every((i) => visible(px, i, VIS_MIN));

  const per = frames.map(({ px }) => {
    const side = sideOf(px);
    const topIds = front ? [11, 12] : side ? [SIDE_IDS.shoulder[side]] : [];
    const baseIds = front ? [23, 24] : side ? [SIDE_IDS.hip[side]] : [];
    /** The point of one landmark or the midpoint of two, at any visibility; null when one is not a number. */
    const at = (ids: number[]): Pt | null => {
      if (!ids.length || !ids.every((i) => finitePoint(px[i]))) return null;
      return ids.length === 1 ? point(px[ids[0]]) : midpoint(px[ids[0]], px[ids[1]]);
    };
    return {
      px,
      side,
      top: at(topIds),
      topSeen: topIds.length > 0 && seenAll(px, topIds),
      base: at(baseIds),
      baseSeen: baseIds.length > 0 && seenAll(px, baseIds),
    };
  });

  const hipsSeen = per.filter((f) => f.baseSeen);
  const gravityMode = GRAVITY_FALLBACK.has(id) && hipsSeen.length / per.length < HIPS_SEEN_SHARE;

  let trunkLine: RomCalibration["trunkLine"] = null;
  if (gravityMode) {
    const top = pointMedian(per.filter((f) => f.topSeen).map((f) => f.top!));
    const base = pointMedian(per.filter((f) => f.base !== null).map((f) => f.base!));
    trunkLine = top && base ? { top, base } : null;
    if (!trunkLine && ctx.rollDeg === null) return null;
  } else {
    const both = per.filter((f) => f.topSeen && f.baseSeen);
    const top = pointMedian(both.map((f) => f.top!));
    const base = pointMedian(both.map((f) => f.base!));
    trunkLine = top && base ? { top, base } : null;
  }
  const fixedHip = gravityMode ? null : pointMedian(hipsSeen.map((f) => f.base!));

  const segmentPx: RomCalibration["segmentPx"] = {};
  const length = (pairs: (readonly [Landmark[], number, number] | null)[]): number | undefined => {
    const ds = pairs
      .filter((p): p is readonly [Landmark[], number, number] => p !== null && seenAll(p[0], [p[1], p[2]]))
      .map(([px, a, b]) => Math.hypot(px[a].x - px[b].x, px[a].y - px[b].y));
    return median(ds) ?? undefined;
  };
  const sided = (a: keyof typeof SIDE_IDS, b: keyof typeof SIDE_IDS) =>
    length(per.map((f) => (f.side ? ([f.px, SIDE_IDS[a][f.side], SIDE_IDS[b][f.side]] as const) : null)));
  const lengths = {
    upperArm: sided("shoulder", "elbow"),
    forearm: sided("elbow", "wrist"),
    thigh: sided("hip", "knee"),
    shank: sided("knee", "ankle"),
    trunk:
      median(per.filter((f) => f.topSeen && f.baseSeen).map((f) => norm(sub(f.top!, f.base!)))) ?? undefined,
    shoulderWidth: length(per.map((f) => [f.px, 11, 12] as const)),
  };
  for (const [k, v] of Object.entries(lengths) as [keyof typeof lengths, number | undefined][])
    if (v !== undefined) segmentPx[k] = v;

  let neutralHeadDeg: number | null = null;
  if (id === "neck_lateral_flexion") {
    const tilts = per
      .map((f) => new Roles(def, f.px, null))
      .filter((r) => r.gate())
      .map(headTilt);
    neutralHeadDeg = angleMedian(tilts);
    if (neutralHeadDeg === null) return null;
  } else if (id === "neck_flexion" || id === "neck_extension") {
    const heads = per
      .map((f) => new Roles(def, f.px, f.side))
      .filter((r) => r.seen("ear") && r.seen("eyeOuter"))
      .map((r) => angleOf(sub(r.at("eyeOuter"), r.at("ear"))));
    neutralHeadDeg = angleMedian(heads);
    if (neutralHeadDeg === null) return null;
  }

  const calibration: RomCalibration = {
    t: 0,
    startDeg: 0,
    trunkLine,
    fixedHip,
    segmentPx,
    neutralHeadDeg,
    gravityMode,
  };
  const fn = MOVEMENT_ANGLES[id];
  const starts = frames
    .map(({ px }) => fn(px, { ...ctx, calibration }))
    .filter((a): a is number => a !== null);
  const startDeg = median(starts);
  return startDeg === null ? null : { ...calibration, startDeg };
}
