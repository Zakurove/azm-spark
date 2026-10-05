/**
 * The gait findings (product v7 contract 2.9, stream C, step C3; gait-rules 5 and 6): evaluateGait
 * runs the confidence model (firing, caps, downgrades, corroboration, painDayRule, unilateralRule),
 * the 11 patterns and the 3 support findings, with each pattern's possible reasons, program targets,
 * referral lines and the person's lines. Pure, no DOM: the server runs it at the gait POST
 * (provisional) and again at complete with the final range rows (C-13), and writes the lines again on
 * read (gaitPatternLines), so nothing here depends on client code (C-3).
 *
 * Rules before AI. Every number comes from the runtime data (src/movements/gait/gait-v7.json and, for
 * the program's vocabulary, src/movements/targets/targets-v7.json); the prose rules are written here,
 * each quoting the clinical text it implements, and tests/v7/c-gait-rules.test.ts holds them to the
 * data. Where the clinical text leaves a rule open, the choice is named in a comment with its entry in
 * the contract change log (step C3, C3-n and the gaps CG-7 onwards).
 *
 *   Views and gates   a pattern reads the views of its own list (patterns[].views) that show the right
 *                     body view at 20 fps or more, as one view group: the group passes with 6 clean
 *                     cycles a side over its views together (gait-rules 2.5 «per side and per view
 *                     group»; C3-1), and a limb's kinematics on the pad need its own 6 in the views
 *                     where it was nearest. Their metrics are combined as combineViews does (the near
 *                     limb rule). No view of the list: not assessed, wrong_view; a group short of
 *                     cycles: gate_failed.
 *   Firing (5.0)      a side's median beyond the threshold, and for a sign read cycle by cycle the
 *                     sign in 60% or more of that side's clean cycles (GaitMetricValue.share).
 *   Confidence (5.0)  the cap of the weakest sign (the data's confidenceCap and the grades measured
 *                     today), one level lower for each downgrade, never above the cap; below low the
 *                     rule is not shown (confidence null).
 *   Contributors      possible reasons, never facts («ومن الأسباب الممكنة»), ordered by the history
 *                     (body map, conditions) and the range profile (Pillar 1).
 */
import type {
  GaitAnalysis,
  GaitMetricId,
  GaitMetricValue,
  GaitSetup,
  GaitView,
  GaitViewResult,
  GaitWalkPain,
} from "../engine/gait/types";
import { NEAR_LIMB_METRICS, combineViewMetrics } from "../engine/gait/combine";
import { GAIT_ENGINE } from "../engine/gait/params";
import type {
  Confidence,
  ContributorId,
  GaitDerivedSignId,
  GaitFindingsInput,
  GaitPatternId,
  GaitPatternResult,
  GaitResultFlag,
  GaitStatus,
  GaitSupportFinding,
  NotAssessedReason,
} from "./gait-types";
import type { RegionEntry, RegionId } from "./body-map";
import type { RomProfileEntry } from "./rom-types";
import type { TargetId } from "./target-types";
import type { WalkingAid } from "./plan";
import { GAIT_DATA, GAIT_RULES_VERSION, gaitFinding, gaitPattern } from "../movements/gait";
import {
  GAIT_PATTERN_IDS,
  GAIT_REFERRAL_IDS,
  type GaitCopyTargetKey,
  type GaitGrade,
  type GaitPatternDef,
  type GaitPatternTarget,
  type GaitReferralId,
} from "../movements/gait/types";
import { TARGETS_DATA } from "../movements/targets";
import type { Text } from "../movements/types";

/* ---------------------------------------------------------------- input */

/**
 * What evaluateGait reads: the contract's GaitFindingsInput (2.9), with the walk's setup (CG-7), the
 * pain marked during the walk in the analysis (GaitAnalysis.walkPain, CG-8) and the day's falls and
 * worry answers (today.steadi, CG-9), as D-026 item 7 adds them. The gait route always passes the
 * setup; a caller without one (the acceptance runs on recorded walks) reads the aid and the height
 * from the intake, as C3 did before the setup was passed.
 */
export type GaitRulesInput = Omit<GaitFindingsInput, "setup"> & { setup?: GaitSetup | null };

type Side = "left" | "right";
type ResultSide = GaitPatternResult["side"];
type Evidence = GaitPatternResult["evidence"][number];
type Metrics = Partial<Record<GaitMetricId, GaitMetricValue>>;
type Flag = GaitAnalysis["flags"][number];

/** Results in body order, right before left (as the body map). */
const SIDES: readonly Side[] = ["right", "left"];
const otherSide = (s: Side): Side => (s === "left" ? "right" : "left");

/* --------------------------------------------------------- the numbers */

const CM = GAIT_DATA.confidenceModel;
/** confidenceModel.levels: low, moderate, high. */
const LEVELS: readonly Confidence[] = CM.levels;
/** firing: «sign present in >= 60% of that side's clean cycles» */
const FIRING_SHARE = CM.firingSharePct / 100;
/** «fewer than 10 clean cycles» */
const FULL_CYCLES = CM.downgradeCleanCyclesBelow;
/** painDayRule: «leg, hip or back pain 4 or 5 on the test day» */
const [PAIN_DAY_FROM, PAIN_DAY_TO] = CM.painDayAntalgic;
/** unilateralRule: «an absolute threshold alone counts only at 0.8 m/s or more» */
const UNILATERAL_ABSOLUTE_FROM = CM.unilateralAbsoluteFrom_mps;
/** spasticityOnlyWith: the upper motor neuron conditions. */
const UMN_CONDITIONS: readonly string[] = CM.spasticityOnlyWith;

function num(set: unknown, key: string, where: string): number {
  const v = (set as Record<string, unknown> | null | undefined)?.[key];
  if (typeof v !== "number") throw new Error(`gait data: ${where} has no number ${key}`);
  return v;
}

/** A number inside an `any` or `all` list of a threshold set (stiff_knee). */
function listed(set: unknown, list: "any" | "all", key: string, where: string): number {
  const items = (set as Record<string, unknown> | null | undefined)?.[list];
  const hit = Array.isArray(items) ? items.find((x) => x && typeof x === "object" && key in x) : undefined;
  return num(hit, key, `${where}.${list}`);
}

function sign(id: GaitPatternId, metric: string): GaitPatternDef["signs"][number] {
  const s = gaitPattern(id).signs.find((x) => x.metric === metric || x.id === metric);
  if (!s) throw new Error(`gait data: ${id} has no sign ${metric}`);
  return s;
}

const T = (id: GaitPatternId) => gaitPattern(id).thresholds;

/** The rule numbers of gait-rules 5, read from the data once. */
const N = {
  shorter: {
    possible: num(T("shorter_stance").possible, "sr_single_support_gte", "shorter_stance.possible"),
    likely: num(T("shorter_stance").likely, "sr_single_support_gte", "shorter_stance.likely"),
  },
  trendelenburg: {
    drop: num(T("trendelenburg").possible, "pelvic_drop_gte", "trendelenburg.possible"),
    otherBelow: num(T("trendelenburg").possible, "otherSide_lt", "trendelenburg.possible"),
  },
  duchenne: {
    sway: num(T("duchenne_lean").possible, "trunk_sway_range_gte", "duchenne_lean.possible"),
    swayLikely: num(T("duchenne_lean").likely, "trunk_sway_range_gte", "duchenne_lean.likely"),
    leanShare: num(sign("duchenne_lean", "trunk_lean_peak"), "cyclesPctGte", "duchenne_lean.signs") / 100,
  },
  waddling: {
    drop: num(T("waddling").possible, "pelvic_drop_both_gte", "waddling.possible"),
    sway: num(T("waddling").possible, "trunk_sway_range_gte", "waddling.possible"),
  },
  stiff: {
    peak: listed(T("stiff_knee").possible, "any", "knee_swing_peak_lt", "stiff_knee.possible"),
    diff: listed(T("stiff_knee").possible, "any", "between_limb_diff_gte", "stiff_knee.possible"),
    likelyPeak: listed(T("stiff_knee").likely, "all", "knee_swing_peak_lt", "stiff_knee.likely"),
    likelyDiff: listed(T("stiff_knee").likely, "all", "between_limb_diff_gte", "stiff_knee.likely"),
    bothPeak: num(T("stiff_knee").bilateralLikely, "both_knee_swing_peak_lt", "stiff_knee.bilateralLikely"),
    bothSpeed: num(T("stiff_knee").bilateralLikely, "speed_mps_gte", "stiff_knee.bilateralLikely"),
    bilateralNotAssessedBelow: num(
      T("stiff_knee").speed,
      "bilateralNotAssessedBelow_mps",
      "stiff_knee.speed",
    ),
    cappedBelow: num(T("stiff_knee").speed, "unilateralCappedBelow_mps", "stiff_knee.speed"),
    cappedNeedsDiff: num(T("stiff_knee").speed, "cappedNeedsDiffGte", "stiff_knee.speed"),
    absoluteAloneFrom: num(T("stiff_knee").speed, "absoluteAloneFrom_mps", "stiff_knee.speed"),
    /** Interim (D-027 item 6, CG-19): for every walker the absolute peak alone counts only from here. */
    interimAloneFrom: num(T("stiff_knee").speed, "interimAbsoluteAloneFrom_mps", "stiff_knee.speed"),
  },
  steppage: {
    pitch: num(T("steppage").possible, "foot_pitch_ic_lte", "steppage.possible"),
    thighDiff: num(T("steppage").possible, "thigh_swing_peak_diff_gte", "steppage.possible"),
    likelyShare: num(T("steppage").likely, "possibleCyclesPctGte", "steppage.likely") / 100,
    likelySpeed: num(T("steppage").likely, "speed_mps_gte", "steppage.likely"),
  },
  crouch: {
    possible: num(T("crouch").possible, "knee_stance_min_gte", "crouch.possible"),
    likely: num(T("crouch").likely, "knee_stance_min_gte", "crouch.likely"),
    lack: num(
      gaitPattern("crouch").contributorThresholds?.knee_straighten_limited,
      "gte",
      "crouch.contributorThresholds",
    ),
  },
  recurvatum: {
    possible: num(T("recurvatum").possible, "hyperextension_gte", "recurvatum.possible"),
    likely: num(T("recurvatum").likely, "hyperextension_gte", "recurvatum.likely"),
  },
  quad: {
    peak: num(T("quad_avoidance").possible, "knee_loading_peak_lte", "quad_avoidance.possible"),
    lower: num(T("quad_avoidance").possible, "lowerThanOtherSide_gte", "quad_avoidance.possible"),
    /** Interim (D-027 item 6, CG-19): not assessed below this speed when the sign is seen. */
    interimNotAssessedBelow: num(
      T("quad_avoidance").speed,
      "interimNotAssessedBelow_mps",
      "quad_avoidance.speed",
    ),
  },
  reduced: {
    diff: num(T("reduced_extension").possible, "tla_lower_than_other_gte", "reduced_extension.possible"),
    stepRatio: num(sign("reduced_extension", "sr_step_length"), "gte", "reduced_extension.signs"),
    hipExtBelow: num(sign("reduced_extension", "pillar1_hip_extension"), "lt", "reduced_extension.signs"),
    tightBelow: num(
      gaitPattern("reduced_extension").contributorThresholds?.tight_hip_flexors,
      "lt",
      "reduced_extension.contributorThresholds",
    ),
  },
  short: {
    sdBelow: num(sign("short_steps", "a"), "sdBelowMean", "short_steps.signs.a"),
    belowExpected: num(sign("short_steps", "b"), "belowExpected_m", "short_steps.signs.b"),
    trunkForward: num(sign("short_steps", "s1"), "gte", "short_steps.signs.s1"),
  },
  flat: {
    pitch: num(
      gaitFinding("flat_or_forefoot_contact").thresholds,
      "foot_pitch_ic_lte",
      "flat_or_forefoot_contact",
    ),
    share:
      num(
        gaitFinding("flat_or_forefoot_contact").thresholds,
        "cleanCyclesPctGte",
        "flat_or_forefoot_contact",
      ) / 100,
  },
  slow: { sdBelow: num(gaitFinding("slow_speed").thresholds, "sdBelowMean", "slow_speed") },
  uneven: {
    possible: num(
      gaitFinding("uneven_step_length").thresholds.possible,
      "sr_step_length_gte",
      "uneven_step_length",
    ),
    likely: num(
      gaitFinding("uneven_step_length").thresholds.likely,
      "sr_step_length_gte",
      "uneven_step_length",
    ),
  },
} as const;

