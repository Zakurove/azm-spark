/**
 * D-038 item 1 (Nasser's fifth real test: «Is this your most ROM? Remove this question»): the RomRunner
 * records the range automatically, with no question. The furthest steady hold (the MVP hold, still
 * about 1 s, ±8 degrees) is held in hand; a hold clearly further on (RUNNER_RULES.furtherDeg) within
 * RUNNER_RULES.settleSec replaces it; then the value is recorded and the movement moves on. The coach's
 * keep_reaching («I can do more», «wait») gives a few more seconds. Synthetic angle traces of the side
 * arm raise (tests/v7/b-driver.ts).
 */
import { describe, expect, it } from "vitest";
import { RUNNER_RULES } from "../../src/engine/rom/runner";
import { MVP_HOLD } from "../../src/engine/rom/hold";
import type { RomEvent } from "../../src/engine/rom/types";
import { ROM_ENGINE_VERSION } from "../../src/movements/rom";
import { checkRomResult } from "../../server/modules/focus/validate";
import { abductionPose, cuesOf, drive, item, kinds, runner, type Drive, type Script } from "./b-driver";

/** The side arm raise to `target`, then, `after` seconds after its first hold, on to `further`. */
function person(target: number, further?: number, after?: number): Script {
  return {
    rest: 5,
    target: () => target,
    pose: (deg) => abductionPose(deg),
    ...(further !== undefined ? { further: () => further } : {}),
    ...(after !== undefined ? { furtherAfter: after } : {}),
  };
}

const holdsOf = (d: { events: RomEvent[] }) => kinds(d.events, "hold").map((e) => e.hold);
const scored = (d: { events: RomEvent[] }) =>
  kinds(d.events, "attempt")
    .filter((e) => e.record.index > 0)
    .map((e) => e.record);
/** The scored attempt's first hold (the practice ends at its own hold, with no hold event). */
const firstHold = (d: Drive) => holdsOf(d)[0];

function valid(r: ReturnType<typeof runner>, t: number) {
  const res = r.finish(t);
  const check = checkRomResult(
    res as unknown as Record<string, unknown>,
    item(res.movementId, res.side, { position: res.position }),
  );
  expect(check, JSON.stringify(check)).toMatchObject({ ok: true });
  return res;
}

