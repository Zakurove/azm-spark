/**
 * src/engine/signal/hampel.ts against the Pose2Sim hampel_filter (product v7 contract 2.12 and 6.2)
 * on the inputs of tests/golden/hampel.json (scripts/golden/make_golden.py), within 1e-9, and its
 * defaults against the runtime data (rom-protocol engine.smoothing: window 7, n sigma 2).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HAMPEL_DEFAULTS, hampel } from "../../src/engine/signal/hampel";
import { ROM_DATA } from "../../src/movements/rom";

interface Case {
  name: string;
  window: number;
  nSigma: number;
  x: (number | null)[];
  y: (number | null)[];
}
const GOLDEN = JSON.parse(readFileSync(join(__dirname, "../golden/hampel.json"), "utf8")) as {
  cases: Case[];
};
const nan = (xs: (number | null)[]) => xs.map((v) => (v === null ? Number.NaN : v));

function expectSame(got: Float64Array, want: number[]) {
  expect(got).toHaveLength(want.length);
  want.forEach((w, i) => {
    if (Number.isNaN(w)) expect(Number.isNaN(got[i]), `index ${i}`).toBe(true);
    else expect(Math.abs(got[i] - w), `index ${i}`).toBeLessThan(1e-9);
  });
}

describe("hampel against Pose2Sim", () => {
  for (const c of GOLDEN.cases) {
    it(c.name, () => {
      const x = nan(c.x);
      expectSame(hampel(x, c.window, c.nSigma), nan(c.y));
      expectSame(hampel(Float64Array.from(x), c.window, c.nSigma), nan(c.y));
    });
  }

  it("replaces at least one spike in the main case and leaves the edges alone", () => {
    const c = GOLDEN.cases[0];
    const x = nan(c.x);
    const y = hampel(x);
    expect(y.some((v, i) => v !== x[i])).toBe(true);
    for (const i of [0, 1, 2, x.length - 3, x.length - 2, x.length - 1]) expect(y[i]).toBe(x[i]);
  });

  it("defaults to window 7 and n sigma 2, the rom-protocol smoothing data", () => {
    expect(HAMPEL_DEFAULTS).toEqual({ window: 7, nSigma: 2 });
    expect(ROM_DATA.engine.smoothing.hampel).toEqual(HAMPEL_DEFAULTS);
    const x = nan(GOLDEN.cases[0].x);
    expect(Array.from(hampel(x))).toEqual(Array.from(hampel(x, 7, 2)));
  });

  it("returns a new array and leaves the input alone", () => {
    const x = [1, 2, 3, 50, 5, 6, 7, 8, 9];
    const typed = Float64Array.from(x);
    const y = hampel(typed);
    expect(y).not.toBe(typed);
    expect(Array.from(typed)).toEqual(x);
    expect(hampel(x)).toBeInstanceOf(Float64Array);
    expect(hampel([])).toHaveLength(0);
  });
});
