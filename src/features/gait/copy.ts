/**
 * The walk's copy (product v7 contract 1.2: the gait namespace is stream C's): the clinical lines of
 * gait-rules copy (setup, quality, metrics, the no pattern line and the referrals), read from the
 * runtime data's copy section only (a named import, D-023 gap 16), and the screens' own lines from
 * src/i18n/{ar,en}/gait.json. Arabic first with complete English; no dash characters; the pattern
 * lines are the server's (the rules are never imported on the phone).
 */
import { copy as GAIT_COPY_DATA } from "../../movements/gait/gait-v7.json";
import type { GaitData } from "../../movements/gait/types";
import { localizeDigits } from "../../i18n";
import { tV7, type V7Key } from "../../i18n/v7";
import type { Lang } from "../../app/i18n";
import type { Text } from "../../movements/types";

type GaitCopy = GaitData["copy"];
const COPY = GAIT_COPY_DATA as unknown as GaitCopy;

/** A screen line of the gait namespace. */
export function gt(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  return tV7(lang, `gait.${key}` as V7Key, vars);
}

/** A clinical setup line (gait-rules copy.setup). */
export function setupLine(key: keyof GaitCopy["setup"], lang: Lang): string {
  return COPY.setup[key][lang];
}

/** A clinical quality line (gait-rules copy.quality). */
export function qualityLine(key: keyof GaitCopy["quality"], lang: Lang): string {
  return COPY.quality[key][lang];
}

/** «لم نلحظ اليوم في مشيك نمطًا يحتاج إلى تمارين خاصة ...» */
export function noPatternLine(lang: Lang): string {
  return COPY.patterns.no_pattern[lang];
}

/** A referral line by its id (refer_afo, refer_new_or_worse, ...), or null for an unknown id. */
export function referralLine(id: string, lang: Lang): string | null {
  const r = (COPY.referrals as Record<string, Text | undefined>)[id];
  return r ? r[lang] : null;
}

/** The person's side in the clinical copy's words (copy.placeholders). */
export function sideWord(side: "left" | "right", lang: Lang): string {
  const i = side === "left" ? 1 : 0;
  return lang === "ar" ? COPY.placeholders.side_ar[i] : COPY.placeholders.side_en[i];
}

/** A support finding's line (gait-rules copy.metrics), or null when the copy has none for it. */
export function supportLine(
  id: "flat_or_forefoot_contact" | "slow_speed" | "uneven_step_length",
  side: "left" | "right" | "both" | "none",
  lang: Lang,
): string | null {
  if (id === "slow_speed") return COPY.metrics.slow_speed[lang];
  if (id === "uneven_step_length" && (side === "left" || side === "right"))
    return lang === "ar"
      ? COPY.metrics.uneven_step_length.ar.replaceAll("{side_ar}", sideWord(side, lang))
      : COPY.metrics.uneven_step_length.en.replaceAll("{side_en}", sideWord(side, lang));
  return null;
}

/** A number to `places` decimals, in Western digits in both languages (D-036 item 3). */
export function num(lang: Lang, v: number, places = 0): string {
  const f = 10 ** places;
  const s = (Math.round(v * f) / f).toFixed(places);
  return localizeDigits(lang, s);
}
