/**
 * Helpers for the timed count tests (tests/timed-count.test.ts): scripts of practice and trial
 * reps, a driver that answers the runners' questions, and ground truth counts.
 *
 * The runners react to the person (calibration, practice, a rest, a countdown, then go), while a
 * generated recording follows a fixed script. A script is therefore built in two passes: the first
 * recording holds only the practice, and the runner on it tells when go comes; the second one adds
 * the trial reps at times after go. The frames before go are the same in both (the generator's
 * random stream does not depend on later motions), so go comes at the same time, which the helper
 * checks.
 */
import {
  ArmCurlRunner,
  ChairStandRunner,
  type RunnerOptions,
  type TestEvent,
  type TestResult,
} from "../../src/engine/modes";
import { testDef } from "../../src/movements/assessments";
import type { Frame } from "../../src/engine/types";
import type { Fixture } from "./format";
import {
  curlRepTime,
  rng,
  standRepTime,
  type AspectName,
  type GenSpec,
  type GenTruth,
  type MotionSpec,
  type Profile,
} from "./gen";
import { framesOf, spec } from "./runners";

type Side = "left" | "right";
type CurlRep = Extract<MotionSpec, { kind: "curl_rep" }>;
type StandRep = Extract<MotionSpec, { kind: "stand_rep" }>;

/** Arms crossed at the wrists on the chest (spec 4.4 standard version). */
export const CROSSED = {
  left: { elev: 25, plane: 70, elbow: 115, across: 1 },
  right: { elev: 25, plane: 70, elbow: 115, across: 1 },
};

/** Test timings that keep the recordings short (the spec's rests are options of the runner). */
export const FAST: RunnerOptions = { practiceRestSec: 2, repeatRestSec: 5, pausePracticeSec: 4 };

/** Two slow practice bends (spec 4.2), from 2 s. */
export const curlPractice = (side: Side, top = 140): CurlRep[] => [
  { kind: "curl_rep", side, start: 2, dur: 3, top },
  { kind: "curl_rep", side, start: 5.5, dur: 3, top },
];

/** Two slow practice stands held about a second (spec 4.4), from 2 s. */
export const standPractice = (extra: Partial<StandRep> = {}): StandRep[] => [
  { kind: "stand_rep", start: 2, rise: 1.5, hold: 1.2, sit: 1.5, ...extra },
  { kind: "stand_rep", start: 7, rise: 1.5, hold: 1.2, sit: 1.5, ...extra },
];

export interface Answers {
  practiceCheck?: boolean | "arm_only";
  repeat?: boolean;
  pushed?: boolean;
}

export interface Drive {
  events: TestEvent[];
  result: TestResult;
  cues: string[];
  /** Time of check_go in ms (null when the trial never started). */
  go: number | null;
  asks: string[];
}

/** Starts the runner, feeds every frame, answers its questions, then finishes. */
export function drive(
  runner: ArmCurlRunner | ChairStandRunner,
  frames: Frame[],
  answers: Answers = {},
  roll: number | null = 0,
): Drive {
  const events: TestEvent[] = [...runner.start(frames[0].t)];
  const asks: string[] = [];
  const answer = (e: TestEvent, t: number) => {
    if (e.kind !== "ask") return;
    asks.push(e.ask);
    if (e.ask === "practice_check" && runner instanceof ArmCurlRunner) {
      const a = answers.practiceCheck ?? true;
      events.push(...runner.setPracticeCheck(a === true, t, a === "arm_only" ? "arm_only" : undefined));
    }
    if (e.ask === "repeat" && answers.repeat !== undefined)
      events.push(...runner.setRepeat(answers.repeat, t));
    if (e.ask === "pushed" && runner instanceof ChairStandRunner && answers.pushed !== undefined)
      events.push(...runner.setPushed(answers.pushed, t));
  };
  for (const f of frames) {
    const out = runner.feed(f, roll === null ? {} : { rollDeg: roll });
    events.push(...out);
    for (const e of out) answer(e, f.t);
  }
  const result = runner.finish(frames[frames.length - 1].t);
  const goEv = events.find((e) => e.kind === "cue" && e.cue === "check_go");
  return {
    events,
    result,
    cues: events.flatMap((e) => (e.kind === "cue" ? [e.cue] : [])),
    go: goEv ? goEv.t : null,
    asks,
  };
}

export interface Case {
  fx: Fixture<GenTruth>;
  frames: Frame[];
  run: Drive;
  /** go in seconds. */
  goSec: number;
  /** The trial motions of the script. */
  trial: MotionSpec[];
}

export interface TwoPass {
  test: "arm_curl_30s" | "chair_stand_30s";
  profile: Profile;
  aspect: AspectName;
  seed: number;
  side?: Side;
  practice: MotionSpec[];
  /** Trial motions, given go in seconds. */
  trial: (goSec: number) => MotionSpec[];
  durationSec?: number;
  extra?: Partial<GenSpec>;
  opts?: RunnerOptions;
  answers?: Answers;
  /** Transform the frames (a mirrored camera, edits) before the runner sees them. */
  frames?: (frames: Frame[], fx: Fixture<GenTruth>) => Frame[];
  roll?: number | null;
}

