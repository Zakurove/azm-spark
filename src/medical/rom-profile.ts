/**
 * The range of motion profile and findings (product v7 contract 2.7, stream B, step B4). Pure, no DOM.
 * The server builds the profile from a check's stored rows (it grades nothing again: the stored grade
 * is the server's own, C-3) and returns it with the findings, the body map summary and the changes
 * against the first check (GET /api/focus/profile, POST /api/focus/:id/complete); the gait rules read
 * the profile too (2.9).
 *
 *   buildRomProfile  every joint movement and side: a stored row under its own source; the typical
 *                    default computed on read for a region that is not on the body map (C-4,
 *                    rom-protocol 4.3 rule 5); never typical inside one (review A01, D-025 ROM-Q15)
 *   romFindings      the limited, pain limited and unknown results, each with its cause path
 *                    (exercise-targets 5.1 causeResolution, first match wins), its priority (5.3) and
 *                    its line (rom-protocol 7.4)
 *   bodyMapSummary   one colour per body map cell
 *   compareRom       the retest rule (rom-protocol 5.3 retest, review B15)
 *   compareGait      the gait retest rule (gait-rules retest), for the profile route's gait changes
 *
 * Rules before AI: every number is read from the runtime data (ROM_DATA, TARGETS_DATA, GAIT_DATA); the
 * rules the data writes in words are code here, each quoting its text, and tests/v7/b-profile.test.ts
 * holds them to the data.
 */
import {
  AXIAL_REGIONS,
  REGION_IDS,
  entryCells,
  limbOf,
  type BodyMapKey,
  type ProblemType,
  type RegionEntry,
  type RegionId,
  type SinceBucket,
} from "./body-map";
import type { GaitMode } from "./gait-eligibility";
import type { Intake, Sex } from "./plan";
import { PERCENT_OF_NORMAL_MIN_N, normFor } from "./rom-norms";
import type {
  BodyMapColour,
  CausePath,
  RomChange,
  RomFinding,
  RomFindingId,
  RomProfile,
  RomProfileEntry,
  StoredRomRow,
} from "./rom-types";
import type { GaitMetricId, GaitMetricValue, GaitSetup } from "../engine/gait/types";
import type { RomFlag } from "../engine/rom/types";
import { GAIT_DATA } from "../movements/gait";
import {
  NORMS_VERSION,
  defaultDef,
  movementDef,
  retestBand,
  romCopy,
  romResultLine,
  ROM_DATA,
} from "../movements/rom";
import { DEFAULT_ONLY_IDS, ROM_MOVEMENT_IDS } from "../movements/rom/types";
import type { JointMovementId, RomKind, RomMovementId, RomPositionId, RomSide } from "../movements/rom/types";
import { TARGETS_DATA } from "../movements/targets";
import type { Text } from "../movements/types";

/* ------------------------------------------------------------ movements */

/** A joint movement of the profile: its region, its kind and the sides it has. */
export interface ProfileMovement {
  id: JointMovementId;
  region: RegionId;
  kind: RomKind;
  sides: readonly RomSide[];
}

const LIMB_SIDES: readonly RomSide[] = ["right", "left"];
const NO_SIDE: readonly RomSide[] = ["none"];
const isAxial = (region: RegionId) => AXIAL_REGIONS.includes(region);
const CAMERA_IDS: ReadonlySet<string> = new Set(ROM_MOVEMENT_IDS);
/** A movement the camera measures (a RomMovementId), not a default only one. */
export const isCameraMovement = (id: JointMovementId): id is RomMovementId => CAMERA_IDS.has(id);

/**
 * Every joint movement of a profile, in body order: the regions of the body map, then the camera
 * movements before the default only ones, each in its data order. A limb movement has a right and a
 * left; an axial movement measured in both directions has a right and a left too, the direction of
 * the bend (rom-protocol conventions.sides); the other axial movements have no side, as the protocol
 * stores them. A default only movement is a range in degrees, read like a flexion.
 */
export const PROFILE_MOVEMENTS: readonly ProfileMovement[] = [
  ...ROM_MOVEMENT_IDS.map((id): ProfileMovement => {
    const d = movementDef(id);
    const sides = isAxial(d.region) ? (d.bothDirections ? LIMB_SIDES : NO_SIDE) : LIMB_SIDES;
    return { id, region: d.region, kind: d.kind, sides };
  }),
  ...DEFAULT_ONLY_IDS.map((id): ProfileMovement => {
    const d = defaultDef(id);
    return { id, region: d.region, kind: "flexion", sides: isAxial(d.region) ? NO_SIDE : LIMB_SIDES };
  }),
].sort((a, b) => REGION_IDS.indexOf(a.region) - REGION_IDS.indexOf(b.region));

