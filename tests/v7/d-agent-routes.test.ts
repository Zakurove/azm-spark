/**
 * Stream D, step D2: POST /api/agent/token and POST /api/agent/usage (product v7 contract 5.1, 5.2,
 * C-6, C-12, C-14; D-022 S0-1, S0-3, S0-4), through the API on the real focus rules, with Google's
 * token endpoint stubbed (one fetch; the test's own calls to the API go through).
 *
 * The token route checks, in order: AZM_V7 (404), the coach switched on with a key (503), the body
 * (400 AGENT_INVALID), the live_coach consent (403), an open ref of the person (409 NOT_OPEN), the
 * focus check's home gate, open for v7 (D-032 item 1), the segment of the ref (400), the rate limits
 * (429 RATE_LIMIT), then the budget (429 BUDGET), and mints from stored state only.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { createFocusCheck } from "../../server/modules/focus/store";
import { clearLock, setLock } from "../../server/modules/assessments/store";
import { segmentsFor, type CheckSegment } from "../../server/modules/agent/segments";
import { buildHistory, buildInstruction, COACH_SI_VERSION } from "../../src/coach/instruction";
import { toolDeclarations } from "../../src/coach/tools";
import { typicalValue } from "../../src/medical/rom-norms";
import type { RomProtocol } from "../../src/medical/rom-protocol";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import type { Intake } from "../../src/medical/plan";
import { MINUTE, PASSWORD, T0, boothPass, startV7Api, userId, v7Intake, type V7Harness } from "./a-harness";

const KEY = "test-gemini-key-SECRET-7f3a9c";
const GOOGLE = "https://generativelanguage.googleapis.com/";
const HOUR = 60 * MINUTE;
let h: V7Harness;
let pass = "";
let google: { url: string; headers: Record<string, string>; body: any }[] = [];
let googleReply: () => Response = () => new Response(JSON.stringify({ name: "auth_tokens/tok123" }));
let logs: string[] = [];
let ipCounter = 0;
let emailCounter = 0;

beforeAll(async () => {
  h = await startV7Api(FOCUS_RULES);
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  process.env.AZM_V7 = "1";
  process.env.AZM_AGENT_ENABLED = "1";
  process.env.GEMINI_API_KEY = KEY;
  // Every test of this file mints on the same day in one database: the global guard has its own test.
  process.env.AZM_AGENT_GLOBAL_DAILY_MINUTES = "100000";
  pass = await boothPass(h, T0);
  google = [];
  googleReply = () => new Response(JSON.stringify({ name: "auth_tokens/tok123" }));
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (!String(url).startsWith(GOOGLE)) return real(url, init);
    google.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    return googleReply();
  });
  logs = [];
  for (const level of ["log", "warn", "error", "info"] as const)
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const k of [
    "AZM_V7",
    "AZM_AGENT_ENABLED",
    "GEMINI_API_KEY",
    "AZM_BOOTH_DATES",
    "AZM_BOOTH_CODE",
    "AZM_AGENT_USER_DAILY_MINUTES",
    "AZM_AGENT_GLOBAL_DAILY_MINUTES",
  ])
    delete process.env[k];
});

/* ------------------------------------------------------------- helpers */

/** A device id of its own per member: the per device limit (20 an hour) would otherwise join the tests. */
let deviceCounter = 0;
const newDevice = () => `device-test-${String(++deviceCounter).padStart(6, "0")}`;
/** A fresh client address per test, so the per IP limit of one test never reaches another. */
const freshIp = () => ({ "x-forwarded-for": `10.7.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` });

/**
 * A member with this intake and these consents, registered from an address of its own: this file
 * registers more people than the sign up limit allows one address in 15 minutes (the clock is fixed).
 */
async function member(h: V7Harness, email: string, intake: Intake, consents: string[] = []): Promise<string> {
  const r = await h.call(
    "/auth/register",
    { name: "Focus Member", email, password: PASSWORD, adultConfirmed: true },
    "",
    "POST",
    freshIp(),
  );
  if (r.status !== 200) throw new Error(`register ${email}: ${r.status}`);
  const saved = await h.call("/intake", intake, r.cookie, "PUT");
  if (saved.status !== 200) throw new Error(`intake ${email}: ${saved.status} ${JSON.stringify(saved.data)}`);
  for (const kind of consents) {
    const ok = await h.call("/consents", { kind, version: 1 }, r.cookie);
    if (ok.status !== 200) throw new Error(`consent ${kind}: ${ok.status}`);
  }
  return r.cookie;
}

interface Started {
  cookie: string;
  device: string;
  user: string;
  id: string;
  protocol: RomProtocol;
  gait: GaitPlan | null;
  segments: CheckSegment[];
  intake: Intake;
}

