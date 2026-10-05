/**
 * Step G1 (product v7 contract 8.4): the procedural humanoid that renders the smoke videos with
 * exact truth (scripts/smoke/humanoid.mjs). Only the kinematics and the camera projection run here;
 * the shader runs in Chromium (scripts/smoke/render.mjs).
 */
import { describe, expect, it } from "vitest";
import { BODY, J, armAbductionDeg, project, skeleton, standingPose } from "../../scripts/smoke/humanoid.mjs";

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const lowestSole = (j: V[]) => Math.min(j[J.HEEL_L][1], j[J.HEEL_R][1], j[J.TOE_L][1], j[J.TOE_R][1]);

describe("skeleton", () => {
  it("keeps every segment length and stands on the floor", () => {
    const s = skeleton({ ...standingPose([1, 0, 0]), hip: { l: 25, r: -8 }, knee: { l: 5, r: 40 } });
    const j = s.joints as V[];
    expect(len(sub(j[J.KNEE_R], j[J.HIP_R]))).toBeCloseTo(BODY.thigh, 9);
    expect(len(sub(j[J.ANK_L], j[J.KNEE_L]))).toBeCloseTo(BODY.shank, 9);
    expect(len(sub(j[J.ELB_R], j[J.SH_R]))).toBeCloseTo(BODY.upperArm, 9);
    expect(len(sub(j[J.WR_L], j[J.ELB_L]))).toBeCloseTo(BODY.foreArm, 9);
    // The lowest point of the soles (the sole's radius under the heel and toe points) is the floor.
    expect(lowestSole(j)).toBeGreaterThan(0);
    expect(lowestSole(j)).toBeLessThan(0.06);
  });

  it("puts the person's right side on the right of their forward direction", () => {
    // Facing the camera (forward +z, the camera on +z): the right side is toward -x.
    const s = skeleton(standingPose([0, 0, 1]));
    expect(s.joints[J.SH_R][0]).toBeLessThan(s.joints[J.SH_L][0]);
    expect(s.joints[J.HIP_R][0]).toBeLessThan(s.joints[J.HIP_L][0]);
    // Walking toward +x seen from +z: the right side faces the camera.
    const w = skeleton(standingPose([1, 0, 0]));
    expect(w.joints[J.HIP_R][2]).toBeGreaterThan(w.joints[J.HIP_L][2]);
  });

  it("raises the arm to the side by exactly the abduction asked, in the frontal plane", () => {
    for (const deg of [0, 45, 90, 135, 160]) {
      const s = skeleton({
        ...standingPose([0, 0, 1]),
        shoulderAbd: { l: 8, r: deg },
        elbow: { l: 5, r: 0 },
      });
      expect(armAbductionDeg(s, "right")).toBeCloseTo(deg, 6);
      // No flexion: the elbow stays in the frontal plane of the shoulder.
      expect(s.joints[J.ELB_R][2]).toBeCloseTo(s.joints[J.SH_R][2], 9);
    }
  });

  it("sits: thighs level and shanks upright at 90 degrees of hip and knee flexion", () => {
    const s = skeleton({ ...standingPose([0, 0, 1]), hip: { l: 90, r: 90 }, knee: { l: 90, r: 90 } });
    const j = s.joints as V[];
    expect(j[J.KNEE_R][1]).toBeCloseTo(j[J.HIP_R][1], 9);
    expect(j[J.ANK_R][0]).toBeCloseTo(j[J.KNEE_R][0], 9);
    expect(j[J.ANK_R][2]).toBeCloseTo(j[J.KNEE_R][2], 9);
    expect(s.seatY).toBeGreaterThan(0.35);
    expect(s.seatY).toBeLessThan(0.5);
  });
});

describe("project", () => {
  const cam = { pos: [0, 1, 3] as V, target: [0, 1, 0] as V, fovY: 50 };

  it("puts the look at point in the middle and up as up", () => {
    expect(project([0, 1, 0], cam, 960, 540)).toEqual({ x: 0.5, y: 0.5, depth: 3 });
    const above = project([0, 1.5, 0], cam, 960, 540);
    expect(above.y).toBeLessThan(0.5);
    // Half the vertical field of view reaches the top edge.
    const top = project([0, 1 + 3 * Math.tan((25 * Math.PI) / 180), 0], cam, 960, 540);
    expect(top.y).toBeCloseTo(0, 9);
    // +x is to the right of a camera on +z looking at -z.
    expect(project([0.5, 1, 0], cam, 960, 540).x).toBeGreaterThan(0.5);
  });

  it("scales x by the height, so a picture's aspect does not stretch it", () => {
    const p = project([0.3, 1.3, 0], cam, 960, 540);
    const q = project([0.3, 1.3, 0], cam, 540, 960);
    // The same offset in pixels on both axes for a 45 degree point.
    expect((p.x - 0.5) * 960).toBeCloseTo((0.5 - p.y) * 540, 6);
    expect((q.x - 0.5) * 540).toBeCloseTo((0.5 - q.y) * 960, 6);
  });
});
