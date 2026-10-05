/**
 * src/engine/gait/quality.ts (product v7 contract 2.8 GaitQuality; gait-rules 2.1 frame rate, 3.6
 * view gates): clean cycles per side, the processed frame rate (the mean over the view, D-026), the
 * gap share, the gate, timing only and the issues.
 */
import { describe, expect, it } from "vitest";
import { analyseGaitView } from "../../src/engine/gait/analyse";
import type { Cycle } from "../../src/engine/gait/cycles";
import { EXCLUDED, type Motion } from "../../src/engine/gait/passes";
import { prepare } from "../../src/engine/gait/preprocess";
import { meanFps, medianFps, viewQuality } from "../../src/engine/gait/quality";
import type { GaitFrame, GaitViewResult } from "../../src/engine/gait/types";
import type { Landmark } from "../../src/engine/types";
import { setupOf, walk, type WalkSpec } from "../fixtures/gait/gen-gait";

function analyse(spec: WalkSpec, view = spec.view): GaitViewResult {
  const w = walk(spec);
  return analyseGaitView({
    view,
    nearSide: view === "pad_side" ? (spec.nearSide ?? "right") : undefined,
    setup: setupOf(spec),
    standing: w.standing,
    frames: w.frames,
    poseModel: "full",
    rollDeg: 0,
  });
}

describe("frame rate", () => {
  it("is the mean rate over the view's frames (D-026 item 6, CG-6)", () => {
    expect(meanFps([0, 33, 66, 100, 133, 200])).toBeCloseTo(5000 / 200, 12);
    expect(meanFps([0])).toBe(0);
    expect(meanFps([5, 5])).toBe(0);
    // A stream that loses every fourth frame delivers 22.5 frames a second: timing only.
    const lossy = analyse({ view: "pad_side", nearSide: "right", durationSec: 20, seed: 76, dropEvery: 4 });
    expect(lossy.quality.medianFps).toBeCloseTo(22.5, 1);
    expect(lossy.quality.timingOnly).toBe(true);
    expect(lossy.quality.issues).toContain("low_fps");
    expect(lossy.metrics.knee_swing_peak).toBeUndefined();
  });

  it("counts only the time inside the passes: an overground walk with no frames while the walker is out of the picture reads its camera rate", () => {
    const spec: WalkSpec = { view: "side", passes: 4, seed: 81 };
    const w = walk(spec);
    // As G1's GaitCapture keeps them: only the frames that hold the walker (mid hip in the picture).
    const inView = w.frames.filter((f) => {
      const x = (f.lm[23].x + f.lm[24].x) / 2;
      return x > 0 && x < 1 && f.lm[23].visibility >= 0.5;
    });
    expect(inView.length).toBeLessThan(w.frames.length * 0.8);
    const all = analyseGaitView({
      view: "side",
      setup: setupOf(spec),
      standing: w.standing,
      frames: w.frames,
      poseModel: "full",
      rollDeg: 0,
    });
    const picked = analyseGaitView({
      view: "side",
      setup: setupOf(spec),
      standing: w.standing,
      frames: inView,
      poseModel: "full",
      rollDeg: 0,
    });
    expect(all.quality.medianFps).toBeCloseTo(30, 0);
    expect(picked.quality.medianFps).toBeCloseTo(30, 0);
    expect(picked.quality.issues).not.toContain("low_fps");
    expect(picked.quality.gatePassed).toBe(all.quality.gatePassed);
    // A model that loses frames inside the passes still counts them (D-026 item 6).
    const lossy = analyseGaitView({
      view: "side",
      setup: setupOf(spec),
      standing: w.standing,
      frames: inView.filter((_, i) => i % 4 !== 3),
      poseModel: "full",
      rollDeg: 0,
    });
    expect(lossy.quality.medianFps).toBeLessThan(24);
  });

  it("keeps the median gap measure for the probe's comparisons (A6a-3)", () => {
    expect(medianFps([0, 33, 66, 100, 133, 200])).toBeCloseTo(1000 / 33, 12);
    expect(medianFps([0])).toBe(0);
    // A frame dropped now and then does not lower the median gap.
    expect(medianFps([0, 33, 66, 133, 166, 200, 266])).toBeCloseTo(1000 / 33.5, 12);
  });

  it("passes the view at 25 fps or more, reports timing only from 20 to 24 and asks to record again under 20", () => {
    const full = analyse({ view: "pad_side", nearSide: "right", durationSec: 20, seed: 71 });
    expect(full.quality.medianFps).toBe(30);
    expect(full.quality.timingOnly).toBe(false);
    expect(full.quality.gatePassed).toBe(true);
    expect(full.quality.issues).toEqual([]);
    // 22 frames a second
    const slow = analyse({ view: "pad_side", nearSide: "right", durationSec: 20, seed: 72, fps: 22 });
    expect(slow.quality.timingOnly).toBe(true);
    expect(slow.quality.gatePassed).toBe(true);
    expect(slow.quality.issues).toContain("low_fps");
    expect(slow.metrics.knee_swing_peak).toBeUndefined();
    expect(slow.metrics.cadence?.value).toBeCloseTo(108, 0);
    // 15 frames a second
    const tooSlow = analyse({ view: "pad_side", nearSide: "right", durationSec: 20, seed: 73, fps: 15 });
    expect(tooSlow.quality.gatePassed).toBe(false);
    expect(tooSlow.quality.timingOnly).toBe(false);
    expect(tooSlow.metrics).toEqual({});
  });
});

