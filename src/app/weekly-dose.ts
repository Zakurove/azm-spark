/**
 * A guided card's dose in words, as the Program tab's week (WeeklyPlan.tsx) and the program page
 * (program-v7) show it (stream E, step E3): a timer in seconds, or in minutes once a whole number of
 * minutes (walking practice), with its sets; a counter in repetitions (the guided card's own words).
 * Arabic counts its seconds («٥ ثوانٍ», «٣٠ ثانية»); English keeps the guided card's short seconds
 * («30 sec»). The v1 week's holds (15 to 30 seconds) read as they did.
 */
import { countPhrase } from "../i18n";
import type { WeeklyItem } from "../medical/weekly";
import { guidedCopy } from "./guided-copy";
import { fmtNum, type Lang } from "./i18n";

export function doseText(item: Pick<WeeklyItem, "sets" | "reps" | "holdSeconds">, lang: Lang): string {
  const g = guidedCopy(lang);
  const n = (v: number) => fmtNum(v, lang);
  const hold = item.holdSeconds ?? 0;
  if (!hold) return g.doseReps(item.sets, item.reps ?? 8, n);
  const minutes = hold >= 60 && hold % 60 === 0;
  if (!minutes && lang === "en") return g.doseHold(item.sets, hold, n);
  const time = minutes ? countPhrase(lang, "min", hold / 60) : countPhrase(lang, "sec", hold);
  if (item.sets === 1) return time;
  const times = lang === "ar" ? (item.sets === 2 ? "مرتان" : `${n(item.sets)} مرات`) : `${n(item.sets)}`;
  return `${times} × ${time}`;
}
