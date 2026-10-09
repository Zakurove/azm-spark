/**
 * D-035 item 4: the coach's connection test (/?coachlab=1) without a screen. runCoachLab runs the seven
 * stages (token, socket, setupComplete, microphone, AudioContext and worklet, the first coach audio
 * played, the spoken answer), stops at the first one that fails with its exact error, skips the rest,
 * and sends the usage report with that failure. The fakes: FakeLiveTransport with the lab's own e2e
 * responder, the harness's microphone and speaker, fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LAB_ASK,
  LAB_STEP_IDS,
  labResponder,
  runCoachLab,
  type LabDeps,
  type LabResult,
  type LabStep,
} from "../../src/features/coach-agent/labRun";
import { FakeLiveTransport, type FakeScript } from "../../src/features/coach-agent/fake";
import { CoachStageError } from "../../src/coach/failure";
import type { MintResult } from "../../src/features/coach-agent/session";
import type { UsageReport } from "../../server/modules/agent/types";
import { FakeMic, FakeSpeaker } from "./d-coach-harness";

const SID = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TOKEN: MintResult = {
  ok: true,
  serverDate: null,
  token: {
    sessionId: SID,
    token: "auth_tokens/lab",
    model: "gemini-3.8-live",
    apiVersion: "v1beta",
    voice: "Achird",
    expiresAt: new Date(Date.now() + 240_000).toISOString(),
    newSessionExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    history: [
      { role: "user", text: "[CTX lab lang=ar]" },
      { role: "model", text: "جاهز." },
    ],
    minutesLeft: 60,
  },
};

interface Opts {
  mint?: MintResult;
  script?: FakeScript;
  micError?: unknown;
  /** The microphone's frames carry this level (0: silence). */
  level?: number;
  audible?: boolean;
  /** The fake coach answers (the lab responder); false: it never speaks. */
  coach?: boolean;
}

function lab(o: Opts = {}) {
  const reports: UsageReport[] = [];
  const updates: LabStep[][] = [];
  const mic = new FakeMic();
  mic.level = o.level ?? 0.05;
  const speaker = new FakeSpeaker();
  speaker.audible = o.audible ?? true;
  let transport: FakeLiveTransport | null = null;
  const tone = () => new ArrayBuffer(24_000);
  const deps: LabDeps = {
    now: () => Date.now(),
    mint: async () => o.mint ?? TOKEN,
    transport: () => {
      transport = new FakeLiveTransport({
        setupMs: 700,
        respond: o.coach === false ? undefined : labResponder(tone),
        ...o.script,
      });
      return transport;
    },
    mic: (granted) => ({
      async start(onChunk) {
        if (o.micError) {
          if (o.micError instanceof CoachStageError && o.micError.stage === "audio") granted("fake mic");
          throw o.micError;
        }
        granted("fake mic, 48000 Hz");
        await mic.start(onChunk);
      },
      stop: () => mic.stop(),
      get level() {
        return mic.level;
      },
    }),
    speaker: () => {
      // The voice plays for 600 ms after each chunk.
      const play = speaker.play.bind(speaker);
      speaker.play = (pcm) => {
        play(pcm);
        setTimeout(() => speaker.idle(), 600);
      };
      return speaker;
    },
    report: (r) => reports.push(structuredClone(r)),
  };
  // The microphone sends a frame every 20 ms once it runs.
  const frames = setInterval(() => mic.frame(), 20);
  const done: Promise<LabResult> = runCoachLab(deps, (s) => updates.push(s), {
    firstAudioMs: 5000,
    answerMs: 8000,
  }).finally(() => clearInterval(frames));
  return { done, reports, updates, mic, speaker, transport: () => transport! };
}

const statuses = (r: LabResult) => Object.fromEntries(r.steps.map((s) => [s.id, s.status]));

beforeEach(() => vi.useFakeTimers({ now: Date.UTC(2026, 9, 9, 9) }));
afterEach(() => vi.useRealTimers());

