/**
 * The Pose2Sim and Sports2D angle maths of src/engine/rom/angles.ts (product v7 contract 2.3, 6.1 and
 * 6.2) against the Python functions on tests/golden/points_to_angles.json
 * (scripts/golden/make_golden.py), within 1e-6 degrees: points_to_angles, fixed_angles, and every
 * angle of Pose2Sim's angle_dict in MediaPipe terms after the Sports2D side flip. The upstream left
 * wrist (vertex at the index finger) is not copied: ours matches the right wrist, which a mirror test
 * asserts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  POSE2SIM_ANGLES,
  fixedAngle,
  pointsToAngle,
  pose2simAngle,
  resolveVisibleSide,
  unsignedAngle,
  type Pose2SimAngleId,
  type Pt,
  type VisibleSide,
} from "../../src/engine/rom/angles";

interface Golden {
  pointsToAngle: { points: number[]; angle: number }[];
  fixedAngle: {
    name: string;
    points: number[];
    offset: number;
    scale: number;
    angle: number;
    fixed: number;
  }[];
  angleIds: string[];
  sports2d: {
    pose: number[];
    results: { visibleSide: VisibleSide; resolved: string; angles: (number | null)[] }[];
  }[];
}
const GOLDEN = JSON.parse(readFileSync(join(__dirname, "../golden/points_to_angles.json"), "utf8")) as Golden;
const TOL = 1e-6;

const pts = (flat: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
};
/** Python's modulo wraps to [-180, 180), ours to (-180, 180]: compare on the circle. */
const onCircle = (a: number, b: number, turn = 360) => {
  const d = (((a - b) % turn) + turn) % turn;
  return Math.min(d, turn - d);
};
const HALF_TURN: ReadonlySet<string> = new Set(["pelvis", "shoulders"]);

describe("pointsToAngle (Pose2Sim points_to_angles)", () => {
  it("matches every golden point set, in (-180, 180]", () => {
    expect(GOLDEN.pointsToAngle.length).toBeGreaterThan(150);
    for (const c of GOLDEN.pointsToAngle) {
      const a = pointsToAngle(pts(c.points));
      expect(onCircle(a, c.angle), JSON.stringify(c)).toBeLessThan(TOL);
      expect(a).toBeGreaterThan(-180);
      expect(a).toBeLessThanOrEqual(180);
    }
  });

  it("is NaN for fewer than 2 or more than 4 points, as upstream", () => {
    expect(pointsToAngle([{ x: 0, y: 0 }])).toBeNaN();
    expect(pointsToAngle(pts([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]))).toBeNaN();
  });

  it("reads 2 points as the segment against the horizontal, 180 rather than -180", () => {
    expect(pointsToAngle(pts([1, 0, 0, 0]))).toBe(0);
    expect(pointsToAngle(pts([-1, 0, 0, 0]))).toBe(180);
    expect(pointsToAngle(pts([-1, -0, 0, 0]))).toBe(180);
  });
});

describe("fixedAngle (Pose2Sim fixed_angles)", () => {
  it("matches every golden angle that wraps on the full turn", () => {
    let n = 0;
    for (const c of GOLDEN.fixedAngle) {
      expect(onCircle(pointsToAngle(pts(c.points)), c.angle)).toBeLessThan(TOL);
      if (HALF_TURN.has(c.name)) continue;
      const f = fixedAngle(c.angle, c.offset, c.scale);
      expect(onCircle(f, c.fixed), JSON.stringify(c)).toBeLessThan(TOL);
      expect(f).toBeGreaterThan(-180);
      expect(f).toBeLessThanOrEqual(180);
      n++;
    }
    expect(n).toBeGreaterThan(100);
  });

  it("wraps to (-180, 180]", () => {
    expect(fixedAngle(170, 20, 1)).toBeCloseTo(-170, 12);
    expect(fixedAngle(90, 90, 1)).toBe(180);
    expect(fixedAngle(-90, -90, 1)).toBe(180);
    expect(fixedAngle(30, 0, -1)).toBe(-30);
    expect(fixedAngle(100, -180, 1)).toBe(-80);
  });
});