/** A member with the live_coach consent (unless `consents` says otherwise) and an open booth focus check. */
async function started(
  intake: Intake = v7Intake(),
  consents = ["focus_check", "live_coach"],
  today: Record<string, unknown> = {},
): Promise<Started> {
  const cookie = await member(h, `agent-${++emailCounter}@example.test`, intake, consents);
  const booth = { "x-azm-booth": pass };
  const c = await h.call("/focus/context", undefined, cookie, "GET", booth);
  expect(c.status).toBe(200);
  const s = await h.call(
    "/focus",
    {
      setting: "booth",
      today: {
        painByRegion: {},
        redFlagRegions: [],
        worrying: false,
        unsteady: false,
        walk10m: true,
        ...today,
      },
      device: { os: "iOS", browser: "Safari" },
      include: { rom: true, gait: true },
    },
    cookie,
    "POST",
    booth,
  );
  expect(s.status, JSON.stringify(s.data)).toBe(200);
  return {
    cookie,
    device: newDevice(),
    user: await userId(h, cookie),
    id: s.data.id,
    protocol: s.data.protocol,
    gait: s.data.gait,
    segments: segmentsFor(s.data.protocol, s.data.gait),
    intake,
  };
}

function romSegment(st: Started): Extract<CheckSegment, { block: "rom" }> {
  const seg = st.segments.find((s) => s.block === "rom");
  if (!seg || seg.block !== "rom") throw new Error("no range segment");
  return seg;
}

function tokenBody(st: Started, over: Record<string, unknown> = {}) {
  const seg = romSegment(st);
  return {
    block: "rom",
    segment: seg.segment,
    lang: "ar",
    ref: { checkId: st.id },
    deviceId: st.device,
    ...over,
  };
}

const token = (body: unknown, cookie: string, extra: Record<string, string> = freshIp()) =>
  h.call("/agent/token", body, cookie, "POST", extra);

const usage = (body: unknown, cookie: string, extra: Record<string, string> = {}) =>
  h.call("/agent/usage", body, cookie, "POST", extra);

/** The coach_fallback counts by key and setting. */
function fallbacks(): Record<string, number> {
  const rows = h
    .db()
    .prepare("SELECT key, setting, count FROM product_counts WHERE metric='coach_fallback'")
    .all() as { key: string; setting: string; count: number }[];
  return Object.fromEntries(rows.map((r) => [`${r.key}:${r.setting}`, Number(r.count)]));
}

function row(id: string): Record<string, any> {
  return h.db().prepare("SELECT * FROM agent_sessions WHERE id=?").get(id) as Record<string, any>;
}

/** A guided workout of today for this member (POST /api/workouts as the Program page starts it). */
async function workout(cookie: string): Promise<{ id: string; version: number }> {
  const me = await h.call("/plan/weekly", {}, cookie);
  expect(me.status).toBe(200);
  const version = me.data.version as number;
  const w = await h.call("/workouts", { version, demo: false, guided: true }, cookie);
  expect(w.status, JSON.stringify(w.data)).toBe(200);
  return { id: w.data.id, version };
}

const report = (sessionId: string, over: Record<string, unknown> = {}) => ({
  sessionId,
  connectMs: 950,
  durationSec: 240,
  turns: 12,
  toolCalls: { confirm_max: { ok: 3, rejected: 1 }, mark_pain: { ok: 1, rejected: 0 } },
  promptTokens: 21000,
  responseTokens: 3400,
  firstAudioMs: { p50: 700, p90: 1020 },
  endReason: "done",
  ...over,
});

/* --------------------------------------------------------------- tests */

