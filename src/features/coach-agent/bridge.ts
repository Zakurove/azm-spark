/**
 * The event bridge (product v7 contract 2.11 EventBridge, stream D, step D4): what the coach hears of
 * the app, and when. Hosts push their events (BridgeEvent); the bridge applies rules 1 to 5:
 *
 *   1. P0 (a safety stop, a red flag): the coach's voice is flushed at once, then the event goes with
 *      turnComplete true. After a P0 only P0 passes until the app (never the model) calls reopen().
 *      The local stop line plays only once the segment fell back to local (D-036 item 1: while the
 *      coach is on, only the coach speaks), and not over the host's own safety line.
 *   2. P1 (the range questions): sent with turnComplete true when the question opens; its buttons are
 *      on the screen in every mode. While the coach is on nothing else asks it (D-036 item 1): a
 *      question the coach has not started to voice within localFallbackMs (1.5 s) only counts toward
 *      rule 6. In local mode the local voice asks at once (the v7 checks have none: their screens ask).
 *   3. P2 (corrections): the host has its own caption for them; the coach gets them silently at once.
 *      While any local line plays the mic gate is closed with audioStreamEnd and the coach's voice
 *      ducks; the gate opens 300 ms after the line ends.
 *   4. P3 (context): coalesced and sent silently every 5 s; a rep count keeps only its latest line.
 *   5. At most one turnComplete true per 2 s; P0 is exempt, and the context waiting goes before a
 *      question, so the question is the last line the coach reads.
 * And from rule 6: two questions in a row that the coach did not voice in time report fallback_slow;
 * the session then falls back to local (rules 6 to 8 live in session.ts).
 *
 * Who speaks what. Only the coach while it is on (D-036 item 1). The host owns its screen and its
 * local lines; a workout says its corrections (P2) and its safety line (P0) through the LocalVoice it
 * gave useCoach (its recorded voice, which never plays while a Live coach session is on), so the mic
 * gate sees every local line. While the coach is on (mode is not off) the host never asks a P1
 * question aloud itself. Pure, no DOM: the session wires the transport, the speaker, the microphone
 * and the clock.
 */
import { BRIDGE_DEFAULTS, MIC_REOPEN_MS, P1_WITHOUT_AUDIO_LIMIT, formatEvent } from "../../coach/events";
import type { BridgeEvent, BridgeOptions, CoachMode, LiveTransport, LocalVoice } from "../../coach/types";

type P1Event = Extract<BridgeEvent, { p: 1 }>;

/** The local line of each question (the range data's copy, voice-script.json), for local mode. */
export const LOCAL_ASK: Record<P1Event["type"], string> = {
  end_range_hold: "rom_ask_max",
  ask_pain: "rom_pain_ask",
  ask_cause: "rom_what_stopped_ask",
  ask_can_move: "rom_can_move_ask",
};
/** The local line of a P0 when the host's own safety line is not playing: «توقف فورًا واسترح.» */
export const P0_LINE = "stop_rest";

export interface BridgeHooks {
  /** The clock of push, tick and the local voice's line ends (ms, the clock of BridgeEvent.t). */
  now?: () => number;
  /** Rule 1: ends the coach's voice at once (Speaker.flush). */
  flushCoach?: () => void;
  /** Rule 3: the microphone gate (MicCapture.gate). */
  micGate?: (open: boolean) => void;
  /** Rule 3: the coach's voice at 30% while a local line plays (Speaker.duck). */
  duck?: (on: boolean) => void;
  /** Rule 6: too many questions without coach audio; the session falls back to local. */
  onFallback?: (reason: "fallback_slow") => void;
  /** Section 9 and 5.2: from a question's send to the coach's first audio, in ms. */
  onFirstAudio?: (ms: number) => void;
}

interface Question {
  e: P1Event;
  /** When the question opened. */
  at: number;
  /** When it was sent to the coach, or null. */
  sentAt: number | null;
  /** The local voice asked it (local mode). */
  asked: boolean;
  /** The coach started to speak after it was sent. */
  voiced: boolean;
  /** The coach had not voiced it within localFallbackMs (counted once toward rule 6). */
  late: boolean;
  /** The coach was still speaking when it was sent: its audio counts once that old turn has stopped. */
  afterIdle: boolean;
}

