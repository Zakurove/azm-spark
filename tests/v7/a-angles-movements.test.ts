/**
 * The 16 movement angles and their calibration (src/engine/rom/angles.ts, product v7 contract 2.3):
 * each AngleFn on poses built with a known angle, in its convention (flexion clamped at 0, lack and
 * signed below 0 past straight), the same when the person faces the other way, in a mirrored picture
 * and with the phone rolled (the sensor's roll given), null when a gate landmark is unseen.
 * calibrate gives the start pose medians, the gravity reference of the arm raises when the hips are
 * hidden (v1.1 4.1), the neutral head and the start angle. shoulder_abduction is the v1 RangeTestRunner
 * measurement on the six v1 fixtures. With AZM_CLINICAL_V7 set to the clinical folder, every angle
 * definition, zero and direction of rom-protocol.json is quoted word for word in angles.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Landmark } from "../../src/engine/types";
import { toPixelSpace } from "../../src/engine/geometry";
import { downVector, signedAngle } from "../../src/engine/modes/common";
import { RANGE_RULES } from "../../src/engine/modes/rangeTest";
import {
  EAR_LINE_MIN_VISIBILITY,
  HIPS_SEEN_SHARE,
  MOVEMENT_ANGLES,
  ankleDorsiflexionHeel,
  calibrate,
  cameraSide,
  neckSideBendLine,
  type AngleContext,
  type Pt,
} from "../../src/engine/rom/angles";
import { ROM_DATA, movementDef } from "../../src/movements/rom";
import {
  ROM_MOVEMENT_IDS,
  type LandmarkRef,
  type RomMovementId,
  type RomSide,
} from "../../src/movements/rom/types";
import { FIXTURE_ROOT, loadFixture } from "../fixtures/format";

/* ------------------------------------------------------------------ pose building */

const RAD = Math.PI / 180;
type Pts = Partial<Record<number, Pt>>;
/** A point at `len` from `o` in picture direction `deg` (0 to the picture's right, 90 down; y points down). */
const toward = (o: Pt, len: number, deg: number): Pt => ({
  x: o.x + len * Math.cos(deg * RAD),
  y: o.y + len * Math.sin(deg * RAD),
});
/** `p` turned by `deg` about `c` (positive turns the picture's right toward its bottom). */
const turn = (p: Pt, c: Pt, deg: number): Pt => {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const co = Math.cos(deg * RAD);
  const si = Math.sin(deg * RAD);
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
};

/** 33 landmarks: the given points at visibility `near` (or their own), the rest unseen. */
function pose(points: Pts, vis: Partial<Record<number, number>> = {}): Landmark[] {
  return Array.from({ length: 33 }, (_, i) => {
    const p = points[i];
    return p ? { x: p.x, y: p.y, z: 0, visibility: vis[i] ?? 0.95 } : { x: 0.5, y: 0.5, z: 0, visibility: 0 };
  });
}

/** Left and right landmark pairs of MediaPipe (0 has none). */
const SWAP = (i: number) => (i >= 11 ? (i % 2 ? i + 1 : i - 1) : [0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9][i]);
/** The person turned to face the other way: x reflected, the model's labels kept (a side view from the other side). */
const otherWay = (px: Landmark[]) => px.map((q) => ({ ...q, x: 1 - q.x }));
/** A mirrored picture (front camera preview): x reflected and the model's left and right labels exchanged. */
const mirrorPicture = (px: Landmark[]) => px.map((_, i) => ({ ...px[SWAP(i)], x: 1 - px[SWAP(i)].x }));
/** The phone rolled by `deg`: the picture turns so that the true down is downVector(deg). */
const rollPicture = (px: Landmark[], deg: number) =>
  px.map((q) => ({ ...q, ...turn(q, { x: 0.5, y: 0.5 }, deg) }));

/** A side view of a person facing the picture's right, right side nearest the phone (far side less visible). */
function sideBody(over: Pts = {}, overVis: Partial<Record<number, number>> = {}): Landmark[] {
  const near: Pts = {
    0: { x: 0.56, y: 0.22 },
    6: { x: 0.545, y: 0.205 },
    8: { x: 0.495, y: 0.21 },
    12: { x: 0.5, y: 0.3 },
    14: { x: 0.5, y: 0.45 },
    16: { x: 0.5, y: 0.58 },
    24: { x: 0.5, y: 0.6 },
    26: { x: 0.5, y: 0.78 },
    28: { x: 0.5, y: 0.95 },
    30: { x: 0.47, y: 0.97 },
    32: { x: 0.58, y: 0.97 },
  };
  const far: Pts = {};
  const vis: Partial<Record<number, number>> = { 0: 0.9 };
  for (const [k, p] of Object.entries(near)) {
    const i = Number(k);
    if (i === 0) continue;
    far[SWAP(i)] = { x: p!.x + 0.005, y: p!.y };
    vis[SWAP(i)] = 0.4;
  }
  return pose({ ...far, ...near, ...over }, { ...vis, ...overVis });
}

