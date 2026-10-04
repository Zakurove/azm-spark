/**
 * Step G1 (product v7 contract section 9): the browser side of the measures
 * (src/features/smoke/perfProbe.ts), with fake hooks: one set of hooks for the page however many
 * meters read it (the overlay and the smoke page), undone when the last meter lets go.
 */
import { describe, expect, it } from "vitest";
import { PerfMeter } from "../../src/features/smoke/perf";
import { attachMeter, type ProbeEnv } from "../../src/features/smoke/perfProbe";

class FakeModel {
  detectForVideo(_frame: unknown, t: number): { t: number } {
    return { t };
  }
}

function fakeEnv() {
  let now = 0;
  let frame: ((t: number) => void) | null = null;
  let observer:
    ((e: { entryType: string; name: string; duration: number; startTime: number }[]) => void) | null = null;
  let tick: (() => void) | null = null;
  const env: ProbeEnv = {
    poseProto: FakeModel.prototype,
    now: () => now,
    requestFrame: (cb) => {
      frame = cb;
      return 1;
    },
    cancelFrame: () => {
      frame = null;
    },
    observe: (cb) => {
      observer = cb;
      return () => {
        observer = null;
      };
    },
    every: (_ms, cb) => {
      tick = cb;
      return () => {
        tick = null;
      };
    },
    heapMB: () => 40 + now / 1000,
  };
  return {
    env,
    advance: (ms: number) => (now += ms),
    frame: () => frame?.(now),
    observe: (e: { entryType: string; name: string; duration: number; startTime: number }[]) => observer?.(e),
    tick: () => tick?.(),
    get running() {
      return { frame: frame !== null, observer: observer !== null, tick: tick !== null };
    },
  };
}

describe("attachMeter", () => {
  it("feeds every attached meter from one set of hooks", () => {
    const f = fakeEnv();
    const a = new PerfMeter(100);
    const b = new PerfMeter(100);
    const releaseA = attachMeter(a, f.env);
    const releaseB = attachMeter(b, f.env);
    const model = new FakeModel();
    for (let i = 0; i < 10; i++) {
      f.advance(33);
      model.detectForVideo(null, i);
      f.frame();
    }
    f.observe([
      { entryType: "longtask", name: "self", duration: 80, startTime: 10 },
      { entryType: "measure", name: "azm:rom_feed", duration: 1.2, startTime: 20 },
      { entryType: "measure", name: "other", duration: 9, startTime: 30 },
    ]);
    f.tick();
    for (const m of [a, b]) {
      const s = m.snapshot();
      expect(s.modelMs.n).toBe(10);
      expect(s.frameMs.p50).toBe(33);
      expect(s.longTasks).toEqual({ count: 1, maxMs: 80 });
      // Only the azm measures are kept.
      expect(Object.keys(s.measures)).toEqual(["azm:rom_feed"]);
      expect(s.heapMB).toBeCloseTo(40.33, 9);
    }
    releaseA();
    model.detectForVideo(null, 11);
    expect(a.snapshot().modelMs.n).toBe(10);
    expect(b.snapshot().modelMs.n).toBe(11);
    expect(f.running).toEqual({ frame: true, observer: true, tick: true });
    releaseB();
    expect(f.running).toEqual({ frame: false, observer: false, tick: false });
    // The model's own method is back.
    expect(Object.getOwnPropertyDescriptor(FakeModel.prototype, "detectForVideo")?.value.name).toBe(
      "detectForVideo",
    );
    // A release twice is harmless, and the hooks start again for a new meter.
    releaseB();
    const c = new PerfMeter(100);
    const releaseC = attachMeter(c, f.env);
    model.detectForVideo(null, 12);
    expect(c.snapshot().modelMs.n).toBe(1);
    releaseC();
  });

  it("works without a pose model to time", () => {
    const f = fakeEnv();
    const m = new PerfMeter(100);
    const release = attachMeter(m, { ...f.env, poseProto: null });
    f.advance(16);
    f.frame();
    f.advance(16);
    f.frame();
    expect(m.snapshot()).toMatchObject({ poseFps: null, frameMs: { n: 1, p50: 16 } });
    release();
  });
});
