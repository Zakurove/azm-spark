/**
 * The compensation checks of the 16 movements (src/engine/rom/compensations.ts, product v7 contract 2.6
 * and 8.1): every check against the data (ids, cue lines, numbers), and on poses that set its measure,
 * firing at its level plus 2 (degrees or percent points; 0.02 for ratios and shares) and quiet at its
 * level minus 2, at the cue, invalid or flag level. With AZM_CLINICAL_V7 set to the clinical folder,
 * every check, cue and invalid text of rom-protocol.json is quoted in compensations.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Landmark } from "../../src/engine/types";
import { RANGE_RULES } from "../../src/engine/modes/rangeTest";
import {
  COMPENSATIONS,
  CompensationTracker,
  checksFor,
  type CompensationHit,
  type HoldVerdict,
} from "../../src/engine/rom/compensations";
import type { AngleContext } from "../../src/engine/rom/angles";
import { compensationDef, movementDef } from "../../src/movements/rom";
import {
  ROM_MOVEMENT_IDS,
  type CompensationId,
  type RomMovementId,
  type RomPositionId,
  type RomSide,
} from "../../src/movements/rom/types";
import {
  UPPER_BODY,
  calibratedContext,
  frontSeated,
  frontStanding,
  hide,
  lyingSide,
  midOf,
  place,
  point,
  rotate,
  scaleSegment,
  shift,
  sideSeated,
  sideStanding,
  turnPoint,
} from "./b-poses";

/* ------------------------------------------------------------------ the data */

describe("the checks follow the data", () => {
  it("each movement has exactly its data's checks, in order, with the data's cue lines and numbers", () => {
    for (const id of ROM_MOVEMENT_IDS) {
      const def = movementDef(id);
      expect(COMPENSATIONS[id].map((c) => c.id)).toEqual(def.compensationIds);
      expect(def.compensations.map((c) => c.id)).toEqual(def.compensationIds);
      for (const c of COMPENSATIONS[id]) {
        const d = compensationDef(id, c.id);
        expect({ cue: c.cue, cueAt: c.cueAt, invalidAt: c.invalidAt }).toEqual({
          cue: d.cue,
          cueAt: d.cueAt,
          invalidAt: d.invalidAt,
        });
      }
    }
  });

  it("the side arm raise reads v1's numbers where the data writes none (v1 4.1, RANGE_RULES)", () => {
    const abd = Object.fromEntries(COMPENSATIONS.shoulder_abduction.map((c) => [c.id, c]));
    expect(abd.trunk_lean.gravity).toMatchObject({ cueAt: 0.08, invalidAt: 0.15 });
    expect(abd.trunk_lean.gravity!.cueAt).toBe(RANGE_RULES.gravityLeanCue);
    expect(abd.shrug.detect!.at).toBe(RANGE_RULES.shrugCue);
    expect(abd.plane.window).toEqual({ passFrom: 60, passTo: 120, practiceReference: true });
    expect([RANGE_RULES.planeFlexionFrom, RANGE_RULES.planeFlexionTo]).toEqual([60, 120]);
    expect(compensationDef("shoulder_abduction", "plane").windowDeg).toEqual([...RANGE_RULES.planeWindow]);
    expect(compensationDef("shoulder_abduction", "plane").forSeconds).toBe(RANGE_RULES.planeMinSec);
    expect(compensationDef("shoulder_abduction", "plane").invalidAt).toBe(0.85);
    expect(RANGE_RULES.assistShoulderWidths).toBe(0.25);
    // The arm raise to the front reads its window from the data.
    const flex = COMPENSATIONS.shoulder_flexion.find((c) => c.id === "plane")!;
    expect([flex.window!.passFrom, flex.window!.passTo]).toEqual(
      compensationDef("shoulder_flexion", "plane").windowDeg,
    );
  });

  it("the forward bend's hands on the thighs reads its distance from the data (B1-2, D-026 item 4)", () => {
    // The sign off wrote v1's near reading into the clinical source: 0.25 shoulder widths, flag only.
    expect(compensationDef("trunk_flexion", "hands_support")).toMatchObject({
      effect: "flag",
      flagAt: 0.25,
      unit: "shoulder_widths",
      when: "below",
    });
    expect(compensationDef("trunk_flexion", "hands_support").flagAt).toBe(RANGE_RULES.assistShoulderWidths);
    // No placeholder level in code: the tracker reads flagAt and when from the data.
    expect(COMPENSATIONS.trunk_flexion.find((c) => c.id === "hands_support")!.detect).toBeUndefined();
  });

  it("position only checks: the seated lean back only seated, the knee bends only standing", () => {
    expect(checksFor("knee_extension", "lying_back").map((c) => c.id)).toEqual(["plane"]);
    expect(checksFor("knee_extension", "seated").map((c) => c.id)).toEqual(["plane", "seated_lean_back"]);
    expect(checksFor("trunk_lateral_flexion", "seated_armrests").map((c) => c.id)).not.toContain("knee_bend");
    expect(checksFor("trunk_flexion", "seated").map((c) => c.id)).toEqual(["hands_support"]);
  });

  it.skipIf(!process.env.AZM_CLINICAL_V7)("every check, cue and invalid text is quoted word for word", () => {
    const dir = process.env.AZM_CLINICAL_V7!;
    const source = JSON.parse(readFileSync(join(dir, "rom-protocol.json"), "utf8")) as {
      movements: {
        id: RomMovementId;
        compensations: { id: string; check: string; cue: string; invalid: string }[];
      }[];
    };
    const text = readFileSync(join(__dirname, "../../src/engine/rom/compensations.ts"), "utf8")
      .split("\n")
      .map((l) => l.replace(/^\s*(\/\*\*|\*\/|\*|\/\/)?\s?/, ""))
      .join(" ")
      .replace(/\s+/g, " ");
    for (const m of source.movements)
      for (const c of m.compensations)
        for (const field of ["check", "invalid"] as const) {
          const quote = `«${c[field].replace(/\s+/g, " ").trim()}`;
          expect(text.includes(quote), `${m.id} ${c.id} ${field}: ${c[field]}`).toBe(true);
        }
  });
});

