/**
 * Movement check: setting, context, setup and protocol selection (contract v2, section B; clinical
 * spec 3.1 to 3.4 and 5 "Re-test interval").
 *
 *   contextFromIntake  who gets a check at all (spec 3.1), from the stored intake and plan; at the
 *                      booth stroke and SCI without clearance yes get the booth arm raise (Q19)
 *   guestContext       the same gate for the booth guest steps with their clearance answer (Q19)
 *   baseSelection      tests per position in fixed order, intake level exclusions, the booth rule of
 *                      Q19 (5b), the trunk substitute for standing users, sides and side order
 *                      (spec 3.2 to 3.4)
 *   finalizeProtocol   today's protocol after the pre-check: skips, variants, helper, band, and
 *                      whether the substitute ran (P6)
 *   estimateMinutes    the computed duration of a check (O40)
 *   checkSchedule      due 28 days after the last home check; 48 hours minimum between checks; the
 *                      booth and the side lean only session (H9, Q12 (2), Q33)
 *   allowedLoads       the loads an arm may use (Q5)
 *
 * Rules before AI: every decision is a fixed rule. Values (tests per position, exclusion keys, side
 * order, retest days) come from src/movements/check-v1.json; rules the data only describes in prose
 * (review reasons, substitution, which exclusion reason is shown) are written by hand from the spec.
 * Pure TypeScript, no DOM and no window: shared by the client and the server.
 */
import { CHECK_DATA, testDef } from "../movements/assessments";
import type {
  CheckPosition,
  Clearance,
  ReasonId,
  Restriction,
  Setting,
  Side,
  Support,
  TestId,
} from "../movements/types";
import { conditions as CONDITION_IDS, painOptions, restrictionOptions } from "./plan";
import type { Intake, Plan } from "./plan";
import {
  dayVariant,
  possibleQuestions,
  type PrecheckEnv,
  type PrecheckOutcome,
  type TestSide,
} from "./precheck";
import { LOAD_LIMITS, checkTimeBand } from "./progress-rules";

export type { CheckPosition, Setting };

/* ------------------------------------------------------------------ types */

/** From the intake (signed in) or from the guest steps (booth; the guest answers clearance, Q19 (2)). */
export interface CheckContext {
  position: CheckPosition;
  support: Support;
  pain: string[];
  restrictions: string[];
  conditions: string[];
  clearance: Clearance;
}

/**
 * Asked at the first check of a series and kept with the setup (spec 2.1 data map), so the rules
 * and the comparison series stay stable. The prostheses are answered at every check (worn now).
 */
export interface StoredSetup {
  painSides?: Side[];
  limbLoss?: { arm?: Side; leg?: Side };
  sciT6?: boolean;
  armProsthesis?: boolean;
  legProsthesis?: boolean;
}

/** No check today: a clinical review reason (spec 3.1) or a guest answer that cannot be used. */
export interface Blocked {
  blocked: BlockedReason;
}

/**
 * One test side of the base selection (spec 3.2 to 3.4), in the order the check runs it.
 * An item with `excluded` never runs; it is listed so the reason can be shown with the results.
 */
export interface SelectionItem {
  testId: TestId;
  side: TestSide;
  version: number;
  /** 1 based position in the check, excluded items included. */
  order: number;
  /** Intake level exclusion, a reason id of spec 3.6. */
  excluded?: ReasonId;
  /** The seated side lean in the chair stand slot of a standing person (spec 3.2). */
  substitute?: true;
}

/**
 * Test variant of a protocol item. The chair stand always has one (standard by default). The arm
 * curl has one only when the pre-check limits the load: arm_only (no added weight) or
 * cuff_or_arm_only (a wrist weight or none); otherwise the person picks the load at the baseline
 * (held, cuff or none) and it stays locked per arm (spec 4.2).
 */
// SPEC-GAP: contract-variants. Contract v2 B lists hands_allowed, which is not a data id (the data
// labels arms_assisted "Hands allowed"); cuff_or_arm_only and arms_assisted_steady are added here.
export type ProtocolVariant =
  "arm_only" | "cuff_or_arm_only" | "standard" | "arms_assisted" | "arms_assisted_steady" | "one_arm_cross";

