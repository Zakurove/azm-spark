/**
 * The engine on a real phone's camera: frame gaps and stalls, jittered and dropped frames at 12 to
 * 60 fps, a landmark the model returns as NaN, a mirrored camera with the tested arm hidden, a
 * phone that moves after calibration, a subject lock shared by two runners, and a helper whose
 * hand hovers close beside the shoulder (review round 2 of the engine, spec 4.0 to 4.4).
 */
import { describe, expect, it } from "vitest";
import { LineCounter, RangeTestRunner, SustainedPeak, type SideResult } from "../src/engine/modes";
import { SubjectLock } from "../src/engine/subject";
import { isPerson, visible } from "../src/engine/body";
import { seen } from "../src/engine/modes/common";
import { testDef } from "../src/movements/assessments";
import type { Frame, Landmark } from "../src/engine/types";
import type { Profile } from "./fixtures/gen";
import { editSubject, framesOf, mirrorFrames, raises, raiseStarts, run, spec } from "./fixtures/runners";
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