/* ------------------------------------------------------------- context */

/** The leg regions and the back: «leg, hip or back» (gait-rules 1.2). */
const LEG_REGIONS: readonly RegionId[] = ["hip", "knee", "ankle_foot"];
const LEG_BACK_REGIONS: readonly RegionId[] = [...LEG_REGIONS, "back_trunk"];
/**
 * Conditions that act on both legs, so they explain a pattern on either side (5.0 downgrade «no
 * listed condition explains it»). C3-6: a one sided condition (stroke, one sided cerebral palsy, limb
 * loss) explains its side through the body map, which the condition questions fill (rom-protocol 2.3).
 */
const BOTH_LEG_CONDITIONS: readonly string[] = [
  "parkinsons",
  "ms",
  "cerebral_palsy",
  "sci_complete",
  "sci_incomplete",
];

interface Group {
  /** The analysis's views in the pattern's list. */
  inViews: GaitViewResult[];
  /** Of those, the ones read: the right body view at 20 fps or more, when the group passed its gate. */
  passed: GaitViewResult[];
  metrics: Metrics;
  /** wrong_view or gate_failed when no view can be read. */
  reason: NotAssessedReason | null;
}

interface Ctx {
  analysis: GaitAnalysis;
  intake: GaitFindingsInput["intake"];
  regions: RegionEntry[];
  rom: GaitFindingsInput["romProfile"];
  painByRegion: Partial<Record<RegionId, number>>;
  setup: GaitSetup | null;
  walkPain: GaitWalkPain[];
  steadi: { fell: boolean; worry: boolean } | null;
  pad: boolean;
  flags: ReadonlySet<Flag>;
  /** painDayRule: leg, hip or back pain 4 or 5 today. */
  painDay: boolean;
  height: number | null;
  aid: WalkingAid | "none";
  umn: boolean;
  parkinsons: boolean;
  /** unilateralRule: the body map's leg regions all on one side. */
  oneSided: boolean;
  /** The walking speed of the side views that passed (the belt speed on the pad), or null. */
  speed: number | null;
  groups: Map<string, Group>;
}

function groupOf(c: Ctx, views: readonly GaitView[]): Group {
  const key = [...views].sort().join(",");
  const known = c.groups.get(key);
  if (known) return known;
  const inViews = c.analysis.views.filter((v) => views.includes(v.view));
  const rightView = inViews.filter((v) => !v.quality.issues.includes("wrong_view"));
  // «under 20 fps: record again» (C1-16): such a view gives nothing to read.
  const usable = rightView.filter((v) => v.quality.medianFps >= GAIT_ENGINE.recordAgainBelowFps);
  const cycles = (s: Side, vs: readonly GaitViewResult[]) =>
    vs.reduce((n, v) => n + v.quality.cleanCycles[s], 0);
  const enough = (s: Side, vs: readonly GaitViewResult[]) => cycles(s, vs) >= GAIT_ENGINE.cleanCyclesPerSide;
  // C3-1: the toward and away passes are one group (each pass's steady cycle can fall on one side).
  const passed = usable.length && SIDES.every((s) => enough(s, usable)) ? usable : [];
  const reason: NotAssessedReason | null = !rightView.length
    ? "wrong_view"
    : !passed.length
      ? "gate_failed"
      : null;
  const metrics = combineViewMetrics(passed);
  // The near limb rule's own gate: a limb's kinematics need its clean cycles in the views where it was
  // nearest the phone (a pad side view of the other side gives the far limb none).
  for (const id of NEAR_LIMB_METRICS) {
    const m = metrics[id];
    if (!m) continue;
    for (const s of SIDES)
      if (
        !enough(
          s,
          passed.filter((v) => v.view !== "pad_side" || v.nearSide === s),
        )
      ) {
        if (m.sides) m.sides[s] = null;
        if (m.share) m.share[s] = null;
      }
  }
  const g: Group = { inViews, passed, metrics, reason };
  c.groups.set(key, g);
  return g;
}

/** Whether a body map entry covers a side of a limb region (both covers each; the axial back covers either). */
const covers = (e: RegionEntry, side: Side) => e.side === side || e.side === "both" || e.side === "axial";

function entriesOn(c: Ctx, regions: readonly RegionId[], side: Side): RegionEntry[] {
  return c.regions.filter((e) => regions.includes(e.region) && covers(e, side));
}

/** Pain in a region of the body map on a side (the history; gait-rules contributorRules «pain area hip on S»). */
const painIn = (c: Ctx, region: RegionId, side: Side) =>
  entriesOn(c, [region], side).some((e) => e.problems.includes("pain"));

/** A leg prosthesis on a side: a limb loss at or above the knee, or the setup's prosthesis side. */
function prosthesisOn(c: Ctx, side: Side): boolean {
  if (c.setup?.prosthesis === side) return true;
  return c.regions.some(
    (e) =>
      e.side === side &&
      e.problems.includes("limb_loss") &&
      (e.limbLoss?.level === "below_knee" || e.limbLoss?.level === "above_knee"),
  );
}

/** «a knee orthosis (KAFO or a locked brace) on S» (gait-rules 1.2, review A14). */
const kneeOrthosisOn = (c: Ctx, side: Side) => {
  const o = c.setup?.orthosis[side];
  return o === "kafo" || o === "knee_brace";
};
/** C3-5: an ankle foot orthosis on S; a KAFO holds the ankle and foot too. */
const ankleFootOrthosisOn = (c: Ctx, side: Side) => {
  const o = c.setup?.orthosis[side];
  return o === "afo" || o === "kafo";
};

/**
 * The antalgic label's pain (5.1 «pain area on side P in pc_pain_areas, or mark_pain during the walk
 * on side P»): today's score above 0 in a leg region the body map holds on that side, or in the back
 * (C3-3: the back has no side, so its pain counts for either), or pain marked on that side.
 */
function painTodayOn(c: Ctx, side: Side): boolean {
  const scored = (r: RegionId) => (c.painByRegion[r] ?? 0) > 0;
  if (LEG_REGIONS.some((r) => scored(r) && entriesOn(c, [r], side).length > 0)) return true;
  if (scored("back_trunk")) return true;
  return c.walkPain.some((p) => p.side === side && p.level > 0);
}

/** 5.0 downgrade: «the side is not an affected region in the history and no listed condition explains it». */
function affected(c: Ctx, side: Side): boolean {
  if (entriesOn(c, LEG_BACK_REGIONS, side).length) return true;
  return c.intake.conditions.some((x) => BOTH_LEG_CONDITIONS.includes(x));
}

function romEntry(c: Ctx, movement: string, side: Side): RomProfileEntry | undefined {
  return c.rom?.entries.find((e) => e.movementId === movement && e.side === side && e.source === "measured");
}

/**
 * Pillar 1 «limited» (C3-7): a measured movement graded mild or marked. A measurement within normal
 * rules the reason out; a pain limited or ungraded one, or none yet, leaves it open.
 */
function pillar(c: Ctx, movement: string, side: Side): "limited" | "within" | "unknown" {
  const e = romEntry(c, movement, side);
  if (!e) return "unknown";
  if (e.finding === "mild" || e.finding === "marked") return "limited";
  return e.finding === "within" ? "within" : "unknown";
}

function measured(c: Ctx, movement: string, side: Side): number | null {
  const v = romEntry(c, movement, side)?.value;
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
}

