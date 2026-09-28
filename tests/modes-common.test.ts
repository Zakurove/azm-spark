/**
 * Shared helpers of the engine modes (src/engine/modes/common.ts): the 0.5 s sustained peak, the
 * running median, persistence, side labels and the roll convention.
 */
import { describe, expect, it } from "vitest";
import {
  acrossVector,
  downVector,
  leanFromVertical,
  Persist,
  RunningMedian,
  sideLandmarks,
  signedAngle,
  SustainedPeak,
} from "../src/engine/modes/common";
import { toPixelSpace } from "../src/engine/geometry";
import { fixtureFrames } from "./fixtures/format";
import { generate } from "./fixtures/gen";

/** Samples of a signal at `fps` for `sec` seconds. */
const sampled = (fps: number, sec: number, f: (t: number) => number) =>
  Array.from({ length: Math.round(sec * fps) + 1 }, (_, i) => {
    const t = Math.round((i * 1000) / fps);
    return { t, v: f(t / 1000) };
  });

function peakOf(samples: { t: number; v: number }[], holdMs = 500) {
  const p = new SustainedPeak(holdMs);
  for (const s of samples) p.push(s.t, s.v);
  return p.best?.value ?? null;
}

describe("SustainedPeak: the maximum over time of the rolling 0.5 s window minimum", () => {
  for (const fps of [12, 15, 20, 30, 60]) {
    it(`at ${fps} fps a plateau held 0.6 s counts and one held under 0.5 s does not`, () => {
      const plateau = (len: number) => (t: number) => (t >= 1 && t < 1 + len ? 100 : 40);
      expect(peakOf(sampled(fps, 3, plateau(0.6)))).toBe(100);
      expect(peakOf(sampled(fps, 3, plateau(0.45)))).toBe(40);
      expect(peakOf(sampled(fps, 3, plateau(0.2)))).toBe(40);
    });
  }

  it("needs samples spanning the whole hold time before it reports", () => {
    const p = new SustainedPeak(500);
    expect(p.push(0, 10)).toBeNull();
    expect(p.push(250, 10)).toBeNull();
    expect(p.push(499, 10)).toBeNull();
    expect(p.push(500, 12)).toBe(10);
    expect(p.best).toEqual({ value: 10, t: 500, from: 0 });
  });

  it("a gap (paused frames or frames too far apart) starts the window again but keeps the best", () => {
    const p = new SustainedPeak(500, 250);
    for (let t = 0; t <= 600; t += 50) p.push(t, 50);
    expect(p.best?.value).toBe(50);
    p.gap();
    expect(p.push(700, 90)).toBeNull();
    for (let t = 750; t <= 1100; t += 50) p.push(t, 90);
    expect(p.best?.value).toBe(50);
    // More than 250 ms between frames breaks the run as well.
    p.push(1500, 90);
    expect(p.push(1700, 90)).toBeNull();
    expect(p.best?.value).toBe(50);
  });

  it("a ramp reads the value held for 0.5 s at its top", () => {
    const ramp = sampled(30, 4, (t) => (t < 2 ? 50 * t : 100));
    expect(peakOf(ramp)).toBe(100);
    const ramp2 = sampled(30, 3, (t) => Math.min(100, 50 * t));
    expect(peakOf(ramp2)).toBe(100);
    const up = sampled(30, 2, (t) => 50 * t);
    expect(peakOf(up)!).toBeCloseTo(75, 0);
  });
});

describe("RunningMedian", () => {
  it("removes a blip shorter than half the window and keeps a plateau's length", () => {
    const m = new RunningMedian(300);
    const at15 = sampled(15, 3, (t) => (Math.abs(t - 1) < 0.05 ? 150 : t >= 2 && t < 2.6 ? 100 : 40));
    const out = at15.map((s) => ({ t: s.t, v: m.push(s.t, s.v) }));
    expect(Math.max(...out.filter((s) => s.t < 1500).map((s) => s.v))).toBe(40);
    const high = out.filter((s) => s.v === 100);
    const raw = at15.filter((s) => s.v === 100);
    expect(high.length).toBe(raw.length);
  });

  it("always returns one of the samples (an odd count)", () => {
    const m = new RunningMedian(300);
    const vals = [1, 7, 3, 9, 5, 2, 8];
    vals.forEach((v, i) => expect(vals).toContain(m.push(i * 83, v)));
    m.reset();
    expect(m.push(10_000, 4)).toBe(4);
  });
});

