/**
 * S0 in the workout session (council S0, 2026-09-28): while the set calibrates, a posture at or beyond
 * the absolute trunk cap is the pre-set block (sit_upright_first, the set does not start), never the
 * stop with stop_rest and an RPE for a set that never started. The stop stays for the set itself.
 */
import { describe, expect, it } from "vitest";
import { calibrationBlock, frameTrunkStop } from "../src/engine/repEngine";
import { NOSE_SIDE_MIN } from "../src/engine/trunkSafety";
import type { MetricFrame } from "../src/engine/types";
import { exerciseById } from "../src/exercises/defs";

const PRESS = exerciseById("seated_shoulder_press");
const CURL = exerciseById("seated_biceps_curl");

const frame = (lean: number, noseOffset?: number): MetricFrame => ({
  t: 1000,
  values: { trunk_lean: lean, ...(noseOffset !== undefined ? { nose_offset: noseOffset } : {}) },
  usable: [],
  framingOk: true,
});

describe("S0 while the workout calibrates", () => {
  it("a press calibrated at 27 degrees is blocked with sit_upright_first, never stopped", () => {
    expect(calibrationBlock(PRESS, frame(27))).toBe("sit_upright_first");
    expect(calibrationBlock(PRESS, frame(-27))).toBe("sit_upright_first");
    expect(calibrationBlock(PRESS, frame(12))).toBeNull();
  });

  it("a curl at 27 degrees forward is blocked; 27 backward is within its 30 degree limit", () => {
    const forward = NOSE_SIDE_MIN * 2;
    expect(calibrationBlock(CURL, frame(27, forward))).toBe("sit_upright_first");
    expect(calibrationBlock(CURL, frame(-27, forward))).toBeNull();
    expect(calibrationBlock(CURL, frame(-31, forward))).toBe("sit_upright_first");
  });

  it("the same frames during the set are a stop (the set itself keeps stop_rest)", () => {
    const stop = frameTrunkStop(PRESS, frame(27), null);
    expect(stop.map((e) => e.kind)).toEqual(["flag", "stop"]);
    expect(stop[0]).toMatchObject({ cue: "stop_rest" });
  });
});
