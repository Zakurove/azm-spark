/**
 * The 8.2 acceptance on the synthetic fixtures (product v7 contract 8.2, stream B, step B2), trunk and neck:
 * every case of the matrix (tests/v7/b-fixtures.ts movementMatrix: each position, both sides or
 * directions, 9:16 and 16:9, 25 to 100 percent of the norm mean, noise 0.003, 24 and 30 fps with
 * jitter, a helper beside, the mirrored picture) is measured with three valid attempts, nothing
 * repeated or coached, every recorded value within 5 degrees of the generator's truth, and each
 * attempt's hold found within 1.5 s of the true plateau start plus the hold second; the few portrait
 * holds that come later at this noise are listed with their delays (LATE_HOLD_CASES, change log B2-3).
 */
import { describe, expect, it } from "vitest";
import type { RomMovementId } from "../../src/movements/rom/types";
import { HOLD_SEC, LATE_HOLD_CASES, matrixProblems, movementMatrix, runRom } from "./b-fixtures";

const MOVEMENTS: RomMovementId[] = [
  "trunk_lateral_flexion",
  "trunk_flexion",
  "neck_lateral_flexion",
  "neck_flexion",
  "neck_extension",
];

for (const movement of MOVEMENTS)
  describe(movement, () => {
    for (const c of movementMatrix(movement))
      it(c.name, () => {
        const run = runRom(c.spec, { mirrored: c.mirrored });
        expect(matrixProblems(c, run)).toEqual(LATE_HOLD_CASES[c.name] ?? []);
      });
  });

describe("the late holds", () => {
  it("are portrait pictures only, late holds only, each found while the person still holds", () => {
    const all = Object.entries(LATE_HOLD_CASES);
    expect(all.length).toBeLessThanOrEqual(4);
    for (const [name, problems] of all) {
      expect(name).toMatch(/-9x16-/);
      for (const p of problems) {
        const m = /^repetition \d: hold ([\d.]+) s after plateau start \+ 1 s$/.exec(p);
        expect(m, p).not.toBeNull();
        expect(Number(m![1])).toBeLessThan(HOLD_SEC - 1);
      }
    }
  });
});
