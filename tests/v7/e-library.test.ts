/**
 * Step E1 (product v7 contract 1.2 and 2.10): src/exercises/library.json against the targets data
 * (src/movements/targets/targets-v7.json, exported from the clinical source, C-1), both ways.
 *   - Every existing entry carries the positions, targets and pain friendly tag of its libraryTags
 *     row, and nothing else of v7 in its v1 fields: no v7 contraindication id, no hip end range, no
 *     status (2.10 rule 2: "libraryTags adds positions, targets and painFriendly only", so v1 pools
 *     are unchanged). The rows' proposed contraindications, approved with the sign off (D-025), are
 *     kept apart in v7Contraindications, which libraryPool reads only for an intake with the v7
 *     fields (D-026 item 9); the rows' other proposals (muscles, osteoporosis cautions) stay proposals.
 *   - Every new exercise follows them as a draft, with the library fields and the v7 fields of its
 *     newExercises row, Arabic and English steps; its other fields stay in the targets data.
 * scripts/library-v7.mjs writes both; it is idempotent.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import library from "../../src/exercises/library.json";
import { LIBRARY, libraryById } from "../../src/medical/pool";
import { V7_ONLY_IDS } from "../../src/medical/contraindications";
import { DEMANDS } from "../../src/medical/sports";
import { TARGETS_DATA } from "../../src/movements/targets";

const ROOT = join(__dirname, "../..");
const POSITIONS = [
  "seated",
  "seated_forward",
  "standing",
  "standing_supported",
  "lying_back",
  "lying_side",
  "floor",
];
const ACTIONS = TARGETS_DATA.taxonomy.actions.map((a) => a.id);
const TAG_IDS = new Set(TARGETS_DATA.libraryTags.map((t) => t.id));
const NEW = TARGETS_DATA.newExercises;
const NEW_IDS = new Set(NEW.map((n) => n.id));
/** The contraindication ids of the library before v7 (the pain areas and the balance restriction). */
const V1_IDS = [
  "shoulder_injury",
  "elbow_injury",
  "back_injury",
  "wrist_injury",
  "hip_injury",
  "knee_injury",
  "neck_injury",
  "severe_balance_issues",
];
const TEMPLATE = ":<region>";
const VOCABULARY = new Set(
  TARGETS_DATA.contraindicationVocabulary.filter((t) => !t.id.endsWith(TEMPLATE)).map((t) => t.id),
);

