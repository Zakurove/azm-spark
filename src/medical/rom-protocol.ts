/**
 * The range of motion protocol of a focus check (product v7 contract 2.5; rom-protocol sections 2,
 * 3 and 6): which movements of the affected regions are measured today, in which position, block and
 * order, and why the others are not. Pure, no DOM: the start route builds it on the server, and the
 * client may build the same preview.
 *
 *   globalGate      rom-protocol 6 global_gate (the v1.1 gate of any camera test)
 *   standingGate    the standing positions: the v1.1 chair stand exclusions (H6 rule 2, review A07)
 *   buildRomProtocol  the region table (2.1), the problem type rules (2.2), limb loss (2.4), the
 *                   positions (2.5), every safety id of section 6, the session order and the cap
 *
 * Rules before AI: the movements, positions, norms, limb loss lists and reason ids are read from the
 * ROM data; the rules the clinical source writes in prose are written here by hand, each quoting its
 * text, and ROM_SAFETY_RULES says where every safety id of section 6 is enforced. The tests
 * (tests/v7/a-rom-protocol.test.ts) cover one case per rule and check the constants against the data.
 */
import { ROM_DATA, ROM_RULES_VERSION, defaultDef, movementDef, regionRow } from "../movements/rom";
import { DEFAULT_ONLY_IDS, ROM_MOVEMENT_IDS } from "../movements/rom/types";
import { AXIAL_REGIONS, REGION_IDS } from "./body-map";
import type { Intake } from "./plan";
import type { HipAvoidId, LimbLossLevel, ProblemType, RegionEntry, RegionId } from "./body-map";
import type {
  JointMovementId,
  RomData,
  RomMovementDef,
  RomMovementId,
  RomPositionId,
  RomSafetyId,
  RomSide,
  RomV7ReasonId,
} from "../movements/rom/types";
import type { ReasonId } from "../movements/types";

/** v7 reasons plus v1 reasons carried from the pre-check. */
export type RomReasonId = keyof RomData["reasonIds"] | ReasonId;
export type RomBlock = "seated" | "standing" | "lying";
export interface FocusToday {
  /** pain_ask per pain region of the body map, 0 to 10. */
  painByRegion: Partial<Record<RegionId, number>>;
  /** Regions with a red flag today (rom-protocol 6 red_flags): the answers of the rf_region item, one per affected region on the day's protocol. */
  redFlagRegions: RegionId[];
  /** pc_limb_leg_prosthesis */
  prosthesisOn?: boolean;
  /** pc_transfer_chair */
  transferChair?: boolean;
  /** pc_helper */
  helperPresent?: boolean;
  /** pc_walk_10m (gait) */
  walk10m?: boolean;
  /** pc_pd_freezing (gait) */
  pdFreezing?: boolean;
  orthosis?: Partial<Record<"left" | "right", "afo" | "kafo" | "knee_brace">>;
}
export interface RomProtocolItem {
  movementId: RomMovementId;
  side: RomSide;
  region: RegionId;
  position: RomPositionId;
  block: RomBlock;
  order: number;
  priority: "core" | "extended";
  verdict: "measure" | "caution";
  normId: string | null;
  graded: boolean;
  /** Weakness in the region: can_move_ask before the movement. */
  askCanMove: boolean;
  helperRequired: boolean;
  approximate: boolean;
  /** Set when the item does not run today (it then stays in the protocol for the record). */
  skipped?: RomReasonId;
}
export interface RomNotMeasured {
  movementId: JointMovementId;
  side: RomSide;
  region: RegionId;
  source: "not_measured_camera" | "not_applicable" | "not_measured_today";
  reason: RomReasonId;
}
export interface RomProtocol {
  rulesVersion: string;
  /** at most MAX_MEASURED_PER_CHECK without skipped */
  items: RomProtocolItem[];
  /** beyond the cap, shown as not measured today */
  deferred: RomProtocolItem[];
  /** default only movements of affected regions, absent joints, safety skips */
  notMeasured: RomNotMeasured[];
  sitBeforeStand: boolean;
}
/** C-13 and rom-protocol sessionOrder: at most 8 measured movements per check. */
export const MAX_MEASURED_PER_CHECK = 8;
export interface RomProtocolInput {
  intake: Intake & Required<Pick<Intake, "sex" | "regions" | "walking">>;
  setting: "home" | "booth";
  today: FocusToday;
  /** The baseline's protocol at a retest: same positions for movements measured before (like with like). */
  previous?: RomProtocol | null;
  /** The measured cap; MAX_MEASURED_PER_CHECK unless the start route passes the showcase cap (2, F1). */
  maxMeasured?: number;
}

