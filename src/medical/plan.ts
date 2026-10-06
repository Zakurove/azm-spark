import {
  adjustReps,
  adjustSets,
  calculateRestTime,
  getDetailedDisabilityConfig,
  getMinimumRecoveryHours,
} from "./legacy-config";
import { Setup } from "../app/product";
import { CAMERA_TWINS, CONDITION_TYPES, libraryById, libraryPool } from "./pool";
import { regionOpenPositions, v7Contraindications, type RegionIdKind } from "./contraindications";
import { CAMERA_DEMANDS, isSportId, sportById, type SportId } from "./sports";
import {
  REGION_PAIN_IDS,
  painIdsFromRegions,
  validateRegions,
  type ProblemType,
  type RegionEntry,
  type RomIntakeFlags,
} from "./body-map";
export const conditions = [
  "none",
  "stroke",
  "ms",
  "cerebral_palsy",
  "sci_complete",
  "sci_incomplete",
  "parkinsons",
  "lower_limb_unilateral",
  "upper_limb_unilateral",
  "arthritis",
  "cfs_moderate",
  "cardiac",
  "other",
] as const;
export const painOptions = ["shoulder", "elbow", "wrist", "back", "hip", "knee"] as const;
/**
 * The equipment question (booth v2, B6): weights and bands. A stable chair is assumed, so it is no
 * longer asked; "chair" stays valid because profiles saved before the change hold it.
 */
export const equipmentOptions = ["weights", "bands"] as const;
const EQUIPMENT_VALUES = ["chair", ...equipmentOptions] as const;
export const goalOptions = ["mobility", "strength", "habit", "sport"] as const;
export const restrictionOptions = [
  "no_overhead",
  "no_resistance",
  "no_weight_bearing",
  "no_exercise",
  "balance_support",
] as const;
/** v7 (D-019): sex for the normal values of range of motion (product v7 contract 2.2). */
export const sexOptions = ["male", "female"] as const;
export type Sex = (typeof sexOptions)[number];
/** v7 walking question: the aid the person walks with. */
export const walkingAids = ["cane", "crutches", "walker", "other"] as const;
export type WalkingAid = (typeof walkingAids)[number];
export type Walking = { status: "no" } | { status: "with_aid"; aid: WalkingAid } | { status: "without_aid" };
/** The v7 height answer, whole centimetres (gait-rules Q4). */
export const HEIGHT_CM = { min: 120, max: 220 } as const;

