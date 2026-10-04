/**
 * src/engine/gait/events.ts (product v7 contract 2.8; gait-rules 3.3): the Zeni coordinate method with
 * the MediaPipe mapping on side views (heel for IC, foot index for TO), the ankle fallback per side,
 * and the Stenum 2024 vertical ankle distance on front views.
 */
import { describe, expect, it } from "vitest";
import { detectEvents, disagreement, passPeaks, type PassEvent } from "../../src/engine/gait/events";
import { passesOf } from "../../src/engine/gait/passes";
import { prepare } from "../../src/engine/gait/preprocess";
import type { GaitView } from "../../src/engine/gait/types";
import { walk, type Side, type Walk, type WalkSpec } from "../fixtures/gait/gen-gait";

const FRAME_MS = 1000 / 30;

function eventsOf(spec: WalkSpec): { w: Walk; events: PassEvent[]; analysed: PassEvent[] } {
  const w = walk(spec);
  const side = spec.view === "side" || spec.view === "pad_side";
  const p = prepare(w.frames, { rollDeg: 0, labels: side ? "swaps" : "facing" });
  const m = passesOf(p, spec.view as GaitView, spec.view === "pad_side" ? spec.nearSide : undefined);
  const events = detectEvents(p, m.passes, side ? "side" : "front");
  return { w, events, analysed: events.filter((e) => m.excluded[e.index] === 0) };
}

/** Signed error (ms) of each detected event against the nearest true event of its side and type. */
function errors(w: Walk, events: PassEvent[], type: "ic" | "to"): number[] {
  const truth = type === "ic" ? w.truth.ics : w.truth.tos;
  return events
    .filter((e) => e.type === type)
    .map((e) => {
      let best = Infinity;
      for (const x of truth) if (x.side === e.side && Math.abs(e.t - x.t) < Math.abs(best)) best = e.t - x.t;
      return best;
    });
}

const share = (xs: number[], ok: (x: number) => boolean) => xs.filter(ok).length / xs.length;

describe("peaks", () => {
  it("finds peaks at least the distance apart with a prominence of 10% of the range", () => {
    const sig = Float64Array.from(
      { length: 120 },
      (_, k) => Math.sin((2 * Math.PI * k) / 30) + 0.05 * Math.sin(k),
    );
    const p = passPeaks(sig, 0, 120, 30);
    expect(p.idx.map((k) => Math.round(k / 30 - 0.25))).toEqual([0, 1, 2, 3]);
    expect(p.prom.every((x) => x > 0.2)).toBe(true);
    // A ripple below 10% of the range is never a peak.
    const ripple = Float64Array.from(
      { length: 60 },
      (_, k) => (k < 30 ? k / 30 : 1) + 0.02 * Math.sin(k * 2),
    );
    expect(passPeaks(ripple, 0, 60, 30).idx).toEqual([]);
  });

  it("reads each finite run on its own and a flat signal gives nothing", () => {
    const sig = Float64Array.from({ length: 90 }, (_, k) =>
      k >= 40 && k < 46 ? Number.NaN : Math.sin((2 * Math.PI * k) / 30),
    );
    const p = passPeaks(sig, 0, 90, 30);
    expect(p.idx.every((k) => k < 40 || k >= 46)).toBe(true);
    expect(passPeaks(new Float64Array(50).fill(2), 0, 50, 30).idx).toEqual([]);
  });

  it("measures the detectors' disagreement as the share of events with no partner within 2 frames", () => {
    expect(disagreement([[10, 40], [25]], [[11, 42], [24]], 2)).toBe(0);
    // 40 against 44: both unmatched; 2 of 6 events.
    expect(disagreement([[10, 40], [25]], [[11, 44], [24]], 2)).toBeCloseTo(2 / 6, 12);
    expect(disagreement([[], []], [[], []], 2)).toBe(0);
  });
});

