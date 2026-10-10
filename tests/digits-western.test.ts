/**
 * D-036 item 3 (Nasser, replacing council Q30's Arabic Indic digits): the Arabic interface shows
 * Western digits 0 to 9 and "." as the decimal mark, never ٠ to ٩ (U+0660 to U+0669), the Persian
 * ۰ to ۹ (U+06F0 to U+06F9) or ٫ (U+066B). Dates keep the Gregorian calendar with Arabic month names.
 * Text stored or written before D-036 (old weekly summaries and holds, a model's Arabic) is shown in
 * Western digits too. Typed Arabic Indic and Persian digits are still read (parseNumberInput).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AR_LOCALE, fmtDate, fmtNum, fmtTime, pct, westernDigits } from "../src/app/i18n";
import { countPhrase, formatNumber, interpolate, localizeDigits, t } from "../src/i18n";
import { parseNumberInput } from "../src/features/assessment/shared/format";
import { cleanText, stepsOf, summaryText } from "../src/medical/weekly";

/** Any digit or decimal mark of the Arabic Indic or Persian systems. */
const EASTERN = /[٠-٩۰-۹٫]/;

/** 4 October 2026, 15:05 in Riyadh (12:05 UTC), a Sunday. */
const OCT_4 = Date.UTC(2026, 9, 4, 12, 5);
const RIYADH = { timeZone: "Asia/Riyadh" } as const;

describe("numbers in Arabic (fmtNum, formatNumber, pct)", () => {
  it("writes integers, decimals and grouped numbers in Western digits", () => {
    expect(AR_LOCALE).toBe("ar-SA-u-nu-latn");
    expect(fmtNum(0, "ar")).toBe("0");
    expect(fmtNum(7, "ar")).toBe("7");
    expect(fmtNum(120, "ar")).toBe("120");
    expect(fmtNum(0.95, "ar")).toBe("0.95");
    expect(fmtNum(1.12, "ar")).toBe("1.12");
    expect(fmtNum(1234.5, "ar")).toBe("1,234.5");
    expect(fmtNum(1234567, "ar")).toBe("1,234,567");
    expect(fmtNum(1234.5, "en")).toBe("1,234.5");
    for (const n of [0, 1, 2, 9, 10, 11, 99, 100, 0.5, 0.95, 2.5, 1234.5, 1000000])
      expect(fmtNum(n, "ar"), String(n)).not.toMatch(EASTERN);
  });

  it("keeps formatNumber's contract: fmtNum, never negative", () => {
    expect(formatNumber("ar", 30)).toBe("30");
    expect(formatNumber("ar", 2.5)).toBe("2.5");
    expect(formatNumber("ar", 1234.5)).toBe("1,234.5");
    expect(() => formatNumber("ar", -1)).toThrow(RangeError);
    expect(() => formatNumber("ar", Number.NaN)).toThrow(RangeError);
  });

  it("writes a percentage in Western digits", () => {
    expect(pct(0.42, "ar")).toContain("42");
    expect(pct(1, "ar")).toContain("100");
    for (const n of [0, 0.05, 0.42, 0.999, 1]) expect(pct(n, "ar"), String(n)).not.toMatch(EASTERN);
  });
});

