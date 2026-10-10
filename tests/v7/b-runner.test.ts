/**
 * The range of motion runner (src/engine/rom/runner.ts, product v7 contract 2.6 and 8.1): a whole
 * movement with a simulated person, the phase machine (every method in every phase), pain, the cause
 * and can move questions, keep reaching, the quality gate, no hold, the wide band, compensations, pause
 * and stop, and every result the server's validator accepts. D-038 item 1: no maximum question; the
 * automatic record itself is tests/v7/b-runner-auto.test.ts.
 */
import { describe, expect, it } from "vitest";
import { RomRunner, ROM_VALUE_BOUNDS, RUNNER_RULES } from "../../src/engine/rom/runner";
import type { RomEvent, RomHold, RomMeasureResult, RomPhase } from "../../src/engine/rom/types";
import { RANGE_RULES } from "../../src/engine/modes/rangeTest";
import { testDef } from "../../src/movements/assessments";
import { ROM_DATA, ROM_ENGINE_VERSION, movementDef } from "../../src/movements/rom";
import {
  checkRomResult,
  MAX_RETRIES,
  ROM_VALUE_BOUNDS as SERVER_BOUNDS,
} from "../../server/modules/focus/validate";
import {
  abductionPose,
  cuesOf,
  drive,
  elbowExtensionPose,
  item,
  kinds,
  runner,
  type Script,
} from "./b-driver";
import { hide } from "./b-poses";

const E = ROM_DATA.engine;

/** The server's check of a result (C-3): every field and the rules that tie them. */
function valid(res: RomMeasureResult, r = res) {
  const check = checkRomResult(
    res as unknown as Record<string, unknown>,
    item(r.movementId, r.side, { position: r.position }),
  );
  expect(check, JSON.stringify(check)).toMatchObject({ ok: true });
}

const abduct = (target: number | ((i: number, n: number) => number), over: Partial<Script> = {}): Script => ({
  rest: 5,
  target: typeof target === "number" ? () => target : target,
  pose: (deg) => abductionPose(deg),
  ...over,
});

describe("the runner's rules read the data and v1", () => {
  it("v1's numbers, the server's bounds and retries", () => {
    expect(RUNNER_RULES.calibrationSec).toBe(1);
    expect(RUNNER_RULES.maxRetries).toBe(testDef("shoulder_abduction").maxRetries);
    expect(RUNNER_RULES.maxRetries).toBe(MAX_RETRIES);
    expect(ROM_VALUE_BOUNDS).toEqual(SERVER_BOUNDS);
    expect(RUNNER_RULES.relaxedMaxDeg).toBe(RANGE_RULES.relaxedMaxDeg);
    // v1's 0.3 s running median for the start pose and the arm raise watches; the hold signal's is 0.5 s
    // (D-026 item 5, taken on step B2's 8.2 matrix).
    expect(RUNNER_RULES.medianSec).toBe(RANGE_RULES.medianSec);
    expect(RUNNER_RULES.holdMedianSec).toBe(0.5);
    // Every movement that writes its own calibration hold writes 1 s, the shared rule.
    for (const m of ROM_DATA.movements)
      if (m.calibrationSeconds !== undefined) expect(m.calibrationSeconds).toBe(RUNNER_RULES.calibrationSec);
  });
});

