/**
 * Step G1 (product v7 contract 8.4): the smoke page's own reading of a range video
 * (src/features/smoke/romTrace.ts): A's movement angle (src/engine/rom/angles.ts) on every frame of
 * the subject after a still start calibration, and the held end angle as the highest median over one
 * second. It shows what the model and the angle maths read on the video whether or not B's runner is
 * built; the runner's own value is the one the pass bar compares.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RomAngleTrace, rollingHold } from "../../src/features/smoke/romTrace";
import { fixtureFrames, loadFixture } from "../fixtures/format";
import type { Frame } from "../../src/engine/types";

const FIXTURE = join(__dirname, "../fixtures/shoulder_abduction/chair/raise-right-9x16.json");

describe("rollingHold", () => {
  const series = (values: number[], stepMs = 100) => values.map((deg, i) => ({ t: i * stepMs, deg }));

  it("is the highest median of any window, robust to a one frame spike", () => {
    const s = series([10, 10, 10, 90, 10, 40, 41, 40, 39, 40, 41, 40, 12]);
    // A 0.5 s window holds 6 samples at 10 Hz: the spike at 90 never wins.
    expect(rollingHold(s, 500, "max")).toEqual({ deg: 40, t: 700 });
  });

  it("takes the lowest for a lack movement, and needs enough samples in the window", () => {
    expect(rollingHold(series([30, 30, 5, 5, 5, 5, 30]), 300, "min")?.deg).toBe(5);
    expect(rollingHold(series([40, 40]), 1000, "max")).toBeNull();
    expect(rollingHold([], 1000, "max")).toBeNull();
  });
});

describe("RomAngleTrace on the generated arm raise", () => {
  const fx = loadFixture<{ armPeakDeg: { left: number; right: number } }>(FIXTURE);
  const frames = fixtureFrames(fx);

  it("reads the start angle and the held end angle within a few degrees of the truth", () => {
    // The fixture rests 0.5 s, rises 1.5 s, holds 1 s at 150 and lowers.
    const trace = new RomAngleTrace({
      movement: "shoulder_abduction",
      side: "right",
      mirrored: false,
      calibrationSec: 0.4,
    });
    for (const f of frames) trace.push(f);
    const s = trace.summary();
    expect(s.calibrated).toBe(true);
    expect(s.gravityMode).toBe(false);
    expect(s.frames).toBe(frames.length);
    expect(s.seenShare).toBe(1);
    expect(Math.abs(s.startDeg! - fx.truth.armPeakDeg.left)).toBeLessThan(4);
    expect(Math.abs(s.holdDeg! - fx.truth.armPeakDeg.right)).toBeLessThan(3);
    // The hold is in the middle of the run, the series is kept at about 5 Hz for the report.
    expect(s.holdAt).toBeGreaterThan(2000);
    expect(s.holdAt).toBeLessThan(3500);
    expect(s.series.length).toBeGreaterThan(15);
    expect(s.series.length).toBeLessThan(40);
  });

  it("reads nothing from frames without a person, and says so", () => {
    const empty: Frame[] = frames.map((f) => ({
      t: f.t,
      lm: f.lm.map((p) => ({ ...p, visibility: 0 })),
      poses: [],
    }));
    const trace = new RomAngleTrace({ movement: "shoulder_abduction", side: "right", mirrored: false });
    for (const f of empty) trace.push(f);
    expect(trace.summary()).toMatchObject({
      calibrated: false,
      subjectFrames: 0,
      angleFrames: 0,
      seenShare: 0,
      holdDeg: null,
      startDeg: null,
    });
  });

  it("reads the other arm as at rest, so a wrong side shows", () => {
    const trace = new RomAngleTrace({
      movement: "shoulder_abduction",
      side: "left",
      mirrored: false,
      calibrationSec: 0.4,
    });
    for (const f of frames) trace.push(f);
    expect(trace.summary().holdDeg!).toBeLessThan(15);
  });
});
