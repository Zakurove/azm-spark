/**
 * Types for the v7 runtime range of motion data, src/movements/rom/rom-v7.json (product v7 contract
 * 2.1 and 2.3).
 *
 * The JSON is written by scripts/clinical/export-v7.mjs from the clinical source
 * (local-docs/clinical/v7/rom-protocol.json, a draft until the clinical sign off). RomData mirrors the
 * exported JSON field by field; src/movements/rom/index.ts checks the JSON against it at compile time
 * (`raw satisfies Widen<RomData>`) and tests/v7/a-runtime-data.test.ts checks every literal id list
 * against the data in both directions. Pure types and id lists, no DOM.
 *
 * Fields typed as plain string that hold English prose (conventions.sides, regionTable sides, safety
 * rule and action, reasonIds) are engineering documentation, never shown to a person: the code that
 * implements them is written by hand from the clinical source.
 */
import type { NormDef } from "../../medical/rom-norms";
import type { LimbLossLevel, ProblemType, RegionId } from "../../medical/body-map";
import type { CheckCueId, Text } from "../types";

/* ---------------------------------------------------------- movement ids */

/** The 16 movements the camera measures (rom-protocol movements, in data order). */
export const ROM_MOVEMENT_IDS = [
  "shoulder_flexion",
  "shoulder_abduction",
  "shoulder_extension",
  "elbow_extension",
  "elbow_flexion",
  "hip_flexion",
  "hip_extension",
  "hip_abduction",
  "knee_flexion",
  "knee_extension",
  "ankle_dorsiflexion_lunge",
  "trunk_lateral_flexion",
  "trunk_flexion",
  "neck_lateral_flexion",
  "neck_flexion",
  "neck_extension",
] as const;
export type RomMovementId = (typeof ROM_MOVEMENT_IDS)[number];
/** The 13 movements the camera does not measure: typical default or not measured (rom-protocol defaultMovements). */
export const DEFAULT_ONLY_IDS = [
  "shoulder_internal_rotation",
  "shoulder_external_rotation",
  "forearm_pronation",
  "forearm_supination",
  "wrist_flexion",
  "wrist_extension",
  "hip_internal_rotation",
  "hip_external_rotation",
  "ankle_plantarflexion",
  "ankle_dorsiflexion_nwb",
  "trunk_extension",
  "trunk_rotation",
  "neck_rotation",
] as const;
export type DefaultOnlyId = (typeof DEFAULT_ONLY_IDS)[number];
export type JointMovementId = RomMovementId | DefaultOnlyId;

export const ROM_POSITION_IDS = [
  "seated",
  "seated_forward",
  "standing",
  "standing_supported",
  "lying_back",
  "seated_armrests",
] as const;
export type RomPositionId = (typeof ROM_POSITION_IDS)[number];
/** flexion: degrees from zero, higher is more. lack: degrees short of straight (0 straight, negative past straight), lower is better. signed: can go below 0 (hip extension). */
export type RomKind = "flexion" | "lack" | "signed";
/** Axial lateral flexion: the side is the direction of the bend. */
export type RomSide = "left" | "right" | "none";
export type Evidence = "High" | "Moderate" | "Low" | "Very low";

/* ------------------------------------------------------- movement shape */

/** Exactly the ids of rom-protocol.json movements[].compensations (25); a parity test asserts the per movement lists. */
export const COMPENSATION_IDS = [
  "assisted",
  "bent_elbow",
  "foot_turn",
  "forearm_plane",
  "hands_support",
  "head_turn",
  "heel_lift",
  "hip_hike",
  "knee_bend",
  "knee_plane",
  "other_leg",
  "pelvis_shift",
  "plane",
  "seated_lean_back",
  "shoulder_hike",
  "shrug",
  "stance_knee",
  "trunk",
  "trunk_back",
  "trunk_forward",
  "trunk_lean",
  "trunk_lift",
  "trunk_rotation",
  "trunk_tilt",
  "upper_arm_moves",
] as const;
export type CompensationId = (typeof COMPENSATION_IDS)[number];

/**
 * The exporter turns the data's prose midpoints into structured refs and fails on any prose it does not know:
 * "mid(11, 12)" -> { mid: [11, 12] }; "mid(23, 24) fixed at calibration" -> { mid: [23, 24], fixed: true };
 * "the other hip (23 or 24)" -> { other: "hip" }; "other knee" -> { other: "knee" }.
 */
