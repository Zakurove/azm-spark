/**
 * Replays a real model smoke run off line (D-034 item 1): the poses the model gave for every camera
 * frame (the smoke page's frames=1 dump, src/features/smoke/run.ts landmarks.poses) go through the
 * RomRunner as the page drove it (romDriver.ts: «نعم» to each maximum question 600 ms after it, no
 * pain), so an engine change is checked on the real model's landmarks without the browser.
 */
import { RomRunner } from "../../src/engine/rom/runner";
import type { Frame, Landmark } from "../../src/engine/types";
import { emptyPose } from "../../src/engine/subject";
import { romItem } from "../../src/features/smoke/run";
import { RomSmokeDriver, type RomDriverReport } from "../../src/features/smoke/romDriver";
import { movementDef } from "../../src/movements/rom";
import type { RomMovementId, RomPositionId } from "../../src/movements/rom/types";

/** What a replay needs of a smoke run: the movement and every frame's poses. */
export interface ReplayInput {
  movement: RomMovementId;
  side: "left" | "right";
  position: RomPositionId;
  model: "lite" | "full";
  aspect: number;
  /** [ms from the first frame, poses of [x, y, visibility] x 33]. */
  poses: [number, [number, number, number][][]][];
}

/** The frames of a replay, as the camera source gave them (z is not kept: 0). */
export function replayFrames(input: ReplayInput): Frame[] {
  return input.poses.map(([t, poses]) => {
    const ps: Landmark[][] = poses.map((pose) =>
      pose.map(([x, y, visibility]) => ({ x, y, z: 0, visibility })),
    );
    return { t, lm: ps[0] ?? emptyPose(), poses: ps, aspect: input.aspect };
  });
}

/** The runner over a replay, driven as the smoke page drives it; the report the page would give. */
export function replay(input: ReplayInput, answerDelayMs = 600): RomDriverReport {
  const frames = replayFrames(input);
  const runner = new RomRunner({
    item: romItem({
      kind: "rom",
      name: "replay",
      model: input.model,
      frames: false,
      preloadMs: 0,
      movement: input.movement,
      side: input.side,
      position: input.position,
      mirrored: false,
      timeoutSec: 240,
      traceSec: 30,
      answer: "yes",
    }),
    def: movementDef(input.movement),
    mirrored: false,
    painBefore: 0,
    askCauseBelow: null,
    poseModel: input.model,
  });
  const driver = new RomSmokeDriver(runner, { answerDelayMs, now: () => 0 });
  driver.start(frames[0].t);
  for (const f of frames) {
    if (driver.done) break;
    driver.feed(f);
  }
  return driver.report(frames[frames.length - 1].t, driver.done ? undefined : "timeout");
}
