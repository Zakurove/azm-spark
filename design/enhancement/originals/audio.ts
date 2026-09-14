import { CueId } from "../engine/types";
import { CUE_TEXT, Lang, fmtNum } from "./i18n";

/** Local recordings first, then an explicitly on-device platform voice. */
export class CuePlayer {
  private fileCache = new Map<string, Promise<HTMLAudioElement | null>>();
  private activeAudio?: HTMLAudioElement;
  private generation = 0;
  private isMuted = false;

  constructor(private lang: Lang) {}
  get muted() { return this.isMuted; }
  set muted(value: boolean) { this.isMuted = value; if (value) this.stop(); }
  setLang(lang: Lang) { this.stop(); this.lang = lang; }

  stop() {
    this.generation++;
    this.activeAudio?.pause();
    this.activeAudio = undefined;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  private file(id: string): Promise<HTMLAudioElement | null> {
    const key = `${this.lang}/${id}`;
    if (!this.fileCache.has(key)) {
      this.fileCache.set(key, new Promise((resolve) => {
        const el = new Audio(`/cues/${key}.mp3`);
        el.oncanplaythrough = () => resolve(el);
        el.onerror = () => resolve(null);
        el.load();
      }));
    }
    return this.fileCache.get(key)!;
  }

  private async play(id: string, text: string) {
    if (this.muted) return;
    this.stop();
    const generation = this.generation;
    const el = await this.file(id);
    if (this.muted || generation !== this.generation) return;
    if (el) {
      this.activeAudio = el;
      el.currentTime = 0;
      await el.play().catch(() => undefined);
      return;
    }
    if (typeof speechSynthesis === "undefined") return;
    const voice = speechSynthesis.getVoices().find(v => v.localService && v.lang.toLowerCase().startsWith(this.lang));
    // Captions remain available when no matching local voice is installed.
    if (!voice) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.lang === "ar" ? "ar-SA" : "en-US";
    u.voice = voice;
    u.rate = 1;
    speechSynthesis.speak(u);
  }

  cue(id: CueId): Promise<void> { return this.play(id, CUE_TEXT[id][this.lang]); }
  count(n: number): Promise<void> { return this.play(`count_${n}`, fmtNum(n, this.lang)); }
}
