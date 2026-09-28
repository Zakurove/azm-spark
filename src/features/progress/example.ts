/**
 * The example of the results page (UX spec S54, D-008): the bundled fixture holds stored results only,
 * and the series views are computed by the same code as GET /api/progress (seriesViews, which runs
 * compareSeries), so the example can never show a verdict the rules would not give. Works offline.
 */
import type { CheckContext, StoredSetup } from "../../medical/assessment";
import { seriesKey, type StoredResult } from "../../medical/progress-rules";
import { testDef } from "../../movements/assessments";
import type { CheckPosition, Setting, Side, TestId } from "../../movements/types";
import { seriesViews } from "../../../server/modules/progress/series";
import type { ProgressResponse } from "../assessment/api";
import fixture from "./example-fixture.json";
import { seriesContextOf } from "./local";
import type { SeriesViewLike } from "./series";

interface FixtureResult {
  testId: string;
  side: string;
  setting: string;
  date: string;
  value: number;
  median?: number;
  nValid: number;
  detail: Record<string, number | boolean | string>;
}

/** A fixture day at 09:00 in Asia/Riyadh (06:00 UTC). */
export function fixtureDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 6, 0, 0);
}

export const EXAMPLE_PERSON = fixture.person as Pick<CheckContext, "support" | "conditions" | "pain"> & {
  position: CheckPosition;
  setup: StoredSetup;
};

/** The fixture's stored results, with the series key the server would compute for them. */
export function exampleResults(): StoredResult[] {
  return (fixture.results as unknown as FixtureResult[]).map((r) => {
    const testId = r.testId as TestId;
    const def = testDef(testId);
    const base = {
      testId,
      side: r.side as Side | "none",
      setting: r.setting as Setting,
      poseModel: "lite",
      movementVersion: def.version,
      detail: r.detail,
      position: EXAMPLE_PERSON.position,
      variant: null,
    };
    return {
      ...base,
      value: r.value,
      unit: def.unit,
      created: fixtureDay(r.date),
      seriesKey: seriesKey(base),
      flags: [],
      nValid: r.nValid,
      median: r.median ?? null,
      band: "default",
    };
  });
}

/** The example's series views: the fixture compared by the rules (seriesViews, compareSeries). */
export function exampleViews(): SeriesViewLike[] {
  const ctxFor = seriesContextOf(EXAMPLE_PERSON, EXAMPLE_PERSON.setup);
  return seriesViews(exampleResults(), ctxFor, { lastCheckLasting: false });
}

/** The example's sessions block (S54 must include one). */
export function exampleSessions(): Pick<
  ProgressResponse,
  "sessions" | "validShare" | "avgEffort" | "activeMinutesPerWeek"
> {
  const s = fixture.sessions;
  return {
    sessions: { weeks: s.weeks as unknown as ProgressResponse["sessions"]["weeks"] },
    validShare: s.validShare,
    avgEffort: s.avgEffort,
    activeMinutesPerWeek: s.activeMinutesPerWeek,
  };
}
