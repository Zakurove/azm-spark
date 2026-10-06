/**
 * Exercise targets and the targeted program (product v7 contract 2.10, stream E, step E2): rules before
 * AI. Pure, no DOM; the server runs it (POST /api/program/targets and the intake hook), so the client
 * never loads the targets data for it (it reads the why lines the weekly plan carries).
 *
 *   collectTargets   the range findings (B4's romFindings) and the walk's patterns (C3's evaluateGait)
 *                    to target requests, by the signed off mapping (exercise-targets 5.1 to 5.7,
 *                    TARGETS_DATA.mapping): gradeRules, the cause paths, romMovements, gaitStatusRules,
 *                    regionDefaultRule, the wheelchair shoulder block, the neck and arthritis add ons,
 *                    the merge
 *   whyLine          the reason of an exercise from the whyLines templates, Arabic first; two reasons
 *                    are joined with why_both
 *
 * Every number is read from the runtime data. The rules the data writes in words are code here, each
 * quoting its words, and tests/v7/e-targets.test.ts holds each to the data (C-1).
 */
import { entryCells, limbOf, type RegionEntry, type RegionId, type RegionSide } from "./body-map";
import {
  openPositions,
  regionId,
  REGION_ID_KINDS,
  regionOfTarget,
  regionOpenPositions,
  SEATED_LEAN_BACK_PAIN_AT,
  v7Contraindications,
} from "./contraindications";
import type { StoredFocusToday } from "./focus-precheck";
import type { GaitPlan } from "./gait-eligibility";
import { gaitPatternLines, gaitPatternShown } from "./gait-rules";
import type { GaitPatternResult, GaitSupportFinding } from "./gait-types";
import { adjustReps, adjustSets } from "./legacy-config";
import type { Intake, Plan } from "./plan";
import { configsFor, libraryPool, programPool } from "./pool";
import { hasLowerLimbLoss, LIMB_LOSS_PRESENT_REGIONS } from "./rom-protocol";
import type { CausePath, RomChange, RomFinding, RomProfile } from "./rom-types";
import type {
  DoseProfileId,
  ExercisePosition,
  ReferralId,
  TargetAction,
  TargetId,
  TargetReason,
  TargetRequest,
  TargetedItem,
} from "./target-types";
import {
  BLOCK_SIZES,
  buildWeekly,
  cameraTwins,
  defaultSelection,
  engineWeekly,
  type L,
  type LibraryExercise,
  type Selection,
  type WeeklyItem,
  type WeeklyPlan,
} from "./weekly";
import { GAIT_DATA } from "../movements/gait";
import { movementDef, ROM_DATA } from "../movements/rom";
import type { Evidence, RomMovementId } from "../movements/rom/types";
import { doseProfile, TARGETS_DATA } from "../movements/targets";
import type { WhyLineId } from "../movements/targets/types";

const MAPPING = TARGETS_DATA.mapping;

/* ------------------------------------------------------------- the data */

function needed<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`The targets data misses ${what}`);
  return v;
}
function priorityOf(n: unknown, what: string): 1 | 2 | 3 {
  if (n === 1 || n === 2 || n === 3) return n;
  throw new Error(`The targets data gives ${what} the priority ${String(n)}`);
}

const PATHS = new Map(MAPPING.paths.map((p) => [p.path, p]));
function pathRow(path: CausePath) {
  return needed(PATHS.get(path), `the path ${path}`);
}
const ROM_MOVEMENTS = new Map(MAPPING.romMovements.map((m) => [m.movement, m]));
function movementRow(id: RomMovementId) {
  return needed(ROM_MOVEMENTS.get(id), `romMovements ${id}`);
}
function gradeRule(startsWith: string) {
  return needed(
    MAPPING.gradeRules.find((r) => r.finding.startsWith(startsWith)),
    `the gradeRules row ${startsWith}`,
  );
}

/**
 * paths.plus: the paths whose items come from the pain friendly set: post_op_early «unloaded active
 * range from the pain friendly set only», pain_irritable «pain friendly gentle range only», pain_stable
 * «pain friendly range plus strengthening» (5.8 step 4: «pain friendly items ... only on the pain
 * paths»).
 */
export const PAIN_FRIENDLY_PATHS: readonly CausePath[] = ["post_op_early", "pain_irritable", "pain_stable"];
/** gradeRules mildlyLimited: «for the lunge only on the tight, pain or rehab paths (review B03)». */
export const LUNGE_MILD_PATHS: readonly CausePath[] = ["tight", "pain_irritable", "pain_stable", "rehab"];
/**
 * gradeRules noNormPosition: «knee straightening in sitting with a lack above 52: mobility:knee_extension
 * and stretch:hamstrings at priority 1 plus refer_measure».
 */
export const SEATED_KNEE_TARGETS: readonly TargetId[] = ["mobility:knee_extension", "stretch:hamstrings"];
const SEATED_KNEE_PRIORITY = priorityOf(gradeRule("noNormPosition").seatedLackPriority, "the seated knee");
/**
 * gradeRules not_measured_camera (residual joint after limb loss): «mobility:hip_extension above an
 * above knee loss; mobility:knee_extension above a below knee loss; refer_measure». The residual joint
 * of an above knee loss is the hip, of a below knee loss the knee; the data names no target above an
 * arm loss, so a residual elbow or shoulder gets the line alone.
 */
export const RESIDUAL_TARGETS: Readonly<Partial<Record<RegionId, TargetId>>> = {
  hip: "mobility:hip_extension",
  knee: "mobility:knee_extension",
};
const RESIDUAL_PRIORITY = priorityOf(gradeRule("not_measured_camera (residual").priority, "a residual joint");
/**
 * gradeRules no_active_movement: «no active exercise for that movement; for the shoulder only,
 * table_slides with the other hand helping (self assisted, allowed at the sign off: EX-Q5); show
 * refer_care_team». The shoulder's own range target is kept, and only these items may fill it.
 */
export const SELF_ASSISTED_SHOULDER: readonly string[] = ["table_slides"];
/** The finding's priority is B4's (findingPriority): a joint the person could not move takes 1. */

/**
 * neckAddOn: «Every neck finding (neck_flexion, neck_extension, neck_lateral_flexion) adds
 * strengthen:neck_deep_flexors and strengthen:scapular_retractors at priority 2 on every path except
 * pain_irritable and post_op_early, whatever the end range answer».
 */
export const NECK_ADD_ON = {
  movements: ["neck_flexion", "neck_extension", "neck_lateral_flexion"] as readonly RomMovementId[],
  targets: ["strengthen:neck_deep_flexors", "strengthen:scapular_retractors"] as readonly TargetId[],
  exceptPaths: ["pain_irritable", "post_op_early"] as readonly CausePath[],
};
const NECK_ADD_ON_PRIORITY = priorityOf(MAPPING.neckAddOnPriority, "the neck add on");

/**
 * arthritisAddOn: «always add strengthening of the muscles around the joint at the finding's priority
 * (knee: quadriceps and hip abductors; hip: hip abductors and hip extensors; shoulder: scapular
 * retractors and the shoulder muscles that move the limited direction) and walking practice for people
 * who walk». The shoulder's «muscles that move the limited direction» are the movement's own
 * strengthening targets (romMovements).
 */
export const ARTHRITIS_MUSCLES = {
  knee: ["strengthen:quadriceps", "strengthen:hip_abductors"],
  hip: ["strengthen:hip_abductors", "strengthen:hip_extensors"],
  shoulder: ["strengthen:scapular_retractors"],
} as const satisfies Partial<Record<RegionId, readonly TargetId[]>>;
const arthritisMuscles = (region: RegionId): readonly TargetId[] | undefined =>
  (ARTHRITIS_MUSCLES as Partial<Record<RegionId, readonly TargetId[]>>)[region];
const WALKING_PRACTICE: TargetId = "practice:walking";

/**
 * taxonomy.gaitRulesAlignment muscles_around_painful_joint: «resolved by the painful joint: hip =
 * strengthen:hip_abductors + strengthen:hip_extensors; knee = strengthen:quadriceps +
 * strengthen:hamstrings; ankle or foot = strengthen:calf + strengthen:ankle_dorsiflexors», «added from
 * week 1 on the pain_stable path (isometrics first), and once pain is stable on the pain_irritable
 * path» (5.5). The walk cannot tell that pain has settled (gait-rules leaves «pain settles» to the
 * program), so the joint's own range finding decides: its pain_stable path adds them; an irritable path,
 * or no range finding of that joint, does not (the safe side, as B4 reads an unknown pain).
 */
export const PAINFUL_JOINT_MUSCLES = {
  hip: ["strengthen:hip_abductors", "strengthen:hip_extensors"],
  knee: ["strengthen:quadriceps", "strengthen:hamstrings"],
  ankle_foot: ["strengthen:calf", "strengthen:ankle_dorsiflexors"],
} as const satisfies Partial<Record<RegionId, readonly TargetId[]>>;
const painfulJointMuscles = (region: RegionId): readonly TargetId[] | undefined =>
  (PAINFUL_JOINT_MUSCLES as Partial<Record<RegionId, readonly TargetId[]>>)[region];
/**
 * gaitPatterns: «mobility:<painful joint movements> (when pain friendly only)» of the antalgic label and
 * «mobility:hip_flexion, mobility:hip_extension, mobility:hip_abduction (when hip pain: pain friendly
 * only)» of the Duchenne lean: their range targets come from the pain friendly set.
 */
const PAIN_FRIENDLY_GAIT_RANGE: readonly string[] = [
  "shorter_stance:antalgic",
  "duchenne_lean:duchenne_lean",
];

