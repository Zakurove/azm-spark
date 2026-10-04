/**
 * The focus check routes (product v7 contract section 4, C-2, C-3, C-4, C-13, C-14), run with the
 * test rules of tests/v7/a-focus-rules.ts in place of the A2 and A4 rules (bound at Gate A): the
 * start in its order of checks with every error code, home closed and the booth pass, the two way
 * 48 hour rule, the frozen protocol and what is stored (ids and numbers, the v1 data map, never raw
 * answers); the server's own grade of each range result; the gait body with its bounds and the
 * provisional findings; the v1 stop list with its locks, counts and the not measured rows; complete
 * with every protocol entry stored under its source and the final gait findings; and the list.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "node:http";
import type { GaitFindingsInput } from "../../src/medical/gait-types";

// The gait rules (stream C) are observed: what the routes give them, and a pattern that reads the
// range profile they were given, so the final recompute at complete can be seen.
const gaitCalls = vi.hoisted(() => ({ inputs: [] as GaitFindingsInput[], fail: false }));
vi.mock("../../src/medical/gait-rules", () => ({
  evaluateGait: (input: GaitFindingsInput) => {
    gaitCalls.inputs.push(input);
    if (gaitCalls.fail) throw new Error("gait rules failed");
    const measured = input.romProfile?.entries.filter((e) => e.source === "measured").length ?? 0;
    return {
      patterns: [
        {
          pattern: "crouch",
          label: "crouch",
          side: "right",
          status: "possible",
          confidence: "low",
          evidence: [],
          contributors: measured > 3 ? ["tight_hip_flexors"] : [],
          targets: [],
          referrals: [],
          lines: { pattern: { ar: "نمط", en: "pattern" }, reasons: null, targets: [], confidence: null },
        },
      ],
      findings: [{ id: "slow_speed", side: "none", value: measured }],
      rulesVersion: `gait_rules_test_${measured}`,
    };
  },
}));

import { setLock } from "../../server/modules/assessments/store";
import { lockView } from "../../server/modules/assessments/common";
import { fill } from "../precheck-fixtures";
import type { RomProtocol, RomProtocolItem } from "../../src/medical/rom-protocol";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { ROM_RULES_VERSION, NORMS_VERSION, movementDef } from "../../src/movements/rom";
import { GAIT_RULES_VERSION, GAIT_ENGINE_VERSION } from "../../src/movements/gait";
import { testRules, TEST_TYPICAL } from "./a-focus-rules";
import { gaitBody, romBody } from "./a-focus-bodies";
import {
  DAY,
  HOUR,
  MINUTE,
  T0,
  boothPass,
  member,
  register,
  startV7Api,
  userId,
  v1Intake,
  v7Intake,
  type V7Harness,
} from "./a-harness";

const DEVICE = { os: "iOS", browser: "Safari" };
const rulesCalls = { protocol: [] as { maxMeasured?: number }[] };
const rules = testRules({
  buildRomProtocol: (input) => {
    rulesCalls.protocol.push({
      ...(input.maxMeasured !== undefined ? { maxMeasured: input.maxMeasured } : {}),
    });
    return testRules().buildRomProtocol(input);
  },
});

let h: V7Harness;
let pass = "";
const setTime = (t: number) => vi.setSystemTime(t);

beforeAll(async () => {
  h = await startV7Api(rules);
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setTime(T0);
  process.env.AZM_V7 = "1";
  pass = await boothPass(h, T0);
  gaitCalls.inputs.length = 0;
  gaitCalls.fail = false;
});
afterEach(() => {
  vi.useRealTimers();
  for (const k of ["AZM_V7", "AZM_BOOTH_DATES", "AZM_BOOTH_CODE", "AZM_CHECK_HOME", "AZM_SHOWCASE_EMAILS"])
    delete process.env[k];
});

let n = 0;
/** A new member with a v7 intake and the focus check consent (or `consents`). */
async function person(intake = v7Intake(), consents = ["focus_check"]) {
  n += 1;
  const email = `focus${n}@example.test`;
  const cookie = await member(h, email, intake, consents);
  return { cookie, email, id: await userId(h, cookie) };
}

const booth = () => ({ "x-azm-booth": pass });

/** Benign answers for the pre-check environment the context gives (booth with the pass). */
async function answersFor(cookie: string, given: Record<string, unknown> = {}) {
  const c = await h.call("/focus/context", undefined, cookie, "GET", booth());
  if (c.status !== 200 || !c.data.env) throw new Error(`context ${c.status} ${JSON.stringify(c.data)}`);
  return fill(c.data.env, given as never);
}

function startBody(answers: unknown, over: Record<string, unknown> = {}) {
  return {
    setting: "booth",
    answers,
    today: { painByRegion: {}, redFlagRegions: [] },
    device: DEVICE,
    include: { rom: true, gait: true },
    ...over,
  };
}

async function start(
  cookie: string,
  over: Record<string, unknown> = {},
  given: Record<string, unknown> = {},
) {
  const answers = await answersFor(cookie, given);
  return h.call("/focus", startBody(answers, over), cookie, "POST", booth());
}

/** A started booth focus check: its id, protocol and gait plan. */
async function started(cookie: string, over: Record<string, unknown> = {}) {
  const r = await start(cookie, over);
  if (r.status !== 200) throw new Error(`start ${r.status} ${JSON.stringify(r.data)}`);
  return r.data as { id: string; protocol: RomProtocol; gait: GaitPlan | null; kind: string };
}

const item = (p: RomProtocol, movementId: string, side = "right") =>
  p.items.find((i) => i.movementId === movementId && i.side === side) as RomProtocolItem;

const rowsOf = (checkId: string) =>
  h
    .db()
    .prepare(
      "SELECT movement_id, side, source, reason, finding, value FROM rom_measurements WHERE check_id=? ORDER BY movement_id, side",
    )
    .all(checkId) as {
    movement_id: string;
    side: string;
    source: string;
    reason: string | null;
    finding: string;
    value: number | null;
  }[];

const countOf = (metric: string, key = "") =>
  (
    h
      .db()
      .prepare("SELECT SUM(count) AS n FROM product_counts WHERE metric=? AND key=?")
      .get(metric, key) as {
      n: number | null;
    }
  ).n ?? 0;

