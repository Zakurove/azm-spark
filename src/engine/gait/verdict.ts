/**
 * What a walk gave (D-035 item 2 and 4; contract change log, wt/fix-gait GW-1 to GW-4): the data's full
 * reading, the MVP's timing only reading, or nothing, with the reasons. The capture stops on it, the
 * walk's card and the gait lab (/?gaitlab) show it, and the gait rules read only the full reading. Pure,
 * no DOM; it reads only the views' quality and timing metrics, so the card can run it on a stored walk.
 *
 * Groups (gait-rules 3.6, C3-1): the overground toward and away passes are one group (front and back),
 * each other view is its own. A group is
 *   full    6 clean cycles a side summed over its views of the right view at 20 fps or more, none of
 *           them a timing only reading (the gait rules' own group gate);
 *   timing  else, GAIT_MVP.timingCyclesPerSide (3) clean cycles a side summed over its timing only
 *           readings, and a cadence among them;
 *   none    else.
 * The walk's level is its best group's. The numbers shown for a timing level come from the timing only
 * readings of its timing groups only, never from a view that failed both (a walk the model tracked
 * badly).
 */
import { GAIT_ENGINE, GAIT_MVP } from "./params";
import type { GaitCycle, GaitMetricValue, GaitQualityIssue, GaitView, GaitViewResult } from "./types";
import { r3, type LimbSide } from "./util";

type ViewLike = Pick<GaitViewResult, "view" | "quality"> & {
  metrics: Partial<Record<"cadence" | "step_time_s", GaitMetricValue | undefined>>;
  /** The view's cycles, when known (a stored walk keeps none). */
  cycles?: readonly Pick<GaitCycle, "clean" | "drop">[];
};

/**
 * The tracking consistency guard of a timing only reading (GAIT_MVP.cleanShareMin): of the cycles the
 * steady state rules keep (not dropped for a turn or a pass edge), at least half pass every other check.
 * A walk whose legs the model mixes up drops most of them for order, swap, duration or visibility.
 */
export function consistent(cycles: readonly Pick<GaitCycle, "clean" | "drop">[]): boolean {
  const steady = cycles.filter((c) => c.drop !== "turn" && c.drop !== "pass_edge");
  if (!steady.length) return false;
  return steady.filter((c) => c.clean).length / steady.length >= GAIT_MVP.cleanShareMin;
}

/**
 * A view read for timing only below the data's gate: the MVP's reading, or a 20 to 24 fps view with
 * too few clean cycles (which gives no frontal or angle metric). Its clean cycles never count toward
 * the gait rules' gate, so no pattern is read from it.
 */
export function isTimingReading(v: Pick<GaitViewResult, "quality">): boolean {
  return v.quality.timingOnly && v.quality.issues.includes("too_few_cycles");
}

const usableForGate = (v: Pick<GaitViewResult, "quality">) =>
  !v.quality.issues.includes("wrong_view") && v.quality.medianFps >= GAIT_ENGINE.recordAgainBelowFps;

const sum = (vs: readonly Pick<GaitViewResult, "quality">[], s: LimbSide) =>
  vs.reduce((n, v) => n + v.quality.cleanCycles[s], 0);

/**
 * Whether a group of the data's readings passes its gate together (the gait rules' group, C3-1): 6
 * clean cycles a side summed over its views of the right view at 20 fps or more.
 */
export function groupPassed(views: readonly Pick<GaitViewResult, "quality">[]): boolean {
  const usable = views.filter((v) => usableForGate(v) && !isTimingReading(v));
  if (!usable.length) return false;
  return (
    sum(usable, "left") >= GAIT_ENGINE.cleanCyclesPerSide &&
    sum(usable, "right") >= GAIT_ENGINE.cleanCyclesPerSide
  );
}

/** The view groups of a walk: front and back together, every other view alone (pad sides by near side). */
export function viewGroups<V extends Pick<GaitViewResult, "view">>(views: readonly V[]): V[][] {
  const out: V[][] = [];
  const toward = views.filter((v) => v.view === "front" || v.view === "back");
  if (toward.length) out.push(toward);
  for (const v of views) if (v.view !== "front" && v.view !== "back") out.push([v]);
  return out;
}

export type WalkLevel = "full" | "timing" | "none";

/** Why a walk gave no result, most useful first (the lab's and the card's calm line pick the first). */
export type WalkReason =
  "nothing_recorded" | "no_person" | "wrong_view" | "low_fps" | "visibility" | "tracking" | "too_few_steps";

