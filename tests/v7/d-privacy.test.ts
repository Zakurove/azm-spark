/**
 * Step D5: the live coach's paragraph of the privacy notice (product v7 contract 1.2 privacy.json, D in
 * wave 2; C-8, C-12; section 12 item 4): why the coach receives data, that Google, a processor outside
 * the Kingdom, receives the voice and the short events and never the name, contact details, medical
 * condition or any picture, and how long Google keeps it (live.md 13: a short time after the session,
 * safety logs up to 55 days). In a v7 build only; a default build shows the notice as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { t } from "../../src/i18n";
import { wordingProblems } from "../../scripts/wording-rules.mjs";

const KEYS = ["privacy.purposes.coach", "privacy.receivers.google", "privacy.retention.google"] as const;

async function privacyPage(v7: boolean, lang: "ar" | "en") {
  vi.resetModules();
  vi.doMock("../../src/app/v7flag", () => ({ V7_UI: v7 }));
  const Privacy = (await import("../../src/app/Privacy")).default;
  return renderToStaticMarkup(createElement(Privacy, { lang, onLanguage: () => {}, onBack: () => {} }));
}
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the live coach paragraph of the privacy notice", () => {
  afterEach(() => {
    vi.doUnmock("../../src/app/v7flag");
    vi.resetModules();
  });

  it("names the processor, the transfer, what it receives and never receives, and its retention", () => {
    const en = (k: (typeof KEYS)[number]) => t("en", k);
    expect(en("privacy.purposes.coach")).toMatch(/Live coach.*when you turn it on/);
    expect(en("privacy.receivers.google")).toMatch(/Google, a company outside Saudi Arabia/);
    expect(en("privacy.receivers.google")).toMatch(/your voice/);
    expect(en("privacy.receivers.google")).toMatch(
      /never receives your name, email, age, sex.*picture or video/,
    );
    expect(en("privacy.retention.google")).toMatch(/do not keep the text/);
    expect(en("privacy.retention.google")).toMatch(/short time.*55 days/);
    expect(t("ar", "privacy.receivers.google")).toContain("خارج المملكة");
    expect(t("ar", "privacy.retention.google")).toContain("٥٥ يومًا");
    for (const key of KEYS)
      for (const lang of ["ar", "en"] as const)
        expect(wordingProblems(t(lang, key)), `${key} ${lang}`).toEqual([]);
  });

  it("shows the paragraph in a v7 build, in both languages, and never in a default build", async () => {
    for (const lang of ["ar", "en"] as const) {
      // The end of each line (Latin words inside Arabic are wrapped for direction, so not the start).
      const tail = (key: (typeof KEYS)[number]) => t(lang, key).slice(-30);
      const v7 = plain(await privacyPage(true, lang));
      for (const key of KEYS) expect(v7, `${key} ${lang}`).toContain(tail(key));
      const v1 = plain(await privacyPage(false, lang));
      for (const key of KEYS) expect(v1, `${key} ${lang}`).not.toContain(tail(key));
    }
  });
});
