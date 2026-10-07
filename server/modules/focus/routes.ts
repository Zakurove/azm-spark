/**
 * Focus check routes (product v7 contract section 4, C-2, C-3, C-4, C-13, C-14), behind AZM_V7 (C-9):
 *
 *   GET  /api/focus/context        what the client needs before a focus check: the intake state, the
 *                                  consents, the pre-check environment and a preview of the protocol
 *   POST /api/focus                start: the v1 pre-check through the bridge, the range protocol and
 *                                  the gait plan built and frozen on the server
 *   POST /api/focus/:id/rom        one movement and side; the server grades it (C-3)
 *   POST /api/focus/:id/gait       the walk's setup and analysis; provisional findings (C-13)
 *   POST /api/focus/:id/stop       the v1 stop list answer, its screens and locks
 *   POST /api/focus/:id/complete   the not measured rows, the final gait findings, the profile
 *   GET  /api/focus                the person's focus checks
 *
 * Rules before AI: every decision comes from the pure modules, which the server runs on the raw
 * answers and measurements; a client grade or finding is never trusted. Raw pre-check answers are never
 * stored (the v1 data map only), nor any free text. Nothing here logs. Errors are { error: CODE }; a
 * 400 names the field that failed.
 *
 * D-032 item 1 opens the v7 focus check to everyone signed in, from anywhere: home is open whenever
 * the v7 routes are (AZM_V7=1, focusHomeOpen), with no booth code. A booth team's pass still gives a
 * booth check (setting booth, X-Azm-Booth), but it is never required; a signed in booth setting
 * without a valid pass is refused (403 BOOTH_REQUIRED), so the setting the client sends cannot claim
 * the booth's staff. The v1 movement checks keep their own home gate (homeClosed) unchanged.
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { BodyGate, Route, RouteContext } from "../../http/types";
import {
  evaluatePrecheck,
  releasesLock,
  riyadhDate,
  stopOptions,
  stopRoute,
} from "../../../src/medical/precheck";
import { buildRomProfile, romFindings } from "../../../src/medical/rom-profile";
import { evaluateGait } from "../../../src/medical/gait-rules";
import type { GaitPlan } from "../../../src/medical/gait-eligibility";
import type { GaitPatternResult, GaitStoredView } from "../../../src/medical/gait-types";
import type { RomFindingId, RomSource, StoredRomRow } from "../../../src/medical/rom-types";
import type { RomNotMeasured, RomProtocol, RomProtocolItem } from "../../../src/medical/rom-protocol";
import { focusPlanJoints } from "../../../src/medical/check-joints";
import { keptDayAnswers } from "../../../src/medical/focus-precheck";
import type { GaitAnalysis, GaitSetup } from "../../../src/engine/gait/types";
import { GAIT_ENGINE_VERSION, GAIT_RULES_VERSION } from "../../../src/movements/gait";
import {
  NORMS_VERSION,
  ROM_ENGINE_VERSION,
  ROM_RULES_VERSION,
  movementDef,
} from "../../../src/movements/rom";
import {
  ROM_MOVEMENT_IDS,
  type JointMovementId,
  type RomMovementId,
  type RomSide,
} from "../../../src/movements/rom/types";
import { TARGETS_VERSION } from "../../../src/movements/targets";
import type { CheckPosition, ScreenId, Setting } from "../../../src/movements/types";
import { adultConfirmedAt } from "../account/store";
import { boothWindow } from "../booth/config";
import { validPass } from "../booth/store";
import { activeConsent } from "../consents/store";
import {
  RESUME_WINDOW_MS,
  SAFETY_LATE_MS,
  applyLock,
  emergencyAlsoShow,
  homeClosed,
  lockView,
} from "../assessments/common";
import { ID_PATH, storedPrecheck } from "../assessments/routes";
import { checkContextOf, personState, type PersonState } from "../assessments/state";
import {
  DAY_MS,
  clearChange,
  clearFaint,
  clearLock,
  countProduct,
  countSafetyEvent,
  currentLock,
  profileOf,
  reportChange,
  reportFaint,
  resolveLasting,
  transaction,
} from "../assessments/store";
import {
  FOCUS_RULES,
  PREVIEW_TODAY,
  focusContext,
  focusEnvBase,
  reviewReason,
  type FocusRules,
  type V7Intake,
} from "./precheck";
import {
  closeFocusCheck,
  closeOpenFocusChecks,
  createFocusCheck,
  finishFocusCheck,
  firstCompletedFocus,
  gaitOf,
  hasRomRow,
  lastCompletedFocus,
  lastCompletedFocusAt,
  focusEarliestNext,
  listFocusChecks,
  openFocusCheck,
  ownFocusCheck,
  replaceGaitFindings,
  romRowsOf,
  saveGait,
  saveRomRow,
  sideLeanBest,
  stopClosedFocusCheck,
  storedPatterns,
  touchFocus,
  type FocusCheck,
  type NewRomRow,
  type StoredGait,
  type StoredGaitFindings,
} from "./store";
import { checkFocusStart, checkFocusStop, checkGaitBody, checkRomResult, resultRef } from "./validate";

/* ------------------------------------------------------------- the flag */

