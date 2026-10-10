/**
 * Step C4: the walk's controller (src/features/gait/controller.ts) on the gait fixtures: the steps of
 * each mode with their C-16 kinds (every pad safety step and the clear path step are confirm steps),
 * the recordings with their fixed target (D-036 item 6: the side walk's passes, the pad view's
 * seconds, never raised), the calm «try once more», the pain rule of C-15 (any mark_pain ends the
 * recording; the shared rule ends the test, pain_limited; walkPain kept for the rules), the coach's
 * tools on every step kind (the 2.11 gait row), and a body the gait route accepts.
 */
import { setupLine } from "../../src/features/gait/copy";
import { describe, expect, it } from "vitest";
import {
  CAPTURE_LIMITS,
  CAPTURE_RULES,
  GaitController,
  STEP_KIND,
  type GaitControllerOptions,
  type GaitStepId,
} from "../../src/features/gait/controller";
import type { BridgeEvent } from "../../src/coach/types";
import { gaitScreenActions } from "../../src/features/gait/coachActions";
import type { GaitFrame } from "../../src/engine/gait/types";
import type { Frame } from "../../src/engine/types";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { GAIT_DATA } from "../../src/movements/gait";
import { checkGaitBody } from "../../server/modules/focus/validate";
import { walkVerdict } from "../../src/engine/gait/verdict";
import { walk, type WalkSpec } from "../fixtures/gait/gen-gait";
import { GAIT_CATALOG } from "../fixtures/gait/catalog";

/* ------------------------------------------------------------ the plans */

const BASE: GaitPlan = {
  offered: true,
  modes: ["overground"],
  defaultMode: "overground",
  padAllowed: false,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: false,
  views: { overground: ["front", "back", "side"], walking_pad: [] },
};
const PAD: GaitPlan = {
  ...BASE,
  modes: ["overground", "walking_pad"],
  padAllowed: true,
  views: {
    overground: ["front", "back", "side"],
    walking_pad: [
      { view: "pad_side", nearSide: "right" },
      { view: "pad_side", nearSide: "left" },
      { view: "pad_front" },
    ],
  },
};

const spec = (name: string): WalkSpec => GAIT_CATALOG.find((e) => e.name === name)!.spec;

/* ------------------------------------------------------------ the driver */

interface Run {
  ctl: GaitController;
  events: BridgeEvent[];
  lines: { line: string; severity: string }[];
  t: number;
}

function controller(plan: GaitPlan, over: Partial<GaitControllerOptions> = {}): Run {
  const ctl = new GaitController({
    plan,
    painBefore: null,
    intake: { walking: { status: "without_aid" }, heightCm: 172, regions: [] },
    poseModel: () => "full",
    warmUpSec: 2,
    ...over,
  });
  const run: Run = { ctl, events: [], lines: [], t: 1000 };
  ctl.onBridge((e) => run.events.push(e));
  ctl.onLine((line, severity) => run.lines.push({ line, severity }));
  ctl.start(run.t);
  return run;
}

/** The walk screen's registration of the buttons the coach may press (GaitCapture's useScreenActions). */
function show(run: Run): void {
  const e = gaitScreenActions(run.ctl, () => run.t);
  if (e) run.ctl.actions.show(e.key, () => e.actions, e.alive);
}

/** The frames a camera gives for walker frames, from `base` on (times keep increasing across views). */
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

/** Taps through the info and confirm steps until `until` (or a step that needs more than a tap). */
function tapTo(run: Run, until: GaitStepId): void {
  for (let i = 0; i < 40 && run.ctl.current.id !== until; i++) {
    const s = run.ctl.current.id;
    if (s === "gear") run.ctl.setGear({ shoes: true, brace: null }, run.t);
    else if (!run.ctl.confirm(run.t)) break;
  }
  expect(run.ctl.current.id).toBe(until);
}

