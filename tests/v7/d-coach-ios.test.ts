/**
 * D-035 item 3: the Live coach on iPhone Safari. Nasser's three production segments were minted and
 * then ended fallback_error with connect_ms null and 0 turns. What these tests hold:
 *
 *   - iOS keeps navigator.audioSession.type "playback" as a category override (the check's taps set it
 *     for the voice), and WebKit then refuses PlayAndRecord when the microphone starts: the coach asks
 *     for play-and-record BEFORE it asks for the microphone;
 *   - a slow connection is not a failed one: at 3 s the local voice takes over while the connection
 *     goes on in the background, and the coach takes over when setupComplete arrives;
 *   - every failure carries its stage, name and message into the usage report (and agent_sessions),
 *     cleaned of any URL, token or key;
 *   - the microphone tells its stages apart (getUserMedia, the context, the worklet), the worklet loads
 *     from a data URL where a blob URL is refused, and an iOS "interrupted" context is resumed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoachStageError, cleanFailureMessage, coachFailure, isCoachFailure } from "../../src/coach/failure";
import { CoachSession, type CoachDeps, type MintResult } from "../../src/features/coach-agent/session";
import { FakeLiveTransport, type FakeScript } from "../../src/features/coach-agent/fake";
import { GenaiTransport, TransportError, type GenaiSdk } from "../../src/features/coach-agent/transport";
import { MicCapture, type MicDeps } from "../../src/features/coach-agent/audio/mic";
import { Speaker } from "../../src/features/coach-agent/audio/speaker";
import type { BridgeEvent, TransportEvent } from "../../src/coach/types";
import type { TokenRequest, TokenResponse, UsageReport } from "../../server/modules/agent/types";
import { FakeMic, FakeSpeaker, FakeVoice, RefRomHost } from "./d-coach-harness";

const T0 = Date.UTC(2026, 9, 9, 9, 0, 0);
const CHECK = "0b6f1c1e-1d2a-4c8e-9a1b-2f3c4d5e6f70";
const SID = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function token(n = 1): TokenResponse {
  const now = Date.now();
  return {
    sessionId: SID,
    token: `auth_tokens/t${n}`,
    model: "gemini-3.8-live",
    apiVersion: "v1beta",
    voice: "Achird",
    expiresAt: new Date(now + 12 * 60_000).toISOString(),
    newSessionExpiresAt: new Date(now + 120_000).toISOString(),
    history: [
      { role: "user", text: "[CTX block=rom segment=rom:seated:1 lang=ar helper=no]" },
      { role: "model", text: "جاهز." },
    ],
    minutesLeft: 30,
  };
}

function harness(o: { script?: FakeScript; micRefused?: boolean; mint?: (n: number) => MintResult } = {}) {
  const order: string[] = [];
  const transports: FakeLiveTransport[] = [];
  const mints: TokenRequest[] = [];
  const reports: UsageReport[] = [];
  const mic = new FakeMic();
  mic.refuse = o.micRefused ?? false;
  mic.onStart = () => order.push("mic");
  const speaker = new FakeSpeaker();
  const voice = new FakeVoice();
  const deps: CoachDeps = {
    now: () => Date.now(),
    wallNow: () => Date.now(),
    online: () => true,
    async mint(req) {
      mints.push(req);
      order.push("mint");
      return o.mint ? o.mint(mints.length) : { ok: true, token: token(mints.length), serverDate: Date.now() };
    },
    report: (r) => reports.push(structuredClone(r)),
    transport() {
      const t = new FakeLiveTransport({ setupMs: 900, ...o.script });
      transports.push(t);
      return t;
    },
    mic: () => mic,
    speaker: () => speaker,
    deviceId: () => "device_abcdefghijklmnop",
    audioSession: (live) => order.push(live ? "play-and-record" : "playback"),
    tickMs: 50,
  };
  const host = new RefRomHost();
  const session = new CoachSession(
    { block: "rom", segment: "rom:seated:1", lang: "ar", ref: { checkId: CHECK }, host, local: voice },
    deps,
  );
  return {
    session,
    host,
    order,
    transports,
    mints,
    reports,
    mic,
    voice,
    live: () => transports.at(-1)!,
    emit: (e: TransportEvent) => transports.at(-1)!.emit(e),
    push: (e: BridgeEvent) => session.push(e),
  };
}

const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const hold = (): BridgeEvent => ({
  p: 1,
  type: "end_range_hold",
  holdId: "h1",
  movement: "shoulder_flexion",
  side: "right",
  deg: 118,
  typical: 166,
  t: Date.now(),
});
const movementResult = (): BridgeEvent => ({
  p: 3,
  type: "movement_result",
  movement: "shoulder_flexion",
  side: "right",
  deg: 120,
  typical: 165,
  finding: "within",
  t: Date.now(),
});

describe("the failure reason (D-035 item 3)", () => {
  it("keeps the stage, the name and the message, never a URL, a token or a key", () => {
    const e = new Error(
      "WebSocket closed: wss://generativelanguage.googleapis.com/ws/x?access_token=auth_tokens/abc123 refused",
    );
    const f = coachFailure("socket", e);
    expect(f).toEqual({ stage: "socket", name: "Error", message: "WebSocket closed: <url> refused" });
    expect(cleanFailureMessage("token auth_tokens/zzz9 and key=AIzaSECRET&x=1")).toBe(
      "token <token> and key=<secret>&x=1",
    );
    expect(cleanFailureMessage("حدث خطأ\nفي\tالصوت")).toBe("? ? ? ?");
    expect(cleanFailureMessage("x".repeat(500))).toHaveLength(200);
    const dom = coachFailure("mic", new DOMException("The request is not allowed", "NotAllowedError"));
    expect(dom).toEqual({ stage: "mic", name: "NotAllowedError", message: "The request is not allowed" });
    // A stage error keeps its own stage and code.
    expect(coachFailure("mic", new CoachStageError("audio", "AbortError", "addModule failed"))).toEqual({
      stage: "audio",
      name: "AbortError",
      message: "addModule failed",
    });
    expect(coachFailure("live", "weird")).toEqual({ stage: "live", name: "Error", message: "weird" });
  });

  it("is checked by the server: a known stage, a clean name and an already clean message", () => {
    expect(isCoachFailure({ stage: "mic", name: "NotAllowedError", message: "denied" })).toBe(true);
    expect(isCoachFailure({ stage: "camera", name: "X", message: "" })).toBe(false);
    expect(isCoachFailure({ stage: "mic", name: "Not Allowed", message: "" })).toBe(false);
    expect(isCoachFailure({ stage: "mic", name: "X", message: "auth_tokens/abc" })).toBe(false);
    expect(isCoachFailure({ stage: "mic", name: "X", message: "x".repeat(201) })).toBe(false);
    expect(isCoachFailure({ stage: "mic", name: "X", message: "", extra: 1 })).toBe(false);
    expect(isCoachFailure(null)).toBe(false);
  });
});

describe("the coach on iOS (D-035 item 3)", () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  it("asks for play-and-record before it asks for the microphone", async () => {
    const h = harness();
    h.session.start();
    await run(900);
    expect(h.order.slice(0, 2)).toEqual(["play-and-record", "mic"]);
    expect(h.session.getSnapshot().mode).toBe("live");
    h.session.end("done");
    expect(h.order.at(-1)).toBe("playback");
  });

  it("goes local at 3 s on a slow connection, keeps connecting, and hands over to the coach at setupComplete", async () => {
    const h = harness({ script: { setupMs: 6000 } });
    h.session.start();
    await run(3000);
    expect(h.session.getSnapshot().mode).toBe("local");
    expect(h.reports.at(-1)).toMatchObject({ endReason: "fallback_slow", connectMs: null, failure: null });
    // The local voice asks meanwhile; the microphone stays open for the coach.
    h.host.openHold("h1", 118);
    h.push(hold());
    expect(h.voice.said.map((x) => x.line)).toEqual(["rom_ask_max"]);
    expect(h.mic.stopped).toBe(false);
    await run(3000);
    expect(h.session.getSnapshot().mode).toBe("live");
    expect(h.mints).toHaveLength(1);
    expect(h.transports).toHaveLength(1);
    // The coach is told where the person is now, silently.
    const ctx = h.live().sent.filter((s) => s.kind === "context");
    expect(ctx.at(-1)).toMatchObject({ turnComplete: false });
    expect((ctx.at(-1) as { text: string }).text).toContain("[CTX now rom");
    h.voice.end();
    await run(400);
    h.mic.frame();
    expect(h.live().sent.some((s) => s.kind === "audio")).toBe(true);
    h.session.end("done");
    expect(h.reports.at(-1)).toMatchObject({ endReason: "done", connectMs: 6000 });
  });

  it("ends a slow connection that then fails with fallback_error and the socket's reason", async () => {
    const h = harness({
      script: { setupMs: null, failAfter: { ms: 5000, code: "closed_1008", detail: "policy violation" } },
    });
    h.session.start();
    await run(3000);
    expect(h.session.getSnapshot().mode).toBe("local");
    await run(2000);
    expect(h.live().sent.at(-1)).toEqual({ kind: "close" });
    expect(h.mic.stopped).toBe(true);
    expect(h.reports.at(-1)).toMatchObject({
      endReason: "fallback_error",
      failure: { stage: "socket", name: "closed_1008", message: "closed_1008: policy violation" },
    });
    // The next boundary tries again with a re-mint.
    h.push(movementResult());
    await run(100);
    expect(h.mints).toHaveLength(2);
  });

  it("reports the microphone's refusal with its name", async () => {
    const h = harness({ micRefused: true });
    h.session.start();
    await run(1000);
    expect(h.session.getSnapshot().mode).toBe("local");
    expect(h.reports.at(-1)).toMatchObject({
      endReason: "fallback_error",
      connectMs: null,
      failure: { stage: "mic", name: "NotAllowedError", message: "Permission denied" },
    });
  });

  it("reports a socket that cannot open, and a refused re-mint at the next boundary", async () => {
    let n = 0;
    const h = harness({
      script: { failConnect: "socket_error" },
      mint: (k) => {
        n = k;
        return k === 1
          ? { ok: true, token: token(1), serverDate: Date.now() }
          : { ok: false, status: 502, error: "TOKEN_FAILED" };
      },
    });
    h.session.start();
    await run(100);
    expect(h.reports.at(-1)).toMatchObject({
      endReason: "fallback_error",
      failure: { stage: "socket", name: "socket_error" },
    });
    h.push(movementResult());
    await run(100);
    expect(n).toBe(2);
    expect(h.reports.at(-1)).toMatchObject({
      endReason: "fallback_error",
      failure: { stage: "token", name: "HTTP_502", message: "TOKEN_FAILED" },
    });
  });

  it("reports two questions without coach audio as a playback failure", async () => {
    const h = harness();
    h.session.start();
    await run(900);
    h.push(hold());
    await run(4000);
    h.voice.end();
    h.push({ p: 1, type: "ask_pain", movement: "shoulder_flexion", side: "right", t: Date.now() });
    await run(1500);
    expect(h.reports.at(-1)).toMatchObject({
      endReason: "fallback_slow",
      failure: { stage: "playback", name: "NoCoachAudio" },
    });
  });
});

/* ------------------------------------------------------------ MicCapture */

