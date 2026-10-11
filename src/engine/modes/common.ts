/**
 * Helpers shared by the movement check runners (rangeTest.ts, trunkControl.ts). Pure TS, no DOM.
 */
import type { CheckCueId } from "../../movements/types";
import type { Pt } from "../body";
import { toPixelSpace } from "../geometry";
import { posesOf, SubjectLock, type SubjectPick } from "../subject";
import { Frame, Landmark, LM } from "../types";
import type { BodySide, TestEvent } from "./types";

export const DEG = 180 / Math.PI;

export const otherSide = (s: BodySide): BodySide => (s === "left" ? "right" : "left");

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Population standard deviation (0 for fewer than 2 values). */
export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/**
 * O35: calibration with tremor or dyskinesia (arm raise, arm curl, chair stand). A calibration runs
 * in rounds of roundSec. After widenAfterSec without a still window the stillness tolerance doubles
 * (a calibration passed with it is a normal calibration; the reference is still the median over the
 * window). At the end of a round with another one left the runner asks (ask "calibration"): the
 * stage offers «سأحاول مرة أخرى» (retryCalibration) or skip; at the end of the last round the test is
 * not measured today (quality). No attempt is ever scored without a passed calibration.
 */
// SPEC-GAP: calibration-tolerance-scale. O35 (1) scales the tolerance with shoulder width: the arm
// raise and arm curl tolerances are angles (free of scale) and the chair stand's is in seated trunk
// lengths, so each already follows the body's size. The side lean keeps spec 4.3's own upright
// search (the lowest SD window after 10 s, flagged), which never needs the offer.
export const CALIBRATION_ROUNDS = {
  widenAfterSec: 10,
  widenFactor: 2,
  roundSec: 20,
  maxRounds: 2,
} as const;

/** The rounds of one calibration (O35): the tolerance now, and what is due at the end of a round. */
export class CalibrationRounds {
  private started = 0;
  private roundStart = 0;
  private roundNow = 1;

  /** A new calibration (the first, or one taken again): round 1, the default tolerance. */
  begin(t: number): void {
    this.started = t;
    this.roundStart = t;
    this.roundNow = 1;
  }

  /** The person chose «سأحاول مرة أخرى»: the next round (the tolerance stays widened). */
  retry(t: number): void {
    this.roundStart = t;
    this.roundNow += 1;
  }

  get round(): number {
    return this.roundNow;
  }

  /** The stillness tolerance at t: the default, doubled after widenAfterSec without a still window. */
  tolerance(base: number, t: number): number {
    const R = CALIBRATION_ROUNDS;
    return t - this.started >= R.widenAfterSec * 1000 ? base * R.widenFactor : base;
  }

  /** "offer" at the end of a round with another left, "give_up" at the end of the last, else null. */
  due(t: number): "offer" | "give_up" | null {
    const R = CALIBRATION_ROUNDS;
    if (t - this.roundStart < R.roundSec * 1000) return null;
    return this.roundNow < R.maxRounds ? "offer" : "give_up";
  }
}

export const round1 = (x: number) => Math.round(x * 10) / 10;
export const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** The landmarks of one of the person's sides. */
export interface SideLandmarks {
  shoulder: number;
  elbow: number;
  wrist: number;
  hip: number;
  ear: number;
  knee: number;
  /** Wrist and the coarse hand points (pinky, index, thumb). */
  hand: number[];
}

const LEFT: SideLandmarks = {
  shoulder: LM.l_shoulder,
  elbow: LM.l_elbow,
  wrist: LM.l_wrist,
  hip: LM.l_hip,
  ear: LM.l_ear,
  knee: LM.l_knee,
  hand: [LM.l_wrist, 17, 19, 21],
};
const RIGHT: SideLandmarks = {
  shoulder: LM.r_shoulder,
  elbow: LM.r_elbow,
  wrist: LM.r_wrist,
  hip: LM.r_hip,
  ear: LM.r_ear,
  knee: LM.r_knee,
  hand: [LM.r_wrist, 18, 20, 22],
};