describe("POST /api/agent/token: the order of checks", () => {
  it("answers 503 AGENT_UNAVAILABLE while the coach is switched off or has no key", async () => {
    const st = await started();
    delete process.env.AZM_AGENT_ENABLED;
    expect((await token(tokenBody(st), st.cookie)).data).toEqual({ error: "AGENT_UNAVAILABLE" });
    // The usage report has no such check (it asks nothing of Google): an unknown session is 404.
    expect((await usage(report("11111111-2222-4333-8444-555555555555"), st.cookie)).status).toBe(404);
    process.env.AZM_AGENT_ENABLED = "1";
    delete process.env.GEMINI_API_KEY;
    expect((await token(tokenBody(st), st.cookie)).status).toBe(503);
    expect(google).toHaveLength(0);
  });

  it("answers 404 with AZM_V7 off and 401 without a session", async () => {
    const st = await started();
    delete process.env.AZM_V7;
    expect((await token(tokenBody(st), st.cookie)).data).toEqual({ error: "NOT_FOUND" });
    process.env.AZM_V7 = "1";
    expect((await token(tokenBody(st), "")).data).toEqual({ error: "AUTH_REQUIRED" });
  });

  it("answers 400 AGENT_INVALID naming the first bad field", async () => {
    const st = await started();
    const bad = async (over: Record<string, unknown>, field: string, base = tokenBody(st)) => {
      const r = await token({ ...base, ...over }, st.cookie);
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(r.data, JSON.stringify(over)).toEqual({ error: "AGENT_INVALID", field });
    };
    await bad({ extra: 1 }, "extra");
    await bad({ block: "chat" }, "block");
    await bad({ segment: "gait" }, "segment");
    await bad({ segment: "rom:seated:3" }, "segment");
    await bad({ block: "session", segment: "rom:seated:1" }, "segment");
    await bad({ lang: "fr" }, "lang");
    await bad({ ref: { workoutId: st.id } }, "ref");
    await bad({ ref: { checkId: "not-an-id" } }, "ref");
    await bad({ ref: { checkId: st.id, workoutId: st.id } }, "ref");
    await bad({ ref: st.id }, "ref");
    await bad({ deviceId: "short" }, "deviceId");
    await bad({ deviceId: "device with spaces 0123456" }, "deviceId");
    await bad({ deviceId: "x".repeat(65) }, "deviceId");
    await bad({ silenceMs: 1000 }, "silenceMs");
    const { deviceId: _d, ...noDevice } = tokenBody(st);
    expect((await token(noDevice, st.cookie)).data).toEqual({ error: "AGENT_INVALID", field: "deviceId" });
    expect(google).toHaveLength(0);
  });

  it("answers 403 CONSENT_REQUIRED without an active live_coach consent", async () => {
    const st = await started(v7Intake(), ["focus_check"]);
    expect((await token(tokenBody(st), st.cookie)).data).toEqual({ error: "CONSENT_REQUIRED" });
    expect((await h.call("/consents", { kind: "live_coach", version: 1 }, st.cookie)).status).toBe(200);
    expect((await token(tokenBody(st), st.cookie)).status).toBe(200);
    expect((await h.call("/consents/live_coach", undefined, st.cookie, "DELETE")).status).toBe(200);
    expect((await token(tokenBody(st), st.cookie)).data).toEqual({ error: "CONSENT_REQUIRED" });
  });

  it("answers 409 NOT_OPEN for a check that is not the person's, missing, closed or stale", async () => {
    const st = await started();
    const other = await started();
    const id = (checkId: string) => tokenBody(st, { ref: { checkId } });
    expect((await token(id(other.id), st.cookie)).data).toEqual({ error: "NOT_OPEN" });
    expect((await token(id("11111111-2222-4333-8444-555555555555"), st.cookie)).data).toEqual({
      error: "NOT_OPEN",
    });
    // A lock on the person (a safety stop's, for example) closes every coach segment.
    setLock(h.db(), st.user, { until: T0 + HOUR, releasableByClearance: false }, T0);
    expect((await token(tokenBody(st), st.cookie)).data).toEqual({ error: "NOT_OPEN" });
    clearLock(h.db(), st.user);
    expect((await token(tokenBody(st), st.cookie)).status).toBe(200);
    // Stale: 30 minutes without activity.
    vi.setSystemTime(T0 + 31 * MINUTE);
    expect((await token(tokenBody(st), st.cookie)).data).toEqual({ error: "NOT_OPEN" });
    vi.setSystemTime(T0);
    // Closed: a stop that ends the check.
    const stop = await h.call(`/focus/${other.id}/stop`, { option: "chest" }, other.cookie);
    expect(stop.status).toBe(200);
    expect((await token(tokenBody(other), other.cookie)).data).toEqual({ error: "NOT_OPEN" });
    expect(google).toHaveLength(1);
  });

  it("mints a range segment of a home check: home is open for v7 (D-032 item 1)", async () => {
    const intake = v7Intake();
    const cookie = await member(h, `agent-home-${++emailCounter}@example.test`, intake, [
      "focus_check",
      "live_coach",
    ]);
    const user = await userId(h, cookie);
    const today = { painByRegion: {}, redFlagRegions: [], walk10m: true };
    const protocol = FOCUS_RULES!.buildRomProtocol({ intake: intake as never, setting: "home", today });
    const gait = FOCUS_RULES!.gaitPlanFor(intake as never, today, "home", {});
    const id = createFocusCheck(h.db(), {
      userId: user,
      kind: "baseline",
      setting: "home",
      protocol,
      gaitPlan: gait,
      today,
      precheck: {},
      versions: { rom: "r", norms: "n", gait: "g", targets: "t", romEngine: "re", gaitEngine: "ge" },
      device: { os: "iOS", browser: "Safari" },
      intakeVersion: 1,
      started: T0,
    });
    const seg = segmentsFor(protocol, gait).find((s) => s.block === "rom")!;
    const r = await token(
      { block: "rom", segment: seg.segment, lang: "en", ref: { checkId: id }, deviceId: newDevice() },
      cookie,
    );
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ token: "auth_tokens/tok123" });
    expect(google).toHaveLength(1);
  });

  it("answers 400 AGENT_INVALID for a segment the check does not have", async () => {
    const st = await started();
    const have = new Set(st.segments.map((s) => s.segment));
    for (const segment of [
      "rom:seated:1",
      "rom:seated:2",
      "rom:standing:1",
      "rom:standing:2",
      "rom:lying:1",
      "rom:lying:2",
    ])
      if (!have.has(segment as never)) {
        const r = await token(tokenBody(st, { segment }), st.cookie);
        expect(r.data, segment).toEqual({ error: "AGENT_INVALID", field: "segment" });
      }
    expect(have.size).toBeLessThan(6);
  });
});

