/**
 * Step B3 (product v7 contract C-16, C-17 and the 2.11 host table): the RomController as the CoachHost
 * of the range blocks. Every tool against the step kinds and runner phases it meets: the coach answers
 * only the question asked (D-038 item 1: there is no maximum or cause question, the coach's
 * keep_reaching gives a few more seconds), presses only the screen's own Ready, Next or Try again (D-036 item 2) and
 * never a question, a timer or a safety step, resumes only its own pause and never after a safety
 * stop, and every call is applied at once and final. The tool results carry the say keys the coach's instruction explains (D-8).
 */
import { describe, expect, it } from "vitest";
import { RomController } from "../../src/features/focus/romController";
import { romScreenActions } from "../../src/features/focus/coachActions";
import { buildRomProtocol, type RomProtocol } from "../../src/medical/rom-protocol";
import { entry, intake, today } from "./a-fixtures";
import { runBlock, saves } from "./b-shell-driver";

const KNEE = intake({ regions: [entry("knee", "right", ["stiffness"])] });
const WEAK_KNEE = intake({ regions: [entry("knee", "right", ["weakness"])] });

function setup(h = KNEE, painByRegion = {}): RomController {
  const protocol: RomProtocol = buildRomProtocol({ intake: h, setting: "booth", today: today() });
  const ctl = new RomController({ protocol, painByRegion, intake: h, lang: "en", restSec: 1 });
  ctl.startBlock("lying", 0);
  return ctl;
}

/** Drives the block with the simulated person until `until` holds. */
function reach(ctl: RomController, until: (c: RomController) => boolean) {
  return runBlock(ctl, { until }, 300);
}

/** A scored attempt with its hold in hand (D-038 item 1: recorded a few seconds later). */
const holding = (c: RomController) => c.phase === "attempt" && c.attempt.index === 1 && c.hold !== null;

const KNEE_BEND = { movement: "knee_flexion" as const, side: "right" as const };

/** The shell's registration of the range step's buttons (FocusApp's useScreenActions), at time `t`. */
function show(ctl: RomController, t = 0, blockWaiting = false): void {
  const e = romScreenActions(ctl, { clock: () => t, blockWaiting });
  if (e) ctl.actions.show(e.key, () => e.actions, e.alive);
}