/**
 * The evidence of a target, for the order of equal priorities (5.8 step 3: «sort by priority, then by
 * evidence strength of the target (High first)»). The runtime data keeps no evidence grade per target
 * (contract gap E2-1): until it does, a target takes the grade its action's dose profile gives in the
 * clinical source (dose.profiles[].strength): strength_reps «High for strength training in general»,
 * walking_practice «High for walking training», stretch_hold «Low for changing a limitation»,
 * balance_practice «Low at this dose», mobility_reps «Very low (expert practice)», and on the pain paths
 * mobility_pain «Low». With AZM_CLINICAL_V7, tests/v7/e-targets-source.test.ts reads those words.
 */
export const TARGET_EVIDENCE: Readonly<Record<TargetAction, Evidence>> = {
  strengthen: "High",
  practice: "High",
  stretch: "Low",
  balance: "Low",
  mobility: "Very low",
};
export const PAIN_MOBILITY_EVIDENCE: Evidence = "Low";
const EVIDENCE_RANK: readonly Evidence[] = ["High", "Moderate", "Low", "Very low"];

/* ------------------------------------------------------ collect targets */

const actionOf = (id: TargetId) => id.slice(0, id.indexOf(":")) as TargetAction;
const AXIAL: readonly RegionId[] = ["neck", "back_trunk"];
const isAxialRegion = (r: RegionId | null) => r !== null && AXIAL.includes(r);

/** A target as collected, before the merge. */
interface Draft {
  id: TargetId;
  side: TargetRequest["side"];
  priority: 1 | 2 | 3;
  painFriendlyOnly: boolean;
  reasons: TargetReason[];
}

function romReason(f: RomFinding): TargetReason {
  return { kind: "rom", movementId: f.movementId, side: f.side, finding: f.finding, path: f.path };
}

/**
 * The side of a range finding's target. A limb finding works its own side. An axial finding's range and
 * stretch go toward the side of the bend («Limited bending to side X: ... bend toward X», «tilt toward
 * X»), or have none; its strengthening: the side bend's «strengthen both sides», a limb muscle (the
 * shoulder blades of the neck) on both sides, an axial muscle with no side.
 */
function sideOf(f: RomFinding, id: TargetId): TargetRequest["side"] {
  if (!isAxialRegion(f.region)) return f.side;
  if (actionOf(id) !== "strengthen") return f.side;
  if (f.movementId === "trunk_lateral_flexion") return "both";
  return isAxialRegion(regionOfTarget(id)) ? "none" : "both";
}

/** The body map's own entries of the finding's cell. */
function mapEntriesOf(h: Intake, f: Pick<RomFinding, "region" | "side">): RegionEntry[] {
  const cell = isAxialRegion(f.region) ? `${f.region}:axial` : `${f.region}:${f.side}`;
  return (h.regions ?? []).filter((e) => e.region === f.region && (entryCells(e) as string[]).includes(cell));
}

/** The targets one range finding asks for (5.1 paths, 5.2 romMovements, 5.3 gradeRules, the add ons). */
function romTargets(f: RomFinding, h: Intake, out: Draft[], referrals: ReferralId[]): void {
  const reason = romReason(f);
  const add = (id: TargetId, priority: 1 | 2 | 3, painFriendlyOnly: boolean, reasons = [reason]) =>
    out.push({ id, side: sideOf(f, id), priority, painFriendlyOnly, reasons });
  if (f.finding === "unknown") {
    if (f.noActiveMovement) {
      referrals.push("refer:care_team");
      // Only the self assisted items fill it (selectForTargets, SELF_ASSISTED_SHOULDER).
      if (f.region === "shoulder")
        for (const id of movementRow(f.movementId).mobility)
          add(id, f.priority, PAIN_FRIENDLY_PATHS.includes(f.path));
      return;
    }
    // A camera movement the camera cannot measure: a residual joint after limb loss (rom-protocol 2.4).
    referrals.push("refer:measure");
    const id = RESIDUAL_TARGETS[f.region];
    if (id) add(id, RESIDUAL_PRIORITY, PAIN_FRIENDLY_PATHS.includes(f.path));
    return;
  }
  if (f.finding === "no_grade") {
    referrals.push("refer:measure");
    for (const id of SEATED_KNEE_TARGETS) add(id, SEATED_KNEE_PRIORITY, PAIN_FRIENDLY_PATHS.includes(f.path));
    return;
  }
  const row = movementRow(f.movementId);
  const graded = f.finding === "mild" || f.finding === "marked";
  if (
    f.finding === "mild" &&
    f.movementId === "ankle_dorsiflexion_lunge" &&
    !LUNGE_MILD_PATHS.includes(f.path)
  )
    return;
  // «only a value below 0 (possible flexion contracture) adds targets» (a pain limited result follows its path).
  if (graded && row.targetsWhenBelow !== undefined && !(f.value !== null && f.value < row.targetsWhenBelow))
    return;
  const painFriendly = PAIN_FRIENDLY_PATHS.includes(f.path);
  const path = pathRow(f.path);
  const lists: Record<"mobility" | "stretch" | "strengthen", readonly TargetId[]> = {
    mobility: row.mobility,
    stretch: row.stretch,
    strengthen: row.strengthen,
  };
  for (const action of path.actions) {
    if (action !== "mobility" && action !== "stretch" && action !== "strengthen") continue;
    for (const id of lists[action]) add(id, f.priority, painFriendly);
  }
  // The «plus» of each path.
  const stretchAt = (p: number | undefined) => priorityOf(p, `the stretch of ${f.path}`);
  if (f.path === "umn" && f.cause === "tight")
    // «stretch only at priority 1 and only when the answer was tight»
    for (const id of row.stretch) add(id, stretchAt(path.stretchAtPriority), painFriendly);
  if (f.path === "pd" || f.path === "rehab")
    // «stretch at priority 1»
    for (const id of row.stretch) add(id, stretchAt(path.stretchAtPriority), painFriendly);
  if (f.path === "unknown")
    // «stretch at low priority»
    for (const id of row.stretch) add(id, 1, painFriendly);
  if (f.path === "tight" && f.finding === "marked")
    // «strengthen at low priority when the grade is marked»
    for (const id of row.strengthen) add(id, 1, painFriendly);
  if (f.path === "weak" && mapEntriesOf(h, f).some((e) => e.problems.includes("stiffness")))
    // «no stretch unless the person also reports tightness»: stiffness marked on that joint.
    for (const id of row.stretch) add(id, 1, painFriendly);
  // The neck add on (review C16).
  if (NECK_ADD_ON.movements.includes(f.movementId) && !NECK_ADD_ON.exceptPaths.includes(f.path))
    for (const id of NECK_ADD_ON.targets) add(id, NECK_ADD_ON_PRIORITY, painFriendly);
  // The arthritis add on (review C08): «any path».
  const muscles = arthritisMuscles(f.region);
  if (h.conditions.includes("arthritis") && muscles) {
    // The add on's own reason first: it has a cap of its own (findingKeys), and the finding's reason
    // after it says why.
    const arthritis: TargetReason[] = [{ kind: "arthritis", region: f.region }, reason];
    const around = f.region === "shoulder" ? [...muscles, ...row.strengthen] : muscles;
    for (const id of around) add(id, f.priority, painFriendly, arthritis);
    if (h.walking !== undefined && h.walking.status !== "no")
      out.push({
        id: WALKING_PRACTICE,
        side: "both",
        priority: f.priority,
        painFriendlyOnly: false,
        reasons: arthritis,
      });
  }
}

/** gaitStatusRules: the priority of a shown pattern, and whether it keeps only its first target. */
const GAIT_RULES = MAPPING.gaitStatusRules;
const STATUS_PRIORITY = {
  strong: priorityOf(GAIT_RULES[0]?.priority, "likely at moderate or high confidence"),
  middle: priorityOf(GAIT_RULES[1]?.priority, "likely at low or possible at moderate or high confidence"),
  weak: priorityOf(GAIT_RULES[2]?.priority, "possible at low confidence"),
};

/** The targets of the walk's shown patterns, with the stable pain path's muscles of an antalgic walk. */
function gaitTargets(
  p: GaitPatternResult,
  rom: readonly RomFinding[],
  out: Draft[],
  referrals: ReferralId[],
): void {
  if (!gaitPatternShown(p)) return;
  const strong = p.status === "likely" && p.confidence !== "low";
  const weak = p.status === "possible" && p.confidence === "low";
  const priority = strong ? STATUS_PRIORITY.strong : weak ? STATUS_PRIORITY.weak : STATUS_PRIORITY.middle;
  const reason: TargetReason = {
    kind: "gait",
    pattern: p.pattern,
    label: p.label,
    side: p.side,
    status: p.status,
    confidence: p.confidence,
  };
  const painRange = PAIN_FRIENDLY_GAIT_RANGE.includes(`${p.pattern}:${p.label}`);
  // «possible, confidence low: the first non refer target only» (refer targets are the referrals).
  const targets = weak ? p.targets.slice(0, 1) : p.targets;
  for (const t of targets)
    out.push({
      id: t.id,
      side: t.side,
      priority,
      painFriendlyOnly: painRange && actionOf(t.id) === "mobility",
      reasons: [reason],
    });
  if (!weak) for (const r of p.referrals) referrals.push(`refer:${r.replace(/^refer_/, "")}`);
  if (p.label !== "antalgic") return;
  // The muscles around a painful joint whose pain is stable (5.5).
  const sides = p.side === "both" ? ["left", "right"] : [p.side];
  const regions = new Set(
    p.targets.filter((t) => actionOf(t.id) === "mobility").map((t) => regionOfTarget(t.id)),
  );
  for (const region of regions) {
    const muscles = region ? painfulJointMuscles(region) : undefined;
    if (!muscles || !region) continue;
    for (const side of sides) {
      const stable = rom.some((f) => f.region === region && f.side === side && f.path === "pain_stable");
      if (!stable) continue;
      for (const id of muscles)
        out.push({ id, side: side as "left" | "right", priority, painFriendlyOnly: true, reasons: [reason] });
    }
  }
}

