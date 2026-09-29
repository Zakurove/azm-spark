/**
 * The one QR code encoder of the check (UX spec 5.9 QrLinkProps: "generated on device"): the S04 phone
 * link, the S50 register code and the S55 visitor token. Nothing is sent anywhere to draw a code, so a
 * visitor token never leaves the staff phone except as the picture the visitor scans.
 *
 * Byte mode (UTF-8), versions 1 to 40, error correction L, M, Q or H, the mask with the lowest penalty
 * (ISO/IEC 18004). The matrix is `modules[y][x]`, true for a dark module, without the quiet zone.
 * The structure follows the well known reference design (finder, timing and alignment patterns,
 * format and version information, Reed Solomon codewords over GF(256) with the polynomial 0x11D,
 * interleaved blocks, zigzag placement).
 */

export type QrEcc = "L" | "M" | "Q" | "H";

export interface QrMatrix {
  version: number;
  size: number;
  ecc: QrEcc;
  mask: number;
  /** modules[y][x]: true is dark. */
  modules: boolean[][];
}

const ECC_ORDER: Record<QrEcc, number> = { L: 0, M: 1, Q: 2, H: 3 };
/** The two format bits of each level (L 01, M 00, Q 11, H 10). */
export const ECC_FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Index 0 is unused; one row per level in the order L, M, Q, H.
const ECC_CODEWORDS_PER_BLOCK: readonly (readonly number[])[] = [
  [
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  [
    -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30,
    28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
];
const NUM_ERROR_CORRECTION_BLOCKS: readonly (readonly number[])[] = [
  [
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16,
    17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28,
    29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  [
    -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35,
    38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  [
    -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42,
    45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
];

/* ------------------------------------------------------------------ sizes */

/** The data and error correction modules of a version (every module that is not a function pattern). */
export function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

/** The data codewords of a version and level (the raw codewords less the error correction ones). */
export function numDataCodewords(ver: number, ecc: QrEcc): number {
  const e = ECC_ORDER[ecc];
  return (
    Math.floor(numRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK[e][ver] * NUM_ERROR_CORRECTION_BLOCKS[e][ver]
  );
}

/** The block layout of a version and level (for tests and the decoder check). */
export function blockLayout(ver: number, ecc: QrEcc): { blocks: number; eccPerBlock: number } {
  const e = ECC_ORDER[ecc];
  return { blocks: NUM_ERROR_CORRECTION_BLOCKS[e][ver], eccPerBlock: ECC_CODEWORDS_PER_BLOCK[e][ver] };
}

/** The bits of the byte mode character count (8 up to version 9, then 16). */
const countBits = (ver: number) => (ver <= 9 ? 8 : 16);

/** The centres of the alignment patterns, on both axes. */
export function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const size = ver * 4 + 17;
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/* ------------------------------------------------------------------ Reed Solomon */

/** Product in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1 (0x11D). */
export function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** The generator polynomial of the given degree, highest term first, the leading 1 left out. */
export function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** The error correction codewords of a block. */
export function reedSolomonRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

/* ------------------------------------------------------------------ encoding */

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** The smallest version (1 to 40) whose data codewords hold the text at this level, or null. */
export function versionFor(byteLength: number, ecc: QrEcc): number | null {
  for (let ver = 1; ver <= 40; ver++) {
    const bits = 4 + countBits(ver) + byteLength * 8;
    if (bits <= numDataCodewords(ver, ecc) * 8) return ver;
  }
  return null;
}

/** The data codewords: mode, count, bytes, terminator, then the pad bytes 0xEC and 0x11. */
export function dataCodewords(bytes: readonly number[], ver: number, ecc: QrEcc): number[] {
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, countBits(ver));
  for (const b of bytes) push(b, 8);
  const capacity = numDataCodewords(ver, ecc) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out.push(v);
  }
  for (let pad = 0xec; out.length < capacity / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Splits the data into blocks, adds each block's error correction and interleaves them. */
export function addEccAndInterleave(data: readonly number[], ver: number, ecc: QrEcc): number[] {
  const { blocks: numBlocks, eccPerBlock } = blockLayout(ver, ecc);
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = reedSolomonDivisor(eccPerBlock);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - eccPerBlock + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const block = [...dat];
    const eccWords = reedSolomonRemainder(dat, divisor);
    if (i < numShortBlocks) block.push(0);
    blocks.push(block.concat(eccWords));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - eccPerBlock || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

/* ------------------------------------------------------------------ matrix */

const getBit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

/** The 15 format bits of a level and mask, BCH protected and masked with 0x5412. */
export function formatBits(ecc: QrEcc, mask: number): number {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up), BCH protected. */
export function versionBits(ver: number): number {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}

class Grid {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  setFunction(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }
}

function drawFunctionPatterns(g: Grid, ecc: QrEcc) {
  const size = g.size;
  for (let i = 0; i < size; i++) {
    g.setFunction(6, i, i % 2 === 0);
    g.setFunction(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) g.setFunction(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const align = alignmentPositions(g.version);
  const n = align.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // The three corners taken by the finder patterns have no alignment pattern.
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          g.setFunction(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  drawFormat(g, ecc, 0);
  if (g.version >= 7) {
    const bits = versionBits(g.version);
    for (let i = 0; i < 18; i++) {
      const dark = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      g.setFunction(a, b, dark);
      g.setFunction(b, a, dark);
    }
  }
}

function drawFormat(g: Grid, ecc: QrEcc, mask: number) {
  const bits = formatBits(ecc, mask);
  const size = g.size;
  for (let i = 0; i <= 5; i++) g.setFunction(8, i, getBit(bits, i));
  g.setFunction(8, 7, getBit(bits, 6));
  g.setFunction(8, 8, getBit(bits, 7));
  g.setFunction(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) g.setFunction(14 - i, 8, getBit(bits, i));
  for (let i = 0; i < 8; i++) g.setFunction(size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) g.setFunction(8, size - 15 + i, getBit(bits, i));
  g.setFunction(8, size - 8, true);
}

/** Places the codewords in the zigzag order, from the bottom right, two columns at a time. */
function drawCodewords(g: Grid, data: readonly number[]) {
  const size = g.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!g.isFunction[y][x] && i < data.length * 8) {
          g.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

/** Whether mask `mask` inverts the module at (x, y). */
export function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      throw new RangeError("mask");
  }
}

function applyMask(g: Grid, mask: number) {
  for (let y = 0; y < g.size; y++)
    for (let x = 0; x < g.size; x++)
      if (!g.isFunction[y][x] && maskBit(mask, x, y)) g.modules[y][x] = !g.modules[y][x];
}

/**
 * The penalty of a finished matrix (ISO/IEC 18004 7.8.3): runs of 5 or more in a line, 2 x 2 blocks,
 * finder like patterns with 4 light modules on a side, and the dark share away from 50%.
 */
export function penalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    // Finder like 1:1:3:1:1 with 4 light modules before or after (light outside the matrix).
    const at = (i: number) => (i < 0 || i >= size ? false : get(i));
    const core = [true, false, true, true, true, false, true];
    for (let i = 0; i + 7 <= size; i++) {
      if (!core.every((v, k) => at(i + k) === v)) continue;
      const before = [1, 2, 3, 4].every((k) => !at(i - k));
      const after = [1, 2, 3, 4].every((k) => !at(i + 6 + k));
      if (before) score += 40;
      if (after) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => modules[y][x]);
  for (let x = 0; x < size; x++) line((y) => modules[y][x]);
  for (let y = 0; y + 1 < size; y++)
    for (let x = 0; x + 1 < size; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
    }
  let dark = 0;
  for (const row of modules) for (const m of row) if (m) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * 10;
  return score;
}

/**
 * Encodes text as a QR code in byte mode (UTF-8) at the given level, in the smallest version that
 * holds it, with the mask of the lowest penalty (or the given one).
 */
export function encodeQr(text: string, ecc: QrEcc = "M", forceMask?: number): QrMatrix {
  const bytes = utf8(text);
  const ver = versionFor(bytes.length, ecc);
  if (ver === null) throw new RangeError("Text too long for a QR code");
  const codewords = addEccAndInterleave(dataCodewords(bytes, ver, ecc), ver, ecc);
  const base = new Grid(ver);
  drawFunctionPatterns(base, ecc);
  drawCodewords(base, codewords);
  let best: { mask: number; modules: boolean[][]; score: number } | null = null;
  const masks = forceMask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];
  for (const mask of masks) {
    const g = new Grid(ver);
    for (let y = 0; y < g.size; y++) {
      g.modules[y] = [...base.modules[y]];
      g.isFunction[y] = [...base.isFunction[y]];
    }
    applyMask(g, mask);
    drawFormat(g, ecc, mask);
    const score = penalty(g.modules);
    if (!best || score < best.score) best = { mask, modules: g.modules, score };
  }
  return { version: ver, size: ver * 4 + 17, ecc, mask: best!.mask, modules: best!.modules };
}

/** Which modules are function patterns (finders, timing, alignment, format, version), for tests. */
export function functionModules(version: number): boolean[][] {
  const g = new Grid(version);
  drawFunctionPatterns(g, "M");
  return g.isFunction;
}

/**
 * The SVG path of the dark modules, one unit per module, offset by the quiet zone (4 modules). The
 * drawing is `viewBox="0 0 size+8 size+8"`.
 */
export function qrPath(m: QrMatrix, quiet = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.modules[y][x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < m.size && m.modules[y][x + run]) run++;
      parts.push(`M${x + quiet} ${y + quiet}h${run}v1H${x + quiet}z`);
      x += run;
    }
  }
  return parts.join("");
}
