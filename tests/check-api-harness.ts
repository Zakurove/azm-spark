/**
 * Shared harness for the movement check API tests (tests/assessments-api.test.ts and
 * tests/progress-api.test.ts): an API on a temporary database file (so a second connection can
 * inspect what was stored), a fetch helper in the style of tests/account-api.test.ts, intakes for
 * the personas, pre-check answers built from GET /api/assessments/context, and valid result bodies.
 */
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../server/api";
import type { Intake } from "../src/medical/plan";
import {
  baseSelection,
  baseTests,
  type CheckContext,
  type ProtocolItem,
  type StoredSetup,
} from "../src/medical/assessment";
import type { Answers, PrecheckEnv } from "../src/medical/precheck";
import { testDef } from "../src/movements/assessments";
import type { Setting } from "../src/movements/types";
import { fill } from "./precheck-fixtures";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
export type Db = InstanceType<typeof DatabaseSync>;

export const PASSWORD = "test-password-5531";
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
/** 2026-10-04 09:00 in Riyadh (06:00 UTC), a Sunday. */
export const T0 = Date.UTC(2026, 9, 4, 6, 0, 0);
export const DEVICE = { model: "full", aspect: 0.5625, fps: 28, engineVersion: "e1.0", appVersion: "6.0.0" };

export interface Reply {
  status: number;
  data: any;
  cookie: string;
}

export interface Harness {
  origin: string;
  file: string;
  call(
    path: string,
    body?: unknown,
    cookie?: string,
    method?: string,
    extra?: Record<string, string>,
  ): Promise<Reply>;
  /** A second read connection to the API's database file. */
  inspect(): Db;
  close(): Promise<void>;
}

