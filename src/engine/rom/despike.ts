/**
 * Single frame landmark jumps before the dial's One Euro filter (D-034 item 1: on Nasser's iPhone the
 * angle jumped to 180 and stopped). A pose model now and then puts one landmark somewhere else for a
 * frame (a wrist on the shoulder, the nose behind the head, which flips the arm raise's face side), and
 * the One Euro filter (oneEuro.ts, tuned for low lag) lets a large share of such a jump through, since
 * its speed term opens it up. Two readings from the engine smoothing of the clinical data
 * (engine.smoothing: «Live dial: existing One Euro filter. Recorded value: Hampel filter, then the
 * median of the hold window»), each adding no clinical number:
 *   - visibility: a landmark the model does not see in a frame (under the movement's visibility
 *     minimum) keeps its last seen place, so a guess never moves the dial;
 *   - a median of three frames per coordinate (the smallest median that removes a one frame jump, one
 *     frame of lag): a jump that lasts one frame never reaches the filter.
 * Frames further apart than the hold's gap (HOLD_RULES.maxGapMs, v1's 250 ms) start again. Pure, no DOM.
 */
import type { Landmark } from "../types";
import { HOLD_RULES } from "./hold";

const med3 = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

export class PoseDespiker {
  /** The last three frames' landmarks, unseen ones held at their last seen place (oldest first). */
  private buf: Landmark[][] = [];
  private lastT: number | null = null;

  constructor(
    readonly minVisibility: number,
    readonly maxGapMs: number = HOLD_RULES.maxGapMs,
  ) {}

  reset(): void {
    this.buf = [];
    this.lastT = null;
  }

  /** One frame's landmarks (normalized, the subject's), at `t` ms; returns them without one frame jumps. */
  push(lm: Landmark[], t: number): Landmark[] {
    if (this.lastT !== null && t - this.lastT > this.maxGapMs) this.buf = [];
    this.lastT = t;
    const prev = this.buf[this.buf.length - 1];
    const held = lm.map((q, i) =>
      prev && !(Number.isFinite(q.x) && Number.isFinite(q.y) && (q.visibility ?? 0) >= this.minVisibility)
        ? { ...q, x: prev[i].x, y: prev[i].y }
        : q,
    );
    this.buf.push(held);
    if (this.buf.length > 3) this.buf.shift();
    if (this.buf.length < 3) return held;
    const [a, b, c] = this.buf;
    return held.map((q, i) => ({ ...q, x: med3(a[i].x, b[i].x, c[i].x), y: med3(a[i].y, b[i].y, c[i].y) }));
  }
}
