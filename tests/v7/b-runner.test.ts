/**
 * The range of motion runner (src/engine/rom/runner.ts, product v7 contract 2.6 and 8.1): a whole
 * movement with a simulated person, the phase machine (every method in every phase), the maximum, pain,
 * cause and can move questions with the coach seam's rules (first answer per hold wins, early answers
 * rejected, keep reaching only right after «not yet»), the quality gate, no hold, the wide band,
 * compensations, pause and stop, and every result the server's validator accepts.
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
    // Every movement that writes its own calibration hold writes 1 s, the shared rule.
    for (const m of ROM_DATA.movements)
      if (m.calibrationSeconds !== undefined) expect(m.calibrationSeconds).toBe(RUNNER_RULES.calibrationSec);
  });
});

describe("a whole movement", () => {
  it("calibration, one practice, three scored attempts confirmed by yes, the result", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(120), 120);
    expect(d.phases.map((p) => p.phase)).toEqual([
      "calibrating",
      "practice",
      "rest",
      "attempt",
      "ask_max",
      "rest",
      "attempt",
      "ask_max",
      "rest",
      "attempt",
      "ask_max",
      "done",
    ]);
    expect(d.phases.filter((p) => p.phase === "attempt").map((p) => p.attempt)).toEqual([1, 2, 3]);
    expect(cuesOf(d.events)).toEqual([
      "practice",
      "again",
      "ask_max",
      "recorded",
      "again",
      "ask_max",
      "recorded",
      "again",
      "ask_max",
      "recorded",
    ]);
    const holds = kinds(d.events, "hold").map((e) => e.hold);
    expect(new Set(holds.map((h) => h.holdId)).size).toBe(3);
    for (const h of holds) {
      expect(h.deg).toBe(120);
      expect(h.bandDeg).toBe(3);
      expect(h.smallExcursion).toBe(false);
      expect(h.excursionDeg).toBeGreaterThan(100);
    }
    // The live dial follows the angle every frame with a reading.
    expect(kinds(d.events, "live").length).toBeGreaterThan(200);
    // The plateau hint comes before each hold.
    const plateaus = kinds(d.events, "plateau");
    expect(plateaus).toHaveLength(3);
    for (const [k, p] of plateaus.entries()) expect(p.t).toBeLessThan(holds[k].t);
    const res = r.finish(d.t);
    expect(res).toMatchObject({
      movementId: "shoulder_abduction",
      side: "right",
      position: "seated",
      status: "measured",
      reason: null,
      value: 120,
      median: 120,
      nValid: 3,
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
      [1, "valid", 120, "yes", "button"],
      [2, "valid", 120, "yes", "button"],
      [3, "valid", 120, "yes", "button"],
    ]);
    expect(res.practice).toHaveLength(1);
    expect(res.practice[0]).toMatchObject({ index: 0, outcome: "practice", value: 120, answer: null });
    expect(res.quality).toMatchObject({ ok: true, retries: 0, issues: [], medianFps: 30, maxPausedShare: 0 });
    valid(res);
  });

  it("the best valid attempt is the value, the median of the valid ones the median", () => {
    const r = runner("shoulder_abduction");
    const d = drive(
      r,
      abduct((i) => [110, 100, 130, 120][i] ?? 0),
      120,
    );
    const res = r.finish(d.t);
    expect(res.attempts.map((a) => a.value)).toEqual([100, 130, 120]);
    expect(res.value).toBe(130);
    expect(res.median).toBe(120);
    // 130 - 100 = 30 is more than E + 5 = 15: inconsistent.
    expect(res.flags).toContain("inconsistent");
    valid(res);
  });

  it("a lack movement: the end range is the smallest lack, and the value the smallest", () => {
    const r = runner("elbow_extension");
    const d = drive(
      r,
      {
        rest: 90,
        target: (i) => [20, 15, 8, 12][i] ?? 90,
        pose: (deg) => elbowExtensionPose(deg),
        speed: 40,
      },
      120,
    );
    const res = r.finish(d.t);
    expect(res.status).toBe("measured");
    expect(res.attempts.map((a) => a.value)).toEqual([15, 8, 12]);
    expect(res.value).toBe(8);
    expect(res.median).toBe(12);
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

describe("the maximum question (rom-protocol 1.1 step 5)", () => {
  it("«not yet»: the attempt goes on and a further hold replaces the value", () => {
    const r = runner("shoulder_abduction");
    const d = drive(
      r,
      abduct(100, {
        answer: (h) => (h.deg < 120 ? { answer: "not_yet" } : { answer: "yes" }),
        further: () => 125,
      }),
      150,
    );
    expect(cuesOf(d.events).filter((c) => c === "keep_going")).toHaveLength(3);
    const res = r.finish(d.t);
    expect(res.attempts.map((a) => a.value)).toEqual([125, 125, 125]);
    valid(res);
  });

  it("«not yet» then a hold that is not further: the first hold's value stands", () => {
    const r = runner("shoulder_abduction");
    const d = drive(
      r,
      abduct(110, {
        answer: (_h, k) => (k % 2 ? { answer: "not_yet" } : { answer: "yes" }),
        // The arm sags after «not yet» and holds lower.
        further: () => 100,
      }),
      200,
    );
    const res = r.finish(d.t);
    expect(res.attempts.map((a) => a.value)).toEqual([110, 110, 110]);
    expect(res.attempts.map((a) => a.answer)).toEqual(["yes", "yes", "yes"]);
  });

  it("«not yet» and no further hold: at the attempt's time the kept value is recorded with its answer", () => {
    const r = runner("shoulder_abduction");
    let wobble = false;
    const d = drive(
      r,
      abduct(100, {
        answer: (h) => {
          if (h.attempt !== 1) return { answer: "yes" };
          wobble = true;
          return { answer: "not_yet" };
        },
        // After «not yet» in the first attempt the arm shakes wider than the band: no hold until the clock ends.
        pose: (deg, t) => abductionPose(wobble && r.phase === "attempt" ? deg + 4 * Math.sin(t / 120) : deg),
      }),
      200,
      {
        at: (_t, rr) => {
          if (rr.phase === "rest") wobble = false;
        },
      },
    );
    const res = r.finish(d.t);
    expect(res.attempts[0]).toMatchObject({
      index: 1,
      value: 100,
      answer: "not_yet",
      answerSource: "button",
    });
    const first = kinds(d.events, "attempt").find((e) => e.record.index === 1)!.record;
    expect(first.t1 - first.t0).toBeGreaterThanOrEqual(E.attemptTimeoutSeconds * 1000);
    expect(res.status).toBe("measured");
    valid(res);
  });

  it("an early answer before the hold is rejected (wrong_phase) and never buffered; the hold asks", () => {
    const r = runner("shoulder_abduction");
    let early: ReturnType<RomRunner["answerMax"]> | null = null;
    drive(r, abduct(100), 30, {
      at: (t, rr) => {
        if (!early && rr.phase === "attempt") early = rr.answerMax("1:1", "yes", "voice", t);
      },
      until: (rr) => rr.phase === "ask_max",
    });
    expect(early).toMatchObject({ accepted: false, reason: "wrong_phase" });
    expect(r.phase).toBe("ask_max");
    expect(r.currentHold).not.toBeNull();
  });

  it("the first answer per hold wins: a button and the voice racing", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100, { answer: () => null }), 30, { until: (rr) => rr.phase === "ask_max" });
    const hold = r.currentHold!;
    const first = r.answerMax(hold.holdId, "not_yet", "button", d.t + 100);
    const second = r.answerMax(hold.holdId, "yes", "voice", d.t + 150);
    expect(first.accepted).toBe(true);
    expect(second).toMatchObject({ accepted: false, reason: "already_answered" });
    expect(r.phase).toBe("attempt");
  });

  it("an answer to an earlier hold is stale", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100, { answer: () => null }), 30, { until: (rr) => rr.phase === "ask_max" });
    const old = r.currentHold!;
    r.answerMax(old.holdId, "not_yet", "button", d.t + 100);
    // Still at 100: a new hold after a full second.
    const d2 = drive(r, abduct(100, { answer: () => null, t0: d.t + 100, rest: 100 }), 5, {
      until: (rr) => rr.phase === "ask_max",
    });
    const next = r.currentHold!;
    expect(next.holdId).not.toBe(old.holdId);
    expect(r.answerMax("1:999", "yes", "voice", d2.t + 10)).toMatchObject({
      accepted: false,
      reason: "stale_hold",
    });
    expect(r.answerMax(old.holdId, "yes", "voice", d2.t + 20)).toMatchObject({
      accepted: false,
      reason: "already_answered",
    });
    expect(r.answerMax(next.holdId, "yes", "voice", d2.t + 30)).toMatchObject({ accepted: true });
  });

  it("no answer within 10 s: the hold is recorded as unconfirmed (engine.answerTimeoutSeconds)", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100, { answer: () => null }), 120);
    const holds = kinds(d.events, "hold");
    const records = kinds(d.events, "attempt").filter((e) => e.record.index > 0);
    expect(records[0].record.t1 - holds[0].hold.t).toBeCloseTo(E.answerTimeoutSeconds * 1000, -2);
    const res = r.finish(d.t);
    expect(res.attempts.map((a) => [a.answer, a.answerSource])).toEqual([
      ["unconfirmed", "timeout"],
      ["unconfirmed", "timeout"],
      ["unconfirmed", "timeout"],
    ]);
    expect(res.attempts[0].flags).toContain("unconfirmed");
    expect(res.flags).toContain("unconfirmed");
    valid(res);
  });

  it("keep reaching extends the attempt by 10 s, only right after «not yet»", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100, { answer: () => null }), 30, { until: (rr) => rr.phase === "ask_max" });
    expect(r.keepReaching(d.t)).toMatchObject({ accepted: false, reason: "wrong_phase" });
    r.answerMax(r.currentHold!.holdId, "not_yet", "voice", d.t + 100);
    expect(r.keepReaching(d.t + 200)).toMatchObject({ accepted: true });
    // Once per «not yet».
    expect(r.keepReaching(d.t + 300)).toMatchObject({ accepted: false, reason: "wrong_phase" });
  });

  it("keep reaching is rejected after «it hurts» and after a pain answer (safety coach_end_range)", () => {
    const r = runner("shoulder_abduction", { painBefore: 2 });
    const d = drive(r, abduct(100, { answer: () => null }), 30, { until: (rr) => rr.phase === "ask_max" });
    r.answerPain(3, false, "voice", d.t + 50);
    r.answerMax(r.currentHold!.holdId, "not_yet", "voice", d.t + 100);
    expect(r.keepReaching(d.t + 200)).toMatchObject({ accepted: false, reason: "after_pain" });
    // And no keep_going line after a pain report (safety never).
    const r2 = runner("shoulder_abduction");
    const d2 = drive(r2, abduct(100, { answer: () => ({ answer: "hurts" }), pain: { level: 1 } }), 30, {
      until: (rr) => rr.phase === "ask_pain",
    });
    expect(r2.keepReaching(d2.t)).toMatchObject({ accepted: false, reason: "after_pain" });
  });

  it("keep reaching gives a slow mover time to reach a further hold", () => {
    // After «not yet» the arm shakes for 15 s, then settles at 120 slowly: the attempt's own clock ends first.
    const run = (keep: boolean) => {
      const r = runner("shoulder_abduction");
      const d = drive(r, abduct(80, { answer: () => null }), 40, { until: (rr) => rr.phase === "ask_max" });
      const t0 = d.t + 100;
      r.answerMax(r.currentHold!.holdId, "not_yet", "voice", t0);
      if (keep) expect(r.keepReaching(t0 + 50).accepted).toBe(true);
      const after = drive(
        r,
        {
          rest: 80,
          target: () => 80,
          answer: () => ({ answer: "yes" }),
          t0,
          pose: (_deg, t) =>
            abductionPose(
              t < t0 + 15_000
                ? 80 + 3 * Math.sin(t / 150)
                : Math.min(120, 80 + ((t - t0 - 15_000) / 1000) * 10),
            ),
        },
        60,
        { until: (rr) => rr.phase === "rest" || rr.done },
      );
      return kinds(after.events, "attempt").find((e) => e.record.index === 1)!.record;
    };
    expect(run(false)).toMatchObject({ value: 80, answer: "not_yet" });
    expect(run(true)).toMatchObject({ value: 120, answer: "yes" });
  });

  it("a small excursion hold is asked, recorded with smallExcursion when confirmed, and not recorded unconfirmed", () => {
    const confirmed = runner("shoulder_abduction");
    const d = drive(confirmed, abduct(12), 120);
    const res = confirmed.finish(d.t);
    expect(res.status).toBe("measured");
    expect(res.attempts.every((a) => a.flags.includes("smallExcursion"))).toBe(true);
    expect(res.flags).toContain("smallExcursion");
    valid(res);
    const silent = runner("shoulder_abduction");
    const s = drive(silent, abduct(12, { answer: () => null }), 200);
    const sres = silent.finish(s.t);
    // Unconfirmed small holds never count: the attempts end without a value and are repeated.
    expect(sres.attempts).toEqual([]);
    expect(sres.status).toBe("not_measured");
    valid(sres);
  });
});

describe("pain (C-15, rom-protocol 6 pain_during)", () => {
  it("«it hurts» records the value as pain limited and asks the pain question; below the rule the attempts go on", () => {
    const r = runner("shoulder_abduction", { painBefore: 3 });
    const d = drive(
      r,
      abduct(100, {
        answer: (h) => (h.attempt === 2 ? { answer: "hurts" } : { answer: "yes" }),
        pain: { level: 4 },
      }),
      120,
    );
    expect(d.phases.map((p) => p.phase)).toContain("ask_pain");
    expect(cuesOf(d.events)).toContain("pain_ask");
    const res = r.finish(d.t);
    expect(res.status).toBe("measured");
    expect(res.attempts[1]).toMatchObject({ painLimited: true, painLevel: 4, answer: "hurts" });
    expect(res.painLimited).toBe(true);
    expect(res.painLevel).toBe(4);
    expect(res.painBefore).toBe(3);
    valid(res);
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
      const r = runner("shoulder_abduction", { painBefore: before });
      const d = drive(r, abduct(100, { answer: () => ({ answer: "hurts" }), pain: { level, sharp } }), 120);
      const res = r.finish(d.t);
      if (stops) {
        expect(r.phase).toBe("stopped");
        expect(kinds(d.events, "stop")).toEqual([expect.objectContaining({ reason: "pain_stop" })]);
        expect(cuesOf(d.events)).toContain("pain_stop");
        // The last valid hold is kept as pain limited.
        expect(res).toMatchObject({
          status: "stopped",
          reason: "pain_stop",
          value: 100,
          painLimited: true,
          nValid: 1,
        });
      } else expect(res).toMatchObject({ status: "measured", nValid: 3, painLimited: true });
      valid(res);
    });
  }

  it("a pain report during an attempt that stops keeps the earlier attempts' best as pain limited", () => {
    const r = runner("shoulder_abduction");
    const d = drive(
      r,
      abduct((i) => (i === 2 ? 110 : 100)),
      60,
      {
        until: (rr) => rr.phase === "attempt" && countValid(rr) === 2,
      },
    );
    const res = r.answerPain(7, false, "voice", d.t);
    expect(res).toMatchObject({ accepted: true, action: "stop_movement" });
    const out = r.finish(d.t + 10);
    expect(out).toMatchObject({
      status: "stopped",
      reason: "pain_stop",
      value: 110,
      nValid: 2,
      painLimited: true,
      painLevel: 7,
    });
    valid(out);
  });

  it("stop(pain_stop) keeps the hold being asked about as pain limited", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100, { answer: () => null }), 30, { until: (rr) => rr.phase === "ask_max" });
    const evs = r.stop("pain_stop", d.t + 100);
    expect(evs.map((e) => e.kind)).toEqual(["attempt", "cue", "phase", "stop"]);
    const res = r.finish(d.t + 200);
    expect(res).toMatchObject({ status: "stopped", reason: "pain_stop", value: 100, painLimited: true });
    expect(res.attempts[0].answer).toBeNull();
    valid(res);
  });
});

/** Valid scored attempts so far (the runner's own record). */
function countValid(r: RomRunner): number {
  return (r as unknown as { scored: unknown[] }).scored.length;
}

