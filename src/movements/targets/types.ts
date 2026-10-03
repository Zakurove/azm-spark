/**
 * Types for the v7 runtime exercise targets data, src/movements/targets/targets-v7.json (product v7
 * contract 2.1 and 2.10).
 *
 * The JSON is written by scripts/clinical/export-v7.mjs from
 * local-docs/clinical/v7/exercise-targets.json (a draft until the clinical sign off). TargetsData
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
import type { RomMovementId } from "../rom/types";
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
  gaitRulesAlignment: { gaitAction: string; gaitTarget: string; targetIds: string[] }[];
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
  };
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
  /** The exporter drops dose.note with every note field (rule 2; change log, A1). */
  dose: { profile: DoseProfileId; painProfile?: DoseProfileId; stretchProfile?: DoseProfileId };
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
  /** An id, or a template with `:<region>` generated per body map region. */
  id: string;
  /** "existing", "existing restriction", "new", "new, generated ..." (V7_ONLY_IDS are the kind "new" ids). */
  kind: string;
  meaning: string;
}

export interface TargetsMapping {
  /** The path, or prose naming two paths ("pain_irritable or pain_stable", "tight, or rehab when ..."). */
  causeResolution: { order: number; if: string; path: string }[];
  paths: { path: CausePath; actions: TargetAction[]; plus: string }[];
  gradeRules: {
    finding: string;
    targets: string;
    perAction: number | string;
    priority: number | string | null;
  }[];
  romMovements: {
    movement: RomMovementId;
    mobility: TargetId[];
    stretch: TargetId[];
    strengthen: TargetId[];
    side?: string;
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
    rows: { region: RegionId; when: string; targets: string[]; exercises: string[] }[];
  };
  arthritisAddOn: string;
  neckAddOn: string;
  mobilityDefaultRule: {
    rule: string;
    rows: {
      mobility: "wheelchair";
      block: "wheelchair_shoulder";
      targets: TargetId[];
      exercises: string[];
      priority: number;
      daysPerWeek: string;
    }[];
  };
  sessionLines: { id: "wheelchair_setup"; when: string; ar: string; en: string }[];
}

export interface TargetsData {
  id: string;
  version: string;
  status: string;
  signoff: { approved: boolean; approvers: string[] };
  /** Kept until the tech lead decides contract gap 5: the hold placeholder rule in words. */
  placeholders: { hold_ar: string; hold_en: string };
  taxonomy: TargetsTaxonomy;
  dose: { profiles: DoseProfile[]; sessionOrder: { step: string; text: string }[] };
  libraryTags: LibraryTag[];
  newExercises: NewExercise[];
  contraindicationVocabulary: ContraindicationTerm[];
  mapping: TargetsMapping;
  whyLines: { id: WhyLineId; ar: string; en: string }[];
}
