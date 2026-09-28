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
 *   pc_trunk_armrests:<chair|wheelchair> 'yes' | 'no', the form of the person's position (Q12 (1);
 *                                        a standing person does the side lean on a chair)
 * Answer formats: option values as strings; pc_pain_now an integer 0 to 10; pc_pain_areas an object
 * { <area id>: integer 0 to 10 } (only the chosen areas; {} when none of the listed areas hurts);
 * pc_sci_ready 'done' or 'not_yet' (the list is read, then one of two buttons: 7.2-8, Q18 (2));
 * pc_booth_vitals (staff entry, Q21) { systolic1, diastolic1, systolic2, diastolic2 (two readings
 * 1 minute apart, the mean is used), restingHeartRate, irregularHeartbeat (the cuff's flag: true or
 * false, 1 or 0), usualSystolic? (SCI at T6 or above), adSign? (true when staff see an AD sign) }, or
 * 'unavailable' (no validated cuff or no licensed practitioner). An answer that does not fit is
 * treated as not answered. Answers to questions that are not visible are ignored.
 *
 * Revision 1.1 adds, around the pre-check: the chair stand setup questions (setupQuestionsFor, Q9),
 * the faint follow up (faintFollowUp, Q33 (3)), the end of check question (endOfCheckForm, endOfCheck,
 * Q23 (7)), the resume re-ask (resumeQuestions, evaluateResume, O6), the question counter
 * (possibleQuestions, O9), the wording of a question (questionForm, Q18, Q33, O45), the {when} of a
 * lock (pausedWhen, Q33 (4)), the lock record (lockRecord, Q25 (c)) and the spoken check in answer
 * (spokenCheckInAnswer, Q31 (4)).
 */
import { CHECK_DATA, testDef } from "../movements/assessments";
import {
  AREA_IDS,
  SURGERY_AREA_IDS,
  type ActionIf,
  type ActionVariant,
  type AreaId,
  type AreaLoad,
  type HelperCheckInLine,
  type Lang,
  type LockKind,
  type LockReasonId,
  type PausedWhenId,
  type PdDoseBucket,
  type PostponeReasonId,
  type PrecheckFlag,
  type PrecheckId,
  type PrecheckItem,
  type QuestionAction,
  type ReasonId,
  type ScreenId,
  type SetupQuestionId,
  type ShowIf,
  type Side,
  type StopFollowUpId,
  type StopOptionId,
  type StoreKey,
  type SurgeryAreaId,
  type TestId,
  type TestRef,
  type TestTargets,
} from "../movements/types";
import type { CheckContext, Setting, StoredSetup } from "./assessment";

/* ------------------------------------------------------------------ types */

export type AnswerValue = boolean | number | string | string[] | Record<string, number | boolean>;
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
  /**
   * The person has a completed check in any setting (booth or home). `firstCheck` is per series, so
   * it is true at the first home check after booth checks; pc_sci_ad_since ("since your last check")
   * is a safety question and is asked whenever there was a last check in any setting.
   */
  // SPEC-GAP: ad-since-any-setting. Missing means not known, and then only !firstCheck shows it.
  completedBefore?: boolean;
  /**
   * A faint stop stored faintReported (date only) and no pc_faint_since answer has cleared it yet:
   * pc_faint_since is asked once, before pc_change (Q33 (3)). Missing means no.
   */
  faintReportedUnresolved?: boolean;
  /**
   * The fine rehearsal after the first calibration failed twice today: noArmSignal holds for today
   * and every camera test left needs pc_helper yes at home (O34-1 (7), O34-2 (1), (3)).
   */
  fineRehearsalFailed?: boolean;
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
 * The data map of spec 2.1, "Kept with the check" (updated by Q32). Nothing else from the pre-check
 * may be stored. The pre-check fills painNow to changeReported; faintReported comes from a faint
 * stop (stopRoute), faceCovered from the setup check, sameChair from su_same_chair
 * (evaluateSetupQuestions), followUp from ac_next_day and the consent from the consent record.
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
  "faintReported",
  "fingerprint.faceCovered",
  "fingerprint.sameChair",
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

/**
 * What the check in needs from the pre-check (stopRouting.checkIn, O33 (a)): whether a raised hand
 * may be asked for (O34-4 (3)), whether no arm can give the camera fine signal (O34-2 (1)), and the
 * arm of the phase 2 fine zone (O34-1 (1)); null when no arm qualifies.
 */
export interface CheckInConfig {
  raiseAllowed: boolean;
  noArmSignal: boolean;
  fineZoneSide: Side | null;
}

