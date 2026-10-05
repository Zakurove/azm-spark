/**
 * The whole walk from its views (product v7 contract 2.8 combineViews; gait-rules 2.2, 2.3 and 3.6
 * session gates). Pure, no DOM.
 *
 *   - Near limb rule: a limb's knee, thigh, trailing limb, foot pitch and arm metrics come only from
 *     a view where it was nearest the phone: the pad side view with that near side, or the overground
 *     side view (which already keeps each limb to its near passes).
 *   - Timing symmetry must agree in sign across views: a symmetry ratio whose larger side differs
 *     between views is not combined.
 *   - Every other metric: the views' values and sides weighted by their n; shares likewise. The
 *     grade is the lowest of the views that gave the value; n is their sum.
 *   - static_pelvic_drop: from the static single leg stance checks that are ok.
 *   - Flags: far_limb (walking pad without a measured side view of each limb), handrail_light and
 *     handrail_firm (the pad's handrail hold), not_familiarised (the pad warm up was not done),
 *     model_lite (a view measured with Lite), no_height (overground without the person's height).
 *   - One replay cycle for the analysis: the affected side (the pad's first side view, which the plan
 *     puts on the affected side; else the side view's replay side), from the view with the most clean
 *     cycles of that side (then the smallest gap share); every view's own replay is null.
 */
import { metricDef } from "./params";
import type {
  GaitAnalysis,
  GaitMetricId,
  GaitMetricValue,
  GaitSetup,
  GaitViewResult,
  ReplayCycle,
  StaticStanceResult,
} from "./types";
import { r3, type LimbSide } from "./util";

/** The metrics a limb gives only from a view where it was nearest the phone (gait-rules 2.2, 2.3). */
export const NEAR_LIMB_METRICS: ReadonlySet<GaitMetricId> = new Set<GaitMetricId>([
  "knee_swing_peak",
  "knee_stance_min",
  "knee_loading_peak",
  "tla_peak",
  "hip_ext_peak",
  "thigh_swing_peak",
  "foot_pitch_ic",
  "arm_swing",
]);
const SYMMETRY: ReadonlySet<GaitMetricId> = new Set<GaitMetricId>([
  "sr_single_support",
  "sr_stance",
  "sr_step_length",
]);
const GRADES: readonly GaitMetricValue["grade"][] = ["A", "B", "B-", "C+", "C", "D"];
const FLAG_ORDER: readonly GaitAnalysis["flags"][number][] = [
  "far_limb",
  "handrail_light",
  "handrail_firm",
  "not_familiarised",
  "model_lite",
  "no_height",
];
/** The plan's view lists hold at most 3 views (section 4). */
const MAX_VIEWS = 3;

function weighted(pairs: [number | null | undefined, number][]): number | null {
  let sum = 0;
  let w = 0;
  for (const [v, n] of pairs)
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      const weight = Math.max(1, n);
      sum += v * weight;
      w += weight;
    }
  return w ? sum / w : null;
}

const lowest = (gs: GaitMetricValue["grade"][]) =>
  gs.reduce(
    (worst, g) => (GRADES.indexOf(g) > GRADES.indexOf(worst) ? g : worst),
    "A" as GaitMetricValue["grade"],
  );

/** Whether a side view measured a limb from its near position (the near limb rule). */
function nearFor(v: GaitViewResult, side: LimbSide): boolean {
  if (v.view === "side") return true;
  return v.view === "pad_side" && v.nearSide === side;
}

function combineMetric(id: GaitMetricId, views: readonly GaitViewResult[]): GaitMetricValue | null {
  const given = views.filter((v) => v.metrics[id]);
  if (!given.length) return null;
  if (SYMMETRY.has(id)) {
    const larger = new Set(
      given.map((v) => {
        const l = v.metrics[id]!.sides?.left ?? 1;
        return l > 1 ? "left" : l < 1 ? "right" : "equal";
      }),
    );
    larger.delete("equal");
    if (larger.size > 1) return null;
  }
  const sideFrom = (side: LimbSide) =>
    NEAR_LIMB_METRICS.has(id) ? given.filter((v) => nearFor(v, side)) : given;
  const sides = {
    left: weighted(sideFrom("left").map((v) => [v.metrics[id]!.sides?.left, v.metrics[id]!.n])),
    right: weighted(sideFrom("right").map((v) => [v.metrics[id]!.sides?.right, v.metrics[id]!.n])),
  };
  const used = NEAR_LIMB_METRICS.has(id)
    ? given.filter((v) => nearFor(v, "left") || nearFor(v, "right"))
    : given;
  if (!used.length) return null;
  const value = NEAR_LIMB_METRICS.has(id)
    ? weighted([
        [sides.left, 1],
        [sides.right, 1],
      ])
    : weighted(used.map((v) => [v.metrics[id]!.value, v.metrics[id]!.n]));
  const first = used[0].metrics[id]!;
  const out: GaitMetricValue = {
    id,
    value: value === null ? null : r3(value),
    n: used.reduce((n, v) => n + v.metrics[id]!.n, 0),
    unit: first.unit,
    grade: lowest(used.map((v) => v.metrics[id]!.grade)),
  };
  if (used.some((v) => v.metrics[id]!.sides))
    out.sides = {
      left: sides.left === null ? null : r3(sides.left),
      right: sides.right === null ? null : r3(sides.right),
    };
  if (used.some((v) => v.metrics[id]!.share)) {
    const shareOf = (side: LimbSide) =>
      weighted(sideFrom(side).map((v) => [v.metrics[id]!.share?.[side], v.metrics[id]!.n]));
    const sL = shareOf("left");
    const sR = shareOf("right");
    out.share = { left: sL === null ? null : r3(sL), right: sR === null ? null : r3(sR) };
  }
  return out;
}