describe("unsignedAngle (ang of the clinical conventions)", () => {
  it("is atan2(|u x v|, u . v): 0 to 180, symmetric", () => {
    expect(unsignedAngle({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 12);
    expect(unsignedAngle({ x: 0, y: 1 }, { x: 1, y: 0 })).toBeCloseTo(90, 12);
    expect(unsignedAngle({ x: 1, y: 0 }, { x: -1, y: 0 })).toBe(180);
    expect(unsignedAngle({ x: 2, y: 2 }, { x: 1, y: 1 })).toBe(0);
    expect(unsignedAngle({ x: 1, y: 0 }, { x: 1, y: -1 })).toBeCloseTo(45, 12);
    expect(unsignedAngle({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0);
  });
});

describe("POSE2SIM_ANGLES with the Sports2D flip", () => {
  it("has every angle of the golden list (head needs a keypoint BlazePose lacks)", () => {
    const ids = GOLDEN.angleIds.filter((a) => a !== "left_wrist_azm");
    expect(Object.keys(POSE2SIM_ANGLES).sort()).toEqual([...ids].sort());
  });

  it("matches Sports2D compute_angles_for_person on every golden pose and visible side", () => {
    let n = 0;
    for (const p of GOLDEN.sports2d) {
      const pose = pts(p.pose);
      for (const r of p.results) {
        expect(resolveVisibleSide(pose, r.visibleSide)).toBe(r.resolved);
        GOLDEN.angleIds.forEach((name, i) => {
          if (name === "left_wrist") return; // the upstream definition, not copied (below)
          const id = (name === "left_wrist_azm" ? "left_wrist" : name) as Pose2SimAngleId;
          const want = r.angles[i];
          expect(want).not.toBeNull();
          const got = pose2simAngle(id, pose, r.visibleSide);
          const turn = HALF_TURN.has(id) ? 180 : 360;
          expect(onCircle(got, want!, turn), `${id} ${r.visibleSide}`).toBeLessThan(TOL);
          n++;
        });
      }
    }
    expect(n).toBeGreaterThan(1000);
  });

  it("measures the left side like the right on a mirrored picture (the upstream left wrist would not)", () => {
    const swap = (i: number) => (i >= 11 ? (i % 2 ? i + 1 : i - 1) : [0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9][i]);
    let upstreamDiffers = false;
    for (const p of GOLDEN.sports2d) {
      const pose = pts(p.pose);
      // The person seen in a mirror: x reflected and the model's left and right labels exchanged.
      const mirrored = pose.map((_, i) => ({ x: 1080 - pose[swap(i)].x, y: pose[swap(i)].y }));
      for (const [left, right] of [
        ["left_wrist", "right_wrist"],
        ["left_elbow", "right_elbow"],
        ["left_shoulder", "right_shoulder"],
        ["left_hip", "right_hip"],
        ["left_knee", "right_knee"],
        ["left_ankle", "right_ankle"],
        ["left_foot", "right_foot"],
        ["left_shank", "right_shank"],
        ["left_thigh", "right_thigh"],
        ["left_arm", "right_arm"],
        ["left_forearm", "right_forearm"],
        ["left_hand", "right_hand"],
      ] as const) {
        const a = pose2simAngle(left, mirrored, "auto");
        const b = pose2simAngle(right, pose, "auto");
        expect(onCircle(a, b), `${left} ${right}`).toBeLessThan(1e-9);
      }
      // Upstream's left wrist puts the vertex at the index finger: ['LElbow', 'LIndex', 'LWrist'].
      const L = (i: number) => mirrored[i];
      const flip = resolveVisibleSide(mirrored, "auto") === "left" ? -1 : 1;
      const f = (q: Pt) => ({ x: flip * q.x, y: q.y });
      const upstream = fixedAngle(pointsToAngle([f(L(13)), f(L(19)), f(L(15))]), -180, 1);
      if (onCircle(upstream, pose2simAngle("right_wrist", pose, "auto")) > 1) upstreamDiffers = true;
    }
    expect(upstreamDiffers).toBe(true);
  });
});