/* ------------------------------------------------------------ constants */

/** rom-protocol 6 pain_today: «Today's pain in this region 6 or more out of 10» (the cut of the shared pain rule). */
export const PAIN_TODAY_SKIP_AT = 6;

type LimbSide = "left" | "right";
const LEG_REGIONS: readonly RegionId[] = ["hip", "knee", "ankle_foot"];
const ARM_REGIONS: readonly RegionId[] = ["shoulder", "elbow", "forearm_wrist"];

/**
 * The present parts of each limb loss level (rom-protocol 2.4, column Present): «below knee: hip, knee
 * (residual)»; «above knee: hip (residual thigh)»; «below elbow: shoulder, elbow (residual)»; «above
 * elbow: shoulder (residual upper arm)». The other regions of that limb are absent: not applicable.
 */
export const LIMB_LOSS_PRESENT_REGIONS: Readonly<Record<LimbLossLevel, readonly RegionId[]>> = Object.freeze({
  below_knee: ["hip", "knee"],
  above_knee: ["hip"],
  below_elbow: ["shoulder", "elbow"],
  above_elbow: ["shoulder"],
});
const LIMB_OF_LEVEL: Record<LimbLossLevel, "leg" | "arm"> = {
  below_knee: "leg",
  above_knee: "leg",
  below_elbow: "arm",
  above_elbow: "arm",
};
/** The more proximal level wins when a limb carries two. */
const LEVEL_SEVERITY: Record<LimbLossLevel, number> = {
  below_knee: 1,
  above_knee: 2,
  below_elbow: 1,
  above_elbow: 2,
};

/** The v1.1 chair stand pain areas of the standing gate (check-v1 tests chair_stand_30s exclusions.pain). */
const STANDING_PAIN_AREAS: readonly string[] = ["hip", "knee", "back"];
/** Global gate conditions: «cardiac, other, cfs_moderate». */
const GATE_CONDITIONS: readonly string[] = ["cardiac", "other", "cfs_moderate"];
/** «stroke or SCI without clearance». */
const CLEARANCE_CONDITIONS: readonly string[] = ["stroke", "sci_complete", "sci_incomplete"];
/**
 * The upper motor neuron conditions of the lunge helper rule («a leg with weakness or an upper motor
 * neuron condition»), as exercise-targets causeResolution order 2 names them: «Stroke, MS, cerebral
 * palsy or incomplete SCI». Complete SCI never stands (standing gate).
 */
const UMN_CONDITIONS: readonly string[] = ["stroke", "ms", "cerebral_palsy", "sci_incomplete"];

/** Surgery «less than 3 months ago», injury «in the last 6 weeks» (the body map since buckets). */
const UNDER_3_MONTHS = new Set(["lt6w", "6w_3m"]);

/**
 * The hip precaution filters after a hip replacement in the last 3 months (rom-protocol 6
 * hip_replacement_recent, R63): «posterior: no flexion past 90, no internal rotation or adduction past
 * neutral; anterior: no extension past 20, no external rotation past 50». A measured movement taken to
 * its end range against one of them is not measured (surgery_precaution): hip bend (posterior) and leg
 * back (anterior); the rotations are default only and adduction is never measured. They are on by
 * default unless the person answers «لم يُطلب مني تجنّب أي حركة» (none); otherwise only the ticked items.
 */
const HIP_PRECAUTION_DEFAULT: readonly RomMovementId[] = ["hip_flexion", "hip_extension"];
const HIP_AVOID_MOVEMENTS: Record<HipAvoidId, readonly RomMovementId[]> = {
  flex90: ["hip_flexion"], // «Bending my hip past a right angle»
  cross: [], // «Crossing my legs»: adduction, not measured
  turn_in: [], // «Turning my leg in»: internal rotation, default only
  back_out: ["hip_extension"], // «Taking my leg behind me or turning it out»
  none: [],
};

