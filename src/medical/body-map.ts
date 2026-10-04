/**
 * The v7 body map (product v7 contract 2.2): the regions of the body the person marks as affected,
 * the problem types per region and the follow up answers that shape the range protocol
 * (rom-protocol 2.1 to 2.4). Pure, no DOM: shared by the client and the server.
 *
 * Step A1 committed the types and id lists; step A2 adds the functions of 2.2 (autoFillQuestions,
 * autoFillRegions, mergeRegions, validateRegions) and what the intake form needs to ask and save the
 * answers: the follow up questions of a region (regionQuestions, finalizeRegion), the safety answers
 * (romFlagQuestions, finalizeRomFlags), the v1 pain mirror (painIdsFromRegions) and the cells of the
 * body map (entryCells).
 *
 * The fill table and the question rules are prose in the clinical source (rom-protocol 2.2, 2.3, 2.5
 * and 6), so they are code here (C-1); tests/v7/a-body-map.test.ts checks them against the data and,
 * with AZM_CLINICAL_V7, against the prose they were written from.
 *
 * plan.ts (validateIntake) imports this module, and plan.ts reaches many chunks, so it reads the
 * range of motion data only through the named import of conditionAutoMap below: a default build
 * keeps none of it, and a v7 build keeps only that slice (the full data is imported only by v7
 * chunks, contract 8.8).
 */
import { conditionAutoMap } from "../movements/rom/rom-v7.json";
import type { RomMovementId } from "../movements/rom/types";
import type { Text } from "../movements/types";
import type { painOptions } from "./plan";

/** The canonical region ids (C-11): the ids of rom-protocol.json regions, in body order. */
export const REGION_IDS = [
  "neck",
  "back_trunk",
  "shoulder",
  "elbow",
  "forearm_wrist",
  "hip",
  "knee",
  "ankle_foot",
] as const;
export type RegionId = (typeof REGION_IDS)[number];
/** Regions without a left and right: one axial cell. */
export const AXIAL_REGIONS: readonly RegionId[] = ["neck", "back_trunk"];
/** The problem types of problem_ask (rom-protocol.json problemTypes). */
export const PROBLEM_TYPES = [
  "weakness",
  "injury",
  "pain",
  "stiffness",
  "after_surgery",
  "limb_loss",
] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];
/** Limb regions: left, right or both. Neck and back or trunk: axial. */
export type RegionSide = "left" | "right" | "both" | "axial";
/** injury_when and surgery_when answers. */
export type SinceBucket = "lt6w" | "6w_3m" | "3m_6m" | "gt6m";
export type LimbLossLevel = "below_knee" | "above_knee" | "below_elbow" | "above_elbow";
/** hip_avoid_* answers; ["none"] means told of no limits. */
export type HipAvoidId = "flex90" | "cross" | "turn_in" | "back_out" | "none";
export type YesNoUnsure = "yes" | "no" | "unsure";

export interface RegionEntry {
  region: RegionId;
  side: RegionSide;
  /** 1 to 6 unique problem types (problem_ask). */
  problems: ProblemType[];
  /** Where the entry came from. The person confirmed it in every case (plan 1.1). */
  origin: "person" | "condition" | "report";
  /** Present only when problems includes "injury". achilles only on ankle_foot (achilles_ask). */
  injury?: { since: SinceBucket; achilles?: boolean };
  /** Present only when problems includes "after_surgery". */
  surgery?: {
    since: SinceBucket;
    /** surgery_cleared */
    cleared: YesNoUnsure;
    /** surgery_avoid, [] when none */
    avoid: RomMovementId[];
    /** hip only */
    hipReplacement?: boolean;
    /** hip_avoid_ask, hip replacement under 3 months only */
    hipAvoid?: HipAvoidId[];
    /** surgery_stretch_ask (under 12 weeks) */
    stretchAllowed?: YesNoUnsure;
    /** surgery_load_ask (under 12 weeks) */
    loadAllowed?: YesNoUnsure;
  };
  /** Present only when problems includes "limb_loss"; side must be left or right. */
  limbLoss?: { level: LimbLossLevel };
}

