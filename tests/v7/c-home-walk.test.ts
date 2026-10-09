/**
 * D-035 item 2: the walk at home. A phone stands against a wall or on a shelf; the person walks across
 * the picture and back on a path of about 3 m (the side view, the main one), or toward the phone and
 * away again, turning before it (the front view). Every turn is inside the picture. The data's reading
 * (the 1 s turn margins, two steps dropped at each in view start, stop or turn, 6 clean cycles a side)
 * leaves no cycle on such a walk; below its gate the engine reads the same frames again for timing
 * only (GAIT_MVP, an MVP interim: the turn itself and one step at each end left out, the patterns
 * keep the full gate), so the walk gives its cadence and step times. A walk the model tracks badly
 * never gives a timing only result: G1's real model walk made overground (c-pad-near-limb) is the
 * guard.
 */
import { describe, expect, it } from "vitest";
import { analyseGaitGroup, consistent, groupPassed, isTimingReading } from "../../src/engine/gait/analyse";
import { passesOf } from "../../src/engine/gait/passes";
import { prepare } from "../../src/engine/gait/preprocess";
import { GAIT_MVP } from "../../src/engine/gait/params";
import type { GaitViewResult } from "../../src/engine/gait/types";
import { setupOf, walk, type WalkSpec } from "../fixtures/gait/gen-gait";
import { overgroundFromPad } from "../fixtures/gait/smoke";

const FACE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** The views of one recording of a walk, read together as the capture reads them (analyseGaitGroup). */
function read(
  spec: WalkSpec,
  views: ("side" | "front" | "back")[],
): { r: GaitViewResult[]; truth: ReturnType<typeof walk>["truth"] } {
  const w = walk(spec);
  const r = analyseGaitGroup(
    views.map((view) => ({
      view,
      setup: setupOf(spec),
      standing: w.standing,
      frames: w.frames,
      poseModel: "full" as const,
      rollDeg: 0,
    })),
  );
  return { r, truth: w.truth };
}

const within = (v: number | null | undefined, truth: number, share: number) =>
  v !== null && v !== undefined && Math.abs(v / truth - 1) <= share;

describe("the side view at home: across the picture and back on a 3 m path, turning in it", () => {
  const walks: [number, number, number][] = [
    // speed (m/s), cadence (steps a minute), seed
    [1.2, 108, 3],
    [1.0, 100, 5],
    [0.8, 92, 7],
    [1.3, 116, 11],
  ];
  for (const [speed, cadence, seed] of walks)
    for (const distance of [3, 4])
      it(`gives its cadence and step times, timing only below the full gate (${speed} m/s, ${cadence} steps a minute, phone ${distance} m away)`, () => {
        const {
          r: [r],
          truth,
        } = read(
          {
            view: "side",
            passes: 6,
            home: { pathM: 3 },
            // A person's turns land a little earlier or later, on either foot.
            passShiftM: 0.3,
            camera: { distance },
            speed,
            cadence,
            seed,
            noise: 0.002,
            jitterMs: 8,
          },
          ["side"],
        );
        // Below the full gate (a slow walk may pass it on 3 m), the timing only reading.
        if (!r.quality.gatePassed) expect(isTimingReading(r)).toBe(true);
        expect(r.quality.cleanCycles.left).toBeGreaterThanOrEqual(GAIT_MVP.timingCyclesPerSide);
        expect(r.quality.cleanCycles.right).toBeGreaterThanOrEqual(GAIT_MVP.timingCyclesPerSide);
        expect(within(r.metrics.cadence?.value, truth.cadence, 0.05)).toBe(true);
        expect(within(r.metrics.step_time_s?.sides?.left, truth.stepSec, 0.05)).toBe(true);
        expect(within(r.metrics.step_time_s?.sides?.right, truth.stepSec, 0.05)).toBe(true);
        // Timing only: never an angle or a length from the turn's steps.
        if (!r.quality.gatePassed) {
          expect(r.metrics.knee_swing_peak).toBeUndefined();
          expect(r.metrics.step_length_m).toBeUndefined();
          expect(r.replay).toBeNull();
        }
      });

  it("keeps the data's reading for a walk that passes the full gate (a 6 m path, out of the picture to turn)", () => {
    const {
      r: [r],
      truth,
    } = read({ view: "side", passes: 4, seed: 3 }, ["side"]);
    expect(r.quality.gatePassed).toBe(true);
    expect(r.quality.timingOnly).toBe(false);
    expect(r.metrics.knee_swing_peak).toBeDefined();
    expect(within(r.metrics.cadence?.value, truth.cadence, 0.05)).toBe(true);
  });
});