/** C-9: the v7 server flag, read at every request so a Railway change needs no code change. */
export function v7Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AZM_V7 === "1";
}

/**
 * D-032 item 1 (replacing C-14 for v7): a v7 focus check may run at home, for everyone signed in, as
 * soon as the v7 routes run (AZM_V7=1). The v1 home gate (homeClosed, HOME_CHECKS_READY and
 * AZM_CHECK_HOME) keeps the v1 movement checks closed exactly as before.
 */
export function focusHomeOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return v7Enabled(env);
}

/**
 * The home gate of a v7 focus check (the start, its results and the coach's token): open with the v7
 * routes (focusHomeOpen); were they ever reached without the flag, the v1 gate answers (403
 * HOME_CLOSED), the safe side. True when the refusal was sent.
 */
export function focusHomeClosed(ctx: RouteContext, setting: string): boolean {
  return !focusHomeOpen() && homeClosed(ctx, setting);
}

const NOT_FOUND = { error: "NOT_FOUND" } as const;

/**
 * A v7 route behind AZM_V7 (C-9, section 4 "Gated"): with the flag off it answers 404 NOT_FOUND to
 * everyone, signed in or not, before any other check and before a large body is buffered; with the
 * flag on it is the route as written (a user route still answers 401 AUTH_REQUIRED without a session).
 */
export function v7Gate(route: Route): Route {
  const limit = route.bodyLimit;
  return {
    method: route.method,
    path: route.path,
    auth: "public",
    handle(ctx) {
      if (!v7Enabled()) return ctx.json(404, NOT_FOUND);
      if (route.auth === "user" && !ctx.user) return ctx.json(401, { error: "AUTH_REQUIRED" });
      return route.handle(ctx);
    },
    ...(limit
      ? { bodyLimit: (gate: BodyGate) => (v7Enabled() ? limit(gate) : { status: 404, ...NOT_FOUND }) }
      : {}),
  };
}

/* --------------------------------------------------------------- limits */

/** Focus check starts per person per calendar day in Asia/Riyadh (section 4). */
export const FOCUS_STARTS_PER_DAY = 20;
/** Range posts per person in 15 minutes (section 4). */
export const ROM_POSTS_PER_WINDOW = 120;
/** Gait posts per person in 15 minutes (section 4). */
export const GAIT_POSTS_PER_WINDOW = 20;
/** The gait route's body cap: the largest valid body (section 4, about 122 KB) fits under it. */
export const GAIT_BODY_LIMIT = 160 * 1024;
const WINDOW_MS = 15 * 60 * 1000;
/** C-13 and F1: the showcase persona measures at most 2 movements and walks one view. */
export const SHOWCASE_MAX_MEASURED = 2;

/** The showcase persona's accounts (AZM_SHOWCASE_EMAILS, staging only). */
function isShowcase(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AZM_SHOWCASE_EMAILS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase());
}

/** The showcase walks one view: the first of each mode's list. */
function oneView(plan: GaitPlan): GaitPlan {
  return {
    ...plan,
    views: {
      overground: plan.views.overground.slice(0, 1),
      walking_pad: plan.views.walking_pad.slice(0, 1),
    },
  };
}

const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** A valid booth pass (X-Azm-Booth) while the booth is open, as the booth journey checks it (a booth team's check). */
function boothPassHolds(req: IncomingMessage, db: DatabaseSync, now: number): boolean {
  return boothWindow(now).open && validPass(db, header(req.headers["x-azm-booth"]), now) !== null;
}

/**
 * The signed in person of a request, from the session cookie alone (server/api.ts reads it the same
 * way), so the gait route grants its larger body cap to signed in callers only, before buffering.
 */
function sessionUser(req: IncomingMessage, db: DatabaseSync, now: number): string | null {
  const raw =
    header(req.headers.cookie)
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("azm_session="))
      ?.slice(12) ?? "";
  if (!raw) return null;
  const token = createHash("sha256").update(raw).digest("hex");
  const r = db.prepare("SELECT user_id FROM sessions WHERE token=? AND expires>?").get(token, now) as
    { user_id: string } | undefined;
  return r?.user_id ?? null;
}

/* ----------------------------------------------------- shared helpers */

const RULES_PENDING = { error: "FOCUS_RULES_PENDING" } as const;
const FOCUS_ID_PATH = (tail: string) => new RegExp(`^/api/focus/${ID_PATH}/${tail}$`);

/** A check stops taking results 30 minutes after its last activity or on the next Riyadh day (v1 O6). */
function isStale(c: Pick<FocusCheck, "active" | "started">, now: number): boolean {
  return now - c.active > RESUME_WINDOW_MS || riyadhDate(c.started) !== riyadhDate(now);
}

/** The owner's check, or the 404 already sent. */
function ownCheck(ctx: RouteContext): FocusCheck | null {
  const c = ownFocusCheck(ctx.db, ctx.params.id, ctx.user!.id);
  if (!c) ctx.json(404, NOT_FOUND);
  return c;
}