describe("D-038 item 1: the range is recorded with no question", () => {
  it("the numbers: still about 1 s within ±8 degrees, 3 s for a hold 5 degrees further, rom_engine_5", () => {
    expect(MVP_HOLD.seconds).toBe(1);
    expect(MVP_HOLD.halfBandDeg).toBe(8);
    expect(RUNNER_RULES.settleSec).toBe(3);
    expect(RUNNER_RULES.furtherDeg).toBe(5);
    expect(RUNNER_RULES.keepReachingSec).toBeGreaterThan(RUNNER_RULES.settleSec);
    expect(ROM_ENGINE_VERSION).toBe("rom_engine_5");
  });

  it("reach 100 and hold: 100 is recorded about 3 s after the hold, with no question and no answer", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, person(100), 60);
    expect(holdsOf(d).map((h) => h.deg)).toEqual([100]);
    const [rec] = scored(d);
    expect(rec).toMatchObject({ outcome: "valid", value: 100, answer: null, answerSource: null });
    // Recorded once the hold's time is over, never before it.
    const wait = rec.t1 - firstHold(d).t;
    expect(wait).toBeGreaterThanOrEqual(RUNNER_RULES.settleSec * 1000);
    expect(wait).toBeLessThan(RUNNER_RULES.settleSec * 1000 + 100);
    // No question of any kind: no ask phase and no question line.
    expect(d.phases.map((p) => p.phase)).toEqual(["calibrating", "practice", "rest", "attempt", "done"]);
    expect(cuesOf(d.events)).not.toContain("ask_max");
    expect(cuesOf(d.events)).toContain("recorded");
    const res = valid(r, d.t);
    expect(res).toMatchObject({ status: "measured", value: 100, nValid: 1, engineVersion: "rom_engine_5" });
    expect(res.flags).not.toContain("unconfirmed");
  });

  it("reach 100, hold, then 115 and hold within 3 s: 115 is recorded", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, person(100, 115, 0.5), 60);
    const holds = holdsOf(d);
    expect(holds.map((h) => h.deg)).toEqual([100, 115]);
    expect(holds[1].t - holds[0].t).toBeLessThan(RUNNER_RULES.settleSec * 1000);
    const [rec] = scored(d);
    expect(rec.value).toBe(115);
    // The further hold has its own time: recorded about 3 s after it.
    expect(rec.t1 - holds[1].t).toBeGreaterThanOrEqual(RUNNER_RULES.settleSec * 1000);
    expect(valid(r, d.t)).toMatchObject({ status: "measured", value: 115, nValid: 1 });
  });

  it("reach 100, hold, then wobble ±3 degrees: 100 is recorded", () => {
    const r = runner("shoulder_abduction");
    let heldAt = Infinity;
    const wobble = (t: number) => (t > heldAt ? 3 * Math.sin(2 * Math.PI * 1.5 * (t / 1000)) : 0);
    const d = drive(r, { rest: 5, target: () => 100, pose: (deg, t) => abductionPose(deg + wobble(t)) }, 60, {
      frame: (t, events) => {
        if (heldAt === Infinity && events.some((e) => e.kind === "hold")) heldAt = t;
      },
    });
    expect(heldAt).toBeLessThan(Infinity);
    // The wobble at the top never makes a new hold that counts.
    expect(holdsOf(d)).toHaveLength(1);
    expect(scored(d).map((a) => a.value)).toEqual([100]);
    expect(valid(r, d.t)).toMatchObject({ value: 100 });
  });

  it("a hold only a little further (4 degrees) is no new hold: the plateau in hand reads on", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, person(100, 104, 0.3), 60);
    expect(holdsOf(d)).toHaveLength(1);
    // The value is the plateau's median while the person stays within its band (D-035).
    const v = scored(d)[0].value!;
    expect(v).toBeGreaterThanOrEqual(100);
    expect(v).toBeLessThanOrEqual(104);
  });

  it("a further hold after the 3 s comes too late: the movement was recorded and moved on", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, person(100, 125, 3.5), 60);
    expect(holdsOf(d).map((h) => h.deg)).toEqual([100]);
    expect(scored(d).map((a) => a.value)).toEqual([100]);
    expect(r.done).toBe(true);
  });

  it("a slow reach on from a pause is never cut: still beyond the hold at its time, the person reaches on", () => {
    const r = runner("shoulder_abduction");
    // Up to 60 at 30 degrees a second, a pause there, then slowly (6 degrees a second, never a hold)
    // on to 110 from 1.5 s after the pause's hold.
    let leftAt = Infinity;
    const d = drive(
      r,
      {
        rest: 5,
        target: () => 60,
        speed: 30,
        further: () => 110,
        furtherAfter: 1.5,
        pose: (deg, t) => abductionPose(t < leftAt ? deg : Math.min(110, 60 + ((t - leftAt) / 1000) * 6)),
      },
      60,
      {
        frame: (t, events) => {
          if (leftAt === Infinity && events.some((e) => e.kind === "hold")) leftAt = t + 1500;
        },
      },
    );
    const holds = holdsOf(d);
    expect(holds[0].deg).toBe(60);
    expect(holds[holds.length - 1].deg).toBeGreaterThanOrEqual(108);
    expect(scored(d)[0].value).toBeGreaterThanOrEqual(108);
  });

  it("the hold ring is full while a hold is in hand, and the hold in hand is the controller's", () => {
    const r = runner("shoulder_abduction");
    let full = 0;
    let inHand = 0;
    drive(r, person(100), 60, {
      frame: () => {
        if (r.currentHold) {
          inHand++;
          if (r.holdProgress === 1) full++;
        }
      },
    });
    // About 3 s of frames at 30 fps, every one with a full ring.
    expect(inHand).toBeGreaterThan(80);
    expect(full).toBe(inHand);
  });
});

