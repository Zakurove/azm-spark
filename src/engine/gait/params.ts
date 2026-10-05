/**
 * The numbers of the gait engine (product v7 contract 2.8, stream C, step C1), read from the runtime
 * gait data (src/movements/gait/gait-v7.json, exported from the frozen clinical source, C-1).
 *
 * The engine chunk imports only named top level keys of the data (D-023 gap 16: never the default
 * export and never src/movements/gait/index.ts, which holds the whole file with its copy and norms).
 * The few rule numbers that live in the patterns section (the per cycle sign of a share) are code
 * constants here, each held equal to the data by tests/v7/c-params.test.ts. Pure, no DOM.
 */
import {
  capture,
  events as eventsData,
  metrics as metricsData,
  preprocessing,
  qualityGates,
  scaling,
} from "../../movements/gait/gait-v7.json";
import type { GaitData, GaitMetricDef } from "../../movements/gait/types";
import type { GaitMetricId, GaitView } from "./types";

const CAPTURE = capture as unknown as GaitData["capture"];
const PREPROCESSING = preprocessing as unknown as GaitData["preprocessing"];
const EVENTS = eventsData as unknown as GaitData["events"];
const METRICS = metricsData as unknown as GaitData["metrics"];
const SCALING = scaling as unknown as GaitData["scaling"];
const GATES = qualityGates as unknown as GaitData["qualityGates"];

/** The engine's version, stored with every analysis (GaitAnalysis.engineVersion). */
// Kept here so the engine chunk never imports src/movements/gait/index.ts (D-023 gap 16);
// tests/v7/c-params.test.ts holds it equal to GAIT_ENGINE_VERSION of that file.
export const ENGINE_VERSION = "gait_engine_1";

function step(name: string): GaitData["preprocessing"][number] {
  const s = PREPROCESSING.find((p) => p.step === name);
  if (!s) throw new Error(`gait data: no preprocessing step ${name}`);
  return s;
}

function gate(pick: (g: GaitData["qualityGates"][number]) => boolean, what: string) {
  const g = GATES.find(pick);
  if (!g) throw new Error(`gait data: no quality gate ${what}`);
  return g;
}

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`gait data: ${what} is missing`);
  return v;
}

const turns = step("turns and steady state");
const cycleGate = gate((g) => g.level === "cycle", "cycle");
const cyclesGate = gate((g) => g.level === "view" && g.cleanCyclesPerSide !== undefined, "clean cycles");
const gapGate = gate((g) => g.level === "view" && g.gapFilledPctMax !== undefined, "gap share");
const fpsGate = gate((g) => g.level === "view" && g.timingOnlyFps !== undefined, "frame rate");

