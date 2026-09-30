/**
 * Round 3 server (C2): contract v3 I (AZM_CHECK_HOME, AZM_BOOTH_CODE, booth verify, HOME_CLOSED) and
 * every council and UX round decision with a server impact: the Q25 anonymous counters (reason, test
 * id or pre-check, setting, with started and completed denominators and the Q2 (6) product counts,
 * never a user id), the Q25 (c) lock record without the reason, the Q23 end of check question, the
 * Q33 faint follow up with changeReported and faintReported, H9 and Q12 (2) scheduling, the adult
 * confirmation (Q2 (5), Q32 (6)), O6 resume and the 30 minute window, O17 booth passes, O21, O29
 * and the new skip reasons (motion_needed, chair_needed).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProtocolItem } from "../src/medical/assessment";
import { clientAddress } from "../server/api";
import { moduleRoutes } from "../server/modules";
import {
  DAY,
  DEVICE,
  HOUR,
  T0,
  WHEELCHAIR_STROKE,
  answersFor,
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

const MIN = 60 * 1000;
/** Start of the next calendar day in Asia/Riyadh after T0 (2026-10-05 00:00 +03:00). */
const NEXT_DAY = Date.UTC(2026, 9, 4, 21, 0, 0);
/** 2026-10-11 10:00 in Riyadh: the first booth day (UX spec S55, BOOTH_DATES). */
const BOOTH_DAY = Date.UTC(2026, 9, 11, 7, 0, 0);
const CODE = "482913";
const CHAIR_VALUES = {
  "shoulder_abduction:right": 100,
  "shoulder_abduction:left": 90,
  "trunk_control_seated:right": 20,
  "trunk_control_seated:left": 18,
  "arm_curl_30s:right": 12,
  "arm_curl_30s:left": 11,
};
const LOCK_NEXT_DAY = {
  until: NEXT_DAY,
  releasableByClearance: false,
  when: { token: "nextDay_midnight" },
};

let h: Harness;
const setTime = (t: number) => vi.setSystemTime(t);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  process.env.AZM_CHECK_HOME = "1";
  delete process.env.AZM_BOOTH_CODE;
  delete process.env.AZM_BOOTH_DATES;
  delete process.env.AZM_BOOTH_HOURS;
});

function skipBody(item: ProtocolItem, reason: string) {
  return {
    ...resultBody(item, 0),
    value: null,
    attempts: [],
    nValid: 0,
    median: null,
    skippedReason: reason,
  };
}

type Row = Record<string, unknown>;
const rows = (h: Harness, sql: string, ...args: (string | number)[]) =>
  h
    .inspect()
    .prepare(sql)
    .all(...args) as Row[];
const safety = (h: Harness) => rows(h, "SELECT * FROM safety_events ORDER BY reason, test_id, setting");
const product = (h: Harness, metric: string) =>
  rows(h, "SELECT key, setting, count FROM product_counts WHERE metric=? ORDER BY key, setting", metric);

describe("contract v3 I: home checks behind AZM_CHECK_HOME", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("gives homeOpen in the context: only the value 1 opens home checks", async () => {
    const cookie = await member(h, "flag@example.test", intakeOf());
    expect((await h.call("/assessments/context", undefined, cookie)).data.homeOpen).toBe(true);
    for (const v of [undefined, "0", "true", "yes", " 1"]) {
      if (v === undefined) delete process.env.AZM_CHECK_HOME;
      else process.env.AZM_CHECK_HOME = v;
      expect((await h.call("/assessments/context", undefined, cookie)).data.homeOpen).toBe(false);
    }
  });

  it("refuses a home start with 403 HOME_CLOSED while closed, before anything is evaluated or stored", async () => {
    const cookie = await member(h, "closed@example.test", intakeOf());
    const answers = await answersFor(h, cookie, { pc_unwell: "yes" });
    delete process.env.AZM_CHECK_HOME;
    for (const body of [
      { answers, device: DEVICE },
      { answers, device: DEVICE, setting: "home" },
    ]) {
      const r = await h.call("/assessments", body, cookie);
      expect(r.status).toBe(403);
      expect(r.data).toEqual({ error: "HOME_CLOSED" });
    }
    // Nothing was evaluated: no lock, no count, no check.
    expect((await h.call("/assessments/context", undefined, cookie)).data.lock).toBeNull();
    expect(safety(h)).toEqual([]);
    expect((await h.call("/assessments", undefined, cookie)).data.assessments).toEqual([]);
    process.env.AZM_CHECK_HOME = "1";
    expect((await h.call("/assessments", { answers, device: DEVICE }, cookie)).data.error).toBe("POSTPONE");
  });

  it("keeps booth checks open with the staff code while home checks are closed", async () => {
    delete process.env.AZM_CHECK_HOME;
    process.env.AZM_BOOTH_CODE = CODE;
    setTime(BOOTH_DAY);
    const cookie = await member(h, "closed-booth@example.test", intakeOf());
    const r = await start(h, cookie, {}, { setting: "booth", boothCode: CODE });
    expect(r.status).toBe(200);
    expect(r.data.setting).toBe("booth");
  });
});

describe("clientAddress: the address the trusted proxy saw", () => {
  it("takes the entry the outermost trusted proxy appended, never one the client wrote", () => {
    expect(clientAddress("198.51.100.7", "10.0.0.1")).toBe("198.51.100.7");
    expect(clientAddress("1.2.3.4, 5.6.7.8, 198.51.100.7", "10.0.0.1")).toBe("198.51.100.7");
    expect(clientAddress(["1.2.3.4", "198.51.100.7"], "10.0.0.1")).toBe("198.51.100.7");
    expect(clientAddress("1.2.3.4, 198.51.100.7, 172.16.0.2", "10.0.0.1", 2)).toBe("198.51.100.7");
    expect(clientAddress("198.51.100.7", "10.0.0.1", 3)).toBe("198.51.100.7");
    // No proxy trusted, or no header: the socket.
    expect(clientAddress("1.2.3.4", "10.0.0.1", 0)).toBe("10.0.0.1");
    expect(clientAddress(undefined, "10.0.0.1")).toBe("10.0.0.1");
    expect(clientAddress(" , ", "10.0.0.1")).toBe("10.0.0.1");
  });
});