function micDeps(o: { gum?: () => Promise<MediaStream>; add?: (url: string) => Promise<void> } = {}) {
  const calls: string[] = [];
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const port = { onmessage: null as ((ev: MessageEvent) => void) | null };
  const ctx = {
    state: "running",
    destination: {},
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
    resume: vi.fn(async () => undefined),
  };
  const deps: MicDeps = {
    prepare: () => calls.push("prepare"),
    getUserMedia: async () => {
      calls.push("getUserMedia");
      return o.gum ? o.gum() : stream;
    },
    context: () => ctx as unknown as AudioContext,
    addModule: async () => {
      calls.push("addModule");
    },
    createNode: () => ({ port, connect: vi.fn(), disconnect: vi.fn() }) as unknown as AudioWorkletNode,
  };
  return { deps, calls, ctx, track };
}

describe("MicCapture's stages (D-035 item 3)", () => {
  it("sets the audio session before getUserMedia", async () => {
    const m = micDeps();
    await new MicCapture(m.deps).start(() => undefined);
    expect(m.calls).toEqual(["prepare", "getUserMedia", "addModule"]);
  });

  it("tags a getUserMedia failure as the mic stage and a worklet failure as the audio stage", async () => {
    const refused = micDeps({ gum: () => Promise.reject(new DOMException("busy", "NotReadableError")) });
    const e1 = await new MicCapture(refused.deps).start(() => undefined).catch((e: unknown) => e);
    expect(coachFailure("mic", e1)).toEqual({ stage: "mic", name: "NotReadableError", message: "busy" });
    const m = micDeps();
    m.deps.addModule = () => Promise.reject(new DOMException("bad module", "AbortError"));
    const e2 = await new MicCapture(m.deps).start(() => undefined).catch((e: unknown) => e);
    expect(coachFailure("mic", e2)).toEqual({ stage: "audio", name: "AbortError", message: "bad module" });
    // The microphone a failed worklet got is released.
    expect(m.track.stop).toHaveBeenCalled();
  });

  it("resumes a context iOS left interrupted or suspended", async () => {
    const m = micDeps();
    m.ctx.state = "interrupted";
    await new MicCapture(m.deps).start(() => undefined);
    expect(m.ctx.resume).toHaveBeenCalled();
  });
});

