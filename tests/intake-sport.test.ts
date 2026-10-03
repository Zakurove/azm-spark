import { describe, expect, it } from "vitest";
import { createPlan, validateIntake, type Intake } from "../src/medical/plan";
import { eligibleExercises } from "../src/medical/weekly";

/** A seated adult with nothing to report: the plain starting point of these tests. */
const seated: Intake = {
  age: 30,
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
  goal: "strength",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
};

describe("the sport goal (booth v2, B3)", () => {
  it("accepts «العودة إلى الرياضة» with one of the 13 sports, and only with it", () => {
    expect(validateIntake({ ...seated, goal: "sport", sport: "wheelchair_basketball" })).toBe(true);
    expect(validateIntake({ ...seated, goal: "sport", sport: "boccia" })).toBe(true);
    // The sport is required with the sport goal, and must be a known sport.
    expect(validateIntake({ ...seated, goal: "sport" })).toBe(false);
    expect(validateIntake({ ...seated, goal: "sport", sport: "football" })).toBe(false);
    expect(validateIntake({ ...seated, goal: "sport", sport: "" })).toBe(false);
    // A sport never rides along with another goal.
    expect(validateIntake({ ...seated, goal: "strength", sport: "boccia" })).toBe(false);
  });

  it("keeps the goals of profiles saved before the sport goal", () => {
    for (const goal of ["mobility", "strength", "habit"] as const) {
      expect(validateIntake({ ...seated, goal })).toBe(true);
      expect(createPlan({ ...seated, goal }).status).toBe("ready");
    }
  });

  it("leaves safety to the rules: the sport goal never adds what the rules left out", () => {
    for (const patch of [
      { restrictions: ["no_overhead"] },
      { pain: ["shoulder"] },
      { mobility: "wheelchair" as const },
    ]) {
      const base = createPlan({ ...seated, ...patch, goal: "strength" });
      const sport = createPlan({ ...seated, ...patch, goal: "sport", sport: "wheelchair_basketball" });
      expect(sport.status).toBe(base.status);
      expect(sport.exclusions).toEqual(base.exclusions);
      expect(sport.exercises.map((e) => e.exerciseId).sort()).toEqual(
        base.exercises.map((e) => e.exerciseId).sort(),
      );
    }
  });

  it("orders the camera movements by what the sport asks for", () => {
    const h: Intake = { ...seated, equipment: ["weights"], goal: "sport", sport: "para_powerlifting" };
    expect(createPlan(h).exercises[0].exerciseId).toBe("seated_shoulder_press");
    const grip: Intake = { ...h, sport: "boccia" };
    expect(createPlan(grip).exercises[0].exerciseId).toBe("seated_biceps_curl");
  });
});

describe("equipment and the chair (booth v2, B6)", () => {
  it("assumes a stable chair: no chair tick is needed for a seated program", () => {
    const p = createPlan({ ...seated, equipment: [] });
    expect(p.status).toBe("ready");
    expect(p.exclusions.map((e) => e.reason)).not.toContain("chair");
    expect(p.exercises.map((e) => e.exerciseId)).toContain("seated_shoulder_press");
  });

  it("keeps weights and bands as the equipment, and still accepts a saved chair", () => {
    expect(validateIntake({ ...seated, equipment: ["weights", "bands"] })).toBe(true);
    expect(validateIntake({ ...seated, equipment: ["chair", "weights"] })).toBe(true);
    expect(validateIntake({ ...seated, equipment: ["kettlebell"] })).toBe(false);
    expect(validateIntake({ ...seated, equipment: ["bands", "bands"] })).toBe(false);
  });

  it("offers band exercises only with bands and without a resistance restriction", () => {
    const bands = (h: Intake) =>
      eligibleExercises(h, createPlan(h)).filter((e) => e.equipment.includes("resistance_bands"));
    expect(bands({ ...seated, equipment: [] })).toEqual([]);
    expect(bands({ ...seated, equipment: ["bands"] }).length).toBeGreaterThan(0);
    expect(bands({ ...seated, equipment: ["bands"], restrictions: ["no_resistance"] })).toEqual([]);
  });

  it("never ends in review because of the equipment alone", () => {
    const mobilities: Intake["mobility"][] = ["seated", "wheelchair", "standing"];
    const restrictionSets = [[], ["no_overhead"], ["no_resistance"], ["no_overhead", "no_resistance"]];
    const painSets = [[], ["shoulder"], ["knee"], ["wrist", "hip"]];
    const conditionSets: Pick<Intake, "conditions" | "clearance">[] = [
      { conditions: ["none"], clearance: "no" },
      { conditions: ["sci_incomplete"], clearance: "yes" },
      { conditions: ["stroke"], clearance: "yes" },
      { conditions: ["ms"], clearance: "yes" },
      { conditions: ["arthritis"], clearance: "yes" },
    ];
    const kits = [[], ["weights"], ["bands"], ["weights", "bands"], ["chair"]];
    let compared = 0;
    for (const mobility of mobilities)
      for (const restrictions of restrictionSets)
        for (const pain of painSets)
          for (const c of conditionSets)
            for (const sessionMinutes of [20, 30, 40]) {
              const statuses = kits.map(
                (equipment) =>
                  createPlan({ ...seated, ...c, mobility, restrictions, pain, sessionMinutes, equipment })
                    .status,
              );
              const where = JSON.stringify({ mobility, restrictions, pain, c, sessionMinutes, statuses });
              expect(new Set(statuses).size, where).toBe(1);
              compared++;
            }
    expect(compared).toBe(3 * 4 * 4 * 5 * 3);
  });

  it("gives a seated person told to avoid overhead work a program even without weights", () => {
    const p = createPlan({ ...seated, restrictions: ["no_overhead"], equipment: [] });
    expect(p.status).toBe("ready");
    expect(p.exercises.map((e) => e.exerciseId)).toEqual(["seated_biceps_curl"]);
    expect(p.exercises[0].reason).toBe("curl_unloaded");
  });
});
