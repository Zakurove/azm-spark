/**
 * Council decisions applied to the pre-check, the stop routes, the locks and the questions around the
 * camera (src/medical/precheck.ts). Every test name cites the decision it proves:
 * council/decisions.json (P, Q, H ids) and council/decisions-ux-round.json (O ids, 7.2 ids).
 */
import { describe, expect, it } from "vitest";
import { CHECK_DATA } from "../src/movements/assessments";
import type { PrecheckId, Side, TestId } from "../src/movements/types";
import {
  AFTER_CHECK_WINDOW_HOURS,
  RESUME_QUESTION_IDS,
  afterCheckDue,
  betweenTests,
  endOfCheck,
  endOfCheckChronicNote,
  endOfCheckForm,
  evaluatePrecheck,
  evaluateResume,
  evaluateSetupQuestions,
  faintFollowUp,
  lockEndsAt,
  lockRecord,
  painAfterDue,
  pausedWhen,
  possibleQuestions,
  questionForm,
  releasesLock,
  resumeQuestions,
  setupQuestionsFor,
  spokenCheckInAnswer,
  stopRoute,
  visibleQuestions,
  type Answers,
  type PrecheckEnv,
  type TestInstance,
} from "../src/medical/precheck";
import {
  NOW,
  TODAY,
  baseTestsFor,
  envOf,
  fill,
  randomAnswer,
  randomEnv,
  rng,
  run,
  skipOf,
  variantsOf,
} from "./precheck-fixtures";

const HOUR = 60 * 60 * 1000;
/** A Riyadh wall clock time on a day of September or October 2026, as epoch ms (UTC+3). */
const riyadh = (day: number, hour: number, minute = 0, month = 9) =>
  Date.UTC(2026, month - 1, day, hour - 3, minute);

const standing = (p: Parameters<typeof envOf>[0] = {}, o: Parameters<typeof envOf>[1] = {}) =>
  envOf({ position: "standing", ...p }, o);
const sci = (p: Parameters<typeof envOf>[0] = {}, o: Parameters<typeof envOf>[1] = {}) =>
  envOf({ position: "wheelchair", conditions: ["sci_complete"], ...p }, o);

/* ---------------------------------------------------------- answer formats */

describe("7.2-8 and Q18 (2): pc_sci_ready is a read list with two buttons", () => {
  const env = sci();
  const base = { pc_sci_level: "yes" };

  it("7.2-8: done goes ahead", () => {
    expect(run(env, { ...base, pc_sci_ready: "done" }).status).toBe("proceed");
  });

  it("7.2-8: not_yet postpones with sci_ready on scr_postpone_sci and no lock", () => {
    const o = evaluatePrecheck(env, fill(env, { ...base, pc_sci_ready: "not_yet" }), NOW);
    expect(o).toMatchObject({ status: "postpone", reason: "sci_ready", screen: "scr_postpone_sci" });
    expect(o.lock).toEqual({ reason: "sci_ready", until: null });
  });

  it("7.2-8: the v1 checklist answers (true, ticked indexes) are not answers any more", () => {
    for (const old of [true, ["0", "1", "2", "3", "4", "5"], ["0"]]) {
      const answers = fill(env, { ...base, pc_sci_ready: "done" });
      answers.pc_sci_ready = old;
      expect(evaluatePrecheck(env, answers, NOW).status, JSON.stringify(old)).toBe("incomplete");
    }
  });
});

describe("Q12 (1): pc_trunk_armrests is asked in the form of the person's position", () => {
  it("Q12 (1): a chair user answers the chair form, a wheelchair user the wheelchair form", () => {
    expect(visibleQuestions(envOf(), {})).toContain("pc_trunk_armrests:chair");
    expect(visibleQuestions(envOf(), {})).not.toContain("pc_trunk_armrests:wheelchair");
    const wheel = envOf({ position: "wheelchair" });
    expect(visibleQuestions(wheel, {})).toContain("pc_trunk_armrests:wheelchair");
    expect(visibleQuestions(wheel, {})).not.toContain("pc_trunk_armrests:chair");
  });

  it("Q12 (1): a standing person with the side lean in the chair stand slot sits on a chair", () => {
    const env = standing({ pain: ["knee"] });
    expect(env.baseTests).toContain("trunk_control_seated");
    expect(visibleQuestions(env, {})).toContain("pc_trunk_armrests:chair");
  });

  it("Q12 (1): no skips the side lean with armrests_needed, at home only", () => {
    const o = run(envOf(), { "pc_trunk_armrests:chair": "no" });
    expect(skipOf(o, "trunk_control_seated", "left")).toBe("armrests_needed");
    expect(skipOf(o, "trunk_control_seated", "right")).toBe("armrests_needed");
    expect(
      visibleQuestions(envOf({}, { setting: "booth" }), {}).some((q) => q.startsWith("pc_trunk_armrests")),
    ).toBe(false);
  });

  it("Q12 (1): an answer to the other position's form does not count", () => {
    const env = envOf({ position: "wheelchair" });
    const answers = fill(env);
    delete answers["pc_trunk_armrests:wheelchair"];
    answers["pc_trunk_armrests:chair"] = "yes";
    expect(evaluatePrecheck(env, answers, NOW).status).toBe("incomplete");
    answers.pc_trunk_armrests = "yes";
    expect(evaluatePrecheck(env, answers, NOW).status).toBe("incomplete");
  });

  it("Q12 (1) and Q18: questionForm names the position form", () => {
    expect(questionForm(envOf({ position: "wheelchair" }), {}, "pc_trunk_armrests:wheelchair")).toMatchObject(
      {
        text: "askByPosition",
        position: "wheelchair",
      },
    );
    expect(questionForm(standing({ pain: ["knee"] }), {}, "pc_trunk_armrests:chair")).toMatchObject({
      text: "askByPosition",
      position: "chair",
    });
  });
});

