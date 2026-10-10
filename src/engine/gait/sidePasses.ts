/**
 * The passes of the overground side walk, counted live (D-036 item 6: one walk, the side view; a
 * fixed number of passes). A pass is one walk across the picture. It is read from where the body's
 * centre is in the picture, never from the feet, so it counts when the person walks out of the
 * picture, turns just inside it, walks slowly, stops on the way, or is cut off at the edges, and it
 * never counts a turn twice:
 *   - the main rule: the centre (the mid hip, else the mid shoulder) goes from one side zone of the
 *     picture into the other (under 30% of the width to over 70%, or back): one pass, counted as
 *     the person arrives;
 *   - the fallback, for a path that does not reach both zones (a phone far away, a short path): a
 *     walk of at least a quarter of the width that ends with a turn, a stop of 1.5 s, or the person
 *     leaving the picture for 1.5 s, and that the main rule did not count;
 *   - a walk toward or away from the phone (the body's size in the picture changes by half or more
 *     during it) is never a pass; `depth` says so, for a calm hint;
 *   - a walk that turns back before a quarter of the width is no pass either; `short` says so for a
 *     few seconds, for a calm hint (walk a little further each way).
 * Each pass sets the side the person is on, so the next one must reach the other side. A frame
 * without the centre is simply skipped (missing frames never end or start a walk), and the centre is
 * the median over the last quarter second, so one wrong frame never moves it.
 * Engineering choices of the capture (no clinical number): each is in SIDE_PASS. Pure, no DOM.
 */
import type { Landmark } from "../types";

export const SIDE_PASS = {
  /** The side zones: under this share of the width, or over one minus it. */
  zone: 0.3,
  /** The fallback: a walk across at least this share of the width. */
  minRunShare: 0.25,
  /** A turn: the centre comes back at least this share of the width from the walk's furthest point. */
  turnBackShare: 0.06,
  /** A walk goes on while the centre gains at least this share of the width now and then. */
  progressShare: 0.02,
  /** The fallback: a walk that stops, or leaves the picture, for this long has ended. */
  stopMs: 1500,
  /** The centre: the median over this window. */
  smoothMs: 250,
  /**
   * A centre that moves faster than a person walks (this share of the width a second, at least
   * jumpShare of it) is somebody else, or the model found the person again elsewhere: a new walk from
   * there, never a pass.
   */
  jumpPerSec: 1,
  jumpShare: 0.15,
  /** Toward or away from the phone: the body's size in the picture changes by this factor. */
  depthRatio: 1.5,
  /** A short walk: it turned back after at least this share of the width (and under minRunShare). */
  shortShare: 0.08,
  /** ...and `short` stays this long after it. */
  shortHintMs: 4000,
  /** A landmark the centre reads: at least this visible (the edges of the picture lower it). */
  minVisibility: 0.3,
} as const;

type Side = -1 | 1;

interface Run {
  /** +1 to the right of the picture, -1 to the left, 0 not yet moving. */
  dir: -1 | 0 | 1;
  start: number;
  /** The furthest point in its direction, and the place and time of its last progress. */
  ext: number;
  progress: number;
  progressAt: number;
  /** The walk was counted (by a zone, or by the fallback). */
  counted: boolean;
  /** The body's size in the picture (mid shoulder to mid hip, picture heights) over the walk. */
  sizeMin: number;
  sizeMax: number;
}

export interface SidePassState {
  passes: number;
  /** Walking toward or away from the phone now (no pass is counted from it). */
  depth: boolean;
  /** A walk just turned back too soon to count (a few seconds after it). */
  short: boolean;
  /** The smoothed centre (share of the width), or null while nobody is seen. */
  x: number | null;
}

const mid = (lm: Landmark[], a: number, b: number): { x: number; y: number } | null => {
  const ok = (i: number) => {
    const q = lm[i];
    return (
      !!q && Number.isFinite(q.x) && Number.isFinite(q.y) && (q.visibility ?? 0) >= SIDE_PASS.minVisibility
    );
  };
  const pa = ok(a) ? lm[a] : null;
  const pb = ok(b) ? lm[b] : null;
  if (pa && pb) return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  const p = pa ?? pb;
  return p ? { x: p.x, y: p.y } : null;
};

const medianOf = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The body's centre across the picture (0 to 1) and its size (picture heights), from one pose. */
export function bodyCentre(lm: Landmark[] | null | undefined): { x: number; size: number } | null {
  if (!lm) return null;
  const hip = mid(lm, 23, 24);
  const shoulder = mid(lm, 11, 12);
  const c = hip ?? shoulder;
  if (!c) return null;
  const size = hip && shoulder ? Math.abs(hip.y - shoulder.y) : Number.NaN;
  return { x: c.x, size };
}

export class SidePassCounter {
  private passes = 0;
  /** The side the person is on: the zone of the last pass, or where they were first seen in a zone. */
  private home: Side | 0 = 0;
  private buf: { t: number; x: number; size: number }[] = [];
  private run: Run | null = null;
  private lastX: number | null = null;
  private lastRaw: { t: number; x: number } | null = null;
  private lastSeenAt: number | null = null;
  private depthNow = false;
  private shortUntil = -Infinity;
  private now = -Infinity;

