/**
 * The example of the results page (UX spec S54, D-008): a bundled fixture of stored results only, no
 * person and no name, compared by the same rules as the real page, with everything the spec asks the
 * example to show: a series with 4 checks and its trend, a higher and an about the same row with the
 * band sentence, a no verdict case (shoulder pain), a side lean with its starting point set, a booth
 * point and a sessions block. Dates sit in a fixed past year.
 */
import { describe, expect, it } from "vitest";
import fixture from "../src/features/progress/example-fixture.json";
import {
  EXAMPLE_PERSON,
  exampleResults,
  exampleSessions,
  exampleViews,
} from "../src/features/progress/example";
import { seriesCards } from "../src/features/progress/series";

describe("the example fixture (S54, D-008)", () => {
  const views = exampleViews();
  const cards = seriesCards(views, EXAMPLE_PERSON);

  it("holds stored results only: no person, no name, no verdict of its own", () => {
    const text = JSON.stringify(fixture);
    expect(text).not.toMatch(/"(name|email|verdict|change|userId)"/);
    expect(Object.keys(fixture.person).sort()).toEqual([
      "conditions",
      "pain",
      "position",
      "setup",
      "support",
    ]);
    for (const r of fixture.results) expect(Object.keys(r)).not.toContain("verdict");
  });

  it("keeps every date in a fixed past year, never in the future", () => {
    const years = new Set(exampleResults().map((r) => new Date(r.created).getUTCFullYear()));
    expect([...years]).toEqual([2025]);
    expect(Math.max(...exampleResults().map((r) => r.created))).toBeLessThan(Date.UTC(2026, 0, 1));
  });

  it("shows a series with 4 checks and its trend", () => {
    expect(cards.some((c) => (c.view.points?.length ?? 0) >= 4)).toBe(true);
  });

  it("shows a higher row and an about the same row, from the rules", () => {
    const verdicts = cards.map((c) => c.view.verdict);
    expect(verdicts).toContain("higher");
    expect(verdicts).toContain("same");
    const higher = cards.findIndex((c) => c.view.verdict === "higher");
    const same = cards.findIndex((c) => c.view.verdict === "same");
    expect(Math.abs(higher - same)).toBe(1);
  });

  it("shows a no verdict case for shoulder pain, a side lean starting point and a booth point", () => {
    expect(cards.some((c) => c.view.noVerdict === "shoulderPain")).toBe(true);
    expect(cards.some((c) => c.view.testId === "trunk_control_seated" && c.view.startingPointSet)).toBe(true);
    expect(cards.some((c) => c.boothPoints.length > 0)).toBe(true);
    expect(cards.some((c) => c.view.setting === "booth")).toBe(true);
  });

  it("has a sessions block with weeks and tiles", () => {
    const s = exampleSessions();
    expect(s.sessions.weeks).toHaveLength(8);
    expect(s.validShare).not.toBeNull();
    expect(s.activeMinutesPerWeek).not.toBeNull();
    expect(s.avgEffort).not.toBeNull();
  });

  it("computes the same views every time (bundled, offline)", () => {
    expect(exampleViews()).toEqual(views);
  });
});
