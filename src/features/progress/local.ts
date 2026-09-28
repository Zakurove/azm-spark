/**
 * Comparisons on the phone (contract D): the same series views the server builds for GET
 * /api/progress (seriesViews, which runs compareSeries), from results the phone already holds:
 *   - the read only view of one earlier check on My results (S53 history rows open the S52 view of
 *     that check), from GET /api/assessments;
 *   - the example page (S54), from its bundled fixture.
 * So a verdict shown here is always one the rules would give (S54, D-008).
 */
import type { CheckContext, StoredSetup } from "../../medical/assessment";
import type { SeriesContext, StoredResult } from "../../medical/progress-rules";
import type { CheckPosition, TestUnit } from "../../movements/types";
import { seriesViews } from "../../../server/modules/progress/series";
import type { StoredCheck } from "../assessment/api";
import type { SeriesViewLike } from "./series";

/** The series context of the person (the server's seriesContext): their check context and setup. */
export function seriesContextOf(
  ctx: Pick<CheckContext, "position" | "support" | "conditions" | "pain">,
  setup: StoredSetup | null | undefined,
): (position: CheckPosition) => SeriesContext {
  return (position) => ({
    position,
    support: ctx.support,
    conditions: ctx.conditions,
    pain: ctx.pain,
    setup: setup ?? null,
  });
}

/**
 * The stored results of the listed checks (completed or ended early) as the progress rules read them.
 * The list does not carry the check position, so the person's current position stands in.
 */
// SPEC-GAP: history-position. GET /api/assessments sends no position per result; the series key
// (from the server) already separates positions, and the current position only feeds the wide band
// rule of a wheelchair arm raise.
export function storedResultsOf(
  checks: readonly StoredCheck[],
  position: CheckPosition,
  setup: StoredSetup | null | undefined,
): StoredResult[] {
  return checks
    .filter((c) => c.status === "completed" || c.status === "ended_early")
    .flatMap((c) =>
      c.results.map((r): StoredResult => ({
        testId: r.testId,
        side: r.side,
        value: r.skippedReason ? null : r.value,
        unit: r.unit as TestUnit,
        created: r.created,
        setting: c.setting,
        seriesKey: r.seriesKey,
        detail: r.detail,
        flags: r.flags,
        nValid: r.nValid,
        median: r.median,
        poseModel: r.poseModel,
        movementVersion: r.movementVersion,
        band: r.band === "wide" ? "wide" : "default",
        position,
        variant: r.variant,
        ...(setup?.limbLoss ? { limbLoss: setup.limbLoss } : {}),
      })),
    );
}

/**
 * The series views of one check as they stood after it (the S52 view of that check, read only): every
 * series compared up to that check's results, keeping the series that check measured.
 */
export function viewsAsOf(
  results: readonly StoredResult[],
  check: Pick<StoredCheck, "results">,
  ctxFor: (position: CheckPosition) => SeriesContext,
): SeriesViewLike[] {
  const last = Math.max(0, ...check.results.map((r) => r.created));
  const upTo = results.filter((r) => r.created <= last);
  const own = new Set(
    check.results.filter((r) => r.skippedReason === null).map((r) => `${r.testId}:${r.side}`),
  );
  return seriesViews(upTo, ctxFor, { lastCheckLasting: false }).filter(
    (v) =>
      v.current && own.has(`${v.testId}:${v.side}`) && check.results.some((r) => r.created === v.latest.date),
  );
}
