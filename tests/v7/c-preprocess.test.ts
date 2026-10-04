/**
 * src/engine/gait/preprocess.ts (product v7 contract 2.8; gait-rules 3.2): pixel space and the roll,
 * visibility, one 30 Hz grid from real frame times with gaps up to 0.12 s filled and longer ones
 * splitting the bout, the leg swap rule, the facing check, Hampel and the zero lag Butterworth.
 */
import { describe, expect, it } from "vitest";
import {
  LR_PAIRS,
  USED_LANDMARKS,
  faceVisible,
  orderedFrames,
  prepare,
  rollTurn,
  runs,
  visibleShare,
} from "../../src/engine/gait/preprocess";
import { downVector } from "../../src/engine/modes/common";
import type { GaitFrame } from "../../src/engine/gait/types";
import type { Landmark } from "../../src/engine/types";
import { walk } from "../fixtures/gait/gen-gait";

/** A frame with every landmark at (x, y) and the given visibility, then `set` applied. */
function frame(t: number, set: (lm: Landmark[]) => void = () => {}, aspect = 1, vis = 0.99): GaitFrame {
  const lm: Landmark[] = Array.from({ length: 33 }, (_, i) => ({
    x: 0.5,
    y: 0.2 + i * 0.02,
    z: 0,
    visibility: vis,
  }));
  set(lm);
  return { t, lm, aspect };
}

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(tol);

describe("pixel space and roll", () => {
  it("turns the picture so the phone roll's true down points along y", () => {
    for (const r of [-7, 0, 4.5, 12]) {
      const d = downVector(r);
      const [x, y] = rollTurn(r)(d.x, d.y);
      close(x, 0, 1e-12);
      close(y, 1, 1e-12);
    }
    expect(rollTurn(null)(0.3, 0.4)).toEqual([0.3, 0.4]);
  });

  it("scales x by the aspect (units of the picture height)", () => {
    const frames = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) =>
      frame(i * (1000 / 30), (lm) => (lm[27].x = 0.3), 16 / 9),
    );
    const p = prepare(frames, { rollDeg: null, labels: "none" });
    close(p.series.x[27][0], 0.3 * (16 / 9), 1e-9);
    expect(p.aspect).toBeCloseTo(16 / 9, 12);
  });
});

describe("timestamps, visibility and gaps", () => {
  it("drops frames whose time does not move forward", () => {
    const out = orderedFrames([frame(10), frame(5), frame(10), frame(20), frame(Number.NaN), frame(30)]);
    expect(out.map((f) => f.t)).toEqual([10, 20, 30]);
  });

  it("puts every landmark on one 30 Hz grid from jittery frame times, starting at the first frame", () => {
    const times = [1000, 1031, 1069, 1101, 1129, 1170, 1201, 1236, 1266, 1302, 1333, 1371, 1400, 1433];
    // The ankle is a straight line in time (so linear interpolation is exact); the heel is missing
    // in the first two frames (visibility 0.3).
    const frames = times.map((t, i) =>
      frame(t, (lm) => {
        lm[27].x = 0.1 + (t - 1000) / 10000;
        if (i < 2) lm[29].visibility = 0.3;
      }),
    );
    const p = prepare(frames, { rollDeg: null, labels: "none" });
    const s = p.series;
    expect(s.n).toBe(Math.floor(0.433 * 30) + 1);
    s.t.forEach((t, k) => close(t, 1 + k / 30, 1e-9));
    // filtering a straight line keeps it (Butterworth and Hampel leave a ramp alone, up to rounding)
    for (let k = 0; k < s.n; k++) close(s.x[27][k], 0.1 + (s.t[k] - 1) / 10, 1e-5);
    // the heel's first grid points are missing, on the same grid
    expect(Number.isNaN(s.x[29][0])).toBe(true);
  });

  it("treats a landmark under 0.5 as missing: a gap up to 0.12 s is filled, a longer one splits the bout", () => {
    const fps = 30;
    const mk = (gapFrom: number, gapLen: number) =>
      Array.from({ length: 90 }, (_, i) =>
        frame((i * 1000) / fps, (lm) => {
          if (i >= gapFrom && i < gapFrom + gapLen) lm[27].visibility = 0.4;
        }),
      );
    // 3 missing frames: the samples at 0.033 s on each side are 0.133 s apart... 2 missing frames span 0.1 s.
    const short = prepare(mk(40, 2), { rollDeg: null, labels: "none" }).series;
    expect(short.bouts).toEqual([[0, 90]]);
    const long = prepare(mk(40, 5), { rollDeg: null, labels: "none" }).series;
    expect(long.bouts.length).toBe(2);
    expect(long.bouts[0][1]).toBeLessThanOrEqual(41);
    expect(long.bouts[1][0]).toBeGreaterThanOrEqual(44);
  });
});