function contextOf(input: GaitRulesInput): Ctx {
  const intake = input.intake;
  const regions = intake.regions ?? [];
  const painByRegion = input.today.painByRegion ?? {};
  const legPain = Math.max(0, ...LEG_BACK_REGIONS.map((r) => painByRegion[r] ?? 0));
  const walking = intake.walking;
  const legSides = new Set(regions.filter((e) => LEG_REGIONS.includes(e.region)).map((e) => e.side));
  const c: Ctx = {
    analysis: input.analysis,
    intake,
    regions,
    rom: input.romProfile,
    painByRegion,
    setup: input.setup ?? null,
    walkPain: input.analysis.walkPain ?? [],
    steadi: input.today.steadi ?? null,
    pad: input.analysis.mode === "walking_pad",
    flags: new Set(input.analysis.flags),
    painDay: input.plan.antalgicOnly || (legPain >= PAIN_DAY_FROM && legPain <= PAIN_DAY_TO),
    height: input.setup?.heightCm ?? intake.heightCm ?? null,
    aid: input.setup?.aid ?? (walking?.status === "with_aid" ? walking.aid : "none"),
    umn: intake.conditions.some((x) => UMN_CONDITIONS.includes(x)),
    parkinsons: intake.conditions.includes("parkinsons"),
    // C3-8: one sided when every leg entry of the body map sits on the same one side.
    oneSided: legSides.size === 1 && (legSides.has("left") || legSides.has("right")),
    speed: null,
    groups: new Map(),
  };
  const sideViews = groupOf(c, ["side", "pad_side"]);
  const speed = sideViews.metrics.speed_mps?.value;
  c.speed = speed === null || speed === undefined || !Number.isFinite(speed) ? null : speed;
  return c;
}

/* ------------------------------------------------------------- signs */

const sideOf = (m: GaitMetricValue | undefined, side: Side): number | null => {
  const v = m?.sides?.[side];
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
};
const shareOf = (m: GaitMetricValue | undefined, side: Side): number | null => m?.share?.[side] ?? null;
const valueOf = (m: GaitMetricValue | undefined): number | null => {
  const v = m?.value;
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
};
/** «sign present in >= 60% of that side's clean cycles» */
const present = (m: GaitMetricValue | undefined, side: Side, at = FIRING_SHARE) =>
  (shareOf(m, side) ?? -1) >= at;

const ev = (
  metric: GaitMetricId | GaitDerivedSignId,
  side: Side | undefined,
  value: number,
  threshold: number,
  share: number | null = null,
): Evidence => ({ metric, ...(side ? { side } : {}), value, threshold, share });

/* ----------------------------------------------------------- results */

/** A result before its confidence, reasons, targets and lines. */
interface Draft {
  pattern: GaitPatternId;
  label: string;
  side: ResultSide;
  status: GaitStatus;
  notAssessed?: NotAssessedReason;
  /** What the result was read against (CG-16): norm_interim for the age and sex norms of 4.1. */
  flags?: GaitResultFlag[];
  evidence: Evidence[];
  /** The views it read (the clean cycle and frame rate downgrades). */
  views: GaitViewResult[];
  /** The grades of the signs it read today. */
  grades: GaitGrade[];
  /** Not shown whatever its confidence: the pain day rule, or a lean that is part of the sway (C3-4). */
  hidden: boolean;
}

const notAssessed = (
  pattern: GaitPatternId,
  reason: NotAssessedReason,
  side: ResultSide = "none",
): Draft => ({
  pattern,
  label: pattern,
  side,
  status: "not_assessed",
  notAssessed: reason,
  evidence: [],
  views: [],
  grades: [],
  hidden: false,
});
const notSeen = (pattern: GaitPatternId): Draft => ({
  pattern,
  label: pattern,
  side: "none",
  status: "not_seen",
  evidence: [],
  views: [],
  grades: [],
  hidden: false,
});

/** A side's outcome: fired, not seen, not assessed with a reason, or no value for that side. */
type SideOutcome =
  | { kind: "fired"; status: "possible" | "likely"; evidence: Evidence[]; grades: GaitGrade[] }
  | { kind: "not_seen" }
  | { kind: "not_assessed"; reason: NotAssessedReason }
  | { kind: "no_data" };

/** The views of a group a side's sign is read from (the near limb rule on the pad). */
function viewsFor(g: Group, side: Side, nearLimb: boolean): GaitViewResult[] {
  return g.passed.filter((v) => !nearLimb || v.view !== "pad_side" || v.nearSide === side);
}

/**
 * One result per side that fired or was not assessed for its own reason, then one "not seen" result
 * when nothing fired; with no value on either side the group gave nothing to read (gate_failed).
 */
function perSide(
  pattern: GaitPatternId,
  g: Group,
  nearLimb: boolean,
  outcome: (side: Side) => SideOutcome,
  label: (side: Side) => string = () => pattern,
): Draft[] {
  const out: Draft[] = [];
  const kinds = SIDES.map((side) => ({ side, o: outcome(side) }));
  for (const { side, o } of kinds) {
    if (o.kind === "fired")
      out.push({
        pattern,
        label: label(side),
        side,
        status: o.status,
        evidence: o.evidence,
        views: viewsFor(g, side, nearLimb),
        grades: o.grades,
        hidden: false,
      });
    else if (o.kind === "not_assessed") out.push(notAssessed(pattern, o.reason, side));
  }
  // The same reason on both sides is one result for the walk.
  const na = out.filter((d) => d.status === "not_assessed");
  if (na.length === 2 && na[0].notAssessed === na[1].notAssessed && out.length === 2)
    return [notAssessed(pattern, na[0].notAssessed!)];
  if (!out.some((d) => d.status === "possible" || d.status === "likely")) {
    if (kinds.some((k) => k.o.kind === "not_seen")) out.push(notSeen(pattern));
    else if (!out.length) out.push(notAssessed(pattern, "gate_failed"));
  }
  return out;
}

/** Light touch on the handrail caps every rule at possible (5.0, review B12). */
const lightTouch = (c: Ctx) => c.pad && c.flags.has("handrail_light");
const firmHold = (c: Ctx) => c.pad && c.flags.has("handrail_firm");
/** A single pad side view caps every between limb rule at possible (far_limb, review A15). */
const farLimb = (c: Ctx) => c.pad && c.flags.has("far_limb");

const cap = (status: "possible" | "likely", capped: boolean): "possible" | "likely" =>
  capped ? "possible" : status;

/**
 * The speed rules of a kinematic sign read on its own (5.5 and 5.0 unilateralRule): the reason the
 * absolute threshold alone does not count at this speed, or null when it counts. An unknown speed
 * (overground without the person's height) is read as too slow, with its own reason.
 */
function absoluteAloneBlocked(c: Ctx, minSpeed: number): NotAssessedReason | null {
  if (c.speed === null) return "no_height";
  return c.speed < minSpeed ? "slow_speed" : null;
}

/* ------------------------------------------------------ 5.1 to 5.11 */

/** 5.1 Shorter stance on one side: antalgic, prosthetic side, or short stance. */
function shorterStance(c: Ctx): Draft[] {
  const id: GaitPatternId = "shorter_stance";
  const g = groupOf(c, gaitPattern(id).views);
  if (g.reason) return [notAssessed(id, g.reason)];
  const m = g.metrics.sr_single_support;
  const ratio = valueOf(m);
  const l = sideOf(m, "left");
  const r = sideOf(m, "right");
  if (ratio === null || l === null || r === null) return [notAssessed(id, "gate_failed")];
  // The short single support side P (its median over the other's below 1).
  const p: Side = l < r ? "left" : "right";
  if (l === r || ratio < N.shorter.possible) return [notSeen(id)];
  const status = cap(
    ratio >= N.shorter.likely ? "likely" : "possible",
    // caps: handrailHeld, lightTouch, singlePadSideView.
    lightTouch(c) || firmHold(c) || farLimb(c),
  );
  // labelRule: prosthetic_side when P has a leg prosthesis; withPain with pain on P; else withoutPain.
  const pain = painTodayOn(c, p);
  const labels = gaitPattern(id).labels!;
  let label = prosthesisOn(c, p) ? labels.prostheticSide : pain ? labels.withPain : labels.withoutPain;
  let hidden = false;
  // «Pain 4 or 5 on the test day: antalgic only» (C3-2: no other label shows that day).
  if (c.painDay) {
    if (pain) label = labels.withPain;
    else hidden = true;
  }
  return [
    {
      pattern: id,
      label,
      side: p,
      status,
      evidence: [
        ev("sr_single_support", p, ratio, status === "likely" ? N.shorter.likely : N.shorter.possible),
      ],
      views: g.passed,
      grades: m ? [m.grade] : [],
      hidden,
    },
  ];
}

/** Duchenne lean on a side: the sway at a threshold and the peak lean toward that side in 60% of cycles. */
function leanOn(g: Group, side: Side, sway: number): boolean {
  const s = g.metrics.trunk_sway_range;
  const v = sideOf(s, side);
  return (
    v !== null &&
    v >= sway &&
    present(s, side) &&
    present(g.metrics.trunk_lean_peak, side, N.duchenne.leanShare)
  );
}