/** Records one view of a walk: its standing, then its walk, then the clock past the last step. */
function record(run: Run, w: { standing: GaitFrame[]; frames: GaitFrame[] }): void {
  expect(run.ctl.current.id).toBe("stand");
  play(run, camera(w.standing, run.t + 40));
  // The pad: the belt up to speed, and the warm up before the first view.
  if (run.ctl.current.id === "pad_start") run.ctl.confirm(run.t);
  if (run.ctl.current.id === "pad_warm_up") {
    play(run, camera(w.frames.slice(0, 90), run.t + 40));
    run.ctl.tick(run.t + 2500);
    run.t += 2500;
  }
  expect(run.ctl.current.id).toBe("walk");
  play(run, camera(w.frames, run.t + 40));
  // Overground the recording ends a moment after the last pass: the clock, then the analysis.
  for (let i = 0; i < 3 && run.ctl.current.id === "walk"; i++) {
    run.t += CAPTURE_LIMITS.afterLastPassMs + 100;
    run.ctl.tick(run.t);
  }
}

/* -------------------------------------------------------------- the steps */

describe("the walk's steps and their kinds (C-16)", () => {
  it("are info, confirm, question, timer, active or safety as C-16 lists them", () => {
    const confirm: GaitStepId[] = [
      "clear_path",
      "pad_check",
      "place",
      "pad_on",
      "pad_start",
      "pad_stop",
      "stance_place",
      "walk_again",
    ];
    for (const id of confirm) expect(STEP_KIND[id]).toBe("confirm");
    expect(STEP_KIND.pad_warm_up).toBe("timer");
    for (const id of ["stand", "walk", "stance"] as const) expect(STEP_KIND[id]).toBe("active");
    for (const id of ["mode", "gear", "retry", "pad_details"] as const)
      expect(STEP_KIND[id]).toBe("question");
    expect(STEP_KIND.pain_stop).toBe("safety");
    expect(STEP_KIND.intro).toBe("info");
  });

  it("walks overground as one walk: the clear path, the side recording, the stance (D-036 item 6)", () => {
    const run = controller({ ...BASE, staticStance: true });
    expect(run.ctl.plannedSteps.map((s) => (s.rec ? `${s.id}:${s.rec}` : s.id))).toEqual([
      "intro",
      "gear",
      "clear_path",
      "place:overground_side",
      "stand:overground_side",
      "walk:overground_side",
      "stance_place",
      "stance",
      "saving",
      "done",
    ]);
  });

  it("asks the mode when the pad is allowed, and puts the pad safety steps as one checklist confirm step (D-032 item 2)", () => {
    const run = controller(PAD);
    expect(run.ctl.plannedSteps.map((s) => s.id)).toContain("mode");
    run.ctl.confirm(run.t);
    expect(run.ctl.chooseMode("walking_pad", run.t)).toBe(true);
    const ids = run.ctl.plannedSteps.map((s) => (s.rec ? `${s.id}:${s.rec}` : s.id));
    expect(ids).toEqual([
      "intro",
      "mode",
      "gear",
      "pad_check",
      "place:pad_side_a",
      "pad_on:pad_side_a",
      "stand:pad_side_a",
      "pad_start:pad_side_a",
      "pad_warm_up:pad_side_a",
      "walk:pad_side_a",
      "pad_stop:pad_side_a",
      "place:pad_side_b",
      "stand:pad_side_b",
      "pad_start:pad_side_b",
      "walk:pad_side_b",
      "pad_stop:pad_side_b",
      "place:pad_front",
      "stand:pad_front",
      "pad_start:pad_front",
      "walk:pad_front",
      "pad_stop:pad_front",
      "pad_details",
      "saving",
      "done",
    ]);
    // gait-rules eligibility.padSafety: six steps, each one here (the handrail hold is asked after the
    // walk, the warm up is the timer).
    expect(GAIT_DATA.eligibility.padSafety).toHaveLength(6);
  });

  it("follows a one view plan (the showcase walks one view)", () => {
    const run = controller({
      ...PAD,
      views: { overground: ["side"], walking_pad: [{ view: "pad_side", nearSide: "right" }] },
    });
    expect(run.ctl.viewsOf("overground_side")).toEqual([{ view: "side" }]);
    run.ctl.confirm(run.t);
    run.ctl.chooseMode("walking_pad", run.t);
    expect(run.ctl.plannedSteps.filter((s) => s.id === "walk").map((s) => s.rec)).toEqual(["pad_side_a"]);
  });

  it("goes overground when the pad's slowest speed is too fast", () => {
    const run = controller(PAD);
    run.ctl.confirm(run.t);
    run.ctl.chooseMode("walking_pad", run.t);
    tapTo(run, "stand");
    play(run, camera(walk(spec("pad-side-right")).standing, run.t + 40));
    expect(run.ctl.current.id).toBe("pad_start");
    expect(run.ctl.padTooSlowForMe(run.t)).toBe(true);
    expect(run.ctl.mode).toBe("overground");
    expect(run.ctl.current.id).toBe("clear_path");
    expect(run.ctl.plannedSteps.map((s) => s.id)).not.toContain("mode");
  });

  it("holds its numbers equal to the gait data", () => {
    expect(CAPTURE_RULES.standingSec).toBe(GAIT_DATA.capture.common.standingCalibration_s);
    expect(CAPTURE_RULES.padSideSec).toBe(GAIT_DATA.capture.walking_pad.side.durationPerView_s);
    expect(CAPTURE_RULES.sidePasses).toBe(GAIT_DATA.capture.overground.side.passes);
    expect(CAPTURE_RULES.sidePasses).toBe(4);
    expect(CAPTURE_RULES.warmUpMin).toBe(2);
    expect(CAPTURE_RULES.familiarisedMin).toBe(6);
    expect(CAPTURE_RULES.cleanCycles).toBe(6);
    expect(CAPTURE_RULES.stanceHoldSec).toBe(10);
  });
});

