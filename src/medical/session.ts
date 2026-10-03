import type { Plan, Prescription } from "./plan";
import type { WeeklyItem, WeeklyPlan } from "./weekly";

/**
 * A session of the program (booth v2, contract D). Every item of the day's weekly plan is done inside
 * the session as a guided card; the camera movements keep the camera. In order:
 *
 *   the warm up cards, the camera sets, the day's exercises, the cool down cards.
 *
 * The server fixes the day when the session starts and keeps it with the workout, so each step has a
 * place (its index) that the saves follow. A workout started before the cards has no day: its steps
 * are the camera sets alone, as they were. Pure, and light enough for the portal's first page.
 */

export type CardSlot = "warmup" | "extra" | "cooldown";

/** The cards of the day a session falls on, with the rules' rest between the sets of a card. */
export interface SessionDay {
  /** The planned weekday (0 Sunday to 6 Saturday). */
  day: number;
  warmup: WeeklyItem[];
  extra: WeeklyItem[];
  cooldown: WeeklyItem[];
  restSeconds: number;
}

export type SessionStep =
  | { kind: "card"; slot: CardSlot; item: WeeklyItem }
  | { kind: "camera"; prescription: Prescription; setNumber: number };

/**
 * The planned day a session started on `weekday` belongs to: that day when it is planned, else the
 * next planned day of the week, else the first planned day of the next week (the Program page opens
 * its week on the same day).
 */
export function sessionDayIndex(days: readonly number[], weekday: number): number {
  return Math.max(
    0,
    days.findIndex((d) => d >= weekday),
  );
}

/** The cards of the session started on `weekday`, or null for a week without days. */
export function sessionDay(weekly: WeeklyPlan, weekday: number, restSeconds: number): SessionDay | null {
  if (!weekly.days.length) return null;
  const index = sessionDayIndex(
    weekly.days.map((x) => x.day),
    weekday,
  );
  const d = weekly.days[index];
  return { day: d.day, warmup: d.warmup, extra: d.extra, cooldown: d.cooldown, restSeconds };
}

/** The rules' rest of a plan: its own, or (saved before it) the rest of its first camera movement. */
export const planRest = (plan: Pick<Plan, "restSeconds" | "exercises">): number =>
  plan.restSeconds ?? plan.exercises[0]?.restSeconds ?? 60;

export function sessionSteps(plan: Pick<Plan, "exercises">, day?: SessionDay | null): SessionStep[] {
  const camera: SessionStep[] = plan.exercises.flatMap((prescription) =>
    Array.from({ length: prescription.sets }, (_, i) => ({
      kind: "camera" as const,
      prescription,
      setNumber: i + 1,
    })),
  );
  if (!day) return camera;
  const cards = (slot: CardSlot): SessionStep[] => day[slot].map((item) => ({ kind: "card", slot, item }));
  return [...cards("warmup"), ...camera, ...cards("extra"), ...cards("cooldown")];
}

/** A hold is timed; the other exercises count their reps with a tap. */
export const cardKind = (item: Partial<WeeklyItem>): "timer" | "counter" =>
  item.holdSeconds ? "timer" : "counter";

/** How many exercises the session of a day holds: its camera movements and its cards. */
export function sessionSize(plan: Pick<Plan, "exercises">, day?: SessionDay | null): number {
  return plan.exercises.length + (day ? day.warmup.length + day.extra.length + day.cooldown.length : 0);
}
