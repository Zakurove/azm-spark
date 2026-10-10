/**
 * The demo exercises (D-037 item 6): the exercises a person can do with the camera now, listed after
 * the program is made so Nasser can show them («we are building the library, and here is a set of
 * them»). Pure, so the list and what a demo run may do are tested in node
 * (tests/v7/e-demo-exercises.test.ts).
 *
 * The camera exercises are the camera workout's own (src/exercises/defs.ts EXERCISES, run by
 * WorkoutFlow on the camera screen src/app/Session.tsx): the seated shoulder press, the seated biceps
 * curl and the sit to stand, each counting its reps with its feedback. The movement check's range and
 * walk tests (src/movements, src/engine/modes) are measurements, not exercises, and are not listed.
 *
 * A demo run is the very camera screen of a workout set with nothing recorded: no workout is started
 * (POST /api/workouts), no set is saved (no onSave, POST /api/workouts/:id/sets), no Live coach session
 * is opened (no coach), so nothing counts toward the program, the weekly dose or the workouts.
 */
import type { Lang } from "../../app/i18n";
import type { Setup } from "../../app/product";
import { EXERCISES } from "../../exercises/defs";

export type DemoArea = "shoulders" | "elbows" | "legs";
export type DemoView = "front" | "side" | "angle";

export interface DemoExercise {
  /** The camera exercise (EXERCISES). */
  id: string;
  /** Its picture, from the existing illustrations. */
  picture: string;
  /** The body area it works (targets.demo.area.*). */
  area: DemoArea;
  /** How the person sits to the camera (targets.demo.view.*). */
  view: DemoView;
  /** The camera screen's setup: seated in a chair, or rising from it. */
  setup: Setup;
  /** Reps of a demo set (the camera trial's counts, src/app/TryCamera.tsx). */
  reps: number;
}

export const DEMO_EXERCISES: readonly DemoExercise[] = [
  {
    id: "seated_shoulder_press",
    picture: "/illustrations/landing/chair-press.webp",
    area: "shoulders",
    view: "front",
    setup: { position: "chair", support: "none" },
    reps: 6,
  },
  {
    id: "seated_biceps_curl",
    picture: "/illustrations/landing/chair-curl.webp",
    area: "elbows",
    view: "side",
    setup: { position: "chair", support: "none" },
    reps: 6,
  },
  {
    id: "sit_to_stand",
    picture: "/illustrations/landing/standing.webp",
    area: "legs",
    view: "angle",
    setup: { position: "rise", support: "none" },
    reps: 4,
  },
];

export const demoExercise = (id: string): DemoExercise | undefined => DEMO_EXERCISES.find((d) => d.id === id);

/** The exercise's name, as the camera screen names it. */
export const demoName = (d: DemoExercise, lang: Lang) =>
  EXERCISES.find((e) => e.id === d.id)?.name[lang] ?? d.id;

/** A demo run on the list: the exercise, and `simulated` once the camera could not open (its mannequin). */
export interface DemoRun {
  id: string;
  simulated: boolean;
  /** A new run of the same exercise (Repeat) mounts a fresh camera screen. */
  n: number;
}

/**
 * What the camera screen gets for a demo run: the real camera (`demo` false, unless the camera could
 * not open and the person chose to watch the mannequin), the workout's screen and its counting, marked
 * `unsaved`, with no onSave, no onContinue, no coach and no coach button. Only the ways back to the list
 * (`onExit`), again (`onRestart`) and to the mannequin (`onDemo`).
 */
export function demoSessionProps(
  d: DemoExercise,
  run: Pick<DemoRun, "simulated">,
  on: { back(): void; again(): void; simulate(): void },
) {
  return {
    setup: d.setup,
    exerciseId: d.id,
    demo: run.simulated,
    unsaved: true as const,
    variant: "workout" as const,
    targetReps: d.reps,
    onExit: on.back,
    onRestart: on.again,
    onDemo: on.simulate,
  };
}