export interface PrecheckOutcome {
  status: PrecheckStatus;
  /** Postpone reason id (spec 2.1), or urgent (emergency) or ad (AD response). */
  reason?: PostponeReasonId | "urgent" | "ad";
  /** The screen to show. */
  screen?: ScreenId;
  /**
   * Screens shown with `screen`: scr_ad with scr_emergency for SCI (spec 2.6), and the care advice
   * screens of the other reasons of a postpone with several reasons (pickPostpone). Contract
   * addition: the contract outcome has one screen.
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
  /** pc_faint_since was answered: either answer clears the faintReported date (Q33 (3)). */
  faintReportedCleared?: true;
  /** Proceed only: the inputs of the check in (O34). */
  checkIn?: CheckInConfig;
  /**
   * Proceed only: the helper briefing of each test that runs with a helper (Q11, O34-2 (2)): the
   * briefing screen of the chair stand or the side lean, or for the two arm tests the helper check in
   * line on one screen with the confirm button. The test starts only after the confirm tap.
   */
  helperBriefing?: Partial<Record<TestId, ScreenId | HelperCheckInLine>>;
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

/**
 * Booth vitals (Q21 (3), O47): two readings 1 minute apart (their mean is used), the resting heart
 * rate, the cuff's irregular heartbeat flag, and two optional entries for SCI at T6 or above: the
 * person's usual systolic (the booth build does not render it, O47 (2)) and an AD sign seen by staff.
 */
const READING_KEYS = ["systolic1", "diastolic1", "systolic2", "diastolic2", "restingHeartRate"] as const;
interface Vitals {
  systolic1: number;
  diastolic1: number;
  systolic2: number;
  diastolic2: number;
  restingHeartRate: number;
  irregularHeartbeat: boolean;
  usualSystolic?: number;
  adSign?: boolean;
}
const VITAL_FIELDS: readonly string[] = [...READING_KEYS, "irregularHeartbeat", "usualSystolic", "adSign"];

const reading = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 400;
/** true, false, 1 or 0; anything else is not an answer. */
function flagOf(v: unknown): boolean | undefined {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  return undefined;
}

function vitals(raw: unknown): "unavailable" | Vitals | undefined {
  if (raw === "unavailable") return raw;
  if (!isPlainObject(raw)) return undefined;
  if (Object.keys(raw).some((k) => !VITAL_FIELDS.includes(k))) return undefined;
  if (!READING_KEYS.every((k) => reading(raw[k]))) return undefined;
  const irregular = flagOf(raw.irregularHeartbeat);
  if (irregular === undefined) return undefined;
  const out: Vitals = {
    systolic1: raw.systolic1 as number,
    diastolic1: raw.diastolic1 as number,
    systolic2: raw.systolic2 as number,
    diastolic2: raw.diastolic2 as number,
    restingHeartRate: raw.restingHeartRate as number,
    irregularHeartbeat: irregular,
  };
  if (raw.usualSystolic !== undefined) {
    if (!reading(raw.usualSystolic)) return undefined;
    out.usualSystolic = raw.usualSystolic;
  }
  if (raw.adSign !== undefined) {
    const ad = flagOf(raw.adSign);
    if (ad === undefined) return undefined;
    out.adSign = ad;
  }
  return out;
}

const meanSystolic = (v: Vitals) => (v.systolic1 + v.systolic2) / 2;
const meanDiastolic = (v: Vitals) => (v.diastolic1 + v.diastolic2) / 2;

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
    case "list_confirm":
      return oneOf(raw, options);
    case "system":
      return item.id === "pc_booth_vitals" ? (vitals(raw) as AnswerValue | undefined) : undefined;
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

/* ------------------------------------------------------- arms and signals */

const ARM_FUNCTION_RANK: Record<string, number> = { bend_hold: 2, bend_no_hold: 1, no_bend: 0 };

function armFunction(st: State, side: Side): string | undefined {
  const v = value(st, questionId("pc_arm_function", side));
  return typeof v === "string" ? v : undefined;
}

/**
 * An arm that cannot give the camera fine signal (stopRouting.checkIn.noArmSignal, O34-2 (1)): upper
 * limb loss on that side, the declared weaker side with pc_weak_lift no, or pc_arm_function no_bend.
 */
function armWithoutSignal(st: State, side: Side): boolean {
  if (limbArm(st) === side) return true;
  if (st.env.ctx.support === side && value(st, "pc_weak_lift") === "no") return true;
  return armFunction(st, side) === "no_bend";
}

/**
 * noArmSignal (O34-2 (1)): each arm cannot signal, or the fine rehearsal failed twice today. At home
 * every camera test left then needs pc_helper yes; at the booth nothing changes (O34-2 (7)).
 */
function noArmSignal(st: State): boolean {
  return st.env.fineRehearsalFailed === true || SIDES.every((s) => armWithoutSignal(st, s));
}

/**
 * raiseAllowed (O34-4 (3)): false with the no_overhead restriction, or when no arm is free of all of:
 * upper limb loss, the weaker side with pc_weak_lift no or pc_weak_shoulder yes, pc_arm_function
 * no_bend. No cue ever asks a person with raiseAllowed false to raise a hand.
 */
function raiseAllowed(st: State): boolean {
  if (st.env.ctx.restrictions.includes("no_overhead")) return false;
  const weakShoulder = value(st, "pc_weak_shoulder") === "yes";
  return SIDES.some((s) => !armWithoutSignal(st, s) && !(st.env.ctx.support === s && weakShoulder));
}

/**
 * The arm of the phase 2 fine zone (O34-1 (1)): the stronger arm, never the declared weaker side, a
 * limb loss side or a pc_arm_pain_side; for SCI the arm with the better pc_arm_function answer; on a
 * tie the right.
 */
// SPEC-GAP: fine-zone-no-side. When every arm is ruled out (for example a weaker left arm and pain in
// the right), there is no fine zone (null): fine then comes from the button or the phrase only.
function fineZoneSide(st: State): Side | null {
  const pain = painSides(st) ?? [];
  const lost = limbArm(st);
  const weaker = st.env.ctx.support === "none" ? undefined : st.env.ctx.support;
  const ok = (["right", "left"] as const).filter(
    (s) => s !== lost && s !== weaker && !pain.includes(s) && armFunction(st, s) !== "no_bend",
  );
  if (ok.length === 0) return null;
  const rank = (s: Side) => ARM_FUNCTION_RANK[armFunction(st, s) ?? "bend_hold"] ?? 2;
  // Right first, so a tie keeps the right.
  return ok.reduce((best, s) => (rank(s) > rank(best) ? s : best));
}

/** painNow for the rules and for storage: raised to the highest area score (spec 2.1). */
function effectivePain(st: State): number | undefined {
  const now = value(st, "pc_pain_now");
  if (typeof now !== "number") return undefined;
  const areas = value(st, "pc_pain_areas");
  const scores = isPlainObject(areas)
    ? Object.values(areas).filter((v): v is number => typeof v === "number")
    : [];
  return Math.max(now, ...scores);
}

const has = (list: readonly string[], ids: readonly string[]) => ids.some((id) => list.includes(id));

/* --------------------------------------------------------------- showIf */

interface CondContext {
  env: PrecheckEnv;
  answer(id: string): AnswerValue | undefined;
  flag(flag: PrecheckFlag): boolean;
  /**
   * possibleQuestions only: a question with no answer yet that can still appear. Its answer may
   * still make an answer condition hold.
   */
  pending?(id: string): boolean;
}

type ShowIfEvaluators = {
  [K in keyof Required<ShowIf>]: (v: NonNullable<ShowIf[K]>, c: CondContext) => boolean;
};

/** One evaluator per showIf key; the mapped type makes a new key in ShowIf a compile error here. */
const SHOW_IF: ShowIfEvaluators = {
  anyOf: (list, c) => list.some((s) => showIfHolds(s, c)),
  answer: (a, c) => {
    const v = c.answer(a.id);
    if (v === undefined) return c.pending?.(a.id) ?? false;
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
  notFirstCheck: (_, c) => !c.env.firstCheck || c.env.completedBefore === true,
  testSelected: (t, c) => c.env.baseTests.includes(t),
  positionIn: (ps, c) => ps.includes(c.env.ctx.position),
  setting: (s, c) => c.env.setting === s,
  clearanceIn: (cs, c) => cs.includes(c.env.ctx.clearance),
  previousFollowUp: (f, c) => f === "lasting_unresolved" && c.env.lastCheckLasting,
  faintReportedUnresolved: (_, c) => c.env.faintReportedUnresolved === true,
  weakerSide: (_, c) => c.env.ctx.support !== "none",
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
    flag: (f) =>
      f === "sci_t6"
        ? sciT6(st)
        : f === "noArmSignal"
          ? st.env.setting === "home" && noArmSignal(st)
          : test !== undefined && st.helperTests.has(test),
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
    // In the order the tests run (baseTests), so each helper question sits with its test.
    for (const test of perTestOrder(st.env, item)) if (st.helperTests.has(test)) push(test, test);
  } else if (item.askByPosition) {
    push(positionForm(st.env));
  } else {
    push();
  }
}

/** The tests a per test question is asked for, in the order the check runs them. */
function perTestOrder(env: PrecheckEnv, item: PrecheckItem): TestId[] {
  const listed = item.perTest ?? [];
  const inBase = env.baseTests.filter((t): t is TestId => (listed as readonly string[]).includes(t));
  return [...inBase, ...listed.filter((t) => !inBase.includes(t))];
}

/**
 * The form of a question asked by position (pc_trunk_armrests, Q12 (1)): the wheelchair form in a
 * wheelchair, the chair form otherwise (a standing person does the side lean on a chair).
 */
export function positionForm(env: Pick<PrecheckEnv, "ctx">): "chair" | "wheelchair" {
  return env.ctx.position === "wheelchair" ? "wheelchair" : "chair";
}

/**
 * The visible questions and their valid answers. `only` limits the questions asked (the resume
 * re-ask, O6); the others count as not shown.
 */
function buildState(
  env: PrecheckEnv,
  raw: Answers,
  only?: ReadonlySet<PrecheckId>,
  extraHelpers: readonly TestId[] = [],
): State {
  const st: State = {
    env,
    raw: isPlainObject(raw) ? raw : {},
    instances: [],
    values: new Map(),
    shown: new Set(),
    helperTests: new Set(),
  };
  const asked = (item: PrecheckItem) => !only || only.has(item.id);
  const helperItem = CHECK_DATA.precheck.find((q) => q.perTest);
  for (const item of CHECK_DATA.precheck) if (item !== helperItem && asked(item)) addItem(st, item);
  if (helperItem && asked(helperItem)) {
    // pc_helper depends on the helper rules, which depend on the other answers of the day.
    const day = computeDay(st);
    st.helperTests = day.helperTests;
    // The resume re-ask also keeps the helpers of the frozen protocol (O6 (2)).
    if (env.setting === "home")
      for (const t of extraHelpers) if (selected(st, t) && !fullySkipped(day, t)) st.helperTests.add(t);
    addItem(st, helperItem);
  }
  st.instances = st.instances
    .map((inst, pos) => ({ inst, pos }))
    .sort((a, b) => askOrder(env, a.inst.base) - askOrder(env, b.inst.base) || a.pos - b.pos)
    .map((x) => x.inst);
  return st;
}

/**
 * The questions that end the check at once with their own steps (spec 2.1 actions: emergency and
 * the AD response), in the order they are asked: pc_urgent, then for SCI the level question that
 * opens the AD question, then the AD question itself.
 */
// SPEC-GAP: ad-before-postpone. The data asks pc_sci_ad_now after the pain questions, and a postpone
// ends the questions early; a person with autonomic dysreflexia signs would then see a postpone screen
// instead of the AD steps. The AD gate is asked straight after pc_urgent, and no postpone ends the
// questions before it is answered (evaluatePrecheck).
const TERMINAL_GATE: readonly PrecheckId[] = ["pc_urgent", "pc_sci_level", "pc_sci_ad_now"];

/**
 * Data order, with the terminal gate first (after pc_setting, which is never asked). With an
 * unresolved changeReported the check goes straight to pc_change_cleared (Q33 (2)): right after the
 * terminal gate, before the other day of questions.
 */
// SPEC-GAP: change-cleared-first. "Goes straight to pc_change_cleared" is read as first after the
// emergency and AD questions, which are always asked first.
function askOrder(env: Pick<PrecheckEnv, "unresolvedChangeReported">, base: PrecheckId): number {
  const gate = TERMINAL_GATE.indexOf(base);
  const urgent = PRECHECK_INDEX.get("pc_urgent") ?? 0;
  if (gate >= 0) return urgent + gate / (TERMINAL_GATE.length + 1);
  if (base === "pc_change_cleared" && env.unresolvedChangeReported) {
    return urgent + TERMINAL_GATE.length / (TERMINAL_GATE.length + 1);
  }
  return PRECHECK_INDEX.get(base) ?? 0;
}

/** Every visible question of the terminal gate has an answer. */
function terminalGateAnswered(st: State): boolean {
  return st.instances.every((i) => !TERMINAL_GATE.includes(i.base) || st.values.has(i.id));
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
  helperBriefing: Partial<Record<TestId, ScreenId | HelperCheckInLine>>;
  warnings: ScreenId[];
}

interface Match {
  side?: Side;
  test?: TestId;
  areas?: AreaId[];
  surgeryAreas?: SurgeryAreaId[];
  /** Yes with none of the listed areas chosen (for example an ankle or a foot). */
  unlisted?: true;
}

/**
 * The tests an area outside the lists loads: the chair stand, the one test that bears weight on the
 * legs and feet (every arm, back, hip and trunk area is listed).
 */
// SPEC-GAP: unlisted-area. The spec maps only the listed areas to tests. Yes with no listed area is
// read as an area the check cannot place and that is not cleared (no clearance is asked for it), so
// the weight bearing test is skipped with the question's reason. For sign-off.
const UNLISTED_AREA_LOADS: readonly TestId[] = ["chair_stand_30s"];

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
  } else if (targets === "surgeryArea.loads" || targets === "area.loads") {
    const surgery = targets === "surgeryArea.loads";
    for (const a of (surgery ? m.surgeryAreas : m.areas) ?? []) applyAreaLoads(st, d, a, surgery, reason);
    if (m.unlisted)
      for (const t of UNLISTED_AREA_LOADS) for (const s of sidesOf(t)) skip(st, d, t, s, reason);
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

/**
 * The booth vitals rows of pc_booth_vitals (Q21 (4), O47). Every key present must hold:
 *   vitalsUnavailable       no validated cuff or no licensed practitioner;
 *   vitalsOutside           the mean systolic 160 or more or below 90, the mean diastolic 100 or
 *                           more, the heart rate above 120, or the irregular heartbeat flag;
 *   sciT6SystolicRiseGte    SCI at T6 or above with the mean systolic this far above the usual one;
 *   flag                    the pre-check flag holds (with a reading or unavailable: O47 (3), the
 *                           chair stand is not offered to sci_t6 whether or not the value is known);
 *   anyOf                   a mean systolic at or above the value, or an AD sign.
 */
function vitalsMatch(st: State, cond: ActionIf, v: AnswerValue | undefined): boolean {
  if (v === undefined) return false;
  if (cond.vitalsUnavailable) return v === "unavailable";
  if (cond.flag !== undefined && !stateCond(st).flag(cond.flag)) return false;
  const measured = isPlainObject(v) ? (v as unknown as Vitals) : undefined;
  if (cond.vitalsOutside) {
    if (!measured) return false;
    const lim = cond.vitalsOutside;
    const sys = meanSystolic(measured);
    const dia = meanDiastolic(measured);
    if (!(
      sys >= lim.meanSystolicGte ||
      sys < lim.meanSystolicLt ||
      dia >= lim.meanDiastolicGte ||
      measured.restingHeartRate > lim.restingHeartRateGt ||
      (lim.irregularHeartbeat && measured.irregularHeartbeat)
    ))
      return false;
  }
  if (cond.sciT6SystolicRiseGte !== undefined) {
    if (!measured || measured.usualSystolic === undefined || !sciT6(st)) return false;
    if (meanSystolic(measured) - measured.usualSystolic < cond.sciT6SystolicRiseGte) return false;
  }
  if (cond.anyOf) {
    if (!measured) return false;
    const any = cond.anyOf.some(
      (a) =>
        (a.meanSystolicGte !== undefined && meanSystolic(measured) >= a.meanSystolicGte) ||
        (a.adSign === true && measured.adSign === true),
    );
    if (!any) return false;
  }
  return true;
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
      const score = (a: AreaId) => (typeof scores[a] === "number" ? (scores[a] as number) : 0);
      let areas = AREA_IDS.filter((a) => score(a) >= (cond.areaScoreGte ?? Infinity));
      if (cond.areaLoadsSelectedTest) {
        // SPEC-GAP: area7-loads. "An area a selected test loads" counts every load of the area,
        // on any side and in any variant (the safe reading: more postpones).
        areas = areas.filter((a) => areaLoads(a, false).loads.some((l) => selected(st, l.test)));
      }
      return areas.length ? [{ areas }] : [];
    }
    case "system":
      return vitalsMatch(st, cond, value(st, item.id)) ? [{}] : [];
    case "yes_no_then_areas": {
      if (!scalarHolds(cond, value(st, item.id))) return [];
      const areas = value(st, questionId(item.id, "areas"));
      const list = Array.isArray(areas) ? areas : [];
      // Yes with none of the listed areas chosen: see UNLISTED_AREA_LOADS.
      if (list.length === 0) return Array.isArray(areas) ? [{ unlisted: true }] : [];
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

function applyAction(st: State, d: Day, a: QuestionAction, m: Match, from: PrecheckId) {
  switch (a.do) {
    case "record":
      if (a.stores) d.recorded.add(a.stores);
      break;
    case "emergency": {
      // pc_urgent yes also stores changeReported (Q33 (2)).
      if (a.stores) d.recorded.add(a.stores);
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
      // The follow up question's showIf makes it visible, except for pc_faint_since below.
      if (from === "pc_faint_since") {
        // SPEC-GAP: faint-since-route. The data asks pc_change_cleared after a yes; Q33 (3) reads
        // "yes postpones with recent_change and goes to pc_change_cleared", the interaction rule routes
        // a pc_faint_since yes at once, and the UX spec postpones and asks pc_change_cleared at the
        // next check. The safest reading is used: postpone at once (recent_change, next day, released
        // by a later yes to pc_change_cleared) and store changeReported so that question comes next.
        d.postpones.push({
          reason: "recent_change",
          screen: CHECK_DATA.postponeReasons.recent_change,
          lock: "next_day",
        });
        d.recorded.add("changeReported");
      }
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
        const briefing = a.screenByTest[m.test];
        // The two arm tests show the helper check in line with the confirm button (O34-2 (2)), not
        // a screen of their own.
        if (briefing && briefing !== "helperBriefing.checkInLine") warn(d, briefing);
        if (briefing) d.helperBriefing[m.test] = briefing;
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
  // side (setup.painSides) and, after stroke, the weaker arm whatever pc_weak_shoulder says. At the
  // booth the arm curl runs without weight for everyone (Q5).
  if (ctx.restrictions.includes("no_resistance") || ctx.clearance !== "yes" || setting === "booth") {
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
    // O34-2 (2): with no arm that can signal, every camera test left needs another adult.
    if (noArmSignal(st)) {
      for (const test of CHECK_DATA.tests.map((t) => t.id))
        if (selected(st, test) && !fullySkipped(d, test)) d.helperTests.add(test);
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
    helperBriefing: {},
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
    for (const a of item.actions)
      for (const m of matchesOf(st, item, a.if)) applyAction(st, d, a, m, item.id);
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

/** The reason whose lock an answer can release at once (locks.rules: pc_change_cleared yes). */
const RELEASABLE_REASONS: readonly PostponeReasonId[] = ["recent_change"];
/** Postpone screens that route to a doctor, the care team, 937 or 997 (spec 2.5). */
const CARE_SCREENS: readonly ScreenId[] = ["scr_postpone_care", "scr_postpone_pain"];

/** The rank of a postpone for the lock and the screen shown; higher wins. */
function postponeRank(p: Postpone): number {
  const locks = p.lock !== "none";
  const releasable = RELEASABLE_REASONS.includes(p.reason);
  // A lock no answer releases, by length; then a releasable lock; then no lock (sci_ready).
  const lockRank = locks && !releasable ? 2 + LOCK_RANK[p.lock] : locks ? 1 : 0;
  const careRank = CARE_SCREENS.includes(p.screen) ? CARE_SCREENS.length - CARE_SCREENS.indexOf(p.screen) : 0;
  return lockRank * 10 + careRank;
}

/**
 * The postpone shown and locked when one pre-check has several postpone reasons.
 *
 * The lock keeps the longest lock of all the reasons, under a reason no answer releases whenever one
 * of them locks: a yes to pc_change_cleared at a later attempt then releases nothing, so it cannot
 * lift a pain, ms_heat or pd_off lock with it (spec 2.1 same day locks). The screen is the one of
 * that reason; on a tie the care advice screens (scr_postpone_care, then scr_postpone_pain) win over
 * the others, then question order. The other care advice screens are shown with it (alsoShow).
 */
// SPEC-GAP: multi-postpone. The spec has one reason per postpone. The one lock row cannot hold every
// reason, so a releasable recent_change with a shorter fixed lock (ms_heat, pd_off) keeps the next day
// under the fixed reason: the safe side (it waits until tomorrow even after the change is cleared).
function pickPostpone(list: Postpone[]): { shown: Postpone; lock: CheckLock; alsoShow: ScreenId[] } {
  const shown = list.reduce((best, p) => (postponeRank(p) > postponeRank(best) ? p : best));
  const longest = list.reduce(
    (kind, p) => (LOCK_RANK[p.lock] > LOCK_RANK[kind] ? p.lock : kind),
    "none" as Postpone["lock"],
  );
  const alsoShow: ScreenId[] = [];
  for (const screen of CARE_SCREENS) {
    if (screen !== shown.screen && list.some((p) => p.screen === screen)) alsoShow.push(screen);
  }
  return { shown, lock: { reason: shown.reason, until: longest === "none" ? null : longest }, alsoShow };
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
 *   postpone    any postpone action, once the terminal gate (pc_urgent and, for SCI, pc_sci_level
 *               and pc_sci_ad_now) is answered; with several, see pickPostpone;
 *   incomplete  a visible question has no valid answer;
 *   proceed     with today's skips, variants, helpers, warnings, setup updates and stored fields.
 * `now` (epoch ms) dates changeCleared and changeReported.
 */
export function evaluatePrecheck(
  env: PrecheckEnv,
  answers: Answers,
  now: number = Date.now(),
): PrecheckOutcome {
  return outcomeOf(buildState(env, answers), now);
}

/** The outcome of a built state (evaluatePrecheck, evaluateResume). */
function outcomeOf(st: State, now: number): PrecheckOutcome {
  const d = computeDay(st);
  const date = riyadhDate(now);
  // SPEC-GAP: change-reported-on-postpone. changeReported is kept even though the check is not
  // stored, so an uncleared change cannot be bypassed after the lock ends (spec 2.2 pc_change note).
  const terminalStored: StoredPrecheck = d.recorded.has("changeReported") ? { changeReported: date } : {};
  // Either answer to pc_faint_since clears faintReported (Q33 (3)); an emergency keeps it.
  const faintCleared = d.recorded.has("faintReported cleared") ? { faintReportedCleared: true as const } : {};

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
  // A postpone ends the questions early, but never before the emergency and AD questions that are
  // shown are answered (TERMINAL_GATE).
  if (d.postpones.length > 0 && terminalGateAnswered(st)) {
    const { shown, lock, alsoShow } = pickPostpone(d.postpones);
    return {
      ...emptyOutcome("postpone"),
      reason: shown.reason,
      screen: shown.screen,
      ...(alsoShow.length ? { alsoShow } : {}),
      lock,
      stored: terminalStored,
      ...faintCleared,
    };
  }
  if (st.instances.some((i) => !st.values.has(i.id))) return emptyOutcome("incomplete");

  conditionWarnings(st, d);
  const helperRequired = [...d.helperTests].filter((t) => !fullySkipped(d, t));
  const helperBriefing: PrecheckOutcome["helperBriefing"] = {};
  for (const t of helperRequired) if (d.helperBriefing[t]) helperBriefing[t] = d.helperBriefing[t];
  const outcome: PrecheckOutcome = {
    status: "proceed",
    skips: sortedSkips(st, d),
    variants: dayVariants(st, d),
    helperRequired,
    warnings: d.warnings,
    setupUpdates: setupUpdates(st),
    stored: storedFields(st, d, date),
    ...faintCleared,
    checkIn: {
      raiseAllowed: raiseAllowed(st),
      noArmSignal: st.env.setting === "home" && noArmSignal(st),
      fineZoneSide: fineZoneSide(st),
    },
    helperBriefing,
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
  return kind === null ? null : lockEndsAt(kind, now);
}

/** The next local midnight in Asia/Riyadh after `now`, as epoch ms. */
function nextRiyadhMidnight(now: number): number {
  const localDayStart = Math.floor((now + RIYADH_OFFSET_MS) / DAY_MS) * DAY_MS;
  return localDayStart + DAY_MS - RIYADH_OFFSET_MS;
}

/** A next day lock lasts at least this long (Q33 (1)). */
export const NEXT_DAY_MIN_HOURS = 8;

/**
 * When a lock of this kind set at `now` ends, as epoch ms. A pre-check outcome's lock carries its
 * kind, which can be longer than its reason's own (pickPostpone), so the server reads the kind.
 * A next day lock ends at whichever comes later: midnight in Asia/Riyadh (the default time zone) or
 * 8 hours after it started (Q33 (1)); a 60 minute lock 60 minutes later.
 */
// SPEC-GAP: lock-time-zone. Q33 (1) names the person's time zone with Asia/Riyadh by default; no time
// zone is kept for a person yet, so every lock uses Asia/Riyadh (UTC+3 all year).
export function lockEndsAt(kind: LockKind, now: number): number {
  if (kind === "60_min") return now + 60 * 60 * 1000;
  return Math.max(nextRiyadhMidnight(now), now + NEXT_DAY_MIN_HOURS * HOUR_MS);
}

/** Lock reasons whose lock a clearance answer releases at once (locks.rules: releasableByClearance). */
const RELEASABLE_LOCKS: readonly string[] = ["recent_change"];

/**
 * The lock record kept per user (Q25 (c)): the time it ends and whether a clearance answer releases
 * it, never the reason id. Null for a reason without a lock (sci_ready). Deleted at expiry.
 */
export function lockRecord(
  lock: CheckLock,
  now: number,
): { until: number; releasableByClearance: boolean } | null {
  if (lock.until === null) return null;
  return {
    until: lockEndsAt(lock.until, now),
    releasableByClearance: RELEASABLE_LOCKS.includes(lock.reason),
  };
}

/**
 * Whether today's answers release a lock at once: a releasable lock (recent_change) is released by
 * a yes to pc_change_cleared, or yes_cleared in pc_sci_ad_since (locks.rules). Takes the lock record
 * of Q25 (c) ({ releasableByClearance }) or a lock with its reason.
 */
export function releasesLock(
  lock: { reason?: string; releasableByClearance?: boolean },
  env: PrecheckEnv,
  answers: Answers,
): boolean {
  const releasable =
    lock.releasableByClearance ?? (lock.reason !== undefined && RELEASABLE_LOCKS.includes(lock.reason));
  if (!releasable) return false;
  const st = buildState(env, answers);
  return value(st, "pc_change_cleared") === "yes" || value(st, "pc_sci_ad_since") === "yes_cleared";
}

/** A clock time on the 12 hour clock in Asia/Riyadh ({time} of Q33 (4)). */
export interface ClockTime {
  hour: number;
  minute: number;
  suffix: "am" | "pm";
}

function clockOf(t: number): ClockTime {
  const local = new Date(t + RIYADH_OFFSET_MS);
  const h = local.getUTCHours();
  return { hour: h % 12 === 0 ? 12 : h % 12, minute: local.getUTCMinutes(), suffix: h < 12 ? "am" : "pm" };
}

/**
 * {when} of scr_paused_today (Q33 (4), pausedWhenTokens): which line and, for the clock forms, the
 * time in Asia/Riyadh. `shown` is "start" on the screen of the postpone itself and "return" when the
 * person comes back while the lock is active. A 60 minute lock reads in about an hour at the start,
 * then after {time}; a next day lock reads tomorrow when it ends at midnight, tomorrow after {time}
 * when it ends at a clock time tomorrow, and after {time} on the day it ends.
 */
export function pausedWhen(
  lock: { kind: LockKind; until: number },
  now: number,
  shown: "start" | "return",
): { token: PausedWhenId; time?: ClockTime } {
  if (lock.kind === "60_min") {
    return shown === "start"
      ? { token: "min60_start" }
      : { token: "min60_active", time: clockOf(lock.until) };
  }
  if (riyadhDate(now) === riyadhDate(lock.until))
    return { token: "sameDay_clock", time: clockOf(lock.until) };
  const t = clockOf(lock.until);
  if (t.hour === 12 && t.minute === 0 && t.suffix === "am") return { token: "nextDay_midnight" };
  return { token: "nextDay_clock", time: t };
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
 * Whether bt_pain_after is asked after this test side (spec 2.3, O31): after each test and after each
 * side of a two sided test, except the side lean, where it is asked once when both sides are done.
 * `remaining` lists the test sides still to run today.
 */
export function painAfterDue(done: TestInstance, remaining: readonly TestInstance[]): boolean {
  if (done.testId !== "trunk_control_seated") return true;
  return !remaining.some((t) => t.testId === "trunk_control_seated");
}

/**
 * bt_pain_after, asked after each test and after each side of a two sided test, and once after both
 * sides of the side lean (spec 2.3, O31). A little more pain skips the remaining tests that load an
 * area the finished test loads (pain_more); much more or a sudden sharp pain ends the check for today.
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

/** ac_next_day is asked at the first app open 24 hours to 72 hours after a completed check (O38). */
export const AFTER_CHECK_WINDOW_HOURS: readonly [number, number] = [24, 72];
/** ...and never before this local hour (O38). */
export const AFTER_CHECK_EARLIEST_HOUR = 6;

export function afterCheckDue(completedAt: number, now: number): boolean {
  const hours = (now - completedAt) / HOUR_MS;
  if (hours < AFTER_CHECK_WINDOW_HOURS[0] || hours > AFTER_CHECK_WINDOW_HOURS[1]) return false;
  return new Date(now + RIYADH_OFFSET_MS).getUTCHours() >= AFTER_CHECK_EARLIEST_HOUR;
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
  /**
   * Ask this question next: bt_pain_after decides the rest after a pain stop; sf_faint_loc follows
   * every faint and fall stop (Q33 (3), O42), see faintFollowUp.
   */
  then?: "bt_pain_after" | StopFollowUpId;
  /**
   * What the stop keeps (dates only): changeReported after chest, stroke_signs and breath (Q33 (2)),
   * faintReported after every faint stop (Q33 (3)).
   */
  stores?: "changeReported" | "faintReported";
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

/**
 * scr_ad joins scr_emergency for every SCI condition or an SCI level at T6 or above (O12 (1)): on the
 * stop list, the faint follow up and the end of check question alike. The phone shows it at once and
 * the server sends the same list (server/modules/assessments/common.ts).
 */
export function emergencyAlsoShow(env: Pick<PrecheckEnv, "ctx" | "setup"> | null): "scr_ad"[] {
  if (!env) return [];
  const sci = has(env.ctx.conditions, SCI_CONDITIONS) || env.setup?.sciT6 === true;
  return sci ? ["scr_ad"] : [];
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
    ...(o.stores === "changeReported" || o.stores === "faintReported" ? { stores: o.stores } : {}),
    afterRest: o.check === "may continue with the next test after a rest",
  };
}

/* ------------------------------------------------------- the faint follow up */

export interface FollowUpOutcome {
  status: "emergency" | "recorded" | "incomplete";
  screen?: ScreenId;
  lock?: CheckLock;
  /** changeReported (date only) on the emergency route (Q33 (2), (3)). */
  stored: Pick<StoredPrecheck, "changeReported">;
}

/**
 * sf_faint_loc, «هل فقدت الوعي، ولو للحظة؟» · Did you pass out, even for a moment? (Q33 (3), O42),
 * asked after scr_faint and after every fall stop once the person is seated, lying or settled. Yes or
 * not sure opens scr_emergency and stores changeReported; no keeps the next day lock of the stop. A
 * faint stop that followed a no response alarm takes the emergency route whatever the answer. No
 * answer within 30 s runs the check in (the UI's timer): here that is incomplete.
 */
// SPEC-GAP: faint-after-no-response. Q33 (3) says a faint stop after a no response alarm "is handled
// the same way"; its engineering impact lists changeReported for it, so it is read as a yes.
export function faintFollowUp(
  answer: string | undefined,
  now: number,
  opts: { afterNoResponse?: boolean } = {},
): FollowUpOutcome {
  const q = CHECK_DATA.stopFollowUps[0];
  const v = oneOf(
    answer,
    q.options.map((o) => o.value as string),
  );
  const emergency = (): FollowUpOutcome => {
    const a = q.actions.find((x) => x.do === "emergency");
    return {
      status: "emergency",
      screen: a?.do === "emergency" ? a.screen : "scr_emergency",
      lock: { reason: "stop_symptom", until: "next_day" },
      stored: { changeReported: riyadhDate(now) },
    };
  };
  if (opts.afterNoResponse) return emergency();
  if (v === undefined) return { status: "incomplete", stored: {} };
  for (const a of q.actions) {
    if (a.do === "emergency" && (a.if.in as string[]).includes(v)) return emergency();
    if (a.do === "record" && a.if.equals === v) {
      return { status: "recorded", lock: { reason: "stop_symptom", until: a.lock }, stored: {} };
    }
  }
  return { status: "recorded", lock: { reason: "stop_symptom", until: "next_day" }, stored: {} };
}

/* -------------------------------------------- the end of check question */

/**
 * The form of the end of check symptom question (ec_symptoms, Q23 (7)), asked of everyone before any
 * result is shown, a check ended early included. `sides` are the one sided drops found today
 * (symptomAskSides of src/medical/progress-rules.ts, over every test with sides): one side names it
 * in the side form; none, or drops on both sides (in different tests), asks the general form.
 */
// SPEC-GAP: ec-side-conflict. The side form names one side; with one sided drops on different sides
// in different tests the general form is asked, which covers either side of the body.
export function endOfCheckForm(sides: readonly Side[]): { id: "ec_symptoms"; side?: Side } {
  const unique = [...new Set(sides)];
  return unique.length === 1 ? { id: "ec_symptoms", side: unique[0] } : { id: "ec_symptoms" };
}

/**
 * The answer to the end of check question (Q23 (7)): yes opens scr_emergency, the same route as
 * pc_urgent, and stores changeReported (Q33 (2)); no shows the results.
 */
// SPEC-GAP: ec-lock. The data action names no lock; "the same route as pc_urgent" is read with the
// pc_urgent next day lock, so a check ended early cannot be restarted at once.
export function endOfCheck(
  answer: string | undefined,
  now: number,
): {
  status: "emergency" | "proceed" | "incomplete";
  screen?: ScreenId;
  lock?: CheckLock;
  stored: Pick<StoredPrecheck, "changeReported">;
} {
  const q = CHECK_DATA.endOfCheck[0];
  const v = oneOf(
    answer,
    q.options.map((o) => o.value as string),
  );
  if (v === undefined) return { status: "incomplete", stored: {} };
  const a = q.actions.find((x) => x.if.equals === v);
  if (!a) return { status: "proceed", stored: {} };
  return {
    status: "emergency",
    screen: a.screen,
    lock: { reason: "urgent", until: lockKind("urgent") ?? "next_day" },
    stored: { changeReported: riyadhDate(now) },
  };
}

/* --------------------------------------------- the chair stand setup (Q9) */

function setupCond(env: PrecheckEnv): CondContext {
  return { env, answer: () => undefined, flag: () => false };
}

/**
 * The chair stand setup questions on its setup screen at home (Q9): su_chair_gate whenever the chair
 * stand runs, su_same_chair from the second check of the series.
 */
export function setupQuestionsFor(env: PrecheckEnv): SetupQuestionId[] {
  return CHECK_DATA.setupQuestions.filter((q) => showIfHolds(q.showIf, setupCond(env))).map((q) => q.id);
}

/**
 * The chair stand setup answers (Q9): su_chair_gate no skips the chair stand today with chair_needed
 * (a same day skip, no substitute); su_same_chair yes keeps the chair, no and not sure are stored as
 * no (fingerprint.sameChair false), so a blocking difference starts a new series.
 */
export function evaluateSetupQuestions(
  env: PrecheckEnv,
  answers: Answers,
): { status: "proceed" | "incomplete"; skips: SkipItem[]; sameChair?: boolean } {
  const ids = setupQuestionsFor(env);
  const skips: SkipItem[] = [];
  let sameChair: boolean | undefined;
  for (const q of CHECK_DATA.setupQuestions) {
    if (!ids.includes(q.id)) continue;
    const v = oneOf(
      answers?.[q.id],
      q.options.map((o) => o.value as string),
    );
    if (v === undefined) return { status: "incomplete", skips: [] };
    for (const a of q.actions) {
      if (a.do === "skip" && a.if.equals === v) {
        for (const t of a.tests) skips.push({ testId: t.test, side: "none", reason: a.reason });
      }
    }
    if (q.id === "su_same_chair") sameChair = v === "yes";
  }
  return { status: "proceed", skips, ...(sameChair === undefined ? {} : { sameChair }) };
}

/* ----------------------------------------------------- the wording (Q18) */

/** Which text of a question the person sees (Q18, Q33 (2), Q12 (1), O45, O37). */
export interface QuestionForm {
  /** The data field of the question text: ask, askFirstCheck, askDirect or askByPosition. */
  text: "ask" | "askFirstCheck" | "askDirect" | "askByPosition";
  /** askByPosition: the form of the person's position. */
  position?: "chair" | "wheelchair";
  /** Home only: the question alone, then the examples list (pc_change, pc_unwell; O45). */
  examples: boolean;
  /**
   * The long standing signs line applies to this person (O37: a weaker side or the listed
   * conditions). Its data status holds it back until the Q18 (6) testing of the line is complete.
   */
  chronicNote: boolean;
}

/**
 * The wording of a question instance for this person: askFirstCheck at the first check of a series
 * (pc_change, the fell question of pc_steadi), askDirect for pc_change_cleared with an unresolved
 * changeReported (Q33 (2)), the position form of pc_trunk_armrests (Q12 (1)), the examples list at
 * home (O45) and whether the chronic line applies (O37). The text itself always comes from the data.
 */
export function questionForm(env: PrecheckEnv, answers: Answers, id: string): QuestionForm {
  const parsed = parseQuestionId(id);
  if (!parsed) throw new RangeError(`Unknown question ${id}`);
  const item = PRECHECK_BY_ID.get(parsed.base)!;
  const st = buildState(env, answers);
  const sub = item.items?.find((x) => x.id === parsed.part);
  let text: QuestionForm["text"] = "ask";
  if (item.askByPosition) text = "askByPosition";
  else if (item.askDirect && env.unresolvedChangeReported && value(st, "pc_change") !== "yes")
    text = "askDirect";
  else if (env.firstCheck && (sub ? sub.askFirstCheck : item.askFirstCheck)) text = "askFirstCheck";
  return {
    text,
    ...(text === "askByPosition" ? { position: positionForm(env) } : {}),
    examples: item.examples !== undefined && env.setting === "home",
    chronicNote: item.chronicNote !== undefined && showIfHolds(item.chronicNote.showIf, stateCond(st)),
  };
}

/** Whether the end of check question's chronic line applies to this person (O37). */
export function endOfCheckChronicNote(env: Pick<PrecheckEnv, "ctx"> & Partial<PrecheckEnv>): boolean {
  const cond: CondContext = { env: env as PrecheckEnv, answer: () => undefined, flag: () => false };
  return showIfHolds(CHECK_DATA.endOfCheck[0].chronicNote.showIf, cond);
}

/* ------------------------------------------------- the counter (O9) */

/** Questions whose answers can make the chair stand run hands allowed or need a helper (4.4, Q11). */
const CHAIR_HELPER_TRIGGERS: readonly PrecheckId[] = CHECK_DATA.precheck
  .filter((q) =>
    q.actions.some(
      (a) =>
        (a.do === "variant" &&
          a.tests.some((t) => t.test === "chair_stand_30s") &&
          (a.variant === "arms_assisted" || a.alsoDo === "require_helper")) ||
        (a.do === "require_helper" && a.tests.some((t) => t.test === "chair_stand_30s")),
    ),
  )
  .map((q) => q.id);

/**
 * Every question instance that can still appear for this person, given the answers so far (O9, the
 * S17 counter): the visible questions, and every question whose condition an unanswered question
 * can still make true (an unanswered question that can appear counts as any answer; a sub question
 * whose count is not known yet counts at its most, such as a clearance question per surgery area).
 * It starts at its upper bound and only shrinks as answers come in.
 */
export function possibleQuestions(env: PrecheckEnv, answers: Answers): string[] {
  const st = buildState(env, answers);
  // Skips that can still be lifted are not counted: a surgery area whose clearance is not answered
  // yet counts as cleared here (it counts as not cleared for the decision itself).
  const hopeful: Answers = { ...(isPlainObject(answers) ? answers : {}) };
  const chosen = value(st, questionId("pc_surgery_recent", "areas"));
  if (Array.isArray(chosen))
    for (const a of chosen) {
      const id = questionId("pc_surgery_recent", a);
      if (!st.values.has(id)) hopeful[id] = "yes";
    }
  const day = computeDay(buildState(env, hopeful));
  const pending = new Set<string>();
  const out: Instance[] = [];
  const add = (base: PrecheckId, part?: string) => {
    const id = questionId(base, part);
    out.push({ id, base, part });
    if (!st.values.has(id)) {
      pending.add(id);
      if (part === undefined) pending.add(base);
    }
  };
  const isPending = (id: string) => pending.has(id);
  const sciMaybe = () => {
    const v = value(st, "pc_sci_level");
    if (v !== undefined) return v === "yes" || v === "unsure";
    return isPending("pc_sci_level") || env.setup?.sciT6 === true;
  };
  const sideMaybeWithoutSignal = (s: Side) =>
    armWithoutSignal(st, s) ||
    (limbArm(st) === undefined && isPending("pc_limb_arm_side")) ||
    (env.ctx.support === s && isPending("pc_weak_lift")) ||
    isPending(questionId("pc_arm_function", s));
  const noArmMaybe = () =>
    env.setting === "home" && (noArmSignal(st) || SIDES.every((s) => sideMaybeWithoutSignal(s)));
  const helperMaybe = (test: TestId) => {
    if (env.setting !== "home" || !selected(st, test) || fullySkipped(day, test)) return false;
    if (day.helperTests.has(test) || noArmMaybe()) return true;
    return (
      test === "chair_stand_30s" &&
      CHAIR_HELPER_TRIGGERS.some((id) => [...pending].some((p) => p.split(PART_SEPARATOR)[0] === id))
    );
  };
  const cond = (test?: TestId): CondContext => ({
    env,
    answer: (id) => value(st, id),
    pending: isPending,
    flag: (f) =>
      f === "sci_t6"
        ? sciMaybe()
        : f === "noArmSignal"
          ? noArmMaybe()
          : test !== undefined && helperMaybe(test),
  });

  let helperItem: PrecheckItem | undefined;
  for (const item of CHECK_DATA.precheck) {
    if (item.id === "pc_setting") continue;
    if (item.perTest) {
      helperItem = item;
      continue;
    }
    if (!showIfHolds(item.showIf, cond())) continue;
    if (item.group === "baseline_setup" && !env.firstCheck && !setupMissing(st, item.id)) continue;
    if (item.type === "yes_no_then_areas") {
      add(item.id);
      const base = value(st, item.id);
      if (base !== "yes" && base !== undefined) continue;
      add(item.id, "areas");
      if (item.surgeryAreas) {
        const chosen = value(st, questionId(item.id, "areas"));
        for (const a of Array.isArray(chosen) ? chosen : SURGERY_AREA_IDS) add(item.id, a);
      }
    } else if (item.items) {
      for (const sub of item.items) add(item.id, sub.id);
    } else if (item.perArea) {
      for (const area of item.perArea) if (env.ctx.pain.includes(area)) add(item.id, area);
    } else if (item.perSide) {
      const lost = limbArm(st);
      for (const side of ["right", "left"] as const) if (side !== lost) add(item.id, side);
    } else if (item.askByPosition) {
      add(item.id, positionForm(env));
    } else {
      add(item.id);
    }
  }
  if (helperItem) {
    for (const test of perTestOrder(env, helperItem))
      if (helperMaybe(test) && showIfHolds(helperItem.showIf, cond(test))) add(helperItem.id, test);
  }
  const ids = new Map<string, Instance>();
  for (const i of [...st.instances, ...out]) if (!ids.has(i.id)) ids.set(i.id, i);
  return [...ids.values()]
    .map((inst, pos) => ({ inst, pos }))
    .sort((a, b) => askOrder(env, a.inst.base) - askOrder(env, b.inst.base) || a.pos - b.pos)
    .map((x) => x.inst.id);
}

/* ------------------------------------------------------ the resume (O6) */

/**
 * The questions asked again when a check resumes within 30 minutes (O6 (2)): pc_urgent, pc_unwell,
 * pc_pain_now (and pc_pain_areas when pain now is 1 or more); pc_sci_ad_now and pc_sci_ready for
 * sci_t6; pc_pd_on for Parkinson's; pc_ms_heat for MS; and at home pc_helper for every remaining test
 * that requires a helper.
 */
export const RESUME_QUESTION_IDS: readonly PrecheckId[] = [
  "pc_urgent",
  "pc_unwell",
  "pc_pain_now",
  "pc_pain_areas",
  "pc_sci_ad_now",
  "pc_sci_ready",
  "pc_pd_on",
  "pc_ms_heat",
  "pc_helper",
];
const RESUME_SET: ReadonlySet<PrecheckId> = new Set(RESUME_QUESTION_IDS);

/** A remaining test: its id, or its frozen protocol item with the helper it requires. */
export type RemainingTest = TestId | { testId: TestId; helperRequired?: boolean };

function resumeState(env: PrecheckEnv, answers: Answers, remaining: readonly RemainingTest[]): State {
  const ids = remaining.map((r) => (typeof r === "string" ? r : r.testId));
  const helpers = remaining.flatMap((r) => (typeof r !== "string" && r.helperRequired ? [r.testId] : []));
  const baseTests = [
    ...env.baseTests.filter((t) => ids.includes(t as TestId)),
    ...ids.filter((t) => !env.baseTests.includes(t)),
  ];
  return buildState({ ...env, baseTests }, answers, RESUME_SET, helpers);
}

/**
 * The questions to ask again on resume, in order, for the tests still to run (O6 (2)). `env.setup`
 * must include today's setup updates (the SCI level answered earlier today).
 */
export function resumeQuestions(
  env: PrecheckEnv,
  answers: Answers,
  remaining: readonly RemainingTest[],
): string[] {
  return resumeState(env, answers, remaining).instances.map((i) => i.id);
}

/**
 * The resume answers routed as usual (O6 (2)): an emergency, AD response or postpone closes the
 * check as ended early, with the finished results kept; a proceed carries the new skips of the
 * remaining tests (pain today, a helper not there).
 */
export function evaluateResume(
  env: PrecheckEnv,
  answers: Answers,
  remaining: readonly RemainingTest[],
  now: number = Date.now(),
): PrecheckOutcome {
  return outcomeOf(resumeState(env, answers, remaining), now);
}

/* ------------------------------------------- the spoken answer (Q31 (4)) */

const SPEECH = CHECK_DATA.engine.speech;
const ALEF = /[أإآٱ]/g;

/** Lower case words: Arabic marks and tatweel removed, alef forms joined, punctuation as spaces. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    .replace(ALEF, "ا")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function containsPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0) return false;
  for (let i = 0; i + phrase.length <= tokens.length; i++)
    if (phrase.every((w, k) => tokens[i + k] === w)) return true;
  return false;
}

/**
 * A spoken check in answer, where speech recognition runs on the device itself (Q31 (4), O5):
 * whole words only; any not fine word anywhere wins and opens scr_emergency ("not_fine"); fine only
 * as a phrase of well being ("fine"); a bare yes word, الحمد لله alone or unclear speech is no answer,
 * so the check in cue plays once more and the no response timer keeps running.
 */
export function spokenCheckInAnswer(utterance: string, lang: Lang): "fine" | "not_fine" | "no_answer" {
  const tokens = words(utterance ?? "");
  if (SPEECH.notFineWords[lang].some((w) => containsPhrase(tokens, words(w)))) return "not_fine";
  if (SPEECH.fineOnlyPhrases[lang].some((p) => containsPhrase(tokens, words(p)))) return "fine";
  return "no_answer";
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
    system: ["vitalsOutside", "sciT6SystolicRiseGte", "flag", "anyOf", "vitalsUnavailable", "equals"],
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