/**
 * The priority of a support finding's targets (D-029 item 1, E2-4; the data's gaitStatusRules give
 * support findings none, since they have no confidence): 2 when likely and for a finding with one rule
 * (no status), 1 when possible.
 */
export const SUPPORT_PRIORITY = { likely: 2, single: 2, possible: 1 } as const;
const RESULT_SIDES: readonly TargetRequest["side"][] = ["left", "right", "both", "none"];

/**
 * The targets of the walk's support findings (exercise-targets 5.4, the gaitPatterns rows
 * «<id> (finding)»): slow_speed practice:walking, uneven_step_length practice:even_steps. The row's
 * «when» of slow_speed («moderate to high intensity») is the walking practice's intensity, which its
 * dose profile sets, so it gates nothing. A finding without a row (flat_or_forefoot_contact) gives none.
 */
function supportTargets(f: GaitSupportFinding, out: Draft[]): void {
  const row = MAPPING.gaitPatterns.find((r) => r.pattern === f.id && r.label === `${f.id} (finding)`);
  if (!row) return;
  const side = row.side as TargetRequest["side"];
  if (!RESULT_SIDES.includes(side)) throw new Error(`The targets data gives ${f.id} the side ${row.side}`);
  const priority =
    f.status === "possible"
      ? SUPPORT_PRIORITY.possible
      : f.status === "likely"
        ? SUPPORT_PRIORITY.likely
        : SUPPORT_PRIORITY.single;
  const reason: TargetReason = { kind: "gait_finding", id: f.id, side: f.side, status: f.status };
  for (const t of row.targets)
    out.push({ id: t.id as TargetId, side, priority, painFriendlyOnly: false, reasons: [reason] });
}

/** The limbs and sides a limb loss took a region from (rom-protocol 2.4 Present). */
function absentRegions(h: Intake): Set<string> {
  const out = new Set<string>();
  for (const e of h.regions ?? []) {
    if (!e.problems.includes("limb_loss") || !e.limbLoss) continue;
    const limb = limbOf(e.region);
    if (!limb) continue;
    const present = LIMB_LOSS_PRESENT_REGIONS[e.limbLoss.level];
    const limbRegions: readonly RegionId[] =
      limb === "arm" ? ["shoulder", "elbow", "forearm_wrist"] : ["hip", "knee", "ankle_foot"];
    for (const side of e.side === "both" ? ["left", "right"] : [e.side])
      for (const r of limbRegions) if (!present.includes(r)) out.add(`${r}:${side}`);
  }
  return out;
}

const regionRows = (region: RegionId) => MAPPING.regionDefaultRule.rows.filter((r) => r.region === region);
const REGION_DEFAULT_PRIORITY = priorityOf(MAPPING.regionDefaultRule.priority, "the region default rule");
/** The wrist and hand row of each problem type: «weakness»; «stiffness, pain, injury, surgery». */
const WRIST_WEAKNESS = "weakness";
/** back_trunk: «With osteoporosis or a spine fracture: extension only» (the clinical source's note). */
const BACK_OSTEOPOROSIS_ONLY: TargetId = "mobility:trunk_extension";

/**
 * regionDefaultRule (5.6, review A01): «A body map region with a default only movement (never measured
 * by the camera) gets mobility targets for those movements at priority 1, for every problem type; pain
 * friendly items when the type is pain», each row's «when» read in code. A region a limb loss took has
 * none.
 */
function regionDefaultTargets(h: Intake, ids: ReadonlySet<string>, out: Draft[]): void {
  const absent = absentRegions(h);
  const pd = h.conditions.includes("parkinsons");
  const seen = new Set<RegionId>();
  const add = (region: RegionId, side: RegionSide, targets: readonly string[], pain: boolean) => {
    const targetSide: TargetRequest["side"] = side === "axial" ? "none" : side;
    for (const id of targets)
      out.push({
        id: id as TargetId,
        side: targetSide,
        priority: REGION_DEFAULT_PRIORITY,
        painFriendlyOnly: pain,
        reasons: [{ kind: "region_default", region, side }],
      });
  };
  const sidesGone = (e: RegionEntry) =>
    entryCells(e).every((cell) => absent.has(cell.replace(":axial", ":right")) && !cell.endsWith(":axial"));
  for (const e of h.regions ?? []) {
    if (sidesGone(e)) continue;
    const rows = regionRows(e.region);
    if (!rows.length) continue;
    const pain = e.problems.includes("pain");
    seen.add(e.region);
    switch (e.region) {
      case "forearm_wrist": {
        // «weakness» or «stiffness, pain, injury, surgery»; a limb loss alone has no row.
        const row = e.problems.includes(WRIST_WEAKNESS)
          ? rows.find((r) => r.when === WRIST_WEAKNESS)
          : e.problems.some((p) => p !== "limb_loss")
            ? rows.find((r) => r.when !== WRIST_WEAKNESS)
            : undefined;
        if (row) add(e.region, e.side, row.targets, pain);
        break;
      }
      case "hip":
        // «any problem type, not with hip precautions»
        if (![...ids].some((id) => id.startsWith("hip_precautions")))
          add(e.region, e.side, rows[0].targets, pain);
        break;
      case "neck":
        // «on the body map, or Parkinson's; not with neck_caution»
        if (!ids.has("neck_caution")) add(e.region, "axial", rows[0].targets, pain);
        break;
      case "back_trunk":
        add(e.region, "axial", backTargets(h, rows[0].targets), pain);
        break;
      default:
        // the shoulder: «any problem type»
        add(e.region, e.side, rows[0].targets, pain);
    }
  }
  // «on the body map, or Parkinson's»
  if (pd && !seen.has("neck") && !ids.has("neck_caution"))
    add("neck", "axial", regionRows("neck")[0].targets, false);
  if (pd && !seen.has("back_trunk"))
    add("back_trunk", "axial", backTargets(h, regionRows("back_trunk")[0].targets), false);
}

function backTargets(h: Intake, targets: readonly string[]): readonly string[] {
  return h.romFlags?.osteoporosis ? targets.filter((t) => t === BACK_OSTEOPOROSIS_ONLY) : targets;
}

/**
 * mobilityDefaultRule (5.6b, review C12): «A wheelchair user (mobility wheelchair) whose arms move on
 * their own gets a shoulder care block at priority 1 whatever the findings ... Not for a side with
 * upper limb loss, no active shoulder movement or a region filter on the shoulder (region_*)».
 */
function wheelchairBlock(
  h: Intake,
  rom: readonly RomFinding[],
  ids: ReadonlySet<string>,
  out: Draft[],
): void {
  const row = MAPPING.mobilityDefaultRule.rows.find((r) => r.mobility === h.mobility);
  if (!row) return;
  if (REGION_ID_KINDS.some((kind) => ids.has(regionId(kind, "shoulder")))) return;
  const lost = new Set(
    (h.regions ?? [])
      .filter((e) => e.problems.includes("limb_loss") && limbOf(e.region) === "arm")
      .flatMap((e) => (e.side === "both" ? ["left", "right"] : [e.side])),
  );
  const still = new Set(rom.filter((f) => f.region === "shoulder" && f.noActiveMovement).map((f) => f.side));
  const sides = (["right", "left"] as const).filter((s) => !lost.has(s) && !still.has(s));
  if (!sides.length) return;
  const side: TargetRequest["side"] = sides.length === 2 ? "both" : sides[0];
  for (const id of row.targets)
    out.push({
      id,
      side,
      priority: priorityOf(row.priority, "the wheelchair shoulder block"),
      painFriendlyOnly: false,
      reasons: [{ kind: "mobility_default", block: row.block }],
    });
}

/** The evidence of a target (TARGET_EVIDENCE). */
export function targetEvidence(id: TargetId, painFriendlyOnly: boolean): Evidence {
  const action = actionOf(id);
  return action === "mobility" && painFriendlyOnly ? PAIN_MOBILITY_EVIDENCE : TARGET_EVIDENCE[action];
}

const sameReason = (a: TargetReason, b: TargetReason) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 5.7: «The same target on the same side from a range finding and a gait pattern is one target; it keeps
 * the higher priority and both reasons». A target that any reason asks from the pain friendly set keeps
 * that limit (the safe side).
 */
function merge(drafts: readonly Draft[]): TargetRequest[] {
  const byKey = new Map<string, Draft>();
  for (const d of drafts) {
    const key = `${d.id}|${d.side}`;
    const had = byKey.get(key);
    if (!had) {
      byKey.set(key, { ...d, reasons: [...d.reasons] });
      continue;
    }
    had.priority = Math.max(had.priority, d.priority) as 1 | 2 | 3;
    had.painFriendlyOnly ||= d.painFriendlyOnly;
    for (const r of d.reasons) if (!had.reasons.some((x) => sameReason(x, r))) had.reasons.push(r);
  }
  const merged = [...byKey.values()].map((d): TargetRequest => ({
    ...d,
    evidence: targetEvidence(d.id, d.painFriendlyOnly),
  }));
  const order = new Map(merged.map((t, i) => [t, i]));
  return merged.sort(
    (a, b) =>
      b.priority - a.priority ||
      EVIDENCE_RANK.indexOf(a.evidence) - EVIDENCE_RANK.indexOf(b.evidence) ||
      order.get(a)! - order.get(b)!,
  );
}

