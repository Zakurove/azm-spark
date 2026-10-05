/**
 * Step D5: the live coach on a workout (product v7 contract 2.11 session host, C-6, C-15, C-16; D-025
 * CT-2). Before a coached workout one tap asks the pain now (0 to 10); the rise of 2 is measured from
 * that answer, and a skipped question counts as 0. The workout's screens carry their C-16 kinds; the
 * coach runs as session:1 for 9 minutes, then session:2 from the next step, then the rest of a longer
 * workout runs without it. The coach's stop opens the movement check's stop list with its reason, and
 * the person's answer is routed by v1's rules (an emergency answer shows its screen and ends the workout).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WORKOUT_SEGMENT_MS,
  WORKOUT_STEP_KIND,
  WorkoutCoachPlan,
  afterFaintAnswer,
  afterStopChoice,
  afterStopScreen,
  exerciseRuns,
  workoutInstructions,
  workoutStopEnv,
  workoutStopRoute,
  type WorkoutStage,
} from "../../src/features/coach-agent/workoutCoach";
import { SessionHost, type SessionScreen } from "../../src/features/coach-agent/sessionHost";
import { CoachSession, type CoachDeps } from "../../src/features/coach-agent/session";
import { FakeLiveTransport } from "../../src/features/coach-agent/fake";
import { DEFAULT_SEGMENT_MINUTES } from "../../server/modules/agent/segments";
import { stopOptions } from "../../src/medical/precheck";
import type { Intake } from "../../src/medical/plan";
import { FakeMic, FakeSpeaker, FakeVoice } from "./d-coach-harness";
import { v1Intake } from "./a-harness";
import type { SessionStep } from "../../src/medical/session";
import { EXERCISES } from "../../src/exercises/defs";
import { libraryById } from "../../src/medical/pool";
import { wordingProblems } from "../../scripts/wording-rules.mjs";

describe("the workout's screens and their kinds (C-16)", () => {
  it("are the person's taps, timers and exercises", () => {
    expect(WORKOUT_STEP_KIND).toEqual({
      setup: "confirm",
      warmup: "timer",
      intro: "confirm",
      set: "active",
      rest: "timer",
      card: "active",
      cooldown: "timer",
      done: "info",
    });
  });
});

describe("the pain question before a coached workout (D-025 CT-2)", () => {
  it("starts the coach only once answered or skipped, and keeps the answer as the score before", () => {
    const plan = new WorkoutCoachPlan();
    expect(plan.boundary(0)).toBeNull();
    plan.answerPain(3);
    expect(plan.painBefore).toBe(3);
    expect(plan.boundary(10)).toBe("session:1");
    const skipped = new WorkoutCoachPlan();
    skipped.answerPain(null);
    expect(skipped.painBefore).toBeNull();
    expect(skipped.boundary(10)).toBe("session:1");
  });

  it("measures the rise of 2 from the answer, and from 0 when skipped (C-15)", () => {
    const screen = fakeScreen();
    const answered = new SessionHost(screen.api, 3);
    answered.setStep("active", "set");
    expect(answered.handleTool("mark_pain", { level: 4 })).toMatchObject({ data: { action: "continue" } });
    expect(answered.handleTool("mark_pain", { level: 5 })).toMatchObject({
      data: { action: "stop_exercise" },
    });
    const skipped = new SessionHost(fakeScreen().api, null);
    skipped.setStep("active", "set");
    expect(skipped.handleTool("mark_pain", { level: 2 })).toMatchObject({
      data: { action: "stop_exercise" },
    });
  });
});

describe("the workout's coach segments (C-6)", () => {
  it("runs session:1 for its minutes, session:2 from the next step after, then no coach", () => {
    expect(WORKOUT_SEGMENT_MS).toBe(DEFAULT_SEGMENT_MINUTES.session * 60_000);
    const plan = new WorkoutCoachPlan();
    plan.answerPain(1);
    expect(plan.boundary(0)).toBe("session:1");
    expect(plan.boundary(WORKOUT_SEGMENT_MS - 1)).toBe("session:1");
    // A step that starts after the part's minutes opens the next part (never mid step).
    expect(plan.boundary(WORKOUT_SEGMENT_MS + 5)).toBe("session:2");
    expect(plan.boundary(2 * WORKOUT_SEGMENT_MS)).toBe("session:2");
    expect(plan.boundary(2 * WORKOUT_SEGMENT_MS + 10)).toBeNull();
    expect(plan.boundary(3 * WORKOUT_SEGMENT_MS)).toBeNull();
  });
});

describe("the stop list of a coached workout (2.11 stop, v1 stopRoute)", () => {
  const intake = (over: Partial<Intake> = {}) => v1Intake(over);

  it("routes an emergency answer to its screen and ends the workout; tiredness goes on", () => {
    const env = workoutStopEnv(intake());
    expect(stopOptions(env)).toContain("chest");
    const chest = workoutStopRoute("chest", env);
    expect(chest.screen).toBe("scr_emergency");
    expect(chest.endsWorkout).toBe(true);
    const tired = workoutStopRoute("tired", env);
    expect(tired.endsWorkout).toBe(false);
    const pain = workoutStopRoute("pain", env);
    expect(pain.endsWorkout).toBe(false);
  });

  it("shows the autonomic dysreflexia screen beside the emergency one for a spinal cord injury", () => {
    const env = workoutStopEnv(intake({ conditions: ["sci_incomplete"] }));
    const chest = workoutStopRoute("chest", env);
    expect(chest.alsoShow).toContain("scr_ad");
  });
});

describe("after the stop list of a coached workout", () => {
  const env = workoutStopEnv(v1Intake({ conditions: ["sci_incomplete"] }));

  it("goes on without a screen after tiredness, pain, a choice or another reason", () => {
    for (const option of ["tired", "pain", "choice", "other"])
      expect(afterStopChoice(workoutStopRoute(option, env)), option).toBeNull();
  });

  it("shows an emergency's screen, then the workout ends", () => {
    const chest = afterStopChoice(workoutStopRoute("chest", env));
    expect(chest).toMatchObject({ kind: "screen", route: { screen: "scr_emergency" } });
    expect(afterStopScreen(workoutStopRoute("chest", env))).toBe("leave");
  });

  it("names a fall from the seat of a seated camera part, else from standing", () => {
    expect(workoutStopRoute("fall", env).screen).toBe("scr_fall");
    expect(workoutStopRoute("fall", workoutStopEnv(v1Intake(), "chair")).screen).toBe("scr_fall_seated");
    expect(workoutStopRoute("fall", workoutStopEnv(v1Intake(), "rise")).screen).toBe("scr_fall");
    const seated = workoutStopEnv(v1Intake({ mobility: "seated" }));
    expect(workoutStopRoute("fall", seated).screen).toBe("scr_fall_seated");
  });

  it("asks v1's faint question after a faint or a fall: yes is the emergency screen, no ends the workout", () => {
    const fall = workoutStopRoute(
      "fall",
      workoutStopEnv(v1Intake({ conditions: ["sci_incomplete"] }), "chair"),
    );
    expect(fall.screen).toBe("scr_fall_seated");
    expect(fall.then).toBe("sf_faint_loc");
    const ask = afterStopScreen(fall);
    expect(ask).toEqual({ kind: "faint_ask", route: fall });
    const yes = afterFaintAnswer(fall, "yes", env, Date.UTC(2026, 9, 6));
    expect(yes).toMatchObject({ kind: "screen", route: { screen: "scr_emergency", alsoShow: ["scr_ad"] } });
    expect(afterStopScreen((yes as { route: typeof fall }).route)).toBe("leave");
    expect(afterFaintAnswer(fall, "unsure", env, 0)).toMatchObject({ route: { screen: "scr_emergency" } });
    const no = afterFaintAnswer(fall, "no", env, 0);
    expect(no).toMatchObject({ kind: "screen", route: { screen: "scr_fall_seated" } });
    expect(afterStopScreen((no as { route: typeof fall }).route)).toBe("leave");
  });

  it("stops an exercise only where one runs (a camera set, a guided card)", () => {
    const runs = (Object.keys(WORKOUT_STEP_KIND) as WorkoutStage[]).filter(exerciseRuns);
    expect(runs).toEqual(["set", "card"]);
  });
});

describe("what the coach reads back on repeat_instructions", () => {
  const press = EXERCISES.find((e) => e.id === "seated_shoulder_press")!;
  const camera: SessionStep = {
    kind: "camera",
    setNumber: 1,
    prescription: {
      exerciseId: press.id,
      setup: { position: "chair", support: "none" } as never,
      sets: 2,
      reps: 8,
      restSeconds: 60,
      reason: "",
    },
  };
  const row = libraryById("resistance_band_rows")!;
  const card: SessionStep = {
    kind: "card",
    slot: "extra",
    item: { id: row.id, sets: 2, reps: 10 } as never,
  };

  it("is the text of the screen the person sees, in their language", () => {
    for (const lang of ["ar", "en"] as const) {
      const set = workoutInstructions("set", camera, lang);
      expect(set).toContain(press.name[lang]);
      expect(set).toContain(press.camera[lang].trim().slice(0, 12));
      const steps = workoutInstructions("card", card, lang);
      expect(steps).toContain(row.name[lang]);
      for (const line of row.steps[lang]) expect(steps).toContain(line.trim().slice(0, 12));
      for (const stage of Object.keys(WORKOUT_STEP_KIND) as WorkoutStage[]) {
        const text = workoutInstructions(stage, stage === "card" ? card : camera, lang);
        expect(text.length, `${stage} ${lang}`).toBeGreaterThan(10);
        expect(wordingProblems(text), `${stage} ${lang}`).toEqual([]);
      }
    }
  });
});

describe("a pause the workout's screen cannot make", () => {
  it("is refused on a camera set and a guided card: the coach points to the screen's own buttons", () => {
    const screen = fakeScreen();
    let exercise = true;
    screen.api.canPause = () => !exercise;
    const host = new SessionHost(screen.api, 0);
    host.setStep(WORKOUT_STEP_KIND.set, "seated_shoulder_press");
    expect(host.handleTool("pause", {})).toEqual({
      accepted: false,
      reason: "not_allowed",
      say: "tap_to_confirm",
    });
    expect(screen.calls).not.toContain("pause");
    exercise = false;
    host.setStep(WORKOUT_STEP_KIND.rest, "rest");
    expect(host.handleTool("pause", {})).toEqual({ accepted: true });
    expect(screen.calls).toContain("pause");
  });
});

/* ------------------------------------------------- through the segment */