/** sessionOrder: «seated block, then standing block, then lying block» (C-13: gait between standing and lying). */
const BLOCK_OF: Record<RomPositionId, RomBlock> = {
  seated: "seated",
  seated_forward: "seated",
  seated_armrests: "seated",
  standing: "standing",
  standing_supported: "standing",
  lying_back: "lying",
};
const BLOCK_ORDER: Record<RomBlock, number> = { seated: 0, standing: 1, lying: 2 };
/** «group by position to limit changes»: inside a block the positions in this order. */
const POSITION_ORDER: Record<RomPositionId, number> = {
  seated: 0,
  seated_armrests: 1,
  seated_forward: 2,
  standing_supported: 0,
  standing: 1,
  lying_back: 0,
};
/**
 * «seated block (shoulder, elbow, neck, seated variants), then standing block (leg back, leg to the
 * side, knee to wall, bending), then lying block (knee to chest, knee bend, knee straightening). Core
 * movements first.» One movement order serves the three blocks.
 */
export const MOVEMENT_RUN_ORDER: readonly RomMovementId[] = Object.freeze([
  "shoulder_flexion",
  "shoulder_abduction",
  "shoulder_extension",
  "elbow_extension",
  "elbow_flexion",
  "neck_lateral_flexion",
  "neck_flexion",
  "neck_extension",
  "hip_flexion",
  "hip_extension",
  "hip_abduction",
  "knee_flexion",
  "knee_extension",
  "ankle_dorsiflexion_lunge",
  "trunk_flexion",
  "trunk_lateral_flexion",
]);
const SIDE_ORDER: Record<RomSide, number> = { right: 0, left: 1, none: 2 };
/** When no position is open, the reason shown: the most specific gate first. */
const POSITION_REASON_ORDER: readonly RomV7ReasonId[] = [
  "sitting_balance",
  "seated_lean_gate",
  "standing_not_allowed",
  "helper_needed",
];

/**
 * Where each safety id of rom-protocol 6 is enforced, in data order (a test keeps it complete).
 * buildRomProtocol applies the ones it can decide from the intake and the day's answers; the others
 * belong to the v1 pre-check through the bridge (focus-precheck.ts), the shared pain rule or the runner.
 */
export const ROM_SAFETY_RULES: readonly { id: RomSafetyId; where: string }[] = Object.freeze([
  {
    id: "global_gate",
    where: "buildRomProtocol: globalGate (no range check; clearance_needed for stroke or SCI)",
  },
  { id: "after_surgery_recent", where: "buildRomProtocol: surgery_not_cleared for the region and side" },
  {
    id: "after_surgery_precaution",
    where: "buildRomProtocol: surgery_precaution for the movements to avoid",
  },
  {
    id: "hip_replacement_recent",
    where: "buildRomProtocol: hip bend hip_replacement_recent; the hip filters",
  },
  { id: "spine_surgery", where: "buildRomProtocol: spine_surgery for the neck or back region" },
  { id: "acute_injury", where: "buildRomProtocol: acute_injury for the region and side" },
  { id: "red_flags", where: "buildRomProtocol: red_flag from FocusToday.redFlagRegions (rf_region)" },
  { id: "pain_today", where: "buildRomProtocol: pain_today from FocusToday.painByRegion" },
  { id: "pain_during", where: "painStopRule, the shared pain rule, called by the RomRunner (B)" },
  { id: "achilles", where: "buildRomProtocol: achilles for the knee to wall lunge" },
  { id: "osteoporosis", where: "buildRomProtocol: osteoporosis for the forward bend" },
  { id: "neck_caution", where: "buildRomProtocol: neck_caution for the neck region" },
  { id: "standing_tests", where: "buildRomProtocol: standingGate and the standing helper rules" },
  { id: "no_overhead", where: "buildRomProtocol: no_overhead for the arm raises" },
  { id: "weak_shoulder", where: "the v1 precheck item pc_weak_shoulder through applyPrecheckOutcome" },
  { id: "sci_t6", where: "the v1 precheck: evaluatePrecheck warns warn_sci_t6; AD signs in stopOptions" },
  { id: "limb_loss", where: "buildRomProtocol: limb_absent and not_measured_camera (limb loss levels)" },
  { id: "never", where: "the RomRunner (B): active movement only, no push after pain" },
  {
    id: "seated_side_lean_gate",
    where:
      "buildRomProtocol (balance_support at home) and the v1 precheck of trunk_control_seated through applyPrecheckOutcome",
  },
  {
    id: "sitting_balance",
    where: "buildRomProtocol: sitting_balance for seated_forward and the seated forward bend",
  },
  { id: "sit_before_stand", where: "buildRomProtocol: the block order and sitBeforeStand" },
  { id: "coach_end_range", where: "the RomRunner keepReaching and the coach tools (B, D)" },
  { id: "limb_loss_standing", where: "buildRomProtocol: standingGate needs the prosthesis on" },
]);

