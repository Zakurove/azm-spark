/**
 * Subject lock (spec 4.0, contract v2 section F): numPoses 2, lock at calibration on the person
 * nearest the frame centre, follow the mid hip, pause on overlap or a jump, pausedShare, touch.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG } from "./fixtures/catalog";
import { FIXTURE_ROOT, fixtureFrames, loadFixture, type Fixture } from "./fixtures/format";
import { framesIn, generate, type GenSpec, type GenTruth } from "./fixtures/gen";
import { overlapShare, shoulderPx } from "../src/engine/body";
import { toPixelSpace } from "../src/engine/geometry";
import {
  emptyPose,
  nearestCentre,
  posesOf,
  SubjectLock,
  SUBJECT_RULES,
  subjectFrame,
  type SubjectPick,
} from "../src/engine/subject";
import type { Frame } from "../src/engine/types";
import { CHECK_DATA } from "../src/movements/assessments";

const disk = (file: string) => loadFixture<GenTruth>(join(FIXTURE_ROOT, file));

function track(fx: Fixture<GenTruth>, lockAt = 0) {
  const frames = fixtureFrames(fx);
  const lock = new SubjectLock();
  expect(lock.lock(posesOf(frames[lockAt]), frames[lockAt].aspect)).toBe(true);
  const picks = frames.map((f) => lock.pickFrame(f));
  return { lock, frames, picks };
}

const base: GenSpec = {
  test: "shoulder_abduction",
  profile: "chair",
  aspect: "9:16",
  fps: 15,
  durationSec: 4,
  seed: 21,
};

describe("subject lock rules come from the check data", () => {
  it("matches engine.pose (tune at booth)", () => {
    const pose = CHECK_DATA.engine.pose;
    expect(pose.numPoses).toBe(2);
    expect(pose.pauseWhen.join(" ")).toMatch(/more than 20 percent/);
    expect(SUBJECT_RULES.overlapMax).toBe(0.2);
    expect(pose.pauseWhen.join(" ")).toMatch(/more than 0\.5 shoulder widths/);
    expect(SUBJECT_RULES.jumpShoulderWidths).toBe(0.5);
    expect(pose.onPause).toMatch(/more than 10 percent paused frames/);
    expect(SUBJECT_RULES.maxPausedShare).toBe(0.1);
    expect(pose.onPause).toMatch(/check_one_person/);
    expect(pose.tune_at_booth).toBe(true);
  });
});

describe("SubjectLock on the fixtures", () => {
  for (const entry of CATALOG) {
    it(`never takes another person for the subject: ${entry.file}`, () => {
      const fx = disk(entry.file);
      const { picks } = track(fx);
      picks.forEach((p, i) => {
        const truth = fx.truth.subjectIndex[i];
        if (truth === -1) expect(p.paused).toBe(true);
        if (p.lm) expect(p.index).toBe(truth);
      });
    });
  }

  it("locks onto the person nearest the frame centre whatever the pose order", () => {
    const fx = disk("shoulder_abduction/weaker_left/helper-beside-9x16.json");
    const frames = fixtureFrames(fx);
    const swapped = frames.findIndex((_, i) => fx.truth.subjectIndex[i] === 1);
    expect(swapped).toBeGreaterThanOrEqual(0);
    expect(nearestCentre(frames[swapped].poses!, frames[swapped].aspect)).toBe(1);
    const lock = new SubjectLock();
    lock.lock(frames[swapped].poses!, frames[swapped].aspect);
    expect(lock.pickFrame(frames[swapped]).index).toBe(1);
  });

  it("ignores a helper who stays at the edge of the picture", () => {
    const { lock, picks } = track(disk("shoulder_abduction/weaker_left/helper-beside-9x16.json"));
    expect(lock.pausedShare).toBe(0);
    expect(lock.touched).toBe(false);
    expect(picks.every((p) => p.others === 1 && !p.touching)).toBe(true);
  });

  it("pauses while a helper crosses between the phone and the person, then finds the subject again", () => {
    const fx = disk("shoulder_abduction/weaker_right/helper-crossing-16x9.json");
    const { lock, picks } = track(fx);
    const crossing = framesIn(fx, "crossing", 0.2);
    expect(lock.pausedShare).toBeGreaterThan(SUBJECT_RULES.maxPausedShare);
    picks.forEach((p, i) => {
      if (p.paused) expect(crossing.has(i)).toBe(true);
    });
    expect(picks.some((p) => p.reason === "overlap")).toBe(true);
    const last = picks[picks.length - 1];
    expect(last.paused).toBe(false);
    expect(last.index).toBe(fx.truth.subjectIndex[picks.length - 1]);
  });

  it("marks the attempt touched when a helper's hand is on the subject", () => {
    const fx = disk("shoulder_abduction/chair/helper-touch-9x16.json");
    const { lock, picks } = track(fx);
    expect(lock.touched).toBe(true);
    const touch = framesIn(fx, "touch", 0.1);
    picks.forEach((p, i) => {
      if (p.touching) expect(touch.has(i)).toBe(true);
    });
    expect(picks.filter((p) => p.touching).length).toBeGreaterThan(5);
  });

  it("counts a hand that meets the subject in the picture as a touch, as one camera cannot see depth", () => {
    const fx = generate({ ...base, durationSec: 1, helper: { x: 0.8, z: -0.3 } });
    const frames = fixtureFrames(fx);
    const lock = new SubjectLock();
    lock.lock(frames[0].poses!, frames[0].aspect);
    expect(lock.pickFrame(frames[1]).touching).toBe(false);
    // The helper's right wrist drawn over the middle of the subject's left forearm, whatever its depth.
    const f = frames[2];
    const subject = f.poses![fx.truth.subjectIndex[2]];
    const helper = f.poses![fx.truth.helperIndex[2]].map((q) => ({ ...q }));
    helper[16] = {
      x: (subject[13].x + subject[15].x) / 2,
      y: (subject[13].y + subject[15].y) / 2,
      z: 0.3,
      visibility: 0.95,
    };
    const pick = lock.pick([subject, helper], f.aspect);
    expect(pick.touching).toBe(true);
    expect(lock.touched).toBe(true);
  });

  it("does not mark a hand held near the shoulder without touching", () => {
    const fx = generate({
      ...base,
      helper: { x: 0.45, z: -0.2, yaw: -30, hover: { from: 0.5, to: 3.5, gapM: 0.15 } },
    });
    const { lock } = track(fx);
    expect(lock.touched).toBe(false);
    expect(lock.pausedShare).toBe(0);
  });

  it("follows a person rising from the chair without pausing", () => {
    const { lock } = track(disk("chair_stand_30s/standing/stands-9x16.json"));
    expect(lock.pausedShare).toBe(0);
  });

  it("allows the chair stand helper at arm's length beside the person on the weaker side", () => {
    const fx = generate({
      test: "chair_stand_30s",
      profile: "standing",
      aspect: "9:16",
      fps: 20,
      durationSec: 6,
      seed: 22,
      subject: { motions: [{ kind: "chair_stand", reps: 2 }] },
      helper: { x: 0.6, z: -0.2, yaw: -30, hover: { from: 0.5, to: 5.5, shoulder: "left", gapM: 0.15 } },
    });
    const { lock } = track(fx);
    expect(lock.pausedShare).toBeLessThanOrEqual(SUBJECT_RULES.maxPausedShare);
    expect(lock.touched).toBe(false);
  });

  it("tracks a wheelchair user whose hips are hidden", () => {
    const { lock, picks } = track(disk("shoulder_abduction/wheelchair/raise-left-16x9.json"));
    expect(lock.pausedShare).toBe(0);
    expect(picks.every((p) => p.lm !== null)).toBe(true);
  });

  it("does not read normal jitter as a jump in a side view (body width from the trunk)", () => {
    const fx = disk("arm_curl_30s/chair/curl-right-9x16.json");
    const { lock, frames } = track(fx);
    expect(lock.pausedShare).toBe(0);
    const p = toPixelSpace(frames[0].lm, frames[0].aspect);
    expect(shoulderPx(p)).toBeLessThan(0.2 * lock.width!);
  });

  it("does not pause while the phone moves slightly", () => {
    const { lock } = track(disk("shoulder_abduction/standing/phone-shake-16x9.json"));
    expect(lock.pausedShare).toBe(0);
  });

  it("pauses after the phone slips, until the flow locks again", () => {
    const fx = generate({ ...base, jolts: [{ at: 2, dx: 0.1, dy: 0.02 }] });
    const frames = fixtureFrames(fx);
    const { lock, picks } = track(fx);
    const slip = frames.findIndex((f) => f.t >= 2000);
    expect(picks[slip].reason).toBe("jump");
    expect(picks.slice(slip).every((p) => p.paused && p.lm === null)).toBe(true);
    expect(picks.slice(0, slip).every((p) => !p.paused)).toBe(true);
    expect(lock.pausedRun).toBe(frames.length - slip);
    lock.lock(posesOf(frames[slip]), frames[slip].aspect);
    expect(lock.pausedRun).toBe(0);
    expect(frames.slice(slip).every((f) => !lock.pickFrame(f).paused)).toBe(true);
  });
});

describe("SubjectLock rules", () => {
  const fx = generate({ ...base, helper: { x: 0.9, z: -0.3 } });
  const frames = fixtureFrames(fx);
  const subjectAt = (i: number) => fx.truth.subjectIndex[i];

  it("pauses on a mid hip jump and never hands the subject over to the other person", () => {
    const lock = new SubjectLock();
    lock.lock(frames[0].poses!, frames[0].aspect);
    // The model loses the subject for three frames and returns only the helper.
    const cut = (f: Frame, i: number): Frame => {
      const poses = f.poses!.filter((_, j) => j !== subjectAt(i));
      return { ...f, poses, lm: poses[0] };
    };
    const picks: SubjectPick[] = frames.map((f, i) => lock.pickFrame(i >= 10 && i < 13 ? cut(f, i) : f));
    for (let i = 10; i < 13; i++) {
      expect(picks[i]).toMatchObject({ paused: true, reason: "jump", lm: null, index: -1 });
      expect(picks[i].jump).toBeGreaterThan(SUBJECT_RULES.jumpShoulderWidths);
    }
    expect(picks[13].paused).toBe(false);
    expect(picks[13].index).toBe(subjectAt(13));
    expect(lock.pausedShare).toBeCloseTo(3 / frames.length, 6);
    expect(lock.pausedRun).toBe(0);
  });

  it("pauses when nobody is found, and before any lock", () => {
    const lock = new SubjectLock();
    expect(lock.pickFrame(frames[0])).toMatchObject({ paused: true, reason: "unlocked", lm: null });
    expect(lock.lock([], 1)).toBe(false);
    expect(lock.locked).toBe(false);
    lock.lock(frames[0].poses!, frames[0].aspect);
    const empty = lock.pick([], frames[0].aspect);
    expect(empty).toMatchObject({ paused: true, reason: "lost", lm: null });
    expect(lock.pickFrame({ ...frames[1], poses: [emptyPose()] }).reason).toBe("lost");
    expect(lock.pausedShare).toBe(1);
  });

  it("counts pausedShare per attempt", () => {
    const lock = new SubjectLock();
    lock.lock(frames[0].poses!, frames[0].aspect);
    lock.pick([]);
    lock.pickFrame(frames[1]);
    expect(lock.frameCount).toBe(2);
    expect(lock.pausedShare).toBe(0.5);
    lock.resetAttempt();
    expect(lock.pausedShare).toBe(0);
    expect(lock.frameCount).toBe(0);
    lock.unlock();
    expect(lock.locked).toBe(false);
    expect(lock.anchor).toBeNull();
  });

  it("keeps the calibration mid hip as the anchor", () => {
    const lock = new SubjectLock();
    lock.lock(frames[0].poses!, frames[0].aspect);
    const a = lock.anchor!;
    const p = toPixelSpace(frames[0].poses![subjectAt(0)], frames[0].aspect);
    expect(a.x).toBeCloseTo((p[23].x + p[24].x) / 2, 9);
    expect(a.y).toBeCloseTo((p[23].y + p[24].y) / 2, 9);
  });
});

describe("helpers", () => {
  it("posesOf reads multi pose frames and single pose sources", () => {
    const fx = generate({ ...base, durationSec: 0.2 });
    const f = fixtureFrames(fx)[0];
    expect(posesOf(f)).toBe(f.poses);
    expect(posesOf({ t: 0, lm: f.lm })).toEqual([f.lm]);
    expect(posesOf({ t: 0, lm: emptyPose() })).toEqual([]);
  });

  it("subjectFrame puts the subject's landmarks in lm, or an empty pose when not trusted", () => {
    const fx = generate({ ...base, durationSec: 0.2, helper: { x: 0.9, z: -0.3 }, shuffle: true });
    const f = fixtureFrames(fx)[0];
    const lock = new SubjectLock();
    lock.lock(f.poses!, f.aspect);
    const pick = lock.pickFrame(f);
    expect(subjectFrame(f, pick).lm).toBe(f.poses![fx.truth.subjectIndex[0]]);
    expect(subjectFrame(f, { ...pick, lm: null }).lm.every((q) => q.visibility === 0)).toBe(true);
    expect(subjectFrame(f, pick).aspect).toBe(f.aspect);
  });

  it("measures box overlap as a share of the smaller box", () => {
    const big = { x0: 0, y0: 0, x1: 1, y1: 1 };
    expect(overlapShare(big, big)).toBe(1);
    expect(overlapShare(big, { x0: 2, y0: 2, x1: 3, y1: 3 })).toBe(0);
    expect(overlapShare(big, { x0: 0.4, y0: 0.4, x1: 0.5, y1: 0.5 })).toBeCloseTo(1, 9);
    expect(overlapShare(big, { x0: 0.5, y0: 0, x1: 1.5, y1: 1 })).toBeCloseTo(0.5, 9);
  });
});
