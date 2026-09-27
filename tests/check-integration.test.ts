/**
 * Integration of the engine runners (src/engine/modes, contract v2 F) with the movement check API
 * (server/modules/assessments and progress, contract v2 E): real runner results on generated
 * landmark recordings, mapped to the result body the check screen posts, pass the server's
 * validation, are stored against the frozen protocol, and come back through GET /api/progress and
 * the baseline ranges of GET /api/assessments/context (D-009), which the next timed count runs on.
 *
 * The two sides were built in separate branches; these tests hold their shared shapes together:
 * detail keys and values, flags, the quality summary, the attempt shape and the variants.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ArmCurlRunner,
  ChairStandRunner,
  RangeTestRunner,
  TrunkControlRunner,
  type SideResult,
  type TestSide,
} from "../src/engine/modes";
import type { ProtocolItem } from "../src/medical/assessment";
import { testDef } from "../src/movements/assessments";
import type { TestId } from "../src/movements/types";
import { checkResult, DETAIL_SPEC } from "../server/modules/assessments/validate";
import { DEVICE, intakeOf, itemOf, member, start, startApi, type Harness } from "./check-api-harness";
import {
  framesOf,
  HANDS_ON_THIGHS,
  leanOrder,
  leans,
  leanStarts,
  raises,
  raiseStarts,
  run,
  spec,
} from "./fixtures/runners";
import {
  CROSSED,
  curlPractice,
  curlTrial,
  drive,
  FAST,
  standPractice,
  standTrial,
  twoPass,
} from "./fixtures/timed";

/* ------------------------------------------------------------ the mapping */

/** The fingerprint answers the check screen adds to a result (the setup questions of each test). */
const SETUP_DETAIL: Record<TestId, Record<string, unknown>> = {
  shoulder_abduction: {},
  arm_curl_30s: { loadObject: "none", armrest: "removed" },
  trunk_control_seated: { armMode: "thighs", armrests: false, sameChair: true },
  chair_stand_30s: { footwear: "shoes", armrests: false, sameChair: true },
};

/**
 * The result body the check screen posts for one side of a runner's TestResult (contract v2 E). An
 * engine AttemptRecord becomes the API attempt { value, valid, durationSec, flags }. A side that was
 * not measured posts its reason with no score; a stopped side is never posted by this helper.
 */
function toResultBody(r: SideResult, item: ProtocolItem, setup: Record<string, unknown> = {}) {
  const measured = r.status === "measured";
  return {
    testId: r.testId,
    side: r.side,
    value: measured ? r.value : null,
    unit: r.unit,
    attempts: measured
      ? r.attempts.map((a) => ({
          value: a.value,
          valid: a.outcome === "valid",
          durationSec: Math.round((a.t1 - a.t0) / 100) / 10,
          flags: a.flags,
        }))
      : [],
    quality: r.quality,
    detail: { ...r.detail, ...setup },
    flags: r.flags,
    nValid: measured ? r.nValid : 0,
    median: measured ? r.median : null,
    skippedReason: measured ? null : r.reason,
    variant: r.variant ?? null,
    poseModel: DEVICE.model,
    movementVersion: item.version,
    engineVersion: DEVICE.engineVersion,
  };
}

/* ---------------------------------------------------------- runner results */

function raiseResult(side: "left" | "right", peak: number, seed: number): SideResult {
  const starts = raiseStarts(4);
  const { frames } = framesOf(
    spec("shoulder_abduction", "chair", "9:16", raises(side, peak, starts), starts[3] + 12, seed),
  );
  const r = run(new RangeTestRunner(testDef("shoulder_abduction"), side, {}), frames, { rollDeg: 0 });
  return r.side(side);
}

function leanResults(peak: number, seed: number): SideResult[] {
  const order = leanOrder("right");
  const { frames } = framesOf(
    spec("trunk_control_seated", "chair", "9:16", leans(order, peak), leanStarts(8)[7] + 9, seed, {
      wheelchairHips: "visible",
      subject: { arms: HANDS_ON_THIGHS },
    }),
  );
  return run(new TrunkControlRunner(testDef("trunk_control_seated"), "none", {}), frames, { rollDeg: 0 })
    .result.results;
}

function curlResult(side: "left" | "right", seed: number) {
  const k = twoPass({
    test: "arm_curl_30s",
    profile: "chair",
    aspect: "9:16",
    seed,
    side,
    practice: curlPractice(side),
    trial: (go) => curlTrial(side, go, seed),
    opts: { variant: "arm_only" },
  });
  return { k, res: k.run.result.results[0] };
}

