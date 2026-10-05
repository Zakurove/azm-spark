/**
 * Stream D, step D2: the coach's configuration and the ephemeral token (product v7 contract 5.1 and
 * 5.4, with D-022: S0-1 the flat token body, S0-3 the expiry, S0-4 the language of the input
 * transcription). One fetch, no new dependency; the key never leaves the server.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NEW_SESSION_WINDOW_MS,
  TokenError,
  agentConfig,
  coachSetup,
  mintToken,
  type AgentConfig,
} from "../../server/modules/agent/token";
import { DEFAULT_SEGMENT_MINUTES } from "../../server/modules/agent/segments";
import { buildInstruction } from "../../src/coach/instruction";
import { toolDeclarations } from "../../src/coach/tools";

const KEY = "test-gemini-key-SECRET-0123456789";
const T0 = Date.UTC(2026, 9, 4, 6, 0, 0);

afterEach(() => {
  vi.useRealTimers();
});

describe("agentConfig (5.4)", () => {
  it("is null while the coach is switched off or has no key", () => {
    expect(agentConfig({})).toBeNull();
    expect(agentConfig({ GEMINI_API_KEY: KEY })).toBeNull();
    expect(agentConfig({ GEMINI_API_KEY: KEY, AZM_AGENT_ENABLED: "0" })).toBeNull();
    expect(agentConfig({ GEMINI_API_KEY: KEY, AZM_AGENT_ENABLED: "true" })).toBeNull();
    expect(agentConfig({ AZM_AGENT_ENABLED: "1" })).toBeNull();
    expect(agentConfig({ AZM_AGENT_ENABLED: "1", GEMINI_API_KEY: "  " })).toBeNull();
  });

  it("takes the defaults of 5.4 and the S0 values", () => {
    expect(agentConfig({ AZM_AGENT_ENABLED: "1", GEMINI_API_KEY: KEY })).toEqual({
      apiKey: KEY,
      model: "gemini-3.8-live",
      apiVersion: "v1beta",
      voice: "Achird",
      segmentMinutes: DEFAULT_SEGMENT_MINUTES,
      remints: 2,
      remintMinutes: 2,
      userDailyMinutes: 45,
      globalDailyMinutes: 600,
    });
  });

  it("takes valid overrides and keeps the default for a value it cannot use", () => {
    const cfg = agentConfig({
      AZM_AGENT_ENABLED: "1",
      GEMINI_API_KEY: KEY,
      AZM_AGENT_MODEL: "gemini-3.1-flash-live-preview",
      AZM_AGENT_API_VERSION: "v1alpha",
      AZM_AGENT_VOICE: "Charon",
      AZM_AGENT_SEGMENT_MINUTES: "gait:4",
      AZM_AGENT_REMINTS: "1",
      AZM_AGENT_REMINT_MINUTES: "3",
      AZM_AGENT_USER_DAILY_MINUTES: "60",
      AZM_AGENT_GLOBAL_DAILY_MINUTES: "900",
    })!;
    expect(cfg).toMatchObject({
      model: "gemini-3.1-flash-live-preview",
      apiVersion: "v1alpha",
      voice: "Charon",
      remints: 1,
      remintMinutes: 3,
      userDailyMinutes: 60,
      globalDailyMinutes: 900,
    });
    expect(cfg.segmentMinutes.gait).toBe(4);
    const bad = agentConfig({
      AZM_AGENT_ENABLED: "1",
      GEMINI_API_KEY: KEY,
      AZM_AGENT_MODEL: "models/../evil",
      AZM_AGENT_API_VERSION: "v2",
      AZM_AGENT_VOICE: "Achird Puck",
      AZM_AGENT_REMINTS: "-1",
      AZM_AGENT_REMINT_MINUTES: "x",
      AZM_AGENT_USER_DAILY_MINUTES: "0",
      AZM_AGENT_GLOBAL_DAILY_MINUTES: "Infinity",
    })!;
    expect(bad).toMatchObject({
      model: "gemini-3.8-live",
      apiVersion: "v1beta",
      voice: "Achird",
      remints: 2,
      remintMinutes: 2,
      userDailyMinutes: 45,
      globalDailyMinutes: 600,
    });
  });
});

const CFG: AgentConfig = agentConfig({ AZM_AGENT_ENABLED: "1", GEMINI_API_KEY: KEY })!;

describe("coachSetup (5.1 with S0-1 and S0-4)", () => {
  it("is the flat setup Google takes, with the instruction, the block's tools and the person's pause", () => {
    const instruction = buildInstruction({
      lang: "ar",
      block: "rom",
      position: "seated",
      helperPresent: false,
    });
    const tools = toolDeclarations("rom");
    expect(coachSetup(CFG, { instruction, tools, lang: "ar", silenceMs: 1200 })).toEqual({
      model: "models/gemini-3.8-live",
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Achird" } } },
      },
      systemInstruction: { parts: [{ text: instruction }] },
      tools: [{ functionDeclarations: tools }],
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
          prefixPaddingMs: 200,
          silenceDurationMs: 1200,
        },
        activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
      },
      inputAudioTranscription: { languageCodes: ["ar"] },
      outputAudioTranscription: {},
      contextWindowCompression: { triggerTokens: 12000, slidingWindow: { targetTokens: 6000 } },
      historyConfig: { initialHistoryInClientContent: true },
    });
  });

  it("asks for no session resumption, no field mask and no tool beyond the block's (live.md 11, 13; S0 2)", () => {
    const setup = coachSetup(CFG, {
      instruction: "x",
      tools: toolDeclarations("gait"),
      lang: "en",
      silenceMs: 800,
    }) as Record<string, any>;
    expect(setup).not.toHaveProperty("sessionResumption");
    expect(setup).not.toHaveProperty("fieldMask");
    expect(setup.tools).toHaveLength(1);
    expect(Object.keys(setup.tools[0])).toEqual(["functionDeclarations"]);
    expect(setup.inputAudioTranscription).toEqual({ languageCodes: ["en"] });
  });
});

describe("mintToken (5.1)", () => {
  function stub(reply: () => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return reply();
    }) as unknown as typeof fetch;
    return { impl, calls };
  }
  const ok = () => new Response(JSON.stringify({ name: "auth_tokens/abc123" }), { status: 200 });

  it("posts one flat body to auth_tokens with the key in the header, and returns the times it sent (S0-1, S0-3)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const setup = { model: "models/gemini-3.8-live" };
    const { impl, calls } = stub(ok);
    const out = await mintToken(CFG, setup, 9, impl);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/auth_tokens");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({ "x-goog-api-key": KEY, "content-type": "application/json" });
    const newSession = new Date(T0 + 120_000).toISOString();
    // S0-3: expireTime counts from the mint, so it holds the 2 minute prewarm window, the segment and 1.
    const expire = new Date(T0 + (2 + 9 + 1) * 60_000).toISOString();
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      uses: 1,
      newSessionExpireTime: newSession,
      expireTime: expire,
      bidiGenerateContentSetup: setup,
    });
    expect(NEW_SESSION_WINDOW_MS).toBe(120_000);
    expect(out).toEqual({ name: "auth_tokens/abc123", expireTime: expire, newSessionExpireTime: newSession });
  });

  it("uses the configured API version", async () => {
    const { impl, calls } = stub(ok);
    await mintToken({ ...CFG, apiVersion: "v1alpha" }, {}, 3, impl);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1alpha/auth_tokens");
  });

  it("fails with the status only, never Google's message or the key", async () => {
    const google = () =>
      new Response(JSON.stringify({ error: { message: `bad key ${KEY}`, status: "INVALID_ARGUMENT" } }), {
        status: 400,
      });
    for (const reply of [
      google,
      () => new Response("{}", { status: 200 }),
      () => new Response(JSON.stringify({ name: "not_a_token" }), { status: 200 }),
      () => new Response("<html>", { status: 502 }),
    ]) {
      const { impl } = stub(reply);
      const err = await mintToken(CFG, {}, 3, impl).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TokenError);
      expect(String((err as Error).message)).not.toContain(KEY);
      expect(String((err as Error).message)).not.toContain("bad key");
      expect(JSON.stringify(err)).not.toContain(KEY);
    }
    const down = (async () => {
      throw new Error(`connect failed ${KEY}`);
    }) as unknown as typeof fetch;
    const err = (await mintToken(CFG, {}, 3, down).catch((e: unknown) => e)) as TokenError;
    expect(err).toBeInstanceOf(TokenError);
    expect(err.status).toBe(0);
    expect(err.message).not.toContain(KEY);
  });
});
