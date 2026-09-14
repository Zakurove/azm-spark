import { describe, expect, it } from "vitest";
import { Calibrator } from "../src/engine/calibration";
import { computeMetrics } from "../src/engine/geometry";
import { PoseSmoother } from "../src/engine/oneEuro";
import { profileById } from "../src/engine/profiles";
import { RepEngine } from "../src/engine/repEngine";
import { EngineEvent, Frame, LM, Landmark, PRF } from "../src/engine/types";
import { exerciseById, variantForProfile } from "../src/exercises/defs";

/**
 * VERIFICATION HARNESS (temporary): physically realistic curl traces.
 * A person at distance Z0 facing the camera ("Face the camera" per defs.ts),
 * performing a true sagittal-plane curl. Landmarks are the true pinhole
 * projection + uniform noise matching the repo's own synthetic noise level.
 * "side" mode instead rotates the forearm in the image plane (side view).
 */
function lm(x: number, y: number, visibility = 0.95): Landmark {
  return { x, y, z: 0, visibility };
}
function blank(): Landmark[] {
  return Array.from({ length: 33 }, () => lm(0, 0, 0));
}

interface RealOpts {
  reps?: number;
  fps?: number;
  repSec?: number;
  thetaTop?: number; // true interior elbow angle at top of curl (deg)
  view?: "front" | "side";
  Z0?: number; // camera distance m
  noiseAmp?: number; // uniform +/- amp/2, matches repo's 0.004
}

function realisticCurlTrace(o: RealOpts = {}): Frame[] {
  const { reps = 8, fps = 30, repSec = 2.2, thetaTop = 55, view = "front", Z0 = 1.5, noiseAmp = 0.004 } = o;
  const leadInSec = 1.2;
  const frames: Frame[] = [];
  const total = Math.round((leadInSec + reps * repSec + 1) * fps);
  const tanH = Math.tan((60 / 2) * Math.PI) / 180 > 0 ? Math.tan((30 * Math.PI) / 180) : 0.577;
  const proj = (X: number, Y: number, Z: number) => ({ x: 0.5 + X / Z / (2 * tanH), y: 0.5 + Y / Z / (2 * tanH) });
  // body geometry (m), Y down, camera at chest height
  const upperArm = 0.3, forearm = 0.26, shoulderHalf = 0.18, hipHalf = 0.14;
  const shoulderYm = -0.15, hipYm = 0.25;

  for (let f = 0; f < total; f++) {
    const t = (f / fps) * 1000;
    const sec = f / fps;
    const repPhase = sec < leadInSec ? 0 : ((sec - leadInSec) / repSec) % 1;
    const repIdx = sec < leadInSec ? -1 : Math.floor((sec - leadInSec) / repSec);
    const tri = repIdx < 0 || repIdx >= reps ? 0 : repPhase < 0.5 ? repPhase * 2 : (1 - repPhase) * 2;
    const theta = 170 - (170 - thetaTop) * tri; // true interior elbow angle
    const phi = ((180 - theta) * Math.PI) / 180; // forearm from straight-down

    const noise = () => (Math.random() - 0.5) * noiseAmp;
    const L = blank();
    const P = (X: number, Y: number, Z: number, vis = 0.95) => {
      const p = proj(X, Y, Z);
      return lm(p.x + noise(), p.y + noise(), vis);
    };
    L[LM.nose] = P(0, shoulderYm - 0.2, Z0);
    L[LM.l_eye] = P(-0.03, shoulderYm - 0.23, Z0);
    L[LM.r_eye] = P(0.03, shoulderYm - 0.23, Z0);
    L[LM.l_ear] = P(-0.06, shoulderYm - 0.21, Z0);
    L[LM.r_ear] = P(0.06, shoulderYm - 0.21, Z0);
    L[LM.l_shoulder] = P(-shoulderHalf, shoulderYm, Z0);
    L[LM.r_shoulder] = P(shoulderHalf, shoulderYm, Z0);
    L[LM.l_hip] = P(-hipHalf, hipYm, Z0, 0.85);
    L[LM.r_hip] = P(hipHalf, hipYm, Z0, 0.85);
    L[LM.l_knee] = P(-hipHalf, hipYm + 0.15, Z0 - 0.35, 0.3);
    L[LM.r_knee] = P(hipHalf, hipYm + 0.15, Z0 - 0.35, 0.3);
    L[LM.l_ankle] = P(-hipHalf, hipYm + 0.5, Z0 - 0.3, 0.2);
    L[LM.r_ankle] = P(hipHalf, hipYm + 0.5, Z0 - 0.3, 0.2);

    for (const side of [-1, 1] as const) {
      const sX = side * shoulderHalf;
      const eX = sX, eY = shoulderYm + upperArm, eZ = Z0;
      let wX: number, wY: number, wZ: number;
      if (view === "front") {
        // sagittal-plane curl: forearm rotates toward the camera
        wX = eX;
        wY = eY + forearm * Math.cos(phi);
        wZ = eZ - forearm * Math.sin(phi);
      } else {
        // side view equivalent: rotation happens in the image plane
        wX = eX + side * forearm * Math.sin(phi);
        wY = eY + forearm * Math.cos(phi);
        wZ = eZ;
      }
      const eIdx = side === -1 ? LM.l_elbow : LM.r_elbow;
      const wIdx = side === -1 ? LM.l_wrist : LM.r_wrist;
      L[eIdx] = P(eX, eY, eZ);
      L[wIdx] = P(wX, wY, wZ);
    }
    frames.push({ t, lm: L });
  }
  return frames;
}