/** Extra attempts used so far. */
function retriesOf(r: RomRunner): number {
  return (r as unknown as { retries: number }).retries;
}

describe("the cause question (rom-protocol 1.1 step 6, open question 8)", () => {
  it("opens once when the confirmed value is short of the norm's within limit, and records the answer", () => {
    const r = runner("shoulder_abduction", { askCauseBelow: 150 });
    const d = drive(r, abduct(100, { cause: "tight" }), 120);
    expect(d.phases.filter((p) => p.phase === "ask_cause")).toHaveLength(1);
    expect(cuesOf(d.events)).toContain("what_stopped_ask");
    const res = r.finish(d.t);
    expect(res).toMatchObject({ status: "measured", cause: "tight" });
    valid(res);
  });

  it("not when the value reaches it, not when switched off, not when pain limited", () => {
    const at = (over: Parameters<typeof runner>[1], script: Script) => {
      const r = runner("shoulder_abduction", over);
      return drive(r, script, 120).phases.some((p) => p.phase === "ask_cause");
    };
    expect(at({ askCauseBelow: 90 }, abduct(100))).toBe(false);
    expect(at({ askCauseBelow: null }, abduct(100))).toBe(false);
    expect(
      at({ askCauseBelow: 150 }, abduct(100, { answer: () => ({ answer: "hurts" }), pain: { level: 1 } })),
    ).toBe(false);
  });

  it("a lack movement is short above its within limit", () => {
    const r = runner("elbow_extension", { askCauseBelow: 5 });
    const d = drive(
      r,
      { rest: 90, target: () => 20, pose: (deg) => elbowExtensionPose(deg), speed: 40, cause: "weak" },
      120,
    );
    expect(r.finish(d.t).cause).toBe("weak");
  });

  it("left unanswered, finish gives the measured result without a cause", () => {
    const r = runner("shoulder_abduction", { askCauseBelow: 150 });
    const d = drive(r, abduct(100), 120, { until: (rr) => rr.phase === "ask_cause" });
    const res = r.finish(d.t + 5000);
    expect(res).toMatchObject({ status: "measured", cause: null, nValid: 3 });
    expect(r.done).toBe(true);
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
  it("11 fps fails the quality gate: repeated twice, then not measured today (quality)", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100, { fps: 11 }), 200);
    const quality = kinds(d.events, "quality");
    expect(quality.map((q) => q.issue)).toEqual(["low_fps", "low_fps", "low_fps"]);
    const res = r.finish(d.t);
    expect(res).toMatchObject({ status: "not_measured", reason: "quality", retries: 2, nValid: 0 });
    expect(res.quality).toMatchObject({ ok: false, retries: 3, issues: ["low_fps"] });
    expect(kinds(d.events, "attempt").filter((e) => e.record.outcome === "retry")).toHaveLength(3);
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
        pose: (_deg, t) => abductionPose(t < 2000 ? 5 : 60 - 40 * Math.cos((t - 2000) / 700)),
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

  it("a tremor never settles in 3 degrees: after two tries without a hold the 5 degree band, flagged wideHold", () => {
    const r = runner("shoulder_abduction");
    // 2.5 degrees at 1 Hz: the hold signal (the dial's One Euro on the landmarks, then v1's 0.3 s median)
    // reads it about 3.7 degrees wide over a second, inside the 5 degree band only. A faster tremor
    // (2.2 degrees at 1.5 Hz) reads under 3 and is a hold with the normal band.
    const d = drive(r, abduct(100, { tremor: { amp: 2.5, hz: 1 } }), 200);
    const attempts = kinds(d.events, "attempt").map((e) => e.record);
    expect(attempts[0].reasons).toEqual(["no_hold"]);
    expect(attempts[1]).toMatchObject({ index: 1, outcome: "retry", reasons: ["no_hold"] });
    const holds = kinds(d.events, "hold").map((e) => e.hold);
    expect(holds.length).toBeGreaterThanOrEqual(3);
    for (const h of holds) expect(h.bandDeg).toBe(5);
    const res = r.finish(d.t);
    expect(res.status).toBe("measured");
    expect(res.flags).toContain("wideHold");
    expect(res.retries).toBe(1);
    expect(Math.abs(res.value! - 100)).toBeLessThanOrEqual(2);
    valid(res);
  });

  it("a compensation at its invalid level: the attempt is coached, not stored and repeated", () => {
    const r = runner("shoulder_abduction");
    // In the first try of the first scored attempt the person leans 14 degrees once the arm is up.
    const leaning = () => r.phase === "attempt" && countValid(r) === 0 && retriesOf(r) === 0;
    const d = drive(
      r,
      abduct(100, { pose: (deg) => abductionPose(deg, "right", leaning() && deg > 60 ? 14 : 0) }),
      150,
    );
    const comp = kinds(d.events, "compensation").filter((e) => e.id === "trunk_lean");
    expect(comp.map((e) => e.level)).toEqual(["cue", "invalid"]);
    expect(cuesOf(d.events).filter((c) => c === "test_abd_still")).toHaveLength(1);
    const repeats = kinds(d.events, "attempt").filter((e) => e.record.outcome === "invalid");
    expect(repeats).toHaveLength(1);
    expect(repeats[0].record).toMatchObject({ index: 1, value: null, reasons: ["trunk_lean"] });
    const res = r.finish(d.t);
    expect(res).toMatchObject({ status: "measured", nValid: 3, retries: 1 });
    expect(res.quality.retries).toBe(1);
    valid(res);
  });

  it("the budget is two extra attempts, as v1.1: then not measured even with valid attempts kept", () => {
    const r = runner("shoulder_abduction");
    // Two valid attempts, then the person leans in every try of the third.
    const leaning = () => r.phase === "attempt" && countValid(r) === 2;
    const d = drive(
      r,
      abduct(100, { pose: (deg) => abductionPose(deg, "right", leaning() && deg > 60 ? 14 : 0) }),
      200,
    );
    const res = r.finish(d.t);
    expect(kinds(d.events, "attempt").filter((e) => e.record.outcome === "invalid")).toHaveLength(3);
    expect(res).toMatchObject({
      status: "not_measured",
      reason: "quality",
      value: null,
      nValid: 2,
      retries: 2,
    });
    expect(res.attempts).toHaveLength(2);
    valid(res);
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
    expect(out).toMatchObject({ status: "measured", nValid: 3, retries: 0 });
    expect(out.quality.retries).toBe(0);
  });

  it("a pause during the question asks again when resumed", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100, { answer: () => null }), 30, { until: (rr) => rr.phase === "ask_max" });
    const hold = r.currentHold!;
    r.pause(d.t + 100);
    expect(r.currentHold).toBeNull();
    const res = r.resume(d.t + 20_000);
    expect(cuesOf(res.events)).toEqual(["ask_max"]);
    expect(r.currentHold?.holdId).toBe(hold.holdId);
    // The answer clock starts again: no unconfirmed record from the paused time.
    expect(r.answerMax(hold.holdId, "yes", "button", d.t + 20_500).accepted).toBe(true);
  });

  it("a stop by the person keeps no value; resume is rejected after a stop", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, abduct(100), 60, { until: (rr) => countValid(rr) === 2 && rr.phase === "rest" });
    const evs = r.stop("user_stop", d.t);
    expect(kinds(evs, "stop")).toEqual([expect.objectContaining({ reason: "user_stop" })]);
    expect(r.resume(d.t + 10)).toMatchObject({ accepted: false, reason: "stopped" });
    expect(r.answerMax("x", "yes", "button", d.t + 20)).toMatchObject({ accepted: false, reason: "stopped" });
    const res = r.finish(d.t + 30);
    expect(res).toMatchObject({
      status: "stopped",
      reason: "by_choice",
      value: null,
      median: null,
      nValid: 2,
    });
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

