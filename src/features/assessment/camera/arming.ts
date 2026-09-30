/**
 * When the optional check in watches on the camera screens (D-016; UX spec 4.8). Pure.
 *
 *   part                           no movement   left frame
 *   setup, calibrate, countdown    off           off
 *   practice                       on            on
 *   scored attempt, moving         on            on
 *   hold, pause there              off           on
 *   saved, retry, rests            off           off
 *
 * No movement counts from the end of the current cue plus a 3 s grace; in the timed tests from
 * check_go plus 3 s, and never after the end cue.
 */
import type { CheckInFeedOptions } from "../../../engine/checkin";
import type { RunnerPhase } from "../../../engine/modes";
import type { TestId } from "../../../movements/types";

/** The part of the camera sequence the person is in, from the flow state and the runner phase. */
export type CamPart =
  "setup" | "calibrate" | "countdown" | "practice" | "attempt" | "hold" | "saved" | "retry" | "rest";

export interface ArmingInput {
  part: CamPart;
  testId: TestId;
  /** ms */
  now: number;
  /** When the current cue is expected to end (ms), or 0. */
  cueEndsAt: number;
  /** Timed tests: when check_go started, or null before the trial. */
  goAt: number | null;
  /** Timed tests: when the end cue started, or null. */
  endCueAt: number | null;
  graceSec: number;
}

export function armingFor(a: ArmingInput): Required<CheckInFeedOptions> {
  const cueClear = a.now >= a.cueEndsAt + a.graceSec * 1000;
  const timed = a.testId === "arm_curl_30s" || a.testId === "chair_stand_30s";
  switch (a.part) {
    case "practice":
      return { movement: cueClear, leftFrame: true };
    case "attempt": {
      const afterGo = a.goAt !== null && a.now >= a.goAt + a.graceSec * 1000;
      return { movement: cueClear && (!timed || (afterGo && a.endCueAt === null)), leftFrame: true };
    }
    case "hold":
      return { movement: false, leftFrame: true };
    default:
      return { movement: false, leftFrame: false };
  }
}

/** The part of the sequence for a flow state kind and the runner's phase. */
export function camPart(flowKind: string, runnerPhase: RunnerPhase | null, holding: boolean): CamPart {
  switch (flowKind) {
    case "cam.setup":
      return runnerPhase === "ready" ? "countdown" : "setup";
    case "cam.calibrate":
      return "calibrate";
    case "cam.countdown":
      return runnerPhase === "attempt" ? "attempt" : "countdown";
    case "cam.saved":
      return "saved";
    case "cam.retry":
      return "retry";
    case "cam.rest":
      return "rest";
    case "cam.practice":
    case "cam.measure":
      switch (runnerPhase) {
        case "calibrating":
          return "calibrate";
        case "ready":
        case "setup":
          return "countdown";
        case "rest":
        case "recentre":
        case "ask":
        case "settle":
        case "done":
          return "rest";
        case "practice":
          return holding ? "hold" : "practice";
        case "attempt":
        case "return":
          return holding ? "hold" : flowKind === "cam.practice" ? "practice" : "attempt";
        default:
          return flowKind === "cam.practice" ? "practice" : "attempt";
      }
    default:
      return "rest";
  }
}
