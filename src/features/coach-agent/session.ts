/**
 * One coach segment (product v7 contract 2.11 useCoach, C-5, C-6, bridge rules 6 to 8, 5.1, 5.2;
 * stream D, step D4): the controller under useCoach. It owns the Live session of the segment (a token
 * from POST /api/agent/token, the transport, the microphone and the coach's voice), the event bridge,
 * the tool executor and the captions, and it falls back to the local voice whenever the coach cannot
 * keep up. The coach is an enhancement, never a dependency: every question has its buttons, every
 * safety line is local, and the test never waits on the network.
 *
 *   - Prewarm (rule 8): start() mints and connects at once, when the segment's setup card shows; a
 *     token whose new session window passed before the connect is minted again once (a re-mint).
 *   - Fallback to local (rule 6): a transport error or close, two questions without coach audio, the
 *     network going offline, the microphone refused, a token refused. A reconnect is tried only at the
 *     next boundary (range: a movement's result; gait: a pass; session: a new step), with a re-mint; a
 *     refusal that does not pass with time (the budget, no consent, the coach switched off) keeps the
 *     segment local.
 *   - Slow is not failed (D-035 item 3): with no setupComplete 3 s after the connect, the local voice
 *     takes over (fallback_slow is reported) while the same connection goes on in the background, up
 *     to the transport's 15 s; at its setupComplete the coach takes over, told where the person is.
 *   - The audio session is play-and-record before the microphone is asked (D-035 item 3: iOS keeps
 *     the check's playback type and the capture then cannot start), and playback again after.
 *   - Every failure keeps its stage, name and message (coach/failure.ts), sent in the usage report.
 *   - Rotation (rule 7, S0-3): after goAway, or from the earlier of setupComplete + 9.5 min and the
 *     token's expiresAt - 60 s, the next boundary starts a new session for the rest of the segment:
 *     a re-mint, and the server's history with the host's snapshot. A 1011 close after 595 s is the
 *     connection limit (go_away), not an error, and so is the close that follows a goAway.
 *   - The usage report (5.2) describes the whole segment so far: sent at each fallback, when the page
 *     hides and at the end; never for a segment that had no session.
 *   - While the microphone is open the audio session is play-and-record (rule 3), and playback after.
 *   - D-036 item 1 and D-038 item 3: only the coach speaks; no screen plays a recorded line (the
 *     hold on recordings that this session kept while on went with them).
 *   - D-036 item 2: next_step presses the host's screen buttons (host.actions); the answer guard takes
 *     it only when the person spoke while that very screen showed.
 *   - D-037 item 1: the coach says the hosts' say lines out loud (bridge rule 9); a tool call or the
 *     person's words make them wait for the coach's reply, and once the session is first live the
 *     step on the screen is said (CoachHost.explain), since its own line went out before.
 * Every event a host pushes is stamped with this session's clock, so the answer guard (S0-2) and the
 * event lines never depend on the host's clock.
 */
import { closeEndReason, rotateAt, SLOW_SETUP_MS, type CoachEndReason } from "../../coach/events";
import { coachFailure, type CoachFailure } from "../../coach/failure";
import { AnswerGuard } from "../../coach/tools";
import type {
  BridgeEvent,
  CoachMode,
  CoachOptions,
  CoachSay,
  LiveTransport,
  TransportEvent,
} from "../../coach/types";
import type { TokenRequest, TokenResponse, UsageReport } from "../../../server/modules/agent/types";
import type { SilenceMs } from "../../../server/modules/agent/token";
import { EventBridge } from "./bridge";
import { CaptionFilter, type Caption } from "./captions";
import { ToolExecutor } from "./executor";

/** A refused or failed POST /api/agent/token. */
export type MintResult =
  | { ok: true; token: TokenResponse; serverDate: number | null }
  | { ok: false; status: number; error: string };

