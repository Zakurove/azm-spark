/**
 * Movement check routes (contract v2, sections E and G; clinical spec 2 to 5).
 *
 *   GET  /api/assessments/context        what the client needs to run the pre-check
 *   POST /api/assessments                start: consent, lock, 48 hour rule, pre-check evaluated here
 *   POST /api/assessments/:id/results    one test side, validated against the frozen protocol
 *   POST /api/assessments/:id/stop       the stop list answer (spec 4.0 stop routing)
 *   POST /api/assessments/:id/between    bt_pain_after (spec 2.3)
 *   POST /api/assessments/:id/complete   closes the check
 *   POST /api/assessments/after          ac_next_day (spec 2.4)
 *   GET  /api/assessments                the person's own checks with their results
 *
 * Rules before AI: every decision comes from the pure modules (src/medical/assessment.ts,
 * precheck.ts, progress-rules.ts), which the server runs on the raw answers; a client outcome is
 * never trusted. Raw answers are never stored; the check keeps only the data map fields of spec 2.1.
 * Nothing here logs. Errors are { error: CODE }, 400s name the field that failed.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Route, RouteContext } from "../../http/types";
import {
  earliestNextCheck,
  finalizeProtocol,
  isBlocked,
  retestDue,
  type ProtocolItem,
} from "../../../src/medical/assessment";
import {
  DATA_MAP_KEYS,
  afterCheck,
  betweenTests,
  evaluatePrecheck,
  isStopOption,
  lockEndsAt,
  releasesLock,
  riyadhDate,
  stopOptions,
  stopRoute,
  type PrecheckEnv,
  type PrecheckOutcome,
  type TestInstance,
} from "../../../src/medical/precheck";
import { seriesKey } from "../../../src/medical/progress-rules";
import { testDef } from "../../../src/movements/assessments";
import type { Setting, TestId } from "../../../src/movements/types";
import { activeConsent, CONSENT_VERSIONS, type ConsentRecord } from "../consents/store";
import { symptomAsk } from "../progress/series";
import {
  checkContextOf,
  firstCheckIn,
  neededArmsLastStand,
  personState,
  precheckEnv,
  seriesContext,
  sideLeanDoneAtHome,
} from "./state";
import {
  DAY_MS,
  abandonOpen,
  baselineRanges,
  chairId,
  clearChange,
  clearLock,
  countSafetyEvent,
  createAssessment,
  currentLock,
  keptResults,
  lastCompleted,
  listAssessments,
  ownAssessment,
  profileOf,
  reportChange,
  resolveLasting,
  resultOf,
  resultsOf,
  saveResult,
  setLock,
  setStatus,
  transaction,
  updatePrecheck,
  type Assessment,
  type ResultRecord,
} from "./store";
import { CLIENT_SKIP_REASONS, checkResult, checkStart, unknownKeys } from "./validate";

/** Check starts per person per calendar day in Asia/Riyadh (contract E). */
export const STARTS_PER_DAY = 20;
/** Tests whose series key holds the chair (same chair yes or no, spec 4.3 and 4.4). */
const CHAIR_TESTS: readonly TestId[] = ["trunk_control_seated", "chair_stand_30s"];
const ID_PATH = "(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";

/**
 * Staff booth mode (contract G): the code in env AZM_BOOTH_CODE, compared in constant time on
 * digests of equal length. Without the env nobody signed in can start a booth check.
 */
// SPEC-GAP: booth-code-refused. Contract E says booth needs the code, "otherwise home". A wrong or
// missing code is refused (403 BOOTH_CODE) rather than silently run with the home rules while the
// person stands at the booth, so staff see the mistake.
export function boothCodeMatches(given: string | undefined): boolean {
  const expected = process.env.AZM_BOOTH_CODE;
  if (!expected || !given) return false;
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** The data map fields of spec 2.1 kept with the check, and nothing else. */
export function storedPrecheck(
  outcome: PrecheckOutcome,
  consent: ConsentRecord,
  faceCovered: boolean | undefined,
): Record<string, unknown> {
  const allowed: readonly string[] = DATA_MAP_KEYS;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(outcome.stored)) if (allowed.includes(k) && v !== undefined) out[k] = v;
  if (faceCovered !== undefined) out["fingerprint.faceCovered"] = faceCovered;
  out["consent.acceptedAt"] = consent.acceptedAt;
  out["consent.version"] = consent.version;
  return out;
}

