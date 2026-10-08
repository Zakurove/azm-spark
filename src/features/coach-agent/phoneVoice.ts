/**
 * The phone's own voice for the v7 checks (D-034 item 3: one voice control). The v7 lines have no
 * recorded packs (D-031 item 1), so with the sound on and no Live coach every line is spoken with the
 * phone's speech (SpeechSynthesis): an Arabic voice for the Arabic interface, ar-SA first, else any
 * Arabic voice; an English voice for the English interface. Local voices only: a remote voice would
 * send the line to a speech service. Without a voice for the language the captions stay, silently.
 *
 * iOS (and Chrome) let speech play only after a first utterance a tap started: unlock() speaks one
 * silent utterance inside the check's taps (the intro's start, Ready, the speaker button). Each line is
 * reported to CuePlayer's activity, so the Live coach's microphone gate hears the app's own voice
 * (bridge rule 3) as it does for the voice packs; it plays by CuePlayer's priorities (a safety line
 * cuts in, a correction never cuts a question).
 *
 * It implements the part of CuePlayer the coach's LocalVoice uses (line, stop), so CueVoice wraps it.
 */
import { CuePlayer } from "../../app/audio";
import type { Lang } from "../../app/i18n";
import voiceScript from "../../app/voice-script.json";
import type { Severity } from "../../engine/types";

/** The part of SpeechSynthesis the voice uses (a test passes its own). */
export interface SpeechPort {
  getVoices(): SpeechSynthesisVoice[];
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
  addEventListener?(type: "voiceschanged", fn: () => void): void;
  removeEventListener?(type: "voiceschanged", fn: () => void): void;
}

export interface PhoneVoiceDeps {
  speech?: SpeechPort | null;
  utterance?: (text: string) => SpeechSynthesisUtterance;
}

const RANK: Record<Severity, number> = { praise: 0, info: 1, warn: 2, safety: 3 };
const TAG: Record<Lang, string> = { ar: "ar-SA", en: "en-GB" };

type Spoken = { ar: string; en: string; arTts?: string; enTts?: string };
const SCRIPT = voiceScript as Record<string, Spoken>;

const browserSpeech = (): SpeechPort | null =>
  typeof speechSynthesis === "undefined" ? null : (speechSynthesis as unknown as SpeechPort);
const browserUtterance = (text: string) => new SpeechSynthesisUtterance(text);

/** A voice's language tag, lower case with a hyphen (some engines say ar_SA). */
const tagOf = (v: { lang: string }) => v.lang.toLowerCase().replace("_", "-");

/**
 * The voice for the interface language: Arabic ar-SA first, else any Arabic; English for English (en-GB
 * first). Local voices only. null when the phone has none.
 */
export function pickVoice<V extends { lang: string; localService: boolean }>(
  voices: readonly V[],
  lang: Lang,
): V | null {
  const local = voices.filter((v) => v.localService);
  return (
    local.find((v) => tagOf(v) === TAG[lang].toLowerCase()) ??
    local.find((v) => tagOf(v).startsWith(lang)) ??
    null
  );
}

let unlocked = false;

export class PhoneVoice {
  muted = false;
  private readonly speech: SpeechPort | null;
  private readonly utterance: (text: string) => SpeechSynthesisUtterance;
  private activeRank = -1;
  private generation = 0;
  private endActive: (() => void) | null = null;

  constructor(
    private lang: Lang,
    deps: PhoneVoiceDeps = {},
  ) {
    this.speech = deps.speech === undefined ? browserSpeech() : deps.speech;
    this.utterance = deps.utterance ?? browserUtterance;
    // Asking early lets the browser load its voices before the first line.
    try {
      this.speech?.getVoices();
    } catch {
      /* no speech */
    }
  }

  /**
   * Inside a tap: one silent utterance, at once, so iOS lets later lines speak (once per page). Also
   * the audio session's unlock (CuePlayer.unlock), as the voice packs had it. Never throws.
   */
  static unlock(deps: PhoneVoiceDeps = {}): void {
    CuePlayer.unlock();
    if (unlocked) return;
    const speech = deps.speech === undefined ? browserSpeech() : deps.speech;
    if (!speech) return;
    try {
      const u = (deps.utterance ?? browserUtterance)(" ");
      u.volume = 0;
      speech.speak(u);
      unlocked = true;
    } catch {
      /* not supported: the captions stay */
    }
  }

  /** Tests only: the next unlock speaks again. */
  static resetUnlockForTests(): void {
    unlocked = false;
  }

  setLang(lang: Lang): void {
    if (lang === this.lang) return;
    this.stop();
    this.lang = lang;
  }

  /** A voice line of src/app/voice-script.json (rom_*, gait_*, the v1 check cues). */
  line(id: string, severity: Severity = "info", onEnd?: () => void): Promise<boolean> {
    const spoken = Object.prototype.hasOwnProperty.call(SCRIPT, id) ? SCRIPT[id] : null;
    if (!spoken) return Promise.resolve(false);
    const text = this.lang === "ar" ? (spoken.arTts ?? spoken.ar) : (spoken.enTts ?? spoken.en);
    return this.say(text, severity, onEnd);
  }

  /** Any line of the interface, in its language (such as «لنبدأ»). True when it started. */
  async say(text: string, severity: Severity = "info", onEnd?: () => void): Promise<boolean> {
    const rank = RANK[severity];
    if (this.muted || !this.speech || !text.trim()) return false;
    if (this.activeRank > rank || (this.activeRank === rank && rank < RANK.safety)) return false;
    let voice = this.voiceNow();
    if (!voice) {
      // Some browsers load the voice list after the first request for it.
      const asked = this.generation;
      await this.voicesLoaded();
      if (this.muted || asked !== this.generation) return false;
      voice = this.voiceNow();
      if (!voice) return false;
    }
    // Cut only a line of this voice that still plays: a cancel with nothing playing can make some
    // engines drop the utterance that follows it.
    if (this.endActive) this.stop();
    else this.generation++;
    const generation = this.generation;
    this.activeRank = rank;
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      if (generation === this.generation) {
        this.activeRank = -1;
        this.endActive = null;
      }
      CuePlayer.report(false, severity);
      onEnd?.();
    };
    const u = this.utterance(text);
    u.lang = TAG[this.lang];
    u.voice = voice;
    u.onend = finish;
    u.onerror = finish;
    this.endActive = finish;
    CuePlayer.report(true, severity);
    try {
      this.speech.speak(u);
    } catch {
      finish();
      return false;
    }
    return true;
  }

  stop(): void {
    this.generation++;
    this.activeRank = -1;
    const end = this.endActive;
    this.endActive = null;
    try {
      this.speech?.cancel();
    } catch {
      /* no speech */
    }
    end?.();
  }

  private voiceNow(): SpeechSynthesisVoice | null {
    try {
      return pickVoice(this.speech?.getVoices() ?? [], this.lang);
    } catch {
      return null;
    }
  }

  private voicesLoaded(timeoutMs = 1000): Promise<void> {
    const speech = this.speech;
    if (!speech?.addEventListener || !speech.removeEventListener) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        speech.removeEventListener?.("voiceschanged", done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      speech.addEventListener?.("voiceschanged", done);
    });
  }
}
