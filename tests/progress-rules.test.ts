/**
 * Progress rules (src/medical/progress-rules.ts) against the clinical spec 5 and the noise band,
 * comparability and no verdict rules of 4.1 to 4.4:
 *   1. the prose lists of the data are the lists implemented (a data change fails here first);
 *   2. seriesKey: every blocking field splits a series, recorded fields do not;
 *   3. bands, including the percentage floors, the chair stand buckets and the wide rules;
 *   4. compareSeries per test at exactly the band boundary (at or below the band reads same), the
 *      worked examples of spec 5, agreement, confirmation, censoring, no verdict, large drop,
 *      near full range, trends;
 *   5. the one sided symptom question, not comparable, the chair stand milestone;
 *   6. property runs: verdicts are only higher, same or lower, and agree with change and band.
 */
import { describe, expect, it } from "vitest";
import { CHECK_DATA, testDef } from "../src/movements/assessments";
import type { TestId } from "../src/movements/types";
import {
  BLOCKING_FIELDS,
  DETAIL_KEYS,
  RESULT_FLAGS,
  bandOf,
  chairStandMilestone,
  checkTimeBand,
  compareSeries,
  groupBySeries,
  painfulArm,
  seriesKey,
  startsNewSeries,
  symptomAskSides,
  type ResultSide,
  type SeriesComparison,
  type SeriesContext,
  type StoredResult,
} from "../src/medical/progress-rules";
import { rng } from "./precheck-fixtures";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 4, 9);

/* ---------------------------------------------------------------- builders */

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
    detail: {},
    flags: [],
    nValid: def.kind === "timed_count" ? 1 : 3,
    median: def.kind === "timed_count" ? undefined : value,
    poseModel: "full",
    movementVersion: 1,
    band: "default",
    position: "chair",
    variant: testId === "chair_stand_30s" ? "standard" : testId === "arm_curl_30s" ? "held" : null,
    ...over,
  };
  if (testId === "arm_curl_30s" && !("detail" in over)) r.detail = { compensated: 0 };
  r.seriesKey = over.seriesKey ?? seriesKey(r);
  return r;
}

/** One series: values (or value plus overrides) 28 days apart, all with the same key. */
function series(
  testId: TestId,
  side: ResultSide,
  points: (number | [number | null, Over])[],
  common: Over = {},
): StoredResult[] {
  const rows = points.map((p, i) => {
    const [value, over] = typeof p === "number" ? [p, {} as Over] : p;
    // Without any detail the arm curl gets a known compensated share of 0 (see result).
    const hasDetail = over.detail !== undefined || common.detail !== undefined;
    return result(testId, side, value, {
      ...common,
      ...over,
      ...(hasDetail ? { detail: { ...common.detail, ...over.detail } } : {}),
      created: T0 + i * 28 * DAY,
    });
  });
  const key = rows[0].seriesKey;
  return rows.map((r) => ({ ...r, seriesKey: key }));
}

const ctxOf = (p: Partial<SeriesContext> = {}): SeriesContext => ({
  position: "chair",
  support: "none",
  conditions: ["none"],
  pain: [],
  setup: {},
  ...p,
});

function compare(testId: TestId, side: ResultSide, rows: StoredResult[], ctx = ctxOf()): SeriesComparison {
  const c = compareSeries(testDef(testId), side, rows, ctx);
  if (!c) throw new Error("no comparison");
  return c;
}

/** The verdict in words: higher, same, lower, or the reason there is none. */
function said(c: SeriesComparison): string {
  if (c.verdict) {
    return [c.verdict, c.unconfirmed && "unconfirmed", c.lowerExtra && "lowerExtra"]
      .filter(Boolean)
      .join(" ");
  }
  if (c.noVerdict) return `noVerdict:${c.noVerdict}`;
  if (c.largeDrop) return "largeDrop";
  if (c.nearFullRange) return "nearFullRange";
  if (c.startingPointSet) return "startingPointSet";
  if (c.firstResult) return "firstResult";
  return "none";
}

/* ------------------------------------------------------------ data ties */

