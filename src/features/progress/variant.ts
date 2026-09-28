/**
 * The S01 entry card variant (UX spec S01, H9, Q12 (2), Q31 (6), O6), pure: from the context
 * (GET /api/assessments/context), the progress (GET /api/progress) and the list of checks
 * (GET /api/assessments), the first matching row of the S01 table wins:
 *
 *   1 blocked      clinical review reasons (mobility bed: the card is hidden)
 *   2 homeSoon     home checks closed and this tab not in booth mode (no start control)
 *   3 locked       a lock that has not ended (the care team release when releasable)
 *   4 resume       an open check within its 30 minutes, never after a safety screen (O6)
 *   5 followUp     the next day question is due: S03 above the card, then the rows below
 *   6 first        no completed home check, and 48 hours since any booth check
 *   7 leanRepeat   the side lean only session window (Q12 (2))
 *   8 due          the re-test is due today or earlier
 *   9 repeatOffer  2 to 7 days after a lower, large drop or not comparable result (H9)
 *  10 tooSoon      less than 48 hours since the last completed check
 *  11 upcoming     otherwise, with the H9 early start
 */
import { estimateMinutes, REPEAT_OFFER_DAYS } from "../../medical/assessment";
import { riyadhDate } from "../../medical/precheck";
import type { TestId } from "../../movements/types";
import {
  resumeCheckOf,
  type ContextResponse,
  type LockWhen,
  type ProgressResponse,
  type StoredCheck,
} from "../assessment/api";
import type { ResumeCheck } from "../assessment/flowMachine";

export type EntryVariant =
  | "blocked"
  | "homeSoon"
  | "locked"
  | "resume"
  | "first"
  | "leanRepeat"
  | "due"
  | "repeatOffer"
  | "tooSoon"
  | "upcoming";

/** What a start from the card asks the check to open (S01 interactions, O6, Q12 (2)). */
export interface CheckStartOptions {
  /** Q12 (2): the side lean only session of leanRepeat. */
  session?: "side_lean_only";
  /** O6: the open check to continue. */
  resume?: ResumeCheck;
  /** The care team release of a lock (S01 locked): the pre-check starts at pc_change_cleared. */
  release?: boolean;
}

