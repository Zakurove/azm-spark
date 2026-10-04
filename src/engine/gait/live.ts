/**
 * The live step counter (product v7 contract 2.8 LiveStepCounter; section 9: under 1 ms p95 per
 * frame): a light estimate for the screen and the coach, never stored and never a measurement.
 *
 *   - steps: peaks of the distance between the ankles, found on line with the analysis' peak rules
 *     (gait-rules events.side.peaks: at least 0.4 s apart, a prominence of 10% of the signal's range in
 *     the pass): across the picture in side views, the signed height difference (its size) in front
 *     views, where each contact is an extreme.
 *   - passes: walking runs, each counted at its first step; a run ends when the person leaves the
 *     picture for longer than the gap rule (0.12 s), turns to face the other way (front views), or
 *     reverses across the picture over the turn margin (overground side views).
 *   - facing: side when the shoulders are side on (VIEW_RATIO.sideMax of the engine), else toward the
 *     phone when a face landmark is visible and away otherwise; null without the hips and shoulders.
 * Pure, no DOM.
 */
import { VIEW_RATIO } from "../body";
import { GAIT_ENGINE } from "./params";
import { faceVisible, pointOf, rollTurn } from "./preprocess";
import type { GaitFrame, GaitView } from "./types";

export type LiveFacing = "toward" | "away" | "side" | null;

const turn = rollTurn(null);

export class LiveStepCounter {
  private readonly front: boolean;
  private readonly overgroundSide: boolean;
  private steps = 0;
  private passes = 0;
  private inPass = false;
  private lastSeen: number | null = null;
  private lastFacing: "toward" | "away" | null = null;
  private lo = Infinity;
  private hi = -Infinity;
  private phase: "rise" | "fall" = "rise";
  private ext = -Infinity;
  private extT = 0;
  private lastPeakT = -Infinity;
  private hips: { t: number; x: number }[] = [];
  private dir = 0;

  constructor(view: GaitView) {
    this.front = view === "front" || view === "back" || view === "pad_front";
    this.overgroundSide = view === "side";
  }

  private endPass(): void {
    this.inPass = false;
    this.lo = Infinity;
    this.hi = -Infinity;
    this.phase = "rise";
    this.ext = -Infinity;
    this.dir = 0;
    this.hips = [];
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

    if (this.front && (facing === "toward" || facing === "away")) {
      if (this.lastFacing && facing !== this.lastFacing) this.endPass();
      this.lastFacing = facing;
    }
    if (this.overgroundSide) {
      const x = (lh[0] + rh[0]) / 2;
      this.hips.push({ t: f.t, x });
      while (this.hips.length > 1 && f.t - this.hips[0].t > GAIT_ENGINE.turnMarginSec * 1000)
        this.hips.shift();
      const moved = x - this.hips[0].x;
      const dir = Math.sign(moved);
      if (dir !== 0 && f.t - this.hips[0].t >= (GAIT_ENGINE.turnMarginSec * 1000) / 2) {
        if (this.dir !== 0 && dir !== this.dir) this.endPass();
        this.dir = dir;
      }
    }

    const v = this.front ? Math.abs(la[1] - ra[1]) : Math.abs(la[0] - ra[0]);
    this.lo = Math.min(this.lo, v);
    this.hi = Math.max(this.hi, v);
    const prominence = GAIT_ENGINE.peakProminenceShare * (this.hi - this.lo);
    if (!(prominence > 0)) return { steps: this.steps, passes: this.passes, facing };
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