describe("Q21 and O47: booth vitals by the mean of two readings", () => {
  const booth = (p: Parameters<typeof envOf>[0] = {}) =>
    standing({ clearance: "unsure", ...p }, { setting: "booth" });
  const vitals = (v: Partial<Record<string, number | boolean>> = {}) => ({
    systolic1: 120,
    diastolic1: 80,
    systolic2: 124,
    diastolic2: 82,
    restingHeartRate: 72,
    irregularHeartbeat: false,
    ...v,
  });
  const stand = (v: unknown) =>
    skipOf(run(booth(), { pc_booth_vitals: v as never }), "chair_stand_30s", "none");

  it("Q21: is entered by staff at the booth for clearance no or not sure with the chair stand", () => {
    expect(visibleQuestions(booth(), {})).toContain("pc_booth_vitals");
    expect(visibleQuestions(booth({ clearance: "yes" }), {})).not.toContain("pc_booth_vitals");
    expect(visibleQuestions(envOf({ clearance: "no" }, { setting: "booth" }), {})).not.toContain(
      "pc_booth_vitals",
    );
  });

  it("Q21 (4): readings inside every limit keep the chair stand", () => {
    expect(stand(vitals())).toBeUndefined();
    expect(run(booth(), { pc_booth_vitals: vitals() }).status).toBe("proceed");
  });

  it("Q21 (4): a mean systolic of 160 or more skips the chair stand, a mean of 159 does not", () => {
    expect(stand(vitals({ systolic1: 158, systolic2: 162 }))).toBe("booth_vitals");
    expect(stand(vitals({ systolic1: 158, systolic2: 160 }))).toBeUndefined();
    // One reading over the limit is not enough: the mean is used (Q21 (3)).
    expect(stand(vitals({ systolic1: 170, systolic2: 140 }))).toBeUndefined();
  });

  it("Q21 (4): a mean systolic below 90 skips, 90 does not", () => {
    expect(stand(vitals({ systolic1: 88, systolic2: 91 }))).toBe("booth_vitals");
    expect(stand(vitals({ systolic1: 90, systolic2: 90 }))).toBeUndefined();
  });

  it("Q21 (4): a mean diastolic of 100 or more skips, 99 does not", () => {
    expect(stand(vitals({ diastolic1: 100, diastolic2: 100 }))).toBe("booth_vitals");
    expect(stand(vitals({ diastolic1: 98, diastolic2: 100 }))).toBeUndefined();
  });

  it("Q21 (4): a resting heart rate above 120 skips, 120 does not", () => {
    expect(stand(vitals({ restingHeartRate: 121 }))).toBe("booth_vitals");
    expect(stand(vitals({ restingHeartRate: 120 }))).toBeUndefined();
  });

  it("Q21 (4): an irregular heartbeat flag skips the chair stand", () => {
    expect(stand(vitals({ irregularHeartbeat: true }))).toBe("booth_vitals");
    expect(stand(vitals({ irregularHeartbeat: 1 }))).toBe("booth_vitals");
    expect(stand(vitals({ irregularHeartbeat: 0 }))).toBeUndefined();
  });

  it("Q21 (6) and O47 (4): no cuff or no licensed practitioner skips with clearance_booth", () => {
    expect(stand("unavailable")).toBe("clearance_booth");
  });

  it("Q21: the v1 single reading format is not an answer", () => {
    const env = booth();
    const answers = fill(env);
    answers.pc_booth_vitals = { restingHeartRate: 72, systolic: 120, diastolic: 80 };
    expect(evaluatePrecheck(env, answers, NOW).status).toBe("incomplete");
  });

  it("O47 (1): pc_booth_vitals is never shown with an SCI condition, whatever the context", () => {
    const r = rng(4701);
    let reachedSci = 0;
    for (let i = 0; i < 3000; i++) {
      const e = randomEnv(r);
      const conditions = [
        ...e.ctx.conditions.filter((c) => c !== "none"),
        r.pick(["sci_complete", "sci_incomplete"]),
      ];
      const ctx = { ...e.ctx, conditions, clearance: r.pick(["yes", "no", "unsure"] as const) };
      const setting = r.next() < 0.7 ? "booth" : "home";
      const env: PrecheckEnv = { ...e, ctx, setting, baseTests: baseTestsFor(ctx, setting) };
      if (setting === "booth") reachedSci++;
      const answers: Answers = {};
      for (let k = 0; k < 6; k++)
        for (const id of visibleQuestions(env, answers))
          if (!(id in answers)) answers[id] = randomAnswer(r, id);
      expect(visibleQuestions(env, answers), JSON.stringify(ctx)).not.toContain("pc_booth_vitals");
      expect(possibleQuestions(env, {}), JSON.stringify(ctx)).not.toContain("pc_booth_vitals");
    }
    expect(reachedSci).toBeGreaterThan(1500);
  });

  it("O47 (3): if the invariant ever broke, sci_t6 never gets the chair stand, and 150 or an AD sign starts the AD response", () => {
    // A hand made environment that the selection never produces (sci with a chair stand at the booth).
    const env = envOf(
      { position: "standing", conditions: ["sci_incomplete"], clearance: "unsure" },
      { setting: "booth", baseTests: ["shoulder_abduction", "chair_stand_30s", "arm_curl_30s"] },
    );
    const given = { pc_sci_level: "yes", pc_booth_vitals: vitals() };
    expect(skipOf(run(env, given), "chair_stand_30s", "none")).toBe("clearance_booth");
    const high = run(env, { ...given, pc_booth_vitals: vitals({ systolic1: 150, systolic2: 152 }) });
    expect(high).toMatchObject({ status: "ad", screen: "scr_ad", lock: { reason: "ad", until: "next_day" } });
    const sign = run(env, { ...given, pc_booth_vitals: vitals({ adSign: true }) });
    expect(sign.status).toBe("ad");
    const rise = run(env, {
      ...given,
      pc_booth_vitals: vitals({ systolic1: 140, systolic2: 142, usualSystolic: 110 }),
    });
    expect(rise.status).toBe("ad");
  });
});

/* ------------------------------------------------------------ Q7 pain */

