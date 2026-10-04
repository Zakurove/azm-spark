/**
 * Hampel outlier filter (product v7 contract 2.12), ported from Pose2Sim.
 *
 * Upstream: https://github.com/perfanalytics/pose2sim, Pose2Sim/filtering.py, function
 * hampel_filter, commit 0875d55ce0112b33f6469a2b257fb27101aa6ce9. File header: __author__ = "David
 * Pagnon", __copyright__ = "Copyright 2021, Pose2Sim", __license__ = "BSD 3-Clause License".
 * Modified for Azm: ported to TypeScript; takes a Float64Array or number[] and returns a new
 * Float64Array; a window holding NaN never replaces its centre (NumPy's median of such a window is
 * NaN, so the upstream comparison is false). Checked against the Python function on
 * tests/golden/hampel.json (scripts/golden/make_golden.py).
 *
 * Upstream licence (Pose2Sim LICENSE):
 *
 *   BSD 3-Clause License
 *
 *   Copyright (c) 2022, perfanalytics
 *   All rights reserved.
 *
 *   Redistribution and use in source and binary forms, with or without
 *   modification, are permitted provided that the following conditions are met:
 *
 *   1. Redistributions of source code must retain the above copyright notice, this
 *      list of conditions and the following disclaimer.
 *
 *   2. Redistributions in binary form must reproduce the above copyright notice,
 *      this list of conditions and the following disclaimer in the documentation
 *      and/or other materials provided with the distribution.
 *
 *   3. Neither the name of the copyright holder nor the names of its
 *      contributors may be used to endorse or promote products derived from
 *      this software without specific prior written permission.
 *
 *   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 *   AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 *   IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 *   DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 *   FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 *   DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 *   SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 *   CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 *   OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 *   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * Pure, no DOM.
 */

/**
 * Pose2Sim's defaults, which are also the range of motion data's (rom-protocol engine.smoothing
 * hampel, parity tested) and the gait preprocessing rule ("Hampel filter window 7, n sigma 2").
 */
export const HAMPEL_DEFAULTS = { window: 7, nSigma: 2 } as const;

/** The 0.75 quantile of the standard normal: the modified z score of Iglewicz and Hoaglin, as upstream. */
const MAD_SCALE = 0.6745;

/** The median of a short odd length window (sorted in place). */
function medianOf(w: Float64Array): number {
  w.sort();
  const m = w.length >> 1;
  return w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2;
}

/**
 * Hampel filter: each sample whose modified z score in its centred window (window samples, half
 * window window // 2 on each side) is above nSigma is replaced by the window median. The first and
 * last half windows are left as they are, and a window with a median absolute deviation of 0 never
 * replaces (so a lone spike on a perfectly flat signal stays), exactly as upstream.
 */
export function hampel(
  xs: Float64Array | number[],
  window: number = HAMPEL_DEFAULTS.window,
  nSigma: number = HAMPEL_DEFAULTS.nSigma,
): Float64Array {
  const out = Float64Array.from(xs);
  const half = Math.floor(window / 2);
  const size = 2 * half + 1;
  const w = new Float64Array(size);
  const dev = new Float64Array(size);
  for (let i = half; i < xs.length - half; i++) {
    let hasNaN = false;
    for (let k = 0; k < size; k++) {
      const v = xs[i - half + k];
      if (Number.isNaN(v)) hasNaN = true;
      w[k] = v;
    }
    if (hasNaN) continue;
    const med = medianOf(w);
    for (let k = 0; k < size; k++) dev[k] = Math.abs(xs[i - half + k] - med);
    const mad = medianOf(dev);
    if (mad !== 0 && Math.abs((MAD_SCALE * (xs[i] - med)) / mad) > nSigma) out[i] = med;
  }
  return out;
}