/** A person facing the phone: the person's left (the model's left, odd ids) on the picture's right. */
function frontBody(over: Pts = {}, overVis: Partial<Record<number, number>> = {}): Landmark[] {
  const base: Pts = {
    0: { x: 0.5, y: 0.2 },
    2: { x: 0.515, y: 0.19 },
    5: { x: 0.485, y: 0.19 },
    7: { x: 0.53, y: 0.21 },
    8: { x: 0.47, y: 0.21 },
    11: { x: 0.58, y: 0.3 },
    12: { x: 0.42, y: 0.3 },
    13: { x: 0.59, y: 0.45 },
    14: { x: 0.41, y: 0.45 },
    15: { x: 0.6, y: 0.58 },
    16: { x: 0.4, y: 0.58 },
    23: { x: 0.55, y: 0.6 },
    24: { x: 0.45, y: 0.6 },
    25: { x: 0.55, y: 0.78 },
    26: { x: 0.45, y: 0.78 },
    27: { x: 0.55, y: 0.95 },
    28: { x: 0.45, y: 0.95 },
    29: { x: 0.55, y: 0.97 },
    30: { x: 0.45, y: 0.97 },
    31: { x: 0.56, y: 0.99 },
    32: { x: 0.44, y: 0.99 },
  };
  return pose({ ...base, ...over }, overVis);
}

/* ------------------------------------------------------------------ the cases */

interface Case {
  id: RomMovementId;
  /** the person's tested side, or the bend direction */
  side: RomSide;
  /** the true angle of the start pose (calibration) */
  start: number;
  /** the pose at a true angle value */
  at(value: number): Landmark[];
  /** true values and what the AngleFn returns for them */
  values: [truth: number, want: number][];
  view: "side" | "front";
}

const same = (...vs: number[]): [number, number][] => vs.map((v) => [v, v]);

