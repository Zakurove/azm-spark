/**
 * Acceptance of the gait engine on the synthetic walker (product v7 contract 8.3, step C2): at every
 * speed from 0.4 to 1.6 m/s and in every view (side passes, toward and away, the walking pad from
 * each side and from the front), with landmark noise and frame time jitter: cadence within 5% of the
 * truth on every trial, at least 6 clean cycles a side where the view has no distance window, events
 * within 2 frames on 90% or more in the side views; the pad side and pad front views both pass their
 * gate; and a symmetric walk seen from one side gives ratios and between limb differences inside
 * the healthy cut offs of gait-rules 5. The front views' contacts lag the truth (CG-2, measured on
 * the mocap fixtures), so their timing is read as cadence only; the back view reports no timing at
 * all (gait-rules metrics), only its frontal metrics.
 */
import { describe, expect, it } from "vitest";
import type { GaitView } from "../../src/engine/gait/types";
import { gaitFinding, gaitPattern } from "../../src/movements/gait";
import { SPEED_CADENCE } from "../fixtures/gait/catalog";
import type { WalkSpec } from "../fixtures/gait/gen-gait";
import { eventErrors, synthView, withinFrames } from "./c-acceptance-helpers";

const VIEWS: { name: string; spec: Partial<WalkSpec> & { view: WalkSpec["view"] }; view: GaitView }[] = [
  { name: "side", spec: { view: "side", passes: 4, passShiftM: 0.6 }, view: "side" },
  { name: "front", spec: { view: "front", passes: 6, passShiftM: 0.6 }, view: "front" },
  { name: "back", spec: { view: "front", passes: 6, passShiftM: 0.6 }, view: "back" },
  {
    name: "pad side right",
    spec: { view: "pad_side", nearSide: "right", durationSec: 30 },
    view: "pad_side",
  },
  { name: "pad side left", spec: { view: "pad_side", nearSide: "left", durationSec: 30 }, view: "pad_side" },
  { name: "pad front", spec: { view: "pad_front", durationSec: 30 }, view: "pad_front" },
];

const sideKind = (v: GaitView) => v === "side" || v === "pad_side";

const windowed = (v: GaitView) => v === "front" || v === "back";

describe("the engine on synthetic walks from 0.4 to 1.6 m/s in every view", () => {
  for (const [speed, cadence] of SPEED_CADENCE)
    for (const v of VIEWS)
      it(`${speed} m/s at ${cadence} steps a minute, ${v.name}`, () => {
        const spec: WalkSpec = {
          ...v.spec,
          speed,
          cadence,
          seed: 1000 + Math.round(speed * 100),
          noise: 0.002,
          jitterMs: 4,
        };
        const { w, result } = synthView(spec, v.view);
        if (v.view === "back") {
          // The back view gives no timing (gait-rules metrics): its frontal metrics are what it adds.
          expect(result.metrics.pelvic_drop, "pelvic_drop").toBeDefined();
          expect(result.metrics.trunk_sway_range, "trunk_sway_range").toBeDefined();
          return;
        }
        const cad = result.metrics.cadence?.value;
        expect(cad, "cadence").toBeDefined();
        expect(Math.abs(cad! / w.truth.cadence - 1)).toBeLessThan(0.05);
        if (!windowed(v.view)) {
          expect(result.quality.cleanCycles.left).toBeGreaterThanOrEqual(6);
          expect(result.quality.cleanCycles.right).toBeGreaterThanOrEqual(6);
          expect(result.quality.gatePassed).toBe(true);
        }
        if (sideKind(v.view))
          expect(withinFrames(eventErrors(w.truth, result.events))).toBeGreaterThanOrEqual(0.9);
      });
});

