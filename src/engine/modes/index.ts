/**
 * Engine modes of the movement check (contract v2 section F): `createRunner(def, side, opts)`
 * builds the runner of a test. Pure TS, no DOM.
 *
 *   range_test     shoulder_abduction (rangeTest.ts), one side per runner
 *   trunk_control  trunk_control_seated (trunkControl.ts), both sides in one runner (the leans
 *                  alternate); `side` is the side to lean toward first (the stronger side), or
 *                  "none" for the right
 *   timed_count    arm_curl_30s and chair_stand_30s (timedCount.ts, contract v2 F part 3)
 */
import type { TestDef } from "../../movements/types";
import { RangeTestRunner } from "./rangeTest";
import { TrunkControlRunner } from "./trunkControl";
import type { RunnerOptions, TestRunner, TestSide } from "./types";

export * from "./types";
export { RangeTestRunner, RANGE_RULES } from "./rangeTest";
export { TrunkControlRunner, TRUNK_RULES } from "./trunkControl";
export { SustainedPeak } from "./common";

/** Stored with every result (spec 4.0 "engineVersion"). Bump on any change to how a value is measured. */
export const ENGINE_VERSION = "check_engine_1";

export function createRunner(def: TestDef, side: TestSide, opts: RunnerOptions = {}): TestRunner {
  switch (def.kind) {
    case "range_test":
      return new RangeTestRunner(def, side, opts);
    case "trunk_control":
      return new TrunkControlRunner(def, side, opts);
    case "timed_count":
      throw new Error(`No runner yet for ${def.id}: the timed count runner comes with timedCount.ts`);
  }
}
