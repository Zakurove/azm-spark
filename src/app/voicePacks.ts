/**
 * Installed voice packs (D-016 item 5): recordings in public/cues/packs/<id>/{ar,en}/<line>.mp3,
 * listed in public/cues/packs/index.json, which scripts/generate-voice.mjs keeps up to date. The
 * person picks a pack in the coach settings (Preferences.voicePack, per device; empty follows the
 * default pack named in index.json). A line missing from the chosen pack plays from the default pack,
 * then with a voice on the device.
 */
import index from "../../public/cues/packs/index.json";
import type { Lang } from "./i18n";

export interface VoicePack {
  id: string;
  label: string;
  provider: string;
}

export const VOICE_PACKS: readonly VoicePack[] = index.packs;
export const DEFAULT_PACK: string = index.default;

/** The pack when it is installed, otherwise the default pack. */
export function installedPack(id: unknown): string {
  return VOICE_PACKS.some((p) => p.id === id) ? (id as string) : DEFAULT_PACK;
}

/** The recordings to try for a line, in order: the chosen pack, then the default pack. */
export function cueUrls(lang: Lang, line: string, pack: unknown): string[] {
  return [...new Set([installedPack(pack), DEFAULT_PACK])].map((p) => `/cues/packs/${p}/${lang}/${line}.mp3`);
}
