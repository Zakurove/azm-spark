/**
 * D-032 item 3 (the tests come before the program), on the server: a first profile saved with
 * AZM_V7=1 awaits the movement check (check_first, migration 006). While it waits, /api/auth/me says
 * so and no workout starts (409 AWAITING_CHECK); people with a program before keep it (no row); the
 * wait ends when the check's week is built (POST /api/program/targets) or the history builds the
 * program (POST /api/program/history), and a completed check always ends it. With the flag off the
 * server answers as before, without the field.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { FOCUS_RULES } from "../../server/modules/focus/precheck";
import { clearAwaiting, isAwaiting, markAwaiting, programFrom } from "../../server/modules/program/awaiting";
import { migrations } from "../../server/db/migrations";
import { runMigrations } from "../../server/db/migrate";
import { boothPass, newcomer, register, startV7Api, userId, v7Intake, type V7Harness } from "./a-harness";
import { romBody } from "./a-focus-bodies";
import type { RomProtocol } from "../../src/medical/rom-protocol";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

let h: V7Harness;
let n = 0;
beforeAll(async () => {
  h = await startV7Api(FOCUS_RULES);
});
afterAll(async () => {
  await h.close();
});
beforeEach(() => {
  process.env.AZM_V7 = "1";
});
afterEach(() => {
  for (const k of ["AZM_V7", "AZM_BOOTH_DATES", "AZM_BOOTH_CODE"]) delete process.env[k];
});

const email = () => `first${++n}@example.test`;
const workout = async (cookie: string) => {
  const me = await h.call("/auth/me", undefined, cookie);
  return h.call(
    "/workouts",
    { version: me.data.plan.version, demo: false, guided: true, weekday: 1 },
    cookie,
  );
};

describe("migration 006 (check_first)", () => {
  it("is registered as version 6 and adds one table, leaving every earlier definition as it was", () => {
    const m = migrations[5];
    expect(m).toMatchObject({ version: 6, name: "check_first" });
    expect(m.sql).not.toMatch(/\b(ALTER|DROP)\s+TABLE|\bUPDATE\s+\w+\s+SET|\bDELETE\s+FROM|\bINSERT\s+INTO/i);
    expect(m.sql.match(/CREATE TABLE (\w+)/g)).toEqual(["CREATE TABLE check_first"]);
    const five = new DatabaseSync(":memory:");
    runMigrations(five, { dbPath: ":memory:", migrations: migrations.filter((x) => x.version <= 5) });
    const before = five.prepare("SELECT name, tbl_name, sql FROM sqlite_master ORDER BY name").all();
    expect(
      runMigrations(five, { dbPath: ":memory:", migrations: migrations.filter((x) => x.version <= 6) })
        .applied,
    ).toEqual([6]);
    const after = five.prepare("SELECT name, tbl_name, sql FROM sqlite_master ORDER BY name").all() as {
      tbl_name: string;
    }[];
    expect(after.filter((x) => x.tbl_name !== "check_first")).toEqual(before);
    five.close();
  });
});

describe("a first profile saved with AZM_V7=1 awaits the check (D-032 item 3)", () => {
  it("says so on save and on /api/auth/me, and starts no workout", async () => {
    const cookie = await register(h, email());
    const saved = await h.call("/intake", v7Intake(), cookie, "PUT");
    expect(saved.status).toBe(200);
    expect(saved.data.awaitingCheck).toBe(true);
    expect((await h.call("/auth/me", undefined, cookie)).data.awaitingCheck).toBe(true);
    expect((await workout(cookie)).data).toEqual({ error: "AWAITING_CHECK" });
    // An edit of the intake keeps the wait (it is not a new profile).
    const edited = await h.call("/intake", v7Intake({ age: 60 }), cookie, "PUT");
    expect(edited.data.awaitingCheck).toBe(true);
  });

  it("keeps the program of a person whose profile was saved before: no wait", async () => {
    delete process.env.AZM_V7;
    const cookie = await register(h, email());
    const saved = await h.call("/intake", v7Intake(), cookie, "PUT");
    // With the flag off the server answers as before, without the field.
    expect(saved.data).not.toHaveProperty("awaitingCheck");
    expect((await h.call("/auth/me", undefined, cookie)).data).not.toHaveProperty("awaitingCheck");
    process.env.AZM_V7 = "1";
    expect((await h.call("/auth/me", undefined, cookie)).data.awaitingCheck).toBe(false);
    expect((await h.call("/intake", v7Intake({ age: 61 }), cookie, "PUT")).data.awaitingCheck).toBe(false);
    expect((await workout(cookie)).status).toBe(200);
  });

  it("ends from the history when nothing can be measured or there is no camera (POST /api/program/history)", async () => {
    const cookie = await newcomer(h, email(), v7Intake());
    expect((await h.call("/program/history", { why: "x" }, cookie)).data).toEqual({
      error: "HISTORY_INVALID",
      field: "why",
    });
    const r = await h.call("/program/history", {}, cookie);
    expect(r.data).toEqual({ ok: true, from: "history" });
    expect((await h.call("/auth/me", undefined, cookie)).data.awaitingCheck).toBe(false);
    expect((await workout(cookie)).status).toBe(200);
    // Once ended it stays ended; the route is a v7 route.
    expect((await h.call("/program/history", {}, cookie)).data).toEqual({ ok: true, from: "history" });
    delete process.env.AZM_V7;
    expect((await h.call("/program/history", {}, cookie)).status).toBe(404);
  });

  it("needs a ready plan to build from the history", async () => {
    const none = await register(h, email());
    expect((await h.call("/program/history", {}, none)).data).toEqual({ error: "PLAN_REQUIRED" });
    const review = await newcomer(h, email(), v7Intake({ conditions: ["cardiac"] }));
    expect((await h.call("/program/history", {}, review)).data).toEqual({ error: "PLAN_REQUIRED" });
  });

  it("ends with the check: a completed check at once, and the targeted week clears it as the check's", async () => {
    const pass = await boothPass(h, Date.now());
    const cookie = await newcomer(h, email(), v7Intake(), ["focus_check"]);
    const id = await userId(h, cookie);
    const booth = { "x-azm-booth": pass };
    const start = await h.call(
      "/focus",
      {
        setting: "booth",
        today: { painByRegion: {}, redFlagRegions: [], worrying: false, unsteady: false, walk10m: true },
        device: { os: "iOS", browser: "Safari" },
        include: { rom: true, gait: false },
      },
      cookie,
      "POST",
      booth,
    );
    expect(start.status, JSON.stringify(start.data)).toBe(200);
    // A check that started is not yet a program.
    expect((await h.call("/auth/me", undefined, cookie)).data.awaitingCheck).toBe(true);
    const item = (start.data.protocol as RomProtocol).items.find((i) => !i.skipped)!;
    expect((await h.call(`/focus/${start.data.id}/rom`, romBody(item, 100), cookie)).status).toBe(200);
    expect((await h.call(`/focus/${start.data.id}/complete`, {}, cookie)).status).toBe(200);
    expect((await h.call("/auth/me", undefined, cookie)).data.awaitingCheck).toBe(false);
    expect(programFrom(h.db(), id)).toBeNull();
    const week = await h.call("/program/targets", {}, cookie);
    expect(week.status).toBe(200);
    expect(programFrom(h.db(), id)).toBe("check");
    expect((await workout(cookie)).status).toBe(200);
  });
});

describe("the store (server/modules/program/awaiting.ts)", () => {
  it("marks once, clears once, and a person without a row never waits", () => {
    const db = h.db();
    const user = "u-awaiting";
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(user, "awaiting@example.test", "A", "x:y", 1);
    expect(isAwaiting(db, user)).toBe(false);
    markAwaiting(db, user, 10);
    markAwaiting(db, user, 20);
    expect(isAwaiting(db, user)).toBe(true);
    expect(clearAwaiting(db, user, "history", 30)).toBe(true);
    expect(clearAwaiting(db, user, "check", 40)).toBe(false);
    expect(programFrom(db, user)).toBe("history");
    expect(
      db.prepare("SELECT since, cleared, cleared_by FROM check_first WHERE user_id=?").get(user),
    ).toEqual({
      since: 10,
      cleared: 30,
      cleared_by: "history",
    });
  });
});
