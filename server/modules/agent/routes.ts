/**
 * POST /api/agent/token and POST /api/agent/usage (product v7 contract 5.1 and 5.2, stream D): the
 * live coach's ephemeral token, its budget and the usage report; GET /api/agent/status (step D5) for
 * the coach's switch: whether the coach can run now and whether the person consented. Registered behind AZM_V7 by
 * server/modules/index.ts (404 while the flag is off). The token route answers 503 AGENT_UNAVAILABLE
 * while AZM_AGENT_ENABLED is off or GEMINI_API_KEY is missing; the usage report does not, since it
 * asks nothing of Google and a segment that ran before the switch went off still reports.
 *
 * The coach is an enhancement, never a dependency (C-5): every refusal here leaves the segment to the
 * local voice pack and the buttons. The token route checks, in the order of 5.1: the body, the
 * live_coach consent, an open ref of the person, the focus check's home gate for a range or gait
 * segment (open for v7, D-032 item 1), the segment of the ref, the rate limits, then the budget. It then builds the instruction, the block's
 * tools and the history from stored state only (C-12), mints the token with one fetch, and reserves
 * the segment's minutes once the mint succeeded. The API key never leaves the server; a failed mint
 * is logged by its status only. Errors are { error: CODE }; a 400 names the first bad field.
 */
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { Route } from "../../http/types";
import { COACH_SI_VERSION, buildHistory, buildInstruction } from "../../../src/coach/instruction";
import { toolDeclarations } from "../../../src/coach/tools";
import { riyadhDate, stopOptions, stopRoute, type PrecheckEnv } from "../../../src/medical/precheck";
import type { Setting } from "../../../src/movements/types";
import { runSteps, type RunPlan } from "../../guided";
import { RESUME_WINDOW_MS, applyLock, emergencyAlsoShow } from "../assessments/common";
import { checkContextOf, personState } from "../assessments/state";
import {
  countProduct,
  countSafetyEvent,
  currentLock,
  profileOf,
  reportChange,
  reportFaint,
  transaction,
} from "../assessments/store";
import { boothWindow } from "../booth/config";
import { validPass } from "../booth/store";
import { activeConsent } from "../consents/store";
import { focusHomeClosed } from "../focus/routes";
import { ownFocusCheck, type FocusCheck } from "../focus/store";
import { decide, ownSession, reserve, segmentSession, storeUsage, type ReservationAsk } from "./budget";
import { checkContext, workoutContext, type CoachContext } from "./context";
import { minutesFor, segmentsFor, SESSION_SEGMENTS } from "./segments";
import {
  LAB_MINUTES,
  LAB_SEGMENT,
  LAB_SI_VERSION,
  isLabRef,
  labHistory,
  labInstruction,
  labRef,
} from "./lab";
import { TokenError, agentConfig, coachSetup, mintToken } from "./token";
import type { TokenResponse } from "./types";
import { parseLabRequest, parseStopRequest, parseTokenRequest, parseUsageReport } from "./validate";

/* --------------------------------------------------------------- limits */

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
/** 5.1: token requests per person, per device (hashed) and per address in an hour. */
export const TOKEN_LIMITS = { user: 20, device: 20, ip: 60 } as const;
/** 4: usage reports per person in 15 minutes. */
export const USAGE_PER_WINDOW = 60;
/** The default pause before the person's turn ends (S0, live-spike.md 11). */
const DEFAULT_SILENCE_MS = 800;

const UNAVAILABLE = { error: "AGENT_UNAVAILABLE" } as const;
const NOT_OPEN = { error: "NOT_OPEN" } as const;

/* ---------------------------------------------------------------- refs */

/**
 * The person's focus check while it takes results: open, active in the last 30 minutes and started
 * today in Riyadh (as the focus routes' openCheck), with no lock on the person. Nothing is closed here;
 * the focus routes close a stale check.
 */
function openFocus(db: DatabaseSync, id: string, userId: string, now: number): FocusCheck | null {
  const c = ownFocusCheck(db, id, userId);
  if (!c || c.status !== "open") return null;
  if (now - c.active > RESUME_WINDOW_MS || riyadhDate(c.started) !== riyadhDate(now)) return null;
  if (currentLock(db, userId, now)) return null;
  return c;
}

/**
 * The person's workout of today with steps left, on the plan it was started with (a workout whose
 * plan changed saves no more sets, 409 PLAN_CHANGED in server/api.ts).
 */
