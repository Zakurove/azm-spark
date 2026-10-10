/**
 * Copy for the v7 screens (product v7 contract 1.2 and 8.8): src/i18n/{ar,en}/<namespace>.json for
 * the six v7 namespaces, read with tV7(lang, "<namespace>.<key>", vars) exactly like t() of
 * src/i18n/index.ts (the same interpolation, Western digits and plural forms).
 *
 * Imported only by v7 chunks and never by src/i18n/index.ts, so no v7 string reaches the landing's
 * first script. Each namespace starts as {} and is filled by its owner: intake7 (stream A), rom (B),
 * gait (C), coach (D), targets (E), showcase (F). The key sets of Arabic and English must be
 * identical: the compile time check below and tests/i18n.test.ts enforce it.
 */
import { createTranslator, type KeyPaths, type Lang, type Vars } from "./index";
import arCoach from "./ar/coach.json";
import arGait from "./ar/gait.json";
import arIntake7 from "./ar/intake7.json";
import arRom from "./ar/rom.json";
import arShowcase from "./ar/showcase.json";
import arTargets from "./ar/targets.json";
import enCoach from "./en/coach.json";
import enGait from "./en/gait.json";
import enIntake7 from "./en/intake7.json";
import enRom from "./en/rom.json";
import enShowcase from "./en/showcase.json";
import enTargets from "./en/targets.json";

const DICTS_V7 = {
  ar: {
    intake7: arIntake7,
    rom: arRom,
    gait: arGait,
    coach: arCoach,
    targets: arTargets,
    showcase: arShowcase,
  },
  en: {
    intake7: enIntake7,
    rom: enRom,
    gait: enGait,
    coach: enCoach,
    targets: enTargets,
    showcase: enShowcase,
  },
};

// Compile time key parity: each language must have every key of the other.
const arHasEveryEnglishKey: typeof DICTS_V7.en = DICTS_V7.ar;
const enHasEveryArabicKey: typeof DICTS_V7.ar = DICTS_V7.en;
void arHasEveryEnglishKey;
void enHasEveryArabicKey;

export type V7Namespace = keyof typeof DICTS_V7.en;
export const V7_NAMESPACES = Object.keys(DICTS_V7.en) as V7Namespace[];

/** Every key tV7() accepts, for example "intake7.sex.legend". */
export type V7Key = { [N in V7Namespace]: `${N}.${KeyPaths<(typeof DICTS_V7)["en"][N]>}` }[V7Namespace];

const translate = createTranslator(DICTS_V7);

/** v7 copy in the chosen language, for example tV7(lang, "intake7.step"). */
export function tV7(lang: Lang, key: V7Key, vars?: Vars): string {
  return translate(lang, key, vars);
}

/** The v7 dictionaries, for tests and tooling. */
export const V7_DICTIONARIES: Record<Lang, Record<V7Namespace, unknown>> = DICTS_V7;