/* ------------------------------------------------------------------ running a tracker */

const FPS = 30;

interface Run {
  hits: CompensationHit[];
  hold: HoldVerdict;
}

/** Calibrates on `start`, then feeds `seconds` of the edited pose, and reads the hold over the last second. */
function track(
  movement: RomMovementId,
  side: RomSide,
  start: Landmark[],
  frame: Landmark[],
  opts: {
    position?: RomPositionId;
    angle?: number | null;
    seconds?: number;
    ctx?: AngleContext;
    holdDeg?: number;
  } = {},
): Run {
  const def = movementDef(movement);
  const ctx = opts.ctx ?? calibratedContext(movement, side, start);
  const tracker = new CompensationTracker(def, opts.position ?? def.positions[0].id);
  tracker.calibrate(
    Array.from({ length: 15 }, () => ({ px: start })),
    ctx,
  );
  tracker.startAttempt(false);
  const hits: CompensationHit[] = [];
  const seconds = opts.seconds ?? 1.5;
  let t = 0;
  for (let i = 0; i <= seconds * FPS; i++) {
    t = 10_000 + (i * 1000) / FPS;
    hits.push(...tracker.frame({ t, px: frame, ctx, angle: opts.angle === undefined ? 60 : opts.angle }));
  }
  return { hits, hold: tracker.atHold(t - 1000, t, opts.holdDeg ?? 90) };
}

type Level = "cue" | "invalid" | "flag";

interface Case {
  movement: RomMovementId;
  check: CompensationId;
  side?: RomSide;
  position?: RomPositionId;
  start: () => Landmark[];
  /** The start pose with the check's value set to `amount`, in the data's unit. */
  apply: (start: Landmark[], amount: number) => Landmark[];
  /** The levels to test: the data's number, the direction it fires in, the step (2 or 0.02). */
  levels: { level: Level; at: number; dir: 1 | -1; step: number }[];
  angle?: number;
}

const has = (r: Run, id: CompensationId, level: Level) =>
  level === "flag"
    ? r.hold.flagged.includes(id)
    : level === "invalid"
      ? r.hits.some((h) => h.id === id && h.level === "invalid") || r.hold.invalid.includes(id)
      : r.hits.some((h) => h.id === id && h.level === "cue");

/** Upper arm, forearm and hand ids of the person's right side. */
const RIGHT_ARM = [14, 16, 18, 20, 22];
const RIGHT_FOREARM = [16, 18, 20, 22];
const RIGHT_SHANK = [28, 30, 32];
const LEFT_SHANK = [27, 29, 31];

/** The right arm raised to the front by `deg` in the seated side view. */
const armRaised = (deg: number) => () => rotate(sideSeated(), RIGHT_ARM, point(sideSeated(), 12), -deg);
/** The forearm turned about the elbow so that the elbow angle ang(S - E, W - E) is `deg` (from straight). */
const elbowAt = (px: Landmark[], deg: number) => setElbow(px, deg);
/**
 * The forearm placed so that the elbow angle ang(S - E, W - E) is exactly `deg`: turned from the straight
 * continuation of the upper arm by 180 - deg; the hand points move with the wrist.
 */
