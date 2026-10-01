/** Types for the pure parts of scripts/generate-voice.mjs (tests/voice-generator.test.ts). */
export interface VoiceLine {
  ar: string;
  en: string;
  arTts?: string;
  enTts?: string;
}
export declare const MODEL: string;
export declare const PACK_PROVIDER: string;
export interface Voices {
  ar: string;
  en: string;
}
export interface PackEntry {
  id: string;
  /** The friendly name in the coach settings (C40), set by withPack from the pack's place. */
  name: { ar: string; en: string };
  provider: string;
  voices: Voices;
  cueCount: number;
  complete: boolean;
}
export interface PackIndex {
  default: string;
  packs: PackEntry[];
}
export declare function parseArgs(argv: string[]): {
  pack: string;
  voices: { ar: string | null; en: string | null };
  only: string[] | null;
  model: string;
  dryRun: boolean;
  verify: string | null;
};
export declare function packVoices(
  existing: Pick<PackEntry, "id" | "provider" | "voices"> | undefined,
  voices: { ar: string | null; en: string | null },
): Voices;
export declare function packEntry(
  id: string,
  voices: Voices,
  ids: string[],
  has: (lang: "ar" | "en", id: string) => boolean,
): Omit<PackEntry, "name">;
export declare function packName(n: number): PackEntry["name"];
export declare function withPack(index: PackIndex | null, entry: Omit<PackEntry, "name">): PackIndex;
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
