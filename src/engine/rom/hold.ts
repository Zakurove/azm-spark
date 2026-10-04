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
 * minExcursionDeg, smoothing.hampel). The filtered angle is the live dial's One Euro output
 * (engine.smoothing: «Live dial: existing One Euro filter. Recorded value: Hampel filter (window 7,
 * n sigma 2), then the median of the hold window»).
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
 *   - After a hold fires the detector waits; `rearm(t)` (after «ليس بعد», or an unconfirmed small hold)
 *     lets the next hold fire once a whole window lies after t, at any angle: a person who cannot go
 *     further after «ليس بعد» is asked again, and the runner keeps the further value.
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
 * (contract 6.1). The band is engine.holdBandDeg. Only a hint: the maximum question waits for the hold
 * (P1_AT "hold", live-spike 11).
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
  bandDeg: number;
  holdMs: number;
  minExcursionDeg: number;
  maxGapMs: number;
}

/** The hold options of a movement kind, from ROM_DATA.engine. */
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
  /** The One Euro filtered angle. */
  f: number;
  /** The angle of the frame, unfiltered. */
  raw: number;
}

export class HoldDetector {
  private buf: Sample[] = [];
  private lastT: number | null = null;
  /** The filtered angle furthest from the end range in this attempt. */
  private away: number | null = null;
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
    this.latched = false;
  }

  /** The next hold may fire once a whole window lies after `t` (the furthest point is kept). */
  rearm(t: number): void {
    this.latched = false;
    this.buf = this.buf.filter((s) => s.t >= t);
  }

  /** The excursion of a filtered angle from the furthest point so far, toward the end range. */
  excursion(f: number): number {
    return this.away === null ? 0 : this.opts.direction * (f - this.away);
  }

  /** One reading: the filtered and the raw angle of a frame. Returns the hold when one is found. */
  push(t: number, filtered: number, raw: number): HoldFound | null {
    if (!Number.isFinite(filtered) || !Number.isFinite(raw)) return null;
    if (this.lastT !== null && t - this.lastT > this.opts.maxGapMs) this.buf = [];
    this.lastT = t;
    const d = this.opts.direction;
    if (this.away === null || d * (filtered - this.away) < 0) this.away = filtered;
    this.buf.push({ t, f: filtered, raw });
    const from = t - this.opts.holdMs;
    while (this.buf.length > 1 && this.buf[1].t <= from) this.buf.shift();
    if (this.latched || this.buf[0].t > from) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of this.buf) {
      lo = Math.min(lo, s.f);
      hi = Math.max(hi, s.f);
    }
    if (hi - lo > this.band) return null;
    const level = median(this.buf.map((s) => s.f))!;
    const excursionDeg = this.excursion(level);
    if (excursionDeg <= this.band) return null;
    const start = this.opts.startDeg ?? null;
    if (
      excursionDeg < this.opts.minExcursionDeg &&
      start !== null &&
      this.opts.direction * (level - start) <= this.band
    )
      return null;
    this.latched = true;
    return {
      from: this.buf[0].t,
      to: t,
      deg: holdValue(this.buf.map((s) => s.raw))!,
      excursionDeg,
      bandDeg: this.band,
      smallExcursion: excursionDeg < this.opts.minExcursionDeg,
    };
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