/* ------------------------------------------------------------- the gates */

/**
 * rom-protocol 6 global_gate: «The v1.1 global gate decides whether any camera test runs (cardiac,
 * other, cfs_moderate, bed, no_exercise, warning symptoms, recent change, stroke or SCI without
 * clearance)». clearance_needed for stroke or SCI without clearance yes, in both settings (v7 has no
 * booth exception: gait-rules 1.1 and review A17); global_gate for the others; null when it passes.
 */
export function globalGate(intake: Intake): "global_gate" | "clearance_needed" | null {
  if (
    intake.mobility === "bed" ||
    intake.conditions.some((c) => GATE_CONDITIONS.includes(c)) ||
    intake.restrictions.includes("no_exercise") ||
    intake.symptoms === "yes" ||
    intake.recentChange === "yes"
  )
    return "global_gate";
  if (intake.clearance !== "yes" && intake.conditions.some((c) => CLEARANCE_CONDITIONS.includes(c)))
    return "clearance_needed";
  return null;
}

/** A leg limb loss: a leg level on the body map, or the v1 condition lower_limb_unilateral. */
function hasLowerLimbLoss(intake: Intake): boolean {
  return (
    intake.conditions.includes("lower_limb_unilateral") ||
    (intake.regions ?? []).some(
      (e) =>
        e.problems.includes("limb_loss") &&
        e.limbLoss !== undefined &&
        LIMB_OF_LEVEL[e.limbLoss.level] === "leg",
    )
  );
}

/**
 * The standing positions (rom-protocol 2.5 and 6 standing_tests): «the v1.1 chair stand exclusions and
 * helper rules (H6 rule 2): not with hip, knee or back pain areas, no_weight_bearing, balance_support at
 * home, sci_complete, clearance no or not sure at home; lower limb loss only with the prosthesis on»,
 * for people who stand (mobility). Clearance no or not sure blocks in both settings: D-016 extended the
 * chair stand rule to the booth (contract change log, A4). At the booth balance_support stands with
 * staff beside (helperRequired).
 */
export function standingGate(
  intake: Intake,
  setting: "home" | "booth",
  today: FocusToday,
): "standing_not_allowed" | null {
  const blocked =
    intake.mobility !== "standing" ||
    intake.pain.some((p) => STANDING_PAIN_AREAS.includes(p)) ||
    intake.restrictions.includes("no_weight_bearing") ||
    (intake.restrictions.includes("balance_support") && setting === "home") ||
    intake.conditions.includes("sci_complete") ||
    intake.clearance !== "yes" ||
    (hasLowerLimbLoss(intake) && today.prosthesisOn !== true);
  return blocked ? "standing_not_allowed" : null;
}

/**
 * sit_unsupported_ask: «absent means yes, except mobility bed and SCI at neck level, which mean no». The
 * intake asks it of every other person with SCI, so an SCI intake without the answer counts as no.
 */
function sitsUnsupported(intake: Intake): boolean {
  const answer = intake.romFlags?.sitUnsupported;
  if (answer !== undefined) return answer === "yes";
  return !(
    intake.mobility === "bed" || intake.conditions.some((c) => c === "sci_complete" || c === "sci_incomplete")
  );
}

/* ------------------------------------------------------- the person today */

