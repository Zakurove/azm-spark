/**
 * A simulated person for the RomRunner tests (tests/v7/b-*.test.ts): the person follows the runner's
 * phases (still at the start pose while it calibrates, moves to the attempt's target and holds it,
 * comes back to the start in the rest) and answers its questions after a delay, as a person with the
 * buttons or the coach would. The pose of each frame comes from a builder of the movement angle. Clearly
 * synthetic.
 */
import type { Frame, Landmark } from "../../src/engine/types";
import type { FeedEnv } from "../../src/engine/modes/types";
import { RomRunner } from "../../src/engine/rom/runner";
import type {
  AnswerSource,
  LimitCause,
  RomAnswer,
  RomEvent,
  RomHold,
  RomPhase,
  RomRunnerOptions,
} from "../../src/engine/rom/types";
import type { RomProtocolItem } from "../../src/medical/rom-protocol";
import { movementDef } from "../../src/movements/rom";
import type { RomMovementId, RomPositionId, RomSide } from "../../src/movements/rom/types";
import { frontSeated, place, rotate, sideSeated, UPPER_BODY, midOf, point } from "./b-poses";

const RAD = Math.PI / 180;

/* ------------------------------------------------------------------ poses of a movement angle */

/**
 * The side arm raise in the front view at `deg` (the tested arm straight, turned out from hanging), the
 * other arm hanging; `lean` turns the trunk and everything above it about the mid hip.
 */
export function abductionPose(deg: number, side: "left" | "right" = "right", lean = 0): Landmark[] {
  let px = frontSeated();
  const arms = {
    right: { s: 12, e: 14, w: 16, h: [18, 20, 22], out: -1 },
    left: { s: 11, e: 13, w: 15, h: [17, 19, 21], out: 1 },
  };
  for (const k of ["left", "right"] as const) {
    const a = arms[k];
    const th = k === side ? deg : 0;
    const dir = { x: a.out * Math.sin(th * RAD), y: Math.cos(th * RAD) };
    const S = point(px, a.s);
    const E = { x: S.x + 0.15 * dir.x, y: S.y + 0.15 * dir.y };
    const W = { x: E.x + 0.13 * dir.x, y: E.y + 0.13 * dir.y };
    px = place(px, a.e, E);
    px = place(px, a.w, W);
    for (const h of a.h) px = place(px, h, { x: W.x + 0.02 * dir.x, y: W.y + 0.02 * dir.y });
  }
  return lean ? rotate(px, UPPER_BODY, midOf(px, 23, 24), lean) : px;
}

/**
 * Elbow straightening in the seated side view (right side to the phone, facing the picture's right):
 * the upper arm hanging, the forearm forward, `lack` degrees short of straight.
 */
export function elbowExtensionPose(lack: number): Landmark[] {
  let px = sideSeated();
  const E = point(px, 14);
  // The forearm turned forward from hanging straight down by the lack: 90 forward, 0 straight.
  const th = lack * RAD;
  const dir = { x: Math.sin(th), y: Math.cos(th) };
  const W = { x: E.x + 0.13 * dir.x, y: E.y + 0.13 * dir.y };
  px = place(px, 16, W);
  for (const h of [18, 20, 22]) px = place(px, h, { x: W.x + 0.02 * dir.x, y: W.y + 0.02 * dir.y });
  return px;
}

/* ------------------------------------------------------------------ items */

/** A protocol item for a movement (the fields a runner reads). */
export function item(
  movementId: RomMovementId,
  side: RomSide = "right",
  over: Partial<RomProtocolItem> = {},
): RomProtocolItem {
  const def = movementDef(movementId);
  const position: RomPositionId = over.position ?? def.positions[0].id;
  return {
    movementId,
    side,
    region: def.region,
    position,
    block: "seated",
    order: 1,
    priority: def.priority,
    verdict: def.verdict,
    normId: def.positions[0].normId,
    graded: def.positions[0].graded,
    askCanMove: false,
    helperRequired: false,
    approximate: false,
    ...over,
  };
}

export function runner(
  movementId: RomMovementId,
  over: Partial<Omit<RomRunnerOptions, "item">> & { side?: RomSide; item?: Partial<RomProtocolItem> } = {},
): RomRunner {
  const { side, item: itemOver, ...opts } = over;
  return new RomRunner({
    item: item(movementId, side ?? "right", itemOver),
    def: movementDef(movementId),
    askCauseBelow: null,
    poseModel: "full",
    ...opts,
  });
}

/* ------------------------------------------------------------------ the simulated person */

export interface ScriptAnswer {
  answer: RomAnswer;
  after?: number;
  source?: AnswerSource;
}

export interface Script {
  /** The angle of the start pose. */
  rest: number;
  /** The angle the person reaches in an attempt (index 0 is the practice; `n` counts every attempt opened, repeats too). */
  target: (index: number, n: number) => number;
  /** Degrees per second toward the goal. */
  speed?: number;
  /** Seconds the person waits after an attempt opens before moving. */
  startDelay?: number;
  /** The answer to the maximum question of a hold, after `after` seconds (default yes by button after 0.6 s). Null: no answer. */
  answer?: (hold: RomHold, k: number) => ScriptAnswer | null;
  /** After «not yet», the angle to go on to (default: stay). */
  further?: (index: number) => number;
  /** The pain score after «it hurts» (default 2), and whether it is sharp. */
  pain?: { level: number; sharp?: boolean; after?: number };
  /** The answer to the cause question. */
  cause?: LimitCause;
  /** A wobble added to the angle (tremor): amplitude in degrees and frequency. */
  tremor?: { amp: number; hz: number };
  /** The pose of an angle at a time. */
  pose: (deg: number, t: number) => Landmark[];
  fps?: number;
  /** Frame times as `t0 + k * 1000 / fps` from this start (ms). */
  t0?: number;
  env?: FeedEnv;
}

