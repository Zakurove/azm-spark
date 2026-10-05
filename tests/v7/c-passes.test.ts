/**
 * src/engine/gait/passes.ts (gait-rules 3.1 walking direction, 3.2 facing and turns, capture
 * overground front window): passes, their direction and near limb, turn margins, the 1.5 to 4 m
 * window of the front and back views, and the view check.
 */
import { describe, expect, it } from "vitest";
import { EXCLUDED, analysedRuns, focalLength, passesOf } from "../../src/engine/gait/passes";
import { prepare } from "../../src/engine/gait/preprocess";
import { trunkLengthAt } from "../../src/engine/gait/kinematics";
import { estimateDistanceM } from "../../src/engine/quality";
import { walk } from "../fixtures/gait/gen-gait";

describe("camera model", () => {
  it("has the distance proxy's 50 degrees across the short side, in picture heights", () => {
    const t = Math.tan((25 * Math.PI) / 180);
    expect(focalLength(16 / 9)).toBeCloseTo(0.5 / t, 12);
    expect(focalLength(9 / 16)).toBeCloseTo(9 / 16 / 2 / t, 12);
  });
});

describe("side view passes", () => {
  it("splits overground side passes by direction, with the near limb from the direction", () => {
    const w = walk({ view: "side", passes: 4, seed: 41 });
    const p = prepare(w.frames, { rollDeg: 0, labels: "swaps" });
    const m = passesOf(p, "side", undefined);
    expect(m.passes.map((x) => x.d)).toEqual([1, -1, 1, -1]);
    expect(m.passes.map((x) => x.near)).toEqual(["right", "left", "right", "left"]);
    expect(w.truth.passes.map((x) => x.kind)).toEqual(["right", "left", "right", "left"]);
    // each pass lies inside its true walking time
    m.passes.forEach((x, i) => {
      expect(p.series.t[x.start] * 1000).toBeGreaterThanOrEqual(w.truth.passes[i].from - 1);
      expect(p.series.t[x.end - 1] * 1000).toBeLessThanOrEqual(w.truth.passes[i].to + 1);
    });
    expect(m.wrongViewShare).toBeLessThan(0.1);
  });

  it("takes a pad side pass's direction from the foot and its near limb from the capture", () => {
    for (const nearSide of ["left", "right"] as const) {
      const w = walk({ view: "pad_side", nearSide, durationSec: 10, seed: 42 });
      const p = prepare(w.frames, { rollDeg: 0, labels: "swaps" });
      const m = passesOf(p, "pad_side", nearSide);
      expect(m.passes).toHaveLength(1);
      expect(m.passes[0].d).toBe(nearSide === "right" ? 1 : -1);
      expect(m.passes[0].near).toBe(nearSide);
      expect(m.excluded.every((v) => v === 0)).toBe(true);
    }
  });

  it("marks a walk filmed from the front as the wrong view for a side view", () => {
    const w = walk({ view: "pad_front", durationSec: 6, seed: 43 });
    const p = prepare(w.frames, { rollDeg: 0, labels: "swaps" });
    expect(passesOf(p, "pad_side", "right").wrongViewShare).toBeGreaterThan(0.5);
  });
});

describe("front and back views", () => {
  const w = walk({ view: "front", passes: 2, seed: 44 });
  const p = prepare(w.frames, { rollDeg: 0, labels: "facing" });

  it("keeps the passes facing the phone as the front view and the passes walking away as the back view", () => {
    const front = passesOf(p, "front", undefined);
    const back = passesOf(p, "back", undefined);
    expect(front.passes.length).toBe(2);
    expect(back.passes.length).toBe(2);
    expect(front.passes.every((x) => x.facing === "toward")).toBe(true);
    expect(back.passes.every((x) => x.facing === "away")).toBe(true);
    const ms = (k: number) => p.series.t[k] * 1000;
    for (const x of front.passes) {
      const mid = ms((x.start + x.end) >> 1);
      expect(w.truth.passes.some((t) => t.kind === "toward" && mid >= t.from && mid <= t.to)).toBe(true);
    }
    for (const x of back.passes) {
      const mid = ms((x.start + x.end) >> 1);
      expect(w.truth.passes.some((t) => t.kind === "away" && mid >= t.from && mid <= t.to)).toBe(true);
    }
  });

  it("analyses only the samples 1.5 to 4 m from the phone and excludes the turn at the far end with its margins", () => {
    const front = passesOf(p, "front", undefined);
    const s = p.series;
    for (const pass of front.passes)
      for (const [a, b] of analysedRuns(pass, front.excluded))
        for (let k = a; k < b; k++) {
          const d = estimateDistanceM(trunkLengthAt(s, k), p.aspect);
          expect(d).toBeGreaterThanOrEqual(1.5);
          expect(d).toBeLessThanOrEqual(4);
        }
    // The second toward pass starts at the turn: its first second is a turn margin.
    const second = front.passes[1];
    expect(second.turnAtStart).toBe(true);
    for (let k = second.start; k < second.start + 30; k++) expect(front.excluded[k]).toBe(EXCLUDED.turn);
    expect(front.passes[0].turnAtStart).toBe(false);
  });
});
