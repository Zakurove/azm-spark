/**
 * The real model smoke's pad walk as a regression (D-026 item 6, GG-4, D-027 item 4): G1's rendered
 * walk on the pad seen from the right, through MediaPipe Full and Lite (tests/fixtures/gait/smoke),
 * whose far leg hides behind the near one for part of each stride. C1 dropped every cycle of it; until
 * GG-4's swap rule and foot detector landed the engine failed it safely. With them (D-027 item 4: the
 * legs exchanged only where the near leg's own track jumps more than half a foot length; a foot
 * detector with two events of a kind in a near stride falling back to the ankle) and the pad side
 * view's timing gated on the near limb, both walks pass their gate with the cadence within 5% of the
 * truth (8.4). Made overground, no side view passes its gate on a wrong walk; the generator's
 * overground side walks, with the far leg the real model reports, pass.
 */
import { describe, expect, it } from "vitest";
import { analyseGaitView } from "../../src/engine/gait/analyse";
import { detectEvents, peakTime } from "../../src/engine/gait/events";
import { passesOf } from "../../src/engine/gait/passes";
import { footLength, prepare } from "../../src/engine/gait/preprocess";
import { loadSmoke, overgroundFromPad } from "../fixtures/gait/smoke";
import {
  farLegOf,
  REAL_FAR_LEG,
  setupOf,
  walk,
  withRealFarLeg,
  type WalkSpec,
} from "../fixtures/gait/gen-gait";
import { GAIT_ENGINE, PAD_SWAP } from "../../src/engine/gait/params";

describe("G1's rendered pad walk through the real model (D-027 item 4)", () => {
  for (const name of ["gait-pad-side-full", "gait-pad-side-lite"] as const)
    it(`passes its gate with the cadence within 5% of the truth (${name})`, () => {
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
      expect(r.quality.cleanCycles.left).toBeGreaterThanOrEqual(GAIT_ENGINE.cleanCyclesPerSide);
      expect(r.quality.cleanCycles.right).toBeGreaterThanOrEqual(GAIT_ENGINE.cleanCyclesPerSide);
      expect(Math.abs(r.metrics.cadence!.value! / s.truth.cadence - 1)).toBeLessThan(0.05);
      // The near leg's contacts: within 100 ms of the truth, 90% or more (the walk's first and last
      // contacts sit at its edges, where no peak can be read).
      const near = r.events.filter((e) => e.side === s.nearSide && e.type === "ic");
      const truth = s.truth.ics.filter((e) => e.side === s.nearSide);
      const found = truth.filter((t) => near.some((e) => Math.abs(e.t - t.t) <= 100)).length;
      expect(found / truth.length).toBeGreaterThanOrEqual(0.9);
    });

  it("exchanges the legs only where the near leg's own track jumps: never on the model's good labels", () => {
    // Full tracks the near leg well: the near heel, as the model labels it, peaks once a stride within
    // 2 frames of each true contact (C2's measure), and the rule leaves almost every sample as the
    // model labelled it (13 of 900 samples; the both legs rule exchanged 76).
    const s = loadSmoke("gait-pad-side-full");
    const p = prepare(s.frames, { rollDeg: 0, labels: "none" }).series;
    const near = s.nearSide === "right" ? 30 : 29;
    const rel = Array.from({ length: p.n }, (_, k) => p.x[near][k] - (p.x[23][k] + p.x[24][k]) / 2);
    const truth = s.truth.ics.filter((e) => e.side === s.nearSide).map((e) => e.t);
    let found = 0;
    for (const t of truth) {
      const k = Math.round((t / 1000 - p.t[0]) * p.hz);
      if (k < 3 || k > p.n - 4) continue;
      // The walker faces the picture's right (near side right): the heel leads at contact.
      const win = rel.slice(k - 2, k + 3).filter(Number.isFinite);
      const before = rel.slice(k - 8, k - 2).filter(Number.isFinite);
      const after = rel.slice(k + 3, k + 9).filter(Number.isFinite);
      if (win.length && before.length && after.length)
        if (Math.max(...win) > Math.max(...before) && Math.max(...win) > Math.max(...after)) found++;
    }
    expect(found / truth.length).toBeGreaterThan(0.9);
    const share = (nearSide?: "left" | "right") => {
      const p = prepare(s.frames, { rollDeg: 0, labels: "swaps", ...(nearSide ? { nearSide } : {}) }).series;
      return p.relabelled.reduce((a, b) => a + b, 0) / p.n;
    };
    expect(share(s.nearSide)).toBeLessThan(0.05);
    expect(share()).toBeGreaterThan(0.05);
    expect(PAD_SWAP).toEqual({ jumpFootShare: 0.5, exchangeCostFootShare: 0.25 });
  });
});

