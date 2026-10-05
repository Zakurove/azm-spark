/**
 * The measures of the v7 performance overlay and the real model smoke page (product v7 contract
 * section 9 and 8.4, stream G, step G1). Pure, no DOM: perfProbe.ts feeds it in the browser.
 *
 *   - the pose rate: 1000 ÷ the median gap between model calls (as QualityMonitor's fps and the
 *     focus camera's probe), so a dropped frame does not move it;
 *   - the model time per frame: the duration of PoseLandmarker.detectForVideo, read by wrapping the
 *     method (timeMethod), so no stream's file needs a hook (A6a-5);
 *   - the display frame time (animation frame gaps), long tasks, User Timing measures named azm:*
 *     (any stream may add one with performance.measure) and the JS heap.
 */

/** Count, median, 95th percentile and largest of a set of durations (ms) or rates. */
export interface Spread {
  n: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

const finite = (values: readonly number[]) => values.filter((v) => Number.isFinite(v));

/** The q quantile (0 to 1), interpolating between the closest ranks (numpy's default); null when empty. */
export function quantile(values: readonly number[], q: number): number | null {
  const v = finite(values).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function spread(values: readonly number[]): Spread {
  const v = finite(values);
  if (!v.length) return { n: 0, p50: null, p95: null, max: null };
  return { n: v.length, p50: quantile(v, 0.5), p95: quantile(v, 0.95), max: Math.max(...v) };
}

/** 1000 ÷ the median gap between increasing times in ms, to 0.1; null under two increasing times. */
export function medianFps(times: readonly number[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) gaps.push(times[i] - times[i - 1]);
  const gap = quantile(gaps, 0.5);
  return gap === null ? null : Math.round(10000 / gap) / 10;
}

/**
 * The mean frame rate over a window: (frames − 1) × 1000 ÷ its span in ms, to 0.1; null under two
 * frames or an empty span. D-026 item 6: the frame rate floors (the C-10 model probe, the gait view
 * gates) read the mean, so dropped frames count; the overlay shows the same number.
 */
export function meanFps(times: readonly number[]): number | null {
  if (times.length < 2) return null;
  const span = times[times.length - 1] - times[0];
  return span > 0 ? Math.round(((times.length - 1) * 10000) / span) / 10 : null;
}

/** The last `capacity` values pushed, oldest first. */
export class RecentValues {
  private readonly buf: number[] = [];
  constructor(private readonly capacity: number) {}
  push(v: number): void {
    this.buf.push(v);
    if (this.buf.length > this.capacity) this.buf.splice(0, this.buf.length - this.capacity);
  }
  values(): number[] {
    return [...this.buf];
  }
  get size(): number {
    return this.buf.length;
  }
  clear(): void {
    this.buf.length = 0;
  }
}

export interface PerfSnapshot {
  /** Pose frames the model processed per second (median gap); null under two calls. */
  poseFps: number | null;
  /** The model's time per frame (detectForVideo), ms. */
  modelMs: Spread;
  /** The display's frame time (animation frame gaps), ms. */
  frameMs: Spread;
  /**
   * Long tasks the browser reported (each over 50 ms); maxMs null when none. beyondModel: the tasks
   * during capture (from the first model call) whose time outside the model's calls is over the
   * budget (section 9: "none over 50 ms besides the model call"), with the longest such time.
   */
  longTasks: { count: number; maxMs: number | null; beyondModel: { count: number; maxMs: number | null } };
  /** The delegate of the last pose model that loaded (the source tries the GPU, then the CPU). */
  delegate: "GPU" | "CPU" | null;
  /** Why the last delegate that failed did not load ("GPU: <message>"); null when none failed. */
  delegateError: string | null;
  /** User Timing measures named azm:*, by name, ms. */
  measures: Record<string, Spread>;
  /** The JS heap in use (Chromium), MB; null where the browser does not tell. */
  heapMB: number | null;
  /** Growth since the first heap reading, MB. */
  heapGrowthMB: number | null;
}

/** The measures over a window of the last `capacity` samples of each kind. */
export class PerfMeter {
  private readonly modelStarts: RecentValues;
  private readonly modelDurations: RecentValues;
  private readonly frameGaps: RecentValues;
  private readonly longs: RecentValues;
  private readonly beyond: RecentValues;
  private readonly named = new Map<string, RecentValues>();
  private readonly longTaskMs: number;
  private lastFrame: number | null = null;
  private heapFirst: number | null = null;
  private heapLast: number | null = null;
  private loaded: "GPU" | "CPU" | null = null;
  /** The first model call: long tasks before it are loading, not capture. */
  private firstModel: number | null = null;
  private failed: string | null = null;

  /** `longTaskMs`: the time outside model calls a long task may take (section 9, 50 ms). */
  constructor(
    private readonly capacity = 240,
    opts: { longTaskMs?: number } = {},
  ) {
    this.modelStarts = new RecentValues(capacity);
    this.modelDurations = new RecentValues(capacity);
    this.frameGaps = new RecentValues(capacity);
    this.longs = new RecentValues(capacity);
    this.beyond = new RecentValues(capacity);
    this.longTaskMs = opts.longTaskMs ?? 50;
  }

  /** A model call from `start` to `end` (ms). */
  model(start: number, end: number): void {
    if (this.firstModel === null) this.firstModel = start;
    this.modelStarts.push(start);
    this.modelDurations.push(end - start);
  }

  /** A display frame at `t` (ms). */
  frame(t: number): void {
    if (this.lastFrame !== null && t > this.lastFrame) this.frameGaps.push(t - this.lastFrame);
    this.lastFrame = t;
  }

  /**
   * A long task of `durationMs` from `startTime`. During capture (from the first model call) its part
   * outside the recent model calls is kept too; before it the page was loading, which section 9's
   * capture budget does not cover.
   */
  longTask(durationMs: number, startTime: number): void {
    this.longs.push(durationMs);
    if (this.firstModel === null || startTime + durationMs <= this.firstModel) return;
    const starts = this.modelStarts.values();
    const durations = this.modelDurations.values();
    const end = startTime + durationMs;
    let inModel = 0;
    for (let i = 0; i < starts.length; i++)
      inModel += Math.max(0, Math.min(end, starts[i] + durations[i]) - Math.max(startTime, starts[i]));
    const rest = durationMs - inModel;
    if (rest > this.longTaskMs) this.beyond.push(rest);
  }

  /** A pose model was created with `delegate`; `ok` when it loaded, else why not. */
  delegate(delegate: "GPU" | "CPU", ok: boolean, error?: string): void {
    if (ok) this.loaded = delegate;
    else this.failed = `${delegate}: ${error ?? "failed"}`;
  }

  measure(name: string, durationMs: number): void {
    let w = this.named.get(name);
    if (!w) this.named.set(name, (w = new RecentValues(this.capacity)));
    w.push(durationMs);
  }

  heap(mb: number | null): void {
    if (mb === null || !Number.isFinite(mb)) return;
    if (this.heapFirst === null) this.heapFirst = mb;
    this.heapLast = mb;
  }

  snapshot(): PerfSnapshot {
    const longs = this.longs.values();
    const beyond = this.beyond.values();
    const measures: Record<string, Spread> = {};
    for (const [name, w] of this.named) measures[name] = spread(w.values());
    return {
      poseFps: meanFps(this.modelStarts.values()),
      modelMs: spread(this.modelDurations.values()),
      frameMs: spread(this.frameGaps.values()),
      longTasks: {
        count: longs.length,
        maxMs: longs.length ? Math.max(...longs) : null,
        beyondModel: { count: beyond.length, maxMs: beyond.length ? Math.max(...beyond) : null },
      },
      measures,
      delegate: this.loaded,
      delegateError: this.failed,
      heapMB: this.heapLast,
      heapGrowthMB:
        this.heapLast !== null && this.heapFirst !== null
          ? Math.round((this.heapLast - this.heapFirst) * 10) / 10
          : null,
    };
  }

  reset(): void {
    for (const w of [this.modelStarts, this.modelDurations, this.frameGaps, this.longs, this.beyond])
      w.clear();
    this.named.clear();
    this.lastFrame = null;
    this.heapFirst = null;
    this.heapLast = null;
    this.loaded = null;
    this.failed = null;
    this.firstModel = null;
  }
}

type Listener = { onCall(start: number, end: number): void; clock(): number };
interface Timed {
  original: unknown;
  listeners: Set<Listener>;
}
const TIMED = new WeakMap<object, Map<PropertyKey, Timed>>();

/**
 * Times every call of `target[key]` (a prototype's method, for example) and reports its start and end
 * (ms of `clock`) after the call, even when it throws; `this`, the arguments and the value pass
 * through. One wrapper per method however many callers time it; the returned function stops this
 * caller's reports, and the last one restores the original method.
 */
export function timeMethod<T extends object>(
  target: T,
  key: keyof T & PropertyKey,
  onCall: (start: number, end: number) => void,
  clock: () => number = () => performance.now(),
): () => void {
  let byKey = TIMED.get(target);
  if (!byKey) TIMED.set(target, (byKey = new Map()));
  let timed = byKey.get(key);
  if (!timed) {
    const original = target[key];
    if (typeof original !== "function") throw new TypeError(`timeMethod: ${String(key)} is not a method`);
    const entry: Timed = { original, listeners: new Set() };
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const ls = [...entry.listeners];
      const starts = ls.map((l) => l.clock());
      try {
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      } finally {
        ls.forEach((l, i) => l.onCall(starts[i], l.clock()));
      }
    };
    Object.defineProperty(target, key, { value: wrapped, writable: true, configurable: true });
    byKey.set(key, (timed = entry));
  }
  const listener: Listener = { onCall, clock };
  timed.listeners.add(listener);
  const entry = timed;
  let undone = false;
  return () => {
    if (undone) return;
    undone = true;
    entry.listeners.delete(listener);
    if (entry.listeners.size) return;
    Object.defineProperty(target, key, { value: entry.original, writable: true, configurable: true });
    byKey!.delete(key);
  };
}
