/**
 * Gait cycles of one view and their gates (product v7 contract 2.8; gait-rules 3.3 checks and 3.6
 * cycle gate). Pure, no DOM.
 *
 * A cycle runs from an initial contact (IC) to the next IC of the same side within a pass, with that
 * side's toe off (TO) between (side views), as upstream. It is clean only when every check passes, and
 * a cycle that fails is dropped, never repaired. The first failed check names the drop:
 *   order      the events between the two ICs are not exactly the other side's TO and IC and this
 *              side's TO, in that order (side views; src/engine/gait/spatiotemporal.ts correctOrder),
 *              or not exactly one IC of the other side (front views); the MVP's timing reading of an
 *              overground side view reads each event only in its phase of the stride, led by the
 *              near leg (timingEvents, D-037 item 3);
 *   swap       the order failed although the leg labels were exchanged inside the cycle (an
 *              unresolved swap);
 *   turn       the cycle reaches a turn or its 1 s margin;
 *   pass_edge  the cycle holds one of the first two or last two steps of an overground pass (steps
 *              taken in view after a start or a turn, or before a stop or a turn: a start or stop is
 *              in view when the pass's first or last IC is more than one median stride from its
 *              edge; a walker who enters or leaves the picture walking, as the capture asks, has its
 *              first and last steps out of view), or leaves the front view's 1.5 to 4 m window;
 *   duration   the stride time is outside 0.5 to 1.5 times the median stride of its pass (the timing
 *              reading of an overground side view: 0.75 to 1.25 times the walk's near leg median
 *              stride, D-037 item 3);
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
import { GAIT_ENGINE, GAIT_MVP, STEADY_FULL, type SteadyRules } from "./params";
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
  /**
   * The events' times in seconds, sub-frame (CG-21): the timing metrics read these, never the grid
   * times of the indices above.
   */
  times: { ic: number; oppTo: number | null; oppIc: number | null; to: number | null; icEnd: number };
  /** Side views: the cycle's side is the limb nearest the phone in its pass. */
  near: boolean;
  /** The trunk landmarks pass the cycle's visibility gate. */
  trunkOk: boolean;
}

/**
 * The cycles of a view, in time order, each clean or with the reason it was dropped. `steady` sets the
 * steps dropped at an in view start, stop or turn: the data's (STEADY_FULL) or the MVP's timing only
 * reading (STEADY_TIMING).
 */
