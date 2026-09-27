/**
 * Movement check pre-check, between tests question, after check question and stop routing
 * (contract v2, section C; clinical spec 2.1 to 2.7 and the stop list of 4.0).
 *
 * Pure TypeScript, no DOM and no window: the client runs it to drive the questions, and the server
 * runs evaluatePrecheck again on the raw answers and never trusts a client outcome. Raw answers are
 * never stored: `stored` holds only the data map fields of spec 2.1 ("Kept with the check").
 *
 * Rules before AI: every decision here is a fixed rule. Values (thresholds, screens, reasons,
 * locks, which tests an area loads) come from src/movements/check-v1.json. Rules the data only
 * describes in prose (helper rules, hands allowed chair stand, arm curl load rules, warnings) are
 * written by hand from the spec and cite it.
 *
 * Question ids. A question asked once is its data id (pc_urgent). A question asked per area, per
 * side, per test or per sub question has an instance id `<data id>:<part>`:
 *   pc_surgery_recent:areas              chosen surgery areas (string[] of surgeryAreas ids)
 *   pc_surgery_recent:<surgery area id>  clearance for that area ('yes' | 'no')
 *   pc_arthritis_flare:areas             chosen flare areas (string[] of areas ids)
 *   pc_arm_pain_side:<shoulder|elbow|wrist>  'right' | 'left' | 'both'
 *   pc_arm_function:<right|left>         'bend_hold' | 'bend_no_hold' | 'no_bend'
 *   pc_steadi:<fell|unsteady|worry>      'yes' | 'no'
 *   pc_helper:<test id>                  'yes' | 'no'
 * Answer formats: option values as strings; pc_pain_now an integer 0 to 10; pc_pain_areas an object
 * { <area id>: integer 0 to 10 } (only the chosen areas; {} when none of the listed areas hurts);
 * pc_sci_ready true when every box is ticked, or the list of ticked item indexes as strings
 * ("0" to "5"); pc_booth_vitals (staff entry) { restingHeartRate, systolic, diastolic } or
 * 'unavailable' (no validated cuff or no trained staff member). An answer that does not fit is
 * treated as not answered. Answers to questions that are not visible are ignored.
 */
import { CHECK_DATA, testDef } from "../movements/assessments";
import {
  AREA_IDS,
  SURGERY_AREA_IDS,
  type ActionIf,
  type ActionVariant,
  type AreaId,
  type AreaLoad,
  type LockKind,
  type LockReasonId,
  type PdDoseBucket,
  type PostponeReasonId,
  type PrecheckFlag,
  type PrecheckId,
  type PrecheckItem,
  type QuestionAction,
  type ReasonId,
  type ScreenId,
  type ShowIf,
  type Side,
  type StopOptionId,
  type StoreKey,
  type SurgeryAreaId,
  type TestId,
  type TestRef,
  type TestTargets,
} from "../movements/types";
import type { CheckContext, Setting, StoredSetup } from "./assessment";

/* ------------------------------------------------------------------ types */

export type AnswerValue = boolean | number | string | string[] | Record<string, number>;
export type Answers = Record<string, AnswerValue>;
export type TestSide = Side | "none";

export interface PrecheckEnv {
  setting: Setting;
  ctx: CheckContext;
  /** The stored setup of the series; null before the first check. */
  setup: StoredSetup | null;
  /** First check of the series: the baseline setup questions are asked. */
  firstCheck: boolean;
  /** A changeReported date without a later changeCleared date (spec 2.2 pc_change). */
  unresolvedChangeReported: boolean;
  /** The last check had a lasting ac_next_day answer that is not resolved yet. */
  lastCheckLasting: boolean;
  /** Test ids of the base selection (spec 3.2, after intake exclusions and substitution). */
  baseTests: string[];
  /**
   * The person has done the seated side lean in a completed home check before. Spec 4.3 requires a
   * helper for "everyone's first home side lean", which the contract env cannot tell apart from a
   * later one.
   */
  // SPEC-GAP: first-home-side-lean. Missing means not known, and the helper is then required
  // (the safe reading); the server should pass it from the stored results.
  sideLeanDoneAtHome?: boolean;
  /**
   * The last chair stand in this setting stopped because the person needed their hands (reason
   * needed_arms after pushedAsk yes): spec 4.4 "the next check offers arms_assisted".
   */
  // SPEC-GAP: needed-arms-env. The contract env has no field for it; missing means no. The server
  // passes it from the stored results.
  neededArmsLastStand?: boolean;
}

export type PrecheckStatus = "proceed" | "postpone" | "emergency" | "ad" | "incomplete";

/** A same day lock; until null means no lock (pc_sci_ready: allowed as soon as every box is ticked). */
export interface CheckLock {
  reason: LockReasonId;
  until: LockKind | null;
}

export interface SkipItem {
  testId: TestId;
  side: TestSide;
  /** Reason id of spec 3.6. */
  reason: ReasonId;
}

/**
 * Variants decided for today. One main variant per test and side at most (arm_only,
 * cuff_or_arm_only, arms_assisted, arms_assisted_steady, one_arm_cross; none means the default:
 * the chosen load for the arm curl, standard for the chair stand), plus for the chair stand at most
 * one push modifier (push_left_hand_only or push_right_hand_only: the hands allowed version pushes
 * with that hand only, stored as pushHand).
 */
// SPEC-GAP: push-modifier-ids. The data has push_stronger_hand_only (pc_weak_shoulder) and the prose
// action "push with the other hand only" (areas); both are resolved here to the hand that pushes.
export type DayVariant =
  | "arm_only"
  | "cuff_or_arm_only"
  | "arms_assisted"
  | "arms_assisted_steady"
  | "one_arm_cross"
  | "push_left_hand_only"
  | "push_right_hand_only";
export const PUSH_HAND_VARIANTS = ["push_left_hand_only", "push_right_hand_only"] as const;

export interface VariantItem {
  testId: TestId;
  side: TestSide;
  variant: DayVariant;
}

/**
 * The data map of spec 2.1, "Kept with the check". Nothing else from the pre-check may be stored.
 * The pre-check fills the first eleven; faceCovered comes from the setup check, followUp from
 * ac_next_day and the consent from the consent record.
 */
export const DATA_MAP_KEYS = [
  "painNow",
  "setup.painSides",
  "setup.limbLoss",
  "setup.sciT6",
  "fingerprint.armProsthesis",
  "fingerprint.legProsthesis",
  "fingerprint.pdState",
  "fingerprint.pdDoseBucket",
  "fingerprint.helperPresent",
  "changeCleared",
  "changeReported",
  "fingerprint.faceCovered",
  "assessment.followUp",
  "consent.acceptedAt",
  "consent.version",
] as const;
export type DataMapKey = (typeof DATA_MAP_KEYS)[number];

/** What the pre-check keeps with the check. Dates are calendar days in Asia/Riyadh (YYYY-MM-DD). */
export interface StoredPrecheck {
  painNow?: number;
  "setup.painSides"?: Side[];
  "setup.limbLoss"?: { arm?: Side; leg?: Side };
  "setup.sciT6"?: boolean;
  "fingerprint.armProsthesis"?: boolean;
  "fingerprint.legProsthesis"?: boolean;
  /** Only "unsure" is recorded (pc_pd_on); "no" postpones, so no value means the medicines work. */
  "fingerprint.pdState"?: "unsure";
  "fingerprint.pdDoseBucket"?: PdDoseBucket;
  /** Tests for which a helper was confirmed (pc_helper yes). */
  "fingerprint.helperPresent"?: TestId[];
  changeCleared?: string;
  changeReported?: string;
}