export interface Intake {
  age: number;
  conditions: string[];
  diagnosisNotes: string;
  medications: string;
  mobility: "seated" | "wheelchair" | "standing" | "bed";
  support: "none" | "left" | "right";
  pain: string[];
  restrictions: string[];
  symptoms: "yes" | "no";
  recentChange: "yes" | "no";
  clearance: "yes" | "no" | "unsure";
  equipment: string[];
  goal: (typeof goalOptions)[number];
  /** The para sport of the goal «العودة إلى الرياضة»: present with that goal, and only with it. */
  sport?: SportId;
  days: number[];
  time: string;
  sessionMinutes: number;
  consent: boolean;
  /** v7 (D-019), for the normal values. Optional in the type so intakes saved before v7 still load. */
  sex?: Sex;
  /** v7 body map. [] means no affected region. */
  regions?: RegionEntry[];
  /** v7 walking question. */
  walking?: Walking;
  /** v7, optional: height in whole cm (gait scaling, gait-rules Q4). 120 to 220. */
  heightCm?: number;
  /** v7 safety answers that shape the range protocol (rom-protocol 2.2 and 6). */
  romFlags?: RomIntakeFlags;
}
export interface Prescription {
  exerciseId: string;
  setup: Setup;
  sets: number;
  reps: number;
  restSeconds: number;
  reason: string;
}
export interface Plan {
  status: "ready" | "review";
  reasons: string[];
  notes: string[];
  exclusions: { exerciseId: string; reason: string }[];
  exercises: Prescription[];
  days: number[];
  time: string;
  warmUpMinutes: number;
  coolDownMinutes: number;
  estimatedMinutes: number;
  recoveryHours: number;
  /**
   * The rules' rest between sets, for the guided cards of a session too (booth v2, D). Plans saved
   * before it read the rest of their first camera movement.
   */
  restSeconds?: number;
  version?: number;
  /** Epoch ms the profile was saved with this plan (C46: a first check within 24 hours skips S13). */
  created?: number;
  weekly?: import("./weekly").WeeklyPlan;
}
/** The legacy disability type of each condition (pool.ts keeps the table). */
export const types = CONDITION_TYPES;
export function validateIntake(v: unknown): v is Intake {
  if (!v || typeof v !== "object") return false;
  const x = v as Intake;
  const list = (v: unknown, allowed: readonly unknown[], min = 0) =>
    Array.isArray(v) &&
    v.length >= min &&
    v.length <= allowed.length &&
    new Set(v).size === v.length &&
    v.every((a) => allowed.includes(a));
  return (
    Number.isInteger(x.age) &&
    x.age >= 18 &&
    x.age <= 100 &&
    list(x.conditions, conditions, 1) &&
    !(x.conditions.length > 1 && x.conditions.includes("none")) &&
    ["diagnosisNotes", "medications"].every(
      (k) =>
        typeof (x as unknown as Record<string, unknown>)[k] === "string" &&
        (x as unknown as Record<string, string>)[k].length <= 1200,
    ) &&
    ["seated", "wheelchair", "standing", "bed"].includes(x.mobility) &&
    ["none", "left", "right"].includes(x.support) &&
    list(x.pain, painOptions) &&
    list(x.restrictions, restrictionOptions) &&
    ["yes", "no"].includes(x.symptoms) &&
    ["yes", "no"].includes(x.recentChange) &&
    ["yes", "no", "unsure"].includes(x.clearance) &&
    list(x.equipment, EQUIPMENT_VALUES) &&
    (goalOptions as readonly string[]).includes(x.goal) &&
    (x.goal === "sport" ? isSportId(x.sport) : x.sport === undefined) &&
    list(x.days, [0, 1, 2, 3, 4, 5, 6], 1) &&
    x.days.length <= 4 &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time) &&
    [20, 30, 40].includes(x.sessionMinutes) &&
    x.consent === true &&
    validV7Fields(x)
  );
}
/** True when the intake has every field the focus check needs (sex, regions, walking). */
export function hasV7Fields(h: Intake): h is Intake & Required<Pick<Intake, "sex" | "regions" | "walking">> {
  return h.sex !== undefined && h.regions !== undefined && h.walking !== undefined;
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).every((k) => keys.includes(k));
function validWalking(v: unknown): v is Walking {
  if (!isRecord(v)) return false;
  if (v.status === "with_aid")
    return onlyKeys(v, ["status", "aid"]) && (walkingAids as readonly unknown[]).includes(v.aid);
  return (v.status === "no" || v.status === "without_aid") && onlyKeys(v, ["status"]);
}
const ROM_FLAG_KEYS = [
  "osteoporosis",
  "neckCaution",
  "inflammatoryArthritis",
  "neckCleared",
  "footLift",
  "transferChair",
  "sitUnsupported",
];
function validRomFlags(v: unknown): v is RomIntakeFlags {
  if (!isRecord(v) || !onlyKeys(v, ROM_FLAG_KEYS)) return false;
  const optional = (k: string, ok: (x: unknown) => boolean) => v[k] === undefined || ok(v[k]);
  const bool = (x: unknown) => typeof x === "boolean";
  const yesNoUnsure = (x: unknown) => x === "yes" || x === "no" || x === "unsure";
  return (
    bool(v.osteoporosis) &&
    bool(v.neckCaution) &&
    optional("inflammatoryArthritis", yesNoUnsure) &&
    optional("neckCleared", bool) &&
    optional(
      "footLift",
      (f) => isRecord(f) && onlyKeys(f, ["left", "right"]) && Object.values(f).every(bool),
    ) &&
    optional("transferChair", bool) &&
    optional("sitUnsupported", yesNoUnsure)
  );
}
/**
 * The v7 fields (product v7 contract 2.2), each validated only when present, so an intake saved
 * before v7 passes exactly as before; the server applies this whether or not AZM_V7 is on. Cross
 * field rules: mobility bed walks no; and the pain mirror, every body map entry with pain or injury
 * in a region that has a v1 pain id appears in pain[], which the v1 pool exclusions read.
 */
function validV7Fields(x: Intake): boolean {
  const v = x as unknown as Record<string, unknown>;
  const present = (k: keyof Intake) => v[k] !== undefined;
  if (present("sex") && !(sexOptions as readonly unknown[]).includes(v.sex)) return false;
  if (present("regions") && !validateRegions(v.regions)) return false;
  if (present("walking") && !validWalking(v.walking)) return false;
  if (
    present("heightCm") &&
    !(
      Number.isInteger(v.heightCm) &&
      (v.heightCm as number) >= HEIGHT_CM.min &&
      (v.heightCm as number) <= HEIGHT_CM.max
    )
  )
    return false;
  if (present("romFlags") && !validRomFlags(v.romFlags)) return false;
  if (x.walking && x.mobility === "bed" && x.walking.status !== "no") return false;
  if (x.regions && !painIdsFromRegions(x.regions).every((id) => x.pain.includes(id))) return false;
  return true;
}
/**
 * The v7 fields a form without them keeps in line with the v1 answers (Gate A review, D-024). A
 * default build's intake form spreads a saved v7 intake into its draft, so the body map and the
 * walking answer travel back unseen while mobility and pain[] stay editable, and the cross field
 * rules would then refuse an intake the person has no way to fix. Rule 1: mobility bed walks no.
 * Rule 3: a v1 pain area missing from pain[] (the person unticked it) takes pain and injury, with
 * the injury answers, off the body map entries of its region, and an entry left with no problem is
 * dropped. An intake without the v7 fields, or one that keeps both rules, comes back as it is.
 */
