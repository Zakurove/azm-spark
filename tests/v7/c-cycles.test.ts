/**
 * src/engine/gait/cycles.ts and the order check of src/engine/gait/spatiotemporal.ts (gait-rules 3.3
 * plausibility and order checks, 3.6 cycle gate, 3.2 steady state): every drop reason on small hand
 * made inputs, and clean cycles on synthetic walks.
 */
import { describe, expect, it } from "vitest";
import { buildCycles } from "../../src/engine/gait/cycles";
import type { PassEvent } from "../../src/engine/gait/events";
import { analyseGaitView } from "../../src/engine/gait/analyse";
import { EXCLUDED, type Motion, type Pass } from "../../src/engine/gait/passes";
import { prepare, type Prepared } from "../../src/engine/gait/preprocess";
import { correctOrder } from "../../src/engine/gait/spatiotemporal";
import type { GaitFrame } from "../../src/engine/gait/types";
import type { Landmark } from "../../src/engine/types";
import { setupOf, walk } from "../fixtures/gait/gen-gait";

/** 30 fps frames, every landmark seen, `hide` landmarks under the floor in frames [from, to). */
function still(n: number, hide?: { from: number; to: number; ids: number[] }): Prepared {
  const frames: GaitFrame[] = Array.from({ length: n }, (_, i) => {
    const lm: Landmark[] = Array.from({ length: 33 }, (_, k) => ({
      x: 0.3 + 0.01 * k,
      y: 0.1 + 0.025 * k,
      z: 0,
      visibility: hide && i >= hide.from && i < hide.to && hide.ids.includes(k) ? 0.2 : 0.95,
    }));
    return { t: (i * 1000) / 30, lm, aspect: 1 };
  });
  return prepare(frames, { rollDeg: null, labels: "none" });
}

function pass(over: Partial<Pass> = {}): Pass {
  return {
    start: 0,
    end: 200,
    d: 1,
    facing: "side",
    near: "right",
    turnAtStart: false,
    turnAtEnd: false,
    ...over,
  };
}

function motion(p: Prepared, passes: Pass[], mark?: (ex: Uint8Array) => void): Motion {
  const excluded = new Uint8Array(p.series.n);
  mark?.(excluded);
  return { passes, excluded, wrongViewShare: 0 };
}

const ev = (side: "left" | "right", type: "ic" | "to", index: number, pass = 0): PassEvent => ({
  side,
  type,
  index,
  t: Math.round((index * 1000) / 30),
  confidence: 1,
  detector: "zeni",
  pass,
});

/** A regular side walk on the grid: right IC at 0, left TO at 4, left IC at 16, right TO at 20, ... (30 samples a stride). */
function regular(strides: number, from = 0): PassEvent[] {
  const out: PassEvent[] = [];
  for (let i = 0; i < strides; i++) {
    const b = from + i * 30;
    out.push(
      ev("right", "ic", b),
      ev("left", "to", b + 4),
      ev("left", "ic", b + 16),
      ev("right", "to", b + 20),
    );
  }
  out.push(ev("right", "ic", from + strides * 30));
  return out;
}

describe("order check (OpenCap detect_correct_order)", () => {
  it("accepts IC of a side, TO of the other, IC of the other, TO of the first, in turn", () => {
    const seq = (s: string) =>
      s
        .split(" ")
        .map((x) => ({ side: x[0] === "r" ? "right" : "left", type: x.slice(1) as "ic" | "to" }) as const);
    expect(correctOrder(seq("ric lto lic rto ric"))).toBe(true);
    expect(correctOrder(seq("lic rto ric lto lic"))).toBe(true);
    expect(correctOrder(seq("ric lic lto rto ric"))).toBe(false);
    expect(correctOrder(seq("ric lto rto ric"))).toBe(false);
    expect(correctOrder([])).toBe(true);
  });
});

