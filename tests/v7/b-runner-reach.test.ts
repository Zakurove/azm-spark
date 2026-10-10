/**
 * D-037 item 2 (Nasser's fourth real test: «I can do more» gave him no time): after «not yet» the
 * RomRunner gives real time. The same plateau found again a hold window later is not a new question;
 * a hold clearly further on (RUNNER_RULES.reachFurtherDeg) is asked at once, a little further only once
 * the person had RUNNER_RULES.reachAskAfterSec; with no new question by the end of the reach time
 * (RUNNER_RULES.reachSec) the hold answered is taken, calmly, with no question loop, and the silence
 * counts as yes timeout (engine.answerTimeoutSeconds) never cuts that time short. Synthetic angle
 * traces of the side arm raise (tests/v7/b-driver.ts).
 */
import { describe, expect, it } from "vitest";
import { RUNNER_RULES } from "../../src/engine/rom/runner";
import type { RomAnswer, RomHold } from "../../src/engine/rom/types";
import { ROM_DATA } from "../../src/movements/rom";
import { checkRomResult } from "../../server/modules/focus/validate";
import { abductionPose, cuesOf, drive, item, kinds, runner, type Drive, type Script } from "./b-driver";

/** The side arm raise to `target`, then to `further` after «not yet»; the first question is answered not_yet. */
function person(target: number, then: (h: RomHold, k: number) => RomAnswer | null, further?: number): Script {
  return {
    rest: 5,
    target: () => target,
    pose: (deg) => abductionPose(deg),
    answer: (h, k) => {
      const a = then(h, k);
      return a ? { answer: a } : null;
    },
    ...(further !== undefined ? { further: () => further } : {}),
  };
}

/** When «not yet» put the scored attempt back in its phase (the phase right after the first question). */
function answeredAt(d: Drive): number {
  const asked = d.phases.findIndex((p) => p.phase === "ask_max");
  expect(d.phases[asked + 1].phase).toBe("attempt");
  return d.phases[asked + 1].t;
}

const holdsOf = (d: Drive) => kinds(d.events, "hold").map((e) => e.hold);
const scored = (d: Drive) =>
  kinds(d.events, "attempt")
    .filter((e) => e.record.index > 0)
    .map((e) => e.record);

function valid(r: ReturnType<typeof runner>, t: number) {
  const res = r.finish(t);
  const check = checkRomResult(
    res as unknown as Record<string, unknown>,
    item(res.movementId, res.side, { position: res.position }),
  );
  expect(check, JSON.stringify(check)).toMatchObject({ ok: true });
  return res;
}

