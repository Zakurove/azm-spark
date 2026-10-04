/**
 * Copy of the v7 screens (product v7 contract 1.2, 8.8): src/i18n/ar/<namespace>.json and
 * src/i18n/en/<namespace>.json for intake7 (the intake additions), rom (the focus check and its range
 * screens), gait, coach, targets and showcase, read with tV7(lang, "<namespace>.<key>", vars).
 *
 * Imported only by v7 chunks, never by src/i18n/index.ts, so the landing's first script holds none of
 * these strings (8.8). Each namespace starts empty (contract 1.3) and is filled by its owner; the key
 * sets of Arabic and English must be identical (the compile time check below and tests/i18n.test.ts).
 * Interpolation, Arabic digits and the unit plural forms are those of src/i18n (createTranslator).
 */
import type { Lang } from "../app/i18n";
import { createTranslator, type KeyPaths, type Vars } from "./index";
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

const V7_DICTS = {
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
const arHasEveryEnglishKey: typeof V7_DICTS.en = V7_DICTS.ar;
const enHasEveryArabicKey: typeof V7_DICTS.ar = V7_DICTS.en;
void arHasEveryEnglishKey;
void enHasEveryArabicKey;

export type V7Namespace = keyof typeof V7_DICTS.en;
export const V7_NAMESPACES = Object.keys(V7_DICTS.en) as V7Namespace[];

/** Every key tV7() accepts, for example "rom.consent.title" (none until a namespace is filled). */
export type V7Key = { [N in V7Namespace]: `${N}.${KeyPaths<(typeof V7_DICTS)["en"][N]>}` }[V7Namespace];

const translate = createTranslator(V7_DICTS);

/** v7 copy in the chosen language. */
export function tV7(lang: Lang, key: V7Key, vars?: Vars): string {
  return translate(lang, key, vars);
}

/** The v7 dictionaries, for tests and tooling. */
export const V7_DICTIONARIES: Record<Lang, Record<V7Namespace, unknown>> = V7_DICTS;
