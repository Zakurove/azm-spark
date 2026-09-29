/**
 * A QR code encoder for the register link of S50 (UX spec S50, 5.9 QrLinkProps: "generated on
 * device"). Byte mode, error correction level M, versions 1 to 10 (up to 213 bytes), the mask with
 * the lowest penalty. It follows ISO/IEC 18004 as laid out in Project Nayuki's reference
 * implementation (MIT): data codewords, Reed Solomon error correction over GF(256) with the
 * polynomial 0x11D, block interleaving, function patterns, the zigzag placement, the eight masks and
 * the BCH coded format and version information. Pure: text in, a square of modules out.
 */

/** Error correction codewords per block, level M, versions 1 to 10 (index 0 unused). */
const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
/** Error correction blocks, level M, versions 1 to 10 (index 0 unused). */
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** The format bits of level M (L 1, M 0, Q 3, H 2). */
const FORMAT_M = 0;
export const MAX_VERSION = 10;

export interface QrCode {
  version: number;
  size: number;
  mask: number;
  /** modules[y][x]: true is a dark module. */
  modules: boolean[][];
}

const getBit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

/** Raw data modules of a version: everything but the function patterns. */
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
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * BLOCKS_M[ver];
}

/** The alignment pattern centres of a version. */
export function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/* ------------------------------------------------------------ Reed Solomon */

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** The generator polynomial of a degree, highest coefficient first, the leading 1 left out. */
export function rsDivisor(degree: number): number[] {
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

/** The remainder of data divided by the generator: the error correction codewords. */
export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
  }
  return result;
}

/* ------------------------------------------------------------ codewords */

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** The smallest version (1 to 10) whose level M capacity holds the bytes, or null. */
export function versionFor(byteCount: number): number | null {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const countBits = v <= 9 ? 8 : 16;
    if (4 + countBits + byteCount * 8 <= dataCodewords(v) * 8) return v;
  }
  return null;
}

/** Data codewords of a byte mode segment with terminator and pad bytes. */
function dataOf(bytes: readonly number[], ver: number): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(ver) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  return out;
}

/** Splits data into blocks, adds each block's error correction and interleaves them. */
export function withEcc(data: readonly number[], ver: number): number[] {
  const numBlocks = BLOCKS_M[ver];
  const eccLen = ECC_PER_BLOCK_M[ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - eccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push([...dat, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - eccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

/* ------------------------------------------------------------ the matrix */

class Matrix {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  set(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }
  functionPatterns() {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(n - 4, 3);
    this.finder(3, n - 4);
    const pos = alignmentPositions(this.version);
    const last = pos.length - 1;
    pos.forEach((y, i) =>
      pos.forEach((x, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        this.alignment(x, y);
      }),
    );
    this.formatBits(0);
    this.versionBits();
  }
  finder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size)
          this.set(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }
  alignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  formatBits(mask: number) {
    const bits = formatInfo(mask);
    const n = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, getBit(bits, i));
    this.set(8, 7, getBit(bits, 6));
    this.set(8, 8, getBit(bits, 7));
    this.set(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) this.set(n - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.set(8, n - 15 + i, getBit(bits, i));
    this.set(8, n - 8, true);
  }
  versionBits() {
    if (this.version < 7) return;
    const bits = versionInfo(this.version);
    for (let i = 0; i < 18; i++) {
      const dark = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark);
      this.set(b, a, dark);
    }
  }
  codewords(data: readonly number[]) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }
  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++)
        if (!this.isFunction[y][x] && maskAt(mask, x, y)) this.modules[y][x] = !this.modules[y][x];
  }
}

/** Whether mask pattern `mask` inverts the module at (x, y). */
export function maskAt(mask: number, x: number, y: number): boolean {
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
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** The 15 format bits of level M with a mask (BCH (15, 5), XOR 0x5412). */
export function formatInfo(mask: number): number {
  const data = (FORMAT_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (BCH (18, 6)) of versions 7 and up. */
export function versionInfo(ver: number): number {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}

/* ------------------------------------------------------------ penalty */

function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let result = 0;
  const addHistory = (run: number, history: number[]) => {
    if (history[0] === 0) run += size;
    history.pop();
    history.unshift(run);
  };
  const countPatterns = (h: number[]) => {
    const n = h[1];
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
  };
  const terminate = (color: boolean, run: number, history: number[]) => {
    if (color) {
      addHistory(run, history);
      run = 0;
    }
    addHistory(run + size, history);
    return countPatterns(history);
  };
  const line = (get: (i: number) => boolean) => {
    let color = false;
    let run = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < size; i++) {
      if (get(i) === color) {
        run++;
        if (run === 5) result += 3;
        else if (run > 5) result++;
      } else {
        addHistory(run, history);
        if (!color) result += countPatterns(history) * 40;
        color = get(i);
        run = 1;
      }
    }
    result += terminate(color, run, history) * 40;
  };
  for (let y = 0; y < size; y++) line((x) => modules[y][x]);
  for (let x = 0; x < size; x++) line((y) => modules[y][x]);
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3;
    }
  const dark = modules.reduce((n, row) => n + row.filter(Boolean).length, 0);
  const total = size * size;
  result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return result;
}

/* ------------------------------------------------------------ encode */

/** The QR code of a text (UTF 8 bytes, level M), or null when it is too long for version 10. */
export function encodeQr(text: string): QrCode | null {
  const bytes = utf8(text);
  const version = versionFor(bytes.length);
  if (version === null) return null;
  const codewords = withEcc(dataOf(bytes, version), version);
  const m = new Matrix(version);
  m.functionPatterns();
  m.codewords(codewords);
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    m.applyMask(mask);
    m.formatBits(mask);
    const score = penalty(m.modules);
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
    m.applyMask(mask);
  }
  m.applyMask(best);
  m.formatBits(best);
  return { version, size: m.size, mask: best, modules: m.modules.map((row) => [...row]) };
}
