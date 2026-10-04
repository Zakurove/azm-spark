/**
 * The gait fixtures (product v7 contract 8.3, stream C, step C2): synthetic walks
 * (tests/fixtures/gait/gen-gait.ts) and projected motion capture trials, read by name. The e2e
 * FixturePoseSource plays a name starting "gait/" through gaitFixtureFrames.
 *
 * Placeholder of step A5 (contract 1.3), filled by C2: no gait fixture yet.
 */
import type { Frame } from "../../../src/engine/types";

/** The frames of a gait fixture as the engine sees them, or null for an unknown name. */
export function gaitFixtureFrames(_name: string): Frame[] | null {
  return null;
}