describe("the capture worklet's module (D-035 item 3)", () => {
  it("loads from a data URL where the blob URL is refused", async () => {
    const { addCaptureModule } = await import("../../src/features/coach-agent/audio/mic");
    const urls: string[] = [];
    const ctx = {
      audioWorklet: {
        addModule: async (url: string) => {
          urls.push(url.slice(0, 5));
          if (url.startsWith("blob:")) throw new DOMException("blob refused", "SecurityError");
        },
      },
    } as unknown as AudioContext;
    const how = await addCaptureModule(ctx);
    expect(how).toBe("data");
    expect(urls).toEqual(["blob:", "data:"]);
  });
});

describe("the Speaker on iOS", () => {
  it("resumes an interrupted context when the coach speaks", () => {
    const ctx = { state: "interrupted", resume: vi.fn(async () => undefined) };
    const streamer = { addPCM16: vi.fn(), setVolume: vi.fn(), onComplete: () => undefined, context: ctx };
    const s = new Speaker(
      () => ctx as unknown as AudioContext,
      () => streamer as never,
    );
    expect(s.audible).toBe(false);
    s.play(new ArrayBuffer(480));
    expect(ctx.resume).toHaveBeenCalled();
  });
});

/* -------------------------------------------------------- GenaiTransport */

function sdkClosing(when: "before_open" | "after_open"): GenaiSdk {
  return {
    GoogleGenAI: class {
      live = {
        connect(p: {
          callbacks: {
            onopen?: () => void;
            onclose?: ((e: { code: number; reason: string }) => void) | null;
          };
        }) {
          queueMicrotask(() => {
            if (when === "after_open") p.callbacks.onopen?.();
            p.callbacks.onclose?.({ code: 1008, reason: "Request contains an invalid argument." });
          });
          return new Promise(() => undefined);
        },
      };
    } as unknown as GenaiSdk["GoogleGenAI"],
  };
}

