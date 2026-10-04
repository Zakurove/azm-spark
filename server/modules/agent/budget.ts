/**
 * The live coach's budget and its session rows (product v7 contract 5.1, 5.2 and section 3: the
 * agent_sessions JSON is written and read only here). Nothing here logs, and no transcript, audio,
 * event text or tool argument is ever stored: tool_calls holds counts per tool name.
 *
 * The budget never trusts the client. A segment's counted minutes are max(minutes_reserved,
 * minutes_used): a usage report can raise the count, never lower it. The first mint for a (person,
 * ref, segment) inserts its row with the segment's minutes reserved; a re-mint for the same segment
 * (an unused prewarm whose window passed, a goAway, a transport error) updates the same row, one
 * re-mint and AZM_AGENT_REMINT_MINUTES more each, at most AZM_AGENT_REMINTS. A new reservation or a
 * re-mint must fit the person's counted minutes today (Riyadh day) and every person's.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CoachBlock, CoachSegment, ToolName } from "../../../src/coach/types";
import type { CoachEndReason } from "../../../src/coach/events";
import type { AgentConfig } from "./token";
import type { UsageReport } from "./types";

export interface AgentSession {
  id: string;
  userId: string;
  block: CoachBlock;
  segment: CoachSegment;
  /** The focus check or the workout. */
  ref: string;
  remints: number;
  /** The Riyadh day of the first mint. */
  day: string;
  /** SHA-256 of the client device id. */
  device: string;
  model: string;
  instructionVersion: string;
  minutesReserved: number;
  minutesUsed: number | null;
  connectMs: number | null;
  turns: number | null;
  toolCalls: Partial<Record<ToolName, { ok: number; rejected: number }>> | null;
  promptTokens: number | null;
  responseTokens: number | null;
  endReason: CoachEndReason | null;
  minted: number;
  reported: number | null;
}

interface Row {
  id: string;
  user_id: string;
  block: CoachBlock;
  segment: CoachSegment;
  ref: string;
  remints: number;
  day: string;
  device: string;
  model: string;
  instruction_version: string;
  minutes_reserved: number;
  minutes_used: number | null;
  connect_ms: number | null;
  turns: number | null;
  tool_calls: string | null;
  prompt_tokens: number | null;
  response_tokens: number | null;
  end_reason: CoachEndReason | null;
  minted: number;
  reported: number | null;
}

const num = (v: number | null) => (v === null ? null : Number(v));

function toSession(r: Row): AgentSession {
  return {
    id: r.id,
    userId: r.user_id,
    block: r.block,
    segment: r.segment,
    ref: r.ref,
    remints: Number(r.remints),
    day: r.day,
    device: r.device,
    model: r.model,
    instructionVersion: r.instruction_version,
    minutesReserved: Number(r.minutes_reserved),
    minutesUsed: num(r.minutes_used),
    connectMs: num(r.connect_ms),
    turns: num(r.turns),
    toolCalls: r.tool_calls === null ? null : JSON.parse(r.tool_calls),
    promptTokens: num(r.prompt_tokens),
    responseTokens: num(r.response_tokens),
    endReason: r.end_reason,
    minted: Number(r.minted),
    reported: num(r.reported),
  };
}

/** The person's session row of this ref and segment, or null. */
export function segmentSession(
  db: DatabaseSync,
  userId: string,
  ref: string,
  segment: CoachSegment,
): AgentSession | null {
  const r = db
    .prepare("SELECT * FROM agent_sessions WHERE user_id=? AND ref=? AND segment=?")
    .get(userId, ref, segment) as Row | undefined;
  return r ? toSession(r) : null;
}

/** The person's session row by id (another person's reads as missing). */
export function ownSession(db: DatabaseSync, id: string, userId: string): AgentSession | null {
  const r = db.prepare("SELECT * FROM agent_sessions WHERE id=? AND user_id=?").get(id, userId) as
    Row | undefined;
  return r ? toSession(r) : null;
}

/** The counted minutes of a day (5.1: max(reserved, used) per row), for one person or for everyone. */
export function countedMinutes(db: DatabaseSync, day: string, userId?: string): number {
  const sql =
    "SELECT COALESCE(SUM(MAX(minutes_reserved, COALESCE(minutes_used, 0))), 0) AS m FROM agent_sessions WHERE day=?";
  const r = (
    userId === undefined ? db.prepare(sql).get(day) : db.prepare(`${sql} AND user_id=?`).get(day, userId)
  ) as { m: number };
  return Number(r.m);
}

const counted = (s: Pick<AgentSession, "minutesReserved" | "minutesUsed">) =>
  Math.max(s.minutesReserved, s.minutesUsed ?? 0);

/** Minutes left as the client sees them: never below 0, rounded down to a tenth. */
const left = (n: number) => Math.max(0, Math.floor(n * 10 + 1e-9) / 10);

