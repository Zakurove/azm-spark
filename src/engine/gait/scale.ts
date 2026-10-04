/**
 * Pixels to metres for the gait engine (product v7 contract 2.8 and 6.1; gait-rules 3.5).
 *
 *   - Overground side view: the factor is the standing height in pixels over the person's height in
 *     metres (Sports2D convert_px_to_meters: scaling_factor = first_person_height / height_px), the
 *     height in pixels from the standing calibration by Pose2Sim's compute_height.
 *   - Walking pad: the belt speed (the entered speed times the booth belt check factor), used by
 *     src/engine/gait/spatiotemporal.ts padLengths.
 *   - Overground front: no metres (gait-rules 3.5).
 *
 * Upstream:
 *   - Pose2Sim, https://github.com/perfanalytics/pose2sim, Pose2Sim/common.py (compute_height,
 *     trimmed_mean), commit 0875d55ce0112b33f6469a2b257fb27101aa6ce9. File header: __author__ =
 *     "David Pagnon", __copyright__ = "Copyright 2021, Maya-Mocap", __license__ = "BSD 3-Clause
 *     License".
 *   - Sports2D, https://github.com/davidpagnon/Sports2D, Sports2D/process.py (convert_px_to_meters,
 *     the scaling factor), commit 4392177d75dff43b4da60514d3766029201a5c5e. File header: __author__ =
 *     "David Pagnon, HunMin Kim", __copyright__ = "Copyright 2023, Sports2D", __license__ = "BSD
 *     3-Clause License".
 * Modified for Azm: ported to TypeScript for MediaPipe landmarks in pixel space (units of the picture
 * height); the height is computed on the standing calibration frames only (no best_coords filter: every
 * frame is quiet standing), a frame missing a landmark is left out; BlazePose has no Head keypoint, so
 * the head is the mid shoulder to nose distance times 1.5, upstream's fallback; Sports2D's
 * CORRECTION_2D_TO_3D (1.063, for segments that leave the picture plane while walking) is not applied,
 * because the calibration is a standing profile whose segments lie in the picture plane; no floor
 * angle, origin or depth correction (the steps are measured as distances along the path).
 *
 * Upstream licence (identical LICENSE files in Pose2Sim and Sports2D):
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
import { pointOf, rollTurn } from "./preprocess";
import type { GaitFrame, GaitSetup } from "./types";

/** compute_height's head estimate without a Head keypoint: mid shoulder to nose times this (upstream). */
export const NOSE_HEAD_FACTOR = 1.5;
/** compute_height: «Remove the 50% most extreme values» before the mean (upstream default). */
export const TRIMMED_EXTREMA_PERCENT = 50;

/**
 * trimmed_mean: the mean of the sorted values between the trimmed_extrema_percent / 2 quantiles
 * (int() of the index, as upstream); the plain mean when nothing is left.
 */
export function trimmedMean(xs: readonly number[], trimmedExtremaPercent: number): number | null {
  const sorted = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const share = trimmedExtremaPercent / 100;
  const lower = Math.floor(sorted.length * (share / 2));
  const upper = Math.floor(sorted.length * (1 - share / 2));
  const kept = sorted.slice(lower, upper);
  const use = kept.length ? kept : sorted;
  return use.reduce((a, b) => a + b, 0) / use.length;
}

const PAIRS = {
  foot: [
    [30, 28],
    [29, 27],
  ],
  shank: [
    [28, 26],
    [27, 25],
  ],
  femur: [
    [26, 24],
    [25, 23],
  ],
  back: [
    [24, 12],
    [23, 11],
  ],
} as const;

/**
 * compute_height on one frame (pixel space): the mean of each left and right segment (heel to
 * ankle, ankle to knee, knee to hip, hip to shoulder) plus the head; null when a landmark is missing.
 */
export function frameHeightPx(f: GaitFrame, rollDeg: number | null): number | null {
  const turn = rollTurn(rollDeg);
  const pt = (id: number) => pointOf(f, id, turn);
  const d = (a: number, b: number): number | null => {
    const p = pt(a);
    const q = pt(b);
    return p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : null;
  };
  let sum = 0;
  for (const pairs of Object.values(PAIRS)) {
    const a = d(pairs[0][0], pairs[0][1]);
    const b = d(pairs[1][0], pairs[1][1]);
    if (a === null || b === null) return null;
    sum += (a + b) / 2;
  }
  const ls = pt(11);
  const rs = pt(12);
  const nose = pt(0);
  if (!ls || !rs || !nose) return null;
  const head = Math.hypot((ls[0] + rs[0]) / 2 - nose[0], (ls[1] + rs[1]) / 2 - nose[1]) * NOSE_HEAD_FACTOR;
  return sum + head;
}

/** The standing height in pixels (units of the picture height) over the calibration frames, or null. */
export function standingHeightPx(standing: readonly GaitFrame[], rollDeg: number | null): number | null {
  const heights = standing.map((f) => frameHeightPx(f, rollDeg)).filter((h): h is number => h !== null);
  return trimmedMean(heights, TRIMMED_EXTREMA_PERCENT);
}

/** Pixels per metre from the standing height (convert_px_to_meters' factor, inverted), or null. */
export function pxPerMetre(heightPx: number | null, heightCm: number | null): number | null {
  if (heightPx === null || !(heightPx > 0) || heightCm === null || !(heightCm > 0)) return null;
  return heightPx / (heightCm / 100);
}

/** The walking pad's belt speed in m/s: the entered km/h times the booth belt check factor, or null. */
export function beltMps(setup: Pick<GaitSetup, "padSpeedKmh" | "padCorrection">): number | null {
  if (setup.padSpeedKmh === null || !(setup.padSpeedKmh > 0)) return null;
  const factor = setup.padCorrection !== null && setup.padCorrection > 0 ? setup.padCorrection : 1;
  return (setup.padSpeedKmh / 3.6) * factor;
}
