/**
 * The booth v2 journey as a state machine (contract C): both doors end to end, the progress dots,
 * the one safety question, the camera's setup, the review path that skips the camera, and the
 * resets that drop everything.
 */
import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../src/engine/types";
import {
  BOOTH_REPS,
  DOTS,
  IDLE_MS,
  START,
  cameraFits,
  cameraSetup,
  canGoOn,
  dotOf,
  idleResets,
  journeyPlan,
  journeyReducer as step,
  type Journey,
  type JourneyEvent,
} from "../src/features/booth/journey";
import { SAAD_EXTRACTION } from "../src/features/booth/story";

const run = (events: JourneyEvent[], from: Journey = START) => events.reduce(step, from);

const SUMMARY: SessionSummary = {
  exerciseId: "seated_shoulder_press",
  profileId: "wheelchair",
  startedAt: 1,
  endedAt: 2,
  reps: { valid: 4, compensated: 1, partial: 0 },
  flags: {},
  measure: { kind: "elbow_extension", bottomDeg: 78, topDeg: 162, rangeDeg: 84 },
  steadyReps: 4,
};

describe("Saad's story, end to end", () => {
  it("report, engine, goal, safety, camera, results, program", () => {
    let j = run([{ type: "OPEN", door: "story" }]);
    expect(j).toMatchObject({ step: "report", door: "story", goal: "sport", sport: "wheelchair_basketball" });
    // The report must be read before going on.
    expect(canGoOn(j)).toBe(false);
    expect(step(j, { type: "NEXT" }).step).toBe("report");
    j = run([{ type: "READ", extraction: SAAD_EXTRACTION, source: "cached" }, { type: "NEXT" }], j);
    expect(j.step).toBe("engine");
    expect(j.reading?.source).toBe("cached");
    j = run([{ type: "NEXT" }], j);
    expect(j.step).toBe("goal");
    // Wheelchair basketball is already chosen in the story.
    expect(canGoOn(j)).toBe(true);
    j = run([{ type: "NEXT" }], j);
    expect(j.step).toBe("safety");
    const before = j.attempt;
    j = run([{ type: "SAFETY", unwell: false }], j);
    expect(j.step).toBe("camera");
    expect(j.attempt).toBe(before + 1);
    expect(cameraSetup(j)).toEqual({ position: "wheelchair", support: "none" });
    j = run([{ type: "CAMERA_DONE", summary: SUMMARY }], j);
    expect(j.step).toBe("results");
    expect(j.summary?.measure?.rangeDeg).toBe(84);
    j = run([{ type: "NEXT" }], j);
    expect(j.step).toBe("program");
    const { intake, plan } = journeyPlan(j);
    expect(intake.sport).toBe("wheelchair_basketball");
    expect(plan.status).toBe("ready");
  });

  it("the progress dots follow the six steps; home has none", () => {
    expect(DOTS).toHaveLength(6);
    expect(dotOf("home")).toBe(-1);
    expect(
      ["report", "engine", "goal", "camera", "results", "program"].map((s) => dotOf(s as never)),
    ).toEqual([0, 1, 2, 3, 4, 5]);
    expect(dotOf("about")).toBe(0);
    expect(dotOf("safety")).toBe(3);
    expect(dotOf("stop")).toBe(3);
  });

  it("the booth's set is the seated press, 5 reps", () => {
    expect(BOOTH_REPS).toBe(5);
  });
});