describe("Persist", () => {
  it("counts a condition once it held for its time, and remembers that it did", () => {
    const p = new Persist(0.2);
    expect(p.update(0, true)).toBe(false);
    expect(p.update(150, true)).toBe(false);
    expect(p.update(200, true)).toBe(true);
    expect(p.hit).toBe(true);
    expect(p.update(250, false)).toBe(false);
    expect(p.update(300, true)).toBe(false);
    expect(p.hit).toBe(true);
    p.reset();
    expect(p.hit).toBe(false);
  });
});

describe("side labels and the roll convention", () => {
  it("MediaPipe's own labels, swapped for a mirrored picture", () => {
    expect(sideLandmarks("left").shoulder).toBe(11);
    expect(sideLandmarks("right").elbow).toBe(14);
    expect(sideLandmarks("left", true).shoulder).toBe(12);
    expect(sideLandmarks("right", true).hand).toEqual([15, 17, 19, 21]);
  });

  it("the downward vertical of a rolled picture matches the camera model", () => {
    for (const roll of [-6, 0, 4]) {
      const fx = generate({
        test: "trunk_control_seated",
        profile: "chair",
        aspect: "9:16",
        fps: 10,
        durationSec: 0.2,
        seed: 3,
        noise: 0,
        camera: { rollDeg: roll },
      });
      const f = fixtureFrames(fx)[0];
      const p = toPixelSpace(f.lm, f.aspect);
      const hip = { x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 };
      const sh = { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 };
      // An upright trunk reads 0 once the roll is taken out.
      expect(leanFromVertical(hip, sh, roll)).toBeCloseTo(0, 1);
      const down = downVector(roll);
      const trunkDown = { x: hip.x - sh.x, y: hip.y - sh.y };
      const n = Math.hypot(trunkDown.x, trunkDown.y);
      expect(trunkDown.x / n).toBeCloseTo(down.x, 3);
      expect(trunkDown.y / n).toBeCloseTo(down.y, 3);
      const across = acrossVector(roll);
      expect(across.x * down.x + across.y * down.y).toBeCloseTo(0, 9);
    }
  });

  it("signed angles are positive toward the given side", () => {
    const down = { x: 0, y: 1 };
    expect(signedAngle(down, { x: 1, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90);
    expect(signedAngle(down, { x: 1, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(-90);
    expect(signedAngle(down, { x: 0.01, y: -1 }, { x: 1, y: 0 })).toBeGreaterThan(179);
    expect(signedAngle(down, { x: -0.01, y: -1 }, { x: 1, y: 0 })).toBeLessThan(-179);
  });
});

describe("CalibrationRounds (O35)", () => {
  it("doubles the tolerance after 10 s, offers at 20 s, gives up at the end of the second round", async () => {
    const { CalibrationRounds, CALIBRATION_ROUNDS } = await import("../src/engine/modes/common");
    expect(CALIBRATION_ROUNDS).toEqual({ widenAfterSec: 10, widenFactor: 2, roundSec: 20, maxRounds: 2 });
    const r = new CalibrationRounds();
    r.begin(1000);
    expect(r.tolerance(10, 1000)).toBe(10);
    expect(r.tolerance(10, 10999)).toBe(10);
    expect(r.tolerance(10, 11000)).toBe(20);
    expect(r.due(20999)).toBeNull();
    expect(r.due(21000)).toBe("offer");
    r.retry(25000);
    expect(r.round).toBe(2);
    // The second round keeps the widened tolerance from its start.
    expect(r.tolerance(10, 25000)).toBe(20);
    expect(r.due(44999)).toBeNull();
    expect(r.due(45000)).toBe("give_up");
    // A calibration taken again starts over.
    r.begin(50000);
    expect(r.round).toBe(1);
    expect(r.tolerance(10, 50000)).toBe(10);
    expect(r.due(70000)).toBe("offer");
  });
});
