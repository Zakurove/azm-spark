/**
 * Types for the v7 runtime exercise targets data, src/movements/targets/targets-v7.json (product v7
 * contract 2.1 and 2.10).
 *
 * The JSON is written by scripts/clinical/export-v7.mjs from
 * local-docs/clinical/v7/exercise-targets.json (signed off on 2026-10-04, D-025). TargetsData
 * mirrors the exported JSON field by field; src/movements/targets/index.ts checks the JSON against it
 * at compile time and tests/v7/a-runtime-data.test.ts checks the literal id lists against the data.
 * Pure types and id lists, no DOM.
 *
 * The mapping rows keep their prose conditions (`if`, `plus`, `finding`, `when`, `rule`) as
 * engineering documentation: the functions of src/medical/targets.ts implement them in code.
 */
import type { RegionId } from "../../medical/body-map";
import type { DemandTag } from "../../medical/sports";
import type { CausePath } from "../../medical/rom-types";
import type { DoseProfileId, ExercisePosition, TargetAction, TargetId } from "../../medical/target-types";
import type { Evidence, RomMovementId } from "../rom/types";
import type { Text } from "../types";

/** The dose profiles (exercise-targets dose.profiles). */
export const DOSE_PROFILE_IDS = [
  "stretch_hold",
  "mobility_reps",
  "mobility_pain",
  "strength_reps",
  "strength_isometric",
  "balance_practice",
  "walking_practice",
  "cue_walking",
] as const;

/** The why line templates (exercise-targets mapping.whyLines). */
export const WHY_LINE_IDS = [
  "why_rom_limited",
  "why_rom_limited_axial",
  "why_rom_pain",
  "why_gait",
  "why_both",
  "why_example_plan",
  "why_region",
  "why_wheelchair_shoulder",
  /** The arthritis add on's own line (D-029 item 1, E2-9). */
  "why_arthritis",
] as const;
export type WhyLineId = (typeof WHY_LINE_IDS)[number];

/** Hip end range ids (newExercises[].hipEndRange; the exporter drops the bracketed notes, contract gap 3). */
export const HIP_END_RANGE_IDS = [
  "flexion_past_90",
  "adduction_past_midline",
  "extension",
  "external_rotation",
  "internal_rotation",
  "abduction",
] as const;
export type HipEndRangeId = (typeof HIP_END_RANGE_IDS)[number];

/* ------------------------------------------------------------- sections */

export interface TargetsTaxonomy {
  targetIdFormat: string;
  actions: { id: TargetAction; ar: string; en: string; definition: string; dose: string }[];
  muscleGroups: { id: string; ar: string; en: string; region: RegionId; performs: string[] }[];
  jointMovements: {
    id: string;
    ar: string;
    en: string;
    region: RegionId;
    romProtocolMovement: string | null;
  }[];
  balanceTargets: { id: string; ar: string; en: string }[];
  practiceTargets: { id: string; ar: string; en: string }[];
  standingOnlyTargets: TargetId[];
  standingRelevantTargets: TargetId[];
  /** beatPctOfCadence: the pad beat the target ids write («beat 85% of today's cadence»). */
  gaitRulesAlignment: {
    gaitAction: string;
    gaitTarget: string;
    targetIds: string[];
    beatPctOfCadence?: number;
  }[];
}

