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
 *     that ends a check ends the workout, after its screen and, for a faint or a fall, v1's follow up
 *     question (sf_faint_loc); any other answer stops the running exercise and the workout goes on;
 *   - what the coach reads back on repeat_instructions: the text of the screen the person sees.
 * Pure, no DOM.
 */
import type { CoachSegment, CoachStepKind, CoachStopReason } from "../../coach/types";
import type { CheckContext } from "../../medical/assessment";
import type { Intake } from "../../medical/plan";
import { libraryById } from "../../medical/pool";
import { emergencyAlsoShow, faintFollowUp, stopRoute, type PrecheckEnv } from "../../medical/precheck";
import type { SessionStep } from "../../medical/session";
import type { CheckPosition, ScreenId, StopFollowUpId } from "../../movements/types";
import { EXERCISES } from "../../exercises/defs";
import type { Position } from "../../app/product";
import type { Lang } from "../../app/i18n";
import { labels } from "../../app/platform-copy";
import { camCopy } from "../../app/camera-copy";
import { guidedCopy } from "../../app/guided-copy";

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

/**
 * D-036 item 2: a button of the workout's screen the Live coach may press on the person's spoken
 * words, as the workout gives it: the camera movement card's Start training, Next set once the rest is
 * over, the warm up's Start training and the cool down's Finish once their timer has run out, a camera
 * set's Continue program (never after its safety stop), and the end card's Exit. Never the setup's
 * Ready (it attests the person's health), a guided card's own controls or the effort question.
 */
export interface WorkoutButton {
  name: "start" | "next_set" | "finish" | "exit" | "continue";
  press(): void;
  /** D-038 item 3: a demo run's summary also offers Repeat, for «again». */
  again?(): void;
}

/**
 * The interval screen's main button the coach may press now (the camera set's own comes from the set),
 * or null: the setup's attestation never, a timer's button only once its time has run out.
 */
export function workoutButton(
  stage: WorkoutStage,
  secondsLeft: number,
  press: () => void,
): WorkoutButton | null {
  const over = secondsLeft <= 0;
  switch (stage) {
    case "intro":
      return { name: "start", press };
    case "warmup":
      return over ? { name: "start", press } : null;
    case "rest":
      return over ? { name: "next_set", press } : null;
    case "cooldown":
      return over ? { name: "finish", press } : null;
    case "done":
      return { name: "exit", press };
    default:
      return null;
  }
}

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

/** A camera set's position as the stop routing reads it (sit to stand is done standing up). */
const SET_POSITION: Record<Position, CheckPosition> = {
  chair: "chair",
  wheelchair: "wheelchair",
  rise: "standing",
};

/**
 * The stop list's context for a workout: the person's intake as the movement check reads it, at home,
 * with nothing stored of a check series (the routing reads the position, the conditions and the flags
 * of the stop options). The position is the camera part's when the workout has one (a fall from a
 * seat has its own screen), else the intake's.
 */
export function workoutStopEnv(intake: Intake | null, position: Position | null = null): PrecheckEnv {
  const ctx: CheckContext = {
    position: position ? SET_POSITION[position] : (POSITION[intake?.mobility ?? ""] ?? "chair"),
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
  /** v1's follow up after a faint or a fall stop's screen (sf_faint_loc). */
  then?: StopFollowUpId;
}

/**
 * Where a stop list answer leads in a workout (v1 stopRoute), with the autonomic dysreflexia screen
 * beside the emergency one for a spinal cord injury (O12 (1), as the movement check's flow adds it).
 */
export function workoutStopRoute(option: string, env: PrecheckEnv): WorkoutStopRoute {
  const r = stopRoute(option, env);
  const alsoShow =
    r.screen === "scr_emergency" ? [...new Set([...r.alsoShow, ...emergencyAlsoShow(env)])] : r.alsoShow;
  return {
    option: r.option,
    screen: r.screen,
    alsoShow,
    endsWorkout: r.endsCheck,
    ...(r.then && r.then !== "bt_pain_after" ? { then: r.then } : {}),
  };
}

/** The safety part of a coached workout over its screens: the stop list, a stop's screen, the faint question. */
export type WorkoutSafety =
  | { kind: "list"; preselect: CoachStopReason | null }
  | { kind: "screen"; route: WorkoutStopRoute }
  | { kind: "faint_ask"; route: WorkoutStopRoute };

/** A camera set or a guided card is running: a stop ends it (the timers and the cards between go on). */
export function exerciseRuns(stage: WorkoutStage): boolean {
  return stage === "set" || stage === "card";
}

/** After the stop list: the stop's screen when it has one (every stop that ends the workout), else none. */
export function afterStopChoice(route: WorkoutStopRoute): WorkoutSafety | null {
  return route.screen ? { kind: "screen", route } : null;
}

/** The one way on from a stop's screen: v1's faint question after a faint or a fall, else the workout ends. */
export function afterStopScreen(route: WorkoutStopRoute): WorkoutSafety | "leave" {
  return route.then === "sf_faint_loc" ? { kind: "faint_ask", route } : "leave";
}

/**
 * The faint question's answer (v1 faintFollowUp, Q33 (3)): yes or not sure opens the emergency screen,
 * with the dysreflexia screen beside it for a spinal cord injury; no shows the stop's screen again.
 * Either way the workout then ends.
 */
export function afterFaintAnswer(
  route: WorkoutStopRoute,
  value: "yes" | "no" | "unsure",
  env: PrecheckEnv,
  now: number,
): WorkoutSafety {
  const { then: _then, ...rest } = route;
  void _then;
  const out = faintFollowUp(value, now);
  if (out.status !== "emergency") return { kind: "screen", route: rest };
  return {
    kind: "screen",
    route: { ...rest, screen: out.screen ?? "scr_emergency", alsoShow: emergencyAlsoShow(env) },
  };
}

/**
 * The text of the screen the person sees, for repeat_instructions: the placement and the one line
 * attestation, a timer's line, the camera part's line, a camera set's exercise and how to stand for it,
 * a guided card's steps, the end card.
 */
export function workoutInstructions(stage: WorkoutStage, step: SessionStep | null, lang: Lang): string {
  const c = labels(lang),
    k = camCopy(lang),
    g = guidedCopy(lang);
  // Each piece a sentence (a heading gets its full stop), joined by a space.
  const join = (...parts: (string | null | undefined)[]) =>
    parts
      .map((p) => (p ?? "").trim())
      .filter((p) => p !== "")
      .map((p) => (/[.!?؟]$/.test(p) ? p : `${p}.`))
      .join(" ");
  if (step?.kind === "camera" && stage === "set") {
    const def = EXERCISES.find((e) => e.id === step.prescription.exerciseId);
    return join(def?.name[lang], def?.description[lang], def?.camera[lang]);
  }
  if (step?.kind === "camera" && stage === "intro") {
    const def = EXERCISES.find((e) => e.id === step.prescription.exerciseId);
    return join(def?.name[lang] ?? g.cameraKicker, g.cameraBody);
  }
  if (step?.kind === "card" && stage === "card") {
    const ex = libraryById(step.item.id);
    return join(ex?.name[lang], ...(ex?.steps[lang] ?? []));
  }
  switch (stage) {
    case "setup":
      return join(k.placeReminder, c.attest);
    case "warmup":
      return join(c.warmup, c.warmupBody);
    case "rest":
      return join(c.restTitle, c.restBody);
    case "cooldown":
      return join(c.cooldown, c.cooldownBody);
    case "done":
      return join(c.done, c.doneBody);
    default:
      return join(g.cameraKicker, g.cameraBody);
  }
}
