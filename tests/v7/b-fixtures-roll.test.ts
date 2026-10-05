/**
 * Wave 2 fix (engine review finding 1): the movements read against true vertical, phone roll corrected
 * (rom-protocol trunk_lateral_flexion, trunk_flexion and ankle_dorsiflexion_lunge), on the generator's
 * rolled camera (tests/fixtures/gen.ts camera.rollDeg). With the sensor's roll (FeedEnv.rollDeg, what
 * the focus shell now feeds from useOrientation) each reads its truth; without it (no orientation
 * reading) the same picture reads against the picture's vertical, which is why the shell passes it.
 * The focus shell's wiring is checked on its source, as b-audio-unlock does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RomMovementId } from "../../src/movements/rom/types";
import { movementMatrix, runRom, VALUE_TOLERANCE_DEG } from "./b-fixtures";

const ROLL = 5;

const caseOf = (movement: RomMovementId, side?: string) =>
  movementMatrix(movement).find(
    (c) =>
      c.percent === 75 &&
      c.aspect === "9:16" &&
      !c.helper &&
      !c.mirrored &&
      (side === undefined || c.side === side || c.cameraSide === side),
  )!;

describe("a phone rolled 5 degrees on its stand (true vertical, phone roll corrected)", () => {
  const cases = [
    { movement: "trunk_lateral_flexion" as const, side: "left" },
    { movement: "trunk_lateral_flexion" as const, side: "right" },
    { movement: "trunk_flexion" as const },
    { movement: "ankle_dorsiflexion_lunge" as const },
  ];
  for (const { movement, side } of cases)
    it(`${movement}${side ? ` ${side}` : ""}: the sensor's roll gives the truth`, () => {
      const c = caseOf(movement, side);
      const spec = { ...c.spec, camera: { ...c.spec.camera, rollDeg: ROLL } };
      const run = runRom(spec, { env: { rollDeg: ROLL } });
      expect(run.result.status).toBe("measured");
      expect(Math.abs(run.result.value! - c.truthDeg)).toBeLessThanOrEqual(VALUE_TOLERANCE_DEG);
      // Without a reading the picture's vertical is read: off by about the roll on at least one side.
      const blind = runRom(spec, { env: { rollDeg: null } });
      const err = blind.result.value === null ? Infinity : Math.abs(blind.result.value - c.truthDeg);
      expect(err).toBeGreaterThan(Math.abs(run.result.value! - c.truthDeg));
    });
});

describe("the focus shell feeds the phone's orientation (useOrientation)", () => {
  const app = readFileSync(join(__dirname, "../../src/features/focus/FocusApp.tsx"), "utf8");

  it("reads the orientation sensor and passes the roll and the tilt with every frame", () => {
    expect(app).toMatch(/useOrientation\(\)/);
    expect(app).toMatch(/feed\(f, \{ rollDeg: tilt\.current\?\.rollDeg \?\? null, tilt: tilt\.current \}\)/);
    expect(app).not.toMatch(/feed\(f, \{\}\)/);
  });

  it("asks iOS for the motion permission inside the intro's start tap", () => {
    const start = app.slice(
      app.indexOf("onStart={() => {"),
      app.indexOf('session.dispatch({ type: "BEGIN" })'),
    );
    expect(start).toMatch(/orientation\.askAgain\(\)/);
  });
});