describe("POST /api/agent/token: the token", () => {
  it("mints from stored state: the segment's instruction, the block's tools and the history, locked in one call", async () => {
    const st = await started(v7Intake(), ["focus_check", "live_coach"], { helperPresent: true });
    const seg = romSegment(st);
    const r = await token(tokenBody(st, { silenceMs: 1600 }), st.cookie);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(google).toHaveLength(1);
    const call = google[0];
    expect(call.url).toBe("https://generativelanguage.googleapis.com/v1beta/auth_tokens");
    expect(call.headers["x-goog-api-key"]).toBe(KEY);
    const instruction = buildInstruction({
      lang: "ar",
      block: "rom",
      position: seg.position,
      helperPresent: true,
    });
    // S0-1: the setup fields directly under bidiGenerateContentSetup.
    expect(Object.keys(call.body).sort()).toEqual([
      "bidiGenerateContentSetup",
      "expireTime",
      "newSessionExpireTime",
      "uses",
    ]);
    expect(call.body.uses).toBe(1);
    const setup = call.body.bidiGenerateContentSetup;
    expect(setup.model).toBe("models/gemini-3.8-live");
    expect(setup.systemInstruction).toEqual({ parts: [{ text: instruction }] });
    expect(setup.tools).toEqual([{ functionDeclarations: toolDeclarations("rom") }]);
    expect(setup.inputAudioTranscription).toEqual({ languageCodes: ["ar"] });
    expect(setup.realtimeInputConfig.automaticActivityDetection.silenceDurationMs).toBe(1600);
    expect(setup).not.toHaveProperty("sessionResumption");
    // S0-3: the token lives for the prewarm window, the segment and a minute, counted from the mint.
    const minutes = Math.min(9, Math.ceil(seg.items.length * 1.5 + 1));
    expect(call.body.newSessionExpireTime).toBe(new Date(T0 + 2 * MINUTE).toISOString());
    expect(call.body.expireTime).toBe(new Date(T0 + (2 + minutes + 1) * MINUTE).toISOString());

    const sex = st.intake.sex!;
    const history = buildHistory({
      block: "rom",
      lang: "ar",
      segment: seg.segment,
      helperPresent: true,
      items: seg.items.map((i) => ({
        movement: i.movementId,
        side: i.side,
        position: i.position,
        typical: typicalValue(i.movementId, sex, st.intake.age, i.side === "none" ? undefined : i.side),
      })),
    });
    expect(r.data).toEqual({
      sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      token: "auth_tokens/tok123",
      model: "gemini-3.8-live",
      apiVersion: "v1beta",
      voice: "Achird",
      expiresAt: call.body.expireTime,
      newSessionExpiresAt: call.body.newSessionExpireTime,
      history,
      minutesLeft: USER_DAILY - life(minutes),
    });
    expect(history[0].text).toContain("helper=yes");
  });

  it("stores the session: the segment's minutes reserved, the device hashed, the model and instruction version", async () => {
    const st = await started();
    const seg = romSegment(st);
    const r = await token(tokenBody(st), st.cookie);
    const minutes = Math.min(9, Math.ceil(seg.items.length * 1.5 + 1));
    expect(row(r.data.sessionId)).toMatchObject({
      user_id: st.user,
      block: "rom",
      segment: seg.segment,
      ref: st.id,
      remints: 0,
      day: "2026-10-04",
      device: createHash("sha256").update(st.device).digest("hex"),
      model: "gemini-3.8-live",
      instruction_version: COACH_SI_VERSION,
      // The minutes its token can keep a Live session: the window, the segment and the margin.
      minutes_reserved: life(minutes),
      minutes_used: null,
      minted: T0,
      reported: null,
    });
    const raw = JSON.stringify(h.db().prepare("SELECT * FROM agent_sessions").all());
    expect(raw).not.toContain(st.device);
  });

  it("mints a walk with the gait tools and its modes, views, aid and helper", async () => {
    const st = await started(v7Intake({ walking: { status: "with_aid", aid: "cane" } }));
    expect(st.gait?.offered).toBe(true);
    const r = await token(tokenBody(st, { block: "gait", segment: "gait", lang: "en" }), st.cookie);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const setup = google[0].body.bidiGenerateContentSetup;
    expect(setup.tools).toEqual([{ functionDeclarations: toolDeclarations("gait") }]);
    expect(setup.systemInstruction.parts[0].text).toBe(
      buildInstruction({ lang: "en", block: "gait", position: "walking", helperPresent: true }),
    );
    // At the booth the staff count as the helper (gait-rules eligibility, as gaitPlanFor reads it).
    expect(r.data.history[0].text).toContain("aid=cane helper=yes");
    expect(r.data.history[0].text).toContain(`modes=${st.gait!.modes.join(",")}`);
    expect(google[0].body.expireTime).toBe(new Date(T0 + (2 + 5 + 1) * MINUTE).toISOString());
  });

  it("mints a workout part from the stored workout: its exercises and dose, with the session tools", async () => {
    const st = await started();
    const w = await workout(st.cookie);
    const r = await token(
      { block: "session", segment: "session:1", lang: "en", ref: { workoutId: w.id }, deviceId: newDevice() },
      st.cookie,
    );
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(google[0].body.bidiGenerateContentSetup.tools).toEqual([
      { functionDeclarations: toolDeclarations("session") },
    ]);
    const lines = r.data.history[0].text.split("\n");
    expect(lines[0]).toBe("[CTX block=session segment=session:1 lang=en]");
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines.slice(1))
      expect(l).toMatch(
        /^\[CTX ex=\d+ id=[a-z0-9_]+( name="[^"]+")? sets=\d+( reps=\d+)?( hold=\d+)? rest=\d+\]$/,
      );
    expect(google[0].body.expireTime).toBe(new Date(T0 + (2 + 9 + 1) * MINUTE).toISOString());
    // The second part is a segment of the same workout.
    const second = await token(
      { block: "session", segment: "session:2", lang: "en", ref: { workoutId: w.id }, deviceId: newDevice() },
      st.cookie,
    );
    expect(second.status).toBe(200);
    expect(second.data.sessionId).not.toBe(r.data.sessionId);
  });

  it("refuses a workout that is not the person's, ended or of another day (409 NOT_OPEN)", async () => {
    const st = await started();
    const other = await started();
    const w = await workout(other.cookie);
    const body = {
      block: "session",
      segment: "session:1",
      lang: "ar",
      ref: { workoutId: w.id },
      deviceId: newDevice(),
    };
    expect((await token(body, st.cookie)).data).toEqual({ error: "NOT_OPEN" });
    expect((await token(body, other.cookie)).status).toBe(200);
    h.db().prepare("UPDATE workouts SET ended=1 WHERE id=?").run(w.id);
    expect((await token(body, other.cookie)).data).toEqual({ error: "NOT_OPEN" });
    h.db()
      .prepare("UPDATE workouts SET ended=0, created=? WHERE id=?")
      .run(T0 - 24 * HOUR, w.id);
    expect((await token(body, other.cookie)).data).toEqual({ error: "NOT_OPEN" });
  });

  it("answers 502 TOKEN_FAILED when Google refuses, with no reservation kept and no key or message anywhere", async () => {
    const st = await started();
    googleReply = () =>
      new Response(
        JSON.stringify({ error: { message: `API key ${KEY} not valid`, status: "INVALID_ARGUMENT" } }),
        {
          status: 400,
        },
      );
    const failed = fallbacks()["token_failed:booth"] ?? 0;
    const r = await token(tokenBody(st), st.cookie);
    expect(r.status).toBe(502);
    // The segment never started, so no usage report follows: the route counts the fallback itself.
    expect(fallbacks()["token_failed:booth"]).toBe(failed + 1);
    expect(r.data).toEqual({ error: "TOKEN_FAILED" });
    expect(h.db().prepare("SELECT COUNT(*) AS n FROM agent_sessions WHERE user_id=?").get(st.user)).toEqual({
      n: 0,
    });
    expect(logs.join("\n")).not.toContain(KEY);
    expect(logs.join("\n")).not.toContain("not valid");
    expect(logs.some((l) => l.includes("400"))).toBe(true);
  });

  it("never puts the API key in a response or a log line", async () => {
    const st = await started();
    const ok = await token(tokenBody(st), st.cookie);
    const used = await usage(report(ok.data.sessionId), st.cookie);
    for (const r of [ok, used]) expect(JSON.stringify(r.data)).not.toContain(KEY);
    expect(logs.join("\n")).not.toContain(KEY);
  });
});

