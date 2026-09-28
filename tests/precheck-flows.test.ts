/**
 * Pre-check flows (src/medical/precheck.ts), second part:
 *   1. the canonical personas, each through the questions they see and the decisions that follow;
 *   2. property tests over seeded random people and answers (emergency wins, stored holds only data
 *      map fields and never raw answers, hidden answers change nothing, and more);
 *   3. between tests (bt_pain_after), after the check (ac_next_day), the stop list, and the locks.
 */
import { describe, expect, it } from "vitest";
import { CHECK_DATA } from "../src/movements/assessments";
import {
  AREA_IDS,
  LOCK_REASON_IDS,
  STOP_OPTION_IDS,
  SURGERY_AREA_IDS,
  TEST_ID_LIST,
  type LockReasonId,
  type TestId,
} from "../src/movements/types";
import {
  DATA_MAP_KEYS,
  afterCheck,
  afterCheckDue,
  betweenTests,
  dayVariant,
  evaluatePrecheck,
  lockKind,
  lockUntil,
  missingAnswers,
  releasesLock,
  riyadhDate,
  stopOptions,
  stopRoute,
  visibleQuestions,
  type Answers,
  type PrecheckEnv,
  type PrecheckOutcome,
  type TestInstance,
} from "../src/medical/precheck";
import {
  NOW,
  TODAY,
  envOf,
  fill,
  randomAnswers,
  randomEnv,
  rng,
  run,
  skipOf,
  variantsOf,
} from "./precheck-fixtures";

const HOUR = 60 * 60 * 1000;
const EVERY_CHECK = ["pc_urgent", "pc_unwell", "pc_change", "pc_surgery_recent", "pc_pain_now"];
const STANDING_QS = [
  "pc_steadi:fell",
  "pc_steadi:unsteady",
  "pc_steadi:worry",
  "pc_walking_aid",
  "pc_stand_no_hands",
];
/** The side lean questions; pc_trunk_armrests in the form of the position (Q12 (1)). */
const trunkQs = (form: "chair" | "wheelchair") => [
  "pc_sit_unsupported",
  `pc_trunk_armrests:${form}`,
  "pc_fall_sitting",
];

/* ---------------------------------------------------------------- personas */

describe("persona: Faisal, 58, stroke, weaker right side, wheelchair", () => {
  const env = envOf({ position: "wheelchair", support: "right", conditions: ["stroke"] });

  it("sees the every check, weaker side, wheelchair and side lean questions, with a helper question", () => {
    expect(env.baseTests).toEqual(["shoulder_abduction", "trunk_control_seated", "arm_curl_30s"]);
    expect(visibleQuestions(env, fill(env))).toEqual([
      ...EVERY_CHECK,
      "pc_weak_lift",
      "pc_weak_shoulder",
      "pc_pressure_sore",
      ...trunkQs("wheelchair"),
      "pc_stroke_push",
      "pc_helper:trunk_control_seated",
    ]);
  });

  it("goes ahead: weaker arm curls without weight, helper for the side lean, weak shoulder warning", () => {
    const o = run(env);
    expect(o.status).toBe("proceed");
    expect(o.skips).toEqual([]);
    expect(o.variants).toEqual([{ testId: "arm_curl_30s", side: "right", variant: "arm_only" }]);
    expect(o.helperRequired).toEqual(["trunk_control_seated"]);
    expect(o.warnings).toEqual(expect.arrayContaining(["scr_helper_brief_trunk", "warn_weak_shoulder"]));
    expect(o.stored).toEqual({ painNow: 0, "fingerprint.helperPresent": ["trunk_control_seated"] });
  });

  it("pusher behaviour: the side lean is excluded and no helper is asked for", () => {
    const answers = fill(env, { pc_stroke_push: "yes" });
    expect(visibleQuestions(env, answers)).not.toContain("pc_helper:trunk_control_seated");
    const o = evaluatePrecheck(env, answers, NOW);
    expect(skipOf(o, "trunk_control_seated", "left")).toBe("pusher");
    expect(skipOf(o, "trunk_control_seated", "right")).toBe("pusher");
    expect(o.helperRequired).toEqual([]);
  });

  it("a painful weaker shoulder skips that side of the arm raise; no helper at home skips the side lean", () => {
    const o = run(env, { pc_weak_shoulder: "yes", "pc_helper:trunk_control_seated": "no" });
    expect(o.skips).toEqual([
      { testId: "shoulder_abduction", side: "right", reason: "weak_shoulder" },
      { testId: "trunk_control_seated", side: "left", reason: "helper_needed" },
      { testId: "trunk_control_seated", side: "right", reason: "helper_needed" },
    ]);
    expect(variantsOf(o, "arm_curl_30s", "right")).toEqual(["arm_only"]);
    expect(o.stored["fingerprint.helperPresent"]).toBeUndefined();
  });

  it("a weaker hand that cannot lift off the lap is not measured in either arm test", () => {
    const o = run(env, { pc_weak_lift: "no" });
    expect(skipOf(o, "shoulder_abduction", "right")).toBe("arm_not_able");
    expect(skipOf(o, "arm_curl_30s", "right")).toBe("arm_not_able");
    expect(variantsOf(o, "arm_curl_30s", "right")).toEqual([]);
  });
});

