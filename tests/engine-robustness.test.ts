/**
 * The engine on a real phone's camera: frame gaps and stalls, jittered and dropped frames at 12 to
 * 60 fps, a landmark the model returns as NaN, a mirrored camera with the tested arm hidden, a
 * phone that moves after calibration, a subject lock shared by two runners, and a helper whose
 * hand hovers close beside the shoulder (review round 2 of the engine, spec 4.0 to 4.4).
 */
import { describe, expect, it } from "vitest";
import {
  LineCounter,
  RangeTestRunner,
  SustainedPeak,
  TrunkControlRunner,
  type SideResult,
} from "../src/engine/modes";
import { SubjectLock } from "../src/engine/subject";
import { isPerson, visible } from "../src/engine/body";
import { seen } from "../src/engine/modes/common";
import { testDef } from "../src/movements/assessments";
import type { Frame, Landmark } from "../src/engine/types";
import type { Profile } from "./fixtures/gen";
import {
  editSubject,
  framesOf,
  HANDS_ON_THIGHS,
  leanOrder,
  leans,
  leanStarts,
  mirrorFrames,
  raises,
  raiseStarts,
  run,
  spec,
} from "./fixtures/runners";
import {
  CROSSED,
  curlPractice,
  curlTrial,
  curlTruth,
  standPractice,
  standTrial,
  standTruth,
  twoPass,
  type TwoPass,
} from "./fixtures/timed";

type Side = "left" | "right";
const ABD = testDef("shoulder_abduction");
const TRUNK = testDef("trunk_control_seated");

const res = (c: { run: { result: { results: SideResult[] } } }) => c.run.result.results[0];

function curlCase(seed: number, over: Partial<TwoPass> = {}, side: Side = "right") {
  return twoPass({
    test: "arm_curl_30s",
    profile: "chair",
    aspect: "9:16",
    seed,
    side,
    practice: curlPractice(side),
    trial: (go) => curlTrial(side, go, seed),
    opts: { variant: "arm_only" },
    ...over,
  });
}

function standCase(seed: number, over: Partial<TwoPass> = {}, profile: Profile = "standing") {
  return twoPass({
    test: "chair_stand_30s",
    profile,
    aspect: "9:16",
    seed,
    practice: standPractice(),
    trial: (go) => standTrial(go, seed),
    extra: { subject: { arms: CROSSED } },
    ...over,
  });
}

/** The go time of a case's practice pass (seconds), to place edits in the trial. */
const goOf = (c: Omit<TwoPass, "trial"> & { trial?: TwoPass["trial"] }) =>
  twoPass({ trial: () => [], ...c } as TwoPass).goSec;

/* ---------------------------------------------------- time without frames */

describe("time without frames in a timed trial is unscored (spec 4.2 occlusion)", () => {
  for (const seed of [600, 601, 602]) {
    it(`an 8 s camera stall in an arm curl fails the quality gate, seed ${seed}`, () => {
      const base = { test: "arm_curl_30s", profile: "chair", aspect: "9:16", seed, side: "right" } as const;
      const go = goOf({ ...base, practice: curlPractice("right"), opts: { variant: "arm_only" } });
      const k = curlCase(seed, { extra: { timing: { stalls: [{ from: go + 10, to: go + 18 }] } } });
      // The trial is never stored as a measured count: it is repeated or not measured.
      const trial = [...res(k).retried, ...res(k).attempts][0];
      expect(trial.outcome).toBe("retry");
      expect(trial.reasons).toEqual(["unscored"]);
      expect(trial.detail.unscoredShare).toBeGreaterThan(0.2);
      expect(k.run.asks).toContain("repeat");
    });
  }

  it("an 8 s stall in a chair stand fails the quality gate", () => {
    const seed = 710;
    const base = { test: "chair_stand_30s", profile: "standing", aspect: "9:16", seed } as const;
    const go = goOf({ ...base, practice: standPractice(), extra: { subject: { arms: CROSSED } } });
    const k = standCase(seed, {
      extra: { subject: { arms: CROSSED }, timing: { stalls: [{ from: go + 10, to: go + 18 }] } },
    });
    const trial = [...res(k).retried, ...res(k).attempts][0];
    expect(trial.outcome).toBe("retry");
    expect(trial.detail.unscoredShare).toBeGreaterThan(0.2);
  });

  it("a short stall under the limit keeps the trial and counts its time as unscored", () => {
    const seed = 603;
    const base = { test: "arm_curl_30s", profile: "chair", aspect: "9:16", seed, side: "right" } as const;
    const go = goOf({ ...base, practice: curlPractice("right"), opts: { variant: "arm_only" } });
    const k = curlCase(seed, { extra: { timing: { stalls: [{ from: go + 10, to: go + 12 }] } } });
    const r = res(k);
    expect(r.status).toBe("measured");
    // About 2 s of 30 s.
    expect(r.detail.unscoredShare).toBeGreaterThan(0.05);
    expect(r.detail.unscoredShare).toBeLessThan(0.1);
  });
});

