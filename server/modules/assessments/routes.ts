/**
 * Movement check routes (contract v2 E and G, v3 I; clinical spec 2 to 5; council decisions).
 *
 *   GET  /api/assessments/context        what the client needs to run the pre-check
 *   POST /api/assessments                start: flags, booth pass, consent, adult, lock, 48 hour rule,
 *                                        the pre-check evaluated here
 *   POST /api/assessments/:id/results    one test side, validated against the frozen protocol
 *   POST /api/assessments/:id/stop       the stop list answer (spec 4.0 stop routing)
 *   POST /api/assessments/:id/between    bt_pain_after (spec 2.3)
 *   POST /api/assessments/:id/complete   closes the check
 *   POST /api/assessments/after          ac_next_day (spec 2.4, O38)
 *   GET  /api/assessments                the person's own checks with their results
 * The end of check question, the faint follow up, the alarm counts and the resume are in
 * follow-up.ts.
 *
 * Rules before AI: every decision comes from the pure modules (src/medical/assessment.ts,
 * precheck.ts, progress-rules.ts), which the server runs on the raw answers; a client outcome is
 * never trusted. Raw answers are never stored; the check keeps only the data map fields of spec 2.1.
 * Nothing here logs. Errors are { error: CODE }, 400s name the field that failed. Reason ids travel
 * in response bodies only, never in a URL (Q25 (a)).
 */
import type { Route, RouteContext } from "../../http/types";
import { allSkipped, finalizeProtocol, isBlocked, type ProtocolItem } from "../../../src/medical/assessment";
import {
  DATA_MAP_KEYS,
  afterCheck,
  betweenTests,
  evaluatePrecheck,
  isStopOption,
  releasesLock,
  riyadhDate,
  stopOptions,
  stopRoute,
  type PrecheckOutcome,
} from "../../../src/medical/precheck";
import { seriesKey } from "../../../src/medical/progress-rules";
import type { Setting, TestId } from "../../../src/movements/types";
import { adultConfirmedAt } from "../account/store";
import { boothWindow, homeChecksOpen } from "../booth/config";
import { usePass, validPass } from "../booth/store";
import { activeConsent, CONSENT_VERSIONS, type ConsentRecord } from "../consents/store";
import {
  RESUME_WINDOW_MS,
  STOPPED_FLAG,
  applyLock,
  emergencyAlsoShow,
  homeClosed,
  instanceOf,
  isStale,
  lockView,
  openCheck,
  runningEnv,
  skipRecord,
} from "./common";
import { firstCheckIn, neededArmsLastStand, personState, precheckEnv, sideLeanDoneAtHome } from "./state";
import {
  DAY_MS,
  baselineRanges,
  chairId,
  clearChange,
  clearFaint,
  clearLock,
  closeOpen,
  countProduct,
  countSafetyEvent,
  createAssessment,
  currentLock,
  finishCheck,
  keptResults,
  lastCompleted,
  listAssessments,
  openAssessment,
  profileOf,
  reportChange,
  reportFaint,
  resolveLasting,
  resultOf,
  resultsOf,
  saveResult,
  touch,
  transaction,
  updatePrecheck,
  type ResultRecord,
} from "./store";
import { CLIENT_SKIP_REASONS, checkResult, checkStart, checkTestRef, unknownKeys } from "./validate";

/** Check starts per person per calendar day in Asia/Riyadh (contract E). */
export const STARTS_PER_DAY = 20;
/** Tests whose series key holds the chair (same chair yes or no, spec 4.3 and 4.4). */
const CHAIR_TESTS: readonly TestId[] = ["trunk_control_seated", "chair_stand_30s"];
export const ID_PATH = "(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";

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
 * The booth credential of a signed in booth start (O17): an unused visitor token, only inside the
 * booth days and hours. Returns the token to use once the start is evaluated, or false when refused.
 */
