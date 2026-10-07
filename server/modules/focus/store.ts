/**
 * Database access for the focus check (product v7 contract section 3, tables of migration 005).
 * Rows go in and out as typed records and the JSON columns are written and read only here (the
 * coach's agent_sessions JSON belongs to server/modules/agent/budget.ts). Nothing here logs, and no
 * raw pre-check answer or free text reaches a row: the routes pass ids, numbers and the v1 data map.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { MIN_HOURS_BETWEEN_CHECKS } from "../../../src/medical/assessment";
import {
  V1_CHECK_JOINTS,
  focusStoredJoints,
  sharedUntil,
  v1ResultJoints,
  type CheckJoints,
} from "../../../src/medical/check-joints";
import type { BodyMapKey } from "../../../src/medical/body-map";
import type { RomProtocol, RomReasonId } from "../../../src/medical/rom-protocol";
import type { StoredFocusToday } from "../../../src/medical/focus-precheck";
import type { GaitPlan } from "../../../src/medical/gait-eligibility";
import type { RomFindingId, RomSource, StoredRomRow } from "../../../src/medical/rom-types";
import type { MeasurementGrade } from "../../../src/medical/rom-norms";
import type { GaitPatternResult, GaitStoredView, GaitSupportFinding } from "../../../src/medical/gait-types";
import type {
  GaitAnalysis,
  GaitQuality,
  GaitSetup,
  GaitViewResult,
  GaitWalkPain,
  StaticStanceResult,
} from "../../../src/engine/gait/types";
import type { LimitCause, RomAttempt, RomFlag, RomMeasureResult } from "../../../src/engine/rom/types";
import type { DefaultOnlyId, RomMovementId, RomPositionId, RomSide } from "../../../src/movements/rom/types";
import type { Setting } from "../../../src/movements/types";

/* ------------------------------------------------------------ the check */

export type FocusStatus = "open" | "completed" | "ended_early" | "abandoned";
/** Ended reasons of a focus check (the CHECK of migration 005). None names a symptom (Q25 (d)). */
export type FocusEndedReason = "stop" | "stale" | "replaced" | "all_skipped" | "consent_revoked";

/** The rule and engine versions a check ran under (section 3, focus_checks.versions). */
export interface FocusVersions {
  rom: string;
  norms: string;
  gait: string;
  targets: string;
  romEngine: string;
  gaitEngine: string;
}

/** The device of a check: browser family and OS only (the pose model is kept per measurement, C-10). */
export interface FocusDevice {
  os: string;
  browser: string;
}

/**
 * The day's answers a later step reads, the only ones kept (contract section 3; R1-2, D-026 items 7
 * and 9): the start keeps keptDay (src/medical/focus-precheck.ts; D-032 item 2), each answer only when
 * the day's one screen asked it. The others (the worry answer, the walk and freezing answers, an
 * orthosis) did their work at the start and live on in the frozen protocol and gait plan, so they are
 * not kept. Checks kept before D-032 may still hold pdState and the seated lean's answers.
 */
export type { StoredFocusToday };

const YES_NO_UNSURE: readonly unknown[] = ["yes", "no", "unsure"];
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

/**
 * The kept day's answers, field by field (StoredFocusToday): nothing else reaches the column or comes
 * back from it, whatever the object holds (a row written before a field existed reads without it).
 */
export function storedToday(today: StoredFocusToday): StoredFocusToday {
  const out: StoredFocusToday = { painByRegion: { ...today.painByRegion } };
  if (isBool(today.helperPresent)) out.helperPresent = today.helperPresent;
  const st = today.steadi;
  if (st && isBool(st.fell) && isBool(st.worry)) out.steadi = { fell: st.fell, worry: st.worry };
  if (today.pdState === "on" || today.pdState === "unsure") out.pdState = today.pdState;
  if (isBool(today.pusher)) out.pusher = today.pusher;
  if (isBool(today.armrests)) out.armrests = today.armrests;
  const lean = today.seatedLean;
  if (lean) {
    const kept: NonNullable<StoredFocusToday["seatedLean"]> = {};
    if (isBool(lean.fellSitting)) kept.fellSitting = lean.fellSitting;
    if (isBool(lean.pressureSore)) kept.pressureSore = lean.pressureSore;
    if (YES_NO_UNSURE.includes(lean.sitsUnsupported)) kept.sitsUnsupported = lean.sitsUnsupported;
    if (Object.keys(kept).length) out.seatedLean = kept;
  }
  if (isBool(today.prosthesisOn)) out.prosthesisOn = today.prosthesisOn;
  return out;
}