describe("persona: Noura, 31, incomplete SCI, wheelchair, not sure whether T6 or higher", () => {
  const env = envOf({ position: "wheelchair", conditions: ["sci_incomplete"] });

  it("first check: level question, then the AD questions (not the since last check one), arm function per arm", () => {
    // The AD gate comes straight after pc_urgent (SPEC-GAP ad-before-postpone).
    expect(visibleQuestions(env, fill(env, { pc_sci_level: "unsure" }))).toEqual([
      EVERY_CHECK[0],
      "pc_sci_level",
      "pc_sci_ad_now",
      ...EVERY_CHECK.slice(1),
      "pc_sci_ready",
      "pc_arm_function:right",
      "pc_arm_function:left",
      "pc_pressure_sore",
      ...trunkQs("wheelchair"),
      "pc_helper:trunk_control_seated",
    ]);
  });

  it("not sure counts as T6 or higher: warning before every test, flag kept with the setup", () => {
    const o = run(env, { pc_sci_level: "unsure" });
    expect(o.status).toBe("proceed");
    expect(o.warnings).toContain("warn_sci_t6");
    expect(o.setupUpdates).toEqual({ sciT6: true });
    expect(o.stored["setup.sciT6"]).toBe(true);
    expect(o.helperRequired).toEqual(["trunk_control_seated"]);
  });

  it("AD signs now end the check for today (AD response), nothing stored", () => {
    const o = run(env, { pc_sci_level: "unsure", pc_sci_ad_now: "yes" });
    expect(o).toMatchObject({ status: "ad", screen: "scr_ad", lock: { reason: "ad", until: "next_day" } });
    expect(o.stored).toEqual({});
    expect(o.setupUpdates).toEqual({});
  });

  it("an unticked box asks her to take care of it first, with no lock", () => {
    const o = run(env, { pc_sci_level: "unsure", pc_sci_ready: "not_yet" });
    expect(o).toMatchObject({ status: "postpone", reason: "sci_ready", lock: { until: null } });
  });

  it("an emergency answer also shows the AD steps", () => {
    const o = run(env, { pc_urgent: "yes" });
    expect(o).toMatchObject({ status: "emergency", screen: "scr_emergency", alsoShow: ["scr_ad"] });
  });

  it("a pressure sore skips the side lean and asks her to tell her care team", () => {
    const o = run(env, { pc_sci_level: "unsure", pc_pressure_sore: "yes" });
    expect(skipOf(o, "trunk_control_seated", "left")).toBe("pressure_sore");
    expect(o.warnings).toContain("scr_note_care");
    expect(o.helperRequired).toEqual([]);
  });

  it("second check: the stored flag keeps the AD questions and adds the since last check one", () => {
    const later: PrecheckEnv = { ...env, firstCheck: false, setup: { sciT6: true } };
    const ids = visibleQuestions(later, fill(later));
    expect(ids).not.toContain("pc_sci_level");
    expect(ids).toEqual(expect.arrayContaining(["pc_sci_ad_since", "pc_sci_ad_now", "pc_sci_ready"]));
    expect(run(later, { pc_sci_ad_since: "yes" })).toMatchObject({
      status: "postpone",
      reason: "recent_change",
    });
    const cleared = run(later, { pc_sci_ad_since: "yes_cleared" });
    expect(cleared.status).toBe("proceed");
    expect(cleared.stored.changeCleared).toBe(TODAY);
  });
});

describe("persona: Khalid, 44, MS, uses a cane, standing", () => {
  const env = envOf({ position: "standing", support: "left", conditions: ["ms"] });
  const cane = { pc_walking_aid: "yes" };

  it("sees the heat question, the one arm choice and the standing questions", () => {
    expect(env.baseTests).toEqual(["shoulder_abduction", "chair_stand_30s", "arm_curl_30s"]);
    expect(visibleQuestions(env, fill(env, cane))).toEqual([
      ...EVERY_CHECK,
      "pc_weak_lift",
      "pc_weak_shoulder",
      "pc_ms_heat",
      "pc_ms_one_arm",
      ...STANDING_QS,
      "pc_helper:chair_stand_30s",
    ]);
  });

  it("cane at home: hands allowed, steady before letting go, with a helper; cool room warning", () => {
    const o = run(env, cane);
    expect(o.status).toBe("proceed");
    expect(variantsOf(o, "chair_stand_30s", "none")).toEqual(["arms_assisted_steady"]);
    expect(dayVariant(o, "chair_stand_30s", "none")).toEqual({ variant: "arms_assisted_steady" });
    expect(o.helperRequired).toEqual(["chair_stand_30s"]);
    expect(o.warnings).toEqual(expect.arrayContaining(["scr_helper_brief_stand", "warn_ms_cool"]));
  });

  it("no helper today: the chair stand is skipped, no substitute is added", () => {
    const o = run(env, { ...cane, "pc_helper:chair_stand_30s": "no" });
    expect(o.skips).toEqual([{ testId: "chair_stand_30s", side: "none", reason: "helper_needed" }]);
    expect(o.variants).toEqual([]);
  });

  it("feeling hot today postpones for about an hour", () => {
    const o = run(env, { ...cane, pc_ms_heat: "yes" });
    expect(o).toMatchObject({ status: "postpone", reason: "ms_heat", lock: { until: "60_min" } });
    expect(lockUntil("ms_heat", NOW)).toBe(NOW + HOUR);
  });

  it("only the weaker arm to save energy skips the stronger arm curl", () => {
    const o = run(env, { ...cane, pc_ms_one_arm: "weaker" });
    expect(o.skips).toContainEqual({ testId: "arm_curl_30s", side: "right", reason: "by_choice" });
  });
});

