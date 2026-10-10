/**
 * Steps through the lines of a safety screen one after another (UX spec S36, 3.0, 4.3): each line is
 * shown in the caption strip and highlighted for its reading time, and the one hidden announcer reads
 * it (announcementFor: a caption that is not being spoken). No line is spoken: the app uses no phone
 * speech (D-036 item 1), so the captions carry everything. Nothing here waits for the network, and the
 * sequence always finishes.
 */
import { readMs, type SpeechLine } from "./speech";

/** The timers the player needs (fakes in the unit tests). */
export interface TimerDeps {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface PlayOptions {
  /** A line starts (it shows for its reading time). */
  onLine(index: number): void;
  onEnd(): void;
}

const browserTimers: TimerDeps = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

export class SequencePlayer {
  private generation = 0;
  private timer: unknown = null;
  private readonly deps: TimerDeps;

  constructor(deps: TimerDeps = browserTimers) {
    this.deps = deps;
  }

  /** Shows `lines` from the first; a running sequence is stopped first. */
  play(lines: readonly SpeechLine[], opts: PlayOptions): void {
    this.stop();
    this.step(0, lines, opts, this.generation);
  }

  /** Stops the sequence (the screen is left, or Listen again starts it over). */
  stop(): void {
    this.generation++;
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.timer = null;
  }

  private step(i: number, lines: readonly SpeechLine[], opts: PlayOptions, generation: number): void {
    if (generation !== this.generation) return;
    this.timer = null;
    if (i >= lines.length) {
      opts.onEnd();
      return;
    }
    opts.onLine(i);
    this.timer = this.deps.setTimeout(
      () => this.step(i + 1, lines, opts, generation),
      readMs(lines[i].display),
    );
  }
}
