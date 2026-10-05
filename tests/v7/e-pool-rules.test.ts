/**
 * Step E1 (product v7 contract 2.10 rules 1 and 2): the draft filter and the v7 contraindication hook
 * of libraryPool, on a small synthetic library (library.json mocked), so each rule is seen alone:
 *   1. a draft only with includeDrafts;
 *   2. the v7 ids the intake decides close an exercise, or only its standing or chair front forms;
 *      an intake without the v7 fields drops every exercise with a v7 id or a hip end range item;
 *      a hip replacement under 3 months drops every hip end range item, whatever limits were ticked.
 * The real library's corpus tests are in tests/v7/e-pool.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import type { Intake } from "../../src/medical/plan";
import { LIBRARY, libraryPool, type LibraryExercise } from "../../src/medical/pool";
import { entry, flags, hipReplacement, v1, v7 } from "./e-corpus";

const SYNTHETIC = vi.hoisted(() => {
  type Entry = Record<string, unknown> & { id: string; status?: string };
  const ex = (id: string, over: Record<string, unknown> = {}): Entry => ({
    id,
    name: { ar: id, en: id },
    description: { ar: id, en: id },
    category: "flexibility",
    muscles: [],
    equipment: [],
    difficulty: "beginner",
    minutes: 3,
    steps: { ar: [id], en: [id] },
    tags: ["seated", "wheelchair_friendly", "beginner_friendly"],
    demands: [],
    contraindications: [],
    positions: ["seated"],
    targets: [],
    painFriendly: true,
    ...over,
  });
  return [
    ex("approved_seated"),
    ex("approved_shoulder_pain", { contraindications: ["shoulder_injury"] }),
    ex("approved_v7_id", { contraindications: ["weak_shoulder"] }),
    ex("draft_seated", { status: "draft" }),
    ex("draft_osteo", { status: "draft", contraindications: ["osteoporosis_spine"] }),
    ex("draft_hip_flex", {
      status: "draft",
      contraindications: ["hip_precautions_posterior"],
      hipEndRange: ["flexion_past_90"],
    }),
    ex("draft_hip_end_only", { status: "draft", hipEndRange: ["flexion_past_90"] }),
    ex("draft_mixed", {
      status: "draft",
      positions: ["seated", "standing"],
      contraindications: ["standing_gate"],
    }),
    ex("draft_standing_only", {
      status: "draft",
      tags: ["standing", "beginner_friendly"],
      positions: ["standing_supported"],
      contraindications: ["standing_gate"],
    }),
    ex("draft_chair_front", {
      status: "draft",
      positions: ["seated_forward", "standing"],
      contraindications: ["sitting_balance", "standing_gate"],
    }),
    ex("draft_pad", {
      status: "draft",
      tags: ["standing", "beginner_friendly"],
      positions: ["standing"],
      contraindications: ["pad_not_eligible"],
    }),
    ex("approved_by_status", { status: "approved" }),
  ];
});
vi.mock("../../src/exercises/library.json", () => ({ default: SYNTHETIC }));

const ids = (h: Intake, opts?: { includeDrafts?: boolean }) =>
  libraryPool(h, opts).map((e: LibraryExercise) => e.id);
const drafts = (h: Intake) => ids(h, { includeDrafts: true }).filter((id) => id.startsWith("draft_"));

describe("the synthetic library", () => {
  it("is the library the pool reads", () => {
    expect(LIBRARY.map((e) => e.id)).toEqual(SYNTHETIC.map((e) => e.id));
  });
});

describe("rule 1: the default pool never holds a draft", () => {
  it("drops every draft unless includeDrafts is true, whatever the intake", () => {
    for (const h of [v1(), v7(), v7({ mobility: "wheelchair" }), v1({ pain: ["shoulder"] })]) {
      for (const pool of [ids(h), ids(h, {}), ids(h, { includeDrafts: false })]) {
        expect(pool.some((id) => SYNTHETIC.find((e) => e.id === id)?.status === "draft")).toBe(false);
        expect(pool).toContain("approved_seated");
      }
    }
  });

  it("keeps an entry whose status is approved, as one without a status", () => {
    expect(ids(v1())).toContain("approved_by_status");
  });

  it("holds the drafts a v7 intake without findings may do when asked", () => {
    expect(drafts(v7())).toEqual([
      "draft_seated",
      "draft_osteo",
      "draft_hip_flex",
      "draft_hip_end_only",
      "draft_mixed",
      "draft_standing_only",
      "draft_chair_front",
      "draft_pad",
    ]);
  });
});

describe("rule 2: the v7 contraindications inside libraryPool", () => {
  it("drops an exercise whose v7 id the intake decides", () => {
    const osteo = v7({ romFlags: flags({ osteoporosis: true }) });
    expect(ids(osteo, { includeDrafts: true })).not.toContain("draft_osteo");
    expect(ids(osteo, { includeDrafts: true })).toContain("draft_seated");
  });

  it("keeps the v1 pain rule as it was", () => {
    expect(ids(v1({ pain: ["shoulder"] }))).not.toContain("approved_shoulder_pain");
    expect(ids(v7({ pain: ["shoulder"] }))).not.toContain("approved_shoulder_pain");
  });

  it("closes only the standing forms for standing_gate, and the chair front for sitting_balance", () => {
    const seated = v7({ mobility: "seated" });
    expect(drafts(seated)).toContain("draft_mixed");
    expect(drafts(seated)).not.toContain("draft_standing_only");
    // Standing closed and no balance sitting: the chair front form is closed too.
    expect(drafts(v7({ mobility: "seated", romFlags: flags({ sitUnsupported: "no" }) }))).not.toContain(
      "draft_chair_front",
    );
    // Standing open, chair front closed: the standing form is left.
    expect(drafts(v7({ romFlags: flags({ sitUnsupported: "no" }) }))).toContain("draft_chair_front");
  });

  it("never drops an exercise for the walking pad alone", () => {
    expect(drafts(v7())).toContain("draft_pad");
  });

  it("an intake without the v7 fields cannot clear a v7 id or a hip end range item", () => {
    const h = v1();
    expect(drafts(h)).toEqual(["draft_seated"]);
    expect(ids(h, { includeDrafts: true })).not.toContain("approved_v7_id");
    // A v7 intake clears what it decides: weak_shoulder is a pre-check answer, so it does not hold.
    expect(ids(v7(), { includeDrafts: true })).toContain("approved_v7_id");
  });

  it("drops every hip end range item after a hip replacement under 3 months, whatever was ticked", () => {
    for (const avoid of [undefined, ["none"], ["back_out"], ["flex90"]] as const) {
      const h = v7({ regions: [hipReplacement(avoid ? [...avoid] : undefined)] });
      const pool = drafts(h);
      expect(pool, JSON.stringify(avoid)).not.toContain("draft_hip_flex");
      expect(pool, JSON.stringify(avoid)).not.toContain("draft_hip_end_only");
      expect(pool).toContain("draft_seated");
    }
    // A hip surgery that was not a replacement, or one 3 months ago or more, keeps them.
    const older = v7({
      regions: [entry("hip", "right", ["after_surgery"], { surgery: { since: "3m_6m" } })],
    });
    expect(drafts(older)).toEqual(expect.arrayContaining(["draft_hip_flex", "draft_hip_end_only"]));
  });

  it("keeps libraryPool(h) for every existing caller", () => {
    expect(libraryPool(v7())).toEqual(libraryPool(v7(), { includeDrafts: false }));
  });
});
