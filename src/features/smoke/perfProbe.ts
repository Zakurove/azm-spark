/**
 * The browser side of the v7 measures (product v7 contract section 9 and A6a-5, stream G, step G1):
 * one set of hooks for the page, read by every attached PerfMeter (the overlay and the smoke page):
 *
 *   - PoseLandmarker.prototype.detectForVideo is timed (perf.ts timeMethod): every pose source's
 *     model call, the frames it processed and its time, with no hook in another stream's file;
 *   - PoseLandmarker.createFromOptions is watched for the delegate that loaded (GPU or CPU);
 *   - an animation frame loop for the display's frame time;
 *   - PerformanceObserver for long tasks and the User Timing measures named azm:*;
 *   - the JS heap once a second (Chromium's performance.memory).
 *
 * VITE_E2E builds only (the smoke page and the overlay are its only importers). The hooks are undone
 * when the last meter lets go.
 */
import { PoseLandmarker } from "@mediapipe/tasks-vision";
import { timeMethod, type PerfMeter } from "./perf";

interface Entry {
  entryType: string;
  name: string;
  duration: number;
  startTime: number;
}

/** What the hooks need from the page (tests pass fakes). */
export interface ProbeEnv {
  /** The prototype whose detectForVideo is timed; null when there is none to time. */
  poseProto: { detectForVideo(...args: never[]): unknown } | null;
  /** The class whose createFromOptions tells which delegate loaded; null when there is none. */
  poseClass: { createFromOptions(...args: never[]): Promise<unknown> } | null;
  now(): number;
  requestFrame(cb: (t: number) => void): number;
  cancelFrame(id: number): void;
  /** Long task and measure entries as they arrive; null when the browser has no observer. */
  observe(cb: (entries: Entry[]) => void): (() => void) | null;
  every(ms: number, cb: () => void): () => void;
  heapMB(): number | null;
}

function browserEnv(): ProbeEnv {
  return {
    poseProto: PoseLandmarker.prototype,
    poseClass: PoseLandmarker,
    now: () => performance.now(),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    observe(cb) {
      if (typeof PerformanceObserver === "undefined") return null;
      const supported = PerformanceObserver.supportedEntryTypes ?? [];
      const types = ["longtask", "measure"].filter((t) => supported.includes(t));
      if (!types.length) return null;
      const obs = new PerformanceObserver((list) => cb(list.getEntries()));
      // One type per observe call: Safari refuses a list with a type it lacks.
      for (const type of types) {
        try {
          obs.observe({ type, buffered: false });
        } catch {
          /* this browser has no such entry type */
        }
      }
      return () => obs.disconnect();
    },
    every(ms, cb) {
      const id = setInterval(cb, ms);
      return () => clearInterval(id);
    },
    heapMB() {
      const mem = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
      return mem && typeof mem.usedJSHeapSize === "number" ? Math.round(mem.usedJSHeapSize / 1e5) / 10 : null;
    },
  };
}

/**
 * Watches a model class's createFromOptions: the delegate it was asked for (GPU, else CPU) and
 * whether it loaded. One hub installs it, so one wrapper; the returned function restores the method.
 */
function watchCreate(
  cls: { createFromOptions(...args: never[]): Promise<unknown> },
  onLoad: (delegate: "GPU" | "CPU", ok: boolean, error?: string) => void,
): () => void {
  const original = cls.createFromOptions;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const opts = args[1] as { baseOptions?: { delegate?: string } } | undefined;
    const delegate = opts?.baseOptions?.delegate === "GPU" ? "GPU" : "CPU";
    const loading = (original as (...a: unknown[]) => Promise<unknown>).apply(this, args);
    loading.then(
      () => onLoad(delegate, true),
      (err: unknown) => onLoad(delegate, false, err instanceof Error ? err.message : String(err)),
    );
    return loading;
  };
  Object.defineProperty(cls, "createFromOptions", { value: wrapped, writable: true, configurable: true });
  return () =>
    Object.defineProperty(cls, "createFromOptions", { value: original, writable: true, configurable: true });
}

interface Hub {
  meters: Set<PerfMeter>;
  stop(): void;
}
let hub: Hub | null = null;

function startHub(env: ProbeEnv): Hub {
  const meters = new Set<PerfMeter>();
  const each = (fn: (m: PerfMeter) => void) => meters.forEach(fn);
  const undoModel = env.poseProto
    ? timeMethod(
        env.poseProto as { detectForVideo(...args: never[]): unknown },
        "detectForVideo",
        (start, end) => each((m) => m.model(start, end)),
        env.now,
      )
    : () => undefined;
  const undoCreate = env.poseClass
    ? watchCreate(env.poseClass, (delegate, ok, error) => each((m) => m.delegate(delegate, ok, error)))
    : () => undefined;
  let raf = 0;
  const tick = (t: number) => {
    each((m) => m.frame(t));
    raf = env.requestFrame(tick);
  };
  raf = env.requestFrame(tick);
  const stopObserver = env.observe((entries) => {
    for (const e of entries) {
      if (e.entryType === "longtask") each((m) => m.longTask(e.duration, e.startTime));
      else if (e.entryType === "measure" && e.name.startsWith("azm:"))
        each((m) => m.measure(e.name, e.duration));
    }
  });
  const stopHeap = env.every(1000, () => {
    const mb = env.heapMB();
    each((m) => m.heap(mb));
  });
  return {
    meters,
    stop() {
      undoModel();
      undoCreate();
      env.cancelFrame(raf);
      stopObserver?.();
      stopHeap();
    },
  };
}

/** Feeds `meter` from the page's hooks until the returned function is called. */
export function attachMeter(meter: PerfMeter, env: ProbeEnv = browserEnv()): () => void {
  if (!hub) hub = startHub(env);
  const own = hub;
  own.meters.add(meter);
  const first = env.heapMB();
  if (first !== null) meter.heap(first);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    own.meters.delete(meter);
    if (own.meters.size || hub !== own) return;
    own.stop();
    hub = null;
  };
}
