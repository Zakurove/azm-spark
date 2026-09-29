/**
 * The words and numbers of the results pages (UX spec 0.2, S50 to S54, Q30, O8, Q33 (4)): Arabic
 * plural forms, Arabic Indic digits, changes said in words (never a sign or a dash), counts without a
 * unit in the change line, the Q1 band sentence, the result sentence tokens, the lock time, dates in
 * Gregorian with Arabic month names, and the S27 group of a skip reason.
 */
import { describe, expect, it } from "vitest";
import { CHECK_DATA } from "../src/movements/assessments";
import {
  bandSentence,
  changeText,
  dayLabel,
  isCountUnit,
  isReasonId,
  moreThan,
  nextDueText,
  reasonGroup,
  resultSentence,
  resultUnitOf,
  sideLabel,
  valueParts,
  weekStartMs,
  whenText,
} from "../src/features/progress/format";

const DASHES = /[-‐-―−]/;
const LATIN_DIGIT = /[0-9]/;

describe("values with units in words (S51)", () => {
  it("uses the Arabic plural forms by the number", () => {
    expect(valueParts("ar", "deg", 120)).toEqual({ number: "١٢٠", unit: "درجة", phrase: "١٢٠ درجة" });
    expect(valueParts("ar", "deg", 104).unit).toBe("درجات");
    expect(valueParts("ar", "deg", 7)).toEqual({ number: "٧", unit: "درجات", phrase: "٧ درجات" });
    expect(valueParts("ar", "bends", 11).phrase).toBe("١١ مرة");
    expect(valueParts("en", "deg", 1)).toEqual({ number: "1", unit: "degree", phrase: "1 degree" });
    expect(valueParts("en", "stands", 12).phrase).toBe("12 stands");
  });

  it("reads one and two as the number and the word together, never «٢ مرتين» (0.1)", () => {
    expect(valueParts("ar", "bends", 2).phrase).toBe("مرتين");
    expect(valueParts("ar", "deg", 1).phrase).toBe("درجة واحدة");
    // The visible pair beside the big number reads as a label: the digit with the counted noun.
    expect(valueParts("ar", "bends", 2)).toMatchObject({ number: "٢", unit: "مرة" });
  });

  it("never shows a negative value", () => {
    expect(valueParts("en", "deg", -5).number).toBe("5");
  });

  it("shows a censored side lean value as more than its value", () => {
    expect(moreThan("ar", 15)).toBe(`${CHECK_DATA.progress.noVerdict.censored.ar.replace("{value}", "١٥")}`);
    expect(moreThan("en", 15)).toContain("15");
  });

  it("knows the unit of each test (resultUnit)", () => {
    expect(resultUnitOf("shoulder_abduction")).toBe("deg");
    expect(resultUnitOf("arm_curl_30s")).toBe("bends");
    expect(resultUnitOf("chair_stand_30s")).toBe("stands");
    expect(isCountUnit("bends") && isCountUnit("stands") && !isCountUnit("deg")).toBe(true);
  });
});

describe("the change from the start (S52, O8)", () => {
  it("says a decrease in words, never with a sign or a dash", () => {
    const down = changeText("ar", -17, "deg");
    expect(down).toBe("نقص ١٧ درجة عن البداية");
    expect(changeText("en", -17, "deg")).toBe("17 degrees below your start");
    for (const text of [down, changeText("en", -3, "bends"), changeText("ar", -2, "deg")])
      expect(text).not.toMatch(DASHES);
  });

  it("gives counts without the unit (O8) and the dual in Arabic for degrees", () => {
    expect(changeText("ar", 3, "bends")).toBe("زيادة ٣ عن البداية");
    expect(changeText("en", -2, "stands")).toBe("2 fewer than at your start");
    expect(changeText("ar", 2, "deg")).toBe("زيادة درجتين عن البداية");
  });

  it("says exactly the same at zero", () => {
    expect(changeText("en", 0, "deg")).toBe("Exactly the same as your start");
  });
});