/**
 * The owner's open check for a result (rom, gait, complete), or the error already sent: a stale
 * check is closed first and refused (409 NOT_OPEN with its new status), a same day lock refuses it
 * (409 LOCKED), and a check that is not open is refused (409 NOT_OPEN). Then the home gate, open
 * for v7 (focusHomeClosed, D-032 item 1).
 */
function openCheck(ctx: RouteContext, now: number): FocusCheck | null {
  const c = ownCheck(ctx);
  if (!c) return null;
  if (c.status === "open" && isStale(c, now)) {
    const status = transaction(ctx.db, () => closeFocusCheck(ctx.db, c, "stale")) ?? c.status;
    ctx.json(409, { error: "NOT_OPEN", status });
    return null;
  }
  if (c.status !== "open") {
    ctx.json(409, { error: "NOT_OPEN", status: c.status });
    return null;
  }
  const lock = currentLock(ctx.db, c.userId, now);
  if (lock) {
    ctx.json(409, { error: "LOCKED", ...lockView(lock, now, "return") });
    return null;
  }
  if (focusHomeClosed(ctx, c.setting)) return null;
  return c;
}

/**
 * The owner's check for a stop. A safety stop is never refused because the server closed the check
 * first (a stale close, a new start): its lock and counts must still reach the server, as in v1
 * (safetyCheck). The check is taken when it is open (a stale one is closed first, `closed` says so)
 * or closed less than a day after its last activity; a closed check is never reopened. Nor does it
 * read the home gate (as v1 safetyCheck): a stop only records locks, dates, counts and not measured
 * rows, and never measures (Gate A review).
 */
function stopCheck(ctx: RouteContext, now: number): { c: FocusCheck; closed: boolean } | null {
  const c = ownCheck(ctx);
  if (!c) return null;
  if (c.status === "open") {
    if (!isStale(c, now)) return { c, closed: false };
    const status = transaction(ctx.db, () => closeFocusCheck(ctx.db, c, "stale")) ?? c.status;
    return { c: { ...c, status }, closed: true };
  }
  if (now - c.active > SAFETY_LATE_MS) {
    ctx.json(409, { error: "NOT_OPEN", status: c.status });
    return null;
  }
  return { c, closed: true };
}

/** The person's intake with the v7 fields, or the 409 already sent. */
function v7IntakeOf(ctx: RouteContext, rules: FocusRules): V7Intake | null {
  const p = profileOf(ctx.db, ctx.user!.id);
  if (!p) {
    ctx.json(409, { error: "PLAN_REQUIRED" });
    return null;
  }
  if (!rules.hasV7Fields(p.intake)) {
    ctx.json(409, { error: "INTAKE_UPDATE_REQUIRED" });
    return null;
  }
  return p.intake;
}

/** The finding of a not measured row: not_today, not_applicable or unknown from its source (section 4). */
const NOT_MEASURED_FINDING: Record<Exclude<RomSource, "measured" | "default">, RomFindingId> = {
  not_measured_today: "not_today",
  not_applicable: "not_applicable",
  not_measured_camera: "unknown",
};

/** One not measured row for a protocol entry. */
function notMeasuredRow(
  c: FocusCheck,
  e: {
    movementId: JointMovementId;
    side: RomSide;
    position: RomProtocolItem["position"] | null;
    source: Exclude<RomSource, "measured" | "default">;
    reason: NewRomRow["reason"];
  },
  now: number,
): NewRomRow {
  const measured = (ROM_MOVEMENT_IDS as readonly string[]).includes(e.movementId);
  return {
    checkId: c.id,
    movementId: e.movementId,
    side: e.side,
    position: e.position,
    value: null,
    source: e.source,
    reason: e.reason,
    pain: false,
    painLevel: null,
    painBefore: null,
    cause: null,
    percentNormal: null,
    finding: NOT_MEASURED_FINDING[e.source],
    gradeIgnoringPain: null,
    norm: null,
    median: null,
    nValid: 0,
    attempts: [],
    flags: [],
    quality: {},
    poseModel: null,
    movementVersion: measured ? movementDef(e.movementId as RomMovementId).version : null,
    normsVersion: c.versions.norms,
    engineVersion: null,
    created: now,
  };
}

/**
 * The not measured rows complete and an ending stop write (C-4, section 4), one per protocol entry
 * without a stored row: the protocol's notMeasured (their own source and reason), the deferred
 * items (deferred), the skipped items (their skip reason) and the items never reached (not_reached).
 */
export function notMeasuredRows(c: FocusCheck, existing: readonly StoredRomRow[], now: number): NewRomRow[] {
  const done = new Set(existing.map((r) => `${r.movementId}:${r.side}`));
  const out: NewRomRow[] = [];
  const add = (row: NewRomRow) => {
    const key = `${row.movementId}:${row.side}`;
    if (done.has(key)) return;
    done.add(key);
    out.push(row);
  };
  const p: RomProtocol = c.protocol;
  for (const i of p.items)
    add(
      notMeasuredRow(
        c,
        {
          movementId: i.movementId,
          side: i.side,
          position: i.position,
          source: "not_measured_today",
          reason: i.skipped ?? "not_reached",
        },
        now,
      ),
    );
  for (const i of p.deferred)
    add(
      notMeasuredRow(
        c,
        {
          movementId: i.movementId,
          side: i.side,
          position: i.position,
          source: "not_measured_today",
          reason: "deferred",
        },
        now,
      ),
    );
  for (const n of p.notMeasured as RomNotMeasured[])
    add(
      notMeasuredRow(
        c,
        { movementId: n.movementId, side: n.side, position: null, source: n.source, reason: n.reason },
        now,
      ),
    );
  return out;
}