export type LandmarkRef =
  | number
  | { left: number; right: number }
  | [number, number]
  | { mid: [number, number]; fixed?: true }
  | { other: "hip" | "knee" };

/** The units of a compensation's numbers, as the clinical prose writes them. */
export type CompensationUnit =
  "deg" | "ratio" | "percent" | "shank_lengths" | "thigh_lengths" | "shoulder_widths" | "ear_distance_share";

/**
 * One compensation check of a movement, its numbers copied from the clinical prose (freeze step, D-024
 * items 2 and 4); B's COMPENSATIONS constants parity test against it. The prose (check, cue, invalid)
 * stays in local-docs.
 */
export interface RomCompensationDef {
  id: CompensationId;
  /** The line the cue plays: a v7 cue, or a v1 arm raise line (test_abd_still, test_abd_side); null: none. */
  cue: RomCueId | CheckCueId | null;
  /** The value from which the cue plays («> 5 degrees: keep_back»); null: the cue plays when the check fires. */
  cueAt: number | null;
  /** The value from which the attempt is invalid («> 10 degrees», «< 0.85»); null: on any detection, or never. */
  invalidAt: number | null;
  /** A flag only check's value («Flag only below 150 degrees»). */
  flagAt?: number;
  /** invalid: the attempt is not scored; flag: stored, still scored; log: logging and coaching only. */
  effect: "invalid" | "flag" | "log";
  unit: CompensationUnit | null;
  /** The check fires above or below its values; null when it has none. */
  when: "above" | "below" | null;
  /** The angle window the check reads (the plane checks: 70 to 110 degrees). */
  windowDeg?: [number, number];
  /** How long the value must hold («for 0.3 s or more»). */
  forSeconds?: number;
  /** A second criterion («or pitch change > 5 degrees», «or 0.25 shoulder widths»). */
  orInvalid?: { at: number; unit: CompensationUnit };
  orFlag?: { at: number; unit: CompensationUnit };
}

export interface RomMovementDef {
  id: RomMovementId;
  version: number;
  region: RegionId;
  /** { ar, en } */
  name: Text;
  plane: "sagittal" | "frontal";
  verdict: "measure" | "caution";
  /** A range in the data ("Low to moderate") is exported as its lower grade (change log, A1). */
  cameraEvidence: Evidence;
  kind: RomKind;
  canBeNegative: boolean;
  priority: "core" | "extended";
  view: "front" | "side";
  axial: boolean;
  /** The camera distance in metres: a range, or about one value («about 2 m»). */
  distanceM: number | [number, number];
  /** «phone ... level within 5 degrees», where the camera prose says so. */
  levelWithinDeg?: number;
  /** shoulder_abduction: «frame margin 1.3 arm lengths each side». */
  frameMarginArmLengths?: number;
  /** The start pose's calibration hold («for 1 s»). */
  calibrationSeconds?: number;
  /**
   * uncertainLackFrom: knee straightening lying, «a lack between 5 and the within normal limit shows
   * label_uncertain» (with knee injury, surgery, OA, CP or limb loss); referMeasureLackAbove: seated, «A
   * seated lack above 52 ... shows refer_measure» (review A09, B13).
   */
  positions: {
    id: RomPositionId;
    graded: boolean;
    normId: string | null;
    uncertainLackFrom?: number;
    referMeasureLackAbove?: number;
  }[];
  /** Landmarks by role (S, E, W, H, K, A, heel, toe, nose, ear, eyeOuter, ears, eyes, shoulders, MS, MH, MHf, Hother, Kother, hips). */
  landmarks: Record<string, LandmarkRef>;
  /** Roles that must pass the visibility gate; { anyOf } where the data says "ears or eyes". */
  gate: (string | { anyOf: string[] })[];
  /** Role ids (exporter rule 7), each a key of `landmarks`. */
  optional: string[];
  compensationIds: CompensationId[];
  /** The compensation checks, in the order of compensationIds. */
  compensations: RomCompensationDef[];
  /** shoulder_abduction: «Elbow lateral to the shoulder ... once theta exceeds 20 degrees». */
  directionFromDeg?: number;
  /** neck_lateral_flexion: the eye line when an ear's visibility is below this (A3-4). */
  earLineMinVisibility?: number;
  /** camera allowance, degrees */
  E: number;
  sigmaM: number;
  /** defaulted false by the exporter (rule 6) */
  approximateInPersonView: boolean;
  /** with {side}, {sideM}, {sideF} placeholders */
  instructions: { ar: string[]; en: string[] };
  /** Position specific instructions (hip_flexion seated, knee_flexion standing_supported, knee_extension seated). */
  variantInstructions?: Partial<Record<RomPositionId, Text>>;
  /** A movement specific floor (hip_extension: mildBelow, markedAtOrBelow; knee_extension: lackMildFrom, lackMarkedFrom, position). */
  absoluteFloor?: {
    mildBelow?: number;
    markedAtOrBelow?: number;
    lackMildFrom?: number;
    lackMarkedFrom?: number;
    position?: RomPositionId;
  };
  /** Axial lateral movements measured in both directions (trunk and neck lateral flexion). */
  bothDirections?: boolean;
  /** Measured with gravity assisting (elbow_extension). */
  gravityAssisted?: boolean;
  /** A result name that differs from the movement name (hip_extension). */
  resultName?: Text;
}

