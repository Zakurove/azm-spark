/**
 * Movement check API (contract v2, sections E and G): the full check of a wheelchair user after a
 * stroke, postpones and locks, the emergency and AD paths, the stop list and the between tests
 * question, ownership, strict validation of every body, the frozen protocol, replace while open,
 * staff booth mode, the start limit, and what reaches the database (data map fields only, and a
 * safety log without any user id).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { runMigrations } from "../server/db/migrate";
import { currentLock, setLock } from "../server/modules/assessments/store";
import { DATA_MAP_KEYS, visibleQuestions } from "../src/medical/precheck";
import type { ProtocolItem } from "../src/medical/assessment";
import {
  DAY,
  DEVICE,
  HOUR,
  T0,
  WHEELCHAIR_STROKE,
  answersFor,
  envFromContext,
  intakeOf,
  itemOf,
  login,
  member,
  postResults,
  register,
  resultBody,
  start,
  startApi,
  type Harness,
} from "./check-api-harness";

/** Start of the next calendar day in Asia/Riyadh after T0 (2026-10-05 00:00 +03:00). */
const NEXT_DAY = Date.UTC(2026, 9, 4, 21, 0, 0);
/**
 * A next day lock set at T0 as the client sees it (Q25 (c): no reason id; Q33 (4): {when}).
 * `releasable` is true for recent_change only.
 */
const nextDayLock = (releasable = false) => ({
  until: NEXT_DAY,
  releasableByClearance: releasable,
  when: { token: "nextDay_midnight" },
});
const FIRST_VALUES = {
  "shoulder_abduction:right": 100,
  "shoulder_abduction:left": 90,
  "trunk_control_seated:right": 20,
  "trunk_control_seated:left": 18,
  "arm_curl_30s:left": 10,
  "arm_curl_30s:right": 12,
};

let h: Harness;
const setTime = (t: number) => vi.setSystemTime(t);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.AZM_BOOTH_CODE;
  delete process.env.AZM_BOOTH_DATES;
});

describe("a wheelchair user after a stroke: consent, context, check, retest, progress", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("runs the whole check twice and shows the verdicts of the second", async () => {
    let cookie = await member(h, "faisal@example.test", WHEELCHAIR_STROKE, false);

    // Context before consent: the check context from the intake and nothing stored yet.
    const c0 = await h.call("/assessments/context", undefined, cookie);
    expect(c0.status).toBe(200);
    expect(c0.data).toMatchObject({
      ctx: { position: "wheelchair", support: "left", conditions: ["stroke"], clearance: "yes" },
      setting: "home",
      setup: null,
      firstCheck: true,
      unresolvedChangeReported: false,
      lastCheckLasting: false,
      sideLeanDoneAtHome: false,
      baseTests: ["shoulder_abduction", "trunk_control_seated", "arm_curl_30s"],
      lock: null,
      retestDue: null,
      earliestNext: null,
      followUpDue: false,
      consent: false,
      consentVersion: 1,
      baselineRanges: {},
    });

    // The consent gate comes before anything is evaluated or stored.
    const answers = await answersFor(h, cookie);
    expect((await h.call("/assessments", { answers, device: DEVICE }, cookie)).data).toEqual({
      error: "CONSENT_REQUIRED",
    });
    expect((await h.call("/consents", { kind: "movement_check", version: 2 }, cookie)).data).toEqual({
      error: "CONSENT_VERSION",
      version: 1,
    });
    const consent = await h.call("/consents", { kind: "movement_check", version: 1 }, cookie);
    expect(consent.data).toEqual({ kind: "movement_check", version: 1, acceptedAt: T0 });
    expect((await h.call("/assessments/context", undefined, cookie)).data.consent).toBe(true);

    // Start: the server evaluates the pre-check itself and freezes the protocol.
    const s1 = await h.call("/assessments", { answers, device: DEVICE, faceCovered: false }, cookie);
    expect(s1.status).toBe(200);
    expect(s1.data).toMatchObject({
      kind: "baseline",
      setting: "home",
      helperRequired: ["trunk_control_seated"],
    });
    expect(s1.data.warnings).toEqual(
      expect.arrayContaining(["scr_helper_brief_trunk", "warn_weak_shoulder"]),
    );
    const protocol: ProtocolItem[] = s1.data.protocol;
    expect(protocol.map((i) => `${i.testId}:${i.side}`)).toEqual([
      "shoulder_abduction:right",
      "shoulder_abduction:left",
      "trunk_control_seated:right",
      "trunk_control_seated:left",
      "arm_curl_30s:left",
      "arm_curl_30s:right",
      "chair_stand_30s:none",
    ]);
    expect(itemOf(protocol, "arm_curl_30s", "left").variant).toBe("arm_only");
    expect(itemOf(protocol, "shoulder_abduction", "left").band).toBe("wide");
    expect(itemOf(protocol, "trunk_control_seated", "right").helperRequired).toBe(true);
    expect(itemOf(protocol, "chair_stand_30s", "none").skipped).toBe("position_seated");

    await postResults(h, cookie, s1.data.id, protocol, FIRST_VALUES);
    setTime(T0 + 20 * 60 * 1000);
    const done1 = await h.call(`/assessments/${s1.data.id}/complete`, {}, cookie);
    expect(done1.status).toBe(200);
    expect(done1.data).toEqual({ id: s1.data.id, completed: T0 + 20 * 60 * 1000 });

    const list = await h.call("/assessments", undefined, cookie);
    expect(list.data.assessments).toHaveLength(1);
    expect(list.data.assessments[0]).toMatchObject({ id: s1.data.id, status: "completed", kind: "baseline" });
    expect(list.data.assessments[0].results).toHaveLength(6);
    const trunk = list.data.assessments[0].results.filter((r: any) => r.testId === "trunk_control_seated");
    // Both sides of the side lean in one check share one chair id; sameChair itself is not stored.
    expect(trunk[0].detail.chair).toMatch(/^[0-9a-f]{8}$/);
    expect(trunk[1].detail.chair).toBe(trunk[0].detail.chair);
    expect(trunk[0].detail.sameChair).toBeUndefined();

    // First check: starting points only, no verdict.
    const p1 = await h.call("/progress", undefined, cookie);
    expect(p1.data.tests).toHaveLength(6);
    for (const t of p1.data.tests) {
      expect(t.verdict).toBeNull();
      expect(t.firstResult).toBe(true);
      expect(t.current).toBe(true);
    }
    expect(p1.data.retestDue).toBe(T0 + 20 * 60 * 1000 + 28 * DAY);

    // Too soon for another check (48 hours), and the D-009 range of the arm curl series is served.
    const c1 = await h.call("/assessments/context", undefined, cookie);
    expect(c1.data.firstCheck).toBe(false);
    expect(c1.data.sideLeanDoneAtHome).toBe(true);
    expect(Object.values(c1.data.baselineRanges).sort()).toEqual([
      [158, 48],
      [160, 50],
    ]);
    const soon = await start(h, cookie);
    expect(soon.status).toBe(409);
    expect(soon.data).toEqual({ error: "TOO_SOON", until: T0 + 20 * 60 * 1000 + 48 * HOUR });

    // The re-test, 29 days later.
    setTime(T0 + 29 * DAY);
    cookie = await login(h, "faisal@example.test");
    const c2 = await h.call("/assessments/context", undefined, cookie);
    expect(c2.data.retestDue).toBeLessThan(Date.now());
    const s2 = await start(h, cookie);
    expect(s2.status).toBe(200);
    expect(s2.data.kind).toBe("retest");
    await postResults(h, cookie, s2.data.id, s2.data.protocol, {
      "shoulder_abduction:right": 130,
      "shoulder_abduction:left": 95,
      "trunk_control_seated:right": 24,
      "trunk_control_seated:left": 22,
      "arm_curl_30s:left": 11,
      "arm_curl_30s:right": 20,
    });
    // Q23 (7): the end of check question, general form (no one sided drop), before the results.
    expect((await h.call(`/assessments/${s2.data.id}/end`, undefined, cookie)).data).toEqual({
      question: "ec_symptoms",
      side: null,
      chronicNote: true,
    });
    expect((await h.call(`/assessments/${s2.data.id}/complete`, {}, cookie)).status).toBe(200);

    const p2 = await h.call("/progress", undefined, cookie);
    const view = (testId: string, side: string) =>
      p2.data.tests.find((t: any) => t.testId === testId && t.side === side && t.current);
    expect(view("shoulder_abduction", "right")).toMatchObject({
      verdict: "higher",
      change: 30,
      band: 20,
      bandKind: "wide",
      baseline: { value: 100 },
      latest: { value: 130 },
      unit: "deg",
      better: "higher",
      labels: { verdict: { en: "Higher than your starting point" } },
    });
    expect(view("shoulder_abduction", "left")).toMatchObject({ verdict: "same", change: 5 });
    expect(view("trunk_control_seated", "right")).toMatchObject({ verdict: null, startingPointSet: true });
    // Q27: the first re-test of an arm curl series widens the band by 1 (4 becomes 5).
    expect(view("arm_curl_30s", "left")).toMatchObject({
      verdict: "same",
      change: 1,
      band: 5,
      variant: "arm_only",
    });
    expect(view("arm_curl_30s", "right")).toMatchObject({
      verdict: "higher",
      change: 8,
      band: 5,
      variant: "held",
    });
    // Verdicts are higher, same or lower, never "better", and no label uses a forbidden stem.
    for (const t of p2.data.tests) expect([null, "higher", "same", "lower"]).toContain(t.verdict);
    expect(JSON.stringify(p2.data.tests.map((t: any) => t.labels))).not.toMatch(
      /better|worse|improv|declin/i,
    );
  });
});