export interface ProtocolItem {
  testId: TestId;
  side: TestSide;
  version: number;
  order: number;
  variant?: ProtocolVariant;
  /**
   * Hands allowed chair stand: the only hand that may push (spec 4.4 pushing arm). Contract
   * addition, stored as detail.pushHand with the result.
   */
  // SPEC-GAP: push-hand-field. Contract B has no field for the push hand.
  pushHand?: Side;
  /** Another adult stays beside the person for this test (home only). */
  helperRequired?: boolean;
  /** Band of the test rules known when the check starts (context and setup). */
  band: "default" | "wide";
  /** Intake level exclusion or same day skip, a reason id of spec 3.6. */
  skipped?: ReasonId;
  /** The seated side lean in the chair stand slot of a standing person (spec 3.2). */
  substitute?: true;
  /**
   * The excluded chair stand whose slot the side lean actually runs in today (P6): its skip reason
   * gets reasonSuffixes.substituteRan, for the reasons listed in appendTo only.
   */
  substituteRan?: true;
}

/* -------------------------------------------------------------- the gate */

/**
 * Plan review reasons that block the check (spec 3.1), in the order the first one is reported.
 * unsupported_position is mobility bed; restriction is no_exercise; unknown_condition is other;
 * clearance is stroke or SCI without clearance yes; pem is cfs_moderate.
 */
export const CLINICAL_REVIEW_REASONS = [
  "unsupported_position",
  "cardiac",
  "symptoms",
  "recent_change",
  "restriction",
  "unknown_condition",
  "clearance",
  "pem",
] as const;
/** Plan review reasons about scheduling, which never block the check (spec 3.1, Q20). */
export const SCHEDULING_REVIEW_REASONS = ["recovery", "duration", "no_exercises"] as const;

export type ClinicalReviewReason = (typeof CLINICAL_REVIEW_REASONS)[number];
/**
 * review: a plan in review with no reason listed; invalid_input: an intake or guest answer outside
 * the allowed values; any other string is an unknown plan review reason (blocks: the safe side).
 */
export type BlockedReason = ClinicalReviewReason | "review" | "invalid_input" | (string & {});

/** Conditions whose plan requires clearance yes (the plan's requiresMedicalClearance configs). */
const CLEARANCE_CONDITIONS = ["stroke", "sci_complete", "sci_incomplete"];

/**
 * The booth rule of Q19 (5b): stroke, sci_complete or sci_incomplete with clearance no or not sure.
 * At the booth such a person runs the seated arm raise only (active, no load, all its rules, staff
 * within reach); the side lean, the arm curl and the chair stand are skipped with clearance_booth.
 * At home the same person gets no check (spec 3.1).
 */
export function boothClearanceRule(ctx: Pick<CheckContext, "conditions" | "clearance">): boolean {
  return ctx.clearance !== "yes" && CLEARANCE_CONDITIONS.some((c) => ctx.conditions.includes(c));
}
/** The one test of the Q19 (5b) booth rule. */
const BOOTH_RULE_TEST: TestId = "shoulder_abduction";

const MOBILITY_TO_POSITION: Record<string, CheckPosition> = {
  seated: "chair",
  wheelchair: "wheelchair",
  standing: "standing",
};

interface GateInput {
  position: CheckPosition | "bed";
  conditions: readonly string[];
  restrictions: readonly string[];
  clearance: Clearance;
  symptoms?: "yes" | "no";
  recentChange?: "yes" | "no";
}

/**
 * The clinical review reasons of spec 3.1 that hold for these answers, in report order. At the
 * booth the clearance reason does not block: the booth rule of Q19 (5b) applies instead (3.1, Q20).
 */
function gateReasons(g: GateInput, setting: Setting = "home"): ClinicalReviewReason[] {
  return gateReasonsAtHome(g).filter((r) => !(setting === "booth" && r === "clearance"));
}

function gateReasonsAtHome(g: GateInput): ClinicalReviewReason[] {
  const holds: Record<ClinicalReviewReason, boolean> = {
    unsupported_position: g.position === "bed",
    cardiac: g.conditions.includes("cardiac"),
    symptoms: g.symptoms === "yes",
    recent_change: g.recentChange === "yes",
    restriction: g.restrictions.includes("no_exercise"),
    unknown_condition: g.conditions.includes("other"),
    clearance: g.clearance !== "yes" && CLEARANCE_CONDITIONS.some((c) => g.conditions.includes(c)),
    pem: g.conditions.includes("cfs_moderate"),
  };
  return CLINICAL_REVIEW_REASONS.filter((r) => holds[r]);
}