/* ------------------------------------------------------------------ start */

describe("POST /api/focus: the order of checks", () => {
  it("refuses a home start with HOME_CLOSED right after the parse, before anything else", async () => {
    const { cookie } = await person(v1Intake(), []);
    // No v7 intake, no consent: HOME_CLOSED still answers first (C-14).
    const r = await h.call("/focus", startBody({}, { setting: "home" }), cookie);
    expect(r).toMatchObject({ status: 403, data: { error: "HOME_CLOSED" } });
    // A body that does not parse is refused first.
    expect((await h.call("/focus", { setting: "home" }, cookie)).data).toEqual({
      error: "START_INVALID",
      field: "answers",
    });
  });

  it("refuses a booth start without a valid booth pass (BOOTH_REQUIRED)", async () => {
    const { cookie } = await person();
    const answers = await answersFor(cookie);
    expect((await h.call("/focus", startBody(answers), cookie)).data).toEqual({ error: "BOOTH_REQUIRED" });
    expect(
      (await h.call("/focus", startBody(answers), cookie, "POST", { "x-azm-booth": "f".repeat(64) })).data,
    ).toEqual({ error: "BOOTH_REQUIRED" });
    // A pass of the booth day stops holding once the booth is closed (another day).
    setTime(T0 + 2 * DAY);
    expect((await h.call("/focus", startBody(answers), cookie, "POST", booth())).data).toEqual({
      error: "BOOTH_REQUIRED",
    });
  });

  it("names the first bad field of a start body (START_INVALID)", async () => {
    const { cookie } = await person();
    const answers = await answersFor(cookie);
    const bad: [Record<string, unknown>, string][] = [
      [{ extra: 1 }, "extra"],
      [{ setting: "clinic" }, "setting"],
      [{ today: { painByRegion: { knee: 11 }, redFlagRegions: [] } }, "today.painByRegion"],
      [{ today: { painByRegion: { toe: 2 }, redFlagRegions: [] } }, "today.painByRegion"],
      [{ today: { painByRegion: {}, redFlagRegions: ["knee", "knee"] } }, "today.redFlagRegions"],
      [{ today: { painByRegion: {}, redFlagRegions: [], note: "x" } }, "today.note"],
      [{ today: { painByRegion: {}, redFlagRegions: [], orthosis: { right: "cast" } } }, "today.orthosis"],
      [{ device: { os: "iOS" } }, "device.browser"],
      [{ device: { os: "iOS", browser: "Safari", model: "full" } }, "device"],
      [{ device: { os: "iOS 17 beta!", browser: "Safari" } }, "device.os"],
      [{ include: { rom: true } }, "include.gait"],
    ];
    for (const [over, field] of bad)
      expect((await h.call("/focus", startBody(answers, over), cookie, "POST", booth())).data).toEqual({
        error: "START_INVALID",
        field,
      });
  });

  it("needs the plan, a plan not in review and the v7 intake answers", async () => {
    const noPlan = await register(h, `noplan${n++}@example.test`);
    expect((await h.call("/focus", startBody({}), noPlan, "POST", booth())).data).toEqual({
      error: "PLAN_REQUIRED",
    });
    const review = await person(v7Intake({ conditions: ["cardiac"] }));
    expect((await h.call("/focus", startBody({}), review.cookie, "POST", booth())).data).toMatchObject({
      error: "REVIEW",
      reason: "cardiac",
    });
    const v1 = await person(v1Intake());
    expect((await h.call("/focus", startBody({}), v1.cookie, "POST", booth())).data).toEqual({
      error: "INTAKE_UPDATE_REQUIRED",
    });
  });

  it("needs the focus check consent and the adult confirmation", async () => {
    const noConsent = await person(v7Intake(), []);
    expect((await h.call("/focus", startBody({}), noConsent.cookie, "POST", booth())).data).toEqual({
      error: "CONSENT_REQUIRED",
    });
    const minor = await person();
    h.db().prepare("DELETE FROM adult_confirmations WHERE user_id=?").run(minor.id);
    expect((await h.call("/focus", startBody({}), minor.cookie, "POST", booth())).data).toEqual({
      error: "ADULT_REQUIRED",
    });
  });

  it("refuses while a same day lock holds (LOCKED), with the lock as v1 shows it", async () => {
    const { cookie, id } = await person();
    const answers = await answersFor(cookie);
    const until = T0 + 3 * HOUR;
    setLock(h.db(), id, { until, releasableByClearance: false }, T0);
    const r = await h.call("/focus", startBody(answers), cookie, "POST", booth());
    expect(r.status).toBe(409);
    expect(r.data).toEqual({
      error: "LOCKED",
      ...lockView({ until, releasableByClearance: false }, T0, "return"),
    });
  });

  it("keeps 48 hours after the last completed check of either kind (TOO_SOON, two way)", async () => {
    const a = await person();
    const first = await started(a.cookie);
    expect((await h.call(`/focus/${first.id}/complete`, {}, a.cookie)).status).toBe(200);
    setTime(T0 + 10 * HOUR);
    pass = await boothPass(h, T0 + 10 * HOUR);
    expect((await start(a.cookie)).data).toEqual({ error: "TOO_SOON", until: T0 + 48 * HOUR });
    // The v1 movement check counts the completed focus check too (state.ts, section 4).
    process.env.AZM_CHECK_HOME = "1";
    await h.call("/consents", { kind: "movement_check", version: 1 }, a.cookie);
    const ctx = await h.call("/assessments/context", undefined, a.cookie);
    expect(ctx.data.earliestNext).toBe(T0 + 48 * HOUR);
    const v1 = await h.call(
      "/assessments",
      {
        answers: {},
        device: { model: "full", aspect: 0.56, fps: 28, engineVersion: "e1", appVersion: "7.0.0" },
      },
      a.cookie,
    );
    expect(v1.data).toEqual({ error: "TOO_SOON", until: T0 + 48 * HOUR });
    // And a completed v1 check keeps a focus start waiting.
    const b = await person();
    h.db()
      .prepare(
        `INSERT INTO assessments(id,user_id,kind,setting,status,series_meta,setup,protocol,precheck,device,started,completed,active)
         VALUES('v1-done',?,'baseline','home','completed','{"position":"chair","poseModel":"full","intakeVersion":1}','{}','[]','{}','{}',?,?,?)`,
      )
      .run(b.id, T0 + 9 * HOUR, T0 + 9 * HOUR, T0 + 9 * HOUR);
    expect((await start(b.cookie)).data).toEqual({ error: "TOO_SOON", until: T0 + 57 * HOUR });
    // After 48 hours the start goes ahead.
    setTime(T0 + 58 * HOUR);
    pass = await boothPass(h, T0 + 58 * HOUR);
    expect((await start(b.cookie)).status).toBe(200);
  });

  it("postpones like v1: counts the start and the reason, keeps no check, sets the lock", async () => {
    const { cookie, id } = await person();
    const before = countOf("focus_started");
    const r = await start(cookie, {}, { pc_unwell: "yes" });
    expect(r.status).toBe(409);
    expect(r.data).toMatchObject({ error: "POSTPONE", status: "postpone", reason: "unwell" });
    expect(countOf("focus_started")).toBe(before + 1);
    const db = h.db();
    expect(
      db
        .prepare(
          "SELECT count FROM safety_events WHERE reason='focus:precheck:unwell' AND test_id='precheck'",
        )
        .get(),
    ).toMatchObject({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM focus_checks WHERE user_id=?").get(id)).toEqual({ n: 0 });
  });

  it("refuses a day with nothing to measure (NOTHING_TO_MEASURE)", async () => {
    const { cookie } = await person();
    expect((await start(cookie, { include: { rom: false, gait: false } })).data).toEqual({
      error: "NOTHING_TO_MEASURE",
      warnings: expect.any(Array),
    });
    // Every region with a red flag and no walk: the seek care screen comes with the refusal.
    const r = await start(cookie, {
      today: { painByRegion: {}, redFlagRegions: ["knee", "shoulder"] },
    });
    expect(r.status).toBe(409);
    expect(r.data.error).toBe("NOTHING_TO_MEASURE");
    expect(r.data.warnings).toContain("scr_stop_seek_care");
  });

  it("counts every start against 20 a day (RATE_LIMIT)", async () => {
    const { cookie } = await person();
    for (let i = 0; i < 20; i++)
      expect((await h.call("/focus", { bad: 1 }, cookie, "POST", booth())).status).toBe(400);
    expect((await h.call("/focus", { bad: 1 }, cookie, "POST", booth())).data).toEqual({
      error: "RATE_LIMIT",
    });
  });
});

describe("POST /api/focus: a booth start", () => {
  it("freezes the day's protocol and gait plan and stores ids, numbers and the data map only", async () => {
    const { cookie, id } = await person();
    const answers = await answersFor(cookie);
    const today = { painByRegion: { knee: 3 }, redFlagRegions: [], helperPresent: true, walk10m: true };
    const r = await h.call("/focus", startBody(answers, { today }), cookie, "POST", booth());
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      kind: "baseline",
      helperRequired: [],
      helperBriefing: {},
      warnings: expect.any(Array),
    });
    const p: RomProtocol = r.data.protocol;
    expect(p.items.map((i) => `${i.movementId}:${i.side}:${i.block}`)).toEqual([
      "shoulder_flexion:right:seated",
      "shoulder_abduction:right:seated",
      "shoulder_extension:right:seated",
      "knee_flexion:right:lying",
      "knee_extension:right:lying",
    ]);
    expect(r.data.gait).toMatchObject({ offered: true, modes: ["overground", "walking_pad"] });
    const row = h.db().prepare("SELECT * FROM focus_checks WHERE id=?").get(r.data.id) as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      user_id: id,
      kind: "baseline",
      setting: "booth",
      status: "open",
      intake_version: 1,
      started: T0,
      active: T0,
      completed: null,
      ended_reason: null,
    });
    expect(JSON.parse(row.protocol as string)).toEqual(p);
    expect(JSON.parse(row.gait_plan as string)).toEqual(r.data.gait);
    expect(JSON.parse(row.today as string)).toEqual(today);
    expect(JSON.parse(row.device as string)).toEqual(DEVICE);
    expect(JSON.parse(row.versions as string)).toMatchObject({
      rom: ROM_RULES_VERSION,
      norms: NORMS_VERSION,
      gait: GAIT_RULES_VERSION,
      romEngine: "rom_engine_1",
      gaitEngine: GAIT_ENGINE_VERSION,
    });
    // The pre-check keeps the v1 data map and the consent, never a raw answer.
    const precheck = JSON.parse(row.precheck as string) as Record<string, unknown>;
    expect(precheck).toMatchObject({ "consent.version": 1, "consent.acceptedAt": T0 });
    for (const k of Object.keys(precheck)) expect(k).not.toMatch(/^pc_|^su_/);
    expect(countOf("focus_started")).toBeGreaterThan(0);
  });

  it("names the seek care screen for a red flag region and leaves its items not measured", async () => {
    const { cookie } = await person();
    const r = await start(cookie, { today: { painByRegion: {}, redFlagRegions: ["shoulder"] } });
    expect(r.status).toBe(200);
    expect(r.data.warnings).toContain("scr_stop_seek_care");
    const p: RomProtocol = r.data.protocol;
    expect(p.items.filter((i) => i.region === "shoulder").every((i) => i.skipped === "red_flag")).toBe(true);
    // A leg region red flag would remove gait; a shoulder one keeps it.
    expect(r.data.gait.offered).toBe(true);
  });

  it("leaves out a part the person does not include today", async () => {
    const { cookie, id } = await person();
    const r = await start(cookie, { include: { rom: false, gait: true } });
    expect(r.status).toBe(200);
    expect((r.data.protocol as RomProtocol).items.every((i) => i.skipped === "by_choice")).toBe(true);
    const g = await start(cookie, { include: { rom: true, gait: false } });
    expect(g.data.gait).toBeNull();
    // The second start replaced the first, which had no rows: abandoned.
    expect(
      h
        .db()
        .prepare("SELECT status, ended_reason FROM focus_checks WHERE user_id=? ORDER BY started, rowid")
        .all(id),
    ).toEqual([
      { status: "abandoned", ended_reason: "replaced" },
      { status: "open", ended_reason: null },
    ]);
  });

  it("caps the showcase persona at 2 movements and one gait view (AZM_SHOWCASE_EMAILS)", async () => {
    const { cookie, email } = await person();
    process.env.AZM_SHOWCASE_EMAILS = `someone@example.test, ${email.toUpperCase()}`;
    rulesCalls.protocol.length = 0;
    const r = await start(cookie);
    expect(r.status).toBe(200);
    expect(rulesCalls.protocol.every((c) => c.maxMeasured === 2)).toBe(true);
    const p: RomProtocol = r.data.protocol;
    expect(p.items.filter((i) => !i.skipped)).toHaveLength(2);
    expect(p.deferred).toHaveLength(3);
    expect(r.data.gait.views).toEqual({
      overground: ["side"],
      walking_pad: [{ view: "pad_side", nearSide: "right" }],
    });
  });
});

