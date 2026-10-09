/**
 * The coach's connection test (D-035 item 4, /?coachlab=1), the part without a screen: it runs the
 * Live coach's connection one stage at a time with the coach's own parts (the token route, the
 * transport, MicCapture and Speaker), and says for each stage whether it worked, how long it took and,
 * when it did not, the exact error. Nasser and the tech lead read the same seven steps:
 *
 *   1 token        POST /api/agent/lab-token
 *   2 socket       the WebSocket opened
 *   3 setup        setupComplete
 *   4 mic          the microphone's permission and stream (getUserMedia)
 *   5 audio        the AudioContext and the capture worklet
 *   6 first_audio  the coach's first audio, received and played («هل تسمعني؟»)
 *   7 answer       the person's spoken answer, transcribed
 *
 * The first stage that fails ends the run (the later ones are skipped); the usage report carries the
 * failure, so the run's agent_sessions row says the same as the screen. Nothing of the person is kept:
 * the page shows the transcription, the server never gets it. Pure, no DOM: the page gives the deps.
 */
import { coachFailure, type CoachFailure } from "../../coach/failure";
import type { LiveTransport, TransportEvent } from "../../coach/types";
import type { TokenResponse, UsageReport } from "../../../server/modules/agent/types";
import type { MintResult } from "./session";
import type { TransportStage } from "./transport";

export const LAB_STEP_IDS = ["token", "socket", "setup", "mic", "audio", "first_audio", "answer"] as const;
export type LabStepId = (typeof LAB_STEP_IDS)[number];
export type LabStatus = "waiting" | "running" | "ok" | "failed" | "skipped";

export interface LabStep {
  id: LabStepId;
  status: LabStatus;
  /** ms from the start of the step's own wait (the token's round trip, the connect, ...). */
  ms: number | null;
  /** What the step found (a sample rate, the words heard), for the page. */
  detail: string;
  failure: CoachFailure | null;
}

/** What the page sends to have the coach ask (server/modules/agent/lab.ts LAB_ASK). */
export const LAB_ASK = "[LAB ask]";

/** The microphone as the lab drives it (MicCapture with a hook when getUserMedia resolved). */
export interface LabMic {
  start(onChunk: (pcm16k: ArrayBuffer) => void): Promise<void>;
  stop(): void;
  readonly level: number;
}
export interface LabSpeaker {
  play(pcm24k: ArrayBuffer): void;
  readonly playing: boolean;
  readonly audible?: boolean;
  onIdle(fn: () => void): () => void;
  close(): void;
}
export type LabTransport = LiveTransport & {
  onStage?(fn: (stage: TransportStage, ms: number) => void): () => void;
};

