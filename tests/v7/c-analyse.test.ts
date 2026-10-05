/**
 * The gait analysis end to end (product v7 contract 2.8, step C1) on synthetic walks: accuracy
 * against the walker's truth, robustness (swaps, facing labels, roll, slow walkers, empty input), the
 * stored body the route accepts (section 4 bounds, rounding and list limits), and the time budget.
 */
import { describe, expect, it } from "vitest";
import {
  analyseGaitView,
  analyseStaticStance,
  combineViews,
  pathRollDeg,
} from "../../src/engine/gait/analyse";
import type {
  GaitAnalysis,
  GaitFrame,
  GaitSetup,
  GaitView,
  GaitViewResult,
  StaticStanceResult,
} from "../../src/engine/gait/types";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { checkGaitBody } from "../../server/modules/focus/validate";
import { setupOf, singleLegStance, walk, type WalkSpec } from "../fixtures/gait/gen-gait";

const FRAME_MS = 1000 / 30;

function analyse(
  spec: WalkSpec,
  over: { view?: GaitView; rollDeg?: number | null; setup?: Partial<GaitSetup> } = {},
) {
  const w = walk(spec);
  const view = over.view ?? spec.view;
  const r = analyseGaitView({
    view,
    nearSide: view === "pad_side" ? (spec.nearSide ?? "right") : undefined,
    setup: setupOf(spec, over.setup),
    standing: w.standing,
    frames: w.frames,
    poseModel: "full",
    rollDeg: over.rollDeg === undefined ? (spec.rollDeg ?? 0) : over.rollDeg,
  });
  return { w, r };
}

const OVERGROUND_PLAN: GaitPlan = {
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
};

/** Every number of a value has at most 3 decimals, and every time is whole milliseconds. */
function expectStoredForm(a: GaitAnalysis) {
  const walkNumbers = (v: unknown, path: string): void => {
    if (typeof v === "number") expect(Math.abs(v * 1000 - Math.round(v * 1000)), path).toBeLessThan(1e-6);
    else if (Array.isArray(v)) v.forEach((x, i) => walkNumbers(x, `${path}[${i}]`));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) walkNumbers(x, `${path}.${k}`);
  };
  walkNumbers(a, "analysis");
  for (const v of a.views) {
    for (const e of v.events) expect(Number.isInteger(e.t)).toBe(true);
    for (const c of v.cycles) expect(Number.isInteger(c.icStart) && Number.isInteger(c.icEnd)).toBe(true);
  }
}

describe("accuracy on synthetic walks", () => {
  for (const spec of [
    { view: "side", passes: 4, seed: 101 },
    { view: "side", passes: 6, seed: 102, speed: 0.6, cadence: 84, noise: 0.002, jitterMs: 5 },
    { view: "pad_side", nearSide: "right", durationSec: 30, seed: 103, noise: 0.002 },
    { view: "pad_side", nearSide: "left", durationSec: 30, seed: 104, speed: 0.8, cadence: 90 },
  ] satisfies WalkSpec[])
    it(`measures timing and the near limb's sagittal angles on ${spec.view} at ${spec.speed ?? 1.2} m/s`, () => {
      const { w, r } = analyse(spec);
      const m = r.metrics;
      expect(r.quality.gatePassed).toBe(true);
      expect(Math.abs(m.cadence!.value! / w.truth.cadence - 1)).toBeLessThan(0.02);
      for (const side of ["left", "right"] as const)
        expect(Math.abs(m.stride_time_s!.sides![side]! - w.truth.strideSec)).toBeLessThanOrEqual(
          FRAME_MS / 1000 + 0.001,
        );
      const near = spec.view === "pad_side" ? [spec.nearSide] : (["left", "right"] as const);
      for (const side of near) {
        expect(Math.abs(m.knee_swing_peak!.sides![side]! - w.truth.kneeSwingPeak), side).toBeLessThan(3);
        expect(Math.abs(m.knee_stance_min!.sides![side]! - w.truth.kneeStanceMin), side).toBeLessThan(3);
        expect(Math.abs(m.thigh_swing_peak!.sides![side]! - w.truth.thighSwingPeak), side).toBeLessThan(3);
        expect(Math.abs(m.foot_pitch_ic!.sides![side]! - 18), side).toBeLessThan(2.5);
      }
      // A symmetric walker gives symmetric timing.
      expect(m.sr_single_support!.value!).toBeLessThan(1.06);
      expect(m.sr_stance!.value!).toBeLessThan(1.06);
    });

  it("gives the pad's step length from the belt and the overground step length from the height", () => {
    const pad = analyse({ view: "pad_side", nearSide: "right", durationSec: 30, seed: 105 });
    expect(Math.abs(pad.r.metrics.step_length_m!.value! / pad.w.truth.stepLengthM - 1)).toBeLessThan(0.02);
    expect(pad.r.metrics.speed_mps!.value).toBe(1.2);
    expect(pad.r.metrics.sr_step_length!.value!).toBeLessThan(1.02);
    // Overground the engine reads the heel landmarks at the detected IC (gait-rules 3.4): the
    // trailing heel has risen and the leading one may land a frame later, so within 8%.
    const side = analyse({ view: "side", passes: 4, seed: 106 });
    expect(Math.abs(side.r.metrics.step_length_m!.value! / side.w.truth.heelSepAtIcM - 1)).toBeLessThan(0.08);
    const noHeight = analyse({ view: "side", passes: 4, seed: 106 }, { setup: { heightCm: null } });
    expect(noHeight.r.metrics.step_length_m).toBeUndefined();
    expect(noHeight.r.metrics.speed_mps).toBeUndefined();
    expect(noHeight.r.metrics.sr_step_length).toBeDefined();
  });

  it("recovers a hip drop of the size the Trendelenburg rule reads, on the pad's front view", () => {
    const { r } = analyse({ view: "pad_front", durationSec: 20, seed: 107, pelvicDrop: { right: 12 } });
    expect(Math.abs(r.metrics.pelvic_drop!.sides!.right! - 12)).toBeLessThan(1.5);
    expect(Math.abs(r.metrics.pelvic_drop!.sides!.left! - 4)).toBeLessThan(1);
    expect(r.metrics.pelvic_drop!.share!.right).toBe(1);
    expect(r.metrics.pelvic_drop!.share!.left).toBe(0);
  });
});