const SIDE_ORDER: Record<RomSide, number> = { right: 0, left: 1, none: 2 };
const keyOf = (id: string, side: RomSide) => `${id}:${side}`;

/** Every movement and side of a profile in body order: by region, the right side first, then by movement. */
const PROFILE_KEYS: readonly { m: ProfileMovement; side: RomSide }[] = PROFILE_MOVEMENTS.flatMap((m) =>
  m.sides.map((side) => ({ m, side })),
).sort(
  (a, b) =>
    REGION_IDS.indexOf(a.m.region) - REGION_IDS.indexOf(b.m.region) ||
    SIDE_ORDER[a.side] - SIDE_ORDER[b.side],
);
const BODY_ORDER = new Map(PROFILE_KEYS.map(({ m, side }, i) => [keyOf(m.id, side), i]));
const MOVEMENTS = new Map(PROFILE_MOVEMENTS.map((m) => [m.id, m]));
const bodyOrder = (id: string, side: RomSide) => BODY_ORDER.get(keyOf(id, side)) ?? Number.MAX_SAFE_INTEGER;

/** The body map cell of a movement and side: an axial region has one cell for every direction. */
export function profileCell(region: RegionId, side: RomSide): BodyMapKey {
  if (isAxial(region)) return `${region}:axial` as BodyMapKey;
  if (side === "none") throw new RangeError(`A limb movement of the ${region} needs a side`);
  return `${region}:${side}` as BodyMapKey;
}

/** The body map cells of the person's history: every entry's cells («both» covers the right and the left). */
export function affectedCells(intake: Pick<Intake, "regions">): Set<BodyMapKey> {
  return new Set((intake.regions ?? []).flatMap((e) => entryCells(e)));
}

/* -------------------------------------------------------------- profile */

function emptyEntry(m: ProfileMovement, side: RomSide): RomProfileEntry {
  return {
    movementId: m.id,
    side,
    region: m.region,
    source: "default",
    kind: m.kind,
    value: null,
    typical: null,
    percentOfNormal: null,
    z: null,
    finding: "default",
    gradeIgnoringPain: null,
    painLimited: false,
    painLevel: null,
    cause: null,
    provisional: false,
    approximate: false,
    noActiveMovement: false,
    flags: [],
    reason: null,
    measuredAt: null,
    checkId: null,
  };
}

/** The norm row of the movement's typical default for the person (normFor with no position, as typicalValue reads it). */
function defaultRow(id: JointMovementId, side: RomSide, intake: Intake & { sex: Sex }) {
  return normFor(id, null, intake.sex, intake.age, side === "none" ? undefined : side)?.row ?? null;
}

/**
 * 4.3 rule 5: «Default for a movement of a region that is NOT on the body map (D-019): the row mean,
 * rounded to whole degrees, stored with source 'default', percentOfNormal 100 and finding 'default'»,
 * computed on read instead of stored (C-4). percentOfNormal follows thresholds.percentOfNormal, «for
 * flexion and signed movements with N of 20 degrees or more; null for lack movements».
 */
function defaultEntry(m: ProfileMovement, side: RomSide, intake: Intake & { sex: Sex }): RomProfileEntry {
  const row = defaultRow(m.id, side, intake);
  const typical = row ? Math.round(row.mean) : null;
  return {
    ...emptyEntry(m, side),
    value: typical,
    typical,
    percentOfNormal: row && m.kind !== "lack" && row.mean >= PERCENT_OF_NORMAL_MIN_N ? 100 : null,
  };
}

/**
 * A movement of a region on the body map with no stored row: a check still running, or a region added
 * to the body map after the check. Never typical (review A01): a default only movement reads as the
 * protocol stores it in an affected region, not measured by the camera (4.3 rule 6); a camera
 * movement reads as not measured today.
 */
function notYetEntry(m: ProfileMovement, side: RomSide): RomProfileEntry {
  return isCameraMovement(m.id)
    ? { ...emptyEntry(m, side), source: "not_measured_today", finding: "not_today" }
    : {
        ...emptyEntry(m, side),
        source: "not_measured_camera",
        finding: "unknown",
        reason: "not_measured_camera",
      };
}

/**
 * The typical value beside a stored row: the norm the value was graded against (its row mean in whole
 * degrees, as typicalValue rounds it); none for a value of a position without a matched norm («value
 * and progress only», 4.3 rule 7) or a movement that was not measured; and for a joint the person
 * could not move, the typical default kept with its flag (4.3 rule 9: «the default value is stored with
 * flag no_active_movement, and the program never counts that joint as typical»), never as its value.
 */
