/**
 * Council decisions applied to the progress rules (src/medical/progress-rules.ts): the first re-test
 * band (Q27), the load step offer (Q26) and the inputs of the end of check question (Q23). Every test
 * name cites the decision it proves.
 */
import { describe, expect, it } from "vitest";
import { testDef } from "../src/movements/assessments";
import type { TestId } from "../src/movements/types";
import {
  bandOf,
  compareSeries,
  loadStepOffer,
  seriesKey,
  symptomAskSides,
  type ResultSide,
  type SeriesComparison,
  type SeriesContext,
  type StoredResult,
} from "../src/medical/progress-rules";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 4, 9);

type Over = Partial<StoredResult>;

function result(testId: TestId, side: ResultSide, value: number | null, over: Over = {}): StoredResult {
  const def = testDef(testId);
  const r: StoredResult = {
    testId,
    side,
    value,
    unit: def.unit,
    created: T0,
    setting: "home",
    seriesKey: "",
    detail: testId === "arm_curl_30s" ? { compensated: 0, loadObject: "dumbbell", loadKg: 2 } : {},
    flags: [],
    nValid: def.kind === "timed_count" ? 1 : 3,
    median: def.kind === "timed_count" ? undefined : value,
    poseModel: "full",
    movementVersion: 1,
    band: "default",
    position: testId === "chair_stand_30s" ? "standing" : "chair",
    variant: testId === "chair_stand_30s" ? "standard" : testId === "arm_curl_30s" ? "held" : null,
    ...over,
  };
  r.seriesKey = seriesKey(r);
  return r;
}

function series(testId: TestId, side: ResultSide, values: (number | [number, Over])[], common: Over = {}) {
  const rows = values.map((v, i) => {
    const [value, over] = typeof v === "number" ? [v, {}] : v;
    return result(testId, side, value, {
      ...common,
      ...over,
      ...(common.detail || over.detail
        ? { detail: { ...result(testId, side, 0).detail, ...common.detail, ...over.detail } }
        : {}),
      created: T0 + i * 28 * DAY,
    });
  });
  const key = rows[0].seriesKey;
  return rows.map((r) => ({ ...r, seriesKey: key }));
}

const ctx = (p: Partial<SeriesContext> = {}): SeriesContext => ({
  position: "chair",
  support: "none",
  conditions: ["none"],
  pain: [],
  setup: {},
  ...p,
});

function compare(testId: TestId, side: ResultSide, rows: StoredResult[], c = ctx()): SeriesComparison {
  const out = compareSeries(testDef(testId), side, rows, c);
  if (!out) throw new Error("no comparison");
  return out;
}

/* -------------------------------------------------------------- Q27 */