export interface EntryState {
  /** Null: no card (mobility bed, no plan yet). */
  variant: EntryVariant | null;
  /** S03 shows above the card (ac_next_day due). */
  followUp: boolean;
  /** Today's check ended early (the extra line with its results link). */
  endedEarlyToday: boolean;
  /** Minutes of the first check (estimateMinutes of the base tests at home, O40). */
  minutes: [number, number] | null;
  /** H9 dates: the next due date, the repeat or side lean window, the earliest next check. */
  dates: { next?: number; from?: number; to?: number; earliest?: number };
  /** The {when} of a lock (Q33 (4)) and whether the care team answer releases it. */
  lock: { when: LockWhen | null; releasable: boolean } | null;
  /** O6: the open check and where it stopped. */
  resume: { check: ResumeCheck; n: number; total: number } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EntryInputs {
  context: ContextResponse;
  progress: ProgressResponse | null;
  checks: readonly StoredCheck[] | null;
  /** This tab is in verified booth mode. */
  booth: boolean;
  now: number;
  /** O6 (1): never resume a check that had a safety screen or an alarm on this device. */
  resumeAllowed(checkId: string): boolean;
}

/** Where an open check stopped: the first test with a side not done, of the tests that run. */
export function resumePoint(check: ResumeCheck): { n: number; total: number } {
  const tests: TestId[] = [];
  for (const item of [...check.protocol].sort((a, b) => a.order - b.order)) {
    if (item.skipped || tests.includes(item.testId)) continue;
    tests.push(item.testId);
  }
  const done = (testId: TestId) =>
    check.protocol
      .filter((p) => p.testId === testId && !p.skipped)
      .every((p) => check.outcomes[`${p.testId}:${p.side}`] !== undefined);
  const at = tests.findIndex((id) => !done(id));
  return { n: at < 0 ? tests.length : at + 1, total: tests.length };
}

/**
 * The repeat offer window (H9): the newest current home series with repeatOffer (the server leaves
 * it out while a lasting next day answer is unresolved), 2 to 7 days after that result.
 */
export function repeatWindow(progress: ProgressResponse | null): { from: number; to: number } | null {
  const views = (progress?.tests ?? []).filter((v) => v.current && v.setting === "home" && v.repeatOffer);
  if (views.length === 0) return null;
  const last = Math.max(...views.map((v) => v.latest.date));
  return { from: last + REPEAT_OFFER_DAYS[0] * DAY_MS, to: last + REPEAT_OFFER_DAYS[1] * DAY_MS };
}

/** Today's check (Asia/Riyadh) ended early with results kept. */
export function endedEarlyToday(checks: readonly StoredCheck[] | null, now: number): boolean {
  const today = riyadhDate(now);
  return (checks ?? []).some(
    (c) =>
      c.status === "ended_early" && riyadhDate(c.completed ?? c.started) === today && c.results.length > 0,
  );
}

export function entryState(i: EntryInputs): EntryState {
  const c = i.context;
  const now = i.now;
  const out: EntryState = {
    variant: null,
    followUp: false,
    endedEarlyToday: endedEarlyToday(i.checks, now),
    minutes: null,
    dates: {},
    lock: null,
    resume: null,
  };
  // 1: blocked; mobility bed hides the card entirely (S01 table).
  if (c.blocked) {
    out.variant = c.blocked === "unsupported_position" ? null : "blocked";
    out.endedEarlyToday = false;
    return out;
  }
  // 2: home checks closed and not in booth mode (Q31 (6)).
  if (!c.homeOpen && !i.booth) {
    out.variant = "homeSoon";
    out.endedEarlyToday = false;
    return out;
  }
  // 3: a lock that has not ended; the reason is never known here (Q25 (c)).
  if (c.lock && c.lock.until > now) {
    out.variant = "locked";
    out.lock = { when: c.lock.when ?? null, releasable: c.lock.releasableByClearance === true };
    return out;
  }
  // 4: an open check that may still resume (O6).
  const open = c.openCheck;
  if (open && open.resumeUntil > now && i.resumeAllowed(open.id)) {
    const check = resumeCheckOf(open, i.checks ?? []);
    if (check) {
      out.variant = "resume";
      out.resume = { check, ...resumePoint(check) };
      return out;
    }
  }
  // 5: the next day question shows above the card, then the rows below apply.
  out.followUp = c.followUpDue === true;
  const earliest = c.earliestNext ?? null;
  const canStart = earliest === null || now >= earliest;
  if (earliest !== null) out.dates.earliest = earliest;
  const due = c.retestDue ?? i.progress?.retestDue ?? null;
  if (due !== null) out.dates.next = due;
  // 6: no completed home check yet, and 48 hours since any booth check.
  if (c.firstCheck && canStart) {
    out.variant = "first";
    out.minutes = estimateMinutes(c.baseTests as TestId[], c.ctx ?? null, "home");
    return out;
  }
  // 7: the side lean only session (Q12 (2)); the server offers it only inside its window.
  const lean = c.sideLeanRepeat;
  if (lean && now >= lean.from && now <= lean.to && canStart) {
    out.variant = "leanRepeat";
    out.dates.from = lean.from;
    out.dates.to = lean.to;
    return out;
  }
  // 8: due today or earlier.
  if (due !== null && due <= now && canStart) {
    out.variant = "due";
    return out;
  }
  // 9: the repeat offer after a lower, large drop or not comparable result.
  const repeat = repeatWindow(i.progress);
  if (repeat && now >= repeat.from && now <= repeat.to && canStart) {
    out.variant = "repeatOffer";
    out.dates.from = repeat.from;
    out.dates.to = repeat.to;
    return out;
  }
  // 10: less than 48 hours since the last completed check.
  if (!canStart) {
    out.variant = "tooSoon";
    return out;
  }
  // 11: otherwise the next date, with the early start (H9).
  out.variant = "upcoming";
  return out;
}

/** Variants whose primary action starts a check now (the empty state of S53 follows them). */
export function canStartFrom(variant: EntryVariant | null): boolean {
  return variant === "first" || variant === "due" || variant === "leanRepeat" || variant === "repeatOffer";
}
