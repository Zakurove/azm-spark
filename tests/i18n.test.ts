/**
 * src/i18n: dictionaries for new feature copy, t(), interpolation, Arabic digits and the Arabic unit
 * plural forms of the movement check data.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DICTIONARIES,
  NAMESPACES,
  countPhrase,
  createTranslator,
  formatNumber,
  interpolate,
  isUnitFormId,
  localizeDigits,
  pluralForm,
  t,
  unitWord,
} from "../src/i18n";
import { CHECK_DATA, testDef } from "../src/movements/assessments";

const DIR = join(__dirname, "../src/i18n");
const files = (lang: string) =>
  readdirSync(join(DIR, lang))
    .filter((f) => f.endsWith(".json"))
    .sort();
const read = (lang: string, file: string) =>
  JSON.parse(readFileSync(join(DIR, lang, file), "utf8")) as unknown;

/** Dotted key of every string leaf, with its value. */
function leaves(v: unknown, prefix = ""): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { [prefix]: v };
  return Object.assign(
    {},
    ...Object.entries(v).map(([k, x]) => leaves(x, prefix ? `${prefix}.${k}` : k)),
  ) as Record<string, unknown>;
}
const tokens = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

describe("dictionaries", () => {
  it("has the same namespace files in Arabic and English, all registered", () => {
    expect(files("ar")).toEqual(files("en"));
    expect(files("en").map((f) => f.replace(/\.json$/, ""))).toEqual([...NAMESPACES].sort());
    for (const ns of ["assessment", "progress", "landing"]) expect(NAMESPACES).toContain(ns);
  });

  it.each(files("en"))("%s has identical key sets in Arabic and English", (file) => {
    const ar = leaves(read("ar", file));
    const en = leaves(read("en", file));
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    const ns = file.replace(/\.json$/, "") as (typeof NAMESPACES)[number];
    expect(DICTIONARIES.ar[ns]).toEqual(read("ar", file));
    expect(DICTIONARIES.en[ns]).toEqual(read("en", file));
    for (const [key, value] of Object.entries(en)) {
      if (key === "") continue; // an empty namespace
      expect(typeof value, `${file} ${key}`).toBe("string");
      expect(typeof ar[key], `${file} ${key}`).toBe("string");
      expect((value as string).trim(), `${file} ${key}`).not.toBe("");
      expect((ar[key] as string).trim(), `${file} ${key}`).not.toBe("");
      expect(tokens(ar[key] as string), `${file} ${key}`).toEqual(tokens(value as string));
    }
  });

  it("the key check itself catches a key missing in one language", () => {
    expect(Object.keys(leaves({ intro: { title: "a", body: "b" } })).sort()).not.toEqual(
      Object.keys(leaves({ intro: { title: "a" } })).sort(),
    );
  });
});

describe("t()", () => {
  const fixture = {
    ar: {
      assessment: { intro: { title: "فحص الحركة", body: "يستغرق نحو 8 إلى 10 دقائق، يا {name}." } },
      progress: { "flat.key": "مستوى T6", band: "التغير حتى {band} {unit}" },
    },
    en: {
      assessment: { intro: { title: "Movement check", body: "It takes about 8 to 10 minutes, {name}." } },
      progress: { "flat.key": "Level T6", band: "A change of up to {band} {unit}" },
    },
  };
  const tr = createTranslator(fixture);

  it("reads nested and flat keys namespaced by file name", () => {
    expect(tr("en", "assessment.intro.title")).toBe("Movement check");
    expect(tr("ar", "assessment.intro.title")).toBe("فحص الحركة");
    expect(tr("en", "progress.flat.key")).toBe("Level T6");
  });

  it("fills {name} and shows Arabic digits in Arabic", () => {
    expect(tr("en", "assessment.intro.body", { name: "Sara" })).toBe("It takes about 8 to 10 minutes, Sara.");
    expect(tr("ar", "assessment.intro.body", { name: "سارة" })).toBe("يستغرق نحو ٨ إلى ١٠ دقائق، يا سارة.");
    // Latin codes keep their digits.
    expect(tr("ar", "progress.flat.key")).toBe("مستوى T6");
  });

  it("writes a number and its unit with the Arabic plural form", () => {
    expect(tr("ar", "progress.band", { band: 16, unit: "deg" })).toBe("التغير حتى ١٦ درجة");
    expect(tr("ar", "progress.band", { band: 2, unit: "deg" })).toBe("التغير حتى درجتين");
    expect(tr("en", "progress.band", { band: 4, unit: "stands" })).toBe("A change of up to 4 stands");
    expect(tr("en", "progress.band", { band: 1, unit: "stands" })).toBe("A change of up to 1 stand");
  });

  it("returns the key for a missing key and leaves unknown tokens", () => {
    expect(tr("en", "assessment.intro.missing")).toBe("assessment.intro.missing");
    expect(tr("en", "nothing")).toBe("nothing");
    expect(tr("en", "assessment.intro.body")).toBe("It takes about 8 to 10 minutes, {name}.");
  });

  it("is typed over the real dictionaries", () => {
    // The namespaces are empty for now, so no key exists yet; a wrong key is a type error.
    // @ts-expect-error not a key of any namespace
    expect(t("en", "assessment.nothing.here")).toBe("assessment.nothing.here");
  });
});