describe("the prose rules of the data are the ones implemented", () => {
  it("blocking comparability fields, word for word", () => {
    for (const t of CHECK_DATA.tests) {
      expect(Object.keys(BLOCKING_FIELDS[t.id])).toEqual(t.comparability.blocking);
    }
  });

  it("wide band and no verdict lists (update progress-rules.ts when these change)", () => {
    const lists = Object.fromEntries(
      CHECK_DATA.tests.map((t) => [
        t.id,
        { wideWhen: t.noiseBandRules.wideWhen, noVerdictWhen: t.noiseBandRules.noVerdictWhen },
      ]),
    );
    expect(lists).toEqual({
      shoulder_abduction: {
        wideWhen: [
          "position is wheelchair",
          "conditions include stroke, ms, cerebral_palsy, sci_complete, sci_incomplete or parkinsons",
          "this side is the declared weaker side",
          "either check has attempt spread over 15 degrees, gravity reference or bent elbow",
        ],
        noVerdictWhen: [
          "shoulder pain on this side (setup.painSides): show start and now with the sentence noVerdict.shoulderPain, until Azm has its own MDC (Q1)",
          "fewer than 2 valid attempts on that side at either check (noVerdict.oneValid)",
          "poseModel differs between baseline and now: not comparable",
        ],
      },
      arm_curl_30s: {
        wideWhen: [
          "conditions include ms or parkinsons",
          "arthritis with pain on this arm (setup.painSides)",
        ],
        noVerdictWhen: [
          "range_below_baseline flag",
          "compensated share differs by more than 25 percentage points",
          "poseModel differs between baseline and now: wide band instead",
        ],
      },
      trunk_control_seated: {
        wideWhen: [
          "conditions include parkinsons or cerebral_palsy (involuntary movement)",
          "upright_unsteady flag at either check",
        ],
        noVerdictWhen: [
          "fewer than 2 valid attempts on that side at either check",
          "censored best at baseline",
          "contact on that side at both checks (noVerdict.chairLimit)",
          "arm_support_likely on the best attempt",
        ],
      },
      chair_stand_30s: {
        wideWhen: ["conditions include ms", "pushHand changed", "poseModel changed"],
        noVerdictWhen: ["range_mismatch flag", "countSource self at either check"],
      },
    });
  });

  it("numbers used by the rules", () => {
    const abd = testDef("shoulder_abduction").noiseBandRules;
    expect([abd.default.abs, abd.wide.abs, abd.nearFullRangeDeg, abd.minValidAttempts]).toEqual([
      16, 20, 160, 2,
    ]);
    const curl = testDef("arm_curl_30s").noiseBandRules;
    expect([curl.default.abs, curl.default.pctOfBaseline, curl.wide.abs, curl.wide.pctOfBaseline]).toEqual([
      4, 0.25, 5, 0.3,
    ]);
    const trunk = testDef("trunk_control_seated").noiseBandRules;
    expect([
      trunk.default.abs,
      trunk.default.pctOfBaseline,
      trunk.wide.abs,
      trunk.wide.pctOfBaseline,
    ]).toEqual([8, 0.3, 10, 0.35]);
    const stand = testDef("chair_stand_30s").noiseBandRules;
    expect(stand.byBaseline).toEqual([
      { max: 6, abs: 3 },
      { min: 7, max: 15, abs: 4 },
      { min: 16, abs: 5 },
    ]);
    expect(stand.wide.add).toBe(1);
    for (const t of CHECK_DATA.tests) expect(t.noiseBandRules.largeDropMultiple).toBe(2);
    expect(CHECK_DATA.progress.trendsFromCheck).toBe(3);
  });

  it("verdict keys are higher, same and lower, never better", () => {
    expect(Object.keys(CHECK_DATA.progress.verdicts).sort()).toEqual(["higher", "lower", "same"]);
    expect(JSON.stringify(CHECK_DATA.progress.verdicts)).not.toMatch(/better/i);
  });

  it("names the flags and detail keys it reads", () => {
    expect(Object.values(RESULT_FLAGS)).toEqual([
      "inconsistent",
      "bentElbow",
      "upright_unsteady",
      "arm_support_likely",
      "range_below_baseline",
      "range_mismatch",
    ]);
    expect(DETAIL_KEYS).toContain("countSource");
  });
});

/* ------------------------------------------------------------- series key */

describe("seriesKey (spec 5 like with like)", () => {
  const blockingChanges: Record<TestId, Over[]> = {
    shoulder_abduction: [
      { position: "wheelchair" },
      { detail: { reference: "gravity" } },
      { detail: { bentElbowAccepted: true } },
      { limbLoss: { arm: "left" } },
      { setting: "booth" },
      { poseModel: "lite" },
      { movementVersion: 2 },
      { side: "left" },
    ],
    arm_curl_30s: [
      { detail: { loadKg: 2 } },
      { detail: { loadL: 1 } },
      { detail: { loadObject: "bottle" } },
      { variant: "cuff" },
      { variant: "arm_only" },
      { position: "wheelchair" },
      { detail: { armrest: "in_place" } },
      { side: "left" },
      { detail: { view: "anterolateral" } },
      { setting: "booth" },
      { movementVersion: 2 },
    ],
    trunk_control_seated: [
      { position: "wheelchair" },
      { detail: { chair: "c2" } },
      { detail: { armrests: false } },
      { detail: { armMode: "hands_free" } },
      { detail: { legProsthesis: true } },
      { detail: { pivot: "fixed" } },
      { setting: "booth" },
      { poseModel: "lite" },
      { movementVersion: 2 },
      { side: "left" },
    ],
    chair_stand_30s: [
      { variant: "arms_assisted" },
      { variant: "one_arm_cross" },
      { detail: { chair: "c2" } },
      { detail: { armrests: true } },
      { detail: { footwear: "barefoot" } },
      { detail: { pdState: "unsure" } },
      { setting: "booth" },
      { movementVersion: 2 },
    ],
  };
  const recordedChanges: Record<TestId, Over[]> = {
    shoulder_abduction: [
      { detail: { faceCovered: true } },
      { flags: ["inconsistent"] },
      { created: T0 + DAY },
    ],
    arm_curl_30s: [
      { poseModel: "lite" },
      { detail: { compensated: 3 } },
      { detail: { countSource: "staff" } },
    ],
    trunk_control_seated: [{ detail: { contact: true } }, { detail: { cushion: "air" } }],
    chair_stand_30s: [
      { poseModel: "lite" },
      { detail: { pushHand: "left" } },
      { detail: { countSource: "self" } },
      { variant: "arms_assisted_steady", detail: {} },
    ],
  };
  const baseOver: Record<TestId, Over> = {
    shoulder_abduction: { side: "right", detail: { reference: "trunk" } },
    arm_curl_30s: {
      side: "right",
      detail: { loadKg: 1, loadObject: "dumbbell", armrest: "removed", view: "side" },
    },
    trunk_control_seated: {
      side: "right",
      detail: { chair: "c1", armrests: true, armMode: "light_touch", pivot: "hip" },
    },
    chair_stand_30s: { side: "none", detail: { chair: "c1", armrests: false, footwear: "shoes" } },
  };
  const make = (t: TestId, over: Over) => {
    const b = baseOver[t];
    return result(t, (over.side ?? b.side) as ResultSide, 10, {
      ...b,
      ...over,
      detail: { ...b.detail, ...over.detail },
    });
  };

  for (const t of Object.keys(blockingChanges) as TestId[]) {
    it(`${t}: each blocking field starts a new series`, () => {
      const k0 = make(t, {}).seriesKey;
      for (const over of blockingChanges[t])
        expect(make(t, over).seriesKey, JSON.stringify(over)).not.toBe(k0);
    });
    it(`${t}: recorded fields keep the series`, () => {
      const k0 = make(t, t === "chair_stand_30s" ? { variant: "arms_assisted" } : {}).seriesKey;
      for (const over of recordedChanges[t]) {
        const r = make(
          t,
          t === "chair_stand_30s" && !over.variant ? { variant: "arms_assisted", ...over } : over,
        );
        expect(r.seriesKey, JSON.stringify(over)).toBe(k0);
      }
    });
  }

  it("the hands allowed chair stand with the steady modifier is the same series as hands allowed", () => {
    const a = result("chair_stand_30s", "none", 10, { variant: "arms_assisted" });
    const b = result("chair_stand_30s", "none", 10, { variant: "arms_assisted_steady" });
    expect(a.seriesKey).toBe(b.seriesKey);
  });

  it("only the major version counts; a missing field matches only a missing field", () => {
    const a = result("shoulder_abduction", "left", 10, { movementVersion: 1 });
    expect(result("shoulder_abduction", "left", 10, { movementVersion: 1.4 }).seriesKey).toBe(a.seriesKey);
    const known = result("trunk_control_seated", "left", 10, { detail: { chair: "c1" } });
    const unknown = result("trunk_control_seated", "left", 10);
    expect(known.seriesKey).not.toBe(unknown.seriesKey);
  });

  it("is deterministic and cannot be spoofed by separators in a value", () => {
    const a = result("arm_curl_30s", "left", 10, { detail: { loadObject: "x|view=side" } });
    const b = result("arm_curl_30s", "left", 10, { detail: { loadObject: "x", view: "side" } });
    expect(a.seriesKey).not.toBe(b.seriesKey);
    expect(seriesKey(a)).toBe(a.seriesKey);
    expect(a.seriesKey.startsWith("arm_curl_30s|left|")).toBe(true);
  });

  it("throws for an unknown test", () => {
    expect(() => seriesKey({ ...result("arm_curl_30s", "left", 1), testId: "x" as TestId })).toThrow(
      RangeError,
    );
  });

  it("groups results by series, oldest first", () => {
    const a = result("arm_curl_30s", "left", 10, { created: T0 + 2 * DAY });
    const b = result("arm_curl_30s", "left", 12, { created: T0 });
    const c = result("arm_curl_30s", "left", 12, { created: T0 + DAY, setting: "booth" });
    const g = groupBySeries([a, b, c]);
    expect([...g.values()].map((s) => s.map((r) => r.created))).toEqual([[T0, T0 + 2 * DAY], [T0 + DAY]]);
  });
});

