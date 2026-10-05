/**
 * D-028 item 2 (AP-7): on the walking pad the model often lays the hidden far leg on the near one;
 * its heel then peaks with the near heel (at a visibility of 0.8 to 0.93, which no visibility gate
 * catches), and the order check drops the near cycles that see two far contacts. The pad side view
 * now masks the far leg's contacts that lie on the near leg (PAD_FAR_MASK: a far heel, foot index or
 * ankle peak within a quarter of a foot length of the near leg's same point, an engineering margin
 * judged on the team's videos), so a false far contact never breaks a near stride. A clean walk keeps
 * its contacts, and G1's real model walks still pass (tests/v7/c-pad-near-limb.test.ts).
 */
import { describe, expect, it } from "vitest";
import { analyseGaitView } from "../../src/engine/gait/analyse";
import { detectEvents } from "../../src/engine/gait/events";
import { GAIT_ENGINE, PAD_FAR_MASK } from "../../src/engine/gait/params";
import { passesOf } from "../../src/engine/gait/passes";
import { prepare } from "../../src/engine/gait/preprocess";
import type { GaitFrame } from "../../src/engine/gait/types";
import { setupOf, walk, type Walk, type WalkSpec } from "../fixtures/gait/gen-gait";
import { loadSmoke } from "../fixtures/gait/smoke";

const SPEC: WalkSpec = {
  view: "pad_side",
  nearSide: "right",
  durationSec: 30,
  seed: 61,
  speed: 0.9,
  cadence: 100,
  noise: 0.002,
  jitterMs: 4,
};

/** The near (right) leg's foot points, and the far (left) leg's ones the model lays on them. */
const NEAR_FOOT = [28, 30, 32] as const;
const FAR_FOOT = [27, 29, 31] as const;

/**
 * The far leg drawn on the near one around the near leg's contacts, in every `every`-th near stride,
 * for `halfMs` either side of the contact: the far ankle, heel and foot index take the near ones'
 * places (a few thousandths of the picture off, as a model's second guess is) at the visibility the
 * real model gave them (0.85).
 */
function farOnNear(w: Walk, every = 2, halfMs = 70): GaitFrame[] {
  const contacts = w.truth.ics.filter((e) => e.side === "right").map((e) => e.t);
  const windows = contacts.filter((_, i) => i % every === 0).map((t) => [t - halfMs, t + halfMs]);
  return w.frames.map((f) => {
    if (!windows.some(([a, b]) => f.t >= a && f.t <= b)) return f;
    const lm = f.lm.map((q) => ({ ...q }));
    NEAR_FOOT.forEach((n, i) => {
      lm[FAR_FOOT[i]] = { ...lm[n], x: lm[n].x + 0.003, y: lm[n].y - 0.002, visibility: 0.85 };
    });
    return { ...f, lm };
  });
}

const analyse = (frames: GaitFrame[], w: Walk) =>
  analyseGaitView({
    view: "pad_side",
    nearSide: "right",
    setup: setupOf(SPEC),
    standing: w.standing,
    frames,
    poseModel: "full",
    rollDeg: 0,
  });

/** The events of a pad side walk, with the pad's rules (`pad`) or as any side view. */
function eventsOf(frames: GaitFrame[], pad: boolean) {
  const p = prepare(frames, { rollDeg: 0, labels: "swaps", bouts: "either_ankle", nearSide: "right" });
  return detectEvents(p, passesOf(p, "pad_side", "right").passes, "side", pad);
}

const nearContacts = (w: Walk) => w.truth.ics.filter((e) => e.side === "right").map((e) => e.t);
const falseFar = (events: ReturnType<typeof eventsOf>, w: Walk) =>
  events.filter(
    (e) => e.side === "left" && e.type === "ic" && nearContacts(w).some((t) => Math.abs(t - e.t) <= 60),
  );

describe("the pad side view masks the far leg's contacts that lie on the near leg (D-028 item 2, AP-7)", () => {
  it("is a quarter of a foot length", () => {
    expect(PAD_FAR_MASK).toEqual({ footShare: 0.25 });
  });

  it("keeps the near strides a false far contact broke: the gate passes and the cadence holds", () => {
    const w = walk(SPEC);
    const clean = analyse(w.frames, w);
    for (const every of [2, 1]) {
      const r = analyse(farOnNear(w, every), w);
      expect(r.quality.gatePassed).toBe(true);
      expect(Math.abs(r.metrics.cadence!.value! / w.truth.cadence - 1)).toBeLessThan(0.05);
      // The near leg keeps nearly every clean cycle the clean walk has.
      expect(r.quality.cleanCycles.right).toBeGreaterThanOrEqual(clean.quality.cleanCycles.right - 2);
      expect(r.quality.cleanCycles.left).toBeGreaterThanOrEqual(GAIT_ENGINE.cleanCyclesPerSide);
      expect(r.cycles.filter((c) => c.side === "right" && c.drop === "order").length).toBeLessThanOrEqual(2);
    }
  });

  it("finds no far contact at a near contact on the pad, where any side view would", () => {
    const w = walk(SPEC);
    const frames = farOnNear(w, 1);
    expect(falseFar(eventsOf(frames, false), w).length).toBeGreaterThan(5);
    expect(falseFar(eventsOf(frames, true), w)).toEqual([]);
  });

  it("leaves a clean pad walk's far contacts where they are", () => {
    const w = walk(SPEC);
    const found = eventsOf(w.frames, true).filter((e) => e.side === "left" && e.type === "ic");
    const truth = w.truth.ics.filter((e) => e.side === "left").map((e) => e.t);
    const matched = truth.filter((t) => found.some((e) => Math.abs(e.t - t) <= 67)).length;
    expect(matched / truth.length).toBeGreaterThanOrEqual(0.9);
    expect(eventsOf(w.frames, true).length).toBe(eventsOf(w.frames, false).length);
  });

  for (const name of ["gait-pad-side-full", "gait-pad-side-lite"] as const)
    it(`keeps G1's real model walk passing (${name})`, () => {
      const s = loadSmoke(name);
      const r = analyseGaitView({
        view: "pad_side",
        nearSide: s.nearSide,
        setup: s.setup,
        standing: s.standing,
        frames: s.frames,
        poseModel: s.model,
        rollDeg: 0,
      });
      expect(r.quality.gatePassed).toBe(true);
      expect(Math.abs(r.metrics.cadence!.value! / s.truth.cadence - 1)).toBeLessThan(0.05);
    });
});
