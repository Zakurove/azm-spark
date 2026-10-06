import { CueId, Severity } from "../engine/types";
import { readPreferences } from "./experience";
import { Lang } from "./i18n";
import voiceScript from "./voice-script.json";
import { cueUrls } from "./voicePacks";
/** Every spoken line: workout cues, counts and the movement check cues (check_ and test_ ids). */
export type VoiceLine = keyof typeof voiceScript;
const priority: Record<Severity, number> = { praise: 0, info: 1, warn: 2, safety: 3 };

/** True for an id with a voice line, such as a cue id from an engine event. */
export function isVoiceLine(id: string): id is VoiceLine {
  return Object.prototype.hasOwnProperty.call(voiceScript, id);
}

/** Language tag of the speech fallback. */
const SPEECH_LANG: Record<Lang, string> = { ar: "ar-SA", en: "en-GB" };

/**
 * A voice installed on the device for the language, preferring the exact tag (ar-SA, en-GB).
 * Remote voices are never used: they would send the text to a speech service.
 */
function localVoice(lang: Lang): SpeechSynthesisVoice | undefined {
  const tag = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
  const voices = speechSynthesis.getVoices().filter((v) => v.localService);
  return (
    voices.find((v) => tag(v) === SPEECH_LANG[lang].toLowerCase()) ??
    voices.find((v) => tag(v).startsWith(lang))
  );
}

/** Some browsers load the voice list after the first request for it: wait briefly for it. */
function voicesLoaded(timeoutMs = 1000): Promise<void> {
  if (speechSynthesis.getVoices().length || typeof speechSynthesis.addEventListener !== "function")
    return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      speechSynthesis.removeEventListener("voiceschanged", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    speechSynthesis.addEventListener("voiceschanged", done);
  });
}

// iOS only lets an audio element play sound if a tap started it. One element is started
// inside the tap that opens the camera, and every later cue plays through it.
let shared: HTMLAudioElement | null = null;
export function primeAudio(lang: Lang) {
  // Asking for the voices early lets the browser load them before a fallback needs one.
  if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices();
  if (typeof Audio === "undefined") return;
  shared ??= new Audio();
  // Every pack carries the welcome (scripts/generate-voice.mjs), so the chosen pack's file exists.
  shared.src = cueUrls(lang, "preview", readPreferences().voicePack)[0];
  void shared.play().catch(() => undefined);
}

/** A 0.1 s silent WAV: played inside a tap so iOS lets the shared element play later lines. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/**
 * Packaged neural recordings from the chosen voice pack, then the default pack (src/app/voicePacks.ts).
 * No speech service is contacted during a session.
 */