/** gait-rules preprocessing, capture, events and qualityGates, as the engine uses them. */
export const GAIT_ENGINE = {
  /** «resample each landmark series to a uniform 30 Hz by linear interpolation» */
  hz: need(step("timestamps").hz, "timestamps.hz"),
  /** «a landmark with visibility under 0.5 in a frame is treated as missing» */
  visibilityMin: need(step("visibility").visibilityMin, "visibility.visibilityMin"),
  /** «Hampel filter, window 7, n sigma 2, before smoothing» */
  hampel: need(step("outliers").hampel, "outliers.hampel"),
  /** «linear interpolation for gaps up to 0.12 s; a longer gap splits the bout» */
  maxGapSec: need(step("gaps").maxGap_s, "gaps.maxGap_s"),
  /**
   * «zero lag 4th order low pass Butterworth at 5 Hz (2nd order filtfilt)»: lowpassSos takes the
   * design order, which filtfilt runs twice (src/engine/signal/butterworth.ts).
   */
  butterworth: need(step("smoothing").butterworth, "smoothing.butterworth"),
  /** «exclude turns ... with 1 s margins» */
  turnMarginSec: need(turns.turnMargin_s, "turns.turnMargin_s"),
  /** «drop the first two and last two steps of each pass» */
  dropSteps: need(turns.dropSteps, "turns.dropSteps"),
  /** Zeni side view events: heel 29/30 for initial contact, foot index 31/32 for toe off. */
  heel: EVENTS.side.heelLandmarks as [number, number],
  footIndex: EVENTS.side.footIndexLandmarks as [number, number],
  /** «find_peaks with distance = 0.4 s and prominence = 10% of the signal range» */
  peakDistanceSec: EVENTS.side.peaks.distance_s,
  peakProminenceShare: EVENTS.side.peaks.prominencePctOfRange / 100,
  /** The ankle relative to the mid hip, when the foot fails its gate or the detectors disagree. */
  ankle: EVENTS.side.fallback.ankleLandmarks as [number, number],
  disagreeFrames: EVENTS.side.fallback.disagreeFrames,
  disagreeShare: EVENTS.side.fallback.disagreeEventsPct / 100,
  /** Front view single stance window, share of the interval from a leg's IC to the next opposite IC. */
  singleStanceWindow: EVENTS.front.singleStanceWindowPct.map((p) => p / 100) as [number, number],
  /** «a stride time within 0.5 to 1.5 times the bout median» */
  strideTimePlausible: EVENTS.checks.strideTimePlausibleX as [number, number],
  /** Cycle gate: the gate landmarks at 0.5 or more in at least 90% of the cycle's frames. */
  gateVisibility: need(cycleGate.visibilityMin, "cycle gate visibilityMin"),
  gateShare: need(cycleGate.minVisibleShare, "cycle gate minVisibleShare"),
  gateLandmarks: range(need(cycleGate.landmarkRange, "cycle gate landmarkRange")),
  trunkLandmarks: need(cycleGate.trunkLandmarks, "cycle gate trunkLandmarks"),
  /** «6 or more clean cycles per side» */
  cleanCyclesPerSide: need(cyclesGate.cleanCyclesPerSide, "cleanCyclesPerSide"),
  /** «gap filled frames 15% or less of analysed frames» */
  gapShareMax: need(gapGate.gapFilledPctMax, "gapFilledPctMax") / 100,
  /** «median processed fps 25 or more; 20 to 24 timing only; under 20 record again» */
  fullFps: CAPTURE.common.processedFps.full,
  timingOnlyFps: CAPTURE.common.processedFps.timingOnly,
  recordAgainBelowFps: need(fpsGate.recordAgainBelowFps, "recordAgainBelowFps"),
  /** Overground front and back: «while the walker is 1.5 to 4 m from the phone» */
  frontWindowM: CAPTURE.overground.front.analysedWindow_m_from_phone as [number, number],
  /** Static single leg stance: «up to 10 s», «median over the last 3 s of the hold». */
  staticHoldMaxSec: CAPTURE.staticSingleLegStance.holdMax_s,
  staticMeasureLastSec: CAPTURE.staticSingleLegStance.measureLast_s,
} as const;

/**
 * The pad side view's swap rule (D-027 item 4, C2's GG-4 proposal (b)): the leg labels are exchanged
 * only where the near leg's own track jumps more than half a foot length from its prediction. Where it
 * may, an exchanged sample costs a quarter of a foot length, so the model's own labels stand unless the
 * near track's continuity says otherwise: an engineering prior (no clinical number), set on G1's
 * rendered pad walk with Full and Lite (contract change log, the pad walk entry), to be judged on the
 * team's videos (D-027 item 4 (e)).
 */
export const PAD_SWAP = { jumpFootShare: 0.5, exchangeCostFootShare: 0.25 } as const;

function range([from, to]: number[]): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/** gait-rules scaling.pad: the step length error on the pad until the belt is measured in the trial. */
export const PAD_SCALING = SCALING.pad;