function storedTypical(row: StoredRomRow, intake: Intake & { sex: Sex }): number | null {
  if (row.source === "measured") return row.norm ? Math.round(row.norm.mean) : null;
  if (row.reason === "no_active_movement") {
    const d = defaultRow(row.movementId, row.side, intake);
    return d ? Math.round(d.mean) : null;
  }
  return null;
}

function storedEntry(row: StoredRomRow, m: ProfileMovement, intake: Intake & { sex: Sex }): RomProfileEntry {
  return {
    movementId: row.movementId,
    side: row.side,
    region: m.region,
    source: row.source,
    kind: m.kind,
    value: row.value,
    typical: storedTypical(row, intake),
    percentOfNormal: row.percentNormal,
    z: row.norm?.z ?? null,
    finding: row.finding,
    gradeIgnoringPain: row.gradeIgnoringPain,
    painLimited: row.pain,
    painLevel: row.painLevel,
    cause: row.cause,
    provisional: row.flags.includes("provisional"),
    approximate: row.flags.includes("approximate"),
    noActiveMovement: row.reason === "no_active_movement",
    flags: [...row.flags],
    reason: row.reason,
    measuredAt: row.source === "measured" ? row.created : null,
    checkId: row.checkId,
  };
}

/**
 * Every joint movement and side: stored rows (measured and the not measured rows that complete and
 * stop write, section 4), plus computed defaults for unaffected regions (C-4). The rows are one check's;
 * should a movement and side have more than one, the last stored is read. A stored row keeps its own
 * source wherever its region is (a residual joint after limb loss can sit outside the body map).
 */
export function buildRomProfile(input: {
  intake: Intake & { sex: Sex };
  rows: readonly StoredRomRow[];
  now: number;
}): RomProfile {
  const { intake } = input;
  const latest = new Map<string, StoredRomRow>();
  for (const r of input.rows) {
    const k = keyOf(r.movementId, r.side);
    const had = latest.get(k);
    if (!had || r.created >= had.created) latest.set(k, r);
  }
  const affected = affectedCells(intake);
  const entries = PROFILE_KEYS.map(({ m, side }) => {
    const row = latest.get(keyOf(m.id, side));
    if (row) return storedEntry(row, m, intake);
    return affected.has(profileCell(m.region, side)) ? notYetEntry(m, side) : defaultEntry(m, side, intake);
  });
  return { sex: intake.sex, age: intake.age, normsVersion: NORMS_VERSION, created: input.now, entries };
}

/* -------------------------------------------------------------- findings */

const CAUSE_RULES = TARGETS_DATA.mapping.causeResolution;
function causeRule(order: number) {
  const r = CAUSE_RULES.find((x) => x.order === order);
  if (!r) throw new Error(`exercise-targets causeResolution has no order ${order}`);
  return r;
}
function alternative(order: number, path: CausePath) {
  const a = causeRule(order).alternatives?.find((x) => x.path === path);
  if (!a) throw new Error(`causeResolution order ${order} has no ${path} alternative`);
  return a;
}
function needed<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`exercise-targets causeResolution: ${what} is missing`);
  return v;
}

/**
 * The intake's since buckets inside a window of weeks or months. The intake asks in four buckets (lt6w,
 * 6w_3m, 3m_6m, gt6m), so 12 weeks reads as the 3 month boundary, as the intake asks it (A2-6; E1's
 * WINDOW_BUCKETS reads it the same way). A number the buckets cannot express stops at load.
 */
function bucketsWithin(n: number, unit: "weeks" | "months"): readonly SinceBucket[] {
  const weeks = unit === "weeks" ? n : n * 4;
  if (weeks === 6) return ["lt6w"];
  if (weeks === 12) return ["lt6w", "6w_3m"];
  if (weeks === 24) return ["lt6w", "6w_3m", "3m_6m"];
  throw new Error(`No intake since bucket ends at ${n} ${unit}`);
}

/** order 1: «Surgery in that region under 12 weeks and cleared for active movement». */
const POST_OP_EARLY_WINDOW = bucketsWithin(needed(causeRule(1).surgeryUnderWeeks, "order 1 weeks"), "weeks");
/** order 4: «rehab when an injury over 6 weeks or surgery from 12 weeks is in the history». */
const REHAB_ALT = alternative(4, "rehab");
const ACUTE_INJURY_WINDOW = bucketsWithin(needed(REHAB_ALT.injuryOverWeeks, "order 4 injury weeks"), "weeks");
const EARLY_SURGERY_WINDOW = bucketsWithin(
  needed(REHAB_ALT.surgeryFromWeeks, "order 4 surgery weeks"),
  "weeks",
);
/** order 7: «injury older than 6 weeks, or surgery from 12 weeks (or with loading clearance)». */
const REHAB_INJURY_WINDOW = bucketsWithin(
  needed(causeRule(7).injuryOverWeeks, "order 7 injury weeks"),
  "weeks",
);
const REHAB_SURGERY_WINDOW = bucketsWithin(
  needed(causeRule(7).surgeryFromWeeks, "order 7 surgery weeks"),
  "weeks",
);
/**
 * order 6: pain_irritable «when the pain rose by 2 or more during the test, today's pain is 4 or 5, or
 * an injury or surgery was under 3 months ago».
 */