describe("the pad side view's swap rule and foot detector (D-027 item 4)", () => {
  const pad = (over: Partial<WalkSpec> = {}): WalkSpec => ({
    view: "pad_side",
    nearSide: "right",
    durationSec: 12,
    seed: 41,
    speed: 0.9,
    cadence: 100,
    ...over,
  });

  it("puts the near leg back where the model swaps the labels for a few frames at the legs' widest", () => {
    // Late in the near leg's swing the legs are a step apart: a 3 frame swap is a jump of the near
    // track beyond half a foot, in and out. The generator times its swaps from the walk's first frame.
    const clean = walk(pad());
    const start = clean.frames[0].t / 1000;
    const icAt = clean.truth.ics.filter((e) => e.side === "right")[3].t / 1000 - start;
    const swaps = [{ from: icAt - 0.1, to: icAt - 0.01 }];
    const w = walk(pad({ swaps }));
    const ref = prepare(clean.frames, { rollDeg: 0, labels: "none" }).series;
    const foot = footLength(ref);
    const worstOf = (labels: "swaps" | "none", nearSide?: "right") => {
      const p = prepare(w.frames, { rollDeg: 0, labels, ...(nearSide ? { nearSide } : {}) }).series;
      let worst = 0;
      for (let k = 0; k < Math.min(ref.n, p.n); k++)
        if (Number.isFinite(ref.x[30][k] + p.x[30][k]))
          worst = Math.max(worst, Math.abs(ref.x[30][k] - p.x[30][k]));
      return { p, worst };
    };
    // Without a rule the swap stays in the near track, more than half a foot off.
    expect(worstOf("none").worst).toBeGreaterThan(PAD_SWAP.jumpFootShare * foot);
    // With the rule exactly the swapped frames are exchanged back, and the near heel is the clean walk's.
    const fixed = worstOf("swaps", "right");
    const exchanged = [...fixed.p.relabelled.keys()]
      .filter((k) => fixed.p.relabelled[k] === 1)
      .map((k) => fixed.p.t[k] - start);
    expect(exchanged.length).toBe(3);
    expect(exchanged.every((t) => t >= swaps[0].from - 1e-6 && t < swaps[0].to)).toBe(true);
    expect(fixed.worst).toBeLessThan(0.25 * foot);
  });

  it("keeps the model's labels on a clean pad walk: no exchange at all", () => {
    const w = walk(pad());
    const p = prepare(w.frames, { rollDeg: 0, labels: "swaps", nearSide: "right" }).series;
    expect(p.relabelled.every((v) => v === 0)).toBe(true);
  });

  it("falls back to the ankle when the foot index gives two toe offs in a near stride", () => {
    const w = walk(pad());
    // A foot index that swings back once more in the middle of each near swing (Lite's second toe off).
    const strideMs = 1200;
    const tos = w.truth.tos.filter((e) => e.side === "right").map((e) => e.t);
    const frames = w.frames.map((f) => {
      const lm = f.lm.map((q) => ({ ...q }));
      for (const t of tos) {
        const u = (f.t - (t + 0.3 * strideMs)) / 50;
        if (Math.abs(u) < 2) lm[32] = { ...lm[32], x: lm[32].x - 0.25 * Math.exp(-u * u) };
      }
      return { ...f, lm };
    });
    const detectorOf = (fs: typeof frames) => {
      const p = prepare(fs, { rollDeg: 0, labels: "swaps", bouts: "either_ankle", nearSide: "right" });
      const motion = passesOf(p, "pad_side", "right");
      const events = detectEvents(p, motion.passes, "side", true);
      return [...new Set(events.filter((e) => e.side === "right").map((e) => e.detector))];
    };
    expect(detectorOf(w.frames)).toEqual(["zeni"]);
    expect(detectorOf(frames)).toEqual(["ankle"]);
  });
});

