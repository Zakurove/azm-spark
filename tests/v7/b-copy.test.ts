/**
 * Wave 2 fix (copy review): the focus check's words follow the copy glossary
 * (local-docs/ux/copy/README.md) and v1's strings: «أنهِ القياس» and «تابع القياس» to leave or stay,
 * «في الانتظار» for a paused measurement (never a phase word built on توقف), «تابع», «محاولة
 * تجريبية», the pain scale's own anchors, the curly apostrophe in English; and the leave dialog says
 * what happens to a check left open (it is not resumed: the next start begins again).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ar from "../../src/i18n/ar/rom.json";
import en from "../../src/i18n/en/rom.json";
import { LeaveDialog } from "../../src/features/focus/Screens";
import { PainScale } from "../../src/features/focus/parts";
import { CHECK_DATA } from "../../src/movements/assessments";

const strings = (o: unknown): string[] =>
  typeof o === "string" ? [o] : o && typeof o === "object" ? Object.values(o).flatMap(strings) : [];

describe("the focus check's words", () => {
  it("leave with «أنهِ القياس», stay with «تابع القياس», and say the check starts again next time", () => {
    const html = renderToStaticMarkup(
      createElement(LeaveDialog, { lang: "ar", onStay: () => {}, onLeave: () => {} }),
    );
    expect(html).toContain("هل تريد إنهاء القياس الآن؟");
    expect(html).toContain("إذا خرجت الآن فلن يكتمل هذا القياس، وتبدأ من جديد في المرة القادمة.");
    expect(html).toContain("نعم، أنهِ القياس");
    expect(html).toContain("تابع القياس");
    expect(html).not.toContain("محفوظ");
  });

  it("use the glossary's words, never a phase word built on توقف, and curly apostrophes in English", () => {
    const all = strings(ar).join(" | ");
    for (const banned of ["متوقف مؤقتًا", "ابقَ في القياس", "اخرج من القياس", "تابع بالمناطق"])
      expect(all).not.toContain(banned);
    expect(ar.measure.paused).toBe("في الانتظار");
    expect(ar.measure.practice).toBe("محاولة تجريبية");
    expect(ar.result.finish).toBe("تابع");
    for (const s of strings(en)) expect(s, s).not.toContain("'");
  });

  it("names the pain scale's ends as the check data's anchors", () => {
    const html = renderToStaticMarkup(
      createElement(PainScale, { lang: "ar", labelledBy: "q", nextLabel: "التالي", onDone: () => {} }),
    );
    expect(html).toContain(CHECK_DATA.painScale.anchors.zero.ar);
    expect(html).toContain(CHECK_DATA.painScale.anchors.ten.ar);
  });
});

describe("numbers with their unit (copy tone rule 9)", () => {
  it("never puts «درجتين» or «درجة واحدة» under the digits of the dial", async () => {
    const { Dial, dialUnit } = await import("../../src/features/focus/Dial");
    expect(dialUnit("ar", 1)).toBe("درجة");
    expect(dialUnit("ar", 2)).toBe("درجة");
    expect(dialUnit("ar", 5)).toBe("درجات");
    expect(dialUnit("ar", 12)).toBe("درجة");
    expect(dialUnit("en", 1)).toBe("degree");
    const html = renderToStaticMarkup(
      createElement(Dial, {
        lang: "ar",
        kind: "flexion",
        value: 2,
        typical: null,
        withinFrom: null,
        withinUpTo: null,
        max: 30,
        typicalLabel: "المعتاد",
      }),
    );
    expect(html).not.toContain("درجتين");
  });

  it("writes a step length in centimetres as «سم», as the intake writes the height", () => {
    expect(ar.findings.walk.stepValue).toBe("{n} سم");
    expect(en.findings.walk.stepValue).toBe("{n} cm");
  });
});

describe("the low UI fixes (UI review)", () => {
  const css = (f: string) =>
    require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../../src/features/focus", f),
      "utf8",
    ) as string;

  it("gives the pain cells v1's 46 to 52 px, the view buttons and the privacy link 44 px", () => {
    const focus = css("focus.css");
    expect(focus).toMatch(/\.fx-scale \{[^}]*grid-template-columns: repeat\(6, minmax\(46px, 52px\)\)/);
    expect(focus).not.toMatch(/\.bm-views button \{[^}]*min-height: 40px/);
    expect(focus).toMatch(/\.fx-link \{[^}]*min-height: 44px/);
  });

  it("names the try dots as an image, and never says part 4 of 3", async () => {
    const { Dots, TopBar } = await import("../../src/features/focus/parts");
    const dots = renderToStaticMarkup(createElement(Dots, { lang: "en", total: 3, index: 1, valid: 0 }));
    expect(dots).toMatch(/class="fx-dots" role="img" aria-label=/);
    const done = renderToStaticMarkup(createElement(TopBar, { lang: "en", progress: { done: 3, total: 3 } }));
    expect(done).toContain('aria-label="Part 3 of 3"');
  });

  it("keeps the findings page's tall aside within the viewport and draws typical without gold", () => {
    const findings = css("findings.css");
    expect(findings).toMatch(/\.fx-findings-aside \{[^}]*max-height: calc\(100dvh - 92px\)/);
    expect(findings).toMatch(/\.fx-bar-band \{\s*background: rgba\(93, 98, 109, 0\.2\);/);
  });
});