describe("postpones, locks and the change question", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("feeling unwell postpones until the next day in Riyadh, and nothing is stored", async () => {
    const cookie = await member(h, "unwell@example.test", intakeOf());
    const r = await start(h, cookie, { pc_unwell: "yes" });
    expect(r.status).toBe(409);
    expect(r.data).toEqual({
      error: "POSTPONE",
      status: "postpone",
      reason: "unwell",
      screen: "scr_postpone_unwell",
      alsoShow: [],
      lock: nextDayLock(),
    });
    expect((await h.call("/assessments", undefined, cookie)).data.assessments).toEqual([]);
    expect((await h.call("/assessments/context", undefined, cookie)).data.lock).toEqual(nextDayLock());
    // Different answers the same day cannot get past the lock.
    const again = await start(h, cookie);
    expect(again.data).toEqual({ error: "LOCKED", ...nextDayLock() });
    setTime(NEXT_DAY - 1);
    expect((await start(h, cookie)).data.error).toBe("LOCKED");
    setTime(NEXT_DAY);
    expect((await start(h, cookie)).status).toBe(200);
    expect((await h.call("/assessments/context", undefined, cookie)).data.lock).toBeNull();
  });

  it("a change without clearance locks until cleared, and a later yes releases the lock at once", async () => {
    const cookie = await member(h, "change@example.test", intakeOf());
    const r = await start(h, cookie, { pc_change: "yes", pc_change_cleared: "no" });
    expect(r.data).toMatchObject({
      error: "POSTPONE",
      reason: "recent_change",
      screen: "scr_postpone_care",
      lock: nextDayLock(true),
    });
    setTime(T0 + HOUR);
    const c = await h.call("/assessments/context", undefined, cookie);
    expect(c.data.unresolvedChangeReported).toBe(true);
    expect(c.data.lock.releasableByClearance).toBe(true);
    // pc_change is no longer asked; pc_change_cleared is asked directly.
    const answers = await answersFor(h, cookie, { pc_change_cleared: "yes" });
    expect(answers.pc_change).toBeUndefined();
    const s = await h.call("/assessments", { answers, device: DEVICE }, cookie);
    expect(s.status).toBe(200);
    const after = await h.call("/assessments/context", undefined, cookie);
    expect(after.data.unresolvedChangeReported).toBe(false);
    expect(after.data.lock).toBeNull();
    const db = h.inspect();
    const row = db.prepare("SELECT precheck FROM assessments WHERE id=?").get(s.data.id) as {
      precheck: string;
    };
    expect(JSON.parse(row.precheck).changeCleared).toBe("2026-10-04");
  });

  it("an uncleared change survives the end of its lock: the next day asks for clearance again", async () => {
    const cookie = await member(h, "change2@example.test", intakeOf());
    await start(h, cookie, { pc_change: "yes", pc_change_cleared: "no" });
    setTime(NEXT_DAY + HOUR);
    const next = await login(h, "change2@example.test");
    const c = await h.call("/assessments/context", undefined, next);
    expect(c.data.lock).toBeNull();
    expect(c.data.unresolvedChangeReported).toBe(true);
    // Answering no to pc_change is not possible: it is not asked, and a no to clearance locks again.
    const r = await start(h, next, { pc_change: "no", pc_change_cleared: "no" });
    expect(r.data.reason).toBe("recent_change");
  });

  it("an MS heat postpone locks for 60 minutes", async () => {
    const cookie = await member(h, "ms@example.test", intakeOf({ conditions: ["ms"] }));
    const r = await start(h, cookie, { pc_ms_heat: "yes" });
    expect(r.data).toMatchObject({
      reason: "ms_heat",
      lock: { until: T0 + HOUR, releasableByClearance: false },
    });
    setTime(T0 + HOUR - 1);
    expect((await start(h, cookie)).data.error).toBe("LOCKED");
    setTime(T0 + HOUR);
    expect((await start(h, cookie)).status).toBe(200);
  });

  it("7.2-8: the SCI readiness list postpones without a lock on not yet; all done goes ahead at once", async () => {
    const cookie = await member(
      h,
      "sci@example.test",
      intakeOf({ conditions: ["sci_incomplete"], mobility: "wheelchair", clearance: "yes" }),
    );
    // The list is asked for an injury at T6 or higher, or when the level is not known.
    const r = await start(h, cookie, { pc_sci_level: "unsure", pc_sci_ready: "not_yet" });
    expect(r.data).toMatchObject({
      reason: "sci_ready",
      screen: "scr_postpone_sci",
      lock: null,
    });
    expect((await h.call("/assessments/context", undefined, cookie)).data.lock).toBeNull();
    const ok = await start(h, cookie, { pc_sci_level: "unsure", pc_sci_ready: "done" });
    expect(ok.status).toBe(200);
    expect(ok.data.warnings).toContain("warn_sci_t6");
  });

  it("a lasting next day answer asks pc_after_last at the next check; no postpones, yes resolves it", async () => {
    let cookie = await member(h, "lasting@example.test", intakeOf());
    const s = await start(h, cookie);
    await postResults(h, cookie, s.data.id, s.data.protocol, {
      "shoulder_abduction:right": 120,
      "shoulder_abduction:left": 118,
      "trunk_control_seated:right": 20,
      "trunk_control_seated:left": 20,
      "arm_curl_30s:right": 14,
      "arm_curl_30s:left": 13,
    });
    await h.call(`/assessments/${s.data.id}/complete`, {}, cookie);
    // Not due before 24 hours (O38).
    expect((await h.call("/assessments/after", { answer: "usual" }, cookie)).data).toEqual({
      error: "NOT_DUE",
    });
    setTime(T0 + 13 * HOUR);
    expect((await h.call("/assessments/context", undefined, cookie)).data.followUpDue).toBe(false);
    setTime(T0 + 25 * HOUR);
    expect((await h.call("/assessments/context", undefined, cookie)).data.followUpDue).toBe(true);
    expect((await h.call("/assessments/after", { answer: "sore" }, cookie)).data).toEqual({
      error: "AFTER_INVALID",
      field: "answer",
    });
    const after = await h.call("/assessments/after", { answer: "lasting" }, cookie);
    expect(after.data).toEqual({ recorded: true, screen: "scr_after_lasting", lastingUnresolved: true });
    expect((await h.call("/assessments/after", { answer: "usual" }, cookie)).data.error).toBe("NOT_DUE");

    setTime(T0 + 3 * DAY);
    cookie = await login(h, "lasting@example.test");
    const c = await h.call("/assessments/context", undefined, cookie);
    expect(c.data.lastCheckLasting).toBe(true);
    const no = await start(h, cookie, { pc_after_last: "no" });
    expect(no.data).toMatchObject({ reason: "after_last", screen: "scr_postpone_care" });
    setTime(T0 + 4 * DAY);
    cookie = await login(h, "lasting@example.test");
    const yes = await start(h, cookie, { pc_after_last: "yes" });
    expect(yes.status).toBe(200);
    expect((await h.call("/assessments/context", undefined, cookie)).data.lastCheckLasting).toBe(false);
    const db = h.inspect();
    const kept = db.prepare("SELECT precheck FROM assessments WHERE id=?").get(s.data.id) as {
      precheck: string;
    };
    expect(JSON.parse(kept.precheck)["assessment.followUp"]).toBe("lasting");
  });
});

describe("emergency and autonomic dysreflexia", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("an urgent symptom opens the emergency screen, locks the day and wins over every other answer", async () => {
    const cookie = await member(h, "urgent@example.test", intakeOf());
    const r = await start(h, cookie, { pc_urgent: "yes", pc_unwell: "yes", pc_pain_now: 9 });
    expect(r.status).toBe(409);
    expect(r.data).toEqual({
      error: "POSTPONE",
      status: "emergency",
      reason: "urgent",
      screen: "scr_emergency",
      alsoShow: [],
      lock: nextDayLock(),
    });
    expect((await h.call("/assessments", undefined, cookie)).data.assessments).toEqual([]);
    expect((await start(h, cookie)).data).toEqual({ error: "LOCKED", ...nextDayLock() });
  });

  it("with a spinal cord injury the emergency screen also shows the AD steps", async () => {
    const cookie = await member(
      h,
      "sci-urgent@example.test",
      intakeOf({ conditions: ["sci_complete"], mobility: "wheelchair", clearance: "yes" }),
    );
    const r = await start(h, cookie, { pc_urgent: "yes" });
    expect(r.data).toMatchObject({ status: "emergency", screen: "scr_emergency", alsoShow: ["scr_ad"] });
  });

  it("AD signs now start the AD response and lock the day", async () => {
    const cookie = await member(
      h,
      "ad@example.test",
      intakeOf({ conditions: ["sci_complete"], mobility: "wheelchair", clearance: "yes" }),
    );
    const r = await start(h, cookie, { pc_sci_level: "yes", pc_sci_ad_now: "yes" });
    expect(r.data).toMatchObject({
      status: "ad",
      reason: "ad",
      screen: "scr_ad",
      lock: nextDayLock(),
    });
  });
});

