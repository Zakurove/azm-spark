/**
 * The optional check in of the movement check (Nasser's decision D-016; stopRouting.checkIn). Pure TS,
 * no DOM.
 *
 * It runs only when the person switched it on (a per device setting, never at the booth). During a
 * camera test it asks «هل أنت بخير؟» when the person leaves the picture for 5 s, or does not move for
 * 10 s; the camera screen's arming (camera/arming.ts) says which parts of a test count. These are
 * prompts to ask, never a fall detector (spec 4.3). Detectors measure in pixel space.
 */
import { CHECK_DATA } from "../movements/assessments";
import { isPerson, type Pt, trunkPx, visible } from "./body";
import { toPixelSpace } from "./geometry";
import { type Landmark, LM } from "./types";

const checkIn = CHECK_DATA.stopRouting.checkIn;

/** The numbers of the check in, from the data. */
export const CHECKIN_TIMING = {
  /** Out of the picture this long during a test. */
  leftFrameSec: checkIn.leftFrameSec,
  /** No movement this long during a test. */
  noMovementSec: checkIn.noMovementSec,
  /** No answer this long: one gentle chime, and the screen stays. */
  noAnswerSec: checkIn.noAnswerSec,
} as const;

/**
 * Still means every visible key point stays within this many trunk lengths (about 5 cm) over the
 * window, measured on averages over `binSec`, so model jitter is not movement.
 */
export const STILL = { trunks: 0.1, binSec: 0.5 } as const;

export type CheckInTrigger = "left_frame" | "no_movement";

export interface CheckInFeedOptions {
  /** Evaluate the no movement rule in this frame (default true). */
  movement?: boolean;
  /** Evaluate the left frame rule in this frame (default true). */
  leftFrame?: boolean;
}

const KEY_POINTS = [LM.nose, 11, 12, 13, 14, 15, 16, 23, 24];

type Track = { t: number; pts: (Pt | null)[] }[];

/**
 * Detects the two triggers frame by frame. `feed` returns the triggers that START in this frame: each
 * fires once, and again only after its condition has cleared (the person seen again, or a movement).
 */
export class CheckInDetector {
  private outSince: number | null = null;
  private active = new Set<CheckInTrigger>();
  private track: Track = [];

  reset(): void {
    this.outSince = null;
    this.active.clear();
    this.track = [];
  }

  /**
   * One frame: the subject's landmarks (null when the subject lock has no trusted subject), time in
   * ms and the frame's aspect ratio.
   */
  feed(t: number, lm: Landmark[] | null, aspect?: number, opts: CheckInFeedOptions = {}): CheckInTrigger[] {
    const out: CheckInTrigger[] = [];
    const seen = shouldersInView(lm);

    if (seen || opts.leftFrame === false) {
      this.outSince = null;
      if (seen) this.active.delete("left_frame");
    } else {
      this.outSince ??= t;
      if (!this.active.has("left_frame") && t - this.outSince >= CHECKIN_TIMING.leftFrameSec * 1000) {
        this.active.add("left_frame");
        out.push("left_frame");
      }
    }

    if (!seen || opts.movement === false) {
      this.track = [];
      this.active.delete("no_movement");
      return out;
    }
    const p = toPixelSpace(lm, aspect);
    this.track.push({ t, pts: KEY_POINTS.map((i) => (visible(p, i) ? { x: p[i].x, y: p[i].y } : null)) });
    const still = stillOver(
      this.track,
      t,
      CHECKIN_TIMING.noMovementSec * 1000,
      STILL.binSec * 1000,
      STILL.trunks * trunkPx(p),
    );
    if (still && !this.active.has("no_movement")) {
      this.active.add("no_movement");
      out.push("no_movement");
    } else if (!still) this.active.delete("no_movement");
    return out;
  }
}

/**
 * True when `track` covers the last `windowMs` and no key point moved beyond `limit` (pixel space),
 * measured on `binMs` averages. Drops entries older than the window.
 */
function stillOver(track: Track, now: number, windowMs: number, binMs: number, limit: number): boolean {
  while (track.length > 1 && track[1].t <= now - windowMs) track.shift();
  if (!track.length || track[0].t > now - windowMs) return false;
  const inWindow = track.filter((e) => e.t >= now - windowMs);
  const points = inWindow[0]?.pts.length ?? 0;
  for (let k = 0; k < points; k++) {
    const bins = new Map<number, { x: number; y: number; n: number }>();
    for (const e of inWindow) {
      const q = e.pts[k];
      if (!q) continue;
      const b = Math.floor((e.t - (now - windowMs)) / binMs);
      const acc = bins.get(b) ?? { x: 0, y: 0, n: 0 };
      acc.x += q.x;
      acc.y += q.y;
      acc.n++;
      bins.set(b, acc);
    }
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const b of bins.values()) {
      const x = b.x / b.n;
      const y = b.y / b.n;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    if (bins.size && Math.max(x1 - x0, y1 - y0) > limit) return false;
  }
  return true;
}

/** The subject's shoulders are in the picture (the left frame rule's view test). */
export function shouldersInView(person: Landmark[] | null): person is Landmark[] {
  return (
    !!person &&
    isPerson(person) &&
    (visible(person, LM.l_shoulder) || visible(person, LM.r_shoulder)) &&
    [person[LM.l_shoulder], person[LM.r_shoulder]].some((q) => q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1)
  );
}