function setElbow(px: Landmark[], deg: number, s = 12, e = 14, w = 16, hand = [18, 20, 22]): Landmark[] {
  const u = { x: px[e].x - px[s].x, y: px[e].y - px[s].y };
  const n = Math.hypot(u.x, u.y);
  const len = Math.hypot(px[w].x - px[e].x, px[w].y - px[e].y);
  const straight = { x: px[e].x + (u.x / n) * len, y: px[e].y + (u.y / n) * len };
  const to = turnPoint(straight, point(px, e), 180 - deg);
  const dx = to.x - px[w].x;
  const dy = to.y - px[w].y;
  return shift(px, [w, ...hand], dx, dy);
}
/** The side view's forearm forward (the elbow at a right angle): the elbow straightening start. */
const forearmForward = () => rotate(sideSeated(), RIGHT_FOREARM, point(sideSeated(), 14), -90);
/** The trunk and everything above it turned about `hip` by `deg` (positive toward the face in the side views). */
const tilt = (px: Landmark[], deg: number, hip = 24) => rotate(px, UPPER_BODY, point(px, hip), deg);
const tiltFront = (px: Landmark[], deg: number) => rotate(px, UPPER_BODY, midOf(px, 23, 24), deg);
/** A knee bent by `deg` (the shank turned about the knee). */
const kneeBent = (px: Landmark[], knee: number, shank: number[], deg: number) =>
  rotate(px, shank, point(px, knee), deg);
/** Both shoulders moved toward their middle: a shoulder width shrink of `pct` percent. */
const shrinkShoulders = (px: Landmark[], pct: number) => {
  const m = midOf(px, 11, 12);
  const k = 1 - pct / 100;
  return place(place(px, 11, { x: m.x + (px[11].x - m.x) * k, y: m.y + (px[11].y - m.y) * k }), 12, {
    x: m.x + (px[12].x - m.x) * k,
    y: m.y + (px[12].y - m.y) * k,
  });
};

