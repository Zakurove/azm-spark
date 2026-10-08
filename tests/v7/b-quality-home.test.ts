/**
 * The v7 range gate after Nasser's first real test (D-034 item 1): a movement needs only the landmarks
 * it measures in the picture. Being close is fine while they are in it (out_of_frame says when they
 * are not); too far only when the model can no longer track them (beyond its 4 m, rom.md [S31]); a
 * wrong view is advice for one calm cue, never a block. The v1 tests keep their gate exactly.
 */
import { describe, expect, it } from "vitest";
import {
  CAMERA_MODEL,
  QualityMonitor,
  qualityConfig,
  setupCheck,
  type QualityConfig,
} from "../../src/engine/quality";
import { movementLandmarks, romQualityConfig, romSetupConfig } from "../../src/engine/rom/quality";
import { SubjectLock, SUBJECT_RULES } from "../../src/engine/subject";
import { testDef } from "../../src/movements/assessments";
import { movementDef } from "../../src/movements/rom";
import { ROM_MOVEMENT_IDS } from "../../src/movements/rom/types";
import type { Landmark } from "../../src/engine/types";
import { RomRunner } from "../../src/engine/rom/runner";
import { generate } from "../fixtures/gen";
import { item } from "./b-driver";
import { fixtureFrames } from "../fixtures/format";
import { romSpec } from "../fixtures/rom/build";

/** A seated person facing the phone, every landmark seen, scaled about the picture's middle (bigger: closer). */
function frontPose(scale: number, dx = 0): Landmark[] {
  const base: [number, number][] = Array.from({ length: 33 }, () => [0.5, 0.5]);
  const put = (i: number, x: number, y: number) => (base[i] = [x, y]);
  put(0, 0.5, 0.3);
  for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) put(i, 0.5 + (i % 2 ? -0.02 : 0.02), 0.29);
  put(11, 0.58, 0.4);
  put(12, 0.42, 0.4);
  put(13, 0.6, 0.5);
  put(14, 0.4, 0.5);
  put(15, 0.61, 0.58);
  put(16, 0.39, 0.58);
  for (const i of [17, 19, 21]) put(i, 0.61, 0.6);
  for (const i of [18, 20, 22]) put(i, 0.39, 0.6);
  put(23, 0.55, 0.6);
  put(24, 0.45, 0.6);
  put(25, 0.55, 0.62);
  put(26, 0.45, 0.62);
  for (const i of [27, 29, 31]) put(i, 0.55, 0.8);
  for (const i of [28, 30, 32]) put(i, 0.45, 0.8);
  return base.map(([x, y]) => ({
    x: 0.5 + (x - 0.5) * scale + dx,
    y: 0.5 + (y - 0.5) * scale,
    z: 0,
    visibility: 0.98,
  }));
}

/** The same person turned so the shoulders narrow to a quarter (a side view in the picture). */
function sidePose(scale: number): Landmark[] {
  return frontPose(scale).map((q, i) =>
    [11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31].includes(i) ||
    [12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32].includes(i)
      ? { ...q, x: 0.5 + (q.x - 0.5) * 0.25 }
      : q,
  );
}

function report(cfg: QualityConfig, lm: Landmark[], n = 30, aspect = 0.75) {
  const m = new QualityMonitor(cfg);
  for (let k = 0; k < n; k++) m.feed({ t: k * 33, lm, aspect });
  return m.report();
}

describe("the v7 gate reads the distance only to say a person is too far to track", () => {
  const cfg = romQualityConfig(movementDef("shoulder_abduction"), "right");

  it("close but in the picture: ok, and the v1 arm raise still says too close", () => {
    // The trunk 0.3 of a 3:4 picture's height: the proxy reads about 1.3 m, under the data's 2 to 3 m.
    const close = report(cfg, frontPose(1.5));
    expect(close.distanceM).toBeLessThan(1.5);
    expect(close.issues).toEqual([]);
    expect(close.ok).toBe(true);
    const v1 = report(
      qualityConfig(testDef("shoulder_abduction"), "right", { trunkReference: false }),
      frontPose(1.5),
    );
    expect(v1.issues).toContain("too_close");
  });

  it("so close the measured landmarks leave the picture: out of frame, not too close", () => {
    // The tested (right) shoulder and elbow past the picture's left edge.
    const r = report(cfg, frontPose(1.5, -0.4));
    expect(r.issues).toContain("out_of_frame");
    expect(r.issues).not.toContain("too_close");
    expect(r.ok).toBe(false);
  });

  it("too far only beyond the model's limit (CAMERA_MODEL.maxDistanceM)", () => {
    expect(CAMERA_MODEL.maxDistanceM).toBe(4);
    const at3 = report(cfg, frontPose(0.7));
    expect(at3.distanceM).toBeGreaterThan(2.5);
    expect(at3.distanceM).toBeLessThan(CAMERA_MODEL.maxDistanceM);
    expect(at3.issues).toEqual([]);
    const far = report(cfg, frontPose(0.4));
    expect(far.distanceM).toBeGreaterThan(CAMERA_MODEL.maxDistanceM);
    expect(far.issues).toEqual(["too_far"]);
  });

  it("every movement's gate and setup check read the distance this way", () => {
    for (const id of ROM_MOVEMENT_IDS) {
      const def = movementDef(id);
      const side = def.axial && !def.bothDirections ? "none" : "right";
      expect(romQualityConfig(def, side).distanceRule, id).toBe("trackable");
      expect(romSetupConfig(def, side).distanceRule, id).toBe("trackable");
    }
    expect(qualityConfig(testDef("shoulder_abduction"), "right").distanceRule ?? "band").toBe("band");
  });
});

