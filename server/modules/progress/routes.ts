import type { Route } from "../../http/types";
import { keptResults } from "../assessments/store";
import { checkContextOf, personState, seriesContext } from "../assessments/state";
import { weeklyActivity, type SetRecord } from "./activity";
import { seriesViews } from "../../../src/medical/series";

/**
 * GET /api/progress (contract v2 E): each movement check series against its own starting point, when
 * the next check is due, and the workout activity of the recent weeks. Only the person's own data.
 */
export const progressRoutes: Route[] = [
  {
    method: "GET",
    path: /^\/api\/progress$/,
    auth: "user",
    handle({ db, user, json }) {
      const now = Date.now();
      const u = user!;
      const s = personState(db, u.id, now);
      const sets = (
        db.prepare("SELECT workout_id, data FROM results WHERE user_id=? ORDER BY rowid").all(u.id) as {
          workout_id: string;
          data: string;
        }[]
      ).map((r): SetRecord => ({ workoutId: r.workout_id, data: safeParse(r.data) }));
      const activity = weeklyActivity(sets, s?.plan.days ?? [], now, Number(u.created));
      const results = keptResults(db, u.id);
      const tests = s
        ? seriesViews(
            results,
            (position) => seriesContext(checkContextOf(s.intake, s.plan, position), s.setup),
            {
              lastCheckLasting: s.lasting !== null,
            },
          )
        : [];
      // H9: the home due date and the 48 hour minimum, as in GET /api/assessments/context.
      json(200, {
        tests,
        retestDue: s?.schedule.retestDue ?? null,
        earliestNext: s?.schedule.earliestNext ?? null,
        early: s?.schedule.early ?? false,
        sessions: { weeks: activity.weeks },
        validShare: activity.validShare,
        avgEffort: activity.avgEffort,
        activeMinutesPerWeek: activity.activeMinutesPerWeek,
      });
    },
  },
];

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