/**
 * The owner's open check, or the error already sent (404 for another person's check).
 *
 * `today` (results, between tests, complete): the pre-check is today's go or no go decision (spec
 * 2.1), so a check that started on an earlier calendar day in Riyadh is abandoned, and a same day
 * lock refuses the check (409 LOCKED). The stop list passes `today: false`, so a safety stop always
 * reaches the check.
 */
// SPEC-GAP: stale-open-check. The spec has no lifetime for an open check; it ends with the Riyadh day
// of its pre-check (a check started at 23:50 ends at midnight: the safe side).
function openCheck(ctx: RouteContext, { today }: { today: boolean }): Assessment | null {
  const u = ctx.user!;
  const a = ownAssessment(ctx.db, ctx.params.id, u.id);
  if (!a) {
    ctx.json(404, { error: "NOT_FOUND" });
    return null;
  }
  if (a.status === "open" && today) {
    const now = Date.now();
    if (riyadhDate(a.started) !== riyadhDate(now)) {
      abandonOpen(ctx.db, u.id, "stale", a.id);
      ctx.json(409, { error: "NOT_OPEN", status: "abandoned" });
      return null;
    }
    const lock = currentLock(ctx.db, u.id, now);
    if (lock) {
      ctx.json(409, { error: "LOCKED", reason: lock.reason, until: lock.until });
      return null;
    }
  }
  if (a.status !== "open") {
    ctx.json(409, { error: "NOT_OPEN", status: a.status });
    return null;
  }
  return a;
}

/** The environment of a running check for the stop list: its position, setup and setting. */
function runningEnv(ctx: RouteContext, a: Assessment): PrecheckEnv | null {
  const profile = profileOf(ctx.db, ctx.user!.id);
  if (!profile) return null;
  return {
    setting: a.setting,
    ctx: checkContextOf(profile.intake, profile.plan, a.meta.position),
    setup: a.setup,
    firstCheck: false,
    unresolvedChangeReported: false,
    lastCheckLasting: false,
    baseTests: [...new Set(a.protocol.map((i) => i.testId))],
  };
}

function instanceOf(item: ProtocolItem): TestInstance {
  const t: TestInstance = { testId: item.testId, side: item.side };
  if (item.variant) t.variant = item.variant;
  if (item.pushHand) t.pushHand = item.pushHand;
  return t;
}

/** A skip result the server writes for a protocol item (between tests): no score, no attempts. */
function skipRecord(
  a: Assessment,
  item: ProtocolItem,
  reason: string,
  now: number,
): Omit<ResultRecord, "id"> {
  const detail = {};
  return {
    assessmentId: a.id,
    testId: item.testId,
    side: item.side,
    value: null,
    unit: testDef(item.testId).unit,
    variant: null,
    band: item.band,
    attempts: [],
    quality: {},
    detail,
    flags: [],
    nValid: 0,
    median: null,
    skippedReason: reason,
    seriesKey: seriesKey({
      testId: item.testId,
      side: item.side,
      setting: a.setting,
      poseModel: a.device.model,
      movementVersion: item.version,
      detail,
      position: a.meta.position,
      variant: null,
      limbLoss: a.setup.limbLoss,
    }),
    poseModel: a.device.model,
    movementVersion: item.version,
    engineVersion: a.device.engineVersion,
    created: now,
  };
}

