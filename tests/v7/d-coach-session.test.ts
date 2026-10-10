/**
 * Stream D, step D4: one coach segment end to end with a mocked Live session (product v7 contract
 * 8.6): CoachSession, the controller under useCoach, with FakeLiveTransport, a fake microphone,
 * speaker and local voice, and the reference range host of the harness (or the session host). It
 * covers the prewarm (rule 8), the maximum question flow, the can move question by voice and by
 * button, the early answer, the mic gate, P0, the fallbacks of rule 6 each within 1 s, the rotation of
 * rule 7 and S0-3, cancellations (C-17), the usage report (5.2) and the captions (S0-6). Fake timers:
 * Date.now is the session's clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoachSession, type CoachDeps, type MintResult } from "../../src/features/coach-agent/session";
import { FakeLiveTransport, type FakeScript } from "../../src/features/coach-agent/fake";
import { SessionHost, type SessionScreen } from "../../src/features/coach-agent/sessionHost";
import { GO_ON } from "../../src/coach/actions";
import { ROTATE_AFTER_SETUP_MS } from "../../src/coach/events";
import type { BridgeEvent, CoachHost, CoachSegment, TransportEvent } from "../../src/coach/types";
import type { TokenRequest, TokenResponse, UsageReport } from "../../server/modules/agent/types";
import { FakeMic, FakeSpeaker, FakeVoice, RefGaitHost, RefRomHost, type GaitStepId } from "./d-coach-harness";

const T0 = Date.UTC(2026, 9, 4, 9, 0, 0);
const CHECK = "0b6f1c1e-1d2a-4c8e-9a1b-2f3c4d5e6f70";
const SID = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const HISTORY = [
  { role: "user" as const, text: "[CTX block=rom segment=rom:seated:1 lang=ar helper=no]" },
  { role: "model" as const, text: "جاهز." },
];

function token(n = 1, opts: { newSessionMs?: number; minutes?: number } = {}): TokenResponse {
  const now = Date.now();
  return {
    sessionId: SID,
    token: `auth_tokens/t${n}`,
    model: "gemini-3.8-live",
    apiVersion: "v1beta",
    voice: "Achird",
    expiresAt: new Date(now + 120_000 + ((opts.minutes ?? 9) + 1) * 60_000).toISOString(),
    newSessionExpiresAt: new Date(now + (opts.newSessionMs ?? 120_000)).toISOString(),
    history: HISTORY,
    minutesLeft: 30,
  };
}

interface Options {
  host?: CoachHost;
  segment?: CoachSegment;
  online?: boolean;
  setupMs?: number | null;
  script?: FakeScript;
  mint?: (req: TokenRequest, n: number) => MintResult;
  micRefused?: boolean;
  noMic?: boolean;
  /** The token request's round trip (default at once). */
  mintDelayMs?: number;
}

function harness(o: Options = {}) {
  const transports: FakeLiveTransport[] = [];
  const mints: TokenRequest[] = [];
  const reports: UsageReport[] = [];
  const mic = new FakeMic();
  mic.refuse = o.micRefused ?? false;
  const speaker = new FakeSpeaker();
  const voice = new FakeVoice();
  const audioSessions: boolean[] = [];
  const measures: { name: string; start: number; duration: number }[] = [];
  const logs: { message: string; data?: Record<string, unknown> }[] = [];
  let online = o.online ?? true;
  let handlers: { offline(): void; online(): void; hidden(): void } | null = null;
  const deps: CoachDeps = {
    now: () => Date.now(),
    wallNow: () => Date.now(),
    online: () => online,
    async mint(req) {
      mints.push(req);
      if (o.mintDelayMs) await new Promise((r) => setTimeout(r, o.mintDelayMs));
      return o.mint
        ? o.mint(req, mints.length)
        : { ok: true, token: token(mints.length), serverDate: Date.now() };
    },
    report: (r) => reports.push(structuredClone(r)),
    transport() {
      const t = new FakeLiveTransport({ setupMs: o.setupMs === undefined ? 900 : o.setupMs, ...o.script });
      transports.push(t);
      return t;
    },
    mic: () => (o.noMic ? null : mic),
    speaker: () => speaker,
    deviceId: () => "device_abcdefghijklmnop",
    listen(h) {
      handlers = h;
      return () => (handlers = null);
    },
    audioSession: (live) => audioSessions.push(live),
    measure: (name, start, duration) => measures.push({ name, start, duration }),
    log: (message, data) => logs.push({ message, ...(data ? { data } : {}) }),
    tickMs: 50,
  };
  const host = o.host ?? new RefRomHost();
  const session = new CoachSession(
    {
      block: host.block,
      segment: o.segment ?? "rom:seated:1",
      lang: "ar",
      ref: host.block === "session" ? { workoutId: CHECK } : { checkId: CHECK },
      host,
      local: voice,
    },
    deps,
  );
  const live = () => transports.at(-1)!;
  /** What the app sent on the current connection, without the audio frames. */
  const sent = (t = live()) => t.sent.filter((s) => s.kind !== "audio");
  const contexts = (t = live()) =>
    t.sent.filter((s): s is Extract<typeof s, { kind: "context" }> => s.kind === "context");
  const emit = (e: TransportEvent, t = live()) => t.emit(e);
  const push = (e: BridgeEvent) => session.push(e);
  return {
    session,
    transports,
    mints,
    reports,
    mic,
    speaker,
    voice,
    host,
    audioSessions,
    measures,
    logs,
    live,
    sent,
    contexts,
    emit,
    push,
    setOnline(v: boolean) {
      online = v;
      if (v) handlers?.online();
      else handlers?.offline();
    },
    hide: () => handlers?.hidden(),
  };
}

