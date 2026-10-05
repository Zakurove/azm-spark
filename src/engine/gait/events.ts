/**
 * Gait events of one view (product v7 contract 2.8; gait-rules 3.3). Pure, no DOM.
 *
 * Side views, overground and pad: the Zeni coordinate method with the MediaPipe mapping. Initial
 * contact (IC) of a leg is a positive peak of d·(X heel − X mid hip) (heel 29 or 30); toe off (TO) a
 * positive peak of the negated d·(X foot index − X mid hip) (31 or 32); peaks by the SciPy port
 * (src/engine/signal/peaks.ts) with a distance of 0.4 s and a prominence of 10% of the signal's range
 * in the pass. Per side and pass, the same peaks on the ankle (27 or 28) replace both when the heel or
 * the foot index fails the visibility gate in the pass, or when the two detectors disagree by more
 * than 2 frames on more than 20% of events. The confidence of an event is its prominence over the
 * largest prominence of its kind in the pass, as upstream.
 *
 * Front views (overground toward and away, pad front): Stenum et al. 2024, implemented from the paper
 * (PLOS Digit Health 2024), no code used: D = Y left ankle − Y right ankle (Y down); walking toward
 * the phone, left IC at the maxima of D and right IC at its minima; walking away, the reverse. The
 * front view gives IC only. The same peak finder and parameters as the side view (the front rule
 * gives none of its own).
 *
 * The side detector is ported from myogait, https://github.com/IDMDataHub/myogait,
 * myogait/events.py (_detect_zeni), commit 695ca8636d071f7c84374f2e0bdd48caeb1b869a.
 * Modified for Azm: ported to TypeScript on the engine's preprocessed 30 Hz series (no 6 Hz filter of
 * its own: the series are already filtered at 5 Hz); heel and foot index instead of the ankle for IC
 * and TO (the MediaPipe mapping of Hii et al. 2023), with the ankle as the fallback; the direction per
 * pass from the caller; the prominence floor of upstream (0.005) is not used, only 10% of the range;
 * events carry the grid index and the time in milliseconds.
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
import { findPeaks } from "../signal/peaks";
import { GAIT_ENGINE } from "./params";
import { LEG, runs, visibleShare, type Prepared, type Series } from "./preprocess";
import { midX } from "./kinematics";
import type { Pass } from "./passes";
import type { GaitEvent } from "./types";
import { r3, type LimbSide } from "./util";

/** An event with the pass it belongs to. */
export interface PassEvent extends GaitEvent {
  pass: number;
}

interface Peaks {
  idx: number[];
  prom: number[];
}

/** Peaks of a signal on [a, b): each finite run separately, prominence share × the range over [a, b). */
export function passPeaks(sig: Float64Array, a: number, b: number, hz: number): Peaks {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = a; k < b; k++)
    if (Number.isFinite(sig[k])) {
      lo = Math.min(lo, sig[k]);
      hi = Math.max(hi, sig[k]);
    }
  const out: Peaks = { idx: [], prom: [] };
  if (!(hi > lo)) return out;
  const distance = Math.max(1, Math.round(GAIT_ENGINE.peakDistanceSec * hz));
  const prominence = GAIT_ENGINE.peakProminenceShare * (hi - lo);
  for (const [ra, rb] of runs(b - a, (i) => Number.isFinite(sig[a + i]))) {
    if (rb - ra < 3) continue;
    const r = findPeaks(sig.subarray(a + ra, a + rb), { distance, prominence });
    r.peaks.forEach((p, i) => {
      out.idx.push(a + ra + p);
      out.prom.push(r.prominences[i]);
    });
  }
  return out;
}

const negate = (xs: Float64Array) => xs.map((v) => -v);

/** d·(X point − X mid hip) over a pass (NaN outside it). */
function relative(s: Series, id: number, pass: Pass): Float64Array {
  const out = new Float64Array(s.n).fill(Number.NaN);
  for (let k = pass.start; k < pass.end; k++) out[k] = pass.d * (s.x[id][k] - midX(s, 23, 24, k));
  return out;
}

/**
 * The sub-frame time of a peak (CG-21, D-027 item 5): the vertex of the parabola through the peak's
 * sample and its two neighbours, in seconds; the sample's own time where a neighbour is missing or the
 * three are on a line. At 30 Hz a frame is 33 ms, wider than some timing differences the rules read
 * (the single support ratio's possible band).
 */
