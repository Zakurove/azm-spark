/**
 * The booth v2 journey (contract C): a pure state machine, so every step, its order, the progress
 * dots, the resets and the camera's setup are tested without a browser. Nothing in it is stored: a
 * reset (staff, idle, or the end) drops the visitor's answers, the reading and the result at once.
 *
 *   home      the two doors: «قصة سعد» · Saad's story, «جرّبه بنفسك» · Try it as yourself
 *   1 report  (story) Saad's sample report, read live, with the cached reading after 8 s
 *     about   (self) three taps: condition (and clearance when it is needed), position, weaker side
 *   2 engine  createPlan on the phone: included, adapted, excluded with the reason
 *   3 goal    the goal chips, «العودة إلى الرياضة» · Back to sport opens the sport grid
 *   4 safety  one question before the camera; yes stops calmly (stop), no opens the camera
 *     camera  the camera screen in variant booth: the seated shoulder press, 5 reps
 *   5 results the starting point: the elbow range in degrees, the reps, the steady reps
 *   6 program the week, the sport path and the register code
 *
 * A plan the rules hold for review skips the camera: the engine shows why, and the program step
 * shows the review with the register code (rules before AI, and before the camera too).
 */
import type { SessionSummary } from "../../engine/types";
import type { Setup } from "../../app/product";
import type { Intake, Plan } from "../../medical/plan";
import type { SportId } from "../../medical/sports";
import {
  EMPTY_SELF,
  conditionsDone,
  planFor,
  selfBase,
  selfFromExtraction,
  storyBase,
  type Goal,
  type SelfAnswers,
} from "./intake";
import { SAAD_EXTRACTION, SAAD_GOAL, type BoothExtraction } from "./story";

export type Door = "story" | "self";
export type StepId =
  "home" | "report" | "about" | "engine" | "goal" | "safety" | "stop" | "camera" | "results" | "program";

/** The six dots of the progress row and the steps each one covers. */
export const DOTS: readonly (readonly StepId[])[] = [
  ["report", "about"],
  ["engine"],
  ["goal"],
  ["safety", "stop", "camera"],
  ["results"],
  ["program"],
];

/** The dot of a step (0 to 5), or -1 on the home screen. */
export function dotOf(step: StepId): number {
  return DOTS.findIndex((d) => d.includes(step));
}

/** Contract C9: steps 5 and 6 go back to the doors after 90 s without a touch. */
export const IDLE_MS = 90_000;
/** The calm "starting again" note shows this long before the idle reset. */
export const IDLE_NOTE_MS = 12_000;
export const idleResets = (step: StepId) => step === "results" || step === "program";

/** The booth's set: the seated shoulder press, 5 reps (contract C6). */
export const BOOTH_EXERCISE = "seated_shoulder_press";
export const BOOTH_REPS = 5;

export interface Reading {
  extraction: BoothExtraction;
  /** live: the reading engine answered; cached: the booth's own reading of the sample report. */
  source: "live" | "cached";
}

export interface Journey {
  step: StepId;
  door: Door | null;
  /** The tap screen of "Try it as yourself": 0 condition, 1 position, 2 weaker side. */
  tap: 0 | 1 | 2;
  self: SelfAnswers;
  reading: Reading | null;
  goal: Goal | null;
  sport: SportId | null;
  summary: SessionSummary | null;
  /** Each camera attempt has its own key, so a retry starts a fresh camera screen. */
  attempt: number;
  /** The direction of the last move: the step transition slides with it (mirrored in RTL). */
  dir: 1 | -1;
}

export type JourneyEvent =
  | { type: "OPEN"; door: Door }
  | { type: "READ"; extraction: BoothExtraction; source: Reading["source"] }
  | { type: "TAP"; answers: Partial<SelfAnswers> }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "GOAL"; goal: Goal }
  | { type: "SPORT"; sport: SportId }
  | { type: "SAFETY"; unwell: boolean }
  | { type: "CAMERA_DONE"; summary: SessionSummary }
  | { type: "CAMERA_EXIT" }
  | { type: "RETRY" }
  | { type: "RESET" };

export const START: Journey = {
  step: "home",
  door: null,
  tap: 0,
  self: EMPTY_SELF,
  reading: null,
  goal: null,
  sport: null,
  summary: null,
  attempt: 0,
  dir: 1,
};