/* ------------------------------------------------------------- id lists */

/** v7 reason ids (rom-protocol reasonIds), each with its English engineering text in the data. */
export const ROM_REASON_IDS = [
  "default_camera",
  "no_active_movement",
  "acute_injury",
  "pain_today",
  "pain_stop",
  "surgery_not_cleared",
  "surgery_precaution",
  "spine_surgery",
  "red_flag",
  "osteoporosis",
  "neck_caution",
  "standing_not_allowed",
  "no_overhead",
  "weak_shoulder",
  "limb_absent",
  "segment_unreliable",
  "quality",
  "no_hold",
  "no_norm_position",
  "not_measured_camera",
  "achilles",
  "hip_replacement_recent",
  "seated_lean_gate",
  "helper_needed",
  "clearance_needed",
  "deferred",
  "not_reached",
  "sitting_balance",
] as const;
export type RomV7ReasonId = (typeof ROM_REASON_IDS)[number];

/** The safety ids of rom-protocol section 6 (rom-protocol safety). */
export const ROM_SAFETY_IDS = [
  "global_gate",
  "after_surgery_recent",
  "after_surgery_precaution",
  "hip_replacement_recent",
  "spine_surgery",
  "acute_injury",
  "red_flags",
  "pain_today",
  "pain_during",
  "achilles",
  "osteoporosis",
  "neck_caution",
  "standing_tests",
  "no_overhead",
  "weak_shoulder",
  "sci_t6",
  "limb_loss",
  "never",
  "seated_side_lean_gate",
  "sitting_balance",
  "sit_before_stand",
  "coach_end_range",
  "limb_loss_standing",
] as const;
export type RomSafetyId = (typeof ROM_SAFETY_IDS)[number];

/** Copy keys (rom-protocol copy): every line Arabic first with complete English. */
export const ROM_COPY_KEYS = [
  "intro",
  "intro_no_diagnosis",
  "safety_always",
  "stop_line",
  "neck_stop_line",
  "support_line",
  "helper_line",
  "turn_side",
  "practice",
  "again",
  "ask_max",
  "ans_yes",
  "ans_not_yet",
  "ans_hurts",
  "keep_going",
  "recorded",
  "pain_ask",
  "pain_stop",
  "what_stopped_ask",
  "what_stopped_tight",
  "what_stopped_pain",
  "what_stopped_weak",
  "can_move_ask",
  "no_active_movement",
  "default_line",
  "not_today_safety",
  "not_applicable",
  "region_ask",
  "side_ask",
  "side_right",
  "side_left",
  "side_both",
  "problem_ask",
  "surgery_when",
  "surgery_recent",
  "surgery_older",
  "surgery_cleared",
  "surgery_avoid",
  "injury_when",
  "injury_recent",
  "injury_older",
  "bones_ask",
  "neck_ask",
  "ans_no",
  "ans_unsure",
  "confirm_regions",
  "change_it",
  "typical_default_line",
  "sit_before_stand",
  "surgery_stretch_ask",
  "surgery_load_ask",
  "hip_avoid_ask",
  "hip_avoid_flex90",
  "hip_avoid_cross",
  "hip_avoid_turn_in",
  "hip_avoid_back_out",
  "hip_avoid_none",
  "achilles_ask",
  "neck_cleared_ask",
  "arthritis_type_ask",
  "foot_lift_ask",
  "transfer_chair_ask",
  "deferred_line",
  "not_reached_line",
  "sit_unsupported_ask",
] as const;