function runner(c: TwoPass): ArmCurlRunner | ChairStandRunner {
  const opts = { ...FAST, ...c.opts };
  return c.test === "arm_curl_30s"
    ? new ArmCurlRunner(testDef("arm_curl_30s"), c.side ?? "right", opts)
    : new ChairStandRunner(testDef("chair_stand_30s"), "none", opts);
}

/** The recording and the run for a script whose trial reps are placed after go (two passes). */
export function twoPass(c: TwoPass): Case {
  const duration = c.durationSec ?? 52;
  const make = (motions: MotionSpec[]) => {
    const { fx, frames } = framesOf(
      spec(c.test, c.profile, c.aspect, motions, duration, c.seed, { fps: 20, ...c.extra }),
    );
    return { fx, frames: c.frames ? c.frames(frames, fx) : frames };
  };
  const first = make(c.practice);
  const go1 = drive(runner(c), first.frames, c.answers, c.roll ?? 0).go;
  if (go1 === null) throw new Error("The practice pass never reached go");
  const goSec = go1 / 1000;
  const trial = c.trial(goSec);
  const second = make([...c.practice, ...trial]);
  const run = drive(runner(c), second.frames, c.answers, c.roll ?? 0);
  if (run.go !== go1) throw new Error(`go moved from ${go1} to ${run.go}`);
  return { fx: second.fx, frames: second.frames, run, goSec, trial };
}

/**
 * Trial curl reps from go + 1 s with seeded durations (1.4 to 2.2 s) and gaps (0.1 to 0.6 s) until
 * `untilSec` after go. `top` is the bend of each rep (a number, or a function of its index).
 * Reps whose count line crossing would fall within 0.25 s of the end of the trial are left out, so
 * the ground truth never hangs on the filter lag.
 */
export function curlTrial(
  side: Side,
  goSec: number,
  seed: number,
  top: number | ((i: number) => number) = 140,
  untilSec = 32,
): CurlRep[] {
  const r = rng(seed);
  const out: CurlRep[] = [];
  let t = goSec + 1;
  for (let i = 0; t < goSec + untilSec; i++) {
    const dur = 1.4 + 0.8 * r();
    const rep: CurlRep = {
      kind: "curl_rep",
      side,
      start: t,
      dur,
      top: typeof top === "number" ? top : top(i),
    };
    const cross = curlRepTime(rep, 0.8)!;
    if (Math.abs(cross - (goSec + 30)) > 0.25) out.push(rep);
    t += dur + 0.1 + 0.5 * r();
  }
  return out;
}

/** Trial stands from go + 1 s with seeded timing, the same way as curlTrial. */
export function standTrial(
  goSec: number,
  seed: number,
  extra: (i: number) => Partial<StandRep> = () => ({}),
  untilSec = 32,
): StandRep[] {
  const r = rng(seed);
  const out: StandRep[] = [];
  let t = goSec + 1;
  for (let i = 0; t < goSec + untilSec; i++) {
    const rise = 0.8 + 0.4 * r();
    const sit = 0.8 + 0.4 * r();
    const rep: StandRep = { kind: "stand_rep", start: t, rise, hold: 0.2, sit, ...extra(i) };
    const cross = standRepTime(rep, 0.85);
    const end = t + rise + (rep.hold ?? 0.2) + sit;
    // Keep clear of the end: no crossing near 30.0 s and no stand rising at 30.0 s.
    const nearEnd =
      (cross !== null && Math.abs(cross - (goSec + 30)) < 0.3) || (t < goSec + 30 && end > goSec + 30);
    if (!nearEnd) out.push(rep);
    t = end + 0.2 + 0.4 * r();
  }
  return out;
}

/** Curl reps of a script that are full (at least `fullTop` of bend) and cross 0.8 before go + 30 s. */
export function curlTruth(reps: MotionSpec[], goSec: number, fullTop = 140): number {
  return reps.filter(
    (m): m is CurlRep =>
      m.kind === "curl_rep" &&
      m.start >= goSec &&
      (m.top ?? 140) >= fullTop &&
      curlRepTime(m, 0.8)! < goSec + 30,
  ).length;
}

/** Stand reps of a script that stand fully and cross 0.85 before go + 30 s. */
export function standTruth(reps: MotionSpec[], goSec: number): number {
  return reps.filter((m): m is StandRep => {
    if (m.kind !== "stand_rep" || m.start < goSec || (m.peak ?? 1) < 1 || (m.topPitch ?? 0) > 0) return false;
    const cross = standRepTime(m, 0.85);
    return cross !== null && cross < goSec + 30;
  }).length;
}

export const cuesBetween = (events: TestEvent[], from: number, to: number) =>
  events.filter((e) => e.kind === "cue" && e.t >= from && e.t <= to).map((e) => (e as { cue: string }).cue);