describe("Q7: the pain gates", () => {
  const seated = envOf();
  const stand = standing();

  it("Q7: pain now of 9 or more postpones with pain", () => {
    expect(run(seated, { pc_pain_now: 9 })).toMatchObject({ status: "postpone", reason: "pain" });
    expect(run(seated, { pc_pain_now: 10 })).toMatchObject({ status: "postpone", reason: "pain" });
  });

  it("Q7: 7 or 8 goes ahead with warn_pain_high when the pain is not new or worse and no loaded area is 7 or more", () => {
    for (const p of [7, 8]) {
      const o = run(seated, { pc_pain_now: p, pc_pain_worse: "no", pc_pain_areas: { knee: 7 } });
      expect(o.status, String(p)).toBe("proceed");
      expect(o.warnings).toContain("warn_pain_high");
    }
    expect(run(seated, { pc_pain_now: 6, pc_pain_worse: "no" }).warnings).not.toContain("warn_pain_high");
  });

  it("Q7: 7 or 8 postpones when the pain is new or clearly worse than usual", () => {
    expect(run(seated, { pc_pain_now: 8, pc_pain_worse: "yes" })).toMatchObject({
      status: "postpone",
      reason: "pain_worse",
      screen: "scr_postpone_care",
    });
  });

  it("Q7: 7 or more in an area a selected test loads postpones", () => {
    expect(run(stand, { pc_pain_now: 7, pc_pain_worse: "no", pc_pain_areas: { knee: 7 } })).toMatchObject({
      status: "postpone",
      reason: "pain",
    });
    // The knee loads only the chair stand, which a seated person does not do.
    expect(run(seated, { pc_pain_now: 7, pc_pain_worse: "no", pc_pain_areas: { knee: 7 } }).status).toBe(
      "proceed",
    );
  });

  it("Q7: an area scored 6 skips the tests that load it (pain_today)", () => {
    const o = run(seated, { pc_pain_now: 6, pc_pain_worse: "no", pc_pain_areas: { shoulder_left: 6 } });
    expect(o.status).toBe("proceed");
    expect(skipOf(o, "shoulder_abduction", "left")).toBe("pain_today");
    expect(skipOf(o, "shoulder_abduction", "right")).toBeUndefined();
  });

  it("Q7: an area of 9 raises pain now to 9 and postpones", () => {
    const o = run(seated, { pc_pain_now: 3, pc_pain_worse: "no", pc_pain_areas: { knee: 9 } });
    expect(o).toMatchObject({ status: "postpone", reason: "pain" });
  });

  it("Q7: the pain scales take whole numbers 0 to 10 only (11 buttons, never a slider value)", () => {
    for (const bad of [-1, 11, 4.5, "4", null]) {
      const answers = fill(seated);
      answers.pc_pain_now = bad as never;
      expect(evaluatePrecheck(seated, answers, NOW).status, String(bad)).toBe("incomplete");
    }
    expect(CHECK_DATA.painScale.rows.flat()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

/* --------------------------------------------------------- Q33 and Q25 */

describe("Q33 (3): pc_faint_since after a faint stop", () => {
  const env = envOf({}, { firstCheck: false, faintReportedUnresolved: true });

  it("Q33 (3): is asked only when a faint stop left faintReported, before pc_change", () => {
    expect(visibleQuestions(envOf({}, { firstCheck: false }), {})).not.toContain("pc_faint_since");
    const ids = visibleQuestions(env, {});
    expect(ids).toContain("pc_faint_since");
    expect(ids.indexOf("pc_faint_since")).toBeLessThan(ids.indexOf("pc_change"));
    expect(ids.indexOf("pc_faint_since")).toBeGreaterThan(ids.indexOf("pc_urgent"));
  });

  it("Q33 (3): yes postpones at once with recent_change and stores changeReported (the next check asks pc_change_cleared)", () => {
    const o = evaluatePrecheck(env, { pc_urgent: "no", pc_unwell: "no", pc_faint_since: "yes" }, NOW);
    expect(o).toMatchObject({
      status: "postpone",
      reason: "recent_change",
      screen: "scr_postpone_care",
      lock: { reason: "recent_change", until: "next_day" },
      stored: { changeReported: TODAY },
      faintReportedCleared: true,
    });
  });

  it("Q33 (3): no goes ahead and clears faintReported", () => {
    const o = run(env, { pc_faint_since: "no" });
    expect(o.status).toBe("proceed");
    expect(o.faintReportedCleared).toBe(true);
    expect(o.stored.changeReported).toBeUndefined();
  });

  it("Q33 (3): pc_urgent still comes first and wins", () => {
    const o = evaluatePrecheck(env, { pc_urgent: "yes", pc_faint_since: "yes" }, NOW);
    expect(o.status).toBe("emergency");
  });
});

describe("Q33 (2): changeReported", () => {
  it("Q33 (2): pc_urgent yes stores changeReported with the emergency", () => {
    const o = evaluatePrecheck(envOf(), { pc_urgent: "yes" }, NOW);
    expect(o).toMatchObject({ status: "emergency", stored: { changeReported: TODAY } });
  });

  it("Q33 (2): an unresolved changeReported goes straight to pc_change_cleared, after the emergency questions, in its direct form", () => {
    const env = envOf({}, { firstCheck: false, unresolvedChangeReported: true });
    const ids = visibleQuestions(env, {});
    expect(ids).not.toContain("pc_change");
    expect(ids[0]).toBe("pc_urgent");
    expect(ids[1]).toBe("pc_change_cleared");
    expect(questionForm(env, {}, "pc_change_cleared").text).toBe("askDirect");
    // After a yes to pc_change the ordinary form is used.
    const plain = envOf({}, { firstCheck: false });
    expect(questionForm(plain, { pc_change: "yes" }, "pc_change_cleared").text).toBe("ask");
  });

  it("Q33 (2): a no postpones with recent_change; a yes releases the lock and stores changeCleared", () => {
    const env = envOf({}, { firstCheck: false, unresolvedChangeReported: true });
    expect(run(env, { pc_change_cleared: "no" })).toMatchObject({
      status: "postpone",
      reason: "recent_change",
    });
    const yes = run(env, { pc_change_cleared: "yes" });
    expect(yes.stored.changeCleared).toBe(TODAY);
    expect(releasesLock({ releasableByClearance: true }, env, { pc_change_cleared: "yes" })).toBe(true);
    expect(releasesLock({ releasableByClearance: false }, env, { pc_change_cleared: "yes" })).toBe(false);
  });
});

describe("Q33 (1) and Q25 (c): locks", () => {
  it("Q33 (1): a next day lock ends at the later of local midnight and 8 hours after it started", () => {
    // 10:00 in Riyadh: midnight is later.
    expect(lockEndsAt("next_day", riyadh(27, 10))).toBe(riyadh(28, 0));
    // 15:59: 23:59 is before midnight, so midnight.
    expect(lockEndsAt("next_day", riyadh(27, 15, 59))).toBe(riyadh(28, 0));
    // 16:00: both at midnight.
    expect(lockEndsAt("next_day", riyadh(27, 16))).toBe(riyadh(28, 0));
    // 20:30: 04:30 tomorrow is later than midnight.
    expect(lockEndsAt("next_day", riyadh(27, 20, 30))).toBe(riyadh(28, 4, 30));
    // 23:50: 07:50 tomorrow.
    expect(lockEndsAt("next_day", riyadh(27, 23, 50))).toBe(riyadh(28, 7, 50));
    // 00:10: midnight of that day's end.
    expect(lockEndsAt("next_day", riyadh(28, 0, 10))).toBe(riyadh(29, 0));
  });

  it("Q33: a 60 minute lock ends 60 minutes later", () => {
    expect(lockEndsAt("60_min", riyadh(27, 23, 30))).toBe(riyadh(28, 0, 30));
  });

  it("Q25 (c): the lock record keeps the end and whether a clearance answer releases it, never the reason", () => {
    const start = riyadh(27, 10);
    const rec = lockRecord({ reason: "recent_change", until: "next_day" }, start);
    expect(rec).toEqual({ until: riyadh(28, 0), releasableByClearance: true });
    expect(Object.keys(rec!)).not.toContain("reason");
    expect(lockRecord({ reason: "pain", until: "next_day" }, start)).toEqual({
      until: riyadh(28, 0),
      releasableByClearance: false,
    });
    expect(lockRecord({ reason: "ms_heat", until: "60_min" }, start)?.until).toBe(start + HOUR);
    expect(lockRecord({ reason: "sci_ready", until: null }, start)).toBeNull();
  });
});

describe("Q33 (4): {when} of the paused screen", () => {
  it("Q33 (4): a 60 minute lock reads in about an hour when it starts, after {time} on return", () => {
    const start = riyadh(27, 9, 20);
    const lock = { kind: "60_min" as const, until: start + HOUR };
    expect(pausedWhen(lock, start, "start")).toEqual({ token: "min60_start" });
    expect(pausedWhen(lock, start + 10 * 60 * 1000, "return")).toEqual({
      token: "min60_active",
      time: { hour: 10, minute: 20, suffix: "am" },
    });
  });

  it("Q33 (4): a next day lock reads tomorrow when it ends at midnight", () => {
    const start = riyadh(27, 11);
    expect(pausedWhen({ kind: "next_day", until: lockEndsAt("next_day", start) }, start, "start")).toEqual({
      token: "nextDay_midnight",
    });
  });

  it("Q33 (4): a next day lock ending at a clock time reads tomorrow after {time}, 12 hour clock", () => {
    const start = riyadh(27, 23, 50);
    expect(pausedWhen({ kind: "next_day", until: lockEndsAt("next_day", start) }, start, "start")).toEqual({
      token: "nextDay_clock",
      time: { hour: 7, minute: 50, suffix: "am" },
    });
  });

  it("Q33 (4): returning on the day the lock ends reads after {time}", () => {
    const start = riyadh(27, 22);
    const lock = { kind: "next_day" as const, until: lockEndsAt("next_day", start) };
    expect(pausedWhen(lock, riyadh(28, 2), "return")).toEqual({
      token: "sameDay_clock",
      time: { hour: 6, minute: 0, suffix: "am" },
    });
  });

  it("Q33 (4): noon and midnight read 12 pm and 12 am", () => {
    const lock = { kind: "60_min" as const, until: riyadh(27, 12, 5) };
    expect(pausedWhen(lock, riyadh(27, 11, 30), "return").time).toEqual({
      hour: 12,
      minute: 5,
      suffix: "pm",
    });
    const late = { kind: "60_min" as const, until: riyadh(28, 0, 15) };
    expect(pausedWhen(late, riyadh(27, 23, 30), "return").time).toEqual({
      hour: 12,
      minute: 15,
      suffix: "am",
    });
  });
});

/* -------------------------------------------------- stops and follow ups */

describe("Q33 and O42: the stop list stores and follow ups", () => {
  const env = envOf();

  it("Q33 (2): chest, stroke_signs and breath stops store changeReported", () => {
    for (const o of ["chest", "stroke_signs", "breath"])
      expect(stopRoute(o, env).stores, o).toBe("changeReported");
  });

  it("Q33 (3): every faint stop stores faintReported and asks sf_faint_loc", () => {
    expect(stopRoute("faint", env)).toMatchObject({
      stores: "faintReported",
      then: "sf_faint_loc",
      endsCheck: true,
    });
  });

  it("O42: a fall stop asks sf_faint_loc too, and stores nothing (falls are asked again by pc_steadi)", () => {
    const r = stopRoute("fall", env);
    expect(r.then).toBe("sf_faint_loc");
    expect(r.stores).toBeUndefined();
  });

  it("Q33 (2): fall and AD stops do not store changeReported", () => {
    const s = sci({}, { setup: { sciT6: true } });
    expect(stopRoute("ad_signs", s).stores).toBeUndefined();
    expect(stopRoute("fall", s).stores).toBeUndefined();
  });

  it("Q31 (3): the urgent options come first as one group", () => {
    const groups = CHECK_DATA.stopRouting.options.map((o) => o.group);
    expect(groups.lastIndexOf("urgent")).toBeLessThan(groups.indexOf("other"));
    expect(CHECK_DATA.stopRouting.askCue).toBe("check_stop_why");
  });
});

describe("Q33 (3) and O42: sf_faint_loc, did you pass out", () => {
  it("Q33 (3): yes or not sure opens scr_emergency and stores changeReported", () => {
    for (const a of ["yes", "unsure"]) {
      expect(faintFollowUp(a, NOW), a).toMatchObject({
        status: "emergency",
        screen: "scr_emergency",
        stored: { changeReported: TODAY },
      });
    }
  });

  it("Q33 (3): no keeps the next day lock of the stop and stores nothing more", () => {
    expect(faintFollowUp("no", NOW)).toEqual({
      status: "recorded",
      lock: { reason: "stop_symptom", until: "next_day" },
      stored: {},
    });
  });

  it("Q33 (3): a faint stop after a no response alarm is handled as a yes, whatever the answer", () => {
    for (const a of ["no", "yes", "unsure", undefined])
      expect(faintFollowUp(a, NOW, { afterNoResponse: true }).status, String(a)).toBe("emergency");
  });

  it("Q33 (3): no answer yet is incomplete (the 30 s check in is the UI's)", () => {
    expect(faintFollowUp(undefined, NOW).status).toBe("incomplete");
    expect(faintFollowUp("maybe", NOW).status).toBe("incomplete");
  });
});

describe("Q23 (7): the end of check symptom question", () => {
  it("Q23 (7): the general form when no one sided drop was found", () => {
    expect(endOfCheckForm([])).toEqual({ id: "ec_symptoms" });
  });

  it("Q23 (7): the side form names the side of a one sided drop", () => {
    expect(endOfCheckForm(["left"])).toEqual({ id: "ec_symptoms", side: "left" });
    expect(endOfCheckForm(["right", "right"])).toEqual({ id: "ec_symptoms", side: "right" });
  });

  it("Q23 (7): drops on both sides (different tests) ask the general form", () => {
    expect(endOfCheckForm(["left", "right"])).toEqual({ id: "ec_symptoms" });
  });

  it("Q23 (7) and Q33 (2): yes opens scr_emergency, stores changeReported and locks as pc_urgent does", () => {
    expect(endOfCheck("yes", NOW)).toEqual({
      status: "emergency",
      screen: "scr_emergency",
      lock: { reason: "urgent", until: "next_day" },
      stored: { changeReported: TODAY },
    });
    expect(endOfCheck("no", NOW)).toEqual({ status: "proceed", stored: {} });
    expect(endOfCheck(undefined, NOW)).toEqual({ status: "incomplete", stored: {} });
  });
});

describe("O31: bt_pain_after", () => {
  const trunk = (side: Side): TestInstance => ({ testId: "trunk_control_seated", side });
  const curl = (side: Side): TestInstance => ({ testId: "arm_curl_30s", side });

  it("O31: is asked once after the side lean, when both sides are done", () => {
    expect(painAfterDue(trunk("right"), [trunk("left"), curl("right"), curl("left")])).toBe(false);
    expect(painAfterDue(trunk("left"), [curl("right"), curl("left")])).toBe(true);
  });

  it("O31: is asked after each side of the other two sided tests", () => {
    expect(painAfterDue(curl("right"), [curl("left")])).toBe(true);
    expect(painAfterDue({ testId: "shoulder_abduction", side: "right" }, [])).toBe(true);
  });

  it("O31 and 7.2-13: a little more skips later tests that load the back or hip with pain_more", () => {
    const out = betweenTests({ bt_pain_after: "more" }, { testId: "trunk_control_seated", side: "none" }, [
      curl("right"),
      { testId: "chair_stand_30s", side: "none", variant: "standard" },
    ]);
    expect(out.status).toBe("skip");
    expect(out.skips).toEqual([{ testId: "chair_stand_30s", side: "none", reason: "pain_more" }]);
  });

  it("O31: much more stops the check with scr_stop_pain and a next day lock", () => {
    const out = betweenTests({ bt_pain_after: "much" }, trunk("left"), [curl("right")]);
    expect(out).toMatchObject({ status: "end", screen: "scr_stop_pain", lock: { until: "next_day" } });
  });
});

describe("O38: ac_next_day", () => {
  it("O38: is asked from 24 hours to 72 hours after a completed check", () => {
    expect(AFTER_CHECK_WINDOW_HOURS).toEqual([24, 72]);
    const done = riyadh(27, 10);
    expect(afterCheckDue(done, done + 23 * HOUR)).toBe(false);
    expect(afterCheckDue(done, done + 24 * HOUR)).toBe(true);
    expect(afterCheckDue(done, done + 72 * HOUR)).toBe(true);
    expect(afterCheckDue(done, done + 72 * HOUR + 1)).toBe(false);
  });

  it("O38: never before 06:00 local time", () => {
    const done = riyadh(27, 2);
    expect(afterCheckDue(done, riyadh(28, 2))).toBe(false);
    expect(afterCheckDue(done, riyadh(28, 5, 59))).toBe(false);
    expect(afterCheckDue(done, riyadh(28, 6))).toBe(true);
  });
});

/* ------------------------------------------------- helpers and the arms */

describe("Q11 and O34-2: pc_helper, the self declared hard gate at home", () => {
  it("Q11: the chair stand needs a helper for the listed groups, the side lean for SCI, stroke, CP, PD, MS and the first home side lean", () => {
    const stand = standing({ conditions: ["parkinsons"] });
    expect(visibleQuestions(stand, fill(stand))).toContain("pc_helper:chair_stand_30s");
    const lean = envOf({ conditions: ["ms"] }, { firstCheck: false, sideLeanDoneAtHome: true });
    expect(visibleQuestions(lean, fill(lean))).toContain("pc_helper:trunk_control_seated");
    const plain = envOf({}, { firstCheck: false, sideLeanDoneAtHome: true });
    expect(visibleQuestions(plain, fill(plain)).filter((q) => q.startsWith("pc_helper"))).toEqual([]);
    const first = envOf({}, { firstCheck: true });
    expect(visibleQuestions(first, fill(first))).toContain("pc_helper:trunk_control_seated");
  });

  it("Q11: any pc_steadi yes, pc_walking_aid yes and pc_pd_dizzy_standing yes need a helper for the chair stand", () => {
    const env = standing();
    const givens: Answers[] = [{ "pc_steadi:worry": "yes" }, { pc_walking_aid: "yes" }];
    for (const given of givens) {
      const answers = fill(env, given);
      expect(visibleQuestions(env, answers), JSON.stringify(given)).toContain("pc_helper:chair_stand_30s");
    }
    const pd = standing({ conditions: ["parkinsons"] });
    expect(visibleQuestions(pd, fill(pd, { pc_pd_dizzy_standing: "yes" }))).toContain(
      "pc_helper:chair_stand_30s",
    );
  });

  it("Q11: no skips that test today with helper_needed; yes shows the briefing and keeps helperPresent", () => {
    const env = standing({ conditions: ["stroke"], support: "left" });
    const no = run(env, { "pc_helper:chair_stand_30s": "no" });
    expect(skipOf(no, "chair_stand_30s", "none")).toBe("helper_needed");
    const yes = run(env, { "pc_helper:chair_stand_30s": "yes" });
    expect(yes.helperRequired).toContain("chair_stand_30s");
    expect(yes.warnings).toContain("scr_helper_brief_stand");
    expect(yes.helperBriefing).toMatchObject({ chair_stand_30s: "scr_helper_brief_stand" });
    expect(yes.stored["fingerprint.helperPresent"]).toContain("chair_stand_30s");
  });

  it("Q11: at the booth nobody is asked for a helper (staff stand within reach)", () => {
    const env = standing({ conditions: ["stroke"], support: "left" }, { setting: "booth" });
    expect(visibleQuestions(env, fill(env)).filter((q) => q.startsWith("pc_helper"))).toEqual([]);
  });

  it("O34-2 (1), (2): with no arm that can signal, every camera test left needs a helper at home, the arm tests with the check in line", () => {
    // A weaker left arm that cannot lift, and the right arm lost.
    const env = envOf(
      { conditions: ["stroke", "upper_limb_unilateral"], support: "left" },
      { firstCheck: false, sideLeanDoneAtHome: true, setup: { limbLoss: { arm: "right" } } },
    );
    const answers = fill(env, { pc_weak_lift: "no" });
    const helpers = visibleQuestions(env, answers).filter((q) => q.startsWith("pc_helper"));
    // Both arm tests lose both sides (limb loss right, weaker left cannot lift): only the side lean is left.
    expect(helpers).toEqual(["pc_helper:trunk_control_seated"]);
    const o = run(env, { pc_weak_lift: "no" });
    expect(o.checkIn).toEqual({ raiseAllowed: false, noArmSignal: true, fineZoneSide: null });
  });

  it("O34-2 (2): an SCI person whose arms cannot bend needs a helper for the arm raise too, with the check in line briefing", () => {
    const env = sci({}, { firstCheck: false, setup: { sciT6: false }, sideLeanDoneAtHome: true });
    const given = { "pc_arm_function:right": "no_bend", "pc_arm_function:left": "no_bend" };
    const answers = fill(env, given);
    const helpers = visibleQuestions(env, answers).filter((q) => q.startsWith("pc_helper"));
    expect(helpers).toEqual(["pc_helper:shoulder_abduction", "pc_helper:trunk_control_seated"]);
    const o = run(env, given);
    expect(o.checkIn?.noArmSignal).toBe(true);
    expect(o.helperBriefing).toEqual({
      shoulder_abduction: "helperBriefing.checkInLine",
      trunk_control_seated: "scr_helper_brief_trunk",
    });
    expect(
      skipOf(run(env, { ...given, "pc_helper:shoulder_abduction": "no" }), "shoulder_abduction", "left"),
    ).toBe("helper_needed");
  });

  it("O34-2 (1): a failed fine rehearsal sets noArmSignal for today", () => {
    const env = envOf({}, { firstCheck: false, sideLeanDoneAtHome: true, fineRehearsalFailed: true });
    const helpers = visibleQuestions(env, fill(env)).filter((q) => q.startsWith("pc_helper"));
    expect(helpers).toEqual([
      "pc_helper:shoulder_abduction",
      "pc_helper:trunk_control_seated",
      "pc_helper:arm_curl_30s",
    ]);
    expect(run(env).checkIn?.noArmSignal).toBe(true);
  });

  it("O34-2 (7): nothing changes at the booth", () => {
    const env = envOf(
      { conditions: ["sci_complete"], position: "wheelchair" },
      { setting: "booth", fineRehearsalFailed: true },
    );
    expect(visibleQuestions(env, fill(env)).filter((q) => q.startsWith("pc_helper"))).toEqual([]);
  });
});

describe("O34-4 (3) and O34-1 (1): raiseAllowed and the fine zone side", () => {
  it("O34-4 (3): no_overhead forbids asking for a raised hand", () => {
    expect(run(envOf({ restrictions: ["no_overhead"] })).checkIn?.raiseAllowed).toBe(false);
  });

  it("O34-4 (3): a free arm allows it; pc_weak_shoulder yes or pc_weak_lift no take the weaker arm out", () => {
    expect(run(envOf()).checkIn?.raiseAllowed).toBe(true);
    const weak = envOf({ support: "left", conditions: ["stroke"] });
    expect(run(weak, { pc_weak_shoulder: "yes" }).checkIn?.raiseAllowed).toBe(true);
    const lost = envOf(
      { support: "left", conditions: ["stroke", "upper_limb_unilateral"] },
      { firstCheck: false, setup: { limbLoss: { arm: "right" } } },
    );
    expect(run(lost, { pc_weak_shoulder: "yes" }).checkIn?.raiseAllowed).toBe(false);
    expect(run(lost, { pc_weak_lift: "no" }).checkIn?.raiseAllowed).toBe(false);
    expect(run(lost).checkIn?.raiseAllowed).toBe(true);
  });

  it("O34-1 (1): the fine zone sits on the stronger arm, never the weaker, lost or painful one; on a tie the right", () => {
    expect(run(envOf()).checkIn?.fineZoneSide).toBe("right");
    expect(run(envOf({ support: "right" })).checkIn?.fineZoneSide).toBe("left");
    const pain = envOf({ pain: ["shoulder"] });
    expect(run(pain, { "pc_arm_pain_side:shoulder": "right" }).checkIn?.fineZoneSide).toBe("left");
    const lost = envOf({ conditions: ["upper_limb_unilateral"] });
    expect(run(lost, { pc_limb_arm_side: "right" }).checkIn?.fineZoneSide).toBe("left");
  });

  it("O34-1 (1): for SCI, the arm with the better pc_arm_function answer", () => {
    const env = sci({}, { setup: { sciT6: false }, firstCheck: false });
    expect(
      run(env, { "pc_arm_function:right": "bend_no_hold", "pc_arm_function:left": "bend_hold" }).checkIn
        ?.fineZoneSide,
    ).toBe("left");
    expect(
      run(env, { "pc_arm_function:right": "bend_hold", "pc_arm_function:left": "bend_hold" }).checkIn
        ?.fineZoneSide,
    ).toBe("right");
  });
});

describe("Q5: the arm curl load at the booth", () => {
  it("Q5: the booth runs the arm curl without weight on both arms, whatever the answers", () => {
    const o = run(envOf({}, { setting: "booth" }));
    expect(variantsOf(o, "arm_curl_30s", "left")).toEqual(["arm_only"]);
    expect(variantsOf(o, "arm_curl_30s", "right")).toEqual(["arm_only"]);
    const home = run(envOf());
    expect(variantsOf(home, "arm_curl_30s", "left")).toEqual([]);
  });
});

/* -------------------------------------------------------- Q9 chair gate */

describe("Q9: the chair gate at home", () => {
  const env = standing();

  it("Q9 (2): su_chair_gate is asked at home when the chair stand runs; su_same_chair from the second check (3)", () => {
    expect(setupQuestionsFor(env)).toEqual(["su_chair_gate"]);
    expect(setupQuestionsFor(standing({}, { firstCheck: false }))).toEqual([
      "su_chair_gate",
      "su_same_chair",
    ]);
    expect(setupQuestionsFor(standing({}, { setting: "booth" }))).toEqual([]);
    expect(setupQuestionsFor(envOf())).toEqual([]);
  });

  it("Q9 (2): no skips the chair stand today with chair_needed, with no substitute", () => {
    expect(evaluateSetupQuestions(env, { su_chair_gate: "no" })).toEqual({
      status: "proceed",
      skips: [{ testId: "chair_stand_30s", side: "none", reason: "chair_needed" }],
    });
    expect(evaluateSetupQuestions(env, { su_chair_gate: "yes" })).toEqual({ status: "proceed", skips: [] });
    expect(evaluateSetupQuestions(env, {})).toEqual({ status: "incomplete", skips: [] });
  });

  it("Q9 (3): the same chair answer: yes keeps the chair, no and not sure are stored as no", () => {
    const later = standing({}, { firstCheck: false });
    expect(evaluateSetupQuestions(later, { su_chair_gate: "yes", su_same_chair: "yes" }).sameChair).toBe(
      true,
    );
    expect(evaluateSetupQuestions(later, { su_chair_gate: "yes", su_same_chair: "no" }).sameChair).toBe(
      false,
    );
    expect(evaluateSetupQuestions(later, { su_chair_gate: "yes", su_same_chair: "unsure" }).sameChair).toBe(
      false,
    );
    expect(evaluateSetupQuestions(later, { su_chair_gate: "yes" }).status).toBe("incomplete");
  });
});

/* ----------------------------------------------------------- Q18 forms */

describe("Q18 and O45: which wording a question uses", () => {
  it("Q18: askFirstCheck at the first check for pc_change and the fell question of pc_steadi", () => {
    expect(questionForm(envOf(), {}, "pc_change").text).toBe("askFirstCheck");
    expect(questionForm(envOf({}, { firstCheck: false }), {}, "pc_change").text).toBe("ask");
    expect(questionForm(standing(), {}, "pc_steadi:fell").text).toBe("askFirstCheck");
    expect(questionForm(standing(), {}, "pc_steadi:worry").text).toBe("ask");
  });

  it("O45: the examples list of pc_change and pc_unwell at home only; the booth keeps one sentence", () => {
    expect(questionForm(envOf(), {}, "pc_unwell").examples).toBe(true);
    expect(questionForm(envOf(), {}, "pc_change").examples).toBe(true);
    expect(questionForm(envOf({}, { setting: "booth" }), {}, "pc_unwell").examples).toBe(false);
    expect(questionForm(envOf(), {}, "pc_ms_heat").examples).toBe(false);
  });

  it("O37: the chronic line may apply for a weaker side or the listed conditions (shown only once tested)", () => {
    expect(questionForm(envOf(), {}, "pc_urgent").chronicNote).toBe(false);
    expect(questionForm(envOf({ support: "left" }), {}, "pc_urgent").chronicNote).toBe(true);
    expect(questionForm(envOf({ conditions: ["parkinsons"] }), {}, "pc_urgent").chronicNote).toBe(true);
    expect(questionForm(envOf({ support: "left" }), {}, "pc_unwell").chronicNote).toBe(false);
  });

  it("Q18 (7): every day of item is asked at every check it applies to", () => {
    const everyTime = CHECK_DATA.precheckRules.everyTimeItems.map((s) => s.split(" ")[0] as PrecheckId);
    // A later home check of a standing person with SCI, MS, PD and arthritis and every flag due.
    const env = standing(
      {
        conditions: ["sci_incomplete", "ms", "parkinsons", "arthritis"],
        position: "standing",
        clearance: "yes",
      },
      {
        firstCheck: false,
        lastCheckLasting: true,
        faintReportedUnresolved: true,
        setup: { sciT6: true },
      },
    );
    const ids = new Set(
      visibleQuestions(env, fill(env, { pc_pain_now: 2, pc_change: "yes" })).map((q) => q.split(":")[0]),
    );
    for (const id of everyTime) {
      if (id === "pc_pressure_sore" || id === "pc_helper") continue; // side lean and home helper rules
      expect(ids.has(id), id).toBe(true);
    }
  });
});

/* ---------------------------------------------------------- O9 counter */

describe("O9: possibleQuestions", () => {
  it("O9: contains every visible question and only shrinks as answers come in", () => {
    const r = rng(909);
    for (let i = 0; i < 400; i++) {
      const env = randomEnv(r);
      const answers: Answers = {};
      let before = possibleQuestions(env, answers);
      expect(before.length).toBeGreaterThanOrEqual(visibleQuestions(env, answers).length);
      for (let step = 0; step < 60; step++) {
        const next = visibleQuestions(env, answers).find((id) => !(id in answers));
        if (!next) break;
        answers[next] = randomAnswer(r, next);
        const visible = visibleQuestions(env, answers);
        const now = possibleQuestions(env, answers);
        for (const v of visible) expect(now, `${v} ${JSON.stringify(env.ctx)}`).toContain(v);
        for (const p of now)
          expect(before, `${p} ${JSON.stringify(env.ctx)} ${JSON.stringify(answers)}`).toContain(p);
        before = now;
      }
    }
  });

  it("O9: counts the follow ups that can still open", () => {
    const env = envOf({}, { firstCheck: false, sideLeanDoneAtHome: true });
    const all = possibleQuestions(env, {});
    expect(all).toContain("pc_change_cleared");
    expect(all).toContain("pc_pain_worse");
    expect(all).toContain("pc_pain_areas");
    const settled = possibleQuestions(env, { pc_change: "no", pc_pain_now: 0 });
    expect(settled).not.toContain("pc_change_cleared");
    expect(settled).not.toContain("pc_pain_worse");
  });
});

/* ------------------------------------------------------------ O6 resume */

describe("O6: resume re-asks the day of questions", () => {
  it("O6 (2): asks pc_urgent, pc_unwell and pc_pain_now, and pc_pain_areas when pain is 1 or more", () => {
    expect(RESUME_QUESTION_IDS).toEqual(
      expect.arrayContaining(["pc_urgent", "pc_unwell", "pc_pain_now", "pc_pain_areas"]),
    );
    const env = envOf();
    expect(resumeQuestions(env, {}, ["arm_curl_30s"])).toEqual(["pc_urgent", "pc_unwell", "pc_pain_now"]);
    expect(resumeQuestions(env, { pc_pain_now: 2 }, ["arm_curl_30s"])).toEqual([
      "pc_urgent",
      "pc_unwell",
      "pc_pain_now",
      "pc_pain_areas",
    ]);
  });

  it("O6 (2): adds the SCI, PD and MS questions and, at home, pc_helper for the remaining tests", () => {
    const env = envOf(
      { conditions: ["sci_incomplete", "parkinsons", "ms"], position: "wheelchair" },
      { firstCheck: false, setup: { sciT6: true } },
    );
    const ids = resumeQuestions(env, {}, ["trunk_control_seated", "arm_curl_30s"]);
    expect(ids).toEqual(
      expect.arrayContaining([
        "pc_sci_ad_now",
        "pc_sci_ready",
        "pc_pd_on",
        "pc_ms_heat",
        "pc_helper:trunk_control_seated",
      ]),
    );
    expect(ids).not.toContain("pc_change");
    expect(ids).not.toContain("pc_helper:chair_stand_30s");
    const done = resumeQuestions(env, {}, ["arm_curl_30s"]);
    expect(done).not.toContain("pc_helper:trunk_control_seated");
  });

  it("O6 (2): every answer routes as usual", () => {
    const env = envOf();
    expect(evaluateResume(env, { pc_urgent: "yes" }, ["arm_curl_30s"], NOW).status).toBe("emergency");
    expect(evaluateResume(env, { pc_urgent: "no", pc_unwell: "yes" }, ["arm_curl_30s"], NOW)).toMatchObject({
      status: "postpone",
      reason: "unwell",
    });
    const ok = evaluateResume(
      env,
      { pc_urgent: "no", pc_unwell: "no", pc_pain_now: 0 },
      ["arm_curl_30s"],
      NOW,
    );
    expect(ok.status).toBe("proceed");
    const skip = evaluateResume(
      env,
      { pc_urgent: "no", pc_unwell: "no", pc_pain_now: 6, pc_pain_areas: { elbow_left: 6 } },
      ["arm_curl_30s"],
      NOW,
    );
    expect(skip.status).toBe("proceed");
    expect(skipOf(skip, "arm_curl_30s", "left")).toBe("pain_today");
  });
});

/* -------------------------------------------------------- Q31 (4) speech */

describe("Q31 (4) and O5: a spoken check in answer", () => {
  const cases: [string, "ar" | "en", "fine" | "not_fine" | "no_answer"][] = [
    ["أنا بخير", "ar", "fine"],
    ["انا بخير", "ar", "fine"],
    ["بخير", "ar", "fine"],
    ["أنا طيب", "ar", "fine"],
    ["نعم، أنا بخير", "ar", "fine"],
    ["نعم", "ar", "no_answer"],
    ["تمام", "ar", "no_answer"],
    ["إيه", "ar", "no_answer"],
    ["الحمد لله", "ar", "no_answer"],
    ["نعم، ساعدني", "ar", "not_fine"],
    ["أنا بخير لا", "ar", "not_fine"],
    ["إسعاف", "ar", "not_fine"],
    ["الحقوني", "ar", "not_fine"],
    ["", "ar", "no_answer"],
    ["I'm fine", "en", "fine"],
    ["I’m OK", "en", "fine"],
    ["i am ok", "en", "fine"],
    ["Yes, I'm fine.", "en", "fine"],
    ["yes", "en", "no_answer"],
    ["okay", "en", "no_answer"],
    ["I know", "en", "no_answer"],
    ["no", "en", "not_fine"],
    ["I'm fine, no problem", "en", "not_fine"],
    ["help", "en", "not_fine"],
    ["helpful", "en", "no_answer"],
    // A negated fine phrase is never fine (R3C-12): a false fine is the one dangerous error (O5), so it
    // reads as not fine.
    ["لست بخير", "ar", "not_fine"],
    ["لستُ بخير", "ar", "not_fine"],
    ["أنا لست بخير", "ar", "not_fine"],
    ["ما أنا بخير", "ar", "not_fine"],
    ["مو بخير", "ar", "not_fine"],
    ["أنا مو بخير", "ar", "not_fine"],
    ["مش بخير", "ar", "not_fine"],
    ["مب بخير", "ar", "not_fine"],
    ["ماني بخير", "ar", "not_fine"],
    ["مانيش بخير", "ar", "not_fine"],
    ["غير بخير", "ar", "not_fine"],
    ["أنا مو طيب", "ar", "not_fine"],
    // R3C-12: a negator anywhere in the utterance («ما») reads as not fine, the safe error.
    ["ما شاء الله، أنا بخير", "ar", "not_fine"],
    ["I'm not fine", "en", "not_fine"],
    ["I am not OK", "en", "not_fine"],
    ["I’m not OK", "en", "not_fine"],
  ];
  it.each(cases)("Q31 (4): %s (%s) reads %s", (text, lang, expected) => {
    expect(spokenCheckInAnswer(text, lang)).toBe(expected);
  });
});

/* ---------------------------------------------- helpers kept consistent */

describe("Q18 (7) and 2.1: the answers of the day are never stored", () => {
  it("Q32: the stored fields stay within the data map", () => {
    const r = rng(3232);
    const allowed = new Set([
      "painNow",
      "setup.painSides",
      "setup.limbLoss",
      "setup.sciT6",
      "fingerprint.armProsthesis",
      "fingerprint.legProsthesis",
      "fingerprint.pdState",
      "fingerprint.pdDoseBucket",
      "fingerprint.helperPresent",
      "changeCleared",
      "changeReported",
    ]);
    for (let i = 0; i < 300; i++) {
      const env = { ...randomEnv(r), faintReportedUnresolved: r.next() < 0.3 };
      const answers: Answers = {};
      for (let k = 0; k < 8; k++)
        for (const id of visibleQuestions(env, answers))
          if (!(id in answers)) answers[id] = randomAnswer(r, id);
      const o = evaluatePrecheck(env, answers, NOW);
      for (const k of Object.keys(o.stored)) expect(allowed.has(k), k).toBe(true);
    }
  });
});

describe("O37 and O29: the chronic line and partial answers", () => {
  it("O37: the end of check chronic line applies for a weaker side or the listed conditions", () => {
    expect(endOfCheckChronicNote({ ctx: envOf().ctx })).toBe(false);
    expect(endOfCheckChronicNote({ ctx: envOf({ support: "right" }).ctx })).toBe(true);
    for (const c of ["stroke", "sci_complete", "sci_incomplete", "ms", "cerebral_palsy", "parkinsons"])
      expect(endOfCheckChronicNote({ ctx: envOf({ conditions: [c] }).ctx }), c).toBe(true);
    expect(endOfCheckChronicNote({ ctx: envOf({ conditions: ["arthritis"] }).ctx })).toBe(false);
  });

  it("O29: a postpone or an emergency is returned with the other questions still unanswered", () => {
    const env = envOf({ conditions: ["ms"] });
    expect(evaluatePrecheck(env, { pc_urgent: "yes" }, NOW).status).toBe("emergency");
    expect(evaluatePrecheck(env, { pc_urgent: "no", pc_ms_heat: "yes" }, NOW)).toMatchObject({
      status: "postpone",
      reason: "ms_heat",
      lock: { until: "60_min" },
    });
  });
});

describe("O6 (2): resume keeps the helpers of the frozen protocol", () => {
  it("O6 (2): a chair stand helper set by an answer earlier today is asked again on resume", () => {
    // pc_steadi yes earlier today made the chair stand need a helper; the resume does not ask pc_steadi.
    const env = standing({}, { firstCheck: false });
    const remaining = [
      { testId: "chair_stand_30s" as TestId, helperRequired: true },
      "arm_curl_30s" as TestId,
    ];
    expect(resumeQuestions(env, {}, remaining)).toContain("pc_helper:chair_stand_30s");
    expect(resumeQuestions(env, {}, ["chair_stand_30s", "arm_curl_30s"])).not.toContain(
      "pc_helper:chair_stand_30s",
    );
    const no = evaluateResume(
      env,
      { pc_urgent: "no", pc_unwell: "no", pc_pain_now: 0, "pc_helper:chair_stand_30s": "no" },
      remaining,
      NOW,
    );
    expect(no.status).toBe("proceed");
    expect(skipOf(no, "chair_stand_30s", "none")).toBe("helper_needed");
  });

  it("O6 (2): at the booth no helper is asked on resume", () => {
    const env = standing({}, { setting: "booth", firstCheck: false });
    expect(resumeQuestions(env, {}, [{ testId: "chair_stand_30s", helperRequired: true }])).not.toContain(
      "pc_helper:chair_stand_30s",
    );
  });
});
