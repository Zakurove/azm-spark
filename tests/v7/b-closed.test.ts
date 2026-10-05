/**
 * Wave 2 fix (copy review): the too soon screen names the date and time the next check opens (the last
 * completed check plus 48 hours), as v1's entry card does, never «tomorrow» for a check two days away;
 * «يمكنك» for permission (the copy glossary).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClosedScreen } from "../../src/features/focus/Screens";

const render = (lang: "ar" | "en", now: number, until: number) =>
  renderToStaticMarkup(
    createElement(ClosedScreen, {
      lang,
      why: "too_soon",
      until,
      now,
      onToday: () => {},
      onHealth: () => {},
    }),
  );

describe("the too soon screen", () => {
  // A check completed Monday 5 October 2026 at 10:00 in Riyadh, reopened at 15:00 the same day.
  const done = Date.UTC(2026, 9, 5, 7, 0);
  const now = done + 5 * 3_600_000;
  const until = done + 48 * 3_600_000;

  it("names the weekday, the date and the time it opens, never tomorrow", () => {
    const ar = render("ar", now, until);
    expect(ar).toContain("يمكنك أن تبدأ قياسك التالي ابتداءً من");
    expect(ar).toContain("الأربعاء");
    expect(ar).not.toContain("غدًا");
    const en = render("en", now, until);
    expect(en).toContain("You can start your next check from");
    expect(en).toContain("Wednesday");
    expect(en).toMatch(/10:00/);
    expect(en).not.toMatch(/tomorrow/i);
  });
});