interface Day {
  intake: RomProtocolInput["intake"];
  setting: "home" | "booth";
  today: FocusToday;
  gate: "clearance_needed" | null;
  standing: "standing_not_allowed" | null;
  /** seated_forward: «people who answer yes to sit_unsupported_ask ...; a wheelchair user also only after a transfer». */
  seatedForward: boolean;
  /** The seated forward bend: «Only with sit_unsupported_ask yes». */
  sitsUnsupported: boolean;
  /**
   * lying_back: «people who can lie down and get up safely, alone or with their usual helper». No
   * question asks it: a wheelchair user needs a safe transfer (transfer_chair_ask yes); contract change
   * log, A4. A failed lying position reads helper_needed.
   */
  lying: boolean;
  /** seated_armrests: the v1.1 side lean gate; balance_support at home is its home only exclusion. */
  sideLean: "seated_lean_gate" | null;
  neckCaution: boolean;
  parkinsons: boolean;
  umn: boolean;
  /** Leg regions on both sides of the body map (the standing hip tests need a helper). */
  bothLegs: boolean;
  weakLegs: Set<LimbSide>;
}

function dayOf(input: RomProtocolInput, gate: "clearance_needed" | null): Day {
  const { intake, setting, today } = input;
  const flags = intake.romFlags;
  const wheelchair = intake.mobility === "wheelchair";
  const transfers = flags?.transferChair === true;
  const sits = sitsUnsupported(intake);
  const legSides = new Set<LimbSide>();
  const weakLegs = new Set<LimbSide>();
  for (const e of intake.regions) {
    if (!LEG_REGIONS.includes(e.region)) continue;
    for (const s of limbSides(e)) {
      legSides.add(s);
      if (e.problems.includes("weakness")) weakLegs.add(s);
    }
  }
  const inflammatory = flags?.inflammatoryArthritis === "yes" || flags?.inflammatoryArthritis === "unsure";
  return {
    intake,
    setting,
    today,
    gate,
    standing: standingGate(intake, setting, today),
    seatedForward: sits && (!wheelchair || (transfers && today.transferChair === true)),
    sitsUnsupported: sits,
    lying: !wheelchair || transfers,
    sideLean:
      intake.restrictions.includes("balance_support") && setting === "home" ? "seated_lean_gate" : null,
    // «Told the neck is unstable, or dizziness ...; or rheumatoid or another inflammatory arthritis
    // (arthritis subtype yes or not sure) unless a doctor has confirmed the neck is stable».
    neckCaution: flags?.neckCaution === true || (inflammatory && flags?.neckCleared !== true),
    parkinsons: intake.conditions.includes("parkinsons"),
    umn: intake.conditions.some((c) => UMN_CONDITIONS.includes(c)),
    bothLegs: legSides.size === 2,
    weakLegs,
  };
}

/* ------------------------------------------------------- body map units */

/** One region and side of the body map, with every entry that covers it. */
interface Unit {
  region: RegionId;
  side: LimbSide | "axial";
  entries: RegionEntry[];
}

const isAxial = (region: RegionId) => AXIAL_REGIONS.includes(region);

/** The limb sides of an entry: both is right and left (a limb region marked axial counts as both). */
function limbSides(e: RegionEntry): LimbSide[] {
  return e.side === "left" || e.side === "right" ? [e.side] : ["right", "left"];
}

function unitsOf(regions: readonly RegionEntry[]): Unit[] {
  const units = new Map<string, Unit>();
  for (const e of regions) {
    const sides: (LimbSide | "axial")[] = isAxial(e.region) ? ["axial"] : limbSides(e);
    for (const side of sides) {
      const key = `${e.region}:${side}`;
      const unit = units.get(key) ?? { region: e.region, side, entries: [] };
      unit.entries.push(e);
      units.set(key, unit);
    }
  }
  return [...units.values()];
}

const hasProblem = (u: Unit, p: ProblemType) => u.entries.some((e) => e.problems.includes(p));
/** «Surgery ... less than 3 months ago»; without a surgery answer the safe reading (recent). */
const surgeryUnder3m = (e: RegionEntry) =>
  e.problems.includes("after_surgery") && (!e.surgery || UNDER_3_MONTHS.has(e.surgery.since));
/** «Injury to this region in the last 6 weeks»; without an injury answer the safe reading (recent). */
const injuryUnder6w = (e: RegionEntry) =>
  e.problems.includes("injury") && (!e.injury || e.injury.since === "lt6w");
const hipReplacementRecent = (e: RegionEntry) =>
  e.region === "hip" && surgeryUnder3m(e) && e.surgery?.hipReplacement === true;