describe("D-037 item 2: «I can do more» gives real time", () => {
  it("the numbers: 5 degrees further, 6 s, 12 s, longer than the silence counts as yes timeout", () => {
    expect(RUNNER_RULES.reachFurtherDeg).toBe(5);
    expect(RUNNER_RULES.reachAskAfterSec).toBe(6);
    expect(RUNNER_RULES.reachSec).toBe(12);
    expect(RUNNER_RULES.reachSec).toBeGreaterThan(ROM_DATA.engine.answerTimeoutSeconds);
  });

  it("reach 100 and hold, «not yet», rise to 120 and hold: asked again there, yes records 120", () => {
    const r = runner("shoulder_abduction");
    const d = drive(
      r,
      person(100, (_h, k) => (k === 1 ? "not_yet" : "yes"), 120),
      120,
    );
    const holds = holdsOf(d);
    // Two questions: at 100, then at 120. Never again at 100 while the arm went on.
    expect(holds.map((h) => h.deg)).toEqual([100, 120]);
    expect(cuesOf(d.events).filter((c) => c === "ask_max")).toHaveLength(2);
    expect(cuesOf(d.events).filter((c) => c === "keep_going")).toHaveLength(1);
    const res = valid(r, d.t);
    expect(res).toMatchObject({ status: "measured", value: 120, nValid: 1 });
    expect(res.attempts.map((a) => [a.value, a.answer, a.answerSource])).toEqual([[120, "yes", "button"]]);
  });

  it("«not yet» and no further movement: no question loop, 100 is taken after the reach time", () => {
    const r = runner("shoulder_abduction");
    // The person stays at 100, holding still, after «not yet».
    const d = drive(
      r,
      person(100, (_h, k) => (k === 1 ? "not_yet" : "yes")),
      120,
    );
    const at = answeredAt(d);
    // The plateau at 100 is found again and again (every hold window) and never asked about.
    expect(holdsOf(d)).toHaveLength(1);
    expect(cuesOf(d.events).filter((c) => c === "ask_max")).toHaveLength(1);
    const [rec] = scored(d);
    expect(rec).toMatchObject({ value: 100, answer: "not_yet", answerSource: "button" });
    // Taken at the end of the reach time, after the 10 s that count as yes for an open question.
    expect(rec.t1 - at).toBeGreaterThanOrEqual(RUNNER_RULES.reachSec * 1000);
    expect(rec.t1 - at).toBeLessThan(RUNNER_RULES.reachSec * 1000 + 200);
    expect(rec.t1 - at).toBeGreaterThan(ROM_DATA.engine.answerTimeoutSeconds * 1000);
    expect(d.phases.map((p) => p.phase)).toEqual([
      "calibrating",
      "practice",
      "rest",
      "attempt",
      "ask_max",
      "attempt",
      "done",
    ]);
    expect(valid(r, d.t)).toMatchObject({ status: "measured", value: 100, nValid: 1 });
  });

  it("the hold ring stays empty at the hold answered, so the screen never shows a new hold there", () => {
    const r = runner("shoulder_abduction");
    let ring = 0;
    let reaching = false;
    drive(
      r,
      person(100, (_h, k) => (k === 1 ? "not_yet" : "yes")),
      120,
      {
        frame: () => {
          if (r.phase === "ask_max") reaching = true;
          else if (reaching && r.phase === "attempt") ring = Math.max(ring, r.holdProgress);
        },
      },
    );
    expect(reaching).toBe(true);
    expect(ring).toBe(0);
  });

  it("a little further (4 degrees) is asked only once the person had 6 s", () => {
    const r = runner("shoulder_abduction");
    const d = drive(
      r,
      person(100, (_h, k) => (k === 1 ? "not_yet" : "yes"), 104),
      120,
    );
    const at = answeredAt(d);
    const holds = holdsOf(d);
    expect(holds).toHaveLength(2);
    expect(holds[1].deg).toBe(104);
    expect(holds[1].t - at).toBeGreaterThanOrEqual(RUNNER_RULES.reachAskAfterSec * 1000);
    expect(holds[1].t - at).toBeLessThan(RUNNER_RULES.reachAskAfterSec * 1000 + 1000);
    expect(valid(r, d.t)).toMatchObject({ value: 104 });
  });

  it("clearly further (at least 5 degrees) is asked at once, well before 6 s", () => {
    const r = runner("shoulder_abduction");
    const d = drive(
      r,
      person(100, (_h, k) => (k === 1 ? "not_yet" : "yes"), 106),
      120,
    );
    const at = answeredAt(d);
    const holds = holdsOf(d);
    expect(holds.map((h) => h.deg)).toEqual([100, 106]);
    expect(holds[1].t - at).toBeLessThan(2000);
  });

  it("«not yet» by voice: no question is open, so silence never records the hold while the person reaches", () => {
    const r = runner("shoulder_abduction");
    const d = drive(
      r,
      person(100, () => null),
      30,
      { until: (rr) => rr.phase === "ask_max" },
    );
    const hold = r.currentHold!;
    expect(r.answerMax(hold.holdId, "not_yet", "voice", d.t + 3000).accepted).toBe(true);
    expect(r.keepReaching(d.t + 3500).accepted).toBe(true);
    // Still for 11 s at 100 (past the 10 s of the question), then on to 125.
    const t0 = d.t + 3000;
    const after = drive(
      r,
      {
        rest: 100,
        target: () => 100,
        answer: () => ({ answer: "yes" }),
        t0,
        pose: (_deg, t) =>
          abductionPose(t < t0 + 11_000 ? 100 : Math.min(125, 100 + ((t - t0 - 11_000) / 1000) * 60)),
      },
      40,
    );
    // Nothing recorded and nothing asked during the 11 s at 100; the one question is at 125.
    expect(scored(after).map((a) => [a.value, a.answer, a.answerSource])).toEqual([[125, "yes", "button"]]);
    expect(holdsOf(after).map((h) => h.deg)).toEqual([125]);
    expect(holdsOf(after)[0].t - t0).toBeGreaterThan(11_000);
    expect(cuesOf(after.events).filter((c) => c === "ask_max")).toHaveLength(1);
  });

  it("a second «not yet» gives the time again, and the further hold stands", () => {
    const r = runner("shoulder_abduction");
    const d = drive(
      r,
      person(100, (_h, k) => (k <= 2 ? "not_yet" : "yes"), 115),
      120,
    );
    // 100 asked, 115 asked, then nothing further: 115 is taken after the second reach time.
    expect(holdsOf(d).map((h) => h.deg)).toEqual([100, 115]);
    expect(scored(d).map((a) => [a.value, a.answer])).toEqual([[115, "not_yet"]]);
  });
});
