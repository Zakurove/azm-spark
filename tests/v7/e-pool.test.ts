/**
 * Step E1 (product v7 contract 2.10, the pool rules; C-9): the pool stays the safety base in every
 * build, on the real library and the corpus of tests/v7/e-corpus.ts (every v1 combination and a v7
 * twin of each).
 *   - The v1 pools are pinned: the default pool of every v1 corpus intake holds exactly the exercises
 *     it held before E1, in the same order (E1 pinned the whole corpus on azm7 0a3f776, before it
 *     changed pool.ts or library.json; the v1 half is pinned since the v7 half follows D-026 item 9).
 *   - A v7 intake also gets the existing entries' signed off contraindications (v7Contraindications)
 *     and the body map's region ids (region_not_cleared, region_early_post_op, region_acute_injury).
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
import {
  V7_ONLY_IDS,
  canClearV7Ids,
  recentHipReplacement,
  regionOfTarget,
} from "../../src/medical/contraindications";
import { createWeekly } from "../../server/weekly-ai";
import { corpus, entry, flags, hipReplacement, v7 } from "./e-corpus";

const CORPUS = corpus();
/** The ids of a pool, in order. */
const idsOf = (pool: readonly { id: string }[]) => pool.map((e) => e.id).join(",");
/** One line per intake, its key and the ids of its pool, hashed together. */
const poolDigest = (
  pool: (h: Intake) => readonly { id: string }[],
  which: (h: Intake) => boolean = () => true,
) =>
  createHash("sha256")
    .update(
      CORPUS.filter(({ h }) => which(h))
        .map(({ key, h }) => `${key}: ${idsOf(pool(h))}`)
        .join("\n"),
    )
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

  it("keeps the default pool of every v1 corpus intake as it was before E1", () => {
    // The v1 half of the corpus (no v7 field): computed on azm7 355d859, before the wave 2 fix that
    // applies the signed off contraindications of the existing entries to v7 intakes (D-026 item 9),
    // and equal to E1's pin of the whole corpus there (0ce110ee…).
    expect(
      poolDigest(
        (h) => libraryPool(h),
        (h) => !canClearV7Ids(h),
      ),
    ).toBe("3efa8fd57d932be70f0e659c6c627b18cd94920b4fa9722b0c8265c11cd68bff");
  });
});

describe("a v7 intake: the existing entries' signed off contraindications and the region ids (D-026 item 9)", () => {
  const knee = (equipment: string[]) =>
    v7({
      equipment,
      regions: [entry("knee", "right", ["after_surgery"], { surgery: { since: "lt6w", cleared: "no" } })],
    });
  const targetsRegion = (e: LibraryExercise, region: string) =>
    (e.targets ?? []).some((t) => regionOfTarget(t.id) === region);

  it("a hip replacement 3 weeks ago, cleared, no limits answered: no hip flexion past 90 degrees", () => {
    const h = v7({
      regions: [
        entry("hip", "right", ["after_surgery"], {
          surgery: { since: "lt6w", cleared: "yes", avoid: [], hipReplacement: true },
        }),
      ],
    });
    const pool = libraryPool(h).map((e) => e.id);
    for (const id of ["seated_marching", "seated_knee_lifts", "supine_marching"])
      expect(pool).not.toContain(id);
    // Not vacuous: without the surgery all three are offered.
    expect(libraryPool(v7()).map((e) => e.id)).toEqual(
      expect.arrayContaining(["seated_marching", "seated_knee_lifts", "supine_marching"]),
    );
  });

  it("a knee surgery 3 weeks ago, not cleared, with bands: no exercise that works the knee", () => {
    const pool = libraryPool(knee(["bands"]));
    expect(pool.filter((e) => targetsRegion(e, "knee")).map((e) => e.id)).toEqual([]);
    const before = libraryPool(v7({ equipment: ["bands"] })).map((e) => e.id);
    for (const id of ["leg_press_with_band", "hamstring_curl_with_band", "seated_leg_extensions"]) {
      expect(before).toContain(id);
      expect(pool.map((e) => e.id)).not.toContain(id);
    }
  });

  it("an Achilles repair 2 months ago: no calf stretch", () => {
    const h = v7({
      regions: [entry("ankle_foot", "right", ["injury"], { injury: { since: "6w_3m", achilles: true } })],
    });
    expect(libraryPool(h).map((e) => e.id)).not.toContain("seated_calf_stretch");
    expect(libraryPool(v7()).map((e) => e.id)).toContain("seated_calf_stretch");
  });

  it("a knee injury 3 weeks ago keeps only the pain friendly range of motion items for that knee", () => {
    const h = v7({ regions: [entry("knee", "left", ["injury"], { injury: { since: "lt6w" } })] });
    const knees = libraryPool(h, { includeDrafts: true }).filter((e) => targetsRegion(e, "knee"));
    expect(knees.map((e) => e.id)).toEqual(["heel_slides"]);
    for (const e of knees) {
      expect(e.painFriendly, e.id).toBe(true);
      expect(e.equipment, e.id).toEqual([]);
      for (const t of e.targets ?? [])
        if (t.role === "primary" && regionOfTarget(t.id) === "knee") expect(t.id, e.id).toMatch(/^mobility:/);
    }
  });

  it("a v1 intake never reads them: a wheelchair user with weights keeps the Arnold press", () => {
    const v1Chair = { ...v7({ mobility: "wheelchair", equipment: ["weights"] }) };
    delete v1Chair.sex;
    delete v1Chair.regions;
    delete v1Chair.walking;
    delete v1Chair.romFlags;
    expect(canClearV7Ids(v1Chair)).toBe(false);
    expect(libraryPool(v1Chair).map((e) => e.id)).toContain("seated_arnold_press");
    // overhead_load_wheelchair_sci: «loaded work with the hand above the shoulder ... removed by default».
    expect(
      libraryPool(v7({ mobility: "wheelchair", equipment: ["weights"], walking: { status: "no" } })).map(
        (e) => e.id,
      ),
    ).not.toContain("seated_arnold_press");
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
