/**
 * D-038 item 3 (Nasser: «ensure the voice agent is working in the demo exercises, and that robotic
 * voice is turned down»): no exercise or workout plays a recorded voice clip any more, demo or real;
 * the Live coach is their only voice. The camera screen hands the coach what the clips said (the set's
 * steps, its form cues and its counts) as say lines; the session host gives a session that goes live
 * the step showing now; a demo exercise's coach runs on a demo ref with no workout id.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BridgeEvent } from "../../src/coach/types";
import type { GateMessage } from "../../src/engine/feedbackGate";
import type { EngineEvent } from "../../src/engine/types";
import type { FlowStage } from "../../src/engine/workoutFlow";
import { SessionHost, type SessionScreen } from "../../src/features/coach-agent/sessionHost";
import { DEMO_EXERCISES, demoCoachStep, newDemoRunId } from "../../src/features/program-v7/demoCatalog";

const ROOT = join(__dirname, "../..");

// The camera screen reads the page's query at load (its E2E traces): a page with none.
let flowCoachSays: (typeof import("../../src/app/Session"))["flowCoachSays"];
beforeAll(async () => {
  vi.stubGlobal("location", { search: "" });
  ({ flowCoachSays } = await import("../../src/app/Session"));
});
const read = (f: string) =>
  readFileSync(join(ROOT, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** The code paths of an exercise or a workout: the camera screen, its callers and the coach of a set. */
const EXERCISE_PATHS = [
  "src/app/Session.tsx",
  "src/app/Workout.tsx",
  "src/app/TryCamera.tsx",
  "src/app/GuidedCard.tsx",
  "src/features/program-v7/DemoExercises.tsx",
  "src/features/program-v7/demoCatalog.ts",
  "src/features/booth/BoothApp.tsx",
  "src/features/coach-agent/CoachedWorkout.tsx",
  "src/features/coach-agent/LocalVoice.ts",
];