const IRRITABLE = alternative(6, "pain_irritable");
const PAIN_RISE_GTE = needed(IRRITABLE.painRiseGte, "order 6 pain rise");
const IRRITABLE_WINDOW = bucketsWithin(
  needed(IRRITABLE.injuryOrSurgeryUnderMonths, "order 6 months"),
  "months",
);

/** order 2: «Stroke, MS, cerebral palsy or incomplete SCI, and the region is on a limb the condition filled in». */
export const UMN_CONDITIONS: readonly string[] = ["stroke", "ms", "cerebral_palsy", "sci_incomplete"];
/** order 8: «hip_abduction with no answer: weak, unless CP or MS is listed with tightness». */
const ABDUCTION_TIGHT_CONDITIONS: readonly string[] = ["cerebral_palsy", "ms"];

/** A missing since answer reads as recent: the safe reading (rom-protocol.ts, E1-6). */
const inside = (since: SinceBucket | undefined, window: readonly SinceBucket[]) =>
  since === undefined || window.includes(since);

/** The body map entries of the movement's own cell (an axial entry covers every direction, «both» either side). */
function mapEntriesOf(intake: Intake, e: Pick<RomProfileEntry, "region" | "side">): RegionEntry[] {
  const cell = profileCell(e.region, e.side);
  return (intake.regions ?? []).filter((r) => r.region === e.region && entryCells(r).includes(cell));
}

/**
 * The region's score before the movement (today's pain), for «the pain rose by 2 or more during the
 * test» and «today's pain is 4 or 5». The profile entry does not carry it (contract gap B4-G1, proposal:
 * RomProfileEntry.painBefore, as StoredRomRow has it), so it is unknown here: the rise counts from 0, as
 * C-15 counts an unknown score before, and today's pain cannot be read.
 */
function painBeforeOf(_e: RomProfileEntry): number | null {
  return null;
}

/** «irritable when the pain rose by 2 or more during the test, today's pain is 4 or 5, or an injury or surgery was under 3 months ago». */
function painPath(e: RomProfileEntry, map: readonly RegionEntry[]): CausePath {
  const before = painBeforeOf(e);
  const rose = e.painLevel !== null && e.painLevel - (before ?? 0) >= PAIN_RISE_GTE;
  const today = before !== null && (IRRITABLE.painToday ?? []).includes(before);
  const recent = map.some(
    (r) =>
      (r.problems.includes("injury") && inside(r.injury?.since, IRRITABLE_WINDOW)) ||
      (r.problems.includes("after_surgery") && inside(r.surgery?.since, IRRITABLE_WINDOW)),
  );
  return rose || today || recent ? "pain_irritable" : "pain_stable";
}

/**
 * The cause path of a finding: exercise-targets 5.1 causeResolution, «first match wins». The person's
 * answers come from the entry (the cause question and the pain), the history from the intake: the body
 * map entries of the movement's own cell, and the conditions.
 */