export interface RomIntakeFlags {
  /** bones_ask */
  osteoporosis: boolean;
  /** neck_ask */
  neckCaution: boolean;
  /** arthritis_type_ask (arthritis only) */
  inflammatoryArthritis?: YesNoUnsure;
  /** neck_cleared_ask */
  neckCleared?: boolean;
  /** foot_lift_ask */
  footLift?: Partial<Record<"left" | "right", boolean>>;
  /** transfer_chair_ask (wheelchair users) */
  transferChair?: boolean;
  /**
   * sit_unsupported_ask (review C11; contract gap 1 of the 2026-10-04 change log, the proposal applied
   * until the tech lead decides). Asked only with mobility wheelchair or seated, or with SCI, MS,
   * stroke, CP or Parkinson's; absent means yes, except mobility bed and SCI at neck level, which
   * mean no. It gates the seated_forward position and the seated forward bend (reason
   * sitting_balance).
   */
  sitUnsupported?: YesNoUnsure;
}

/** The answers of the condition questions (rom-protocol 2.3). */
export type AutoFillAnswer =
  | { condition: "stroke"; weakerSide: "left" | "right" }
  | { condition: "cerebral_palsy"; pattern: "one_side"; side: "left" | "right" }
  | { condition: "cerebral_palsy"; pattern: "both_legs" | "all_limbs" }
  | { condition: "ms"; limbs: ("right_arm" | "left_arm" | "right_leg" | "left_leg")[] }
  | { condition: "parkinsons"; confirmed: boolean }
  | { condition: "sci_complete" | "sci_incomplete"; level: "neck" | "back" }
  | { condition: "lower_limb_unilateral"; side: "left" | "right"; level: "below_knee" | "above_knee" }
  | { condition: "upper_limb_unilateral"; side: "left" | "right"; level: "below_elbow" | "above_elbow" };

/** A body map cell: a region and a side (axial regions have one cell). */
export type BodyMapKey = `${RegionId}:${"left" | "right" | "axial"}`;

/* ------------------------------------------------------------ id lists */

/** The regions with a left and a right, in body order. */
export const LIMB_REGIONS = ["shoulder", "elbow", "forearm_wrist", "hip", "knee", "ankle_foot"] as const;
const ARM_REGIONS: readonly RegionId[] = ["shoulder", "elbow", "forearm_wrist"];
const LEG_REGIONS: readonly RegionId[] = ["hip", "knee", "ankle_foot"];
/** The injury_when and surgery_when buckets, most recent first. */
export const SINCE_BUCKETS = ["lt6w", "6w_3m", "3m_6m", "gt6m"] as const satisfies readonly SinceBucket[];
/** The hip_avoid_ask answers, in the order of the clinical copy. */
export const HIP_AVOID_IDS = [
  "flex90",
  "cross",
  "turn_in",
  "back_out",
  "none",
] as const satisfies readonly HipAvoidId[];
/** The limb loss levels of an arm and of a leg (rom-protocol 2.4). */
export const LIMB_LOSS_LEVELS = {
  arm: ["below_elbow", "above_elbow"],
  leg: ["below_knee", "above_knee"],
} as const satisfies Record<"arm" | "leg", readonly LimbLossLevel[]>;
const ORIGINS: readonly RegionEntry["origin"][] = ["person", "condition", "report"];
const YES_NO_UNSURE: readonly YesNoUnsure[] = ["yes", "no", "unsure"];
/** At most one entry per cell: 2 axial cells and 6 limb regions with two sides each. */
export const MAX_REGION_ENTRIES = 16;

/**
 * The movements the camera measures in each region (rom-protocol 2.1, the measure and caution
 * columns of regionTable): the choices of surgery_avoid. Parity tested against ROM_DATA.regionTable.
 */
