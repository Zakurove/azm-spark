/**
 * Pre-processing of one gait view (product v7 contract 2.8; gait-rules 3.2), in this order:
 *
 *   1. Pixel space (D-003): x times the picture's aspect, so both axes are in units of the picture
 *      height; then turned by the phone roll when it is known, so y points along true down.
 *   2. Visibility: a landmark under 0.5 in a frame is missing.
 *   3. Timestamps and gaps: every landmark is resampled from the real frame times onto one uniform
 *      30 Hz grid by linear interpolation; a gap up to 0.12 s is filled and a longer one is left
 *      missing, which splits the bout. (src/engine/signal/resample.ts starts its grid at a series'
 *      first valid sample, so the landmarks would land on different grids; this file applies the
 *      same rule on one grid from the frame times.)
 *   4. Labels: side views exchange the leg labels where both legs jump onto each other's path
 *      (swaps; the pad side view only where the near leg's own track jumps, D-027 item 4); front and
 *      back views exchange every left and right label where they contradict the facing (facing
 *      check). Done before filtering, so no filter smooths across a label jump.
 *   5. Outliers: Hampel, window 7, n sigma 2.
 *   6. Smoothing: zero lag Butterworth low pass at 5 Hz (2nd order design run by filtfilt), on each
 *      run of finite samples; a run too short for filtfilt is dropped (it cannot hold a stride).
 *   7. Bouts: the runs where both hips and both ankles are finite (side views: both hips and either
 *      ankle, D-026 item 6's near limb rule).
 *
 * Azm code, built from the clinical rules (no upstream code). Pure, no DOM.
 */
import { filtfilt, filtfiltPadlen, lowpassSos } from "../signal/butterworth";
import { hampel } from "../signal/hampel";
import { effectiveAspect } from "../geometry";
import { GAIT_ENGINE, PAD_SWAP, REPLAY_LANDMARK_IDS } from "./params";
import type { GaitFrame } from "./types";
import { lowerBound } from "./util";

/** The landmarks the engine reads (the replay set: nose, arms and legs). */
export const USED_LANDMARKS: readonly number[] = REPLAY_LANDMARK_IDS;
/** Left and right pairs of the used landmarks (shoulders, elbows, wrists, hips, knees, ankles, heels, foot index). */
export const LR_PAIRS: readonly [number, number][] = [
  [11, 12],
  [13, 14],
  [15, 16],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];
/** The leg chain of each side: hip, knee, ankle, heel, foot index. */
export const LEG = {
  left: { hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31, shoulder: 11, wrist: 15 },
  right: { hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32, shoulder: 12, wrist: 16 },
} as const;
const LEG_PAIRS: readonly [number, number][] = [
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];
/** The points whose continuity decides a leg swap: knee, ankle, heel and foot index. */
const SWAP_POINTS: readonly [number, number][] = [
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];
/** Face landmarks for the facing check: nose and both eyes. */
const FACE = [0, 2, 5] as const;

export interface Series {
  /** Grid times in seconds (frame time ÷ 1000). */
  t: Float64Array;
  n: number;
  hz: number;
  /** By landmark id (used landmarks only): pixel space x and y, NaN where missing. */
  x: Float64Array[];
  y: Float64Array[];
  /** Grid samples whose labels were exchanged by the swap or facing rules. */
  relabelled: Uint8Array;
  /** Half open grid ranges where both hips and both ankles (side views: either ankle) are finite. */
  bouts: [number, number][];
}

export interface Prepared {
  series: Series;
  /** The frames, in time order with increasing times. */
  frames: GaitFrame[];
  /** Their times in milliseconds. */
  frameMs: Float64Array;
  /** The picture's aspect (videoWidth ÷ videoHeight). */
  aspect: number;
  /** Per frame: a face landmark (nose or an eye) at the visibility floor. */
  faceSeen: Uint8Array;
}

