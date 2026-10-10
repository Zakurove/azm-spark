/**
 * D-035 items 2 and 4: what a walk gave (src/engine/gait/verdict.ts): the data's full reading, the
 * MVP's timing only reading (D-037 item 3: 2 clean cycles a side, or 5 in all with 1 on each side,
 * across the passes of a view group; was 3 a side), or nothing with its reasons, from the views'
 * quality and timing metrics alone (the card runs it on a stored walk).
 */
import { describe, expect, it } from "vitest";
import { walkVerdict } from "../../src/engine/gait/verdict";
import type { GaitViewResult } from "../../src/engine/gait/types";
import { view } from "./c-gait-rules-fixtures";

/** A view read for timing only (the MVP's reading): timingOnly, too few cycles for the full gate. */
function timing(
  v: Parameters<typeof view>[0],
  cadence = 104,
  steps = { left: 0.6, right: 0.56 },
): GaitViewResult {
  const out = view({ ...v, gatePassed: false, issues: ["too_few_cycles"], metrics: { ...v.metrics } });
  out.quality.timingOnly = true;
  out.metrics = {
    cadence: { id: "cadence", value: cadence, n: 8, unit: "steps/min", grade: "A" },
    step_time_s: { id: "step_time_s", value: 0.58, sides: steps, n: 8, unit: "s", grade: "A" },
  };
  return out;
}

describe("the walk's verdict", () => {
  it("is full when a group passes the data's gate", () => {
    const v = walkVerdict([view({ view: "side" })]);
    expect(v.level).toBe("full");
    expect(v.cadence).not.toBeNull();
  });

  it("is timing with enough clean cycles in a group's timing only readings, with their numbers", () => {
    const v = walkVerdict([timing({ view: "side", cycles: { left: 3, right: 4 } })]);
    expect(v).toMatchObject({
      level: "timing",
      cleanCycles: { left: 3, right: 4 },
      cadence: 104,
      stepTime: { left: 0.6, right: 0.56 },
    });
  });

  it("sums the toward and away passes (front and back) as one group", () => {
    const v = walkVerdict([
      timing({ view: "front", cycles: { left: 1, right: 3 } }),
      // The back view gives no cadence (gait-rules metrics), only its cycles.
      { ...timing({ view: "back", cycles: { left: 2, right: 1 } }), metrics: {} },
    ]);
    expect(v.level).toBe("timing");
    expect(v.cleanCycles).toEqual({ left: 3, right: 4 });
  });

  it("is timing on 2 clean cycles a side, or 5 in all with 1 on each side (D-037 item 3)", () => {
    // Nasser's fourth test: 4 passes, 21 steps, 3 and 2 clean cycles, refused at 3 a side.
    expect(walkVerdict([timing({ view: "side", cycles: { left: 3, right: 2 } })]).level).toBe("timing");
    expect(walkVerdict([timing({ view: "side", cycles: { left: 2, right: 2 } })]).level).toBe("timing");
    expect(walkVerdict([timing({ view: "side", cycles: { left: 1, right: 4 } })]).level).toBe("timing");
    expect(walkVerdict([timing({ view: "side", cycles: { left: 4, right: 1 } })]).level).toBe("timing");
    // Too little: one side unseen, or 4 in all with 1 on a side.
    expect(walkVerdict([timing({ view: "side", cycles: { left: 0, right: 6 } })]).level).toBe("none");
    expect(walkVerdict([timing({ view: "side", cycles: { left: 1, right: 3 } })]).level).toBe("none");
    expect(walkVerdict([timing({ view: "side", cycles: { left: 1, right: 1 } })]).level).toBe("none");
  });

  it("reads a timing reading of 6 and 8 clean cycles as timing, never as too few (the v7.2 row)", () => {
    // The MVP's reading never passes the data's gate (its cycles keep the turn steps); with 6 a side
    // or more it no longer names too_few_cycles, and it is still a timing reading.
    const v = walkVerdict([{ ...timing({ view: "side", cycles: { left: 6, right: 8 } }) }]);
    expect(v.level).toBe("timing");
    const noIssue = timing({ view: "side", cycles: { left: 6, right: 8 } });
    noIssue.quality.issues = [];
    expect(walkVerdict([noIssue]).level).toBe("timing");
  });

  it("is none below that, with the reasons, and never shows a failed view's numbers", () => {
    const failed = view({
      view: "side",
      cycles: { left: 1, right: 2 },
      gatePassed: false,
      issues: ["too_few_cycles"],
    });
    const v = walkVerdict([failed, timing({ view: "front", cycles: { left: 1, right: 3 } })]);
    expect(v.level).toBe("none");
    expect(v.cadence).toBeNull();
    expect(v.reasons).toContain("too_few_steps");
  });

  it("names the frame rate, the wrong view, the picture and a walk the model did not follow", () => {
    expect(walkVerdict([]).reasons).toEqual(["nothing_recorded"]);
    const slow = view({
      view: "side",
      cycles: { left: 0, right: 0 },
      fps: 14,
      gatePassed: false,
      issues: ["too_few_cycles", "low_fps"],
    });
    expect(walkVerdict([slow]).reasons[0]).toBe("low_fps");
    const wrong = view({
      view: "side",
      cycles: { left: 0, right: 0 },
      gatePassed: false,
      issues: ["too_few_cycles", "wrong_view"],
    });
    expect(walkVerdict([wrong]).reasons[0]).toBe("wrong_view");
    const lost = {
      ...view({ view: "side", cycles: { left: 1, right: 0 }, gatePassed: false, issues: ["too_few_cycles"] }),
      cycles: [
        { side: "left" as const, icStart: 0, to: 1, icEnd: 2, clean: true },
        { side: "left" as const, icStart: 2, to: 3, icEnd: 4, clean: false, drop: "swap" as const },
        { side: "right" as const, icStart: 1, to: 2, icEnd: 3, clean: false, drop: "order" as const },
      ],
    };
    expect(walkVerdict([lost]).reasons).toEqual(["tracking", "too_few_steps"]);
  });
});
