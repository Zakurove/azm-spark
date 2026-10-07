/**
 * The pre-check of the focus check (product v7 contract C-2 and 2.5; D-032 item 2). Since D-032 the
 * focus check asks every question of the day on one short screen: today's pain in the areas of the
 * check, one yes or no question for anything new or worrying, and only the walk's questions the walk
 * plan needs (with someone with the person asked once). Its answers come back onto the v7 items
 * through the v1 bridge, unchanged: a proceeding outcome's skips and helper requirements. Pure, no DOM.
 *
 *   dayAreas              the areas of today's check, which the one pain question covers
 *   dayItems              the items of the day's one screen for the answers so far
 *   missingDayItems       the items still without an answer (the start needs every one)
 *   dayOutcome            the day's answers as a pre-check outcome: a skip today, or the helper rules
 *   keptDay               the day's answers a later step reads, the only ones a focus check keeps
 *   proxyBaseTests        the v1 tests whose rules and stop list the focus check needs
 *   focusPrecheckEnv      the PrecheckEnv of the stop list and the screens
 *   applyPrecheckOutcome  skips and helpers of a proceeding outcome onto the protocol and the gait plan
 *   GAIT_DAY_ITEMS        the two gait day items, asked when the gait test is planned
 *
 * The start route runs, after its gates: buildRomProtocol, gaitPlanFor, focusPrecheckEnv, then
 * dayOutcome and on proceed applyPrecheckOutcome (contract section 4).
 */
import { TEST_ID_LIST, type TestId } from "../movements/types";
import type { Intake } from "./plan";
import type { RegionId } from "./body-map";
import { REGION_IDS } from "./body-map";
import { helperMattersForWalk, type GaitPlan } from "./gait-eligibility";
import {
  CHAIR_STAND_HELPER_CONDITIONS,
  SIDE_LEAN_HELPER_CONDITIONS,
  type PrecheckEnv,
  type PrecheckOutcome,
  type SkipItem,
  type StoredPrecheck,
} from "./precheck";
import {
  hasLowerLimbLoss,
  type FocusToday,
  type RomProtocol,
  type RomProtocolItem,
  type RomReasonId,
} from "./rom-protocol";

/** The upper limb regions: their seated items load the v1 arm raise. */
const UPPER_LIMB: readonly RegionId[] = ["shoulder", "elbow", "forearm_wrist"];
/** The regions whose red flags stop the gait test (contract 2.5): the legs and the back. */
const GAIT_REGIONS: readonly RegionId[] = ["back_trunk", "hip", "knee", "ankle_foot"];
/**
 * v1 skip reasons the v7 protocol decides with its own rule and never takes from the v1 pre-check: the
 * arm or leg with limb loss (rom-protocol 2.4 measures the joints above the loss, which v1 never does).
 */
const V7_DECIDES: ReadonlySet<RomReasonId> = new Set<RomReasonId>(["limb_loss_arm", "limb_loss_leg"]);

const runs = (i: RomProtocolItem) => !i.skipped;
const isUpperLimbSeated = (i: RomProtocolItem) => UPPER_LIMB.includes(i.region) && i.block === "seated";
const isSideLean = (i: RomProtocolItem) => i.position === "seated_armrests";
const isStanding = (i: RomProtocolItem) => i.block === "standing";

/**
 * The v1 test ids whose pre-check items the focus check needs (C-2): upper limb seated items ->
 * shoulder_abduction; seated_armrests trunk items -> trunk_control_seated; standing blocks and gait ->
 * chair_stand_30s. Lying items add none, and so do skipped and deferred items (they do not run today).
 * In the v1 test order.
 */
export function proxyBaseTests(protocol: RomProtocol, gait: GaitPlan | null): TestId[] {
  const items = protocol.items.filter(runs);
  const tests = new Set<TestId>();
  if (items.some(isUpperLimbSeated)) tests.add("shoulder_abduction");
  if (items.some(isSideLean)) tests.add("trunk_control_seated");
  if (items.some(isStanding) || gait?.offered === true) tests.add("chair_stand_30s");
  return TEST_ID_LIST.filter((t) => tests.has(t));
}

