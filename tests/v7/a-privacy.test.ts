/**
 * The privacy notice's focus check paragraph (product v7 contract 1.2 privacy.json; D-024 item 5,
 * A5-14 with A2-14): in a VITE_V7 build the notice says why the range and walking results are kept
 * and what is kept with them, naming the new health data of a v7 intake (sex, height and the body
 * map). A default build shows the notice exactly as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { t } from "../../src/i18n";
import { wordingProblems } from "../../scripts/wording-rules.mjs";

async function privacyPage(v7: boolean, lang: "ar" | "en") {
  vi.resetModules();
  vi.doMock("../../src/app/v7flag", () => ({ V7_UI: v7 }));
  const Privacy = (await import("../../src/app/Privacy")).default;
  return renderToStaticMarkup(createElement(Privacy, { lang, onLanguage: () => {}, onBack: () => {} }));
}
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the focus check paragraph of the privacy notice", () => {
  afterEach(() => {
    vi.doUnmock("../../src/app/v7flag");
    vi.resetModules();
  });

  it("names sex, height and the body map with the results it keeps, Arabic first", () => {
    expect(t("ar", "privacy.kept.focus")).toContain("جنسك");
    expect(t("ar", "privacy.kept.focus")).toContain("طولك");
    expect(t("ar", "privacy.kept.focus")).toContain("خريطة الجسم");
    expect(t("en", "privacy.kept.focus")).toMatch(
      /your sex, your height and the areas you marked on the body map/,
    );
    // Numbers only, one step as skeleton lines, no picture: the stored gait replay (C-12, section 3).
    expect(t("en", "privacy.kept.focus")).toMatch(/numbers only/);
    expect(t("en", "privacy.kept.focus")).toMatch(/skeleton lines with no picture/);
    expect(t("en", "privacy.purposes.focus")).toMatch(/usual for your sex and age/);
    // Of the day's answers a focus check keeps only those a later step reads (R1-2, D-026 items 7 and
    // 9), and the notice names each of them: the pain score per area and the pain marked during the
    // walk, someone with the person, a fall, unsteadiness or the worry about falling, and the leg
    // prosthesis (D-032 item 2: the day's one screen asks nothing else). No red flag answer is ever
    // kept (E1-5).
    const en = t("en", "privacy.kept.focus");
    for (const words of [
      /pain score of each area/,
      /pain you marked during the walk/,
      /whether someone was with you/,
      /whether you have fallen, feel unsteady or worry about falling/,
      /whether you wore your leg prosthesis/,
    ])
      expect(en).toMatch(words);
    expect(en).not.toMatch(/Parkinson|armrests|pressure sore/);
    const ar = t("ar", "privacy.kept.focus");
    for (const words of [
      "درجة الألم في كل منطقة",
      "الألم الذي ذكرته أثناء المشي",
      "معك أحد",
      "تخشى السقوط",
      "طرفك الصناعي",
    ])
      expect(ar).toContain(words);
    for (const key of ["privacy.purposes.focus", "privacy.kept.focus"] as const)
      for (const lang of ["ar", "en"] as const)
        expect(wordingProblems(t(lang, key)), `${key} ${lang}`).toEqual([]);
  });

  it("shows the paragraph in a v7 build, in both languages", async () => {
    for (const lang of ["ar", "en"] as const) {
      const text = plain(await privacyPage(true, lang));
      expect(text, lang).toContain(t(lang, "privacy.purposes.focus"));
      expect(text, lang).toContain(t(lang, "privacy.kept.focus"));
      // Next to the movement check's own lines.
      expect(text.indexOf(t(lang, "privacy.purposes.focus"))).toBeGreaterThan(
        text.indexOf(t(lang, "privacy.purposes.check")),
      );
      expect(text.indexOf(t(lang, "privacy.kept.focus"))).toBeGreaterThan(
        text.indexOf(t(lang, "privacy.kept.check")),
      );
    }
  });

  it("leaves a default build's notice as it was", async () => {
    const text = plain(await privacyPage(false, "en"));
    expect(text).toContain(t("en", "privacy.kept.check"));
    expect(text).not.toContain(t("en", "privacy.kept.focus"));
    expect(text).not.toContain(t("en", "privacy.purposes.focus"));
  });
});
