/**
 * The local voice of a coached segment (product v7 contract 2.11 LocalVoice, C-5, bridge rules 1 to 3,
 * stream D, step D4): the recorded voice pack through CuePlayer, the same lines the app says without a
 * coach. The bridge uses it for P0 and for a question the coach did not ask in time; the host says its
 * own corrections and safety lines through it, so every local line reaches the mic gate.
 *
 * playing is true from the moment a line is asked for until it ends, was cut or could not start, so the
 * microphone closes before the first sound (rule 3: Gemini must never hear the app's own voice as the
 * person's). A line already playing is not started again. Captions stay the host's (its FeedbackGate).
 */
import { isVoiceLine, type CuePlayer, type VoiceLine } from "../../app/audio";
import type { LocalVoice } from "../../coach/types";
import type { Severity } from "../../engine/types";

/** The part of CuePlayer the local voice uses. */
export type CueLike = Pick<CuePlayer, "line" | "stop">;

export class CueVoice implements LocalVoice {
  private active = new Map<number, VoiceLine>();
  private severities = new Map<number, Severity>();
  private seq = 0;
  private listeners = new Set<(playing: boolean) => void>();

  constructor(private readonly player: CueLike) {}

  get playing(): boolean {
    return this.active.size > 0;
  }

  /** A safety line is playing (rule 1: the bridge's stop line is not said over the host's own). */
  get playingSafety(): boolean {
    return [...this.severities.values()].includes("safety");
  }

  say(line: string, severity: Severity): void {
    if (!isVoiceLine(line) || [...this.active.values()].includes(line)) return;
    const token = ++this.seq;
    this.severities.set(token, severity);
    this.set(token, line);
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      this.unset(token);
    };
    this.player.line(line, severity, end).then((started) => {
      if (!started) end();
    }, end);
  }

  stopAll(): void {
    this.player.stop();
    for (const token of [...this.active.keys()]) this.unset(token);
  }

  onPlaying(fn: (playing: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(token: number, line: VoiceLine): void {
    const was = this.playing;
    this.active.set(token, line);
    if (!was) this.emit(true);
  }

  private unset(token: number): void {
    this.severities.delete(token);
    if (!this.active.delete(token)) return;
    if (!this.playing) this.emit(false);
  }

  private emit(playing: boolean): void {
    for (const fn of [...this.listeners]) fn(playing);
  }
}
