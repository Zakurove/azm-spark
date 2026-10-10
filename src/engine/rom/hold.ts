/**
 * The end range hold of the v7 range of motion runner (product v7 contract 2.6, stream B, step B1).
 * Pure, no DOM.
 *
 * rom-protocol 1.1 step 4: «after the angle has moved at least 10 degrees toward the end range from the
 * most flexed (or furthest) point of the attempt, the filtered angle stays within a 3 degree band for
 * 1.0 s. A smaller hold that the person confirms with «نعم» is recorded and graded with the flag
 * smallExcursion, so the most impaired people are not lost as quality failures (review A04, B01). The
 * engine sends the event end_range_hold with the median angle of the window (Hampel filter first) ...
 * A person whose angle never settles within 3 degrees in 2 tries (tremor, clonus) gets a 5 degree band,
 * flagged wideHold (proposal).»
 *
 * engine.minExcursionDeg: «measured from the most flexed point of the attempt (for lack movements) or the
 * point furthest from the end range, toward the end range; it only suppresses holds that fire before the
 * movement starts.»
 *
 * The numbers are the data's (ROM_DATA.engine: holdBandDeg, holdSeconds, wideHoldBandDeg,
 * minExcursionDeg, smoothing.hampel). The filtered angle is what the runner passes: the live dial's angle
 * (engine.smoothing: «Live dial: existing One Euro filter. Recorded value: Hampel filter (window 7,
 * n sigma 2), then the median of the hold window»), the One Euro on the landmarks, after a 0.5 s
 * running median (runner.ts RUNNER_RULES.holdMedianSec, change log B1-3, D-026 item 5).
 *
 * Readings of the words, each an engineering choice that adds no clinical number:
 *   - «within a 3 degree band»: the highest minus the lowest filtered angle of the window, at most the band.
 *   - «before the movement starts»: the angle has not left the hold band around the point furthest from
 *     the end range, or (for a hold under engine.minExcursionDeg) not left the band around the start pose's
 *     angle toward the end range (RomCalibration.startDeg). A hold whose excursion is beyond the band but
 *     under the minimum, beyond the start pose too, is a small excursion hold (the person moved, a
 *     little); else it is suppressed. The start pose check keeps landmark jitter at rest from asking the
 *     maximum question: over 20 s a still angle's lowest reading sits about 3 degrees under its middle.
 *   - A gap between readings longer than v1's sustained window gap (RANGE_RULES.maxGapMs, 250 ms) breaks
 *     the window, as v1 SustainedPeak does; a shorter gap (one unseen frame) does not.
 *   - After a hold fires the detector waits; `rearm(t)` lets the next hold fire once a whole window lies
 *     after t, at any angle. D-038 item 1: the runner holds the first hold in hand and takes a later one
 *     only when it lies clearly further on (runner.ts furtherHold): the same plateau found again a window
 *     later changes nothing.
 *
 * D-035 item 1 (Nasser's second real test, v7.1 on an iPhone: the dial showed his angle and he held
 * it, yet nothing was measured): the runner reads a lenient plateau, MVP_HOLD (mvpHoldOptions). A
 * steady top is the filtered angle within about 8 degrees either side of the window's median, its trend
 * under the plateau hint's 8 degrees per second (a slow raise is not a top), after a real movement from
 * the start pose (the protocol's: engine.minExcursionDeg for a value; a small hold from
 * engine.holdBandDeg is flagged smallExcursion). The value is still the plateau's median (Hampel, then
 * the median of the window's angles). The protocol's own 3 degrees for 1.0 s stay in holdOptions for
 * the record and the coach's plateau hint. D-038 item 1: with no question to confirm it any more, the
 * hold records the value, so it must be still for about 1 s (MVP_HOLD.seconds, 0.6 s before).
 */
import { hampel } from "../signal/hampel";
import { median } from "../modes/common";
import { RANGE_RULES } from "../modes/rangeTest";
import { ROM_DATA } from "../../movements/rom";
import type { RomKind } from "../../movements/rom/types";

export const HOLD_RULES = {
  /** Frames further apart than this break the hold window (v1 RANGE_RULES.maxGapMs). */
  maxGapMs: RANGE_RULES.maxGapMs,
} as const;

/**
 * The plateau the coach may get ready on (contract 2.6 RomEvent plateau: «Velocity under 8 degrees per
 * second for 0.4 s inside a 3 degree band (tunable)»), a central difference on the One Euro output
 * (contract 6.1). The band is engine.holdBandDeg. Only a hint: the value waits for the hold.
 */
export const PLATEAU_RULES = { maxDegPerSec: 8, seconds: 0.4 } as const;

