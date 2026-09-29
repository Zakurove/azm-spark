import type { Route } from "../../http/types";
import { isBlocked } from "../../../src/medical/assessment";
import { keepNextLoad, loadStepOf, nextLoadText } from "../assessments/loads";
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
      const views = s
        ? seriesViews(
            results,
            (position) => seriesContext(checkContextOf(s.intake, s.plan, position), s.setup),
            {
              lastCheckLasting: s.lasting !== null,
            },
          )
        : [];
      // Q26: the offer of one load step heavier on a current home arm curl series (phase 2).
      const tests = views.map((v) => {
        if (!s || v.testId !== "arm_curl_30s" || v.setting !== "home" || !v.current) return v;
        if (isBlocked(s.context)) return { ...v, loadStep: null };
        const series = results.filter(
          (r) =>
            r.testId === v.testId && r.side === v.side && r.seriesKey === v.seriesKey && r.setting === "home",
        );
        const position = series[series.length - 1]?.position ?? "chair";
        const loadStep = loadStepOf(series, {
          ctx: seriesContext(checkContextOf(s.intake, s.plan, position), s.setup),
          context: s.context,
          lastCheckLasting: s.lasting !== null,
        });
        return { ...v, loadStep };
      });
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
  {
    // Q26: the choice of the heavier load offer, kept for the next check's S30 (the load of that arm).
    method: "POST",
    path: /^\/api\/progress\/load-step$/,
    auth: "user",
    handle({ db, user, body, json }) {
      const u = user!;
      const keys = body && typeof body === "object" ? Object.keys(body) : [];
      const side = (body as { side?: unknown } | null)?.side;
      const choice = (body as { choice?: unknown } | null)?.choice;
      if (keys.some((k) => k !== "side" && k !== "choice") || (side !== "left" && side !== "right"))
        return json(400, { error: "LOAD_STEP_INVALID", field: "side" });
      if (choice !== "heavier" && choice !== "same")
        return json(400, { error: "LOAD_STEP_INVALID", field: "choice" });
      const s = personState(db, u.id, Date.now());
      if (!s || isBlocked(s.context)) return json(409, { error: "NO_OFFER" });
      const results = keptResults(db, u.id);
      const current = results
        .filter(
          (r) => r.testId === "arm_curl_30s" && r.side === side && r.setting === "home" && r.value !== null,
        )
        .pop();
      if (!current) return json(409, { error: "NO_OFFER" });
      const series = results.filter(
        (r) =>
          r.testId === "arm_curl_30s" &&
          r.side === side &&
          r.seriesKey === current.seriesKey &&
          r.setting === "home",
      );
      const offer = loadStepOf(series, {
        ctx: seriesContext(checkContextOf(s.intake, s.plan, current.position), s.setup),
        context: s.context,
        lastCheckLasting: s.lasting !== null,
      });
      if (!offer) return json(409, { error: "NO_OFFER" });
      keepNextLoad(db, u.id, side, choice === "heavier" ? nextLoadText(offer.to) : "same");
      json(200, { side, choice, next: choice === "heavier" ? offer.to : offer.from });
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
