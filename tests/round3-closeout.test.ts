/**
 * The round 3 closeout panel (council/decisions-ux-round.md, R3C-01 to R3C-39) in the flow machine
 * (R3C-01 to R3C-05 and R3C-08, the check in and the alarm, were replaced by D-016):
 *   R3C-20  S42 knows the tired answer (its own reason line);
 *   R3C-21  S49 after a stop or any started test.
 */
import { describe, expect, it } from "vitest";
import { type FlowModel, type FlowState } from "../src/features/assessment/flowMachine";
import { contextOf, play, signedStarted, withState } from "./flow-walks";

const cam = (kind: FlowState["kind"], i = 0, side = 0, extra: Record<string, unknown> = {}) =>
  ({ kind, i, side, ...extra }) as FlowState;

/** A signed in first check at home at its plan: arm raise (0), side lean (1), arm curl (2). */
function signedPlan(): FlowModel {
  const m = signedStarted(contextOf({ position: "chair" }));
  return m.state.kind === "warnings" ? play(m, { type: "CONTINUE" }) : m;
}

describe("R3C-20 and R3C-21: S42 after tired, and S49 after a stop", () => {
  const signed = signedPlan();
  const measuring = withState(signed, cam("cam.measure"));

  it("STOP, tired, End gives S49 (UX S42: End goes to S49)", () => {
    const tired = play(measuring, { type: "STOP" }, { type: "STOP_OPTION", option: "tired" });
    expect(tired.state).toMatchObject({
      kind: "stopDone",
      option: "tired",
      reason: "stopped_symptom",
      restSec: 60,
    });
    expect(play(tired, { type: "STOP_END" }).state.kind).toBe("endQuestion");
  });

  it("a stop by choice with nothing measured still asks S49", () => {
    const choice = play(measuring, { type: "STOP" }, { type: "STOP_OPTION", option: "choice" });
    expect(choice.state).toMatchObject({ kind: "stopDone", option: "choice", reason: "by_choice" });
    expect(play(choice, { type: "STOP_END" }).state.kind).toBe("endQuestion");
  });

  it("a test started and then skipped asks S49; a check with no test started goes to the results", () => {
    const setup = withState(signed, cam("cam.setup", 2, 0));
    const skipped = play(
      { ...setup, data: { ...setup.data, started: true } },
      { type: "SKIP" },
      {
        type: "SKIP_CONFIRM",
      },
    );
    // A skip the person chose goes straight on (C27): here to the end question.
    expect(skipped.state).toEqual({ kind: "endQuestion" });
    const never = withState(signed, { kind: "test.instruction", i: 2 });
    const unstarted = { ...never, data: { ...never.data, started: false } };
    expect(unstarted.data.outcomes).toEqual({});
  });

  it("entering a camera state marks the check as started", () => {
    const instruction = withState(signed, { kind: "test.instruction", i: 0 });
    expect(instruction.data.started).toBe(false);
    const setup = withState(signed, cam("cam.setup"));
    const moved = play(setup, { type: "SETUP_OK" });
    expect(moved.data.started).toBe(true);
  });
});
