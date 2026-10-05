/**
 * The synthetic walker's pattern modifiers (tests/fixtures/gait/gen-gait.ts, product v7 contract 8.3,
 * step C2): each changes the walk's own truth the way it says, on its side only, and a walk without
 * them is the walk C1's tests were written on.
 */
import { describe, expect, it } from "vitest";
import { walk, type WalkSpec } from "../fixtures/gait/gen-gait";

const truth = (over: Partial<WalkSpec>) => walk({ view: "side", passes: 2, seed: 5, ...over }).truth;
const base = truth({});

describe("the walker's pattern modifiers", () => {
  it("leave a walk without them as it was: the same angles on both legs", () => {
    expect(base.sides.left.kneeSwingPeak).toBeCloseTo(base.sides.right.kneeSwingPeak, 6);
    expect(base.sides.left.kneeStanceMin).toBeCloseTo(base.sides.right.kneeStanceMin, 6);
    expect(base.kneeSwingPeak).toBe(base.sides.left.kneeSwingPeak);
    expect(base.sides.left.pitchAtIc).toBeCloseTo(18, 9);
    expect(base.sides.left.singleSupportSec).toBeCloseTo(0.4 * (120 / 108), 9);
  });

  it("hold the knee bent or past straight through the single stance", () => {
    const bent = truth({ stanceKnee: { left: 20 } }).sides;
    expect(bent.left.kneeStanceMin).toBeCloseTo(20, 0);
    expect(bent.right.kneeStanceMin).toBeCloseTo(base.sides.right.kneeStanceMin, 1);
    const back = truth({ stanceKnee: { right: -15 } }).sides;
    expect(back.right.kneeStanceMin).toBeCloseTo(-15, 0);
    expect(back.left.kneeStanceMin).toBeGreaterThan(0);
  });

  it("keep the knee straight at landing, or cap its bend in swing", () => {
    const load = truth({ loadingKnee: { left: 0 } }).sides;
    expect(load.left.kneeLoadingPeak).toBeLessThan(2);
    expect(load.right.kneeLoadingPeak).toBeGreaterThan(10);
    const stiff = truth({ swingKnee: { left: 40 } }).sides;
    expect(stiff.left.kneeSwingPeak).toBeLessThanOrEqual(40.5);
    expect(stiff.right.kneeSwingPeak).toBeGreaterThan(60);
  });

  it("land flat or toe first, and carry a foot high late in swing", () => {
    const step = truth({ contactPitch: { left: -5 }, highStep: { left: 0.04 } }).sides;
    expect(step.left.pitchAtIc).toBeCloseTo(-5, 9);
    expect(step.left.thighSwingPeak - step.right.thighSwingPeak).toBeGreaterThan(8);
  });

  it("shorten one side's single support by the other leg's longer stance", () => {
    const t = truth({ stanceBy: { right: 0.66 } });
    expect(t.sides.left.singleSupportSec).toBeCloseTo(0.34 * t.strideSec, 9);
    expect(t.sides.right.singleSupportSec).toBeCloseTo(0.4 * t.strideSec, 9);
    // The right toe off comes 66% into its cycle.
    const ic = t.ics.find((e) => e.side === "right")!;
    const to = t.tos.find((e) => e.side === "right" && e.t > ic.t)!;
    expect((to.t - ic.t) / 1000).toBeCloseTo(0.66 * t.strideSec, 6);
  });

  it("let a leg reach less far behind when its foot lands further ahead", () => {
    const t = truth({ contactShift: { left: 0.12 } }).sides;
    expect(base.sides.left.tlaPeak - t.left.tlaPeak).toBeGreaterThan(6);
    expect(Math.abs(t.right.tlaPeak - base.sides.right.tlaPeak)).toBeLessThan(2);
  });

  it("spread the passes' starts only when asked, from their own random numbers", () => {
    const a = walk({ view: "front", passes: 4, seed: 9 });
    const b = walk({ view: "front", passes: 4, seed: 9, passShiftM: 0.5 });
    expect(b.frames.length).toBe(a.frames.length);
    expect(b.truth.ics.map((e) => e.t)).not.toEqual(a.truth.ics.map((e) => e.t));
  });
});