describe("outliers and smoothing", () => {
  it("removes a one frame spike (Hampel) before smoothing", () => {
    const frames = Array.from({ length: 60 }, (_, i) =>
      frame((i * 1000) / 30, (lm) => {
        lm[27].y = 0.8 + 0.01 * Math.sin(i / 5);
        if (i === 30) lm[27].y = 0.95;
      }),
    );
    const s = prepare(frames, { rollDeg: null, labels: "none" }).series;
    expect(Math.abs(s.y[27][30] - (0.8 + 0.01 * Math.sin(6)))).toBeLessThan(0.003);
  });

  it("keeps a 1 Hz movement in time and takes landmark noise out (5 Hz zero lag low pass)", () => {
    // Noise the size of the model's jitter (0.004 of the picture), seeded.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const truth = (k: number) => 0.5 + 0.05 * Math.sin((2 * Math.PI * k) / 30);
    const frames = Array.from({ length: 150 }, (_, i) =>
      frame((i * 1000) / 30, (lm) => (lm[27].x = truth(i) + 0.004 * rand())),
    );
    const s = prepare(frames, { rollDeg: null, labels: "none" }).series;
    let raw = 0;
    let out = 0;
    for (let k = 20; k < 130; k++) {
      raw += (frames[k].lm[27].x - truth(k)) ** 2;
      out += (s.x[27][k] - truth(k)) ** 2;
    }
    // A 5 Hz low pass at 30 frames a second keeps about a third of white noise's power.
    expect(Math.sqrt(out / 110)).toBeLessThan(0.65 * Math.sqrt(raw / 110));
    // zero lag: the peaks stay where they were (7.5 samples into each 30 sample period)
    let peak = 30;
    for (let k = 30; k < 60; k++) if (s.x[27][k] > s.x[27][peak]) peak = k;
    expect(Math.abs(peak - 37.5)).toBeLessThanOrEqual(1);
  });

  it("drops a run too short for filtfilt (it cannot hold a stride)", () => {
    const frames = Array.from({ length: 40 }, (_, i) =>
      frame((i * 1000) / 30, (lm) => {
        if (i >= 8) lm[27].visibility = 0.1;
      }),
    );
    const s = prepare(frames, { rollDeg: null, labels: "none" }).series;
    expect(s.x[27].every((v) => Number.isNaN(v))).toBe(true);
    expect(s.bouts).toEqual([]);
  });
});

describe("labels", () => {
  it("undoes a leg label swap while the legs are apart (both legs jump onto the other's path)", () => {
    const clean = walk({ view: "pad_side", nearSide: "right", durationSec: 8, seed: 11 });
    const swapped = walk({
      view: "pad_side",
      nearSide: "right",
      durationSec: 8,
      seed: 11,
      swaps: [{ from: 3.02, to: 3.3 }],
    });
    const a = prepare(clean.frames, { rollDeg: 0, labels: "swaps" }).series;
    const b = prepare(swapped.frames, { rollDeg: 0, labels: "swaps" }).series;
    let worst = 0;
    for (let k = 0; k < a.n; k++) worst = Math.max(worst, Math.abs(a.x[27][k] - b.x[27][k]));
    expect(worst).toBeLessThan(1e-9);
    expect(b.relabelled.some((v) => v === 1)).toBe(true);
    expect(a.relabelled.every((v) => v === 0)).toBe(true);
  });

  it("exchanges every left and right label that contradicts the facing (walking away labelled as facing)", () => {
    const right = walk({ view: "front", passes: 1, seed: 12 });
    const wrong = walk({ view: "front", passes: 1, seed: 12, awayLabelsAsToward: true });
    const a = prepare(right.frames, { rollDeg: 0, labels: "facing" }).series;
    const b = prepare(wrong.frames, { rollDeg: 0, labels: "facing" }).series;
    let compared = 0;
    for (const [from, to] of a.bouts)
      for (let k = from; k < to; k++)
        for (const [l] of LR_PAIRS)
          if (Number.isFinite(a.x[l][k]) && Number.isFinite(b.x[l][k])) {
            compared++;
            // Exact where the labels were exchanged; the filter carries a trace of the few samples
            // before a bout, where neither the hips nor the shoulders were seen to decide.
            expect(Math.abs(a.x[l][k] - b.x[l][k])).toBeLessThan(1e-3);
          }
    expect(compared).toBeGreaterThan(1000);
    expect(b.relabelled.some((v) => v === 1)).toBe(true);
  });

  it("reads a face as visible from the nose or an eye at 0.5", () => {
    expect(faceVisible(frame(0))).toBe(true);
    expect(faceVisible(frame(0, (lm) => [0, 2, 5].forEach((i) => (lm[i].visibility = 0.2))))).toBe(false);
    expect(faceVisible(frame(0, (lm) => [0, 5].forEach((i) => (lm[i].visibility = 0.2))))).toBe(true);
  });
});

describe("helpers", () => {
  it("lists half open runs", () => {
    expect(runs(8, (k) => k !== 2 && k !== 3 && k !== 7)).toEqual([
      [0, 2],
      [4, 7],
    ]);
  });

  it("gives the worst landmark's share of frames at the visibility floor", () => {
    const frames = Array.from({ length: 10 }, (_, i) =>
      frame(i * 100, (lm) => (lm[29].visibility = i < 3 ? 0.2 : 0.9)),
    );
    const p = prepare(frames, { rollDeg: null, labels: "none" });
    expect(visibleShare(p, [27, 29], 0, 900)).toBeCloseTo(0.7, 12);
    expect(visibleShare(p, [27], 0, 900)).toBe(1);
    expect(visibleShare(p, [29], 300, 900)).toBe(1);
  });

  it("reads the replay landmarks only", () => {
    expect(USED_LANDMARKS).toEqual([0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
  });
});
