import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ files: vi.fn(), create: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: mocks.files },
  PoseLandmarker: { createFromOptions: mocks.create },
}));

import {
  computeMetrics,
  effectiveAspect,
  shoulderWidth,
  toPixelSpace,
  trunkLength,
} from "../src/engine/geometry";
import { PoseSmoother } from "../src/engine/oneEuro";
import { Frame, LM, Landmark, MetricId } from "../src/engine/types";
import { CameraPoseSource, videoAspect } from "../src/app/poseSource";

/**
 * D-003: angles and length ratios must be measured in pixel space.
 *
 * Every pose below is built in PIXELS on a real image size, where the true
 * angle is known exactly, then normalized the way MediaPipe does it
 * (x ÷ width, y ÷ height). With `aspect` set, computeMetrics must return the
 * true value. With `aspect` undefined on a non square image, the legacy
 * behaviour, the value is distorted.
 */

const DEG = Math.PI / 180;
const SIZES = [
  { name: "landscape 1280x720 (16:9)", w: 1280, h: 720 },
  { name: "portrait 720x1280 (9:16)", w: 720, h: 1280 },
  { name: "square 720x720 (1:1)", w: 720, h: 720 },
] as const;
const ALL: MetricId[] = [
  "elbow_flex_l",
  "elbow_flex_r",
  "elbow_flex_mean",
  "knee_flex_l",
  "knee_flex_r",
  "knee_flex_mean",
  "shoulder_abd_l",
  "shoulder_abd_r",
  "trunk_lean",
  "shoulder_hike",
  "arm_asym",
  "hip_height",
];

type P = { x: number; y: number };
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
const unit = (a: P): P => scale(a, 1 / Math.hypot(a.x, a.y));
/** direction at `deg` from straight down, positive towards image right (y grows downward) */
const down = (deg: number): P => ({ x: Math.sin(deg * DEG), y: Math.cos(deg * DEG) });
/** rotate a direction by `deg` (image coordinates, y down: positive turns clockwise on screen) */
const rot = (v: P, deg: number): P => ({
  x: v.x * Math.cos(deg * DEG) - v.y * Math.sin(deg * DEG),
  y: v.x * Math.sin(deg * DEG) + v.y * Math.cos(deg * DEG),
});

interface PoseSpec {
  /** true trunk lean from vertical, degrees, positive = shoulders towards image right */
  leanDeg?: number;
  /** true interior elbow angles, degrees */
  elbowL?: number;
  elbowR?: number;
  /** true shoulder abduction (angle hip, shoulder, elbow), degrees */
  abdL?: number;
  abdR?: number;
  /** left shoulder higher than right by this fraction of trunk length */
  hike?: number;
  /** ankle midpoint below hip midpoint by this fraction of trunk length */
  hipHeight?: number;
  /** true interior knee angle, degrees */
  knee?: number;
}

/**
 * A seated figure in pixel space. Unit `u` is a quarter of the short image
 * side so the whole figure fits in every orientation. Returns pixel points.
 */
