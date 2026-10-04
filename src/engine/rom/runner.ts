/**
 * The range of motion runner (product v7 contract 2.6, stream B, step B1): calibration, one practice,
 * up to three scored attempts held at the end range, the maximum, pain, cause and can move questions,
 * quality retries and compensations, generalised from the v1 arm raise (RangeTestRunner stays the
 * parity oracle). Pure, no DOM.
 *
 * Placeholder of step A5 (contract 1.3), replaced by B1: every member throws; nothing in stream A
 * creates a runner.
 */
import type { Frame } from "../types";
import type { FeedEnv } from "../modes/types";
import type {
  AnswerResult,
  AnswerSource,
  LimitCause,
  PainResult,
  RomAnswer,
  RomEvent,
  RomHold,
  RomMeasureResult,
  RomPhase,
  RomRunnerOptions,
} from "./types";

function notBuilt(): never {
  throw new Error("RomRunner is not built yet (stream B)");
}

export class RomRunner {
  constructor(_opts: RomRunnerOptions) {
    notBuilt();
  }
  get phase(): RomPhase {
    return notBuilt();
  }
  get done(): boolean {
    return notBuilt();
  }
  get currentHold(): RomHold | null {
    return notBuilt();
  }
  start(_t: number): RomEvent[] {
    return notBuilt();
  }
  feed(_frame: Frame, _env?: FeedEnv): RomEvent[] {
    return notBuilt();
  }
  answerCanMove(_canMove: boolean, _t: number): RomEvent[] {
    return notBuilt();
  }
  /** First answer per hold wins; a not_yet resumes the attempt and a later hold replaces the value only if further. */
  answerMax(_holdId: string, _answer: RomAnswer, _source: AnswerSource, _t: number): AnswerResult {
    return notBuilt();
  }
  /** painStopRule(level, sharp, painBefore) -> stop_movement, the last valid hold kept as pain limited. */
  answerPain(_level: number, _sharp: boolean, _source: AnswerSource, _t: number): PainResult {
    return notBuilt();
  }
  answerCause(_cause: LimitCause, _source: AnswerSource, _t: number): AnswerResult {
    return notBuilt();
  }
  /** Only right after a not_yet; rejected after hurts, a pain answer or a recorded value (safety coach_end_range). Extends the attempt by 10 s. */
  keepReaching(_t: number): AnswerResult {
    return notBuilt();
  }
  pause(_t: number): RomEvent[] {
    return notBuilt();
  }
  /** Rejected after a stop. */
  resume(_t: number): AnswerResult {
    return notBuilt();
  }
  stop(_reason: "pain_stop" | "user_stop", _t: number): RomEvent[] {
    return notBuilt();
  }
  finish(_t: number): RomMeasureResult {
    return notBuilt();
  }
}