const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);
/** A range question (P1): the can move question (D-038 item 1 took the maximum question out). */
const question = (): BridgeEvent => ({
  p: 1,
  type: "ask_can_move",
  movement: "shoulder_flexion",
  side: "right",
  t: Date.now(),
});
const coachAudio = (seconds = 0.5): TransportEvent => ({
  type: "audio",
  pcm24k: new ArrayBuffer(48_000 * seconds),
});
const heard = (text: string): TransportEvent => ({ type: "inputTranscript", text, final: true });
const call = (id: string, name: string, args: unknown): TransportEvent => ({
  type: "toolCall",
  calls: [{ id, name, args }],
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

beforeEach(() => vi.useFakeTimers({ now: T0 }));
afterEach(() => vi.useRealTimers());

/* --------------------------------------------------------- the prewarm */

describe("the prewarm (rule 8)", () => {
  it("mints and connects when the setup card shows, the history first, live at setupComplete", async () => {
    const h = harness();
    expect(h.session.getSnapshot().mode).toBe("connecting");
    h.session.start();
    await run(0);
    expect(h.mints).toEqual([
      {
        block: "rom",
        segment: "rom:seated:1",
        lang: "ar",
        ref: { checkId: CHECK },
        deviceId: "device_abcdefghijklmnop",
      },
    ]);
    expect(h.live().options).toEqual({
      token: "auth_tokens/t1",
      model: "gemini-3.8-live",
      apiVersion: "v1beta",
      history: HISTORY,
    });
    expect(h.mic.started).toBe(true);
    await run(899);
    expect(h.session.getSnapshot().mode).toBe("connecting");
    await run(1);
    expect(h.session.getSnapshot().mode).toBe("live");
    expect(h.live().sent[0]).toEqual({ kind: "history", turns: HISTORY });
    expect(h.audioSessions).toEqual([true]);
  });

  it("starts nothing before start(), and asks for a token once per segment", async () => {
    const h = harness();
    await run(5000);
    expect(h.mints).toEqual([]);
    h.session.start();
    h.session.start();
    await run(2000);
    expect(h.mints).toHaveLength(1);
  });

  it("re-mints once when the new session window passed before the connect", async () => {
    const h = harness({
      mint: (_req, n) => ({
        ok: true,
        token: token(n, { newSessionMs: n === 1 ? -1000 : 120_000 }),
        serverDate: Date.now(),
      }),
    });
    h.session.start();
    await run(1000);
    expect(h.mints).toHaveLength(2);
    expect(h.transports).toHaveLength(1);
    expect(h.live().options?.token).toBe("auth_tokens/t2");
    expect(h.session.getSnapshot().mode).toBe("live");
  });
});

describe("the section 9 measures for the perf overlay (DG-1, D-026 item 8)", () => {
  it("measures the mint, the connect to setupComplete and each question's first audio", async () => {
    const h = harness({ mintDelayMs: 250 });
    const host = h.host as RefRomHost;
    h.session.start();
    await run(250 + 900);
    expect(h.session.getSnapshot().mode).toBe("live");
    expect(h.measures).toEqual([
      { name: "azm:coach_mint", start: T0, duration: 250 },
      { name: "azm:coach_connect", start: T0 + 250, duration: 900 },
    ]);
    host.askCanMove();
    h.push(question());
    const sentAt = Date.now();
    await run(640);
    h.emit(coachAudio());
    h.emit(coachAudio());
    expect(h.measures.slice(2)).toEqual([{ name: "azm:coach_first_audio", start: sentAt, duration: 640 }]);
  });
});

/* ------------------------------------------------ the range questions */

describe("a range question (the can move question; D-038 item 1 took the maximum question out)", () => {
  it("asks through the coach, records the spoken yes and tells the coach the result", async () => {
    const h = harness();
    const host = h.host as RefRomHost;
    h.session.start();
    await run(900);
    host.askCanMove();
    h.push(question());
    const asked = h.contexts().at(-1)!;
    expect(asked.turnComplete).toBe(true);
    expect(asked.text).toContain("type=ask_can_move mv=shoulder_flexion side=right");
    await run(650);
    h.emit(coachAudio(1.5));
    expect(h.session.getSnapshot().speaking).toBe(true);
    await run(2000);
    expect(h.voice.said).toEqual([]);
    h.emit(heard("إيه، هذا أقصى شي"));
    await run(1100);
    h.emit(call("c1", "answer_can_move", { movement: "shoulder_flexion", side: "right", canMove: true }));
    expect(host.canMove).toEqual([{ value: true, via: "voice" }]);
    expect(h.sent().at(-1)).toEqual({
      kind: "toolResponse",
      responses: [
        {
          id: "c1",
          name: "answer_can_move",
          response: { accepted: true, say: "lets_begin" },
        },
      ],
    });
    h.emit({ type: "turnComplete" });
    h.session.end("done");
    expect(h.reports.at(-1)).toMatchObject({
      sessionId: SID,
      connectMs: 900,
      toolCalls: { answer_can_move: { ok: 1, rejected: 0 } },
      firstAudioMs: { p50: 650, p90: 650 },
      turns: 1,
      endReason: "done",
    });
  });

  it("never asks with the local voice while live, even when the coach cannot be heard (D-036 item 1)", async () => {
    const h = harness();
    h.speaker.audible = false;
    h.session.start();
    await run(900);
    h.push(question());
    await run(600);
    h.emit(coachAudio(2));
    await run(900);
    expect(h.voice.said).toEqual([]);
    // The question's buttons are on the screen; a second unheard question falls back (rule 6).
    expect(h.session.getSnapshot().mode).toBe("live");
  });

  it("refuses the coach's own answer when the person said nothing after the question (S0-2)", async () => {
    const h = harness();
    const host = h.host as RefRomHost;
    h.session.start();
    await run(900);
    h.emit(heard("before the question"));
    await run(500);
    host.askCanMove();
    h.push(question());
    h.emit(coachAudio());
    await run(1800);
    h.emit(call("c1", "answer_can_move", { movement: "shoulder_flexion", side: "right", canMove: true }));
    expect(h.sent().at(-1)).toMatchObject({
      responses: [{ response: { accepted: false, reason: "no_answer_heard", say: "ask_and_wait" } }],
    });
    expect(host.canMove).toEqual([]);
    h.emit(heard("نعم"));
    await run(1000);
    h.emit(call("c2", "answer_can_move", { movement: "shoulder_flexion", side: "right", canMove: true }));
    expect(host.canMove).toEqual([{ value: true, via: "voice" }]);
  });

  it("refuses an early answer (wrong_phase), and the question asks again", async () => {
    const h = harness();
    const host = h.host as RefRomHost;
    h.session.start();
    await run(900);
    h.emit(heard("yes"));
    h.emit(call("c1", "answer_can_move", { movement: "shoulder_flexion", side: "right", canMove: true }));
    expect(h.sent().at(-1)).toMatchObject({
      responses: [{ response: { accepted: false, reason: "wrong_phase" } }],
    });
    await run(2500);
    host.askCanMove();
    h.push(question());
    expect(h.contexts().filter((c) => c.turnComplete)).toHaveLength(1);
    expect(host.canMove).toEqual([]);
  });

  it("lets a late coach ask the question itself: no local voice and no asked_locally (D-036 item 1)", async () => {
    const h = harness();
    (h.host as RefRomHost).askCanMove();
    h.session.start();
    await run(900);
    h.push(question());
    await run(1500);
    expect(h.voice.said).toEqual([]);
    expect(h.contexts().some((c) => c.text.includes("asked_locally"))).toBe(false);
    h.emit(coachAudio());
    h.emit({ type: "outputTranscript", text: "هل تستطيع تحريك هذا المفصل بنفسك؟" });
    expect(h.speaker.chunks).toBe(1);
    expect(h.session.getSnapshot().captions.map((c) => c.who)).toEqual(["coach"]);
  });
});

describe("the can move question", () => {
  const ask = (): BridgeEvent => ({
    p: 1,
    type: "ask_can_move",
    movement: "shoulder_flexion",
    side: "right",
    t: Date.now(),
  });

  it("is answered by voice", async () => {
    const h = harness();
    const host = h.host as RefRomHost;
    h.session.start();
    await run(900);
    host.askCanMove();
    h.push(ask());
    h.emit(coachAudio());
    await run(1500);
    h.emit(heard("إيه أقدر أحركه"));
    h.emit(call("m1", "answer_can_move", { movement: "shoulder_flexion", side: "right", canMove: true }));
    expect(host.canMove).toEqual([{ value: true, via: "voice" }]);
  });

  it("is answered by button, and the coach's late call changes nothing", async () => {
    const h = harness();
    const host = h.host as RefRomHost;
    h.session.start();
    await run(900);
    host.askCanMove();
    h.push(ask());
    h.emit(coachAudio());
    await run(1500);
    expect(host.buttonCanMove(false)).toBe(true);
    h.emit(heard("لا"));
    h.emit(call("m1", "answer_can_move", { movement: "shoulder_flexion", side: "right", canMove: true }));
    expect(host.canMove).toEqual([{ value: false, via: "button" }]);
    expect(h.sent().at(-1)).toMatchObject({
      responses: [{ response: { accepted: false, reason: "wrong_phase" } }],
    });
  });
});

/* ------------------------------------------------------------ the mic */

describe("the microphone (rule 3)", () => {
  it("sends frames while live, none while a local line plays and for 300 ms after", async () => {
    const h = harness();
    h.session.start();
    h.mic.frame();
    await run(900);
    const frames = () => h.live().sent.filter((s) => s.kind === "audio").length;
    expect(frames()).toBe(0);
    h.mic.frame();
    expect(frames()).toBe(1);
    h.voice.say("rom_no_lean", "warn");
    expect(h.sent().at(-1)).toEqual({ kind: "audioStreamEnd" });
    expect(h.speaker.ducks.at(-1)).toBe(true);
    h.mic.frame();
    await run(2000);
    h.mic.frame();
    h.voice.end();
    h.mic.frame();
    await run(250);
    h.mic.frame();
    expect(frames()).toBe(1);
    await run(100);
    h.mic.frame();
    expect(frames()).toBe(2);
    expect(h.speaker.ducks.at(-1)).toBe(false);
  });

  it("falls back to the local voice when the microphone is refused, and never asks again", async () => {
    const h = harness({ micRefused: true });
    h.session.start();
    await run(1000);
    expect(h.session.getSnapshot().mode).toBe("local");
    // D-034 item 3: never silent: the console says the microphone was refused and the coach fell back.
    expect(h.logs.some((l) => l.message.includes("microphone"))).toBe(true);
    expect(h.logs.some((l) => l.message.includes("local voice"))).toBe(true);
    h.push(movementResult());
    await run(5000);
    expect(h.mints).toHaveLength(1);
  });
});

/* ------------------------------------------------------------- P0 */

describe("a safety stop (rule 1)", () => {
  it("flushes the coach's voice and sends the stop at once; no local line while live (D-036 item 1)", async () => {
    const h = harness();
    h.session.start();
    await run(900);
    h.emit(coachAudio(2));
    expect(h.session.getSnapshot().speaking).toBe(true);
    h.push({ p: 0, type: "safety_stop", reason: "pain_stop", t: Date.now() });
    expect(h.speaker.flushes).toBe(1);
    expect(h.session.getSnapshot().speaking).toBe(false);
    expect(h.voice.said).toEqual([]);
    expect(h.contexts().at(-1)).toMatchObject({ turnComplete: true });
    expect(h.contexts().at(-1)!.text).toContain("type=safety_stop reason=pain_stop");
    // Only P0 passes until the app reopens.
    h.voice.end();
    await run(3000);
    h.push(question());
    expect(h.contexts().filter((c) => c.turnComplete)).toHaveLength(1);
    h.session.reopen();
    h.push(question());
    expect(h.contexts().filter((c) => c.turnComplete)).toHaveLength(2);
  });
});

/* ------------------------------------------------------- fallbacks */

describe("the fallbacks of rule 6, each within 1 s, with the test going on by buttons", () => {
  it("falls back on a transport error", async () => {
    const h = harness();
    const host = h.host as RefRomHost;
    h.session.start();
    await run(900);
    h.emit({ type: "error", code: "socket_error" });
    expect(h.session.getSnapshot().mode).toBe("local");
    expect(h.live().sent.at(-1)).toEqual({ kind: "close" });
    expect(h.reports.at(-1)).toMatchObject({ endReason: "fallback_error", sessionId: SID });
    expect(h.audioSessions).toEqual([true, false]);
    host.askCanMove();
    h.push(question());
    expect(h.voice.said.map((x) => x.line)).toEqual(["rom_can_move_ask"]);
    expect(host.buttonCanMove(true)).toBe(true);
  });

  it("goes local on a slow setupComplete at 3 s, and live on that socket when it completes (D-035 item 3)", async () => {
    const h = harness({ setupMs: 4000 });
    h.session.start();
    await run(2999);
    expect(h.session.getSnapshot().mode).toBe("connecting");
    await run(1);
    expect(h.session.getSnapshot().mode).toBe("local");
    expect(h.reports.at(-1)).toMatchObject({ endReason: "fallback_slow" });
    await run(2000);
    expect(h.session.getSnapshot().mode).toBe("live");
    expect(h.transports).toHaveLength(1);
    expect(h.mints).toHaveLength(1);
  });

  it("falls back offline: at once when offline at the start, within 1 s when the network drops", async () => {
    const off = harness({ online: false });
    off.session.start();
    await run(0);
    expect(off.session.getSnapshot().mode).toBe("local");
    expect(off.mints).toEqual([]);
    const h = harness();
    h.session.start();
    await run(900);
    h.setOnline(false);
    expect(h.session.getSnapshot().mode).toBe("local");
    expect(h.reports.at(-1)).toMatchObject({ endReason: "offline" });
  });

  it("falls back after two questions the coach did not voice", async () => {
    const h = harness();
    h.session.start();
    await run(900);
    h.push(question());
    await run(4000);
    // The first question's local line has played to its end (a waiting question is asked only then).
    h.voice.end();
    h.push({ p: 1, type: "ask_pain", movement: "shoulder_flexion", side: "right", t: Date.now() });
    await run(1500);
    expect(h.session.getSnapshot().mode).toBe("local");
    expect(h.reports.at(-1)).toMatchObject({ endReason: "fallback_slow" });
  });

  it("reconnects at the next movement boundary after a fallback, with the snapshot and a re-mint", async () => {
    const h = harness();
    h.session.start();
    await run(900);
    h.emit({ type: "error", code: "socket_error" });
    await run(5000);
    expect(h.mints).toHaveLength(1);
    h.push(movementResult());
    await run(900);
    expect(h.mints).toHaveLength(2);
    expect(h.mints[1]).toEqual(h.mints[0]);
    expect(h.transports).toHaveLength(2);
    expect(h.session.getSnapshot().mode).toBe("live");
    const history = h.live().options!.history;
    expect(history[0].text).toContain("[CTX now rom item=shoulder_flexion_right phase=attempt]");
    expect(history[1]).toEqual(HISTORY[1]);
    // The boundary's own line reaches the new session.
    expect(h.contexts().at(-1)!.text).toContain("type=movement_result");
  });

  it("stays local for the segment when the budget refuses the token, and when the coach is not allowed", async () => {
    for (const [status, error] of [
      [429, "BUDGET"],
      [403, "CONSENT_REQUIRED"],
      [503, "AGENT_UNAVAILABLE"],
    ] as const) {
      const h = harness({ mint: () => ({ ok: false, status, error }) });
      h.session.start();
      await run(100);
      expect(h.session.getSnapshot().mode, error).toBe("local");
      // D-034 item 3: a refused token is never silent (the page's console says why).
      expect(
        h.logs.some((l) => l.message.includes("token") && l.data?.error === error),
        error,
      ).toBe(true);
      h.push(movementResult());
      await run(2000);
      expect(h.mints, error).toHaveLength(1);
      expect(h.transports).toEqual([]);
    }
  });
});

/* ----------------------------------------------------- the rotation */

describe("the rotation of rule 7 and S0-3", () => {
  it("starts a new session at the next boundary after goAway, never mid item", async () => {
    const h = harness();
    h.session.start();
    await run(900);
    h.emit({ type: "goAway", timeLeftMs: 10_000 });
    h.push({
      p: 3,
      type: "attempt_saved",
      movement: "shoulder_flexion",
      side: "right",
      deg: 117,
      t: Date.now(),
    });
    await run(1000);
    expect(h.transports).toHaveLength(1);
    h.push(movementResult());
    expect(h.transports[0].sent.at(-1)).toEqual({ kind: "close" });
    await run(900);
    expect(h.mints).toHaveLength(2);
    expect(h.mints[1]).toEqual(h.mints[0]);
    expect(h.transports).toHaveLength(2);
    expect(h.session.getSnapshot().mode).toBe("live");
    // The rest of the segment: the server's history with the host's snapshot, sent first.
    expect(h.live().sent[0]).toEqual({
      kind: "history",
      turns: [
        { role: "user", text: `${HISTORY[0].text}\n[CTX now rom item=shoulder_flexion_right phase=attempt]` },
        HISTORY[1],
      ],
    });
    // A planned rotation is no fallback: the report waits for the end of the segment.
    expect(h.reports).toEqual([]);
  });

  it("rotates at the boundary after setupComplete plus 9.5 minutes", async () => {
    const h = harness();
    h.session.start();
    await run(900);
    h.push(movementResult());
    await run(100);
    expect(h.transports).toHaveLength(1);
    await run(ROTATE_AFTER_SETUP_MS);
    expect(h.transports).toHaveLength(1);
    h.push(movementResult());
    await run(900);
    expect(h.transports).toHaveLength(2);
    expect(h.mints).toHaveLength(2);
  });

  it("rotates before the token expires: 60 s before expiresAt", async () => {
    const h = harness({
      mint: (_r, n) => ({ ok: true, token: token(n, { minutes: 1 }), serverDate: Date.now() }),
    });
    h.session.start();
    await run(900);
    // expiresAt is the mint plus 2 + 1 + 1 minutes: rotation is due from 3 minutes after the mint.
    await run(3 * 60_000 - 900 - 1);
    h.push(movementResult());
    await run(100);
    expect(h.transports).toHaveLength(1);
    await run(1);
    h.push(movementResult());
    await run(900);
    expect(h.transports).toHaveLength(2);
  });

  it("takes the close at the token's expiresAt as the end of its time, not an error", async () => {
    // A gait segment of 5 minutes: the token ends 8 minutes after the mint, before the 10 minute limit.
    const h = harness({
      mint: (_r, n) => ({ ok: true, token: token(n, { minutes: 5 }), serverDate: Date.now() }),
    });
    h.session.start();
    await run(900);
    await run(8 * 60_000 - 900);
    h.emit({ type: "close", code: 1011, reason: "auth token has expired" });
    expect(h.session.getSnapshot().mode).toBe("local");
    expect(h.reports.at(-1)).toMatchObject({ endReason: "go_away" });
  });

  it("takes the close that follows a goAway as go_away, and comes back at the next boundary", async () => {
    const h = harness();
    h.session.start();
    await run(900);
    h.emit({ type: "goAway", timeLeftMs: 5_000 });
    await run(5_000);
    // No boundary came in time: Google ends the connection it announced.
    h.emit({ type: "close", code: 1000, reason: "" });
    expect(h.session.getSnapshot().mode).toBe("local");
    expect(h.reports.at(-1)).toMatchObject({ endReason: "go_away" });
    h.push(movementResult());
    await run(900);
    expect(h.transports).toHaveLength(2);
    expect(h.mints).toHaveLength(2);
    expect(h.session.getSnapshot().mode).toBe("live");
    h.session.end("done");
    expect(h.reports.at(-1)).toMatchObject({ endReason: "done" });
  });

  it("takes a 1011 close after 595 s as the connection limit, and an earlier one as an error", async () => {
    const h = harness();
    h.session.start();
    await run(900);
    await run(596_000);
    h.emit({ type: "close", code: 1011, reason: "The service is currently unavailable." });
    expect(h.session.getSnapshot().mode).toBe("local");
    expect(h.reports.at(-1)).toMatchObject({ endReason: "go_away" });
    const e = harness();
    e.session.start();
    await run(900);
    await run(30_000);
    e.emit({ type: "close", code: 1011, reason: "The service is currently unavailable." });
    expect(e.reports.at(-1)).toMatchObject({ endReason: "fallback_error" });
  });
});

/* -------------------------------------------------- cancellations */

describe("a cancellation after the app applied the call (C-17)", () => {
  it("leaves the app state as applied and tells the coach tool_applied", async () => {
    const h = harness();
    const host = h.host as RefRomHost;
    h.session.start();
    await run(900);
    host.askCanMove();
    h.push(question());
    h.emit(coachAudio());
    await run(1500);
    h.emit(heard("نعم"));
    h.emit(call("c1", "answer_can_move", { movement: "shoulder_flexion", side: "right", canMove: true }));
    h.emit({ type: "toolCallCancellation", ids: ["c1"] });
    expect(host.canMove).toHaveLength(1);
    expect(host.phase).toBe("attempt");
    await run(5000);
    expect(h.contexts().at(-1)).toMatchObject({ turnComplete: false });
    expect(h.contexts().at(-1)!.text).toContain("type=tool_applied name=answer_can_move accepted=yes");
  });
});

/* ------------------------------------------------- the usage report */

describe("the usage report (5.2)", () => {
  it("is sent at the end with the whole segment, and the coach is off after it", async () => {
    const h = harness();
    h.session.start();
    await run(900);
    h.emit({ type: "usage", promptTokens: 2000, responseTokens: 150 });
    h.emit({ type: "turnComplete" });
    h.emit({ type: "usage", promptTokens: 2400, responseTokens: 90 });
    await run(60_000);
    h.session.end("done");
    expect(h.reports).toEqual([
      {
        sessionId: SID,
        connectMs: 900,
        durationSec: 60,
        turns: 1,
        toolCalls: {},
        promptTokens: 4400,
        responseTokens: 240,
        firstAudioMs: null,
        endReason: "done",
        failure: null,
      },
    ]);
    expect(h.session.getSnapshot().mode).toBe("off");
    expect(h.mic.stopped).toBe(true);
    expect(h.speaker.closed).toBe(true);
    expect(h.audioSessions.at(-1)).toBe(false);
    h.push(question());
    expect(h.live().sent.at(-1)).toEqual({ kind: "close" });
    h.session.end("done");
    expect(h.reports).toHaveLength(1);
  });

  it("is sent when the page hides, and the segment goes on with the local voice", async () => {
    const h = harness();
    h.session.start();
    await run(900);
    await run(20_000);
    h.hide();
    expect(h.reports.at(-1)).toMatchObject({ endReason: "user_end", durationSec: 20 });
    expect(h.session.getSnapshot().mode).toBe("local");
    h.session.end("done");
    expect(h.reports.at(-1)).toMatchObject({ endReason: "user_end" });
  });

  it("keeps the fallback reason at the end of a segment that stayed local", async () => {
    const h = harness();
    h.session.start();
    await run(900);
    h.emit({ type: "error", code: "socket_error" });
    h.session.end("done");
    expect(h.reports.map((r) => r.endReason)).toEqual(["fallback_error", "fallback_error"]);
  });

  it("sends none for a segment that never had a session", async () => {
    const h = harness({ mint: () => ({ ok: false, status: 429, error: "BUDGET" }) });
    h.session.start();
    await run(100);
    h.session.end("done");
    expect(h.reports).toEqual([]);
  });
});

/* ----------------------------------------------------- the captions */

describe("captions (S0-6)", () => {
  it("shows the coach's words that came with audio in the session language, and the person's", async () => {
    const h = harness();
    h.session.start();
    await run(900);
    h.emit(coachAudio(2));
    h.emit({ type: "outputTranscript", text: "هل هذا أقصى ما تستطيع؟" });
    h.emit({ type: "outputTranscript", text: "以下哪项是正确的" });
    h.emit({ type: "turnComplete" });
    h.emit(heard("نعم"));
    expect(h.session.getSnapshot().captions).toEqual([
      { who: "coach", text: "هل هذا أقصى ما تستطيع؟" },
      { who: "person", text: "نعم" },
    ]);
    h.emit(coachAudio(1));
    h.emit({ type: "outputTranscript", text: "ارفع" });
    h.emit({ type: "interrupted" });
    expect(h.speaker.flushes).toBe(1);
    expect(h.session.getSnapshot().captions.map((c) => c.text)).toEqual(["هل هذا أقصى ما تستطيع؟", "نعم"]);
  });

  it("tells subscribers when the state changes", async () => {
    const h = harness();
    const seen: string[] = [];
    h.session.subscribe(() => seen.push(h.session.getSnapshot().mode));
    h.session.start();
    await run(900);
    h.emit({ type: "error", code: "x" });
    expect(seen).toEqual(["live", "local"]);
  });
});

/* ----------------------------------------------------- a workout */

describe("a workout segment with the session host", () => {
  function screen(): SessionScreen & { stopList: string[] } {
    const stopList: string[] = [];
    return {
      stopList,
      pause() {},
      resume() {},
      instructions: () => "Stand tall.",
      openStopList: (reason) => stopList.push(reason),
      stopExercise() {},
      painOk() {},
    };
  }

  it("sends no rep count as a triggering event and opens the stop list on a spoken chest pain", async () => {
    const sc = screen();
    const host = new SessionHost(sc, null);
    const h = harness({ host, segment: "session:1" });
    h.session.start();
    await run(900);
    expect(h.mints[0]).toMatchObject({ block: "session", segment: "session:1", ref: { workoutId: CHECK } });
    host.setStep("active", "sit_to_stand set 1");
    for (let i = 1; i <= 10; i++) {
      h.push({ p: 3, type: "reps", exercise: "sit_to_stand", count: i, target: 10, t: Date.now() });
      await run(700);
    }
    expect(h.contexts().filter((c) => c.turnComplete)).toEqual([]);
    expect(
      h
        .contexts()
        .map((c) => c.text)
        .join("\n"),
    ).not.toContain("count=3 ");
    h.emit(heard("صدري يوجعني"));
    h.emit(call("s1", "stop", { reason: "chest" }));
    expect(sc.stopList).toEqual(["chest"]);
    expect(host.step().kind).toBe("safety");
    // The stop waits for the person's tap: the screen confirms, then pushes the P0.
    expect(h.contexts().filter((c) => c.turnComplete)).toEqual([]);
  });

  it("comes back after a fallback only at the next step, never mid exercise", async () => {
    const host = new SessionHost(screen(), null);
    const h = harness({ host, segment: "session:1" });
    h.session.start();
    await run(900);
    host.setStep("active", "sit_to_stand set 1");
    h.emit({ type: "error", code: "socket_error" });
    expect(h.session.getSnapshot().mode).toBe("local");
    for (let i = 1; i <= 3; i++)
      h.push({ p: 3, type: "reps", exercise: "sit_to_stand", count: i, target: 10, t: Date.now() });
    await run(2000);
    expect(h.transports).toHaveLength(1);
    host.setStep("timer", "rest");
    h.push({ p: 3, type: "step_start", label: "rest", t: Date.now() });
    await run(900);
    expect(h.transports).toHaveLength(2);
    expect(h.mints).toHaveLength(2);
    expect(h.session.getSnapshot().mode).toBe("live");
    expect(h.live().sent[0]).toMatchObject({ kind: "history" });
  });
});

/* ------------------------------------------------------- a walk */

describe("a gait segment with the reference gait host", () => {
  const responses = (h: ReturnType<typeof harness>) =>
    h
      .live()
      .sent.flatMap((s) => (s.kind === "toolResponse" ? s.responses : []))
      .map((r) => [r.id, r.response]);

  it("ends the walk on a spoken pain, waits for a tap to walk again, and ends the test pain_limited at a rise of 2", async () => {
    const gait = new RefGaitHost();
    gait.painToday = { knee: 2 };
    const h = harness({ host: gait, segment: "gait" });
    h.session.start();
    await run(900);
    expect(h.mints[0]).toMatchObject({ block: "gait", segment: "gait", ref: { checkId: CHECK } });
    gait.walk();
    h.push({ p: 3, type: "step_start", label: "walk_side", t: Date.now() });
    gait.cycle();
    gait.cycle();
    gait.cycle();
    // The coach's own pain call, with nothing said by the person, changes nothing (S0-2).
    h.emit(call("g0", "mark_pain", { level: 0 }));
    expect(gait.recording).toBe(true);
    h.emit(heard("ركبتي توجعني شوي، ثلاثة"));
    h.emit(call("g1", "mark_pain", { level: 3, location: "knee" }));
    expect(gait.recording).toBe(false);
    expect(gait.recordingsEnded).toEqual([3]);
    // Nothing on the screen for the coach to press (no button registered): walking again is a tap.
    h.emit(call("g2", "next_step", {}));
    expect(gait.step()).toEqual({ kind: "confirm", finished: false });
    gait.walk();
    gait.cycle();
    h.emit(heard("زاد الألم، أربعة"));
    h.emit(call("g3", "mark_pain", { level: 4, location: "knee" }));
    expect(gait.outcome).toEqual({ label: "pain_limited", cleanCycles: 4 });
    h.emit(call("g4", "resume", {}));
    expect(responses(h)).toEqual([
      ["g0", { accepted: false, reason: "no_answer_heard", say: "ask_and_wait" }],
      ["g1", { accepted: true, say: "pain_ok", data: { action: "recording_ended" } }],
      ["g2", { accepted: false, reason: "not_allowed", say: "tap_to_confirm" }],
      ["g3", { accepted: true, say: "pain_stop", data: { action: "stop_test" } }],
      ["g4", { accepted: false, reason: "safety_stop" }],
    ]);
  });

  it("presses the screen's Ready only on the person's words, never on its own or on a pad safety step (D-036 item 2)", async () => {
    const gait = new RefGaitHost();
    const h = harness({ host: gait, segment: "gait" });
    h.session.start();
    await run(900);
    const pressed: string[] = [];
    const showReady = (id: GaitStepId) => {
      gait.show(id);
      return gait.actions.show(id, () => [
        { name: "ready", intents: GO_ON, say: "starting", press: () => void pressed.push(id) },
      ]);
    };
    // The model on its own, with the screen's Ready showing and nothing said: refused.
    showReady("clear_path");
    h.emit(call("own", "next_step", { intent: "ready" }));
    // The person says they are ready: pressed.
    h.emit(heard("جاهز"));
    h.emit(call("said", "next_step", { intent: "ready" }));
    // A second call after the press, on the next screen, with no new words: refused.
    showReady("support_nearby");
    h.emit(call("again", "next_step", { intent: "ready" }));
    // A pad safety step shows no button for the coach: nothing to press, whatever was said.
    gait.show("pad_floor_and_stop_key");
    gait.actions.show("pad_floor_and_stop_key", () => []);
    h.emit(heard("جاهز"));
    h.emit(call("safety", "next_step", { intent: "ready" }));
    // Words said more than 10 s before the call press nothing.
    showReady("pad_step_on_stopped");
    h.emit(heard("جاهز"));
    await run(10_100);
    h.emit(call("stale", "next_step", { intent: "ready" }));
    expect(responses(h)).toEqual([
      ["own", { accepted: false, reason: "no_answer_heard", say: "ask_and_wait" }],
      ["said", { accepted: true, say: "starting", data: { pressed: "ready" } }],
      ["again", { accepted: false, reason: "no_answer_heard", say: "ask_and_wait" }],
      ["safety", { accepted: false, reason: "not_allowed", say: "tap_to_confirm" }],
      ["stale", { accepted: false, reason: "no_answer_heard", say: "ask_and_wait" }],
    ]);
    expect(pressed).toEqual(["clear_path"]);
  });

  it("comes back after a fallback only at the end of a pass, with the host's state", async () => {
    const gait = new RefGaitHost();
    const h = harness({ host: gait, segment: "gait" });
    h.session.start();
    await run(900);
    gait.walk();
    h.emit({ type: "error", code: "socket_error" });
    expect(h.session.getSnapshot().mode).toBe("local");
    // Mid walk: a new step and a setup correction are no boundary.
    h.push({ p: 3, type: "step_start", label: "walk_side", t: Date.now() });
    h.push({ p: 2, type: "setup_issue", issue: "too_close", t: Date.now() });
    await run(2000);
    expect(h.transports).toHaveLength(1);
    gait.cycle();
    gait.passDone();
    h.push({ p: 3, type: "pass_done", view: "side", cleanCycles: 1, needed: 6, t: Date.now() });
    await run(900);
    expect(h.transports).toHaveLength(2);
    expect(h.mints).toHaveLength(2);
    expect(h.session.getSnapshot().mode).toBe("live");
    expect(h.live().sent[0]).toEqual({
      kind: "history",
      turns: [{ role: "user", text: `${HISTORY[0].text}\n[CTX now gait step=walk cycles=1]` }, HISTORY[1]],
    });
  });
});