describe("cycles and their drops", () => {
  it("builds clean cycles of each side from a regular walk", () => {
    const p = still(200);
    const cycles = buildCycles(p, motion(p, [pass()]), regular(5), "side", false);
    expect(cycles.filter((c) => c.side === "right" && c.clean)).toHaveLength(5);
    expect(cycles.filter((c) => c.side === "left" && c.clean)).toHaveLength(4);
    const c = cycles.find((x) => x.side === "right")!;
    expect([c.k0, c.kOppTo, c.kOppIc, c.kTo, c.k1]).toEqual([0, 4, 16, 20, 30]);
    expect([c.icStart, c.to, c.icEnd]).toEqual([0, 667, 1000]);
    expect(c.near).toBe(true);
    expect(cycles.find((x) => x.side === "left")!.near).toBe(false);
  });

  it("drops a cycle whose events are out of order (a missing TO), and calls it a swap when labels were exchanged in it", () => {
    const p = still(200);
    const events = regular(4).filter((e) => !(e.type === "to" && e.index === 34));
    const cycles = buildCycles(p, motion(p, [pass()]), events, "side", false);
    expect(cycles.find((c) => c.side === "right" && c.k0 === 30)?.drop).toBe("order");
    p.series.relabelled[40] = 1;
    const again = buildCycles(p, motion(p, [pass()]), events, "side", false);
    expect(again.find((c) => c.side === "right" && c.k0 === 30)?.drop).toBe("swap");
  });

  it("drops a stride outside 0.5 to 1.5 times the pass median (duration)", () => {
    const p = still(260);
    // Four regular strides, then one twice as long.
    const events = [
      ...regular(4).slice(0, -1),
      ...regular(1, 120).map((e) => {
        const index = 120 + (e.index - 120) * 2;
        return { ...e, index, t: Math.round((index * 1000) / 30) };
      }),
    ];
    const cycles = buildCycles(p, motion(p, [pass({ end: 260 })]), events, "side", false);
    const long = cycles.find((c) => c.side === "right" && c.k0 === 120)!;
    expect(long.drop).toBe("duration");
    expect(cycles.filter((c) => c.side === "right" && c.clean)).toHaveLength(4);
  });

  it("drops a cycle whose gate landmarks are under 0.5 in more than 10% of its frames (visibility)", () => {
    const p = still(200, { from: 35, to: 40, ids: [32] });
    const cycles = buildCycles(p, motion(p, [pass()]), regular(5), "side", false);
    expect(cycles.find((c) => c.side === "right" && c.k0 === 30)?.drop).toBe("visibility");
    expect(cycles.find((c) => c.side === "right" && c.k0 === 0)?.clean).toBe(true);
  });

  it("gates a side view's cycle on the hips and its own leg: the other leg hiding behind it drops nothing (D-026 item 6)", () => {
    const p = still(200, { from: 35, to: 40, ids: [25, 27, 31] });
    const side = buildCycles(p, motion(p, [pass()]), regular(5), "side", true);
    expect(side.find((c) => c.side === "right" && c.k0 === 30)?.clean).toBe(true);
    // The other leg's own cycle over the same frames is dropped: far limb events and metrics come only
    // from cycles where that leg passes its own gate.
    expect(side.filter((c) => c.side === "left" && c.drop === "visibility").length).toBeGreaterThan(0);
  });

  it("gates the pad side view's timing on the near limb: the far leg hiding behind it keeps its cycle (D-026 item 6)", () => {
    const p = still(200, { from: 35, to: 40, ids: [25, 27, 31] });
    const pad = buildCycles(p, motion(p, [pass()]), regular(5), "side", false);
    expect(pad.find((c) => c.side === "right" && c.k0 === 30)?.clean).toBe(true);
    // The far (left) leg's cycles are timed on the hips and the near leg, so the far leg hidden for 5
    // frames drops none; a near leg hidden drops the cycles of both legs.
    expect(pad.filter((c) => c.side === "left" && c.drop === "visibility")).toEqual([]);
    const nearHidden = still(200, { from: 35, to: 40, ids: [26, 28, 32] });
    const hidden = buildCycles(nearHidden, motion(nearHidden, [pass()]), regular(5), "side", false);
    expect(hidden.some((c) => c.side === "left" && c.drop === "visibility")).toBe(true);
    expect(hidden.find((c) => c.side === "right" && c.k0 === 30)?.drop).toBe("visibility");
  });

  it("records whether the trunk landmarks pass the same gate", () => {
    const p = still(200, { from: 0, to: 12, ids: [11] });
    const cycles = buildCycles(p, motion(p, [pass()]), regular(5), "side", false);
    expect(cycles.find((c) => c.side === "right" && c.k0 === 0)?.trunkOk).toBe(false);
    expect(cycles.find((c) => c.side === "right" && c.k0 === 60)?.trunkOk).toBe(true);
  });

  it("drops a cycle that reaches a turn margin, or leaves the front view's window (pass_edge)", () => {
    const p = still(200);
    const m = motion(p, [pass()], (ex) => {
      ex[45] = EXCLUDED.turn;
      ex[95] = EXCLUDED.window;
    });
    const cycles = buildCycles(p, m, regular(5), "side", false);
    expect(cycles.find((c) => c.side === "right" && c.k0 === 30)?.drop).toBe("turn");
    expect(cycles.find((c) => c.side === "right" && c.k0 === 90)?.drop).toBe("pass_edge");
  });

  it("drops the first two and last two steps of an overground pass only where the start or stop is in view", () => {
    const p = still(260);
    // Entering and leaving the picture walking: the first IC within a stride of the pass start.
    const entering = buildCycles(p, motion(p, [pass({ start: 0, end: 160 })]), regular(5, 5), "side", true);
    expect(entering.every((c) => c.clean)).toBe(true);
    // Standing in view for 2 s first: the first two steps (ending at the ICs 60 and 76) are dropped,
    // so the right cycle 60 to 90, which holds the step ending at 76, goes; the left cycle from 76
    // holds the third and fourth steps and stays.
    const fromRest = buildCycles(p, motion(p, [pass({ start: 0, end: 259 })]), regular(5, 60), "side", true);
    const dropped = fromRest.filter((c) => c.drop === "pass_edge").map((c) => `${c.side} ${c.k0}`);
    expect(dropped).toContain("right 60");
    expect(fromRest.find((c) => c.side === "left" && c.k0 === 76)?.clean).toBe(true);
    // ... and the last two steps (ending at 196 and 210) before stopping in view (the walk ends at
    // 210, the pass at 259).
    expect(fromRest.find((c) => c.side === "right" && c.k0 === 180)?.drop).toBe("pass_edge");
    expect(fromRest.find((c) => c.side === "left" && c.k0 === 166)?.drop).toBe("pass_edge");
    expect(fromRest.find((c) => c.side === "right" && c.k0 === 150)?.clean).toBe(true);
    // A pass that starts at a turn drops its first two steps too.
    const afterTurn = buildCycles(
      p,
      motion(p, [pass({ end: 160, turnAtStart: true })]),
      regular(5, 5),
      "side",
      true,
    );
    expect(afterTurn.find((c) => c.side === "right" && c.k0 === 5)?.drop).toBe("pass_edge");
    // On the pad nothing is dropped for steady state.
    const pad = buildCycles(p, motion(p, [pass({ start: 0, end: 215 })]), regular(5, 60), "side", false);
    expect(pad.every((c) => c.clean)).toBe(true);
  });

  it("builds front view cycles from ICs only: exactly one IC of the other side between", () => {
    const p = still(200);
    const ics: PassEvent[] = [];
    for (let i = 0; i < 9; i++) ics.push(ev(i % 2 ? "left" : "right", "ic", i * 15));
    ics.splice(5, 1); // a lost left IC at 75: the right cycle 60 to 90 holds no left IC
    const cycles = buildCycles(p, motion(p, [pass({ facing: "toward", near: null })]), ics, "front", false);
    expect(cycles.find((c) => c.side === "right" && c.k0 === 60)?.drop).toBe("order");
    const ok = cycles.find((c) => c.side === "right" && c.k0 === 0)!;
    expect(ok.clean).toBe(true);
    expect(ok.to).toBeNull();
    expect(ok.kOppIc).toBe(15);
  });
});

describe("cycles of synthetic walks", () => {
  it("gives clean cycles on both sides of a pad side walk and an overground side walk", () => {
    for (const spec of [
      { view: "pad_side", nearSide: "left", durationSec: 30, seed: 51 },
      { view: "side", passes: 4, seed: 52 },
    ] as const) {
      const w = walk(spec);
      const r = analyseGaitView({
        view: spec.view,
        nearSide: "nearSide" in spec ? spec.nearSide : undefined,
        setup: setupOf(spec),
        standing: w.standing,
        frames: w.frames,
        poseModel: "full",
        rollDeg: 0,
      });
      expect(r.quality.cleanCycles.left).toBeGreaterThanOrEqual(6);
      expect(r.quality.cleanCycles.right).toBeGreaterThanOrEqual(6);
      for (const c of r.cycles.filter((x) => x.clean)) {
        expect(c.to).not.toBeNull();
        expect(c.icStart).toBeLessThan(c.to!);
        expect(c.to!).toBeLessThan(c.icEnd);
        expect(Math.abs(c.icEnd - c.icStart - w.truth.strideSec * 1000)).toBeLessThanOrEqual(
          2 * (1000 / 30) + 1,
        );
      }
    }
  });
});