/* ---------------------------------------------------------------- context */

describe("GET /api/focus/context", () => {
  it("gives the intake state, the consents, the environment and a preview of the protocol", async () => {
    const { cookie } = await person(v7Intake(), ["focus_check", "live_coach"]);
    const c = await h.call("/focus/context", undefined, cookie, "GET", booth());
    expect(c.status).toBe(200);
    expect(c.data).toMatchObject({
      intakeReady: true,
      setting: "booth",
      homeOpen: false,
      consent: { focus_check: true, live_coach: true },
      lock: null,
      open: null,
      lastCompleted: null,
      env: { setting: "booth", firstCheck: true, baseTests: ["shoulder_abduction", "chair_stand_30s"] },
    });
    expect((c.data.protocol as RomProtocol).items.length).toBe(5);
    // Without a booth pass the preview is a home check.
    expect((await h.call("/focus/context", undefined, cookie)).data.setting).toBe("home");
    const s = await started(cookie);
    expect((await h.call("/focus/context", undefined, cookie, "GET", booth())).data.open).toEqual({
      id: s.id,
    });
  });

  it("says the intake needs the v7 answers, without a protocol", async () => {
    const { cookie } = await person(v1Intake(), []);
    expect((await h.call("/focus/context", undefined, cookie)).data).toMatchObject({
      intakeReady: false,
      consent: { focus_check: false, live_coach: false },
      env: null,
      protocol: null,
      gait: null,
    });
  });

  it("needs a plan not in review", async () => {
    const noPlan = await register(h, `ctx${n++}@example.test`);
    expect((await h.call("/focus/context", undefined, noPlan)).data).toEqual({ error: "PLAN_REQUIRED" });
    const review = await person(v7Intake({ conditions: ["cardiac"] }));
    expect((await h.call("/focus/context", undefined, review.cookie)).data).toMatchObject({
      error: "REVIEW",
    });
  });
});

