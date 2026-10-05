/**
 * Shared steps of the gait acceptance (product v7 contract 8.3, step C2): analyse the views of a
 * capture as C4 will (one analyseGaitView per planned view, then combineViews), run the rules on a
 * typical person, and compare detected events with the truth.
 */
import { analyseGaitView, combineViews } from "../../src/engine/gait/analyse";
import type { GaitAnalysis, GaitEvent, GaitSetup, GaitViewResult } from "../../src/engine/gait/types";
import { evaluateGait } from "../../src/medical/gait-rules";
import type { GaitPatternResult } from "../../src/medical/gait-types";
import { setupOf, walk, type WalkSpec } from "../fixtures/gait/gen-gait";
import { viewSpecs } from "../fixtures/gait/catalog";
import { input, type InputSpec } from "./c-gait-rules-fixtures";

export const FRAME_MS = 1000 / 30;

/** One synthetic view through the engine, with the walk it came from. */
export function synthView(spec: WalkSpec, view: WalkSpec["view"] = spec.view) {
  const w = walk(spec);
  const result = analyseGaitView({
    view,
    nearSide: view === "pad_side" ? (spec.nearSide ?? "right") : undefined,
    setup: setupOf(spec),
    standing: w.standing,
    frames: w.frames,
    poseModel: "full",
    rollDeg: 0,
  });
  return { w, result };
}

/** The views of a mode for a synthetic walk, combined as the capture combines them. */
export function synthAnalysis(
  mode: "overground" | "walking_pad",
  over: Partial<WalkSpec> = {},
  seed?: number,
): GaitAnalysis {
  const specs = viewSpecs(mode, over, seed);
  const views: GaitViewResult[] = specs.map(({ spec, view }) => synthView(spec, view).result);
  return combineViews(views, [], setupOf(specs[specs.length - 1].spec));
}

/** The rules on an analysis for a typical person (a 58 year old man, 170 cm, unless told otherwise). */
export function rulesOn(analysis: GaitAnalysis, spec: Omit<InputSpec, "analysis"> = {}) {
  return evaluateGait(input({ ...spec, analysis, intake: { heightCm: 170, ...spec.intake } }));
}

/** The results that fire (possible or likely), as "pattern:side:status". */
export const firedOf = (patterns: readonly GaitPatternResult[]): string[] =>
  patterns
    .filter((p) => p.status === "possible" || p.status === "likely")
    .map((p) => `${p.pattern}:${p.side}:${p.status}`);

/** Signed error (ms) of each detected event against the nearest true event of its side and type. */
export function eventErrors(
  truth: { ics: { side: string; t: number }[]; tos: { side: string; t: number }[] },
  events: readonly GaitEvent[],
): number[] {
  return events.map((e) => {
    const list = e.type === "ic" ? truth.ics : truth.tos;
    let best = Infinity;
    for (const x of list) if (x.side === e.side && Math.abs(e.t - x.t) < Math.abs(best)) best = e.t - x.t;
    return best;
  });
}

/** Share of errors within n frames (a half millisecond of slack for the frame clock's rounding). */
export const withinFrames = (errors: readonly number[], n = 2) =>
  errors.length ? errors.filter((e) => Math.abs(e) <= n * FRAME_MS + 0.5).length / errors.length : 1;

export const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type { GaitSetup };
