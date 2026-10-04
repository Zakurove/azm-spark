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
  /** The side lean only session of Q12 (2); missing means a full check. */
  session?: CheckSession;
}

/** A full check, or the side lean only session that sets the second side lean baseline (Q12 (2)). */
export type CheckSession = "full" | "side_lean_only";

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
  /** The last activity of the check (O6): its start, a result, a stop, a between answer, a resume. */
  active: number;
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
  active: number | null;
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
    active: r.active === null ? Number(r.started) : Number(r.active),
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

/** Every completed check of the person with its setting and session, for the schedule (H9, Q12 (2)). */
export function completedChecks(
  db: DatabaseSync,
  userId: string,
): { completed: number; setting: Setting; session: CheckSession; hadSideLean: boolean }[] {
  const rows = db
    .prepare(
      `SELECT a.completed, a.setting, a.series_meta,
         EXISTS(SELECT 1 FROM assessment_results r WHERE r.assessment_id=a.id AND r.test_id='trunk_control_seated' AND r.value IS NOT NULL) AS lean
       FROM assessments a WHERE a.user_id=? AND a.status='completed' ORDER BY a.completed, a.rowid`,
    )
    .all(userId) as { completed: number; setting: Setting; series_meta: string; lean: number }[];
  return rows.map((r) => ({
    completed: Number(r.completed),
    setting: r.setting,
    session: (JSON.parse(r.series_meta) as SeriesMeta).session ?? "full",
    hadSideLean: Number(r.lean) === 1,
  }));
}

