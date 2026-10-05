/**
 * The gait analysis (product v7 contract 2.8, stream C, step C1): preprocessing (resample 30 Hz,
 * visibility, Hampel 7/2, gaps up to 0.12 s, Butterworth 5 Hz zero lag, swaps, facing, turns),
 * events (Zeni side; ankle fallback; Stenum front), the event order check, cycles, metrics, scaling
 * and quality. Pure; never during capture (the recorder and the live counter run during capture).
 *
 * Views. A side view (overground side passes or a pad side view) gives timing, lengths, symmetry and
 * the sagittal angles; a front view gives IC only, with the frontal plane metrics. The overground
 * toward and away recording is analysed twice with the same frames: as the "front" view it keeps the
 * passes facing the phone, as the "back" view the passes walking away (the back view is the away
 * passes of the overground front view, gait-rules capture.overground.front).
 *
 * Roll. Angles are read against true vertical when the phone roll is known (rollDeg); for overground
 * side passes without it, the roll is the tilt of the mid hip's path, which is level in the room (the
 * hips walk near the lens height, so depth hardly moves them in the picture); else the picture's
 * vertical.
 */
import { buildCycles, type Cycle } from "./cycles";
import { combineViews as combine } from "./combine";
import { detectEvents } from "./events";
import { dropAt } from "./kinematics";
import { viewMetrics } from "./metrics";
import { ENGINE_VERSION, GAIT_ENGINE, STORED_LIMITS } from "./params";
import { passesOf } from "./passes";
import { LEG, pointOf, prepare, rollTurn, visibleShare } from "./preprocess";
import { meanFps, viewQuality } from "./quality";
import { replayOf } from "./replay";
import { beltMps, pxPerMetre } from "./scale";
import { standingZeros } from "./standing";
import type {
  GaitAnalysis,
  GaitCycle,
  GaitEvent,
  GaitFrame,
  GaitMetricValue,
  GaitSetup,
  GaitView,
  GaitViewInput,
  GaitViewResult,
  StaticStanceInput,
  StaticStanceResult,
} from "./types";
import { DEG, median, other, r3, type LimbSide } from "./util";

const isSideView = (v: GaitView) => v === "side" || v === "pad_side";
const isOverground = (v: GaitView) => v === "side" || v === "front" || v === "back";

/**
 * The tilt of the mid hip's path in the picture, in degrees (the roll of a level path), from the
 * frames that see both hips; null unless the hips travel further across the picture than up and down.
 */
export function pathRollDeg(frames: readonly GaitFrame[]): number | null {
  const turn = rollTurn(null);
  const pts: [number, number][] = [];
  for (const f of frames) {
    const l = pointOf(f, LEG.left.hip, turn);
    const r = pointOf(f, LEG.right.hip, turn);
    if (l && r) pts.push([(l[0] + r[0]) / 2, (l[1] + r[1]) / 2]);
  }
  if (pts.length < 2) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  if (!(sxx > syy)) return null;
  return Math.atan(sxy / sxx) * DEG;
}

/** The side a view's replay shows: the pad side view's near limb; else the side the walk suggests is affected. */
function replaySide(
  view: GaitViewInput,
  metrics: GaitViewResult["metrics"],
  cycles: readonly Cycle[],
): LimbSide {
  if (view.view === "pad_side" && view.nearSide) return view.nearSide;
  const pick = (m: GaitMetricValue | undefined, lower: boolean): LimbSide | null => {
    const l = m?.sides?.left;
    const r = m?.sides?.right;
    if (l === null || l === undefined || r === null || r === undefined || l === r) return null;
    return l < r === lower ? "left" : "right";
  };
  const counts = { left: 0, right: 0 };
  for (const c of cycles) if (c.clean) counts[c.side]++;
  return (
    pick(metrics.single_support_s, true) ??
    pick(metrics.pelvic_drop, false) ??
    (counts.left > counts.right ? "left" : "right")
  );
}

const toEvent = (e: GaitEvent): GaitEvent => ({
  side: e.side,
  type: e.type,
  t: e.t,
  index: e.index,
  confidence: e.confidence,
  detector: e.detector,
});

const toCycle = (c: Cycle): GaitCycle => {
  const out: GaitCycle = { side: c.side, icStart: c.icStart, to: c.to, icEnd: c.icEnd, clean: c.clean };
  if (c.drop) out.drop = c.drop;
  return out;
};

