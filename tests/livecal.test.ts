import { expect, it } from "vitest";
import { Calibrator } from "../src/engine/calibration";
import { computeMetrics } from "../src/engine/geometry";
import { PoseSmoother } from "../src/engine/oneEuro";
import { profileById } from "../src/engine/profiles";
import { RepEngine } from "../src/engine/repEngine";
import { seatedPressTrace } from "../src/engine/traces";
import { EngineEvent } from "../src/engine/types";
import { exerciseById, variantForProfile } from "../src/exercises/defs";

/** Simulates the LIVE app flow: calibrate on the stream until ready, then train on the same stream. */
it("live flow: calibration hands over to training and reps count", () => {
  const def = exerciseById("seated_shoulder_press");
  const profile = profileById("wheelchair");
  const variant = variantForProfile(def, "wheelchair");
  const frames = seatedPressTrace({ reps: 20, leanDeg: 10 });

  const smoother = new PoseSmoother();
  let cal: Calibrator | null = new Calibrator(def);
  let engine: RepEngine | null = null;
  const events: EngineEvent[] = [];
  let handoverAt = -1;

  for (const f of frames) {
    const sm = { ...f, lm: smoother.smooth(f.lm, f.t) };
    const mf = computeMetrics(sm, def.metrics, variant.requiredLandmarks);
    if (engine) {
      events.push(...engine.step(mf));
    } else if (cal) {
      cal.feed(mf);
      if (cal.ready(f.t, 60)) {
        const prf = cal.build(0);
        engine = new RepEngine(def, prf, profile);
        cal = null;
        handoverAt = f.t;
        // eslint-disable-next-line no-console
        console.log("handover at", f.t, "prf", prf.range);
      }
    }
  }

  expect(handoverAt).toBeGreaterThan(0);
  const reps = events.filter((e) => e.kind === "rep");
  // eslint-disable-next-line no-console
  console.log("reps:", reps.map((r: any) => r.cls).join(","));
  expect(reps.length).toBeGreaterThanOrEqual(10);
  expect(reps.filter((r: any) => r.cls === "valid").length).toBeGreaterThanOrEqual(5);
});