/**
 * The model's landmark labels for the person's own side. MediaPipe labels the person's own left
 * and right (spec 4.0). In a mirrored picture the person's left looks like a right side to the
 * model, so the labels swap.
 */
export function sideLandmarks(side: BodySide, mirrored = false): SideLandmarks {
  const left = side === "left" ? !mirrored : mirrored;
  return left ? LEFT : RIGHT;
}

/** Downward vertical in the pixel space picture for a picture roll (FeedEnv.rollDeg). */
export function downVector(rollDeg: number): Pt {
  const r = rollDeg / DEG;
  return { x: -Math.sin(r), y: Math.cos(r) };
}

/** Horizontal of the picture (toward the image right when level) for a picture roll. */
export function acrossVector(rollDeg: number): Pt {
  const r = rollDeg / DEG;
  return { x: Math.cos(r), y: Math.sin(r) };
}

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
export const norm = (a: Pt) => Math.hypot(a.x, a.y);

/** Signed angle from `from` to `to`, degrees in (−180, 180], positive toward `toward` (a side of `from`). */
export function signedAngle(from: Pt, to: Pt, toward: Pt): number {
  const s = Math.sign(cross(from, toward)) || 1;
  return Math.atan2(cross(from, to), dot(from, to)) * DEG * s;
}

/** Angle ABC in degrees (180 straight). */
export function jointAngle(a: Pt, b: Pt, c: Pt): number {
  const u = sub(a, b);
  const v = sub(c, b);
  const m = norm(u) * norm(v);
  if (m < 1e-9) return 180;
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / m))) * DEG;
}

/**
 * Angle of the line from `base` to `top` from the image vertical, degrees, positive when `top`
 * is to the image right of `base`, corrected by the picture roll.
 */