export function peakTime(s: Pick<Series, "t" | "hz">, sig: Float64Array, k: number): number {
  const y0 = sig[k - 1];
  const y1 = sig[k];
  const y2 = sig[k + 1];
  const den = y0 - 2 * y1 + y2;
  if (!Number.isFinite(y0) || !Number.isFinite(y1) || !Number.isFinite(y2) || !(Math.abs(den) > 1e-12))
    return s.t[k];
  const offset = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den));
  return s.t[k] + offset / s.hz;
}

function toEvents(
  s: Series,
  pk: Peaks,
  sig: Float64Array,
  side: LimbSide,
  type: "ic" | "to",
  detector: GaitEvent["detector"],
  pass: number,
): PassEvent[] {
  const top = Math.max(0, ...pk.prom);
  return pk.idx.map((k, i) => ({
    side,
    type,
    t: Math.round(peakTime(s, sig, k) * 1000),
    index: k,
    confidence: top > 0 ? r3(Math.min(1, pk.prom[i] / top)) : 1,
    detector,
    pass,
  }));
}

/** Share of the two detectors' events that have no event of the same kind within `frames` in the other. */
export function disagreement(a: number[][], b: number[][], frames: number): number {
  let bad = 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    const near = (x: number, ys: number[]) => ys.some((y) => Math.abs(x - y) <= frames);
    for (const x of a[i]) if (!near(x, b[i])) bad++;
    for (const y of b[i]) if (!near(y, a[i])) bad++;
    total += a[i].length + b[i].length;
  }
  return total ? bad / total : 0;
}

/** Zeni events of one side in one side view pass, with the ankle fallback. */
function sideEventsOf(p: Prepared, pass: Pass, passIndex: number, side: LimbSide): PassEvent[] {
  const s = p.series;
  const leg = LEG[side];
  const heel = relative(s, leg.heel, pass);
  const toe = negate(relative(s, leg.toe, pass));
  const ankle = relative(s, leg.ankle, pass);
  const ankleBack = negate(ankle);
  const zIc = passPeaks(heel, pass.start, pass.end, s.hz);
  const zTo = passPeaks(toe, pass.start, pass.end, s.hz);
  const aIc = passPeaks(ankle, pass.start, pass.end, s.hz);
  const aTo = passPeaks(ankleBack, pass.start, pass.end, s.hz);
  const fromMs = s.t[pass.start] * 1000;
  const toMs = s.t[pass.end - 1] * 1000;
  const footSeen = Math.min(
    visibleShare(p, [leg.heel], fromMs, toMs),
    visibleShare(p, [leg.toe], fromMs, toMs),
  );
  const fallback =
    footSeen < GAIT_ENGINE.gateShare ||
    disagreement([zIc.idx, zTo.idx], [aIc.idx, aTo.idx], GAIT_ENGINE.disagreeFrames) >
      GAIT_ENGINE.disagreeShare;
  return fallback
    ? [
        ...toEvents(s, aIc, ankle, side, "ic", "ankle", passIndex),
        ...toEvents(s, aTo, ankleBack, side, "to", "ankle", passIndex),
      ]
    : [
        ...toEvents(s, zIc, heel, side, "ic", "zeni", passIndex),
        ...toEvents(s, zTo, toe, side, "to", "zeni", passIndex),
      ];
}

/** Stenum front events (IC only) of one front view pass. */
function frontEventsOf(s: Series, pass: Pass, passIndex: number): PassEvent[] {
  const D = new Float64Array(s.n).fill(Number.NaN);
  for (let k = pass.start; k < pass.end; k++) D[k] = s.y[LEG.left.ankle][k] - s.y[LEG.right.ankle][k];
  const maxima = passPeaks(D, pass.start, pass.end, s.hz);
  const minima = passPeaks(negate(D), pass.start, pass.end, s.hz);
  const toward = pass.facing !== "away";
  const negD = negate(D);
  return [
    ...toEvents(s, toward ? maxima : minima, toward ? D : negD, "left", "ic", "stenum_front", passIndex),
    ...toEvents(s, toward ? minima : maxima, toward ? negD : D, "right", "ic", "stenum_front", passIndex),
  ];
}

/** Every event of the view's passes, in time order. */
export function detectEvents(p: Prepared, passes: readonly Pass[], kind: "side" | "front"): PassEvent[] {
  const out: PassEvent[] = [];
  passes.forEach((pass, i) => {
    if (kind === "front") out.push(...frontEventsOf(p.series, pass, i));
    else for (const side of ["left", "right"] as const) out.push(...sideEventsOf(p, pass, i, side));
  });
  return out.sort((a, b) => a.index - b.index || (a.type === b.type ? 0 : a.type === "ic" ? -1 : 1));
}