export interface PrepareOptions {
  /** True vertical: the phone roll in degrees (FeedEnv.rollDeg), or null for the picture's vertical. */
  rollDeg: number | null;
  /** Which label rule runs: the leg swap rule (side views) or the facing check (front and back views). */
  labels: "swaps" | "facing" | "none";
  /**
   * What a bout needs besides both hips: both ankles (front and back views, the default), or either
   * ankle (side views, D-026 item 6's near limb rule: the far ankle hides behind the near shank for a
   * part of each stride, and the near one stands for the walk then).
   */
  bouts?: "both_ankles" | "either_ankle";
  /**
   * Pad side views: the limb nearest the phone. The swap rule then exchanges the legs only where the
   * near leg's own track jumps (swapNearLeg, D-027 item 4).
   */
  nearSide?: "left" | "right";
}

/** The frames in time order, keeping only those whose time is finite and moves forward. */
export function orderedFrames(frames: readonly GaitFrame[]): GaitFrame[] {
  const out: GaitFrame[] = [];
  for (const f of frames) {
    if (!f || !Number.isFinite(f.t) || !Array.isArray(f.lm)) continue;
    if (out.length && f.t <= out[out.length - 1].t) continue;
    out.push(f);
  }
  return out;
}

/** Turns pixel space coordinates so y points along true down (downVector(roll) maps to (0, 1)). */
export function rollTurn(rollDeg: number | null): (x: number, y: number) => [number, number] {
  if (rollDeg === null || !Number.isFinite(rollDeg) || rollDeg === 0) return (x, y) => [x, y];
  const r = (rollDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return (x, y) => [x * c + y * s, -x * s + y * c];
}

/** A landmark of a frame in pixel space (turned), or null when missing or under the visibility floor. */
export function pointOf(
  f: GaitFrame,
  id: number,
  turn: (x: number, y: number) => [number, number],
  minVis: number = GAIT_ENGINE.visibilityMin,
): [number, number] | null {
  const q = f.lm[id];
  if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y) || !((q.visibility ?? 0) >= minVis)) return null;
  return turn(q.x * effectiveAspect(f.aspect), q.y);
}

/** Whether a frame shows a face landmark at the visibility floor (the facing check's "face visible"). */
export function faceVisible(f: GaitFrame): boolean {
  return FACE.some((id) => {
    const q = f.lm[id];
    return !!q && Number.isFinite(q.x) && (q.visibility ?? 0) >= GAIT_ENGINE.visibilityMin;
  });
}

/**
 * Values of one landmark coordinate on the grid: a grid time between two valid samples at most
 * maxGap apart takes the straight line between them (the samples themselves exactly); anything else
 * is NaN.
 */
function onGrid(ts: number[], vs: number[], grid: Float64Array, maxGap: number): Float64Array {
  const out = new Float64Array(grid.length).fill(Number.NaN);
  if (!ts.length) return out;
  const eps = 1e-9;
  let j = 0;
  for (let k = 0; k < grid.length; k++) {
    const tau = grid[k];
    while (j + 1 < ts.length && ts[j + 1] <= tau + eps) j++;
    if (Math.abs(tau - ts[j]) <= eps) out[k] = vs[j];
    else if (ts[j] < tau && j + 1 < ts.length) {
      const span = ts[j + 1] - ts[j];
      if (span <= maxGap + eps) out[k] = vs[j] + ((tau - ts[j]) / span) * (vs[j + 1] - vs[j]);
    }
  }
  return out;
}

/** Half open runs [start, end) of indices where `ok` holds. */
export function runs(n: number, ok: (k: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let k = 0; k <= n; k++) {
    const good = k < n && ok(k);
    if (good && start < 0) start = k;
    if (!good && start >= 0) {
      out.push([start, k]);
      start = -1;
    }
  }
  return out;
}

function exchange(s: Pick<Series, "x" | "y">, pairs: readonly [number, number][], k: number): void {
  for (const [a, b] of pairs) {
    const xa = s.x[a][k];
    const ya = s.y[a][k];
    s.x[a][k] = s.x[b][k];
    s.y[a][k] = s.y[b][k];
    s.x[b][k] = xa;
    s.y[b][k] = ya;
  }
}

/**
 * The leg swap rule of side views (gait-rules preprocessing "swaps"): each leg is a track (knee,
 * ankle, heel and foot index) predicted from its last two samples at constant velocity. When both
 * legs' points sit nearer the other track's prediction than their own (each ankle trajectory has
 * jumped onto the other's path), the leg labels of that sample are exchanged. Threshold free: a
 * crossing of the legs, where the points are near both predictions, never exchanges.
 */