/* ----------------------------------------------- the subject lock's jump rule */

describe("frame gaps do not read as a jump of the subject (spec 4.0)", () => {
  for (const [seed, ms] of [
    [701, 200],
    [702, 150],
    [703, 200],
    [704, 150],
    [705, 200],
  ] as const) {
    it(`a ${ms} ms frame gap every 3 s in a chair stand, seed ${seed}`, () => {
      const k = standCase(seed, {
        extra: { subject: { arms: CROSSED }, timing: { gaps: { everySec: 3, ms } } },
      });
      const r = res(k);
      const truth = standTruth(k.trial, k.goSec);
      expect(r.status).toBe("measured");
      expect(Math.abs(r.value! - truth)).toBeLessThanOrEqual(1);
      expect(r.quality.maxPausedShare).toBeLessThanOrEqual(0.02);
      expect(k.run.cues).not.toContain("check_one_person");
    });
  }

  it("a 30 fps camera with a 166 ms gap every second, seed 706", () => {
    const k = standCase(706, {
      extra: { subject: { arms: CROSSED }, fps: 30, timing: { gaps: { everySec: 1, ms: 166 } } },
    });
    const r = res(k);
    expect(r.status).toBe("measured");
    expect(Math.abs(r.value! - standTruth(k.trial, k.goSec))).toBeLessThanOrEqual(1);
    expect(k.run.cues).not.toContain("check_one_person");
  });

  it("still pauses when the nearest pose is a second person far from the subject", () => {
    const lock = new SubjectLock();
    const at = (x: number): Landmark[] =>
      Array.from({ length: 33 }, (_, i) => ({
        x: x + (i % 2 ? 0.02 : -0.02),
        y: 0.3 + i / 60,
        z: 0,
        visibility: 0.9,
      }));
    expect(lock.lock([at(0.5)], 1)).toBe(true);
    expect(lock.pick([at(0.5)], 1, 0).paused).toBe(false);
    // 200 ms later only another person, far away, is seen.
    const far = lock.pick([at(0.9)], 1, 200);
    expect(far.paused).toBe(true);
    expect(far.reason).toBe("jump");
  });
});

/* ------------------------------------------------------------------ NaN */

