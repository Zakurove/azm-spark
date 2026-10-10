import { Severity } from "../engine/types";
import { readPreferences } from "./experience";
import { Lang } from "./i18n";
import voiceScript from "./voice-script.json";
import { cueUrls } from "./voicePacks";
/** Every line of the voice script: the movement check cues (check_ and test_ ids) and the caption text. */
export type VoiceLine = keyof typeof voiceScript;
const priority: Record<Severity, number> = { praise: 0, info: 1, warn: 2, safety: 3 };

/** True for an id with a voice line, such as a cue id from an engine event. */
export function isVoiceLine(id: string): id is VoiceLine {
  return Object.prototype.hasOwnProperty.call(voiceScript, id);
}

// iOS only lets an audio element play sound if a tap started it. One element is started
// inside the tap that opens the camera, and every later cue plays through it.
let shared: HTMLAudioElement | null = null;
export function primeAudio(lang: Lang) {
  if (typeof Audio === "undefined") return;
  shared ??= new Audio();
  // Every pack carries the welcome (scripts/generate-voice.mjs), so the chosen pack's file exists.
  shared.src = cueUrls(lang, "preview", readPreferences().voicePack)[0];
  void shared.play().catch(() => undefined);
}

/** A 0.1 s silent WAV: played inside a tap so iOS lets the shared element play later lines. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/**
 * Packaged neural recordings from the chosen voice pack, then the default pack (src/app/voicePacks.ts),
 * for the v1 movement check's lines and the coach settings' sample. No speech service is contacted
 * during a session, and the phone's own speech is never used (D-036 item 1): a line with no recording
 * is not said, its caption carries it. D-038 item 3: no exercise or workout plays a recording any
 * more (no counts, no corrections, no set lines); the Live coach is their only voice.
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
    if (typeof Audio === "undefined") return;
    shared ??= new Audio();
    shared.src = SILENCE;
    void shared.play().catch(() => undefined);
  }

  private fileCache = new Map<string, Promise<HTMLAudioElement | null>>();
  private activeAudio?: HTMLAudioElement;
  private generation = 0;
  private isMuted = false;
  private activePriority = -1;
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
    this.generation++;
    this.activeAudio?.pause();
    this.activeAudio = undefined;
    this.activePriority = -1;
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
    if (this.muted) return false;
    if (this.activePriority > rank || (this.activePriority === rank && rank < 3)) return false;
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
        onEnd?.();
      }
    };
    const el = await this.file(id);
    if (generation !== this.generation) return false;
    // No recording (a missing MP3): nothing is said, the line's caption carries it (D-036 item 1).
    if (this.muted || !el) {
      finish();
      return false;
    }
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
      if (generation === this.generation) this.endActive = finish;
      else finish();
      return true;
    } catch {
      finish();
      return false;
    }
  }
}