export interface PrecheckOutcome {
  status: PrecheckStatus;
  /** Postpone reason id (spec 2.1), or urgent (emergency) or ad (AD response). */
  reason?: PostponeReasonId | "urgent" | "ad";
  /** The screen to show. */
  screen?: ScreenId;
  /**
   * Screens shown with `screen` (scr_ad with scr_emergency for SCI, spec 2.6). Contract addition:
   * the contract outcome has one screen.
   */
  // SPEC-GAP: emergency-also-show.
  alsoShow?: ScreenId[];
  lock?: CheckLock;
  skips: SkipItem[];
  variants: VariantItem[];
  /** Tests that run today with another adult beside the person (home only). */
  helperRequired: TestId[];
  /** Screens shown before the check or before the test they belong to (warn_, scr_note_care, helper briefs). */
  warnings: ScreenId[];
  setupUpdates: Partial<StoredSetup>;
  stored: StoredPrecheck;
  /**
   * pc_after_last yes: the lasting follow up of the last check is resolved. Contract addition.
   */
  // SPEC-GAP: followup-resolved. The action stores followUpResolved, which is not in the data map of
  // spec 2.1; it is kept out of `stored` and returned here so the server can clear lastCheckLasting.
  followUpResolved?: boolean;
}

/* ----------------------------------------------------------- question ids */

export const PART_SEPARATOR = ":";

export function questionId(base: PrecheckId, part?: string): string {
  return part === undefined ? base : `${base}${PART_SEPARATOR}${part}`;
}

const PRECHECK_BY_ID = new Map(CHECK_DATA.precheck.map((q) => [q.id as string, q]));
const PRECHECK_INDEX = new Map(CHECK_DATA.precheck.map((q, i) => [q.id as string, i]));

/** The data question and the part of an instance id, or null for an unknown id. */
export function parseQuestionId(id: string): { base: PrecheckId; part?: string } | null {
  const at = id.indexOf(PART_SEPARATOR);
  const base = at < 0 ? id : id.slice(0, at);
  const item = PRECHECK_BY_ID.get(base);
  if (!item) return null;
  return at < 0 ? { base: item.id } : { base: item.id, part: id.slice(at + 1) };
}

/* ------------------------------------------------------------- constants */

const SIDES: readonly Side[] = ["left", "right"];
const otherSide = (s: Side): Side => (s === "left" ? "right" : "left");
const SCI_CONDITIONS = ["sci_complete", "sci_incomplete"];
/** Spec 4.4 helper rules: at home another adult must be present for the chair stand. */
const CHAIR_STAND_HELPER_CONDITIONS = ["parkinsons", "stroke", "sci_incomplete", "cerebral_palsy"];
/** Spec 4.3 helper rules: at home another adult must be present for the side lean. */
const SIDE_LEAN_HELPER_CONDITIONS = [
  "sci_complete",
  "sci_incomplete",
  "stroke",
  "cerebral_palsy",
  "parkinsons",
  "ms",
];
/** Spec 4.4 variant rules: hands allowed for these conditions (stroke only with a weaker side). */
const ARMS_ASSISTED_CONDITIONS = ["sci_incomplete", "cerebral_palsy"];
/** Spec 3.3: warn_weak_shoulder before the arm tests after stroke. */
const ARM_TESTS: readonly TestId[] = ["shoulder_abduction", "arm_curl_30s"];
/** Spec 4.4 pushing arm: the chair stand is skipped when both hands are out; reason by priority. */
// SPEC-GAP: both-hands-reason. The spec names pain_today, flare or recent_surgery without an order.
const BOTH_HANDS_REASON_ORDER: readonly ReasonId[] = [
  "recent_surgery",
  "flare",
  "pain_today",
  "pain_area",
  "weak_shoulder",
  "limb_loss_arm",
];
const LOCK_RANK: Record<LockKind | "none", number> = { next_day: 2, "60_min": 1, none: 0 };
/** Asia/Riyadh is UTC+3 all year (no daylight saving time). */
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function sidesOf(test: TestId): TestSide[] {
  return testDef(test).sides === "each" ? ["left", "right"] : ["none"];
}

/* ------------------------------------------------------ answer validation */

function oneOf(raw: unknown, values: readonly string[]): string | undefined {
  return typeof raw === "string" && values.includes(raw) ? raw : undefined;
}

function score(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 10 ? raw : undefined;
}

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function idList(raw: unknown, ids: readonly string[]): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  if (!raw.every((x) => typeof x === "string" && ids.includes(x))) return undefined;
  if (new Set(raw).size !== raw.length) return undefined;
  // Kept in data order, so instances and results do not depend on the order of the client's list.
  return ids.filter((id) => raw.includes(id));
}

function areaScores(raw: unknown): Record<string, number> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = score(v);
    if (!(AREA_IDS as readonly string[]).includes(k) || s === undefined) return undefined;
    out[k] = s;
  }
  return out;
}

function checklist(raw: unknown, size: number): boolean | string[] | undefined {
  if (typeof raw === "boolean") return raw;
  const indexes = Array.from({ length: size }, (_, i) => String(i));
  return idList(raw, indexes);
}

// SPEC-GAP: booth-sci-bp. Spec 2.7 also starts the AD response at the booth for SCI at T6 or above
// when systolic rises 20 or more above the person's usual value. pc_booth_vitals is shown only for
// clearance no or unsure (SCI needs clearance yes) and no usual value is collected, so that staff
// rule stays a staff procedure and is not evaluated here.
const VITAL_KEYS = ["restingHeartRate", "systolic", "diastolic"] as const;
type Vitals = Record<(typeof VITAL_KEYS)[number], number>;

function vitals(raw: unknown): "unavailable" | Vitals | undefined {
  if (raw === "unavailable") return raw;
  if (!isPlainObject(raw)) return undefined;
  const keys = Object.keys(raw);
  if (keys.length !== VITAL_KEYS.length || !VITAL_KEYS.every((k) => keys.includes(k))) return undefined;
  const ok = VITAL_KEYS.every((k) => {
    const v = raw[k];
    return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 400;
  });
  return ok ? (raw as Vitals) : undefined;
}

/** The answer of one question instance, normalised, or undefined when missing or not valid. */
function normalizeAnswer(
  item: PrecheckItem,
  part: string | undefined,
  raw: unknown,
): AnswerValue | undefined {
  if (raw === undefined || raw === null) return undefined;
  const options = item.options?.map((o) => o.value as string) ?? ["yes", "no"];
  switch (item.type) {
    case "yes_no":
    case "yes_no_unsure":
    case "single":
    case "three_yes_no":
      return oneOf(raw, options);
    case "yes_no_then_areas":
      if (part === "areas") return idList(raw, item.surgeryAreas ? SURGERY_AREA_IDS : AREA_IDS);
      // The base question and the clearance question per surgery area are both yes or no.
      return oneOf(raw, ["yes", "no"]);
    case "scale_0_10":
      return score(raw);
    case "area_scale_0_10":
      return areaScores(raw);
    case "checklist":
      return checklist(raw, item.list?.en.length ?? 0);
    case "system":
      return item.id === "pc_booth_vitals" ? vitals(raw) : undefined;
  }
}

/* --------------------------------------------------------------- state */

interface Instance {
  id: string;
  base: PrecheckId;
  part?: string;
}

