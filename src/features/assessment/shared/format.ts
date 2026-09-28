/**
 * Small formatting rules of the check copy (UX spec 0.2 and 3.0) that t() does not cover.
 */
import type { Lang } from "../../../app/i18n";
import { unitWord } from "../../../i18n";

/**
 * The minute word chosen by the last number of a duration (assessment.units.min, 3.0). Durations in
 * copy pass unit: "min" instead, so the Arabic one and two forms stand for the number and the word
 * together (countPhrase in src/i18n: «دقيقة واحدة», «دقيقتين»).
 */
export function minutesUnit(lang: Lang, n: number): string {
  return unitWord(lang, "min", n);
}

/**
 * A number typed by a person (0.2): Arabic Indic (٠ to ٩) and Persian (۰ to ۹) digits become ASCII,
 * and ٫ or ، or , becomes the decimal point, before validation. Returns null for anything that is not
 * a plain non negative number.
 */
export function parseNumberInput(raw: string): number | null {
  const ascii = raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫،,]/g, ".");
  if (!/^\d+(\.\d+)?$/.test(ascii)) return null;
  const n = Number(ascii);
  return Number.isFinite(n) ? n : null;
}
