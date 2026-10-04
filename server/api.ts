import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { randomBytes, randomUUID, createHash, scrypt as derive, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createPlan, validateIntake, Plan, Prescription } from "../src/medical/plan";
import { extractReport, validReportBody } from "./report";
import { createWeekly } from "./weekly-ai";
import { cardRecord, runSteps, startDay, type RunPlan } from "./guided";
import { BUSY_TIMEOUT_MS, runMigrations } from "./db/migrate";
import { moduleRoutes } from "./modules";
import type { Route } from "./http/types";
import { confirmAdult } from "./modules/account/store";
import { acceptConsent } from "./modules/consents/store";
import { v7Enabled } from "./modules/focus/routes";
import { pruneAgentSessions } from "./modules/focus/store";
import { afterIntakeSaved } from "./modules/program/hooks";
const scrypt = promisify(derive);
const digest = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * The client address the rate limits key on. X-Forwarded-For is written left to right: a client may
 * put any entries first, and each proxy appends the address it saw. So the address is the entry the
 * outermost trusted proxy appended, counted from the right: AZM_TRUSTED_PROXIES hops (default 1, the
 * Railway edge). With 0, or without the header, the socket address.
 */
export function clientAddress(
  forwarded: string | string[] | undefined,
  socket: string | undefined,
  hops = trustedProxies(),
): string {
  const header = Array.isArray(forwarded) ? forwarded.join(",") : (forwarded ?? "");
  const entries = header
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  if (hops <= 0 || entries.length === 0) return socket ?? "";
  return entries[Math.max(0, entries.length - hops)];
}

function trustedProxies(): number {
  const raw = process.env.AZM_TRUSTED_PROXIES;
  const n = raw === undefined || raw.trim() === "" ? 1 : Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 1;
}