describe("the stop list and the between tests question", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("choice and tiredness keep the check open; pain asks bt_pain_after; AD signs need SCI", async () => {
    const cookie = await member(h, "stop@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    const id = s.data.id;
    expect((await h.call(`/assessments/${id}/stop`, { option: "choice" }, cookie)).data).toEqual({
      option: "choice",
      screen: null,
      alsoShow: [],
      endsCheck: false,
      lock: null,
      reason: "by_choice",
      then: null,
      afterRest: false,
    });
    expect((await h.call(`/assessments/${id}/stop`, { option: "tired" }, cookie)).data).toMatchObject({
      endsCheck: false,
      reason: "stopped_symptom",
      afterRest: true,
    });
    expect((await h.call(`/assessments/${id}/stop`, { option: "pain" }, cookie)).data).toMatchObject({
      endsCheck: false,
      then: "bt_pain_after",
    });
    expect((await h.call(`/assessments/${id}/stop`, { option: "ad_signs" }, cookie)).data).toEqual({
      error: "STOP_INVALID",
      field: "option",
    });
    expect((await h.call(`/assessments/${id}/stop`, { option: "dizzy" }, cookie)).status).toBe(400);
    expect((await h.call(`/assessments/${id}/stop`, { option: "choice", note: "x" }, cookie)).data).toEqual({
      error: "STOP_INVALID",
      field: "body",
    });
    // The skipped test takes the reason as a result without a score.
    const item = itemOf(s.data.protocol, "shoulder_abduction", "right");
    const skipped = await h.call(
      `/assessments/${id}/results`,
      {
        ...resultBody(item, 0),
        value: null,
        attempts: [],
        nValid: 0,
        median: null,
        skippedReason: "by_choice",
      },
      cookie,
    );
    expect(skipped.data).toEqual({ saved: true });
    expect((await h.call("/assessments", undefined, cookie)).data.assessments[0].status).toBe("open");
  });

  it("a fall in a wheelchair ends the check early with the seated fall steps and the day's lock", async () => {
    const cookie = await member(h, "fall@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    const item = itemOf(s.data.protocol, "shoulder_abduction", "right");
    await h.call(`/assessments/${s.data.id}/results`, resultBody(item, 100), cookie);
    const r = await h.call(`/assessments/${s.data.id}/stop`, { option: "fall" }, cookie);
    expect(r.data).toMatchObject({
      screen: "scr_fall_seated",
      endsCheck: true,
      lock: nextDayLock(),
    });
    const list = (await h.call("/assessments", undefined, cookie)).data.assessments;
    // Q25 (d): the ended reason does not name the stop option.
    expect(list[0]).toMatchObject({ status: "ended_early", endedReason: "stop", completed: null });
    // Results before the stop are kept; nothing more is stored; no new check today.
    expect(list[0].results).toHaveLength(1);
    const later = itemOf(s.data.protocol, "shoulder_abduction", "left");
    expect((await h.call(`/assessments/${s.data.id}/results`, resultBody(later, 90), cookie)).data).toEqual({
      error: "NOT_OPEN",
      status: "ended_early",
    });
    expect((await h.call(`/assessments/${s.data.id}/stop`, { option: "choice" }, cookie)).status).toBe(409);
    expect((await h.call(`/assessments/${s.data.id}/complete`, {}, cookie)).status).toBe(409);
    expect((await start(h, cookie)).data.error).toBe("LOCKED");
    // Kept results count in progress.
    expect((await h.call("/progress", undefined, cookie)).data.tests).toHaveLength(1);
  });

  it("chest pain in the stop list opens the emergency screen and ends the check", async () => {
    const cookie = await member(h, "chest@example.test", intakeOf());
    const s = await start(h, cookie);
    const r = await h.call(`/assessments/${s.data.id}/stop`, { option: "chest" }, cookie);
    expect(r.data).toMatchObject({
      screen: "scr_emergency",
      endsCheck: true,
      lock: nextDayLock(),
    });
  });

  it("a little more pain skips the remaining tests that load the same area; they take no result", async () => {
    const cookie = await member(h, "between@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    const { id, protocol } = s.data;
    await h.call(
      `/assessments/${id}/results`,
      resultBody(itemOf(protocol, "shoulder_abduction", "right"), 100),
      cookie,
    );
    const r = await h.call(
      `/assessments/${id}/between`,
      { testId: "shoulder_abduction", side: "right", answer: "more" },
      cookie,
    );
    expect(r.status).toBe(200);
    expect(r.data.status).toBe("skip");
    // The right arm curl loads the right shoulder too.
    expect(r.data.skips).toEqual(
      expect.arrayContaining([{ testId: "arm_curl_30s", side: "right", reason: "pain_more" }]),
    );
    expect(r.data.skips.every((k: any) => k.side !== "left")).toBe(true);
    const curl = itemOf(protocol, "arm_curl_30s", "right");
    expect((await h.call(`/assessments/${id}/results`, resultBody(curl, 12), cookie)).data).toEqual({
      error: "SKIPPED",
      reason: "pain_more",
    });
    const same = await h.call(
      `/assessments/${id}/between`,
      { testId: "shoulder_abduction", side: "left", answer: "same" },
      cookie,
    );
    expect(same.data).toEqual({ status: "continue", skips: [], screen: null, lock: null });
    expect(
      (
        await h.call(
          `/assessments/${id}/between`,
          { testId: "shoulder_abduction", side: "left", answer: "ok" },
          cookie,
        )
      ).data,
    ).toEqual({ error: "BETWEEN_INVALID", field: "answer" });
    expect(
      (
        await h.call(
          `/assessments/${id}/between`,
          { testId: "chair_stand_30s", side: "none", answer: "same" },
          cookie,
        )
      ).data,
    ).toEqual({ error: "BETWEEN_INVALID", field: "testId" });
    // Much more pain ends the check for today.
    const much = await h.call(
      `/assessments/${id}/between`,
      { testId: "trunk_control_seated", side: "right", answer: "much" },
      cookie,
    );
    expect(much.data).toEqual({
      status: "end",
      skips: [],
      screen: "scr_stop_pain",
      lock: nextDayLock(),
    });
    expect((await h.call("/assessments", undefined, cookie)).data.assessments[0]).toMatchObject({
      status: "ended_early",
      endedReason: "stop",
    });
  });
});

describe("ownership", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("never shows or changes another person's check", async () => {
    const a = await member(h, "owner-a@example.test", WHEELCHAIR_STROKE);
    const b = await member(h, "owner-b@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, a);
    const id = s.data.id;
    const item = itemOf(s.data.protocol, "shoulder_abduction", "right");
    expect((await h.call(`/assessments/${id}/results`, resultBody(item, 100), b)).data).toEqual({
      error: "NOT_FOUND",
    });
    expect((await h.call(`/assessments/${id}/stop`, { option: "chest" }, b)).status).toBe(404);
    expect(
      (
        await h.call(
          `/assessments/${id}/between`,
          { testId: "shoulder_abduction", side: "right", answer: "much" },
          b,
        )
      ).status,
    ).toBe(404);
    expect((await h.call(`/assessments/${id}/complete`, {}, b)).status).toBe(404);
    expect((await h.call("/assessments", undefined, b)).data.assessments).toEqual([]);
    expect((await h.call(`/assessments/${id}/results`, resultBody(item, 100), a)).status).toBe(200);
    await h.call(`/assessments/${id}/complete`, {}, a);
    expect((await h.call("/progress", undefined, b)).data.tests).toEqual([]);
    expect((await h.call("/progress", undefined, a)).data.tests).toHaveLength(1);
    // B's own check does not see or end A's, and A's lock does not reach B.
    await h.call(`/assessments/${(await start(h, b)).data.id}/stop`, { option: "chest" }, b);
    expect((await h.call("/assessments/context", undefined, a)).data.lock).toBeNull();
    // Without a session nothing answers.
    expect((await h.call("/assessments/context")).status).toBe(401);
    expect((await h.call(`/assessments/${id}/complete`, {})).status).toBe(401);
    expect((await h.call("/progress")).status).toBe(401);
  });
});

describe("strict validation", () => {
  let cookie: string, starter: string, id: string, protocol: ProtocolItem[];
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    h = await startApi();
    cookie = await member(h, "strict@example.test", WHEELCHAIR_STROKE);
    // The start cases run as another person, so they stay under the start limit.
    starter = await member(h, "strict-start@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    id = s.data.id;
    protocol = s.data.protocol;
    vi.useRealTimers();
  });
  afterAll(async () => {
    await h.close();
  });

  const abduction = () => resultBody(itemOf(protocol, "shoulder_abduction", "right"), 100);
  const curlLeft = () => resultBody(itemOf(protocol, "arm_curl_30s", "left"), 10);
  const skipBody = () => ({
    ...abduction(),
    value: null,
    attempts: [],
    nValid: 0,
    median: null,
    skippedReason: "quality",
  });
  const cases: [string, () => Record<string, unknown>, string][] = [
    ["an unknown key", () => ({ ...abduction(), comment: "felt fine" }), "comment"],
    ["the wrong unit", () => ({ ...abduction(), unit: "count" }), "unit"],
    ["another movement version", () => ({ ...abduction(), movementVersion: 2 }), "movementVersion"],
    ["an engine version with spaces", () => ({ ...abduction(), engineVersion: "e 1" }), "engineVersion"],
    ["an unknown pose model", () => ({ ...abduction(), poseModel: "ultra" }), "poseModel"],
    [
      "a reason only the server sets",
      () => ({ ...skipBody(), skippedReason: "pain_today" }),
      "skippedReason",
    ],
    ["an unknown reason", () => ({ ...skipBody(), skippedReason: "bored" }), "skippedReason"],
    ["a value above 180 degrees", () => ({ ...abduction(), value: 181 }), "value"],
    ["a value below 0", () => ({ ...abduction(), value: -1 }), "value"],
    ["a value that is not whole", () => ({ ...abduction(), value: 99.5 }), "value"],
    ["a value as text", () => ({ ...abduction(), value: "100" }), "value"],
    ["a value that is not the best attempt", () => ({ ...abduction(), value: 98 }), "value"],
    ["no value and no reason", () => ({ ...abduction(), value: null }), "value"],
    ["a skip with a value", () => ({ ...skipBody(), value: 100 }), "value"],
    ["a skip with attempts", () => ({ ...skipBody(), attempts: abduction().attempts }), "attempts"],
    ["a skip with valid attempts counted", () => ({ ...skipBody(), nValid: 1 }), "nValid"],
    ["a median out of bounds", () => ({ ...abduction(), median: 250 }), "median"],
    ["a median outside the valid attempts", () => ({ ...abduction(), median: 50 }), "median"],
    ["more valid attempts than allowed", () => ({ ...abduction(), nValid: 4 }), "nValid"],
    ["a valid count that does not match", () => ({ ...abduction(), nValid: 2 }), "nValid"],
    [
      "four attempts",
      () => ({ ...abduction(), attempts: [...abduction().attempts, { value: 1, valid: false }] }),
      "attempts",
    ],
    ["an attempt without valid", () => ({ ...abduction(), attempts: [{ value: 100 }] }), "attempts.valid"],
    [
      "an attempt with an unknown key",
      () => ({ ...abduction(), attempts: [{ value: 100, valid: true, note: "x" }] }),
      "attempts",
    ],
    [
      "an attempt out of bounds",
      () => ({ ...abduction(), attempts: [{ value: 400, valid: true }] }),
      "attempts.value",
    ],
    [
      "a valid attempt without a value",
      () => ({ ...abduction(), attempts: [{ value: null, valid: true }] }),
      "attempts.value",
    ],
    ["attempts that are not a list", () => ({ ...abduction(), attempts: {} }), "attempts"],
    ["a quality report without ok", () => ({ ...abduction(), quality: { fps: 28 } }), "quality.ok"],
    ["a failed quality gate with a score", () => ({ ...abduction(), quality: { ok: false } }), "quality.ok"],
    [
      "free text in the quality report",
      () => ({ ...abduction(), quality: { ok: true, note: "my shoulder hurt" } }),
      "quality.note",
    ],
    [
      "a quality report over 4 KB",
      () => ({
        ...abduction(),
        quality: {
          ok: true,
          list: Array(40).fill("x".repeat(39)),
          l2: Array(40).fill("y".repeat(39)),
          l3: Array(40).fill("z".repeat(39)),
        },
      }),
      "quality",
    ],
    ["an unknown detail key", () => ({ ...abduction(), detail: { mood: 3 } }), "detail.mood"],
    [
      "a detail value outside its list",
      () => ({ ...abduction(), detail: { reference: "wall" } }),
      "detail.reference",
    ],
    ["a chair id from the client", () => ({ ...abduction(), detail: { chair: "abc" } }), "detail.chair"],
    [
      "a staff count at home",
      () => ({ ...curlLeft(), detail: { ...curlLeft().detail, countSource: "staff" } }),
      "detail.countSource",
    ],
    [
      "a push hand outside the hands allowed stand",
      () => ({ ...abduction(), detail: { pushHand: "left" } }),
      "detail.pushHand",
    ],
    ["detail that is not an object", () => ({ ...abduction(), detail: [] }), "detail"],
    ["flags with spaces", () => ({ ...abduction(), flags: ["bent elbow"] }), "flags"],
    ["repeated flags", () => ({ ...abduction(), flags: ["inconsistent", "inconsistent"] }), "flags"],
    ["21 flags", () => ({ ...abduction(), flags: Array.from({ length: 21 }, (_, i) => `f${i}`) }), "flags"],
    ["a variant on the arm raise", () => ({ ...abduction(), variant: "held" }), "variant"],
    [
      "a weight on the arm the pre-check kept without weight",
      () => ({ ...curlLeft(), variant: "held" }),
      "variant",
    ],
    ["an unknown arm curl variant", () => ({ ...curlLeft(), variant: "band" }), "variant"],
    [
      "a load that does not fit the variant",
      () => ({ ...curlLeft(), detail: { ...curlLeft().detail, loadObject: "dumbbell" } }),
      "detail.loadObject",
    ],
  ];
  it.each(cases)("refuses %s", async (_, body, field) => {
    const r = await h.call(`/assessments/${id}/results`, body(), cookie);
    expect(r.status).toBe(400);
    expect(r.data).toEqual({ error: "RESULT_INVALID", field });
  });

  it("accepts the side details of the engine runners, unknown values included", async () => {
    const raise = {
      ...abduction(),
      detail: {
        reference: "trunk",
        bentElbow: "unknown",
        pastVertical: false,
        spreadDeg: 4,
        planeZ: "unknown",
        elbowDeg: 171,
        shrug: 0.021,
        trunkLeanAtPeak: 3.5,
      },
      flags: ["planeUnchecked"],
    };
    expect((await h.call(`/assessments/${id}/results`, raise, cookie)).data).toEqual({ saved: true });
    const lean = {
      ...resultBody(itemOf(protocol, "trunk_control_seated", "right"), 21),
      median: null,
      detail: {
        upright: 1.2,
        uprightSd: 0.4,
        band: 3,
        pivot: "fixed_pivot",
        contact: "unknown",
        censored: false,
        abortLimit: 40,
        returnSec: "unknown",
        shoulderShift: 0.12,
        armSupportLikely: false,
        wristSupport: "unknown",
        elbowDeg: 120,
        abort: "none",
        sameChair: false,
      },
      flags: ["contact_unknown", "fixed_pivot"],
    };
    expect((await h.call(`/assessments/${id}/results`, lean, cookie)).data).toEqual({ saved: true });
    // A person's own choice is never unknown.
    const curl = { ...curlLeft(), detail: { ...curlLeft().detail, countSource: "unknown" } };
    expect((await h.call(`/assessments/${id}/results`, curl, cookie)).data).toEqual({
      error: "RESULT_INVALID",
      field: "detail.countSource",
    });
  });

  it("refuses a test side outside the frozen protocol and a skipped protocol item", async () => {
    const base = abduction();
    expect((await h.call(`/assessments/${id}/results`, { ...base, side: "none" }, cookie)).data).toEqual({
      error: "NOT_IN_PROTOCOL",
    });
    expect(
      (await h.call(`/assessments/${id}/results`, { ...base, testId: "elbow_flexion" }, cookie)).data,
    ).toEqual({
      error: "NOT_IN_PROTOCOL",
    });
    const stand = resultBody(itemOf(protocol, "chair_stand_30s", "none"), 10);
    expect((await h.call(`/assessments/${id}/results`, stand, cookie)).data).toEqual({
      error: "SKIPPED",
      reason: "position_seated",
    });
    expect((await h.call(`/assessments/${id}/results`, [base], cookie)).status).toBe(400);
  });

  it("keeps the protocol frozen when the intake changes during the check", async () => {
    const changed = await h.call(
      "/intake",
      { ...WHEELCHAIR_STROKE, restrictions: ["no_overhead"] },
      cookie,
      "PUT",
    );
    expect(changed.status).toBe(200);
    expect((await h.call(`/assessments/${id}/results`, abduction(), cookie)).data).toEqual({ saved: true });
    const ctx = await h.call("/assessments/context", undefined, cookie);
    expect(ctx.data.baseTests).not.toContain("shoulder_abduction");
    await h.call("/intake", WHEELCHAIR_STROKE, cookie, "PUT");
  });

  const startCases: [string, (a: any) => Record<string, unknown>, string][] = [
    ["no answers", () => ({ device: DEVICE }), "answers"],
    ["answers as a list", () => ({ answers: [], device: DEVICE }), "answers"],
    ["an unknown question", (a) => ({ answers: { ...a, pc_mood: "yes" }, device: DEVICE }), "answers"],
    [
      "the setting as an answer",
      (a) => ({ answers: { ...a, pc_setting: "booth" }, device: DEVICE }),
      "answers",
    ],
    [
      "free text as an answer",
      (a) => ({ answers: { ...a, pc_unwell: "a bit tired today" }, device: DEVICE }),
      "answers",
    ],
    [
      "too many answers",
      (a) => ({
        answers: {
          ...a,
          ...Object.fromEntries(Array.from({ length: 81 }, (_, i) => [`pc_helper:t${i}`, "no"])),
        },
        device: DEVICE,
      }),
      "answers",
    ],
    ["no device", (a) => ({ answers: a }), "device"],
    ["a device with an extra key", (a) => ({ answers: a, device: { ...DEVICE, serial: "abc" } }), "device"],
    ["an unknown pose model", (a) => ({ answers: a, device: { ...DEVICE, model: "ultra" } }), "device.model"],
    ["an impossible aspect", (a) => ({ answers: a, device: { ...DEVICE, aspect: 10 } }), "device.aspect"],
    ["zero fps", (a) => ({ answers: a, device: { ...DEVICE, fps: 0 } }), "device.fps"],
    [
      "an engine version with spaces",
      (a) => ({ answers: a, device: { ...DEVICE, engineVersion: "e 1" } }),
      "device.engineVersion",
    ],
    ["an unknown setting", (a) => ({ answers: a, device: DEVICE, setting: "gym" }), "setting"],
    [
      "a booth code that is not text",
      (a) => ({ answers: a, device: DEVICE, setting: "booth", boothCode: 1234 }),
      "boothCode",
    ],
    ["faceCovered as text", (a) => ({ answers: a, device: DEVICE, faceCovered: "no" }), "faceCovered"],
    ["an unknown key", (a) => ({ answers: a, device: DEVICE, outcome: "proceed" }), "outcome"],
  ];
  it.each(startCases)("refuses a start with %s", async (_, body, field) => {
    const answers = await answersFor(h, starter);
    const r = await h.call("/assessments", body(answers), starter);
    expect(r.status).toBe(400);
    expect(r.data).toEqual({ error: "START_INVALID", field });
  });

  it("refuses a start with a visible question left unanswered, and never trusts a client outcome", async () => {
    const answers = await answersFor(h, cookie);
    delete answers.pc_urgent;
    expect((await h.call("/assessments", { answers, device: DEVICE }, cookie)).data).toEqual({
      error: "PRECHECK_INCOMPLETE",
    });
    // An answer that is not one of the options counts as not answered.
    const odd = await answersFor(h, cookie, { pc_unwell: "maybe" });
    expect((await h.call("/assessments", { answers: odd, device: DEVICE }, cookie)).data.error).toBe(
      "PRECHECK_INCOMPLETE",
    );
  });

  it("refuses consent bodies that do not fit", async () => {
    expect((await h.call("/consents", { kind: "marketing", version: 1 }, cookie)).data).toEqual({
      error: "CONSENT_INVALID",
      field: "kind",
    });
    expect((await h.call("/consents", { kind: "movement_check", version: 1, at: 1 }, cookie)).data).toEqual({
      error: "CONSENT_INVALID",
      field: "body",
    });
    expect((await h.call("/consents/marketing", {}, cookie, "DELETE")).status).toBe(404);
    expect((await h.call("/assessments/after", { answer: "usual", extra: 1 }, cookie)).data).toEqual({
      error: "AFTER_INVALID",
      field: "body",
    });
  });
});

describe("replace while open, complete, consent revoked", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("a re-post replaces the result while the check is open, never after", async () => {
    const cookie = await member(h, "repost@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    const { id, protocol } = s.data;
    expect((await h.call(`/assessments/${id}/complete`, {}, cookie)).data).toEqual({ error: "NO_RESULTS" });
    const item = itemOf(protocol, "shoulder_abduction", "right");
    await h.call(`/assessments/${id}/results`, resultBody(item, 100), cookie);
    await h.call(`/assessments/${id}/results`, resultBody(item, 110), cookie);
    const results = (await h.call("/assessments", undefined, cookie)).data.assessments[0].results;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      testId: "shoulder_abduction",
      side: "right",
      value: 110,
      band: "wide",
    });
    expect((await h.call(`/assessments/${id}/complete`, {}, cookie)).status).toBe(200);
    expect((await h.call(`/assessments/${id}/results`, resultBody(item, 120), cookie)).data).toEqual({
      error: "NOT_OPEN",
      status: "completed",
    });
    expect((await h.call(`/assessments/${id}/complete`, {}, cookie)).data.error).toBe("NOT_OPEN");
  });

  it("a new start abandons the open check", async () => {
    const cookie = await member(h, "twice@example.test", WHEELCHAIR_STROKE);
    const first = await start(h, cookie);
    const second = await start(h, cookie);
    const list = (await h.call("/assessments", undefined, cookie)).data.assessments;
    expect(list.map((a: any) => [a.id, a.status])).toEqual([
      [second.data.id, "open"],
      [first.data.id, "abandoned"],
    ]);
  });

  it("revoking the consent ends the open check and gates new starts and results", async () => {
    const cookie = await member(h, "revoke@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    expect((await h.call("/consents/movement_check", {}, cookie, "DELETE")).data).toEqual({
      kind: "movement_check",
      revoked: true,
    });
    expect((await h.call("/assessments/context", undefined, cookie)).data.consent).toBe(false);
    const item = itemOf(s.data.protocol, "shoulder_abduction", "right");
    expect((await h.call(`/assessments/${s.data.id}/results`, resultBody(item, 100), cookie)).status).toBe(
      409,
    );
    expect((await start(h, cookie)).data).toEqual({ error: "CONSENT_REQUIRED" });
    await h.call("/consents", { kind: "movement_check", version: 1 }, cookie);
    expect((await start(h, cookie)).status).toBe(200);
  });

  it("a plan in review or a missing intake gives no check", async () => {
    const none = await register(h, "nointake@example.test");
    expect((await h.call("/assessments/context", undefined, none)).data).toEqual({ error: "PLAN_REQUIRED" });
    expect((await h.call("/assessments", { answers: {}, device: DEVICE }, none)).data).toEqual({
      error: "PLAN_REQUIRED",
    });
    const cardiac = await member(h, "cardiac@example.test", intakeOf({ conditions: ["cardiac"] }));
    const c = await h.call("/assessments/context", undefined, cardiac);
    expect(c.data).toMatchObject({ blocked: "cardiac", baseTests: [] });
    expect(c.data.ctx).toBeUndefined();
    expect((await h.call("/assessments", { answers: {}, device: DEVICE }, cardiac)).data).toEqual({
      error: "REVIEW",
      reason: "cardiac",
    });
  });
});

