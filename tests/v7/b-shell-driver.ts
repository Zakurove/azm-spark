/**
 * A simulated person for the focus shell's range blocks (tests/v7/b-controller.test.ts, b-shell.test.ts):
 * the person reads the RomController's step and acts on it as a person at the buttons would, after a
 * short delay: taps «جاهز» on the cards, answers the questions, holds still while the start pose is
 * taken, moves to a target and holds it in the attempts (D-038 item 1: the hold is recorded on its own,
 * no question), comes back in the rests, and taps on after a result. Frames come from the movement poses of b-person.ts at the person's angle. Clearly synthetic.
 */
import type { Frame, Landmark } from "../../src/engine/types";
import type { RomProtocolItem } from "../../src/medical/rom-protocol";
import {
  itemKey,
  type RomController,
  type RomControllerEvent,
  type RomFeedEnv,
  type RomStep,
} from "../../src/features/focus/romController";

/** A picture rolled by `deg` about its centre (square pictures: aspect 1), as a camera rolled on its stand. */
export function rollPicture(lm: Landmark[], deg: number): Landmark[] {
  if (!deg) return lm;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return lm.map((p) => {
    const x = p.x - 0.5;
    const y = p.y - 0.5;
    return { ...p, x: 0.5 + x * c - y * s, y: 0.5 + x * s + y * c };
  });
}
import { MOVEMENT_CASES, movementPose } from "./b-person";

export interface PersonPlan {
  /** The angle the person reaches in an attempt (default the movement case's target). */
  target?: (item: RomProtocolItem, attempt: number) => number;
  /**
   * A pain the person reports once the hold is in hand (D-038 item 1: as the coach's mark_pain does),
   * by movement and attempt; null reports none.
   */
  hurts?: (item: RomProtocolItem, attempt: number) => { level: number; sharp?: boolean } | null;
  /** The answer to the same joint re-ask. */
  reask?: (item: RomProtocolItem) => number;
  /** The answer to «can you move this joint on your own» (default yes). */
  canMove?: (item: RomProtocolItem) => boolean;
  /** The person's pose instead of the movement's own (a compensation): null keeps the movement's. */
  pose?: (item: RomProtocolItem, deg: number, t: number, ctl: RomController) => Landmark[] | null;
  /** Everyone the camera sees (default the person alone): a second person walks in. */
  people?: (person: Landmark[], t: number, ctl: RomController) => Landmark[][];
  /**
   * The phone rolled on its stand by this many degrees: the picture turns as the generator's camera
   * roll does (tests/fixtures/gen.ts), true down at (−sin r, cos r).
   */
  roll?: number;
  /**
   * What the shell feeds with each frame (romController RomFeedEnv); default a level phone whose sensor
   * reads the roll above ({ rollDeg: roll, tilt }), and {} is a phone with no orientation reading.
   */
  env?: RomFeedEnv;
  /** Called before each frame: may act on the controller (STOP, a coach tool). */
  at?: (t: number, ctl: RomController) => void;
  /** Stops the run once true. */
  until?: (ctl: RomController) => boolean;
}

export interface Run {
  events: RomControllerEvent[];
  /** Every step the controller showed, in order (kind and item key). */
  steps: string[];
  t: number;
}

const stepName = (s: RomStep) => ("item" in s ? `${s.kind}:${itemKey(s.item)}` : s.kind);

/**
 * Runs the controller's current block with a simulated person until the block ends (step end or
 * ended), `seconds` pass, or `until` holds. Frames at `fps` from `t0`.
 */
