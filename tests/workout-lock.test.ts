/**
 * D-037 item 4 on the camera workouts (the v1 shoulder press, app/Session.tsx): one person locked per
 * set. The set's frames go through the shared lock (engine/subject.ts lockedFrame) before the workout
 * flow, so another person in the picture, nearer the phone and pressing at another rhythm, never
 * moves the count. Clearly synthetic.
 */
import { describe, expect, it } from "vitest";
import { profileById } from "../src/engine/profiles";
import { lockedFrame, SUBJECT_RULES, SubjectLock } from "../src/engine/subject";
import { seatedPressTrace } from "../src/engine/traces";
import type { Frame, Landmark } from "../src/engine/types";
import { WorkoutFlow } from "../src/engine/workoutFlow";
import { exerciseById, variantForProfile } from "../src/exercises/defs";

const PRESS = exerciseById("seated_shoulder_press");

function count(frames: Frame[], lock: SubjectLock | null): number {
  const flow = new WorkoutFlow(
    PRESS,
    profileById("wheelchair"),
    variantForProfile(PRESS, "wheelchair").requiredLandmarks,
    50,
  );
  let n = 0;
  for (const f of frames) n = flow.step(lock ? lockedFrame(lock, f) : f).count;
  return n;
}

/** A pose moved across the picture and grown about its centre (another person, nearer the phone). */
const moved = (lm: Landmark[], dx: number, scale = 1): Landmark[] =>
  lm.map((q) => ({ ...q, x: 0.5 + (q.x - 0.5) * scale + dx, y: 0.5 + (q.y - 0.5) * scale }));

describe("the camera workout follows one person (D-037 item 4)", () => {
  const a = seatedPressTrace({ reps: 8, leadInSec: 2 }).map((f) => ({ ...f, lm: moved(f.lm, -0.22) }));
  const b = seatedPressTrace({ reps: 3, effort: 0.6, leadInSec: 6 });

  it("counts A's presses alone while B, nearer the phone and first in the model's order, presses too", () => {
    const alone = count(a, null);
    expect(alone).toBeGreaterThanOrEqual(5);
    const both: Frame[] = a.map((f, i) => {
      if (f.t < 1000) return { ...f, poses: [f.lm] };
      const other = moved(b[Math.min(i, b.length - 1)].lm, 0.24, 1.15);
      return { ...f, lm: other, poses: [other, f.lm] };
    });
    expect(count(both, new SubjectLock(SUBJECT_RULES, { ignoreBehind: true }))).toBe(alone);
  });

  it("without the lock the model's first pose would be B's (the hijack this prevents)", () => {
    const both: Frame[] = a.map((f, i) => {
      const other = moved(b[Math.min(i, b.length - 1)].lm, 0.24, 1.15);
      return { ...f, lm: other, poses: [other, f.lm] };
    });
    expect(count(both, null)).not.toBe(count(a, null));
  });
});
