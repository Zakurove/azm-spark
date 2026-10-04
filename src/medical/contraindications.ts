/**
 * The v7 contraindications (product v7 contract 2.10, stream E, step E1): the ids of
 * TARGETS_DATA.contraindicationVocabulary that hold for a person, which libraryPool applies for
 * every caller and selectForTargets adds the profile and gait aware ids to. Pure, no DOM.
 *
 * Placeholder of step A5 (contract 1.3), replaced by E1 in the same merge as the new exercises and
 * the draft filter: no id holds and no id is new.
 */
import type { Intake } from "./plan";
import type { RomProfile } from "./rom-types";
import type { GaitPlan } from "./gait-eligibility";

/**
 * The v7 contraindication ids for this person, including region_*:<region>. With profile and gait
 * null it returns every id decidable from the intake alone (body map, romFlags, walking, restrictions).
 */
export function v7Contraindications(
  _h: Intake,
  _profile: RomProfile | null,
  _gait: GaitPlan | null,
): Set<string> {
  return new Set();
}

/** The vocabulary ids of kind "new" (the v1 pool does not know them). */
export const V7_ONLY_IDS: ReadonlySet<string> = new Set();
