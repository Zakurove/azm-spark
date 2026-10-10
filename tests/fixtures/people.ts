/**
 * Synthetic people for the one person lock (D-037 item 4: the booth, many people in the picture): a
 * standing figure's 33 landmarks at a place and a size in the picture, facing the phone or side on,
 * normalized as the model gives them (x over the picture's width). Clearly synthetic.
 */
import type { Frame, Landmark } from "../../src/engine/types";

export interface PersonSpec {
  /** The trunk's centre across the picture (share of the width) and down it (share of the height). */
  x: number;
  y?: number;
  /** The body's height, share of the picture's height (a person nearer the phone is larger). */
  height: number;
  /** Facing the phone (the default) or side on. */
  side?: boolean;
  /** Visibility of every landmark (default 0.95). */
  visibility?: number;
}

/** A person's landmarks in a picture of `aspect` (width ÷ height). */
export function person(spec: PersonSpec, aspect: number): Landmark[] {
  const h = spec.height;
  const cy = spec.y ?? 0.5;
  const half = spec.side ? 0.03 : 0.13;
  const v = spec.visibility ?? 0.95;
  // Pixel space (units of the picture's height), relative to the trunk's centre.
  const at: Record<number, [number, number]> = {
    0: [0, -0.42],
    2: [-0.02, -0.44],
    5: [0.02, -0.44],
    7: [-0.05, -0.43],
    8: [0.05, -0.43],
    11: [-half, -0.3],
    12: [half, -0.3],
    13: [-half - 0.02, -0.12],
    14: [half + 0.02, -0.12],
    15: [-half - 0.02, 0.04],
    16: [half + 0.02, 0.04],
    23: [-half * 0.7, 0.05],
    24: [half * 0.7, 0.05],
    25: [-half * 0.7, 0.3],
    26: [half * 0.7, 0.3],
    27: [-half * 0.7, 0.53],
    28: [half * 0.7, 0.53],
    29: [-half * 0.7 - 0.02, 0.55],
    30: [half * 0.7 - 0.02, 0.55],
    31: [-half * 0.7 + 0.04, 0.56],
    32: [half * 0.7 + 0.04, 0.56],
  };
  return Array.from({ length: 33 }, (_, i) => {
    const p = at[i] ?? at[i % 2 ? 2 : 5] ?? [0, -0.42];
    const x = spec.x + (p[0] * h) / aspect;
    const y = cy + p[1] * h;
    const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    return { x, y, z: 0, visibility: inside ? v : 0.05 };
  });
}

/** A frame holding these people, in this order (the model's order is not stable: tests shuffle it). */
export function frameOf(t: number, people: Landmark[][], aspect: number): Frame {
  return { t, lm: people[0] ?? emptyLandmarks(), poses: people, aspect };
}

export const emptyLandmarks = (): Landmark[] =>
  Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
