/**
 * Shared harness for the stream A server tests of v7 (tests/v7/a-*.test.ts): an API on a temporary
 * database file with the v1 module routes and the v7 routes behind their flag, the focus routes
 * built with the rules a test passes (product v7 contract 1.3: the real rules of steps A2 and A4 are
 * bound at Gate A), a fetch helper, members with a v7 intake, and a booth pass.
 */
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../../server/api";
import { v1ModuleRoutes, v7ModuleRoutes } from "../../server/modules";
import { focusRoutesWith } from "../../server/modules/focus/routes";
import type { FocusRules } from "../../server/modules/focus/precheck";
import type { Intake } from "../../src/medical/plan";
import { riyadhDate } from "../../src/medical/precheck";
import { boothWindow } from "../../server/modules/booth/config";
import { createPass } from "../../server/modules/booth/store";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
export type Db = InstanceType<typeof DatabaseSync>;

export const PASSWORD = "test-password-7731";
export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** 2026-10-04 09:00 in Riyadh (06:00 UTC), a Sunday. */
export const T0 = Date.UTC(2026, 9, 4, 6, 0, 0);
export const BOOTH_CODE = "booth-test-code";

export interface Reply {
  status: number;
  data: any;
  cookie: string;
}

export interface V7Harness {
  origin: string;
  file: string;
  call(
    path: string,
    body?: unknown,
    cookie?: string,
    method?: string,
    extra?: Record<string, string>,
  ): Promise<Reply>;
  /** A second connection to the API's database file (writes allowed, for seeding). */
  db(): Db;
  /** Stops the API and starts it again on the same file (a server restart). */
  restart(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The API with the v1 routes and the v7 routes (focus with `rules`). AZM_CHECK_HOME is removed, so a
 * home check is closed as in every deployed build (HOME_CHECKS_READY is false, C-14).
 */
export async function startV7Api(rules: FocusRules | null): Promise<V7Harness> {
  delete process.env.AZM_CHECK_HOME;
  const dir = mkdtempSync(join(tmpdir(), "azm-v7-api-"));
  const file = join(dir, "azm.sqlite");
  const routes = () => [...v1ModuleRoutes, ...v7ModuleRoutes(focusRoutesWith(rules))];
  let service = createApi(file, routes());
  let server: Server = createServer((req, res) => void service.handle(req, res));
  const listen = async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  };
  let origin = await listen();
  const opened: Db[] = [];
  return {
    get origin() {
      return origin;
    },
    file,
    async call(path, body, cookie = "", method = body === undefined ? "GET" : "POST", extra = {}) {
      const r = await fetch(origin + "/api" + path, {
        method,
        headers: { origin, "Content-Type": "application/json", "X-Azm-Request": "1", cookie, ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      return {
        status: r.status,
        data: text ? JSON.parse(text) : null,
        cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
      };
    },
    db() {
      const db = new DatabaseSync(file, { timeout: 2000 });
      opened.push(db);
      return db;
    },
    async restart() {
      await new Promise<void>((r) => server.close(() => r()));
      service.close();
      service = createApi(file, routes());
      server = createServer((req, res) => void service.handle(req, res));
      origin = await listen();
    },
    async close() {
      for (const db of opened) if (db.isOpen) db.close();
      await new Promise<void>((r) => server.close(() => r()));
      service.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function register(h: V7Harness, email: string, name = "Focus Member"): Promise<string> {
  const r = await h.call("/auth/register", { name, email, password: PASSWORD, adultConfirmed: true });
  if (r.status !== 200) throw new Error(`register ${email}: ${r.status}`);
  return r.cookie;
}

/** A v1 intake (no v7 fields). */
export function v1Intake(over: Partial<Intake> = {}): Intake {
  return {
    age: 58,
    conditions: ["stroke"],
    diagnosisNotes: "",
    medications: "",
    mobility: "standing",
    support: "right",
    pain: [],
    restrictions: [],
    symptoms: "no",
    recentChange: "no",
    clearance: "yes",
    equipment: ["chair"],
    goal: "habit",
    days: [0, 2, 4],
    time: "09:00",
    sessionMinutes: 30,
    consent: true,
    ...over,
  };
}

/** The showcase persona's shape: weaker right side after a stroke, walks without an aid (D-020). */
export function v7Intake(over: Partial<Intake> = {}): Intake {
  return v1Intake({
    sex: "male",
    regions: [
      { region: "knee", side: "right", problems: ["weakness"], origin: "condition" },
      { region: "shoulder", side: "right", problems: ["weakness"], origin: "condition" },
    ],
    walking: { status: "without_aid" },
    ...over,
  });
}

/**
 * A member with this intake saved and a program; `consents` are accepted (the flag must be on for the
 * v7 kinds). Since D-032 item 3 a first profile saved with AZM_V7=1 waits for the movement check: the
 * member's program is then the history's (POST /api/program/history, as for someone who cannot use a
 * camera), so its workouts start. newcomer() keeps the wait.
 */
export async function member(
  h: V7Harness,
  email: string,
  intake: Intake,
  consents: string[] = [],
): Promise<string> {
  const cookie = await newcomer(h, email, intake, consents);
  if (process.env.AZM_V7 === "1") await h.call("/program/history", {}, cookie);
  return cookie;
}

/** A member with this intake saved who, with AZM_V7=1, still waits for the movement check (D-032 item 3). */
export async function newcomer(
  h: V7Harness,
  email: string,
  intake: Intake,
  consents: string[] = [],
): Promise<string> {
  const cookie = await register(h, email);
  const saved = await h.call("/intake", intake, cookie, "PUT");
  if (saved.status !== 200) throw new Error(`intake ${email}: ${saved.status} ${JSON.stringify(saved.data)}`);
  for (const kind of consents) {
    const ok = await h.call("/consents", { kind, version: 1 }, cookie);
    if (ok.status !== 200) throw new Error(`consent ${kind}: ${ok.status} ${JSON.stringify(ok.data)}`);
  }
  return cookie;
}

/** The user id behind a session cookie. */
export async function userId(h: V7Harness, cookie: string): Promise<string> {
  const me = await h.call("/auth/me", undefined, cookie);
  return me.data.user.id as string;
}

/**
 * A staff booth pass for today (O17), sent as X-Azm-Booth: the booth days include today in Riyadh,
 * the staff code is set, and the pass is the one POST /api/booth/verify stores (createPass, until the
 * booth closes). Made in the store, so the verify route's rate limits stay out of the way.
 */
export async function boothPass(h: V7Harness, now: number): Promise<string> {
  process.env.AZM_BOOTH_DATES = riyadhDate(now);
  process.env.AZM_BOOTH_CODE = BOOTH_CODE;
  const window = boothWindow(now);
  if (!window.open) throw new Error("the booth is closed at this time");
  return createPass(h.db(), window.closes, now);
}

/** The booth verify route gives a pass of the same form (checked once). */
export async function verifiedBoothPass(h: V7Harness, now: number): Promise<string> {
  process.env.AZM_BOOTH_DATES = riyadhDate(now);
  process.env.AZM_BOOTH_CODE = BOOTH_CODE;
  const r = await h.call("/booth/verify", { code: BOOTH_CODE });
  if (r.status !== 200 || !r.data.ok) throw new Error(`booth verify: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.session as string;
}