/** PrecheckEnv for evaluatePrecheck and visibleQuestions, with baseTests = proxyBaseTests. */
export function focusPrecheckEnv(
  base: Omit<PrecheckEnv, "baseTests">,
  protocol: RomProtocol,
  gait: GaitPlan | null,
): PrecheckEnv {
  return { ...base, baseTests: proxyBaseTests(protocol, gait) };
}

/** The v7 items a v1 test and side stands for. */
function proxiedBy(testId: TestId, side: string, item: RomProtocolItem): boolean {
  switch (testId) {
    case "shoulder_abduction":
      return isUpperLimbSeated(item) && item.side === side;
    case "trunk_control_seated":
      return isSideLean(item) && item.side === side;
    case "chair_stand_30s":
      return isStanding(item);
    default:
      return false;
  }
}

/**
 * A skip of a proxy test and side skips the v7 items of its block and side with the same reason;
 * helperRequired on chair_stand_30s sets helperRequired on standing items and on the gait plan.
 *
 * Only the items that run today change: an item the v7 rules skipped keeps its reason, and deferred
 * items stay deferred. The gait test follows its own eligibility rows (gaitPlanFor reads the same v1
 * answers); from the chair stand it takes the helper: a required helper keeps it overground with
 * someone beside («It is the only mode for anyone with a helper requirement»), and a missing one
 * (pc_helper no: helper_needed) means no gait test. The arm or leg with limb loss follows the v7 rule
 * (V7_DECIDES). helperRequired lists the blocks that run today with someone beside the person.
 */
export function applyPrecheckOutcome(
  protocol: RomProtocol,
  gait: GaitPlan | null,
  outcome: PrecheckOutcome,
): {
  protocol: RomProtocol;
  gait: GaitPlan | null;
  helperRequired: ("rom_seated" | "rom_standing" | "gait")[];
} {
  const skips = outcome.skips.filter((s) => !V7_DECIDES.has(s.reason));
  const helpers = new Set<TestId>(outcome.helperRequired);
  const items = protocol.items.map((item): RomProtocolItem => {
    if (item.skipped) return { ...item };
    const skip = skips.find((s) => proxiedBy(s.testId, s.side, item));
    const helper = [...helpers].some((t) => proxiedBy(t, item.side, item));
    return {
      ...item,
      helperRequired: item.helperRequired || helper,
      ...(skip ? { skipped: skip.reason } : {}),
    };
  });
  const next: RomProtocol = {
    ...protocol,
    items,
    deferred: protocol.deferred.map((i) => ({ ...i })),
    notMeasured: protocol.notMeasured.map((n) => ({ ...n })),
    sitBeforeStand: items.some((i) => i.block === "lying" && runs(i)),
  };

  let nextGait = gait ? { ...gait, views: { ...gait.views } } : null;
  if (nextGait?.offered) {
    const noHelper = skips.some((s) => s.testId === "chair_stand_30s" && s.reason === "helper_needed");
    if (noHelper) {
      nextGait = {
        ...nextGait,
        offered: false,
        reason: "helper_needed",
        modes: [],
        padAllowed: false,
        helperRequired: false,
        antalgicOnly: false,
        staticStance: false,
        views: { overground: [], walking_pad: [] },
      };
    } else if (helpers.has("chair_stand_30s")) {
      nextGait = {
        ...nextGait,
        helperRequired: true,
        padAllowed: false,
        modes: ["overground"],
        views: { ...nextGait.views, walking_pad: [] },
      };
    }
  }

  const helperRequired: ("rom_seated" | "rom_standing" | "gait")[] = [];
  if (items.some((i) => runs(i) && i.block === "seated" && i.helperRequired))
    helperRequired.push("rom_seated");
  if (items.some((i) => runs(i) && i.block === "standing" && i.helperRequired))
    helperRequired.push("rom_standing");
  if (nextGait?.offered && nextGait.helperRequired) helperRequired.push("gait");
  return { protocol: next, gait: nextGait, helperRequired };
}

/* ------------------------------------------------------- gait day items */

