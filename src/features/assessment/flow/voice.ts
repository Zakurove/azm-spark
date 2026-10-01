/**
 * The voice of the flow screens (UX spec principle 4, 3.0 caption slot, 4.3): every line the app
 * speaks shows its exact display text in the caption slot while it plays, then the slot collapses.
 *
 *   cue lines     the recording of the chosen voice pack, then of the default pack
 *                 (src/app/voicePacks.ts), or, until one exists, the device's own voice reading the
 *                 vocalised arTts line (never a remote speech service)
 *   data texts    the device's voice reading the speech form (arTts) or the display text
 *
 * When the sound is off, in captionsOnly or screen reader mode, or when nothing can play, the caption
 * still shows for about the time the line takes, and the hidden announcer reads it (the caption is
 * marked as not speaking). A new screen, a Sound toggle to off or a new sequence stops the voice.
 *
 * The chime is not here: it belongs to the safety screens (S43, S47).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { readPreferences } from "../../../app/experience";
import type { Lang } from "../../../app/i18n";
import { cueUrls } from "../../../app/voicePacks";
import type { CheckCueId } from "../../../movements/types";
import type { SoundMode } from "../flowMachine";
import { useCheckUi, type CaptionSeverity } from "../shared/CheckUi";
import { cueSpeech, type SpeechItem, type SpeechLine } from "./copy";

/** Delay between focus moving to the h1 and an entry line (3.0, 4.3), so the two never overlap. */
export const ENTRY_DELAY_MS = 800;

const SPEECH_LANG: Record<Lang, string> = { ar: "ar-SA", en: "en-GB" };

/** About how long a caption stays when nothing plays it: reading time, at least 2.5 s. */
export function captionMs(text: string): number {
  return Math.max(2500, Math.min(12000, text.length * 70));
}

/** Whether lines are heard: the Sound is on and the sound check left the voice on. */
export function audible(soundOn: boolean, mode: SoundMode | null): boolean {
  return soundOn && mode !== "captionsOnly" && mode !== "screenReader";
}

/* ------------------------------------------------------------------ audio plumbing */

let shared: HTMLAudioElement | null = null;

/** A 0.1 s silent WAV, played inside a tap so iOS lets the shared element play later lines. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/**
 * Unlocks audio inside a tap (UX spec 4.6): one shared element starts playing, and the audio session
 * is set to playback where the browser allows it, so the iOS silent switch does not mute the voice.
 */
export function unlockAudio(): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    /* not supported */
  }
  if (typeof Audio === "undefined") return;
  shared ??= new Audio();
  shared.src = SILENCE;
  void shared.play().catch(() => undefined);
  if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices();
}

function localVoice(lang: Lang): SpeechSynthesisVoice | undefined {
  if (typeof speechSynthesis === "undefined") return undefined;
  const tag = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
  const voices = speechSynthesis.getVoices().filter((v) => v.localService);
  return (
    voices.find((v) => tag(v) === SPEECH_LANG[lang].toLowerCase()) ??
    voices.find((v) => tag(v).startsWith(lang))
  );
}

/** Plays a recording to its end; false when it cannot (missing file, blocked, error). */
function playFile(url: string, token: { stopped: boolean }): Promise<boolean> {
  if (typeof Audio === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const el = shared ?? new Audio();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.onended = null;
      el.onerror = null;
      resolve(ok);
    };
    // A file that never starts (404 answered slowly, a stalled network) falls back after 3 s.
    const timer = setTimeout(() => finish(false), 3000);
    el.onended = () => finish(true);
    el.onerror = () => finish(false);
    el.src = url;
    el.play().then(
      () => clearTimeout(timer),
      () => finish(false),
    );
    const check = setInterval(() => {
      if (token.stopped) {
        el.pause();
        clearInterval(check);
        finish(true);
      }
      if (done) clearInterval(check);
    }, 100);
  });
}

/** Reads a text with a voice on the device; false when there is none. */
function speakText(text: string, lang: Lang, token: { stopped: boolean }): Promise<boolean> {
  const voice = localVoice(lang);
  if (!voice || typeof SpeechSynthesisUtterance === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LANG[lang];
    u.voice = voice;
    u.onend = () => resolve(true);
    u.onerror = () => resolve(true);
    speechSynthesis.speak(u);
    const check = setInterval(() => {
      if (token.stopped) {
        speechSynthesis.cancel();
        clearInterval(check);
        resolve(true);
      }
    }, 100);
    u.addEventListener("end", () => clearInterval(check));
  });
}

