/**
 * Booth v2, contract section A (items 1 to 4 and 8): the wrist height metric, the press on it, the
 * start position gate, the rep based calibration (adapt down, extend up) and the summary measure.
 * The end to end synthetic traces of item 9 are in tests/engine-v2-traces.test.ts.
 */
import { describe, expect, it } from "vitest";
import { Calibrator } from "../src/engine/calibration";
import { computeMetrics } from "../src/engine/geometry";
import { PoseSmoother } from "../src/engine/oneEuro";
import { profileById } from "../src/engine/profiles";
import { RepEngine, WORKOUT_ENGINE_VERSION } from "../src/engine/repEngine";
import { inStartPosition, START_HOLD_MS, StartGate } from "../src/engine/startPosition";
import { seatedCurlTrace, seatedPressTrace, sitToStandTrace } from "../src/engine/traces";
import { EngineEvent, Frame, Landmark, LM, MetricFrame, PRF } from "../src/engine/types";
import { exerciseById } from "../src/exercises/defs";

const PRESS = exerciseById("seated_shoulder_press");
const CURL = exerciseById("seated_biceps_curl");
const STAND = exerciseById("sit_to_stand");
const WHEELCHAIR = profileById("wheelchair");

/** A pose with the shoulders, hips and wrists placed in a square frame (normalized = pixel). */
function pose(o: { lWristY?: number; rWristY?: number; lVis?: number; rVis?: number }): Frame {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const put = (i: number, x: number, y: number, v = 0.95) => (lm[i] = { x, y, z: 0, visibility: v });
  put(LM.l_shoulder, 0.4, 0.4);
  put(LM.r_shoulder, 0.6, 0.4);
  put(LM.l_hip, 0.42, 0.6);
  put(LM.r_hip, 0.58, 0.6);
  put(LM.l_elbow, 0.35, 0.45);
  put(LM.r_elbow, 0.65, 0.45);
  put(LM.l_wrist, 0.35, o.lWristY ?? 0.4, o.lVis ?? 0.95);
  put(LM.r_wrist, 0.65, o.rWristY ?? 0.4, o.rVis ?? 0.95);
  return { t: 0, lm };
}

const wh = (f: Frame) => computeMetrics(f, ["wrist_height"], []).values.wrist_height;

/** Smoothed metric frames of a trace, as the workout screen computes them. */
function metricFrames(def: typeof PRESS, frames: Frame[]): MetricFrame[] {
  const smoother = new PoseSmoother();
  return frames.map((f) => computeMetrics(smoother.smoothFrame(f), def.metrics, []));
}

