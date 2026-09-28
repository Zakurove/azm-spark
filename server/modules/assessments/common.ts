/**
 * Helpers shared by the movement check routes (routes.ts and follow-up.ts): the owner's check with
 * the O6 window, the lock record and its {when}, the environment of a running check, and the rows
 * the server writes itself.
 */
import type { RouteContext } from "../../http/types";
import type { ProtocolItem } from "../../../src/medical/assessment";
import {
  lockRecord,
  pausedWhen,
  riyadhDate,
  type CheckLock,
  type PrecheckEnv,
  type TestInstance,
} from "../../../src/medical/precheck";
import { seriesKey } from "../../../src/medical/progress-rules";
import { testDef } from "../../../src/movements/assessments";
import type { LockKind } from "../../../src/movements/types";
import { homeChecksOpen } from "../booth/config";
import { checkContextOf } from "./state";
import {
  closeCheck,
  currentLock,
  ownAssessment,
  profileOf,
  setLock,
  type Assessment,
  type LockRecord,
  type ResultRecord,
} from "./store";

/** O6 (1), (4): a check resumes only within 30 minutes of its last activity; then it closes. */
export const RESUME_WINDOW_MS = 30 * 60 * 1000;

/** The server's flag on the skip row of a test stopped from the stop list (resultOnStop). */
export const STOPPED_FLAG = "stopped";

/** SCI conditions: the AD steps join the emergency screen for every one of them (O12 (1)). */
const SCI_CONDITIONS = ["sci_complete", "sci_incomplete"];

export interface LockView extends LockRecord {
  /** {when} of scr_paused_today (Q25 (e), Q33 (4)): the line and, for the clock forms, the time. */
  when: ReturnType<typeof pausedWhen>;
}

/**
 * A lock as the client sees it. `kind` is known where the lock was just set; a stored lock keeps no
 * reason and no kind (Q25 (c)), so it reads as a next day lock, whose lines for a lock ending today
 * ("after {time}") are the ones of a 60 minute lock on return.
 */
// SPEC-GAP: lock-when-kind. The kind of a stored lock is not kept (a 60 minute lock names MS or
// Parkinson's); pausedWhen is given next_day on return, which reads the same for either kind.
export function lockView(
  lock: LockRecord,
  now: number,
  shown: "start" | "return",
  kind?: LockKind,
): LockView {
  return {
    until: lock.until,
    releasableByClearance: lock.releasableByClearance,
    when: pausedWhen({ kind: kind ?? "next_day", until: lock.until }, now, shown),
  };
}

/**
 * Sets a lock from a pre-check, stop or follow up outcome and returns the person's lock after the
 * merge (setLock keeps the later end), as the client should show it. Null when there is no lock.
 */
export function applyLock(
  ctx: RouteContext,
  lock: CheckLock | null | undefined,
  now: number,
): LockView | null {
  const record = lock ? lockRecord(lock, now) : null;
  if (!record || !lock?.until) return null;
  setLock(ctx.db, ctx.user!.id, record, now);
  const merged = currentLock(ctx.db, ctx.user!.id, now) ?? record;
  return lockView(merged, now, "start", merged.until === record.until ? lock.until : undefined);
}

/** The owner's check (404 NOT_FOUND for another person's), whatever its status. */
export function ownCheck(ctx: RouteContext): Assessment | null {
  const a = ownAssessment(ctx.db, ctx.params.id, ctx.user!.id);
  if (!a) ctx.json(404, { error: "NOT_FOUND" });
  return a;
}

/**
 * Whether an open check has gone stale: its last activity is more than 30 minutes ago (O6), or it
 * started on an earlier calendar day in Riyadh (the pre-check is today's go or no go decision).
 */
// SPEC-GAP: stale-open-check. The day rule of round 2 stays beside the O6 window; both close the
// check as ended early with its finished results kept (O6 (4)), or abandoned without results.
export function isStale(a: Assessment, now: number): boolean {
  return now - a.active > RESUME_WINDOW_MS || riyadhDate(a.started) !== riyadhDate(now);
}

/**
 * The owner's open check, or the error already sent (404 for another person's check).
 *
 * `today` (results, between tests, complete, resume): a stale check (isStale) is closed first and
 * refused with 409 NOT_OPEN and its new status, and a same day lock refuses the check (409 LOCKED).
 * The stop list passes `today: false`, so a safety stop always reaches the check.
 */
export function openCheck(ctx: RouteContext, { today }: { today: boolean }): Assessment | null {
  const a = ownCheck(ctx);
  if (!a) return null;
  if (a.status === "open" && today) {
    const now = Date.now();
    if (isStale(a, now)) {
      const status = closeCheck(ctx.db, a, "stale", a.active);
      ctx.json(409, { error: "NOT_OPEN", status });
      return null;
    }
    const lock = currentLock(ctx.db, a.userId, now);
    if (lock) {
      ctx.json(409, { error: "LOCKED", ...lockView(lock, now, "return") });
      return null;
    }
  }
  if (a.status !== "open") {
    ctx.json(409, { error: "NOT_OPEN", status: a.status });
    return null;
  }
  return a;
}

/** Contract v3 I: a home check needs AZM_CHECK_HOME=1 (403 HOME_CLOSED is sent otherwise). */
export function homeClosed(ctx: RouteContext, setting: string): boolean {
  if (setting !== "home" || homeChecksOpen()) return false;
  ctx.json(403, { error: "HOME_CLOSED" });
  return true;
}

/** The environment of a running check for the stop list and the re-ask: its position, setup and setting. */
export function runningEnv(ctx: RouteContext, a: Assessment): PrecheckEnv | null {
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

/** scr_ad joins scr_emergency for every SCI condition or an SCI level at T6 or above (O12 (1)). */
export function emergencyAlsoShow(env: PrecheckEnv | null): "scr_ad"[] {
  if (!env) return [];
  const sci = env.ctx.conditions.some((c) => SCI_CONDITIONS.includes(c)) || env.setup?.sciT6 === true;
  return sci ? ["scr_ad"] : [];
}

export function instanceOf(item: ProtocolItem): TestInstance {
  const t: TestInstance = { testId: item.testId, side: item.side };
  if (item.variant) t.variant = item.variant;
  if (item.pushHand) t.pushHand = item.pushHand;
  return t;
}

/** A skip result the server writes for a protocol item: no score, no attempts. */
export function skipRecord(
  a: Assessment,
  item: ProtocolItem,
  reason: string,
  now: number,
  flags: string[] = [],
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
    flags,
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