describe("POST /api/booth/verify (contract v3 I, O17)", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  const verify = (code: unknown, ip = "198.51.100.1") =>
    h.call("/booth/verify", { code }, "", "POST", { "x-forwarded-for": ip });

  it("answers { ok } without a session: the right code on a booth day, never a wrong or missing one", async () => {
    setTime(BOOTH_DAY);
    expect((await verify(CODE, "198.51.100.2")).data).toEqual({ ok: false }); // no AZM_BOOTH_CODE
    process.env.AZM_BOOTH_CODE = CODE;
    const ok = await verify(CODE, "198.51.100.2");
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ ok: true, expires: NEXT_BOOTH_MIDNIGHT });
    expect(ok.data.session).toMatch(/^[0-9a-f]{64}$/);
    expect((await verify("482914", "198.51.100.2")).data).toEqual({ ok: false });
    expect((await verify("", "198.51.100.2")).data).toEqual({ ok: false });
    expect((await verify(CODE + "0", "198.51.100.2")).data).toEqual({ ok: false });
    // Never a staff session outside the booth days (BOOTH_DATES by default).
    setTime(T0);
    expect((await verify(CODE, "198.51.100.3")).data).toEqual({ ok: false, closed: true });
  });

  it("refuses bodies that do not fit", async () => {
    setTime(BOOTH_DAY);
    process.env.AZM_BOOTH_CODE = CODE;
    for (const body of [{}, { code: 482913 }, { code: "x".repeat(65) }, { code: CODE, extra: 1 }]) {
      const r = await h.call("/booth/verify", body, "", "POST", { "x-forwarded-for": "198.51.100.4" });
      expect(r.status).toBe(400);
      expect(r.data).toEqual({ error: "BOOTH_INVALID", field: expect.any(String) });
    }
  });

  it("allows 10 tries per IP in 15 minutes, right code or not, and other IPs keep theirs", async () => {
    setTime(BOOTH_DAY);
    process.env.AZM_BOOTH_CODE = CODE;
    for (let i = 0; i < 10; i++) expect((await verify("000000", "203.0.113.7")).status).toBe(200);
    const eleventh = await verify(CODE, "203.0.113.7");
    expect(eleventh.status).toBe(429);
    expect(eleventh.data).toEqual({ error: "RATE_LIMIT" });
    expect((await verify(CODE, "203.0.113.8")).data.ok).toBe(true);
    setTime(BOOTH_DAY + 15 * MIN - 1000);
    expect((await verify(CODE, "203.0.113.7")).status).toBe(429);
    setTime(BOOTH_DAY + 15 * MIN + 1000);
    expect((await verify(CODE, "203.0.113.7")).data.ok).toBe(true);
  });

  it("keys the limit on the address the proxy saw: a spoofed X-Forwarded-For does not reset it", async () => {
    setTime(BOOTH_DAY + 2 * HOUR);
    process.env.AZM_BOOTH_CODE = CODE;
    // The client puts its own entries first; the trusted proxy appends the address it saw last.
    const spoofed = (i: number) =>
      h.call("/booth/verify", { code: "000000" }, "", "POST", {
        "x-forwarded-for": `10.0.${i}.1, 203.0.113.99`,
      });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await spoofed(i)).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  it("caps the verify calls of all addresses together in 15 minutes", async () => {
    setTime(BOOTH_DAY + 4 * HOUR);
    process.env.AZM_BOOTH_CODE = CODE;
    const out: number[] = [];
    for (let i = 0; i < 40; i++) out.push((await verify("000000", `100.64.${i}.1`)).status);
    expect(out.filter((c) => c === 429).length).toBeGreaterThan(0);
    // The right code is refused too while the cap holds, so the cap is no oracle either.
    expect((await verify(CODE, "100.65.0.1")).status).toBe(429);
    setTime(BOOTH_DAY + 4 * HOUR + 16 * MIN);
    expect((await verify(CODE, "100.65.0.1")).data.ok).toBe(true);
  });

  it("D-016: a staff session sent with the code is refused, like any other extra field (no S56 unlock)", async () => {
    setTime(BOOTH_DAY + 6 * HOUR);
    process.env.AZM_BOOTH_CODE = CODE;
    const session = (await verify(CODE, "198.51.100.77")).data.session as string;
    const r = await h.call("/booth/verify", { code: CODE, session }, "", "POST", {
      "x-forwarded-for": "198.51.100.77",
    });
    expect(r.status).toBe(400);
    expect(r.data).toEqual({ error: "BOOTH_INVALID", field: "body" });
  });

  it("never writes the code to a log", async () => {
    setTime(BOOTH_DAY);
    process.env.AZM_BOOTH_CODE = CODE;
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      await verify(CODE, "192.0.2.10");
      await verify("777777", "192.0.2.10");
      for (let i = 0; i < 11; i++) await verify("777777", "192.0.2.11");
      await h.call("/booth/verify", { code: 7 }, "", "POST", { "x-forwarded-for": "192.0.2.12" });
      const printed = spies.flatMap((s) => s.mock.calls.flat().map((a) => String(a)));
      expect(printed.some((p) => p.includes(CODE) || p.includes("777777"))).toBe(false);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  it("takes a daily code: each booth day has its own", async () => {
    process.env.AZM_BOOTH_CODE = "2026-10-11=111111, 2026-10-12=222222";
    setTime(BOOTH_DAY);
    expect((await verify("111111", "192.0.2.20")).data.ok).toBe(true);
    expect((await verify("222222", "192.0.2.20")).data.ok).toBe(false);
    setTime(BOOTH_DAY + DAY);
    expect((await verify("222222", "192.0.2.21")).data.ok).toBe(true);
    expect((await verify("111111", "192.0.2.21")).data.ok).toBe(false);
    // A day without its own code has none.
    setTime(BOOTH_DAY + 2 * DAY);
    expect((await verify("111111", "192.0.2.22")).data.ok).toBe(false);
  });

  it("works only in the booth hours when AZM_BOOTH_HOURS is set, and the session ends at closing", async () => {
    process.env.AZM_BOOTH_CODE = CODE;
    process.env.AZM_BOOTH_HOURS = "09:00-18:00";
    const at = (h: number, m = 0) => Date.UTC(2026, 9, 11, h - 3, m, 0);
    setTime(at(8, 59));
    expect((await verify(CODE, "192.0.2.30")).data).toEqual({ ok: false, closed: true });
    setTime(at(9));
    expect((await verify(CODE, "192.0.2.30")).data).toMatchObject({ ok: true, expires: at(18) });
    setTime(at(18));
    expect((await verify(CODE, "192.0.2.30")).data).toEqual({ ok: false, closed: true });
  });
});

/** 2026-10-12 00:00 in Riyadh: the booth session of 2026-10-11 ends at midnight without booth hours. */
const NEXT_BOOTH_MIDNIGHT = Date.UTC(2026, 9, 11, 21, 0, 0);

describe("booth passes (O17): staff session, one check visitor token, redeem, start", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  async function staffSession(ip: string): Promise<string> {
    const r = await h.call("/booth/verify", { code: CODE }, "", "POST", { "x-forwarded-for": ip });
    expect(r.data.ok).toBe(true);
    return r.data.session;
  }

  it("issues a 45 minute token for one check to a verified staff session", async () => {
    process.env.AZM_BOOTH_CODE = CODE;
    setTime(BOOTH_DAY);
    const session = await staffSession("192.0.2.40");
    expect((await h.call("/booth/token", { session: "f".repeat(64) })).status).toBe(403);
    expect((await h.call("/booth/token", { session: "f".repeat(64) })).data).toEqual({
      error: "BOOTH_SESSION",
    });
    const t = await h.call("/booth/token", { session });
    expect(t.status).toBe(200);
    expect(t.data).toEqual({ token: expect.stringMatching(/^[0-9a-f]{64}$/), expires: BOOTH_DAY + 45 * MIN });

    // The visitor's phone redeems the QR token once: it is swapped for this phone's own pass, which
    // stays valid until a check starts with it.
    const redeemed = await h.call("/booth/redeem", { token: t.data.token });
    expect(redeemed.data).toEqual({
      ok: true,
      token: expect.stringMatching(/^[0-9a-f]{64}$/),
      expires: BOOTH_DAY + 45 * MIN,
    });
    const pass = redeemed.data.token as string;
    expect(pass).not.toBe(t.data.token);
    expect((await h.call("/booth/redeem", { token: "0".repeat(64) })).data).toEqual({ ok: false });
    // The phone checks its pass without using it.
    expect((await h.call("/booth/check", { token: pass })).data).toEqual({
      ok: true,
      expires: BOOTH_DAY + 45 * MIN,
    });
    expect((await h.call("/booth/check", { token: pass })).data).toEqual({
      ok: true,
      expires: BOOTH_DAY + 45 * MIN,
    });

    // A signed in visitor starts a booth check with the phone's pass, once; the QR token is spent.
    const cookie = await member(h, "visitor@example.test", intakeOf());
    expect((await start(h, cookie, {}, { setting: "booth", boothToken: t.data.token })).data).toEqual({
      error: "BOOTH_CODE",
    });
    const s = await start(h, cookie, {}, { setting: "booth", boothToken: pass });
    expect(s.status).toBe(200);
    expect(s.data.setting).toBe("booth");
    const again = await start(h, cookie, {}, { setting: "booth", boothToken: pass });
    expect(again.data).toEqual({ error: "BOOTH_CODE" });
    expect((await h.call("/booth/redeem", { token: pass })).data).toEqual({ ok: false });
    expect((await h.call("/booth/check", { token: pass })).data).toEqual({ ok: false });
    // Only hashes are stored, never a token.
    const stored = rows(h, "SELECT * FROM booth_passes");
    for (const secret of [t.data.token, pass, session]) expect(JSON.stringify(stored)).not.toContain(secret);
  });

  it("redeems a QR token on one phone only: a second phone is refused (O17, S55b)", async () => {
    process.env.AZM_BOOTH_CODE = CODE;
    setTime(BOOTH_DAY);
    const session = await staffSession("192.0.2.42");
    const qr = (await h.call("/booth/token", { session })).data.token as string;
    const first = await h.call("/booth/redeem", { token: qr });
    expect(first.data.ok).toBe(true);
    for (let phone = 2; phone <= 5; phone++)
      expect((await h.call("/booth/redeem", { token: qr })).data, `phone ${phone}`).toEqual({ ok: false });
    expect((await h.call("/booth/check", { token: qr })).data).toEqual({ ok: false });
    // Bodies that do not fit are refused.
    expect((await h.call("/booth/check", { token: first.data.token, extra: 1 })).status).toBe(400);
  });

  it("ends a visitor token after 45 minutes and a staff session at the end of the booth day", async () => {
    process.env.AZM_BOOTH_CODE = CODE;
    setTime(BOOTH_DAY);
    const session = await staffSession("192.0.2.41");
    const t = await h.call("/booth/token", { session });
    setTime(BOOTH_DAY + 45 * MIN);
    expect((await h.call("/booth/redeem", { token: t.data.token })).data).toEqual({ ok: false });
    const cookie = await member(h, "late-visitor@example.test", intakeOf());
    expect((await start(h, cookie, {}, { setting: "booth", boothToken: t.data.token })).data).toEqual({
      error: "BOOTH_CODE",
    });
    // Close to midnight the token ends with the booth day.
    setTime(NEXT_BOOTH_MIDNIGHT - 10 * MIN);
    expect((await h.call("/booth/token", { session })).data.expires).toBe(NEXT_BOOTH_MIDNIGHT);
    setTime(NEXT_BOOTH_MIDNIGHT);
    expect((await h.call("/booth/token", { session })).data).toEqual({ error: "BOOTH_SESSION" });
  });

  it("never takes the staff code on the start, so the start tells nothing about a code", async () => {
    process.env.AZM_BOOTH_CODE = CODE;
    setTime(BOOTH_DAY);
    // A fresh account: no intake, consent or adult confirmation.
    const cookie = await register(h, "oracle@example.test");
    const answers = {};
    const tries = await Promise.all(
      ["000001", "000002", CODE].map((boothCode) =>
        h.call("/assessments", { answers, device: DEVICE, setting: "booth", boothCode }, cookie),
      ),
    );
    for (const r of tries) {
      expect(r.status).toBe(400);
      expect(r.data).toEqual({ error: "START_INVALID", field: "boothCode" });
    }
  });

  it("starts a signed in booth check with a token from the staff code on a booth day only", async () => {
    process.env.AZM_BOOTH_CODE = CODE;
    setTime(T0);
    const cookie = await member(h, "code-visitor@example.test", intakeOf());
    expect((await start(h, cookie, {}, { setting: "booth", boothCode: CODE })).data).toEqual({
      error: "BOOTH_CODE",
    });
    process.env.AZM_BOOTH_DATES = "2026-10-04";
    expect((await start(h, cookie, {}, { setting: "booth", boothCode: CODE })).status).toBe(200);
  });
});

