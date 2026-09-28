import { CueId, Severity } from "../engine/types";
import { Lang } from "./i18n";
import voiceScript from "./voice-script.json";
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
  shared.src = `/cues/${lang}/preview.mp3`;
  void shared.play().catch(() => undefined);
}

/** Packaged neural recordings. No speech service is contacted during a session. */
export class CuePlayer {
  private fileCache = new Map<string, Promise<HTMLAudioElement | null>>();
  private activeAudio?: HTMLAudioElement;
  private generation = 0;
  private isMuted = false;
  private activePriority = -1;
  private rate = 1;
  guidanceOnly = false;
  constructor(private lang: Lang) {}
  get muted() {
    return this.isMuted;
  }
  set muted(value: boolean) {
    this.isMuted = value;
    if (value) this.stop();
  }
  set pace(value: number) {
    this.rate = Math.max(0.75, Math.min(1.25, value));
    if (this.activeAudio) this.activeAudio.playbackRate = this.rate;
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
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }
  private file(id: VoiceLine): Promise<HTMLAudioElement | null> {
    const key = `${this.lang}/${id}`;
    if (!this.fileCache.has(key))
      this.fileCache.set(
        key,
        new Promise((resolve) => {
          const el = new Audio(`/cues/${key}.mp3`);
          const timeout = setTimeout(() => {
            this.fileCache.delete(key);
            resolve(null);
          }, 5000);
          const done = (value: HTMLAudioElement | null) => {
            clearTimeout(timeout);
            resolve(value);
          };
          el.oncanplaythrough = () => done(el);
          el.onerror = () => {
            this.fileCache.delete(key);
            done(null);
          };
          el.load();
        }),
      );
    return this.fileCache.get(key)!;
  }
  async line(id: VoiceLine, severity: Severity = "info"): Promise<boolean> {
    const rank = priority[severity];
    if (this.muted || this.activePriority > rank || (this.activePriority === rank && rank < 3)) return false;
    this.stop();
    const generation = this.generation;
    this.activePriority = rank;
    const finish = () => {
      if (generation === this.generation) {
        this.activePriority = -1;
        this.activeAudio = undefined;
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
      target.playbackRate = this.rate;
      target.onended = finish;
      target.onerror = finish;
      try {
        await target.play();
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
    u.rate = this.rate;
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
    return true;
  }
  cue(id: CueId, severity: Severity = id === "stop_rest" ? "safety" : "warn") {
    return this.line(id, severity);
  }
  count(n: number) {
    return this.guidanceOnly || n < 1 || n > 10
      ? Promise.resolve(false)
      : this.line(`count_${n}` as VoiceLine, "praise");
  }
}