describe("persona: a person with no condition, standing", () => {
  const env = envOf({ position: "standing" });

  it("answers the every check and the standing questions only", () => {
    expect(visibleQuestions(env, fill(env))).toEqual([...EVERY_CHECK, ...STANDING_QS]);
  });

  it("goes ahead with the standard tests, no helper, nothing but the pain score kept", () => {
    const o = run(env);
    expect(o).toEqual({
      status: "proceed",
      skips: [],
      variants: [],
      helperRequired: [],
      warnings: [],
      setupUpdates: {},
      stored: { painNow: 0 },
      checkIn: { raiseAllowed: true, noArmSignal: false, fineZoneSide: "right" },
      helperBriefing: {},
    });
  });

  it("any STEADI yes: hands allowed and a helper", () => {
    const o = run(env, { "pc_steadi:fell": "yes" });
    expect(variantsOf(o, "chair_stand_30s", "none")).toEqual(["arms_assisted"]);
    expect(o.helperRequired).toEqual(["chair_stand_30s"]);
  });
});

describe("persona: upper limb loss, left", () => {
  const env = envOf({ conditions: ["upper_limb_unilateral"] });

  it("first check asks the side and the prosthesis; the arm tests run on the right only", () => {
    const answers = fill(env, { pc_limb_arm_side: "left", pc_limb_arm_prosthesis: "yes" });
    expect(visibleQuestions(env, answers)).toEqual([
      ...EVERY_CHECK,
      "pc_limb_arm_side",
      "pc_limb_arm_prosthesis",
      ...trunkQs("chair"),
      "pc_helper:trunk_control_seated",
    ]);
    const o = evaluatePrecheck(env, answers, NOW);
    expect(o.skips).toEqual([
      { testId: "shoulder_abduction", side: "left", reason: "limb_loss_arm" },
      { testId: "arm_curl_30s", side: "left", reason: "limb_loss_arm" },
    ]);
    expect(o.setupUpdates).toEqual({ limbLoss: { arm: "left" }, armProsthesis: true });
    expect(o.stored).toMatchObject({ "setup.limbLoss": { arm: "left" }, "fingerprint.armProsthesis": true });
  });

  it("later checks keep the side from the setup and ask only the prosthesis", () => {
    const later: PrecheckEnv = { ...env, firstCheck: false, setup: { limbLoss: { arm: "left" } } };
    const ids = visibleQuestions(later, fill(later));
    expect(ids).not.toContain("pc_limb_arm_side");
    expect(ids).toContain("pc_limb_arm_prosthesis");
    expect(skipOf(run(later), "arm_curl_30s", "left")).toBe("limb_loss_arm");
  });

  it("standing: one arm across the chest in the chair stand", () => {
    const standing = envOf({ position: "standing", conditions: ["upper_limb_unilateral"] });
    const o = run(standing, { pc_limb_arm_side: "left" });
    expect(dayVariant(o, "chair_stand_30s", "none")).toEqual({ variant: "one_arm_cross" });
  });
});

describe("persona: lower limb loss, right, with a prosthesis", () => {
  const env = envOf({ position: "standing", conditions: ["lower_limb_unilateral"] });

  it("the side lean takes the chair stand slot; side and prosthesis are asked", () => {
    expect(env.baseTests).toEqual(["shoulder_abduction", "trunk_control_seated", "arm_curl_30s"]);
    const answers = fill(env, { pc_limb_leg_side: "right", pc_limb_leg_prosthesis: "yes" });
    expect(visibleQuestions(env, answers)).toEqual([
      ...EVERY_CHECK,
      "pc_limb_leg_side",
      "pc_limb_leg_prosthesis",
      ...trunkQs("chair"),
      "pc_helper:trunk_control_seated",
    ]);
    const o = evaluatePrecheck(env, answers, NOW);
    expect(o.status).toBe("proceed");
    expect(o.skips).toEqual([]);
    expect(o.setupUpdates).toEqual({ limbLoss: { leg: "right" }, legProsthesis: true });
    expect(o.stored).toMatchObject({
      "setup.limbLoss": { leg: "right" },
      "fingerprint.legProsthesis": true,
    });
    expect(o.helperRequired).toEqual(["trunk_control_seated"]);
  });

  it("no armrests on both sides at home skips the side lean", () => {
    const o = run(env, { "pc_trunk_armrests:chair": "no" });
    expect(skipOf(o, "trunk_control_seated", "left")).toBe("armrests_needed");
    expect(o.helperRequired).toEqual([]);
  });
});

describe("persona: Parkinson's, standing", () => {
  const env = envOf({ position: "standing", conditions: ["parkinsons"] });

  it("asks medicine state and timing, the standing questions, dizziness on standing, and a helper", () => {
    expect(visibleQuestions(env, fill(env))).toEqual([
      ...EVERY_CHECK,
      "pc_pd_on",
      "pc_pd_dose",
      ...STANDING_QS,
      "pc_pd_dizzy_standing",
      "pc_helper:chair_stand_30s",
    ]);
  });

  it("goes ahead with a helper for the chair stand and keeps the dose bucket", () => {
    const o = run(env, { pc_pd_dose: "2to3h" });
    expect(o.helperRequired).toEqual(["chair_stand_30s"]);
    expect(o.stored).toEqual({
      painNow: 0,
      "fingerprint.pdDoseBucket": "2to3h",
      "fingerprint.helperPresent": ["chair_stand_30s"],
    });
    expect(o.warnings).not.toContain("warn_pd_timing");
  });

  it("medicines not working now postpones for about an hour; not sure is recorded", () => {
    expect(run(env, { pc_pd_on: "no" })).toMatchObject({
      status: "postpone",
      reason: "pd_off",
      screen: "scr_postpone_pd",
    });
    expect(run(env, { pc_pd_on: "unsure" }).stored["fingerprint.pdState"]).toBe("unsure");
  });

  it("later checks show the timing warning", () => {
    const later: PrecheckEnv = { ...env, firstCheck: false, setup: {} };
    expect(run(later).warnings).toContain("warn_pd_timing");
  });
});