/** 5.2 Hip dip on the swing side (Trendelenburg). */
function trendelenburg(c: Ctx): Draft[] {
  const id: GaitPatternId = "trendelenburg";
  // «Not assessed: firm handrail hold on the pad (handrail_held)».
  if (firmHold(c)) return [notAssessed(id, "handrail_held")];
  const g = groupOf(c, gaitPattern(id).views);
  if (g.reason) return [notAssessed(id, g.reason)];
  const drop = g.metrics.pelvic_drop;
  return perSide(id, g, false, (s) => {
    const d = sideOf(drop, s);
    const o = sideOf(drop, otherSide(s));
    if (d === null) return { kind: "no_data" };
    // Possible: «pelvic_drop_gte 10, otherSide_lt 10»; both sides 10 or more is waddling (5.4).
    if (!(d >= N.trendelenburg.drop && present(drop, s) && o !== null && o < N.trendelenburg.otherBelow))
      return { kind: "not_seen" };
    const evidence = [
      ev("pelvic_drop", s, d, N.trendelenburg.drop, shareOf(drop, s)),
      ev("pelvic_drop", otherSide(s), o, N.trendelenburg.otherBelow, shareOf(drop, otherSide(s))),
    ];
    // Likely in the data: «possible AND the static single leg stance drop on S AND trunk lean toward
    // S at the duchenne_lean possible threshold». CG-10: the static drop has no number of its own (the
    // placeholder reads the walking drop's, pelvic_drop_gte), so it is a value only and never raises
    // Trendelenburg until its threshold is tuned (D-026 item 7; D-024 item 3: «Trendelenburg stays
    // possible at most»): with the static drop and the lean the status stays possible, the two kept
    // as evidence.
    const st = c.analysis.staticStance.find((x) => x.side === s && x.ok && x.pelvicDropDeg !== null);
    const staticDrop = st !== undefined && st.pelvicDropDeg! >= N.trendelenburg.drop;
    const lean = leanOn(g, s, N.duchenne.sway);
    const withStatic = staticDrop && lean;
    if (withStatic)
      evidence.push(
        ev("static_pelvic_drop", s, st!.pelvicDropDeg!, N.trendelenburg.drop),
        ev(
          "trunk_sway_range",
          s,
          sideOf(g.metrics.trunk_sway_range, s)!,
          N.duchenne.sway,
          shareOf(g.metrics.trunk_sway_range, s),
        ),
        ev(
          "trunk_lean_peak",
          s,
          sideOf(g.metrics.trunk_lean_peak, s) ?? 0,
          0,
          shareOf(g.metrics.trunk_lean_peak, s),
        ),
      );
    return {
      kind: "fired",
      status: cap("possible", lightTouch(c)),
      evidence,
      grades: [drop!.grade, ...(withStatic ? [g.metrics.trunk_sway_range!.grade] : [])],
    };
  });
}

/** 5.3 Trunk lean over the stance leg (Duchenne, compensated). */
function duchenne(c: Ctx): Draft[] {
  const id: GaitPatternId = "duchenne_lean";
  // «Not assessed: walker; handrail_held (firm hold on the pad)».
  if (c.aid === "walker") return [notAssessed(id, "aid_or_orthosis")];
  if (firmHold(c)) return [notAssessed(id, "handrail_held")];
  const g = groupOf(c, gaitPattern(id).views);
  if (g.reason) return [notAssessed(id, g.reason)];
  const sway = g.metrics.trunk_sway_range;
  const lean = g.metrics.trunk_lean_peak;
  return perSide(id, g, false, (s) => {
    const v = sideOf(sway, s);
    if (v === null) return { kind: "no_data" };
    if (!leanOn(g, s, N.duchenne.sway)) return { kind: "not_seen" };
    const isLikely = v >= N.duchenne.swayLikely;
    return {
      kind: "fired",
      // caps: «cane: possible, lightTouch: possible».
      status: cap(isLikely ? "likely" : "possible", c.aid === "cane" || lightTouch(c)),
      evidence: [
        ev("trunk_sway_range", s, v, isLikely ? N.duchenne.swayLikely : N.duchenne.sway, shareOf(sway, s)),
        ev("trunk_lean_peak", s, sideOf(lean, s) ?? 0, 0, shareOf(lean, s)),
      ],
      grades: [sway!.grade, ...(lean ? [lean.grade] : [])],
    };
  });
}

/** 5.4 Side to side sway on both sides (waddling): possible only. */
function waddling(c: Ctx): Draft[] {
  const id: GaitPatternId = "waddling";
  if (firmHold(c)) return [notAssessed(id, "handrail_held")];
  const g = groupOf(c, gaitPattern(id).views);
  if (g.reason) return [notAssessed(id, g.reason)];
  const drop = g.metrics.pelvic_drop;
  const sway = g.metrics.trunk_sway_range;
  const l = sideOf(drop, "left");
  const r = sideOf(drop, "right");
  const range = valueOf(sway);
  if (l === null || r === null || range === null) return [notAssessed(id, "gate_failed")];
  const bothDrop =
    l >= N.waddling.drop && r >= N.waddling.drop && present(drop, "left") && present(drop, "right");
  // «trunk_sway_range >= 11 without a one sided peak»: not a lean toward one side only.
  const leanSides = SIDES.filter((s) => present(g.metrics.trunk_lean_peak, s, N.duchenne.leanShare));
  if (!bothDrop || range < N.waddling.sway || leanSides.length === 1) return [notSeen(id)];
  return [
    {
      pattern: id,
      label: id,
      side: "both",
      status: "possible",
      evidence: [
        ev("pelvic_drop", "right", r, N.waddling.drop, shareOf(drop, "right")),
        ev("pelvic_drop", "left", l, N.waddling.drop, shareOf(drop, "left")),
        ev("trunk_sway_range", undefined, range, N.waddling.sway),
      ],
      views: g.passed,
      grades: [drop!.grade, sway!.grade],
      hidden: false,
    },
  ];
}

/** 5.5 Stiff knee in swing. */
function stiffKnee(c: Ctx): Draft[] {
  const id: GaitPatternId = "stiff_knee";
  const def = gaitPattern(id);
  const g = groupOf(c, def.views);
  if (g.reason) return [notAssessed(id, g.reason)];
  const m = g.metrics.knee_swing_peak;
  // «Not assessed: prosthetic side; a knee orthosis (KAFO or a locked brace) on S».
  const blocked = (s: Side): NotAssessedReason | null =>
    prosthesisOn(c, s) ? "prosthetic_side" : kneeOrthosisOn(c, s) ? "knee_orthosis_on_S" : null;
  const peakOf = (s: Side) => (blocked(s) ? null : sideOf(m, s));
  const low = (s: Side, at: number) => {
    const v = peakOf(s);
    return v !== null && v < at && present(m, s);
  };
  // «Both knees under 40 -> bilateral stiff knee, likely, only at 0.6 m/s or more (below:
  // not_assessed, slow_speed)»; both knees under 45: the bilateral form, possible (C3-9).
  const bothLow = low("left", N.stiff.peak) && low("right", N.stiff.peak);
  if (bothLow) {
    const slow =
      c.speed === null ? "no_height" : c.speed < N.stiff.bilateralNotAssessedBelow ? "slow_speed" : null;
    if (slow) return [{ ...notAssessed(id, slow, "both"), label: def.bilateralId! }];
    const isLikely =
      low("left", N.stiff.bothPeak) && low("right", N.stiff.bothPeak) && c.speed! >= N.stiff.bothSpeed;
    const at = isLikely ? N.stiff.bothPeak : N.stiff.peak;
    return [
      {
        pattern: id,
        label: def.bilateralId!,
        side: "both",
        status: cap(isLikely ? "likely" : "possible", lightTouch(c) || farLimb(c)),
        evidence: SIDES.map((s) => ev("knee_swing_peak", s, sideOf(m, s)!, at, shareOf(m, s))),
        views: g.passed,
        grades: [m!.grade],
        hidden: false,
      },
    ];
  }
  return perSide(id, g, true, (s) => {
    const why = blocked(s);
    if (why) return { kind: "not_assessed", reason: why };
    const peak = sideOf(m, s);
    if (peak === null) return { kind: "no_data" };
    const other = peakOf(otherSide(s));
    const diff = other === null ? null : other - peak;
    const absolute = low(s, N.stiff.peak);
    const between = diff !== null && diff >= N.stiff.diff;
    // «Below 0.5 m/s a one sided stiff knee is capped at possible and needs a between limb difference
    // of 15 or more»; «in a one sided condition the absolute peak alone counts only at 0.8 m/s or more»;
    // interim (D-027 item 6, CG-19): «for every walker the absolute peak alone counts only at >= 1.0
    // m/s; under it the pattern needs the between limb difference».
    const capped = c.speed === null || c.speed < N.stiff.cappedBelow;
    const aloneBlocked =
      absoluteAloneBlocked(c, Math.max(N.stiff.cappedBelow, N.stiff.interimAloneFrom)) ??
      (c.oneSided
        ? absoluteAloneBlocked(c, Math.max(N.stiff.absoluteAloneFrom, UNILATERAL_ABSOLUTE_FROM))
        : null);
    const needDiff = capped ? Math.max(N.stiff.diff, N.stiff.cappedNeedsDiff) : N.stiff.diff;
    const byDiff = diff !== null && diff >= needDiff;
    if (!(absolute && !aloneBlocked) && !byDiff) {
      if (absolute && aloneBlocked) return { kind: "not_assessed", reason: aloneBlocked };
      return { kind: "not_seen" };
    }
    const isLikely = !capped && low(s, N.stiff.likelyPeak) && diff !== null && diff >= N.stiff.likelyDiff;
    const evidence = [
      ...(absolute
        ? [ev("knee_swing_peak", s, peak, isLikely ? N.stiff.likelyPeak : N.stiff.peak, shareOf(m, s))]
        : []),
      ...(diff !== null && (between || isLikely)
        ? [
            ev(
              "knee_swing_peak_between_limb_diff",
              s,
              Math.round(diff * 1000) / 1000,
              isLikely ? N.stiff.likelyDiff : needDiff,
            ),
          ]
        : []),
    ];
    return {
      kind: "fired",
      status: cap(isLikely ? "likely" : "possible", capped || lightTouch(c) || farLimb(c)),
      evidence,
      grades: [m!.grade],
    };
  });
}