describe("staff booth mode", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  // Booth mode works only on the booth days (O17); these tests run on T0 and 3 days later.
  beforeEach(() => {
    process.env.AZM_BOOTH_DATES = "2026-10-04,2026-10-07";
  });
  afterAll(async () => {
    await h.close();
  });

  it("refuses booth mode without AZM_BOOTH_CODE, or with a wrong code, and accepts the right code", async () => {
    const cookie = await member(
      h,
      "booth@example.test",
      intakeOf({ mobility: "standing", clearance: "unsure" }),
    );
    delete process.env.AZM_BOOTH_CODE;
    const withoutEnv = await start(h, cookie, {}, { setting: "booth", boothCode: "anything" });
    expect(withoutEnv.data).toEqual({ error: "BOOTH_CODE" });
    process.env.AZM_BOOTH_CODE = "staff-code-8841";
    expect((await start(h, cookie, {}, { setting: "booth", boothCode: "staff-code-8842" })).data).toEqual({
      error: "BOOTH_CODE",
    });
    expect((await start(h, cookie, {}, { setting: "booth" })).data).toEqual({ error: "BOOTH_CODE" });
    expect((await start(h, cookie, {}, { setting: "booth", boothCode: "staff-code-884" })).status).toBe(403);
    const ok = await start(h, cookie, {}, { setting: "booth", boothCode: "staff-code-8841" });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ setting: "booth", kind: "baseline" });
    // At the booth the chair stand runs for clearance unsure (after the staff vitals); at home it does not.
    const stand = itemOf(ok.data.protocol, "chair_stand_30s", "none");
    expect(stand.skipped).toBeUndefined();
    expect(stand.helperRequired).toBeUndefined();
    // A staff corrected count is allowed at the booth only.
    const body = resultBody(stand, 11, {
      detail: {
        countSource: "staff",
        hSit: 0.5,
        rise: 0.3,
        footwear: "shoes",
        sameChair: false,
        armrests: false,
      },
    });
    expect((await h.call(`/assessments/${ok.data.id}/results`, body, cookie)).data).toEqual({ saved: true });
    await h.call(`/assessments/${ok.data.id}/complete`, {}, cookie);
    // The booth check is its own series: the home check is still a first check of the home series.
    setTime(T0 + 3 * DAY);
    const again = await login(h, "booth@example.test");
    const ctx = await h.call("/assessments/context", undefined, again);
    expect(ctx.data.firstCheck).toBe(true);
    expect(ctx.data.baseTests).not.toContain("chair_stand_30s");
    const home = await start(h, again);
    expect(home.data).toMatchObject({ setting: "home", kind: "baseline" });
    expect(itemOf(home.data.protocol, "chair_stand_30s", "none").skipped).toBe("clearance");
    const db = h.inspect();
    const rows = db.prepare("SELECT setting, kind FROM assessments ORDER BY started").all();
    expect(rows).toEqual([
      { setting: "booth", kind: "baseline" },
      { setting: "home", kind: "baseline" },
    ]);
  });

  it("serves the booth context on request, so a booth check asks what the server evaluates", async () => {
    process.env.AZM_BOOTH_CODE = "staff-code-3302";
    const intake = intakeOf({
      mobility: "standing",
      clearance: "unsure",
      conditions: ["upper_limb_unilateral"],
    });
    let cookie = await member(h, "booth-ctx@example.test", intake);
    expect((await h.call("/assessments/context?setting=gym", undefined, cookie)).data).toEqual({
      error: "CONTEXT_INVALID",
      field: "setting",
    });
    const home = await start(h, cookie, { pc_limb_arm_side: "left" });
    await postResults(h, cookie, home.data.id, home.data.protocol, { "shoulder_abduction:right": 120 });
    await h.call(`/assessments/${home.data.id}/complete`, {}, cookie);
    setTime(T0 + 3 * DAY);
    cookie = await login(h, "booth-ctx@example.test");
    const homeCtx = (await h.call("/assessments/context", undefined, cookie)).data;
    const boothCtx = (await h.call("/assessments/context?setting=booth", undefined, cookie)).data;
    expect(homeCtx).toMatchObject({
      setting: "home",
      firstCheck: false,
      setup: { limbLoss: { arm: "left" } },
    });
    expect(boothCtx).toMatchObject({ setting: "booth", firstCheck: true });
    expect(homeCtx.baseTests).not.toContain("chair_stand_30s");
    expect(boothCtx.baseTests).toContain("chair_stand_30s");
    // The first booth check asks the baseline setup questions again; home answers would be incomplete.
    const homeAnswers = await answersFor(h, cookie);
    const refused = await h.call(
      "/assessments",
      { answers: homeAnswers, device: DEVICE, setting: "booth", boothCode: "staff-code-3302" },
      cookie,
    );
    expect(refused.data).toEqual({ error: "PRECHECK_INCOMPLETE" });
    const ok = await start(
      h,
      cookie,
      { pc_limb_arm_side: "left" },
      { setting: "booth", boothCode: "staff-code-3302" },
    );
    expect(ok.data).toMatchObject({ setting: "booth", kind: "baseline" });
    expect(itemOf(ok.data.protocol, "chair_stand_30s", "none").variant).toBe("one_arm_cross");
  });

  it("refuses a staff count at home", async () => {
    const cookie = await member(h, "homecount@example.test", intakeOf({ mobility: "standing" }));
    const s = await start(h, cookie);
    const stand = itemOf(s.data.protocol, "chair_stand_30s", "none");
    const body = resultBody(stand, 11, { detail: { countSource: "staff" } });
    expect((await h.call(`/assessments/${s.data.id}/results`, body, cookie)).data).toEqual({
      error: "RESULT_INVALID",
      field: "detail.countSource",
    });
  });

  it("refuses a dumbbell at home for the conditions that must not use one", async () => {
    const cookie = await member(h, "pd@example.test", intakeOf({ conditions: ["parkinsons"] }));
    const s = await start(h, cookie);
    const curl = itemOf(s.data.protocol, "arm_curl_30s", "right");
    const body = resultBody(curl, 12, {
      variant: "held",
      detail: { loadObject: "dumbbell", loadKg: 2, compensated: 0, countSource: "auto" },
    });
    expect((await h.call(`/assessments/${s.data.id}/results`, body, cookie)).data).toEqual({
      error: "RESULT_INVALID",
      field: "detail.loadObject",
    });
    const bottle = {
      ...body,
      detail: { loadObject: "bottle", loadL: 1, compensated: 0, countSource: "auto" },
    };
    expect((await h.call(`/assessments/${s.data.id}/results`, bottle, cookie)).data).toEqual({ saved: true });
  });
});