export interface Drive {
  events: RomEvent[];
  phases: { phase: RomPhase; t: number; attempt: number }[];
  /** The person's angle at each frame. */
  angles: { t: number; deg: number }[];
  /** The time of the last frame or answer. */
  t: number;
}

/** Runs a runner with a simulated person for `seconds` (stops early when the runner is done or stopped). */
export function drive(
  r: RomRunner,
  s: Script,
  seconds: number,
  hooks: {
    /** Called before each frame: may act on the runner (its events are kept). */
    at?: (t: number, r: RomRunner) => RomEvent[] | void;
    /** Stops the drive once true (checked after each frame and answer). */
    until?: (r: RomRunner) => boolean;
  } = {},
): Drive {
  const fps = s.fps ?? 30;
  const t0 = s.t0 ?? 0;
  const events: RomEvent[] = [];
  const phases: Drive["phases"] = [];
  const angles: Drive["angles"] = [];
  let angle = s.rest;
  let goal = s.rest;
  let moveAt = t0;
  let opened = 0;
  let holds = 0;
  let prev: RomPhase | null = null;
  const pending: { at: number; run: (at: number) => RomEvent[] }[] = [];
  const take = (evs: RomEvent[], t: number) => {
    for (const e of evs) {
      events.push(e);
      if (e.kind === "phase") {
        phases.push({ phase: e.phase, t: e.t, attempt: e.attempt });
        // A new attempt (an attempt after «not yet» comes back from ask_max and goes on where it was).
        if ((e.phase === "practice" || e.phase === "attempt") && prev !== "ask_max") {
          opened++;
          goal = s.target(e.attempt, opened);
          moveAt = t + (s.startDelay ?? 0.5) * 1000;
        }
        if (e.phase === "rest" || e.phase === "calibrating") {
          goal = s.rest;
          moveAt = t;
        }
        if (e.phase === "ask_pain") {
          const p = s.pain ?? { level: 2 };
          pending.push({
            at: t + (p.after ?? 0.8) * 1000,
            run: (at) => r.answerPain(p.level, !!p.sharp, "button", at).events,
          });
        }
        if (e.phase === "ask_cause" && s.cause) {
          const c = s.cause;
          pending.push({ at: t + 1000, run: (at) => r.answerCause(c, "button", at).events });
        }
        prev = e.phase;
      }
      if (e.kind === "hold") {
        const k = ++holds;
        const answerOf = s.answer ?? ((): ScriptAnswer => ({ answer: "yes" }));
        const a = answerOf(e.hold, k);
        if (a)
          pending.push({
            at: t + (a.after ?? 0.6) * 1000,
            run: (at) => {
              const res = r.answerMax(e.hold.holdId, a.answer, a.source ?? "button", at);
              if (res.accepted && a.answer === "not_yet" && s.further) {
                goal = s.further(e.hold.attempt);
                moveAt = at;
              }
              return res.events;
            },
          });
      }
    }
  };
  take(r.start(t0), t0);
  if (r.phase === "practice" || r.phase === "attempt") {
    // Joining a runner in an attempt (a resumed one): the person goes for the target.
    opened++;
    goal = s.target(r.phase === "practice" ? 0 : 1, opened);
    moveAt = t0 + (s.startDelay ?? 0.5) * 1000;
    prev = r.phase;
  }
  const n = Math.round(seconds * fps);
  const stop = () => r.done || r.phase === "stopped" || !!hooks.until?.(r);
  let last = t0;
  for (let i = 1; i <= n && !stop(); i++) {
    const t = t0 + (i * 1000) / fps;
    pending.sort((a, b) => a.at - b.at);
    while (pending.length && pending[0].at <= t && !stop()) {
      const p = pending.shift()!;
      take(p.run(p.at), p.at);
      last = p.at;
    }
    if (stop()) break;
    last = t;
    const extra = hooks.at?.(t, r);
    if (extra) take(extra, t);
    if (t >= moveAt) {
      const step = (s.speed ?? 60) / fps;
      angle = Math.abs(goal - angle) <= step ? goal : angle + Math.sign(goal - angle) * step;
    }
    const wobble = s.tremor ? s.tremor.amp * Math.sin(2 * Math.PI * s.tremor.hz * (t / 1000)) : 0;
    const deg = angle + wobble;
    angles.push({ t, deg });
    const lm = s.pose(deg, t);
    const frame: Frame = { t, lm, poses: [lm], aspect: 1 };
    take(r.feed(frame, s.env ?? { rollDeg: 0 }), t);
  }
  return { events, phases, angles, t: last };
}

export const kinds = <K extends RomEvent["kind"]>(events: RomEvent[], kind: K) =>
  events.filter((e): e is Extract<RomEvent, { kind: K }> => e.kind === kind);

export const cuesOf = (events: RomEvent[]) => kinds(events, "cue").map((e) => e.cue);
