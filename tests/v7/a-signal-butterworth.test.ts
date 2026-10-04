/**
 * src/engine/signal/butterworth.ts against SciPy (product v7 contract 2.12 and 6.2): the low pass
 * design and the zero phase filter match butter(output="sos"), sos2tf and sosfiltfilt within 1e-9 on
 * the inputs of tests/golden/butter_filtfilt.json (scripts/golden/make_golden.py).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filtfilt, filtfiltPadlen, lowpassSos } from "../../src/engine/signal/butterworth";

interface Case {
  name: string;
  order: number;
  cutoffHz: number;
  fs: number;
  sos: number[][];
  b: number[];
  a: number[];
  x: number[];
  y: number[];
}
const GOLDEN = JSON.parse(readFileSync(join(__dirname, "../golden/butter_filtfilt.json"), "utf8")) as {
  scipy: string;
  cases: Case[];
};
const TOL = 1e-9;

/** The transfer function of a cascade: the product of the section polynomials. */
function transfer(sos: number[][]): { b: number[]; a: number[] } {
  const mul = (p: number[], q: number[]) => {
    const out = new Array<number>(p.length + q.length - 1).fill(0);
    p.forEach((pi, i) => q.forEach((qj, j) => (out[i + j] += pi * qj)));
    return out;
  };
  let b = [1];
  let a = [1];
  for (const [b0, b1, b2, a0, a1, a2] of sos) {
    b = mul(b, [b0, b1, b2]);
    a = mul(a, [a0, a1, a2]);
  }
  return { b, a };
}

/** SciPy's sos2tf keeps trailing zeros of a padded first order section; compare the leading terms. */
function expectPoly(got: number[], want: number[]) {
  const n = Math.max(got.length, want.length);
  for (let i = 0; i < n; i++) expect(Math.abs((got[i] ?? 0) - (want[i] ?? 0))).toBeLessThan(TOL);
}

function maxDiff(got: ArrayLike<number>, want: ArrayLike<number>): number {
  expect(got.length).toBe(want.length);
  let m = 0;
  for (let i = 0; i < want.length; i++) m = Math.max(m, Math.abs(got[i] - want[i]));
  return m;
}

describe("lowpassSos against SciPy butter", () => {
  it("was generated from SciPy 1.x", () => {
    expect(GOLDEN.scipy).toMatch(/^1\./);
    expect(GOLDEN.cases.length).toBeGreaterThanOrEqual(9);
  });

  for (const c of GOLDEN.cases) {
    it(`designs the same filter: ${c.name}`, () => {
      const sos = lowpassSos(c.order, c.cutoffHz, c.fs);
      expect(sos).toHaveLength(Math.ceil(c.order / 2));
      for (const row of sos) {
        expect(row).toHaveLength(6);
        expect(row[3]).toBe(1);
      }
      const tf = transfer(sos);
      expectPoly(tf.b, c.b);
      expectPoly(tf.a, c.a);
    });
  }

  it("gives SciPy's very coefficients for one section (oss.md 5: order 2 at 6 Hz, 30 fps)", () => {
    const c = GOLDEN.cases.find((k) => k.order === 2 && k.cutoffHz === 6)!;
    const [row] = lowpassSos(2, 6, 30);
    row.forEach((v, i) => expect(Math.abs(v - c.sos[0][i])).toBeLessThan(TOL));
    expect(row[0]).toBeCloseTo(0.206572, 6);
    expect(row[4]).toBeCloseTo(-0.369527, 6);
    expect(row[5]).toBeCloseTo(0.195816, 6);
  });

  it("refuses a cutoff outside (0, fs / 2) and an order that is not a positive whole number", () => {
    expect(() => lowpassSos(2, 15, 30)).toThrow(RangeError);
    expect(() => lowpassSos(2, 0, 30)).toThrow(RangeError);
    expect(() => lowpassSos(2, -1, 30)).toThrow(RangeError);
    expect(() => lowpassSos(0, 5, 30)).toThrow(RangeError);
    expect(() => lowpassSos(2.5, 5, 30)).toThrow(RangeError);
    expect(() => lowpassSos(2, Number.NaN, 30)).toThrow(RangeError);
  });
});

describe("filtfilt against SciPy sosfiltfilt", () => {
  for (const c of GOLDEN.cases) {
    it(`matches within 1e-9 with our design: ${c.name}`, () => {
      expect(maxDiff(filtfilt(c.x, lowpassSos(c.order, c.cutoffHz, c.fs)), c.y)).toBeLessThan(TOL);
    });
    it(`matches within 1e-9 with SciPy's own sections: ${c.name}`, () => {
      expect(maxDiff(filtfilt(Float64Array.from(c.x), c.sos), c.y)).toBeLessThan(TOL);
    });
  }

  it("returns a new Float64Array and leaves the input alone", () => {
    const c = GOLDEN.cases[0];
    const xs = [...c.x];
    const typed = Float64Array.from(c.x);
    const out = filtfilt(xs, lowpassSos(2, 5, 30));
    const outTyped = filtfilt(typed, lowpassSos(2, 5, 30));
    expect(out).toBeInstanceOf(Float64Array);
    expect(out).not.toBe(typed);
    expect(outTyped).not.toBe(typed);
    expect(xs).toEqual(c.x);
    expect(Array.from(typed)).toEqual(c.x);
  });

  it("pads like SciPy: 3 x (2 x sections + 1), less 3 per padded first order section", () => {
    // SciPy 1.17.1: the shortest signal sosfiltfilt accepts is the pad plus one (7, 10, 13, 16).
    expect(filtfiltPadlen(lowpassSos(1, 5, 30))).toBe(6);
    expect(filtfiltPadlen(lowpassSos(2, 5, 30))).toBe(9);
    expect(filtfiltPadlen(lowpassSos(3, 5, 30))).toBe(12);
    expect(filtfiltPadlen(lowpassSos(4, 5, 30))).toBe(15);
  });

  it("refuses a signal no longer than the pad, as SciPy does", () => {
    const sos = lowpassSos(2, 5, 30);
    expect(() => filtfilt(new Array(9).fill(1), sos)).toThrow(RangeError);
    expect(filtfilt(new Array(10).fill(1), sos)).toHaveLength(10);
  });

  it("keeps a constant signal constant (steady state start)", () => {
    const out = filtfilt(new Array(40).fill(7.5), lowpassSos(4, 5, 30));
    for (const v of out) expect(Math.abs(v - 7.5)).toBeLessThan(1e-12);
  });

  it("refuses sections that are not six numbers with a0 = 1", () => {
    const x = new Array(40).fill(1);
    expect(() => filtfilt(x, [[0.2, 0.4, 0.2, 2, -0.3, 0.1]])).toThrow(RangeError);
    expect(() => filtfilt(x, [[0.2, 0.4, 0.2, 1, -0.3]])).toThrow(RangeError);
    expect(() => filtfilt(x, [])).toThrow(RangeError);
  });
});
