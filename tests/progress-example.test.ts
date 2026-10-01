/**
 * The example of the results page (UX spec S54, D-008, C37): a bundled fixture of stored results only,
 * no person and no name, compared by the same rules as the real page: one series, start and now with
 * its verdict in words. Dates sit in a fixed past year.
 */
import { describe, expect, it } from "vitest";
import fixture from "../src/features/progress/example-fixture.json";
import { EXAMPLE_PERSON, exampleResults, exampleViews } from "../src/features/progress/example";
import { seriesCards } from "../src/features/progress/series";

describe("the example fixture (S54, D-008, C37)", () => {
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

  it("shows one series, start and now, with a verdict from the rules", () => {
    expect(cards).toHaveLength(1);
    const v = cards[0].view;
    expect(v.testId).toBe("shoulder_abduction");
    expect(v.baseline?.value).toBe(100);
    expect(v.latest.value).toBe(124);
    expect(v.verdict).toBe("higher");
  });

  it("computes the same views every time (bundled, offline)", () => {
    expect(exampleViews()).toEqual(views);
  });
});
