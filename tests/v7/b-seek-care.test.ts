/**
 * Wave 2 fix (copy review): a yes to rf_region opens a region's own screen. It names the region that
 * will not be measured today, keeps the seek care advice without v1's «لنتوقف هنا» (the check goes on),
 * and goes on with «تابع قياس المناطق الأخرى». v1's screen stays for a check with nothing else to measure.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegionSeekCareScreen } from "../../src/features/focus/Screens";

const html = (lang: "ar" | "en", regions: ("knee" | "shoulder")[]) =>
  renderToStaticMarkup(createElement(RegionSeekCareScreen, { lang, regions, onContinue: () => {} }));

describe("the red flag region screen (rf_region yes)", () => {
  it("names the region, keeps the care advice and the 937 call, and goes on to the other areas", () => {
    const ar = html("ar", ["knee"]);
    expect(ar).toContain("لن نقيس الركبة اليوم");
    expect(ar).not.toContain("لنتوقف هنا");
    expect(ar).toContain("فتواصل مع طبيبك أو فريق رعايتك");
    expect(ar).toContain('href="tel:937"');
    expect(ar).toContain("تابع قياس المناطق الأخرى");
    const en = html("en", ["knee", "shoulder"]);
    expect(en).toContain("We will not measure your knee and shoulder today");
    expect(en).not.toContain("Let’s stop here");
    expect(en).toContain("Continue measuring the other areas");
  });
});