export class EventBridge {
  private readonly opts: BridgeOptions;
  private readonly clock: () => number;
  private readonly t0: number;
  private current: CoachMode = "off";
  private stopped = false;
  private lastTrigger = -Infinity;
  private lastFlush: number;
  /** Lines waiting for the next silent send, in order. */
  private context: string[] = [];
  /** The index in `context` of the latest rep count line of each exercise. */
  private repLine = new Map<string, number>();
  private question: Question | null = null;
  /** Questions in a row the coach did not voice in time (rule 6). */
  private missed = 0;
  private localPlaying = false;
  /** The coach's voice is playing (the last coachSpeaking). */
  private speaking = false;
  private micIsOpen = true;
  private reopenAt: number | null = null;
  private readonly offPlaying: () => void;

  constructor(
    private readonly transport: Pick<LiveTransport, "sendContext"> &
      Partial<Pick<LiveTransport, "audioStreamEnd">>,
    private readonly local: LocalVoice,
    opts: Partial<BridgeOptions> = {},
    private readonly hooks: BridgeHooks = {},
  ) {
    this.opts = { ...BRIDGE_DEFAULTS, ...opts };
    this.clock = hooks.now ?? (() => performance.now());
    this.t0 = this.clock();
    this.lastFlush = this.t0;
    this.offPlaying = local.onPlaying((playing) => this.localChanged(playing));
  }

  get mode(): CoachMode {
    return this.current;
  }

  /** False while a local line plays and for 300 ms after it (rule 3). */
  get micOpen(): boolean {
    return this.micIsOpen;
  }

  push(e: BridgeEvent, now: number): void {
    if (this.current === "off") return;
    if (e.p === 0) return this.p0(e, now);
    if (this.stopped) return;
    if (e.p === 1) return this.p1(e, now);
    if (e.p === 2) {
      if (this.current === "live") this.transport.sendContext(this.line(e), false);
      else if (this.current === "connecting") this.context.push(this.line(e));
      return;
    }
    this.p3(e);
  }

  tick(now: number): void {
    if (this.current === "off") return;
    if (this.reopenAt !== null && now >= this.reopenAt && !this.localPlaying) {
      this.reopenAt = null;
      this.micIsOpen = true;
      this.hooks.micGate?.(true);
    }
    const q = this.question;
    if (q && !q.asked && !q.voiced) {
      // In local mode a question that waited for a line to end is asked as soon as it can be.
      if (this.current === "local") this.askLocally(q, now);
      else if (this.current === "live") {
        if (q.sentAt === null) this.trySend(q, now);
        else if (!q.late && now - q.at >= this.opts.localFallbackMs) this.missedBy(q);
      }
    }
    if (this.current === "live" && this.context.length && now - this.lastFlush >= this.opts.contextFlushMs)
      this.flush(now);
  }

  /** The coach's voice: true for every chunk the session plays, false when it went idle. */
  coachSpeaking(speaking: boolean, now: number): void {
    this.speaking = speaking;
    const q = this.question;
    if (!q || q.sentAt === null || q.voiced || q.asked) return;
    // Chunks of the sentence the question cut are not the coach asking it.
    if (!speaking) q.afterIdle = false;
    if (!speaking || q.afterIdle) return;
    q.voiced = true;
    this.missed = 0;
    this.hooks.onFirstAudio?.(now - q.sentAt);
  }

  /** After a P0 only P0 passes, until the app (never the model) calls reopen(). */
  reopen(_now: number): void {
    this.stopped = false;
  }

  setMode(mode: CoachMode): void {
    const prev = this.current;
    this.current = mode;
    const now = this.clock();
    if (mode === "off") {
      this.context = [];
      this.repLine.clear();
      this.question = null;
      return;
    }
    if (mode === "local") {
      this.context = [];
      this.repLine.clear();
      const q = this.question;
      if (q && !q.asked && !q.voiced) this.askLocally(q, now);
      return;
    }
    if (mode === "live" && prev !== "live") {
      this.missed = 0;
      this.flush(now);
      // An open question the coach has not voiced is its to ask now (a local voice, if any, said it
      // while the coach was away; the v7 checks have none).
      const q = this.question;
      if (q && !q.voiced && q.sentAt === null) this.trySend(q, now);
    }
  }

