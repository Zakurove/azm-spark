/**
 * The one shared pain stop rule (product v7 contract C-15, 2.6): pain 6 or more, a rise of 2 or more
 * over the score before, or a sudden sharp pain, in any location; an unknown score before counts as 0.
 * Parity: the constants are read back from the three clinical files, which state the rule in words
 * (rom-protocol safety pain_during, gait-rules eligibility.stops, exercise-targets mobility_pain
 * painRule), so a change to any of them fails here.
 */
import { describe, expect, it } from "vitest";
import { PAIN_STOP, painStopRule } from "../../src/medical/pain-rule";
import { ROM_DATA } from "../../src/movements/rom";
import { GAIT_DATA } from "../../src/movements/gait";
import { TARGETS_DATA } from "../../src/movements/targets";

const numbers = (text: string, re: RegExp): number[] => {
  const m = re.exec(text);
  if (!m) throw new Error(`rule text not found: ${re} in «${text}»`);
  return m.slice(1).map(Number);
};

describe("PAIN_STOP parity with the three clinical files", () => {
  it("rom-protocol safety pain_during", () => {
    const row = ROM_DATA.safety.find((s) => s.id === "pain_during");
    expect(row).toBeDefined();
    const rule = row!.rule;
    expect(numbers(rule, /pain (\d+) or more out of 10, or (\d+) or more above/)).toEqual([
      PAIN_STOP.atOrAbove,
      PAIN_STOP.riseOf,
    ]);
    expect(rule).toContain("a sudden sharp pain");
    expect(row!.action).toContain("Stop that movement");
  });

  it("gait-rules eligibility.stops", () => {
    const stop = GAIT_DATA.eligibility.stops.find((s) => s.includes("sharp pain"));
    expect(stop).toBeDefined();
    expect(numbers(stop!, /pain (\d+) or more, a rise of (\d+) or more over the score before/)).toEqual([
      PAIN_STOP.atOrAbove,
      PAIN_STOP.riseOf,
    ]);
    expect(stop).toContain("a sudden sharp pain ends the test");
  });

  it("exercise-targets mobility_pain painRule", () => {
    const profile = TARGETS_DATA.dose.profiles.find((p) => p.id === "mobility_pain");
    const rule = profile?.numbers.painRule;
    expect(typeof rule).toBe("string");
    expect(numbers(rule!, /stop at (\d+) or more, a rise of (\d+) or more, or any sharp pain/)).toEqual([
      PAIN_STOP.atOrAbove,
      PAIN_STOP.riseOf,
    ]);
  });

  it("is 6 and 2", () => {
    expect(PAIN_STOP).toEqual({ atOrAbove: 6, riseOf: 2 });
  });
});

describe("painStopRule", () => {
  it.each([
    // [level, sharp, before, stop, why]
    [6, false, 6, true, "level"],
    [10, false, 0, true, "level"],
    [7, true, null, true, "level"],
    [5, false, 3, true, "rise"],
    [4, false, 2, true, "rise"],
    [5, false, 4, false, null],
    [5, false, 5, false, null],
    [3, false, 5, false, null],
    [0, false, 0, false, null],
    [3, true, 3, true, "sharp"],
    [0, true, null, true, "sharp"],
  ] as const)("level %s, sharp %s, before %s: stop %s (%s)", (level, sharp, before, stop, why) => {
    expect(painStopRule(level, sharp, before)).toEqual({ stop, why });
  });

  it("an unknown score before counts as 0", () => {
    expect(painStopRule(2, false, null)).toEqual({ stop: true, why: "rise" });
    expect(painStopRule(1, false, null)).toEqual({ stop: false, why: null });
    expect(painStopRule(2, false, null)).toEqual(painStopRule(2, false, 0));
  });

  it("stops at exactly the thresholds and not one below", () => {
    expect(painStopRule(PAIN_STOP.atOrAbove, false, PAIN_STOP.atOrAbove).stop).toBe(true);
    expect(painStopRule(PAIN_STOP.atOrAbove - 1, false, PAIN_STOP.atOrAbove - 1).stop).toBe(false);
    expect(painStopRule(3 + PAIN_STOP.riseOf, false, 3).stop).toBe(true);
    expect(painStopRule(3 + PAIN_STOP.riseOf - 1, false, 3).stop).toBe(false);
  });

  it("a score that is not a number stops (the safe side); a score before that is not a number counts as 0", () => {
    expect(painStopRule(Number.NaN, false, 0)).toEqual({ stop: true, why: "level" });
    expect(painStopRule(Number.POSITIVE_INFINITY, false, 0)).toEqual({ stop: true, why: "level" });
    expect(painStopRule(1, false, Number.NaN)).toEqual({ stop: false, why: null });
    expect(painStopRule(2, false, Number.NaN)).toEqual({ stop: true, why: "rise" });
  });
});