describe("dates and times in Arabic (fmtDate, fmtTime)", () => {
  it("keeps the Gregorian calendar with Arabic month names, in Western digits", () => {
    const full = fmtDate(OCT_4, "ar", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      ...RIYADH,
    });
    expect(full).toBe("الأحد، 4 أكتوبر 2026");
    expect(full).toContain("2026");
    expect(full).toContain("أكتوبر");
    const options: Intl.DateTimeFormatOptions[] = [
      { day: "numeric", month: "long", ...RIYADH },
      { day: "numeric", month: "short", year: "numeric", ...RIYADH },
      { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", ...RIYADH },
      { hour: "numeric", minute: "2-digit", ...RIYADH },
      { dateStyle: "full", ...RIYADH },
      { dateStyle: "short", timeStyle: "short", ...RIYADH },
    ];
    for (const o of options) {
      const s = fmtDate(OCT_4, "ar", o);
      expect(s, JSON.stringify(o)).not.toMatch(EASTERN);
      expect(s, JSON.stringify(o)).toMatch(/[0-9]/);
    }
    expect(fmtDate(OCT_4, "ar", { hour: "numeric", minute: "2-digit", ...RIYADH })).toContain("3:05");
    // Never a Hijri date: the year is 2026, not 1448.
    expect(fmtDate(OCT_4, "ar", { year: "numeric", ...RIYADH })).toContain("2026");
  });

  it("writes a session time in Western digits, whatever digits it came in", () => {
    expect(fmtTime("09:00", "ar")).toBe("9:00 صباحًا");
    expect(fmtTime("18:30", "ar")).toBe("6:30 مساءً");
    expect(fmtTime("00:15", "ar")).toBe("12:15 صباحًا");
    expect(fmtTime("٠٩:٣٠", "ar")).toBe("9:30 صباحًا");
    expect(fmtTime("بعد ١٥ دقيقة", "ar")).toBe("بعد 15 دقيقة");
    for (const time of ["00:00", "07:05", "12:00", "23:59"]) expect(fmtTime(time, "ar")).not.toMatch(EASTERN);
  });
});