describe("a landmark the model returns as NaN (spec 4.2 counting rules)", () => {
  it("LineCounter and SustainedPeak ignore a sample that is not a number", () => {
    const c = new LineCounter(0.8, 0.2, 0.5);
    c.push(0, 0.05);
    c.push(50, 0.1);
    expect(c.push(100, NaN)).toBeNull();
    expect(c.count).toBe(0);
    c.push(150, 0.9);
    expect(c.count).toBe(1);

    const p = new SustainedPeak(500, 250);
    p.push(0, 100);
    p.push(100, NaN);
    for (let t = 150; t <= 2550; t += 50) p.push(t, 120);
    expect(p.best?.value).toBe(120);
  });

  it("a point with a NaN coordinate is never seen, and a pose of NaN is no person", () => {
    const pose: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    pose[14] = { x: NaN, y: 0.5, z: 0, visibility: 0.99 };
    expect(visible(pose, 14)).toBe(false);
    expect(seen(pose, 14, 0.5)).toBe(false);
    const all = pose.map(() => ({ x: NaN, y: NaN, z: 0, visibility: 0.99 }));
    expect(isPerson(all)).toBe(false);
  });

  for (const seed of [600, 601]) {
    it(`one NaN elbow frame in an arm curl changes nothing, seed ${seed}`, () => {
      const base = { test: "arm_curl_30s", profile: "chair", aspect: "9:16", seed, side: "right" } as const;
      const go = goOf({ ...base, practice: curlPractice("right"), opts: { variant: "arm_only" } });
      const clean = curlCase(seed);
      const k = curlCase(seed, {
        frames: (frames, fx) =>
          editSubject(fx, frames, (p, t) => {
            if (Math.abs(t - (go + 8) * 1000) < 26) p[14] = { ...p[14], x: NaN, y: NaN };
            return p;
          }),
      });
      const truth = curlTruth(k.trial, k.goSec);
      expect(res(k).status).toBe("measured");
      expect(Math.abs(res(k).value! - truth)).toBeLessThanOrEqual(1);
      expect(res(k).value).toBe(res(clean).value);
    });
  }
});

/* ------------------------------------------------------- mirrored camera */

describe("a mirrored camera gates the tested arm (spec 4.0 side labelling and quality gate)", () => {
  it("the tested elbow hidden in 40 percent of frames is not measured, mirrored or not", () => {
    const starts = raiseStarts(6);
    const hide = (fx: ReturnType<typeof framesOf>["fx"], frames: Frame[], k: number) =>
      editSubject(fx, frames, (p, t) => {
        // After calibration, 4 frames in 10 (40 percent) show the tested (left) elbow poorly.
        const i = Math.round(t / (1000 / 15));
        if (t > 1500 && i % 10 < 4) p[k] = { ...p[k], visibility: 0.3 };
        return p;
      });
    const { fx, frames } = framesOf(
      spec("shoulder_abduction", "chair", "9:16", raises("left", 150, starts), starts[5] + 12, 330),
    );
    const plain = run(new RangeTestRunner(ABD, "left"), hide(fx, frames, 13), { rollDeg: 0 }).side("left");
    expect(plain.status).toBe("not_measured");
    expect(plain.reason).toBe("quality");
    // A mirrored stream: the model labels the person's left elbow as its right one (14).
    const mirrored = mirrorFrames(hide(fx, frames, 13));
    const m = run(new RangeTestRunner(ABD, "left", { mirrored: true }), mirrored, { rollDeg: 0 }).side(
      "left",
    );
    expect(m.status).toBe("not_measured");
    expect(m.reason).toBe("quality");
    expect(m.quality.issues).toContain("not_visible");
  });
});

/* ------------------------------------------- the subject lock at calibration */

describe("the subject is locked again at every calibration (spec 4.0)", () => {
  it("a lock shared by both arm curl runners follows the phone moved between the arms", () => {
    const lock = new SubjectLock();
    const seedR = 620;
    const right = curlCase(seedR, { opts: { variant: "arm_only", subject: lock } });
    expect(res(right).status).toBe("measured");
    // The second arm is filmed after the phone moved 0.3 m.
    const left = curlCase(
      621,
      { opts: { variant: "arm_only", subject: lock }, extra: { camera: { x: 0.3 } } },
      "left",
    );
    const fresh = curlCase(621, { extra: { camera: { x: 0.3 } } }, "left");
    expect(res(left).status).toBe("measured");
    expect(res(left).value).toBe(res(fresh).value);
    expect(left.run.cues).not.toContain("check_one_person");
  });
});

