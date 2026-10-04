/**
 * The gait recorder (product v7 contract 2.8 GaitRecorder; section 9: push under 1 ms p95, under
 * 1 MB per 40 s view): a ring of typed arrays holding the x, y and visibility of the 33 landmarks,
 * the time and the aspect of each frame, at most `maxSec` seconds of frames (the oldest drop first).
 * Float32 coordinates (a ten millionth of the picture, far below a pixel); the ring grows by doubling
 * from 30 frames a second, so a 40 s view at 30 fps holds about 480 KB and at 60 fps about 1 MB.
 * Landmarks never leave the phone from here: `frames()` gives them to the analysis in memory. Pure,
 * no DOM.
 */
import type { GaitFrame } from "./types";

const LANDMARKS = 33;
const PER_FRAME = LANDMARKS * 3;
/** The ring's first size, in frames per second of maxSec (the requested camera rate, gait-rules capture). */
const START_FPS = 30;

export class GaitRecorder {
  private readonly maxMs: number;
  private cap: number;
  private head = 0;
  private count = 0;
  private t: Float64Array;
  private aspect: Float32Array;
  private lm: Float32Array;

  constructor(maxSec: number) {
    if (!(maxSec > 0)) throw new RangeError("GaitRecorder: maxSec must be above 0");
    this.maxMs = maxSec * 1000;
    this.cap = Math.max(2, Math.ceil(maxSec * START_FPS));
    this.t = new Float64Array(this.cap);
    this.aspect = new Float32Array(this.cap);
    this.lm = new Float32Array(this.cap * PER_FRAME);
  }

  /** Seconds between the oldest and the newest frame held. */
  get seconds(): number {
    if (this.count < 2) return 0;
    return (this.t[this.slot(this.count - 1)] - this.t[this.head]) / 1000;
  }

  private slot(i: number): number {
    return (this.head + i) % this.cap;
  }

  private grow(): void {
    const cap = this.cap * 2;
    const t = new Float64Array(cap);
    const aspect = new Float32Array(cap);
    const lm = new Float32Array(cap * PER_FRAME);
    for (let i = 0; i < this.count; i++) {
      const s = this.slot(i);
      t[i] = this.t[s];
      aspect[i] = this.aspect[s];
      lm.set(this.lm.subarray(s * PER_FRAME, (s + 1) * PER_FRAME), i * PER_FRAME);
    }
    this.t = t;
    this.aspect = aspect;
    this.lm = lm;
    this.cap = cap;
    this.head = 0;
  }

  /** Adds a frame; a frame whose time does not move forward is ignored. */
  push(f: GaitFrame): void {
    if (!Number.isFinite(f.t)) return;
    if (this.count && f.t <= this.t[this.slot(this.count - 1)]) return;
    while (this.count && f.t - this.t[this.head] > this.maxMs) {
      this.head = (this.head + 1) % this.cap;
      this.count--;
    }
    if (this.count === this.cap) this.grow();
    const s = this.slot(this.count);
    this.t[s] = f.t;
    this.aspect[s] = Number.isFinite(f.aspect) ? f.aspect : Number.NaN;
    const base = s * PER_FRAME;
    for (let i = 0; i < LANDMARKS; i++) {
      const q = f.lm[i];
      const o = base + i * 3;
      this.lm[o] = q && Number.isFinite(q.x) ? q.x : Number.NaN;
      this.lm[o + 1] = q && Number.isFinite(q.y) ? q.y : Number.NaN;
      this.lm[o + 2] = q && Number.isFinite(q.visibility) ? q.visibility : 0;
    }
    this.count++;
  }

  /** The frames held, oldest first (z is not kept and reads 0). */
  frames(): GaitFrame[] {
    const out: GaitFrame[] = [];
    for (let i = 0; i < this.count; i++) {
      const s = this.slot(i);
      const base = s * PER_FRAME;
      const lm = [];
      for (let j = 0; j < LANDMARKS; j++) {
        const o = base + j * 3;
        lm.push({ x: this.lm[o], y: this.lm[o + 1], z: 0, visibility: this.lm[o + 2] });
      }
      out.push({ t: this.t[s], lm, aspect: this.aspect[s] });
    }
    return out;
  }

  /** The bytes the ring holds now (for the memory budget). */
  get bytes(): number {
    return this.t.byteLength + this.aspect.byteLength + this.lm.byteLength;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
  }
}