/* ---------------------------------------------------------- the recordings */

describe("the recordings", () => {
  it("records the side walk's 4 passes and ends a moment after the last one, passing its gate (D-036 item 6)", () => {
    const run = controller(BASE);
    tapTo(run, "place");
    run.ctl.confirm(run.t);
    const w = walk(spec("overground-side"));
    // The counter says «pass N of 4» and never more, and the target never grows.
    expect(run.ctl.current.id).toBe("stand");
    play(run, camera(w.standing, run.t + 40));
    const seen: { passes: number; target: number }[] = [];
    for (const f of camera(w.frames, run.t + 40)) {
      run.ctl.feed(f, { rollDeg: 0 });
      run.ctl.tick(f.t);
      run.t = f.t;
      const live = run.ctl.live();
      if (live) seen.push({ passes: live.passes, target: live.target });
    }
    for (let i = 0; i < 3 && run.ctl.current.id === "walk"; i++) {
      run.t += CAPTURE_LIMITS.afterLastPassMs + 100;
      run.ctl.tick(run.t);
    }
    expect(seen.every((x) => x.target === 4 && x.passes <= 4)).toBe(true);
    expect(seen.at(-1)?.passes).toBe(4);
    expect(run.ctl.current.id).toBe("saving");
    const body = run.ctl.body()!;
    expect(body.analysis.views.map((v) => v.view)).toEqual(["side"]);
    const [side] = body.analysis.views;
    expect(side.quality.gatePassed).toBe(true);
    // GW-3: the stored quality keeps what the capture counted.
    expect(side.quality.capture).toMatchObject({ passes: 4, tries: 1 });
    expect(side.quality.capture!.steps).toBeGreaterThan(10);
    expect(side.quality.capture!.seconds).toBeGreaterThan(10);
    expect(checkGaitBody(body as never, BASE).ok).toBe(true);
    // The coach heard the end of the recording (the gait boundary of bridge rules 6 and 7).
    expect(run.events.filter((e) => e.type === "pass_done")).toHaveLength(1);
  });

  it("never walks the plan's front and back views; a plan without the side view walks nothing overground", () => {
    const run = controller({ ...BASE, views: { overground: ["front", "back"], walking_pad: [] } });
    expect(run.ctl.plannedSteps.map((s) => s.id)).toEqual(["intro", "gear", "clear_path", "saving", "done"]);
    tapTo(run, "saving");
    expect(run.ctl.body()).toBeNull();
    run.ctl.nothingSaved(run.t);
    expect(run.ctl.current.id).toBe("nothing");
    run.ctl.leave();
    expect(run.ctl.leaving).toBe(true);
  });

  it("keeps its fixed target: a walk that gives too little asks once to try again, then goes on kept (D-036 item 6)", () => {
    const run = controller({ ...BASE, views: { overground: ["side"], walking_pad: [] } });
    tapTo(run, "place");
    run.ctl.confirm(run.t);
    // Passes of a person who turns in the picture after two steps (a 1.6 m path): each counts, but
    // they hold too few steps for 3 clean cycles a side.
    const short = walk({ view: "side", passes: 5, seed: 93, home: { pathM: 1.6 }, camera: { distance: 3 } });
    record(run, short);
    expect(run.ctl.current).toEqual({ id: "retry", rec: "overground_side" });
    expect(run.ctl.retryReason()).toBe("more_steps");
    expect(run.ctl.diagnostics()[0]).toMatchObject({ target: 4, tries: 1, level: "none" });
    // Try once more: the phone's placement, then the same fixed target.
    expect(run.ctl.retry(true, run.t)).toBe(true);
    expect(run.ctl.current).toEqual({ id: "place", rec: "overground_side" });
    run.ctl.confirm(run.t);
    record(run, short);
    // The second try gave too little as well: no third, the walk goes on with it kept.
    expect(run.ctl.current.id).toBe("saving");
    const body = run.ctl.body()!;
    expect(walkVerdict(body.analysis.views).level).toBe("none");
    expect(body.analysis.views[0].quality.capture).toMatchObject({ passes: 4, tries: 2 });
    expect(checkGaitBody(body as never, BASE).ok).toBe(true);
  });

  it("reads the walk at once on «I have finished», always there while walking (D-036 item 6)", () => {
    const run = walking();
    expect(run.ctl.live()!.phase).toBe("walking");
    expect(run.ctl.finishWalk(run.t)).toBe(true);
    // Five seconds of walking is too little: the calm «try once more», or go on with it kept.
    expect(run.ctl.current).toEqual({ id: "retry", rec: "overground_side" });
    expect(run.ctl.retry(false, run.t)).toBe(true);
    expect(run.ctl.current.id).toBe("saving");
    expect(run.ctl.body()!.analysis.views.map((v) => v.view)).toEqual(["side"]);
    // Nothing to finish outside a walk.
    expect(run.ctl.finishWalk(run.t)).toBe(false);
  });

  it("ends an overground walk at its most time, whatever was counted", () => {
    const run = controller({ ...BASE, views: { overground: ["side"], walking_pad: [] } });
    tapTo(run, "place");
    run.ctl.confirm(run.t);
    const w = walk(spec("overground-side"));
    play(run, camera(w.standing, run.t + 40));
    // The person stands still in the picture: no pass, no step from the model's jitter.
    const still = w.standing;
    const frames: Frame[] = [];
    for (let i = 0; frames.length < (CAPTURE_LIMITS.overgroundMaxSec + 2) * 30; i++) {
      const f = still[i % still.length];
      frames.push({ t: run.t + 40 + i * 33.3, lm: f.lm, poses: [f.lm], aspect: f.aspect });
    }
    play(run, frames);
    run.ctl.tick(run.t + 300);
    const d = run.ctl.diagnostics()[0];
    expect(d.passes).toBe(0);
    expect(d.steps).toBe(0);
    expect(run.ctl.current).toEqual({ id: "retry", rec: "overground_side" });
  });

  it("records each pad view, the warm up timer between, and gives a body with the pad's setup", () => {
    const run = controller(PAD);
    run.ctl.confirm(run.t);
    run.ctl.chooseMode("walking_pad", run.t);
    // A camera keeps sending frames past the view's 30 s (20 s at the front): 33 s walks.
    const padWalk = (name: string) => walk({ ...spec(name), durationSec: 33 });
    tapTo(run, "stand");
    record(run, padWalk("pad-side-right"));
    expect(run.ctl.current).toEqual({ id: "pad_stop", rec: "pad_side_a" });
    tapTo(run, "stand");
    record(run, padWalk("pad-side-left"));
    tapTo(run, "stand");
    record(run, padWalk("pad-front"));
    tapTo(run, "pad_details");
    expect(run.ctl.setPadDetails(4.3, "kmh", "light", run.t)).toBe(true);
    expect(run.ctl.current.id).toBe("saving");
    const body = run.ctl.body()!;
    expect(body.setup).toMatchObject({
      mode: "walking_pad",
      padSpeedKmh: 4.3,
      handrail: "light",
      familiarised: false,
    });
    expect(body.analysis.views.map((v) => `${v.view}:${v.nearSide ?? ""}`)).toEqual([
      "pad_side:right",
      "pad_side:left",
      "pad_front:",
    ]);
    expect(body.analysis.views.every((v) => v.quality.gatePassed)).toBe(true);
    // Each view recorded its fixed seconds (D-036 item 6), never more.
    expect(body.analysis.views.map((v) => Math.round(v.quality.capture!.seconds))).toEqual([30, 30, 20]);
    expect(body.analysis.flags).toContain("handrail_light");
    expect(body.analysis.outcome).toBeUndefined();
    expect(checkGaitBody(body as never, PAD).ok).toBe(true);
  });

  it("reads a pad view at its fixed seconds; too little asks once to try again, then goes on kept (D-036 item 6)", () => {
    const run = controller({ ...PAD, views: { ...PAD.views, walking_pad: [PAD.views.walking_pad[0]] } });
    run.ctl.confirm(run.t);
    run.ctl.chooseMode("walking_pad", run.t);
    tapTo(run, "stand");
    const w = walk({ ...spec("pad-side-right"), durationSec: 70 });
    const hidden = (frames: GaitFrame[]) =>
      frames.map((f) => ({
        ...f,
        lm: f.lm.map((q, i) => ([27, 29, 31].includes(i) ? { ...q, visibility: 0.2 } : q)),
      }));
    record(run, { standing: w.standing, frames: hidden(w.frames) });
    expect(run.ctl.current).toEqual({ id: "retry", rec: "pad_side_a" });
    expect(run.lines.map((l) => l.line)).toContain("gait_quality_retry");
    // The fixed 30 s, never raised.
    expect(run.ctl.diagnostics()[0].seconds).toBeLessThanOrEqual(30.1);
    // Try once more: the person keeps walking, the recording starts again.
    expect(run.ctl.retry(true, run.t)).toBe(true);
    expect(run.ctl.current).toEqual({ id: "walk", rec: "pad_side_a" });
    expect(run.ctl.live()!.seconds).toBe(0);
    play(run, camera(hidden(w.frames).slice(0, 1000), run.t + 40));
    run.ctl.tick(run.t + 300);
    // The second try: no third, the walk goes on with the view kept.
    expect(run.ctl.current).toEqual({ id: "pad_stop", rec: "pad_side_a" });
  });

  it("measures the static single leg stance on each leg", () => {
    const run = controller({
      ...BASE,
      staticStance: true,
      views: { overground: ["side"], walking_pad: [] },
    });
    tapTo(run, "place");
    run.ctl.confirm(run.t);
    record(run, walk(spec("overground-side")));
    expect(run.ctl.current.id).toBe("stance_place");
    run.ctl.confirm(run.t);
    expect(run.ctl.current.id).toBe("stance");
    // Standing on both feet, then each leg for its 10 s (the walker's standing frames held still).
    const still = walk(spec("pad-front")).standing;
    const hold = (ms: number) => {
      const frames: Frame[] = [];
      for (let t = 0; t < ms; t += 33) {
        const f = still[Math.min(still.length - 1, Math.floor((t / 33) % still.length))];
        frames.push({ t: run.t + 40 + t, lm: f.lm, poses: [f.lm], aspect: f.aspect });
      }
      play(run, frames);
    };
    hold(3200);
    expect(run.ctl.stanceNow(run.t).phase).toBe("leg");
    expect(run.ctl.stanceNow(run.t).side).toBe("right");
    hold(10_200);
    expect(run.ctl.stanceNow(run.t).phase).toBe("switch");
    run.t += CAPTURE_LIMITS.stanceSwitchMs + 50;
    run.ctl.tick(run.t);
    expect(run.ctl.stanceNow(run.t).side).toBe("left");
    hold(500);
    expect(run.ctl.stanceLegDone(run.t)).toBe(true);
    expect(run.ctl.current.id).toBe("saving");
    const body = run.ctl.body()!;
    expect(body.analysis.staticStance.map((s) => s.side)).toEqual(["right", "left"]);
    expect(checkGaitBody(body as never, { ...BASE, staticStance: true }).ok).toBe(true);
  });
});

