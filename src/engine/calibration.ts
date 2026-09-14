import { ExerciseDef, MetricFrame, MetricId, PRF } from "./types";

/**
 * Personal Reference Frame capture.
 * The user performs guided reps at comfortable effort; we record the primary metric's
 * observed range and the median of each compensation baseline metric.
 * All later thresholds are expressed relative to THIS user's numbers — never population norms.
 *
 * Readiness requires three things:
 *  1. enough samples (time in front of the camera),
 *  2. a meaningfully wide range (≥30% of the exercise default — filters out standing still),
 *  3. a STABLE range envelope — the observed min/max stopped growing over the last
 *     ~2 seconds, i.e. the user has actually shown us their extremes across full reps.
 * Without (3) the PRF captures a partial slice of the movement and every later rep
 * looks instant (this exact bug was caught by live-trace testing).
 */
export class Calibrator {
  private primarySamples: number[] = [];
  private baselineSamples = new Map<MetricId, number[]>();
  private spanHistory: { t: number; span: number }[] = [];

  constructor(private def: ExerciseDef) {}

  feed(mf: MetricFrame): void {
    const p = mf.values[this.def.primaryMetric];
    if (p !== undefined) {
      this.primarySamples.push(p);
      if (this.primarySamples.length % 5 === 0) {
        const [lo, hi] = robustRange(this.primarySamples);
        this.spanHistory.push({ t: mf.t, span: hi - lo });
      }
    }
    for (const rule of this.def.rules) {
      const v = mf.values[rule.metric];
      if (v === undefined) continue;
      const arr = this.baselineSamples.get(rule.metric) ?? [];
      arr.push(v);
      this.baselineSamples.set(rule.metric, arr);
    }
  }

  private sampleFrac(minSamples: number): number {
    return Math.min(1, this.primarySamples.length / minSamples);
  }

  private spanFrac(): number {
    if (this.primarySamples.length < 30) return 0;
    const [dLo, dHi] = this.def.defaultRange;
    const need = Math.abs(dHi - dLo) * 0.3;
    const [lo, hi] = robustRange(this.primarySamples);
    return Math.min(1, (hi - lo) / need);
  }

  /** span grew less than 8% over the trailing 2s window */
  private isStable(now: number, windowMs = 2000, tolerance = 0.08): boolean {
    if (this.spanHistory.length < 4) return false;
    const current = this.spanHistory[this.spanHistory.length - 1].span;
    if (current <= 0) return false;
    const past = [...this.spanHistory].reverse().find((h) => now - h.t >= windowMs);
    if (!past) return false;
    return (current - past.span) / current < tolerance;
  }

  /** all three readiness conditions */
  ready(now: number, minSamples = 150): boolean {
    return this.sampleFrac(minSamples) >= 1 && this.spanFrac() >= 1 && this.isStable(now);
  }

  /** 0..1 progress for the UI ring (samples + range width; stability adds the last stretch) */
  progress(now: number, minSamples = 150): number {
    const base = 0.45 * this.sampleFrac(minSamples) + 0.45 * this.spanFrac();
    return Math.min(1, base + (this.isStable(now) ? 0.1 : 0));
  }

  build(now = Date.now()): PRF {
    let range: [number, number];
    if (this.primarySamples.length >= 30) {
      const [lo, hi] = robustRange(this.primarySamples);
      // orient to the exercise's direction: some exercises (curl) run high → low
      const inverted = this.def.defaultRange[0] > this.def.defaultRange[1];
      range = inverted ? [hi, lo] : [lo, hi];
    } else {
      range = this.def.defaultRange;
    }
    const baselines: PRF["baselines"] = {};
    for (const [m, arr] of this.baselineSamples) baselines[m] = median(arr);
    return { exerciseId: this.def.id, range, baselines, capturedAt: now };
  }
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
