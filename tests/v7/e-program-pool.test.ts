/**
 * Step E2 (product v7 contract 2.10; D-023 item 2, gap 4): programPool, the eligible pool of the v7
 * program only. libraryPool's rules hold as they are, with the new exercises (drafts), and the two pool
 * rules of the clinical review that would change v1 pools apply here alone:
 *   - an item that also has a seated form keeps it for people who do not stand and for balance_support
 *     (review C14: today libraryPool hides glute_squeeze, quad_set, shoulder_wall_press and chest_opener
 *     from them);
 *   - a wheelchair user gets only items tagged wheelchair_friendly, unless pc_transfer_chair is yes
 *     (review C11, EX-Q19).
 * libraryPool(h) is unchanged (tests/v7/e-pool.test.ts pins every v1 corpus pool).
 */
import { describe, expect, it } from "vitest";
import { LIBRARY, libraryPool, programPool } from "../../src/medical/pool";
import { corpus } from "./e-corpus";
import { intake } from "./e-fixtures";

const ids = (list: { id: string }[]) => list.map((e) => e.id);
const SEATED_FORMS = ["seated", "seated_forward"];
const hasSeatedForm = (id: string) =>
  (LIBRARY.find((e) => e.id === id)!.positions ?? []).some((p) => SEATED_FORMS.includes(p));

describe("programPool", () => {
  it("holds the drafts, which libraryPool keeps out", () => {
    const h = intake();
    expect(ids(programPool(h))).toContain("table_slides");
    expect(ids(libraryPool(h))).not.toContain("table_slides");
    expect(ids(programPool(h))).toEqual(expect.arrayContaining(ids(libraryPool(h, { includeDrafts: true }))));
  });

  it("keeps the seated form of a mixed item for a person who does not stand (review C14)", () => {
    const seated = intake({ mobility: "seated", walking: { status: "no" } });
    for (const id of ["glute_squeeze", "quad_set", "stomach_vacuum"]) {
      expect(ids(libraryPool(seated, { includeDrafts: true })), id).not.toContain(id);
      expect(ids(programPool(seated)), id).toContain(id);
    }
    // An item with no seated form stays out.
    for (const id of ["glute_bridge", "dead_bug", "bird_dog", "wall_push_ups"])
      expect(ids(programPool(seated)), id).not.toContain(id);
  });

  it("keeps the seated form of a mixed item for balance_support (review C14)", () => {
    const support = intake({ restrictions: ["balance_support"] });
    for (const id of ["shoulder_wall_press", "chest_opener", "heel_raises"]) {
      expect(ids(libraryPool(support, { includeDrafts: true })), id).not.toContain(id);
      expect(ids(programPool(support)), id).toContain(id);
    }
    for (const id of ["single_leg_balance", "heel_toe_stand", "standing_weight_shift"])
      expect(ids(programPool(support)), id).not.toContain(id);
  });

  it("gives a wheelchair user only wheelchair friendly items, unless the transfer to a steady chair is yes", () => {
    const chair = intake({ mobility: "wheelchair", walking: { status: "no" } });
    const pool = programPool(chair);
    expect(pool.length).toBeGreaterThan(0);
    for (const e of pool) expect(e.tags, e.id).toContain("wheelchair_friendly");
    // hamstring_curl_with_band and seated_heel_dig are seated items without the tag.
    const transfer = intake({
      mobility: "wheelchair",
      walking: { status: "no" },
      equipment: ["bands"],
      romFlags: { osteoporosis: false, neckCaution: false, transferChair: true },
    });
    expect(ids(programPool(transfer))).toEqual(
      expect.arrayContaining(["hamstring_curl_with_band", "seated_heel_dig"]),
    );
    expect(
      ids(programPool({ ...transfer, romFlags: { osteoporosis: false, neckCaution: false } })),
    ).not.toContain("hamstring_curl_with_band");
  });

  it("only relaxes those rules: every other libraryPool rule holds for the whole corpus", () => {
    let checked = 0;
    for (const { h } of corpus().filter((_, i) => i % 7 === 0)) {
      const base = new Set(ids(libraryPool(h, { includeDrafts: true })));
      for (const e of programPool(h)) {
        if (base.has(e.id)) continue;
        // An item programPool adds back has a seated form, and the person does not stand or needs support.
        const relaxed =
          hasSeatedForm(e.id) &&
          (h.mobility !== "standing" ||
            h.restrictions.includes("balance_support") ||
            h.restrictions.includes("no_weight_bearing")) &&
          !(
            h.mobility === "wheelchair" &&
            !e.tags.includes("wheelchair_friendly") &&
            h.romFlags?.transferChair !== true
          );
        expect(relaxed, `${e.id} ${JSON.stringify(h)}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
