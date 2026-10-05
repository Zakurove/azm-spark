/**
 * GaitRecorder and LiveStepCounter (product v7 contract 2.8; section 9: under 1 ms p95 a frame, the
 * recorder under 1 MB for a 40 s view).
 */
import { describe, expect, it } from "vitest";
import { LiveStepCounter } from "../../src/engine/gait/live";
import { GaitRecorder } from "../../src/engine/gait/recorder";
import type { GaitFrame } from "../../src/engine/gait/types";
import type { Landmark } from "../../src/engine/types";
import { walk } from "../fixtures/gait/gen-gait";

function frame(t: number, x = 0.25): GaitFrame {
  const lm: Landmark[] = Array.from({ length: 33 }, (_, i) => ({
    x: x + i / 100,
    y: i / 40,
    z: 0.3,
    visibility: 0.9,
  }));
  return { t, lm, aspect: 9 / 16 };
}

function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)];
}

describe("GaitRecorder", () => {
  it("gives the frames back in order, x, y and visibility kept (z is not kept)", () => {
    const rec = new GaitRecorder(10);
    for (let i = 0; i < 5; i++) rec.push(frame(1000 + i * 33, 0.1 * i));
    const out = rec.frames();
    expect(out.map((f) => f.t)).toEqual([1000, 1033, 1066, 1099, 1132]);
    expect(out[3].lm[7].x).toBeCloseTo(0.3 + 0.07, 6);
    expect(out[3].lm[7].y).toBeCloseTo(7 / 40, 6);
    expect(out[3].lm[7].visibility).toBeCloseTo(0.9, 6);
    expect(out[3].lm[7].z).toBe(0);
    expect(out[3].aspect).toBeCloseTo(9 / 16, 6);
    expect(rec.seconds).toBeCloseTo(0.132, 6);
  });

  it("keeps at most maxSec of frames, the oldest leaving first, and ignores a frame that does not move forward", () => {
    const rec = new GaitRecorder(2);
    for (let i = 0; i < 300; i++) rec.push(frame(i * 20));
    rec.push(frame(5000));
    const out = rec.frames();
    expect(out[out.length - 1].t).toBe(5980);
    expect(out[0].t).toBe(5980 - 2000);
    expect(rec.seconds).toBeCloseTo(2, 6);
    rec.reset();
    expect(rec.frames()).toEqual([]);
    expect(rec.seconds).toBe(0);
  });

  it("stays under 1 MB for a 40 s view at 30 and at 60 frames a second", () => {
    for (const fps of [30, 60]) {
      const rec = new GaitRecorder(40);
      for (let i = 0; i < 40 * fps + 30; i++) rec.push(frame((i * 1000) / fps));
      expect(rec.bytes, `${fps} fps`).toBeLessThan(1024 * 1024);
      expect(rec.frames().length).toBeGreaterThanOrEqual(40 * fps);
    }
  });

  it("pushes a frame in well under 1 ms (p95)", () => {
    const rec = new GaitRecorder(40);
    const times: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const f = frame((i * 1000) / 30);
      const t0 = performance.now();
      rec.push(f);
      times.push(performance.now() - t0);
    }
    expect(p95(times)).toBeLessThan(1);
  });
});

describe("LiveStepCounter", () => {
  it("counts the steps of a pad walk within two and one pass", () => {
    const w = walk({ view: "pad_side", nearSide: "right", durationSec: 20, seed: 91, noise: 0.002 });
    const live = new LiveStepCounter("pad_side");
    let last = { steps: 0, passes: 0, facing: null as string | null };
    const times: number[] = [];
    for (const f of w.frames) {
      const t0 = performance.now();
      last = live.feed(f);
      times.push(performance.now() - t0);
    }
    expect(Math.abs(last.steps - w.truth.ics.length)).toBeLessThanOrEqual(2);
    expect(last.passes).toBe(1);
    expect(last.facing).toBe("side");
    expect(p95(times)).toBeLessThan(1);
  });

  it("counts the passes of an overground side walk and of a front walk, toward and away", () => {
    const side = walk({ view: "side", passes: 4, seed: 92 });
    const a = new LiveStepCounter("side");
    let r = { steps: 0, passes: 0, facing: null as string | null };
    for (const f of side.frames) r = a.feed(f);
    expect(r.passes).toBe(4);
    expect(Math.abs(r.steps - side.truth.ics.length)).toBeLessThanOrEqual(4);

    const front = walk({ view: "front", passes: 2, seed: 93 });
    const b = new LiveStepCounter("front");
    const facings = new Set<string | null>();
    for (const f of front.frames) {
      r = b.feed(f);
      facings.add(r.facing);
    }
    expect(r.passes).toBe(4);
    expect(facings.has("toward")).toBe(true);
    expect(facings.has("away")).toBe(true);
    expect(facings.has(null)).toBe(true);
  });
});
