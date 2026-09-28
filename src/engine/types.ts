/** Core shared types for the Azm 5.0 adaptation engine (pure TS, no DOM). */

export interface Landmark {
  x: number; // normalized [0,1] image coords
  y: number;
  z: number;
  visibility: number; // 0..1
}

/** One pose frame: 33 MediaPipe landmarks + timestamp (ms). */
export interface Frame {
  t: number;
  lm: Landmark[]; // image-space (normalized)
  world?: Landmark[]; // metric world landmarks when available
  /**
   * Source image aspect ratio, videoWidth ÷ videoHeight. Normalized landmarks
   * divide x by the width and y by the height, so angles and lengths are only
   * true after x is scaled by this value (see `toPixelSpace` in geometry.ts).
   * Undefined means 1 (square): synthetic traces and fixtures.
   */
  aspect?: number;
  /**
   * Every pose the model found in this frame, in the model's own order, which is not stable from
   * one frame to the next. At most the source's `numPoses` (the movement check uses 2, spec 4.0).
   * `lm` stays the first pose (or an empty pose when none was found) for backward compatibility;
   * the check picks its subject with `SubjectLock` (subject.ts) and never trusts the order.
   * Undefined for sources that only know one pose (synthetic traces).
   */
  poses?: Landmark[][];
}

// MediaPipe BlazePose landmark indices
export const LM = {
  nose: 0,
  l_eye: 2,
  r_eye: 5,
  l_ear: 7,
  r_ear: 8,
  l_shoulder: 11,
  r_shoulder: 12,
  l_elbow: 13,
  r_elbow: 14,
  l_wrist: 15,
  r_wrist: 16,
  l_hip: 23,
  r_hip: 24,
  l_knee: 25,
  r_knee: 26,
  l_ankle: 27,
  r_ankle: 28,
} as const;

export type Side = "left" | "right";

export type ProfileId = "wheelchair" | "hemiparesis_left" | "hemiparesis_right" | "standing";

export interface ImpairmentProfile {
  id: ProfileId;
  /** joints that must never be scored (chair occlusion / absent function) */
  unscoredRegions: ("lower_limbs" | "left_arm" | "right_arm")[];
  /** side with expected asymmetry (hemiparesis) — asymmetry cues are softened & measured vs own baseline */
  expectedAsymmetry?: Side;
  seated: boolean;
}

/** Metric ids the geometry module can compute. */
export type MetricId =
  | "elbow_flex_l"
  | "elbow_flex_r"
  | "elbow_flex_mean"
  | "knee_flex_l"
  | "knee_flex_r"
  | "knee_flex_mean"
  | "shoulder_abd_l"
  | "shoulder_abd_r"
  | "trunk_lean" // deviation of trunk axis from vertical, degrees (signed L/R in image plane)
  | "shoulder_hike" // shoulder line vertical offset, fraction of trunk length (signed: +ve = left higher)
  | "arm_asym" // |elbow_flex_l - elbow_flex_r| degrees
  | "hip_height" // hip midpoint height above ankle midpoint, fraction of trunk length (sit-to-stand)
  | "nose_offset"; // nose minus mid shoulder, horizontal, fraction of trunk length (+ve = nose to image right)

export interface MetricFrame {
  t: number;
  values: Partial<Record<MetricId, number>>;
  /** per-landmark usable flags after confidence gating */
  usable: boolean[];
  framingOk: boolean;
}

export type CueId =
  | "sit_tall"
  | "even_arms"
  | "slow_down"
  | "fuller_range"
  | "relax_shoulders"
  | "stand_fully"
  | "control_descent"
  | "get_in_frame"
  | "move_back"
  | "great_rep"
  | "halfway"
  | "set_done"
  | "stop_rest"
  | "sit_upright_first";

export type Severity = "safety" | "warn" | "info" | "praise";

export interface CompensationRule {
  id: string;
  metric: MetricId;
  /** threshold = prfBaseline(metric) + delta  (absolute if baseline undefined) */
  delta: number;
  /** ignore the personal baseline — threshold is the raw value (used for safety caps) */
  absolute?: boolean;
  op: ">" | "<";
  cue: CueId;
  severity: Severity;
  /** skip when the profile declares expected asymmetry */
  skipIfExpectedAsymmetry?: boolean;
  /** evaluate only while a rep is in progress */
  duringRepOnly?: boolean;
}

/**
 * S0 (council 2026-09-28): the workout trunk safety stop. Two limits; whichever is reached first
 * stops the set:
 *   (a) the trunk moves `relativeDeg` or more away from the person's own calibrated posture, in
 *       either direction;
 *   (b) an absolute limit from vertical, by view. Front view (sideways lean): `eitherDeg` in either
 *       direction. Side view: `forwardDeg` for a lean away from the backrest and `backwardDeg` for a
 *       lean toward it, the forward direction taken at calibration from the side of the mid
 *       shoulder the nose is on.
 * A calibrated posture already at or beyond limit (b) blocks the set start with `presetCue`.
 */
export interface TrunkSafetyStop {
  relativeDeg: number;
  cap: { view: "front"; eitherDeg: number } | { view: "side"; forwardDeg: number; backwardDeg: number };
  /** Spoken when the set stops. */
  cue: CueId;
  /** Spoken when the calibrated posture blocks the set start. */
  presetCue: CueId;
}

export interface ExerciseVariant {
  profileIds: ProfileId[];
  /** landmarks that must be visible to start/score */
  requiredLandmarks: number[];
  /** landmarks rendered dimmed & never scored */
  contextLandmarks: number[];
}

export interface ExerciseDef {
  id: string;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  /** metric that defines the repetition cycle; higher value = "top" of rep */
  primaryMetric: MetricId;
  /** metrics the engine must compute every frame */
  metrics: MetricId[];
  /** default ROM window (degrees or ratio) used before calibration */
  defaultRange: [number, number];
  /** minimum seconds for a valid concentric phase (anti-momentum) */
  minPhaseSec: number;
  /** compensation rules (evaluated vs PRF baselines) */
  rules: CompensationRule[];
  /** trunk safety stop (S0); evaluated every frame of the set, in or out of a rep */
  trunkSafety?: TrunkSafetyStop;
  variants: ExerciseVariant[];
  targetReps: number;
  camera: { en: string; ar: string }; // framing instruction
}

/** Personal Reference Frame — per user × exercise calibration. */
export interface PRF {
  exerciseId: string;
  /** observed primary-metric range during calibration */
  range: [number, number];
  /** baseline values for compensation metrics (median during calibration) */
  baselines: Partial<Record<MetricId, number>>;
  capturedAt: number;
}

export type RepClass = "valid" | "partial" | "compensated";

export type EngineEvent =
  | { kind: "rep"; cls: RepClass; count: number; t: number; durSec: number; peakPct: number }
  | { kind: "flag"; ruleId: string; cue: CueId; severity: Severity; value: number; t: number }
  | { kind: "phase"; phase: "lifting" | "top" | "lowering" | "idle"; t: number }
  /** A safety stop ended the set (S0); the engine counts nothing after it. */
  | { kind: "stop"; ruleId: string; t: number }
  | { kind: "framing"; ok: boolean; t: number }
  | { kind: "progress"; pct: number; t: number };

export interface SessionSummary {
  exerciseId: string;
  profileId: ProfileId;
  startedAt: number;
  endedAt: number;
  reps: { valid: number; partial: number; compensated: number };
  flags: Record<string, number>;
  rpe?: number;
  romPct?: number; // best rep ROM as % of calibrated range
  /** WORKOUT_ENGINE_VERSION of the engine that judged the set (repEngine.ts) */
  engineVersion?: string;
}