describe("Q27: the first re-test of the timed tests widens the band by 1 count", () => {
  it("Q27: arm curl, first re-test: band 4 becomes 5, so +5 reads about the same", () => {
    const c = compare("arm_curl_30s", "right", series("arm_curl_30s", "right", [12, 17]));
    expect(bandOf(testDef("arm_curl_30s"), 12, false)).toBe(4);
    expect(c).toMatchObject({ band: 5, change: 5, verdict: "same", firstRetest: true });
  });

  it("Q27: arm curl, first re-test: beyond the widened band reads higher or lower", () => {
    expect(compare("arm_curl_30s", "right", series("arm_curl_30s", "right", [12, 18])).verdict).toBe(
      "higher",
    );
    expect(compare("arm_curl_30s", "right", series("arm_curl_30s", "right", [12, 6])).verdict).toBe("lower");
    expect(compare("arm_curl_30s", "right", series("arm_curl_30s", "right", [12, 7])).verdict).toBe("same");
  });

  it("Q27: from the second re-test on, the normal band applies", () => {
    const c = compare("arm_curl_30s", "right", series("arm_curl_30s", "right", [12, 13, 17]));
    expect(c).toMatchObject({ band: 4, change: 5, verdict: "higher" });
    expect(c.firstRetest).toBeUndefined();
  });

  it("Q27: the chair stand first re-test adds 1 on top of the wide band", () => {
    // Baseline 10: band 4 (7 to 15), wide for MS adds 1, the first re-test adds 1 more.
    const c = compare(
      "chair_stand_30s",
      "none",
      series("chair_stand_30s", "none", [10, 16]),
      ctx({ position: "standing", conditions: ["ms"] }),
    );
    expect(c).toMatchObject({ band: 6, bandKind: "wide", change: 6, verdict: "same", firstRetest: true });
    const plain = compare(
      "chair_stand_30s",
      "none",
      series("chair_stand_30s", "none", [10, 15]),
      ctx({ position: "standing" }),
    );
    expect(plain).toMatchObject({ band: 5, verdict: "same" });
    const second = compare(
      "chair_stand_30s",
      "none",
      series("chair_stand_30s", "none", [10, 10, 15]),
      ctx({ position: "standing" }),
    );
    expect(second).toMatchObject({ band: 4, verdict: "higher" });
  });

  it("Q27: the arm raise and the side lean keep their bands", () => {
    const abd = compare("shoulder_abduction", "right", series("shoulder_abduction", "right", [120, 136]));
    expect(abd).toMatchObject({ band: 16, verdict: "same" });
    expect(abd.firstRetest).toBeUndefined();
    const lean = compare(
      "trunk_control_seated",
      "right",
      series("trunk_control_seated", "right", [20, 20, 29, 29]),
    );
    expect(lean.band).toBe(8);
    expect(lean.firstRetest).toBeUndefined();
  });

  it("Q27: a self counted first re-test is not the first re-test of the comparison", () => {
    const rows = series("arm_curl_30s", "right", [12, [20, { detail: { countSource: "self" } }], 17]);
    const c = compare("arm_curl_30s", "right", rows);
    expect(c).toMatchObject({ band: 4, verdict: "higher" });
  });

  it("Q27 and Q23: the one sided drop that names a side uses the normal band", () => {
    // Band 4 (5 at the first re-test). A drop of 9 is beyond 2 x 4 but not 2 x 5.
    const left = compare("arm_curl_30s", "left", series("arm_curl_30s", "left", [12, 3]));
    expect(left.band).toBe(5);
    expect(left.symptomDrop).toBe(true);
    expect(symptomAskSides({ left, right: null })).toEqual(["left"]);
  });
});

/* -------------------------------------------------------------- Q26 */