export function causePath(e: RomProfileEntry, intake: Intake): CausePath {
  const map = mapEntriesOf(intake, e);
  const has = (p: ProblemType) => map.some((r) => r.problems.includes(p));
  const conditions = intake.conditions ?? [];
  const pastInjury = (window: readonly SinceBucket[]) =>
    map.some((r) => r.problems.includes("injury") && !inside(r.injury?.since, window));
  const pastSurgery = (window: readonly SinceBucket[]) =>
    map.some((r) => r.problems.includes("after_surgery") && !inside(r.surgery?.since, window));
  // 1: «Surgery in that region under 12 weeks and cleared for active movement».
  if (
    map.some(
      (r) =>
        r.problems.includes("after_surgery") &&
        inside(r.surgery?.since, POST_OP_EARLY_WINDOW) &&
        (r.surgery?.cleared === undefined || r.surgery.cleared === "yes"),
    )
  )
    return "post_op_early";
  // 2: «Stroke, MS, cerebral palsy or incomplete SCI, and the region is on a limb the condition filled in».
  if (conditions.some((c) => UMN_CONDITIONS.includes(c)) && map.some((r) => r.origin === "condition"))
    return "umn";
  // 3: «Parkinson's in the conditions».
  if (conditions.includes("parkinsons")) return "pd";
  // 4: «The end range answer ... was «شد أو تيبس» (tight)»; «rehab when an injury over 6 weeks or
  // surgery from 12 weeks is in the history».
  if (e.cause === "tight")
    return pastInjury(ACUTE_INJURY_WINDOW) || pastSurgery(EARLY_SURGERY_WINDOW) ? "rehab" : "tight";
  // 5: «The answer was «ضعف أو ثقل» (weak or heavy)».
  if (e.cause === "weak") return "weak";
  // 6: «The answer was «ألم», or the result is pain limited».
  if (e.cause === "pain" || e.painLimited) return painPath(e, map);
  // 7: «Body map: injury older than 6 weeks, or surgery from 12 weeks (or with loading clearance)».
  if (
    pastInjury(REHAB_INJURY_WINDOW) ||
    pastSurgery(REHAB_SURGERY_WINDOW) ||
    map.some((r) => r.problems.includes("after_surgery") && r.surgery?.loadAllowed === "yes")
  )
    return "rehab";
  // 8: «hip_abduction with no answer: weak, unless CP or MS is listed with tightness».
  if (
    e.movementId === "hip_abduction" &&
    e.cause === null &&
    !(conditions.some((c) => ABDUCTION_TIGHT_CONDITIONS.includes(c)) && has("stiffness"))
  )
    return "weak";
  // 9: «Body map problem type stiffness, without arthritis, injury or surgery».
  if (has("stiffness") && !conditions.includes("arthritis") && !has("injury") && !has("after_surgery"))
    return "tight";
  // 10: «Body map problem type weakness or paralysis».
  if (has("weakness")) return "weak";
  // 11: «Body map problem type pain (irritable or stable as order 6)».
  if (has("pain")) return painPath(e, map);
  // 12: «Limb loss (a present joint above the loss)»: a joint with a result is present, and a loss on
  // the same limb and side lies below it.
  const limb = limbOf(e.region);
  if (
    limb !== null &&
    (intake.regions ?? []).some(
      (r) =>
        r.problems.includes("limb_loss") &&
        limbOf(r.region) === limb &&
        (r.side === e.side || r.side === "both"),
    )
  )
    return "rehab";
  // 13: «Nothing above».
  return "unknown";
}

const GRADE_RULES = TARGETS_DATA.mapping.gradeRules;
function gradeRule(finding: string) {
  const r = GRADE_RULES.find((x) => x.finding === finding);
  if (!r) throw new Error(`exercise-targets gradeRules has no row "${finding}"`);
  return r;
}
function priorityOf(n: unknown, what: string): 1 | 2 | 3 {
  if (n === 1 || n === 2 || n === 3) return n;
  throw new Error(`exercise-targets gradeRules: ${what} priority is ${String(n)}`);
}

/** gradeRules (5.3): «mildlyLimited ... priority 2», «markedlyLimited ... 3», «painLimited ... 3». */
const PRIORITY = {
  mild: priorityOf(gradeRule("mildlyLimited").priority, "mildlyLimited"),
  marked: priorityOf(gradeRule("markedlyLimited").priority, "markedlyLimited"),
  pain_limited: priorityOf(gradeRule("painLimited").priority, "painLimited"),
  residual: priorityOf(
    gradeRule("not_measured_camera (residual joint after limb loss)").priority,
    "residual joint",
  ),
};
/** «provisional (1 valid attempt): as its grade, priority one lower». */
const PROVISIONAL_LOWER = gradeRule("provisional (1 valid attempt)").priority === "one lower";
/**
 * «noNormPosition (value and progress only): none until a graded check; knee straightening in sitting
 * with a lack above 52: mobility:knee_extension and stretch:hamstrings at priority 1 plus refer_measure».
 */
const SEATED_KNEE = gradeRule("noNormPosition (value and progress only)");
const SEATED_LACK_ABOVE = needed(SEATED_KNEE.seatedLackAbove, "seatedLackAbove");
const SEATED_LACK_PRIORITY = priorityOf(SEATED_KNEE.seatedLackPriority, "seatedLackPriority");
/**
 * «no_active_movement: no active exercise for that movement ... show refer_care_team», with no
 * priority (0 items). RomFinding.priority has no empty value, so it takes the lowest.
 */
const NO_ACTIVE_MOVEMENT_PRIORITY = 1;

/**
 * An ungraded knee straightening above 52 degrees short of straight. A knee straightening with no grade
 * is the seated one, since lying always has a norm row (tests/v7/b-profile.test.ts reads every age).
 */
