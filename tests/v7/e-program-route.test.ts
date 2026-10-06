/**
 * Step E2 (product v7 contract 2.10 and section 4, 8.1 E): POST /api/program/targets on the real focus
 * routes (A's harness, FOCUS_RULES, AZM_V7, a booth pass), and the intake hook. The targeted week is
 * stored in profiles.plan.weekly with its findings ref, pinned to the plan's version; a refresh of
 * POST /api/plan/weekly never replaces it; removing a region from the body map drops that region's
 * findings' items on the next intake save, with the walk's patterns kept.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { BUILDS_PER_WINDOW } from "../../server/modules/program/routes";
import type { Intake } from "../../src/medical/plan";
import type { RomProtocol, RomProtocolItem } from "../../src/medical/rom-protocol";
import type { TargetReason } from "../../src/medical/target-types";
import type { WeeklyItem, WeeklyPlan } from "../../src/medical/weekly";
import { TARGETS_VERSION } from "../../src/movements/targets";
import { fill } from "../precheck-fixtures";
import { gaitBody, romBody } from "./a-focus-bodies";
import {
  DAY,
  HOUR,
  T0,
  boothPass,
  member,
  register,
  startV7Api,
  v1Intake,
  v7Intake,
  type V7Harness,
} from "./a-harness";
import type { GaitPlan } from "../../src/medical/gait-eligibility";

let h: V7Harness;
let pass = "";
let n = 0;
const setTime = (t: number) => vi.setSystemTime(t);

beforeAll(async () => {
  h = await startV7Api(FOCUS_RULES);
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setTime(T0);
  process.env.AZM_V7 = "1";
  pass = await boothPass(h, T0);
});
afterEach(() => {
  vi.useRealTimers();
  for (const k of ["AZM_V7", "AZM_BOOTH_DATES", "AZM_BOOTH_CODE"]) delete process.env[k];
});

/** Fahd's shape (D-025 CT-1): weaker right side after a stroke, the condition's regions on the map. */
const FAHD = v7Intake({
  regions: [
    { region: "shoulder", side: "right", problems: ["weakness"], origin: "condition" },
    { region: "knee", side: "right", problems: ["weakness"], origin: "condition" },
  ],
});

async function person(intake: Intake = FAHD) {
  n += 1;
  return member(h, `program${n}@example.test`, intake, ["focus_check"]);
}
const booth = () => ({ "x-azm-booth": pass });

async function started(cookie: string) {
  const c = await h.call("/focus/context", undefined, cookie, "GET", booth());
  if (c.status !== 200 || !c.data.env) throw new Error(`context ${c.status} ${JSON.stringify(c.data)}`);
  const r = await h.call(
    "/focus",
    {
      setting: "booth",
      answers: fill(c.data.env),
      today: { painByRegion: {}, redFlagRegions: [], walk10m: true },
      device: { os: "iOS", browser: "Safari" },
      include: { rom: true, gait: true },
    },
    cookie,
    "POST",
    booth(),
  );
  if (r.status !== 200) throw new Error(`start ${r.status} ${JSON.stringify(r.data)}`);
  return r.data as { id: string; kind: string; protocol: RomProtocol; gait: GaitPlan | null };
}

const item = (p: RomProtocol, movementId: string, side = "right") => {
  const i = p.items.find((x) => x.movementId === movementId && x.side === side && !x.skipped);
  if (!i) throw new Error(`no runnable ${movementId} ${side}`);
  return i as RomProtocolItem;
};

/** A completed check with a measured value for each movement and, when asked, a walk. */
async function check(cookie: string, values: Record<string, number>, walk = false) {
  const s = await started(cookie);
  for (const [movementId, value] of Object.entries(values)) {
    const r = await h.call(`/focus/${s.id}/rom`, romBody(item(s.protocol, movementId), value), cookie);
    if (r.status !== 200) throw new Error(`rom ${movementId} ${r.status} ${JSON.stringify(r.data)}`);
  }
  if (walk) {
    const r = await h.call(`/focus/${s.id}/gait`, gaitBody(s.gait!, "overground"), cookie);
    if (r.status !== 200) throw new Error(`gait ${r.status} ${JSON.stringify(r.data)}`);
  }
  const done = await h.call(`/focus/${s.id}/complete`, {}, cookie);
  if (done.status !== 200) throw new Error(`complete ${done.status} ${JSON.stringify(done.data)}`);
  return s;
}

const targets = (cookie: string, body: Record<string, unknown> = {}) =>
  h.call("/program/targets", body, cookie);
const me = async (cookie: string) =>
  (await h.call("/auth/me", undefined, cookie)).data as {
    intake: Intake;
    plan: { weekly?: WeeklyPlan; version: number };
  };