/**
 * The gait rules on a stored or posted analysis and the walk's setup, with the range rows of the check
 * so far (2.9) and the kept day's answers they read: the pain per region, Parkinson's pc_pd_on and
 * pc_steadi's fell and worry (D-026 item 7, CG-7, CG-9, CG-18).
 */
function gaitFindings(
  c: FocusCheck,
  intake: V7Intake,
  analysis: GaitAnalysis,
  setup: GaitSetup,
  rows: readonly StoredRomRow[],
  now: number,
): { patterns: GaitPatternResult[]; findings: StoredGaitFindings["findings"]; rulesVersion: string } {
  const romProfile = buildRomProfile({ intake, rows, now });
  const { painByRegion, pdState, steadi } = c.today;
  return evaluateGait({
    analysis,
    intake,
    romProfile,
    today: { painByRegion, ...(pdState ? { pdState } : {}), ...(steadi ? { steadi } : {}) },
    plan: c.gaitPlan!,
    setup,
  });
}

/**
 * The analysis a stored gait row stands for, for the rules to run again at complete: everything the
 * gait POST gave them but the walk's events and cycles, which the rules do not read (2.9).
 */
function storedAnalysis(g: StoredGait): GaitAnalysis {
  return {
    mode: g.mode,
    views: g.views.map((v) => ({
      view: v.view,
      ...(v.nearSide ? { nearSide: v.nearSide } : {}),
      poseModel: v.poseModel,
      events: [],
      cycles: [],
      metrics: v.metrics,
      quality: v.quality,
      replay: null,
    })),
    replay: g.replay,
    staticStance: g.staticStance,
    combined: g.metrics,
    flags: g.quality.flags,
    engineVersion: g.engineVersion,
    ...(g.walkPain.length ? { walkPain: g.walkPain } : {}),
    ...(g.outcome ? { outcome: g.outcome } : {}),
  };
}

/** The response view of a stored gait row with patterns (lines included) from the rules. */
function gaitView(g: StoredGait, patterns: GaitPatternResult[], provisional: boolean): GaitStoredView {
  return {
    id: g.id,
    mode: g.mode,
    // The response's views as 2.9 types them: the quality report and the model stay in storage.
    views: g.views.map(({ quality: _quality, poseModel: _poseModel, ...v }) => v),
    metrics: g.metrics,
    patterns,
    findings: g.findings.findings,
    quality: g.quality,
    replay: g.replay,
    provisional,
    ...(g.outcome ? { outcome: g.outcome } : {}),
    rulesVersion: g.rulesVersion,
    created: g.created,
  };
}

/* ----------------------------------------------------------- the routes */

