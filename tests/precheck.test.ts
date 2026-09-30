/**
 * Pre-check (src/medical/precheck.ts) against the clinical spec 2.1 to 2.7:
 *   1. the data only uses conditions and showIf keys the module evaluates;
 *   2. visibility: one test per showIf form, the baseline setup gating, order, hidden answers;
 *   3. one table case per pre-check action of the data (the coverage test proves every action has one);
 *   4. the pain rules (storage, 9, 7 or 8, areas at 6 and at 7);
 *   5. the chair stand rules: hands allowed, pushing arm, helper rules, booth vitals.
 */
import { describe, expect, it } from "vitest";
import { CHECK_DATA } from "../src/movements/assessments";
import type { PrecheckId, ShowIf } from "../src/movements/types";
import {
  SHOW_IF_KEYS,
  evaluatePrecheck,
  missingAnswers,
  parseQuestionId,
  questionId,
  unsupportedConditions,
  visibleQuestions,
  type Answers,
  type PrecheckEnv,
  type PrecheckOutcome,
} from "../src/medical/precheck";
import { NOW, TODAY, envOf, fill, run, skipOf, variantsOf } from "./precheck-fixtures";

const standing = (p: Parameters<typeof envOf>[0] = {}, o: Parameters<typeof envOf>[1] = {}) =>
  envOf({ position: "standing", ...p }, o);
/** Booth vitals (Q21): two readings, the heart rate and the cuff's irregular heartbeat flag. */
const vitals = (v: Record<string, number | boolean> = {}) => ({
  systolic1: 120,
  diastolic1: 80,
  systolic2: 120,
  diastolic2: 80,
  restingHeartRate: 70,
  irregularHeartbeat: false,
  ...v,
});
/**
 * A booth chair stand for SCI, which the selection never produces (Q19 (5b)): the O47 rows of
 * pc_booth_vitals are kept for defence in depth and tested here.
 */
const sciBoothStand = () =>
  envOf(
    { position: "standing", conditions: ["sci_incomplete"], clearance: "unsure" },
    { setting: "booth", baseTests: ["shoulder_abduction", "chair_stand_30s", "arm_curl_30s"] },
  );

/* ------------------------------------------------------------------ data */

describe("data the pre-check evaluates", () => {
  it("uses only action conditions the module supports", () => {
    expect(unsupportedConditions()).toEqual([]);
  });

  it("uses only showIf keys the module evaluates, at any depth", () => {
    const used = new Set<string>();
    const walk = (s: ShowIf | null | undefined) => {
      if (!s) return;
      for (const [k, v] of Object.entries(s)) {
        used.add(k);
        if (k === "anyOf") (v as ShowIf[]).forEach(walk);
      }
    };
    for (const q of CHECK_DATA.precheck) {
      walk(q.showIf);
      for (const a of q.actions) {
        if (a.do === "emergency" && a.alsoShowIf) {
          const { screen, ...when } = a.alsoShowIf;
          expect(screen).toMatch(/^scr_/);
          walk(when);
        }
      }
    }
    for (const o of CHECK_DATA.stopRouting.options) walk(o.showIf);
    expect([...used].filter((k) => !SHOW_IF_KEYS.includes(k as keyof ShowIf))).toEqual([]);
    // Every form of the task list is in the data or evaluated.
    for (const k of [
      "answer",
      "anyOf",
      "conditionsAny",
      "painAny",
      "supportNot",
      "positionIn",
      "flag",
      "notFirstCheck",
      "testSelected",
      "setting",
      "noUnresolvedChangeReported",
      "unresolvedChangeReported",
      "clearanceIn",
      "previousFollowUp",
    ]) {
      expect(SHOW_IF_KEYS).toContain(k);
    }
  });

  it("parses question instance ids", () => {
    expect(parseQuestionId("pc_urgent")).toEqual({ base: "pc_urgent" });
    expect(parseQuestionId("pc_helper:trunk_control_seated")).toEqual({
      base: "pc_helper",
      part: "trunk_control_seated",
    });
    expect(parseQuestionId("pc_nope")).toBeNull();
    expect(questionId("pc_steadi", "fell")).toBe("pc_steadi:fell");
  });
});

/* ----------------------------------------------------------- visibility */