function isList(v: unknown, allowed: readonly string[]): v is string[] {
  return (
    Array.isArray(v) &&
    new Set(v).size === v.length &&
    v.every((x) => typeof x === "string" && allowed.includes(x))
  );
}

const SUPPORTS: readonly string[] = ["none", "left", "right"];
const CLEARANCES: readonly string[] = ["yes", "no", "unsure"];

/**
 * The check context of a signed in person (spec 3.1), or why there is no check. Blocks for mobility
 * bed and every clinical review reason; ignores the scheduling reasons (recovery, duration,
 * no_exercises). The clinical reasons are read from the plan and again from the intake, so a plan
 * made before an intake change cannot open the check. Mobility seated maps to the chair position.
 * At the booth (a signed in visitor runs in booth mode, Q19 (6)) stroke and SCI without clearance yes
 * are not blocked: baseSelection gives them the booth arm raise only (3.1, Q19 (5b), Q20).
 */
export function contextFromIntake(
  intake: Intake,
  plan: Plan,
  setting: Setting = "home",
): CheckContext | Blocked {
  if (
    !intake ||
    !isList(intake.conditions, CONDITION_IDS) ||
    !isList(intake.pain, painOptions) ||
    !isList(intake.restrictions, restrictionOptions) ||
    !SUPPORTS.includes(intake.support) ||
    !CLEARANCES.includes(intake.clearance)
  ) {
    return { blocked: "invalid_input" };
  }
  const position = MOBILITY_TO_POSITION[intake.mobility];
  const gate: GateInput = {
    position: position ?? "bed",
    conditions: intake.conditions,
    restrictions: intake.restrictions,
    clearance: intake.clearance,
    symptoms: intake.symptoms,
    recentChange: intake.recentChange,
  };
  const fromIntake = gateReasons(gate, setting);
  const scheduling: readonly string[] = SCHEDULING_REVIEW_REASONS;
  // At the booth the plan's clearance reason gives way to the booth rule, only when the intake shows
  // that rule holds (stroke or SCI without clearance yes).
  const boothRule =
    setting === "booth" && boothClearanceRule(intake as Pick<CheckContext, "conditions" | "clearance">);
  // R3C-29 (17) (unknown-plan-reason, confirmed 2026-09-30). A plan reason that is neither a clinical nor a scheduling reason
  // of spec 3.1 blocks the check (the safe side), and so does a plan in review without a reason.
  const fromPlan = (plan?.reasons ?? []).filter(
    (r) => !scheduling.includes(r) && !(boothRule && r === "clearance"),
  );
  const found = new Set<string>([...fromIntake, ...fromPlan]);
  const first = [...CLINICAL_REVIEW_REASONS, ...fromPlan].find((r) => found.has(r));
  if (first) return { blocked: first };
  if (plan?.status === "review" && (plan.reasons ?? []).length === 0) return { blocked: "review" };
  if (!position) return { blocked: "unsupported_position" };
  return {
    position,
    support: intake.support,
    pain: [...intake.pain],
    restrictions: [...intake.restrictions],
    conditions: [...intake.conditions],
    clearance: intake.clearance,
  };
}

/** What the booth guest answers before a check (contract B, Q19). Nothing of it is stored. */
export interface GuestSteps {
  position: CheckPosition | "bed";
  support: Support;
  pain: string[];
  restrictions: string[];
  /**
   * Empty means no condition (none). The guest chip sci_unsure («إصابة في الحبل الشوكي، ولا أعرف
   * نوعها») maps to sci_complete, the stricter rules (O20).
   */
  conditions: string[];
  /**
   * The intake's clearance question, asked of every guest word for word (Q19 (2)); a skipped
   * answer (missing or null) counts as not sure.
   */
  clearance?: Clearance | null;
}

/** The guest condition chip that maps to sci_complete (O20). */
export const GUEST_SCI_UNSURE = "sci_unsure";

/**
 * The check context of a booth guest, or why there is no check (Q19 (5)), evaluated on the device
 * only: (a) bed, cardiac, other, cfs_moderate or the no_exercise restriction get no movement check
 * (scr_booth_no_check); (b) stroke, sci_complete or sci_incomplete with clearance no or not sure get a
 * context, and baseSelection at the booth gives them the seated arm raise only (clearance_booth for
 * the rest); (c) everyone else follows 3.1 and 3.3, with Q6 and Q21 for clearance no or not sure.
 */