export const REGION_MOVEMENTS: Readonly<Record<RegionId, readonly RomMovementId[]>> = {
  neck: ["neck_lateral_flexion", "neck_flexion", "neck_extension"],
  back_trunk: ["trunk_lateral_flexion", "trunk_flexion"],
  shoulder: ["shoulder_flexion", "shoulder_abduction", "shoulder_extension"],
  elbow: ["elbow_extension", "elbow_flexion"],
  forearm_wrist: [],
  hip: ["hip_flexion", "hip_extension", "hip_abduction"],
  knee: ["knee_flexion", "knee_extension"],
  ankle_foot: ["ankle_dorsiflexion_lunge"],
};

type PainId = (typeof painOptions)[number];
/**
 * The pain mirror (contract 2.2 rule 3): the v1 pain id of each region that has one. Neck and
 * ankle and foot have none; the v7 contraindications cover them.
 */
export const REGION_PAIN_IDS: Readonly<Partial<Record<RegionId, PainId>>> = {
  shoulder: "shoulder",
  elbow: "elbow",
  forearm_wrist: "wrist",
  back_trunk: "back",
  hip: "hip",
  knee: "knee",
};
/** The v1 order of painOptions (plan.ts), which this module cannot import as a value. */
const PAIN_ORDER: readonly PainId[] = ["shoulder", "elbow", "wrist", "back", "hip", "knee"];

/* --------------------------------------------------------------- small helpers */

function has<T>(list: readonly T[], x: unknown): x is T {
  return list.includes(x as T);
}
const isAxial = (region: RegionId) => AXIAL_REGIONS.includes(region);
/** The limb a region belongs to, or null for the neck and the back or trunk. */
export function limbOf(region: RegionId): "arm" | "leg" | null {
  return ARM_REGIONS.includes(region) ? "arm" : LEG_REGIONS.includes(region) ? "leg" : null;
}
/** Under 3 months: the window of the recent surgery rules (rom-protocol 2.2 and 6). */
export function underThreeMonths(since: SinceBucket): boolean {
  return since === "lt6w" || since === "6w_3m";
}
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).every((k) => keys.includes(k));
function uniqueList<T>(v: unknown, allowed: readonly T[], min = 0): v is T[] {
  return (
    Array.isArray(v) && v.length >= min && new Set(v).size === v.length && v.every((x) => has(allowed, x))
  );
}

/** The body map cells an entry covers: both covers right and left. */
export function entryCells(e: Pick<RegionEntry, "region" | "side">): BodyMapKey[] {
  if (e.side === "axial") return [`${e.region}:axial`];
  if (e.side === "both") return [`${e.region}:right`, `${e.region}:left`];
  return [`${e.region}:${e.side}`];
}

/** The v1 pain ids pain[] must hold for these entries (pain or injury in a region with a v1 id). */
export function painIdsFromRegions(regions: readonly Pick<RegionEntry, "region" | "problems">[]): PainId[] {
  const ids = new Set<PainId>();
  for (const e of regions) {
    const id = REGION_PAIN_IDS[e.region];
    if (id && (e.problems.includes("pain") || e.problems.includes("injury"))) ids.add(id);
  }
  return PAIN_ORDER.filter((id) => ids.has(id));
}

/* --------------------------------------------------- the condition questions */

/** The questions to ask for the person's conditions, in order (conditionAutoMap). */
export function autoFillQuestions(
  conditions: readonly string[],
): { condition: string; ask: Text; answers: Text[] }[] {
  return conditionAutoMap
    .filter((row) => conditions.includes(row.condition) && row.ask.ar !== "" && row.ask.en !== "")
    .map((row) => ({ condition: row.condition, ask: row.ask, answers: row.answers }));
}

const fill = (
  regions: readonly RegionId[],
  side: RegionSide,
  problems: ProblemType[],
  extra: Partial<RegionEntry> = {},
): RegionEntry[] =>
  regions.map((region) => ({ region, side, problems: [...problems], origin: "condition", ...extra }));

