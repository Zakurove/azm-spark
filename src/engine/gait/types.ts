/**
 * Types of the v7 gait engine (product v7 contract 2.8). The functions and classes live in
 * src/engine/gait/*.ts (stream C): analyseGaitView, analyseStaticStance, combineViews, GaitRecorder,
 * LiveStepCounter. Every shared shape is here so the other streams compile against it from Gate A.
 * Pure types, no DOM.
 */
import type { Landmark } from "../types";
import type { GaitMode } from "../../medical/gait-eligibility";
import type { WalkingAid } from "../../medical/plan";

export type GaitView = "front" | "back" | "side" | "pad_side" | "pad_front";
/** the subject's normalized landmarks */
export interface GaitFrame {
  t: number;
  lm: Landmark[];
  aspect: number;
}
export interface GaitSetup {
  mode: GaitMode;
  aid: WalkingAid | "none";
  orthosis: Partial<Record<"left" | "right", "afo" | "kafo" | "knee_brace">>;
  prosthesis: "left" | "right" | null;
  shoes: boolean;
  heightCm: number | null;
  /** 0.5 to 6.0, entered */
  padSpeedKmh: number | null;
  /** booth belt check factor, else null */
  padCorrection: number | null;
  handrail: "none" | "light" | "firm" | null;
  /** pad warm up done */
  familiarised: boolean | null;
}
export interface GaitViewInput {
  view: GaitView;
  /** Pad side views: the body side nearest the phone. */
  nearSide?: "left" | "right";
  setup: GaitSetup;
  /** 3 s standing calibration (pelvis, trunk, TLA, foot pitch zeros; leg and height px) */
  standing: GaitFrame[];
  /** the walk, real timestamps */
  frames: GaitFrame[];
  poseModel: "lite" | "full";
  rollDeg: number | null;
}
export interface GaitEvent {
  side: "left" | "right";
  type: "ic" | "to";
  t: number;
  index: number;
  confidence: number;
  detector: "zeni" | "ankle" | "stenum_front";
}
export interface GaitCycle {
  side: "left" | "right";
  icStart: number;
  to: number | null;
  icEnd: number;
  clean: boolean;
  drop?: "order" | "duration" | "visibility" | "swap" | "turn" | "pass_edge";
}
export type GaitMetricId =
  | "cadence"
  | "step_time_s"
  | "stride_time_s"
  | "stance_pct"
  | "swing_pct"
  | "single_support_s"
  | "double_support_pct"
  | "step_length_m"
  | "stride_length_m"
  | "speed_mps"
  | "sr_single_support"
  | "sr_stance"
  | "sr_step_length"
  | "knee_swing_peak"
  | "knee_stance_min"
  | "knee_loading_peak"
  | "tla_peak"
  | "hip_ext_peak"
  | "thigh_swing_peak"
  | "foot_pitch_ic"
  | "trunk_incl"
  | "trunk_incl_abs"
  | "arm_swing"
  | "pelvic_drop"
  | "static_pelvic_drop"
  | "trunk_sway_range"
  | "trunk_lean_peak"
  | "swing_lateral_path"
  | "hip_hike"
  | "step_width_ratio";
export interface GaitMetricValue {
  id: GaitMetricId;
  /** whole limb or bilateral metrics */
  value: number | null;
  /** per side medians */
  sides?: { left: number | null; right: number | null };
  /** Share of the side's clean cycles in which the sign is present (confidenceModel.firing). */
  share?: { left: number | null; right: number | null };
  n: number;
  unit: string;
  grade: "A" | "B" | "B-" | "C+" | "C" | "D";
}
export type GaitQualityIssue =
  | "too_few_cycles"
  | "low_fps"
  | "gaps"
  | "visibility"
  | "swap"
  | "not_one_person"
  | "wrong_view"
  | "turns_only";
export interface GaitQuality {
  cleanCycles: { left: number; right: number };
  medianFps: number;
  gapShare: number;
  /** at least 6 clean cycles per side in this view group */
  gatePassed: boolean;
  /** 20 to 24 fps */
  timingOnly: boolean;
  issues: GaitQualityIssue[];
}
/** One cycle for the skeleton replay: 15 fps, landmarks 0, 11 to 16, 23 to 32, x and y to 3 decimals. No video. */
export interface ReplayCycle {
  side: "left" | "right";
  fps: 15;
  landmarks: number[];
  frames: [number, number][][];
}
export interface GaitViewResult {
  view: GaitView;
  nearSide?: "left" | "right";
  /** The model this view was measured with (GaitViewInput.poseModel), recorded per view (C-10; D-024, A5-9). */
  poseModel: "lite" | "full";
  events: GaitEvent[];
  cycles: GaitCycle[];
  metrics: Partial<Record<GaitMetricId, GaitMetricValue>>;
  quality: GaitQuality;
  replay: ReplayCycle | null;
}
export interface StaticStanceInput {
  side: "left" | "right";
  support: "none" | "fingertip";
  frames: GaitFrame[];
  standing: GaitFrame[];
}
export interface StaticStanceResult {
  side: "left" | "right";
  pelvicDropDeg: number | null;
  ok: boolean;
}
export interface GaitAnalysis {
  mode: GaitMode;
  /** At most 3 (the plan's view lists); each view's `replay` is null here (the one kept cycle is below). */
  views: GaitViewResult[];
  /** One representative cycle for the whole analysis (gait-rules capture.common.storage): the affected side, the best quality view. */
  replay: ReplayCycle | null;
  staticStance: StaticStanceResult[];
  /** The near limb rule for pad side views; timing symmetry must agree in sign across views. */
  combined: Partial<Record<GaitMetricId, GaitMetricValue>>;
  flags: (
    "far_limb" | "handrail_light" | "handrail_firm" | "not_familiarised" | "model_lite" | "no_height"
  )[];
  /** GAIT_ENGINE_VERSION */
  engineVersion: string;
}
