/**
 * Exercise targets and the targeted program: types (product v7 contract 2.10). The functions live in
 * src/medical/targets.ts (collectTargets, selectForTargets, whyLine, targetedWeekly) and
 * src/medical/contraindications.ts (stream E). The why line is deterministic from the data (rules
 * before AI). Pure types, no DOM.
 */
import type { RegionSide, RegionId } from "./body-map";
import type { CausePath, RomFinding } from "./rom-types";
import type { Confidence, GaitPatternId, GaitStatus } from "./gait-types";
import type { L, WeeklyItem } from "./weekly";
import type { Evidence, RomMovementId, RomSide } from "../movements/rom/types";
import type { HipEndRangeId } from "../movements/targets/types";

export type TargetAction = "stretch" | "strengthen" | "mobility" | "balance" | "practice";
/** stretch:hip_flexors, mobility:knee_flexion, balance:single_leg_stance */
export type TargetId = `${TargetAction}:${string}`;
export type ReferralId = `refer:${string}`;
export type DoseProfileId =
  | "stretch_hold"
  | "mobility_reps"
  | "mobility_pain"
  | "strength_reps"
  | "strength_isometric"
  | "balance_practice"
  | "walking_practice"
  | "cue_walking";
export type ExercisePosition =
  "seated" | "seated_forward" | "standing" | "standing_supported" | "lying_back" | "lying_side" | "floor";

export type TargetReason =
  | { kind: "rom"; movementId: RomMovementId; side: RomSide; finding: RomFinding["finding"]; path: CausePath }
  | {
      kind: "gait";
      pattern: GaitPatternId;
      label: string;
      side: "left" | "right" | "both" | "none";
      status: GaitStatus;
      confidence: Confidence | null;
    }
  | { kind: "region_default"; region: RegionId; side: RegionSide }
  | { kind: "arthritis"; region: RegionId }
  /**
   * The wheelchair shoulder care block (mapping.mobilityDefaultRule, review C12; contract gap 2 of the
   * 2026-10-04 change log, the proposal applied until the tech lead decides), why line
   * why_wheelchair_shoulder.
   */
  | { kind: "mobility_default"; block: "wheelchair_shoulder" };
export interface TargetRequest {
  id: TargetId;
  side: "left" | "right" | "both" | "none";
  priority: 1 | 2 | 3;
  painFriendlyOnly: boolean;
  reasons: TargetReason[];
  evidence: Evidence;
}

/** LibraryExercise (pool.ts) gains optional fields; existing entries keep working without them. */
export interface LibraryExerciseV7Fields {
  positions?: ExercisePosition[];
  targets?: { id: TargetId; role: "primary" | "secondary" }[];
  painFriendly?: boolean;
  /**
   * stretchProfile: the data gives some new exercises a stretch dose too (change log, A1). text: the
   * exercise's own dose in English words (exercise-targets newExercises[].dose.text, renamed from note
   * by the freeze step, D-023 item 7), with the numbers it writes.
   */
  dose?: {
    profile: DoseProfileId;
    painProfile?: DoseProfileId;
    stretchProfile?: DoseProfileId;
    text?: string;
    holdSeconds?: number | number[];
    repetitions?: number | number[];
    rounds?: number[];
  };
  /** new exercises ship as draft until sign off; absent means approved (every existing entry) */
  status?: "draft" | "approved";
  /**
   * The hip end range items of the exercise (exercise-targets newExercises[].hipEndRange), which the
   * posterior and anterior hip precaution filters read. Contract gap 3 of the 2026-10-04 change log:
   * the contract typed it boolean; the proposal (a list of ids) is applied until the tech lead decides.
   * Rule 2 of 2.10 stays: any hip end range item after a hip replacement under 3 months is dropped.
   */
  hipEndRange?: HipEndRangeId[];
  /**
   * The contraindication ids the entry's libraryTags row adds (exercise-targets libraryTags[].proposed,
   * approved with the sign off, D-025), kept apart from `contraindications` so v1 pools stay unchanged:
   * libraryPool reads them only for an intake with the v7 fields (D-026 item 9, contract 2.10 rule 2).
   * Written by scripts/library-v7.mjs; absent when the row adds none.
   */
  v7Contraindications?: string[];
}
/** WeeklyItem (weekly.ts) gains optional fields (the type hunk at Gate A). */
export interface WeeklyItemV7Fields {
  targets?: TargetId[];
  why?: L;
  reasonRefs?: TargetReason[];
}
/** WeeklyPlan gains `findings?` (the type hunk at Gate A): the focus check a targeted weekly was built from. */
export interface WeeklyPlanFindingsRef {
  checkId: string;
  romVersion: string;
  gaitVersion: string | null;
  targetsVersion: string;
  created: number;
}

export interface TargetedItem {
  exerciseId: string;
  slot: "warmup" | "extra" | "cooldown";
  targets: TargetId[];
  reasons: TargetReason[];
  why: L;
  dose: WeeklyItem;
}
