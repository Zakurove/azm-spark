/**
 * The focus check validators (server/modules/focus/validate.ts; product v7 contract section 4): every
 * body is closed, numbers are finite and inside their unit's bounds, strings come from enumerations,
 * lists are bounded, and a failure names the first bad field. The largest valid gait body stays under
 * the gait route's 160 KB body limit, so a body the validator accepts is never refused as too large.
 */
import { describe, expect, it } from "vitest";
import {
  GAIT_LIMITS,
  GAIT_UNIT_BOUNDS,
  ROM_FLAGS,
  ROM_VALUE_BOUNDS,
  checkFocusStart,
  checkFocusStop,
  checkGaitBody,
  checkRomResult,
  checkToday,
} from "../../server/modules/focus/validate";
import { GAIT_BODY_LIMIT } from "../../server/modules/focus/routes";
import type { RomProtocolItem } from "../../src/medical/rom-protocol";
import { GAIT_DATA } from "../../src/movements/gait";
import { testGaitPlan } from "./a-focus-rules";
import { gaitBody, romBody } from "./a-focus-bodies";
import { v7Intake } from "./a-harness";

const item = (movementId: string, position: string, side = "right") =>
  ({ movementId, side, position }) as RomProtocolItem;
const fieldOf = (r: { ok: boolean; field?: string }) => (r.ok ? "ok" : r.field);
const plan = testGaitPlan(v7Intake(), { redFlagRegions: [] }, "booth");