describe("the adult confirmation (Q2 (5), Q32 (6), UX S05a)", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("is stored once per account, returned in the context and required to start", async () => {
    const cookie = await member(h, "adult@example.test", intakeOf(), true, false);
    expect((await h.call("/assessments/context", undefined, cookie)).data.adultConfirmed).toBe(false);
    expect((await start(h, cookie)).data).toEqual({ error: "ADULT_REQUIRED" });
    for (const body of [{}, { confirmed: false }, { confirmed: "yes" }, { confirmed: true, age: 30 }])
      expect((await h.call("/account/adult", body, cookie)).data).toEqual({
        error: "ADULT_INVALID",
        field: expect.any(String),
      });
    expect((await h.call("/account/adult", { confirmed: true })).status).toBe(401);
    const ok = await h.call("/account/adult", { confirmed: true }, cookie);
    expect(ok.data).toEqual({ adultConfirmed: true, confirmedAt: T0 });
    setTime(T0 + HOUR);
    expect((await h.call("/account/adult", { confirmed: true }, cookie)).data.confirmedAt).toBe(T0);
    expect((await h.call("/assessments/context", undefined, cookie)).data.adultConfirmed).toBe(true);
    expect((await start(h, cookie)).status).toBe(200);
  });

  it("asks the consent first, then the adult confirmation", async () => {
    const cookie = await member(h, "adult2@example.test", intakeOf(), false, false);
    expect((await start(h, cookie)).data).toEqual({ error: "CONSENT_REQUIRED" });
  });

  it("is required at account creation: accounts are for adults 18 or older only", async () => {
    const base = { name: "Adult Member", password: "test-password-5531" };
    for (const adultConfirmed of [undefined, false, "yes", 1]) {
      const r = await h.call("/auth/register", { ...base, email: "minor@example.test", adultConfirmed });
      expect(r.status, String(adultConfirmed)).toBe(400);
      expect(r.data).toEqual({ error: "ADULT_REQUIRED" });
    }
    // Nothing was created.
    expect(rows(h, "SELECT id FROM users WHERE email=?", "minor@example.test")).toEqual([]);
    const r = await h.call("/auth/register", { ...base, email: "adult3@example.test", adultConfirmed: true });
    expect(r.status).toBe(200);
    await h.call("/intake", intakeOf(), r.cookie, "PUT");
    expect((await h.call("/assessments/context", undefined, r.cookie)).data.adultConfirmed).toBe(true);
  });
});

describe("the lock record without the reason id (Q25 (c), Q33 (4))", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("keeps { until, releasableByClearance } only, and answers with the {when} of scr_paused_today", async () => {
    const cookie = await member(h, "lock@example.test", intakeOf());
    const r = await start(h, cookie, { pc_unwell: "yes" });
    expect(r.data).toEqual({
      error: "POSTPONE",
      status: "postpone",
      reason: "unwell",
      screen: "scr_postpone_unwell",
      alsoShow: [],
      lock: LOCK_NEXT_DAY,
    });
    const cols = rows(h, "PRAGMA table_info(check_locks)").map((c) => c.name);
    expect(cols).toEqual(["user_id", "until", "releasable_by_clearance"]);
    expect(JSON.stringify(rows(h, "SELECT * FROM check_locks"))).not.toContain("unwell");
    setTime(T0 + HOUR);
    expect((await h.call("/assessments/context", undefined, cookie)).data.lock).toEqual(LOCK_NEXT_DAY);
    expect((await start(h, cookie)).data).toEqual({ error: "LOCKED", ...LOCK_NEXT_DAY });
  });

  it("marks a recent change lock as releasable, and a 60 minute lock reads in about an hour", async () => {
    const change = await member(h, "lock-change@example.test", intakeOf());
    const c = await start(h, change, { pc_change: "yes", pc_change_cleared: "no" });
    expect(c.data.lock).toEqual({ ...LOCK_NEXT_DAY, releasableByClearance: true });
    const ms = await member(h, "lock-ms@example.test", intakeOf({ conditions: ["ms"] }));
    const m = await start(h, ms, { pc_ms_heat: "yes" });
    expect(m.data.lock).toEqual({
      until: T0 + HOUR,
      releasableByClearance: false,
      when: { token: "min60_start" },
    });
    setTime(T0 + 10 * MIN);
    expect((await h.call("/assessments/context", undefined, ms)).data.lock).toEqual({
      until: T0 + HOUR,
      releasableByClearance: false,
      when: { token: "sameDay_clock", time: { hour: 10, minute: 0, suffix: "am" } },
    });
  });
});