describe("what the next check carries over", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("after the hands were needed to stand, the next check offers the hands allowed version", async () => {
    let cookie = await member(h, "hands@example.test", intakeOf({ mobility: "standing" }));
    const s1 = await start(h, cookie);
    const stand = itemOf(s1.data.protocol, "chair_stand_30s", "none");
    expect(stand.variant).toBe("standard");
    const skip = {
      ...resultBody(stand, 0),
      value: null,
      attempts: [],
      nValid: 0,
      median: null,
      skippedReason: "needed_arms",
    };
    expect((await h.call(`/assessments/${s1.data.id}/results`, skip, cookie)).data).toEqual({ saved: true });
    await h.call(`/assessments/${s1.data.id}/complete`, {}, cookie);
    setTime(T0 + 3 * DAY);
    cookie = await login(h, "hands@example.test");
    const ctx = (await h.call("/assessments/context", undefined, cookie)).data;
    expect(ctx.neededArmsLastStand).toBe(true);
    const s2 = await start(h, cookie);
    expect(s2.status).toBe(200);
    expect(itemOf(s2.data.protocol, "chair_stand_30s", "none")).toMatchObject({
      variant: "arms_assisted",
      helperRequired: true,
    });
    expect(s2.data.helperRequired).toContain("chair_stand_30s");
  });

  it("gives the dose bucket of the last completed check for the Parkinson timing note", async () => {
    let cookie = await member(h, "dose@example.test", intakeOf({ conditions: ["parkinsons"] }));
    expect((await h.call("/assessments/context", undefined, cookie)).data.lastPdDoseBucket).toBeNull();
    const s = await start(h, cookie, { pc_pd_dose: "2to3h" });
    await postResults(h, cookie, s.data.id, s.data.protocol, { "shoulder_abduction:right": 110 });
    await h.call(`/assessments/${s.data.id}/complete`, {}, cookie);
    setTime(T0 + 3 * DAY);
    cookie = await login(h, "dose@example.test");
    expect((await h.call("/assessments/context", undefined, cookie)).data.lastPdDoseBucket).toBe("2to3h");
    const next = await start(h, cookie);
    expect(next.data.warnings).toContain("warn_pd_timing");
  });

  it("asks the baseline setup questions again after the intake changes", async () => {
    let cookie = await member(h, "setup@example.test", intakeOf({ pain: ["shoulder"] }));
    const s = await start(h, cookie, { "pc_arm_pain_side:shoulder": "left" });
    await postResults(h, cookie, s.data.id, s.data.protocol, { "shoulder_abduction:right": 110 });
    await h.call(`/assessments/${s.data.id}/complete`, {}, cookie);
    setTime(T0 + 3 * DAY);
    cookie = await login(h, "setup@example.test");
    const kept = (await h.call("/assessments/context", undefined, cookie)).data;
    expect(kept.setup).toEqual({ painSides: ["left"] });
    expect(Object.keys(await answersFor(h, cookie))).not.toContain("pc_arm_pain_side:shoulder");
    await h.call("/intake", intakeOf({ pain: ["shoulder", "wrist"] }), cookie, "PUT");
    const changed = (await h.call("/assessments/context", undefined, cookie)).data;
    expect(changed.setup).toEqual({});
    const answers = await answersFor(h, cookie, {
      "pc_arm_pain_side:shoulder": "right",
      "pc_arm_pain_side:wrist": "right",
    });
    expect(Object.keys(answers)).toEqual(
      expect.arrayContaining(["pc_arm_pain_side:shoulder", "pc_arm_pain_side:wrist"]),
    );
    const s2 = await h.call("/assessments", { answers, device: DEVICE }, cookie);
    expect(s2.status).toBe(200);
    expect((await h.call("/assessments/context", undefined, cookie)).data.setup).toEqual({
      painSides: ["right"],
    });
  });
});

