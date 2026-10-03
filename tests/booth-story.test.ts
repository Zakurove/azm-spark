/**
 * Booth v2 (contract C): Saad's story and the visitor's three taps build the same Intake as the
 * portal, and the medical engine (createPlan) decides on the phone. Rules before AI: clearance is
 * never read from a report; the sport only orders what the rules allowed.
 */
import { describe, expect, it } from "vitest";
import { validateIntake } from "../src/medical/plan";
import { engineWeekly, sportPath } from "../src/medical/weekly";
import { sportById } from "../src/medical/sports";
import {
  EMPTY_SELF,
  conditionsDone,
  needsClearance,
  planFor,
  selfBase,
  selfFromExtraction,
  storyBase,
  toggleCondition,
} from "../src/features/booth/intake";
import { SAAD_EXTRACTION, SAAD_GOAL, THEN_NOW_EXAMPLE } from "../src/features/booth/story";

describe("Saad's story", () => {
  it("is a valid intake whose plan is ready: the press and the curl in, the sit to stand out", () => {
    const { intake, plan } = planFor(storyBase(SAAD_EXTRACTION), SAAD_GOAL.goal, SAAD_GOAL.sport);
    expect(validateIntake(intake)).toBe(true);
    expect(intake).toMatchObject({
      age: 22,
      conditions: ["sci_incomplete"],
      mobility: "wheelchair",
      clearance: "yes",
      goal: "sport",
      sport: "wheelchair_basketball",
      days: [0, 2, 4],
    });
    expect(plan.status).toBe("ready");
    expect(plan.exercises.map((e) => e.exerciseId).sort()).toEqual([
      "seated_biceps_curl",
      "seated_shoulder_press",
    ]);
    expect(plan.exclusions).toEqual([{ exerciseId: "sit_to_stand", reason: "standing" }]);
    // His condition adapts the dose: longer rest than the base 30 s and a rest day between sessions.
    expect(plan.exercises[0].restSeconds).toBeGreaterThan(30);
    expect(plan.recoveryHours).toBeGreaterThanOrEqual(48);
    expect(plan.exercises.every((e) => e.setup.position === "wheelchair")).toBe(true);
  });

  it("never takes clearance from the report: it is Saad's own answer", () => {
    const base = storyBase({
      ...SAAD_EXTRACTION,
      extracted: { ...SAAD_EXTRACTION.extracted, symptoms: "yes", recentChange: "yes" },
    });
    expect(base.clearance).toBe("yes");
    expect(base.symptoms).toBe("no");
    expect(base.recentChange).toBe("no");
  });

  it("builds a sport path with the camera movements under the demands they build", () => {
    const { intake, plan } = planFor(storyBase(SAAD_EXTRACTION), SAAD_GOAL.goal, SAAD_GOAL.sport);
    const weekly = engineWeekly(intake, plan);
    expect(weekly?.days.length).toBe(3);
    const steps = sportPath(sportById("wheelchair_basketball")!, plan, weekly);
    expect(steps.map((s) => s.demand)).toContain("shoulder_endurance");
    const shoulder = steps.find((s) => s.demand === "shoulder_endurance")!;
    expect(shoulder.exercises[0]).toEqual({ id: "seated_shoulder_press", camera: true });
  });

  it("keeps a labelled example that goes up, in whole degrees", () => {
    expect(THEN_NOW_EXAMPLE.now).toBeGreaterThan(THEN_NOW_EXAMPLE.start);
    expect(Number.isInteger(THEN_NOW_EXAMPLE.start) && Number.isInteger(THEN_NOW_EXAMPLE.now)).toBe(true);
  });
});

describe("try it as yourself: three taps", () => {
  it("none stands alone, and a condition clears none", () => {
    expect(toggleCondition([], "none")).toEqual(["none"]);
    expect(toggleCondition(["none"], "stroke")).toEqual(["stroke"]);
    expect(toggleCondition(["stroke"], "none")).toEqual(["none"]);
    expect(toggleCondition(["stroke", "arthritis"], "stroke")).toEqual(["arthritis"]);
  });

  it("asks clearance only for a condition that needs it", () => {
    expect(needsClearance(["none"])).toBe(false);
    expect(needsClearance(["arthritis"])).toBe(false);
    expect(needsClearance(["stroke"])).toBe(true);
    expect(needsClearance(["sci_incomplete"])).toBe(true);
    expect(conditionsDone({ ...EMPTY_SELF, conditions: ["stroke"] })).toBe(false);
    expect(conditionsDone({ ...EMPTY_SELF, conditions: ["stroke"], clearance: "yes" })).toBe(true);
    expect(conditionsDone({ ...EMPTY_SELF, conditions: ["none"] })).toBe(true);
    expect(conditionsDone(EMPTY_SELF)).toBe(false);
  });

  it("a visitor with no condition, seated: ready, the press in, no weights at the booth", () => {
    const { intake, plan } = planFor(
      selfBase({ conditions: ["none"], clearance: null, position: "seated", side: "none" }),
      "strength",
    );
    expect(validateIntake(intake)).toBe(true);
    expect(plan.status).toBe("ready");
    expect(plan.exercises.map((e) => e.exerciseId)).toContain("seated_shoulder_press");
    expect(plan.exclusions.map((e) => e.exerciseId)).toContain("sit_to_stand");
  });

  it("a standing visitor keeps the sit to stand; a weaker side is kept for the camera", () => {
    const { intake, plan } = planFor(
      selfBase({ conditions: ["stroke"], clearance: "yes", position: "standing", side: "left" }),
      "mobility",
    );
    expect(intake.support).toBe("left");
    expect(plan.status).toBe("ready");
    expect(plan.exercises.map((e) => e.exerciseId)).toContain("sit_to_stand");
  });

  it("the rules can say no: clearance not given, or a heart condition, holds the plan for review", () => {
    expect(
      planFor(
        selfBase({ conditions: ["stroke"], clearance: "no", position: "seated", side: "none" }),
        "habit",
      ).plan.status,
    ).toBe("review");
    const heart = planFor(
      selfBase({ conditions: ["cardiac"], clearance: null, position: "seated", side: "none" }),
      "habit",
    ).plan;
    expect(heart.status).toBe("review");
    expect(heart.reasons).toContain("cardiac");
  });

  it("a recovery interval of two days still finds a schedule the rules accept", () => {
    const { plan } = planFor(
      selfBase({ conditions: ["sci_complete"], clearance: "yes", position: "wheelchair", side: "none" }),
      "strength",
    );
    expect(plan.reasons).not.toContain("recovery");
    expect(plan.reasons).not.toContain("duration");
  });

  it("a report photo fills the taps, and the visitor's own taps stay where the report is silent", () => {
    const filled = selfFromExtraction(
      { conditions: [], clearance: null, position: "seated", side: "right" },
      SAAD_EXTRACTION,
    );
    expect(filled).toEqual({
      conditions: ["sci_incomplete"],
      clearance: null,
      position: "wheelchair",
      side: "right",
    });
  });

  it("the sport goal without a sport yet is planned as strength until the sport is chosen", () => {
    const base = selfBase({ conditions: ["none"], clearance: null, position: "seated", side: "none" });
    expect(planFor(base, "sport").intake.goal).toBe("strength");
    expect(planFor(base, "sport", "boccia").intake).toMatchObject({ goal: "sport", sport: "boccia" });
  });
});
