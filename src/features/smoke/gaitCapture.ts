/**
 * The smoke page's gait capture (product v7 contract 8.4 and 2.8, stream G, step G1).
 *
 *   GaitCapture     the subject's frames (SubjectLock, as the check picks its person) of the video's
 *                   standing window and walk window, timed from the first frame the page received,
 *                   as the gait engine takes them (GaitFrame: real timestamps, normalised landmarks,
 *                   the picture's aspect).
 *   harnessCadence  the harness's own check that the model tracks the legs: the period of the gap
 *                   between the ankles (front to back in a side view, up and down in a front view;
 *                   positions at any visibility), found by autocorrelation over strides of 0.6 to
 *                   2.5 s (48 to 200 steps a minute). It is not the gait engine's cadence (C's
 *                   analyseGaitView is), and nothing in the app reads it.
 *   trackingShare   the share of frames with both ankles, heels and toes seen.
 *
 * Pure, no DOM.
 */
import { posesOf, SubjectLock } from "../../engine/subject";
import { VIS_MIN } from "../../engine/geometry";
import { resampleUniform } from "../../engine/signal/resample";
import type { GaitFrame, GaitView } from "../../engine/gait/types";
import type { Frame } from "../../engine/types";
import { medianFps } from "./perf";

export interface GaitWindows {
  /** Seconds from the first frame. */
  standFrom: number;
  standTo: number;
  walkFrom: number;
  walkTo: number;
}

export type GaitCapturePhase = "waiting" | "standing" | "between" | "walking" | "done";

export class GaitCapture {
  private readonly lock = new SubjectLock();
  private readonly stand: GaitFrame[] = [];
  private readonly walking: GaitFrame[] = [];
  private t0: number | null = null;
  private frames = 0;
  private subjectFrames = 0;
  private current: GaitCapturePhase = "waiting";

  constructor(private readonly w: GaitWindows) {}

  get phase(): GaitCapturePhase {
    return this.current;
  }

  /** Takes one frame of the camera; returns the window it fell in. */
  push(frame: Frame): GaitCapturePhase {
    if (this.current === "done") return this.current;
    if (this.t0 === null) this.t0 = frame.t;
    const s = (frame.t - this.t0) / 1000;
    const w = this.w;
    this.current =
      s < w.standFrom
        ? "waiting"
        : s < w.standTo
          ? "standing"
          : s < w.walkFrom
            ? "between"
            : s < w.walkTo
              ? "walking"
              : "done";
    if (this.current === "done") return this.current;
    this.frames++;
    if (!this.lock.locked) {
      const poses = posesOf(frame);
      if (!poses.length || !this.lock.lock(poses, frame.aspect)) return this.current;
    }
    const picked = this.lock.pickFrame(frame);
    if (!picked.lm) return this.current;
    this.subjectFrames++;
    const g: GaitFrame = { t: frame.t, lm: picked.lm, aspect: frame.aspect ?? 1 };
    if (this.current === "standing") this.stand.push(g);
    else if (this.current === "walking") this.walking.push(g);
    return this.current;
  }

  standing(): GaitFrame[] {
    return [...this.stand];
  }

  walk(): GaitFrame[] {
    return [...this.walking];
  }

  stats() {
    return {
      frames: this.frames,
      subjectFrames: this.subjectFrames,
      standingFrames: this.stand.length,
      walkFrames: this.walking.length,
      walkFps: medianFps(this.walking.map((f) => f.t)),
    };
  }
}

const HZ = 30;
/** Stride periods searched (s): 48 to 200 steps a minute. */
const STRIDE_RANGE: [number, number] = [0.6, 2.5];
/** The resampler fills gaps up to this (s), as the gait preprocessing does (gait-rules 0.12 s). */
const MAX_GAP_S = 0.12;

export interface HarnessCadence {
  /** Steps a minute: 120 ÷ the stride period; null when no period was found. */
  cadenceSpm: number | null;
  strideS: number | null;
  signal: "ankle_x" | "ankle_y";
  /** The autocorrelation at the period (1 is a perfect repeat). */
  strength: number | null;
}

/** The stride period of the ankle gap (see the file header). */
export function harnessCadence(frames: readonly GaitFrame[], view: GaitView): HarnessCadence {
  const sideView = view === "side" || view === "pad_side";
  const signal = sideView ? "ankle_x" : "ankle_y";
  const none: HarnessCadence = { cadenceSpm: null, strideS: null, signal, strength: null };
  // Positions at any visibility: the model still places a hidden ankle, and a side view hides the far
  // one behind the near leg in every stride (as A's calibration reads orientation landmarks).
  const ys = frames.map((f) => {
    const l = f.lm[27];
    const r = f.lm[28];
    if (!l || !r) return null;
    const y = sideView ? (l.x - r.x) * f.aspect : l.y - r.y;
    return Number.isFinite(y) ? y : null;
  });
  if (!frames.length) return none;
  const { y, segments } = resampleUniform(
    frames.map((f) => f.t / 1000),
    ys,
    HZ,
    MAX_GAP_S,
  );
  let best: [number, number] | null = null;
  for (const s of segments) if (!best || s[1] - s[0] > best[1] - best[0]) best = s;
  if (!best) return none;
  const v = Array.from(y.subarray(best[0], best[1]));
  const n = v.length;
  const lo = Math.round(STRIDE_RANGE[0] * HZ);
  const hi = Math.min(Math.round(STRIDE_RANGE[1] * HZ), Math.floor(n / 2));
  if (hi <= lo + 1) return none;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const d = v.map((x) => x - mean);
  const energy = d.reduce((a, b) => a + b * b, 0);
  if (energy < 1e-10 * n) return none;
  const r = (k: number) => {
    let s = 0;
    for (let i = 0; i + k < n; i++) s += d[i] * d[i + k];
    return s / energy;
  };
  let k = lo;
  for (let j = lo + 1; j <= hi; j++) if (r(j) > r(k)) k = j;
  const peak = r(k);
  if (peak < 0.3 || k === lo || k === hi) return none;
  const a = r(k - 1);
  const c = r(k + 1);
  const denom = a - 2 * peak + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const strideS = (k + shift) / HZ;
  const round = (x: number, p: number) => Math.round(x * 10 ** p) / 10 ** p;
  return {
    cadenceSpm: round(120 / strideS, 1),
    strideS: round(strideS, 3),
    signal,
    strength: round(peak, 3),
  };
}

/** Share of frames with both ankles, both heels and both toes seen; null for no frame. */
export function trackingShare(frames: readonly GaitFrame[]): {
  ankles: number | null;
  heels: number | null;
  toes: number | null;
} {
  const share = (a: number, b: number) =>
    frames.length
      ? Math.round(
          (1000 *
            frames.filter((f) => f.lm[a]?.visibility >= VIS_MIN && f.lm[b]?.visibility >= VIS_MIN).length) /
            frames.length,
        ) / 1000
      : null;
  return { ankles: share(27, 28), heels: share(29, 30), toes: share(31, 32) };
}