describe("A1 wrist_height", () => {
  it("is shoulder y minus wrist y over the trunk length, positive above the shoulder", () => {
    // trunk length 0.2: a wrist 0.1 above the shoulder is +0.5, 0.2 below is minus 1
    expect(wh(pose({ lWristY: 0.3, rWristY: 0.3 }))).toBeCloseTo(0.5, 6);
    expect(wh(pose({ lWristY: 0.6, rWristY: 0.6 }))).toBeCloseTo(-1, 6);
    expect(wh(pose({ lWristY: 0.4, rWristY: 0.4 }))).toBeCloseTo(0, 6);
  });

  it("averages the visible arms and skips an arm whose wrist is not seen", () => {
    expect(wh(pose({ lWristY: 0.3, rWristY: 0.5 }))).toBeCloseTo(0, 6);
    expect(wh(pose({ lWristY: 0.3, rWristY: 0.5, rVis: 0.2 }))).toBeCloseTo(0.5, 6);
    expect(wh(pose({ lVis: 0.1, rVis: 0.1 }))).toBeUndefined();
  });

  it("is measured in pixel space (D-003): the same body reads the same in portrait and landscape", () => {
    for (const [w, h] of [
      [720, 1280],
      [1280, 720],
    ]) {
      const px = (x: number, y: number) => ({ x: x / w, y: y / h, z: 0, visibility: 0.95 });
      const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
      // trunk 200 px, leaning so x matters; wrists 100 px above the shoulders
      lm[LM.l_shoulder] = px(300, 300);
      lm[LM.r_shoulder] = px(400, 300);
      lm[LM.l_hip] = px(330, 495);
      lm[LM.r_hip] = px(430, 495);
      lm[LM.l_wrist] = px(280, 200);
      lm[LM.r_wrist] = px(420, 200);
      const v = computeMetrics({ t: 0, lm, aspect: w / h }, ["wrist_height"], []).values.wrist_height!;
      expect(v).toBeCloseTo(100 / Math.hypot(30, 195), 3);
    }
  });

  it("the press counts on wrist height; the elbow angles stay for display", () => {
    expect(PRESS.primaryMetric).toBe("wrist_height");
    for (const m of ["elbow_flex_mean", "elbow_flex_l", "elbow_flex_r"] as const)
      expect(PRESS.metrics).toContain(m);
    expect(PRESS.measure).toEqual({ kind: "elbow_extension", metric: "elbow_flex_mean" });
    expect(CURL.measure).toEqual({ kind: "elbow_flexion", metric: "elbow_flex_mean" });
    expect(STAND.measure).toEqual({ kind: "hip_rise", metric: "hip_height" });
  });

  it("resting arms read at the bottom and never at the top of the press", () => {
    const mfs = metricFrames(PRESS, seatedPressTrace({ reps: 0, restSec: 3, leadInSec: 0 }));
    const resting = mfs.slice(30, 80).map((m) => m.values.wrist_height!);
    const [lo, hi] = PRESS.defaultRange;
    for (const v of resting) expect((v - lo) / (hi - lo)).toBeLessThan(0);
  });

  it("the default range spans the racked press to arms overhead", () => {
    const mfs = metricFrames(PRESS, seatedPressTrace({ reps: 3 }));
    const values = mfs.map((m) => m.values.wrist_height!);
    const [lo, hi] = PRESS.defaultRange;
    expect(Math.min(...values)).toBeGreaterThan(lo - 0.15);
    expect(Math.min(...values)).toBeLessThan(lo + 0.15);
    expect(Math.max(...values)).toBeGreaterThan(hi - 0.1);
  });

  it("bumps the workout engine version", () => {
    expect(WORKOUT_ENGINE_VERSION).toBe("workout_engine_3");
  });
});

describe("A2 start position", () => {
  const at = (mfs: MetricFrame[], sec: number) => mfs[Math.round(sec * 30)];

  it("press: wrists near shoulder height with the elbows bent; resting arms and straight arms are not", () => {
    const mfs = metricFrames(PRESS, seatedPressTrace({ reps: 1, restSec: 3, leadInSec: 2 }));
    expect(inStartPosition(PRESS, at(mfs, 1.5))).toBe(false); // resting down
    expect(inStartPosition(PRESS, at(mfs, 5))).toBe(true); // racked
    const overhead = metricFrames(PRESS, seatedPressTrace({ reps: 1, leadInSec: 0 }));
    expect(inStartPosition(PRESS, overhead[Math.round(1.2 * 30)])).toBe(false); // top of the press
  });

  it("curl: arm hanging with a fairly straight elbow, side view", () => {
    const mfs = metricFrames(CURL, seatedCurlTrace({ reps: 1, leadInSec: 1 }));
    expect(inStartPosition(CURL, mfs[20])).toBe(true);
    expect(inStartPosition(CURL, mfs[Math.round((1 + 1.1) * 30)])).toBe(false); // curled
    // the same arm seen square on is not the curl's start
    const front = metricFrames(CURL, seatedPressTrace({ reps: 0, restSec: 2, leadInSec: 0 }));
    expect(inStartPosition(CURL, front[20])).toBe(false);
  });

  it("sit to stand: seated", () => {
    const mfs = metricFrames(STAND, sitToStandTrace({ reps: 1, leadInSec: 1 }));
    expect(inStartPosition(STAND, mfs[20])).toBe(true);
    expect(inStartPosition(STAND, mfs[Math.round((1 + 1.6) * 30)])).toBe(false); // standing
  });

  it("the gate opens after the start position has held for 1 s, and a break starts it again", () => {
    expect(START_HOLD_MS).toBe(1000);
    const mfs = metricFrames(PRESS, seatedPressTrace({ reps: 0, restSec: 2, leadInSec: 3 }));
    const gate = new StartGate(PRESS);
    let openedAt = -1;
    for (const mf of mfs) {
      gate.feed(mf);
      if (gate.ready && openedAt < 0) openedAt = mf.t;
    }
    // resting until 2 s, raised by 3 s: in position from about 2.6 s, open about 1 s later
    expect(openedAt).toBeGreaterThan(3300);
    expect(openedAt).toBeLessThan(4000);
    expect(gate.startValue!).toBeGreaterThan(0.1);
    expect(gate.startValue!).toBeLessThan(0.4);
    const broken = new StartGate(PRESS);
    const rack = mfs[mfs.length - 1];
    const rest = mfs[10];
    for (let i = 0; i < 25; i++) broken.feed({ ...rack, t: i * 33 });
    for (let i = 25; i < 40; i++) broken.feed({ ...rest, t: i * 33 });
    for (let i = 40; i < 60; i++) broken.feed({ ...rack, t: i * 33 });
    expect(broken.ready).toBe(false);
    for (let i = 60; i < 75; i++) broken.feed({ ...rack, t: i * 33 });
    expect(broken.ready).toBe(true);
  });
});

