/**
 * D-035 items 3 and 4 on the server: the usage report's failure (the stage, the error's name and its
 * cleaned message) is kept on agent_sessions.failure (migration 007), and POST /api/agent/lab-token
 * mints the connection test's one minute token (/?coachlab=1): no tools, the lab's own instruction, the
 * same consent, limits and budget as a segment, a row of its own per run, and never a product fallback.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { LAB_QUESTION, LAB_SEGMENT, LAB_SI_VERSION } from "../../server/modules/agent/lab";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "../../server/db/migrations";
import { runMigrations } from "../../server/db/migrate";
import { PASSWORD, T0, startV7Api, type V7Harness } from "./a-harness";

const KEY = "test-gemini-key-SECRET-lab-41c";
const GOOGLE = "https://generativelanguage.googleapis.com/";
let h: V7Harness;
let google: { url: string; body: any }[] = [];
let googleStatus = 200;
let ipCounter = 0;
let emails = 0;
let devices = 0;

beforeAll(async () => {
  h = await startV7Api(FOCUS_RULES);
});
afterAll(async () => {
  await h.close();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  process.env.AZM_V7 = "1";
  process.env.AZM_AGENT_ENABLED = "1";
  process.env.GEMINI_API_KEY = KEY;
  process.env.AZM_AGENT_GLOBAL_DAILY_MINUTES = "100000";
  google = [];
  googleStatus = 200;
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (!String(url).startsWith(GOOGLE)) return real(url, init);
    google.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return googleStatus === 200
      ? new Response(JSON.stringify({ name: "auth_tokens/lab123" }))
      : new Response("{}", { status: googleStatus });
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const k of ["AZM_V7", "AZM_AGENT_ENABLED", "GEMINI_API_KEY", "AZM_AGENT_GLOBAL_DAILY_MINUTES"])
    delete process.env[k];
});

const freshIp = () => ({ "x-forwarded-for": `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` });
const device = () => `device-lab-${String(++devices).padStart(8, "0")}`;

/** A signed in person, with the live_coach consent unless told otherwise. */
async function person(consent = true): Promise<string> {
  const r = await h.call(
    "/auth/register",
    { name: "Lab Person", email: `lab-${++emails}@example.test`, password: PASSWORD, adultConfirmed: true },
    "",
    "POST",
    freshIp(),
  );
  expect(r.status).toBe(200);
  if (consent)
    expect((await h.call("/consents", { kind: "live_coach", version: 1 }, r.cookie)).status).toBe(200);
  return r.cookie;
}

const lab = (body: unknown, cookie: string) => h.call("/agent/lab-token", body, cookie, "POST", freshIp());
const row = (id: string) =>
  h.db().prepare("SELECT * FROM agent_sessions WHERE id=?").get(id) as Record<string, any>;
const report = (sessionId: string, over: Record<string, unknown> = {}) => ({
  sessionId,
  connectMs: null,
  durationSec: 0,
  turns: 0,
  toolCalls: {},
  promptTokens: null,
  responseTokens: null,
  firstAudioMs: null,
  endReason: "fallback_error",
  ...over,
});
const fallbacks = () =>
  (
    h.db().prepare("SELECT SUM(count) AS n FROM product_counts WHERE metric='coach_fallback'").get() as {
      n: number | null;
    }
  ).n ?? 0;

describe("POST /api/agent/lab-token (D-035 item 4)", () => {
  it("mints a one minute token with the lab's instruction and no tools, on a row of its own per run", async () => {
    const cookie = await person();
    const a = await lab({ lang: "ar", deviceId: device() }, cookie);
    expect(a.status, JSON.stringify(a.data)).toBe(200);
    expect(a.data).toMatchObject({
      token: "auth_tokens/lab123",
      model: "gemini-3.8-live",
      apiVersion: "v1beta",
    });
    expect(a.data.history).toEqual([
      { role: "user", text: "[CTX lab lang=ar]" },
      { role: "model", text: "جاهز." },
    ]);
    expect(google).toHaveLength(1);
    const setup = google[0].body.bidiGenerateContentSetup;
    expect(setup).not.toHaveProperty("tools");
    expect(setup.systemInstruction.parts[0].text).toContain(LAB_QUESTION.ar);
    expect(setup.inputAudioTranscription).toEqual({ languageCodes: ["ar"] });
    // The window to open it, one minute and the margin.
    const life = Date.parse(google[0].body.expireTime) - T0;
    expect(life).toBe((2 + 1 + 1) * 60_000);
    expect(row(a.data.sessionId)).toMatchObject({
      block: "session",
      segment: LAB_SEGMENT,
      instruction_version: LAB_SI_VERSION,
      minutes_reserved: 4,
      remints: 0,
    });
    expect(row(a.data.sessionId).ref).toMatch(/^lab:[0-9a-f-]{36}$/);
    const b = await lab({ lang: "en", deviceId: device() }, cookie);
    expect(b.data.sessionId).not.toBe(a.data.sessionId);
    expect(b.data.history[1]).toEqual({ role: "model", text: "Ready." });
  });

  it("refuses: 503 while the coach is off, 401 signed out, 400 a bad body, 403 without the consent, 502 a refused mint", async () => {
    const cookie = await person();
    delete process.env.AZM_AGENT_ENABLED;
    expect((await lab({ lang: "ar", deviceId: device() }, cookie)).data).toEqual({
      error: "AGENT_UNAVAILABLE",
    });
    process.env.AZM_AGENT_ENABLED = "1";
    expect((await lab({ lang: "ar", deviceId: device() }, "")).status).toBe(401);
    expect((await lab({ lang: "fr", deviceId: device() }, cookie)).data).toEqual({
      error: "AGENT_INVALID",
      field: "lang",
    });
    expect((await lab({ lang: "ar", deviceId: "x" }, cookie)).data).toEqual({
      error: "AGENT_INVALID",
      field: "deviceId",
    });
    expect((await lab({ lang: "ar", deviceId: device(), checkId: "x" }, cookie)).data).toEqual({
      error: "AGENT_INVALID",
      field: "checkId",
    });
    const none = await person(false);
    expect((await lab({ lang: "ar", deviceId: device() }, none)).data).toEqual({ error: "CONSENT_REQUIRED" });
    googleStatus = 400;
    const r = await lab({ lang: "ar", deviceId: device() }, cookie);
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.data)).not.toContain(KEY);
    process.env.AZM_V7 = "";
    expect((await lab({ lang: "ar", deviceId: device() }, cookie)).status).toBe(404);
  });

  it("keeps the lab's failure on its row and never counts it as a product fallback", async () => {
    const cookie = await person();
    const a = await lab({ lang: "ar", deviceId: device() }, cookie);
    const before = fallbacks();
    const failure = { stage: "mic", name: "NotAllowedError", message: "The request is not allowed" };
    const r = await h.call("/agent/usage", report(a.data.sessionId, { failure }), cookie);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(JSON.parse(row(a.data.sessionId).failure)).toEqual(failure);
    expect(fallbacks()).toBe(before);
  });
});

