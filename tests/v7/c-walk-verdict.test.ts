/**
 * D-035 items 2 and 4: what a walk gave (src/engine/gait/verdict.ts): the data's full reading, the
 * MVP's timing only reading (3 clean cycles a side across the passes of a view group), or nothing with
 * its reasons, from the views' quality and timing metrics alone (the card runs it on a stored walk).
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

  it("is timing with 3 clean cycles a side in a group's timing only readings, with their numbers", () => {
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

  it("is none below 3 a side, with the reasons, and never shows a failed view's numbers", () => {
    const failed = view({
      view: "side",
      cycles: { left: 1, right: 2 },
      gatePassed: false,
      issues: ["too_few_cycles"],
    });
    const v = walkVerdict([failed, timing({ view: "front", cycles: { left: 2, right: 2 } })]);
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
