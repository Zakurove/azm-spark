/**
 * The live coach's event line and the shared bridge rules (product v7 contract 2.11, stream D). Shared
 * by the client (the event bridge sends these lines) and the server (the system instruction explains
 * them). Pure, no DOM.
 *
 * One event is one compact line (live.md 7): "[EVT t=42.1 type=movement_result mv=shoulder_flexion
 * side=right deg=118 typical=165 finding=within]". Sides are written as the words the tools take (left, right, none):
 * the S0 round trips (live-spike.md 4) used them and the model copied them into its tool calls. Every
 * number is rounded, the typical value to 5 degrees as the history writes it (C-12), and every string
 * field is reduced to an id like token, so no sentence, bracket or new line can enter the context:
 * nothing the person says ever travels in an event. The one exception is a say line (D-037 item 1):
 * after its bracket it carries the app's own copy of the screen now (the instruction lines, a
 * correction, the walk's count), with brackets and line breaks taken out.
 */
import type { BridgeEvent, BridgeOptions } from "./types";

/* ---------------------------------------------------------- the line */

/** Typical values are rounded to this many degrees before they are sent (C-12). */
export const TYPICAL_ROUND_DEG = 5;

/** A string field as an id like token: letters, digits and _ . : only, at most 48 characters. */
export function safeToken(v: string): string {
  const t = v.replace(/[^A-Za-z0-9_.:]/g, "_").slice(0, 48);
  return t.length ? t : "none";
}

/** A whole number, or none when the value is missing or not finite. */
function whole(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? String(Math.round(v)) : "none";
}

/** A typical value rounded to 5 degrees, or none. */
export function roundTypical(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.round(v / TYPICAL_ROUND_DEG) * TYPICAL_ROUND_DEG
    : null;
}

function typical(v: number | null): string {
  const r = roundTypical(v);
  return r === null ? "none" : String(r);
}

/** The fields of one event after its type, in a fixed order. */
function fields(e: BridgeEvent): [string, string][] {
  switch (e.type) {
    case "safety_stop":
      return [["reason", e.reason]];
    case "red_flag":
      return [["screen", safeToken(e.screen)]];
    case "ask_pain":
    case "ask_can_move":
      return [
        ["mv", e.movement],
        ["side", e.side],
      ];
    case "compensation":
      return [
        ...(e.movement ? ([["mv", e.movement]] as [string, string][]) : []),
        ["kind", safeToken(e.kind)],
        ...(e.value !== undefined ? ([["value", whole(e.value)]] as [string, string][]) : []),
      ];
    case "setup_issue":
      return [["issue", safeToken(e.issue)]];
    case "say":
      return [
        ["kind", e.kind],
        ["key", safeToken(e.key)],
        ...(e.movement ? ([["mv", e.movement]] as [string, string][]) : []),
        ...(e.side ? ([["side", e.side]] as [string, string][]) : []),
        ...(e.face ? ([["face", e.face]] as [string, string][]) : []),
      ];
    case "step_start":
      return [
        ["label", safeToken(e.label)],
        ...(e.movement ? ([["mv", e.movement]] as [string, string][]) : []),
        ...(e.side ? ([["side", e.side]] as [string, string][]) : []),
      ];
    case "attempt_saved":
      return [
        ["mv", e.movement],
        ["side", e.side],
        ["deg", whole(e.deg)],
      ];
    case "movement_result":
      return [
        ["mv", e.movement],
        ["side", e.side],
        ["deg", whole(e.deg)],
        ["typical", typical(e.typical)],
        ["finding", e.finding],
      ];
    case "reps":
      return [
        ["exercise", safeToken(e.exercise)],
        ["count", whole(e.count)],
        ["target", whole(e.target)],
      ];
    case "pass_done":
      return [
        ["view", e.view],
        ["clean", whole(e.cleanCycles)],
        ["needed", whole(e.needed)],
      ];
    case "asked_locally":
      return [["what", e.what]];
    case "tool_applied":
      return [
        ["name", e.name],
        ["accepted", e.accepted ? "yes" : "no"],
      ];
  }
}

/**
 * One compact line, live.md 7: "[EVT t=42.1 type=ask_pain mv=shoulder_flexion side=right]". `t` and
 * `t0` are milliseconds on the same clock; the line carries seconds since `t0`
 * with one decimal. Numbers rounded; no free text from the person.
 */
