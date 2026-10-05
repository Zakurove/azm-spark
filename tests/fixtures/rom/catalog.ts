/**
 * The range of motion fixtures kept on disk (tests/fixtures/rom/<movement>/<profile>/<case>.json),
 * each with the generator spec that makes it (product v7 contract 8.2, stream B, step B2).
 * tests/fixtures/catalog.ts spreads ROM_CATALOG into CATALOG, so tests/fixtures.test.ts checks every
 * file against its spec and the e2e FixturePoseSource plays them by name.
 *
 * ROM_CATALOG stays empty while contract gap CG-23 is open: tests/fixtures.test.ts (in no stream's
 * table) reads every catalogued file as a movement check fixture at a three part path whose test is a
 * v1 test id, and asks the catalog's tests to be exactly the v1 ones, so any range of motion entry
 * fails it. ROM_FIXTURES is the set to keep on disk once it is decided: one clean fixture per measured
 * movement, at the path rom/<movement>/<position>/<case>.json, written by `ROM_CATALOG = ROM_FIXTURES`
 * and `AZM_WRITE_FIXTURES=1 npx vitest run tests/fixtures.test.ts`. The whole 8.2 matrix (440 cases),
 * the compensation, tremor, no hold and 11 fps fixtures are generated in memory by the tests that read
 * them (tests/v7/b-fixtures*.test.ts), as tests/timed-count.test.ts does for the timed tests;
 * tests/v7/b-rom-catalog.test.ts measures this set.
 */
import type { CatalogEntry } from "../catalog";
import type { RomMovementId, RomPositionId, RomSide } from "../../../src/movements/rom/types";
import { MATRIX_JITTER_MS, romSpec } from "./build";

/**
 * Each movement in its first position, the right side (the right side to the phone for the axial side
 * views), 16:9 at 30 fps with the matrix's jitter and noise, at the norm mean of the matrix's reference
 * person (tests/v7/b-fixtures.ts REFERENCE; the test holds each angle to it).
 */
const SET: [RomMovementId, RomPositionId, RomSide, number][] = [
  ["shoulder_flexion", "seated", "right", 160],
  ["shoulder_abduction", "seated", "right", 151],
  ["shoulder_extension", "seated_forward", "right", 56],
  ["elbow_extension", "seated", "right", -4],
  ["elbow_flexion", "seated", "right", 149],
  ["hip_flexion", "lying_back", "right", 123],
  ["hip_extension", "standing_supported", "right", 17],
  ["hip_abduction", "standing_supported", "right", 41],
  ["knee_flexion", "lying_back", "right", 137],
  ["knee_extension", "lying_back", "right", -2],
  ["ankle_dorsiflexion_lunge", "standing_supported", "right", 29],
  ["trunk_lateral_flexion", "standing", "right", 30],
  ["trunk_flexion", "standing_supported", "none", 111],
  ["neck_lateral_flexion", "seated", "right", 27],
  ["neck_flexion", "seated", "none", 56],
  ["neck_extension", "seated", "none", 61],
];

export const ROM_FIXTURES: CatalogEntry[] = SET.map(([movement, position, side, peak]) => {
  const file = `rom/${movement}/${position}/${side === "none" ? "cam-right" : side}-100-16x9.json`;
  return {
    file,
    spec: romSpec({
      name: file.replace(/\.json$/, ""),
      movement,
      position,
      side,
      ...(side === "none" ? { cameraSide: "right" as const } : {}),
      aspect: "16:9",
      peak,
      fps: 30,
      jitterMs: MATRIX_JITTER_MS,
      notes: `${movement}, ${position}: the practice and three attempts to ${peak} degrees, each held while the maximum question comes.`,
    }),
  };
});

export const ROM_CATALOG: CatalogEntry[] = [];
