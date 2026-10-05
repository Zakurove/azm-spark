import library from "../exercises/library.json";
import {
  V7_ONLY_IDS,
  canClearV7Ids,
  openPositions,
  recentHipReplacement,
  regionOpenPositions,
  v7Contraindications,
} from "./contraindications";
import { getDetailedDisabilityConfig } from "./legacy-config";
import type { DisabilityType } from "./legacy-types";
import type { Intake } from "./plan";
import type { DemandTag } from "./sports";
import type { LibraryExerciseV7Fields } from "./target-types";

/**
 * The Azm exercise library and which of it is safe for a person: the rules, before any model. The
 * plan reads it to know a program is never empty while the library has safe exercises (booth v2, D),
 * and the weekly plan arranges it.
 */

export type L = { ar: string; en: string };
/** v7 (product v7 contract 2.10): optional positions, targets, pain friendly, dose, draft status and hip end range. */
export interface LibraryExercise extends LibraryExerciseV7Fields {
  id: string;
  name: L;
  description: L;
  category: string;
  muscles: string[];
  equipment: string[];
  difficulty: string;
  minutes: number;
  steps: { ar: string[]; en: string[] };
  tags: string[];
  /** What the exercise builds for a para sport (sports.ts); empty for leg strength alone. */
  demands: DemandTag[];
  contraindications: string[];
  /**
   * v7, a new exercise's own cautions and the NIA credit line of a text adapted from NIA (exercise-
   * targets newExercises[].cautions and textSource.credit): the guided card shows them with the
   * exercise in both languages (E1-8, D-026 item 9). Written by scripts/library-v7.mjs.
   */
  cautions?: L;
  credit?: L;
}

export const LIBRARY = library as LibraryExercise[];
export const libraryById = (id: string) => LIBRARY.find((e) => e.id === id);

/** The legacy disability type of each intake condition (the configs of legacy-config.ts). */
export const CONDITION_TYPES: Record<string, DisabilityType> = {
  stroke: "neurological",
  ms: "neurological",
  cerebral_palsy: "neurological",
  parkinsons: "neurological",
  sci_complete: "mobility",
  sci_incomplete: "mobility",
  lower_limb_unilateral: "amputation",
  upper_limb_unilateral: "amputation",
  arthritis: "chronic",
  cfs_moderate: "chronic",
};

export const configsFor = (h: Pick<Intake, "conditions">) =>
  h.conditions
    .filter((c) => c !== "none")
    .map((c) => getDetailedDisabilityConfig(CONDITION_TYPES[c] ?? "other", c));

/**
 * The library exercise that is the same movement as each camera movement. The camera movements keep
 * the camera: they are done in the camera part of a session when the rules include them, and their
 * library copy is never a guided card (so a movement the rules left out does not come back as one).
 */
export const CAMERA_TWINS: Record<string, string> = {
  seated_shoulder_press: "seated_shoulder_press",
  seated_biceps_curl: "seated_bicep_curls",
};
const TWIN_IDS = new Set(Object.values(CAMERA_TWINS));

/**
 * The safe library exercises for an intake (the eligibility rules of the weekly plan). The pool stays
 * the safety base in every build (product v7 contract 2.10), and reads no flag:
 *   1. a draft (a new exercise before its sign off) only with includeDrafts, which only
 *      selectForTargets passes, so the default pool never holds one;
 *   2. the v7 contraindications the intake decides close an exercise, or only its standing or chair
 *      front forms (contraindications.ts); an intake without the v7 fields cannot clear a v7 id or a
 *      hip end range item; a hip replacement under 3 months drops every hip end range item, whatever
 *      limits were ticked. Existing entries carry no v7 id and no hip end range, so v1 pools are
 *      unchanged;
 *   3. for an intake with the v7 fields only, the existing entries' signed off contraindications too
 *      (v7Contraindications, D-025) and the body map's region ids by the regions the exercise works
 *      (regionOpenPositions: a surgery not cleared, an early surgery, a recent injury), so a v7 intake
 *      gets the limits its range protocol keeps (D-026 item 9); a v1 intake never reads them.
 */
export function libraryPool(h: Intake, opts: { includeDrafts?: boolean } = {}): LibraryExercise[] {
  return poolOf(h, opts.includeDrafts === true, false);
}

