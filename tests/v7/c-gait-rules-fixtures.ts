/**
 * Inputs for the gait rules tests (product v7 contract 2.9, stream C, step C3): hand built analyses of
 * a typical walk, made of views whose metrics a test changes one sign at a time, with the intake, the
 * day, the gait plan and the range profile the rules read. The typical numbers sit well inside every
 * rule of gait-rules 5 (a 58 year old man, 172 cm, 1.2 m/s, near Fang 2018's 50 to 59 band).
 */
import type {
  GaitAnalysis,
  GaitMetricId,
  GaitMetricValue,
  GaitSetup,
  GaitView,
  GaitViewResult,
  GaitWalkPain,
  StaticStanceResult,
} from "../../src/engine/gait/types";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import type { GaitPatternResult } from "../../src/medical/gait-types";
import type { GaitRulesInput } from "../../src/medical/gait-rules";
import type { Intake } from "../../src/medical/plan";
import type { RegionEntry } from "../../src/medical/body-map";
import type { RomFindingId, RomProfile, RomProfileEntry } from "../../src/medical/rom-types";
import type { JointMovementId } from "../../src/movements/rom/types";
import { GAIT_DATA } from "../../src/movements/gait";

export type Side = "left" | "right";

/** A metric spec: the whole walk value, each side's median and each side's share of cycles with the sign. */
export interface Spec {
  value?: number | null;
  left?: number | null;
  right?: number | null;
  shareLeft?: number | null;
  shareRight?: number | null;
  grade?: GaitMetricValue["grade"];
  n?: number;
}

export function metric(id: GaitMetricId, s: Spec): GaitMetricValue {
  const def = GAIT_DATA.metrics.find((m) => m.id === id);
  if (!def?.unit) throw new Error(`no metric ${id}`);
  const out: GaitMetricValue = {
    id,
    value: s.value === undefined ? (s.left ?? s.right ?? null) : s.value,
    n: s.n ?? 12,
    unit: def.unit,
    grade: s.grade ?? def.grade,
  };
  if (s.left !== undefined || s.right !== undefined)
    out.sides = { left: s.left ?? null, right: s.right ?? null };
  if (s.shareLeft !== undefined || s.shareRight !== undefined)
    out.share = { left: s.shareLeft ?? null, right: s.shareRight ?? null };
  return out;
}

const both = (v: number, share?: number): Spec => ({
  value: v,
  left: v,
  right: v,
  ...(share !== undefined ? { shareLeft: share, shareRight: share } : {}),
});

/** A typical walk seen from the side (overground side passes or a pad side view). */
export const SIDE_TYPICAL: Partial<Record<GaitMetricId, Spec>> = {
  cadence: { value: 110 },
  step_time_s: both(0.545),
  stride_time_s: both(1.09),
  stance_pct: both(61),
  swing_pct: both(39),
  single_support_s: both(0.43),
  double_support_pct: { value: 22 },
  step_length_m: both(0.66),
  stride_length_m: { value: 1.32 },
  speed_mps: { value: 1.2 },
  sr_single_support: both(1),
  sr_stance: both(1),
  sr_step_length: both(1),
  knee_swing_peak: both(60, 0),
  knee_stance_min: both(5, 0),
  knee_loading_peak: both(15, 0),
  tla_peak: both(20),
  hip_ext_peak: both(10),
  thigh_swing_peak: both(30),
  foot_pitch_ic: both(20, 0),
  trunk_incl: { value: 0 },
  trunk_incl_abs: { value: 2 },
  arm_swing: both(0.3),
};

/** A typical walk seen from the front or the back (overground toward and away passes, or the pad front view). */
export const FRONT_TYPICAL: Partial<Record<GaitMetricId, Spec>> = {
  cadence: { value: 110 },
  step_time_s: both(0.545),
  stride_time_s: both(1.09),
  pelvic_drop: both(5, 0),
  trunk_sway_range: both(5, 0),
  trunk_lean_peak: both(2, 0.5),
  swing_lateral_path: both(0.2),
  hip_hike: both(0.2),
  step_width_ratio: { value: 0.5 },
};