/** The movements the surgical team said to avoid, and the hip precaution filters. */
function precautions(u: Unit): Set<RomMovementId> {
  const out = new Set<RomMovementId>();
  for (const e of u.entries) {
    if (!e.problems.includes("after_surgery") || !e.surgery) continue;
    // The surgeon's instruction wins (R37): a movement to avoid is never measured.
    for (const m of e.surgery.avoid ?? []) out.add(m);
    if (!hipReplacementRecent(e)) continue;
    const ticked = (e.surgery.hipAvoid ?? []).filter((h) => h !== "none");
    const toldNone = (e.surgery.hipAvoid ?? []).includes("none") && ticked.length === 0;
    const filtered =
      ticked.length > 0
        ? ticked.flatMap((h) => HIP_AVOID_MOVEMENTS[h])
        : toldNone
          ? []
          : HIP_PRECAUTION_DEFAULT;
    for (const m of filtered) out.add(m);
  }
  return out;
}

/**
 * The reason a movement of a unit does not run today, before its position: section 6 in this order of
 * precedence (red flag first, as it routes to the seek care screen). Null: it may run.
 */
function safetyReason(u: Unit, m: RomMovementId, day: Day): RomV7ReasonId | null {
  if (day.today.redFlagRegions.includes(u.region)) return "red_flag";
  if (day.gate) return day.gate;
  if (isAxial(u.region) && u.entries.some(surgeryUnder3m)) return "spine_surgery";
  if (u.entries.some((e) => surgeryUnder3m(e) && e.surgery?.cleared !== "yes")) return "surgery_not_cleared";
  if (m === "hip_flexion" && u.entries.some(hipReplacementRecent)) return "hip_replacement_recent";
  if (precautions(u).has(m)) return "surgery_precaution";
  if (u.entries.some(injuryUnder6w)) return "acute_injury";
  if (
    m === "ankle_dorsiflexion_lunge" &&
    u.entries.some((e) => e.problems.includes("injury") && e.injury?.achilles)
  )
    return "achilles";
  const pain = day.today.painByRegion[u.region];
  if (pain !== undefined && pain >= PAIN_TODAY_SKIP_AT) return "pain_today";
  if (u.region === "neck" && day.neckCaution) return "neck_caution";
  if (m === "trunk_flexion" && day.intake.romFlags?.osteoporosis === true) return "osteoporosis";
  if (
    (m === "shoulder_flexion" || m === "shoulder_abduction") &&
    day.intake.restrictions.includes("no_overhead")
  )
    return "no_overhead";
  return null;
}

/* ------------------------------------------------------------ positions */

/** Parkinson's: «the only hip bend variant» and «the only variant» of the forward bend is seated (A10). */
function positionsOf(def: RomMovementDef, day: Day): RomPositionId[] {
  const all = def.positions.map((p) => p.id);
  if (day.parkinsons && (def.id === "hip_flexion" || def.id === "trunk_flexion"))
    return all.filter((p) => p === "seated");
  return all;
}

function positionBlock(m: RomMovementId, position: RomPositionId, day: Day): RomV7ReasonId | null {
  switch (position) {
    case "seated":
      // The seated forward bend: «Only with sit_unsupported_ask yes» (review C11).
      return m === "trunk_flexion" && !day.sitsUnsupported ? "sitting_balance" : null;
    case "seated_forward":
      return day.seatedForward ? null : "sitting_balance";
    case "standing":
    case "standing_supported":
      return day.standing;
    case "lying_back":
      return day.lying ? null : "helper_needed";
    case "seated_armrests":
      return day.sideLean;
  }
}

/** The first open position in data order, the baseline's position at a retest when it is still open (like with like). */
function choosePosition(
  def: RomMovementDef,
  side: RomSide,
  day: Day,
  previous: RomProtocol | null | undefined,
): { position: RomPositionId; reason: RomV7ReasonId | null } {
  const options = positionsOf(def, day);
  const before = previous?.items.find((i) => i.movementId === def.id && i.side === side && !i.skipped);
  if (before && options.includes(before.position) && positionBlock(def.id, before.position, day) === null)
    return { position: before.position, reason: null };
  const reasons: RomV7ReasonId[] = [];
  for (const position of options) {
    const reason = positionBlock(def.id, position, day);
    if (reason === null) return { position, reason: null };
    reasons.push(reason);
  }
  const reason =
    POSITION_REASON_ORDER.find((r) => reasons.includes(r)) ?? reasons[0] ?? "standing_not_allowed";
  return { position: options[0] ?? def.positions[0].id, reason };
}