describe("C-12: only the listed data reaches Google or the history", () => {
  it("holds no name, email, age, sex, condition, medication, free text, report or why line", async () => {
    const intake = v7Intake({
      sex: "female",
      age: 47,
      conditions: ["stroke", "parkinsons"],
      medications: "Warfarin PRIVATE MEDICATION",
      diagnosisNotes: "PRIVATE DIAGNOSIS NOTE",
    });
    const email = `agent-private-${++emailCounter}@example.test`;
    const cookie = await member(h, email, intake, ["focus_check", "live_coach"]);
    // The stored name is the harness's member name.
    const name = (await h.call("/auth/me", undefined, cookie)).data.user.name as string;
    const booth = { "x-azm-booth": pass };
    await h.call("/focus/context", undefined, cookie, "GET", booth);
    const s = await h.call(
      "/focus",
      {
        setting: "booth",
        today: {
          painByRegion: {},
          redFlagRegions: [],
          worrying: false,
          unsteady: false,
          walk10m: true,
          pdFreezing: false,
        },
        device: { os: "iOS", browser: "Safari" },
        include: { rom: true, gait: true },
      },
      cookie,
      "POST",
      booth,
    );
    expect(s.status, JSON.stringify(s.data)).toBe(200);
    const segments = segmentsFor(s.data.protocol, s.data.gait);
    const w = await workout(cookie);
    // A stored workout whose items carry why lines, notes and reasons, as a targeted weekly does.
    const stored = JSON.parse(
      (h.db().prepare("SELECT plan FROM workouts WHERE id=?").get(w.id) as { plan: string }).plan,
    );
    const why = { ar: "سبب خاص جدا", en: "PRIVATE WHY LINE" };
    for (const slot of ["warmup", "extra", "cooldown"])
      stored.today[slot] = stored.today[slot].map((i: object) => ({ ...i, why, note: why }));
    stored.exercises = stored.exercises.map((e: object) => ({ ...e, reason: "PRIVATE REASON" }));
    h.db().prepare("UPDATE workouts SET plan=? WHERE id=?").run(JSON.stringify(stored), w.id);

    const replies = [];
    for (const lang of ["ar", "en"]) {
      for (const seg of segments)
        replies.push(
          await token(
            {
              block: seg.block,
              segment: seg.segment,
              lang,
              ref: { checkId: s.data.id },
              deviceId: newDevice(),
            },
            cookie,
          ),
        );
      replies.push(
        await token(
          { block: "session", segment: "session:1", lang, ref: { workoutId: w.id }, deviceId: newDevice() },
          cookie,
        ),
      );
    }
    for (const r of replies) expect(r.status, JSON.stringify(r.data)).toBe(200);
    const sent = JSON.stringify([google.map((g) => g.body), replies.map((r) => r.data)]);
    for (const secret of [
      name,
      email,
      "female",
      "parkinsons",
      "PRIVATE",
      "Warfarin",
      "سبب خاص",
      '"age"',
      "age=",
      '"sex"',
      "sex=",
      "conditions",
    ])
      expect(sent, secret).not.toContain(secret);
  });
});