describe("localizeDigits and westernDigits", () => {
  it("keeps ASCII digits as they are in Arabic", () => {
    expect(localizeDigits("ar", "يستغرق نحو 8 إلى 10 دقائق")).toBe("يستغرق نحو 8 إلى 10 دقائق");
    expect(localizeDigits("ar", "اتصل بالرقم 997 أو 937")).toBe("اتصل بالرقم 997 أو 937");
    expect(localizeDigits("ar", "المستوى T6 أو أعلى")).toBe("المستوى T6 أو أعلى");
    expect(localizeDigits("ar", "عام 2026")).toBe("عام 2026");
  });

  it("makes Arabic Indic and Persian digits Western, with . as the decimal mark", () => {
    expect(localizeDigits("ar", "١٢٣")).toBe("123");
    expect(localizeDigits("ar", "۱۲۳")).toBe("123");
    expect(localizeDigits("ar", "٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(localizeDigits("ar", "۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
    expect(localizeDigits("ar", "١٫٥")).toBe("1.5");
    expect(localizeDigits("ar", "قارورة ١٫٥ لتر")).toBe("قارورة 1.5 لتر");
    expect(localizeDigits("ar", "١٬٢٣٤٫٥")).toBe("1,234.5");
    expect(localizeDigits("ar", "اتصل بالرقم ٩٩٧")).toBe("اتصل بالرقم 997");
    // A lone Arabic decimal or thousands mark between words is not a number and stays.
    expect(localizeDigits("ar", "أ٫ب")).toBe("أ٫ب");
  });

  it("returns English text unchanged", () => {
    expect(localizeDigits("en", "8 to 10 minutes")).toBe("8 to 10 minutes");
    expect(localizeDigits("en", "١٢٣")).toBe("١٢٣");
  });

  it("westernDigits is the same mapping for any text", () => {
    expect(westernDigits("خطة من ٣ أيام")).toBe("خطة من 3 أيام");
    expect(westernDigits("٠٫٩٥ م/ث")).toBe("0.95 م/ث");
    expect(westernDigits("Voice 1")).toBe("Voice 1");
  });

  it("typed Arabic Indic and Persian digits are still read as numbers", () => {
    expect(parseNumberInput("١٢٠")).toBe(120);
    expect(parseNumberInput("۲٫۵")).toBe(2.5);
  });
});

describe("copy in Arabic (t, interpolate, countPhrase)", () => {
  it("fills numeric vars in Western digits", () => {
    const body = t("ar", "assessment.afterIntake.body", { minutesFrom: 16, minutesTo: 21, unit: "min" });
    expect(body).toContain("16 إلى 21 دقيقة");
    expect(body).not.toMatch(EASTERN);
    const range = t("ar", "assessment.count.range", { min: 0, max: 60 });
    expect(range).toContain("0");
    expect(range).toContain("60");
    expect(range).not.toMatch(EASTERN);
    expect(t("ar", "assessment.common.call937")).toContain("937");
    expect(interpolate("ar", "القيمة {x} من {y}", { x: 1234.5, y: 0.95 })).toBe("القيمة 1,234.5 من 0.95");
    expect(interpolate("ar", "وصلت إلى {value} {unit}", { value: 95, unit: "deg" })).toBe("وصلت إلى 95 درجة");
    // A template written with Arabic Indic digits is shown in Western ones.
    expect(interpolate("ar", "خلال ٣٠ ثانية، {n} مرة", { n: 12 })).toBe("خلال 30 ثانية، 12 مرة");
  });

  it("writes every counted phrase in Western digits", () => {
    expect(countPhrase("ar", "deg", 0)).toBe("0 درجة");
    expect(countPhrase("ar", "deg", 5)).toBe("5 درجات");
    expect(countPhrase("ar", "deg", 11)).toBe("11 درجة");
    expect(countPhrase("ar", "deg", 120)).toBe("120 درجة");
    expect(countPhrase("ar", "min", 3)).toBe("3 دقائق");
    for (const unit of ["deg", "bends", "stands", "sec", "min"] as const)
      for (const n of [0, 1, 2, 3, 10, 11, 99, 100, 101, 1234])
        expect(countPhrase("ar", unit, n), `${unit} ${n}`).not.toMatch(EASTERN);
  });
});

describe("text written before D-036 or by a model (weekly plan, server too)", () => {
  it("shows a stored summary in Western digits, with the singular and the dual", () => {
    const rest = "في الأسبوع، مبنية على حالتك الطبية.";
    expect(summaryText({ ar: `خطة من ١ أيام ${rest}`, en: "" }, "ar")).toBe(`خطة من يوم واحد ${rest}`);
    expect(summaryText({ ar: `خطة من ٢ أيام ${rest}`, en: "" }, "ar")).toBe(`خطة من يومين ${rest}`);
    expect(summaryText({ ar: `خطة من ٤ أيام ${rest}`, en: "" }, "ar")).toBe(`خطة من 4 أيام ${rest}`);
  });

  it("fills a stored hold in Western digits", () => {
    const steps = stepsOf(
      { steps: { ar: ["اثبت {hold_ar}."], en: ["Hold {hold_en}."] } },
      {
        hold: { ar: "٣٠ ثانية", en: "30 seconds" },
      },
      "ar",
    );
    expect(steps).toEqual(["اثبت 30 ثانية."]);
  });

  it("cleans a model's Arabic to Western digits", () => {
    expect(cleanText("كرّر التمرين ٣ مرات لمدة ١٫٥ دقيقة", "ar", 100)).toBe(
      "كرّر التمرين 3 مرات لمدة 1.5 دقيقة",
    );
    expect(cleanText("كرّر التمرين ۳ مرات", "ar", 100)).toBe("كرّر التمرين 3 مرات");
    expect(cleanText("Repeat 3 times", "en", 100)).toBe("Repeat 3 times");
  });
});

describe("no source maps digits to Arabic Indic", () => {
  const ROOT = join(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs)$/.test(name)) files.push(p);
    }
  };
  walk(join(ROOT, "src"));
  walk(join(ROOT, "server"));

  it("has no digit lookup string, no Arabic Indic numbering system and no Arabic Intl locale but AR_LOCALE", () => {
    const offenders = files.flatMap((f) => {
      const text = readFileSync(f, "utf8");
      const where = f.slice(ROOT.length + 1);
      const out: string[] = [];
      if (text.includes("٠١٢٣٤٥٦٧٨٩")) out.push(`${where}: a digit lookup string`);
      if (/nu-arab|numberingSystem:\s*["']arab/.test(text)) out.push(`${where}: the arab numbering system`);
      if (/new Intl\.(NumberFormat|DateTimeFormat)\(\s*(lang === "ar" \? )?"ar/.test(text))
        out.push(`${where}: an Arabic Intl formatter without AR_LOCALE`);
      return out;
    });
    expect(offenders).toEqual([]);
  });
});
