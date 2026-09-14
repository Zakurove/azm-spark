/**
 * Disability Configuration Layer
 * Per-disability-type configurations based on research:
 * - ACSM Guidelines (11th Ed)
 * - Paralympic Training Methods (Goosey-Tolfrey, 2010)
 * - MS Exercise Guidelines (Latimer-Cheung et al., 2013)
 * - SCI Exercise Guidelines (Ginis et al., 2018)
 * - Stroke Rehabilitation (Billinger et al., 2014 - AHA/ASA)
 * - Amputee Rehabilitation (Gailey et al., 2008)
 */

import type {
  DisabilityConfig,
  DisabilityType,
  DetailedDisabilitySubType,
  ExerciseCategory,
} from "./legacy-types";

/**
 * Research-backed configurations per disability type
 */
export const DISABILITY_CONFIGS: Record<DisabilityType, DisabilityConfig> = {
  neurological: {
    disabilityType: "neurological",
    maxSessionMinutes: 45,
    restMultiplier: 1.5,
    fatigueRisk: "high",
    warmUpMinutes: 8,
    coolDownMinutes: 8,
    preferredIntensity: "low",
    specialConsiderations: [
      "Monitor for thermoregulation issues",
      "Watch for fatigue escalation",
      "Allow extra recovery time between exercises",
      "Avoid overheating environments",
      "Consider cognitive load of complex movements",
    ],
    recommendedCategories: ["flexibility", "balance", "core"],
    avoidCategories: [], // No categories strictly avoided, but intensity managed
  },

  chronic: {
    disabilityType: "chronic",
    maxSessionMinutes: 40,
    restMultiplier: 1.5,
    fatigueRisk: "high",
    warmUpMinutes: 10,
    coolDownMinutes: 10,
    preferredIntensity: "low",
    specialConsiderations: [
      "Energy conservation is priority",
      "Allow for symptom variability",
      "Break exercises into shorter segments",
      "Prioritize consistency over intensity",
      "Monitor for post-exertional malaise",
    ],
    recommendedCategories: ["flexibility", "balance", "core"],
    avoidCategories: ["cardio"], // High-intensity cardio may trigger symptoms
  },

  musculoskeletal: {
    disabilityType: "musculoskeletal",
    maxSessionMinutes: 50,
    restMultiplier: 1.2,
    fatigueRisk: "medium",
    warmUpMinutes: 10,
    coolDownMinutes: 8,
    preferredIntensity: "moderate",
    specialConsiderations: [
      "Extended warm-up for joint protection",
      "Focus on proper form over weight/reps",
      "Avoid impact exercises",
      "Strengthen supporting muscles",
      "Monitor pain levels during exercises",
    ],
    recommendedCategories: ["flexibility", "core", "balance"],
    avoidCategories: [],
  },

  amputation: {
    disabilityType: "amputation",
    maxSessionMinutes: 55,
    restMultiplier: 1.0,
    fatigueRisk: "medium",
    warmUpMinutes: 8,
    coolDownMinutes: 6,
    preferredIntensity: "moderate",
    specialConsiderations: [
      "Emphasize balance and core stability",
      "Address compensatory movement patterns",
      "Strengthen residual limb when appropriate",
      "Focus on symmetrical muscle development",
      "Monitor prosthetic comfort during exercise",
    ],
    recommendedCategories: ["balance", "core", "upper_body"],
    avoidCategories: [],
  },

  mobility: {
    disabilityType: "mobility",
    maxSessionMinutes: 60,
    restMultiplier: 1.0,
    fatigueRisk: "medium",
    warmUpMinutes: 6,
    coolDownMinutes: 6,
    preferredIntensity: "moderate",
    specialConsiderations: [
      "Wheelchair-friendly exercise focus",
      "Upper body strengthening priority",
      "Seated exercise variations",
      "Maintain joint range of motion",
      "Prevent secondary complications",
    ],
    recommendedCategories: ["upper_body", "core", "flexibility"],
    avoidCategories: [],
  },

  other: {
    disabilityType: "other",
    maxSessionMinutes: 45,
    restMultiplier: 1.2,
    fatigueRisk: "medium",
    warmUpMinutes: 8,
    coolDownMinutes: 8,
    preferredIntensity: "low",
    specialConsiderations: [
      "Conservative approach recommended",
      "Monitor response to new exercises",
      "Adjust based on individual feedback",
      "Consult healthcare provider if uncertain",
    ],
    recommendedCategories: ["flexibility", "balance", "core"],
    avoidCategories: [],
  },
};