describe("a whole movement", () => {
  it("calibration, one practice, one scored attempt recorded at its hold, the result (D-035, D-038)", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(120), 120);
    expect(d.phases.map((p) => p.phase)).toEqual(["calibrating", "practice", "rest", "attempt", "done"]);
    expect(d.phases.filter((p) => p.phase === "attempt").map((p) => p.attempt)).toEqual([1]);
    expect(cuesOf(d.events)).toEqual(["practice", "again", "recorded"]);
    const holds = kinds(d.events, "hold").map((e) => e.hold);
    expect(holds).toHaveLength(1);
    for (const h of holds) {
      expect(h.deg).toBe(120);
      expect(h.bandDeg).toBe(8);
      expect(h.smallExcursion).toBe(false);
      expect(h.excursionDeg).toBeGreaterThan(100);
    }
    // The live dial follows the angle every frame with a reading.
    expect(kinds(d.events, "live").length).toBeGreaterThan(100);
    // The plateau hint (the contract's 3 degrees for 0.4 s), when it comes, comes before the hold; the
    // MVP hold (D-035) may come first.
    const plateaus = kinds(d.events, "plateau");
    expect(plateaus.length).toBeLessThanOrEqual(1);
    for (const p of plateaus) expect(p.t).toBeLessThan(holds[0].t);
    const res = r.finish(d.t);
    expect(res).toMatchObject({
      movementId: "shoulder_abduction",
      side: "right",
      position: "seated",
      status: "measured",
      reason: null,
      value: 120,
      median: 120,
      nValid: 1,
      painLimited: false,
      painLevel: null,
      painBefore: null,
      cause: null,
      retries: 0,
      flags: [],
      poseModel: "full",
      movementVersion: movementDef("shoulder_abduction").version,
      engineVersion: ROM_ENGINE_VERSION,
    });
    expect(res.attempts.map((a) => [a.index, a.outcome, a.value, a.answer, a.answerSource])).toEqual([
      [1, "valid", 120, null, null],
    ]);
    expect(res.practice).toHaveLength(1);
    expect(res.practice[0]).toMatchObject({ index: 0, outcome: "practice", value: 120, answer: null });
    expect(res.quality).toMatchObject({ ok: true, retries: 0, issues: [], medianFps: 30, maxPausedShare: 0 });
    expect(r.canTryAgain).toBe(true);
    valid(res);
  });

  it("a second try only when asked: the further of the two is the value, never a third (D-035)", () => {
    const r = runner("shoulder_abduction");
    const d = drive(
      r,
      abduct((i) => [110, 100][i] ?? 0),
      120,
    );
    expect(r.done).toBe(true);
    expect(r.finish(d.t)).toMatchObject({ status: "measured", value: 100, nValid: 1 });
    expect(r.canTryAgain).toBe(true);
    const evs = r.again(d.t + 1000);
    expect(evs).toEqual([expect.objectContaining({ kind: "phase", phase: "calibrating", attempt: 2 })]);
    expect(r.done).toBe(false);
    expect(r.canTryAgain).toBe(false);
    const d2 = drive(r, abduct(130, { t0: d.t + 1000 }), 120);
    expect(d2.phases.map((p) => p.phase)).toEqual(["attempt", "done"]);
    expect(cuesOf(d2.events)).toEqual(["again", "recorded"]);
    const res = r.finish(d2.t);
    expect(res.attempts.map((a) => [a.index, a.value])).toEqual([
      [1, 100],
      [2, 130],
    ]);
    expect(res.value).toBe(130);
    expect(res.median).toBe(115);
    // 130 - 100 = 30 is more than E + 5 = 15: inconsistent.
    expect(res.flags).toContain("inconsistent");
    // Never a third.
    expect(r.canTryAgain).toBe(false);
    expect(r.again(d2.t + 10)).toEqual([]);
    valid(res);
  });

  it("a second try without a value leaves the first; a stop in it keeps the first too", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100), 120);
    r.again(d.t + 1000);
    // The arm goes up and down the whole try, never still: no hold within 20 s.
    const d2 = drive(
      r,
      {
        rest: 5,
        target: () => 5,
        t0: d.t + 1000,
        pose: (_deg, t) => abductionPose(t < d.t + 3000 ? 5 : 60 - 40 * Math.cos(t / 220)),
      },
      60,
    );
    expect(r.done).toBe(true);
    const res = r.finish(d2.t);
    expect(res).toMatchObject({ status: "measured", value: 100, nValid: 1, retries: 0 });
    expect(res.quality.retries).toBe(1);
    expect(kinds(d2.events, "attempt").map((e) => [e.record.index, e.record.outcome])).toEqual([
      [2, "retry"],
    ]);
    valid(res);
    const s = runner("shoulder_abduction");
    const ds = drive(s, abduct(100), 120);
    s.again(ds.t + 1000);
    const evs = s.stop("user_stop", ds.t + 1500);
    expect(kinds(evs, "stop")).toEqual([]);
    expect(s.done).toBe(true);
    expect(s.finish(ds.t + 1600)).toMatchObject({ status: "measured", value: 100, nValid: 1 });
  });

  it("a lack movement: the end range is the smallest lack, and the value the smallest", () => {
    const r = runner("elbow_extension");
    const script = (target: (i: number) => number, t0 = 0): Script => ({
      rest: 90,
      target,
      pose: (deg) => elbowExtensionPose(deg),
      speed: 40,
      t0,
    });
    const d = drive(
      r,
      script((i) => [20, 15][i] ?? 90),
      120,
    );
    expect(r.finish(d.t)).toMatchObject({ status: "measured", value: 15, median: 15, nValid: 1 });
    r.again(d.t + 1000);
    const d2 = drive(
      r,
      script(() => 8, d.t + 1000),
      120,
    );
    const res = r.finish(d2.t);
    expect(res.attempts.map((a) => a.value)).toEqual([15, 8]);
    expect(res.value).toBe(8);
    expect(res.flags).not.toContain("inconsistent");
    valid(res);
  });

  it("the attempts are 5 s apart by default (engine.restBetweenAttemptsSeconds), or the rest given", () => {
    const gaps = (r: RomRunner) => {
      const d = drive(r, abduct(100), 120);
      const rests = d.phases.filter((p) => p.phase === "rest");
      const opens = d.phases.filter((p) => p.phase === "attempt");
      return opens.map((o, k) => o.t - rests[k].t);
    };
    for (const g of gaps(runner("shoulder_abduction")))
      expect(g).toBeGreaterThanOrEqual(E.restBetweenAttemptsSeconds.min * 1000);
    for (const g of gaps(runner("shoulder_abduction", { restSec: 8 })))
      expect(g).toBeGreaterThanOrEqual(8000);
  });

  it("flags: Lite model, a helper beside, gravity mode", () => {
    const lite = runner("shoulder_abduction", { poseModel: "lite", item: { helperRequired: true } });
    const res = lite.finish(drive(lite, abduct(100), 120).t);
    expect(res.flags).toEqual(expect.arrayContaining(["modelLite", "helperPresent"]));
    expect(res.poseModel).toBe("lite");
    valid(res);
    // Hips hidden by a wheelchair from the start: the gravity reference (v1.1 4.1, review B16).
    const g = runner("shoulder_abduction");
    const gd = drive(g, abduct(100, { pose: (deg) => hide(abductionPose(deg), [23, 24]) }), 120);
    const gres = g.finish(gd.t);
    expect(gres.status).toBe("measured");
    expect(gres.flags).toContain("gravityMode");
    expect(g.calibration?.gravityMode).toBe(true);
    expect(Math.abs(gres.value! - 100)).toBeLessThanOrEqual(2);
  });

  it("a mirrored picture reads the same arm", () => {
    const mirror = (px: ReturnType<typeof abductionPose>) =>
      px.map((_, i) => {
        const j = i === 0 ? 0 : i >= 11 ? (i % 2 ? i + 1 : i - 1) : [0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9][i];
        return { ...px[j], x: 1 - px[j].x };
      });
    const r = runner("shoulder_abduction", { mirrored: true });
    const d = drive(r, abduct(110, { pose: (deg) => mirror(abductionPose(deg)) }), 120);
    expect(r.finish(d.t).value).toBe(110);
  });
});