/** The regions and problem types one answer fills (rom-protocol 2.3, the regions and problem columns). */
function fillFor(a: AutoFillAnswer): RegionEntry[] {
  switch (a.condition) {
    case "stroke":
      // That side: shoulder, elbow, forearm and wrist, hip, knee, ankle and foot; weakness.
      return fill(LIMB_REGIONS, a.weakerSide, ["weakness"]);
    case "cerebral_palsy":
      // One side: that side's arm and leg; both legs: hips, knees, ankles; all limbs. Stiffness and
      // weakness. The trunk is never filled in (review A02).
      if (a.pattern === "one_side") return fill(LIMB_REGIONS, a.side, ["weakness", "stiffness"]);
      return fill(a.pattern === "both_legs" ? LEG_REGIONS : LIMB_REGIONS, "both", ["weakness", "stiffness"]);
    case "ms": {
      // Each chosen limb: arm = shoulder, elbow, forearm and wrist; leg = hip, knee, ankle and foot.
      const sideOf = (right: boolean, left: boolean): RegionSide | null =>
        right && left ? "both" : right ? "right" : left ? "left" : null;
      const arms = sideOf(a.limbs.includes("right_arm"), a.limbs.includes("left_arm"));
      const legs = sideOf(a.limbs.includes("right_leg"), a.limbs.includes("left_leg"));
      return [
        ...(arms ? fill(ARM_REGIONS, arms, ["weakness"]) : []),
        ...(legs ? fill(LEG_REGIONS, legs, ["weakness"]) : []),
      ];
    }
    case "parkinsons":
      // Neck, both shoulders, both hips, and back or trunk; stiffness (review A10). The answer «أريد
      // التعديل» keeps the same map, which the form then opens for changes.
      return [
        ...fill(["neck", "back_trunk"], "axial", ["stiffness"]),
        ...fill(["shoulder", "hip"], "both", ["stiffness"]),
      ];
    case "sci_complete":
    case "sci_incomplete":
      // In the neck: both arms and both legs; in the back or lower: both legs. Weakness; the trunk is
      // never filled in (review A02).
      return fill(a.level === "neck" ? LIMB_REGIONS : LEG_REGIONS, "both", ["weakness"]);
    case "lower_limb_unilateral":
      // That side's hip, and the knee when the loss is below it (rom-protocol 2.4).
      return fill(a.level === "below_knee" ? ["hip", "knee"] : ["hip"], a.side, ["limb_loss"], {
        limbLoss: { level: a.level },
      });
    case "upper_limb_unilateral":
      // That side's shoulder, and the elbow when the loss is below it.
      return fill(a.level === "below_elbow" ? ["shoulder", "elbow"] : ["shoulder"], a.side, ["limb_loss"], {
        limbLoss: { level: a.level },
      });
  }
}

/** Regions filled from the conditions, origin "condition"; the person confirms (confirm_regions). */
export function autoFillRegions(answers: readonly AutoFillAnswer[]): RegionEntry[] {
  return mergeRegions([], answers.flatMap(fillFor));
}

/* ------------------------------------------------------------------ merging */

/**
 * The answers of one body map entry while the person fills them in: the intake form's working
 * state. A complete RegionEntry is a RegionDraft; finalizeRegion turns a draft back into an entry.
 */
export interface RegionDraft {
  region: RegionId;
  side: RegionSide;
  problems: ProblemType[];
  origin: RegionEntry["origin"];
  injury?: Partial<NonNullable<RegionEntry["injury"]>>;
  surgery?: Partial<NonNullable<RegionEntry["surgery"]>>;
  limbLoss?: Partial<NonNullable<RegionEntry["limbLoss"]>>;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (!isObject(a) || !isObject(b)) return false;
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined);
  const ka = keys(a);
  return ka.length === keys(b).length && ka.every((k) => same(a[k], b[k]));
}

