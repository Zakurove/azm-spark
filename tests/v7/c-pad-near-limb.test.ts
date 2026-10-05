/**
 * The real model smoke's pad walk as a regression (D-026 item 6, GG-4): G1's rendered walk on the
 * pad seen from the right, through MediaPipe Full and Lite (tests/fixtures/gait/smoke), whose far leg
 * hides behind the near one for part of each stride. C1 dropped every cycle of it. Every side view now
 * gates a cycle on the hips and its own leg (W2-15), but until GG-4's swap rule and foot detector land
 * the engine must keep failing the real model walks safely: no view passes its gate on a wrong walk,
 * on the pad or made overground, and the near limb's tracking itself is good enough to time the walk
 * on Full. The generator's overground side walks, with the far leg the real model reports, pass.
 */
import { describe, expect, it } from "vitest";
import { analyseGaitView } from "../../src/engine/gait/analyse";
import { prepare } from "../../src/engine/gait/preprocess";
import { loadSmoke, overgroundFromPad } from "../fixtures/gait/smoke";
import {
  farLegOf,
  REAL_FAR_LEG,
  setupOf,
  walk,
  withRealFarLeg,
  type WalkSpec,
} from "../fixtures/gait/gen-gait";
import { GAIT_ENGINE } from "../../src/engine/gait/params";

describe("G1's rendered pad walk through the real model", () => {
  for (const name of ["gait-pad-side-full", "gait-pad-side-lite"] as const)
    it(`never passes the gate on a wrong walk (${name})`, () => {
      const s = loadSmoke(name);
      const r = analyseGaitView({
        view: "pad_side",
        nearSide: s.nearSide,
        setup: s.setup,
        standing: s.standing,
        frames: s.frames,
        poseModel: s.model,
        rollDeg: 0,
      });
      if (r.quality.gatePassed)
        expect(Math.abs(r.metrics.cadence!.value! / s.truth.cadence - 1)).toBeLessThan(0.05);
      else expect(r.quality.issues).toContain("too_few_cycles");
    });

  it("holds a near leg the model tracks well: the near heel's forward swing gives every contact", () => {
    const s = loadSmoke("gait-pad-side-full");
    // Without the leg swap rule (labels as the model gave them) the near heel, relative to the hips,
    // peaks once a stride, within 2 frames of each true contact.
    const p = prepare(s.frames, { rollDeg: 0, labels: "none" }).series;
    const near = s.nearSide === "right" ? 30 : 29;
    const rel = Array.from({ length: p.n }, (_, k) => p.x[near][k] - (p.x[23][k] + p.x[24][k]) / 2);
    const truth = s.truth.ics.filter((e) => e.side === s.nearSide).map((e) => e.t);
    let found = 0;
    for (const t of truth) {
      const k = Math.round((t / 1000 - p.t[0]) * p.hz);
      if (k < 3 || k > p.n - 4) continue;
      // The walker faces the picture's right (near side right): the heel leads at contact.
      const win = rel.slice(k - 2, k + 3).filter(Number.isFinite);
      const before = rel.slice(k - 8, k - 2).filter(Number.isFinite);
      const after = rel.slice(k + 3, k + 9).filter(Number.isFinite);
      if (win.length && before.length && after.length)
        if (Math.max(...win) > Math.max(...before) && Math.max(...win) > Math.max(...after)) found++;
    }
    expect(found / truth.length).toBeGreaterThan(0.9);
  });
});

