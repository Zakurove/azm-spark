/**
 * Gait cycles of one view and their gates (product v7 contract 2.8; gait-rules 3.3 checks and 3.6
 * cycle gate). Pure, no DOM.
 *
 * A cycle runs from an initial contact (IC) to the next IC of the same side within a pass, with that
 * side's toe off (TO) between (side views), as upstream. It is clean only when every check passes, and
 * a cycle that fails is dropped, never repaired. The first failed check names the drop:
 *   order      the events between the two ICs are not exactly the other side's TO and IC and this
 *              side's TO, in that order (side views; src/engine/gait/spatiotemporal.ts correctOrder),
 *              or not exactly one IC of the other side (front views);
 *   swap       the order failed although the leg labels were exchanged inside the cycle (an
 *              unresolved swap);
 *   turn       the cycle reaches a turn or its 1 s margin;
 *   pass_edge  the cycle holds one of the first two or last two steps of an overground pass (steps
 *              taken in view after a start or a turn, or before a stop or a turn: a start or stop is
 *              in view when the pass's first or last IC is more than one median stride from its
 *              edge; a walker who enters or leaves the picture walking, as the capture asks, has its
 *              first and last steps out of view), or leaves the front view's 1.5 to 4 m window;
 *   duration   the stride time is outside 0.5 to 1.5 times the median stride of its pass;
 *   visibility a gate landmark (23 to 32; side views: the hips and the cycle's own leg, D-026 item
 *              6's near limb rule) is under 0.5 in more than 10% of the cycle's frames.
 * A clean cycle also records whether the trunk landmarks (11, 12) pass the same visibility gate.
 *
 * The segmentation is ported from myogait, https://github.com/IDMDataHub/myogait, myogait/cycles.py
 * (segment_cycles, _find_to_between: heel strike to the next heel strike of the same side, the first
 * toe off between them, a cycle duration gate and a landmark confidence gate), commit
 * 695ca8636d071f7c84374f2e0bdd48caeb1b869a. Modified for Azm: ported to TypeScript on grid indices;
 * cycles stay inside one pass; the duration gate is relative to the pass median (gait-rules), not
 * upstream's 0.4 to 2.5 s; the confidence gate is the gait-rules visibility gate on every gate
 * landmark; the order, swap, turn and pass edge checks are added; no angle normalisation to 101
 * points (the metrics read the cycle's samples).
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
import type { PassEvent } from "./events";
import { GAIT_ENGINE } from "./params";
import { EXCLUDED, type Motion } from "./passes";
import { LEG, visibleShare, type Prepared } from "./preprocess";
import { correctOrder } from "./spatiotemporal";
import type { GaitCycle } from "./types";
import { median, other, type LimbSide } from "./util";

/** A cycle with its grid indices, for the metrics. */
export interface Cycle extends GaitCycle {
  pass: number;
  /** IC, the other side's TO and IC, the side's TO and the next IC (grid indices; null when absent). */
  k0: number;
  kOppTo: number | null;
  kOppIc: number | null;
  kTo: number | null;
  k1: number;
  /** Side views: the cycle's side is the limb nearest the phone in its pass. */
  near: boolean;
  /** The trunk landmarks pass the cycle's visibility gate. */
  trunkOk: boolean;
}

const ms = (p: Prepared, k: number) => Math.round(p.series.t[k] * 1000);

