/**
 * Wording rules of the movement check copy (UX spec 0.2, definition of done) on top of the general
 * wording test (tests/wording.test.ts, which already scans every src/i18n JSON file for dashes and
 * the phrase):
 *   - progress.* and assessment.results.* never hold a stem of the check data's
 *     progress.forbiddenInProgressText (Arabic diacritics and tatweel removed, lower case);
 *   - no key holds a Q23 (6) banned word of the clinical data (boundary.bannedPublicWording), in
 *     every src/i18n namespace, the voice lines (ar, arTts, en, enTts) and, beyond the known ones
 *     listed for the copy owner, the workout app copy;
 *   - no UX string says فحص (Q29 renamed the check قياس الحركة);
 *   - no verb stands directly before عزم as its subject (copy rule 12, Q29: unvowelled, «يحتاج عزم»
 *     reads as the noun عَزْم, determination), so عزم comes first («عزم يحتاج»);
 *   - no label ends with a colon;
 *   - no copy holds a disclaimer (D-017 item 2; the wording rule above stays the protection).
 * The landing namespace follows the same rules (council Q23 (6), Q29, H1, H2).
 * A failure here is reported to the copy owner; the rule is never weakened to pass.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECK_DATA } from "../src/movements/assessments";
import voiceScript from "../src/app/voice-script.json";
import library from "../src/exercises/library.json";
import * as platformCopy from "../src/app/platform-copy";
import * as cameraCopy from "../src/app/camera-copy";
import * as appI18n from "../src/app/i18n";
import * as experience from "../src/app/experience";
import * as product from "../src/app/product";
import { disclaimersIn } from "./no-disclaimers";

const DIR = join(__dirname, "../src/i18n");
const read = (lang: string, ns: string) =>
  JSON.parse(readFileSync(join(DIR, lang, `${ns}.json`), "utf8")) as unknown;
/** Every namespace of src/i18n, so a new one is checked without a change here. */
const NAMESPACES = readdirSync(join(DIR, "en"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5));

function leaves(v: unknown, prefix: string): [string, string][] {
  if (typeof v === "string") return [[prefix, v]];
  if (!v || typeof v !== "object") return [];
  return Object.entries(v).flatMap(([k, x]) => leaves(x, `${prefix}.${k}`));
}

const normalise = (s: string) => s.replace(/[ً-ْٰـ]/g, "").toLowerCase();

const COPY = (["ar", "en"] as const).flatMap((lang) =>
  NAMESPACES.flatMap((ns) => leaves(read(lang, ns), ns).map(([key, text]) => ({ lang, key, text }))),
);

/**
 * Q23 (6), H2: words the product never uses, from the clinical data (boundary.bannedPublicWording),
 * so the CI check and the data cannot drift apart. English matches at a word start; Arabic anywhere.
 * The check copy also keeps "monitor", which the data leaves to the copy review for other copy.
 */
const BANNED = CHECK_DATA.boundary.bannedPublicWording;
const BANNED_EN = [...new Set([...BANNED.enWords.map((w) => w.toLowerCase()), "monitor"])];
const BANNED_AR = BANNED.arWords.map(normalise);
const bannedIn = (lang: "ar" | "en", text: string, en: readonly string[] = BANNED_EN): string[] => {
  const t = normalise(text);
  return lang === "en" || /[a-z]/.test(t)
    ? [
        ...en.filter((w) => new RegExp(`\\b${w}`).test(t)),
        ...(lang === "ar" ? BANNED_AR.filter((w) => t.includes(w)) : []),
      ]
    : BANNED_AR.filter((w) => t.includes(w));
};