export interface FocusCheck {
  id: string;
  userId: string;
  kind: "baseline" | "retest";
  setting: Setting;
  status: FocusStatus;
  /** RomProtocol after applyPrecheckOutcome. */
  protocol: RomProtocol;
  gaitPlan: GaitPlan | null;
  /** The kept day's answers (StoredFocusToday): numbers and a yes or no only. */
  today: StoredFocusToday;
  /** The v1 data map of the pre-check (StoredPrecheck keys) with the consent's time and version. */
  precheck: Record<string, unknown>;
  versions: FocusVersions;
  device: FocusDevice;
  /** profiles.version of the intake the protocol was built from. */
  intakeVersion: number;
  started: number;
  /** The last activity: the start, a saved measurement or gait analysis, a stop. */
  active: number;
  completed: number | null;
  endedReason: FocusEndedReason | null;
}

interface FocusRow {
  id: string;
  user_id: string;
  kind: "baseline" | "retest";
  setting: Setting;
  status: FocusStatus;
  protocol: string;
  gait_plan: string | null;
  today: string;
  precheck: string;
  versions: string;
  device: string;
  intake_version: number;
  started: number;
  active: number;
  completed: number | null;
  ended_reason: FocusEndedReason | null;
}

function toCheck(r: FocusRow): FocusCheck {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    setting: r.setting,
    status: r.status,
    protocol: JSON.parse(r.protocol),
    gaitPlan: r.gait_plan === null ? null : JSON.parse(r.gait_plan),
    today: storedToday(JSON.parse(r.today) as StoredFocusToday),
    precheck: JSON.parse(r.precheck),
    versions: JSON.parse(r.versions),
    device: JSON.parse(r.device),
    intakeVersion: Number(r.intake_version),
    started: Number(r.started),
    active: Number(r.active),
    completed: r.completed === null ? null : Number(r.completed),
    endedReason: r.ended_reason,
  };
}

export type NewFocusCheck = Omit<FocusCheck, "id" | "status" | "active" | "completed" | "endedReason">;

/**
 * Stores a new open focus check after closing any other open one of the person (replaced): a person
 * has one open focus check at a time. Returns the id. Call inside a transaction.
 */
export function createFocusCheck(db: DatabaseSync, c: NewFocusCheck): string {
  closeOpenFocusChecks(db, c.userId, "replaced");
  const id = randomUUID();
  db.prepare(
    `INSERT INTO focus_checks(id,user_id,kind,setting,status,protocol,gait_plan,today,precheck,versions,device,intake_version,started,active,completed,ended_reason)
     VALUES(?,?,?,?,'open',?,?,?,?,?,?,?,?,?,NULL,NULL)`,
  ).run(
    id,
    c.userId,
    c.kind,
    c.setting,
    JSON.stringify(c.protocol),
    c.gaitPlan === null ? null : JSON.stringify(c.gaitPlan),
    JSON.stringify(storedToday(c.today)),
    JSON.stringify(c.precheck),
    JSON.stringify(c.versions),
    JSON.stringify(c.device),
    c.intakeVersion,
    c.started,
    c.started,
  );
  return id;
}

/** One focus check of this person, or null (another person's check reads as missing). */
export function ownFocusCheck(db: DatabaseSync, id: string, userId: string): FocusCheck | null {
  const r = db.prepare("SELECT * FROM focus_checks WHERE id=? AND user_id=?").get(id, userId) as
    FocusRow | undefined;
  return r ? toCheck(r) : null;
}