/**
 * gradeRules, paths, romMovements, gaitPatterns, gaitStatusRules, regionDefaultRule, the wheelchair
 * shoulder block, the neck and arthritis add ons, merge (exercise-targets 5.8 steps 2 and 3). The
 * targets come sorted by priority, then by evidence; each referral once, in order.
 */
export function collectTargets(input: {
  intake: Intake;
  rom: readonly RomFinding[];
  gait: readonly GaitPatternResult[];
  /** The walk's support findings (5.4; D-029 item 1, E2-4). */
  support?: readonly GaitSupportFinding[];
  /** What the re-test rule removed: its strengthening stays at priority 1 (retestState; E2-5). */
  maintenance?: RetestState["maintenance"];
}): { targets: TargetRequest[]; referrals: ReferralId[] } {
  const h = input.intake;
  const drafts: Draft[] = [];
  const referrals: ReferralId[] = [];
  for (const f of input.rom) romTargets(f, h, drafts, referrals);
  for (const p of input.gait) gaitTargets(p, input.rom, drafts, referrals);
  for (const f of input.support ?? []) supportTargets(f, drafts);
  maintenanceTargets(h, input.rom, input.maintenance, drafts);
  const ids = v7Contraindications(h, null, null);
  regionDefaultTargets(h, ids, drafts);
  wheelchairBlock(h, input.rom, ids, drafts);
  return { targets: merge(drafts), referrals: [...new Set(referrals)] };
}

/* -------------------------------------------------------- the re-test rule */

/**
 * One completed check's results as the re-test rule reads them (exercise-targets 5.8 step 9; D-029
 * item 1, E2-5). The route reads them from the stored rows of each of the person's completed checks.
 */
export interface CheckResults {
  /** romFindings of the check, limited to the joints on the body map today (findingsOnMap). */
  rom: readonly RomFinding[];
  /** The check's range profile: a movement's new grade. */
  profile: RomProfile | null;
  /** The check's changes against the earlier checks (compareRom, as its findings page shows them). */
  changes: readonly RomChange[];
  /** Every result of the check's walk (shown, not seen, not assessed); null without a walk. */
  gait: readonly GaitPatternResult[] | null;
  /** The walk's support findings. */
  support: readonly GaitSupportFinding[];
  /** The views the walk recorded: a support finding is read on its own views only (gait-rules 5.12). */
  walkViews: readonly string[];
}

/**
 * What a check's program follows: its own results, the earlier ones the re-test rule keeps (after
 * them), and what the rule removed, whose strengthening stays at priority 1 as maintenance.
 */
export interface RetestState {
  rom: RomFinding[];
  gait: GaitPatternResult[];
  support: GaitSupportFinding[];
  maintenance: { rom: RomFinding[]; gait: GaitPatternResult[] };
}

const RETEST = MAPPING.selectionNumbers;
/** The same movement on the same side (a profile entry's movement id is the wider joint movement id). */
const sameMovement = (a: { movementId: string; side: string }, b: { movementId: string; side: string }) =>
  a.movementId === b.movementId && a.side === b.side;
const patternKey = (p: Pick<GaitPatternResult, "pattern" | "label" | "side">) =>
  `${p.pattern}|${p.label}|${p.side}`;
const supportKey = (f: Pick<GaitSupportFinding, "id" | "side">) => `${f.id}|${f.side}`;
/** The views each support finding is read on (gait-rules 5.12 findings[].views). */
const SUPPORT_VIEWS = new Map(GAIT_DATA.findings.map((f) => [f.id, f.views as readonly string[]]));

/**
 * Whether a check saw a kept pattern's side no more: its walk assessed the pattern there (a «not seen»
 * result, or the pattern shown on another side or label) and did not show it. A check without a walk,
 * or whose walk could not assess the pattern on that side, does not count.
 */
function patternNotSeen(kept: GaitPatternResult, c: CheckResults): boolean {
  const results = (c.gait ?? []).filter((r) => r.pattern === kept.pattern);
  if (results.some((r) => r.status === "not_assessed" && (r.side === kept.side || r.side === "none")))
    return false;
  return results.some((r) => r.status === "not_seen" || gaitPatternShown(r));
}

/**
 * The re-test rule (exercise-targets 5.8 step 9, sessionLines: «Re-test: a range target is removed only
 * when the change rule of rom-protocol 5.3 is met (beyond the MDC band) and the new grade is within
 * normal (review B15); a gait target when not seen at two checks; strengthening stays at priority 1 as
 * maintenance»), folded over the person's completed checks, oldest first and the check the program is
 * built from last, so each check passes on what its own program followed:
 *   - a range finding measured again and still limited follows the new finding; one measured within
 *     normal with a change «better» (compareRom: beyond the band, best and median) is removed, and its
 *     strengthening stays at priority 1 as maintenance until the movement is limited again; any other
 *     (within normal without that change, or not measured again) is kept as it was;
 *   - a pattern of the walk is kept until it is not seen at gaitTargetNotSeenChecks checks in a row that
 *     assessed it, then removed with its strengthening kept as maintenance; a support finding likewise,
 *     on its own views (it has no strengthening).
 */
export function retestState(history: readonly CheckResults[]): RetestState {
  let rom: RomFinding[] = [];
  let maintenanceRom: RomFinding[] = [];
  let gait: { result: GaitPatternResult; notSeen: number }[] = [];
  let maintenanceGait: GaitPatternResult[] = [];
  let support: { finding: GaitSupportFinding; notSeen: number }[] = [];
  for (const c of history) {
    const limited = (f: Pick<RomFinding, "movementId" | "side">) => c.rom.some((x) => sameMovement(x, f));
    const nextRom: RomFinding[] = [...c.rom];
    const nextMaintenanceRom = maintenanceRom.filter((f) => !limited(f));
    for (const f of rom) {
      if (limited(f)) continue;
      const grade = c.profile?.entries.find((e) => sameMovement(e, f) && e.source === "measured")?.finding;
      const better = c.changes.some((x) => sameMovement(x, f) && x.direction === "better");
      if (grade === "within" && better) nextMaintenanceRom.push(f);
      else nextRom.push(f);
    }

    const shown = (c.gait ?? []).filter(gaitPatternShown);
    const seen = (p: GaitPatternResult) => shown.some((s) => patternKey(s) === patternKey(p));
    const nextGait = shown.map((result) => ({ result, notSeen: 0 }));
    const nextMaintenanceGait = maintenanceGait.filter((p) => !seen(p));
    for (const k of gait) {
      if (seen(k.result)) continue;
      const notSeen = k.notSeen + (patternNotSeen(k.result, c) ? 1 : 0);
      if (notSeen >= RETEST.gaitTargetNotSeenChecks) nextMaintenanceGait.push(k.result);
      else nextGait.push({ result: k.result, notSeen });
    }

    const nextSupport = c.support.map((finding) => ({ finding, notSeen: 0 }));
    for (const k of support) {
      if (c.support.some((f) => supportKey(f) === supportKey(k.finding))) continue;
      const views = SUPPORT_VIEWS.get(k.finding.id) ?? [];
      const notSeen = k.notSeen + (c.walkViews.some((v) => views.includes(v)) ? 1 : 0);
      if (notSeen < RETEST.gaitTargetNotSeenChecks) nextSupport.push({ finding: k.finding, notSeen });
    }

    [rom, maintenanceRom, gait, maintenanceGait, support] = [
      nextRom,
      nextMaintenanceRom,
      nextGait,
      nextMaintenanceGait,
      nextSupport,
    ];
  }
  return {
    rom,
    gait: gait.map((k) => k.result),
    support: support.map((k) => k.finding),
    maintenance: { rom: maintenanceRom, gait: maintenanceGait },
  };
}

/**
 * «strengthening stays at priority 1 as maintenance» (strengthenStaysAtPriority): of a removed range
 * finding or pattern, only the strengthening targets, at that priority, with the result's own reason.
 */
function maintenanceTargets(
  h: Intake,
  rom: readonly RomFinding[],
  maintenance: RetestState["maintenance"] | undefined,
  out: Draft[],
): void {
  if (!maintenance) return;
  const priority = priorityOf(RETEST.strengthenStaysAtPriority, "strengthenStaysAtPriority");
  const all: Draft[] = [];
  for (const f of maintenance.rom) romTargets(f, h, all, []);
  for (const p of maintenance.gait) gaitTargets(p, rom, all, []);
  for (const d of all) if (actionOf(d.id) === "strengthen") out.push({ ...d, priority });
}

/* ------------------------------------------------------------- why lines */

const WHY = new Map(TARGETS_DATA.whyLines.map((w) => [w.id, w]));
function why(id: WhyLineId): L {
  const w = WHY.get(id);
  if (!w) throw new Error(`The targets data has no why line ${id}`);
  return { ar: w.ar, en: w.en };
}
const fill = (text: string, vars: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (all, key: string) => vars[key] ?? all);
/** A name or a line inside an English sentence: its first letter in lower case. */
const inSentence = (en: string) => en.charAt(0).toLowerCase() + en.slice(1);

/** A reason's whole line, and for a result (a range finding or a pattern) its clause for why_both. */
interface ReasonLine {
  line: L;
  clause: L | null;
}

/**
 * The clause of a range finding's line: the words between «لأن» / "Because" and the template's last
 * comma, after which it says what was added («، أضفنا هذا التمرين.» / ", we added this exercise.").
 */