describe("robustness", () => {
  it("gives the same walk when MediaPipe swaps the legs' labels for a while", () => {
    const base = analyse({ view: "pad_side", nearSide: "right", durationSec: 20, seed: 111 }).r;
    const swapped = analyse({
      view: "pad_side",
      nearSide: "right",
      durationSec: 20,
      seed: 111,
      swaps: [
        { from: 4.02, to: 4.4 },
        { from: 9.1, to: 9.5 },
      ],
    }).r;
    expect(swapped.metrics.cadence!.value).toBe(base.metrics.cadence!.value);
    expect(
      Math.abs(swapped.metrics.knee_swing_peak!.value! - base.metrics.knee_swing_peak!.value!),
    ).toBeLessThan(0.5);
    expect(swapped.quality.cleanCycles.left).toBeGreaterThanOrEqual(base.quality.cleanCycles.left - 2);
  });

  it("gives the same back view when walking away is labelled as if facing the phone", () => {
    const right = analyse({ view: "front", passes: 6, seed: 112 }, { view: "back" }).r;
    const wrong = analyse(
      { view: "front", passes: 6, seed: 112, awayLabelsAsToward: true },
      { view: "back" },
    ).r;
    expect(right.quality.cleanCycles).toEqual(wrong.quality.cleanCycles);
    expect(wrong.metrics.pelvic_drop?.sides).toEqual(right.metrics.pelvic_drop?.sides);
  });

  it("reads angles against true vertical with the phone roll, and from the path's tilt without it", () => {
    const level = analyse({ view: "pad_side", nearSide: "right", durationSec: 20, seed: 113 }).r;
    const rolled = analyse({ view: "pad_side", nearSide: "right", durationSec: 20, seed: 113, rollDeg: 4 }).r;
    expect(
      Math.abs(rolled.metrics.thigh_swing_peak!.value! - level.metrics.thigh_swing_peak!.value!),
    ).toBeLessThan(0.5);
    expect(
      Math.abs(rolled.metrics.trunk_incl_abs!.value! - level.metrics.trunk_incl_abs!.value!),
    ).toBeLessThan(0.5);
    // Overground side passes without a roll reading: the hips' path gives it.
    const w = walk({ view: "side", passes: 4, seed: 114, rollDeg: 3 });
    expect(Math.abs(pathRollDeg(w.frames)! - 3)).toBeLessThan(0.6);
    const free = analyse({ view: "side", passes: 4, seed: 114, rollDeg: 3 }, { rollDeg: null }).r;
    const thigh = free.metrics.thigh_swing_peak!.sides!;
    expect(Math.abs(thigh.left! - thigh.right!)).toBeLessThan(1.5);
  });

  it("returns an empty view for no frames or no person, never throwing", () => {
    const empty = analyseGaitView({
      view: "side",
      setup: setupOf({ view: "side" }),
      standing: [],
      frames: [],
      poseModel: "lite",
      rollDeg: null,
    });
    expect(empty.events).toEqual([]);
    expect(empty.metrics).toEqual({});
    expect(empty.quality.gatePassed).toBe(false);
    expect(empty.poseModel).toBe("lite");
    const nobody: GaitFrame[] = Array.from({ length: 90 }, (_, i) => ({
      t: (i * 1000) / 30,
      lm: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 })),
      aspect: 0.5625,
    }));
    const none = analyseGaitView({
      view: "front",
      setup: setupOf({ view: "front" }),
      standing: nobody,
      frames: nobody,
      poseModel: "full",
      rollDeg: 0,
    });
    expect(none.cycles).toEqual([]);
    expect(none.quality.issues).toContain("too_few_cycles");
  });
});