const weekItems = (w: WeeklyPlan): WeeklyItem[] =>
  w.days.flatMap((d) => [...d.warmup, ...d.extra, ...d.cooldown]);
const reasonsOf = (w: WeeklyPlan): TargetReason[] => weekItems(w).flatMap((i) => i.reasonRefs ?? []);

describe("POST /api/program/targets", () => {
  it("is a v7 route for a signed in person (404 with the flag off, 401 without a session)", async () => {
    const cookie = await person();
    delete process.env.AZM_V7;
    expect(await targets(cookie)).toMatchObject({ status: 404, data: { error: "NOT_FOUND" } });
    process.env.AZM_V7 = "1";
    expect(await targets("")).toMatchObject({ status: 401, data: { error: "AUTH_REQUIRED" } });
  });

  it("refuses a key other than checkId and a malformed id (400 TARGETS_INVALID)", async () => {
    const cookie = await person();
    expect(await targets(cookie, { refresh: true })).toMatchObject({
      status: 400,
      data: { error: "TARGETS_INVALID", field: "refresh" },
    });
    expect(await targets(cookie, { checkId: "c1" })).toMatchObject({
      status: 400,
      data: { error: "TARGETS_INVALID", field: "checkId" },
    });
    expect(await targets(cookie, { checkId: 4 })).toMatchObject({
      status: 400,
      data: { error: "TARGETS_INVALID", field: "checkId" },
    });
  });

  it("needs a ready plan and the v7 intake (409)", async () => {
    n += 1;
    const none = await register(h, `program-none${n}@example.test`);
    expect(await targets(none)).toMatchObject({ status: 409, data: { error: "PLAN_REQUIRED" } });
    n += 1;
    const v1 = await member(h, `program-v1${n}@example.test`, v1Intake());
    expect(await targets(v1)).toMatchObject({ status: 409, data: { error: "INTAKE_UPDATE_REQUIRED" } });
  });

  it("answers 404 NO_FINDINGS without a completed check of the person", async () => {
    const cookie = await person();
    expect(await targets(cookie)).toMatchObject({ status: 404, data: { error: "NO_FINDINGS" } });
    const open = await started(cookie);
    expect(await targets(cookie)).toMatchObject({ status: 404, data: { error: "NO_FINDINGS" } });
    expect(await targets(cookie, { checkId: open.id })).toMatchObject({
      status: 404,
      data: { error: "NO_FINDINGS" },
    });
    const other = await person();
    setTime(T0 + HOUR);
    const theirs = await check(other, { knee_flexion: 90 });
    expect(await targets(cookie, { checkId: theirs.id })).toMatchObject({
      status: 404,
      data: { error: "NO_FINDINGS" },
    });
  });

  it("builds the week from the latest completed check and stores it with its findings ref and why lines", async () => {
    const cookie = await person();
    const s = await check(cookie, { knee_flexion: 80, shoulder_flexion: 100 });
    const before = await me(cookie);
    const r = await targets(cookie);
    expect(r.status).toBe(200);
    expect(Object.keys(r.data).sort()).toEqual(["referrals", "targets", "unmet", "version", "weekly"]);
    const w = r.data.weekly as WeeklyPlan;
    expect(w.findings).toMatchObject({ checkId: s.id, targetsVersion: TARGETS_VERSION, gaitVersion: null });
    expect(r.data.version).toBe(before.plan.version);
    const finding = weekItems(w).filter((i) => i.why);
    expect(finding.length).toBeGreaterThan(0);
    expect(reasonsOf(w).some((x) => x.kind === "rom" && x.movementId === "knee_flexion")).toBe(true);
    expect(r.data.targets.length).toBeGreaterThan(0);
    // Stored in the plan, as the Today and Program pages read it.
    const after = await me(cookie);
    expect(after.plan.weekly).toEqual(w);
    expect(after.plan.version).toBe(before.plan.version);
  });

  it("answers a week already built from the same check as stored, and a refresh never replaces it", async () => {
    const cookie = await person();
    await check(cookie, { knee_flexion: 80 });
    const first = (await targets(cookie)).data.weekly as WeeklyPlan;
    setTime(T0 + 2 * HOUR);
    const again = (await targets(cookie)).data.weekly as WeeklyPlan;
    expect(again).toEqual(first);
    for (const body of [{}, { refresh: true }]) {
      const r = await h.call("/plan/weekly", body, cookie);
      expect(r.status).toBe(200);
      expect(r.data.weekly).toEqual(first);
    }
    expect((await me(cookie)).plan.weekly).toEqual(first);
  });

  it("builds from an earlier completed check when it is named, and from the walk's patterns too", async () => {
    const cookie = await person();
    const first = await check(cookie, { knee_flexion: 80 }, true);
    setTime(T0 + 3 * DAY);
    pass = await boothPass(h, T0 + 3 * DAY);
    const second = await check(cookie, { knee_flexion: 125 });
    const latest = await targets(cookie);
    expect(latest.data.weekly.findings.checkId).toBe(second.id);
    const named = await targets(cookie, { checkId: first.id });
    expect(named.status).toBe(200);
    expect(named.data.weekly.findings).toMatchObject({ checkId: first.id, gaitVersion: expect.any(String) });
    expect((await me(cookie)).plan.weekly!.findings!.checkId).toBe(first.id);
  });

  it("gives the walk's support findings their targets (D-029 item 1, E2-4)", async () => {
    const cookie = await person();
    const s = await check(cookie, { knee_flexion: 125 }, true);
    // The walk's stored support findings: a slow walk (a finding with one rule).
    const slow = { id: "slow_speed", side: "none", value: 0.6, status: null, flags: ["norm_interim"] };
    const db = h.db();
    const row = db.prepare("SELECT id, findings FROM gait_analyses WHERE check_id=?").get(s.id) as {
      id: string;
      findings: string;
    };
    const stored = { ...JSON.parse(row.findings), findings: [slow] };
    db.prepare("UPDATE gait_analyses SET findings=? WHERE id=?").run(JSON.stringify(stored), row.id);
    const r = await targets(cookie);
    expect(r.status).toBe(200);
    const reason: TargetReason = { kind: "gait_finding", id: "slow_speed", side: "none", status: null };
    const walking = (r.data.targets as { id: string; reasons: TargetReason[] }[]).find(
      (t) => t.id === "practice:walking",
    );
    expect(walking?.reasons).toContainEqual(reason);
    expect(reasonsOf(r.data.weekly)).toContainEqual(reason);
  });

  it("limits the builds to 10 in 15 minutes (429 RATE_LIMIT)", async () => {
    const cookie = await person();
    const a = await check(cookie, { knee_flexion: 80 });
    setTime(T0 + 3 * DAY);
    pass = await boothPass(h, T0 + 3 * DAY);
    const b = await check(cookie, { knee_flexion: 100 });
    // Each call names the other check, so each builds.
    for (let i = 0; i < BUILDS_PER_WINDOW; i++)
      expect((await targets(cookie, { checkId: i % 2 ? a.id : b.id })).status, `build ${i + 1}`).toBe(200);
    // The 10th build was a's week: b's would be the 11th.
    expect(await targets(cookie, { checkId: b.id })).toMatchObject({
      status: 429,
      data: { error: "RATE_LIMIT" },
    });
    // The stored week is still answered without a build.
    expect((await targets(cookie, { checkId: a.id })).status).toBe(200);
  });
});

