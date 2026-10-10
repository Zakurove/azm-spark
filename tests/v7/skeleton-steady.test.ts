/**
 * D-036 item 5: the v7 skeleton (range measurement, block preview, walk) is smoothed like the v1 camera
 * exercise. Nasser: «the sticks seem to be lagging, shaky and jumping», against the steady v1 shoulder
 * press. The causes were raw landmarks drawn unfiltered, the first of two poses drawn whatever its
 * order, and joints shown or hidden at one threshold. src/app/skeleton.ts fixes each, for display only.
 */
import { describe, expect, it } from "vitest";
import { PoseSmoother } from "../../src/engine/oneEuro";
import type { Frame, Landmark } from "../../src/engine/types";
import { drawSkeleton, SKELETON_BONES, SKELETON_RULES, SteadySkeleton } from "../../src/app/skeleton";
import { markSubject } from "../../src/engine/subject";

/** A standing person centred at (cx, 0.5), every landmark seen. */
function person(cx: number, vis = 0.95): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: cx, y: 0.3, z: 0, visibility: vis }));
  const at = (i: number, dx: number, y: number) => (lm[i] = { x: cx + dx, y, z: 0, visibility: vis });
  at(0, 0, 0.2);
  at(11, -0.06, 0.3);
  at(12, 0.06, 0.3);
  at(13, -0.08, 0.42);
  at(14, 0.08, 0.42);
  at(15, -0.09, 0.53);
  at(16, 0.09, 0.53);
  at(23, -0.04, 0.55);
  at(24, 0.04, 0.55);
  at(25, -0.04, 0.7);
  at(26, 0.04, 0.7);
  at(27, -0.04, 0.85);
  at(28, 0.04, 0.85);
  for (const i of [29, 31]) at(i, -0.05, 0.88);
  for (const i of [30, 32]) at(i, 0.05, 0.88);
  return lm;
}

/** A small repeatable jitter (the model's frame to frame noise). */
const noise = (k: number, i: number) => Math.sin(k * 12.9898 + i * 78.233) * 0.006;
const jittered = (lm: Landmark[], k: number) =>
  lm.map((q, i) => ({ ...q, x: q.x + noise(k, i), y: q.y + noise(k + 7, i) }));
const frame = (t: number, poses: Landmark[][]): Frame => ({ t, lm: poses[0], poses, aspect: 9 / 16 });

