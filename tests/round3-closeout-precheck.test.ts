/**
 * The round 3 closeout panel in the pure pre-check and check in rules (council R3C-09, R3C-12,
 * R3C-19, R3C-27, R3C-30):
 *   R3C-09  the fine zone is never null at home while an arm can signal;
 *   R3C-12  a spoken answer is fine only with a fine phrase and no negator or not fine word anywhere;
 *   R3C-27  Ankle or foot, and Another area, for a recent surgery;
 *   R3C-30  a missing completedBefore asks pc_sci_ad_since.
 */
import { describe, expect, it } from "vitest";
import { fineZoneSide } from "../src/engine/checkin";
import { CHECK_DATA } from "../src/movements/assessments";
import { spokenCheckInAnswer, visibleQuestions } from "../src/medical/precheck";
import { envOf, fill, run, skipOf, variantsOf } from "./precheck-fixtures";

const standing = (p: Parameters<typeof envOf>[0] = {}, o: Parameters<typeof envOf>[1] = {}) =>
  envOf({ position: "standing", ...p }, o);

describe("R3C-09: the fine zone when every arm is excluded", () => {
  it("keeps the order limb loss, weaker side, pain side, SCI arm function, then the right", () => {
    expect(fineZoneSide({})).toBe("right");
    expect(fineZoneSide({ weaker: "right" })).toBe("left");
    expect(fineZoneSide({ painSides: ["left"] })).toBe("right");
    expect(fineZoneSide({ armFunction: { right: "bend_no_hold", left: "bend_hold" } })).toBe("left");
  });

  it("falls back to the side excluded only by pain, then the weaker arm that lifts, then the SCI arm", () => {
    // A weaker left arm that can lift and pain in the right: the side excluded only by pain.
    expect(fineZoneSide({ weaker: "left", weakLift: "yes", painSides: ["right"] })).toBe("right");
    // The right arm lost: the weaker left arm with pc_weak_lift yes.
    expect(fineZoneSide({ weaker: "left", weakLift: "yes", limbLossArm: "right" })).toBe("left");
    // The right arm cannot bend: never the arm that cannot signal.
    expect(fineZoneSide({ weaker: "left", weakLift: "yes", armFunction: { right: "no_bend" } })).toBe("left");
    // Pain in both: the better SCI arm function.
    expect(
      fineZoneSide({ painSides: ["both"], armFunction: { right: "bend_no_hold", left: "bend_hold" } }),
    ).toBe("left");
    // Null only when no arm can signal (noArmSignal).
    expect(fineZoneSide({ weaker: "left", weakLift: "no", limbLossArm: "right" })).toBeNull();
    expect(fineZoneSide({ armFunction: { right: "no_bend", left: "no_bend" } })).toBeNull();
  });

  it("the pre-check gives a fine zone side whenever noArmSignal is false", () => {
    const env = envOf(
      { conditions: ["stroke"], support: "left" },
      { firstCheck: false, sideLeanDoneAtHome: true, setup: { painSides: ["right"] } },
    );
    const o = run(env, { pc_weak_lift: "yes" });
    expect(o.checkIn).toMatchObject({ noArmSignal: false, fineZoneSide: "right" });
    const lost = envOf(
      { conditions: ["stroke", "upper_limb_unilateral"], support: "left" },
      { firstCheck: false, sideLeanDoneAtHome: true, setup: { limbLoss: { arm: "right" } } },
    );
    expect(run(lost, { pc_weak_lift: "yes" }).checkIn).toMatchObject({
      noArmSignal: false,
      fineZoneSide: "left",
    });
    expect(run(lost, { pc_weak_lift: "no" }).checkIn).toMatchObject({
      noArmSignal: true,
      fineZoneSide: null,
    });
  });
});

describe("R3C-12: the spoken fine and negation (whole utterance)", () => {
  const cases: [string, "ar" | "en", string][] = [
    ["أنا بخير", "ar", "fine"],
    ["مو بخير", "ar", "not_fine"],
    ["ما أنا بخير", "ar", "not_fine"],
    // A negator anywhere in the utterance: not fine, the safe error.
    ["بخير ما فيني شي", "ar", "not_fine"],
    ["لا لا أنا بخير", "ar", "not_fine"],
    ["مب بخير", "ar", "not_fine"],
    ["لست بخير", "ar", "not_fine"],
    ["ماني بخير", "ar", "not_fine"],
    ["مش بخير", "ar", "not_fine"],
    ["I'm fine", "en", "fine"],
    ["I’m not fine", "en", "not_fine"],
    ["I'm fine, don't worry", "en", "not_fine"],
    ["never been better, I'm fine", "en", "not_fine"],
    ["no I'm fine", "en", "not_fine"],
  ];
  it.each(cases)("%s (%s) reads %s", (text, lang, expected) => {
    expect(spokenCheckInAnswer(text, lang)).toBe(expected);
  });

  it("the negators are data (engine.speech.negators) and the negated phrases are not fine words", () => {
    const speech = CHECK_DATA.engine.speech as typeof CHECK_DATA.engine.speech & {
      negators: { ar: string[]; en: string[] };
    };
    for (const w of ["لا", "مو", "مب", "ما", "مش", "لست", "ماني"]) expect(speech.negators.ar).toContain(w);
    for (const w of ["not", "never", "no"]) expect(speech.negators.en).toContain(w);
    expect(speech.notFineWords.ar).toContain("مو بخير");
    expect(speech.notFineWords.en).toContain("I’m not fine");
  });
});

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
