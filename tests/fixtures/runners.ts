/**
 * Helpers for the engine mode tests (tests/range-test.test.ts, tests/trunk-control.test.ts):
 * scripted motion timelines that follow the runners' pace, a mirrored camera stream, and a driver
 * that feeds a fixture through a runner.
 *
 * The runners react to the person (calibration, then an attempt that waits for the lift or the
 * lean, then a rest of 5 s), while a generated fixture follows a fixed script. The schedules below
 * space the movements so each one starts after the runner has opened the attempt for it.
 */
import type { Fixture } from "./format";
import { fixtureFrames } from "./format";
import type { AspectName, GenSpec, GenTruth, MotionSpec, Profile } from "./gen";
import { generate } from "./gen";
import type { FeedEnv, SideResult, TestEvent, TestResult, TestRunner } from "../../src/engine/modes";
import type { Frame, Landmark } from "../../src/engine/types";

type Side = "left" | "right";

export const ASPECTS: readonly AspectName[] = ["9:16", "16:9", "1:1"];

/** Arm raise timing: slow rise (instructions: raise slowly), a hold at the top, a slow lowering. */
export const RAISE = { rise: 3, hold: 1.5, lower: 3 } as const;
/** First raise (the practice) and the spacing of the next ones (practice + rest + margin). */
export const RAISE_FIRST = 1.5;
export const RAISE_EVERY = 14;

/** Start times of `n` raises. */
export const raiseStarts = (n: number, first = RAISE_FIRST, every = RAISE_EVERY) =>
  Array.from({ length: n }, (_, i) => first + i * every);

/** Arm raises of one arm to `peak` (a number, or one per raise). */
export function raises(side: Side, peak: number | number[], starts: number[], plane = 0): MotionSpec[] {
  return starts.map((start, i) => ({
    kind: "arm_raise",
    side,
    peak: Array.isArray(peak) ? peak[i] : peak,
    plane,
    start,
    ...RAISE,
  }));
}

/** Side lean timing: rise, pause, come back. */
export const LEAN = { rise: 2, hold: 1.5, back: 2 } as const;
export const LEAN_FIRST = 4;
export const LEAN_EVERY = 12.5;

/** The runner's lean order: practice per side, then alternating (first side first). */
export function leanOrder(first: Side, practice = true, attempts = 3): Side[] {
  const second: Side = first === "left" ? "right" : "left";
  const out: Side[] = practice ? [first, second] : [];
  for (let k = 0; k < attempts; k++) out.push(first, second);
  return out;
}

export const leanStarts = (n: number, first = LEAN_FIRST, every = LEAN_EVERY) =>
  Array.from({ length: n }, (_, i) => first + i * every);

/** Side leans in `order`, each to `peak` (a number or one per lean). */
export function leans(
  order: Side[],
  peak: number | number[],
  starts: number[] = leanStarts(order.length),
): MotionSpec[] {
  return order.map((toward, i) => ({
    kind: "side_lean",
    toward,
    peak: Array.isArray(peak) ? peak[i] : peak,
    start: starts[i],
    ...LEAN,
  }));
}

/** Hands resting on the thighs (the side lean's arm mode, spec 4.3). */
export const HANDS_ON_THIGHS = {
  left: { elev: 20, plane: 60, elbow: 70 },
  right: { elev: 20, plane: 60, elbow: 70 },
};

export function spec(
  test: string,
  profile: Profile,
  aspect: AspectName,
  motions: MotionSpec[],
  durationSec: number,
  seed: number,
  extra: Partial<GenSpec> = {},
): GenSpec {
  return {
    test,
    profile,
    aspect,
    fps: 15,
    durationSec,
    seed,
    ...extra,
    subject: { ...extra.subject, motions: [...(extra.subject?.motions ?? []), ...motions] },
  };
}

export interface Run {
  events: TestEvent[];
  result: TestResult;
  side(s: Side): SideResult;
  cues: string[];
}

/** Starts the runner at the first frame, feeds every frame, then finishes. */
export function run(
  runner: TestRunner,
  frames: Frame[],
  env: FeedEnv | ((f: Frame, i: number) => FeedEnv) = {},
  before?: (r: TestRunner) => void,
): Run {
  const events = [...runner.start(frames[0].t)];
  frames.forEach((f, i) => events.push(...runner.feed(f, typeof env === "function" ? env(f, i) : env)));
  before?.(runner);
  const result = runner.finish(frames[frames.length - 1].t);
  return {
    events,
    result,
    side: (s) => {
      const r = result.results.find((x) => x.side === s);
      if (!r) throw new Error(`no result for ${s}`);
      return r;
    },
    cues: events.flatMap((e) => (e.kind === "cue" ? [e.cue] : [])),
  };
}

export function framesOf(s: GenSpec): { fx: Fixture<GenTruth>; frames: Frame[] } {
  const fx = generate(s);
  return { fx, frames: fixtureFrames(fx) };
}

/** Landmark pairs the model swaps between the person's left and right. */
const PAIRS: [number, number][] = [
  [1, 4],
  [2, 5],
  [3, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];
const SWAP: number[] = Array.from({ length: 33 }, (_, i) => i);
for (const [a, b] of PAIRS) {
  SWAP[a] = b;
  SWAP[b] = a;
}

/**
 * What the model returns for a mirrored camera picture: the picture is flipped left to right, and
 * the model, which assumes the person faces the camera, labels the person's left side as right.
 */
export function mirrorPose(p: Landmark[]): Landmark[] {
  return p.map((_, i) => ({ ...p[SWAP[i]], x: 1 - p[SWAP[i]].x }));
}

export function mirrorFrames(frames: Frame[]): Frame[] {
  return frames.map((f) => {
    const poses = (f.poses ?? [f.lm]).map(mirrorPose);
    return { ...f, poses, lm: poses[0] ?? f.lm };
  });
}

/** Frames with some subject landmarks changed from a time on (the subject is pose `subjectIndex`). */
export function editSubject(
  fx: Fixture<GenTruth>,
  frames: Frame[],
  edit: (p: Landmark[], t: number) => Landmark[],
): Frame[] {
  return frames.map((f, i) => {
    const k = fx.truth.subjectIndex[i];
    if (k < 0 || !f.poses) return f;
    const poses = f.poses.map((p, j) =>
      j === k
        ? edit(
            p.map((q) => ({ ...q })),
            f.t,
          )
        : p,
    );
    return { ...f, poses, lm: poses[0] };
  });
}

export const cuesBetween = (events: TestEvent[], from: number, to: number) =>
  events.filter((e) => e.kind === "cue" && e.t >= from && e.t <= to).map((e) => (e as { cue: string }).cue);