/** The person's open check, or null (a person has one open check at a time). */
export function openAssessment(db: DatabaseSync, userId: string): Assessment | null {
  const r = db
    .prepare(
      "SELECT * FROM assessments WHERE user_id=? AND status='open' ORDER BY started DESC, rowid DESC LIMIT 1",
    )
    .get(userId) as AssessmentRow | undefined;
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

/**
 * Stores a new check, open, or ended early when no test runs today (O21: ended reason all_skipped).
 * Any other open check of the person is closed first (closeOpen, reason replaced). Returns the id.
 */
export function createAssessment(
  db: DatabaseSync,
  a: NewAssessment,
  status: "open" | "ended_early" = "open",
): string {
  const id = randomUUID();
  closeOpen(db, a.userId, "replaced", a.started);
  db.prepare(
    "INSERT INTO assessments(id,user_id,kind,setting,status,series_meta,setup,protocol,precheck,device,started,completed,ended_reason,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)",
  ).run(
    id,
    a.userId,
    a.kind,
    a.setting,
    status,
    JSON.stringify(a.meta),
    JSON.stringify(a.setup),
    JSON.stringify(a.protocol),
    JSON.stringify(a.precheck),
    JSON.stringify(a.device),
    a.started,
    status === "open" ? null : "all_skipped",
    a.started,
  );
  return id;
}

/** Ended reasons of a stored check. None names a stop option or a symptom (Q25 (d)). */
export type EndedReason = "stop" | "stale" | "replaced" | "all_skipped" | "consent_revoked";

/**
 * Closes an open check that will take nothing more (O6 (3), (4)): ended early when it has a stored
 * result or skip, so its finished tests are kept, otherwise abandoned. `until` is when it stopped
 * (its last activity for an idle check), which ends its minutes in the product counts.
 */
export function closeCheck(
  db: DatabaseSync,
  a: Assessment,
  reason: EndedReason,
  until: number,
): AssessmentStatus {
  const status: Exclude<AssessmentStatus, "open"> = resultsOf(db, a.id).length ? "ended_early" : "abandoned";
  const out = db
    .prepare("UPDATE assessments SET status=?, completed=NULL, ended_reason=? WHERE id=? AND status='open'")
    .run(status, reason, a.id);
  if (Number(out.changes) && status === "ended_early") countClosed(db, a, "ended_early", until);
  return status;
}

/** Closes every open check of the person (a new start, a postponed start). */
export function closeOpen(db: DatabaseSync, userId: string, reason: EndedReason, now: number) {
  const open = db
    .prepare("SELECT * FROM assessments WHERE user_id=? AND status='open'")
    .all(userId) as unknown as AssessmentRow[];
  for (const r of open) closeCheck(db, toAssessment(r), reason, Math.min(now, toAssessment(r).active));
}

/**
 * Ends an open check as completed (`completed` is the time) or ended early by a stop, and adds it to
 * the product counts. Returns false when the check was no longer open.
 */
export function finishCheck(
  db: DatabaseSync,
  a: Assessment,
  status: "completed" | "ended_early",
  now: number,
  endedReason: EndedReason | null,
): boolean {
  const out = db
    .prepare("UPDATE assessments SET status=?, completed=?, ended_reason=? WHERE id=? AND status='open'")
    .run(status, status === "completed" ? now : null, endedReason, a.id);
  if (!Number(out.changes)) return false;
  countClosed(db, a, status, now);
  return true;
}

/**
 * A stop that reaches a check the server already closed (a stale close, a new start) ends it by a stop
 * all the same, without reopening it: ended early by a stop when it holds a stored row, else abandoned
 * by a stop. A completed check keeps its status. The faint follow up reads the ended reason.
 */
export function stopClosedCheck(db: DatabaseSync, a: Assessment, now: number): void {
  if (a.status !== "ended_early" && a.status !== "abandoned") return;
  const status = resultsOf(db, a.id).length ? "ended_early" : "abandoned";
  db.prepare("UPDATE assessments SET status=?, ended_reason='stop' WHERE id=? AND status=?").run(
    status,
    a.id,
    a.status,
  );
  if (a.status === "abandoned" && status === "ended_early")
    countClosed(db, a, "ended_early", Math.min(now, a.active));
}

function countClosed(db: DatabaseSync, a: Assessment, status: "completed" | "ended_early", until: number) {
  countProduct(db, status === "completed" ? "checks_completed" : "checks_ended_early", "", a.setting, until);
  const minutes = Math.max(0, Math.round((until - a.started) / 60000));
  if (minutes > 0) countProduct(db, "check_minutes", "", a.setting, until, minutes);
}

/** Records activity on an open check (O6: the 30 minute window runs from the last activity). */
export function touch(db: DatabaseSync, id: string, now: number) {
  db.prepare("UPDATE assessments SET active=? WHERE id=? AND status='open'").run(now, id);
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

/**
 * Inserts the result of one test side, or replaces it (the check is open; UNIQUE per test side). A
 * first score adds one finished test, a first skip one skipped test under its reason (Q2 (6)), so a
 * re-post counts nothing again. `setting` is the check's.
 */
export function saveResult(db: DatabaseSync, userId: string, r: Omit<ResultRecord, "id">, setting: Setting) {
  const before = resultOf(db, r.assessmentId, r.testId, r.side);
  if (r.value !== null && (before === null || before.value === null))
    countProduct(db, "tests_finished", r.testId, setting, r.created);
  if (r.skippedReason !== null && before === null)
    countProduct(db, "tests_skipped", r.skippedReason, setting, r.created);
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
 * chronological, plus the results of the check `alsoId` whatever its status (the end of check
 * question of a check still open). The position, setting and limb loss come from the check the
 * result belongs to.
 */
export function keptResults(
  db: DatabaseSync,
  userId: string,
  alsoId?: string,
): (StoredResult & { assessmentId: string })[] {
  const rows = db
    .prepare(
      `SELECT r.*, a.setting AS a_setting, a.series_meta AS a_meta, a.setup AS a_setup
       FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id
       WHERE r.user_id=? AND (a.status IN ('completed','ended_early') OR a.id=?)
       ORDER BY r.created, r.rowid`,
    )
    .all(userId, alsoId ?? "") as unknown as (ResultRow & {
    a_setting: Setting;
    a_meta: string;
    a_setup: string;
  })[];
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

/**
 * The lock record per person (Q25 (c)): when it ends and whether a clearance answer releases it at
 * once, never the reason id. Deleted at expiry.
 */
export interface LockRecord {
  until: number;
  releasableByClearance: boolean;
}

/** The person's same day lock, or null; an ended lock is deleted (spec 2.1 data map). */
export function currentLock(db: DatabaseSync, userId: string, now: number): LockRecord | null {
  db.prepare("DELETE FROM check_locks WHERE until<=?").run(now);
  const r = db
    .prepare("SELECT until, releasable_by_clearance FROM check_locks WHERE user_id=?")
    .get(userId) as { until: number; releasable_by_clearance: number } | undefined;
  return r
    ? { until: Number(r.until), releasableByClearance: Number(r.releasable_by_clearance) === 1 }
    : null;
}

/**
 * Sets a lock at `now`. One row holds the person's lock, so a new lock merges with one in place: the
 * later end wins, and a clearance answer releases the merged lock only when it releases both (a yes
 * to pc_change_cleared must never lift a stop or pain lock with it). A lock that has ended counts as
 * none.
 */
export function setLock(db: DatabaseSync, userId: string, lock: LockRecord, now: number) {
  db.prepare("DELETE FROM check_locks WHERE user_id=? AND until<=?").run(userId, now);
  db.prepare(
    `INSERT INTO check_locks(user_id,until,releasable_by_clearance) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET
       until=MAX(check_locks.until, excluded.until),
       releasable_by_clearance=MIN(check_locks.releasable_by_clearance, excluded.releasable_by_clearance)`,
  ).run(userId, lock.until, lock.releasableByClearance ? 1 : 0);
}

export function clearLock(db: DatabaseSync, userId: string) {
  db.prepare("DELETE FROM check_locks WHERE user_id=?").run(userId);
}

/* ------------------------------------------------- safety log, product counts */

/** The test id of a safety count: a test, "precheck", or "none" when no test was running. */
export type CountTestId = TestId | "precheck" | "none";

/**
 * Adds one to the anonymous count of a safety event for the day in Asia/Riyadh, the test id (or
 * precheck) and the setting (Q25 (a), spec 2.1 safety log). No user id, no check id, no condition, no
 * time finer than the day: nothing links it to a person.
 */
// SPEC-GAP: safety-reason-keys. Reasons carry their source, because ids overlap (pain is a postpone
// reason and a stop option): precheck:<postpone reason, urgent or ad> (the start and the O6 re-ask),
// stop:<stop option>, between:much (bt_pain_after ends the check), end:symptoms (Q23 (7) yes) and
// faint_loc:<yes, no or unsure> (Q33 (3)).
export function countSafetyEvent(
  db: DatabaseSync,
  reason: string,
  testId: CountTestId,
  setting: Setting,
  now: number,
) {
  db.prepare(
    "INSERT INTO safety_events(day,reason,test_id,setting,count) VALUES(?,?,?,?,1) ON CONFLICT(day,reason,test_id,setting) DO UPDATE SET count=count+1",
  ).run(riyadhDate(now), reason, testId, setting);
}

/**
 * The anonymous daily product counts (Q2 (6)) and the denominators of the safety log (Q25 (a)), in
 * the same form: checks_started, checks_completed, checks_ended_early and check_minutes (key ""),
 * tests_finished and quality_retries (key: test id), tests_skipped (key: reason id). v7 (product v7
 * contract section 3): focus_started and focus_completed (key ""), rom_quality_retries (key: movement
 * id), gait_gate_failed (key: gait mode) and coach_fallback (key: coach block).
 */
export type ProductMetric =
  | "checks_started"
  | "checks_completed"
  | "checks_ended_early"
  | "check_minutes"
  | "tests_finished"
  | "tests_skipped"
  | "quality_retries"
  | "focus_started"
  | "focus_completed"
  | "rom_quality_retries"
  | "gait_gate_failed"
  | "coach_fallback";

export function countProduct(
  db: DatabaseSync,
  metric: ProductMetric,
  key: string,
  setting: Setting,
  now: number,
  n = 1,
) {
  db.prepare(
    "INSERT INTO product_counts(day,metric,key,setting,count) VALUES(?,?,?,?,?) ON CONFLICT(day,metric,key,setting) DO UPDATE SET count=count+excluded.count",
  ).run(riyadhDate(now), metric, key, setting, n);
}

/* ------------------------------------------------------------ check state */

export interface CheckState {
  /** Date (Asia/Riyadh) of the last reported change (Q33 (2)); cleared again by a later clearance. */
  changeReported: string | null;
  changeCleared: string | null;
  /** Id of the check whose lasting ac_next_day answer was resolved by pc_after_last yes. */
  lastingResolved: string | null;
  /** Date of the last faint stop (Q33 (3)), until pc_faint_since is answered. */
  faintReported: string | null;
}

export function checkState(db: DatabaseSync, userId: string): CheckState {
  const r = db
    .prepare(
      "SELECT change_reported, change_cleared, lasting_resolved, faint_reported FROM check_state WHERE user_id=?",
    )
    .get(userId) as
    | {
        change_reported: string | null;
        change_cleared: string | null;
        lasting_resolved: string | null;
        faint_reported: string | null;
      }
    | undefined;
  return {
    changeReported: r?.change_reported ?? null,
    changeCleared: r?.change_cleared ?? null,
    lastingResolved: r?.lasting_resolved ?? null,
    faintReported: r?.faint_reported ?? null,
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

/** A faint stop (Q33 (3)): the date only, asked about once at the next check (pc_faint_since). */
export function reportFaint(db: DatabaseSync, userId: string, date: string) {
  ensureState(db, userId);
  db.prepare("UPDATE check_state SET faint_reported=? WHERE user_id=?").run(date, userId);
}

/** Either answer to pc_faint_since clears faintReported (Q33 (3)). */
export function clearFaint(db: DatabaseSync, userId: string) {
  ensureState(db, userId);
  db.prepare("UPDATE check_state SET faint_reported=NULL WHERE user_id=?").run(userId);
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
