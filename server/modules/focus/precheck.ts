/**
 * What the server knows before and during a focus check (product v7 contract 2.5 and section 4): the
 * pre-check environment built from the v1 person state (the focus check reuses the v1 pre-check, its
 * locks, stop routing and consent through their pure functions, C-2), and the pure rules the focus
 * routes run, by their contract signatures.
 *
 * The rules of 2.4 and 2.5 (rom-norms.ts, rom-protocol.ts, gait-eligibility.ts, focus-precheck.ts)
 * and hasV7Fields (plan.ts, 2.2) are stream A's steps A2 and A4. The focus routes take them through
 * FocusRules, so the route tests can run on small test rules; FOCUS_RULES binds the real functions
 * (bound at Gate A). Routes built with null rules answer 503 FOCUS_RULES_PENDING.
 */
import type { DatabaseSync } from "node:sqlite";
import { contextFromIntake, isBlocked, type CheckContext } from "../../../src/medical/assessment";
import { hasV7Fields, type Intake, type Plan, type Sex } from "../../../src/medical/plan";
import type { Answers, PrecheckEnv, PrecheckOutcome } from "../../../src/medical/precheck";
import {
  buildRomProtocol,
  type FocusToday,
  type RomProtocol,
  type RomProtocolInput,
} from "../../../src/medical/rom-protocol";
import { gaitPlanFor, type GaitPlan } from "../../../src/medical/gait-eligibility";
import { applyPrecheckOutcome, focusPrecheckEnv } from "../../../src/medical/focus-precheck";
import {
  gradeMeasurement,
  positionTypical,
  typicalValue,
  type MeasurementGrade,
} from "../../../src/medical/rom-norms";
import type { RomMeasureResult } from "../../../src/engine/rom/types";
import type { JointMovementId, RomPositionId } from "../../../src/movements/rom/types";
import type { Setting } from "../../../src/movements/types";
import { neededArmsLastStand, sideLeanDoneAtHome, type PersonState } from "../assessments/state";
import { lastCompletedFocus } from "./store";

/** An intake with every field the focus check needs (2.2 hasV7Fields). */
export type V7Intake = Intake & Required<Pick<Intake, "sex" | "regions" | "walking">>;

/** The helper requirements applyPrecheckOutcome reports (2.5). */
export type HelperNeed = "rom_seated" | "rom_standing" | "gait";

/** The pure rules of 2.2, 2.4 and 2.5 the focus routes call, with their contract signatures. */
export interface FocusRules {
  /** plan.ts (A2): true when the intake has sex, regions and walking. */
  hasV7Fields(h: Intake): h is V7Intake;
  /** rom-protocol.ts (A4). */
  buildRomProtocol(input: RomProtocolInput): RomProtocol;
  /** gait-eligibility.ts (A4): gait-rules eligibility.gate, eligibility.today and modeChoice. */
  gaitPlanFor(
    intake: Intake,
    today: FocusToday,
    setting: "home" | "booth",
    precheckAnswers: Answers,
  ): GaitPlan;
  /** focus-precheck.ts (A4): the PrecheckEnv with baseTests = proxyBaseTests. */
  focusPrecheckEnv(
    base: Omit<PrecheckEnv, "baseTests">,
    protocol: RomProtocol,
    gait: GaitPlan | null,
  ): PrecheckEnv;
  /** focus-precheck.ts (A4): a skip of a proxy test skips the v7 items of its block and side. */
  applyPrecheckOutcome(
    protocol: RomProtocol,
    gait: GaitPlan | null,
    outcome: PrecheckOutcome,
  ): { protocol: RomProtocol; gait: GaitPlan | null; helperRequired: HelperNeed[] };
  /** rom-norms.ts (A4): what the server stores with each measurement (C-3). */
  gradeMeasurement(result: RomMeasureResult, intake: Intake & { sex: Sex }): MeasurementGrade;
  /** rom-norms.ts (A4): the typical default of a movement for the person's sex and age. */
  typicalValue(movement: JointMovementId, sex: Sex, age: number, side?: "left" | "right"): number | null;
  /** rom-norms.ts: the typical of a movement in its own position, null without a graded norm there (4.3 rule 7). */
  positionTypical(
    movement: JointMovementId,
    position: RomPositionId | null,
    sex: Sex,
    age: number,
    side?: "left" | "right",
  ): number | null;
}

/** The real rules of steps A2 and A4, bound at Gate A (contract change log A5-1). */
export const FOCUS_RULES: FocusRules | null = {
  hasV7Fields,
  buildRomProtocol,
  gaitPlanFor,
  focusPrecheckEnv,
  applyPrecheckOutcome,
  gradeMeasurement,
  typicalValue,
  positionTypical,
};

/** The check context of a focus check in its setting (the booth rules of Q19 (5b) included), or null when blocked. */
export function focusContext(intake: Intake, plan: Plan, setting: Setting): CheckContext | null {
  const c = contextFromIntake(intake, plan, setting);
  return isBlocked(c) ? null : c;
}

/** Why the plan is in review in this setting, or null. */
export function reviewReason(intake: Intake, plan: Plan, setting: Setting): string | null {
  const c = contextFromIntake(intake, plan, setting);
  return isBlocked(c) ? c.blocked : null;
}

/**
 * The pre-check environment of a focus check before its base tests (focusPrecheckEnv adds the proxy
 * base tests of the day's protocol). A focus series is per setting like a v1 series: the first
 * completed focus check of the setting ends its first check. The v1 state gives the stored setup,
 * the change and faint dates, the lasting follow up and the side lean and chair stand history; the
 * safety questions asked since a last check count a completed check of either kind.
 */
export function focusEnvBase(
  db: DatabaseSync,
  userId: string,
  s: PersonState,
  ctx: CheckContext,
  setting: Setting,
): Omit<PrecheckEnv, "baseTests"> {
  return {
    setting,
    ctx,
    setup: s.setup,
    firstCheck: lastCompletedFocus(db, userId, setting) === null,
    unresolvedChangeReported: s.unresolvedChangeReported,
    lastCheckLasting: s.lasting !== null,
    sideLeanDoneAtHome: sideLeanDoneAtHome(db, userId),
    neededArmsLastStand: neededArmsLastStand(db, userId, setting),
    completedBefore: s.lastCompleted !== null || lastCompletedFocus(db, userId) !== null,
    faintReportedUnresolved: s.faintReportedUnresolved,
  };
}

/** The empty day: no pain and no red flag, for the protocol preview of GET /api/focus/context. */
export const PREVIEW_TODAY: FocusToday = { painByRegion: {}, redFlagRegions: [] };
