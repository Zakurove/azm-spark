/**
 * Movement check: setting, context, setup and protocol selection (contract v2, section B; clinical
 * spec 3.1 to 3.4 and 5 "Re-test interval").
 *
 *   contextFromIntake  who gets a check at all (spec 3.1), from the stored intake and plan
 *   guestContext       the same gate for the booth guest steps (Q19), clearance counts as unsure
 *   baseSelection      tests per position in fixed order, intake level exclusions, the trunk
 *                      substitute for standing users, sides and side order (spec 3.2 to 3.4)
 *   finalizeProtocol   today's protocol after the pre-check: skips, variants, helper, band
 *   retestDue          28 days after the last completed check; 48 hours minimum between checks
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
import { dayVariant, type PrecheckOutcome, type TestSide } from "./precheck";
import { checkTimeBand } from "./progress-rules";

export type { CheckPosition, Setting };

/* ------------------------------------------------------------------ types */

/** From the intake (signed in) or from the guest steps (booth; clearance counts as unsure there). */
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

/** The clinical review reasons of spec 3.1 that hold for these answers, in report order. */
function gateReasons(g: GateInput): ClinicalReviewReason[] {
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
 */
export function contextFromIntake(intake: Intake, plan: Plan): CheckContext | Blocked {
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
  const fromIntake = gateReasons({
    position: position ?? "bed",
    conditions: intake.conditions,
    restrictions: intake.restrictions,
    clearance: intake.clearance,
    symptoms: intake.symptoms,
    recentChange: intake.recentChange,
  });
  const scheduling: readonly string[] = SCHEDULING_REVIEW_REASONS;
  // SPEC-GAP: unknown-plan-reason. A plan reason that is neither a clinical nor a scheduling reason
  // of spec 3.1 blocks the check (the safe side), and so does a plan in review without a reason.
  const fromPlan = (plan?.reasons ?? []).filter((r) => !scheduling.includes(r));
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
  /** Empty means no condition (none). */
  conditions: string[];
}

/**
 * The check context of a booth guest, or why there is no check. The guest is never asked about
 * clearance, so clearance counts as unsure: arm curls without weight, the chair stand only after the
 * staff vitals, and no check for stroke or SCI (spec 3.1 needs clearance yes for them). cardiac or
 * other: no check, the person talks to the staff (selection.guestBooth).
 */
export function guestContext(steps: GuestSteps): CheckContext | Blocked {
  const positions: readonly string[] = ["chair", "wheelchair", "standing", "bed"];
  if (
    !steps ||
    !positions.includes(steps.position) ||
    !SUPPORTS.includes(steps.support) ||
    !isList(steps.pain, painOptions) ||
    !isList(steps.restrictions, restrictionOptions) ||
    !isList(steps.conditions, CONDITION_IDS) ||
    (steps.conditions.length > 1 && steps.conditions.includes("none"))
  ) {
    return { blocked: "invalid_input" };
  }
  const conditions = steps.conditions.length ? [...steps.conditions] : ["none"];
  const clearance: Clearance = "unsure";
  const [first] = gateReasons({
    position: steps.position,
    conditions,
    restrictions: steps.restrictions,
    clearance,
  });
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
 * row order of the matrix in spec 3.3 is shown: pain, restrictions, clearance, limb loss, SCI.
 */
export function intakeExclusion(
  test: TestId,
  ctx: CheckContext,
  setting: Setting,
  setup: StoredSetup | null,
): ReasonId | undefined {
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
  // The gate of spec 3.1 again, so a context built by hand cannot open a check either.
  if (gateReasons(ctx).length > 0 || !(ctx.position in CHECK_DATA.selection.basePerPosition)) return [];
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
  return base.map((item) => {
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