interface State {
  env: PrecheckEnv;
  raw: Answers;
  instances: Instance[];
  /** Valid answers of visible instances. */
  values: Map<string, AnswerValue>;
  /** Data questions with at least one visible instance. */
  shown: Set<PrecheckId>;
  /** Tests for which pc_helper is asked (home, helper required, not skipped by another answer). */
  helperTests: Set<TestId>;
}

function value(st: State, id: string): AnswerValue | undefined {
  return st.values.get(id);
}

/** sci_t6: today's pc_sci_level answer (not sure counts as yes), else the stored setup. */
function sciT6(st: State): boolean {
  const v = value(st, "pc_sci_level");
  if (v !== undefined) return v === "yes" || v === "unsure";
  return st.env.setup?.sciT6 === true;
}

function limbArm(st: State): Side | undefined {
  const v = value(st, "pc_limb_arm_side");
  return v === "left" || v === "right" ? v : st.env.setup?.limbLoss?.arm;
}

function limbLeg(st: State): Side | undefined {
  const v = value(st, "pc_limb_leg_side");
  return v === "left" || v === "right" ? v : st.env.setup?.limbLoss?.leg;
}

/** setup.painSides: the union of today's pc_arm_pain_side answers, else the stored setup. */
// SPEC-GAP: pain-sides-union. pc_arm_pain_side is asked per area (shoulder, elbow, wrist) but the
// contract keeps one painSides list, so the sides of all three areas are merged. Every pre-check rule
// treats the three areas alike (arm curl arm_only, no push in the hands allowed chair stand); only the
// progress rule "no verdict on a side with shoulder pain" is widened to elbow and wrist sides.
function painSides(st: State): Side[] | undefined {
  const answered = st.instances.filter((i) => i.base === "pc_arm_pain_side" && st.values.has(i.id));
  if (answered.length === 0) return st.env.setup?.painSides;
  const sides = new Set<Side>();
  for (const i of answered) {
    const v = value(st, i.id);
    if (v === "left" || v === "both") sides.add("left");
    if (v === "right" || v === "both") sides.add("right");
  }
  return SIDES.filter((s) => sides.has(s));
}

/** painNow for the rules and for storage: raised to the highest area score (spec 2.1). */
function effectivePain(st: State): number | undefined {
  const now = value(st, "pc_pain_now");
  if (typeof now !== "number") return undefined;
  const areas = value(st, "pc_pain_areas");
  const scores = isPlainObject(areas) ? Object.values(areas).filter((v) => typeof v === "number") : [];
  return Math.max(now, ...scores);
}

const has = (list: readonly string[], ids: readonly string[]) => ids.some((id) => list.includes(id));

/* --------------------------------------------------------------- showIf */

interface CondContext {
  env: PrecheckEnv;
  answer(id: string): AnswerValue | undefined;
  flag(flag: PrecheckFlag): boolean;
}

type ShowIfEvaluators = {
  [K in keyof Required<ShowIf>]: (v: NonNullable<ShowIf[K]>, c: CondContext) => boolean;
};

/** One evaluator per showIf key; the mapped type makes a new key in ShowIf a compile error here. */
const SHOW_IF: ShowIfEvaluators = {
  anyOf: (list, c) => list.some((s) => showIfHolds(s, c)),
  answer: (a, c) => {
    const v = c.answer(a.id);
    if (v === undefined) return false;
    if (a.equals !== undefined && v !== a.equals) return false;
    if (a.gte !== undefined && !(typeof v === "number" && v >= a.gte)) return false;
    return true;
  },
  noUnresolvedChangeReported: (_, c) => !c.env.unresolvedChangeReported,
  unresolvedChangeReported: (_, c) => c.env.unresolvedChangeReported,
  painAny: (areas, c) => has(c.env.ctx.pain, areas),
  supportNot: (s, c) => c.env.ctx.support !== s,
  conditionsAny: (ids, c) => has(c.env.ctx.conditions, ids),
  flag: (f, c) => c.flag(f),
  notFirstCheck: (_, c) => !c.env.firstCheck,
  testSelected: (t, c) => c.env.baseTests.includes(t),
  positionIn: (ps, c) => ps.includes(c.env.ctx.position),
  setting: (s, c) => c.env.setting === s,
  clearanceIn: (cs, c) => cs.includes(c.env.ctx.clearance),
  previousFollowUp: (f, c) => f === "lasting_unresolved" && c.env.lastCheckLasting,
};

export const SHOW_IF_KEYS = Object.keys(SHOW_IF) as (keyof ShowIf)[];

/** Every key present must hold; anyOf holds when one of its conditions holds; null always holds. */
function showIfHolds(s: ShowIf | null | undefined, c: CondContext): boolean {
  if (!s) return true;
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) continue;
    const evaluate = SHOW_IF[k as keyof ShowIf] as ((v: unknown, c: CondContext) => boolean) | undefined;
    // An unknown condition shows the question (asking once too often is the safe side);
    // tests/precheck.test.ts proves the data uses only known keys.
    if (evaluate && !evaluate(v, c)) return false;
  }
  return true;
}

function stateCond(st: State, test?: TestId): CondContext {
  return {
    env: st.env,
    answer: (id) => value(st, id),
    flag: (f) => (f === "sci_t6" ? sciT6(st) : test !== undefined && st.helperTests.has(test)),
  };
}

/* ----------------------------------------------------------- visibility */

/** Baseline setup questions: asked at the first check, or when the setup lacks the answer. */
// SPEC-GAP: setup-intake-change. The spec asks them again "when the intake changes"; the env has no
// intake history, so the server must drop the affected setup fields when the intake pain areas or
// conditions change (then the question is asked again here).
function setupMissing(st: State, id: PrecheckId): boolean {
  const setup = st.env.setup;
  switch (id) {
    case "pc_arm_pain_side":
      return setup?.painSides === undefined;
    case "pc_limb_arm_side":
      return setup?.limbLoss?.arm === undefined;
    case "pc_limb_leg_side":
      return setup?.limbLoss?.leg === undefined;
    case "pc_sci_level":
      return setup?.sciT6 === undefined;
    default:
      return true;
  }
}

function addItem(st: State, item: PrecheckItem) {
  // pc_setting is a system value set by the route or by staff, never asked.
  if (item.id === "pc_setting") return;
  const push = (part?: string, test?: TestId): AnswerValue | undefined => {
    if (!showIfHolds(item.showIf, stateCond(st, test))) return undefined;
    const id = questionId(item.id, part);
    st.instances.push({ id, base: item.id, part });
    st.shown.add(item.id);
    const v = normalizeAnswer(item, part, st.raw[id]);
    if (v !== undefined) st.values.set(id, v);
    return v;
  };
  if (!showIfHolds(item.showIf, stateCond(st)) && !item.perTest) return;
  if (item.group === "baseline_setup" && !st.env.firstCheck && !setupMissing(st, item.id)) return;

  if (item.type === "yes_no_then_areas") {
    if (push() !== "yes") return;
    const areas = push("areas");
    if (item.surgeryAreas && Array.isArray(areas)) for (const a of areas) push(a);
  } else if (item.items) {
    for (const sub of item.items) push(sub.id);
  } else if (item.perArea) {
    for (const area of item.perArea) if (st.env.ctx.pain.includes(area)) push(area);
  } else if (item.perSide) {
    const lost = limbArm(st);
    for (const side of ["right", "left"] as const) if (side !== lost) push(side);
  } else if (item.perTest) {
    for (const test of item.perTest) if (st.helperTests.has(test)) push(test, test);
  } else {
    push();
  }
}