export function formatEvent(e: BridgeEvent, t0: number): string {
  const seconds = Number.isFinite(e.t - t0) ? Math.max(0, (e.t - t0) / 1000) : 0;
  const rest = fields(e)
    .map(([k, v]) => ` ${k}=${v}`)
    .join("");
  const head = `[EVT t=${seconds.toFixed(1)} type=${e.type}${rest}]`;
  return e.type === "say" ? `${head} ${sayText(e.lines)}` : head;
}

/** A say line's words are the app's own copy; even so no bracket or line break enters the context. */
export const SAY_TEXT_MAX = 600;

/** The words of a say line after its bracket: the lines in order, one space apart, at most SAY_TEXT_MAX characters. */
export function sayText(lines: readonly string[]): string {
  const text = lines
    .map((l) => l.replace(/[[\]\r\n]+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
  return text.length > SAY_TEXT_MAX ? text.slice(0, SAY_TEXT_MAX).trimEnd() : text;
}

/* --------------------------------------------------- the bridge rules */

/**
 * Bridge rules 1 to 4: a P0 (safety stop, red flag) and a P1 (the range questions) go with
 * turnComplete true, so the coach speaks now; a P2 (correction) and a P3 (context) go silently, with
 * turnComplete false (S0: a silent line never started a reply, live-spike.md 5). D-037 item 1: a say
 * line goes with turnComplete true too, once the coach is free (bridge rule 9).
 */
export function triggersTurn(e: BridgeEvent): boolean {
  return e.p <= 1 || e.type === "say";
}

/**
 * Bridge rule 9 (D-037 item 1), the say lines' timing, interface times and no clinical number:
 *   - replyWaitMs: after the app started a turn, the coach was handed a tool result or the person
 *     spoke, a say line waits for the coach's reply to end; a reply with no audio counts as over after
 *     this long;
 *   - correctionRepeatMs: the same correction is never said again within this long;
 *   - correctionStaleMs: a correction not said within this long is dropped (the screen moved on);
 *   - progressStaleMs: the walk's count not said within this long is dropped.
 */
export const SAY_TIMING = Object.freeze({
  replyWaitMs: 3000,
  correctionRepeatMs: 10_000,
  correctionStaleMs: 4000,
  progressStaleMs: 2500,
});

/** The bridge's timing (2.11 BridgeOptions), unchanged by S0 (live-spike.md 11). */
export const BRIDGE_DEFAULTS: Readonly<BridgeOptions> = Object.freeze({
  minGapMs: 2000,
  contextFlushMs: 5000,
  localFallbackMs: 1500,
});

/** Rule 3: the mic reopens this long after a local line ends. */
export const MIC_REOPEN_MS = 300;

/** Rule 3: coach audio plays at this share of its volume while a local line plays. */
export const DUCK_VOLUME = 0.3;

/** Rule 6: a setupComplete later than this sends the segment to local mode. */
export const SLOW_SETUP_MS = 3000;

/** Rule 6: this many P1 events in a row without coach audio send the segment to local mode. */
export const P1_WITHOUT_AUDIO_LIMIT = 2;

/**
 * S0-3 (D-022 item 3): Google closes a connection at 10 minutes without a goAway (live-spike.md 9), so
 * the client rotates a segment's session this long after setupComplete at the latest.
 */
export const ROTATE_AFTER_SETUP_MS = 9.5 * 60 * 1000;

/** Rule 7 and S0-3: the session is rotated this long before the token's expiresAt. */
export const EXPIRY_MARGIN_MS = 60 * 1000;

/** S0-3: when the client starts a new session for the rest of a segment (at the next boundary). */
export function rotateAt(setupCompleteAt: number, expiresAt: number): number {
  return Math.min(setupCompleteAt + ROTATE_AFTER_SETUP_MS, expiresAt - EXPIRY_MARGIN_MS);
}

/** S0-3: a 1011 close after this long on the socket is the connection limit (live-spike.md 9). */
export const CONNECTION_LIMIT_CLOSE_MS = 595 * 1000;

/** Why a coach segment ended, as the usage report names it (5.2). */
export type CoachEndReason =
  "done" | "user_end" | "fallback_error" | "fallback_slow" | "go_away" | "offline" | "budget";

/** S0-3: the end reason of a socket close: the connection limit counts as go_away, anything else as an error. */
export function closeEndReason(
  code: number,
  connectedMs: number,
): Extract<CoachEndReason, "go_away" | "fallback_error"> {
  return code === 1011 && connectedMs >= CONNECTION_LIMIT_CLOSE_MS ? "go_away" : "fallback_error";
}