/**
 * Someone beside the person: «helper beside for the lunge on a weak or upper motor neuron leg and for
 * the standing hip tests when both legs are affected» (2.5 standing_supported), and balance_support
 * («no one beside with balance_support»), which stands only at the booth, with staff.
 */
function needsHelper(def: RomMovementDef, position: RomPositionId, u: Unit, day: Day): boolean {
  if (BLOCK_OF[position] !== "standing") return false;
  if (day.intake.restrictions.includes("balance_support")) return true;
  if (def.id === "ankle_dorsiflexion_lunge")
    return day.umn || (u.side !== "axial" && day.weakLegs.has(u.side));
  if (def.id === "hip_extension" || def.id === "hip_abduction") return day.bothLegs;
  return false;
}

/* --------------------------------------------------------------- build */

interface Draft {
  key: string;
  item: RomProtocolItem;
  run: number[];
  priority: number;
}

const keyOf = (m: JointMovementId, side: RomSide) => `${m}:${side}`;
const runOf = (item: RomProtocolItem) => [
  BLOCK_ORDER[item.block],
  POSITION_ORDER[item.position],
  item.priority === "core" ? 0 : 1,
  MOVEMENT_RUN_ORDER.indexOf(item.movementId),
  SIDE_ORDER[item.side],
];
const compare = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

function draftItem(
  def: RomMovementDef,
  side: RomSide,
  u: Unit,
  day: Day,
  previous: RomProtocol | null | undefined,
): Draft {
  const { position, reason } = choosePosition(def, side, day, previous);
  const p = def.positions.find((x) => x.id === position)!;
  const helperRequired = needsHelper(def, position, u, day);
  let skipped: RomReasonId | undefined = safetyReason(u, def.id, day) ?? reason ?? undefined;
  // At home a helper must be present today; at the booth the staff stand beside the person.
  if (!skipped && helperRequired && day.setting === "home" && day.today.helperPresent !== true)
    skipped = "helper_needed";
  const item: RomProtocolItem = {
    movementId: def.id,
    side,
    region: u.region,
    position,
    block: BLOCK_OF[position],
    order: 0,
    priority: def.priority,
    verdict: def.verdict,
    normId: p.normId,
    graded: p.graded,
    // «Weakness or paralysis: ... First ask whether the person can move the joint on their own».
    askCanMove: hasProblem(u, "weakness"),
    helperRequired,
    // Caution movements, and the arm raises and the lunge in the person's view as well (B17).
    approximate: def.verdict === "caution" || def.approximateInPersonView,
    ...(skipped ? { skipped } : {}),
  };
  return { key: keyOf(def.id, side), item, run: runOf(item), priority: def.priority === "core" ? 0 : 1 };
}

const MOVEMENT_INDEX = new Map<JointMovementId, number>(
  [...ROM_MOVEMENT_IDS, ...DEFAULT_ONLY_IDS].map((id, i) => [id, i]),
);
const notMeasuredOrder = (n: RomNotMeasured) => [
  REGION_IDS.indexOf(n.region),
  MOVEMENT_INDEX.get(n.movementId) ?? 0,
  SIDE_ORDER[n.side],
];