describe("a phone that slips during the arm raise (spec 4.0 subject lock)", () => {
  it("locks and calibrates again in the new picture, then measures the side", () => {
    const starts = raiseStarts(7);
    const slipAt = starts[0] + 10.5;
    const { fx, frames } = framesOf(
      spec("shoulder_abduction", "chair", "9:16", raises("right", 150, starts), starts[6] + 12, 345, {
        // Far enough that every later frame reads as a jump of the subject.
        jolts: [{ at: slipAt, dx: 0.1, dy: 0.02 }],
      }),
    );
    const r = run(new RangeTestRunner(ABD, "right"), frames, { rollDeg: 0 });
    const out = r.side("right");
    expect(out.status).toBe("measured");
    expect(out.nValid).toBe(3);
    expect(Math.abs(out.value! - fx.truth.armPeakDeg.right)).toBeLessThanOrEqual(2);
    expect(r.cues).toContain("check_phone_still");
    // The one person cue is not repeated for the rest of the test.
    expect(r.cues.filter((c) => c === "check_one_person").length).toBeLessThanOrEqual(1);
  });
});

describe("the phone moves after the arm raise calibration (spec 4.1 trunk reference)", () => {
  for (const [dx, seed] of [
    [0.02, 340],
    [0.05, 341],
  ] as const) {
    it(`an image shift of ${dx * 100} percent of the width never biases a stored angle`, () => {
      const starts = raiseStarts(7);
      const shiftAt = starts[0] + 10.5;
      const { fx, frames } = framesOf(
        spec("shoulder_abduction", "chair", "9:16", raises("right", 150, starts), starts[6] + 12, seed, {
          // dx is a share of the image height (gen.ts); the width is 0.5625 of it at 9:16.
          jolts: [{ at: shiftAt, dx: dx * 0.5625, dy: 0 }],
        }),
      );
      const r = run(new RangeTestRunner(ABD, "right"), frames, { rollDeg: 0 });
      const out = r.side("right");
      expect(out.status).toBe("measured");
      for (const a of out.attempts.filter((x) => x.outcome === "valid"))
        expect(Math.abs(a.value! - fx.truth.armPeakDeg.right)).toBeLessThanOrEqual(3);
      expect(Math.abs(out.value! - fx.truth.armPeakDeg.right)).toBeLessThanOrEqual(2);
      expect(r.cues).toContain("check_phone_still");
    });
  }
});

describe("a moved picture uses no retry (map 2.12)", () => {
  it("three moves in three attempts still leave the side its three scored attempts", () => {
    const starts = raiseStarts(12);
    // Each jolt lands while the arm is up, in three attempts in a row (the one after each move).
    const jolts = [2, 3, 4].map((k, n) => ({
      at: starts[k] + 2,
      dx: (n % 2 ? -0.03 : 0.03) * 0.5625,
      dy: 0,
    }));
    const { fx, frames } = framesOf(
      spec("shoulder_abduction", "chair", "9:16", raises("right", 150, starts), starts[11] + 12, 347, {
        jolts,
      }),
    );
    const r = run(new RangeTestRunner(ABD, "right"), frames, { rollDeg: 0 });
    const out = r.side("right");
    const moved = r.events.filter(
      (e) => e.kind === "attempt" && e.outcome === "retry" && e.reasons.includes("camera_moved"),
    );
    expect(moved.length).toBeGreaterThanOrEqual(3);
    expect(out.status).toBe("measured");
    expect(out.nValid).toBe(3);
    expect(Math.abs(out.value! - fx.truth.armPeakDeg.right)).toBeLessThanOrEqual(2);
  });
});

/* ------------------------------------------------- a helper's hovering hand */

describe("a helper's hand hovering close beside the shoulder (spec 4.3 helper rules)", () => {
  it("does not fail the side lean toward the helper", () => {
    const order = leanOrder("right");
    const starts = leanStarts(order.length);
    const hoverSide: Side = "left";
    const { frames } = framesOf(
      spec("trunk_control_seated", "chair", "9:16", leans(order, 20, starts), starts.at(-1)! + 12, 350, {
        subject: { arms: HANDS_ON_THIGHS },
        helper: {
          x: 0.55,
          z: -0.25,
          yaw: -30,
          hover: { from: 0, to: 200, shoulder: hoverSide, gapM: 0.05 },
        },
      }),
    );
    const r = run(new TrunkControlRunner(TRUNK, "none"), frames, { rollDeg: 0 });
    const left = r.side("left");
    expect(left.status).toBe("measured");
    expect(left.retried.some((a) => a.reasons.includes("touched"))).toBe(false);
  });

  it("a hand resting on the shoulder is still a touch", () => {
    const starts = raiseStarts(5);
    const { frames } = framesOf(
      spec("shoulder_abduction", "chair", "9:16", raises("right", 140, starts), starts[4] + 12, 351, {
        helper: {
          x: 0.55,
          z: -0.2,
          yaw: -30,
          touch: { from: starts[1] + 1, to: starts[1] + 3, shoulder: "left" },
        },
      }),
    );
    const out = run(new RangeTestRunner(ABD, "right"), frames, { rollDeg: 0 }).side("right");
    expect(out.retried[0].reasons).toContain("touched");
  });
});