/** The two new gait day items (pc_walk_10m, pc_pd_freezing): shown when gait is planned; copy from GAIT_DATA.copy.setup. */
export const GAIT_DAY_ITEMS: readonly ["pc_walk_10m", "pc_pd_freezing"] = Object.freeze([
  "pc_walk_10m",
  "pc_pd_freezing",
] as const);

/**
 * The gait day items to ask today: pc_walk_10m «asked at each gait test»; pc_pd_freezing «Parkinson's
 * only». None when the gait test is not planned.
 */
export function gaitDayItems(
  gait: GaitPlan | null,
  intake: Pick<Intake, "conditions">,
): ("pc_walk_10m" | "pc_pd_freezing")[] {
  if (!gait?.offered) return [];
  return intake.conditions.includes("parkinsons") ? ["pc_walk_10m", "pc_pd_freezing"] : ["pc_walk_10m"];
}

/** The gait day items still without an answer in the day's answers (the start needs them when gait is included). */
export function missingGaitDayItems(
  gait: GaitPlan | null,
  intake: Pick<Intake, "conditions">,
  today: FocusToday,
): ("pc_walk_10m" | "pc_pd_freezing")[] {
  return gaitDayItems(gait, intake).filter((id) =>
    id === "pc_walk_10m" ? today.walk10m === undefined : today.pdFreezing === undefined,
  );
}

/* ------------------------------------------------ the day's one screen (D-032 item 2) */

/** An item of the day's one screen, in the order it shows. */
export type DayItem = "pain" | "worry" | "prosthesis" | "walk10m" | "pdFreezing" | "unsteady" | "helper";

/** The day's one screen for a person: the intake, the setting, the preview of what could run, the answers so far. */
export interface DayInput {
  intake: Intake;
  setting: "home" | "booth";
  /** The context's preview of the day (what could run with someone there and a prosthesis on). */
  protocol: RomProtocol;
  gait: GaitPlan | null;
  /** The answers so far. */
  today: FocusToday;
}

/**
 * The areas of today's check, in body order, which the one pain question covers: every affected region
 * with a movement that runs today, and, when the walk is planned, every leg and back region of the body
 * map (their pain decides the walk even when no movement of theirs runs).
 */
export function dayAreas(protocol: RomProtocol, gait: GaitPlan | null): RegionId[] {
  const ask = new Set<RegionId>(protocol.items.filter(runs).map((i) => i.region));
  if (gait?.offered) {
    for (const x of [...protocol.items, ...protocol.deferred, ...protocol.notMeasured])
      if (GAIT_REGIONS.includes(x.region)) ask.add(x.region);
  }
  return REGION_IDS.filter((r) => ask.has(r));
}

/**
 * v1.1 4.4 at home, the chair stand's helper rule as the bridge carries it to the standing items and
 * the walk: Parkinson's, a stroke, an incomplete spinal cord injury or cerebral palsy, an aid in the
 * intake, or day_unsteady_ask yes (the STEADI three in one question).
 */
export function standingHelperRule(
  intake: Pick<Intake, "conditions" | "walking">,
  today: FocusToday,
): boolean {
  return (
    intake.conditions.some((c) => CHAIR_STAND_HELPER_CONDITIONS.includes(c)) ||
    intake.walking?.status === "with_aid" ||
    today.unsteady === true
  );
}

/** rom-protocol 6 seated_side_lean_gate: «helper for SCI, stroke, CP, Parkinson's and MS» at home. */
export function sideLeanHelperRule(intake: Pick<Intake, "conditions">): boolean {
  return intake.conditions.some((c) => SIDE_LEAN_HELPER_CONDITIONS.includes(c));
}

/** What could run today from the preview and the answers so far. */
function dayParts(input: DayInput) {
  const { intake, protocol, gait, today } = input;
  const items = protocol.items.filter(runs);
  const limb = hasLowerLimbLoss(intake);
  const standing = items.some(isStanding);
  const walks = gait?.offered === true;
  // Without the prosthesis on, no standing test and no walk (rom-protocol limb_loss_standing).
  const legs = !(limb && today.prosthesisOn === false);
  return {
    items,
    limb,
    standing,
    walks,
    standToday: standing && legs,
    walkPlanned: walks && legs,
    walkToday: walks && legs && today.walk10m !== false,
  };
}

