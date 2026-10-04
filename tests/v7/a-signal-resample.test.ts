/**
 * src/engine/signal/resample.ts (product v7 contract 2.12): uniform resampling of real frame times by
 * linear interpolation, gaps filled up to maxGapSec, a longer gap splitting the result into segments
 * (gait-rules preprocessing: "resample to uniform 30 Hz by linear interpolation"; "linear
 * interpolation up to 0.12 s; longer gap splits the bout").
 */
import { describe, expect, it } from "vitest";
import { resampleUniform } from "../../src/engine/signal/resample";

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

/** Every value inside a segment is finite and every value outside one is NaN; segments are ordered. */
function expectSegmentsCover(y: Float64Array, segments: [number, number][]) {
  const inside = new Uint8Array(y.length);
  let last = -1;
  for (const [a, b] of segments) {
    expect(a).toBeGreaterThan(last);
    expect(b).toBeGreaterThan(a);
    for (let i = a; i < b; i++) inside[i] = 1;
    last = b;
  }
  y.forEach((v, i) => expect(Number.isFinite(v), `index ${i}`).toBe(inside[i] === 1));
}

describe("resampleUniform", () => {
  it("keeps a signal already on the grid as it is, in one segment", () => {
    const t = Array.from({ length: 31 }, (_, i) => 2 + i / 30);
    const ys = t.map((x) => Math.sin(x));
    const r = resampleUniform(t, ys, 30, 0.12);
    expect(r.t).toHaveLength(31);
    r.t.forEach((v, i) => close(v, t[i]));
    r.y.forEach((v, i) => close(v, ys[i]));
    expect(r.segments).toEqual([[0, 31]]);
  });

  it("puts jittery frame times on a uniform grid from the first valid sample (exact for a straight line)", () => {
    // 24 to 30 fps with jitter, y = 3t + 1.
    const t: number[] = [];
    let now = 0.013;
    for (let i = 0; i < 60; i++) {
      t.push(now);
      now += i % 3 === 0 ? 1 / 24 : i % 3 === 1 ? 1 / 30 : 1 / 27;
    }
    const ys = t.map((x) => 3 * x + 1);
    const r = resampleUniform(t, ys, 30, 0.12);
    close(r.t[0], 0.013);
    for (let k = 1; k < r.t.length; k++) close(r.t[k] - r.t[k - 1], 1 / 30, 1e-12);
    expect(r.t[r.t.length - 1]).toBeLessThanOrEqual(t[t.length - 1] + 1e-9);
    expect(r.t[r.t.length - 1] + 1 / 30).toBeGreaterThan(t[t.length - 1]);
    r.y.forEach((v, k) => close(v, 3 * r.t[k] + 1, 1e-9));
    expect(r.segments).toEqual([[0, r.t.length]]);
  });

  it("fills a gap up to maxGapSec by linear interpolation", () => {
    // 30 fps, frames 10 and 11 missing: the valid samples around the gap are 0.1 s apart.
    const t = Array.from({ length: 30 }, (_, i) => i / 30);
    const ys: (number | null)[] = t.map((x) => 10 * x);
    ys[10] = null;
    ys[11] = null;
    const r = resampleUniform(t, ys, 30, 0.12);
    expect(r.segments).toEqual([[0, 30]]);
    close(r.y[10], 10 * (10 / 30));
    close(r.y[11], 10 * (11 / 30));
  });

  it("fills a gap of exactly maxGapSec", () => {
    const r = resampleUniform([0, 0.1, 0.2], [0, 1, 2], 20, 0.1);
    expect(r.segments).toEqual([[0, 5]]);
    close(r.y[1], 0.5);
  });

  it("splits at a gap longer than maxGapSec: the grid points inside it are NaN", () => {
    const t = Array.from({ length: 30 }, (_, i) => i / 30);
    const ys: (number | null)[] = t.map((x) => x);
    for (const i of [10, 11, 12, 13]) ys[i] = null; // valid samples 9 and 14 are 0.167 s apart
    const r = resampleUniform(t, ys, 30, 0.12);
    expect(r.segments).toEqual([
      [0, 10],
      [14, 30],
    ]);
    expectSegmentsCover(r.y, r.segments);
    close(r.y[14], 14 / 30);
  });

  it("splits at a long pause between frames even with no sample missing", () => {
    const t = [0, 1 / 30, 2 / 30, 0.3, 0.3 + 1 / 30];
    const r = resampleUniform(t, [1, 1, 1, 2, 2], 30, 0.12);
    expectSegmentsCover(r.y, r.segments);
    expect(r.segments).toEqual([
      [0, 3],
      [9, 11],
    ]);
  });

  it("starts at the first valid sample and ends at the last, and treats NaN as missing", () => {
    const t = [0, 0.05, 0.1, 0.15, 0.2, 0.25];
    const r = resampleUniform(t, [null, Number.NaN, 4, 5, 6, null], 20, 0.12);
    close(r.t[0], 0.1);
    expect(r.t).toHaveLength(3);
    expect(Array.from(r.y)).toEqual([4, 5, 6]);
    expect(r.segments).toEqual([[0, 3]]);
  });

  it("drops a valid sample whose time does not move forward", () => {
    const r = resampleUniform([0, 0.1, 0.1, 0.2], [0, 1, 99, 2], 10, 0.12);
    expect(Array.from(r.y)).toEqual([0, 1, 2]);
  });

  it("returns empty arrays with nothing valid", () => {
    for (const r of [resampleUniform([], [], 30, 0.12), resampleUniform([0, 1], [null, null], 30, 0.12)]) {
      expect(r.t).toHaveLength(0);
      expect(r.y).toHaveLength(0);
      expect(r.segments).toEqual([]);
    }
  });

  it("gives one sample for one valid sample", () => {
    const r = resampleUniform([0.5], [7], 30, 0.12);
    expect(Array.from(r.t)).toEqual([0.5]);
    expect(Array.from(r.y)).toEqual([7]);
    expect(r.segments).toEqual([[0, 1]]);
  });

  it("refuses a rate that is not above 0, a negative gap and lists of different lengths", () => {
    expect(() => resampleUniform([0, 1], [0, 1], 0, 0.12)).toThrow(RangeError);
    expect(() => resampleUniform([0, 1], [0, 1], Number.NaN, 0.12)).toThrow(RangeError);
    expect(() => resampleUniform([0, 1], [0, 1], 30, -1)).toThrow(RangeError);
    expect(() => resampleUniform([0, 1], [0], 30, 0.12)).toThrow(RangeError);
  });
});