describe("the start limit", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("allows 20 check starts per person per day, whatever they answer", async () => {
    const cookie = await member(h, "limit@example.test", intakeOf());
    const other = await member(h, "limit-b@example.test", intakeOf());
    const answers = await answersFor(h, cookie);
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) {
      const body =
        i % 2 ? { answers, device: DEVICE } : { answers: { ...answers, pc_ms_heat: 1 }, device: {} };
      statuses.push((await h.call("/assessments", body, cookie)).status);
    }
    expect(statuses.every((s) => s !== 429)).toBe(true);
    expect((await h.call("/assessments", { answers, device: DEVICE }, cookie)).data).toEqual({
      error: "RATE_LIMIT",
    });
    // Another person is not affected, and the next day in Riyadh starts a new count.
    expect((await h.call("/assessments", { answers, device: DEVICE }, other)).status).toBe(200);
    setTime(NEXT_DAY);
    const next = await login(h, "limit@example.test");
    expect((await h.call("/assessments", { answers, device: DEVICE }, next)).status).not.toBe(429);
  });
});

describe("what reaches the database", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("keeps only the data map fields of the pre-check, never a raw answer", async () => {
    const cookie = await member(
      h,
      "datamap@example.test",
      intakeOf({
        conditions: ["upper_limb_unilateral", "arthritis"],
        pain: ["shoulder"],
        mobility: "seated",
      }),
    );
    const s = await start(
      h,
      cookie,
      {
        pc_pain_now: 3,
        pc_pain_worse: "no",
        pc_pain_areas: { shoulder_right: 3 },
        pc_limb_arm_side: "left",
        "pc_arm_pain_side:shoulder": "right",
      },
      { faceCovered: true },
    );
    expect(s.status).toBe(200);
    const db = h.inspect();
    const row = db
      .prepare("SELECT precheck, setup, series_meta, device FROM assessments WHERE id=?")
      .get(s.data.id) as Record<string, string>;
    const precheck = JSON.parse(row.precheck);
    const allowed: readonly string[] = DATA_MAP_KEYS;
    expect(Object.keys(precheck).every((k) => allowed.includes(k))).toBe(true);
    expect(precheck).toMatchObject({
      painNow: 3,
      "setup.painSides": ["right"],
      "setup.limbLoss": { arm: "left" },
      "fingerprint.faceCovered": true,
      "consent.acceptedAt": T0,
      "consent.version": 1,
    });
    const text = JSON.stringify(row);
    for (const raw of ["pc_", "shoulder_right", "pc_pain_worse", "urgent", "unwell"])
      expect(text).not.toContain(raw);
    expect(JSON.parse(row.setup)).toEqual({
      painSides: ["right"],
      limbLoss: { arm: "left" },
      armProsthesis: false,
    });
    expect(JSON.parse(row.series_meta)).toEqual({ position: "chair", poseModel: "full", intakeVersion: 1 });
    expect(JSON.parse(row.device)).toEqual(DEVICE);
    // The arm with limb loss is not measured.
    expect(itemOf(s.data.protocol, "shoulder_abduction", "left").skipped).toBe("limb_loss_arm");
  });

  it("counts postpones and stops per day, reason and setting, with no user id anywhere in the log", async () => {
    const a = await member(h, "log-a@example.test", intakeOf());
    const b = await member(h, "log-b@example.test", intakeOf());
    await start(h, a, { pc_unwell: "yes" });
    await start(h, b, { pc_unwell: "yes" });
    const c = await member(h, "log-c@example.test", intakeOf());
    const s = await start(h, c);
    await h.call(`/assessments/${s.data.id}/stop`, { option: "tired" }, c);
    await h.call(`/assessments/${s.data.id}/stop`, { option: "breath" }, c);
    const db = h.inspect();
    const rows = db.prepare("SELECT * FROM safety_events ORDER BY reason").all();
    // Q25 (a): by reason, by test id (or precheck) and by setting; a stop without its test side
    // counts under none.
    expect(rows).toEqual([
      { day: "2026-10-04", reason: "precheck:unwell", test_id: "precheck", setting: "home", count: 2 },
      { day: "2026-10-04", reason: "stop:breath", test_id: "none", setting: "home", count: 1 },
      { day: "2026-10-04", reason: "stop:tired", test_id: "none", setting: "home", count: 1 },
    ]);
    const ids = (db.prepare("SELECT id, email FROM users").all() as { id: string; email: string }[]).flatMap(
      (u) => [u.id, u.email],
    );
    const log = JSON.stringify(rows);
    for (const id of ids) expect(log).not.toContain(id);
    const columns = (db.prepare("PRAGMA table_info(safety_events)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(columns).toEqual(["day", "reason", "test_id", "setting", "count"]);
  });
});

/* ------------------------------------------------- review round 2 fixes */

describe("locks with several postpone reasons (SPEC-GAP multi-postpone)", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("a pain of 9 with an uncleared change is not released by a later clearance", async () => {
    const cookie = await member(h, "pain9-change@example.test", intakeOf());
    const r = await start(h, cookie, { pc_change: "yes", pc_change_cleared: "no", pc_pain_now: 9 });
    expect(r.data).toMatchObject({
      error: "POSTPONE",
      reason: "pain",
      screen: "scr_postpone_pain",
      alsoShow: ["scr_postpone_care"],
      lock: nextDayLock(),
    });
    setTime(T0 + 60 * 1000);
    const again = await start(h, cookie, { pc_change_cleared: "yes", pc_pain_now: 0 });
    expect(again.data).toEqual({ error: "LOCKED", ...nextDayLock() });
    expect((await h.call("/assessments", undefined, cookie)).data.assessments).toEqual([]);
  });

  it("an MS heat postpone with an uncleared change keeps the next day", async () => {
    const cookie = await member(h, "ms-change@example.test", intakeOf({ conditions: ["ms"] }));
    const r = await start(h, cookie, { pc_change: "yes", pc_change_cleared: "no", pc_ms_heat: "yes" });
    expect(r.data).toMatchObject({ reason: "ms_heat", lock: nextDayLock() });
    setTime(T0 + 2 * HOUR);
    const again = await start(h, cookie, { pc_change_cleared: "yes", pc_ms_heat: "no" });
    expect(again.data).toEqual({ error: "LOCKED", ...nextDayLock() });
  });
});

