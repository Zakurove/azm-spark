/**
 * The gait rules on the engine's own output (product v7 contract 2.8 and 2.9, step C3): the synthetic
 * walker of tests/fixtures/gait/gen-gait.ts, analysed view by view and combined as the capture will,
 * then evaluateGait. A typical walk stays quiet overground and on the walking pad; a hip dip of the
 * size the rule reads is found on its stance side. (C2's projected motion capture is the acceptance
 * of 8.3: every rule on its pattern fixture, quiet on every able bodied trial.)
 */
import { describe, expect, it } from "vitest";
import { analyseGaitView, analyseStaticStance, combineViews } from "../../src/engine/gait/analyse";
import type { GaitAnalysis, GaitView, StaticStanceResult } from "../../src/engine/gait/types";
import { evaluateGait } from "../../src/medical/gait-rules";
import { setupOf, singleLegStance, walk, type WalkSpec } from "../fixtures/gait/gen-gait";
import { fired, input } from "./c-gait-rules-fixtures";

function viewOf(spec: WalkSpec, view: GaitView = spec.view) {
  const w = walk(spec);
  return analyseGaitView({
    view,
    nearSide: view === "pad_side" ? (spec.nearSide ?? "right") : undefined,
    setup: setupOf(spec),
    standing: w.standing,
    frames: w.frames,
    poseModel: "full",
    rollDeg: 0,
  });
}

function stance(dropDeg: number): StaticStanceResult[] {
  return (["left", "right"] as const).map((side) => {
    const s = singleLegStance({ side, dropDeg, seed: 211 });
    return analyseStaticStance({ side, support: "none", frames: s.frames, standing: s.standing });
  });
}

function overground(over: Partial<WalkSpec> = {}): GaitAnalysis {
  return combineViews(
    [
      viewOf({ view: "front", passes: 6, seed: 201, ...over }),
      viewOf({ view: "front", passes: 6, seed: 201, ...over }, "back"),
      viewOf({ view: "side", passes: 4, seed: 202, ...over }),
    ],
    stance(3),
    setupOf({ view: "side" }),
  );
}

function pad(over: Partial<WalkSpec> = {}): GaitAnalysis {
  return combineViews(
    [
      viewOf({ view: "pad_side", nearSide: "right", durationSec: 30, seed: 203, ...over }),
      viewOf({ view: "pad_side", nearSide: "left", durationSec: 30, seed: 204, ...over }),
      viewOf({ view: "pad_front", durationSec: 20, seed: 205, ...over }),
    ],
    [],
    setupOf({ view: "pad_side", speed: 1.2 }),
  );
}

/** The walker is 1.70 m: the intake's height with it. */
const person = { intake: { heightCm: 170 } };

describe("the gait rules on the engine's analysis of a synthetic walker", () => {
  it("stay quiet on a typical walk overground", () => {
    const a = overground();
    // Each toward pass gives the right side's steady cycle and each away pass the left's (CG-1): the
    // front and back views pass their gate only as one group (C3-1).
    expect(a.views.find((v) => v.view === "front")!.quality.gatePassed).toBe(false);
    const out = evaluateGait(input({ analysis: a, ...person }));
    expect(fired(out.patterns)).toEqual([]);
    expect(out.findings).toEqual([]);
    // Every pattern was read (none not assessed): seen as typical.
    expect(out.patterns.map((p) => p.status)).toEqual(out.patterns.map(() => "not_seen"));
  });

  it("stay quiet on a typical walk on the walking pad", () => {
    const a = pad();
    for (const v of a.views) expect(v.quality.gatePassed, `${v.view} ${v.nearSide ?? ""}`).toBe(true);
    const out = evaluateGait(input({ analysis: a, ...person }));
    expect(fired(out.patterns)).toEqual([]);
    expect(out.findings).toEqual([]);
    expect(out.patterns.map((p) => p.status)).toEqual(out.patterns.map(() => "not_seen"));
  });

  it("find a 12 degree hip dip on its stance side from the toward and away passes together", () => {
    const out = evaluateGait(input({ analysis: overground({ pelvicDrop: { right: 12 } }), ...person }));
    expect(fired(out.patterns)).toEqual(["trendelenburg:right:possible"]);
  });

  it("find a 12 degree hip dip on its stance side from the pad's front view", () => {
    const out = evaluateGait(input({ analysis: pad({ pelvicDrop: { right: 12 } }), ...person }));
    expect(fired(out.patterns)).toEqual(["trendelenburg:right:possible"]);
    const r = out.patterns.find((p) => p.pattern === "trendelenburg" && p.side === "right")!;
    expect(r.confidence).toBe("low");
    expect(r.evidence[0]).toMatchObject({ metric: "pelvic_drop", side: "right" });
    expect(r.evidence[0].value).toBeGreaterThan(10);
  });
});
