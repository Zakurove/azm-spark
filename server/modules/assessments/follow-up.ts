/**
 * The movement check routes that follow a test or a stop (council decisions Q23, Q33, O6):
 *
 *   GET  /api/assessments/:id/end      the form of the end of check question (Q23 (7)): general, or
 *                                      the side form after a one sided large drop; the O37 line
 *   POST /api/assessments/:id/answer   one path for two answers, so no URL path shows that a
 *                                      safety event happened (Q25 (a): reason codes never in URLs or
 *                                      request logs); the question is in the body:
 *     { question: "end", answer: yes | no }   the end of check question: yes opens scr_emergency,
 *                                      stores changeReported, locks the day and closes an open check
 *                                      as completed (its results stay stored)
 *     { question: "faint", answer, testId? }   sf_faint_loc after a faint or fall stop (Q33 (3), O42)
 *   POST /api/assessments/:id/resume   { answers }: the O6 re-ask within 30 minutes
 *
 * Only the dates of the data map are kept (changeReported); every answer itself is used today and
 * discarded (spec 2.1 "Used today only"). Counts carry no user id (Q25 (a)).
 */
import type { Route, RouteContext } from "../../http/types";
import {
  endOfCheck,
  endOfCheckChronicNote,
  endOfCheckForm,
  evaluateResume,
  faintFollowUp,
} from "../../../src/medical/precheck";
import type { Side } from "../../../src/movements/types";
import { activeConsent } from "../consents/store";
import { symptomAsk } from "../../../src/medical/series";
import {
  SAFETY_LATE_MS,
  STOPPED_FLAG,
  applyLock,
  emergencyAlsoShow,
  homeClosed,
  openCheck,
  ownCheck,
  runningEnv,
  safetyCheck,
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
import { END_ANSWERS, FAINT_ANSWERS, checkAnswers, checkTestRef, unknownKeys } from "./validate";

const path = (tail: string) => new RegExp(`^/api/assessments/${ID_PATH}/${tail}$`);

type Handler = (ctx: RouteContext) => void;

/** POST /:id/answer: the end and faint answers by `question` (see the header). */
function answerRoute(handlers: Record<"end" | "faint", Handler>): Route {
  return {
    method: "POST",
    path: path("answer"),
    auth: "user",
    handle(ctx) {
      const { question, ...rest } = ctx.body as Record<string, unknown>;
      if (question !== "end" && question !== "faint")
        return ctx.json(400, { error: "ANSWER_INVALID", field: "question" });
      handlers[question]({ ...ctx, body: rest });
    },
  };
}

/** { question: "end" }: the end of check question (Q23 (7)). */
function endAnswer(ctx: RouteContext): void {
  const { db, user, body, json, limited } = ctx;
  if (unknownKeys(body, ["answer"]).length) return json(400, { error: "END_INVALID", field: "body" });
  if (!(END_ANSWERS as readonly unknown[]).includes(body.answer))
    return json(400, { error: "END_INVALID", field: "answer" });
  // Asked whenever the results are first shown (O6 (4)): a stale open check closes first, and a
  // check the server closed meanwhile (any status) still takes the answer (safetyCheck), so a yes
  // stores changeReported and the day's lock.
  const found = safetyCheck(ctx);
  if (!found) return;
  const { a } = found;
  const status = a.status;
  const now = Date.now();
  const out = endOfCheck(body.answer, now);
  if (out.status !== "emergency") return json(200, { status: "proceed" });
  const env = runningEnv(ctx, a);
  // SPEC-GAP: end-count-once. Counted once per check by the in memory limiter (a server restart
  // may count a repeated post again): Q25 keeps no per person record of the answer.
  const first = !limited(`end-yes:${a.id}`, 1, DAY_MS);
  const lock = transaction(db, () => {
    if (typeof out.stored.changeReported === "string") reportChange(db, user!.id, out.stored.changeReported);
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
}

/** { question: "faint" }: sf_faint_loc after a faint or fall stop (Q33 (3), O42). */
function faintAnswer(ctx: RouteContext): void {
  const { db, user, body, json, limited } = ctx;
  const a = ownCheck(ctx);
  if (!a) return;
  if (unknownKeys(body, ["answer", "testId"]).length)
    return json(400, { error: "FAINT_INVALID", field: "body" });
  if (!(FAINT_ANSWERS as readonly unknown[]).includes(body.answer))
    return json(400, { error: "FAINT_INVALID", field: "answer" });
  const ref = checkTestRef(body, a.protocol, false);
  if (!ref.ok) return json(400, { error: "FAINT_INVALID", field: ref.field });
  const now = Date.now();
  // sf_faint_loc follows a faint or fall stop, which ends the check (Q33 (3), O42), also a check the
  // server had closed before the stop reached it (stopClosedCheck), within SAFETY_LATE_MS.
  // SPEC-GAP: faint-after-stop. Which stop ended the check is not stored (Q25 (d)), so any stop
  // that ended it in the last day is accepted.
  const stopped = a.status === "ended_early" || a.status === "abandoned";
  if (!stopped || a.endedReason !== "stop" || now - a.active > SAFETY_LATE_MS)
    return json(409, { error: "NOT_STOPPED" });
  const out = faintFollowUp(body.answer, now);
  const first = !limited(`faint:${a.id}`, 1, DAY_MS);
  const lock = transaction(db, () => {
    if (typeof out.stored.changeReported === "string") reportChange(db, user!.id, out.stored.changeReported);
    if (first) countSafetyEvent(db, `faint_loc:${body.answer}`, ref.value?.testId ?? "none", a.setting, now);
    return applyLock(ctx, out.lock, now);
  });
  json(200, {
    status: out.status,
    screen: out.screen ?? null,
    alsoShow: out.status === "emergency" ? emergencyAlsoShow(runningEnv(ctx, a)) : [],
    lock,
  });
}

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
  answerRoute({ end: endAnswer, faint: faintAnswer }),
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
      // O6 (1): no resume after a safety screen (S36 to S40): stops and postpones end the check here.
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
      });
    },
  },
];

export { STOPPED_FLAG };