describe("Q26: the offer of one load step heavier (phase 2, home)", () => {
  const home = {
    ctx: ctx(),
    restrictions: [] as string[],
    clearance: "yes" as const,
    setting: "home" as const,
    lastCheckLasting: false,
    // One entry per check of the series, aligned to the latest: was bt_pain_after more or worse on that arm.
    painAfterMore: [false, false, false, false] as boolean[] | undefined,
  };
  const dumbbell = (values: number[], over: Over = {}) => series("arm_curl_30s", "right", values, over);

  it("Q26: three checks in a row with verdict higher on the same load offer plus 0.5 kg", () => {
    const rows = dumbbell([10, 16, 17, 18]);
    expect(loadStepOffer(rows, home)).toEqual({
      from: { kind: "dumbbell", kg: 2 },
      to: { kind: "dumbbell", kg: 2.5 },
    });
  });

  it("Q26: two in a row at 25 or more offer the step too", () => {
    expect(loadStepOffer(dumbbell([24, 25, 26]), home)).toEqual({
      from: { kind: "dumbbell", kg: 2 },
      to: { kind: "dumbbell", kg: 2.5 },
    });
    expect(loadStepOffer(dumbbell([24, 23, 26]), home)).toBeNull();
  });

  it("Q26: two higher checks are not enough, nor three with one about the same", () => {
    expect(loadStepOffer(dumbbell([10, 16, 17]), home)).toBeNull();
    expect(loadStepOffer(dumbbell([10, 16, 13, 17]), home)).toBeNull();
  });

  it("Q26: the next bottle size, never past 1.5 liters; wrist weights up to 2 kg; dumbbells up to 4 kg", () => {
    const bottle = (l: number) =>
      series("arm_curl_30s", "right", [24, 25, 26], {
        detail: { compensated: 0, loadObject: "bottle", loadL: l },
      });
    expect(loadStepOffer(bottle(0.5), home)?.to).toEqual({ kind: "bottle", liters: 1 });
    expect(loadStepOffer(bottle(1), home)?.to).toEqual({ kind: "bottle", liters: 1.5 });
    expect(loadStepOffer(bottle(1.5), home)).toBeNull();
    const cuff = (kg: number) =>
      series("arm_curl_30s", "right", [24, 25, 26], {
        variant: "cuff",
        detail: { compensated: 0, loadObject: "cuff", loadKg: kg },
      });
    expect(loadStepOffer(cuff(1.5), home)?.to).toEqual({ kind: "cuff", kg: 2 });
    expect(loadStepOffer(cuff(2), home)).toBeNull();
    const heavy = series("arm_curl_30s", "right", [24, 25, 26], {
      detail: { compensated: 0, loadObject: "dumbbell", loadKg: 4 },
    });
    expect(loadStepOffer(heavy, home)).toBeNull();
    const none = series("arm_curl_30s", "right", [24, 25, 26], {
      detail: { compensated: 0, loadObject: "none" },
    });
    expect(loadStepOffer(none, home)).toBeNull();
  });

  it("Q26: never at the booth, never while a lasting answer is unresolved, never after more pain on that arm", () => {
    const rows = dumbbell([24, 25, 26]);
    expect(loadStepOffer(rows, { ...home, setting: "booth" })).toBeNull();
    expect(loadStepOffer(rows, { ...home, lastCheckLasting: true })).toBeNull();
    expect(loadStepOffer(rows, { ...home, painAfterMore: [false, false, true] })).toBeNull();
    // Unknown pain answers at a qualifying check: not offered (the safe reading).
    expect(loadStepOffer(rows, { ...home, painAfterMore: undefined })).toBeNull();
  });

  it("Q26: never for an arm whose load a rule set (arm_only, cuff_or_arm_only, stroke weaker arm, no_resistance, clearance, arm pain)", () => {
    expect(
      loadStepOffer(series("arm_curl_30s", "right", [24, 25, 26], { variant: "arm_only" }), home),
    ).toBeNull();
    expect(
      loadStepOffer(series("arm_curl_30s", "right", [24, 25, 26], { variant: "cuff_or_arm_only" }), home),
    ).toBeNull();
    const rows = dumbbell([24, 25, 26]);
    expect(
      loadStepOffer(rows, { ...home, ctx: ctx({ conditions: ["stroke"], support: "right" }) }),
    ).toBeNull();
    expect(
      loadStepOffer(rows, { ...home, ctx: ctx({ conditions: ["stroke"], support: "left" }) }),
    ).not.toBeNull();
    expect(loadStepOffer(rows, { ...home, restrictions: ["no_resistance"] })).toBeNull();
    expect(loadStepOffer(rows, { ...home, clearance: "unsure" as const })).toBeNull();
    expect(
      loadStepOffer(rows, { ...home, ctx: ctx({ pain: ["elbow"], setup: { painSides: ["right"] } }) }),
    ).toBeNull();
    expect(
      loadStepOffer(rows, { ...home, ctx: ctx({ pain: ["elbow"], setup: { painSides: ["left"] } }) }),
    ).not.toBeNull();
  });

  it("Q26: never a dumbbell with Parkinson's, MS, CP or SCI, or after a grip yes on that arm", () => {
    const rows = dumbbell([24, 25, 26]);
    for (const c of ["parkinsons", "ms", "cerebral_palsy", "sci_complete", "sci_incomplete"])
      expect(loadStepOffer(rows, { ...home, ctx: ctx({ conditions: [c] }) }), c).toBeNull();
    expect(loadStepOffer(rows, { ...home, gripYes: true })).toBeNull();
  });

  it("Q26: only the latest checks of one series count (a load change is a new series)", () => {
    expect(() =>
      loadStepOffer([...dumbbell([24, 25]), ...series("arm_curl_30s", "left", [26])], home),
    ).toThrow(/one series/);
  });
});
