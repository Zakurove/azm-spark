/**
 * Every one of the 16 measured movements through the RomRunner (product v7 contract 2.6): a simulated
 * person in the movement's view and position calibrates still, does the practice and three attempts to a
 * target and confirms each hold; the value is the target within 2 degrees, nothing is coached or
 * repeated, and the server's validator accepts the result. Simple synthetic poses (tests/v7/b-poses.ts):
 * the movement's segment turned to the angle; the mannequin fixtures of every movement are step B2's.
 */
import { describe, expect, it } from "vitest";
import type { Landmark } from "../../src/engine/types";
import { MOVEMENT_ANGLES } from "../../src/engine/rom/angles";
import { movementDef } from "../../src/movements/rom";
import { ROM_MOVEMENT_IDS, type RomMovementId, type RomSide } from "../../src/movements/rom/types";
import { checkRomResult } from "../../server/modules/focus/validate";
import { abductionPose, drive, elbowExtensionPose, item, kinds, runner } from "./b-driver";
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

interface MovementCase {
  side: RomSide;
  rest: number;
  target: number;
  pose: (deg: number) => Landmark[];
}

const CASES: Record<RomMovementId, MovementCase> = {
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

describe("every measured movement through the runner", () => {
  it("has a case for each of the 16", () => {
    expect(Object.keys(CASES).sort()).toEqual([...ROM_MOVEMENT_IDS].sort());
  });

  for (const id of ROM_MOVEMENT_IDS) {
    it(id, () => {
      const c = CASES[id];
      const def = movementDef(id);
      // The pose builder gives the movement's own angle (checked against the angle function after calibration).
      const r = runner(id, { side: c.side });
      const d = drive(r, { rest: c.rest, target: () => c.target, pose: c.pose, speed: 30 }, 150);
      const res = r.finish(d.t);
      expect(res.status, JSON.stringify(kinds(d.events, "attempt").map((e) => e.record.reasons))).toBe(
        "measured",
      );
      expect(res.nValid).toBe(3);
      expect(Math.abs(res.value! - c.target)).toBeLessThanOrEqual(2);
      for (const a of res.attempts) expect(Math.abs(a.value! - c.target)).toBeLessThanOrEqual(2);
      expect(res.retries).toBe(0);
      expect(kinds(d.events, "compensation")).toEqual([]);
      expect(res.quality.ok).toBe(true);
      // The angle function itself reads the target on the target pose with the runner's calibration.
      const ctx = { side: c.side, mirrored: false, rollDeg: 0, calibration: r.calibration! };
      expect(Math.abs(MOVEMENT_ANGLES[id](c.pose(c.target), ctx)! - c.target)).toBeLessThanOrEqual(1);
      const check = checkRomResult(
        res as unknown as Record<string, unknown>,
        item(id, c.side, { position: def.positions[0].id }),
      );
      expect(check).toMatchObject({ ok: true });
    });
  }
});

describe("the other direction and the other side", () => {
  const variants: { name: string; id: RomMovementId; c: MovementCase }[] = [
    {
      name: "bending to the right",
      id: "trunk_lateral_flexion",
      c: {
        side: "right",
        rest: 0,
        target: 22,
        pose: (d) => rotate(frontStanding(), UPPER_BODY, midOf(frontStanding(), 23, 24), -d),
      },
    },
    {
      name: "the head tilted to the right",
      id: "neck_lateral_flexion",
      c: {
        side: "right",
        rest: 0,
        target: 28,
        pose: (d) => rotate(frontSeated(), HEAD, midOf(frontSeated(), 11, 12), -d),
      },
    },
    {
      name: "the left leg out to the side",
      id: "hip_abduction",
      c: {
        side: "left",
        rest: 0,
        target: 30,
        pose: (d) => rotate(frontStanding(), [25, 27, 29, 31], point(frontStanding(), 23), -d),
      },
    },
  ];
  for (const v of variants) {
    it(`${v.id}: ${v.name}`, () => {
      const r = runner(v.id, { side: v.c.side });
      const d = drive(r, { rest: v.c.rest, target: () => v.c.target, pose: v.c.pose, speed: 30 }, 150);
      const res = r.finish(d.t);
      expect(res.status).toBe("measured");
      expect(Math.abs(res.value! - v.c.target)).toBeLessThanOrEqual(2);
    });
  }

  it("a bend the other way than the item's side reads nothing for that side: no hold, not measured", () => {
    // trunk_lateral_flexion to the left, while the person bends to the right.
    const r = runner("trunk_lateral_flexion", { side: "left" });
    const d = drive(
      r,
      {
        rest: 0,
        target: () => 25,
        pose: (dd) => rotate(frontStanding(), UPPER_BODY, midOf(frontStanding(), 23, 24), -dd),
        speed: 30,
      },
      150,
    );
    expect(kinds(d.events, "hold")).toEqual([]);
    expect(r.finish(d.t).status).toBe("not_measured");
  });
});