describe("the engine through what a phone does to a walk", () => {
  const cases: [string, WalkSpec][] = [
    [
      "leg labels swapped for half a second",
      {
        view: "pad_side",
        nearSide: "right",
        durationSec: 30,
        swaps: [
          { from: 8, to: 8.5 },
          { from: 19, to: 19.3 },
        ],
      },
    ],
    ["every tenth frame lost", { view: "side", passes: 4, dropEvery: 10 }],
    [
      "8 ms of frame time jitter and noise 0.003",
      { view: "pad_side", nearSide: "left", durationSec: 30, jitterMs: 8, noise: 0.003 },
    ],
    ["the phone rolled 4 degrees", { view: "side", passes: 4, rollDeg: 4 }],
    [
      "the far heel hidden for a second",
      {
        view: "pad_side",
        nearSide: "right",
        durationSec: 30,
        occlude: [{ from: 10, to: 11, landmarks: [29, 31] }],
      },
    ],
    [
      "away passes labelled as if facing",
      { view: "front", passes: 6, passShiftM: 0.6, awayLabelsAsToward: true },
    ],
  ];
  for (const [name, spec] of cases)
    it(`keeps the cadence within 5%: ${name}`, () => {
      const view = spec.view;
      const { w, result } = synthView({ seed: 1700, noise: 0.002, ...spec }, view);
      const cad = result.metrics.cadence?.value;
      expect(cad).toBeDefined();
      expect(Math.abs(cad! / w.truth.cadence - 1)).toBeLessThan(0.05);
      if (!windowed(view)) expect(result.quality.gatePassed).toBe(true);
    });
});

describe("a symmetric walk seen from one side only", () => {
  const shorter = gaitPattern("shorter_stance").thresholds.possible as { sr_single_support_gte: number };
  const uneven = gaitFinding("uneven_step_length").thresholds.possible as { sr_step_length_gte: number };
  const stiff = gaitPattern("stiff_knee").thresholds.possible as {
    any: { between_limb_diff_gte?: number }[];
  };
  const stiffDiff = stiff.any.find((x) => x.between_limb_diff_gte !== undefined)!.between_limb_diff_gte!;
  const steppage = gaitPattern("steppage").thresholds.possible as { thigh_swing_peak_diff_gte: number };
  const reduced = gaitPattern("reduced_extension").thresholds.possible as {
    tla_lower_than_other_gte: number;
  };
  const quad = gaitPattern("quad_avoidance").thresholds.possible as { lowerThanOtherSide_gte: number };

  const one: [string, WalkSpec, GaitView][] = [
    ["overground side passes, 0.6 m/s", { view: "side", passes: 4, speed: 0.6, cadence: 84 }, "side"],
    ["overground side passes, 1.2 m/s", { view: "side", passes: 4 }, "side"],
    ["overground side passes, 1.6 m/s", { view: "side", passes: 6, speed: 1.6, cadence: 124 }, "side"],
    ["the pad from the right only", { view: "pad_side", nearSide: "right", durationSec: 30 }, "pad_side"],
    ["the pad from the left only", { view: "pad_side", nearSide: "left", durationSec: 30 }, "pad_side"],
  ];
  for (const [name, spec, view] of one)
    it(`gives ratios inside the healthy cut offs: ${name}`, () => {
      const { result } = synthView({ seed: 1900, noise: 0.002, jitterMs: 4, ...spec }, view);
      const m = result.metrics;
      expect(m.sr_single_support!.value!).toBeLessThan(shorter.sr_single_support_gte);
      expect(m.sr_step_length!.value!).toBeLessThan(uneven.sr_step_length_gte);
      expect(m.sr_stance!.value!).toBeLessThan(shorter.sr_single_support_gte);
      const diff = (id: "knee_swing_peak" | "thigh_swing_peak" | "tla_peak" | "knee_loading_peak") => {
        const s = m[id]?.sides;
        return s && s.left !== null && s.right !== null ? Math.abs(s.left - s.right) : null;
      };
      // The near limb rule: a lone pad side view reads one leg's kinematics only.
      if (view === "side") {
        expect(diff("knee_swing_peak")!).toBeLessThan(stiffDiff);
        expect(diff("thigh_swing_peak")!).toBeLessThan(steppage.thigh_swing_peak_diff_gte);
        expect(diff("tla_peak")!).toBeLessThan(reduced.tla_lower_than_other_gte);
        expect(diff("knee_loading_peak")!).toBeLessThan(quad.lowerThanOtherSide_gte);
      }
    });
});
