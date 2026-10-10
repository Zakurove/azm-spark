/**
 * D-037 item 3: the walk measures what it captured. Nasser's fourth test (v7.3, the side walk of
 * D-036 item 6): 4 passes, 21 steps, 22.4 s; 3 and 2 clean cycles, too_few_cycles, the cadence, step
 * times, stance and swing computed and then refused, and «we couldn't measure, let's try again» twice.
 *
 * Why so few clean cycles. A phone's side view (upright, or near the path) sees about 5 steps a pass,
 * one or two strides; the model follows the near leg's contacts well but lays the far heel and toe on
 * the near ones for a moment around each near contact (a far IC and a near TO just after the near IC),
 * and the toe off of the leg still out of the picture as a pass starts is missing. The full order check
 * (exactly the five events of a cycle, in order) dropped almost every cycle for the far leg's events,
 * and 3 a side was then needed. The timing reading now reads each event only in its phase of the
 * stride, led by the near leg (cycles.ts timingEvents), checks each stride against the walk's near leg
 * strides (GAIT_MVP.strideBand), and stands on 2 clean cycles a side, or 5 in all with 1 on each side
 * (verdict.ts timingEnough). The guard against a walk the model tracks badly stays (c-home-walk).
 */
import { describe, expect, it } from "vitest";
import { analyseGaitGroup, isTimingReading } from "../../src/engine/gait/analyse";
import { walkVerdict } from "../../src/engine/gait/verdict";
import type { GaitFrame, GaitViewInput } from "../../src/engine/gait/types";
import { setupOf, walk, withRealFarLeg, type WalkSpec } from "../fixtures/gait/gen-gait";
import { loadHomeSmoke, narrowerPicture } from "../fixtures/gait/smoke";

const within = (v: number | null | undefined, truth: number, share: number) =>
  v !== null && v !== undefined && Math.abs(v / truth - 1) <= share;

/** An upright phone 3.5 m from the path: the picture about 3.3 m wide, so a pass across it is about 5 steps. */
const phoneSide = (seed: number): WalkSpec => ({
  view: "side",
  passes: 4,
  seed,
  speed: 1.1,
  cadence: 104,
  camera: { distance: 3.5, portrait: true },
  // Out of the picture at each end to turn, each pass starting on either foot.
  sidePath: { pathM: 5.3, turnSec: 1.5 },
  passShiftM: 0.3,
  noise: 0.004,
  jitterMs: 8,
});

function sideInput(frames: GaitFrame[], standing: GaitFrame[], spec: WalkSpec, model: "full" | "lite") {
  const input: GaitViewInput = {
    view: "side",
    setup: setupOf(spec),
    standing,
    frames,
    poseModel: model,
    rollDeg: null,
  };
  return input;
}

describe("a phone's side walk of 4 passes at about 5 steps each (synthetic, the real far leg)", () => {
  for (const seed of [1, 2, 3, 4, 5, 6])
    it(`gives at least 3 clean cycles a side, the cadence within 5% (seed ${seed})`, () => {
      const spec = phoneSide(seed);
      const w = walk(spec);
      // About 5 steps a pass (the heel's contacts in the picture).
      expect(w.truth.ics.length).toBeGreaterThanOrEqual(18);
      expect(w.truth.ics.length).toBeLessThanOrEqual(24);
      const views = analyseGaitGroup([sideInput(withRealFarLeg(w.frames), w.standing, spec, "full")]);
      const v = walkVerdict(views);
      expect(v.level).not.toBe("none");
      expect(views[0].quality.cleanCycles.left).toBeGreaterThanOrEqual(3);
      expect(views[0].quality.cleanCycles.right).toBeGreaterThanOrEqual(3);
      expect(within(v.cadence, w.truth.cadence, 0.05)).toBe(true);
      expect(within(v.stepTime.left, w.truth.stepSec, 0.1)).toBe(true);
      expect(within(v.stepTime.right, w.truth.stepSec, 0.1)).toBe(true);
    });
});

describe("the real model's walk seen through a phone's narrower picture (about 5 steps a pass)", () => {
  // G1's lab runs of the rendered walk at home (c-home-smoke), the middle 60% of the picture: the
  // walker leaves it at each end of the path; the first 4 passes, as the capture stops after them.
  for (const name of ["gait-home-side-full", "gait-home-side-lite"])
    it(`gives a timing result with the cadence within 5% (${name}; before: none)`, () => {
      const s = loadHomeSmoke(name);
      const t0 = s.frames[0].t;
      const frames = narrowerPicture(s.frames, 0.2, 0.8).filter((f) => f.t - t0 <= 24000);
      const spec: WalkSpec = { view: "side" };
      const views = analyseGaitGroup([
        {
          ...sideInput(frames, narrowerPicture(s.standing, 0.2, 0.8), spec, s.model),
          setup: { ...setupOf(spec), heightCm: Math.round(s.heightCm) },
        },
      ]);
      const v = walkVerdict(views);
      expect(v.level).toBe("timing");
      expect(v.cleanCycles.left).toBeGreaterThanOrEqual(2);
      expect(v.cleanCycles.right).toBeGreaterThanOrEqual(2);
      expect(within(v.cadence, s.truth.cadence, 0.05)).toBe(true);
    });
});

describe("the v7.2 row: a timing reading of 6 and 8 clean cycles named too_few_cycles", () => {
  // A landscape phone 3 m from the path, the walker out of the picture at each end: the data's
  // reading loses the far leg's cycles (it hides behind the near one) and the steps at each end, so it
  // is under 6 a side, and the timing reading has 6 or more.
  for (const seed of [1, 2, 3])
    it(`is a timing reading that no longer names too_few_cycles with 6 a side or more (seed ${seed})`, () => {
      const spec: WalkSpec = {
        view: "side",
        passes: 4,
        seed,
        camera: { distance: 3 },
        noise: 0.003,
        jitterMs: 8,
        passShiftM: 0.3,
      };
      const w = walk(spec);
      const [r] = analyseGaitGroup([sideInput(withRealFarLeg(w.frames), w.standing, spec, "full")]);
      expect(r.quality.gatePassed).toBe(false);
      expect(isTimingReading(r)).toBe(true);
      expect(Math.min(r.quality.cleanCycles.left, r.quality.cleanCycles.right)).toBeGreaterThanOrEqual(6);
      expect(r.quality.issues).not.toContain("too_few_cycles");
      expect(walkVerdict([r]).level).toBe("timing");
    });
});