/* ------------------------------------------------------------------ bands */

describe("bands", () => {
  const abd = testDef("shoulder_abduction");
  const curl = testDef("arm_curl_30s");
  const trunk = testDef("trunk_control_seated");
  const stand = testDef("chair_stand_30s");

  it("abduction: 16 degrees, wide 20", () => {
    expect([bandOf(abd, 0, false), bandOf(abd, 170, false), bandOf(abd, 100, true)]).toEqual([16, 16, 20]);
  });

  it("arm curl: max(4, round(25%)), wide max(5, round(30%)), half rounds up", () => {
    const d = [0, 12, 16, 17, 18, 20, 30].map((b) => bandOf(curl, b, false));
    expect(d).toEqual([4, 4, 4, 4, 5, 5, 8]);
    const w = [0, 16, 17, 18, 19, 25, 30].map((b) => bandOf(curl, b, true));
    expect(w).toEqual([5, 5, 5, 5, 6, 8, 9]);
  });

  it("side lean: max(8, round(30%)), wide max(10, round(35%))", () => {
    const d = [0, 20, 27, 28, 29, 35].map((b) => bandOf(trunk, b, false));
    expect(d).toEqual([8, 8, 8, 8, 9, 11]);
    // 0.35 x 30 is exactly 10.5, which rounds up to 11.
    const w = [0, 28, 29, 30, 40].map((b) => bandOf(trunk, b, true));
    expect(w).toEqual([10, 10, 10, 11, 14]);
  });

  it("chair stand: 3 up to a baseline of 6, 4 from 7 to 15, 5 from 16; wide adds 1", () => {
    const d = [0, 6, 7, 15, 16, 30].map((b) => bandOf(stand, b, false));
    expect(d).toEqual([3, 3, 4, 4, 5, 5]);
    expect([6, 7, 16].map((b) => bandOf(stand, b, true))).toEqual([4, 5, 6]);
    expect(bandOf(stand, 6.5, false)).toBe(5);
  });

  it("check time band of a protocol item", () => {
    const ctx = { position: "chair" as const, support: "none" as const, conditions: ["none"], pain: [] };
    expect(checkTimeBand("shoulder_abduction", "left", ctx, null)).toBe("default");
    expect(checkTimeBand("shoulder_abduction", "left", { ...ctx, position: "wheelchair" }, null)).toBe(
      "wide",
    );
    expect(checkTimeBand("shoulder_abduction", "left", { ...ctx, support: "left" }, null)).toBe("wide");
    expect(checkTimeBand("shoulder_abduction", "right", { ...ctx, support: "left" }, null)).toBe("default");
    for (const c of ["stroke", "ms", "cerebral_palsy", "sci_complete", "sci_incomplete", "parkinsons"]) {
      expect(checkTimeBand("shoulder_abduction", "right", { ...ctx, conditions: [c] }, null)).toBe("wide");
    }
    expect(checkTimeBand("arm_curl_30s", "left", { ...ctx, conditions: ["stroke"] }, null)).toBe("default");
    const arthritis = { ...ctx, conditions: ["arthritis"], pain: ["elbow"] };
    expect(checkTimeBand("arm_curl_30s", "left", arthritis, { painSides: ["left"] })).toBe("wide");
    expect(checkTimeBand("arm_curl_30s", "right", arthritis, { painSides: ["left"] })).toBe("default");
    // Side not known yet: both arms (the safe reading).
    expect(checkTimeBand("arm_curl_30s", "right", arthritis, null)).toBe("wide");
    expect(
      checkTimeBand("trunk_control_seated", "left", { ...ctx, conditions: ["cerebral_palsy"] }, null),
    ).toBe("wide");
    expect(checkTimeBand("trunk_control_seated", "left", { ...ctx, conditions: ["ms"] }, null)).toBe(
      "default",
    );
    expect(checkTimeBand("chair_stand_30s", "none", { ...ctx, conditions: ["ms"] }, null)).toBe("wide");
    expect(checkTimeBand("chair_stand_30s", "none", { ...ctx, conditions: ["parkinsons"] }, null)).toBe(
      "default",
    );
  });

  it("painful arm: setup.painSides, or intake arm pain on both sides while the side is unknown", () => {
    expect(painfulArm("left", ctxOf({ setup: { painSides: ["left"] } }))).toBe(true);
    expect(painfulArm("right", ctxOf({ setup: { painSides: ["left"] } }))).toBe(false);
    expect(painfulArm("right", ctxOf({ pain: ["shoulder"], setup: null }))).toBe(true);
    expect(painfulArm("right", ctxOf({ pain: ["knee"], setup: null }))).toBe(false);
    expect(painfulArm("none", ctxOf({ pain: ["shoulder"], setup: null }))).toBe(false);
  });
});