/** The default user budget (5.4) and a token's life: the minutes it can keep a Live session. */
const USER_DAILY = 70;
const life = (minutes: number) => Math.min(10, minutes + 3);

describe("the budget (5.1): never trusts the client", () => {
  it("re-mints on the same row: each re-mint reserves its own token's life, at most 2, then 429 BUDGET", async () => {
    const st = await started();
    const seg = romSegment(st);
    const minutes = Math.min(9, Math.ceil(seg.items.length * 1.5 + 1));
    const first = await token(tokenBody(st), st.cookie);
    expect(first.status).toBe(200);
    // The prewarm was never used: its newSessionExpireTime passes and the client mints again.
    vi.setSystemTime(T0 + 3 * MINUTE);
    const second = await token(tokenBody(st), st.cookie);
    expect(second.status).toBe(200);
    expect(second.data.sessionId).toBe(first.data.sessionId);
    // Every token can keep a session for its whole life, so every mint counts it (coach review 2).
    expect(row(first.data.sessionId)).toMatchObject({
      remints: 1,
      minutes_reserved: 2 * life(minutes),
      minted: T0 + 3 * MINUTE,
    });
    expect(second.data.minutesLeft).toBe(USER_DAILY - 2 * life(minutes));
    // A re-mint's token lives as long as a first one (the rest of the segment may be all of it).
    expect(google[1].body.expireTime).toBe(
      new Date(T0 + 3 * MINUTE + (2 + minutes + 1) * MINUTE).toISOString(),
    );
    expect((await token(tokenBody(st), st.cookie)).status).toBe(200);
    expect(row(first.data.sessionId)).toMatchObject({ remints: 2, minutes_reserved: 3 * life(minutes) });
    const budget = fallbacks()["budget:booth"] ?? 0;
    const third = await token(tokenBody(st), st.cookie);
    expect(third.status).toBe(429);
    // A running segment's fallback is counted from its usage report, not here.
    expect(fallbacks()["budget:booth"] ?? 0).toBe(budget);
    expect(third.data).toEqual({ error: "BUDGET", minutesLeft: USER_DAILY - 3 * life(minutes) });
    expect(google).toHaveLength(3);
    expect(h.db().prepare("SELECT COUNT(*) AS n FROM agent_sessions WHERE user_id=?").get(st.user)).toEqual({
      n: 1,
    });
  });

  it("frees no budget for a usage report of 0 minutes", async () => {
    const st = await started();
    const seg = romSegment(st);
    const minutes = Math.min(9, Math.ceil(seg.items.length * 1.5 + 1));
    // The person's day holds the range segment and 4 minutes more: the walk's token does not fit.
    process.env.AZM_AGENT_USER_DAILY_MINUTES = String(life(minutes) + 4);
    const first = await token(tokenBody(st), st.cookie);
    expect(first.data.minutesLeft).toBe(4);
    expect((await usage(report(first.data.sessionId, { durationSec: 0, turns: 0 }), st.cookie)).status).toBe(
      200,
    );
    expect(row(first.data.sessionId)).toMatchObject({ minutes_used: 0, minutes_reserved: life(minutes) });
    // The walk would fit only if the report had freed the reservation.
    const gait = await token(tokenBody(st, { block: "gait", segment: "gait" }), st.cookie);
    expect(gait.status).toBe(429);
    expect(gait.data).toEqual({ error: "BUDGET", minutesLeft: 4 });
  });

  it("counts a usage report up to the reservation, the summed lives of its tokens, never more", async () => {
    const st = await started();
    const first = await token(tokenBody(st), st.cookie);
    const reserved = row(first.data.sessionId).minutes_reserved as number;
    expect((await usage(report(first.data.sessionId, { durationSec: 3600 }), st.cookie)).status).toBe(200);
    expect(row(first.data.sessionId).minutes_used).toBe(reserved);
    // A later, smaller report never lowers the count.
    expect((await usage(report(first.data.sessionId, { durationSec: 60 }), st.cookie)).status).toBe(200);
    expect(row(first.data.sessionId).minutes_used).toBe(reserved);
    const next = await token(tokenBody(st, { block: "gait", segment: "gait" }), st.cookie);
    const gait = row(next.data.sessionId).minutes_reserved as number;
    expect(next.data.minutesLeft).toBe(USER_DAILY - reserved - gait);
  });

  it("keeps all users within the global daily minutes", async () => {
    const a = await started();
    const b = await started();
    // Every person's counted minutes today, from the earlier tests of this file.
    const counted = () =>
      (
        h
          .db()
          .prepare(
            "SELECT COALESCE(SUM(MAX(minutes_reserved, COALESCE(minutes_used, 0))), 0) AS m FROM agent_sessions WHERE day=?",
          )
          .get("2026-10-04") as { m: number }
      ).m;
    const minutes = Math.min(9, Math.ceil(romSegment(a).items.length * 1.5 + 1));
    process.env.AZM_AGENT_GLOBAL_DAILY_MINUTES = String(counted() + life(minutes) + 2);
    expect((await token(tokenBody(a), a.cookie)).status).toBe(200);
    const budget = fallbacks()["budget:booth"] ?? 0;
    const refused = await token(tokenBody(b), b.cookie);
    expect(refused.status).toBe(429);
    expect(refused.data).toEqual({ error: "BUDGET", minutesLeft: 2 });
    expect(fallbacks()["budget:booth"]).toBe(budget + 1);
  });

  it("fits a full A to Z in the default user budget: every segment of the check, both workout parts and two re-mints", async () => {
    const st = await started();
    const w = await workout(st.cookie);
    let total = 0;
    for (const seg of st.segments) {
      const r = await token(
        {
          block: seg.block,
          segment: seg.segment,
          lang: "ar",
          ref: { checkId: st.id },
          deviceId: newDevice(),
        },
        st.cookie,
      );
      expect(r.status, seg.segment).toBe(200);
      total += row(r.data.sessionId).minutes_reserved as number;
    }
    for (const segment of ["session:1", "session:2"]) {
      const r = await token(
        { block: "session", segment, lang: "ar", ref: { workoutId: w.id }, deviceId: newDevice() },
        st.cookie,
      );
      expect(r.status, segment).toBe(200);
      total += row(r.data.sessionId).minutes_reserved as number;
    }
    for (const n of [1, 2]) {
      const r = await token(tokenBody(st), st.cookie);
      expect(r.status, `re-mint ${n}`).toBe(200);
      total += life(Math.min(9, Math.ceil(romSegment(st).items.length * 1.5 + 1)));
    }
    expect(total).toBeLessThanOrEqual(USER_DAILY);
  });
});