describe("the coach's connection test (D-035 item 4)", () => {
  it("passes every stage: the question is asked and played, the answer heard, the report done", async () => {
    const l = lab();
    await vi.advanceTimersByTimeAsync(20_000);
    const r = await l.done;
    expect(r.steps.map((s) => s.id)).toEqual([...LAB_STEP_IDS]);
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(Object.values(statuses(r)).every((s) => s === "ok")).toBe(true);
    expect(r.said).toContain("هل تسمعني؟");
    expect(r.heard).toBe("نعم أسمعك");
    expect(r.steps.find((s) => s.id === "setup")!.ms).toBe(700);
    expect(r.steps.find((s) => s.id === "first_audio")!.ms).toBe(300);
    expect(r.steps.find((s) => s.id === "answer")!.detail).toBe("نعم أسمعك");
    // The question went as the lab's cue, with the microphone's frames before and after it.
    const sent = l.transport().sent;
    expect(sent.find((s) => s.kind === "context")).toEqual({
      kind: "context",
      text: LAB_ASK,
      turnComplete: true,
    });
    expect(sent.filter((s) => s.kind === "audio").length).toBeGreaterThan(20);
    expect(l.reports).toEqual([
      expect.objectContaining({ sessionId: SID, connectMs: 700, endReason: "done", failure: null, turns: 2 }),
    ]);
    expect(l.mic.stopped).toBe(true);
    expect(l.speaker.closed).toBe(true);
    // Every step went through running before its tick.
    expect(l.updates.some((u) => u.find((s) => s.id === "answer")!.status === "running")).toBe(true);
  });

  it("stops at a refused token, skips the rest and reports nothing (no row)", async () => {
    const l = lab({ mint: { ok: false, status: 403, error: "CONSENT_REQUIRED" } });
    await vi.advanceTimersByTimeAsync(100);
    const r = await l.done;
    expect(r.ok).toBe(false);
    expect(statuses(r)).toEqual({
      token: "failed",
      socket: "skipped",
      setup: "skipped",
      mic: "skipped",
      audio: "skipped",
      first_audio: "skipped",
      answer: "skipped",
    });
    expect(r.reasons).toEqual(["token: token: HTTP_403 (CONSENT_REQUIRED)"]);
    expect(l.reports).toEqual([]);
  });

  it("names the iOS refusal of the microphone and reports it on the row", async () => {
    const l = lab({
      micError: new DOMException(
        "AudioSession category is not compatible with audio capture.",
        "InvalidStateError",
      ),
    });
    await vi.advanceTimersByTimeAsync(2000);
    const r = await l.done;
    expect(statuses(r)).toMatchObject({
      token: "ok",
      socket: "ok",
      setup: "ok",
      mic: "failed",
      audio: "skipped",
    });
    const failure = {
      stage: "mic",
      name: "InvalidStateError",
      message: "AudioSession category is not compatible with audio capture.",
    };
    expect(r.steps.find((s) => s.id === "mic")!.failure).toEqual(failure);
    expect(l.reports.at(-1)).toMatchObject({ endReason: "fallback_error", connectMs: 700, failure });
  });

  it("tells a worklet failure (the audio stage) from the microphone's", async () => {
    const l = lab({
      micError: new CoachStageError("audio", "AbortError", "the worklet module did not load"),
    });
    await vi.advanceTimersByTimeAsync(2000);
    const r = await l.done;
    expect(statuses(r)).toMatchObject({ mic: "ok", audio: "failed", first_audio: "skipped" });
    expect(r.reasons).toEqual(["audio: audio: AbortError (the worklet module did not load)"]);
  });

  it("tells a socket that never opened from a setup that never came", async () => {
    const l = lab({ script: { setupMs: null, failAfter: { ms: 400, code: "closed_1006", detail: "" } } });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await l.done;
    expect(statuses(r)).toMatchObject({ socket: "failed", setup: "skipped", mic: "skipped" });
    expect(r.steps.find((s) => s.id === "socket")!.failure).toMatchObject({
      stage: "socket",
      name: "closed_1006",
    });
  });

  it("fails the first audio when the coach never speaks, and when the context cannot sound", async () => {
    const quiet = lab({ coach: false });
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await quiet.done;
    expect(statuses(r)).toMatchObject({ audio: "ok", first_audio: "failed", answer: "skipped" });
    expect(r.steps.find((s) => s.id === "first_audio")!.failure).toMatchObject({
      stage: "playback",
      name: "NoCoachAudio",
    });
    const muted = lab({ audible: false });
    await vi.advanceTimersByTimeAsync(10_000);
    const m = await muted.done;
    expect(m.steps.find((s) => s.id === "first_audio")!.failure).toMatchObject({
      stage: "playback",
      name: "ContextNotRunning",
    });
  });

  it("fails the answer when nothing is heard, and says when the microphone gave silence", async () => {
    // A coach that asks but never hears the person.
    const l = lab({
      level: 0,
      script: {
        respond: (sent, fake) => {
          if (sent.kind === "context" && sent.turnComplete) {
            fake.after(300, { type: "audio", pcm24k: new ArrayBuffer(24_000) });
            fake.after(900, { type: "turnComplete" });
          }
        },
      },
    });
    await vi.advanceTimersByTimeAsync(30_000);
    const r = await l.done;
    expect(statuses(r)).toMatchObject({ first_audio: "ok", answer: "failed" });
    expect(r.steps.find((s) => s.id === "answer")!.failure).toMatchObject({
      stage: "mic",
      name: "NoAnswerHeard",
    });
    expect(r.steps.find((s) => s.id === "answer")!.failure!.message).toContain("the microphone gave silence");
  });
});