/** The side arm raise with a pause: to 80 by 3.5 s, held to 5 s, then on to 120 by 6.3 s, held (ms). */
const stepUp = (t: number) => {
  // Calibration first (the arm by the side for 2 s), then the practice and its rest go by: the
  // pause comes in the scored attempt, from 12 s.
  const s = t / 1000;
  const k = s < 12 ? s : s - 12;
  if (s < 12) return s > 3 && s < 9 ? Math.min(100, 5 + 60 * (s - 3)) : 5;
  if (k < 1) return 5;
  if (k < 2.25) return 5 + 60 * (k - 1);
  if (k < 4) return 80;
  if (k < 4.7) return 80 + 60 * (k - 4);
  return 120;
};

describe("no maximum question (D-038 item 1; the whole rule is b-runner-auto.test.ts)", () => {
  it("a steadier top further on within 3 s replaces the hold in hand: a pause on the way up is no value", () => {
    const r = runner("shoulder_abduction");
    // A pause at 80 on the way up, then on to 120.
    const d = drive(r, { rest: 5, target: () => 120, pose: (_deg, t) => abductionPose(stepUp(t)) }, 120);
    const holds = kinds(d.events, "hold").map((e) => e.hold);
    expect(holds.map((h) => Math.round(h.deg / 10) * 10)).toEqual([80, 120]);
    expect(holds[1].t - holds[0].t).toBeLessThan(RUNNER_RULES.settleSec * 1000);
    const res = r.finish(d.t);
    expect(res).toMatchObject({ status: "measured", value: 120, nValid: 1 });
    expect(res.attempts[0]).toMatchObject({ answer: null, answerSource: null });
    valid(res);
  });

  it("the hold in hand is the one current hold, and none outside an attempt", () => {
    const r = runner("shoulder_abduction");
    expect(r.currentHold).toBeNull();
    const d = drive(r, abduct(100), 30, { until: (rr) => rr.currentHold !== null });
    expect(r.phase).toBe("attempt");
    expect(r.currentHold).toMatchObject({ deg: 100, attempt: 1 });
    expect(r.holdProgress).toBe(1);
    drive(r, abduct(100, { rest: 100, t0: d.t }), 10);
    expect(r.done).toBe(true);
    expect(r.currentHold).toBeNull();
  });

  it("a small excursion hold is recorded with smallExcursion, with no confirmation", () => {
    // 9 degrees from the start pose: beyond the 8 degree band, under the 10 degree minimum excursion.
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(14), 120);
    const res = r.finish(d.t);
    expect(res.status).toBe("measured");
    expect(res.attempts.every((a) => a.flags.includes("smallExcursion"))).toBe(true);
    expect(res.flags).toContain("smallExcursion");
    valid(res);
  });
});