/** The cycles of a view, in time order, each clean or with the reason it was dropped. */
export function buildCycles(
  p: Prepared,
  motion: Motion,
  events: readonly PassEvent[],
  kind: "side" | "front",
  overground: boolean,
): Cycle[] {
  const s = p.series;
  const out: Cycle[] = [];
  motion.passes.forEach((pass, pi) => {
    const evs = events.filter((e) => e.pass === pi);
    const ics = evs.filter((e) => e.type === "ic");
    const passCycles: Cycle[] = [];
    for (const side of ["left", "right"] as const) {
      const own = ics.filter((e) => e.side === side);
      for (let i = 0; i + 1 < own.length; i++) {
        const a = own[i];
        const b = own[i + 1];
        const between = evs.filter((e) => e.index > a.index && e.index < b.index);
        passCycles.push(cycleOf(p, motion, pass.near === side, pi, side, a, b, between, kind));
      }
    }
    // The median stride of the pass's cycles whose order holds (duration and the steady state edges).
    const strides = passCycles
      .filter((c) => c.drop !== "order" && c.drop !== "swap")
      .map((c) => s.t[c.k1] - s.t[c.k0]);
    const mid = median(strides);
    if (overground && ics.length) {
      const { first, last } = GAIT_ENGINE.dropSteps;
      const edge = new Set<number>();
      const startSeen = pass.turnAtStart || (mid !== null && s.t[ics[0].index] - s.t[pass.start] > mid);
      const endSeen =
        pass.turnAtEnd || (mid !== null && s.t[pass.end - 1] - s.t[ics[ics.length - 1].index] > mid);
      if (startSeen) ics.slice(0, first).forEach((e) => edge.add(e.index));
      if (endSeen) ics.slice(Math.max(0, ics.length - last)).forEach((e) => edge.add(e.index));
      for (const c of passCycles)
        if (c.clean && (edge.has(c.k1) || (c.kOppIc !== null && edge.has(c.kOppIc)))) drop(c, "pass_edge");
    }
    const [lo, hi] = GAIT_ENGINE.strideTimePlausible;
    for (const c of passCycles) {
      if (c.clean && mid !== null) {
        const st = s.t[c.k1] - s.t[c.k0];
        if (st < lo * mid || st > hi * mid) drop(c, "duration");
      }
      if (c.clean) {
        const share = visibleShare(p, gateLandmarksOf(c.side, kind), c.icStart, c.icEnd);
        if (share < GAIT_ENGINE.gateShare) drop(c, "visibility");
      }
      if (c.clean)
        c.trunkOk = visibleShare(p, GAIT_ENGINE.trunkLandmarks, c.icStart, c.icEnd) >= GAIT_ENGINE.gateShare;
    }
    out.push(...passCycles);
  });
  return out.sort((a, b) => a.k0 - b.k0 || (a.side === "left" ? -1 : 1));
}

/**
 * The landmarks a cycle's visibility gate reads. Front and back views: every gate landmark (23 to 32).
 * Side views, D-026 item 6's near limb rule for every side view: the hips and the cycle's own leg, so
 * a near leg's cycle is not dropped for the far leg hiding behind it (on real model output the far
 * knee is under the floor in about half the frames, G1's smoke), and a far leg's cycle is kept only
 * where that leg passes its own gate.
 */
function gateLandmarksOf(side: LimbSide, kind: "side" | "front"): readonly number[] {
  if (kind === "front") return GAIT_ENGINE.gateLandmarks;
  const leg = LEG[side];
  return [LEG.left.hip, LEG.right.hip, leg.knee, leg.ankle, leg.heel, leg.toe];
}

function drop(c: Cycle, why: NonNullable<GaitCycle["drop"]>): void {
  c.clean = false;
  c.drop = why;
}

function cycleOf(
  p: Prepared,
  motion: Motion,
  near: boolean,
  pass: number,
  side: LimbSide,
  a: PassEvent,
  b: PassEvent,
  between: readonly PassEvent[],
  kind: "side" | "front",
): Cycle {
  const opp = other(side);
  const find = (s: LimbSide, type: "ic" | "to") => between.find((e) => e.side === s && e.type === type);
  const oppIc = find(opp, "ic");
  const oppTo = kind === "side" ? find(opp, "to") : undefined;
  const to = kind === "side" ? find(side, "to") : undefined;
  const c: Cycle = {
    side,
    icStart: ms(p, a.index),
    to: to ? ms(p, to.index) : null,
    icEnd: ms(p, b.index),
    clean: true,
    pass,
    k0: a.index,
    kOppTo: oppTo?.index ?? null,
    kOppIc: oppIc?.index ?? null,
    kTo: to?.index ?? null,
    k1: b.index,
    near,
    trunkOk: false,
  };
  const seq = [a, ...between, b];
  const ordered =
    kind === "side"
      ? seq.length === 5 && correctOrder(seq)
      : seq.length === 3 && seq[1].side === opp && seq.every((e) => e.type === "ic");
  let relabelled = false;
  let turn = false;
  let window = false;
  for (let k = a.index; k <= b.index; k++) {
    if (p.series.relabelled[k]) relabelled = true;
    if (motion.excluded[k] === EXCLUDED.turn) turn = true;
    if (motion.excluded[k] === EXCLUDED.window) window = true;
  }
  if (!ordered) drop(c, relabelled ? "swap" : "order");
  else if (turn) drop(c, "turn");
  else if (window) drop(c, "pass_edge");
  return c;
}