/** The person's open focus check, or null. */
export function openFocusCheck(db: DatabaseSync, userId: string): FocusCheck | null {
  const r = db
    .prepare(
      "SELECT * FROM focus_checks WHERE user_id=? AND status='open' ORDER BY started DESC, rowid DESC LIMIT 1",
    )
    .get(userId) as FocusRow | undefined;
  return r ? toCheck(r) : null;
}

/** The person's last completed focus check, in one setting or in any. */
export function lastCompletedFocus(db: DatabaseSync, userId: string, setting?: Setting): FocusCheck | null {
  const r = (
    setting
      ? db
          .prepare(
            "SELECT * FROM focus_checks WHERE user_id=? AND status='completed' AND setting=? ORDER BY completed DESC, rowid DESC LIMIT 1",
          )
          .get(userId, setting)
      : db
          .prepare(
            "SELECT * FROM focus_checks WHERE user_id=? AND status='completed' ORDER BY completed DESC, rowid DESC LIMIT 1",
          )
          .get(userId)
  ) as FocusRow | undefined;
  return r ? toCheck(r) : null;
}

/** The person's first completed focus check: the baseline a retest is measured like with like against. */
export function firstCompletedFocus(db: DatabaseSync, userId: string): FocusCheck | null {
  const r = db
    .prepare(
      "SELECT * FROM focus_checks WHERE user_id=? AND status='completed' ORDER BY completed, rowid LIMIT 1",
    )
    .get(userId) as FocusRow | undefined;
  return r ? toCheck(r) : null;
}

/** When the person's last focus check was completed (epoch ms), or null. */
export function lastCompletedFocusAt(db: DatabaseSync, userId: string): number | null {
  const r = db
    .prepare("SELECT MAX(completed) AS at FROM focus_checks WHERE user_id=? AND status='completed'")
    .get(userId) as { at: number | null } | undefined;
  return r?.at === null || r?.at === undefined ? null : Number(r.at);
}

/** The person's focus checks, newest first, with how many movements were measured and whether a walk was. */
export function listFocusChecks(
  db: DatabaseSync,
  userId: string,
): (FocusCheck & { measured: number; gait: boolean })[] {
  const rows = db
    .prepare(
      `SELECT c.*,
         (SELECT COUNT(*) FROM rom_measurements m WHERE m.check_id=c.id AND m.source='measured') AS measured,
         EXISTS(SELECT 1 FROM gait_analyses g WHERE g.check_id=c.id) AS has_gait
       FROM focus_checks c WHERE c.user_id=? ORDER BY c.started DESC, c.rowid DESC`,
    )
    .all(userId) as unknown as (FocusRow & { measured: number; has_gait: number })[];
  return rows.map((r) => ({ ...toCheck(r), measured: Number(r.measured), gait: Number(r.has_gait) === 1 }));
}

/** Whether a check holds any stored row: a range row or a gait analysis. */
function hasRows(db: DatabaseSync, checkId: string): boolean {
  const r = db
    .prepare(
      `SELECT EXISTS(SELECT 1 FROM rom_measurements WHERE check_id=?) OR EXISTS(SELECT 1 FROM gait_analyses WHERE check_id=?) AS any`,
    )
    .get(checkId, checkId) as { any: number };
  return Number(r.any) === 1;
}

/**
 * Closes an open check that will take nothing more: ended early when it holds a stored row (its rows
 * are kept), otherwise abandoned. Returns the new status, or null when it was not open.
 */
export function closeFocusCheck(
  db: DatabaseSync,
  c: Pick<FocusCheck, "id">,
  reason: FocusEndedReason,
): Exclude<FocusStatus, "open" | "completed"> | null {
  const status = hasRows(db, c.id) ? "ended_early" : "abandoned";
  const out = db
    .prepare("UPDATE focus_checks SET status=?, ended_reason=? WHERE id=? AND status='open'")
    .run(status, reason, c.id);
  return Number(out.changes) ? status : null;
}