describe("pain (C-15, rom-protocol 6 pain_during)", () => {
  /** The scored attempt's hold in hand, then a pain report, then the person stays at the hold. */
  const painAtHold = (level: number, sharp: boolean, before: number | null) => {
    const r = runner("shoulder_abduction", { painBefore: before });
    const d = drive(r, abduct(100), 60, { until: (rr) => rr.currentHold !== null });
    const res = r.answerPain(level, sharp, "voice", d.t + 100);
    const after = drive(r, abduct(100, { rest: 100, t0: d.t + 100 }), 10);
    return { r, res, events: [...d.events, ...res.events, ...after.events], t: after.t };
  };

  it("a pain below the rule while the hold is in hand: the value stands, pain limited", () => {
    const { r, res, t } = painAtHold(4, false, 3);
    expect(res).toMatchObject({ accepted: true, action: "continue" });
    const out = r.finish(t);
    expect(out.status).toBe("measured");
    expect(out.attempts[0]).toMatchObject({ painLimited: true, painLevel: 4, answer: null });
    expect(out.painLimited).toBe(true);
    expect(out.painLevel).toBe(4);
    expect(out.painBefore).toBe(3);
    // A pain limited value offers no second try.
    expect(r.canTryAgain).toBe(false);
    valid(out);
  });

  for (const [level, sharp, before, stops] of [
    [6, false, 0, true],
    [5, false, 3, true],
    [4, false, 3, false],
    [2, false, null, true],
    [1, false, null, false],
    [1, true, 0, true],
  ] as const) {
    it(`pain ${level}${sharp ? " sharp" : ""} with ${before} before: ${stops ? "stops" : "goes on"}`, () => {
      const { r, events, t } = painAtHold(level, sharp, before);
      const res = r.finish(t);
      if (stops) {
        expect(r.phase).toBe("stopped");
        expect(kinds(events, "stop")).toEqual([expect.objectContaining({ reason: "pain_stop" })]);
        expect(cuesOf(events)).toContain("pain_stop");
        // The hold in hand is kept as pain limited.
        expect(res).toMatchObject({
          status: "stopped",
          reason: "pain_stop",
          value: 100,
          painLimited: true,
          nValid: 1,
        });
      } else expect(res).toMatchObject({ status: "measured", nValid: 1, painLimited: true });
      valid(res);
    });
  }

  it("a pain report during the second try that stops keeps the first value as pain limited", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(110), 60);
    r.again(d.t + 1000);
    const d2 = drive(r, abduct(100, { t0: d.t + 1000 }), 60, { until: (rr) => rr.phase === "attempt" });
    const res = r.answerPain(7, false, "voice", d2.t);
    expect(res).toMatchObject({ accepted: true, action: "stop_movement" });
    const out = r.finish(d2.t + 10);
    expect(out).toMatchObject({
      status: "stopped",
      reason: "pain_stop",
      value: 110,
      nValid: 1,
      painLimited: true,
      painLevel: 7,
    });
    valid(out);
  });

  it("stop(pain_stop) keeps the hold in hand as pain limited", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100), 30, { until: (rr) => rr.currentHold !== null });
    const evs = r.stop("pain_stop", d.t + 100);
    expect(evs.map((e) => e.kind)).toEqual(["attempt", "cue", "phase", "stop"]);
    const res = r.finish(d.t + 200);
    expect(res).toMatchObject({ status: "stopped", reason: "pain_stop", value: 100, painLimited: true });
    expect(res.attempts[0].answer).toBeNull();
    valid(res);
  });
});

describe("the cause question (rom-protocol 1.1 step 6, open question 8)", () => {
  it("is gone with the maximum question (D-038 item 1): never asked, the result's cause is null", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100), 120);
    expect(cuesOf(d.events)).not.toContain("what_stopped_ask");
    const res = r.finish(d.t);
    expect(res).toMatchObject({ status: "measured", cause: null, nValid: 1 });
    expect("answerCause" in r).toBe(false);
    valid(res);
  });
});