export interface MicLike {
  start(onChunk: (pcm16k: ArrayBuffer) => void): Promise<void>;
  stop(): void;
  gate(open: boolean): void;
}
export interface SpeakerLike {
  play(pcm24k: ArrayBuffer): void;
  flush(): void;
  duck(on: boolean): void;
  readonly playing: boolean;
  /** False while its context cannot sound (iOS starts one only from a tap); absent means it can. */
  readonly audible?: boolean;
  onIdle(fn: () => void): () => void;
  close(): void;
}

/** What a coach segment needs from the page (useCoach gives the browser's; the tests give fakes). */
export interface CoachDeps {
  /** The session's clock in ms (performance.now). */
  now(): number;
  /** The wall clock in ms (Date.now), for the token's times when the server sent no Date. */
  wallNow(): number;
  online(): boolean;
  /** POST /api/agent/token; never throws. */
  mint(req: TokenRequest): Promise<MintResult>;
  /** POST /api/agent/usage with keepalive. */
  report(r: UsageReport): void;
  /** A new transport for each connection. */
  transport(): LiveTransport;
  /** The microphone, or null when the coach runs without one (the e2e fake coach). */
  mic(): MicLike | null;
  speaker(): SpeakerLike;
  deviceId(): string;
  /** The person's pause length (5.1); the server's default when absent. */
  silenceMs?: SilenceMs;
  /** The page's offline, online and hide events; returns the way to stop listening. */
  listen?(h: { offline(): void; online(): void; hidden(): void }): () => void;
  /** Rule 3: play-and-record while the microphone is open (asked before it), playback after. */
  audioSession?(live: boolean): void;
  /** Called as a connection starts, before the token is asked (useCoach: preload the SDK chunk). */
  prepare?(): void;
  /** Section 9 timings for the perf overlay (User Timing measures named azm:*, DG-1), on the clock of now. */
  measure?(name: CoachMeasure, start: number, duration: number): void;
  /** The bridge's tick (default 100 ms). */
  tickMs?: number;
  /**
   * D-034 item 3: why the coach is not live is never silent: a refused token, a failed connection, a
   * refused microphone and each fallback are written here (the page's console). Never the token or
   * any key: the status, the server's error code and the reason only.
   */
  log?(message: string, data?: Record<string, unknown>): void;
}

/**
 * The section 9 timings a segment measures (D-026 item 8: the first audio comes from the perf overlay,
 * not the usage report's columns): the token request's round trip, the connect call to setupComplete,
 * and each question's send to the coach's first audible chunk.
 */
export type CoachMeasure = "azm:coach_mint" | "azm:coach_connect" | "azm:coach_first_audio";

/** What useCoach shows (2.11 CoachState without its functions). */
export interface CoachSnapshot {
  mode: CoachMode;
  speaking: boolean;
  captions: Caption[];
}

export const TICK_MS = 100;
/** A close this close to the token's expiresAt (on this phone's estimate of it) is the token's end. */
export const EXPIRY_CLOSE_SLACK_MS = 2000;
/** A token refusal that does not pass with time: the segment stays local (5.1 order of checks). */
const FINAL_STATUS = new Set([400, 401, 403, 404, 409, 503]);
const END_REASONS: readonly CoachEndReason[] = [
  "done",
  "user_end",
  "fallback_error",
  "fallback_slow",
  "go_away",
  "offline",
  "budget",
];
/** 5.2 and the route's bounds (server/modules/agent/validate.ts USAGE_LIMITS). */
const LIMITS = {
  durationSec: 3600,
  turns: 500,
  connectMs: 600_000,
  toolCalls: 500,
  tokens: 10_000_000,
  firstAudioMs: 60_000,
};

const clampInt = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
/** The nearest rank percentile of a list of times. */
function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
const sameCaptions = (a: Caption[], b: Caption[]) =>
  a.length === b.length && a.every((c, i) => c.who === b[i].who && c.text === b[i].text);

