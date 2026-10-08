/**
 * The focus check routes (product v7 contract section 4, C-2, C-3, C-4, C-13, C-14), run with the
 * test rules of tests/v7/a-focus-rules.ts in place of the A2 and A4 rules (bound at Gate A): the
 * start in its order of checks with every error code, home open for v7 (D-032 item 1) and the booth
 * pass, the two way
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
// The lines the profile route writes on read through withGaitLines (the stored patterns keep none).
const REWRITTEN_LINES = vi.hoisted(() => ({
  pattern: { ar: "نمط مكتوب من جديد", en: "pattern written again" },
  reasons: null,
  targets: [],
  confidence: null,
}));
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
  // The profile route writes the stored patterns' lines again on read (a plain import, D-027 item 7).
  withGaitLines: (patterns: object[]) => patterns.map((p) => ({ ...p, lines: REWRITTEN_LINES })),
}));

import { setLock } from "../../server/modules/assessments/store";
import { romRowsOf } from "../../server/modules/focus/store";
import { lockView } from "../../server/modules/assessments/common";
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

/**
 * The day's one screen answered calmly (D-032 item 2): nothing new or worrying, steady, walks 10 m, no
 * one with the person; `day` over it.
 */
const CALM_DAY = {
  painByRegion: {},
  redFlagRegions: [],
  worrying: false,
  unsteady: false,
  walk10m: true,
  helperPresent: false,
};

function startBody(day: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  return {
    setting: "booth",
    today: { ...CALM_DAY, ...day },
    device: DEVICE,
    include: { rom: true, gait: true },
    ...over,
  };
}

async function start(cookie: string, over: Record<string, unknown> = {}, day: Record<string, unknown> = {}) {
  return h.call("/focus", startBody(day, over), cookie, "POST", booth());
}

/** A started booth focus check: its id, protocol and gait plan. */
async function started(
  cookie: string,
  over: Record<string, unknown> = {},
  day: Record<string, unknown> = {},
) {
  const r = await start(cookie, over, day);
  if (r.status !== 200) throw new Error(`start ${r.status} ${JSON.stringify(r.data)}`);
  return r.data as { id: string; protocol: RomProtocol; gait: GaitPlan | null; kind: string };
}

