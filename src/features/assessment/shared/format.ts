/**
 * Small formatting rules of the check copy (UX spec 0.2 and 3.0) that t() does not cover.
 */
import type { Lang } from "../../../app/i18n";
import { t } from "../../../i18n";

const RULES: Record<Lang, Intl.PluralRules> = {
  ar: new Intl.PluralRules("ar"),
  en: new Intl.PluralRules("en"),
};

/** The minute word chosen by the last number of a duration (assessment.units.min, 3.0). */
export function minutesUnit(lang: Lang, n: number): string {
  const form = RULES[lang].select(n);
  if (form === "one") return t(lang, "assessment.units.min.one");
  if (form === "two") return t(lang, "assessment.units.min.two");
  if (form === "few") return t(lang, "assessment.units.min.few");
  return t(lang, "assessment.units.min.many");
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
