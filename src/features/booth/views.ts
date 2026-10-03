/**
 * What the booth screens show, as pure functions of the reading, the intake and the plan (contract
 * C2, C3, C7), so the words and the numbers are tested without a browser.
 *
 *   readingChips  step 1: what the report reading found, one chip per field, in reading order
 *   engineView    step 2: included (the camera movements and the library count), adapted (the dose
 *                 the condition changed, against the base dose), excluded with a short reason
 *   cameraWeek    step 6: each training day with its camera movements and its library exercises
 */
import { EXERCISES } from "../../exercises/defs";
import { optionNames } from "../../app/platform-copy";
import { formatNumber } from "../../i18n";
import type { Lang } from "../../app/i18n";
import type { Intake, Plan } from "../../medical/plan";
import { eligibleExercises, libraryById, type WeeklyPlan } from "../../medical/weekly";
import { boothCopy } from "./copy";
import type { BoothExtraction } from "./story";

const num = (lang: Lang, n: number) => formatNumber(lang, n);
const name = (key: string, lang: Lang) => optionNames[key]?.[lang] ?? key;

/* ------------------------------------------------------------------ step 1 */

export type ChipKind = "age" | "condition" | "mobility" | "pain" | "restrictions" | "medications";
export interface ReadingChip {
  kind: ChipKind;
  label: string;
  value: string;
}

/** The chips of a report reading, in the order they appear (conditions first after the age). */
export function readingChips(x: BoothExtraction, lang: Lang): ReadingChip[] {
  const k = boothCopy(lang),
    e = x.extracted;
  const out: ReadingChip[] = [];
  if (e.age) out.push({ kind: "age", label: k.chip.age, value: k.ageValue(num(lang, e.age)) });
  for (const c of e.conditions)
    out.push({ kind: "condition", label: k.chip.condition, value: name(c, lang) });
  if (k.mobilityValue[e.mobility])
    out.push({ kind: "mobility", label: k.chip.mobility, value: k.mobilityValue[e.mobility] });
  out.push({
    kind: "pain",
    label: k.chip.pain,
    value: e.pain.length ? e.pain.map((p) => name(p, lang)).join(lang === "ar" ? "، " : ", ") : k.noPain,
  });
  if (e.restrictions.length)
    out.push({
      kind: "restrictions",
      label: k.chip.restrictions,
      value: e.restrictions.map((r) => name(r, lang)).join(lang === "ar" ? "، " : ", "),
    });
  if (e.medications.trim())
    out.push({ kind: "medications", label: k.chip.medications, value: e.medications.trim().slice(0, 60) });
  return out;
}

/* ------------------------------------------------------------------ step 2 */

/** The dose a movement starts from before a condition adapts it (plan.ts and legacy-config.ts). */
export const BASE_DOSE = { rest: 30, sets: 3, reps: 10 } as const;

export interface EngineItem {
  id: string;
  title: string;
  /** A large value (adapted items) and what it replaces. */
  value?: string;
  base?: string;
  note?: string;
}

export interface EngineView {
  status: Plan["status"];
  included: EngineItem[];
  /** The library exercises the rules allow besides the camera movements. */
  library: number;
  adapted: EngineItem[];
  excluded: EngineItem[];
  /** The reasons a plan is held for review (plan.reasons, as the portal words them). */
  review: string[];
}

const exerciseName = (id: string, lang: Lang) => EXERCISES.find((e) => e.id === id)?.name[lang] ?? id;

/** A short reason for a movement the rules left out, for this person. */
function shortReason(reason: string, intake: Intake, lang: Lang): string {
  const k = boothCopy(lang);
  switch (reason) {
    case "standing":
      return intake.mobility === "wheelchair" ? k.notForWheelchair : k.notSeated;
    case "resistance":
      return k.needsWeights;
    case "overhead":
      return k.overhead;
    case "pain_upper":
      return k.painUpper;
    case "tracking_limbs":
      return k.limbs;
    default:
      return reason;
  }
}

export function engineView(
  intake: Intake,
  plan: Plan,
  lang: Lang,
  reasonText: Record<string, { ar: string; en: string }>,
): EngineView {
  const k = boothCopy(lang);
  if (plan.status === "review")
    return {
      status: "review",
      included: [],
      library: 0,
      adapted: [],
      excluded: [],
      review: plan.reasons.map((r) => reasonText[r]?.[lang] ?? r),
    };
  const included = plan.exercises.map((e) => ({ id: e.exerciseId, title: exerciseName(e.exerciseId, lang) }));
  const library = eligibleExercises(intake, plan).filter(
    (x) => !plan.exercises.some((e) => e.exerciseId === x.id),
  ).length;
  const first = plan.exercises[0];
  const adapted: EngineItem[] = [];
  if (first && first.restSeconds > BASE_DOSE.rest)
    adapted.push({
      id: "rest",
      title: k.restLonger,
      value: k.restValue(num(lang, first.restSeconds)),
      base: k.restBase(num(lang, BASE_DOSE.rest)),
    });
  const upper = plan.exercises.find((e) => e.exerciseId !== "sit_to_stand");
  if (upper && (upper.sets < BASE_DOSE.sets || upper.reps < BASE_DOSE.reps))
    adapted.push({
      id: "dose",
      title: k.lighterDose,
      note: k.doseNote,
      value: k.dose(upper.sets, upper.reps),
      base: k.doseBase(BASE_DOSE.sets, BASE_DOSE.reps),
    });
  if (plan.recoveryHours >= 48) adapted.push({ id: "recovery", title: k.restDay });
  if (plan.notes.includes("temperature")) adapted.push({ id: "temperature", title: k.heat });
  else if (plan.notes.includes("fatigue")) adapted.push({ id: "fatigue", title: k.calmPace });
  if (!adapted.length) adapted.push({ id: "same", title: k.sameDose });
  const excluded = plan.exclusions.map((x) => ({
    id: x.exerciseId,
    title: exerciseName(x.exerciseId, lang),
    note: shortReason(x.reason, intake, lang),
  }));
  return { status: "ready", included, library, adapted: adapted.slice(0, 4), excluded, review: [] };
}

/* ------------------------------------------------------------------ step 6 */

export interface WeekDay {
  day: number;
  focus: string;
  camera: string[];
  extra: string[];
}

/** The week as the booth shows it: each day's focus, its camera movements, and up to 2 extras. */
export function cameraWeek(plan: Plan, weekly: WeeklyPlan | null, lang: Lang): WeekDay[] {
  const camera = plan.exercises.map((e) => exerciseName(e.exerciseId, lang));
  return (weekly?.days ?? []).map((d) => ({
    day: d.day,
    focus: d.focus[lang],
    camera,
    extra: d.extra
      .map((i) => libraryById(i.id)?.name[lang])
      .filter((n): n is string => !!n)
      .slice(0, 2),
  }));
}