describe("the rate limits (5.1)", () => {
  it("allow 20 token requests per person per hour", async () => {
    const st = await started();
    const ip = freshIp();
    const devices = Array.from({ length: 21 }, (_, n) => `device-person-${String(n).padStart(4, "0")}xx`);
    const codes: string[] = [];
    for (const deviceId of devices)
      codes.push((await token(tokenBody(st, { deviceId }), st.cookie, ip)).data.error ?? "OK");
    expect(codes.slice(0, 20).every((c) => c !== "RATE_LIMIT")).toBe(true);
    expect(codes[20]).toBe("RATE_LIMIT");
    vi.setSystemTime(T0 + 61 * MINUTE);
    // An hour later the limit is open again (the check has gone stale meanwhile).
    expect((await token(tokenBody(st, { deviceId: devices[0] }), st.cookie, ip)).data.error).toBe("NOT_OPEN");
  });

  it("allow 20 per device and 60 per address in an hour", async () => {
    const people: Started[] = [];
    for (let n = 0; n < 6; n++) people.push(await started());
    const device = "device-shared-0123456789";
    const ip = freshIp();
    const codes: string[] = [];
    for (let n = 0; n < 21; n++) {
      const st = people[n % 2];
      codes.push((await token(tokenBody(st, { deviceId: device }), st.cookie, ip)).data.error ?? "OK");
    }
    expect(codes.slice(0, 20).every((c) => c !== "RATE_LIMIT")).toBe(true);
    expect(codes[20]).toBe("RATE_LIMIT");
    // The address counted the first 20 (the device refused the 21st first): 40 more pass, the next is refused.
    const more: string[] = [];
    for (let n = 0; n < 41; n++) {
      const st = people[2 + (n % 4)];
      const deviceId = `device-ip-${String(n).padStart(4, "0")}-xxxxx`;
      more.push((await token(tokenBody(st, { deviceId }), st.cookie, ip)).data.error ?? "OK");
    }
    expect(more.slice(0, 40).every((c) => c !== "RATE_LIMIT")).toBe(true);
    expect(more[40]).toBe("RATE_LIMIT");
  });
});