/* -------------------------------------------------------------------- rom */

describe("POST /api/focus/:id/rom", () => {
  it("stores the server's grade, never the client's, with the attempts reduced and the retries counted", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    const it1 = item(s.protocol, "shoulder_flexion");
    const before = countOf("rom_quality_retries", "shoulder_flexion");
    const r = await h.call(`/focus/${s.id}/rom`, romBody(it1, 120, { retries: 2 }), cookie);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({
      saved: true,
      grade: {
        percentNormal: 80,
        finding: "mild",
        gradeIgnoringPain: "mild",
        norm: expect.objectContaining({ normId: "test_norm", mean: TEST_TYPICAL }),
        flags: [],
      },
      typical: TEST_TYPICAL,
    });
    expect(countOf("rom_quality_retries", "shoulder_flexion")).toBe(before + 2);
    const row = h.db().prepare("SELECT * FROM rom_measurements WHERE check_id=?").get(s.id) as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      movement_id: "shoulder_flexion",
      side: "right",
      position: "seated",
      value: 120,
      unit: "deg",
      source: "measured",
      reason: null,
      pain: 0,
      pain_before: 0,
      percent_normal: 80,
      finding: "mild",
      grade_ignoring_pain: "mild",
      median: 118,
      n_valid: 3,
      pose_model: "full",
      movement_version: movementDef("shoulder_flexion").version,
      norms_version: NORMS_VERSION,
      engine_version: "rom_engine_1",
      created: T0,
    });
    const attempts = JSON.parse(row.attempts as string) as { quality: Record<string, unknown> }[];
    expect(attempts).toHaveLength(3);
    expect(attempts[0].quality).toEqual({ ok: true, fps: 28, view: "side", issues: [] });
    // A client cannot send its own grade.
    const knee = item(s.protocol, "knee_flexion");
    expect(
      (await h.call(`/focus/${s.id}/rom`, romBody(knee, 130, { finding: "within" }), cookie)).data,
    ).toEqual({
      error: "RESULT_INVALID",
      field: "finding",
    });
    // One valid attempt is provisional (the server's flags).
    const one = romBody(knee, 130, { nValid: 1, median: null });
    (one.attempts as { outcome: string }[])[0].outcome = "invalid";
    (one.attempts as { outcome: string }[])[2].outcome = "invalid";
    const p = await h.call(`/focus/${s.id}/rom`, one, cookie);
    expect(p.data.grade.flags).toEqual(["provisional"]);
  });

  it("refuses what is not in the protocol, a skipped item, a second save and a stale client", async () => {
    const { cookie } = await person();
    const s = await started(cookie, { today: { painByRegion: { shoulder: 7 }, redFlagRegions: [] } });
    expect((await h.call(`/focus/${s.id}/rom`, { movementId: "elbow", side: "right" }, cookie)).data).toEqual(
      {
        error: "RESULT_INVALID",
        field: "movementId",
      },
    );
    const hip = { movementId: "hip_flexion", side: "right", position: "lying_back" } as RomProtocolItem;
    expect((await h.call(`/focus/${s.id}/rom`, romBody(hip, 100), cookie)).data).toEqual({
      error: "NOT_IN_PROTOCOL",
    });
    const skipped = item(s.protocol, "shoulder_flexion");
    expect((await h.call(`/focus/${s.id}/rom`, romBody(skipped, 100), cookie)).data).toEqual({
      error: "SKIPPED",
      reason: "pain_today",
    });
    const knee = item(s.protocol, "knee_flexion");
    expect(
      (await h.call(`/focus/${s.id}/rom`, romBody(knee, 130, { movementVersion: 99 }), cookie)).data,
    ).toEqual({
      error: "STALE_CLIENT",
    });
    expect((await h.call(`/focus/${s.id}/rom`, romBody(knee, 130), cookie)).status).toBe(200);
    expect((await h.call(`/focus/${s.id}/rom`, romBody(knee, 131), cookie)).data).toEqual({
      error: "ALREADY_SAVED",
    });
  });

  it("checks the bounds and the rules that tie a result together (RESULT_INVALID)", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    const flex = item(s.protocol, "shoulder_flexion");
    const lack = item(s.protocol, "knee_extension");
    const bad: [ReturnType<typeof romBody>, string][] = [
      [romBody(flex, 181), "value"],
      [romBody(flex, 120.5), "value"],
      [romBody(flex, 120, { value: 118 }), "value"],
      [romBody(flex, 120, { median: 125 }), "median"],
      [romBody(flex, 120, { nValid: 2 }), "nValid"],
      [romBody(flex, 120, { painLevel: 11 }), "painLevel"],
      [romBody(flex, 120, { painBefore: 2.5 }), "painBefore"],
      [romBody(flex, 120, { retries: 3 }), "retries"],
      [romBody(flex, 120, { flags: ["madeUp"] }), "flags"],
      [romBody(flex, 120, { position: "standing" }), "position"],
      [romBody(flex, 120, { status: "not_measured" }), "value"],
      [romBody(flex, 120, { cause: "stiff" }), "cause"],
      [romBody(flex, 120, { poseModel: "heavy" }), "poseModel"],
      [romBody(flex, 120, { durationSec: Infinity }), "durationSec"],
      [romBody(lack, 160), "value"],
      // A lack's best attempt is its smallest value.
      [romBody(lack, 10, { value: 14 }), "value"],
    ];
    for (const [body, field] of bad)
      expect((await h.call(`/focus/${s.id}/rom`, body, cookie)).data, field).toEqual({
        error: "RESULT_INVALID",
        field,
      });
    // A lack movement may go below zero (past straight) down to -30.
    expect((await h.call(`/focus/${s.id}/rom`, romBody(lack, -4), cookie)).status).toBe(200);
    // A not measured result has no value and names its reason.
    const notMeasured = romBody(flex, 0, {
      status: "not_measured",
      reason: "no_hold",
      value: null,
      median: null,
      nValid: 0,
      attempts: [],
      practice: [],
    });
    expect((await h.call(`/focus/${s.id}/rom`, notMeasured, cookie)).data).toMatchObject({
      saved: true,
      grade: { finding: "unknown" },
    });
    expect(rowsOf(s.id).find((r) => r.movement_id === "shoulder_flexion")).toMatchObject({
      source: "not_measured_today",
      reason: "no_hold",
      value: null,
    });
  });

  it("takes results only for an open, current check of the person (NOT_OPEN, LOCKED, NOT_FOUND)", async () => {
    const a = await person();
    const s = await started(a.cookie);
    const knee = item(s.protocol, "knee_flexion");
    const b = await person();
    expect((await h.call(`/focus/${s.id}/rom`, romBody(knee, 130), b.cookie)).data).toEqual({
      error: "NOT_FOUND",
    });
    // A lock set elsewhere (a v1 stop) holds the check.
    setLock(h.db(), a.id, { until: T0 + HOUR, releasableByClearance: false }, T0);
    expect((await h.call(`/focus/${s.id}/rom`, romBody(knee, 130), a.cookie)).data.error).toBe("LOCKED");
    h.db().prepare("DELETE FROM check_locks WHERE user_id=?").run(a.id);
    // 30 minutes after the last activity the check is stale: closed and refused.
    setTime(T0 + 31 * MINUTE);
    expect((await h.call(`/focus/${s.id}/rom`, romBody(knee, 130), a.cookie)).data).toEqual({
      error: "NOT_OPEN",
      status: "abandoned",
    });
  });

  it("refuses a home check's results while home checks are closed (HOME_CLOSED)", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    h.db().prepare("UPDATE focus_checks SET setting='home' WHERE id=?").run(s.id);
    const knee = item(s.protocol, "knee_flexion");
    expect((await h.call(`/focus/${s.id}/rom`, romBody(knee, 130), cookie)).data).toEqual({
      error: "HOME_CLOSED",
    });
    expect((await h.call(`/focus/${s.id}/complete`, {}, cookie)).data).toEqual({ error: "HOME_CLOSED" });
    expect((await h.call(`/focus/${s.id}/stop`, { option: "tired" }, cookie)).data).toEqual({
      error: "HOME_CLOSED",
    });
  });
});