// ============================================================================
// Detailed Sub-Type Configurations (Research-Backed)
// ============================================================================

/**
 * Research-backed configurations for specific conditions
 * These override the base type configurations when a sub-type is specified
 */
export const DISABILITY_SUBTYPE_CONFIGS: Partial<
  Record<DetailedDisabilitySubType, DisabilityConfig>
> = {
  // ---------------------------------------------------------------------------
  // Neurological Sub-Types
  // ---------------------------------------------------------------------------

  /**
   * Multiple Sclerosis configuration
   * Reference: Latimer-Cheung et al. (2013) - Archives of Physical Medicine
   * Guidelines: 30 min MODERATE 2x/week
   */
  ms: {
    disabilityType: "neurological",
    subType: "ms",
    maxSessionMinutes: 35, // Slightly increased from research minimum
    restMultiplier: 1.5,
    fatigueRisk: "high",
    warmUpMinutes: 8,
    coolDownMinutes: 8,
    preferredIntensity: "moderate", // Upgraded from LOW per research
    specialConsiderations: [
      "Monitor for thermoregulation issues - avoid overheating",
      "Watch for Uhthoff's phenomenon (symptom worsening with heat)",
      "Moderate intensity is safe and recommended (Latimer-Cheung 2013)",
      "Allow extra recovery time between exercises",
      "Consider cognitive load of complex movements",
      "Morning exercise may be better due to fatigue patterns",
    ],
    recommendedCategories: ["flexibility", "balance", "core"],
    avoidCategories: [],
    thermoregulationWarning: true,
  },

  /**
   * Stroke configuration
   * Reference: Billinger et al. (2014) - AHA/ASA Guidelines
   * Guidelines: 20-60 min, 40-70% VO2R, medical clearance required
   */
  stroke: {
    disabilityType: "neurological",
    subType: "stroke",
    maxSessionMinutes: 45,
    restMultiplier: 1.2,
    fatigueRisk: "medium",
    warmUpMinutes: 10, // Extended warm-up
    coolDownMinutes: 10, // Extended cool-down
    preferredIntensity: "moderate",
    specialConsiderations: [
      "MEDICAL CLEARANCE REQUIRED before starting exercise program",
      "Target 40-70% VO2 reserve intensity (AHA/ASA 2014)",
      "Monitor for signs of cardiovascular stress",
      "Consider affected side limitations and asymmetry",
      "Balance and coordination exercises particularly valuable",
      "Aerobic exercise improves cognitive function post-stroke",
    ],
    recommendedCategories: ["flexibility", "balance", "upper_body"],
    avoidCategories: [],
    requiresMedicalClearance: true,
  },

  /**
   * Parkinson's Disease configuration
   * Reference: Parkinson's Foundation/ACSM Guidelines
   * Guidelines: 150 min/week MODERATE-VIGOROUS, medication timing critical
   */
  parkinsons: {
    disabilityType: "neurological",
    subType: "parkinsons",
    maxSessionMinutes: 45,
    restMultiplier: 1.2,
    fatigueRisk: "medium",
    warmUpMinutes: 10,
    coolDownMinutes: 10,
    preferredIntensity: "moderate", // Can tolerate moderate-vigorous
    specialConsiderations: [
      "Exercise during medication 'ON' state for best performance",
      "Moderate-vigorous intensity is safe and beneficial",
      "Balance and gait training are particularly valuable",
      "Use visual/auditory cues to help with movement initiation",
      "Dual-task training can improve functional mobility",
      "High-intensity exercise may have neuroprotective effects",
    ],
    recommendedCategories: ["balance", "flexibility", "core", "cardio"],
    avoidCategories: [],
  },

  /**
   * Traumatic Brain Injury configuration
   */
  tbi: {
    disabilityType: "neurological",
    subType: "tbi",
    maxSessionMinutes: 30,
    restMultiplier: 1.5,
    fatigueRisk: "high",
    warmUpMinutes: 8,
    coolDownMinutes: 8,
    preferredIntensity: "low",
    specialConsiderations: [
      "MEDICAL CLEARANCE REQUIRED - symptom-limited exercise",
      "Monitor for headache, dizziness, or cognitive symptoms",
      "Gradual return to exercise following concussion protocols",
      "Avoid exercises that risk head impact",
      "Balance exercises important but use safety supports",
    ],
    recommendedCategories: ["flexibility", "balance", "core"],
    avoidCategories: ["cardio"], // High-intensity may worsen symptoms
    requiresMedicalClearance: true,
  },

  // ---------------------------------------------------------------------------
  // Chronic Condition Sub-Types
  // ---------------------------------------------------------------------------

  /**
   * CFS/ME Mild configuration
   * Reference: CDC ME/CFS Management Guidelines
   * CRITICAL: Post-exertional malaise (PEM) is the defining symptom
   */
  cfs_mild: {
    disabilityType: "chronic",
    subType: "cfs_mild",
    maxSessionMinutes: 20, // Reduced from 40
    restMultiplier: 2.0,
    fatigueRisk: "high",
    warmUpMinutes: 5,
    coolDownMinutes: 5,
    preferredIntensity: "low",
    specialConsiderations: [
      "START LOW, PROGRESS VERY GRADUALLY",
      "Monitor for post-exertional malaise (PEM) 24-48 hours after",
      "Pacing strategy is essential - never push through fatigue",
      "Activity should not cause symptom flares",
      "Heart rate monitoring may help prevent overexertion",
      "Rest before feeling tired, not after",
    ],
    recommendedCategories: ["flexibility", "balance"],
    avoidCategories: ["cardio", "lower_body"], // Avoid exertional activities
    postExertionalMalaiseRisk: true,
  },

  /**
   * CFS/ME Moderate configuration
   * CRITICAL: These patients are significantly limited
   */
  cfs_moderate: {
    disabilityType: "chronic",
    subType: "cfs_moderate",
    maxSessionMinutes: 10, // Very limited
    restMultiplier: 2.5,
    fatigueRisk: "critical",
    warmUpMinutes: 3,
    coolDownMinutes: 3,
    preferredIntensity: "very_low",
    maxExerciseBoutMinutes: 5, // Short bouts only
    specialConsiderations: [
      "CRITICAL: Start at 5 minutes max, increase ONLY if no PEM",
      "Seated or lying exercises ONLY",
      "Stop BEFORE feeling tired - 'pacing' is essential",
      "Any increase requires multi-week symptom stability",
      "Overexertion can cause long-term setbacks",
      "Listen to body - some days rest is the only exercise",
    ],
    recommendedCategories: ["flexibility"],
    avoidCategories: ["cardio", "lower_body", "upper_body"], // Minimal exertion only
    postExertionalMalaiseRisk: true,
  },

  /**
   * CFS/ME Severe configuration
   * CRITICAL: These patients may be housebound/bedbound
   */
  cfs_severe: {
    disabilityType: "chronic",
    subType: "cfs_severe",
    maxSessionMinutes: 5, // Absolute minimum
    restMultiplier: 3.0,
    fatigueRisk: "critical",
    warmUpMinutes: 2,
    coolDownMinutes: 2,
    preferredIntensity: "minimal",
    maxExerciseBoutMinutes: 2,
    specialConsiderations: [
      "CRITICAL: Gentle range of motion ONLY",
      "May require assisted/passive movement",
      "Any increase requires MONTHS of symptom stability",
      "Bedbound exercises only if tolerated",
      "Overexertion can cause severe, long-lasting crashes",
      "Healthcare provider supervision recommended",
    ],
    recommendedCategories: ["flexibility"],
    avoidCategories: ["cardio", "lower_body", "upper_body", "core", "balance"],
    postExertionalMalaiseRisk: true,
  },

  /**
   * Fibromyalgia configuration
   * Reference: American College of Rheumatology Guidelines
   */
  fibromyalgia: {
    disabilityType: "chronic",
    subType: "fibromyalgia",
    maxSessionMinutes: 30, // Reduced from 40
    restMultiplier: 1.5,
    fatigueRisk: "high",
    warmUpMinutes: 10, // Extended warm-up important
    coolDownMinutes: 10,
    preferredIntensity: "low",
    specialConsiderations: [
      "Start low, progress gradually over weeks",
      "Warm water exercises may be particularly beneficial",
      "Low-impact exercises preferred",
      "Pain levels may fluctuate - adjust accordingly",
      "Gentle stretching can help with stiffness",
      "Consistency more important than intensity",
    ],
    recommendedCategories: ["flexibility", "balance", "core"],
    avoidCategories: [],
  },

  /**
   * Arthritis configuration (OA/RA)
   * Reference: Arthritis Foundation Exercise Guidelines
   */
  arthritis: {
    disabilityType: "chronic",
    subType: "arthritis",
    maxSessionMinutes: 50,
    restMultiplier: 1.2,
    fatigueRisk: "medium",
    warmUpMinutes: 10, // Essential for joint preparation
    coolDownMinutes: 8,
    preferredIntensity: "moderate",
    specialConsiderations: [
      "Extended warm-up essential for joint protection",
      "Avoid rapid or repetitive movements",
      "Low-impact exercises preferred",
      "Exercise when joints are least stiff (often afternoon)",
      "Strengthening helps protect joints",
      "Pool/water exercises reduce joint stress",
    ],
    recommendedCategories: ["flexibility", "core", "balance"],
    avoidCategories: [],
  },

  // cardiac_rehab removed — cardiac conditions are not supported by Azm (too risky for liability)

  // ---------------------------------------------------------------------------
  // Mobility Sub-Types (SCI)
  // ---------------------------------------------------------------------------

  /**
   * Spinal Cord Injury - Complete configuration
   * Reference: Ginis et al. (2018) - Nature Spinal Cord
   * CRITICAL: Thermoregulation and autonomic dysreflexia concerns
   */
  sci_complete: {
    disabilityType: "mobility",
    subType: "sci_complete",
    maxSessionMinutes: 30, // Reduced from 60
    restMultiplier: 1.5,
    fatigueRisk: "high",
    warmUpMinutes: 8,
    coolDownMinutes: 8,
    preferredIntensity: "moderate",
    minimumRecoveryHours: 48, // Critical for SCI
    maxExerciseBoutMinutes: 10, // Shorter bouts with active recovery
    specialConsiderations: [
      "CRITICAL: Impaired thermoregulation - avoid overheating environments",
      "48-hour minimum recovery between strength sessions",
      "Use 5-10 minute exercise bouts with 2-3 min active recovery",
      "Monitor for autonomic dysreflexia symptoms (headache, sweating above injury)",
      "Upper body focus with seated/wheelchair exercises",
      "Skin protection essential - check for pressure areas",
      "Stay hydrated but monitor bladder management",
    ],
    recommendedCategories: ["upper_body", "core", "flexibility"],
    avoidCategories: ["lower_body"],
    thermoregulationWarning: true,
    requiresMedicalClearance: true,
  },

  /**
   * Spinal Cord Injury - Incomplete configuration
   */
  sci_incomplete: {
    disabilityType: "mobility",
    subType: "sci_incomplete",
    maxSessionMinutes: 35,
    restMultiplier: 1.3,
    fatigueRisk: "high",
    warmUpMinutes: 8,
    coolDownMinutes: 8,
    preferredIntensity: "moderate",
    minimumRecoveryHours: 48,
    specialConsiderations: [
      "CRITICAL: Impaired thermoregulation - monitor body temperature",
      "48-hour minimum recovery between strength sessions",
      "May have some lower limb function - assess individually",
      "Watch for autonomic dysreflexia symptoms",
      "Balance training if ambulatory with assistance",
      "Individualized based on level and completeness of injury",
    ],
    recommendedCategories: ["upper_body", "core", "flexibility", "balance"],
    avoidCategories: [],
    thermoregulationWarning: true,
    requiresMedicalClearance: true,
  },

  // ---------------------------------------------------------------------------
  // Amputation Sub-Types
  // ---------------------------------------------------------------------------

  /**
   * Lower Limb Unilateral Amputation configuration
   * Reference: Gailey et al. (2008) - Amputee Rehabilitation Series
   */
  lower_limb_unilateral: {
    disabilityType: "amputation",
    subType: "lower_limb_unilateral",
    maxSessionMinutes: 50,
    restMultiplier: 1.1,
    fatigueRisk: "medium",
    warmUpMinutes: 8,
    coolDownMinutes: 8,
    preferredIntensity: "moderate",
    specialConsiderations: [
      "Balance and core stability are priority focus areas",
      "Cardiovascular fitness is achievable and important",
      "Monitor prosthetic fit and comfort during exercise",
      "Address compensatory movement patterns early",
      "Strengthen residual limb and hip musculature",
      "Symmetrical muscle development prevents imbalances",
    ],
    recommendedCategories: ["balance", "core", "upper_body", "cardio"],
    avoidCategories: [],
  },

  /**
   * Lower Limb Bilateral Amputation configuration
   */
  lower_limb_bilateral: {
    disabilityType: "amputation",
    subType: "lower_limb_bilateral",
    maxSessionMinutes: 45,
    restMultiplier: 1.2,
    fatigueRisk: "medium",
    warmUpMinutes: 8,
    coolDownMinutes: 8,
    preferredIntensity: "moderate",
    specialConsiderations: [
      "Upper body and core strength essential for transfers",
      "Wheelchair-based exercises for cardiovascular fitness",
      "Balance training if using prosthetics",
      "Higher energy expenditure during mobility - plan accordingly",
      "Skin integrity and pressure relief important",
    ],
    recommendedCategories: ["upper_body", "core", "flexibility", "cardio"],
    avoidCategories: [],
  },

  /**
   * Upper Limb Unilateral Amputation configuration
   */
  upper_limb_unilateral: {
    disabilityType: "amputation",
    subType: "upper_limb_unilateral",
    maxSessionMinutes: 55,
    restMultiplier: 1.0,
    fatigueRisk: "low",
    warmUpMinutes: 6,
    coolDownMinutes: 6,
    preferredIntensity: "moderate",
    specialConsiderations: [
      "Unilateral alternatives for bilateral exercises",
      "No exercises requiring bilateral grip",
      "Core and lower body exercises largely unaffected",
      "Strengthen residual limb if appropriate",
      "Address overuse of intact limb",
      "Cardiovascular exercise fully achievable",
    ],
    recommendedCategories: ["lower_body", "core", "cardio", "balance"],
    avoidCategories: [],
  },

  /**
   * Upper Limb Bilateral Amputation configuration
   */
  upper_limb_bilateral: {
    disabilityType: "amputation",
    subType: "upper_limb_bilateral",
    maxSessionMinutes: 50,
    restMultiplier: 1.0,
    fatigueRisk: "low",
    warmUpMinutes: 6,
    coolDownMinutes: 6,
    preferredIntensity: "moderate",
    specialConsiderations: [
      "Focus on lower body and core exercises",
      "Cardiovascular exercise through walking, cycling, etc.",
      "May need adaptive equipment or assistance",
      "Balance exercises are fully achievable",
      "Consider prosthetic options for exercise",
    ],
    recommendedCategories: ["lower_body", "core", "cardio", "balance"],
    avoidCategories: ["upper_body"],
  },

  // ---------------------------------------------------------------------------
  // Musculoskeletal Sub-Types
  // ---------------------------------------------------------------------------

  /**
   * Osteoporosis configuration
   */
  osteoporosis: {
    disabilityType: "musculoskeletal",
    subType: "osteoporosis",
    maxSessionMinutes: 45,
    restMultiplier: 1.1,
    fatigueRisk: "low",
    warmUpMinutes: 10,
    coolDownMinutes: 8,
    preferredIntensity: "moderate",
    specialConsiderations: [
      "Weight-bearing exercises help maintain bone density",
      "AVOID: Forward flexion, twisting, high-impact activities",
      "Balance exercises reduce fall risk",
      "Resistance training beneficial for bone health",
      "Avoid exercises that stress the spine",
    ],
    recommendedCategories: ["balance", "core", "lower_body"],
    avoidCategories: [],
  },
};