const CASES: Case[] = [
  {
    movement: "shoulder_flexion",
    check: "trunk_back",
    start: sideSeated,
    apply: (px, a) => tilt(px, -a),
    levels: [
      { level: "cue", at: 5, dir: 1, step: 2 },
      { level: "invalid", at: 10, dir: 1, step: 2 },
    ],
  },
  {
    movement: "shoulder_flexion",
    check: "bent_elbow",
    start: sideSeated,
    apply: (px, a) => elbowAt(px, a),
    levels: [
      { level: "flag", at: 150, dir: -1, step: 2 },
      { level: "cue", at: 150, dir: -1, step: 2 },
    ],
  },
  {
    movement: "shoulder_flexion",
    check: "assisted",
    start: armRaised(60),
    // The other wrist above the raised elbow, `a` body widths away (0.55 of the 0.25 trunk in a side view).
    apply: (px, a) => place(px, 15, { x: px[14].x, y: px[14].y - a * 0.55 * 0.25 }),
    levels: [{ level: "invalid", at: 0.25, dir: -1, step: 0.02 }],
  },
  {
    movement: "shoulder_abduction",
    check: "trunk_lean",
    start: frontSeated,
    apply: (px, a) => tiltFront(px, a),
    levels: [
      { level: "cue", at: 5, dir: 1, step: 2 },
      { level: "invalid", at: 10, dir: 1, step: 2 },
    ],
  },
  {
    movement: "shoulder_abduction",
    check: "trunk_rotation",
    start: frontSeated,
    apply: shrinkShoulders,
    levels: [{ level: "invalid", at: 15, dir: 1, step: 2 }],
  },
  {
    movement: "shoulder_abduction",
    check: "assisted",
    start: frontSeated,
    // The other (left) wrist beside the middle of the tested upper arm, `a` shoulder widths (0.2) away.
    apply: (px, a) => {
      const m = midOf(px, 12, 14);
      const seg = { x: px[14].x - px[12].x, y: px[14].y - px[12].y };
      const len = Math.hypot(seg.x, seg.y);
      return place(px, 15, { x: m.x - (seg.y / len) * a * 0.2, y: m.y + (seg.x / len) * a * 0.2 });
    },
    levels: [{ level: "invalid", at: RANGE_RULES.assistShoulderWidths, dir: -1, step: 0.02 }],
  },
  {
    movement: "shoulder_abduction",
    check: "bent_elbow",
    start: frontSeated,
    apply: (px, a) => setElbow(px, a),
    levels: [{ level: "flag", at: 150, dir: -1, step: 2 }],
  },
  {
    movement: "shoulder_abduction",
    check: "shrug",
    start: frontSeated,
    // The tested shoulder moved toward its ear by `a` shoulder widths.
    apply: (px, a) => {
      const d = { x: px[8].x - px[12].x, y: px[8].y - px[12].y };
      const n = Math.hypot(d.x, d.y);
      return place(px, 12, { x: px[12].x + (d.x / n) * a * 0.2, y: px[12].y + (d.y / n) * a * 0.2 });
    },
    levels: [{ level: "cue", at: RANGE_RULES.shrugCue, dir: 1, step: 0.02 }],
  },
  {
    movement: "shoulder_extension",
    check: "trunk_forward",
    position: "seated_forward",
    start: sideSeated,
    apply: (px, a) => tilt(px, a),
    levels: [
      { level: "cue", at: 5, dir: 1, step: 2 },
      { level: "invalid", at: 10, dir: 1, step: 2 },
    ],
  },
  {
    movement: "shoulder_extension",
    check: "plane",
    position: "seated_forward",
    start: sideSeated,
    apply: (px, r) => scaleSegment(px, 12, 14, r, RIGHT_ARM),
    levels: [{ level: "invalid", at: 0.85, dir: -1, step: 0.02 }],
  },
  {
    movement: "shoulder_extension",
    check: "bent_elbow",
    position: "seated_forward",
    start: sideSeated,
    apply: (px, a) => elbowAt(px, a),
    levels: [
      { level: "flag", at: 150, dir: -1, step: 2 },
      { level: "cue", at: 150, dir: -1, step: 2 },
    ],
  },
  {
    movement: "elbow_extension",
    check: "upper_arm_moves",
    start: forearmForward,
    apply: (px, a) => rotate(px, RIGHT_ARM, point(px, 12), a),
    levels: [
      { level: "cue", at: 10, dir: 1, step: 2 },
      { level: "invalid", at: 20, dir: 1, step: 2 },
    ],
  },
  {
    movement: "elbow_extension",
    check: "forearm_plane",
    start: forearmForward,
    apply: (px, r) => scaleSegment(px, 14, 16, r, RIGHT_FOREARM),
    levels: [{ level: "invalid", at: 0.85, dir: -1, step: 0.02 }],
  },
  {
    movement: "elbow_extension",
    check: "trunk",
    start: forearmForward,
    apply: (px, a) => tilt(px, a),
    levels: [{ level: "invalid", at: 10, dir: 1, step: 2 }],
  },
  {
    movement: "elbow_flexion",
    check: "upper_arm_moves",
    start: sideSeated,
    apply: (px, a) => rotate(px, RIGHT_ARM, point(px, 12), -a),
    levels: [
      { level: "cue", at: 10, dir: 1, step: 2 },
      { level: "invalid", at: 20, dir: 1, step: 2 },
    ],
  },
  {
    movement: "elbow_flexion",
    check: "forearm_plane",
    start: sideSeated,
    apply: (px, r) => scaleSegment(px, 14, 16, r, RIGHT_FOREARM),
    levels: [{ level: "invalid", at: 0.85, dir: -1, step: 0.02 }],
  },
  {
    movement: "hip_flexion",
    check: "assisted",
    start: lyingSide,
    // A wrist above the tested knee, `a` thigh lengths (0.2) away.
    apply: (px, a) => place(px, 16, { x: px[26].x, y: px[26].y - a * 0.2 }),
    levels: [{ level: "invalid", at: 0.3, dir: -1, step: 0.02 }],
  },
  {
    movement: "hip_flexion",
    check: "trunk_lift",
    start: lyingSide,
    apply: (px, a) => tilt(px, a),
    levels: [{ level: "invalid", at: 10, dir: 1, step: 2 }],
  },
  {
    movement: "hip_flexion",
    check: "other_leg",
    start: lyingSide,
    apply: (px, a) => rotate(px, [25, 27, 29, 31], point(px, 24), -a),
    levels: [{ level: "invalid", at: 10, dir: 1, step: 2 }],
  },
  {
    movement: "hip_flexion",
    check: "plane",
    start: lyingSide,
    apply: (px, r) => scaleSegment(px, 24, 26, r, [26, ...RIGHT_SHANK]),
    levels: [{ level: "invalid", at: 0.85, dir: -1, step: 0.02 }],
  },
  {
    movement: "hip_extension",
    check: "trunk_tilt",
    start: sideStanding,
    apply: (px, a) => tilt(px, a),
    levels: [
      { level: "cue", at: 5, dir: 1, step: 2 },
      { level: "invalid", at: 10, dir: 1, step: 2 },
    ],
  },
  {
    movement: "hip_extension",
    check: "knee_bend",
    start: sideStanding,
    apply: (px, a) => kneeBent(px, 26, RIGHT_SHANK, a),
    levels: [
      { level: "cue", at: 20, dir: 1, step: 2 },
      { level: "flag", at: 20, dir: 1, step: 2 },
    ],
  },
  {
    movement: "hip_extension",
    check: "stance_knee",
    start: sideStanding,
    apply: (px, a) => kneeBent(px, 25, LEFT_SHANK, a),
    levels: [{ level: "flag", at: 15, dir: 1, step: 2 }],
  },
  {
    movement: "hip_extension",
    check: "plane",
    start: sideStanding,
    apply: (px, r) => scaleSegment(px, 24, 26, r, [26, ...RIGHT_SHANK]),
    levels: [{ level: "invalid", at: 0.85, dir: -1, step: 0.02 }],
  },
  {
    movement: "hip_abduction",
    check: "trunk_lean",
    start: frontStanding,
    apply: (px, a) => tiltFront(px, a),
    levels: [
      { level: "cue", at: 5, dir: 1, step: 2 },
      { level: "invalid", at: 10, dir: 1, step: 2 },
    ],
  },
  {
    movement: "hip_abduction",
    check: "hip_hike",
    start: frontStanding,
    apply: (px, a) => rotate(px, [23, 24], midOf(px, 23, 24), a),
    levels: [
      { level: "cue", at: 5, dir: 1, step: 2 },
      { level: "flag", at: 5, dir: 1, step: 2 },
    ],
  },
  {
    movement: "hip_abduction",
    check: "plane",
    start: frontStanding,
    apply: (px, r) => scaleSegment(px, 24, 26, r, [26, ...RIGHT_SHANK]),
    levels: [{ level: "invalid", at: 0.85, dir: -1, step: 0.02 }],
  },
  {
    movement: "knee_flexion",
    check: "assisted",
    start: lyingSide,
    // A wrist above the tested ankle, `a` shank lengths (0.18) away.
    apply: (px, a) => place(px, 16, { x: px[28].x, y: px[28].y - a * 0.18 }),
    levels: [{ level: "invalid", at: 0.3, dir: -1, step: 0.02 }],
  },
  {
    movement: "knee_flexion",
    check: "plane",
    start: lyingSide,
    apply: (px, r) => scaleSegment(px, 26, 28, r, RIGHT_SHANK),
    levels: [{ level: "invalid", at: 0.85, dir: -1, step: 0.02 }],
  },
  {
    movement: "knee_extension",
    check: "plane",
    start: lyingSide,
    apply: (px, r) => scaleSegment(px, 26, 28, r, RIGHT_SHANK),
    levels: [{ level: "invalid", at: 0.85, dir: -1, step: 0.02 }],
  },
  {
    movement: "knee_extension",
    check: "seated_lean_back",
    position: "seated",
    start: sideSeated,
    apply: (px, a) => tilt(px, -a),
    levels: [
      { level: "cue", at: 5, dir: 1, step: 2 },
      { level: "invalid", at: 10, dir: 1, step: 2 },
    ],
  },
  {
    movement: "ankle_dorsiflexion_lunge",
    check: "heel_lift",
    start: sideStanding,
    // The whole foot up by `a` shank lengths (0.21): the heel rises, the pitch stays.
    apply: (px, a) => shift(px, [30, 32], 0, -a * 0.21),
    levels: [{ level: "invalid", at: 0.06, dir: 1, step: 0.02 }],
  },
  {
    movement: "ankle_dorsiflexion_lunge",
    check: "foot_turn",
    start: sideStanding,
    apply: (px, r) => scaleSegment(px, 30, 32, r, [32]),
    levels: [{ level: "invalid", at: 0.8, dir: -1, step: 0.02 }],
  },
  {
    movement: "ankle_dorsiflexion_lunge",
    check: "knee_plane",
    start: sideStanding,
    apply: (px, r) => scaleSegment(px, 28, 26, r, [26]),
    levels: [{ level: "invalid", at: 0.85, dir: -1, step: 0.02 }],
  },
  {
    movement: "trunk_lateral_flexion",
    check: "trunk_rotation",
    side: "left",
    start: frontStanding,
    apply: shrinkShoulders,
    levels: [{ level: "invalid", at: 15, dir: 1, step: 2 }],
  },
  {
    movement: "trunk_lateral_flexion",
    check: "knee_bend",
    side: "left",
    start: frontStanding,
    apply: (px, a) => kneeBent(px, 26, RIGHT_SHANK, a),
    levels: [{ level: "invalid", at: 15, dir: 1, step: 2 }],
  },
  {
    movement: "trunk_lateral_flexion",
    check: "pelvis_shift",
    side: "left",
    start: frontStanding,
    apply: (px, a) => rotate(px, [23, 24], midOf(px, 23, 24), a),
    levels: [
      { level: "flag", at: 5, dir: 1, step: 2 },
      { level: "cue", at: 5, dir: 1, step: 2 },
    ],
  },
  {
    movement: "trunk_flexion",
    check: "knee_bend",
    side: "none",
    start: sideStanding,
    apply: (px, a) => kneeBent(px, 26, RIGHT_SHANK, a),
    levels: [{ level: "invalid", at: 15, dir: 1, step: 2 }],
  },
  {
    movement: "neck_lateral_flexion",
    check: "shoulder_hike",
    side: "left",
    start: frontSeated,
    apply: (px, a) => rotate(px, [11, 12], midOf(px, 11, 12), a),
    levels: [
      { level: "cue", at: 5, dir: 1, step: 2 },
      { level: "invalid", at: 10, dir: 1, step: 2 },
    ],
  },
  {
    movement: "neck_lateral_flexion",
    check: "head_turn",
    side: "left",
    start: frontSeated,
    // The nose moved along the ear line by `a` ear distances (0.1).
    apply: (px, a) => shift(px, [0], -a * 0.1, 0),
    levels: [{ level: "invalid", at: 0.15, dir: 1, step: 0.02 }],
  },
  {
    movement: "neck_lateral_flexion",
    check: "trunk_lean",
    side: "left",
    start: frontSeated,
    apply: (px, a) => tiltFront(px, a),
    levels: [
      { level: "cue", at: 5, dir: 1, step: 2 },
      { level: "invalid", at: 10, dir: 1, step: 2 },
    ],
  },
  {
    movement: "neck_flexion",
    check: "trunk",
    side: "none",
    start: sideSeated,
    apply: (px, a) => tilt(px, a),
    levels: [
      { level: "cue", at: 5, dir: 1, step: 2 },
      { level: "invalid", at: 10, dir: 1, step: 2 },
    ],
  },
  {
    movement: "neck_extension",
    check: "trunk",
    side: "none",
    start: sideSeated,
    apply: (px, a) => tilt(px, -a),
    levels: [
      { level: "cue", at: 5, dir: 1, step: 2 },
      { level: "invalid", at: 10, dir: 1, step: 2 },
    ],
  },
];

