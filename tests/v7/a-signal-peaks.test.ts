/**
 * src/engine/signal/peaks.ts against SciPy find_peaks (product v7 contract 2.12 and 6.2): the peak
 * indices exactly and the prominences within 1e-9 on the inputs of tests/golden/find_peaks.json
 * (scripts/golden/make_golden.py), including plateaus, ties, edges and a distance that is not whole.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPeaks } from "../../src/engine/signal/peaks";

interface Case {
  name: string;
  x: number[];
  distance?: number;
  prominence?: number;
  peaks: number[];
  prominences: number[];
}
const GOLDEN = JSON.parse(readFileSync(join(__dirname, "../golden/find_peaks.json"), "utf8")) as {
  scipy: string;
  cases: Case[];
};

describe("findPeaks against SciPy", () => {
  it("covers the cases the gait engine needs", () => {
    expect(GOLDEN.scipy).toMatch(/^1\./);
    expect(GOLDEN.cases.some((c) => c.distance !== undefined && c.prominence !== undefined)).toBe(true);
  });

  for (const c of GOLDEN.cases) {
    it(c.name, () => {
      const opts = { distance: c.distance, prominence: c.prominence };
      for (const xs of [c.x, Float64Array.from(c.x)]) {
        const got = findPeaks(xs, opts);
        expect(got.peaks).toEqual(c.peaks);
        expect(got.prominences).toHaveLength(c.prominences.length);
        got.prominences.forEach((p, i) => expect(Math.abs(p - c.prominences[i])).toBeLessThan(1e-9));
      }
    });
  }

  it("refuses a distance under 1, as SciPy does", () => {
    expect(() => findPeaks([0, 1, 0], { distance: 0.5 })).toThrow(RangeError);
    expect(() => findPeaks([0, 1, 0], { distance: Number.NaN })).toThrow(RangeError);
  });

  it("finds nothing in a signal shorter than three samples or without a rise and fall", () => {
    expect(findPeaks([], {})).toEqual({ peaks: [], prominences: [] });
    expect(findPeaks([1, 2], {})).toEqual({ peaks: [], prominences: [] });
    expect(findPeaks([1, 2, 3, 4], {})).toEqual({ peaks: [], prominences: [] });
    expect(findPeaks([3, 3, 3], {})).toEqual({ peaks: [], prominences: [] });
  });

  it("keeps the later of two equal peaks closer than the distance (a stable order, as SciPy on small inputs)", () => {
    expect(findPeaks([0, 2, 0, 2, 0], { distance: 3 }).peaks).toEqual([3]);
  });
});
