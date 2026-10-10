/**
 * The laps of the overground walk toward the phone and back, counted live (D-038 item 4: the second
 * part of the walk, with the phone left sideways at hip height where it stood for the side passes:
 * walk toward the phone, turn before the feet leave the picture, walk back; twice). A lap is one walk
 * toward the phone and back. It is read from the body's size in the picture (mid shoulder to mid hip,
 * which stays in the picture when the feet leave its bottom), never from the feet:
 *   - toward: the size grows by towardRatio from its smallest since the last lap (about a metre closer
 *     from 4 to 5 m away);
 *   - the turn: the size falls back by turnRatio from its largest (a step or two away);
 *   - the lap: walking back, the size falls by awayRatio from its largest (about as far back as the
 *     walk toward came): counted then, so the screen and the coach move on as the person walks back
 *     to the start;
 *   - close: walking toward, the lowest ankle or heel is past closeShare of the picture's height, or
 *     both are lost while the hips are seen: the feet are about to leave the picture's bottom (about 2
 *     to 3 m from a lens at hip height, whatever its height), so the screen and the coach say «turn»;
 *     it holds until the walk back starts.
 * The size is the median over the last quarter second (one wrong frame never moves it); a frame
 * without the shoulders and hips is skipped. Engineering choices of the capture (no clinical number),
 * each in FRONT_LAP. Pure, no DOM.
 */
import type { Landmark } from "../types";

export const FRONT_LAP = {
  /** Walking toward: the size grows by this factor from its smallest. */
  towardRatio: 1.25,
  /** The turn: the size falls by this factor from its largest. */
  turnRatio: 1.08,
  /** The walk back counts as a lap: the size falls by this factor from its largest. */
  awayRatio: 1.25,
  /** Close: the lowest ankle or heel is this far down the picture (share of its height). */
  closeShare: 0.85,
  /** The size: the median over this window. */
  smoothMs: 250,
  /** A landmark the counter reads: at least this visible. */
  minVisibility: 0.3,
} as const;

export interface FrontLapState {
  /** Laps walked (toward the phone and back). */
  laps: number;
  /** Walking toward the phone, away, or neither yet. */
  phase: "start" | "toward" | "away";
  /** Walking toward the phone with the feet near the picture's bottom: time to turn. */
  close: boolean;
}

const FEET = [27, 28, 29, 30] as const;

const seen = (q: Landmark | undefined): q is Landmark =>
  !!q && Number.isFinite(q.x) && Number.isFinite(q.y) && (q.visibility ?? 0) >= FRONT_LAP.minVisibility;

/** The trunk's length in the picture (picture heights; x scaled by the aspect), or null. */
export function trunkSize(lm: Landmark[] | null | undefined, aspect: number): number | null {
  if (!lm) return null;
  const [ls, rs, lh, rh] = [lm[11], lm[12], lm[23], lm[24]];
  if (!seen(ls) || !seen(rs) || !seen(lh) || !seen(rh)) return null;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const dx = ((ls.x + rs.x - lh.x - rh.x) / 2) * a;
  const dy = (ls.y + rs.y - lh.y - rh.y) / 2;
  const size = Math.hypot(dx, dy);
  return size > 0 ? size : null;
}

const medianOf = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class FrontLapCounter {
  private laps = 0;
  private phase: FrontLapState["phase"] = "start";
  private buf: { t: number; size: number }[] = [];
  /** The smallest size since the walk toward could start, and the largest of the walk toward. */
  private low = Number.POSITIVE_INFINITY;
  private high = 0;
  /** The walk back of this lap is counted. */
  private counted = false;
  private close = false;

  /** One frame's pose (the walker's), or null when nobody is seen; `aspect` the picture's. */
  feed(t: number, lm: Landmark[] | null | undefined, aspect: number): FrontLapState {
    const raw = trunkSize(lm, aspect);
    if (raw === null) return this.state();
    this.buf.push({ t, size: raw });
    while (this.buf.length > 1 && t - this.buf[0].t > FRONT_LAP.smoothMs) this.buf.shift();
    const size = medianOf(this.buf.map((b) => b.size));
    const r = FRONT_LAP;
    if (this.phase === "toward") {
      this.high = Math.max(this.high, size);
      if (size * r.turnRatio <= this.high) {
        this.phase = "away";
        this.low = size;
        this.counted = false;
      }
    } else {
      this.low = Math.min(this.low, size);
      if (this.phase === "away" && !this.counted && size * r.awayRatio <= this.high) {
        this.laps++;
        this.counted = true;
      }
      if (size >= this.low * r.towardRatio) {
        this.phase = "toward";
        this.high = size;
      }
    }
    // Close holds for the rest of the walk toward (the feet flicker at the picture's edge).
    this.close = this.phase === "toward" && (this.close || feetLow(lm!));
    return this.state();
  }

  state(): FrontLapState {
    return { laps: this.laps, phase: this.phase, close: this.close };
  }
}

/** The feet near the picture's bottom: the lowest ankle or heel past closeShare, or none seen at all. */
function feetLow(lm: Landmark[]): boolean {
  const feet = FEET.map((i) => lm[i]).filter(seen);
  if (!feet.length) return true;
  return Math.max(...feet.map((q) => q.y)) >= FRONT_LAP.closeShare;
}