export interface ViewSpec {
  view: GaitView;
  nearSide?: Side;
  metrics?: Partial<Record<GaitMetricId, Spec | null>>;
  cycles?: { left: number; right: number };
  fps?: number;
  gatePassed?: boolean;
  issues?: GaitViewResult["quality"]["issues"];
  poseModel?: "lite" | "full";
}

/** A view: its typical metrics with the spec's changes (null removes a metric). */
export function view(v: ViewSpec): GaitViewResult {
  const sideKind = v.view === "side" || v.view === "pad_side";
  const base = sideKind ? SIDE_TYPICAL : FRONT_TYPICAL;
  const specs: Partial<Record<GaitMetricId, Spec | null>> = { ...base, ...v.metrics };
  const metrics: Partial<Record<GaitMetricId, GaitMetricValue>> = {};
  for (const [id, s] of Object.entries(specs) as [GaitMetricId, Spec | null][])
    if (s) metrics[id] = metric(id, s);
  const fps = v.fps ?? 30;
  const cycles = v.cycles ?? { left: 12, right: 12 };
  const out: GaitViewResult = {
    view: v.view,
    poseModel: v.poseModel ?? "full",
    events: [],
    cycles: [],
    metrics,
    quality: {
      cleanCycles: cycles,
      medianFps: fps,
      gapShare: 0.02,
      gatePassed: v.gatePassed ?? (cycles.left >= 6 && cycles.right >= 6 && fps >= 20),
      timingOnly: fps >= 20 && fps < 25,
      issues: v.issues ?? [],
    },
    replay: null,
  };
  if (v.nearSide) out.nearSide = v.nearSide;
  return out;
}

export interface WalkSpec {
  mode?: "overground" | "walking_pad";
  /** Overground: side, front and back views; the pad: both side views and the front. */
  side?: Partial<Record<GaitMetricId, Spec | null>>;
  front?: Partial<Record<GaitMetricId, Spec | null>>;
  views?: GaitViewResult[];
  staticStance?: StaticStanceResult[];
  flags?: GaitAnalysis["flags"];
}

/** A walk: by default overground with a side, a front and a back view, all typical. */
export function walk(w: WalkSpec = {}): GaitAnalysis {
  const mode = w.mode ?? "overground";
  const views =
    w.views ??
    (mode === "overground"
      ? [
          view({ view: "side", metrics: w.side }),
          view({ view: "front", metrics: w.front }),
          view({ view: "back", metrics: w.front }),
        ]
      : [
          view({ view: "pad_side", nearSide: "right", metrics: w.side }),
          view({ view: "pad_side", nearSide: "left", metrics: w.side }),
          view({ view: "pad_front", metrics: w.front }),
        ]);
  return {
    mode,
    views,
    replay: null,
    staticStance: w.staticStance ?? [],
    combined: {},
    flags: w.flags ?? [],
    engineVersion: "gait_engine_1",
  };
}

/** Both knees stiff after an old injury: an affected leg region on each side, no condition. */
export const KNEES_BOTH: RegionEntry = {
  region: "knee",
  side: "both",
  problems: ["stiffness"],
  origin: "person",
};

export function intake(over: Partial<Intake> = {}): Intake {
  return {
    age: 58,
    conditions: ["none"],
    diagnosisNotes: "",
    medications: "",
    mobility: "standing",
    support: "none",
    pain: [],
    restrictions: [],
    symptoms: "no",
    recentChange: "no",
    clearance: "yes",
    equipment: ["chair"],
    goal: "mobility",
    days: [0, 2, 4],
    time: "09:00",
    sessionMinutes: 30,
    consent: true,
    sex: "male",
    regions: [KNEES_BOTH],
    walking: { status: "without_aid" },
    heightCm: 172,
    ...over,
  };
}