/* ---------------------------------------------------------- pain and stop */

/** A controller on its first overground walk, a few seconds in. */
function walking(painBefore: number | null = null): Run {
  const run = controller({ ...BASE, views: { overground: ["side"], walking_pad: [] } }, { painBefore });
  tapTo(run, "place");
  run.ctl.confirm(run.t);
  const w = walk(spec("overground-side"));
  play(run, camera(w.standing, run.t + 40));
  play(run, camera(w.frames.slice(0, 150), run.t + 40));
  expect(run.ctl.current.id).toBe("walk");
  return run;
}

describe("pain during the walk (C-15, the 2.11 gait row)", () => {
  it("ends the recording on any mark_pain and asks for a tap to walk again below the rule", () => {
    const run = walking(3);
    const r = run.ctl.handleTool("mark_pain", { level: 4 });
    expect(r).toEqual({ accepted: true, say: "pain_ok", data: { action: "recording_ended" } });
    expect(run.ctl.current).toEqual({ id: "walk_again", rec: "overground_side" });
    expect(run.ctl.step()).toEqual({ kind: "confirm", finished: false });
    expect(run.ctl.walkPain).toEqual([{ side: null, level: 4 }]);
    // Without the screen's buttons the coach presses nothing (the walk registers walk again, D-036
    // item 2, and the answer guard takes it only on the person's words).
    expect(run.ctl.handleTool("next_step", { intent: "ready" })).toMatchObject({
      accepted: false,
      reason: "not_allowed",
      say: "tap_to_confirm",
    });
    expect(run.ctl.confirm(run.t)).toBe(true);
    expect(run.ctl.current).toEqual({ id: "walk", rec: "overground_side" });
    // A pain report between recordings keeps the step.
    run.ctl.confirm(run.t);
  });

  it("ends the test pain_limited at 6, at a rise of 2 over the score before, or a sharp pain", () => {
    for (const [before, level, sharp] of [
      [0, 6, false],
      [3, 5, false],
      [null, 2, false],
      [4, 4, true],
    ] as const) {
      const run = walking(before);
      const r = run.ctl.handleTool("mark_pain", { level, ...(sharp ? { sharp } : {}) });
      expect(r).toEqual({ accepted: true, say: "pain_stop", data: { action: "stop_test" } });
      expect(run.ctl.outcome).toBe("pain_limited");
      expect(run.ctl.current.id).toBe("pain_stop");
      expect(run.ctl.step().kind).toBe("safety");
      expect(run.events.at(-1)).toMatchObject({ p: 0, type: "safety_stop", reason: "pain_stop" });
      expect(run.lines.at(-1)).toEqual({ line: "gait_pain_limited", severity: "safety" });
      // The completed clean cycles are kept: the body holds the walk so far, with the pain.
      expect(run.ctl.anythingRecorded).toBe(true);
      expect(run.ctl.body()!.analysis.walkPain).toEqual([{ side: null, level }]);
      // D-030 C4-5: the stored walk keeps why it ended.
      expect(run.ctl.body()!.analysis.outcome).toBe("pain_limited");
      // Nothing resumes after a safety stop.
      expect(run.ctl.handleTool("resume", {})).toMatchObject({ accepted: false, reason: "safety_stop" });
    }
  });

  it("keeps the walk going below the rule when the pain comes between recordings", () => {
    const run = controller(BASE, { painBefore: 2 });
    tapTo(run, "clear_path");
    expect(run.ctl.handleTool("mark_pain", { level: 3 })).toEqual({
      accepted: true,
      say: "pain_ok",
      data: { action: "continue" },
    });
    expect(run.ctl.current.id).toBe("clear_path");
  });

  it("STOP ends the recording and opens the stop list; on the pad the stop line asks to hold the support", () => {
    const run = walking();
    run.ctl.requestStop(run.t);
    expect(run.ctl.stopList).toEqual({ preselect: null });
    expect(run.ctl.step().kind).toBe("safety");
    expect(run.events.at(-1)).toMatchObject({ p: 0, type: "safety_stop", reason: "user_stop" });
    expect(run.ctl.body()!.analysis.outcome).toBe("stopped");
    const pad = controller(PAD);
    pad.ctl.confirm(pad.t);
    pad.ctl.chooseMode("walking_pad", pad.t);
    tapTo(pad, "stand");
    play(pad, camera(walk(spec("pad-side-right")).standing, pad.t + 40));
    pad.ctl.requestStop(pad.t);
    expect(pad.lines.at(-1)).toEqual({ line: "gait_pad_stop", severity: "safety" });
  });
});