/** Feeds the calibrator from the start position onward, as the workout flow does. */
function calibrateOn(def: typeof PRESS, frames: Frame[], reps = 2) {
  const mfs = metricFrames(def, frames);
  const gate = new StartGate(def);
  let cal: Calibrator | null = null;
  let readyAt = -1;
  for (const mf of mfs) {
    if (!cal) {
      gate.feed(mf);
      if (gate.ready) cal = new Calibrator(def, { reps, startValue: gate.startValue });
      continue;
    }
    cal.feed(mf);
    if (cal.ready() && readyAt < 0) {
      readyAt = mf.t;
      break;
    }
  }
  return { cal: cal!, readyAt, prf: cal!.build(0) };
}

describe("A3 rep based calibration", () => {
  it("the first 2 comfortable reps set the range: median bottom and median peak", () => {
    const { prf, readyAt, cal } = calibrateOn(PRESS, seatedPressTrace({ reps: 6 }));
    expect(cal.reps).toBe(2);
    // lead in 1.2 s; the start hold ends about 1 s in, so reps start right after
    expect(readyAt).toBeGreaterThan(1200 + 2 * 2400 * 0.6);
    expect(readyAt).toBeLessThan(1200 + 2 * 2400 + 1200);
    expect(prf.range[0]).toBeGreaterThan(0.15);
    expect(prf.range[0]).toBeLessThan(0.35);
    expect(prf.range[1]).toBeGreaterThan(1.05);
    expect(prf.range[1]).toBeLessThan(1.2);
  });

  it("a limited range sets a limited top", () => {
    const { prf } = calibrateOn(PRESS, seatedPressTrace({ reps: 6, effort: 0.4 }));
    expect(prf.range[1]).toBeGreaterThan(0.55);
    expect(prf.range[1]).toBeLessThan(0.8);
  });

  it("keeps the range at least the excursion floor, and builds the default without a rep", () => {
    const empty = new Calibrator(PRESS);
    expect(empty.ready()).toBe(false);
    expect(empty.build(0).range).toEqual(PRESS.defaultRange);
    const span = (r: [number, number]) => Math.abs(r[1] - r[0]);
    const { prf } = calibrateOn(PRESS, seatedPressTrace({ reps: 6, effort: 0.16 }));
    expect(span(prf.range)).toBeGreaterThanOrEqual(0.15 * span(PRESS.defaultRange) - 1e-9);
  });

  it("orients an inverted range (curl: the elbow angle falls toward the top)", () => {
    const { prf, cal } = calibrateOn(CURL, seatedCurlTrace({ reps: 6 }));
    expect(cal.reps).toBe(2);
    expect(prf.range[0]).toBeGreaterThan(prf.range[1]);
    expect(prf.range[0]).toBeGreaterThan(150);
    expect(prf.range[1]).toBeLessThan(75);
  });

  it("sit to stand calibrates on two stands", () => {
    const { prf, cal } = calibrateOn(STAND, sitToStandTrace({ reps: 5 }));
    expect(cal.reps).toBe(2);
    expect(prf.range[0]).toBeLessThan(1.25);
    expect(prf.range[1]).toBeGreaterThan(1.6);
  });

  it("does not take the lap as the bottom when the hands drop between calibration reps", () => {
    // racked start, then each calibration rep ends with the hands resting down
    const frames = seatedPressTrace({ reps: 6, effort: 0.5 });
    const rest = seatedPressTrace({ reps: 0, restSec: 2, leadInSec: 0 })[20];
    const mixed = frames.map((f, i) => (i > 75 && i < 90 ? { ...rest, t: f.t } : f));
    const { prf } = calibrateOn(PRESS, mixed);
    expect(prf.range[0]).toBeGreaterThan(0.05);
  });
});