/* -------------------------------------------------------- abduction */

describe("compareSeries: shoulder_abduction", () => {
  const abd = (points: (number | [number | null, Over])[], ctx = ctxOf(), common: Over = {}) =>
    compare("shoulder_abduction", "right", series("shoulder_abduction", "right", points, common), ctx);

  it("first check: starting point, no verdict, no trend", () => {
    const c = abd([100]);
    expect(c).toMatchObject({
      firstResult: true,
      verdict: null,
      change: null,
      band: 16,
      baseline: { value: 100 },
    });
    expect(c.points).toBeUndefined();
  });

  it("at or below the band reads same, one degree beyond reads higher or lower", () => {
    expect(said(abd([100, 116]))).toBe("same");
    expect(said(abd([100, 117]))).toBe("higher");
    expect(said(abd([100, 84]))).toBe("same");
    expect(said(abd([100, 83]))).toBe("lower");
    expect(abd([100, 117])).toMatchObject({ change: 17, band: 16 });
    expect(abd([100, 117]).repeatOffer).toBeUndefined();
    expect(abd([100, 83])).toMatchObject({ change: -17, repeatOffer: true });
  });

  it("worked examples of spec 5", () => {
    expect(said(abd([100, 114]))).toBe("same");
    expect(said(abd([100, [117, { median: 117 }]]))).toBe("higher");
  });

  it("agreement: the median must also be beyond the band, in the same direction", () => {
    expect(said(abd([100, [117, { median: 116 }]]))).toBe("same");
    expect(said(abd([100, [117, { median: 120 }]]))).toBe("higher");
    expect(said(abd([100, [83, { median: 84 }]]))).toBe("same");
    expect(said(abd([100, [83, { median: 83 }]]))).toBe("lower");
    expect(said(abd([100, [117, { median: null }]]))).toBe("same");
  });

  it("wide band of 20 for a wheelchair, the listed conditions, the weaker side, and flags at either check", () => {
    const wide = [
      [ctxOf({ position: "wheelchair" }), {}],
      [ctxOf({ conditions: ["sci_incomplete"] }), {}],
      [ctxOf({ support: "right" }), {}],
      [ctxOf(), { flags: ["inconsistent"] }],
      [ctxOf(), { flags: ["bentElbow"] }],
      [ctxOf(), { detail: { reference: "gravity" } }],
      [ctxOf(), { band: "wide" }],
      [ctxOf(), { position: "wheelchair" }],
    ] as [SeriesContext, Over][];
    for (const [ctx, common] of wide) {
      const at20 = abd([100, 120], ctx, common);
      expect(at20.band, JSON.stringify(common)).toBe(20);
      expect(said(at20)).toBe("same");
      expect(said(abd([100, 121], ctx, common))).toBe("higher");
    }
    // A flag at the baseline only still widens the band.
    expect(abd([[100, { flags: ["inconsistent"] }], 120]).band).toBe(20);
    // The other side of a person with a weaker right side keeps the default band.
    const left = compare(
      "shoulder_abduction",
      "left",
      series("shoulder_abduction", "left", [100, 117]),
      ctxOf({ support: "right" }),
    );
    expect(left.band).toBe(16);
  });

  it("no verdict on a painful shoulder side, start and now still shown", () => {
    const ctx = ctxOf({ pain: ["shoulder"], setup: { painSides: ["right"] } });
    const c = abd([100, 140], ctx);
    expect(c).toMatchObject({
      verdict: null,
      noVerdict: "shoulderPain",
      change: 40,
      baseline: { value: 100 },
    });
    const other = compare(
      "shoulder_abduction",
      "left",
      series("shoulder_abduction", "left", [100, 140]),
      ctx,
    );
    expect(said(other)).toBe("higher");
    // Side not known: both sides.
    expect(said(abd([100, 140], ctxOf({ pain: ["shoulder"], setup: null })))).toBe("noVerdict:shoulderPain");
  });

  it("no verdict with fewer than 2 valid attempts at either check", () => {
    expect(said(abd([[100, { nValid: 1 }], 140]))).toBe("noVerdict:oneValid");
    expect(said(abd([100, [140, { nValid: 1 }]]))).toBe("noVerdict:oneValid");
    expect(
      said(
        abd([
          [100, { nValid: 2 }],
          [140, { nValid: 2 }],
        ]),
      ),
    ).toBe("higher");
  });

  it("near full range: 160 or more at both checks", () => {
    expect(abd([160, 180])).toMatchObject({ verdict: null, nearFullRange: true });
    expect(abd([170, 160])).toMatchObject({ verdict: null, nearFullRange: true });
    expect(said(abd([159, 180]))).toBe("higher");
    expect(said(abd([160, 159]))).toBe("same");
  });

  it("large drop: more than twice the band shows the neutral text, exactly twice reads lower", () => {
    expect(said(abd([100, 68]))).toBe("lower");
    const c = abd([100, 67]);
    expect(c).toMatchObject({ verdict: null, largeDrop: true, repeatOffer: true, symptomDrop: true });
    expect(abd([100, 68]).symptomDrop).toBeUndefined();
  });

  it("a large drop repeated at the next check reads lower with the extra line", () => {
    expect(abd([100, 60, 62])).toMatchObject({ verdict: "lower", lowerExtra: true, repeatOffer: true });
    expect(abd([100, 60, 62]).largeDrop).toBeUndefined();
    // Recovered in between: the new drop shows the text again.
    expect(said(abd([100, 60, 100, 60]))).toBe("largeDrop");
    // The median does not agree: no lower verdict, the large drop text stays.
    expect(said(abd([100, 60, [62, { median: 90 }]]))).toBe("largeDrop");
  });

  it("a quality flag keeps the large drop text away and shows a no verdict sentence", () => {
    // Gravity reference also widens the band to 20, so the drop line is 40 below.
    const gravity = abd([100, 59], ctxOf(), { detail: { reference: "gravity" } });
    expect(gravity).toMatchObject({ verdict: null, noVerdict: "setupDiffers", symptomDrop: true });
    expect(gravity.largeDrop).toBeUndefined();
    expect(said(abd([100, [60, { nValid: 1 }]]))).toBe("noVerdict:oneValid");
    // A painful shoulder: its own sentence, still a candidate for the symptom question.
    const pain = abd([100, 40], ctxOf({ setup: { painSides: ["right"] } }));
    expect(pain).toMatchObject({ noVerdict: "shoulderPain", symptomDrop: true });
  });

  it("trends only from the third check; not measured results are left out", () => {
    expect(abd([100, 110]).points).toBeUndefined();
    expect(abd([100, 110, 120]).points?.map((p) => p.value)).toEqual([100, 110, 120]);
    const c = abd([100, [null, {}], 110]);
    expect(c.points).toBeUndefined();
    expect(c.previous?.value).toBe(100);
    expect(
      compareSeries(
        testDef("shoulder_abduction"),
        "right",
        series("shoulder_abduction", "right", [[null, {}]]),
        ctxOf(),
      ),
    ).toBeNull();
    expect(compareSeries(testDef("shoulder_abduction"), "right", [], ctxOf())).toBeNull();
  });

  it("sorts by time and refuses mixed series, tests or sides", () => {
    const rows = series("shoulder_abduction", "right", [100, 120]);
    expect(said(compare("shoulder_abduction", "right", [rows[1], rows[0]]))).toBe("higher");
    const other = result("shoulder_abduction", "right", 100, { poseModel: "lite" });
    expect(() => compare("shoulder_abduction", "right", [rows[0], other])).toThrow(RangeError);
    expect(() => compare("shoulder_abduction", "left", rows)).toThrow(RangeError);
    expect(() => compare("arm_curl_30s", "right", rows)).toThrow(RangeError);
  });
});

