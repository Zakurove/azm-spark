/**
 * Motion capture walks seen by a phone (product v7 contract 8.3, stream C, step C2): the fixtures that
 * scripts/fixtures/mocap_to_fixture.py derives from two open datasets (tests/fixtures/gait/README.md
 * names every source trial), projected through the synthetic walker's own pinhole camera
 * (tests/fixtures/gait/gen-gait.ts cameraOf, project and visibilityOf), so a mocap walk and a
 * synthetic walk are seen by the same phone. Node only (the files are read from disk); the e2e pose
 * source plays the synthetic walks of tests/fixtures/gait/catalog.ts.
 *
 * A fixture holds the room coordinates of 19 landmarks at 30 Hz (x along the walkway or belt, y up,
 * z across, millimetres), the standing calibration from the dataset's static trial, and the
 * dataset's own gait events. A view places the phone:
 *   side       overground side passes in both directions, the phone 3.5 m from the walking line at
 *              1.0 m (the near limb walking to the picture's right is the right one);
 *   front      the same passes from the end of the walkway, 1.0 m past the capture volume and
 *              0.65 m to the side at 0.9 m: passes walking toward the phone face it, the others walk
 *              away (the back view reads those);
 *   pad_side   the treadmill from 3.0 m at 1.0 m, the near side as asked;
 *   pad_front  the treadmill from 2.0 m in front at 1.0 m.
 * Passes follow each other on one clock with the walker out of the picture between them (each
 * dataset trial was its own recording); every frame keeps the camera's 30 Hz times with the
 * dataset jitter; landmark noise and the model's visibility are the walker's (gen-gait).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GaitFrame, GaitView } from "../../../src/engine/gait/types";
import type { Landmark } from "../../../src/engine/types";
import { rng } from "../gen";
import { cameraOf, gauss, project, visibilityOf, type Camera, type Side, type V } from "./gen-gait";

export const MOCAP_DIR = join(dirname(fileURLToPath(import.meta.url)), "mocap");

type Point = V | null;

export interface MocapSubject {
  group: "able_bodied" | "stroke";
  sex: "male" | "female" | null;
  heightCm: number | null;
  legLengthCm: number | null;
  /** Van Criekinge: the decade of birth (the dataset gives no age per walker). */
  birthDecade?: string;
  /** Fukuchi: age in years and the dataset's group. */
  ageYears?: number;
  ageGroup?: "young" | "older";
  /**
   * Stroke survivors: the side the dataset's stroke workbook labels paretic ("P"), each leg's median
   * knee peak in swing in the dataset's own Plug-in Gait angles, and the leg that bends less. The
   * workbook's "P" leg bends more in 40 of its 50 walkers (README), so neither is called paretic here.
   */
  workbookPside?: Side;
  kneeSwingPeakDeg?: Record<Side, number>;
  stifferKneeSide?: Side;
}

export interface MocapEvent {
  side: Side;
  type: "ic" | "to";
  /** ms on the pass's clock */
  t: number;
}

export interface MocapPass {
  file: string;
  /** Walking direction along the room's x (overground), or the facing on the belt. */
  dir: 1 | -1;
  speedMps: number;
  t: number[];
  /** Per frame, the 19 points of `landmarks` in metres (null where missing). */
  p: Point[][];
  events: MocapEvent[];
}

export interface MocapFixture {
  id: string;
  dataset: "van_criekinge_2023" | "fukuchi_2018";
  licence: string;
  citation: string;
  sourceFiles: string[];
  subject: MocapSubject;
  mode: "overground" | "treadmill";
  fps: number;
  landmarks: number[];
  /** Landmarks with no marker behind them (built from other points). */
  synthetic: number[];
  standing: { t: number[]; p: Point[][] };
  passes: MocapPass[];
}

interface FixtureFile {
  format: string;
  encoding: "delta";
  landmarks: number[];
  standing: { t: number[]; p: (number | null)[][] };
  passes: (Omit<MocapPass, "p" | "events"> & {
    p: (number | null)[][];
    events: [Side, "ic" | "to", number][];
  })[];
}

