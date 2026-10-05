/**
 * Passes, walking direction, turns and the analysed window of a gait view (gait-rules 3.1, 3.2
 * "facing" and "turns and steady state", and capture.overground.front). Pure, no DOM.
 *
 *   - Walking direction d (side views): overground, the sign of the mid hip's x motion over the
 *     pass; on the pad, the sign of the mean x of foot index minus heel (the foot points forward).
 *   - Overground side passes are the runs of one direction; overground front and back passes are the
 *     runs of one facing (a face landmark visible: toward the phone). A run shorter than the turn
 *     margin is part of its neighbour.
 *   - Turns: a change of direction or facing, or a sample whose sideways motion is larger than its
 *     forward motion, each with the 1 s margins of the rule on both sides. Motion is measured over
 *     the margin (half before, half after the sample) and compared in metres with the camera model
 *     of the distance proxy (src/engine/quality.ts CAMERA_MODEL): a depth change of the body's size
 *     s against a picture motion x, |x'| against f·|s'| / s, f the focal length in picture heights.
 *   - Overground front and back: only samples 1.5 to 4 m from the phone are analysed
 *     (estimateDistanceM, the existing distance proxy).
 */
import { VIEW_RATIO } from "../body";
import { CAMERA_MODEL, estimateDistanceM } from "../quality";
import { GAIT_ENGINE } from "./params";
import { LEG, nearestFrame, runs, type Prepared, type Series } from "./preprocess";
import { midX, trunkLengthAt } from "./kinematics";
import type { GaitView } from "./types";
import type { LimbSide } from "./util";

export interface Pass {
  /** Half open grid range. */
  start: number;
  end: number;
  /** Walking direction in the picture (side views); +1 for front views. */
  d: 1 | -1;
  facing: "toward" | "away" | "side";
  /** Side views: the limb nearest the phone. */
  near: LimbSide | null;
  /** The pass starts or ends at a turn inside the bout (a change of direction or facing). */
  turnAtStart: boolean;
  turnAtEnd: boolean;
}

/** Why a grid sample is not analysed. */
export const EXCLUDED = { turn: 1, window: 2 } as const;

export interface Motion {
  passes: Pass[];
  /** Per grid sample: 0 analysed, EXCLUDED.turn or EXCLUDED.window. */
  excluded: Uint8Array;
  /** The share of the bouts' samples whose body view (shoulder width ÷ trunk length) is the other kind. */
  wrongViewShare: number;
}

/** The camera model's focal length in units of the picture height (the short side spans the model's field of view). */
export function focalLength(aspect: number): number {
  const shortSide = aspect < 1 ? aspect : 1;
  return shortSide / 2 / Math.tan(((CAMERA_MODEL.shortSideFovDeg / 2) * Math.PI) / 180);
}

const isOverground = (v: GaitView) => v === "side" || v === "front" || v === "back";
const isSide = (v: GaitView) => v === "side" || v === "pad_side";

/** Mid hip x velocity and the body size's rate of depth change, over the turn margin around each sample. */
function motionAt(s: Series, aspect: number) {
  const h = Math.max(1, Math.round((GAIT_ENGINE.turnMarginSec / 2) * s.hz));
  const dt = (2 * h) / s.hz;
  const f = focalLength(aspect);
  const vx = new Float64Array(s.n).fill(Number.NaN);
  const depth = new Float64Array(s.n).fill(Number.NaN);
  for (let k = h; k + h < s.n; k++) {
    vx[k] = (midX(s, 23, 24, k + h) - midX(s, 23, 24, k - h)) / dt;
    const size = trunkLengthAt(s, k);
    const ds = (trunkLengthAt(s, k + h) - trunkLengthAt(s, k - h)) / dt;
    if (size > 0) depth[k] = (f * Math.abs(ds)) / size;
  }
  return { vx, depth };
}

/** Marks every sample within the turn margin of `k` (both sides) inside [a, b). */
function markAround(excluded: Uint8Array, k: number, margin: number, a: number, b: number) {
  for (let i = Math.max(a, k - margin); i < Math.min(b, k + margin + 1); i++)
    if (excluded[i] === 0) excluded[i] = EXCLUDED.turn;
}

/** Runs of a label inside [a, b), a run shorter than `minLen` merged into the run before it (or after it). */
function labelRuns<T>(labels: (T | null)[], a: number, b: number, minLen: number): [number, number, T][] {
  const out: [number, number, T][] = [];
  let last: T | null = null;
  for (let k = a; k < b; k++) {
    const l: T | null = labels[k] ?? last;
    if (l === null) continue;
    last = l;
    const cur = out[out.length - 1];
    if (cur && cur[2] === l && cur[1] === k) cur[1] = k + 1;
    else out.push([k, k + 1, l]);
  }
  // A label seen before the first known one belongs to that run.
  if (out.length) out[0][0] = a;
  let merged = true;
  while (merged && out.length > 1) {
    merged = false;
    for (let i = 0; i < out.length; i++) {
      if (out[i][1] - out[i][0] >= minLen) continue;
      const j = i > 0 ? i - 1 : i + 1;
      out[j][0] = Math.min(out[j][0], out[i][0]);
      out[j][1] = Math.max(out[j][1], out[i][1]);
      out.splice(i, 1);
      merged = true;
      break;
    }
    for (let i = out.length - 1; i > 0; i--)
      if (out[i][2] === out[i - 1][2]) {
        out[i - 1][1] = out[i][1];
        out.splice(i, 1);
      }
  }
  if (out.length) out[out.length - 1][1] = b;
  return out;
}

