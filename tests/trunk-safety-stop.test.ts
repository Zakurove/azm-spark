/**
 * S0 (council decisions 2026-09-28): the workout trunk safety stop of the seated shoulder press and
 * the seated biceps curl.
 *   (a) 15 degrees or more away from the person's own calibrated posture, either direction;
 *   (b) absolute from vertical: press 25 degrees either way; curl 25 forward and 30 backward, the
 *       forward direction from the side of the mid shoulder the nose is on at calibration;
 *   whichever is reached first stops the set, and a calibrated posture at or beyond (b) blocks the
 *   set start with the cue sit_upright_first.
 *
 * Every pose is built in PIXELS on a real frame size (portrait 9:16, landscape 16:9, square) with a
 * known true trunk angle, then normalized the way MediaPipe does it, with the frame's aspect set.
 * The firing points must be the true angles written by the council in every orientation.
 */
import { describe, expect, it } from "vitest";
import voiceScript from "../src/app/voice-script.json";
import { Calibrator } from "../src/engine/calibration";
import { computeMetrics } from "../src/engine/geometry";
import { PoseSmoother } from "../src/engine/oneEuro";
import { profileById } from "../src/engine/profiles";
import { RepEngine, WORKOUT_ENGINE_VERSION } from "../src/engine/repEngine";
import {
  forwardSign,
  NOSE_SIDE_MIN,
  presetBlock,
  PRESET_BLOCK_ID,
  trunkStopFor,
  trunkStopLimits,
} from "../src/engine/trunkSafety";
import { TRACES } from "../src/engine/traces";
import { EngineEvent, ExerciseDef, Frame, Landmark, LM, PRF } from "../src/engine/types";
import { exerciseById } from "../src/exercises/defs";

const DEG = Math.PI / 180;
const PRESS = exerciseById("seated_shoulder_press");
const CURL = exerciseById("seated_biceps_curl");
const WHEELCHAIR = profileById("wheelchair");
const HEMI_LEFT = profileById("hemiparesis_left");

const SIZES = [
  { name: "portrait 720x1280", w: 720, h: 1280 },
  { name: "landscape 1280x720", w: 1280, h: 720 },
  { name: "square 720x720", w: 720, h: 720 },
] as const;

type P = { x: number; y: number };
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
/** rotate a direction by `deg` (image coordinates, y down: positive turns clockwise on screen) */
const rot = (v: P, deg: number): P => ({
  x: v.x * Math.cos(deg * DEG) - v.y * Math.sin(deg * DEG),
  y: v.x * Math.sin(deg * DEG) + v.y * Math.cos(deg * DEG),
});

interface PoseSpec {
  /** true trunk angle from vertical, degrees, positive = shoulders toward the image right */
  lean: number;
  /** true interior elbow angle of both arms */
  elbow: number;
  /** "front" for the press; "side" for the curl, facing the image right (+1) or left (-1) */
  view: "front" | "side";
  facing?: 1 | -1;
  /** side view: nose placed on the trunk line (the face side cannot be read) */
  noseOnLine?: boolean;
}

/** A seated figure in pixel space, normalized like MediaPipe with the frame's aspect set. */
function frame(w: number, h: number, s: PoseSpec, t = 0): Frame {
  const u = Math.min(w, h) * 0.22;
  const hipMid: P = { x: w / 2, y: h / 2 + 0.5 * u };
  const axisUp = rot({ x: 0, y: -1 }, s.lean); // hip → shoulder direction
  const shMid = add(hipMid, scale(axisUp, u));
  const half = s.view === "front" ? 0.4 * u : 0.03 * u;
  const lSh = add(shMid, { x: -half, y: 0 });
  const rSh = add(shMid, { x: half, y: 0 });
  const lHip = add(hipMid, { x: -half * 0.75, y: 0 });
  const rHip = add(hipMid, { x: half * 0.75, y: 0 });
  const head = add(shMid, scale(axisUp, 0.45 * u));
  const facing = s.facing ?? 1;
  const nose = s.view === "side" && !s.noseOnLine ? add(head, { x: facing * 0.25 * u, y: 0 }) : head;
  // Upper arm hangs 30 degrees off vertical (outward in a front view, forward in a side view);
  // the forearm turns by (180 - elbow) toward the midline or up in front.
  const arm = (side: -1 | 1, sh: P) => {
    const out = s.view === "front" ? side : facing;
    const ud = rot({ x: 0, y: 1 }, -out * 30);
    const e = add(sh, scale(ud, 0.55 * u));
    const wr = add(e, scale(rot(ud, -out * (180 - s.elbow)), 0.5 * u));
    return { e, wr };
  };
  const L = arm(-1, lSh);
  const R = arm(1, rSh);
  const pts = new Map<number, P>([
    [LM.nose, nose],
    [LM.l_shoulder, lSh],
    [LM.r_shoulder, rSh],
    [LM.l_elbow, L.e],
    [LM.r_elbow, R.e],
    [LM.l_wrist, L.wr],
    [LM.r_wrist, R.wr],
    [LM.l_hip, lHip],
    [LM.r_hip, rHip],
  ]);
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const [i, p] of pts) lm[i] = { x: p.x / w, y: p.y / h, z: 0, visibility: 0.95 };
  return { t, lm, aspect: w / h };
}

