/**
 * The real model smoke's pad walk as a regression (D-026 item 6, GG-4): G1's rendered walk on the
 * pad seen from the right, through MediaPipe Full and Lite (tests/fixtures/gait/smoke), whose far leg
 * hides behind the near one for part of each stride. C1 drops every cycle of it. Until the near limb
 * rule lands (the C2 gap GG-4 gives the measured causes and a guarded proposal), the engine must keep
 * failing it safely: no view passes its gate on a wrong walk, and the near limb's tracking itself is
 * good enough to time the walk on Full.
 */
import { describe, expect, it } from "vitest";
import { analyseGaitView } from "../../src/engine/gait/analyse";
import { prepare } from "../../src/engine/gait/preprocess";
import { loadSmoke } from "../fixtures/gait/smoke";

describe("G1's rendered pad walk through the real model", () => {
  for (const name of ["gait-pad-side-full", "gait-pad-side-lite"] as const)
    it(`never passes the gate on a wrong walk (${name})`, () => {
      const s = loadSmoke(name);
      const r = analyseGaitView({
        view: "pad_side",
        nearSide: s.nearSide,
        setup: s.setup,
        standing: s.standing,
        frames: s.frames,
        poseModel: s.model,
        rollDeg: 0,
      });
      if (r.quality.gatePassed)
        expect(Math.abs(r.metrics.cadence!.value! / s.truth.cadence - 1)).toBeLessThan(0.05);
      else expect(r.quality.issues).toContain("too_few_cycles");
    });

  it("holds a near leg the model tracks well: the near heel's forward swing gives every contact", () => {
    const s = loadSmoke("gait-pad-side-full");
    // Without the leg swap rule (labels as the model gave them) the near heel, relative to the hips,
    // peaks once a stride, within 2 frames of each true contact.
    const p = prepare(s.frames, { rollDeg: 0, labels: "none" }).series;
    const near = s.nearSide === "right" ? 30 : 29;
    const rel = Array.from({ length: p.n }, (_, k) => p.x[near][k] - (p.x[23][k] + p.x[24][k]) / 2);
    const truth = s.truth.ics.filter((e) => e.side === s.nearSide).map((e) => e.t);
    let found = 0;
    for (const t of truth) {
      const k = Math.round((t / 1000 - p.t[0]) * p.hz);
      if (k < 3 || k > p.n - 4) continue;
      // The walker faces the picture's right (near side right): the heel leads at contact.
      const win = rel.slice(k - 2, k + 3).filter(Number.isFinite);
      const before = rel.slice(k - 8, k - 2).filter(Number.isFinite);
      const after = rel.slice(k + 3, k + 9).filter(Number.isFinite);
      if (win.length && before.length && after.length)
        if (Math.max(...win) > Math.max(...before) && Math.max(...win) > Math.max(...after)) found++;
    }
    expect(found / truth.length).toBeGreaterThan(0.9);
  });
});
