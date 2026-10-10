/**
 * Stream D, step D4: the shared step kind rules every host applies (C-16) and the session host of a
 * coached workout (product v7 contract 2.11 host table, C-15, C-17; D-025 CT-2; 8.6). The session
 * host is the coach's view of the workout screen: the screen tells it each step's kind, and its tool
 * answers are applied at once and are final.
 */
import { describe, expect, it, vi } from "vitest";
import {
  EMERGENCY_REASONS,
  TAP_TO_CONFIRM,
  pauseRefusal,
  resumeRefusal,
  type HostControl,
} from "../../src/features/coach-agent/hostRules";
import { SessionHost, type SessionScreen } from "../../src/features/coach-agent/sessionHost";
import { COACH_STOP_REASONS } from "../../src/coach/tools";
import { GO_ON } from "../../src/coach/actions";
import type { CoachStepKind } from "../../src/coach/types";

const KINDS: CoachStepKind[] = ["info", "confirm", "question", "timer", "safety", "active"];
const state = (kind: CoachStepKind, extra: Partial<HostControl> = {}): HostControl => ({
  step: { kind, finished: false },
  pausedBy: null,
  stopped: false,
  ...extra,
});

describe("the step kind rules of C-16", () => {
  it("asks for a tap with tap_to_confirm", () => {
    expect(TAP_TO_CONFIRM).toBe("tap_to_confirm");
  });

  it("lets pause stop an active or timer step only, never twice and never after a safety stop", () => {
    for (const kind of KINDS)
      expect(pauseRefusal(state(kind)) === null, kind).toBe(kind === "active" || kind === "timer");
    expect(pauseRefusal(state("active", { pausedBy: "screen" }))).toEqual({
      accepted: false,
      reason: "not_allowed",
    });
    expect(pauseRefusal(state("active", { stopped: true }))).toEqual({
      accepted: false,
      reason: "safety_stop",
    });
  });

  it("lets resume end only a pause the coach made, and never after a safety stop", () => {
    expect(resumeRefusal(state("active", { pausedBy: "coach" }))).toBeNull();
    expect(resumeRefusal(state("timer", { pausedBy: "coach" }))).toBeNull();
    expect(resumeRefusal(state("active", { pausedBy: "screen" }))).toEqual({
      accepted: false,
      reason: "paused_on_screen",
    });
    expect(resumeRefusal(state("active"))).toEqual({ accepted: false, reason: "not_allowed" });
    expect(resumeRefusal(state("active", { pausedBy: "coach", stopped: true }))).toEqual({
      accepted: false,
      reason: "safety_stop",
    });
  });

  it("puts the five emergency reasons first", () => {
    expect(EMERGENCY_REASONS).toEqual(["chest", "stroke_signs", "faint", "breath", "fall"]);
  });
});

/* ---------------------------------------------------------- the host */

function screen(text = "Stand tall and lift slowly.") {
  const s: SessionScreen & { calls: string[] } = {
    calls: [],
    pause: vi.fn(() => s.calls.push("pause")),
    resume: vi.fn(() => s.calls.push("resume")),
    instructions: vi.fn(() => text),
    openStopList: vi.fn((reason: string, first: boolean) => s.calls.push(`stopList:${reason}:${first}`)),
    stopExercise: vi.fn(() => s.calls.push("stopExercise")),
    painOk: vi.fn(() => s.calls.push("painOk")),
  };
  return s;
}