const CASES: Case[] = [
  {
    id: "shoulder_flexion",
    side: "right",
    start: 0,
    view: "side",
    at: (th) => {
      const S = { x: 0.5, y: 0.3 };
      const E = toward(S, 0.15, 90 - th);
      return sideBody({ 12: S, 14: E, 16: toward(E, 0.13, 90 - th) });
    },
    values: [...same(0, 30, 90, 150, 180), [200, 180], [-30, 0]],
  },
  {
    id: "shoulder_abduction",
    side: "right",
    start: 0,
    view: "front",
    at: (th) => {
      const S = { x: 0.42, y: 0.3 };
      const E = toward(S, 0.15, 90 + th);
      return frontBody({ 14: E, 16: toward(E, 0.13, 90 + th) });
    },
    values: [...same(0, 45, 90, 135, 170), [195, 180], [-15, 0]],
  },
  {
    id: "shoulder_extension",
    side: "right",
    start: 0,
    view: "side",
    at: (th) => {
      const S = { x: 0.5, y: 0.3 };
      const E = toward(S, 0.15, 90 + th);
      return sideBody({ 14: E, 16: toward(E, 0.13, 90 + th) });
    },
    values: [...same(0, 20, 45, 60), [-30, 0]],
  },
  {
    id: "elbow_extension",
    side: "right",
    start: 90,
    view: "side",
    at: (b) => sideBody({ 16: toward({ x: 0.5, y: 0.45 }, 0.13, 90 - b) }),
    values: same(90, 45, 10, 0, -5),
  },
  {
    id: "elbow_flexion",
    side: "right",
    start: 0,
    view: "side",
    at: (b) => sideBody({ 16: toward({ x: 0.5, y: 0.45 }, 0.13, 90 - b) }),
    values: [...same(0, 45, 90, 140), [-10, 10]],
  },
  {
    // Lying on the back, head toward the picture's left, face up.
    id: "hip_flexion",
    side: "right",
    start: 0,
    view: "side",
    at: (f) => {
      const H = { x: 0.6, y: 0.6 };
      const K = toward(H, 0.18, -f);
      return sideBody({
        0: { x: 0.22, y: 0.56 },
        6: { x: 0.235, y: 0.565 },
        8: { x: 0.25, y: 0.6 },
        12: { x: 0.3, y: 0.6 },
        24: H,
        26: K,
        28: toward(K, 0.17, f > 0 ? 60 : 0),
      });
    },
    values: same(0, 45, 90, 120),
  },
  {
    id: "hip_extension",
    side: "right",
    start: 0,
    view: "side",
    at: (e) => {
      const K = toward({ x: 0.5, y: 0.6 }, 0.18, 90 + e);
      return sideBody({ 26: K, 28: toward(K, 0.17, 90 + e) });
    },
    values: same(0, 10, 20, -10),
  },
  {
    id: "hip_abduction",
    side: "right",
    start: 0,
    view: "front",
    at: (a) => {
      const K = toward({ x: 0.45, y: 0.6 }, 0.18, 90 + a);
      return frontBody({ 26: K, 28: toward(K, 0.17, 90 + a) });
    },
    values: [...same(0, 15, 30, 45), [-10, 0]],
  },
  {
    // Lying on the back, heel slide.
    id: "knee_flexion",
    side: "right",
    start: 0,
    view: "side",
    at: (f) => {
      const K = { x: 0.5, y: 0.6 };
      return sideBody({ 24: { x: 0.3, y: 0.6 }, 26: K, 28: toward(K, 0.17, -f) });
    },
    values: same(0, 45, 90, 130),
  },
  {
    // Lying on the back: a bent knee rises above the hip to ankle line, past straight it sinks below it.
    id: "knee_extension",
    side: "right",
    start: 20,
    view: "side",
    at: (lack) => {
      const K = { x: 0.5, y: 0.55 };
      return sideBody({ 24: toward(K, 0.2, 180 - lack / 2), 26: K, 28: toward(K, 0.17, lack / 2) });
    },
    values: same(20, 10, 0, -5),
  },
  {
    // Facing the wall (the picture's right), tested foot in front.
    id: "ankle_dorsiflexion_lunge",
    side: "right",
    start: 0,
    view: "side",
    at: (p) => {
      const A = { x: 0.5, y: 0.9 };
      const K = toward(A, 0.2, -90 + p);
      return sideBody({
        24: toward(K, 0.2, -90 + p / 3),
        26: K,
        28: A,
        30: { x: 0.47, y: 0.92 },
        32: { x: 0.58, y: 0.92 },
      });
    },
    values: [...same(0, 15, 30, 45), [-10, 0]],
  },
  {
    // Bending toward the person's left, the picture's right in a front view.
    id: "trunk_lateral_flexion",
    side: "left",
    start: 0,
    view: "front",
    at: (l) => {
      const MS = toward({ x: 0.5, y: 0.6 }, 0.3, -90 + l);
      return frontBody({ 11: toward(MS, 0.08, l), 12: toward(MS, 0.08, 180 + l) });
    },
    values: [...same(0, 15, 30), [-20, 0]],
  },
  {
    id: "trunk_flexion",
    side: "none",
    start: 0,
    view: "side",
    at: (t) => {
      const H = { x: 0.5, y: 0.6 };
      const S = toward(H, 0.3, -90 + t);
      return sideBody({
        0: toward(S, 0.1, -90 + t + 35),
        6: toward(S, 0.085, -90 + t + 25),
        8: toward(S, 0.08, -90 + t),
        12: S,
        24: H,
      });
    },
    values: [...same(0, 30, 60, 90, 110), [-10, 0]],
  },
  {
    // Tilting toward the person's left: the left ear (picture's right) goes down.
    id: "neck_lateral_flexion",
    side: "left",
    start: 0,
    view: "front",
    at: (n) => {
      const C = { x: 0.5, y: 0.2 };
      const h = (p: Pt) => turn(p, C, n);
      return frontBody({
        0: h({ x: 0.5, y: 0.215 }),
        2: h({ x: 0.515, y: 0.19 }),
        5: h({ x: 0.485, y: 0.19 }),
        7: h({ x: 0.53, y: 0.21 }),
        8: h({ x: 0.47, y: 0.21 }),
      });
    },
    values: [...same(0, 10, 25, 40), [-15, 0]],
  },
  {
    id: "neck_flexion",
    side: "none",
    start: 0,
    view: "side",
    at: (n) => {
      const ear = { x: 0.5, y: 0.22 };
      return sideBody({
        12: { x: 0.5, y: 0.35 },
        24: { x: 0.5, y: 0.65 },
        8: ear,
        6: turn({ x: 0.56, y: 0.232 }, ear, n),
        0: turn({ x: 0.58, y: 0.25 }, ear, n),
      });
    },
    values: [...same(0, 20, 40), [-15, 0]],
  },
  {
    id: "neck_extension",
    side: "none",
    start: 0,
    view: "side",
    at: (n) => {
      const ear = { x: 0.5, y: 0.22 };
      return sideBody({
        12: { x: 0.5, y: 0.35 },
        24: { x: 0.5, y: 0.65 },
        8: ear,
        6: turn({ x: 0.56, y: 0.232 }, ear, -n),
        0: turn({ x: 0.58, y: 0.25 }, ear, -n),
      });
    },
    values: [...same(0, 20, 40), [-15, 0]],
  },
];

/* ------------------------------------------------------------------ helpers */

type Base = Omit<AngleContext, "calibration">;
const base = (side: RomSide, over: Partial<Base> = {}): Base => ({
  side,
  mirrored: false,
  rollDeg: 0,
  ...over,
});

/** Calibrates on three start frames, then reads the angle of `px`. */
function measure(c: Case, px: Landmark[], start: Landmark[], b: Base): number | null {
  const cal = calibrate(c.id, [{ px: start }, { px: start }, { px: start }], b);
  expect(cal, `${c.id} calibration`).not.toBeNull();
  return MOVEMENT_ANGLES[c.id](px, { ...b, calibration: cal! });
}

