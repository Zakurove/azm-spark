/**
 * A simulated person for stream B: the pose of each of the 16 measured movements at an angle, in the
 * movement's view and position (simple synthetic 2D bodies of b-poses.ts), for either side. The runner
 * tests (b-runner-movements), the shell tests (b-controller, b-shell) and the e2e person source of the
 * focus check (src/features/focus/e2e/PersonSource.ts, VITE_E2E builds only) read them. The mannequin
 * fixtures of every movement are step B2's. Clearly synthetic.
 *
 * Each case builds one side (`side`); the other side is the same body turned around: the picture
 * mirrored left to right and the model's left and right labels swapped, so the other side is the one
 * nearest the phone (a side view) or moving (a front view).
 */
import type { Landmark } from "../../src/engine/types";
import type { RomMovementId, RomSide } from "../../src/movements/rom/types";
import { abductionPose, elbowExtensionPose } from "./b-driver";
import {
  UPPER_BODY,
  frontSeated,
  frontStanding,
  lyingSide,
  midOf,
  place,
  point,
  rotate,
  sideSeated,
  sideStanding,
} from "./b-poses";

const RIGHT_ARM = [14, 16, 18, 20, 22];
const RIGHT_LEG = [26, 28, 30, 32];
const RIGHT_SHANK = [28, 30, 32];
const HEAD = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** A pose scaled about the picture's middle (nearer the phone: the neck movements are filmed at about 1.5 m). */
const nearer = (px: Landmark[], k = 1.25): Landmark[] =>
  px.map((q) => ({ ...q, x: 0.5 + (q.x - 0.5) * k, y: 0.5 + (q.y - 0.5) * k }));

/** Bent forward at the hips by `deg`, the arms hanging straight down from the shoulders. */
function forwardBend(deg: number): Landmark[] {
  let px = rotate(sideStanding(), UPPER_BODY, point(sideStanding(), 24), deg);
  for (const [s, e, w] of [
    [12, 14, 16],
    [11, 13, 15],
  ]) {
    px = place(px, e, { x: px[s].x, y: px[s].y + 0.15 }, px[e].visibility);
    px = place(px, w, { x: px[s].x, y: px[s].y + 0.27 }, px[w].visibility);
  }
  return px;
}

export interface MovementCase {
  /** The side the pose builds (none for the axial side views). */
  side: RomSide;
  /** The movement angle of the start pose. */
  rest: number;
  /** An end range the simulated person reaches. */
  target: number;
  pose: (deg: number) => Landmark[];
}

/** One case per measured movement: the start angle, a target and the pose of an angle. */
export const MOVEMENT_CASES: Record<RomMovementId, MovementCase> = {
  shoulder_flexion: {
    side: "right",
    rest: 0,
    target: 120,
    pose: (d) => rotate(sideSeated(), RIGHT_ARM, point(sideSeated(), 12), -d),
  },
  shoulder_abduction: { side: "right", rest: 5, target: 130, pose: (d) => abductionPose(d) },
  shoulder_extension: {
    side: "right",
    rest: 0,
    target: 40,
    pose: (d) => rotate(sideSeated(), RIGHT_ARM, point(sideSeated(), 12), d),
  },
  elbow_extension: { side: "right", rest: 90, target: 10, pose: (d) => elbowExtensionPose(d) },
  elbow_flexion: { side: "right", rest: 0, target: 130, pose: (d) => elbowExtensionPose(d) },
  hip_flexion: {
    side: "right",
    rest: 0,
    target: 100,
    pose: (d) => rotate(lyingSide(), RIGHT_LEG, point(lyingSide(), 24), -d),
  },
  hip_extension: {
    side: "right",
    rest: 0,
    target: 15,
    pose: (d) => rotate(sideStanding(), RIGHT_LEG, point(sideStanding(), 24), d),
  },
  hip_abduction: {
    side: "right",
    rest: 0,
    target: 35,
    pose: (d) => rotate(frontStanding(), RIGHT_LEG, point(frontStanding(), 24), d),
  },
  knee_flexion: {
    side: "right",
    rest: 0,
    target: 120,
    pose: (d) => rotate(lyingSide(), RIGHT_SHANK, point(lyingSide(), 26), -d),
  },
  knee_extension: {
    side: "right",
    rest: 30,
    target: 4,
    pose: (d) => rotate(lyingSide(), RIGHT_SHANK, point(lyingSide(), 26), d),
  },
  ankle_dorsiflexion_lunge: {
    side: "right",
    rest: 0,
    target: 38,
    pose: (d) => rotate(sideStanding(), [26], point(sideStanding(), 28), d),
  },
  trunk_lateral_flexion: {
    side: "left",
    rest: 0,
    target: 25,
    pose: (d) => rotate(frontStanding(), UPPER_BODY, midOf(frontStanding(), 23, 24), d),
  },
  trunk_flexion: { side: "none", rest: 0, target: 60, pose: (d) => forwardBend(d) },
  neck_lateral_flexion: {
    side: "left",
    rest: 0,
    target: 30,
    pose: (d) => rotate(frontSeated(), HEAD, midOf(frontSeated(), 11, 12), d),
  },
  neck_flexion: {
    side: "none",
    rest: 0,
    target: 40,
    pose: (d) => nearer(rotate(sideSeated(), HEAD, { x: 0.5, y: 0.27 }, d)),
  },
  neck_extension: {
    side: "none",
    rest: 0,
    target: 35,
    pose: (d) => nearer(rotate(sideSeated(), HEAD, { x: 0.5, y: 0.27 }, -d)),
  },
};

/** The model's id of the same landmark on the other side (MediaPipe pairs; the nose stays). */
export function otherSideId(i: number): number {
  if (i === 0) return 0;
  if (i <= 10)
    return ({ 1: 4, 2: 5, 3: 6, 4: 1, 5: 2, 6: 3, 7: 8, 8: 7, 9: 10, 10: 9 } as Record<number, number>)[i];
  return i % 2 === 1 ? i + 1 : i - 1;
}

/** The same body turned around: mirrored left to right, the left and right labels swapped. */
export function turnedAround(px: readonly Landmark[]): Landmark[] {
  const out = px.map((q) => ({ ...q }));
  px.forEach((q, i) => {
    out[otherSideId(i)] = { ...q, x: 1 - q.x };
  });
  return out;
}

/**
 * The pose of a movement at an angle for a side: the case's own side as built, the other side turned
 * around (the axial movements without a side have one pose).
 */
export function movementPose(id: RomMovementId, side: RomSide): (deg: number) => Landmark[] {
  const c = MOVEMENT_CASES[id];
  if (id === "shoulder_abduction" && side !== "none") return (d) => abductionPose(d, side);
  if (c.side === "none" || side === "none" || side === c.side) return c.pose;
  return (d) => turnedAround(c.pose(d));
}
