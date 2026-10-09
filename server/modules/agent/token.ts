/**
 * The live coach's configuration and its ephemeral token (product v7 contract 5.1 and 5.4, stream D).
 *
 * The server builds the session setup (the locked system instruction, the block's tools, the voice,
 * the voice activity settings) and mints a one use token for it with one fetch (no new server
 * dependency). The setup fields sit directly under bidiGenerateContentSetup (S0-1: the wrapped
 * { setup } shape is refused with 400); Google answers with the token's name only, so the times
 * returned are the ones sent. The token carries no fieldMask (with one, every field it does not list
 * comes from the client, live-spike.md 2) and no sessionResumption (zero retention, live.md 11). The
 * API key never leaves the server: it is sent only in the x-goog-api-key header, and an error carries
 * the HTTP status alone (never Google's message).
 */
import type { Lang } from "../../../src/movements/types";
import { DEFAULT_SEGMENT_MINUTES, parseSegmentMinutes, type SegmentMinutes } from "./segments";

export interface AgentConfig {
  apiKey: string;
  model: string;
  apiVersion: "v1beta" | "v1alpha";
  voice: string;
  /** AZM_AGENT_SEGMENT_MINUTES (C-6 moved the minutes from blocks to segments). */
  segmentMinutes: SegmentMinutes;
  /** AZM_AGENT_REMINTS: re-mints allowed per segment. */
  remints: number;
  /**
   * AZM_AGENT_REMINT_MINUTES: no longer read by the budget, since every mint, a re-mint too, reserves
   * its own token's life (budget.ts tokenLifeMinutes; coach review 2, contract gap W2-13). Kept so an
   * environment that sets it still parses.
   */
  remintMinutes: number;
  userDailyMinutes: number;
  globalDailyMinutes: number;
}

const DEFAULTS = {
  model: "gemini-3.8-live",
  apiVersion: "v1beta",
  voice: "Achird",
  remints: 2,
  remintMinutes: 2,
  userDailyMinutes: 70,
  globalDailyMinutes: 600,
} as const;

/** A number from the environment within [min, max], else the default. */
function envNumber(raw: string | undefined, fallback: number, min: number, integer: boolean): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) return fallback;
  return n;
}

/** The coach's configuration (5.4), or null while it is switched off or has no key. Read at each request. */
export function agentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim() ?? "";
  if (env.AZM_AGENT_ENABLED !== "1" || !apiKey) return null;
  const model = env.AZM_AGENT_MODEL?.trim() ?? "";
  const voice = env.AZM_AGENT_VOICE?.trim() ?? "";
  const version = env.AZM_AGENT_API_VERSION?.trim();
  return {
    apiKey,
    model: /^[a-z0-9][a-z0-9.\-]{0,79}$/.test(model) ? model : DEFAULTS.model,
    apiVersion: version === "v1alpha" || version === "v1beta" ? version : DEFAULTS.apiVersion,
    voice: /^[A-Z][a-z]{1,30}$/.test(voice) ? voice : DEFAULTS.voice,
    segmentMinutes: env.AZM_AGENT_SEGMENT_MINUTES
      ? parseSegmentMinutes(env.AZM_AGENT_SEGMENT_MINUTES)
      : { ...DEFAULT_SEGMENT_MINUTES },
    remints: envNumber(env.AZM_AGENT_REMINTS, DEFAULTS.remints, 0, true),
    remintMinutes: envNumber(env.AZM_AGENT_REMINT_MINUTES, DEFAULTS.remintMinutes, 0, false),
    userDailyMinutes: envNumber(env.AZM_AGENT_USER_DAILY_MINUTES, DEFAULTS.userDailyMinutes, 1, false),
    globalDailyMinutes: envNumber(env.AZM_AGENT_GLOBAL_DAILY_MINUTES, DEFAULTS.globalDailyMinutes, 1, false),
  };
}

/* ------------------------------------------------------------ the setup */

/** The pause the person chose before their turn ends (5.1 silenceMs; S0: 800 by default). */
export type SilenceMs = 800 | 1200 | 1600;
export const SILENCE_MS: readonly SilenceMs[] = [800, 1200, 1600];

export interface SetupInput {
  instruction: string;
  tools: object[];
  lang: Lang;
  silenceMs: SilenceMs;
}

/**
 * The locked session setup of 5.1 (REST field names), with the S0 values: low start of speech
 * sensitivity, 200 ms prefix padding (live-spike.md 11), and the input transcription in the session's
 * language (S0-4: «نعم» was heard as "No." without it).
 */
export function coachSetup(cfg: AgentConfig, s: SetupInput): object {
  return {
    model: `models/${cfg.model}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice } } },
    },
    systemInstruction: { parts: [{ text: s.instruction }] },
    // The connection test (D-035 item 4) has no tools: an empty declaration list is left out.
    ...(s.tools.length ? { tools: [{ functionDeclarations: s.tools }] } : {}),
    realtimeInputConfig: {
      automaticActivityDetection: {
        startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
        prefixPaddingMs: 200,
        silenceDurationMs: s.silenceMs,
      },
      activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
    },
    inputAudioTranscription: { languageCodes: [s.lang] },
    outputAudioTranscription: {},
    contextWindowCompression: { triggerTokens: 12000, slidingWindow: { targetTokens: 6000 } },
    historyConfig: { initialHistoryInClientContent: true },
  };
}

/* ------------------------------------------------------------ the token */

export const GEMINI_BASE = "https://generativelanguage.googleapis.com";
/** The window to open the session after the mint (newSessionExpireTime, live.md 16.4). */
export const NEW_SESSION_WINDOW_MS = 120_000;
/** The margin after a segment's minutes before the token ends (5.1). */
export const EXPIRY_MARGIN_MINUTES = 1;

/** A failed mint: the HTTP status only (0 when Google could not be reached). */
export class TokenError extends Error {
  constructor(readonly status: number) {
    super(`TOKEN_FAILED ${status}`);
    this.name = "TokenError";
  }
}

/**
 * Mints a one use token for this setup. S0-3: expireTime counts from the mint, so it holds the window
 * to open the session, the segment's minutes and the margin. Returns the token's name and the times sent.
 */
export async function mintToken(
  cfg: AgentConfig,
  setup: object,
  minutes: number,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ name: string; expireTime: string; newSessionExpireTime: string }> {
  const now = Date.now();
  const newSessionExpireTime = new Date(now + NEW_SESSION_WINDOW_MS).toISOString();
  const expireTime = new Date(
    now + NEW_SESSION_WINDOW_MS + (minutes + EXPIRY_MARGIN_MINUTES) * 60_000,
  ).toISOString();
  let res: Response;
  try {
    res = await fetchImpl(`${GEMINI_BASE}/${cfg.apiVersion}/auth_tokens`, {
      method: "POST",
      headers: { "x-goog-api-key": cfg.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ uses: 1, newSessionExpireTime, expireTime, bidiGenerateContentSetup: setup }),
    });
  } catch {
    throw new TokenError(0);
  }
  if (!res.ok) throw new TokenError(res.status);
  let name: unknown;
  try {
    name = ((await res.json()) as { name?: unknown } | null)?.name;
  } catch {
    throw new TokenError(res.status);
  }
  // Google writes the token's name; the client passes it on as is (the SDK puts it in the socket URL).
  if (typeof name !== "string" || !/^auth_tokens\/\S{1,1024}$/.test(name)) throw new TokenError(res.status);
  return { name, expireTime, newSessionExpireTime };
}
