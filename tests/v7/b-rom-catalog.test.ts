/**
 * The range of motion fixtures to keep on disk (tests/fixtures/rom/catalog.ts ROM_FIXTURES, product v7
 * contract 1.2 and 8.2, stream B, step B2): one per measured movement at its path, each angle the
 * reference person's norm mean, each measured by the runner as 8.2 asks. ROM_CATALOG, which
 * tests/fixtures/catalog.ts spreads into CATALOG, holds none of them while contract gap CG-23 is open.
 */
import { describe, expect, it } from "vitest";
import { ROM_MOVEMENT_IDS } from "../../src/movements/rom/types";
import { movementDef } from "../../src/movements/rom";
import { CATALOG } from "../fixtures/catalog";
import { ROM_CATALOG, ROM_FIXTURES } from "../fixtures/rom/catalog";
import { endAngle, matrixProblems, runRom, type RomCase } from "./b-fixtures";

describe("the range of motion fixtures to keep on disk", () => {
  it("one per measured movement, at rom/<movement>/<position>/<case>.json, in its first position", () => {
    expect(ROM_FIXTURES.map((e) => e.spec.rom!.movement)).toEqual([...ROM_MOVEMENT_IDS]);
    for (const e of ROM_FIXTURES) {
      const r = e.spec.rom!;
      const [root, movement, position, file] = e.file.split("/");
      expect([root, movement, position]).toEqual(["rom", r.movement, r.position]);
      expect(file).toMatch(/^[a-z0-9-]+\.json$/);
      expect(e.spec.test).toBe(r.movement);
      expect(r.position).toBe(movementDef(r.movement).positions[0].id);
    }
    expect(new Set(ROM_FIXTURES.map((e) => e.file)).size).toBe(ROM_FIXTURES.length);
  });

  it("each angle is the reference person's norm mean", () => {
    for (const e of ROM_FIXTURES) {
      const r = e.spec.rom!;
      const peaks = (e.spec.subject?.motions ?? []).flatMap((m) => (m.kind === "rom_rep" ? [m.peak] : []));
      expect(peaks).toHaveLength(4);
      for (const p of peaks) expect(p).toBe(endAngle(r.movement, r.position, 100, r.side));
    }
  });

  it("ROM_CATALOG holds none of them while CG-23 is open, and only these after", () => {
    for (const e of ROM_CATALOG) expect(ROM_FIXTURES).toContainEqual(e);
    for (const e of ROM_CATALOG) expect(CATALOG).toContainEqual(e);
  });

  for (const e of ROM_FIXTURES)
    it(`${e.file} meets 8.2`, () => {
      const r = e.spec.rom!;
      const truthDeg = endAngle(r.movement, r.position, 100, r.side);
      const c = { name: e.file, truthDeg } as RomCase;
      expect(matrixProblems(c, runRom(e.spec))).toEqual([]);
    });
});
