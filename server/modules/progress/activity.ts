/**
 * Workout activity for the progress page (contract v2 E), from the existing results table: sessions
 * done per week against the planned days, the share of valid reps, the average effort (RPE) and the
 * active minutes per week. Weeks start on Sunday in Asia/Riyadh (UTC+3 all year). Pure.
 */
// SPEC-GAP: activity-window. Contract E names the measures only: 8 weeks shown, weeks from Sunday
// in Asia/Riyadh, planned = the plan's session days per week, a set counts at most 60 minutes.
const DAY_MS = 24 * 60 * 60 * 1000;
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Weeks shown, the current week included. */
export const WEEKS_SHOWN = 8;
/** A set counts at most this many active minutes (a set left open does not inflate the week). */
const MAX_SET_MINUTES = 60;

/** One saved workout set, as the legacy results table keeps it (results.data). */
export interface SetRecord {
  workoutId: string;
  data: unknown;
}

export interface WeekActivity {
  /** First day of the week (Sunday), YYYY-MM-DD in Asia/Riyadh. */
  start: string;
  /** Workouts with at least one saved set in this week. */
  done: number;
  /** Planned session days per week (plan days); 0 for weeks before the account existed. */
  planned: number;
  activeMinutes: number;
}

export interface Activity {
  weeks: WeekActivity[];
  /** Valid reps over all counted reps in the weeks shown, 0 to 1 (2 decimals); null without reps. */
  validShare: number | null;
  /** Mean RPE of the sets in the weeks shown (1 decimal); null without an RPE. */
  avgEffort: number | null;
  /** Mean active minutes per week from the first week with a set to this week; null without sets. */
  activeMinutesPerWeek: number | null;
}

const localDay = (t: number) => Math.floor((t + RIYADH_OFFSET_MS) / DAY_MS);
/** Epoch day of the Sunday that starts the week of `t` (1970-01-01, day 0, was a Thursday). */
const weekStartDay = (t: number) => {
  const d = localDay(t);
  return d - ((d + 4) % 7);
};
const dayString = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

export function weeklyActivity(
  sets: readonly SetRecord[],
  planDays: readonly number[],
  now: number,
  accountCreated: number,
): Activity {
  const current = weekStartDay(now);
  const firstShown = current - 7 * (WEEKS_SHOWN - 1);
  const planned = new Set(planDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)).size;
  const createdWeek = weekStartDay(accountCreated);
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => ({
    day: firstShown + 7 * i,
    workouts: new Map<string, number>(),
    minutes: 0,
  }));
  let valid = 0,
    reps = 0,
    rpeSum = 0,
    rpeN = 0;
  // A workout counts in the week of its first saved set.
  const firstSet = new Map<string, number>();
  for (const s of sets) {
    const d = s.data as Record<string, unknown> | null;
    if (!d || !finite(d.endedAt)) continue;
    firstSet.set(s.workoutId, Math.min(firstSet.get(s.workoutId) ?? Infinity, d.endedAt));
  }
  for (const s of sets) {
    const d = s.data as Record<string, unknown> | null;
    if (!d || !finite(d.endedAt)) continue;
    const week = weeks.find((w) => w.day === weekStartDay(d.endedAt as number));
    if (!week) continue;
    if (weekStartDay(firstSet.get(s.workoutId)!) === week.day) week.workouts.set(s.workoutId, 1);
    if (finite(d.startedAt) && d.endedAt >= d.startedAt)
      week.minutes += Math.min(MAX_SET_MINUTES, (d.endedAt - d.startedAt) / 60000);
    const r = (d.reps ?? {}) as Record<string, unknown>;
    valid += count(r.valid);
    reps += count(r.valid) + count(r.compensated) + count(r.partial);
    if (finite(d.rpe) && d.rpe >= 0 && d.rpe <= 10) {
      rpeSum += d.rpe;
      rpeN++;
    }
  }
  const firstActive = weeks.findIndex((w) => w.minutes > 0 || w.workouts.size > 0);
  const active = firstActive < 0 ? [] : weeks.slice(firstActive);
  return {
    weeks: weeks.map((w) => ({
      start: dayString(w.day),
      done: w.workouts.size,
      planned: w.day < createdWeek ? 0 : planned,
      activeMinutes: Math.round(w.minutes),
    })),
    validShare: reps > 0 ? round(valid / reps, 2) : null,
    avgEffort: rpeN > 0 ? round(rpeSum / rpeN, 1) : null,
    activeMinutesPerWeek: active.length
      ? Math.round(active.reduce((n, w) => n + w.minutes, 0) / active.length)
      : null,
  };
}