describe("SessionHost", () => {
  it("is the session block and starts on an info card", () => {
    const h = new SessionHost(screen());
    expect(h.block).toBe("session");
    expect(h.step()).toEqual({ kind: "info", finished: false });
    expect(h.snapshot()).toBe("session step=start kind=info finished=no paused=no stopped=no");
  });

  it("takes the step kind and the end of an active step from the screen", () => {
    const s = screen();
    const h = new SessionHost(s);
    h.setStep("active", "sit_to_stand set 2");
    expect(h.step()).toEqual({ kind: "active", finished: false });
    h.finished();
    expect(h.step()).toEqual({ kind: "active", finished: true });
    expect(h.snapshot()).toBe(
      "session step=sit_to_stand_set_2 kind=active finished=yes paused=no stopped=no",
    );
  });

  it("presses the button the workout's screen offers (D-036 item 2), on any step kind but safety", () => {
    const h = new SessionHost(screen());
    const pressed: string[] = [];
    // No button on the screen: nothing to press, whatever the step.
    for (const kind of ["info", "confirm", "question", "timer", "active"] as const) {
      h.setStep(kind, kind);
      expect(h.handleTool("next_step", { intent: "next" }), kind).toEqual({
        accepted: false,
        reason: "not_allowed",
        say: "tap_to_confirm",
      });
    }
    h.setStep("confirm", "intro");
    h.actions.show("0:intro:start", () => [
      { name: "start", intents: GO_ON, say: "starting", press: () => void pressed.push("start") },
    ]);
    expect(h.handleTool("next_step", { intent: "again" })).toMatchObject({ accepted: false });
    expect(h.handleTool("next_step", { intent: "start" })).toEqual({
      accepted: true,
      say: "starting",
      data: { pressed: "start" },
    });
    expect(pressed).toEqual(["start"]);
    // Never over the stop list or a stop's screen.
    h.setStep("safety", "stop_list");
    expect(h.handleTool("next_step", { intent: "start" })).toEqual({
      accepted: false,
      reason: "safety_stop",
      say: "tap_to_confirm",
    });
    expect(pressed).toEqual(["start"]);
  });

  it("resumes a coach pause, never a screen pause", () => {
    const s = screen();
    const h = new SessionHost(s);
    h.setStep("active", "wall_push");
    expect(h.handleTool("pause", {})).toEqual({ accepted: true });
    expect(h.handleTool("resume", {})).toEqual({ accepted: true });
    h.screenPaused(true);
    expect(h.handleTool("resume", {})).toEqual({ accepted: false, reason: "paused_on_screen" });
    h.screenPaused(false);
    h.setStep("timer", "rest");
    expect(h.handleTool("pause", {})).toEqual({ accepted: true });
    expect(s.calls).toEqual(["pause", "resume", "pause"]);
  });

  it("never resumes after a safety stop, and nothing restarts", () => {
    const s = screen();
    const h = new SessionHost(s);
    h.setStep("active", "wall_push");
    h.handleTool("pause", {});
    h.safetyStop();
    expect(h.step().kind).toBe("safety");
    expect(h.handleTool("resume", {})).toEqual({ accepted: false, reason: "safety_stop" });
    expect(h.handleTool("next_step", { intent: "next" })).toEqual({
      accepted: false,
      reason: "safety_stop",
      say: "tap_to_confirm",
    });
    expect(s.calls).toEqual(["pause"]);
    // The app (never the coach) goes on: the person chose the next exercise on the screen.
    h.clearStop();
    h.setStep("active", "chair_march");
    expect(h.handleTool("pause", {})).toEqual({ accepted: true });
  });

  it("opens the stop list with each coach reason preselected and waits for the person", () => {
    for (const reason of COACH_STOP_REASONS) {
      const s = screen();
      const h = new SessionHost(s);
      h.setStep("active", "wall_push");
      const emergency = (EMERGENCY_REASONS as readonly string[]).includes(reason);
      expect(h.handleTool("stop", { reason })).toEqual({
        accepted: true,
        say: "tap_to_confirm",
        data: { reason, emergencyFirst: emergency },
      });
      expect(s.openStopList).toHaveBeenCalledWith(reason, emergency);
      expect(s.stopExercise).not.toHaveBeenCalled();
      // The stop list is a safety step; the stop itself waits for the person's tap.
      expect(h.step().kind).toBe("safety");
      expect(h.snapshot()).toContain("stopped=no");
    }
  });

  it("stops the exercise at pain 6 or sharp pain and opens the stop list with pain (C-15)", () => {
    for (const args of [{ level: 6 }, { level: 1, sharp: true }]) {
      const s = screen();
      const h = new SessionHost(s, 0);
      h.setStep("active", "wall_push");
      expect(h.handleTool("mark_pain", args)).toEqual({
        accepted: true,
        say: "pain_stop",
        data: { action: "stop_exercise" },
      });
      expect(s.calls).toEqual(["stopExercise", "stopList:pain:false"]);
      expect(h.handleTool("resume", {})).toEqual({ accepted: false, reason: "safety_stop" });
    }
  });

  it("measures a rise from the pain answer before the workout, or from 0 when it was skipped (CT-2)", () => {
    const skipped = new SessionHost(screen(), null);
    expect(skipped.handleTool("mark_pain", { level: 2 }).data).toEqual({ action: "stop_exercise" });
    const s = screen();
    const answered = new SessionHost(s, 3);
    answered.setStep("active", "wall_push");
    expect(answered.handleTool("mark_pain", { level: 4 })).toEqual({
      accepted: true,
      say: "pain_ok",
      data: { action: "continue" },
    });
    expect(s.calls).toEqual(["painOk"]);
    expect(answered.step()).toEqual({ kind: "active", finished: false });
    expect(answered.handleTool("mark_pain", { level: 5 }).data).toEqual({ action: "stop_exercise" });
  });

  it("takes mark_pain on every step kind, during an info card and a rest too", () => {
    for (const kind of KINDS) {
      const h = new SessionHost(screen(), 0);
      h.setStep(kind, kind);
      expect(h.handleTool("mark_pain", { level: 1 }).accepted, kind).toBe(true);
    }
  });

  it("repeats the instructions with their text, on any step", () => {
    const h = new SessionHost(screen("Sit tall, then stand."));
    h.setStep("question", "ready");
    expect(h.handleTool("repeat_instructions", {})).toEqual({
      accepted: true,
      data: { text: "Sit tall, then stand." },
    });
  });

  it("answers a range tool with not_in_block and never throws", () => {
    const h = new SessionHost(screen());
    expect(
      h.handleTool("answer_can_move", { movement: "knee_flexion", side: "left", canMove: true }),
    ).toEqual({
      accepted: false,
      reason: "not_in_block",
    });
    const broken = new SessionHost(screen());
    broken.actions.show("k", () => [
      {
        name: "start",
        intents: GO_ON,
        say: "starting",
        press: () => {
          throw new Error("screen gone");
        },
      },
    ]);
    // A screen that failed to act is reported as not done.
    expect(broken.handleTool("next_step", { intent: "start" })).toEqual({
      accepted: false,
      reason: "not_allowed",
    });
  });
});