describe("the band sentence and the result sentence", () => {
  it("states the band used with the Q1 wording (نعدّه with its shadda)", () => {
    const ar = bandSentence("ar", 16, "deg");
    expect(ar).toContain("١٦ درجة");
    expect(ar).toContain("نعدّه");
    expect(bandSentence("en", 5, "bends")).toContain("5 bends");
  });

  it("fills the side, the load, the variant, the seconds and the value", () => {
    const curl = resultSentence("ar", "arm_curl_30s", "left", 14, {
      detail: { loadObject: "bottle", loadL: 0.5 },
    });
    expect(curl).toContain("اليسرى");
    expect(curl).toContain("١٤ مرة");
    expect(curl).toContain("٣٠ ثانية");
    expect(curl).not.toMatch(LATIN_DIGIT);
    expect(
      resultSentence("en", "arm_curl_30s", "right", 12, { detail: { loadObject: "dumbbell", loadKg: 2.5 } }),
    ).toBe("With your right arm and a 2.5 kg weight, you did 12 full bends in 30 seconds.");
    expect(resultSentence("en", "shoulder_abduction", "left", 120)).toBe(
      "Your left arm rose to 120 degrees from your side.",
    );
    expect(resultSentence("ar", "chair_stand_30s", "none", 9, { variant: "arms_assisted" })).toContain(
      "بيديك",
    );
  });

  it("makes a unit word that does not follow its number agree with the value", () => {
    expect(resultSentence("en", "arm_curl_30s", "right", 1, { detail: {} })).toContain(
      "you did 1 full bend in",
    );
    expect(resultSentence("ar", "arm_curl_30s", "right", 2, { detail: {} })).toContain("مرتين");
  });
});

describe("dates, sides and the lock time", () => {
  const OCT_25 = Date.UTC(2026, 9, 25, 9);
  it("writes Gregorian dates with Arabic month names and Arabic Indic digits (Q30)", () => {
    expect(dayLabel("ar", OCT_25)).toBe("الأحد، ٢٥ أكتوبر");
    expect(dayLabel("en", OCT_25)).toBe("Sunday 25 October");
    expect(dayLabel("en", OCT_25, { weekday: false, year: true })).toBe("25 October 2026");
    expect(nextDueText("ar", OCT_25)).toContain("الأحد، ٢٥ أكتوبر");
  });

  it("uses the Riyadh day, not the device's (S01)", () => {
    // 22:30 UTC is already the next day in Riyadh.
    expect(dayLabel("en", Date.UTC(2026, 9, 24, 22, 30), { weekday: false })).toBe("25 October");
  });

  it("names the side in the S27 words", () => {
    expect(sideLabel("ar", "shoulder_abduction", "right")).toBe("ذراعك اليمنى");
    expect(sideLabel("en", "trunk_control_seated", "left")).toMatch(/left/i);
    expect(sideLabel("en", "chair_stand_30s", "none")).toBeNull();
  });

  it("keeps the clock time of a lock in reading order and uses the pausedWhen line (Q33 (4))", () => {
    const ar = whenText("ar", { token: "nextDay_clock", time: { hour: 7, minute: 5, suffix: "am" } })!;
    expect(ar).toContain("⁦٧:٠٥⁩");
    expect(ar).toContain(CHECK_DATA.pausedWhenTokens.timeSuffix.am.ar);
    const en = whenText("en", { token: "nextDay_clock", time: { hour: 7, minute: 50, suffix: "am" } })!;
    expect(en).toContain("7:50");
    expect(whenText("en", null)).toBeNull();
    expect(whenText("en", { token: "min60_start" })).not.toContain("{");
  });

  it("reads a week start as an ISO day or epoch ms", () => {
    expect(weekStartMs("2026-09-27")).toBe(Date.UTC(2026, 8, 27, 9));
    expect(weekStartMs(5)).toBe(5);
    expect(weekStartMs("soon")).toBeNull();
  });
});

describe("the S27 group of a skip reason", () => {
  it("puts intake level reasons under «Not part of your check» and day reasons under «Not today»", () => {
    expect(reasonGroup("position_seated")).toBe("notPart");
    expect(reasonGroup("restriction_balance")).toBe("notPart");
    expect(reasonGroup("pain_today")).toBe("notToday");
    expect(reasonGroup("by_choice")).toBe("notToday");
  });

  it("lets the trigger decide: an intake reason set on the day is «Not today»", () => {
    expect(reasonGroup("clearance", true)).toBe("notToday");
    expect(reasonGroup("clearance", false)).toBe("notPart");
  });

  it("knows which reasons have a text in the check data", () => {
    expect(isReasonId("pain_today")).toBe(true);
    expect(isReasonId("no_such_reason")).toBe(false);
  });
});