const metrics = (def: ExerciseDef, f: Frame) => computeMetrics(f, def.metrics, []);

/** Calibrates like the app: guided reps at the person's usual posture. */
function calibrate(def: ExerciseDef, w: number, h: number, s: Omit<PoseSpec, "elbow">): PRF {
  const [lo, hi] = def.defaultRange;
  const cal = new Calibrator(def);
  for (let i = 0; i < 180; i++) {
    const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 60);
    cal.feed(metrics(def, frame(w, h, { ...s, elbow: lo + (hi - lo) * k }, i * 33)));
  }
  return cal.build(0);
}

/** A PRF with a given calibrated posture, built from real calibration frames. */
function prfAt(def: ExerciseDef, w: number, h: number, lean: number, facing: 1 | -1 = 1): PRF {
  return calibrate(def, w, h, { lean, view: def === PRESS ? "front" : "side", facing });
}

/**
 * The true angle at which the stop fires when the trunk moves from the calibrated posture toward
 * `dir`, sweeping in 0.1 degree steps with the arms at mid range. Null when nothing fires by 60.
 */
function firesAt(def: ExerciseDef, prf: PRF, w: number, h: number, dir: 1 | -1, facing: 1 | -1 = 1) {
  const engine = new RepEngine(def, prf, WHEELCHAIR);
  const base = prf.baselines.trunk_lean!;
  const mid = (def.defaultRange[0] + def.defaultRange[1]) / 2;
  for (let i = 0; i <= 600; i++) {
    const lean = base + dir * i * 0.1;
    const ev = engine.step(
      metrics(def, frame(w, h, { lean, elbow: mid, view: def === PRESS ? "front" : "side", facing }, i * 33)),
    );
    const stop = ev.find((e) => e.kind === "stop") as Extract<EngineEvent, { kind: "stop" }> | undefined;
    if (stop) return { lean, ruleId: stop.ruleId, events: ev };
  }
  return null;
}

describe("S0 definitions", () => {
  it("replaces the absolute 25 degree rules with the relative stop and the caps", () => {
    expect(PRESS.trunkSafety).toEqual({
      relativeDeg: 15,
      cap: { view: "front", eitherDeg: 25 },
      cue: "stop_rest",
      presetCue: "sit_upright_first",
    });
    expect(CURL.trunkSafety).toEqual({
      relativeDeg: 15,
      cap: { view: "side", forwardDeg: 25, backwardDeg: 30 },
      cue: "stop_rest",
      presetCue: "sit_upright_first",
    });
    for (const def of [PRESS, CURL]) {
      expect(def.rules.some((r) => r.severity === "safety")).toBe(false);
      expect(def.rules.some((r) => r.absolute)).toBe(false);
    }
    expect(CURL.metrics).toContain("nose_offset");
    expect(exerciseById("sit_to_stand").trunkSafety).toBeUndefined();
  });

  it("keeps every coaching delta", () => {
    const deltas = (def: ExerciseDef) => Object.fromEntries(def.rules.map((r) => [r.id, r.delta]));
    expect(deltas(PRESS)).toEqual({
      trunk_lean: 8,
      trunk_lean_neg: -8,
      shoulder_hike: 0.06,
      shoulder_hike_neg: -0.06,
      arm_asym: 18,
    });
    expect(deltas(CURL)).toEqual({ trunk_swing: 7, trunk_swing_neg: -7, arm_asym: 20 });
    expect(deltas(exerciseById("sit_to_stand"))).toEqual({ lean_excess: 14, lean_excess_neg: -14 });
  });

  it("bumps the workout engine version", () => {
    expect(WORKOUT_ENGINE_VERSION).toBe("workout_engine_2");
  });

  it("has the council's pre-set block cue in Arabic and English", () => {
    expect(voiceScript.sit_upright_first).toEqual({
      ar: "اجلس مستقيمًا قدر ما تستطيع براحة، ثم نبدأ.",
      en: "Sit as upright as you comfortably can, then we will start.",
      arTts: "اِجْلِسْ مُسْتَقِيمًا قَدْرَ مَا تَسْتَطِيعُ بِرَاحَةْ، ثُمَّ نَبْدَأْ.",
    });
  });
});

