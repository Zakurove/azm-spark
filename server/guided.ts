import type { Intake, Plan } from "../src/medical/plan";
import { engineWeekly } from "../src/medical/weekly";
import {
  cardKind,
  planRest,
  sessionDay,
  sessionSteps,
  type SessionDay,
  type SessionStep,
} from "../src/medical/session";

/**
 * The guided cards of a workout (booth v2, contract D). A workout started by a page that knows the
 * cards (`guided: true`) keeps the cards of the day it falls on with its plan; its steps are then the
 * warm up cards, the camera sets, the day's exercises and the cool down cards, and each save names
 * its step. A workout started without them keeps the camera sets alone, as before.
 */

/** The workout row's plan: the profile's plan, with the day of a guided workout. */
export type RunPlan = Plan & { today?: SessionDay };

/** The day of a workout started now: the weekday the phone sends, else today in Riyadh. */
export function startDay(intake: Intake, plan: Plan, weekday: unknown, now: number): SessionDay | null {
  const weekly = plan.weekly ?? engineWeekly(intake, plan);
  if (!weekly) return null;
  const day =
    Number.isInteger(weekday) && (weekday as number) >= 0 && (weekday as number) <= 6
      ? (weekday as number)
      : new Date(now + 3 * 60 * 60 * 1000).getUTCDay();
  return sessionDay(weekly, day, planRest(plan));
}

export const runSteps = (run: RunPlan): SessionStep[] => sessionSteps(run, run.today ?? null);

const int = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/**
 * The record kept for a completed card, or why the body is refused: "order" (not this card, 409) or
 * "invalid" (400). A skipped card keeps nothing (record null).
 */
export function cardRecord(
  body: Record<string, unknown>,
  step: SessionStep | undefined,
  workoutCreated: number,
  now: number,
): { error: "order" | "invalid" } | { record: Record<string, unknown> | null } {
  if (!step || step.kind !== "card" || body.id !== step.item.id) return { error: "order" };
  if (body.skipped === true) return { record: null };
  const item = step.item;
  const done = body.done as Record<string, unknown> | null | undefined;
  const timer = cardKind(item) === "timer";
  if (
    !done ||
    typeof done !== "object" ||
    !int(done.sets, 0, item.sets) ||
    (timer ? !int(done.seconds, 0, 3600) || "reps" in done : !int(done.reps, 0, 200) || "seconds" in done) ||
    (body.rpe != null && !int(body.rpe, 0, 10))
  )
    return { error: "invalid" };
  const startedAt =
    typeof body.startedAt === "number" && Number.isFinite(body.startedAt)
      ? Math.min(now, Math.max(workoutCreated, body.startedAt))
      : workoutCreated;
  return {
    record: {
      exerciseId: item.id,
      mode: "guided",
      slot: step.slot,
      startedAt,
      endedAt: now,
      rpe: body.rpe ?? undefined,
      dose: { sets: item.sets, ...(timer ? { holdSeconds: item.holdSeconds } : { reps: item.reps ?? 8 }) },
      done: timer ? { sets: done.sets, seconds: done.seconds } : { sets: done.sets, reps: done.reps },
    },
  };
}