describe("range results", () => {
  it("bounds each kind of movement as section 4 says, whole degrees", () => {
    expect(ROM_VALUE_BOUNDS).toEqual({ flexion: [0, 180], signed: [-90, 90], lack: [-30, 150] });
    const hipExt = item("hip_extension", "standing_supported");
    expect(fieldOf(checkRomResult(romBody(hipExt, -10), hipExt))).toBe("ok");
    expect(fieldOf(checkRomResult(romBody(hipExt, 92), hipExt))).toBe("value");
    expect(fieldOf(checkRomResult(romBody(hipExt, -92), hipExt))).toBe("value");
    const knee = item("knee_extension", "lying_back");
    expect(fieldOf(checkRomResult(romBody(knee, -30), knee))).toBe("ok");
    expect(fieldOf(checkRomResult(romBody(knee, -31), knee))).toBe("value");
    const flex = item("shoulder_flexion", "seated");
    // At the edge the attempts around the best must fit too: a median of -2 does not.
    expect(fieldOf(checkRomResult(romBody(flex, 0), flex))).toBe("median");
    expect(fieldOf(checkRomResult(romBody(flex, 180), flex))).toBe("ok");
  });

  it("takes at most 3 scored attempts, 1 practice and 2 retries, each attempt closed and bounded", () => {
    const flex = item("shoulder_flexion", "seated");
    const body = romBody(flex, 120);
    const a = body.attempts[0];
    const cases: [Record<string, unknown>, string][] = [
      [{ attempts: [...body.attempts, { ...a, index: 3 }] }, "attempts"],
      [{ attempts: [{ ...a, index: 2 }, body.attempts[1], body.attempts[2]] }, "attempts.index"],
      [{ attempts: [{ ...a, index: 4 }, body.attempts[1], body.attempts[2]] }, "attempts.index"],
      [{ attempts: [{ ...a, outcome: "practice" }, body.attempts[1], body.attempts[2]] }, "attempts.outcome"],
      [{ attempts: [{ ...a, answer: "maybe" }, body.attempts[1], body.attempts[2]] }, "attempts.answer"],
      [
        { attempts: [{ ...a, answerSource: "telepathy" }, body.attempts[1], body.attempts[2]] },
        "attempts.answerSource",
      ],
      [
        { attempts: [{ ...a, reasons: ["free text"] }, body.attempts[1], body.attempts[2]] },
        "attempts.reasons",
      ],
      [{ attempts: [{ ...a, t1: a.t0 - 1 }, body.attempts[1], body.attempts[2]] }, "attempts.t1"],
      [{ attempts: [{ ...a, note: "x" }, body.attempts[1], body.attempts[2]] }, "attempts.note"],
      [
        { attempts: [{ ...a, quality: { ...a.quality, view: "top" } }, body.attempts[1], body.attempts[2]] },
        "attempts.quality.view",
      ],
      [
        {
          attempts: [
            { ...a, quality: { ...a.quality, issues: ["bad"] } },
            body.attempts[1],
            body.attempts[2],
          ],
        },
        "attempts.quality.issues",
      ],
      [
        {
          attempts: [
            { ...a, quality: { ...a.quality, cue: "a note with spaces" } },
            body.attempts[1],
            body.attempts[2],
          ],
        },
        "attempts.quality.cue",
      ],
      [{ practice: [...body.practice, ...body.practice] }, "practice"],
      [{ practice: [{ ...body.practice[0], index: 1 }] }, "practice.index"],
      [{ quality: { ...body.quality, issues: ["paused", "paused"] } }, "quality.issues"],
      [{ quality: { ...body.quality, maxPausedShare: 1.5 } }, "quality.maxPausedShare"],
      [{ quality: { ...body.quality, extra: 1 } }, "quality.extra"],
      [{ reason: "my own words" }, "reason"],
      [{ engineVersion: "rom engine 1" }, "engineVersion"],
      [{ movementVersion: 0 }, "movementVersion"],
    ];
    for (const [over, field] of cases)
      expect(fieldOf(checkRomResult({ ...body, ...over }, flex)), field).toBe(field);
    // An answer source may be a timeout and an attempt may be pain limited.
    const pain = romBody(flex, 120, {
      painLimited: true,
      painLevel: 5,
      status: "stopped",
      reason: "pain_stop",
    });
    expect(fieldOf(checkRomResult(pain, flex))).toBe("ok");
    expect(fieldOf(checkRomResult({ ...pain, painLimited: false }, flex))).toBe("value");
    expect(ROM_FLAGS).toHaveLength(13);
  });

  it("names the item it must match: movement, side and position", () => {
    const flex = item("shoulder_flexion", "seated");
    expect(fieldOf(checkRomResult(romBody(flex, 120, { side: "left" }), flex))).toBe("side");
    expect(fieldOf(checkRomResult(romBody(flex, 120, { movementId: "shoulder_abduction" }), flex))).toBe(
      "movementId",
    );
    expect(fieldOf(checkRomResult(romBody(flex, 120, { position: "seated_forward" }), flex))).toBe(
      "position",
    );
  });
});

describe("the start and the day's answers", () => {
  it("keeps the day to ids and numbers", () => {
    expect(fieldOf(checkToday({ painByRegion: { knee: 0, neck: 10 }, redFlagRegions: ["hip"] }))).toBe("ok");
    expect(fieldOf(checkToday({ painByRegion: { knee: 1.5 }, redFlagRegions: [] }))).toBe(
      "today.painByRegion",
    );
    expect(fieldOf(checkToday({ painByRegion: {}, redFlagRegions: [], walk10m: "yes" }))).toBe(
      "today.walk10m",
    );
    expect(fieldOf(checkToday({ painByRegion: {}, redFlagRegions: [], orthosis: { up: "afo" } }))).toBe(
      "today.orthosis",
    );
    expect(fieldOf(checkToday([]))).toBe("today");
  });

  it("needs every part of the start body; the day's one screen travels as today (D-032 item 2)", () => {
    const body = {
      setting: "booth",
      today: { painByRegion: {}, redFlagRegions: [], worrying: false, unsteady: true },
      device: { os: "Android", browser: "Chrome" },
      include: { rom: true, gait: false },
    };
    expect(fieldOf(checkFocusStart(body))).toBe("ok");
    for (const key of Object.keys(body)) {
      const { [key]: _drop, ...rest } = body as Record<string, unknown>;
      void _drop;
      expect(fieldOf(checkFocusStart(rest)), key).not.toBe("ok");
    }
    // No v1 pre-check answers any more.
    expect(fieldOf(checkFocusStart({ ...body, answers: {} }))).toBe("answers");
    expect(fieldOf(checkFocusStart({ ...body, today: { ...body.today, worrying: "yes" } }))).toBe(
      "today.worrying",
    );
  });

  it("checks a stop: a v1 option, with both the movement and the side or neither", () => {
    expect(fieldOf(checkFocusStop({ option: "fall" }))).toBe("ok");
    expect(fieldOf(checkFocusStop({ option: "fall", movementId: "knee_flexion", side: "left" }))).toBe("ok");
    expect(fieldOf(checkFocusStop({ option: "fall", movementId: "knee_flexion" }))).toBe("side");
    expect(fieldOf(checkFocusStop({ option: "fall", side: "left" }))).toBe("movementId");
    expect(fieldOf(checkFocusStop({ option: "falls" }))).toBe("option");
  });
});

