/**
 * The program built from the findings, on the server (product v7 contract 2.10, stream E, step E2):
 *
 *   buildFromCheck    a completed focus check's targeted week for an intake and its plan: the range
 *                     profile of the check's stored rows and its findings (B4), first dropping those whose
 *                     joint is no longer on the body map, the walk's final patterns (C3) and the check's
 *                     kept day answers and gait plan (D-026 item 9)
 *   storeWeekly       the week in profiles.plan.weekly, pinned to the plan's version like
 *                     POST /api/plan/weekly
 *   afterIntakeSaved  what PUT /api/intake runs after it saved an intake, with AZM_V7=1 only
 *                     (server/api.ts): the targeted week is rebuilt from the latest completed focus check,
 *                     by the rules alone (the new plan has no week yet)
 */
import type { DatabaseSync } from "node:sqlite";
import { withGaitLines } from "../../../src/medical/gait-rules";
import { hasV7Fields, type Intake, type Plan } from "../../../src/medical/plan";
import { buildRomProfile, romFindings } from "../../../src/medical/rom-profile";
import { findingsOnMap, targetedBuild, type TargetedBuild } from "../../../src/medical/targets";
import type { WeeklyPlan } from "../../../src/medical/weekly";
import { TARGETS_VERSION } from "../../../src/movements/targets";
import { profileOf } from "../assessments/store";
import { gaitOf, lastCompletedFocus, romRowsOf, type FocusCheck } from "../focus/store";

/**
 * The targeted week of a completed check (null exactly when the plan is not ready). The findings ref
 * names the check, the range and gait rules it was measured under and the targets data the week was
 * built with, and the time it was built.
 */
export function buildFromCheck(
  db: DatabaseSync,
  intake: Intake,
  plan: Plan,
  check: FocusCheck,
  now: number,
): TargetedBuild | null {
  if (!intake.sex) return null;
  const rows = romRowsOf(db, check.id);
  const profile = buildRomProfile({
    intake: { ...intake, sex: intake.sex },
    rows,
    now: check.completed ?? check.active,
  });
  const rom = findingsOnMap(romFindings(profile, intake), intake);
  const walk = gaitOf(db, check.id);
  const gait = walk ? withGaitLines(walk.findings.patterns) : [];
  const ref = {
    checkId: check.id,
    romVersion: check.versions.rom,
    gaitVersion: walk ? walk.rulesVersion : null,
    targetsVersion: TARGETS_VERSION,
    created: now,
  };
  return targetedBuild(intake, plan, rom, gait, ref, {
    profile,
    gaitPlan: check.gaitPlan,
    today: check.today,
    gait,
    support: walk ? walk.findings.findings : [],
  });
}

/** The week in profiles.plan.weekly, only while the plan is the version it was built for. */
export function storeWeekly(
  db: DatabaseSync,
  userId: string,
  plan: Plan & { version: number },
  weekly: WeeklyPlan,
): boolean {
  const { version, ...stored } = plan;
  const r = db
    .prepare("UPDATE profiles SET plan=? WHERE user_id=? AND version=?")
    .run(JSON.stringify({ ...stored, weekly }), userId, version);
  return Number(r.changes) > 0;
}

/**
 * PUT /api/intake saved a new intake and plan: with a completed focus check and the v7 fields, the
 * targeted week follows the new intake, its range findings limited to the joints still on the body map.
 */
export function afterIntakeSaved(db: DatabaseSync, userId: string): void {
  const p = profileOf(db, userId);
  if (!p || p.plan.status !== "ready" || !hasV7Fields(p.intake)) return;
  const check = lastCompletedFocus(db, userId);
  if (!check) return;
  const build = buildFromCheck(db, p.intake, p.plan, check, Date.now());
  if (build) storeWeekly(db, userId, p.plan, build.weekly);
}
