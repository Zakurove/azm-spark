/**
 * The other acceptance cases of 8.2 (product v7 contract, stream B, step B2), for each of the 16
 * measured movements in its first position, under the MVP runner (D-035): a tremor at every end holds
 * at once in the MVP hold's 8 degrees (the protocol's wide band is never needed); an angle that never
 * settles gives no_hold, then not measured today (quality) once the two extra attempts are used; 11
 * frames a second no longer discards a held value (the quality gate's low_fps stays with the attempt).
 * The no hold and 11 fps cases run at the matrix's noise; the tremor case without landmark noise
 * (tests/v7/b-fixtures.ts TREMOR_NOISE, change log B2-7).
 */
import { describe, expect, it } from "vitest";
import { ROM_DATA } from "../../src/movements/rom";
import { ROM_MOVEMENT_IDS } from "../../src/movements/rom/types";
import { RUNNER_RULES } from "../../src/engine/rom/runner";
import { MVP_HOLD } from "../../src/engine/rom/hold";
import { endAngle, lowFpsSpec, noHoldSpec, runRom, tremorSpec, VALUE_TOLERANCE_DEG } from "./b-fixtures";

const E = ROM_DATA.engine;

for (const id of ROM_MOVEMENT_IDS)
  describe(id, () => {
    it("a tremor at every end: held at once in the MVP band, measured on the first attempt", () => {
      const run = runRom(tremorSpec(id));
      const r = run.fx.truth.rom!;
      const [practice, first, ...rest] = run.records;
      expect(practice).toMatchObject({ index: 0, outcome: "practice" });
      expect(practice.value).not.toBeNull();
      expect(first).toMatchObject({ index: 1, outcome: "valid" });
      expect(rest).toEqual([]);
      expect(run.holds).toHaveLength(1);
      for (const h of run.holds) expect(h.bandDeg).toBe(MVP_HOLD.halfBandDeg);
      expect(run.result).toMatchObject({ status: "measured", nValid: 1, retries: 0 });
      expect(run.result.flags).not.toContain("wideHold");
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

    it("11 frames a second: measured on the first attempt, low_fps kept with it (D-035)", () => {
      const run = runRom(lowFpsSpec(id));
      expect(run.events.filter((e) => e.kind === "quality")).toEqual([]);
      const tries = run.records.filter((a) => a.index > 0);
      expect(tries.map((a) => a.outcome)).toEqual(["valid"]);
      expect(tries[0].quality.issues).toContain("low_fps");
      expect(run.result).toMatchObject({ status: "measured", nValid: 1, retries: 0 });
      expect(run.result.quality).toMatchObject({ ok: true, issues: [] });
      expect(run.result.quality.medianFps).toBeLessThan(E.fpsMin);
      const r = run.fx.truth.rom!;
      const truth = endAngle(id, r.position, 75, r.side);
      expect(Math.abs(run.result.value! - truth)).toBeLessThanOrEqual(VALUE_TOLERANCE_DEG);
    });
  });
