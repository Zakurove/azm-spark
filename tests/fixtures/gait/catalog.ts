/**
 * The gait fixtures (product v7 contract 8.3, stream C, step C2): named synthetic walks
 * (tests/fixtures/gait/gen-gait.ts) and the pattern walks of the acceptance. The e2e
 * FixturePoseSource plays a name starting "gait/" through gaitFixtureFrames; the projected motion
 * capture walks are read from disk by tests/fixtures/gait/mocap.ts (node only, not in a browser
 * bundle).
 *
 * A pattern walk changes the synthetic walker the way a gait-rules 5 pattern changes a walk, at a
 * mild severity (the rule's possible) and a strong one (its likely), so each rule can be shown to
 * fire on its own walk and on nothing else. Where the rule data cap a pattern at possible, the strong
 * walk expects possible too (`why`).
 */
import type { GaitPatternId } from "../../../src/medical/gait-types";
import type { Frame } from "../../../src/engine/types";
import { singleLegStance, walk, type Side, type WalkSpec } from "./gen-gait";

export interface GaitCatalogEntry {
  /** The name after "gait/". */
  name: string;
  spec: WalkSpec;
  notes: string;
}

/**
 * Speed and cadence pairs of the synthetic sweep (m/s, steps a minute). The cadences sit inside what
 * the adults of the treadmill fixtures walked at those speeds (Fukuchi 2018, wbds-*: 56 to 89 steps a
 * minute at 0.43 to 0.55 m/s, 99 to 120 at 0.92 to 1.12, 127 to 169 at 1.40 to 1.71).
 */
export const SPEED_CADENCE: readonly [number, number][] = [
  [0.4, 68],
  [0.5, 76],
  [0.6, 84],
  [0.8, 96],
  [1.0, 104],
  [1.2, 108],
  [1.4, 116],
  [1.6, 124],
];

const SEED = 800;

/** The views of a capture: the overground plan (front and back from one recording, then side) and the pad's. */
export function viewSpecs(
  mode: "overground" | "walking_pad",
  over: Partial<WalkSpec> = {},
  seed = SEED,
): { spec: WalkSpec; view: WalkSpec["view"] }[] {
  if (mode === "overground") {
    const front: WalkSpec = { view: "front", passes: 6, passShiftM: 0.6, seed, ...over };
    return [
      { spec: front, view: "front" },
      { spec: front, view: "back" },
      { spec: { view: "side", passes: 4, passShiftM: 0.6, seed: seed + 1, ...over }, view: "side" },
    ];
  }
  return [
    { spec: { view: "pad_side", nearSide: "right", durationSec: 30, seed, ...over }, view: "pad_side" },
    {
      spec: { view: "pad_side", nearSide: "left", durationSec: 30, seed: seed + 1, ...over },
      view: "pad_side",
    },
    { spec: { view: "pad_front", durationSec: 30, seed: seed + 2, ...over }, view: "pad_front" },
  ];
}

export interface GaitPatternFixture {
  pattern: GaitPatternId;
  severity: "mild" | "strong";
  /** The side the pattern is on (both for the two sided forms). */
  side: Side | "both";
  mode: "overground" | "walking_pad";
  /** The walker's modifiers, in every view of the mode. */
  walk: Partial<WalkSpec>;
  expect: "possible" | "likely";
  /** Why the status is not the severity's own. */
  why?: string;
  /** Other results the same walk fires by the rules as written, each with its reason. */
  companions?: { result: string; why: string }[];
}

