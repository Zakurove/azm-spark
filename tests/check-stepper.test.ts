/**
 * The shared count stepper (S48 self count, S57 staff count; UX spec S48, S57, 0.2): whole counts in
 * range from ASCII, Arabic Indic and Persian digits; the minus and plus controls carry the
 * assessment.count names; the range line uses assessment.count.range in the page's digits.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckRoot } from "../src/features/assessment/shared/CheckRoot";
import { CountStepper, parseCount } from "../src/features/assessment/shared/CountStepper";
import { t, type Lang } from "../src/i18n";

describe("parseCount", () => {
  it("reads whole counts in any digits inside the range", () => {
    expect(parseCount("12", 0, 60)).toBe(12);
    expect(parseCount("١٢", 0, 60)).toBe(12);
    expect(parseCount("۱۲", 0, 60)).toBe(12);
    expect(parseCount(" 0 ", 0, 60)).toBe(0);
    expect(parseCount("60", 0, 60)).toBe(60);
  });
  it("refuses fractions, out of range values and text", () => {
    expect(parseCount("12.5", 0, 60)).toBeNull();
    expect(parseCount("١٢٫٥", 0, 60)).toBeNull();
    expect(parseCount("61", 0, 60)).toBeNull();
    expect(parseCount("", 0, 60)).toBeNull();
    expect(parseCount("abc", 0, 60)).toBeNull();
  });
});

const render = (lang: Lang, invalid: boolean) =>
  renderToStaticMarkup(
    createElement(
      CheckRoot,
      { ui: { lang }, page: false },
      createElement(CountStepper, {
        label: t(lang, "assessment.count.howMany"),
        text: lang === "ar" ? "١٢" : "12",
        onText: () => undefined,
        min: 0,
        max: 60,
        invalid,
      }),
    ),
  );

describe("CountStepper", () => {
  for (const lang of ["ar", "en"] as const) {
    it(`names its controls and shows the range line (${lang})`, () => {
      const html = render(lang, true);
      expect(html).toContain(`aria-label="${t(lang, "assessment.count.decrease")}"`);
      expect(html).toContain(`aria-label="${t(lang, "assessment.count.increase")}"`);
      expect(html).toContain('inputMode="numeric"');
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('role="alert"');
      // The range line in the page's digits.
      expect(html).toContain(lang === "ar" ? "٦٠" : "60");
      expect(render(lang, false)).not.toContain('role="alert"');
    });
  }
});
