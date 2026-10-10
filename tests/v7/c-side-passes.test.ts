/**
 * D-036 item 6: the side walk's passes, counted live (src/engine/gait/sidePasses.ts, through the
 * LiveStepCounter and the GaitController). A pass is one walk across the picture. Synthetic tracks of
 * a body seen from the side, scripted along the picture's width: fast, slow, leaving the picture,
 * turning just inside it, stopping in the middle, cut off at the edges, frames missing, a short path,
 * a walk toward and away from the phone (Nasser's third test), a lock that loses the walker, and a
 * person standing still. Each walk across counts once, a turn never twice, and standing still counts
 * neither a pass nor a step.
 */
import { describe, expect, it } from "vitest";
import { LiveStepCounter } from "../../src/engine/gait/live";
import { SIDE_PASS, SidePassCounter } from "../../src/engine/gait/sidePasses";
import type { GaitFrame } from "../../src/engine/gait/types";
import type { Frame, Landmark } from "../../src/engine/types";
import { CAPTURE_LIMITS, GaitController } from "../../src/features/gait/controller";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { rng } from "../fixtures/gen";

/* ------------------------------------------------------------ the tracks */

/** One part of a track: walk to x (share of the width) at a speed (widths a second), or stay still. */
type Leg = { to: number; speed: number } | { still: number };

interface TrackOptions {
  /** The body's size: its trunk in picture heights (0.18: about 3 m from a phone on its side). */
  size?: number | ((t: number) => number);
  fps?: number;
  /** A share of the frames lost at random (the model found nobody). */
  drop?: number;
  /** Times (ms from the start) with no frame of the person at all. */
  gaps?: [number, number][];
  /** The feet are below the picture the whole time (only the trunk and the hips are seen). */
  noFeet?: boolean;
  noise?: number;
  seed?: number;
  start?: number;
}

/** Where the scripted body is at each time, and whether it walks (the legs swing only then). */
function script(x0: number, legs: Leg[]): { t: number; x: number; walking: boolean }[] {
  const out: { t: number; x: number; walking: boolean }[] = [];
  let t = 0;
  let x = x0;
  const dt = 1 / 120;
  for (const leg of legs) {
    if ("still" in leg) {
      for (let s = 0; s < leg.still; s += dt) out.push({ t: (t += dt), x, walking: false });
      continue;
    }
    const dir = Math.sign(leg.to - x);
    while ((leg.to - x) * dir > 0) {
      x += dir * leg.speed * dt;
      out.push({ t: (t += dt), x, walking: true });
    }
  }
  return out;
}

/** The landmarks of a side on body whose mid hip is at x, of a size, its legs at a phase. */
function body(x: number, size: number, phase: number, walking: boolean, noFeet: boolean): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const hipY = 0.5;
  const swing = walking ? 0.35 * size * Math.sin(phase) : 0;
  const put = (i: number, px: number, py: number) => {
    const inside = px >= 0 && px <= 1 && py >= 0 && py <= 1;
    lm[i] = { x: px, y: py, z: 0, visibility: inside ? 0.95 : 0.1 };
  };
  for (const i of [0, 2, 5, 7, 8]) put(i, x + 0.02 * size, hipY - 1.35 * size);
  put(11, x, hipY - size);
  put(12, x + 0.01 * size, hipY - size);
  put(23, x, hipY);
  put(24, x + 0.01 * size, hipY);
  put(25, x + swing / 2, hipY + 0.9 * size);
  put(26, x - swing / 2, hipY + 0.9 * size);
  for (const [i, s] of [
    [27, 1],
    [29, 1],
    [31, 1],
    [28, -1],
    [30, -1],
    [32, -1],
  ] as const)
    put(i, x + s * swing + (i >= 31 ? 0.15 * size : i >= 29 ? -0.05 * size : 0), hipY + 1.8 * size);
  if (noFeet) for (const i of [25, 26, 27, 28, 29, 30, 31, 32]) lm[i] = { ...lm[i], visibility: 0.05 };
  return lm;
}