const seatedKneeLack = (e: RomProfileEntry) =>
  e.movementId === "knee_extension" &&
  e.source === "measured" &&
  e.finding === "no_grade" &&
  e.value !== null &&
  e.value > SEATED_LACK_ABOVE;

/**
 * The kind of finding of an entry, or null when it is none (5.3: «withinNormal, aboveTypical, not
 * measured today, not applicable» and the typical default give no target). A measured value confirmed
 * with «it hurts», or stopped by pain, is pain limited before any grade (5.3 painPrecedence), also in a
 * position without a matched norm.
 */
function findingKind(e: RomProfileEntry): RomFinding["finding"] | null {
  if (!isCameraMovement(e.movementId)) return null;
  if (e.source === "measured" && e.painLimited) return "pain_limited";
  switch (e.finding) {
    case "mild":
    case "marked":
    case "pain_limited":
      return e.finding;
    case "unknown":
      return e.noActiveMovement || e.source === "not_measured_camera" ? "unknown" : null;
    case "no_grade":
      return seatedKneeLack(e) ? "no_grade" : null;
    default:
      return null;
  }
}

/** The program priority of an entry's finding (exercise-targets 5.3 gradeRules). */
export function findingPriority(e: RomProfileEntry): 1 | 2 | 3 {
  const kind = findingKind(e);
  if (kind === "no_grade") return SEATED_LACK_PRIORITY;
  if (kind === "unknown") return e.noActiveMovement ? NO_ACTIVE_MOVEMENT_PRIORITY : PRIORITY.residual;
  if (kind === null) return 1;
  const p = PRIORITY[kind] - (e.provisional && PROVISIONAL_LOWER ? 1 : 0);
  return p <= 1 ? 1 : p >= 3 ? 3 : (p as 2);
}

const EMPTY: Text = { ar: "", en: "" };

/**
 * The line of a finding (rom-protocol 7.4; «Finding sentences say 'may suggest' and never name a
 * diagnosis»): what the person told us first (a pain stop or the answer «ألم», «شد أو تيبس», «ضعف أو
 * ثقل»), then the path the history gives: weakness for the weak and upper motor neuron paths, stiffness
 * for the tight path and Parkinson's (its regions are stiffness, rom-protocol 2.3). refer_measure «for a
 * residual joint after limb loss that the camera cannot measure and for a seated knee lack above 52»;
 * the data's own line for a joint the person could not move. No line the data writes fits the other
 * paths (rehab, post_op_early, a painful region with no stop, unknown): none is shown (contract gap
 * B4-G2).
 */
export function findingLine(e: RomProfileEntry, path: CausePath): Text {
  if (e.noActiveMovement) return romCopy("no_active_movement");
  const kind = findingKind(e);
  if (kind === "unknown" || kind === "no_grade") return romResultLine("refer_measure");
  if (e.painLimited || e.cause === "pain") return romResultLine("finding_pain");
  if (e.cause === "tight") return romResultLine("finding_tight");
  if (e.cause === "weak") return romResultLine("finding_weak");
  if (path === "weak" || path === "umn") return romResultLine("finding_weak");
  if (path === "tight" || path === "pd") return romResultLine("finding_tight");
  return EMPTY;
}

/**
 * The findings of a profile, in body order: every limited, pain limited and unknown result of a camera
 * movement (a default only movement of an affected region is the region default rule's, 5.6), each with
 * its path, priority and line.
 */
export function romFindings(profile: RomProfile, intake: Intake): RomFinding[] {
  const out: RomFinding[] = [];
  for (const e of profile.entries) {
    const finding = findingKind(e);
    if (finding === null || !isCameraMovement(e.movementId)) continue;
    const path = causePath(e, intake);
    out.push({
      movementId: e.movementId,
      side: e.side,
      region: e.region,
      finding,
      path,
      cause: e.cause,
      priority: findingPriority(e),
      provisional: e.provisional,
      approximate: e.approximate,
      noActiveMovement: e.noActiveMovement,
      value: e.value,
      typical: e.typical,
      percentOfNormal: e.percentOfNormal,
      line: findingLine(e, path),
    });
  }
  return out;
}

/* -------------------------------------------------------------- body map */

/**
 * A cell shows its strongest result: pain first, as pain limited takes precedence over the degree grade
 * (5.3), then marked, mild and within; grey for what was not measured or has no typical value to compare
 * with; nothing for a typical default or an absent joint («no value, no default, no finding», 2.4).
 */
export const BODY_MAP_COLOUR_ORDER: readonly BodyMapColour[] = ["pain", "marked", "mild", "within", "grey"];
const COLOUR_OF: Record<RomFindingId, BodyMapColour> = {
  within: "within",
  mild: "mild",
  marked: "marked",
  pain_limited: "pain",
  no_grade: "grey",
  unknown: "grey",
  not_today: "grey",
  default: "none",
  not_applicable: "none",
};

