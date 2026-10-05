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
 * the v1 runners: the first repetition (the practice) starts at 1.5 s and one starts every 12.5 s
 * after it (a 2 s rise, a 4 s hold, a 2 s return: ROM_REP), so each starts after the runner has opened
 * its attempt even when its hold is found 3 s late.
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
import { movementDef } from "../../src/movements/rom";
import {
  ROM_MOVEMENT_IDS,
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
  type GenSpec,
  type GenTruth,
  type HelperSpec,
  type MotionSpec,
  type RomGenSpec,
} from "../fixtures/gen";
import { mirrorFrames } from "../fixtures/runners";
import { item } from "./b-driver";

type Side = "left" | "right";

/** The person whose norm mean sets the matrix's end angles. */
export const REFERENCE: { sex: Sex; age: number } = { sex: "female", age: 50 };

/** The repetitions' start times: the practice at 1.5 s, then one every 10 s. */
export const SCHEDULE = { first: 1.5, every: 12.5 } as const;
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
  /** Repetitions (default 4: the practice and three scored attempts). */
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
  const n = o.reps ?? 4;
  const starts = o.starts ?? repStarts(n);
  const reps: MotionSpec[] = starts.map((start, k) => ({
    kind: "rom_rep" as const,
    start,
    peak: Array.isArray(o.peak) ? o.peak[k] : o.peak,
    ...(typeof o.rep === "function" ? o.rep(k) : o.rep),
  }));
  const last = starts[starts.length - 1];
  const seated = o.position.startsWith("seated");
  return {
    test: o.movement,
    profile: seated ? "chair" : "standing",
    aspect: o.aspect,
    fps: o.fps ?? 30,
    durationSec: o.durationSec ?? last + ROM_REP.rise + ROM_REP.hold + ROM_REP.lower + 1,
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
