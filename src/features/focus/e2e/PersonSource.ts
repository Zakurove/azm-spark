/**
 * A simulated person in front of the focus check's camera (VITE_E2E=1 builds only): the E2E specs
 * and the review screenshots run the real shell, controller and runners on frames of this person,
 * without a camera. The person follows the RomController's phase: still in the start pose while it is
 * taken and in the rests, moving slowly to a target in the practice and the attempts and holding it
 * there while the maximum question is asked, a little further after «ليس بعد». The questions are
 * answered on the screen (the buttons), as a helper would.
 *
 * The poses are stream B's simple synthetic bodies (tests/v7/b-person.ts). focusCameraSession's
 * createSource builds this source only inside an import.meta.env.VITE_E2E === "1" branch of FocusApp,
 * so a production or v7 build has none of it.
 */
import type { PoseSource } from "../../../app/poseSource";
import type { Frame } from "../../../engine/types";
import type { RomController } from "../romController";
import { MOVEMENT_CASES, movementPose } from "../../../../tests/v7/b-person";

/** The marker the bundle tests can look for. */
export const PERSON_SOURCE_NAME = "FocusPersonSource";

export interface PersonOptions {
  /** A share of each movement's case target the person reaches (a limited range), default 1. */
  reach?: number;
  /** Degrees per second toward the target. */
  speed?: number;
  fps?: number;
}

export class PersonSource implements PoseSource {
  readonly kind = "trace" as const;
  readonly sourceName = PERSON_SOURCE_NAME;
  private timer: ReturnType<typeof setInterval> | null = null;
  private angle = 0;
  private goal = 0;
  private key = "";
  private phase = "";
  private moveAt = 0;

  constructor(
    private readonly controller: () => RomController | null,
    private readonly opts: PersonOptions = {},
  ) {}

  async start(onFrame: (f: Frame) => void): Promise<void> {
    const fps = this.opts.fps ?? 30;
    const speed = this.opts.speed ?? 30;
    let last = performance.now();
    this.timer = setInterval(() => {
      const t = performance.now();
      const dt = (t - last) / 1000;
      last = t;
      const ctl = this.controller();
      const s = ctl?.current;
      const item = s && "item" in s ? s.item : null;
      // Between movements the person sits still in the last pose (or a seated body before the first).
      const id = item?.movementId ?? "shoulder_flexion";
      const c = MOVEMENT_CASES[id];
      const key = item ? `${item.movementId}:${item.side}` : "";
      if (key !== this.key) {
        this.key = key;
        this.angle = c.rest;
        this.goal = c.rest;
      }
      const phase = ctl?.phase ?? "";
      const attempt = ctl?.attempt.index ?? 0;
      const target = c.rest + (c.target - c.rest) * (this.opts.reach ?? 1);
      const now = `${phase}:${attempt}`;
      if (now !== this.phase) {
        const before = this.phase;
        this.phase = now;
        if (phase === "practice" || phase === "attempt") {
          // After «ليس بعد» the same attempt goes on: a little further. A new attempt goes to the target.
          const again = before === `ask_max:${attempt}`;
          this.goal = again ? this.goal + (c.target > c.rest ? 6 : -6) : target;
          this.moveAt = t + (again ? 400 : 700);
        }
        if (phase === "rest" || phase === "calibrating") {
          this.goal = c.rest;
          this.moveAt = t;
        }
      }
      if (t >= this.moveAt) {
        const step = speed * dt;
        this.angle =
          Math.abs(this.goal - this.angle) <= step
            ? this.goal
            : this.angle + Math.sign(this.goal - this.angle) * step;
      }
      const lm = movementPose(id, item?.side ?? c.side)(this.angle);
      onFrame({ t, lm, poses: [lm], aspect: 1 });
    }, 1000 / fps);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