describe("POST /api/agent/usage (5.2)", () => {
  it("stores the report on the session row with the exact headers a page hide sends", async () => {
    const st = await started();
    const t = await token(tokenBody(st), st.cookie);
    vi.setSystemTime(T0 + 5 * MINUTE);
    // fetch("/api/agent/usage", { method: "POST", keepalive: true, credentials: "same-origin",
    //   headers: { "X-Azm-Request": "1", "Content-Type": "application/json" }, body })
    const r = await fetch(h.origin + "/api/agent/usage", {
      method: "POST",
      keepalive: true,
      headers: {
        origin: h.origin,
        cookie: st.cookie,
        "X-Azm-Request": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(report(t.data.sessionId)),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(row(t.data.sessionId)).toMatchObject({
      minutes_used: 4,
      connect_ms: 950,
      turns: 12,
      prompt_tokens: 21000,
      response_tokens: 3400,
      end_reason: "done",
      reported: T0 + 5 * MINUTE,
    });
    expect(JSON.parse(row(t.data.sessionId).tool_calls)).toEqual({
      confirm_max: { ok: 3, rejected: 1 },
      mark_pain: { ok: 1, rejected: 0 },
    });
  });

  it("is refused without X-Azm-Request (a beacon cannot send it), 403 ORIGIN", async () => {
    const st = await started();
    const t = await token(tokenBody(st), st.cookie);
    const r = await fetch(h.origin + "/api/agent/usage", {
      method: "POST",
      headers: { origin: h.origin, cookie: st.cookie, "Content-Type": "application/json" },
      body: JSON.stringify(report(t.data.sessionId)),
    });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "ORIGIN" });
  });

  it("stores the report of a segment while the coach is switched off or has no key (a kill switch, the e2e server)", async () => {
    const st = await started();
    const t = await token(tokenBody(st), st.cookie);
    expect(t.status).toBe(200);
    // The switch goes off mid segment (1.2.1: the e2e server runs with AZM_AGENT_ENABLED=0): the
    // report still reaches its own row, and asks nothing of Google.
    delete process.env.AZM_AGENT_ENABLED;
    vi.setSystemTime(T0 + 3 * MINUTE);
    const off = await usage(
      report(t.data.sessionId, { durationSec: 120, endReason: "fallback_error" }),
      st.cookie,
    );
    expect(off.status).toBe(200);
    expect(off.data).toEqual({ ok: true });
    expect(row(t.data.sessionId)).toMatchObject({ minutes_used: 2, end_reason: "fallback_error" });
    process.env.AZM_AGENT_ENABLED = "1";
    delete process.env.GEMINI_API_KEY;
    expect((await usage(report(t.data.sessionId), st.cookie)).status).toBe(200);
    expect(row(t.data.sessionId)).toMatchObject({ end_reason: "done" });
    expect(google).toHaveLength(1);
    // Still the person's own row only.
    expect((await usage(report("11111111-2222-4333-8444-555555555555"), st.cookie)).status).toBe(404);
  });

  it("answers 404 for a session that is not the person's", async () => {
    const a = await started();
    const b = await started();
    const t = await token(tokenBody(a), a.cookie);
    expect((await usage(report(t.data.sessionId), b.cookie)).data).toEqual({ error: "NOT_FOUND" });
    expect((await usage(report("11111111-2222-4333-8444-555555555555"), a.cookie)).status).toBe(404);
  });

  it("answers 400 USAGE_INVALID naming the first bad field", async () => {
    const st = await started();
    const t = await token(tokenBody(st), st.cookie);
    const bad = async (over: Record<string, unknown>, field: string) => {
      const r = await usage(report(t.data.sessionId, over), st.cookie);
      expect(r.data, JSON.stringify(over)).toEqual({ error: "USAGE_INVALID", field });
    };
    await bad({ extra: true }, "extra");
    await bad({ sessionId: "x" }, "sessionId");
    await bad({ connectMs: -1 }, "connectMs");
    await bad({ durationSec: 3601 }, "durationSec");
    await bad({ durationSec: Number.NaN }, "durationSec");
    await bad({ turns: 501 }, "turns");
    await bad({ turns: 1.5 }, "turns");
    await bad({ toolCalls: { record_range: { ok: 1, rejected: 0 } } }, "toolCalls");
    await bad({ toolCalls: { mark_pain: { ok: 1 } } }, "toolCalls");
    await bad({ toolCalls: [] }, "toolCalls");
    await bad({ promptTokens: "many" }, "promptTokens");
    await bad({ responseTokens: -5 }, "responseTokens");
    await bad({ firstAudioMs: { p50: 700 } }, "firstAudioMs");
    await bad({ endReason: "crashed" }, "endReason");
    const { turns: _t, ...noTurns } = report(t.data.sessionId);
    expect((await usage(noTurns, st.cookie)).data).toEqual({ error: "USAGE_INVALID", field: "turns" });
    // Nullable fields take null.
    expect(
      (
        await usage(
          report(t.data.sessionId, {
            connectMs: null,
            promptTokens: null,
            responseTokens: null,
            firstAudioMs: null,
          }),
          st.cookie,
        )
      ).status,
    ).toBe(200);
  });

  it("allows 60 reports per person in 15 minutes", async () => {
    const st = await started();
    const t = await token(tokenBody(st), st.cookie);
    const codes: number[] = [];
    for (let n = 0; n < 61; n++) codes.push((await usage(report(t.data.sessionId), st.cookie)).status);
    expect(codes.slice(0, 60).every((c) => c === 200)).toBe(true);
    expect(codes[60]).toBe(429);
  });

  it("counts a fallback to the local voice once, in the check's setting (product_counts coach_fallback)", async () => {
    const st = await started();
    const t = await token(tokenBody(st), st.cookie);
    const counts = () =>
      h
        .db()
        .prepare("SELECT key, setting, count FROM product_counts WHERE metric='coach_fallback' ORDER BY key")
        .all();
    const before = counts().length;
    expect((await usage(report(t.data.sessionId, { endReason: "done" }), st.cookie)).status).toBe(200);
    expect(counts().length).toBe(before);
    for (let n = 0; n < 2; n++)
      expect((await usage(report(t.data.sessionId, { endReason: "fallback_slow" }), st.cookie)).status).toBe(
        200,
      );
    const slow = counts().find((c: any) => c.key === "fallback_slow") as any;
    expect(slow).toMatchObject({ setting: "booth" });
    expect(slow.count).toBe(1);
    const n0 = slow.count as number;
    // A workout's fallback counts as home without a booth pass.
    const w = await workout(st.cookie);
    const s = await token(
      { block: "session", segment: "session:1", lang: "ar", ref: { workoutId: w.id }, deviceId: newDevice() },
      st.cookie,
    );
    expect((await usage(report(s.data.sessionId, { endReason: "offline" }), st.cookie)).status).toBe(200);
    expect(counts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "fallback_slow", setting: "booth", count: n0 }),
        expect.objectContaining({ key: "offline", setting: "home" }),
      ]),
    );
  });
});
