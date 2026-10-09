/**
 * Wave 2 fix (engine review finding 6): hip_flexion's «assisted» («A wrist within 0.3 thigh lengths of
 * the tested knee at the end range») read both wrists, and in the seated side view the far knee lies on
 * the tested knee in the picture: a far hand resting on the far knee (a common way to sit) made every
 * scored attempt invalid. The generator reports far side landmarks under the visibility floor unless
 * farSeen, so the matrix never saw a far wrist; the real model usually sees them. Here the far hand
 * rests on the far knee with the far side seen, as the real model reports it, and the tested side's own
 * hand still counts.
 */
import { describe, expect, it } from "vitest";
import { romRestDeg } from "../fixtures/gen";
import { MATRIX_NOISE, romSpec } from "../fixtures/rom/build";
import { endAngle, runRom, VALUE_TOLERANCE_DEG } from "./b-fixtures";

/** MediaPipe ids of the left wrist and hand points, and the left knee. */
const LEFT_HAND = [15, 17, 19, 21];
const LEFT_KNEE = 25;

function seatedHipSpec(
  percent: number,
  hand: "left" | "right",
  of: "left" | "right",
  aspect: "9:16" | "16:9",
) {
  const truth = endAngle("hip_flexion", "seated", percent, "right");
  const name = `rom/hip_flexion/seated/far-hand-${hand}-on-${of}-${percent}-${aspect === "9:16" ? "9x16" : "16x9"}`;
  const spec = romSpec({
    name,
    movement: "hip_flexion",
    position: "seated",
    side: "right",
    aspect,
    peak: truth,
    noise: MATRIX_NOISE,
    rom: { farSeen: [...LEFT_HAND, LEFT_KNEE] },
  });
  spec.subject = {
    ...spec.subject,
    motions: [
      ...(spec.subject?.motions ?? []),
      { kind: "rom_hand", hand, part: "knee", of, from: 0, to: spec.durationSec },
    ],
  };
  return { spec, truth };
}

describe("seated hip flexion with the other hand resting on the other knee (far side seen)", () => {
  for (const percent of [25, 50, 75])
    for (const aspect of ["9:16", "16:9"] as const)
      it(`is measured at ${percent} percent (${aspect})`, () => {
        expect(romRestDeg("hip_flexion", "seated")).toBeLessThan(
          endAngle("hip_flexion", "seated", 25, "right"),
        );
        const { spec, truth } = seatedHipSpec(percent, "left", "left", aspect);
        const run = runRom(spec);
        expect(run.result.status).toBe("measured");
        expect(Math.abs(run.result.value! - truth)).toBeLessThanOrEqual(VALUE_TOLERANCE_DEG);
        // The resting hand never reads as an assisted lift (D-035: the value would be approximate).
        expect(run.result.flags).not.toContain("approximate");
        expect(run.result.attempts.every((a) => !a.reasons.includes("assisted"))).toBe(true);
      });

  it("finds the other hand reaching across to pull the tested knee (its depth at the tested knee)", () => {
    const { spec } = seatedHipSpec(75, "left", "right", "16:9");
    const run = runRom(spec);
    // D-035: the assisted lift flags the attempt (approximate) instead of repeating it.
    expect(run.result.attempts[0].reasons).toContain("assisted");
    expect(run.result.flags).toContain("approximate");
  });

  it("still finds the tested side's own hand on the tested knee", () => {
    const { spec } = seatedHipSpec(75, "right", "right", "16:9");
    const run = runRom(spec);
    // D-035: the assisted lift flags the attempt (approximate) instead of repeating it.
    expect(run.result.attempts[0].reasons).toContain("assisted");
    expect(run.result.flags).toContain("approximate");
  });
});