/** A walk along a script as the camera gives it: frames at fps, the body out of the picture dropped. */
function track(x0: number, legs: Leg[], o: TrackOptions = {}): GaitFrame[] {
  const fps = o.fps ?? 30;
  const r = rng(o.seed ?? 7);
  const path = script(x0, legs);
  const end = path[path.length - 1].t;
  const frames: GaitFrame[] = [];
  const start = o.start ?? 10_000;
  let k = 0;
  let phase = 0;
  for (let t = 0; t <= end; t += 1 / fps) {
    while (k < path.length - 1 && path[k].t < t) k++;
    const p = path[k];
    if (p.walking) phase += (2 * Math.PI * (1 / fps)) / 1.1;
    const ms = start + t * 1000;
    const size = typeof o.size === "function" ? o.size(t) : (o.size ?? 0.18);
    // Nobody: out of the picture (the mid hip more than half a body past an edge), a lost frame, a gap.
    const out = p.x < -0.06 || p.x > 1.06;
    const lost = (o.drop ?? 0) > 0 && r() < o.drop!;
    const gap = o.gaps?.some(([a, b]) => t * 1000 >= a && t * 1000 < b);
    let lm = body(p.x, size, phase, p.walking, o.noFeet === true);
    if (o.noise)
      lm = lm.map((q) => ({ ...q, x: q.x + (r() - 0.5) * o.noise!, y: q.y + (r() - 0.5) * o.noise! }));
    if (out || lost || gap) lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
    frames.push({ t: ms, lm, aspect: 16 / 9 });
  }
  return frames;
}

/** The passes the side counter gives, polled each frame and for 3 s after the last one. */
function passesOf(frames: readonly GaitFrame[]): { passes: number; at: number[]; depth: boolean } {
  const c = new SidePassCounter();
  const at: number[] = [];
  let depth = false;
  let n = 0;
  const seen = (s: { passes: number; depth: boolean }, t: number) => {
    if (s.passes > n) at.push(Math.round(t));
    n = s.passes;
    depth ||= s.depth;
  };
  for (const f of frames) seen(c.feed(f.t, f.lm.some((q) => q.visibility > 0) ? f.lm : null), f.t);
  const last = frames[frames.length - 1].t;
  for (let t = last; t <= last + 3000; t += 250) seen(c.poll(t), t);
  return { passes: n, at, depth };
}

/** Across and back n times, from x0 to x1 and back, each walk at a speed, a turn of turnSec between. */
function acrossAndBack(x0: number, x1: number, n: number, speed: number, turnSec = 1.2): Leg[] {
  const legs: Leg[] = [{ still: 0.5 }];
  for (let i = 0; i < n; i++) {
    legs.push({ to: i % 2 === 0 ? x1 : x0, speed });
    legs.push({ still: turnSec });
  }
  return legs;
}

/* ------------------------------------------------------------ the counter */