export function guestContext(steps: GuestSteps): CheckContext | Blocked {
  const positions: readonly string[] = ["chair", "wheelchair", "standing", "bed"];
  const guestConditions: readonly string[] = [...CONDITION_IDS, GUEST_SCI_UNSURE];
  if (
    !steps ||
    !positions.includes(steps.position) ||
    !SUPPORTS.includes(steps.support) ||
    !isList(steps.pain, painOptions) ||
    !isList(steps.restrictions, restrictionOptions) ||
    !isList(steps.conditions, guestConditions) ||
    (steps.conditions.length > 1 && steps.conditions.includes("none")) ||
    (steps.clearance !== undefined && steps.clearance !== null && !CLEARANCES.includes(steps.clearance))
  ) {
    return { blocked: "invalid_input" };
  }
  const mapped = steps.conditions.map((c) => (c === GUEST_SCI_UNSURE ? "sci_complete" : c));
  const conditions = mapped.length ? [...new Set(mapped)] : ["none"];
  const clearance: Clearance = steps.clearance ?? "unsure";
  const [first] = gateReasons(
    {
      position: steps.position,
      conditions,
      restrictions: steps.restrictions,
      clearance,
    },
    "booth",
  );
  if (first || steps.position === "bed") return { blocked: first ?? "unsupported_position" };
  return {
    position: steps.position,
    support: steps.support,
    pain: [...steps.pain],
    restrictions: [...steps.restrictions],
    conditions,
    clearance,
  };
}

export function isBlocked(c: CheckContext | Blocked): c is Blocked {
  return "blocked" in c;
}

/* --------------------------------------------------------- base selection */

const otherSide = (s: Side): Side => (s === "left" ? "right" : "left");
const ARM_TESTS: readonly TestId[] = ["shoulder_abduction", "arm_curl_30s"];

/** Reason shown for an intake restriction that excludes a test (spec 3.6). */
const RESTRICTION_REASON: Partial<Record<Restriction, ReasonId>> = {
  no_overhead: "restriction_overhead",
  no_weight_bearing: "restriction_weight_bearing",
  balance_support: "restriction_balance",
};
/** Reason shown for an intake condition that excludes a test (spec 3.3, 3.6). */
const CONDITION_REASON: Record<string, ReasonId> = {
  lower_limb_unilateral: "limb_loss_leg",
  sci_complete: "position_seated",
};
/**
 * The intake level exclusion of a whole test, read from tests[].exclusions (pain, restrictions,
 * conditions, limb loss leg, home only exclusions), or undefined. With several, the first in the
 * row order of the matrix in spec 3.3 is shown: pain, restrictions, clearance, limb loss, SCI. At the
 * booth the rule of Q19 (5b) comes first: every test but the seated arm raise is clearance_booth.
 */
export function intakeExclusion(
  test: TestId,
  ctx: CheckContext,
  setting: Setting,
  setup: StoredSetup | null,
): ReasonId | undefined {
  if (setting === "booth" && boothClearanceRule(ctx) && test !== BOOTH_RULE_TEST) return "clearance_booth";
  const ex = testDef(test).exclusions;
  if (ex.pain.some((p) => ctx.pain.includes(p))) return "pain_area";
  const home = setting === "home" ? ex.homeOnlyExclusion : undefined;
  const restrictions = [...ex.restrictions, ...(home?.restrictions ?? [])];
  for (const r of restrictionOptions) {
    const reason = RESTRICTION_REASON[r];
    if (reason && restrictions.includes(r) && ctx.restrictions.includes(r)) return reason;
  }
  if (home?.clearance?.includes(ctx.clearance)) return "clearance";
  const legLoss = ctx.conditions.includes("lower_limb_unilateral") || setup?.limbLoss?.leg !== undefined;
  if (ex.limbLoss.includes("leg") && legLoss) return "limb_loss_leg";
  for (const c of ex.conditions) {
    const reason = CONDITION_REASON[c];
    if (reason && ctx.conditions.includes(c)) return reason;
  }
  return undefined;
}

/**
 * Side order of a test (spec 3.4): abduction stronger side first, arm curl weaker arm first, side
 * lean toward the stronger side first; with no weaker side, right before left. Tests without sides
 * have the single side none.
 */
