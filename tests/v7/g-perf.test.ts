/**
 * Step G1 (product v7 contract section 9): the measures behind the performance overlay and the smoke
 * page (src/features/smoke/perf.ts): quantiles, the median frame rate, the meter and the method timer
 * that reads the pose model's time per frame without a hook in another stream's file (A6a-5).
 */
import { describe, expect, it, vi } from "vitest";
import {
  PerfMeter,
  RecentValues,
  meanFps,
  medianFps,
  quantile,
  spread,
  timeMethod,
} from "../../src/features/smoke/perf";
import { BUDGETS } from "../../src/features/smoke/budgets";
import { PROBE_FLOOR_FPS } from "../../src/features/focus/camera";
import gait from "../../src/movements/gait/gait-v7.json";

describe("quantile and spread", () => {
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);

  it("interpolates between the closest ranks", () => {
    expect(quantile(hundred, 0.5)).toBeCloseTo(50.5, 9);
    expect(quantile(hundred, 0.95)).toBeCloseTo(95.05, 9);
    expect(quantile([7], 0.95)).toBe(7);
    expect(quantile([], 0.5)).toBeNull();
    // Order does not matter, and the input is left alone.
    const shuffled = [5, 1, 4, 2, 3];
    expect(quantile(shuffled, 0.5)).toBe(3);
    expect(shuffled).toEqual([5, 1, 4, 2, 3]);
  });

  it("gives the count, the median, the 95th percentile and the largest", () => {
    expect(spread(hundred)).toEqual({ n: 100, p50: 50.5, p95: 95.05, max: 100 });
    expect(spread([])).toEqual({ n: 0, p50: null, p95: null, max: null });
    // Values that are not finite numbers are left out.
    expect(spread([1, Number.NaN, 3, Infinity]).n).toBe(2);
  });
});

describe("medianFps", () => {
  it("is 1000 over the median gap between frames, as the attempt gate and the probe compute it", () => {
    const times = Array.from({ length: 31 }, (_, i) => i * (1000 / 30));
    expect(medianFps(times)).toBe(30);
    // One late frame does not move the median.
    expect(medianFps([0, 40, 80, 300, 340, 380])).toBe(25);
    expect(medianFps([5])).toBeNull();
    expect(medianFps([5, 5, 5])).toBeNull();
  });
});

describe("meanFps (D-026 item 6: frame rate floors use the mean over the window)", () => {
  it("is the frames over the window's span, so dropped frames count", () => {
    const times = Array.from({ length: 31 }, (_, i) => i * (1000 / 30));
    expect(meanFps(times)).toBe(30);
    // A model that handles 3 of every 4 camera frames at 30 fps: gaps 33, 33, 67 ms.
    const lossy = Array.from({ length: 120 }, (_, i) => i * (1000 / 30)).filter((_, i) => i % 4 !== 3);
    expect(medianFps(lossy)).toBe(30);
    expect(meanFps(lossy)).toBeCloseTo(22.5, 0);
    expect(meanFps([5])).toBeNull();
    expect(meanFps([5, 5])).toBeNull();
  });

  it("is the perf overlay's pose rate, as the probe and the gait gate read it", () => {
    const m = new PerfMeter(1000);
    for (let i = 0; i < 120; i++) if (i % 4 !== 3) m.model(i * (1000 / 30), i * (1000 / 30) + 12);
    expect(m.snapshot().poseFps).toBeCloseTo(22.5, 0);
  });
});

describe("RecentValues", () => {
  it("keeps the last values pushed, oldest first", () => {
    const w = new RecentValues(3);
    for (const v of [1, 2, 3, 4, 5]) w.push(v);
    expect(w.values()).toEqual([3, 4, 5]);
    expect(w.size).toBe(3);
    w.clear();
    expect(w.values()).toEqual([]);
  });
});