export function buildCycles(
  p: Prepared,
  motion: Motion,
  events: readonly PassEvent[],
  kind: "side" | "front",
  overground: boolean,
  steady: SteadyRules = STEADY_FULL,
  /** Overground side passes gated on their near limb, as the pad side view (the MVP's timing reading). */
  nearTiming = false,
): Cycle[] {
  const s = p.series;
  const out: Cycle[] = [];
  const nearLed = nearTiming && kind === "side";
  // The near leg's stride across the walk (ms), for the far leg's contacts at a pass's ends.
  const nearStrideMs = nearLed
    ? median(
        motion.passes.flatMap((pass, pi) => {
          const own = events.filter((e) => e.pass === pi && e.type === "ic" && e.side === pass.near);
          return own.slice(1).map((e, i) => e.t - own[i].t);
        }),
      )
    : null;
  const perPass = motion.passes.map((pass, pi) => {
    let evs = events.filter((e) => e.pass === pi);
    if (nearLed && pass.near) evs = farContactsInStep(evs, pass.near, nearStrideMs);
    const ics = evs.filter((e) => e.type === "ic");
    const passCycles: Cycle[] = [];
    for (const side of ["left", "right"] as const) {
      const own = ics.filter((e) => e.side === side);
      for (let i = 0; i + 1 < own.length; i++) {
        const a = own[i];
        const b = own[i + 1];
        const between = evs.filter((e) => e.index > a.index && e.index < b.index);
        passCycles.push(cycleOf(p, motion, pass.near, pi, side, a, b, between, kind, nearLed));
      }
    }
    return { pass, ics, passCycles };
  });
  // The median stride of the cycles whose order holds (duration and the steady state edges): the
  // pass's own. The timing reading's duration check reads the walk's near leg instead (D-037 item 3):
  // a phone's side view holds one or two cycles a pass, too few for a pass's own median to catch a
  // misread stride, and the near leg's contacts are the reliable ones; both legs' strides take the
  // same time in a steady walk, while a far leg contact the model misplaced (the far heel laid on the
  // near one) makes a stride about half as long (GAIT_MVP.strideBand).
  const strideOf = (cs: readonly Cycle[]) =>
    median(cs.filter((c) => c.drop !== "order" && c.drop !== "swap").map((c) => c.times.icEnd - c.times.ic));
  const all = perPass.flatMap((x) => x.passCycles);
  const walkMid = nearTiming ? (strideOf(all.filter((c) => c.near)) ?? strideOf(all)) : null;
  perPass.forEach(({ pass, ics, passCycles }) => {
    const mid = strideOf(passCycles);
    if (overground && ics.length) {
      const { first, last } = steady.dropSteps;
      const edge = new Set<number>();
      const startSeen = pass.turnAtStart || (mid !== null && s.t[ics[0].index] - s.t[pass.start] > mid);
      const endSeen =
        pass.turnAtEnd || (mid !== null && s.t[pass.end - 1] - s.t[ics[ics.length - 1].index] > mid);
      if (startSeen) ics.slice(0, first).forEach((e) => edge.add(e.index));
      if (endSeen) ics.slice(Math.max(0, ics.length - last)).forEach((e) => edge.add(e.index));
      for (const c of passCycles)
        if (c.clean && (edge.has(c.k1) || (c.kOppIc !== null && edge.has(c.kOppIc)))) drop(c, "pass_edge");
    }
    const [lo, hi] = walkMid !== null ? GAIT_MVP.strideBand : GAIT_ENGINE.strideTimePlausible;
    const ref = walkMid ?? mid;
    // The pad side view gates timing on the near limb (D-026 item 6): every cycle's visibility gate
    // reads the hips and the near leg, the far leg's too, which hides behind the near one for a part
    // of each stride; no far leg kinematics are read in a side view (metrics.ts, near cycles only).
    const padNear = (!overground || nearTiming) && kind === "side" ? pass.near : undefined;
    for (const c of passCycles) {
      if (c.clean && ref !== null) {
        const st = c.times.icEnd - c.times.ic;
        if (st < lo * ref || st > hi * ref) drop(c, "duration");
      }
      if (c.clean) {
        const share = visibleShare(p, gateLandmarksOf(padNear ?? c.side, kind, steady), c.icStart, c.icEnd);
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
 * The far leg's contacts the timing reading keeps (D-037 item 3): each far IC must fall in its phase of
 * the near leg's step (GAIT_MVP.phase.oppIc of the way from the near IC before it to the one after; at
 * a pass's end, the walk's near stride from the one it has). The model's far heel laid on the near one
 * peaks a second time a stride, just after each near contact; that peak would split every far cycle in
 * two halves (the real model's walks), so it is left out. With no near contact in the pass, nothing is
 * left out.
 */
function farContactsInStep(evs: readonly PassEvent[], near: LimbSide, strideMs: number | null): PassEvent[] {
  const nearIcs = evs.filter((e) => e.side === near && e.type === "ic");
  if (!nearIcs.length) return [...evs];
  const [lo, hi] = GAIT_MVP.phase.oppIc;
  return evs.filter((e) => {
    if (e.side === near || e.type !== "ic") return true;
    const before = [...nearIcs].reverse().find((n) => n.index < e.index);
    const after = nearIcs.find((n) => n.index > e.index);
    const from = before ? before.t : after && strideMs !== null ? after.t - strideMs : null;
    const to = after ? after.t : before && strideMs !== null ? before.t + strideMs : null;
    if (from === null || to === null || !(to > from)) return true;
    const ph = (e.t - from) / (to - from);
    return ph > lo && ph < hi;
  });
}

/** What the timing reading keeps of a cycle's events (timingEvents): whether it is a stride, and its events. */
interface TimingEvents {
  ok: boolean;
  oppTo: PassEvent | undefined;
  oppIc: PassEvent | undefined;
  to: PassEvent | undefined;
}

/**
 * The timing reading's cycle check (D-037 item 3) for an overground side view, led by the near leg. A
 * phone's side view sees a pass of about five steps, and the model follows the near leg's contacts
 * well but not the far leg: around each near contact it lays the far heel and toe on the near ones for
 * a moment (a far IC and a near TO right after the near IC), and the toe off of a leg still out of
 * the picture as a pass starts is missing. The full order check (exactly the five events, in order)
 * then drops a cycle whose own contacts are all there (Nasser's fourth test: 21 steps, 3 and 2 clean
 * cycles; the real model's rendered walk seen through a phone's narrower picture: most near cycles
 * dropped). So each event between the cycle's two ICs is read only in its own phase of the stride
 * (GAIT_MVP.phase, the share of the stride from the IC: the other leg's TO at the end of the first
 * double support, its IC near the middle, the leg's own TO after more than half the stride); one
 * outside its phase is the model's, not the walk's, and is left out. The cycle is a stride when:
 *   - the near leg's: exactly one swing shows, its own TO in phase, or with that TO missed the far
 *     leg's IC in phase (two of a kind in phase mean a missed contact);
 *   - the far leg's: the near leg's IC in phase (the far leg's contacts are trusted only alternating
 *     with the near leg's), at most one of each other kind;
 * and then every stride is checked against the walk's near leg strides (GAIT_MVP.strideBand). The
 * timing metrics read what a cycle keeps: the stride from its ICs, the step from the other side's IC,
 * stance, swing and single support only from a cycle with every event (metrics.ts).
 */
function timingEvents(
  side: LimbSide,
  near: LimbSide | null,
  a: PassEvent,
  b: PassEvent,
  between: readonly PassEvent[],
): TimingEvents {
  const none: TimingEvents = { ok: false, oppTo: undefined, oppIc: undefined, to: undefined };
  const opp = other(side);
  const stride = b.t - a.t;
  if (!(stride > 0) || between.some((e) => e.side === side && e.type === "ic")) return none;
  const inPhase = (e: PassEvent, [lo, hi]: readonly [number, number]) => {
    const ph = (e.t - a.t) / stride;
    return ph > lo && ph < hi;
  };
  const pick = (s: LimbSide, type: "ic" | "to", window: readonly [number, number]) =>
    between.filter((e) => e.side === s && e.type === type && inPhase(e, window));
  const { phase } = GAIT_MVP;
  const tos = pick(side, "to", phase.to);
  const oppIcs = pick(opp, "ic", phase.oppIc);
  const oppTos = pick(opp, "to", phase.oppTo);
  if (tos.length > 1 || oppIcs.length > 1 || oppTos.length > 1) return none;
  const to = tos[0];
  const oppIc = oppIcs[0];
  // The other leg's IC comes before the leg's own TO (its single support ends at that IC).
  if (to && oppIc && oppIc.index >= to.index) return none;
  const ok = near !== null && side !== near ? oppIc !== undefined : to !== undefined || oppIc !== undefined;
  return { ok, oppTo: oppTos[0], oppIc, to };
}

/**
 * The landmarks a cycle's visibility gate reads. Front and back views: every gate landmark (23 to 32).
 * Side views, D-026 item 6's near limb rule for every side view: the hips and the cycle's own leg, so
 * a near leg's cycle is not dropped for the far leg hiding behind it (on real model output the far
 * knee is under the floor in about half the frames, G1's smoke), and a far leg's cycle is kept only
 * where that leg passes its own gate.
 */
function gateLandmarksOf(side: LimbSide, kind: "side" | "front", steady: SteadyRules): readonly number[] {
  if (kind === "front") return steady.frontGate;
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
  nearSide: LimbSide | null,
  pass: number,
  side: LimbSide,
  a: PassEvent,
  b: PassEvent,
  between: readonly PassEvent[],
  kind: "side" | "front",
  /** The timing reading's order check, led by the near leg (timingEvents). */
  timingOrder = false,
): Cycle {
  const opp = other(side);
  const find = (s: LimbSide, type: "ic" | "to") => between.find((e) => e.side === s && e.type === type);
  const timing = kind === "side" && timingOrder ? timingEvents(side, nearSide, a, b, between) : null;
  const oppIc = timing ? timing.oppIc : find(opp, "ic");
  const oppTo = timing ? timing.oppTo : kind === "side" ? find(opp, "to") : undefined;
  const to = timing ? timing.to : kind === "side" ? find(side, "to") : undefined;
  const sec = (e: PassEvent | undefined) => (e ? e.t / 1000 : null);
  const c: Cycle = {
    side,
    icStart: a.t,
    to: to ? to.t : null,
    icEnd: b.t,
    clean: true,
    pass,
    k0: a.index,
    kOppTo: oppTo?.index ?? null,
    kOppIc: oppIc?.index ?? null,
    kTo: to?.index ?? null,
    k1: b.index,
    times: { ic: a.t / 1000, oppTo: sec(oppTo), oppIc: sec(oppIc), to: sec(to), icEnd: b.t / 1000 },
    near: nearSide === side,
    trunkOk: false,
  };
  const seq = [a, ...between, b];
  const ordered =
    kind === "side"
      ? timing
        ? timing.ok
        : seq.length === 5 && correctOrder(seq)
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