/**
 * Whether someone with the person changes today, at home: a part that runs only with a helper (a
 * standing item's own rule, the side lean's helper rule, the chair stand's helper rule for the standing
 * items and the walk), or a walk that needs someone beside the walker or would offer the pad.
 */
function helperMatters(input: DayInput): boolean {
  if (input.setting === "booth") return false;
  const { intake, today } = input;
  const p = dayParts(input);
  const own = p.items.some((i) => i.helperRequired && (!isStanding(i) || p.standToday));
  const sideLean = p.items.some(isSideLean) && sideLeanHelperRule(intake);
  const stand = (p.standToday || p.walkToday) && standingHelperRule(intake, today);
  // Before the unsteadiness answer the pad is still possible: the question shows from the start.
  const walk =
    p.walkToday &&
    helperMattersForWalk(intake, { ...today, unsteady: today.unsteady ?? false }, input.setting);
  return own || sideLean || stand || walk;
}

/**
 * The items of the day's one screen for the answers so far, in order (a later item can follow from an
 * earlier answer): the pain of today's areas; the one worry question, after whose yes nothing else
 * matters; the prosthesis with a leg limb loss; the walk's two day items; the one unsteadiness
 * question when the standing items or the walk run; someone with the person, once, when it changes
 * the day.
 */
export function dayItems(input: DayInput): DayItem[] {
  const { intake, protocol, gait, today } = input;
  const out: DayItem[] = [];
  if (dayAreas(protocol, gait).length) out.push("pain");
  out.push("worry");
  if (today.worrying === true) return out;
  const p = dayParts(input);
  if (p.limb && (p.standing || p.walks)) out.push("prosthesis");
  if (p.walkPlanned)
    for (const id of gaitDayItems(gait, intake)) out.push(id === "pc_walk_10m" ? "walk10m" : "pdFreezing");
  if (p.standToday || p.walkToday) out.push("unsteady");
  if (helperMatters(input)) out.push("helper");
  return out;
}

/** The answer of each day item in FocusToday (the pain question has none: an area left out has no pain). */
const ANSWER_OF: Record<Exclude<DayItem, "pain">, keyof FocusToday> = {
  worry: "worrying",
  prosthesis: "prosthesisOn",
  walk10m: "walk10m",
  pdFreezing: "pdFreezing",
  unsteady: "unsteady",
  helper: "helperPresent",
};

/** The FocusToday field a day item writes, or null for the pain question. */
export const dayAnswerField = (item: DayItem): keyof FocusToday | null =>
  item === "pain" ? null : ANSWER_OF[item];

/** The day items still without an answer (the start needs every one: 400 START_INVALID). */
export function missingDayItems(input: DayInput): DayItem[] {
  return dayItems(input).filter((item) => {
    const field = dayAnswerField(item);
    return field !== null && typeof input.today[field] !== "boolean";
  });
}

/**
 * The day's answers as a pre-check outcome (D-032 item 2), so the v1 bridge applies them unchanged:
 * day_worry_ask yes skips the check today (postpone, next day lock); otherwise it proceeds with the
 * v1.1 helper rules at home, on the proxy tests: the chair stand's (the standing items and the walk)
 * and the side lean's (the seated side bend), each skipped (helper_needed) without someone there. The
 * stored data map keeps the highest pain today, the leg prosthesis and the tests with a helper.
 */