describe("every existing library entry, tagged (libraryTags)", () => {
  it("carries the positions, targets and pain friendly tag of its row", () => {
    expect(TARGETS_DATA.libraryTags.length).toBe(55);
    for (const t of TARGETS_DATA.libraryTags) {
      const e = libraryById(t.id);
      expect(e, t.id).toBeDefined();
      expect(e!.positions, t.id).toEqual(t.positions);
      expect(e!.targets, t.id).toEqual(t.targets);
      expect(e!.painFriendly, t.id).toBe(t.painFriendly);
    }
  });

  it("keeps its row's signed off contraindications apart, in v7Contraindications (D-025, D-026 item 9)", () => {
    // The rows' proposed ids (addContraindications, addContraindication), an id's note in brackets
    // dropped («standing_gate (standing form only)»: standing_gate closes the standing forms only).
    const proposed = (t: (typeof TARGETS_DATA.libraryTags)[number]): string[] => {
      const p = t.proposed as { addContraindications?: string[]; addContraindication?: string } | null;
      const ids = [
        ...(p?.addContraindications ?? []),
        ...(p?.addContraindication ? [p.addContraindication] : []),
      ];
      return [...new Set(ids.map((id) => id.replace(/\s*\(.*\)$/, "")))];
    };
    let carried = 0;
    for (const t of TARGETS_DATA.libraryTags) {
      const e = libraryById(t.id)!;
      const ids = proposed(t);
      expect(e.v7Contraindications ?? [], t.id).toEqual(ids);
      for (const id of ids) expect(V7_ONLY_IDS.has(id), `${t.id}: ${id}`).toBe(true);
      carried += ids.length ? 1 : 0;
    }
    expect(carried).toBe(23);
    expect(libraryById("seated_marching")?.v7Contraindications).toEqual(["hip_precautions_posterior"]);
    expect(libraryById("seated_calf_stretch")?.v7Contraindications).toEqual(["achilles"]);
    expect(libraryById("heel_raises")?.v7Contraindications).toEqual(["standing_gate"]);
  });

  it("gets nothing else of v7: no status, dose, hip end range or v7 contraindication id", () => {
    for (const e of LIBRARY.filter((x) => TAG_IDS.has(x.id))) {
      expect(e.status, e.id).toBeUndefined();
      expect(e.dose, e.id).toBeUndefined();
      expect(e.hipEndRange, e.id).toBeUndefined();
      expect(
        e.contraindications.filter((c) => V7_ONLY_IDS.has(c)),
        e.id,
      ).toEqual([]);
    }
  });

  it("names known positions and at least one <action>:<target> id", () => {
    for (const e of LIBRARY) {
      expect(e.positions?.length, e.id).toBeGreaterThan(0);
      for (const p of e.positions ?? []) expect(POSITIONS, e.id).toContain(p);
      expect(e.targets?.length, e.id).toBeGreaterThan(0);
      for (const t of e.targets ?? []) {
        const [action, target] = t.id.split(":");
        expect(ACTIONS, t.id).toContain(action);
        expect(target, t.id).toMatch(/^[a-z_]+$/);
      }
    }
  });

  it("keeps one entry per id", () => {
    const ids = LIBRARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the words of every entry (D-029 item 1, E3-8)", () => {
  it("write a range in words, never with a dash", () => {
    const DASH = /[\u002D\u2010-\u2015\u2212]/;
    for (const e of LIBRARY)
      for (const lang of ["ar", "en"] as const)
        for (const t of [
          e.name[lang],
          e.description[lang],
          ...e.steps[lang],
          e.cautions?.[lang],
          e.credit?.[lang],
        ])
          if (t) expect(DASH.test(t), `${e.id} ${lang}: ${t}`).toBe(false);
  });

  it('the v1 holds read «من 15 إلى 30 ثانية» / "15 to 30 seconds", as the new exercises write them', () => {
    const step = (id: string, lang: "ar" | "en") => libraryById(id)!.steps[lang].join(" ");
    for (const id of ["shoulder_stretch", "chest_opener", "upper_back_stretch"]) {
      expect(step(id, "ar")).toContain("استمر من 15 إلى 30 ثانية");
      expect(step(id, "en")).toContain("Hold for 15 to 30 seconds");
    }
    expect(step("stomach_vacuum", "ar")).toContain("استمر من 10 إلى 15 ثانية");
    expect(step("stomach_vacuum", "en")).toContain("Hold for 10 to 15 seconds");
    expect(step("seated_hip_adduction", "ar")).toContain("استمر من 2 إلى 3 ثوانٍ");
    expect(step("seated_hip_adduction", "en")).toContain("Hold for 2 to 3 seconds");
  });
});

describe("the new exercises, entered as drafts (newExercises)", () => {
  it("follow the existing entries, one entry each, every one a draft", () => {
    expect(NEW.length).toBe(65);
    expect(LIBRARY.length).toBe(55 + 65);
    expect(LIBRARY.slice(0, 55).every((e) => TAG_IDS.has(e.id))).toBe(true);
    expect(LIBRARY.slice(55).map((e) => e.id)).toEqual(NEW.map((n) => n.id));
    for (const e of LIBRARY.slice(55)) expect(e.status, e.id).toBe("draft");
  });

  it("carry the library fields and the v7 fields of their row, word for word", () => {
    const FIELDS = [
      "name",
      "description",
      "category",
      "muscles",
      "equipment",
      "difficulty",
      "minutes",
      "steps",
      "tags",
      "demands",
      "contraindications",
      "positions",
      "targets",
      "painFriendly",
      "dose",
      "hipEndRange",
    ] as const;
    for (const n of NEW) {
      const e = libraryById(n.id)!;
      for (const k of FIELDS) expect(e[k], `${n.id}.${k}`).toEqual(n[k]);
    }
  });

  it("have Arabic and English steps, one for one, and names and descriptions in both", () => {
    for (const e of LIBRARY.filter((x) => NEW_IDS.has(x.id))) {
      expect(e.steps.ar.length, e.id).toBeGreaterThan(1);
      expect(e.steps.ar.length, e.id).toBe(e.steps.en.length);
      for (const l of ["ar", "en"] as const) {
        expect(e.name[l].trim(), e.id).not.toBe("");
        expect(e.description[l].trim(), e.id).not.toBe("");
        for (const step of e.steps[l]) expect(step.trim(), e.id).not.toBe("");
      }
      expect(e.steps.ar.join(" "), e.id).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("leave the targets data's other fields there (props, the text source, variants)", () => {
    for (const e of LIBRARY.filter((x) => NEW_IDS.has(x.id)))
      for (const k of ["props", "textSource", "painVariant", "raisedSeatVariant", "requiresMobility"])
        expect(e, `${e.id}.${k}`).not.toHaveProperty(k);
    // Each is found by the same id.
    expect(NEW.filter((n) => n.textSource.type === "adapted_nia").every((n) => n.textSource.credit)).toBe(
      true,
    );
  });

  it("carry their cautions and the NIA credit line, which the guided card shows (E1-8, D-026 item 9)", () => {
    for (const n of NEW) {
      const e = libraryById(n.id)!;
      expect(e.cautions, n.id).toEqual(n.cautions ?? undefined);
      expect(e.credit, n.id).toEqual(n.textSource.credit);
    }
    expect(LIBRARY.filter((e) => e.credit).length).toBe(
      NEW.filter((n) => n.textSource.type === "adapted_nia").length,
    );
    // The existing entries have neither.
    for (const e of LIBRARY.slice(0, 55)) {
      expect(e.cautions, e.id).toBeUndefined();
      expect(e.credit, e.id).toBeUndefined();
    }
  });

  it("name only known contraindication ids, demand tags and categories", () => {
    const categories = new Set(["flexibility", "upper_body", "lower_body", "core", "balance", "walking"]);
    for (const e of LIBRARY) {
      for (const c of e.contraindications)
        expect(V1_IDS.includes(c) || VOCABULARY.has(c), `${e.id}: ${c}`).toBe(true);
      for (const d of e.demands) expect(Object.keys(DEMANDS), `${e.id}: ${d}`).toContain(d);
      expect(categories.has(e.category), `${e.id}: ${e.category}`).toBe(true);
    }
    // Only a new exercise carries a v7 id or a hip end range.
    for (const e of LIBRARY.filter((x) => !NEW_IDS.has(x.id))) {
      expect(
        e.contraindications.every((c) => V1_IDS.includes(c)),
        e.id,
      ).toBe(true);
      expect(e.hipEndRange, e.id).toBeUndefined();
    }
  });

  it("include the two the hip rule names, lying_knee_to_chest and clamshell, with their hip end range", () => {
    expect(libraryById("lying_knee_to_chest")).toMatchObject({
      status: "draft",
      hipEndRange: ["flexion_past_90"],
      contraindications: ["hip_precautions_posterior"],
    });
    expect(libraryById("clamshell")).toMatchObject({
      status: "draft",
      hipEndRange: ["adduction_past_midline"],
      contraindications: ["hip_precautions_posterior"],
    });
  });
});

describe("scripts/library-v7.mjs", () => {
  it("writes the library it reads: running it again changes nothing", () => {
    const file = join(ROOT, "src/exercises/library.json");
    const before = readFileSync(file, "utf8");
    expect(JSON.parse(before)).toEqual(library);
    execFileSync(process.execPath, [join(ROOT, "scripts/library-v7.mjs"), "--check"], { cwd: ROOT });
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