function pixelPose(w: number, h: number, s: PoseSpec): Map<number, P> {
  const u = Math.min(w, h) * 0.25;
  const T = 1.0 * u; // trunk length (shoulder midpoint to hip midpoint)
  const upper = 0.55 * u,
    fore = 0.5 * u,
    thigh = 0.6 * u,
    shin = 0.55 * u;
  const lean = s.leanDeg ?? 0;
  const hipMid: P = { x: w / 2, y: h / 2 + 0.4 * u };
  const axisUp = rot({ x: 0, y: -1 }, lean); // hip → shoulder direction
  // Shoulder and hip lines stay level, so shoulder_hike carries only the hike we add.
  const across: P = { x: 1, y: 0 };
  const shMid = add(hipMid, scale(axisUp, T));
  const hike = (s.hike ?? 0) * T; // split evenly so the shoulder midpoint stays put
  const lSh = add(add(shMid, scale(across, -0.4 * u)), { x: 0, y: -hike / 2 });
  const rSh = add(add(shMid, scale(across, 0.4 * u)), { x: 0, y: hike / 2 });
  const lHip = add(hipMid, scale(across, -0.3 * u));
  const rHip = add(hipMid, scale(across, 0.3 * u));

  // Arms. With abduction given, the upper arm is the shoulder→hip direction turned
  // outward by that angle. Otherwise it hangs 30° off vertical (never axis aligned,
  // so a square assumption visibly distorts the elbow angle).
  const upperDir = (side: -1 | 1, sh: P, hip: P, abd?: number) =>
    abd === undefined ? down(side * 30) : rot(unit({ x: hip.x - sh.x, y: hip.y - sh.y }), -side * abd);
  // Forearm: interior angle θ at the elbow means the forearm is the upper arm
  // direction turned by (180 − θ), bending towards the midline.
  const arm = (side: -1 | 1, sh: P, hip: P, abd: number | undefined, elbow: number) => {
    const ud = upperDir(side, sh, hip, abd);
    const e = add(sh, scale(ud, upper));
    const wr = add(e, scale(rot(ud, side * (180 - elbow)), fore));
    return { e, wr };
  };
  const L = arm(-1, lSh, lHip, s.abdL, s.elbowL ?? 150);
  const R = arm(1, rSh, rHip, s.abdR, s.elbowR ?? 150);

  // Legs: thigh 20° off horizontal towards the camera side, knee angle as given.
  const knee = s.knee ?? 90;
  const leg = (hip: P) => {
    const td = unit({ x: Math.cos(20 * DEG), y: Math.sin(20 * DEG) });
    const k = add(hip, scale(td, thigh));
    const an = add(k, scale(rot(td, 180 - knee), shin));
    return { k, an };
  };
  const LL = leg(lHip),
    RL = leg(rHip);
  const pts = new Map<number, P>([
    [LM.nose, add(shMid, scale(axisUp, 0.45 * u))],
    [LM.l_shoulder, lSh],
    [LM.r_shoulder, rSh],
    [LM.l_elbow, L.e],
    [LM.r_elbow, R.e],
    [LM.l_wrist, L.wr],
    [LM.r_wrist, R.wr],
    [LM.l_hip, lHip],
    [LM.r_hip, rHip],
    [LM.l_knee, LL.k],
    [LM.r_knee, RL.k],
    [LM.l_ankle, LL.an],
    [LM.r_ankle, RL.an],
  ]);
  if (s.hipHeight !== undefined) {
    // Place both ankles so the ankle midpoint sits exactly hipHeight × T below the hip midpoint.
    const dy = s.hipHeight * T - ((LL.an.y + RL.an.y) / 2 - hipMid.y);
    pts.set(LM.l_ankle, add(LL.an, { x: 0, y: dy }));
    pts.set(LM.r_ankle, add(RL.an, { x: 0, y: dy }));
  }
  return pts;
}

/** Normalize like MediaPipe: x ÷ width, y ÷ height. */
function normalize(pts: Map<number, P>, w: number, h: number): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const [i, p] of pts) lm[i] = { x: p.x / w, y: p.y / h, z: 0, visibility: 0.95 };
  return lm;
}

function frames(w: number, h: number, s: PoseSpec) {
  const lm = normalize(pixelPose(w, h, s), w, h);
  return {
    fixed: { t: 0, lm, aspect: w / h } as Frame,
    legacy: { t: 0, lm } as Frame, // aspect undefined: the pre D-003 behaviour
  };
}

const metrics = (f: Frame) => computeMetrics(f, ALL, []).values;

/** The same computation done by hand on normalized coordinates, i.e. the square assumption. */
const legacyLean = (trueDeg: number, a: number) => Math.atan(Math.tan(trueDeg * DEG) / a) / DEG;