/* ------------------------------------------------------------------- gait */

describe("POST /api/focus/:id/gait", () => {
  it("stores the walk with provisional findings from the range rows saved so far", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    expect(
      (await h.call(`/focus/${s.id}/rom`, romBody(item(s.protocol, "shoulder_flexion"), 120), cookie)).status,
    ).toBe(200);
    const body = gaitBody(s.gait!, "overground");
    const r = await h.call(`/focus/${s.id}/gait`, body, cookie);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      mode: "overground",
      provisional: true,
      rulesVersion: "gait_rules_test_1",
      quality: { gatePassed: true, timingOnly: false, flags: [] },
      findings: [{ id: "slow_speed", side: "none", value: 1 }],
      replay: body.analysis.replay,
      created: T0,
    });
    expect(r.data.views).toEqual([
      { view: "side", metrics: body.analysis.views[0].metrics, cleanCycles: { left: 8, right: 7 } },
      { view: "front", metrics: body.analysis.views[1].metrics, cleanCycles: { left: 8, right: 7 } },
    ]);
    expect(r.data.patterns[0].lines).toBeDefined();
    // The rules got the stored day, the intake and the range profile so far.
    const input = gaitCalls.inputs.at(-1)!;
    expect(input.today).toEqual({ painByRegion: {} });
    expect(input.plan).toEqual(s.gait);
    expect(input.romProfile?.entries.filter((e) => e.source === "measured")).toHaveLength(1);
    const row = h.db().prepare("SELECT * FROM gait_analyses WHERE check_id=?").get(s.id) as Record<
      string,
      string
    >;
    expect(row).toMatchObject({
      mode: "overground",
      pose_model: "full",
      rules_version: "gait_rules_test_1",
      engine_version: "gait_engine_1",
    });
    // The patterns are stored without their lines (written again on read).
    expect(JSON.parse(row.findings).patterns[0].lines).toBeUndefined();
    expect(JSON.parse(row.setup)).toEqual(body.setup);
    expect((await h.call(`/focus/${s.id}/gait`, body, cookie)).data).toEqual({ error: "ALREADY_SAVED" });
  });

  it("accepts the largest valid body (3 views, 200 events and 120 cycles each, 45 frames) under the body limit", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    const body = gaitBody(s.gait!, "walking_pad", { worst: true });
    const size = Buffer.byteLength(JSON.stringify(body));
    expect(size).toBeGreaterThan(100 * 1024);
    expect(size).toBeLessThan(160 * 1024);
    const r = await h.call(`/focus/${s.id}/gait`, body, cookie);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      mode: "walking_pad",
      quality: { flags: ["handrail_light", "model_lite"] },
    });
    expect(h.db().prepare("SELECT pose_model FROM gait_analyses WHERE check_id=?").get(s.id)).toEqual({
      pose_model: "lite",
    });
  });

  it("refuses a body over 160 KB before reading it all, and an unsigned caller", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    const body = gaitBody(s.gait!, "walking_pad", { worst: true });
    const big = JSON.stringify({ ...body, padding: "x".repeat(170 * 1024) });
    // On its own connection: the server answers before it has read the whole body.
    const status = await new Promise<number>((resolve, reject) => {
      const url = new URL(`${h.origin}/api/focus/${s.id}/gait`);
      const req = request(
        {
          host: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          agent: false,
          headers: { origin: h.origin, "Content-Type": "application/json", "X-Azm-Request": "1", cookie },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(big);
    });
    expect(status).toBe(413);
    expect((await h.call(`/focus/${s.id}/gait`, body)).data).toEqual({ error: "AUTH_REQUIRED" });
  });

  it("checks the bounds of section 4 (GAIT_INVALID)", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    const plan = s.gait!;
    const mutate = (fn: (b: any) => void) => {
      const b = gaitBody(plan, "walking_pad");
      fn(b);
      return b;
    };
    const bad: [any, string][] = [
      [mutate((b) => (b.analysis.mode = "overground")), "analysis.mode"],
      [mutate((b) => (b.setup.mode = "treadmill")), "setup.mode"],
      [mutate((b) => (b.setup.padSpeedKmh = 6.5)), "setup.padSpeedKmh"],
      [mutate((b) => (b.setup.padCorrection = 3)), "setup.padCorrection"],
      [mutate((b) => (b.setup.heightCm = 119)), "setup.heightCm"],
      [mutate((b) => b.analysis.views.push(b.analysis.views[0])), "analysis.views"],
      [mutate((b) => (b.analysis.views[1] = { ...b.analysis.views[0] })), "analysis.views"],
      [mutate((b) => (b.analysis.views[0].view = "side")), "analysis.views.view"],
      [mutate((b) => (b.analysis.views[0].replay = b.analysis.replay)), "analysis.views.replay"],
      [
        mutate((b) => (b.analysis.views[0].events = Array(201).fill(b.analysis.views[0].events[0]))),
        "analysis.views.events",
      ],
      [
        mutate((b) => (b.analysis.views[0].cycles = Array(121).fill(b.analysis.views[0].cycles[0]))),
        "analysis.views.cycles",
      ],
      [
        mutate((b) => (b.analysis.views[0].metrics.cadence.value = 251)),
        "analysis.views.metrics.cadence.value",
      ],
      [
        mutate((b) => (b.analysis.views[0].metrics.cadence.unit = "Hz")),
        "analysis.views.metrics.cadence.unit",
      ],
      [mutate((b) => (b.analysis.combined.madeUp = {})), "analysis.combined"],
      [
        mutate((b) => b.analysis.replay.frames.push(...Array(26).fill(b.analysis.replay.frames[0]))),
        "analysis.replay.frames",
      ],
      [mutate((b) => (b.analysis.replay.landmarks = [0, 11])), "analysis.replay.landmarks"],
      [mutate((b) => (b.analysis.flags = ["far_limb", "far_limb"])), "analysis.flags"],
      [
        mutate((b) => (b.analysis.staticStance = [{ side: "right", pelvicDropDeg: 130, ok: true }])),
        "analysis.staticStance",
      ],
      [mutate((b) => (b.extra = 1)), "extra"],
    ];
    for (const [body, field] of bad)
      expect((await h.call(`/focus/${s.id}/gait`, body, cookie)).data, field).toEqual({
        error: "GAIT_INVALID",
        field,
      });
  });

  it("is refused when the plan offers no walk, and counts a failed gate", async () => {
    const { cookie } = await person();
    const s = await started(cookie, { include: { rom: true, gait: false } });
    const plan = testRules().gaitPlanFor(v7Intake(), { painByRegion: {}, redFlagRegions: [] }, "booth", {});
    expect((await h.call(`/focus/${s.id}/gait`, gaitBody(plan, "overground"), cookie)).data).toEqual({
      error: "NOT_OFFERED",
    });
    const t = await started(cookie);
    const before = countOf("gait_gate_failed", "overground");
    const r = await h.call(`/focus/${t.id}/gait`, gaitBody(t.gait!, "overground", { gate: false }), cookie);
    expect(r.data.quality.gatePassed).toBe(false);
    expect(countOf("gait_gate_failed", "overground")).toBe(before + 1);
  });
});

