/**
 * Check in arming on the camera screens (UX spec 4.8 as amended by the council, O34-6). Pure.
 *
 *   part                           no movement   sway   left frame   hips drop
 *   setup, calibrate, countdown    off           on     off          on
 *   practice                       on            on     on           on
 *   scored attempt, moving         on            on     on           on
 *   hold, pause there, a cue       paused        on     on           on
 *   saved, retry, rests            off           on     off (1)      on
 *
 *   (1) on for the first 60 s after the chair stand ends (O34-6 (3)).
 *
 * No movement counts 10 s from the end of the current cue plus a 3 s grace; in the timed tests from
 * check_go plus 3 s, and never from the end cue until the next cue has ended plus 3 s (O34-6 (4)).
 * Hips drop has no switch: the detector always evaluates it (on in every camera state).
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
  /** When the chair stand trial ended, or null. */
  standEndedAt: number | null;
  /** The side lean's own sway limit during a lean (its abort limit plus the margin), if any. */
  leanSwayDeg?: number;
  graceSec: number;
  standLeftFrameSec: number;
}

export function armingFor(a: ArmingInput): CheckInFeedOptions {
  const grace = a.graceSec * 1000;
  const cueClear = a.now >= a.cueEndsAt + grace;
  const timed = a.testId === "arm_curl_30s" || a.testId === "chair_stand_30s";
  let movement = false;
  let leftFrame = false;
  switch (a.part) {
    case "setup":
    case "calibrate":
    case "countdown":
      break;
    case "practice":
      movement = cueClear;
      leftFrame = true;
      break;
    case "attempt":
      if (timed) {
        const afterGo = a.goAt !== null && a.now >= a.goAt + grace;
        const ended = a.endCueAt !== null;
        movement = afterGo && !ended && cueClear;
      } else movement = cueClear;
      leftFrame = true;
      break;
    case "hold":
      leftFrame = true;
      break;
    case "saved":
    case "retry":
    case "rest":
      leftFrame =
        a.testId === "chair_stand_30s" &&
        a.standEndedAt !== null &&
        a.now - a.standEndedAt <= a.standLeftFrameSec * 1000;
      break;
  }
  const sway: CheckInFeedOptions = { sway: true };
  if (a.leanSwayDeg !== undefined && (a.part === "attempt" || a.part === "practice" || a.part === "hold"))
    sway.swayDeg = a.leanSwayDeg;
  return { ...sway, movement, leftFrame };
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