describe("pixel space geometry (D-003)", () => {
  for (const { name, w, h } of SIZES) {
    const a = w / h;
    const square = w === h;
    describe(name, () => {
      for (const deg of [90, 45]) {
        it(`elbow flexion ${deg}° on both sides`, () => {
          const { fixed, legacy } = frames(w, h, { elbowL: deg, elbowR: deg });
          const v = metrics(fixed);
          expect(Math.abs(v.elbow_flex_l! - deg)).toBeLessThan(1);
          expect(Math.abs(v.elbow_flex_r! - deg)).toBeLessThan(1);
          expect(Math.abs(v.elbow_flex_mean! - deg)).toBeLessThan(1);
          const old = metrics(legacy);
          if (square) expect(Math.abs(old.elbow_flex_l! - deg)).toBeLessThan(1);
          else expect(Math.abs(old.elbow_flex_l! - deg)).toBeGreaterThan(1);
        });
      }

      it("arm asymmetry 45° (left 90°, right 45°)", () => {
        const { fixed } = frames(w, h, { elbowL: 90, elbowR: 45 });
        expect(Math.abs(metrics(fixed).arm_asym! - 45)).toBeLessThan(1);
      });

      for (const deg of [8, 10, 25, -10]) {
        it(`trunk lean ${deg}°`, () => {
          const { fixed, legacy } = frames(w, h, { leanDeg: deg });
          expect(Math.abs(metrics(fixed).trunk_lean! - deg)).toBeLessThan(1);
          const old = metrics(legacy).trunk_lean!;
          // the legacy value follows tan(measured) = tan(true) ÷ aspect exactly
          expect(Math.abs(old - legacyLean(deg, a))).toBeLessThan(0.01);
          if (square) expect(Math.abs(old - deg)).toBeLessThan(1);
          else expect(Math.abs(old - deg)).toBeGreaterThan(Math.abs(deg) >= 10 ? 3 : 2.5);
        });
      }

      for (const deg of [60, 120]) {
        it(`shoulder abduction ${deg}° on both sides`, () => {
          const { fixed, legacy } = frames(w, h, { abdL: deg, abdR: deg, elbowL: 170, elbowR: 170 });
          const v = metrics(fixed);
          expect(Math.abs(v.shoulder_abd_l! - deg)).toBeLessThan(1);
          expect(Math.abs(v.shoulder_abd_r! - deg)).toBeLessThan(1);
          const old = metrics(legacy);
          if (square) expect(Math.abs(old.shoulder_abd_l! - deg)).toBeLessThan(1);
          else expect(Math.abs(old.shoulder_abd_l! - deg)).toBeGreaterThan(3);
        });
      }

      it("shoulder hike ratio on a leaning trunk", () => {
        // Upright, the ratio is aspect independent (both terms are vertical). A 20°
        // lean makes the trunk length depend on x, which is where aspect matters.
        const { fixed, legacy } = frames(w, h, { hike: 0.08, leanDeg: 20 });
        expect(Math.abs(metrics(fixed).shoulder_hike! - 0.08)).toBeLessThan(0.01);
        const old = metrics(legacy).shoulder_hike!;
        if (square) expect(Math.abs(old - 0.08)).toBeLessThan(0.01);
        else expect(Math.abs(old - 0.08)).toBeGreaterThan(0.001);
      });

      it("shoulder hike ratio upright is unchanged by the fix", () => {
        const { fixed, legacy } = frames(w, h, { hike: 0.06 });
        expect(Math.abs(metrics(fixed).shoulder_hike! - 0.06)).toBeLessThan(0.01);
        expect(Math.abs(metrics(legacy).shoulder_hike! - 0.06)).toBeLessThan(0.01);
      });

      for (const [ratio, lean] of [
        [1.1, 35],
        [1.75, 5],
      ] as const) {
        it(`hip height ratio ${ratio} with the trunk ${lean}° forward`, () => {
          const { fixed, legacy } = frames(w, h, { hipHeight: ratio, leanDeg: lean });
          expect(Math.abs(metrics(fixed).hip_height! - ratio)).toBeLessThan(0.01);
          const old = metrics(legacy).hip_height!;
          if (square) expect(Math.abs(old - ratio)).toBeLessThan(0.01);
          else if (lean >= 30) expect(Math.abs(old - ratio)).toBeGreaterThan(0.02);
        });
      }

      it("knee flexion 90°", () => {
        const { fixed } = frames(w, h, { knee: 90 });
        const v = metrics(fixed);
        expect(Math.abs(v.knee_flex_l! - 90)).toBeLessThan(1);
        expect(Math.abs(v.knee_flex_r! - 90)).toBeLessThan(1);
      });
    });
  }

  it("portrait inflates and landscape deflates small trunk leans (the D-003 finding)", () => {
    const p = frames(720, 1280, { leanDeg: 8 });
    const l = frames(1280, 720, { leanDeg: 8 });
    expect(metrics(p.legacy).trunk_lean!).toBeGreaterThan(13.5); // ≈ 14.0° shown for a true 8°
    expect(metrics(l.legacy).trunk_lean!).toBeLessThan(4.6); // ≈ 4.5° shown for a true 8°
    expect(Math.abs(metrics(p.fixed).trunk_lean! - 8)).toBeLessThan(1);
    expect(Math.abs(metrics(l.fixed).trunk_lean! - 8)).toBeLessThan(1);
  });
});

