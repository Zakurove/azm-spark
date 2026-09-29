/**
 * S56 staff vitals (pc_booth_vitals; council Q21, O47; UX spec S56, 0.2): the form's rules, the
 * answer the screen hands the pre-check, what the flow does with it, and the O47 invariant.
 */
import { describe, expect, it } from "vitest";
import {
  checkVitals,
  cleanTyped,
  EMPTY_VITALS,
  meansOf,
  parseVital,
  type VitalsInput,
} from "../src/features/assessment/booth/vitals";
import type { FlowModel } from "../src/features/assessment/flowMachine";
import { baseSelection, baseTests, type CheckContext } from "../src/medical/assessment";
import { visibleQuestions, type PrecheckEnv } from "../src/medical/precheck";
import { guestAfterSteps, NOW, precheckUntil, step } from "./booth-helpers";

const filled = (o: Partial<VitalsInput> = {}): VitalsInput => ({
  hr1: "72",
  sys1: "128",
  dia1: "82",
  hr2: "70",
  sys2: "124",
  dia2: "78",
  ...o,
});

describe("typed values (UX spec 0.2, S56 ranges)", () => {
  it("reads ASCII, Arabic Indic and Persian digits and every decimal mark", () => {
    for (const raw of ["128", "١٢٨", "۱۲۸", " 128 "])
      expect(parseVital("sys1", raw)).toEqual({ ok: true, value: 128 });
    for (const raw of ["72.5", "72٫5", "72,5", "72،5", "٧٢٫٥", "۷۲٫۵"])
      expect(parseVital("hr1", raw)).toEqual({ ok: true, value: 72.5 });
  });

  it("keeps the S56 typing ranges: pulse 30 to 250, systolic 60 to 260, diastolic 30 to 160", () => {
    expect(parseVital("hr1", "30").ok).toBe(true);
    expect(parseVital("hr2", "250").ok).toBe(true);
    expect(parseVital("hr1", "29")).toEqual({ ok: false, error: "range" });
    expect(parseVital("hr1", "251")).toEqual({ ok: false, error: "range" });
    expect(parseVital("sys1", "60").ok).toBe(true);
    expect(parseVital("sys2", "260").ok).toBe(true);
    expect(parseVital("sys1", "59")).toEqual({ ok: false, error: "range" });
    expect(parseVital("sys1", "261")).toEqual({ ok: false, error: "range" });
    expect(parseVital("dia1", "30").ok).toBe(true);
    expect(parseVital("dia2", "160").ok).toBe(true);
    expect(parseVital("dia1", "161")).toEqual({ ok: false, error: "range" });
    expect(parseVital("dia1", "")).toEqual({ ok: false, error: "empty" });
    expect(parseVital("dia1", "abc")).toEqual({ ok: false, error: "range" });
    expect(parseVital("dia1", "8.0.1")).toEqual({ ok: false, error: "range" });
  });

  it("keeps only digits and a decimal mark while typing", () => {
    expect(cleanTyped("12a8")).toBe("128");
    expect(cleanTyped("١٢٨ mm")).toBe("١٢٨");
    expect(cleanTyped("72٫5")).toBe("72٫5");
    expect(cleanTyped("1234567")).toBe("123456");
  });
});

describe("the answer (Q21 (3): the mean of two readings)", () => {
  it("hands the pre-check both readings and the mean pulse, never a usual systolic (O47 (2))", () => {
    const c = checkVitals(filled({ hr1: "٧٢", sys2: "۱۲۴" }), false);
    expect(c.invalid).toEqual([]);
    expect(c.answer).toEqual({
      systolic1: 128,
      diastolic1: 82,
      systolic2: 124,
      diastolic2: 78,
      restingHeartRate: 71,
      irregularHeartbeat: false,
    });
    expect(Object.keys(c.answer!)).not.toContain("usualSystolic");
  });

  it("lists every empty or out of range field in form order, and the missing irregular answer", () => {
    const c = checkVitals({ ...EMPTY_VITALS, sys1: "300", dia2: "80" }, null);
    expect(c.answer).toBeNull();
    expect(c.invalid).toEqual(["hr1", "sys1", "dia1", "hr2", "sys2"]);
    expect(c.irregularMissing).toBe(true);
    expect(checkVitals(filled(), null)).toMatchObject({ invalid: [], irregularMissing: true, answer: null });
  });

  it("shows each mean once both of its readings are valid", () => {
    expect(meansOf(filled())).toEqual({ hr: 71, sys: 126, dia: 80 });
    expect(meansOf({ ...EMPTY_VITALS, sys1: "127", sys2: "126" })).toEqual({
      hr: null,
      sys: 126.5,
      dia: null,
    });
  });
});

/* ------------------------------------------------------------------ in the flow */

/** A standing guest with clearance not sure: the booth chair stand needs the staff vitals (Q19 (5c)). */
function atVitals(): FlowModel {
  const { model } = precheckUntil(guestAfterSteps({ position: "standing", clearance: "unsure" }), (id) =>
    id.startsWith("pc_booth_vitals"),
  );
  expect(model.state).toEqual({ kind: "question", id: "pc_booth_vitals" });
  return model;
}

