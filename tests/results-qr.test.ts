/**
 * The QR code of the S50 register block, drawn on the device with the check's one encoder
 * (src/features/assessment/shared/qr.ts; UX spec S50, 5.9): byte mode, level M. Checked against the
 * published reference values of ISO/IEC 18004 (the Reed Solomon codewords of the standard's HELLO
 * WORLD example, the level M format strings, the version 7 information), the function patterns, and
 * the size of each version. e2e/results.spec.ts decodes the rendered code with the browser's reader.
 */
import { describe, expect, it } from "vitest";
import {
  alignmentPositions,
  encodeQr,
  formatBits,
  numDataCodewords,
  qrPath,
  reedSolomonDivisor,
  reedSolomonRemainder,
  versionBits,
  versionFor,
} from "../src/features/assessment/shared/qr";

describe("the QR encoder at level M (S50)", () => {
  it("computes the Reed Solomon codewords of the reference example (1 M, HELLO WORLD)", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(reedSolomonRemainder(data, reedSolomonDivisor(10))).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });

  it("writes the level M format strings and the version information", () => {
    // The level M format strings, with the 101010000010010 mask of the standard applied (Annex C).
    const masked = (mask: number) => formatBits("M", mask);
    expect(masked(0)).toBe(0b101010000010010);
    expect(masked(4)).toBe(0b100010111111001);
    expect(masked(7)).toBe(0b100101010100000);
    expect(versionBits(7)).toBe(0x07c94);
  });

  it("knows the data capacity and alignment of each version at level M", () => {
    expect(numDataCodewords(1, "M")).toBe(16);
    expect(numDataCodewords(2, "M")).toBe(28);
    expect(numDataCodewords(10, "M")).toBe(216);
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
  });

  it("picks the smallest version that holds the text", () => {
    expect(versionFor(14, "M")).toBe(1);
    expect(versionFor(15, "M")).toBe(2);
    expect(versionFor(213, "M")).toBe(10);
    expect(versionFor(214, "M")).toBe(11);
  });

  it("draws the finder patterns, the timing pattern and the dark module", () => {
    const qr = encodeQr("https://azm-spark.gymwise.ai/?app=1&register=1");
    expect(qr.size).toBe(qr.version * 4 + 17);
    const m = qr.modules;
    const finder = (x0: number, y0: number) => {
      for (let y = 0; y < 7; y++)
        for (let x = 0; x < 7; x++) {
          const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
          expect(m[y0 + y][x0 + x], `finder ${x0},${y0} at ${x},${y}`).toBe(ring !== 2);
        }
    };
    finder(0, 0);
    finder(qr.size - 7, 0);
    finder(0, qr.size - 7);
    for (let i = 8; i < qr.size - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
    expect(m[qr.size - 8][8]).toBe(true);
  });

  it("writes the chosen mask in both copies of the format information", () => {
    const qr = encodeQr("https://example.test/?app=1&register=1");
    const bits = formatBits("M", qr.mask);
    const m = qr.modules;
    const get = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) expect(m[i][8]).toBe(get(i));
    expect(m[7][8]).toBe(get(6));
    for (let i = 0; i < 8; i++) expect(m[8][qr.size - 1 - i]).toBe(get(i));
  });

  it("draws every dark module inside the four module quiet zone", () => {
    const qr = encodeQr("A");
    const d = qrPath(qr);
    expect(d.startsWith("M4 4")).toBe(true);
    // Each run of dark modules is one horizontal rectangle; the runs cover every dark module.
    const covered = [...d.matchAll(/M(\d+) (\d+)h(\d+)/g)].reduce((n, r) => n + Number(r[3]), 0);
    expect(covered).toBe(qr.modules.flat().filter(Boolean).length);
  });
});
