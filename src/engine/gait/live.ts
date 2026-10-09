/**
 * The live step counter (product v7 contract 2.8 LiveStepCounter; section 9: under 1 ms p95 per
 * frame): a light estimate for the screen and the coach, never stored and never a measurement.
 *
 *   - steps: peaks of the distance between the ankles, found on line with the analysis' peak rules
 *     (gait-rules events.side.peaks: at least 0.4 s apart, a prominence of 10% of the signal's range):
 *     across the picture in side views, the signed height difference (its size) in front views, where
 *     each contact is an extreme. The range is the last two turn margins' (about two strides), kept
 *     across passes, so the small sway of a turn in place is never a step; a front view counts no
 *     step while the shoulders are side on (a turn).
 *   - passes: walking runs, each counted at its first step; a run ends when the person leaves the
 *     picture for longer than the gap rule (0.12 s) or walks the other way (D-035 item 2): across the
 *     picture in overground side views, toward or away from the phone in front views (the body's
 *     size growing or shrinking in the picture), each read over the turn margin at GAIT_MVP's
 *     departSpeedMps or more (the camera model of passes.ts), so standing and turning in place never
 *     end a run. Nobody needs to leave the picture: walking to a phone against a wall, stopping or
 *     turning, and walking back counts as two passes.
 *   - facing: side when the shoulders are side on (VIEW_RATIO.sideMax of the engine), else toward the
 *     phone when a face landmark is visible and away otherwise; null without the hips and shoulders.
 * Pure, no DOM.
 */
import { VIEW_RATIO } from "../body";
import { CAMERA_MODEL } from "../quality";
import { GAIT_ENGINE, GAIT_MVP } from "./params";
import { focalLength } from "./passes";
import { faceVisible, pointOf, rollTurn } from "./preprocess";
import type { GaitFrame, GaitView } from "./types";

export type LiveFacing = "toward" | "away" | "side" | null;

const turn = rollTurn(null);

export class LiveStepCounter {
  private readonly front: boolean;
  private readonly overgroundSide: boolean;
  private readonly overgroundFront: boolean;
  private steps = 0;
  private passes = 0;
  private inPass = false;
  private lastSeen: number | null = null;
  private recent: { t: number; v: number }[] = [];
  private phase: "rise" | "fall" = "rise";
  private ext = -Infinity;
  private extT = 0;
  private lastPeakT = -Infinity;
  /** The mid hip's x and the trunk's length in the picture over the last turn margin. */
  private hips: { t: number; x: number; size: number }[] = [];
  private dir = 0;
  /** A new direction seen, and since when (it must hold before the run ends). */
  private turning: { dir: number; since: number } | null = null;

  constructor(view: GaitView) {
    this.front = view === "front" || view === "back" || view === "pad_front";
    this.overgroundSide = view === "side";
    this.overgroundFront = view === "front" || view === "back";
  }

  private endPass(): void {
    this.inPass = false;
    this.phase = "rise";
    this.ext = -Infinity;
    this.dir = 0;
    this.turning = null;
  }

  private facingOf(f: GaitFrame): LiveFacing {
    const ls = pointOf(f, 11, turn);
    const rs = pointOf(f, 12, turn);
    const lh = pointOf(f, 23, turn);
    const rh = pointOf(f, 24, turn);
    if (!ls || !rs || !lh || !rh) return null;
    const trunk = Math.hypot((ls[0] + rs[0] - lh[0] - rh[0]) / 2, (ls[1] + rs[1] - lh[1] - rh[1]) / 2);
    if (!(trunk > 0)) return null;
    const ratio = Math.hypot(ls[0] - rs[0], ls[1] - rs[1]) / trunk;
    if (ratio <= VIEW_RATIO.sideMax) return "side";
    return faceVisible(f) ? "toward" : "away";
  }

