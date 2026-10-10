/**
 * Stream D, step D4: the tool executor (product v7 contract 2.11 tool call timing, C-16, C-17, D-022
 * item 2; 8.6). A valid call goes to the host the moment it arrives and its result is sent at once; a
 * cancellation after the host applied the call changes nothing and the coach is told what the app did
 * (tool_applied, P3); a cancellation for a call not handled yet drops it. The answer tools need the
 * person's own speech after the question (S0-2). Hosts: the reference range host of the harness, the
 * session host, and a host of the shared step kind rules for every block.
 */
import { describe, expect, it } from "vitest";
import { ToolExecutor } from "../../src/features/coach-agent/executor";
import { SessionHost, type SessionScreen } from "../../src/features/coach-agent/sessionHost";
import { AnswerGuard, TOOL_SETS } from "../../src/coach/tools";
import type {
  BridgeEvent,
  CoachBlock,
  CoachHost,
  CoachStepKind,
  ToolName,
  ToolResult,
} from "../../src/coach/types";
import { ControlHost, RefGaitHost, RefRomHost } from "./d-coach-harness";
import { GO_ON } from "../../src/coach/actions";

type Response = { id: string; name: string; response: ToolResult; scheduling?: string };

function setup(host: CoachHost) {
  const sent: Response[][] = [];
  const pushed: BridgeEvent[] = [];
  // As the session: a press needs the person's words while the host's screen now showed (D-036 item 2).
  const guard = new AnswerGuard(() => host.actions?.current ?? null);
  const ex = new ToolExecutor(
    host.block,
    () => host,
    (r) => sent.push(r),
    (e) => pushed.push(e),
    guard,
  );
  const results = () => sent.flat().map((r) => r.response);
  return { ex, sent, pushed, guard, results };
}

const canMoveAsk = (t: number): BridgeEvent => ({
  p: 1,
  type: "ask_can_move",
  movement: "shoulder_flexion",
  side: "right",
  t,
});
const canMoveCall = (canMove: boolean, id = "c1") => ({
  id,
  name: "answer_can_move",
  args: { movement: "shoulder_flexion", side: "right", canMove },
});

describe("an answer the person never gave (S0-2)", () => {
  it("is refused and nothing is recorded; the answer after the person spoke is taken", () => {
    const host = new RefRomHost();
    const s = setup(host);
    host.askCanMove();
    s.guard.heard("something earlier", 500);
    s.guard.question(canMoveAsk(1000));
    s.ex.handle([canMoveCall(true)], 1800);
    expect(s.results()).toEqual([{ accepted: false, reason: "no_answer_heard", say: "ask_and_wait" }]);
    expect(host.canMove).toEqual([]);
    expect(host.calls).toEqual([]);
    expect(s.ex.stats()).toEqual({ answer_can_move: { ok: 0, rejected: 1 } });
    s.guard.heard("إيه", 2200);
    s.ex.handle([canMoveCall(true, "c2")], 2500);
    expect(host.canMove).toEqual([{ value: true, via: "voice" }]);
  });
});

describe("keep_reaching (D-038 item 1: «I can do more», «wait»)", () => {
  it("is taken only on the person's words in the last 10 s, never on the model's own", () => {
    const host = new RefRomHost();
    const s = setup(host);
    s.ex.handle([{ id: "k1", name: "keep_reaching", args: {} }], 1000);
    expect(s.results()[0]).toEqual({ accepted: false, reason: "no_answer_heard", say: "ask_and_wait" });
    expect(host.calls).toEqual([]);
    s.guard.heard("أقدر أكثر", 2000);
    s.ex.handle([{ id: "k2", name: "keep_reaching", args: {} }], 2500);
    expect(s.results()[1]).toEqual({ accepted: true, say: "keep_going" });
    s.ex.handle([{ id: "k3", name: "keep_reaching", args: {} }], 2000 + 10_001);
    expect(s.results()[2]).toMatchObject({ accepted: false, reason: "no_answer_heard" });
  });

  it("has no maximum question or cause question to answer any more", () => {
    const s = setup(new RefRomHost());
    s.ex.handle(
      [
        {
          id: "x1",
          name: "confirm_max",
          args: { movement: "shoulder_flexion", side: "right", answer: "yes" },
        },
        { id: "x2", name: "set_limit_cause", args: { cause: "tight" } },
      ],
      100,
    );
    expect(s.results()).toEqual([
      { accepted: false, reason: "unknown_tool" },
      { accepted: false, reason: "unknown_tool" },
    ]);
  });
});

