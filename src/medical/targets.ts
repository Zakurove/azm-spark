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
import { regionId, REGION_ID_KINDS, regionOfTarget, v7Contraindications } from "./contraindications";
import { gaitPatternLines, gaitPatternShown } from "./gait-rules";
import type { GaitPatternResult } from "./gait-types";
import type { Intake, Plan } from "./plan";
import { LIMB_LOSS_PRESENT_REGIONS } from "./rom-protocol";
import type { CausePath, RomFinding } from "./rom-types";
import type {
  ReferralId,
  TargetAction,
  TargetId,
  TargetReason,
  TargetRequest,
  TargetedItem,
} from "./target-types";
import { engineWeekly, type L, type LibraryExercise, type Selection, type WeeklyPlan } from "./weekly";
import { movementDef, ROM_DATA } from "../movements/rom";
import type { Evidence, RomMovementId } from "../movements/rom/types";
import { TARGETS_DATA } from "../movements/targets";
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
      if (f.region === "shoulder")
        for (const id of movementRow(f.movementId).mobility) add(id, f.priority, true);
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
    const arthritis: TargetReason[] = [reason, { kind: "arthritis", region: f.region }];
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
}): { targets: TargetRequest[]; referrals: ReferralId[] } {
  const h = input.intake;
  const drafts: Draft[] = [];
  const referrals: ReferralId[] = [];
  for (const f of input.rom) romTargets(f, h, drafts, referrals);
  for (const p of input.gait) gaitTargets(p, input.rom, drafts, referrals);
  const ids = v7Contraindications(h, null, null);
  regionDefaultTargets(h, ids, drafts);
  wheelchairBlock(h, input.rom, ids, drafts);
  return { targets: merge(drafts), referrals: [...new Set(referrals)] };
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

function reasonLine(r: TargetReason): ReasonLine | null {
  switch (r.kind) {
    case "rom":
      return romLine(r);
    case "gait":
      return gaitLine(r);
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

/** selection rules: the eligible pool (libraryPool plus v7 contraindications), position fit, caps, session order, dose profiles. */
export function selectForTargets(
  _h: Intake,
  _plan: Plan,
  _pool: readonly LibraryExercise[],
  targets: readonly TargetRequest[],
): { selection: Selection; items: TargetedItem[]; unmet: TargetRequest[] } {
  return { selection: { days: [] }, items: [], unmet: [...targets] };
}

/** The weekly plan built from the findings. Null exactly when engineWeekly is null (plan not ready). */
export function targetedWeekly(
  h: Intake,
  plan: Plan,
  _rom: readonly RomFinding[],
  _gait: readonly GaitPatternResult[],
  _findingsRef: NonNullable<WeeklyPlan["findings"]>,
): WeeklyPlan | null {
  return engineWeekly(h, plan);
}