describe("the same day lock row (setLock)", () => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

  function lockDb() {
    const db = new DatabaseSync(":memory:");
    runMigrations(db, { dbPath: ":memory:" });
    db.prepare(
      "INSERT INTO users(id,email,name,password,created) VALUES('u1','u1@example.test','U','x',0)",
    ).run();
    return db;
  }

  // Q25 (c): the row keeps { until, releasableByClearance } and never the reason id.
  const releasable = (until: number) => ({ until, releasableByClearance: true });
  const fixed = (until: number) => ({ until, releasableByClearance: false });

  it("a later lock that no answer releases makes a recent change lock fixed at an equal end", () => {
    const db = lockDb();
    setLock(db, "u1", releasable(NEXT_DAY), T0);
    setLock(db, "u1", fixed(NEXT_DAY), T0 + HOUR);
    expect(currentLock(db, "u1", T0 + HOUR)).toEqual(fixed(NEXT_DAY));
  });

  it("a recent change lock never makes a fixed lock releasable, and the end is the latest", () => {
    const db = lockDb();
    setLock(db, "u1", fixed(T0 + HOUR), T0);
    setLock(db, "u1", releasable(NEXT_DAY), T0 + 1);
    expect(currentLock(db, "u1", T0 + 2)).toEqual(fixed(NEXT_DAY));
  });

  it("a longer lock replaces a shorter one; a shorter one keeps the longer end", () => {
    const db = lockDb();
    setLock(db, "u1", fixed(T0 + HOUR), T0);
    setLock(db, "u1", fixed(NEXT_DAY), T0);
    expect(currentLock(db, "u1", T0)).toEqual(fixed(NEXT_DAY));
    setLock(db, "u1", fixed(T0 + HOUR), T0);
    expect(currentLock(db, "u1", T0)).toEqual(fixed(NEXT_DAY));
  });

  it("an ended lock is replaced as if there were none", () => {
    const db = lockDb();
    setLock(db, "u1", fixed(T0 + HOUR), T0);
    setLock(db, "u1", releasable(NEXT_DAY), T0 + 2 * HOUR);
    expect(currentLock(db, "u1", T0 + 2 * HOUR)).toEqual(releasable(NEXT_DAY));
  });
});

