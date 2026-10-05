/**
 * GET /api/focus/profile?checkId= (product v7 contract section 4, stream B, step B4): the range
 * profile and findings of the person's latest completed focus check, or of the completed check named,
 * with the body map summary, the walk's card and the changes against the first check. Registered behind
 * AZM_V7 by server/modules/index.ts, so this file never checks the flag itself. A read only route: it
 * changes nothing, stores nothing and logs nothing.
 *
 *   profile      buildRomProfile on the check's stored rows and the person's intake today: the stored
 *                grades as the server gave them (C-3), the typical defaults computed on read (C-4)
 *   findings     romFindings of that profile
 *   bodyMap      bodyMapSummary of that profile
 *   gait         the walk of the check as complete left it (2.9: final, provisional false), its
 *                pattern lines written again on read
 *   changes      compareRom against the earlier completed checks of the same setting (like with like:
 *                each movement against its earliest measurement)
 *   gaitChanges  compareGait against the earliest earlier walk that is like with like
 *
 * 404 NONE when the person has no completed check, or the named check is not one of their completed
 * checks; 409 PLAN_REQUIRED or INTAKE_UPDATE_REQUIRED when the intake cannot give the norms (sex, age).
 */
import type { DatabaseSync } from "node:sqlite";
import type { Route, RouteContext } from "../../http/types";
import { withGaitLines } from "../../../src/medical/gait-rules";
import type { GaitStoredView } from "../../../src/medical/gait-types";
import { hasV7Fields } from "../../../src/medical/plan";
import {
  bodyMapSummary,
  buildRomProfile,
  compareGait,
  compareRom,
  gaitComparable,
  romFindings,
  type GaitChange,
} from "../../../src/medical/rom-profile";
import type { BodyMapColour, RomChange, RomFinding, RomProfile } from "../../../src/medical/rom-types";
import type { BodyMapKey } from "../../../src/medical/body-map";
import { ID_PATH } from "../assessments/routes";
import { profileOf } from "../assessments/store";
import {
  gaitOf,
  lastCompletedFocus,
  listFocusChecks,
  ownFocusCheck,
  romRowsOf,
  type FocusCheck,
  type StoredGait,
} from "./store";

/** The response of GET /api/focus/profile (contract section 4). */
export interface FocusProfileResponse {
  profile: RomProfile;
  findings: RomFinding[];
  bodyMap: Partial<Record<BodyMapKey, BodyMapColour>>;
  gait: GaitStoredView | null;
  changes: RomChange[];
  gaitChanges: GaitChange[];
}

const NONE = { error: "NONE" } as const;
const CHECK_ID = new RegExp(`^${ID_PATH}$`);

/**
 * The walk of a check as its card reads it (GaitStoredView): the quality reports and models stay in
 * storage, and the stored patterns' lines are written again on read in both languages (2.9: «lines
 * recomputed on read») by stream C's withGaitLines.
 */
function gaitView(g: StoredGait, provisional: boolean): GaitStoredView {
  return {
    id: g.id,
    mode: g.mode,
    views: g.views.map(({ quality: _quality, poseModel: _poseModel, ...v }) => v),
    metrics: g.metrics,
    patterns: withGaitLines(g.findings.patterns),
    findings: g.findings.findings,
    quality: g.quality,
    replay: g.replay,
    provisional,
    rulesVersion: g.rulesVersion,
    created: g.created,
  };
}

/** The check the request names (?checkId=), or the latest completed one; null when it is not a completed check of the person. */
function chosenCheck(ctx: RouteContext): FocusCheck | null {
  const url = new URL(ctx.req.url ?? "/", "http://localhost");
  const userId = ctx.user!.id;
  if (!url.searchParams.has("checkId")) return lastCompletedFocus(ctx.db, userId);
  const id = url.searchParams.get("checkId") ?? "";
  if (!CHECK_ID.test(id)) return null;
  const c = ownFocusCheck(ctx.db, id, userId);
  return c && c.status === "completed" ? c : null;
}

/**
 * The person's completed checks of the same setting completed before this one, oldest first: the
 * checks a retest is measured against (a focus series is per setting, like a v1 series).
 */
function earlierChecks(db: DatabaseSync, c: FocusCheck): FocusCheck[] {
  return listFocusChecks(db, c.userId)
    .filter(
      (x) =>
        x.id !== c.id &&
        x.status === "completed" &&
        x.setting === c.setting &&
        x.completed !== null &&
        c.completed !== null &&
        x.completed < c.completed,
    )
    .sort((a, b) => a.completed! - b.completed!);
}

/** The walk's changes against the earliest earlier walk that is like with like (gait-rules retest). */
function walkChanges(
  db: DatabaseSync,
  earlier: readonly FocusCheck[],
  latest: StoredGait | null,
): GaitChange[] {
  if (!latest) return [];
  for (const c of earlier) {
    const first = gaitOf(db, c.id);
    if (first && gaitComparable(first, latest)) return compareGait(first, latest);
  }
  return [];
}

export const profileRoutes: Route[] = [
  {
    method: "GET",
    path: /^\/api\/focus\/profile$/,
    auth: "user",
    handle(ctx) {
      const { db, json } = ctx;
      const c = chosenCheck(ctx);
      if (!c) return json(404, NONE);
      const p = profileOf(db, ctx.user!.id);
      if (!p) return json(409, { error: "PLAN_REQUIRED" });
      if (!hasV7Fields(p.intake)) return json(409, { error: "INTAKE_UPDATE_REQUIRED" });
      const intake = p.intake;
      const rows = romRowsOf(db, c.id);
      // The profile as of the check: complete built it at the check's completion, with the same rows.
      const profile = buildRomProfile({ intake, rows, now: c.completed ?? c.active });
      const earlier = earlierChecks(db, c);
      const g = gaitOf(db, c.id);
      const out: FocusProfileResponse = {
        profile,
        findings: romFindings(profile, intake),
        bodyMap: bodyMapSummary(profile),
        // A completed check's walk is final: complete replaced its findings (2.9, C-13).
        gait: g ? gaitView(g, false) : null,
        changes: compareRom(
          earlier.flatMap((x) => romRowsOf(db, x.id)),
          rows,
          intake.conditions,
        ),
        gaitChanges: walkChanges(db, earlier, g),
      };
      json(200, out);
    },
  },
];