/* ------------------------------------------------------------------- stop */

describe("POST /api/focus/:id/stop", () => {
  it("routes a stop like v1: an ending stop locks, counts and writes the not measured rows", async () => {
    const { cookie, id } = await person();
    const s = await started(cookie);
    const flex = item(s.protocol, "shoulder_flexion");
    expect((await h.call(`/focus/${s.id}/rom`, romBody(flex, 120), cookie)).status).toBe(200);
    const r = await h.call(
      `/focus/${s.id}/stop`,
      { option: "chest", movementId: "shoulder_abduction", side: "right" },
      cookie,
    );
    expect(r.status).toBe(200);
    expect(r.data.route).toMatchObject({ option: "chest", screen: "scr_emergency", endsCheck: true });
    expect(r.data.lock).toMatchObject({ until: expect.any(Number), releasableByClearance: false });
    const db = h.db();
    expect(db.prepare("SELECT status, ended_reason FROM focus_checks WHERE id=?").get(s.id)).toEqual({
      status: "ended_early",
      ended_reason: "stop",
    });
    expect(db.prepare("SELECT change_reported FROM check_state WHERE user_id=?").get(id)).toEqual({
      change_reported: "2026-10-04",
    });
    expect(
      db.prepare("SELECT count FROM safety_events WHERE reason='focus:stop:chest' AND test_id='none'").get(),
    ).toMatchObject({ count: expect.any(Number) });
    // The stopped movement keeps the stop's reason; the rest are not reached; defaults not measured.
    expect(rowsOf(s.id)).toEqual([
      {
        movement_id: "knee_extension",
        side: "right",
        source: "not_measured_today",
        reason: "not_reached",
        finding: "not_today",
        value: null,
      },
      {
        movement_id: "knee_flexion",
        side: "right",
        source: "not_measured_today",
        reason: "not_reached",
        finding: "not_today",
        value: null,
      },
      {
        movement_id: "shoulder_abduction",
        side: "right",
        source: "not_measured_today",
        reason: "stopped_symptom",
        finding: "not_today",
        value: null,
      },
      {
        movement_id: "shoulder_extension",
        side: "right",
        source: "not_measured_today",
        reason: "not_reached",
        finding: "not_today",
        value: null,
      },
      {
        movement_id: "shoulder_external_rotation",
        side: "right",
        source: "not_measured_camera",
        reason: "default_camera",
        finding: "unknown",
        value: null,
      },
      {
        movement_id: "shoulder_flexion",
        side: "right",
        source: "measured",
        reason: null,
        finding: "mild",
        value: 120,
      },
      {
        movement_id: "shoulder_internal_rotation",
        side: "right",
        source: "not_measured_camera",
        reason: "default_camera",
        finding: "unknown",
        value: null,
      },
    ]);
    // A stop after the check ended still reaches it within a day (a safety answer is never refused).
    const again = await h.call(`/focus/${s.id}/stop`, { option: "tired" }, cookie);
    expect(again.status).toBe(200);
    expect(again.data.route).toMatchObject({ option: "tired", endsCheck: false });
  });

  it("lets the check go on after a stop that does not end it, with the stopped movement not measured today", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    const r = await h.call(
      `/focus/${s.id}/stop`,
      { option: "tired", movementId: "knee_flexion", side: "right" },
      cookie,
    );
    expect(r.data).toMatchObject({
      route: { option: "tired", endsCheck: false, afterRest: true },
      lock: null,
    });
    expect(h.db().prepare("SELECT status FROM focus_checks WHERE id=?").get(s.id)).toEqual({
      status: "open",
    });
    expect(rowsOf(s.id)).toEqual([
      {
        movement_id: "knee_flexion",
        side: "right",
        source: "not_measured_today",
        reason: "stopped_symptom",
        finding: "not_today",
        value: null,
      },
    ]);
    const knee = item(s.protocol, "knee_flexion");
    expect((await h.call(`/focus/${s.id}/rom`, romBody(knee, 130), cookie)).data).toEqual({
      error: "ALREADY_SAVED",
    });
  });

  it("checks the option against the person's stop list and the movement against the protocol", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    expect((await h.call(`/focus/${s.id}/stop`, { option: "ad_signs" }, cookie)).data).toEqual({
      error: "STOP_INVALID",
      field: "option",
    });
    expect((await h.call(`/focus/${s.id}/stop`, { option: "spin" }, cookie)).data).toEqual({
      error: "STOP_INVALID",
      field: "option",
    });
    expect(
      (
        await h.call(
          `/focus/${s.id}/stop`,
          { option: "tired", movementId: "hip_flexion", side: "right" },
          cookie,
        )
      ).data,
    ).toEqual({
      error: "STOP_INVALID",
      field: "movementId",
    });
    expect((await h.call(`/focus/${s.id}/stop`, { option: "tired", why: "x" }, cookie)).data).toEqual({
      error: "STOP_INVALID",
      field: "why",
    });
  });

  it("takes a stop on a stale check (closed first), and refuses one a day after a closed check", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    setTime(T0 + 3 * HOUR);
    const late = await h.call(`/focus/${s.id}/stop`, { option: "chest" }, cookie);
    expect(late.status).toBe(200);
    expect(h.db().prepare("SELECT status, ended_reason FROM focus_checks WHERE id=?").get(s.id)).toEqual({
      status: "abandoned",
      ended_reason: "stop",
    });
    // No row is written into a check the server closed.
    expect(rowsOf(s.id)).toEqual([]);
    setTime(T0 + 25 * HOUR);
    expect((await h.call(`/focus/${s.id}/stop`, { option: "tired" }, cookie)).data).toEqual({
      error: "NOT_OPEN",
      status: "abandoned",
    });
  });
});

