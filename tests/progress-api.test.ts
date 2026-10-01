/**
 * GET /api/progress (contract v2 E; clinical spec 5): each series against the person's own starting
 * point through the API, over several checks (the worked side lean example, a load change that
 * starts a new series, a lower result and its repeat offer, a large one sided drop and its symptom
 * question, booth and home as separate series, the chair stand milestone), and the workout activity
 * of the recent weeks from the existing results table.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProtocolItem } from "../src/medical/assessment";
import { WEEKS_SHOWN, weeklyActivity } from "../server/modules/progress/activity";
import {
  DAY,
  HOUR,
  T0,
  asBoothCheck,
  intakeOf,
  itemOf,
  login,
  member,
  register,
  resultBody,
  start,
  startApi,
  type Harness,
} from "./check-api-harness";

let h: Harness;
const setTime = (t: number) => vi.setSystemTime(t);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.AZM_BOOTH_CODE;
  delete process.env.AZM_BOOTH_DATES;
});

/**
 * One check: start at `at`, post the given results (with optional body changes), read the end of
 * check question (Q23 (7), asked before the results), complete.
 */
async function check(
  email: string,
  at: number,
  values: Record<string, number>,
  opts: {
    answers?: Record<string, unknown>;
    over?: Record<string, Record<string, unknown>>;
    extra?: Record<string, unknown>;
  } = {},
) {
  setTime(at);
  const cookie = await login(h, email);
  const s = await start(h, cookie, (opts.answers ?? {}) as never, opts.extra);
  if (s.status !== 200) throw new Error(`start ${email}: ${JSON.stringify(s.data)}`);
  const protocol: ProtocolItem[] = s.data.protocol;
  for (const [key, value] of Object.entries(values)) {
    const [testId, side] = key.split(":");
    const item = itemOf(protocol, testId, side);
    const body = resultBody(item, value, opts.over?.[key] ?? {});
    const r = await h.call(`/assessments/${s.data.id}/results`, body, cookie);
    if (r.status !== 200) throw new Error(`${key}: ${JSON.stringify(r.data)}`);
  }
  const end = await h.call(`/assessments/${s.data.id}/end`, undefined, cookie);
  const done = await h.call(`/assessments/${s.data.id}/complete`, {}, cookie);
  return { cookie, id: s.data.id as string, protocol, end: end.data, complete: done.data };
}

const current = (tests: any[], testId: string, side: string, setting = "home") =>
  tests.find((t) => t.testId === testId && t.side === side && t.setting === setting && t.current);

