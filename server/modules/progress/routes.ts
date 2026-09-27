import type { Route } from "../../http/types";
import { earliestNextCheck, retestDue } from "../../../src/medical/assessment";
import { keptResults } from "../assessments/store";
import { checkContextOf, personState, seriesContext } from "../assessments/state";
import { weeklyActivity, type SetRecord } from "./activity";
import { seriesViews } from "./series";

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
      const last = s?.lastCompleted?.completed ?? null;
      json(200, {
        tests,
        retestDue: retestDue(last),
        earliestNext: earliestNextCheck(last),
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