export function sideOrder(test: TestId, support: Support): TestSide[] {
  const def = testDef(test);
  if (def.sides === "none" || !("sideOrder" in def)) return ["none"];
  const weaker = support === "none" ? undefined : support;
  const first: Side =
    def.sideOrder === "weaker_first" ? (weaker ?? "right") : weaker ? otherSide(weaker) : "right";
  return [first, otherSide(first)];
}

/**
 * The tests of the check before the pre-check (spec 3.2 to 3.4): the fixed order of the position,
 * one item per side in the side order of each test, intake level exclusions listed with their
 * reason, the arm limb loss side listed as limb_loss_arm (known from the stored setup; at the first
 * check the pre-check asks it), and for a standing person whose chair stand is excluded at intake
 * level the seated side lean in its slot, unless the side lean is excluded too. Chair and wheelchair
 * users see the chair stand listed as not offered (position_seated). No check context, no items.
 */
// SPEC-GAP: position-seated-text. The reason position_seated says the check uses the seated side
// lean instead; for a seated person whose side lean is excluded too (back pain, balance support at
// home) the chair stand is still listed with that reason, as in the matrix (spec 3.3).
export function baseSelection(
  ctx: CheckContext,
  setting: Setting,
  setup: StoredSetup | null,
): SelectionItem[] {
  // The gate of spec 3.1 again, so a context built by hand cannot open a check either (at the booth
  // with the rule of Q19 (5b) in place of the clearance reason).
  if (gateReasons(ctx, setting).length > 0 || !(ctx.position in CHECK_DATA.selection.basePerPosition))
    return [];
  const out: SelectionItem[] = [];
  const push = (testId: TestId, extra: Pick<SelectionItem, "excluded" | "substitute"> = {}) => {
    const lostArm = ARM_TESTS.includes(testId) ? setup?.limbLoss?.arm : undefined;
    for (const side of sideOrder(testId, ctx.support)) {
      const item: SelectionItem = { testId, side, version: testDef(testId).version, order: out.length + 1 };
      const excluded =
        extra.excluded ?? (lostArm !== undefined && side === lostArm ? "limb_loss_arm" : undefined);
      if (excluded) item.excluded = excluded;
      if (extra.substitute) item.substitute = true;
      out.push(item);
    }
  };
  for (const testId of CHECK_DATA.selection.basePerPosition[ctx.position]) {
    const excluded = intakeExclusion(testId, ctx, setting, setup);
    push(testId, excluded ? { excluded } : {});
    const trunk: TestId = "trunk_control_seated";
    if (testId === "chair_stand_30s" && excluded && !intakeExclusion(trunk, ctx, setting, setup)) {
      push(trunk, { substitute: true });
    }
  }
  if (ctx.position !== "standing") push("chair_stand_30s", { excluded: "position_seated" });
  return out;
}

/** Test ids that run in a base selection, in order (PrecheckEnv.baseTests). */
export function baseTests(items: readonly SelectionItem[]): TestId[] {
  const out: TestId[] = [];
  for (const i of items) if (!i.excluded && !out.includes(i.testId)) out.push(i.testId);
  return out;
}

/* -------------------------------------------------------------- protocol */

/**
 * Today's protocol from the base selection and a proceed outcome of evaluatePrecheck: the day's
 * skips (a side or the whole test, with the reason), the variant of each item (the chair stand is
 * standard unless the pre-check changed it; the push hand of the hands allowed version), the
 * helper for each test that requires one at home, and the band of the test rules. A day level skip
 * never adds a substitute: only baseSelection places the side lean, and only for intake exclusions.
 * `setup` is the stored setup; today's setupUpdates are applied on top (a limb loss side answered
 * today skips that side of the arm tests).
 */