describe("visibleQuestions", () => {
  it("asks the every check questions in data order, never pc_setting", () => {
    const env = envOf();
    const ids = visibleQuestions(env, {});
    expect(ids.slice(0, 5)).toEqual([
      "pc_urgent",
      "pc_unwell",
      "pc_change",
      "pc_surgery_recent",
      "pc_pain_now",
    ]);
    expect(ids).not.toContain("pc_setting");
    const order = (id: string) => CHECK_DATA.precheck.findIndex((q) => q.id === parseQuestionId(id)!.base);
    const all = visibleQuestions(env, fill(env, { pc_pain_now: 3, pc_surgery_recent: "yes" }));
    expect(all.map(order)).toEqual([...all.map(order)].sort((a, b) => a - b));
  });

  it("answer equals: pc_change yes opens pc_change_cleared", () => {
    const env = envOf();
    expect(visibleQuestions(env, { pc_change: "no" })).not.toContain("pc_change_cleared");
    expect(visibleQuestions(env, { pc_change: "yes" })).toContain("pc_change_cleared");
  });

  it("answer gte: pc_pain_worse and pc_pain_areas only with pain 1 or more", () => {
    const env = envOf();
    expect(visibleQuestions(env, { pc_pain_now: 0 })).not.toContain("pc_pain_worse");
    expect(visibleQuestions(env, { pc_pain_now: 0 })).not.toContain("pc_pain_areas");
    expect(visibleQuestions(env, { pc_pain_now: 1 })).toEqual(
      expect.arrayContaining(["pc_pain_worse", "pc_pain_areas"]),
    );
  });

  it("noUnresolvedChangeReported and unresolvedChangeReported: an uncleared change is asked directly", () => {
    const env = envOf({}, { firstCheck: false, unresolvedChangeReported: true });
    const ids = visibleQuestions(env, {});
    expect(ids).not.toContain("pc_change");
    expect(ids).toContain("pc_change_cleared");
    // Answering pc_change no cannot bypass it.
    expect(visibleQuestions(env, { pc_change: "no" })).toContain("pc_change_cleared");
  });

  it("painAny: pc_arm_pain_side once per arm pain area of the intake", () => {
    expect(
      visibleQuestions(envOf({ pain: ["back"] }), {}).some((id) => id.startsWith("pc_arm_pain_side")),
    ).toBe(false);
    const ids = visibleQuestions(envOf({ pain: ["wrist", "shoulder", "knee"] }), {});
    expect(ids.filter((id) => id.startsWith("pc_arm_pain_side"))).toEqual([
      "pc_arm_pain_side:shoulder",
      "pc_arm_pain_side:wrist",
    ]);
  });

  it("supportNot: pc_weak_lift and pc_weak_shoulder only with a declared weaker side", () => {
    expect(visibleQuestions(envOf(), {})).not.toContain("pc_weak_lift");
    expect(visibleQuestions(envOf({ support: "left" }), {})).toEqual(
      expect.arrayContaining(["pc_weak_lift", "pc_weak_shoulder"]),
    );
  });

  it("conditionsAny: condition questions only for their conditions", () => {
    expect(visibleQuestions(envOf(), {})).not.toContain("pc_ms_heat");
    expect(visibleQuestions(envOf({ conditions: ["ms"] }), {})).toContain("pc_ms_heat");
    expect(visibleQuestions(envOf({ conditions: ["parkinsons"] }), {})).toEqual(
      expect.arrayContaining(["pc_pd_on", "pc_pd_dose"]),
    );
    expect(visibleQuestions(envOf({ conditions: ["arthritis"] }), {})).toContain("pc_arthritis_flare");
  });

  it("positionIn and anyOf: pc_pressure_sore for wheelchair users or SCI, with the side lean selected", () => {
    expect(visibleQuestions(envOf({ position: "chair" }), {})).not.toContain("pc_pressure_sore");
    expect(visibleQuestions(envOf({ position: "wheelchair" }), {})).toContain("pc_pressure_sore");
    expect(visibleQuestions(envOf({ position: "chair", conditions: ["sci_incomplete"] }), {})).toContain(
      "pc_pressure_sore",
    );
    // Standing users with the chair stand have no side lean selected.
    expect(visibleQuestions(standing({ conditions: ["sci_incomplete"] }), {})).not.toContain(
      "pc_pressure_sore",
    );
  });

  it("testSelected: standing questions only with the chair stand, trunk questions only with the side lean", () => {
    const seated = visibleQuestions(envOf(), {});
    expect(seated).not.toContain("pc_walking_aid");
    expect(seated).toEqual(
      expect.arrayContaining(["pc_sit_unsupported", "pc_fall_sitting", "pc_trunk_armrests:chair"]),
    );
    const stand = visibleQuestions(standing(), {});
    expect(stand).toEqual(
      expect.arrayContaining(["pc_steadi:fell", "pc_steadi:unsteady", "pc_steadi:worry", "pc_walking_aid"]),
    );
    expect(stand).not.toContain("pc_sit_unsupported");
    // Knee pain at intake: the side lean takes the chair stand slot.
    const sub = visibleQuestions(standing({ pain: ["knee"] }), {});
    expect(sub).toContain("pc_sit_unsupported");
    expect(sub).not.toContain("pc_walking_aid");
  });

  it("setting: pc_trunk_armrests and pc_helper at home only; pc_booth_vitals at the booth only", () => {
    expect(visibleQuestions(envOf({}, { setting: "booth" }), {})).not.toContain("pc_trunk_armrests:chair");
    expect(visibleQuestions(envOf({}, { setting: "booth" }), {})).not.toContain(
      "pc_helper:trunk_control_seated",
    );
    const booth = standing({ clearance: "unsure" }, { setting: "booth" });
    expect(visibleQuestions(booth, {})).toContain("pc_booth_vitals");
    expect(visibleQuestions(standing({ clearance: "unsure" }), {})).not.toContain("pc_booth_vitals");
  });

  it("clearanceIn: pc_booth_vitals only for intake clearance no or unsure", () => {
    expect(visibleQuestions(standing({ clearance: "yes" }, { setting: "booth" }), {})).not.toContain(
      "pc_booth_vitals",
    );
    expect(visibleQuestions(standing({ clearance: "no" }, { setting: "booth" }), {})).toContain(
      "pc_booth_vitals",
    );
  });

  it("flag sci_t6: the AD questions follow pc_sci_level yes or not sure", () => {
    const env = envOf({ position: "wheelchair", conditions: ["sci_complete"] });
    expect(visibleQuestions(env, { pc_sci_level: "no" })).not.toContain("pc_sci_ad_now");
    for (const level of ["yes", "unsure"]) {
      const ids = visibleQuestions(env, { pc_sci_level: level });
      expect(ids).toEqual(expect.arrayContaining(["pc_sci_ad_now", "pc_sci_ready"]));
      expect(ids).not.toContain("pc_sci_ad_since"); // first check
    }
  });

  it("notFirstCheck: pc_sci_ad_since from the second check, from the stored flag", () => {
    const env = envOf(
      { position: "wheelchair", conditions: ["sci_complete"] },
      { firstCheck: false, setup: { sciT6: true } },
    );
    const ids = visibleQuestions(env, {});
    expect(ids).not.toContain("pc_sci_level");
    expect(ids).toEqual(expect.arrayContaining(["pc_sci_ad_since", "pc_sci_ad_now", "pc_sci_ready"]));
  });

  it("flag helper_required: pc_helper per test that needs a helper at home", () => {
    // A person with no condition at the first home side lean needs a helper (spec 4.3).
    expect(visibleQuestions(envOf(), fill(envOf()))).toContain("pc_helper:trunk_control_seated");
    // Not after a home side lean was done, without a listed condition.
    const later = envOf({}, { firstCheck: false, sideLeanDoneAtHome: true });
    expect(visibleQuestions(later, fill(later))).not.toContain("pc_helper:trunk_control_seated");
    // Not known: the safe reading asks for the helper.
    const unknown = envOf({}, { firstCheck: false });
    expect(visibleQuestions(unknown, fill(unknown))).toContain("pc_helper:trunk_control_seated");
    // Not when the test is already skipped by another answer.
    const noArmrests = fill(envOf(), { "pc_trunk_armrests:chair": "no" });
    expect(visibleQuestions(envOf(), noArmrests)).not.toContain("pc_helper:trunk_control_seated");
  });

  it("previousFollowUp: pc_after_last only after a lasting unresolved follow up", () => {
    expect(visibleQuestions(envOf({}, { firstCheck: false }), {})).not.toContain("pc_after_last");
    expect(visibleQuestions(envOf({}, { firstCheck: false, lastCheckLasting: true }), {})).toContain(
      "pc_after_last",
    );
  });

  it("baseline setup questions: first check, or when the stored setup lacks the answer", () => {
    const cond = { conditions: ["upper_limb_unilateral", "lower_limb_unilateral"], pain: ["elbow"] };
    const first = visibleQuestions(envOf(cond), {});
    expect(first).toEqual(
      expect.arrayContaining(["pc_arm_pain_side:elbow", "pc_limb_arm_side", "pc_limb_leg_side"]),
    );
    const later = envOf(cond, {
      firstCheck: false,
      setup: { painSides: ["left"], limbLoss: { arm: "left", leg: "right" } },
    });
    const ids = visibleQuestions(later, {});
    expect(ids).not.toContain("pc_arm_pain_side:elbow");
    expect(ids).not.toContain("pc_limb_arm_side");
    expect(ids).not.toContain("pc_limb_leg_side");
    // Worn now: the prosthesis questions are asked at every check.
    expect(ids).toEqual(expect.arrayContaining(["pc_limb_arm_prosthesis", "pc_limb_leg_prosthesis"]));
    // Lost setup: asked again.
    const lost = envOf(cond, { firstCheck: false, setup: { painSides: ["left"] } });
    expect(visibleQuestions(lost, {})).toEqual(
      expect.arrayContaining(["pc_limb_arm_side", "pc_limb_leg_side"]),
    );
  });

  it("follow ups: surgery areas, clearance per area, flare areas, arm function per arm", () => {
    const env = envOf({ conditions: ["arthritis", "sci_incomplete"] });
    const ids = visibleQuestions(env, {
      pc_surgery_recent: "yes",
      "pc_surgery_recent:areas": ["knee", "shoulder_left"],
      pc_arthritis_flare: "yes",
    });
    expect(ids).toEqual(
      expect.arrayContaining([
        "pc_surgery_recent:areas",
        "pc_surgery_recent:shoulder_left",
        "pc_surgery_recent:knee",
        "pc_arthritis_flare:areas",
        "pc_arm_function:right",
        "pc_arm_function:left",
      ]),
    );
    // Clearance questions follow the data order of the areas, not the client's order.
    expect(ids.indexOf("pc_surgery_recent:shoulder_left")).toBeLessThan(
      ids.indexOf("pc_surgery_recent:knee"),
    );
    // No arm function question for a missing arm.
    const loss = envOf({ conditions: ["sci_incomplete", "upper_limb_unilateral"] });
    const lossIds = visibleQuestions(loss, { pc_limb_arm_side: "left" });
    expect(lossIds).toContain("pc_arm_function:right");
    expect(lossIds).not.toContain("pc_arm_function:left");
  });

  it("ignores answers to questions that are not visible", () => {
    const env = envOf();
    const o = evaluatePrecheck(
      env,
      fill(env, { pc_pain_now: 0, pc_pain_worse: "yes", pc_ms_heat: "yes" }),
      NOW,
    );
    expect(o.status).toBe("proceed");
  });

  it("treats answers that do not fit as not answered", () => {
    const env = envOf();
    for (const bad of [
      { pc_urgent: "maybe" },
      { pc_pain_now: 11 },
      { pc_pain_now: 2.5 },
      { pc_pain_now: "3" },
      { pc_pain_now: 3, pc_pain_areas: { neck: 3 } },
      { pc_pain_now: 3, pc_pain_areas: { knee: 12 } },
      { pc_pain_now: 3, pc_pain_areas: ["knee"] },
      { pc_surgery_recent: "yes", "pc_surgery_recent:areas": ["toe"] },
    ] as Answers[]) {
      const answers = { ...fill(env), ...bad };
      const o = evaluatePrecheck(env, answers, NOW);
      expect(o.status).toBe("incomplete");
      expect(missingAnswers(env, answers).length).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------- one case per action */

interface Case {
  item: PrecheckId;
  action: number;
  name: string;
  env: PrecheckEnv;
  answers: Answers;
  check(o: PrecheckOutcome): void;
}

const wheel = (c: string[] = ["none"], support: "none" | "left" | "right" = "none") =>
  envOf({ position: "wheelchair", conditions: c, support });
const sciT6Later = () =>
  envOf(
    { position: "wheelchair", conditions: ["sci_complete"] },
    { firstCheck: false, setup: { sciT6: true } },
  );

const CASES: Case[] = [
  {
    item: "pc_setting",
    action: 0,
    name: "booth is recorded from the route: booth only tests go ahead with staff",
    env: envOf({}, { setting: "booth" }),
    answers: { pc_sit_unsupported: "no" },
    check: (o) => {
      expect(o.status).toBe("proceed");
      expect(o.skips).toEqual([]);
    },
  },
  {
    item: "pc_urgent",
    action: 0,
    name: "yes is an emergency with a next day lock",
    env: envOf(),
    answers: { pc_urgent: "yes" },
    check: (o) => {
      expect(o).toMatchObject({
        status: "emergency",
        reason: "urgent",
        screen: "scr_emergency",
        alsoShow: [],
        lock: { reason: "urgent", until: "next_day" },
      });
    },
  },
  {
    item: "pc_urgent",
    action: 0,
    name: "yes with SCI also shows the AD steps, even before pc_sci_level",
    env: wheel(["sci_incomplete"]),
    answers: { pc_urgent: "yes" },
    check: (o) => expect(o).toMatchObject({ status: "emergency", alsoShow: ["scr_ad"] }),
  },
  {
    item: "pc_faint_since",
    action: 0,
    name: "yes postpones at once with recent_change and stores changeReported (Q33 (3))",
    env: envOf({}, { firstCheck: false, faintReportedUnresolved: true }),
    answers: { pc_faint_since: "yes" },
    check: (o) =>
      expect(o).toMatchObject({
        status: "postpone",
        reason: "recent_change",
        screen: "scr_postpone_care",
        stored: { changeReported: TODAY },
        faintReportedCleared: true,
      }),
  },
  {
    item: "pc_faint_since",
    action: 1,
    name: "either answer clears faintReported (Q33 (3))",
    env: envOf({}, { firstCheck: false, faintReportedUnresolved: true }),
    answers: { pc_faint_since: "no" },
    check: (o) => expect(o).toMatchObject({ status: "proceed", faintReportedCleared: true }),
  },
  {
    item: "pc_unwell",
    action: 0,
    name: "yes postpones (unwell)",
    env: envOf(),
    answers: { pc_unwell: "yes" },
    check: (o) =>
      expect(o).toMatchObject({
        status: "postpone",
        reason: "unwell",
        screen: "scr_postpone_unwell",
        lock: { reason: "unwell", until: "next_day" },
        stored: {},
      }),
  },
  {
    item: "pc_change",
    action: 0,
    name: "yes asks pc_change_cleared, and a cleared change goes ahead",
    env: envOf(),
    answers: { pc_change: "yes", pc_change_cleared: "yes" },
    check: (o) => expect(o.status).toBe("proceed"),
  },
  {
    item: "pc_change_cleared",
    action: 0,
    name: "yes records changeCleared as a date only",
    env: envOf(),
    answers: { pc_change: "yes", pc_change_cleared: "yes" },
    check: (o) => {
      expect(o.status).toBe("proceed");
      expect(o.stored.changeCleared).toBe(TODAY);
      expect(o.stored.changeReported).toBeUndefined();
    },
  },
  {
    item: "pc_change_cleared",
    action: 1,
    name: "no postpones (recent_change) and keeps changeReported as a date only",
    env: envOf(),
    answers: { pc_change: "yes", pc_change_cleared: "no" },
    check: (o) => {
      expect(o).toMatchObject({
        status: "postpone",
        reason: "recent_change",
        screen: "scr_postpone_care",
        lock: { reason: "recent_change", until: "next_day" },
      });
      expect(o.stored).toEqual({ changeReported: TODAY });
    },
  },
  {
    item: "pc_surgery_recent",
    action: 0,
    name: "an uncleared shoulder skips the tests that load it (recent_surgery)",
    env: envOf(),
    answers: {
      pc_surgery_recent: "yes",
      "pc_surgery_recent:areas": ["shoulder_right", "knee"],
      "pc_surgery_recent:shoulder_right": "no",
      "pc_surgery_recent:knee": "yes",
    },
    check: (o) => {
      expect(o.status).toBe("proceed");
      expect(o.skips).toEqual([
        { testId: "shoulder_abduction", side: "right", reason: "recent_surgery" },
        { testId: "arm_curl_30s", side: "right", reason: "recent_surgery" },
      ]);
    },
  },
  {
    item: "pc_surgery_recent",
    action: 0,
    name: "chest or belly: arm curl without weight on both arms, no side lean",
    env: envOf(),
    answers: {
      pc_surgery_recent: "yes",
      "pc_surgery_recent:areas": ["chest_belly"],
      "pc_surgery_recent:chest_belly": "no",
    },
    check: (o) => {
      expect(skipOf(o, "trunk_control_seated", "left")).toBe("recent_surgery");
      expect(skipOf(o, "trunk_control_seated", "right")).toBe("recent_surgery");
      expect(variantsOf(o, "arm_curl_30s", "left")).toEqual(["arm_only"]);
      expect(variantsOf(o, "arm_curl_30s", "right")).toEqual(["arm_only"]);
    },
  },
  {
    item: "pc_surgery_recent",
    action: 0,
    name: "knee or spine surgery skips the chair stand for standing users (no substitute today)",
    env: standing(),
    answers: {
      pc_surgery_recent: "yes",
      "pc_surgery_recent:areas": ["spine"],
      "pc_surgery_recent:spine": "no",
    },
    check: (o) => {
      expect(o.skips).toEqual([{ testId: "chair_stand_30s", side: "none", reason: "recent_surgery" }]);
    },
  },
  {
    item: "pc_pain_now",
    action: 0,
    name: "9 or more postpones (pain)",
    env: envOf(),
    answers: { pc_pain_now: 9, pc_pain_worse: "no", pc_pain_areas: {} },
    check: (o) =>
      expect(o).toMatchObject({
        status: "postpone",
        reason: "pain",
        screen: "scr_postpone_pain",
        lock: { reason: "pain", until: "next_day" },
      }),
  },
  {
    item: "pc_pain_now",
    action: 1,
    name: "7 or 8 goes ahead with warn_pain_high",
    env: envOf(),
    answers: { pc_pain_now: 7, pc_pain_worse: "no", pc_pain_areas: {} },
    check: (o) => {
      expect(o.status).toBe("proceed");
      expect(o.warnings).toContain("warn_pain_high");
      expect(o.stored.painNow).toBe(7);
    },
  },
  {
    item: "pc_pain_worse",
    action: 0,
    name: "yes postpones (pain_worse) at any pain level",
    env: envOf(),
    answers: { pc_pain_now: 2, pc_pain_worse: "yes", pc_pain_areas: {} },
    check: (o) =>
      expect(o).toMatchObject({ status: "postpone", reason: "pain_worse", screen: "scr_postpone_care" }),
  },
  {
    item: "pc_pain_areas",
    action: 0,
    name: "an area at 7 that a selected test loads postpones (pain)",
    env: envOf(),
    answers: { pc_pain_now: 4, pc_pain_worse: "no", pc_pain_areas: { elbow_left: 7 } },
    check: (o) =>
      expect(o).toMatchObject({ status: "postpone", reason: "pain", screen: "scr_postpone_pain" }),
  },
  {
    item: "pc_pain_areas",
    action: 1,
    name: "an area at 6 skips the tests that load it (pain_today)",
    env: envOf(),
    answers: { pc_pain_now: 4, pc_pain_worse: "no", pc_pain_areas: { shoulder_left: 6 } },
    check: (o) => {
      expect(o.status).toBe("proceed");
      expect(o.skips).toEqual([
        { testId: "shoulder_abduction", side: "left", reason: "pain_today" },
        { testId: "arm_curl_30s", side: "left", reason: "pain_today" },
      ]);
    },
  },
  {
    item: "pc_arm_pain_side",
    action: 0,
    name: "records setup.painSides; that arm curls without weight",
    env: envOf({ pain: ["shoulder", "wrist"] }),
    answers: { "pc_arm_pain_side:shoulder": "left", "pc_arm_pain_side:wrist": "left" },
    check: (o) => {
      expect(o.setupUpdates.painSides).toEqual(["left"]);
      expect(o.stored["setup.painSides"]).toEqual(["left"]);
      expect(variantsOf(o, "arm_curl_30s", "left")).toEqual(["arm_only"]);
      expect(variantsOf(o, "arm_curl_30s", "right")).toEqual([]);
    },
  },
  {
    item: "pc_weak_lift",
    action: 0,
    name: "no skips the weaker arm in both arm tests (arm_not_able)",
    env: envOf({ support: "left" }),
    answers: { pc_weak_lift: "no" },
    check: (o) =>
      expect(o.skips).toEqual([
        { testId: "shoulder_abduction", side: "left", reason: "arm_not_able" },
        { testId: "arm_curl_30s", side: "left", reason: "arm_not_able" },
      ]),
  },
  {
    item: "pc_weak_shoulder",
    action: 0,
    name: "yes skips the weaker side of the arm raise (weak_shoulder)",
    env: envOf({ support: "right" }),
    answers: { pc_weak_shoulder: "yes" },
    check: (o) =>
      expect(o.skips).toEqual([{ testId: "shoulder_abduction", side: "right", reason: "weak_shoulder" }]),
  },
  {
    item: "pc_weak_shoulder",
    action: 1,
    name: "yes: the weaker arm curls without weight",
    env: envOf({ support: "right" }),
    answers: { pc_weak_shoulder: "yes" },
    check: (o) => {
      expect(variantsOf(o, "arm_curl_30s", "right")).toEqual(["arm_only"]);
      expect(variantsOf(o, "arm_curl_30s", "left")).toEqual([]);
    },
  },
  {
    item: "pc_weak_shoulder",
    action: 2,
    name: "yes: the hands allowed chair stand pushes with the stronger hand only",
    env: standing({ support: "right" }),
    answers: { pc_weak_shoulder: "yes", pc_stand_no_hands: "no" },
    check: (o) =>
      expect(variantsOf(o, "chair_stand_30s", "none")).toEqual(["arms_assisted", "push_left_hand_only"]),
  },
  {
    item: "pc_limb_arm_side",
    action: 0,
    name: "records the limb loss side; the arm tests run on the other side only",
    env: envOf({ conditions: ["upper_limb_unilateral"] }),
    answers: { pc_limb_arm_side: "left" },
    check: (o) => {
      expect(o.setupUpdates.limbLoss).toEqual({ arm: "left" });
      expect(o.stored["setup.limbLoss"]).toEqual({ arm: "left" });
      expect(o.skips).toEqual([
        { testId: "shoulder_abduction", side: "left", reason: "limb_loss_arm" },
        { testId: "arm_curl_30s", side: "left", reason: "limb_loss_arm" },
      ]);
    },
  },
  {
    item: "pc_limb_arm_prosthesis",
    action: 0,
    name: "records the arm prosthesis worn now",
    env: envOf({ conditions: ["upper_limb_unilateral"] }),
    answers: { pc_limb_arm_prosthesis: "yes" },
    check: (o) => {
      expect(o.stored["fingerprint.armProsthesis"]).toBe(true);
      expect(o.setupUpdates.armProsthesis).toBe(true);
    },
  },
  {
    item: "pc_limb_leg_side",
    action: 0,
    name: "records the leg limb loss side",
    env: envOf({ conditions: ["lower_limb_unilateral"] }),
    answers: { pc_limb_leg_side: "left" },
    check: (o) => {
      expect(o.setupUpdates.limbLoss).toEqual({ leg: "left" });
      expect(o.stored["setup.limbLoss"]).toEqual({ leg: "left" });
    },
  },
  {
    item: "pc_limb_leg_prosthesis",
    action: 0,
    name: "records the leg prosthesis worn now (no is kept too)",
    env: envOf({ conditions: ["lower_limb_unilateral"] }),
    answers: { pc_limb_leg_prosthesis: "no" },
    check: (o) => {
      expect(o.stored["fingerprint.legProsthesis"]).toBe(false);
      expect(o.setupUpdates.legProsthesis).toBe(false);
    },
  },
  {
    item: "pc_sci_level",
    action: 0,
    name: "not sure sets sci_t6: warn_sci_t6 and the stored flag",
    env: wheel(["sci_complete"]),
    answers: { pc_sci_level: "unsure" },
    check: (o) => {
      expect(o.status).toBe("proceed");
      expect(o.warnings).toContain("warn_sci_t6");
      expect(o.setupUpdates.sciT6).toBe(true);
      expect(o.stored["setup.sciT6"]).toBe(true);
    },
  },
  {
    item: "pc_sci_ad_since",
    action: 0,
    name: "yes postpones (recent_change) without a changeReported record",
    env: sciT6Later(),
    answers: { pc_sci_ad_since: "yes" },
    check: (o) => {
      expect(o).toMatchObject({ status: "postpone", reason: "recent_change", screen: "scr_postpone_care" });
      expect(o.stored).toEqual({});
    },
  },
  {
    item: "pc_sci_ad_now",
    action: 0,
    name: "yes is the AD response: check ends, next day lock, nothing stored",
    env: sciT6Later(),
    answers: { pc_sci_ad_now: "yes" },
    check: (o) =>
      expect(o).toMatchObject({
        status: "ad",
        reason: "ad",
        screen: "scr_ad",
        lock: { reason: "ad", until: "next_day" },
        stored: {},
      }),
  },
  {
    item: "pc_sci_ready",
    action: 0,
    name: "not yet postpones (sci_ready) without a lock (7.2-8)",
    env: sciT6Later(),
    answers: { pc_sci_ready: "not_yet" },
    check: (o) =>
      expect(o).toMatchObject({
        status: "postpone",
        reason: "sci_ready",
        screen: "scr_postpone_sci",
        lock: { reason: "sci_ready", until: null },
      }),
  },
  {
    item: "pc_arm_function",
    action: 0,
    name: "bends without holding: wrist weight or none on that arm",
    env: wheel(["sci_incomplete"]),
    answers: { "pc_arm_function:left": "bend_no_hold" },
    check: (o) => {
      expect(variantsOf(o, "arm_curl_30s", "left")).toEqual(["cuff_or_arm_only"]);
      expect(variantsOf(o, "arm_curl_30s", "right")).toEqual([]);
    },
  },
  {
    item: "pc_arm_function",
    action: 1,
    name: "cannot bend: that arm is not measured (arm_not_able)",
    env: wheel(["sci_incomplete"]),
    answers: { "pc_arm_function:right": "no_bend" },
    check: (o) =>
      expect(o.skips).toEqual([{ testId: "arm_curl_30s", side: "right", reason: "arm_not_able" }]),
  },
  {
    item: "pc_pressure_sore",
    action: 0,
    name: "yes skips the side lean (pressure_sore) and asks to tell the care team",
    env: wheel(),
    answers: { pc_pressure_sore: "yes" },
    check: (o) => {
      expect(skipOf(o, "trunk_control_seated", "left")).toBe("pressure_sore");
      expect(skipOf(o, "trunk_control_seated", "right")).toBe("pressure_sore");
      expect(o.warnings).toContain("scr_note_care");
    },
  },
  {
    item: "pc_sit_unsupported",
    action: 0,
    name: "not sure: the side lean is booth only, skipped at home",
    env: envOf(),
    answers: { pc_sit_unsupported: "unsure" },
    check: (o) => {
      expect(skipOf(o, "trunk_control_seated", "left")).toBe("booth_only_trunk");
      expect(skipOf(o, "trunk_control_seated", "right")).toBe("booth_only_trunk");
    },
  },
  {
    item: "pc_trunk_armrests",
    action: 0,
    name: "no skips the side lean at home (armrests_needed)",
    env: envOf(),
    answers: { "pc_trunk_armrests:chair": "no" },
    check: (o) => expect(skipOf(o, "trunk_control_seated", "left")).toBe("armrests_needed"),
  },
  {
    item: "pc_fall_sitting",
    action: 0,
    name: "yes: booth only at home, allowed at the booth",
    env: envOf(),
    answers: { pc_fall_sitting: "yes" },
    check: (o) => {
      expect(skipOf(o, "trunk_control_seated", "right")).toBe("booth_only_trunk");
      const booth = evaluatePrecheck(
        envOf({}, { setting: "booth" }),
        fill(envOf({}, { setting: "booth" }), { pc_fall_sitting: "yes" }),
        NOW,
      );
      expect(booth.skips).toEqual([]);
    },
  },
  {
    item: "pc_stroke_push",
    action: 0,
    name: "yes excludes the side lean at home and at the booth (pusher)",
    env: wheel(["stroke"], "left"),
    answers: { pc_stroke_push: "yes" },
    check: (o) => {
      expect(skipOf(o, "trunk_control_seated", "left")).toBe("pusher");
      const boothEnv = envOf(
        { position: "wheelchair", conditions: ["stroke"], support: "left" },
        { setting: "booth" },
      );
      const booth = evaluatePrecheck(boothEnv, fill(boothEnv, { pc_stroke_push: "yes" }), NOW);
      expect(skipOf(booth, "trunk_control_seated", "right")).toBe("pusher");
    },
  },
  {
    item: "pc_ms_heat",
    action: 0,
    name: "yes postpones for 60 minutes (ms_heat)",
    env: envOf({ conditions: ["ms"] }),
    answers: { pc_ms_heat: "yes" },
    check: (o) =>
      expect(o).toMatchObject({
        status: "postpone",
        reason: "ms_heat",
        screen: "scr_postpone_cool",
        lock: { reason: "ms_heat", until: "60_min" },
      }),
  },
  {
    item: "pc_ms_one_arm",
    action: 0,
    name: "weaker only skips the stronger arm curl (by_choice)",
    env: envOf({ conditions: ["ms"], support: "left" }),
    answers: { pc_ms_one_arm: "weaker" },
    check: (o) => expect(o.skips).toEqual([{ testId: "arm_curl_30s", side: "right", reason: "by_choice" }]),
  },
  {
    item: "pc_pd_on",
    action: 0,
    name: "no postpones for 60 minutes (pd_off)",
    env: envOf({ conditions: ["parkinsons"] }),
    answers: { pc_pd_on: "no" },
    check: (o) =>
      expect(o).toMatchObject({
        status: "postpone",
        reason: "pd_off",
        screen: "scr_postpone_pd",
        lock: { reason: "pd_off", until: "60_min" },
      }),
  },
  {
    item: "pc_pd_on",
    action: 1,
    name: "not sure records fingerprint.pdState",
    env: envOf({ conditions: ["parkinsons"] }),
    answers: { pc_pd_on: "unsure" },
    check: (o) => {
      expect(o.status).toBe("proceed");
      expect(o.stored["fingerprint.pdState"]).toBe("unsure");
    },
  },
  {
    item: "pc_pd_dose",
    action: 0,
    name: "records the dose bucket",
    env: envOf({ conditions: ["parkinsons"] }),
    answers: { pc_pd_dose: "gt3h" },
    check: (o) => expect(o.stored["fingerprint.pdDoseBucket"]).toBe("gt3h"),
  },
  {
    item: "pc_arthritis_flare",
    action: 0,
    name: "a flare skips the tests that load the area (flare)",
    env: envOf({ conditions: ["arthritis"] }),
    answers: { pc_arthritis_flare: "yes", "pc_arthritis_flare:areas": ["wrist_right", "hip"] },
    check: (o) =>
      expect(o.skips).toEqual([
        { testId: "trunk_control_seated", side: "left", reason: "flare" },
        { testId: "trunk_control_seated", side: "right", reason: "flare" },
        { testId: "arm_curl_30s", side: "right", reason: "flare" },
      ]),
  },
  {
    item: "pc_steadi",
    action: 0,
    name: "any yes: hands allowed and a helper",
    env: standing(),
    answers: { "pc_steadi:worry": "yes" },
    check: (o) => {
      expect(variantsOf(o, "chair_stand_30s", "none")).toEqual(["arms_assisted"]);
      expect(o.helperRequired).toEqual(["chair_stand_30s"]);
      expect(o.warnings).toContain("scr_helper_brief_stand");
    },
  },
  {
    item: "pc_walking_aid",
    action: 0,
    name: "yes: hands allowed, steady before letting go at home, and a helper",
    env: standing(),
    answers: { pc_walking_aid: "yes" },
    check: (o) => {
      expect(variantsOf(o, "chair_stand_30s", "none")).toEqual(["arms_assisted_steady"]);
      expect(o.helperRequired).toEqual(["chair_stand_30s"]);
    },
  },
  {
    item: "pc_stand_no_hands",
    action: 0,
    name: "no or not sure: hands allowed (which needs a helper at home)",
    env: standing(),
    answers: { pc_stand_no_hands: "unsure" },
    check: (o) => {
      expect(variantsOf(o, "chair_stand_30s", "none")).toEqual(["arms_assisted"]);
      expect(o.helperRequired).toEqual(["chair_stand_30s"]);
    },
  },
  {
    item: "pc_pd_dizzy_standing",
    action: 0,
    name: "yes requires a helper for the chair stand",
    env: standing({ conditions: ["parkinsons"] }),
    answers: { pc_pd_dizzy_standing: "yes", "pc_helper:chair_stand_30s": "no" },
    check: (o) =>
      expect(o.skips).toEqual([{ testId: "chair_stand_30s", side: "none", reason: "helper_needed" }]),
  },
  {
    item: "pc_booth_vitals",
    action: 0,
    name: "a mean outside the Q21 limits skips the booth chair stand (booth_vitals)",
    env: standing({ clearance: "unsure" }, { setting: "booth" }),
    answers: { pc_booth_vitals: vitals({ systolic1: 170, systolic2: 160 }) },
    check: (o) =>
      expect(o.skips).toEqual([{ testId: "chair_stand_30s", side: "none", reason: "booth_vitals" }]),
  },
  {
    item: "pc_booth_vitals",
    action: 1,
    name: "SCI at T6 or above with a systolic 20 above the usual one starts the AD response (O47 fallback)",
    env: sciBoothStand(),
    answers: { pc_sci_level: "yes", pc_booth_vitals: vitals({ usualSystolic: 100 }) },
    check: (o) =>
      expect(o).toMatchObject({ status: "ad", screen: "scr_ad", lock: { reason: "ad", until: "next_day" } }),
  },
  {
    item: "pc_booth_vitals",
    action: 2,
    name: "sci_t6 never gets the booth chair stand (clearance_booth, O47 (3))",
    env: sciBoothStand(),
    answers: { pc_sci_level: "yes" },
    check: (o) =>
      expect(o.skips).toEqual([{ testId: "chair_stand_30s", side: "none", reason: "clearance_booth" }]),
  },
  {
    item: "pc_booth_vitals",
    action: 3,
    name: "sci_t6 with a mean systolic of 150 or more starts the AD response (O47 (3))",
    env: sciBoothStand(),
    answers: { pc_sci_level: "unsure", pc_booth_vitals: vitals({ systolic1: 148, systolic2: 152 }) },
    check: (o) => expect(o.status).toBe("ad"),
  },
  {
    item: "pc_booth_vitals",
    action: 4,
    name: "no validated cuff or licensed practitioner: the chair stand is not offered (clearance_booth, O47 (4))",
    env: standing({ clearance: "no" }, { setting: "booth" }),
    answers: { pc_booth_vitals: "unavailable" },
    check: (o) =>
      expect(o.skips).toEqual([{ testId: "chair_stand_30s", side: "none", reason: "clearance_booth" }]),
  },
  {
    item: "pc_helper",
    action: 0,
    name: "no skips the test it was asked for (helper_needed)",
    env: envOf(),
    answers: { "pc_helper:trunk_control_seated": "no" },
    check: (o) => {
      expect(skipOf(o, "trunk_control_seated", "left")).toBe("helper_needed");
      expect(o.helperRequired).toEqual([]);
      expect(o.warnings).not.toContain("scr_helper_brief_trunk");
    },
  },
  {
    item: "pc_helper",
    action: 1,
    name: "yes shows the helper briefing and records helperPresent",
    env: envOf(),
    answers: { "pc_helper:trunk_control_seated": "yes" },
    check: (o) => {
      expect(o.helperRequired).toEqual(["trunk_control_seated"]);
      expect(o.warnings).toContain("scr_helper_brief_trunk");
      expect(o.stored["fingerprint.helperPresent"]).toEqual(["trunk_control_seated"]);
    },
  },
  {
    item: "pc_after_last",
    action: 0,
    name: "no postpones (after_last)",
    env: envOf({}, { firstCheck: false, lastCheckLasting: true }),
    answers: { pc_after_last: "no" },
    check: (o) =>
      expect(o).toMatchObject({
        status: "postpone",
        reason: "after_last",
        screen: "scr_postpone_care",
        lock: { reason: "after_last", until: "next_day" },
      }),
  },
  {
    item: "pc_after_last",
    action: 1,
    name: "yes resolves the follow up and goes ahead, kept out of stored",
    env: envOf({}, { firstCheck: false, lastCheckLasting: true }),
    answers: { pc_after_last: "yes" },
    check: (o) => {
      expect(o.status).toBe("proceed");
      expect(o.followUpResolved).toBe(true);
      expect(Object.keys(o.stored)).not.toContain("followUpResolved");
    },
  },
];

describe("every pre-check action", () => {
  it("has at least one case, and every item has one", () => {
    const covered = new Set(CASES.map((c) => `${c.item}#${c.action}`));
    const all = CHECK_DATA.precheck.flatMap((q) => q.actions.map((_, i) => `${q.id}#${i}`));
    expect(all.filter((k) => !covered.has(k))).toEqual([]);
    expect(CHECK_DATA.precheck.every((q) => CASES.some((c) => c.item === q.id))).toBe(true);
  });

  it.each(CASES.map((c) => [`${c.item} #${c.action}: ${c.name}`, c] as const))("%s", (_, c) => {
    const answers = fill(c.env, c.answers);
    const base = parseQuestionId(c.item)!.base;
    if (base !== "pc_setting") {
      expect(visibleQuestions(c.env, answers).some((id) => id.startsWith(base))).toBe(true);
    }
    c.check(evaluatePrecheck(c.env, answers, NOW));
  });

  it("the other answer of each yes or no action does nothing", () => {
    // The benign answer of every question visible to a full condition set goes ahead untouched.
    const env = envOf({ conditions: ["ms", "parkinsons", "arthritis"], support: "left", pain: ["shoulder"] });
    const o = run(env);
    expect(o.status).toBe("proceed");
    expect(o.skips).toEqual([]);
  });
});

/* ------------------------------------------------------------- pain rules */

describe("pain rules (spec 2.1, 2.2)", () => {
  const pain = (env: PrecheckEnv, now: number, areas: Record<string, number> = {}, worse = "no") =>
    run(env, { pc_pain_now: now, pc_pain_worse: worse, pc_pain_areas: areas });

  it.each([
    [0, "proceed"],
    [6, "proceed"],
    [7, "proceed"],
    [8, "proceed"],
    [9, "postpone"],
    [10, "postpone"],
  ] as const)("pain now %i without areas: %s", (n, status) => {
    const o = pain(envOf(), n);
    expect(o.status).toBe(status);
    if (status === "proceed") expect(o.warnings.includes("warn_pain_high")).toBe(n >= 7);
  });

  it("7 or 8 postpones when the pain is new or clearly worse", () => {
    expect(pain(envOf(), 8, {}, "yes")).toMatchObject({ status: "postpone", reason: "pain_worse" });
  });

  it("7 or more in an area no selected test loads goes ahead with the warning", () => {
    // Seated: the knee loads only the chair stand, which is not selected.
    const o = pain(envOf(), 5, { knee: 8 });
    expect(o.status).toBe("proceed");
    expect(o.warnings).toContain("warn_pain_high");
    expect(o.stored.painNow).toBe(8);
    expect(o.skips).toEqual([]);
  });

  it("7 or more in an area a selected test loads postpones", () => {
    expect(pain(standing(), 5, { knee: 7 })).toMatchObject({ status: "postpone", reason: "pain" });
    expect(pain(envOf(), 5, { back: 7 })).toMatchObject({ status: "postpone", reason: "pain" });
  });

  it("painNow is raised to the highest area score, so 9 in any area postpones", () => {
    expect(pain(envOf(), 3, { knee: 9 })).toMatchObject({ status: "postpone", reason: "pain" });
    expect(pain(envOf(), 3, { hip: 5, elbow_right: 2 }).stored.painNow).toBe(5);
  });

  it("an area at 6 skips the loaded tests without a warning, 5 changes nothing", () => {
    const six = pain(envOf(), 4, { back: 6 });
    expect(six.skips.map((s) => `${s.testId}:${s.side}:${s.reason}`)).toEqual([
      "trunk_control_seated:left:pain_today",
      "trunk_control_seated:right:pain_today",
    ]);
    expect(six.warnings).not.toContain("warn_pain_high");
    expect(pain(envOf(), 4, { back: 5 }).skips).toEqual([]);
  });

  it("an area at 6 on a standing user's hip skips the chair stand with no substitute", () => {
    const o = pain(standing(), 4, { hip: 6 });
    expect(o.skips).toEqual([{ testId: "chair_stand_30s", side: "none", reason: "pain_today" }]);
  });

  it("the elbow loads the arm curl but not the arm raise", () => {
    const o = pain(envOf(), 4, { elbow_right: 6 });
    expect(o.skips).toEqual([{ testId: "arm_curl_30s", side: "right", reason: "pain_today" }]);
  });

  it("an area at 7 on a missing arm's side still postpones (the safe reading)", () => {
    const env = envOf(
      { conditions: ["upper_limb_unilateral"] },
      { firstCheck: false, setup: { limbLoss: { arm: "right" } } },
    );
    expect(pain(env, 7, { shoulder_right: 7 })).toMatchObject({ status: "postpone", reason: "pain" });
  });
});

/* ------------------------------------------------------- chair stand rules */

describe("chair stand rules (spec 4.4)", () => {
  it("standard by default, no helper, no variant", () => {
    const o = run(standing());
    expect(variantsOf(o, "chair_stand_30s", "none")).toEqual([]);
    expect(o.helperRequired).toEqual([]);
  });

  it.each([
    ["stroke with a weaker side", { conditions: ["stroke"], support: "left" as const }],
    ["sci_incomplete", { conditions: ["sci_incomplete"] }],
    ["cerebral_palsy", { conditions: ["cerebral_palsy"] }],
  ])("hands allowed and a helper for %s", (_, ctx) => {
    const o = run(standing(ctx));
    expect(variantsOf(o, "chair_stand_30s", "none")[0]).toBe("arms_assisted");
    expect(o.helperRequired).toContain("chair_stand_30s");
  });

  it("stroke without a declared weaker side: standard, still with a helper", () => {
    const o = run(standing({ conditions: ["stroke"] }));
    expect(variantsOf(o, "chair_stand_30s", "none")).toEqual([]);
    expect(o.helperRequired).toEqual(["chair_stand_30s"]);
  });

  it("parkinsons needs a helper for the chair stand", () => {
    expect(run(standing({ conditions: ["parkinsons"] })).helperRequired).toEqual(["chair_stand_30s"]);
  });

  it("upper limb loss: one arm across the chest; hands allowed pushes with the intact hand", () => {
    const env = standing({ conditions: ["upper_limb_unilateral"] });
    expect(variantsOf(run(env, { pc_limb_arm_side: "left" }), "chair_stand_30s", "none")).toEqual([
      "one_arm_cross",
    ]);
    const assisted = run(env, { pc_limb_arm_side: "left", pc_stand_no_hands: "no" });
    expect(variantsOf(assisted, "chair_stand_30s", "none")).toEqual([
      "arms_assisted",
      "push_right_hand_only",
    ]);
    // The intact hand hurts today: no hand can push, the chair stand is skipped.
    const both = run(env, {
      pc_limb_arm_side: "left",
      pc_stand_no_hands: "no",
      pc_pain_now: 4,
      pc_pain_areas: { wrist_right: 6 },
    });
    expect(both.skips).toContainEqual({ testId: "chair_stand_30s", side: "none", reason: "pain_today" });
  });

  it("pushing arm: a painful hand today pushes with the other hand; both painful skips", () => {
    const one = run(standing(), {
      pc_stand_no_hands: "no",
      pc_pain_now: 3,
      pc_pain_areas: { shoulder_right: 6 },
    });
    expect(variantsOf(one, "chair_stand_30s", "none")).toEqual(["arms_assisted", "push_left_hand_only"]);
    const both = run(standing(), {
      pc_stand_no_hands: "no",
      pc_pain_now: 3,
      pc_pain_areas: { shoulder_right: 6, wrist_left: 6 },
    });
    expect(skipOf(both, "chair_stand_30s", "none")).toBe("pain_today");
    // The standard version keeps the arms crossed: no change.
    const standard = run(standing(), { pc_pain_now: 3, pc_pain_areas: { shoulder_right: 6, wrist_left: 6 } });
    expect(skipOf(standard, "chair_stand_30s", "none")).toBeUndefined();
  });

  it("pushing arm: surgery and a flare take a hand out too", () => {
    const env = standing({ conditions: ["arthritis"] });
    const o = run(env, {
      pc_walking_aid: "yes",
      pc_surgery_recent: "yes",
      "pc_surgery_recent:areas": ["elbow_left"],
      "pc_surgery_recent:elbow_left": "no",
      pc_arthritis_flare: "yes",
      "pc_arthritis_flare:areas": ["wrist_right"],
    });
    expect(skipOf(o, "chair_stand_30s", "none")).toBe("recent_surgery");
  });

  it("pushing arm: the intake pain side does not push (spec 3.3)", () => {
    const env = standing({ pain: ["shoulder"] });
    const o = run(env, { "pc_arm_pain_side:shoulder": "right", pc_stand_no_hands: "no" });
    expect(variantsOf(o, "chair_stand_30s", "none")).toEqual(["arms_assisted", "push_left_hand_only"]);
    const both = run(env, { "pc_arm_pain_side:shoulder": "both", pc_stand_no_hands: "no" });
    expect(skipOf(both, "chair_stand_30s", "none")).toBe("pain_area");
  });

  it("walking aid at the booth: hands allowed without the home steady modifier, no helper question", () => {
    const env = standing({}, { setting: "booth" });
    const o = run(env, { pc_walking_aid: "yes" });
    expect(variantsOf(o, "chair_stand_30s", "none")).toEqual(["arms_assisted"]);
    expect(o.helperRequired).toEqual([]);
    expect(visibleQuestions(env, fill(env, { pc_walking_aid: "yes" }))).not.toContain(
      "pc_helper:chair_stand_30s",
    );
  });

  it("booth vitals just inside the Q21 limits allow the chair stand", () => {
    const env = standing({ clearance: "no" }, { setting: "booth" });
    const o = run(env, {
      pc_booth_vitals: vitals({
        restingHeartRate: 120,
        systolic1: 159,
        systolic2: 159,
        diastolic1: 99,
        diastolic2: 99,
      }),
    });
    expect(o.skips).toEqual([]);
    const hr = run(env, { pc_booth_vitals: vitals({ restingHeartRate: 121 }) });
    expect(skipOf(hr, "chair_stand_30s", "none")).toBe("booth_vitals");
    const dia = run(env, { pc_booth_vitals: vitals({ diastolic1: 100, diastolic2: 100 }) });
    expect(skipOf(dia, "chair_stand_30s", "none")).toBe("booth_vitals");
    // Staff must enter the values before the check can start.
    expect(evaluatePrecheck(env, { ...fill(env), pc_booth_vitals: { systolic: 120 } }, NOW).status).toBe(
      "incomplete",
    );
  });
});

/* ---------------------------------------------------- arm curl load rules */

describe("arm curl load rules (spec 4.2)", () => {
  it.each([
    ["no_resistance", { restrictions: ["no_resistance"] }],
    ["clearance unsure", { clearance: "unsure" as const }],
    ["clearance no", { clearance: "no" as const }],
  ])("%s: both arms without weight", (_, ctx) => {
    const o = run(envOf(ctx));
    expect(variantsOf(o, "arm_curl_30s", "left")).toEqual(["arm_only"]);
    expect(variantsOf(o, "arm_curl_30s", "right")).toEqual(["arm_only"]);
  });

  it("stroke: the weaker arm without weight whatever pc_weak_shoulder says, and warn_weak_shoulder", () => {
    const o = run(envOf({ conditions: ["stroke"], support: "left" }), { pc_weak_shoulder: "no" });
    expect(variantsOf(o, "arm_curl_30s", "left")).toEqual(["arm_only"]);
    expect(variantsOf(o, "arm_curl_30s", "right")).toEqual([]);
    expect(o.warnings).toContain("warn_weak_shoulder");
  });

  it("arm_only wins over cuff_or_arm_only, and a skipped side carries no variant", () => {
    const env = wheel(["sci_incomplete"]);
    const o = run(
      envOf({ position: "wheelchair", conditions: ["sci_incomplete"], restrictions: ["no_resistance"] }),
      {
        "pc_arm_function:left": "bend_no_hold",
        "pc_arm_function:right": "no_bend",
      },
    );
    expect(variantsOf(o, "arm_curl_30s", "left")).toEqual(["arm_only"]);
    expect(variantsOf(o, "arm_curl_30s", "right")).toEqual([]);
    expect(skipOf(o, "arm_curl_30s", "right")).toBe("arm_not_able");
    expect(run(env).variants).toEqual([]);
  });
});

/* ----------------------------------------------------------- decisions */

describe("decision order", () => {
  it("an emergency wins over every other answer", () => {
    const env = sciT6Later();
    const o = evaluatePrecheck(
      env,
      fill(env, { pc_urgent: "yes", pc_unwell: "yes", pc_sci_ad_now: "yes", pc_pain_now: 10 }),
      NOW,
    );
    expect(o.status).toBe("emergency");
    expect(o.alsoShow).toEqual(["scr_ad"]);
  });

  it("the AD response wins over a postpone", () => {
    const env = sciT6Later();
    expect(run(env, { pc_unwell: "yes", pc_sci_ad_now: "yes" }).status).toBe("ad");
  });

  it("with several postpones the longest lock wins, then question order", () => {
    const env = envOf({ conditions: ["ms", "parkinsons"] });
    expect(run(env, { pc_ms_heat: "yes", pc_pd_on: "no" }).reason).toBe("ms_heat");
    expect(run(env, { pc_ms_heat: "yes", pc_unwell: "yes" }).reason).toBe("unwell");
    const t6 = sciT6Later();
    expect(run(t6, { pc_sci_ready: "not_yet", pc_pain_now: 9 }).reason).toBe("pain");
    // A postpone keeps changeReported even when another reason is shown.
    const both = run(envOf(), { pc_unwell: "yes", pc_change: "yes", pc_change_cleared: "no" });
    expect(both).toMatchObject({ reason: "unwell", stored: { changeReported: TODAY } });
  });

  it("a postpone ends the questions early, but not before pc_urgent is answered", () => {
    expect(evaluatePrecheck(envOf(), { pc_urgent: "no", pc_unwell: "yes" }, NOW).status).toBe("postpone");
    expect(evaluatePrecheck(envOf(), { pc_unwell: "yes" }, NOW).status).toBe("incomplete");
    expect(evaluatePrecheck(envOf(), { pc_urgent: "yes" }, NOW).status).toBe("emergency");
  });

  it("incomplete while a visible question has no answer", () => {
    const env = envOf();
    const answers = fill(env);
    for (const id of visibleQuestions(env, answers)) {
      const partial = { ...answers };
      delete partial[id];
      // Removing an answer can hide its follow ups, but the question itself stays unanswered.
      expect(evaluatePrecheck(env, partial, NOW).status).toBe("incomplete");
    }
  });

  it("proceed carries no reason, screen or lock", () => {
    const o = run(envOf());
    expect(o.status).toBe("proceed");
    expect(o.reason).toBeUndefined();
    expect(o.screen).toBeUndefined();
    expect(o.lock).toBeUndefined();
  });

  it("postpone screens equal postponeReasons in the data", () => {
    for (const q of CHECK_DATA.precheck) {
      for (const a of q.actions) {
        if (a.do === "postpone") expect(CHECK_DATA.postponeReasons[a.reason]).toBe(a.screen);
      }
    }
  });
});

describe("needed_arms at the last chair stand (spec 4.4 variant rules)", () => {
  it("offers the hands allowed version at the next check, with a helper at home", () => {
    const env = envOf({ position: "standing" }, { firstCheck: false, setup: {}, neededArmsLastStand: true });
    const answers = fill(env);
    expect(visibleQuestions(env, answers)).toContain("pc_helper:chair_stand_30s");
    const o = run(env);
    expect(variantsOf(o, "chair_stand_30s", "none")).toEqual(["arms_assisted"]);
    expect(o.helperRequired).toEqual(["chair_stand_30s"]);
    // No helper today: the chair stand waits for a day with a helper.
    expect(skipOf(run(env, { "pc_helper:chair_stand_30s": "no" }), "chair_stand_30s", "none")).toBe(
      "helper_needed",
    );
  });

  it("changes nothing when the last chair stand did not need the hands", () => {
    for (const neededArmsLastStand of [false, undefined]) {
      const env = envOf({ position: "standing" }, { firstCheck: false, setup: {}, neededArmsLastStand });
      const o = run(env);
      expect(variantsOf(o, "chair_stand_30s", "none")).toEqual([]);
      expect(o.helperRequired).toEqual([]);
    }
  });

  it("gives the booth the hands allowed version without a helper question", () => {
    const env = envOf(
      { position: "standing" },
      { setting: "booth", firstCheck: false, setup: {}, neededArmsLastStand: true },
    );
    expect(visibleQuestions(env, fill(env))).not.toContain("pc_helper:chair_stand_30s");
    expect(variantsOf(run(env), "chair_stand_30s", "none")).toEqual(["arms_assisted"]);
  });
});

/* ------------------------------------------------- review round 2 fixes */

describe("the AD question before an early postpone (spec 2.1 actions, 2.2 pc_sci_ad_now)", () => {
  it("does not postpone while pc_sci_ad_now is visible and not answered", () => {
    const env = sciT6Later();
    const o = evaluatePrecheck(env, { pc_urgent: "no", pc_unwell: "yes" }, NOW);
    expect(o.status).toBe("incomplete");
    expect(
      evaluatePrecheck(env, { pc_urgent: "no", pc_unwell: "yes", pc_sci_ad_now: "yes" }, NOW),
    ).toMatchObject({ status: "ad", reason: "ad", screen: "scr_ad" });
    expect(
      evaluatePrecheck(env, { pc_urgent: "no", pc_unwell: "yes", pc_sci_ad_now: "no" }, NOW),
    ).toMatchObject({ status: "postpone", reason: "unwell" });
  });

  it("waits for pc_sci_level at the first check of a person with SCI", () => {
    const env = envOf({ position: "wheelchair", conditions: ["sci_incomplete"] });
    expect(evaluatePrecheck(env, { pc_urgent: "no", pc_unwell: "yes" }, NOW).status).toBe("incomplete");
    // Level below T6: no AD question, the postpone ends the questions.
    expect(evaluatePrecheck(env, { pc_urgent: "no", pc_unwell: "yes", pc_sci_level: "no" }, NOW).status).toBe(
      "postpone",
    );
    // Not sure counts as yes: the AD question comes first.
    const unsure = { pc_urgent: "no", pc_unwell: "yes", pc_sci_level: "unsure" };
    expect(evaluatePrecheck(env, unsure, NOW).status).toBe("incomplete");
    expect(evaluatePrecheck(env, { ...unsure, pc_sci_ad_now: "yes" }, NOW).status).toBe("ad");
  });

  it("asks the AD questions straight after pc_urgent", () => {
    const later = visibleQuestions(sciT6Later(), {});
    expect(later.slice(0, 2)).toEqual(["pc_urgent", "pc_sci_ad_now"]);
    const first = envOf({ position: "wheelchair", conditions: ["sci_complete"] });
    expect(visibleQuestions(first, {}).slice(0, 2)).toEqual(["pc_urgent", "pc_sci_level"]);
    expect(visibleQuestions(first, { pc_sci_level: "yes" }).slice(0, 3)).toEqual([
      "pc_urgent",
      "pc_sci_level",
      "pc_sci_ad_now",
    ]);
    // Without SCI nothing moves.
    expect(visibleQuestions(envOf(), {}).slice(0, 2)).toEqual(["pc_urgent", "pc_unwell"]);
  });
});

describe("a recent surgery or a flare outside the listed areas (spec 2.2, R3C-27)", () => {
  it("takes the Another area set when surgery is yes and no listed area is chosen", () => {
    const env = standing();
    const o = run(env, { pc_surgery_recent: "yes", "pc_surgery_recent:areas": [] });
    expect(o.status).toBe("proceed");
    expect(skipOf(o, "chair_stand_30s", "none")).toBe("recent_surgery");
    // The arm raise is not loaded; the arm curl runs arm_only on both arms (the chest_belly set).
    expect(skipOf(o, "shoulder_abduction", "left")).toBeUndefined();
    expect(skipOf(o, "arm_curl_30s", "right")).toBeUndefined();
  });

  it("skips the chair stand when a flare is yes and no listed area is chosen", () => {
    const env = standing({ conditions: ["arthritis"] });
    const o = run(env, { pc_arthritis_flare: "yes", "pc_arthritis_flare:areas": [] });
    expect(skipOf(o, "chair_stand_30s", "none")).toBe("flare");
  });

  it("skips the side lean of a seated person, whose check has no chair stand (the Another area set)", () => {
    const o = run(envOf(), { pc_surgery_recent: "yes", "pc_surgery_recent:areas": [] });
    expect(o.status).toBe("proceed");
    expect(o.skips.map((k) => `${k.testId}:${k.side}:${k.reason}`).sort()).toEqual([
      "trunk_control_seated:left:recent_surgery",
      "trunk_control_seated:right:recent_surgery",
    ]);
  });
});

describe("several postpone reasons at once (SPEC-GAP multi-postpone)", () => {
  it("never keeps the releasable recent_change lock when another reason locks", () => {
    const o = run(envOf(), { pc_change: "yes", pc_change_cleared: "no", pc_pain_now: 9 });
    expect(o).toMatchObject({
      status: "postpone",
      reason: "pain",
      screen: "scr_postpone_pain",
      lock: { reason: "pain", until: "next_day" },
      stored: { changeReported: TODAY },
    });
    expect(o.alsoShow).toEqual(["scr_postpone_care"]);
  });

  it("keeps the longest lock of all the reasons, under a reason no answer releases", () => {
    const env = envOf({ conditions: ["ms"] });
    const o = run(env, { pc_change: "yes", pc_change_cleared: "no", pc_ms_heat: "yes" });
    expect(o).toMatchObject({ reason: "ms_heat", lock: { reason: "ms_heat", until: "next_day" } });
    expect(o.alsoShow).toEqual(["scr_postpone_care"]);
  });

  it("prefers the care advice screen when the locks tie", () => {
    const o = run(envOf(), { pc_unwell: "yes", pc_pain_now: 3, pc_pain_worse: "yes" });
    expect(o).toMatchObject({
      reason: "pain_worse",
      screen: "scr_postpone_care",
      lock: { reason: "pain_worse", until: "next_day" },
    });
    const change = run(envOf(), { pc_unwell: "yes", pc_change: "yes", pc_change_cleared: "no" });
    expect(change).toMatchObject({ reason: "unwell", lock: { reason: "unwell", until: "next_day" } });
    expect(change.alsoShow).toEqual(["scr_postpone_care"]);
  });

  it("keeps recent_change when it is the only reason that locks", () => {
    const o = run(sciT6Later(), { pc_change: "yes", pc_change_cleared: "no", pc_sci_ready: "not_yet" });
    expect(o).toMatchObject({
      reason: "recent_change",
      lock: { reason: "recent_change", until: "next_day" },
    });
    expect(o.alsoShow ?? []).toEqual([]);
  });
});

describe("pc_sci_ad_since after a check in the other setting (spec 2.2, SPEC-GAP ad-since-any-setting)", () => {
  it("is asked at the first home check after a completed booth check", () => {
    const env = envOf(
      { position: "wheelchair", conditions: ["sci_complete"] },
      { firstCheck: true, setup: { sciT6: true }, completedBefore: true },
    );
    expect(visibleQuestions(env, {})).toContain("pc_sci_ad_since");
    expect(run(env, { pc_sci_level: "yes", pc_sci_ad_since: "yes" })).toMatchObject({
      status: "postpone",
      reason: "recent_change",
    });
  });

  it("is not asked before any completed check", () => {
    const env = envOf(
      { position: "wheelchair", conditions: ["sci_complete"] },
      { firstCheck: true, setup: { sciT6: true }, completedBefore: false },
    );
    expect(visibleQuestions(env, {})).not.toContain("pc_sci_ad_since");
  });
});