function openWorkout(
  db: DatabaseSync,
  id: string,
  userId: string,
  now: number,
): { run: RunPlan; position: number } | null {
  const w = db
    .prepare("SELECT plan, version, position, ended, created FROM workouts WHERE id=? AND user_id=?")
    .get(id, userId) as
    { plan: string; version: number; position: number; ended: number; created: number } | undefined;
  if (!w || Number(w.ended) || riyadhDate(Number(w.created)) !== riyadhDate(now)) return null;
  const profile = profileOf(db, userId);
  if (!profile || profile.plan.status !== "ready" || profile.plan.version !== Number(w.version)) return null;
  const run = JSON.parse(w.plan) as RunPlan;
  const position = Number(w.position);
  return position < runSteps(run).length ? { run, position } : null;
}

const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** A valid booth pass on the request (C-14), as the booth journey and the focus routes check it. */
function boothPassHolds(req: IncomingMessage, db: DatabaseSync, now: number): boolean {
  return boothWindow(now).open && validPass(db, header(req.headers["x-azm-booth"]), now) !== null;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/* -------------------------------------------------------------- routes */

export const agentRoutes: Route[] = [
  {
    // The coach's switch (step D5, C-5): the coach switched on with a key, and the live_coach consent.
    // Nothing else: the key and the budget stay on the server.
    method: "GET",
    path: /^\/api\/agent\/status$/,
    auth: "user",
    handle(rc) {
      const { db, json } = rc;
      json(200, {
        available: agentConfig() !== null,
        consent: activeConsent(db, rc.user!.id, "live_coach") !== null,
      });
    },
  },
  {
    // A stop list answer in a coached workout (D-030 D5-7): v1's routing on the person's stored intake,
    // the stop's next day lock and the dates the next check reads (Q33 (2), (3)), as a check's stop sets
    // them, and the anonymous safety count. The phone has shown the stop's screen already.
    method: "POST",
    path: /^\/api\/agent\/stop$/,
    auth: "user",
    handle(rc) {
      const { db, body, json } = rc;
      const u = rc.user!;
      const now = Date.now();
      const parsed = parseStopRequest(body);
      if (!parsed.ok) return json(400, { error: "STOP_INVALID", field: parsed.field });
      const { workoutId, option } = parsed.value;
      if (!db.prepare("SELECT 1 FROM workouts WHERE id=? AND user_id=?").get(workoutId, u.id))
        return json(404, { error: "NOT_FOUND" });
      const s = personState(db, u.id, now);
      if (!s) return json(409, { error: "PLAN_REQUIRED" });
      const setting: Setting = boothPassHolds(rc.req, db, now) ? "booth" : "home";
      const position = "position" in s.context ? s.context.position : "chair";
      const env: PrecheckEnv = {
        setting,
        ctx: checkContextOf(s.intake, s.plan, position),
        setup: s.setup,
        firstCheck: false,
        unresolvedChangeReported: false,
        lastCheckLasting: false,
        baseTests: [],
      };
      if (!stopOptions(env).includes(option)) return json(400, { error: "STOP_INVALID", field: "option" });
      const route = stopRoute(option, env);
      const lock = transaction(db, () => {
        countSafetyEvent(db, `workout:stop:${option}`, "none", setting, now);
        if (route.stores === "changeReported") reportChange(db, u.id, riyadhDate(now));
        if (route.stores === "faintReported") reportFaint(db, u.id, riyadhDate(now));
        return applyLock(rc, route.lock, now);
      });
      json(200, {
        route: {
          ...route,
          alsoShow:
            route.screen === "scr_emergency"
              ? [...new Set([...route.alsoShow, ...emergencyAlsoShow(env)])]
              : route.alsoShow,
        },
        lock,
      });
    },
  },
  {
    method: "POST",
    path: /^\/api\/agent\/token$/,
    auth: "user",
    async handle(rc) {
      const { db, body, json, limited } = rc;
      const u = rc.user!;
      const now = Date.now();
      const cfg = agentConfig();
      if (!cfg) return json(503, UNAVAILABLE);
      const parsed = parseTokenRequest(body);
      if (!parsed.ok) return json(400, { error: "AGENT_INVALID", field: parsed.field });
      const req = parsed.value;
      if (!activeConsent(db, u.id, "live_coach")) return json(403, { error: "CONSENT_REQUIRED" });

      // The ref, then its segment: everything the coach is told comes from what is stored.
      let ref: string;
      let minutes: number;
      let context: () => CoachContext | null;
      // The setting of a coach_fallback count (section 3).
      let setting: () => Setting;
      if ("checkId" in req.ref) {
        const check = openFocus(db, req.ref.checkId, u.id, now);
        if (!check) return json(409, NOT_OPEN);
        if (focusHomeClosed(rc, check.setting)) return;
        const seg = segmentsFor(check.protocol, check.gaitPlan).find((s) => s.segment === req.segment);
        if (!seg || seg.block !== req.block) return json(400, { error: "AGENT_INVALID", field: "segment" });
        ref = check.id;
        minutes = minutesFor(seg, cfg.segmentMinutes);
        setting = () => check.setting;
        context = () => {
          const intake = profileOf(db, u.id)?.intake;
          return intake ? checkContext(check, intake, seg, req.lang) : null;
        };
      } else {
        const workout = openWorkout(db, req.ref.workoutId, u.id, now);
        if (!workout) return json(409, NOT_OPEN);
        if (!SESSION_SEGMENTS.includes(req.segment))
          return json(400, { error: "AGENT_INVALID", field: "segment" });
        ref = req.ref.workoutId;
        minutes = minutesFor({ block: "session" }, cfg.segmentMinutes);
        setting = () => (boothPassHolds(rc.req, db, now) ? "booth" : "home");
        context = () => workoutContext(workout.run, workout.position, req.segment, req.lang);
      }

      /**
       * A segment that never started falls back to the local voice here: no usage report can follow,
       * so this route counts it (a running segment's fallback is counted from its usage report).
       */
      const neverStarted = (key: "budget" | "token_failed") => {
        if (!segmentSession(db, u.id, ref, req.segment))
          countProduct(db, "coach_fallback", key, setting(), now);
      };

      const device = sha256(req.deviceId);
      if (
        limited(`agent-token:${u.id}`, TOKEN_LIMITS.user, HOUR_MS) ||
        limited(`agent-device:${device}`, TOKEN_LIMITS.device, HOUR_MS) ||
        limited(`agent-ip:${rc.ip}`, TOKEN_LIMITS.ip, HOUR_MS)
      )
        return json(429, { error: "RATE_LIMIT" });

      const ask: ReservationAsk = {
        userId: u.id,
        block: req.block,
        segment: req.segment,
        ref,
        day: riyadhDate(now),
        device,
        model: cfg.model,
        instructionVersion: COACH_SI_VERSION,
        minutes,
        now,
      };
      // A refusal before the mint costs no call to Google; reserve decides again after it.
      const before = decide(db, ask, cfg);
      if (!before.ok) {
        neverStarted("budget");
        return json(429, { error: "BUDGET", minutesLeft: before.minutesLeft });
      }

      const ctx = context();
      if (!ctx) return json(409, NOT_OPEN);
      const setup = coachSetup(cfg, {
        instruction: buildInstruction(ctx.instruction),
        tools: toolDeclarations(req.block),
        lang: req.lang,
        silenceMs: req.silenceMs ?? DEFAULT_SILENCE_MS,
      });
      let minted: Awaited<ReturnType<typeof mintToken>>;
      try {
        minted = await mintToken(cfg, setup, minutes);
      } catch (error) {
        const status = error instanceof TokenError ? error.status : 0;
        console.error("AZM agent token failed", status);
        neverStarted("token_failed");
        return json(502, { error: "TOKEN_FAILED" });
      }
      const reservation = reserve(db, ask, cfg);
      if (!reservation.ok) {
        neverStarted("budget");
        return json(429, { error: "BUDGET", minutesLeft: reservation.minutesLeft });
      }
      const out: TokenResponse = {
        sessionId: reservation.id,
        token: minted.name,
        model: cfg.model,
        apiVersion: cfg.apiVersion,
        voice: cfg.voice,
        expiresAt: minted.expireTime,
        newSessionExpiresAt: minted.newSessionExpireTime,
        history: buildHistory(ctx.history),
        minutesLeft: reservation.minutesLeft,
      };
      json(200, out);
    },
  },
  {
    // The coach's connection test (D-035 item 4, /?coachlab=1): a one minute token with the lab's own
    // instruction and no tools, for the signed in person with the live_coach consent (their voice goes
    // to Google as in the coach). The same rate limits and budget as a segment; each run is its own
    // row (block session, segment lab), and nothing about the person is sent.
    method: "POST",
    path: /^\/api\/agent\/lab-token$/,
    auth: "user",
    async handle(rc) {
      const { db, body, json, limited } = rc;
      const u = rc.user!;
      const now = Date.now();
      const cfg = agentConfig();
      if (!cfg) return json(503, UNAVAILABLE);
      const parsed = parseLabRequest(body);
      if (!parsed.ok) return json(400, { error: "AGENT_INVALID", field: parsed.field });
      const req = parsed.value;
      if (!activeConsent(db, u.id, "live_coach")) return json(403, { error: "CONSENT_REQUIRED" });
      const device = sha256(req.deviceId);
      if (
        limited(`agent-token:${u.id}`, TOKEN_LIMITS.user, HOUR_MS) ||
        limited(`agent-device:${device}`, TOKEN_LIMITS.device, HOUR_MS) ||
        limited(`agent-ip:${rc.ip}`, TOKEN_LIMITS.ip, HOUR_MS)
      )
        return json(429, { error: "RATE_LIMIT" });
      const ask: ReservationAsk = {
        userId: u.id,
        block: "session",
        segment: LAB_SEGMENT,
        ref: labRef(randomUUID()),
        day: riyadhDate(now),
        device,
        model: cfg.model,
        instructionVersion: LAB_SI_VERSION,
        minutes: LAB_MINUTES,
        now,
      };
      const before = decide(db, ask, cfg);
      if (!before.ok) return json(429, { error: "BUDGET", minutesLeft: before.minutesLeft });
      const setup = coachSetup(cfg, {
        instruction: labInstruction(req.lang),
        tools: [],
        lang: req.lang,
        silenceMs: req.silenceMs ?? DEFAULT_SILENCE_MS,
      });
      let minted: Awaited<ReturnType<typeof mintToken>>;
      try {
        minted = await mintToken(cfg, setup, LAB_MINUTES);
      } catch (error) {
        console.error("AZM agent lab token failed", error instanceof TokenError ? error.status : 0);
        return json(502, { error: "TOKEN_FAILED" });
      }
      const reservation = reserve(db, ask, cfg);
      if (!reservation.ok) return json(429, { error: "BUDGET", minutesLeft: reservation.minutesLeft });
      const out: TokenResponse = {
        sessionId: reservation.id,
        token: minted.name,
        model: cfg.model,
        apiVersion: cfg.apiVersion,
        voice: cfg.voice,
        expiresAt: minted.expireTime,
        newSessionExpiresAt: minted.newSessionExpireTime,
        history: labHistory(req.lang),
        minutesLeft: reservation.minutesLeft,
      };
      json(200, out);
    },
  },
  {
    method: "POST",
    path: /^\/api\/agent\/usage$/,
    auth: "user",
    handle(rc) {
      const { db, body, json, limited } = rc;
      const u = rc.user!;
      const now = Date.now();
      // No check of the coach switch or the key: a report asks nothing of Google, and the segments
      // that ran before the switch went off still report on their own rows (5.2; the e2e server of
      // 1.2.1 runs with AZM_AGENT_ENABLED=0 and 8.7 expects the page hide report to answer 200).
      if (limited(`agent-usage:${u.id}`, USAGE_PER_WINDOW, WINDOW_MS))
        return json(429, { error: "RATE_LIMIT" });
      const parsed = parseUsageReport(body);
      if (!parsed.ok) return json(400, { error: "USAGE_INVALID", field: parsed.field });
      const report = parsed.value;
      const session = ownSession(db, report.sessionId, u.id);
      if (!session) return json(404, { error: "NOT_FOUND" });
      // The setting of a count (section 3): the focus check's; a workout's is the booth with a booth pass.
      const setting: Setting =
        session.block === "session"
          ? boothPassHolds(rc.req, db, now)
            ? "booth"
            : "home"
          : (ownFocusCheck(db, session.ref, u.id)?.setting ?? "home");
      transaction(db, () => {
        // The connection test's runs are no fallback of the product (D-035 item 4).
        if (storeUsage(db, session, report, now) && !isLabRef(session.ref))
          countProduct(db, "coach_fallback", report.endReason, setting, now);
      });
      json(200, { ok: true });
    },
  },
];