  /**
   * The walking direction over the last turn margin: across the picture (side views) or in depth
   * (front views), +1 or -1, or 0 below the departure speed (standing, turning, too soon to tell). The
   * motion is the least squares slope over the window, so one noisy frame never turns it.
   */
  private direction(f: GaitFrame, x: number, size: number): number {
    if (!(size > 0)) return 0;
    this.hips.push({ t: f.t, x, size });
    while (this.hips.length > 1 && f.t - this.hips[0].t > GAIT_ENGINE.turnMarginSec * 1000) this.hips.shift();
    const n = this.hips.length;
    if (n < 3 || (f.t - this.hips[0].t) / 1000 < GAIT_ENGINE.turnMarginSec / 2) return 0;
    let mt = 0;
    let mv = 0;
    let ms = 0;
    for (const h of this.hips) {
      mt += h.t / n;
      mv += (this.front ? h.size : h.x) / n;
      ms += h.size / n;
    }
    let num = 0;
    let den = 0;
    for (const h of this.hips) {
      num += (h.t - mt) * ((this.front ? h.size : h.x) - mv);
      den += (h.t - mt) ** 2;
    }
    if (!(den > 0)) return 0;
    const slope = (num / den) * 1000;
    // Metres a second from the camera model: across, the picture motion over the trunk's size; in
    // depth, the size's change (D' = -f·L·s' ÷ s², passes.ts).
    const L = CAMERA_MODEL.nominalTrunkM;
    const speed = this.front ? (focalLength(f.aspect) * L * slope) / (ms * ms) : slope * (L / ms);
    return speed >= GAIT_MVP.departSpeedMps ? 1 : speed <= -GAIT_MVP.departSpeedMps ? -1 : 0;
  }

  feed(f: GaitFrame): { steps: number; passes: number; facing: LiveFacing } {
    const facing = this.facingOf(f);
    const la = pointOf(f, 27, turn);
    const ra = pointOf(f, 28, turn);
    const lh = pointOf(f, 23, turn);
    const rh = pointOf(f, 24, turn);
    if (!la || !ra || !lh || !rh) {
      if (this.lastSeen !== null && f.t - this.lastSeen > GAIT_ENGINE.maxGapSec * 1000) this.endPass();
      return { steps: this.steps, passes: this.passes, facing };
    }
    this.lastSeen = f.t;

    if (this.overgroundSide || this.overgroundFront) {
      const ls = pointOf(f, 11, turn);
      const rs = pointOf(f, 12, turn);
      const size =
        ls && rs
          ? Math.hypot((ls[0] + rs[0] - lh[0] - rh[0]) / 2, (ls[1] + rs[1] - lh[1] - rh[1]) / 2)
          : Number.NaN;
      // A new direction ends the run once it has held for half the turn margin.
      const dir = this.direction(f, (lh[0] + rh[0]) / 2, size);
      if (dir !== 0 && this.dir === 0) this.dir = dir;
      else if (dir !== 0 && dir !== this.dir) {
        if (this.turning?.dir !== dir) this.turning = { dir, since: f.t };
        else if (f.t - this.turning.since >= (GAIT_ENGINE.turnMarginSec * 1000) / 2) {
          this.endPass();
          this.dir = dir;
        }
      } else if (dir === this.dir) this.turning = null;
    }

    const v = this.front ? Math.abs(la[1] - ra[1]) : Math.abs(la[0] - ra[0]);
    this.recent.push({ t: f.t, v });
    while (this.recent.length > 1 && f.t - this.recent[0].t > 2 * GAIT_ENGINE.turnMarginSec * 1000)
      this.recent.shift();
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of this.recent) {
      lo = Math.min(lo, r.v);
      hi = Math.max(hi, r.v);
    }
    const prominence = GAIT_ENGINE.peakProminenceShare * (hi - lo);
    if (!(prominence > 0) || (this.front && facing === "side"))
      return { steps: this.steps, passes: this.passes, facing };
    if (this.phase === "rise") {
      if (v > this.ext) {
        this.ext = v;
        this.extT = f.t;
      } else if (this.ext - v >= prominence) {
        if (this.extT - this.lastPeakT >= GAIT_ENGINE.peakDistanceSec * 1000) {
          this.steps++;
          this.lastPeakT = this.extT;
          if (!this.inPass) {
            this.inPass = true;
            this.passes++;
          }
        }
        this.phase = "fall";
        this.ext = v;
      }
    } else if (v < this.ext) this.ext = v;
    else if (v - this.ext >= prominence) {
      this.phase = "rise";
      this.ext = v;
      this.extT = f.t;
    }
    return { steps: this.steps, passes: this.passes, facing };
  }
}
