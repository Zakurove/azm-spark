/** Types for the pure parts of scripts/generate-voice.mjs (tests/voice-generator.test.ts). */
export interface VoiceLine {
  ar: string;
  en: string;
  arTts?: string;
  enTts?: string;
}
export declare const MODEL: string;
export declare const DEFAULT_VOICES: { ar: string; en: string };
export declare const INSTRUCTIONS: { ar: string; en: string; count: string };
export declare function styleFor(lang: "ar" | "en", id: string): string;
export declare function inputFor(lang: "ar" | "en", id: string, line: VoiceLine): string;
export declare function paceWarning(lang: "ar" | "en", text: string, seconds: number): string;
export declare const PACE_GATE: { maxArLettersPerSec: number; minLetters: number };
export declare function arLetters(text: string): number;
export declare function paceGate(lang: "ar" | "en", text: string, seconds: number): string;
export declare const TRANSCRIBE_MODEL: string;
export declare function spokenWords(lang: "ar" | "en", text: string): string[];
export declare function transcriptGate(lang: "ar" | "en", sent: string, heard: string | null | undefined): string;