/**
 * Get disability configuration for a specific type
 */
export function getDisabilityConfig(
  disabilityType: DisabilityType,
): DisabilityConfig {
  return DISABILITY_CONFIGS[disabilityType] || DISABILITY_CONFIGS.other;
}

/**
 * Get detailed disability configuration for a sub-type
 * Falls back to base type config if sub-type not found
 */
export function getDetailedDisabilityConfig(
  disabilityType: DisabilityType,
  subType?: DetailedDisabilitySubType,
): DisabilityConfig {
  // If sub-type provided and exists in detailed configs, use it
  if (subType && DISABILITY_SUBTYPE_CONFIGS[subType]) {
    return DISABILITY_SUBTYPE_CONFIGS[subType]!;
  }

  // Fall back to base type configuration
  return getDisabilityConfig(disabilityType);
}

/**
 * Calculate adjusted rest time based on disability configuration
 */
export function calculateRestTime(
  baseRestSeconds: number,
  config: DisabilityConfig,
): number {
  return Math.round(baseRestSeconds * config.restMultiplier);
}

/**
 * Calculate maximum exercises based on session duration and disability config
 */
export function calculateMaxExercises(
  sessionDuration: number,
  config: DisabilityConfig,
  averageExerciseDuration: number = 5,
): number {
  // Account for warm-up, cool-down, and rest periods
  const effectiveSessionTime = Math.min(
    sessionDuration,
    config.maxSessionMinutes,
  );
  const exerciseTime =
    effectiveSessionTime - config.warmUpMinutes - config.coolDownMinutes;

  // Add ~30% buffer for rest periods
  const adjustedExerciseTime = exerciseTime * 0.7;

  return Math.max(
    3,
    Math.floor(adjustedExerciseTime / averageExerciseDuration),
  );
}