describe("gait bodies", () => {
  it("bounds every metric by its unit, the units of the gait data", () => {
    const units = new Set(
      GAIT_DATA.metrics.filter((m) => m.use.some((u) => u !== "do_not_use")).map((m) => m.unit),
    );
    for (const unit of units) expect(GAIT_UNIT_BOUNDS, String(unit)).toHaveProperty(String(unit));
    expect(GAIT_UNIT_BOUNDS).toMatchObject({
      "steps/min": [20, 250],
      s: [0.1, 5],
      "%": [0, 100],
      ratio: [0, 5],
      deg: [-90, 120],
      "m/s": [0, 3],
      m: [0, 2.5],
    });
    const b = gaitBody(plan, "overground");
    (b.analysis.combined as Record<string, unknown>).hip_hike = {
      id: "hip_hike",
      value: 1.5,
      n: 3,
      unit: "share",
      grade: "B",
    };
    expect(fieldOf(checkGaitBody(b, plan))).toBe("analysis.combined.hip_hike.value");
  });

  it("keeps the pad's fields to the pad and the near side to the pad side views", () => {
    const over = gaitBody(plan, "overground");
    expect(fieldOf(checkGaitBody(over, plan))).toBe("ok");
    expect(fieldOf(checkGaitBody({ ...over, setup: { ...over.setup, handrail: "none" } }, plan))).toBe(
      "setup.handrail",
    );
    expect(fieldOf(checkGaitBody({ ...over, setup: { ...over.setup, familiarised: true } }, plan))).toBe(
      "setup.familiarised",
    );
    const pad = gaitBody(plan, "walking_pad");
    expect(fieldOf(checkGaitBody(pad, plan))).toBe("ok");
    const front = structuredClone(pad);
    (front.analysis.views[2] as Record<string, unknown>).nearSide = "left";
    expect(fieldOf(checkGaitBody(front, plan))).toBe("analysis.views.nearSide");
    // Only a mode the plan allows.
    const home = testGaitPlan(v7Intake(), { redFlagRegions: [] }, "home");
    expect(fieldOf(checkGaitBody(pad, home))).toBe("setup.mode");
  });

  it("takes the pain marked during the walk: at most 10, a side or none, a whole level 0 to 10 (CG-8)", () => {
    const b = gaitBody(plan, "overground");
    const at = (walkPain: unknown) =>
      fieldOf(checkGaitBody({ ...b, analysis: { ...b.analysis, walkPain } }, plan));
    expect(fieldOf(checkGaitBody(b, plan))).toBe("ok");
    expect(at([])).toBe("ok");
    expect(
      at([
        { side: "right", level: 4 },
        { side: null, level: 0 },
        { side: "left", level: 10 },
      ]),
    ).toBe("ok");
    expect(GAIT_LIMITS.walkPain).toBe(10);
    expect(at(Array.from({ length: GAIT_LIMITS.walkPain }, () => ({ side: null, level: 1 })))).toBe("ok");
    expect(at(Array.from({ length: GAIT_LIMITS.walkPain + 1 }, () => ({ side: null, level: 1 })))).toBe(
      "analysis.walkPain",
    );
    for (const bad of [
      {},
      null,
      [{ side: "up", level: 4 }],
      [{ side: "both", level: 4 }],
      [{ level: 4 }],
      [{ side: null, level: 11 }],
      [{ side: null, level: -1 }],
      [{ side: null, level: 2.5 }],
      [{ side: null, level: "7" }],
      [{ side: null, level: 2, note: "it hurt" }],
    ])
      expect(at(bad), JSON.stringify(bad)).toBe("analysis.walkPain");
  });

  it("accepts the largest body of section 4, which fits the analysis cap and the body limit", () => {
    const worst = gaitBody(plan, "walking_pad", { worst: true });
    expect(worst.analysis.walkPain).toHaveLength(GAIT_LIMITS.walkPain);
    expect(fieldOf(checkGaitBody(worst, plan))).toBe("ok");
    const analysis = Buffer.byteLength(JSON.stringify(worst.analysis));
    const body = Buffer.byteLength(JSON.stringify(worst));
    expect(analysis).toBeLessThanOrEqual(GAIT_LIMITS.analysisBytes);
    expect(body).toBeLessThan(GAIT_BODY_LIMIT);
    expect(GAIT_LIMITS.analysisBytes + 2 * 1024).toBeLessThan(GAIT_BODY_LIMIT);
    expect(worst.analysis.views).toHaveLength(3);
    for (const v of worst.analysis.views) {
      expect(v.events).toHaveLength(GAIT_LIMITS.eventsPerView);
      expect(v.cycles).toHaveLength(GAIT_LIMITS.cyclesPerView);
    }
    expect(worst.analysis.replay.frames).toHaveLength(GAIT_LIMITS.replayFrames);
  });

  it("refuses an analysis over its cap, so no accepted body ever meets the 160 KB limit (413)", () => {
    // Every number inside its bounds but at its longest form (a 17 digit mantissa and an exponent):
    // without the cap such a body would pass every field and still exceed the body limit.
    const longest = (k: number) => Number(`1.${String(1234567890123456 + k).padStart(16, "0")}e-7`);
    const worst = gaitBody(plan, "walking_pad", { worst: true });
    const metrics = (m: Record<string, any>) => {
      for (const [k, v] of Object.entries(m)) {
        const [lo, hi] = GAIT_UNIT_BOUNDS[v.unit];
        const x = lo + (hi - lo) * 0.123456789012345678 + k.length * 1e-9;
        Object.assign(v, {
          value: x,
          sides: { left: x, right: x },
          share: { left: longest(1), right: longest(2) },
          n: 999,
        });
      }
    };
    for (const v of worst.analysis.views) {
      v.events = v.events.map((e, k) => ({
        ...e,
        side: "right",
        t: longest(k),
        index: 999999,
        confidence: longest(k + 1),
        detector: "stenum_front",
      }));
      v.cycles = v.cycles.map((_, k) => ({
        side: "right",
        icStart: longest(k),
        to: longest(k + 1),
        icEnd: longest(k + 2),
        clean: false,
        drop: "visibility",
      }));
      metrics(v.metrics);
    }
    metrics(worst.analysis.combined);
    const size = Buffer.byteLength(JSON.stringify(worst.analysis));
    expect(size).toBeGreaterThan(GAIT_LIMITS.analysisBytes);
    expect(Buffer.byteLength(JSON.stringify(worst))).toBeGreaterThan(GAIT_BODY_LIMIT);
    expect(fieldOf(checkGaitBody(worst, plan))).toBe("analysis");
  });
});