export function plan(over: Partial<GaitPlan> = {}): GaitPlan {
  return {
    offered: true,
    modes: ["overground", "walking_pad"],
    defaultMode: "overground",
    padAllowed: true,
    helperRequired: false,
    antalgicOnly: false,
    staticStance: true,
    views: {
      overground: ["front", "back", "side"],
      walking_pad: [
        { view: "pad_side", nearSide: "right" },
        { view: "pad_side", nearSide: "left" },
        { view: "pad_front" },
      ],
    },
    ...over,
  };
}

export const SETUP: GaitSetup = {
  mode: "overground",
  aid: "none",
  orthosis: {},
  prosthesis: null,
  shoes: true,
  heightCm: 172,
  padSpeedKmh: null,
  padCorrection: null,
  handrail: null,
  familiarised: null,
};

export const PAD_SETUP: GaitSetup = {
  ...SETUP,
  mode: "walking_pad",
  padSpeedKmh: 4.3,
  padCorrection: null,
  handrail: "none",
  familiarised: true,
};

/** One measured movement of the range profile. */
export function romEntry(
  movementId: JointMovementId,
  side: "left" | "right",
  value: number,
  finding: RomFindingId,
): RomProfileEntry {
  return {
    movementId,
    side,
    region: movementId.startsWith("knee") ? "knee" : movementId.startsWith("hip") ? "hip" : "ankle_foot",
    source: "measured",
    kind: "flexion",
    value,
    typical: null,
    percentOfNormal: null,
    z: null,
    finding,
    gradeIgnoringPain: null,
    painLimited: false,
    painLevel: null,
    cause: null,
    provisional: false,
    approximate: false,
    noActiveMovement: false,
    flags: [],
    reason: null,
    measuredAt: 1,
    checkId: "check",
  };
}

export function profile(entries: RomProfileEntry[]): RomProfile {
  return { sex: "male", age: 58, normsVersion: "norms", created: 1, entries };
}

export interface InputSpec extends WalkSpec {
  analysis?: GaitAnalysis;
  intake?: Partial<Intake>;
  plan?: Partial<GaitPlan>;
  pain?: GaitRulesInput["today"]["painByRegion"];
  rom?: RomProfileEntry[];
  setup?: GaitSetup;
  steadi?: { fell: boolean; worry: boolean };
  /** Pain marked during the walk (CG-8), written into the analysis as C4's GaitController writes it. */
  walkPain?: GaitWalkPain[];
}

export function input(s: InputSpec = {}): GaitRulesInput {
  const analysis = s.analysis ?? walk(s);
  const out: GaitRulesInput = {
    analysis: s.walkPain ? { ...analysis, walkPain: s.walkPain } : analysis,
    intake: intake(s.intake),
    romProfile: s.rom ? profile(s.rom) : null,
    today: { painByRegion: s.pain ?? {}, ...(s.steadi ? { steadi: s.steadi } : {}) },
    plan: plan(s.plan),
  };
  if (s.setup) out.setup = s.setup;
  return out;
}

/** The results of one pattern. */
export const of = (patterns: readonly GaitPatternResult[], id: GaitPatternResult["pattern"]) =>
  patterns.filter((p) => p.pattern === id);

/** The one result of a pattern on a side (or none, both). */
export function on(
  patterns: readonly GaitPatternResult[],
  id: GaitPatternResult["pattern"],
  side: GaitPatternResult["side"],
): GaitPatternResult | undefined {
  return patterns.find((p) => p.pattern === id && p.side === side);
}

/** The results that fire (possible or likely), as "pattern:side:status". */
export const fired = (patterns: readonly GaitPatternResult[]) =>
  patterns
    .filter((p) => p.status === "possible" || p.status === "likely")
    .map((p) => `${p.pattern}:${p.side}:${p.status}`);