  /** Stops listening to the local voice (the end of the segment). */
  dispose(): void {
    this.offPlaying();
    this.question = null;
    this.context = [];
  }

  /* ------------------------------------------------------------ rules */

  private p0(e: BridgeEvent, now: number): void {
    this.stopped = true;
    this.question = null;
    this.hooks.flushCoach?.();
    // Only in local mode (D-036 item 1: while the coach is on, the coach says it). The host's own
    // safety line stands for the stop line; a correction or a question playing does not (a safety line
    // preempts it in CuePlayer), so a user_stop over a correction is still said.
    if (this.current === "local" && !(this.local.playingSafety ?? this.local.playing))
      this.local.say(P0_LINE, "safety");
    if (this.current === "live") {
      this.flush(now);
      this.transport.sendContext(this.line(e), true);
      this.lastTrigger = now;
    } else if (this.current === "connecting") this.context.push(this.line(e));
  }

  private p1(e: P1Event, now: number): void {
    const q: Question = {
      e,
      at: now,
      sentAt: null,
      asked: false,
      voiced: false,
      late: false,
      afterIdle: false,
    };
    this.question = q;
    if (this.current === "local") this.askLocally(q, now);
    else if (this.current === "live") this.trySend(q, now);
  }

  private p3(e: BridgeEvent): void {
    if (this.current === "local") return;
    const text = this.line(e);
    if (e.type === "reps") {
      const i = this.repLine.get(e.exercise);
      if (i !== undefined) {
        this.context[i] = text;
        return;
      }
      this.repLine.set(e.exercise, this.context.length);
    }
    this.context.push(text);
  }

  /** Rule 5: a question waits until 2 s after the last turn the app started; the context goes first. */
  private trySend(q: Question, now: number): void {
    if (now - this.lastTrigger < this.opts.minGapMs) return;
    this.flush(now);
    this.transport.sendContext(this.line(q.e), true);
    q.sentAt = now;
    q.afterIdle = this.speaking;
    this.lastTrigger = now;
  }

  /**
   * Rule 2 in local mode: the local voice asks. While a local line plays (a correction at the same
   * rank would make CuePlayer refuse the question) and for 300 ms after it, the question waits; a
   * later tick asks it.
   */
  private askLocally(q: Question, now: number): void {
    if (this.localPlaying || this.local.playing || (this.reopenAt !== null && now < this.reopenAt)) return;
    q.asked = true;
    this.local.say(LOCAL_ASK[q.e.type], "warn");
  }

  /**
   * Rule 6: the coach was sent the question and has not voiced it in time. Nothing else asks it while
   * the coach is on (D-036 item 1); its late audio still plays, and two such questions in a row fall
   * back to local.
   */
  private missedBy(q: Question): void {
    q.late = true;
    if (++this.missed >= P1_WITHOUT_AUDIO_LIMIT) {
      this.missed = 0;
      this.hooks.onFallback?.("fallback_slow");
    }
  }

  private flush(now: number): void {
    this.lastFlush = now;
    if (!this.context.length) return;
    if (this.current === "live") this.transport.sendContext(this.context.join("\n"), false);
    this.context = [];
    this.repLine.clear();
  }

  /** Rule 3: the mic gate and the duck follow the local voice. */
  private localChanged(playing: boolean): void {
    if (this.current === "off") return;
    this.localPlaying = playing;
    if (playing) {
      this.reopenAt = null;
      if (this.micIsOpen) {
        this.micIsOpen = false;
        this.hooks.micGate?.(false);
        if (this.current === "live") this.transport.audioStreamEnd?.();
      }
      this.hooks.duck?.(true);
    } else {
      this.reopenAt = this.clock() + MIC_REOPEN_MS;
      this.hooks.duck?.(false);
    }
  }

  private line(e: BridgeEvent): string {
    return formatEvent(e, this.t0);
  }
}