function clauseOf(line: L): L {
  const cut = (text: string, lead: RegExp, comma: string) => {
    const body = text.replace(lead, "");
    const at = body.lastIndexOf(comma);
    return (at > 0 ? body.slice(0, at) : body).trim();
  };
  return { ar: cut(line.ar, /^لأن\s+/, "، "), en: cut(line.en, /^Because\s+/, ", ") };
}

function regionLine(): ReasonLine {
  return { line: why("why_region"), clause: null };
}

/**
 * A range finding's line: why_rom_pain on the pain paths, why_rom_limited with the side (a limb, or the
 * direction of a side bend), why_rom_limited_axial without one. A joint the camera could not grade (a
 * residual joint after limb loss, the seated knee lack) is told as why_region, as its finding says
 * refer_measure; a shoulder that could not move on its own (its self assisted slides) as limited.
 */
function romLine(r: Extract<TargetReason, { kind: "rom" }>): ReasonLine {
  const def = movementDef(r.movementId);
  if (r.finding === "no_grade" || (r.finding === "unknown" && def.region !== "shoulder")) return regionLine();
  const pain = r.finding !== "unknown" && (r.finding === "pain_limited" || PAIN_PATHS.includes(r.path));
  const vars = {
    movement_ar: def.name.ar,
    movement_en: inSentence(def.name.en),
    sideF: r.side === "none" ? "" : ROM_DATA.sideWords.sideF[r.side],
    side: r.side === "none" ? "" : ROM_DATA.sideWords.side[r.side],
  };
  const id: WhyLineId = pain
    ? "why_rom_pain"
    : r.side === "none"
      ? "why_rom_limited_axial"
      : "why_rom_limited";
  const t = why(id);
  const line = { ar: fill(t.ar, vars), en: fill(t.en, vars) };
  return { line, clause: clauseOf(line) };
}
const PAIN_PATHS: readonly CausePath[] = ["pain_irritable", "pain_stable"];

/** A pattern's line: why_gait with the pattern's own line on its side, as the walk's card shows it (C3). */
function gaitLine(r: Extract<TargetReason, { kind: "gait" }>): ReasonLine {
  // gaitPatternLines adds «we will check this again» to a possible pattern at low confidence; the why
  // line closes with its own words instead.
  const confidence = r.status === "possible" && r.confidence === "low" ? "moderate" : r.confidence;
  const pattern = gaitPatternLines({
    pattern: r.pattern,
    label: r.label,
    side: r.side,
    status: r.status,
    confidence,
    evidence: [],
    contributors: [],
    targets: [],
    referrals: [],
  }).pattern;
  const t = why("why_gait");
  const line = {
    ar: fill(t.ar, { gait_pattern_line_ar: pattern.ar }),
    en: fill(t.en, { gait_pattern_line_en: pattern.en }),
  };
  return {
    line,
    clause: { ar: pattern.ar.replace(/\.\s*$/, ""), en: inSentence(pattern.en.replace(/\.\s*$/, "")) },
  };
}

/** The gait copy's line of a support finding (copy.metrics), keyed by its id. */
const FINDING_LINES: Readonly<Partial<Record<GaitSupportFinding["id"], L>>> = {
  slow_speed: GAIT_DATA.copy.metrics.slow_speed,
  uneven_step_length: GAIT_DATA.copy.metrics.uneven_step_length,
};

/**
 * A support finding's line (D-029 item 1, E2-4): why_gait with the finding's own line from the gait
 * copy, on its side («خطوة ساقك {side_ar} ...»), as the walk's card words it.
 */
function findingLine(r: Extract<TargetReason, { kind: "gait_finding" }>): ReasonLine {
  const own = needed(FINDING_LINES[r.id], `the gait copy line of ${r.id}`);
  const i = r.side === "left" ? 1 : 0;
  const words = GAIT_DATA.copy.placeholders;
  const finding = {
    ar: own.ar.replaceAll("{side_ar}", words.side_ar[i]),
    en: own.en.replaceAll("{side_en}", words.side_en[i]),
  };
  const t = why("why_gait");
  return {
    line: {
      ar: fill(t.ar, { gait_pattern_line_ar: finding.ar }),
      en: fill(t.en, { gait_pattern_line_en: finding.en }),
    },
    clause: { ar: finding.ar.replace(/\.\s*$/, ""), en: inSentence(finding.en.replace(/\.\s*$/, "")) },
  };
}

function reasonLine(r: TargetReason): ReasonLine | null {
  switch (r.kind) {
    case "rom":
      return romLine(r);
    case "gait":
      return gaitLine(r);
    case "gait_finding":
      return findingLine(r);
    case "region_default":
      return regionLine();
    case "mobility_default":
      return { line: why("why_wheelchair_shoulder"), clause: null };
    case "arthritis":
      // The add on travels with its range finding's reason, which says why.
      return null;
  }
}

/**
 * The why line of an exercise (5.9 whyLines, rules before AI), Arabic first: the line of its first
 * reason; when it serves two results or more (range findings or patterns), why_both with the first two
 * («يدعم هذا التمرين نتيجتين: ...»). One line per exercise.
 */
export function whyLine(reasons: readonly TargetReason[]): L {
  const lines: ReasonLine[] = [];
  for (const r of reasons) {
    const l = reasonLine(r);
    if (l && !lines.some((x) => x.line.en === l.line.en)) lines.push(l);
  }
  if (!lines.length) return { ar: "", en: "" };
  const results = lines.filter((l) => l.clause !== null);
  if (results.length < 2) return lines[0].line;
  const both = why("why_both");
  const [a, b] = [results[0].clause!, results[1].clause!];
  return {
    ar: fill(both.ar, { reason1_ar: a.ar, reason2_ar: b.ar }),
    en: fill(both.en, { reason1_en: a.en, reason2_en: b.en }),
  };
}

/* ----------------------------------------------------------- selection */

/**
 * What a focus check tells the selection beyond the intake (D-026 item 9: E2 reads the stored answers it
 * needs): the range profile and the gait plan (v7Contraindications' profile and gait ids: a weak
 * shoulder, a joint the person cannot move, a red flag region, the knee past straight, the walk and pad
 * eligibility, the prosthesis off), the kept day answers (pusher, armrests, the seated lean answers, the
 * back pain of the day, the prosthesis) and the walk's patterns (recurvatum). Without a field nothing is
 * assumed, except the prosthesis (below).
 */
export interface TargetContext {
  profile?: RomProfile | null;
  gaitPlan?: GaitPlan | null;
  today?: StoredFocusToday | null;
  gait?: readonly GaitPatternResult[];
  /** The walk's support findings, which give targets of their own (targetedBuild; D-029 item 1, E2-4). */
  support?: readonly GaitSupportFinding[];
  /** What the re-test rule removed, whose strengthening stays (targetedBuild; D-029 item 1, E2-5). */
  maintenance?: RetestState["maintenance"];
}

/** A session's guided card slots (weekly.ts BLOCK_SIZES): «half of a session's exercise slots» counts them. */
export const SESSION_SLOTS = BLOCK_SIZES.warmup + BLOCK_SIZES.extra + BLOCK_SIZES.cooldown;
const NUMBERS = MAPPING.selectionNumbers;
/**
 * «finding items fill at most half of a session's exercise slots (findingSlotsShareMax, rounded down);
 * the rest follows the goal or sport as today»: a session's exercises are its guided cards and the
 * plan's camera movements, which stay the goal's, so the finding items take at most half of them, and
 * never more than the cards.
 */
export function findingSlots(plan: Pick<Plan, "exercises">): number {
  if (NUMBERS.findingSlotsRounding !== "down")
    throw new Error("The targets data rounds the slots another way");
  return Math.min(
    SESSION_SLOTS,
    Math.floor((SESSION_SLOTS + plan.exercises.length) * NUMBERS.findingSlotsShareMax),
  );
}

/** The seated forms of an item (on a chair, or near its front) and its standing forms. */
const SEATED_FORMS: readonly ExercisePosition[] = ["seated", "seated_forward"];
const STANDING_FORMS: readonly ExercisePosition[] = ["standing", "standing_supported"];
/**
 * 5.8 step 4: «standing: a standing item for lower limb weight bearing targets and the seated item
 * otherwise»: the taxonomy's standing only and standing relevant targets.
 */
const WEIGHT_BEARING: ReadonlySet<string> = new Set([
  ...TARGETS_DATA.taxonomy.standingOnlyTargets,
  ...TARGETS_DATA.taxonomy.standingRelevantTargets,
]);
/**
 * paths pain_stable: «isometrics marked pain friendly first (quad_set, glute_squeeze,
 * shoulder_wall_press, towel_squeeze), then dynamic work in the comfortable arc».
 */
export const PAIN_STABLE_ISOMETRICS: readonly string[] = [
  "quad_set",
  "glute_squeeze",
  "shoulder_wall_press",
  "towel_squeeze",
];

/** The person stands for the program: mobility standing, without the standing restrictions. */
const stands = (h: Intake) =>
  h.mobility === "standing" &&
  !h.restrictions.includes("balance_support") &&
  !h.restrictions.includes("no_weight_bearing");

/**
 * The ids the check adds to the intake's (v7Contraindications with the profile and the gait plan), with
 * the kept day answers E1-5 left to E2: «pc_stroke_push yes» (pusher), «pc_trunk_armrests no»
 * (no_trunk_armrests), seated_lean_gate's «pc_sit_unsupported no or not sure, pc_fall_sitting yes ...
 * back pain 6 or more, pc_pressure_sore yes», standing_gate's «lower limb loss without the prosthesis»
 * (the day's answer; a check without a gait plan or an answer reads it as without, E1-5) and
 * knee_hyperextension's «Gait recurvatum possible or likely». The helper that seated_lean_gate asks for
 * people living with SCI, stroke, CP, Parkinson's or MS is the item's own caution line
 * (seated_side_reach), shown with it, so it closes nothing here.
 */