/** The focus routes with these rules (FOCUS_RULES in the app, test rules in the route tests). */
export function focusRoutesWith(rules: FocusRules | null): Route[] {
  return [
    {
      method: "GET",
      path: /^\/api\/focus\/context$/,
      auth: "user",
      handle(rc) {
        const { db, json } = rc;
        const u = rc.user!;
        const now = Date.now();
        if (!rules) return json(503, RULES_PENDING);
        const s = personState(db, u.id, now);
        if (!s) return json(409, { error: "PLAN_REQUIRED" });
        // The setting of the preview: a booth check when the request carries a valid booth pass, else
        // home, which is open for v7 (D-032 item 1).
        const setting: Setting = boothPassHolds(rc.req, db, now) ? "booth" : "home";
        const review = reviewReason(s.intake, s.plan, setting);
        if (review) return json(409, { error: "REVIEW", reason: review });
        const ctx = focusContext(s.intake, s.plan, setting)!;
        const lock = currentLock(db, u.id, now);
        const open = openFocusCheck(db, u.id);
        const dose = s.lastCompleted?.precheck["fingerprint.pdDoseBucket"];
        const common = {
          setting,
          homeOpen: focusHomeOpen(),
          adultConfirmed: adultConfirmedAt(db, u.id) !== null,
          consent: {
            focus_check: activeConsent(db, u.id, "focus_check") !== null,
            live_coach: activeConsent(db, u.id, "live_coach") !== null,
          },
          lock: lock ? lockView(lock, now, "return") : null,
          open: open && !isStale(open, now) ? { id: open.id } : null,
          lastCompleted: lastCompletedFocusAt(db, u.id),
          earliestNext: s.schedule.earliestNext,
          // The {x} of warn_pd_timing (v1 R3C-30 (4)): the dose bucket kept with the last completed
          // movement check, or null, which leaves the warning out (src/medical/precheck.ts).
          lastPdDoseBucket: typeof dose === "string" ? dose : null,
        };
        const intake = s.intake;
        // Without the v7 answers no protocol can be built: the client asks for them first (the 48 hour
        // minimum is then the v1 schedule's, which counts the focus checks too).
        if (!rules.hasV7Fields(intake))
          return json(200, { intakeReady: false, ...common, env: null, protocol: null, gait: null });
        const showcase = isShowcase(u.email);
        const protocol = rules.buildRomProtocol({
          intake,
          setting,
          today: PREVIEW_TODAY,
          previous: firstCompletedFocus(db, u.id)?.protocol ?? null,
          ...(showcase ? { maxMeasured: SHOWCASE_MAX_MEASURED } : {}),
        });
        const plan = rules.gaitPlanFor(intake, PREVIEW_TODAY, setting, {});
        const gait = showcase ? oneView(plan) : plan;
        const env = rules.focusPrecheckEnv(focusEnvBase(db, u.id, s, ctx, setting), protocol, gait);
        // The 48 hour minimum of the preview's joints (CT-3): only checks that share one of them count.
        const earliestNext = focusEarliestNext(
          db,
          u.id,
          focusPlanJoints(protocol, gait?.offered === true),
          now,
        );
        json(200, { intakeReady: true, ...common, earliestNext, env, protocol, gait });
      },
    },
    {
      method: "POST",
      path: /^\/api\/focus$/,
      auth: "user",
      handle(rc) {
        const { db, body, json, limited } = rc;
        const u = rc.user!;
        const now = Date.now();
        // Every start request counts, so answers cannot be tried again and again.
        if (limited(`focus-start:${u.id}:${riyadhDate(now)}`, FOCUS_STARTS_PER_DAY, DAY_MS))
          return json(429, { error: "RATE_LIMIT" });
        const parsed = checkFocusStart(body);
        if (!parsed.ok) return json(400, { error: "START_INVALID", field: parsed.field });
        const { setting, answers, today, device, include } = parsed.value;
        // D-032 item 1: home is open for v7; a signed in booth check still needs a booth pass.
        if (focusHomeClosed(rc, setting)) return;
        if (setting === "booth" && !boothPassHolds(rc.req, db, now))
          return json(403, { error: "BOOTH_REQUIRED" });
        if (!rules) return json(503, RULES_PENDING);
        const s = personState(db, u.id, now);
        if (!s) return json(409, { error: "PLAN_REQUIRED" });
        const review = reviewReason(s.intake, s.plan, setting);
        if (review) return json(409, { error: "REVIEW", reason: review });
        const ctx = focusContext(s.intake, s.plan, setting)!;
        const intake = s.intake;
        if (!rules.hasV7Fields(intake)) return json(409, { error: "INTAKE_UPDATE_REQUIRED" });
        const consent = activeConsent(db, u.id, "focus_check");
        if (!consent) return json(403, { error: "CONSENT_REQUIRED" });
        if (adultConfirmedAt(db, u.id) === null) return json(403, { error: "ADULT_REQUIRED" });

        // The day's protocol and gait plan, and the pre-check environment they give (pure).
        const showcase = isShowcase(u.email);
        const built = rules.buildRomProtocol({
          intake,
          setting,
          today,
          previous: firstCompletedFocus(db, u.id)?.protocol ?? null,
          ...(showcase ? { maxMeasured: SHOWCASE_MAX_MEASURED } : {}),
        });
        // A part the person leaves out today is kept for the record, not measured (by choice).
        const protocol: RomProtocol = include.rom
          ? built
          : { ...built, items: built.items.map((i) => (i.skipped ? i : { ...i, skipped: "by_choice" })) };
        const planned = include.gait ? rules.gaitPlanFor(intake, today, setting, answers) : null;
        const gait = planned && showcase ? oneView(planned) : planned;
        // The gait day items (2.5 GAIT_DAY_ITEMS) are asked when the day plans a walk: a start that
        // walks carries their answers (pc_walk_10m, and pc_pd_freezing with Parkinson's).
        if (gait?.offered) {
          if (today.walk10m === undefined)
            return json(400, { error: "START_INVALID", field: "today.walk10m" });
          if (intake.conditions.includes("parkinsons") && today.pdFreezing === undefined)
            return json(400, { error: "START_INVALID", field: "today.pdFreezing" });
        }
        const env = rules.focusPrecheckEnv(focusEnvBase(db, u.id, s, ctx, setting), protocol, gait);

        const lock = currentLock(db, u.id, now);
        // A releasable lock (recent_change) is released at once by a yes to pc_change_cleared.
        const released = lock !== null && releasesLock(lock, env, answers);
        if (lock && !released) return json(409, { error: "LOCKED", ...lockView(lock, now, "return") });
        // The 48 hour minimum counts the checks of either kind completed in the last 48 hours that share
        // a joint with today's (section 4, two way; CT-3): the range items that run and, with the walk,
        // the regions it measures.
        const joints = focusPlanJoints(protocol, gait?.offered === true);
        const earliest = focusEarliestNext(db, u.id, joints, now);
        if (earliest !== null && now < earliest) return json(409, { error: "TOO_SOON", until: earliest });

        const outcome = evaluatePrecheck(env, answers, now);
        if (outcome.status === "incomplete") return json(400, { error: "START_INVALID", field: "answers" });
        if (outcome.status !== "proceed") {
          const view = transaction(db, () => {
            if (released) clearLock(db, u.id);
            // Today's answers overrule a focus check left open: it takes no more results.
            closeOpenFocusChecks(db, u.id, "replaced");
            if (typeof outcome.stored.changeReported === "string")
              reportChange(db, u.id, outcome.stored.changeReported);
            if (outcome.faintReportedCleared) clearFaint(db, u.id);
            countSafetyEvent(db, `focus:precheck:${outcome.reason}`, "precheck", setting, now);
            countProduct(db, "focus_started", "", setting, now);
            return applyLock(rc, outcome.lock, now);
          });
          return json(409, {
            error: "POSTPONE",
            status: outcome.status,
            reason: outcome.reason,
            screen: outcome.screen,
            alsoShow: outcome.alsoShow ?? [],
            lock: view,
          });
        }

        const applied = rules.applyPrecheckOutcome(protocol, gait, outcome);
        // rf_region (2.5): a red flag region shows the seek care screen once before the other regions.
        const warnings: ScreenId[] = [...outcome.warnings];
        if (today.redFlagRegions.length && !warnings.includes("scr_stop_seek_care"))
          warnings.push("scr_stop_seek_care");
        const runnable = applied.protocol.items.some((i) => !i.skipped);
        const walks = applied.gait !== null && applied.gait.offered;
        if (!runnable && !walks) return json(409, { error: "NOTHING_TO_MEASURE", warnings });

        const kind = lastCompletedFocus(db, u.id) ? ("retest" as const) : ("baseline" as const);
        const id = transaction(db, () => {
          if (released) clearLock(db, u.id);
          if (typeof outcome.stored.changeCleared === "string")
            clearChange(db, u.id, outcome.stored.changeCleared);
          if (outcome.faintReportedCleared) clearFaint(db, u.id);
          if (outcome.followUpResolved && s.lasting) resolveLasting(db, u.id, s.lasting.id);
          countProduct(db, "focus_started", "", setting, now);
          return createFocusCheck(db, {
            userId: u.id,
            kind,
            setting,
            protocol: applied.protocol,
            gaitPlan: applied.gait,
            // Only the day's answers a later step reads, each when it was asked (D-026 items 7 and 9).
            today: keptDayAnswers(env, answers, today, intake),
            precheck: storedPrecheck(outcome, consent, undefined),
            versions: {
              rom: ROM_RULES_VERSION,
              norms: NORMS_VERSION,
              gait: GAIT_RULES_VERSION,
              targets: TARGETS_VERSION,
              romEngine: ROM_ENGINE_VERSION,
              gaitEngine: GAIT_ENGINE_VERSION,
            },
            device,
            intakeVersion: s.plan.version,
            started: now,
          });
        });
        json(200, {
          id,
          kind,
          protocol: applied.protocol,
          gait: applied.gait,
          warnings,
          helperRequired: applied.helperRequired,
          helperBriefing: outcome.helperBriefing ?? {},
          // The seated side bend's limit reads each side's earlier best (D-027 item 2, W2-6).
          sideLeanBest: sideLeanBest(db, u.id),
        });
      },
    },
    {
      method: "POST",
      path: FOCUS_ID_PATH("rom"),
      auth: "user",
      handle(rc) {
        const { db, body, json, limited } = rc;
        const u = rc.user!;
        const now = Date.now();
        if (limited(`focus-rom:${u.id}`, ROM_POSTS_PER_WINDOW, WINDOW_MS))
          return json(429, { error: "RATE_LIMIT" });
        const c = openCheck(rc, now);
        if (!c) return;
        if (!rules) return json(503, RULES_PENDING);
        const ref = resultRef(body);
        if (!ref.ok) return json(400, { error: "RESULT_INVALID", field: ref.field });
        const item = c.protocol.items.find(
          (i) => i.movementId === ref.value.movementId && i.side === ref.value.side,
        );
        if (!item) return json(400, { error: "NOT_IN_PROTOCOL" });
        if (item.skipped) return json(409, { error: "SKIPPED", reason: item.skipped });
        if (hasRomRow(db, c.id, item.movementId, item.side)) return json(409, { error: "ALREADY_SAVED" });
        const checked = checkRomResult(body, item);
        if (!checked.ok) return json(400, { error: "RESULT_INVALID", field: checked.field });
        const r = checked.value;
        if (r.movementVersion !== movementDef(item.movementId).version)
          return json(409, { error: "STALE_CLIENT" });
        const intake = v7IntakeOf(rc, rules);
        if (!intake) return;
        // C-3: the server's grade, from the same pure rules the phone ran.
        const grade = rules.gradeMeasurement(r, intake);
        // The typical of the result's own position: the graded norm it was matched to, else none
        // (rom-protocol 4.3 rule 7, «value and progress only»), never another position's.
        const typical = rules.positionTypical(
          item.movementId,
          r.position,
          intake.sex,
          intake.age,
          item.side === "none" ? undefined : item.side,
        );
        transaction(db, () => {
          saveRomRow(db, u.id, {
            checkId: c.id,
            movementId: item.movementId,
            side: item.side,
            position: r.position,
            value: r.value,
            source: r.value === null ? "not_measured_today" : "measured",
            reason: r.reason,
            pain: r.painLimited,
            painLevel: r.painLevel,
            painBefore: r.painBefore,
            cause: r.cause,
            percentNormal: grade.percentNormal,
            finding: grade.finding,
            gradeIgnoringPain: grade.gradeIgnoringPain,
            norm: grade.norm,
            median: r.median,
            nValid: r.nValid,
            attempts: r.attempts.map((a) => ({
              ...a,
              quality: {
                ok: a.quality.ok,
                fps: a.quality.fps,
                view: a.quality.view,
                issues: a.quality.issues,
              },
            })),
            flags: grade.flags,
            quality: r.quality,
            poseModel: r.poseModel,
            movementVersion: r.movementVersion,
            normsVersion: c.versions.norms,
            engineVersion: r.engineVersion,
            created: now,
          });
          // Quality retries are counted once per movement and side, never stored with the result.
          if (r.retries > 0)
            countProduct(db, "rom_quality_retries", item.movementId, c.setting, now, r.retries);
          touchFocus(db, c.id, now);
        });
        json(200, { saved: true, grade, typical });
      },
    },
    {
      method: "POST",
      path: FOCUS_ID_PATH("gait"),
      auth: "user",
      // The larger body is granted from the headers alone, to a signed in caller within the limit.
      bodyLimit({ req, db, limited }) {
        const user = sessionUser(req, db, Date.now());
        if (!user) return { status: 401, error: "AUTH_REQUIRED" };
        if (limited(`focus-gait:${user}`, GAIT_POSTS_PER_WINDOW, WINDOW_MS))
          return { status: 429, error: "RATE_LIMIT" };
        return GAIT_BODY_LIMIT;
      },
      handle(rc) {
        const { db, body, json } = rc;
        const u = rc.user!;
        const now = Date.now();
        const c = openCheck(rc, now);
        if (!c) return;
        if (!rules) return json(503, RULES_PENDING);
        if (!c.gaitPlan?.offered) return json(409, { error: "NOT_OFFERED" });
        if (gaitOf(db, c.id)) return json(409, { error: "ALREADY_SAVED" });
        const checked = checkGaitBody(body, c.gaitPlan);
        if (!checked.ok) return json(400, { error: "GAIT_INVALID", field: checked.field });
        const intake = v7IntakeOf(rc, rules);
        if (!intake) return;
        const { setup, analysis } = checked.value;
        // C-13: provisional until complete, with the range rows saved so far.
        const ev = gaitFindings(c, intake, analysis, setup, romRowsOf(db, c.id), now);
        const quality = {
          gatePassed: analysis.views.some((v) => v.quality.gatePassed),
          timingOnly: analysis.views.some((v) => v.quality.timingOnly),
          flags: analysis.flags,
        };
        const stored: Omit<StoredGait, "id"> = {
          checkId: c.id,
          mode: analysis.mode,
          views: analysis.views.map((v) => ({
            view: v.view,
            ...(v.nearSide ? { nearSide: v.nearSide } : {}),
            metrics: v.metrics,
            cleanCycles: v.quality.cleanCycles,
            quality: v.quality,
            // C-10: the model is recorded per gait view (D-024, A5-9).
            poseModel: v.poseModel,
          })),
          setup,
          metrics: analysis.combined,
          staticStance: analysis.staticStance,
          walkPain: analysis.walkPain ?? [],
          ...(analysis.outcome ? { outcome: analysis.outcome } : {}),
          findings: { patterns: storedPatterns(ev.patterns), findings: ev.findings },
          quality,
          replay: analysis.replay,
          // The analysis's model: Lite when it flags model_lite or any view used Lite.
          poseModel:
            analysis.flags.includes("model_lite") || analysis.views.some((v) => v.poseModel === "lite")
              ? "lite"
              : "full",
          rulesVersion: ev.rulesVersion,
          engineVersion: analysis.engineVersion,
          created: now,
        };
        const id = transaction(db, () => {
          const gaitId = saveGait(db, u.id, stored);
          if (!quality.gatePassed) countProduct(db, "gait_gate_failed", analysis.mode, c.setting, now);
          touchFocus(db, c.id, now);
          return gaitId;
        });
        json(200, gaitView({ ...stored, id }, ev.patterns, true));
      },
    },
    {
      method: "POST",
      path: FOCUS_ID_PATH("stop"),
      auth: "user",
      handle(rc) {
        const { db, body, json, limited } = rc;
        const u = rc.user!;
        const now = Date.now();
        // A safety stop always reaches the check, also one the server closed meanwhile.
        const found = stopCheck(rc, now);
        if (!found) return;
        const { c, closed } = found;
        const parsed = checkFocusStop(body);
        if (!parsed.ok) return json(400, { error: "STOP_INVALID", field: parsed.field });
        const s = personState(db, u.id, now);
        if (!s) return json(409, { error: "PLAN_REQUIRED" });
        const env = {
          setting: c.setting,
          ctx: checkContextOf(s.intake, s.plan, contextPosition(s, c.setting)),
          setup: s.setup,
          firstCheck: false,
          unresolvedChangeReported: false,
          lastCheckLasting: false,
          baseTests: [],
        };
        const { option, movementId, side } = parsed.value;
        if (!stopOptions(env).includes(option)) return json(400, { error: "STOP_INVALID", field: "option" });
        const item =
          movementId === undefined
            ? null
            : (c.protocol.items.find((i) => i.movementId === movementId && i.side === side && !i.skipped) ??
              null);
        if (movementId !== undefined && !item)
          return json(400, { error: "STOP_INVALID", field: "movementId" });
        const route = stopRoute(option, env);
        // The stopped movement stores no value and is not measured again today (v1 resultOnStop): its
        // not measured row carries the stop's reason. Counted once per movement, or once per check and
        // option by the in memory limiter.
        const anchored = !closed && item !== null && !hasRomRow(db, c.id, item.movementId, item.side);
        const count = anchored || !limited(`focus-stop:${c.id}:${option}`, 1, DAY_MS);
        const lock = transaction(db, () => {
          if (anchored)
            saveRomRow(
              db,
              u.id,
              notMeasuredRow(
                c,
                {
                  movementId: item.movementId,
                  side: item.side,
                  position: item.position,
                  source: "not_measured_today",
                  reason: route.reason,
                },
                now,
              ),
            );
          if (count) countSafetyEvent(db, `focus:stop:${option}`, "none", c.setting, now);
          // Q33 (2), (3): the dates the next check reads, as a v1 stop.
          if (route.stores === "changeReported") reportChange(db, u.id, riyadhDate(now));
          if (route.stores === "faintReported") reportFaint(db, u.id, riyadhDate(now));
          if (route.endsCheck) {
            if (closed) stopClosedFocusCheck(db, c);
            else {
              for (const row of notMeasuredRows(c, romRowsOf(db, c.id), now)) saveRomRow(db, u.id, row);
              finishFocusCheck(db, c, "ended_early", now, "stop");
            }
          } else touchFocus(db, c.id, now);
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
      path: FOCUS_ID_PATH("complete"),
      auth: "user",
      handle(rc) {
        const { db, body, json } = rc;
        const u = rc.user!;
        const now = Date.now();
        if (Object.keys(body).length) return json(400, { error: "COMPLETE_INVALID", field: "body" });
        const c = openCheck(rc, now);
        if (!c) return;
        if (!rules) return json(503, RULES_PENDING);
        // As v1 (SPEC-GAP complete-needs-row): a check completes only with a stored row, a range row
        // (measured, or the not measured row of a range result or a stop) or a walk. An empty check
        // stays open until it goes stale, so it starts no 48 hour clock and is never the baseline a
        // retest is measured against (Gate A review).
        if (romRowsOf(db, c.id).length === 0 && !gaitOf(db, c.id)) return json(409, { error: "NO_RESULTS" });
        const intake = v7IntakeOf(rc, rules);
        if (!intake) return;
        const out = transaction(db, () => {
          for (const row of notMeasuredRows(c, romRowsOf(db, c.id), now)) saveRomRow(db, u.id, row);
          const rows = romRowsOf(db, c.id);
          // 2.9: the final gait findings, with every range row of the check (lying block included).
          const g = gaitOf(db, c.id);
          let gait: GaitStoredView | null = null;
          if (g && c.gaitPlan) {
            const ev = gaitFindings(c, intake, storedAnalysis(g), g.setup, rows, now);
            const findings = { patterns: storedPatterns(ev.patterns), findings: ev.findings };
            replaceGaitFindings(db, g.id, findings, ev.rulesVersion);
            gait = gaitView({ ...g, findings, rulesVersion: ev.rulesVersion }, ev.patterns, false);
          }
          finishFocusCheck(db, c, "completed", now, null);
          countProduct(db, "focus_completed", "", c.setting, now);
          return { rows, gait };
        });
        const profile = buildRomProfile({ intake, rows: out.rows, now });
        json(200, { status: "completed", profile, findings: romFindings(profile, intake), gait: out.gait });
      },
    },
    {
      method: "GET",
      path: /^\/api\/focus$/,
      auth: "user",
      handle({ db, user, json }) {
        const checks = listFocusChecks(db, user!.id).map((c) => ({
          id: c.id,
          kind: c.kind,
          setting: c.setting,
          status: c.status,
          started: c.started,
          completed: c.completed,
          measured: c.measured,
          gait: c.gait,
        }));
        json(200, { checks });
      },
    },
  ];
}

/** The position of a running check for the stop list: the person's check position from the intake. */
function contextPosition(s: PersonState, setting: Setting): CheckPosition {
  return focusContext(s.intake, s.plan, setting)?.position ?? "chair";
}

/** The focus routes of the app (registered behind AZM_V7 by server/modules/index.ts). */
export const focusRoutes: Route[] = focusRoutesWith(FOCUS_RULES);
