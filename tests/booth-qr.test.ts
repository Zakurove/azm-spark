/**
 * The on device QR encoder of the booth (UX spec S55 visitor token, 5.9): the ISO/IEC 18004 tables and
 * BCH codes against their published values, and a full read back of generated codes (format, unmask,
 * zigzag, blocks, Reed Solomon syndromes, byte mode) for the lengths and levels the booth uses.
 * The encoder was also checked during development against a platform decoder (CoreImage) for
 * versions 1 to 19, every mask and all four levels.
 */
import { describe, expect, it } from "vitest";
import {
  alignmentPositions,
  blockLayout,
  encodeQr,
  ECC_FORMAT_BITS,
  formatBits,
  functionModules,
  gfMultiply,
  maskBit,
  numDataCodewords,
  numRawDataModules,
  penalty,
  qrPath,
  reedSolomonDivisor,
  versionBits,
  type QrEcc,
  type QrMatrix,
} from "../src/features/assessment/shared/qr";
import { registerLink } from "../src/features/assessment/results/ResultsView";

describe("tables and codes (ISO/IEC 18004)", () => {
  it("has the published data capacities", () => {
    expect(numDataCodewords(1, "L")).toBe(19);
    expect(numDataCodewords(1, "M")).toBe(16);
    expect(numDataCodewords(1, "Q")).toBe(13);
    expect(numDataCodewords(1, "H")).toBe(9);
    expect(numDataCodewords(5, "M")).toBe(86);
    expect(numDataCodewords(6, "M")).toBe(108);
    expect(numDataCodewords(7, "M")).toBe(124);
    expect(numDataCodewords(10, "M")).toBe(216);
    expect(numDataCodewords(40, "L")).toBe(2956);
    expect(numDataCodewords(40, "M")).toBe(2334);
    expect(numRawDataModules(1)).toBe(208);
    expect(numRawDataModules(40)).toBe(29648);
  });

  it("places the alignment patterns where the standard puts them", () => {
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(10)).toEqual([6, 28, 50]);
    expect(alignmentPositions(14)).toEqual([6, 26, 46, 66]);
    expect(alignmentPositions(22)).toEqual([6, 26, 50, 74, 98]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
  });

  it("writes the published format and version bits", () => {
    expect(formatBits("M", 0).toString(2).padStart(15, "0")).toBe("101010000010010");
    expect(formatBits("L", 0).toString(2).padStart(15, "0")).toBe("111011111000100");
    expect(formatBits("Q", 0).toString(2).padStart(15, "0")).toBe("011010101011111");
    expect(formatBits("H", 0).toString(2).padStart(15, "0")).toBe("001011010001001");
    expect(formatBits("M", 7).toString(2).padStart(15, "0")).toBe("100101010100000");
    expect(formatBits("M", 1).toString(2).padStart(15, "0")).toBe("101000100100101");
    expect(versionBits(7)).toBe(0x07c94);
    expect(versionBits(40)).toBe(0x28c69);
  });

  it("multiplies in GF(256) and builds the generator polynomial of 7 codewords", () => {
    expect(gfMultiply(0, 123)).toBe(0);
    expect(gfMultiply(1, 123)).toBe(123);
    expect(gfMultiply(2, 0x80)).toBe(0x1d);
    // x^7 + 127x^6 + 122x^5 + 154x^4 + 164x^3 + 11x^2 + 68x + 117
    expect(reedSolomonDivisor(7)).toEqual([127, 122, 154, 164, 11, 68, 117]);
  });
});

/* ------------------------------------------------------------------ read back */

const LEVEL_OF_BITS: Record<number, QrEcc> = Object.fromEntries(
  Object.entries(ECC_FORMAT_BITS).map(([k, v]) => [v, k as QrEcc]),
);

