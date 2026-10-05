/**
 * Types of the v7 range of motion runner (product v7 contract 2.6). The RomRunner class lives in
 * src/engine/rom/runner.ts and the compensation checks in src/engine/rom/compensations.ts (stream B);
 * every shared shape is here so the other streams compile against it from Gate A. Pure types, no DOM.
 */
import type { QualityIssue, QualityReport } from "../quality";
import type { QualitySummary } from "../modes/types";
import type { Landmark } from "../types";
import type { AngleContext } from "./angles";
import type { RomProtocolItem, RomReasonId } from "../../medical/rom-protocol";
import type {
  CompensationId,
  RomCopyKey,
  RomCueId,
  RomMovementDef,
  RomMovementId,
  RomPositionId,
  RomSide,
} from "../../movements/rom/types";
import type { SubjectLock } from "../subject";
import type { CheckCueId } from "../../movements/types";

export type RomPhase =
  | "idle"
  | "calibrating"
  | "practice"
  | "attempt"
  | "ask_can_move"
  | "ask_max"
  | "ask_pain"
  | "ask_cause"
  | "rest"
  | "paused"
  | "stopped"
  | "done";
export type RomAnswer = "yes" | "not_yet" | "hurts";
export type LimitCause = "tight" | "pain" | "weak";
export type AnswerSource = "button" | "voice" | "timeout";
export type RomFlag =
  | "smallExcursion"
  | "wideHold"
  | "elevationOverRead"
  | "gravityMode"
  | "approximate"
  | "bentElbow"
  | "unconfirmed"
  | "inconsistent"
  | "provisional"
  | "ageOutsideBand"
  | "modelLite"
  | "helperPresent"
  /**
   * The seated side bend (seated_armrests) reached its limit or leaned too fast (v1.1 side lean abort
   * rules, coaching cues): the value is a lower bound, the lean held at the limit (v1.1 censoring).
   */
  | "censored";

export interface RomRunnerOptions {
  item: RomProtocolItem;
  def: RomMovementDef;
  mirrored?: boolean;
  subject?: SubjectLock;
  /** default 5 (engine.restBetweenAttemptsSeconds 5 to 10) */
  restSec?: number;
  /** The region's pain today (pain_ask), for the pain_during rule. Null or absent (a region that is not a body map pain region) counts as 0. */
  painBefore?: number | null;
  /** The norm's withinFrom (withinUpTo for lack movements) from normFor; a confirmed value short of it opens ask_cause once. null: never ask. */
  askCauseBelow: number | null;
  poseModel: "lite" | "full";
  /**
   * The seated side bend (trunk_lateral_flexion in seated_armrests) only: the side's best seated side
   * lean at the last check («never beyond the person's best side lean at the last check», rom-protocol
   * 3.12 and safety seated_side_lean_gate). Absent or null: a first check, the v1.1 limit of 30.
   */
  sideLeanBest?: number | null;
}

export interface RomHold {
  /** unique per hold, `${attempt}:${n}` */
  holdId: string;
  /** Hampel then median of the hold window, whole degrees */
  deg: number;
  t: number;
  attempt: number;
  excursionDeg: number;
  bandDeg: 3 | 5;
  smallExcursion: boolean;
}

export type RomEvent =
  | { kind: "phase"; phase: RomPhase; t: number; attempt: number }
  /** One Euro filtered angle for the dial, every frame the gate landmarks are seen. */
  | { kind: "live"; deg: number; t: number }
  /** Velocity under 8 degrees per second for 0.4 s inside a 3 degree band (tunable): the coach may get ready. */
  | { kind: "plateau"; deg: number; t: number; attempt: number }
  /** The end range hold (engine.holdBandDeg for engine.holdSeconds after minExcursionDeg): the maximum question opens. */
  | { kind: "hold"; hold: RomHold }
  | { kind: "compensation"; id: CompensationId; level: "cue" | "invalid"; value: number; t: number }
  /**
   * A local voice pack line to play (cues, ask_max when the coach is off, recorded, pain_stop ...); the
   * side arm raise plays its v1 lines (test_abd_still, test_abd_side; D-024 item 2).
   */
  | { kind: "cue"; cue: RomCueId | RomCopyKey | CheckCueId; t: number }
  | { kind: "quality"; issue: QualityIssue; t: number }
  | { kind: "attempt"; record: RomAttempt }
  | { kind: "stop"; reason: "pain_stop" | "user_stop"; t: number }
  | { kind: "done"; t: number };

export interface RomAttempt {
  /** 0 practice, 1 to 3 scored */
  index: number;
  outcome: "valid" | "invalid" | "retry" | "practice";
  /** whole degrees in the movement's convention */
  value: number | null;
  answer: RomAnswer | "unconfirmed" | null;
  answerSource: AnswerSource | null;
  painLimited: boolean;
  painLevel: number | null;
  /** compensation ids, quality issues, no_hold */
  reasons: string[];
  flags: RomFlag[];
  /** engine/quality.ts, unchanged type */
  quality: QualityReport;
  t0: number;
  t1: number;
}

export interface AnswerResult {
  accepted: boolean;
  reason?: "wrong_phase" | "stale_hold" | "already_answered" | "stopped" | "after_pain";
  events: RomEvent[];
}
export interface PainResult extends AnswerResult {
  action: "continue" | "stop_movement";
}

export interface RomMeasureResult {
  movementId: RomMovementId;
  side: RomSide;
  position: RomPositionId;
  status: "measured" | "not_measured" | "stopped";
  /** quality, no_hold, no_active_movement, pain_stop ... */
  reason: RomReasonId | null;
  /** best valid attempt */
  value: number | null;
  median: number | null;
  nValid: number;
  painLimited: boolean;
  painLevel: number | null;
  painBefore: number | null;
  cause: LimitCause | null;
  /** scored only, at most 3 */
  attempts: RomAttempt[];
  /** at most 1 */
  practice: RomAttempt[];
  /** at most 2 (v1.1) */
  retries: number;
  flags: RomFlag[];
  /** engine/modes/types.ts, unchanged type */
  quality: QualitySummary;
  poseModel: "lite" | "full";
  movementVersion: number;
  /** ROM_ENGINE_VERSION */
  engineVersion: string;
  durationSec: number;
}

/**
 * One compensation check of a movement (stream B fills COMPENSATIONS in compensations.ts with code
 * constants, each quoting its clinical text, tested against ROM_DATA.movements[].compensations: ids,
 * cue lines, cueAt and invalidAt). The cue is a v7 cue, or a v1 arm raise line for the side arm raise
 * (test_abd_still, test_abd_side; D-024 item 2).
 */
export interface CompensationCheck {
  id: CompensationId;
  measure(px: Landmark[], ctx: AngleContext): number | null;
  cueAt: number | null;
  invalidAt: number | null;
  cue: RomCueId | CheckCueId | null;
}