describe("persona: arthritis with a knee flare", () => {
  const flare = { pc_arthritis_flare: "yes", "pc_arthritis_flare:areas": ["knee"] };

  it("standing: the flare question opens the areas; a knee flare skips the chair stand, no substitute", () => {
    const env = envOf({ position: "standing", conditions: ["arthritis"] });
    const answers = fill(env, flare);
    expect(visibleQuestions(env, answers)).toEqual([
      ...EVERY_CHECK,
      "pc_arthritis_flare",
      "pc_arthritis_flare:areas",
      ...STANDING_QS,
    ]);
    const o = evaluatePrecheck(env, answers, NOW);
    expect(o.status).toBe("proceed");
    expect(o.skips).toEqual([{ testId: "chair_stand_30s", side: "none", reason: "flare" }]);
    expect(o.helperRequired).toEqual([]);
    // Flare areas are used today only.
    expect(JSON.stringify(o.stored)).not.toContain("knee");
  });

  it("seated: a knee flare changes nothing (no selected test loads the knee)", () => {
    const env = envOf({ conditions: ["arthritis"] });
    expect(run(env, flare).skips).toEqual([]);
  });

  it("a flare in a wrist takes that hand out of the hands allowed chair stand", () => {
    const env = envOf({ position: "standing", conditions: ["arthritis"] });
    const o = run(env, {
      pc_arthritis_flare: "yes",
      "pc_arthritis_flare:areas": ["wrist_left"],
      pc_stand_no_hands: "no",
    });
    expect(skipOf(o, "arm_curl_30s", "left")).toBe("flare");
    expect(dayVariant(o, "chair_stand_30s", "none")).toEqual({ variant: "arms_assisted", pushHand: "right" });
  });
});

describe("booth", () => {
  it("guest (clearance counts as unsure): staff enter the vitals, no home only or helper questions", () => {
    const env = envOf({ position: "standing", clearance: "unsure" }, { setting: "booth" });
    const ids = visibleQuestions(env, fill(env));
    expect(ids).toContain("pc_booth_vitals");
    expect(ids.some((id) => id.startsWith("pc_helper"))).toBe(false);
    const o = run(env);
    expect(o.status).toBe("proceed");
    expect(o.skips).toEqual([]);
    // Clearance not yes: both arms curl without weight.
    expect(variantsOf(o, "arm_curl_30s", "left")).toEqual(["arm_only"]);
    expect(JSON.stringify(o.stored)).not.toMatch(/120|systolic|restingHeartRate/);
  });

  it("booth only answers are allowed with staff; pusher is not", () => {
    const env = envOf(
      { position: "wheelchair", conditions: ["stroke"], support: "left" },
      { setting: "booth" },
    );
    const o = run(env, { pc_sit_unsupported: "no", pc_fall_sitting: "yes" });
    expect(o.skips).toEqual([]);
    expect(skipOf(run(env, { pc_stroke_push: "yes" }), "trunk_control_seated", "left")).toBe("pusher");
  });
});

/* -------------------------------------------------------------- properties */

const RUNS = 1500;
const DATA_MAP = new Set<string>(DATA_MAP_KEYS);
const REASON_IDS = new Set(Object.keys(CHECK_DATA.reasons));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isSideList(v: unknown): boolean {
  return Array.isArray(v) && v.every((s) => s === "left" || s === "right") && new Set(v).size === v.length;
}

/** Every stored field has the shape of its data map entry; returns the problems found. */
function storedProblems(stored: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(stored)) {
    if (!DATA_MAP.has(k)) out.push(`key ${k}`);
    const ok = (() => {
      switch (k) {
        case "painNow":
          return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10;
        case "setup.painSides":
          return isSideList(v);
        case "setup.limbLoss": {
          if (typeof v !== "object" || v === null) return false;
          const e = Object.entries(v);
          return (
            e.length > 0 &&
            e.every(([p, s]) => (p === "arm" || p === "leg") && (s === "left" || s === "right"))
          );
        }
        case "setup.sciT6":
        case "fingerprint.armProsthesis":
        case "fingerprint.legProsthesis":
          return typeof v === "boolean";
        case "fingerprint.pdState":
          return v === "unsure";
        case "fingerprint.pdDoseBucket":
          return ["lt1h", "1to2h", "2to3h", "gt3h"].includes(v as string);
        case "fingerprint.helperPresent":
          return (
            Array.isArray(v) &&
            v.length > 0 &&
            v.every((t) => (TEST_ID_LIST as readonly string[]).includes(t))
          );
        case "changeCleared":
        case "changeReported":
          return typeof v === "string" && DAY.test(v) && v === TODAY;
        default:
          return false;
      }
    })();
    if (!ok) out.push(`value ${k}=${JSON.stringify(v)}`);
  }
  return out;
}

function cases(seed0: number, n = RUNS): { env: PrecheckEnv; answers: Answers; o: PrecheckOutcome }[] {
  const out = [];
  for (let seed = seed0; seed < seed0 + n; seed++) {
    const r = rng(seed);
    const env = randomEnv(r);
    const answers = randomAnswers(r, env);
    out.push({ env, answers, o: evaluatePrecheck(env, answers, NOW) });
  }
  return out;
}