function buildState(env: PrecheckEnv, raw: Answers): State {
  const st: State = {
    env,
    raw: isPlainObject(raw) ? raw : {},
    instances: [],
    values: new Map(),
    shown: new Set(),
    helperTests: new Set(),
  };
  const helperItem = CHECK_DATA.precheck.find((q) => q.perTest);
  for (const item of CHECK_DATA.precheck) if (item !== helperItem) addItem(st, item);
  if (helperItem) {
    // pc_helper depends on the helper rules, which depend on the other answers of the day.
    st.helperTests = computeDay(st).helperTests;
    addItem(st, helperItem);
    const order = (i: Instance) => PRECHECK_INDEX.get(i.base) ?? 0;
    st.instances = st.instances
      .map((inst, pos) => ({ inst, pos }))
      .sort((a, b) => order(a.inst) - order(b.inst) || a.pos - b.pos)
      .map((x) => x.inst);
  }
  return st;
}

/**
 * The pre-check questions to show, in order, as question ids (instance ids for questions asked per
 * area, side, test or sub question). pc_booth_vitals is a staff entry screen at the booth.
 * Recompute after every answer: answers open follow up questions.
 */
export function visibleQuestions(env: PrecheckEnv, answers: Answers): string[] {
  return buildState(env, answers).instances.map((i) => i.id);
}

/** Visible question ids that have no valid answer yet. */
export function missingAnswers(env: PrecheckEnv, answers: Answers): string[] {
  const st = buildState(env, answers);
  return st.instances.filter((i) => !st.values.has(i.id)).map((i) => i.id);
}

/* ----------------------------------------------------------- day rules */

interface Postpone {
  reason: PostponeReasonId;
  screen: ScreenId;
  lock: LockKind | "none";
}

interface Day {
  emergency?: { screen: ScreenId; lock: LockKind; alsoShow: ScreenId[] };
  ad?: { screen: ScreenId; lock: LockKind };
  postpones: Postpone[];
  recorded: Set<StoreKey>;
  changeCleared: boolean;
  skips: Map<string, SkipItem>;
  armOnly: Set<Side>;
  cuffOrArmOnly: Set<Side>;
  chairAssisted: boolean;
  chairVariant?: DayVariant;
  pushHand?: Side;
  /** Hands that may not push in the hands allowed chair stand, with the reason. */
  pushBlocked: Map<Side, ReasonId>;
  /** Tests that need a helper because of an answer (pc_steadi, pc_walking_aid, pc_pd_dizzy_standing). */
  helperFrom: Set<TestId>;
  helperTests: Set<TestId>;
  helperPresent: TestId[];
  warnings: ScreenId[];
}

interface Match {
  side?: Side;
  test?: TestId;
  areas?: AreaId[];
  surgeryAreas?: SurgeryAreaId[];
}

const skipKey = (test: TestId, side: TestSide) => `${test}|${side}`;

function selected(st: State, test: TestId): boolean {
  return st.env.baseTests.includes(test);
}

function skip(st: State, d: Day, test: TestId, side: TestSide, reason: ReasonId) {
  if (!selected(st, test)) return;
  const key = skipKey(test, side);
  // The first reason found is the one shown (limb loss first, then question order).
  if (!d.skips.has(key)) d.skips.set(key, { testId: test, side, reason });
}

function fullySkipped(d: Day, test: TestId): boolean {
  return sidesOf(test).every((s) => d.skips.has(skipKey(test, s)));
}

function warn(d: Day, screen: ScreenId | undefined) {
  if (screen && !d.warnings.includes(screen)) d.warnings.push(screen);
}

function blockPush(d: Day, side: Side, reason: ReasonId) {
  if (!d.pushBlocked.has(side)) d.pushBlocked.set(side, reason);
}

/** One load of an area or a surgery area: a test, its side, and the variant it applies to or sets. */
interface Load {
  test: TestId;
  side: AreaLoad["side"];
  variant?: "arms_assisted" | "arm_only";
}

/** The side of an arm area (from its loads), or undefined for areas without a side. */
function areaSide(loads: readonly Load[]): Side | undefined {
  for (const l of loads) if (l.side === "left" || l.side === "right") return l.side;
  return undefined;
}

function loadSides(test: TestId, side: Load["side"]): TestSide[] {
  return side === "left" || side === "right" ? [side] : sidesOf(test);
}

/** Tests an area or surgery area loads (areas, surgeryAreas in the data). */
function areaLoads(id: AreaId | SurgeryAreaId, surgery: boolean): { loads: Load[]; side?: Side } {
  if (surgery) {
    const s = CHECK_DATA.surgeryAreas.find((x) => x.id === id);
    if (s?.usesArea) return areaLoads(s.usesArea, false);
    const loads: Load[] = (s?.loads ?? []).map((l) => ({ test: l.test, side: l.side, variant: l.variant }));
    return { loads, side: areaSide(loads) };
  }
  const loads: Load[] = CHECK_DATA.areas.find((x) => x.id === id)?.loads ?? [];
  return { loads, side: areaSide(loads) };
}

/** Skip or change the tests an area loads (pain areas at 6, flare areas, surgery areas). */
function applyAreaLoads(st: State, d: Day, id: AreaId | SurgeryAreaId, surgery: boolean, reason: ReasonId) {
  const { loads, side } = areaLoads(id, surgery);
  for (const load of loads) {
    const v = load.variant;
    if (v === "arm_only") {
      for (const s of loadSides(load.test, load.side)) if (s !== "none") d.armOnly.add(s);
    } else if (v === "arms_assisted") {
      // Spec 4.4 pushing arm: in the hands allowed version this hand does not push; both hands
      // out skips the chair stand. The standard version keeps the arms crossed and does not push.
      if (side) blockPush(d, side, reason);
      else for (const s of SIDES) blockPush(d, s, reason);
    } else {
      for (const s of loadSides(load.test, load.side)) skip(st, d, load.test, s, reason);
    }
  }
}

function refSides(st: State, ref: TestRef, m: Match): TestSide[] {
  const support = st.env.ctx.support;
  switch (ref.side) {
    case "weaker":
      return support === "none" ? [] : [support];
    case "stronger":
      return support === "none" ? [] : [otherSide(support)];
    case "same":
      return m.side ? [m.side] : [];
    case "each":
    case "none":
      return sidesOf(ref.test);
  }
}

function applyVariant(st: State, d: Day, test: TestId, side: TestSide, variant: ActionVariant) {
  if (test === "arm_curl_30s" && side !== "none") {
    if (variant === "arm_only") d.armOnly.add(side);
    if (variant === "cuff_or_arm_only") d.cuffOrArmOnly.add(side);
  } else if (test === "chair_stand_30s") {
    if (variant === "arms_assisted") d.chairAssisted = true;
    // pc_weak_shoulder: applies when the chair stand runs hands allowed; the weaker hand does not push.
    if (variant === "push_stronger_hand_only" && st.env.ctx.support !== "none") {
      blockPush(d, st.env.ctx.support, "weak_shoulder");
    }
  }
}