/** Reads a code back: format, unmask, zigzag, deinterleave, check the syndromes, decode byte mode. */
function readBack(q: QrMatrix): { text: string; ecc: QrEcc; mask: number } {
  const size = q.size;
  const get = (x: number, y: number) => (q.modules[y][x] ? 1 : 0);
  let raw = 0;
  const firstCopy: [number, number][] = [];
  for (let i = 0; i <= 5; i++) firstCopy.push([8, i]);
  firstCopy.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) firstCopy.push([14 - i, 8]);
  firstCopy.forEach(([x, y], i) => (raw |= get(x, y) << i));
  // The second copy must agree.
  let second = 0;
  for (let i = 0; i < 8; i++) second |= get(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) second |= get(8, size - 15 + i) << i;
  expect(second).toBe(raw);
  expect(get(8, size - 8)).toBe(1);
  const data = (raw ^ 0x5412) >> 10;
  const ecc = LEVEL_OF_BITS[data >> 3];
  const mask = data & 7;
  expect(formatBits(ecc, mask)).toBe(raw);

  const fn = functionModules(q.version);
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fn[y][x]) continue;
        bits.push(get(x, y) ^ (maskBit(mask, x, y) ? 1 : 0));
      }
  }
  const total = Math.floor(numRawDataModules(q.version) / 8);
  const words: number[] = [];
  for (let i = 0; i < total; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b];
    words.push(v);
  }
  // Deinterleave.
  const { blocks, eccPerBlock } = blockLayout(q.version, ecc);
  const shortLen = Math.floor(total / blocks);
  const numShort = blocks - (total % blocks);
  const dataLen = (b: number) => shortLen - eccPerBlock + (b < numShort ? 0 : 1);
  const blockData: number[][] = Array.from({ length: blocks }, () => []);
  const blockEcc: number[][] = Array.from({ length: blocks }, () => []);
  let k = 0;
  const maxData = dataLen(blocks - 1);
  for (let i = 0; i < maxData; i++)
    for (let b = 0; b < blocks; b++) if (i < dataLen(b)) blockData[b].push(words[k++]);
  for (let i = 0; i < eccPerBlock; i++) for (let b = 0; b < blocks; b++) blockEcc[b].push(words[k++]);
  expect(k).toBe(total);
  // Every block is a codeword: its syndromes at alpha^0 .. alpha^(n-1) are zero.
  for (let b = 0; b < blocks; b++) {
    const cw = [...blockData[b], ...blockEcc[b]];
    let alpha = 1;
    for (let s = 0; s < eccPerBlock; s++) {
      let acc = 0;
      for (const c of cw) acc = gfMultiply(acc, alpha) ^ c;
      expect(acc, `block ${b} syndrome ${s}`).toBe(0);
      alpha = gfMultiply(alpha, 2);
    }
  }
  // Byte mode.
  const dataBits = blockData.flat().flatMap((w) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (w >> i) & 1));
  let at = 0;
  const take = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | dataBits[at++];
    return v;
  };
  expect(take(4)).toBe(0b0100);
  const count = take(q.version <= 9 ? 8 : 16);
  const bytes = Array.from({ length: count }, () => take(8));
  return { text: new TextDecoder().decode(new Uint8Array(bytes)), ecc, mask };
}

describe("generated codes read back", () => {
  const cases: [string, QrEcc][] = [
    [registerLink("https://web-production-898e1.up.railway.app").url, "M"],
    [registerLink("http://127.0.0.1:5205/").url, "M"],
    ["https://azm.example/?app=1", "Q"],
    ["عزم، جناح الحركة", "M"],
    ["x", "L"],
    ["a".repeat(150), "M"],
    ["b".repeat(300), "H"],
  ];
  for (const [text, level] of cases)
    it(`reads back ${text.length} characters at ${level}`, () => {
      const q = encodeQr(text, level);
      expect(q.size).toBe(q.version * 4 + 17);
      expect(readBack(q)).toEqual({ text, ecc: level, mask: q.mask });
    });

  it("reads back with every mask, and picks the mask with the lowest penalty", () => {
    const text = registerLink("https://azm.example").url;
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => {
      const q = encodeQr(text, "M", mask);
      expect(readBack(q).mask).toBe(mask);
      return penalty(q.modules);
    });
    const auto = encodeQr(text, "M");
    expect(scores[auto.mask]).toBe(Math.min(...scores));
  });

  it("draws the finder patterns and a quiet zone of 4 modules", () => {
    const q = encodeQr("finder", "M");
    const row0 = q.modules[0].slice(0, 7).map(Number).join("");
    expect(row0).toBe("1111111");
    expect(q.modules[1].slice(0, 7).map(Number).join("")).toBe("1000001");
    expect(q.modules[3].slice(0, 7).map(Number).join("")).toBe("1011101");
    expect(qrPath(q).startsWith("M4 4h7")).toBe(true);
    expect(qrPath(q)).not.toMatch(/-/);
  });

  it("puts the sign up link in a small code (version 7 or less at M)", () => {
    const q = encodeQr(registerLink("https://web-production-898e1.up.railway.app").url, "M");
    expect(q.version).toBeLessThanOrEqual(7);
  });
});