/* ------------------------------------------ jittered frames at 12 to 60 fps */

describe("jittered and dropped frames at 12 to 60 fps (contract v2 F fixtures)", () => {
  /** Frame times jitter by up to a quarter of a frame either way; 5 percent of frames dropped. */
  const JITTER = (fps: number) => ({ jitterMs: Math.round(250 / fps), dropShare: 0.05 });
  // At the fps floor itself (12 for the range test and the side lean, 20 for the timed tests) the
  // camera is steady: jitter or a dropped frame there moves the median frame interval to either
  // side of the floor, and under it the gate rightly fails the attempt (low_fps). The timed tests
  // at a steady 20 fps are the ground truth suites of tests/timed-count.test.ts.
  const STEADY = {};

  for (const [fps, timing] of [
    [24, JITTER(24)],
    [30, JITTER(30)],
    [60, JITTER(60)],
  ] as const) {
    it(`arm curl counts at ${fps} fps with jittered and dropped frames`, () => {
      const seed = 640 + fps;
      const k = curlCase(seed, { extra: { fps, timing } });
      const r = res(k);
      expect(r.status).toBe("measured");
      expect(Math.abs(r.value! - curlTruth(k.trial, k.goSec))).toBeLessThanOrEqual(1);
    });
    it(`chair stand counts at ${fps} fps with jittered and dropped frames`, () => {
      const seed = 740 + fps;
      const k = standCase(seed, { extra: { subject: { arms: CROSSED }, fps, timing } });
      const r = res(k);
      expect(r.status).toBe("measured");
      expect(Math.abs(r.value! - standTruth(k.trial, k.goSec))).toBeLessThanOrEqual(1);
    });
  }

  for (const [fps, timing] of [
    [12, STEADY],
    [15, JITTER(15)],
    [20, JITTER(20)],
    [30, JITTER(30)],
    [60, JITTER(60)],
  ] as const) {
    const how = "jitterMs" in timing ? "jittered and dropped" : "steady";
    it(`arm raise peak within 2 degrees at ${fps} fps, ${how} frames`, () => {
      const starts = raiseStarts(4);
      const { fx, frames } = framesOf(
        spec("shoulder_abduction", "chair", "9:16", raises("right", 150, starts), starts[3] + 12, 360 + fps, {
          fps,
          timing,
        }),
      );
      const out = run(new RangeTestRunner(ABD, "right"), frames, { rollDeg: 0 }).side("right");
      expect(out.status).toBe("measured");
      expect(Math.abs(out.value! - fx.truth.armPeakDeg.right)).toBeLessThanOrEqual(2);
    });

    it(`side lean within 2 degrees at ${fps} fps, ${how} frames`, () => {
      const order = leanOrder("right");
      const starts = leanStarts(order.length);
      const { frames } = framesOf(
        spec(
          "trunk_control_seated",
          "chair",
          "9:16",
          leans(order, 20, starts),
          starts.at(-1)! + 12,
          380 + fps,
          {
            fps,
            subject: { arms: HANDS_ON_THIGHS },
            timing,
          },
        ),
      );
      const r = run(new TrunkControlRunner(TRUNK, "none"), frames, { rollDeg: 0 });
      for (const s of ["left", "right"] as const) {
        const out = r.side(s);
        expect(out.status).toBe("measured");
        expect(Math.abs(out.value! - 20)).toBeLessThanOrEqual(2);
      }
    });
  }
});