/**
 * The eligible pool of the v7 program (exercise-targets 5.8 step 1; contract 2.10), for
 * selectForTargets only: libraryPool's rules with the new exercises (drafts), where the two pool rules
 * of the clinical review that would change v1 pools apply (D-023 item 2, gap 4), so libraryPool(h) and
 * every v1 pool stay as they are:
 *   - review C14: an item that also has a seated form keeps it for people who do not stand and for
 *     balance_support (libraryPool hides lying, floor and standing items from them); selectForTargets
 *     then offers that item in its seated form only;
 *   - review C11 and EX-Q19: «without a yes, wheelchair users get only wheelchair friendly items»; with
 *     pc_transfer_chair yes, a seated item too (the person moves to a steady chair).
 */
export function programPool(h: Intake): LibraryExercise[] {
  return poolOf(h, true, true);
}

/** An exercise's seated forms: on a chair, or near its front. */
const SEATED_FORMS: readonly string[] = ["seated", "seated_forward"];

function poolOf(h: Intake, includeDrafts: boolean, program: boolean): LibraryExercise[] {
  const configs = configsFor(h);
  const avoid = new Set(configs.flatMap((c) => c.avoidCategories));
  const highFatigue = configs.some((c) => ["high", "critical"].includes(String(c.fatigueRisk)));
  const painContra = new Set(h.pain.map((p) => `${p}_injury`));
  const has = (r: string) => h.restrictions.includes(r);
  const v7Ids = v7Contraindications(h, null, null);
  const clearsV7 = canClearV7Ids(h);
  const hipReplaced = recentHipReplacement(h);
  return LIBRARY.filter((e) => {
    if (e.status === "draft" && !includeDrafts) return false;
    const hipEndRange = (e.hipEndRange?.length ?? 0) > 0;
    if (!clearsV7 && (hipEndRange || e.contraindications.some((c) => V7_ONLY_IDS.has(c)))) return false;
    if (hipReplaced && hipEndRange) return false;
    const signed = clearsV7 && e.v7Contraindications?.length;
    const open = openPositions(
      signed ? { ...e, contraindications: [...e.contraindications, ...e.v7Contraindications!] } : e,
      v7Ids,
    );
    if (!open) return false;
    if (clearsV7 && !regionOpenPositions({ ...e, positions: open.length ? open : e.positions }, v7Ids))
      return false;
    const seatedOk = e.tags.includes("seated") || e.tags.includes("wheelchair_friendly");
    // The v7 program keeps an item's seated form where libraryPool hides the item (review C14).
    const seatedForm = program && (e.positions ?? []).some((p) => SEATED_FORMS.includes(p));
    const text = `${e.name.en} ${e.description.en} ${e.steps.en.join(" ")}`;
    if (TWIN_IDS.has(e.id)) return false;
    if (avoid.has(e.category) || e.difficulty === "advanced") return false;
    if (highFatigue && e.difficulty !== "beginner") return false;
    if (e.contraindications.some((c) => painContra.has(c))) return false;
    if (h.mobility === "wheelchair") {
      const friendly = e.tags.includes("wheelchair_friendly");
      if (program) {
        if (!friendly && !(h.romFlags?.transferChair === true && seatedOk)) return false;
      } else if (!(friendly || (e.tags.includes("seated") && !e.tags.includes("standing")))) return false;
    }
    if (h.mobility === "seated" && !seatedOk) return false;
    if (
      h.mobility !== "standing" &&
      (e.tags.includes("floor_exercise") || e.tags.includes("lying_down")) &&
      !seatedForm
    )
      return false;
    if (e.equipment.includes("resistance_bands") && !h.equipment.includes("bands")) return false;
    if (e.equipment.includes("dumbbells") && !h.equipment.includes("weights")) return false;
    if (has("no_resistance") && e.equipment.length) return false;
    if (
      has("no_overhead") &&
      (/overhead|above (your|the) head/i.test(text) ||
        (/press|raise/i.test(e.name.en) && e.muscles.includes("shoulders")))
    )
      return false;
    if (
      has("no_weight_bearing") &&
      ((e.tags.includes("standing") && !seatedForm) ||
        (["lower_body", "balance"].includes(e.category) && !seatedOk))
    )
      return false;
    if (
      has("balance_support") &&
      ((e.tags.includes("standing") && !seatedForm) ||
        e.contraindications.includes("severe_balance_issues") ||
        (e.category === "balance" && !seatedOk))
    )
      return false;
    if (h.conditions.includes("upper_limb_unilateral") && e.equipment.length) return false;
    return true;
  });
}