export interface LabDeps {
  now(): number;
  mint(): Promise<MintResult>;
  transport(): LabTransport;
  /** The microphone; `granted` is called when getUserMedia gave a stream, with what it found. */
  mic(granted: (detail: string) => void): LabMic;
  speaker(): LabSpeaker;
  /** The usage report of the run's row (none without a token). */
  report(r: UsageReport): void;
  /** The browser's state at a point of the run (audio session, context, camera), for the page. */
  probe?(when: "before_mic" | "after_mic" | "after_audio" | "end"): Promise<Record<string, unknown>>;
  /** Timers (tests give fake ones through vitest). */
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

export interface LabOptions {
  /** No coach audio this long after the question: the playback stage failed. */
  firstAudioMs?: number;
  /** No words from the person this long after the coach asked: the answer stage failed. */
  answerMs?: number;
}

export interface LabResult {
  steps: LabStep[];
  ok: boolean;
  /** Why it did not work (each failed step), and what looked wrong although it worked. */
  reasons: string[];
  said: string;
  heard: string;
  diagnostics: Record<string, unknown>;
}

export const FIRST_AUDIO_MS = 12_000;
export const ANSWER_MS = 20_000;

/** One line of a failure, as the page and the copied report write it. */
export const failureLine = (f: CoachFailure) => `${f.stage}: ${f.name}${f.message ? ` (${f.message})` : ""}`;

/** The steps before a run. */
export const labSteps = (): LabStep[] =>
  LAB_STEP_IDS.map((id) => ({ id, status: "waiting", ms: null, detail: "", failure: null }));

class Stop extends Error {}

/** Runs the test; `onUpdate` gets the steps after every change. Never throws. */
export async function runCoachLab(
  deps: LabDeps,
  onUpdate: (steps: LabStep[], live: { said: string; heard: string }) => void,
  opts: LabOptions = {},
): Promise<LabResult> {
  const set = deps.setTimeout ?? setTimeout;
  const clear = deps.clearTimeout ?? clearTimeout;
  const steps = labSteps();
  const diagnostics: Record<string, unknown> = {};
  const warnings: string[] = [];
  let said = "";
  let heard = "";
  const push = () =>
    onUpdate(
      steps.map((s) => ({ ...s })),
      { said, heard },
    );
  const step = (id: LabStepId) => steps.find((s) => s.id === id)!;
  const start = (id: LabStepId) => {
    step(id).status = "running";
    push();
  };
  const ok = (id: LabStepId, ms: number | null, detail = "") => {
    Object.assign(step(id), { status: "ok", ms, detail });
    push();
  };
  const fail = (id: LabStepId, failure: CoachFailure, ms: number | null = null): never => {
    Object.assign(step(id), { status: "failed", ms, failure });
    for (const s of steps) if (s.status === "waiting" || s.status === "running") s.status = "skipped";
    push();
    throw new Stop();
  };
  const probe = async (when: "before_mic" | "after_mic" | "after_audio" | "end") => {
    try {
      if (deps.probe) diagnostics[when] = await deps.probe(when);
    } catch {
      /* a probe never breaks the test */
    }
  };

  let token: TokenResponse | null = null;
  let transport: LabTransport | null = null;
  let mic: LabMic | null = null;
  let speaker: LabSpeaker | null = null;
  let failure: CoachFailure | null = null;
  let connectMs: number | null = null;
  let firstAudio: number | null = null;
  let liveAt: number | null = null;
  let turns = 0;
  let prompt = 0;
  let response = 0;
  let usageSeen = false;
  let levelMax = 0;
  /** The person's words ended (a final transcription, or the turn after them). */
  let answeredAt: number | null = null;
  let lastTurnAt: number | null = null;
  const waiters = new Set<(e: TransportEvent) => void>();
  /** The next event that `match` accepts, or null after `ms`. */
  const next = (match: (e: TransportEvent) => boolean, ms: number) =>
    new Promise<TransportEvent | null>((resolve) => {
      const done = (e: TransportEvent | null) => {
        waiters.delete(w);
        clear(timer);
        resolve(e);
      };
      const w = (e: TransportEvent) => {
        if (match(e)) done(e);
      };
      const timer = set(() => done(null), ms);
      waiters.add(w);
    });

  try {
    // 1. The token.
    start("token");
    const t0 = deps.now();
    let minted: MintResult;
    try {
      minted = await deps.mint();
    } catch (e) {
      minted = { ok: false, status: 0, error: e instanceof Error ? e.message : "NETWORK" };
    }
    if (!minted.ok)
      fail(
        "token",
        coachFailure("token", {
          name: minted.status ? `HTTP_${minted.status}` : "NETWORK",
          message: minted.error,
        }),
        deps.now() - t0,
      );
    else token = minted.token;
    ok("token", Math.round(deps.now() - t0), token!.model);

    // 2 and 3. The socket, then setupComplete.
    start("socket");
    transport = deps.transport();
    const t = transport;
    const c0 = deps.now();
    t.onStage?.((stage, ms) => {
      if (stage === "open" && step("socket").status === "running") {
        ok("socket", ms);
        start("setup");
      }
    });
    t.on((e) => {
      switch (e.type) {
        case "audio":
          speaker?.play(e.pcm24k);
          firstAudio ??= deps.now();
          break;
        case "outputTranscript":
          said += e.text;
          push();
          break;
        case "inputTranscript":
          heard += e.text;
          if (e.final) answeredAt ??= deps.now();
          push();
          break;
        case "turnComplete":
          turns++;
          if (heard.trim()) answeredAt ??= deps.now();
          lastTurnAt = deps.now();
          break;
        case "usage":
          usageSeen = true;
          prompt += e.promptTokens;
          response += e.responseTokens;
          break;
        case "error":
        case "close":
          failure ??= coachFailure(
            "live",
            e.type === "error"
              ? { name: e.code, message: e.code }
              : { name: `closed_${e.code}`, message: `closed_${e.code}${e.reason ? `: ${e.reason}` : ""}` },
          );
          break;
      }
      for (const w of [...waiters]) w(e);
    });
    try {
      await t.connect({
        token: token!.token,
        model: token!.model,
        apiVersion: token!.apiVersion,
        history: token!.history,
      });
    } catch (e) {
      const f = coachFailure("socket", e);
      if (f.stage === "setup") {
        if (step("socket").status === "running") ok("socket", null);
        fail("setup", f, deps.now() - c0);
      }
      fail("socket", f, deps.now() - c0);
    }
    connectMs = Math.round(deps.now() - c0);
    liveAt = deps.now();
    if (step("socket").status === "running") ok("socket", null);
    ok("setup", connectMs);

    // 4 and 5. The microphone, then the AudioContext and the worklet.
    await probe("before_mic");
    start("mic");
    speaker = deps.speaker();
    const m0 = deps.now();
    mic = deps.mic((detail) => ok("mic", Math.round(deps.now() - m0), detail));
    try {
      await mic.start((pcm) => {
        levelMax = Math.max(levelMax, mic?.level ?? 0);
        t.sendAudio(pcm);
      });
    } catch (e) {
      const f = coachFailure("mic", e);
      if (f.stage === "audio") {
        if (step("mic").status !== "ok") ok("mic", null);
        fail("audio", f, deps.now() - m0);
      }
      fail("mic", f, deps.now() - m0);
    }
    if (step("mic").status !== "ok") ok("mic", Math.round(deps.now() - m0));
    await probe("after_mic");
    ok("audio", Math.round(deps.now() - m0));

    // 6. The coach's first audio, played to its end.
    start("first_audio");
    const a0 = deps.now();
    t.sendContext(LAB_ASK, true);
    const audio = await next((e) => e.type === "audio", opts.firstAudioMs ?? FIRST_AUDIO_MS);
    if (!audio)
      fail(
        "first_audio",
        failure ?? {
          stage: "playback",
          name: "NoCoachAudio",
          message: `no coach audio within ${Math.round((opts.firstAudioMs ?? FIRST_AUDIO_MS) / 1000)} s`,
        },
        deps.now() - a0,
      );
    const firstMs = Math.round((firstAudio ?? deps.now()) - a0);
    // The turn ends, then the voice plays out.
    await next((e) => e.type === "turnComplete", 15_000);
    const s = speaker;
    if (s.playing)
      await new Promise<void>((resolve) => {
        const off = s.onIdle(() => {
          off();
          resolve();
        });
        set(() => {
          off();
          resolve();
        }, 15_000);
      });
    await probe("after_audio");
    if (s.audible === false)
      fail("first_audio", {
        stage: "playback",
        name: "ContextNotRunning",
        message: "the coach's audio arrived but the AudioContext was not running, so nothing was heard",
      });
    ok("first_audio", firstMs, said.trim());

    // 7. The person's answer.
    start("answer");
    const q0 = deps.now();
    // The answer may have come while the question still played.
    if (answeredAt === null)
      await next(
        (e) =>
          (e.type === "inputTranscript" && e.final) || (e.type === "turnComplete" && heard.trim() !== ""),
        opts.answerMs ?? ANSWER_MS,
      );
    if (!heard.trim())
      fail(
        "answer",
        failure ?? {
          stage: "mic",
          name: "NoAnswerHeard",
          message:
            levelMax < 0.003
              ? `no words heard in ${Math.round((opts.answerMs ?? ANSWER_MS) / 1000)} s; the microphone gave silence (loudest frame ${levelMax.toFixed(4)})`
              : `no words heard in ${Math.round((opts.answerMs ?? ANSWER_MS) / 1000)} s (loudest frame ${levelMax.toFixed(3)})`,
        },
        deps.now() - q0,
      );
    const answerMs = Math.round((answeredAt ?? deps.now()) - q0);
    // The coach's short reply, if it has not come yet.
    const answeredWhen = answeredAt ?? deps.now();
    if (lastTurnAt === null || lastTurnAt < answeredWhen || heard === "")
      await next((e) => e.type === "turnComplete", 6000);
    ok("answer", Math.max(0, answerMs), heard.trim());
  } catch (e) {
    if (!(e instanceof Stop)) {
      const running = steps.find((s) => s.status === "running");
      if (running)
        try {
          fail(running.id, coachFailure(running.id === "token" ? "token" : "live", e));
        } catch {
          /* stopped */
        }
    }
  } finally {
    await probe("end");
    try {
      mic?.stop();
      transport?.close();
      speaker?.close();
    } catch {
      /* already closed */
    }
  }

  const failed = steps.filter((s) => s.status === "failed");
  failure = failed[0]?.failure ?? null;
  const camera = (diagnostics.after_mic as { camera?: { running?: boolean } } | undefined)?.camera;
  if (camera && camera.running === false)
    warnings.push("camera: the camera stopped when the microphone started");
  if (token)
    deps.report({
      sessionId: token.sessionId,
      connectMs: connectMs === null ? null : Math.min(600_000, Math.max(0, connectMs)),
      durationSec:
        liveAt === null ? 0 : Math.min(3600, Math.max(0, Math.round((deps.now() - liveAt) / 1000))),
      turns: Math.min(500, turns),
      toolCalls: {},
      promptTokens: usageSeen ? Math.min(10_000_000, prompt) : null,
      responseTokens: usageSeen ? Math.min(10_000_000, response) : null,
      firstAudioMs:
        step("first_audio").status === "ok" && step("first_audio").ms !== null
          ? { p50: Math.min(60_000, step("first_audio").ms!), p90: Math.min(60_000, step("first_audio").ms!) }
          : null,
      endReason: failure ? "fallback_error" : "done",
      failure,
    });
  diagnostics.levelMax = Math.round(levelMax * 10_000) / 10_000;
  return {
    steps,
    ok: failed.length === 0,
    reasons: [...failed.map((s) => `${s.id}: ${failureLine(s.failure!)}`), ...warnings],
    said: said.trim(),
    heard: heard.trim(),
    diagnostics,
  };
}

/* ------------------------------------------------- the e2e coach of the lab */

/**
 * VITE_E2E builds (?e2eCoach=fake): what FakeLiveTransport answers in the lab, so a browser test runs
 * the real microphone, worklet and speaker without Google: «هل تسمعني؟» with real audio 300 ms after the
 * question, then, after 1.2 s of microphone frames, the person's answer and a short reply.
 */
export function labResponder(tone: () => ArrayBuffer) {
  let frames = 0;
  let asked = false;
  let answered = false;
  return (
    sent: { kind: string; text?: string; turnComplete?: boolean },
    fake: { after(ms: number, e: TransportEvent): void },
  ) => {
    if (sent.kind === "context" && sent.text === LAB_ASK && sent.turnComplete) {
      asked = true;
      fake.after(300, { type: "audio", pcm24k: tone() });
      fake.after(320, { type: "outputTranscript", text: "هل تسمعني؟" });
      fake.after(900, { type: "turnComplete" });
      fake.after(950, { type: "usage", promptTokens: 120, responseTokens: 40 });
    }
    if (sent.kind === "audio" && asked && !answered && ++frames >= 60) {
      answered = true;
      fake.after(50, { type: "inputTranscript", text: "نعم أسمعك", final: true });
      fake.after(300, { type: "audio", pcm24k: tone() });
      fake.after(320, { type: "outputTranscript", text: "نعم، أسمعك بوضوح." });
      fake.after(800, { type: "turnComplete" });
    }
  };
}