/** One entry from several entries of one region: problems united, the first answers and origin kept. */
function combine<T extends RegionDraft>(entries: readonly T[], side: RegionSide): T {
  function first<K extends "injury" | "surgery" | "limbLoss">(k: K): T[K] | undefined {
    return entries.find((e) => e[k] !== undefined)?.[k];
  }
  const out = {
    region: entries[0].region,
    side,
    problems: PROBLEM_TYPES.filter((p) => entries.some((e) => e.problems.includes(p))),
    origin: entries[0].origin,
  } as T;
  const injury = first("injury"),
    surgery = first("surgery"),
    limbLoss = side === "left" || side === "right" ? first("limbLoss") : undefined;
  if (injury) out.injury = injury;
  if (surgery) out.surgery = surgery;
  if (limbLoss) out.limbLoss = limbLoss;
  return out;
}

/**
 * mergeRegions on entries still being answered (the form merges a fill or a report suggestion into
 * the map the person is editing). Union per region and side, the problem types merged, the base
 * entry's answers and origin kept. A both entry absorbs the left and right entries of its region
 * when both sides then hold the same answers; otherwise it splits into a right and a left entry, so
 * no side gains a problem it does not have, and a limb loss always stays on its own side. Output in
 * body order, right before left.
 */
export function mergeRegionDrafts<T extends RegionDraft>(base: readonly T[], add: readonly T[]): T[] {
  const all = [...base, ...add];
  const out: T[] = [];
  for (const region of REGION_IDS) {
    const here = all.filter((e) => e.region === region);
    if (!here.length) continue;
    if (isAxial(region)) {
      out.push(combine(here, "axial"));
      continue;
    }
    // A side is covered by its own entries and by a both entry (an axial side on a limb reads as both).
    const right = here.filter((e) => e.side !== "left"),
      left = here.filter((e) => e.side !== "right");
    const r = right.length ? combine(right, "right") : null;
    const l = left.length ? combine(left, "left") : null;
    const hasBoth = here.some((e) => e.side !== "left" && e.side !== "right");
    if (
      r &&
      l &&
      hasBoth &&
      !r.limbLoss &&
      !l.limbLoss &&
      same({ ...r, origin: 0, side: 0 }, { ...l, origin: 0, side: 0 })
    )
      out.push(combine(here, "both"));
    else {
      if (r) out.push(r);
      if (l) out.push(l);
    }
  }
  return out;
}

/** Union per region and side; problem types merged; a "both" entry absorbs left and right. */
export function mergeRegions(base: readonly RegionEntry[], add: readonly RegionEntry[]): RegionEntry[] {
  return mergeRegionDrafts(base, add);
}

/* --------------------------------------------------------------- validation */

const ENTRY_KEYS = ["region", "side", "problems", "origin", "injury", "surgery", "limbLoss"];
const SURGERY_KEYS = [
  "since",
  "cleared",
  "avoid",
  "hipReplacement",
  "hipAvoid",
  "stretchAllowed",
  "loadAllowed",
];