export class CoachSession {
  private snap: CoachSnapshot = { mode: "connecting", speaking: false, captions: [] };
  private readonly listeners = new Set<() => void>();
  private readonly bridge: EventBridge;
  private readonly guard: AnswerGuard;
  private readonly executor: ToolExecutor;
  private readonly captions: CaptionFilter;
  private readonly speaker: SpeakerLike;
  private readonly offIdle: () => void;
  private mic: MicLike | null = null;
  private transport: LiveTransport | null = null;
  private offTransport: (() => void) | null = null;
  private offWindow: (() => void) | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private setupTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private ended = false;
  private minting = false;
  /** A refusal that does not pass with time: no reconnect for the rest of the segment. */
  private noCoach = false;
  private audioHeld = false;
  private sessionId: string | null = null;
  private connectStart: number | null = null;
  /** setupComplete of the current connection, or null. */
  private liveSince: number | null = null;
  private liveMs = 0;
  private firstConnectMs: number | null = null;
  private turns = 0;
  private promptTokens = 0;
  private responseTokens = 0;
  private usageSeen = false;
  private firstAudio: number[] = [];
  /** Why the coach last stopped being live (a fallback or the page hiding). */
  private lastEnd: CoachEndReason | null = null;
  private rotateDue = false;
  private rotateAtTime = Infinity;
  private expiresAt = Infinity;
  /** The last failure of the segment (D-035 item 3), sent in every report after it. */
  private failure: CoachFailure | null = null;
  /** The step on the screen was handed to the coach once the session went live (D-037 item 1). */
  private explained = false;

  constructor(
    private readonly opts: CoachOptions,
    private readonly deps: CoachDeps,
  ) {
    // D-036 item 2: a press needs the person's speech while the host's screen now was showing.
    this.guard = new AnswerGuard(() => opts.host.actions?.current ?? null);
    this.captions = new CaptionFilter(opts.lang);
    this.speaker = deps.speaker();
    this.bridge = new EventBridge(
      {
        sendContext: (text, turnComplete) => this.transport?.sendContext(text, turnComplete),
        audioStreamEnd: () => this.transport?.audioStreamEnd(),
      },
      opts.local,
      {},
      {
        now: deps.now,
        flushCoach: () => this.speaker.flush(),
        micGate: (open) => this.mic?.gate(open),
        duck: (on) => this.speaker.duck(on),
        onFallback: (reason) =>
          this.fallback(reason, {
            stage: "playback",
            name: "NoCoachAudio",
            message:
              this.speaker.audible === false
                ? "the audio context is not running"
                : "two questions without coach audio",
          }),
        onFirstAudio: (ms) => {
          this.firstAudio.push(ms);
          this.deps.measure?.("azm:coach_first_audio", this.deps.now() - ms, ms);
        },
      },
    );
    this.bridge.setMode("connecting");
    this.executor = new ToolExecutor(
      opts.block,
      () => this.opts.host,
      (r) => this.transport?.sendToolResponse(r),
      (e) => this.bridge.push(e, this.deps.now()),
      this.guard,
    );
    this.offIdle = this.speaker.onIdle(() => {
      this.bridge.coachSpeaking(false, this.deps.now());
      this.update();
    });
  }

  /* ------------------------------------------------------- the API */

  readonly getSnapshot = (): CoachSnapshot => this.snap;

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** The prewarm (rule 8): mints and connects now. */
  start(): void {
    if (this.started || this.ended) return;
    this.started = true;
    this.offWindow =
      this.deps.listen?.({
        offline: () => this.fallback("offline"),
        online: () => undefined,
        hidden: () => this.hidden(),
      }) ?? null;
    this.tickTimer = setInterval(() => this.bridge.tick(this.deps.now()), this.deps.tickMs ?? TICK_MS);
    if (!this.deps.online()) return this.fallback("offline");
    void this.connect(false);
  }

  /** A host's event, stamped with this session's clock. */
  readonly push = (e: BridgeEvent): void => {
    if (this.ended) return;
    const now = this.deps.now();
    const ev = { ...e, t: now } as BridgeEvent;
    if (ev.p === 1) this.guard.question(ev);
    if (this.isBoundary(ev)) this.atBoundary(now);
    this.bridge.push(ev, now);
  };

