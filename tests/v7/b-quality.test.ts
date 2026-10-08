/**
 * The quality gate and setup check configuration of the v7 movements (src/engine/rom/quality.ts,
 * product v7 contract 2.6 and 7): the v1 QualityMonitor and setupCheck with each movement's landmarks,
 * view, distance and level from the range of motion data, and no v1 cue (testId null).
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  ARM_ROOM_FACTOR,
  distanceBand,
  movementLandmarks,
  readSide,
  romQualityConfig,
  romSetupConfig,
} from "../../src/engine/rom/quality";
import {
  QualityMonitor,
  qualityConfig,
  setupCheck,
  setupConfig,
  CAMERA_MODEL,
} from "../../src/engine/quality";
import { SubjectLock } from "../../src/engine/subject";
import { ROM_DATA, movementDef } from "../../src/movements/rom";
import { ROM_MOVEMENT_IDS } from "../../src/movements/rom/types";
import { testDef } from "../../src/movements/assessments";
import { FIXTURE_ROOT, fixtureFrames, loadFixture } from "../fixtures/format";

const E = ROM_DATA.engine;

describe("romQualityConfig reads the movement's data", () => {
  for (const id of ROM_MOVEMENT_IDS) {
    it(id, () => {
      const def = movementDef(id);
      const side = def.axial && !def.bothDirections ? "none" : "right";
      const c = romQualityConfig(def, side, { cameraSide: "right" });
      expect(c.testId).toBeNull();
      expect(c.minVisibility).toBe(E.visibilityMin);
      expect(c.minFps).toBe(E.fpsMin);
      expect(c.views).toEqual([def.view]);
      expect(c.distanceM).toEqual(distanceBand(def));
      expect(c.gate.length).toBeGreaterThan(0);
      // A gate landmark is never also optional.
      for (const i of c.gate) expect(c.optional).not.toContain(i);
      const s = romSetupConfig(def, side, { cameraSide: "right" });
      expect(s.testId).toBeNull();
      expect(s.tiltMaxDeg).toBe(def.levelWithinDeg ?? E.phoneLevelToleranceDeg);
      // The setup frames what the start pose needs (the arm raise to the front's hip may be out of
      // the picture: gravity mode, D-034 item 1).
      for (const i of romQualityConfig(def, side, { cameraSide: "right", gravityMode: true }).gate)
        expect(s.framing).toContain(i);
      expect(s.armRoom).toBe(def.frameMarginArmLengths !== undefined);
    });
  }

  it("a distance written as one value is a band of that value (FZ-7), the tolerance is v1's", () => {
    expect(distanceBand(movementDef("elbow_extension"))).toEqual([2, 2]);
    expect(distanceBand(movementDef("neck_lateral_flexion"))).toEqual([1.5, 1.5]);
    expect(distanceBand(movementDef("knee_flexion"))).toEqual([2, 3]);
    expect(CAMERA_MODEL.distanceTolerance).toBe(0.25);
  });

  it("the side arm raise's frame margin is the v1 arm room factor", () => {
    expect(movementDef("shoulder_abduction").frameMarginArmLengths).toBe(ARM_ROOM_FACTOR);
    expect(romSetupConfig(movementDef("shoulder_abduction"), "left").armRoom).toBe(true);
  });
});

describe("the gate landmarks of each side", () => {
  it("the side arm raise gates the v1 landmarks: both shoulders and the tested elbow", () => {
    for (const side of ["left", "right"] as const) {
      const v7 = romQualityConfig(movementDef("shoulder_abduction"), side);
      const v1 = qualityConfig(testDef("shoulder_abduction"), side);
      expect(v7.gate).toEqual([...v1.gate].sort((a, b) => a - b));
      // The fixed mid hip is read once, at calibration: optional in an attempt, as v1's hips.
      expect(v7.gate).not.toContain(23);
      expect(v7.optional).toEqual(expect.arrayContaining([23, 24]));
      expect(v7.minFps).toBe(v1.minFps);
      expect(v7.distanceM).toEqual(v1.distanceM);
      expect(v7.views).toEqual(v1.views);
    }
  });

  it("a mirrored picture reads the other labels", () => {
    const def = movementDef("knee_flexion");
    expect(romQualityConfig(def, "right").gate).toEqual([24, 26, 28]);
    expect(romQualityConfig(def, "left").gate).toEqual([23, 25, 27]);
    expect(romQualityConfig(def, "right", { mirrored: true }).gate).toEqual([23, 25, 27]);
    expect(readSide(def, "right", true)).toBe("left");
  });

  it("the arm raises to the front and to the back never fail an attempt for the hip (D-034 item 1)", () => {
    // A frame whose hip is hidden or at the picture's edge reads the start trunk line (angles.ts).
    const def = movementDef("shoulder_flexion");
    for (const gravityMode of [false, true]) {
      expect(romQualityConfig(def, "left", { gravityMode }).gate).toEqual([11, 13]);
      expect(romQualityConfig(def, "left", { gravityMode }).optional).toContain(23);
    }
    const back = movementDef("shoulder_extension");
    expect(romQualityConfig(back, "right").gate).toEqual([12, 14]);
    expect(romQualityConfig(back, "right").optional).toContain(24);
    // The start pose still needs the hip for the trunk line of the arm raise to the back.
    expect(romSetupConfig(back, "right").framing).toEqual([12, 14, 24]);
    expect(romSetupConfig(def, "left").framing).toEqual([11, 13]);
  });

  it("an axial side view reads the camera side; an axial front view reads both", () => {
    expect(romQualityConfig(movementDef("trunk_flexion"), "none", { cameraSide: "left" }).gate).toEqual([
      11, 23,
    ]);
    expect(romQualityConfig(movementDef("trunk_flexion"), "none", { cameraSide: "right" }).gate).toEqual([
      12, 24,
    ]);
    expect(readSide(movementDef("trunk_lateral_flexion"), "left", false)).toBeNull();
    // MS and MH: both shoulders and both hips.
    expect(romQualityConfig(movementDef("trunk_lateral_flexion"), "left").gate).toEqual([11, 12, 23, 24]);
    // The knees are optional: never framed (D-034 item 1), the trunk is.
    expect(romSetupConfig(movementDef("trunk_lateral_flexion"), "left").framing).toEqual([11, 12, 23, 24]);
  });

  it("the head tilt's ears or eyes are not a gate (the angle reads either), only reported", () => {
    const c = romQualityConfig(movementDef("neck_lateral_flexion"), "left");
    expect(c.gate).toEqual([11, 12]);
    expect(c.optional).toEqual(expect.arrayContaining([2, 5, 7, 8]));
  });

  it("the other knee of the hip bend is the other side's", () => {
    const { optional } = movementLandmarks(movementDef("hip_flexion"), "right");
    expect(optional).toContain(25);
    expect(optional).not.toContain(26);
  });
});

describe("the monitor and the setup check run with the v7 configuration", () => {
  it("the six v1 arm raise fixtures pass or fail the gate the same way with the v1 and the v7 configuration", () => {
    for (const file of [
      "chair/raise-right-9x16.json",
      "standing/phone-shake-16x9.json",
      "weaker_left/helper-beside-9x16.json",
      "wheelchair/raise-left-16x9.json",
      "chair/helper-touch-9x16.json",
      "weaker_right/helper-crossing-16x9.json",
    ]) {
      type Truth = { armPeakDeg: { left: number; right: number } };
      const fx = loadFixture<Truth>(join(FIXTURE_ROOT, "shoulder_abduction", file));
      const side = fx.truth.armPeakDeg.left > fx.truth.armPeakDeg.right ? "left" : "right";
      const frames = fixtureFrames(fx);
      const lock = new SubjectLock();
      lock.lock(frames[0].poses ?? [frames[0].lm], frames[0].aspect);
      const v1 = new QualityMonitor(
        qualityConfig(testDef("shoulder_abduction"), side, { trunkReference: false }),
      );
      const v7 = new QualityMonitor(romQualityConfig(movementDef("shoulder_abduction"), side));
      for (const f of frames) {
        const pick = lock.pickFrame(f);
        v1.feedPick(f, pick);
        v7.feedPick(f, pick);
      }
      const a = v1.report();
      const b = v7.report();
      expect(b.ok, file).toBe(a.ok);
      expect(b.issues, file).toEqual(a.issues);
      expect(b.cue).toBeNull();
    }
  });

  it("setupCheck takes the v7 configuration and gives issues with no cue", () => {
    const fx = loadFixture(join(FIXTURE_ROOT, "shoulder_abduction", "chair/raise-right-9x16.json"));
    const frames = fixtureFrames(fx).slice(0, 10);
    const setup = frames.map((f) => ({ t: f.t, poses: f.poses ?? [f.lm], aspect: f.aspect }));
    const v1 = setupCheck(setup, setupConfig(testDef("shoulder_abduction"), "right"), {
      tilt: { rollDeg: 0, pitchDeg: 0 },
    });
    const v7 = setupCheck(setup, romSetupConfig(movementDef("shoulder_abduction"), "right"), {
      tilt: { rollDeg: 0, pitchDeg: 7 },
    });
    expect(v1.ok).toBe(true);
    expect(v7.issues).toEqual(["tilt"]);
    expect(v7.cue).toBeNull();
  });
});