/** The 24 correction cues (rom-protocol cues). */
export const ROM_CUE_IDS = [
  "keep_back",
  "no_lean",
  "on_own",
  "no_hands",
  "arm_straight",
  "arm_in_front",
  "arm_back_straight",
  "elbow_by_side",
  "palm_forward",
  "head_down",
  "other_leg_flat",
  "knee_straight_up",
  "toes_up",
  "knee_straight",
  "knees_straight",
  "leg_straight_back",
  "leg_to_side",
  "hips_level",
  "heel_down",
  "toes_to_wall",
  "knee_over_toes",
  "face_forward",
  "shoulder_down",
  "thumb_up",
] as const;

/** Result lines (rom-protocol results). */
export const ROM_RESULT_KEYS = [
  "value_flexion",
  "value_lack",
  "value_lack_straight",
  "value_no_grade",
  "label_within",
  "label_mild",
  "label_marked",
  "label_pain",
  "label_default",
  "label_not_today",
  "label_not_applicable",
  "label_provisional",
  "label_approximate",
  "finding_tight",
  "finding_weak",
  "finding_pain",
  "finding_within",
  "finding_new",
  "label_typical_default",
  "label_uncertain",
  "value_knee_seated",
  "value_hip_ext_behind",
  "value_hip_ext_front",
  "refer_measure",
] as const;

/* ------------------------------------------------------- the data shape */

/** engine (value fields only; the exporter structures the prose values). */
export interface RomEngine {
  visibilityMin: number;
  fpsMin: number;
  phoneLevelToleranceDeg: number;
  holdBandDeg: number;
  holdSeconds: number;
  wideHoldBandDeg: number;
  minExcursionDeg: number;
  attemptTimeoutSeconds: number;
  answerTimeoutSeconds: number;
  practice: number;
  scoredAttemptsMax: number;
  /** "5 to 10" */
  restBetweenAttemptsSeconds: { min: number; max: number };
  minValidForGrade: number;
  /** "E + 5": valid attempts spread more than E + plusE are inconsistent. */
  inconsistentSpread: { plusE: number };
  /** Live dial: One Euro; recorded value: Hampel (window, n sigma), then the median of the hold window. */
  smoothing: { live: "one_euro"; hampel: { window: number; nSigma: number }; holdValue: "median" };
  sitBeforeStandSeconds: number;
  /** σm never below the class floor: measure and caution verdicts. */
  sigmaMFloor: { measure: number; caution: number };
}

export interface RomRegion {
  id: RegionId;
  ar: string;
  en: string;
  axial: boolean;
  label: Text;
}

export interface RomRegionTableRow {
  region: RegionId;
  measure: RomMovementId[];
  caution: RomMovementId[];
  default: DefaultOnlyId[];
  core: RomMovementId[];
  extended: RomMovementId[];
  /** Prose: "both directions (axial)" or "affected side only". */
  sides: string;
}

export interface RomDefaultMovementDef {
  id: DefaultOnlyId;
  region: RegionId;
  ar: string;
  en: string;
  normId: string;
  inAffectedRegion: { source: "not_measured_camera" };
}

/** thresholds.functionalFloor, per movement. */
export interface RomFunctionalFloor {
  withinMin?: number | null;
  markedBelow?: number | null;
  lackMildFrom?: number;
  lackMarkedFrom?: number;
  position?: RomPositionId;
}

/**
 * A retest band (rom-protocol retest, review B15): the change in degrees that counts as real. `deg` holds
 * for everyone; `neurologicalDeg` on a limb affected by a neurological condition; the elbow's
 * neurological band is written twice in the rule, lab and home (contract change log, freeze step).
 * `position` names the position the band is for (lying knee straightening); `wideDeg` is the side arm
 * raise's wide band of v1.1.
 */
export interface RomRetestBand {
  deg?: number;
  neurologicalDeg?: number;
  neurologicalLabDeg?: number;
  neurologicalHomeDeg?: number;
  position?: RomPositionId;
  wideDeg?: number;
}

/** retest: the bands compareRom reads (B4). A change counts only beyond the band, never below floorDeg. */
export interface RomRetest {
  /** «never below 10» */
  floorDeg: number;
  /** «all other movements 10 until the bench test retest gives Azm's own value» */
  defaultDeg: number;
  /** By movement, or by region where the rule names a region (elbow: both elbow movements). */
  bands: Partial<Record<RomMovementId | RegionId, RomRetestBand>>;
}

