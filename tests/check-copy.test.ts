/**
 * Wording rules of the movement check copy (UX spec 0.2, definition of done) on top of the general
 * wording test (tests/wording.test.ts, which already scans every src/i18n JSON file for dashes and
 * the phrase):
 *   - progress.* and assessment.results.* never hold a stem of the check data's
 *     progress.forbiddenInProgressText (Arabic diacritics and tatweel removed, lower case);
 *   - no key holds a Q23 (6) banned word;
 *   - no UX string says فحص (Q29 renamed the check قياس الحركة);
 *   - no verb stands directly before عزم as its subject (copy rule 12, Q29: unvowelled, «يحتاج عزم»
 *     reads as the noun عَزْم, determination), so عزم comes first («عزم يحتاج»);
 *   - no label ends with a colon.
 * The landing namespace follows the same rules (council Q23 (6), Q29, H1, H2).
 * A failure here is reported to the copy owner; the rule is never weakened to pass.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECK_DATA } from "../src/movements/assessments";

const DIR = join(__dirname, "../src/i18n");
const read = (lang: string, ns: string) =>
  JSON.parse(readFileSync(join(DIR, lang, `${ns}.json`), "utf8")) as unknown;

function leaves(v: unknown, prefix: string): [string, string][] {
  if (typeof v === "string") return [[prefix, v]];
  if (!v || typeof v !== "object") return [];
  return Object.entries(v).flatMap(([k, x]) => leaves(x, `${prefix}.${k}`));
}

const normalise = (s: string) => s.replace(/[ً-ْٰـ]/g, "").toLowerCase();

const COPY = (["ar", "en"] as const).flatMap((lang) =>
  (["assessment", "progress", "landing"] as const).flatMap((ns) =>
    leaves(read(lang, ns), ns).map(([key, text]) => ({ lang, key, text })),
  ),
);

/** Q23 (6): words the product never uses. English matches at a word start; Arabic anywhere. */
const BANNED_EN = [
  "prescribe",
  "treatment",
  "rehabilitation program",
  "recovery",
  "prove",
  "progress",
  "patients",
  "monitor",
];
const BANNED_AR = ["وصفة", "يصف", "إثبات", "تقدم"];

describe("movement check copy", () => {
  it("reads both files in both languages", () => {
    expect(COPY.filter((c) => c.lang === "ar").length).toBe(COPY.filter((c) => c.lang === "en").length);
    expect(COPY.length).toBeGreaterThan(1000);
  });

  it("progress and results copy holds no forbidden stem", () => {
    const stems = CHECK_DATA.progress.forbiddenInProgressText;
    const bad = COPY.filter(
      (c) => c.key.startsWith("progress.") || c.key.startsWith("assessment.results."),
    ).flatMap((c) =>
      stems[c.lang]
        .filter((stem) => normalise(c.text).includes(normalise(stem)))
        .map((stem) => `${c.lang} ${c.key}: ${stem}`),
    );
    expect(bad).toEqual([]);
  });

  it("no copy holds a Q23 (6) banned word", () => {
    const bad = COPY.flatMap((c) => {
      const t = normalise(c.text);
      const words =
        c.lang === "en"
          ? BANNED_EN.filter((w) => new RegExp(`\\b${w}`).test(t))
          : BANNED_AR.filter((w) => t.includes(w));
      return words.map((w) => `${c.lang} ${c.key}: ${w}`);
    });
    expect(bad).toEqual([]);
  });

  it("no UX string calls the check فحص (Q29)", () => {
    expect(
      COPY.filter((c) => c.lang === "ar" && normalise(c.text).includes("فحص")).map((c) => c.key),
    ).toEqual([]);
  });

  it("never puts a verb directly before عزم as its subject (rule 12)", () => {
    const VERB_BEFORE_AZM = /(?:^|[\s،.])(?:ي|ت)[\u0621-\u064A]{2,}\s+عزم(?:$|[\s،.])/;
    const bad = COPY.filter((c) => c.lang === "ar" && VERB_BEFORE_AZM.test(normalise(c.text)));
    expect(bad.map((c) => `${c.key}: ${c.text}`)).toEqual([]);
    // The rule reads the cases of the Arabic review.
    expect(VERB_BEFORE_AZM.test("يحتاج عزم إلى الكاميرا")).toBe(true);
    expect(VERB_BEFORE_AZM.test("يقيس عزم حركتك")).toBe(true);
    expect(VERB_BEFORE_AZM.test("عزم يقيس حركتك")).toBe(false);
  });

  it("no label ends with a colon", () => {
    expect(COPY.filter((c) => /[:：]\s*$/.test(c.text)).map((c) => `${c.lang} ${c.key}`)).toEqual([]);
  });
});