function applySkipTargets(st: State, d: Day, targets: TestTargets, reason: ReasonId, m: Match) {
  if (Array.isArray(targets)) {
    for (const ref of targets) for (const s of refSides(st, ref, m)) skip(st, d, ref.test, s, reason);
  } else if (targets === "surgeryArea.loads") {
    for (const a of m.surgeryAreas ?? []) applyAreaLoads(st, d, a, true, reason);
  } else if (targets === "area.loads") {
    for (const a of m.areas ?? []) applyAreaLoads(st, d, a, false, reason);
  } else if (targets === "the test the question was asked for") {
    if (m.test) for (const s of sidesOf(m.test)) skip(st, d, m.test, s, reason);
  }
  // "remaining tests that load the same area" is the between tests rule (betweenTests).
}

/** Scalar conditions: every key present must hold. */
function scalarHolds(cond: ActionIf, v: AnswerValue | undefined): boolean {
  if (v === undefined) return false;
  if (cond.equals !== undefined && v !== cond.equals) return false;
  if (cond.in !== undefined && !(typeof v === "string" && (cond.in as string[]).includes(v))) return false;
  if (cond.gte !== undefined && !(typeof v === "number" && v >= cond.gte)) return false;
  return true;
}

function allChecked(v: AnswerValue | undefined, size: number): boolean {
  return v === true || (Array.isArray(v) && v.length === size);
}

/** The places where an action's condition holds (one per side, test or area group). */
function matchesOf(st: State, item: PrecheckItem, cond: ActionIf): Match[] {
  const insts = st.instances.filter((i) => i.base === item.id);
  switch (item.type) {
    case "three_yes_no": {
      const anyYes = insts.some((i) => value(st, i.id) === "yes");
      return cond.anyYes && anyYes ? [{}] : [];
    }
    case "area_scale_0_10": {
      const scores = value(st, item.id);
      if (!isPlainObject(scores) || cond.areaScoreGte === undefined) return [];
      let areas = AREA_IDS.filter((a) => (scores[a] ?? 0) >= (cond.areaScoreGte ?? Infinity));
      if (cond.areaLoadsSelectedTest) {
        // SPEC-GAP: area7-loads. "An area a selected test loads" counts every load of the area,
        // on any side and in any variant (the safe reading: more postpones).
        areas = areas.filter((a) => areaLoads(a, false).loads.some((l) => selected(st, l.test)));
      }
      return areas.length ? [{ areas }] : [];
    }
    case "checklist": {
      const v = value(st, item.id);
      if (v === undefined) return [];
      return cond.allChecked === false && !allChecked(v, item.list?.en.length ?? 0) ? [{}] : [];
    }
    case "system": {
      const v = value(st, item.id);
      if (cond.vitalsUnavailable) return v === "unavailable" ? [{}] : [];
      if (cond.vitalsAbove) {
        if (!isPlainObject(v)) return [];
        const lim = cond.vitalsAbove;
        const above = VITAL_KEYS.some((k) => (v[k] as number) > lim[k]);
        return above ? [{}] : [];
      }
      return [];
    }
    case "yes_no_then_areas": {
      if (!scalarHolds(cond, value(st, item.id))) return [];
      const areas = value(st, questionId(item.id, "areas"));
      // SPEC-GAP: unlisted-area. Yes with none of the listed areas chosen (for example an ankle or a
      // foot) skips nothing: the spec maps only the listed areas to tests.
      const list = Array.isArray(areas) ? areas : [];
      if (cond.clearedNot !== undefined) {
        // An area whose clearance is not answered counts as not cleared.
        const uncleared = list.filter((a) => value(st, questionId(item.id, a)) !== cond.clearedNot);
        return uncleared.length ? [{ surgeryAreas: uncleared as SurgeryAreaId[] }] : [];
      }
      return [{ areas: list as AreaId[] }];
    }
    default: {
      const out: Match[] = [];
      for (const inst of insts) {
        const v = item.id === "pc_pain_now" ? effectivePain(st) : value(st, inst.id);
        if (cond.any ? v === undefined : !scalarHolds(cond, v)) continue;
        if (item.perSide) out.push({ side: inst.part as Side });
        else if (item.perTest) out.push({ test: inst.part as TestId });
        else out.push({});
      }
      return out;
    }
  }
}

function applyAction(st: State, d: Day, a: QuestionAction, m: Match) {
  switch (a.do) {
    case "record":
      if (a.stores) d.recorded.add(a.stores);
      break;
    case "emergency": {
      const alsoShow: ScreenId[] = [];
      if (a.alsoShowIf) {
        const { screen, ...when } = a.alsoShowIf;
        if (showIfHolds(when, stateCond(st))) alsoShow.push(screen);
      }
      d.emergency ??= { screen: a.screen, lock: a.lock, alsoShow };
      break;
    }
    case "postpone":
      d.postpones.push({ reason: a.reason, screen: a.screen, lock: a.lock });
      if (a.stores) d.recorded.add(a.stores);
      break;
    case "ask":
      // The follow up question's showIf makes it visible.
      break;
    case "skip":
      applySkipTargets(st, d, a.tests, a.reason, m);
      warn(d, a.screen);
      break;
    case "warn":
      warn(d, a.screen);
      break;
    case "variant":
      for (const ref of a.tests) {
        for (const s of refSides(st, ref, m)) applyVariant(st, d, ref.test, s, a.variant);
        if (a.alsoDo === "require_helper") d.helperFrom.add(ref.test);
      }
      break;
    case "flag":
      // sci_t6 is read from the pc_sci_level answer (sciT6), because it also drives visibility.
      break;
    case "ad_response":
      d.ad ??= { screen: a.screen, lock: a.lock };
      break;
    case "booth_only":
      // Allowed at the booth with staff beside the person; skipped at home.
      if (st.env.setting === "home") {
        for (const ref of a.tests) for (const s of refSides(st, ref, m)) skip(st, d, ref.test, s, a.reason);
      }
      break;
    case "require_helper":
      for (const ref of a.tests) d.helperFrom.add(ref.test);
      break;
    case "show":
      if (m.test) {
        warn(d, a.screenByTest[m.test]);
        if (a.stores) d.recorded.add(a.stores);
        if (!d.helperPresent.includes(m.test)) d.helperPresent.push(m.test);
      }
      break;
    case "stop_check":
    case "note":
      // Between tests and after the check only.
      break;
  }
}

