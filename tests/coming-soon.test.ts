/**
 * D-040: the coming soon landing. With AZM_COMING_SOON=1 every API but the health check and the
 * waiting list answers COMING_SOON (no sign up, sign in, demo or coach), signed in or not; the waiting
 * list takes an email or a phone number once, rate limited, and says nothing about who is listed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../server/api";
import { normaliseContact } from "../server/modules/waitlist/store";

let origin = "";
let server: Server;
let service: ReturnType<typeof createApi>;
const DB = join(mkdtempSync(join(tmpdir(), "azm-coming-soon-")), "azm.sqlite");
const read = <T>(sql: string, ...args: string[]): T[] => {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    return db.prepare(sql).all(...args) as T[];
  } finally {
    db.close();
  }
};

async function call(path: string, body?: unknown, cookie = "", extra: Record<string, string> = {}) {
  const r = await fetch(origin + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin, "Content-Type": "application/json", "X-Azm-Request": "1", cookie, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json(), cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
const rows = () => read("SELECT contact, kind, platform, lang FROM waitlist ORDER BY rowid");

beforeAll(async () => {
  service = createApi(DB);
  server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  service.close();
});
afterEach(() => {
  delete process.env.AZM_COMING_SOON;
});

describe("the contact (normaliseContact)", () => {
  it("takes an email, lower case", () => {
    expect(normaliseContact("  Nasser@Example.COM ")).toEqual({
      contact: "nasser@example.com",
      kind: "email",
    });
    expect(normaliseContact("not an email@")).toBeNull();
  });
  it("takes a Saudi mobile in every usual form, Arabic digits too", () => {
    for (const v of [
      "0551234567",
      "551234567",
      "966551234567",
      "+966551234567",
      "00966551234567",
      "+966 55 123 4567",
      "٠٥٥١٢٣٤٥٦٧",
    ])
      expect(normaliseContact(v), v).toEqual({ contact: "+966551234567", kind: "phone" });
  });
  it("takes another country's number with its + or 00, refuses the rest", () => {
    expect(normaliseContact("+971501234567")).toEqual({ contact: "+971501234567", kind: "phone" });
    expect(normaliseContact("0044 7700 900123")).toEqual({ contact: "+447700900123", kind: "phone" });
    for (const v of ["12345", "0112345678", "+9661123", "+96611234567", "abc", "", 42, null])
      expect(normaliseContact(v), String(v)).toBeNull();
  });
});

describe("the waiting list (POST /api/waitlist)", () => {
  it("adds an email and a phone once each, with the platform and language, and answers the same for a repeat", async () => {
    expect(
      (await call("/waitlist", { contact: "a@example.test", platform: "ios", lang: "en" })).data,
    ).toEqual({ ok: true });
    expect((await call("/waitlist", { contact: "0551234567", platform: "android" })).status).toBe(200);
    expect((await call("/waitlist", { contact: "A@Example.test", platform: "both" })).data).toEqual({
      ok: true,
    });
    expect((await call("/waitlist", { contact: "+966 55 123 4567" })).status).toBe(200);
    expect(rows()).toEqual([
      { contact: "a@example.test", kind: "email", platform: "ios", lang: "en" },
      { contact: "+966551234567", kind: "phone", platform: "android", lang: "ar" },
    ]);
  });
  it("refuses a bad contact, platform, language or an unknown field", async () => {
    expect((await call("/waitlist", { contact: "hello" })).data).toEqual({
      error: "WAITLIST_CONTACT",
      field: "contact",
    });
    expect((await call("/waitlist", { contact: "b@example.test", platform: "windows" })).data.field).toBe(
      "platform",
    );
    expect((await call("/waitlist", { contact: "b@example.test", lang: "fr" })).data.field).toBe("lang");
    expect((await call("/waitlist", { contact: "b@example.test", name: "x" })).data.field).toBe("name");
  });
  it("needs the site's own origin and request header", async () => {
    const r = await fetch(origin + "/api/waitlist", {
      method: "POST",
      headers: { origin: "https://evil.example", "Content-Type": "application/json", "X-Azm-Request": "1" },
      body: JSON.stringify({ contact: "c@example.test" }),
    });
    expect(r.status).toBe(403);
  });
  it("limits one address to 10 sign ups in 15 minutes", async () => {
    const ip = { "x-forwarded-for": "203.0.113.9" };
    const codes: number[] = [];
    for (let i = 0; i < 11; i++)
      codes.push((await call("/waitlist", { contact: `n${i}@example.test` }, "", ip)).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe("coming soon (AZM_COMING_SOON=1)", () => {
  it("closes sign up, sign in, the demo, the coach and every signed in API, and keeps health and the waiting list", async () => {
    const reg = await call("/auth/register", {
      name: "Open Before",
      email: "open@example.test",
      password: "test-password-9281",
      adultConfirmed: true,
    });
    expect(reg.status).toBe(200);
    process.env.AZM_COMING_SOON = "1";
    for (const [path, body] of [
      [
        "/auth/register",
        { name: "Late", email: "late@example.test", password: "test-password-9281", adultConfirmed: true },
      ],
      ["/auth/login", { email: "open@example.test", password: "test-password-9281" }],
      ["/demo/start", {}],
      ["/agent/token", {}],
      ["/focus", {}],
    ] as const)
      expect(await call(path, body), path).toMatchObject({ status: 403, data: { error: "COMING_SOON" } });
    // Signed in before: still closed.
    expect(await call("/auth/me", undefined, reg.cookie)).toMatchObject({
      status: 403,
      data: { error: "COMING_SOON" },
    });
    expect(await call("/sessions", undefined, reg.cookie)).toMatchObject({ status: 403 });
    expect((await call("/health")).data).toMatchObject({ ok: true });
    expect(
      await call("/waitlist", { contact: "soon@example.test", platform: "both", lang: "ar" }),
    ).toMatchObject({
      status: 200,
      data: { ok: true },
    });
    // Nothing stored changed: the account is still there for when the apps open.
    expect(read("SELECT COUNT(*) AS n FROM users WHERE email=?", "open@example.test")).toEqual([{ n: 1 }]);
    delete process.env.AZM_COMING_SOON;
    expect((await call("/auth/me", undefined, reg.cookie)).status).toBe(200);
  });
});