/** A dose profile: its numbers as the data writes them (numbers, or prose where the source gives a range). */
export interface DoseProfile {
  id: DoseProfileId;
  ar: string;
  en: string;
  numbers: {
    holdSeconds?: number | string | { under65: number; age65plus: number };
    repetitions?: number | string | { under65: number; age65plus: number };
    totalSecondsPerMuscle?: number;
    daysPerWeek: string;
    intensity?: string;
    when?: string;
    rounds?: number | string;
    pauseAtEndSeconds?: string;
    /** mobility_pain: the shared pain rule in words (C-15 parity source). */
    painRule?: string;
    noStretch?: boolean;
    sets?: string | { start: number; build: number; sciAndFit: number };
    tempo?: string;
    progression?: string;
    breathing?: string;
    support?: string;
    minutesPerWeekOsteoporosis?: string;
    minutes?: string;
    eligibility?: string;
    boutMinutes?: string;
    bouts?: string;
    beat?: string;
    /** The numbers the words above write, copied beside them (freeze step, D-024 item 4). */
    daysPerWeekAtLeast?: number[];
    daysPerWeekRange?: number[];
    olderAdultsDaysPerWeekAtLeast?: number;
    olderFromAge?: number;
    roundsRange?: number[];
    repetitionsRange?: number[];
    setsRange?: number[];
    pauseAtEndSecondsRange?: number[];
    pauseAtEndSecondsMax?: number;
    holdSecondsMax?: number;
    /** mobility_pain: «stay at 5 or below», «stop at 6 or more, a rise of 2 or more» (C-15). */
    painStayAtOrBelow?: number;
    painStop?: { atOrAbove: number; riseAtOrAbove: number };
    /** strength_reps: «with only 1 or 2 more possible», «if 8 in a row are not possible». */
    repsInReserveAtHard?: number[];
    tooHeavyBelowReps?: number;
    osteoporosisHoursPerWeek?: number;
    osteoporosisMinutesPerDay?: number[];
    minutesPerSession?: number;
    startMinutes?: number;
    buildTowardMinutes?: number[];
    buildMinutesPerWeek?: number;
    /** walking_practice: «about 11 to 14 on the 6 to 20 effort scale». */
    effort?: number[];
    effortScale?: number[];
    boutMinutesRange?: number[];
    boutsRange?: number[];
    beatPct?: { pad: number; overground: number; strokeRaise: number };
    floorMarkSpacingPct?: number;
    defaultBouts?: { bouts: number; minutes: number };
  };
  /**
   * The evidence grade of the profile (D-029 item 1, E2-1): the lowest grade its strength words name
   * outside brackets (scripts/clinical/export-v7.mjs doseEvidence). A target's evidence is its action's.
   */
  evidenceGrade: Evidence;
}

export interface TargetRef {
  id: TargetId;
  role: "primary" | "secondary";
}

/** The tags proposed for an existing library exercise (exercise-targets libraryTags). */
export interface LibraryTag {
  id: string;
  name: Text;
  positions: ExercisePosition[];
  targets: TargetRef[];
  painFriendly: boolean;
  proposed: {
    addContraindications?: string[];
    addContraindication?: string;
    why2?: string;
    cautionOsteoporosis?: string;
    muscles?: string;
  } | null;
}

/** A new exercise, entered into the library as status draft (E1). */
export interface NewExercise {
  id: string;
  status: "draft" | "approved";
  name: Text;
  description: Text;
  category: string;
  muscles: string[];
  equipment: string[];
  props: string[];
  difficulty: string;
  minutes: number;
  steps: { ar: string[]; en: string[] };
  tags: string[];
  demands: DemandTag[];
  contraindications: string[];
  positions: ExercisePosition[];
  targets: TargetRef[];
  painFriendly: boolean;
  /**
   * text: the exercise's own dose in English words (renamed from note, D-023 item 7), an engineering
   * note beside the profile, never shown to the person; holdSeconds, repetitions and rounds are the
   * numbers it writes (a value, or a range [from, to]).
   */
  dose: {
    profile: DoseProfileId;
    painProfile?: DoseProfileId;
    stretchProfile?: DoseProfileId;
    text?: string;
    holdSeconds?: number | number[];
    repetitions?: number | number[];
    rounds?: number[];
  };
  cautions: Text | null;
  textSource: {
    type: "original_azm" | "adapted_nia";
    checkedAgainst?: string[];
    niaTitle?: string;
    credit?: Text;
    source?: string;
  };
  hipEndRange?: HipEndRangeId[];
  painVariant?: Text;
  raisedSeatVariant?: Text & { allows: string };
  requiresMobility?: string;
}

export interface ContraindicationTerm {
  /** The numbers the meaning writes (freeze step): months and weeks since, the knee and back pain cuts. */
  months?: number;
  weeks?: number;
  kneePastStraightGte?: number;
  backPainAtOrAbove?: number;
  /** An id, or a template with `:<region>` generated per body map region. */
  id: string;
  /** "existing", "existing restriction", "new", "new, generated ..." (V7_ONLY_IDS are the kind "new" ids). */
  kind: string;
  meaning: string;
}

/**
 * A cause path that replaces a row's path when its condition holds (D-023 item 6), with the numbers the
 * condition writes.
 */
export interface CauseAlternative {
  path: CausePath;
  /** The condition in words. */
  when: string;
  /** order 4: «an injury over 6 weeks or surgery from 12 weeks is in the history» */
  injuryOverWeeks?: number;
  surgeryFromWeeks?: number;
  /** order 6: «the pain rose by 2 or more during the test, today's pain is 4 or 5, or an injury or surgery was under 3 months ago» */
  painRiseGte?: number;
  painToday?: number[];
  injuryOrSurgeryUnderMonths?: number;
  /** order 11: «as order 6» */
  asOrder?: number;
}