function standResult(seed: number) {
  const k = twoPass({
    test: "chair_stand_30s",
    profile: "chair",
    aspect: "9:16",
    seed,
    practice: standPractice(),
    trial: (go) => standTrial(go, seed),
    extra: { subject: { arms: CROSSED } },
  });
  return { k, res: k.run.result.results[0] };
}

/** One run of every test, shared by the tests below (the recordings take a moment to generate). */
let RAISE_R: SideResult;
let RAISE_L: SideResult;
let LEAN: SideResult[];
let CURL: ReturnType<typeof curlResult>;
let STAND: ReturnType<typeof standResult>;

beforeAll(() => {
  RAISE_R = raiseResult("right", 150, 901);
  RAISE_L = raiseResult("left", 140, 902);
  LEAN = leanResults(20, 903);
  CURL = curlResult("right", 904);
  STAND = standResult(905);
});

const byTest = (): SideResult[] => [RAISE_R, RAISE_L, ...LEAN, CURL.res, STAND.res];

function itemFor(r: SideResult, variant?: ProtocolItem["variant"]): ProtocolItem {
  const item: ProtocolItem = {
    testId: r.testId,
    side: r.side as TestSide,
    version: testDef(r.testId).version,
    order: 1,
    band: "default",
  };
  if (variant) item.variant = variant;
  else if (r.testId === "chair_stand_30s") item.variant = "standard";
  return item;
}

/* ------------------------------------------------------------- the shapes */

describe("engine results fit the result body the server accepts", () => {
  it("every runner measured its sides on the recordings", () => {
    for (const r of byTest()) {
      expect(r.status, `${r.testId}:${r.side}`).toBe("measured");
      expect(r.value, `${r.testId}:${r.side}`).not.toBeNull();
    }
  });

  it("every detail key the engine writes has a server check, and every value passes it", () => {
    for (const r of byTest()) {
      for (const [k, v] of Object.entries(r.detail)) {
        const check = DETAIL_SPEC[k];
        expect(check, `${r.testId} detail.${k} has no server check`).toBeTypeOf("function");
        expect(check(v), `${r.testId} detail.${k} = ${JSON.stringify(v)}`).toBe(true);
      }
    }
  });

  it("a measured side posts as a valid result of its protocol item", () => {
    for (const r of byTest()) {
      const item = itemFor(r, r.testId === "arm_curl_30s" ? "arm_only" : undefined);
      const body = toResultBody(r, item, SETUP_DETAIL[r.testId]);
      const checked = checkResult(body, { item, setting: "home", conditions: [] });
      expect(checked, `${r.testId}:${r.side} ${JSON.stringify(checked)}`).toMatchObject({ ok: true });
      if (!checked.ok) continue;
      expect(checked.value.value).toBe(r.value);
      expect(checked.value.nValid).toBe(r.nValid);
      expect(checked.value.variant).toBe(r.variant ?? null);
    }
  });

  it("a chair stand run in another variant than its frozen protocol item is refused", () => {
    const item = itemFor(STAND.res, "arms_assisted");
    const checked = checkResult(toResultBody(STAND.res, item, SETUP_DETAIL.chair_stand_30s), {
      item,
      setting: "home",
      conditions: [],
    });
    // The engine ran the standard version; a hands allowed protocol item refuses it.
    expect(checked).toEqual({ ok: false, field: "variant" });
  });

  // The reasons the runners give a side they could not measure (rangeTest.ts, trunkControl.ts,
  // timedCount.ts): each one is a skip reason the client may post (validate.ts CLIENT_SKIP_REASONS).
  const ENGINE_REASONS = [
    ["shoulder_abduction", "quality", () => RAISE_R],
    ["trunk_control_seated", "quality", () => LEAN[0]],
    ["arm_curl_30s", "quality", () => CURL.res],
    ["chair_stand_30s", "quality", () => STAND.res],
    ["chair_stand_30s", "needed_arms", () => STAND.res],
    ["chair_stand_30s", "needed_support", () => STAND.res],
  ] as const;

  for (const [testId, reason, of] of ENGINE_REASONS)
    it(`a ${testId} side the engine could not measure posts ${reason} with no score`, () => {
      const r = of();
      const notMeasured: SideResult = {
        ...r,
        status: "not_measured",
        reason,
        value: null,
        median: null,
        nValid: 0,
      };
      const item = itemFor(notMeasured, r.testId === "arm_curl_30s" ? "arm_only" : undefined);
      const checked = checkResult(toResultBody(notMeasured, item, SETUP_DETAIL[r.testId]), {
        item,
        setting: "home",
        conditions: [],
      });
      expect(checked, `${r.testId} ${JSON.stringify(checked)}`).toMatchObject({
        ok: true,
        value: { skippedReason: reason, value: null, attempts: [] },
      });
    });
});