export function programContraindications(h: Intake, ctx: TargetContext = {}): Set<string> {
  const ids = v7Contraindications(h, ctx.profile ?? null, ctx.gaitPlan ?? null);
  const today = ctx.today;
  if (today?.pusher === true) ids.add("pusher");
  if (today?.armrests === false) ids.add("no_trunk_armrests");
  const lean = today?.seatedLean;
  if (
    lean?.fellSitting === true ||
    lean?.pressureSore === true ||
    lean?.sitsUnsupported === "no" ||
    lean?.sitsUnsupported === "unsure" ||
    (today?.painByRegion.back_trunk ?? 0) >= SEATED_LEAN_BACK_PAIN_AT
  )
    ids.add("seated_lean_gate");
  if (
    hasLowerLimbLoss(h) &&
    (today?.prosthesisOn === false || (today?.prosthesisOn === undefined && !ctx.gaitPlan))
  )
    ids.add("standing_gate");
  if (
    (ctx.gait ?? []).some(
      (p) => p.pattern === "recurvatum" && (p.status === "possible" || p.status === "likely"),
    )
  )
    ids.add("knee_hyperextension");
  return ids;
}

/** An item the program may offer, in the forms it may be done in. */
interface Candidate {
  e: LibraryExercise;
  positions: ExercisePosition[];
}

/**
 * The pool's items the check allows, in their open forms (exercise-targets 5.8 steps 1 and 4): every id
 * that holds closes the item or its forms (openPositions with the signed off ids, D-026 item 9), the
 * region ids close by the regions it works (regionOpenPositions, «Region filters run last»), a wheelchair
 * user's items are wheelchair friendly unless the transfer is yes, and a person who does not stand does
 * an item in its seated form only (C11, C14). A camera movement of the plan keeps the camera (E1-7).
 */
function candidatesOf(
  h: Intake,
  plan: Pick<Plan, "exercises">,
  pool: readonly LibraryExercise[],
  ids: ReadonlySet<string>,
): Candidate[] {
  const camera = cameraTwins(plan);
  const out: Candidate[] = [];
  for (const e of pool) {
    if (camera.has(e.id)) continue;
    if (
      h.mobility === "wheelchair" &&
      !e.tags.includes("wheelchair_friendly") &&
      h.romFlags?.transferChair !== true
    )
      continue;
    const contraindications = [...e.contraindications, ...(e.v7Contraindications ?? [])];
    const open = openPositions({ positions: e.positions, contraindications }, ids);
    if (!open) continue;
    const region = regionOpenPositions({ ...e, positions: open.length ? open : e.positions }, ids);
    if (!region) continue;
    let positions = region.length ? region : [...(e.positions ?? [])];
    if (!stands(h)) positions = positions.filter((p) => SEATED_FORMS.includes(p));
    if (!positions.length) continue;
    out.push({ e, positions });
  }
  return out;
}

/** The finding of a target's reason, for «at most 2 items per limited movement or pattern». */
function findingKeys(t: TargetRequest): string[] {
  const keys = new Set<string>();
  // The arthritis add on («always add strengthening of the muscles around the joint») is counted on its
  // own, so it never takes the items of the movement it is added to (a painful knee keeps its range work).
  const addOn = t.reasons[0]?.kind === "arthritis";
  for (const r of t.reasons)
    if (r.kind === "arthritis") keys.add(`arthritis:${r.region}`);
    else if (r.kind === "rom" && !addOn) keys.add(`rom:${r.movementId}:${r.side}`);
    else if (r.kind === "gait") keys.add(`gait:${r.pattern}:${r.label}:${r.side}`);
    else if (r.kind === "gait_finding") keys.add(`gait_finding:${r.id}:${r.side}`);
  return keys.size ? [...keys] : [`target:${t.id}:${t.side}`];
}

/**
 * gradeRules perAction: «markedlyLimited 2», «painLimited 2», «mildlyLimited 1», «provisional (1 valid
 * attempt) 1», the region default and residual rows 1. A provisional marked result is one priority lower
 * (B4's findingPriority), so a target at priority 3 from a marked or pain limited result takes 2.
 */
const PER_ACTION_TWO: ReadonlySet<string> = new Set(
  [gradeRule("markedlyLimited"), gradeRule("painLimited")].map((r) => {
    if (r.perAction !== 2)
      throw new Error(`The targets data gives ${r.finding} ${String(r.perAction)} items`);
    return r.finding === "markedlyLimited" ? "marked" : "pain_limited";
  }),
);
const perAction = (t: TargetRequest) =>
  t.priority === 3 && t.reasons.some((r) => r.kind === "rom" && PER_ACTION_TWO.has(r.finding)) ? 2 : 1;

/** A target only the self assisted shoulder items may fill: a shoulder movement the person could not move. */
const selfAssisted = (t: TargetRequest) =>
  t.reasons.some(
    (r) => r.kind === "rom" && r.finding === "unknown" && movementDef(r.movementId).region === "shoulder",
  );

/** An item may serve a target: it names the target, from the pain friendly set when asked, self assisted when asked. */
function serves(c: Candidate, t: TargetRequest): boolean {
  if (!(c.e.targets ?? []).some((x) => x.id === t.id)) return false;
  if (t.painFriendlyOnly && c.e.painFriendly !== true) return false;
  if (selfAssisted(t) && !SELF_ASSISTED_SHOULDER.includes(c.e.id)) return false;
  return true;
}

/** The order of an item for a target (5.8 step 4), lower first. */
function rank(
  c: Candidate,
  t: TargetRequest,
  h: Intake,
  all: readonly TargetRequest[],
  index: number,
): number[] {
  const role = c.e.targets!.find((x) => x.id === t.id)!.role === "primary" ? 0 : 1;
  const isometric =
    t.painFriendlyOnly && actionOf(t.id) === "strengthen" && PAIN_STABLE_ISOMETRICS.includes(c.e.id) ? 0 : 1;
  const standingForm = c.positions.some((p) => STANDING_FORMS.includes(p));
  const seatedForm = c.positions.some((p) => SEATED_FORMS.includes(p));
  const fit = stands(h) && WEIGHT_BEARING.has(t.id) ? (standingForm ? 0 : 1) : seatedForm ? 0 : 1;
  const others = all.filter((x) => x !== t && serves(c, x)).length;
  return [role, isometric, fit, -others, index];
}
const before = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

/** An item the selection chose, the targets it serves (the first is the one it was chosen for). */
interface Chosen {
  c: Candidate;
  targets: TargetRequest[];
  /** The round it was chosen in: a target's first item (1), or the second a grade asks for (2). */
  round: 1 | 2;
}

/** The session block of an item (2.2 session order): range first, then strength, balance and practice, held stretches last. */
const BLOCK_OF: Record<TargetAction, "warmup" | "extra" | "cooldown"> = {
  mobility: "warmup",
  strengthen: "extra",
  balance: "extra",
  practice: "extra",
  stretch: "cooldown",
};
/** Within the day's exercises: strengthening before balance and task practice (2.2). */
const EXTRA_ORDER: Record<TargetAction, number> = {
  mobility: 0,
  strengthen: 1,
  balance: 2,
  practice: 2,
  stretch: 3,
};

/* ------------------------------------------------------------------ dose */

/** The profile of an action for an item that names none (the library's existing entries). */
const ACTION_PROFILE: Record<TargetAction, DoseProfileId> = {
  mobility: "mobility_reps",
  stretch: "stretch_hold",
  strengthen: "strength_reps",
  balance: "balance_practice",
  practice: "walking_practice",
};

/** A target on the pain path: its items come from the pain friendly set for pain (not only early after surgery). */
const painPath = (t: TargetRequest) =>
  t.painFriendlyOnly && !t.reasons.every((r) => r.kind === "rom" && r.path === "post_op_early");

/**
 * The dose profile of an item (5.8 step 8: «Dose comes from the profile of the item»): its pain profile
 * on the pain path, its stretch profile when it was chosen for a stretch, else its profile; an existing
 * entry, which names none, takes its action's (the pain path's range is mobility_pain).
 */
function profileOf(p: Chosen): DoseProfileId {
  const main = p.targets[0];
  const action = actionOf(main.id);
  const pain = p.targets.some(painPath);
  const d = p.c.e.dose;
  if (d) {
    if (pain && d.painProfile) return d.painProfile;
    if (action === "stretch" && d.stretchProfile) return d.stretchProfile;
    return d.profile;
  }
  return pain && action === "mobility" ? "mobility_pain" : ACTION_PROFILE[action];
}

const olderThan = (h: Intake) => h.age >= needed(TARGETS_DATA.placeholders.olderFromAge, "olderFromAge");
const atAge = (
  h: Intake,
  v: number | { under65: number; age65plus: number } | string | undefined,
  what: string,
) => {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") return olderThan(h) ? v.age65plus : v.under65;
  throw new Error(`The dose data writes ${what} in words only`);
};
const first = (v: number[] | undefined, what: string) => needed(v?.[0], what);

