/**
 * Uniform resampling with gap filling (product v7 contract 2.12), for the gait preprocessing rules
 * "real frame timestamps; resample to uniform 30 Hz by linear interpolation" and "linear
 * interpolation up to 0.12 s; longer gap splits the bout" (gait-rules preprocessing; the rate and
 * the gap are the caller's arguments). Azm code. Pure, no DOM.
 */

/** Times closer than this (seconds) are the same instant: absorbs the rounding of t0 + k / hz. */
const SAME_TIME = 1e-9;

/**
 * Resamples a signal measured at real frame times onto a uniform grid.
 *
 * - `t` is in seconds (frame times are in milliseconds: divide by 1000), `ys` the values, null (or
 *   any value that is not a finite number) where the sample is missing, for example a landmark under
 *   the visibility floor. A valid sample whose time does not move past the previous valid one is
 *   dropped.
 * - The grid starts at the first valid sample and steps by 1 / hz up to the last valid sample.
 * - A grid point between two valid samples at most `maxGapSec` apart (a gap of exactly maxGapSec is
 *   filled) takes the straight line between them; a point between two samples further apart is NaN,
 *   so a long gap, or a long pause between frames, splits the result.
 * - `segments` are the runs of finite values, as half open index ranges [start, end) of the grid
 *   (`y.subarray(start, end)`), in order.
 */
export function resampleUniform(
  t: number[],
  ys: (number | null)[],
  hz: number,
  maxGapSec: number,
): { t: Float64Array; y: Float64Array; segments: [number, number][] } {
  if (t.length !== ys.length)
    throw new RangeError(`resampleUniform: ${t.length} times and ${ys.length} values`);
  if (!(hz > 0) || !Number.isFinite(hz)) throw new RangeError(`resampleUniform: rate ${hz} is not above 0`);
  if (!(maxGapSec >= 0)) throw new RangeError(`resampleUniform: gap ${maxGapSec} is below 0`);

  const vt: number[] = [];
  const vy: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const ti = t[i];
    const yi = ys[i];
    if (yi === null || !Number.isFinite(yi) || !Number.isFinite(ti)) continue;
    if (vt.length && ti <= vt[vt.length - 1]) continue;
    vt.push(ti);
    vy.push(yi);
  }
  if (!vt.length) return { t: new Float64Array(0), y: new Float64Array(0), segments: [] };

  const t0 = vt[0];
  const n = Math.floor((vt[vt.length - 1] - t0) * hz + SAME_TIME) + 1;
  const outT = new Float64Array(n);
  const outY = new Float64Array(n);
  const near = (a: number, b: number) => Math.abs(a - b) <= SAME_TIME;
  let j = 0;
  for (let k = 0; k < n; k++) {
    const tau = t0 + k / hz;
    outT[k] = tau;
    while (j + 1 < vt.length && vt[j + 1] <= tau) j++;
    let y = Number.NaN;
    if (near(tau, vt[j])) y = vy[j];
    else if (j + 1 < vt.length) {
      if (near(tau, vt[j + 1])) y = vy[j + 1];
      else if (vt[j + 1] - vt[j] <= maxGapSec + SAME_TIME) {
        const f = (tau - vt[j]) / (vt[j + 1] - vt[j]);
        y = vy[j] + f * (vy[j + 1] - vy[j]);
      }
    }
    outY[k] = y;
  }

  const segments: [number, number][] = [];
  let start = -1;
  for (let k = 0; k <= n; k++) {
    const ok = k < n && Number.isFinite(outY[k]);
    if (ok && start < 0) start = k;
    if (!ok && start >= 0) {
      segments.push([start, k]);
      start = -1;
    }
  }
  return { t: outT, y: outY, segments };
}
