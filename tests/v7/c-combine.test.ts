/**
 * combineViews (product v7 contract 2.8; gait-rules 2.2, 2.3 and the session gates of 3.6): the near
 * limb rule, symmetry that must agree in sign across views, weighting, the static stance drop, the
 * analysis flags and the one replay cycle.
 */
import { describe, expect, it } from "vitest";
import { combineViews } from "../../src/engine/gait/analyse";
import { ENGINE_VERSION } from "../../src/engine/gait/params";
import type {
  GaitMetricId,
  GaitMetricValue,
  GaitSetup,
  GaitView,
  GaitViewResult,
  ReplayCycle,
} from "../../src/engine/gait/types";

const metric = (id: GaitMetricId, over: Partial<GaitMetricValue>): GaitMetricValue => ({
  id,
  value: null,
  n: 10,
  unit: "deg",
  grade: "A",
  ...over,
});

const replay = (side: "left" | "right"): ReplayCycle => ({
  side,
  fps: 15,
  landmarks: [0],
  frames: [[[0.5, 0.5]]],
});

function view(
  v: GaitView,
  metrics: Partial<Record<GaitMetricId, GaitMetricValue>>,
  over: Partial<GaitViewResult> = {},
): GaitViewResult {
  return {
    view: v,
    poseModel: "full",
    events: [],
    cycles: [],
    metrics,
    quality: {
      cleanCycles: { left: 8, right: 8 },
      medianFps: 30,
      gapShare: 0,
      gatePassed: true,
      timingOnly: false,
      issues: [],
    },
    replay: null,
    ...over,
  };
}

const PAD: GaitSetup = {
  mode: "walking_pad",
  aid: "none",
  orthosis: {},
  prosthesis: null,
  shoes: true,
  heightCm: 170,
  padSpeedKmh: 3.6,
  padCorrection: null,
  handrail: "none",
  familiarised: true,
};
const OVERGROUND: GaitSetup = {
  ...PAD,
  mode: "overground",
  padSpeedKmh: null,
  handrail: null,
  familiarised: null,
};

describe("combined metrics", () => {
  it("takes each limb's knee from the pad side view where it was nearest the phone (near limb rule)", () => {
    const a = combineViews(
      [
        view(
          "pad_side",
          {
            knee_swing_peak: metric("knee_swing_peak", { value: 60, sides: { left: 60, right: 70 }, n: 12 }),
          },
          { nearSide: "left" },
        ),
        view(
          "pad_side",
          {
            knee_swing_peak: metric("knee_swing_peak", { value: 50, sides: { left: 90, right: 50 }, n: 12 }),
          },
          { nearSide: "right" },
        ),
      ],
      [],
      PAD,
    );
    expect(a.combined.knee_swing_peak?.sides).toEqual({ left: 60, right: 50 });
    expect(a.combined.knee_swing_peak?.value).toBe(55);
    expect(a.combined.knee_swing_peak?.n).toBe(24);
  });

  it("weights the views' values and shares by their n, and keeps the lowest grade", () => {
    const a = combineViews(
      [
        view(
          "pad_side",
          { cadence: metric("cadence", { value: 100, n: 20, unit: "steps/min" }) },
          { nearSide: "right" },
        ),
        view("pad_front", {
          cadence: metric("cadence", { value: 110, n: 10, unit: "steps/min", grade: "B" }),
        }),
      ],
      [],
      PAD,
    );
    expect(a.combined.cadence?.value).toBeCloseTo(103.333, 3);
    expect(a.combined.cadence?.grade).toBe("B");
    expect(a.combined.cadence?.unit).toBe("steps/min");
    const b = combineViews(
      [
        view("front", {
          pelvic_drop: metric("pelvic_drop", {
            value: 4,
            sides: { left: 4, right: 6 },
            share: { left: 0, right: 0.5 },
            n: 6,
            grade: "C",
          }),
        }),
        view("back", {
          pelvic_drop: metric("pelvic_drop", {
            value: 8,
            sides: { left: 8, right: 9 },
            share: { left: 1, right: 0.5 },
            n: 2,
            grade: "C",
          }),
        }),
      ],
      [],
      OVERGROUND,
    );
    expect(b.combined.pelvic_drop?.sides).toEqual({ left: 5, right: 6.75 });
    expect(b.combined.pelvic_drop?.share).toEqual({ left: 0.25, right: 0.5 });
  });

  it("combines a symmetry ratio only when the views agree on the larger side", () => {
    const sr = (left: number) =>
      metric("sr_single_support", {
        value: Math.max(left, 1 / left),
        sides: { left, right: 1 / left },
        unit: "ratio",
        grade: "B",
      });
    const agree = combineViews(
      [
        view("pad_side", { sr_single_support: sr(1.2) }, { nearSide: "left" }),
        view("pad_side", { sr_single_support: sr(1.1) }, { nearSide: "right" }),
      ],
      [],
      PAD,
    );
    expect(agree.combined.sr_single_support?.value).toBeCloseTo(1.15, 3);
    const disagree = combineViews(
      [
        view("pad_side", { sr_single_support: sr(1.2) }, { nearSide: "left" }),
        view("pad_side", { sr_single_support: sr(0.9) }, { nearSide: "right" }),
      ],
      [],
      PAD,
    );
    expect(disagree.combined.sr_single_support).toBeUndefined();
  });

  it("gives the static single leg stance drop from the checks that are ok", () => {
    const a = combineViews(
      [],
      [
        { side: "left", pelvicDropDeg: 7.5, ok: true },
        { side: "right", pelvicDropDeg: 3, ok: false },
      ],
      OVERGROUND,
    );
    expect(a.combined.static_pelvic_drop).toEqual({
      id: "static_pelvic_drop",
      value: 7.5,
      sides: { left: 7.5, right: null },
      n: 1,
      unit: "deg",
      grade: "C",
    });
    expect(a.staticStance).toHaveLength(2);
  });
});