/**
 * A profile's numbers as a card (2.1, the start of each range: «start light and build»): a held stretch
 * by age (30 seconds twice under 65, 60 seconds once from 65); 10 range repetitions in 1 round; 5 to 10
 * gentle ones on the pain path (5); strength 10 to 15 in 1 set to start (10); isometric holds of 5 seconds
 * 10 times; balance holds up to 10 seconds, 10 to 15 times (10); walking 10 minutes to start; cued walking
 * in its default bouts. Then «the existing plan notes (fatigue, heat) lower it where they apply»: the
 * fatigue note lowers sets and repetitions by the condition's rules (legacy adjustSets, adjustReps), as
 * the plan's camera dose is lowered.
 */
function doseOf(
  profile: DoseProfileId,
  h: Intake,
  plan: Plan,
): { sets: number; reps?: number; holdSeconds?: number } {
  const n = doseProfile(profile).numbers;
  let dose: { sets: number; reps?: number; holdSeconds?: number };
  switch (profile) {
    case "stretch_hold":
      dose = {
        sets: atAge(h, n.repetitions, "repetitions"),
        holdSeconds: atAge(h, n.holdSeconds, "holdSeconds"),
      };
      break;
    case "mobility_reps":
      dose = {
        sets: first(n.roundsRange, "mobility_reps rounds"),
        reps: atAge(h, n.repetitions, "repetitions"),
      };
      break;
    case "mobility_pain":
      dose = {
        sets: atAge(h, n.rounds as number, "rounds"),
        reps: first(n.repetitionsRange, "mobility_pain repetitions"),
      };
      break;
    case "strength_reps": {
      const sets = n.sets;
      if (!sets || typeof sets !== "object")
        throw new Error("The dose data writes strength_reps sets in words only");
      dose = { sets: sets.start, reps: first(n.repetitionsRange, "strength_reps repetitions") };
      break;
    }
    case "strength_isometric":
      dose = {
        sets: atAge(h, n.repetitions, "repetitions"),
        holdSeconds: atAge(h, n.holdSeconds, "holdSeconds"),
      };
      break;
    case "balance_practice":
      dose = {
        sets: first(n.repetitionsRange, "balance repetitions"),
        holdSeconds: needed(n.holdSecondsMax, "holdSecondsMax"),
      };
      break;
    case "walking_practice":
      dose = { sets: 1, holdSeconds: needed(n.startMinutes, "startMinutes") * 60 };
      break;
    case "cue_walking": {
      const bouts = needed(n.defaultBouts, "defaultBouts");
      dose = { sets: bouts.bouts, holdSeconds: bouts.minutes * 60 };
      break;
    }
  }
  if (plan.notes.includes("fatigue")) {
    const configs = configsFor(h);
    if (configs.length) {
      dose.sets = Math.min(dose.sets, ...configs.map((c) => adjustSets(dose.sets, c)));
      if (dose.reps !== undefined)
        dose.reps = Math.min(dose.reps, ...configs.map((c) => adjustReps(dose.reps!, c)));
    }
  }
  return dose;
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const arDigits = (n: number) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);
/** Seconds counted in Arabic: «ثانية واحدة», «ثانيتين», «٣ ثوانٍ» to 10, then «١١ ثانية». */
function arSeconds(n: number): string {
  if (n === 1) return "ثانية واحدة";
  if (n === 2) return "ثانيتين";
  return n <= 10 ? `${arDigits(n)} ثوانٍ` : `${arDigits(n)} ثانية`;
}

/**
 * The hold of the steps' {hold_ar} and {hold_en} (TARGETS_DATA.placeholders, E1-8): «The hold time with
 * its correct Arabic counted noun, from the item's dose profile and the person's age: «30 ثانية»
 * (stretch_hold, under 65), «60 ثانية» (65 and over), «لحظة» on the pain path», 'a moment' in English.
 */
function holdOf(p: Chosen, profile: DoseProfileId, h: Intake): L | undefined {
  const named =
    p.c.e.steps.ar.some((s) => s.includes("{hold_ar}")) ||
    p.c.e.steps.en.some((s) => s.includes("{hold_en}"));
  if (!named) return undefined;
  if (profile === "mobility_pain") return { ar: PAIN_HOLD.ar, en: PAIN_HOLD.en };
  const seconds = atAge(h, TARGETS_DATA.placeholders.holdSeconds, "the hold");
  return { ar: arSeconds(seconds), en: `${seconds} seconds` };
}
/** placeholders.hold_ar: «لحظة» on the pain path; hold_en: 'a moment'. */
export const PAIN_HOLD: L = { ar: "لحظة", en: "a moment" };

/* --------------------------------------------------------------- select */

/**
 * selection rules (exercise-targets 5.8): the eligible pool with the check's contraindications, position
 * fit, pain friendly items on the pain paths, the caps (2 items per finding, at most half the slots of a
 * session), session order, dose profiles. The pool is programPool(h) (pool.ts): libraryPool's rules with
 * the new exercises and the seated forms (D-023 item 2). `selection` holds each day's finding items in
 * their blocks; the goal and sport share is targetedWeekly's.
 */
export function selectForTargets(
  h: Intake,
  plan: Plan,
  pool: readonly LibraryExercise[],
  targets: readonly TargetRequest[],
  ctx: TargetContext = {},
): { selection: Selection; items: TargetedItem[]; unmet: TargetRequest[] } {
  const candidates = candidatesOf(h, plan, pool, programContraindications(h, ctx));
  const order = new Map(candidates.map((c, i) => [c.e.id, i]));
  const picks: Chosen[] = [];
  const perFinding = new Map<string, number>();
  // Two rounds, so the cap of a finding is shared among its actions: each target takes its first item,
  // then a target whose grade asks for two items (perAction) takes its second while the cap allows.
  for (const round of [1, 2])
    for (const t of targets) {
      const keys = findingKeys(t);
      let have = 0;
      for (const p of picks)
        if (serves(p.c, t)) {
          if (!p.targets.includes(t)) p.targets.push(t);
          have++;
        }
      while (have < Math.min(round, perAction(t))) {
        if (keys.every((k) => (perFinding.get(k) ?? 0) >= NUMBERS.itemsPerFindingMax)) break;
        const best = candidates
          .filter((c) => !picks.some((p) => p.c === c) && serves(c, t))
          .sort((a, b) =>
            before(rank(a, t, h, targets, order.get(a.e.id)!), rank(b, t, h, targets, order.get(b.e.id)!)),
          )[0];
        if (!best) break;
        picks.push({ c: best, targets: [t], round: round as 1 | 2 });
        for (const k of keys) perFinding.set(k, (perFinding.get(k) ?? 0) + 1);
        have++;
      }
    }
  // «One exercise that covers several chosen targets fills one slot and carries every reason.»
  for (const p of picks)
    for (const t of targets) if (!p.targets.includes(t) && serves(p.c, t)) p.targets.push(t);

  const days = schedule(h, plan, picks);
  const scheduled = picks.filter((p) => days.some((d) => d.has(p)));
  const items = scheduled.map((p) => targetedItem(p, h, plan));
  const byId = new Map(items.map((i) => [i.exerciseId, i]));
  const selection: Selection = {
    days: days.map((d) => {
      const ids = [...d.keys()]
        .sort((a, b) => EXTRA_ORDER[actionOf(a.targets[0].id)] - EXTRA_ORDER[actionOf(b.targets[0].id)])
        .map((p) => ({ id: p.c.e.id, block: d.get(p)! }));
      return {
        warmup: ids.filter((x) => x.block === "warmup").map((x) => x.id),
        extra: ids.filter((x) => x.block === "extra").map((x) => x.id),
        cooldown: ids.filter((x) => x.block === "cooldown").map((x) => x.id),
      };
    }),
  };
  const unmet = targets.filter((t) => !scheduled.some((p) => p.targets.includes(t)));
  return { selection, items: [...byId.values()], unmet };
}

/**
 * The days a week an item's dose asks for (2.1 daysPerWeek), within the person's training days: strength
 * «2 to 3», isometric holds «2 to 3», balance «at least 2 to 3; 3 or more for older adults», held
 * stretches «daily when possible; at least 2 to 3», walking «3 to 5»: the first number of each. Range work
 * is «daily», which no number bounds, so it takes the least the others ask (2) and the week's spare
 * slots first.
 */
function daysWanted(profile: DoseProfileId, h: Intake, trainingDays: number): number {
  const n = doseProfile(profile).numbers;
  const older = olderThan(h) && n.olderAdultsDaysPerWeekAtLeast !== undefined;
  const least = older
    ? n.olderAdultsDaysPerWeekAtLeast!
    : (n.daysPerWeekRange?.[0] ?? n.daysPerWeekAtLeast?.[0] ?? LEAST_DAYS_A_WEEK);
  return Math.min(trainingDays, least);
}
/** The least number of days a week any dose profile names («2 to 3», «at least 2 to 3»). */
const LEAST_DAYS_A_WEEK = Math.min(
  ...TARGETS_DATA.dose.profiles.flatMap((p) => [
    ...(p.numbers.daysPerWeekRange ? [p.numbers.daysPerWeekRange[0]] : []),
    ...(p.numbers.daysPerWeekAtLeast ? [p.numbers.daysPerWeekAtLeast[0]] : []),
  ]),
);

type Block = "warmup" | "extra" | "cooldown";

/**
 * The finding items of each training day (5.8 steps 5 and 7, 2.1): at most findingSlots a session, and
 * each item on the days a week its dose asks for, so the week holds fewer exercises done often enough
 * rather than many done once; an item that no longer fits its days is left out, and its targets are
 * unmet. The order of the items, at each priority (the targets' own order: priority, then evidence):
 * the first item of each finding, so as many findings as fit are worked on; then each finding's other
 * items; then the second items a grade asks for. A strengthening item is never on two
 * days in a row («never the same muscles on 2 days in a row»); the days least full come first. Then range
 * work, «daily», and held stretches take the slots still free. Each block keeps its size (a third range
 * item opens the day's exercises; a third stretch waits for another day).
 */