/** 5.7 Knee stays bent in stance (crouch; one side: knee_stays_bent). */
function crouch(c: Ctx): Draft[] {
  const id: GaitPatternId = "crouch";
  const def = gaitPattern(id);
  const g = groupOf(c, def.views);
  if (g.reason) return [notAssessed(id, g.reason)];
  const m = g.metrics.knee_stance_min;
  const outcome = (s: Side): SideOutcome => {
    if (prosthesisOn(c, s)) return { kind: "not_assessed", reason: "prosthetic_side" };
    const v = sideOf(m, s);
    if (v === null) return { kind: "no_data" };
    if (!(v >= N.crouch.possible && present(m, s))) return { kind: "not_seen" };
    // unilateralRule: no between limb difference is defined for this rule (CG-11), so in a one sided
    // condition the bent knee counts only at 0.8 m/s or more.
    const blocked = c.oneSided ? absoluteAloneBlocked(c, UNILATERAL_ABSOLUTE_FROM) : null;
    if (blocked) return { kind: "not_assessed", reason: blocked };
    const isLikely = v >= N.crouch.likely;
    return {
      kind: "fired",
      status: cap(isLikely ? "likely" : "possible", lightTouch(c)),
      evidence: [ev("knee_stance_min", s, v, isLikely ? N.crouch.likely : N.crouch.possible, shareOf(m, s))],
      grades: [m!.grade],
    };
  };
  const outcomes = SIDES.map(outcome);
  const firedBoth = outcomes.every((o) => o.kind === "fired");
  if (firedBoth) {
    // «Both sides -> crouch»: likely when both are.
    const both = outcomes as Extract<SideOutcome, { kind: "fired" }>[];
    return [
      {
        pattern: id,
        label: id,
        side: "both",
        status: both.every((o) => o.status === "likely") ? "likely" : "possible",
        evidence: both.flatMap((o) => o.evidence),
        views: g.passed,
        grades: [m!.grade],
        hidden: false,
      },
    ];
  }
  return perSide(
    id,
    g,
    true,
    (s) => outcomes[SIDES.indexOf(s)],
    () => def.unilateralId!,
  );
}

/** 5.8 Knee bends backwards in stance (recurvatum). */
function recurvatum(c: Ctx): Draft[] {
  const id: GaitPatternId = "recurvatum";
  const g = groupOf(c, gaitPattern(id).views);
  if (g.reason) return [notAssessed(id, g.reason)];
  const m = g.metrics.knee_stance_min;
  return perSide(id, g, true, (s) => {
    if (prosthesisOn(c, s)) return { kind: "not_assessed", reason: "prosthetic_side" };
    const v = sideOf(m, s);
    if (v === null) return { kind: "no_data" };
    const hyper = -v;
    // «knee_stance_min negative (past straight)», at «hyperextension_gte 10».
    if (!(v < 0 && hyper >= N.recurvatum.possible && present(m, s))) return { kind: "not_seen" };
    const blocked = c.oneSided ? absoluteAloneBlocked(c, UNILATERAL_ABSOLUTE_FROM) : null;
    if (blocked) return { kind: "not_assessed", reason: blocked };
    const isLikely = hyper >= N.recurvatum.likely;
    return {
      kind: "fired",
      status: cap(isLikely ? "likely" : "possible", lightTouch(c)),
      evidence: [
        ev("knee_stance_min", s, v, -(isLikely ? N.recurvatum.likely : N.recurvatum.possible), shareOf(m, s)),
      ],
      grades: [m!.grade],
    };
  });
}

/** 5.9 Straight knee at landing (quadriceps avoidance): possible only. */
function quadAvoidance(c: Ctx): Draft[] {
  const id: GaitPatternId = "quad_avoidance";
  const g = groupOf(c, gaitPattern(id).views);
  if (g.reason) return [notAssessed(id, g.reason)];
  const m = g.metrics.knee_loading_peak;
  return perSide(id, g, true, (s) => {
    // gait-rules 5.14: «knee rules skip the prosthetic side».
    if (prosthesisOn(c, s)) return { kind: "not_assessed", reason: "prosthetic_side" };
    const v = sideOf(m, s);
    if (v === null) return { kind: "no_data" };
    const o = prosthesisOn(c, otherSide(s)) ? null : sideOf(m, otherSide(s));
    // «knee_loading_peak on S 5 or less and 10 or more below the other side».
    if (!(v <= N.quad.peak && present(m, s) && o !== null && o - v >= N.quad.lower))
      return { kind: "not_seen" };
    // Interim (D-027 item 6, CG-19): «not assessed below 0.5 m/s (slow_speed) when the sign is seen,
    // like stiff knee's speed rule; an unknown speed reads as too slow (no_height)».
    const slow = absoluteAloneBlocked(c, N.quad.interimNotAssessedBelow);
    if (slow) return { kind: "not_assessed", reason: slow };
    return {
      kind: "fired",
      status: "possible",
      evidence: [
        ev("knee_loading_peak", s, v, N.quad.peak, shareOf(m, s)),
        ev("knee_loading_peak", otherSide(s), o, v + N.quad.lower),
      ],
      grades: [m!.grade],
    };
  });
}

/** 5.10 Leg does not reach behind (reduced terminal stance extension). */
function reducedExtension(c: Ctx): Draft[] {
  const id: GaitPatternId = "reduced_extension";
  const g = groupOf(c, gaitPattern(id).views);
  if (g.reason) return [notAssessed(id, g.reason)];
  const m = g.metrics.tla_peak;
  const steps = g.metrics.sr_step_length;
  return perSide(id, g, true, (s) => {
    const v = sideOf(m, s);
    if (v === null) return { kind: "no_data" };
    const o = sideOf(m, otherSide(s));
    // «tla_peak on S lower than the other side by 8 or more» (the bilateral form is off).
    if (o === null || o - v < N.reduced.diff) return { kind: "not_seen" };
    const evidence = [ev("tla_peak", s, v, o - N.reduced.diff)];
    // Likely needs one corroboration: the other leg's step shorter (sr_step_length 1.13 or more with
    // the short step on the other side), or the Pillar 1 thigh below the trunk line on S.
    const ratio = valueOf(steps);
    const shortOther =
      ratio !== null && ratio >= N.reduced.stepRatio && (sideOf(steps, otherSide(s)) ?? 1) < 1;
    if (shortOther) evidence.push(ev("sr_step_length", otherSide(s), ratio!, N.reduced.stepRatio));
    const hip = measured(c, "hip_extension", s);
    const thigh = hip !== null && hip < N.reduced.hipExtBelow;
    if (thigh) evidence.push(ev("pillar1_hip_extension", s, hip!, N.reduced.hipExtBelow));
    return {
      kind: "fired",
      // caps: «pad: possible»; light touch; one pad side view.
      status: cap(shortOther || thigh ? "likely" : "possible", c.pad || lightTouch(c) || farLimb(c)),
      evidence,
      grades: [m!.grade],
    };
  });
}

/** Fang 2018 (20 to 69, ages 18 and 19 as 20 to 29) or Hollman 2011 (70 and over) for the person. */
function norm(c: Ctx) {
  const sex = c.intake.sex === "male" ? "M" : c.intake.sex === "female" ? "W" : null;
  if (!sex) return null;
  const n = GAIT_DATA.norms;
  const age = c.intake.age;
  if (age >= n.lookupAges.hollman11From) {
    const b = n.hollman11.bands.find(
      (x) => x.sex === sex && age >= x.ageMin && (x.ageMax === null || age <= x.ageMax),
    );
    if (!b) return null;
    // Hollman 2011 reports no height: its values are not adjusted (gait-rules 4.1).
    return {
      step: { mean: b.step_cm.mean / 100, sd: b.step_cm.sd / 100 },
      cadence: b.cadence.mean,
      speed: { mean: b.speed_cmps.mean / 100, sd: b.speed_cmps.sd / 100 },
    };
  }
  const use = n.lookupAges.youngest.includes(age) ? n.lookupAges.youngestUse[0] : age;
  const b = n.fang18.bands.find((x) => x.sex === sex && use >= x.ageMin && use <= x.ageMax);
  if (!b) return null;
  // «speed × √(H / Hmean), stride × (H / Hmean), cadence ÷ √(H / Hmean)»; without the height the sex
  // mean height norm (5.11 «Without height: (a) uses the sex mean height norm»).
  const h = c.height === null ? 1 : c.height / n.fang18.normalisation.meanHeight_cm[sex];
  // CG-12: Fang gives the step as stride ÷ 2 with no SD; a step's mean and SD are its stride's halved.
  return {
    step: { mean: (b.stride_m.mean / 2) * h, sd: (b.stride_m.sd / 2) * h },
    cadence: b.cadence.mean / Math.sqrt(h),
    speed: { mean: b.speed_mps.mean * Math.sqrt(h), sd: b.speed_mps.sd * Math.sqrt(h) },
  };
}

