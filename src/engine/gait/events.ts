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
import { GAIT_ENGINE, PAD_FAR_MASK } from "./params";
import {
  footLength,
  LEG,
  nearestFrame,
  pointOf,
  rollTurn,
  runs,
  visibleShare,
  type Prepared,
  type Series,
} from "./preprocess";
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

/**
 * The far leg's contacts that lie on the near leg (D-028 item 2, AP-7): on the pad the model often lays
 * the hidden far leg on the near one, and its heel then peaks with the near heel. A far peak whose
 * point (`id`) the model drew within PAD_FAR_MASK of a foot length of the near leg's same point, in a
 * frame at the peak (its nearest frame and the ones either side, since the smoothing spreads a short
 * drawing over the samples around it), is that drawing, not a contact, and is masked. A true far
 * contact sits a step from the near foot.
 */
function maskOnNear(p: Prepared, pk: Peaks, id: number, nearId: number, within: number): Peaks {
  const s = p.series;
  const turn = rollTurn(null);
  const onNear = (k: number) => {
    const i = nearestFrame(p.frameMs, s.t[k] * 1000);
    for (let j = Math.max(0, i - 1); j <= Math.min(p.frames.length - 1, i + 1); j++) {
      const a = pointOf(p.frames[j], id, turn);
      const b = pointOf(p.frames[j], nearId, turn);
      if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= within) return true;
    }
    return false;
  };
  const out: Peaks = { idx: [], prom: [] };
  pk.idx.forEach((k, i) => {
    if (onNear(k)) return;
    out.idx.push(k);
    out.prom.push(pk.prom[i]);
  });
  return out;
}

/**
 * Zeni events of one side in one side view pass, with the ankle fallback. `padNear`: a pad side view's
 * pass with its near limb, where a foot detector that gives more than one event of a kind in a near
 * stride also falls back to the ankle (D-027 item 4, doubledInNearStride), and where the far leg's
 * contacts that lie on the near leg are masked first (D-028 item 2, maskOnNear; `foot` is the walk's
 * foot length).
 */
function sideEventsOf(
  p: Prepared,
  pass: Pass,
  passIndex: number,
  side: LimbSide,
  padNear: boolean,
  foot: number,
  doubledRule = padNear,
): PassEvent[] {
  const s = p.series;
  const leg = LEG[side];
  const heel = relative(s, leg.heel, pass);
  const toe = negate(relative(s, leg.toe, pass));
  const ankle = relative(s, leg.ankle, pass);
  const ankleBack = negate(ankle);
  let zIc = passPeaks(heel, pass.start, pass.end, s.hz);
  let zTo = passPeaks(toe, pass.start, pass.end, s.hz);
  let aIc = passPeaks(ankle, pass.start, pass.end, s.hz);
  let aTo = passPeaks(ankleBack, pass.start, pass.end, s.hz);
  if (padNear && pass.near && pass.near !== side && foot > 0) {
    const near = LEG[pass.near];
    const within = PAD_FAR_MASK.footShare * foot;
    zIc = maskOnNear(p, zIc, leg.heel, near.heel, within);
    zTo = maskOnNear(p, zTo, leg.toe, near.toe, within);
    aIc = maskOnNear(p, aIc, leg.ankle, near.ankle, within);
    aTo = maskOnNear(p, aTo, leg.ankle, near.ankle, within);
  }
  const fromMs = s.t[pass.start] * 1000;
  const toMs = s.t[pass.end - 1] * 1000;
  const footSeen = Math.min(
    visibleShare(p, [leg.heel], fromMs, toMs),
    visibleShare(p, [leg.toe], fromMs, toMs),
  );
  const fallback =
    footSeen < GAIT_ENGINE.gateShare ||
    disagreement([zIc.idx, zTo.idx], [aIc.idx, aTo.idx], GAIT_ENGINE.disagreeFrames) >
      GAIT_ENGINE.disagreeShare ||
    (doubledRule && doubledInNearStride(s, pass, side, zIc.idx, zTo.idx));
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

/**
 * A foot detector that gives more than one event of a kind in a near stride (D-027 item 4, C2's GG-4
 * proposal (d)): on the pad the hidden far leg laid on the near one, or a foot index that swings back,
 * gives a second peak. Each kind happens once a stride, so the near strides are bounded mid way from
 * that kind: by the near ankle's IC peaks for the far side's IC and the near side's TO, by its TO peaks
 * for the near side's IC and the far side's TO.
 */
function doubledInNearStride(s: Series, pass: Pass, side: LimbSide, ics: number[], tos: number[]): boolean {
  if (!pass.near) return false;
  const nearAnkle = relative(s, LEG[pass.near].ankle, pass);
  const byIc = passPeaks(nearAnkle, pass.start, pass.end, s.hz).idx;
  const byTo = passPeaks(negate(nearAnkle), pass.start, pass.end, s.hz).idx;
  const isNear = side === pass.near;
  const twice = (events: number[], bounds: number[]) => {
    for (let j = 0; j + 1 < bounds.length; j++)
      if (events.filter((k) => k >= bounds[j] && k < bounds[j + 1]).length > 1) return true;
    return false;
  };
  return twice(ics, isNear ? byTo : byIc) || twice(tos, isNear ? byIc : byTo);
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

/**
 * Every event of the view's passes, in time order; `pad` for a pad side view (its foot detector rule
 * and its far leg mask). `near`: the overground side view's timing reading (D-035 item 2), which masks
 * the far leg's contacts that lie on the near leg as the pad does, without the pad's doubled stride
 * rule (a pass at home holds its stop and turn, whose small steps double a kind in a stride).
 */
export function detectEvents(
  p: Prepared,
  passes: readonly Pass[],
  kind: "side" | "front",
  pad = false,
  near = false,
): PassEvent[] {
  const out: PassEvent[] = [];
  const foot = pad || near ? footLength(p.series) : 0;
  passes.forEach((pass, i) => {
    if (kind === "front") out.push(...frontEventsOf(p.series, pass, i));
    else
      for (const side of ["left", "right"] as const)
        out.push(...sideEventsOf(p, pass, i, side, pad || near, foot, pad));
  });
  return out.sort((a, b) => a.index - b.index || (a.type === b.type ? 0 : a.type === "ic" ? -1 : 1));
}