function validEntry(v: unknown): v is RegionEntry {
  if (!isObject(v) || !onlyKeys(v, ENTRY_KEYS)) return false;
  const region = v.region;
  if (!has(REGION_IDS, region)) return false;
  const axial = isAxial(region);
  if (axial ? v.side !== "axial" : !has(["left", "right", "both"] as const, v.side)) return false;
  if (!uniqueList(v.problems, PROBLEM_TYPES, 1) || !has(ORIGINS, v.origin)) return false;
  const problems = v.problems;
  // Each answer object exists exactly when its problem type is chosen.
  for (const [key, problem] of [
    ["injury", "injury"],
    ["surgery", "after_surgery"],
    ["limbLoss", "limb_loss"],
  ] as const)
    if ((v[key] !== undefined) !== problems.includes(problem)) return false;
  if (v.injury !== undefined) {
    const i = v.injury;
    if (!isObject(i) || !onlyKeys(i, ["since", "achilles"]) || !has(SINCE_BUCKETS, i.since)) return false;
    // achilles_ask belongs to the ankle and foot, where it is always asked (the lunge and calf rule).
    if (region === "ankle_foot" ? typeof i.achilles !== "boolean" : i.achilles !== undefined) return false;
  }
  if (v.surgery !== undefined) {
    const s = v.surgery;
    if (!isObject(s) || !onlyKeys(s, SURGERY_KEYS) || !has(SINCE_BUCKETS, s.since)) return false;
    const recent = underThreeMonths(s.since);
    if (!has(YES_NO_UNSURE, s.cleared) || !uniqueList(s.avoid, REGION_MOVEMENTS[region])) return false;
    // A recent hip surgery always says whether it was a replacement (hip bend and the hip limits).
    if (region === "hip" && recent ? typeof s.hipReplacement !== "boolean" : s.hipReplacement !== undefined)
      return false;
    if (s.hipAvoid !== undefined) {
      if (!(s.hipReplacement === true && recent) || !uniqueList(s.hipAvoid, HIP_AVOID_IDS, 1)) return false;
      if (s.hipAvoid.includes("none") && s.hipAvoid.length > 1) return false;
    }
    for (const k of ["stretchAllowed", "loadAllowed"] as const)
      if (s[k] !== undefined && !(recent && has(YES_NO_UNSURE, s[k]))) return false;
  }
  if (v.limbLoss !== undefined) {
    const l = v.limbLoss;
    const limb = limbOf(region);
    if (v.side === "both" || !limb || !isObject(l) || !onlyKeys(l, ["level"])) return false;
    if (!has(LIMB_LOSS_LEVELS[limb], l.level)) return false;
  }
  return true;
}

/** At most 16 entries, unique (region, side), axial only for axial regions, sub objects only with their problem type. */
export function validateRegions(v: unknown): v is RegionEntry[] {
  if (!Array.isArray(v) || v.length > MAX_REGION_ENTRIES || !v.every(validEntry)) return false;
  // One entry per cell: both covers the right and the left cell.
  const cells = v.flatMap(entryCells);
  if (new Set(cells).size !== cells.length) return false;
  // One limb loss level per limb and side.
  const levels = new Map<string, LimbLossLevel>();
  for (const e of v) {
    if (!e.limbLoss) continue;
    const key = `${limbOf(e.region)}:${e.side}`;
    if ((levels.get(key) ?? e.limbLoss.level) !== e.limbLoss.level) return false;
    levels.set(key, e.limbLoss.level);
  }
  return true;
}

/* ------------------------------------------------ the follow up questions */

/** The follow up questions of a body map entry (rom-protocol 7.1 copy keys, plus the hip replacement and limb loss level). */
export type RegionQuestionId =
  | "injury_when"
  | "achilles_ask"
  | "surgery_when"
  | "surgery_cleared"
  | "surgery_avoid"
  | "hip_replacement"
  | "hip_avoid_ask"
  | "surgery_stretch_ask"
  | "surgery_load_ask"
  | "limb_loss_level";

/**
 * The follow up questions of an entry given its answers so far, in asking order (rom-protocol 2.2
 * and 6). Injury: when, and on the ankle and foot the Achilles question. Surgery: when; under 3
 * months the team's clearance, then, once cleared, what to avoid (where the camera measures
 * something), stretching and loading; after a recent hip surgery, whether it was a replacement and
 * its limits, cleared or not. Limb loss: the level, on one side only.
 */
export function regionQuestions(d: RegionDraft): RegionQuestionId[] {
  const out: RegionQuestionId[] = [];
  if (d.problems.includes("injury")) {
    out.push("injury_when");
    if (d.region === "ankle_foot") out.push("achilles_ask");
  }
  if (d.problems.includes("after_surgery")) {
    out.push("surgery_when");
    const s = d.surgery ?? {};
    if (s.since && underThreeMonths(s.since)) {
      out.push("surgery_cleared");
      const cleared = s.cleared === "yes";
      if (cleared && REGION_MOVEMENTS[d.region].length) out.push("surgery_avoid");
      if (d.region === "hip") {
        out.push("hip_replacement");
        if (s.hipReplacement) out.push("hip_avoid_ask");
      }
      if (cleared) out.push("surgery_stretch_ask", "surgery_load_ask");
    }
  }
  if (d.problems.includes("limb_loss")) out.push("limb_loss_level");
  return out;
}