describe("the safety log and product counts (Q25 (a), Q2 (6))", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("counts a pre-check postpone under precheck, with the check started as its denominator", async () => {
    const cookie = await member(h, "count-postpone@example.test", intakeOf());
    await start(h, cookie, { pc_unwell: "yes" });
    expect(safety(h)).toEqual([
      { day: "2026-10-04", reason: "precheck:unwell", test_id: "precheck", setting: "home", count: 1 },
    ]);
    expect(product(h, "checks_started")).toEqual([{ key: "", setting: "home", count: 1 }]);
  });

  it("counts a stop once per test side under its test id, even after a restart, and stores the stopped test", async () => {
    const cookie = await member(h, "count-stop@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    const { id, protocol } = s.data;
    const right = itemOf(protocol, "shoulder_abduction", "right");
    const body = { option: "tired", testId: right.testId, side: right.side };
    const first = await h.call(`/assessments/${id}/stop`, body, cookie);
    expect(first.data).toMatchObject({ option: "tired", endsCheck: false, reason: "stopped_symptom" });
    expect((await h.call(`/assessments/${id}/stop`, body, cookie)).status).toBe(200);
    await h.restart();
    expect((await h.call(`/assessments/${id}/stop`, { ...body, option: "choice" }, cookie)).status).toBe(200);
    const stops = safety(h).filter((r) => String(r.reason).startsWith("stop:"));
    expect(stops).toEqual([
      { day: "2026-10-04", reason: "stop:tired", test_id: "shoulder_abduction", setting: "home", count: 1 },
    ]);
    // The stopped test stores no score, only the reason (resultOnStop), and is not measured again today.
    const list = (await h.call("/assessments", undefined, cookie)).data.assessments;
    expect(list[0].results).toEqual([
      expect.objectContaining({
        testId: "shoulder_abduction",
        side: "right",
        value: null,
        skippedReason: "stopped_symptom",
        flags: ["stopped"],
      }),
    ]);
    expect((await h.call(`/assessments/${id}/results`, resultBody(right, 100), cookie)).data).toEqual({
      error: "STOPPED",
      reason: "stopped_symptom",
    });
    // A skip for the stopped test (the client's copy) is accepted and changes nothing.
    expect((await h.call(`/assessments/${id}/results`, skipBody(right, "by_choice"), cookie)).data).toEqual({
      saved: true,
    });
    expect(
      (await h.call("/assessments", undefined, cookie)).data.assessments[0].results[0].skippedReason,
    ).toBe("stopped_symptom");
    // Another test side is a new stop.
    const left = itemOf(protocol, "shoulder_abduction", "left");
    await h.call(
      `/assessments/${id}/stop`,
      { option: "tired", testId: left.testId, side: left.side },
      cookie,
    );
    expect(safety(h).find((r) => r.reason === "stop:tired")?.count).toBe(2);
    // A test side outside the protocol is refused, the option still checked first.
    expect(
      (
        await h.call(
          `/assessments/${id}/stop`,
          { option: "tired", testId: "chair_stand_30s", side: "none" },
          cookie,
        )
      ).data,
    ).toEqual({ error: "STOP_INVALID", field: "testId" });
  });

  it("stores changeReported after chest, stroke signs and breath stops, and faintReported after a faint stop", async () => {
    const chest = await member(h, "count-chest@example.test", intakeOf());
    const s = await start(h, chest);
    const item = itemOf(s.data.protocol, "shoulder_abduction", "right");
    const r = await h.call(
      `/assessments/${s.data.id}/stop`,
      { option: "chest", testId: item.testId, side: item.side },
      chest,
    );
    expect(r.data).toMatchObject({ screen: "scr_emergency", endsCheck: true, lock: LOCK_NEXT_DAY });
    setTime(NEXT_DAY + HOUR);
    const c = await h.call("/assessments/context", undefined, chest);
    expect(c.data.unresolvedChangeReported).toBe(true);
    expect(c.data.lock).toBeNull();
    // The next check goes straight to pc_change_cleared, and stays postponed until cleared.
    expect((await start(h, chest, { pc_change_cleared: "no" })).data.reason).toBe("recent_change");

    setTime(T0);
    const faint = await member(h, "count-faint@example.test", intakeOf());
    const f = await start(h, faint);
    const fi = itemOf(f.data.protocol, "shoulder_abduction", "right");
    const fr = await h.call(
      `/assessments/${f.data.id}/stop`,
      { option: "faint", testId: fi.testId, side: fi.side },
      faint,
    );
    expect(fr.data).toMatchObject({ screen: "scr_faint", endsCheck: true, then: "sf_faint_loc" });
    setTime(NEXT_DAY + HOUR);
    const fc = await h.call("/assessments/context", undefined, faint);
    expect(fc.data.faintReportedUnresolved).toBe(true);
    expect(fc.data.unresolvedChangeReported).toBe(false);
    // pc_faint_since is asked once; no clears faintReported and the check goes ahead.
    const answers = await answersFor(h, faint, { pc_faint_since: "no" });
    expect(answers.pc_faint_since).toBe("no");
    expect((await h.call("/assessments", { answers, device: DEVICE }, faint)).status).toBe(200);
    expect((await h.call("/assessments/context", undefined, faint)).data.faintReportedUnresolved).toBe(false);
  });

  it("pc_faint_since yes postpones with recent_change and still clears faintReported", async () => {
    const cookie = await member(h, "faint-since@example.test", intakeOf());
    const s = await start(h, cookie);
    const it0 = itemOf(s.data.protocol, "shoulder_abduction", "right");
    await h.call(
      `/assessments/${s.data.id}/stop`,
      { option: "faint", testId: it0.testId, side: it0.side },
      cookie,
    );
    setTime(NEXT_DAY + HOUR);
    const r = await start(h, cookie, { pc_faint_since: "yes" });
    expect(r.data).toMatchObject({ error: "POSTPONE", reason: "recent_change" });
    const c = await h.call("/assessments/context", undefined, cookie);
    expect(c.data.faintReportedUnresolved).toBe(false);
    expect(c.data.unresolvedChangeReported).toBe(true);
  });

  it("counts checks completed, tests finished and skipped, quality retries and minutes", async () => {
    await h.close();
    h = await startApi();
    const cookie = await member(h, "count-product@example.test", intakeOf());
    const s = await start(h, cookie);
    const { id, protocol } = s.data;
    const right = itemOf(protocol, "shoulder_abduction", "right");
    const left = itemOf(protocol, "shoulder_abduction", "left");
    setTime(T0 + 4 * MIN);
    await h.call(`/assessments/${id}/results`, { ...resultBody(right, 100), qualityRetries: 2 }, cookie);
    // A re-post replaces the result and is not counted again.
    await h.call(`/assessments/${id}/results`, { ...resultBody(right, 102), qualityRetries: 1 }, cookie);
    await h.call(`/assessments/${id}/results`, skipBody(left, "motion_needed"), cookie);
    const curl = itemOf(protocol, "arm_curl_30s", "right");
    await h.call(`/assessments/${id}/results`, skipBody(curl, "chair_needed"), cookie);
    setTime(T0 + 12 * MIN + 20 * 1000);
    expect((await h.call(`/assessments/${id}/complete`, {}, cookie)).status).toBe(200);
    expect(product(h, "checks_completed")).toEqual([{ key: "", setting: "home", count: 1 }]);
    expect(product(h, "tests_finished")).toEqual([{ key: "shoulder_abduction", setting: "home", count: 1 }]);
    expect(product(h, "tests_skipped")).toEqual([
      { key: "chair_needed", setting: "home", count: 1 },
      { key: "motion_needed", setting: "home", count: 1 },
      // The protocol skips count too: the chair stand is not part of a seated check.
      { key: "position_seated", setting: "home", count: 1 },
    ]);
    expect(product(h, "quality_retries")).toEqual([{ key: "shoulder_abduction", setting: "home", count: 2 }]);
    expect(product(h, "check_minutes")).toEqual([{ key: "", setting: "home", count: 12 }]);
  });

  it("refuses a quality retry count that does not fit", async () => {
    const cookie = await member(h, "count-retries@example.test", intakeOf());
    const s = await start(h, cookie);
    const right = itemOf(s.data.protocol, "shoulder_abduction", "right");
    for (const n of [-1, 1.5, 21, "2"])
      expect(
        (
          await h.call(
            `/assessments/${s.data.id}/results`,
            { ...resultBody(right, 100), qualityRetries: n },
            cookie,
          )
        ).data,
      ).toEqual({
        error: "RESULT_INVALID",
        field: "qualityRetries",
      });
  });

  it("takes no alarm answer (D-016): the check in posts nothing, and nothing is counted for it", async () => {
    const cookie = await member(h, "count-alarm@example.test", intakeOf());
    const s = await start(h, cookie);
    const r = await h.call(
      `/assessments/${s.data.id}/answer`,
      { question: "alarm", kind: "no_response" },
      cookie,
    );
    expect(r.status).toBe(400);
    expect(r.data).toEqual({ error: "ANSWER_INVALID", field: "question" });
    expect(safety(h).filter((x) => String(x.reason).startsWith("alarm:"))).toEqual([]);
  });

  it("never stores a user id, an email, a check id or a condition key in any counter row", async () => {
    const ids: string[] = [];
    const emails = ["anon-a@example.test", "anon-b@example.test"];
    for (const email of emails) {
      const cookie = await member(h, email, WHEELCHAIR_STROKE);
      ids.push((await h.call("/auth/me", undefined, cookie)).data.user.id);
      const s = await start(h, cookie);
      ids.push(s.data.id);
      const item = itemOf(s.data.protocol, "shoulder_abduction", "right");
      await h.call(`/assessments/${s.data.id}/results`, resultBody(item, 100), cookie);
      await h.call(`/assessments/${s.data.id}/stop`, { option: "tired" }, cookie);
      await h.call(`/assessments/${s.data.id}/answer`, { question: "end", answer: "yes" }, cookie);
      await start(h, cookie);
    }
    const tables = {
      safety_events: ["day", "reason", "test_id", "setting", "count"],
      product_counts: ["day", "metric", "key", "setting", "count"],
    };
    const conditions = ["stroke", "sci_complete", "sci_incomplete", "ms", "parkinsons", "cerebral_palsy"];
    for (const [table, columns] of Object.entries(tables)) {
      expect(rows(h, `PRAGMA table_info(${table})`).map((c) => c.name)).toEqual(columns);
      const all = rows(h, `SELECT * FROM ${table}`);
      expect(all.length).toBeGreaterThan(0);
      const text = JSON.stringify(all);
      for (const secret of [...ids, ...emails, "Check Member"]) expect(text).not.toContain(secret);
      for (const r of all) for (const v of Object.values(r)) expect(conditions).not.toContain(v);
      for (const r of all) expect(String(r.day)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("the end of check question (Q23 (7))", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("asks the general form, or the side form after a one sided large drop", async () => {
    const cookie = await member(h, "end-side@example.test", intakeOf());
    const s1 = await start(h, cookie);
    await postResults(h, cookie, s1.data.id, s1.data.protocol, CHAIR_VALUES);
    expect((await h.call(`/assessments/${s1.data.id}/end`, undefined, cookie)).data).toEqual({
      question: "ec_symptoms",
      side: null,
      chronicNote: false,
    });
    await h.call(`/assessments/${s1.data.id}/answer`, { question: "end", answer: "no" }, cookie);
    await h.call(`/assessments/${s1.data.id}/complete`, {}, cookie);
    setTime(T0 + 3 * DAY);
    const s2 = await start(h, cookie);
    await postResults(h, cookie, s2.data.id, s2.data.protocol, {
      ...CHAIR_VALUES,
      "shoulder_abduction:left": 40,
    });
    expect((await h.call(`/assessments/${s2.data.id}/end`, undefined, cookie)).data).toEqual({
      question: "ec_symptoms",
      side: "left",
      chronicNote: false,
    });
    // The complete answer no longer carries the old symptomAsk.
    expect(
      (await h.call(`/assessments/${s2.data.id}/answer`, { question: "end", answer: "no" }, cookie)).data,
    ).toEqual({
      status: "proceed",
    });
    expect((await h.call(`/assessments/${s2.data.id}/complete`, {}, cookie)).data).toEqual({
      id: s2.data.id,
      completed: T0 + 3 * DAY,
    });
  });

  it("gives the chronic line for a declared weaker side (O37)", async () => {
    const cookie = await member(h, "end-chronic@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    expect((await h.call(`/assessments/${s.data.id}/end`, undefined, cookie)).data.chronicNote).toBe(true);
  });

  it("yes opens the emergency screen, stores changeReported, locks the day and keeps the results", async () => {
    const cookie = await member(h, "end-yes@example.test", intakeOf());
    const s = await start(h, cookie);
    await postResults(h, cookie, s.data.id, s.data.protocol, CHAIR_VALUES);
    const r = await h.call(`/assessments/${s.data.id}/answer`, { question: "end", answer: "yes" }, cookie);
    expect(r.data).toEqual({
      status: "emergency",
      screen: "scr_emergency",
      alsoShow: [],
      lock: LOCK_NEXT_DAY,
    });
    const list = (await h.call("/assessments", undefined, cookie)).data.assessments;
    expect(list[0]).toMatchObject({ status: "completed", completed: T0 });
    expect(list[0].results).toHaveLength(6);
    expect(safety(h)).toContainEqual({
      day: "2026-10-04",
      reason: "end:symptoms",
      test_id: "none",
      setting: "home",
      count: 1,
    });
    // A second yes (a repeated post) still reaches the check and keeps its lock, counted once.
    expect(
      (await h.call(`/assessments/${s.data.id}/answer`, { question: "end", answer: "yes" }, cookie)).data,
    ).toMatchObject({
      status: "emergency",
    });
    expect(safety(h).filter((r) => r.reason === "end:symptoms")).toEqual([
      { day: "2026-10-04", reason: "end:symptoms", test_id: "none", setting: "home", count: 1 },
    ]);
    expect((await h.call("/assessments", undefined, cookie)).data.assessments[0].status).toBe("completed");
    setTime(NEXT_DAY + HOUR);
    expect((await h.call("/assessments/context", undefined, cookie)).data.unresolvedChangeReported).toBe(
      true,
    );
    for (const answer of ["maybe", 1, undefined])
      expect(
        (await h.call(`/assessments/${s.data.id}/answer`, { question: "end", answer }, cookie)).status,
      ).toBe(400);
  });

  it("yes on a check without any result starts no clock", async () => {
    const cookie = await member(h, "end-empty@example.test", intakeOf());
    const s = await start(h, cookie);
    expect(
      (await h.call(`/assessments/${s.data.id}/answer`, { question: "end", answer: "yes" }, cookie)).data
        .status,
    ).toBe("emergency");
    const list = (await h.call("/assessments", undefined, cookie)).data.assessments;
    expect(list[0]).toMatchObject({ status: "abandoned", completed: null });
    expect((await h.call("/assessments/context", undefined, cookie)).data.earliestNext).toBeNull();
  });

  it("is asked after a check ended early, with the AD steps for SCI", async () => {
    const cookie = await member(
      h,
      "end-early@example.test",
      intakeOf({ conditions: ["sci_incomplete"], mobility: "wheelchair", clearance: "yes" }),
    );
    const s = await start(h, cookie, { pc_sci_level: "no" });
    expect(s.status).toBe(200);
    const item = s.data.protocol.find((i: ProtocolItem) => !i.skipped);
    await h.call(`/assessments/${s.data.id}/results`, resultBody(item, 80), cookie);
    await h.call(`/assessments/${s.data.id}/stop`, { option: "fall" }, cookie);
    const r = await h.call(`/assessments/${s.data.id}/answer`, { question: "end", answer: "yes" }, cookie);
    expect(r.data).toMatchObject({ status: "emergency", screen: "scr_emergency", alsoShow: ["scr_ad"] });
    const list = (await h.call("/assessments", undefined, cookie)).data.assessments;
    expect(list[0]).toMatchObject({ status: "ended_early", endedReason: "stop" });
  });
});

describe("the faint follow up (Q33 (3), O42)", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  async function stopped(email: string, option: "faint" | "fall") {
    const cookie = await member(h, email, intakeOf());
    const s = await start(h, cookie);
    const item = itemOf(s.data.protocol, "shoulder_abduction", "right");
    await h.call(`/assessments/${s.data.id}/stop`, { option, testId: item.testId, side: item.side }, cookie);
    return { cookie, id: s.data.id as string };
  }

  it("yes or not sure opens the emergency screen and stores changeReported", async () => {
    for (const [email, answer] of [
      ["faint-yes@example.test", "yes"],
      ["faint-unsure@example.test", "unsure"],
    ]) {
      const { cookie, id } = await stopped(email, "faint");
      const r = await h.call(
        `/assessments/${id}/answer`,
        { question: "faint", answer, testId: "shoulder_abduction" },
        cookie,
      );
      expect(r.data).toEqual({
        status: "emergency",
        screen: "scr_emergency",
        alsoShow: [],
        lock: LOCK_NEXT_DAY,
      });
      setTime(NEXT_DAY + HOUR);
      expect((await h.call("/assessments/context", undefined, cookie)).data.unresolvedChangeReported).toBe(
        true,
      );
      setTime(T0);
    }
    expect(safety(h).filter((r) => String(r.reason).startsWith("faint_loc:"))).toEqual([
      {
        day: "2026-10-04",
        reason: "faint_loc:unsure",
        test_id: "shoulder_abduction",
        setting: "home",
        count: 1,
      },
      {
        day: "2026-10-04",
        reason: "faint_loc:yes",
        test_id: "shoulder_abduction",
        setting: "home",
        count: 1,
      },
    ]);
  });

  it("no keeps the next day lock; a fall stop asks it too", async () => {
    const { cookie, id } = await stopped("faint-no@example.test", "faint");
    expect(
      (await h.call(`/assessments/${id}/answer`, { question: "faint", answer: "no" }, cookie)).data,
    ).toEqual({
      status: "recorded",
      screen: null,
      alsoShow: [],
      lock: LOCK_NEXT_DAY,
    });
    setTime(NEXT_DAY + HOUR);
    expect((await h.call("/assessments/context", undefined, cookie)).data.unresolvedChangeReported).toBe(
      false,
    );
    setTime(T0);
    const fall = await stopped("fall-loc@example.test", "fall");
    expect(
      (await h.call(`/assessments/${fall.id}/answer`, { question: "faint", answer: "yes" }, fall.cookie)).data
        .status,
    ).toBe("emergency");
  });

  it("is only asked after a stop that ended the check, with a valid answer", async () => {
    const cookie = await member(h, "faint-open@example.test", intakeOf());
    const s = await start(h, cookie);
    expect(
      (await h.call(`/assessments/${s.data.id}/answer`, { question: "faint", answer: "no" }, cookie)).data,
    ).toEqual({
      error: "NOT_STOPPED",
    });
    const { cookie: c2, id } = await stopped("faint-bad@example.test", "faint");
    for (const body of [
      { answer: "maybe" },
      {},
      { answer: "no", note: "x" },
      // The alarm route went with D-016: the old flag is an unknown key.
      { answer: "no", afterNoResponse: true },
    ])
      expect((await h.call(`/assessments/${id}/answer`, { question: "faint", ...body }, c2)).status).toBe(
        400,
      );
  });
});

describe("the next check dates (H9, Q12 (2))", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("a booth check sets no home due date; the first home check is 48 hours after it", async () => {
    process.env.AZM_BOOTH_CODE = CODE;
    process.env.AZM_BOOTH_DATES = "2026-10-04";
    const cookie = await member(h, "h9-booth@example.test", intakeOf());
    const s = await start(h, cookie, {}, { setting: "booth", boothCode: CODE });
    const item = s.data.protocol.find((i: ProtocolItem) => !i.skipped);
    await h.call(`/assessments/${s.data.id}/results`, resultBody(item, 100), cookie);
    await h.call(`/assessments/${s.data.id}/complete`, {}, cookie);
    const c = (await h.call("/assessments/context", undefined, cookie)).data;
    expect(c).toMatchObject({ retestDue: null, earliestNext: T0 + 48 * HOUR, early: false });
    expect((await h.call("/progress", undefined, cookie)).data).toMatchObject({
      retestDue: null,
      earliestNext: T0 + 48 * HOUR,
    });
  });

  it("after a home check the next is due in 28 days, and an earlier start is early", async () => {
    const cookie = await member(h, "h9-home@example.test", intakeOf());
    const s = await start(h, cookie);
    await postResults(h, cookie, s.data.id, s.data.protocol, CHAIR_VALUES);
    await h.call(`/assessments/${s.data.id}/complete`, {}, cookie);
    setTime(T0 + 3 * DAY);
    const c = (await h.call("/assessments/context", undefined, cookie)).data;
    expect(c).toMatchObject({ retestDue: T0 + 28 * DAY, earliestNext: T0 + 48 * HOUR, early: true });
    setTime(T0 + 28 * DAY);
    const again = await login(h, "h9-home@example.test");
    expect((await h.call("/assessments/context", undefined, again)).data.early).toBe(false);
  });

  it("offers the side lean only session 48 hours to 7 days after the first home check (Q12 (2))", async () => {
    const cookie = await member(h, "q12@example.test", intakeOf());
    const s = await start(h, cookie);
    await postResults(h, cookie, s.data.id, s.data.protocol, CHAIR_VALUES);
    await h.call(`/assessments/${s.data.id}/complete`, {}, cookie);
    setTime(T0 + 47 * HOUR);
    expect((await h.call("/assessments/context", undefined, cookie)).data.sideLeanRepeat).toBeNull();
    expect((await start(h, cookie, {}, { session: "side_lean_only" })).data).toEqual({
      error: "NOT_OFFERED",
    });
    setTime(T0 + 50 * HOUR);
    expect((await h.call("/assessments/context", undefined, cookie)).data.sideLeanRepeat).toEqual({
      from: T0 + 48 * HOUR,
      to: T0 + 7 * DAY,
      baseTests: ["trunk_control_seated"],
    });
    const r = await start(h, cookie, {}, { session: "side_lean_only" });
    expect(r.status).toBe(200);
    expect(r.data.protocol.map((i: ProtocolItem) => i.testId)).toEqual([
      "trunk_control_seated",
      "trunk_control_seated",
    ]);
    await postResults(h, cookie, r.data.id, r.data.protocol, CHAIR_VALUES);
    await h.call(`/assessments/${r.data.id}/complete`, {}, cookie);
    const c = (await h.call("/assessments/context", undefined, cookie)).data;
    // It counts for the 48 hour minimum and does not move the due date; it is not offered again.
    expect(c).toMatchObject({ retestDue: T0 + 28 * DAY, earliestNext: T0 + 98 * HOUR, sideLeanRepeat: null });
    expect((await h.call("/assessments", undefined, cookie)).data.assessments[0].session).toBe(
      "side_lean_only",
    );
    expect((await start(h, cookie, {}, { session: "weekly" })).data).toEqual({
      error: "START_INVALID",
      field: "session",
    });
  });
});

describe("every test skipped today (O21)", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("closes the check as ended early and starts no clock", async () => {
    const cookie = await member(h, "o21@example.test", intakeOf());
    const r = await start(h, cookie, {
      pc_pain_now: 3,
      pc_pain_areas: { shoulder_left: 6, shoulder_right: 6, back: 6, elbow_left: 6, elbow_right: 6 },
    });
    expect(r.status).toBe(200);
    expect(r.data.status).toBe("ended_early");
    // No test runs today; the chair stand is not part of a seated check (position_seated).
    expect(r.data.protocol.every((i: ProtocolItem) => i.skipped !== undefined)).toBe(true);
    const list = (await h.call("/assessments", undefined, cookie)).data.assessments;
    expect(list[0]).toMatchObject({ status: "ended_early", endedReason: "all_skipped", completed: null });
    const c = (await h.call("/assessments/context", undefined, cookie)).data;
    expect(c).toMatchObject({ earliestNext: null, retestDue: null, completedBefore: false });
    expect(product(h, "checks_ended_early")).toEqual([{ key: "", setting: "home", count: 1 }]);
    expect(product(h, "tests_skipped")).toEqual([
      { key: "pain_today", setting: "home", count: 6 },
      { key: "position_seated", setting: "home", count: 1 },
    ]);
    expect((await start(h, cookie)).status).toBe(200);
  });
});

describe("the resume window and the re-ask (O6)", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  const RESUME = {
    pc_urgent: "no",
    pc_unwell: "no",
    pc_pain_now: 0,
    "pc_helper:trunk_control_seated": "yes",
  };

  it("closes a check idle for more than 30 minutes: ended early with its results, abandoned without", async () => {
    const cookie = await member(h, "o6-idle@example.test", intakeOf());
    const s = await start(h, cookie);
    const right = itemOf(s.data.protocol, "shoulder_abduction", "right");
    setTime(T0 + 5 * MIN);
    await h.call(`/assessments/${s.data.id}/results`, resultBody(right, 100), cookie);
    setTime(T0 + 36 * MIN);
    const left = itemOf(s.data.protocol, "shoulder_abduction", "left");
    expect((await h.call(`/assessments/${s.data.id}/results`, resultBody(left, 90), cookie)).data).toEqual({
      error: "NOT_OPEN",
      status: "ended_early",
    });
    const list = (await h.call("/assessments", undefined, cookie)).data.assessments;
    expect(list[0]).toMatchObject({ status: "ended_early", endedReason: "stale" });
    expect(list[0].results).toHaveLength(1);
    expect((await h.call("/progress", undefined, cookie)).data.tests).toHaveLength(1);
    expect(product(h, "check_minutes")).toEqual([{ key: "", setting: "home", count: 5 }]);

    const s2 = await start(h, cookie);
    setTime(T0 + 36 * MIN + 31 * MIN);
    expect((await h.call(`/assessments/${s2.data.id}/results`, resultBody(right, 100), cookie)).data).toEqual(
      {
        error: "NOT_OPEN",
        status: "abandoned",
      },
    );
  });

  it("gives the open check in the context while it can resume, and never after 30 minutes", async () => {
    const cookie = await member(h, "o6-context@example.test", intakeOf());
    expect((await h.call("/assessments/context", undefined, cookie)).data.openCheck).toBeNull();
    const s = await start(h, cookie);
    setTime(T0 + 10 * MIN);
    expect((await h.call("/assessments/context", undefined, cookie)).data.openCheck).toEqual({
      id: s.data.id,
      setting: "home",
      resumeUntil: T0 + 30 * MIN,
    });
    setTime(T0 + 31 * MIN);
    expect((await h.call("/assessments/context", undefined, cookie)).data.openCheck).toBeNull();
  });

  it("a late stop reaches an idle check but never keeps it open", async () => {
    const cookie = await member(h, "o6-late-stop@example.test", intakeOf());
    const s = await start(h, cookie);
    const right = itemOf(s.data.protocol, "shoulder_abduction", "right");
    await h.call(`/assessments/${s.data.id}/results`, resultBody(right, 100), cookie);
    setTime(T0 + 40 * MIN);
    expect((await h.call(`/assessments/${s.data.id}/stop`, { option: "choice" }, cookie)).status).toBe(200);
    const left = itemOf(s.data.protocol, "shoulder_abduction", "left");
    expect((await h.call(`/assessments/${s.data.id}/results`, resultBody(left, 90), cookie)).data).toEqual({
      error: "NOT_OPEN",
      status: "ended_early",
    });
  });

  it("resumes within 30 minutes after the day questions are asked again", async () => {
    const cookie = await member(h, "o6-resume@example.test", intakeOf());
    const s = await start(h, cookie);
    const right = itemOf(s.data.protocol, "shoulder_abduction", "right");
    await h.call(`/assessments/${s.data.id}/results`, resultBody(right, 100), cookie);
    setTime(T0 + 20 * MIN);
    expect((await h.call(`/assessments/${s.data.id}/resume`, { answers: {} }, cookie)).data).toEqual({
      error: "RESUME_INCOMPLETE",
    });
    const r = await h.call(`/assessments/${s.data.id}/resume`, { answers: RESUME }, cookie);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ status: "proceed", skips: [] });
    // The window starts again from the resume.
    setTime(T0 + 45 * MIN);
    const left = itemOf(s.data.protocol, "shoulder_abduction", "left");
    expect((await h.call(`/assessments/${s.data.id}/results`, resultBody(left, 90), cookie)).data).toEqual({
      saved: true,
    });
  });

  it("stores the new skips of the re-ask, and a postpone closes the check with its results kept", async () => {
    const cookie = await member(h, "o6-pain@example.test", intakeOf());
    const s = await start(h, cookie);
    const right = itemOf(s.data.protocol, "shoulder_abduction", "right");
    await h.call(`/assessments/${s.data.id}/results`, resultBody(right, 100), cookie);
    setTime(T0 + 10 * MIN);
    const pain = await h.call(
      `/assessments/${s.data.id}/resume`,
      { answers: { ...RESUME, pc_pain_now: 3, pc_pain_worse: "no", pc_pain_areas: { back: 6 } } },
      cookie,
    );
    expect(pain.status).toBe(200);
    expect(pain.data.skips).toEqual([
      { testId: "trunk_control_seated", side: "left", reason: "pain_today" },
      { testId: "trunk_control_seated", side: "right", reason: "pain_today" },
    ]);
    const trunk = itemOf(s.data.protocol, "trunk_control_seated", "right");
    expect((await h.call(`/assessments/${s.data.id}/results`, resultBody(trunk, 20), cookie)).data).toEqual({
      error: "SKIPPED",
      reason: "pain_today",
    });
    const urgent = await h.call(
      `/assessments/${s.data.id}/resume`,
      { answers: { pc_urgent: "yes" } },
      cookie,
    );
    expect(urgent.status).toBe(409);
    expect(urgent.data).toEqual({
      error: "POSTPONE",
      status: "emergency",
      reason: "urgent",
      screen: "scr_emergency",
      alsoShow: [],
      lock: LOCK_NEXT_DAY,
    });
    const list = (await h.call("/assessments", undefined, cookie)).data.assessments;
    expect(list[0]).toMatchObject({ status: "ended_early", endedReason: "stop" });
    expect(list[0].results.filter((r: any) => r.value !== null)).toHaveLength(1);
    expect(safety(h)).toContainEqual({
      day: "2026-10-04",
      reason: "precheck:urgent",
      test_id: "precheck",
      setting: "home",
      count: 1,
    });
    setTime(NEXT_DAY + HOUR);
    expect((await h.call("/assessments/context", undefined, cookie)).data.unresolvedChangeReported).toBe(
      true,
    );
  });

  it("does not resume a closed check, or a home check while home checks are closed", async () => {
    const cookie = await member(h, "o6-closed@example.test", intakeOf());
    const s = await start(h, cookie);
    delete process.env.AZM_CHECK_HOME;
    expect((await h.call(`/assessments/${s.data.id}/resume`, { answers: RESUME }, cookie)).data).toEqual({
      error: "HOME_CLOSED",
    });
    process.env.AZM_CHECK_HOME = "1";
    setTime(T0 + 31 * MIN);
    expect((await h.call(`/assessments/${s.data.id}/resume`, { answers: RESUME }, cookie)).data).toEqual({
      error: "NOT_OPEN",
      status: "abandoned",
    });
  });
});