describe("each check fires at its level plus 2 and is quiet at its level minus 2", () => {
  for (const c of CASES) {
    for (const l of c.levels) {
      it(`${c.movement} ${c.check}: ${l.level} at ${l.at}`, () => {
        const start = c.start();
        const side = c.side ?? "right";
        const run = (amount: number) =>
          track(c.movement, side, start, c.apply(start, amount), { position: c.position, angle: c.angle });
        const fire = run(l.at + l.dir * l.step);
        const quiet = run(l.at - l.dir * l.step);
        expect(has(fire, c.check, l.level), "fires").toBe(true);
        expect(has(quiet, c.check, l.level), "quiet").toBe(false);
        // A cue level below the invalid one never makes the attempt invalid.
        if (l.level === "cue" && c.levels.some((x) => x.level === "invalid"))
          expect(has(fire, c.check, "invalid")).toBe(false);
        // The cue line goes with the hit, once per attempt.
        const lines = fire.hits.filter((h) => h.id === c.check && h.level === "cue");
        expect(lines.length).toBeLessThanOrEqual(1);
        if (lines.length) expect(lines[0].cue).toBe(compensationDef(c.movement, c.check).cue);
      });
    }
  }

  it("every check of every movement has a case (or its own tests below)", () => {
    const own = new Set([
      "shoulder_flexion plane",
      "shoulder_abduction plane",
      "trunk_flexion hands_support",
    ]);
    for (const id of ROM_MOVEMENT_IDS)
      for (const c of COMPENSATIONS[id])
        expect(
          CASES.some((x) => x.movement === id && x.check === c.id) || own.has(`${id} ${c.id}`),
          `${id} ${c.id}`,
        ).toBe(true);
  });
});