describe("the can move question", () => {
  const canMove = (v: boolean) => ({
    id: "m1",
    name: "answer_can_move",
    args: { movement: "shoulder_flexion", side: "right", canMove: v },
  });
  const ask: BridgeEvent = {
    p: 1,
    type: "ask_can_move",
    movement: "shoulder_flexion",
    side: "right",
    t: 500,
  };

  it("is answered by voice", () => {
    const host = new RefRomHost();
    const s = setup(host);
    host.askCanMove();
    s.guard.question(ask);
    s.guard.heard("إيه أقدر أحركه", 1500);
    s.ex.handle([canMove(true)], 1700);
    expect(s.results()).toEqual([{ accepted: true, say: "lets_begin" }]);
    expect(host.canMove).toEqual([{ value: true, via: "voice" }]);
  });

  it("is answered by button, and a spoken answer after it changes nothing", () => {
    const host = new RefRomHost();
    const s = setup(host);
    host.askCanMove();
    s.guard.question(ask);
    expect(host.buttonCanMove(false)).toBe(true);
    s.guard.heard("لا", 1500);
    s.ex.handle([canMove(true)], 1700);
    expect(s.results()).toEqual([{ accepted: false, reason: "wrong_phase" }]);
    expect(host.canMove).toEqual([{ value: false, via: "button" }]);
  });
});

describe("pain and stop (S0-2, C-15)", () => {
  it("refuses the coach's own score to its pain question: the speech before it answered the maximum question", () => {
    const host = new RefRomHost();
    const s = setup(host);
    s.guard.heard("أقدر أكثر بس يوجعني", 1_000);
    s.guard.question({ p: 1, type: "ask_pain", movement: "shoulder_flexion", side: "right", t: 2_000 });
    // 2.4 s after the question, nobody speaking: mark_pain(0) never reaches the host.
    s.ex.handle([{ id: "p1", name: "mark_pain", args: { level: 0 } }], 4_400);
    expect(s.results()[0]).toEqual({ accepted: false, reason: "no_answer_heard", say: "ask_and_wait" });
    // The person answers; the coach's call carries the person's score.
    s.guard.heard("ثلاثة", 5_000);
    s.ex.handle([{ id: "p2", name: "mark_pain", args: { level: 3 } }], 5_200);
    expect(s.results()[1]).toMatchObject({ accepted: true });
  });

  it("takes mark_pain only within 10 s of the person's speech, and stop always", () => {
    const host = new RefRomHost();
    const s = setup(host);
    s.ex.handle([{ id: "p1", name: "mark_pain", args: { level: 0 } }], 1000);
    expect(s.results()[0]).toEqual({ accepted: false, reason: "no_answer_heard", say: "ask_and_wait" });
    s.guard.heard("يوجعني، تقريبا خمسة", 2000);
    s.ex.handle([{ id: "p2", name: "mark_pain", args: { level: 5 } }], 12_000);
    expect(s.results()[1]).toEqual({ accepted: true, say: "pain_stop", data: { action: "stop_movement" } });
    s.ex.handle([{ id: "p3", name: "mark_pain", args: { level: 1 } }], 12_001);
    expect(s.results()[2]).toEqual({ accepted: false, reason: "no_answer_heard", say: "ask_and_wait" });
    s.ex.handle([{ id: "s1", name: "stop", args: { reason: "chest" } }], 30_000);
    expect(s.results()[3]).toEqual({ accepted: true, say: "tap_to_confirm" });
    expect(host.stopList).toEqual(["chest"]);
  });

  it("stops a range movement at 5 rising from 2", () => {
    const host = new RefRomHost();
    host.painBefore = 2;
    const s = setup(host);
    s.guard.heard("five", 100);
    s.ex.handle([{ id: "p1", name: "mark_pain", args: { level: 5, location: "shoulder" } }], 200);
    expect(s.results()[0].data).toEqual({ action: "stop_movement" });
    const calm = new RefRomHost();
    calm.painBefore = 3;
    const t = setup(calm);
    t.guard.heard("four", 100);
    t.ex.handle([{ id: "p1", name: "mark_pain", args: { level: 4 } }], 200);
    expect(t.results()[0].data).toEqual({ action: "continue" });
  });

  it("never lets keep_reaching through after pain", () => {
    const host = new RefRomHost();
    const s = setup(host);
    s.guard.heard("I can do more", 1000);
    s.ex.handle([{ id: "k1", name: "keep_reaching", args: {} }], 1300);
    expect(s.results()[0]).toEqual({ accepted: true, say: "keep_going" });
    s.ex.handle([{ id: "p1", name: "mark_pain", args: { level: 3 } }], 1400);
    s.ex.handle([{ id: "k2", name: "keep_reaching", args: {} }], 1500);
    expect(s.results()[2]).toEqual({ accepted: false, reason: "after_pain" });
  });
});