describe("next_step (D-036 item 2: the coach presses the screen's button on the person's words)", () => {
  it("presses the block card's and the setup card's Ready, which starts the movement", () => {
    const ctl = setup();
    expect(ctl.step().kind).toBe("confirm");
    // Nothing on the screen yet: nothing to press.
    expect(ctl.handleTool("next_step", { intent: "ready" })).toEqual({
      accepted: false,
      reason: "not_allowed",
      say: "tap_to_confirm",
    });
    show(ctl, 100);
    expect(ctl.handleTool("next_step", { intent: "ready" })).toEqual({
      accepted: true,
      say: "starting",
      data: { pressed: "ready" },
    });
    expect(ctl.current.kind).toBe("setup");
    show(ctl, 200);
    for (const intent of ["start"] as const)
      expect(ctl.handleTool("next_step", { intent })).toMatchObject({ accepted: true, say: "starting" });
    expect(ctl.current.kind).toBe("measure");
  });

  it("waits with the block card's Ready while the camera's model probe runs (one_moment)", () => {
    const ctl = setup();
    show(ctl, 100, true);
    expect(ctl.handleTool("next_step", { intent: "ready" })).toEqual({
      accepted: false,
      reason: "wrong_phase",
      say: "one_moment",
    });
    expect(ctl.current.kind).toBe("block");
    show(ctl, 100, false);
    expect(ctl.handleTool("next_step", { intent: "ready" })).toMatchObject({ accepted: true });
  });

  it("never presses on a timer (the rest) or a measurement, a hold in hand included", () => {
    const ctl = setup();
    reach(ctl, (c) => c.phase === "practice");
    show(ctl);
    expect(ctl.actions.list()).toEqual([]);
    expect(ctl.handleTool("next_step", { intent: "next" })).toMatchObject({
      accepted: false,
      reason: "not_allowed",
    });
    reach(ctl, (c) => c.phase === "rest");
    show(ctl);
    expect(ctl.handleTool("next_step", { intent: "continue" })).toMatchObject({ accepted: false });
    reach(ctl, holding);
    show(ctl);
    expect(ctl.step().kind).toBe("active");
    expect(ctl.handleTool("next_step", { intent: "ready" })).toMatchObject({ accepted: false });
    expect(ctl.phase).toBe("attempt");
  });

  it("presses a result card's Next, and its Try again while one more try is offered", () => {
    const ctl = setup();
    runBlock(ctl, { until: (c) => c.current.kind === "result" }, 300);
    expect(ctl.step()).toEqual({ kind: "info", finished: false });
    show(ctl, 5000);
    if (ctl.canTryAgain) {
      expect(ctl.handleTool("next_step", { intent: "again" })).toEqual({
        accepted: true,
        say: "trying_again",
        data: { pressed: "again" },
      });
      expect(ctl.current.kind).toBe("measure");
      runBlock(ctl, { until: (c) => c.current.kind === "result" }, 300);
      show(ctl, 9000);
      // Never a third try.
      expect(ctl.canTryAgain).toBe(false);
      expect(ctl.handleTool("next_step", { intent: "again" })).toMatchObject({ accepted: false });
    }
    expect(ctl.handleTool("next_step", { intent: "next" })).toEqual({
      accepted: true,
      say: "next_one",
      data: { pressed: "next" },
    });
    expect(ctl.current.kind).toBe("setup");
  });

  it("presses nothing once the app moved past the screen (a second call after the first press)", () => {
    const ctl = setup();
    show(ctl, 100);
    expect(ctl.handleTool("next_step", { intent: "ready" })).toMatchObject({ accepted: true });
    // The setup card shows, but the page has not registered its buttons yet: the block's are stale.
    expect(ctl.current.kind).toBe("setup");
    expect(ctl.handleTool("next_step", { intent: "ready" })).toMatchObject({ accepted: false });
    expect(ctl.current.kind).toBe("setup");
  });

  it("is refused on a safety step: a pain stop and the stop list, buttons or not", () => {
    const ctl = setup();
    reach(ctl, (c) => c.phase === "attempt");
    expect(ctl.handleTool("mark_pain", { level: 7 })).toMatchObject({
      accepted: true,
      data: { action: "stop_movement" },
    });
    expect(ctl.current.kind).toBe("pain_stop");
    expect(ctl.step().kind).toBe("safety");
    show(ctl);
    expect(ctl.handleTool("next_step", { intent: "continue" })).toEqual({
      accepted: false,
      reason: "safety_stop",
      say: "tap_to_confirm",
    });
    expect(ctl.current.kind).toBe("pain_stop");
    ctl.acknowledge(1);
    expect(ctl.current.kind).toBe("result");
    show(ctl, 1);
    ctl.requestStop(2);
    expect(ctl.step().kind).toBe("safety");
    expect(ctl.handleTool("next_step", { intent: "next" })).toEqual({
      accepted: false,
      reason: "safety_stop",
      say: "tap_to_confirm",
    });
    expect(ctl.current.kind).toBe("result");
  });
});

describe("no maximum question (D-038 item 1): the hold in hand and keep_reaching", () => {
  it("has no confirm_max: the hold is recorded on its own, the coach told «hold there» then «done»", () => {
    const ctl = setup();
    const run = reach(ctl, (c) => c.current.kind === "result");
    expect(ctl.handleTool("confirm_max" as never, { ...KNEE_BEND, answer: "yes" } as never)).toMatchObject({
      accepted: false,
    });
    const s = ctl.current;
    if (s.kind !== "result") throw new Error("no result");
    expect(s.result.attempts[0]).toMatchObject({ outcome: "valid", answer: null, answerSource: null });
    const says = run.events.flatMap((e) =>
      e.kind === "bridge" && e.event.type === "say" ? [e.event.key] : [],
    );
    expect(says).toEqual(expect.arrayContaining(["hold", "done"]));
    expect(says.indexOf("done")).toBeGreaterThan(says.indexOf("hold"));
  });

  it("keep_reaching on «I can do more» or «wait» while the hold is in hand: keep_going, a few more seconds", () => {
    const ctl = setup();
    const run = reach(ctl, holding);
    const at = run.t;
    expect(ctl.handleTool("keep_reaching", {})).toEqual({ accepted: true, say: "keep_going" });
    // The hold in hand waits: still not recorded 4 s on (its own 3 s are over).
    runBlock(ctl, { until: (c) => c.current.kind === "result" }, 4, at);
    expect(ctl.current.kind).toBe("measure");
    expect(ctl.hold).not.toBeNull();
    runBlock(ctl, { until: (c) => c.current.kind === "result" }, 10, at + 4000);
    expect(ctl.current.kind).toBe("result");
  });

  it("keep reaching after a pain report is refused (after_pain)", () => {
    const ctl = setup(KNEE, { knee: 3 });
    reach(ctl, holding);
    expect(ctl.handleTool("mark_pain", { level: 4 })).toMatchObject({ accepted: true });
    expect(ctl.handleTool("keep_reaching", {})).toEqual({ accepted: false, reason: "after_pain" });
  });
});

