/**
 * Step B2's range of motion fixtures (product v7 contract 8.2, stream B): the mannequin of
 * tests/fixtures/gen.ts posed in each movement's position, the matrix of 8.2, and a driver that runs a
 * fixture through the RomRunner the way a person at the buttons answers it.
 *
 * Matrix (8.2): every one of the 16 measured movements, each allowed position (rom-protocol
 * movements[].positions), both sides (the tested side; the bend direction of the front view side
 * bends; the side toward the phone of the axial side views), 9:16 and 16:9, end angles at 25, 50, 75
 * and 100 percent of the norm mean, landmark noise 0.003, frames at 24 to 30 fps with jitter, plus a
 * helper beside the person and the mirrored picture.
 *
 * «Percent of the norm mean» is read as the share of the way from the start pose to the norm mean:
 * end = rest + p × (mean − rest). It equals p × mean for every movement whose start pose reads 0, and
 * it gives the knee and elbow straightening (lack movements, whose norm mean is about 0) and the seated
 * hip bend (which starts at 90) the same four steps from their start pose. The norm mean is the
 * typical value (src/medical/rom-norms.ts typicalValue, the movement's first graded norm) of one
 * reference person, REFERENCE.
 *
 * Timing (SCHEDULE): a generated fixture follows a fixed script while the runner reacts to the person
 * (calibration, the practice, a rest of 5 s after each attempt), as tests/fixtures/runners.ts does for
 * the v1 runners: the first repetition (the practice) starts at 1.5 s and one starts every 16 s after
 * it, so each starts after the runner has opened its attempt even when its hold is found 5 s late. A
 * repetition moves at the pace of the v1 arm raise script (PACE_DEG_PER_SEC: 150 degrees in 3 s, «raise
 * slowly»), taking at least 1 s, holds HOLD_SEC while the maximum question comes, and returns. The long
 * hold keeps a late hold a late hold: the run is still measured, and the timing check reports it. (The
 * compensation fixtures hold the practice and the compensated repetition only COMPENSATED_HOLD_SEC, so
 * the person is down again when the next attempt opens and each lift is judged on its own.)
 *
 * Noise (MATRIX_NOISE, MATRIX_FACE_NOISE): 0.003 of the picture height on the body's landmarks, and
 * on the face points the same share of it that the COCO keypoint spreads give the face against the
 * shoulders (ROM_FACE_NOISE_SHARE, about 0.44). The answers (runRom): the simulated person answers the
 * maximum question «نعم» at the end of a repetition and «ليس بعد» when asked anywhere else (at rest,
 * or while still moving), as a person would.
 * Clearly synthetic.
 */
import type { Frame } from "../../src/engine/types";
import type { FeedEnv } from "../../src/engine/modes/types";
import { RomRunner } from "../../src/engine/rom/runner";
import type {
  RomAnswer,
  RomAttempt,
  RomEvent,
  RomHold,
  RomMeasureResult,
  RomRunnerOptions,
} from "../../src/engine/rom/types";
import { typicalValue } from "../../src/medical/rom-norms";
import type { RomProtocolItem } from "../../src/medical/rom-protocol";
import type { Sex } from "../../src/medical/plan";
import { movementDef, ROM_DATA } from "../../src/movements/rom";
import {
  ROM_MOVEMENT_IDS,
  type CompensationId,
  type RomMovementId,
  type RomPositionId,
  type RomSide,
} from "../../src/movements/rom/types";
import { fixtureFrames, type Fixture } from "../fixtures/format";
import {
  generate,
  romAngleAt,
  romRestDeg,
  ROM_FACE_NOISE_SHARE,
  ROM_REP,
  type AspectName,
  type BodyPart,
  type GenSpec,
  type GenTruth,
  type HelperSpec,
  type MotionSpec,
  type RomGenSpec,
  type RomOffset,
} from "../fixtures/gen";
import { mirrorFrames } from "../fixtures/runners";
import { item } from "./b-driver";

type Side = "left" | "right";

/** The person whose norm mean sets the matrix's end angles. */
export const REFERENCE: { sex: Sex; age: number } = { sex: "female", age: 50 };

/** The repetitions' start times: the practice at 1.5 s, then one every 10 s. */
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

/** The matrix's percents of the norm mean. */
export const PERCENTS = [25, 50, 75, 100] as const;