/** The pattern walks: each rule of gait-rules 5.1 to 5.11 at a mild and a strong severity. */
export const GAIT_PATTERN_FIXTURES: readonly GaitPatternFixture[] = [
  {
    pattern: "shorter_stance",
    severity: "mild",
    side: "left",
    mode: "overground",
    // The right leg stands 65.5% of its cycle: the left single support (the right swing) is shorter.
    // At 30 fps the ratio moves by about one frame over the single support (0.08 at 100 steps a
    // minute, wider than the possible band 1.11 to 1.16), so the mild walk is a slower one.
    walk: { speed: 0.8, cadence: 84, stanceBy: { right: 0.655 } },
    expect: "possible",
  },
  {
    pattern: "shorter_stance",
    severity: "strong",
    side: "left",
    mode: "walking_pad",
    walk: { speed: 1.1, cadence: 100, stanceBy: { left: 0.58, right: 0.66 } },
    expect: "likely",
  },
  {
    pattern: "trendelenburg",
    severity: "mild",
    side: "right",
    mode: "overground",
    walk: { pelvicDrop: { right: 11 } },
    expect: "possible",
  },
  {
    pattern: "trendelenburg",
    severity: "strong",
    side: "right",
    mode: "walking_pad",
    walk: { pelvicDrop: { right: 15 } },
    expect: "possible",
    why: "likely needs the static single leg stance, which never raises Trendelenburg until its threshold is tuned (D-026 item 7)",
  },
  {
    pattern: "duchenne_lean",
    severity: "mild",
    side: "left",
    mode: "overground",
    walk: { trunkLean: { left: 12, right: -4 } },
    expect: "possible",
  },
  {
    pattern: "duchenne_lean",
    severity: "strong",
    side: "left",
    mode: "walking_pad",
    walk: { trunkLean: { left: 16, right: -4 } },
    expect: "likely",
  },
  {
    pattern: "waddling",
    severity: "mild",
    side: "both",
    mode: "overground",
    walk: { pelvicDrop: { left: 11, right: 11 }, trunkLean: 6 },
    expect: "possible",
    companions: [
      {
        result: "duchenne_lean:left:possible",
        why: "the lean of each side is the sway waddling describes, not shown (C3-4)",
      },
      {
        result: "duchenne_lean:right:possible",
        why: "the lean of each side is the sway waddling describes, not shown (C3-4)",
      },
    ],
  },
  {
    pattern: "waddling",
    severity: "strong",
    side: "both",
    mode: "walking_pad",
    walk: { pelvicDrop: { left: 15, right: 15 }, trunkLean: 7 },
    expect: "possible",
    why: "waddling is possible only (statusMax)",
    companions: [
      {
        result: "duchenne_lean:left:possible",
        why: "the lean of each side is the sway waddling describes, not shown (C3-4)",
      },
      {
        result: "duchenne_lean:right:possible",
        why: "the lean of each side is the sway waddling describes, not shown (C3-4)",
      },
    ],
  },
  {
    pattern: "stiff_knee",
    severity: "mild",
    side: "left",
    mode: "overground",
    // The knee bends at most 42 degrees in swing; the pelvis rises over the right foot to clear it.
    walk: { swingKnee: { left: 42 } },
    expect: "possible",
  },
  {
    pattern: "stiff_knee",
    severity: "strong",
    side: "left",
    mode: "walking_pad",
    walk: { swingKnee: { left: 34 }, liftBy: { left: 0.015 } },
    expect: "likely",
  },
  {
    pattern: "steppage",
    severity: "mild",
    side: "left",
    mode: "overground",
    walk: { speed: 0.55, cadence: 84, highStep: { left: 0.04 }, contactPitch: { left: -2 } },
    expect: "possible",
    why: "likely needs 0.6 m/s or more; the rule separates its two statuses by speed and consistency, not by size",
  },
  {
    pattern: "steppage",
    severity: "strong",
    side: "left",
    mode: "walking_pad",
    walk: { speed: 1.1, highStep: { left: 0.05 }, contactPitch: { left: -6 } },
    expect: "likely",
  },
  {
    pattern: "crouch",
    severity: "mild",
    side: "left",
    mode: "overground",
    walk: { stanceKnee: { left: 18 } },
    expect: "possible",
  },
  {
    pattern: "crouch",
    severity: "strong",
    side: "both",
    mode: "walking_pad",
    walk: { stanceKnee: { left: 25, right: 25 } },
    expect: "likely",
  },
  {
    pattern: "recurvatum",
    severity: "mild",
    side: "left",
    mode: "overground",
    walk: { stanceKnee: { left: -12 } },
    expect: "possible",
  },
  {
    pattern: "recurvatum",
    severity: "strong",
    side: "left",
    mode: "walking_pad",
    walk: { stanceKnee: { left: -18 } },
    expect: "likely",
  },
  {
    pattern: "quad_avoidance",
    severity: "mild",
    side: "left",
    mode: "overground",
    walk: { loadingKnee: { left: -2 } },
    expect: "possible",
  },
  {
    pattern: "quad_avoidance",
    severity: "strong",
    side: "left",
    mode: "walking_pad",
    walk: { loadingKnee: { left: -4 } },
    expect: "possible",
    why: "quad_avoidance is possible only (statusMax)",
  },
  {
    pattern: "reduced_extension",
    severity: "mild",
    side: "left",
    mode: "walking_pad",
    // The left foot lands 13 cm further ahead, so it trails less far behind; its loading knee kept.
    walk: { contactShift: { left: 0.13 }, loadingKnee: { left: 16 } },
    expect: "possible",
    why: "capped at possible on the pad; overground a deficit of 8 degrees comes with the other leg's short step, which corroborates it",
  },
  {
    pattern: "reduced_extension",
    severity: "strong",
    side: "left",
    mode: "overground",
    walk: { contactShift: { left: 0.17 }, loadingKnee: { left: 16 } },
    expect: "likely",
  },
  {
    pattern: "short_steps",
    severity: "mild",
    side: "both",
    mode: "overground",
    // Short steps at an ordinary cadence: below the expected stride for the speed (b) only.
    walk: { speed: 0.6, cadence: 104, armSwing: 12 },
    expect: "possible",
  },
  {
    pattern: "short_steps",
    severity: "strong",
    side: "both",
    mode: "overground",
    // Short quick steps with a small arm swing and a forward trunk: (a), (b) and (c).
    walk: { speed: 0.8, cadence: 120, armSwing: 8, trunkForward: 6 },
    expect: "likely",
  },
];