describe("partial answers on terminal routes (O29) and the new skip reasons (O33 (m), Q9, O34-2)", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("accepts partial answers for an emergency, an AD response and a postpone", async () => {
    const a = await member(h, "o29-a@example.test", intakeOf());
    expect(
      (await h.call("/assessments", { answers: { pc_urgent: "yes" }, device: DEVICE }, a)).data,
    ).toMatchObject({
      error: "POSTPONE",
      status: "emergency",
    });
    const b = await member(h, "o29-b@example.test", intakeOf());
    expect(
      (await h.call("/assessments", { answers: { pc_urgent: "no", pc_unwell: "yes" }, device: DEVICE }, b))
        .data,
    ).toMatchObject({ error: "POSTPONE", status: "postpone", reason: "unwell" });
    const c = await member(
      h,
      "o29-c@example.test",
      intakeOf({ conditions: ["sci_complete"], mobility: "wheelchair", clearance: "yes" }),
    );
    expect(
      (
        await h.call(
          "/assessments",
          { answers: { pc_urgent: "no", pc_sci_level: "yes", pc_sci_ad_now: "yes" }, device: DEVICE },
          c,
        )
      ).data,
    ).toMatchObject({ error: "POSTPONE", status: "ad" });
    const d = await member(h, "o29-d@example.test", intakeOf());
    expect((await h.call("/assessments", { answers: { pc_urgent: "no" }, device: DEVICE }, d)).data).toEqual({
      error: "PRECHECK_INCOMPLETE",
    });
  });

  it("accepts motion_needed, chair_needed and helper_needed as skips posted during the check", async () => {
    const cookie = await member(h, "skips@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    const reasons = ["motion_needed", "chair_needed", "helper_needed"];
    const items = s.data.protocol.filter((i: ProtocolItem) => !i.skipped).slice(0, 3);
    for (const [k, item] of items.entries())
      expect(
        (await h.call(`/assessments/${s.data.id}/results`, skipBody(item, reasons[k]), cookie)).data,
      ).toEqual({
        saved: true,
      });
    expect(
      (await h.call(`/assessments/${s.data.id}/results`, skipBody(items[0], "pain_today"), cookie)).data,
    ).toEqual({ error: "RESULT_INVALID", field: "skippedReason" });
  });

  it("refuses a self count at the booth, where staff correct the count (O22)", async () => {
    process.env.AZM_BOOTH_CODE = CODE;
    process.env.AZM_BOOTH_DATES = "2026-10-04";
    const cookie = await member(h, "o22@example.test", intakeOf({ mobility: "standing" }));
    const s = await start(h, cookie, {}, { setting: "booth", boothCode: CODE });
    expect(s.status).toBe(200);
    const stand = itemOf(s.data.protocol, "chair_stand_30s", "none");
    const self = resultBody(stand, 11, {
      detail: { countSource: "self", hSit: 0.52, rise: 0.31, footwear: "shoes", armrests: false },
    });
    expect((await h.call(`/assessments/${s.data.id}/results`, self, cookie)).data).toEqual({
      error: "RESULT_INVALID",
      field: "detail.countSource",
    });
    const staff = resultBody(stand, 11, {
      detail: { countSource: "staff", hSit: 0.52, rise: 0.31, footwear: "shoes", armrests: false },
    });
    expect((await h.call(`/assessments/${s.data.id}/results`, staff, cookie)).data).toEqual({ saved: true });
  });

  it("keeps the ended reason free of the stop option (Q25 (d))", async () => {
    const cookie = await member(h, "ended@example.test", WHEELCHAIR_STROKE);
    const s = await start(h, cookie);
    await h.call(`/assessments/${s.data.id}/stop`, { option: "chest" }, cookie);
    const list = (await h.call("/assessments", undefined, cookie)).data.assessments;
    expect(list[0].endedReason).toBe("stop");
  });
});