/** The matrix's landmark noise, as a share of the picture height (8.2). */
export const MATRIX_NOISE = 0.003;
/** The face points' noise in the matrix (ROM_FACE_NOISE_SHARE of the body's). */
export const MATRIX_FACE_NOISE = MATRIX_NOISE * ROM_FACE_NOISE_SHARE;
/** Frame time jitter, ms either way, on the 24 and 30 fps cases (8.2 «frame jitter 24 to 30 fps»). */
export const MATRIX_JITTER_MS = 5;

/** The norm mean of a movement for the reference person (the tested side's row where the norm has sides). */
export function normMean(movement: RomMovementId, side: RomSide = "right"): number {
  const v = typicalValue(movement, REFERENCE.sex, REFERENCE.age, side === "none" ? undefined : side);
  if (v === null) throw new Error(`no norm for ${movement}`);
  return v;
}

/** The end angle at `percent` of the way from the start pose to the norm mean (one decimal). */
export function endAngle(
  movement: RomMovementId,
  position: RomPositionId,
  percent: number,
  side: RomSide = "right",
): number {
  const rest = romRestDeg(movement, position);
  return Math.round((rest + (percent / 100) * (normMean(movement, side) - rest)) * 10) / 10;
}

/** The sides a movement is measured on in the matrix: [side, cameraSide]. */
export function matrixSides(movement: RomMovementId): { side: RomSide; cameraSide?: Side }[] {
  const def = movementDef(movement);
  if (def.axial && def.view === "side")
    return [
      { side: "none", cameraSide: "left" },
      { side: "none", cameraSide: "right" },
    ];
  return [{ side: "left" }, { side: "right" }];
}

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
  rep?:
    | Partial<Extract<MotionSpec, { kind: "rom_rep" }>>
    | ((k: number) => Partial<Extract<MotionSpec, { kind: "rom_rep" }>>);
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
  const reps = starts.map((start, k): Extract<MotionSpec, { kind: "rom_rep" }> => {
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

/**
 * A helper standing beside the person (8.2 «a helper beside»), on the side away from the moving
 * limb: beside a chair or a standing person 0.9 m to the side and a little behind; beyond the head or
 * the feet of a person lying on a bed, where a carer stands.
 */
export function helperBeside(
  movement: RomMovementId,
  position: RomPositionId,
  side: RomSide,
  cameraSide?: Side,
): HelperSpec {
  const def = movementDef(movement);
  if (position === "lying_back") return { x: side === "left" ? 1.6 : -1.6, z: -0.3, yaw: 0 };
  if (def.view === "front") {
    // Facing the phone, the person's right is the picture's left: stand on the side of the other limb.
    const away = side === "left" ? -1 : 1;
    return { x: away * 0.95, z: -0.3, yaw: 0 };
  }
  // A side view: the person faces the picture's right (right side toward the phone) or left; stand behind them.
  const facing = side === "none" ? (cameraSide ?? "right") : side;
  return { x: facing === "right" ? -0.95 : 0.95, z: -0.3, yaw: 0 };
}

export interface RomCase {
  name: string;
  movement: RomMovementId;
  position: RomPositionId;
  side: RomSide;
  cameraSide?: Side;
  aspect: AspectName;
  percent: number;
  fps: number;
  mirrored: boolean;
  helper: boolean;
  truthDeg: number;
  spec: GenSpec;
}

/** The 8.2 matrix of one movement: positions × sides × aspects × percents, then a helper and a mirrored case per position and side. */
export function movementMatrix(movement: RomMovementId): RomCase[] {
  const def = movementDef(movement);
  const out: RomCase[] = [];
  let k = 0;
  for (const { id: position } of def.positions)
    for (const { side, cameraSide } of matrixSides(movement)) {
      const tag = side === "none" ? `cam-${cameraSide}` : side;
      const variants: { aspect: AspectName; percent: number; mirrored: boolean; helper: boolean }[] = [];
      for (const aspect of ["9:16", "16:9"] as const)
        for (const percent of PERCENTS) variants.push({ aspect, percent, mirrored: false, helper: false });
      variants.push({ aspect: "9:16", percent: 75, mirrored: false, helper: true });
      variants.push({ aspect: "16:9", percent: 50, mirrored: true, helper: false });
      for (const v of variants) {
        const fps = k++ % 2 ? 24 : 30;
        const shape = v.aspect === "9:16" ? "9x16" : "16x9";
        const extra = v.helper ? "-helper" : v.mirrored ? "-mirrored" : "";
        const name = `rom/${movement}/${position}/${tag}-${v.percent}-${shape}-${fps}fps${extra}`;
        const truthDeg = endAngle(movement, position, v.percent, side);
        out.push({
          name,
          movement,
          position,
          side,
          cameraSide,
          aspect: v.aspect,
          percent: v.percent,
          fps,
          mirrored: v.mirrored,
          helper: v.helper,
          truthDeg,
          spec: romSpec({
            name,
            movement,
            position,
            side,
            cameraSide,
            aspect: v.aspect,
            peak: truthDeg,
            fps,
            jitterMs: MATRIX_JITTER_MS,
            ...(v.helper ? { helper: helperBeside(movement, position, side, cameraSide) } : {}),
          }),
        });
      }
    }
  return out;
}

/** The whole 8.2 matrix. */
export function romMatrix(): RomCase[] {
  return ROM_MOVEMENT_IDS.flatMap(movementMatrix);
}

/* ------------------------------------------------------------------ the driver */

export interface RomRun {
  fx: Fixture<GenTruth>;
  frames: Frame[];
  result: RomMeasureResult;
  events: RomEvent[];
  holds: RomHold[];
  /** Every attempt record, repeats and the practice included, in order. */
  records: RomAttempt[];
  runner: RomRunner;
}

/** The hold band the person reads as «at my end»: within the runner's hold band of the repetition's end angle. */
const AT_END_DEG = 3;

/**
 * The simulated person's answer to a maximum question at time t: «نعم» when the script holds a
 * repetition's end (the angle within the hold band of its end angle, in its plateau or the last of its
 * rise), else «ليس بعد» (at rest, or still moving).
 */
export function personAnswer(spec: GenSpec, t: number): RomAnswer {
  const sec = t / 1000;
  for (const m of spec.subject?.motions ?? []) {
    if (m.kind !== "rom_rep") continue;
    const from = m.start;
    const to = m.start + (m.rise ?? ROM_REP.rise) + (m.hold ?? ROM_REP.hold);
    if (sec >= from && sec <= to && Math.abs(romAngleAt(spec, sec) - m.peak) <= AT_END_DEG) return "yes";
  }
  return "not_yet";
}

export interface RunOptions {
  mirrored?: boolean;
  /** The answer to each maximum question (default personAnswer), null for none. */
  answer?: (hold: RomHold, k: number) => RomAnswer | null;
  /** Seconds after the hold the answer comes (default 0.6, as tests/v7/b-driver.ts). */
  answerAfter?: number;
  env?: FeedEnv;
  item?: Partial<RomProtocolItem>;
  runner?: Partial<RomRunnerOptions>;
}

/** The runner over a fixture, answering each maximum question as a person at the buttons would. */
export function runRom(spec: GenSpec, o: RunOptions = {}): RomRun {
  const r = spec.rom!;
  const fx = generate(spec);
  const frames = o.mirrored ? mirrorFrames(fixtureFrames(fx)) : fixtureFrames(fx);
  const runner = new RomRunner({
    item: item(r.movement, r.side, { position: r.position, ...o.item }),
    def: movementDef(r.movement),
    askCauseBelow: null,
    poseModel: "full",
    mirrored: !!o.mirrored,
    ...o.runner,
  });
  const events: RomEvent[] = [...runner.start(frames[0].t)];
  const holds: RomHold[] = [];
  const pending: { at: number; hold: RomHold; answer: RomAnswer }[] = [];
  const after = (o.answerAfter ?? 0.6) * 1000;
  const take = (evs: RomEvent[], t: number) => {
    for (const e of evs) {
      events.push(e);
      if (e.kind === "hold") {
        holds.push(e.hold);
        const a = o.answer ? o.answer(e.hold, holds.length) : personAnswer(spec, e.hold.t);
        if (a) pending.push({ at: t + after, hold: e.hold, answer: a });
      }
    }
  };
  for (const f of frames) {
    while (pending.length && pending[0].at <= f.t) {
      const p = pending.shift()!;
      take(runner.answerMax(p.hold.holdId, p.answer, "button", p.at).events, p.at);
    }
    if (runner.done || runner.phase === "stopped") break;
    take(runner.feed(f, o.env ?? { rollDeg: 0 }), f.t);
  }
  const result = runner.finish(frames[frames.length - 1].t);
  const records = events.flatMap((e) => (e.kind === "attempt" ? [e.record] : []));
  return { fx, frames, result, events, holds, records, runner };
}

/* ------------------------------------------------------------------ the 8.2 acceptance */

/** The engine's hold second (rom-protocol engine.holdSeconds). */
const ROM_DATA_HOLD_SEC = ROM_DATA.engine.holdSeconds;

/** «recorded value within 5 degrees of the generator's truth» (8.2, plan acceptance). */
export const VALUE_TOLERANCE_DEG = 5;
/** «the hold found within 1.5 s of the true plateau start plus the hold second» (8.2). */
export const HOLD_TOLERANCE_SEC = 1.5;

/**
 * Each scored repetition's hold: the first hold of its window answered «نعم», and its delay after
 * plateau start + the hold second; null when the runner found no hold in it (a missed hold). The
 * repetitions read are those up to the one that recorded the last scored attempt (the spare after it,
 * and those of a run that ended early, are not).
 */
export function plateauHolds(run: RomRun): { rep: number; t: number | null; delaySec: number | null }[] {
  const spec = run.fx.meta.spec!;
  const reps = run.fx.truth.rom!.reps;
  const holdSec = ROM_DATA_HOLD_SEC;
  const lastT = Math.max(0, ...run.result.attempts.map((a) => a.t1)) / 1000;
  const used = reps.slice(1).filter((r) => r.start <= lastT);
  const scored = Math.max(used.length, 3);
  return reps.slice(1, 1 + scored).map((r, k) => {
    const h = run.holds.find(
      (x) => x.t / 1000 >= r.start && x.t / 1000 <= r.plateauTo + 0.5 && personAnswer(spec, x.t) === "yes",
    );
    return {
      rep: k + 1,
      t: h ? h.t : null,
      delaySec: h ? Math.round((h.t / 1000 - (r.plateauFrom + holdSec)) * 100) / 100 : null,
    };
  });
}

/** Holds asked away from a repetition's end (answered «ليس بعد» by the person). */
export function strayHolds(run: RomRun): RomHold[] {
  const spec = run.fx.meta.spec!;
  return run.holds.filter((h) => personAnswer(spec, h.t) !== "yes");
}

/**
 * The matrix cases that miss 8.2's hold timing (contract change log B2-3), each with exactly what it
 * misses. At noise 0.003 of the picture height a portrait picture carries 3.8 px of jitter per landmark
 * (1.5 times step B1's estimate of the real model's, B1-3; a landscape picture 2.2 px), and a few of its
 * holds come later than 1.5 s: 4 of the matrix's 1,320 (0.3 percent), all in portrait, while every
 * case is measured with every value within 5 degrees. A seed sweep (5 more seeds of every case) puts
 * the rate at about 3 percent of portrait runs, most of them hip abduction (its hip line is about 62 px
 * long at 2.5 m) and elbow extension (the lack's sign flips near straight); at noise 0.002 one late hold
 * in 2,200 runs. Asserted exactly, so a change that fixes or moves one shows here.
 */
export const LATE_HOLD_CASES: Readonly<Record<string, readonly string[]>> = {
  "rom/shoulder_flexion/seated/right-75-9x16-30fps": ["repetition 1: hold 1.57 s after plateau start + 1 s"],
  "rom/hip_extension/standing_supported/right-100-9x16-24fps": [
    "repetition 1: hold 1.79 s after plateau start + 1 s",
  ],
  "rom/hip_abduction/standing_supported/left-75-9x16-30fps-helper": [
    "repetition 1: hold 2.36 s after plateau start + 1 s",
  ],
  "rom/hip_abduction/standing_supported/right-50-9x16-24fps": [
    "repetition 2: hold 1.71 s after plateau start + 1 s",
  ],
};

/** Every way a matrix run misses the 8.2 acceptance (empty when it meets it). */
export function matrixProblems(c: RomCase, run: RomRun): string[] {
  const res = run.result;
  const out: string[] = [];
  if (res.status !== "measured") out.push(`status ${res.status} (${res.reason})`);
  if (res.nValid !== 3) out.push(`${res.nValid} valid attempts`);
  if (res.retries)
    out.push(
      `${res.retries} repeats: ${run.records
        .filter((a) => a.outcome === "retry" || a.outcome === "invalid")
        .map((a) => a.reasons.join("+"))
        .join(", ")}`,
    );
  if (res.value === null || Math.abs(res.value - c.truthDeg) > VALUE_TOLERANCE_DEG)
    out.push(`value ${res.value} for ${c.truthDeg}`);
  for (const a of res.attempts)
    if (a.value === null || Math.abs(a.value - c.truthDeg) > VALUE_TOLERANCE_DEG)
      out.push(`attempt ${a.index} value ${a.value} for ${c.truthDeg}`);
  for (const e of run.events)
    if (e.kind === "compensation" && e.level === "invalid")
      out.push(`compensation ${e.id} invalid at ${e.t} ms`);
  for (const h of plateauHolds(run))
    if (h.delaySec === null || Math.abs(h.delaySec) > HOLD_TOLERANCE_SEC)
      out.push(
        `repetition ${h.rep}: hold ${h.delaySec === null ? "not found" : `${h.delaySec} s`} after plateau start + 1 s`,
      );
  return out;
}

/* ------------------------------------------------------------------ compensation fixtures */

/** What a person does wrong in the first scored attempt of a compensation fixture. */
export interface CompensationFixture {
  movement: RomMovementId;
  id: CompensationId;
  position: RomPositionId;
  side: RomSide;
  cameraSide?: Side;
  /** Joint offsets through the repetition (rom_offset), at full strength from the end of the rise. */
  offset?: RomOffset;
  /** A hand holding a point of the body from the start of the repetition to the end of its hold. */
  hand?: { hand: Side; part: BodyPart; of: Side };
  /** Far side landmarks seen (a far limb in the clear, a far hand reaching across). */
  farSeen?: number[];
  /** The end angle (percent of the way to the norm mean, default 100). */
  percent?: number;
  /** What the check measures then, in its unit: the level the fixture reaches. */
  reaches: string;
  /**
   * Another check that reads the same posture first and makes the attempt invalid under its own name
   * (change log B2-6): the attempt is still invalid, as specified, with this reason.
   */
  firesAs?: CompensationId;
  /** Checks that read the same posture and may fire in the same frame (change log B2-6). */
  alsoFires?: CompensationId[];
}

/** MediaPipe ids of a side's wrist and hand points (15 to 22). */
const HAND_IDS = { left: [15, 17, 19, 21], right: [16, 18, 20, 22] } as const;
/** MediaPipe ids of a side's hip and leg (23 to 32). */
const LEG_POINT_IDS = { left: [23, 25, 27, 29, 31], right: [24, 26, 28, 30, 32] } as const;

/**
 * One fixture per compensation of the 16 movements (rom-protocol movements[].compensations), each
 * past its level by a clear margin (8.1: «fire at threshold plus 2»; here half the level again or
 * more, so the landmark noise of the matrix never hides it). The tested side is the right (the bend
 * to the right for the side bends); the camera sees it as the matrix does.
 */
export const COMPENSATION_FIXTURES: CompensationFixture[] = [
  // shoulder_flexion, seated, side view.
  {
    movement: "shoulder_flexion",
    id: "trunk_back",
    position: "seated",
    side: "right",
    offset: { pitch: -16 },
    reaches: "the trunk line 16 degrees back (invalid above 10)",
  },
  {
    movement: "shoulder_flexion",
    id: "plane",
    position: "seated",
    side: "right",
    offset: { arms: { right: { plane: -55 } } },
    reaches:
      "the arm raised 35 degrees from the side, its picture about 0.6 of its length through 70 to 110 (invalid below 0.85)",
  },
  {
    movement: "shoulder_flexion",
    id: "bent_elbow",
    position: "seated",
    side: "right",
    offset: { arms: { right: { elbow: 45 } } },
    reaches: "an elbow angle of 130 degrees (flag below 150)",
  },
  {
    movement: "shoulder_flexion",
    id: "assisted",
    position: "seated",
    side: "right",
    hand: { hand: "left", part: "elbow", of: "right" },
    farSeen: [...HAND_IDS.left],
    reaches: "the other wrist at the raised elbow (invalid within 0.25 shoulder widths)",
  },
  // shoulder_abduction, seated, front view.
  {
    movement: "shoulder_abduction",
    id: "trunk_lean",
    position: "seated",
    side: "right",
    offset: { lean: 16 },
    reaches: "the trunk axis 16 degrees toward the other side (invalid above 10)",
  },
  {
    movement: "shoulder_abduction",
    id: "plane",
    position: "seated",
    side: "right",
    offset: { arms: { right: { plane: 70 } } },
    reaches:
      "the arm raised 70 degrees toward the front, its picture under 0.4 of the practice's through 70 to 110 (invalid without 0.3 s at 0.85)",
  },
  {
    movement: "shoulder_abduction",
    id: "trunk_rotation",
    position: "seated",
    side: "right",
    offset: { twist: 42 },
    reaches: "the shoulder width 26 percent narrower (invalid above 15)",
  },
  {
    movement: "shoulder_abduction",
    id: "assisted",
    position: "seated",
    side: "right",
    hand: { hand: "left", part: "elbow", of: "right" },
    reaches: "the other hand at the raised elbow (invalid, v1's near reading)",
  },
  {
    movement: "shoulder_abduction",
    id: "bent_elbow",
    position: "seated",
    side: "right",
    offset: { arms: { right: { elbow: 45, across: 1 } } },
    reaches:
      "an elbow angle of 130 degrees, the forearm bending in the picture's plane toward the head (flag below 150; a forward bend is out of a front view's plane)",
  },
  {
    movement: "shoulder_abduction",
    id: "shrug",
    position: "seated",
    side: "right",
    offset: { shoulderRise: { right: 0.07 } },
    reaches: "the ear to shoulder distance 0.2 shoulder widths shorter (v1's shrug cue at 0.15)",
  },
  // shoulder_extension, seated near the front of the chair, side view.
  {
    movement: "shoulder_extension",
    id: "trunk_forward",
    position: "seated_forward",
    side: "right",
    offset: { pitch: 16 },
    reaches: "the trunk line 16 degrees forward (invalid above 10)",
  },
  {
    movement: "shoulder_extension",
    id: "plane",
    position: "seated_forward",
    side: "right",
    offset: { arms: { right: { plane: 55 } } },
    reaches:
      "the arm moved back 35 degrees from the side, its picture under 0.85 of its length at the end (invalid)",
  },
  {
    movement: "shoulder_extension",
    id: "bent_elbow",
    position: "seated_forward",
    side: "right",
    offset: { arms: { right: { elbow: 45 } } },
    reaches: "an elbow angle of 130 degrees (flag below 150)",
  },
  // elbow_extension and elbow_flexion, seated, side view.
  {
    movement: "elbow_extension",
    id: "upper_arm_moves",
    position: "seated",
    side: "right",
    offset: { arms: { right: { elev: 30 } } },
    reaches: "the upper arm 30 degrees forward of its start (invalid above 20)",
  },
  {
    movement: "elbow_extension",
    id: "forearm_plane",
    position: "seated",
    side: "right",
    percent: 50,
    offset: { arms: { right: { across: 0.9 } } },
    reaches: "the forearm bending across the body, its picture under 0.85 of its length (invalid)",
  },
  {
    movement: "elbow_extension",
    id: "trunk",
    position: "seated",
    side: "right",
    offset: { pitch: 16 },
    reaches: "the trunk line 16 degrees forward (invalid above 10)",
  },
  {
    movement: "elbow_flexion",
    id: "upper_arm_moves",
    position: "seated",
    side: "right",
    offset: { arms: { right: { elev: 30 } } },
    reaches: "the upper arm 30 degrees forward of its start (invalid above 20)",
  },
  {
    movement: "elbow_flexion",
    id: "forearm_plane",
    position: "seated",
    side: "right",
    offset: { arms: { right: { across: 0.9 } } },
    reaches: "the forearm bending across the body, its picture under 0.85 of its length (invalid)",
  },
  // hip_flexion, lying on the back, side view.
  {
    movement: "hip_flexion",
    id: "assisted",
    position: "lying_back",
    side: "right",
    hand: { hand: "right", part: "knee", of: "right" },
    reaches: "the wrist on the knee at the end (invalid within 0.3 thigh lengths)",
  },
  {
    movement: "hip_flexion",
    id: "trunk_lift",
    position: "lying_back",
    side: "right",
    offset: { pitch: 16 },
    reaches: "the shoulders lifting 16 degrees (invalid above 10)",
  },
  {
    movement: "hip_flexion",
    id: "other_leg",
    position: "lying_back",
    side: "right",
    offset: { legs: { left: { hipFlex: 16 } } },
    farSeen: [...LEG_POINT_IDS.left],
    reaches: "the other thigh lifting 16 degrees (invalid above 10)",
  },
  {
    movement: "hip_flexion",
    id: "plane",
    position: "lying_back",
    side: "right",
    offset: { legs: { right: { hipAbd: 45 } } },
    reaches:
      "the knee falling out 45 degrees, the thigh's picture about 0.7 of its length (invalid below 0.85)",
  },
  // hip_extension, standing at a counter, side view.
  {
    movement: "hip_extension",
    id: "trunk_tilt",
    position: "standing_supported",
    side: "right",
    offset: { pitch: 16 },
    reaches: "the trunk line 16 degrees forward (invalid above 10)",
  },
  {
    movement: "hip_extension",
    id: "knee_bend",
    position: "standing_supported",
    side: "right",
    offset: { legs: { right: { knee: 32 } } },
    reaches: "the tested knee bent 32 degrees (flag above 20)",
  },
  {
    movement: "hip_extension",
    id: "stance_knee",
    position: "standing_supported",
    side: "right",
    offset: { legs: { left: { knee: 26 } } },
    farSeen: [...LEG_POINT_IDS.left],
    reaches: "the standing knee bent 26 degrees (flag above 15)",
  },
  {
    movement: "hip_extension",
    id: "plane",
    position: "standing_supported",
    side: "right",
    offset: { legs: { right: { hipAbd: 45 } } },
    reaches: "the leg swinging out 45 degrees, the thigh's picture under 0.85 of its length (invalid)",
  },
  // hip_abduction, standing at a counter, front view.
  {
    movement: "hip_abduction",
    id: "trunk_lean",
    position: "standing_supported",
    side: "right",
    offset: { lean: 16 },
    reaches: "the trunk axis 16 degrees toward the other side (invalid above 10)",
  },
  {
    movement: "hip_abduction",
    id: "hip_hike",
    position: "standing_supported",
    side: "right",
    offset: { pelvisRoll: -9 },
    reaches: "the hip line tilting 9 degrees, the tested hip up (flag above 5)",
  },
  {
    movement: "hip_abduction",
    id: "plane",
    position: "standing_supported",
    side: "right",
    offset: { legs: { right: { hipFlex: 60 } } },
    reaches:
      "the leg swinging 60 degrees forward, the thigh's picture about 0.75 of its length (invalid below 0.85)",
  },
  // knee_flexion, lying on the back, side view.
  {
    movement: "knee_flexion",
    id: "assisted",
    position: "lying_back",
    side: "right",
    offset: { pitch: 40 },
    hand: { hand: "right", part: "knee", of: "right" },
    reaches:
      "the wrist on the knee at the end, the shoulders lifted to reach it (invalid within 0.3 shank lengths)",
  },
  {
    movement: "knee_flexion",
    id: "plane",
    position: "lying_back",
    side: "right",
    offset: { legs: { right: { hipAbd: 45 } } },
    reaches:
      "the knee falling out 45 degrees, the thigh's picture about 0.7 of its length (invalid below 0.85)",
  },
  // knee_extension, lying on the back (plane) and seated (the lean back).
  {
    movement: "knee_extension",
    id: "plane",
    position: "lying_back",
    side: "right",
    offset: { legs: { right: { hipAbd: -30 } } },
    reaches:
      "the leg turning 30 degrees away from the phone, the shank's picture about 0.7 of its length (invalid below 0.85; a leg falling out toward the phone comes nearer and its picture does not shorten, change log B2-6)",
  },
  {
    movement: "knee_extension",
    id: "seated_lean_back",
    position: "seated",
    side: "right",
    offset: { pitch: -16 },
    reaches: "the trunk line 16 degrees back (invalid above 10)",
  },
  // ankle_dorsiflexion_lunge, standing at the wall, side view.
  {
    movement: "ankle_dorsiflexion_lunge",
    id: "heel_lift",
    position: "standing_supported",
    side: "right",
    offset: { lunge: { heelLiftDeg: 14 } },
    reaches:
      "the heel lifting 14 degrees about the toes (invalid above a 5 degree pitch change or 0.06 shank lengths)",
  },
  {
    movement: "ankle_dorsiflexion_lunge",
    id: "foot_turn",
    position: "standing_supported",
    side: "right",
    offset: { lunge: { footTurnDeg: 55 } },
    firesAs: "heel_lift",
    reaches:
      "the foot turned out 55 degrees, its picture 0.7 of its length (invalid below 0.8); seen from hip height its heel to toe line also tilts about 28 degrees, so heel_lift's pitch criterion (5 degrees) catches it first (change log B2-6)",
  },
  {
    movement: "ankle_dorsiflexion_lunge",
    id: "knee_plane",
    position: "standing_supported",
    side: "right",
    offset: { lunge: { kneeDriftDeg: 45 } },
    reaches:
      "the knee drifting 45 degrees inward, the shank's picture about 0.7 of its length (invalid below 0.85)",
  },
  // trunk_lateral_flexion, standing, front view.
  {
    movement: "trunk_lateral_flexion",
    id: "trunk_rotation",
    position: "standing",
    side: "right",
    offset: { twist: 42 },
    reaches: "the shoulder width 26 percent narrower (invalid above 15)",
  },
  {
    movement: "trunk_lateral_flexion",
    id: "knee_bend",
    position: "standing",
    side: "right",
    offset: { legs: { left: { knee: 40, hipRot: 45 } } },
    reaches:
      "a knee bent 40 degrees with the knee turned out 45 degrees, about 30 degrees in the picture (invalid above 15; a knee bending straight forward is out of a front view's plane)",
  },
  {
    movement: "trunk_lateral_flexion",
    id: "pelvis_shift",
    position: "standing",
    side: "right",
    offset: { pelvisRoll: 9 },
    reaches: "the hip line tilting 9 degrees (flag above 5)",
  },
  // trunk_flexion, standing near a support, side view.
  {
    movement: "trunk_flexion",
    id: "knee_bend",
    position: "standing_supported",
    side: "none",
    cameraSide: "right",
    offset: { legs: { left: { knee: 26 }, right: { knee: 26 } } },
    reaches: "the knees bent 26 degrees (invalid above 15)",
  },
  {
    movement: "trunk_flexion",
    id: "hands_support",
    position: "standing_supported",
    side: "none",
    cameraSide: "right",
    percent: 75,
    hand: { hand: "right", part: "thigh", of: "right" },
    reaches: "the near wrist resting on the thigh, bent forward 83 degrees (flag, v1's near reading)",
  },
  // neck_lateral_flexion, seated, front view (the bend to the right).
  {
    movement: "neck_lateral_flexion",
    id: "shoulder_hike",
    position: "seated",
    side: "right",
    offset: { shoulderRise: { right: 0.09 } },
    reaches: "the right shoulder raised toward the ear, the shoulder line 15 degrees (invalid above 10)",
  },
  {
    movement: "neck_lateral_flexion",
    id: "head_turn",
    position: "seated",
    side: "right",
    offset: { neck: { turn: 28 } },
    reaches: "the head turned 28 degrees, the nose a third of the ear distance off (invalid above 0.15)",
  },
  {
    movement: "neck_lateral_flexion",
    id: "trunk_lean",
    position: "seated",
    side: "right",
    offset: { lean: -16 },
    alsoFires: ["shoulder_hike"],
    reaches:
      "the trunk axis 16 degrees toward the bend (invalid above 10); the lean tilts the shoulder line as much, so shoulder_hike may fire with it",
  },
  // neck_flexion and neck_extension, seated, side view.
  {
    movement: "neck_flexion",
    id: "trunk",
    position: "seated",
    side: "none",
    cameraSide: "right",
    offset: { pitch: 16 },
    reaches: "the trunk line 16 degrees forward (invalid above 10)",
  },
  {
    movement: "neck_extension",
    id: "trunk",
    position: "seated",
    side: "none",
    cameraSide: "right",
    offset: { pitch: -16 },
    reaches: "the trunk line 16 degrees back (invalid above 10)",
  },
];

/** The compensated repetition's hold, seconds: long enough for its hold to be found, short enough to end before the repeat opens. */
export const COMPENSATED_HOLD_SEC = 2.5;

/**
 * The fixture of one compensation: the practice, the compensated first scored attempt, then three clean
 * ones. The practice and the compensated repetition hold COMPENSATED_HOLD_SEC, so the person is down
 * when the next attempt opens. The compensation is there from the start of the repetition (0.5 s to
 * come in) to the end of its hold, at most 4.5 s, and goes in 0.5 s, so the repeated attempt the runner
 * opens 5 s after an invalid one meets a clean posture; a hand holds its body point from the start of
 * the repetition to the end of its hold.
 */
export function compensationSpec(c: CompensationFixture, aspect: AspectName = "16:9"): GenSpec {
  const name = `rom/${c.movement}/${c.position}/compensation-${c.id}-${aspect === "9:16" ? "9x16" : "16x9"}`;
  const peak = endAngle(c.movement, c.position, c.percent ?? 100, c.side);
  const starts = repStarts(5);
  const rest = romRestDeg(c.movement, c.position);
  const pace = riseSec(peak - rest);
  const at = starts[1];
  const motions: MotionSpec[] = [];
  if (c.offset)
    motions.push({
      kind: "rom_offset",
      offset: c.offset,
      start: at,
      rise: 0.5,
      hold: Math.min(pace - 0.5 + COMPENSATED_HOLD_SEC, 4),
      back: 0.5,
    });
  if (c.hand) motions.push({ kind: "rom_hand", ...c.hand, from: at, to: at + pace + COMPENSATED_HOLD_SEC });
  return romSpec({
    name,
    movement: c.movement,
    position: c.position,
    side: c.side,
    cameraSide: c.cameraSide,
    aspect,
    peak,
    reps: 5,
    starts,
    rep: (k) => (k <= 1 ? { hold: COMPENSATED_HOLD_SEC } : {}),
    motions,
    ...(c.farSeen ? { rom: { farSeen: c.farSeen } } : {}),
    notes: `${c.movement} ${c.id}: ${c.reaches}`,
  });
}