/* ------------------------------------------------------------ the coach */

describe("the coach's tools on the gait steps (2.11 host table, C-16)", () => {
  it("presses the setup's Start and Ready (D-036 item 2), never a question, the pad's checklist or a timer", () => {
    const run = controller(PAD);
    show(run);
    expect(run.ctl.handleTool("next_step", { intent: "start" })).toEqual({
      accepted: true,
      say: "starting",
      data: { pressed: "start" },
    });
    expect(run.ctl.current.id).toBe("mode");
    show(run);
    expect(run.ctl.handleTool("next_step", { intent: "next" })).toMatchObject({
      accepted: false,
      say: "tap_to_confirm",
    });
    run.ctl.chooseMode("walking_pad", run.t);
    run.ctl.setGear({ shoes: true, brace: null }, run.t);
    // The pad safety checklist is the person's or the helper's tap.
    expect(run.ctl.current.id).toBe("pad_check");
    show(run);
    expect(run.ctl.handleTool("next_step", { intent: "ready" })).toEqual({
      accepted: false,
      reason: "not_allowed",
      say: "tap_to_confirm",
    });
    expect(run.ctl.current.id).toBe("pad_check");
    run.ctl.confirm(run.t);
    // The phone's placement and the person on the stopped belt: Ready on their words.
    for (const id of ["place", "pad_on"] as const) {
      expect(run.ctl.current.id).toBe(id);
      show(run);
      expect(run.ctl.handleTool("next_step", { intent: "ready" })).toMatchObject({ accepted: true });
    }
    play(run, camera(walk(spec("pad-side-right")).standing, run.t + 40));
    expect(run.ctl.current.id).toBe("pad_start");
    show(run);
    expect(run.ctl.handleTool("next_step", { intent: "start" })).toMatchObject({ accepted: true });
    expect(run.ctl.current.id).toBe("pad_warm_up");
    expect(run.ctl.step().kind).toBe("timer");
    show(run);
    expect(run.ctl.handleTool("next_step", { intent: "next" })).toMatchObject({
      accepted: false,
      reason: "not_allowed",
    });
  });

  it("pauses an active or timer step; a screen pause resumes only from the screen", () => {
    const run = walking();
    expect(run.ctl.handleTool("pause", {})).toEqual({ accepted: true });
    expect(run.ctl.pausedBy).toBe("coach");
    expect(run.ctl.handleTool("pause", {})).toMatchObject({ accepted: false, reason: "not_allowed" });
    expect(run.ctl.handleTool("resume", {})).toEqual({ accepted: true });
    run.ctl.pause("screen", run.t);
    expect(run.ctl.handleTool("resume", {})).toMatchObject({ accepted: false, reason: "paused_on_screen" });
    expect(run.ctl.resume("screen", run.t)).toEqual({ accepted: true });
    // A confirm step cannot be paused.
    const c = controller(BASE);
    tapTo(c, "clear_path");
    expect(c.ctl.handleTool("pause", {})).toMatchObject({ accepted: false, reason: "not_allowed" });
  });

  it("opens the stop list with the coach's reason, the emergency options first for chest pain", () => {
    const run = walking();
    expect(run.ctl.handleTool("stop", { reason: "chest" })).toEqual({
      accepted: true,
      say: "tap_to_confirm",
      data: { reason: "chest", emergencyFirst: true },
    });
    expect(run.ctl.stopList).toEqual({ preselect: "chest" });
    expect(run.ctl.handleTool("stop", { reason: "tired" })).toMatchObject({
      data: { emergencyFirst: false },
    });
    expect(run.ctl.stopList).toEqual({ preselect: "tired" });
  });

  it("repeats the step's instructions and keeps a short state line", () => {
    const run = walking();
    run.ctl.instructions = () => "Walk past the phone.";
    expect(run.ctl.handleTool("repeat_instructions", {})).toEqual({
      accepted: true,
      data: { text: "Walk past the phone." },
    });
    expect(run.ctl.snapshot()).toMatch(
      /^gait step=walk mode=overground recording=overground_side passes=\d\/4 cycles=0\/0$/,
    );
    expect(
      run.ctl.handleTool("answer_can_move", { movement: "knee_flexion", side: "right", canMove: true }),
    ).toEqual({
      accepted: false,
      reason: "not_in_block",
    });
  });

  it("says the phone moves to the pad's other side while the belt is stopped (D-030 C4-3)", () => {
    const run = controller(PAD);
    run.ctl.confirm(run.t);
    run.ctl.chooseMode("walking_pad", run.t);
    tapTo(run, "stand");
    expect(run.lines.map((l) => l.line)).not.toContain("gait_pad_other_side");
    record(run, walk({ ...spec("pad-side-right"), durationSec: 33 }));
    expect(run.ctl.current).toEqual({ id: "pad_stop", rec: "pad_side_a" });
    run.lines.length = 0;
    run.ctl.confirm(run.t);
    expect(run.ctl.current).toEqual({ id: "place", rec: "pad_side_b" });
    expect(run.lines.map((l) => l.line)).toEqual(["gait_pad_other_side"]);
    // The line itself matches the flow: the belt stops for the move, then starts again.
    expect(setupLine("pad_other_side", "en")).toMatch(/while the belt is stopped/);
    expect(setupLine("pad_other_side", "en")).not.toMatch(/keep walking/i);
    expect(setupLine("pad_other_side", "ar")).toContain("والجهاز متوقف");
  });

  it("says the setup lines with the voice pack unless the live coach speaks for the app", () => {
    const run = controller(BASE);
    tapTo(run, "clear_path");
    expect(run.lines.map((l) => l.line)).toEqual(["gait_stop_any_time", "gait_clear_path"]);
    // The live coach gives the instructions in its own words; the voice pack keeps the safety lines.
    const live = controller(BASE);
    live.ctl.coachLive = true;
    live.lines.length = 0;
    tapTo(live, "clear_path");
    expect(live.lines).toEqual([]);
  });
});

