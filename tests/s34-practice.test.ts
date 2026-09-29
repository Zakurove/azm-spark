/**
 * S34e: a practice that keeps failing (UX spec S34e, S34i, map 2.10). The practice lift is repeated by
 * the runner at no retry cost, so the screen counts it: after two failed practices the specific fix
 * shows (S34i, for the wrong arm the fix and the arm to use), and after the third the side goes on to
 * its scored attempts, within the retry budget, never looping. The wrong arm is named by its cue.
 */
import { describe, expect, it } from "vitest";
import { camTestOf } from "../src/features/assessment/camera/controller";
import type { FlowModel } from "../src/features/assessment/flowMachine";
import { atSetup, runFixture } from "./s34-harness";

/** The arm raise at its second side (the left arm), set up: the fixture raises the right arm. */
function leftArm(): FlowModel {
  const m = atSetup("shoulder_abduction");
  return { ...m, state: { ...(m.state as { kind: "cam.setup"; i: number; side: number }), side: 1 } };
}

describe("S34e: a practice that keeps failing", () => {
  it("the wrong arm: the fix after two, then the scored attempts after the third (real timing)", () => {
    const start = leftArm();
    const test = camTestOf(start)!;
    expect(test.side).toBe("left");
    const fixes: { issue: string; last: boolean }[] = [];
    let measureAt: number | null = null;
    const run = runFixture(start, "abd-9x16", 150, {
      fast: false,
      after: (ctrl, m, t) => {
        const pf = ctrl.snapshot(t).practiceFix;
        if (pf && (fixes.length === 0 || fixes[fixes.length - 1].last !== pf.last))
          fixes.push({ issue: pf.issue, last: pf.last });
        if (measureAt === null && m.state.kind === "cam.measure") measureAt = t;
      },
      stopWhen: (m) =>
        m.state.kind !== "cam.practice" && m.state.kind.startsWith("cam.") && measureAt !== null,
    });
    // The arm to use is named, not only "try again".
    expect(run.cues).toContain("check_left_arm");
    expect(fixes[0]).toEqual({ issue: "wrong_arm", last: false });
    // Nothing loops: the practice ends within the side's budget and the side comes to its end.
    expect(fixes.some((f) => f.last)).toBe(true);
    // Then the scored attempts: the practice never loops for the whole side.
    expect(measureAt).not.toBeNull();
    expect(run.kinds).toContain("cam.measure");
  });

  it("Try now on the last fix goes on at once", () => {
    const start = leftArm();
    let pressed = false;
    const run = runFixture(start, "abd-9x16", 150, {
      fast: false,
      after: (ctrl, _m, t) => {
        const pf = ctrl.snapshot(t).practiceFix;
        if (pf?.last && !pressed) {
          pressed = true;
          const out = ctrl.practiceFixNow(t);
          expect(ctrl.snapshot(t).practiceFix).toBeNull();
          void out;
        }
      },
      stopWhen: (m) => pressed && m.state.kind === "cam.measure",
    });
    expect(pressed).toBe(true);
    expect(run.model.state.kind).toBe("cam.measure");
  });
});
