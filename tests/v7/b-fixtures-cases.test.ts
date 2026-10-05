/**
 * The other acceptance cases of 8.2 (product v7 contract, stream B, step B2), for each of the 16
 * measured movements in its first position: a tremor gives the 5 degree band after two tries without a
 * hold, flagged wideHold; an angle that never settles gives no_hold, then not measured today (quality)
 * once the two extra attempts are used; 11 frames a second gives quality (low_fps), then not measured.
 * The no hold and 11 fps cases run at the matrix's noise; the tremor case without landmark noise
 * (tests/v7/b-fixtures.ts TREMOR_NOISE, change log B2-7).
 */
import { describe, expect, it } from "vitest";
import { ROM_DATA } from "../../src/movements/rom";
import { ROM_MOVEMENT_IDS } from "../../src/movements/rom/types";
import { RUNNER_RULES } from "../../src/engine/rom/runner";
import { endAngle, lowFpsSpec, noHoldSpec, runRom, tremorSpec, VALUE_TOLERANCE_DEG } from "./b-fixtures";

const E = ROM_DATA.engine;

for (const id of ROM_MOVEMENT_IDS)
  describe(id, () => {
    it("a tremor: no hold in the practice nor the first attempt, then the 5 degree band, flagged wideHold", () => {
      const run = runRom(tremorSpec(id));
      const r = run.fx.truth.rom!;
      const [practice, first, ...rest] = run.records;
      expect(practice).toMatchObject({ index: 0, outcome: "practice", value: null, reasons: ["no_hold"] });
      expect(first).toMatchObject({ index: 1, outcome: "retry", value: null });
      expect(first.reasons).toContain("no_hold");
      // Each try ran the attempt's clock: 20 s from the first movement.
      expect(first.t1 - first.t0).toBeGreaterThanOrEqual(E.attemptTimeoutSeconds * 1000);
      expect(rest.map((a) => a.outcome)).toEqual(["valid", "valid", "valid"]);
      expect(run.holds.length).toBeGreaterThanOrEqual(3);
      for (const h of run.holds) expect(h.bandDeg).toBe(E.wideHoldBandDeg);
      expect(run.result).toMatchObject({ status: "measured", nValid: 3, retries: 1 });
      expect(run.result.flags).toContain("wideHold");
      const truth = endAngle(id, r.position, 75, r.side);
      for (const a of run.result.attempts)
        expect(Math.abs(a.value! - truth)).toBeLessThanOrEqual(VALUE_TOLERANCE_DEG);
    });

    it("never still: no_hold in every try, then not measured today (quality)", () => {
      const run = runRom(noHoldSpec(id));
      expect(run.holds).toEqual([]);
      const [practice, ...tries] = run.records;
      expect(practice).toMatchObject({ index: 0, outcome: "practice", reasons: ["no_hold"] });
      expect(tries.map((a) => [a.index, a.outcome])).toEqual([
        [1, "retry"],
        [1, "retry"],
        [1, "retry"],
      ]);
      for (const a of tries) expect(a.reasons).toContain("no_hold");
      expect(run.result).toMatchObject({
        status: "not_measured",
        reason: "quality",
        value: null,
        nValid: 0,
        retries: RUNNER_RULES.maxRetries,
      });
    });

    it("11 frames a second: every scored try fails the quality gate (low_fps), then not measured today (quality)", () => {
      const run = runRom(lowFpsSpec(id));
      const quality = run.events.filter((e) => e.kind === "quality");
      expect(quality.map((e) => (e.kind === "quality" ? e.issue : null))).toEqual([
        "low_fps",
        "low_fps",
        "low_fps",
      ]);
      const tries = run.records.filter((a) => a.index > 0);
      expect(tries.map((a) => [a.outcome, a.reasons])).toEqual([
        ["retry", ["low_fps"]],
        ["retry", ["low_fps"]],
        ["retry", ["low_fps"]],
      ]);
      expect(run.result).toMatchObject({
        status: "not_measured",
        reason: "quality",
        nValid: 0,
        retries: RUNNER_RULES.maxRetries,
      });
      expect(run.result.quality).toMatchObject({ ok: false, issues: ["low_fps"] });
      expect(run.result.quality.medianFps).toBeLessThan(E.fpsMin);
    });
  });
