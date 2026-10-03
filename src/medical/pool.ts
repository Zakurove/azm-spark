import library from "../exercises/library.json";
import { getDetailedDisabilityConfig } from "./legacy-config";
import type { DisabilityType } from "./legacy-types";
import type { Intake } from "./plan";
import type { DemandTag } from "./sports";

/**
 * The Azm exercise library and which of it is safe for a person: the rules, before any model. The
 * plan reads it to know a program is never empty while the library has safe exercises (booth v2, D),
 * and the weekly plan arranges it.
 */

export type L = { ar: string; en: string };
export interface LibraryExercise {
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

/** The safe library exercises for an intake (the eligibility rules of the weekly plan). */
export function libraryPool(h: Intake): LibraryExercise[] {
  const configs = configsFor(h);
  const avoid = new Set(configs.flatMap((c) => c.avoidCategories));
  const highFatigue = configs.some((c) => ["high", "critical"].includes(String(c.fatigueRisk)));
  const painContra = new Set(h.pain.map((p) => `${p}_injury`));
  const has = (r: string) => h.restrictions.includes(r);
  return LIBRARY.filter((e) => {
    const seatedOk = e.tags.includes("seated") || e.tags.includes("wheelchair_friendly");
    const text = `${e.name.en} ${e.description.en} ${e.steps.en.join(" ")}`;
    if (TWIN_IDS.has(e.id)) return false;
    if (avoid.has(e.category) || e.difficulty === "advanced") return false;
    if (highFatigue && e.difficulty !== "beginner") return false;
    if (e.contraindications.some((c) => painContra.has(c))) return false;
    if (
      h.mobility === "wheelchair" &&
      !(e.tags.includes("wheelchair_friendly") || (e.tags.includes("seated") && !e.tags.includes("standing")))
    )
      return false;
    if (h.mobility === "seated" && !seatedOk) return false;
    if (h.mobility !== "standing" && (e.tags.includes("floor_exercise") || e.tags.includes("lying_down")))
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
      (e.tags.includes("standing") || (["lower_body", "balance"].includes(e.category) && !seatedOk))
    )
      return false;
    if (
      has("balance_support") &&
      (e.tags.includes("standing") ||
        e.contraindications.includes("severe_balance_issues") ||
        (e.category === "balance" && !seatedOk))
    )
      return false;
    if (h.conditions.includes("upper_limb_unilateral") && e.equipment.length) return false;
    return true;
  });
}