describe("gates", () => {
  it("needs 6 clean cycles on each side", () => {
    const short = analyse({ view: "pad_side", nearSide: "right", durationSec: 6, seed: 74 });
    expect(short.quality.cleanCycles.left).toBeLessThan(6);
    expect(short.quality.gatePassed).toBe(false);
    expect(short.quality.issues).toContain("too_few_cycles");
  });

  it("measures the share of analysed frames whose gate landmarks were filled", () => {
    // the near (right) foot index hidden 4 frames in every 15 (each gap under 0.12 s, so filled); a side
    // view reads the hips and the near leg (D-026 item 6), so the far foot's gaps would not count
    const w = walk({ view: "pad_side", nearSide: "right", durationSec: 20, seed: 75 });
    w.frames.forEach((f, i) => {
      if (i % 15 < 3) f.lm[32].visibility = 0.2;
    });
    const r = analyseGaitView({
      view: "pad_side",
      nearSide: "right",
      setup: setupOf({ view: "pad_side", speed: 1.2 }),
      standing: w.standing,
      frames: w.frames,
      poseModel: "full",
      rollDeg: 0,
    });
    expect(r.quality.gapShare).toBeCloseTo(0.2, 1);
    expect(r.quality.issues).toContain("gaps");
  });

  it("names the wrong view and a front view without its passes", () => {
    const sideAsFront = analyse({ view: "side", passes: 2, seed: 76 }, "front");
    expect(sideAsFront.quality.issues).toContain("wrong_view");
    expect(sideAsFront.quality.gatePassed).toBe(false);
    const frontAsSide = analyse({ view: "pad_front", durationSec: 10, seed: 77 }, "pad_side");
    expect(frontAsSide.quality.issues).toContain("wrong_view");
  });

  it("names a walk that is all turns, and the reasons for a failed gate", () => {
    const frames: GaitFrame[] = Array.from({ length: 120 }, (_, i) => ({
      t: (i * 1000) / 30,
      lm: Array.from({ length: 33 }, (): Landmark => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 })),
      aspect: 1,
    }));
    const p = prepare(frames, { rollDeg: null, labels: "none" });
    const excluded = new Uint8Array(p.series.n).fill(EXCLUDED.turn);
    const motion: Motion = {
      passes: [
        { start: 0, end: 120, d: 1, facing: "side", near: "right", turnAtStart: true, turnAtEnd: true },
      ],
      excluded,
      wrongViewShare: 0,
    };
    // The near (right) leg's cycles: a side view's far leg dropped for visibility is no reason.
    const dropped = (drop: Cycle["drop"]): Cycle => ({
      side: "right",
      icStart: 0,
      to: null,
      icEnd: 1000,
      clean: false,
      drop,
      pass: 0,
      k0: 0,
      kOppTo: null,
      kOppIc: null,
      kTo: null,
      k1: 30,
      times: { ic: 0, oppTo: null, oppIc: null, to: null, icEnd: 1 },
      near: true,
      trunkOk: false,
    });
    const q = viewQuality({
      p,
      motion,
      cycles: [dropped("visibility"), dropped("swap")],
      noViewPasses: false,
    });
    expect(q.issues).toEqual(["too_few_cycles", "visibility", "swap", "turns_only"]);
    expect(q.cleanCycles).toEqual({ left: 0, right: 0 });
    expect(q.gapShare).toBe(0);
    const far: Cycle = { ...dropped("visibility"), side: "left", near: false };
    expect(viewQuality({ p, motion, cycles: [far], noViewPasses: false }).issues).toEqual([
      "too_few_cycles",
      "turns_only",
    ]);
  });
});
