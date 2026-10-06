/**
 * D-029 item 1, E2-8 (safety): the v1 plan's camera part reads the body map's region ids for a v7
 * intake (region_not_cleared, region_early_post_op, region_acute_injury), as the library's region
 * rules read them (contraindications.ts regionOpenPositions on the movement's library entry). A recent
 * surgery or injury then also removes the camera movements of that region; a v1 intake is unchanged.
 */
import { describe, expect, it } from "vitest";
import { createPlan, validateIntake, type Intake } from "../../src/medical/plan";
import { CAMERA_TWINS, libraryById } from "../../src/medical/pool";
import { reasonText } from "../../src/app/platform-copy";
import { engineView } from "../../src/features/booth/views";
import { entry, intake } from "./e-fixtures";

const DASH = /[-‐-―−]/;
/** Stands, walks and has weights, so all three camera movements are in its plan. */
const base = intake({ equipment: ["weights"], goal: "strength" });
const plan = (over: Partial<Intake>) => {
  const h = { ...base, ...over };
  expect(validateIntake(h)).toBe(true);
  return createPlan(h);
};
const ids = (p: ReturnType<typeof createPlan>) => p.exercises.map((e) => e.exerciseId);
const why = (p: ReturnType<typeof createPlan>, id: string) =>
  p.exclusions.find((e) => e.exerciseId === id)?.reason;

describe("the camera part reads the body map's recent surgeries and injuries (E2-8)", () => {
  it("reads each camera movement's regions from its library entry", () => {
    for (const id of ["seated_shoulder_press", "seated_biceps_curl", "sit_to_stand"])
      expect(libraryById(CAMERA_TWINS[id] ?? id)?.targets?.length).toBeGreaterThan(0);
  });

  it("has all three camera movements without a recent region", () => {
    expect(ids(plan({}))).toEqual(
      expect.arrayContaining(["seated_shoulder_press", "seated_biceps_curl", "sit_to_stand"]),
    );
  });

  it("a rotator cuff repair 5 weeks ago, not cleared, removes the shoulder press", () => {
    const p = plan({
      regions: [entry("shoulder", "right", ["after_surgery"], { surgery: { since: "lt6w", cleared: "no" } })],
    });
    expect(ids(p)).not.toContain("seated_shoulder_press");
    expect(why(p, "seated_shoulder_press")).toBe("region_recent");
    // The curl works the elbow, and sit to stand the legs.
    expect(ids(p)).toEqual(expect.arrayContaining(["seated_biceps_curl", "sit_to_stand"]));
  });

  it("a surgery under 12 weeks closes the loaded movements of its region even once cleared", () => {
    const p = plan({
      regions: [
        entry("knee", "left", ["after_surgery"], {
          surgery: { since: "6w_3m", cleared: "yes", avoid: [], stretchAllowed: "yes", loadAllowed: "yes" },
        }),
      ],
    });
    expect(why(p, "sit_to_stand")).toBe("region_recent");
    expect(ids(p)).toEqual(expect.arrayContaining(["seated_shoulder_press", "seated_biceps_curl"]));
  });

  it("an elbow surgery removes the press and the curl", () => {
    const p = plan({
      regions: [entry("elbow", "right", ["after_surgery"], { surgery: { since: "lt6w", cleared: "no" } })],
    });
    expect(why(p, "seated_shoulder_press")).toBe("region_recent");
    expect(why(p, "seated_biceps_curl")).toBe("region_recent");
    expect(ids(p)).toContain("sit_to_stand");
  });

  it("an injury under 6 weeks names the recent region, over the v1 pain reason", () => {
    const p = plan({
      pain: ["knee"],
      regions: [entry("knee", "right", ["injury"], { injury: { since: "lt6w" } })],
    });
    expect(why(p, "sit_to_stand")).toBe("region_recent");
  });

  it("keeps the movements once the windows have passed", () => {
    const older = plan({
      regions: [entry("shoulder", "right", ["after_surgery"], { surgery: { since: "3m_6m" } })],
    });
    expect(ids(older)).toContain("seated_shoulder_press");
    const notRecent = plan({
      pain: ["knee"],
      regions: [entry("knee", "right", ["injury"], { injury: { since: "6w_3m" } })],
    });
    // The v1 knee pain rule still leaves sit to stand out, with its own reason.
    expect(why(notRecent, "sit_to_stand")).toBe("standing");
  });

  it("a v1 intake (no body map) is planned exactly as before", () => {
    const v1: Intake = { ...base };
    delete v1.sex;
    delete v1.regions;
    delete v1.walking;
    delete v1.romFlags;
    const p = createPlan(v1);
    expect(ids(p)).toEqual(
      expect.arrayContaining(["seated_shoulder_press", "seated_biceps_curl", "sit_to_stand"]),
    );
    expect(p.exclusions).toEqual([]);
  });

  it("says why in both languages, on the Program tab and at the booth", () => {
    const copy = reasonText.region_recent;
    expect(copy.ar.length).toBeGreaterThan(0);
    expect(copy.en.length).toBeGreaterThan(0);
    expect(copy.ar + copy.en).not.toMatch(DASH);
    const h = {
      ...base,
      regions: [entry("shoulder", "right", ["after_surgery"], { surgery: { since: "lt6w", cleared: "no" } })],
    };
    for (const lang of ["ar", "en"] as const) {
      const note = engineView(h, createPlan(h), lang, reasonText).excluded.find(
        (x) => x.id === "seated_shoulder_press",
      )?.note;
      expect(note).toBeTruthy();
      expect(note).not.toBe("region_recent");
      expect(note).not.toMatch(DASH);
    }
  });
});
