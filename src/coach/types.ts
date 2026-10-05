/**
 * Live coach types (product v7 contract 2.11): the bridge events, the tools and their results, the
 * host interface, the transport, and the coach hook's options and state. Everything that uses them
 * (formatEvent, TOOL_SETS, TOOL_BEHAVIOR, toolDeclarations, parseToolArgs, buildInstruction, the
 * transport classes, MicCapture, Speaker, EventBridge, useCoach) belongs to stream D; the shapes are
 * here so every stream compiles against them from Gate A.
 *
 * The app is authoritative: the coach never overrides a safety stop, a red flag or the dose, and no
 * transport sends images, video or landmarks (C-12). Pure types, no DOM.
 */
import type { CompensationId, RomMovementId, RomSide } from "../movements/rom/types";
import type { Lang, StopOptionId } from "../movements/types";
import type { CueId, Severity } from "../engine/types";
import type { GaitView } from "../engine/gait/types";
import type { LimitCause, RomAnswer } from "../engine/rom/types";
import type { RegionId } from "../medical/body-map";
import type { RomBlock } from "../medical/rom-protocol";
import type { RomFindingId } from "../medical/rom-types";

/* --------------------------------------------------------------- events */

export type CoachBlock = "rom" | "gait" | "session";
export type BridgeEvent =
  | { p: 0; type: "safety_stop"; reason: "pain_stop" | "user_stop" | "trunk_safety" | "stop_list"; t: number }
  | { p: 0; type: "red_flag"; screen: string; t: number }
  | {
      p: 1;
      type: "end_range_hold";
      holdId: string;
      movement: RomMovementId;
      side: RomSide;
      deg: number;
      typical: number | null;
      t: number;
    }
  | { p: 1; type: "ask_pain"; movement: RomMovementId; side: RomSide; t: number }
  | { p: 1; type: "ask_cause"; movement: RomMovementId; side: RomSide; t: number }
  | { p: 1; type: "ask_can_move"; movement: RomMovementId; side: RomSide; t: number }
  | {
      p: 2;
      type: "compensation";
      movement?: RomMovementId;
      kind: CompensationId | CueId;
      value?: number;
      t: number;
    }
  | { p: 2; type: "setup_issue"; issue: string; t: number }
  | { p: 3; type: "step_start"; label: string; movement?: RomMovementId; side?: RomSide; t: number }
  | { p: 3; type: "attempt_saved"; movement: RomMovementId; side: RomSide; deg: number | null; t: number }
  | {
      p: 3;
      type: "movement_result";
      movement: RomMovementId;
      side: RomSide;
      deg: number | null;
      typical: number | null;
      finding: RomFindingId;
      t: number;
    }
  | { p: 3; type: "reps"; exercise: string; count: number; target: number; t: number }
  | { p: 3; type: "pass_done"; view: GaitView; cleanCycles: number; needed: number; t: number }
  | { p: 3; type: "asked_locally"; what: "ask_max" | "ask_pain" | "ask_cause" | "ask_can_move"; t: number }
  /** The outcome of a tool call whose cancellation arrived after the app applied it (C-17). */
  | { p: 3; type: "tool_applied"; name: ToolName; accepted: boolean; t: number };
/** What a host or a step hands its events to (GaitStep and Session take one, 2.8.4). */
export type CoachPush = (e: BridgeEvent) => void;

/* ---------------------------------------------------------------- tools */

export type ToolName =
  | "confirm_max"
  | "answer_can_move"
  | "keep_reaching"
  | "mark_pain"
  | "set_limit_cause"
  | "pause"
  | "resume"
  | "stop"
  | "next_step"
  | "repeat_instructions";
/** The stop options the coach may preselect (a subset of v1 StopOptionId, src/movements/types.ts). */
export type CoachStopReason = Extract<
  StopOptionId,
  "chest" | "stroke_signs" | "faint" | "breath" | "fall" | "pain" | "tired" | "choice" | "other"
>;
export interface ToolArgs {
  confirm_max: { movement: RomMovementId; side: RomSide; answer: RomAnswer };
  answer_can_move: { movement: RomMovementId; side: RomSide; canMove: boolean };
  keep_reaching: Record<string, never>;
  /** level integer 0 to 10; location when the person names it (the rule does not need it, C-15). */
  mark_pain: { level: number; sharp?: boolean; location?: RegionId };
  set_limit_cause: { cause: LimitCause };
  pause: Record<string, never>;
  resume: Record<string, never>;
  stop: { reason: CoachStopReason };
  next_step: Record<string, never>;
  repeat_instructions: Record<string, never>;
}

export interface ToolResult {
  accepted: boolean;
  reason?:
    | "unknown_tool"
    | "invalid_args"
    | "wrong_phase"
    | "stale_hold"
    | "already_answered"
    | "safety_stop"
    | "after_pain"
    | "not_in_block"
    | "not_allowed"
    | "paused_on_screen"
    /** D-022 (S0-2): an answer tool with no speech from the person since the question (mark_pain: in the last 10 s). */
    | "no_answer_heard";
  /** A copy key the coach should convey in its own words (for example keep_going, recorded, pain_stop, hold_still, tap_to_confirm). */
  say?: string;
  data?: Record<string, number | string | boolean | null>;
}