describe("numbers and digits", () => {
  it("formats numbers with fmtNum and refuses a negative number", () => {
    expect(formatNumber("ar", 30)).toBe("٣٠");
    expect(formatNumber("en", 30)).toBe("30");
    expect(() => formatNumber("en", -5)).toThrow(RangeError);
    expect(() => interpolate("ar", "{x}", { x: -1 })).toThrow(/direction in words/);
    expect(() => formatNumber("ar", Number.NaN)).toThrow(RangeError);
  });

  it("localizes ASCII digits in Arabic, except Latin codes and the 997 and 937 numbers", () => {
    expect(localizeDigits("ar", "يستغرق نحو 8 إلى 10 دقائق")).toBe("يستغرق نحو ٨ إلى ١٠ دقائق");
    expect(localizeDigits("ar", "قارورة 1.5 لتر")).toBe("قارورة ١٫٥ لتر");
    expect(localizeDigits("ar", "عام 2026")).toBe("عام ٢٠٢٦");
    expect(localizeDigits("ar", "المستوى T6 أو أعلى")).toBe("المستوى T6 أو أعلى");
    expect(localizeDigits("ar", "اتصل بالرقم 997 أو 937")).toBe("اتصل بالرقم 997 أو 937");
    expect(localizeDigits("en", "8 to 10 minutes")).toBe("8 to 10 minutes");
  });

  it("leaves no ASCII digit in the Arabic boundary intro", () => {
    expect(localizeDigits("ar", CHECK_DATA.boundary.intro.ar)).not.toMatch(/[0-9]/);
  });
});

describe("Arabic unit plural forms (progress.unitForms)", () => {
  it("uses the Arabic plural categories", () => {
    const cases: [number, string][] = [
      [0, "zero"],
      [1, "one"],
      [2, "two"],
      [3, "few"],
      [10, "few"],
      [11, "many"],
      [99, "many"],
      [100, "other"],
      [102, "other"],
    ];
    for (const [n, form] of cases) expect(pluralForm("ar", n), String(n)).toBe(form);
  });

  it("picks the unit word for each form", () => {
    expect(unitWord("ar", "deg", 0)).toBe("درجة");
    expect(unitWord("ar", "deg", 5)).toBe("درجات");
    expect(unitWord("ar", "deg", 11)).toBe("درجة");
    expect(unitWord("ar", "sec", 3)).toBe("ثوانٍ");
    expect(unitWord("en", "bends", 1)).toBe("bend");
    expect(unitWord("en", "bends", 0)).toBe("bends");
    expect(unitWord("en", "bends", 12)).toBe("bends");
  });

  it("lets the Arabic one and two forms stand for the number and the word", () => {
    expect(countPhrase("ar", "deg", 1)).toBe("درجة واحدة");
    expect(countPhrase("ar", "bends", 2)).toBe("مرتين");
    expect(countPhrase("ar", "stands", 7)).toBe("٧ مرات");
    expect(countPhrase("ar", "deg", 16)).toBe("١٦ درجة");
    expect(countPhrase("ar", "deg", 120)).toBe("١٢٠ درجة");
    expect(countPhrase("ar", "deg", 0)).toBe("٠ درجة");
    expect(countPhrase("en", "deg", 1)).toBe("1 degree");
    expect(countPhrase("en", "deg", 16)).toBe("16 degrees");
  });

  it("fills the result sentences of the check data", () => {
    const abduction = testDef("shoulder_abduction");
    const side = abduction.resultTokens.side.right;
    expect(interpolate("ar", abduction.resultSentence.ar, { side: side.ar, value: 1, unit: "deg" })).toBe(
      "ارتفعت ذراعك اليمنى إلى درجة واحدة من جانبك.",
    );
    expect(interpolate("ar", abduction.resultSentence.ar, { side: side.ar, value: 95, unit: "deg" })).toBe(
      "ارتفعت ذراعك اليمنى إلى ٩٥ درجة من جانبك.",
    );
    expect(interpolate("en", abduction.resultSentence.en, { side: side.en, value: 95, unit: "deg" })).toBe(
      "Your right arm rose to 95 degrees from your side.",
    );
    const stand = testDef("chair_stand_30s");
    expect(
      interpolate("ar", stand.resultSentence.ar, {
        value: 12,
        unit: "stands",
        seconds: 30,
        variant: stand.resultTokens.variant.standard.ar,
      }),
    ).toBe("وقفت وقوفًا كاملًا ١٢ مرة خلال ٣٠ ثانية.");
  });

  it("recognizes unit form ids", () => {
    expect(isUnitFormId("deg")).toBe(true);
    expect(isUnitFormId("count")).toBe(false);
    expect(interpolate("en", "in {unit}", { unit: "deg" })).toBe("in degrees");
  });
});
