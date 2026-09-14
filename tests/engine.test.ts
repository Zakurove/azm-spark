import { describe, expect, it } from "vitest";
import { Calibrator } from "../src/engine/calibration";
import { computeMetrics } from "../src/engine/geometry";
import { CueOrchestrator } from "../src/engine/orchestrator";
import { PoseSmoother } from "../src/engine/oneEuro";
import { profileById } from "../src/engine/profiles";
import { RepEngine } from "../src/engine/repEngine";
import { seatedCurlTrace, seatedPressTrace, sitToStandTrace } from "../src/engine/traces";
import { EngineEvent, Frame, PRF } from "../src/engine/types";
import { exerciseById, variantForProfile } from "../src/exercises/defs";

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
  const prf: PRF = cal.build(0);

  const engine = new RepEngine(def, prf, profile);
  const events: EngineEvent[] = [];
  for (const f of frames) {
    const sm = { ...f, lm: smoother.smooth(f.lm, f.t) };
    const mf = computeMetrics(sm, def.metrics, variant.requiredLandmarks);
    events.push(...engine.step(mf));
  }
  const reps = events.filter((e) => e.kind === "rep") as Extract<EngineEvent, { kind: "rep" }>[];
  const flags = events.filter((e) => e.kind === "flag") as Extract<EngineEvent, { kind: "flag" }>[];
  return { prf, events, reps, flags, engine };
}

describe("seated shoulder press — wheelchair profile", () => {
  it("counts 8 clean reps as valid", () => {
    const frames = seatedPressTrace({ reps: 8 });
    const { reps } = runPipeline("seated_shoulder_press", "wheelchair", frames);
    expect(reps.length).toBe(8);
    expect(reps.filter((r) => r.cls === "valid").length).toBeGreaterThanOrEqual(7);
  });

  it("classifies shallow reps as partial", () => {
    const clean = seatedPressTrace({ reps: 3 });
    const shallow = seatedPressTrace({ reps: 6, effort: 0.55 });
    const { reps } = runPipeline("seated_shoulder_press", "wheelchair", shallow, { calibrateWith: clean });
    const partial = reps.filter((r) => r.cls === "partial").length;
    expect(reps.length).toBeGreaterThanOrEqual(4);
    expect(partial).toBeGreaterThanOrEqual(reps.length - 1);
  });

  it("flags trunk lean and marks those reps compensated", () => {
    const clean = seatedPressTrace({ reps: 3 });
    const leaning = seatedPressTrace({ reps: 8, leanDeg: 14 });
    const { reps, flags } = runPipeline("seated_shoulder_press", "wheelchair", leaning, { calibrateWith: clean });
    expect(flags.some((f) => f.ruleId.startsWith("trunk_lean"))).toBe(true);
    expect(reps.filter((r) => r.cls === "compensated").length).toBeGreaterThanOrEqual(1);
  });

  it("stays quiet about asymmetry for hemiparesis profiles (expected asymmetry)", () => {
    const clean = seatedPressTrace({ reps: 3 });
    const asym = seatedPressTrace({ reps: 6, asymmetry: 0.45 });
    const wheelchair = runPipeline("seated_shoulder_press", "wheelchair", asym, { calibrateWith: clean });
    const hemi = runPipeline("seated_shoulder_press", "hemiparesis_right", asym, { calibrateWith: clean });
    expect(wheelchair.flags.some((f) => f.ruleId === "arm_asym")).toBe(true);
    expect(hemi.flags.some((f) => f.ruleId === "arm_asym")).toBe(false);
  });

  it("PRF calibration derives a personal range near the trace's actual excursion", () => {
    const frames = seatedPressTrace({ reps: 8 });
    const { prf } = runPipeline("seated_shoulder_press", "wheelchair", frames);
    const [lo, hi] = prf.range;
    expect(lo).toBeGreaterThan(40); // racked press position — deep elbow flexion
    expect(hi).toBeLessThan(185);
    expect(hi - lo).toBeGreaterThan(30);
  });
});

describe("seated biceps curl — inverted range direction", () => {
  it("counts curls despite the primary angle decreasing toward the top", () => {
    const frames = seatedCurlTrace({ reps: 8 });
    const { reps, prf } = runPipeline("seated_biceps_curl", "wheelchair", frames);
    expect(prf.range[0]).toBeGreaterThan(prf.range[1]); // inverted orientation preserved
    expect(reps.length).toBe(8);
    expect(reps.filter((r) => r.cls === "valid").length).toBeGreaterThanOrEqual(7);
  });
});

describe("sit-to-stand — post-stroke profile", () => {
  it("counts 5 stands", () => {
    const frames = sitToStandTrace({ reps: 5 });
    const { reps } = runPipeline("sit_to_stand", "hemiparesis_right", frames);
    expect(reps.length).toBe(5);
    expect(reps.filter((r) => r.cls === "valid").length).toBeGreaterThanOrEqual(4);
  });
});

describe("framing & occlusion", () => {
  it("wheelchair variant ignores occluded lower limbs (framing stays OK)", () => {
    const frames = seatedPressTrace({ reps: 2 });
    const def = exerciseById("seated_shoulder_press");
    const variant = variantForProfile(def, "wheelchair");
    const mf = computeMetrics(frames[30], def.metrics, variant.requiredLandmarks);
    expect(mf.framingOk).toBe(true); // knees/ankles are low-visibility but not required
  });

  it("sit-to-stand requires lower-body visibility", () => {
    const frames = seatedPressTrace({ reps: 2 }); // legs occluded in this trace
    const def = exerciseById("sit_to_stand");
    const variant = variantForProfile(def, "standing");
    const mf = computeMetrics(frames[30], def.metrics, variant.requiredLandmarks);
    expect(mf.framingOk).toBe(false);
  });
});

describe("cue orchestrator", () => {
  it("rate-limits non-safety cues and always passes safety + rep counts", () => {
    const o = new CueOrchestrator();
    const flag = (t: number, severity: "warn" | "safety") =>
      ({ kind: "flag", ruleId: "x", cue: "sit_tall", severity, value: 0, t }) as EngineEvent;
    expect(o.push(flag(0, "warn"))).not.toBeNull();
    expect(o.push(flag(500, "warn"))).toBeNull(); // rate-limited
    expect(o.push(flag(900, "safety"))).not.toBeNull(); // safety bypasses
    expect(o.push({ kind: "rep", cls: "valid", count: 1, t: 1000, durSec: 2, peakPct: 1 })).not.toBeNull(); // reps bypass
  });

  it("a deferred warning preempts the next rep count instead of starving", () => {
    const o = new CueOrchestrator();
    o.push({ kind: "rep", cls: "valid", count: 1, t: 0, durSec: 2, peakPct: 1 }); // speaks, sets gap
    expect(o.push({ kind: "flag", ruleId: "trunk_lean", cue: "sit_tall", severity: "warn", value: 10, t: 1200 })).toBeNull(); // deferred
    const out = o.push({ kind: "rep", cls: "valid", count: 2, t: 2400, durSec: 2, peakPct: 1 });
    expect(out).not.toBeNull();
    expect(out!.cue).toBe("sit_tall"); // warning preempts the count
  });
});