describe("series over four checks of one person", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("follows the spec's worked examples, new series, repeat offers and trends", async () => {
    const email = "sara@example.test";
    await member(h, email, intakeOf());
    const bottle = (l: number) => ({
      detail: {
        loadObject: "bottle",
        loadL: l,
        rangeLo: 158,
        rangeHi: 48,
        compensated: 0,
        countSource: "auto",
        view: "side",
      },
    });

    // Check 1.
    await check(email, T0, {
      "shoulder_abduction:right": 120,
      "trunk_control_seated:right": 18,
      "arm_curl_30s:right": 14,
    });
    // Check 2: the arm raise is lower; the side lean sets its two check starting point; a new bottle
    // size starts a new arm curl series.
    const c2 = await check(
      email,
      T0 + 3 * DAY,
      { "shoulder_abduction:right": 100, "trunk_control_seated:right": 22, "arm_curl_30s:right": 15 },
      { over: { "arm_curl_30s:right": bottle(1.5) } },
    );
    expect(c2.end.side).toBeNull();
    let p = (await h.call("/progress", undefined, c2.cookie)).data;
    expect(current(p.tests, "shoulder_abduction", "right")).toMatchObject({
      verdict: "lower",
      change: -20,
      band: 16,
      bandKind: "default",
      repeatOffer: true,
      labels: { verdict: { en: "Lower than your starting point" } },
    });
    expect(current(p.tests, "trunk_control_seated", "right")).toMatchObject({
      verdict: null,
      startingPointSet: true,
      baseline: { value: 20 },
    });
    const curls = p.tests.filter((t: any) => t.testId === "arm_curl_30s" && t.side === "right");
    expect(curls).toHaveLength(2);
    expect(curls.find((t: any) => t.current)).toMatchObject({
      firstResult: true,
      notComparable: true,
      latest: { value: 15 },
    });
    expect(curls.find((t: any) => !t.current)).toMatchObject({ firstResult: true, latest: { value: 14 } });
    expect(curls[0].seriesKey).not.toBe(curls[1].seriesKey);

    // A lasting next day answer takes the early repeat offer away until it is resolved (asked from
    // 24 hours after the check, O38).
    setTime(T0 + 3 * DAY + 25 * HOUR);
    const after = await login(h, email);
    await h.call("/assessments/after", { answer: "lasting" }, after);
    p = (await h.call("/progress", undefined, after)).data;
    expect(current(p.tests, "shoulder_abduction", "right").repeatOffer).toBeUndefined();

    // Check 3: 29 against the starting point 20 is beyond the band (8), the mean of 22 and 29 is not.
    const c3 = await check(
      email,
      T0 + 6 * DAY,
      { "shoulder_abduction:right": 122, "trunk_control_seated:right": 29 },
      { answers: { pc_after_last: "yes" } },
    );
    p = (await h.call("/progress", undefined, c3.cookie)).data;
    expect(current(p.tests, "trunk_control_seated", "right")).toMatchObject({
      verdict: "same",
      unconfirmed: true,
      change: 9,
      band: 8,
      labels: { verdict: { en: "About the same as your starting point" } },
    });
    // Trends from the third check: the person's own points only.
    expect(current(p.tests, "trunk_control_seated", "right").points.map((x: any) => x.value)).toEqual([
      18, 22, 29,
    ]);
    expect(current(p.tests, "shoulder_abduction", "right")).toMatchObject({ verdict: "same", change: 2 });
    expect(current(p.tests, "shoulder_abduction", "right").points).toHaveLength(3);

    // Check 4: 30, and the mean of 29 and 30 is beyond the band too.
    const c4 = await check(email, T0 + 9 * DAY, { "trunk_control_seated:right": 30 });
    p = (await h.call("/progress", undefined, c4.cookie)).data;
    expect(current(p.tests, "trunk_control_seated", "right")).toMatchObject({
      verdict: "higher",
      change: 10,
    });
    expect(p.retestDue).toBe(T0 + 9 * DAY + 28 * DAY);
    expect(p.earliestNext).toBe(T0 + 9 * DAY + 48 * HOUR);
    // Every series stays the person's own: no percentiles, norms or ranks in the answer.
    expect(JSON.stringify(p)).not.toMatch(/percentile|norm|rank/i);
  });
});

