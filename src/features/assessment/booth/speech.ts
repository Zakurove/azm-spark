/**
 * Speaks a booth line with the phone's own voice (S57: the idle dialog "is spoken (speech synthesis)
 * and captioned"). Only a voice installed on the device is used, never a remote one, so no text is
 * sent to a speech service (the rule of src/app/audio.ts). Without such a voice nothing is spoken and
 * the dialog's text carries the line.
 */
import type { Lang } from "../../../app/i18n";

const SPEECH_LANG: Record<Lang, string> = { ar: "ar-SA", en: "en-GB" };

function localVoice(lang: Lang): SpeechSynthesisVoice | undefined {
  const tag = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
  const voices = speechSynthesis.getVoices().filter((v) => v.localService);
  return (
    voices.find((v) => tag(v) === SPEECH_LANG[lang].toLowerCase()) ??
    voices.find((v) => tag(v).startsWith(lang))
  );
}

/** Speaks `text` once; returns whether a local voice took it. */
export function speakLocal(text: string, lang: Lang): boolean {
  if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") return false;
  const voice = localVoice(lang);
  if (!voice) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.95;
  speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
