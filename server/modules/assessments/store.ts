/**
 * Database access for the movement check (tables of migration 002). Rows go in and out as typed
 * records; JSON columns are parsed here. Nothing here logs, and nothing reads raw pre-check answers,
 * which never reach the database.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { testDef } from "../../../src/movements/assessments";
import type { CheckPosition, Setting, Side, TestId, TestUnit } from "../../../src/movements/types";
import type { Intake, Plan } from "../../../src/medical/plan";
import type { ProtocolItem, StoredSetup } from "../../../src/medical/assessment";
import { riyadhDate } from "../../../src/medical/precheck";
import { groupBySeries, type StoredResult } from "../../../src/medical/progress-rules";
import type { Attempt, Device, DetailValue, PoseModel } from "./validate";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type AssessmentStatus = "open" | "completed" | "ended_early" | "abandoned";
/** Statuses whose results are kept and shown (spec 4.0: results before an ending stop are kept). */
export const KEPT_STATUSES: readonly AssessmentStatus[] = ["completed", "ended_early"];

/** Kept with the check besides the frozen protocol: what the series key and the rules read later. */
export interface SeriesMeta {
  position: CheckPosition;
  poseModel: PoseModel;
  /** The intake version (profiles.version) the setup was answered under. */
  intakeVersion: number;
}

export interface Assessment {
  id: string;
  userId: string;
  kind: "baseline" | "retest";
  setting: Setting;
  status: AssessmentStatus;
  meta: SeriesMeta;
  setup: StoredSetup;
  protocol: ProtocolItem[];
  precheck: Record<string, unknown>;
  device: Device;
  started: number;
  completed: number | null;
  endedReason: string | null;
}

interface AssessmentRow {
  id: string;
  user_id: string;
  kind: "baseline" | "retest";
  setting: Setting;
  status: AssessmentStatus;
  series_meta: string;
  setup: string;
  protocol: string;
  precheck: string;
  device: string;
  started: number;
  completed: number | null;
  ended_reason: string | null;
}

function toAssessment(r: AssessmentRow): Assessment {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    setting: r.setting,
    status: r.status,
    meta: JSON.parse(r.series_meta),
    setup: JSON.parse(r.setup),
    protocol: JSON.parse(r.protocol),
    precheck: JSON.parse(r.precheck),
    device: JSON.parse(r.device),
    started: Number(r.started),
    completed: r.completed === null ? null : Number(r.completed),
    endedReason: r.ended_reason,
  };
}

/** The stored intake and plan of a person (plan with its version), or null before the intake. */
export function profileOf(
  db: DatabaseSync,
  userId: string,
): { intake: Intake; plan: Plan & { version: number } } | null {
  const p = db.prepare("SELECT intake, plan, version FROM profiles WHERE user_id=?").get(userId) as
    { intake: string; plan: string; version: number } | undefined;
  if (!p) return null;
  return { intake: JSON.parse(p.intake), plan: { ...JSON.parse(p.plan), version: Number(p.version) } };
}

/** One check of this person, or null (another person's check reads as missing). */
export function ownAssessment(db: DatabaseSync, id: string, userId: string): Assessment | null {
  const r = db.prepare("SELECT * FROM assessments WHERE id=? AND user_id=?").get(id, userId) as
    AssessmentRow | undefined;
  return r ? toAssessment(r) : null;
}

export function listAssessments(db: DatabaseSync, userId: string): Assessment[] {
  const rows = db
    .prepare("SELECT * FROM assessments WHERE user_id=? ORDER BY started DESC, rowid DESC")
    .all(userId) as unknown as AssessmentRow[];
  return rows.map(toAssessment);
}