/** The share of a range's samples whose body view is side on (or square on, for a side view). */
function wrongViewSamples(s: Series, view: GaitView, a: number, b: number): [number, number] {
  let wrong = 0;
  let seen = 0;
  for (let k = a; k < b; k++) {
    const size = trunkLengthAt(s, k);
    const width = Math.hypot(s.x[11][k] - s.x[12][k], s.y[11][k] - s.y[12][k]);
    if (!(size > 0) || !Number.isFinite(width)) continue;
    const r = width / size;
    seen++;
    if (isSide(view) ? r >= VIEW_RATIO.frontMin : r <= VIEW_RATIO.sideMax) wrong++;
  }
  return [wrong, seen];
}

/** Passes, exclusions and the view check of one prepared view. */
export function passesOf(p: Prepared, view: GaitView, nearSide: LimbSide | undefined): Motion {
  const s = p.series;
  const excluded = new Uint8Array(s.n);
  const passes: Pass[] = [];
  const margin = Math.round(GAIT_ENGINE.turnMarginSec * s.hz);
  let wrong = 0;
  let seen = 0;
  for (const [a, b] of s.bouts) {
    const [w, n] = wrongViewSamples(s, view, a, b);
    wrong += w;
    seen += n;
  }

  if (!isOverground(view)) {
    for (const [a, b] of s.bouts) {
      if (view === "pad_front") {
        passes.push({
          start: a,
          end: b,
          d: 1,
          facing: "toward",
          near: null,
          turnAtStart: false,
          turnAtEnd: false,
        });
        continue;
      }
      // Pad side: the foot points forward, so foot index minus heel gives the direction.
      let sum = 0;
      for (let k = a; k < b; k++)
        for (const side of ["left", "right"] as const) {
          const v = s.x[LEG[side].toe][k] - s.x[LEG[side].heel][k];
          if (Number.isFinite(v)) sum += v;
        }
      const d: 1 | -1 = sum > 0 ? 1 : sum < 0 ? -1 : nearSide === "left" ? -1 : 1;
      passes.push({
        start: a,
        end: b,
        d,
        facing: "side",
        near: nearSide ?? (d > 0 ? "right" : "left"),
        turnAtStart: false,
        turnAtEnd: false,
      });
    }
    return { passes, excluded, wrongViewShare: seen ? wrong / seen : 0 };
  }

  const { vx, depth } = motionAt(s, p.aspect);
  for (const [a, b] of s.bouts) {
    if (view === "side") {
      const dir: (1 | -1 | null)[] = [];
      for (let k = 0; k < s.n; k++) dir[k] = vx[k] > 0 ? 1 : vx[k] < 0 ? -1 : null;
      const parts = labelRuns(dir, a, b, margin);
      parts.forEach(([pa, pb, d], i) => {
        if (i > 0) markAround(excluded, pa, margin, a, b);
        passes.push({
          start: pa,
          end: pb,
          d,
          facing: "side",
          near: d > 0 ? "right" : "left",
          turnAtStart: i > 0,
          turnAtEnd: i < parts.length - 1,
        });
      });
      for (let k = a; k < b; k++) if (depth[k] > Math.abs(vx[k])) markAround(excluded, k, margin, a, b);
      continue;
    }
    // Front and back views: passes by facing, analysed 1.5 to 4 m from the phone.
    const facing: ("toward" | "away" | null)[] = [];
    for (let k = 0; k < s.n; k++)
      facing[k] = p.faceSeen[nearestFrame(p.frameMs, s.t[k] * 1000)] ? "toward" : "away";
    const parts = labelRuns(facing, a, b, margin);
    parts.forEach(([pa, pb, f], i) => {
      if (i > 0) markAround(excluded, pa, margin, a, b);
      if ((view === "front") === (f === "toward"))
        passes.push({
          start: pa,
          end: pb,
          d: 1,
          facing: f,
          near: null,
          turnAtStart: i > 0,
          turnAtEnd: i < parts.length - 1,
        });
    });
    for (let k = a; k < b; k++) if (Math.abs(vx[k]) > depth[k]) markAround(excluded, k, margin, a, b);
    const [near, far] = GAIT_ENGINE.frontWindowM;
    for (let k = a; k < b; k++) {
      const size = trunkLengthAt(s, k);
      const m = size > 0 ? estimateDistanceM(size, p.aspect) : Number.NaN;
      if (!(m >= near && m <= far) && excluded[k] === 0) excluded[k] = EXCLUDED.window;
    }
  }
  return { passes, excluded, wrongViewShare: seen ? wrong / seen : 0 };
}

/** The grid runs of a pass that are analysed (not excluded). */
export function analysedRuns(pass: Pass, excluded: Uint8Array): [number, number][] {
  return runs(pass.end - pass.start, (i) => excluded[pass.start + i] === 0).map(
    ([a, b]) => [a + pass.start, b + pass.start] as [number, number],
  );
}