/** The intake of the journey so far and its plan (createPlan on the phone). */
export function journeyPlan(j: Journey): { intake: Intake; plan: Plan } {
  const base =
    j.door === "story"
      ? storyBase(j.reading?.extraction ?? SAAD_EXTRACTION)
      : selfBase(j.self, j.reading?.extraction);
  return planFor(base, j.goal ?? "strength", j.sport);
}

/** Who moves in front of the camera: Saad's story uses the wheelchair profile, a visitor their own. */
export function cameraSetup(j: Journey): Setup {
  if (j.door === "story") return { position: "wheelchair", support: "none" };
  return {
    position: j.self.position === "wheelchair" ? "wheelchair" : "chair",
    support: j.self.side ?? "none",
  };
}

/** Whether the step's primary action can go on. */
export function canGoOn(j: Journey): boolean {
  switch (j.step) {
    case "report":
      return j.reading !== null;
    case "about":
      if (j.tap === 0) return conditionsDone(j.self);
      if (j.tap === 1) return j.self.position !== null;
      return j.self.side !== null;
    case "goal":
      return j.goal !== null && (j.goal !== "sport" || j.sport !== null);
    case "results":
    case "engine":
      return true;
    default:
      return false;
  }
}

const go = (j: Journey, step: StepId, dir: 1 | -1 = 1): Journey => ({ ...j, step, dir });

export function journeyReducer(j: Journey, e: JourneyEvent): Journey {
  switch (e.type) {
    case "RESET":
      return { ...START, attempt: j.attempt + 1, dir: -1 };
    case "OPEN":
      if (j.step !== "home") return j;
      return e.door === "story"
        ? {
            ...START,
            attempt: j.attempt,
            door: "story",
            step: "report",
            goal: SAAD_GOAL.goal,
            sport: SAAD_GOAL.sport,
          }
        : { ...START, attempt: j.attempt, door: "self", step: "about" };
    case "READ": {
      if (j.step !== "report" && j.step !== "about") return j;
      const reading: Reading = { extraction: e.extraction, source: e.source };
      if (j.door === "self") return { ...j, reading, self: selfFromExtraction(j.self, e.extraction) };
      return { ...j, reading };
    }
    case "TAP": {
      if (j.step !== "about") return j;
      const self = { ...j.self, ...e.answers };
      // A new condition list asks clearance again only when it is needed (and drops a stale one).
      if (e.answers.conditions && !("clearance" in e.answers)) self.clearance = null;
      return { ...j, self };
    }
    case "GOAL":
      if (j.step !== "goal") return j;
      return { ...j, goal: e.goal, sport: e.goal === "sport" ? j.sport : null };
    case "SPORT":
      if (j.step !== "goal" || j.goal !== "sport") return j;
      return { ...j, sport: e.sport };
    case "NEXT":
      if (!canGoOn(j)) return j;
      switch (j.step) {
        case "report":
          return go(j, "engine");
        case "about":
          return j.tap < 2 ? { ...j, tap: (j.tap + 1) as 1 | 2, dir: 1 } : go(j, "engine");
        case "engine":
          // The rules held the plan for review: no camera, the program step says why.
          return journeyPlan(j).plan.status === "review" ? go(j, "program") : go(j, "goal");
        case "goal":
          return go(j, "safety");
        case "results":
          return go(j, "program");
        default:
          return j;
      }
    case "BACK":
      switch (j.step) {
        case "report":
          return { ...START, attempt: j.attempt, dir: -1 };
        case "about":
          return j.tap > 0
            ? { ...j, tap: (j.tap - 1) as 0 | 1, dir: -1 }
            : { ...START, attempt: j.attempt, dir: -1 };
        case "engine":
          return go(j, j.door === "story" ? "report" : "about", -1);
        case "goal":
          return go(j, "engine", -1);
        case "safety":
          return go(j, "goal", -1);
        case "stop":
          return go(j, "safety", -1);
        case "results":
          return go(j, "safety", -1);
        case "program":
          return go(j, j.summary ? "results" : "engine", -1);
        default:
          return j;
      }
    case "SAFETY":
      if (j.step !== "safety") return j;
      return e.unwell ? go(j, "stop") : { ...go(j, "camera"), attempt: j.attempt + 1 };
    case "CAMERA_DONE":
      if (j.step !== "camera") return j;
      return { ...go(j, "results"), summary: e.summary };
    case "CAMERA_EXIT":
      if (j.step !== "camera") return j;
      return go(j, "safety", -1);
    case "RETRY":
      if (j.step !== "results") return j;
      return { ...go(j, "camera", -1), summary: null, attempt: j.attempt + 1 };
  }
}
