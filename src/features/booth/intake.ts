/**
 * The booth's intake (booth v2, contract C): the same Intake the portal saves, built on the phone
 * from Saad's story or from the visitor's three taps, so the medical engine (createPlan) and the
 * weekly plan run exactly as at home. Nothing here is stored.
 *
 *   story   the report's reading (conditions, mobility, age, medications, pain, restrictions) and
 *           Saad's own answers (story.ts); never clearance from a report.
 *   self    the condition chips, the position and the weaker side; clearance asked only when the
 *           chosen condition needs it (the same rule as the intake); an optional report photo can
 *           fill the taps first.
 */
import { getDetailedDisabilityConfig } from "../../medical/legacy-config";
import {
  conditions as CONDITIONS,
  createPlan,
  painOptions,
  restrictionOptions,
  types,
  validateIntake,
  type Intake,
  type Plan,
} from "../../medical/plan";
import type { SportId } from "../../medical/sports";
import { SAAD, SAAD_ANSWERS, type BoothExtraction } from "./story";

export type Goal = Intake["goal"];
export type Position = "seated" | "wheelchair" | "standing";
export type Side = "none" | "left" | "right";
export type Clearance = "yes" | "no" | "unsure";

/** The visitor's taps ("Try it as yourself"). */
export interface SelfAnswers {
  conditions: string[];
  clearance: Clearance | null;
  position: Position | null;
  side: Side | null;
}

export const EMPTY_SELF: SelfAnswers = { conditions: [], clearance: null, position: null, side: null };

/**
 * The condition chips of the first tap screen, in the intake's order: "none" first (most visitors),
 * then every listed condition; "other" last.
 */
export const SELF_CONDITIONS: readonly string[] = CONDITIONS;

/** Whether the chosen conditions ask for medical clearance before a plan (the intake's rule). */
export function needsClearance(list: readonly string[]): boolean {
  return list.some(
    (c) => c !== "none" && getDetailedDisabilityConfig(types[c] ?? "other", c).requiresMedicalClearance,
  );
}

/** A tap on a condition chip: "none" stands alone; any condition clears "none". */
export function toggleCondition(list: readonly string[], id: string): string[] {
  if (id === "none") return list.includes("none") ? [] : ["none"];
  const rest = list.filter((c) => c !== "none");
  return rest.includes(id) ? rest.filter((c) => c !== id) : [...rest, id];
}

/** Whether the first tap screen can go on: a condition, and clearance when it is asked. */
export function conditionsDone(a: SelfAnswers): boolean {
  if (!a.conditions.length) return false;
  return !needsClearance(a.conditions) || a.clearance !== null;
}

/** The taps a report photo fills in (the visitor still sees and can change every one). */
export function selfFromExtraction(a: SelfAnswers, x: BoothExtraction): SelfAnswers {
  const e = x.extracted;
  const known = e.conditions.filter((c) => (CONDITIONS as readonly string[]).includes(c) && c !== "none");
  const mobility = e.mobility === "wheelchair" || e.mobility === "standing" ? e.mobility : null;
  const side = e.support === "left" || e.support === "right" ? e.support : null;
  return {
    conditions: known.length ? known : a.conditions,
    clearance: a.clearance,
    position: mobility ?? a.position,
    side: side ?? a.side,
  };
}

type Base = Omit<Intake, "goal" | "sport" | "days" | "sessionMinutes">;

const only = <T extends string>(list: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(list) ? [...new Set(list.filter((v): v is T => allowed.includes(v as T)))] : [];

/** Saad's intake: his report's reading and his own answers. */
export function storyBase(x: BoothExtraction): Base {
  const e = x.extracted;
  const conds = only(e.conditions, CONDITIONS).filter((c) => c !== "none");
  return {
    age: e.age && e.age >= 18 && e.age <= 100 ? e.age : SAAD.age,
    conditions: conds.length ? conds : ["sci_incomplete"],
    diagnosisNotes: e.diagnosisNotes.slice(0, 1200),
    medications: e.medications.slice(0, 1200),
    mobility: e.mobility === "standing" || e.mobility === "seated" ? e.mobility : "wheelchair",
    support: SAAD_ANSWERS.support,
    pain: only(e.pain, painOptions),
    restrictions: only(e.restrictions, restrictionOptions),
    symptoms: SAAD_ANSWERS.symptoms,
    recentChange: SAAD_ANSWERS.recentChange,
    clearance: SAAD_ANSWERS.clearance,
    equipment: [...SAAD_ANSWERS.equipment],
    time: SAAD_ANSWERS.time,
    consent: true,
  };
}

/**
 * A visitor's intake from the three taps (and a report photo, when one was read). Age is not asked
 * at the booth: a report's age is used, otherwise an adult placeholder (the plan never reads it).
 * No weights at the booth: equipment stays empty.
 */
export function selfBase(a: SelfAnswers, x?: BoothExtraction | null): Base {
  const e = x?.extracted;
  const conds = a.conditions.length ? a.conditions : ["none"];
  return {
    age: e?.age && e.age >= 18 && e.age <= 100 ? e.age : 30,
    conditions: conds,
    diagnosisNotes: e?.diagnosisNotes.slice(0, 1200) ?? "",
    medications: e?.medications.slice(0, 1200) ?? "",
    mobility: a.position ?? "seated",
    support: a.side ?? "none",
    pain: only(e?.pain, painOptions),
    restrictions: only(e?.restrictions, restrictionOptions),
    symptoms: "no",
    recentChange: "no",
    clearance: needsClearance(conds) ? (a.clearance ?? "unsure") : "unsure",
    equipment: [],
    time: "17:00",
    consent: true,
  };
}

/**
 * The schedule the booth proposes: three days a week a day apart, or fewer when the condition's
 * recovery interval or session time asks for it. The first schedule the rules accept wins; the
 * plan keeps any other reason it has.
 */
const SCHEDULES: { days: number[]; sessionMinutes: number }[] = [
  { days: [0, 2, 4], sessionMinutes: 30 },
  { days: [0, 3], sessionMinutes: 30 },
  { days: [3], sessionMinutes: 30 },
  { days: [0, 2, 4], sessionMinutes: 40 },
  { days: [0, 3], sessionMinutes: 20 },
];

/** The intake and its plan for a goal (createPlan runs on the phone, the same rules as at home). */
export function planFor(base: Base, goal: Goal, sport?: SportId | null): { intake: Intake; plan: Plan } {
  // The sport goal without its sport yet (the grid is open): the plan is read as strength meanwhile.
  const g: Goal = goal === "sport" && !sport ? "strength" : goal;
  const withGoal = { ...base, goal: g, ...(g === "sport" && sport ? { sport } : {}) };
  let first: { intake: Intake; plan: Plan } | null = null;
  for (const s of SCHEDULES) {
    const intake = { ...withGoal, ...s } as Intake;
    if (!validateIntake(intake)) continue;
    const plan = createPlan(intake);
    const out = { intake, plan };
    first ??= out;
    if (!plan.reasons.includes("recovery") && !plan.reasons.includes("duration")) return out;
  }
  if (!first) throw new Error("INVALID_INTAKE");
  return first;
}