function swapLegs(s: Series, relabelled: Uint8Array): void {
  const finiteAt = (k: number) =>
    k >= 0 &&
    k < s.n &&
    SWAP_POINTS.every(([a, b]) => Number.isFinite(s.x[a][k] + s.y[a][k] + s.x[b][k] + s.y[b][k]));
  const predict = (id: number, k: number): [number, number] => {
    const x1 = s.x[id][k - 1];
    const y1 = s.y[id][k - 1];
    if (!finiteAt(k - 2)) return [x1, y1];
    return [2 * x1 - s.x[id][k - 2], 2 * y1 - s.y[id][k - 2]];
  };
  const cost = (side: 0 | 1, track: 0 | 1, k: number): number => {
    let c = 0;
    for (const pair of SWAP_POINTS) {
      const [px, py] = predict(pair[track], k);
      c += Math.hypot(s.x[pair[side]][k] - px, s.y[pair[side]][k] - py);
    }
    return c;
  };
  for (let k = 1; k < s.n; k++) {
    if (!finiteAt(k) || !finiteAt(k - 1)) continue;
    const leftJumped = cost(0, 1, k) < cost(0, 0, k);
    const rightJumped = cost(1, 0, k) < cost(1, 1, k);
    if (leftJumped && rightJumped) {
      exchange(s, LEG_PAIRS, k);
      relabelled[k] = 1;
    }
  }
}

/**
 * The facing check of front and back views (gait-rules preprocessing "facing"): facing the phone
 * (a face landmark visible) the person's right hip is on the picture's left; facing away, on its
 * right. A sample whose hips contradict the facing has every left and right label exchanged.
 */
function facingCheck(s: Series, facing: Uint8Array, relabelled: Uint8Array): void {
  for (let k = 0; k < s.n; k++) {
    // The hips decide; without them, the shoulders.
    const hips = Number.isFinite(s.x[23][k]) && Number.isFinite(s.x[24][k]);
    const lx = hips ? s.x[23][k] : s.x[11][k];
    const rx = hips ? s.x[24][k] : s.x[12][k];
    if (!Number.isFinite(lx) || !Number.isFinite(rx) || lx === rx) continue;
    const rightOnLeft = rx < lx;
    if (rightOnLeft !== (facing[k] === 1)) {
      exchange(s, LR_PAIRS, k);
      relabelled[k] = 1;
    }
  }
}

/** The median heel to foot index distance of both feet over the series (pixel space), 0 when never seen. */
export function footLength(s: Pick<Series, "x" | "y" | "n">): number {
  const xs: number[] = [];
  for (const side of ["left", "right"] as const) {
    const l = LEG[side];
    for (let k = 0; k < s.n; k++) {
      const v = Math.hypot(s.x[l.heel][k] - s.x[l.toe][k], s.y[l.heel][k] - s.y[l.toe][k]);
      if (Number.isFinite(v)) xs.push(v);
    }
  }
  xs.sort((a, b) => a - b);
  return xs.length ? xs[xs.length >> 1] : 0;
}

/**
 * The swap rule of the pad side view (D-027 item 4, C2's GG-4 proposal (b)). On the pad the model
 * often lays the hidden far leg on the near one, and the both legs rule (swapLegs) then carries the far
 * track into the near one. Here the near leg leads: each sample keeps the model's labels or exchanges
 * them, chosen for the whole run of samples where the near leg's points (knee, ankle, heel, foot index)
 * are seen (a Viterbi over the two labellings, its state the last two samples' choices):
 *   - the labels may change only at a sample where the near leg's own track, as the model labels it,
 *     jumps more than half a foot length (PAD_SWAP.jumpFootShare) from its constant velocity
 *     prediction from the two samples before;
 *   - a sample costs the near track's distance from its prediction beyond half a foot length, under
 *     the chosen labels, and an exchanged sample a quarter of a foot length more
 *     (PAD_SWAP.exchangeCostFootShare): the model's labels stand unless the near track says otherwise.
 * The foot length is the median heel to foot index distance of both feet over the walk.
 */
