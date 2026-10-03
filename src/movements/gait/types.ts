/**
 * Types for the v7 runtime gait data, src/movements/gait/gait-v7.json (product v7 contract 2.1).
 *
 * The JSON is written by scripts/clinical/export-v7.mjs from local-docs/clinical/v7/gait-rules.json
 * (a draft until the clinical sign off). GaitData mirrors the exported JSON field by field;
 * src/movements/gait/index.ts checks the JSON against it at compile time and
 * tests/v7/a-runtime-data.test.ts checks the literal id lists against the data in both directions.
 * Pure types and id lists, no DOM.
 *
 * Sections the contract keeps as "(numbers)" (capture, preprocessing, events, scaling, errorMargins)
 * hold only the numbers the source writes as numbers; the numbers the source writes inside prose are
 * listed as a contract gap in the change log (A1). Prose fields (eligibility, quality gates, norms
 * text, pattern rule text) are engineering documentation, never shown to a person.
 */
import type { GaitView } from "../../engine/gait/types";
import type { Confidence, GaitPatternId, GaitStatus, NotAssessedReason } from "../../medical/gait-types";
import type { Text } from "../types";

/** Measurement grades of gait-rules grades.measurement, with the minus and plus steps metrics use. */
export type GaitGrade = "A" | "B" | "B-" | "C+" | "C" | "D";

/** The 30 metrics the engine computes (contract 2.8 GaitMetricId). */
export const GAIT_METRIC_IDS = [
  "cadence",
  "step_time_s",
  "stride_time_s",
  "stance_pct",
  "swing_pct",
  "single_support_s",
  "double_support_pct",
  "step_length_m",
  "stride_length_m",
  "speed_mps",
  "sr_single_support",
  "sr_stance",
  "sr_step_length",
  "knee_swing_peak",
  "knee_stance_min",
  "knee_loading_peak",
  "tla_peak",
  "hip_ext_peak",
  "thigh_swing_peak",
  "foot_pitch_ic",
  "trunk_incl",
  "trunk_incl_abs",
  "arm_swing",
  "pelvic_drop",
  "static_pelvic_drop",
  "trunk_sway_range",
  "trunk_lean_peak",
  "swing_lateral_path",
  "hip_hike",
  "step_width_ratio",
] as const;
/** Metrics the data lists as grade D, never used (do_not_use). */
export const GAIT_UNUSED_METRIC_IDS = ["ankle_angles", "variability"] as const;
export type GaitUnusedMetricId = (typeof GAIT_UNUSED_METRIC_IDS)[number];

/** The 11 patterns (gait-rules patterns). */
export const GAIT_PATTERN_IDS = [
  "shorter_stance",
  "trendelenburg",
  "duchenne_lean",
  "waddling",
  "stiff_knee",
  "steppage",
  "crouch",
  "recurvatum",
  "quad_avoidance",
  "reduced_extension",
  "short_steps",
] as const;

/** Possible reasons ("contributors"), each with its copy line. */
export const GAIT_CONTRIBUTOR_IDS = [
  "pain_side",
  "weak_stance_leg",
  "weak_hip_abductors",
  "hip_pain",
  "hip_girdle_weakness",
  "weak_push_off",
  "quad_stiffness",
  "weak_hip_flexors",
  "knee_bend_limited",
  "clearance_compensation",
  "weak_dorsiflexors",
  "tight_calf",
  "calf_stiffness",
  "knee_straighten_limited",
  "weak_quadriceps",
  "weak_hamstrings",
  "tight_hip_flexors",
  "weak_hip_extensors",
  "knee_pain",
  "small_movements_condition",
  "careful_walking",
  "prosthesis_fit",
  "prosthesis_comfort",
] as const;
export type GaitContributorId = (typeof GAIT_CONTRIBUTOR_IDS)[number];