describe("the side walk's passes: one walk across the picture each (D-036 item 6)", () => {
  it("counts a walk across that leaves the picture at each end, as the person arrives", () => {
    // From the left end out past the right edge, a turn out of the picture, back in and out past the
    // left edge: four walks across.
    const r = passesOf(track(0.12, acrossAndBack(-0.2, 1.2, 4, 0.3, 1.5)));
    expect(r.passes).toBe(4);
    expect(r.depth).toBe(false);
  });

  it("counts a fast walk and a slow one the same", () => {
    for (const speed of [0.45, 0.25, 0.08, 0.05]) {
      const r = passesOf(track(0.15, acrossAndBack(0.15, 0.85, 4, speed)));
      expect(r.passes, `speed ${speed}`).toBe(4);
    }
  });

  it("counts a turn just inside the picture, and never counts a turn twice", () => {
    // Turns just past the zones (0.27 and 0.73), and a slow turn in place that sways about the line.
    const legs: Leg[] = [{ still: 0.5 }];
    for (let i = 0; i < 4; i++) {
      legs.push({ to: i % 2 === 0 ? 0.73 : 0.27, speed: 0.2 });
      for (let k = 0; k < 4; k++)
        legs.push(
          { to: i % 2 === 0 ? 0.7 : 0.3, speed: 0.05 },
          { to: i % 2 === 0 ? 0.74 : 0.26, speed: 0.05 },
        );
      legs.push({ still: 1 });
    }
    const r = passesOf(track(0.27, legs, { noise: 0.01 }));
    expect(r.passes).toBe(4);
  });

  it("counts a walk with a stop in the middle once", () => {
    const legs: Leg[] = [{ still: 0.5 }];
    for (let i = 0; i < 4; i++) {
      legs.push(
        { to: 0.5, speed: 0.2 },
        { still: 3 },
        { to: i % 2 === 0 ? 0.85 : 0.15, speed: 0.2 },
        { still: 1 },
      );
    }
    const r = passesOf(track(0.15, legs));
    expect(r.passes).toBe(4);
  });

  it("counts a body cut off at the edges, its feet below the picture, with frames missing", () => {
    const r = passesOf(
      track(0.1, acrossAndBack(0.02, 0.98, 4, 0.25), {
        noFeet: true,
        drop: 0.3,
        gaps: [
          [2000, 2600],
          [9000, 9500],
        ],
        noise: 0.006,
      }),
    );
    expect(r.passes).toBe(4);
  });

  it("counts a short path that never reaches either side zone at each turn, and its last walk at the stop", () => {
    // A phone far away: the path spans the middle third of the picture.
    const r = passesOf(track(0.36, acrossAndBack(0.36, 0.66, 4, 0.12)));
    expect(r.passes).toBe(4);
  });

  it("never counts a walk toward the phone and away from it, even off to one side, and says so", () => {
    // Nasser's third test: toward the phone and back in the side recording. The body grows from 0.1 to
    // 0.3 of the picture and drifts across it (the path is off the phone's line).
    const legs: Leg[] = [{ still: 0.5 }];
    for (let i = 0; i < 4; i++) legs.push({ to: i % 2 === 0 ? 0.82 : 0.45, speed: 0.08 }, { still: 1 });
    const frames = track(0.45, legs, {
      size: (t) => {
        const cycle = 5.6;
        const u = (t % cycle) / cycle;
        return 0.1 + 0.2 * (u < 0.5 ? 2 * u : 2 - 2 * u);
      },
    });
    const r = passesOf(frames);
    expect(r.passes).toBe(0);
    expect(r.depth).toBe(true);
  });

  it("starts a new walk, never a pass, when the centre moves faster than anyone walks", () => {
    const c = new SidePassCounter();
    const a = track(0.2, [{ still: 1 }]);
    const b = track(0.85, [{ still: 1 }], { start: a[a.length - 1].t + 33 });
    for (const f of [...a, ...b]) c.feed(f.t, f.lm);
    expect(c.poll(b[b.length - 1].t + 3000).passes).toBe(0);
  });

  it("holds its rules as engineering choices inside the picture", () => {
    expect(SIDE_PASS.zone).toBe(0.3);
    expect(SIDE_PASS.minRunShare).toBeLessThan(1 - 2 * SIDE_PASS.zone);
    expect(SIDE_PASS.stopMs).toBeLessThan(CAPTURE_LIMITS.overgroundMaxSec * 1000);
  });
});

describe("the live counter of the side walk", () => {
  it("counts neither a pass nor a step while the person stands still and the model jitters", () => {
    const live = new LiveStepCounter("side");
    let r = live.feed(track(0.5, [{ still: 0.1 }])[0]);
    for (const f of track(0.5, [{ still: 30 }], { noise: 0.01, seed: 3 })) r = live.feed(f);
    expect(r.passes).toBe(0);
    expect(r.steps).toBe(0);
  });

  it("counts the passes and about the steps of a walk across", () => {
    const live = new LiveStepCounter("side");
    let r = live.feed(track(0.15, [{ still: 0.1 }])[0]);
    const frames = track(0.15, acrossAndBack(0.15, 0.85, 4, 0.25), { noise: 0.002 });
    for (const f of frames) r = live.feed(f);
    r = live.poll(frames[frames.length - 1].t + 2000);
    expect(r.passes).toBe(4);
    // 2.8 s a walk at 0.55 s a step: about 5 steps each.
    expect(r.steps).toBeGreaterThanOrEqual(12);
    expect(r.steps).toBeLessThanOrEqual(28);
  });

  it("says a walk turned back too soon to count", () => {
    const live = new LiveStepCounter("side");
    let short = false;
    for (const f of track(0.4, acrossAndBack(0.4, 0.55, 3, 0.15))) short ||= live.feed(f).short;
    expect(short).toBe(true);
  });
});