describe("flags", () => {
  it("flags the far limb on a pad with one side view, the handrail, an unfamiliar pad and Lite", () => {
    const a = combineViews(
      [view("pad_side", {}, { nearSide: "right", poseModel: "lite" }), view("pad_front", {})],
      [],
      { ...PAD, handrail: "light", familiarised: false },
    );
    expect(a.flags).toEqual(["far_limb", "handrail_light", "not_familiarised", "model_lite"]);
    const firm = combineViews(
      [view("pad_side", {}, { nearSide: "right" }), view("pad_side", {}, { nearSide: "left" })],
      [],
      { ...PAD, handrail: "firm" },
    );
    expect(firm.flags).toEqual(["handrail_firm"]);
    // a side view whose near limb gave no clean cycle is not a measured limb
    const empty = combineViews(
      [
        view("pad_side", {}, { nearSide: "right" }),
        view(
          "pad_side",
          {},
          {
            nearSide: "left",
            quality: {
              cleanCycles: { left: 0, right: 7 },
              medianFps: 30,
              gapShare: 0,
              gatePassed: false,
              timingOnly: false,
              issues: ["too_few_cycles"],
            },
          },
        ),
      ],
      [],
      PAD,
    );
    expect(empty.flags).toEqual(["far_limb"]);
  });

  it("flags an overground walk without the person's height", () => {
    expect(combineViews([view("side", {})], [], { ...OVERGROUND, heightCm: null }).flags).toEqual([
      "no_height",
    ]);
    expect(combineViews([view("side", {})], [], OVERGROUND).flags).toEqual([]);
  });
});

describe("replay and the analysis", () => {
  it("keeps one replay cycle, from the affected side's best view, and nulls the views' own", () => {
    const fromFront = replay("left");
    const quality = (left: number, gapShare = 0) => ({
      cleanCycles: { left, right: 9 },
      medianFps: 30,
      gapShare,
      gatePassed: true,
      timingOnly: false,
      issues: [],
    });
    const a = combineViews(
      [
        view("pad_side", {}, { nearSide: "left", replay: replay("left"), quality: quality(7, 0.1) }),
        view("pad_side", {}, { nearSide: "right", replay: replay("right") }),
        view("pad_front", {}, { replay: fromFront, quality: quality(9) }),
      ],
      [],
      PAD,
    );
    // The plan puts the affected side first on the pad (left); the front view has more left cycles.
    expect(a.replay).toBe(fromFront);
    expect(a.views.every((v) => v.replay === null)).toBe(true);
    expect(a.views.map((v) => v.view)).toEqual(["pad_side", "pad_side", "pad_front"]);
    expect(a.engineVersion).toBe(ENGINE_VERSION);
    expect(a.mode).toBe("walking_pad");
  });

  it("takes the overground side view's replay side, and keeps at most 3 views", () => {
    const a = combineViews(
      [
        view("front", {}, { replay: replay("left") }),
        view("side", {}, { replay: replay("right") }),
        view("back", {}),
        view("side", {}),
      ],
      [],
      OVERGROUND,
    );
    expect(a.replay?.side).toBe("right");
    expect(a.views).toHaveLength(3);
    expect(combineViews([view("side", {})], [], OVERGROUND).replay).toBeNull();
  });
});