/** 5.11 Short steps for speed and age (shuffling): both sides. */
function shortSteps(c: Ctx): Draft[] {
  const id: GaitPatternId = "short_steps";
  const g = groupOf(c, gaitPattern(id).views);
  if (g.reason) return [notAssessed(id, g.reason)];
  const step = g.metrics.step_length_m;
  const stride = g.metrics.stride_length_m;
  const cad = g.metrics.cadence;
  const nm = norm(c);
  const stepV = valueOf(step);
  const strideV = valueOf(stride);
  const cadV = valueOf(cad);
  // Overground without the height there are no metres (3.5, C1-18): neither (a) nor (b) can run.
  if (!c.pad && (c.height === null || (stepV === null && strideV === null)))
    return [notAssessed(id, "no_height")];
  // (a) «step_length_m below the age and sex mean − 2 SD (height adjusted)».
  const aAt = nm ? nm.step.mean - N.short.sdBelow * nm.step.sd : null;
  const a = stepV !== null && aAt !== null && stepV < aAt;
  // (b) «stride length below the Mikos expected value for the speed and height by more than 0.136 m».
  const mk = GAIT_DATA.scaling.speedMatched.strideLength_m;
  const bAt =
    c.height !== null && c.speed !== null
      ? mk.intercept + mk.speed * c.speed + mk.height_cm * c.height - N.short.belowExpected
      : null;
  const b = strideV !== null && bAt !== null && strideV < bAt;
  // (c) «cadence at or above the age and sex mean».
  const cc = cadV !== null && nm !== null && cadV >= nm.cadence;
  // CG-16 (D-026 item 7): (a) and (c) read the age and sex norms of 4.1, which under call below 70 until
  // the steady state tables are retrieved (review B10, GAIT-Q11), and they decide the result, so every
  // result read with a norm carries norm_interim (the person's view adds the approximate label).
  const flags: GaitResultFlag[] | undefined = nm ? ["norm_interim"] : undefined;
  // Possible: (b), or (a) and (c) only when the height is missing; likely: all three.
  const isPossible = b || (c.height === null && a && cc);
  if (!isPossible) return [{ ...notSeen(id), ...(flags ? { flags } : {}) }];
  const isLikely = a && b && cc;
  const evidence: Evidence[] = [];
  if (a) evidence.push(ev("step_length_m", undefined, stepV!, round3(aAt!)));
  if (b) evidence.push(ev("stride_length_m", undefined, strideV!, round3(bAt!)));
  if (cc) evidence.push(ev("cadence", undefined, cadV!, round3(nm!.cadence)));
  // Support: «trunk_incl_abs >= 5 deg forward of true vertical» (arm swing has no number, CG-13).
  const trunk = valueOf(g.metrics.trunk_incl_abs);
  if (trunk !== null && trunk >= N.short.trunkForward)
    evidence.push(ev("trunk_incl_abs", undefined, trunk, N.short.trunkForward));
  return [
    {
      pattern: id,
      label: id,
      side: "both",
      // caps: «noHeight: possible, padStepLength: possible» (pad step length rules until the belt is
      // measured, review B11); light touch.
      status: cap(isLikely ? "likely" : "possible", c.height === null || c.pad || lightTouch(c)),
      ...(flags ? { flags } : {}),
      evidence,
      views: g.passed,
      grades: [step?.grade, stride?.grade, cad?.grade].filter((x): x is GaitGrade => x !== undefined),
      hidden: false,
    },
  ];
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** 5.6 High step with forefoot landing (steppage), after crouch and short steps. */
function steppage(c: Ctx, crouchOn: (s: Side) => boolean, shortStepsFire: boolean): Draft[] {
  const id: GaitPatternId = "steppage";
  const g = groupOf(c, gaitPattern(id).views);
  if (g.reason) return [notAssessed(id, g.reason)];
  // «parkinsons_flat_contact (Parkinson's in the history)».
  if (c.parkinsons) return [notAssessed(id, "parkinsons_flat_contact")];
  const pitch = g.metrics.foot_pitch_ic;
  const thigh = g.metrics.thigh_swing_peak;
  return perSide(id, g, true, (s) => {
    if (ankleFootOrthosisOn(c, s)) return { kind: "not_assessed", reason: "aid_or_orthosis" };
    if (prosthesisOn(c, s)) return { kind: "not_assessed", reason: "prosthetic_side" };
    if (crouchOn(s) || shortStepsFire) return { kind: "not_assessed", reason: "crouch_or_short_steps_on_S" };
    const p = sideOf(pitch, s);
    if (p === null) return { kind: "no_data" };
    const ts = sideOf(thigh, s);
    const to = sideOf(thigh, otherSide(s));
    // (a) «foot_pitch_ic 0 or less» on 60% of cycles; (b) «thigh_swing_peak on S exceeds the other side by 8 or more».
    const a = p <= N.steppage.pitch && present(pitch, s);
    const b = ts !== null && to !== null && ts - to >= N.steppage.thighDiff;
    if (!(a && b)) return { kind: "not_seen" };
    // Likely: (a) and (b) on 60% of the side's clean cycles (the share of (a); (b) is a difference of
    // medians), 0.6 m/s or more, and near limb views for both legs (both thighs measured near).
    const isLikely =
      present(pitch, s, N.steppage.likelyShare) && c.speed !== null && c.speed >= N.steppage.likelySpeed;
    return {
      kind: "fired",
      status: cap(isLikely ? "likely" : "possible", lightTouch(c) || farLimb(c)),
      evidence: [
        ev("foot_pitch_ic", s, p, N.steppage.pitch, shareOf(pitch, s)),
        ev("thigh_swing_peak_between_limb_diff", s, round3(ts! - to!), N.steppage.thighDiff),
      ],
      grades: [pitch!.grade, thigh!.grade],
    };
  });
}

/* ------------------------------------------------------- 5.12 findings */

function findings(c: Ctx, steppageOn: (s: Side) => boolean): GaitSupportFinding[] {
  const out: GaitSupportFinding[] = [];
  // flat_or_forefoot_contact: «foot_pitch_ic 0 or less on 60% or more of the side's clean cycles
  // without the steppage sign (b)»; C3-10: whenever steppage does not fire on that side.
  const fg = groupOf(c, gaitFinding("flat_or_forefoot_contact").views);
  if (!fg.reason)
    for (const s of SIDES) {
      const p = sideOf(fg.metrics.foot_pitch_ic, s);
      if (
        p !== null &&
        p <= N.flat.pitch &&
        present(fg.metrics.foot_pitch_ic, s, N.flat.share) &&
        !steppageOn(s)
      )
        out.push({ id: "flat_or_forefoot_contact", side: s, value: p, status: null });
    }
  // slow_speed: «overground side speed below the age and sex mean − 2 SD» (side view only), read
  // against the 4.1 norms, so flagged norm_interim (CG-16); one rule, no status (CG-17).
  const sg = groupOf(c, gaitFinding("slow_speed").views);
  const speed = valueOf(sg.metrics.speed_mps);
  const nm = norm(c);
  if (!sg.reason && speed !== null && nm && speed < nm.speed.mean - N.slow.sdBelow * nm.speed.sd)
    out.push({ id: "slow_speed", side: "none", value: speed, status: null, flags: ["norm_interim"] });
  // uneven_step_length: «sr_step_length possible 1.13, likely 1.18», on the shorter step's side, with
  // its status (CG-17).
  const ug = groupOf(c, gaitFinding("uneven_step_length").views);
  const sr = ug.metrics.sr_step_length;
  const ratio = valueOf(sr);
  if (!ug.reason && ratio !== null && ratio >= N.uneven.possible) {
    const l = sideOf(sr, "left");
    const r = sideOf(sr, "right");
    if (l !== null && r !== null && l !== r)
      out.push({
        id: "uneven_step_length",
        side: l < r ? "left" : "right",
        value: ratio,
        status: ratio >= N.uneven.likely ? "likely" : "possible",
      });
  }
  return out;
}

/* ----------------------------------------------------------- confidence */

/** What lowers a pattern's confidence besides its status (5.0 and the downgrade list). */
const KIND: Record<GaitPatternId, { betweenLimb?: boolean; timing?: boolean; foot?: boolean }> = {
  shorter_stance: { betweenLimb: true, timing: true },
  trendelenburg: {},
  duchenne_lean: {},
  waddling: {},
  stiff_knee: { betweenLimb: true },
  steppage: { betweenLimb: true, foot: true },
  crouch: {},
  recurvatum: {},
  quad_avoidance: { betweenLimb: true },
  reduced_extension: { betweenLimb: true },
  short_steps: { timing: true },
};

const resultSides = (side: ResultSide): Side[] => (side === "left" || side === "right" ? [side] : [...SIDES]);

/**
 * 5.0: start at the cap of the weakest sign (the data's confidenceCap, confidenceCapPad on the pad,
 * and capFromGrade of the grades measured today); CG-14: status possible is one level lower but
 * never below low on its own (trendelenburg «possible, low», waddling and quad_avoidance «possible
 * only; capped at low»); each other downgrade is one level lower, and below low is not shown.
 */
function confidenceOf(c: Ctx, d: Draft): Confidence | null {
  if ((d.status !== "possible" && d.status !== "likely") || d.hidden) return null;
  const def = gaitPattern(d.pattern);
  const order = (x: Confidence) => LEVELS.indexOf(x);
  let level = order(c.pad && def.confidenceCapPad ? def.confidenceCapPad : def.confidenceCap);
  for (const g of d.grades) {
    const fromGrade = CM.capFromGrade[g];
    level = fromGrade === null ? -1 : Math.min(level, order(fromGrade));
  }
  if (level < 0) return null;
  if (d.status === "possible") level = Math.max(0, level - 1);
  const kind = KIND[d.pattern];
  const sides = resultSides(d.side);
  const nearLimb = d.evidence.some((e) => NEAR_LIMB_METRICS.has(e.metric as GaitMetricId));
  const cycles = Math.min(
    ...sides.map((s) =>
      d.views
        .filter((v) => !nearLimb || v.view !== "pad_side" || v.nearSide === s)
        .reduce((n, v) => n + v.quality.cleanCycles[s], 0),
    ),
  );
  if (cycles < FULL_CYCLES) level--;
  if (d.views.some((v) => v.quality.timingOnly)) level--;
  if (kind.timing && firmHold(c)) level--;
  if (kind.betweenLimb && farLimb(c)) level--;
  if (kind.foot && c.pad && c.flags.has("not_familiarised")) level--;
  if (!sides.some((s) => affected(c, s))) level--;
  return level < 0 ? null : LEVELS[level];
}

/* --------------------------------------------------------- contributors */

/** Contributors the pain day suppresses: «the weakness and tightness contributors» (review A08). */
const WEAKNESS_TIGHTNESS: ReadonlySet<ContributorId> = new Set<ContributorId>([
  "weak_stance_leg",
  "weak_hip_abductors",
  "hip_girdle_weakness",
  "weak_push_off",
  "weak_hip_flexors",
  "weak_dorsiflexors",
  "weak_quadriceps",
  "weak_hamstrings",
  "weak_hip_extensors",
  "tight_calf",
  "tight_hip_flexors",
]);

/** first: the history or the range profile points to it; open: no rule; later: its evidence is not in yet; no: ruled out. */
type Rank = "first" | "open" | "later" | "no";

const fromPillar = (p: "limited" | "within" | "unknown"): Rank =>
  p === "limited" ? "first" : p === "within" ? "no" : "later";

/** The best rank over the result's sides (a both sides result counts what either side shows). */
function anySide(sides: Side[], rank: (s: Side) => Rank): Rank {
  const ranks = sides.map(rank);
  if (ranks.includes("first")) return "first";
  if (ranks.every((r) => r === "no")) return "no";
  return ranks.includes("later") ? "later" : "open";
}

function frontSupport(c: Ctx, side: Side): Rank {
  // stiff_knee support signs (front): «swing_lateral_path larger on S (circumduction), hip_hike on S».
  const g = groupOf(c, ["front", "pad_front"]);
  if (g.reason) return "later";
  const path = g.metrics.swing_lateral_path;
  const hike = g.metrics.hip_hike;
  const ps = sideOf(path, side);
  const po = sideOf(path, otherSide(side));
  const hs = sideOf(hike, side);
  if (ps === null && hs === null) return "later";
  // CG-15: «larger» has no margin; hip_hike is a share of swings, present at the firing share.
  return (ps !== null && po !== null && ps > po) || (hs !== null && hs >= FIRING_SHARE) ? "first" : "no";
}

/** Each contributor's rank in a pattern (gait-rules 5, contributorRules and the possible reasons). */
function rankOf(c: Ctx, d: Draft, id: ContributorId, fires: (p: GaitPatternId) => boolean): Rank {
  const sides = resultSides(d.side);
  const hist = (yes: boolean): Rank => (yes ? "first" : "no");
  switch (id) {
    case "pain_side":
    case "prosthesis_fit":
    case "prosthesis_comfort":
      // The label already holds the pain or the prosthesis (5.1); elsewhere «leg prosthesis on S».
      return d.pattern === "shorter_stance" ? "first" : hist(sides.some((s) => prosthesisOn(c, s)));
    case "hip_pain":
      // «pain area hip on S»; waddling: «pain in both hips».
      return d.side === "both" && d.pattern === "waddling"
        ? hist(SIDES.every((s) => painIn(c, "hip", s)))
        : hist(sides.some((s) => painIn(c, "hip", s)));
    case "knee_pain":
      return hist(sides.some((s) => painIn(c, "knee", s)));
    case "quad_stiffness":
    case "calf_stiffness":
      // «Spasticity is offered as a contributor only when the history has an upper motor neuron condition».
      return hist(c.umn);
    case "small_movements_condition":
      return hist(c.parkinsons);
    case "careful_walking":
      // «pc_steadi fell or worry yes» (CG-9: the kept day answers, D-026 item 7).
      return hist(c.steadi !== null && (c.steadi.fell || c.steadi.worry));
    case "knee_bend_limited":
      // «Pillar 1 knee flexion limited».
      return anySide(sides, (s) => fromPillar(pillar(c, "knee_flexion", s)));
    case "knee_straighten_limited":
      // «Pillar 1 knee extension deficit >= 10 deg ranks first»; a smaller lack rules it out.
      return anySide(sides, (s) => {
        const lack = measured(c, "knee_extension", s);
        return lack === null ? "later" : lack >= N.crouch.lack ? "first" : "no";
      });
    case "tight_calf":
      // steppage: «ranks first when the Pillar 1 lunge is limited»; recurvatum: «Pillar 1 ankle
      // dorsiflexion limited» (the lunge is the camera's ankle dorsiflexion).
      return anySide(sides, (s) => fromPillar(pillar(c, "ankle_dorsiflexion_lunge", s)));
    case "tight_hip_flexors":
      if (d.pattern === "short_steps") return hist(fires("reduced_extension"));
      if (d.pattern === "reduced_extension")
        // «ranks first when the Pillar 1 thigh cannot reach the trunk line (value below 0); never from
        // the standing test alone otherwise» (review B14): a value at or past the line keeps it open.
        return anySide(sides, (s) => {
          const v = measured(c, "hip_extension", s);
          return v !== null && v < N.reduced.tightBelow ? "first" : "later";
        });
      return "open";
    case "clearance_compensation":
      return anySide(sides, (s) => frontSupport(c, s));
    default:
      return "open";
  }
}

function contributorsOf(c: Ctx, d: Draft, fires: (p: GaitPatternId) => boolean): ContributorId[] {
  if (d.status !== "possible" && d.status !== "likely") return [];
  const def = gaitPattern(d.pattern);
  const list = Array.isArray(def.contributors) ? def.contributors : (def.contributors[d.label] ?? []);
  const ranked = list.map((id) => ({ id, rank: rankOf(c, d, id, fires) }));
  const order: Rank[] = ["first", "open", "later"];
  return order
    .flatMap((r) => ranked.filter((x) => x.rank === r).map((x) => x.id))
    .filter((id) => !(c.painDay && WEAKNESS_TIGHTNESS.has(id)));
}

/* -------------------------------------------------------------- targets */

/**
 * The conditions the data writes on pattern targets (patterns[].targets[].when), each decided here.
 * A target whose condition is a state of the program, not of the walk («pain settles»), is left to
 * the program (exercise-targets 5.5: «added from week 1 on the pain_stable path ...»).
 */
type WhenRule = (
  c: Ctx,
  d: Draft,
  contributors: readonly ContributorId[],
  fires: (p: GaitPatternId) => boolean,
) => boolean;
const WHEN: Record<string, WhenRule> = {
  "pain settles": () => false,
  "prosthesis on S": (c, d) => resultSides(d.side).some((s) => prosthesisOn(c, s)),
  "hip pain": (c, d) => resultSides(d.side).some((s) => painIn(c, "hip", s)),
  "not already known": () => true,
  "Pillar 1 limited": (c, d) => resultSides(d.side).some((s) => pillar(c, "knee_flexion", s) === "limited"),
  "spasticity listed": (c) => c.umn,
  "likely and foot_lift_ask yes (active movement present)": (c, d) =>
    d.status === "likely" && resultSides(d.side).every((s) => c.intake.romFlags?.footLift?.[s] === true),
  "tight_calf or calf_stiffness ranked": (c, d, contributors) =>
    contributors.length > 0 &&
    (["tight_calf", "calf_stiffness"] as ContributorId[]).some(
      (id) => contributors.includes(id) && rankOf(c, d, id, () => false) === "first",
    ),
  // C3-11: the knee straightening of the range profile is the hamstrings' measure (exercise-targets
  // romMovements: knee_extension stretches the hamstrings).
  "Pillar 1 shows them limited": (c, d) =>
    resultSides(d.side).some((s) => pillar(c, "knee_extension", s) === "limited"),
  "walking pad: beat 85% of today's cadence": (c) => c.pad,
  "overground: floor marks, beat at today's cadence, 'take big steps' (review C09)": (c) => !c.pad,
  "reduced_extension fires": (_c, _d, _contributors, fires) => fires("reduced_extension"),
};
/** Every target condition the rules decide (held equal to the data by the tests). */
export const HANDLED_TARGET_WHENS: ReadonlySet<string> = new Set(Object.keys(WHEN));

/** The program's target ids of a gait target (exercise-targets taxonomy.gaitRulesAlignment). */
const ALIGNED = new Map<string, TargetId[]>(
  TARGETS_DATA.taxonomy.gaitRulesAlignment
    .filter((a) => a.targetIds.every((t) => /^[a-z]+:[a-z_]+$/.test(t)))
    .map((a) => [`${a.gaitAction}:${a.gaitTarget}`, a.targetIds as TargetId[]]),
);
/** The aligned rows written in words, each by mode (review C09), checked against their text by the tests. */
const ALIGNED_IN_WORDS: Record<string, TargetId> = {
  "practice:step_length_slow_beat_on_pad": "practice:step_length_pad",
  "practice:step_length_floor_marks": "practice:step_length",
};

/**
 * «mobility:<painful joint movements>»: the mobility targets of the movements of each leg region in
 * pain on that side (exercise-targets 5.5 and romMovements; the hip alone for the Duchenne lean).
 */
function painfulJointMobility(c: Ctx, d: Draft, hipOnly: boolean): TargetId[] {
  const sides = resultSides(d.side);
  const regions = LEG_REGIONS.filter(
    (r) =>
      (!hipOnly || r === "hip") &&
      sides.some((s) => painIn(c, r, s) || ((c.painByRegion[r] ?? 0) > 0 && entriesOn(c, [r], s).length > 0)),
  );
  const movements = new Set(
    TARGETS_DATA.taxonomy.jointMovements
      .filter((j) => regions.includes(j.region))
      .map((j) => j.romProtocolMovement),
  );
  return TARGETS_DATA.mapping.romMovements
    .filter((m) => movements.has(m.movement))
    .flatMap((m) => m.mobility);
}

function targetIds(c: Ctx, d: Draft, t: GaitPatternTarget): TargetId[] {
  if (t.target === "painful_joint_gentle_range")
    return painfulJointMobility(c, d, d.pattern === "duchenne_lean");
  const key = `${t.action}:${t.target}`;
  const ids = ALIGNED.get(key) ?? (ALIGNED_IN_WORDS[key] ? [ALIGNED_IN_WORDS[key]] : null);
  if (!ids) throw new Error(`gait rules: no program target for ${key}`);
  return ids;
}

function targetsOf(
  c: Ctx,
  d: Draft,
  contributors: readonly ContributorId[],
  fires: (p: GaitPatternId) => boolean,
): { targets: GaitPatternResult["targets"]; referrals: GaitReferralId[] } {
  if (d.status !== "possible" && d.status !== "likely") return { targets: [], referrals: [] };
  const def = gaitPattern(d.pattern);
  const list = Array.isArray(def.targets) ? def.targets : (def.targets[d.label] ?? []);
  const targets: GaitPatternResult["targets"] = [];
  const referrals: GaitReferralId[] = [];
  for (const t of list) {
    if (t.when !== undefined) {
      const rule = WHEN[t.when];
      if (!rule) throw new Error(`gait rules: no rule for the target condition ${t.when}`);
      if (!rule(c, d, contributors, fires)) continue;
    }
    if (t.action === "refer") {
      const id = `refer_${t.target}` as GaitReferralId;
      if (!(GAIT_REFERRAL_IDS as readonly string[]).includes(id))
        throw new Error(`gait rules: no referral line ${id}`);
      if (!referrals.includes(id)) referrals.push(id);
      continue;
    }
    const side: ResultSide = t.side === "both" ? "both" : d.side;
    for (const id of targetIds(c, d, t)) if (!targets.some((x) => x.id === id)) targets.push({ id, side });
  }
  return { targets, referrals };
}

/* ---------------------------------------------------------------- lines */

/**
 * The program lines of the data and the targets each one names (gait-rules 6.4): a line shows when
 * the result holds one of its targets. gentle_range_load names the painful joint's range and the
 * gradual loading.
 */
export const COPY_TARGET_IDS: Record<GaitCopyTargetKey, (id: TargetId) => boolean> = {
  strengthen_hip_abductors: (id) => id === "strengthen:hip_abductors",
  strengthen_hip_extensors: (id) => id === "strengthen:hip_extensors",
  strengthen_quadriceps: (id) => id === "strengthen:quadriceps",
  strengthen_hamstrings: (id) => id === "strengthen:hamstrings",
  strengthen_calf_push_off: (id) => id === "strengthen:calf" || id === "practice:push_off",
  strengthen_hip_flexors: (id) => id === "strengthen:hip_flexors",
  strengthen_dorsiflexors: (id) => id === "strengthen:ankle_dorsiflexors",
  stretch_hip_flexors: (id) => id === "stretch:hip_flexors",
  stretch_calf: (id) => id === "stretch:calf",
  stretch_hamstrings: (id) => id === "stretch:hamstrings",
  mobility_knee_flexion: (id) => id === "mobility:knee_flexion",
  mobility_knee_extension: (id) => id === "mobility:knee_extension",
  gentle_range_load: (id) => id === "practice:gradual_loading" || id.startsWith("mobility:"),
  single_leg_practice: (id) => id === "balance:single_leg_stance",
  knee_control_practice: (id) => id === "practice:knee_control",
  loading_practice: (id) => id === "practice:loading_bent_knee",
  step_length_practice: (id) => id === "practice:step_length",
  step_length_pad_practice: (id) => id === "practice:step_length_pad",
  gradual_loading_practice: (id) => id === "practice:gradual_loading",
  even_steps_practice: (id) => id === "practice:even_steps",
  walking_practice: (id) => id === "practice:walking",
};

const COPY = GAIT_DATA.copy;
const EMPTY: Text = { ar: "", en: "" };

/** Whether a result is shown to the person: possible or likely, at low confidence or above (5.0). */
export function gaitPatternShown(p: Pick<GaitPatternResult, "status" | "confidence">): boolean {
  return (p.status === "possible" || p.status === "likely") && p.confidence !== null;
}

function withSide(t: Text, side: ResultSide): Text {
  const i = side === "left" ? 1 : 0;
  return {
    ar: t.ar.replaceAll("{side_ar}", COPY.placeholders.side_ar[i]),
    en: t.en.replaceAll("{side_en}", COPY.placeholders.side_en[i]),
  };
}

/** Arabic items joined with «و» on the next item; English with commas and "and" before the last (6.3). */
function joinList(items: readonly Text[]): Text {
  const en = items.map((t) => t.en);
  return {
    ar: items.map((t) => t.ar).join(COPY.contributorsJoin.ar),
    en: en.length < 2 ? (en[0] ?? "") : `${en.slice(0, -1).join(", ")} and ${en[en.length - 1]}`,
  };
}

/** One lead line with its list: «ومن الأسباب الممكنة {list}.», «لذلك أضفنا إلى برنامجك {list}.» */
export function gaitListLine(lead: "contributorsLead" | "targetsLead", items: readonly Text[]): Text | null {
  if (!items.length) return null;
  const list = joinList(items);
  return { ar: COPY[lead].ar.replace("{list}", list.ar), en: COPY[lead].en.replace("{list}", list.en) };
}

/** The pattern's line id (6.2): the label, the bilateral and one sided forms, steppage by status. */
function patternCopy(p: Pick<GaitPatternResult, "pattern" | "label" | "status">): Text {
  const def = gaitPattern(p.pattern);
  if (def.copyIds)
    return COPY.patterns[
      (p.status === "likely" ? def.copyIds.likely : def.copyIds.possible) as keyof typeof COPY.patterns
    ];
  // «antalgic, short_stance, prosthetic_side» share one line (6.2); the data keeps it under two of them.
  const key = p.label === "prosthetic_side" ? "short_stance" : p.label;
  const t = COPY.patterns[key as keyof typeof COPY.patterns];
  if (!t) throw new Error(`gait rules: no pattern line ${key}`);
  return t;
}

/**
 * The person's lines of a result, from its stored fields (the server writes them again on read, in
 * both languages): the pattern on its side, with «سنتحقق من ذلك مرة أخرى» when possible at low
 * confidence; the possible reasons; the program lines (exercise-targets gaitStatusRules: every target
 * when likely, or possible at moderate or high confidence; the first one only when possible at low);
 * how sure we are. A result that is not shown has no lines.
 */
export function gaitPatternLines(p: Omit<GaitPatternResult, "lines">): GaitPatternResult["lines"] {
  if (!gaitPatternShown(p)) return { pattern: EMPTY, reasons: null, targets: [], confidence: null };
  const lowPossible = p.status === "possible" && p.confidence === "low";
  const line = withSide(patternCopy(p), p.side);
  const pattern = lowPossible
    ? {
        ar: `${line.ar} ${COPY.patterns.possible_suffix.ar}`,
        en: `${line.en} ${COPY.patterns.possible_suffix.en}`,
      }
    : line;
  const reasons = gaitListLine(
    "contributorsLead",
    p.contributors.map((id) => COPY.contributors[id]),
  );
  const def = gaitPattern(p.pattern);
  const keys = Array.isArray(def.copyTargets) ? def.copyTargets : (def.copyTargets[p.label] ?? []);
  const ids = lowPossible ? p.targets.slice(0, 1).map((t) => t.id) : p.targets.map((t) => t.id);
  const targets = keys.filter((k) => ids.some((id) => COPY_TARGET_IDS[k](id))).map((k) => COPY.targets[k]);
  const level = p.confidence!;
  return {
    pattern,
    reasons,
    targets: lowPossible ? targets.slice(0, 1) : targets,
    confidence: {
      ar: `${COPY.confidence.label.ar}: ${COPY.confidence[level].ar}`,
      en: `${COPY.confidence.label.en}: ${COPY.confidence[level].en}`,
    },
  };
}

/** Stored results (their lines dropped, section 3) with their lines written again. */
export function withGaitLines(patterns: readonly Omit<GaitPatternResult, "lines">[]): GaitPatternResult[] {
  return patterns.map((p) => ({ ...p, lines: gaitPatternLines(p) }));
}

/* ----------------------------------------------------------- evaluateGait */

/** confidenceModel (firing, caps, downgrades, corroboration, painDayRule, unilateralRule), patterns, findings, copy. */
export function evaluateGait(input: GaitRulesInput): {
  patterns: GaitPatternResult[];
  findings: GaitSupportFinding[];
  rulesVersion: string;
} {
  const c = contextOf(input);
  const drafts = new Map<GaitPatternId, Draft[]>();
  const fires = (id: GaitPatternId) =>
    (drafts.get(id) ?? []).some((d) => d.status === "possible" || d.status === "likely");
  const firesOn = (id: GaitPatternId, s: Side) =>
    (drafts.get(id) ?? []).some(
      (d) => (d.status === "possible" || d.status === "likely") && resultSides(d.side).includes(s),
    );
  drafts.set("shorter_stance", shorterStance(c));
  drafts.set("trendelenburg", trendelenburg(c));
  drafts.set("duchenne_lean", duchenne(c));
  drafts.set("waddling", waddling(c));
  // C3-4: when waddling fires, the lean of each side is the sway it describes, not a second pattern.
  if (fires("waddling")) for (const d of drafts.get("duchenne_lean")!) d.hidden = true;
  drafts.set("stiff_knee", stiffKnee(c));
  drafts.set("crouch", crouch(c));
  drafts.set("recurvatum", recurvatum(c));
  drafts.set("quad_avoidance", quadAvoidance(c));
  drafts.set("reduced_extension", reducedExtension(c));
  drafts.set("short_steps", shortSteps(c));
  // «Not assessed when 5.7 (crouch) or 5.11 (short steps) fires on that side».
  drafts.set(
    "steppage",
    steppage(c, (s) => firesOn("crouch", s), fires("short_steps")),
  );
  // painDayRule: «only the antalgic label can be shown» (C3-2).
  if (c.painDay)
    for (const [id, list] of drafts) if (id !== "shorter_stance") for (const d of list) d.hidden = true;

  const patterns: GaitPatternResult[] = [];
  for (const id of GAIT_PATTERN_IDS)
    for (const d of drafts.get(id) ?? []) {
      const contributors = contributorsOf(c, d, fires);
      const { targets, referrals } = targetsOf(c, d, contributors, fires);
      const result: Omit<GaitPatternResult, "lines"> = {
        pattern: d.pattern,
        label: d.label,
        side: d.side,
        status: d.status,
        confidence: confidenceOf(c, d),
        ...(d.notAssessed ? { notAssessed: d.notAssessed } : {}),
        ...(d.flags ? { flags: [...d.flags] } : {}),
        evidence: d.evidence,
        contributors,
        targets,
        referrals,
      };
      patterns.push({ ...result, lines: gaitPatternLines(result) });
    }
  return {
    patterns,
    findings: findings(c, (s) => firesOn("steppage", s)),
    rulesVersion: GAIT_RULES_VERSION,
  };
}