/**
 * The entry a complete draft saves, without the answers that no longer apply; null while a question
 * of regionQuestions has no answer. A surgery more than 3 months ago asks only when (the recent
 * rules no longer apply) and is stored as cleared with nothing to avoid (contract change log, A2).
 */
export function finalizeRegion(d: RegionDraft): RegionEntry | null {
  if (!uniqueList(d.problems, PROBLEM_TYPES, 1)) return null;
  const asked = new Set(regionQuestions(d));
  const out: RegionEntry = { region: d.region, side: d.side, problems: [...d.problems], origin: d.origin };
  if (asked.has("injury_when")) {
    const since = d.injury?.since;
    if (!since) return null;
    out.injury = { since };
    if (asked.has("achilles_ask")) {
      if (typeof d.injury?.achilles !== "boolean") return null;
      out.injury.achilles = d.injury.achilles;
    }
  }
  if (asked.has("surgery_when")) {
    const s = d.surgery ?? {};
    if (!s.since) return null;
    if (!underThreeMonths(s.since)) out.surgery = { since: s.since, cleared: "yes", avoid: [] };
    else {
      if (!s.cleared) return null;
      const surgery: NonNullable<RegionEntry["surgery"]> = { since: s.since, cleared: s.cleared, avoid: [] };
      if (asked.has("surgery_avoid")) {
        if (!s.avoid) return null;
        surgery.avoid = REGION_MOVEMENTS[d.region].filter((id) => s.avoid!.includes(id));
      }
      if (asked.has("hip_replacement")) {
        if (typeof s.hipReplacement !== "boolean") return null;
        surgery.hipReplacement = s.hipReplacement;
      }
      if (asked.has("hip_avoid_ask")) {
        const list = s.hipAvoid ?? [];
        if (!list.length) return null;
        surgery.hipAvoid = list.includes("none") ? ["none"] : HIP_AVOID_IDS.filter((id) => list.includes(id));
      }
      if (asked.has("surgery_stretch_ask")) {
        if (!s.stretchAllowed || !s.loadAllowed) return null;
        surgery.stretchAllowed = s.stretchAllowed;
        surgery.loadAllowed = s.loadAllowed;
      }
      out.surgery = surgery;
    }
  }
  if (asked.has("limb_loss_level")) {
    const level = d.limbLoss?.level;
    const limb = limbOf(d.region);
    if (!level || !limb || (d.side !== "left" && d.side !== "right") || !has(LIMB_LOSS_LEVELS[limb], level))
      return null;
    out.limbLoss = { level };
  }
  return out;
}

/* ------------------------------------------------------- the safety answers */

/** The safety questions of RomIntakeFlags (rom-protocol 7.1 copy keys). */
export type RomFlagQuestionId =
  | "bones_ask"
  | "neck_ask"
  | "arthritis_type_ask"
  | "neck_cleared_ask"
  | "transfer_chair_ask"
  | "sit_unsupported_ask"
  | "foot_lift_ask";

export interface RomFlagContext {
  conditions: readonly string[];
  /** The intake mobility answer ("" while unanswered). */
  mobility: string;
  regions: readonly Pick<RegionEntry, "region" | "side" | "problems">[];
  /** The spinal cord injury is at neck level (the condition question): sitting balance is then no without asking. */
  sciNeck?: boolean;
  /** The arthritis type answer so far: neck_cleared_ask follows a yes or not sure. */
  inflammatoryArthritis?: YesNoUnsure;
}

/** The conditions that ask sitting balance (rom-protocol 2.5 seated_forward, review C11). */
const SIT_BALANCE_CONDITIONS = [
  "sci_complete",
  "sci_incomplete",
  "ms",
  "stroke",
  "cerebral_palsy",
  "parkinsons",
];

/** Sitting balance is taken as no without asking (mobility bed, SCI at neck level). */
const sitBalanceNo = (ctx: RomFlagContext) => ctx.mobility === "bed" || ctx.sciNeck === true;