describe("can you move this joint (askCanMove)", () => {
  it("no: not measured, no active movement", () => {
    const r = runner("shoulder_abduction", { item: { askCanMove: true } });
    expect(r.start(0).map((e) => (e.kind === "cue" ? e.cue : e.kind))).toEqual(["phase", "can_move_ask"]);
    expect(r.phase).toBe("ask_can_move");
    const evs = r.answerCanMove(false, 500);
    expect(cuesOf(evs)).toEqual(["no_active_movement"]);
    const res = r.finish(600);
    expect(res).toMatchObject({ status: "not_measured", reason: "no_active_movement", value: null });
    valid(res);
  });

  it("yes: the start pose next", () => {
    const r = runner("shoulder_abduction", { item: { askCanMove: true } });
    r.start(0);
    r.answerCanMove(true, 500);
    expect(r.phase).toBe("calibrating");
    const d = drive(r, abduct(100, { t0: 500 }), 120);
    expect(r.finish(d.t).status).toBe("measured");
  });

  it("an item skipped today is not measured with its reason", () => {
    const r = runner("shoulder_abduction", { item: { skipped: "pain_today" } });
    r.start(0);
    const res = r.finish(10);
    expect(res).toMatchObject({ status: "not_measured", reason: "pain_today" });
    valid(res);
  });
});

describe("attempts that do not count", () => {
  it("11 fps: the quality gate's issue stays with the attempt, never a reason to discard its value (D-035)", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100, { fps: 11 }), 200);
    expect(kinds(d.events, "quality")).toEqual([]);
    const res = r.finish(d.t);
    expect(res).toMatchObject({ status: "measured", value: 100, retries: 0, nValid: 1 });
    expect(res.attempts[0].quality).toMatchObject({ ok: false, issues: ["low_fps"] });
    expect(res.quality).toMatchObject({ ok: true, retries: 0 });
    valid(res);
  });

  it("no hold within 20 s of the first movement: no_hold, repeated, then not measured (quality)", () => {
    const r = runner("shoulder_abduction");
    // The arm goes up and down the whole time, never still.
    const d = drive(
      r,
      {
        rest: 5,
        target: () => 5,
        // Fast enough that no stretch of it is a steady top (a slower wave's tops are holds, D-035).
        pose: (_deg, t) => abductionPose(t < 2000 ? 5 : 60 - 40 * Math.cos((t - 2000) / 220)),
      },
      200,
    );
    const attempts = kinds(d.events, "attempt").map((e) => e.record);
    expect(attempts[0]).toMatchObject({ index: 0, outcome: "practice", value: null, reasons: ["no_hold"] });
    const scored = attempts.filter((a) => a.index > 0);
    expect(scored.map((a) => [a.index, a.outcome, a.reasons])).toEqual([
      [1, "retry", ["no_hold"]],
      [1, "retry", ["no_hold"]],
      [1, "retry", ["no_hold"]],
    ]);
    for (const a of scored) expect(a.t1 - a.t0).toBeGreaterThanOrEqual(E.attemptTimeoutSeconds * 1000);
    const res = r.finish(d.t);
    expect(res).toMatchObject({ status: "not_measured", reason: "quality", retries: 2 });
    valid(res);
  });

  it("a tremor of 2.5 degrees holds at once in the MVP band: no wide band, no repeat (D-035)", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100, { tremor: { amp: 2.5, hz: 0.8 } }), 200);
    const holds = kinds(d.events, "hold").map((e) => e.hold);
    expect(holds).toHaveLength(1);
    expect(holds[0].bandDeg).toBe(8);
    const res = r.finish(d.t);
    expect(res.status).toBe("measured");
    expect(res.flags).not.toContain("wideHold");
    expect(res.retries).toBe(0);
    expect(Math.abs(res.value! - 100)).toBeLessThanOrEqual(3);
    valid(res);
  });

  it("a compensation at its invalid level only flags: one calm line before the hold, the value approximate (D-035)", () => {
    const r = runner("shoulder_abduction");
    // In the scored attempt the person leans 14 degrees once the arm is up.
    const leaning = () => r.phase === "attempt";
    const d = drive(
      r,
      abduct(100, { pose: (deg) => abductionPose(deg, "right", leaning() && deg > 60 ? 14 : 0) }),
      150,
    );
    const comp = kinds(d.events, "compensation").filter((e) => e.id === "trunk_lean");
    expect(comp.map((e) => e.level)).toEqual(["cue", "flag"]);
    expect(cuesOf(d.events).filter((c) => c === "test_abd_still")).toHaveLength(1);
    expect(
      kinds(d.events, "attempt").filter((e) => e.record.outcome !== "valid" && e.record.index > 0),
    ).toEqual([]);
    const res = r.finish(d.t);
    expect(res).toMatchObject({ status: "measured", nValid: 1, retries: 0 });
    expect(res.attempts[0].reasons).toEqual(["trunk_lean"]);
    expect(res.attempts[0].flags).toContain("approximate");
    expect(res.flags).toContain("approximate");
    expect(res.quality.retries).toBe(0);
    valid(res);
  });

  it("one calm line per movement: the practice's lean is spoken, the attempt's is silent", () => {
    const r = runner("shoulder_abduction");
    const lean = () => r.phase === "practice" || r.phase === "attempt";
    const d = drive(
      r,
      abduct(100, { pose: (deg) => abductionPose(deg, "right", lean() && deg > 60 ? 14 : 0) }),
      150,
    );
    const comp = kinds(d.events, "compensation").filter((e) => e.id === "trunk_lean");
    expect(comp.filter((e) => e.level === "cue")).toHaveLength(1);
    expect(comp.filter((e) => e.level === "flag").length).toBeGreaterThanOrEqual(2);
    expect(cuesOf(d.events).filter((c) => c === "test_abd_still")).toHaveLength(1);
    const res = r.finish(d.t);
    expect(res).toMatchObject({ status: "measured", nValid: 1, retries: 0 });
    expect(res.flags).toContain("approximate");
    valid(res);
  });

  it("no line during the hold: a lean that starts once the arm is steady at the top is silent", () => {
    const r = runner("shoulder_abduction");
    // The lean starts 0.5 s after the arm reaches the top (100 at 60 degrees per second).
    let topAt: number | null = null;
    const d = drive(
      r,
      abduct(100, {
        pose: (deg, t) => {
          if (r.phase !== "attempt") topAt = null;
          else if (deg >= 100 && topAt === null) topAt = t;
          const leaning = topAt !== null && t > topAt + 500;
          return abductionPose(deg, "right", leaning ? 14 : 0);
        },
      }),
      150,
    );
    const comp = kinds(d.events, "compensation").filter((e) => e.id === "trunk_lean");
    expect(comp.length).toBeGreaterThan(0);
    expect(comp.every((e) => e.level === "flag")).toBe(true);
    expect(cuesOf(d.events)).not.toContain("test_abd_still");
    expect(r.finish(d.t)).toMatchObject({ status: "measured", nValid: 1 });
  });
});