function fakeScreen() {
  const calls: string[] = [];
  const api: SessionScreen = {
    pause: () => calls.push("pause"),
    resume: () => calls.push("resume"),
    next: () => calls.push("next"),
    instructions: () => "Raise both arms slowly.",
    openStopList: (reason, emergencyFirst) => calls.push(`stop:${reason}:${emergencyFirst}`),
    stopExercise: () => calls.push("stopExercise"),
    painOk: () => calls.push("painOk"),
  };
  return { api, calls };
}

describe("the session host through D's coach segment on a workout", () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.UTC(2026, 9, 6, 9, 0, 0) }));
  afterEach(() => vi.useRealTimers());

  it("takes the coach's tools as the workout's screens allow them", async () => {
    const screen = fakeScreen();
    const host = new SessionHost(screen.api, 2);
    const transports: FakeLiveTransport[] = [];
    const deps: CoachDeps = {
      now: () => Date.now(),
      wallNow: () => Date.now(),
      online: () => true,
      async mint() {
        const now = Date.now();
        return {
          ok: true,
          serverDate: now,
          token: {
            sessionId: "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
            token: "auth_tokens/w1",
            model: "gemini-3.8-live",
            apiVersion: "v1beta",
            voice: "Achird",
            expiresAt: new Date(now + 12 * 60_000).toISOString(),
            newSessionExpiresAt: new Date(now + 120_000).toISOString(),
            history: [{ role: "user", text: "[CTX block=session segment=session:1 lang=ar]" }],
            minutesLeft: 30,
          },
        };
      },
      report() {},
      transport() {
        const t = new FakeLiveTransport({ setupMs: 600 });
        transports.push(t);
        return t;
      },
      mic: () => new FakeMic(),
      speaker: () => new FakeSpeaker(),
      deviceId: () => "device_abcdefghijklmnop",
      tickMs: 50,
    };
    const session = new CoachSession(
      {
        block: "session",
        segment: "session:1",
        lang: "ar",
        ref: { workoutId: "0b6f1c1e-1d2a-4c8e-9a1b-2f3c4d5e6f70" },
        host,
        local: new FakeVoice(),
      },
      deps,
    );
    session.start();
    await vi.advanceTimersByTimeAsync(700);
    expect(session.getSnapshot().mode).toBe("live");
    const live = transports[0];
    const call = (id: string, name: string, args: unknown) =>
      live.emit({ type: "toolCall", calls: [{ id, name, args }] });
    const reply = (id: string) =>
      live.sent.flatMap((s) => (s.kind === "toolResponse" ? s.responses : [])).find((r) => r.id === id)
        ?.response;
    // The rest between sets is a timer: the coach cannot skip it, but may pause it.
    host.setStep(WORKOUT_STEP_KIND.rest, "rest");
    session.push({ p: 3, type: "step_start", label: "rest", t: 0 });
    call("c1", "next_step", {});
    expect(reply("c1")).toEqual({ accepted: false, reason: "not_allowed", say: "tap_to_confirm" });
    call("c2", "pause", {});
    expect(reply("c2")).toEqual({ accepted: true });
    // The camera set: a spoken pain of 3 over 2 goes on (stay within comfort), 4 stops the exercise.
    host.setStep(WORKOUT_STEP_KIND.set, "seated_shoulder_press");
    live.emit({ type: "inputTranscript", text: "يؤلمني قليلًا", final: true });
    await vi.advanceTimersByTimeAsync(300);
    call("c3", "mark_pain", { level: 3 });
    expect(reply("c3")).toEqual({ accepted: true, say: "pain_ok", data: { action: "continue" } });
    expect(screen.calls).toContain("painOk");
    call("c4", "mark_pain", { level: 4 });
    expect(reply("c4")).toEqual({ accepted: true, say: "pain_stop", data: { action: "stop_exercise" } });
    expect(screen.calls).toEqual(expect.arrayContaining(["stopExercise", "stop:pain:false"]));
    // A chest pain: the stop list with the emergency options first; the person confirms there.
    call("c5", "stop", { reason: "chest" });
    expect(reply("c5")).toMatchObject({ accepted: true, say: "tap_to_confirm" });
    expect(screen.calls).toContain("stop:chest:true");
    session.end("done");
  });
});
