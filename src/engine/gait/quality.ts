/**
 * The quality report of one gait view (product v7 contract 2.8 GaitQuality; gait-rules 3.6 view
 * gates). Pure, no DOM.
 *
 *   cleanCycles  the clean cycles of each side
 *   medianFps    1000 ÷ the median gap between frames (the measure of the probe and QualityMonitor)
 *   gapShare     the share of analysed frames with a gate landmark (23 to 32) under 0.5, which the
 *                pre-processing filled by interpolation
 *   gatePassed   at least 6 clean cycles per side, at 20 fps or more («under 20: record again»)
 *   timingOnly   20 to 24 fps: «timing and cadence only»
 *   issues       what lowered the view: too_few_cycles, low_fps (under 25), gaps (over 15%),
 *                visibility and swap (the gate failed and cycles were dropped for that reason),
 *                wrong_view (most of the view's samples show the other body view, or the view's
 *                passes are missing: a front view without toward passes, a back view without away
 *                passes), turns_only (every pass sample is a turn). not_one_person comes from the
 *                capture's subject lock, never from the landmarks of one person.
 *
 * Shaped after myogait's post hoc diagnostics, https://github.com/IDMDataHub/myogait,
 * myogait/pipeline.py (_diagnose: report the conditions that degrade accuracy as warnings instead of
 * silently biasing the results: tracking coverage, out of plane distortion, too few cycles per side),
 * commit 695ca8636d071f7c84374f2e0bdd48caeb1b869a. Modified for Azm: ported to TypeScript as
 * GaitQuality; the gait-rules gates and numbers replace upstream's (80% coverage, 0.6 mean confidence,
 * 0.35 thigh length variation, 3 cycles per side and the ankle range are not used).
 *
 * Upstream licence (myogait LICENSE):
 *
 *   MIT License
 *
 *   Copyright (c) 2024 Frederic Fer, Institut de Myologie
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 */
import type { Cycle } from "./cycles";
import { GAIT_ENGINE } from "./params";
import { analysedRuns, type Motion } from "./passes";
import type { Prepared } from "./preprocess";
import type { GaitQuality, GaitQualityIssue } from "./types";
import { lowerBound, median, r3 } from "./util";

/** 1000 ÷ the median gap between frames (0 with fewer than two frames). */
export function medianFps(frameMs: ArrayLike<number>): number {
  const gaps: number[] = [];
  for (let i = 1; i < frameMs.length; i++) gaps.push(frameMs[i] - frameMs[i - 1]);
  const m = median(gaps);
  return m !== null && m > 0 ? 1000 / m : 0;
}

/** The share of the analysed frames with a gate landmark under the visibility floor. */
export function gapShare(p: Prepared, motion: Motion): number {
  let analysed = 0;
  let filled = 0;
  for (const pass of motion.passes)
    for (const [a, b] of analysedRuns(pass, motion.excluded)) {
      const from = lowerBound(p.frameMs, p.series.t[a] * 1000 - 1e-6);
      const to = lowerBound(p.frameMs, p.series.t[b - 1] * 1000 + 1e-6);
      for (let i = from; i < to; i++) {
        analysed++;
        const lm = p.frames[i].lm;
        const missing = GAIT_ENGINE.gateLandmarks.some((id) => {
          const q = lm[id];
          return !q || !Number.isFinite(q.x) || !((q.visibility ?? 0) >= GAIT_ENGINE.gateVisibility);
        });
        if (missing) filled++;
      }
    }
  return analysed ? filled / analysed : 0;
}

export interface QualityInput {
  p: Prepared;
  motion: Motion;
  cycles: readonly Cycle[];
  /** The recording has bouts but the view found none of its passes (front without toward, back without away). */
  noViewPasses: boolean;
}

/** The view's quality report (GaitQuality). */
export function viewQuality(q: QualityInput): GaitQuality {
  const fps = medianFps(q.p.frameMs);
  const clean = { left: 0, right: 0 };
  const drops = new Map<string, number>();
  for (const c of q.cycles) {
    if (c.clean) clean[c.side]++;
    else if (c.drop) drops.set(c.drop, (drops.get(c.drop) ?? 0) + 1);
  }
  const gaps = gapShare(q.p, q.motion);
  const enough =
    clean.left >= GAIT_ENGINE.cleanCyclesPerSide && clean.right >= GAIT_ENGINE.cleanCyclesPerSide;
  const gatePassed = enough && fps >= GAIT_ENGINE.recordAgainBelowFps;
  const timingOnly = fps >= GAIT_ENGINE.recordAgainBelowFps && fps < GAIT_ENGINE.fullFps;
  const passSamples = q.motion.passes.reduce((n, p) => n + (p.end - p.start), 0);
  const analysedSamples = q.motion.passes.reduce(
    (n, p) => n + analysedRuns(p, q.motion.excluded).reduce((m, [a, b]) => m + b - a, 0),
    0,
  );
  const issues = new Set<GaitQualityIssue>();
  if (!enough) issues.add("too_few_cycles");
  if (fps < GAIT_ENGINE.fullFps) issues.add("low_fps");
  if (gaps > GAIT_ENGINE.gapShareMax) issues.add("gaps");
  if (!enough && drops.get("visibility")) issues.add("visibility");
  if (!enough && drops.get("swap")) issues.add("swap");
  if (q.noViewPasses || q.motion.wrongViewShare > 0.5) issues.add("wrong_view");
  if (passSamples > 0 && analysedSamples === 0) issues.add("turns_only");
  const order: GaitQualityIssue[] = [
    "too_few_cycles",
    "low_fps",
    "gaps",
    "visibility",
    "swap",
    "not_one_person",
    "wrong_view",
    "turns_only",
  ];
  return {
    cleanCycles: clean,
    medianFps: r3(fps),
    gapShare: r3(gaps),
    gatePassed,
    timingOnly,
    issues: order.filter((i) => issues.has(i)),
  };
}