/** A hold's value: engine.smoothing «Hampel filter (window 7, n sigma 2), then the median of the hold window», not rounded. */
export function holdValue(raws: readonly number[]): number | null {
  if (!raws.length) return null;
  const e = ROM_DATA.engine.smoothing.hampel;
  return median(Array.from(hampel(raws as number[], e.window, e.nSigma)));
}

export interface HoldOptions {
  /** 1: higher is further (flexion, signed); -1: lower is further (lack, degrees short of straight). */
  direction: 1 | -1;
  /** The start pose's angle (RomCalibration.startDeg), for small holds; null: not known. */
  startDeg?: number | null;
  /**
   * The band: the highest minus the lowest filtered angle of the window ("spread", the protocol's
   * reading), or the most any reading lies from the window's median ("median", D-035).
   */
  bandDeg: number;
  holdMs: number;
  minExcursionDeg: number;
  maxGapMs: number;
  /** How the band is read (default "spread"). */
  around?: "spread" | "median";
  /** The window's least squares trend must stay under this, degrees per second (null or absent: not read). */
  maxSlopeDegPerSec?: number | null;
  /**
   * How far the level must lie toward the end range, from the furthest point and (for a small hold)
   * from the start pose, for the person to have moved (default bandDeg, the protocol's reading).
   */
  moveDeg?: number;
  /**
   * A small hold (an excursion under minExcursionDeg, which the person must confirm) holds steadier
   * and longer: the filtered angle's spread over the last holdMs at most bandDeg (D-035: the
   * protocol's own 3 degrees for 1.0 s, so a resting arm's drift never asks the question).
   */
  small?: { holdMs: number; bandDeg: number };
}

/** The hold options of a movement kind, from ROM_DATA.engine (rom-protocol 1.1 step 4's own words). */
export function holdOptions(kind: RomKind): HoldOptions {
  const e = ROM_DATA.engine;
  return {
    direction: kind === "lack" ? -1 : 1,
    bandDeg: e.holdBandDeg,
    holdMs: e.holdSeconds * 1000,
    minExcursionDeg: e.minExcursionDeg,
    maxGapMs: HOLD_RULES.maxGapMs,
  };
}

/**
 * D-035 item 1, the MVP hold (interface numbers the tech lead set, not clinical ones; contract change
 * log R7-1): about 8 degrees either side of the window's median, for about 1 s (D-038 item 1: «still
 * about 1 s», 0.6 s before it), the window's trend
 * under the plateau hint's 8 degrees per second (PLATEAU_RULES.maxDegPerSec), so a slow raise is never
 * read as its top.
 */
export const MVP_HOLD = {
  halfBandDeg: 8,
  seconds: 1,
  maxSlopeDegPerSec: PLATEAU_RULES.maxDegPerSec,
  /**
   * A movement under 24 degrees holds within a third of its excursion either side (at least the
   * protocol's 3): the 8 degrees would take in most of a small movement's rise.
   */
  bandShareOfExcursion: 1 / 3,
} as const;

/** The runner's hold options (D-035): MVP_HOLD with the data's minimum excursion and v1's gap. */
export function mvpHoldOptions(kind: RomKind): HoldOptions {
  return {
    ...holdOptions(kind),
    bandDeg: MVP_HOLD.halfBandDeg,
    holdMs: MVP_HOLD.seconds * 1000,
    around: "median",
    maxSlopeDegPerSec: MVP_HOLD.maxSlopeDegPerSec,
    // A movement: beyond the data's wide band (engine.wideHoldBandDeg, 5) from the furthest point and
    // the start pose; a resting arm's drift on the real model reaches 3 to 4 degrees and asked the
    // question at rest. A small hold (under engine.minExcursionDeg) is flagged smallExcursion.
    moveDeg: ROM_DATA.engine.wideHoldBandDeg,
    // A small hold keeps the protocol's own steadiness (step 4: 3 degrees for 1.0 s).
    small: { holdMs: ROM_DATA.engine.holdSeconds * 1000, bandDeg: ROM_DATA.engine.holdBandDeg },
  };
}

