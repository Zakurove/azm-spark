/**
 * The program page's view (product v7 contract 2.10, stream E, step E3), pure, no DOM: the exercises
 * the findings chose, from the targeted week the server built (POST /api/program/targets), each with its
 * one why line, its dose and its days. The why lines, targets and reasons are the server's (rules before
 * AI); this module only arranges them for the page.
 */
import { fmtDate, type Lang } from "../../app/i18n";
import { doseText } from "../../app/weekly-dose";
import { libraryById } from "../../medical/pool";
import { servesResult, type WeeklyPlan } from "../../medical/weekly";
import type { FocusCheckSummary } from "../focus/api";

/** One exercise the findings chose, as the page shows it. */
export interface ProgramItemView {
  id: string;
  name: string;
  category: string;
  /** «10 تكرارات», «مرتان × 30 ثانية», «10 دقائق». */
  dose: string;
  /** The weekdays it is on, in the week's order («الأحد»). */
  days: string[];
  /** Its one reason (the why line). */
  why: string;
  /** It serves a result of the check (a range finding or a pattern of the walk), which its link opens. */
  result: boolean;
}

/** A weekday's name: the week starts on Sunday 6 September 2026, as the weekly plan writes it. */
export const weekdayName = (day: number, lang: Lang) =>
  fmtDate(new Date(2026, 8, 6 + day), lang, { weekday: "long" });

/** A card's dose in words, the same words as the Program tab's week (app/weekly-dose.ts). */
export { doseText };

const BLOCKS = ["warmup", "extra", "cooldown"] as const;

/**
 * The exercises the findings chose, once each: those that serve a result of the check first (a range
 * finding or the walk), then those of the history alone (a region the camera cannot measure, the
 * wheelchair shoulder care), each in the order of the week: the day it first comes, then its block
 * (range first, then strength and practice, held stretches last). A week of the v1 rules has none.
 */
export function programItems(weekly: WeeklyPlan, lang: Lang): ProgramItemView[] {
  const out = new Map<string, ProgramItemView>();
  for (const day of weekly.days)
    for (const block of BLOCKS)
      for (const item of day[block]) {
        if (!item.why) continue;
        const had = out.get(item.id);
        const name = weekdayName(day.day, lang);
        if (had) {
          if (!had.days.includes(name)) had.days.push(name);
          continue;
        }
        const e = libraryById(item.id);
        if (!e) continue;
        out.set(item.id, {
          id: item.id,
          name: e.name[lang],
          category: e.category,
          dose: doseText(item, lang),
          days: [name],
          why: item.why[lang],
          result: servesResult(item.reasonRefs),
        });
      }
  const all = [...out.values()];
  return [...all.filter((i) => i.result), ...all.filter((i) => !i.result)];
}

/**
 * The person's completed focus checks, newest first (GET /api/focus lists every check). Kept here
 * rather than imported from the findings link, so each slot keeps a chunk of its own (8.8).
 */
export function completedNewestFirst(checks: readonly FocusCheckSummary[]): FocusCheckSummary[] {
  return checks
    .filter((c) => c.status === "completed" && c.completed !== null)
    .sort((a, b) => b.completed! - a.completed!);
}