/**
 * Check if a category is recommended for the disability type
 */
export function isCategoryRecommended(
  category: ExerciseCategory,
  config: DisabilityConfig,
): boolean {
  return config.recommendedCategories.includes(category);
}

/**
 * Check if a category should be avoided for the disability type
 */
export function shouldAvoidCategory(
  category: ExerciseCategory,
  config: DisabilityConfig,
): boolean {
  return config.avoidCategories.includes(category);
}

/**
 * Get intensity multiplier based on fatigue risk
 */
export function getIntensityMultiplier(config: DisabilityConfig): number {
  switch (config.fatigueRisk) {
    case "critical":
      return 0.5;
    case "high":
      return 0.7;
    case "medium":
      return 0.85;
    case "low":
      return 1.0;
    default:
      return 0.85;
  }
}

/**
 * Get intensity level multiplier for sets/reps calculations
 */
export function getPreferredIntensityMultiplier(intensity: string): number {
  switch (intensity) {
    case "minimal":
      return 0.3;
    case "very_low":
      return 0.5;
    case "low":
      return 0.7;
    case "moderate":
      return 0.85;
    case "high":
      return 1.0;
    default:
      return 0.7;
  }
}

/**
 * Check if a configuration requires medical clearance
 */
export function requiresMedicalClearance(config: DisabilityConfig): boolean {
  return config.requiresMedicalClearance === true;
}