/** Named synthetic walks for the e2e pose source and the capture screens. */
export const GAIT_CATALOG: readonly GaitCatalogEntry[] = [
  {
    name: "pad-side-right",
    spec: { view: "pad_side", nearSide: "right", durationSec: 30, seed: 901, noise: 0.002, jitterMs: 4 },
    notes: "Walking pad from the right side at 1.2 m/s, 108 steps a minute: a typical walk.",
  },
  {
    name: "pad-side-left",
    spec: { view: "pad_side", nearSide: "left", durationSec: 30, seed: 902, noise: 0.002, jitterMs: 4 },
    notes: "Walking pad from the left side: a typical walk.",
  },
  {
    name: "pad-front",
    spec: { view: "pad_front", durationSec: 30, seed: 903, noise: 0.002, jitterMs: 4 },
    notes: "Walking pad from the front: a typical walk.",
  },
  {
    name: "overground-side",
    spec: { view: "side", passes: 4, seed: 904, noise: 0.002, jitterMs: 4 },
    notes: "Four side passes in alternating directions with turns out of view: a typical walk.",
  },
  {
    name: "overground-front",
    spec: { view: "front", passes: 6, passShiftM: 0.35, seed: 905, noise: 0.002, jitterMs: 4 },
    notes: "Six walks toward the phone, each followed by a walk away: a typical walk (front and back views).",
  },
  {
    name: "overground-front-short",
    spec: {
      view: "front",
      passes: 4,
      passShiftM: 0.35,
      seed: 905,
      noise: 0.002,
      jitterMs: 4,
      speed: 1,
      cadence: 120,
    },
    notes:
      "Four walks toward the phone and back with steps of 0.5 m: the front and back views together give each side its clean cycles at the capture's first checkpoint (step C4).",
  },
  {
    name: "home-side",
    spec: {
      view: "side",
      passes: 6,
      seed: 908,
      home: { pathM: 3 },
      passShiftM: 0.3,
      camera: { distance: 3 },
      noise: 0.002,
      jitterMs: 8,
    },
    notes:
      "At home (D-035 item 2): six passes across the picture and back on a 3 m path, 3 m from a phone on a shelf, each turn in place inside the picture.",
  },
  {
    name: "home-wall",
    spec: {
      view: "front",
      passes: 4,
      seed: 909,
      home: { farM: 4.5, nearM: 1.2 },
      passShiftM: 0.4,
      camera: { lateral: 0.3 },
      noise: 0.002,
      jitterMs: 8,
    },
    notes:
      "At home (D-035 item 2): four walks toward a phone standing against a wall, each turning a step before it and walking back, nobody leaving the picture.",
  },
  {
    name: "pad-side-right-weaker-right",
    spec: {
      view: "pad_side",
      nearSide: "right",
      durationSec: 30,
      seed: 906,
      noise: 0.002,
      jitterMs: 4,
      speed: 0.9,
      cadence: 96,
      swingKnee: { right: 42 },
      stanceBy: { left: 0.67 },
    },
    notes:
      "Walking pad from the right side, a weaker right leg after a stroke: a stiff right knee in swing and a shorter right single support (the showcase person).",
  },
  {
    name: "pad-front-hip-dip-right",
    spec: {
      view: "pad_front",
      durationSec: 30,
      seed: 907,
      noise: 0.002,
      jitterMs: 4,
      pelvicDrop: { right: 12 },
    },
    notes: "Walking pad from the front with a 12 degree hip dip of the left side in the right single stance.",
  },
];

/**
 * The static single leg stance as the capture asks it (step C4): 4 s on both feet facing the phone,
 * 10 s on the right leg, 3 s on both feet, 10 s on the left leg, at 30 frames a second on one clock.
 */
export function stanceFixtureFrames(): Frame[] {
  const fps = 30;
  const right = singleLegStance({ side: "right", dropDeg: 3, holdSec: 10, noise: 0.002, seed: 911 });
  const left = singleLegStance({ side: "left", dropDeg: 3, holdSec: 10, noise: 0.002, seed: 912 });
  const still = right.standing;
  const out: Frame[] = [];
  const push = (lm: Frame["lm"], aspect: number) => {
    const t = (out.length * 1000) / fps;
    out.push({ t, lm, poses: [lm], aspect });
  };
  const stand = (sec: number) => {
    for (let i = 0; i < sec * fps; i++) push(still[i % still.length].lm, still[0].aspect);
  };
  stand(4);
  for (const f of right.frames) push(f.lm, f.aspect);
  stand(3);
  for (const f of left.frames) push(f.lm, f.aspect);
  stand(2);
  return out;
}

/** The frames a camera delivers for a catalog walk: the standing calibration, then the walk. */
export function gaitFixtureFrames(name: string): Frame[] | null {
  const key = name.startsWith("gait/") ? name.slice("gait/".length) : name;
  if (key === "stance") return stanceFixtureFrames();
  const entry = GAIT_CATALOG.find((e) => e.name === key);
  if (!entry) return null;
  const w = walk(entry.spec);
  return [...w.standing, ...w.frames].map((f) => ({ t: f.t, lm: f.lm, poses: [f.lm], aspect: f.aspect }));
}