describe("the second criterion and the gravity mode", () => {
  it("heel lift: a pitch change over 5 degrees alone rejects the attempt", () => {
    const start = sideStanding();
    const pitch = (a: number) => rotate(start, [32], point(start, 30), -a);
    expect(has(track("ankle_dorsiflexion_lunge", "right", start, pitch(7)), "heel_lift", "invalid")).toBe(
      true,
    );
    expect(has(track("ankle_dorsiflexion_lunge", "right", start, pitch(3)), "heel_lift", "invalid")).toBe(
      false,
    );
  });

  it("heel lift holds for its 0.3 s: a shorter lift is quiet", () => {
    const start = sideStanding();
    const lifted = shift(start, [30, 32], 0, -0.1 * 0.21);
    expect(
      has(
        track("ankle_dorsiflexion_lunge", "right", start, lifted, { seconds: 0.2 }),
        "heel_lift",
        "invalid",
      ),
    ).toBe(false);
    expect(
      has(
        track("ankle_dorsiflexion_lunge", "right", start, lifted, { seconds: 0.6 }),
        "heel_lift",
        "invalid",
      ),
    ).toBe(true);
  });

  it("pelvis shift: the mid hip moving sideways 0.25 shoulder widths is flagged too", () => {
    const start = frontStanding();
    const w = Math.abs(start[11].x - start[12].x);
    const moved = (s: number) => shift(start, [23, 24], s * w, 0);
    expect(track("trunk_lateral_flexion", "left", start, moved(0.27)).hold.flagged).toContain("pelvis_shift");
    expect(track("trunk_lateral_flexion", "left", start, moved(0.23)).hold.flagged).not.toContain(
      "pelvis_shift",
    );
  });

  it("the side arm raise in gravity mode reads v1's shoulder shift (0.08 cue, 0.15 invalid)", () => {
    const start = hide(frontSeated(), [23, 24]);
    const ctx = calibratedContext("shoulder_abduction", "right", start);
    expect(ctx.calibration.gravityMode).toBe(true);
    const w = Math.abs(start[11].x - start[12].x);
    const moved = (s: number) => shift(start, [11, 12], s * w, 0);
    const run = (s: number) => track("shoulder_abduction", "right", start, moved(s), { ctx });
    expect(has(run(0.1), "trunk_lean", "cue")).toBe(true);
    expect(has(run(0.06), "trunk_lean", "cue")).toBe(false);
    expect(has(run(0.17), "trunk_lean", "invalid")).toBe(true);
    expect(has(run(0.13), "trunk_lean", "invalid")).toBe(false);
  });

  it("the arm raises' assisted lift and shrug count only while the arm is raised (v1)", () => {
    const start = frontSeated();
    const m = midOf(start, 12, 14);
    const near = place(start, 15, { x: m.x + 0.02, y: m.y });
    expect(has(track("shoulder_abduction", "right", start, near, { angle: 60 }), "assisted", "invalid")).toBe(
      true,
    );
    expect(has(track("shoulder_abduction", "right", start, near, { angle: 20 }), "assisted", "invalid")).toBe(
      false,
    );
  });

  it("the head turn reads the eye line when the ears are hidden from the start", () => {
    const start = hide(frontSeated(), [7, 8], 0.3);
    const turned = (a: number) => shift(start, [0], -a * 0.04, 0);
    expect(has(track("neck_lateral_flexion", "left", start, turned(0.17)), "head_turn", "invalid")).toBe(
      true,
    );
    expect(has(track("neck_lateral_flexion", "left", start, turned(0.13)), "head_turn", "invalid")).toBe(
      false,
    );
  });
});