/** Runs the engine on a trace after calibrating on its first reps; the events of the whole set. */
function trainOn(def: typeof PRESS, calFrames: Frame[], frames: Frame[]) {
  const { prf } = calibrateOn(def, calFrames);
  const engine = new RepEngine(def, prf, WHEELCHAIR);
  const events: EngineEvent[] = [];
  for (const mf of metricFrames(def, frames)) events.push(...engine.step(mf));
  const reps = events.filter((e) => e.kind === "rep") as Extract<EngineEvent, { kind: "rep" }>[];
  const ranges = events.filter((e) => e.kind === "range") as Extract<EngineEvent, { kind: "range" }>[];
  return { prf, engine, events, reps, ranges };
}

describe("A3 counting on the personal range", () => {
  it("counts at about 80% of the range and resets at about 30%", () => {
    const prf: PRF = { exerciseId: PRESS.id, range: [0, 1], baselines: {}, capturedAt: 0 };
    const engine = new RepEngine(PRESS, prf, WHEELCHAIR);
    const ev: EngineEvent[] = [];
    let t = 0;
    const go = (v: number) => {
      t += 50;
      ev.push(...engine.step({ t, values: { wrist_height: v }, usable: [], framingOk: true }));
    };
    const rep = (peak: number, low = 0.05) => {
      for (let v = low; v <= peak; v += 0.02) go(v);
      for (let v = peak; v >= low; v -= 0.02) go(v);
    };
    rep(0.78);
    expect(engine.repCount).toBe(0);
    rep(0.82);
    expect(engine.repCount).toBe(1);
    // a rep that goes back down only to 35% has not reset
    for (let v = 0.05; v <= 0.9; v += 0.02) go(v);
    for (let v = 0.9; v >= 0.35; v -= 0.02) go(v);
    for (let v = 0.35; v <= 0.9; v += 0.02) go(v);
    expect(engine.repCount).toBe(1);
    for (let v = 0.9; v >= 0.25; v -= 0.02) go(v);
    expect(engine.repCount).toBe(2);
  });

  it("adapts down after 3 consistent shorter reps, then counts them", () => {
    const full = seatedPressTrace({ reps: 3 });
    const shorter = seatedPressTrace({ reps: 9, effort: 0.62 });
    const { reps, ranges, prf, engine } = trainOn(PRESS, full, shorter);
    expect(reps.slice(0, 3).map((r) => r.cls)).toEqual(["partial", "partial", "partial"]);
    // one adapt down; the reps after it may then nudge the new top up (extend up)
    expect(ranges.filter((r) => r.reason === "adapt_down")).toHaveLength(1);
    expect(ranges[0].reason).toBe("adapt_down");
    expect(ranges[0].range[1]).toBeLessThan(prf.range[1]);
    expect(reps.slice(3).every((r) => r.cls !== "partial")).toBe(true);
    expect(engine.repCount).toBeGreaterThanOrEqual(5);
  });

  it("does not adapt down to reps that are inconsistent or below 55%", () => {
    const full = seatedPressTrace({ reps: 3 });
    const mixed = seatedPressTrace({ reps: 6, efforts: [0.62, 0.45, 0.66, 0.4, 0.6, 0.47] });
    expect(trainOn(PRESS, full, mixed).ranges).toHaveLength(0);
    const low = seatedPressTrace({ reps: 6, effort: 0.42 });
    expect(trainOn(PRESS, full, low).ranges).toHaveLength(0);
  });

  it("keeps the adapted range at least 15% of the default range", () => {
    const prf: PRF = { exerciseId: PRESS.id, range: [0.2, 0.36], baselines: {}, capturedAt: 0 };
    const engine = new RepEngine(PRESS, prf, WHEELCHAIR);
    let t = 0;
    const go = (v: number) => {
      t += 50;
      return engine.step({ t, values: { wrist_height: v }, usable: [], framingOk: true });
    };
    const ev: EngineEvent[] = [];
    for (let r = 0; r < 3; r++) {
      for (let v = 0.2; v <= 0.3; v += 0.005) ev.push(...go(v));
      for (let v = 0.3; v >= 0.2; v -= 0.005) ev.push(...go(v));
    }
    const span = Math.abs(PRESS.defaultRange[1] - PRESS.defaultRange[0]);
    expect(engine.range[1] - engine.range[0]).toBeGreaterThanOrEqual(0.15 * span - 1e-9);
  });

  it("extends the top up when a rep goes beyond it", () => {
    const limited = seatedPressTrace({ reps: 3, effort: 0.5 });
    const fuller = seatedPressTrace({ reps: 4, efforts: [0.5, 0.8, 0.5, 0.8] });
    const { ranges, prf, reps } = trainOn(PRESS, limited, fuller);
    expect(ranges.length).toBeGreaterThanOrEqual(1);
    expect(ranges.every((r) => r.reason === "extend_up")).toBe(true);
    expect(ranges[0].range[1]).toBeGreaterThan(prf.range[1] + 0.1);
    expect(reps[1].cls).not.toBe("partial");
  });
});