describe("the usage report's failure (D-035 item 3)", () => {
  it("is stored as JSON, kept by a later report without one, and replaced by a newer one", async () => {
    const cookie = await person();
    const a = await lab({ lang: "ar", deviceId: device() }, cookie);
    const id = a.data.sessionId;
    expect(row(id).failure).toBeNull();
    // A client from before D-035 sends no failure at all.
    expect((await h.call("/agent/usage", report(id), cookie)).status).toBe(200);
    expect(row(id).failure).toBeNull();
    const socket = { stage: "socket", name: "closed_1008", message: "closed_1008: policy" };
    expect((await h.call("/agent/usage", report(id, { failure: socket }), cookie)).status).toBe(200);
    expect(
      (await h.call("/agent/usage", report(id, { failure: null, endReason: "done" }), cookie)).status,
    ).toBe(200);
    expect(row(id)).toMatchObject({ end_reason: "done" });
    expect(JSON.parse(row(id).failure)).toEqual(socket);
    const mic = {
      stage: "mic",
      name: "NotReadableError",
      message: "Failed starting capture of a audio track",
    };
    expect((await h.call("/agent/usage", report(id, { failure: mic }), cookie)).status).toBe(200);
    expect(JSON.parse(row(id).failure)).toEqual(mic);
  });

  it("refuses a failure with an unknown stage, a bad name, a token or a long message (400 field failure)", async () => {
    const cookie = await person();
    const id = (await lab({ lang: "ar", deviceId: device() }, cookie)).data.sessionId;
    for (const failure of [
      { stage: "camera", name: "X", message: "" },
      { stage: "mic", name: "Not Allowed", message: "" },
      { stage: "mic", name: "X", message: "wss://example.test/ws?access_token=auth_tokens/abc" },
      { stage: "mic", name: "X", message: "x".repeat(201) },
      { stage: "mic", name: "X", message: "", said: "نعم" },
      "mic",
    ]) {
      const r = await h.call("/agent/usage", report(id, { failure }), cookie);
      expect(r.data, JSON.stringify(failure)).toEqual({ error: "USAGE_INVALID", field: "failure" });
    }
  });
});

describe("migration 007 (coach_failure)", () => {
  it("adds one nullable column to agent_sessions and leaves every row and definition as it was", () => {
    const m = migrations.find((x) => x.version === 7)!;
    expect(m).toMatchObject({ version: 7, name: "coach_failure" });
    expect(m.sql.trim()).toBe("ALTER TABLE agent_sessions ADD COLUMN failure TEXT;");
    const db = new DatabaseSync(":memory:");
    runMigrations(db, { dbPath: ":memory:", migrations: migrations.filter((x) => x.version <= 6) });
    db.exec(
      "INSERT INTO users(id,email,name,password,created) VALUES('u1','a@example.test','A','x',1);" +
        "INSERT INTO agent_sessions(id,user_id,block,segment,ref,day,device,model,instruction_version,minutes_reserved,minted,end_reason) VALUES('s1','u1','rom','rom:seated:1','c1','2026-10-09','d','m','coach_si_2',4,1,'fallback_error');",
    );
    const others = () =>
      db
        .prepare("SELECT name, sql FROM sqlite_master WHERE tbl_name <> 'agent_sessions' ORDER BY name")
        .all();
    const before = others();
    expect(runMigrations(db, { dbPath: ":memory:" }).applied).toEqual([7]);
    expect(others()).toEqual(before);
    expect(db.prepare("SELECT end_reason, failure FROM agent_sessions WHERE id='s1'").get()).toEqual({
      end_reason: "fallback_error",
      failure: null,
    });
    db.close();
  });
});