export const GAIT_COPY_METRIC_KEYS = [
  "cadence",
  "speed",
  "speed_pad",
  "step_length",
  "steps_even",
  "uneven_step_length",
  "slow_speed",
] as const;
/** Pattern lines by label (antalgic, short_stance, the pattern ids and their side variants). */
export const GAIT_COPY_PATTERN_KEYS = [
  "antalgic",
  "short_stance",
  "trendelenburg",
  "duchenne_lean",
  "waddling",
  "stiff_knee",
  "stiff_knee_both",
  "steppage_possible",
  "steppage_likely",
  "crouch",
  "knee_stays_bent",
  "recurvatum",
  "quad_avoidance",
  "reduced_extension",
  "short_steps",
  "possible_suffix",
  "no_pattern",
] as const;
export const GAIT_COPY_TARGET_KEYS = [
  "strengthen_hip_abductors",
  "strengthen_hip_extensors",
  "strengthen_quadriceps",
  "strengthen_hamstrings",
  "strengthen_calf_push_off",
  "strengthen_hip_flexors",
  "strengthen_dorsiflexors",
  "stretch_hip_flexors",
  "stretch_calf",
  "stretch_hamstrings",
  "mobility_knee_flexion",
  "mobility_knee_extension",
  "gentle_range_load",
  "single_leg_practice",
  "knee_control_practice",
  "loading_practice",
  "step_length_practice",
  "step_length_pad_practice",
  "gradual_loading_practice",
  "even_steps_practice",
  "walking_practice",
] as const;
export type GaitCopyTargetKey = (typeof GAIT_COPY_TARGET_KEYS)[number];
export const GAIT_REFERRAL_IDS = [
  "refer_afo",
  "refer_knee_brace",
  "refer_prosthetist",
  "refer_new_or_worse",
  "refer_care_team",
] as const;
export type GaitReferralId = (typeof GAIT_REFERRAL_IDS)[number];
export const GAIT_QUALITY_COPY_KEYS = [
  "quality_retry",
  "quality_timing_only",
  "pad_compare",
  "handrail_held",
  "handrail_light",
  "pain_limited",
  "aid_noted",
] as const;
export const GAIT_SETUP_COPY_KEYS = [
  "helper_needed",
  "pc_walk_10m",
  "pc_pd_freezing",
  "clear_path",
  "usual_aid",
  "turn_slowly",
  "pad_auto_off",
  "pad_key",
  "pad_start",
  "stop_any_time",
  "pad_stop",
  "pad_other_side",
  "walk_past_phone",
  "single_leg_static",
] as const;

/* ------------------------------------------------------------- sections */

export interface GaitMetricDef {
  id: (typeof GAIT_METRIC_IDS)[number] | GaitUnusedMetricId;
  views: GaitView[];
  unit?: string;
  grade: GaitGrade;
  gradeFront?: GaitGrade;
  gradePad?: GaitGrade;
  gradeHyperextension?: GaitGrade;
  /** double_support_pct: not reported below this processed fps. */
  notReportedBelowFps?: number;
  use: ("report" | "rule" | "finding" | "support" | "do_not_use")[];
}

/** A threshold set of a pattern: `<metric>_gte` style numbers, and `any`, `all` or `requires` combinations. */
export type GaitThresholdSet = Record<string, number | string | (string | Record<string, number>)[]>;

export interface GaitPatternTarget {
  action: "strengthen" | "stretch" | "mobility" | "practice" | "refer" | "balance";
  target: string;
  /** "P" (the short stance side), "S" (the pattern's side) or "both". */
  side?: string;
  when?: string;
}

/** A pattern as the data writes it ("(structured)": the prose section, sides and labelRule are dropped). */
export interface GaitPatternDef {
  id: GaitPatternId;
  /** shorter_stance only: the label by pain and prosthesis. */
  labels?: { withPain: string; withoutPain: string; prostheticSide: string };
  signGrades: GaitGrade[];
  /** View ids, with prose for a view variant ("back (away passes)"). */
  views: string[];
  signs: {
    metric: string;
    id?: string;
    role?: string;
    direction?: string;
    during?: string;
    rule?: string;
    view?: string;
  }[];
  thresholds: {
    possible: GaitThresholdSet;
    likely: GaitThresholdSet | null;
    type: "calc" | "published";
    withoutStaticCheck?: string;
    bilateralLikely?: Record<string, number>;
    speedRules?: Record<string, string>;
    bilateral?: string;
  };
  caps?: Record<string, GaitStatus>;
  confidenceCap: Confidence;
  confidenceCapPad?: Confidence;
  /** A list, or lists by label (shorter_stance). */
  contributors: GaitContributorId[] | Record<string, GaitContributorId[]>;
  targets: GaitPatternTarget[] | Record<string, GaitPatternTarget[]>;
  copyTargets: GaitCopyTargetKey[] | Record<string, GaitCopyTargetKey[]>;
  referrals?: GaitReferralId[];
  bilateral?: string;
  notAssessed?: string[];
  /** Contributor id to the prose condition that orders it first. */
  contributorRules?: Partial<Record<GaitContributorId, string>>;
  statusMax?: GaitStatus;
  bilateralId?: string;
  unilateralId?: string;
  downgrade?: string[];
  copyIds?: { possible: string; likely: string };
}

export interface GaitFindingDef {
  id: "flat_or_forefoot_contact" | "slow_speed" | "uneven_step_length";
  views: GaitView[];
  grade: GaitGrade;
  gradeFront?: GaitGrade;
  targets: GaitPatternTarget[];
  copyTargets: GaitCopyTargetKey[];
}