describe("properties over random people and answers", () => {
  const all = cases(1);

  it("reaches every status except incomplete, and proceeds often enough to test the rest", () => {
    const statuses = new Set(all.map((c) => c.o.status));
    for (const s of ["proceed", "postpone", "emergency", "ad"]) expect(statuses).toContain(s);
    expect(statuses).not.toContain("incomplete");
    expect(all.filter((c) => c.o.status === "proceed").length).toBeGreaterThan(RUNS / 10);
  });

  it("an emergency answer always wins, whatever else was answered or left out", () => {
    for (let seed = 5000; seed < 5000 + RUNS; seed++) {
      const r = rng(seed);
      const env = randomEnv(r);
      const answers = { ...randomAnswers(r, env), pc_urgent: "yes" };
      // Also with a random part of the answers missing.
      const partial = Object.fromEntries(
        Object.entries(answers).filter(([k]) => k === "pc_urgent" || r.next() < 0.5),
      );
      for (const a of [answers, partial, { pc_urgent: "yes" }]) {
        const o = evaluatePrecheck(env, a, NOW);
        expect(o.status).toBe("emergency");
        expect(o).toMatchObject({
          reason: "urgent",
          screen: "scr_emergency",
          lock: { reason: "urgent", until: "next_day" },
        });
        expect(o.skips).toEqual([]);
        expect(o.variants).toEqual([]);
        expect(o.helperRequired).toEqual([]);
      }
    }
  });

  it("the AD steps join the emergency screen exactly for SCI or the T6 flag", () => {
    for (const { env, answers } of all) {
      const o = evaluatePrecheck(env, { ...answers, pc_urgent: "yes" }, NOW);
      const sci = env.ctx.conditions.some((c) => c === "sci_complete" || c === "sci_incomplete");
      const level = answers.pc_sci_level;
      const flag =
        sci && (level === "yes" || level === "unsure" || (level === undefined && env.setup?.sciT6 === true));
      expect(o.alsoShow).toEqual(sci || flag || env.setup?.sciT6 === true ? ["scr_ad"] : []);
    }
  });

  it("stored keys are a subset of the data map, with data map shapes (raw answers never appear)", () => {
    for (const { o, answers } of all) {
      expect(storedProblems(o.stored as Record<string, unknown>)).toEqual([]);
      const text = JSON.stringify(o.stored);
      expect(text).not.toMatch(/pc_|bt_|ac_/);
      // Used today only: surgery, flare and pain areas, vitals, checklist, STEADI, AD answers.
      for (const id of [...AREA_IDS, ...SURGERY_AREA_IDS]) expect(text).not.toContain(id);
      expect(text).not.toMatch(/"(yes|no|yes_cleared|bend_hold|bend_no_hold|no_bend|weaker|both)"/);
      if (typeof answers.pc_booth_vitals === "object") expect(text).not.toContain("systolic");
    }
  });

  it("a stored check keeps painNow raised to the highest area score", () => {
    for (const { o, answers } of all) {
      if (o.status !== "proceed") continue;
      const now = answers.pc_pain_now as number;
      const areas = (answers.pc_pain_areas ?? {}) as Record<string, number>;
      const expected = now >= 1 ? Math.max(now, ...Object.values(areas)) : now;
      expect(o.stored.painNow).toBe(expected);
      expect(expected).toBeLessThan(9);
    }
  });

  it("nothing but changeReported is kept when the check does not go ahead", () => {
    for (const { o } of all) {
      if (o.status === "proceed") continue;
      expect(Object.keys(o.stored).filter((k) => k !== "changeReported")).toEqual([]);
      expect(o.setupUpdates).toEqual({});
      expect(o.skips).toEqual([]);
      expect(o.variants).toEqual([]);
    }
  });

  it("answers to questions that are not visible change nothing", () => {
    // The answer that would change the outcome most, if it were read.
    const NO_IS_WORSE = new Set([
      "pc_helper",
      "pc_sit_unsupported",
      "pc_trunk_armrests",
      "pc_weak_lift",
      "pc_pd_on",
      "pc_after_last",
      "pc_change_cleared",
    ]);
    const PARTS = ["", ":left", ":right", ":areas", ":knee", ":chest_belly", ":fell", ":chair_stand_30s"];
    const junk = (env: PrecheckEnv, answers: Answers): Answers => {
      const visible = new Set(visibleQuestions(env, answers));
      const extra: Answers = {};
      for (const q of CHECK_DATA.precheck) {
        for (const part of [...PARTS, ":trunk_control_seated"]) {
          const id = q.id + part;
          if (visible.has(id) || id in answers) continue;
          if (part === ":areas") extra[id] = ["knee", "hip", "chest_belly"];
          else if (q.id === "pc_pain_areas") extra[id] = { knee: 10, hip: 10 };
          else if (q.id === "pc_sci_ready") extra[id] = false;
          else if (q.id === "pc_booth_vitals") extra[id] = "unavailable";
          else extra[id] = NO_IS_WORSE.has(q.id) ? "no" : "yes";
        }
      }
      return { ...extra, ...answers };
    };
    let checked = 0;
    for (const { env, answers, o } of all.slice(0, 600)) {
      const noisy = junk(env, answers);
      expect(Object.keys(noisy).length).toBeGreaterThan(Object.keys(answers).length);
      expect(evaluatePrecheck(env, noisy, NOW)).toEqual(o);
      checked++;
    }
    expect(checked).toBe(600);
  });

  it("is deterministic and never changes the answers it reads", () => {
    for (const { env, answers, o } of all.slice(0, 300)) {
      const copy = structuredClone(answers);
      const envCopy = structuredClone(env);
      expect(evaluatePrecheck(env, answers, NOW)).toEqual(o);
      expect(answers).toEqual(copy);
      expect(env).toEqual(envCopy);
    }
  });

  it("proceed: every visible question answered; skips, variants and helpers are about selected tests", () => {
    for (const { env, answers, o } of all) {
      if (o.status !== "proceed") continue;
      expect(missingAnswers(env, answers)).toEqual([]);
      expect(o.reason).toBeUndefined();
      expect(o.lock).toBeUndefined();
      const keys = o.skips.map((s) => `${s.testId}|${s.side}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const s of o.skips) {
        expect(env.baseTests).toContain(s.testId);
        expect(REASON_IDS.has(s.reason)).toBe(true);
      }
      for (const v of o.variants) {
        expect(env.baseTests).toContain(v.testId);
        expect(keys).not.toContain(`${v.testId}|${v.side}`);
      }
      for (const t of o.helperRequired) {
        expect(env.baseTests).toContain(t);
        // The arm tests need a helper only when no arm can give the fine signal (O34-2 (2)).
        if (!["chair_stand_30s", "trunk_control_seated"].includes(t))
          expect(o.checkIn?.noArmSignal).toBe(true);
      }
      if (env.setting === "booth") {
        expect(o.helperRequired).toEqual([]);
        expect(o.skips.map((s) => s.reason)).not.toContain("booth_only_trunk");
        expect(o.skips.map((s) => s.reason)).not.toContain("armrests_needed");
      }
      // A helper is required exactly when the person confirmed one.
      expect(o.stored["fingerprint.helperPresent"] ?? []).toEqual(o.helperRequired);
    }
  });

  it("postpone: reason, screen and lock follow postponeReasons and locks in the data", () => {
    for (const { o } of all) {
      if (o.status !== "postpone") continue;
      const reason = o.reason as keyof typeof CHECK_DATA.postponeReasons;
      expect(CHECK_DATA.postponeReasons[reason]).toBe(o.screen);
      // The lock is the reason shown, at least as long as that reason's own lock (the longest of
      // all the reasons of the day, SPEC-GAP multi-postpone).
      const rank = (k: string | null) => (k === "next_day" ? 2 : k === "60_min" ? 1 : 0);
      expect(o.lock?.reason).toBe(reason);
      expect(rank(o.lock!.until)).toBeGreaterThanOrEqual(rank(lockKind(reason)));
    }
  });

  it("feeling unwell, pain of 9 or more, or a no to pc_after_last never goes ahead", () => {
    for (const { env, answers } of all) {
      for (const extra of [
        { pc_unwell: "yes" },
        { pc_pain_now: 9 },
        { pc_pain_now: 2, pc_pain_worse: "no", pc_pain_areas: { hip: 9 } },
      ] as Answers[]) {
        expect(evaluatePrecheck(env, { ...answers, ...extra }, NOW).status).not.toBe("proceed");
      }
      if (env.lastCheckLasting) {
        expect(evaluatePrecheck(env, { ...answers, pc_after_last: "no" }, NOW).status).not.toBe("proceed");
      }
    }
  });
});

/* ------------------------------------------------------------ between tests */

describe("betweenTests (bt_pain_after, spec 2.3)", () => {
  const abdRight: TestInstance = { testId: "shoulder_abduction", side: "right" };
  const abdLeft: TestInstance = { testId: "shoulder_abduction", side: "left" };
  const curlRight: TestInstance = { testId: "arm_curl_30s", side: "right" };
  const curlLeft: TestInstance = { testId: "arm_curl_30s", side: "left" };
  const trunkLeft: TestInstance = { testId: "trunk_control_seated", side: "left" };
  const trunkRight: TestInstance = { testId: "trunk_control_seated", side: "right" };

  it("same or less: continue", () => {
    expect(betweenTests({ bt_pain_after: "same" }, abdRight, [abdLeft, curlRight])).toEqual({
      status: "continue",
      skips: [],
    });
  });

  it("no answer or an answer that does not fit: incomplete", () => {
    expect(betweenTests({}, abdRight, []).status).toBe("incomplete");
    expect(betweenTests({ bt_pain_after: "worse" }, abdRight, []).status).toBe("incomplete");
  });

  it("7.2-13: a little more after the right arm raise skips the right arm curl only (pain_more)", () => {
    expect(betweenTests({ bt_pain_after: "more" }, abdRight, [abdLeft, curlRight, curlLeft])).toEqual({
      status: "skip",
      skips: [{ testId: "arm_curl_30s", side: "right", reason: "pain_more" }],
    });
  });

  it("7.2-13: a little more after a side lean skips the other side of the lean (back and hip, pain_more)", () => {
    expect(betweenTests({ bt_pain_after: "more" }, trunkLeft, [trunkRight, curlRight])).toEqual({
      status: "skip",
      skips: [{ testId: "trunk_control_seated", side: "right", reason: "pain_more" }],
    });
  });

  it("a little more with no remaining test on the same area: continue", () => {
    expect(betweenTests({ bt_pain_after: "more" }, curlLeft, [curlRight])).toEqual({
      status: "continue",
      skips: [],
    });
  });

  it("chair stand: the standard version loads no arm; hands allowed loads the pushing hands", () => {
    const standard: TestInstance = { testId: "chair_stand_30s", side: "none" };
    expect(betweenTests({ bt_pain_after: "more" }, standard, [curlRight, curlLeft]).skips).toEqual([]);
    const both: TestInstance = { ...standard, variant: "arms_assisted" };
    expect(betweenTests({ bt_pain_after: "more" }, both, [curlRight, curlLeft]).skips).toHaveLength(2);
    const left: TestInstance = { ...standard, variant: "arms_assisted_steady", pushHand: "left" };
    expect(betweenTests({ bt_pain_after: "more" }, left, [curlRight, curlLeft]).skips).toEqual([
      { testId: "arm_curl_30s", side: "left", reason: "pain_more" },
    ]);
    // An arm curl before a hands allowed chair stand: the stand is skipped when that hand pushes.
    const pushRight: TestInstance = { ...standard, variant: "arms_assisted", pushHand: "right" };
    expect(betweenTests({ bt_pain_after: "more" }, curlRight, [pushRight]).skips).toHaveLength(1);
    expect(betweenTests({ bt_pain_after: "more" }, curlLeft, [pushRight]).skips).toEqual([]);
  });

  it("much more or sharp ends the check for today with a next day lock", () => {
    expect(betweenTests({ bt_pain_after: "much" }, abdRight, [abdLeft])).toEqual({
      status: "end",
      skips: [],
      screen: "scr_stop_pain",
      lock: { reason: "stop_symptom", until: "next_day" },
    });
  });

  it("covers every action of the data", () => {
    const covered = new Set(["more", "much"]);
    for (const a of CHECK_DATA.betweenTests[0].actions) expect(covered).toContain(a.if.equals);
  });
});

/* ---------------------------------------------------------- after the check */

describe("afterCheck (ac_next_day, spec 2.4)", () => {
  it.each([
    ["usual", undefined, false],
    ["settled", undefined, false],
    ["lasting", "scr_after_lasting", true],
  ] as const)("%s", (answer, screen, lasting) => {
    const o = afterCheck({ ac_next_day: answer });
    expect(o.status).toBe("recorded");
    expect(o.screen).toBe(screen);
    expect(o.lastingUnresolved).toBe(lasting);
    expect(o.stored).toEqual({ "assessment.followUp": answer });
    expect(Object.keys(o.stored).every((k) => DATA_MAP.has(k))).toBe(true);
  });

  it("no answer or an answer that does not fit: incomplete, nothing stored", () => {
    for (const a of [{}, { ac_next_day: "fine" }, { ac_next_day: 1 }] as Answers[]) {
      expect(afterCheck(a)).toEqual({ status: "incomplete", stored: {}, lastingUnresolved: false });
    }
  });

  it("O38: is asked 24 hours to 3 days after a completed check", () => {
    const done = NOW;
    expect(afterCheckDue(done, done + 23.9 * HOUR)).toBe(false);
    expect(afterCheckDue(done, done + 24 * HOUR)).toBe(true);
    expect(afterCheckDue(done, done + 72 * HOUR)).toBe(true);
    expect(afterCheckDue(done, done + 72.1 * HOUR)).toBe(false);
  });

  it("a lasting answer makes the next check ask pc_after_last", () => {
    const o = afterCheck({ ac_next_day: "lasting" });
    const next = envOf({}, { firstCheck: false, lastCheckLasting: o.lastingUnresolved });
    expect(visibleQuestions(next, {})).toContain("pc_after_last");
  });
});

/* ------------------------------------------------------------ stop routing */

describe("stopRoute (spec 4.0 stop list)", () => {
  const chair = envOf();
  const standing = envOf({ position: "standing" });
  const sci = envOf({ position: "wheelchair", conditions: ["sci_complete"] }, { setup: { sciT6: true } });
  const nextDay = { reason: "stop_symptom", until: "next_day" };

  it.each([
    ["chest", standing, "scr_emergency", [], true, nextDay],
    ["stroke_signs", standing, "scr_emergency", [], true, nextDay],
    ["ad_signs", sci, "scr_ad", [], true, { reason: "ad", until: "next_day" }],
    ["faint", standing, "scr_faint", [], true, nextDay],
    ["faint", sci, "scr_faint", ["scr_faint_sci"], true, nextDay],
    ["breath", chair, "scr_stop_seek_care", [], true, nextDay],
    ["fall", standing, "scr_fall", [], true, nextDay],
    ["fall", chair, "scr_fall_seated", [], true, nextDay],
    ["fall", sci, "scr_fall_seated", [], true, nextDay],
  ] as const)("%s ends the check", (option, env, screen, alsoShow, endsCheck, lock) => {
    const r = stopRoute(option, env);
    expect(r).toMatchObject({ option, screen, alsoShow, endsCheck, lock, afterRest: false });
    expect(r.reason).toBe("stopped_symptom");
    expect(lockUntil(r.lock!.reason as LockReasonId, NOW)).toBeGreaterThan(NOW);
  });

  it("more pain asks bt_pain_after, which decides the rest", () => {
    expect(stopRoute("pain", chair)).toEqual({
      option: "pain",
      screen: null,
      alsoShow: [],
      endsCheck: false,
      lock: null,
      reason: "stopped_symptom",
      then: "bt_pain_after",
      afterRest: false,
    });
  });

  it.each([
    ["tired", "stopped_symptom", true],
    ["choice", "by_choice", false],
    ["other", "stopped_symptom", true],
  ] as const)("%s: the check may go on with the next test", (option, reason, afterRest) => {
    expect(stopRoute(option, chair)).toEqual({
      option,
      screen: null,
      alsoShow: [],
      endsCheck: false,
      lock: null,
      reason,
      afterRest,
    });
  });

  it("routes every option of the data and refuses an unknown one", () => {
    for (const id of STOP_OPTION_IDS) expect(stopRoute(id, sci).option).toBe(id);
    expect(() => stopRoute("sneeze", chair)).toThrow(RangeError);
  });

  it("AD signs are offered only with sci_t6 (SCI with an unknown level counts)", () => {
    expect(stopOptions(chair)).not.toContain("ad_signs");
    expect(stopOptions(sci)).toContain("ad_signs");
    const unknown = envOf({ position: "wheelchair", conditions: ["sci_incomplete"] });
    expect(stopOptions(unknown)).toContain("ad_signs");
    const below = envOf({ conditions: ["sci_incomplete"] }, { setup: { sciT6: false } });
    expect(stopOptions(below)).not.toContain("ad_signs");
    expect(stopRoute("faint", below).alsoShow).toEqual([]);
    expect(stopOptions(chair)).toEqual(STOP_OPTION_IDS.filter((id) => id !== "ad_signs"));
  });
});

/* ------------------------------------------------------------------- locks */

describe("locks (spec 2.1)", () => {
  it("reads every lock rule of the data as the spec table", () => {
    const table: Record<LockReasonId, "next_day" | "60_min" | null> = {
      unwell: "next_day",
      pain: "next_day",
      pain_worse: "next_day",
      after_last: "next_day",
      ad: "next_day",
      urgent: "next_day",
      stop_symptom: "next_day",
      recent_change: "next_day",
      ms_heat: "60_min",
      pd_off: "60_min",
      sci_ready: null,
    };
    for (const id of LOCK_REASON_IDS) expect(lockKind(id)).toBe(table[id]);
    expect(() => lockKind("sneeze" as LockReasonId)).toThrow(RangeError);
  });

  it("Q33 (1): next day means the later of the next midnight in Riyadh (UTC+3) and 8 hours later", () => {
    const riyadhMidnight = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) - 3 * HOUR;
    // 12:00 in Riyadh on 27 September: midnight is later.
    expect(lockUntil("unwell", NOW)).toBe(riyadhMidnight(2026, 9, 28));
    // 23:59:59 in Riyadh is still 27 September; 8 hours later is 07:59:59 on the 28th.
    const late = riyadhMidnight(2026, 9, 28) - 1000;
    expect(riyadhDate(late)).toBe("2026-09-27");
    expect(lockUntil("pain", late)).toBe(late + 8 * HOUR);
    // 00:00 in Riyadh (21:00 UTC the evening before) is already the 28th: the next midnight.
    expect(riyadhDate(riyadhMidnight(2026, 9, 28))).toBe("2026-09-28");
    expect(lockUntil("pain", riyadhMidnight(2026, 9, 28))).toBe(riyadhMidnight(2026, 9, 29));
    // Year end: 23:00 in Riyadh on 31 December ends at 07:00 on 1 January.
    expect(lockUntil("urgent", Date.UTC(2026, 11, 31, 20, 0))).toBe(Date.UTC(2027, 0, 1, 4, 0));
  });

  it("60 minutes, and no lock for the SCI readiness list", () => {
    expect(lockUntil("pd_off", NOW)).toBe(NOW + HOUR);
    expect(lockUntil("sci_ready", NOW)).toBeNull();
  });

  it("recent_change is released at once by a yes to pc_change_cleared or yes_cleared", () => {
    const env = envOf({}, { firstCheck: false, unresolvedChangeReported: true });
    const lock = { reason: "recent_change" };
    expect(releasesLock(lock, env, { pc_change_cleared: "yes" })).toBe(true);
    expect(releasesLock(lock, env, { pc_change_cleared: "no" })).toBe(false);
    expect(releasesLock(lock, env, {})).toBe(false);
    const sci = envOf(
      { position: "wheelchair", conditions: ["sci_complete"] },
      { firstCheck: false, setup: { sciT6: true } },
    );
    expect(releasesLock(lock, sci, { pc_sci_ad_since: "yes_cleared" })).toBe(true);
    expect(releasesLock(lock, sci, { pc_sci_ad_since: "yes" })).toBe(false);
    // Other locks are never released by answers.
    expect(releasesLock({ reason: "unwell" }, env, { pc_change_cleared: "yes" })).toBe(false);
  });

  it("an uncleared change cannot be bypassed: the next attempt asks pc_change_cleared directly", () => {
    const first = run(envOf(), { pc_change: "yes", pc_change_cleared: "no" });
    expect(first.stored).toEqual({ changeReported: TODAY });
    const next = envOf({}, { firstCheck: false, unresolvedChangeReported: true });
    const o = run(next, { pc_change: "no", pc_change_cleared: "no" });
    expect(o).toMatchObject({ status: "postpone", reason: "recent_change" });
    expect(run(next, { pc_change_cleared: "yes" })).toMatchObject({
      status: "proceed",
      stored: { changeCleared: TODAY },
    });
  });
});

/* ------------------------------------------------------------- variant read */

describe("dayVariant", () => {
  it("splits the main variant from the pushing hand", () => {
    const o = run(envOf({ position: "standing", support: "right" }), {
      pc_weak_shoulder: "yes",
      pc_stand_no_hands: "no",
    });
    expect(dayVariant(o, "chair_stand_30s", "none")).toEqual({ variant: "arms_assisted", pushHand: "left" });
    expect(dayVariant(o, "arm_curl_30s", "right")).toEqual({ variant: "arm_only" });
    expect(dayVariant(o, "arm_curl_30s", "left")).toEqual({});
    expect(dayVariant(o, "shoulder_abduction" as TestId, "left")).toEqual({});
  });
});
