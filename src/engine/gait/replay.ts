/**
 * The skeleton replay of a gait view (product v7 contract 2.8 ReplayCycle; gait-rules 2.1 storage:
 * «landmarks only, never video; one representative cycle is kept for the skeleton replay»). Pure, no
 * DOM.
 *
 * The cycle is the side's clean cycle whose stride time is nearest the side's median (the earliest on
 * a tie), short enough for 45 frames at 15 fps, preferring cycles of the limb nearest the phone. Its
 * landmarks (0, 11 to 16 and 23 to 32) are read from the processed series at 15 fps. Coordinates are
 * in units of the picture height on both axes (pixel space, D-003, so the skeleton keeps its true
 * proportions without the picture's aspect), y along true down when the roll is known, x shifted so the
 * cycle's mean mid hip sits at 0.5; 3 decimals.
 */
import type { Cycle } from "./cycles";
import { REPLAY_FPS, REPLAY_LANDMARK_IDS, STORED_LIMITS } from "./params";
import type { Prepared } from "./preprocess";
import type { ReplayCycle } from "./types";
import { at, median, r3, type LimbSide } from "./util";

/** The replay frames of one cycle, or null when a replay landmark is missing in the whole cycle. */
function framesOf(p: Prepared, c: Cycle): [number, number][][] | null {
  const s = p.series;
  const t0 = s.t[c.k0];
  const t1 = s.t[c.k1];
  const n = Math.floor((t1 - t0) * REPLAY_FPS + 1e-9) + 1;
  if (n > STORED_LIMITS.replayFrames) return null;
  const idx = Array.from({ length: n }, (_, i) => (t0 + i / REPLAY_FPS - s.t[0]) * s.hz);
  const cols: [number[], number[]][] = [];
  for (const id of REPLAY_LANDMARK_IDS) {
    const xs = idx.map((f) => at(s.x[id], f));
    const ys = idx.map((f) => at(s.y[id], f));
    // A short hole takes the nearest finite sample of the cycle.
    const fill = (vs: number[]) => {
      const finite = vs.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
      if (!finite.length) return false;
      for (let i = 0; i < vs.length; i++)
        if (!Number.isFinite(vs[i])) {
          const j = finite.reduce((best, f) => (Math.abs(f - i) < Math.abs(best - i) ? f : best));
          vs[i] = vs[j];
        }
      return true;
    };
    if (!fill(xs) || !fill(ys)) return null;
    cols.push([xs, ys]);
  }
  const hipL = REPLAY_LANDMARK_IDS.indexOf(23);
  const hipR = REPLAY_LANDMARK_IDS.indexOf(24);
  const midHip = idx.map((_, i) => (cols[hipL][0][i] + cols[hipR][0][i]) / 2);
  const shift = 0.5 - midHip.reduce((a, b) => a + b, 0) / midHip.length;
  const frames = idx.map((_, i) =>
    cols.map(([xs, ys]) => [r3(xs[i] + shift), r3(ys[i])] as [number, number]),
  );
  const inBounds = frames.every((f) => f.every(([x, y]) => x >= -1 && x <= 2 && y >= -1 && y <= 2));
  return inBounds ? frames : null;
}

/** One representative replay cycle of a side, or null. */
export function replayOf(p: Prepared, cycles: readonly Cycle[], side: LimbSide): ReplayCycle | null {
  const own = cycles.filter((c) => c.clean && c.side === side);
  const pool = own.some((c) => c.near) ? own.filter((c) => c.near) : own;
  const s = p.series;
  const stride = (c: Cycle) => s.t[c.k1] - s.t[c.k0];
  const mid = median(pool.map(stride));
  if (mid === null) return null;
  const ranked = [...pool].sort(
    (a, b) => Math.abs(stride(a) - mid) - Math.abs(stride(b) - mid) || a.k0 - b.k0,
  );
  for (const c of ranked) {
    const frames = framesOf(p, c);
    if (frames) return { side, fps: REPLAY_FPS, landmarks: [...REPLAY_LANDMARK_IDS], frames };
  }
  return null;
}