function schedule(h: Intake, plan: Plan, picks: readonly Chosen[]): Map<Chosen, Block>[] {
  const most = findingSlots(plan);
  const out: Map<Chosen, Block>[] = plan.days.map(() => new Map());
  const used = plan.days.map(() => ({ warmup: 0, extra: 0, cooldown: 0 }));
  const action = (p: Chosen) => actionOf(p.targets[0].id);
  const priority = (p: Chosen) => Math.max(...p.targets.map((t) => t.priority));
  // Each finding's first item before its others and before the second items a grade asks for, at each
  // priority; a stable sort keeps the targets' own order (priority, then evidence) within.
  const first = new Set<Chosen>();
  const seen = new Set<string>();
  for (const p of picks) {
    const key = findingKeys(p.targets[0]).join("|");
    if (!seen.has(key) && p.round === 1) first.add(p);
    if (p.round === 1) seen.add(key);
  }
  const order = [...picks].sort(
    (a, b) => priority(b) - priority(a) || Number(first.has(b)) - Number(first.has(a)) || a.round - b.round,
  );
  /** The block an item takes on a day, or null when the day or its block is full. */
  const blockOn = (p: Chosen, d: number): Block | null => {
    if (out[d].size >= most || out[d].has(p)) return null;
    let block = BLOCK_OF[action(p)];
    if (block === "warmup" && used[d].warmup >= BLOCK_SIZES.warmup) block = "extra";
    return used[d][block] < BLOCK_SIZES[block] ? block : null;
  };
  /** Strengthening is not on the day before or after one it is on (Saturday and Sunday are neighbours). */
  const restful = (p: Chosen, d: number, chosen: readonly number[]) =>
    action(p) !== "strengthen" ||
    !chosen.some((c) => {
      const gap = Math.abs(plan.days[c] - plan.days[d]);
      return gap === 1 || gap === 6;
    });
  const place = (p: Chosen, d: number) => {
    const block = blockOn(p, d)!;
    out[d].set(p, block);
    used[d][block]++;
  };
  for (const p of order) {
    const want = daysWanted(profileOf(p), h, plan.days.length);
    const chosen: number[] = [];
    const days = plan.days.map((_, d) => d).sort((a, b) => out[a].size - out[b].size || a - b);
    for (const d of days) {
      if (chosen.length >= want) break;
      if (blockOn(p, d) && restful(p, d, chosen)) chosen.push(d);
    }
    if (chosen.length < want) continue;
    for (const d of chosen) place(p, d);
  }
  // «daily»: range work, then held stretches, take the slots still free.
  for (const kind of ["mobility", "stretch"] as const)
    for (const p of order) {
      if (action(p) !== kind || !out.some((day) => day.has(p))) continue;
      plan.days.forEach((_, d) => {
        if (blockOn(p, d)) place(p, d);
      });
    }
  return out;
}

/** A chosen item with its dose, why line, targets and reasons (TargetedItem, WeeklyItem v7 fields). */
function targetedItem(p: Chosen, h: Intake, plan: Plan): TargetedItem {
  const sorted = [...p.targets].sort((a, b) => b.priority - a.priority);
  const reasons: TargetReason[] = [];
  for (const t of sorted)
    for (const r of t.reasons) if (!reasons.some((x) => sameReason(x, r))) reasons.push(r);
  const ids = [...new Set(sorted.map((t) => t.id))];
  const why = whyLine(reasons);
  const profile = profileOf(p);
  const hold = holdOf(p, profile, h);
  const dose: WeeklyItem = {
    id: p.c.e.id,
    ...doseOf(profile, h, plan),
    targets: ids,
    why,
    reasonRefs: reasons,
    ...(hold ? { hold } : {}),
  };
  return {
    exerciseId: p.c.e.id,
    slot: BLOCK_OF[actionOf(p.targets[0].id)],
    targets: ids,
    reasons,
    why,
    dose,
  };
}

/* ----------------------------------------------------- the body map now */

/**
 * The range findings whose joint is still on the body map (contract 2.10: «afterIntakeSaved rebuilds the
 * targeted weekly from the latest completed focus check, first dropping the range findings whose region
 * and side are no longer on the body map (gait patterns are kept)»). A residual joint after limb loss
 * sits off the map by design (rom-protocol 2.4: «on or off the body map»), so it stays while a limb loss
 * of its limb and side does.
 */
export function findingsOnMap(rom: readonly RomFinding[], h: Intake): RomFinding[] {
  const regions = h.regions ?? [];
  const cells = new Set(regions.flatMap((e) => entryCells(e) as string[]));
  return rom.filter((f) => {
    const cell = isAxialRegion(f.region) ? `${f.region}:axial` : `${f.region}:${f.side}`;
    if (cells.has(cell)) return true;
    const limb = limbOf(f.region);
    return (
      f.finding === "unknown" &&
      !f.noActiveMovement &&
      limb !== null &&
      regions.some(
        (e) =>
          e.problems.includes("limb_loss") &&
          limbOf(e.region) === limb &&
          (e.side === f.side || e.side === "both"),
      )
    );
  });
}

/* ------------------------------------------------------------ the week */

/** A week the findings built (contract 2.10): what POST /api/program/targets stores and answers, and createWeekly words. */
export interface TargetedBuild {
  /** The rules' week, with its findings ref. */
  weekly: WeeklyPlan;
  /** Each day's finding items in their blocks: fixed for the weekly AI (sanitizeSelection). */
  fixed: Selection;
  /** The whole selection: each block's finding items, then the goal's or the sport's share. */
  selection: Selection;
  items: TargetedItem[];
  /** The share's pool, which the weekly AI may arrange from: the default pool, never a draft. */
  pool: LibraryExercise[];
  targets: TargetRequest[];
  referrals: ReferralId[];
  unmet: TargetRequest[];
}

/**
 * The weekly plan built from the findings (5.8): the finding items of selectForTargets in their blocks,
 * then «the rest follows the goal or sport as today»: the rules' own selection (defaultSelection: the
 * goal's categories or the sport's demands) from the default pool, with the check's contraindications
 * and the region ids applied last (review C01), fills each block to its size. Null exactly when
 * engineWeekly is null (plan not ready).
 */
export function targetedBuild(
  h: Intake,
  plan: Plan,
  rom: readonly RomFinding[],
  gait: readonly GaitPatternResult[],
  findingsRef: NonNullable<WeeklyPlan["findings"]>,
  ctx: TargetContext = {},
): TargetedBuild | null {
  if (!engineWeekly(h, plan)) return null;
  const context: TargetContext = { ...ctx, gait: ctx.gait ?? gait };
  const { targets, referrals } = collectTargets({
    intake: h,
    rom,
    gait,
    support: ctx.support ?? [],
    maintenance: ctx.maintenance,
  });
  const { selection: fixed, items, unmet } = selectForTargets(h, plan, programPool(h), targets, context);
  const { selection, pool } = goalShare(h, plan, fixed, items, context);
  const weekly = { ...buildWeekly(h, plan, selection, "engine", items), findings: findingsRef };
  return { weekly, fixed, selection, items, pool, targets, referrals, unmet };
}

/** The weekly plan built from the findings (targetedBuild's week). Null exactly when engineWeekly is null. */
export function targetedWeekly(
  h: Intake,
  plan: Plan,
  rom: readonly RomFinding[],
  gait: readonly GaitPatternResult[],
  findingsRef: NonNullable<WeeklyPlan["findings"]>,
  ctx: TargetContext = {},
): WeeklyPlan | null {
  return targetedBuild(h, plan, rom, gait, findingsRef, ctx)?.weekly ?? null;
}

/**
 * The goal and sport share (5.7: «Targets from the person's goal or sport ... keep their current share of
 * the session»): each block of a day keeps its finding items first and takes the rules' own selection
 * after them, up to the block's size. The share's items come from libraryPool(h), never a draft, minus
 * what the check closes and the finding items themselves.
 */
function goalShare(
  h: Intake,
  plan: Plan,
  fixed: Selection,
  items: readonly TargetedItem[],
  ctx: TargetContext,
): { selection: Selection; pool: LibraryExercise[] } {
  const chosen = new Set(items.map((i) => i.exerciseId));
  const pool = candidatesOf(h, plan, libraryPool(h), programContraindications(h, ctx))
    .map((c) => c.e)
    .filter((e) => !chosen.has(e.id));
  const base = defaultSelection(h, plan, pool);
  return { selection: withFixed(plan, base, fixed), pool };
}

/** Each block of each day: the fixed items first, then the other selection's, up to the block's size. */
export function withFixed(plan: Pick<Plan, "days">, other: Selection, fixed: Selection): Selection {
  return {
    days: plan.days.map((_, d) => {
      const f = fixed.days[d] ?? { warmup: [], extra: [], cooldown: [] };
      const b = other.days[d] ?? { warmup: [], extra: [], cooldown: [] };
      const fillTo = (mine: string[], theirs: string[], size: number) =>
        [...mine, ...theirs.filter((id) => !mine.includes(id))].slice(0, Math.max(size, mine.length));
      return {
        ...(b.focus ? { focus: b.focus } : {}),
        ...(b.notes ? { notes: b.notes } : {}),
        warmup: fillTo(f.warmup, b.warmup, BLOCK_SIZES.warmup),
        extra: fillTo(f.extra, b.extra, BLOCK_SIZES.extra),
        cooldown: fillTo(f.cooldown, b.cooldown, BLOCK_SIZES.cooldown),
      };
    }),
  };
}