describe("the next day question window (O38) and completedBefore", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("is due from 24 hours to 72 hours after a completed check, never before 06:00 in Riyadh", async () => {
    const cookie = await member(h, "o38@example.test", intakeOf());
    const s = await start(h, cookie);
    await postResults(h, cookie, s.data.id, s.data.protocol, CHAIR_VALUES);
    await h.call(`/assessments/${s.data.id}/complete`, {}, cookie);
    const due = async () => (await h.call("/assessments/context", undefined, cookie)).data.followUpDue;
    expect((await h.call("/assessments/context", undefined, cookie)).data.completedBefore).toBe(true);
    setTime(T0 + 24 * HOUR - 1);
    expect(await due()).toBe(false);
    setTime(T0 + 24 * HOUR);
    expect(await due()).toBe(true);
    // 2026-10-07 05:59 in Riyadh is inside 72 hours but before 06:00.
    setTime(Date.UTC(2026, 9, 7, 2, 59, 0));
    expect(await due()).toBe(false);
    setTime(T0 + 72 * HOUR);
    expect(await due()).toBe(true);
    setTime(T0 + 72 * HOUR + 1);
    expect(await due()).toBe(false);
  });
});

describe("ownership of the follow up routes", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("never answers or changes another person's check", async () => {
    const a = await member(h, "own-a@example.test", intakeOf());
    const b = await member(h, "own-b@example.test", intakeOf());
    const s = await start(h, a);
    const id = s.data.id;
    const calls: [string, unknown][] = [
      [`/assessments/${id}/end`, undefined],
      [`/assessments/${id}/answer`, { question: "end", answer: "yes" }],
      [`/assessments/${id}/answer`, { question: "faint", answer: "yes" }],
      [`/assessments/${id}/resume`, { answers: { pc_urgent: "yes" } }],
    ];
    for (const [path, body] of calls) {
      const r = await h.call(path, body, b);
      expect(r.status).toBe(404);
      expect(r.data).toEqual({ error: "NOT_FOUND" });
    }
    for (const [path, body] of calls) expect((await h.call(path, body)).status).toBe(401);
    // Nothing reached the owner's check, lock or the safety log.
    expect((await h.call("/assessments", undefined, a)).data.assessments[0].status).toBe("open");
    expect((await h.call("/assessments/context", undefined, b)).data.lock).toBeNull();
    expect(safety(h)).toEqual([]);
  });
});

