/**
 * The wire shapes of the live coach routes (product v7 contract 5.1 and 5.2, stream D). The client's
 * coach hook (src/features/coach-agent, D4) imports them as types only.
 */
import type { CoachEndReason } from "../../../src/coach/events";
import type { HistoryTurn } from "../../../src/coach/instruction";
import type { CoachBlock, CoachSegment, ToolName } from "../../../src/coach/types";
import type { SilenceMs } from "./token";

/** POST /api/agent/token (5.1). */
export interface TokenRequest {
  block: CoachBlock;
  /** One of segmentsFor(stored protocol, gait plan), or a workout's session:1 and session:2. */
  segment: CoachSegment;
  lang: "ar" | "en";
  /** rom and gait: an open focus check; session: a workout of today. */
  ref: { checkId: string } | { workoutId: string };
  /** 16 to 64 of [A-Za-z0-9_-], random per install (localStorage azm.device); stored only as its SHA-256. */
  deviceId: string;
  /** The person's pause length preference (S0: 800 by default). */
  silenceMs?: SilenceMs;
}

export interface TokenResponse {
  /** agent_sessions.id: the same for every re-mint of the segment. */
  sessionId: string;
  /** auth_tokens/... (the token's name) */
  token: string;
  model: string;
  apiVersion: "v1beta" | "v1alpha";
  voice: string;
  expiresAt: string;
  newSessionExpiresAt: string;
  /** Server built from stored state; the client sends it first (C-6). */
  history: HistoryTurn[];
  /** The person's coach minutes left today after this reservation. */
  minutesLeft: number;
}

/**
 * POST /api/agent/usage (5.2): one report describes the whole segment so far (every connection of
 * the session id), so a later report replaces the counts of an earlier one; its minutes never lower
 * the count (5.1).
 */
export interface UsageReport {
  sessionId: string;
  /** to setupComplete */
  connectMs: number | null;
  /** 0 to 3600 */
  durationSec: number;
  /** 0 to 500 */
  turns: number;
  toolCalls: Partial<Record<ToolName, { ok: number; rejected: number }>>;
  /** summed usageMetadata */
  promptTokens: number | null;
  responseTokens: number | null;
  /** event to first audio, P1 only */
  firstAudioMs: { p50: number; p90: number } | null;
  endReason: CoachEndReason;
}
