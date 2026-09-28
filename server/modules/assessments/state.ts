/**
 * What the server knows about a person before a check: the check context from the stored intake,
 * the stored setup, and the facts the pre-check environment needs (contract v2, C and E). The same
 * builder serves GET /api/assessments/context and the server side re-evaluation in POST
 * /api/assessments, so the client and the server see one environment.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  baseSelection,
  baseTests,
  contextFromIntake,
  isBlocked,
  type Blocked,
  type CheckContext,
  type SelectionItem,
  type StoredSetup,
} from "../../../src/medical/assessment";
import type { Intake, Plan } from "../../../src/medical/plan";
import { afterCheckDue, type PrecheckEnv } from "../../../src/medical/precheck";
import type { SeriesContext } from "../../../src/medical/progress-rules";
import type { CheckPosition, Setting } from "../../../src/movements/types";
import {
  checkState,
  lastCompleted,
  latestAssessment,
  profileOf,
  unresolvedChange,
  type Assessment,
} from "./store";

export interface PersonState {
  intake: Intake;
  plan: Plan & { version: number };
  context: CheckContext | Blocked;
  /** The stored setup, without the baseline setup answers when the intake changed since. */
  setup: StoredSetup | null;
  unresolvedChangeReported: boolean;
  /** The last completed check, when its lasting follow up is not resolved yet. */
  lasting: Assessment | null;
  /** The last completed check, any setting. */
  lastCompleted: Assessment | null;
  /** The last completed check, when its next day follow up (ac_next_day) is due now. */
  followUpDue: Assessment | null;
}

/**
 * The setup of the newest check. Spec 2.1: the baseline setup questions are asked again when the
 * intake changes. The server keeps no intake history, so any saved intake after the setup was
 * answered drops those answers (painSides, limbLoss, sciT6) and the pre-check asks them again.
 */
// SPEC-GAP: setup-intake-change (see src/medical/precheck.ts). Any new intake version counts as a
// change: asking a baseline setup question again is the safe side.
export function storedSetup(latest: Assessment | null, intakeVersion: number): StoredSetup | null {
  if (!latest) return null;
  const setup: StoredSetup = { ...latest.setup };
  if (latest.meta.intakeVersion !== intakeVersion) {
    delete setup.painSides;
    delete setup.limbLoss;
    delete setup.sciT6;
  }
  return setup;
}

export function personState(db: DatabaseSync, userId: string, now: number): PersonState | null {
  const profile = profileOf(db, userId);
  if (!profile) return null;
  const { intake, plan } = profile;
  const last = lastCompleted(db, userId);
  const state = checkState(db, userId);
  const followUp = last?.precheck["assessment.followUp"];
  return {
    intake,
    plan,
    context: contextFromIntake(intake, plan),
    setup: storedSetup(latestAssessment(db, userId), plan.version),
    unresolvedChangeReported: unresolvedChange(state),
    lasting: last && followUp === "lasting" && state.lastingResolved !== last.id ? last : null,
    lastCompleted: last,
    followUpDue: last && followUp === undefined && afterCheckDue(last.completed!, now) ? last : null,
  };
}

/**
 * First check of a series: no completed check in this setting (booth and home are separate
 * series). The first home check after booth checks asks the baseline setup questions again, asks
 * about changes over the last 3 months and needs a helper for the side lean: the safe side.
 */
// SPEC-GAP: first-check-per-setting. PrecheckEnv.firstCheck is "first check of the series"; a
// series is per setting, and a check that ended early is not a completed check.
export function firstCheckIn(db: DatabaseSync, userId: string, setting: Setting): boolean {
  return lastCompleted(db, userId, setting) === null;
}

/** The person has a measured side lean in a completed home check (the first home side lean rule). */
export function sideLeanDoneAtHome(db: DatabaseSync, userId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id
       WHERE r.user_id=? AND r.test_id='trunk_control_seated' AND r.value IS NOT NULL
       AND a.setting='home' AND a.status='completed' LIMIT 1`,
    )
    .get(userId);
  return row !== undefined;
}

/**
 * The last kept chair stand in this setting stopped because the person needed their hands
 * (needed_arms): spec 4.4 "the next check offers arms_assisted" (PrecheckEnv.neededArmsLastStand).
 */
export function neededArmsLastStand(db: DatabaseSync, userId: string, setting: Setting): boolean {
  const row = db
    .prepare(
      `SELECT r.skipped_reason AS reason FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id
       WHERE r.user_id=? AND r.test_id='chair_stand_30s' AND a.setting=? AND a.status IN ('completed','ended_early')
       ORDER BY r.created DESC, r.rowid DESC LIMIT 1`,
    )
    .get(userId, setting) as { reason: string | null } | undefined;
  return row?.reason === "needed_arms";
}

/** The pre-check environment and the base selection of a person with a check context. */
export function precheckEnv(
  db: DatabaseSync,
  userId: string,
  s: PersonState,
  ctx: CheckContext,
  setting: Setting,
): { env: PrecheckEnv; base: SelectionItem[] } {
  const base = baseSelection(ctx, setting, s.setup);
  return {
    base,
    env: {
      setting,
      ctx,
      setup: s.setup,
      firstCheck: firstCheckIn(db, userId, setting),
      unresolvedChangeReported: s.unresolvedChangeReported,
      lastCheckLasting: s.lasting !== null,
      baseTests: baseTests(base),
      sideLeanDoneAtHome: sideLeanDoneAtHome(db, userId),
      neededArmsLastStand: neededArmsLastStand(db, userId, setting),
      completedBefore: s.lastCompleted !== null,
    },
  };
}

/**
 * The context of a stored check for the stop list and the progress rules: the person's intake with
 * the position the check ran in. A plan now in review still has its intake; the lists are copied as
 * they are (they were validated when the intake was saved).
 */
export function checkContextOf(intake: Intake, plan: Plan, position: CheckPosition): CheckContext {
  const c = contextFromIntake(intake, plan);
  if (!isBlocked(c)) return { ...c, position };
  return {
    position,
    support: intake.support,
    pain: [...intake.pain],
    restrictions: [...intake.restrictions],
    conditions: [...intake.conditions],
    clearance: intake.clearance,
  };
}

export function seriesContext(ctx: CheckContext, setup: StoredSetup | null): SeriesContext {
  return {
    position: ctx.position,
    support: ctx.support,
    conditions: ctx.conditions,
    pain: ctx.pain,
    setup,
  };
}
