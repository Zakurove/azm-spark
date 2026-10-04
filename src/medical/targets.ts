/**
 * Exercise targets and the targeted program (product v7 contract 2.10, stream E, step E2):
 * collectTargets turns the range and gait findings into target requests, selectForTargets picks
 * from the eligible pool (the safety filters unchanged), whyLine writes the reason from the data
 * (rules before AI), and targetedWeekly builds the weekly plan from them. Pure, no DOM.
 *
 * Placeholder of step A5 (contract 1.3), replaced by E2: no target, an empty selection, an empty
 * why line, and the engine's own weekly plan (null exactly when engineWeekly is null).
 */
import type { Intake, Plan } from "./plan";
import type { RomFinding } from "./rom-types";
import type { GaitPatternResult } from "./gait-types";
import type { ReferralId, TargetReason, TargetRequest, TargetedItem } from "./target-types";
import { engineWeekly, type L, type LibraryExercise, type Selection, type WeeklyPlan } from "./weekly";

/** gradeRules, paths, romMovements, gaitPatterns, gaitStatusRules, regionDefaultRule, arthritisAddOn, merge. */
export function collectTargets(_input: {
  intake: Intake;
  rom: readonly RomFinding[];
  gait: readonly GaitPatternResult[];
}): { targets: TargetRequest[]; referrals: ReferralId[] } {
  return { targets: [], referrals: [] };
}

/** selection rules: the eligible pool (libraryPool plus v7 contraindications), position fit, caps, session order, dose profiles. */
export function selectForTargets(
  _h: Intake,
  _plan: Plan,
  _pool: readonly LibraryExercise[],
  targets: readonly TargetRequest[],
): { selection: Selection; items: TargetedItem[]; unmet: TargetRequest[] } {
  return { selection: { days: [] }, items: [], unmet: [...targets] };
}

/** whyLines templates, Arabic first; joined with why_both when one exercise carries two reasons. */
export function whyLine(_reasons: readonly TargetReason[]): L {
  return { ar: "", en: "" };
}

/** The weekly plan built from the findings. Null exactly when engineWeekly is null (plan not ready). */
export function targetedWeekly(
  h: Intake,
  plan: Plan,
  _rom: readonly RomFinding[],
  _gait: readonly GaitPatternResult[],
  _findingsRef: NonNullable<WeeklyPlan["findings"]>,
): WeeklyPlan | null {
  return engineWeekly(h, plan);
}
