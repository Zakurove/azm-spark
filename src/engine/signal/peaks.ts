/**
 * Peak finding with a minimum distance and a minimum prominence (product v7 contract 2.12), ported
 * from SciPy.
 *
 * Upstream: https://github.com/scipy/scipy, version 1.17.1 (tag v1.17.1, commit
 * 527eb7fd7953a1de068f94bf8b322f249b9405ae): scipy/signal/_peak_finding.py (find_peaks, the
 * distance and prominence conditions) and scipy/signal/_peak_finding_utils.pyx (_local_maxima_1d,
 * _select_by_peak_distance, _peak_prominences). The upstream files carry no copyright line of their
 * own; SciPy's LICENSE.txt holds the notice below.
 * Modified for Azm: ported to TypeScript; only the `distance` and the minimum `prominence`
 * conditions; the prominences of the kept peaks are always returned (over the whole signal, no
 * `wlen`); peaks of equal height are ordered by position (a stable sort; NumPy's default argsort,
 * which SciPy uses, does not define an order for ties on long inputs). Checked against SciPy on
 * tests/golden/find_peaks.json (scripts/golden/make_golden.py).
 *
 * Upstream licence (SciPy LICENSE.txt):
 *
 *   Copyright (c) 2001-2002 Enthought, Inc. 2003, SciPy Developers.
 *   All rights reserved.
 *
 *   Redistribution and use in source and binary forms, with or without
 *   modification, are permitted provided that the following conditions
 *   are met:
 *
 *   1. Redistributions of source code must retain the above copyright
 *      notice, this list of conditions and the following disclaimer.
 *
 *   2. Redistributions in binary form must reproduce the above
 *      copyright notice, this list of conditions and the following
 *      disclaimer in the documentation and/or other materials provided
 *      with the distribution.
 *
 *   3. Neither the name of the copyright holder nor the names of its
 *      contributors may be used to endorse or promote products derived
 *      from this software without specific prior written permission.
 *
 *   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 *   "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 *   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 *   A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 *   OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 *   SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 *   LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 *   DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 *   THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 *   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 *   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * Pure, no DOM.
 */

/**
 * Local maxima (_local_maxima_1d): one or more equal samples with a smaller sample on both sides;
 * a plateau gives its midpoint, rounded down. The first and last samples are never maxima.
 */
function localMaxima(x: Float64Array): number[] {
  const mids: number[] = [];
  const iMax = x.length - 1;
  let i = 1;
  while (i < iMax) {
    if (x[i - 1] < x[i]) {
      let ahead = i + 1;
      while (ahead < iMax && x[ahead] === x[i]) ahead++;
      if (x[ahead] < x[i]) {
        mids.push(Math.floor((i + ahead - 1) / 2));
        i = ahead;
      }
    }
    i++;
  }
  return mids;
}

/**
 * The distance condition (_select_by_peak_distance): from the highest peak down, every lower peak
 * closer than ceil(distance) samples is dropped.
 */
function selectByDistance(peaks: number[], x: Float64Array, distance: number): number[] {
  const n = peaks.length;
  const d = Math.ceil(distance);
  const keep = new Uint8Array(n).fill(1);
  const byPriority = peaks.map((_, k) => k).sort((a, b) => x[peaks[a]] - x[peaks[b]] || a - b);
  for (let i = n - 1; i >= 0; i--) {
    const j = byPriority[i];
    if (!keep[j]) continue;
    for (let k = j - 1; k >= 0 && peaks[j] - peaks[k] < d; k--) keep[k] = 0;
    for (let k = j + 1; k < n && peaks[k] - peaks[j] < d; k++) keep[k] = 0;
  }
  return peaks.filter((_, k) => keep[k]);
}

/** The prominence of each peak (_peak_prominences over the whole signal). */
function prominencesOf(x: Float64Array, peaks: number[]): number[] {
  return peaks.map((peak) => {
    const top = x[peak];
    let leftMin = top;
    for (let i = peak; i >= 0 && x[i] <= top; i--) if (x[i] < leftMin) leftMin = x[i];
    let rightMin = top;
    for (let i = peak; i < x.length && x[i] <= top; i++) if (x[i] < rightMin) rightMin = x[i];
    return top - Math.max(leftMin, rightMin);
  });
}

/**
 * SciPy find_peaks with `distance` (samples, at least 1, rounded up) and a minimum `prominence`,
 * applied in SciPy's order (distance, then prominence). Returns the peak indices in increasing order
 * and their prominences.
 */
export function findPeaks(
  xs: ArrayLike<number>,
  opts: { distance?: number; prominence?: number },
): { peaks: number[]; prominences: number[] } {
  const { distance, prominence } = opts;
  if (distance !== undefined && !(distance >= 1))
    throw new RangeError(`findPeaks: distance ${distance} must be 1 or more`);
  const x = Float64Array.from(xs);
  let peaks = localMaxima(x);
  if (distance !== undefined) peaks = selectByDistance(peaks, x, distance);
  let prominences = prominencesOf(x, peaks);
  if (prominence !== undefined) {
    const keep = prominences.map((p) => prominence <= p);
    peaks = peaks.filter((_, k) => keep[k]);
    prominences = prominences.filter((_, k) => keep[k]);
  }
  return { peaks, prominences };
}