export class CuePlayer {
  /**
   * A silent unlock inside a tap (UX spec S01, S02, 4.6): the shared element starts with silence, so
   * the first spoken line of the check can play later without a tap, and the audio session is set to
   * playback where the browser allows it (the iOS silent switch does not mute the voice).
   */
  static unlock(): void {
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      // While the live coach holds the session as play-and-record (v7 contract 2.11 rule 3), it stays.
      if (nav.audioSession && nav.audioSession.type !== "play-and-record") nav.audioSession.type = "playback";
    } catch {
      /* not supported */
    }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices();
    if (typeof Audio === "undefined") return;
    shared ??= new Audio();
    shared.src = SILENCE;
    void shared.play().catch(() => undefined);
  }

  private static activity = new Set<(playing: boolean, severity: Severity) => void>();
  /**
   * Each line any player plays, from its start to its end (or cut): the live coach's microphone gate
   * hears the app's own voice from every screen (v7 contract 2.11 bridge rules 1 and 3, D-030 D5-8).
   */
  static onActivity(fn: (playing: boolean, severity: Severity) => void): () => void {
    CuePlayer.activity.add(fn);
    return () => {
      CuePlayer.activity.delete(fn);
    };
  }
  private static report(playing: boolean, severity: Severity): void {
    for (const fn of [...CuePlayer.activity]) fn(playing, severity);
  }

  private fileCache = new Map<string, Promise<HTMLAudioElement | null>>();
  private activeAudio?: HTMLAudioElement;
  private generation = 0;
  private isMuted = false;
  private activePriority = -1;
  /** The one count waiting for the line playing now to end (booth v2 A5), or null. */
  private queuedCount: number | null = null;
  /** A pack played instead of the stored choice: the coach settings' sample of a pack being chosen. */
  voicePack?: string;
  constructor(private lang: Lang) {}
  get muted() {
    return this.isMuted;
  }
  set muted(value: boolean) {
    this.isMuted = value;
    if (value) this.stop();
  }
  setLang(lang: Lang) {
    this.stop();
    this.lang = lang;
  }
  stop() {
    this.queuedCount = null;
    this.generation++;
    this.activeAudio?.pause();
    this.activeAudio = undefined;
    this.activePriority = -1;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    // A line cut off here has ended too (a paused element fires no ended event).
    const end = this.endActive;
    this.endActive = undefined;
    end?.();
  }
  /** The end callback of the line playing now. */
  private endActive?: () => void;
  /** The first recording of the line that can play (chosen pack, then default pack), or null. */
  private file(id: VoiceLine): Promise<HTMLAudioElement | null> {
    const urls = cueUrls(this.lang, id, this.voicePack ?? readPreferences().voicePack);
    const key = urls[0];
    if (!this.fileCache.has(key))
      this.fileCache.set(
        key,
        new Promise((resolve) => {
          let settled = false;
          const done = (value: HTMLAudioElement | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            // A line that did not load is asked for again next time.
            if (!value) this.fileCache.delete(key);
            resolve(value);
          };
          const timeout = setTimeout(() => done(null), 5000);
          const load = (i: number) => {
            if (settled) return;
            if (i >= urls.length) return done(null);
            const el = new Audio(urls[i]);
            el.oncanplaythrough = () => done(el);
            el.onerror = () => load(i + 1);
            el.load();
          };
          load(0);
        }),
      );
    return this.fileCache.get(key)!;
  }
  /**
   * Plays a line; true when it started. `onEnd` is called once when it has been said to its end or
   * was cut off (a stop, a line of higher priority, an error), never for a line that did not start.
   */
  async line(id: VoiceLine, severity: Severity = "info", onEnd?: () => void): Promise<boolean> {
    const rank = priority[severity];
    if (this.muted || this.activePriority > rank || (this.activePriority === rank && rank < 3)) return false;
    this.stop();
    const generation = this.generation;
    this.activePriority = rank;
    let started = false;
    let ended = false;
    const finish = () => {
      const current = generation === this.generation;
      if (current) {
        this.activePriority = -1;
        this.activeAudio = undefined;
        if (this.endActive === finish) this.endActive = undefined;
      }
      if (started && !ended) {
        ended = true;
        CuePlayer.report(false, severity);
        onEnd?.();
      }
      // The waiting count plays once this line has ended (never after a stop: stop clears it).
      if (current && this.queuedCount !== null && !this.muted) {
        const n = this.queuedCount;
        this.queuedCount = null;
        void this.line(`count_${n}` as VoiceLine, "praise");
      }
    };
    const el = await this.file(id);
    if (this.muted || generation !== this.generation) return false;
    if (el) {
      const target = shared ?? el;
      if (target !== el) target.src = el.src;
      this.activeAudio = target;
      try {
        target.currentTime = 0;
      } catch {
        /* not seekable yet */
      }
      target.playbackRate = 1;
      target.onended = finish;
      target.onerror = finish;
      try {
        await target.play();
        started = true;
        CuePlayer.report(true, severity);
        if (generation === this.generation) this.endActive = finish;
        else finish();
        return true;
      } catch {
        finish();
        return false;
      }
    }
    // No recording (a missing MP3, such as a check cue before its file is generated): speak the
    // line with a voice on the device, the vocalized arTts text in Arabic and the enTts text (for
    // speech only, such as the welcome that names the brand clearly) in English.
    if (typeof speechSynthesis === "undefined") {
      finish();
      return false;
    }
    await voicesLoaded();
    if (this.muted || generation !== this.generation) return false;
    const voice = localVoice(this.lang);
    if (!voice) {
      finish();
      return false;
    }
    const spoken = voiceScript[id] as { ar: string; en: string; arTts?: string; enTts?: string };
    const u = new SpeechSynthesisUtterance(
      this.lang === "ar" ? (spoken.arTts ?? spoken.ar) : (spoken.enTts ?? spoken.en),
    );
    u.lang = SPEECH_LANG[this.lang];
    u.voice = voice;
    u.onend = finish;
    u.onerror = finish;
    started = true;
    CuePlayer.report(true, severity);
    this.endActive = finish;
    speechSynthesis.speak(u);
    return true;
  }
  cue(id: CueId, severity: Severity = id === "stop_rest" ? "safety" : "warn") {
    return this.line(id, severity);
  }
  /**
   * Says a rep count. While another line plays, the count waits as the ONLY queued line: a newer
   * count replaces it, and it plays when that line ends (booth v2 A5). A count never waits behind
   * a safety line, and a stop drops it.
   */
  count(n: number): Promise<boolean> {
    if (n < 1 || n > 10 || this.muted) return Promise.resolve(false);
    if (this.activePriority >= 0) {
      this.queuedCount = this.activePriority < priority.safety ? n : null;
      return Promise.resolve(false);
    }
    return this.line(`count_${n}` as VoiceLine, "praise");
  }
}
