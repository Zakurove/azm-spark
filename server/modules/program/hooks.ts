/**
 * The program built from the findings, on the server (product v7 contract 2.10, stream E, step E2):
 *
 *   buildFromCheck    a completed focus check's targeted week for an intake and its plan: the range
 *                     profile of the check's stored rows and its findings (B4), first dropping those whose
 *                     joint is no longer on the body map, the walk's final patterns and support findings
 *                     (C3), the check's kept day answers and gait plan (D-026 item 9), and what the
 *                     re-test rule keeps from the person's earlier completed checks (D-029 item 1, E2-5)
 *   storeWeekly       the week in profiles.plan.weekly, pinned to the plan's version like
 *                     POST /api/plan/weekly
 *   afterIntakeSaved  what PUT /api/intake runs after it saved an intake, with AZM_V7=1 only
 *                     (server/api.ts): the targeted week is rebuilt from the latest completed focus check,
 *                     by the rules alone (the new plan has no week yet)
 */
import type { DatabaseSync } from "node:sqlite";
import { withGaitLines } from "../../../src/medical/gait-rules";
import { hasV7Fields, type Intake, type Plan } from "../../../src/medical/plan";
import { buildRomProfile, compareRom, romFindings } from "../../../src/medical/rom-profile";
import {
  findingsOnMap,
  PROGRAM_RULES_VERSION,
  retestState,
  targetedBuild,
  type CheckResults,
  type TargetedBuild,
} from "../../../src/medical/targets";
import type { WeeklyPlan } from "../../../src/medical/weekly";
import { TARGETS_VERSION } from "../../../src/movements/targets";
import { profileOf } from "../assessments/store";
import { gaitOf, lastCompletedFocus, listFocusChecks, romRowsOf, type FocusCheck } from "../focus/store";

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
  const v7 = { ...intake, sex: intake.sex };
  const history = completedUpTo(db, check);
  const results = history.map((c) => checkResults(db, v7, c, history));
  const current = results[results.length - 1];
  const state = retestState(results);
  const walk = gaitOf(db, check.id);
  const ref = {
    checkId: check.id,
    romVersion: check.versions.rom,
    gaitVersion: walk ? walk.rulesVersion : null,
    targetsVersion: TARGETS_VERSION,
    programVersion: PROGRAM_RULES_VERSION,
    created: now,
  };
  return targetedBuild(intake, plan, state.rom, state.gait, ref, {
    profile: current.profile,
    gaitPlan: check.gaitPlan,
    today: check.today,
    gait: state.gait,
    support: state.support,
    maintenance: state.maintenance,
  });
}

/**
 * The person's completed checks up to this one, in the order they were completed, this one last: the
 * checks the re-test rule folds (retestState).
 */
function completedUpTo(db: DatabaseSync, check: FocusCheck): FocusCheck[] {
  const at = check.completed ?? check.active;
  const earlier = listFocusChecks(db, check.userId).filter(
    (c) => c.id !== check.id && c.status === "completed" && c.completed !== null && c.completed <= at,
  );
  return [...earlier.sort((a, b) => a.completed! - b.completed!), check];
}

/**
 * One check's results as the re-test rule reads them: the range profile of its stored rows and its
 * findings on the body map today, its changes against the earlier completed checks of the same setting
 * (compareRom, as GET /api/focus/profile gives them to the findings page), and its walk.
 */
function checkResults(
  db: DatabaseSync,
  intake: Intake & { sex: NonNullable<Intake["sex"]> },
  c: FocusCheck,
  history: readonly FocusCheck[],
): CheckResults {
  const rows = romRowsOf(db, c.id);
  const profile = buildRomProfile({ intake, rows, now: c.completed ?? c.active });
  const before = history.filter(
    (x) =>
      x.setting === c.setting && x.completed !== null && c.completed !== null && x.completed < c.completed,
  );
  const walk = gaitOf(db, c.id);
  return {
    rom: findingsOnMap(romFindings(profile, intake), intake),
    profile,
    changes: compareRom(
      before.flatMap((x) => romRowsOf(db, x.id)),
      rows,
      intake.conditions,
    ),
    gait: walk ? withGaitLines(walk.findings.patterns) : null,
    support: walk ? walk.findings.findings : [],
    walkViews: walk ? walk.views.map((v) => v.view) : [],
  };
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
