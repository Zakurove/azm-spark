/**
 * Hand written validators of the live coach routes (product v7 contract section 4: unknown keys, non
 * finite numbers and strings outside their enumerations are refused, and the answer names the first
 * bad field). No free text is accepted anywhere (C-12).
 */
import type { CoachEndReason } from "../../../src/coach/events";
import { isCoachFailure } from "../../../src/coach/failure";
import type { ToolName } from "../../../src/coach/types";
import { isToolName } from "../../../src/coach/tools";
import { isStopOption } from "../../../src/medical/precheck";
import type { StopOptionId } from "../../../src/movements/types";
import { SILENCE_MS, type SilenceMs } from "./token";
import type { TokenRequest, UsageReport } from "./types";

type Parsed<T> = { ok: true; value: T } | { ok: false; field: string };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;
const SEGMENT = {
  rom: /^rom:(seated|standing|lying):(1|2)$/,
  gait: /^gait$/,
  session: /^session:(1|2)$/,
} as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** The first key that is not allowed, or null. */
const unknownKey = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).find((k) => !keys.includes(k)) ?? null;
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

const TOKEN_KEYS = ["block", "segment", "lang", "ref", "deviceId", "silenceMs"] as const;

/** POST /api/agent/token's body (5.1). The segment must match the block, and the ref its kind. */
export function parseTokenRequest(body: unknown): Parsed<TokenRequest> {
  if (!isRecord(body)) return { ok: false, field: "body" };
  const extra = unknownKey(body, TOKEN_KEYS);
  if (extra) return { ok: false, field: extra };
  const { block, segment, lang, ref, deviceId, silenceMs } = body;
  if (block !== "rom" && block !== "gait" && block !== "session") return { ok: false, field: "block" };
  if (typeof segment !== "string" || !SEGMENT[block].test(segment)) return { ok: false, field: "segment" };
  if (lang !== "ar" && lang !== "en") return { ok: false, field: "lang" };
  const refKey = block === "session" ? "workoutId" : "checkId";
  if (
    !isRecord(ref) ||
    Object.keys(ref).length !== 1 ||
    typeof ref[refKey] !== "string" ||
    !ID.test(ref[refKey])
  )
    return { ok: false, field: "ref" };
  if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) return { ok: false, field: "deviceId" };
  if (silenceMs !== undefined && !SILENCE_MS.includes(silenceMs as SilenceMs))
    return { ok: false, field: "silenceMs" };
  return {
    ok: true,
    value: {
      block,
      segment: segment as TokenRequest["segment"],
      lang,
      ref: block === "session" ? { workoutId: ref[refKey] as string } : { checkId: ref[refKey] as string },
      deviceId,
      ...(silenceMs !== undefined ? { silenceMs: silenceMs as SilenceMs } : {}),
    },
  };
}

const LAB_KEYS = ["lang", "deviceId", "silenceMs"] as const;

/** POST /api/agent/lab-token's body (D-035 item 4): the language, the device id and the pause length. */
export function parseLabRequest(
  body: unknown,
): Parsed<{ lang: "ar" | "en"; deviceId: string; silenceMs?: SilenceMs }> {
  if (!isRecord(body)) return { ok: false, field: "body" };
  const extra = unknownKey(body, LAB_KEYS);
  if (extra) return { ok: false, field: extra };
  const { lang, deviceId, silenceMs } = body;
  if (lang !== "ar" && lang !== "en") return { ok: false, field: "lang" };
  if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) return { ok: false, field: "deviceId" };
  if (silenceMs !== undefined && !SILENCE_MS.includes(silenceMs as SilenceMs))
    return { ok: false, field: "silenceMs" };
  return {
    ok: true,
    value: { lang, deviceId, ...(silenceMs !== undefined ? { silenceMs: silenceMs as SilenceMs } : {}) },
  };
}

/* ------------------------------------------------------------- usage */

export const END_REASONS: readonly CoachEndReason[] = [
  "done",
  "user_end",
  "fallback_error",
  "fallback_slow",
  "go_away",
  "offline",
  "budget",
];
const USAGE_KEYS = [
  "sessionId",
  "connectMs",
  "durationSec",
  "turns",
  "toolCalls",
  "promptTokens",
  "responseTokens",
  "firstAudioMs",
  "endReason",
  "failure",
] as const;
/** 5.2 bounds, and engineering bounds where 5.2 gives none (a Live connection lasts at most 10 minutes). */
export const USAGE_LIMITS = {
  durationSec: 3600,
  turns: 500,
  connectMs: 600_000,
  toolCalls: 500,
  tokens: 10_000_000,
  firstAudioMs: 60_000,
} as const;

