/**
 * src/engine/gait/quality.ts (product v7 contract 2.8 GaitQuality; gait-rules 2.1 frame rate, 3.6
 * view gates): clean cycles per side, the median processed frame rate, the gap share, the gate,
 * timing only and the issues.
 */
import { describe, expect, it } from "vitest";
import { analyseGaitView } from "../../src/engine/gait/analyse";
import type { Cycle } from "../../src/engine/gait/cycles";
import { EXCLUDED, type Motion } from "../../src/engine/gait/passes";
import { prepare } from "../../src/engine/gait/preprocess";
import { medianFps, viewQuality } from "../../src/engine/gait/quality";
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
  it("is 1000 over the median gap between frames (the probe's measure, A6a-3)", () => {
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
    // the left foot index hidden 4 frames in every 15 (each gap under 0.12 s, so filled)
    const w = walk({ view: "pad_side", nearSide: "right", durationSec: 20, seed: 75 });
    w.frames.forEach((f, i) => {
      if (i % 15 < 3) f.lm[31].visibility = 0.2;
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
    const dropped = (drop: Cycle["drop"]): Cycle => ({
      side: "left",
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
      near: false,
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
  });
});
