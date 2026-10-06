/**
 * D-029 item 1, E2-1: the exporter keeps the evidence field. Each dose profile of the runtime data
 * carries `evidenceGrade`, the grade its clinical source's words give (dose.profiles[].strength): the
 * grade they lead with outside brackets, the profile's headline grade. A target's evidence, which orders
 * equal priorities (5.8 step 3), is its action's dose profile's, read from the data instead of a code
 * table.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doseEvidence, EVIDENCE, exportTargets } from "../../scripts/clinical/export-v7.mjs";
import { targetEvidence } from "../../src/medical/targets";
import { doseProfile, TARGETS_DATA } from "../../src/movements/targets";

describe("the evidence of a dose profile (E2-1)", () => {
  it("is the grade the words lead with outside their brackets", () => {
    expect(
      doseEvidence(
        "Moderate for the dose itself (consensus and small trials); Low for changing a limitation (Harvey17).",
        "x",
      ),
    ).toBe("Moderate");
    expect(
      doseEvidence(
        "High for strength training in general (WHO20 strong; Osborne22 high); Moderate for the exact numbers.",
        "x",
      ),
    ).toBe("High");
    expect(doseEvidence("(High, Sherrington19) Low at this dose.", "x")).toBe("Low");
    expect(doseEvidence("Very low (expert practice); numbers are a proposal.", "x")).toBe("Very low");
    // A grade inside brackets is a citation's, and a lower case word is not a grade.
    expect(
      doseEvidence(
        "Low at this dose (about 30 minutes a week). Programmes reduce falls (High, Sherrington19). High in Parkinson's.",
        "x",
      ),
    ).toBe("Low");
    expect(
      doseEvidence(
        "High for walking training at moderate to high intensity (Hornby20); the home dose is moderate.",
        "x",
      ),
    ).toBe("High");
  });

  it("fails the export when the words name no grade", () => {
    expect(() => doseEvidence("A proposal.", "dose x")).toThrow("dose x: no evidence grade");
  });

  it("every dose profile of the runtime data carries one", () => {
    for (const p of TARGETS_DATA.dose.profiles) expect(EVIDENCE, p.id).toContain(p.evidenceGrade);
  });

  it("a target's evidence is its action's dose profile's", () => {
    expect(targetEvidence("strengthen:quadriceps", false)).toBe(doseProfile("strength_reps").evidenceGrade);
    expect(targetEvidence("stretch:hamstrings", false)).toBe(doseProfile("stretch_hold").evidenceGrade);
    expect(targetEvidence("mobility:knee_flexion", false)).toBe(doseProfile("mobility_reps").evidenceGrade);
    expect(targetEvidence("mobility:knee_flexion", true)).toBe(doseProfile("mobility_pain").evidenceGrade);
    expect(targetEvidence("balance:weight_shift", false)).toBe(doseProfile("balance_practice").evidenceGrade);
    expect(targetEvidence("practice:walking", false)).toBe(doseProfile("walking_practice").evidenceGrade);
  });

  it.skipIf(!process.env.AZM_CLINICAL_V7)(
    "each grade is the one its signed off words give (AZM_CLINICAL_V7)",
    () => {
      const source = JSON.parse(
        readFileSync(join(process.env.AZM_CLINICAL_V7!, "exercise-targets.json"), "utf8"),
      ) as { dose: { profiles: { id: string; strength: string }[] } };
      const exported = exportTargets(source) as {
        dose: { profiles: { id: string; evidenceGrade: string }[] };
      };
      for (const p of source.dose.profiles)
        expect(exported.dose.profiles.find((x) => x.id === p.id)?.evidenceGrade, p.id).toBe(
          doseEvidence(p.strength, p.id),
        );
    },
  );
});