export function runBlock(ctl: RomController, plan: PersonPlan = {}, seconds = 600, t0 = 0, fps = 30): Run {
  const events: RomControllerEvent[] = [];
  const steps: string[] = [];
  let angle = 0;
  let goal = 0;
  let lastStep = "";
  let lastPhase = "";
  let stepAt = t0;
  let acted = "";
  let item: RomProtocolItem | null = null;
  const n = Math.round(seconds * fps);
  let t = t0;
  for (let i = 0; i <= n; i++) {
    t = t0 + (i * 1000) / fps;
    plan.at?.(t, ctl);
    events.push(...ctl.drain());
    const s = ctl.current;
    const name = stepName(s) + (ctl.stopList ? ":stop_list" : "");
    if (name !== lastStep) {
      steps.push(name);
      lastStep = name;
      lastPhase = "";
      stepAt = t;
      acted = "";
    }
    if (s.kind === "end" || s.kind === "ended" || plan.until?.(ctl)) break;
    if (ctl.stopList) continue;
    const after = (sec: number, what: string, act: () => void) => {
      if (acted !== what && t - stepAt >= sec * 1000) {
        acted = what;
        act();
      }
    };
    switch (s.kind) {
      case "block":
      case "setup":
        after(0.3, "ready", () => ctl.ready(t));
        break;
      case "reask":
        after(0.5, "reask", () => ctl.answerReask(plan.reask?.(s.item) ?? 0, t));
        break;
      case "pain_stop":
        after(0.5, "ack", () => ctl.acknowledge(t));
        break;
      case "result":
        after(0.5, "next", () => ctl.next(t));
        break;
      case "rest":
      case "sit":
        ctl.tick(t);
        break;
      case "measure": {
        if (item === null || itemKey(item) !== itemKey(s.item)) {
          item = s.item;
          angle = MOVEMENT_CASES[s.item.movementId].rest;
          goal = angle;
        }
        const c = MOVEMENT_CASES[s.item.movementId];
        const phase = ctl.phase;
        const phaseName = `${phase}:${ctl.attempt.index}`;
        if (phase !== null && phaseName !== lastPhase) {
          lastPhase = phaseName;
          stepAt = t;
          acted = "";
          if (phase === "practice" || phase === "attempt")
            goal = plan.target?.(s.item, ctl.attempt.index) ?? c.target;
          if (phase === "rest" || phase === "calibrating") goal = c.rest;
        }
        if (phase === "ask_can_move")
          after(0.5, "can", () => ctl.answerCanMove(plan.canMove?.(s.item) ?? true, t));
        const hold = phase === "attempt" ? ctl.hold : null;
        const hurt = hold ? (plan.hurts?.(s.item, hold.attempt) ?? null) : null;
        if (hold && hurt && acted !== `pain:${hold.holdId}`) {
          acted = `pain:${hold.holdId}`;
          ctl.answerPain(hurt.level, !!hurt.sharp, "voice", t);
        }
        const speed = 30 / fps;
        angle = Math.abs(goal - angle) <= speed ? goal : angle + Math.sign(goal - angle) * speed;
        const level =
          plan.pose?.(s.item, angle, t, ctl) ?? movementPose(s.item.movementId, s.item.side)(angle);
        const lm = rollPicture(level, plan.roll ?? 0);
        const frame: Frame = { t, lm, poses: plan.people?.(lm, t, ctl) ?? [lm], aspect: 1 };
        const roll = plan.roll ?? 0;
        ctl.feed(frame, plan.env ?? { rollDeg: roll, tilt: { rollDeg: roll, pitchDeg: 0 } });
        break;
      }
      default:
        break;
    }
  }
  events.push(...ctl.drain());
  return { events, steps, t };
}

export const saves = (events: RomControllerEvent[]) =>
  events.filter((e): e is Extract<RomControllerEvent, { kind: "save" }> => e.kind === "save");
export const bridges = (events: RomControllerEvent[]) =>
  events
    .filter((e): e is Extract<RomControllerEvent, { kind: "bridge" }> => e.kind === "bridge")
    .map((e) => e.event);
export const lines = (events: RomControllerEvent[]) =>
  events
    .filter((e): e is Extract<RomControllerEvent, { kind: "line" }> => e.kind === "line")
    .map((e) => e.line);