export interface ReservationAsk {
  userId: string;
  block: CoachBlock;
  segment: CoachSegment;
  ref: string;
  /** The Riyadh day of now. */
  day: string;
  /** SHA-256 of the client device id. */
  device: string;
  model: string;
  instructionVersion: string;
  /** The segment's minutes (segments.ts minutesFor). */
  minutes: number;
  now: number;
}

export type Reservation =
  { ok: true; kind: "new" | "remint"; id: string; minutesLeft: number } | { ok: false; minutesLeft: number };

type Decision =
  | { ok: true; kind: "new"; delta: number; minutesLeft: number }
  | { ok: true; kind: "remint"; session: AgentSession; delta: number; minutesLeft: number }
  | { ok: false; minutesLeft: number };

/** What a mint would reserve now, or why it cannot (the re-mint cap or a budget). Reads only. */
export function decide(db: DatabaseSync, ask: ReservationAsk, cfg: AgentConfig): Decision {
  const user = countedMinutes(db, ask.day, ask.userId);
  const all = countedMinutes(db, ask.day);
  const leftNow = left(Math.min(cfg.userDailyMinutes - user, cfg.globalDailyMinutes - all));
  const session = segmentSession(db, ask.userId, ask.ref, ask.segment);
  if (session && session.remints >= cfg.remints) return { ok: false, minutesLeft: leftNow };
  const delta = session
    ? counted({ ...session, minutesReserved: session.minutesReserved + cfg.remintMinutes }) - counted(session)
    : ask.minutes;
  if (user + delta > cfg.userDailyMinutes || all + delta > cfg.globalDailyMinutes)
    return { ok: false, minutesLeft: leftNow };
  const minutesLeft = left(
    Math.min(cfg.userDailyMinutes - user - delta, cfg.globalDailyMinutes - all - delta),
  );
  return session
    ? { ok: true, kind: "remint", session, delta, minutesLeft }
    : { ok: true, kind: "new", delta, minutesLeft };
}

/**
 * Reserves the segment's minutes for a minted token, deciding again at this moment (a request that ran
 * meanwhile may have used the budget or made the row). Call after the mint succeeded: a failed mint
 * reserves nothing. Synchronous, in one transaction.
 */
export function reserve(db: DatabaseSync, ask: ReservationAsk, cfg: AgentConfig): Reservation {
  db.exec("BEGIN IMMEDIATE");
  try {
    const d = decide(db, ask, cfg);
    let out: Reservation;
    if (!d.ok) out = d;
    else if (d.kind === "remint") {
      db.prepare(
        "UPDATE agent_sessions SET remints=remints+1, minutes_reserved=minutes_reserved+?, model=?, instruction_version=?, minted=? WHERE id=?",
      ).run(cfg.remintMinutes, ask.model, ask.instructionVersion, ask.now, d.session.id);
      out = { ok: true, kind: "remint", id: d.session.id, minutesLeft: d.minutesLeft };
    } else {
      const id = randomUUID();
      db.prepare(
        "INSERT INTO agent_sessions(id,user_id,block,segment,ref,remints,day,device,model,instruction_version,minutes_reserved,minted) VALUES(?,?,?,?,?,0,?,?,?,?,?,?)",
      ).run(
        id,
        ask.userId,
        ask.block,
        ask.segment,
        ask.ref,
        ask.day,
        ask.device,
        ask.model,
        ask.instructionVersion,
        ask.minutes,
        ask.now,
      );
      out = { ok: true, kind: "new", id, minutesLeft: d.minutesLeft };
    }
    db.exec("COMMIT");
    return out;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

/* ------------------------------------------------------------- usage */

/** The end reasons that mean the segment fell back to the local voice (product_counts coach_fallback). */
export const FALLBACK_REASONS: readonly CoachEndReason[] = [
  "fallback_error",
  "fallback_slow",
  "offline",
  "budget",
];

/**
 * Stores a usage report on its session row (5.2): minutes_used = min(durationSec / 60, reserved + 1),
 * never below what an earlier report counted (the count is never lowered); the other fields describe
 * the segment so far and replace the earlier report's. Returns whether this report newly records a
 * fallback reason, so the route counts each fallback once.
 */
export function storeUsage(db: DatabaseSync, s: AgentSession, r: UsageReport, now: number): boolean {
  const reported = Math.min(r.durationSec / 60, s.minutesReserved + 1);
  const used = Math.max(s.minutesUsed ?? 0, reported);
  db.prepare(
    "UPDATE agent_sessions SET minutes_used=?, connect_ms=?, turns=?, tool_calls=?, prompt_tokens=?, response_tokens=?, end_reason=?, reported=? WHERE id=?",
  ).run(
    used,
    r.connectMs,
    r.turns,
    JSON.stringify(r.toolCalls),
    r.promptTokens,
    r.responseTokens,
    r.endReason,
    now,
    s.id,
  );
  return FALLBACK_REASONS.includes(r.endReason) && s.endReason !== r.endReason;
}
