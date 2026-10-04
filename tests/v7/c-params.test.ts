/**
 * src/engine/gait/params.ts (product v7 contract 2.8, stream C, step C1): every number the gait
 * engine uses comes from the runtime gait data or is a code constant held equal to it here (contract
 * section 11: no stream invents a threshold), and the engine chunk reads the data through named
 * imports only (D-023 gap 16).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOUBLE_SUPPORT_MIN_FPS,
  ENGINE_VERSION,
  FLAT_CONTACT_AT_OR_BELOW,
  GAIT_ENGINE,
  METRIC_DEFS,
  REPLAY_LANDMARK_IDS,
  SHARE_SIGNS,
  STORED_LIMITS,
  metricInView,
} from "../../src/engine/gait/params";
import { GAIT_DATA, GAIT_ENGINE_VERSION, gaitPattern } from "../../src/movements/gait";
import { GAIT_METRIC_IDS } from "../../src/movements/gait/types";
import { GAIT_LIMITS, REPLAY_LANDMARKS } from "../../server/modules/focus/validate";

const step = (id: string) => GAIT_DATA.preprocessing.find((p) => p.step === id)!;

describe("gait engine numbers", () => {
  it("reads the preprocessing, events and capture numbers from the data", () => {
    expect(GAIT_ENGINE.hz).toBe(step("timestamps").hz);
    expect(GAIT_ENGINE.hz).toBe(30);
    expect(GAIT_ENGINE.visibilityMin).toBe(0.5);
    expect(GAIT_ENGINE.hampel).toEqual({ window: 7, nSigma: 2 });
    expect(GAIT_ENGINE.maxGapSec).toBe(0.12);
    // «zero lag 4th order low pass Butterworth at 5 Hz (2nd order filtfilt)»
    expect(GAIT_ENGINE.butterworth).toEqual({ order: 4, cutoffHz: 5, filtfiltOrder: 2 });
    expect(GAIT_ENGINE.turnMarginSec).toBe(1);
    expect(GAIT_ENGINE.dropSteps).toEqual({ first: 2, last: 2 });
    expect(GAIT_ENGINE.heel).toEqual([29, 30]);
    expect(GAIT_ENGINE.footIndex).toEqual([31, 32]);
    expect(GAIT_ENGINE.ankle).toEqual([27, 28]);
    expect(GAIT_ENGINE.peakDistanceSec).toBe(0.4);
    expect(GAIT_ENGINE.peakProminenceShare).toBe(0.1);
    expect(GAIT_ENGINE.disagreeFrames).toBe(2);
    expect(GAIT_ENGINE.disagreeShare).toBe(0.2);
    expect(GAIT_ENGINE.singleStanceWindow).toEqual([0.35, 0.9]);
    expect(GAIT_ENGINE.strideTimePlausible).toEqual([0.5, 1.5]);
    expect(GAIT_ENGINE.frontWindowM).toEqual(GAIT_DATA.capture.overground.front.analysedWindow_m_from_phone);
    expect(GAIT_ENGINE.staticHoldMaxSec).toBe(10);
    expect(GAIT_ENGINE.staticMeasureLastSec).toBe(3);
  });

  it("reads the quality gates from the data", () => {
    expect(GAIT_ENGINE.gateVisibility).toBe(0.5);
    expect(GAIT_ENGINE.gateShare).toBe(0.9);
    expect(GAIT_ENGINE.gateLandmarks).toEqual([23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
    expect(GAIT_ENGINE.trunkLandmarks).toEqual([11, 12]);
    expect(GAIT_ENGINE.cleanCyclesPerSide).toBe(GAIT_DATA.capture.minimumCycles.perSidePerViewGroup);
    expect(GAIT_ENGINE.cleanCyclesPerSide).toBe(6);
    expect(GAIT_ENGINE.gapShareMax).toBe(0.15);
    expect(GAIT_ENGINE.fullFps).toBe(25);
    expect(GAIT_ENGINE.timingOnlyFps).toBe(20);
    expect(GAIT_ENGINE.recordAgainBelowFps).toBe(20);
    expect(DOUBLE_SUPPORT_MIN_FPS).toBe(25);
    expect(FLAT_CONTACT_AT_OR_BELOW).toBe(0);
  });

  it("knows every metric of the contract with its views", () => {
    for (const id of GAIT_METRIC_IDS) expect(METRIC_DEFS.has(id), id).toBe(true);
    expect(metricInView("cadence", "front")).toBe(true);
    expect(metricInView("cadence", "back")).toBe(false);
    expect(metricInView("pelvic_drop", "back")).toBe(true);
    expect(metricInView("hip_ext_peak", "pad_side")).toBe(false);
    expect(metricInView("arm_swing", "side")).toBe(true);
    expect(metricInView("arm_swing", "pad_side")).toBe(false);
  });

  it("holds each share sign equal to the possible threshold of the pattern that reads it", () => {
    const possible = (id: Parameters<typeof gaitPattern>[0]) =>
      gaitPattern(id).thresholds.possible as Record<string, unknown>;
    const stiffAny = possible("stiff_knee").any as Record<string, number>[];
    expect(SHARE_SIGNS.knee_swing_peak.below).toBe(stiffAny[0].knee_swing_peak_lt);
    expect(SHARE_SIGNS.knee_stance_min.atOrAbove).toBe(possible("crouch").knee_stance_min_gte);
    expect(SHARE_SIGNS.knee_stance_min.hyperextensionAtOrAbove).toBe(
      possible("recurvatum").hyperextension_gte,
    );
    expect(SHARE_SIGNS.knee_loading_peak.atOrBelow).toBe(possible("quad_avoidance").knee_loading_peak_lte);
    expect(SHARE_SIGNS.pelvic_drop.atOrAbove).toBe(possible("trendelenburg").pelvic_drop_gte);
    expect(SHARE_SIGNS.trunk_sway_range.atOrAbove).toBe(possible("duchenne_lean").trunk_sway_range_gte);
    const lean = gaitPattern("duchenne_lean").signs.find((s) => s.metric === "trunk_lean_peak");
    expect(lean?.rule).toContain("peak toward S");
    expect(SHARE_SIGNS.foot_pitch_ic.atOrBelow).toBe(possible("steppage").foot_pitch_ic_lte);
    expect(SHARE_SIGNS.foot_pitch_ic.atOrBelow).toBe(
      GAIT_DATA.findings.find((f) => f.id === "flat_or_forefoot_contact")!.thresholds.foot_pitch_ic_lte,
    );
  });

  it("stores within the route's limits and keeps the engine version of the data module", () => {
    expect(STORED_LIMITS.eventsPerView).toBe(GAIT_LIMITS.eventsPerView);
    expect(STORED_LIMITS.cyclesPerView).toBe(GAIT_LIMITS.cyclesPerView);
    expect(STORED_LIMITS.replayFrames).toBe(GAIT_LIMITS.replayFrames);
    expect([...REPLAY_LANDMARK_IDS]).toEqual([...REPLAY_LANDMARKS]);
    expect(ENGINE_VERSION).toBe(GAIT_ENGINE_VERSION);
  });

  it("reads the gait data through named imports only (D-023 gap 16)", () => {
    const dir = join(__dirname, "../../src/engine/gait");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "types.ts")) {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src, file).not.toMatch(/import\s+\w+\s+from\s+["'][^"']*gait-v7\.json["']/);
      expect(src, file).not.toMatch(/from\s+["'][^"']*movements\/gait["']/);
      expect(src, file).not.toMatch(/from\s+["'][^"']*movements\/gait\/index["']/);
    }
  });
});