/* -------------------------------------------------------------- arm curl */

describe("compareSeries: arm_curl_30s", () => {
  const curl = (points: (number | [number | null, Over])[], ctx = ctxOf(), common: Over = {}) =>
    compare("arm_curl_30s", "left", series("arm_curl_30s", "left", points, common), ctx);

  it("band max(4, 25%) at the boundary", () => {
    expect(said(curl([12, 16]))).toBe("same");
    expect(said(curl([12, 17]))).toBe("higher");
    expect(said(curl([12, 8]))).toBe("same");
    expect(said(curl([12, 7]))).toBe("lower");
    // 25% of 20 is 5.
    expect(curl([20, 25])).toMatchObject({ band: 5, verdict: "same" });
    expect(said(curl([20, 26]))).toBe("higher");
  });

  it("worked examples of spec 5", () => {
    expect(said(curl([12, 15]))).toBe("same");
    expect(said(curl([12, 17]))).toBe("higher");
  });

  it("wide max(5, 30%) for MS, Parkinson's, arthritis with pain on this arm, and a pose model change", () => {
    for (const ctx of [
      ctxOf({ conditions: ["ms"] }),
      ctxOf({ conditions: ["parkinsons"] }),
      ctxOf({ conditions: ["arthritis"], setup: { painSides: ["left"] } }),
    ]) {
      expect(curl([12, 17], ctx)).toMatchObject({ band: 5, verdict: "same" });
      expect(said(curl([12, 18], ctx))).toBe("higher");
    }
    expect(curl([12, 17], ctxOf({ conditions: ["arthritis"], setup: { painSides: ["right"] } })).band).toBe(
      4,
    );
    const model = curl([
      [12, { poseModel: "lite" }],
      [17, { poseModel: "full" }],
    ]);
    expect(model).toMatchObject({ band: 5, verdict: "same", bandKind: "wide" });
  });

  it("no verdict with range_below_baseline, and never the large drop text", () => {
    const c = curl([12, [2, { flags: ["range_below_baseline"] }]]);
    expect(c).toMatchObject({ verdict: null, noVerdict: "setupDiffers", symptomDrop: true });
    expect(c.largeDrop).toBeUndefined();
  });

  it("compensated share: a difference of 25 points or less keeps the verdict, more gives none", () => {
    expect(
      said(
        curl([
          [20, { detail: { compensated: 0 } }],
          [26, { detail: { compensated: 6.5 } }],
        ]),
      ),
    ).toBe("higher");
    expect(
      said(
        curl([
          [20, { detail: { compensated: 0 } }],
          [20, { detail: { compensated: 5 } }],
        ]),
      ),
    ).toBe("same");
    expect(
      said(
        curl([
          [20, { detail: { compensated: 0 } }],
          [20, { detail: { compensated: 6 } }],
        ]),
      ),
    ).toBe("noVerdict:movementDifferent");
    // Not known (hips hidden): the rule cannot hold, no verdict.
    expect(
      said(
        curl([
          [20, { detail: {} }],
          [26, { detail: {} }],
        ]),
      ),
    ).toBe("noVerdict:setupDiffers");
  });

  it("a self count is never a baseline and never gets a verdict", () => {
    expect(said(curl([12, [20, { detail: { compensated: 0, countSource: "self" } }]]))).toBe(
      "noVerdict:selfCount",
    );
    const c = curl([[10, { detail: { compensated: 0, countSource: "self" } }], 12, 17]);
    expect(c).toMatchObject({ baseline: { value: 12 }, verdict: "higher", change: 5 });
  });

  it("large drop beyond twice the band", () => {
    expect(said(curl([12, 4]))).toBe("lower");
    expect(curl([12, 3])).toMatchObject({ largeDrop: true, verdict: null, symptomDrop: true });
    expect(curl([12, 3, 2])).toMatchObject({ verdict: "lower", lowerExtra: true });
    // More than 10 percent of the trial unscored: a quality flag.
    expect(said(curl([12, [3, { detail: { compensated: 0, unscoredShare: 0.15 } }]]))).toBe(
      "noVerdict:setupDiffers",
    );
    expect(said(curl([12, [3, { detail: { compensated: 0, unscoredShare: 0.1 } }]]))).toBe("largeDrop");
  });
});

