/**
 * Step E1 (product v7 contract 2.10, the pool rules; C-9): the pool stays the safety base in every
 * build, on the real library and the corpus of tests/v7/e-corpus.ts (every v1 combination and a v7
 * twin of each).
 *   - The v1 pools are pinned: the default pool of every corpus intake holds exactly the exercises it
 *     held before E1, in the same order. The digest was computed on azm7 0a3f776, before E1 changed
 *     pool.ts or library.json.
 *   - Rule 1: the default pool never holds a draft; the drafts reach the pool only when asked.
 *   - Rule 2: an intake without the v7 fields never gets an exercise with a v7 id or a hip end range.
 *   - Rule 3's test: with drafts included and a hip replacement under 3 months on the body map,
 *     libraryPool and the legacy createWeekly (its model stubbed) never return a hip_precautions_* or
 *     hip end range exercise (lying_knee_to_chest, clamshell).
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlan, type Intake } from "../../src/medical/plan";
import { LIBRARY, libraryById, libraryPool, type LibraryExercise } from "../../src/medical/pool";
import { V7_ONLY_IDS, canClearV7Ids, recentHipReplacement } from "../../src/medical/contraindications";
import { createWeekly } from "../../server/weekly-ai";
import { corpus, flags, hipReplacement, v7 } from "./e-corpus";

const CORPUS = corpus();
/** The ids of a pool, in order. */
const idsOf = (pool: readonly { id: string }[]) => pool.map((e) => e.id).join(",");
/** One line per intake, its key and the ids of its pool, hashed together. */
const poolDigest = (pool: (h: Intake) => readonly { id: string }[]) =>
  createHash("sha256")
    .update(CORPUS.map(({ key, h }) => `${key}: ${idsOf(pool(h))}`).join("\n"))
    .digest("hex");

const DRAFTS = new Set(LIBRARY.filter((e) => e.status === "draft").map((e) => e.id));
const withDrafts = (h: Intake) => libraryPool(h, { includeDrafts: true });
/** A hip precaution or a hip end range item (contract 2.10 rule 3). */
const hipItem = (e: LibraryExercise) =>
  (e.hipEndRange?.length ?? 0) > 0 || e.contraindications.some((c) => c.startsWith("hip_precautions"));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the v1 pools (contract 2.10 rule 3)", () => {
  it("covers every v1 combination and its v7 twin, with pools that differ", () => {
    expect(CORPUS.length).toBe(7200);
    expect(new Set(CORPUS.map((c) => c.key)).size).toBe(CORPUS.length);
    expect(new Set(CORPUS.map(({ h }) => idsOf(libraryPool(h)))).size).toBeGreaterThan(300);
  });

  it("keeps the default pool of every corpus intake as it was before E1", () => {
    expect(poolDigest((h) => libraryPool(h))).toBe(
      "0ce110ee97a20c3bb606bcf1b3635d92576f962ed6716eaa37625f2b944a0e8e",
    );
  });
});

describe("rule 1: the default pool never holds a draft", () => {
  it("has the 65 new exercises to keep out", () => {
    expect(DRAFTS.size).toBe(65);
  });

  it("for any intake of the corpus, while the drafts reach the pool when asked", () => {
    let reached = 0;
    for (const { key, h } of CORPUS) {
      expect(
        libraryPool(h)
          .filter((e) => DRAFTS.has(e.id))
          .map((e) => e.id),
        key,
      ).toEqual([]);
      if (withDrafts(h).some((e) => DRAFTS.has(e.id))) reached++;
    }
    expect(reached).toBeGreaterThan(1000);
  });
});

describe("rule 2: an intake without the v7 fields cannot clear a v7 id", () => {
  it("never gets an exercise with a v7 id or a hip end range, drafts included", () => {
    const v1Intakes = CORPUS.filter(({ h }) => !canClearV7Ids(h));
    expect(v1Intakes.length).toBe(3600);
    for (const { key, h } of v1Intakes) {
      const v7Items = withDrafts(h).filter(
        (e) => (e.hipEndRange?.length ?? 0) > 0 || e.contraindications.some((c) => V7_ONLY_IDS.has(c)),
      );
      expect(
        v7Items.map((e) => e.id),
        key,
      ).toEqual([]);
    }
  });

  it("keeps the seated form of a mixed exercise for a wheelchair user (the wheelchair shoulder block)", () => {
    const h = v7({
      mobility: "wheelchair",
      walking: { status: "no" },
      romFlags: flags({ transferChair: false }),
    });
    const pool = withDrafts(h).map((e) => e.id);
    expect(pool).toEqual(expect.arrayContaining(["arms_open_chest_stretch", "shoulder_wall_press"]));
    // The standing only and the chair front exercises stay out.
    expect(pool).not.toContain("standing_side_leg_raise");
    expect(pool).not.toContain("seated_arm_swing");
  });
});

describe("rule 3's test: a hip replacement under 3 months on the body map, drafts included", () => {
  const LIMITS: (Parameters<typeof hipReplacement>[0] | undefined)[] = [
    undefined,
    ["none"],
    ["flex90"],
    ["back_out"],
    ["cross", "turn_in"],
  ];
  const cases = [
    ...LIMITS.map((avoid) => v7({ regions: [hipReplacement(avoid)] })),
    ...CORPUS.map((c) => c.h).filter(recentHipReplacement),
  ];

  it("libraryPool never returns a hip precaution or hip end range exercise", () => {
    expect(cases.length).toBeGreaterThan(1000);
    for (const h of cases) {
      const pool = withDrafts(h);
      expect(pool.filter(hipItem).map((e) => e.id)).toEqual([]);
    }
    // Not vacuous: without the replacement both are offered.
    expect(withDrafts(v7()).map((e) => e.id)).toEqual(
      expect.arrayContaining(["lying_knee_to_chest", "clamshell"]),
    );
  });

  it("the legacy createWeekly never returns one either, its model stubbed to ask for them", async () => {
    const h = v7({ regions: [hipReplacement()] });
    const plan = createPlan(h);
    expect(plan.status).toBe("ready");
    const asked = ["lying_knee_to_chest", "clamshell", "heel_slides", "seated_knee_hug", "sit_to_stand"];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const days = plan.days.map(() => ({
          focus: { ar: "الورك", en: "Hip" },
          warmup: asked.slice(0, 2),
          extra: asked.slice(2),
          cooldown: asked.slice(0, 2),
          notes: [],
        }));
        const content = JSON.stringify({ summary: { ar: "خطة", en: "A plan" }, why: [], tips: [], days });
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      }),
    );
    for (const weekly of [await createWeekly(h, plan, "test-key"), await createWeekly(h, plan)]) {
      const ids = weekly!.days.flatMap((d) => [...d.warmup, ...d.extra, ...d.cooldown].map((i) => i.id));
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(DRAFTS.has(id), id).toBe(false);
        expect(hipItem(libraryById(id)!), id).toBe(false);
      }
      for (const id of asked) expect(ids).not.toContain(id);
    }
  });
});