/* ------------------------------------------------------------ the capture */

const SIDE: GaitPlan = {
  offered: true,
  modes: ["overground"],
  defaultMode: "overground",
  padAllowed: false,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: false,
  views: { overground: ["side"], walking_pad: [] },
};

/** A controller on its side walk's standing step. */
function standing(): { ctl: GaitController; t: number } {
  const ctl = new GaitController({ plan: SIDE, painBefore: null, poseModel: () => "full", log: () => {} });
  const t = 1000;
  ctl.start(t);
  for (let i = 0; i < 10 && ctl.current.id !== "stand"; i++)
    if (ctl.current.id === "gear") ctl.setGear({ shoes: true, brace: null }, t);
    else ctl.confirm(t);
  expect(ctl.current.id).toBe("stand");
  return { ctl, t };
}

const camera = (frames: readonly GaitFrame[]): Frame[] =>
  frames.map((f) => ({
    t: f.t,
    lm: f.lm,
    poses: f.lm.some((q) => q.visibility > 0) ? [f.lm] : [],
    aspect: f.aspect,
  }));

describe("the side walk in the capture (D-036 item 6)", () => {
  it("finds the walker again after the lock lost them: every pass counts, and the walk finishes at 4", () => {
    const { ctl } = standing();
    const still = track(0.15, [{ still: 3.5 }], { start: 2000 });
    for (const f of camera(still)) ctl.feed(f, { rollDeg: null });
    expect(ctl.current.id).toBe("walk");
    // The walker leaves the picture at each end and comes back in a little elsewhere, where the lock
    // never trusted them (its jump rule): before D-036 the lock stayed on the place it last trusted
    // and every later pass was lost.
    const legs: Leg[] = [{ to: 1.2, speed: 0.3 }, { still: 1.5 }];
    const frames = track(0.15, legs, { start: 6000 });
    const back = track(0.9, [{ to: -0.2, speed: 0.3 }, { still: 1.5 }, { to: 0.75, speed: 0.3 }], {
      start: frames[frames.length - 1].t + 1500,
    });
    const again = track(0.75, [{ to: 1.2, speed: 0.3 }, { still: 1.5 }, { to: 0.1, speed: 0.3 }], {
      start: back[back.length - 1].t + 1500,
    });
    let t = 0;
    for (const f of camera([...frames, ...back, ...again])) {
      ctl.feed(f, { rollDeg: null });
      ctl.tick(f.t);
      t = f.t;
      if (ctl.current.id !== "walk") break;
    }
    for (let i = 0; i < 4 && ctl.current.id === "walk"; i++) ctl.tick((t += CAPTURE_LIMITS.afterLastPassMs));
    const d = ctl.diagnostics()[0];
    expect(d.passes).toBeGreaterThanOrEqual(4);
    expect(ctl.current.id).not.toBe("walk");
  });

  it("says «walk across the picture, not toward the phone» when the person walks toward it", () => {
    const { ctl } = standing();
    for (const f of camera(track(0.5, [{ still: 3.5 }], { start: 2000 }))) ctl.feed(f, { rollDeg: null });
    const legs: Leg[] = [];
    for (let i = 0; i < 3; i++) legs.push({ to: i % 2 === 0 ? 0.6 : 0.5, speed: 0.03 }, { still: 0.5 });
    const hints = new Set<string | null>();
    for (const f of camera(
      track(0.5, legs, { start: 6000, size: (t) => 0.1 + 0.2 * Math.min(1, (t % 7) / 3.5) }),
    )) {
      ctl.feed(f, { rollDeg: null });
      ctl.tick(f.t);
      hints.add(ctl.hint);
    }
    expect(hints.has("across")).toBe(true);
    expect(ctl.live()!.passes).toBe(0);
  });
});
