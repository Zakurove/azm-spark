/**
 * Compensation timing (product v7 contract 2.6 and section 9 P2): «the runner's compensation events at the
 * cue level reach FeedbackGate.step(t, condition, events) as one off events at warn severity, never as a
 * condition (a condition waits dwellMs 2000), so the local line plays within 1 s of the onset»; «B adds a
 * timing test (a fixture compensation onset to the local line within 1 s)».
 */
import { describe, expect, it } from "vitest";
import { FeedbackGate, GATE_RULES, type GateMessage } from "../../src/engine/feedbackGate";
import type { RomEvent } from "../../src/engine/rom/types";
import { abductionPose, drive, elbowExtensionPose, runner, type Script } from "./b-driver";
import { point, rotate } from "./b-poses";

/**
 * The controller's path for a compensation line: the runner gives a compensation event at the cue level
 * followed by the cue event with its line; the line enters the gate as a one off warn event.
 */
function compensationLines(events: RomEvent[]): GateMessage[] {
  const lines: GateMessage[] = [];
  events.forEach((e, k) => {
    const next = events[k + 1];
    if (e.kind === "compensation" && e.level === "cue" && next?.kind === "cue")
      lines.push({ id: next.cue, severity: "warn", voice: next.cue });
  });
  return lines;
}

/**
 * Runs a movement with a compensation whose onset is the first frame where `onsetOf(t)` holds, feeding
 * each frame's compensation lines to a FeedbackGate; returns the onset and when the line was spoken.
 */
function timing(r: ReturnType<typeof runner>, s: Script, lineId: string, onsetOf: (t: number) => boolean) {
  const gate = new FeedbackGate();
  let onset: number | null = null;
  let spoken: number | null = null;
  drive(r, s, 60, {
    at: (t) => {
      if (onset === null && onsetOf(t)) onset = t;
    },
    until: () => spoken !== null,
    frame: (t, events) => {
      const said = gate.step(t, null, compensationLines(events)).speak;
      if (spoken === null && said.some((m) => m.id === lineId)) spoken = t;
    },
  });
  return { onset, spoken };
}

describe("a compensation's local line plays within 1 s of its onset", () => {
  it("the side arm raise: a trunk lean of 8 degrees (cue test_abd_still above 5)", () => {
    const r = runner("shoulder_abduction");
    let leanFrom = Infinity;
    const res = timing(
      r,
      {
        rest: 5,
        target: () => 100,
        pose: (deg, t) => {
          // In the first scored attempt, 1 s after the arm passes 60 degrees, the trunk leans 8 degrees.
          if (r.phase === "attempt" && deg >= 60 && leanFrom === Infinity) leanFrom = t + 1000;
          return abductionPose(deg, "right", t >= leanFrom ? 8 : 0);
        },
      },
      "test_abd_still",
      (t) => t >= leanFrom,
    );
    expect(res.onset).not.toBeNull();
    expect(res.spoken).not.toBeNull();
    expect(res.spoken! - res.onset!).toBeLessThanOrEqual(1000);
    // A condition would have waited the gate's dwell.
    expect(GATE_RULES.dwellMs).toBeGreaterThan(1000);
  });

  it("a lean that grows from 0 to 12 degrees over 3 s: the line within 1 s of passing 5", () => {
    const r = runner("shoulder_abduction");
    let from = Infinity;
    const lean = (t: number) => Math.max(0, Math.min(12, ((t - from) / 3000) * 12));
    const res = timing(
      r,
      {
        rest: 5,
        target: () => 100,
        pose: (deg, t) => {
          if (r.phase === "attempt" && deg >= 60 && from === Infinity) from = t;
          return abductionPose(deg, "right", lean(t));
        },
      },
      "test_abd_still",
      (t) => lean(t) > 5,
    );
    expect(res.spoken! - res.onset!).toBeLessThanOrEqual(1000);
  });

  it("elbow straightening: the upper arm moving 14 degrees (cue elbow_by_side above 10)", () => {
    const r = runner("elbow_extension");
    let from = Infinity;
    const res = timing(
      r,
      {
        rest: 90,
        target: () => 20,
        speed: 40,
        pose: (lack, t) => {
          if (r.phase === "attempt" && lack <= 60 && from === Infinity) from = t + 500;
          const px = elbowExtensionPose(lack);
          return t >= from ? rotate(px, [14, 16, 18, 20, 22], point(px, 12), -14) : px;
        },
      },
      "elbow_by_side",
      (t) => t >= from,
    );
    expect(res.spoken).not.toBeNull();
    expect(res.spoken! - res.onset!).toBeLessThanOrEqual(1000);
  });
});