function runPipeline(exId: string, profileId: string, frames: Frame[], opts: { calibrateWith?: Frame[] } = {}) {
  const def = exerciseById(exId);
  const profile = profileById(profileId);
  const variant = variantForProfile(def, profileId);
  const smoother = new PoseSmoother();

  const calFrames = opts.calibrateWith ?? frames;
  const cal = new Calibrator(def);
  const calSmoother = new PoseSmoother();
  for (const f of calFrames) {
    const sm = { ...f, lm: calSmoother.smooth(f.lm, f.t) };
    cal.feed(computeMetrics(sm, def.metrics, variant.requiredLandmarks));
  }
  const calReady = cal.ready(calFrames[calFrames.length - 1].t);
  const prf: PRF = cal.build(0);

  const engine = new RepEngine(def, prf, profile);
  const events: EngineEvent[] = [];
  for (const f of frames) {
    const sm = { ...f, lm: smoother.smooth(f.lm, f.t) };
    const mf = computeMetrics(sm, def.metrics, variant.requiredLandmarks);
    events.push(...engine.step(mf));
  }
  const reps = events.filter((e) => e.kind === "rep") as Extract<EngineEvent, { kind: "rep" }>[];
  return { prf, reps, calReady, engine };
}

describe("VERIFY: frontal-view realism for seated_biceps_curl", () => {
  it("A: full-range frontal curls — what does the pipeline see?", () => {
    const frames = realisticCurlTrace({ reps: 8, view: "front" });
    const { reps, prf, calReady } = runPipeline("seated_biceps_curl", "wheelchair", frames);
    console.log("A frontal full-range: calReady=", calReady, "prfRange=", prf.range.map((x) => x.toFixed(1)),
      "reps=", reps.length, "classes=", reps.map((r) => r.cls).join(","));
    expect(true).toBe(true);
  });

  it("B: partial curls to true 90° (70% of true ROM), frontal, calibrated full-range", () => {
    const clean = realisticCurlTrace({ reps: 3, view: "front" });
    const partial = realisticCurlTrace({ reps: 6, thetaTop: 90, view: "front" });
    const { reps } = runPipeline("seated_biceps_curl", "wheelchair", partial, { calibrateWith: clean });
    console.log("B frontal partial(90°): reps=", reps.length, "classes=", reps.map((r) => r.cls).join(","));
    expect(true).toBe(true);
  });

  it("B2: same partial curls, side view — for comparison", () => {
    const clean = realisticCurlTrace({ reps: 3, view: "side" });
    const partial = realisticCurlTrace({ reps: 6, thetaTop: 90, view: "side" });
    const { reps } = runPipeline("seated_biceps_curl", "wheelchair", partial, { calibrateWith: clean });
    console.log("B2 side partial(90°): reps=", reps.length, "classes=", reps.map((r) => r.cls).join(","));
    expect(true).toBe(true);
  });

  it("C: limited-ROM user (true max 110°) — can they even calibrate, frontal vs side?", () => {
    const front = realisticCurlTrace({ reps: 8, thetaTop: 110, view: "front" });
    const side = realisticCurlTrace({ reps: 8, thetaTop: 110, view: "side" });
    const f = runPipeline("seated_biceps_curl", "wheelchair", front);
    const s = runPipeline("seated_biceps_curl", "wheelchair", side);
    console.log("C limited ROM 110°: frontal calReady=", f.calReady, "range=", f.prf.range.map((x) => x.toFixed(1)),
      "reps=", f.reps.length, "| side calReady=", s.calReady, "range=", s.prf.range.map((x) => x.toFixed(1)), "reps=", s.reps.length);
    expect(true).toBe(true);
  });

  it("D: metric信息 content — projected angle at true angles, frontal, through repo smoothing", () => {
    // sample the smoothed metric at known true angles
    const frames = realisticCurlTrace({ reps: 2, view: "front", noiseAmp: 0.004 });
    const def = exerciseById("seated_biceps_curl");
    const variant = variantForProfile(def, "wheelchair");
    const smoother = new PoseSmoother();
    const vals: string[] = [];
    for (const f of frames) {
      const sm = { ...f, lm: smoother.smooth(f.lm, f.t) };
      const mf = computeMetrics(sm, def.metrics, variant.requiredLandmarks);
      const v = mf.values["elbow_flex_mean"];
      if (v !== undefined) vals.push(v.toFixed(0));
    }
    console.log("D metric trace (2 reps):", vals.join(" "));
    expect(true).toBe(true);
  });
});
