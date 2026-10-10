import { describe, expect, it } from "vitest";
import { ROM_DATA } from "../src/movements/rom";
import { holdAtPlausibleEnd, plausibleEnd } from "../src/engine/rom/runner";

describe("plausible end (D-036 follow up)", () => {
  it("holds an impossible elbow bend at the plausible end and marks it held", () => {
    const end = plausibleEnd("elbow_flexion", "flexion")!;
    expect(end).toBeGreaterThan(155);
    expect(end).toBeLessThan(178);
    expect(holdAtPlausibleEnd("elbow_flexion", "flexion", 178)).toEqual({ value: end, held: true });
    expect(holdAtPlausibleEnd("elbow_flexion", "flexion", 150)).toEqual({ value: 150, held: false });
  });

  it("holds an impossible elbow straightening (minus 30) and never changes a limited one", () => {
    const end = plausibleEnd("elbow_extension", "lack")!;
    expect(end).toBeGreaterThan(-30);
    expect(end).toBeLessThan(-10);
    expect(holdAtPlausibleEnd("elbow_extension", "lack", -30)).toEqual({ value: end, held: true });
    expect(holdAtPlausibleEnd("elbow_extension", "lack", 40)).toEqual({ value: 40, held: false });
  });

  it("never holds a small range, for every movement with norms", () => {
    for (const m of ROM_DATA.movements) {
      const r = holdAtPlausibleEnd(m.id, m.kind, m.kind === "lack" ? 60 : 5);
      expect(r.held, m.id).toBe(false);
    }
  });

  it("keeps every norm mean inside its plausible end", () => {
    for (const n of ROM_DATA.norms) {
      const def = ROM_DATA.movements.find((m) => m.id === n.movement);
      if (!def) continue;
      for (const row of n.rows) {
        expect(holdAtPlausibleEnd(def.id, def.kind, row.mean).held, `${n.id} ${row.mean}`).toBe(false);
      }
    }
  });
});