/** Closes every open focus check of the person (a new start, a postponed start). */
export function closeOpenFocusChecks(db: DatabaseSync, userId: string, reason: FocusEndedReason): void {
  const open = db.prepare("SELECT id FROM focus_checks WHERE user_id=? AND status='open'").all(userId) as {
    id: string;
  }[];
  for (const c of open) closeFocusCheck(db, c, reason);
}

/**
 * Revoking the focus check consent ends every open focus check (as the v1 movement check consent
 * does): abandoned, ended by consent_revoked. What was stored before stays with the person.
 */
export function revokeFocusChecks(db: DatabaseSync, userId: string): number {
  const out = db
    .prepare(
      "UPDATE focus_checks SET status='abandoned', ended_reason='consent_revoked' WHERE user_id=? AND status='open'",
    )
    .run(userId);
  return Number(out.changes);
}

/**
 * Ends an open check as completed (`completed` is the time) or ended early by a stop. Returns false
 * when the check was no longer open.
 */
export function finishFocusCheck(
  db: DatabaseSync,
  c: Pick<FocusCheck, "id">,
  status: "completed" | "ended_early",
  now: number,
  reason: FocusEndedReason | null,
): boolean {
  const out = db
    .prepare(
      "UPDATE focus_checks SET status=?, completed=?, ended_reason=?, active=? WHERE id=? AND status='open'",
    )
    .run(status, status === "completed" ? now : null, reason, now, c.id);
  return Number(out.changes) > 0;
}

/**
 * A stop that reaches a check the server already closed (stale, replaced) ends it by a stop all the
 * same, without reopening it (as v1 stopClosedCheck): its status stays, its ended reason becomes
 * stop. A completed check keeps its status and reason.
 */
export function stopClosedFocusCheck(db: DatabaseSync, c: Pick<FocusCheck, "id">): void {
  db.prepare(
    "UPDATE focus_checks SET ended_reason='stop' WHERE id=? AND status IN ('ended_early','abandoned')",
  ).run(c.id);
}

/** Records activity on an open check (the 30 minute window runs from the last activity). */
export function touchFocus(db: DatabaseSync, id: string, now: number): void {
  db.prepare("UPDATE focus_checks SET active=? WHERE id=? AND status='open'").run(now, id);
}

/* ------------------------------------------- the seated side bend's limit */

/**
 * The best seated side bend of each side at the person's earlier completed checks (D-027 item 2, W2-6):
 * the focus checks' trunk_lateral_flexion measured seated on armrests, and the v1 side lean
 * (trunk_control_seated), the larger of the two. The runner's limit reads it (v1.1 4.3: beyond the
 * earlier best plus 15); null for a side never measured, which keeps the first check limit.
 */
export function sideLeanBest(
  db: DatabaseSync,
  userId: string,
): { left: number | null; right: number | null } {
  const focus = db
    .prepare(
      `SELECT m.side, MAX(m.value) AS best FROM rom_measurements m JOIN focus_checks c ON c.id=m.check_id
       WHERE m.user_id=? AND c.status='completed' AND m.movement_id='trunk_lateral_flexion'
         AND m.position='seated_armrests' AND m.source='measured' AND m.value IS NOT NULL
       GROUP BY m.side`,
    )
    .all(userId) as { side: string; best: number }[];
  const v1 = db
    .prepare(
      `SELECT r.side, MAX(r.value) AS best FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id
       WHERE r.user_id=? AND a.status='completed' AND r.test_id='trunk_control_seated' AND r.value IS NOT NULL
       GROUP BY r.side`,
    )
    .all(userId) as { side: string; best: number }[];
  const out: { left: number | null; right: number | null } = { left: null, right: null };
  for (const r of [...focus, ...v1])
    if (r.side === "left" || r.side === "right") {
      const had = out[r.side];
      out[r.side] = had === null ? Number(r.best) : Math.max(had, Number(r.best));
    }
  return out;
}

