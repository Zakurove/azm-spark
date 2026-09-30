/**
 * The round 3 closeout panel in the pure pre-check rules (council R3C-19, R3C-27, R3C-30; R3C-09 and
 * R3C-12, the fine zone and the spoken answer, went with D-016):
 *   R3C-27  Ankle or foot, and Another area, for a recent surgery;
 *   R3C-30  a missing completedBefore asks pc_sci_ad_since.
 */
import { describe, expect, it } from "vitest";
import { CHECK_DATA } from "../src/movements/assessments";
import { visibleQuestions } from "../src/medical/precheck";
import { envOf, fill, run, skipOf, variantsOf } from "./precheck-fixtures";

const standing = (p: Parameters<typeof envOf>[0] = {}, o: Parameters<typeof envOf>[1] = {}) =>
  envOf({ position: "standing", ...p }, o);

describe("R3C-27: a recent surgery with no listed area", () => {
  it("lists Ankle or foot in the areas and the surgery areas, loading the chair stand", () => {
    const ankle = CHECK_DATA.areas.find((a) => a.id === "ankle_foot");
    expect(ankle?.label).toEqual({ ar: "الكاحل أو القدم", en: "Ankle or foot" });
    expect(ankle?.loads).toEqual([{ test: "chair_stand_30s", side: "none" }]);
    expect(CHECK_DATA.surgeryAreas.map((a) => a.id)).toEqual(expect.arrayContaining(["ankle_foot", "other"]));
    const o = run(standing(), {
      pc_surgery_recent: "yes",
      "pc_surgery_recent:areas": ["ankle_foot"],
      "pc_surgery_recent:ankle_foot": "no",
    });
    expect(skipOf(o, "chair_stand_30s", "none")).toBe("recent_surgery");
    expect(skipOf(o, "trunk_control_seated", "left")).toBeUndefined();
    // Cleared by the surgeon: nothing is skipped.
    const cleared = run(standing(), {
      pc_surgery_recent: "yes",
      "pc_surgery_recent:areas": ["ankle_foot"],
      "pc_surgery_recent:ankle_foot": "yes",
    });
    expect(skipOf(cleared, "chair_stand_30s", "none")).toBeUndefined();
  });

  it("Another area, and a yes with no listed area, take the widest listed restriction", () => {
    for (const areas of [["other"], []]) {
      const answers = {
        pc_surgery_recent: "yes",
        "pc_surgery_recent:areas": areas,
        "pc_surgery_recent:other": "no",
      };
      const up = run(standing(), answers);
      expect(skipOf(up, "chair_stand_30s", "none"), JSON.stringify(areas)).toBe("recent_surgery");
      expect(variantsOf(up, "arm_curl_30s", "left")).toContain("arm_only");
      expect(variantsOf(up, "arm_curl_30s", "right")).toContain("arm_only");
      const seated = run(envOf(), answers);
      expect(skipOf(seated, "trunk_control_seated", "left")).toBe("recent_surgery");
      expect(skipOf(seated, "trunk_control_seated", "right")).toBe("recent_surgery");
    }
    // Another area cleared by the surgeon: nothing is skipped.
    const cleared = run(envOf(), {
      pc_surgery_recent: "yes",
      "pc_surgery_recent:areas": ["other"],
      "pc_surgery_recent:other": "yes",
    });
    expect(cleared.skips).toEqual([]);
  });

  it("a flare with no listed area keeps the built reading: the weight bearing test only", () => {
    const o = run(standing({ conditions: ["arthritis"] }), {
      pc_arthritis_flare: "yes",
      "pc_arthritis_flare:areas": [],
    });
    expect(skipOf(o, "chair_stand_30s", "none")).toBe("flare");
    expect(skipOf(o, "trunk_control_seated", "left")).toBeUndefined();
  });
});

describe("R3C-30: the safe reading when completedBefore is missing", () => {
  it("asks pc_sci_ad_since for SCI at T6 or above even when the context does not say", () => {
    const env = envOf(
      { position: "wheelchair", conditions: ["sci_complete"] },
      { firstCheck: true, setup: { sciT6: true } },
    );
    const t6 = { pc_sci_level: "yes" };
    // A first check that is the first of all: not asked.
    expect(visibleQuestions(env, fill(env, t6))).not.toContain("pc_sci_ad_since");
    // The first home check after booth checks: asked.
    const afterBooth = { ...env, completedBefore: true };
    expect(visibleQuestions(afterBooth, fill(afterBooth, t6))).toContain("pc_sci_ad_since");
    // Not known: the safe reading asks it.
    const without = { ...env };
    delete (without as { completedBefore?: boolean }).completedBefore;
    expect(visibleQuestions(without, fill(without, t6))).toContain("pc_sci_ad_since");
  });
});