/** The last completed check, in one setting or in any. */
export function lastCompleted(db: DatabaseSync, userId: string, setting?: Setting): Assessment | null {
  const r = (
    setting
      ? db
          .prepare(
            "SELECT * FROM assessments WHERE user_id=? AND status='completed' AND setting=? ORDER BY completed DESC, rowid DESC LIMIT 1",
          )
          .get(userId, setting)
      : db
          .prepare(
            "SELECT * FROM assessments WHERE user_id=? AND status='completed' ORDER BY completed DESC, rowid DESC LIMIT 1",
          )
          .get(userId)
  ) as AssessmentRow | undefined;
  return r ? toAssessment(r) : null;
}

/** The newest check of any status: every stored check passed its pre-check, so its setup holds. */
export function latestAssessment(db: DatabaseSync, userId: string): Assessment | null {
  const r = db
    .prepare("SELECT * FROM assessments WHERE user_id=? ORDER BY started DESC, rowid DESC LIMIT 1")
    .get(userId) as AssessmentRow | undefined;
  return r ? toAssessment(r) : null;
}

export interface NewAssessment {
  userId: string;
  kind: "baseline" | "retest";
  setting: Setting;
  meta: SeriesMeta;
  setup: StoredSetup;
  protocol: ProtocolItem[];
  precheck: Record<string, unknown>;
  device: Device;
  started: number;
}

/** Stores a new open check; any other open check of the person is abandoned. Returns the id. */
export function createAssessment(db: DatabaseSync, a: NewAssessment): string {
  const id = randomUUID();
  db.prepare(
    "UPDATE assessments SET status='abandoned', ended_reason='replaced' WHERE user_id=? AND status='open'",
  ).run(a.userId);
  db.prepare(
    "INSERT INTO assessments(id,user_id,kind,setting,status,series_meta,setup,protocol,precheck,device,started,completed,ended_reason) VALUES(?,?,?,?,'open',?,?,?,?,?,?,NULL,NULL)",
  ).run(
    id,
    a.userId,
    a.kind,
    a.setting,
    JSON.stringify(a.meta),
    JSON.stringify(a.setup),
    JSON.stringify(a.protocol),
    JSON.stringify(a.precheck),
    JSON.stringify(a.device),
    a.started,
  );
  return id;
}

export function setStatus(
  db: DatabaseSync,
  id: string,
  status: Exclude<AssessmentStatus, "open">,
  completed: number | null,
  endedReason: string | null,
) {
  db.prepare("UPDATE assessments SET status=?, completed=?, ended_reason=? WHERE id=? AND status='open'").run(
    status,
    completed,
    endedReason,
    id,
  );
}

export function updatePrecheck(db: DatabaseSync, id: string, precheck: Record<string, unknown>) {
  db.prepare("UPDATE assessments SET precheck=? WHERE id=?").run(JSON.stringify(precheck), id);
}

/* ---------------------------------------------------------------- results */

export interface ResultRecord {
  id: string;
  assessmentId: string;
  testId: TestId;
  side: Side | "none";
  value: number | null;
  unit: TestUnit;
  variant: string | null;
  band: "default" | "wide";
  attempts: Attempt[];
  quality: Record<string, unknown>;
  detail: Record<string, DetailValue>;
  flags: string[];
  nValid: number;
  median: number | null;
  skippedReason: string | null;
  seriesKey: string;
  poseModel: string;
  movementVersion: number;
  engineVersion: string;
  created: number;
}

interface ResultRow {
  id: string;
  assessment_id: string;
  test_id: TestId;
  side: Side | "none";
  value: number | null;
  unit: TestUnit;
  variant: string | null;
  band: "default" | "wide";
  attempts: string;
  quality: string;
  detail: string;
  flags: string;
  n_valid: number;
  median: number | null;
  skipped_reason: string | null;
  series_key: string;
  pose_model: string;
  movement_version: number;
  engine_version: string;
  created: number;
}