describe("the arm curl load across checks (Q5, Q26)", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  /** A home check with the arm curl on the right (bottle 1 L), the pain answer after it, complete. */
  async function curlCheck(email: string, at: number, count: number, painAfter: string | null) {
    setTime(at);
    const cookie = await login(h, email);
    const s = await start(h, cookie, {} as never);
    if (s.status !== 200) throw new Error(`start: ${JSON.stringify(s.data)}`);
    const protocol: ProtocolItem[] = s.data.protocol;
    const item = itemOf(protocol, "arm_curl_30s", "right");
    const body = resultBody(item, count, {
      detail: { ...resultBody(item, count).detail, gripYes: false },
    });
    const r = await h.call(`/assessments/${s.data.id}/results`, body, cookie);
    if (r.status !== 200) throw new Error(JSON.stringify(r.data));
    if (painAfter) {
      const b = await h.call(
        `/assessments/${s.data.id}/between`,
        { testId: "arm_curl_30s", side: "right", answer: painAfter },
        cookie,
      );
      if (b.status !== 200) throw new Error(JSON.stringify(b.data));
    }
    await h.call(`/assessments/${s.data.id}/end`, undefined, cookie);
    await h.call(`/assessments/${s.data.id}/complete`, {}, cookie);
    return cookie;
  }

  it("offers one step heavier after two checks at 25 or more with no more pain, and keeps the choice", async () => {
    const email = "load@example.test";
    await member(h, email, intakeOf());
    await curlCheck(email, T0, 25, "same");
    const cookie = await curlCheck(email, T0 + 3 * DAY, 26, "same");
    let p = (await h.call("/progress", undefined, cookie)).data;
    expect(current(p.tests, "arm_curl_30s", "right").loadStep).toEqual({
      from: { kind: "bottle", liters: 1 },
      to: { kind: "bottle", liters: 1.5 },
    });
    // The context names the load of the series for the S30 re-test form.
    let ctx = (await h.call("/assessments/context", undefined, cookie)).data;
    expect(ctx.lastLoads).toEqual({ right: { kind: "bottle", liters: 1 } });
    // Only a real offer can be chosen, with a side and a choice.
    expect((await h.call("/progress/load-step", { side: "left", choice: "heavier" }, cookie)).status).toBe(
      409,
    );
    expect((await h.call("/progress/load-step", { side: "right", choice: "more" }, cookie)).status).toBe(400);
    const chose = await h.call("/progress/load-step", { side: "right", choice: "heavier" }, cookie);
    expect(chose.status).toBe(200);
    expect(chose.data.next).toEqual({ kind: "bottle", liters: 1.5 });
    ctx = (await h.call("/assessments/context", undefined, cookie)).data;
    expect(ctx.lastLoads).toEqual({ right: { kind: "bottle", liters: 1.5 } });
    // Answered: not offered again.
    p = (await h.call("/progress", undefined, cookie)).data;
    expect(current(p.tests, "arm_curl_30s", "right").loadStep).toBeNull();
  });

  it("never offers it when the pain after the test is not known or was more", async () => {
    const email = "load-pain@example.test";
    await member(h, email, intakeOf());
    await curlCheck(email, T0 + 20 * DAY, 25, null);
    let cookie = await curlCheck(email, T0 + 23 * DAY, 27, "same");
    let p = (await h.call("/progress", undefined, cookie)).data;
    expect(current(p.tests, "arm_curl_30s", "right").loadStep).toBeNull();
    cookie = await curlCheck(email, T0 + 26 * DAY, 28, "more");
    p = (await h.call("/progress", undefined, cookie)).data;
    expect(current(p.tests, "arm_curl_30s", "right").loadStep).toBeNull();
  });
});

describe("a large drop on one side", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("asks the symptom question for that side before the results, and shows no verdict", async () => {
    const email = "drop@example.test";
    await member(h, email, intakeOf());
    await check(email, T0, { "shoulder_abduction:right": 120, "shoulder_abduction:left": 118 });
    const c2 = await check(email, T0 + 3 * DAY, {
      "shoulder_abduction:right": 80,
      "shoulder_abduction:left": 118,
    });
    expect(c2.end).toEqual({ question: "ec_symptoms", side: "right", chronicNote: false });
    const p = (await h.call("/progress", undefined, c2.cookie)).data;
    expect(current(p.tests, "shoulder_abduction", "right")).toMatchObject({
      verdict: null,
      largeDrop: true,
      symptomDrop: true,
      repeatOffer: true,
      change: -40,
    });
    expect(current(p.tests, "shoulder_abduction", "left")).toMatchObject({ verdict: "same", change: 0 });
  });

  it("does not ask when both sides dropped", async () => {
    const email = "bothdrop@example.test";
    await member(h, email, intakeOf());
    await check(email, T0, { "shoulder_abduction:right": 120, "shoulder_abduction:left": 118 });
    const c2 = await check(email, T0 + 3 * DAY, {
      "shoulder_abduction:right": 80,
      "shoulder_abduction:left": 76,
    });
    expect(c2.end.side).toBeNull();
  });
});