export function dayOutcome(input: Pick<DayInput, "intake" | "setting" | "today">): PrecheckOutcome {
  const { intake, setting, today } = input;
  const stored: StoredPrecheck = {};
  const pains = Object.values(today.painByRegion).filter((n): n is number => typeof n === "number");
  stored.painNow = pains.length ? Math.max(...pains) : 0;
  if (hasLowerLimbLoss(intake) && today.prosthesisOn !== undefined)
    stored["fingerprint.legProsthesis"] = today.prosthesisOn;
  const base = { variants: [], warnings: [], setupUpdates: {}, stored };
  if (today.worrying === true)
    return {
      ...base,
      status: "postpone",
      reason: "unwell",
      screen: "scr_postpone_unwell",
      lock: { reason: "unwell", until: "next_day" },
      skips: [],
      helperRequired: [],
    };
  const helperRequired: TestId[] = [];
  const skips: SkipItem[] = [];
  const present = today.helperPresent === true;
  if (setting === "home") {
    if (standingHelperRule(intake, today)) {
      helperRequired.push("chair_stand_30s");
      if (!present) skips.push({ testId: "chair_stand_30s", side: "none", reason: "helper_needed" });
    }
    if (sideLeanHelperRule(intake)) {
      helperRequired.push("trunk_control_seated");
      if (!present)
        for (const side of ["left", "right"] as const)
          skips.push({ testId: "trunk_control_seated", side, reason: "helper_needed" });
    }
    if (present && helperRequired.length) stored["fingerprint.helperPresent"] = [...helperRequired];
  }
  return { ...base, status: "proceed", skips, helperRequired };
}

/* ------------------------------------------------- the day answers kept */

/**
 * The day's answers a later step reads, the only ones a focus check keeps (contract section 3
 * focus_checks.today; R1-2, D-026 items 7 and 9), each only when it was asked (absent: not asked). They
 * are numbers and yes or no answers only; no red flag answer is ever kept (E1-5), and the walk, freezing,
 * transfer and orthosis answers live on in the frozen protocol and gait plan. Since D-032 item 2 the
 * day's one screen asks only the pain, someone with the person, unsteadiness and the leg prosthesis
 * (keptDay); pdState, pusher, armrests and seatedLean stay readable on the checks kept before it.
 */
export interface StoredFocusToday {
  /** pain_ask per pain region of the body map, 0 to 10: the gait rules at complete (2.9) and the program. */
  painByRegion: Partial<Record<RegionId, number>>;
  /** pc_helper: someone beside the person today, for the coach's token (5.1). */
  helperPresent?: boolean;
  /** pc_steadi «fell» and «worry» (asked with the chair stand): the gait rules' careful_walking (CG-9). */
  steadi?: { fell: boolean; worry: boolean };
  /** pc_pd_on with Parkinson's: on (yes) or unsure; a no postpones the check (CG-18, like with like retests). */
  pdState?: "on" | "unsure";
  /** pc_stroke_push (asked with the seated side bend): the program's pusher (E1-5). */
  pusher?: boolean;
  /** pc_trunk_armrests (asked at home with the seated side bend): armrests or side guards on both sides, steady (E1-5 no_trunk_armrests). */
  armrests?: boolean;
  /**
   * The seated side lean's day answers of seated_lean_gate (asked with the seated side bend, E1-5):
   * pc_fall_sitting (a fall from sitting in the last 3 months), pc_pressure_sore (in a wheelchair or
   * with SCI) and pc_sit_unsupported (sitting unsupported, without side supports or a chest strap).
   */
  seatedLean?: { fellSitting?: boolean; pressureSore?: boolean; sitsUnsupported?: "yes" | "no" | "unsure" };
  /** pc_limb_leg_prosthesis, or the day's own answer, for a leg limb loss only (E1-5 standing_gate). */
  prosthesisOn?: boolean;
}

/**
 * The day's answers the focus check keeps (StoredFocusToday) from the day's one screen (D-032 item 2):
 * the pain per area, and each of someone with the person, unsteadiness and the leg prosthesis when the
 * screen asked it. Unsteadiness stands for the STEADI three, so steadi keeps it as both fell and worry
 * (the gait rules' careful_walking reads either). Pure: the start route keeps exactly this.
 */
export function keptDay(today: FocusToday, items: readonly DayItem[]): StoredFocusToday {
  const out: StoredFocusToday = { painByRegion: { ...today.painByRegion } };
  if (items.includes("helper") && today.helperPresent !== undefined) out.helperPresent = today.helperPresent;
  if (items.includes("unsteady") && today.unsteady !== undefined)
    out.steadi = { fell: today.unsteady, worry: today.unsteady };
  if (items.includes("prosthesis") && today.prosthesisOn !== undefined) out.prosthesisOn = today.prosthesisOn;
  return out;
}
