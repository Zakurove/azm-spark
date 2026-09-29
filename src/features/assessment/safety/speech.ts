/**
 * What the safety screens say, as lines to speak and caption one sentence at a time (UX spec S36,
 * 3.0 caption slot, 4.3, principle 4; council O12 (4), O24-2, 7.2-12). Pure: no DOM.
 *
 *   splitSentences(text)        a display text or its arTts split at the same full stops and question
 *                               marks (7.2-12), so the voice and the highlight move together
 *   screenLines(id, lang)       every sentence of a data screen (scr_*), display and speech paired
 *   cueLines / dataLine         a check cue (check_*) or a data question, with its vocalised arTts
 *   copyLine(text)              a line of interface copy (no arTts)
 *
 * Voice source. Every line keeps its display text (the caption strip and the highlight never depend
 * on the voice). The voice is the device's own speech synthesis (a local voice only, never a speech
 * service), reading the vocalised arTts in Arabic and the English text with 997 and 937 read digit by
 * digit. Council O12 (4) interim: a safety screen's Arabic body is read by speech synthesis only after
 * Nasser has listened to it on the booth phones' ar-SA voice and approved it (SYNTH_APPROVED); until
 * then it is shown without speech, with the caption strip and the 40 px heading, and at the booth staff
 * read the heading and first action aloud. The pre-generated voice files of O24-2 replace speech
 * synthesis once they exist and are approved by ear (a voice pipeline task, not built here).
 */
import type { Lang } from "../../../app/i18n";
import { cueLine, screenText, CHECK_DATA } from "../../../movements/assessments";
import type { CheckCueId, ScreenId } from "../../../movements/types";
import type { CaptionSeverity } from "../shared/CheckUi";

export interface SpeechLine {
  /** The exact display text: the caption strip shows it and the sentence stack highlights it. */
  display: string;
  /** What the voice reads, or null when the line is shown only (O12 (4) interim, sound off). */
  speech: string | null;
  severity: CaptionSeverity;
  /** The sentence this line highlights, as "<block>:<index>" (the SentenceStack of that block). */
  mark?: string;
  /**
   * The line is already on the screen as its heading (the question of S38b, S47, S48, S49): it is
   * spoken, and the caption strip stays empty rather than repeating it above itself.
   */
  onScreen?: boolean;
}

/**
 * The safety screens whose Arabic text Nasser has approved for speech synthesis on the booth phones'
 * ar-SA voice (O12 (4) interim). Add a screen id here only after that approval by ear; until then the
 * Arabic text of that screen is shown and captioned without a voice. English is read by synthesis
 * with the numbers spaced digit by digit (the O12 risk was unvocalised Arabic and 997 read as a large
 * number).
 */
export const SYNTH_APPROVED: ReadonlySet<ScreenId> = new Set<ScreenId>([]);

/** Whether the voice may read this safety screen's text in this language (O12 (4)). */
export function screenVoiceAllowed(id: ScreenId, lang: Lang): boolean {
  return lang === "en" || SYNTH_APPROVED.has(id);
}

/** Sentence ends: a full stop, question mark or exclamation mark (Latin or Arabic) before a space. */
const SENTENCE_END = /(?<=[.!?؟])\s+/u;

/** A text split at its full stops and question marks, with the punctuation kept (7.2-12). */
export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_END)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The emergency numbers read one digit at a time in English speech (Q22, Q30): "9 9 7". */
export function spokenNumbers(text: string): string {
  return text.replace(/\b(997|937)\b/g, (n) => n.split("").join(" "));
}

/** The speech of a display text that has no vocalised line: English only (Arabic needs arTts). */
function plainSpeech(lang: Lang, display: string): string | null {
  return lang === "en" ? spokenNumbers(display) : null;
}

/**
 * The display sentences of a text paired with its speech sentences. When the two split differently
 * (a data fault the unit tests guard against) the whole speech rides on the first sentence, so the
 * voice still says everything.
 */
export function pairSentences(
  display: string,
  speech: string | null,
  severity: CaptionSeverity,
  block: string,
): SpeechLine[] {
  const shown = splitSentences(display);
  const said = speech === null ? null : splitSentences(speech);
  const paired = said !== null && said.length === shown.length;
  return shown.map((d, i) => ({
    display: d,
    speech: said === null ? null : paired ? said[i] : i === 0 ? speech : null,
    severity,
    mark: `${block}:${i}`,
  }));
}

/** The sentences of a data screen (scr_*), with its arTts in Arabic, under the O12 (4) gate. */
export function screenLines(
  id: ScreenId,
  lang: Lang,
  opts: { severity?: CaptionSeverity; block?: string; voice?: boolean; from?: number } = {},
): SpeechLine[] {
  const entry = CHECK_DATA.screens[id] as { ar: string; en: string; arTts?: string };
  const voice = opts.voice ?? screenVoiceAllowed(id, lang);
  const display = screenText(id, lang);
  const speech = !voice ? null : lang === "ar" ? (entry.arTts ?? null) : spokenNumbers(display);
  const lines = pairSentences(display, speech, opts.severity ?? "safety", opts.block ?? id);
  return lines.slice(opts.from ?? 0);
}

/** A check cue: shown as its display line, spoken from its arTts (Arabic) or its English line. */
export function cueSpeech(id: CheckCueId, lang: Lang, severity: CaptionSeverity = "info"): SpeechLine {
  const c = cueLine(id);
  return {
    display: c[lang],
    speech: lang === "ar" ? (c.arTts ?? null) : spokenNumbers(c.en),
    severity,
  };
}

/** A data question or answer with a vocalised line (bt_pain_after, ec_symptoms, zone labels). */
export function dataLine(
  text: { ar: string; en: string; arTts?: string },
  lang: Lang,
  severity: CaptionSeverity = "info",
): SpeechLine {
  return {
    display: text[lang],
    speech: lang === "ar" ? (text.arTts ?? null) : spokenNumbers(text.en),
    severity,
  };
}

/**
 * A line of interface copy. It has no vocalised form, so an Arabic voice does not read it (an
 * unvocalised line read by a generic voice can be misread, O12); it is captioned and announced.
 */
export function copyLine(lang: Lang, display: string, severity: CaptionSeverity = "info"): SpeechLine {
  return { display, speech: plainSpeech(lang, display), severity };
}

/** How long a line stays in the caption strip when no voice reads it (about 15 characters a second). */
export function readMs(text: string): number {
  return Math.min(9000, Math.max(1800, text.length * 65));
}
