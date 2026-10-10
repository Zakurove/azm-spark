/**
 * D-035 items 2 and 4 on real model output: the walk lab's kept landmarks of MediaPipe Pose (Full and
 * Lite, Chromium on the GPU) on the two rendered walks at home (scripts/smoke/scenarios.mjs
 * gait-home-side: across the whole picture and back 3 m from a phone on a shelf, 104 steps a minute,
 * frames with up to 8 ms of jitter; gait-home-wall: toward a phone standing against a wall and back,
 * turning 1.6 m before it, 108 steps a minute), from e2e/v7-gaitlab-smoke.spec.ts, as a regression:
 *   - read as the capture reads a recording (analyseGaitGroup), each walk gives a reading, full or
 *     timing only, with the cadence within 5% of the truth (contract 8.4's bar);
 *   - the side walks replayed through the capture itself (GaitController: the standing calibration,
 *     the walk, the passes counted as walks across the picture, the end after the fixed 4 passes;
 *     D-036 item 6 walks the side view only), the same.
 * Before this change the side walks gave no clean cycle with either model (every cycle dropped for a
 * swap or the order), and the capture asked for the walk again.
 */
import { describe, expect, it } from "vitest";
import { analyseGaitGroup } from "../../src/engine/gait/analyse";
import { walkVerdict } from "../../src/engine/gait/verdict";
import { CAPTURE_LIMITS, GaitController } from "../../src/features/gait/controller";
import type { GaitFrame } from "../../src/engine/gait/types";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { setupOf } from "../fixtures/gait/gen-gait";
import { loadHomeSmoke } from "../fixtures/gait/smoke";

const RUNS = ["gait-home-side-full", "gait-home-side-lite", "gait-home-wall-full", "gait-home-wall-lite"];

const viewsOf = (lab: "side" | "front") =>
  lab === "side" ? (["side"] as const) : (["front", "back"] as const);

describe("the real model's walks at home, read as the capture reads them", () => {
  for (const name of RUNS)
    it(`gives a reading with the cadence within 5% (${name})`, () => {
      const s = loadHomeSmoke(name);
      const views = analyseGaitGroup(
        viewsOf(s.lab).map((view) => ({
          view,
          setup: {
            ...setupOf({ view: s.lab === "side" ? "side" : "front" }),
            heightCm: Math.round(s.heightCm),
          },
          standing: s.standing,
          frames: s.frames,
          poseModel: s.model,
          rollDeg: null,
        })),
      );
      const v = walkVerdict(views);
      expect(v.level).not.toBe("none");
      expect(Math.abs(v.cadence! / s.truth.cadence - 1)).toBeLessThan(0.05);
      expect(v.cleanCycles.left).toBeGreaterThanOrEqual(3);
      expect(v.cleanCycles.right).toBeGreaterThanOrEqual(3);
    });
});

describe("the real model's walks at home, replayed through the capture", () => {
  const plan = (lab: "side" | "front"): GaitPlan => ({
    offered: true,
    modes: ["overground"],
    defaultMode: "overground",
    padAllowed: false,
    helperRequired: false,
    antalgicOnly: false,
    staticStance: false,
    views: { overground: lab === "side" ? ["side"] : ["front", "back"], walking_pad: [] },
  });
  const camera = (frames: readonly GaitFrame[]) =>
    frames.map((f) => ({
      t: f.t,
      lm: f.lm,
      poses: f.lm.some((q) => q.visibility > 0) ? [f.lm] : [],
      aspect: f.aspect,
    }));

  for (const name of RUNS.filter((n) => n.includes("-side-")))
    it(`ends the walk after its 4 passes with its cadence within 5% (${name})`, () => {
      const s = loadHomeSmoke(name);
      const ctl = new GaitController({
        plan: plan(s.lab),
        painBefore: null,
        intake: { walking: { status: "without_aid" }, heightCm: Math.round(s.heightCm), regions: [] },
        poseModel: () => s.model,
        log: () => undefined,
      });
      let t = s.standing[0].t - 100;
      ctl.start(t);
      for (let i = 0; i < 8 && ctl.current.id !== "place"; i++)
        if (ctl.current.id === "gear") ctl.setGear({ shoes: true, brace: null }, t);
        else ctl.confirm(t);
      ctl.confirm(t);
      expect(ctl.current.id).toBe("stand");
      for (const f of camera([...s.standing, ...s.frames])) {
        if (ctl.current.id !== "stand" && ctl.current.id !== "walk") break;
        ctl.feed(f, { rollDeg: null });
        ctl.tick(f.t);
        t = f.t;
      }
      for (let i = 0; i < 3 && ctl.current.id === "walk"; i++) {
        t += CAPTURE_LIMITS.afterLastPassMs + 100;
        ctl.tick(t);
      }
      // The capture ended the recording itself, at a checkpoint (the lab's run ended there too).
      expect(ctl.current.id).toBe("saving");
      const body = ctl.body()!;
      const v = walkVerdict(body.analysis.views);
      expect(v.level).not.toBe("none");
      expect(Math.abs(v.cadence! / s.truth.cadence - 1)).toBeLessThan(0.05);
      const d = ctl.diagnostics()[0];
      expect(d.passes).toBe(4);
    });
});
