/**
 * The gait fixture catalog (product v7 contract 1.2.1 and 8.3, step C2): every named synthetic walk
 * plays through the e2e pose source by "gait/<name>", standing calibration first, and an unknown
 * name gives nothing.
 */
import { describe, expect, it } from "vitest";
import { fixtureFrames } from "../../src/features/assessment/e2e/FixturePoseSource";
import { GAIT_CATALOG, gaitFixtureFrames } from "../fixtures/gait/catalog";
import { walk } from "../fixtures/gait/gen-gait";

describe("the gait fixture catalog", () => {
  it("gives the frames of every named walk, the standing calibration first, in time order", () => {
    for (const e of GAIT_CATALOG) {
      const frames = gaitFixtureFrames(`gait/${e.name}`)!;
      const w = walk(e.spec);
      expect(frames.length, e.name).toBe(w.standing.length + w.frames.length);
      expect(frames[0].t).toBe(w.standing[0].t);
      for (let i = 1; i < frames.length; i++) expect(frames[i].t).toBeGreaterThan(frames[i - 1].t);
      expect(frames.every((f) => f.lm.length === 33 && f.poses?.[0] === f.lm)).toBe(true);
    }
  });

  it("is read by the e2e pose source, and an unknown name is none", () => {
    expect(fixtureFrames("gait/pad-side-right").length).toBe(
      gaitFixtureFrames("gait/pad-side-right")!.length,
    );
    expect(gaitFixtureFrames("gait/no-such-walk")).toBeNull();
    expect(() => fixtureFrames("gait/no-such-walk")).toThrow(RangeError);
  });

  it("names unique walks with notes", () => {
    expect(new Set(GAIT_CATALOG.map((e) => e.name)).size).toBe(GAIT_CATALOG.length);
    for (const e of GAIT_CATALOG) expect(e.notes.length, e.name).toBeGreaterThan(20);
  });
});