  /** One frame's pose (the subject's), or null when nobody is seen. */
  feed(t: number, lm: Landmark[] | null | undefined): SidePassState {
    this.now = t;
    const c = bodyCentre(lm);
    if (!c) {
      this.poll(t);
      return this.state();
    }
    // Faster than anyone walks: somebody else, or the person found again elsewhere. A new walk from
    // here, on the side it is on, never a pass.
    const prev = this.lastRaw;
    if (prev) {
      const dx = Math.abs(c.x - prev.x);
      const dt = Math.max(33, t - prev.t) / 1000;
      if (dx >= SIDE_PASS.jumpShare && dx / dt > SIDE_PASS.jumpPerSec) {
        this.endRun(t, false);
        this.run = null;
        this.buf = [];
        this.home = zoneOf(c.x);
      }
    }
    this.lastRaw = { t, x: c.x };
    this.lastSeenAt = t;
    this.buf.push({ t, x: c.x, size: c.size });
    while (this.buf.length > 1 && t - this.buf[0].t > SIDE_PASS.smoothMs) this.buf.shift();
    const x = medianOf(this.buf.map((b) => b.x));
    const sizes = this.buf.map((b) => b.size).filter((s) => s > 0);
    const size = sizes.length ? medianOf(sizes) : Number.NaN;
    this.lastX = x;
    const run = (this.run ??= {
      dir: 0,
      start: x,
      ext: x,
      progress: x,
      progressAt: t,
      counted: false,
      sizeMin: Number.POSITIVE_INFINITY,
      sizeMax: 0,
    });
    if (size > 0) {
      run.sizeMin = Math.min(run.sizeMin, size);
      run.sizeMax = Math.max(run.sizeMax, size);
    }
    this.depthNow = depthOf(run);

    // The main rule: from one side zone into the other.
    const z = zoneOf(x);
    if (z !== 0) {
      if (this.home === 0) {
        this.home = z;
        if (Math.abs(x - run.start) >= 1 - 2 * SIDE_PASS.zone && !this.depthNow) {
          // From one side of the picture to this one before either zone was known: a pass.
          this.passes++;
          run.counted = true;
        } else if (Math.abs(x - run.start) >= SIDE_PASS.minRunShare) {
          // Walked here from the middle: the arrival starts the walks, it is not a pass.
          run.counted = true;
        }
      } else if (z !== this.home && !this.depthNow) {
        this.passes++;
        this.home = z;
        run.counted = true;
      }
    }

    // The walk's direction, its progress, and a turn.
    if (run.dir === 0) {
      if (Math.abs(x - run.start) >= SIDE_PASS.turnBackShare) {
        run.dir = x > run.start ? 1 : -1;
        run.ext = x;
        run.progress = x;
        run.progressAt = t;
      }
    } else if ((x - run.ext) * run.dir > 0) {
      run.ext = x;
      if ((x - run.progress) * run.dir >= SIDE_PASS.progressShare) {
        run.progress = x;
        run.progressAt = t;
      }
    } else if ((run.ext - x) * run.dir >= SIDE_PASS.turnBackShare) {
      this.endRun(t, true);
      const dir = run.dir === 1 ? -1 : 1;
      this.run = {
        dir,
        start: run.ext,
        ext: x,
        progress: x,
        progressAt: t,
        counted: false,
        sizeMin: size > 0 ? size : Number.POSITIVE_INFINITY,
        sizeMax: size > 0 ? size : 0,
      };
      this.depthNow = false;
    }
    this.poll(t);
    return this.state();
  }

  /** The clock without a frame of the person: a walk that stopped or left the picture has ended. */
  poll(t: number): SidePassState {
    this.now = Math.max(this.now, t);
    const run = this.run;
    if (run && run.dir !== 0 && !run.counted) {
      const still = t - run.progressAt >= SIDE_PASS.stopMs;
      const gone = this.lastSeenAt !== null && t - this.lastSeenAt >= SIDE_PASS.stopMs;
      if (still || gone) this.endRun(t, true);
    }
    if (this.lastSeenAt !== null && t - this.lastSeenAt >= SIDE_PASS.stopMs) this.depthNow = false;
    return this.state();
  }

  /**
   * The fallback: the walk now counts when it went far enough across, was not counted, and was no
   * depth walk; one that went only a little way says so (`short`).
   */
  private endRun(t: number, count: boolean): void {
    const run = this.run;
    if (!run || run.counted || run.dir === 0) return;
    const travel = Math.abs(run.ext - run.start);
    if (count && travel >= SIDE_PASS.minRunShare && !depthOf(run)) {
      this.passes++;
      this.home = run.dir;
    } else if (count && travel >= SIDE_PASS.shortShare && !depthOf(run))
      this.shortUntil = t + SIDE_PASS.shortHintMs;
    run.counted = true;
  }

  state(): SidePassState {
    return { passes: this.passes, depth: this.depthNow, short: this.now < this.shortUntil, x: this.lastX };
  }
}

const zoneOf = (x: number): Side | 0 => (x < SIDE_PASS.zone ? -1 : x > 1 - SIDE_PASS.zone ? 1 : 0);

/**
 * A walk toward or away from the phone: the body's size changed by depthRatio or more during it (a
 * walk across at one distance keeps its size; walking off a line toward the phone also moves the body
 * across the picture, so the travel across never clears it).
 */
function depthOf(run: Run): boolean {
  if (!(run.sizeMin > 0) || !(run.sizeMax > 0)) return false;
  return run.sizeMax / run.sizeMin >= SIDE_PASS.depthRatio;
}