export function finalizeProtocol(
  base: readonly SelectionItem[],
  outcome: PrecheckOutcome,
  ctx: CheckContext,
  setting: Setting,
  setup: StoredSetup | null,
): ProtocolItem[] {
  if (outcome.status !== "proceed") {
    throw new RangeError(`A protocol needs a proceed outcome, not ${outcome.status}`);
  }
  const s: StoredSetup = { ...setup, ...outcome.setupUpdates };
  const helper = setting === "home" ? outcome.helperRequired : [];
  const items = base.map((item) => {
    const p: ProtocolItem = {
      testId: item.testId,
      side: item.side,
      version: item.version,
      order: item.order,
      band: checkTimeBand(item.testId, item.side, ctx, s),
    };
    if (item.substitute) p.substitute = true;
    const lostArm = ARM_TESTS.includes(item.testId) && item.side === s.limbLoss?.arm;
    const skip = outcome.skips.find((k) => k.testId === item.testId && k.side === item.side);
    const skipped = item.excluded ?? (lostArm ? "limb_loss_arm" : skip?.reason);
    if (skipped) {
      p.skipped = skipped;
      return p;
    }
    const { variant, pushHand } = dayVariant(outcome, item.testId, item.side);
    if (item.testId === "chair_stand_30s") {
      p.variant = variant ?? "standard";
      if (pushHand) p.pushHand = pushHand;
    } else if (variant) {
      p.variant = variant;
    }
    if (helper.includes(item.testId)) p.helperRequired = true;
    return p;
  });
  // P6: the substitute sentence goes with the chair stand's reason only when the side lean runs.
  const substituteRuns = items.some((i) => i.substitute && !i.skipped);
  const appendTo: readonly string[] = CHECK_DATA.reasonSuffixes.substituteRan.appendTo;
  for (const i of items) {
    if (i.testId === "chair_stand_30s" && i.skipped && substituteRuns && appendTo.includes(i.skipped)) {
      i.substituteRan = true;
    }
  }
  return items;
}

/* ------------------------------------------------------------ re-test */

/** A check is due this many days after the last completed check (spec 5). */
export const RETEST_DAYS: number = CHECK_DATA.progress.retestDays;
/** A person may check earlier, but not sooner than this after the last completed check (spec 5). */
export const MIN_HOURS_BETWEEN_CHECKS: number = CHECK_DATA.progress.minHoursBetweenChecks;
/** After a lower, large drop or not comparable result a repeat is offered in 2 to 7 days (spec 5). */
export const REPEAT_OFFER_DAYS: readonly [number, number] = [2, 7];

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** When the next check is due (epoch ms), or null before the first completed check. */
export function retestDue(lastCompleted: number | null | undefined): number | null {
  return typeof lastCompleted === "number" && Number.isFinite(lastCompleted)
    ? lastCompleted + RETEST_DAYS * DAY_MS
    : null;
}

/** The earliest time a new check may start (epoch ms), or null when there is no completed check. */
export function earliestNextCheck(lastCompleted: number | null | undefined): number | null {
  return typeof lastCompleted === "number" && Number.isFinite(lastCompleted)
    ? lastCompleted + MIN_HOURS_BETWEEN_CHECKS * HOUR_MS
    : null;
}

/** Whether a check may start now under the 48 hour rule (locks are checked separately). */
export function canStartCheck(lastCompleted: number | null | undefined, now: number): boolean {
  const earliest = earliestNextCheck(lastCompleted);
  return earliest === null || now >= earliest;
}

/**
 * Whether a check with this protocol runs no test at all today (O21): it closes as ended early and no
 * clocks start, while any lock set by the skipping answers still applies.
 */
export function allSkipped(protocol: readonly Pick<ProtocolItem, "skipped">[]): boolean {
  return protocol.every((i) => i.skipped !== undefined);
}

/* ------------------------------------------------------------ schedule */

/** A completed check for the schedule rules (H9, Q12 (2), Q33). */
export interface CompletedCheck {
  completed: number;
  setting: Setting;
  /** The side lean only session of Q12 (2) (default: a full check). */
  session?: "full" | "side_lean_only";
}

/**
 * When the next check is due and when one may start (H9, Q33):
 *   retestDue      28 days after the last completed home check (the side lean only session does not
 *                  move it; a booth check does not set the home due date);
 *   earliestNext   48 hours after the last completed check of any kind (booth and the side lean only
 *                  session included);
 *   canStart       now is at or after earliestNext (locks are checked separately);
 *   early          a home due date exists and has not come yet: the early start screen is shown
 *                  (scr_early_start, with no reason asked or stored).
 */
export function checkSchedule(
  checks: readonly CompletedCheck[],
  now: number,
): { retestDue: number | null; earliestNext: number | null; canStart: boolean; early: boolean } {
  const latest = (xs: readonly CompletedCheck[]) =>
    xs.reduce<number | null>(
      (m, c) => (Number.isFinite(c.completed) && (m === null || c.completed > m) ? c.completed : m),
      null,
    );
  const lastHome = latest(checks.filter((c) => c.setting === "home" && c.session !== "side_lean_only"));
  const lastAny = latest(checks);
  const retest = retestDue(lastHome);
  const earliest = earliestNextCheck(lastAny);
  return {
    retestDue: retest,
    earliestNext: earliest,
    canStart: earliest === null || now >= earliest,
    early: retest !== null && now < retest,
  };
}

