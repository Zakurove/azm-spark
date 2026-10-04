/**
 * Stream D, step D3: the live coach's transport (product v7 contract 2.11 LiveTransport, 5.1, C-12)
 * over @google/genai, with the S0 findings of D-022: the server's history goes first (live-spike.md
 * 1), the resumption handle Google sends unasked is ignored and never kept (S0-5), and an output
 * transcription that arrives without audio is never shown (S0-6, the junk captions). The SDK is
 * replaced by a recording fake, so no test opens a socket; FakeLiveTransport (section 8.6) plays its
 * scripted timeline on fake timers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GenaiTransport,
  fromBase64,
  mapServerMessage,
  parseDurationMs,
  toBase64,
  type GenaiSdk,
} from "../../src/features/coach-agent/transport";
import { FakeLiveTransport, e2eResponder } from "../../src/features/coach-agent/fake";
import type { LiveConnectOptions, LiveTransport, TransportEvent } from "../../src/coach/types";

const OPTS: LiveConnectOptions = {
  token: "auth_tokens/abc123",
  model: "gemini-3.8-live",
  apiVersion: "v1beta",
  history: [
    { role: "user", text: "[CTX block=rom segment=rom:seated:1 lang=ar helper=no]" },
    { role: "model", text: "جاهز." },
  ],
};

const b64 = (bytes: number[]) => Buffer.from(Uint8Array.from(bytes)).toString("base64");
const bytesOf = (buf: ArrayBuffer) => [...new Uint8Array(buf)];

/* ------------------------------------------------------------ the fake SDK */

interface Callbacks {
  onmessage: (m: unknown) => void;
  onerror?: ((e: unknown) => void) | null;
  onclose?: ((e: { code: number; reason: string }) => void) | null;
}
class FakeSdk {
  constructed: { apiKey: string; httpOptions: { apiVersion: string } }[] = [];
  connects: { model: string; config: unknown }[] = [];
  /** Every message the transport sent through the session, as the SDK received it. */
  sent: { method: string; params: unknown }[] = [];
  callbacks: Callbacks | null = null;
  closed = 0;
  /** How the next connect ends: resolve after setupComplete, or the socket closes first. */
  mode: "ok" | "close_early" | "never" = "ok";
  private resolveConnect: (() => void) | null = null;

  module(): GenaiSdk {
    const sdk = this;
    return {
      GoogleGenAI: class {
        live = {
          connect(p: { model: string; config: unknown; callbacks: Callbacks }) {
            sdk.connects.push({ model: p.model, config: p.config });
            sdk.callbacks = p.callbacks;
            const session = {
              sendClientContent: (params: unknown) => sdk.sent.push({ method: "sendClientContent", params }),
              sendRealtimeInput: (params: unknown) => sdk.sent.push({ method: "sendRealtimeInput", params }),
              sendToolResponse: (params: unknown) => sdk.sent.push({ method: "sendToolResponse", params }),
              close: () => {
                sdk.closed++;
              },
            };
            return new Promise((resolve) => {
              sdk.resolveConnect = () => resolve(session);
              if (sdk.mode === "ok") queueMicrotask(() => sdk.resolveConnect?.());
              if (sdk.mode === "close_early")
                queueMicrotask(() => p.callbacks.onclose?.({ code: 1011, reason: "token expired" }));
            });
          },
        };
        constructor(o: { apiKey: string; httpOptions: { apiVersion: string } }) {
          sdk.constructed.push(o);
        }
      } as unknown as GenaiSdk["GoogleGenAI"],
    };
  }
  /** A server message after the connection is open. */
  message(m: unknown) {
    this.callbacks!.onmessage(m);
  }
}

let sdk: FakeSdk;
let loads: number;
const transport = () =>
  new GenaiTransport(async () => {
    loads++;
    return sdk.module();
  });
const collect = (t: LiveTransport) => {
  const events: TransportEvent[] = [];
  t.on((e) => events.push(e));
  return events;
};