/** Voice lines (ar, arTts, en, enTts) and the copy of the workout app (wording.test.ts sources). */
const COPY_FUNCTIONS = new Set(["labels", "camCopy", "ui", "copy"]);
function appLeaves(v: unknown, where: string): [string, string][] {
  if (typeof v === "string") return [[where, v]];
  if (!v || typeof v !== "object") return [];
  return Object.entries(v).flatMap(([k, x]) => appLeaves(x, `${where}.${k}`));
}
const OTHER_COPY: { lang: "ar" | "en"; key: string; text: string }[] = [
  ...Object.entries(voiceScript as Record<string, Record<string, string>>).flatMap(([id, cue]) =>
    (["ar", "arTts", "en", "enTts"] as const)
      .filter((f) => typeof cue[f] === "string")
      .map((f) => ({
        lang: f.startsWith("ar") ? ("ar" as const) : ("en" as const),
        key: `voice ${id}.${f}`,
        text: cue[f],
      })),
  ),
  ...(
    [
      ["platform-copy.ts", platformCopy],
      ["camera-copy.ts", cameraCopy],
      ["i18n.ts", { T: appI18n.T }],
      ["experience.ts", experience],
      ["product.ts", product],
      ["library.json", library],
    ] as [string, Record<string, unknown>][]
  )
    .flatMap(([file, mod]) =>
      Object.entries(mod).flatMap(([name, value]) => {
        const values =
          typeof value === "function"
            ? COPY_FUNCTIONS.has(name)
              ? (["ar", "en"] as const).map(
                  (l) => [`${name}("${l}")`, (value as (l: string) => unknown)(l)] as const,
                )
              : []
            : ([[name, value]] as const);
        return values.flatMap(([n, v]) => appLeaves(v, `${file} ${n}`));
      }),
    )
    .map(([key, text]) => ({
      lang: /[\u0600-\u06FF]/.test(text) ? ("ar" as const) : ("en" as const),
      key,
      text,
    })),
];

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
    const bad = COPY.flatMap((c) => bannedIn(c.lang, c.text).map((w) => `${c.lang} ${c.key}: ${w}`));
    expect(bad).toEqual([]);
  });

  it("the voice lines hold no banned word of the data either (H2)", () => {
    const voice = OTHER_COPY.filter((c) => c.key.startsWith("voice "));
    expect(voice.length).toBeGreaterThan(200);
    const data = BANNED.enWords.map((w) => w.toLowerCase());
    expect(voice.flatMap((c) => bannedIn(c.lang, c.text, data).map((w) => `${c.key}: ${w}`))).toEqual([]);
  });

  it("the workout app copy adds no banned word of the data (the known ones wait for the copy owner)", () => {
    // SPEC-GAP: legacy-banned-words. The workout app's own copy (phase 1 leaves it as it is) still has
    // these Q23 (6) words; they are reported to the copy owner, and any new one fails here.
    const KNOWN = [
      'platform-copy.ts labels("en").intakeBody: recovery',
      "platform-copy.ts reasonText.recovery.en: recovery",
      "platform-copy.ts reasonText.duration.en: recovery",
      'experience.ts ui("ar").noneYet: تقدم',
      'experience.ts ui("en").noneYet: progress',
      'product.ts copy("ar").progress: تقدم',
      'product.ts copy("en").progress: progress',
    ];
    const app = OTHER_COPY.filter((c) => !c.key.startsWith("voice "));
    expect(app.length).toBeGreaterThan(300);
    const data = BANNED.enWords.map((w) => w.toLowerCase());
    const bad = app.flatMap((c) => bannedIn(c.lang, c.text, data).map((w) => `${c.key}: ${w}`));
    expect(bad.filter((b) => !KNOWN.includes(b))).toEqual([]);
  });

  it("the banned list reads the data's words, SPARK's expansion and its Arabic transliteration included", () => {
    expect(bannedIn("ar", "جرّب عزم سبارك اليوم")).toEqual(["سبارك"]);
    expect(bannedIn("en", "Smart Personalized Assessment of Range and Kinematics")).toContain(
      "smart personalized assessment",
    );
    expect(bannedIn("en", "Your proof of change")).toEqual(["proof"]);
    expect(bannedIn("en", "a prescription")).toEqual(["prescription"]);
    expect(bannedIn("en", "We never manage spasticity")).toEqual(["manage spasticity"]);
    // D-017 item 2: with the disclaimers gone the wording rule is the protection, so no copy says Azm
    // diagnoses; the noun stays allowed (a person's own new diagnosis, «هذا ليس تشخيصًا»).
    expect(bannedIn("en", "Azm diagnoses your arm")).toEqual(["diagnose"]);
    expect(bannedIn("ar", "عزم يُشخّص حالتك")).toEqual(["يشخص"]);
    expect(bannedIn("en", "A new diagnosis")).toEqual([]);
    expect(bannedIn("ar", "هذا ليس تشخيصًا")).toEqual([]);
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

  it("D-017 item 2: no copy holds a disclaimer, and the check data has none left", () => {
    // The consent screen (S12) states what is stored (PDPL) and keeps its video point.
    const KEPT = new Set(["assessment.consent.pointVideo"]);
    const bad = [...COPY, ...OTHER_COPY]
      .filter((c) => !KEPT.has(c.key))
      .flatMap((c) => disclaimersIn(c.lang, c.text).map((d) => `${c.lang} ${c.key}: ${d}`));
    expect(bad).toEqual([]);
    // The pre-check notice went too: it showed after the consent, so the consent never needed it.
    for (const gone of ["line", "notMedical", "notMedicalPlacement", "resultsFooter", "precheckNotice"])
      expect(CHECK_DATA.boundary, gone).not.toHaveProperty(gone);
  });

  it("no label ends with a colon", () => {
    expect(COPY.filter((c) => /[:：]\s*$/.test(c.text)).map((c) => `${c.lang} ${c.key}`)).toEqual([]);
  });
});

describe("one clearance question in the intake and at the booth (Q19 (2), O39)", () => {
  it("the intake asks it word for word as the guest flow does, in both languages", async () => {
    const { labels } = await import("../src/app/platform-copy");
    const ask = CHECK_DATA.selection.guestBooth.clearance.ask;
    expect(labels("ar").clearance).toBe(ask.ar);
    expect(labels("en").clearance).toBe(ask.en);
  });
});
