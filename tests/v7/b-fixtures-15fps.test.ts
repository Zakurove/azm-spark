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

/** The cases at 15 fps whose holds come late (or, once, a false heel lift repeat), with what was seen. */
export const LATE_HOLD_15FPS: Readonly<Record<string, readonly string[]>> = {
  "rom/shoulder_flexion/seated/left-100-9x16-15fps": ["repetition 2: hold 1.6 s after plateau start + 1 s"],
  "rom/shoulder_flexion/seated/right-100-9x16-15fps": ["repetition 1: hold 3.13 s after plateau start + 1 s"],
  "rom/shoulder_abduction/seated/left-75-9x16-15fps": ["repetition 1: hold 3.44 s after plateau start + 1 s"],
  "rom/elbow_extension/seated/left-50-9x16-15fps": ["repetition 3: hold 2.03 s after plateau start + 1 s"],
  "rom/elbow_extension/seated/left-100-9x16-15fps": [
    "repetition 1: hold 2.07 s after plateau start + 1 s",
    "repetition 3: hold 3.93 s after plateau start + 1 s",
  ],
  "rom/elbow_flexion/seated/right-75-9x16-15fps": ["repetition 3: hold 1.64 s after plateau start + 1 s"],
  "rom/hip_flexion/lying_back/left-75-9x16-15fps": ["repetition 1: hold 1.84 s after plateau start + 1 s"],
  "rom/hip_abduction/standing_supported/left-50-9x16-15fps": [
    "repetition 1: hold 4.3 s after plateau start + 1 s",
    "repetition 3: hold 1.97 s after plateau start + 1 s",
  ],
  "rom/hip_abduction/standing_supported/left-100-9x16-15fps": [
    "repetition 1: hold 4.43 s after plateau start + 1 s",
    "repetition 3: hold 3.1 s after plateau start + 1 s",
  ],
  "rom/hip_abduction/standing_supported/left-50-16x9-15fps": [
    "repetition 1: hold 1.63 s after plateau start + 1 s",
  ],
  "rom/hip_abduction/standing_supported/right-25-9x16-15fps": [
    "repetition 2: hold 1.7 s after plateau start + 1 s",
    "repetition 3: hold 1.83 s after plateau start + 1 s",
  ],
  "rom/hip_abduction/standing_supported/right-50-9x16-15fps": [
    "repetition 2: hold 2.04 s after plateau start + 1 s",
  ],
  "rom/hip_abduction/standing_supported/right-75-9x16-15fps": [
    "repetition 1: hold 1.57 s after plateau start + 1 s",
  ],
  "rom/hip_abduction/standing_supported/right-100-9x16-15fps": [
    "repetition 1: hold 2.44 s after plateau start + 1 s",
    "repetition 3: hold 1.9 s after plateau start + 1 s",
  ],
  "rom/knee_flexion/lying_back/right-25-9x16-15fps": [
    "repetition 1: hold 1.84 s after plateau start + 1 s",
    "repetition 2: hold 1.96 s after plateau start + 1 s",
  ],
  "rom/knee_extension/lying_back/left-75-9x16-15fps": ["repetition 1: hold 2.16 s after plateau start + 1 s"],
  "rom/knee_extension/lying_back/left-100-9x16-15fps": [
    "repetition 3: hold 1.77 s after plateau start + 1 s",
  ],
  "rom/knee_extension/lying_back/right-25-9x16-15fps": [
    "repetition 1: hold 1.64 s after plateau start + 1 s",
  ],
  "rom/knee_extension/lying_back/right-75-9x16-15fps": ["repetition 3: hold 1.7 s after plateau start + 1 s"],
  "rom/knee_extension/seated/right-75-9x16-15fps": ["repetition 3: hold 2.11 s after plateau start + 1 s"],
  "rom/ankle_dorsiflexion_lunge/standing_supported/right-50-9x16-15fps": [
    "1 repeats: heel_lift",
    "compensation heel_lift invalid at 9865 ms",
  ],
  "rom/neck_flexion/seated/cam-left-50-9x16-15fps": ["repetition 2: hold 2.1 s after plateau start + 1 s"],
  "rom/neck_extension/seated/cam-left-25-9x16-15fps": ["repetition 1: hold 1.57 s after plateau start + 1 s"],
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
  it("holds late holds of measured cases, all but one portrait, and one heel lift repeat", () => {
    const all = Object.entries(LATE_HOLD_15FPS);
    expect(all.length).toBeLessThanOrEqual(23);
    expect(all.filter(([name]) => name.includes("-16x9-")).length).toBeLessThanOrEqual(1);
    for (const [, problems] of all)
      for (const p of problems)
        expect(p).toMatch(
          /^repetition \d: hold [\d.]+ s after|^1 repeats: heel_lift$|^compensation heel_lift invalid/,
        );
  });
});
