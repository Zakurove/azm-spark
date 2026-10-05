/*
    ---------------------------------------------------------------------------
    OpenCap processing: gaitAnalysis.py
    ---------------------------------------------------------------------------

    Copyright 2023 Stanford University and the Authors

    Author(s): Antoine Falisse, Scott Uhlrich

    Licensed under the Apache License, Version 2.0 (the "License"); you may not
    use this file except in compliance with the License. You may obtain a copy
    of the License at http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/
/**
 * Spatiotemporal formulas of one gait cycle (product v7 contract 2.8 and 6.1; gait-rules 3.4 and 3.5).
 *
 * Upstream: https://github.com/opencap-org/opencap-processing, ActivityAnalyses/gait_analysis.py
 * (segment_walking's detect_correct_order; compute_stance_time, compute_swing_time,
 * compute_double_support_time; compute_stride_length and compute_step_length with the treadmill
 * speed), commit 72b5416bf6172fe3d9b42b01e1a02252362b20fc, Apache License 2.0; the upstream file
 * header above is kept verbatim. NOTICE: none (the repository has no NOTICE file at that commit).
 *
 * Modified for Azm: ported to TypeScript for 2D landmarks relative to the picture (heel landmarks,
 * not calcaneus markers in a gait frame); the order check works on the events of one cycle (IC of a
 * side, TO of the other, IC of the other, TO of the first, IC of the first) and a cycle that fails it
 * is dropped, never repaired (upstream lowers the peak prominence and retries); single support is the
 * opposite leg's swing time in seconds (gait-rules 3.4), not a share; on the walking pad the stride
 * length is the belt speed times the stride time (gait-rules 3.5, without the heel displacement of
 * upstream) and the pixel to metre factor of a stride is its two heel separations at IC over that
 * length, so each step length is its share of the stride. Pure, no DOM.
 */
import type { LimbSide } from "./util";

export interface OrderedEvent {
  side: LimbSide;
  type: "ic" | "to";
}

/** The event that must follow each event (detect_correct_order's expectedOrder, both sides). */
const NEXT: Record<string, string> = {
  "right:ic": "left:to",
  "left:to": "left:ic",
  "left:ic": "right:to",
  "right:to": "right:ic",
};

/** Whether every event is followed by the one the gait cycle expects (empty and single lists pass). */
export function correctOrder(events: readonly OrderedEvent[]): boolean {
  for (let i = 1; i < events.length; i++) {
    const prev = `${events[i - 1].side}:${events[i - 1].type}`;
    if (NEXT[prev] !== `${events[i].side}:${events[i].type}`) return false;
  }
  return true;
}

/** The events of one side view cycle, as times in seconds. */
export interface CycleTimes {
  /** IC of the cycle's side, then TO of the other side, IC of the other side, TO of the side, IC of the side. */
  ic: number;
  oppTo: number;
  oppIc: number;
  to: number;
  icEnd: number;
}

export const strideTime = (c: Pick<CycleTimes, "ic" | "icEnd">) => c.icEnd - c.ic;
/** compute_stance_time: IC to TO. */
export const stanceTime = (c: CycleTimes) => c.to - c.ic;
/** compute_swing_time: TO to the next IC. */
export const swingTime = (c: CycleTimes) => c.icEnd - c.to;
/** gait-rules single_support_s: the opposite TO to the opposite IC (the opposite leg's swing). */
export const singleSupport = (c: CycleTimes) => c.oppIc - c.oppTo;
/** compute_double_support_time: (stance minus the opposite swing) as a share of the stride, percent. */
export const doubleSupportPct = (c: CycleTimes) => ((stanceTime(c) - singleSupport(c)) / strideTime(c)) * 100;
/** The step that ends the cycle: the opposite IC to the side's next IC. */
export const stepTime = (c: Pick<CycleTimes, "oppIc" | "icEnd">) => c.icEnd - c.oppIc;

/**
 * Walking pad step and stride length of one cycle (gait-rules 3.5): the stride is the belt speed
 * times the stride time; the pixel to metre factor is the cycle's two heel separations at IC over it,
 * so the step ending the cycle is its separation's share of the stride. Null when a separation is not
 * a positive number.
 */
export function padLengths(
  beltMps: number,
  strideSec: number,
  sepOppPx: number,
  sepPx: number,
): { stride: number; step: number } | null {
  if (!(beltMps > 0) || !(strideSec > 0) || !(sepOppPx > 0) || !(sepPx > 0)) return null;
  const stride = beltMps * strideSec;
  return { stride, step: (sepPx / (sepPx + sepOppPx)) * stride };
}