/** A completed v1 check with its result rows (test, side, value), for the two way 48 hour rule. */
function v1Done(
  user: string,
  id: string,
  at: number,
  results: { test: string; side: "left" | "right" | "none"; value: number | null }[],
) {
  const db = h.db();
  db.prepare(
    `INSERT INTO assessments(id,user_id,kind,setting,status,series_meta,setup,protocol,precheck,device,started,completed,active)
     VALUES(?,?,'baseline','home','completed','{"position":"chair","poseModel":"full","intakeVersion":1}','{}','[]','{}','{}',?,?,?)`,
  ).run(id, user, at, at, at);
  for (const [i, r] of results.entries())
    db.prepare(
      `INSERT INTO assessment_results(id,assessment_id,user_id,test_id,side,value,unit,band,attempts,quality,detail,flags,n_valid,series_key,pose_model,movement_version,engine_version,created)
       VALUES(?,?,?,?,?,?,?,'default','[]','{}','{}','[]',1,'k','full',1,'e1',?)`,
    ).run(
      `${id}-r${i}`,
      id,
      user,
      r.test,
      r.side,
      r.value,
      r.test === "shoulder_abduction" ? "deg" : "count",
      at,
    );
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
  it("takes a home start without a booth code: home is open for v7 (D-032 item 1)", async () => {
    const v1 = await person(v1Intake(), []);
    // No v7 intake: the start goes past the home gate to the intake's own check.
    const r = await h.call("/focus", startBody({}, { setting: "home" }), v1.cookie);
    expect(r).toMatchObject({ status: 409, data: { error: "INTAKE_UPDATE_REQUIRED" } });
    // A body that does not parse is refused first.
    expect((await h.call("/focus", { setting: "home" }, v1.cookie)).data).toEqual({
      error: "START_INVALID",
      field: "today",
    });
    // A member with the v7 intake starts at home with no booth pass, and the check is a home check.
    const { cookie } = await person();
    const ctx = await h.call("/focus/context", undefined, cookie);
    expect(ctx.data).toMatchObject({ setting: "home", homeOpen: true });
    const s = await h.call("/focus", startBody({}, { setting: "home" }), cookie);
    expect(s.status).toBe(200);
    expect(h.db().prepare("SELECT setting FROM focus_checks WHERE id=?").get(s.data.id)).toEqual({
      setting: "home",
    });
    // The v1 movement check keeps its own home gate, closed as before.
    expect((await h.call("/assessments/context", undefined, cookie)).data).toMatchObject({ homeOpen: false });
  });

  it("refuses a booth start without a valid booth pass (BOOTH_REQUIRED)", async () => {
    const { cookie } = await person();
    expect((await h.call("/focus", startBody(), cookie)).data).toEqual({ error: "BOOTH_REQUIRED" });
    expect(
      (await h.call("/focus", startBody(), cookie, "POST", { "x-azm-booth": "f".repeat(64) })).data,
    ).toEqual({ error: "BOOTH_REQUIRED" });
    // A pass of the booth day stops holding once the booth is closed (another day).
    setTime(T0 + 2 * DAY);
    expect((await h.call("/focus", startBody(), cookie, "POST", booth())).data).toEqual({
      error: "BOOTH_REQUIRED",
    });
  });

  it("names the first bad field of a start body (START_INVALID)", async () => {
    const { cookie } = await person();
    const bad: [Record<string, unknown>, string][] = [
      [{ extra: 1 }, "extra"],
      // D-032 item 2: the day's one screen travels as today, with no v1 pre-check answers.
      [{ answers: {} }, "answers"],
      [{ today: { ...CALM_DAY, worrying: "no" } }, "today.worrying"],
      [{ today: { ...CALM_DAY, unsteady: 1 } }, "today.unsteady"],
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
      expect((await h.call("/focus", startBody({}, over), cookie, "POST", booth())).data).toEqual({
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

  it("records the focus check and Live coach consents from the health form's consent at the start (D-034 item 4)", async () => {
    const fresh = await person(v7Intake(), []);
    const active = (kind: string) =>
      h
        .db()
        .prepare("SELECT COUNT(*) AS n FROM consents WHERE user_id=? AND kind=? AND revoked_at IS NULL")
        .get(fresh.id, kind) as { n: number };
    expect(active("focus_check").n).toBe(0);
    expect((await h.call("/focus", startBody({}), fresh.cookie, "POST", booth())).status).toBe(200);
    expect(active("focus_check").n).toBe(1);
    expect(active("live_coach").n).toBe(1);
    // Without the health form's consent nothing is recorded and the start is refused.
    const none = await person(v7Intake(), []);
    const row = h.db().prepare("SELECT intake FROM profiles WHERE user_id=?").get(none.id) as {
      intake: string;
    };
    h.db()
      .prepare("UPDATE profiles SET intake=? WHERE user_id=?")
      .run(JSON.stringify({ ...JSON.parse(row.intake), consent: false }), none.id);
    expect((await h.call("/focus", startBody({}), none.cookie, "POST", booth())).data).toEqual({
      error: "CONSENT_REQUIRED",
    });
  });

  it("needs the adult confirmation", async () => {
    const minor = await person();
    h.db().prepare("DELETE FROM adult_confirmations WHERE user_id=?").run(minor.id);
    expect((await h.call("/focus", startBody({}), minor.cookie, "POST", booth())).data).toEqual({
      error: "ADULT_REQUIRED",
    });
  });

  it("refuses while a same day lock holds (LOCKED), with the lock as v1 shows it", async () => {
    const { cookie, id } = await person();
    const until = T0 + 3 * HOUR;
    setLock(h.db(), id, { until, releasableByClearance: false }, T0);
    const r = await h.call("/focus", startBody(), cookie, "POST", booth());
    expect(r.status).toBe(409);
    expect(r.data).toEqual({
      error: "LOCKED",
      ...lockView({ until, releasableByClearance: false }, T0, "return"),
    });
  });

  it("keeps 48 hours after the last completed check of either kind (TOO_SOON, two way)", async () => {
    const a = await person();
    const first = await started(a.cookie);
    const knee = item(first.protocol, "knee_flexion");
    expect((await h.call(`/focus/${first.id}/rom`, romBody(knee, 130), a.cookie)).status).toBe(200);
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
    // And a completed v1 check keeps a focus start of a joint it loaded waiting (its chair stand: the knee).
    const b = await person();
    v1Done(b.id, "v1-done", T0 + 9 * HOUR, [{ test: "chair_stand_30s", side: "none", value: 11 }]);
    expect((await start(b.cookie)).data).toEqual({ error: "TOO_SOON", until: T0 + 57 * HOUR });
    // After 48 hours the start goes ahead.
    setTime(T0 + 58 * HOUR);
    pass = await boothPass(h, T0 + 58 * HOUR);
    expect((await start(b.cookie)).status).toBe(200);
  });

  it("carries the earlier best seated side bend of each side, focus or v1 (D-027 item 2, W2-6)", async () => {
    const back = v7Intake({
      regions: [{ region: "back_trunk", side: "axial", problems: ["stiffness"], origin: "person" }],
      walking: { status: "no" },
    });
    // A first check: no earlier best, so the runner keeps the first check limit of 30 (v1.1).
    const a = await person(back);
    const first = await start(a.cookie);
    expect(first.status).toBe(200);
    expect(first.data.sideLeanBest).toEqual({ left: null, right: null });
    // A completed focus check bent seated on armrests (25 left, 31 right; another position never counts).
    const b = await person(back);
    const db = h.db();
    const done = (id: string, at: number) =>
      db
        .prepare(
          `INSERT INTO focus_checks(id,user_id,kind,setting,status,protocol,gait_plan,today,precheck,versions,device,intake_version,started,active,completed)
           VALUES(?,?,'baseline','booth','completed','{"rulesVersion":"r","items":[],"deferred":[],"notMeasured":[],"sitBeforeStand":false}',NULL,'{"painByRegion":{}}','{}','{}','{}',1,?,?,?)`,
        )
        .run(id, b.id, at, at, at);
    const lean = (check: string, side: string, position: string, value: number | null, created: number) =>
      db
        .prepare(
          `INSERT INTO rom_measurements(id,user_id,check_id,movement_id,side,position,value,unit,source,reason,pain,finding,attempts,flags,quality,n_valid,norms_version,created)
           VALUES(?,?,?,'trunk_lateral_flexion',?,?,?,'deg',?,NULL,0,?,'[]','[]','{}',1,'n',?)`,
        )
        .run(
          `${check}-${side}-${position}`,
          b.id,
          check,
          side,
          position,
          value,
          value === null ? "not_measured_today" : "measured",
          value === null ? "not_today" : "no_grade",
          created,
        );
    done("lean-1", T0 - 5 * DAY);
    lean("lean-1", "left", "seated_armrests", 25, T0 - 5 * DAY);
    lean("lean-1", "right", "seated_armrests", 31, T0 - 5 * DAY);
    done("lean-2", T0 - 4 * DAY);
    lean("lean-2", "left", "seated_armrests", 22, T0 - 4 * DAY);
    lean("lean-2", "right", "standing", 40, T0 - 4 * DAY);
    expect((await start(b.cookie)).data.sideLeanBest).toEqual({ left: 25, right: 31 });
    // A v1 side lean (trunk_control_seated) of 36 to the right is an earlier best too.
    v1Done(b.id, "v1-lean", T0 - 3 * DAY, [{ test: "trunk_control_seated", side: "right", value: 36 }]);
    expect((await start(b.cookie)).data.sideLeanBest).toEqual({ left: 25, right: 36 });
  });

  it("keeps 48 hours only between checks that share a joint (CT-3): another joint at any time", async () => {
    // A focus check of the neck alone, with no walk.
    const neckOnly = v7Intake({
      regions: [{ region: "neck", side: "axial", problems: ["stiffness"], origin: "person" }],
      walking: { status: "no" },
    });
    const a = await person(neckOnly);
    const first = await started(a.cookie);
    expect(first.gait?.offered).toBe(false);
    const neck = first.protocol.items.find((i) => i.region === "neck")!;
    expect((await h.call(`/focus/${first.id}/rom`, romBody(neck, 40), a.cookie)).status).toBe(200);
    expect((await h.call(`/focus/${first.id}/complete`, {}, a.cookie)).status).toBe(200);
    setTime(T0 + 10 * HOUR);
    pass = await boothPass(h, T0 + 10 * HOUR);
    // The neck again shares the joint: 48 hours, in the context and at the start.
    const ctx = await h.call("/focus/context", undefined, a.cookie, "GET", booth());
    expect(ctx.data.earliestNext).toBe(T0 + 48 * HOUR);
    expect((await start(a.cookie)).data).toEqual({ error: "TOO_SOON", until: T0 + 48 * HOUR });
    // A v1 check loads no neck: it may start at once (the pre-check answers come next).
    process.env.AZM_CHECK_HOME = "1";
    await h.call("/consents", { kind: "movement_check", version: 1 }, a.cookie);
    expect((await h.call("/assessments/context", undefined, a.cookie)).data.earliestNext).toBeNull();
    const v1 = await h.call(
      "/assessments",
      {
        answers: {},
        device: { model: "full", aspect: 0.56, fps: 28, engineVersion: "e1", appVersion: "7.0.0" },
      },
      a.cookie,
    );
    expect(v1.data.error).not.toBe("TOO_SOON");
    // A focus check of another joint (the right knee) may start at once.
    const knee = v7Intake({
      regions: [{ region: "knee", side: "right", problems: ["stiffness"], origin: "person" }],
      walking: { status: "no" },
    });
    expect((await h.call("/intake", knee, a.cookie, "PUT")).status).toBe(200);
    expect(
      (await h.call("/focus/context", undefined, a.cookie, "GET", booth())).data.earliestNext,
    ).toBeNull();
    expect((await start(a.cookie)).status).toBe(200);
  });

  it("a completed v1 check holds back only the joints its results loaded (CT-3, both ways)", async () => {
    // An arm curl on the right loads the right shoulder, elbow and wrist (check-v1 areas).
    const arm = await person(
      v7Intake({
        regions: [{ region: "knee", side: "right", problems: ["stiffness"], origin: "person" }],
        walking: { status: "no" },
      }),
    );
    v1Done(arm.id, "v1-arm", T0 - 2 * HOUR, [{ test: "arm_curl_30s", side: "right", value: 14 }]);
    expect(
      (await h.call("/focus/context", undefined, arm.cookie, "GET", booth())).data.earliestNext,
    ).toBeNull();
    expect((await start(arm.cookie)).status).toBe(200);
    // The right shoulder is one of them: 48 hours from that check.
    const shoulder = await person(
      v7Intake({
        regions: [{ region: "shoulder", side: "right", problems: ["stiffness"], origin: "person" }],
        walking: { status: "no" },
      }),
    );
    v1Done(shoulder.id, "v1-arm2", T0 - 2 * HOUR, [{ test: "arm_curl_30s", side: "right", value: 14 }]);
    expect((await start(shoulder.cookie)).data).toEqual({ error: "TOO_SOON", until: T0 + 46 * HOUR });
    // A walk measures the legs and the trunk, which the chair stand loads.
    const walker = await person(
      v7Intake({ regions: [{ region: "neck", side: "axial", problems: ["stiffness"], origin: "person" }] }),
    );
    v1Done(walker.id, "v1-stand", T0 - 2 * HOUR, [{ test: "chair_stand_30s", side: "none", value: 9 }]);
    expect((await start(walker.cookie)).data).toEqual({ error: "TOO_SOON", until: T0 + 46 * HOUR });
    // Without the walk today, the neck alone may start.
    expect((await start(walker.cookie, { include: { rom: true, gait: false } })).status).toBe(200);
  });

  it("skips the check today on a yes to the worry question: counts it, keeps no check, sets the next day lock (D-032)", async () => {
    const { cookie, id } = await person();
    const before = countOf("focus_started");
    const r = await start(cookie, {}, { worrying: true });
    expect(r.status).toBe(409);
    expect(r.data).toMatchObject({ error: "POSTPONE", status: "postpone", reason: "unwell" });
    expect(r.data.lock).toMatchObject({ until: expect.any(Number) });
    expect(countOf("focus_started")).toBe(before + 1);
    const db = h.db();
    expect(
      db
        .prepare(
          "SELECT count FROM safety_events WHERE reason='focus:precheck:day_worry' AND test_id='precheck'",
        )
        .get(),
    ).toMatchObject({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM focus_checks WHERE user_id=?").get(id)).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM check_locks WHERE user_id=?").get(id)).toEqual({ n: 1 });
    // After a yes nothing else is needed: a start with the worry answer alone is taken.
    const other = await person();
    const alone = await h.call(
      "/focus",
      startBody({}, { today: { painByRegion: {}, redFlagRegions: [], worrying: true } }),
      other.cookie,
      "POST",
      booth(),
    );
    expect(alone.data).toMatchObject({ error: "POSTPONE" });
    // The lock holds to its end: no question of the day releases it.
    expect((await start(cookie)).data).toMatchObject({ error: "LOCKED" });
  });

  it("needs no day answers: no day screen, pain before 0 in each area (D-034 item 4)", async () => {
    const { cookie } = await person();
    const bare = await h.call(
      "/focus",
      startBody({}, { today: { painByRegion: {}, redFlagRegions: [] } }),
      cookie,
      "POST",
      booth(),
    );
    expect(bare.status).toBe(200);
    expect(bare.data.gait?.offered).toBe(true);
    // At home too, with no one asked about: the start proceeds.
    const home = await person();
    const r = await h.call(
      "/focus",
      startBody({}, { setting: "home", today: { painByRegion: { knee: 0 }, redFlagRegions: [] } }),
      home.cookie,
    );
    expect(r.status).toBe(200);
  });

  it("refuses a day with nothing to measure (NOTHING_TO_MEASURE)", async () => {
    const { cookie } = await person();
    expect((await start(cookie, { include: { rom: false, gait: false } })).data).toEqual({
      error: "NOTHING_TO_MEASURE",
      warnings: expect.any(Array),
    });
    // Every region with a red flag and no walk: the seek care screen comes with the refusal.
    const r = await start(cookie, {}, { redFlagRegions: ["knee", "shoulder"] });
    expect(r.status).toBe(409);
    expect(r.data.error).toBe("NOTHING_TO_MEASURE");
    expect(r.data.warnings).toContain("scr_stop_seek_care");
  });

  it("walks with no gait day items: the walk's own card lets the person leave it out (D-034 item 4)", async () => {
    const calm = { painByRegion: {}, redFlagRegions: [] };
    const pd = await person(v7Intake({ conditions: ["parkinsons"] }));
    const r = await start(pd.cookie, { today: calm });
    expect(r.status).toBe(200);
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
    const today = {
      painByRegion: { knee: 3 },
      redFlagRegions: [],
      worrying: false,
      unsteady: false,
      walk10m: true,
    };
    const r = await h.call("/focus", startBody({}, { today }), cookie, "POST", booth());
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
    // Of the day's answers only those a later step reads are kept (the gait recompute at complete
    // reads the pain and unsteadiness as pc_steadi's fell and worry); the rest live on in the frozen
    // protocol (D-026 items 7 and 9). At the booth nobody is asked about: the staff are there.
    expect(JSON.parse(row.today as string)).toEqual({
      painByRegion: { knee: 3 },
      steadi: { fell: false, worry: false },
    });
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
    const r = await start(cookie, {}, { redFlagRegions: ["shoulder"] });
    expect(r.status).toBe(200);
    expect(r.data.warnings).toContain("scr_stop_seek_care");
    const p: RomProtocol = r.data.protocol;
    expect(p.items.filter((i) => i.region === "shoulder").every((i) => i.skipped === "red_flag")).toBe(true);
    // A leg region red flag would remove gait; a shoulder one keeps it.
    expect(r.data.gait.offered).toBe(true);
  });

  it("keeps only the day answers a later step reads; the others' effect is frozen (data minimisation)", async () => {
    const { cookie } = await person(v7Intake({ conditions: ["parkinsons"] }));
    const today = {
      painByRegion: { knee: 4 },
      redFlagRegions: ["shoulder"],
      worrying: false,
      unsteady: false,
      walk10m: true,
      pdFreezing: false,
      prosthesisOn: false,
      transferChair: false,
      orthosis: { right: "afo" },
    };
    const r = await start(cookie, { today });
    expect(r.status).toBe(200);
    expect(r.data.warnings).toContain("scr_stop_seek_care");
    // The red flag lives on in the protocol (red_flag skips) and the walk answers in the gait plan.
    expect((r.data.protocol as RomProtocol).items.some((i) => i.skipped === "red_flag")).toBe(true);
    const row = h.db().prepare("SELECT today FROM focus_checks WHERE id=?").get(r.data.id) as {
      today: string;
    };
    // The gait rules read the pain and unsteadiness as pc_steadi's fell and worry (CG-9); pc_pd_on is
    // no longer asked (D-032 item 2), and no leg limb loss, so no prosthesis answer.
    expect(JSON.parse(row.today)).toEqual({
      painByRegion: { knee: 4 },
      steadi: { fell: false, worry: false },
    });
    expect(row.today).not.toMatch(
      /redFlag|walk10m|pdFreezing|prosthesis|transfer|orthosis|afo|shoulder|worrying|unsteady/,
    );
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
      homeOpen: true,
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
    const s = await started(cookie, {}, { painByRegion: { shoulder: 7 } });
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

  it("counts range posts against 120 in 15 minutes (RATE_LIMIT)", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    for (let i = 0; i < 120; i++)
      expect((await h.call(`/focus/${s.id}/rom`, { movementId: "x" }, cookie)).status).toBe(400);
    expect((await h.call(`/focus/${s.id}/rom`, { movementId: "x" }, cookie)).data).toEqual({
      error: "RATE_LIMIT",
    });
  });

  it("takes a home check's results, its stops and its complete: home is open for v7 (D-032 item 1)", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    h.db().prepare("UPDATE focus_checks SET setting='home' WHERE id=?").run(s.id);
    const knee = item(s.protocol, "knee_flexion");
    expect((await h.call(`/focus/${s.id}/rom`, romBody(knee, 130), cookie)).status).toBe(200);
    expect((await h.call(`/focus/${s.id}/stop`, { option: "tired" }, cookie)).status).toBe(200);
    expect((await h.call(`/focus/${s.id}/complete`, {}, cookie)).data).toMatchObject({ status: "completed" });
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
    // The rules got the walk's setup, the stored day, the intake and the range profile so far.
    const input = gaitCalls.inputs.at(-1)!;
    expect(input.setup).toEqual(body.setup);
    expect(input.today).toEqual({ painByRegion: {}, steadi: { fell: false, worry: false } });
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
    // Each view keeps its pose model (C-10; D-024, A5-9); the response views stay as 2.9 types them.
    expect(JSON.parse(row.views).map((v: { poseModel: string }) => v.poseModel)).toEqual(["full", "full"]);
    expect(JSON.parse(row.setup)).toEqual(body.setup);
    expect((await h.call(`/focus/${s.id}/gait`, body, cookie)).data).toEqual({ error: "ALREADY_SAVED" });
  });

  it("keeps the walk's outcome and answers it with the walk (D-030 C4-5)", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    const body = gaitBody(s.gait!, "overground") as { analysis: Record<string, unknown> };
    body.analysis.outcome = "pain_limited";
    const r = await h.call(`/focus/${s.id}/gait`, body, cookie);
    expect(r.status).toBe(200);
    expect(r.data.outcome).toBe("pain_limited");
    const row = h.db().prepare("SELECT metrics FROM gait_analyses WHERE check_id=?").get(s.id) as {
      metrics: string;
    };
    expect(JSON.parse(row.metrics).outcome).toBe("pain_limited");
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

  it("stores the pose model of each view, and the analysis's model is lite when any view used Lite (D-024, A5-9)", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    const body = gaitBody(s.gait!, "overground");
    body.analysis.views[1].poseModel = "lite";
    expect((await h.call(`/focus/${s.id}/gait`, body, cookie)).status).toBe(200);
    const row = h.db().prepare("SELECT views, pose_model FROM gait_analyses WHERE check_id=?").get(s.id) as {
      views: string;
      pose_model: string;
    };
    expect(
      JSON.parse(row.views).map((v: { view: string; poseModel: string }) => [v.view, v.poseModel]),
    ).toEqual([
      ["side", "full"],
      ["front", "lite"],
    ]);
    expect(row.pose_model).toBe("lite");
    // complete gives the rules each view's model as the gait POST did.
    expect((await h.call(`/focus/${s.id}/complete`, {}, cookie)).status).toBe(200);
    expect(gaitCalls.inputs.at(-1)!.analysis.views.map((v) => v.poseModel)).toEqual(["full", "lite"]);
  });

  it("reads a view stored without its pose model as the analysis's model", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    expect(
      (await h.call(`/focus/${s.id}/gait`, gaitBody(s.gait!, "walking_pad", { worst: true }), cookie)).status,
    ).toBe(200);
    const db = h.db();
    const { views } = db.prepare("SELECT views FROM gait_analyses WHERE check_id=?").get(s.id) as {
      views: string;
    };
    const before = (JSON.parse(views) as Record<string, unknown>[]).map(({ poseModel: _m, ...v }) => v);
    db.prepare("UPDATE gait_analyses SET views=? WHERE check_id=?").run(JSON.stringify(before), s.id);
    expect((await h.call(`/focus/${s.id}/complete`, {}, cookie)).status).toBe(200);
    expect(gaitCalls.inputs.at(-1)!.analysis.views.every((v) => v.poseModel === "lite")).toBe(true);
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

  it("needs the pose model of each view, Lite or Full (D-024, A5-9)", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    for (const poseModel of [undefined, "heavy", null]) {
      const body = gaitBody(s.gait!, "overground");
      (body.analysis.views[0] as { poseModel?: unknown }).poseModel = poseModel;
      if (poseModel === undefined) delete (body.analysis.views[0] as { poseModel?: unknown }).poseModel;
      expect((await h.call(`/focus/${s.id}/gait`, body, cookie)).data, String(poseModel)).toEqual({
        error: "GAIT_INVALID",
        field: "analysis.views.poseModel",
      });
    }
  });

  it("takes a walk only into an open check, 20 posts in 15 minutes", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    const knee = item(s.protocol, "knee_flexion");
    expect((await h.call(`/focus/${s.id}/rom`, romBody(knee, 130), cookie)).status).toBe(200);
    expect((await h.call(`/focus/${s.id}/complete`, {}, cookie)).status).toBe(200);
    const body = gaitBody(s.gait!, "overground");
    expect((await h.call(`/focus/${s.id}/gait`, body, cookie)).data).toEqual({
      error: "NOT_OPEN",
      status: "completed",
    });
    // 20 posts in all are taken (this one and 19 more); the 21st is refused before its body is read.
    for (let i = 0; i < 19; i++) expect((await h.call(`/focus/${s.id}/gait`, {}, cookie)).status).toBe(409);
    expect((await h.call(`/focus/${s.id}/gait`, {}, cookie)).data).toEqual({ error: "RATE_LIMIT" });
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

  it("reads a not measured row with no pose model and no engine version (D-024, A5-5)", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    const flex = item(s.protocol, "shoulder_flexion");
    expect((await h.call(`/focus/${s.id}/rom`, romBody(flex, 120), cookie)).status).toBe(200);
    expect((await h.call(`/focus/${s.id}/stop`, { option: "chest" }, cookie)).status).toBe(200);
    const rows = romRowsOf(h.db(), s.id);
    const row = (movementId: string) => rows.find((r) => r.movementId === movementId && r.side === "right")!;
    // The measured row keeps what the phone sent.
    expect(row("shoulder_flexion")).toMatchObject({
      source: "measured",
      poseModel: "full",
      movementVersion: movementDef("shoulder_flexion").version,
      engineVersion: "rom_engine_1",
    });
    // A measured movement never reached: its movement version, no model, no engine.
    expect(row("shoulder_extension")).toMatchObject({
      source: "not_measured_today",
      poseModel: null,
      movementVersion: movementDef("shoulder_extension").version,
      engineVersion: null,
    });
    // A default only movement: no version of any kind.
    expect(row("shoulder_external_rotation")).toMatchObject({
      source: "not_measured_camera",
      poseModel: null,
      movementVersion: null,
      engineVersion: null,
    });
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

  it("takes a safety stop of a home check: its lock, dates and counts (v1 safetyCheck)", async () => {
    // A home check with no booth pass (D-032 item 1).
    const { cookie, id } = await person();
    const ctx = await h.call("/focus/context", undefined, cookie);
    expect(ctx.data.setting).toBe("home");
    const r = await h.call("/focus", startBody({}, { setting: "home" }), cookie);
    expect(r.status).toBe(200);
    const s = r.data as { id: string };
    const db = h.db();
    const safetyBefore =
      (
        db.prepare("SELECT SUM(count) AS n FROM safety_events WHERE reason='focus:stop:chest'").get() as {
          n: number | null;
        }
      ).n ?? 0;
    const stop = await h.call(
      `/focus/${s.id}/stop`,
      { option: "chest", movementId: "shoulder_flexion", side: "right" },
      cookie,
    );
    expect(stop.status).toBe(200);
    expect(stop.data.route).toMatchObject({ option: "chest", screen: "scr_emergency", endsCheck: true });
    expect(stop.data.lock).toMatchObject({ until: expect.any(Number) });
    expect(db.prepare("SELECT COUNT(*) AS n FROM check_locks WHERE user_id=?").get(id)).toEqual({ n: 1 });
    expect(db.prepare("SELECT change_reported FROM check_state WHERE user_id=?").get(id)).toEqual({
      change_reported: "2026-10-04",
    });
    expect(
      (
        db.prepare("SELECT SUM(count) AS n FROM safety_events WHERE reason='focus:stop:chest'").get() as {
          n: number;
        }
      ).n,
    ).toBe(safetyBefore + 1);
    expect(db.prepare("SELECT status, ended_reason FROM focus_checks WHERE id=?").get(s.id)).toEqual({
      status: "ended_early",
      ended_reason: "stop",
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
    const s = await started(cookie, {}, { painByRegion: { hip: 2 }, redFlagRegions: ["elbow"] });
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
    // The findings are stream B's (romFindings); the route returns what they give.
    expect(Array.isArray(r.data.findings)).toBe(true);
    // Complete closes the check.
    expect((await h.call(`/focus/${s.id}/complete`, {}, cookie)).data).toEqual({
      error: "NOT_OPEN",
      status: "completed",
    });
  });

  it("gives the gait rules at complete what they had at the gait POST, the walk's events aside", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    const body = gaitBody(s.gait!, "walking_pad", { worst: true });
    expect((await h.call(`/focus/${s.id}/gait`, body, cookie)).status).toBe(200);
    expect((await h.call(`/focus/${s.id}/complete`, {}, cookie)).status).toBe(200);
    const [posted, final] = gaitCalls.inputs.slice(-2).map((i) => i.analysis);
    const strip = (a: typeof posted) => ({
      ...a,
      views: a.views.map((v) => ({ ...v, events: [], cycles: [] })),
    });
    expect(final).toEqual(strip(posted));
    expect(final.staticStance).toHaveLength(2);
    expect(final.views[0].quality).toMatchObject({ medianFps: 28.5, gapShare: 0.04, gatePassed: true });
  });

  it("lets a later profile read write the walk's lines again through the gait rules (D-027 item 7)", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    expect((await h.call(`/focus/${s.id}/gait`, gaitBody(s.gait!, "overground"), cookie)).status).toBe(200);
    expect((await h.call(`/focus/${s.id}/complete`, {}, cookie)).status).toBe(200);
    const r = await h.call("/focus/profile", undefined, cookie);
    expect(r.status).toBe(200);
    // The stored patterns keep no lines (section 3); the route writes them with withGaitLines.
    expect(r.data.gait.patterns.map((p: { lines: unknown }) => p.lines)).toEqual([REWRITTEN_LINES]);
  });

  it("gives the rules at complete the stored setup, the walk's pain marks and the kept day answers (D-026 item 7)", async () => {
    const { cookie } = await person(v7Intake({ conditions: ["parkinsons"] }));
    const s = await started(cookie, {}, { pdFreezing: false, unsteady: true });
    const body = gaitBody(s.gait!, "overground");
    const setup = { ...body.setup, aid: "cane", orthosis: { right: "afo" } };
    const walkPain = [
      { side: "right", level: 3 },
      { side: null, level: 1 },
    ];
    const r = await h.call(
      `/focus/${s.id}/gait`,
      { setup, analysis: { ...body.analysis, walkPain } },
      cookie,
    );
    expect(r.status).toBe(200);
    const posted = gaitCalls.inputs.at(-1)!;
    expect(posted.setup).toEqual(setup);
    expect(posted.analysis.walkPain).toEqual(walkPain);
    expect(posted.today).toEqual({
      painByRegion: {},
      steadi: { fell: true, worry: true },
    });
    // The marks are kept with the walk (the metrics column, beside the static stance), never a word.
    const row = h.db().prepare("SELECT metrics FROM gait_analyses WHERE check_id=?").get(s.id) as {
      metrics: string;
    };
    expect(JSON.parse(row.metrics).walkPain).toEqual(walkPain);
    expect((await h.call(`/focus/${s.id}/complete`, {}, cookie)).status).toBe(200);
    const final = gaitCalls.inputs.at(-1)!;
    expect(final.setup).toEqual(setup);
    expect(final.analysis.walkPain).toEqual(walkPain);
    expect(final.today).toEqual(posted.today);
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

  it("refuses a check with nothing stored (NO_RESULTS, as v1 complete-needs-row): no clock, no baseline", async () => {
    const { cookie, id } = await person();
    const s = await started(cookie);
    const before = countOf("focus_completed");
    // The app crashed or the person left at once: complete arrives with no range row and no walk.
    expect(await h.call(`/focus/${s.id}/complete`, {}, cookie)).toMatchObject({
      status: 409,
      data: { error: "NO_RESULTS" },
    });
    const db = h.db();
    expect(db.prepare("SELECT status, completed FROM focus_checks WHERE id=?").get(s.id)).toEqual({
      status: "open",
      completed: null,
    });
    expect(rowsOf(s.id)).toEqual([]);
    expect(countOf("focus_completed")).toBe(before);
    // No 48 hour clock starts and the check is no baseline: a new start goes ahead as a baseline.
    setTime(T0 + 10 * HOUR);
    pass = await boothPass(h, T0 + 10 * HOUR);
    const next = await started(cookie);
    expect(next.kind).toBe("baseline");
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM focus_checks WHERE user_id=? AND status='completed'").get(id),
    ).toEqual({
      n: 0,
    });
    // A stored walk alone is a result: that check completes.
    expect((await h.call(`/focus/${next.id}/gait`, gaitBody(next.gait!, "overground"), cookie)).status).toBe(
      200,
    );
    expect((await h.call(`/focus/${next.id}/complete`, {}, cookie)).status).toBe(200);
  });

  it("completes a check whose only row is a stopped movement's (a stored row, as v1 counts a skip)", async () => {
    const { cookie } = await person();
    const s = await started(cookie);
    const flex = item(s.protocol, "shoulder_flexion");
    expect(
      (
        await h.call(
          `/focus/${s.id}/stop`,
          { option: "tired", movementId: flex.movementId, side: "right" },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect((await h.call(`/focus/${s.id}/complete`, {}, cookie)).status).toBe(200);
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