/** The rate limit keys kept in memory at most; the oldest go first once it is full. */
const RATE_KEYS_MAX = 100_000;
export function createApi(
  path = process.env.AZM_DATABASE ?? ".data/azm.sqlite",
  routes: readonly Route[] = moduleRoutes,
) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  if (path !== ":memory:") chmodSync(path, 0o600);
  // Schema lives in server/db/migrations; an existing database is backed up before it changes.
  let migrated: ReturnType<typeof runMigrations>;
  try {
    migrated = runMigrations(db, { dbPath: path });
  } catch (error) {
    db.close();
    throw error;
  }
  if (migrated.applied.length)
    console.log(
      `Azm database migrated to schema ${migrated.schema}${migrated.backup ? ", backup written before migrating" : ""}`,
    );
  // v7 retention (product v7 contract section 3): coach session rows are kept 90 days.
  pruneAgentSessions(db, Date.now());
  const rates = new Map<string, { n: number; until: number }>();
  let swept = 0;
  function limited(key: string, max = 12, windowMs = 900000) {
    const now = Date.now();
    // Ended windows are removed once a second (not on every call), and the map never grows past
    // RATE_KEYS_MAX: the oldest keys go first.
    if (now < swept || now - swept >= 1000 || rates.size >= RATE_KEYS_MAX) {
      for (const [k, v] of rates) if (v.until < now) rates.delete(k);
      swept = now;
    }
    let v = rates.get(key);
    if (!v || v.until < now) {
      v = { n: 0, until: now + windowMs };
      rates.delete(key);
      while (rates.size >= RATE_KEYS_MAX) rates.delete(rates.keys().next().value as string);
    }
    v.n++;
    rates.set(key, v);
    return v.n > max;
  }
  const userView = (u: any) => ({ id: u.id, name: u.name, email: u.email, role: "member" });
  const profile = (id: string) => {
    const p = db.prepare("SELECT * FROM profiles WHERE user_id=?").get(id) as any;
    if (!p) return { intake: null, plan: null };
    const intake = JSON.parse(p.intake),
      plan = JSON.parse(p.plan) as Plan;
    // Booth v2 (B6): a stable chair is assumed. A plan the old chair rule left in review (every
    // movement out for want of a chair tick) is planned again once, under a new version; the answers
    // stay as they were. Such a plan was never ready, so no workout is pinned to it.
    // Booth v2 (D): a plan reviewed only because no camera movement fitted is guided cards now; it
    // is planned again once, when that makes it ready.
    const noCamera =
      plan.status === "review" &&
      plan.reasons?.length === 1 &&
      plan.reasons[0] === "no_exercises" &&
      validateIntake(intake) &&
      createPlan(intake).status === "ready";
    if ((plan.exclusions?.some((e) => e.reason === "chair") || noCamera) && validateIntake(intake)) {
      const fresh = { ...createPlan(intake), created: plan.created ?? Date.now() };
      const version = p.version + 1;
      db.prepare("UPDATE profiles SET plan=?, version=? WHERE user_id=? AND version=?").run(
        JSON.stringify(fresh),
        version,
        id,
        p.version,
      );
      return { intake, plan: { ...fresh, version } };
    }
    return { intake, plan: { ...plan, version: p.version } };
  };
  async function handle(req: IncomingMessage, res: ServerResponse, next?: () => void) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const route = url.pathname;
    if (!route.startsWith("/api/")) return next?.();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const mutation = !["GET", "HEAD"].includes(req.method ?? "GET");
    if (mutation) {
      const allowed = (process.env.AZM_ORIGIN ?? `http://${req.headers.host}`)
        .split(",")
        .map((x) => x.trim());
      if (!allowed.includes(req.headers.origin as string) || req.headers["x-azm-request"] !== "1")
        return json(403, { error: "ORIGIN" });
    }
    let body: any = {};
    try {
      // Session and client identity resolve from headers only, BEFORE any body is buffered:
      // the large report body cap is granted exclusively to authenticated, rate-limited callers.
      const raw =
        req.headers.cookie
          ?.split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("azm_session="))
          ?.slice(12) ?? "";
      const token = digest(raw);
      const u = db
        .prepare(
          "SELECT users.* FROM sessions JOIN users ON sessions.user_id=users.id WHERE sessions.token=? AND sessions.expires>?",
        )
        .get(token, Date.now()) as any;
      const ip = clientAddress(req.headers["x-forwarded-for"], req.socket.remoteAddress);
      if (mutation) {
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return json(415, { error: "JSON_REQUIRED" });
        let maxBody = 65536;
        if (route === "/api/medical-report") {
          if (!u) return json(401, { error: "AUTH_REQUIRED" });
          if (limited(`report:${u.id}`, 8) || limited(`report-ip:${ip}`, 20))
            return json(429, { error: "RATE_LIMIT" });
          maxBody = 6 * 1024 * 1024;
        }
        // A module route that takes a larger body decides from the headers alone (booth v2: the booth
        // report photo, for a valid booth pass only), before anything is buffered.
        const gate = routes.find((r) => r.method === req.method && r.bodyLimit && route.match(r.path));
        if (gate?.bodyLimit) {
          const cap = gate.bodyLimit({ req, db, ip: ip ?? "", limited });
          if (typeof cap !== "number") return json(cap.status, { error: cap.error });
          maxBody = cap;
        }
        let size = 0;
        const parts: Buffer[] = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > maxBody) {
            // The rest of the body stays unread: the answer closes the connection, so a client that
            // keeps connections alive never sends its next request into this one (A5-11).
            res.setHeader("Connection", "close");
            return json(413, { error: "TOO_LARGE" });
          }
          parts.push(Buffer.from(chunk));
        }
        body = JSON.parse(Buffer.concat(parts).toString() || "{}");
        if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { error: "INVALID" });
      }
      // Module routes (server/modules) come before the legacy chain and its AUTH_REQUIRED gate.
      const candidates = routes.filter((r) => route.match(r.path));
      if (candidates.length) {
        // HEAD is answered by the GET route; Node sends the headers and drops the body.
        const method = req.method === "HEAD" ? "GET" : req.method;
        const r = candidates.find((c) => c.method === method);
        if (!r) return json(405, { error: "METHOD" });
        if (r.auth === "user" && !u) return json(401, { error: "AUTH_REQUIRED" });
        const params = { ...route.match(r.path)?.groups } as Record<string, string>;
        await r.handle({ req, res, db, user: u ?? null, body, params, ip: ip ?? "", json, limited });
        if (!res.headersSent) json(500, { error: "SERVER" });
        return;
      }
      const cookie = (value: string, age: number) =>
        res.setHeader(
          "Set-Cookie",
          `azm_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        );
      if (route === "/api/auth/register" || route === "/api/auth/login") {
        if (req.method !== "POST") return json(405, { error: "METHOD" });
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = body.password;
        if (limited(`ip:${ip}`, 30) || limited(`email:${email}`)) return json(429, { error: "RATE_LIMIT" });
        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          email.length > 254 ||
          typeof password !== "string" ||
          password.length < 10 ||
          password.length > 128
        )
          return json(400, { error: "CREDENTIAL_FORMAT" });
        let account: any;
        if (route.endsWith("register")) {
          if (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 80)
            return json(400, { error: "NAME" });
          // Q2 (5), Q32 (6): accounts are for adults 18 or older only; the confirmation is given at
          // account creation (boundary.adultConfirm.when) and stored with the account.
          if (body.adultConfirmed !== true) return json(400, { error: "ADULT_REQUIRED" });
          if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
            return json(409, { error: "ACCOUNT_EXISTS" });
          const salt = randomBytes(16).toString("hex");
          const hash = (await scrypt(password, salt, 64)) as Buffer;
          const id = randomUUID();
          db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
            id,
            email,
            body.name.trim(),
            `${salt}:${hash.toString("hex")}`,
            Date.now(),
          );
          confirmAdult(db, id, Date.now());
          account = db.prepare("SELECT * FROM users WHERE id=?").get(id);
        } else {
          account = db.prepare("SELECT * FROM users WHERE email=?").get(email) as any;
          const [salt, hash] = (account?.password ?? `${"0".repeat(32)}:${"0".repeat(128)}`).split(":");
          const supplied = (await scrypt(password, salt, 64)) as Buffer;
          if (!account || !timingSafeEqual(supplied, Buffer.from(hash, "hex")))
            return json(401, { error: "CREDENTIALS" });
        }
        db.prepare("DELETE FROM sessions WHERE token=? OR expires<?").run(token, Date.now());
        const fresh = randomBytes(32).toString("hex");
        db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
          digest(fresh),
          account.id,
          Date.now() + 86400000 * 7,
        );
        cookie(fresh, 604800);
        return json(200, { user: userView(account), ...profile(account.id) });
      }
      if (!u) return json(401, { error: "AUTH_REQUIRED" });
      if (route === "/api/auth/me" && req.method === "GET")
        return json(200, { user: userView(u), ...profile(u.id) });
      if (route === "/api/auth/logout" && req.method === "POST") {
        db.prepare("DELETE FROM sessions WHERE token=?").run(token);
        cookie("", 0);
        return json(200, { ok: true });
      }
      if (route === "/api/medical-report" && req.method === "POST") {
        // Q32 (2): report reading sends health data to a model outside the Kingdom, so it needs its
        // own explicit consent, sent with every report. Since booth v2 (B8, option A) the press on
        // «اقرأ تقريري» is that consent; the /privacy page names the processor. Without it nothing is
        // sent anywhere. The acceptance is kept with its time, like every consent.
        if (body.reportConsent !== true) return json(403, { error: "CONSENT_REQUIRED" });
        const { reportConsent: _consent, ...report } = body;
        void _consent;
        if (!validReportBody(report)) return json(400, { error: "REPORT_INVALID" });
        acceptConsent(db, u.id, "report_reading", Date.now());
        const key = process.env.OPENAI_API_KEY;
        if (!key) return json(503, { error: "EXTRACTION_UNAVAILABLE" });
        try {
          // v7 (contract section 4): the reading suggests body map regions only with AZM_V7=1.
          return json(200, await extractReport(report, key, { regions: process.env.AZM_V7 === "1" }));
        } catch (err) {
          console.error("AZM report extraction failed", err instanceof Error ? err.message : "Error");
          return json(502, { error: "ENGINE_FAILED" });
        }
      }
      if (route === "/api/plan/weekly" && req.method === "POST") {
        const p = profile(u.id);
        if (!p.intake || !p.plan || p.plan.status !== "ready") return json(409, { error: "PLAN_REQUIRED" });
        // v7 (product v7 contract 2.10): a targeted weekly (one with findings) is returned unchanged,
        // also with refresh: true; the Program page refreshes it through POST /api/program/targets.
        if (p.plan.weekly && (body.refresh !== true || p.plan.weekly.findings))
          return json(200, { weekly: p.plan.weekly, version: p.plan.version });
        if (limited(`weekly:${u.id}`, 6)) return json(429, { error: "RATE_LIMIT" });
        const weekly = await createWeekly(p.intake, p.plan, process.env.OPENAI_API_KEY);
        if (!weekly) return json(409, { error: "PLAN_REQUIRED" });
        const { version, ...stored } = p.plan;
        // Version-pinned: a profile edited while the plan was being written keeps its newer plan.
        db.prepare("UPDATE profiles SET plan=? WHERE user_id=? AND version=?").run(
          JSON.stringify({ ...stored, weekly }),
          u.id,
          version,
        );
        return json(200, { weekly, version });
      }
      if (route === "/api/intake" && req.method === "PUT") {
        if (!validateIntake(body)) return json(400, { error: "INTAKE_INVALID" });
        // C46: the plan keeps when the profile was saved; a first check within 24 hours skips S13.
        const plan = { ...createPlan(body), created: Date.now() };
        const old = db.prepare("SELECT version FROM profiles WHERE user_id=?").get(u.id) as any;
        const version = (old?.version ?? 0) + 1;
        db.prepare(
          "INSERT INTO profiles VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET intake=excluded.intake,plan=excluded.plan,version=excluded.version",
        ).run(u.id, JSON.stringify(body), JSON.stringify(plan), version);
        // v7 (product v7 contract 2.10): the targeted weekly follows the new intake (stream E). The
        // intake is saved whatever the hook does; a failure is logged by its name only.
        if (v7Enabled())
          try {
            afterIntakeSaved(db, u.id);
          } catch (error) {
            console.error("AZM intake hook failed", error instanceof Error ? error.name : "Error");
          }
        return json(200, { intake: body, plan: { ...plan, version } });
      }
      if (route === "/api/sessions" && req.method === "GET") {
        const rows = db
          .prepare("SELECT data FROM results WHERE user_id=? ORDER BY rowid DESC")
          .all(u.id) as any[];
        return json(200, { records: rows.map((r) => JSON.parse(r.data)) });
      }
      if (route === "/api/workouts" && req.method === "POST") {
        const p = profile(u.id);
        if (!p.plan || p.plan.status !== "ready" || body.version !== p.plan.version)
          return json(409, { error: "PLAN_REQUIRED" });
        const demo = body.demo === true;
        if (!demo) {
          const active = db
            .prepare(
              "SELECT id,position,plan FROM workouts WHERE user_id=? AND version=? AND demo=0 AND ended=0 ORDER BY created DESC LIMIT 1",
            )
            .get(u.id, p.plan.version) as any;
          // A workout resumes with the day it started on (its cards), when it has one.
          if (active) {
            const today = (JSON.parse(active.plan) as RunPlan).today;
            return json(200, {
              id: active.id,
              demo: false,
              plan: p.plan,
              nextIndex: active.position,
              ...(today ? { today } : {}),
            });
          }
          const last = db
            .prepare("SELECT data FROM results WHERE user_id=? ORDER BY rowid DESC LIMIT 1")
            .get(u.id) as any;
          if (last && Date.now() - JSON.parse(last.data).endedAt < p.plan.recoveryHours * 3600000)
            return json(409, { error: "RECOVERY" });
        }
        // Booth v2 (D): a page that knows the guided cards asks for them; the day is kept with the run.
        const today = body.guided === true ? startDay(p.intake, p.plan, body.weekday, Date.now()) : null;
        const run: RunPlan = today ? { ...p.plan, today } : p.plan;
        if (!runSteps(run).length) return json(409, { error: "PLAN_REQUIRED" });
        const id = randomUUID();
        db.prepare("INSERT INTO workouts(id,user_id,plan,version,demo,created) VALUES(?,?,?,?,?,?)").run(
          id,
          u.id,
          JSON.stringify(run),
          p.plan.version,
          Number(demo),
          Date.now(),
        );
        return json(200, { id, demo, plan: p.plan, ...(today ? { today } : {}) });
      }
      const cards = route.match(/^\/api\/workouts\/([a-f0-9-]+)\/cards$/);
      if (cards && req.method === "POST") {
        const run = db.prepare("SELECT * FROM workouts WHERE id=? AND user_id=?").get(cards[1], u.id) as any;
        if (!run) return json(404, { error: "NOT_FOUND" });
        const current = profile(u.id);
        if (current.plan?.version !== run.version || current.plan?.status !== "ready")
          return json(409, { error: "PLAN_CHANGED" });
        const steps = runSteps(JSON.parse(run.plan) as RunPlan);
        if (run.ended || body.index !== run.position) return json(409, { error: "SET_ORDER" });
        const now = Date.now();
        const out = cardRecord(body, steps[body.index], run.created, now);
        if ("error" in out)
          return json(out.error === "order" ? 409 : 400, {
            error: out.error === "order" ? "SET_ORDER" : "RESULT_INVALID",
          });
        const rpe = out.record?.rpe;
        db.exec("BEGIN");
        try {
          if (!run.demo && out.record)
            db.prepare("INSERT INTO results VALUES(?,?,?,?,?)").run(
              randomUUID(),
              u.id,
              run.id,
              body.index,
              JSON.stringify(out.record),
            );
          db.prepare("UPDATE workouts SET position=position+1,ended=? WHERE id=?").run(
            Number(body.index + 1 === steps.length || (typeof rpe === "number" && rpe >= 8)),
            run.id,
          );
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
        const saved = !run.demo && out.record !== null;
        return json(200, { saved, record: saved ? out.record : null });
      }
      const match = route.match(/^\/api\/workouts\/([a-f0-9-]+)\/sets$/);
      if (match && req.method === "POST") {
        const run = db.prepare("SELECT * FROM workouts WHERE id=? AND user_id=?").get(match[1], u.id) as any;
        if (!run) return json(404, { error: "NOT_FOUND" });
        const current = profile(u.id);
        if (current.plan?.version !== run.version || current.plan?.status !== "ready")
          return json(409, { error: "PLAN_CHANGED" });
        // The steps of the run: the camera sets alone, or (a guided workout) between its cards.
        const steps = runSteps(JSON.parse(run.plan) as RunPlan);
        const step = steps[body.index];
        if (run.ended || body.index !== run.position || !step || step.kind !== "camera")
          return json(409, { error: "SET_ORDER" });
        const s = body.summary,
          e: Prescription = step.prescription;
        if (
          !s ||
          s.exerciseId !== e.exerciseId ||
          !s.reps ||
          !["valid", "compensated", "partial"].every(
            (k) => Number.isInteger(s.reps[k]) && s.reps[k] >= 0 && s.reps[k] <= 100,
          ) ||
          (s.rpe != null && (!Number.isInteger(s.rpe) || s.rpe < 0 || s.rpe > 10)) ||
          (s.romPct != null && (!Number.isFinite(s.romPct) || s.romPct < 0 || s.romPct > 100)) ||
          !Array.isArray(body.moments) ||
          body.moments.length > 300 ||
          !body.moments.every(
            (m: any) =>
              m &&
              ["valid", "compensated", "partial"].includes(m.cls) &&
              Number.isFinite(m.durSec) &&
              m.durSec >= 0 &&
              m.durSec < 3600 &&
              Number.isFinite(m.peakPct) &&
              m.peakPct >= 0 &&
              m.peakPct < 10,
          )
        )
          return json(400, { error: "RESULT_INVALID" });
        if (
          !["valid", "compensated", "partial"].every(
            (k) => body.moments.filter((m: any) => m.cls === k).length === s.reps[k],
          )
        )
          return json(400, { error: "RESULT_INVALID" });
        const flags = Object.fromEntries(
          Object.entries(s.flags ?? {})
            .filter(
              ([k, v]) =>
                /^[a-zA-Z0-9_-]{1,80}$/.test(k) &&
                Number.isInteger(v) &&
                Number(v) >= 0 &&
                Number(v) <= 10000,
            )
            .slice(0, 50),
        );
        const now = Date.now();
        const data = {
          exerciseId: e.exerciseId,
          profileId:
            e.setup.position === "wheelchair"
              ? "wheelchair"
              : e.setup.support === "none"
                ? "standing"
                : `hemiparesis_${e.setup.support}`,
          startedAt: Number.isFinite(s.startedAt)
            ? Math.min(now, Math.max(run.created, s.startedAt))
            : run.created,
          endedAt: now,
          reps: s.reps,
          rpe: s.rpe,
          romPct: s.romPct,
          flags,
          // The workout engine version that judged the set (S0 safety stop change record).
          engineVersion:
            typeof s.engineVersion === "string" && /^[a-z0-9_]{1,40}$/.test(s.engineVersion)
              ? s.engineVersion
              : undefined,
          moments: body.moments.map((m: any) => ({ cls: m.cls, durSec: m.durSec, peakPct: m.peakPct })),
          mode: "camera",
          setup: e.setup,
        };
        db.exec("BEGIN");
        try {
          if (!run.demo)
            db.prepare("INSERT INTO results VALUES(?,?,?,?,?)").run(
              randomUUID(),
              u.id,
              run.id,
              body.index,
              JSON.stringify(data),
            );
          db.prepare("UPDATE workouts SET position=position+1,ended=? WHERE id=?").run(
            Number(body.index + 1 === steps.length || s.rpe >= 8),
            run.id,
          );
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
        return json(200, { saved: !run.demo, record: run.demo ? null : data });
      }
      return json(404, { error: "NOT_FOUND" });
    } catch (error) {
      if (error instanceof SyntaxError) return json(400, { error: "INVALID_JSON" });
      console.error("AZM API request failed", error instanceof Error ? error.name : "Error");
      return json(500, { error: "SERVER" });
    }
  }
  return { handle, close: () => db.close() };
}