describe("afterIntakeSaved (PUT /api/intake with AZM_V7=1)", () => {
  it("removing the knee from the body map drops the knee findings' items on the next intake save", async () => {
    const cookie = await person();
    await check(cookie, { knee_flexion: 80, shoulder_flexion: 100 }, true);
    const built = (await targets(cookie)).data.weekly as WeeklyPlan;
    const knee = (w: WeeklyPlan) =>
      reasonsOf(w).some((x) => x.kind === "rom" && x.movementId.startsWith("knee"));
    const shoulder = (w: WeeklyPlan) =>
      reasonsOf(w).some((x) => x.kind === "rom" && x.movementId.startsWith("shoulder"));
    expect(knee(built)).toBe(true);
    setTime(T0 + HOUR);
    const noKnee: Intake = { ...FAHD, regions: FAHD.regions!.filter((e) => e.region !== "knee") };
    const saved = await h.call("/intake", noKnee, cookie, "PUT");
    expect(saved.status).toBe(200);
    const after = await me(cookie);
    expect(after.plan.version).toBe(saved.data.plan.version);
    const w = after.plan.weekly!;
    expect(w.findings!.checkId).toBe(built.findings!.checkId);
    expect(w.findings!.created).toBeGreaterThan(built.findings!.created);
    expect(knee(w)).toBe(false);
    expect(shoulder(w)).toBe(true);
  });

  it("does nothing without a completed check, and the flag off leaves the plan as saved", async () => {
    const cookie = await person();
    const saved = await h.call("/intake", FAHD, cookie, "PUT");
    expect(saved.status).toBe(200);
    expect((await me(cookie)).plan.weekly).toBeUndefined();
    await check(cookie, { knee_flexion: 80 });
    delete process.env.AZM_V7;
    setTime(T0 + HOUR);
    expect((await h.call("/intake", FAHD, cookie, "PUT")).status).toBe(200);
    expect((await me(cookie)).plan.weekly).toBeUndefined();
    process.env.AZM_V7 = "1";
    setTime(T0 + 2 * HOUR);
    expect((await h.call("/intake", FAHD, cookie, "PUT")).status).toBe(200);
    expect((await me(cookie)).plan.weekly!.findings).toBeDefined();
  });
});