describe("try it as yourself, end to end", () => {
  it("three taps, then the same steps, with the visitor's own position and side", () => {
    let j = run([{ type: "OPEN", door: "self" }]);
    expect(j).toMatchObject({ step: "about", tap: 0, goal: null, sport: null });
    expect(canGoOn(j)).toBe(false);
    j = run([{ type: "TAP", answers: { conditions: ["stroke"] } }], j);
    // Stroke asks for clearance first.
    expect(canGoOn(j)).toBe(false);
    j = run([{ type: "TAP", answers: { clearance: "yes" } }, { type: "NEXT" }], j);
    expect(j.tap).toBe(1);
    j = run([{ type: "TAP", answers: { position: "seated" } }, { type: "NEXT" }], j);
    expect(j.tap).toBe(2);
    j = run([{ type: "TAP", answers: { side: "left" } }, { type: "NEXT" }], j);
    expect(j.step).toBe("engine");
    j = run([{ type: "NEXT" }], j);
    expect(j.step).toBe("goal");
    expect(canGoOn(j)).toBe(false);
    j = run([{ type: "GOAL", goal: "sport" }], j);
    // Back to sport needs its sport.
    expect(canGoOn(j)).toBe(false);
    j = run([{ type: "SPORT", sport: "para_table_tennis" }, { type: "NEXT" }], j);
    expect(j.step).toBe("safety");
    j = run([{ type: "SAFETY", unwell: false }], j);
    expect(cameraSetup(j)).toEqual({ position: "chair", support: "left" });
    j = run([{ type: "CAMERA_DONE", summary: SUMMARY }, { type: "NEXT" }], j);
    expect(j.step).toBe("program");
    expect(journeyPlan(j).intake).toMatchObject({
      conditions: ["stroke"],
      clearance: "yes",
      support: "left",
      goal: "sport",
      sport: "para_table_tennis",
    });
  });

  it("a wheelchair user moves in front of the camera with the wheelchair profile", () => {
    const j = run([
      { type: "OPEN", door: "self" },
      { type: "TAP", answers: { conditions: ["none"] } },
      { type: "NEXT" },
      { type: "TAP", answers: { position: "wheelchair" } },
      { type: "NEXT" },
      { type: "TAP", answers: { side: "none" } },
    ]);
    expect(cameraSetup(j)).toEqual({ position: "wheelchair", support: "none" });
  });

  it("a report photo fills the taps; changing the conditions asks clearance again", () => {
    let j = run([
      { type: "OPEN", door: "self" },
      { type: "READ", extraction: SAAD_EXTRACTION, source: "live" },
    ]);
    expect(j.self).toMatchObject({ conditions: ["sci_incomplete"], position: "wheelchair" });
    j = run([{ type: "TAP", answers: { clearance: "yes" } }], j);
    expect(canGoOn(j)).toBe(true);
    j = run([{ type: "TAP", answers: { conditions: ["stroke"] } }], j);
    expect(j.self.clearance).toBeNull();
  });

  it("choosing another goal drops the sport", () => {
    const j = run([
      { type: "OPEN", door: "story" },
      { type: "READ", extraction: SAAD_EXTRACTION, source: "live" },
      { type: "NEXT" },
      { type: "NEXT" },
      { type: "GOAL", goal: "habit" },
    ]);
    expect(j).toMatchObject({ goal: "habit", sport: null });
  });
});