function expectAngle(got: number | null, want: number, what: string) {
  expect(got, what).not.toBeNull();
  expect(Math.abs(got! - want), `${what}: ${got} for ${want}`).toBeLessThan(1e-6);
}

/** The landmark ids of a role for the model's side `side` (the test's own reading of the data). */
function roleIds(ref: LandmarkRef, side: "left" | "right"): number[] {
  if (typeof ref === "number") return [ref];
  if (Array.isArray(ref)) return [...ref];
  if ("mid" in ref) return [...ref.mid];
  if ("other" in ref) return [ref.other === "hip" ? (side === "left" ? 24 : 23) : side === "left" ? 26 : 25];
  return [ref[side]];
}

/* ------------------------------------------------------------------ tests */

describe("MOVEMENT_ANGLES", () => {
  it("has an angle for every measured movement and a case here for each", () => {
    expect(Object.keys(MOVEMENT_ANGLES).sort()).toEqual([...ROM_MOVEMENT_IDS].sort());
    expect(CASES.map((c) => c.id).sort()).toEqual([...ROM_MOVEMENT_IDS].sort());
  });

  for (const c of CASES) {
    describe(c.id, () => {
      const start = c.at(c.start);

      it("reads the true angle in the movement's convention", () => {
        for (const [truth, want] of c.values)
          expectAngle(measure(c, c.at(truth), start, base(c.side)), want, `${truth}`);
      });

      it("calibrates the start angle", () => {
        const cal = calibrate(c.id, [{ px: start }, { px: start }], base(c.side))!;
        expect(cal.t).toBe(0);
        expect(Math.abs(cal.startDeg - Math.max(c.start, 0))).toBeLessThan(1e-6);
      });

      it("reads the same in a mirrored picture", () => {
        for (const [truth, want] of c.values)
          expectAngle(
            measure(c, mirrorPicture(c.at(truth)), mirrorPicture(start), base(c.side, { mirrored: true })),
            want,
            `mirrored ${truth}`,
          );
      });

      if (c.view === "side")
        it("reads the same when the person faces the other way", () => {
          for (const [truth, want] of c.values)
            expectAngle(
              measure(c, otherWay(c.at(truth)), otherWay(start), base(c.side)),
              want,
              `other way ${truth}`,
            );
        });

      it("reads the same with the phone rolled 15 degrees and the roll reported", () => {
        for (const [truth, want] of c.values)
          expectAngle(
            measure(c, rollPicture(c.at(truth), 15), rollPicture(start, 15), base(c.side, { rollDeg: 15 })),
            want,
            `rolled ${truth}`,
          );
      });

      it("is null when a gate landmark is unseen", () => {
        const def = movementDef(c.id);
        const px = c.at(c.values[1][0]);
        const cal = calibrate(c.id, [{ px: start }], base(c.side))!;
        const side = c.side === "none" ? cameraSide(px) : c.side;
        for (const g of def.gate) {
          const roles = typeof g === "string" ? [g] : g.anyOf;
          if (roles.includes("MHf")) continue; // the fixed mid hip comes from the calibration
          // The arm raises to the front and back read the start trunk line without their hip (D-034 item 1).
          if ((c.id === "shoulder_flexion" || c.id === "shoulder_extension") && roles.includes("H")) {
            const hipless = px.map((q) => ({ ...q }));
            for (const i of roleIds(def.landmarks.H, side)) hipless[i].visibility = 0.2;
            expectAngle(
              MOVEMENT_ANGLES[c.id](hipless, { ...base(c.side), calibration: cal }),
              MOVEMENT_ANGLES[c.id](px, { ...base(c.side), calibration: cal })!,
              "the start trunk line",
            );
            continue;
          }
          const hidden = px.map((q) => ({ ...q }));
          for (const r of roles) for (const i of roleIds(def.landmarks[r], side)) hidden[i].visibility = 0.2;
          expect(MOVEMENT_ANGLES[c.id](hidden, { ...base(c.side), calibration: cal }), `${roles}`).toBeNull();
        }
      });
    });
  }

  it("never reads below 0 for a movement that cannot be negative, and stays within (-180, 180]", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 0.8 + 0.1;
    for (const c of CASES) {
      const def = movementDef(c.id);
      const cal = calibrate(c.id, [{ px: c.at(c.start) }], base(c.side))!;
      for (let k = 0; k < 300; k++) {
        const px = Array.from({ length: 33 }, () => ({ x: rand(), y: rand(), z: 0, visibility: 0.9 }));
        const a = MOVEMENT_ANGLES[c.id](px, { ...base(c.side), calibration: cal });
        if (a === null) continue;
        expect(Number.isFinite(a)).toBe(true);
        expect(a).toBeGreaterThan(-180);
        expect(a).toBeLessThanOrEqual(180);
        if (!def.canBeNegative) expect(a, c.id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gates at the data's visibility floor (rom-protocol engine.visibilityMin)", () => {
    expect(ROM_DATA.engine.visibilityMin).toBe(0.6);
    const c = CASES.find((k) => k.id === "elbow_flexion")!;
    const cal = calibrate(c.id, [{ px: c.at(0) }], base("right"))!;
    const at = (v: number) => sideBody({ 16: toward({ x: 0.5, y: 0.45 }, 0.13, 45) }, { 16: v });
    expect(MOVEMENT_ANGLES.elbow_flexion(at(0.6), { ...base("right"), calibration: cal })).not.toBeNull();
    expect(MOVEMENT_ANGLES.elbow_flexion(at(0.59), { ...base("right"), calibration: cal })).toBeNull();
  });

  it("measures the left side with the left landmarks", () => {
    // The person faces the picture's left, left side near: the right flexion case seen from the other side with labels exchanged.
    const c = CASES.find((k) => k.id === "shoulder_flexion")!;
    const left = (px: Landmark[]) => otherWay(px).map((_, i, all) => ({ ...all[SWAP(i)] }));
    for (const [truth, want] of c.values)
      expectAngle(measure(c, left(c.at(truth)), left(c.at(0)), base("left")), want, `left ${truth}`);
  });
});

describe("the movement specific rules", () => {
  it("shoulder flexion uses the nose at any visibility, for the face side only", () => {
    const c = CASES[0];
    const px = c.at(90);
    px[0].visibility = 0.05;
    expectAngle(measure(c, px, c.at(0), base("right")), 90, "nose barely seen");
  });

  it("shoulder flexion in gravity mode: the hip hidden at calibration, measured against the start trunk line", () => {
    // Reclined 15 degrees: the hips forward of the shoulders. The hip is hidden by the chair but the model still places it.
    const S = { x: 0.5, y: 0.3 };
    const H = toward(S, 0.3, 90 - 15);
    const at = (th: number) => {
      const E = toward(S, 0.15, 90 - 15 - th);
      return sideBody({ 12: S, 14: E, 16: toward(E, 0.13, 90 - 15 - th), 24: H }, { 24: 0.2 });
    };
    const cal = calibrate("shoulder_flexion", [{ px: at(0) }, { px: at(0) }], base("right"))!;
    expect(cal.gravityMode).toBe(true);
    expect(cal.trunkLine!.top.x).toBeCloseTo(S.x, 12);
    expect(cal.trunkLine!.base.y).toBeCloseTo(H.y, 12);
    for (const th of [0, 45, 90, 160])
      expectAngle(
        MOVEMENT_ANGLES.shoulder_flexion(at(th), { ...base("right"), calibration: cal }),
        th,
        `${th}`,
      );
    // The same frames with the hip seen use the live trunk line (trunk mode).
    const seen = (th: number) => at(th).map((q, i) => (i === 24 ? { ...q, visibility: 0.9 } : q));
    const calSeen = calibrate("shoulder_flexion", [{ px: seen(0) }], base("right"))!;
    expect(calSeen.gravityMode).toBe(false);
    expectAngle(
      MOVEMENT_ANGLES.shoulder_flexion(seen(60), { ...base("right"), calibration: calSeen }),
      60,
      "trunk",
    );
  });

  it("the arm raises use the gravity reference when the hips are seen in under 90% of the start frames (v1 RangeTestRunner)", () => {
    expect(HIPS_SEEN_SHARE).toBe(RANGE_RULES.hipsVisibleShare);
    const c = CASES[1];
    const hidden = (px: Landmark[]) =>
      px.map((q, i) => (i === 23 || i === 24 ? { ...q, visibility: 0.3 } : q));
    const frames = (nSeen: number) =>
      Array.from({ length: 10 }, (_, k) => ({ px: k < nSeen ? c.at(0) : hidden(c.at(0)) }));
    expect(calibrate("shoulder_abduction", frames(9), base("right"))!.gravityMode).toBe(false);
    const g = calibrate("shoulder_abduction", frames(8), base("right"))!;
    expect(g.gravityMode).toBe(true);
    expect(g.fixedHip).toBeNull();
    for (const [truth, want] of c.values)
      expectAngle(
        MOVEMENT_ANGLES.shoulder_abduction(hidden(c.at(truth)), { ...base("right"), calibration: g }),
        want,
        `${truth}`,
      );
    const t = calibrate("shoulder_abduction", frames(10), base("right"))!;
    expect(t.fixedHip!.x).toBeCloseTo(0.5, 12);
    expect(t.fixedHip!.y).toBeCloseTo(0.6, 12);
  });

  it("gravity mode without a start trunk line needs the phone roll", () => {
    const c = CASES[1];
    const nan = (px: Landmark[]) =>
      px.map((q, i) => (i === 23 || i === 24 ? { ...q, x: Number.NaN, y: Number.NaN, visibility: 0 } : q));
    expect(
      calibrate("shoulder_abduction", [{ px: nan(c.at(0)) }], base("right", { rollDeg: null })),
    ).toBeNull();
    const cal = calibrate("shoulder_abduction", [{ px: nan(c.at(0)) }], base("right", { rollDeg: 0 }))!;
    expect(cal.gravityMode).toBe(true);
    expect(cal.trunkLine).toBeNull();
    expectAngle(
      MOVEMENT_ANGLES.shoulder_abduction(nan(c.at(90)), { ...base("right"), calibration: cal }),
      90,
      "roll",
    );
    expect(
      MOVEMENT_ANGLES.shoulder_abduction(nan(c.at(90)), {
        ...base("right", { rollDeg: null }),
        calibration: cal,
      }),
    ).toBeNull();
  });

  it("elbow straightening: past straight is the wrist crossing to the back of the upper arm line", () => {
    const c = CASES.find((k) => k.id === "elbow_extension")!;
    expectAngle(measure(c, c.at(-12), c.at(90), base("right")), -12, "past straight");
    expectAngle(measure(c, c.at(30), c.at(90), base("right")), 30, "short of straight");
  });

  it("hip extension: negative when the thigh stays in front of the trunk line", () => {
    const c = CASES.find((k) => k.id === "hip_extension")!;
    expectAngle(measure(c, c.at(-25), c.at(0), base("right")), -25, "bent hip");
  });

  it("the lunge: phiHeel is the heel to knee line against true vertical", () => {
    const A = { x: 0.5, y: 0.9 };
    const heel = { x: 0.47, y: 0.92 };
    const K = toward(A, 0.2, -90 + 30);
    const px = sideBody({ 26: K, 28: A, 30: heel, 32: { x: 0.58, y: 0.92 } });
    const want = Math.atan2(K.x - heel.x, heel.y - K.y) / RAD;
    const cal = calibrate("ankle_dorsiflexion_lunge", [{ px }], base("right"))!;
    expectAngle(ankleDorsiflexionHeel(px, { ...base("right"), calibration: cal }), want, "phiHeel");
    expect(want).toBeGreaterThan(30);
  });

  it("trunk side bend: toward the named side only, or either way with no side", () => {
    const c = CASES.find((k) => k.id === "trunk_lateral_flexion")!;
    expectAngle(measure(c, c.at(20), c.at(0), base("right")), 0, "the other way");
    expectAngle(measure(c, c.at(-20), c.at(0), base("right")), 20, "toward the right");
    expectAngle(measure(c, c.at(-20), c.at(0), base("none")), 20, "no side");
  });

  it("trunk and neck side views read the camera side: the side whose shoulder, hip and knee are seen best", () => {
    const c = CASES.find((k) => k.id === "trunk_flexion")!;
    expect(cameraSide(c.at(0))).toBe("right");
    // The left side near and the right side far, with the far points off the true line.
    const leftNear = (t: number) =>
      c.at(t).map((q, i, all) => {
        if (i >= 11 && i % 2 === 1) return { ...all[i + 1], visibility: 0.95 };
        if (i >= 11 && i % 2 === 0) return { ...q, x: q.x + 0.1, visibility: 0.3 };
        return q;
      });
    expect(cameraSide(leftNear(0))).toBe("left");
    expectAngle(measure(c, leftNear(45), leftNear(0), base("none")), 45, "left side near");
  });

  it("neck side bend: the eye line when the ears are under 0.5 visibility", () => {
    expect(EAR_LINE_MIN_VISIBILITY).toBe(0.5);
    // Read from the data since the freeze step (A3-4).
    expect(EAR_LINE_MIN_VISIBILITY).toBe(movementDef("neck_lateral_flexion").earLineMinVisibility);
    const c = CASES.find((k) => k.id === "neck_lateral_flexion")!;
    const ears = (px: Landmark[], v: number) =>
      px.map((q, i) => (i === 7 || i === 8 ? { ...q, visibility: v } : q));
    expect(neckSideBendLine(ears(c.at(0), 0.5))).toBe("ears");
    expect(neckSideBendLine(ears(c.at(0), 0.49))).toBe("eyes");
    for (const [truth, want] of c.values)
      expectAngle(
        measure(c, ears(c.at(truth), 0.3), ears(c.at(0), 0.3), base("left")),
        want,
        `eyes ${truth}`,
      );
    expectAngle(measure(c, c.at(-15), c.at(0), base("right")), 15, "toward the right");
    expectAngle(measure(c, c.at(-15), c.at(0), base("none")), 15, "no side");
  });

  describe("neck side bend: each line against its own neutral (D-024, A3-3)", () => {
    // A head whose eye line is not parallel to its ear line at neutral: the eyes 4 degrees off.
    const OFFSET = 4;
    const C = { x: 0.5, y: 0.2 };
    const eyeAt = (x: number) => turn({ x, y: 0.19 }, { x: 0.5, y: 0.19 }, OFFSET);
    const head = (n: number, earVis = 0.95) => {
      const h = (p: Pt) => turn(p, C, n);
      return frontBody(
        {
          0: h({ x: 0.5, y: 0.215 }),
          2: h(eyeAt(0.515)),
          5: h(eyeAt(0.485)),
          7: h({ x: 0.53, y: 0.21 }),
          8: h({ x: 0.47, y: 0.21 }),
        },
        { 7: earVis, 8: earVis },
      );
    };
    const covered = (n: number) => head(n, 0.3);
    const read = (px: Landmark[], cal: AngleContext["calibration"]) =>
      MOVEMENT_ANGLES.neck_lateral_flexion(px, { ...base("left"), calibration: cal });
    const cal = (frames: Landmark[][]) =>
      calibrate(
        "neck_lateral_flexion",
        frames.map((px) => ({ px })),
        base("left"),
      )!;

    it("records the eye line's neutral beside the ear line's", () => {
      const c = cal([head(0), head(0), head(0)]);
      expect(Math.abs(c.neutralEyeLineDeg! - c.neutralHeadDeg!)).toBeCloseTo(OFFSET, 9);
      // The other movements have no eye line.
      expect(
        calibrate("neck_flexion", [{ px: CASES.find((k) => k.id === "neck_flexion")!.at(0) }], base("none"))!
          .neutralEyeLineDeg,
      ).toBeNull();
      expect(
        calibrate("shoulder_flexion", [{ px: CASES[0].at(0) }], base("right"))!.neutralEyeLineDeg,
      ).toBeNull();
    });

    it("reads an eye line frame against the eye line's neutral, an ear line frame against the ear line's", () => {
      const c = cal([head(0), head(0), head(0)]);
      for (const n of [10, 25, 40]) {
        expectAngle(read(covered(n), c), n, `eyes ${n}`);
        expectAngle(read(head(n), c), n, `ears ${n}`);
      }
      // A calibration made before the field existed reads both lines against neutralHeadDeg (A3).
      const { neutralEyeLineDeg: _old, ...before } = c;
      expect(Math.abs(read(covered(25), before)! - 25)).toBeCloseTo(OFFSET, 9);
    });

    it("keeps the ear line's neutral from the start frames that read the ear line", () => {
      // One start frame with the ears seen, two with them covered: the ear neutral is the seen one.
      const c = cal([head(0), covered(0), covered(0)]);
      expectAngle(read(head(30), c), 30, "ears");
      expectAngle(read(covered(30), c), 30, "eyes");
    });

    it("works as before when the ears are covered from the start", () => {
      const c = cal([covered(0), covered(0), covered(0)]);
      expect(c.neutralEyeLineDeg).toBeCloseTo(c.neutralHeadDeg!, 9);
      expectAngle(read(covered(25), c), 25, "eyes");
    });
  });

  it("neck flexion is the head's change less the trunk's: leaning the whole body forward reads 0", () => {
    const c = CASES.find((k) => k.id === "neck_flexion")!;
    const lean = (px: Landmark[], deg: number) =>
      px.map((q, i) =>
        [0, 6, 8, 12, 5, 7, 11].includes(i) ? { ...q, ...turn(q, { x: 0.5, y: 0.65 }, deg) } : q,
      );
    expectAngle(measure(c, lean(c.at(0), 20), c.at(0), base("none")), 0, "lean only");
    expectAngle(measure(c, lean(c.at(25), 20), c.at(0), base("none")), 25, "lean and chin down");
    const cal = calibrate("neck_flexion", [{ px: c.at(0) }], base("none"))!;
    expect(cal.neutralHeadDeg).toBeCloseTo(Math.atan2(0.012, 0.06) / RAD, 9);
    expect(cal.trunkLine).toEqual({ top: { x: 0.5, y: 0.35 }, base: { x: 0.5, y: 0.65 } });
  });

  it("takes the median of head angles across the half turn (177, 180 and -177 give 180, not 177)", () => {
    // Facing the picture's left with a level head line: 180 degrees.
    const ear = { x: 0.5, y: 0.22 };
    const head = (deg: number) =>
      sideBody({
        8: ear,
        6: turn({ x: 0.44, y: 0.22 }, ear, deg),
        0: turn({ x: 0.42, y: 0.24 }, ear, deg),
        12: { x: 0.5, y: 0.35 },
        24: { x: 0.5, y: 0.65 },
      });
    const cal = calibrate(
      "neck_flexion",
      [{ px: head(-3) }, { px: head(0) }, { px: head(3) }],
      base("none"),
    )!;
    expect(Math.abs(Math.abs(cal.neutralHeadDeg!) - 180)).toBeLessThan(1e-9);
  });

  it("calibration keeps the start segment lengths and is null without frames or a head", () => {
    const cal = calibrate("shoulder_flexion", [{ px: CASES[0].at(0) }], base("right"))!;
    expect(cal.segmentPx.upperArm).toBeCloseTo(0.15, 9);
    expect(cal.segmentPx.forearm).toBeCloseTo(0.13, 9);
    expect(cal.segmentPx.trunk).toBeCloseTo(0.3, 9);
    // The far shoulder of a side view is not seen: no shoulder width there.
    expect(cal.segmentPx.shoulderWidth).toBeUndefined();
    expect(cal.fixedHip).toEqual({ x: 0.5, y: 0.6 });
    const front = calibrate("shoulder_abduction", [{ px: CASES[1].at(0) }], base("right"))!;
    expect(front.segmentPx.shoulderWidth).toBeCloseTo(0.16, 9);
    expect(front.segmentPx.trunk).toBeCloseTo(0.3, 9);
    expect(calibrate("shoulder_flexion", [], base("right"))).toBeNull();
    const noHead = frontBody({}, { 2: 0.1, 5: 0.1, 7: 0.1, 8: 0.1 });
    expect(calibrate("neck_lateral_flexion", [{ px: noHead }], base("left"))).toBeNull();
  });
});

describe("shoulder abduction against the v1 RangeTestRunner measurement", () => {
  // v1 (src/engine/modes/rangeTest.ts measure): theta = signedAngle(down, E - S, S - MS) with down the
  // fixed mid hip minus the live mid shoulder (trunk reference), clamped 0 to 180 with past vertical at 180.
  const files = [
    "chair/raise-right-9x16.json",
    "chair/helper-touch-9x16.json",
    "standing/phone-shake-16x9.json",
    "weaker_left/helper-beside-9x16.json",
    "weaker_right/helper-crossing-16x9.json",
    "wheelchair/raise-left-16x9.json",
  ];
  for (const file of files) {
    it(file, () => {
      type Truth = { subjectIndex: number[]; armPeakDeg: { left: number; right: number } };
      const fx = loadFixture<Truth>(join(FIXTURE_ROOT, "shoulder_abduction", file));
      const side = fx.truth.armPeakDeg.left > fx.truth.armPeakDeg.right ? "left" : "right";
      const frames = fx.frames.map((f, k) =>
        toPixelSpace(f.poses[Math.max(fx.truth.subjectIndex[k], 0)], fx.meta.aspect),
      );
      const startFrames = frames.slice(0, Math.round(fx.meta.fps));
      const cal = calibrate(
        "shoulder_abduction",
        startFrames.map((px) => ({ px })),
        base(side),
      )!;
      expect(cal).not.toBeNull();
      const S = side === "left" ? 11 : 12;
      const E = side === "left" ? 13 : 14;
      let compared = 0;
      let peak = 0;
      for (const px of frames) {
        const got = MOVEMENT_ANGLES.shoulder_abduction(px, { ...base(side), calibration: cal });
        if (got === null) continue;
        const ms = { x: (px[11].x + px[12].x) / 2, y: (px[11].y + px[12].y) / 2 };
        const down = cal.gravityMode
          ? downVector(0)
          : { x: cal.fixedHip!.x - ms.x, y: cal.fixedHip!.y - ms.y };
        const th = signedAngle(
          down,
          { x: px[E].x - px[S].x, y: px[E].y - px[S].y },
          { x: px[S].x - ms.x, y: px[S].y - ms.y },
        );
        const v1 = th >= 0 ? th : th < -90 ? 180 : 0;
        // Trunk reference: the same formula. Gravity reference (hips hidden): v7 measures against the start
        // trunk line from the model's hip estimates (review B16), v1 against the picture's vertical.
        expect(Math.abs(got - v1)).toBeLessThan(cal.gravityMode ? 2 : 1e-9);
        compared++;
        peak = Math.max(peak, got);
      }
      expect(compared).toBeGreaterThan(fx.frames.length / 2);
      // A sanity check on the raises (the helper fixtures barely lift the arm): the 2D peak near the generator's.
      if (fx.truth.armPeakDeg[side] >= 30) expect(Math.abs(peak - fx.truth.armPeakDeg[side])).toBeLessThan(8);
    });
  }
});

describe("the clinical definitions are quoted word for word", () => {
  it.skipIf(!process.env.AZM_CLINICAL_V7)(
    "every rom-protocol movements[].angle definition, zero and direction",
    () => {
      const dir = process.env.AZM_CLINICAL_V7!;
      const source = JSON.parse(readFileSync(join(dir, "rom-protocol.json"), "utf8")) as {
        movements: { id: RomMovementId; angle: { definition: string; zero: string; direction: string } }[];
      };
      const text = readFileSync(join(__dirname, "../../src/engine/rom/angles.ts"), "utf8")
        .split("\n")
        .map((l) => l.replace(/^\s*(\/\*\*|\*\/|\*|\/\/)?\s?/, ""))
        .join(" ")
        .replace(/\s+/g, " ");
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();
      for (const m of source.movements)
        for (const field of ["definition", "zero", "direction"] as const)
          expect(text.includes(norm(m.angle[field])), `${m.id} ${field}: ${m.angle[field]}`).toBe(true);
      expect(source.movements.map((m) => m.id).sort()).toEqual([...ROM_MOVEMENT_IDS].sort());
      const neck = source.movements.find((m) => m.id === "neck_lateral_flexion")!;
      expect(neck.angle.definition).toContain(`ear visibility is below ${EAR_LINE_MIN_VISIBILITY}`);
    },
  );
});