describe("the front view at home: toward a phone against a wall, turning before it", () => {
  for (const seed of [3, 5, 9])
    it(`splits the walk into toward and away passes by the direction in depth, with no face seen (seed ${seed})`, () => {
      const spec: WalkSpec = {
        view: "front",
        passes: 4,
        home: { farM: 5.5, nearM: 1.2 },
        passShiftM: 0.4,
        camera: { lateral: 0.3 },
        seed,
        noise: 0.002,
        jitterMs: 8,
        // The model never finds the face (hair, a cap, the light): the facing cannot split the passes.
        occlude: [{ from: 0, to: 1e6, landmarks: FACE, visibility: 0.05 }],
      };
      const w = walk(spec);
      const p = prepare(w.frames, { rollDeg: 0, labels: "facing" });
      const front = passesOf(p, "front", undefined);
      const back = passesOf(p, "back", undefined);
      // Every true toward pass holds a front pass, every true away pass a back pass, and no pass lies
      // in a true pass of the other direction.
      const mid = (x: { start: number; end: number }) =>
        ((p.series.t[x.start] + p.series.t[x.end - 1]) / 2) * 1000;
      const inside = (m: number, kind: string) =>
        w.truth.passes.some((x) => x.kind === kind && m >= x.from && m <= x.to);
      for (const [motion, kind, otherKind] of [
        [front, "toward", "away"],
        [back, "away", "toward"],
      ] as const) {
        for (const x of w.truth.passes.filter((x) => x.kind === kind))
          expect(motion.passes.some((pass) => mid(pass) >= x.from && mid(pass) <= x.to)).toBe(true);
        for (const pass of motion.passes) expect(inside(mid(pass), otherKind)).toBe(false);
      }
    });

  for (const seed of [3, 5, 9])
    it(`gives its cadence from the toward passes and 3 clean cycles a side across both views (seed ${seed})`, () => {
      const spec: WalkSpec = {
        view: "front",
        passes: 4,
        home: { farM: 5.5, nearM: 1.2 },
        passShiftM: 0.4,
        camera: { lateral: 0.3 },
        seed,
        noise: 0.002,
        jitterMs: 8,
      };
      const {
        r: [front, back],
        truth,
      } = read(spec, ["front", "back"]);
      // The data's gate as a group (C3-1), or the timing only reading of both views below it.
      expect(groupPassed([front, back]) || [front, back].every(isTimingReading)).toBe(true);
      const left = front.quality.cleanCycles.left + back.quality.cleanCycles.left;
      const right = front.quality.cleanCycles.right + back.quality.cleanCycles.right;
      expect(left).toBeGreaterThanOrEqual(GAIT_MVP.timingCyclesPerSide);
      expect(right).toBeGreaterThanOrEqual(GAIT_MVP.timingCyclesPerSide);
      expect(within(front.metrics.cadence?.value, truth.cadence, 0.05)).toBe(true);
    });
});

describe("a short wall walk (from 4 m) needs the timing only reading", () => {
  for (const seed of [3, 5])
    it(`gives the timing only reading of both views with the cadence within 5% (seed ${seed})`, () => {
      const spec: WalkSpec = {
        view: "front",
        passes: 4,
        home: { farM: 4, nearM: 1.2 },
        passShiftM: 0.4,
        camera: { lateral: 0.3 },
        seed,
        noise: 0.002,
        jitterMs: 8,
      };
      const {
        r: [front, back],
        truth,
      } = read(spec, ["front", "back"]);
      expect(groupPassed([front, back])).toBe(false);
      expect(isTimingReading(front)).toBe(true);
      expect(within(front.metrics.cadence?.value, truth.cadence, 0.05)).toBe(true);
    });
});

describe("the guard: a walk the model tracks badly never gives a timing only result", () => {
  const layouts = [
    [6.5, 4],
    [5, 6],
    [7.5, 4],
  ] as const;
  for (const name of ["gait-pad-side-full", "gait-pad-side-lite"] as const)
    for (const [passSec, passes] of layouts)
      it(`${name}, ${passes} passes of ${passSec} s`, () => {
        const w = overgroundFromPad(name, passSec, passes);
        const [r] = analyseGaitGroup([
          {
            view: "side",
            setup: w.setup,
            standing: w.standing,
            frames: w.frames,
            poseModel: w.model,
            rollDeg: 0,
          },
        ]);
        const shown = r.quality.gatePassed || r.quality.timingOnly;
        if (shown) expect(within(r.metrics.cadence?.value, w.truth.cadence, 0.05)).toBe(true);
        else expect(r.quality.issues).toContain("too_few_cycles");
      });

  it("asks that most of the steady cycles pass every other check", () => {
    const c = (clean: boolean, drop?: "order" | "swap" | "turn" | "pass_edge") => ({
      clean,
      ...(drop ? { drop } : {}),
    });
    expect(consistent([c(true), c(true), c(false, "order")])).toBe(true);
    expect(consistent([c(true), c(false, "swap"), c(false, "order")])).toBe(false);
    // Turn and pass edge drops are the steady state rules at work, not the tracking.
    expect(consistent([c(true), c(false, "turn"), c(false, "pass_edge"), c(false, "turn")])).toBe(true);
    expect(consistent([c(false, "turn")])).toBe(false);
  });
});
