/**
 * scripts/clinical/export-check.mjs (contract v2, section A). The clinical source lives in the git
 * ignored local-docs folder, so these tests rebuild a source from the committed runtime subset by
 * adding back every section and field the export drops, and check that the export returns exactly
 * the committed file.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DROP_ANYWHERE, DROP_TOP, KEEP, exportCheck } from "../scripts/clinical/export-check.mjs";

const COMMITTED = JSON.parse(
  readFileSync(join(__dirname, "../src/movements/check-v1.json"), "utf8"),
) as Record<string, unknown>;

/** The committed data with review material added back at the top and on every object. */
function sourceLike(): Record<string, unknown> {
  const withNotes = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(withNotes);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = withNotes(x);
      return { ...out, note: "Review note — dropped", sources: ["ref2026"], noiseBandBasis: "Basis" };
    }
    return v;
  };
  const source: Record<string, unknown> = {
    date: "2026-09-27",
    note: "Draft pending sign-off",
    dataMap: { persistedWithCheck: ["painNow"] },
    references: [{ id: "ref2026", cite: "A – B" }],
    reviewLog: { items: [] },
    laterBattery: [{ id: "later" }],
  };
  for (const key of KEEP) source[key] = withNotes(COMMITTED[key]);
  return source;
}

describe("movement check export", () => {
  it("keeps exactly the contract sections, in order", () => {
    expect(Object.keys(COMMITTED)).toEqual([...KEEP]);
    expect(DROP_TOP).toEqual(
      expect.arrayContaining(["references", "reviewLog", "laterBattery", "dataMap", "note"]),
    );
    expect([...DROP_ANYWHERE].sort()).toEqual(["noiseBandBasis", "note", "sources"]);
  });

  it("drops review sections and every sources, noiseBandBasis and note field at any depth", () => {
    const { data, errors } = exportCheck(sourceLike());
    expect(errors).toBeUndefined();
    expect(data).toEqual(COMMITTED);
    expect(JSON.stringify(data, null, 2) + "\n").toBe(
      readFileSync(join(__dirname, "../src/movements/check-v1.json"), "utf8"),
    );
  });

  it("keeps prose rule fields and fields that only contain note in their name", () => {
    const chairStand = (COMMITTED.tests as Array<Record<string, unknown>>).find(
      (t) => t.id === "chair_stand_30s",
    )!;
    expect(typeof chairStand.viewNote).toBe("string");
    const setting = (COMMITTED.precheck as Array<Record<string, unknown>>).find(
      (p) => p.id === "pc_setting",
    )!;
    expect(typeof setting.rule).toBe("string");
  });

  it("refuses a user facing string that breaks the wording rules", () => {
    const source = sourceLike();
    const screens = source.screens as Record<string, { ar: string; en: string }>;
    screens.scr_postpone_unwell = {
      ...screens.scr_postpone_unwell,
      en: "Re-test on a day when you feel well.",
    };
    const reasons = source.reasons as Record<string, { ar: string; en: string }>;
    reasons.by_choice = { ...reasons.by_choice, ar: "تخطيت هذا الاختبار حسب حَالَتِكَ الصِّحِّيَّة." };
    const result = exportCheck(source);
    expect(result.data).toBeUndefined();
    expect(result.errors).toEqual([
      expect.stringContaining("screens.scr_postpone_unwell.en [hyphen between letters]"),
      expect.stringContaining("reasons.by_choice.ar [حالتك الصحية]"),
    ]);
  });

  it("refuses a dash character in engineering prose, and allows a hyphenated word there", () => {
    const source = sourceLike();
    const locks = source.locks as Record<string, unknown>;
    expect(
      exportCheck({ ...source, locks: { ...locks, tune: "Tune the pre-check in the pilot" } }).errors,
    ).toBe(undefined);
    const result = exportCheck({ ...source, locks: { ...locks, tune: "Tune — in the pilot" } });
    expect(result.errors).toEqual([expect.stringContaining("locks.tune [dash character]")]);
  });

  it("refuses a missing section and an unknown top level section", () => {
    const source = sourceLike();
    delete source.cues;
    expect(exportCheck(source).errors).toEqual(["missing section cues"]);
    expect(exportCheck({ ...sourceLike(), extra: {} }).errors).toEqual([
      expect.stringContaining("unknown top level section extra"),
    ]);
  });
});