/* ---------------------------------------------------------------- hosts */

/**
 * The kind of the step a host shows (C-16).
 * info: an instruction card. confirm: a tap the person or the helper must make (gait setup clear path and support nearby,
 * each pad safety step of gait-rules eligibility.padSafety, helper present pc_helper, the v1 helper briefing, "ready").
 * question: pre-check, today questions, rf_region, pain, can move, cause, maximum. timer: rest, the sit before stand minute.
 * safety: the stop list, the emergency screen, seek care, a pain stop. active: a measurement, a walk, an exercise.
 */
export type CoachStepKind = "info" | "confirm" | "question" | "timer" | "safety" | "active";
/** Implemented by the focus RomController (B), the GaitController (C) and the session controller (D). */
export interface CoachHost {
  readonly block: CoachBlock;
  /** The current step's kind and whether an active step has finished. */
  step(): { kind: CoachStepKind; finished: boolean };
  /** The app is authoritative: validate against the engine state, apply at once, answer (C-17). Never throws. */
  handleTool<N extends ToolName>(name: N, args: ToolArgs[N]): ToolResult;
  /** A short state line for a new session's history (current step, phase). */
  snapshot(): string;
}

/* ------------------------------------------------------------ transport */

export interface LiveConnectOptions {
  token: string;
  model: string;
  apiVersion: "v1beta" | "v1alpha";
  /** Server built, from the token response; the client sends it first (initialHistoryInClientContent). Not locked by the token (C-6). */
  history: { role: "user" | "model"; text: string }[];
}
export type TransportEvent =
  | { type: "setupComplete"; ms: number }
  | { type: "audio"; pcm24k: ArrayBuffer }
  | { type: "inputTranscript"; text: string; final: boolean }
  | { type: "outputTranscript"; text: string }
  | { type: "interrupted" }
  | { type: "turnComplete" }
  | { type: "toolCall"; calls: { id: string; name: string; args: unknown }[] }
  | { type: "toolCallCancellation"; ids: string[] }
  | { type: "goAway"; timeLeftMs: number }
  | { type: "usage"; promptTokens: number; responseTokens: number }
  | { type: "error"; code: string }
  | { type: "close"; code: number; reason: string };
/** GenaiTransport (wraps @google/genai ai.live.connect, lazy import) and FakeLiveTransport (tests) implement it. No method sends images, video or landmarks (C-12). */
export interface LiveTransport {
  connect(opts: LiveConnectOptions): Promise<void>;
  /** mono, little endian, 20 to 40 ms */
  sendAudio(pcm16k: ArrayBuffer): void;
  audioStreamEnd(): void;
  /** sendClientContent, role user */
  sendContext(text: string, turnComplete: boolean): void;
  sendToolResponse(
    r: {
      id: string;
      name: string;
      response: ToolResult;
      scheduling?: "SILENT" | "WHEN_IDLE" | "INTERRUPT";
    }[],
  ): void;
  close(): void;
  on(fn: (e: TransportEvent) => void): () => void;
}

/* --------------------------------------------------------------- bridge */

export interface BridgeOptions {
  /** 2000: at most one model triggering event per 2 s (P0 exempt) */
  minGapMs: number;
  /** 5000: P3 coalesced and sent silently (turnComplete false) */
  contextFlushMs: number;
  /** 1500: a P1 the coach has not started to voice is asked by the local voice pack */
  localFallbackMs: number;
}
export type CoachMode = "off" | "connecting" | "live" | "local";
/**
 * The local voice pack and caption path (CuePlayer + FeedbackGate), used for P0 and P2 always and for P1 in local mode.
 * onPlaying reports the start and end of each local line, for the mic gate (bridge rule 3).
 */
export interface LocalVoice {
  say(line: string, severity: Severity): void;
  stopAll(): void;
  readonly playing: boolean;
  /**
   * A safety line is playing (the host's own stop or pain line): the bridge's P0 stop line is then not
   * said again (rule 1). Absent: unknown, read as `playing` (wave 2 fix, contract gap W2-14).
   */
  readonly playingSafety?: boolean;
  onPlaying(fn: (playing: boolean) => void): () => void;
}

/* ------------------------------------------------------------ the hook */

/** A coach segment (C-6, 5.1): rom:seated:1, rom:seated:2, rom:standing:1, rom:lying:1, gait, session:1, session:2. */
export type CoachSegment = `rom:${RomBlock}:${1 | 2}` | "gait" | `session:${1 | 2}`;
export interface CoachOptions {
  block: CoachBlock;
  segment: CoachSegment;
  lang: Lang;
  ref: { checkId: string } | { workoutId: string };
  host: CoachHost;
  local: LocalVoice;
}
export interface CoachState {
  mode: CoachMode;
  speaking: boolean;
  captions: { who: "coach" | "person"; text: string }[];
  push(e: BridgeEvent): void;
  /** Bridge rule 1: after a P0 only the app opens the bridge again, once the person goes on (D-026 item 8, DG-4). */
  reopen(): void;
  end(reason: string): void;
}
