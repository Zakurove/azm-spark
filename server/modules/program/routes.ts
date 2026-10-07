/**
 * POST /api/program/targets (product v7 contract 2.10 and section 4, stream E, step E2): the weekly plan
 * built from the findings of a completed focus check (the latest, or the one named), with its why lines,
 * stored in profiles.plan.weekly with its findings ref and pinned to the plan's version like
 * POST /api/plan/weekly, which from then on returns it unchanged, also with refresh. Registered behind
 * AZM_V7 by server/modules/index.ts.
 *
 * A week already built from the same check under the same rules is answered as it is stored, so the
 * Program page and the findings page can ask for it at every visit: the weekly AI words a week once.
 * The rate limit counts the builds.
 *
 *   200 { weekly, version, targets, referrals, unmet }
 *   400 TARGETS_INVALID { field }   a key other than checkId, or a malformed id
 *   404 NO_FINDINGS                 no completed focus check of the person (or the one named is not)
 *   409 PLAN_REQUIRED               no ready plan
 *   409 INTAKE_UPDATE_REQUIRED      the intake has no v7 fields (the findings need sex and the body map)
 *   429 RATE_LIMIT                  more than 10 builds in 15 minutes
 *
 * D-032 item 3 (the tests come before the program): a week built from a completed check ends a
 * person's wait for the check (check_first). POST /api/program/history ends it from the history when
 * nothing can be measured or the person cannot use a camera:
 *
 *   200 { ok: true, from }          the program is the plan of the history (the wait ended, or there was none)
 *   400 HISTORY_INVALID { field }   a body with any key
 *   409 PLAN_REQUIRED               no ready plan
 */
import type { Route } from "../../http/types";
import { hasV7Fields } from "../../../src/medical/plan";
import type { WeeklyPlan } from "../../../src/medical/weekly";
import { createWeekly } from "../../weekly-ai";
import { ID_PATH } from "../assessments/routes";
import { profileOf } from "../assessments/store";
import { lastCompletedFocus, ownFocusCheck } from "../focus/store";
import { buildFromCheck, storeWeekly } from "./hooks";
import { clearAwaiting, programFrom } from "./awaiting";

/** Contract section 4: 10 per user per 15 minutes (the route's window). */
export const BUILDS_PER_WINDOW = 10;
const CHECK_ID = new RegExp(`^${ID_PATH}$`);

/** The stored week was built from this check under the same rules, targets data and program rules (E2-6). */
function sameBuild(stored: WeeklyPlan | undefined, built: WeeklyPlan): boolean {
  const a = stored?.findings;
  const b = built.findings!;
  return (
    !!a &&
    a.checkId === b.checkId &&
    a.romVersion === b.romVersion &&
    a.gaitVersion === b.gaitVersion &&
    a.targetsVersion === b.targetsVersion &&
    a.programVersion === b.programVersion
  );
}

export const programRoutes: Route[] = [
  {
    method: "POST",
    path: /^\/api\/program\/targets$/,
    auth: "user",
    async handle(ctx) {
      const { db, json, limited } = ctx;
      const u = ctx.user!;
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const extra = Object.keys(body).find((k) => k !== "checkId");
      if (extra !== undefined) return json(400, { error: "TARGETS_INVALID", field: extra });
      if (body.checkId !== undefined && (typeof body.checkId !== "string" || !CHECK_ID.test(body.checkId)))
        return json(400, { error: "TARGETS_INVALID", field: "checkId" });
      const p = profileOf(db, u.id);
      if (!p || p.plan.status !== "ready") return json(409, { error: "PLAN_REQUIRED" });
      if (!hasV7Fields(p.intake)) return json(409, { error: "INTAKE_UPDATE_REQUIRED" });
      const check =
        typeof body.checkId === "string"
          ? ownFocusCheck(db, body.checkId, u.id)
          : lastCompletedFocus(db, u.id);
      if (!check || check.status !== "completed") return json(404, { error: "NO_FINDINGS" });
      const build = buildFromCheck(db, p.intake, p.plan, check, Date.now());
      if (!build) return json(409, { error: "PLAN_REQUIRED" });
      let weekly = p.plan.weekly;
      if (!weekly || !sameBuild(weekly, build.weekly)) {
        if (limited(`program-targets:${u.id}`, BUILDS_PER_WINDOW)) return json(429, { error: "RATE_LIMIT" });
        weekly = (await createWeekly(p.intake, p.plan, process.env.OPENAI_API_KEY, build)) ?? build.weekly;
        storeWeekly(db, u.id, p.plan, weekly);
      }
      // D-032 item 3: the targeted week is the program; the wait for the check ends.
      clearAwaiting(db, u.id, "check", Date.now());
      json(200, {
        weekly,
        version: p.plan.version,
        targets: build.targets,
        referrals: build.referrals,
        unmet: build.unmet,
      });
    },
  },
  {
    method: "POST",
    path: /^\/api\/program\/history$/,
    auth: "user",
    handle(ctx) {
      const { db, json } = ctx;
      const u = ctx.user!;
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const extra = Object.keys(body)[0];
      if (extra !== undefined) return json(400, { error: "HISTORY_INVALID", field: extra });
      const p = profileOf(db, u.id);
      if (!p || p.plan.status !== "ready") return json(409, { error: "PLAN_REQUIRED" });
      // The plan the intake made is the program; the check can refine it later.
      clearAwaiting(db, u.id, "history", Date.now());
      json(200, { ok: true, from: programFrom(db, u.id) });
    },
  },
];