export async function startApi(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "azm-check-api-"));
  const file = join(dir, "azm.sqlite");
  const service = createApi(file);
  const server: Server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const inspectors: Db[] = [];
  return {
    origin,
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
    inspect() {
      const db = new DatabaseSync(file, { readOnly: true });
      inspectors.push(db);
      return db;
    },
    async close() {
      for (const db of inspectors) if (db.isOpen) db.close();
      await new Promise<void>((r) => server.close(() => r()));
      service.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function register(h: Harness, email: string, name = "Check Member"): Promise<string> {
  const r = await h.call("/auth/register", { name, email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`register ${email}: ${r.status}`);
  return r.cookie;
}

export async function login(h: Harness, email: string): Promise<string> {
  const r = await h.call("/auth/login", { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`);
  return r.cookie;
}

export function intakeOf(over: Partial<Intake> = {}): Intake {
  return {
    age: 45,
    conditions: ["none"],
    diagnosisNotes: "",
    medications: "",
    mobility: "seated",
    support: "none",
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

/** Faisal of the pre-check personas, with the weaker side on the left: stroke, wheelchair, cleared. */
export const WHEELCHAIR_STROKE = intakeOf({
  age: 58,
  conditions: ["stroke"],
  mobility: "wheelchair",
  support: "left",
  clearance: "yes",
});

/** A new member with intake saved and the movement check consent accepted. */
export async function member(h: Harness, email: string, intake: Intake, consent = true): Promise<string> {
  const cookie = await register(h, email);
  const saved = await h.call("/intake", intake, cookie, "PUT");
  if (saved.status !== 200) throw new Error(`intake ${email}: ${saved.status}`);
  if (consent) {
    const ok = await h.call("/consents", { kind: "movement_check", version: 1 }, cookie);
    if (ok.status !== 200) throw new Error(`consent ${email}: ${ok.status}`);
  }
  return cookie;
}

/** The pre-check environment the client builds from GET /api/assessments/context. */
export function envFromContext(c: any, setting: Setting = "home"): PrecheckEnv {
  const ctx = c.ctx as CheckContext;
  const setup = (c.setup ?? null) as StoredSetup | null;
  return {
    setting,
    ctx,
    setup,
    firstCheck: c.firstCheck,
    unresolvedChangeReported: c.unresolvedChangeReported,
    lastCheckLasting: c.lastCheckLasting,
    baseTests: c.setting === setting ? c.baseTests : baseTests(baseSelection(ctx, setting, setup)),
    sideLeanDoneAtHome: c.sideLeanDoneAtHome,
    neededArmsLastStand: c.neededArmsLastStand,
    completedBefore: c.completedBefore,
  };
}

/** Every visible question answered: `given` first, the benign answer for the rest. */
export async function answersFor(
  h: Harness,
  cookie: string,
  given: Answers = {},
  setting: Setting = "home",
): Promise<Answers> {
  const c = await h.call(
    `/assessments/context${setting === "booth" ? "?setting=booth" : ""}`,
    undefined,
    cookie,
  );
  if (c.status !== 200 || !c.data.ctx) throw new Error(`context: ${c.status} ${JSON.stringify(c.data)}`);
  return fill(envFromContext(c.data, setting), given);
}

export async function start(
  h: Harness,
  cookie: string,
  given: Answers = {},
  extra: Record<string, unknown> = {},
): Promise<Reply> {
  const setting = (extra.setting as Setting | undefined) ?? "home";
  const answers = await answersFor(h, cookie, given, setting);
  return h.call("/assessments", { answers, device: DEVICE, ...extra }, cookie);
}

export const QUALITY = {
  ok: true,
  frames: 240,
  visibleShare: 0.97,
  windowVisibleShare: null,
  optionalVisibleShare: { "13": 0.92, "14": 0.88 },
  view: "front",
  viewRatio: 0.41,
  viewOk: true,
  inFrameShare: 1,
  fps: 28,
  pausedShare: 0,
  touched: false,
  distance: 0.34,
  distanceM: 2.4,
  issues: [],
  missing: [],
  cue: null,
};

/**
 * A valid result for a protocol item. Range tests: three valid attempts with `value` the best and
 * the median 2 below it. Timed tests: one trial. The detail fits the test; `over` replaces fields.
 */
export function resultBody(item: ProtocolItem, value: number, over: Record<string, unknown> = {}) {
  const def = testDef(item.testId);
  const range = def.attempts > 1;
  const attempts = range
    ? [
        { value: Math.max(0, value - 4), valid: true, durationSec: 6 },
        { value, valid: true, durationSec: 6 },
        { value: Math.max(0, value - 2), valid: true, durationSec: 6 },
      ]
    : [{ value, valid: true, durationSec: 30 }];
  const detail: Record<string, unknown> =
    item.testId === "shoulder_abduction"
      ? { reference: "trunk", trunkLeanAtPeak: 3 }
      : item.testId === "trunk_control_seated"
        ? { armMode: "crossed", armrests: true, pivot: "hip", sameChair: true, returnSec: 1.4 }
        : item.testId === "arm_curl_30s"
          ? item.variant === "arm_only"
            ? {
                loadObject: "none",
                rangeLo: 160,
                rangeHi: 50,
                compensated: 0,
                countSource: "auto",
                view: "side",
              }
            : {
                loadObject: "bottle",
                loadL: 1,
                rangeLo: 158,
                rangeHi: 48,
                compensated: 0,
                countSource: "auto",
                view: "side",
              }
          : {
              countSource: "auto",
              hSit: 0.52,
              rise: 0.31,
              footwear: "shoes",
              sameChair: true,
              armrests: false,
            };
  const variant =
    item.testId === "arm_curl_30s"
      ? item.variant === "arm_only"
        ? "arm_only"
        : "held"
      : item.testId === "chair_stand_30s"
        ? (item.variant ?? "standard")
        : null;
  return {
    testId: item.testId,
    side: item.side,
    value,
    unit: def.unit,
    attempts,
    quality: QUALITY,
    detail,
    flags: [],
    nValid: attempts.length,
    median: range ? Math.max(0, value - 2) : null,
    variant,
    poseModel: "full",
    movementVersion: item.version,
    engineVersion: "e1.0",
    ...over,
  };
}

/** Posts a result for each runnable protocol item, with the value from `values` (by test and side). */
export async function postResults(
  h: Harness,
  cookie: string,
  id: string,
  protocol: ProtocolItem[],
  values: Record<string, number>,
): Promise<void> {
  for (const item of protocol) {
    if (item.skipped) continue;
    const v = values[`${item.testId}:${item.side}`];
    if (v === undefined) continue;
    const r = await h.call(`/assessments/${id}/results`, resultBody(item, v), cookie);
    if (r.status !== 200)
      throw new Error(`result ${item.testId}:${item.side}: ${r.status} ${JSON.stringify(r.data)}`);
  }
}

export function itemOf(protocol: ProtocolItem[], testId: string, side: string): ProtocolItem {
  const item = protocol.find((i) => i.testId === testId && i.side === side);
  if (!item) throw new Error(`no ${testId}:${side} in the protocol`);
  return item;
}