describe("booth and home series", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("keeps the booth point apart from the home series", async () => {
    const email = "booth-series@example.test";
    await member(h, email, intakeOf());
    // A signed in booth check of an earlier build (C34: the booth now runs the guest check).
    const first = await check(email, T0, { "shoulder_abduction:right": 120 });
    asBoothCheck(h, first.id);
    const home = await check(email, T0 + 3 * DAY, { "shoulder_abduction:right": 100 });
    const p = (await h.call("/progress", undefined, home.cookie)).data;
    const booth = current(p.tests, "shoulder_abduction", "right", "booth");
    const own = current(p.tests, "shoulder_abduction", "right", "home");
    expect(booth).toMatchObject({
      firstResult: true,
      verdict: null,
      latest: { value: 120, setting: "booth" },
    });
    expect(own).toMatchObject({ firstResult: true, verdict: null, latest: { value: 100, setting: "home" } });
    expect(own.notComparable).toBeUndefined();
    expect(booth.seriesKey).not.toBe(own.seriesKey);
  });
});

describe("the chair stand", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("shows the move from the hands allowed version to the standard one as a milestone", async () => {
    const email = "stand@example.test";
    const cookie = await member(h, email, intakeOf({ mobility: "standing" }));
    const c1 = await check(
      email,
      T0,
      { "chair_stand_30s:none": 9 },
      { answers: { pc_stand_no_hands: "no" } },
    );
    expect(itemOf(c1.protocol, "chair_stand_30s", "none")).toMatchObject({
      variant: "arms_assisted",
      helperRequired: true,
    });
    // D-009: the chair stand baseline range reaches the client as [hSit, hSit + rise].
    setTime(T0 + HOUR);
    const ctx = (await h.call("/assessments/context", undefined, await login(h, email))).data;
    const ranges = Object.entries(ctx.baselineRanges);
    expect(ranges).toHaveLength(1);
    expect(ranges[0][0]).toMatch(/^chair_stand_30s\|none\|/);
    expect(ranges[0][1]).toEqual([0.52, 0.52 + 0.31]);

    const c2 = await check(
      email,
      T0 + 3 * DAY,
      { "chair_stand_30s:none": 10 },
      { answers: { pc_stand_no_hands: "yes" } },
    );
    expect(itemOf(c2.protocol, "chair_stand_30s", "none").variant).toBe("standard");
    const p = (await h.call("/progress", undefined, c2.cookie)).data;
    const now = current(p.tests, "chair_stand_30s", "none");
    expect(now).toMatchObject({
      variant: "standard",
      milestone: true,
      firstResult: true,
      notComparable: true,
    });
    expect(p.tests.find((t: any) => t.testId === "chair_stand_30s" && !t.current)).toMatchObject({
      variant: "arms_assisted",
    });
    void cookie;
  });
});

describe("workout activity", () => {
  beforeAll(async () => {
    h = await startApi();
  });
  afterAll(async () => {
    await h.close();
  });

  it("answers with empty series and no activity before anything is stored", async () => {
    const cookie = await register(h, "empty@example.test");
    const p = await h.call("/progress", undefined, cookie);
    expect(p.status).toBe(200);
    expect(p.data).toMatchObject({
      tests: [],
      retestDue: null,
      earliestNext: null,
      validShare: null,
      avgEffort: null,
      activeMinutesPerWeek: null,
    });
    expect(p.data.sessions.weeks).toHaveLength(WEEKS_SHOWN);
    expect(p.data.sessions.weeks.every((w: any) => w.done === 0 && w.planned === 0)).toBe(true);
  });

  it("counts sessions done against the planned days, valid reps, effort and active minutes", async () => {
    const cookie = await member(h, "active@example.test", intakeOf({ days: [0, 2, 4] }), false);
    const plan = (await h.call("/auth/me", undefined, cookie)).data.plan;
    const w = await h.call("/workouts", { version: plan.version, demo: false }, cookie);
    const ex = w.data.plan.exercises[0];
    setTime(T0 + 5 * 60 * 1000);
    const moments = [
      ...Array(4).fill({ cls: "valid", durSec: 2, peakPct: 0.9 }),
      { cls: "compensated", durSec: 2, peakPct: 0.9 },
      { cls: "partial", durSec: 2, peakPct: 0.5 },
    ];
    const set = await h.call(
      `/workouts/${w.data.id}/sets`,
      {
        index: 0,
        summary: {
          exerciseId: ex.exerciseId,
          reps: { valid: 4, compensated: 1, partial: 1 },
          rpe: 5,
          romPct: 90,
          startedAt: T0 + 60 * 1000,
        },
        moments,
      },
      cookie,
    );
    expect(set.data.saved).toBe(true);
    const p = (await h.call("/progress", undefined, cookie)).data;
    const weeks = p.sessions.weeks;
    expect(weeks).toHaveLength(WEEKS_SHOWN);
    expect(weeks.at(-1)).toEqual({ start: "2026-10-04", done: 1, planned: 3, activeMinutes: 4 });
    // Weeks before the account existed plan nothing.
    expect(weeks[0]).toEqual({ start: "2026-08-16", done: 0, planned: 0, activeMinutes: 0 });
    expect(p.validShare).toBe(0.67);
    expect(p.avgEffort).toBe(5);
    expect(p.activeMinutesPerWeek).toBe(4);
  });
});