describe("answer_can_move (the cause question and set_limit_cause are gone, D-038 item 1)", () => {
  it("never asks the can move question of a weak joint (D-034 item 4): answer_can_move has no question", () => {
    const ctl = setup(WEAK_KNEE);
    reach(ctl, (c) => c.phase === "calibrating");
    expect(ctl.phase).toBe("calibrating");
    expect(ctl.handleTool("answer_can_move", { ...KNEE_BEND, canMove: true })).toEqual({
      accepted: false,
      reason: "wrong_phase",
    });
  });

  it("refuses can move outside its question; set_limit_cause is no tool of the range blocks", () => {
    const ctl = setup();
    reach(ctl, (c) => c.phase === "attempt");
    expect(ctl.handleTool("answer_can_move", { ...KNEE_BEND, canMove: true })).toEqual({
      accepted: false,
      reason: "wrong_phase",
    });
    expect(ctl.handleTool("set_limit_cause" as never, { cause: "tight" } as never)).toMatchObject({
      accepted: false,
    });
  });

  it("a value short of normal is saved with no cause and no question", () => {
    const ctl = setup();
    runBlock(ctl, { target: () => 100, until: (c) => c.current.kind === "result" }, 300);
    expect(ctl.current.kind).toBe("result");
    ctl.next(1e6);
    const [saved] = saves(ctl.drain()).slice(-1);
    expect(saved.result).toMatchObject({ status: "measured", cause: null });
  });
});

describe("mark_pain (C-15: one pain stop rule)", () => {
  it("below the rule the movement goes on (continue)", () => {
    const ctl = setup(KNEE, { knee: 3 });
    reach(ctl, (c) => c.phase === "attempt");
    expect(ctl.handleTool("mark_pain", { level: 4 })).toEqual({
      accepted: true,
      data: { action: "continue" },
    });
    expect(ctl.current.kind).toBe("measure");
  });

  it("5 rising from 2 stops the movement (stop_movement, pain_stop), and the coach cannot resume", () => {
    const ctl = setup(KNEE, { knee: 2 });
    reach(ctl, (c) => c.phase === "attempt");
    expect(ctl.handleTool("mark_pain", { level: 5 })).toEqual({
      accepted: true,
      say: "pain_stop",
      data: { action: "stop_movement" },
    });
    expect(ctl.current.kind).toBe("pain_stop");
    expect(ctl.handleTool("resume", {})).toEqual({ accepted: false, reason: "safety_stop" });
    expect(ctl.handleTool("keep_reaching", {})).toMatchObject({ accepted: false });
  });

  it("a sharp pain stops at any level", () => {
    const ctl = setup(KNEE, { knee: 1 });
    reach(ctl, (c) => c.phase === "attempt");
    expect(ctl.handleTool("mark_pain", { level: 1, sharp: true })).toMatchObject({
      data: { action: "stop_movement" },
    });
  });

  it("answers the same joint re-ask", () => {
    const ctl = setup();
    reach(ctl, (c) => c.phase === "attempt");
    ctl.handleTool("mark_pain", { level: 8 });
    ctl.acknowledge(1);
    ctl.next(2);
    expect(ctl.current.kind).toBe("reask");
    expect(ctl.step().kind).toBe("question");
    expect(ctl.handleTool("mark_pain", { level: 2 })).toEqual({
      accepted: true,
      say: "lets_begin",
      data: { action: "continue" },
    });
    expect(ctl.current.kind).toBe("setup");
  });

  it("a sharp pain at the same joint re-ask skips the region like a score of 6 (C-15)", () => {
    const ctl = setup();
    reach(ctl, (c) => c.phase === "attempt");
    ctl.handleTool("mark_pain", { level: 8 });
    ctl.acknowledge(1);
    ctl.next(2);
    expect(ctl.current.kind).toBe("reask");
    expect(ctl.handleTool("mark_pain", { level: 2, sharp: true })).toEqual({
      accepted: true,
      say: "pain_stop",
      data: { action: "stop_movement" },
    });
    const straight = saves(ctl.drain()).find((e) => e.item.movementId === "knee_extension")!;
    expect(straight.result.reason).toBe("pain_today");
  });

  it("between movements, a pain at the rule makes the joint's next movement ask first", () => {
    const ctl = setup();
    ctl.ready(0);
    expect(ctl.current.kind).toBe("setup");
    expect(ctl.handleTool("mark_pain", { level: 6 })).toEqual({
      accepted: true,
      say: "pain_stop",
      data: { action: "stop_movement" },
    });
    expect(ctl.current.kind).toBe("reask");
  });

  it("refuses a level outside 0 to 10 or not whole", () => {
    const ctl = setup();
    expect(ctl.handleTool("mark_pain", { level: 11 })).toEqual({ accepted: false, reason: "invalid_args" });
    expect(ctl.handleTool("mark_pain", { level: 2.5 })).toEqual({ accepted: false, reason: "invalid_args" });
  });
});