function chairStandSkip(m: FlowModel): string | null | undefined {
  expect(["plan", "warnings"]).toContain(m.state.kind);
  const item = m.data.protocol.find((p) => p.testId === "chair_stand_30s");
  return item ? (item.skipped ?? null) : undefined;
}

const answerWith = (m: FlowModel, input: VitalsInput, irregular: boolean) => {
  const c = checkVitals(input, irregular);
  expect(c.answer).not.toBeNull();
  return step(m, { type: "ANSWER", id: "pc_booth_vitals", value: { ...c.answer! } });
};

describe("S56 in the guest booth flow (Q21 (4), O47 (4))", () => {
  it("is the last question before the check for a standing guest who is not sure of clearance", () => {
    const { seen } = precheckUntil(guestAfterSteps({ position: "standing", clearance: "unsure" }), (id) =>
      id.startsWith("pc_booth_vitals"),
    );
    expect(seen[seen.length - 1]).toBe("pc_booth_vitals");
  });

  it("runs the chair stand with readings inside the limits", () => {
    expect(chairStandSkip(answerWith(atVitals(), filled(), false))).toBeNull();
  });

  it("skips the chair stand (booth_vitals) on the mean systolic, the mean diastolic, the pulse or the flag", () => {
    const m = atVitals();
    expect(chairStandSkip(answerWith(m, filled({ sys1: "170", sys2: "150" }), false))).toBe("booth_vitals");
    expect(chairStandSkip(answerWith(m, filled({ sys1: "90", sys2: "88" }), false))).toBe("booth_vitals");
    expect(chairStandSkip(answerWith(m, filled({ dia1: "104", dia2: "96" }), false))).toBe("booth_vitals");
    expect(chairStandSkip(answerWith(m, filled({ hr1: "120", hr2: "122" }), false))).toBe("booth_vitals");
    expect(chairStandSkip(answerWith(m, filled(), true))).toBe("booth_vitals");
  });

  it("uses the mean of the two readings, not the higher one", () => {
    const m = atVitals();
    // Pulse 118 and 122: mean 120, not above 120. Systolic 164 and 154: mean 159, under 160.
    expect(chairStandSkip(answerWith(m, filled({ hr1: "118", hr2: "122" }), false))).toBeNull();
    expect(chairStandSkip(answerWith(m, filled({ sys1: "164", sys2: "154" }), false))).toBeNull();
  });

  it("does not offer the chair stand without a cuff or a practitioner (clearance_booth, O47 (4))", () => {
    const m = step(atVitals(), { type: "ANSWER", id: "pc_booth_vitals", value: "unavailable" });
    expect(chairStandSkip(m)).toBe("clearance_booth");
  });

  it("goes Back to the question before it and keeps the values out of the answers when left", () => {
    const m = atVitals();
    const back = step(m, { type: "BACK" });
    expect(back.state.kind).toBe("question");
    expect((back.state as { id: string }).id).not.toBe("pc_booth_vitals");
    expect(back.data.answers.pc_booth_vitals).toBeUndefined();
  });

  it("drops the raw vitals once the check is frozen (values are used today only, Q21 (5))", () => {
    const m = answerWith(atVitals(), filled(), false);
    expect(m.data.answers.pc_booth_vitals).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ O47 (1) invariant */

describe("O47 (1): S56 never opens for a visitor with SCI", () => {
  const SCI = ["sci_complete", "sci_incomplete", "sci_unsure"];
  const POSITIONS = ["standing", "chair", "wheelchair"] as const;

  it("guest booth flow: no SCI guest with clearance no or not sure ever reaches pc_booth_vitals", () => {
    for (const condition of SCI)
      for (const clearance of ["no", "unsure"] as const)
        for (const position of POSITIONS)
          for (const path of ["quick", "full"] as const) {
            const m = guestAfterSteps({ position, clearance, conditions: [condition], path });
            if (m.state.kind !== "intro") continue; // routed to the team (S09): no check at all
            const { seen } = precheckUntil(m);
            expect(seen, `${condition} ${clearance} ${position} ${path}`).not.toContain("pc_booth_vitals");
          }
  });

  it("signed in at the booth: pc_booth_vitals is never visible for SCI with clearance no or not sure", () => {
    for (const condition of ["sci_complete", "sci_incomplete"])
      for (const clearance of ["no", "unsure"] as const)
        for (const position of POSITIONS) {
          const ctx: CheckContext = {
            position,
            support: "none",
            pain: [],
            restrictions: [],
            conditions: [condition],
            clearance,
          };
          const base = baseSelection(ctx, "booth", null);
          const env: PrecheckEnv = {
            setting: "booth",
            ctx,
            setup: null,
            firstCheck: true,
            unresolvedChangeReported: false,
            lastCheckLasting: false,
            baseTests: baseTests(base),
          };
          expect(visibleQuestions(env, {}), `${condition} ${clearance} ${position}`).not.toContain(
            "pc_booth_vitals",
          );
        }
  });

  it("the guest flow ends on the S56 question only in booth setting (never at home)", () => {
    const m = guestAfterSteps({ position: "standing", clearance: "unsure" });
    expect(m.data.setting).toBe("booth");
    expect(NOW).toBeGreaterThan(0);
  });
});