describe("weeklyActivity", () => {
  const set = (
    workoutId: string,
    startedAt: number,
    endedAt: number,
    extra: Record<string, unknown> = {},
  ) => ({
    workoutId,
    data: { startedAt, endedAt, reps: { valid: 5, compensated: 0, partial: 0 }, rpe: 4, ...extra },
  });

  it("starts weeks on Sunday in Riyadh, whatever the UTC date", () => {
    // Saturday 2026-10-03 22:30 UTC is Sunday 01:30 in Riyadh: the week of 2026-10-04.
    const sat = Date.UTC(2026, 9, 3, 22, 30);
    const a = weeklyActivity([set("w1", sat - 10 * 60000, sat)], [0], T0, 0);
    expect(a.weeks.at(-1)).toMatchObject({ start: "2026-10-04", done: 1, activeMinutes: 10 });
    // Saturday 20:30 UTC is still Saturday 23:30 in Riyadh: the week before.
    const late = Date.UTC(2026, 9, 3, 20, 30);
    const b = weeklyActivity([set("w1", late - 60000, late)], [0], T0, 0);
    expect(b.weeks.at(-2)).toMatchObject({ start: "2026-09-27", done: 1 });
  });

  it("counts a workout once, in the week of its first set, and caps a set left open at 60 minutes", () => {
    const t = T0 + HOUR;
    const a = weeklyActivity(
      [set("w1", t - 5 * 60000, t), set("w1", t, t + 10 * 60000), set("w2", t, t + 3 * HOUR)],
      [0, 2],
      T0 + DAY,
      0,
    );
    expect(a.weeks.at(-1)).toEqual({ start: "2026-10-04", done: 2, planned: 2, activeMinutes: 75 });
    expect(a.validShare).toBe(1);
    expect(a.avgEffort).toBe(4);
  });

  it("averages active minutes from the first active week and ignores rows it cannot read", () => {
    const week = 7 * DAY;
    const a = weeklyActivity(
      [
        set("old", T0 - 2 * week, T0 - 2 * week + 30 * 60000),
        set("now", T0, T0 + 10 * 60000, { rpe: 12, reps: { valid: 1, compensated: 1, partial: 2 } }),
        { workoutId: "bad", data: null },
        { workoutId: "bad2", data: { endedAt: "yesterday" } },
        set("outside", T0 - 20 * week, T0 - 20 * week + 60000),
      ],
      [0, 0, 9, 2],
      T0,
      0,
    );
    expect(a.weeks.map((w) => w.activeMinutes).slice(-3)).toEqual([30, 0, 10]);
    expect(a.weeks.at(-1)!.planned).toBe(2);
    expect(a.activeMinutesPerWeek).toBe(Math.round(40 / 3));
    // RPE 12 is out of range and left out; reps of every set in the weeks shown count.
    expect(a.avgEffort).toBe(4);
    expect(a.validShare).toBe(Math.round((6 / 9) * 100) / 100);
  });
});
