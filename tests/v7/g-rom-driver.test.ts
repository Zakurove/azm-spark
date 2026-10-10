/**
 * Step G1 (product v7 contract 8.4 and 2.6): the smoke page drives B's RomRunner as a person at the
 * buttons would (src/features/smoke/romDriver.ts): yes to "can you move it" after a short delay on the
 * runner's own clock (D-038 item 1: no maximum or cause question; the holds record themselves); it
 * records the events and the time of every feed (section 9: 2 ms p95). Tested here with a scripted
 * runner.
 */
import { describe, expect, it } from "vitest";
import { RomSmokeDriver, type RomRunnerLike } from "../../src/features/smoke/romDriver";
import type { RomEvent, RomMeasureResult, RomPhase } from "../../src/engine/rom/types";
import type { Frame } from "../../src/engine/types";

/** A runner that asks can move, then holds three times (each recorded on its own), and ends. */
class ScriptedRunner implements RomRunnerLike {
  phase: RomPhase = "idle";
  done = false;
  calls: string[] = [];
  private holds = 0;
  private frames = 0;

  start(t: number): RomEvent[] {
    this.phase = "ask_can_move";
    return [{ kind: "phase", phase: "ask_can_move", t, attempt: 0 }];
  }
  feed(frame: Frame): RomEvent[] {
    this.frames++;
    if (this.phase !== "attempt") return [{ kind: "live", deg: 10, t: frame.t }];
    if (this.frames % 10 !== 0) return [];
    this.holds++;
    const events: RomEvent[] = [
      {
        kind: "hold",
        hold: {
          holdId: `${this.holds}:1`,
          deg: 130,
          t: frame.t,
          attempt: this.holds,
          excursionDeg: 120,
          bandDeg: 8,
          smallExcursion: false,
        },
      },
      { kind: "quality", issue: "too_dark" as never, t: frame.t },
    ];
    if (this.holds === 3) {
      this.done = true;
      this.phase = "done";
      events.push({ kind: "done", t: frame.t });
    }
    return events;
  }
  answerCanMove(canMove: boolean, t: number): RomEvent[] {
    this.calls.push(`can_move ${canMove} @${t}`);
    this.phase = "attempt";
    return [{ kind: "phase", phase: "attempt", t, attempt: 1 }];
  }
  stop(reason: "pain_stop" | "user_stop", t: number): RomEvent[] {
    this.calls.push(`stop ${reason} @${t}`);
    this.done = true;
    return [{ kind: "stop", reason, t }];
  }
  finish(t: number): RomMeasureResult {
    this.calls.push(`finish @${t}`);
    return { status: "measured", value: 130, nValid: 1 } as RomMeasureResult;
  }
}

const frame = (t: number): Frame => ({ t, lm: [], poses: [] });

describe("RomSmokeDriver", () => {
  it("answers each question after the delay, on the frames' clock, until the runner is done", () => {
    const runner = new ScriptedRunner();
    let clock = 0;
    const driver = new RomSmokeDriver(runner, { answerDelayMs: 500, now: () => (clock += 0.25) });
    driver.start(0);
    for (let t = 33; !driver.done && t < 20_000; t += 33) driver.feed(frame(t));
    expect(driver.done).toBe(true);
    // The answer at the first frame at or after the question plus 0.5 s; nothing else is asked.
    expect(runner.calls[0]).toBe("can_move true @528");
    expect(runner.calls.filter((c) => !c.startsWith("can_move") && !c.startsWith("finish"))).toEqual([]);
    const report = driver.report(20_000);
    expect(report.status).toBe("done");
    expect(report.result).toMatchObject({ status: "measured", value: 130 });
    expect(report.holds.map((h) => h.deg)).toEqual([130, 130, 130]);
    expect(report.answers).toEqual([{ kind: "can_move", t: 528, accepted: true }]);
    expect(report.events.quality).toBe(3);
    expect(report.issues).toEqual({ too_dark: 3 });
    expect(report.phases.map((p) => p[0])).toEqual(["ask_can_move", "attempt"]);
    // Every feed was timed (0.25 ms apart on the fake clock).
    expect(report.feedMs.n).toBe(report.frames);
    expect(report.feedMs.p95).toBeCloseTo(0.25, 9);
  });

  it("stops the runner at the time limit and still reports its result", () => {
    const runner = new ScriptedRunner();
    const driver = new RomSmokeDriver(runner, { answerDelayMs: 500 });
    driver.start(0);
    // can move is never answered before the limit.
    driver.feed(frame(100));
    const report = driver.report(150_000, "timeout");
    expect(runner.calls.slice(-2)).toEqual(["stop user_stop @150000", "finish @150000"]);
    expect(report.status).toBe("timeout");
    expect(report.result).toMatchObject({ status: "measured" });
  });

  it("reports a runner that throws as an error, with what it saw", () => {
    const runner = new ScriptedRunner();
    runner.feed = () => {
      throw new Error("bad state");
    };
    const driver = new RomSmokeDriver(runner, { answerDelayMs: 500 });
    driver.start(0);
    driver.feed(frame(10));
    expect(driver.done).toBe(true);
    const report = driver.report(10);
    expect(report.status).toBe("error");
    expect(report.error).toBe("bad state");
  });
});