/* ----------------------------------------------------- the 48 hour rule */

/** The checks completed inside the last 48 hours: only they can hold a start back. */
const recentFrom = (now: number) => now - MIN_HOURS_BETWEEN_CHECKS * 60 * 60 * 1000;

/**
 * The focus checks completed in the last 48 hours, each with the joints it measured (CT-3,
 * src/medical/check-joints.ts): its rows with a value or attempts, and the walk's regions with a gait
 * analysis.
 */
export function recentFocusJoints(db: DatabaseSync, userId: string, now: number): CheckJoints[] {
  const checks = db
    .prepare(
      `SELECT c.id, c.completed, EXISTS(SELECT 1 FROM gait_analyses g WHERE g.check_id=c.id) AS walked
       FROM focus_checks c WHERE c.user_id=? AND c.status='completed' AND c.completed>?`,
    )
    .all(userId, recentFrom(now)) as { id: string; completed: number; walked: number }[];
  return checks.map((c) => {
    const rows = db
      .prepare("SELECT movement_id, side, value, attempts FROM rom_measurements WHERE check_id=?")
      .all(c.id) as { movement_id: string; side: RomSide; value: number | null; attempts: string }[];
    return {
      completed: Number(c.completed),
      joints: focusStoredJoints(
        rows.map((r) => ({
          movementId: r.movement_id as RomMovementId | DefaultOnlyId,
          side: r.side,
          value: r.value,
          attempts: (JSON.parse(r.attempts) as unknown[]).length,
        })),
        Number(c.walked) === 1,
      ),
    };
  });
}

/**
 * The v1 checks completed in the last 48 hours, each with the joints its results loaded (check-v1
 * areas[].loads): results with a value or attempts.
 */
