/**
 * src/engine/gait/scale.ts (gait-rules 3.5; Sports2D convert_px_to_meters and Pose2Sim
 * compute_height ported): the standing height in pixels, the pixel to metre factor from the person's
 * height, and the walking pad's belt speed.
 */
import { describe, expect, it } from "vitest";
import {
  NOSE_HEAD_FACTOR,
  TRIMMED_EXTREMA_PERCENT,
  beltMps,
  frameHeightPx,
  pxPerMetre,
  standingHeightPx,
  trimmedMean,
} from "../../src/engine/gait/scale";
import type { GaitFrame } from "../../src/engine/gait/types";
import type { Landmark } from "../../src/engine/types";
import { walk } from "../fixtures/gait/gen-gait";

function pose(points: Record<number, [number, number]>, aspect = 1, hidden: number[] = []): GaitFrame {
  const lm: Landmark[] = Array.from({ length: 33 }, (_, i) => ({
    x: points[i]?.[0] ?? 0.5,
    y: points[i]?.[1] ?? 0.5,
    z: 0,
    visibility: hidden.includes(i) ? 0.1 : 0.95,
  }));
  return { t: 0, lm, aspect };
}

/** A standing person drawn as straight segments: heel to ankle 0.04, shank 0.2, femur 0.2, hip to shoulder 0.25, shoulder to nose 0.1. */
const STANDING = pose({
  30: [0.5, 0.95],
  28: [0.5, 0.91],
  26: [0.5, 0.71],
  24: [0.5, 0.51],
  12: [0.5, 0.26],
  29: [0.52, 0.95],
  27: [0.52, 0.91],
  25: [0.52, 0.71],
  23: [0.52, 0.51],
  11: [0.52, 0.26],
  0: [0.51, 0.16],
});

describe("Pose2Sim compute_height and trimmed_mean", () => {
  it("keeps upstream's defaults", () => {
    expect(NOSE_HEAD_FACTOR).toBe(1.5);
    expect(TRIMMED_EXTREMA_PERCENT).toBe(50);
  });

  it("averages the middle half of the sorted values (int indices, as upstream)", () => {
    expect(trimmedMean([1, 2, 3, 4, 100, -50, 5, 6], 50)).toBeCloseTo((2 + 3 + 4 + 5) / 4, 12);
    // 5 values: indices int(1.25) = 1 to int(3.75) = 3
    expect(trimmedMean([5, 1, 4, 2, 3], 50)).toBeCloseTo((2 + 3) / 2, 12);
    expect(trimmedMean([7], 50)).toBe(7);
    expect(trimmedMean([], 50)).toBeNull();
    expect(trimmedMean([Number.NaN, 3], 0)).toBe(3);
  });

  it("sums foot, shank, femur, back and 1.5 times the shoulder to nose distance", () => {
    expect(frameHeightPx(STANDING, null)).toBeCloseTo(0.04 + 0.2 + 0.2 + 0.25 + 1.5 * 0.1, 12);
    // in pixel space: a 2:1 picture doubles horizontal lengths only
    const wide = pose(
      {
        ...Object.fromEntries([...Array(33).keys()].map((i) => [i, [0.5, 0.5]])),
        0: [0.6, 0.5],
        11: [0.5, 0.5],
        12: [0.5, 0.5],
      },
      2,
    );
    expect(frameHeightPx(wide, null)).toBeCloseTo(1.5 * 0.2, 12);
    expect(
      frameHeightPx(pose({ ...STANDING.lm.map((q) => [q.x, q.y] as [number, number]) }, 1, [0]), null),
    ).toBeNull();
  });

  it("measures the standing calibration of a synthetic walker close to its height", () => {
    const w = walk({ view: "side", passes: 1, seed: 61, heightM: 1.8 });
    const px = standingHeightPx(w.standing, 0)!;
    // the camera model: 50 degrees across the short side (720 px), the walker 3.5 m away
    const f = 0.5 / Math.tan((25 * Math.PI) / 180);
    const truePx = (1.8 * f) / 3.5;
    expect(Math.abs(px / truePx - 1)).toBeLessThan(0.03);
  });
});

describe("factors", () => {
  it("gives pixels per metre from the height, or null", () => {
    expect(pxPerMetre(0.85, 170)).toBeCloseTo(0.5, 12);
    expect(pxPerMetre(null, 170)).toBeNull();
    expect(pxPerMetre(0.85, null)).toBeNull();
    expect(pxPerMetre(0, 170)).toBeNull();
  });

  it("gives the belt speed from km/h and the booth belt check factor", () => {
    expect(beltMps({ padSpeedKmh: 3.6, padCorrection: null })).toBeCloseTo(1, 12);
    expect(beltMps({ padSpeedKmh: 3.6, padCorrection: 1.05 })).toBeCloseTo(1.05, 12);
    expect(beltMps({ padSpeedKmh: null, padCorrection: 1.05 })).toBeNull();
  });
});
