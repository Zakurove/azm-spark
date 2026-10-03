/**
 * The v7 body map (product v7 contract 2.2): the regions of the body the person marks as affected,
 * the problem types per region and the follow up answers that shape the range protocol
 * (rom-protocol 2.1 to 2.4). Pure, no DOM: shared by the client and the server.
 *
 * Step A1 commits the types and id lists; the functions of 2.2 (autoFillQuestions, autoFillRegions,
 * mergeRegions, validateRegions) land with step A2.
 */
import type { RomMovementId } from "../movements/rom/types";

/** The canonical region ids (C-11): the ids of rom-protocol.json regions, in body order. */
export const REGION_IDS = [
  "neck",
  "back_trunk",
  "shoulder",
  "elbow",
  "forearm_wrist",
  "hip",
  "knee",
  "ankle_foot",
] as const;
export type RegionId = (typeof REGION_IDS)[number];
/** Regions without a left and right: one axial cell. */
export const AXIAL_REGIONS: readonly RegionId[] = ["neck", "back_trunk"];
/** The problem types of problem_ask (rom-protocol.json problemTypes). */
export const PROBLEM_TYPES = [
  "weakness",
  "injury",
  "pain",
  "stiffness",
  "after_surgery",
  "limb_loss",
] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];
/** Limb regions: left, right or both. Neck and back or trunk: axial. */
export type RegionSide = "left" | "right" | "both" | "axial";
/** injury_when and surgery_when answers. */
export type SinceBucket = "lt6w" | "6w_3m" | "3m_6m" | "gt6m";
export type LimbLossLevel = "below_knee" | "above_knee" | "below_elbow" | "above_elbow";
/** hip_avoid_* answers; ["none"] means told of no limits. */
export type HipAvoidId = "flex90" | "cross" | "turn_in" | "back_out" | "none";
export type YesNoUnsure = "yes" | "no" | "unsure";

export interface RegionEntry {
  region: RegionId;
  side: RegionSide;
  /** 1 to 6 unique problem types (problem_ask). */
  problems: ProblemType[];
  /** Where the entry came from. The person confirmed it in every case (plan 1.1). */
  origin: "person" | "condition" | "report";
  /** Present only when problems includes "injury". achilles only on ankle_foot (achilles_ask). */
  injury?: { since: SinceBucket; achilles?: boolean };
  /** Present only when problems includes "after_surgery". */
  surgery?: {
    since: SinceBucket;
    /** surgery_cleared */
    cleared: YesNoUnsure;
    /** surgery_avoid, [] when none */
    avoid: RomMovementId[];
    /** hip only */
    hipReplacement?: boolean;
    /** hip_avoid_ask, hip replacement under 3 months only */
    hipAvoid?: HipAvoidId[];
    /** surgery_stretch_ask (under 12 weeks) */
    stretchAllowed?: YesNoUnsure;
    /** surgery_load_ask (under 12 weeks) */
    loadAllowed?: YesNoUnsure;
  };
  /** Present only when problems includes "limb_loss"; side must be left or right. */
  limbLoss?: { level: LimbLossLevel };
}

export interface RomIntakeFlags {
  /** bones_ask */
  osteoporosis: boolean;
  /** neck_ask */
  neckCaution: boolean;
  /** arthritis_type_ask (arthritis only) */
  inflammatoryArthritis?: YesNoUnsure;
  /** neck_cleared_ask */
  neckCleared?: boolean;
  /** foot_lift_ask */
  footLift?: Partial<Record<"left" | "right", boolean>>;
  /** transfer_chair_ask (wheelchair users) */
  transferChair?: boolean;
  /**
   * sit_unsupported_ask (review C11; contract gap 1 of the 2026-10-04 change log, the proposal applied
   * until the tech lead decides). Asked only with mobility wheelchair or seated, or with SCI, MS,
   * stroke, CP or Parkinson's; absent means yes, except mobility bed and SCI at neck level, which
   * mean no. It gates the seated_forward position and the seated forward bend (reason
   * sitting_balance).
   */
  sitUnsupported?: YesNoUnsure;
}

/** The answers of the condition questions (rom-protocol 2.3). */
export type AutoFillAnswer =
  | { condition: "stroke"; weakerSide: "left" | "right" }
  | { condition: "cerebral_palsy"; pattern: "one_side"; side: "left" | "right" }
  | { condition: "cerebral_palsy"; pattern: "both_legs" | "all_limbs" }
  | { condition: "ms"; limbs: ("right_arm" | "left_arm" | "right_leg" | "left_leg")[] }
  | { condition: "parkinsons"; confirmed: boolean }
  | { condition: "sci_complete" | "sci_incomplete"; level: "neck" | "back" }
  | { condition: "lower_limb_unilateral"; side: "left" | "right"; level: "below_knee" | "above_knee" }
  | { condition: "upper_limb_unilateral"; side: "left" | "right"; level: "below_elbow" | "above_elbow" };

/** A body map cell: a region and a side (axial regions have one cell). */
export type BodyMapKey = `${RegionId}:${"left" | "right" | "axial"}`;