describe("safety answers reach a check the server already closed (contract E, Q33 (2), (3), Q25 (a))", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  /** 2026-10-04 23:55 in Riyadh: the check runs over midnight. */
  const LATE = Date.UTC(2026, 9, 4, 20, 55, 0);

  it("a chest stop after a stale close sets the lock and changeReported, and leaves the check closed", async () => {
    setTime(LATE);
    const cookie = await member(h, "late-chest@example.test", intakeOf());
    const s = await start(h, cookie);
    const right = itemOf(s.data.protocol, "shoulder_abduction", "right");
    setTime(LATE + 8 * MIN);
    // A new Riyadh day: the queued result closes the check as stale and is refused.
    expect(
      (await h.call(`/assessments/${s.data.id}/results`, resultBody(right, 100), cookie)).data,
    ).toMatchObject({
      error: "NOT_OPEN",
    });
    setTime(LATE + 13 * MIN);
    const stop = await h.call(
      `/assessments/${s.data.id}/stop`,
      { option: "chest", testId: right.testId, side: right.side },
      cookie,
    );
    expect(stop.status).toBe(200);
    expect(stop.data).toMatchObject({ screen: "scr_emergency", endsCheck: true });
    expect(stop.data.lock).not.toBeNull();
    const c = await h.call("/assessments/context", undefined, cookie);
    expect(c.data.lock).not.toBeNull();
    expect(c.data.unresolvedChangeReported).toBe(true);
    const list = (await h.call("/assessments", undefined, cookie)).data.assessments;
    expect(list[0]).toMatchObject({ id: s.data.id, status: "ended_early", endedReason: "stop" });
    // It takes no result.
    expect((await h.call(`/assessments/${s.data.id}/results`, resultBody(right, 100), cookie)).status).toBe(
      409,
    );
  });

  it("a faint stop after a stale close is followed by the faint answer", async () => {
    setTime(LATE);
    const cookie = await member(h, "late-faint@example.test", intakeOf());
    const s = await start(h, cookie);
    const right = itemOf(s.data.protocol, "shoulder_abduction", "right");
    await h.call(`/assessments/${s.data.id}/results`, resultBody(right, 100), cookie);
    setTime(LATE + 40 * MIN);
    const left = itemOf(s.data.protocol, "shoulder_abduction", "left");
    const stop = await h.call(
      `/assessments/${s.data.id}/stop`,
      { option: "faint", testId: left.testId, side: left.side },
      cookie,
    );
    expect(stop.data).toMatchObject({ screen: "scr_faint", then: "sf_faint_loc" });
    const faint = await h.call(
      `/assessments/${s.data.id}/answer`,
      { question: "faint", answer: "yes" },
      cookie,
    );
    expect(faint.data).toMatchObject({ status: "emergency" });
    expect((await h.call("/assessments/context", undefined, cookie)).data.unresolvedChangeReported).toBe(
      true,
    );
  });

  it("much more pain after an idle close still ends with the day's lock", async () => {
    setTime(T0);
    const cookie = await member(h, "late-much@example.test", intakeOf());
    const s = await start(h, cookie);
    const right = itemOf(s.data.protocol, "shoulder_abduction", "right");
    await h.call(`/assessments/${s.data.id}/results`, resultBody(right, 100), cookie);
    setTime(T0 + 45 * MIN);
    const much = await h.call(
      `/assessments/${s.data.id}/between`,
      { testId: right.testId, side: right.side, answer: "much" },
      cookie,
    );
    expect(much.status).toBe(200);
    expect(much.data).toMatchObject({ status: "end" });
    expect(much.data.lock).not.toBeNull();
    expect((await h.call("/assessments/context", undefined, cookie)).data.lock).not.toBeNull();
    // An answer that does not end the check is refused on a closed check, as before.
    const same = await h.call(
      `/assessments/${s.data.id}/between`,
      { testId: right.testId, side: right.side, answer: "same" },
      cookie,
    );
    expect(same.data).toMatchObject({ error: "NOT_OPEN" });
  });

  it("an end yes on a check closed without any result stores changeReported and the lock", async () => {
    setTime(T0);
    const cookie = await member(h, "late-end@example.test", intakeOf());
    const s = await start(h, cookie);
    setTime(T0 + 31 * MIN);
    const end = await h.call(`/assessments/${s.data.id}/answer`, { question: "end", answer: "yes" }, cookie);
    expect(end.status).toBe(200);
    expect(end.data).toMatchObject({ status: "emergency" });
    const c = await h.call("/assessments/context", undefined, cookie);
    expect(c.data.lock).not.toBeNull();
    expect(c.data.unresolvedChangeReported).toBe(true);
  });

  it("refuses a safety post for a check closed more than a day ago", async () => {
    setTime(T0);
    const cookie = await member(h, "old-check@example.test", intakeOf());
    const s = await start(h, cookie);
    const right = itemOf(s.data.protocol, "shoulder_abduction", "right");
    await h.call(`/assessments/${s.data.id}/results`, resultBody(right, 100), cookie);
    setTime(T0 + 40 * MIN);
    // Closed as stale by a late post.
    expect((await h.call(`/assessments/${s.data.id}/complete`, {}, cookie)).data).toMatchObject({
      error: "NOT_OPEN",
    });
    setTime(T0 + DAY + MIN);
    expect((await h.call(`/assessments/${s.data.id}/stop`, { option: "chest" }, cookie)).data).toMatchObject({
      error: "NOT_OPEN",
    });
  });
});

describe("no URL path names a safety event (Q25 (a))", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("the end and faint answers share one path that every check with results calls", async () => {
    for (const r of moduleRoutes)
      expect(r.path.source, r.path.source).not.toMatch(/faint|alarm|fall|chest|emergency|help|symptom/);
    const cookie = await member(h, "one-path@example.test", intakeOf());
    const s = await start(h, cookie);
    const id = s.data.id;
    expect((await h.call(`/assessments/${id}/faint`, { answer: "yes" }, cookie)).status).toBe(404);
    expect((await h.call(`/assessments/${id}/alarm`, { kind: "no_response" }, cookie)).status).toBe(404);
    expect((await h.call(`/assessments/${id}/end`, { answer: "no" }, cookie)).status).toBe(405);
    // D-016: the alarm answer is gone.
    for (const body of [
      {},
      { question: "stop" },
      { question: 1 },
      { question: "alarm", kind: "no_response" },
    ])
      expect((await h.call(`/assessments/${id}/answer`, body, cookie)).data).toEqual({
        error: "ANSWER_INVALID",
        field: "question",
      });
  });
});
