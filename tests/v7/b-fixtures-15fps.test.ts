/**
 * The 8.2 matrix at the C-10 probe's floor (wave 2 fix, engine review finding 8): the probe keeps the
 * Full model down to 15 frames a second, but the matrix ran only at 24 and 30. The same cases (each
 * position, both sides or directions, 9:16 and 16:9, 25 to 100 percent, noise 0.003, frame jitter; no
 * helper or mirror) at 15 fps: every case is measured within 5 degrees, and the holds later than the
 * 8.2 bound (plateau start + 1 s + 1.5 s), all but one in portrait pictures, are listed here with their
 * delays, as LATE_HOLD_CASES lists the 24 and 30 fps ones (change log B2-3, W2-8). G3's jitter at 15 fps
 * on the reference phones decides the hold signal (D-026 item 5); this list is what it starts from.
 */
import { describe, expect, it } from "vitest";
import { ROM_MOVEMENT_IDS } from "../../src/movements/rom/types";
import { MATRIX_JITTER_MS, romSpec } from "../fixtures/rom/build";
import { matrixProblems, movementMatrix, runRom, type RomCase } from "./b-fixtures";

const FPS = 15;

/**
 * The cases at 15 fps whose holds come late, with what was seen. Since D-035 (the MVP hold, its value
 * read over the plateau the person holds) every value is within 5 degrees; one false heel lift (a
 * repeat before) is a flag. D-038 item 1 (the hold still for about 1 s, 0.6 s before): one portrait hip
 * abduction finds its hold later, and the hip's extension at 25 percent (4.3 degrees, under the MVP
 * hold's movement, as UNDER_MOVE_CASES at 30 fps) is not measured.
 */
export const LATE_HOLD_15FPS: Readonly<Record<string, readonly string[]>> = {
  // The heel lift read at 15 fps in portrait (the false repeat before D-035 is a flag now).
  "rom/ankle_dorsiflexion_lunge/standing_supported/right-50-9x16-15fps": ["attempt 1 approximate: heel_lift"],
  "rom/hip_abduction/standing_supported/left-25-9x16-15fps": [
    "repetition 1: hold 2.9 s after plateau start + 1 s",
  ],
  "rom/hip_extension/standing_supported/left-25-16x9-15fps": [
    "status not_measured (no_active_movement)",
    "0 valid attempts",
    "value null for 4.3",
    "repetition 1: hold not found after plateau start + 1 s",
  ],
};

function at15(c: RomCase): RomCase {
  const name = c.name.replace(/-\d+fps/, `-${FPS}fps`);
  return {
    ...c,
    name,
    fps: FPS,
    spec: romSpec({
      name,
      movement: c.movement,
      position: c.position,
      side: c.side,
      cameraSide: c.cameraSide,
      aspect: c.aspect,
      peak: c.truthDeg,
      fps: FPS,
      jitterMs: MATRIX_JITTER_MS,
    }),
  };
}

for (const movement of ROM_MOVEMENT_IDS)
  describe(`${movement} at 15 fps`, () => {
    for (const c of movementMatrix(movement)
      .filter((x) => !x.helper && !x.mirrored)
      .map(at15))
      it(c.name, () => {
        const run = runRom(c.spec);
        expect(matrixProblems(c, run)).toEqual(LATE_HOLD_15FPS[c.name] ?? []);
      });
  });

describe("the 15 fps list", () => {
  it("holds late holds of measured cases, all portrait, one heel lift flag and the hip's 4.3 degrees", () => {
    const all = Object.entries(LATE_HOLD_15FPS);
    expect(all.length).toBeLessThanOrEqual(3);
    const under = (name: string) => name.includes("/hip_extension/") && name.includes("-25-");
    expect(all.filter(([name]) => name.includes("-16x9-") && !under(name)).length).toBe(0);
    for (const [name, problems] of all)
      if (!under(name))
        for (const p of problems)
          expect(p).toMatch(/^repetition \d: hold [\d.]+ s after|^attempt 1 approximate: heel_lift$/);
  });
});