describe("hands on the thighs in the forward bend (flag only, 0.25 shoulder widths from the data: B1-2)", () => {
  /** Bent forward 70 degrees at the hips, the arms hanging straight down from the shoulders. */
  function bent(): Landmark[] {
    let px = rotate(sideStanding(), UPPER_BODY, point(sideStanding(), 24), 70);
    for (const [s, e, w] of [
      [12, 14, 16],
      [11, 13, 15],
    ]) {
      px = place(px, e, { x: px[s].x, y: px[s].y + 0.15 }, px[e].visibility);
      px = place(px, w, { x: px[s].x, y: px[s].y + 0.28 }, px[w].visibility);
    }
    return px;
  }

  it("a wrist within 0.25 body widths of the thigh is flagged at the hold", () => {
    const start = sideStanding();
    const pose = bent();
    const w = 0.55 * 0.25;
    const at = (d: number) => place(pose, 16, { x: pose[24].x + d * w, y: (pose[24].y + pose[26].y) / 2 });
    expect(
      track("trunk_flexion", "none", start, at(0.2), { position: "standing_supported" }).hold.flagged,
    ).toContain("hands_support");
    expect(
      track("trunk_flexion", "none", start, at(0.3), { position: "standing_supported" }).hold.flagged,
    ).not.toContain("hands_support");
    expect(
      track("trunk_flexion", "none", start, pose, { position: "standing_supported" }).hold.flagged,
    ).toEqual([]);
  });
});

