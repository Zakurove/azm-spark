/**
 * The series of the results pages (UX spec S52, S53, S54), pure:
 *   seriesCards        one card per current home series, in test order then side in run order; older
 *                      series of the same test side collapsed under "Show the earlier line"; the
 *                      booth points of a test side for its trend (C34: no booth card)
 *   trendRange         the TrendChart value scale, the band included
 *   todaysViews        the series whose newest result is today's check (S52 after the save)
 * Verdicts are never computed here: they come from compareSeries (contract D), on the server for
 * GET /api/progress and on the phone for the example (S54) and the read only history view.
 */
import { sideOrder } from "../../medical/assessment";
import type { SeriesComparison, SeriesPoint } from "../../medical/progress-rules";
import { CHECK_DATA, TEST_IDS } from "../../movements/assessments";
import type { CheckPosition, Setting, Side, Support, TestId, UnitFormId } from "../../movements/types";
import type { SeriesView } from "../../medical/series";

export type { SeriesView };
export type { SeriesPoint };

/** One load step of the arm curl (Q26), as the offer names it. */
export type LoadStepView = { kind: "dumbbell" | "cuff"; kg: number } | { kind: "bottle"; liters: number };

/**
 * A series as the pages read it: the server's view, with the Q26 heavier weight offer when the server
 * sends it (a contract addition, see the foundation requests: GET /api/progress does not send it yet).
 */
export type SeriesViewLike = SeriesView & { loadStep?: { from: LoadStepView; to: LoadStepView } | null };

export interface SeriesCard {
  key: string;
  view: SeriesViewLike;
  /** Older series of the same test, side and setting (a new line of comparison started since). */
  earlier: SeriesViewLike[];
  /** Booth results of the same test side, shown as hollow squares on the home trend (spec 5). */
  boothPoints: SeriesPoint[];
}

const sameSeries = (a: SeriesView, b: SeriesView) =>
  a.testId === b.testId && a.side === b.side && a.setting === b.setting;

/** Every point a view shows (start, earlier, now and the trend points), once each, by date. */
export function viewPoints(
  v: Pick<SeriesComparison, "baseline" | "previous" | "latest" | "points">,
): SeriesPoint[] {
  const all = [...(v.points ?? []), v.baseline, v.previous, v.latest].filter((p): p is SeriesPoint => !!p);
  const seen = new Map<number, SeriesPoint>();
  for (const p of all) if (!seen.has(p.date)) seen.set(p.date, p);
  return [...seen.values()].sort((a, b) => a.date - b.date);
}

/** The test order of the protocol for a position (selection.basePerPosition), then the rest. */
export function testOrder(position: CheckPosition | null | undefined): TestId[] {
  const base = position ? (CHECK_DATA.selection.basePerPosition[position] ?? []) : [];
  return [...base, ...TEST_IDS.filter((t) => !base.includes(t))];
}

/**
 * The cards of the results page (S53): the home series in test order of the protocol, then the side
 * in run order (sideOrder with the person's weaker side). A booth result (a signed in booth check of
 * an earlier build) is a point on its home trend, never a card of its own (C34); the list of checks
 * still opens it.
 */
export function seriesCards(
  views: readonly SeriesViewLike[],
  person: { support?: Support; position?: CheckPosition | null } = {},
): SeriesCard[] {
  const support = person.support ?? "none";
  const currents: SeriesViewLike[] = [];
  for (const v of views) {
    if (v.setting !== "home" || currents.some((c) => sameSeries(c, v))) continue;
    const group = views.filter((x) => sameSeries(x, v));
    currents.push(
      group.find((x) => x.current) ?? [...group].sort((a, b) => b.latest.date - a.latest.date)[0],
    );
  }
  const order = testOrder(person.position);
  const testRank = (t: TestId) => order.indexOf(t);
  const sideRank = (t: TestId, s: string) => {
    const sides: string[] = sideOrder(t, support);
    const i = sides.indexOf(s);
    return i < 0 ? sides.length : i;
  };
  currents.sort(
    (a, b) =>
      testRank(a.testId) - testRank(b.testId) || sideRank(a.testId, a.side) - sideRank(b.testId, b.side),
  );
  return currents.map((view) => ({
    key: view.seriesKey,
    view,
    earlier: views
      .filter((x) => x !== view && sameSeries(x, view))
      .sort((a, b) => b.latest.date - a.latest.date),
    boothPoints: views
      .filter((x) => x.testId === view.testId && x.side === view.side && x.setting === "booth")
      .flatMap((x) => viewPoints(x))
      .sort((a, b) => a.date - b.date),
  }));
}

/** The rounding step of a scale: 5 degrees or 1 count. */
const stepOf = (unit: UnitFormId) => (unit === "deg" ? 5 : 1);

/** The TrendChart value scale: every value and the band around the start, rounded outward. */
export function trendRange(
  values: readonly number[],
  start: number,
  band: number,
  unit: UnitFormId,
): { lo: number; hi: number } {
  const step = stepOf(unit);
  const min = Math.min(...values, start - band);
  const max = Math.max(...values, start + band);
  const lo = Math.max(0, Math.floor(min / step) * step);
  const hi = Math.ceil(max / step) * step;
  return { lo, hi: hi > lo ? hi : lo + step };
}

/** The position of a value on a scale, 0 at lo and 1 at hi (clamped). */
export function fraction(v: number, lo: number, hi: number): number {
  if (hi <= lo) return 0.5;
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

/**
 * The series of today's check once the server has saved it (S52): the current series of each test side
 * measured today in this setting. Their newest result is today's, since the check posted it last.
 */
export function todaysViews(
  views: readonly SeriesViewLike[],
  measured: readonly { testId: TestId; side: string }[],
  setting: Setting,
): Map<string, SeriesViewLike> {
  const out = new Map<string, SeriesViewLike>();
  for (const m of measured) {
    const v = views.find(
      (x) => x.current && x.setting === setting && x.testId === m.testId && x.side === m.side,
    );
    if (v) out.set(`${m.testId}:${m.side}`, v);
  }
  return out;
}

/** The side order of a test for a person (run order), for rows inside a card. */
export function runSides(testId: TestId, support: Support): (Side | "none")[] {
  return sideOrder(testId, support);
}