const sleep = (ms: number, token: { stopped: boolean }) =>
  new Promise<void>((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (token.stopped || Date.now() - started >= ms) {
        clearInterval(tick);
        resolve();
      }
    }, 50);
  });

/* ------------------------------------------------------------------ the hook */

export interface PlayOptions {
  severity?: CaptionSeverity;
  /** Called with the index of the line that starts (the SentenceStack highlight). */
  onLine?: (i: number | null) => void;
  /**
   * The lines are the screen's own text, already shown in its body (the question, the helper line,
   * the postpone text): they are spoken and highlighted there, and the caption strip stays empty
   * rather than repeating them above themselves.
   */
  onScreen?: boolean;
}

export interface Voice {
  /** Plays the items in order, each captioned; resolves when done or stopped. */
  play(items: readonly SpeechItem[], opts?: PlayOptions): Promise<void>;
  stop(): void;
  /** Index of the line being played, or null. */
  current: number | null;
}

/**
 * The flow screens' voice. `mode` is the sound check result (null before it: the voice is on).
 * `allowSpeechSynthesis` false keeps the device voice from reading data texts (O12 interim for the
 * safety texts): recordings still play, and every line still shows as a caption.
 */
export function useVoice(mode: SoundMode | null): Voice {
  const ui = useCheckUi();
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const token = useRef({ stopped: false });
  const [current, setCurrent] = useState<number | null>(null);

  const stop = useCallback(() => {
    token.current.stopped = true;
    token.current = { stopped: true };
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    shared?.pause();
    setCurrent(null);
  }, []);

  const play = useCallback(
    async (items: readonly SpeechItem[], opts: PlayOptions = {}) => {
      stop();
      const run = { stopped: false };
      token.current = run;
      const severity = opts.severity ?? "info";
      for (let i = 0; i < items.length; i++) {
        if (run.stopped) return;
        const u = uiRef.current;
        const item = items[i];
        const line: SpeechLine = "cue" in item ? cueSpeech(item.cue as CheckCueId, u.lang) : item;
        const hear = audible(u.sound.on, mode);
        setCurrent(i);
        opts.onLine?.(i);
        // The caption's tap plays this line again (3.0); a line already in the body is not repeated.
        const onScreen = opts.onScreen === true || line.onScreen === true;
        if (onScreen) u.clearCaption();
        else u.showCaption(line.display, severity, hear, () => void play([item], opts));
        let played = false;
        if (hear) {
          if ("cue" in item)
            for (const url of cueUrls(u.lang, item.cue, readPreferences().voicePack)) {
              played = await playFile(url, run);
              if (played || run.stopped) break;
            }
          if (!played && !run.stopped) played = await speakText(line.speech ?? line.display, u.lang, run);
        }
        if (run.stopped) return;
        if (!played) {
          // Nothing heard: the caption stays for its reading time and the announcer reads it.
          if (!onScreen) uiRef.current.showCaption(line.display, severity, false);
          await sleep(captionMs(line.display), run);
        }
      }
      if (run.stopped) return;
      setCurrent(null);
      opts.onLine?.(null);
      uiRef.current.clearCaption();
    },
    [mode, stop],
  );

  // Sound turned off: the voice stops at once (the caption of a later line still shows).
  useEffect(() => {
    if (!ui.sound.on) {
      token.current.stopped = true;
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      shared?.pause();
    }
  }, [ui.sound.on]);

  // Leaving the screen stops the voice; the next screen's caption is left alone.
  useEffect(
    () => () => {
      token.current.stopped = true;
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      shared?.pause();
    },
    [],
  );

  return { play, stop, current };
}

/**
 * Plays lines once when the screen opens, 800 ms after focus moved to its h1 (3.0), when `when` is
 * true. The effect runs once per mount.
 */
export function useEntryLines(
  voice: Voice,
  items: readonly SpeechItem[],
  when: boolean,
  opts?: PlayOptions,
): void {
  const ref = useRef({ items, opts });
  ref.current = { items, opts };
  useEffect(() => {
    if (!when || !ref.current.items.length) return;
    const timer = setTimeout(() => void voice.play(ref.current.items, ref.current.opts), ENTRY_DELAY_MS);
    return () => clearTimeout(timer);
    // Once per screen.
  }, []);
}