/** Integrates the delta frames of the file into points in metres. */
function decode(rows: (number | null)[][], n: number): Point[][] {
  const last: (number | null)[] = Array.from({ length: 3 * n }, () => null);
  return rows.map((r) => {
    const out: Point[] = [];
    for (let i = 0; i < n; i++) {
      const xyz: number[] = [];
      for (let j = 0; j < 3; j++) {
        const k = 3 * i + j;
        const v = r[k];
        if (v === null || v === undefined) continue;
        last[k] = last[k] === null ? v : (last[k] as number) + v;
        xyz.push((last[k] as number) / 1000);
      }
      out.push(xyz.length === 3 ? [xyz[0], xyz[1], xyz[2]] : null);
    }
    return out;
  });
}

const cache = new Map<string, MocapFixture>();

/** The ids of every committed mocap fixture, sorted. */
export function mocapIds(): string[] {
  return readdirSync(MOCAP_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function loadMocap(id: string): MocapFixture {
  const hit = cache.get(id);
  if (hit) return hit;
  const raw = JSON.parse(readFileSync(join(MOCAP_DIR, `${id}.json`), "utf8")) as FixtureFile &
    Omit<MocapFixture, "standing" | "passes">;
  if (raw.format !== "azm-gait-mocap-1" || raw.encoding !== "delta")
    throw new Error(`${id}: unknown mocap fixture format`);
  const n = raw.landmarks.length;
  const fx: MocapFixture = {
    id: raw.id,
    dataset: raw.dataset,
    licence: raw.licence,
    citation: raw.citation,
    sourceFiles: raw.sourceFiles,
    subject: raw.subject,
    mode: raw.mode,
    fps: raw.fps,
    landmarks: raw.landmarks,
    synthetic: raw.synthetic,
    standing: { t: raw.standing.t, p: decode(raw.standing.p, n) },
    passes: raw.passes.map((ps) => ({
      file: ps.file,
      dir: ps.dir,
      speedMps: ps.speedMps,
      t: ps.t,
      p: decode(ps.p, n),
      events: ps.events.map(([side, type, t]) => ({ side, type, t })),
    })),
  };
  cache.set(id, fx);
  return fx;
}

export interface MocapViewSpec {
  view: GaitView;
  /** pad_side: the side nearest the phone. */
  nearSide?: Side;
  seed?: number;
  /** Landmark noise, sd in units of the picture height (default 0.002). */
  noise?: number;
  camera?: { distance?: number; height?: number; lateral?: number };
  /** Seconds between passes, the walker out of the picture (default 2). */
  gapSec?: number;
  /** First walk frame time, ms (default 10000). */
  startMs?: number;
  /** Every n-th frame is not delivered. */
  dropEvery?: number;
}

export interface MocapTruth {
  /** The dataset's events while the heel is in the picture, on the walk's clock. */
  ics: { side: Side; t: number }[];
  tos: { side: Side; t: number }[];
  /** 60 times the steps over their summed times: consecutive initial contacts of opposite sides in a pass. */
  cadence: number;
  /**
   * The cycles a camera can see whole, per side: two initial contacts of a side with one of the other
   * side's between, in one pass, the first at least EDGE_MS.start after the pass's first frame (the
   * swing before a contact is what makes it a peak) and the last at least EDGE_MS.end before its last.
   */
  cycles: Record<Side, number>;
  passes: { from: number; to: number; dir: 1 | -1; facing: "toward" | "away" | "side" }[];
  heightM: number | null;
  aspect: number;
}

export interface MocapWalk {
  frames: GaitFrame[];
  standing: GaitFrame[];
  truth: MocapTruth;
}

const LANDMARK_FILL: Record<number, number> = {
  1: 2,
  3: 2,
  4: 5,
  6: 5,
  7: 2,
  8: 5,
  9: 0,
  10: 0,
  17: 15,
  19: 15,
  21: 15,
  18: 16,
  20: 16,
  22: 16,
};

/** The view's map from the fixture's room (x walkway, y up, z across) to the camera's room. */
function viewMap(view: GaitView, dir: 1 | -1, near: Side): (p: V) => V {
  switch (view) {
    case "side":
      return (p) => [p[0], p[1], p[2]];
    case "front":
    case "back":
      // The phone at the +x end of the walkway, looking back along it.
      return (p) => [-p[2], p[1], p[0]];
    case "pad_side": {
      // The walker faces +x in the picture with the right side nearest (or −x with the left).
      const k = (near === "right" ? 1 : -1) * dir;
      return (p) => [k * p[0], p[1], k * p[2]];
    }
    case "pad_front":
      return (p) => [-dir * p[2], p[1], dir * p[0]];
  }
}

/** The walker's heading in the camera's room for a pass. */
function headingOf(view: GaitView, dir: 1 | -1, near: Side): V {
  switch (view) {
    case "side":
      return [dir, 0, 0];
    case "front":
    case "back":
      return [0, 0, dir];
    case "pad_side":
      return near === "right" ? [1, 0, 0] : [-1, 0, 0];
    case "pad_front":
      return [0, 0, 1];
  }
}

function cameraFor(fx: MocapFixture, spec: MocapViewSpec): Camera {
  const c = spec.camera ?? {};
  const cam = cameraOf({ view: spec.view });
  if (spec.view === "side") cam.pos = [0, c.height ?? 1.0, c.distance ?? 3.5];
  else if (spec.view === "front" || spec.view === "back") {
    // 1.0 m past the furthest hip position of the walk along the walkway.
    let end = -Infinity;
    for (const ps of fx.passes)
      for (const r of ps.p) {
        const h = r[fx.landmarks.indexOf(23)];
        if (h) end = Math.max(end, h[0]);
      }
    cam.pos = [c.lateral ?? 0.65, c.height ?? 0.9, end + (c.distance ?? 1.0)];
  } else if (spec.view === "pad_side") cam.pos = [0, c.height ?? 1.0, c.distance ?? 3.0];
  else cam.pos = [0, c.height ?? 1.0, c.distance ?? 2.0];
  return cam;
}

/** How far inside its pass a contact must be for its cycle to count as seen whole (MocapTruth.cycles), ms. */
export const EDGE_MS = { start: 500, end: 200 } as const;

const rotateY = (p: V, c: number, s: number): V => [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];

/** Projects a fixture through the phone of a view: the walk, the standing calibration and the truth. */
export function mocapWalk(fx: MocapFixture, spec: MocapViewSpec): MocapWalk {
  const r = rng(spec.seed ?? 1);
  const noise = spec.noise ?? 0.002;
  const startMs = spec.startMs ?? 10000;
  const gapMs = (spec.gapSec ?? 2) * 1000;
  const near: Side = spec.nearSide ?? "right";
  const cam = cameraFor(fx, spec);
  const aspect = cam.w / cam.h;
  const idx = (lm: number) => fx.landmarks.indexOf(lm);
  const frameMs = 1000 / fx.fps;

  const toFrame = (pts: Point[], map: (p: V) => V, heading: V, tMs: number): GaitFrame => {
    const room: V[] = Array.from({ length: 33 }, () => [0, 0, 0] as V);
    const missing = new Set<number>();
    for (let lm = 0; lm < 33; lm++) {
      const src = fx.landmarks.includes(lm) ? lm : LANDMARK_FILL[lm];
      const p = src === undefined ? null : pts[idx(src)];
      if (p) room[lm] = map(p);
      else missing.add(lm);
    }
    const proj = room.map((P) => project(cam, P));
    const vis = visibilityOf(room, heading, cam, proj, r);
    const lm: Landmark[] = proj.map((q, k) => ({
      x: q.x + (gauss(r) * noise) / aspect,
      y: q.y + gauss(r) * noise,
      z: 0,
      visibility: missing.has(k) ? 0 : Math.min(1, Math.max(0, vis[k])),
    }));
    return { t: tMs, lm, aspect };
  };
  const empty = (tMs: number): GaitFrame => ({
    t: tMs,
    lm: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 })),
    aspect,
  });

  const frames: GaitFrame[] = [];
  const truth: MocapTruth = {
    ics: [],
    tos: [],
    cadence: 0,
    cycles: { left: 0, right: 0 },
    passes: [],
    heightM: fx.subject.heightCm ? fx.subject.heightCm / 100 : null,
    aspect,
  };
  let offset = startMs;
  let stepSum = 0;
  let steps = 0;
  let k = 0;
  fx.passes.forEach((ps, pi) => {
    const map = viewMap(spec.view, ps.dir, near);
    const heading = headingOf(spec.view, ps.dir, near);
    if (pi > 0) {
      // The walker is out of the picture between passes; the camera keeps delivering frames.
      for (let t = frameMs; t < gapMs; t += frameMs) frames.push(empty(offset + t));
      offset += gapMs;
    }
    ps.t.forEach((t, i) => {
      k++;
      if (spec.dropEvery && k % spec.dropEvery === 0) return;
      frames.push(toFrame(ps.p[i], map, heading, offset + t));
    });
    const facing = spec.view === "front" || spec.view === "back" ? (ps.dir > 0 ? "toward" : "away") : "side";
    const end = ps.t[ps.t.length - 1];
    truth.passes.push({ from: offset, to: offset + end, dir: ps.dir, facing });
    // Events while the heel is in the picture: the frame nearest the event shows the heel.
    const heelIn = (e: MocapEvent): boolean => {
      let best = 0;
      for (let i = 1; i < ps.t.length; i++)
        if (Math.abs(ps.t[i] - e.t) < Math.abs(ps.t[best] - e.t)) best = i;
      const h = ps.p[best][idx(e.side === "left" ? 29 : 30)];
      if (!h) return false;
      const q = project(cam, map(h));
      return !q.behind && q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1;
    };
    const evs = ps.events.filter(heelIn);
    for (const e of evs) (e.type === "ic" ? truth.ics : truth.tos).push({ side: e.side, t: offset + e.t });
    const ics = evs.filter((e) => e.type === "ic").sort((a, b) => a.t - b.t);
    for (let i = 1; i < ics.length; i++)
      if (ics[i].side !== ics[i - 1].side) {
        stepSum += ics[i].t - ics[i - 1].t;
        steps++;
      }
    const inside = (e: MocapEvent) => e.t >= ps.t[0] + EDGE_MS.start && e.t <= end - EDGE_MS.end;
    for (const side of ["left", "right"] as const) {
      const own = ics.filter((e) => e.side === side);
      for (let i = 1; i < own.length; i++)
        if (
          inside(own[i - 1]) &&
          inside(own[i]) &&
          ics.some((e) => e.side !== side && e.t > own[i - 1].t && e.t < own[i].t)
        )
          truth.cycles[side]++;
    }
    offset += end;
  });
  truth.ics.sort((a, b) => a.t - b.t);
  truth.tos.sort((a, b) => a.t - b.t);
  truth.cadence = steps ? (60000 * steps) / stepSum : 0;

  // Standing: the static trial, turned to face the way the view's calibration asks (the first pass's
  // direction on a side view, the phone on a front view, the belt's direction on the pad) and moved
  // to the view's standing place (the walking line in front of a side phone, 3 m from a front one).
  const first = fx.passes[0];
  const map0 = viewMap(spec.view, first.dir, near);
  const heading0 = headingOf(spec.view, first.dir, near);
  const want = spec.view === "front" || spec.view === "back" ? ([0, 0, 1] as V) : (heading0 as V);
  const st0 = fx.standing.p[0];
  const lh = st0[idx(23)];
  const rh = st0[idx(24)];
  const standing: GaitFrame[] = [];
  if (lh && rh) {
    // Facing in the fixture's room: forward = left × up (gen-gait: left = up × forward).
    const left: V = [lh[0] - rh[0], 0, lh[2] - rh[2]];
    const fwd: V = [-left[2], 0, left[0]];
    const a0 = Math.atan2(fwd[0], fwd[2]);
    const a1 = Math.atan2(want[0], want[2]);
    const c = Math.cos(a1 - a0);
    const s = Math.sin(a1 - a0);
    const mid: V = [(lh[0] + rh[0]) / 2, 0, (lh[2] + rh[2]) / 2];
    const place: V =
      spec.view === "front" || spec.view === "back"
        ? [0, 0, cam.pos[2] - 3]
        : spec.view === "side"
          ? [0, 0, 0]
          : (() => {
              // On the pad, where the walk's hips are.
              const h = first.p[0][idx(23)];
              const h2 = first.p[0][idx(24)];
              return h && h2 ? map0([(h[0] + h2[0]) / 2, 0, (h[2] + h2[2]) / 2]) : ([0, 0, 0] as V);
            })();
    const stMap = (p: V): V => {
      const q = rotateY([p[0] - mid[0], p[1], p[2] - mid[2]], c, s);
      return [q[0] + place[0], q[1], q[2] + place[2]];
    };
    const t0 = startMs - (3 + 2) * 1000;
    fx.standing.t.forEach((t, i) => standing.push(toFrame(fx.standing.p[i], stMap, want, t0 + t)));
  }
  return { frames, standing, truth };
}