/** The side lean only session is offered from 48 hours to 7 days after the first home check (Q12 (2)). */
export const SIDE_LEAN_REPEAT_HOURS: readonly [number, number] = [48, 7 * 24];

/**
 * The side lean only session that sets the second side lean baseline (Q12 (2), ships with home
 * checks): offered from 48 hours to 7 days after the first completed home check when that check had a
 * side lean and no other home check has one yet; never while a lock, an uncleared changeReported or an
 * unresolved lasting ac_next_day answer is active. It is a full check with one selected test
 * (sideLeanOnly), counts for the 48 hour minimum and does not move the due date (checkSchedule).
 * Returns the offer window, or null.
 */
export function sideLeanRepeatOffer(o: {
  firstHomeCheck: number | null;
  /** Completed home checks with a measured side lean. */
  homeChecksWithSideLean: number;
  now: number;
  lockActive: boolean;
  unresolvedChangeReported: boolean;
  lastCheckLasting: boolean;
}): { from: number; to: number } | null {
  if (o.firstHomeCheck === null || o.homeChecksWithSideLean !== 1) return null;
  if (o.lockActive || o.unresolvedChangeReported || o.lastCheckLasting) return null;
  const from = o.firstHomeCheck + SIDE_LEAN_REPEAT_HOURS[0] * HOUR_MS;
  const to = o.firstHomeCheck + SIDE_LEAN_REPEAT_HOURS[1] * HOUR_MS;
  return o.now >= from && o.now <= to ? { from, to } : null;
}

/** The base selection of the side lean only session: the side lean items only (Q12 (2)). */
export function sideLeanOnly(base: readonly SelectionItem[]): SelectionItem[] {
  return base
    .filter((i) => i.testId === "trunk_control_seated" && !i.excluded)
    .map((i, k) => {
      const { substitute: _substitute, ...rest } = i;
      return { ...rest, order: k + 1 };
    });
}

/**
 * The repeat offered after a lower, large drop or not comparable result (H9): 2 to 7 days after the
 * check, never while a lasting ac_next_day answer is unresolved.
 */
export function repeatOfferWindow(
  lastCompleted: number,
  o: { repeat: boolean; lastCheckLasting: boolean },
): { from: number; to: number } | null {
  if (!o.repeat || o.lastCheckLasting) return null;
  return {
    from: lastCompleted + REPEAT_OFFER_DAYS[0] * DAY_MS,
    to: lastCompleted + REPEAT_OFFER_DAYS[1] * DAY_MS,
  };
}

/* --------------------------------------------------------------- loads */

export type LoadKind = "dumbbell" | "bottle" | "cuff" | "none";
/** Load kinds in the order of the load question (tests.arm_curl_30s.load.options). */
export const LOAD_KINDS: readonly LoadKind[] = testDef("arm_curl_30s").load.options.map((o) => o.value);
/** Q5: dumbbells 0.5 to 4 kg in 0.5 kg steps, wrist weights up to 2 kg, three bottle sizes. */
export { LOAD_LIMITS };
/** No dumbbell at home for these conditions (Q5). */
const NO_DUMBBELL_CONDITIONS = ["parkinsons", "ms", "cerebral_palsy", "sci_complete", "sci_incomplete"];

/**
 * The loads an arm may use in the arm curl (Q5, 4.2): none at the booth (arm_only for everyone);
 * none for an arm set to arm_only by a rule; a wrist weight or none for cuff_or_arm_only; no dumbbell
 * at home for Parkinson's, MS, CP and SCI; after a grip yes on that arm only a wrist weight, a closed
 * plastic bottle or nothing.
 */
export function allowedLoads(o: {
  ctx: Pick<CheckContext, "conditions">;
  setting: Setting;
  variant?: string;
  gripYes?: boolean;
}): LoadKind[] {
  if (o.setting === "booth" || o.variant === "arm_only") return ["none"];
  if (o.variant === "cuff_or_arm_only") return LOAD_KINDS.filter((k) => k === "cuff" || k === "none");
  const noDumbbell = o.gripYes === true || NO_DUMBBELL_CONDITIONS.some((c) => o.ctx.conditions.includes(c));
  return LOAD_KINDS.filter((k) => !(noDumbbell && k === "dumbbell"));
}

