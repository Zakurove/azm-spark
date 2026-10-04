/**
 * Step G1 (product v7 contract 8.4 and 2.8): the smoke page's gait capture
 * (src/features/smoke/gaitCapture.ts): the subject's frames of the video's standing and walk windows
 * as the gait engine takes them (GaitFrame), and the harness's own cadence check of the tracking (the
 * ankle gap's period), which is not the engine's cadence.
 */
import { describe, expect, it } from "vitest";
import { GaitCapture, harnessCadence, trackingShare } from "../../src/features/smoke/gaitCapture";
import type { Frame, Landmark } from "../../src/engine/types";

const FPS = 30;

/** A side view walker: hips still, the ankles swinging in antiphase with a stride of `strideS`. */
function walker(t: number, strideS: number, opts: { lostAnkles?: boolean } = {}): Landmark[] {
  const p: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  const set = (i: number, x: number, y: number, vis = 0.99) => (p[i] = { x, y, z: 0, visibility: vis });
  set(0, 0.52, 0.18);
  set(11, 0.5, 0.3);
  set(12, 0.5, 0.3);
  set(23, 0.5, 0.52);
  set(24, 0.5, 0.52);
  const swing = strideS > 0 ? 0.08 * Math.sin((2 * Math.PI * t) / strideS) : 0;
  set(25, 0.5 + swing / 2, 0.68);
  set(26, 0.5 - swing / 2, 0.68);
  const vis = opts.lostAnkles ? 0.1 : 0.95;
  for (const [i, s] of [
    [27, 1],
    [29, 1],
    [31, 1],
    [28, -1],
    [30, -1],
    [32, -1],
  ] as const)
    set(i, 0.5 + s * swing, 0.84 + (i >= 31 ? 0.01 : 0), vis);
  return p;
}

function video(seconds: number, strideS: (t: number) => number, opts?: { lostAnkles?: boolean }): Frame[] {
  return Array.from({ length: Math.round(seconds * FPS) }, (_, i) => {
    const t = i / FPS;
    const lm = walker(t, strideS(t), opts);
    return { t: 1000 + t * 1000, lm, poses: [lm], aspect: 16 / 9 };
  });
}

describe("GaitCapture", () => {
  const windows = { standFrom: 0.5, standTo: 3.5, walkFrom: 5, walkTo: 20 };

  it("keeps the subject's frames of the standing and walk windows, timed from the first frame", () => {
    const cap = new GaitCapture(windows);
    const phases: string[] = [];
    for (const f of video(22, (t) => (t < 4 ? 0 : 1.2))) {
      const ph = cap.push(f);
      if (phases[phases.length - 1] !== ph) phases.push(ph);
    }
    expect(phases).toEqual(["waiting", "standing", "between", "walking", "done"]);
    const standing = cap.standing();
    const walk = cap.walk();
    expect(standing.length).toBe(90);
    expect(walk.length).toBe(450);
    // Real timestamps (ms) and the picture's aspect, as GaitFrame has them.
    expect(walk[0].t).toBeCloseTo(1000 + 5000, 0);
    expect(walk[0].aspect).toBeCloseTo(16 / 9, 9);
    expect(walk[0].lm).toHaveLength(33);
    // Frames up to the end of the walk window.
    expect(cap.stats()).toMatchObject({
      frames: 600,
      subjectFrames: 600,
      standingFrames: 90,
      walkFrames: 450,
      walkFps: 30,
    });
  });

  it("is done once the walk window has passed, and ignores frames after it", () => {
    const cap = new GaitCapture(windows);
    for (const f of video(25, () => 1.2)) cap.push(f);
    expect(cap.phase).toBe("done");
    expect(cap.walk().length).toBe(450);
  });
});

describe("harnessCadence", () => {
  it("finds the stride from the ankle gap's period in a side view", () => {
    for (const stride of [0.9, 1.2, 1.6]) {
      const frames = video(20, () => stride).map((f) => ({ t: f.t, lm: f.lm, aspect: f.aspect! }));
      const c = harnessCadence(frames, "pad_side");
      expect(c.signal).toBe("ankle_x");
      expect(c.strideS!).toBeCloseTo(stride, 1);
      expect(Math.abs(c.cadenceSpm! - 120 / stride) / (120 / stride)).toBeLessThan(0.02);
      expect(c.strength!).toBeGreaterThan(0.8);
    }
  });

  it("reads the ankles at any visibility: the far ankle hides behind the near leg once a stride", () => {
    // Positions only: the model still places a hidden ankle, and a side view hides the far one in
    // every stride, which would cut the signal into pieces shorter than a stride.
    const hidden = video(20, () => 1.2, { lostAnkles: true }).map((f) => ({
      t: f.t,
      lm: f.lm,
      aspect: f.aspect!,
    }));
    expect(harnessCadence(hidden, "side").strideS!).toBeCloseTo(1.2, 1);
  });

  it("finds nothing in a still person or ankles that are not numbers", () => {
    const still = video(10, () => 0).map((f) => ({ t: f.t, lm: f.lm, aspect: f.aspect! }));
    expect(harnessCadence(still, "pad_side").cadenceSpm).toBeNull();
    const lost = video(10, () => 1.2).map((f) => ({
      t: f.t,
      aspect: f.aspect!,
      lm: f.lm.map((p, i) => (i === 27 ? { ...p, x: Number.NaN } : p)),
    }));
    expect(harnessCadence(lost, "side").cadenceSpm).toBeNull();
  });

  it("reads the share of frames with both ankles, heels and toes seen", () => {
    const seen = video(4, () => 1.2).map((f) => ({ t: f.t, lm: f.lm, aspect: f.aspect! }));
    expect(trackingShare(seen)).toEqual({ ankles: 1, heels: 1, toes: 1 });
    const lost = video(4, () => 1.2, { lostAnkles: true }).map((f) => ({
      t: f.t,
      lm: f.lm,
      aspect: f.aspect!,
    }));
    expect(trackingShare(lost)).toEqual({ ankles: 0, heels: 0, toes: 0 });
    expect(trackingShare([])).toEqual({ ankles: null, heels: null, toes: null });
  });
});