function toResult(r: ResultRow): ResultRecord {
  return {
    id: r.id,
    assessmentId: r.assessment_id,
    testId: r.test_id,
    side: r.side,
    value: r.value === null ? null : Number(r.value),
    unit: r.unit,
    variant: r.variant,
    band: r.band,
    attempts: JSON.parse(r.attempts),
    quality: JSON.parse(r.quality),
    detail: JSON.parse(r.detail),
    flags: JSON.parse(r.flags),
    nValid: Number(r.n_valid),
    median: r.median === null ? null : Number(r.median),
    skippedReason: r.skipped_reason,
    seriesKey: r.series_key,
    poseModel: r.pose_model,
    movementVersion: Number(r.movement_version),
    engineVersion: r.engine_version,
    created: Number(r.created),
  };
}

export function resultsOf(db: DatabaseSync, assessmentId: string): ResultRecord[] {
  const rows = db
    .prepare("SELECT * FROM assessment_results WHERE assessment_id=? ORDER BY created, rowid")
    .all(assessmentId) as unknown as ResultRow[];
  return rows.map(toResult);
}

export function resultOf(
  db: DatabaseSync,
  assessmentId: string,
  testId: string,
  side: string,
): ResultRecord | null {
  const r = db
    .prepare("SELECT * FROM assessment_results WHERE assessment_id=? AND test_id=? AND side=?")
    .get(assessmentId, testId, side) as ResultRow | undefined;
  return r ? toResult(r) : null;
}

/** Inserts the result of one test side, or replaces it (the check is open; UNIQUE per test side). */
export function saveResult(db: DatabaseSync, userId: string, r: Omit<ResultRecord, "id">) {
  db.prepare(
    `INSERT INTO assessment_results(id,assessment_id,user_id,test_id,side,value,unit,variant,band,attempts,quality,detail,flags,n_valid,median,skipped_reason,series_key,pose_model,movement_version,engine_version,created)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(assessment_id,test_id,side) DO UPDATE SET value=excluded.value,unit=excluded.unit,variant=excluded.variant,band=excluded.band,attempts=excluded.attempts,quality=excluded.quality,detail=excluded.detail,flags=excluded.flags,n_valid=excluded.n_valid,median=excluded.median,skipped_reason=excluded.skipped_reason,series_key=excluded.series_key,pose_model=excluded.pose_model,movement_version=excluded.movement_version,engine_version=excluded.engine_version,created=excluded.created`,
  ).run(
    randomUUID(),
    r.assessmentId,
    userId,
    r.testId,
    r.side,
    r.value,
    r.unit,
    r.variant,
    r.band,
    JSON.stringify(r.attempts),
    JSON.stringify(r.quality),
    JSON.stringify(r.detail),
    JSON.stringify(r.flags),
    r.nValid,
    r.median,
    r.skippedReason,
    r.seriesKey,
    r.poseModel,
    r.movementVersion,
    r.engineVersion,
    r.created,
  );
}

/**
 * Every kept result of the person (completed and ended early checks) as the progress rules read it,
 * chronological. The position, setting and limb loss come from the check the result belongs to.
 */
export function keptResults(db: DatabaseSync, userId: string): (StoredResult & { assessmentId: string })[] {
  const rows = db
    .prepare(
      `SELECT r.*, a.setting AS a_setting, a.series_meta AS a_meta, a.setup AS a_setup
       FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id
       WHERE r.user_id=? AND a.status IN ('completed','ended_early')
       ORDER BY r.created, r.rowid`,
    )
    .all(userId) as unknown as (ResultRow & { a_setting: Setting; a_meta: string; a_setup: string })[];
  return rows.map((row) => {
    const r = toResult(row);
    const meta = JSON.parse(row.a_meta) as SeriesMeta;
    const setup = JSON.parse(row.a_setup) as StoredSetup;
    const out: StoredResult & { assessmentId: string } = {
      assessmentId: r.assessmentId,
      testId: r.testId,
      side: r.side,
      value: r.value,
      unit: r.unit,
      created: r.created,
      setting: row.a_setting,
      seriesKey: r.seriesKey,
      detail: r.detail,
      flags: r.flags,
      nValid: r.nValid,
      median: r.median,
      poseModel: r.poseModel,
      movementVersion: r.movementVersion,
      band: r.band,
      position: meta.position,
      variant: r.variant,
    };
    if (setup.limbLoss) out.limbLoss = setup.limbLoss;
    return out;
  });
}

