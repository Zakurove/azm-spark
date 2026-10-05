/**
 * analyseStaticStance (gait-rules 2.4, metric static_pelvic_drop): the hip line's tilt against double
 * stance, the median over the last 3 s of a hold of up to 10 s, positive when the lifted side's hip is
 * lower, and when the check counts.
 */
import { describe, expect, it } from "vitest";
import { analyseStaticStance } from "../../src/engine/gait/analyse";
import { singleLegStance } from "../fixtures/gait/gen-gait";

describe("static single leg stance", () => {
  for (const side of ["left", "right"] as const)
    for (const dropDeg of [0, 4, 9])
      it(`measures a ${dropDeg} degree drop of the lifted side standing on the ${side} leg`, () => {
        // The generator turns the hip line by atan(sin(drop)).
        const truth = Math.atan(Math.sin((dropDeg * Math.PI) / 180)) * (180 / Math.PI);
        const exact = singleLegStance({ side, dropDeg, seed: 81 });
        const r = analyseStaticStance({
          side,
          support: "none",
          frames: exact.frames,
          standing: exact.standing,
        });
        expect(r.ok).toBe(true);
        expect(r.side).toBe(side);
        expect(Math.abs(r.pelvicDropDeg! - truth)).toBeLessThan(0.05);
        // With landmark jitter (the hips are about 45 pixels apart at 3 m in a 1280 pixel picture).
        const noisy = singleLegStance({ side, dropDeg, seed: 81, noise: 0.0005 });
        const n = analyseStaticStance({
          side,
          support: "none",
          frames: noisy.frames,
          standing: noisy.standing,
        });
        expect(Math.abs(n.pelvicDropDeg! - truth)).toBeLessThan(1);
      });

  it("reads only the last 3 s of a hold of up to 10 s", () => {
    const s = singleLegStance({ side: "left", dropDeg: 6, holdSec: 14, seed: 82 });
    // From 10 s on the person stands on both legs again, which the check never reads.
    const r = analyseStaticStance({
      side: "left",
      support: "fingertip",
      frames: s.frames.map((f) => (f.t - s.frames[0].t > 10000 ? { ...f, lm: s.standing[0].lm } : f)),
      standing: s.standing,
    });
    expect(r.ok).toBe(true);
    expect(
      Math.abs(r.pelvicDropDeg! - Math.atan(Math.sin((6 * Math.PI) / 180)) * (180 / Math.PI)),
    ).toBeLessThan(0.05);
  });

  it("does not count a hold under 3 s, hidden hips, a foot that never lifted, or no calibration", () => {
    const short = singleLegStance({ side: "right", dropDeg: 5, holdSec: 2, seed: 83 });
    expect(analyseStaticStance({ side: "right", support: "none", ...short })).toEqual({
      side: "right",
      pelvicDropDeg: null,
      ok: false,
    });
    const hidden = singleLegStance({ side: "right", dropDeg: 5, seed: 84, hideHipsFrom: 3.5 });
    expect(analyseStaticStance({ side: "right", support: "none", ...hidden }).ok).toBe(false);
    const down = singleLegStance({ side: "right", dropDeg: 5, seed: 85, liftM: 0 });
    expect(analyseStaticStance({ side: "right", support: "none", ...down }).ok).toBe(false);
    const ok = singleLegStance({ side: "right", dropDeg: 5, seed: 86 });
    expect(analyseStaticStance({ side: "right", support: "none", frames: ok.frames, standing: [] }).ok).toBe(
      false,
    );
  });
});