describe("the start pose (rom-protocol 1.1 step 1)", () => {
  it("calibrates once the start pose is still for the calibration second", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100), 5, { until: (rr) => rr.phase === "practice" });
    expect(d.t).toBeGreaterThanOrEqual(1000);
    expect(d.t).toBeLessThan(1500);
    const cal = r.calibration!;
    expect(cal.t).toBe(d.phases.find((p) => p.phase === "practice")!.t);
    expect(Math.abs(cal.startDeg - 5)).toBeLessThan(1);
    expect(cal.fixedHip).not.toBeNull();
  });

  it("the arm raises wait for the arm by the side (v1's relaxed angle)", () => {
    const r = runner("shoulder_abduction");
    // The arm held out at 45 degrees for 4 s, then lowered.
    drive(r, { rest: 5, target: () => 100, pose: (_deg, t) => abductionPose(t < 4000 ? 45 : 5) }, 6, {
      until: (rr) => rr.phase === "practice",
    });
    expect(r.calibration!.t).toBeGreaterThanOrEqual(5000);
  });

  it("a start pose never still: two rounds (O35), then not measured today (quality)", () => {
    const r = runner("shoulder_abduction");
    const d = drive(
      r,
      { rest: 5, target: () => 5, pose: (_deg, t) => abductionPose(15 + 14 * Math.sin(t / 150)) },
      60,
    );
    expect(r.done).toBe(true);
    // CalibrationRounds: 20 s rounds, 2 of them.
    expect(d.t).toBeGreaterThanOrEqual(40_000);
    const res = r.finish(d.t);
    expect(res).toMatchObject({ status: "not_measured", reason: "quality", nValid: 0 });
    valid(res);
  });
});