/** Rules written by hand from the spec prose, after the answers' actions. */
function applyStandingRules(st: State, d: Day) {
  const { ctx, setting } = st.env;
  const weaker = ctx.support === "none" ? undefined : ctx.support;
  const stroke = ctx.conditions.includes("stroke");

  // Spec 4.2 load rules: arm_only is forced by no_resistance, clearance no or unsure, pain on that
  // side (setup.painSides) and, after stroke, the weaker arm whatever pc_weak_shoulder says.
  if (ctx.restrictions.includes("no_resistance") || ctx.clearance !== "yes") {
    for (const s of SIDES) d.armOnly.add(s);
  }
  const sides = painSides(st) ?? [];
  for (const s of sides) d.armOnly.add(s);
  if (stroke && weaker) d.armOnly.add(weaker);

  // Spec 3.3 pain shoulder, elbow or wrist: the hands allowed chair stand pushes with the other hand.
  // SPEC-GAP: push-intake-pain. Spec 4.4 lists only today's causes; 3.3 adds the intake pain side.
  for (const s of sides) blockPush(d, s, "pain_area");

  // Spec 4.4 variant rules and pushing arm.
  const chair: TestId = "chair_stand_30s";
  if (selected(st, chair) && !fullySkipped(d, chair)) {
    const assisted =
      d.chairAssisted ||
      st.env.neededArmsLastStand === true ||
      (stroke && weaker !== undefined) ||
      has(ctx.conditions, ARMS_ASSISTED_CONDITIONS);
    if (assisted) {
      d.chairAssisted = true;
      const hands = SIDES.filter((s) => !d.pushBlocked.has(s));
      if (hands.length === 0) {
        const reasons = [...d.pushBlocked.values()];
        const reason = BOTH_HANDS_REASON_ORDER.find((r) => reasons.includes(r)) ?? reasons[0];
        skip(st, d, chair, "none", reason);
      } else {
        const steady = setting === "home" && value(st, "pc_walking_aid") === "yes";
        d.chairVariant = steady ? "arms_assisted_steady" : "arms_assisted";
        if (hands.length === 1) d.pushHand = hands[0];
      }
    } else if (ctx.conditions.includes("upper_limb_unilateral")) {
      d.chairVariant = "one_arm_cross";
    }
  }

  // Spec 4.3 and 4.4 helper rules (home only; at the booth staff stand beside the person).
  if (setting === "home") {
    if (
      selected(st, chair) &&
      !fullySkipped(d, chair) &&
      (d.chairAssisted || d.helperFrom.has(chair) || has(ctx.conditions, CHAIR_STAND_HELPER_CONDITIONS))
    ) {
      d.helperTests.add(chair);
    }
    const trunk: TestId = "trunk_control_seated";
    const firstHomeSideLean = st.env.firstCheck || st.env.sideLeanDoneAtHome !== true;
    if (
      selected(st, trunk) &&
      !fullySkipped(d, trunk) &&
      (has(ctx.conditions, SIDE_LEAN_HELPER_CONDITIONS) || firstHomeSideLean)
    ) {
      d.helperTests.add(trunk);
    }
  }
}

function computeDay(st: State): Day {
  const d: Day = {
    postpones: [],
    recorded: new Set(),
    changeCleared: false,
    skips: new Map(),
    armOnly: new Set(),
    cuffOrArmOnly: new Set(),
    chairAssisted: false,
    pushBlocked: new Map(),
    helperFrom: new Set(),
    helperTests: new Set(),
    helperPresent: [],
    warnings: [],
  };
  // Limb loss first, so "we measure your other arm only" is the reason shown for that side.
  const arm = limbArm(st);
  if (arm) {
    for (const test of ARM_TESTS) skip(st, d, test, arm, "limb_loss_arm");
    blockPush(d, arm, "limb_loss_arm");
  }
  for (const item of CHECK_DATA.precheck) {
    if (!st.shown.has(item.id)) continue;
    for (const a of item.actions) for (const m of matchesOf(st, item, a.if)) applyAction(st, d, a, m);
  }
  // Spec 2.2 pc_sci_ad_since note: yes_cleared proceeds and stores changeCleared (date only).
  // SPEC-GAP: sci-ad-since-cleared. The data has no action for it; the note is implemented here.
  if (value(st, "pc_sci_ad_since") === "yes_cleared") d.changeCleared = true;
  if (d.recorded.has("changeCleared")) d.changeCleared = true;
  applyStandingRules(st, d);
  return d;
}

/* ------------------------------------------------------------- outcome */

/** A calendar day in Asia/Riyadh, YYYY-MM-DD. */
export function riyadhDate(now: number): string {
  return new Date(now + RIYADH_OFFSET_MS).toISOString().slice(0, 10);
}

function emptyOutcome(status: PrecheckStatus): PrecheckOutcome {
  return { status, skips: [], variants: [], helperRequired: [], warnings: [], setupUpdates: {}, stored: {} };
}

function pickPostpone(list: Postpone[]): Postpone {
  // SPEC-GAP: multi-postpone. With several postpone reasons the longest lock wins (next day, then
  // 60 minutes, then none); on a tie the first in question order.
  return list.reduce((best, p) => (LOCK_RANK[p.lock] > LOCK_RANK[best.lock] ? p : best));
}

function sortedSkips(st: State, d: Day): SkipItem[] {
  const order = (s: SkipItem) =>
    st.env.baseTests.indexOf(s.testId) * 3 + ["left", "right", "none"].indexOf(s.side);
  return [...d.skips.values()].sort((a, b) => order(a) - order(b));
}

function dayVariants(st: State, d: Day): VariantItem[] {
  const out: VariantItem[] = [];
  for (const test of st.env.baseTests) {
    if (test === "arm_curl_30s") {
      for (const side of SIDES) {
        if (d.skips.has(skipKey(test, side))) continue;
        if (d.armOnly.has(side)) out.push({ testId: test, side, variant: "arm_only" });
        else if (d.cuffOrArmOnly.has(side)) out.push({ testId: test, side, variant: "cuff_or_arm_only" });
      }
    } else if (test === "chair_stand_30s" && !d.skips.has(skipKey(test, "none"))) {
      if (d.chairVariant) out.push({ testId: test, side: "none", variant: d.chairVariant });
      if (d.pushHand) {
        const variant = d.pushHand === "left" ? "push_left_hand_only" : "push_right_hand_only";
        out.push({ testId: test, side: "none", variant });
      }
    }
  }
  return out;
}

function conditionWarnings(st: State, d: Day) {
  const { ctx, firstCheck } = st.env;
  if (sciT6(st)) warn(d, "warn_sci_t6");
  if (ctx.conditions.includes("stroke") && ARM_TESTS.some((t) => selected(st, t) && !fullySkipped(d, t))) {
    warn(d, "warn_weak_shoulder");
  }
  if (ctx.conditions.includes("ms")) warn(d, "warn_ms_cool");
  // {x} of warn_pd_timing is the dose bucket of the last check, so it needs a last check.
  // SPEC-GAP: pd-timing-last. The env has no last dose bucket; the client fills {x} from the last
  // stored fingerprint.pdDoseBucket and leaves the warning out when there is none.
  if (ctx.conditions.includes("parkinsons") && !firstCheck) warn(d, "warn_pd_timing");
}

function setupUpdates(st: State): Partial<StoredSetup> {
  const up: Partial<StoredSetup> = {};
  const answeredPainSide = st.instances.some((i) => i.base === "pc_arm_pain_side" && st.values.has(i.id));
  if (answeredPainSide) up.painSides = painSides(st);
  const arm = value(st, "pc_limb_arm_side");
  const leg = value(st, "pc_limb_leg_side");
  if (arm !== undefined || leg !== undefined) {
    up.limbLoss = { ...st.env.setup?.limbLoss };
    if (arm === "left" || arm === "right") up.limbLoss.arm = arm;
    if (leg === "left" || leg === "right") up.limbLoss.leg = leg;
  }
  const level = value(st, "pc_sci_level");
  if (level !== undefined) up.sciT6 = level === "yes" || level === "unsure";
  const armP = value(st, "pc_limb_arm_prosthesis");
  if (armP !== undefined) up.armProsthesis = armP === "yes";
  const legP = value(st, "pc_limb_leg_prosthesis");
  if (legP !== undefined) up.legProsthesis = legP === "yes";
  return up;
}