describe("calibration keeps the posture and the face side", () => {
  for (const { name, w, h } of SIZES) {
    it(`${name}: the calibrated posture is the true angle`, () => {
      for (const lean of [0, 5, 15, -12]) {
        const prf = prfAt(PRESS, w, h, lean);
        expect(Math.abs(prf.baselines.trunk_lean! - lean)).toBeLessThan(0.5);
      }
      for (const facing of [1, -1] as const) {
        const prf = prfAt(CURL, w, h, 20 * facing, facing);
        expect(Math.abs(prf.baselines.trunk_lean! - 20 * facing)).toBeLessThan(0.5);
        expect(forwardSign(prf.baselines.nose_offset)).toBe(facing);
      }
    });
  }

  it("does not trust a nose on the mid shoulder line", () => {
    expect(forwardSign(undefined)).toBe(0);
    expect(forwardSign(Number.NaN)).toBe(0);
    expect(forwardSign(NOSE_SIDE_MIN / 2)).toBe(0);
    expect(forwardSign(-NOSE_SIDE_MIN)).toBe(-1);
    expect(forwardSign(NOSE_SIDE_MIN)).toBe(1);
  });
});

describe("seated shoulder press: 15 degrees from the posture, 25 either way", () => {
  // [calibrated true lean, fires toward +, fires toward -]
  const CASES: [number, number, number][] = [
    [0, 15, -15], // upright
    [5, 20, -10], // a habitual 5 degree lean
    [15, 25, 0], // calibrated at 15: the cap acts first on that side
    [20, 25, 5],
    [-10, 5, -25],
  ];
  for (const { name, w, h } of SIZES) {
    for (const [base, up, down] of CASES) {
      it(`${name}: calibrated at ${base} stops at ${up} and ${down}`, () => {
        const prf = prfAt(PRESS, w, h, base);
        expect(presetBlock(PRESS, prf)).toBeNull();
        const a = firesAt(PRESS, prf, w, h, 1)!;
        const b = firesAt(PRESS, prf, w, h, -1)!;
        expect(Math.abs(a.lean - up)).toBeLessThan(0.35);
        expect(Math.abs(b.lean - down)).toBeLessThan(0.35);
        expect(a.ruleId).toBe(up === 25 ? "trunk_safety_cap" : "trunk_safety");
        expect(b.ruleId).toBe(down === -25 ? "trunk_safety_cap" : "trunk_safety");
      });
    }
  }

  it("a habitual lean after a stroke hears the sit tall cue before the stop", () => {
    const [w, h] = [720, 1280];
    const prf = prfAt(PRESS, w, h, 10); // leans 10 degrees toward the weaker side at rest
    const engine = new RepEngine(PRESS, prf, HEMI_LEFT);
    const events: EngineEvent[] = [];
    let t = 0;
    const feed = (lean: number, elbow: number) =>
      events.push(...engine.step(metrics(PRESS, frame(w, h, { lean, elbow, view: "front" }, (t += 33)))));
    feed(10, 97); // arms racked: the engine arms
    for (let e = 97; e <= 150; e += 2) feed(10, e); // into a rep
    for (let lean = 10; lean <= 30; lean += 0.2) feed(lean, 150);
    const warn = events.find((e) => e.kind === "flag" && e.ruleId === "trunk_lean") as
      Extract<EngineEvent, { kind: "flag" }> | undefined;
    const stop = events.find((e) => e.kind === "stop") as Extract<EngineEvent, { kind: "stop" }>;
    expect(warn).toBeDefined();
    expect(warn!.value).toBeGreaterThan(18);
    expect(warn!.value).toBeLessThan(18.5);
    expect(stop.ruleId).toBe("trunk_safety_cap");
    expect(warn!.t).toBeLessThan(stop.t);
    const stopFlag = events.find((e) => e.kind === "flag" && e.severity === "safety") as Extract<
      EngineEvent,
      { kind: "flag" }
    >;
    expect(stopFlag.cue).toBe("stop_rest");
    expect(stopFlag.value).toBeGreaterThanOrEqual(25);
    expect(stopFlag.value).toBeLessThan(25.3);
  });
});