export interface WalkVerdict {
  level: WalkLevel;
  /** Clean cycles a side of the best group (its timing only readings for a timing level). */
  cleanCycles: { left: number; right: number };
  /** Steps a minute (the timing groups' or the full groups' cadence, weighted by n), or null. */
  cadence: number | null;
  /** Each side's median step time, seconds, or null. */
  stepTime: { left: number | null; right: number | null };
  /** For a level of none: why, most useful first. */
  reasons: WalkReason[];
  /** The lowest frame rate of the views, or null without a view. */
  fps: number | null;
}

function weighted(vs: readonly ViewLike[], pick: (v: ViewLike) => number | null | undefined) {
  let s = 0;
  let w = 0;
  for (const v of vs) {
    const x = pick(v);
    const n = Math.max(1, v.metrics.cadence?.n ?? v.metrics.step_time_s?.n ?? 1);
    if (x !== null && x !== undefined && Number.isFinite(x)) {
      s += x * n;
      w += n;
    }
  }
  return w ? r3(s / w) : null;
}

const ISSUE_REASON: Partial<Record<GaitQualityIssue, WalkReason>> = {
  not_one_person: "no_person",
  wrong_view: "wrong_view",
  visibility: "visibility",
  gaps: "visibility",
  swap: "tracking",
  turns_only: "too_few_steps",
  too_few_cycles: "too_few_steps",
};

/** The walk's verdict from its views (GaitViewResult, or a stored view with its quality and metrics). */
export function walkVerdict(views: readonly ViewLike[]): WalkVerdict {
  const fpsAll = views.map((v) => v.quality.medianFps).filter((f) => Number.isFinite(f));
  const fps = fpsAll.length ? r3(Math.min(...fpsAll)) : null;
  const numbers = (vs: readonly ViewLike[]) => ({
    cadence: weighted(vs, (v) => v.metrics.cadence?.value),
    stepTime: {
      left: weighted(vs, (v) => v.metrics.step_time_s?.sides?.left),
      right: weighted(vs, (v) => v.metrics.step_time_s?.sides?.right),
    },
  });
  const groups = viewGroups(views);
  const full = groups.filter((g) => groupPassed(g));
  if (full.length) {
    const vs = full.flat();
    const best = full
      .map((g) => ({ left: sum(g, "left"), right: sum(g, "right") }))
      .sort((a, b) => Math.min(b.left, b.right) - Math.min(a.left, a.right))[0];
    return { level: "full", cleanCycles: best, ...numbers(vs), reasons: [], fps };
  }
  const timing = groups
    .map((g) => g.filter((v) => isTimingReading(v) && usableForGate(v)))
    .filter(
      (g) =>
        g.length &&
        sum(g, "left") >= GAIT_MVP.timingCyclesPerSide &&
        sum(g, "right") >= GAIT_MVP.timingCyclesPerSide &&
        g.some((v) => v.metrics.cadence?.value != null),
    );
  if (timing.length) {
    const vs = timing.flat();
    const best = timing
      .map((g) => ({ left: sum(g, "left"), right: sum(g, "right") }))
      .sort((a, b) => Math.min(b.left, b.right) - Math.min(a.left, a.right))[0];
    return { level: "timing", cleanCycles: best, ...numbers(vs), reasons: [], fps };
  }
  // Nothing: the best group's cycles, and why.
  const best = groups
    .map((g) => ({ left: sum(g, "left"), right: sum(g, "right") }))
    .sort((a, b) => Math.min(b.left, b.right) - Math.min(a.left, a.right))[0] ?? { left: 0, right: 0 };
  const reasons = new Set<WalkReason>();
  if (!views.length) reasons.add("nothing_recorded");
  if (fps !== null && fps < GAIT_ENGINE.recordAgainBelowFps) reasons.add("low_fps");
  for (const v of views) for (const i of v.quality.issues) if (ISSUE_REASON[i]) reasons.add(ISSUE_REASON[i]!);
  // A view whose steady cycles were mostly dropped for order, swap, duration or visibility: the model
  // did not follow the legs (the timing only reading's guard).
  for (const v of views)
    if (v.cycles?.some((c) => c.drop !== "turn" && c.drop !== "pass_edge") && !consistent(v.cycles))
      reasons.add("tracking");
  const order: WalkReason[] = [
    "nothing_recorded",
    "no_person",
    "wrong_view",
    "low_fps",
    "visibility",
    "tracking",
    "too_few_steps",
  ];
  return {
    level: "none",
    cleanCycles: best,
    cadence: null,
    stepTime: { left: null, right: null },
    reasons: order.filter((r) => reasons.has(r)),
    fps,
  };
}

/** The views a stored walk keeps (GaitStoredView.views) carry their quality; the type for callers. */
export type VerdictView = ViewLike & { view: GaitView };