describe("pause and resume (C-16: the coach resumes only its own pause)", () => {
  it("pauses a measurement and resumes it", () => {
    const ctl = setup();
    reach(ctl, (c) => c.phase === "attempt");
    expect(ctl.handleTool("pause", {})).toEqual({ accepted: true });
    expect(ctl.paused).toBe("coach");
    expect(ctl.phase).toBe("paused");
    expect(ctl.handleTool("resume", {})).toEqual({ accepted: true });
    expect(ctl.paused).toBeNull();
    expect(ctl.phase).toBe("attempt");
  });

  it("refuses to resume a pause made on the screen (paused_on_screen); the screen resumes it", () => {
    const ctl = setup();
    reach(ctl, (c) => c.phase === "attempt");
    expect(ctl.pause("screen", 1)).toBe(true);
    expect(ctl.handleTool("resume", {})).toEqual({ accepted: false, reason: "paused_on_screen" });
    expect(ctl.resume("screen", 2)).toEqual({ accepted: true });
  });

  it("pauses the sit before stand minute, keeping its time", () => {
    const ctl = setup();
    const run = runBlock(ctl, { until: (c) => c.current.kind === "sit" }, 400);
    const s = ctl.current;
    if (s.kind !== "sit") throw new Error("no sit");
    ctl.tick(run.t + 10_000);
    expect(ctl.handleTool("pause", {})).toEqual({ accepted: true });
    ctl.tick(s.until + 30_000);
    expect(ctl.current.kind).toBe("sit");
    ctl.resume("coach", s.until + 30_000);
    const after = ctl.current;
    if (after.kind !== "sit") throw new Error("no sit after resume");
    expect(after.until - (s.until + 30_000)).toBeCloseTo(s.until - (run.t + 10_000), 6);
  });

  it("refuses a pause on a confirmation (not_allowed)", () => {
    const ctl = setup();
    expect(ctl.handleTool("pause", {})).toEqual({ accepted: false, reason: "not_allowed" });
  });

  it("refuses a second pause and a resume with no pause (not_allowed, as D's host rules)", () => {
    const ctl = setup();
    reach(ctl, (c) => c.phase === "attempt");
    expect(ctl.handleTool("resume", {})).toEqual({ accepted: false, reason: "not_allowed" });
    expect(ctl.handleTool("pause", {})).toEqual({ accepted: true });
    expect(ctl.handleTool("pause", {})).toEqual({ accepted: false, reason: "not_allowed" });
  });

  it("resumes nothing after a safety stop", () => {
    const ctl = setup();
    reach(ctl, (c) => c.phase === "attempt");
    ctl.handleTool("pause", {});
    ctl.requestStop(5);
    expect(ctl.handleTool("resume", {})).toEqual({ accepted: false, reason: "safety_stop" });
  });
});