  /** After a P0 the app (never the model) opens the bridge again (2.11 rule 1). */
  readonly reopen = (): void => {
    if (!this.ended) this.bridge.reopen(this.deps.now());
  };

  /** The end of the segment: everything stops, the usage report goes. */
  readonly end = (reason: string): void => {
    if (this.ended) return;
    const given = (END_REASONS as readonly string[]).includes(reason) ? (reason as CoachEndReason) : "done";
    const endReason = this.snap.mode === "local" && this.lastEnd ? this.lastEnd : given;
    this.detach();
    this.stopMic();
    this.releaseAudio();
    this.bridge.setMode("off");
    this.ended = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.offWindow?.();
    this.offIdle();
    this.speaker.close();
    this.bridge.dispose();
    this.sendReport(endReason);
    this.snap = { mode: "off", speaking: false, captions: this.snap.captions };
    this.notify();
  };

  /** The page left the segment (unmounted): it ends as the person's. */
  dispose(): void {
    this.end("user_end");
  }

  /** The transport of the current connection, or null (the e2e page plays the fake coach through it). */
  get current(): LiveTransport | null {
    return this.transport;
  }

  /* ------------------------------------------------ the connection */

  private async connect(again: boolean): Promise<void> {
    if (this.minting || this.ended || this.noCoach || this.transport) return;
    this.minting = true;
    this.setMode("connecting");
    this.deps.prepare?.();
    this.startMic();
    let minted: { token: TokenResponse; newSessionAt: number } | null = null;
    try {
      minted = await this.mintToken();
      // Rule 8: the window to open the session passed before the connect: one re-mint.
      if (minted && this.deps.now() >= minted.newSessionAt) minted = await this.mintToken();
    } finally {
      this.minting = false;
    }
    if (!minted || this.ended) return;
    if (this.snap.mode !== "connecting") {
      // A fallback came while the token was on its way: the segment's report says so.
      this.sendReport(this.lastEnd ?? "fallback_error");
      return;
    }
    const t = this.deps.transport();
    this.attach(t);
    this.connectStart = this.deps.now();
    this.setupTimer = setTimeout(() => this.slow(t), SLOW_SETUP_MS);
    const history = again ? this.withSnapshot(minted.token.history) : minted.token.history;
    t.connect({
      token: minted.token.token,
      model: minted.token.model,
      apiVersion: minted.token.apiVersion,
      history,
    }).catch((e: unknown) => {
      const failure = coachFailure("socket", e);
      this.deps.log?.("connection failed", { ...failure });
      if (this.transport === t) this.fallback("fallback_error", failure);
    });
  }

  /**
   * No setupComplete 3 s after the connect (D-035 item 3): the local voice speaks from now on, and the
   * connection goes on; its setupComplete hands over to the coach, its failure ends it.
   */
  private slow(t: LiveTransport): void {
    this.setupTimer = null;
    if (this.ended || this.transport !== t || this.liveSince !== null || this.snap.mode !== "connecting")
      return;
    this.deps.log?.("slow to connect: the local voice speaks meanwhile", { segment: this.opts.segment });
    this.lastEnd = "fallback_slow";
    this.setMode("local");
    this.sendReport("fallback_slow");
  }