/* -------------------------------------------------------------- side lean */

describe("compareSeries: trunk_control_seated", () => {
  const lean = (points: (number | [number | null, Over])[], ctx = ctxOf(), common: Over = {}) =>
    compare("trunk_control_seated", "left", series("trunk_control_seated", "left", points, common), ctx);

  it("worked example of spec 5: 18 and 22 set 20; 29 unconfirmed; then 30 confirmed higher", () => {
    expect(said(lean([18]))).toBe("firstResult");
    expect(lean([18, 22])).toMatchObject({
      startingPointSet: true,
      baseline: { value: 20 },
      band: 8,
      verdict: null,
    });
    expect(lean([18, 22, 29])).toMatchObject({ verdict: "same", unconfirmed: true, change: 9, band: 8 });
    expect(lean([18, 22, 29, 30])).toMatchObject({ verdict: "higher", change: 10 });
    expect(lean([18, 22, 29, 30]).unconfirmed).toBeUndefined();
  });

  it("the mean of this and the previous check must be beyond the band, not at it", () => {
    // Baseline 20, band 8: 27 and 29 have a mean of 28, exactly 8 above: unconfirmed.
    expect(said(lean([18, 22, 27, 29]))).toBe("same unconfirmed");
    // 28 and 29: a mean of 28.5, beyond: confirmed.
    expect(said(lean([18, 22, 28, 29]))).toBe("higher");
    expect(said(lean([18, 22, 13, 11]))).toBe("same unconfirmed");
    expect(said(lean([18, 22, 13, 10]))).toBe("lower");
    expect(said(lean([18, 22, 14, 10]))).toBe("same unconfirmed");
  });

  it("at the band boundary: 8 above reads same without the unconfirmed sentence", () => {
    const c = lean([18, 22, 28]);
    expect(c).toMatchObject({ verdict: "same", change: 8 });
    expect(c.unconfirmed).toBeUndefined();
  });

  it("the confirmation mean is compared exactly; the baseline mean is rounded to whole degrees", () => {
    // Baseline 20.5 rounds to 21 (band 8): 30 is beyond, the mean of 30 and 30 too.
    expect(lean([20, 21, 30, 30])).toMatchObject({ baseline: { value: 21 }, verdict: "higher", change: 9 });
    // Mean of 25 and 30 is 27.5, 6.5 above 21: not beyond, so unconfirmed.
    expect(lean([20, 21, 25, 30])).toMatchObject({ verdict: "same", unconfirmed: true });
  });

  it("lower needs the confirmation too", () => {
    expect(lean([18, 22, 11])).toMatchObject({ verdict: "same", unconfirmed: true, change: -9 });
    expect(lean([18, 22, 11, 10])).toMatchObject({ verdict: "lower", repeatOffer: true });
    expect(lean([18, 22, 12, 12])).toMatchObject({ verdict: "same", change: -8 });
  });

  it("band max(8, 30%) of the two check baseline; wide for Parkinson's, CP and upright_unsteady", () => {
    expect(lean([30, 30, 39])).toMatchObject({ band: 9, verdict: "same" });
    expect(lean([30, 30, 40, 40])).toMatchObject({ band: 9, verdict: "higher" });
    expect(lean([30, 30, 41, 41], ctxOf({ conditions: ["parkinsons"] }))).toMatchObject({
      band: 11,
      verdict: "same",
    });
    expect(lean([30, 30, 42, 42], ctxOf({ conditions: ["cerebral_palsy"] }))).toMatchObject({
      band: 11,
      verdict: "higher",
    });
    expect(lean([[30, { flags: ["upright_unsteady"] }], 30, 41, 41])).toMatchObject({
      band: 11,
      verdict: "same",
    });
  });

  it("censoring and armrest contact", () => {
    // A censored best above the band may read higher, shown as more than the value.
    expect(
      lean([20, 20, [30, { detail: { censored: true } }], [30, { detail: { censored: true } }]]),
    ).toMatchObject({
      verdict: "higher",
      latest: { censored: true },
    });
    // Within the band: about the same, shown as more than the value.
    expect(lean([20, 20, [22, { detail: { censored: true } }]])).toMatchObject({
      verdict: "same",
      latest: { censored: true },
    });
    // A censored best never reads lower.
    expect(said(lean([20, 20, 10, [10, { detail: { censored: true } }]]))).toBe("noVerdict:censored");
    // A censored baseline: values only.
    expect(said(lean([[20, { detail: { censored: true } }], 20, 40, 40]))).toBe("noVerdict:censored");
    // Contact now: cannot read higher.
    expect(said(lean([20, 20, 30, [30, { detail: { contact: true } }]]))).toBe("noVerdict:chairLimit");
    // Contact at the baseline and now: the chair limits the lean.
    expect(said(lean([[20, { detail: { contact: true } }], 20, [21, { detail: { contact: true } }]]))).toBe(
      "noVerdict:chairLimit",
    );
    // Contact at the baseline only: a censored baseline, the chair sentence.
    expect(said(lean([20, [20, { detail: { contact: true } }], 20]))).toBe("noVerdict:chairLimit");
    // A censored previous check never confirms a lower verdict.
    expect(said(lean([20, 20, [10, { detail: { censored: true } }], 10]))).toBe("same unconfirmed");
  });

  it("no verdict with one valid attempt or arm support on the best attempt", () => {
    expect(said(lean([[20, { nValid: 1 }], 20, 40, 40]))).toBe("noVerdict:oneValid");
    expect(said(lean([20, 20, 40, [40, { nValid: 1 }]]))).toBe("noVerdict:oneValid");
    expect(said(lean([20, 20, 40, [40, { flags: ["arm_support_likely"] }]]))).toBe(
      "noVerdict:movementDifferent",
    );
  });

  it("large drop: shown as text, confirmed as lower with the extra line when it repeats", () => {
    // Baseline 20, band 8: the drop line is 16 below.
    expect(said(lean([20, 20, 4, 4]))).toBe("lower");
    expect(lean([20, 20, 3])).toMatchObject({ largeDrop: true, verdict: null, symptomDrop: true });
    expect(lean([20, 20, 3, 3])).toMatchObject({ verdict: "lower", lowerExtra: true });
    // A low second baseline check was never shown as a large drop, so it does not count as the
    // first of two: baseline mean 22, band 8, the third check shows the large drop text.
    expect(lean([40, 4, 3])).toMatchObject({ largeDrop: true, verdict: null, baseline: { value: 22 } });
  });

  it("second check: a large drop against the first check still feeds the symptom question", () => {
    expect(lean([20, 3])).toMatchObject({ startingPointSet: true, symptomDrop: true, verdict: null });
    expect(lean([20, 4]).symptomDrop).toBeUndefined();
  });
});