describe("the stored analysis", () => {
  function stance(): StaticStanceResult[] {
    return (["left", "right"] as const).map((side) => {
      const s = singleLegStance({ side, dropDeg: 3, seed: 121 });
      return analyseStaticStance({ side, support: "none", frames: s.frames, standing: s.standing });
    });
  }

  it("is accepted by the gait route: overground side, front and back, with the static stance", () => {
    const side = analyse({ view: "side", passes: 4, seed: 122 }).r;
    const front = analyse({ view: "front", passes: 6, seed: 123 }).r;
    const back = analyse({ view: "front", passes: 6, seed: 123 }, { view: "back" }).r;
    const setup = setupOf({ view: "side" });
    const a = combineViews([front, back, side], stance(), setup);
    expect(a.views.map((v) => v.view)).toEqual(["front", "back", "side"]);
    expect(a.replay).not.toBeNull();
    expect(a.views.every((v) => v.replay === null)).toBe(true);
    expect(a.combined.static_pelvic_drop?.sides?.left).toBeCloseTo(3, 0);
    expect(a.flags).toEqual([]);
    expectStoredForm(a);
    const checked = checkGaitBody({ setup, analysis: JSON.parse(JSON.stringify(a)) }, OVERGROUND_PLAN);
    expect(checked).toMatchObject({ ok: true });
  });

  it("is accepted by the gait route: the pad's two side views and its front view", () => {
    const views: GaitViewResult[] = [
      analyse({ view: "pad_side", nearSide: "right", durationSec: 30, seed: 124 }).r,
      analyse({ view: "pad_side", nearSide: "left", durationSec: 30, seed: 125 }).r,
      analyse({ view: "pad_front", durationSec: 20, seed: 126 }).r,
    ];
    const setup = setupOf({ view: "pad_side", speed: 1.2 });
    const a = combineViews(views, [], setup);
    expect(a.combined.knee_swing_peak?.sides?.left).not.toBeNull();
    expect(a.combined.knee_swing_peak?.sides?.right).not.toBeNull();
    expect(a.replay?.side).toBe("right");
    expect(a.flags).toEqual([]);
    expectStoredForm(a);
    expect(checkGaitBody({ setup, analysis: JSON.parse(JSON.stringify(a)) }, OVERGROUND_PLAN)).toMatchObject({
      ok: true,
    });
  });

  it("keeps the stored lists of a long view within the route's limits (the metrics use every cycle)", () => {
    const { r } = analyse({ view: "pad_side", nearSide: "right", durationSec: 70, seed: 127 });
    expect(r.events.length).toBe(200);
    expect(r.cycles.length).toBeLessThanOrEqual(120);
    expect(r.metrics.stride_time_s!.n).toBeGreaterThan(110);
    for (let i = 1; i < r.events.length; i++)
      expect(r.events[i].index).toBeGreaterThanOrEqual(r.events[i - 1].index);
  });

  it("analyses a 30 s view of about 900 frames quickly (budget: 200 ms p95 on a mid range phone)", () => {
    const w = walk({ view: "pad_side", nearSide: "right", durationSec: 30, seed: 128, noise: 0.002 });
    const input = {
      view: "pad_side" as const,
      nearSide: "right" as const,
      setup: setupOf({ view: "pad_side" }),
      standing: w.standing,
      frames: w.frames,
      poseModel: "full" as const,
      rollDeg: 0,
    };
    analyseGaitView(input);
    const t0 = performance.now();
    analyseGaitView(input);
    expect(performance.now() - t0).toBeLessThan(400);
  });
});