describe("an open check after a postpone, an emergency or another day", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("an emergency answer at a new start ends the open check: no results, no completion", async () => {
    const cookie = await member(h, "open-emergency@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    expect(s.status).toBe(200);
    const urgent = await start(h, cookie, { pc_urgent: "yes" });
    expect(urgent.data).toMatchObject({ error: "POSTPONE", status: "emergency", lock: nextDayLock() });
    const item = itemOf(s.data.protocol, "shoulder_abduction", "right");
    expect((await h.call(`/assessments/${s.data.id}/results`, resultBody(item, 100), cookie)).data).toEqual({
      error: "NOT_OPEN",
      status: "abandoned",
    });
    expect((await h.call(`/assessments/${s.data.id}/complete`, {}, cookie)).data.error).toBe("NOT_OPEN");
    const list = (await h.call("/assessments", undefined, cookie)).data.assessments;
    expect(list[0]).toMatchObject({ id: s.data.id, status: "abandoned", endedReason: "replaced" });
  });

  it("a check started on an earlier day takes no results and ends early with its results kept (O6)", async () => {
    const cookie = await member(h, "open-stale@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    const item = itemOf(s.data.protocol, "shoulder_abduction", "right");
    expect((await h.call(`/assessments/${s.data.id}/results`, resultBody(item, 100), cookie)).status).toBe(
      200,
    );
    setTime(T0 + 5 * DAY);
    const next = await login(h, "open-stale@example.test");
    const late = itemOf(s.data.protocol, "shoulder_abduction", "left");
    expect((await h.call(`/assessments/${s.data.id}/results`, resultBody(late, 90), next)).data).toEqual({
      error: "NOT_OPEN",
      status: "ended_early",
    });
    expect((await h.call(`/assessments/${s.data.id}/complete`, {}, next)).data.error).toBe("NOT_OPEN");
    const stale = (await h.call("/assessments", undefined, next)).data.assessments[0];
    expect(stale).toMatchObject({ status: "ended_early", endedReason: "stale" });
    expect(stale.results).toHaveLength(1);
  });

  it("within 30 minutes of its last activity and the same day in Riyadh, the check goes on", async () => {
    const cookie = await member(h, "open-sameday@example.test", WHEELCHAIR_STROKE);
    setTime(NEXT_DAY - 40 * 60 * 1000);
    const s = await start(h, cookie);
    setTime(NEXT_DAY - 11 * 60 * 1000);
    const item = itemOf(s.data.protocol, "shoulder_abduction", "right");
    expect((await h.call(`/assessments/${s.data.id}/results`, resultBody(item, 100), cookie)).status).toBe(
      200,
    );
    // SPEC-GAP stale-open-check: midnight in Riyadh closes it too, even inside the 30 minutes.
    setTime(NEXT_DAY + 5 * 60 * 1000);
    const late = itemOf(s.data.protocol, "shoulder_abduction", "left");
    expect((await h.call(`/assessments/${s.data.id}/results`, resultBody(late, 90), cookie)).data).toEqual({
      error: "NOT_OPEN",
      status: "ended_early",
    });
  });

  it("a safety stop still reaches a check from an earlier day", async () => {
    const cookie = await member(h, "open-stop@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    setTime(NEXT_DAY + HOUR);
    const next = await login(h, "open-stop@example.test");
    const stop = await h.call(`/assessments/${s.data.id}/stop`, { option: "chest" }, next);
    expect(stop.status).toBe(200);
    expect(stop.data).toMatchObject({ endsCheck: true, lock: { releasableByClearance: false } });
  });
});

describe("pc_sci_ad_since at the first home check after a booth check", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  beforeEach(() => {
    process.env.AZM_BOOTH_DATES = "2026-10-04";
  });

  it("is asked, and a yes postpones", async () => {
    process.env.AZM_BOOTH_CODE = "booth-code-7731";
    const intake = intakeOf({ conditions: ["sci_incomplete"], mobility: "wheelchair", clearance: "yes" });
    const cookie = await member(h, "sci-booth@example.test", intake);
    const booth = await start(
      h,
      cookie,
      { pc_sci_level: "yes" },
      { setting: "booth", boothCode: "booth-code-7731" },
    );
    expect(booth.status).toBe(200);
    const item = booth.data.protocol.find((i: ProtocolItem) => !i.skipped);
    await postResults(h, cookie, booth.data.id, booth.data.protocol, {
      [`${item.testId}:${item.side}`]: 100,
    });
    expect((await h.call(`/assessments/${booth.data.id}/complete`, {}, cookie)).status).toBe(200);
    setTime(T0 + 3 * DAY);
    const next = await login(h, "sci-booth@example.test");
    const c = await h.call("/assessments/context", undefined, next);
    expect(c.data).toMatchObject({ firstCheck: true, completedBefore: true });
    // The first home check asks the level again (a new series); the AD since question follows it.
    const env = envFromContext(c.data);
    expect(visibleQuestions(env, { pc_sci_level: "yes" })).toContain("pc_sci_ad_since");
    const answers = await answersFor(h, next, { pc_sci_level: "yes", pc_sci_ad_since: "yes" });
    const r = await h.call("/assessments", { answers, device: DEVICE }, next);
    expect(r.data).toMatchObject({ error: "POSTPONE", reason: "recent_change" });
  });
});

describe("the next day question after the consent is revoked", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("is not asked and not stored", async () => {
    const cookie = await member(h, "after-revoked@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    await postResults(h, cookie, s.data.id, s.data.protocol, { "shoulder_abduction:right": 100 });
    expect((await h.call(`/assessments/${s.data.id}/complete`, {}, cookie)).status).toBe(200);
    await h.call("/consents/movement_check", {}, cookie, "DELETE");
    setTime(T0 + 13 * HOUR);
    const next = await login(h, "after-revoked@example.test");
    expect((await h.call("/assessments/context", undefined, next)).data.followUpDue).toBe(false);
    expect((await h.call("/assessments/after", { answer: "lasting" }, next)).data).toEqual({
      error: "CONSENT_REQUIRED",
    });
    const row = h.inspect().prepare("SELECT precheck FROM assessments WHERE id=?").get(s.data.id) as {
      precheck: string;
    };
    expect(JSON.parse(row.precheck)["assessment.followUp"]).toBeUndefined();
  });
});

describe("the safety log counts each stop option once per check", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("repeated stops of one option on one check count once", async () => {
    const cookie = await member(h, "stop-repeat@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    for (let i = 0; i < 5; i++) {
      expect((await h.call(`/assessments/${s.data.id}/stop`, { option: "tired" }, cookie)).status).toBe(200);
      expect((await h.call(`/assessments/${s.data.id}/stop`, { option: "choice" }, cookie)).status).toBe(200);
    }
    const rows = h.inspect().prepare("SELECT reason, count FROM safety_events ORDER BY reason").all();
    expect(rows).toEqual([
      { reason: "stop:choice", count: 1 },
      { reason: "stop:tired", count: 1 },
    ]);
    // Another check counts again.
    const s2 = await start(h, cookie);
    await h.call(`/assessments/${s2.data.id}/stop`, { option: "tired" }, cookie);
    const tired = h.inspect().prepare("SELECT count FROM safety_events WHERE reason='stop:tired'").get();
    expect(tired).toEqual({ count: 2 });
  });
});

describe("the arm curl load of a result (spec 4.2 load rules)", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("needs the load object for a scored arm curl, so the no dumbbell rule cannot be skipped", async () => {
    const cookie = await member(h, "pd-load@example.test", intakeOf({ conditions: ["parkinsons"] }));
    const s = await start(h, cookie);
    const curl = itemOf(s.data.protocol, "arm_curl_30s", "right");
    const post = (detail: Record<string, unknown>, variant = "held") =>
      h.call(`/assessments/${s.data.id}/results`, resultBody(curl, 12, { variant, detail }), cookie);
    const base = { compensated: 0, countSource: "auto" };
    expect((await post({ ...base, loadKg: 3 })).data).toEqual({
      error: "RESULT_INVALID",
      field: "detail.loadObject",
    });
    expect((await post({ ...base, loadObject: "bottle", loadKg: 3 })).data).toEqual({
      error: "RESULT_INVALID",
      field: "detail.loadKg",
    });
    expect((await post({ ...base, loadObject: "bottle", loadL: 1, loadKg: 1 })).data).toEqual({
      error: "RESULT_INVALID",
      field: "detail.loadKg",
    });
    expect((await post({ ...base, loadObject: "cuff", loadL: 1 }, "cuff")).data).toEqual({
      error: "RESULT_INVALID",
      field: "detail.loadL",
    });
    expect((await post({ ...base, loadObject: "none", loadKg: 1 }, "arm_only")).data).toEqual({
      error: "RESULT_INVALID",
      field: "detail.loadKg",
    });
    expect((await post({ ...base, loadObject: "cuff", loadKg: 1 }, "cuff")).data).toEqual({ saved: true });
    expect((await post({ ...base, loadObject: "bottle", loadL: 1 })).data).toEqual({ saved: true });
    // A skipped arm curl has no load.
    const skipped = await h.call(
      `/assessments/${s.data.id}/results`,
      resultBody(curl, 0, {
        value: null,
        attempts: [],
        nValid: 0,
        median: null,
        skippedReason: "by_choice",
        variant: null,
        detail: {},
      }),
      cookie,
    );
    expect(skipped.data).toEqual({ saved: true });
  });
});
