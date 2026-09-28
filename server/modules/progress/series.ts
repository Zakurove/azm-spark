/**
 * Movement check progress per series (contract v2, D and E; clinical spec 5). Pure: rows in, views
 * out. Every comparison is the person's own series against its own starting point (compareSeries);
 * nothing here knows any population value.
 */
import { CHECK_DATA, TEST_IDS, testDef } from "../../../src/movements/assessments";
import type { CheckPosition, Setting, Side, Text, TestId } from "../../../src/movements/types";
import {
  chairStandMilestone,
  compareSeries,
  groupBySeries,
  startsNewSeries,
  symptomAskSides,
  type SeriesComparison,
  type SeriesContext,
  type StoredResult,
} from "../../../src/medical/progress-rules";

export type ContextFor = (position: CheckPosition) => SeriesContext;

export interface SeriesView extends SeriesComparison {
  seriesKey: string;
  setting: Setting;
  /** Variant of the latest result (arm curl load kind, chair stand version), null for none. */
  variant: string | null;
  better: "higher";
  /** The default band of the test in its unit (the band used is `band`). */
  noiseBand: number;
  /** The series holds the newest result of this test, side and setting; older series are history. */
  current: boolean;
  /** The newest result of this test and side started a new series (spec 5 "not comparable"). */
  notComparable?: true;
  /** Chair stand: the newest result moved from the hands allowed version to the standard one. */
  milestone?: true;
  /**
   * noVerdict is the sentence of the no verdict reason; it is null for "censored", whose text is the
   * value format "more than {value}", not a sentence. moreThan is that format, given when a point
   * shown (start, now, previous or a trend point) is censored; the page applies it to those points.
   */
  labels: {
    name: Text;
    side: Text | null;
    verdict: Text | null;
    noVerdict: Text | null;
    moreThan: Text | null;
  };
}

/** The "more than {value}" format of censored side lean values (spec 4.3 Censoring). */
const CENSORED_FORMAT_ID = "censored";

function anyCensored(c: SeriesComparison): boolean {
  const shown = [c.baseline, c.latest, c.previous, ...(c.points ?? [])];
  return shown.some((p) => p?.censored === true);
}

const measured = (r: StoredResult) => typeof r.value === "number" && Number.isFinite(r.value);
const sideRank = (s: string) => ["left", "right", "none"].indexOf(s);

function sideLabel(testId: TestId, side: string): Text | null {
  const tokens = testDef(testId).resultTokens as { side?: Record<Side, Text> };
  return side === "left" || side === "right" ? (tokens.side?.[side] ?? null) : null;
}

/**
 * Every series of the person with a measured value, as compareSeries sees it, plus what the page
 * needs around it: whether it is the current series, "not comparable", the chair stand milestone,
 * and the words of its name, side, verdict and no verdict sentence. `lastCheckLasting` drops the
 * repeat offer: no early repeat while a lasting next day answer is unresolved (spec 5).
 */
export function seriesViews(
  results: readonly StoredResult[],
  ctxFor: ContextFor,
  opts: { lastCheckLasting: boolean },
): SeriesView[] {
  const kept = results.filter(measured);
  const newest = new Map<string, StoredResult>(); // per test, side and setting
  const newestAny = new Map<string, StoredResult>(); // per test and side
  const bySide = new Map<string, StoredResult[]>();
  for (const r of [...kept].sort((a, b) => a.created - b.created)) {
    newest.set(`${r.testId}|${r.side}|${r.setting}`, r);
    newestAny.set(`${r.testId}|${r.side}`, r);
    bySide.set(`${r.testId}|${r.side}`, [...(bySide.get(`${r.testId}|${r.side}`) ?? []), r]);
  }
  const out: SeriesView[] = [];
  for (const [key, series] of groupBySeries(results)) {
    const first = series[0];
    const def = testDef(first.testId);
    const c = compareSeries(def, first.side, series, ctxFor(first.position));
    if (!c) continue;
    const last = series.filter(measured).at(-1)!;
    const view: SeriesView = {
      ...c,
      seriesKey: key,
      setting: first.setting,
      variant: last.variant ?? null,
      better: def.better,
      noiseBand: def.noiseBand,
      current: newest.get(`${first.testId}|${first.side}|${first.setting}`) === last,
      labels: {
        name: def.name,
        side: sideLabel(def.id, first.side),
        verdict: c.verdict ? CHECK_DATA.progress.verdicts[c.verdict] : null,
        noVerdict:
          c.noVerdict && c.noVerdict !== CENSORED_FORMAT_ID
            ? CHECK_DATA.progress.noVerdict[c.noVerdict]
            : null,
        moreThan: anyCensored(c) ? CHECK_DATA.progress.noVerdict[CENSORED_FORMAT_ID] : null,
      },
    };
    if (opts.lastCheckLasting) delete view.repeatOffer;
    if (newestAny.get(`${first.testId}|${first.side}`) === last) {
      const history = bySide.get(`${first.testId}|${first.side}`) ?? [];
      if (startsNewSeries(history)) view.notComparable = true;
      if (def.id === "chair_stand_30s") {
        const earlier = history.filter((r) => r.setting === last.setting && r.created < last.created).at(-1);
        if (earlier && chairStandMilestone(earlier.variant, last.variant ?? "")) view.milestone = true;
      }
    }
    out.push(view);
  }
  const testRank = (t: TestId) => TEST_IDS.indexOf(t);
  return out.sort(
    (a, b) =>
      testRank(a.testId) - testRank(b.testId) ||
      sideRank(a.side) - sideRank(b.side) ||
      Number(b.current) - Number(a.current) ||
      b.latest.date - a.latest.date,
  );
}

/**
 * The one sided large drop question after a check (spec 5, progress.largeDrop.oneSidedRule): per
 * test with sides, the sides to ask about before the results are shown, whatever the quality flags.
 * Each side of today's check is compared within its own series up to today's result.
 */
export function symptomAsk(
  results: readonly (StoredResult & { assessmentId: string })[],
  assessmentId: string,
  ctxFor: ContextFor,
): { testId: TestId; sides: Side[] }[] {
  const today = results.filter((r) => r.assessmentId === assessmentId && measured(r));
  const out: { testId: TestId; sides: Side[] }[] = [];
  for (const testId of TEST_IDS) {
    const def = testDef(testId);
    if (def.sides !== "each") continue;
    const bySide: Partial<Record<Side, SeriesComparison | null>> = {};
    for (const r of today.filter((x) => x.testId === testId)) {
      if (r.side === "none") continue;
      const series = results.filter((x) => x.seriesKey === r.seriesKey && x.created <= r.created);
      bySide[r.side] = compareSeries(def, r.side, series, ctxFor(r.position));
    }
    const sides = symptomAskSides(bySide);
    if (sides.length) out.push({ testId, sides });
  }
  return out;
}
