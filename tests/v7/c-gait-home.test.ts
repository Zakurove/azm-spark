/**
 * D-035 item 2 in the capture (src/features/gait/controller.ts): the walk at home. The side view comes
 * first (the most reliable one: across the picture and back, about 3 m from the phone); the front view
 * is offered after it, or at once when there is no room for the side view. Passes are counted by the
 * change of direction, so the phone can stand against a wall and nobody leaves the picture. A
 * recording stops once each side has 3 clean cycles (GAIT_MVP, timing only below the full gate); a
 * recording that gives nothing asks a calm, specific line and is kept as a diagnostic when the person
 * goes on, so a walk never ends with nothing stored (item 4).
 */
import { describe, expect, it } from "vitest";
import {
  CAPTURE_LIMITS,
  GaitController,
  STEP_KIND,
  type GaitControllerOptions,
  type GaitStepId,
} from "../../src/features/gait/controller";
import { isTimingReading } from "../../src/engine/gait/analyse";
import { walkVerdict } from "../../src/engine/gait/verdict";
import type { GaitFrame } from "../../src/engine/gait/types";
import type { Frame } from "../../src/engine/types";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { checkGaitBody } from "../../server/modules/focus/validate";
import { walk, type WalkSpec } from "../fixtures/gait/gen-gait";

const HOME: GaitPlan = {
  offered: true,
  modes: ["overground"],
  defaultMode: "overground",
  padAllowed: false,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: false,
  views: { overground: ["side", "front", "back"], walking_pad: [] },
};

interface Run {
  ctl: GaitController;
  t: number;
  lines: string[];
  logs: string[];
}

function controller(plan: GaitPlan = HOME, over: Partial<GaitControllerOptions> = {}): Run {
  const logs: string[] = [];
  const ctl = new GaitController({
    plan,
    painBefore: null,
    intake: { walking: { status: "without_aid" }, heightCm: 172, regions: [] },
    poseModel: () => "full",
    log: (line) => logs.push(line),
    ...over,
  });
  const run: Run = { ctl, t: 1000, lines: [], logs };
  ctl.onLine((line) => run.lines.push(line));
  ctl.start(run.t);
  return run;
}

function camera(frames: readonly GaitFrame[], base: number): Frame[] {
  const t0 = frames[0].t;
  return frames.map((f) => ({ t: base + (f.t - t0), lm: f.lm, poses: [f.lm], aspect: f.aspect }));
}

function play(run: Run, frames: Frame[]): void {
  for (const f of frames) {
    run.ctl.feed(f, { rollDeg: 0 });
    run.ctl.tick(f.t);
    run.t = f.t;
  }
}

function tapTo(run: Run, until: GaitStepId): void {
  for (let i = 0; i < 40 && run.ctl.current.id !== until; i++) {
    if (run.ctl.current.id === "gear") run.ctl.setGear({ shoes: true, brace: null }, run.t);
    else if (!run.ctl.confirm(run.t)) break;
  }
  expect(run.ctl.current.id).toBe(until);
}

/** Its standing, its walk, then the person stands still until the checkpoint has run. */
function record(run: Run, w: { standing: GaitFrame[]; frames: GaitFrame[] }): void {
  expect(run.ctl.current.id).toBe("stand");
  play(run, camera(w.standing, run.t + 40));
  expect(run.ctl.current.id).toBe("walk");
  play(run, camera(w.frames, run.t + 40));
  for (let i = 0; i < 3 && run.ctl.current.id === "walk"; i++) {
    run.t += CAPTURE_LIMITS.restAfterPassMs + 100;
    run.ctl.tick(run.t);
  }
}

const sideAtHome = (seed: number, passes = 6): WalkSpec => ({
  view: "side",
  passes,
  seed,
  home: { pathM: 3 },
  passShiftM: 0.3,
  camera: { distance: 3 },
  noise: 0.002,
  jitterMs: 8,
});

const wallWalk = (seed: number, passes = 4): WalkSpec => ({
  view: "front",
  passes,
  seed,
  home: { farM: 4.5, nearM: 1.2 },
  passShiftM: 0.4,
  camera: { lateral: 0.3 },
  noise: 0.002,
  jitterMs: 8,
});