describe("the overground side view with the far leg as the real model sees it (D-026 item 6, engine review 2)", () => {
  // Without the near limb rule every cycle of these walks was dropped (visibility) and the walk split
  // into bouts: no cadence, gate failed, on every phone.
  const specs: WalkSpec[] = [
    { view: "side", passes: 4, seed: 91 },
    { view: "side", passes: 4, seed: 92, cadence: 96, speed: 0.9 },
    // A fast walker gives each leg about two cycles a pass where it is near: the protocol's 6 passes.
    { view: "side", passes: 6, seed: 93, cadence: 120, speed: 1.4 },
  ];
  for (const spec of specs)
    it(`passes its gate and times the walk (cadence ${spec.cadence ?? 108})`, () => {
      const w = walk(spec);
      const frames = withRealFarLeg(w.frames);
      // The model the walk was made to: the far knee hidden in about 46% of the frames that show a far
      // side, the far ankle in about 12%.
      const sides = w.frames.map((f) => farLegOf(f.lm));
      const shown = sides.filter((s) => s !== null).length;
      const hidden = (ids: { left: number; right: number }) =>
        frames.filter((f, i) => sides[i] && f.lm[ids[sides[i]!]].visibility < 0.5).length / shown;
      expect(hidden({ left: 25, right: 26 })).toBeCloseTo(REAL_FAR_LEG.knee, 1);
      expect(hidden({ left: 27, right: 28 })).toBeCloseTo(REAL_FAR_LEG.ankle, 1);
      const r = analyseGaitView({
        view: "side",
        setup: setupOf(spec),
        standing: w.standing,
        frames,
        poseModel: "full",
        rollDeg: 0,
      });
      expect(r.quality.gatePassed).toBe(true);
      expect(r.quality.cleanCycles.left).toBeGreaterThanOrEqual(GAIT_ENGINE.cleanCyclesPerSide);
      expect(r.quality.cleanCycles.right).toBeGreaterThanOrEqual(GAIT_ENGINE.cleanCyclesPerSide);
      expect(Math.abs(r.metrics.cadence!.value! / w.truth.cadence - 1)).toBeLessThan(0.05);
      // The near leg's step length is still read against the walker's own (within 5%).
      const clean = analyseGaitView({
        view: "side",
        setup: setupOf(spec),
        standing: w.standing,
        frames: w.frames,
        poseModel: "full",
        rollDeg: 0,
      });
      expect(
        Math.abs(r.metrics.step_length_m!.value! / clean.metrics.step_length_m!.value! - 1),
      ).toBeLessThan(0.05);
      expect(r.quality.issues).not.toContain("gaps");
    });

  it("tells a fast walker's 4 passes they are too few, never that the legs were not seen", () => {
    // Each leg's cycles come from the passes where it is near; the far leg's dropped cycles are the
    // near limb rule at work, not a visibility problem of the walk (capture adds passes, up to 6).
    const spec: WalkSpec = { view: "side", passes: 4, seed: 93, cadence: 120, speed: 1.4 };
    const w = walk(spec);
    const r = analyseGaitView({
      view: "side",
      setup: setupOf(spec),
      standing: w.standing,
      frames: withRealFarLeg(w.frames),
      poseModel: "full",
      rollDeg: 0,
    });
    expect(r.quality.gatePassed).toBe(false);
    expect(r.quality.issues).toEqual(["too_few_cycles"]);
  });
});

describe("G1's real model walk made overground: a side view never passes its gate on a wrong walk (W2-15)", () => {
  // Each pass of the pad walk moved at the belt speed, every second pass mirrored (overgroundFromPad).
  // On real model output the swap rule still carries the far leg into the near track (GG-4), so some
  // near cycles are wrong (Lite: cadence 23 to 71% off); the view must then fail its gate.
  const layouts = [
    [6.5, 4],
    [5, 6],
    [7.5, 4],
  ] as const;
  for (const name of ["gait-pad-side-full", "gait-pad-side-lite"] as const)
    for (const [passSec, passes] of layouts)
      it(`${name}, ${passes} passes of ${passSec} s`, () => {
        const w = overgroundFromPad(name, passSec, passes);
        const r = analyseGaitView({
          view: "side",
          setup: w.setup,
          standing: w.standing,
          frames: w.frames,
          poseModel: w.model,
          rollDeg: 0,
        });
        if (r.quality.gatePassed)
          expect(Math.abs(r.metrics.cadence!.value! / w.truth.cadence - 1)).toBeLessThan(0.05);
        else expect(r.quality.issues).toContain("too_few_cycles");
      });
});
