/**
 * The generated fixtures kept on disk (tests/fixtures/<test>/<profile>/<case>.json), each with the
 * generator spec that makes it. tests/fixtures.test.ts checks that every file still matches its
 * spec; run `AZM_WRITE_FIXTURES=1 npx vitest run tests/fixtures.test.ts` to write them again after
 * a deliberate change to the generator.
 *
 * Together they cover every profile (chair, wheelchair, standing, weaker left, weaker right), both
 * phone shapes (9:16 and 16:9), a helper beside the person, a helper crossing between the phone and
 * the person, a touch, an occlusion, a moving phone and a fall, plus two whole timed trials: an arm
 * curl whose ground truth count is its script (truth.reps), and a chair stand in which the hands
 * start pushing on the thighs. Other cases are generated in memory by the tests that need them
 * (tests/timed-count.test.ts builds every profile and aspect of both timed tests with ground truth
 * counts). Recorded booth fixtures use the same format with source "recorded".
 */
import type { GenSpec } from "./gen";

export interface CatalogEntry {
  /** Path under tests/fixtures. */
  file: string;
  spec: GenSpec;
}

export const CATALOG: CatalogEntry[] = [
  {
    file: "shoulder_abduction/chair/raise-right-9x16.json",
    spec: {
      test: "shoulder_abduction",
      profile: "chair",
      aspect: "9:16",
      fps: 15,
      durationSec: 5,
      seed: 101,
      subject: { motions: [{ kind: "arm_raise", side: "right", peak: 150 }] },
      notes: "Front view, one person, right arm raised to 150 degrees and lowered.",
    },
  },
  {
    file: "shoulder_abduction/wheelchair/raise-left-16x9.json",
    spec: {
      test: "shoulder_abduction",
      profile: "wheelchair",
      aspect: "16:9",
      fps: 15,
      durationSec: 5,
      seed: 102,
      subject: { motions: [{ kind: "arm_raise", side: "left", peak: 140 }] },
      notes: "Wheelchair, hips mostly hidden by the chair, left arm raised to 140 degrees.",
    },
  },
  {
    file: "shoulder_abduction/weaker_left/helper-beside-9x16.json",
    spec: {
      test: "shoulder_abduction",
      profile: "weaker_left",
      aspect: "9:16",
      fps: 15,
      durationSec: 5,
      seed: 103,
      subject: { motions: [{ kind: "arm_raise", side: "left", peak: 150 }] },
      helper: { x: -0.8, z: -0.3, yaw: 20 },
      shuffle: true,
      notes:
        "Weaker left arm (reaches 60 percent of 150). A helper stands at the edge on the other side, pose order shuffled.",
    },
  },
  {
    file: "shoulder_abduction/weaker_right/helper-crossing-16x9.json",
    spec: {
      test: "shoulder_abduction",
      profile: "weaker_right",
      aspect: "16:9",
      fps: 15,
      durationSec: 4,
      seed: 104,
      helper: { x: -1.3, z: 0.6, walk: { toX: 1.3, start: 0.5, speed: 1 } },
      shuffle: true,
      notes: "A helper walks between the phone and the person (not allowed): scoring must pause.",
    },
  },
  {
    file: "shoulder_abduction/chair/helper-touch-9x16.json",
    spec: {
      test: "shoulder_abduction",
      profile: "chair",
      aspect: "9:16",
      fps: 15,
      durationSec: 4,
      seed: 105,
      helper: { x: 0.45, z: -0.2, yaw: -30, touch: { from: 1, to: 3, shoulder: "left" } },
      notes:
        "A helper beside the person puts a hand on the left shoulder from 1 to 3 s: the attempt is invalid.",
    },
  },
  {
    file: "shoulder_abduction/standing/phone-shake-16x9.json",
    spec: {
      test: "shoulder_abduction",
      profile: "standing",
      aspect: "16:9",
      fps: 15,
      durationSec: 5,
      seed: 106,
      subject: { motions: [{ kind: "arm_raise", side: "right", peak: 160 }] },
      shake: { amp: 0.004, hz: 1.5 },
      notes: "A standing user sits for the arm raise. The phone is held and moves slightly the whole time.",
    },
  },
  {
    file: "arm_curl_30s/chair/curl-right-9x16.json",
    spec: {
      test: "arm_curl_30s",
      profile: "chair",
      aspect: "9:16",
      fps: 20,
      durationSec: 5,
      seed: 107,
      subject: { motions: [{ kind: "curl", side: "right", reps: 2 }] },
      notes: "Side view with the right side to the phone, two elbow bends.",
    },
  },
  {
    file: "trunk_control_seated/wheelchair/lean-left-occluded-9x16.json",
    spec: {
      test: "trunk_control_seated",
      profile: "wheelchair",
      aspect: "9:16",
      fps: 15,
      durationSec: 5,
      seed: 108,
      subject: { motions: [{ kind: "side_lean", toward: "left", peak: 20 }] },
      occlusions: [
        { landmarks: [0], from: 0.5, to: 2 },
        { landmarks: [11], from: 2, to: 3 },
      ],
      notes:
        "Wheelchair side lean to the left. The nose (optional) is hidden 0.5 to 2 s, the left shoulder (gate) 2 to 3 s.",
    },
  },
  {
    file: "chair_stand_30s/standing/stands-9x16.json",
    spec: {
      test: "chair_stand_30s",
      profile: "standing",
      aspect: "9:16",
      fps: 20,
      durationSec: 6,
      seed: 109,
      subject: { motions: [{ kind: "chair_stand", reps: 2 }] },
      notes: "45 degree view from the front and the stronger (right) side, arms crossed, two stands.",
    },
  },
  {
    file: "chair_stand_30s/weaker_right/fall-16x9.json",
    spec: {
      test: "chair_stand_30s",
      profile: "weaker_right",
      aspect: "16:9",
      fps: 20,
      durationSec: 4,
      seed: 110,
      subject: { motions: [{ kind: "fall", at: 1.5 }] },
      notes: "45 degree view from the stronger (left) side. The person slides toward the floor at 1.5 s.",
    },
  },
  {
    file: "arm_curl_30s/weaker_left/trial-16x9.json",
    spec: {
      test: "arm_curl_30s",
      profile: "weaker_left",
      aspect: "16:9",
      fps: 20,
      durationSec: 45,
      seed: 111,
      subject: {
        motions: [
          { kind: "curl_rep", side: "left", start: 2, dur: 3 },
          { kind: "curl_rep", side: "left", start: 5.5, dur: 3 },
          ...Array.from({ length: 14 }, (_, i) => ({
            kind: "curl_rep" as const,
            side: "left" as const,
            start: 14.4 + 2 * i,
            dur: 1.6 + 0.1 * (i % 3),
          })),
          { kind: "curl_rep", side: "left", start: 42.85, dur: 1.8 },
        ],
      },
      notes:
        "Weaker left arm, side view, no weight: two slow practice bends, then bends through the whole 30 s trial (runner options: practice rest 2 s, go at about 13.15 s). Ground truth: every bend whose 80 percent point comes before go + 30 s counts; the last one comes about 0.3 s after and does not.",
    },
  },
  {
    file: "chair_stand_30s/standing/hands-9x16.json",
    spec: {
      test: "chair_stand_30s",
      profile: "standing",
      aspect: "9:16",
      fps: 20,
      durationSec: 30,
      seed: 112,
      subject: {
        arms: {
          left: { elev: 25, plane: 70, elbow: 115, across: 1 },
          right: { elev: 25, plane: 70, elbow: 115, across: 1 },
        },
        motions: [
          { kind: "stand_rep", start: 2, rise: 1.5, hold: 1.2, sit: 1.5 },
          { kind: "stand_rep", start: 7, rise: 1.5, hold: 1.2, sit: 1.5 },
          ...Array.from({ length: 5 }, (_, i) => ({
            kind: "stand_rep" as const,
            start: 17 + 2.6 * i,
            rise: 0.9,
            hold: 0.2,
            sit: 0.9,
            ...(i >= 3 ? { push: ["left" as const, "right" as const] } : {}),
          })),
        ],
      },
      notes:
        "Standard chair stand, arms crossed, 45 degree view: two practice stands, then three trial stands with the arms crossed and two pushing on the thighs with both hands (runner options: practice rest 2 s). Hand use must stop the test at the fourth trial stand.",
    },
  },
];