describe("GenaiTransport's stages (D-035 item 3)", () => {
  const OPTS = { token: "auth_tokens/abc", model: "m", apiVersion: "v1beta" as const, history: [] };

  it("tells a socket that never opened from one closed before its setup, with Google's reason", async () => {
    const before = await new GenaiTransport(async () => sdkClosing("before_open"))
      .connect(OPTS)
      .catch((e: unknown) => e);
    expect(before).toBeInstanceOf(TransportError);
    expect(coachFailure("socket", before)).toEqual({
      stage: "socket",
      name: "closed_1008",
      message: "closed_1008: Request contains an invalid argument.",
    });
    const stages: string[] = [];
    const t = new GenaiTransport(async () => sdkClosing("after_open"));
    t.onStage((s) => stages.push(s));
    const after = await t.connect(OPTS).catch((e: unknown) => e);
    expect(coachFailure("socket", after)).toMatchObject({ stage: "setup", name: "closed_1008" });
    expect(stages).toEqual(["sdk", "open"]);
  });

  it("names a chunk that did not load as the sdk stage", async () => {
    const e = await new GenaiTransport(() => Promise.reject(new TypeError("Load failed")))
      .connect(OPTS)
      .catch((x: unknown) => x);
    expect(coachFailure("socket", e)).toEqual({
      stage: "sdk",
      name: "sdk_load",
      message: "sdk_load: Load failed",
    });
  });
});