describe("no recorded voice clip in any exercise or workout (D-038 item 3)", () => {
  it("never plays, primes or loads a clip on an exercise path", () => {
    for (const f of EXERCISE_PATHS)
      expect(read(f), f).not.toMatch(
        /CuePlayer|primeAudio|voicePacks|cueUrls|new Audio\(|\.mp3|speechSynthesis|from "(\.\.\/)*app\/audio"|from "\.\/audio"/,
      );
  });

  it("keeps no clip machinery for exercises: no counts, no cue lines, no hold for the coach, no CueVoice", () => {
    const audio = read("src/app/audio.ts");
    expect(audio).not.toMatch(/\bcount\(|count_|queuedCount|holdForCoach|coachHeld|onActivity|\bcue\(/);
    const voice = read("src/features/coach-agent/LocalVoice.ts");
    expect(voice).not.toMatch(/CueVoice|CuePlayer/);
    expect(read("src/features/coach-agent/session.ts")).not.toMatch(/holdVoice/);
    expect(read("src/features/coach-agent/useCoach.ts")).not.toMatch(/CuePlayer|holdVoice/);
  });

  it("every coach a set has is given the silent local voice", () => {
    const coached = read("src/features/coach-agent/CoachedWorkout.tsx");
    expect(coached).toMatch(/local: SILENT_VOICE/);
  });
});

/* ------------------------------------------------- what the coach says */

const view = (stage: FlowStage, speak: GateMessage[] = [], events: EngineEvent[] = []) => ({
  stage,
  speak,
  events,
});
const rep = (count: number, cls: "valid" | "partial" | "compensated" = "valid"): EngineEvent => ({
  kind: "rep",
  cls,
  count,
  t: 1,
  durSec: 2,
  peakPct: 0.9,
});
const says = (events: BridgeEvent[]) =>
  events.flatMap((e) => (e.type === "say" ? [{ kind: e.kind, key: e.key, lines: e.lines }] : []));

describe("flowCoachSays: the clips' words, said by the Live coach", () => {
  it("says each stage's step once, as it starts, in the session's language", () => {
    const at = (stage: FlowStage, before: FlowStage | null, lang: "ar" | "en" = "en") =>
      says(flowCoachSays(view(stage), before, "seated_shoulder_press", lang, 1));
    expect(at("framing", null)).toEqual([
      {
        kind: "step",
        key: "framing",
        lines: ["Fit your upper body in the outline", "Sit facing the camera, about two meters away."],
      },
    ]);
    expect(at("framing", "framing")).toEqual([]);
    expect(at("start", "framing")[0]).toMatchObject({ kind: "step", key: "start" });
    expect(at("calibrating", "start")[0]).toMatchObject({
      key: "measure",
      lines: ["Measuring your range", "Two comfortable reps, at your own pace."],
    });
    expect(at("training", "calibrating")[0]).toMatchObject({ kind: "step", key: "training" });
    expect(at("finished", "training")[0]).toMatchObject({ kind: "step", key: "set_done" });
    expect(at("stopped", "training")).toEqual([]);
    // Arabic: the Arabic screen's own words.
    expect(at("framing", null, "ar")[0].lines[0]).toBe("اجعل جسمك العلوي داخل الإطار");
    // The biceps curl and sit to stand have their own setup words.
    expect(says(flowCoachSays(view("framing"), null, "seated_biceps_curl", "en", 1))[0].lines[1]).toBe(
      "Turn your side to the camera, about two meters away.",
    );
    expect(says(flowCoachSays(view("framing"), null, "sit_to_stand", "en", 1))[0].lines[0]).toBe(
      "Fit your whole body and the chair in the outline",
    );
  });

  it("counts each counted repetition at once (a count line), never a partial one", () => {
    const out = says(
      flowCoachSays(view("training", [], [rep(3), rep(4, "partial")]), "training", "x", "ar", 1),
    );
    expect(out).toEqual([{ kind: "progress", key: "count", lines: ["3"] }]);
  });

  it("says the form cue the gate lets through as a correction, not the stage lines twice", () => {
    const sitTall: GateMessage = { id: "sit_tall", severity: "warn", voice: "sit_tall" };
    const stage: GateMessage = { id: "start_position", severity: "info", voice: "seated_shoulder_press_0" };
    const out = says(
      flowCoachSays(view("training", [sitTall, stage]), "training", "seated_shoulder_press", "en", 1),
    );
    expect(out).toEqual([
      { kind: "correction", key: "sit_tall", lines: ["Steady your trunk. Adjust your sitting position."] },
    ]);
  });

  it("never says a degree or a number beyond the count", () => {
    for (const stage of ["framing", "start", "calibrating", "training", "finished"] as const)
      for (const lang of ["ar", "en"] as const)
        for (const s of says(flowCoachSays(view(stage), null, "seated_shoulder_press", lang, 1)))
          expect(s.lines.join(" ")).not.toMatch(/°|\d/);
  });
});

/* ------------------------------------------------- the session host */

const screen = (): SessionScreen => ({
  pause() {},
  resume() {},
  instructions: () => "",
  openStopList() {},
  stopExercise() {},
  painOk() {},
});

describe("the session host gives a session that goes live the step showing now", () => {
  it("keeps the latest step line, drops it on a new step, and gives none over a safety stop", () => {
    const h = new SessionHost(screen());
    h.setStep("active", "seated_shoulder_press");
    expect(h.explain()).toBeNull();
    for (const e of flowCoachSays(view("framing"), null, "seated_shoulder_press", "en", 5)) h.noteSay(e);
    h.noteSay({ p: 2, type: "say", kind: "progress", key: "count", lines: ["1"], t: 6 });
    expect(h.explain()).toMatchObject({ type: "say", kind: "step", key: "framing" });
    expect(h.explain()).not.toHaveProperty("t");
    h.setStep("active", "seated_shoulder_press");
    expect(h.explain()).toMatchObject({ key: "framing" });
    h.setStep("timer", "rest");
    expect(h.explain()).toBeNull();
    for (const e of flowCoachSays(view("training"), "calibrating", "seated_shoulder_press", "en", 7))
      h.noteSay(e);
    h.safetyStop();
    expect(h.explain()).toBeNull();
  });
});

/* ------------------------------------------------- the demo's coach */

describe("a demo exercise's coach (no workout id)", () => {
  it("runs on a fresh UUID v4 per run, as the token route checks it", () => {
    const ids = new Set(Array.from({ length: 20 }, () => newDemoRunId()));
    expect(ids.size).toBe(20);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("names its one camera set as a workout's step: one set of the demo's reps, no rest", () => {
    for (const d of DEMO_EXERCISES)
      expect(demoCoachStep(d)).toEqual({
        kind: "camera",
        prescription: {
          exerciseId: d.id,
          setup: d.setup,
          sets: 1,
          reps: d.reps,
          restSeconds: 0,
          reason: "demo",
        },
        setNumber: 1,
      });
  });

  it("is mounted for a camera run, with the checks' sound switch, and sends a stop of its own", () => {
    const demo = read("src/features/program-v7/DemoExercises.tsx");
    expect(demo).toMatch(/of=\{\{ demo: d\.id, run: runId \}\}/);
    expect(demo).toMatch(/readSound\(\)/);
    expect(demo).toMatch(/unlockCoachAudio\(\)/);
    const coached = read("src/features/coach-agent/CoachedWorkout.tsx");
    expect(coached).toMatch(/setSegment\(demo \? "demo" : plan\.boundary\(now\)\)/);
    expect(coached).toMatch(
      /sendWorkoutStop\("demo" in of \? \{ demo: of\.demo \} : of\.workoutId, option\)/,
    );
  });
});