/** The metric definitions (views, unit, grades), by id. */
export const METRIC_DEFS: ReadonlyMap<GaitMetricId, GaitMetricDef> = new Map(
  METRICS.filter((m) => !m.use.includes("do_not_use")).map((m) => [m.id as GaitMetricId, m]),
);

export function metricDef(id: GaitMetricId): GaitMetricDef {
  const m = METRIC_DEFS.get(id);
  if (!m) throw new Error(`gait data: no metric ${id}`);
  return m;
}

/** Whether a metric is measured in a view (gait-rules metrics[].views). */
export function metricInView(id: GaitMetricId, view: GaitView): boolean {
  return metricDef(id).views.includes(view);
}

/** «double support ... not reported under 25 fps» */
export const DOUBLE_SUPPORT_MIN_FPS = need(
  metricDef("double_support_pct").notReportedBelowFps,
  "double_support_pct.notReportedBelowFps",
);

/** «≤ 0 means flat or forefoot first contact» */
export const FLAT_CONTACT_AT_OR_BELOW = need(
  metricDef("foot_pitch_ic").flatAtOrBelow,
  "foot_pitch_ic.flatAtOrBelow",
);

/**
 * The sign of each per cycle metric whose share of a side's clean cycles the rules read
 * (GaitMetricValue.share, confidenceModel.firing): the possible threshold of the pattern that reads
 * the metric cycle by cycle. Code constants, held equal to gait-rules patterns by
 * tests/v7/c-params.test.ts. knee_stance_min has two signs (crouch above, recurvatum below); a side
 * takes the one its own median is on.
 */
export const SHARE_SIGNS = {
  /** stiff_knee possible: knee_swing_peak_lt 45 */
  knee_swing_peak: { below: 45 },
  /** crouch possible: knee_stance_min_gte 15; recurvatum possible: hyperextension_gte 12 (interim, D-027 item 6, CG-19) */
  knee_stance_min: { atOrAbove: 15, hyperextensionAtOrAbove: 12 },
  /** quad_avoidance possible: knee_loading_peak_lte 5 */
  knee_loading_peak: { atOrBelow: 5 },
  /** trendelenburg possible: pelvic_drop_gte 10 */
  pelvic_drop: { atOrAbove: 10 },
  /** duchenne_lean possible: trunk_sway_range_gte 11 */
  trunk_sway_range: { atOrAbove: 11 },
  /** duchenne_lean: «peak toward S in >= 60% of cycles» */
  trunk_lean_peak: { towardStanceSide: true },
  /** metrics foot_pitch_ic flatAtOrBelow 0 (steppage and flat_or_forefoot_contact read it) */
  foot_pitch_ic: { atOrBelow: FLAT_CONTACT_AT_OR_BELOW },
} as const;

/**
 * Route limits of section 4 (server/modules/focus/validate.ts GAIT_LIMITS, held equal by
 * tests/v7/c-params.test.ts): the stored lists of a view and the replay cycle.
 */
export const STORED_LIMITS = { eventsPerView: 200, cyclesPerView: 120, replayFrames: 45 } as const;

/**
 * The bounds of a stored metric value by its unit (section 4; server/modules/focus/validate.ts
 * GAIT_UNIT_BOUNDS, held equal by tests/v7/c-params.test.ts). A cycle's value outside them can only
 * come from broken tracking, and the engine leaves it out, so a body it builds is never refused.
 */
export const UNIT_BOUNDS: Readonly<Record<string, [number, number]>> = {
  "steps/min": [20, 250],
  s: [0.1, 5],
  "%": [0, 100],
  ratio: [0, 5],
  deg: [-90, 120],
  "m/s": [0, 3],
  m: [0, 2.5],
  share: [0, 1],
};

/** The replay landmarks (contract 2.8): 0, 11 to 16 and 23 to 32. */
export const REPLAY_LANDMARK_IDS: readonly number[] = [
  0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
];
/** The replay's frame rate (ReplayCycle.fps). */
export const REPLAY_FPS = 15;