beforeEach(() => {
  sdk = new FakeSdk();
  loads = 0;
});

/* --------------------------------------------------------- server messages */

describe("mapServerMessage", () => {
  it("turns the model's PCM parts into audio events, decoded from base64", () => {
    const events = mapServerMessage({
      serverContent: {
        modelTurn: {
          parts: [
            { inlineData: { mimeType: "audio/pcm;rate=24000", data: b64([1, 2, 3, 4]) } },
            { inlineData: { mimeType: "audio/pcm;rate=24000", data: b64([5, 6]) } },
          ],
        },
      },
    });
    expect(events.map((e) => e.type)).toEqual(["audio", "audio"]);
    expect(bytesOf((events[0] as { pcm24k: ArrayBuffer }).pcm24k)).toEqual([1, 2, 3, 4]);
    expect(bytesOf((events[1] as { pcm24k: ArrayBuffer }).pcm24k)).toEqual([5, 6]);
  });

  it("keeps an output transcription only when its message carries audio (S0-6)", () => {
    const withAudio = mapServerMessage({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: b64([0, 0]) } }] },
        outputTranscription: { text: "Is this as far" },
      },
    });
    expect(withAudio).toContainEqual({ type: "outputTranscript", text: "Is this as far" });
    // The junk piece of live-spike.md 6 arrives about 2 s after the speech, with no audio.
    const junk = mapServerMessage({
      serverContent: { outputTranscription: { text: "プロジェクターの選び方について説明します" } },
    });
    expect(junk).toEqual([]);
  });

  it("passes the person's transcription with its final flag", () => {
    expect(mapServerMessage({ serverContent: { inputTranscription: { text: "نعم" } } })).toEqual([
      { type: "inputTranscript", text: "نعم", final: false },
    ]);
    expect(
      mapServerMessage({ serverContent: { inputTranscription: { text: "yes", finished: true } } }),
    ).toEqual([{ type: "inputTranscript", text: "yes", final: true }]);
  });

  it("maps interrupted and turnComplete after the content of the same message", () => {
    expect(mapServerMessage({ serverContent: { interrupted: true } })).toEqual([{ type: "interrupted" }]);
    const last = mapServerMessage({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: b64([9, 9]) } }] },
        turnComplete: true,
      },
    });
    expect(last.map((e) => e.type)).toEqual(["audio", "turnComplete"]);
  });

  it("maps tool calls (args default to an empty object) and their cancellation", () => {
    expect(
      mapServerMessage({
        toolCall: {
          functionCalls: [
            {
              id: "c1",
              name: "confirm_max",
              args: { movement: "shoulder_flexion", side: "right", answer: "yes" },
            },
            { id: "c2", name: "next_step" },
            { id: "c3" },
          ],
        },
      }),
    ).toEqual([
      {
        type: "toolCall",
        calls: [
          {
            id: "c1",
            name: "confirm_max",
            args: { movement: "shoulder_flexion", side: "right", answer: "yes" },
          },
          { id: "c2", name: "next_step", args: {} },
        ],
      },
    ]);
    expect(mapServerMessage({ toolCallCancellation: { ids: ["c1"] } })).toEqual([
      { type: "toolCallCancellation", ids: ["c1"] },
    ]);
  });

  it("maps goAway's duration and the usage counts", () => {
    expect(mapServerMessage({ goAway: { timeLeft: "10s" } })).toEqual([
      { type: "goAway", timeLeftMs: 10000 },
    ]);
    expect(mapServerMessage({ goAway: {} })).toEqual([{ type: "goAway", timeLeftMs: 0 }]);
    expect(mapServerMessage({ usageMetadata: { promptTokenCount: 2200, responseTokenCount: 140 } })).toEqual([
      { type: "usage", promptTokens: 2200, responseTokens: 140 },
    ]);
    expect(parseDurationMs("0.500s")).toBe(500);
    expect(parseDurationMs("1.25s")).toBe(1250);
    expect(parseDurationMs("soon")).toBe(0);
  });

  it("ignores the empty messages, setupComplete and the unasked resumption handle (S0-5)", () => {
    expect(mapServerMessage({})).toEqual([]);
    expect(mapServerMessage({ setupComplete: {} })).toEqual([]);
    expect(
      mapServerMessage({ sessionResumptionUpdate: { newHandle: "handle-secret-123", resumable: true } }),
    ).toEqual([]);
  });
});