/**
 * The chair id of a result (spec 4.3 and 4.4 "same chair", SPEC-GAP same-chair-token in
 * src/medical/progress-rules.ts): the other side of the same test in this check shares its chair; a
 * person who says it is the same chair as last time keeps the chair of their last kept result of
 * that test in that setting; otherwise (not the same, not asked, or no earlier chair) a new id.
 */
export function chairId(
  db: DatabaseSync,
  userId: string,
  assessmentId: string,
  testId: TestId,
  side: Side | "none",
  setting: Setting,
  sameChair: boolean | undefined,
): string {
  const here = resultsOf(db, assessmentId).find(
    (r) => r.testId === testId && r.side !== side && typeof r.detail.chair === "string",
  );
  if (here) return here.detail.chair as string;
  if (sameChair === true) {
    const rows = db
      .prepare(
        `SELECT r.detail FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id
         WHERE r.user_id=? AND r.test_id=? AND a.setting=? AND a.status IN ('completed','ended_early')
         ORDER BY r.created DESC, r.rowid DESC`,
      )
      .all(userId, testId, setting) as { detail: string }[];
    for (const row of rows) {
      const chair = JSON.parse(row.detail).chair;
      if (typeof chair === "string") return chair;
    }
  }
  return randomUUID().slice(0, 8);
}

/**
 * The count range of the baseline of every timed test series (D-009): later checks count against it.
 * The baseline is the first measured result of the series that is not a self count (spec 4.4), as in
 * compareSeries. The arm curl stores rangeLo and rangeHi.
 */
// SPEC-GAP: chair-stand-range. Spec 4.4 stores hSit and rise (R) for the chair stand, not rangeLo and
// rangeHi. A chair stand baseline without rangeLo and rangeHi gives [hSit, hSit + rise], so the client
// reads R as hi minus lo and measures hSit again today.
export function baselineRanges(results: readonly StoredResult[]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const [key, series] of groupBySeries(results)) {
    const first = series[0];
    if (testDef(first.testId).kind !== "timed_count") continue;
    const base = series.find((r) => typeof r.value === "number" && r.detail.countSource !== "self");
    if (!base) continue;
    const { rangeLo, rangeHi, hSit, rise } = base.detail;
    if (typeof rangeLo === "number" && typeof rangeHi === "number") out[key] = [rangeLo, rangeHi];
    else if (base.testId === "chair_stand_30s" && typeof hSit === "number" && typeof rise === "number")
      out[key] = [hSit, hSit + rise];
  }
  return out;
}

/* ------------------------------------------------------------------ locks */

export interface LockRecord {
  reason: string;
  until: number;
}

/** The person's same day lock, or null; an ended lock is deleted (spec 2.1 data map). */
export function currentLock(db: DatabaseSync, userId: string, now: number): LockRecord | null {
  db.prepare("DELETE FROM check_locks WHERE until<=?").run(now);
  const r = db.prepare("SELECT reason, until FROM check_locks WHERE user_id=?").get(userId) as
    { reason: string; until: number } | undefined;
  return r ? { reason: r.reason, until: Number(r.until) } : null;
}

/** The lock reason an answer can release at once (spec 2.1 locks: pc_change_cleared yes). */
export const RELEASABLE_LOCK = "recent_change";

/**
 * Sets a lock at `now`. One row holds the person's lock, so a new lock merges with one in place: the
 * later end wins, and the reason is one no answer releases whenever either lock has such a reason
 * (a yes to pc_change_cleared must never lift a stop or pain lock with it); otherwise the reason of
 * the later end, the new one on a tie. A lock that has ended counts as none.
 */