  private async mintToken(): Promise<{ token: TokenResponse; newSessionAt: number } | null> {
    const req: TokenRequest = {
      block: this.opts.block,
      segment: this.opts.segment,
      lang: this.opts.lang,
      ref: this.opts.ref,
      deviceId: this.deps.deviceId(),
      ...(this.deps.silenceMs ? { silenceMs: this.deps.silenceMs } : {}),
    };
    let res: MintResult;
    const asked = this.deps.now();
    try {
      res = await this.deps.mint(req);
    } catch {
      res = { ok: false, status: 0, error: "NETWORK" };
    }
    if (this.ended) return null;
    if (res.ok) this.deps.measure?.("azm:coach_mint", asked, this.deps.now() - asked);
    if (!res.ok) {
      this.deps.log?.("token refused", { status: res.status, error: res.error, segment: this.opts.segment });
      if (res.error === "BUDGET" || FINAL_STATUS.has(res.status)) this.noCoach = true;
      if (this.snap.mode === "connecting")
        this.fallback(
          res.error === "BUDGET"
            ? "budget"
            : res.status === 0 && !this.deps.online()
              ? "offline"
              : "fallback_error",
          coachFailure("token", { name: res.status ? `HTTP_${res.status}` : "NETWORK", message: res.error }),
        );
      return null;
    }
    this.sessionId = res.token.sessionId;
    // The token's times are the server's: read relative to its Date, on this session's clock.
    const now = this.deps.now();
    const wall = res.serverDate ?? this.deps.wallNow();
    const at = (iso: string) => {
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? now + (ms - wall) : Infinity;
    };
    this.expiresAt = at(res.token.expiresAt);
    return { token: res.token, newSessionAt: at(res.token.newSessionExpiresAt) };
  }