/* --------------------------------------------------------------- complete */

describe("POST /api/focus/:id/complete", () => {
  it("stores every protocol entry under its own source and makes the gait findings final", async () => {
    const { cookie } = await person(
      v7Intake({
        regions: [
          { region: "knee", side: "both", problems: ["stiffness"], origin: "person" },
          { region: "shoulder", side: "right", problems: ["weakness"], origin: "condition" },
          { region: "hip", side: "right", problems: ["pain"], origin: "person" },
          { region: "elbow", side: "both", problems: ["stiffness"], origin: "person" },
        ],
        pain: ["hip"],
      }),
    );
    // A red flag on the elbows (not a leg or the back, so the walk stays offered).
    const s = await started(cookie, { today: { painByRegion: { hip: 2 }, redFlagRegions: ["elbow"] } });
    const p = s.protocol;
    // 4 elbow items with a red flag; 10 others, of which 8 run today and 2 are deferred.
    expect(p.items.filter((i) => i.skipped === "red_flag").length).toBe(4);
    expect(p.items.filter((i) => !i.skipped).length).toBe(8);
    expect(p.deferred.map((i) => `${i.movementId}:${i.side}`)).toEqual([
      "knee_extension:right",
      "hip_flexion:right",
    ]);
    expect(s.gait?.offered).toBe(true);
    const flex = item(p, "shoulder_flexion");
    const abd = item(p, "shoulder_abduction");
    const knee = item(p, "knee_flexion", "left");
    for (const [it1, v] of [
      [flex, 150],
      [abd, 140],
      [knee, 130],
    ] as const)
      expect((await h.call(`/focus/${s.id}/rom`, romBody(it1, v), cookie)).status).toBe(200);
    expect(
      (await h.call(`/focus/${s.id}/gait`, gaitBody(s.gait!, "overground"), cookie)).data.provisional,
    ).toBe(true);
    // A range row saved after the gait POST changes the final findings.
    const ext = item(p, "shoulder_extension");
    expect(ext).toBeDefined();
    expect((await h.call(`/focus/${s.id}/rom`, romBody(ext, 40), cookie)).status).toBe(200);
    const before = countOf("focus_completed");
    setTime(T0 + 20 * MINUTE);
    const r = await h.call(`/focus/${s.id}/complete`, {}, cookie);
    expect(r.status).toBe(200);
    expect(r.data.status).toBe("completed");
    expect(r.data.gait).toMatchObject({
      provisional: false,
      rulesVersion: "gait_rules_test_4",
      findings: [{ id: "slow_speed", side: "none", value: 4 }],
    });
    expect(r.data.gait.patterns[0].contributors).toEqual(["tight_hip_flexors"]);
    expect(gaitCalls.inputs.at(-1)!.romProfile!.entries.filter((e) => e.source === "measured")).toHaveLength(
      4,
    );
    expect(countOf("focus_completed")).toBe(before + 1);
    const db = h.db();
    expect(
      db.prepare("SELECT status, completed, ended_reason FROM focus_checks WHERE id=?").get(s.id),
    ).toEqual({
      status: "completed",
      completed: T0 + 20 * MINUTE,
      ended_reason: null,
    });
    const g = db
      .prepare("SELECT findings, rules_version FROM gait_analyses WHERE check_id=?")
      .get(s.id) as Record<string, string>;
    expect(g.rules_version).toBe("gait_rules_test_4");
    expect(JSON.parse(g.findings).patterns[0].contributors).toEqual(["tight_hip_flexors"]);
    // Every entry of the protocol has its row: measured, skipped, deferred, not reached, default only.
    const rows = rowsOf(s.id);
    const key = (m: string, side: string) => rows.find((r) => r.movement_id === m && r.side === side);
    for (const i of p.items)
      expect(key(i.movementId, i.side)?.source, `${i.movementId}:${i.side}`).toBe(
        [flex, abd, knee, ext].includes(i) ? "measured" : "not_measured_today",
      );
    for (const i of p.items.filter((x) => !x.skipped && ![flex, abd, knee, ext].includes(x)))
      expect(key(i.movementId, i.side)?.reason).toBe("not_reached");
    for (const i of p.items.filter((x) => x.skipped))
      expect(key(i.movementId, i.side)?.reason).toBe(i.skipped);
    for (const i of p.deferred)
      expect(key(i.movementId, i.side)).toMatchObject({ source: "not_measured_today", reason: "deferred" });
    for (const nm of p.notMeasured)
      expect(key(nm.movementId, nm.side)).toMatchObject({ source: nm.source, reason: nm.reason });
    expect(rows).toHaveLength(p.items.length + p.deferred.length + p.notMeasured.length);
    // The profile shows each of them with its stored source, none reported as a default.
    const entries = r.data.profile.entries as { movementId: string; side: string; source: string }[];
    for (const row of rows)
      expect(entries.find((e) => e.movementId === row.movement_id && e.side === row.side)?.source).toBe(
        row.source,
      );
    expect(r.data.findings).toEqual([]);
    // Complete closes the check.
    expect((await h.call(`/focus/${s.id}/complete`, {}, cookie)).data).toEqual({
      error: "NOT_OPEN",
      status: "completed",
    });
  });

  it("writes nothing when a step fails: one transaction", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    expect((await h.call(`/focus/${s.id}/gait`, gaitBody(s.gait!, "overground"), cookie)).status).toBe(200);
    gaitCalls.fail = true;
    expect((await h.call(`/focus/${s.id}/complete`, {}, cookie)).status).toBe(500);
    expect(rowsOf(s.id)).toEqual([]);
    expect(h.db().prepare("SELECT status FROM focus_checks WHERE id=?").get(s.id)).toEqual({
      status: "open",
    });
    gaitCalls.fail = false;
    expect((await h.call(`/focus/${s.id}/complete`, {}, cookie)).status).toBe(200);
  });

  it("takes an empty body only", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    expect((await h.call(`/focus/${s.id}/complete`, { force: true }, cookie)).data).toEqual({
      error: "COMPLETE_INVALID",
      field: "body",
    });
  });
});

/* ------------------------------------------------------------------- list */

describe("GET /api/focus", () => {
  it("lists the person's checks, newest first, with what was measured", async () => {
    const { cookie } = await person();
    const a = await started(cookie);
    expect(
      (await h.call(`/focus/${a.id}/rom`, romBody(item(a.protocol, "knee_flexion"), 130), cookie)).status,
    ).toBe(200);
    expect((await h.call(`/focus/${a.id}/gait`, gaitBody(a.gait!, "overground"), cookie)).status).toBe(200);
    setTime(T0 + MINUTE);
    const b = await started(cookie);
    const list = await h.call("/focus", undefined, cookie);
    expect(list.data.checks).toEqual([
      {
        id: b.id,
        kind: "baseline",
        setting: "booth",
        status: "open",
        started: T0 + MINUTE,
        completed: null,
        measured: 0,
        gait: false,
      },
      {
        id: a.id,
        kind: "baseline",
        setting: "booth",
        status: "ended_early",
        started: T0,
        completed: null,
        measured: 1,
        gait: true,
      },
    ]);
    const other = await person();
    expect((await h.call("/focus", undefined, other.cookie)).data).toEqual({ checks: [] });
  });
});