/* ----------------------------------------------------------- chair stand */

describe("compareSeries: chair_stand_30s", () => {
  const stand = (points: (number | [number | null, Over])[], ctx = ctxOf(), common: Over = {}) =>
    compare("chair_stand_30s", "none", series("chair_stand_30s", "none", points, common), ctx);

  it("worked examples of spec 5", () => {
    expect(said(stand([12, 15]))).toBe("same");
    expect(said(stand([12, 17]))).toBe("higher");
  });

  it("bands by baseline bucket, each at the boundary", () => {
    expect(stand([6, 9])).toMatchObject({ band: 3, verdict: "same" });
    expect(said(stand([6, 10]))).toBe("higher");
    expect(stand([7, 11])).toMatchObject({ band: 4, verdict: "same" });
    expect(said(stand([7, 12]))).toBe("higher");
    expect(stand([15, 11])).toMatchObject({ band: 4, verdict: "same" });
    expect(said(stand([15, 10]))).toBe("lower");
    expect(stand([16, 21])).toMatchObject({ band: 5, verdict: "same" });
    expect(said(stand([16, 22]))).toBe("higher");
  });

  it("wide adds 1: MS, a push hand change, a pose model change", () => {
    expect(stand([12, 17], ctxOf({ conditions: ["ms"] }))).toMatchObject({ band: 5, verdict: "same" });
    expect(said(stand([12, 18], ctxOf({ conditions: ["ms"] })))).toBe("higher");
    const push = stand(
      [
        [12, { detail: { pushHand: "left" } }],
        [17, { detail: { pushHand: "right" } }],
      ],
      ctxOf(),
      {
        variant: "arms_assisted",
      },
    );
    expect(push).toMatchObject({ band: 5, verdict: "same" });
    expect(stand([[12, { poseModel: "lite" }], 17])).toMatchObject({ band: 5, verdict: "same" });
    expect(
      stand([
        [12, { detail: { pushHand: "left" } }],
        [17, { detail: { pushHand: "left" } }],
      ]).band,
    ).toBe(4);
  });

  it("no verdict with range_mismatch (and no large drop text) or a self count", () => {
    const c = stand([20, [5, { flags: ["range_mismatch"] }]]);
    expect(c).toMatchObject({ verdict: null, noVerdict: "setupDiffers", symptomDrop: true });
    expect(c.largeDrop).toBeUndefined();
    expect(said(stand([12, [20, { detail: { countSource: "self" } }]]))).toBe("noVerdict:selfCount");
    expect(said(stand([12, [20, { detail: { countSource: "staff" } }]]))).toBe("higher");
  });

  it("a self count at the first check is not the starting point", () => {
    expect(stand([[10, { detail: { countSource: "self" } }]])).toMatchObject({
      noVerdict: "selfCount",
      baseline: null,
      verdict: null,
    });
    expect(stand([[10, { detail: { countSource: "self" } }], 12])).toMatchObject({
      firstResult: true,
      baseline: { value: 12 },
    });
  });

  it("large drop beyond twice the band", () => {
    expect(said(stand([20, 10]))).toBe("lower");
    expect(said(stand([20, 9]))).toBe("largeDrop");
    expect(said(stand([20, 9, 9]))).toBe("lower lowerExtra");
  });
});

/* ------------------------------------------------------- across series */

describe("the one sided symptom question (spec 5)", () => {
  const cmp = (side: "left" | "right", values: number[]) =>
    compare("shoulder_abduction", side, series("shoulder_abduction", side, values));

  it("asks for a drop on one side only", () => {
    expect(symptomAskSides({ left: cmp("left", [100, 60]), right: cmp("right", [100, 100]) })).toEqual([
      "left",
    ]);
    expect(symptomAskSides({ left: cmp("left", [100, 60]) })).toEqual(["left"]);
    expect(symptomAskSides({ left: cmp("left", [100, 60]), right: null })).toEqual(["left"]);
  });

  it("does not ask when the other side is lower too, or nothing dropped", () => {
    expect(symptomAskSides({ left: cmp("left", [100, 60]), right: cmp("right", [100, 60]) })).toEqual([]);
    expect(symptomAskSides({ left: cmp("left", [100, 60]), right: cmp("right", [100, 80]) })).toEqual([]);
    expect(symptomAskSides({ left: cmp("left", [100, 90]), right: cmp("right", [100, 100]) })).toEqual([]);
    expect(symptomAskSides({})).toEqual([]);
  });

  it("asks whatever the quality flags", () => {
    const flagged = compare(
      "shoulder_abduction",
      "left",
      series("shoulder_abduction", "left", [100, [60, { nValid: 1 }]]),
    );
    expect(flagged.noVerdict).toBe("oneValid");
    expect(symptomAskSides({ left: flagged, right: cmp("right", [100, 100]) })).toEqual(["left"]);
  });
});