export function recentV1Joints(db: DatabaseSync, userId: string, now: number): CheckJoints[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.completed, r.test_id, r.side, r.variant, r.value, r.attempts
       FROM assessments a LEFT JOIN assessment_results r ON r.assessment_id=a.id
       WHERE a.user_id=? AND a.status='completed' AND a.completed>?`,
    )
    .all(userId, recentFrom(now)) as {
    id: string;
    completed: number;
    test_id: string | null;
    side: "left" | "right" | "none" | null;
    variant: string | null;
    value: number | null;
    attempts: string | null;
  }[];
  const out = new Map<string, { completed: number; joints: Set<BodyMapKey> }>();
  for (const r of rows) {
    const c = out.get(r.id) ?? { completed: Number(r.completed), joints: new Set<BodyMapKey>() };
    out.set(r.id, c);
    if (r.test_id === null || r.side === null) continue;
    const tried = r.value !== null || (JSON.parse(r.attempts ?? "[]") as unknown[]).length > 0;
    if (!tried) continue;
    for (const j of v1ResultJoints({ testId: r.test_id as never, side: r.side, variant: r.variant }))
      c.joints.add(j);
  }
  return [...out.values()];
}

/**
 * The 48 hour minimum of a focus check that measures `joints` (CT-3, D-025 item 5): 48 hours after the
 * latest focus or v1 check completed in the last 48 hours that shares one of them, or null.
 */
export function focusEarliestNext(
  db: DatabaseSync,
  userId: string,
  joints: ReadonlySet<BodyMapKey>,
  now: number,
): number | null {
  return sharedUntil([...recentFocusJoints(db, userId, now), ...recentV1Joints(db, userId, now)], joints);
}

/**
 * The v1 schedule with the completed focus checks counted in its 48 hour minimum, both ways (section 4)
 * and only where they share a joint with a v1 check (CT-3): a focus check that measured a joint a v1
 * check loads (V1_CHECK_JOINTS, every joint its tests can load) holds it back for 48 hours, and one of
 * the neck alone does not. earliestNext is the later of the two, and canStart follows it. The due date
 * and the early flag are the v1 ones; without such a focus check the schedule is returned unchanged.
 */
export function scheduleWithFocus<S extends { earliestNext: number | null; canStart: boolean }>(
  schedule: S,
  focusChecks: readonly CheckJoints[],
  now: number,
): S {
  const focus = sharedUntil(focusChecks, V1_CHECK_JOINTS);
  if (focus === null || (schedule.earliestNext !== null && schedule.earliestNext >= focus)) return schedule;
  return { ...schedule, earliestNext: focus, canStart: now >= focus };
}

/* --------------------------------------------------- range measurements */

/** A row to store: a measured result (with the server's grade) or a not measured row. */
export interface NewRomRow {
  checkId: string;
  movementId: RomMovementId | DefaultOnlyId;
  side: RomSide;
  position: RomPositionId | null;
  value: number | null;
  source: Exclude<RomSource, "default">;
  reason: RomReasonId | null;
  pain: boolean;
  painLevel: number | null;
  painBefore: number | null;
  cause: LimitCause | null;
  percentNormal: number | null;
  finding: RomFindingId;
  gradeIgnoringPain: MeasurementGrade["gradeIgnoringPain"];
  norm: MeasurementGrade["norm"];
  median: number | null;
  nValid: number;
  /** The scored attempts, kept without quality detail beyond { ok, fps, view, issues } (section 3). */
  attempts: StoredAttempt[];
  flags: RomFlag[];
  quality: RomMeasureResult["quality"] | Record<string, never>;
  poseModel: "lite" | "full" | null;
  movementVersion: number | null;
  normsVersion: string;
  engineVersion: string | null;
  created: number;
}

/** A scored attempt as stored: its quality report reduced to ok, fps, view and issues. */
export type StoredAttempt = Omit<RomAttempt, "quality"> & {
  quality: Pick<RomAttempt["quality"], "ok" | "fps" | "view" | "issues">;
};

/** Stores one range row; the UNIQUE(check, movement, side) key refuses a second one. */
export function saveRomRow(db: DatabaseSync, userId: string, r: NewRomRow): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO rom_measurements(id,user_id,check_id,movement_id,side,position,value,unit,source,reason,pain,pain_level,pain_before,cause,percent_normal,finding,grade_ignoring_pain,norm,median,n_valid,attempts,flags,quality,pose_model,movement_version,norms_version,engine_version,created)
     VALUES(?,?,?,?,?,?,?,'deg',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    userId,
    r.checkId,
    r.movementId,
    r.side,
    r.position,
    r.value,
    r.source,
    r.reason,
    r.pain ? 1 : 0,
    r.painLevel,
    r.painBefore,
    r.cause,
    r.percentNormal,
    r.finding,
    r.gradeIgnoringPain,
    r.norm === null ? null : JSON.stringify(r.norm),
    r.median,
    r.nValid,
    JSON.stringify(r.attempts),
    JSON.stringify(r.flags),
    JSON.stringify(r.quality),
    r.poseModel,
    r.movementVersion,
    r.normsVersion,
    r.engineVersion,
    r.created,
  );
  return id;
}

interface RomRowDb {
  id: string;
  check_id: string;
  movement_id: RomMovementId | DefaultOnlyId;
  side: RomSide;
  position: RomPositionId | null;
  value: number | null;
  source: Exclude<RomSource, "default">;
  reason: RomReasonId | null;
  pain: number;
  pain_level: number | null;
  pain_before: number | null;
  cause: LimitCause | null;
  percent_normal: number | null;
  finding: RomFindingId;
  grade_ignoring_pain: StoredRomRow["gradeIgnoringPain"];
  norm: string | null;
  median: number | null;
  n_valid: number;
  flags: string;
  pose_model: "lite" | "full" | null;
  movement_version: number | null;
  norms_version: string;
  engine_version: string | null;
  created: number;
}

const num = (v: number | null) => (v === null ? null : Number(v));

/**
 * A stored row as the rules read it (StoredRomRow). A not measured row has no pose model and no
 * engine version (section 3 columns are NULL), and a default only movement no movement version: they
 * read as null (D-024, A5-5).
 */
function toRomRow(r: RomRowDb): StoredRomRow {
  return {
    id: r.id,
    checkId: r.check_id,
    movementId: r.movement_id,
    side: r.side,
    position: r.position,
    value: num(r.value),
    source: r.source,
    reason: r.reason,
    pain: Number(r.pain) === 1,
    painLevel: num(r.pain_level),
    painBefore: num(r.pain_before),
    cause: r.cause,
    percentNormal: num(r.percent_normal),
    finding: r.finding,
    gradeIgnoringPain: r.grade_ignoring_pain,
    norm: r.norm === null ? null : JSON.parse(r.norm),
    median: num(r.median),
    nValid: Number(r.n_valid),
    flags: JSON.parse(r.flags),
    poseModel: r.pose_model,
    movementVersion: num(r.movement_version),
    normsVersion: r.norms_version,
    engineVersion: r.engine_version,
    created: Number(r.created),
  };
}

/** Every range row of a check, in the order they were stored. */
export function romRowsOf(db: DatabaseSync, checkId: string): StoredRomRow[] {
  const rows = db
    .prepare("SELECT * FROM rom_measurements WHERE check_id=? ORDER BY created, rowid")
    .all(checkId) as unknown as RomRowDb[];
  return rows.map(toRomRow);
}

/** The stored attempts of one row (the store keeps them out of StoredRomRow). */
export function romAttemptsOf(db: DatabaseSync, rowId: string): StoredAttempt[] {
  const r = db.prepare("SELECT attempts FROM rom_measurements WHERE id=?").get(rowId) as
    { attempts: string } | undefined;
  return r ? JSON.parse(r.attempts) : [];
}

/** Whether a check already has a row for this movement and side. */
export function hasRomRow(db: DatabaseSync, checkId: string, movementId: string, side: RomSide): boolean {
  return (
    db
      .prepare("SELECT 1 FROM rom_measurements WHERE check_id=? AND movement_id=? AND side=?")
      .get(checkId, movementId, side) !== undefined
  );
}

/* -------------------------------------------------------------- gait */

/** What gait_analyses.findings holds: the patterns without their lines (recomputed on read) and the support findings. */
export interface StoredGaitFindings {
  patterns: Omit<GaitPatternResult, "lines">[];
  findings: GaitSupportFinding[];
}

/**
 * A view as stored: the response's view (metrics and clean cycles, section 3) with the view's whole
 * quality report, so the rules see at complete what they saw at the gait POST (2.9), and the model it
 * was measured with (C-10; D-024, A5-9), which the response leaves out.
 */
export type StoredGaitView = GaitStoredView["views"][number] & {
  quality: GaitQuality;
  poseModel: GaitViewResult["poseModel"];
};

export interface StoredGait {
  id: string;
  checkId: string | null;
  mode: GaitAnalysis["mode"];
  views: StoredGaitView[];
  setup: GaitSetup;
  /** GaitAnalysis.combined. */
  metrics: GaitAnalysis["combined"];
  /** GaitAnalysis.staticStance (kept in the metrics column with combined). */
  staticStance: StaticStanceResult[];
  /** GaitAnalysis.walkPain, the pain marked during the walk (CG-8; kept in the metrics column too). */
  walkPain: GaitWalkPain[];
  /** GaitAnalysis.outcome, why the walk ended early (D-030 C4-5; kept in the metrics column too). */
  outcome?: GaitAnalysis["outcome"];
  findings: StoredGaitFindings;
  quality: GaitStoredView["quality"];
  replay: GaitAnalysis["replay"];
  poseModel: "lite" | "full";
  rulesVersion: string;
  engineVersion: string;
  created: number;
}

interface GaitRowDb {
  id: string;
  check_id: string | null;
  mode: GaitAnalysis["mode"];
  views: string;
  setup: string;
  metrics: string;
  findings: string;
  quality: string;
  replay: string | null;
  pose_model: "lite" | "full";
  rules_version: string;
  engine_version: string;
  created: number;
}

function toGait(r: GaitRowDb): StoredGait {
  // A view stored before each view kept its model (A5-9) reads as the analysis's model.
  const views = (JSON.parse(r.views) as (Omit<StoredGaitView, "poseModel"> & Partial<StoredGaitView>)[]).map(
    (v) => ({ ...v, poseModel: v.poseModel ?? r.pose_model }),
  );
  return {
    id: r.id,
    checkId: r.check_id,
    mode: r.mode,
    views,
    setup: JSON.parse(r.setup),
    ...gaitMetricsOf(r.metrics),
    findings: JSON.parse(r.findings),
    quality: JSON.parse(r.quality),
    replay: r.replay === null ? null : JSON.parse(r.replay),
    poseModel: r.pose_model,
    rulesVersion: r.rules_version,
    engineVersion: r.engine_version,
    created: Number(r.created),
  };
}

/**
 * The metrics column: GaitAnalysis.combined, the static stance results, the walk's pain marks and why
 * it ended early.
 */
function gaitMetricsOf(json: string): Pick<StoredGait, "metrics" | "staticStance" | "walkPain" | "outcome"> {
  const m = JSON.parse(json) as {
    combined: GaitAnalysis["combined"];
    staticStance: StaticStanceResult[];
    walkPain?: GaitWalkPain[];
    outcome?: GaitAnalysis["outcome"];
  };
  return {
    metrics: m.combined,
    staticStance: m.staticStance,
    walkPain: m.walkPain ?? [],
    ...(m.outcome ? { outcome: m.outcome } : {}),
  };
}

/** The patterns as stored: their lines are dropped, the rules write them again on read. */
export function storedPatterns(patterns: readonly GaitPatternResult[]): StoredGaitFindings["patterns"] {
  return patterns.map(({ lines: _lines, ...rest }) => rest);
}

export function saveGait(db: DatabaseSync, userId: string, g: Omit<StoredGait, "id">): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO gait_analyses(id,user_id,check_id,mode,views,setup,metrics,findings,quality,replay,pose_model,rules_version,engine_version,created)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    userId,
    g.checkId,
    g.mode,
    JSON.stringify(g.views),
    JSON.stringify(g.setup),
    JSON.stringify({
      combined: g.metrics,
      staticStance: g.staticStance,
      walkPain: g.walkPain,
      ...(g.outcome ? { outcome: g.outcome } : {}),
    }),
    JSON.stringify(g.findings),
    JSON.stringify(g.quality),
    g.replay === null ? null : JSON.stringify(g.replay),
    g.poseModel,
    g.rulesVersion,
    g.engineVersion,
    g.created,
  );
  return id;
}

/** The gait analysis of a check, or null. */
export function gaitOf(db: DatabaseSync, checkId: string): StoredGait | null {
  const r = db
    .prepare("SELECT * FROM gait_analyses WHERE check_id=? ORDER BY created DESC, rowid DESC LIMIT 1")
    .get(checkId) as GaitRowDb | undefined;
  return r ? toGait(r) : null;
}

/** complete replaces the provisional findings once, with the final range rows (2.9, C-13). */
export function replaceGaitFindings(
  db: DatabaseSync,
  id: string,
  findings: StoredGaitFindings,
  rulesVersion: string,
): void {
  db.prepare("UPDATE gait_analyses SET findings=?, rules_version=? WHERE id=?").run(
    JSON.stringify(findings),
    rulesVersion,
    id,
  );
}

/* ----------------------------------------------------- coach sessions */

/** agent_sessions rows are kept 90 days (section 3, retention). */
export const AGENT_SESSIONS_KEPT_DAYS = 90;

/** Deletes the coach session rows minted more than 90 days ago; called once when the API starts. */
export function pruneAgentSessions(db: DatabaseSync, now: number): number {
  const out = db
    .prepare("DELETE FROM agent_sessions WHERE minted<?")
    .run(now - AGENT_SESSIONS_KEPT_DAYS * 24 * 60 * 60 * 1000);
  return Number(out.changes);
}