/**
 * POST /api/agent/usage's body (5.2): every field present, null only where 5.2 allows it. `failure`
 * (D-035 item 3) may be absent (a client from before it) or null; when given, a known stage, a clean
 * name and a clean message (src/coach/failure.ts).
 */
export function parseUsageReport(body: unknown): Parsed<UsageReport> {
  if (!isRecord(body)) return { ok: false, field: "body" };
  const extra = unknownKey(body, USAGE_KEYS);
  if (extra) return { ok: false, field: extra };
  const b = body;
  if (typeof b.sessionId !== "string" || !ID.test(b.sessionId)) return { ok: false, field: "sessionId" };
  if (b.connectMs !== null && !isInt(b.connectMs, 0, USAGE_LIMITS.connectMs))
    return { ok: false, field: "connectMs" };
  if (!isNum(b.durationSec, 0, USAGE_LIMITS.durationSec)) return { ok: false, field: "durationSec" };
  if (!isInt(b.turns, 0, USAGE_LIMITS.turns)) return { ok: false, field: "turns" };
  if (!isRecord(b.toolCalls)) return { ok: false, field: "toolCalls" };
  const toolCalls: Partial<Record<ToolName, { ok: number; rejected: number }>> = {};
  for (const [name, c] of Object.entries(b.toolCalls)) {
    if (
      !isToolName(name) ||
      !isRecord(c) ||
      unknownKey(c, ["ok", "rejected"]) ||
      !isInt(c.ok, 0, USAGE_LIMITS.toolCalls) ||
      !isInt(c.rejected, 0, USAGE_LIMITS.toolCalls)
    )
      return { ok: false, field: "toolCalls" };
    toolCalls[name] = { ok: c.ok, rejected: c.rejected };
  }
  for (const k of ["promptTokens", "responseTokens"] as const)
    if (b[k] !== null && !isInt(b[k], 0, USAGE_LIMITS.tokens)) return { ok: false, field: k };
  const fa = b.firstAudioMs;
  if (
    fa !== null &&
    (!isRecord(fa) ||
      unknownKey(fa, ["p50", "p90"]) ||
      !isNum(fa.p50, 0, USAGE_LIMITS.firstAudioMs) ||
      !isNum(fa.p90, 0, USAGE_LIMITS.firstAudioMs))
  )
    return { ok: false, field: "firstAudioMs" };
  if (!END_REASONS.includes(b.endReason as CoachEndReason)) return { ok: false, field: "endReason" };
  if (b.failure !== undefined && b.failure !== null && !isCoachFailure(b.failure))
    return { ok: false, field: "failure" };
  return {
    ok: true,
    value: {
      sessionId: b.sessionId,
      connectMs: b.connectMs as number | null,
      durationSec: b.durationSec,
      turns: b.turns,
      toolCalls,
      promptTokens: b.promptTokens as number | null,
      responseTokens: b.responseTokens as number | null,
      firstAudioMs:
        fa === null ? null : { p50: (fa as { p50: number }).p50, p90: (fa as { p90: number }).p90 },
      endReason: b.endReason as CoachEndReason,
      failure: isCoachFailure(b.failure)
        ? { stage: b.failure.stage, name: b.failure.name, message: b.failure.message }
        : null,
    },
  };
}

/* -------------------------------------------------------------- stop */

const STOP_KEYS = ["workoutId", "option"] as const;

/** POST /api/agent/stop's body (D-030 D5-7): the workout and the person's stop list answer. */
export function parseStopRequest(body: unknown): Parsed<{ workoutId: string; option: StopOptionId }> {
  if (!isRecord(body)) return { ok: false, field: "body" };
  const extra = unknownKey(body, STOP_KEYS);
  if (extra) return { ok: false, field: extra };
  const { workoutId, option } = body;
  if (typeof workoutId !== "string" || !ID.test(workoutId)) return { ok: false, field: "workoutId" };
  if (typeof option !== "string" || !isStopOption(option)) return { ok: false, field: "option" };
  return { ok: true, value: { workoutId, option } };
}