function storedFields(st: State, d: Day, date: string): StoredPrecheck {
  const out: StoredPrecheck = {};
  const pain = effectivePain(st);
  if (pain !== undefined) out.painNow = pain;
  const sides = painSides(st);
  if (sides !== undefined) out["setup.painSides"] = sides;
  const arm = limbArm(st);
  const leg = limbLeg(st);
  if (arm || leg) out["setup.limbLoss"] = { ...(arm ? { arm } : {}), ...(leg ? { leg } : {}) };
  const level = value(st, "pc_sci_level");
  if (level !== undefined || st.env.setup?.sciT6 !== undefined) out["setup.sciT6"] = sciT6(st);
  if (d.recorded.has("fingerprint.armProsthesis")) {
    out["fingerprint.armProsthesis"] = value(st, "pc_limb_arm_prosthesis") === "yes";
  }
  if (d.recorded.has("fingerprint.legProsthesis")) {
    out["fingerprint.legProsthesis"] = value(st, "pc_limb_leg_prosthesis") === "yes";
  }
  if (d.recorded.has("fingerprint.pdState")) out["fingerprint.pdState"] = "unsure";
  const dose = value(st, "pc_pd_dose");
  if (d.recorded.has("fingerprint.pdDoseBucket") && typeof dose === "string") {
    out["fingerprint.pdDoseBucket"] = dose as PdDoseBucket;
  }
  const present = d.helperPresent.filter((t) => !fullySkipped(d, t));
  if (d.recorded.has("fingerprint.helperPresent") && present.length)
    out["fingerprint.helperPresent"] = present;
  if (d.changeCleared) out.changeCleared = date;
  return out;
}

/**
 * Today's go or no go decision (spec 2.1, 2.2, 2.7). The first decision that applies:
 *   emergency   pc_urgent yes (always wins);
 *   ad          pc_sci_ad_now yes;
 *   postpone    any postpone action, once pc_urgent is answered;
 *   incomplete  a visible question has no valid answer;
 *   proceed     with today's skips, variants, helpers, warnings, setup updates and stored fields.
 * `now` (epoch ms) dates changeCleared and changeReported.
 */
export function evaluatePrecheck(
  env: PrecheckEnv,
  answers: Answers,
  now: number = Date.now(),
): PrecheckOutcome {
  const st = buildState(env, answers);
  const d = computeDay(st);
  const date = riyadhDate(now);
  // SPEC-GAP: change-reported-on-postpone. changeReported is kept even though the check is not
  // stored, so an uncleared change cannot be bypassed after the lock ends (spec 2.2 pc_change note).
  const terminalStored: StoredPrecheck = d.recorded.has("changeReported") ? { changeReported: date } : {};

  if (d.emergency) {
    return {
      ...emptyOutcome("emergency"),
      reason: "urgent",
      screen: d.emergency.screen,
      alsoShow: d.emergency.alsoShow,
      lock: { reason: "urgent", until: d.emergency.lock },
      stored: terminalStored,
    };
  }
  if (d.ad) {
    return {
      ...emptyOutcome("ad"),
      reason: "ad",
      screen: d.ad.screen,
      lock: { reason: "ad", until: d.ad.lock },
      stored: terminalStored,
    };
  }
  // A postpone ends the questions early, but never before the emergency question is answered.
  if (d.postpones.length > 0 && st.values.has("pc_urgent")) {
    const p = pickPostpone(d.postpones);
    return {
      ...emptyOutcome("postpone"),
      reason: p.reason,
      screen: p.screen,
      lock: { reason: p.reason, until: p.lock === "none" ? null : p.lock },
      stored: terminalStored,
    };
  }
  if (st.instances.some((i) => !st.values.has(i.id))) return emptyOutcome("incomplete");

  conditionWarnings(st, d);
  const outcome: PrecheckOutcome = {
    status: "proceed",
    skips: sortedSkips(st, d),
    variants: dayVariants(st, d),
    helperRequired: [...d.helperTests].filter((t) => !fullySkipped(d, t)),
    warnings: d.warnings,
    setupUpdates: setupUpdates(st),
    stored: storedFields(st, d, date),
  };
  if (d.recorded.has("followUpResolved")) outcome.followUpResolved = true;
  return outcome;
}

/**
 * Today's variant of one test and side, read back from `variants`: the main variant (undefined means
 * the default) and, for the hands allowed chair stand, the hand that pushes (undefined means either).
 * For finalizeProtocol, which keeps one variant per protocol item.
 */
export function dayVariant(
  outcome: Pick<PrecheckOutcome, "variants">,
  testId: TestId,
  side: TestSide,
): { variant?: Exclude<DayVariant, (typeof PUSH_HAND_VARIANTS)[number]>; pushHand?: Side } {
  const out: ReturnType<typeof dayVariant> = {};
  for (const v of outcome.variants) {
    if (v.testId !== testId || v.side !== side) continue;
    if (v.variant === "push_left_hand_only") out.pushHand = "left";
    else if (v.variant === "push_right_hand_only") out.pushHand = "right";
    else out.variant = v.variant;
  }
  return out;
}

/* ----------------------------------------------------------------- locks */

/** The lock kind of a reason, read from locks.rules (next_day, 60_min, or none). */
export function lockKind(reason: LockReasonId): LockKind | null {
  const rule = CHECK_DATA.locks.rules[reason];
  if (rule === undefined) throw new RangeError(`Unknown lock reason ${reason}`);
  const head = rule.split(/[\s,:]/)[0];
  if (head === "next_day" || head === "60_min") return head;
  if (head === "none") return null;
  throw new RangeError(`Unreadable lock rule for ${reason}`);
}

/**
 * When a lock set at `now` ends, as epoch ms: the start of the next calendar day in Asia/Riyadh,
 * or 60 minutes later; null for a reason without a lock (sci_ready).
 */
export function lockUntil(reason: LockReasonId, now: number): number | null {
  const kind = lockKind(reason);
  if (kind === "60_min") return now + 60 * 60 * 1000;
  if (kind === "next_day") {
    const localDayStart = Math.floor((now + RIYADH_OFFSET_MS) / DAY_MS) * DAY_MS;
    return localDayStart + DAY_MS - RIYADH_OFFSET_MS;
  }
  return null;
}

/**
 * Whether today's answers release a lock at once: recent_change is released by a yes to
 * pc_change_cleared, or yes_cleared in pc_sci_ad_since (locks.rules).
 */
export function releasesLock(lock: { reason: string }, env: PrecheckEnv, answers: Answers): boolean {
  if (lock.reason !== "recent_change") return false;
  const st = buildState(env, answers);
  return value(st, "pc_change_cleared") === "yes" || value(st, "pc_sci_ad_since") === "yes_cleared";
}

/* ---------------------------------------------------------- between tests */

/** A test and side of the protocol, with its variant (none means the default) and push hand. */
export interface TestInstance {
  testId: TestId;
  side: TestSide;
  variant?: string;
  pushHand?: Side;
}

export interface BetweenOutcome {
  status: "continue" | "skip" | "end" | "incomplete";
  skips: SkipItem[];
  screen?: ScreenId;
  lock?: CheckLock;
}

function isHandsAllowed(variant: string | undefined): boolean {
  return variant === "arms_assisted" || variant === "arms_assisted_steady";
}

/** Whether a test instance loads an area (areas in the data). */
function loadsArea(t: TestInstance, areaId: AreaId): boolean {
  const { loads, side } = areaLoads(areaId, false);
  return loads.some((l) => {
    if (l.test !== t.testId) return false;
    if ((l.side === "left" || l.side === "right") && t.side !== l.side) return false;
    if (l.variant === "arms_assisted") {
      // SPEC-GAP: bt-standard-stand. No variant means the default (standard, arms crossed), which does
      // not push; hands allowed without a known push hand loads both arms (the safe reading).
      if (!isHandsAllowed(t.variant)) return false;
      if (t.pushHand && side && side !== t.pushHand) return false;
    }
    return true;
  });
}