describe("aspect plumbing", () => {
  it("treats a missing or invalid aspect as square", () => {
    expect(effectiveAspect(undefined)).toBe(1);
    expect(effectiveAspect(0)).toBe(1);
    expect(effectiveAspect(-2)).toBe(1);
    expect(effectiveAspect(Number.NaN)).toBe(1);
    expect(effectiveAspect(Number.POSITIVE_INFINITY)).toBe(1);
    expect(effectiveAspect(16 / 9)).toBeCloseTo(16 / 9);
  });

  it("works on a copy and never mutates the frame's normalized landmarks", () => {
    const { fixed } = frames(1280, 720, { leanDeg: 10 });
    const before = JSON.stringify(fixed.lm);
    const px = toPixelSpace(fixed.lm, fixed.aspect);
    computeMetrics(fixed, ALL, []);
    expect(JSON.stringify(fixed.lm)).toBe(before);
    expect(px).not.toBe(fixed.lm);
    expect(px[LM.l_shoulder].x).toBeCloseTo(fixed.lm[LM.l_shoulder].x * (1280 / 720));
    expect(px[LM.l_shoulder].y).toBe(fixed.lm[LM.l_shoulder].y);
    expect(toPixelSpace(fixed.lm)).toBe(fixed.lm); // square: no copy needed
  });

  it("measures trunk length and shoulder width in units of image height", () => {
    for (const { w, h } of SIZES) {
      const pts = pixelPose(w, h, { leanDeg: 25 });
      const lm = normalize(pts, w, h);
      const u = Math.min(w, h) * 0.25;
      expect(trunkLength(lm, w / h)).toBeCloseTo(u / h, 6);
      expect(shoulderWidth(lm, w / h)).toBeCloseTo((0.8 * u) / h, 6);
    }
  });

  it("PoseSmoother.smoothFrame passes aspect through and the pipeline stays in pixel space", () => {
    const smoother = new PoseSmoother();
    const { fixed } = frames(720, 1280, { leanDeg: 10, elbowL: 90, elbowR: 90 });
    let last: Frame = fixed;
    for (let i = 0; i < 30; i++) last = smoother.smoothFrame({ ...fixed, t: i * 33 });
    expect(last.aspect).toBe(720 / 1280);
    const v = computeMetrics(last, ALL, []).values;
    expect(Math.abs(v.trunk_lean! - 10)).toBeLessThan(1);
    expect(Math.abs(v.elbow_flex_l! - 90)).toBeLessThan(1);
  });
});

describe("CameraPoseSource aspect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.files.mockResolvedValue({});
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads videoWidth ÷ videoHeight, and nothing while the size is unknown", () => {
    expect(videoAspect({ videoWidth: 1280, videoHeight: 720 })).toBeCloseTo(16 / 9);
    expect(videoAspect({ videoWidth: 720, videoHeight: 1280 })).toBeCloseTo(9 / 16);
    expect(videoAspect({ videoWidth: 0, videoHeight: 0 })).toBeUndefined();
    expect(videoAspect({ videoWidth: 640, videoHeight: 0 })).toBeUndefined();
  });

  it("sets aspect on every frame, following a rotation mid stream", async () => {
    let loop: FrameRequestCallback | undefined;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        loop = cb;
        return 1;
      }),
    );
    const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    let detected = true;
    mocks.create.mockResolvedValue({
      close: vi.fn(),
      detectForVideo: () => ({ landmarks: detected ? [pose] : [] }),
    });
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) },
    });
    const v = {
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
      currentTime: 1,
      videoWidth: 720,
      videoHeight: 1280,
    } as unknown as HTMLVideoElement & { currentTime: number; videoWidth: number; videoHeight: number };
    const src = new CameraPoseSource(v),
      onFrame = vi.fn();
    await src.start(onFrame);
    loop!(1);
    expect(onFrame.mock.calls[0][0].aspect).toBeCloseTo(9 / 16);
    // the phone is turned on its side
    Object.assign(v, { currentTime: 2, videoWidth: 1280, videoHeight: 720 });
    loop!(2);
    expect(onFrame.mock.calls[1][0].aspect).toBeCloseTo(16 / 9);
    // frames without a person keep the aspect too
    detected = false;
    Object.assign(v, { currentTime: 3 });
    loop!(3);
    expect(onFrame.mock.calls[2][0].lm.every((p: Landmark) => p.visibility === 0)).toBe(true);
    expect(onFrame.mock.calls[2][0].aspect).toBeCloseTo(16 / 9);
    src.stop();
  });
});
