/**
 * The generator specs of the range of motion fixtures (product v7 contract 8.2, stream B, step B2):
 * the scripted person's schedule, pace and hold, the matrix's noise, and romSpec. Light on purpose:
 * types and tests/fixtures/gen.ts only, since tests/fixtures/rom/catalog.ts builds its entries with it
 * and the e2e FixturePoseSource imports the catalog (tests/v7/b-fixtures.ts holds the matrix, the
 * norms and the runner driver).
 *
 * Timing (SCHEDULE): a generated fixture follows a fixed script while the runner reacts to the person
 * (calibration, the practice, a rest of 5 s after each attempt), as tests/fixtures/runners.ts does for
 * the v1 runners: the first repetition (the practice) starts at 1.5 s and one starts every 16 s after
 * it, so each starts after the runner has opened its attempt even when its hold is found 5 s late. A
 * repetition moves at the pace of the v1 arm raise script (PACE_DEG_PER_SEC: 150 degrees in 3 s, «raise
 * slowly»), taking at least 1 s, holds HOLD_SEC while the maximum question comes, and returns. The long
 * hold keeps a late hold a late hold: the run is still measured, and the timing check reports it.
 *
 * Noise (MATRIX_NOISE, MATRIX_FACE_NOISE): 0.003 of the picture height on the body's landmarks (8.2),
 * and on the face points the share of it that the COCO keypoint spreads give the face against the
 * shoulders (ROM_FACE_NOISE_SHARE, about 0.44). Clearly synthetic.
 */
import type { RomMovementId, RomPositionId, RomSide } from "../../../src/movements/rom/types";
import {
  romRestDeg,
  ROM_FACE_NOISE_SHARE,
  ROM_REP,
  type AspectName,
  type GenSpec,
  type HelperSpec,
  type MotionSpec,
  type RomGenSpec,
} from "../gen";

type Side = "left" | "right";
type RomRep = Extract<MotionSpec, { kind: "rom_rep" }>;

/** The repetitions' start times: the practice at 1.5 s, then one every 16 s. */
export const SCHEDULE = { first: 1.5, every: 16 } as const;
/** How long the scripted person holds the end of a repetition, seconds. */
export const HOLD_SEC = 6;
/** Repetitions of a matrix fixture: the practice and three scored attempts. */
export const MATRIX_REPS = 4;
/** The scripted person's pace: the v1 arm raise script's (tests/fixtures/runners.ts RAISE: about 150 degrees in a 3 s rise). */
export const PACE_DEG_PER_SEC = 50;
/** The shortest rise (and return), seconds: a movement of a few degrees still takes a moment. */
export const MIN_RISE_SEC = 1;
/** A repetition's rise (and return) for an excursion: at PACE_DEG_PER_SEC, at least MIN_RISE_SEC. */
export const riseSec = (excursionDeg: number) =>
  Math.round(Math.max(MIN_RISE_SEC, Math.abs(excursionDeg) / PACE_DEG_PER_SEC) * 10) / 10;
export const repStarts = (n: number, first: number = SCHEDULE.first) =>
  Array.from({ length: n }, (_, i) => first + i * SCHEDULE.every);

/** The matrix's landmark noise, as a share of the picture height (8.2). */
export const MATRIX_NOISE = 0.003;
/** The face points' noise in the matrix (ROM_FACE_NOISE_SHARE of the body's). */
export const MATRIX_FACE_NOISE = MATRIX_NOISE * ROM_FACE_NOISE_SHARE;
/** Frame time jitter, ms either way, on the 24 and 30 fps cases (8.2 «frame jitter 24 to 30 fps»). */
export const MATRIX_JITTER_MS = 5;

/** A seed from a name (FNV-1a), so a case keeps its fixture when others are added. */
export function seedOf(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export interface RomSpecOptions {
  movement: RomMovementId;
  position: RomPositionId;
  side: RomSide;
  cameraSide?: Side;
  aspect: AspectName;
  /** The end angle of every repetition, or one per repetition. */
  peak: number | number[];
  /** Repetitions (default MATRIX_REPS). */
  reps?: number;
  fps?: number;
  jitterMs?: number;
  noise?: number;
  noiseFace?: number;
  helper?: HelperSpec;
  /** Extra motions (compensations, hand holds), added after the repetitions. */
  motions?: MotionSpec[];
  /** Repetition options (tremor, timing) for all repetitions or per repetition. */
  rep?: Partial<RomRep> | ((k: number) => Partial<RomRep>);
  /** Repetition start times (default repStarts). */
  starts?: number[];
  durationSec?: number;
  rom?: Partial<RomGenSpec>;
  name: string;
  notes?: string;
}

/** The generator spec of a range of motion fixture. */
export function romSpec(o: RomSpecOptions): GenSpec {
  const n = o.reps ?? MATRIX_REPS;
  const starts = o.starts ?? repStarts(n);
  const rest = o.rom?.rest ?? romRestDeg(o.movement, o.position);
  const reps = starts.map((start, k): RomRep => {
    const peak = Array.isArray(o.peak) ? o.peak[k] : o.peak;
    const pace = riseSec(peak - rest);
    return {
      kind: "rom_rep",
      start,
      peak,
      rise: pace,
      hold: HOLD_SEC,
      lower: pace,
      ...(typeof o.rep === "function" ? o.rep(k) : o.rep),
    };
  });
  const lastRep = reps[reps.length - 1];
  const seated = o.position.startsWith("seated");
  return {
    test: o.movement,
    profile: seated ? "chair" : "standing",
    aspect: o.aspect,
    fps: o.fps ?? 30,
    durationSec:
      o.durationSec ??
      Math.ceil(
        lastRep.start +
          (lastRep.rise ?? ROM_REP.rise) +
          (lastRep.hold ?? ROM_REP.hold) +
          (lastRep.lower ?? ROM_REP.lower) +
          1,
      ),
    seed: seedOf(o.name),
    noise: o.noise ?? MATRIX_NOISE,
    noiseFace: o.noiseFace ?? (o.noise ?? MATRIX_NOISE) * ROM_FACE_NOISE_SHARE,
    ...(o.jitterMs ? { timing: { jitterMs: o.jitterMs } } : {}),
    ...(o.helper ? { helper: o.helper, shuffle: true } : {}),
    rom: {
      movement: o.movement,
      position: o.position,
      side: o.side,
      ...(o.cameraSide ? { cameraSide: o.cameraSide } : {}),
      ...o.rom,
    },
    subject: { motions: [...reps, ...(o.motions ?? [])] },
    notes: o.notes ?? o.name,
  };
}
