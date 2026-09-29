/**
 * Plays the lines of a safety screen one after another (UX spec S36, 3.0, 4.3): each line is shown in
 * the caption strip and highlighted from its start to its end, and read by a local voice when the
 * Sound is on and the line has speech. A line with no voice (sound off, no local voice, the O12 (4)
 * interim) stays for its reading time, so the caption and the highlight still move through the text
 * and the one hidden announcer reads it (announcementFor: a caption that is not being spoken).
 *
 * Nothing here waits for the network: speech synthesis uses only voices installed on the device
 * (never a remote voice, which would send the text to a speech service), and a voice that never ends
 * a line is cut off by a timer, so the sequence always finishes.
 */
import type { Lang } from "../../../app/i18n";
import { readMs, type SpeechLine } from "./speech";

/** What the player needs from the page (replaced by fakes in the unit tests). */
export interface SpeechDeps {
  /** The voice for the language when already known (null: none), or undefined until the list loads. */
  voiceNow?(lang: Lang): SpeechSynthesisVoice | null | undefined;
  voiceFor(lang: Lang): Promise<SpeechSynthesisVoice | null>;
  speak(text: string, lang: Lang, voice: SpeechSynthesisVoice, done: () => void): void;
  cancel(): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface PlayOptions {
  lang: Lang;
  /** Read at the start of every line: the Sound setting now. */
  soundOn(): boolean;
  /** A line starts; `speaking` is true when a voice reads it. */
  onLine(index: number, speaking: boolean): void;
  onEnd(): void;
}

const SPEECH_LANG: Record<Lang, string> = { ar: "ar-SA", en: "en-GB" };

/** The longest a spoken line may take before the player moves on (a voice that never ends). */
export function speakLimitMs(text: string): number {
  return 4000 + text.length * 180;
}

function browserDeps(): SpeechDeps {
  const synth = typeof speechSynthesis === "undefined" ? null : speechSynthesis;
  const known: Partial<Record<Lang, SpeechSynthesisVoice | null>> = {};
  const pick = (lang: Lang): SpeechSynthesisVoice | null => {
    const tag = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
    const local = synth!.getVoices().filter((v) => v.localService);
    return (
      local.find((v) => tag(v) === SPEECH_LANG[lang].toLowerCase()) ??
      local.find((v) => tag(v).startsWith(lang)) ??
      null
    );
  };
  return {
    voiceNow(lang) {
      if (!synth) return null;
      if (synth.getVoices().length > 0) return (known[lang] = pick(lang));
      return known[lang];
    },
    async voiceFor(lang) {
      if (!synth) return null;
      if (synth.getVoices().length === 0 && typeof synth.addEventListener === "function") {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            synth.removeEventListener("voiceschanged", done);
            resolve();
          };
          const timer = setTimeout(done, 1000);
          synth.addEventListener("voiceschanged", done);
        });
      }
      return (known[lang] = pick(lang));
    },
    speak(text, lang, voice, done) {
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") return done();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = SPEECH_LANG[lang];
      u.voice = voice;
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    },
    cancel() {
      if (synth) synth.cancel();
    },
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  };
}

export class SequencePlayer {
  private generation = 0;
  private timer: unknown = null;
  private readonly deps: SpeechDeps;

  constructor(deps?: SpeechDeps) {
    this.deps = deps ?? browserDeps();
  }

  /** Plays `lines` from the first; a running sequence is stopped first. */
  play(lines: readonly SpeechLine[], opts: PlayOptions): void {
    this.stop();
    const generation = this.generation;
    void this.step(0, lines, opts, generation);
  }

  /** Stops the voice and the sequence (the screen is left or Listen again starts it over). */
  stop(): void {
    this.generation++;
    this.clear();
    this.deps.cancel();
  }

  /** The Sound was turned off: the current line stops speaking and the rest are shown only. */
  silence(): void {
    this.deps.cancel();
  }

  private clear() {
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.timer = null;
  }

  private async step(i: number, lines: readonly SpeechLine[], opts: PlayOptions, generation: number) {
    if (generation !== this.generation) return;
    if (i >= lines.length) {
      opts.onEnd();
      return;
    }
    const line = lines[i];
    let ended = false;
    const next = () => {
      if (ended || generation !== this.generation) return;
      ended = true;
      this.clear();
      void this.step(i + 1, lines, opts, generation);
    };
    let voice: SpeechSynthesisVoice | null = null;
    if (opts.soundOn() && line.speech) {
      const now = this.deps.voiceNow?.(opts.lang);
      if (now === undefined) {
        // The voice list is still loading (the first line on a page): the line shows at once and is
        // spoken as soon as a voice is known, so the caption never waits.
        opts.onLine(i, false);
        voice = await this.deps.voiceFor(opts.lang);
      } else voice = now;
    }
    if (generation !== this.generation) return;
    if (voice && line.speech && opts.soundOn()) {
      opts.onLine(i, true);
      this.timer = this.deps.setTimeout(next, speakLimitMs(line.speech));
      this.deps.speak(line.speech, opts.lang, voice, () => {
        // A cancelled line (Sound turned off) stays shown for the rest of its reading time.
        if (!opts.soundOn() && !ended && generation === this.generation) {
          this.clear();
          this.timer = this.deps.setTimeout(next, readMs(line.display));
          return;
        }
        next();
      });
      return;
    }
    opts.onLine(i, false);
    this.timer = this.deps.setTimeout(next, readMs(line.display));
  }
}