/**
 * Every metric of these views combined by the near limb rule, the sign agreement of the symmetry
 * ratios and the weighting by n (combineViews; the gait rules combine the views that passed their
 * gate the same way).
 */
export function combineViewMetrics(
  views: readonly GaitViewResult[],
): Partial<Record<GaitMetricId, GaitMetricValue>> {
  const combined: Partial<Record<GaitMetricId, GaitMetricValue>> = {};
  const ids = new Set<GaitMetricId>();
  for (const v of views) for (const id of Object.keys(v.metrics) as GaitMetricId[]) ids.add(id);
  for (const id of ids) {
    const m = combineMetric(id, views);
    if (m) combined[id] = m;
  }
  return combined;
}

function staticDrop(stance: readonly StaticStanceResult[]): GaitMetricValue | null {
  const ok = stance.filter((s) => s.ok && s.pelvicDropDeg !== null);
  if (!ok.length) return null;
  const sideOf = (side: LimbSide) => ok.find((s) => s.side === side)?.pelvicDropDeg ?? null;
  const def = metricDef("static_pelvic_drop");
  const value = ok.reduce((a, s) => a + (s.pelvicDropDeg as number), 0) / ok.length;
  return {
    id: "static_pelvic_drop",
    value: r3(value),
    sides: { left: sideOf("left"), right: sideOf("right") },
    n: ok.length,
    unit: def.unit ?? "deg",
    grade: def.grade,
  };
}

function pickReplay(views: readonly GaitViewResult[], setup: GaitSetup): ReplayCycle | null {
  const withReplay = views.filter((v) => v.replay);
  if (!withReplay.length) return null;
  const firstPad = views.find((v) => v.view === "pad_side" && v.nearSide);
  const sideView = withReplay.find((v) => v.view === "side");
  const affected: LimbSide =
    setup.mode === "walking_pad" && firstPad?.nearSide
      ? firstPad.nearSide
      : (sideView ?? withReplay[0]).replay!.side;
  const rank = (vs: GaitViewResult[]) =>
    [...vs].sort((a, b) => {
      const sa = a.replay!.side;
      const sb = b.replay!.side;
      return b.quality.cleanCycles[sb] - a.quality.cleanCycles[sa] || a.quality.gapShare - b.quality.gapShare;
    })[0];
  const matching = withReplay.filter((v) => v.replay!.side === affected);
  return (rank(matching.length ? matching : withReplay)?.replay ?? null) as ReplayCycle | null;
}

export function combineViews(
  views: readonly GaitViewResult[],
  stance: readonly StaticStanceResult[],
  setup: GaitSetup,
  engineVersion: string,
): GaitAnalysis {
  const kept = views.slice(0, MAX_VIEWS);
  const combined = combineViewMetrics(kept);
  const sd = staticDrop(stance);
  if (sd) combined.static_pelvic_drop = sd;

  const pad = setup.mode === "walking_pad";
  const flags = new Set<GaitAnalysis["flags"][number]>();
  if (pad) {
    const measured = (side: LimbSide) =>
      kept.some((v) => v.view === "pad_side" && v.nearSide === side && v.quality.cleanCycles[side] > 0);
    if (!measured("left") || !measured("right")) flags.add("far_limb");
    if (setup.handrail === "light") flags.add("handrail_light");
    if (setup.handrail === "firm") flags.add("handrail_firm");
    if (setup.familiarised !== true) flags.add("not_familiarised");
  }
  if (kept.some((v) => v.poseModel === "lite")) flags.add("model_lite");
  if (!pad && setup.heightCm === null) flags.add("no_height");

  return {
    mode: setup.mode,
    views: kept.map((v) => ({ ...v, replay: null })),
    replay: pickReplay(kept, setup),
    staticStance: stance.map((s) => ({ ...s })),
    combined,
    flags: FLAG_ORDER.filter((f) => flags.has(f)),
    engineVersion,
  };
}