describe("the rules can say no, and the safety question stops calmly", () => {
  it("a plan held for review skips the camera and goes to the program step", () => {
    const j = run([
      { type: "OPEN", door: "self" },
      { type: "TAP", answers: { conditions: ["cardiac"] } },
      { type: "NEXT" },
      { type: "TAP", answers: { position: "seated" } },
      { type: "NEXT" },
      { type: "TAP", answers: { side: "none" } },
      { type: "NEXT" },
      { type: "NEXT" },
    ]);
    expect(j.step).toBe("program");
    expect(journeyPlan(j).plan.status).toBe("review");
    // Back returns to the engine, not to a camera result that never was.
    expect(step(j, { type: "BACK" }).step).toBe("engine");
  });

  it("a ready plan of guided cards alone (no camera movement fits) never opens the press camera", () => {
    // One arm: the rules leave out every camera movement, and the program is guided cards (D).
    let j = run([
      { type: "OPEN", door: "self" },
      { type: "TAP", answers: { conditions: ["upper_limb_unilateral"] } },
      { type: "NEXT" },
      { type: "TAP", answers: { position: "seated" } },
      { type: "NEXT" },
      { type: "TAP", answers: { side: "none" } },
      { type: "NEXT" },
    ]);
    const { plan } = journeyPlan(j);
    expect(plan.status).toBe("ready");
    expect(plan.exercises).toEqual([]);
    expect(cameraFits(j)).toBe(false);
    // The goal still shapes the week; then the program, with no safety question and no camera.
    j = run([{ type: "NEXT" }], j);
    expect(j.step).toBe("goal");
    j = run([{ type: "GOAL", goal: "strength" }, { type: "NEXT" }], j);
    expect(j.step).toBe("program");
    expect(step(j, { type: "BACK" }).step).toBe("goal");
  });

  it("the rules leave the press out (no overhead): the camera is skipped, the week stays", () => {
    const reading = {
      ...SAAD_EXTRACTION,
      extracted: {
        ...SAAD_EXTRACTION.extracted,
        conditions: [],
        mobility: "standing",
        restrictions: ["no_overhead"],
        pain: [],
      },
    } as typeof SAAD_EXTRACTION;
    let j = run([
      { type: "OPEN", door: "self" },
      { type: "READ", extraction: reading, source: "live" },
      { type: "TAP", answers: { conditions: ["none"] } },
      { type: "NEXT" },
      { type: "TAP", answers: { position: "standing" } },
      { type: "NEXT" },
      { type: "TAP", answers: { side: "none" } },
      { type: "NEXT" },
    ]);
    const { plan } = journeyPlan(j);
    expect(plan.status).toBe("ready");
    expect(plan.exclusions).toContainEqual({ exerciseId: "seated_shoulder_press", reason: "overhead" });
    expect(cameraFits(j)).toBe(false);
    j = run([{ type: "NEXT" }, { type: "GOAL", goal: "strength" }, { type: "NEXT" }], j);
    expect(j.step).toBe("program");
  });

  it("Saad's story fits the press, so the camera follows the safety question", () => {
    const j = run([
      { type: "OPEN", door: "story" },
      { type: "READ", extraction: SAAD_EXTRACTION, source: "live" },
      { type: "NEXT" },
    ]);
    expect(cameraFits(j)).toBe(true);
  });

  it("yes to the safety question stops before the camera; no camera attempt starts", () => {
    const at = run([
      { type: "OPEN", door: "story" },
      { type: "READ", extraction: SAAD_EXTRACTION, source: "live" },
      { type: "NEXT" },
      { type: "NEXT" },
      { type: "NEXT" },
    ]);
    const j = step(at, { type: "SAFETY", unwell: true });
    expect(j.step).toBe("stop");
    expect(j.attempt).toBe(at.attempt);
  });

  it("Stop on the camera before a rep returns to the question; Try again opens a fresh camera", () => {
    let j = run([
      { type: "OPEN", door: "story" },
      { type: "READ", extraction: SAAD_EXTRACTION, source: "live" },
      { type: "NEXT" },
      { type: "NEXT" },
      { type: "NEXT" },
      { type: "SAFETY", unwell: false },
      { type: "CAMERA_EXIT" },
    ]);
    expect(j.step).toBe("safety");
    j = run(
      [
        { type: "SAFETY", unwell: false },
        { type: "CAMERA_DONE", summary: SUMMARY },
      ],
      j,
    );
    const a = j.attempt;
    j = step(j, { type: "RETRY" });
    expect(j).toMatchObject({ step: "camera", summary: null, attempt: a + 1 });
  });
});

describe("resets", () => {
  it("staff reset drops the visitor's answers, the reading and the result from any step", () => {
    const deep = run([
      { type: "OPEN", door: "self" },
      { type: "READ", extraction: SAAD_EXTRACTION, source: "live" },
      { type: "TAP", answers: { clearance: "yes" } },
    ]);
    const j = step(deep, { type: "RESET" });
    expect(j).toMatchObject({ step: "home", door: null, reading: null, summary: null, goal: null });
    expect(j.self).toEqual(START.self);
    // A new attempt key: a camera that was open closes.
    expect(j.attempt).toBe(deep.attempt + 1);
  });

  it("the idle reset applies on steps 5 and 6 only, after 90 s", () => {
    expect(IDLE_MS).toBe(90_000);
    expect(idleResets("results")).toBe(true);
    expect(idleResets("program")).toBe(true);
    for (const s of ["home", "report", "about", "engine", "goal", "safety", "stop", "camera"] as const)
      expect(idleResets(s)).toBe(false);
  });

  it("events that do not belong to the step change nothing", () => {
    expect(step(START, { type: "NEXT" })).toBe(START);
    expect(step(START, { type: "SAFETY", unwell: false })).toBe(START);
    expect(step(START, { type: "CAMERA_DONE", summary: SUMMARY })).toBe(START);
    const report = step(START, { type: "OPEN", door: "story" });
    expect(step(report, { type: "OPEN", door: "self" })).toBe(report);
  });
});
