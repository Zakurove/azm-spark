/**
 * The live coach on a workout (product v7 contract 2.11 session host, C-6, C-15, C-16; D-025 CT-2;
 * stream D, step D5), the parts that need no screen:
 *
 *   - the kind of each workout screen (C-16): the placement card and a camera movement's card are the
 *     person's taps, the warm up, the rest and the cool down are timers, a camera set and a guided card
 *     are exercises, the end card is information;
 *   - CT-2: before a coached workout one tap asks the pain now (0 to 10), and the session host measures
 *     the rise of 2 from that answer; a skipped question counts as 0 (painStopRule's null);
 *   - the coach segments (C-6): session:1 from the first step for the part's 9 minutes, session:2 from
 *     the first step after them, and the rest of a longer workout without the coach («a workout longer
 *     than two parts runs the rest in local mode», segments.ts); a new part only at a step (D-13);
 *   - the stop list of a coached workout: the movement check's stop list and v1 routing (stopRoute) with
 *     the person's intake as the context, so a spoken chest pain reaches the emergency screen; a stop
 *     that ends a check ends the workout.
 * Pure, no DOM.
 */
import type { CoachSegment, CoachStepKind } from "../../coach/types";
import type { CheckContext } from "../../medical/assessment";
import type { Intake } from "../../medical/plan";
import { emergencyAlsoShow, stopRoute, type PrecheckEnv } from "../../medical/precheck";
import type { CheckPosition, ScreenId } from "../../movements/types";

export type WorkoutStage = "setup" | "warmup" | "intro" | "set" | "rest" | "card" | "cooldown" | "done";

/** The kind of each workout screen (C-16). */
export const WORKOUT_STEP_KIND: Record<WorkoutStage, CoachStepKind> = {
  setup: "confirm",
  warmup: "timer",
  intro: "confirm",
  set: "active",
  rest: "timer",
  card: "active",
  cooldown: "timer",
  done: "info",
};

/** A workout part's minutes (C-6: up to two of 9 minutes; 5.4 session:9), as the token route reserves them. */
export const WORKOUT_SEGMENT_MS = 9 * 60_000;

/** The pain question and the segments of one coached workout. */
export class WorkoutCoachPlan {
  /** CT-2: the pain now before the workout; undefined until asked, null when skipped (counts as 0). */
  painBefore: number | null | undefined = undefined;
  segment: CoachSegment | null = null;
  private startedAt = 0;
  private over = false;

  /** The one tap answer (0 to 10), or null for «تخطَّ». */
  answerPain(level: number | null): void {
    this.painBefore = level === null ? null : Math.max(0, Math.min(10, Math.round(level)));
  }

  /** A step of the workout starts: the segment it runs in (a new part only here, never mid step). */
  boundary(now: number): CoachSegment | null {
    if (this.painBefore === undefined || this.over) return null;
    if (this.segment === null) {
      this.segment = "session:1";
      this.startedAt = now;
    } else if (now - this.startedAt > WORKOUT_SEGMENT_MS) {
      if (this.segment === "session:1") {
        this.segment = "session:2";
        this.startedAt = now;
      } else {
        this.segment = null;
        this.over = true;
      }
    }
    return this.segment;
  }
}

const POSITION: Record<string, CheckPosition> = {
  seated: "chair",
  wheelchair: "wheelchair",
  standing: "standing",
};

/**
 * The stop list's context for a workout: the person's intake as the movement check reads it, at home,
 * with nothing stored of a check series (the routing reads the position, the conditions and the flags
 * of the stop options).
 */
export function workoutStopEnv(intake: Intake | null): PrecheckEnv {
  const ctx: CheckContext = {
    position: POSITION[intake?.mobility ?? ""] ?? "chair",
    support: intake?.support ?? "none",
    pain: [...(intake?.pain ?? [])],
    restrictions: [...(intake?.restrictions ?? [])],
    conditions: [...(intake?.conditions ?? [])],
    clearance: intake?.clearance ?? "unsure",
  } as CheckContext;
  return {
    setting: "home",
    ctx,
    setup: null,
    firstCheck: false,
    unresolvedChangeReported: false,
    lastCheckLasting: false,
    baseTests: [],
  };
}

export interface WorkoutStopRoute {
  option: string;
  /** The safety screen to show (scr_emergency, ...), or null. */
  screen: ScreenId | null;
  alsoShow: ScreenId[];
  /** A stop that ends a check ends the workout too. */
  endsWorkout: boolean;
}

/**
 * Where a stop list answer leads in a workout (v1 stopRoute), with the autonomic dysreflexia screen
 * beside the emergency one for a spinal cord injury (O12 (1), as the movement check's flow adds it).
 */
export function workoutStopRoute(option: string, env: PrecheckEnv): WorkoutStopRoute {
  const r = stopRoute(option, env);
  const alsoShow =
    r.screen === "scr_emergency" ? [...new Set([...r.alsoShow, ...emergencyAlsoShow(env)])] : r.alsoShow;
  return { option: r.option, screen: r.screen, alsoShow, endsWorkout: r.endsCheck };
}
