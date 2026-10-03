/**
 * The start position gate (booth v2, contract A2). Pure TS, no DOM.
 *
 * Calibration used to start the moment the person was framed, so arms resting in the lap (straight
 * elbows) were recorded as the top of the press and limited reps never counted. Now calibration
 * starts only after the exercise's start position (`ExerciseDef.start`) has held for one second:
 *   press          wrists near shoulder height, elbows bent;
 *   curl           the arm hanging with the elbow fairly straight, side view;
 *   sit to stand   seated.
 *
 * A profile with expected asymmetry (one side weaker after a stroke) may keep the weaker arm resting
 * down: the mean wrist height of the press is then allowed lower by WEAKER_ARM_ALLOWANCE, which is
 * about what a resting arm takes off the mean of a racked one. Both arms resting still fail.
 */
import { ExerciseDef, ImpairmentProfile, MetricFrame } from "./types";

/** How long the start position must hold before calibration begins. */
export const START_HOLD_MS = 1000;
/** A gap shorter than this (a dropped or noisy frame) does not break the hold. */
export const START_GRACE_MS = 150;
/** Wrist height a resting weaker arm takes off the two arm mean (racked 0.25, resting minus 1.1). */
export const WEAKER_ARM_ALLOWANCE = 0.7;

/** True when every start condition of the exercise holds on this frame. */
export function inStartPosition(def: ExerciseDef, mf: MetricFrame, profile?: ImpairmentProfile): boolean {
  if (!def.start.length) return true;
  return def.start.every((c) => {
    const v = mf.values[c.metric];
    if (v === undefined || !Number.isFinite(v)) return false;
    const min =
      c.min !== undefined && c.metric === "wrist_height" && profile?.expectedAsymmetry
        ? c.min - WEAKER_ARM_ALLOWANCE
        : c.min;
    return (min === undefined || v >= min) && (c.max === undefined || v <= c.max);
  });
}

/**
 * Tracks the hold of the start position over frames. `feed` every framed frame; `ready` once the
 * position has held for START_HOLD_MS; `startValue` is then the median primary metric of the hold,
 * the person's own starting point (the calibration keeps rep bottoms near it).
 */
export class StartGate {
  private since: number | null = null;
  private lastIn = -Infinity;
  private values: number[] = [];
  private done = false;

  constructor(
    private def: ExerciseDef,
    private profile?: ImpairmentProfile,
  ) {}

  /** Feeds one frame; returns the hold, 0..1. */
  feed(mf: MetricFrame): number {
    if (this.done) return 1;
    if (inStartPosition(this.def, mf, this.profile)) {
      if (this.since === null || mf.t - this.lastIn > START_GRACE_MS) {
        this.since = mf.t;
        this.values = [];
      }
      this.lastIn = mf.t;
      const v = mf.values[this.def.primaryMetric];
      if (v !== undefined && Number.isFinite(v)) this.values.push(v);
      if (mf.t - this.since >= START_HOLD_MS && this.values.length) this.done = true;
    } else if (mf.t - this.lastIn > START_GRACE_MS) {
      this.since = null;
      this.values = [];
    }
    return this.hold(mf.t);
  }

  /** 0..1 of the hold at time t. */
  hold(t: number): number {
    if (this.done) return 1;
    if (this.since === null || t - this.lastIn > START_GRACE_MS) return 0;
    return Math.min(1, (t - this.since) / START_HOLD_MS);
  }

  get ready(): boolean {
    return this.done;
  }

  get startValue(): number | undefined {
    if (!this.values.length) return undefined;
    const s = [...this.values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  reset(): void {
    this.since = null;
    this.lastIn = -Infinity;
    this.values = [];
    this.done = false;
  }
}