describe("seated biceps curl: 15 degrees from the posture, 25 forward, 30 backward", () => {
  // [calibrated lean in forward terms, fires forward at, fires backward at] (backward is negative)
  const CASES: [number, number, number][] = [
    [0, 15, -15], // upright
    [20, 25, 5], // calibrated 20 forward: forward cap 25
    [-20, -5, -30], // calibrated 20 backward (a recline): backward cap 30
    [-5, 10, -20], // a slight recline
    [10, 25, -5],
  ];
  for (const { name, w, h } of SIZES) {
    for (const facing of [1, -1] as const) {
      for (const [base, fwd, back] of CASES) {
        it(`${name}, facing ${facing > 0 ? "right" : "left"}: calibrated at ${base} stops at ${fwd} and ${back}`, () => {
          const prf = prfAt(CURL, w, h, base * facing, facing);
          expect(presetBlock(CURL, prf)).toBeNull();
          expect(trunkStopLimits(CURL, prf)!.forward).toBe(facing);
          const f = firesAt(CURL, prf, w, h, facing, facing)!;
          const b = firesAt(CURL, prf, w, h, -facing as 1 | -1, facing)!;
          expect(Math.abs(f.lean * facing - fwd)).toBeLessThan(0.35);
          expect(Math.abs(b.lean * facing - back)).toBeLessThan(0.35);
          expect(f.ruleId).toBe(fwd === 25 ? "trunk_safety_cap" : "trunk_safety");
          expect(b.ruleId).toBe(back === -30 ? "trunk_safety_cap" : "trunk_safety");
        });
      }
    }
  }

  it("a usual recline does not stop the set; 25 degrees backward would have", () => {
    const prf = prfAt(CURL, 720, 1280, -26, 1); // reclined 26 degrees in a tilt in space wheelchair
    expect(presetBlock(CURL, prf)).toBeNull();
    const lim = trunkStopLimits(CURL, prf)!;
    expect(lim.capLo).toBe(-30);
    expect(trunkStopFor(lim, -28)).toBeNull();
    expect(trunkStopFor(lim, -30)).toBe("trunk_safety_cap");
    expect(Math.abs(lim.base + 26)).toBeLessThan(0.5);
    expect(trunkStopFor(lim, lim.base + 14.9)).toBeNull();
    expect(trunkStopFor(lim, lim.base + 15)).toBe("trunk_safety");
  });

  it("with the face side unknown, the forward cap applies both ways", () => {
    const prf = calibrate(CURL, 720, 1280, { lean: 0, view: "side", noseOnLine: true });
    const lim = trunkStopLimits(CURL, prf)!;
    expect(lim.forward).toBe(0);
    expect([lim.capLo, lim.capHi]).toEqual([-25, 25]);
    const tilted = calibrate(CURL, 720, 1280, { lean: -27, view: "side", noseOnLine: true });
    expect(presetBlock(CURL, tilted)).toBe("sit_upright_first");
  });
});