describe("base64", () => {
  it("round trips PCM bytes", () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768, 1234]);
    const back = new Int16Array(fromBase64(toBase64(pcm.buffer)));
    expect([...back]).toEqual([...pcm]);
    expect(toBase64(new ArrayBuffer(0))).toBe("");
  });
});

/* -------------------------------------------------------- GenaiTransport */

describe("GenaiTransport", () => {
  it("loads the SDK only on connect, with the token as the key and the token's API version", async () => {
    const t = transport();
    expect(loads).toBe(0);
    await t.connect(OPTS);
    expect(loads).toBe(1);
    expect(sdk.constructed).toEqual([
      { apiKey: "auth_tokens/abc123", httpOptions: { apiVersion: "v1beta" } },
    ]);
    // The token locks the setup (5.1): the client sends none of its own.
    expect(sdk.connects).toEqual([{ model: "gemini-3.8-live", config: {} }]);
  });

  it("sends the server's history first, then reports setupComplete", async () => {
    const t = transport();
    const events = collect(t);
    await t.connect(OPTS);
    expect(sdk.sent[0]).toEqual({
      method: "sendClientContent",
      params: {
        turns: [
          { role: "user", parts: [{ text: OPTS.history[0].text }] },
          { role: "model", parts: [{ text: "جاهز." }] },
        ],
        turnComplete: true,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("setupComplete");
    expect((events[0] as { ms: number }).ms).toBeGreaterThanOrEqual(0);
  });

  it("rejects connect when the socket closes before setupComplete, without an event", async () => {
    sdk.mode = "close_early";
    const t = transport();
    const events = collect(t);
    await expect(t.connect(OPTS)).rejects.toThrow(/closed_1011/);
    expect(events).toEqual([]);
    expect(sdk.sent).toEqual([]);
  });

  it("sends audio, the end of the stream, context and tool responses in the API's shapes", async () => {
    const t = transport();
    await t.connect(OPTS);
    sdk.sent.length = 0;
    const pcm = new Int16Array([1, -2, 3]).buffer;
    t.sendAudio(pcm);
    t.audioStreamEnd();
    t.sendContext("[EVT t=1.0 type=ask_pain mv=knee_flexion side=left]", true);
    t.sendContext("[EVT t=2.0 type=reps exercise=sit_to_stand count=3 target=10]", false);
    t.sendToolResponse([
      { id: "c1", name: "confirm_max", response: { accepted: true, say: "recorded", data: { deg: 120 } } },
      { id: "c2", name: "pause", response: { accepted: true }, scheduling: "WHEN_IDLE" },
    ]);
    expect(sdk.sent).toEqual([
      {
        method: "sendRealtimeInput",
        params: { audio: { data: toBase64(pcm), mimeType: "audio/pcm;rate=16000" } },
      },
      { method: "sendRealtimeInput", params: { audioStreamEnd: true } },
      {
        method: "sendClientContent",
        params: {
          turns: [{ role: "user", parts: [{ text: "[EVT t=1.0 type=ask_pain mv=knee_flexion side=left]" }] }],
          turnComplete: true,
        },
      },
      {
        method: "sendClientContent",
        params: {
          turns: [
            {
              role: "user",
              parts: [{ text: "[EVT t=2.0 type=reps exercise=sit_to_stand count=3 target=10]" }],
            },
          ],
          turnComplete: false,
        },
      },
      {
        method: "sendToolResponse",
        params: {
          functionResponses: [
            {
              id: "c1",
              name: "confirm_max",
              response: { accepted: true, say: "recorded", data: { deg: 120 } },
            },
            { id: "c2", name: "pause", response: { accepted: true }, scheduling: "WHEN_IDLE" },
          ],
        },
      },
    ]);
  });

  it("emits the mapped server messages, then close and error once open", async () => {
    const t = transport();
    const events = collect(t);
    await t.connect(OPTS);
    sdk.message({ serverContent: { inputTranscription: { text: "نعم" } } });
    sdk.message({ sessionResumptionUpdate: { newHandle: "handle-secret-123", resumable: true } });
    sdk.message({ toolCall: { functionCalls: [{ id: "c9", name: "stop", args: { reason: "chest" } }] } });
    sdk.callbacks!.onerror?.({ message: "boom" });
    sdk.callbacks!.onclose?.({ code: 1011, reason: "The service is currently unavailable." });
    expect(events.map((e) => e.type)).toEqual([
      "setupComplete",
      "inputTranscript",
      "toolCall",
      "error",
      "close",
    ]);
    expect(events.at(-1)).toEqual({
      type: "close",
      code: 1011,
      reason: "The service is currently unavailable.",
    });
    // S0-5: the handle is neither emitted nor kept anywhere on the transport.
    expect(JSON.stringify(events)).not.toContain("handle-secret-123");
    const own = Object.entries(t).filter(([k]) => k !== "session");
    expect(JSON.stringify(own)).not.toContain("handle-secret-123");
  });

  it("after close sends nothing and emits nothing, and closes the SDK session once", async () => {
    const t = transport();
    const events = collect(t);
    await t.connect(OPTS);
    t.close();
    t.close();
    sdk.sent.length = 0;
    t.sendAudio(new ArrayBuffer(640));
    t.sendContext("x", true);
    t.audioStreamEnd();
    sdk.callbacks!.onclose?.({ code: 1000, reason: "" });
    expect(sdk.sent).toEqual([]);
    expect(sdk.closed).toBe(1);
    expect(events.map((e) => e.type)).toEqual(["setupComplete"]);
  });

  it("closes a session that completes after the app gave up on it", async () => {
    sdk.mode = "never";
    const t = transport();
    const pending = t.connect(OPTS);
    await Promise.resolve();
    t.close();
    await expect(pending).rejects.toThrow(/closed/);
  });

  it("never sends image, video or landmark parts (C-12)", async () => {
    const t = transport();
    await t.connect(OPTS);
    t.sendAudio(new ArrayBuffer(640));
    t.audioStreamEnd();
    t.sendContext("[EVT t=3.0 type=step_start label=knee_flexion_left]", false);
    t.sendToolResponse([
      { id: "c1", name: "repeat_instructions", response: { accepted: true, data: { text: "a" } } },
    ]);
    for (const { method, params } of sdk.sent) {
      const p = params as Record<string, unknown>;
      if (method === "sendRealtimeInput") {
        expect(Object.keys(p).every((k) => k === "audio" || k === "audioStreamEnd")).toBe(true);
        if (p.audio) expect((p.audio as { mimeType: string }).mimeType).toBe("audio/pcm;rate=16000");
      } else if (method === "sendClientContent") {
        const turns = p.turns as { parts: Record<string, unknown>[] }[];
        for (const turn of turns) for (const part of turn.parts) expect(Object.keys(part)).toEqual(["text"]);
      } else expect(method).toBe("sendToolResponse");
    }
    // No transport has a method that could send a picture, a video or landmarks.
    for (const proto of [GenaiTransport.prototype, FakeLiveTransport.prototype]) {
      const sends = Object.getOwnPropertyNames(proto).filter((n) => /^send/.test(n));
      expect(sends.sort()).toEqual(["sendAudio", "sendContext", "sendToolResponse"]);
    }
  });

  it("imports the SDK lazily only, so it lives in the coach chunk alone", () => {
    const src = readFileSync(join(__dirname, "../../src/features/coach-agent/transport.ts"), "utf8");
    const staticImports = src.match(/^import\s+(?!type\b)[^;]*from\s+"@google\/genai"/gm) ?? [];
    expect(staticImports).toEqual([]);
    expect(src).toContain('import("@google/genai")');
  });
});

/* ------------------------------------------------------ FakeLiveTransport */

describe("FakeLiveTransport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("plays setupComplete after n ms and the timeline at its times, and records what the app sends", async () => {
    const fake = new FakeLiveTransport({
      setupMs: 900,
      timeline: [
        { at: 1200, event: { type: "audio", pcm24k: new ArrayBuffer(4800) } },
        { at: 1500, event: { type: "goAway", timeLeftMs: 10000 } },
      ],
    });
    const events = collect(fake);
    const connected = fake.connect(OPTS);
    await vi.advanceTimersByTimeAsync(899);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await connected;
    expect(events).toEqual([{ type: "setupComplete", ms: 900 }]);
    expect(fake.sent[0]).toEqual({ kind: "history", turns: OPTS.history });
    await vi.advanceTimersByTimeAsync(600);
    expect(events.map((e) => e.type)).toEqual(["setupComplete", "audio", "goAway"]);
    fake.sendAudio(new ArrayBuffer(640));
    fake.audioStreamEnd();
    fake.sendContext("[EVT t=1.0 type=ask_pain mv=knee_flexion side=left]", true);
    fake.sendToolResponse([{ id: "c1", name: "stop", response: { accepted: true } }]);
    fake.close();
    expect(fake.sent.slice(1)).toEqual([
      { kind: "audio", bytes: 640 },
      { kind: "audioStreamEnd" },
      { kind: "context", text: "[EVT t=1.0 type=ask_pain mv=knee_flexion side=left]", turnComplete: true },
      { kind: "toolResponse", responses: [{ id: "c1", name: "stop", response: { accepted: true } }] },
      { kind: "close" },
    ]);
  });

  it("never completes the setup with setupMs null, and fails at once with failConnect", async () => {
    const slow = new FakeLiveTransport({ setupMs: null });
    const events = collect(slow);
    let settled = false;
    void slow.connect(OPTS).then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    expect(events).toEqual([]);
    const failing = new FakeLiveTransport({ failConnect: "socket_error" });
    await expect(failing.connect(OPTS)).rejects.toThrow("socket_error");
  });

  it("emits nothing after close, and answers what the app sends through its responder", async () => {
    const fake = new FakeLiveTransport({
      setupMs: 100,
      respond: (sent, f) => {
        if (sent.kind === "context" && sent.turnComplete)
          f.after(400, { type: "audio", pcm24k: new ArrayBuffer(960) });
      },
    });
    const events = collect(fake);
    const connected = fake.connect(OPTS);
    await vi.advanceTimersByTimeAsync(100);
    await connected;
    fake.sendContext("[EVT t=1.0 type=end_range_hold]", true);
    await vi.advanceTimersByTimeAsync(400);
    expect(events.map((e) => e.type)).toEqual(["setupComplete", "audio"]);
    fake.sendContext("[EVT t=2.0 type=ask_pain]", true);
    fake.close();
    await vi.advanceTimersByTimeAsync(1000);
    fake.emit({ type: "turnComplete" });
    expect(events.map((e) => e.type)).toEqual(["setupComplete", "audio"]);
  });

  it("has an e2e responder that voices every question the app asks", async () => {
    const fake = new FakeLiveTransport({ setupMs: 300, respond: e2eResponder });
    const events = collect(fake);
    const connected = fake.connect(OPTS);
    await vi.advanceTimersByTimeAsync(300);
    await connected;
    fake.sendContext(
      "[EVT t=4.0 type=end_range_hold mv=shoulder_flexion side=right deg=118 typical=165]",
      true,
    );
    fake.sendContext("[EVT t=5.0 type=attempt_saved]", false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(events.map((e) => e.type)).toEqual(["setupComplete", "audio", "outputTranscript", "turnComplete"]);
  });
});
