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
import type { Landmark } from "../types";
import type { RomSide } from "../../movements/rom/types";

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
