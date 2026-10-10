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

/**
 * The engine's version, stored with every analysis (GaitAnalysis.engineVersion). Version 2 (D-030
 * C4-1): the pad side view masks the far leg's false contacts (D-028 item 2, PAD_FAR_MASK). Version 3
 * (D-035 item 2): front and back passes by the direction in depth, no leg track across a turn that
 * faces the phone, and the timing only reading of a recording below its gate (GAIT_MVP). Version 4
 * (D-037 item 3): the side view's timing reading led by the near leg (each event in its phase of the
 * stride, the far leg's contacts in step with the near leg's, the stride band), and the timing result
 * on 2 clean cycles a side or 5 in all.
 */
// Kept here so the engine chunk never imports src/movements/gait/index.ts (D-023 gap 16);
// tests/v7/c-params.test.ts holds it equal to GAIT_ENGINE_VERSION of that file.
export const ENGINE_VERSION = "gait_engine_4";

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
 * The walk at home for the MVP (D-035 item 2; contract change log, wt/fix-gait GW-1 and GW-2), an MVP
 * interim until the team's own recordings (8.4). A home walk turns inside the picture: on a 3 m path
 * the 1 s turn margins and the two steps dropped at each in view start, stop or turn leave no cycle, so
 * the view fails its gate whatever the walk. gait-rules qualityGates say what a view below its 6 clean
 * cycles a side gives after the added passes: «then timing only or record again», and research gait.md
 * section 6: «If the gate fails, re-record, or report timing only»; timing is the strongest signal from
 * one camera (gait.md section 0 item 1). A view that fails its gate is therefore read again for timing
 * only, with these engineering numbers (no clinical threshold; the patterns keep the full gate):
 *   - timingCyclesPerSide, or timingCyclesTotal with timingCyclesMinSide: the clean cycles across the
 *     passes of the view group that make a timing only result (verdict.ts timingEnough): 2 a side, or 5
 *     in all with 1 on each side. D-037 item 3 (Nasser's fourth test: 4 passes, 21 steps, 3 and 2 clean
 *     cycles, the cadence and step times computed, then refused at 3 a side): a phone's side view sees
 *     about 5 steps a pass, one or two cycles; the cadence is 120 over the median stride of every clean
 *     cycle, so 4 or 5 strides read it steadily, and each side's step time is that side's median (one
 *     cycle on a side is still a measured step, shown with the timing only line). Was 3 a side;
 *   - strideBand: the timing reading of an overground side view checks each stride against the walk's
 *     median near leg stride (cycles.ts, D-037 item 3), within 25% either way: both legs' strides take
 *     the same time in a steady walk (stride time varies by a few percent), and a far leg contact the
 *     model misplaced (the far heel laid on the near one, G1's real model walk) makes a stride about
 *     half as long;
 *   - phase: that reading reads each event between a cycle's two ICs only in its phase of the stride
 *     (cycles.ts timingEvents), as a share of the stride from the IC: the other leg's TO ends the first
 *     double support (about 0.1, later in a slow or affected walk), its IC comes near the middle (0.5;
 *     0.3 and 0.7 are a step time asymmetry above 2), and the leg's own TO after more than half the
 *     stride (stance is about 0.6 of it, over 0.5 in any walk and rarely over 0.8). An event outside
 *     its phase is the model laying one leg on the other for a moment (G1's and the lab's real model
 *     walks: a far IC and a near TO just after each near IC), not the walk;
 *   - turnMarginSec and dropSteps: the turn with 0.3 s either side and one step at each in view start,
 *     stop or turn are left out, instead of 1 s and two steps (the timing only reading never reads an
 *     angle; set on the generator's home walks, tests/v7/c-home-walk.test.ts);
 *   - cleanShareMin: of the cycles those rules keep, at least half pass every other check (order, swap,
 *     duration, visibility), so a walk the model tracks badly never gives a timing only result (the
 *     guard: G1's real model walk made overground, c-pad-near-limb);
 *   - departSpeedMps: front and back views read walking toward or away from the body's size changing
 *     in the picture (the camera model of passes.ts); under this speed in depth the person stands or
 *     turns (a slow walk is 0.4 m/s and more, the gait fixtures' slowest).
 */
export const GAIT_MVP = {
  timingCyclesPerSide: 2,
  timingCyclesTotal: 5,
  timingCyclesMinSide: 1,
  strideBand: [0.75, 1.25] as [number, number],
  phase: {
    oppTo: [0, 0.3] as [number, number],
    oppIc: [0.3, 0.7] as [number, number],
    to: [0.45, 0.85] as [number, number],
  },
  turnMarginSec: 0.3,
  dropSteps: { first: 1, last: 1 },
  cleanShareMin: 0.5,
  departSpeedMps: 0.15,
} as const;

/** The steady state rules a reading of a view uses: the data's (the full gate), or the MVP's timing only ones. */
export interface SteadyRules {
  turnMarginSec: number;
  dropSteps: { first: number; last: number };
}
export const STEADY_FULL: SteadyRules = {
  turnMarginSec: GAIT_ENGINE.turnMarginSec,
  dropSteps: GAIT_ENGINE.dropSteps,
};
export const STEADY_TIMING: SteadyRules = {
  turnMarginSec: GAIT_MVP.turnMarginSec,
  dropSteps: GAIT_MVP.dropSteps,
};

/**
 * The pad side view's swap rule (D-027 item 4, C2's GG-4 proposal (b)): the leg labels are exchanged
 * only where the near leg's own track jumps more than half a foot length from its prediction. Where it
 * may, an exchanged sample costs a quarter of a foot length, so the model's own labels stand unless the
 * near track's continuity says otherwise: an engineering prior (no clinical number), set on G1's
 * rendered pad walk with Full and Lite (contract change log, the pad walk entry), to be judged on the
 * team's videos (D-027 item 4 (e)).
 */
export const PAD_SWAP = { jumpFootShare: 0.5, exchangeCostFootShare: 0.25 } as const;

/**
 * The pad side view's far leg mask (D-028 item 2, AP-7): the model often lays the hidden far leg on the
 * near one, and the far heel then peaks with the near heel at a visibility no gate catches. A far
 * contact (a heel, foot index or ankle peak of the far leg) whose point lies within a quarter of a foot
 * length of the near leg's same point at that sample is masked before the events are kept. An
 * engineering margin (no clinical number), the swap rule's scale, to be judged on the team's videos
 * with the rest of D-027 item 4 (e).
 */
export const PAD_FAR_MASK = { footShare: 0.25 } as const;

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
 * The bounds of the capture's counts kept with a view's quality (GaitCaptureCounts, GW-3; the gait
 * route's, server/modules/focus/validate.ts): list bounds, not clinical numbers.
 */
export const CAPTURE_COUNT_MAX = { passes: 100, steps: 2000, seconds: 600, tries: 9 } as const;

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