describe("the pre-set block", () => {
  for (const { name, w, h } of SIZES) {
    it(`${name}: press calibrated at or beyond 25 either way does not start`, () => {
      expect(presetBlock(PRESS, prfAt(PRESS, w, h, 24.5))).toBeNull();
      expect(presetBlock(PRESS, prfAt(PRESS, w, h, 25.2))).toBe("sit_upright_first");
      expect(presetBlock(PRESS, prfAt(PRESS, w, h, -26))).toBe("sit_upright_first");
    });

    it(`${name}: curl calibrated 25 forward or 30 backward does not start`, () => {
      for (const facing of [1, -1] as const) {
        expect(presetBlock(CURL, prfAt(CURL, w, h, 24.5 * facing, facing))).toBeNull();
        expect(presetBlock(CURL, prfAt(CURL, w, h, 25.2 * facing, facing))).toBe("sit_upright_first");
        expect(presetBlock(CURL, prfAt(CURL, w, h, -29.5 * facing, facing))).toBeNull();
        expect(presetBlock(CURL, prfAt(CURL, w, h, -30.2 * facing, facing))).toBe("sit_upright_first");
      }
    });
  }

  it("uses exactly the limit: at the cap counts as beyond it", () => {
    const at = (def: ExerciseDef, lean: number, nose = 0.3): PRF => ({
      exerciseId: def.id,
      range: [...def.defaultRange] as [number, number],
      baselines: { trunk_lean: lean, nose_offset: nose },
      capturedAt: 0,
    });
    expect(presetBlock(PRESS, at(PRESS, 25))).toBe("sit_upright_first");
    expect(presetBlock(PRESS, at(PRESS, -25))).toBe("sit_upright_first");
    expect(presetBlock(CURL, at(CURL, 25))).toBe("sit_upright_first");
    expect(presetBlock(CURL, at(CURL, -30))).toBe("sit_upright_first");
    expect(presetBlock(CURL, at(CURL, -29.99))).toBeNull();
    expect(presetBlock(CURL, at(CURL, 30, -0.3))).toBe("sit_upright_first");
    expect(presetBlock(CURL, at(CURL, -25, -0.3))).toBe("sit_upright_first");
    expect(presetBlock(exerciseById("sit_to_stand"), at(exerciseById("sit_to_stand"), 40))).toBeNull();
  });

  it("a blocked engine counts nothing and only repeats the cue", () => {
    const prf = prfAt(PRESS, 720, 1280, 26);
    const engine = new RepEngine(PRESS, prf, WHEELCHAIR);
    expect(engine.blocked).toBe("sit_upright_first");
    const events: EngineEvent[] = [];
    for (let i = 0; i < 300; i++) {
      const elbow = 95 + 70 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 60));
      events.push(
        ...engine.step(metrics(PRESS, frame(720, 1280, { lean: 26, elbow, view: "front" }, i * 33))),
      );
    }
    expect(events.every((e) => e.kind === "flag" && e.ruleId === PRESET_BLOCK_ID)).toBe(true);
    expect(events).toHaveLength(3); // about 10 s: once every 4 s
    expect(engine.repCount).toBe(0);
  });
});

describe("the stop ends the set", () => {
  it("counts nothing after the stop and drops the rep in progress", () => {
    const [w, h] = [1280, 720];
    const prf = prfAt(PRESS, w, h, 0);
    const engine = new RepEngine(PRESS, prf, WHEELCHAIR);
    const events: EngineEvent[] = [];
    let t = 0;
    const feed = (lean: number, elbow: number) =>
      events.push(...engine.step(metrics(PRESS, frame(w, h, { lean, elbow, view: "front" }, (t += 33)))));
    for (let i = 0; i < 120; i++) feed(0, 95 + 70 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 60)));
    expect(engine.repCount).toBe(2);
    feed(0, 150);
    feed(16, 150); // a sudden 16 degree lean mid rep
    expect(engine.stoppedBy).toBe("trunk_safety");
    const after = events.length;
    for (let i = 0; i < 120; i++) feed(0, 95 + 70 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 60)));
    expect(events.length).toBe(after);
    expect(engine.repCount).toBe(2);
    const stop = events.filter((e) => e.kind === "stop");
    expect(stop).toHaveLength(1);
  });
});

describe("the demo traces run like the workout screen", () => {
  // Session.tsx: smoothing, calibration until ready, the pre-set block check, then the engine.
  for (const [id, opts] of [
    ["seated_shoulder_press", { leanDeg: 12, leanFromRep: 4 }],
    ["seated_biceps_curl", {}],
    ["sit_to_stand", {}],
  ] as const) {
    it(`${id}: calibrates, is not blocked, counts reps and never stops`, () => {
      const def = exerciseById(id);
      const frames = TRACES[id]({ reps: 14, ...opts });
      const smoother = new PoseSmoother();
      let cal: Calibrator | null = new Calibrator(def);
      let engine: RepEngine | null = null;
      const events: EngineEvent[] = [];
      for (const f of frames) {
        const mf = computeMetrics(smoother.smoothFrame(f), def.metrics, []);
        if (engine) {
          events.push(...engine.step(mf));
          continue;
        }
        cal!.feed(mf);
        if (cal!.ready(f.t, 150)) {
          const prf = cal!.build(0);
          expect(presetBlock(def, prf)).toBeNull();
          engine = new RepEngine(def, prf, WHEELCHAIR);
          cal = null;
        }
      }
      expect(engine).not.toBeNull();
      expect(events.some((e) => e.kind === "stop")).toBe(false);
      expect(engine!.repCount).toBeGreaterThanOrEqual(5);
    });
  }
});