export function analyseGaitView(input: GaitViewInput): GaitViewResult {
  const view = input.view;
  const kind = isSideView(view) ? "side" : "front";
  const sensorRoll = input.rollDeg !== null && Number.isFinite(input.rollDeg) ? input.rollDeg : null;
  const roll = sensorRoll ?? (view === "side" ? pathRollDeg(input.frames) : null);
  const p = prepare(input.frames, { rollDeg: roll, labels: kind === "side" ? "swaps" : "facing" });
  const motion = passesOf(p, view, view === "pad_side" ? input.nearSide : undefined);
  const events = detectEvents(p, motion.passes, kind);
  const cycles = buildCycles(p, motion, events, kind, isOverground(view));
  const zeros = standingZeros(input.standing, kind, roll);
  const fps = meanFps(p.frameMs);
  const metrics = viewMetrics({
    p,
    view,
    motion,
    cycles,
    zeros,
    pxPerM: view === "side" ? pxPerMetre(zeros.heightPx, input.setup.heightCm) : null,
    beltMps: view === "pad_side" ? beltMps(input.setup) : null,
    rollKnown: roll !== null,
    fps,
  });
  const quality = viewQuality({
    p,
    motion,
    cycles,
    noViewPasses: (view === "front" || view === "back") && p.series.bouts.length > 0 && !motion.passes.length,
  });
  const replay = quality.gatePassed ? replayOf(p, cycles, replaySide(input, metrics, cycles)) : null;
  const result: GaitViewResult = {
    view,
    poseModel: input.poseModel,
    events: events.slice(0, STORED_LIMITS.eventsPerView).map(toEvent),
    cycles: cycles.slice(0, STORED_LIMITS.cyclesPerView).map(toCycle),
    metrics,
    quality,
    replay,
  };
  if (view === "pad_side" && input.nearSide) result.nearSide = input.nearSide;
  return result;
}

/**
 * The static single leg stance check (gait-rules 2.4): the hip line's tilt with the other leg lifted,
 * against double stance, the median over the last 3 s of a hold of up to 10 s; positive when the
 * lifted side's hip is lower. `ok` when the hold lasted the 3 s, the hips pass the visibility gate in
 * that window, the standing calibration gives a zero, and the lifted ankle is higher above the stance
 * ankle than it ever was while standing.
 */
export function analyseStaticStance(input: StaticStanceInput): StaticStanceResult {
  const side = input.side;
  const fail: StaticStanceResult = { side, pelvicDropDeg: null, ok: false };
  const frames = input.frames.filter((f) => Number.isFinite(f.t));
  if (frames.length < 2) return fail;
  const start = frames[0].t;
  const hold = frames.filter((f) => f.t - start <= GAIT_ENGINE.staticHoldMaxSec * 1000);
  const end = hold[hold.length - 1].t;
  if (end - start < GAIT_ENGINE.staticMeasureLastSec * 1000) return fail;
  const zeros = standingZeros(input.standing, "front", null);
  const zero = zeros.drop[side];
  if (zero === null) return fail;
  const from = end - GAIT_ENGINE.staticMeasureLastSec * 1000;
  const p = prepare(hold, { rollDeg: null, labels: "facing" });
  if (visibleShare(p, [LEG.left.hip, LEG.right.hip], from, end) < GAIT_ENGINE.gateShare) return fail;
  const s = p.series;
  const lifted = other(side);
  const drops: number[] = [];
  const lifts: number[] = [];
  for (let k = 0; k < s.n; k++) {
    if (s.t[k] * 1000 < from - 1e-6) continue;
    const v = dropAt(s, side, k);
    if (Number.isFinite(v)) drops.push(v - zero);
    const lift = s.y[LEG[side].ankle][k] - s.y[LEG[lifted].ankle][k];
    if (Number.isFinite(lift)) lifts.push(lift);
  }
  const st = prepare(input.standing, { rollDeg: null, labels: "facing" }).series;
  let standingLift = -Infinity;
  for (let k = 0; k < st.n; k++) {
    const v = st.y[LEG[side].ankle][k] - st.y[LEG[lifted].ankle][k];
    if (Number.isFinite(v)) standingLift = Math.max(standingLift, v);
  }
  const drop = median(drops);
  const lift = median(lifts);
  if (drop === null || lift === null || !(lift > standingLift)) return fail;
  return { side, pelvicDropDeg: r3(drop), ok: true };
}

/** Also picks the one replay cycle and nulls the per view replays. */
export function combineViews(
  views: readonly GaitViewResult[],
  stance: readonly StaticStanceResult[],
  setup: GaitSetup,
): GaitAnalysis {
  return combine(views, stance, setup, ENGINE_VERSION);
}