describe("stop and repeat_instructions", () => {
  it("stop opens the stop list with the reason preselected; the person confirms (safety)", () => {
    const ctl = setup();
    reach(ctl, (c) => c.phase === "attempt");
    expect(ctl.handleTool("stop", { reason: "faint" })).toEqual({
      accepted: true,
      say: "tap_to_confirm",
      data: { preselected: "faint" },
    });
    expect(ctl.stopList?.preselect).toBe("faint");
    expect(ctl.step().kind).toBe("safety");
    // Nothing more is done for the stopped movement.
    expect(ctl.handleTool("keep_reaching", {})).toEqual({
      accepted: false,
      reason: "safety_stop",
    });
  });

  it("repeats the instructions of the movement shown, in the session language", () => {
    const ctl = setup();
    ctl.ready(0);
    const r = ctl.handleTool("repeat_instructions", {});
    expect(r.accepted).toBe(true);
    expect(String(r.data?.text)).toContain("Slide your right heel along the bed");
  });

  it("shows the instruction card during a measurement, until the step changes", () => {
    const ctl = setup();
    reach(ctl, (c) => c.phase === "attempt");
    expect(ctl.instructionsOpen).toBe(false);
    expect(ctl.handleTool("repeat_instructions", {})).toMatchObject({ accepted: true });
    expect(ctl.instructionsOpen).toBe(true);
    // The screen closes it, or the next step does.
    ctl.showInstructions(false);
    expect(ctl.instructionsOpen).toBe(false);
    ctl.showInstructions(true);
    runBlock(ctl, { until: (c) => c.current.kind === "result" }, 300);
    expect(ctl.instructionsOpen).toBe(false);
  });

  it("never throws, and gives a short state line for a new session", () => {
    const ctl = setup();
    expect(() => ctl.handleTool("mark_pain", null as never)).not.toThrow();
    expect(ctl.snapshot()).toMatch(/^block=lying step=block/);
    reach(ctl, (c) => c.phase === "attempt");
    expect(ctl.snapshot()).toMatch(/step=measure movement=knee_flexion side=right phase=attempt attempt=\d/);
    // No name, age, sex or condition: ids and steps only.
    expect(ctl.snapshot()).not.toMatch(/male|female|stroke|\d\d years/);
  });
});