/* ------------------------------------------------------------ duration */

/** Chair stand helper conditions (spec 4.4, Q11), for the estimate before the pre-check. */
const STAND_HELPER_CONDITIONS = ["parkinsons", "stroke", "sci_incomplete", "cerebral_palsy"];

type Minutes = [number, number];
const plus = (a: Minutes, b: readonly [number, number]): Minutes => [a[0] + b[0], a[1] + b[1]];

/**
 * The computed duration of a check in minutes, [from, to] (O40; UX spec S27): overhead (intro, sound
 * check, results), the guest steps for a guest, the pre-check (longer with condition questions), and
 * per test that runs today its own minutes, which hold every rest, practice and answer (never cut):
 * the arm curl with or without a load, a helper briefing for each test with a helper, and the booth
 * vitals before a booth chair stand for clearance no or not sure. With protocol items the day's
 * skips, variants and helpers are known; with test ids (before the pre-check) the upper reading is
 * used: a load at home when no rule forbids it, a helper briefing for the side lean at home.
 */
// SPEC-GAP: estimate-helper-stand. The data adds the helper briefing minute to the side lean; a
// chair stand with a helper briefing gets the same minute (an estimate is never too short).
export function estimateMinutes(
  items: readonly ProtocolItem[] | readonly TestId[],
  ctx: CheckContext | null,
  setting: Setting,
  guest = false,
): Minutes {
  const E = CHECK_DATA.selection.sessionMinutes.startingEstimatesMinutes;
  const known = items.length > 0 && typeof items[0] !== "string";
  const protocol = known ? (items as readonly ProtocolItem[]).filter((i) => !i.skipped) : [];
  const tests: TestId[] = known
    ? [...new Set(protocol.map((i) => i.testId))]
    : [...new Set(items as readonly TestId[])];
  const helper = (t: TestId): boolean => {
    if (setting !== "home") return false;
    if (known) return protocol.some((i) => i.testId === t && i.helperRequired);
    if (t === "trunk_control_seated") return true;
    return (
      t === "chair_stand_30s" &&
      ctx !== null &&
      STAND_HELPER_CONDITIONS.some((c) => ctx.conditions.includes(c))
    );
  };
  const withLoad = (): boolean => {
    if (setting === "booth") return false;
    if (known) return protocol.some((i) => i.testId === "arm_curl_30s" && i.variant !== "arm_only");
    if (!ctx) return true;
    return ctx.clearance === "yes" && !ctx.restrictions.includes("no_resistance");
  };
  let m: Minutes = [...E.overhead] as Minutes;
  if (guest) m = plus(m, E.guestSteps);
  m = plus(m, conditionQuestions(tests, ctx, setting) ? E.precheckWithConditionQuestions : E.precheck);
  for (const t of tests) {
    if (t === "shoulder_abduction") m = plus(m, E.shoulder_abduction);
    if (t === "arm_curl_30s") m = plus(m, withLoad() ? E.arm_curl_30s_withLoad : E.arm_curl_30s_noLoad);
    if (t === "trunk_control_seated") m = plus(m, E.trunk_control_seated);
    if (t === "chair_stand_30s") {
      m = plus(m, E.chair_stand_30s);
      if (setting === "booth" && (ctx === null || ctx.clearance !== "yes")) m = plus(m, E.boothVitals);
    }
    if (helper(t)) m = plus(m, E.helperBriefing);
  }
  return m;
}

/** Whether the pre-check can ask condition, standing or setup questions (the Q18 time budget). */
function conditionQuestions(tests: readonly TestId[], ctx: CheckContext | null, setting: Setting): boolean {
  if (!ctx) return true;
  const env: PrecheckEnv = {
    setting,
    ctx,
    setup: null,
    firstCheck: true,
    unresolvedChangeReported: false,
    lastCheckLasting: false,
    baseTests: [...tests],
  };
  const groups: readonly string[] = ["condition", "standing", "baseline_setup"];
  return possibleQuestions(env, {}).some((id) => {
    const base = id.split(":")[0];
    const item = CHECK_DATA.precheck.find((q) => q.id === base);
    return item !== undefined && groups.includes(item.group);
  });
}
