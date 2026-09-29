/**
 * Camera fixtures of the S34 browser flows (contract v3 K; VITE_E2E=1 builds only). The camera
 * session imports this module inside an `import.meta.env.VITE_E2E === "1"` branch, which the
 * production build removes.
 *
 * The scripts below are presets of the foundation FixturePoseSource: `?e2eFixture=<name>` plays one
 * through the real camera screen, runner and flow, in real time and in a loop, as a person who
 * repeats the movement: every lap starts with a few seconds of sitting still (the setup check and
 * the calibration), then the movement. Each test kind comes in both phone shapes (9:16 and 16:9).
 */
import type { Frame, Landmark } from "../../../../engine/types";
import { generate, type AspectName, type GenSpec } from "../../../../../tests/fixtures/gen";

function specs(aspect: AspectName, tag: string, seed: number): Record<string, GenSpec> {
  return {
    [`abd-${tag}`]: {
      test: "shoulder_abduction",
      profile: "chair",
      aspect,
      fps: 15,
      durationSec: 10,
      seed,
      subject: {
        motions: [{ kind: "arm_raise", side: "right", peak: 140, start: 3.5, rise: 2, hold: 1.5, lower: 2 }],
      },
      notes: "Seated, front view, still for 3.5 s, then the right arm raised to 140 degrees.",
    },
    [`lean-${tag}`]: {
      test: "trunk_control_seated",
      profile: "chair",
      aspect,
      fps: 15,
      durationSec: 11,
      seed: seed + 1,
      subject: {
        motions: [{ kind: "side_lean", toward: "right", peak: 16, start: 4.5, rise: 2, hold: 1.5, back: 2 }],
      },
      notes: "Seated, front view, sitting tall for 4.5 s, then a lean to the right and back.",
    },
    [`curl-${tag}`]: {
      test: "arm_curl_30s",
      profile: "chair",
      aspect,
      fps: 20,
      durationSec: 12,
      seed: seed + 2,
      subject: {
        motions: [3, 5, 7, 9].map((start) => ({
          kind: "curl_rep" as const,
          side: "right" as const,
          start,
          dur: 1.8,
        })),
      },
      notes: "Right side to the phone, the arm hanging still for 3 s, then four elbow bends.",
    },
    [`stand-${tag}`]: {
      test: "chair_stand_30s",
      profile: "standing",
      aspect,
      fps: 20,
      durationSec: 12,
      seed: seed + 3,
      subject: {
        arms: {
          left: { elev: 25, plane: 70, elbow: 115, across: 1 },
          right: { elev: 25, plane: 70, elbow: 115, across: 1 },
        },
        motions: [3, 6, 9].map((start) => ({
          kind: "stand_rep" as const,
          start,
          rise: 1,
          hold: 0.5,
          sit: 1,
        })),
      },
      notes: "45 degree view, arms crossed, seated still for 3 s, then three stands.",
    },
    [`leave-${tag}`]: {
      test: "shoulder_abduction",
      profile: "chair",
      aspect,
      fps: 15,
      durationSec: 12,
      seed: seed + 4,
      subject: { motions: [{ kind: "leave", at: 7 }] },
      notes: "Seated still for 7 s, then leaves the picture.",
    },
    [`crowd-${tag}`]: {
      test: "shoulder_abduction",
      profile: "chair",
      aspect,
      fps: 15,
      durationSec: 8,
      seed: seed + 5,
      helper: { x: 0.2, z: 0, yaw: 0 },
      notes: "Seated, with a second person standing close beside, overlapping.",
    },
  };
}

export const CAM_FIXTURES: Record<string, GenSpec> = {
  ...specs("9:16", "9x16", 701),
  ...specs("16:9", "16x9", 801),
};

const EMPTY = (): Landmark[] => Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));

/** The frames of a camera fixture as the camera source delivers them (lm is the first pose). */
export function camFixtureFrames(name: string): { frames: Frame[]; durationMs: number } {
  const spec = CAM_FIXTURES[name];
  if (!spec) throw new RangeError(`Unknown camera fixture ${name}`);
  const fx = generate(spec);
  return {
    frames: fx.frames.map((f) => ({
      t: f.t,
      lm: f.poses[0] ?? EMPTY(),
      poses: f.poses,
      aspect: fx.meta.aspect,
    })),
    durationMs: spec.durationSec * 1000,
  };
}