function swapNearLeg(s: Series, relabelled: Uint8Array, near: "left" | "right"): void {
  const ni = near === "left" ? 0 : 1;
  const fi = 1 - ni;
  const foot = footLength(s);
  if (!(foot > 0)) return;
  const margin = PAD_SWAP.jumpFootShare * foot;
  const exchangeCost = PAD_SWAP.exchangeCostFootShare * foot;
  const seen = (k: number, side: number) =>
    k >= 0 &&
    k < s.n &&
    SWAP_POINTS.every((pair) => Number.isFinite(s.x[pair[side]][k] + s.y[pair[side]][k]));
  /** The near points as labelling `a` gives them at k (0: the model's labels, 1: exchanged). */
  const X = (k: number, a: number, i: number) => s.x[SWAP_POINTS[i][a ? fi : ni]][k];
  const Y = (k: number, a: number, i: number) => s.y[SWAP_POINTS[i][a ? fi : ni]][k];
  /**
   * The mean distance of the near points under `a` at k from their prediction by the labellings `b`
   * at k - 1 and `c` at k - 2 (constant velocity; constant position when c is -1).
   */
  const err = (k: number, a: number, b: number, c: number) => {
    let sum = 0;
    for (let i = 0; i < SWAP_POINTS.length; i++) {
      let px = X(k - 1, b, i);
      let py = Y(k - 1, b, i);
      if (c >= 0) {
        px = 2 * px - X(k - 2, c, i);
        py = 2 * py - Y(k - 2, c, i);
      }
      sum += Math.hypot(X(k, a, i) - px, Y(k, a, i) - py);
    }
    return sum / SWAP_POINTS.length;
  };
  for (const [start, end] of runs(s.n, (k) => seen(k, ni))) {
    const n = end - start;
    if (n < 2) continue;
    // Where the labels may change: the near track as the model labels it jumps.
    const jump = new Uint8Array(n);
    for (let j = 1; j < n; j++) jump[j] = err(start + j, 0, 0, j >= 2 ? 0 : -1) > margin ? 1 : 0;
    // cost[j][state], state = choice at j - 1 * 2 + choice at j; the run starts with the model's labels.
    const cost: Float64Array[] = [Float64Array.of(0, Infinity, Infinity, Infinity)];
    const from: Int8Array[] = [Int8Array.of(-1, -1, -1, -1)];
    for (let j = 1; j < n; j++) {
      const k = start + j;
      const c = new Float64Array(4).fill(Infinity);
      const b = new Int8Array(4).fill(-1);
      const farSeen = seen(k, fi);
      for (let prev = 0; prev < 4; prev++) {
        const pc = cost[j - 1][prev];
        if (pc === Infinity) continue;
        const before = prev >> 1;
        const last = prev & 1;
        for (let a = 0; a < 2; a++) {
          if (a === 1 && !farSeen) continue;
          if (a !== last && !jump[j]) continue;
          const e = err(k, a, last, j >= 2 ? before : -1);
          const v = pc + Math.max(0, e - margin) + a * exchangeCost;
          const state = last * 2 + a;
          if (v < c[state]) {
            c[state] = v;
            b[state] = prev;
          }
        }
      }
      cost.push(c);
      from.push(b);
    }
    let state = 0;
    for (let i = 1; i < 4; i++) if (cost[n - 1][i] < cost[n - 1][state]) state = i;
    for (let j = n - 1; j >= 0; j--) {
      if (state & 1) {
        exchange(s, LEG_PAIRS, start + j);
        relabelled[start + j] = 1;
      }
      state = j > 0 ? from[j][state] : 0;
    }
  }
}

/** Hampel then the zero lag Butterworth on every run of finite samples; a run too short is dropped. */
export function smooth(xs: Float64Array, sos: number[][], padlen: number): Float64Array {
  const h = hampel(xs, GAIT_ENGINE.hampel.window, GAIT_ENGINE.hampel.nSigma);
  const out = new Float64Array(h.length).fill(Number.NaN);
  for (const [a, b] of runs(h.length, (k) => Number.isFinite(h[k]))) {
    if (b - a <= padlen) continue;
    out.set(filtfilt(h.subarray(a, b), sos), a);
  }
  return out;
}

/** The nearest frame of a grid time, by time (frameMs ascending). */
export function nearestFrame(frameMs: Float64Array, tMs: number): number {
  const i = lowerBound(frameMs, tMs);
  if (i <= 0) return 0;
  if (i >= frameMs.length) return frameMs.length - 1;
  return tMs - frameMs[i - 1] <= frameMs[i] - tMs ? i - 1 : i;
}

