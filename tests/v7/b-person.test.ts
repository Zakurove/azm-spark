/**
 * The simulated person of stream B (tests/v7/b-person.ts): every measured movement on either side
 * through the RomRunner. The shell tests and the e2e person source of the focus check run protocols of
 * any side with it, so the other side (the same body turned around) must measure as the side it was
 * built for.
 */
import { describe, expect, it } from "vitest";
import { ROM_MOVEMENT_IDS, type RomSide } from "../../src/movements/rom/types";
import { drive, runner } from "./b-driver";
import { MOVEMENT_CASES, movementPose, otherSideId, turnedAround } from "./b-person";
import { sideSeated } from "./b-poses";

const other = (s: RomSide): RomSide => (s === "left" ? "right" : s === "right" ? "left" : "none");

describe("the simulated person", () => {
  it("pairs every landmark with its other side once", () => {
    for (let i = 0; i < 33; i++) expect(otherSideId(otherSideId(i))).toBe(i);
    expect(otherSideId(0)).toBe(0);
    expect(otherSideId(12)).toBe(11);
    expect(otherSideId(7)).toBe(8);
    const px = sideSeated();
    const back = turnedAround(turnedAround(px));
    for (let i = 0; i < 33; i++) expect(back[i].x).toBeCloseTo(px[i].x, 9);
  });

  for (const id of ROM_MOVEMENT_IDS) {
    const c = MOVEMENT_CASES[id];
    const sides: RomSide[] = c.side === "none" ? ["none"] : [c.side, other(c.side)];
    for (const side of sides)
      it(`${id} on the ${side} side measures its target`, () => {
        const r = runner(id, { side });
        const d = drive(
          r,
          { rest: c.rest, target: () => c.target, pose: movementPose(id, side), speed: 30 },
          150,
        );
        const res = r.finish(d.t);
        expect(res.status).toBe("measured");
        expect(Math.abs(res.value! - c.target)).toBeLessThanOrEqual(2);
      });
  }
});