export interface TargetsMapping {
  /**
   * The ordered rules from a finding to its cause path: the row's path, or the first alternative whose
   * condition holds (rows 4, 6 and 11; D-023 item 6).
   */
  causeResolution: {
    order: number;
    if: string;
    path: CausePath;
    alternatives?: CauseAlternative[];
    /** The numbers the condition writes (order 1: surgery under 12 weeks; order 7: injury over 6 weeks, surgery from 12). */
    surgeryUnderWeeks?: number;
    injuryOverWeeks?: number;
    surgeryFromWeeks?: number;
  }[];
  paths: {
    path: CausePath;
    actions: TargetAction[];
    plus: string;
    /** «stretch at priority 1»; pain_stable: «from week 1», «stay at 5 or below, a rise under 2». */
    stretchAtPriority?: number;
    fromWeek?: number;
    painStayAtOrBelow?: number;
    painRiseUnder?: number;
  }[];
  gradeRules: {
    finding: string;
    targets: string;
    perAction: number | string;
    priority: number | string | null;
    /** noNormPosition: «knee straightening in sitting with a lack above 52 ... at priority 1». */
    seatedLackAbove?: number;
    seatedLackPriority?: number;
  }[];
  romMovements: {
    movement: RomMovementId;
    mobility: TargetId[];
    stretch: TargetId[];
    strengthen: TargetId[];
    side?: string;
    /** hip_extension: «only a value below 0 (possible flexion contracture) adds targets». */
    targetsWhenBelow?: number;
    /** knee_extension: «a seated lack above 52 adds ... at priority 1 with refer_measure». */
    seatedLackAbove?: number;
    seatedLackPriority?: number;
  }[];
  gaitPatterns: {
    pattern: string;
    label: string;
    side: string;
    targets: { id: string; when: string | null }[];
  }[];
  gaitStatusRules: { status: string; use: string; priority: number | null }[];
  regionDefaultRule: {
    rule: string;
    /** «mobility targets for those movements at priority 1» */
    priority: number;
    rows: { region: RegionId; when: string; targets: string[]; exercises: string[] }[];
  };
  arthritisAddOn: string;
  neckAddOn: string;
  /** neckAddOn: «at priority 2 on every path except pain_irritable and post_op_early». */
  neckAddOnPriority: number;
  mobilityDefaultRule: {
    rule: string;
    /** «a shoulder care block at priority 1 ..., 2 to 3 days a week» */
    priority: number;
    daysPerWeekRange: number[];
    rows: {
      mobility: "wheelchair";
      block: "wheelchair_shoulder";
      targets: TargetId[];
      exercises: string[];
      priority: number;
      daysPerWeek: string;
      daysPerWeekRange: number[];
    }[];
  };
  /**
   * The numbers of the selection prose (which stays in local-docs): «at most 2 items per limited movement
   * or pattern», «finding items fill at most half of a session's exercise slots» (a share of the slots,
   * rounded down: FZ-5, written at the sign off, D-026 item 4), «a gait target when not seen at two
   * checks», «strengthening stays at priority 1».
   */
  selectionNumbers: {
    itemsPerFindingMax: number;
    findingSlotsShareMax: number;
    findingSlotsRounding: "down";
    gaitTargetNotSeenChecks: number;
    strengthenStaysAtPriority: number;
  };
  sessionLines: { id: "wheelchair_setup"; when: string; ar: string; en: string }[];
}

export interface TargetsData {
  id: string;
  version: string;
  status: string;
  signoff: { approved: boolean; approvers: string[] };
  /** Kept until the tech lead decides contract gap 5: the hold placeholder rule in words. */
  placeholders: {
    hold_ar: string;
    hold_en: string;
    /** «30 ثانية» under 65, «60 ثانية» 65 and over (stretch_hold). */
    holdSeconds: { under65: number; age65plus: number };
    olderFromAge: number;
  };
  taxonomy: TargetsTaxonomy;
  dose: { profiles: DoseProfile[]; sessionOrder: { step: string; text: string }[] };
  libraryTags: LibraryTag[];
  newExercises: NewExercise[];
  contraindicationVocabulary: ContraindicationTerm[];
  mapping: TargetsMapping;
  whyLines: { id: WhyLineId; ar: string; en: string }[];
}