describe("Zeni side view events", () => {
  for (const spec of [
    { view: "pad_side", nearSide: "right", durationSec: 20, seed: 21 },
    { view: "pad_side", nearSide: "left", durationSec: 20, seed: 22, noise: 0.002, jitterMs: 6 },
    { view: "side", passes: 4, seed: 23 },
    { view: "side", passes: 4, seed: 24, speed: 0.6, cadence: 84, noise: 0.002 },
  ] satisfies WalkSpec[])
    it(`finds IC and TO within 2 frames on ${spec.view} (${spec.speed ?? 1.2} m/s, noise ${spec.noise ?? 0})`, () => {
      const { w, events } = eventsOf(spec);
      const ic = errors(w, events, "ic");
      const to = errors(w, events, "to");
      expect(ic.length).toBeGreaterThan(10);
      expect(to.length).toBeGreaterThan(10);
      expect(share(ic, (e) => Math.abs(e) <= 2 * FRAME_MS + 1)).toBeGreaterThanOrEqual(0.9);
      expect(share(to, (e) => Math.abs(e) <= 2 * FRAME_MS + 1)).toBeGreaterThanOrEqual(0.9);
      expect(events.every((e) => e.detector === "zeni")).toBe(true);
      expect(events.every((e) => e.confidence > 0 && e.confidence <= 1)).toBe(true);
      // every true IC in a pass is found once
      for (const side of ["left", "right"] as Side[]) {
        const found = events.filter((e) => e.type === "ic" && e.side === side).length;
        const truth = w.truth.ics.filter((e) => e.side === side).length;
        expect(Math.abs(found - truth), side).toBeLessThanOrEqual(spec.view === "side" ? 8 : 1);
      }
    });

  it("falls back to the ankle for a side whose heel fails the visibility gate in the pass", () => {
    const { w, events } = eventsOf({
      view: "pad_side",
      nearSide: "right",
      durationSec: 20,
      seed: 25,
      occlude: [{ from: 0, to: 20, landmarks: [29], visibility: 0.3 }],
    });
    const left = events.filter((e) => e.side === "left");
    const right = events.filter((e) => e.side === "right");
    expect(left.every((e) => e.detector === "ankle")).toBe(true);
    expect(right.every((e) => e.detector === "zeni")).toBe(true);
    // The ankle peaks sit near the contacts too (Stenum 2021).
    const ic = errors(w, left, "ic");
    expect(ic.length).toBeGreaterThan(10);
    expect(share(ic, (e) => Math.abs(e) <= 3 * FRAME_MS + 1)).toBeGreaterThanOrEqual(0.9);
  });

  it("falls back to the ankle when the foot index disagrees with it on more than 20% of events", () => {
    const w = walk({ view: "pad_side", nearSide: "right", durationSec: 20, seed: 26 });
    // A foot index that slides back and forth at its own rhythm: its troughs are not the toe offs.
    for (const f of w.frames) f.lm[32].x = (f.lm[23].x + f.lm[24].x) / 2 - 0.1 + 0.05 * Math.sin(f.t / 97);
    const p = prepare(w.frames, { rollDeg: 0, labels: "swaps" });
    const m = passesOf(p, "pad_side", "right");
    const events = detectEvents(p, m.passes, "side");
    expect(events.filter((e) => e.side === "right").every((e) => e.detector === "ankle")).toBe(true);
    expect(events.filter((e) => e.side === "left").every((e) => e.detector === "zeni")).toBe(true);
  });
});

describe("Stenum front view events", () => {
  it("gives alternating left and right ICs only, one per step, on the pad facing the phone", () => {
    const { w, events } = eventsOf({ view: "pad_front", durationSec: 20, seed: 31 });
    expect(events.every((e) => e.type === "ic" && e.detector === "stenum_front")).toBe(true);
    for (let i = 1; i < events.length; i++) expect(events[i].side).not.toBe(events[i - 1].side);
    expect(Math.abs(events.length - w.truth.ics.length)).toBeLessThanOrEqual(2);
    // Step times are the walk's (a shift common to every event does not change them).
    const steps = events.slice(1).map((e, i) => e.t - events[i].t);
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    expect(Math.abs(mean - w.truth.stepSec * 1000)).toBeLessThan(FRAME_MS / 2);
  });

  it("reverses the sides walking away (left IC at the minima of D) and names each IC's own side", () => {
    for (const view of ["front", "back"] as const) {
      // In the analysed part (1.5 to 4 m from the phone), each IC is nearer a true IC of its own
      // side than one of the other side.
      const { w, analysed } = eventsOf({ view, passes: 3, seed: 32 });
      expect(analysed.length).toBeGreaterThan(8);
      for (const e of analysed) {
        const own = Math.min(...w.truth.ics.filter((x) => x.side === e.side).map((x) => Math.abs(x.t - e.t)));
        const other = Math.min(
          ...w.truth.ics.filter((x) => x.side !== e.side).map((x) => Math.abs(x.t - e.t)),
        );
        expect(own, `${view} ${e.side} ${e.t}`).toBeLessThan(other);
      }
    }
  });
});