/* ------------------------------------------------------------- the setup */

describe("the walk's setup", () => {
  it("records the aid, the height, the brace and the shoes as captured", () => {
    const run = controller(BASE, {
      intake: {
        walking: { status: "with_aid", aid: "cane" },
        heightCm: 168,
        regions: [
          {
            region: "knee",
            side: "left",
            problems: ["limb_loss"],
            limbLoss: { level: "below_knee" },
          } as never,
        ],
      },
    });
    run.ctl.confirm(run.t);
    run.ctl.setGear({ shoes: false, brace: { kind: "afo", side: "right" } }, run.t);
    expect(run.ctl.setup()).toEqual({
      mode: "overground",
      aid: "cane",
      orthosis: { right: "afo" },
      prosthesis: "left",
      shoes: false,
      heightCm: 168,
      padSpeedKmh: null,
      padCorrection: null,
      handrail: null,
      familiarised: null,
    });
  });

  it("takes the pad speed in km/h or mph within the route's bounds", () => {
    const run = controller({ ...PAD, views: { ...PAD.views, walking_pad: [] } });
    run.ctl.confirm(run.t);
    run.ctl.chooseMode("walking_pad", run.t);
    tapTo(run, "pad_details");
    expect(run.ctl.setPadDetails(7, "kmh", "none", run.t)).toBe(false);
    expect(run.ctl.setPadDetails(2, "mph", "firm", run.t)).toBe(true);
    expect(run.ctl.padSpeedKmh).toBe(3.2);
  });
});