/** The colour of one entry on the body map. */
export function entryColour(e: RomProfileEntry): BodyMapColour {
  if (e.source === "measured" && e.painLimited) return "pain";
  return COLOUR_OF[e.finding];
}

export function bodyMapSummary(profile: RomProfile): Partial<Record<BodyMapKey, BodyMapColour>> {
  const out: Partial<Record<BodyMapKey, BodyMapColour>> = {};
  const rank = (c: BodyMapColour) => BODY_MAP_COLOUR_ORDER.indexOf(c);
  for (const e of profile.entries) {
    const colour = entryColour(e);
    if (colour === "none") continue;
    const cell = profileCell(e.region, e.side);
    const had = out[cell];
    if (had === undefined || rank(colour) < rank(had)) out[cell] = colour;
  }
  return out;
}

/* ---------------------------------------------------------------- retest */

/**
 * The neurological conditions of the retest bands: the v1.1 wide band's list for the arm raise to the
 * side (check-v1 shoulder_abduction noiseBandRules.wideWhen: «conditions include stroke, ms,
 * cerebral_palsy, sci_complete, sci_incomplete or parkinsons»), also read for «on a limb affected by a
 * neurological condition». compareRom gets the conditions only, so a neurological condition widens the
 * band on either side: the safe side for calling a change (and the focused check measures the affected
 * side only).
 */
export const NEUROLOGICAL_CONDITIONS: readonly string[] = [
  "stroke",
  "ms",
  "cerebral_palsy",
  "sci_complete",
  "sci_incomplete",
  "parkinsons",
];
/** v1.1 wideWhen: «either check has attempt spread over 15 degrees, gravity reference or bent elbow». */
const WIDE_FLAGS: readonly RomFlag[] = ["inconsistent", "gravityMode", "bentElbow"];

/**
 * The retest band of a movement in degrees (rom-protocol 5.3 retest): «Band = MDC95 for the movement
 * and population, never below 10: on a limb affected by a neurological condition, shoulder flexion 18
 * ... and elbow 33 (lab) or 36 (home) (R19); lunge 10 ...; lying knee straightening 11 ...; all other
 * movements 10 until the bench test retest gives Azm's own value (R18). The arm raise to the side keeps
 * its v1.1 band (16, wide 20)». The elbow takes its home band for both elbow movements (FZ-1, D-026),
 * and the side arm raise's wide band follows v1.1 wideWhen (the conditions, or a flag of either check).
 */
export function retestBandDeg(
  movementId: RomMovementId,
  position: RomPositionId | null,
  conditions: readonly string[],
  flags: readonly RomFlag[] = [],
): number {
  const retest = ROM_DATA.retest;
  const neuro = conditions.some((c) => NEUROLOGICAL_CONDITIONS.includes(c));
  const band = retestBand(movementId) ?? retestBand(movementDef(movementId).region);
  let deg = retest.defaultDeg;
  if (band && (band.position === undefined || band.position === position)) {
    if (band.deg !== undefined) deg = band.deg;
    if (neuro && band.neurologicalDeg !== undefined) deg = band.neurologicalDeg;
    else if (neuro && band.neurologicalHomeDeg !== undefined) deg = band.neurologicalHomeDeg;
    if (band.wideDeg !== undefined && (neuro || flags.some((f) => WIDE_FLAGS.includes(f))))
      deg = band.wideDeg;
  }
  return Math.max(retest.floorDeg, deg);
}

const measuredValue = (r: StoredRomRow) =>
  r.source === "measured" && r.value !== null && isCameraMovement(r.movementId);
/** Like with like: «same positions for movements measured before» (2.5), the same pose model and movement version (v1.1 comparability). */
const sameOrUnknown = <T>(a: T | null, b: T | null) => a === null || b === null || a === b;
const likeWithLike = (a: StoredRomRow, b: StoredRomRow) =>
  a.movementId === b.movementId &&
  a.side === b.side &&
  a.position === b.position &&
  sameOrUnknown(a.poseModel, b.poseModel) &&
  sameOrUnknown(a.movementVersion, b.movementVersion);

/**
 * retest rule: «a change counts as better or worse only when the best and the median of valid attempts
 * both differ from the first check by more than the band, in the same direction» (review B15, v1.1
 * agreement rule). A lack is better when it shrinks. `first` may hold the rows of several earlier
 * checks: each movement is compared with its earliest measurement like with like. A latest row without
 * a median cannot agree, so it reads about the same (v1 SPEC-GAP missing-median). Body order.
 */