describe("A4 summary measure", () => {
  it("press: elbow extension in degrees over the counted reps, and the steady reps", () => {
    const { engine } = trainOn(PRESS, seatedPressTrace({ reps: 3 }), seatedPressTrace({ reps: 5 }));
    const m = engine.measure()!;
    expect(m.kind).toBe("elbow_extension");
    expect(Number.isInteger(m.bottomDeg) && Number.isInteger(m.topDeg)).toBe(true);
    expect(m.bottomDeg).toBeLessThan(80);
    expect(m.topDeg).toBeGreaterThan(160);
    expect(m.rangeDeg).toBe(m.topDeg - m.bottomDeg);
    expect(engine.steadyReps).toBeGreaterThanOrEqual(4);
  });

  it("a limited press measures a smaller range", () => {
    const full = trainOn(PRESS, seatedPressTrace({ reps: 3 }), seatedPressTrace({ reps: 5 })).engine;
    const limited = trainOn(
      PRESS,
      seatedPressTrace({ reps: 3, effort: 0.45 }),
      seatedPressTrace({ reps: 5, effort: 0.45 }),
    ).engine;
    expect(limited.measure()!.rangeDeg).toBeLessThan(full.measure()!.rangeDeg - 20);
  });

  it("curl: elbow flexion from the hanging arm to the curled arm", () => {
    const { engine } = trainOn(CURL, seatedCurlTrace({ reps: 3 }), seatedCurlTrace({ reps: 5 }));
    const m = engine.measure()!;
    expect(m.kind).toBe("elbow_flexion");
    expect(m.bottomDeg).toBeGreaterThan(150);
    expect(m.topDeg).toBeLessThan(75);
    expect(m.rangeDeg).toBe(m.bottomDeg - m.topDeg);
  });

  it("sit to stand: hip rise as ratio values", () => {
    const { engine } = trainOn(STAND, sitToStandTrace({ reps: 3 }), sitToStandTrace({ reps: 4 }));
    const m = engine.measure()!;
    expect(m.kind).toBe("hip_rise");
    expect(m.bottomDeg).toBeGreaterThan(0.9);
    expect(m.topDeg).toBeGreaterThan(1.6);
    expect(Math.round(m.bottomDeg * 100)).toBeCloseTo(m.bottomDeg * 100, 9);
    expect(m.rangeDeg).toBeCloseTo(m.topDeg - m.bottomDeg, 6);
  });

  it("has no measure without a counted rep", () => {
    const prf: PRF = { exerciseId: PRESS.id, range: [0.2, 1.1], baselines: {}, capturedAt: 0 };
    expect(new RepEngine(PRESS, prf, WHEELCHAIR).measure()).toBeUndefined();
  });
});
