/**
 * Speaker (product v7 contract 2.11, stream D, step D3): the coach's voice, 24 kHz 16 bit mono chunks
 * played through the vendored AudioStreamer (100 ms jitter buffer, section 9) in the coach's
 * AudioContext. flush() ends the voice at once (the person cut in, or a safety stop, rule 1); duck()
 * lowers it to 30% while a local line plays (rule 3); onIdle() tells when the last chunk has played or
 * was flushed (the bridge's coachSpeaking(false)).
 */
import { DUCK_VOLUME } from "../../../coach/events";
import { AudioStreamer } from "./audio-streamer";
import { coachAudioContext } from "./context";

/** The part of AudioStreamer the speaker uses (tests give a fake context instead). */
export type StreamerFactory = (ctx: AudioContext) => AudioStreamer;

export class Speaker {
  private streamer: AudioStreamer | null = null;
  private listeners = new Set<() => void>();
  private ducked = false;
  private closed = false;

  constructor(
    private readonly context: () => AudioContext = coachAudioContext,
    private readonly make: StreamerFactory = (ctx) => new AudioStreamer(ctx),
  ) {}

  /** True while coach audio is queued or playing. */
  get playing(): boolean {
    return this.streamer?.playing ?? false;
  }

  /** Plays one chunk of the coach's voice after the ones before it. */
  play(pcm24k: ArrayBuffer): void {
    if (this.closed || pcm24k.byteLength < 2) return;
    const s = this.get();
    if (!s) return;
    if (s.context.state === "suspended") void s.context.resume().catch(() => undefined);
    s.addPCM16(new Uint8Array(pcm24k));
  }

  /** Ends the coach's voice now; the next chunk plays at once. */
  flush(): void {
    this.streamer?.stop();
  }

  /** 30% while a local line plays (rule 3), full volume after. */
  duck(on: boolean): void {
    this.ducked = on;
    this.streamer?.setVolume(on ? DUCK_VOLUME : 1);
  }

  /** Called when the last chunk has played or was flushed. */
  onIdle(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The end of the segment. */
  close(): void {
    this.closed = true;
    this.streamer?.close();
    this.streamer = null;
    this.listeners.clear();
  }

  private get(): AudioStreamer | null {
    if (this.streamer) return this.streamer;
    try {
      const s = this.make(this.context());
      s.onComplete = () => {
        for (const fn of [...this.listeners]) fn();
      };
      s.setVolume(this.ducked ? DUCK_VOLUME : 1);
      this.streamer = s;
      return s;
    } catch {
      return null;
    }
  }
}