describe("pain and stop in a walk (the gait row of the host table, C-15)", () => {
  const pain = (id: string, level: number, more: { sharp?: boolean; location?: string } = {}) => ({
    id,
    name: "mark_pain",
    args: { level, ...more },
  });

  it("measures the rise from the named region's score today, else the highest leg, hip or back score, else 0", () => {
    const host = new RefGaitHost();
    host.painToday = { back_trunk: 4, hip: 1, shoulder: 7 };
    const s = setup(host);
    s.guard.heard("it hurts", 100);
    // No place named: the back's 4 (a shoulder score is not a leg, hip or back one), so 5 goes on.
    s.ex.handle([pain("p1", 5)], 200);
    expect(s.results()[0]).toEqual({ accepted: true, say: "pain_ok", data: { action: "continue" } });
    // The hip named: its 1, so 5 is a rise of 4 and ends the test.
    s.ex.handle([pain("p2", 5, { location: "hip" })], 300);
    expect(s.results()[1]).toEqual({ accepted: true, say: "pain_stop", data: { action: "stop_test" } });
    const fresh = new RefGaitHost();
    const t = setup(fresh);
    t.guard.heard("a little pain", 100);
    // Nothing today: 0, so 2 is a rise of 2.
    t.ex.handle([pain("p3", 2)], 200);
    expect(t.results()[0].data).toEqual({ action: "stop_test" });
    expect(fresh.outcome).toEqual({ label: "pain_limited", cleanCycles: 0 });
  });

  it("ends the recording on every spoken pain and stop, and the test at 6 or a sharp pain", () => {
    const host = new RefGaitHost();
    host.painToday = { knee: 3 };
    const s = setup(host);
    s.guard.heard("ركبتي توجعني شوي", 100);
    host.walk();
    host.cycle();
    host.cycle();
    // Below the rule: the walk ends and the screen asks for a tap to walk again.
    s.ex.handle([pain("p1", 4, { location: "knee" })], 200);
    expect(s.results()[0]).toEqual({ accepted: true, say: "pain_ok", data: { action: "recording_ended" } });
    expect(host.recording).toBe(false);
    expect(host.recordingsEnded).toEqual([2]);
    expect(host.step()).toEqual({ kind: "confirm", finished: false });
    host.walk();
    s.ex.handle([{ id: "s1", name: "stop", args: { reason: "tired" } }], 300);
    expect(host.recordingsEnded).toEqual([2, 2]);
    expect(host.stopList).toEqual([{ reason: "tired", emergencyFirst: false }]);
    for (const [id, args] of [
      ["p2", { level: 6 }],
      ["p3", { level: 1, sharp: true }],
    ] as const) {
      const walker = new RefGaitHost();
      walker.painToday = { knee: 5 };
      const w = setup(walker);
      w.guard.heard("آه", 100);
      walker.walk();
      walker.cycle();
      w.ex.handle([{ id, name: "mark_pain", args }], 200);
      expect(w.results()[0].data, id).toEqual({ action: "stop_test" });
      // The test ends labelled pain_limited, the completed clean cycles kept; nothing restarts it.
      expect(walker.outcome).toEqual({ label: "pain_limited", cleanCycles: 1 });
      expect(walker.step().kind).toBe("safety");
      w.ex.handle([{ id: "r", name: "resume", args: {} }], 300);
      expect(w.results()[1]).toEqual({ accepted: false, reason: "safety_stop" });
    }
  });
});

describe("cancellations (C-17)", () => {
  it("leaves an applied call as applied and tells the coach what the app did", () => {
    const host = new RefRomHost();
    const s = setup(host);
    host.askCanMove();
    s.guard.question(canMoveAsk(1000));
    s.guard.heard("yes", 2000);
    s.ex.handle([canMoveCall(true, "c7")], 2200);
    s.ex.cancel(["c7"], 2500);
    expect(host.canMove).toEqual([{ value: true, via: "voice" }]);
    expect(host.phase).toBe("attempt");
    expect(s.pushed).toEqual([
      { p: 3, type: "tool_applied", name: "answer_can_move", accepted: true, t: 2500 },
    ]);
    // A second cancellation of the same call says nothing more.
    s.ex.cancel(["c7"], 2600);
    expect(s.pushed).toHaveLength(1);
  });

  it("drops a call whose cancellation came before it was handled", () => {
    const host = new RefRomHost();
    const s = setup(host);
    s.guard.heard("stop", 100);
    s.ex.cancel(["c9"], 200);
    s.ex.handle([{ id: "c9", name: "stop", args: { reason: "choice" } }], 210);
    expect(host.calls).toEqual([]);
    expect(s.sent).toEqual([]);
    expect(s.pushed).toEqual([]);
  });
});