describe("the steady skeleton (D-036 item 5)", () => {
  it("draws the v1 filter's points: the same One Euro as the shoulder press", () => {
    const steady = new SteadySkeleton();
    const v1 = new PoseSmoother();
    const base = person(0.5);
    for (let k = 0; k < 60; k++) {
      const t = k * 33;
      const lm = jittered(base, k);
      steady.push(frame(t, [lm]));
      const expected = v1.smooth(lm, t);
      const pose = steady.pose(t)!;
      for (const i of [11, 13, 15, 23, 25, 27]) {
        expect(pose.pts[i]!.x).toBeCloseTo(expected[i].x, 12);
        expect(pose.pts[i]!.y).toBeCloseTo(expected[i].y, 12);
      }
    }
  });

  it("steadies the jitter: the drawn wrist shakes far less than the model's", () => {
    const steady = new SteadySkeleton();
    const base = person(0.5);
    const raw: number[] = [];
    const drawn: number[] = [];
    for (let k = 0; k < 120; k++) {
      const lm = jittered(base, k);
      steady.push(frame(k * 33, [lm]));
      const pose = steady.pose(k * 33)!;
      if (k < 20) continue;
      raw.push(lm[15].x);
      drawn.push(pose.pts[15]!.x);
    }
    const spread = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    };
    expect(spread(drawn)).toBeLessThan(spread(raw) * 0.7);
  });

  it("follows one person when the model's two poses swap order (no jump to the other)", () => {
    const steady = new SteadySkeleton();
    const me = person(0.48);
    const other = person(0.85);
    for (let k = 0; k < 40; k++) {
      const poses = k % 2 ? [other, me] : [me, other];
      steady.push(frame(k * 33, poses));
      const pose = steady.pose(k * 33)!;
      expect(pose.pts[11]!.x).toBeCloseTo(me[11].x, 6);
    }
  });

  it("keeps a joint whose visibility hovers at the threshold (no popping in and out)", () => {
    const steady = new SteadySkeleton();
    const base = person(0.5);
    const alphas: number[] = [];
    for (let k = 0; k < 90; k++) {
      // The far elbow reads 0.45, 0.55, 0.4, 0.6 ... around the old single threshold of 0.5.
      const lm = base.map((q, i) => (i === 13 ? { ...q, visibility: k % 2 ? 0.55 : 0.4 } : q));
      steady.push(frame(k * 33, [lm]));
      alphas.push(steady.pose(k * 33)!.alpha[13]);
    }
    expect(Math.min(...alphas.slice(15))).toBeGreaterThan(0.95);
  });

  it("fades a lost joint out where it was, never jumping to the model's guess", () => {
    const steady = new SteadySkeleton();
    const base = person(0.5);
    let t = 0;
    for (let k = 0; k < 30; k++, t += 33) {
      steady.push(frame(t, [base]));
      steady.pose(t);
    }
    const before = steady.pose(t)!.pts[15]!;
    // The wrist leaves the picture: the model puts it far away with a low visibility.
    const lost = base.map((q, i) => (i === 15 ? { ...q, x: 0.05, y: 0.95, visibility: 0.1 } : q));
    steady.push(frame(t, [lost]));
    const first = steady.pose(t + 50)!;
    expect(first.pts[15]).toEqual(before);
    expect(first.alpha[15]).toBeGreaterThan(0.5);
    expect(first.alpha[15]).toBeLessThan(1);
    let later = first;
    for (let k = 1; k < 40; k++) {
      steady.push(frame(t + k * 33, [lost]));
      later = steady.pose(t + 50 + k * 33)!;
    }
    expect(later.alpha[15]).toBeLessThan(SKELETON_RULES.minAlpha);
    expect(later.pts[15]).toEqual(before);
  });

  it("starts a joint again where it comes back after a while (no glide across the picture)", () => {
    const steady = new SteadySkeleton();
    const base = person(0.5);
    steady.push(frame(0, [base]));
    steady.pose(0);
    const away = base.map((q, i) => (i === 16 ? { ...q, visibility: 0 } : q));
    for (let t = 33; t < 33 * 20; t += 33) steady.push(frame(t, [away]));
    const moved = base.map((q, i) => (i === 16 ? { ...q, x: 0.9, y: 0.2 } : q));
    steady.push(frame(33 * 20, [moved]));
    const pose = steady.pose(33 * 20)!;
    expect(pose.pts[16]).toEqual({ x: 0.9, y: 0.2 });
  });

  it("fades everything out when nobody is in the picture, then draws nothing", () => {
    const steady = new SteadySkeleton();
    steady.push(frame(0, [person(0.5)]));
    expect(steady.pose(0)).not.toBeNull();
    let pose = steady.pose(16);
    for (let t = 33; t < 2000; t += 33) {
      steady.push(frame(t, []));
      pose = steady.pose(t);
    }
    expect(pose).toBeNull();
  });

  it("paints each bone and joint with its own opacity (fading, not popping)", () => {
    const calls: { op: string; alpha: number }[] = [];
    let alpha = 1;
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      stroke: () => calls.push({ op: "stroke", alpha }),
      fill: () => calls.push({ op: "fill", alpha }),
      set globalAlpha(a: number) {
        alpha = a;
      },
      get globalAlpha() {
        return alpha;
      },
    } as unknown as CanvasRenderingContext2D;
    const pts = person(0.5).map((q) => ({ x: q.x, y: q.y }));
    const alphaOf = Array.from({ length: 33 }, (_, i) => (i === 13 ? 0.4 : i === 15 ? 0 : 1));
    drawSkeleton(ctx, { pts, alpha: alphaOf }, (x, y) => ({ x: x * 100, y: y * 100 }));
    const strokes = calls.filter((c) => c.op === "stroke");
    // Two passes (halo and line) over every bone but the one ending at the hidden wrist (13-15); the
    // shoulder to elbow bone (11-13) at the elbow's 0.4.
    expect(strokes).toHaveLength(2 * (SKELETON_BONES.length - 1));
    expect(strokes.filter((c) => c.alpha === 0.4)).toHaveLength(2);
    // Every joint but the hidden wrist (two discs each), the elbow at 0.4.
    const fills = calls.filter((c) => c.op === "fill");
    expect(fills.filter((c) => c.alpha === 0.4)).toHaveLength(2);
    expect(fills.some((c) => c.alpha === 0)).toBe(false);
  });

  it("draws only the screen's locked person: the pose its lock marked, nothing while unseen (D-037 item 4)", () => {
    const steady = new SteadySkeleton();
    const a = person(0.35);
    const b = person(0.6);
    // The screen's lock marked A (index 1 in the model's order), then marked nobody (A unseen).
    for (let k = 0; k < 20; k++) {
      const f = frame(k * 33, [b, a]);
      markSubject(f, 1);
      steady.push(f);
    }
    expect(steady.pose(20 * 33)!.pts[11]!.x).toBeCloseTo(a[11].x, 2);
    for (let k = 20; k < 60; k++) {
      const f = frame(k * 33, [b]);
      markSubject(f, -1);
      steady.push(f);
    }
    // Faded out where A was: B is never drawn.
    const pose = steady.pose(60 * 33 + 2000);
    expect(pose).toBeNull();
  });

  it("follows its own locked person when no screen lock reads the frames: B coming closer is not drawn", () => {
    const steady = new SteadySkeleton();
    const a = person(0.4);
    for (let k = 0; k < 20; k++) steady.push(frame(k * 33, [a]));
    // B comes in at the middle of the picture, larger (nearer the phone), first in the model's order.
    const b = person(0.5).map((q) => ({ ...q, y: 0.5 + (q.y - 0.5) * 1.4 }));
    for (let k = 20; k < 80; k++) steady.push(frame(k * 33, [b, a]));
    const pose = steady.pose(80 * 33)!;
    expect(pose.pts[11]!.x).toBeCloseTo(a[11].x, 2);
  });
});