describe("the plane windows of the arm raises", () => {
  /**
   * Frames of a lift from 40 degrees to `to` at `degPerSec`, the tested arm turned to the angle, the upper
   * arm at `ratio` of its start length from 55 degrees on (so the running median has settled at the window).
   */
  function climb(
    movement: "shoulder_flexion" | "shoulder_abduction",
    ratio: number,
    to: number,
    degPerSec = 40,
  ) {
    const start = movement === "shoulder_flexion" ? sideSeated() : frontSeated();
    const def = movementDef(movement);
    const ctx = calibratedContext(movement, "right", start);
    const tracker = new CompensationTracker(def, "seated");
    tracker.calibrate([{ px: start }], ctx);
    tracker.startAttempt(false);
    const hits: CompensationHit[] = [];
    // The side view lifts to the picture's right (the face side), the front view's right arm to the picture's left.
    const sign = movement === "shoulder_flexion" ? -1 : 1;
    let t = 0;
    for (let angle = 40; angle <= to; angle += degPerSec / FPS) {
      t += 1000 / FPS;
      let px = rotate(start, RIGHT_ARM, point(start, 12), sign * angle);
      if (angle >= 55) px = scaleSegment(px, 12, 14, ratio, RIGHT_ARM);
      hits.push(...tracker.frame({ t, px, ctx, angle }));
    }
    return { hits, tracker, t };
  }

  it("the arm raise to the front: no frame of the window at 0.85 is invalid when the arm passes above it", () => {
    const bad = climb("shoulder_flexion", 0.83, 130);
    expect(bad.hits.map((h) => [h.id, h.level])).toEqual([
      ["plane", "cue"],
      ["plane", "invalid"],
    ]);
    expect(bad.hits[0].cue).toBe("arm_in_front");
    const good = climb("shoulder_flexion", 0.87, 130);
    expect(good.hits).toEqual([]);
    expect(good.tracker.atHold(good.t - 1000, good.t, 130).invalid).toEqual([]);
  });

  it("a hold inside the window decides at the hold; a hold below 70 is not checked", () => {
    const inside = climb("shoulder_flexion", 0.83, 95);
    expect(inside.hits).toEqual([]);
    expect(inside.tracker.atHold(inside.t - 1000, inside.t, 95).invalid).toEqual(["plane"]);
    const low = climb("shoulder_flexion", 0.83, 65);
    expect(low.tracker.atHold(low.t - 1000, low.t, 65).invalid).toEqual([]);
  });

  it("the side arm raise (v1): a pass from below 60 to above 120 with no qualifying frame cues test_abd_side", () => {
    const bad = climb("shoulder_abduction", 0.83, 130);
    expect(bad.hits.filter((h) => h.id === "plane").map((h) => [h.level, h.cue])).toEqual([
      ["cue", "test_abd_side"],
      ["invalid", "test_abd_side"],
    ]);
    const good = climb("shoulder_abduction", 0.87, 130);
    expect(good.hits.filter((h) => h.id === "plane")).toEqual([]);
    expect(good.tracker.atHold(good.t - 1000, good.t, 130).invalid).not.toContain("plane");
  });

  it("the side arm raise (v1): under 0.3 s of qualifying frames in the window is invalid at a hold of 70 or more", () => {
    // 200 degrees per second crosses the 40 degree window in 0.2 s.
    const fast = climb("shoulder_abduction", 0.87, 130, 200);
    expect(fast.hits.filter((h) => h.id === "plane")).toEqual([]);
    expect(fast.tracker.atHold(fast.t - 1000, fast.t, 130).invalid).toContain("plane");
  });

  it("the side arm raise's reference is the practice lift's longest upper arm in the window (v1)", () => {
    const start = frontSeated();
    const def = movementDef("shoulder_abduction");
    const ctx = calibratedContext("shoulder_abduction", "right", start);
    const tracker = new CompensationTracker(def, "seated");
    tracker.calibrate([{ px: start }], ctx);
    // The practice lift shows the upper arm 10 percent longer in the window (the arm hung a little turned).
    tracker.startAttempt(true);
    let t = 0;
    for (let angle = 40; angle <= 130; angle += 40 / FPS) {
      t += 1000 / FPS;
      let px = rotate(start, RIGHT_ARM, point(start, 12), angle);
      if (angle >= 55) px = scaleSegment(px, 12, 14, 1.1, RIGHT_ARM);
      tracker.frame({ t, px, ctx, angle });
    }
    tracker.endPractice();
    // A scored lift at 0.9 of the start length is 0.82 of the reference: no qualifying frame.
    tracker.startAttempt(false);
    const hits: CompensationHit[] = [];
    for (let angle = 40; angle <= 130; angle += 40 / FPS) {
      t += 1000 / FPS;
      let px = rotate(start, RIGHT_ARM, point(start, 12), angle);
      if (angle >= 55) px = scaleSegment(px, 12, 14, 0.9, RIGHT_ARM);
      hits.push(...tracker.frame({ t, px, ctx, angle }));
    }
    expect(hits.filter((h) => h.id === "plane").map((h) => h.level)).toEqual(["cue", "invalid"]);
  });
});

describe("once per attempt", () => {
  it("a cue plays once per attempt and again in the next attempt", () => {
    const start = armRaised(60)();
    const def = movementDef("shoulder_flexion");
    const ctx = calibratedContext("shoulder_flexion", "right", start);
    const tracker = new CompensationTracker(def, "seated");
    tracker.calibrate([{ px: start }], ctx);
    const leaning = tilt(start, -7);
    const cues: number[] = [];
    for (const attempt of [0, 1]) {
      tracker.startAttempt(attempt === 0);
      let n = 0;
      for (let i = 0; i < 90; i++) {
        const t = attempt * 10_000 + (i * 1000) / FPS;
        // Leaning, upright again, leaning again.
        const px = i < 30 || i >= 60 ? leaning : start;
        n += tracker.frame({ t, px, ctx, angle: 60 }).filter((h) => h.level === "cue").length;
      }
      cues.push(n);
    }
    expect(cues).toEqual([1, 1]);
  });

  it("a glitch of one frame never fires (v1's median and persistence)", () => {
    const start = armRaised(60)();
    const def = movementDef("shoulder_flexion");
    const ctx = calibratedContext("shoulder_flexion", "right", start);
    const tracker = new CompensationTracker(def, "seated");
    tracker.calibrate([{ px: start }], ctx);
    tracker.startAttempt(false);
    const hits: CompensationHit[] = [];
    for (let i = 0; i < 60; i++)
      hits.push(
        ...tracker.frame({ t: (i * 1000) / FPS, px: i === 30 ? tilt(start, -25) : start, ctx, angle: 60 }),
      );
    expect(hits).toEqual([]);
  });

  it("in a side view the other wrist beside the hanging arm is no assisted lift: the check waits for a lift", () => {
    const start = sideSeated();
    expect(has(track("shoulder_flexion", "right", start, start, { angle: 10 }), "assisted", "invalid")).toBe(
      false,
    );
  });
});