describe("the walk at home: the side view first, the front view offered", () => {
  it("records the side view first, then asks whether to add the front view", () => {
    const run = controller();
    expect(run.ctl.plannedSteps.map((s) => (s.rec ? `${s.id}:${s.rec}` : s.id))).toEqual([
      "intro",
      "gear",
      "clear_path",
      "place:overground_side",
      "stand:overground_side",
      "walk:overground_side",
      "front_offer",
      "place:overground_front",
      "stand:overground_front",
      "walk:overground_front",
      "saving",
      "done",
    ]);
    expect(STEP_KIND.front_offer).toBe("question");
  });

  it("goes to the front view when there is no room for the side view", () => {
    const run = controller();
    tapTo(run, "place");
    expect(run.ctl.current.rec).toBe("overground_side");
    expect(run.ctl.skipView(run.t)).toBe(true);
    expect(run.ctl.current).toEqual({ id: "place", rec: "overground_front" });
  });

  it("finishes after the side view when the person does not add the front view", () => {
    const run = controller();
    tapTo(run, "place");
    run.ctl.confirm(run.t);
    record(run, walk(sideAtHome(5)));
    expect(run.ctl.current.id).toBe("front_offer");
    expect(run.ctl.frontChoice(false, run.t)).toBe(true);
    expect(run.ctl.current.id).toBe("saving");
    const body = run.ctl.body()!;
    expect(body.analysis.views.map((v) => v.view)).toEqual(["side"]);
  });
});

describe("a side walk across the picture and back on a 3 m path", () => {
  for (const seed of [3, 5, 9])
    it(`stops once each side has 3 clean cycles and keeps its cadence and step times (seed ${seed})`, () => {
      const run = controller({ ...HOME, views: { overground: ["side"], walking_pad: [] } });
      tapTo(run, "place");
      run.ctl.confirm(run.t);
      const w = walk(sideAtHome(seed));
      record(run, w);
      expect(run.ctl.current.id).toBe("saving");
      const body = run.ctl.body()!;
      const v = walkVerdict(body.analysis.views);
      expect(v.level).not.toBe("none");
      expect(Math.abs(v.cadence! / w.truth.cadence - 1)).toBeLessThan(0.05);
      if (v.level === "timing") expect(body.analysis.views.every(isTimingReading)).toBe(true);
      expect(checkGaitBody(body as never, HOME).ok).toBe(true);
      // The capture told the coach and the log what it found.
      expect(run.logs.some((l) => l.includes("overground_side") && l.includes("passes"))).toBe(true);
    });
});

describe("a walk toward a phone against a wall, turning before it", () => {
  it("counts the passes by the change of direction and gives the cadence from the toward passes", () => {
    const run = controller();
    tapTo(run, "place");
    run.ctl.skipView(run.t);
    run.ctl.confirm(run.t);
    const w = walk(wallWalk(5, 6));
    record(run, w);
    expect(run.ctl.current.id).toBe("saving");
    const d = run.ctl.diagnostics().find((x) => x.rec === "overground_front")!;
    // Toward and away passes: none of them needed the person to leave the picture.
    expect(d.passes).toBeGreaterThanOrEqual(8);
    const body = run.ctl.body()!;
    const v = walkVerdict(body.analysis.views);
    expect(v.level).not.toBe("none");
    expect(Math.abs(v.cadence! / w.truth.cadence - 1)).toBeLessThan(0.05);
    expect(checkGaitBody(body as never, HOME).ok).toBe(true);
  });
});

describe("a recording that gives nothing (item 4: never end with nothing)", () => {
  it("names what to change, and keeps the walk with its reasons when the person goes on", () => {
    const run = controller({ ...HOME, views: { overground: ["side"], walking_pad: [] } });
    tapTo(run, "place");
    run.ctl.confirm(run.t);
    // The person walks toward the phone and back in the side recording: the wrong view.
    record(run, walk(wallWalk(7, 3)));
    expect(run.ctl.current).toEqual({ id: "retry", rec: "overground_side" });
    expect(run.ctl.retryReason()).toBe("side_on");
    expect(run.lines).toContain("gait_quality_retry");
    expect(run.ctl.retry(false, run.t)).toBe(true);
    expect(run.ctl.current.id).toBe("saving");
    const body = run.ctl.body()!;
    expect(body.analysis.views.map((v) => v.view)).toEqual(["side"]);
    expect(body.analysis.views[0].quality.issues).toContain("wrong_view");
    // The diagnostic keeps the reasons and no number of a walk that was not read.
    expect(body.analysis.views[0].metrics).toEqual({});
    expect(body.analysis.combined).toEqual({});
    expect(checkGaitBody(body as never, HOME).ok).toBe(true);
    const d = run.ctl.diagnostics()[0];
    expect(d).toMatchObject({ rec: "overground_side", level: "none" });
    expect(d.reasons[0]).toBe("wrong_view");
    expect(d.fps).toBeGreaterThan(25);
    expect(d.visibleShare).toBeGreaterThan(0.5);
    expect(run.logs.some((l) => l.includes("not analysed") && l.includes("wrong_view"))).toBe(true);
  });
});