export function compareRom(
  first: readonly StoredRomRow[],
  latest: readonly StoredRomRow[],
  conditions: readonly string[],
): RomChange[] {
  const now = new Map<string, StoredRomRow>();
  for (const r of latest.filter(measuredValue)) {
    const k = keyOf(r.movementId, r.side);
    const had = now.get(k);
    if (!had || r.created >= had.created) now.set(k, r);
  }
  const out: RomChange[] = [];
  const rows = [...now.values()].sort(
    (a, b) => bodyOrder(a.movementId, a.side) - bodyOrder(b.movementId, b.side),
  );
  for (const l of rows) {
    const f = first
      .filter((r) => measuredValue(r) && likeWithLike(r, l))
      .sort((a, b) => a.created - b.created)[0];
    if (!f) continue;
    const id = l.movementId as RomMovementId;
    const bandDeg = retestBandDeg(id, l.position, conditions, [...f.flags, ...l.flags]);
    const sign = MOVEMENTS.get(id)!.kind === "lack" ? -1 : 1;
    const best = (l.value! - f.value!) * sign;
    const median = l.median === null || f.median === null ? 0 : (l.median - f.median) * sign;
    const direction =
      best > bandDeg && median > bandDeg ? "better" : best < -bandDeg && median < -bandDeg ? "worse" : "same";
    out.push({ movementId: id, side: l.side, first: f.value!, latest: l.value!, bandDeg, direction });
  }
  return out;
}

/* ------------------------------------------------------------ gait retest */

/** One gait metric against the first comparable walk. */
export interface GaitChange {
  metric: GaitMetricId;
  first: number;
  latest: number;
  /** The number's own direction: the gait rules write no better or worse for a metric. */
  direction: "up" | "down" | "same";
}

/** What the gait retest rule reads of a stored walk. */
export interface GaitCompared {
  mode: GaitMode;
  setup: Pick<GaitSetup, "aid" | "orthosis" | "padSpeedKmh">;
  metrics: Partial<Record<GaitMetricId, GaitMetricValue>>;
}

/** The metrics each realChange row of the gait data covers (symmetry ratios, knee angles, the trailing limb angle). */
const REAL_CHANGE_METRICS: Readonly<Record<string, readonly GaitMetricId[]>> = {
  speed_mps: ["speed_mps"],
  step_length_m: ["step_length_m"],
  cadence: ["cadence"],
  symmetry_ratio: ["sr_single_support", "sr_stance", "sr_step_length"],
  knee_deg: ["knee_swing_peak", "knee_stance_min", "knee_loading_peak"],
  tla_deg: ["tla_peak"],
};
const sameOrthosis = (a: GaitCompared["setup"]["orthosis"], b: GaitCompared["setup"]["orthosis"]) =>
  (["left", "right"] as const).every((s) => (a[s] ?? null) === (b[s] ?? null));

/**
 * gait-rules retest.likeWithLike: «same mode, same view, same aid and orthosis, ... pad: first test
 * speed first, then the new comfortable speed», so a pad walk is compared at the same belt speed. The
 * same view is the metric's own: a metric missing in either walk is left out. The Parkinson's dose
 * timing is not kept yet (CG-18, D-026).
 */
export function gaitComparable(first: GaitCompared, latest: GaitCompared): boolean {
  return (
    first.mode === latest.mode &&
    first.setup.aid === latest.setup.aid &&
    sameOrthosis(first.setup.orthosis, latest.setup.orthosis) &&
    (first.mode !== "walking_pad" || first.setup.padSpeedKmh === latest.setup.padSpeedKmh)
  );
}

/** Floating point room when a change equals the smallest real change (0.9 minus 0.8 is not quite 0.1). */
const EPSILON = 1e-9;

/**
 * gait-rules retest.realChange: each metric's smallest real change (speed 0.1 m/s, step length 0.05 m,
 * cadence 5, a symmetry ratio 0.06, a knee angle 10, the trailing limb angle 8), in the data's order.
 */
export function compareGait(first: GaitCompared, latest: GaitCompared): GaitChange[] {
  if (!gaitComparable(first, latest)) return [];
  const out: GaitChange[] = [];
  for (const rule of GAIT_DATA.retest.realChange) {
    const ids = REAL_CHANGE_METRICS[rule.metric];
    if (!ids) throw new Error(`gait retest.realChange: unknown metric ${rule.metric}`);
    for (const id of ids) {
      const a = first.metrics[id]?.value;
      const b = latest.metrics[id]?.value;
      if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b))
        continue;
      const d = b - a;
      out.push({
        metric: id,
        first: a,
        latest: b,
        direction: Math.abs(d) >= rule.min - EPSILON ? (d > 0 ? "up" : "down") : "same",
      });
    }
  }
  return out;
}