describe("PerfMeter", () => {
  it("reads the pose rate and model time from the model calls, the frame time from the display", () => {
    const m = new PerfMeter(1000);
    for (let i = 0; i < 60; i++) m.model(i * 33.3, i * 33.3 + 12);
    for (let i = 0; i < 120; i++) m.frame(i * 16.7);
    // Two long tasks after the model calls ended.
    m.longTask(70, 3000);
    m.longTask(120, 4000);
    m.measure("azm:rom_feed", 1.5);
    m.measure("azm:rom_feed", 0.5);
    m.heap(50);
    m.heap(62);
    const s = m.snapshot();
    expect(s.poseFps).toBe(30);
    expect(s.modelMs).toMatchObject({ n: 60, p50: 12, max: 12 });
    expect(s.frameMs.p50).toBeCloseTo(16.7, 9);
    // The model's own calls fill none of these two tasks: both count beyond the model.
    expect(s.longTasks).toEqual({ count: 2, maxMs: 120, beyondModel: { count: 2, maxMs: 120 } });
    expect(s.measures["azm:rom_feed"]).toMatchObject({ n: 2, max: 1.5 });
    expect(s.heapMB).toBe(62);
    expect(s.heapGrowthMB).toBe(12);
    m.reset();
    expect(m.snapshot()).toMatchObject({
      poseFps: null,
      modelMs: { n: 0 },
      longTasks: { count: 0, maxMs: null },
    });
  });

  it("counts the time of a long task outside the model's calls (section 9: none over 50 ms besides the model call)", () => {
    const m = new PerfMeter(100);
    // Loading the model (before its first frame) is not capture: counted, never beyond the model.
    m.longTask(700, 100);
    m.model(1000, 1040);
    // 60 ms, 40 of them in the model call: 20 ms beyond.
    m.longTask(60, 990);
    // 130 ms with 40 ms of model call: 90 ms beyond.
    m.model(2000, 2040);
    m.longTask(130, 1950);
    // 120 ms and no model call.
    m.longTask(120, 5000);
    expect(m.snapshot().longTasks).toEqual({ count: 4, maxMs: 700, beyondModel: { count: 2, maxMs: 120 } });
  });

  it("keeps the delegate of the last model that loaded", () => {
    const m = new PerfMeter(100);
    expect(m.snapshot().delegate).toBeNull();
    m.delegate("GPU", false, "WebGL context lost");
    m.delegate("CPU", true);
    expect(m.snapshot().delegate).toBe("CPU");
    // Why the GPU did not load stays with the snapshot.
    expect(m.snapshot().delegateError).toBe("GPU: WebGL context lost");
    m.delegate("GPU", true);
    expect(m.snapshot().delegate).toBe("GPU");
  });

  it("keeps only its window of recent samples", () => {
    const m = new PerfMeter(10);
    for (let i = 0; i < 50; i++) m.model(i * 40, i * 40 + i);
    expect(m.snapshot().modelMs).toMatchObject({ n: 10, max: 49 });
  });
});

describe("timeMethod", () => {
  class Model {
    calls = 0;
    detect(x: number): number {
      this.calls++;
      if (x < 0) throw new Error("bad frame");
      return x * 2;
    }
  }

  it("times every call of a prototype method, keeping this, the value and the errors", () => {
    let now = 0;
    const seen: [number, number][] = [];
    const undo = timeMethod(
      Model.prototype,
      "detect",
      (a, b) => seen.push([a, b]),
      () => (now += 5),
    );
    const m = new Model();
    expect(m.detect(4)).toBe(8);
    expect(() => m.detect(-1)).toThrow("bad frame");
    expect(m.calls).toBe(2);
    expect(seen).toEqual([
      [5, 10],
      [15, 20],
    ]);
    undo();
    m.detect(1);
    expect(seen).toHaveLength(2);
  });

  it("wraps a method once, however many measures ask", () => {
    const a = vi.fn();
    const b = vi.fn();
    const undoA = timeMethod(Model.prototype, "detect", a);
    const undoB = timeMethod(Model.prototype, "detect", b);
    new Model().detect(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    undoA();
    new Model().detect(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    undoB();
    // Fully undone: the prototype has its own method again.
    expect(Object.getOwnPropertyDescriptor(Model.prototype, "detect")?.value.name).toBe("detect");
  });
});

describe("BUDGETS", () => {
  it("reads the frame rate floors where the app reads them, and section 9 for the rest", () => {
    expect(BUDGETS.romFps).toBe(PROBE_FLOOR_FPS.rom);
    expect(BUDGETS.gaitFps).toBe(gait.capture.common.processedFps.full);
    expect(BUDGETS.gaitTimingOnlyFps).toBe(gait.capture.common.processedFps.timingOnly);
    expect(BUDGETS).toMatchObject({
      romFeedMsP95: 2,
      gaitPushMsP95: 1,
      analyseMsP95: 200,
      longTaskMs: 50,
      overlayMsP95: 4,
    });
  });
});