describe("a wrong view is advice, never a block", () => {
  it("the side arm raise filmed from the side: ok, with the view as advice", () => {
    const r = report(romQualityConfig(movementDef("shoulder_abduction"), "right"), sidePose(0.6));
    expect(r.view).toBe("side");
    expect(r.viewOk).toBe(false);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.advice).toEqual(["wrong_view"]);
  });

  it("the right view gives no advice; v1 still blocks a wrong view", () => {
    const r = report(romQualityConfig(movementDef("shoulder_abduction"), "right"), frontPose(0.6));
    expect(r.advice).toEqual([]);
    const v1 = report(
      qualityConfig(testDef("shoulder_abduction"), "right", { trunkReference: false }),
      sidePose(0.6),
    );
    expect(v1.issues).toContain("wrong_view");
    expect(v1.advice).toBeUndefined();
  });
});

describe("the v7 setup check frames only the landmarks a movement needs", () => {
  it("the framing is the start pose's gate: never a knee, an ankle or an optional landmark", () => {
    for (const id of ROM_MOVEMENT_IDS) {
      const def = movementDef(id);
      const side = def.axial && !def.bothDirections ? "none" : "right";
      const required = movementLandmarks(def, side, { gravityMode: true }).gate;
      expect(romSetupConfig(def, side).framing, id).toEqual(required);
    }
    for (const id of [
      "shoulder_flexion",
      "shoulder_abduction",
      "shoulder_extension",
      "elbow_extension",
      "elbow_flexion",
      "neck_lateral_flexion",
      "neck_flexion",
      "neck_extension",
    ] as const)
      for (const leg of [25, 26, 27, 28, 29, 30, 31, 32])
        expect(romSetupConfig(movementDef(id), "right").framing, id).not.toContain(leg);
  });

  it("close, turned, or without room for the whole arm: nothing to fix while the needed landmarks show", () => {
    const frames = (lm: Landmark[]) =>
      Array.from({ length: 10 }, (_, k) => ({ t: k * 33, poses: [lm], aspect: 0.75 }));
    const abd = setupCheck(
      frames(frontPose(1.5)),
      romSetupConfig(movementDef("shoulder_abduction"), "right"),
    );
    expect(abd.distanceM).toBeLessThan(1.5);
    expect(abd.issues).toEqual([]);
    expect(abd.warnings).toEqual(expect.arrayContaining(["arm_room"]));
    const turned = setupCheck(
      frames(sidePose(1)),
      romSetupConfig(movementDef("shoulder_abduction"), "right"),
    );
    expect(turned.issues).toEqual([]);
    expect(turned.warnings).toContain("wrong_view");
  });
});

describe("the v7 subject lock follows the shoulders (D-034 item 1)", () => {
  /**
   * A seated side view with the hips below the picture. The model guesses them, with a high
   * visibility, inside the picture, and the guess swings with the arm: in the real model smoke of the
   * seated arm raise to the front (Lite) the mid hip moved up to 0.13 of the height between frames and
   * stayed there while the arm was up. Here the guess steps by 0.1 every second and stays.
   */
  const spec = {
    ...romSpec({
      name: "lock/hips-out",
      movement: "shoulder_flexion",
      position: "seated",
      side: "right",
      aspect: "3:4",
      peak: 120,
      reps: 2,
    }),
    camera: { distance: 1.3, height: 1.25, fovShortDeg: 42 },
  } as const;
  const frames = fixtureFrames(generate(spec)).map((f) => {
    const step = Math.floor(f.t / 1000) % 2 ? -0.1 : 0;
    const guess = (lm: Landmark[]) =>
      lm.map((q, i) => (i === 23 || i === 24 ? { ...q, y: 0.9 + step, visibility: 0.95 } : q));
    return { ...f, lm: guess(f.lm), poses: f.poses?.map(guess) };
  });

  const pausedShare = (lock: SubjectLock) => {
    lock.lock(frames[0].poses ?? [frames[0].lm], frames[0].aspect);
    for (const f of frames) lock.pickFrame(f);
    return lock.pausedShare;
  };

  it("the hips guessed below the shoulders: v1's hip anchor pauses on each step, the shoulders anchor does not", () => {
    expect(pausedShare(new SubjectLock())).toBeGreaterThan(SUBJECT_RULES.maxPausedShare);
    expect(pausedShare(new SubjectLock(SUBJECT_RULES, { anchor: "shoulders" }))).toBe(0);
  });

  it("a swap to another person still pauses", () => {
    const lock = new SubjectLock(SUBJECT_RULES, { anchor: "shoulders" });
    const me = frontPose(0.6);
    const other = frontPose(0.6, 0.3);
    lock.lock([me], 0.75);
    expect(lock.pick([me], 0.75, 0).paused).toBe(false);
    const swap = lock.pick([other], 0.75, 33);
    expect(swap.paused).toBe(true);
    expect(swap.reason).toBe("jump");
  });

  it("the range runner's own lock is the shoulders anchor", () => {
    const r = new RomRunner({
      item: item("elbow_flexion"),
      def: movementDef("elbow_flexion"),
      askCauseBelow: null,
      poseModel: "full",
    });
    expect(r.lock.anchorKind).toBe("shoulders");
    expect(new SubjectLock().anchorKind).toBe("hip");
  });
});
