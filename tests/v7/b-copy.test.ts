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