/** A stored result as the owner sees it in the list (row ids and the quality report left out). */
function publicResult(r: ResultRecord) {
  return {
    testId: r.testId,
    side: r.side,
    value: r.value,
    unit: r.unit,
    variant: r.variant,
    band: r.band,
    attempts: r.attempts,
    detail: r.detail,
    flags: r.flags,
    nValid: r.nValid,
    median: r.median,
    skippedReason: r.skippedReason,
    seriesKey: r.seriesKey,
    poseModel: r.poseModel,
    movementVersion: r.movementVersion,
    engineVersion: r.engineVersion,
    created: r.created,
  };
}

export const assessmentRoutes: Route[] = [
  {
    method: "GET",
    path: /^\/api\/assessments\/context$/,
    auth: "user",
    handle({ db, user, req, json }) {
      const now = Date.now();
      const u = user!;
      // Booth mode asks with ?setting=booth, so its questions match the server's evaluation (the
      // booth code itself is checked when the check starts).
      // SPEC-GAP: context-setting-query. Contract E returns setting home only; the booth firstCheck
      // and base tests differ, so the query is a contract addition.
      const asked = new URL(req.url ?? "/", "http://azm.invalid").searchParams.get("setting");
      if (asked !== null && asked !== "home" && asked !== "booth")
        return json(400, { error: "CONTEXT_INVALID", field: "setting" });
      const setting: Setting = asked === "booth" ? "booth" : "home";
      const s = personState(db, u.id, now);
      if (!s) return json(409, { error: "PLAN_REQUIRED" });
      const lock = currentLock(db, u.id, now);
      const last = s.lastCompleted?.completed ?? null;
      const dose = s.lastCompleted?.precheck["fingerprint.pdDoseBucket"];
      const common = {
        setting,
        setup: s.setup,
        firstCheck: firstCheckIn(db, u.id, setting),
        unresolvedChangeReported: s.unresolvedChangeReported,
        lastCheckLasting: s.lasting !== null,
        sideLeanDoneAtHome: sideLeanDoneAtHome(db, u.id),
        neededArmsLastStand: neededArmsLastStand(db, u.id, setting),
        // The {x} of warn_pd_timing: the dose bucket kept with the last completed check (SPEC-GAP
        // pd-timing-last in src/medical/precheck.ts), or null.
        lastPdDoseBucket: typeof dose === "string" ? dose : null,
        lock,
        retestDue: retestDue(last),
        earliestNext: earliestNextCheck(last),
        followUpDue: s.followUpDue !== null,
        consent: activeConsent(db, u.id, "movement_check") !== null,
        consentVersion: CONSENT_VERSIONS.movement_check,
        baselineRanges: baselineRanges(keptResults(db, u.id)),
      };
      if (isBlocked(s.context)) return json(200, { blocked: s.context.blocked, ...common, baseTests: [] });
      const { env } = precheckEnv(db, u.id, s, s.context, setting);
      json(200, { ctx: s.context, ...common, baseTests: env.baseTests });
    },
  },
  {
    method: "POST",
    path: /^\/api\/assessments$/,
    auth: "user",
    handle({ db, user, body, json, limited }) {
      const now = Date.now();
      const u = user!;
      // Every start request counts, so answers cannot be tried again and again.
      if (limited(`check-start:${u.id}:${riyadhDate(now)}`, STARTS_PER_DAY, DAY_MS))
        return json(429, { error: "RATE_LIMIT" });
      const parsed = checkStart(body);
      if (!parsed.ok) return json(400, { error: "START_INVALID", field: parsed.field });
      const { answers, device, setting } = parsed.value;
      if (setting === "booth" && !boothCodeMatches(parsed.value.boothCode))
        return json(403, { error: "BOOTH_CODE" });
      const s = personState(db, u.id, now);
      if (!s) return json(409, { error: "PLAN_REQUIRED" });
      if (isBlocked(s.context)) return json(409, { error: "REVIEW", reason: s.context.blocked });
      const consent = activeConsent(db, u.id, "movement_check");
      if (!consent) return json(403, { error: "CONSENT_REQUIRED" });
      const ctx = s.context;
      const { env, base } = precheckEnv(db, u.id, s, ctx, setting);

      const lock = currentLock(db, u.id, now);
      // recent_change is released at once by a yes to pc_change_cleared (locks.rules).
      const released = lock !== null && releasesLock(lock, env, answers);
      if (lock && !released) return json(409, { error: "LOCKED", reason: lock.reason, until: lock.until });
      // SPEC-GAP: min-hours-all-settings. The 48 hour minimum (spec 5) counts from the last completed
      // check in either setting: a booth check the day after a home check waits too.
      const earliest = earliestNextCheck(s.lastCompleted?.completed);
      if (earliest !== null && now < earliest) return json(409, { error: "TOO_SOON", until: earliest });

      const outcome = evaluatePrecheck(env, answers, now);
      if (outcome.status === "incomplete") return json(400, { error: "PRECHECK_INCOMPLETE" });
      if (outcome.status !== "proceed") {
        // The lock's kind can be longer than its reason's own (several postpone reasons).
        const until = outcome.lock?.until ? lockEndsAt(outcome.lock.until, now) : null;
        transaction(db, () => {
          if (released) clearLock(db, u.id);
          // Today's answers overrule a check left open: it takes no more results (spec 2.1).
          abandonOpen(db, u.id, "postponed");
          if (outcome.lock && until !== null) setLock(db, u.id, outcome.lock.reason, until, now);
          if (typeof outcome.stored.changeReported === "string")
            reportChange(db, u.id, outcome.stored.changeReported);
          countSafetyEvent(db, `precheck:${outcome.reason}`, setting, now);
        });
        return json(409, {
          error: "POSTPONE",
          status: outcome.status,
          reason: outcome.reason,
          screen: outcome.screen,
          alsoShow: outcome.alsoShow ?? [],
          lock: outcome.lock ? { reason: outcome.lock.reason, until } : null,
        });
      }

      const protocol = finalizeProtocol(base, outcome, ctx, setting, s.setup);
      const kind = lastCompleted(db, u.id, setting) ? ("retest" as const) : ("baseline" as const);
      // SPEC-GAP: open-check-replaced. A new start abandons a check left open (createAssessment), so a
      // person has one open check at a time.
      const id = transaction(db, () => {
        if (released) clearLock(db, u.id);
        if (typeof outcome.stored.changeCleared === "string")
          clearChange(db, u.id, outcome.stored.changeCleared);
        if (outcome.followUpResolved && s.lasting) resolveLasting(db, u.id, s.lasting.id);
        return createAssessment(db, {
          userId: u.id,
          kind,
          setting,
          meta: { position: ctx.position, poseModel: device.model, intakeVersion: s.plan.version },
          setup: { ...s.setup, ...outcome.setupUpdates },
          protocol,
          precheck: storedPrecheck(outcome, consent, parsed.value.faceCovered),
          device,
          started: now,
        });
      });
      json(200, {
        id,
        kind,
        setting,
        protocol,
        warnings: outcome.warnings,
        helperRequired: outcome.helperRequired,
      });
    },
  },
  {
    method: "POST",
    path: new RegExp(`^/api/assessments/${ID_PATH}/results$`),
    auth: "user",
    handle(ctx) {
      const { db, user, body, json } = ctx;
      const u = user!;
      const a = openCheck(ctx, { today: true });
      if (!a) return;
      if (!activeConsent(db, u.id, "movement_check")) return json(403, { error: "CONSENT_REQUIRED" });
      const item = a.protocol.find((i) => i.testId === body.testId && i.side === body.side);
      if (!item) return json(400, { error: "NOT_IN_PROTOCOL" });
      if (item.skipped) return json(409, { error: "SKIPPED", reason: item.skipped });
      const existing = resultOf(db, a.id, item.testId, item.side);
      const clientSkips: readonly (string | null)[] = CLIENT_SKIP_REASONS;
      if (existing?.skippedReason && !clientSkips.includes(existing.skippedReason))
        return json(409, { error: "SKIPPED", reason: existing.skippedReason });
      const profile = profileOf(db, u.id);
      const checked = checkResult(body, {
        item,
        setting: a.setting,
        conditions: profile?.intake.conditions ?? [],
      });
      if (!checked.ok) return json(400, { error: "RESULT_INVALID", field: checked.field });
      const r = checked.value;
      const now = Date.now();
      transaction(db, () => {
        const { sameChair, ...detail } = r.detail;
        const handsAllowed = r.variant === "arms_assisted" || r.variant === "arms_assisted_steady";
        if (handsAllowed && item.pushHand && detail.pushHand === undefined) detail.pushHand = item.pushHand;
        if (r.value !== null && CHAIR_TESTS.includes(item.testId)) {
          const same = typeof sameChair === "boolean" ? sameChair : undefined;
          detail.chair = chairId(db, u.id, a.id, item.testId, item.side, a.setting, same);
        }
        saveResult(db, u.id, {
          assessmentId: a.id,
          testId: item.testId,
          side: item.side,
          value: r.value,
          unit: r.unit,
          variant: r.variant,
          band: item.band,
          attempts: r.attempts,
          quality: r.quality,
          detail,
          flags: r.flags,
          nValid: r.nValid,
          median: r.median,
          skippedReason: r.skippedReason,
          seriesKey: seriesKey({
            testId: item.testId,
            side: item.side,
            setting: a.setting,
            poseModel: r.poseModel,
            movementVersion: r.movementVersion,
            detail,
            position: a.meta.position,
            variant: r.variant,
            limbLoss: a.setup.limbLoss,
          }),
          poseModel: r.poseModel,
          movementVersion: r.movementVersion,
          engineVersion: r.engineVersion,
          created: now,
        });
      });
      json(200, { saved: true });
    },
  },
  {
    method: "POST",
    path: new RegExp(`^/api/assessments/${ID_PATH}/stop$`),
    auth: "user",
    handle(ctx) {
      const { db, user, body, json } = ctx;
      const a = openCheck(ctx, { today: false });
      if (!a) return;
      if (unknownKeys(body, ["option"]).length) return json(400, { error: "STOP_INVALID", field: "body" });
      const env = runningEnv(ctx, a);
      if (!env) return json(409, { error: "PLAN_REQUIRED" });
      const option = body.option;
      if (typeof option !== "string" || !isStopOption(option) || !stopOptions(env).includes(option))
        return json(400, { error: "STOP_INVALID", field: "option" });
      const route = stopRoute(option, env);
      const now = Date.now();
      const until = route.lock?.until ? lockEndsAt(route.lock.until, now) : null;
      transaction(db, () => {
        countSafetyEvent(db, `stop:${option}`, a.setting, now);
        if (route.endsCheck) setStatus(db, a.id, "ended_early", null, `stop:${option}`);
        if (route.lock && until !== null) setLock(db, user!.id, route.lock.reason, until, now);
      });
      json(200, {
        option,
        screen: route.screen,
        alsoShow: route.alsoShow,
        endsCheck: route.endsCheck,
        lock: route.lock ? { reason: route.lock.reason, until } : null,
        reason: route.reason,
        then: route.then ?? null,
        afterRest: route.afterRest,
      });
    },
  },
  {
    method: "POST",
    path: new RegExp(`^/api/assessments/${ID_PATH}/between$`),
    auth: "user",
    handle(ctx) {
      const { db, user, body, json } = ctx;
      const a = openCheck(ctx, { today: true });
      if (!a) return;
      if (unknownKeys(body, ["testId", "side", "answer"]).length)
        return json(400, { error: "BETWEEN_INVALID", field: "body" });
      const item = a.protocol.find((i) => i.testId === body.testId && i.side === body.side && !i.skipped);
      if (!item) return json(400, { error: "BETWEEN_INVALID", field: "testId" });
      const done = resultsOf(db, a.id);
      const remaining = a.protocol.filter(
        (i) =>
          i.order > item.order && !i.skipped && !done.some((r) => r.testId === i.testId && r.side === i.side),
      );
      const out = betweenTests({ bt_pain_after: body.answer }, instanceOf(item), remaining.map(instanceOf));
      if (out.status === "incomplete") return json(400, { error: "BETWEEN_INVALID", field: "answer" });
      const now = Date.now();
      if (out.status === "end") {
        const until = out.lock?.until ? lockEndsAt(out.lock.until, now) : null;
        transaction(db, () => {
          countSafetyEvent(db, "between:much", a.setting, now);
          setStatus(db, a.id, "ended_early", null, "between:much");
          if (out.lock && until !== null) setLock(db, user!.id, out.lock.reason, until, now);
        });
        return json(200, {
          status: "end",
          skips: [],
          screen: out.screen ?? null,
          lock: out.lock ? { reason: out.lock.reason, until } : null,
        });
      }
      if (out.status === "skip") {
        transaction(db, () => {
          for (const k of out.skips) {
            const skipped = a.protocol.find((i) => i.testId === k.testId && i.side === k.side)!;
            saveResult(db, user!.id, skipRecord(a, skipped, k.reason, now));
          }
        });
      }
      json(200, { status: out.status, skips: out.skips, screen: null, lock: null });
    },
  },
  {
    method: "POST",
    path: new RegExp(`^/api/assessments/${ID_PATH}/complete$`),
    auth: "user",
    handle(ctx) {
      const { db, user, json } = ctx;
      const u = user!;
      const a = openCheck(ctx, { today: true });
      if (!a) return;
      // SPEC-GAP: complete-needs-row. "At least one result or skip" counts stored rows (a score or a
      // skip, including the between tests skips); protocol skips alone do not complete a check.
      if (resultsOf(db, a.id).length === 0) return json(409, { error: "NO_RESULTS" });
      const now = Date.now();
      setStatus(db, a.id, "completed", now, null);
      const s = personState(db, u.id, now);
      // SPEC-GAP: symptom-ask-yes. Spec 5: a yes to the one sided drop question opens scr_emergency,
      // the route of pc_urgent. Contract E has no route for that answer, so it sets no lock and no
      // safety count here; the 48 hour minimum after this completed check already covers the day.
      const ask = s
        ? symptomAsk(keptResults(db, u.id), a.id, (position) =>
            seriesContext(checkContextOf(s.intake, s.plan, position), s.setup),
          )
        : [];
      json(200, { id: a.id, completed: now, symptomAsk: ask });
    },
  },
  {
    method: "POST",
    path: /^\/api\/assessments\/after$/,
    auth: "user",
    handle({ db, user, body, json }) {
      if (unknownKeys(body, ["answer"]).length) return json(400, { error: "AFTER_INVALID", field: "body" });
      const now = Date.now();
      const s = personState(db, user!.id, now);
      const due = s?.followUpDue;
      if (!due) return json(409, { error: "NOT_DUE" });
      const out = afterCheck({ ac_next_day: body.answer });
      if (out.status === "incomplete") return json(400, { error: "AFTER_INVALID", field: "answer" });
      updatePrecheck(db, due.id, { ...due.precheck, ...out.stored });
      json(200, { recorded: true, screen: out.screen ?? null, lastingUnresolved: out.lastingUnresolved });
    },
  },
  {
    method: "GET",
    path: /^\/api\/assessments$/,
    auth: "user",
    handle({ db, user, json }) {
      const list = listAssessments(db, user!.id).map((a) => ({
        id: a.id,
        kind: a.kind,
        setting: a.setting,
        status: a.status,
        started: a.started,
        completed: a.completed,
        endedReason: a.endedReason,
        setup: a.setup,
        protocol: a.protocol,
        results: resultsOf(db, a.id).map(publicResult),
      }));
      json(200, { assessments: list });
    },
  },
];