export function reconcileV7Fields<
  T extends { mobility: string; pain: readonly string[]; regions?: RegionEntry[]; walking?: Walking },
>(x: T): T {
  let out = x;
  if (x.walking && x.mobility === "bed" && x.walking.status !== "no") {
    const walking: Walking = { status: "no" };
    out = { ...out, walking };
  }
  const unticked = (e: RegionEntry) => {
    const id = REGION_PAIN_IDS[e.region];
    return id !== undefined && !x.pain.includes(id);
  };
  const mirrored = (p: ProblemType) => p === "pain" || p === "injury";
  if (x.regions?.some((e) => unticked(e) && e.problems.some(mirrored))) {
    const regions = x.regions.flatMap((e): RegionEntry[] => {
      if (!unticked(e) || !e.problems.some(mirrored)) return [e];
      const problems = e.problems.filter((p) => !mirrored(p));
      if (!problems.length) return [];
      const kept: RegionEntry = { ...e, problems };
      delete kept.injury;
      return [kept];
    });
    out = { ...out, regions };
  }
  return out;
}
export function scheduleFits(days: number[], recoveryHours: number) {
  const s = [...days].sort((a, b) => a - b);
  return s.every((d, i) => (s[(i + 1) % s.length] - d + 7 || 7) * 24 >= recoveryHours);
}
/**
 * The body map's region ids the camera part reads (D-029 item 1, E2-8): a surgery not cleared under
 * 3 months, a surgery under 12 weeks, an injury under 6 weeks. Only a v7 intake has a body map, so a v1
 * intake holds none.
 */
const CAMERA_REGION_KINDS: readonly RegionIdKind[] = [
  "region_not_cleared",
  "region_early_post_op",
  "region_acute_injury",
];
function recentRegionIds(h: Intake): Set<string> {
  if (!h.regions?.length) return new Set();
  return new Set(
    [...v7Contraindications(h, null, null)].filter((id) =>
      CAMERA_REGION_KINDS.some((kind) => id.startsWith(`${kind}:`)),
    ),
  );
}

/**
 * Why a camera movement is left out for this intake ("" when it is not). The last rule that applies
 * names the reason, as before. A stable chair is assumed (booth v2, B6), so no movement waits for a
 * chair tick any more. v7 (D-029 item 1, E2-8): a recent surgery or injury on the body map closes the
 * camera movements of that region as the library's region rules close an exercise (regionOpenPositions,
 * read on the movement's library entry: the regions of its targets, its load, not pain friendly), and
 * names the reason, since it is the reason that matters most.
 */