describe("every tool at every step kind of the range blocks (2.11 host table, C-16)", () => {
  type Tool = Parameters<RomController["handleTool"]>[0];
  const TOOLS: [Tool, Record<string, unknown>][] = [
    ["answer_can_move", { ...KNEE_BEND, canMove: true }],
    ["keep_reaching", {}],
    ["mark_pain", { level: 0 }],
    ["pause", {}],
    ["resume", {}],
    ["stop", { reason: "tired" }],
    ["next_step", { intent: "next" }],
    ["repeat_instructions", {}],
  ];
  /** Each state: how to reach it, its C-16 kind, and the tools the host table accepts there. */
  const STATES: { name: string; kind: string; reach: () => RomController; accepts: Tool[] }[] = [
    { name: "the block card", kind: "confirm", reach: () => setup(), accepts: ["next_step"] },
    {
      name: "the setup card",
      kind: "confirm",
      reach: () => {
        const c = setup();
        c.ready(0);
        return c;
      },
      accepts: ["next_step"],
    },
    {
      name: "the start pose",
      kind: "active",
      reach: () => {
        const c = setup();
        reach(c, (x) => x.phase === "calibrating");
        return c;
      },
      accepts: ["pause"],
    },
    {
      name: "the practice",
      kind: "active",
      reach: () => {
        const c = setup();
        reach(c, (x) => x.phase === "practice");
        return c;
      },
      accepts: ["pause", "keep_reaching"],
    },
    {
      name: "an attempt",
      kind: "active",
      reach: () => {
        const c = setup();
        reach(c, (x) => x.phase === "attempt");
        return c;
      },
      accepts: ["pause", "keep_reaching"],
    },
    {
      name: "a hold in hand",
      kind: "active",
      reach: () => {
        const c = setup();
        reach(c, holding);
        return c;
      },
      accepts: ["keep_reaching", "pause"],
    },
    {
      name: "the rest after the practice",
      kind: "timer",
      reach: () => {
        const c = setup();
        reach(c, (x) => x.phase === "rest");
        return c;
      },
      accepts: ["pause"],
    },
    {
      name: "a pause made on the screen",
      kind: "active",
      reach: () => {
        const c = setup();
        const run = reach(c, (x) => x.phase === "attempt");
        c.pause("screen", run.t + 10);
        return c;
      },
      accepts: [],
    },
    {
      name: "a pain stop",
      kind: "safety",
      reach: () => {
        const c = setup();
        reach(c, (x) => x.phase === "attempt");
        c.handleTool("mark_pain", { level: 8 });
        return c;
      },
      accepts: [],
    },
    {
      name: "a result card",
      kind: "info",
      reach: () => {
        const c = setup();
        runBlock(c, { until: (x) => x.current.kind === "result" }, 300);
        return c;
      },
      accepts: ["next_step"],
    },
    {
      name: "the same joint re-ask",
      kind: "question",
      reach: () => {
        const c = setup();
        reach(c, (x) => x.phase === "attempt");
        c.handleTool("mark_pain", { level: 8 });
        c.acknowledge(1);
        c.next(2);
        return c;
      },
      accepts: [],
    },
    {
      name: "the stop list",
      kind: "safety",
      reach: () => {
        const c = setup();
        const run = reach(c, (x) => x.phase === "attempt");
        c.requestStop(run.t + 10);
        return c;
      },
      accepts: [],
    },
    {
      name: "the rest after a stop",
      kind: "timer",
      reach: () => {
        const c = setup();
        const run = reach(c, (x) => x.phase === "attempt");
        c.requestStop(run.t + 10);
        c.stopRouted({ endsCheck: false, afterRest: true }, run.t + 20);
        return c;
      },
      accepts: ["pause"],
    },
    {
      name: "the sit before stand minute",
      kind: "timer",
      reach: () => {
        const c = setup();
        runBlock(c, { until: (x) => x.current.kind === "sit" }, 400);
        return c;
      },
      accepts: ["pause"],
    },
  ];
  /** Accepted at every step (2.11: mark_pain at any step, stop always, repeat_instructions always). */
  const ALWAYS: Tool[] = ["mark_pain", "stop", "repeat_instructions"];

  for (const state of STATES)
    it(`${state.name} (${state.kind})`, () => {
      expect(state.reach().step().kind).toBe(state.kind);
      for (const [tool, args] of TOOLS) {
        const ctl = state.reach();
        // The shell shows the step's buttons the coach may press (D-036 item 2).
        show(ctl);
        const r = ctl.handleTool(tool, args as never);
        const want = ALWAYS.includes(tool) || state.accepts.includes(tool);
        expect(r.accepted, `${tool} at ${state.name}: ${JSON.stringify(r)}`).toBe(want);
        // A step with no button for the coach is the person's: the coach is told to ask for the tap.
        if (tool === "next_step" && !want)
          expect(r).toEqual({
            accepted: false,
            reason: state.kind === "safety" ? "safety_stop" : "not_allowed",
            say: "tap_to_confirm",
          });
        if (tool === "resume" && state.name === "a pause made on the screen")
          expect(r.reason).toBe("paused_on_screen");
        if (state.kind === "safety" && ["keep_reaching", "pause", "resume"].includes(tool))
          expect(r.reason).toBe("safety_stop");
      }
    });

  it("a coach's «no pain» (mark_pain 0) during an attempt does not make the value pain limited", () => {
    const ctl = setup();
    reach(ctl, (c) => c.phase === "attempt" && c.attempt.index === 1);
    expect(ctl.handleTool("mark_pain", { level: 0 })).toEqual({
      accepted: true,
      data: { action: "continue" },
    });
    runBlock(ctl, { until: (c) => c.current.kind === "result" }, 300);
    const s = ctl.current;
    expect(s.kind).toBe("result");
    if (s.kind !== "result") return;
    expect(s.result.painLimited).toBe(false);
    expect(s.result.attempts.every((a) => !a.painLimited)).toBe(true);
  });
});