  /** The host's state line, one clean line of at most 200 characters ("" without one). */
  private hostState(): string {
    try {
      return this.opts.host
        .snapshot()
        .replace(/[[\]\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
    } catch {
      return "";
    }
  }

  /** The server's history with the host's state line, for a new session in the segment (rule 7). */
  private withSnapshot(history: TokenResponse["history"]): TokenResponse["history"] {
    const state = this.hostState();
    const i = history.findIndex((h) => h.role === "user");
    if (!state || i < 0) return history;
    return history.map((h, k) => (k === i ? { ...h, text: `${h.text}\n[CTX now ${state}]` } : h));
  }

  private attach(t: LiveTransport): void {
    this.transport = t;
    this.liveSince = null;
    this.offTransport = t.on((e) => this.onEvent(t, e));
  }

  /** Closes the current connection and adds its live time. */
  private detach(): void {
    const t = this.transport;
    if (this.setupTimer) clearTimeout(this.setupTimer);
    this.setupTimer = null;
    if (!t) return;
    this.offTransport?.();
    this.offTransport = null;
    this.transport = null;
    if (this.liveSince !== null) this.liveMs += this.deps.now() - this.liveSince;
    this.liveSince = null;
    this.executor.newConnection();
    try {
      t.close();
    } catch {
      /* already closed */
    }
  }

  private onEvent(t: LiveTransport, e: TransportEvent): void {
    if (t !== this.transport || this.ended) return;
    const now = this.deps.now();
    switch (e.type) {
      case "setupComplete":
        return this.onSetup(now);
      case "audio":
        this.speaker.play(e.pcm24k);
        this.captions.audio(e.pcm24k.byteLength);
        // Audio nobody can hear never counts as the coach asking (rule 2 then asks with the local voice).
        if (this.speaker.audible !== false) this.bridge.coachSpeaking(true, now);
        return this.update();
      case "outputTranscript":
        this.captions.coachText(e.text);
        return this.update();
      case "inputTranscript":
        this.guard.heard(e.text, now);
        // D-037 item 1 (bridge rule 9): the coach answers the person first; a say line waits.
        if (e.text.trim()) this.bridge.awaitReply(now);
        this.captions.personText(e.text, e.final);
        return this.update();
      case "interrupted":
        this.speaker.flush();
        this.captions.interrupted();
        return this.update();
      case "turnComplete":
        this.turns++;
        this.captions.turnComplete();
        return this.update();
      case "toolCall":
        // Bridge rule 9: a say line the call brings (a press opens the next step) waits for the
        // coach's reply to the tool result.
        this.bridge.awaitReply(now);
        return this.executor.handle(e.calls, now);
      case "toolCallCancellation":
        return this.executor.cancel(e.ids, now);
      case "goAway":
        this.rotateDue = true;
        return;
      case "usage":
        this.usageSeen = true;
        this.promptTokens += e.promptTokens;
        this.responseTokens += e.responseTokens;
        return;
      case "error":
        this.deps.log?.("connection error", { code: e.code });
        return this.fallback(
          "fallback_error",
          coachFailure(this.liveSince === null ? "socket" : "live", { name: e.code, message: e.code }),
        );
      case "close": {
        this.deps.log?.("connection closed", { code: e.code, reason: e.reason });
        // S0-3: the connection limit, the token's own end (1011 "auth token has expired") or the end
        // a goAway announced is not an error.
        const reason =
          this.rotateDue || now >= this.expiresAt - EXPIRY_CLOSE_SLACK_MS
            ? "go_away"
            : closeEndReason(e.code, this.liveSince === null ? 0 : now - this.liveSince);
        return this.fallback(
          reason,
          reason === "fallback_error"
            ? coachFailure(this.liveSince === null ? "socket" : "live", {
                name: `closed_${e.code}`,
                message: `closed_${e.code}${e.reason ? `: ${e.reason}` : ""}`,
              })
            : undefined,
        );
      }
    }
  }

  private onSetup(now: number): void {
    if (this.setupTimer) clearTimeout(this.setupTimer);
    this.setupTimer = null;
    if (this.liveSince !== null) return;
    this.liveSince = now;
    this.firstConnectMs ??= now - (this.connectStart ?? now);
    if (this.connectStart !== null)
      this.deps.measure?.("azm:coach_connect", this.connectStart, now - this.connectStart);
    this.rotateDue = false;
    this.rotateAtTime = rotateAt(now, this.expiresAt);
    this.holdAudio();
    // A slow connection that completed in the background: the coach takes over from the local voice,
    // told silently where the person is now.
    const late = this.snap.mode === "local";
    this.lastEnd = null;
    this.setMode("live");
    const state = late ? this.hostState() : "";
    if (state) this.transport?.sendContext(`[CTX now ${state}]`, false);
    // D-037 item 1: the step on the screen is said once the coach can speak: its say line went out
    // before this session heard anything (a new segment, a slow connection that went local).
    if (!this.explained || late) this.explainNow(now);
  }

  /**
   * The host's say line of the step showing now (CoachHost.explain), to the bridge, unless the bridge
   * already has the step's own line (it waited while the session connected). Never throws.
   */
  private explainNow(now: number): void {
    this.explained = true;
    if (this.bridge.stepLineKnown) return;
    let say: CoachSay | null = null;
    try {
      say = this.opts.host.explain?.() ?? null;
    } catch {
      say = null;
    }
    if (say) this.bridge.push({ ...say, t: now }, now);
  }

  /**
   * Rule 6: the segment goes on with the local voice. Also ends a slow connection still going in the
   * background (mode local with a transport). `failure` says why (D-035 item 3).
   */
  private fallback(reason: CoachEndReason, failure?: CoachFailure): void {
    const mode = this.snap.mode;
    if (this.ended || (mode !== "live" && mode !== "connecting" && !(mode === "local" && this.transport)))
      return;
    if (failure) this.failure = failure;
    this.deps.log?.("local voice", { reason, segment: this.opts.segment, ...(failure ? { failure } : {}) });
    this.detach();
    this.stopMic();
    this.speaker.flush();
    this.releaseAudio();
    this.rotateDue = false;
    this.rotateAtTime = Infinity;
    this.lastEnd = reason;
    this.setMode("local");
    this.sendReport(reason);
  }

  /** The page hid (a lock, another app): the coach stops listening and the report goes. */
  private hidden(): void {
    if (this.ended) return;
    if (this.snap.mode === "local" && !this.transport) this.sendReport(this.lastEnd ?? "user_end");
    else this.fallback("user_end");
  }

  private isBoundary(e: BridgeEvent): boolean {
    switch (this.opts.block) {
      case "rom":
        return e.type === "movement_result";
      case "gait":
        return e.type === "pass_done";
      case "session":
        return e.type === "step_start";
    }
  }

  /** Rules 6 and 7: a new session starts only at a boundary, never mid item. */
  private atBoundary(now: number): void {
    if (this.minting || this.ended || this.noCoach) return;
    const mode = this.snap.mode;
    if (mode === "live" && (this.rotateDue || now >= this.rotateAtTime)) {
      this.detach();
      void this.connect(true);
    } else if (mode === "local" && this.deps.online() && this.lastEnd !== "budget") {
      void this.connect(true);
    }
  }

  /* ------------------------------------------------------- audio */

  private startMic(): void {
    if (this.mic) return;
    const mic = this.deps.mic();
    if (!mic) return;
    this.mic = mic;
    // Before the microphone is asked: iOS cannot start a capture in a playback session (D-035 item 3).
    this.holdAudio();
    mic.gate(this.bridge.micOpen);
    mic
      .start((pcm) => {
        if (this.snap.mode === "live" && this.bridge.micOpen && this.mic === mic)
          this.transport?.sendAudio(pcm);
      })
      .catch((e: unknown) => {
        if (this.mic !== mic) return;
        const failure = coachFailure("mic", e);
        this.deps.log?.("microphone refused", { ...failure });
        this.mic = null;
        // A refused microphone is not asked again in this segment.
        this.noCoach = true;
        this.failure = failure;
        this.fallback("fallback_error", failure);
        // Already local: the session the microphone held is released all the same.
        this.releaseAudio();
      });
  }

  private holdAudio(): void {
    if (this.audioHeld) return;
    this.audioHeld = true;
    this.deps.audioSession?.(true);
  }

  private stopMic(): void {
    const mic = this.mic;
    this.mic = null;
    mic?.stop();
  }

  private releaseAudio(): void {
    if (!this.audioHeld) return;
    this.audioHeld = false;
    this.deps.audioSession?.(false);
  }

  /* ------------------------------------------------------ the state */

  private setMode(mode: CoachMode): void {
    if (this.snap.mode === mode) return;
    this.bridge.setMode(mode);
    this.snap = { ...this.snap, mode };
    this.notify();
  }

  private update(): void {
    const speaking = this.speaker.playing;
    const captions = this.captions.list();
    if (speaking === this.snap.speaking && sameCaptions(captions, this.snap.captions)) return;
    this.snap = { ...this.snap, speaking, captions };
    this.notify();
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }

  /** 5.2: the whole segment so far; a later report replaces it on the server. */
  private sendReport(endReason: CoachEndReason): void {
    if (!this.sessionId) return;
    const live = this.liveMs + (this.liveSince !== null ? this.deps.now() - this.liveSince : 0);
    const toolCalls: UsageReport["toolCalls"] = {};
    for (const [name, c] of Object.entries(this.executor.stats()))
      toolCalls[name as keyof UsageReport["toolCalls"]] = {
        ok: clampInt(c.ok, LIMITS.toolCalls),
        rejected: clampInt(c.rejected, LIMITS.toolCalls),
      };
    const audio = this.firstAudio.map((ms) => Math.min(LIMITS.firstAudioMs, Math.max(0, ms)));
    this.deps.report({
      sessionId: this.sessionId,
      connectMs: this.firstConnectMs === null ? null : clampInt(this.firstConnectMs, LIMITS.connectMs),
      durationSec: Math.min(LIMITS.durationSec, Math.max(0, Math.round(live / 1000))),
      turns: clampInt(this.turns, LIMITS.turns),
      toolCalls,
      promptTokens: this.usageSeen ? clampInt(this.promptTokens, LIMITS.tokens) : null,
      responseTokens: this.usageSeen ? clampInt(this.responseTokens, LIMITS.tokens) : null,
      firstAudioMs: audio.length ? { p50: percentile(audio, 50), p90: percentile(audio, 90) } : null,
      endReason,
      failure: this.failure,
    });
  }
}
