import { ExerciseDef, LM } from "../engine/types";

/**
 * Exercise definitions — clinical data, not code.
 * Authored defaults by the engineering build; REQUIRE review + sign-off by the
 * medical lead (Nasser, PM&R) and fitness lead (Chaker) before any real-user session.
 * Thresholds are deltas vs the user's own calibrated baselines (PRF), in degrees
 * unless stated otherwise. Every angle is a true angle (pixel space, D-003).
 * The trunk safety stop of the press and the curl is `trunkSafety` (S0, trunkSafety.ts).
 */

const UPPER_REQ = [
  LM.l_shoulder,
  LM.r_shoulder,
  LM.l_elbow,
  LM.r_elbow,
  LM.l_wrist,
  LM.r_wrist,
  LM.l_hip,
  LM.r_hip,
];
const LOWER_CTX = [LM.l_knee, LM.r_knee, LM.l_ankle, LM.r_ankle];

export const EXERCISES: ExerciseDef[] = [
  {
    id: "seated_shoulder_press",
    name: { en: "Seated Shoulder Press", ar: "ضغط الكتف جالسًا" },
    description: {
      en: "Press both arms overhead from shoulder level, then lower with control.",
      ar: "ادفع ذراعيك فوق رأسك من مستوى الكتفين ثم أنزلهما بتحكّم.",
    },
    // Booth v2 A1: the press counts on wrist height (wrists above the shoulders, in trunk lengths),
    // so resting arms (hands down, elbows straight) read as the bottom and never as the top. The
    // elbow angles stay for display and for the summary measure. Racked about 0.2 (wrists just
    // above the shoulders), overhead about 1.1 (upper arm plus forearm over the trunk length),
    // from the generated traces and adult segment ratios.
    primaryMetric: "wrist_height",
    metrics: [
      "wrist_height",
      "elbow_flex_mean",
      "elbow_flex_l",
      "elbow_flex_r",
      "trunk_lean",
      "shoulder_hike",
      "arm_asym",
    ],
    defaultRange: [0.2, 1.1],
    minPhaseSec: 0.8,
    // Hands near shoulder height with the elbows bent. Resting arms (wrists far below), arms
    // overhead and straight arms out to the sides are not the start.
    start: [
      { metric: "wrist_height", min: -0.3, max: 0.6 },
      { metric: "elbow_flex_mean", max: 135 },
    ],
    measure: { kind: "elbow_extension", metric: "elbow_flex_mean" },
    rules: [
      {
        id: "trunk_lean",
        metric: "trunk_lean",
        delta: 8,
        op: ">",
        cue: "sit_tall",
        severity: "warn",
        duringRepOnly: true,
      },
      {
        id: "trunk_lean_neg",
        metric: "trunk_lean",
        delta: -8,
        op: "<",
        cue: "sit_tall",
        severity: "warn",
        duringRepOnly: true,
      },
      {
        id: "shoulder_hike",
        metric: "shoulder_hike",
        delta: 0.06,
        op: ">",
        cue: "relax_shoulders",
        severity: "warn",
        duringRepOnly: true,
      },
      {
        id: "shoulder_hike_neg",
        metric: "shoulder_hike",
        delta: -0.06,
        op: "<",
        cue: "relax_shoulders",
        severity: "warn",
        duringRepOnly: true,
      },
      {
        id: "arm_asym",
        metric: "arm_asym",
        delta: 18,
        op: ">",
        cue: "even_arms",
        severity: "info",
        skipIfExpectedAsymmetry: true,
        duringRepOnly: true,
      },
    ],
    // S0: 15° from the calibrated posture either way, capped at 25° either way (sideways lean with
    // the arms loaded overhead).
    trunkSafety: {
      relativeDeg: 15,
      cap: { view: "front", eitherDeg: 25 },
      cue: "stop_rest",
      presetCue: "sit_upright_first",
    },
    variants: [
      { profileIds: ["wheelchair"], requiredLandmarks: UPPER_REQ, contextLandmarks: LOWER_CTX },
      {
        profileIds: ["hemiparesis_left", "hemiparesis_right", "standing"],
        requiredLandmarks: UPPER_REQ,
        contextLandmarks: [],
      },
    ],
    targetReps: 10,
    camera: {
      en: "Face the camera, 1 to 2 m away, whole upper body in frame.",
      ar: "واجه الكاميرا على بعد متر إلى مترين، بحيث يظهر جذعك وذراعاك بالكامل.",
    },
  },
  {
    id: "seated_biceps_curl",
    name: { en: "Seated Biceps Curl", ar: "ثني المرفق جالسًا" },
    description: {
      en: "Curl the weight to your shoulder, elbow at your side, lower slowly.",
      ar: "ارفع الوزن نحو كتفك مع تثبيت المرفق بجانب جسمك ثم أنزله ببطء.",
    },
    // NOTE: for the curl the interior elbow angle DECREASES at the top (inverted range, lo>hi).
    // CAMERA: side/45-degree view is REQUIRED — a frontal view collapses the sagittal-plane
    // elbow angle in 2D projection (verified failure mode); framing text enforces this.
    primaryMetric: "elbow_flex_mean",
    metrics: [
      "elbow_flex_mean",
      "elbow_flex_l",
      "elbow_flex_r",
      "trunk_lean",
      "arm_asym",
      "nose_offset",
      "shoulder_span",
    ],
    defaultRange: [165, 55], // inverted range: start extended (165°) → curled (55°)
    minPhaseSec: 0.7,
    // The arm hanging with the elbow fairly straight, seen from the side (a 45 degree view still
    // passes: shoulder span under the front view limit, VIEW_RATIO.frontMin in body.ts).
    start: [
      { metric: "elbow_flex_mean", min: 140 },
      { metric: "shoulder_span", max: 0.55 },
    ],
    measure: { kind: "elbow_flexion", metric: "elbow_flex_mean" },
    rules: [
      {
        id: "trunk_swing",
        metric: "trunk_lean",
        delta: 7,
        op: ">",
        cue: "sit_tall",
        severity: "warn",
        duringRepOnly: true,
      },
      {
        id: "trunk_swing_neg",
        metric: "trunk_lean",
        delta: -7,
        op: "<",
        cue: "sit_tall",
        severity: "warn",
        duringRepOnly: true,
      },
      {
        id: "arm_asym",
        metric: "arm_asym",
        delta: 20,
        op: ">",
        cue: "even_arms",
        severity: "info",
        skipIfExpectedAsymmetry: true,
        duringRepOnly: true,
      },
    ],
    // S0: 15° from the calibrated posture either way, capped at 25° forward (away from the
    // backrest) and 30° backward (a recline or a tilt in space wheelchair), the forward direction
    // from the side of the mid shoulder the nose is on at calibration.
    trunkSafety: {
      relativeDeg: 15,
      cap: { view: "side", forwardDeg: 25, backwardDeg: 30 },
      cue: "stop_rest",
      presetCue: "sit_upright_first",
    },
    variants: [
      { profileIds: ["wheelchair"], requiredLandmarks: UPPER_REQ, contextLandmarks: LOWER_CTX },
      {
        profileIds: ["hemiparesis_left", "hemiparesis_right", "standing"],
        requiredLandmarks: UPPER_REQ,
        contextLandmarks: [],
      },
    ],
    targetReps: 10,
    camera: {
      en: "Turn your side to the camera (45 to 90°), 1 to 2 m away, arm fully visible.",
      ar: "وجّه جانبك إلى الكاميرا (بزاوية 45 إلى 90 درجة) على بعد متر إلى مترين، بحيث تظهر ذراعك كاملة.",
    },
  },
  {
    id: "sit_to_stand",
    name: { en: "Sit to Stand", ar: "الوقوف من الجلوس" },
    description: {
      en: "Stand up fully from the chair, then sit back down with control. A validated functional movement.",
      ar: "انهض من الكرسي حتى تقف باستقامة كاملة، ثم اجلس بتحكّم. تمرين معتمد في برامج إعادة التأهيل.",
    },
    primaryMetric: "hip_height",
    metrics: ["hip_height", "knee_flex_mean", "trunk_lean"],
    defaultRange: [1.1, 1.75], // hip height above ankles ÷ trunk length: seated ≈1.1 → standing ≈1.75
    minPhaseSec: 1.0,
    // Seated: the hips within the lower third of the default range.
    start: [{ metric: "hip_height", max: 1.35 }],
    measure: { kind: "hip_rise", metric: "hip_height" },
    rules: [
      {
        id: "lean_excess",
        metric: "trunk_lean",
        delta: 14,
        op: ">",
        cue: "stand_fully",
        severity: "info",
        duringRepOnly: true,
      },
      {
        id: "lean_excess_neg",
        metric: "trunk_lean",
        delta: -14,
        op: "<",
        cue: "stand_fully",
        severity: "info",
        duringRepOnly: true,
      },
    ],
    variants: [
      {
        profileIds: ["hemiparesis_left", "hemiparesis_right", "standing"],
        requiredLandmarks: [
          LM.l_shoulder,
          LM.r_shoulder,
          LM.l_hip,
          LM.r_hip,
          LM.l_knee,
          LM.r_knee,
          LM.l_ankle,
          LM.r_ankle,
        ],
        contextLandmarks: [],
      },
    ],
    targetReps: 5,
    camera: {
      en: "Turn the chair 45° to the camera, 2 to 3 m away, whole body in frame.",
      ar: "ضع الكرسي بزاوية 45 درجة من الكاميرا على بعد مترين إلى ثلاثة، بحيث يظهر جسمك كاملًا.",
    },
  },
];

export function exerciseById(id: string): ExerciseDef {
  const e = EXERCISES.find((x) => x.id === id);
  if (!e) throw new Error(`unknown exercise ${id}`);
  return e;
}

export function exercisesForProfile(profileId: string): ExerciseDef[] {
  return EXERCISES.filter((e) => e.variants.some((v) => v.profileIds.includes(profileId as never)));
}

export function variantForProfile(def: ExerciseDef, profileId: string) {
  return def.variants.find((v) => v.profileIds.includes(profileId as never)) ?? def.variants[0];
}
