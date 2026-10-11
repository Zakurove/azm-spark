/**
 * D-037 item 4 on the camera workouts (the v1 shoulder press, app/Session.tsx): one person locked per
 * set. The set's frames go through the shared lock (engine/subject.ts lockedFrame) before the workout
 * flow, so another person in the picture, nearer the phone and pressing at another rhythm, never
 * moves the count. D-038 item 2: the crowd lock (CROWD_LOCK), held from the set's first calibration rep
 * as the camera screen holds it, with a crowd around the person (two walking behind, one crossing in
 * front before the set, one nearer the phone doing the exercise too); the same for each demo exercise
 * (D-037 item 6, the same camera screen); and the person gone mid set: nobody else is counted. Clearly
 * synthetic.
 */
import { describe, expect, it } from "vitest";
import { sessionProfile } from "../src/app/product";
import { profileById } from "../src/engine/profiles";
import { CROWD_LOCK, lockedFrame, SUBJECT_RULES, SubjectLock } from "../src/engine/subject";
import { seatedPressTrace, TRACES } from "../src/engine/traces";
import type { ExerciseDef, Frame, ImpairmentProfile, Landmark } from "../src/engine/types";
import { WorkoutFlow } from "../src/engine/workoutFlow";
import { exerciseById, variantForProfile } from "../src/exercises/defs";
import { DEMO_EXERCISES } from "../src/features/program-v7/demoCatalog";
import { pacing } from "./fixtures/crowd";
import { person } from "./fixtures/people";

const PRESS = exerciseById("seated_shoulder_press");
const WHEELCHAIR = profileById("wheelchair");

/**
 * The camera screen's set (app/Session.tsx onFrame): each frame through the lock, then the flow; the
 * lock held from the first calibration rep. Returns the count after each frame.
 */
function counts(
  frames: Frame[],
  lock: SubjectLock | null,
  def: ExerciseDef = PRESS,
  profile: ImpairmentProfile = WHEELCHAIR,
  target = 50,
): number[] {
  const required = variantForProfile(def, profile.id).requiredLandmarks;
  const flow = new WorkoutFlow(def, profile, required, target);
  lock?.setNeeds(required);
  return frames.map((f) => {
    const v = flow.step(lock ? lockedFrame(lock, f) : f);
    if (lock && (v.stage === "calibrating" || v.stage === "training")) lock.hold(true);
    return v.count;
  });
}
const count = (...a: Parameters<typeof counts>) => counts(...a).at(-1) ?? 0;
const crowdLock = () => new SubjectLock(SUBJECT_RULES, CROWD_LOCK);

/** A pose moved across the picture and grown about its centre (another person, nearer the phone). */
const moved = (lm: Landmark[], dx: number, scale = 1): Landmark[] =>
  lm.map((q) => ({ ...q, x: 0.5 + (q.x - 0.5) * scale + dx, y: 0.5 + (q.y - 0.5) * scale }));

/** Two people walking behind, one crossing in front before the set, from t. */
function crowdAround(t: number): Landmark[][] {
  const out: Landmark[][] = [];
  const b = pacing(0, 3000, 0.02, 0.98, { height: 0.3, y: 0.4 })(t);
  const c = pacing(400, 4100, 0.95, 0.05, { height: 0.27, y: 0.38 })(t);
  if (b) out.push(person(b, 1));
  if (c) out.push(person(c, 1));
  // Crossing in front of the person while they get ready (before the set starts).
  if (t >= 200 && t <= 1400) out.push(person({ x: 1.2 - (1.4 * (t - 200)) / 1200, height: 0.95 }, 1));
  return out;
}