/** The least squares slope of filtered readings, degrees per second (0 with fewer than two times). */
function slopeOf(xs: readonly { t: number; f: number }[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let mt = 0;
  let mf = 0;
  for (const s of xs) {
    mt += s.t;
    mf += s.f;
  }
  mt /= n;
  mf /= n;
  let num = 0;
  let den = 0;
  for (const s of xs) {
    num += (s.t - mt) * (s.f - mf);
    den += (s.t - mt) ** 2;
  }
  return den > 0 ? (num / den) * 1000 : 0;
}

/** A hold the detector found. */
export interface HoldFound {
  /** The window: its first and last reading times (ms). */
  from: number;
  to: number;
  /** Hampel filter (engine.smoothing.hampel) then the median of the window's raw angles; not rounded. */
  deg: number;
  /** Toward the end range, from the point furthest from it (filtered angles). */
  excursionDeg: number;
  bandDeg: number;
  smallExcursion: boolean;
}

interface Sample {
  t: number;
  /** The filtered angle. */
  f: number;
  /** The angle of the frame, unfiltered. */
  raw: number;
}

export class HoldDetector {
  private buf: Sample[] = [];
  private lastT: number | null = null;
  /** The filtered angle furthest from the end range in this attempt, and when it was last reached. */
  private away: number | null = null;
  private awayT = -Infinity;
  /** A hold fired; the next one waits for rearm(). */
  private latched = false;
  private band: number;

  constructor(readonly opts: HoldOptions) {
    this.band = opts.bandDeg;
  }

  get bandDeg(): number {
    return this.band;
  }

  /** The band for the next holds (engine.wideHoldBandDeg after two tries without a hold). */
  setBand(bandDeg: number): void {
    this.band = bandDeg;
  }

  /** A new attempt: the window, the furthest point and the latch start again (the band is kept). */
  reset(): void {
    this.buf = [];
    this.lastT = null;
    this.away = null;
    this.awayT = -Infinity;
    this.latched = false;
    this.progressNow = 0;
  }

  /** The next hold may fire once a whole window lies after `t` (the furthest point is kept). */
  rearm(t: number): void {
    this.latched = false;
    this.progressNow = 0;
    this.buf = this.buf.filter((s) => s.t >= t);
  }

  /** The excursion of a filtered angle from the furthest point so far, toward the end range. */
  excursion(f: number): number {
    return this.away === null ? 0 : this.opts.direction * (f - this.away);
  }

  /**
   * How far the angle is into a hold now, 0 to 1 in fifths of the hold window: the longest recent
   * stretch (a fifth, two fifths ... or the whole window) that is steady as a hold is (the band, the
   * trend, the excursion). A picture for the screen, and the runner's «during the hold».
   */
  get progress(): number {
    return this.progressNow;
  }

  /** The last hold's window: its level (the median filtered angle), the band it held in, its frames' own angles. */
  get window(): { level: number; band: number; raws: readonly number[] } | null {
    return this.lastWindow;
  }

  private lastWindow: { level: number; band: number; raws: number[] } | null = null;

  private progressNow = 0;

  /** Whether readings are steady as a hold: the band, the trend and a real movement (the level beyond the band). */
  private steady(xs: readonly Sample[]): {
    ok: boolean;
    level: number;
    excursionDeg: number;
    band: number;
  } {
    const fs = xs.map((s) => s.f);
    const level = median(fs)!;
    let band = this.band;
    const no = { ok: false, level, excursionDeg: 0, band };
    if (this.opts.around === "median") {
      // A small movement's top is held within a share of the movement (never under a movement's
      // moveDeg): the end of its rise is never most of a window that reads «steady» (D-035).
      band = Math.min(
        this.band,
        Math.max(this.opts.moveDeg ?? this.band, MVP_HOLD.bandShareOfExcursion * this.excursion(level)),
      );
      for (const f of fs) if (Math.abs(f - level) > band) return no;
      // The filtered angle lags the frames: the last third of the window's own angles (their median)
      // must still be at the level, so a movement that goes on is no top yet.
      const tail = xs.filter((x) => x.t >= xs[xs.length - 1].t - this.opts.holdMs / 3).map((x) => x.raw);
      if (Math.abs(median(tail)! - level) > band) return no;
    } else if (Math.max(...fs) - Math.min(...fs) > this.band) return no;
    const max = this.opts.maxSlopeDegPerSec;
    if (max !== null && max !== undefined && Math.abs(slopeOf(xs)) > max) return no;
    // The median reading (D-035): the angle came toward the end range before the window and stopped;
    // an angle still going away from it (its furthest point inside the window) is no top.
    if (this.opts.around === "median" && this.awayT >= xs[0].t) return no;
    const excursionDeg = this.excursion(level);
    const move = this.opts.moveDeg ?? this.band;
    if (excursionDeg <= move) return no;
    const start = this.opts.startDeg ?? null;
    if (
      excursionDeg < this.opts.minExcursionDeg &&
      start !== null &&
      this.opts.direction * (level - start) <= move
    )
      return no;
    // The median reading (D-035): a small hold is a small movement from the start pose. A level far
    // from it with a small excursion is an attempt that began away from the start pose (the arm still
    // up after the practice): no top of a movement yet.
    if (
      this.opts.around === "median" &&
      excursionDeg < this.opts.minExcursionDeg &&
      start !== null &&
      this.opts.direction * (level - start) >= this.opts.minExcursionDeg + move
    )
      return no;
    return { ok: true, level, excursionDeg, band };
  }

  private updateProgress(t: number): void {
    if (this.latched) {
      this.progressNow = 1;
      return;
    }
    let p = 0;
    for (const q of [0.2, 0.4, 0.6, 0.8, 1]) {
      const from = t - q * this.opts.holdMs;
      const xs = this.buf.filter((s) => s.t >= from);
      if (xs.length < 2 || xs[0].t > from + this.opts.holdMs * 0.1 || !this.steady(xs).ok) break;
      p = q;
    }
    this.progressNow = p;
  }

  /** One reading: the filtered and the raw angle of a frame. Returns the hold when one is found. */
  push(t: number, filtered: number, raw: number): HoldFound | null {
    if (!Number.isFinite(filtered) || !Number.isFinite(raw)) return null;
    if (this.lastT !== null && t - this.lastT > this.opts.maxGapMs) this.buf = [];
    this.lastT = t;
    const d = this.opts.direction;
    if (this.away === null || d * (filtered - this.away) < 0) {
      this.away = filtered;
      this.awayT = t;
    }
    this.buf.push({ t, f: filtered, raw });
    const keep = t - Math.max(this.opts.holdMs, this.opts.small?.holdMs ?? 0);
    while (this.buf.length > 1 && this.buf[1].t <= keep) this.buf.shift();
    this.updateProgress(t);
    const w = this.windowOf(t, this.opts.holdMs);
    if (this.latched || !w) return null;
    const { ok, level, excursionDeg, band } = this.steady(w);
    if (!ok) return null;
    const smallExcursion = excursionDeg < this.opts.minExcursionDeg;
    let win = w;
    if (smallExcursion && this.opts.small) {
      // A small hold: the protocol's steadiness over its own window.
      const sw = this.windowOf(t, this.opts.small.holdMs);
      if (!sw) return null;
      const fs = sw.map((x) => x.f);
      if (Math.max(...fs) - Math.min(...fs) > this.opts.small.bandDeg) return null;
      win = sw;
    }
    this.latched = true;
    this.progressNow = 1;
    this.lastWindow = { level, band, raws: win.map((x) => x.raw) };
    return {
      from: win[0].t,
      to: t,
      deg: holdValue(win.map((x) => x.raw))!,
      excursionDeg,
      bandDeg: this.band,
      smallExcursion,
    };
  }

  /** The readings of the last `ms` (from the last one at or before t - ms), or null while fewer are kept. */
  private windowOf(t: number, ms: number): Sample[] | null {
    const from = t - ms;
    let k = -1;
    for (let i = 0; i < this.buf.length && this.buf[i].t <= from; i++) k = i;
    return k < 0 ? null : this.buf.slice(k);
  }
}

/**
 * The plateau hint (PLATEAU_RULES): the filtered angle's central difference velocity under the limit
 * for the plateau seconds, the readings of those seconds within the hold band, after the movement left
 * the band around its furthest point. Fires once, then again only after the angle leaves the band
 * around the plateau.
 */
export class PlateauDetector {
  private buf: { t: number; f: number }[] = [];
  /** Times and velocities of the readings (the central difference lags one reading). */
  private vel: { t: number; v: number; f: number }[] = [];
  private away: number | null = null;
  private at: number | null = null;

  constructor(readonly opts: HoldOptions) {}

  reset(): void {
    this.buf = [];
    this.vel = [];
    this.away = null;
    this.at = null;
  }

  /** One filtered reading; returns the plateau angle when the plateau starts. */
  push(t: number, filtered: number): number | null {
    if (!Number.isFinite(filtered)) return null;
    const last = this.buf[this.buf.length - 1];
    if (last && t - last.t > this.opts.maxGapMs) {
      this.buf = [];
      this.vel = [];
    }
    const d = this.opts.direction;
    if (this.away === null || d * (filtered - this.away) < 0) this.away = filtered;
    if (this.at !== null && Math.abs(filtered - this.at) > this.opts.bandDeg) this.at = null;
    this.buf.push({ t, f: filtered });
    if (this.buf.length > 3) this.buf.shift();
    if (this.buf.length < 3) return null;
    const [a, b, c] = this.buf;
    this.vel.push({ t: b.t, v: (c.f - a.f) / ((c.t - a.t) / 1000), f: b.f });
    const from = b.t - PLATEAU_RULES.seconds * 1000;
    while (this.vel.length > 1 && this.vel[1].t <= from) this.vel.shift();
    if (this.at !== null || this.vel[0].t > from) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of this.vel) {
      if (Math.abs(s.v) >= PLATEAU_RULES.maxDegPerSec) return null;
      lo = Math.min(lo, s.f);
      hi = Math.max(hi, s.f);
    }
    if (hi - lo > this.opts.bandDeg) return null;
    if (d * (b.f - this.away) <= this.opts.bandDeg) return null;
    this.at = b.f;
    return b.f;
  }
}
