/**
 * The series of the results pages (UX spec S52, S53, S54), with views built by the same rules as GET
 * /api/progress (seriesViews and compareSeries): the card order (test order of the protocol, side in
 * run order, home only), older lines collapsed, booth points on the home trend, the TrendChart
 * scale, and today's series for S52. Verdicts only ever come from the rules.
 */
import { describe, expect, it } from "vitest";
import { seriesKey, type StoredResult } from "../src/medical/progress-rules";
import { testDef } from "../src/movements/assessments";
import type { Setting, TestId } from "../src/movements/types";
import { seriesViews } from "../src/medical/series";
import {
  fraction,
  seriesCards,
  testOrder,
  todaysViews,
  trendRange,
  viewPoints,
  type SeriesViewLike,
} from "../src/features/progress/series";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 5, 1, 6);

const RAISE = { reference: "trunk", bentElbowAccepted: false };
const CURL = { loadObject: "dumbbell", loadKg: 2, view: "side", armrest: "removed", compensated: 0 };

function stored(
  testId: TestId,
  side: "left" | "right" | "none",
  day: number,
  value: number,
  o: { setting?: Setting; detail?: Record<string, number | boolean | string> } = {},
): StoredResult {
  const def = testDef(testId);
  const base = {
    testId,
    side,
    setting: o.setting ?? "home",
    poseModel: "lite",
    movementVersion: def.version,
    detail: o.detail ?? (testId === "arm_curl_30s" ? CURL : RAISE),
    position: "chair" as const,
    variant: null,
  };
  return {
    ...base,
    value,
    unit: def.unit,
    created: T0 + day * DAY,
    seriesKey: seriesKey(base),
    flags: [],
    nValid: 3,
    median: value,
    band: "default",
  };
}

const ctxFor = () => ({
  position: "chair" as const,
  support: "none" as const,
  conditions: [],
  pain: [],
  setup: null,
});
const views = (rs: StoredResult[]) =>
  seriesViews(rs, ctxFor, { lastCheckLasting: false }) as SeriesViewLike[];

const HISTORY = [
  stored("shoulder_abduction", "right", 0, 98, { setting: "booth" }),
  stored("arm_curl_30s", "left", 10, 14),
  stored("shoulder_abduction", "left", 10, 117),
  stored("shoulder_abduction", "right", 10, 100),
  stored("shoulder_abduction", "right", 38, 106),
  stored("shoulder_abduction", "right", 66, 111),
  stored("shoulder_abduction", "right", 94, 122),
  stored("shoulder_abduction", "left", 94, 115),
  stored("arm_curl_30s", "left", 94, 7),
];

describe("the cards of My results (S53)", () => {
  it("orders home series by the protocol's test order and the run order of sides; no booth card (C34)", () => {
    const cards = seriesCards(views(HISTORY), { support: "none", position: "chair" });
    expect(cards.map((c) => `${c.view.testId}:${c.view.side}:${c.view.setting}`)).toEqual([
      "shoulder_abduction:right:home",
      "shoulder_abduction:left:home",
      "arm_curl_30s:left:home",
    ]);
  });

  it("puts the booth points of a test side on its home trend", () => {
    const cards = seriesCards(views(HISTORY), { position: "chair" });
    expect(cards[0].boothPoints.map((p) => p.value)).toEqual([98]);
    expect(cards[0].view.points?.map((p) => p.value)).toEqual([100, 106, 111, 122]);
    expect(cards[1].boothPoints).toEqual([]);
  });

  it("shows trends only from the third check of a series", () => {
    const cards = seriesCards(views(HISTORY), { position: "chair" });
    expect(cards[0].view.points).toBeDefined();
    expect(cards[1].view.points).toBeUndefined();
  });

  it("takes verdicts from the rules: higher, about the same, lower with the repeat offer", () => {
    const cards = seriesCards(views(HISTORY), { position: "chair" });
    expect(cards[0].view.verdict).toBe("higher");
    expect(cards[1].view.verdict).toBe("same");
    expect(cards[2].view.verdict).toBe("lower");
    expect(cards[2].view.repeatOffer).toBe(true);
  });

  it("collapses an older line of comparison under the newest one", () => {
    const heavier = { ...CURL, loadKg: 3 };
    const rs = [
      ...HISTORY,
      stored("arm_curl_30s", "left", 122, 10, { detail: heavier }),
      stored("arm_curl_30s", "left", 150, 11, { detail: heavier }),
    ];
    const cards = seriesCards(views(rs), { position: "chair" });
    const curl = cards.find((c) => c.view.testId === "arm_curl_30s")!;
    expect(curl.view.latest.value).toBe(11);
    expect(curl.earlier.map((e) => e.latest.value)).toEqual([7]);
  });

  it("follows the run order of sides for a person with a weaker side (arm raise stronger first)", () => {
    const rs = [...HISTORY, stored("arm_curl_30s", "right", 94, 12)];
    const cards = seriesCards(views(rs), { support: "right", position: "chair" });
    const sides = (t: TestId) =>
      cards.filter((c) => c.view.testId === t && c.view.setting === "home").map((c) => c.view.side);
    expect(sides("shoulder_abduction")).toEqual(["left", "right"]);
    expect(sides("arm_curl_30s")).toEqual(["right", "left"]);
  });

  it("lists the base tests of the position first", () => {
    expect(testOrder("standing").slice(0, 3)).toEqual([
      "shoulder_abduction",
      "chair_stand_30s",
      "arm_curl_30s",
    ]);
    expect(testOrder(null)).toHaveLength(4);
  });
});

describe("today's series on S52", () => {
  it("matches today's measured sides with their current series in this setting", () => {
    const today = todaysViews(
      views(HISTORY),
      [
        { testId: "shoulder_abduction", side: "right" },
        { testId: "chair_stand_30s", side: "none" },
      ],
      "home",
    );
    expect([...today.keys()]).toEqual(["shoulder_abduction:right"]);
    expect(today.get("shoulder_abduction:right")!.latest.value).toBe(122);
  });

  it("lists every point of a view once, by date", () => {
    const v = seriesCards(views(HISTORY), { position: "chair" })[0].view;
    const dates = viewPoints(v).map((p) => p.date);
    expect(dates).toEqual([...new Set(dates)].sort((a, b) => a - b));
  });
});

describe("the scale (S53 TrendChart)", () => {
  it("keeps every trend value and the band inside the chart", () => {
    const r = trendRange([100, 122, 98], 100, 16, "deg");
    expect(r.lo).toBeLessThanOrEqual(84);
    expect(r.hi).toBeGreaterThanOrEqual(122);
    expect(r.lo % 5).toBe(0);
    expect(r.hi % 5).toBe(0);
  });

  it("places values between 0 and 1", () => {
    expect(fraction(5, 0, 10)).toBe(0.5);
    expect(fraction(-5, 0, 10)).toBe(0);
    expect(fraction(50, 0, 10)).toBe(1);
    expect(fraction(3, 3, 3)).toBe(0.5);
  });
});