type Setup = { r: RomRunner; t: number; holdId: string };

/** A fresh runner in each phase. */
const PHASES: Record<RomPhase, () => Setup> = {
  idle: () => ({ r: runner("shoulder_abduction"), t: 0, holdId: "9:9" }),
  ask_can_move: () => {
    const r = runner("shoulder_abduction", { item: { askCanMove: true } });
    r.start(0);
    return { r, t: 0, holdId: "9:9" };
  },
  calibrating: () => {
    const r = runner("shoulder_abduction");
    r.start(0);
    return { r, t: 0, holdId: "9:9" };
  },
  practice: () => until("practice"),
  attempt: () => until("attempt"),
  ask_max: () => {
    const s = until("ask_max", { answer: () => null });
    return { ...s, holdId: s.r.currentHold!.holdId };
  },
  ask_pain: () => {
    const s = until("ask_max", { answer: () => null });
    const holdId = s.r.currentHold!.holdId;
    s.r.answerMax(holdId, "hurts", "button", s.t + 10);
    return { ...s, t: s.t + 10, holdId };
  },
  ask_cause: () => until("ask_cause", {}, { askCauseBelow: 170 }),
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
    return { r, t: d.t, holdId: "9:9" };
  },
};

function until(phase: RomPhase, over: Partial<Script> = {}, opts: Parameters<typeof runner>[1] = {}): Setup {
  const r = runner("shoulder_abduction", opts);
  const d = drive(r, abduct(100, over), 120, { until: (rr) => rr.phase === phase });
  expect(r.phase).toBe(phase);
  return { r, t: d.t, holdId: "9:9" };
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

      it("answerMax", () => {
        const { r, t, holdId } = PHASES[phase]();
        const res = r.answerMax(holdId, "yes", "button", t + 1);
        if (phase === "ask_max") expect(res.accepted).toBe(true);
        else
          expect(res).toMatchObject({
            accepted: false,
            reason:
              phase === "stopped" ? "stopped" : phase === "ask_pain" ? "already_answered" : "wrong_phase",
          });
      });

      it("answerPain below the rule (1, 0 before)", () => {
        const { r, t } = PHASES[phase]();
        const res = r.answerPain(1, false, "button", t + 1);
        if (phase === "idle" || phase === "done")
          expect(res).toMatchObject({ accepted: false, reason: "wrong_phase" });
        else if (phase === "stopped") expect(res).toMatchObject({ accepted: false, reason: "stopped" });
        else {
          expect(res).toMatchObject({ accepted: true, action: "continue" });
          // After «it hurts» the pain limited value is recorded and the attempts go on.
          expect(r.phase).toBe(phase === "ask_pain" ? "rest" : phase);
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

      it("answerCause", () => {
        const { r, t } = PHASES[phase]();
        const res = r.answerCause("tight", "button", t + 1);
        if (phase === "ask_cause") {
          expect(res.accepted).toBe(true);
          expect(r.phase).toBe("done");
        } else
          expect(res).toMatchObject({
            accepted: false,
            reason: phase === "stopped" ? "stopped" : "wrong_phase",
          });
      });

      it("keepReaching", () => {
        const { r, t } = PHASES[phase]();
        const res = r.keepReaching(t + 1);
        expect(res).toMatchObject({
          accepted: false,
          reason: phase === "stopped" ? "stopped" : phase === "ask_pain" ? "after_pain" : "wrong_phase",
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
          askCauseBelow: null,
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
    const holds: RomHold[] = kinds(d.events, "hold").map((e) => e.hold);
    expect(holds.map((h) => h.attempt)).toEqual([1, 2, 3]);
    expect(holds.map((h) => h.holdId)).toEqual(["1:1", "2:2", "3:3"]);
    const asked: RomEvent[] = d.events.filter((e) => e.kind === "phase" && e.phase === "ask_max");
    expect(asked).toHaveLength(3);
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
    listen(runner("shoulder_abduction", { askCauseBelow: 150 }), abduct(100, { cause: "tight" }));
    listen(
      runner("shoulder_abduction"),
      abduct(100, {
        answer: (h) => (h.attempt === 1 ? { answer: "not_yet" } : { answer: "hurts" }),
        pain: { level: 7 },
      }),
    );
    const can = runner("shoulder_abduction", { item: { askCanMove: true } });
    for (const c of cuesOf([...can.start(0), ...can.answerCanMove(false, 10)])) heard.add(c);
    expect([...heard]).toEqual(
      expect.arrayContaining([
        "practice",
        "again",
        "ask_max",
        "recorded",
        "keep_going",
        "pain_ask",
        "pain_stop",
        "what_stopped_ask",
        "can_move_ask",
        "no_active_movement",
      ]),
    );
    for (const m of ROM_DATA.movements) for (const c of m.compensations) if (c.cue) heard.add(c.cue);
    for (const line of heard) expect(script[`rom_${line}`] ?? script[line], line).toBeDefined();
  });
});