export interface GaitMeanSd {
  mean: number;
  sd: number;
}
export interface GaitFang18Band {
  ageMin: number;
  ageMax: number;
  sex: "M" | "W";
  speed_mps: GaitMeanSd;
  stride_m: GaitMeanSd;
  step_m_calc: number;
  cadence: GaitMeanSd;
  footPitchIC_deg: GaitMeanSd;
}
export interface GaitHollman11Band {
  sex: "M" | "W";
  ageMin: number;
  /** null: no upper age */
  ageMax: number | null;
  speed_cmps: GaitMeanSd;
  cadence: GaitMeanSd;
  step_cm: GaitMeanSd;
  stride_cm: GaitMeanSd;
  step_time_s: GaitMeanSd;
  stance_pct: GaitMeanSd;
  swing_pct: GaitMeanSd;
  double_support_pct: GaitMeanSd;
  step_width_cm: GaitMeanSd;
}
export interface GaitNorms {
  lookup: string;
  methodWarning: string;
  fang18: {
    source: string;
    population: string;
    normalisation: {
      meanHeight_cm: { M: number; W: number };
      toPerson: { speed: string; stride: string; cadence: string };
    };
    bands: GaitFang18Band[];
  };
  hollman11: { source: string; population: string; bands: GaitHollman11Band[] };
  context: {
    stanceSwingUnder70: { stance_pct: number; swing_pct: number; source: string };
    comfortableSpeed_cmps: { range: number[]; ages: string; source: string };
    metaAnalysisSpeed_cmps: {
      high: number;
      highGroup: string;
      low: number;
      lowGroup: string;
      source: string;
    };
  };
  kinematics: { id: string; value: string }[];
  symmetry: {
    expression: string;
    cutoffs: { swing_time: number; step_length: number; source: string };
    stance: string;
  };
  kinematicNote: string;
}

export interface GaitRegression {
  intercept: number;
  speed: number;
  height_cm: number;
  rmse: number;
}

export interface GaitData {
  id: string;
  version: string;
  status: string;
  signoff: { approved: boolean; approvers: string[] };
  grades: { measurement: Record<"A" | "B" | "C" | "D", string> };
  /** Kept until the tech lead decides contract gap 5 (gaitPlanFor, the pain rule parity). */
  eligibility: {
    gate: { item: string; rule: string }[];
    today: { item: string; action: string }[];
    modeChoice: { default: "overground"; padAllowedWhenAll: string[] };
    padSafety: { step: string }[];
    stops: string[];
  };
  capture: {
    common: {
      cameraFps: number;
      processedFps: { full: number; timingOnly: number };
      maxDistance_m: number;
      headVisible: boolean;
      standingCalibration_s: number;
    };
    walking_pad: { side: { distance_m: number[] }; front: { distance_m: number; duration_s: number } };
    overground: {
      front: {
        space_m: number;
        marks: { stop_m_behind_phone: number };
        passesToward: number;
        maxPasses: number;
        analysedWindow_m_from_phone: number[];
      };
      side: { distance_m: number[]; passes: number; maxPasses: number };
    };
    minimumCycles: { perSidePerViewGroup: number; noPenalty: number };
  };
  preprocessing: { step: string }[];
  events: { side: { peaks: { distance_s: number } } };
  metrics: GaitMetricDef[];
  scaling: { speedMatched: { strideLength_m: GaitRegression; cadence: GaitRegression } };
  /** Kept until the tech lead decides contract gap 5. */
  qualityGates: {
    level: "setup" | "cycle" | "view" | "session";
    gate: string;
    onFail: string;
    code?: string;
  }[];
  norms: GaitNorms;
  errorMargins: {
    event_s: { value: number };
    symTiming_side: { value: number };
    symSingleSupport_side: { value: number };
    symStepLength_side: { value: number };
    stepLength_m: { side: number; pad: number };
    speed_side_mps: { value: number };
    knee_deg: { value: number };
    hip_deg: { value: number };
    trunkIncl_deg: { value: number };
    pelvis2DBias_deg: { value: number };
    trunkFrontal_deg: { value: number };
  };
  retest: { realChange: { metric: string; min: number; views?: GaitView[] }[] };
  confidenceModel: {
    statuses: GaitStatus[];
    notAssessedReasons: NotAssessedReason[];
    levels: Confidence[];
    capFromGrade: Record<GaitGrade, Confidence | null>;
    downgradeOneLevelFor: string[];
    spasticityOnlyWith: string[];
  };
  patterns: GaitPatternDef[];
  findings: GaitFindingDef[];
  copy: {
    rules: string;
    placeholders: { side_ar: string[]; side_en: string[]; digitsAr: string };
    metrics: Record<(typeof GAIT_COPY_METRIC_KEYS)[number], Text>;
    patterns: Record<(typeof GAIT_COPY_PATTERN_KEYS)[number], Text>;
    contributorsLead: Text;
    contributorsJoin: Text;
    contributors: Record<GaitContributorId, Text>;
    targetsLead: Text;
    targets: Record<GaitCopyTargetKey, Text>;
    referrals: Record<GaitReferralId, Text>;
    confidence: Record<"label" | Confidence, Text>;
    quality: Record<(typeof GAIT_QUALITY_COPY_KEYS)[number], Text>;
    setup: Record<(typeof GAIT_SETUP_COPY_KEYS)[number], Text>;
  };
  /** The gait norm sources (id, cite and url only). */
  citations: { id: string; cite: string; url: string }[];
}