/** sessionOrder: «At most 8 measured movements per session (about 1.5 minutes each, calc)». */
export interface RomSessionOrder {
  /** MAX_MEASURED_PER_CHECK reads it (C-13). */
  maxMeasured: number;
  /** The coach segment minutes (C-6: items x 1.5 + 1). */
  minutesPerMovement: number;
}

/** thresholds: the numbers of the grading rules (copied next to their words in the source) and the functional floors. */
export interface RomThresholds {
  /** SDeff: «SD, capped at 12.5% of N for movements with N of 90 degrees or more». */
  sdCap: { pctOfN: number; fromMeanDeg: number };
  /** withinNormal: «z ≥ −1.96» (every row's limits.zWithin). */
  zWithinMin: number;
  /** markedlyLimited: «z < −3» (every row's limits.zMarked). */
  zMarkedBelow: number;
  /** percentOfNormal: «for flexion and signed movements with N of 20 degrees or more». */
  percentOfNormalMinN: number;
  /** approximate: «values above 120 degrees on the arm raises (elevationOverRead)». */
  elevationOverReadAbove: number;
  /** terms.b: «phone bias against the norm's instrument: 0 until the bench check». */
  phoneBias: number;
  functionalFloor: Partial<Record<RomMovementId, RomFunctionalFloor>>;
}

export interface RomData {
  id: string;
  specVersion: string;
  status: string;
  signoff: { status: string; approved: boolean; approvers: string[] };
  conventions: { sides: string };
  engine: RomEngine;
  regions: RomRegion[];
  regionTable: RomRegionTableRow[];
  problemTypes: { id: ProblemType; ar: string; en: string }[];
  /**
   * The condition questions (rom-protocol 2.3); a row without a question has empty ask text. A
   * condition with its own movement set (Parkinson's, review A10) lists it: buildRomProtocol plans only
   * those movements in the regions they cover, in the position given.
   */
  conditionAutoMap: {
    condition: string;
    ask: Text;
    answers: Text[];
    movementSet?: { movement: RomMovementId; position?: RomPositionId }[];
  }[];
  limbLoss: {
    levels: {
      level: LimbLossLevel;
      /** The regions present at this level (rom-protocol 2.4 column Present); the limb's others are absent. */
      present: RegionId[];
      measured: RomMovementId[];
      notMeasured: Partial<Record<RomMovementId, "not_measured_camera" | "limb_absent">>;
    }[];
  };
  positions: Record<RomPositionId, Text>;
  movements: RomMovementDef[];
  defaultMovements: RomDefaultMovementDef[];
  norms: NormDef[];
  thresholds: RomThresholds;
  retest: RomRetest;
  sessionOrder: RomSessionOrder;
  /** Kept until the tech lead decides contract gap 5: the parity source for the safety ids and the pain rule. */
  safety: { id: RomSafetyId; rule: string; action: string }[];
  reasonIds: Record<RomV7ReasonId, string>;
  copy: Record<(typeof ROM_COPY_KEYS)[number], Text>;
  cues: Record<(typeof ROM_CUE_IDS)[number], Text>;
  results: Record<(typeof ROM_RESULT_KEYS)[number], Text>;
  sideWords: {
    sideM: { right: string; left: string };
    sideF: { right: string; left: string };
    side: { right: string; left: string };
  };
  /** The norm sources (id, cite and url only). */
  citations: { id: string; cite: string; url: string }[];
}

/* ------------------------------------------------------ derived key types */

export type RomCopyKey = keyof RomData["copy"];
export type RomResultKey = keyof RomData["results"];
/** 24 cues */
export type RomCueId = keyof RomData["cues"];
export type RegionTableRow = RomData["regionTable"][number];
export type DefaultMovementDef = RomData["defaultMovements"][number];

/* ------------------------------------------------------- compile check */

/**
 * Widen (src/movements/types.ts) for the v7 data files: the shape of T with every literal widened to
 * its primitive and tuples to arrays, where an index signature (Record<string, X>) also accepts the
 * `key?: undefined` members TypeScript adds when it merges the shapes of a JSON array's elements
 * (movement landmarks, pattern thresholds). `raw satisfies WidenV7<RomData>` checks at compile time
 * that the JSON has every field with the right nesting and primitive types.
 */
export type WidenV7<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends null | undefined
        ? T
        : T extends readonly (infer U)[]
          ? WidenV7<U>[]
          : string extends keyof T
            ? { [k: string]: WidenV7<T[string & keyof T]> | undefined }
            : { [K in keyof T]: WidenV7<T[K]> };