/* ------------------------------------------------------------ through the API */

describe("engine results through the API", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  const PERSONAS = [
    {
      name: "a seated person",
      intake: intakeOf(),
      expect: ["shoulder_abduction", "trunk_control_seated", "arm_curl_30s"],
    },
    { name: "a standing person", intake: intakeOf({ mobility: "standing" }), expect: ["chair_stand_30s"] },
  ];

  PERSONAS.forEach((p, i) =>
    it(`stores every measured side of ${p.name} and shows it as the starting point in progress`, async () => {
      const cookie = await member(h, `engine-api-${i}@example.com`, p.intake);
      const s = await start(h, cookie);
      expect(s.status, JSON.stringify(s.data)).toBe(200);
      const protocol: ProtocolItem[] = s.data.protocol;
      const posted: SideResult[] = [];
      for (const item of protocol) {
        if (item.skipped) continue;
        const r = byTest().find((x) => x.testId === item.testId && x.side === item.side);
        if (!r) continue;
        const body = toResultBody(r, item, SETUP_DETAIL[r.testId]);
        const saved = await h.call(`/assessments/${s.data.id}/results`, body, cookie);
        expect(saved.status, `${item.testId}:${item.side} ${JSON.stringify(saved.data)}`).toBe(200);
        posted.push(r);
      }
      expect([...new Set(posted.map((r) => r.testId))]).toEqual(expect.arrayContaining(p.expect));
      await completeAndCompare(cookie, s.data.id, posted);
    }),
  );

  async function completeAndCompare(cookie: string, id: string, posted: SideResult[]) {
    const done = await h.call(`/assessments/${id}/complete`, {}, cookie);
    expect(done.status, JSON.stringify(done.data)).toBe(200);

    const progress = await h.call("/progress", undefined, cookie);
    expect(progress.status).toBe(200);
    for (const r of posted) {
      const series = progress.data.tests.find(
        (t: { testId: string; side: string }) => t.testId === r.testId && t.side === r.side,
      );
      expect(series, `${r.testId}:${r.side} in progress`).toBeDefined();
      expect(series.baseline.value).toBe(r.value);
    }
  }

  const TIMED = [
    {
      testId: "arm_curl_30s" as const,
      intake: () => intakeOf(),
      run: () => CURL,
      next: (range: [number, number]) =>
        new ArmCurlRunner(testDef("arm_curl_30s"), CURL.res.side as "left" | "right", {
          ...FAST,
          variant: "arm_only",
          fixedRange: range,
        }),
      belowFlag: "range_below_baseline",
    },
    {
      testId: "chair_stand_30s" as const,
      intake: () => intakeOf({ mobility: "standing" }),
      run: () => STAND,
      next: (range: [number, number]) =>
        new ChairStandRunner(testDef("chair_stand_30s"), "none", { ...FAST, fixedRange: range }),
      belowFlag: "range_mismatch",
    },
  ];

  TIMED.forEach((c, i) =>
    it(`gives the ${c.testId} baseline range back for the next check, and the runner counts against it`, async () => {
      const { k, res: base } = c.run();
      const cookie = await member(h, `engine-range-${i}@example.com`, c.intake());
      const s = await start(h, cookie);
      expect(s.status, JSON.stringify(s.data)).toBe(200);
      const item = itemOf(s.data.protocol, c.testId, base.side);
      const body = toResultBody(base, item, SETUP_DETAIL[c.testId]);
      const saved = await h.call(`/assessments/${s.data.id}/results`, body, cookie);
      expect(saved.status, JSON.stringify(saved.data)).toBe(200);
      expect((await h.call(`/assessments/${s.data.id}/complete`, {}, cookie)).status).toBe(200);

      const ctx = await h.call("/assessments/context", undefined, cookie);
      expect(ctx.status).toBe(200);
      const ranges = Object.entries(ctx.data.baselineRanges as Record<string, [number, number]>).filter(
        ([key]) => key.startsWith(`${c.testId}|${base.side}|`),
      );
      expect(ranges).toHaveLength(1);
      const range = ranges[0][1];
      expect(range).toEqual([base.detail.rangeLo, base.detail.rangeHi]);

      // D-009: the next check, on the same recording, counts against the stored baseline range.
      const next = drive(c.next(range), k.frames).result.results[0];
      expect(next.status).toBe("measured");
      expect(Math.abs(next.value! - base.value!)).toBeLessThanOrEqual(1);
      expect(next.flags).not.toContain(c.belowFlag);
    }),
  );
});