describe("the camera workout follows one person (D-037 item 4)", () => {
  const a = seatedPressTrace({ reps: 8, leadInSec: 2 }).map((f) => ({ ...f, lm: moved(f.lm, -0.22) }));
  const b = seatedPressTrace({ reps: 3, effort: 0.6, leadInSec: 6 });
  /** A who waits in the start position while someone crosses in front of them first. */
  const a4 = seatedPressTrace({ reps: 8, leadInSec: 4 }).map((f) => ({ ...f, lm: moved(f.lm, -0.22) }));

  it("counts A's presses alone while B, nearer the phone and first in the model's order, presses too", () => {
    const alone = count(a, null);
    expect(alone).toBeGreaterThanOrEqual(5);
    const both: Frame[] = a.map((f, i) => {
      if (f.t < 1000) return { ...f, poses: [f.lm] };
      const other = moved(b[Math.min(i, b.length - 1)].lm, 0.24, 1.15);
      return { ...f, lm: other, poses: [other, f.lm] };
    });
    expect(count(both, crowdLock())).toBe(alone);
  });

  it("without the lock the model's first pose would be B's (the hijack this prevents)", () => {
    const both: Frame[] = a.map((f, i) => {
      const other = moved(b[Math.min(i, b.length - 1)].lm, 0.24, 1.15);
      return { ...f, lm: other, poses: [other, f.lm] };
    });
    expect(count(both, null)).not.toBe(count(a, null));
  });

  it("D-038 item 2: the same count in a crowd of five (B pressing nearer, two behind, one crossing in front first)", () => {
    const alone = count(a4, null);
    const crowd: Frame[] = a4.map((f, i) => {
      const other = moved(b[Math.min(i, b.length - 1)].lm, 0.3, 1.15);
      // B beside A, nearer the phone, their arms close but not over each other.
      const poses = [...crowdAround(f.t), ...(f.t < 1000 ? [] : [other]), f.lm];
      // The model's order changes from frame to frame.
      if (i % 3 === 1) poses.reverse();
      return { ...f, lm: poses[0], poses };
    });
    expect(count(crowd, crowdLock())).toBe(alone);
  });

  it("D-038 item 2: A gone mid set while B presses: nothing is counted until A is back", () => {
    const gone = (t: number) => t >= 7000 && t < 11000;
    const frames: Frame[] = a4.map((f, i) => {
      const other = moved(b[Math.min(i, b.length - 1)].lm, 0.3, 1.15);
      const poses = [...crowdAround(f.t), other, ...(gone(f.t) ? [] : [f.lm])];
      return { ...f, lm: poses[0], poses };
    });
    const lock = crowdLock();
    const n = counts(frames, lock);
    const from = frames.findIndex((f) => f.t >= 7000);
    const to = frames.findIndex((f) => f.t >= 11000);
    expect(n.slice(from, to).every((c) => c === n[from])).toBe(true);
    // Counting goes on once A is back, and B's presses never counted.
    expect(n.at(-1)!).toBeGreaterThan(n[to]);
    expect(n.at(-1)!).toBeLessThanOrEqual(count(a4, null));
    expect(lock.generation).toBe(1);
  });
});

describe("each demo exercise (D-037 item 6, the same camera screen) in a crowd", () => {
  for (const d of DEMO_EXERCISES)
    it(`${d.id}: the person's reps alone, whatever the crowd does`, () => {
      const def = { ...exerciseById(d.id), targetReps: 40 };
      const profile = sessionProfile(d.setup);
      const trace = TRACES[d.id];
      const a = trace({ reps: d.reps + 2, leadInSec: 4 }).map((f) => ({ ...f, lm: moved(f.lm, -0.2) }));
      const b = trace({ reps: d.reps, leadInSec: 4, repSec: 2.2 });
      const alone = count(a, null, def, profile, 40);
      expect(alone).toBeGreaterThanOrEqual(d.reps);
      const crowd: Frame[] = a.map((f, i) => {
        const other = moved(b[Math.min(i, b.length - 1)].lm, 0.3, 1.15);
        const poses = [...crowdAround(f.t), ...(f.t < 1000 ? [] : [other]), f.lm];
        if (i % 2) poses.reverse();
        return { ...f, lm: poses[0], poses };
      });
      const lock = crowdLock();
      expect(count(crowd, lock, def, profile, 40)).toBe(alone);
      expect(lock.generation).toBe(1);
    });
});