/**
 * bt_pain_after, asked after each test and after each side of a two sided test (spec 2.3).
 * A little more pain skips the remaining tests that load an area the finished test loads
 * (pain_today); much more or sharp pain ends the check for today.
 */
export function betweenTests(
  answers: Answers,
  done: TestInstance,
  remaining: readonly TestInstance[],
): BetweenOutcome {
  const q = CHECK_DATA.betweenTests[0];
  const v = oneOf(
    answers?.[q.id],
    q.options.map((o) => o.value as string),
  );
  if (v === undefined) return { status: "incomplete", skips: [] };
  for (const a of q.actions) {
    if (!scalarHolds(a.if, v)) continue;
    if (a.do === "stop_check") {
      // SPEC-GAP: bt-lock-reason. The lock table has no own reason for this stop; it is a symptom stop.
      return { status: "end", skips: [], screen: a.screen, lock: { reason: "stop_symptom", until: a.lock } };
    }
    if (a.do === "skip") {
      // SPEC-GAP: bt-area-unknown. bt_pain_after does not ask where the pain rose, so every area the
      // finished test loads counts as "the same area" (the safe reading: more skips).
      const areas = AREA_IDS.filter((area) => loadsArea(done, area));
      const skips = remaining
        .filter((t) => areas.some((area) => loadsArea(t, area)))
        .map((t) => ({ testId: t.testId, side: t.side, reason: a.reason }));
      return { status: skips.length ? "skip" : "continue", skips };
    }
  }
  return { status: "continue", skips: [] };
}

/* ---------------------------------------------------------- after the check */

/** ac_next_day is asked at the first app open 12 hours to 3 days after a completed check. */
export const AFTER_CHECK_WINDOW_HOURS: readonly [number, number] = [12, 72];

export function afterCheckDue(completedAt: number, now: number): boolean {
  const hours = (now - completedAt) / HOUR_MS;
  return hours >= AFTER_CHECK_WINDOW_HOURS[0] && hours <= AFTER_CHECK_WINDOW_HOURS[1];
}

export interface AfterCheckOutcome {
  status: "recorded" | "incomplete";
  screen?: ScreenId;
  stored: { "assessment.followUp"?: "usual" | "settled" | "lasting" };
  /** Lasting: the next check asks pc_after_last, and no early repeat is offered until resolved. */
  lastingUnresolved: boolean;
}

/** The next day follow up (spec 2.4). */
export function afterCheck(answers: Answers): AfterCheckOutcome {
  const q = CHECK_DATA.afterCheck[0];
  const v = oneOf(
    answers?.[q.id],
    q.options.map((o) => o.value as string),
  );
  if (v === undefined) return { status: "incomplete", stored: {}, lastingUnresolved: false };
  // SPEC-GAP: after-check-store-all. The data stores the lasting answer; every answer is kept in
  // assessment.followUp (a data map field) so the question is not asked again.
  const out: AfterCheckOutcome = {
    status: "recorded",
    stored: { "assessment.followUp": v as "usual" | "settled" | "lasting" },
    lastingUnresolved: false,
  };
  for (const a of q.actions) {
    if (a.do === "note" && scalarHolds(a.if, v)) {
      out.screen = a.screen;
      out.lastingUnresolved = true;
    }
  }
  return out;
}

/* ------------------------------------------------------------ stop routing */

export interface StopRoute {
  option: StopOptionId;
  /** The screen to show, or null when the check simply goes on (tired, choice, other) or asks bt_pain_after. */
  // SPEC-GAP: stop-screen-null. Contract C types screen as a string; four options have no screen.
  screen: ScreenId | null;
  alsoShow: ScreenId[];
  endsCheck: boolean;
  lock: CheckLock | null;
  /** Reason id stored with the stopped test (spec 3.6); the stopped test stores no score. */
  reason: ReasonId;
  /** Ask this question next (pain: bt_pain_after decides the rest). */
  then?: "bt_pain_after";
  /** The next test starts only after a rest. */
  afterRest: boolean;
}

/**
 * sci_t6 for the stop list: the setup flag. env.setup must include today's setupUpdates.
 */
// SPEC-GAP: stop-sci-unknown. SCI with an unknown level counts as T6 or higher (as "not sure" does).
function stopSciT6(env: PrecheckEnv): boolean {
  const flag = env.setup?.sciT6;
  return flag === true || (flag === undefined && has(env.ctx.conditions, SCI_CONDITIONS));
}

function stopCond(env: PrecheckEnv): CondContext {
  return { env, answer: () => undefined, flag: (f) => f === "sci_t6" && stopSciT6(env) };
}

export function isStopOption(option: string): option is StopOptionId {
  return CHECK_DATA.stopRouting.options.some((o) => o.id === option);
}

/** The options of the stop list for this person (ad_signs only with sci_t6). */
export function stopOptions(env: PrecheckEnv): StopOptionId[] {
  const c = stopCond(env);
  return CHECK_DATA.stopRouting.options.filter((o) => showIfHolds(o.showIf, c)).map((o) => o.id);
}

/** Where a stop list answer leads (spec 4.0 stop routing). Throws on an unknown option. */
export function stopRoute(option: string, env: PrecheckEnv): StopRoute {
  const o = CHECK_DATA.stopRouting.options.find((x) => x.id === option);
  if (!o) throw new RangeError(`Unknown stop option ${option}`);
  const c = stopCond(env);
  let screen = o.screen ?? null;
  if (o.screenWhen && o.screenWhen.positionIn.includes(env.ctx.position)) screen = o.screenWhen.screen;
  const alsoShow: ScreenId[] = [];
  if (o.alsoShowIf && c.flag(o.alsoShowIf.flag)) alsoShow.push(o.alsoShowIf.screen);
  const endsCheck = o.check === "ends";
  return {
    option: o.id,
    screen,
    alsoShow,
    endsCheck,
    // SPEC-GAP: bt-lock-reason. Ending stops lock with stop_symptom; AD signs with ad (spec 2.1).
    lock: o.lock ? { reason: o.id === "ad_signs" ? "ad" : "stop_symptom", until: o.lock } : null,
    reason: o.reason ?? "stopped_symptom",
    ...(o.then ? { then: o.then } : {}),
    afterRest: o.check === "may continue with the next test after a rest",
  };
}

/* ------------------------------------------------------------ data checks */

/**
 * Action conditions this module cannot evaluate, as "<question>: <key>" (empty when every
 * condition in the data is supported). Used by the tests so a data change cannot slip through.
 */
export function unsupportedConditions(): string[] {
  const supported: Record<string, readonly string[]> = {
    three_yes_no: ["anyYes"],
    area_scale_0_10: ["areaScoreGte", "areaLoadsSelectedTest"],
    checklist: ["allChecked"],
    system: ["vitalsAbove", "vitalsUnavailable", "equals"],
    yes_no_then_areas: ["equals", "in", "gte", "clearedNot"],
  };
  const scalar = ["equals", "in", "gte", "any"];
  const out: string[] = [];
  for (const q of CHECK_DATA.precheck) {
    for (const a of q.actions) {
      for (const k of Object.keys(a.if)) {
        if (!(supported[q.type] ?? scalar).includes(k)) out.push(`${q.id}: ${k}`);
      }
    }
  }
  for (const q of [...CHECK_DATA.betweenTests, ...CHECK_DATA.afterCheck]) {
    for (const a of q.actions)
      for (const k of Object.keys(a.if)) if (k !== "equals") out.push(`${q.id}: ${k}`);
  }
  return out;
}
