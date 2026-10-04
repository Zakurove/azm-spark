/**
 * The pre-check bridge of the focus check (product v7 contract C-2 and 2.5). The focus check reuses
 * the v1 pre-check, its locks, stop routing and screens through their pure functions, unchanged: it
 * runs evaluatePrecheck on proxy base tests chosen from the day's protocol and gait plan, then brings
 * the outcome's skips and helper requirements back onto the v7 items. Pure, no DOM.
 *
 *   proxyBaseTests        the v1 tests whose pre-check items the focus check needs
 *   focusPrecheckEnv      the PrecheckEnv for evaluatePrecheck and visibleQuestions
 *   applyPrecheckOutcome  skips and helpers of a proceeding outcome onto the protocol and the gait plan
 *   GAIT_DAY_ITEMS        the two new gait day items, asked when the gait test is planned
 *   RF_REGION_ITEM        the region red flag item, asked per affected region of the day's protocol
 *
 * The start route runs, after its gates: buildRomProtocol, gaitPlanFor, focusPrecheckEnv,
 * evaluatePrecheck, then on proceed applyPrecheckOutcome (contract section 4).
 */
import { TEST_ID_LIST, type ScreenId, type TestId } from "../movements/types";
import type { Text } from "../movements/types";
import type { Intake } from "./plan";
import type { RegionId } from "./body-map";
import { REGION_IDS } from "./body-map";
import type { GaitPlan } from "./gait-eligibility";
import type { PrecheckEnv, PrecheckOutcome } from "./precheck";
import type { FocusToday, RomProtocol, RomProtocolItem, RomReasonId } from "./rom-protocol";

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
      // CONTRACT-GAP (A4, change log): GaitNotOffered has no helper_needed; the nearest reason stands in.
      nextGait = {
        ...nextGait,
        offered: false,
        reason: "walk_needs_hands_on_help",
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

/* ---------------------------------------------------- region red flags */

/** The region red flag item, asked per affected region of the day's protocol (above). */
export const RF_REGION_ITEM: "rf_region" = "rf_region";

/**
 * The rf_region question, drafted by A from the data's rule text (rom-protocol 6 red_flags: «a hot,
 * red, swollen joint; fever; a new deformity; cannot take weight on the leg since an injury; new
 * numbness or weakness»); the clinical sign off reviews it with the rest of the copy. The leg version
 * adds the weight bearing sign. {region} is the region's name (ROM_DATA.regions label). The answers
 * are the data's ans_yes and ans_no. Contract change log (A4): this copy belongs in the rom namespace
 * once src/i18n/v7.ts registers it.
 */
export const RF_REGION_COPY: Readonly<Record<"ask" | "ask_leg", Text>> = Object.freeze({
  ask: {
    ar: "في {region} اليوم: هل توجد سخونة أو احمرار أو تورّم، أو تغيّر جديد في الشكل، أو تنميل أو ضعف جديد؟ أو هل عندك حرارة؟",
    en: "Today, in your {region}: is it hot, red or swollen, has its shape changed, or is there new numbness or weakness? Or do you have a fever?",
  },
  ask_leg: {
    ar: "في {region} اليوم: هل توجد سخونة أو احمرار أو تورّم، أو تغيّر جديد في الشكل، أو تنميل أو ضعف جديد، أو لا تستطيع الوقوف على هذه الساق منذ إصابة؟ أو هل عندك حرارة؟",
    en: "Today, in your {region}: is it hot, red or swollen, has its shape changed, is there new numbness or weakness, or have you been unable to stand on that leg since an injury? Or do you have a fever?",
  },
});

/** The leg regions take RF_REGION_COPY.ask_leg. */
export const RF_REGION_LEG: readonly RegionId[] = Object.freeze(["hip", "knee", "ankle_foot"]);

/**
 * The regions to ask rf_region about, once each, in body order: every affected region with a movement
 * that runs today, and, when the gait test is planned, every leg and back region of the body map (their
 * red flags stop the gait test even when no movement of theirs runs).
 */
export function rfRegionsToAsk(protocol: RomProtocol, gait: GaitPlan | null): RegionId[] {
  const ask = new Set<RegionId>(protocol.items.filter(runs).map((i) => i.region));
  if (gait?.offered) {
    for (const x of [...protocol.items, ...protocol.deferred, ...protocol.notMeasured])
      if (GAIT_REGIONS.includes(x.region)) ask.add(x.region);
  }
  return REGION_IDS.filter((r) => ask.has(r));
}

/** A yes to rf_region shows the existing seek care screen once (contract 2.5): the start route's warnings. */
export function redFlagWarnings(today: FocusToday): ScreenId[] {
  return today.redFlagRegions.length > 0 ? ["scr_stop_seek_care"] : [];
}
