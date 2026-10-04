/**
 * Movement angles for the v7 range of motion runner (product v7 contract 2.3). Ported from Pose2Sim
 * common.py (BSD-3): points_to_angles and fixed_angles semantics, in pixel space (toPixelSpace,
 * D-003), z never used. Pure, no DOM.
 *
 * Step A1 commits the types; pointsToAngle, fixedAngle, unsignedAngle, MOVEMENT_ANGLES and calibrate
 * land with step A3, each AngleFn quoting its rom-protocol.json movements[].angle definition.
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