describe("pause and stop", () => {
  it("a pause during an attempt: the attempt starts again when resumed, nothing stored, no extra used", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100), 30, { until: (rr) => rr.phase === "attempt" });
    r.pause(d.t + 500);
    expect(r.phase).toBe("paused");
    // Frames while paused measure nothing.
    const quiet = drive(r, abduct(100, { t0: d.t + 600 }), 5);
    expect(kinds(quiet.events, "hold")).toEqual([]);
    const res = r.resume(d.t + 6000);
    expect(res.accepted).toBe(true);
    expect(r.phase).toBe("attempt");
    expect(cuesOf(res.events)).toEqual(["again"]);
    const rest = drive(r, abduct(100, { t0: d.t + 6000 }), 120);
    const out = r.finish(rest.t);
    expect(out).toMatchObject({ status: "measured", nValid: 1, retries: 0 });
    expect(out.quality.retries).toBe(0);
  });

  it("a pause with a hold in hand drops it: the attempt starts again when resumed (D-038 item 1)", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100), 30, { until: (rr) => rr.currentHold !== null });
    r.pause(d.t + 100);
    expect(r.currentHold).toBeNull();
    // Nothing is recorded while paused, however long.
    const res = r.resume(d.t + 20_000);
    expect(kinds(res.events, "attempt")).toEqual([]);
    expect(cuesOf(res.events)).toEqual(["again"]);
    expect(r.phase).toBe("attempt");
    const rest = drive(r, abduct(100, { t0: d.t + 20_000 }), 60);
    expect(r.finish(rest.t)).toMatchObject({ status: "measured", value: 100, nValid: 1 });
  });

  it("a stop by the person keeps no value; resume is rejected after a stop", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100), 60, { until: (rr) => rr.phase === "attempt" });
    const evs = r.stop("user_stop", d.t);
    expect(kinds(evs, "stop")).toEqual([expect.objectContaining({ reason: "user_stop" })]);
    expect(r.resume(d.t + 10)).toMatchObject({ accepted: false, reason: "stopped" });
    expect(r.keepReaching(d.t + 20)).toMatchObject({ accepted: false, reason: "stopped" });
    const res = r.finish(d.t + 30);
    expect(res).toMatchObject({
      status: "stopped",
      reason: "by_choice",
      value: null,
      median: null,
      nValid: 0,
    });
    expect(r.canTryAgain).toBe(false);
    valid(res);
  });

  it("finish before the end is a stop by choice", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100), 10, { until: (rr) => rr.phase === "attempt" });
    const res = r.finish(d.t);
    expect(res).toMatchObject({ status: "stopped", reason: "by_choice", value: null });
    valid(res);
  });
});

/* ------------------------------------------------------------------ the phase machine */

type Setup = { r: RomRunner; t: number };

/** A fresh runner in each phase. */
const PHASES: Record<RomPhase, () => Setup> = {
  idle: () => ({ r: runner("shoulder_abduction"), t: 0 }),
  ask_can_move: () => {
    const r = runner("shoulder_abduction", { item: { askCanMove: true } });
    r.start(0);
    return { r, t: 0 };
  },
  calibrating: () => {
    const r = runner("shoulder_abduction");
    r.start(0);
    return { r, t: 0 };
  },
  practice: () => until("practice"),
  attempt: () => until("attempt"),
  rest: () => until("rest"),
  paused: () => {
    const s = until("attempt");
    s.r.pause(s.t + 10);
    return { ...s, t: s.t + 10 };
  },
  stopped: () => {
    const s = until("attempt");
    s.r.stop("user_stop", s.t + 10);
    return { ...s, t: s.t + 10 };
  },
  done: () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100), 120);
    return { r, t: d.t };
  },
};

function until(phase: RomPhase): Setup {
  const r = runner("shoulder_abduction");
  const d = drive(r, abduct(100), 120, { until: (rr) => rr.phase === phase });
  expect(r.phase).toBe(phase);
  return { r, t: d.t };
}

const ALL = Object.keys(PHASES) as RomPhase[];
const ACTIVE = ALL.filter((p) => !["idle", "stopped", "done", "paused"].includes(p));

