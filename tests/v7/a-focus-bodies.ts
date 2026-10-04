/**
 * Request bodies for the focus route and validator tests: a valid range result for a protocol item,
 * and gait bodies from the smallest to the largest the validator accepts (product v7 contract
 * section 4 bounds: 3 views, 200 events and 120 cycles per view, one 45 frame replay cycle).
 */
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import type { RomProtocolItem } from "../../src/medical/rom-protocol";
import { GAIT_DATA } from "../../src/movements/gait";
import { GAIT_METRIC_IDS } from "../../src/movements/gait/types";
import { movementDef } from "../../src/movements/rom";
import type { GaitView } from "../../src/engine/gait/types";
import { GAIT_LIMITS, REPLAY_LANDMARKS } from "../../server/modules/focus/validate";

/** A full engine quality report of one attempt (engine/quality.ts QualityReport). */
export const QUALITY_REPORT = {
  ok: true,
  frames: 240,
  visibleShare: 0.97,
  windowVisibleShare: null,
  optionalVisibleShare: { "13": 0.92, "14": 0.88 },
  view: "side",
  viewRatio: 0.41,
  viewOk: true,
  inFrameShare: 1,
  fps: 28,
  pausedShare: 0,
  touched: false,
  distance: 0.34,
  distanceM: 2.4,
  issues: [],
  missing: [],
  cue: null,
};

function attempt(index: number, value: number) {
  return {
    index,
    outcome: "valid",
    value,
    answer: "yes",
    answerSource: "button",
    painLimited: false,
    painLevel: null,
    reasons: [],
    flags: [],
    quality: QUALITY_REPORT,
    t0: 1000 * index,
    t1: 1000 * index + 800,
  };
}

/**
 * A valid range result for an item: three valid attempts whose best is `value` (the largest, or the
 * smallest for a lack movement) and a median between them; `over` replaces fields.
 */
export function romBody(
  item: Pick<RomProtocolItem, "movementId" | "side" | "position">,
  value: number,
  over: Record<string, unknown> = {},
) {
  const def = movementDef(item.movementId);
  const step = def.kind === "lack" ? 2 : -2;
  const values = [value + step, value, value + 2 * step];
  return {
    movementId: item.movementId,
    side: item.side,
    position: item.position,
    status: "measured",
    reason: null,
    value,
    median: value + step,
    nValid: 3,
    painLimited: false,
    painLevel: null,
    painBefore: 0,
    cause: null,
    attempts: values.map((v, i) => attempt(i + 1, v)),
    practice: [{ ...attempt(0, value + 2 * step), outcome: "practice" }],
    retries: 0,
    flags: [],
    quality: { ok: true, retries: 0, issues: [], medianFps: 28, maxPausedShare: 0 },
    poseModel: "full",
    movementVersion: def.version,
    engineVersion: "rom_engine_1",
    durationSec: 42,
    ...over,
  };
}

const UNIT_VALUE: Record<string, number> = {
  "steps/min": 104.123,
  s: 0.612,
  "%": 61.234,
  ratio: 1.123,
  deg: 12.345,
  "m/s": 1.123,
  m: 0.654,
  share: 0.333,
};

/** A metric value with both sides and the firing share, numbers rounded as the engine keeps them. */
function metric(id: (typeof GAIT_METRIC_IDS)[number]) {
  const unit = GAIT_DATA.metrics.find((m) => m.id === id)!.unit!;
  const v = UNIT_VALUE[unit];
  return {
    id,
    value: v,
    sides: { left: v, right: v },
    share: { left: 0.833, right: 0.667 },
    n: 12,
    unit,
    grade: "B",
  };
}

const allMetrics = () => Object.fromEntries(GAIT_METRIC_IDS.map((id) => [id, metric(id)]));

/** One view: `events` and `cycles` long, with every metric when `full`. */
function view(
  v: { view: GaitView; nearSide?: "left" | "right" },
  events: number,
  cycles: number,
  full: boolean,
  gate: boolean,
) {
  return {
    view: v.view,
    ...(v.nearSide ? { nearSide: v.nearSide } : {}),
    events: Array.from({ length: events }, (_, i) => ({
      side: i % 2 ? "left" : "right",
      type: i % 4 < 2 ? "ic" : "to",
      t: 10000.123 + i * 517.456,
      index: 300 + i * 16,
      confidence: 0.987,
      detector: "zeni",
    })),
    cycles: Array.from({ length: cycles }, (_, i) => ({
      side: i % 2 ? "left" : "right",
      icStart: 10000.123 + i * 1034.912,
      to: 10650.456 + i * 1034.912,
      icEnd: 11035.035 + i * 1034.912,
      clean: i % 7 !== 0,
      ...(i % 7 === 0 ? { drop: "visibility" } : {}),
    })),
    metrics: full ? allMetrics() : { cadence: metric("cadence") },
    quality: {
      cleanCycles: gate ? { left: 8, right: 7 } : { left: 3, right: 2 },
      medianFps: 28.5,
      gapShare: 0.04,
      gatePassed: gate,
      timingOnly: false,
      issues: gate ? [] : ["too_few_cycles"],
    },
    replay: null,
  };
}

/** One replay cycle of `frames` frames, x and y to 3 decimals. */
export function replay(frames: number) {
  return {
    side: "right",
    fps: 15,
    landmarks: [...REPLAY_LANDMARKS],
    frames: Array.from({ length: frames }, (_, f) =>
      REPLAY_LANDMARKS.map((_, i) => [
        Number((0.312 + i * 0.021).toFixed(3)),
        Number((0.105 + f * 0.017).toFixed(3)),
      ]),
    ),
  };
}

const SETUP = {
  overground: {
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
  },
  walking_pad: {
    mode: "walking_pad",
    aid: "none",
    orthosis: { right: "afo" },
    prosthesis: null,
    shoes: true,
    heightCm: 172,
    padSpeedKmh: 2.5,
    padCorrection: 1.04,
    handrail: "light",
    familiarised: true,
  },
} as const;

/**
 * A gait body for the plan: the plan's views of the mode, at most 3. `worst` fills every limit of
 * section 4 (200 events and 120 cycles per view, every metric, the 45 frame replay, two stances).
 */
export function gaitBody(
  plan: GaitPlan,
  mode: "overground" | "walking_pad",
  opts: { worst?: boolean; gate?: boolean } = {},
) {
  const worst = opts.worst === true;
  const gate = opts.gate !== false;
  const views =
    mode === "overground"
      ? plan.views.overground.map((v) => ({ view: v as GaitView }))
      : plan.views.walking_pad.map((v) => ({
          view: v.view as GaitView,
          ...(v.nearSide ? { nearSide: v.nearSide } : {}),
        }));
  return structuredClone({
    setup: SETUP[mode],
    analysis: {
      mode,
      views: views
        .slice(0, GAIT_LIMITS.views)
        .map((v) =>
          view(
            v,
            worst ? GAIT_LIMITS.eventsPerView : 24,
            worst ? GAIT_LIMITS.cyclesPerView : 12,
            worst,
            gate,
          ),
        ),
      replay: replay(worst ? GAIT_LIMITS.replayFrames : 20),
      staticStance: worst
        ? [
            { side: "right", pelvicDropDeg: 6.5, ok: true },
            { side: "left", pelvicDropDeg: 3.25, ok: true },
          ]
        : [],
      combined: worst ? allMetrics() : { cadence: metric("cadence") },
      flags: worst ? ["handrail_light", "model_lite"] : [],
      engineVersion: "gait_engine_1",
    },
  });
}