export function setLock(db: DatabaseSync, userId: string, reason: string, until: number, now: number) {
  db.prepare("DELETE FROM check_locks WHERE user_id=? AND until<=?").run(userId, now);
  db.prepare(
    `INSERT INTO check_locks(user_id,reason,until) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET
       reason=CASE
         WHEN excluded.reason='${RELEASABLE_LOCK}' AND check_locks.reason<>'${RELEASABLE_LOCK}' THEN check_locks.reason
         WHEN check_locks.reason='${RELEASABLE_LOCK}' AND excluded.reason<>'${RELEASABLE_LOCK}' THEN excluded.reason
         WHEN excluded.until>=check_locks.until THEN excluded.reason
         ELSE check_locks.reason END,
       until=MAX(check_locks.until, excluded.until)`,
  ).run(userId, reason, until);
}

export function clearLock(db: DatabaseSync, userId: string) {
  db.prepare("DELETE FROM check_locks WHERE user_id=?").run(userId);
}

/* ---------------------------------------------------------- safety events */

/**
 * Adds one to the anonymous count of a postpone or stop reason for the day in Asia/Riyadh and the
 * setting (spec 2.1 safety log, Q25). No user id, no time of day: nothing links it to a person.
 */
// SPEC-GAP: safety-reason-keys. Reasons carry their source, because ids overlap (pain is a postpone
// reason and a stop option): precheck:<postpone reason, urgent or ad>, stop:<stop option>, and
// between:much (bt_pain_after ends the check).
export function countSafetyEvent(db: DatabaseSync, reason: string, setting: Setting, now: number) {
  db.prepare(
    "INSERT INTO safety_events(day,reason,setting,count) VALUES(?,?,?,1) ON CONFLICT(day,reason,setting) DO UPDATE SET count=count+1",
  ).run(riyadhDate(now), reason, setting);
}

/* ------------------------------------------------------------ check state */

export interface CheckState {
  /** Date (Asia/Riyadh) of the last pc_change_cleared no; cleared again by a later yes. */
  changeReported: string | null;
  changeCleared: string | null;
  /** Id of the check whose lasting ac_next_day answer was resolved by pc_after_last yes. */
  lastingResolved: string | null;
}

export function checkState(db: DatabaseSync, userId: string): CheckState {
  const r = db
    .prepare("SELECT change_reported, change_cleared, lasting_resolved FROM check_state WHERE user_id=?")
    .get(userId) as
    | { change_reported: string | null; change_cleared: string | null; lasting_resolved: string | null }
    | undefined;
  return {
    changeReported: r?.change_reported ?? null,
    changeCleared: r?.change_cleared ?? null,
    lastingResolved: r?.lasting_resolved ?? null,
  };
}

/** A reported change without a later clearance (spec 2.2 pc_change note). */
export function unresolvedChange(s: CheckState): boolean {
  return s.changeReported !== null && s.changeCleared === null;
}

function ensureState(db: DatabaseSync, userId: string) {
  db.prepare("INSERT INTO check_state(user_id) VALUES(?) ON CONFLICT(user_id) DO NOTHING").run(userId);
}

export function reportChange(db: DatabaseSync, userId: string, date: string) {
  ensureState(db, userId);
  db.prepare("UPDATE check_state SET change_reported=?, change_cleared=NULL WHERE user_id=?").run(
    date,
    userId,
  );
}

export function clearChange(db: DatabaseSync, userId: string, date: string) {
  ensureState(db, userId);
  db.prepare("UPDATE check_state SET change_cleared=? WHERE user_id=?").run(date, userId);
}

export function resolveLasting(db: DatabaseSync, userId: string, assessmentId: string) {
  ensureState(db, userId);
  db.prepare("UPDATE check_state SET lasting_resolved=? WHERE user_id=?").run(assessmentId, userId);
}

/** Runs `fn` in one write transaction and rolls it back on any error. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