// SPEC-GAP: booth-code-and-token. Contract v3 I started a signed in booth check with boothCode; O17
// and 7.2-11 keep the code on staff devices, which swap it for a one check boothToken. The start takes
// only the token (a boothCode is an unknown field, 400 START_INVALID), so it is never a second way to
// test codes next to the rate limited POST /api/booth/verify.
// SPEC-GAP: booth-code-refused. Contract E says booth needs the code, "otherwise home". A missing or
// refused token is refused (403 BOOTH_CODE) rather than silently run with the home rules while the
// person stands at the booth, so staff see the mistake.
function boothPass(ctx: RouteContext, token: string | undefined, now: number) {
  if (!boothWindow(now).open || token === undefined) return false;
  return validPass(ctx.db, token, "visitor", now) !== null ? { token } : false;
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
      const open = openAssessment(db, u.id);
      const dose = s.lastCompleted?.precheck["fingerprint.pdDoseBucket"];
      const consent = activeConsent(db, u.id, "movement_check") !== null;
      const common = {
        setting,
        homeOpen: homeChecksOpen(),
        adultConfirmed: adultConfirmedAt(db, u.id) !== null,
        setup: s.setup,
        firstCheck: firstCheckIn(db, u.id, setting),
        completedBefore: s.lastCompleted !== null,
        unresolvedChangeReported: s.unresolvedChangeReported,
        faintReportedUnresolved: s.faintReportedUnresolved,
        lastCheckLasting: s.lasting !== null,
        sideLeanDoneAtHome: sideLeanDoneAtHome(db, u.id),
        neededArmsLastStand: neededArmsLastStand(db, u.id, setting),
        // The {x} of warn_pd_timing: the dose bucket kept with the last completed check (SPEC-GAP
        // pd-timing-last in src/medical/precheck.ts), or null.
        lastPdDoseBucket: typeof dose === "string" ? dose : null,
        lock: lock ? lockView(lock, now, "return") : null,
        // O6: the open check that may still resume (within 30 minutes of its last activity), or null.
        openCheck:
          open && !isStale(open, now)
            ? { id: open.id, setting: open.setting, resumeUntil: open.active + RESUME_WINDOW_MS }
            : null,
        // H9: due 28 days after the last completed home check (a booth check sets no home due date);
        // a start before it is early (scr_early_start); none sooner than 48 hours after any check.
        retestDue: s.schedule.retestDue,
        earliestNext: s.schedule.earliestNext,
        early: s.schedule.early,
        // Q12 (2): the side lean only session, offered 48 hours to 7 days after the first home check.
        sideLeanRepeat: s.sideLeanRepeat
          ? { ...s.sideLeanRepeat, baseTests: ["trunk_control_seated"] as TestId[] }
          : null,
        // The next day question is asked only under the consent (POST /api/assessments/after).
        followUpDue: consent && s.followUpDue !== null,
        consent,
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
    handle(rc) {
      const { db, user, body, json, limited } = rc;
      const now = Date.now();
      const u = user!;
      // Every start request counts, so answers cannot be tried again and again.
      if (limited(`check-start:${u.id}:${riyadhDate(now)}`, STARTS_PER_DAY, DAY_MS))
        return json(429, { error: "RATE_LIMIT" });
      const parsed = checkStart(body);
      if (!parsed.ok) return json(400, { error: "START_INVALID", field: parsed.field });
      const { answers, device, setting, session } = parsed.value;
      if (homeClosed(rc, setting)) return;
      const pass = setting === "booth" ? boothPass(rc, parsed.value.boothToken, now) : null;
      if (pass === false) return json(403, { error: "BOOTH_CODE" });
      const s = personState(db, u.id, now);
      if (!s) return json(409, { error: "PLAN_REQUIRED" });
      if (isBlocked(s.context)) return json(409, { error: "REVIEW", reason: s.context.blocked });
      const consent = activeConsent(db, u.id, "movement_check");
      if (!consent) return json(403, { error: "CONSENT_REQUIRED" });
      // SPEC-GAP: adult-required. Q2 (5) and Q32 (6): only adults do the check; the start is refused
      // until the account holds the adult confirmation (S05a), after the consent (UX 2.2 order).
      if (adultConfirmedAt(db, u.id) === null) return json(403, { error: "ADULT_REQUIRED" });
      // Q12 (2): the side lean only session only inside its offer, at home.
      if (session === "side_lean_only" && (setting !== "home" || !s.sideLeanRepeat))
        return json(409, { error: "NOT_OFFERED" });
      const ctx = s.context;
      const { env, base } = precheckEnv(db, u.id, s, ctx, setting, session);

      const lock = currentLock(db, u.id, now);
      // A releasable lock (recent_change) is released at once by a yes to pc_change_cleared.
      const released = lock !== null && releasesLock(lock, env, answers);
      if (lock && !released) return json(409, { error: "LOCKED", ...lockView(lock, now, "return") });
      // SPEC-GAP: min-hours-all-settings. The 48 hour minimum (spec 5, H9) counts from the last
      // completed check in either setting, the side lean only session included.
      const earliest = s.schedule.earliestNext;
      if (earliest !== null && now < earliest) return json(409, { error: "TOO_SOON", until: earliest });

      const outcome = evaluatePrecheck(env, answers, now);
      if (outcome.status === "incomplete") return json(400, { error: "PRECHECK_INCOMPLETE" });
      // A visitor token covers one check: it is used by the first start that is evaluated (O17).
      if (pass?.token && !usePass(db, pass.token, now)) return json(403, { error: "BOOTH_CODE" });
      if (outcome.status !== "proceed") {
        // SPEC-GAP: started-includes-postponed. A start that the pre-check postpones counts as a
        // check started, so it is the denominator of the pre-check safety counts (Q25 (a)).
        const view = transaction(db, () => {
          if (released) clearLock(db, u.id);
          // Today's answers overrule a check left open: it takes no more results (spec 2.1, O6).
          closeOpen(db, u.id, "replaced", now);
          if (typeof outcome.stored.changeReported === "string")
            reportChange(db, u.id, outcome.stored.changeReported);
          if (outcome.faintReportedCleared) clearFaint(db, u.id);
          countSafetyEvent(db, `precheck:${outcome.reason}`, "precheck", setting, now);
          countProduct(db, "checks_started", "", setting, now);
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

      const protocol = finalizeProtocol(base, outcome, ctx, setting, s.setup);
      // O21: when no test runs today the check closes as ended early and no clock starts.
      const none = allSkipped(protocol);
      const kind = lastCompleted(db, u.id, setting) ? ("retest" as const) : ("baseline" as const);
      // SPEC-GAP: open-check-replaced. A new start closes a check left open (createAssessment), so a
      // person has one open check at a time; its finished results are kept (O6 (3)).
      const id = transaction(db, () => {
        if (released) clearLock(db, u.id);
        if (typeof outcome.stored.changeCleared === "string")
          clearChange(db, u.id, outcome.stored.changeCleared);
        if (outcome.faintReportedCleared) clearFaint(db, u.id);
        if (outcome.followUpResolved && s.lasting) resolveLasting(db, u.id, s.lasting.id);
        countProduct(db, "checks_started", "", setting, now);
        for (const i of protocol) if (i.skipped) countProduct(db, "tests_skipped", i.skipped, setting, now);
        if (none) countProduct(db, "checks_ended_early", "", setting, now);
        return createAssessment(
          db,
          {
            userId: u.id,
            kind,
            setting,
            meta: {
              position: ctx.position,
              poseModel: device.model,
              intakeVersion: s.plan.version,
              ...(session === "side_lean_only" ? { session } : {}),
            },
            setup: { ...s.setup, ...outcome.setupUpdates },
            protocol,
            precheck: storedPrecheck(outcome, consent, parsed.value.faceCovered),
            device,
            started: now,
          },
          none ? "ended_early" : "open",
        );
      });
      json(200, {
        id,
        kind,
        setting,
        status: none ? "ended_early" : "open",
        protocol,
        warnings: outcome.warnings,
        helperRequired: outcome.helperRequired,
        checkIn: outcome.checkIn ?? null,
        helperBriefing: outcome.helperBriefing ?? {},
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
      const stopped = existing?.flags.includes(STOPPED_FLAG) === true;
      if (existing?.skippedReason && !stopped && !clientSkips.includes(existing.skippedReason))
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
      // resultOnStop: a test stopped from the stop list stores no score and is not measured again
      // today (O43); the client's own skip for it changes nothing.
      if (stopped) {
        if (r.skippedReason === null) return json(409, { error: "STOPPED", reason: existing!.skippedReason });
        touch(db, a.id, now);
        return json(200, { saved: true });
      }
      transaction(db, () => {
        const { sameChair, ...detail } = r.detail;
        const handsAllowed = r.variant === "arms_assisted" || r.variant === "arms_assisted_steady";
        if (handsAllowed && item.pushHand && detail.pushHand === undefined) detail.pushHand = item.pushHand;
        if (r.value !== null && CHAIR_TESTS.includes(item.testId)) {
          const same = typeof sameChair === "boolean" ? sameChair : undefined;
          detail.chair = chairId(db, u.id, a.id, item.testId, item.side, a.setting, same);
        }
        // Quality retries are counted once per test side, never stored with the result (Q2 (6)).
        if (existing === null && r.qualityRetries > 0)
          countProduct(db, "quality_retries", item.testId, a.setting, now, r.qualityRetries);
        saveResult(
          db,
          u.id,
          {
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
          },
          a.setting,
        );
        touch(db, a.id, now);
      });
      json(200, { saved: true });
    },
  },
  {
    method: "POST",
    path: new RegExp(`^/api/assessments/${ID_PATH}/stop$`),
    auth: "user",
    handle(ctx) {
      const { db, user, body, json, limited } = ctx;
      const a = openCheck(ctx, { today: false });
      if (!a) return;
      if (unknownKeys(body, ["option", "testId", "side"]).length)
        return json(400, { error: "STOP_INVALID", field: "body" });
      const env = runningEnv(ctx, a);
      if (!env) return json(409, { error: "PLAN_REQUIRED" });
      const option = body.option;
      if (typeof option !== "string" || !isStopOption(option) || !stopOptions(env).includes(option))
        return json(400, { error: "STOP_INVALID", field: "option" });
      const ref = checkTestRef(body, a.protocol, true);
      if (!ref.ok) return json(400, { error: "STOP_INVALID", field: ref.field });
      const route = stopRoute(option, env);
      const now = Date.now();
      // The stopped test (resultOnStop): the test side running, or during a rest the next one. Its skip
      // row, written here with the stop's reason and the stopped flag, is how a repeated post of the
      // stop is known after a restart too, without keeping the stop option with the person (Q25 (d)).
      // SPEC-GAP: stop-count-once. A stop names its test side; it is counted once per test side of a
      // check. A stop without a test side, or naming a test that already has a result, is counted
      // once per check and option by the in memory limiter only (a server restart may count it again).
      const item = ref.value;
      const existing = item ? resultOf(db, a.id, item.testId, item.side) : null;
      const anchored = item !== null && existing === null;
      const repeat = existing?.flags.includes(STOPPED_FLAG) === true;
      const count = anchored || (!repeat && !limited(`stop-count:${a.id}:${option}`, 1, DAY_MS));
      // No rate limit refuses a stop: a safety stop must always reach the check.
      const view = transaction(db, () => {
        if (anchored)
          saveResult(db, user!.id, skipRecord(a, item, route.reason, now, [STOPPED_FLAG]), a.setting);
        if (count) countSafetyEvent(db, `stop:${option}`, item?.testId ?? "none", a.setting, now);
        // Q33 (2), (3): the dates the next check reads.
        if (route.stores === "changeReported") reportChange(db, user!.id, riyadhDate(now));
        if (route.stores === "faintReported") reportFaint(db, user!.id, riyadhDate(now));
        if (route.endsCheck) finishCheck(db, a, "ended_early", now, "stop");
        // A stop that reaches an idle check (a late post from the queue) never keeps it open (O6).
        else if (!isStale(a, now)) touch(db, a.id, now);
        return applyLock(ctx, route.lock, now);
      });
      json(200, {
        option,
        screen: route.screen,
        alsoShow:
          route.screen === "scr_emergency"
            ? [...new Set([...route.alsoShow, ...emergencyAlsoShow(env)])]
            : route.alsoShow,
        endsCheck: route.endsCheck,
        lock: view,
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
        const view = transaction(db, () => {
          countSafetyEvent(db, "between:much", item.testId, a.setting, now);
          finishCheck(db, a, "ended_early", now, "stop");
          return applyLock(ctx, out.lock, now);
        });
        return json(200, { status: "end", skips: [], screen: out.screen ?? null, lock: view });
      }
      transaction(db, () => {
        if (out.status === "skip") {
          for (const k of out.skips) {
            const skipped = a.protocol.find((i) => i.testId === k.testId && i.side === k.side)!;
            saveResult(db, user!.id, skipRecord(a, skipped, k.reason, now), a.setting);
          }
        }
        touch(db, a.id, now);
      });
      json(200, { status: out.status, skips: out.skips, screen: null, lock: null });
    },
  },
  {
    method: "POST",
    path: new RegExp(`^/api/assessments/${ID_PATH}/complete$`),
    auth: "user",
    handle(ctx) {
      const { db, json } = ctx;
      const a = openCheck(ctx, { today: true });
      if (!a) return;
      // SPEC-GAP: complete-needs-row. "At least one result or skip" counts stored rows (a score or a
      // skip, including the between tests skips); protocol skips alone do not complete a check.
      if (resultsOf(db, a.id).length === 0) return json(409, { error: "NO_RESULTS" });
      const now = Date.now();
      transaction(db, () => finishCheck(db, a, "completed", now, null));
      // Q23 (7): the end of check question (GET and POST /api/assessments/:id/end) replaces the
      // one sided symptomAsk of v1; it is asked before the results, so before this call.
      json(200, { id: a.id, completed: now });
    },
  },
  {
    method: "POST",
    path: /^\/api\/assessments\/after$/,
    auth: "user",
    handle({ db, user, body, json }) {
      if (unknownKeys(body, ["answer"]).length) return json(400, { error: "AFTER_INVALID", field: "body" });
      // ac_next_day is health data kept with the check: it needs the movement check consent.
      if (!activeConsent(db, user!.id, "movement_check")) return json(403, { error: "CONSENT_REQUIRED" });
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
        session: a.meta.session ?? "full",
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

/** Protocol items of a check still to run: not skipped at the start and without a stored row. */
export function remainingItems(db: RouteContext["db"], a: { id: string; protocol: ProtocolItem[] }) {
  const done = resultsOf(db, a.id);
  return a.protocol.filter(
    (i) => !i.skipped && !done.some((r) => r.testId === i.testId && r.side === i.side),
  );
}