/** Region table, problem type rules (2.2), limb loss (2.4), positions (2.5), every safety id of rom-protocol 6, sessionOrder, the cap. */
export function buildRomProtocol(input: RomProtocolInput): RomProtocol {
  const { intake, today } = input;
  const gate = globalGate(intake);
  const empty: RomProtocol = {
    rulesVersion: ROM_RULES_VERSION,
    items: [],
    deferred: [],
    notMeasured: [],
    sitBeforeStand: false,
  };
  // «No range check»: nothing is planned (the start route answers REVIEW first; contract change log, A4).
  if (gate === "global_gate") return empty;
  const day = dayOf(input, gate);
  const units = unitsOf(intake.regions);

  const notMeasured = new Map<string, RomNotMeasured>();
  const drafts = new Map<string, Draft>();

  // Limb loss (2.4): the most proximal level per limb and side; absent joints are not applicable, a
  // residual joint the camera cannot measure is not_measured_camera, on or off the body map.
  const losses = new Map<string, { limb: "leg" | "arm"; side: LimbSide; level: LimbLossLevel }>();
  for (const e of intake.regions) {
    if (!e.problems.includes("limb_loss") || !e.limbLoss || isAxial(e.region)) continue;
    const limb = LIMB_OF_LEVEL[e.limbLoss.level];
    for (const side of limbSides(e)) {
      const key = `${limb}:${side}`;
      const had = losses.get(key);
      if (!had || LEVEL_SEVERITY[e.limbLoss.level] > LEVEL_SEVERITY[had.level])
        losses.set(key, { limb, side, level: e.limbLoss.level });
    }
  }
  for (const { limb, side, level } of losses.values()) {
    const present = LIMB_LOSS_PRESENT_REGIONS[level];
    for (const region of limb === "leg" ? LEG_REGIONS : ARM_REGIONS) {
      if (present.includes(region)) continue;
      const row = regionRow(region);
      for (const m of [...row.measure, ...row.caution, ...row.default])
        notMeasured.set(keyOf(m, side), {
          movementId: m,
          side,
          region,
          source: "not_applicable",
          reason: "limb_absent",
        });
    }
    const lvl = ROM_DATA.limbLoss.levels.find((l) => l.level === level);
    for (const [m, reason] of Object.entries(lvl?.notMeasured ?? {}) as [RomMovementId, string][]) {
      const region = movementDef(m).region;
      notMeasured.set(
        keyOf(m, side),
        reason === "limb_absent"
          ? { movementId: m, side, region, source: "not_applicable", reason: "limb_absent" }
          : { movementId: m, side, region, source: "not_measured_camera", reason: "not_measured_camera" },
      );
    }
  }

  for (const u of units) {
    const row = regionRow(u.region);
    for (const m of [...row.measure, ...row.caution]) {
      const def = movementDef(m);
      const sides: RomSide[] =
        u.side === "axial" ? (def.bothDirections ? ["right", "left"] : ["none"]) : [u.side];
      for (const side of sides) {
        if (notMeasured.has(keyOf(m, side))) continue;
        drafts.set(keyOf(m, side), draftItem(def, side, u, day, input.previous));
      }
    }
    // Default only movements of an affected region: stored as not measured, never as typical (A01);
    // with a red flag today they carry red_flag for the record.
    const side: RomSide = u.side === "axial" ? "none" : u.side;
    for (const m of row.default) {
      if (notMeasured.has(keyOf(m, side))) continue;
      const redFlag = today.redFlagRegions.includes(u.region);
      notMeasured.set(keyOf(m, side), {
        movementId: m,
        side,
        region: defaultDef(m).region,
        source: redFlag ? "not_measured_today" : "not_measured_camera",
        reason: redFlag ? "red_flag" : "not_measured_camera",
      });
    }
  }

  // The cap: at most maxMeasured runnable items, core movements first, then the session order.
  const cap =
    input.maxMeasured !== undefined && Number.isFinite(input.maxMeasured)
      ? Math.max(0, Math.min(MAX_MEASURED_PER_CHECK, Math.floor(input.maxMeasured)))
      : MAX_MEASURED_PER_CHECK;
  const all = [...drafts.values()];
  const chosen = new Set(
    all
      .filter((d) => !d.item.skipped)
      .sort((a, b) => a.priority - b.priority || compare(a.run, b.run))
      .slice(0, cap)
      .map((d) => d.key),
  );
  const byRun = (a: Draft, b: Draft) => compare(a.run, b.run);
  const items = all.filter((d) => d.item.skipped || chosen.has(d.key)).sort(byRun);
  const deferred = all.filter((d) => !d.item.skipped && !chosen.has(d.key)).sort(byRun);
  let order = 0;
  const numbered = (d: Draft): RomProtocolItem => ({ ...d.item, order: ++order });

  const out: RomProtocol = {
    rulesVersion: ROM_RULES_VERSION,
    items: items.map(numbered),
    deferred: deferred.map(numbered),
    notMeasured: [...notMeasured.values()].sort((a, b) => compare(notMeasuredOrder(a), notMeasuredOrder(b))),
    sitBeforeStand: false,
  };
  // «After the lying block ... sit on the edge of the bed for about a minute before standing».
  out.sitBeforeStand = out.items.some((i) => i.block === "lying" && !i.skipped);
  return out;
}
