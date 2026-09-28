/**
 * The movement check routes that follow a test or a stop (council decisions Q23, Q33, O34-5, O6):
 *
 *   GET  /api/assessments/:id/end      the form of the end of check question (Q23 (7)): general, or
 *                                      the side form after a one sided large drop; the O37 line
 *   POST /api/assessments/:id/end      { answer: yes | no }: yes opens scr_emergency, stores
 *                                      changeReported, locks the day and closes an open check as
 *                                      completed (its results stay stored)
 *   POST /api/assessments/:id/faint    { answer, afterNoResponse?, testId? }: sf_faint_loc after a
 *                                      faint or fall stop (Q33 (3), O42)
 *   POST /api/assessments/:id/alarm    { kind: no_response | help_requested, testId? }: the anonymous
 *                                      count of a check in alarm or help request (Q25, O34-5)
 *   POST /api/assessments/:id/resume   { answers }: the O6 re-ask within 30 minutes
 *
 * Only the dates of the data map are kept (changeReported); every answer itself is used today and
 * discarded (spec 2.1 "Used today only"). Counts carry no user id (Q25 (a)).
 */
import type { Route } from "../../http/types";
import {
  endOfCheck,
  endOfCheckChronicNote,
  endOfCheckForm,
  evaluateResume,
  faintFollowUp,
  riyadhDate,
} from "../../../src/medical/precheck";
import type { Side } from "../../../src/movements/types";
import { activeConsent } from "../consents/store";
import { symptomAsk } from "../progress/series";
import {
  STOPPED_FLAG,
  applyLock,
  emergencyAlsoShow,
  homeClosed,
  isStale,
  openCheck,
  ownCheck,
  runningEnv,
  skipRecord,
} from "./common";
import { ID_PATH, remainingItems } from "./routes";
import { checkContextOf, personState, seriesContext } from "./state";
import {
  DAY_MS,
  closeCheck,
  countSafetyEvent,
  finishCheck,
  keptResults,
  reportChange,
  resultsOf,
  saveResult,
  touch,
  transaction,
} from "./store";
import {
  ALARM_KINDS,
  END_ANSWERS,
  FAINT_ANSWERS,
  checkAnswers,
  checkTestRef,
  unknownKeys,
  type AlarmKind,
} from "./validate";

/** Alarm posts counted per check and day: an alarm can fire more than once, never without bound. */
// SPEC-GAP: alarm-count-bound. Q25 gives no bound; 20 alarm counts per check and day, in memory.
const ALARMS_PER_CHECK = 20;

const path = (tail: string) => new RegExp(`^/api/assessments/${ID_PATH}/${tail}$`);