describe("every method in every phase", () => {
  for (const phase of ALL) {
    describe(phase, () => {
      it("answerCanMove", () => {
        const { r, t } = PHASES[phase]();
        const evs = r.answerCanMove(true, t + 1);
        if (phase === "ask_can_move") expect(r.phase).toBe("calibrating");
        else {
          expect(evs).toEqual([]);
          expect(r.phase).toBe(phase);
        }
      });

      it("answerPain below the rule (1, 0 before)", () => {
        const { r, t } = PHASES[phase]();
        const res = r.answerPain(1, false, "button", t + 1);
        if (phase === "idle" || phase === "done")
          expect(res).toMatchObject({ accepted: false, reason: "wrong_phase" });
        else if (phase === "stopped") expect(res).toMatchObject({ accepted: false, reason: "stopped" });
        else {
          expect(res).toMatchObject({ accepted: true, action: "continue" });
          expect(r.phase).toBe(phase);
        }
      });

      it("answerPain at the rule (6) stops the movement", () => {
        const { r, t } = PHASES[phase]();
        const res = r.answerPain(6, false, "voice", t + 1);
        if (phase === "idle" || phase === "done") expect(res.accepted).toBe(false);
        else if (phase === "stopped") expect(res).toMatchObject({ accepted: false, reason: "stopped" });
        else {
          expect(res).toMatchObject({ accepted: true, action: "stop_movement" });
          expect(r.phase).toBe("stopped");
          valid(r.finish(t + 2));
        }
      });

      it("keepReaching", () => {
        const { r, t } = PHASES[phase]();
        const res = r.keepReaching(t + 1);
        // D-038 item 1: the coach may give a few more seconds in a try, never elsewhere.
        if (phase === "practice" || phase === "attempt") expect(res.accepted).toBe(true);
        else
          expect(res).toMatchObject({
            accepted: false,
            reason: phase === "stopped" ? "stopped" : "wrong_phase",
          });
      });

      it("pause", () => {
        const { r, t } = PHASES[phase]();
        r.pause(t + 1);
        expect(r.phase).toBe(ACTIVE.includes(phase) ? "paused" : phase);
      });

      it("resume", () => {
        const { r, t } = PHASES[phase]();
        const res = r.resume(t + 1);
        if (phase === "paused") {
          expect(res.accepted).toBe(true);
          expect(r.phase).toBe("attempt");
        } else
          expect(res).toMatchObject({
            accepted: false,
            reason: phase === "stopped" ? "stopped" : "wrong_phase",
          });
      });

      it("stop", () => {
        const { r, t } = PHASES[phase]();
        r.stop("user_stop", t + 1);
        expect(r.phase).toBe(phase === "done" ? "done" : "stopped");
      });

      it("finish gives a result the server accepts", () => {
        const { r, t } = PHASES[phase]();
        valid(r.finish(t + 1));
      });

      it("feed", () => {
        const { r, t } = PHASES[phase]();
        const lm = abductionPose(5);
        const evs = r.feed({ t: t + 33, lm, poses: [lm], aspect: 1 }, { rollDeg: 0 });
        if (phase === "idle" || phase === "stopped" || phase === "done" || phase === "paused")
          expect(evs.filter((e) => e.kind !== "phase")).toEqual([]);
        if (phase === "idle" || phase === "stopped" || phase === "done") expect(evs).toEqual([]);
      });
    });
  }

  it("start twice does nothing the second time", () => {
    const r = runner("shoulder_abduction");
    expect(r.start(0).length).toBeGreaterThan(0);
    expect(r.start(10)).toEqual([]);
  });

  it("a definition that is not the item's movement is refused", () => {
    expect(
      () =>
        new RomRunner({
          item: item("knee_flexion"),
          def: movementDef("shoulder_abduction"),
          poseModel: "full",
        }),
    ).toThrow();
  });
});

/* ------------------------------------------------------------------ the hold of a hold event */

describe("events", () => {
  it("phase events carry the attempt index, holds are unique, attempt records validate as the result's", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(110), 120);
    r.again(d.t + 500);
    const d2 = drive(r, abduct(110, { t0: d.t + 500 }), 120);
    const holds: RomHold[] = kinds([...d.events, ...d2.events], "hold").map((e) => e.hold);
    expect(holds.map((h) => h.attempt)).toEqual([1, 2]);
    expect(holds.map((h) => h.holdId)).toEqual(["1:1", "2:2"]);
    // D-038 item 1: no question phase of any kind.
    const asked: RomEvent[] = [...d.events, ...d2.events].filter(
      (e) => e.kind === "phase" && e.phase.startsWith("ask_"),
    );
    expect(asked).toHaveLength(0);
    valid(r.finish(d2.t));
  });
});

describe("every line the runner plays has a voice line", () => {
  it("the copy lines of the questions and steps, and every compensation cue of the data", async () => {
    const script = (await import("../../src/app/voice-script.json")).default as Record<string, unknown>;
    const heard = new Set<string>();
    const listen = (r: RomRunner, s: Script, extra: (r: RomRunner, t: number) => RomEvent[] = () => []) => {
      const d = drive(r, s, 150);
      for (const c of cuesOf([...d.events, ...extra(r, d.t)])) heard.add(c);
    };
    listen(runner("shoulder_abduction"), abduct(100, { further: () => 120 }));
    const hurt = runner("shoulder_abduction");
    const d = drive(hurt, abduct(100), 60, { until: (rr) => rr.currentHold !== null });
    for (const c of cuesOf([...d.events, ...hurt.answerPain(7, false, "voice", d.t + 10).events]))
      heard.add(c);
    const can = runner("shoulder_abduction", { item: { askCanMove: true } });
    for (const c of cuesOf([...can.start(0), ...can.answerCanMove(false, 10)])) heard.add(c);
    expect([...heard]).toEqual(
      expect.arrayContaining([
        "practice",
        "again",
        "recorded",
        "pain_stop",
        "can_move_ask",
        "no_active_movement",
      ]),
    );
    for (const m of ROM_DATA.movements) for (const c of m.compensations) if (c.cue) heard.add(c.cue);
    for (const line of heard) expect(script[`rom_${line}`] ?? script[line], line).toBeDefined();
  });
});
