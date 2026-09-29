/**
 * A QR code encoder for the links of the check (S04: open the check on a phone), generated on the
 * device so it works offline and sends nothing anywhere (UX spec S04, 5.9 QrLink).
 *
 * Byte mode, error correction level M, versions 1 to 10 (up to 213 bytes, enough for any link of the
 * app), all eight masks tried and the lowest penalty kept (ISO/IEC 18004). Pure: returns the module
 * matrix, `true` for a dark module; the caller draws it with a 4 module quiet zone.
 */

/* ------------------------------------------------------------------ tables (level M) */

/** Error correction codewords per block, level M, versions 1 to 10. */
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
/** Number of error correction blocks, level M, versions 1 to 10. */
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Format bits of level M. */
const ECL_BITS = 0;

/** Modules of a version that hold data and error correction (after the function patterns). */
export function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

/** Data codewords of a version at level M. */
export function dataCodewords(ver: number): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver - 1] * BLOCKS[ver - 1];
}

/* ------------------------------------------------------------------ Reed Solomon over GF(256) */

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
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

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
  }
  return result;
}

/* ------------------------------------------------------------------ encoding */

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** The smallest version (1 to 10) that holds `n` bytes at level M, or null. */
export function versionFor(n: number): number | null {
  for (let ver = 1; ver <= 10; ver++) {
    const countBits = ver <= 9 ? 8 : 16;
    if (4 + countBits + 8 * n <= dataCodewords(ver) * 8) return ver;
  }
  return null;
}

function dataBits(bytes: readonly number[], ver: number): number[] {
  const bits: number[] = [];
  const put = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(ver) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  return bits;
}

function codewords(bytes: readonly number[], ver: number): number[] {
  const bits = dataBits(bytes, ver);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const numBlocks = BLOCKS[ver - 1];
  const eccLen = ECC_PER_BLOCK[ver - 1];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortLen - eccLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0); // placeholder so every block has the same length
    blocks.push([...dat, ...ecc]);
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) out.push(block[i]);
    });
  return out;
}

/* ------------------------------------------------------------------ the matrix */

class Matrix {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fn: boolean[][];
  constructor(readonly ver: number) {
    this.size = ver * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  /** Sets a function module at column x, row y. */
  set(x: number, y: number, dark: boolean) {
    this.dark[y][x] = dark;
    this.fn[y][x] = true;
  }
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function drawFinder(m: Matrix, cx: number, cy: number) {
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < m.size && y >= 0 && y < m.size) m.set(x, y, d !== 2 && d !== 4);
    }
}

function drawAlignment(m: Matrix, cx: number, cy: number) {
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) m.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
}

function drawFormat(m: Matrix, mask: number) {
  const data = (ECL_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) m.set(8, i, bit(i));
  m.set(8, 7, bit(6));
  m.set(8, 8, bit(7));
  m.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) m.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) m.set(m.size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) m.set(8, m.size - 15 + i, bit(i));
  m.set(8, m.size - 8, true);
}

function drawVersion(m: Matrix) {
  if (m.ver < 7) return;
  let rem = m.ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (m.ver << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = m.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    m.set(a, b, dark);
    m.set(b, a, dark);
  }
}

function drawFunctionPatterns(m: Matrix) {
  for (let i = 0; i < m.size; i++) {
    m.set(6, i, i % 2 === 0);
    m.set(i, 6, i % 2 === 0);
  }
  drawFinder(m, 3, 3);
  drawFinder(m, m.size - 4, 3);
  drawFinder(m, 3, m.size - 4);
  const pos = alignmentPositions(m.ver);
  const n = pos.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      drawAlignment(m, pos[i], pos[j]);
    }
  drawFormat(m, 0);
  drawVersion(m);
}

function drawCodewords(m: Matrix, data: readonly number[]) {
  let i = 0;
  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < m.size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? m.size - 1 - vert : vert;
        if (!m.fn[y][x] && i < data.length * 8) {
          m.dark[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m: Matrix, mask: number) {
  const f = MASKS[mask];
  for (let y = 0; y < m.size; y++)
    for (let x = 0; x < m.size; x++) if (!m.fn[y][x] && f(x, y)) m.dark[y][x] = !m.dark[y][x];
}

/** The standard penalty of a masked matrix (rules 1 to 4). */
export function penalty(dark: readonly (readonly boolean[])[]): number {
  const size = dark.length;
  let score = 0;
  const line = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < size; i++) {
      let run = 1;
      for (let j = 1; j <= size; j++) {
        if (j < size && get(i, j) === get(i, j - 1)) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      // Finder like patterns: 1011101 with four light modules on either side.
      for (let j = 0; j + 11 <= size; j++) {
        const seq = Array.from({ length: 11 }, (_, k) => get(i, j + k));
        const a = [true, false, true, true, true, false, true, false, false, false, false];
        const b = [...a].reverse();
        if (seq.every((v, k) => v === a[k]) || seq.every((v, k) => v === b[k])) score += 40;
      }
    }
  };
  line((i, j) => dark[i][j]);
  line((i, j) => dark[j][i]);
  for (let y = 0; y + 1 < size; y++)
    for (let x = 0; x + 1 < size; x++) {
      const c = dark[y][x];
      if (c === dark[y][x + 1] && c === dark[y + 1][x] && c === dark[y + 1][x + 1]) score += 3;
    }
  const total = size * size;
  const darkCount = dark.reduce((a, row) => a + row.filter(Boolean).length, 0);
  const k = Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * 10;
  return score;
}

/**
 * The QR matrix of a text (rows of modules, true for dark), or null when it is longer than version 10
 * holds. `mask` forces a mask (tests); by default the lowest penalty wins.
 */
export function qrMatrix(text: string, mask?: number): boolean[][] | null {
  const bytes = utf8(text);
  const ver = versionFor(bytes.length);
  if (ver === null) return null;
  const data = codewords(bytes, ver);
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  const masks = mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask];
  for (const k of masks) {
    const m = new Matrix(ver);
    drawFunctionPatterns(m);
    drawCodewords(m, data);
    applyMask(m, k);
    drawFormat(m, k);
    const score = penalty(m.dark);
    if (score < bestScore) {
      bestScore = score;
      best = m.dark.map((row) => [...row]);
    }
  }
  return best;
}

/** The dark modules of a matrix as one SVG path (1 unit per module, shifted by the quiet zone). */
export function qrPath(matrix: readonly (readonly boolean[])[], quiet = 4): string {
  const parts: string[] = [];
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }),
  );
  return parts.join("");
}
