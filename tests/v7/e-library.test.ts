/**
 * Step E1 (product v7 contract 1.2 and 2.10): src/exercises/library.json against the targets data
 * (src/movements/targets/targets-v7.json, exported from the clinical source, C-1), both ways.
 *   - Every existing entry carries the positions, targets and pain friendly tag of its libraryTags
 *     row, and nothing else of v7: no v7 contraindication id, no hip end range, no status (2.10
 *     rule 2: "libraryTags adds positions, targets and painFriendly only", so v1 pools are
 *     unchanged). The rows' proposed changes stay proposals.
 * scripts/library-v7.mjs writes these fields; it is idempotent.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import library from "../../src/exercises/library.json";
import { LIBRARY, libraryById } from "../../src/medical/pool";
import { V7_ONLY_IDS } from "../../src/medical/contraindications";
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

describe("scripts/library-v7.mjs", () => {
  it("writes the library it reads: running it again changes nothing", () => {
    const file = join(ROOT, "src/exercises/library.json");
    const before = readFileSync(file, "utf8");
    expect(JSON.parse(before)).toEqual(library);
    execFileSync(process.execPath, [join(ROOT, "scripts/library-v7.mjs"), "--check"], { cwd: ROOT });
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