export function leanFromVertical(base: Pt, top: Pt, rollDeg: number): number {
  let d = Math.atan2(top.x - base.x, base.y - top.y) * DEG - rollDeg;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * "The highest value held for at least the hold time": the maximum over time of the rolling
 * window minimum (architecture section 4, spec 4.1 and 4.3).
 *
 * The window at time t holds every sample from the last one at or before t − hold up to t, so a
 * value counts only when samples spanning the whole hold time are all at or above it. A spike
 * shorter than the hold time never fills a window. A gap (a paused or unseen frame, or more than
 * `maxGapMs` between frames) starts the window again.
 */
export class SustainedPeak {
  private buf: { t: number; v: number }[] = [];
  private last: number | null = null;
  /** Best window minimum so far, the time its window ended and the time its window began. */
  best: { value: number; t: number; from: number } | null = null;

  constructor(
    readonly holdMs: number,
    readonly maxGapMs = 250,
  ) {}

  /**
   * Adds a sample; returns the current window minimum, or null while the window is not full. A
   * sample that is not a finite number is a gap (it never holds a window, and never becomes the
   * best).
   */
  push(t: number, v: number): number | null {
    if (!Number.isFinite(v)) {
      this.gap();
      return null;
    }
    if (this.last !== null && t - this.last > this.maxGapMs) this.gap();
    this.last = t;
    this.buf.push({ t, v });
    const from = t - this.holdMs;
    while (this.buf.length > 1 && this.buf[1].t <= from) this.buf.shift();
    if (this.buf[0].t > from) return null;
    let m = Infinity;
    for (const s of this.buf) m = Math.min(m, s.v);
    if (!this.best || m > this.best.value) this.best = { value: m, t, from: this.buf[0].t };
    return m;
  }

  /** The window starts again (the best so far is kept). */
  gap(): void {
    this.buf = [];
    this.last = null;
  }
}

/**
 * Running median of the samples in the last `windowMs` (a rank filter). Unlike a smoothing filter
 * it never stretches how long a value is held: a plateau keeps its length (only delayed by about
 * half the window) and a blip shorter than about half the window disappears, so the sustained peak
 * rule still means "held for 0.5 s" after it. It reduces landmark jitter, which would otherwise
 * pull the rolling window minimum below the true held value.
 */
export class RunningMedian {
  private buf: { t: number; v: number }[] = [];

  constructor(readonly windowMs: number) {}

  push(t: number, v: number): number {
    this.buf.push({ t, v });
    while (this.buf.length > 1 && this.buf[0].t <= t - this.windowMs) this.buf.shift();
    // An odd count (the latest samples), so the output is always one of the samples: an average of
    // the two middle ones could stretch a pulse edge by a frame.
    const from = this.buf.length % 2 ? 0 : 1;
    const xs = this.buf.slice(from).map((s) => s.v);
    return median(xs)!;
  }

  reset(): void {
    this.buf = [];
  }
}

/**
 * A per frame condition that counts only once it has held for `sec` (rejects single frame
 * landmark glitches). `update` returns true while it has held long enough.
 */
export class Persist {
  private since: number | null = null;
  /** The condition has held long enough at least once. */
  hit = false;

  constructor(readonly sec: number) {}

  update(t: number, on: boolean): boolean {
    if (!on) {
      this.since = null;
      return false;
    }
    if (this.since === null) this.since = t;
    const held = t - this.since >= this.sec * 1000;
    if (held) this.hit = true;
    return held;
  }

  reset(): void {
    this.since = null;
    this.hit = false;
  }
}

/** What the tracker gives for one frame. */
export interface Tracked {
  pick: SubjectPick;
  /** The subject's landmarks in pixel space (x scaled by the aspect, D-003), or null when not scored. */
  px: Landmark[] | null;
  /** The subject's raw landmarks as the model gave them (normalized), or null. */
  raw: Landmark[] | null;
  aspect: number | undefined;
}

/**
 * The subject lock for a runner: picks the subject among the frame's poses. The landmarks are not
 * smoothed: a smoothing filter lags and would stretch a short spike past the 0.5 s hold, so the
 * runners filter their measures with RunningMedian instead.
 */
export class SubjectTracker {
  constructor(readonly lock: SubjectLock) {}

  /** Locks on the person nearest the centre; false when nobody is in the frame. */
  lockOn(frame: Frame): boolean {
    return this.lock.lock(posesOf(frame), frame.aspect, frame.t, frame.looks);
  }

  track(frame: Frame): Tracked {
    const pick = this.lock.pickFrame(frame);
    if (!pick.lm || pick.paused) return { pick, px: null, raw: pick.lm, aspect: frame.aspect };
    return { pick, px: toPixelSpace(pick.lm, frame.aspect), raw: pick.lm, aspect: frame.aspect };
  }
}

/** Collects the events of one call. */
export class EventSink {
  readonly events: TestEvent[] = [];
  private said = new Map<string, number>();

  push(e: TestEvent): void {
    this.events.push(e);
  }

  cue(cue: CheckCueId, t: number): void {
    this.events.push({ kind: "cue", cue, t });
    this.said.set(cue, t);
  }

  /** A cue at most once per `everySec` (the one person cue while a helper stays in the way). */
  cueEvery(cue: CheckCueId, t: number, everySec: number): void {
    const last = this.said.get(cue);
    if (last === undefined || t - last >= everySec * 1000) this.cue(cue, t);
  }

  drain(): TestEvent[] {
    return this.events.splice(0, this.events.length);
  }
}

/** Visible at the test's minimum, with finite coordinates (a NaN point is never seen). */
export const seen = (p: Landmark[] | null, i: number, min: number): boolean =>
  !!p && Number.isFinite(p[i]?.x) && Number.isFinite(p[i]?.y) && (p[i]?.visibility ?? 0) >= min;

/** Inside the picture (normalized landmarks). */
export const inPicture = (q: Landmark | undefined): boolean =>
  !!q && q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1;