/**
 * The safety questions to ask, in order. bones_ask and neck_ask of everyone: their answers exclude
 * spinal flexion and neck items from every program, besides the forward bend and the neck movements
 * (rom-protocol 6 osteoporosis and neck_caution; exercise-targets osteoporosis_spine, neck_caution).
 * arthritis_type_ask with arthritis, and neck_cleared_ask after its yes or not sure (review A06).
 * transfer_chair_ask of wheelchair users. sit_unsupported_ask with mobility wheelchair or seated, or
 * with SCI, MS, stroke, CP or Parkinson's, never with mobility bed or SCI at neck level (review
 * C11). foot_lift_ask for each side of an ankle and foot with weakness (exercise-targets: the
 * dorsiflexor strengthening of the steppage rule needs it).
 */
export function romFlagQuestions(ctx: RomFlagContext): { id: RomFlagQuestionId; side?: "left" | "right" }[] {
  const out: { id: RomFlagQuestionId; side?: "left" | "right" }[] = [{ id: "bones_ask" }, { id: "neck_ask" }];
  if (ctx.conditions.includes("arthritis")) {
    out.push({ id: "arthritis_type_ask" });
    if (ctx.inflammatoryArthritis === "yes" || ctx.inflammatoryArthritis === "unsure")
      out.push({ id: "neck_cleared_ask" });
  }
  if (ctx.mobility === "wheelchair") out.push({ id: "transfer_chair_ask" });
  const sitAsked =
    ctx.mobility === "wheelchair" ||
    ctx.mobility === "seated" ||
    ctx.conditions.some((c) => SIT_BALANCE_CONDITIONS.includes(c));
  if (sitAsked && !sitBalanceNo(ctx)) out.push({ id: "sit_unsupported_ask" });
  const weakAnkle = (side: "left" | "right") =>
    ctx.regions.some(
      (e) =>
        e.region === "ankle_foot" &&
        (e.side === side || e.side === "both") &&
        e.problems.includes("weakness"),
    );
  for (const side of ["right", "left"] as const) if (weakAnkle(side)) out.push({ id: "foot_lift_ask", side });
  return out;
}

/**
 * The flags a complete set of answers saves, only the asked ones; null while a question has no
 * answer. Sitting balance not asked with mobility bed or SCI at neck level is saved as "no", so the
 * protocol does not need the condition answer, which the intake does not keep.
 */
export function finalizeRomFlags(flags: Partial<RomIntakeFlags>, ctx: RomFlagContext): RomIntakeFlags | null {
  if (typeof flags.osteoporosis !== "boolean" || typeof flags.neckCaution !== "boolean") return null;
  const out: RomIntakeFlags = { osteoporosis: flags.osteoporosis, neckCaution: flags.neckCaution };
  const questions = romFlagQuestions({ ...ctx, inflammatoryArthritis: flags.inflammatoryArthritis });
  for (const q of questions) {
    if (q.id === "arthritis_type_ask") {
      if (!flags.inflammatoryArthritis) return null;
      out.inflammatoryArthritis = flags.inflammatoryArthritis;
    } else if (q.id === "neck_cleared_ask") {
      if (typeof flags.neckCleared !== "boolean") return null;
      out.neckCleared = flags.neckCleared;
    } else if (q.id === "transfer_chair_ask") {
      if (typeof flags.transferChair !== "boolean") return null;
      out.transferChair = flags.transferChair;
    } else if (q.id === "sit_unsupported_ask") {
      if (!flags.sitUnsupported) return null;
      out.sitUnsupported = flags.sitUnsupported;
    } else if (q.id === "foot_lift_ask" && q.side) {
      const answer = flags.footLift?.[q.side];
      if (typeof answer !== "boolean") return null;
      out.footLift = { ...out.footLift, [q.side]: answer };
    }
  }
  if (sitBalanceNo(ctx)) out.sitUnsupported = "no";
  return out;
}
