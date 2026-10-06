/**
 * D-030 item 2, E3-3: the wheelchair setup line (exercise-targets sessionLines wheelchair_setup, review
 * C11) is shown once before the first seated item of a session, to a wheelchair user: on the
 * workout's setup card, the screen that opens a session (a resumed session saw it at its start).
 * Every item of a wheelchair user's session is seated. The text is the data's, never rewritten.
 */
import { describe, expect, it } from "vitest";
import { wheelchairSetupLine } from "../../src/features/coach-agent/WheelchairSetupLine";
import { TARGETS_DATA } from "../../src/movements/targets";
import { wordingProblems } from "../../scripts/wording-rules.mjs";

const line = TARGETS_DATA.mapping.sessionLines.find((l) => l.id === "wheelchair_setup")!;

describe("the wheelchair setup line of a session", () => {
  it("is the data's line for a wheelchair user, in their language", () => {
    expect(wheelchairSetupLine("wheelchair", TARGETS_DATA, "ar")).toBe(line.ar);
    expect(wheelchairSetupLine("wheelchair", TARGETS_DATA, "en")).toBe(line.en);
    expect(line.en).toMatch(/brakes/);
    for (const lang of ["ar", "en"] as const) expect(wordingProblems(line[lang])).toEqual([]);
  });

  it("is not shown to a person who sits on a chair or stands", () => {
    for (const mobility of ["seated", "standing", undefined])
      expect(wheelchairSetupLine(mobility, TARGETS_DATA, "en"), String(mobility)).toBeNull();
  });
});