describe("sub-frame event times (CG-21, D-027 item 5)", () => {
  it("puts a peak at the vertex of the parabola through it and its two neighbours", () => {
    const s = { t: Float64Array.from([0, 1 / 30, 2 / 30, 3 / 30]), hz: 30 };
    // y = -(i - 1.3)^2: the vertex is 0.3 of a frame after sample 1.
    const sig = Float64Array.from([0, 1, 2, 3], (i) => -((i - 1.3) ** 2));
    expect(peakTime(s, sig, 1)).toBeCloseTo(1.3 / 30, 9);
    // A missing neighbour or a flat top keeps the sample's own time.
    expect(peakTime(s, Float64Array.from([Number.NaN, 1, 0, 0]), 1)).toBe(1 / 30);
    expect(peakTime(s, Float64Array.from([1, 1, 1, 0]), 1)).toBe(1 / 30);
  });

  it("times a synthetic pad walk's events closer to the truth than the 30 Hz grid", () => {
    const w = walk({ view: "pad_side", nearSide: "right", durationSec: 20, seed: 7, speed: 1, cadence: 104 });
    const r = analyseGaitView({
      view: "pad_side",
      nearSide: "right",
      setup: setupOf({
        view: "pad_side",
        nearSide: "right",
        durationSec: 20,
        seed: 7,
        speed: 1,
        cadence: 104,
      }),
      standing: w.standing,
      frames: w.frames,
      poseModel: "full",
      rollDeg: 0,
    });
    // The stride times between consecutive contacts: the grid rounds each contact to its frame (33 ms),
    // the parabola does not (a detector's own lag cancels in a difference).
    const ics = r.events.filter((x) => x.side === "right" && x.type === "ic");
    const strideMs = 120_000 / 104;
    const sub: number[] = [];
    const grid: number[] = [];
    for (let i = 1; i < ics.length; i++) {
      sub.push(Math.abs(ics[i].t - ics[i - 1].t - strideMs));
      grid.push(Math.abs(((ics[i].index - ics[i - 1].index) * 1000) / 30 - strideMs));
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(sub.length).toBeGreaterThan(10);
    expect(mean(sub)).toBeLessThan(mean(grid));
  });
});

describe("the overground side view with the far leg as the real model sees it (D-026 item 6, engine review 2)", () => {
  // Without the near limb rule every cycle of these walks was dropped (visibility) and the walk split
  // into bouts: no cadence, gate failed, on every phone.
  const specs: WalkSpec[] = [
    { view: "side", passes: 4, seed: 91 },
    { view: "side", passes: 4, seed: 92, cadence: 96, speed: 0.9 },
    // A fast walker gives each leg about two cycles a pass where it is near: the protocol's 6 passes.
    { view: "side", passes: 6, seed: 93, cadence: 120, speed: 1.4 },
  ];
  for (const spec of specs)
    it(`passes its gate and times the walk (cadence ${spec.cadence ?? 108})`, () => {
      const w = walk(spec);
      const frames = withRealFarLeg(w.frames);
      // The model the walk was made to: the far knee hidden in about 46% of the frames that show a far
      // side, the far ankle in about 12%.
      const sides = w.frames.map((f) => farLegOf(f.lm));
      const shown = sides.filter((s) => s !== null).length;
      const hidden = (ids: { left: number; right: number }) =>
        frames.filter((f, i) => sides[i] && f.lm[ids[sides[i]!]].visibility < 0.5).length / shown;
      expect(hidden({ left: 25, right: 26 })).toBeCloseTo(REAL_FAR_LEG.knee, 1);
      expect(hidden({ left: 27, right: 28 })).toBeCloseTo(REAL_FAR_LEG.ankle, 1);
      const r = analyseGaitView({
        view: "side",
        setup: setupOf(spec),
        standing: w.standing,
        frames,
        poseModel: "full",
        rollDeg: 0,
      });
      expect(r.quality.gatePassed).toBe(true);
      expect(r.quality.cleanCycles.left).toBeGreaterThanOrEqual(GAIT_ENGINE.cleanCyclesPerSide);
      expect(r.quality.cleanCycles.right).toBeGreaterThanOrEqual(GAIT_ENGINE.cleanCyclesPerSide);
      expect(Math.abs(r.metrics.cadence!.value! / w.truth.cadence - 1)).toBeLessThan(0.05);
      // The near leg's step length is still read against the walker's own (within 5%).
      const clean = analyseGaitView({
        view: "side",
        setup: setupOf(spec),
        standing: w.standing,
        frames: w.frames,
        poseModel: "full",
        rollDeg: 0,
      });
      expect(
        Math.abs(r.metrics.step_length_m!.value! / clean.metrics.step_length_m!.value! - 1),
      ).toBeLessThan(0.05);
      expect(r.quality.issues).not.toContain("gaps");
    });

  it("tells a fast walker's 4 passes they are too few, never that the legs were not seen", () => {
    // Each leg's cycles come from the passes where it is near; the far leg's dropped cycles are the
    // near limb rule at work, not a visibility problem of the walk (capture adds passes, up to 6).
    const spec: WalkSpec = { view: "side", passes: 4, seed: 93, cadence: 120, speed: 1.4 };
    const w = walk(spec);
    const r = analyseGaitView({
      view: "side",
      setup: setupOf(spec),
      standing: w.standing,
      frames: withRealFarLeg(w.frames),
      poseModel: "full",
      rollDeg: 0,
    });
    expect(r.quality.gatePassed).toBe(false);
    expect(r.quality.issues).toEqual(["too_few_cycles"]);
  });
});

describe("G1's real model walk made overground: a side view never passes its gate on a wrong walk (W2-15)", () => {
  // Each pass of the pad walk moved at the belt speed, every second pass mirrored (overgroundFromPad).
  // On real model output the swap rule still carries the far leg into the near track (GG-4), so some
  // near cycles are wrong (Lite: cadence 23 to 71% off); the view must then fail its gate.
  const layouts = [
    [6.5, 4],
    [5, 6],
    [7.5, 4],
  ] as const;
  for (const name of ["gait-pad-side-full", "gait-pad-side-lite"] as const)
    for (const [passSec, passes] of layouts)
      it(`${name}, ${passes} passes of ${passSec} s`, () => {
        const w = overgroundFromPad(name, passSec, passes);
        const r = analyseGaitView({
          view: "side",
          setup: w.setup,
          standing: w.standing,
          frames: w.frames,
          poseModel: w.model,
          rollDeg: 0,
        });
        if (r.quality.gatePassed)
          expect(Math.abs(r.metrics.cadence!.value! / w.truth.cadence - 1)).toBeLessThan(0.05);
        else expect(r.quality.issues).toContain("too_few_cycles");
      });
});
