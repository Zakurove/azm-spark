import { ExerciseDef, MetricFrame, MetricId, PRF } from "./types";

/**
 * Personal Reference Frame capture by reps (booth v2, contract A3).
 *
 * Calibration starts after the start position gate (startPosition.ts) and watches the primary
 * metric for comfortable reps: a rise of at least the excursion floor from a low point, then a
 * return. The first `reps` (2) of them set the personal range: the median rep bottom and the median
 * rep peak, at least the excursion floor apart. All later thresholds are relative to THIS person's
 * numbers, never population norms.
 *
 *   excursion floor   15% of the exercise's default range (CAL_FLOOR_SHARE); smaller wobbles, a
 *                     tremor or a shift in the chair, are never a rep;
 *   rep bottom        never more than one floor below the start position's value (`startValue`),
 *                     so hands dropped to the lap between reps are not taken as the bottom, and a
 *                     rise from the lap back to the start position is not a rep;
 *   comfortable       the rep lasts at least MIN_CAL_REP_MS from its low point to its return.
 *
 * The baselines of the rule metrics are the medians over the calibration frames, as before.
 * Without a rep, `build` falls back to the exercise's default range.
 */
export const CAL_REPS = 2;
export const CAL_FLOOR_SHARE = 0.15;
export const MIN_CAL_REP_MS = 600;

export interface CalibrationRep {
  /** oriented bottom and peak (higher is toward the top of the movement) */
  bottom: number;
  peak: number;
  t: number;
}

export class Calibrator {
  private baselineSamples = new Map<MetricId, number[]>();
  private readonly dir: 1 | -1;
  private readonly floor: number;
  private readonly needed: number;
  private readonly bottomFloor: number;
  private found: CalibrationRep[] = [];
  private rising = false;
  private lo = Infinity;
  private loT = 0;
  private hi = -Infinity;

  constructor(
    private def: ExerciseDef,
    opts: { reps?: number; startValue?: number } = {},
  ) {
    const [dLo, dHi] = def.defaultRange;
    this.dir = dLo > dHi ? -1 : 1;
    this.floor = Math.abs(dHi - dLo) * CAL_FLOOR_SHARE;
    this.needed = Math.max(1, opts.reps ?? CAL_REPS);
    this.bottomFloor =
      opts.startValue !== undefined && Number.isFinite(opts.startValue)
        ? this.dir * opts.startValue - this.floor
        : -Infinity;
  }

  feed(mf: MetricFrame): void {
    const p = mf.values[this.def.primaryMetric];
    if (p !== undefined && Number.isFinite(p)) this.track(this.dir * p, mf.t);
    for (const m of baselineMetrics(this.def)) {
      const v = mf.values[m];
      if (v === undefined || !Number.isFinite(v)) continue;
      const arr = this.baselineSamples.get(m) ?? [];
      arr.push(v);
      this.baselineSamples.set(m, arr);
    }
  }

  private track(u: number, t: number): void {
    if (!this.rising) {
      if (u < this.lo) {
        this.lo = u;
        this.loT = t;
      }
      if (u >= this.lo + this.floor) {
        this.rising = true;
        this.hi = u;
      }
      return;
    }
    this.hi = Math.max(this.hi, u);
    const drop = Math.max(0.5 * this.floor, 0.35 * (this.hi - this.lo));
    if (u > this.hi - drop) return;
    // Raising the hands from the lap back to the start position is not a rep: the rise must clear
    // the floor above the bottom as kept, not only above the lap.
    const bottom = Math.max(this.lo, this.bottomFloor);
    if (t - this.loT >= MIN_CAL_REP_MS && this.hi - bottom >= this.floor)
      this.found.push({ bottom, peak: this.hi, t });
    this.rising = false;
    this.lo = u;
    this.loT = t;
    this.hi = -Infinity;
  }

  /** Comfortable reps measured so far. */
  get reps(): number {
    return this.found.length;
  }

  /** How many reps the calibration needs. */
  get repsNeeded(): number {
    return this.needed;
  }

  /** Ready once the needed comfortable reps are measured (the arguments are kept for older callers). */
  ready(_now?: number, _minSamples?: number): boolean {
    return this.found.length >= this.needed;
  }

  /** 0..1 for the UI: whole reps, plus half a rep while one is rising. */
  progress(_now?: number, _minSamples?: number): number {
    return Math.min(1, (this.found.length + (this.rising ? 0.5 : 0)) / this.needed);
  }

  build(now = Date.now()): PRF {
    let range: [number, number];
    const reps = this.found.slice(0, this.needed);
    if (reps.length) {
      const bottom = median(reps.map((r) => r.bottom));
      const peak = median(reps.map((r) => r.peak));
      const top = bottom + Math.max(peak - bottom, this.floor);
      range = [this.dir * bottom, this.dir * top];
    } else {
      range = [...this.def.defaultRange];
    }
    const baselines: PRF["baselines"] = {};
    for (const [m, arr] of this.baselineSamples) baselines[m] = median(arr);
    return { exerciseId: this.def.id, range, baselines, capturedAt: now };
  }
}

/**
 * Metrics whose calibration median is kept in the PRF: every rule metric, plus the trunk angle of
 * the safety stop and, for a side view, the face side that gives its forward direction (S0).
 */
export function baselineMetrics(def: ExerciseDef): MetricId[] {
  const out = new Set<MetricId>(def.rules.map((r) => r.metric));
  if (def.trunkSafety) {
    out.add("trunk_lean");
    if (def.trunkSafety.cap.view === "side") out.add("nose_offset");
  }
  return [...out];
}

/** 5th–95th percentile — robust to landmark glitches. */
export function robustRange(xs: number[]): [number, number] {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return [q(0.05), q(0.95)];
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