export const followUpRoutes: Route[] = [
  {
    method: "GET",
    path: path("end"),
    auth: "user",
    handle(ctx) {
      const { db, user, json } = ctx;
      const a = ownCheck(ctx);
      if (!a) return;
      if (a.status === "abandoned") return json(409, { error: "NOT_OPEN", status: a.status });
      const s = personState(db, user!.id, Date.now());
      const env = runningEnv(ctx, a);
      if (!s || !env) return json(409, { error: "PLAN_REQUIRED" });
      // Q23 (7): the side form when the one sided large drop trigger fires on today's results
      // (progress.largeDrop.oneSidedRule, whatever the quality flags).
      const asked = symptomAsk(keptResults(db, user!.id, a.id), a.id, (position) =>
        seriesContext(checkContextOf(s.intake, s.plan, position), a.setup),
      );
      const form = endOfCheckForm(asked.flatMap((x) => x.sides as Side[]));
      json(200, { question: form.id, side: form.side ?? null, chronicNote: endOfCheckChronicNote(env) });
    },
  },
  {
    method: "POST",
    path: path("end"),
    auth: "user",
    handle(ctx) {
      const { db, user, body, json, limited } = ctx;
      const a = ownCheck(ctx);
      if (!a) return;
      if (unknownKeys(body, ["answer"]).length) return json(400, { error: "END_INVALID", field: "body" });
      if (!(END_ANSWERS as readonly unknown[]).includes(body.answer))
        return json(400, { error: "END_INVALID", field: "answer" });
      const now = Date.now();
      // Asked whenever the results are first shown (O6 (4)): a stale open check closes first.
      let status = a.status;
      if (status === "open" && isStale(a, now)) status = closeCheck(db, a, "stale", a.active);
      if (status !== "open" && status !== "ended_early") return json(409, { error: "NOT_OPEN", status });
      const out = endOfCheck(body.answer, now);
      if (out.status !== "emergency") return json(200, { status: "proceed" });
      const env = runningEnv(ctx, a);
      // SPEC-GAP: end-count-once. An open check completes here, so the question cannot be answered
      // twice; after a check ended early the count is kept once per check by the in memory limiter.
      const first = status === "open" || !limited(`end-yes:${a.id}`, 1, DAY_MS);
      const lock = transaction(db, () => {
        if (typeof out.stored.changeReported === "string")
          reportChange(db, user!.id, out.stored.changeReported);
        if (first) countSafetyEvent(db, "end:symptoms", "none", a.setting, now);
        // SPEC-GAP: ec-yes-status. The check's tests are done and its results stay stored (UX 2.7:
        // "results held"), so an open check completes; one that ended early stays ended early.
        // A check without any stored result or skip starts no clock: it is closed, not completed.
        if (status === "open") {
          if (resultsOf(db, a.id).length) finishCheck(db, a, "completed", now, null);
          else closeCheck(db, a, "stop", now);
        }
        return applyLock(ctx, out.lock, now);
      });
      json(200, {
        status: "emergency",
        screen: out.screen ?? "scr_emergency",
        alsoShow: emergencyAlsoShow(env),
        lock,
      });
    },
  },
  {
    method: "POST",
    path: path("faint"),
    auth: "user",
    handle(ctx) {
      const { db, user, body, json, limited } = ctx;
      const a = ownCheck(ctx);
      if (!a) return;
      if (unknownKeys(body, ["answer", "afterNoResponse", "testId"]).length)
        return json(400, { error: "FAINT_INVALID", field: "body" });
      if (!(FAINT_ANSWERS as readonly unknown[]).includes(body.answer))
        return json(400, { error: "FAINT_INVALID", field: "answer" });
      if (body.afterNoResponse !== undefined && typeof body.afterNoResponse !== "boolean")
        return json(400, { error: "FAINT_INVALID", field: "afterNoResponse" });
      const ref = checkTestRef(body, a.protocol, false);
      if (!ref.ok) return json(400, { error: "FAINT_INVALID", field: ref.field });
      const now = Date.now();
      // sf_faint_loc follows a faint or fall stop, which ends the check the same day (Q33 (3), O42).
      // SPEC-GAP: faint-after-stop. Which stop ended the check is not stored (Q25 (d)), so any stop
      // that ended it today is accepted.
      if (a.status !== "ended_early" || a.endedReason !== "stop" || riyadhDate(a.started) !== riyadhDate(now))
        return json(409, { error: "NOT_STOPPED" });
      const out = faintFollowUp(body.answer, now, { afterNoResponse: body.afterNoResponse === true });
      const first = !limited(`faint:${a.id}`, 1, DAY_MS);
      const lock = transaction(db, () => {
        if (typeof out.stored.changeReported === "string")
          reportChange(db, user!.id, out.stored.changeReported);
        if (first)
          countSafetyEvent(db, `faint_loc:${body.answer}`, ref.value?.testId ?? "none", a.setting, now);
        return applyLock(ctx, out.lock, now);
      });
      json(200, {
        status: out.status,
        screen: out.screen ?? null,
        alsoShow: out.status === "emergency" ? emergencyAlsoShow(runningEnv(ctx, a)) : [],
        lock,
      });
    },
  },
  {
    method: "POST",
    path: path("alarm"),
    auth: "user",
    handle(ctx) {
      const { db, body, json, limited } = ctx;
      const a = ownCheck(ctx);
      if (!a) return;
      if (unknownKeys(body, ["kind", "testId"]).length)
        return json(400, { error: "ALARM_INVALID", field: "body" });
      if (!(ALARM_KINDS as readonly unknown[]).includes(body.kind))
        return json(400, { error: "ALARM_INVALID", field: "kind" });
      const ref = checkTestRef(body, a.protocol, false);
      if (!ref.ok) return json(400, { error: "ALARM_INVALID", field: ref.field });
      // The check in runs during the check and in the home fall watch after a stop (O42).
      if (a.status !== "open" && a.status !== "ended_early")
        return json(409, { error: "NOT_OPEN", status: a.status });
      const now = Date.now();
      if (!limited(`alarm:${a.id}`, ALARMS_PER_CHECK, DAY_MS))
        countSafetyEvent(db, `alarm:${body.kind as AlarmKind}`, ref.value?.testId ?? "none", a.setting, now);
      json(200, { recorded: true });
    },
  },
  {
    method: "POST",
    path: path("resume"),
    auth: "user",
    handle(ctx) {
      const { db, user, body, json } = ctx;
      if (unknownKeys(body, ["answers"]).length) return json(400, { error: "RESUME_INVALID", field: "body" });
      const answers = checkAnswers(body.answers);
      if (!answers.ok) return json(400, { error: "RESUME_INVALID", field: "answers" });
      const own = ownCheck(ctx);
      if (!own || homeClosed(ctx, own.setting)) return;
      // SPEC-GAP: resume-after-safety. O6 (1) allows no resume after a safety screen (S36 to S40) or
      // an alarm (S45). Stops and postpones end the check here; an alarm is only counted (Q25 (d)
      // keeps no per person record), so the client must not offer the resume after one.
      const a = openCheck(ctx, { today: true });
      if (!a) return;
      if (!activeConsent(db, user!.id, "movement_check")) return json(403, { error: "CONSENT_REQUIRED" });
      const env = runningEnv(ctx, a);
      if (!env) return json(409, { error: "PLAN_REQUIRED" });
      const now = Date.now();
      const remaining = remainingItems(db, a);
      const outcome = evaluateResume(
        env,
        answers.value,
        remaining.map((i) => ({ testId: i.testId, helperRequired: i.helperRequired === true })),
        now,
      );
      if (outcome.status === "incomplete") return json(400, { error: "RESUME_INCOMPLETE" });
      if (outcome.status !== "proceed") {
        // O6 (2): a postpone or an emergency closes the check as ended early, finished results kept.
        const lock = transaction(db, () => {
          if (typeof outcome.stored.changeReported === "string")
            reportChange(db, user!.id, outcome.stored.changeReported);
          countSafetyEvent(db, `precheck:${outcome.reason}`, "precheck", a.setting, now);
          finishCheck(db, a, "ended_early", now, "stop");
          return applyLock(ctx, outcome.lock, now);
        });
        return json(409, {
          error: "POSTPONE",
          status: outcome.status,
          reason: outcome.reason,
          screen: outcome.screen,
          alsoShow: outcome.alsoShow ?? [],
          lock,
        });
      }
      // The new skips of the remaining tests (pain today, a helper not there) are stored like the
      // between tests skips; the finished tests keep their results (O6 (3)).
      const skips = outcome.skips.filter((k) =>
        remaining.some((i) => i.testId === k.testId && i.side === k.side),
      );
      transaction(db, () => {
        for (const k of skips) {
          const item = remaining.find((i) => i.testId === k.testId && i.side === k.side)!;
          saveResult(db, user!.id, skipRecord(a, item, k.reason, now), a.setting);
        }
        touch(db, a.id, now);
      });
      json(200, {
        status: "proceed",
        skips,
        warnings: outcome.warnings,
        helperRequired: outcome.helperRequired,
        checkIn: outcome.checkIn ?? null,
      });
    },
  },
];

export { STOPPED_FLAG };