describe("not comparable and milestones", () => {
  it("a changed blocking field starts a new series; booth then home does not", () => {
    const a = result("arm_curl_30s", "left", 12, { created: T0, detail: { loadKg: 1 } });
    const b = result("arm_curl_30s", "left", 14, { created: T0 + DAY, detail: { loadKg: 2 } });
    const c = result("arm_curl_30s", "left", 15, { created: T0 + 2 * DAY, detail: { loadKg: 2 } });
    expect(startsNewSeries([a, b])).toBe(true);
    expect(startsNewSeries([a, b, c])).toBe(false);
    expect(startsNewSeries([a])).toBe(false);
    expect(startsNewSeries([])).toBe(false);
    const booth = result("arm_curl_30s", "left", 12, { created: T0, setting: "booth" });
    const home = result("arm_curl_30s", "left", 12, { created: T0 + DAY });
    expect(startsNewSeries([booth, home])).toBe(false);
    // Not measured results do not count.
    expect(startsNewSeries([a, { ...b, value: null }])).toBe(false);
  });

  it("the chair stand milestone is hands allowed to standard", () => {
    expect(chairStandMilestone("arms_assisted", "standard")).toBe(true);
    expect(chairStandMilestone("arms_assisted_steady", "standard")).toBe(true);
    expect(chairStandMilestone("standard", "arms_assisted")).toBe(false);
    expect(chairStandMilestone(undefined, "standard")).toBe(false);
  });
});

/* ---------------------------------------------------------------- property */

describe("property: verdicts", () => {
  it("are only higher, same or lower, and agree with change and band", () => {
    const r = rng(5050);
    const tests: TestId[] = ["shoulder_abduction", "arm_curl_30s", "trunk_control_seated", "chair_stand_30s"];
    let judged = 0;
    for (let n = 0; n < 2000; n++) {
      const t = r.pick(tests);
      const side: ResultSide = t === "chair_stand_30s" ? "none" : r.pick(["left", "right"] as const);
      const max = testDef(t).unit === "deg" ? 180 : 40;
      const count = 1 + r.int(5);
      const points = Array.from({ length: count }, () => {
        const v = r.int(max + 1);
        const over: Over = {};
        if (r.next() < 0.1) over.nValid = 1;
        if (r.next() < 0.1) over.flags = [r.pick(Object.values(RESULT_FLAGS))];
        if (r.next() < 0.1) over.detail = { censored: true };
        if (t === "arm_curl_30s") over.detail = { ...over.detail, compensated: r.int(Math.max(1, v)) };
        if (r.next() < 0.3) over.median = Math.max(0, v - r.int(20));
        return [v, over] as [number, Over];
      });
      const ctx = ctxOf({
        conditions: [r.pick(["none", "ms", "parkinsons", "stroke", "arthritis", "cerebral_palsy"])],
        support: r.pick(["none", "left", "right"] as const),
        setup: r.next() < 0.3 ? { painSides: [r.pick(["left", "right"] as const)] } : {},
      });
      const c = compare(t, side, series(t, side, points), ctx);
      expect([null, "higher", "same", "lower"]).toContain(c.verdict);
      expect(JSON.stringify(c)).not.toMatch(/better/);
      if (c.verdict === null || c.change === null) continue;
      judged++;
      expect(c.change).toBe(c.latest.value - (c.baseline as { value: number }).value);
      if (c.verdict === "higher") expect(c.change).toBeGreaterThan(c.band);
      if (c.verdict === "lower") expect(c.change).toBeLessThan(-c.band);
      if (Math.abs(c.change) <= c.band) expect(c.verdict).toBe("same");
      if (c.lowerExtra) expect(c.verdict).toBe("lower");
      if (c.points) expect(c.points.length).toBeGreaterThanOrEqual(3);
    }
    expect(judged).toBeGreaterThan(300);
  });
});

/* ------------------------------------------------- review round 2 fixes */

describe("side lean armrest contact not answered (SPEC-GAP contact-unknown)", () => {
  const lean = (points: (number | [number | null, Over])[]) =>
    compare("trunk_control_seated", "left", series("trunk_control_seated", "left", points));
  const unknown: Over = { detail: { contact: "unknown" }, flags: ["contact_unknown"] };

  it("a baseline with unknown contact is possibly censored: values only", () => {
    expect(said(lean([[16, unknown], [16, unknown], 30, 30]))).toBe("noVerdict:chairLimit");
    expect(said(lean([20, [16, unknown], 30, 30]))).toBe("noVerdict:chairLimit");
  });

  it("unknown contact today cannot read higher or lower", () => {
    expect(said(lean([20, 20, [30, unknown], [30, unknown]]))).toBe("noVerdict:chairLimit");
    expect(said(lean([30, 30, [16, unknown], [16, unknown]]))).toBe("noVerdict:chairLimit");
    // Not the large drop text either, nor lower with the extra line.
    const drop = lean([30, 30, [8, unknown], [8, unknown]]);
    expect(said(drop)).toBe("noVerdict:chairLimit");
    expect(drop.largeDrop).toBeUndefined();
    expect(drop.lowerExtra).toBeUndefined();
  });

  it("within the band it reads about the same, and the values are not shown as more than", () => {
    const c = lean([20, 20, [22, unknown]]);
    expect(said(c)).toBe("same");
    expect(c.latest.censored).toBeUndefined();
  });

  it("an unknown previous check never confirms a lower verdict", () => {
    expect(said(lean([20, 20, [10, unknown], 10]))).toBe("same unconfirmed");
  });
});
