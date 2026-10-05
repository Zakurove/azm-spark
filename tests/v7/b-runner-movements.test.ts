/**
 * Every one of the 16 measured movements through the RomRunner (product v7 contract 2.6): a simulated
 * person in the movement's view and position calibrates still, does the practice and three attempts to a
 * target and confirms each hold; the value is the target within 2 degrees, nothing is coached or
 * repeated, and the server's validator accepts the result. Simple synthetic poses (tests/v7/b-poses.ts):
 * the movement's segment turned to the angle; the mannequin fixtures of every movement are step B2's.
 */
import { describe, expect, it } from "vitest";
import { MOVEMENT_ANGLES } from "../../src/engine/rom/angles";
import { movementDef } from "../../src/movements/rom";
import { ROM_MOVEMENT_IDS, type RomMovementId } from "../../src/movements/rom/types";
import { checkRomResult } from "../../server/modules/focus/validate";
import { drive, item, kinds, runner } from "./b-driver";
import { UPPER_BODY, frontSeated, frontStanding, midOf, point, rotate } from "./b-poses";
import { MOVEMENT_CASES, type MovementCase } from "./b-person";

const CASES = MOVEMENT_CASES;
const HEAD = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

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