function exclusionOf(id: string, h: Intake): string {
  let excluded = "";
  const upper = id !== "sit_to_stand";
  if (upper && h.conditions.includes("upper_limb_unilateral")) excluded = "tracking_limbs";
  if (upper && h.pain.some((p) => ["shoulder", "elbow", "wrist", "back"].includes(p)))
    excluded = "pain_upper";
  if (id === "seated_shoulder_press" && h.restrictions.includes("no_overhead")) excluded = "overhead";
  if (
    id === "seated_biceps_curl" &&
    (!h.equipment.includes("weights") || h.restrictions.includes("no_resistance"))
  )
    excluded = "resistance";
  if (
    !upper &&
    (h.mobility !== "standing" ||
      h.restrictions.some((r) => ["no_weight_bearing", "balance_support"].includes(r)) ||
      h.pain.some((p) => ["hip", "knee", "back"].includes(p)) ||
      h.conditions.includes("lower_limb_unilateral"))
  )
    excluded = "standing";
  const recent = recentRegionIds(h);
  const entry = libraryById(CAMERA_TWINS[id] ?? id);
  if (recent.size && entry && regionOpenPositions(entry, recent) === null) excluded = "region_recent";
  return excluded;
}
export function createPlan(h: Intake): Plan {
  if (!validateIntake(h)) throw new Error("INVALID_INTAKE");
  const configs = h.conditions.map((c) => getDetailedDisabilityConfig(types[c] ?? "other", c));
  const reasons: string[] = [],
    notes: string[] = [];
  const rest = Math.max(...configs.map((c) => calculateRestTime(30, c)));
  const recovery = Math.max(...configs.map(getMinimumRecoveryHours));
  const warm = Math.max(...configs.map((c) => c.warmUpMinutes)),
    cool = Math.max(...configs.map((c) => c.coolDownMinutes));
  if (h.conditions.includes("cardiac")) reasons.push("cardiac");
  if (h.symptoms === "yes") reasons.push("symptoms");
  if (h.recentChange === "yes") reasons.push("recent_change");
  if (h.restrictions.includes("no_exercise")) reasons.push("restriction");
  if (h.conditions.includes("other")) reasons.push("unknown_condition");
  if (configs.some((c) => c.requiresMedicalClearance) && h.clearance !== "yes") reasons.push("clearance");
  if (configs.some((c) => c.postExertionalMalaiseRisk)) reasons.push("pem");
  if (h.mobility === "bed") reasons.push("unsupported_position");
  if (!scheduleFits(h.days, recovery)) reasons.push("recovery");
  if (configs.some((c) => c.thermoregulationWarning)) notes.push("temperature");
  if (configs.some((c) => c.fatigueRisk === "high")) notes.push("fatigue");
  if (h.clearance === "yes") notes.push("self_reported_clearance");
  if (h.medications.trim()) notes.push("medications_recorded");
  const p: Plan = {
    status: "ready",
    reasons,
    notes,
    exclusions: [],
    exercises: [],
    days: [...h.days].sort((a, b) => a - b),
    time: h.time,
    warmUpMinutes: warm,
    coolDownMinutes: cool,
    estimatedMinutes: 0,
    recoveryHours: recovery,
    restSeconds: rest,
  };
  const candidate = ["seated_shoulder_press", "seated_biceps_curl", "sit_to_stand"];
  for (const id of candidate) {
    const excluded = exclusionOf(id, h);
    const upper = id !== "sit_to_stand";
    if (excluded) {
      p.exclusions.push({ exerciseId: id, reason: excluded });
      continue;
    }
    const sets = Math.min(...configs.map((c) => adjustSets(3, c))),
      reps = Math.min(...configs.map((c) => adjustReps(upper ? 10 : 5, c)), upper ? 10 : 5);
    p.exercises.push({
      exerciseId: id,
      setup: {
        position: upper ? (h.mobility === "wheelchair" ? "wheelchair" : "chair") : "rise",
        support: h.support,
      },
      sets,
      reps,
      restSeconds: rest,
      reason: upper ? "seated_match" : "standing_match",
    });
  }
  // Equipment alone never ends in review (B6): when the only thing holding the curl back is that there
  // are no weights, and nothing else is left, the curl is done without weights or with something light.
  const curl = "seated_biceps_curl";
  if (
    !p.exercises.length &&
    !h.equipment.includes("weights") &&
    exclusionOf(curl, { ...h, equipment: [...h.equipment, "weights"] }) === ""
  ) {
    p.exclusions = p.exclusions.filter((e) => e.exerciseId !== curl);
    p.exercises.push({
      exerciseId: curl,
      setup: { position: h.mobility === "wheelchair" ? "wheelchair" : "chair", support: h.support },
      sets: Math.min(...configs.map((c) => adjustSets(3, c))),
      reps: Math.min(...configs.map((c) => adjustReps(10, c)), 10),
      restSeconds: rest,
      reason: "curl_unloaded",
    });
  }
  // A program is never empty for lack of camera movements (booth v2, D): the session is then made of
  // guided cards from the library. Only when the library has nothing safe either is it reviewed.
  if (!p.exercises.length && !libraryPool(h).length) reasons.push("no_exercises");
  // Goal changes order, never overrides the safety filter.
  if (h.goal === "mobility")
    p.exercises.sort(
      (a, b) => Number(b.exerciseId === "sit_to_stand") - Number(a.exerciseId === "sit_to_stand"),
    );
  // The sport goal: the movements that build more of the sport's demands come first (stable sort).
  const sport = h.goal === "sport" ? sportById(h.sport) : undefined;
  if (sport) {
    const builds = (id: string) => (CAMERA_DEMANDS[id] ?? []).filter((d) => sport.demands.includes(d)).length;
    p.exercises.sort((a, b) => builds(b.exerciseId) - builds(a.exerciseId));
  }
  const duration = () =>
    warm +
    cool +
    p.exercises.reduce((n, e) => n + (e.sets * e.reps * 4 + (e.sets - 1) * e.restSeconds) / 60, 0);
  const limit = Math.min(h.sessionMinutes, ...configs.map((c) => c.maxSessionMinutes));
  while (duration() > limit && p.exercises.some((e) => e.sets > 1)) {
    const e = [...p.exercises].reverse().find((e) => e.sets > 1)!;
    e.sets--;
  }
  if (duration() > limit) reasons.push("duration");
  p.estimatedMinutes = Math.ceil(duration());
  if (reasons.length) {
    p.status = "review";
    p.exercises = [];
  }
  return p;
}