describe("the checks before the host", () => {
  it("answers unknown tools, tools of another block and bad arguments without the host", () => {
    const host = new SessionHost(screenStub());
    const s = setup(host);
    s.ex.handle(
      [
        { id: "a", name: "record_range", args: {} },
        { id: "b", name: "answer_can_move", args: { movement: "knee_flexion", side: "left", canMove: true } },
        { id: "c", name: "mark_pain", args: { level: 7.5 } },
        { id: "d", name: "stop", args: { reason: "ad_signs" } },
      ],
      100,
    );
    expect(s.sent).toHaveLength(1);
    expect(s.results()).toEqual([
      { accepted: false, reason: "unknown_tool" },
      { accepted: false, reason: "not_in_block" },
      { accepted: false, reason: "invalid_args" },
      { accepted: false, reason: "invalid_args" },
    ]);
    // An unknown name is not a tool, so it has no count.
    expect(s.ex.stats()).toEqual({
      answer_can_move: { ok: 0, rejected: 1 },
      mark_pain: { ok: 0, rejected: 1 },
      stop: { ok: 0, rejected: 1 },
    });
  });

  it("gives the non blocking tools their scheduling and applies a repeated id once", () => {
    const host = new ControlHost("rom");
    const s = setup(host);
    s.ex.handle(
      [
        { id: "1", name: "keep_reaching", args: {} },
        { id: "2", name: "repeat_instructions", args: {} },
        { id: "3", name: "stop", args: { reason: "tired" } },
        { id: "3", name: "stop", args: { reason: "tired" } },
      ],
      100,
    );
    expect(s.sent[0].map((r) => [r.id, r.name, r.scheduling])).toEqual([
      ["1", "keep_reaching", "SILENT"],
      ["2", "repeat_instructions", "WHEN_IDLE"],
      ["3", "stop", undefined],
    ]);
  });

  it("answers a host that throws with a refusal and still answers the other calls", () => {
    const bad: CoachHost = {
      block: "gait",
      step: () => ({ kind: "active", finished: false }),
      snapshot: () => "",
      handleTool: () => {
        throw new Error("host broke");
      },
    };
    const s = setup(bad);
    s.ex.handle(
      [
        { id: "x", name: "pause", args: {} },
        { id: "y", name: "repeat_instructions", args: {} },
      ],
      100,
    );
    expect(s.results()).toEqual([
      { accepted: false, reason: "not_allowed" },
      { accepted: false, reason: "not_allowed" },
    ]);
  });
});

/* ------------------------------------------------ the host matrix */

function screenStub(): SessionScreen {
  return {
    pause() {},
    resume() {},
    instructions: () => "Stand tall.",
    openStopList() {},
    stopExercise() {},
    painOk() {},
  };
}

const KINDS: CoachStepKind[] = ["info", "confirm", "question", "timer", "safety", "active"];
const CONTROL: Record<"pause" | "next_step" | "repeat_instructions" | "stop", (k: CoachStepKind) => boolean> =
  {
    pause: (k) => k === "active" || k === "timer",
    // D-036 item 2: the screen's own button, on the person's words, on any step but a safety one.
    next_step: (k) => k !== "safety",
    repeat_instructions: () => true,
    stop: () => true,
  };
const ARGS: Partial<Record<ToolName, unknown>> = {
  stop: { reason: "choice" },
  next_step: { intent: "next" },
};

describe("every control tool in every step kind, for every block (C-16)", () => {
  for (const block of ["rom", "gait", "session"] as CoachBlock[])
    it(`applies the step kind rules in the ${block} block`, () => {
      for (const kind of KINDS)
        for (const [name, allowed] of Object.entries(CONTROL)) {
          const host = block === "session" ? new SessionHost(screenStub()) : new ControlHost(block);
          if (host instanceof SessionHost) host.setStep(kind, kind);
          else host.kind = kind;
          // The screen shows a Next button, and the person said «التالي» while it showed.
          host.actions.show("screen", () => [
            { name: "next", intents: GO_ON, say: "next_one", press: () => true },
          ]);
          const s = setup(host);
          s.guard.heard("التالي", 50);
          s.ex.handle([{ id: "1", name, args: ARGS[name as ToolName] ?? {} }], 100);
          expect(s.results()[0].accepted, `${block} ${kind} ${name}`).toBe(allowed(kind));
          expect(TOOL_SETS[block]).toContain(name);
        }
    });

  it("lets mark_pain through in every kind of every block once the person spoke", () => {
    for (const block of ["rom", "gait", "session"] as CoachBlock[])
      for (const kind of KINDS) {
        const host = block === "session" ? new SessionHost(screenStub(), 0) : new ControlHost(block);
        if (host instanceof SessionHost) host.setStep(kind, kind);
        else host.kind = kind;
        const s = setup(host);
        s.guard.heard("it hurts a bit", 50);
        s.ex.handle([{ id: "1", name: "mark_pain", args: { level: 1 } }], 100);
        expect(s.results()[0].accepted, `${block} ${kind}`).toBe(true);
      }
  });
});