/**
 * Check if a configuration has thermoregulation concerns
 */
export function hasThermoregulationRisk(config: DisabilityConfig): boolean {
  return config.thermoregulationWarning === true;
}

/**
 * Check if a configuration has PEM risk (CFS/ME)
 */
export function hasPostExertionalMalaiseRisk(
  config: DisabilityConfig,
): boolean {
  return config.postExertionalMalaiseRisk === true;
}

/**
 * Get minimum recovery hours between sessions
 */
export function getMinimumRecoveryHours(config: DisabilityConfig): number {
  return config.minimumRecoveryHours || 24; // Default 24 hours
}

/**
 * Get maximum exercise bout duration (for conditions requiring shorter bouts)
 */
export function getMaxExerciseBoutMinutes(
  config: DisabilityConfig,
): number | null {
  return config.maxExerciseBoutMinutes || null;
}

/**
 * Calculate recommended sets adjustment based on disability config
 * Critical fatigue conditions have hard caps to prevent overexertion
 */
export function adjustSets(baseSets: number, config: DisabilityConfig): number {
  const multiplier = getIntensityMultiplier(config);
  let adjusted = Math.max(1, Math.round(baseSets * multiplier));

  // Hard caps for critical fatigue conditions (CFS/ME moderate/severe)
  if (config.fatigueRisk === "critical") {
    adjusted = Math.min(adjusted, 2);
  }

  return adjusted;
}

/**
 * Calculate recommended reps adjustment based on disability config
 * Critical fatigue conditions have hard caps to prevent overexertion
 */
export function adjustReps(baseReps: number, config: DisabilityConfig): number {
  const multiplier = getIntensityMultiplier(config);
  let adjusted = Math.max(3, Math.round(baseReps * multiplier));

  // Hard caps for critical fatigue conditions (CFS/ME moderate/severe)
  if (config.fatigueRisk === "critical") {
    adjusted = Math.min(adjusted, 5);
  }

  return adjusted;
}
