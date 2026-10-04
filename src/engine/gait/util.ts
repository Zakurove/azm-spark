/** Small numeric helpers of the gait engine (stream C). Pure, no DOM. */

export const DEG = 180 / Math.PI;

export type LimbSide = "left" | "right";
export const SIDES: readonly LimbSide[] = ["left", "right"];
export const other = (s: LimbSide): LimbSide => (s === "left" ? "right" : "left");

/** Median of the finite values, or null when there are none. */
export function median(xs: readonly number[]): number | null {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Mean of the finite values, or null when there are none. */
export function mean(xs: readonly number[]): number | null {
  let sum = 0;
  let n = 0;
  for (const x of xs)
    if (Number.isFinite(x)) {
      sum += x;
      n++;
    }
  return n ? sum / n : null;
}

/** Rounded to 3 decimals (the stored numbers, section 4 and A5-10). */
export const r3 = (x: number): number => Math.round(x * 1000) / 1000;

/** First index i with arr[i] >= x (arr ascending), arr.length when none. */
export function lowerBound(arr: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Linear interpolation of a series at a fractional index (NaN when a neighbour is not finite). */
export function at(xs: ArrayLike<number>, idx: number): number {
  const i = Math.floor(idx);
  const f = idx - i;
  if (i < 0 || i >= xs.length) return Number.NaN;
  if (f === 0 || i + 1 >= xs.length) return xs[i];
  return xs[i] + f * (xs[i + 1] - xs[i]);
}