/** Pre-processing of one view's frames (steps 1 to 7 above). */
export function prepare(input: readonly GaitFrame[], opts: PrepareOptions): Prepared {
  const frames = orderedFrames(input);
  const hz = GAIT_ENGINE.hz;
  const frameMs = Float64Array.from(frames, (f) => f.t);
  const aspect = effectiveAspect(frames.find((f) => Number.isFinite(f.aspect))?.aspect);
  const faceSeen = Uint8Array.from(frames, (f) => (faceVisible(f) ? 1 : 0));
  const empty: Series = {
    t: new Float64Array(0),
    n: 0,
    hz,
    x: [],
    y: [],
    relabelled: new Uint8Array(0),
    bouts: [],
  };
  if (frames.length < 2) return { series: empty, frames, frameMs, aspect, faceSeen };

  const t0 = frames[0].t / 1000;
  const n = Math.floor((frames[frames.length - 1].t / 1000 - t0) * hz + 1e-9) + 1;
  const t = new Float64Array(n);
  for (let k = 0; k < n; k++) t[k] = t0 + k / hz;

  const turn = rollTurn(opts.rollDeg);
  const x: Float64Array[] = [];
  const y: Float64Array[] = [];
  for (const id of USED_LANDMARKS) {
    const ts: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    for (const f of frames) {
      const p = pointOf(f, id, turn);
      if (!p) continue;
      ts.push(f.t / 1000);
      xs.push(p[0]);
      ys.push(p[1]);
    }
    x[id] = onGrid(ts, xs, t, GAIT_ENGINE.maxGapSec);
    y[id] = onGrid(ts, ys, t, GAIT_ENGINE.maxGapSec);
  }
  const series: Series = { t, n, hz, x, y, relabelled: new Uint8Array(n), bouts: [] };

  if (opts.labels === "swaps") {
    if (opts.nearSide) swapNearLeg(series, series.relabelled, opts.nearSide);
    else swapLegs(series, series.relabelled);
  }
  if (opts.labels === "facing") {
    const facing = new Uint8Array(n);
    for (let k = 0; k < n; k++) facing[k] = faceSeen[nearestFrame(frameMs, t[k] * 1000)];
    facingCheck(series, facing, series.relabelled);
  }

  // The 4th order zero lag filter of the rule is the 2nd order design run forward and back.
  const { cutoffHz, filtfiltOrder } = GAIT_ENGINE.butterworth;
  const sos = lowpassSos(filtfiltOrder, cutoffHz, hz);
  const padlen = filtfiltPadlen(sos);
  for (const id of USED_LANDMARKS) {
    x[id] = smooth(x[id], sos, padlen);
    y[id] = smooth(y[id], sos, padlen);
  }
  const on = (id: number, k: number) => Number.isFinite(x[id][k]) && Number.isFinite(y[id][k]);
  series.bouts = runs(n, (k) =>
    opts.bouts === "either_ankle"
      ? on(23, k) && on(24, k) && (on(27, k) || on(28, k))
      : [23, 24, 27, 28].every((id) => on(id, k)),
  );
  return { series, frames, frameMs, aspect, faceSeen };
}

/**
 * Share of a time range's frames in which every listed landmark is at the visibility floor (the
 * cycle gate's «visibility >= 0.5 in >= 90% of frames», checked landmark by landmark: the smallest
 * share of the list). 1 for a range with no frame.
 */
export function visibleShare(
  p: Pick<Prepared, "frames" | "frameMs">,
  ids: readonly number[],
  fromMs: number,
  toMs: number,
  minVis: number = GAIT_ENGINE.gateVisibility,
): number {
  const a = lowerBound(p.frameMs, fromMs);
  const b = lowerBound(p.frameMs, toMs + 1e-6);
  const total = b - a;
  if (total <= 0) return 1;
  let worst = 1;
  for (const id of ids) {
    let seen = 0;
    for (let i = a; i < b; i++) {
      const q = p.frames[i].lm[id];
      if (q && Number.isFinite(q.x) && Number.isFinite(q.y) && (q.visibility ?? 0) >= minVis) seen++;
    }
    worst = Math.min(worst, seen / total);
  }
  return worst;
}
