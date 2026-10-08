/**
 * The smoke page's own reading of a range video (product v7 contract 8.4, stream G, step G1): A's
 * movement angle (src/engine/rom/angles.ts MOVEMENT_ANGLES) on every frame of the subject, after the
 * start pose calibration (angles.ts calibrate, over the movement's calibration seconds from the lock),
 * and the held end angle: the highest median over one second of frames (the lowest for a lack
 * movement).
 *
 * It shows what the real model and the angle maths read on the video, whether or not B's runner is
 * built; the runner's recorded value is the one the pass bar compares with the truth. A harness
 * reading, not a clinical rule: it decides nothing in the app. Pure, no DOM.
 */
import { posesOf, SUBJECT_RULES, SubjectLock } from "../../engine/subject";
import { toPixelSpace } from "../../engine/geometry";
import { calibrate, MOVEMENT_ANGLES, type RomCalibration } from "../../engine/rom/angles";
import { movementDef } from "../../movements/rom";
import type { RomMovementId, RomSide } from "../../movements/rom/types";
import type { Frame, Landmark } from "../../engine/types";

/** The median of a list (the mean of the two middle values for an even count); null when empty. */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * The highest (or lowest) median of the samples in any window [t - windowMs, t] whose samples span at
 * least 80 percent of the window, with the end time of the first such window; null when no window
 * qualifies.
 */
export function rollingHold(
  series: readonly { t: number; deg: number }[],
  windowMs: number,
  pick: "max" | "min",
): { deg: number; t: number } | null {
  let best: { deg: number; t: number } | null = null;
  let from = 0;
  for (let i = 0; i < series.length; i++) {
    const end = series[i].t;
    while (series[from].t < end - windowMs) from++;
    if (end - series[from].t < 0.8 * windowMs) continue;
    const m = median(series.slice(from, i + 1).map((s) => s.deg))!;
    if (!best || (pick === "max" ? m > best.deg : m < best.deg)) best = { deg: m, t: end };
  }
  return best;
}

export interface RomTraceOptions {
  movement: RomMovementId;
  side: RomSide;
  mirrored: boolean;
  /** Seconds of frames from the lock for the start calibration; default the movement's, else 1. */
  calibrationSec?: number;
  /** The hold window, seconds (default 1). */
  windowSec?: number;
}

export interface RomTraceSummary {
  frames: number;
  /** Frames with the subject picked (SubjectLock). */
  subjectFrames: number;
  /** Frames with an angle (the gate landmarks seen) after the calibration. */
  angleFrames: number;
  /** Share of frames with the subject; null before any frame. */
  seenShare: number | null;
  calibrated: boolean;
  gravityMode: boolean | null;
  /** The start pose angle of the calibration, to 0.1 degree. */
  startDeg: number | null;
  /** The held end angle, to 0.1 degree. */
  holdDeg: number | null;
  /** When the hold window ended, ms from the first frame. */
  holdAt: number | null;
  /** The angle about every 200 ms: [ms from the first frame, degrees to 0.1]. */
  series: [number, number][];
}

const tenth = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

export class RomAngleTrace {
  /** The range runner's own lock (the body anchor, D-034 item 1), so the page follows whom the runner follows. */
  private readonly lock = new SubjectLock(SUBJECT_RULES, { anchor: "body" });
  private readonly calMs: number;
  private readonly windowMs: number;
  private readonly pick: "max" | "min";
  private t0: number | null = null;
  private calStart: number | null = null;
  private calFrames: { px: Landmark[] }[] = [];
  private cal: RomCalibration | null = null;
  private readonly samples: { t: number; deg: number }[] = [];
  private frames = 0;
  private subjectFrames = 0;

  constructor(private readonly opts: RomTraceOptions) {
    const def = movementDef(opts.movement);
    this.calMs = 1000 * (opts.calibrationSec ?? def.calibrationSeconds ?? 1);
    this.windowMs = 1000 * (opts.windowSec ?? 1);
    this.pick = def.kind === "lack" ? "min" : "max";
  }

  push(frame: Frame): void {
    this.frames++;
    if (this.t0 === null) this.t0 = frame.t;
    if (!this.lock.locked) {
      const poses = posesOf(frame);
      if (!poses.length || !this.lock.lock(poses, frame.aspect)) return;
    }
    const picked = this.lock.pickFrame(frame);
    if (!picked.lm) return;
    this.subjectFrames++;
    const px = toPixelSpace(picked.lm, frame.aspect);
    const ctx = { side: this.opts.side, mirrored: this.opts.mirrored, rollDeg: null };
    if (!this.cal) {
      if (this.calStart === null) this.calStart = frame.t;
      this.calFrames.push({ px });
      if (frame.t - this.calStart >= this.calMs) {
        this.cal = calibrate(this.opts.movement, this.calFrames, ctx);
        // No calibration from this window (the gate unseen): the next window tries again.
        if (!this.cal) {
          this.calFrames = [];
          this.calStart = null;
        }
      }
      return;
    }
    const deg = MOVEMENT_ANGLES[this.opts.movement](px, { ...ctx, calibration: this.cal });
    if (deg !== null) this.samples.push({ t: frame.t - this.t0, deg });
  }

  summary(): RomTraceSummary {
    const hold = rollingHold(this.samples, this.windowMs, this.pick);
    const series: [number, number][] = [];
    let next = -Infinity;
    for (const s of this.samples)
      if (s.t >= next) {
        series.push([Math.round(s.t), tenth(s.deg)!]);
        next = s.t + 200;
      }
    return {
      frames: this.frames,
      subjectFrames: this.subjectFrames,
      angleFrames: this.samples.length,
      seenShare: this.frames ? Math.round((1000 * this.subjectFrames) / this.frames) / 1000 : null,
      calibrated: this.cal !== null,
      gravityMode: this.cal ? this.cal.gravityMode : null,
      startDeg: tenth(this.cal?.startDeg ?? null),
      holdDeg: tenth(hold?.deg ?? null),
      holdAt: hold ? Math.round(hold.t) : null,
      series,
    };
  }
}