describe("D-038 item 1: keep_reaching («I can do more», «wait»)", () => {
  it("extends the window: a further hold 4 s after the first one still replaces it", () => {
    // Without keep reaching, 4 s later is too late.
    const late = runner("shoulder_abduction");
    const d0 = drive(late, person(100, 120, 4), 60);
    expect(scored(d0).map((a) => a.value)).toEqual([100]);

    const r = runner("shoulder_abduction");
    let asked = false;
    const d = drive(r, person(100, 120, 4), 60, {
      at: (t, rr) => {
        if (!asked && rr.currentHold && t - rr.currentHold.t >= 1000) {
          asked = true;
          expect(rr.keepReaching(t).accepted).toBe(true);
        }
      },
    });
    expect(asked).toBe(true);
    expect(holdsOf(d).map((h) => h.deg)).toEqual([100, 120]);
    expect(scored(d).map((a) => a.value)).toEqual([120]);
  });

  it("with nothing further, the hold in hand is recorded at the end of the extra seconds", () => {
    const r = runner("shoulder_abduction");
    let calledAt = 0;
    const d = drive(r, person(100), 60, {
      at: (t, rr) => {
        if (!calledAt && rr.currentHold && t - rr.currentHold.t >= 1000) {
          calledAt = t;
          rr.keepReaching(t);
        }
      },
    });
    const [rec] = scored(d);
    expect(rec.value).toBe(100);
    expect(rec.t1 - calledAt).toBeGreaterThanOrEqual(RUNNER_RULES.keepReachingSec * 1000);
    expect(rec.t1 - calledAt).toBeLessThan(RUNNER_RULES.keepReachingSec * 1000 + 100);
  });

  it("is refused before a try, after pain and once the value is recorded", () => {
    const r = runner("shoulder_abduction");
    r.start(0);
    expect(r.keepReaching(10)).toMatchObject({ accepted: false, reason: "wrong_phase" });
    const p = runner("shoulder_abduction", { painBefore: 2 });
    const d = drive(p, person(100), 30, { until: (rr) => rr.currentHold !== null });
    expect(p.answerPain(3, false, "voice", d.t + 100)).toMatchObject({ accepted: true, action: "continue" });
    expect(p.keepReaching(d.t + 200)).toMatchObject({ accepted: false, reason: "after_pain" });
    const done = runner("shoulder_abduction");
    const dd = drive(done, person(100), 60);
    expect(done.keepReaching(dd.t + 100)).toMatchObject({ accepted: false });
  });
});

describe("D-038 item 1: pain while a hold is in hand", () => {
  it("a pain below the rule marks the recorded value pain limited", () => {
    const r = runner("shoulder_abduction", { painBefore: 2 });
    const d = drive(r, person(100), 30, { until: (rr) => rr.currentHold !== null });
    expect(r.answerPain(3, false, "voice", d.t + 100).action).toBe("continue");
    const after = drive(
      r,
      { rest: 100, target: () => 100, pose: (deg) => abductionPose(deg), t0: d.t + 100 },
      10,
    );
    expect(scored(after)[0]).toMatchObject({ value: 100, painLimited: true, painLevel: 3 });
  });

  it("a pain at the rule stops the movement and keeps the hold in hand, pain limited", () => {
    const r = runner("shoulder_abduction");
    const d = drive(r, person(100), 30, { until: (rr) => rr.currentHold !== null });
    expect(r.answerPain(7, false, "voice", d.t + 100).action).toBe("stop_movement");
    const res = valid(r, d.t + 200);
    expect(res).toMatchObject({ status: "stopped", reason: "pain_stop", value: 100, painLimited: true });
    expect(res.attempts[0]).toMatchObject({ answer: null, answerSource: null });
  });
});
