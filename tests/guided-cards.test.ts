/**
 * Booth v2, contract D (guided cards), the rules side:
 *   - a program never comes back empty for lack of camera exercises: when no camera movement fits but
 *     the library has safe exercises, the plan is ready and every session is made of guided cards;
 *   - the library pool never holds the library copy of a camera movement: the camera movements keep
 *     the camera, and one the rules left out is not brought back as a card;
 *   - the session of a day: the warm up cards, the camera sets, the day's exercises, the cool down
 *     cards, in that order, from the weekly plan of the planned day the session falls on.
 */
import { describe, expect, it } from "vitest";
import { createPlan, type Intake } from "../src/medical/plan";
import { eligibleExercises, engineWeekly, defaultSelection } from "../src/medical/weekly";
import { CAMERA_TWINS, libraryPool } from "../src/medical/pool";
import { cardKind, sessionDay, sessionDayIndex, sessionSteps } from "../src/medical/session";

const base: Intake = {
  age: 45,
  conditions: ["none"],
  diagnosisNotes: "",
  medications: "",
  mobility: "seated",
  support: "none",
  pain: [],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: [],
  goal: "habit",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
};
const intake = (over: Partial<Intake> = {}): Intake => ({ ...base, ...over });
const TWINS = new Set(Object.values(CAMERA_TWINS));

describe("a program is never empty for lack of camera exercises (D)", () => {
  it("is ready with guided cards when no camera movement fits", () => {
    const h = intake({ conditions: ["upper_limb_unilateral"] });
    const plan = createPlan(h);
    expect(plan.exercises).toEqual([]);
    expect(plan.status).toBe("ready");
    expect(plan.reasons).toEqual([]);
    expect(plan.exclusions.map((e) => e.exerciseId).sort()).toEqual([
      "seated_biceps_curl",
      "seated_shoulder_press",
      "sit_to_stand",
    ]);
    const weekly = engineWeekly(h, plan)!;
    expect(weekly.days).toHaveLength(3);
    for (const d of weekly.days) {
      expect(d.warmup.length).toBeGreaterThan(0);
      expect(d.extra.length).toBeGreaterThan(0);
      expect(d.cooldown.length).toBeGreaterThan(0);
    }
    // The week says what a day is made of: no camera session in it.
    expect(weekly.summary.en).not.toMatch(/camera/i);
    expect(weekly.summary.ar).not.toContain("بالكاميرا");
    expect(weekly.summary.en).toContain("guided exercises");
  });

  it("still names a camera session in the week when the plan has one", () => {
    const h = intake();
    const weekly = engineWeekly(h, createPlan(h))!;
    expect(weekly.summary.en).toContain("camera session");
  });

  it("keeps the clinical review reasons: a cardiac intake is still reviewed", () => {
    const plan = createPlan(intake({ conditions: ["cardiac"], mobility: "bed" }));
    expect(plan.status).toBe("review");
    expect(plan.reasons).not.toContain("no_exercises");
  });

  it("keeps the rules' rest on the plan for the cards' sets", () => {
    const plan = createPlan(intake({ conditions: ["upper_limb_unilateral"] }));
    expect(plan.restSeconds).toBeGreaterThan(0);
    const withCamera = createPlan(intake());
    expect(withCamera.restSeconds).toBe(withCamera.exercises[0].restSeconds);
  });
});

describe("the library pool and the camera movements (D)", () => {
  it("never holds the library copy of a camera movement", () => {
    const cases: Partial<Intake>[] = [
      {},
      { equipment: ["weights", "bands"] },
      { equipment: ["weights"], pain: ["elbow"] },
      { equipment: ["weights"], mobility: "wheelchair" },
      { equipment: ["weights"], goal: "strength" },
    ];
    for (const over of cases) {
      const h = intake(over);
      const pool = eligibleExercises(h, createPlan(h));
      expect(pool.length).toBeGreaterThan(0);
      expect(pool.filter((e) => TWINS.has(e.id))).toEqual([]);
      expect(libraryPool(h).filter((e) => TWINS.has(e.id))).toEqual([]);
    }
  });

  it("does not bring back as a card a press the rules left out for elbow pain", () => {
    const h = intake({ equipment: ["weights"], pain: ["elbow"] });
    const plan = createPlan(h);
    expect(plan.exclusions.find((e) => e.exerciseId === "seated_shoulder_press")?.reason).toBe("pain_upper");
    const days = defaultSelection(h, plan, eligibleExercises(h, plan)).days;
    expect(days.flatMap((d) => [...d.warmup, ...d.extra, ...d.cooldown])).not.toContain(
      "seated_shoulder_press",
    );
  });
});

describe("the session of a day (D)", () => {
  const h = intake({ days: [0, 2, 4] });
  const plan = createPlan(h);
  const weekly = engineWeekly(h, plan)!;

  it("falls on the planned day of the week, or the next one", () => {
    expect(sessionDayIndex([0, 2, 4], 0)).toBe(0);
    expect(sessionDayIndex([0, 2, 4], 1)).toBe(1);
    expect(sessionDayIndex([0, 2, 4], 4)).toBe(2);
    // after the last planned day: the first one of the next week
    expect(sessionDayIndex([0, 2, 4], 5)).toBe(0);
    expect(sessionDayIndex([3], 6)).toBe(0);
  });

  it("takes the cards of that day with the rules' rest", () => {
    const day = sessionDay(weekly, 3, plan.restSeconds!)!;
    expect(day.day).toBe(4);
    expect(day.warmup).toEqual(weekly.days[2].warmup);
    expect(day.extra).toEqual(weekly.days[2].extra);
    expect(day.cooldown).toEqual(weekly.days[2].cooldown);
    expect(day.restSeconds).toBe(plan.restSeconds);
    expect(sessionDay({ ...weekly, days: [] }, 3, 30)).toBeNull();
  });

  it("orders the steps: warm up cards, camera sets, the day's exercises, cool down cards", () => {
    const day = sessionDay(weekly, 0, plan.restSeconds!)!;
    const steps = sessionSteps(plan, day);
    const kinds = steps.map((s) => (s.kind === "card" ? s.slot : "camera"));
    const camera = plan.exercises.reduce((n, e) => n + e.sets, 0);
    expect(kinds).toEqual([
      ...day.warmup.map(() => "warmup"),
      ...Array(camera).fill("camera"),
      ...day.extra.map(() => "extra"),
      ...day.cooldown.map(() => "cooldown"),
    ]);
    const firstCamera = steps.find((s) => s.kind === "camera");
    expect(firstCamera).toMatchObject({ kind: "camera", setNumber: 1 });
  });

  it("is the camera sets alone for a workout started before the cards (no day)", () => {
    const steps = sessionSteps(plan, null);
    expect(steps.every((s) => s.kind === "camera")).toBe(true);
    expect(steps).toHaveLength(plan.exercises.reduce((n, e) => n + e.sets, 0));
  });

  it("is cards alone when no camera movement fits", () => {
    const u = intake({ conditions: ["upper_limb_unilateral"] });
    const p = createPlan(u);
    const steps = sessionSteps(p, sessionDay(engineWeekly(u, p)!, 0, p.restSeconds!));
    expect(steps.length).toBeGreaterThan(3);
    expect(steps.every((s) => s.kind === "card")).toBe(true);
  });

  it("times a hold and counts the reps of the others", () => {
    expect(cardKind({ id: "neck_stretches", sets: 1, holdSeconds: 25 })).toBe("timer");
    expect(cardKind({ id: "seated_marching", sets: 2, reps: 8 })).toBe("counter");
  });
});
