/**
 * D-037 item 4 on the range measurement: one person locked (the booth, many people in the picture).
 * The runner follows the range part's one lock (romController: the crowd lock of D-038 item 2, anchor
 * "body", held from the block's first movement); another person who comes into the picture, nearer the
 * phone and in its middle, is never measured. D-038 item 2: the measured person gone mid try while
 * another stands there, the other is never measured and no start pose is taken on them; a lock that is
 * not held (the v1 lock's 2 s release) would take the start pose again on the other, never measuring
 * them against the first one's. Clearly synthetic.
 */
import { describe, expect, it } from "vitest";
import { CROWD_LOCK, SUBJECT_RULES, SubjectLock, subjectOf } from "../../src/engine/subject";
import type { Frame } from "../../src/engine/types";
import { person } from "../fixtures/people";
import { romSpec } from "../fixtures/rom/build";
import { runRom } from "./b-fixtures";

/** The range part's lock (romController): the crowd lock, held while the block's movements run. */
const lockOf = () => {
  const lock = new SubjectLock(SUBJECT_RULES, { ...CROWD_LOCK, anchor: "body" });
  lock.hold(true);
  return lock;
};

const spec = romSpec({
  name: "rom/lock/shoulder_flexion",
  movement: "shoulder_flexion",
  position: "seated",
  side: "right",
  aspect: "9:16",
  peak: 140,
  fps: 30,
});

describe("another person on the range measurement's camera (D-037 item 4)", () => {
  for (const [name, b] of [
    // Nearer the phone (larger) beside the person, at their back.
    ["nearer the phone, beside A", person({ x: 0.14, height: 0.85 }, 9 / 16)],
    // Behind the person (smaller), in the middle of the picture, over them in the picture.
    ["behind A, in the middle of the picture", person({ x: 0.5, y: 0.45, height: 0.2 }, 9 / 16)],
  ] as const)
    it(`B comes in ${name}, first in the model's order: A is measured, B never`, () => {
      const run = runRom(spec, {
        runner: { subject: lockOf() },
        frames: (frames) =>
          frames.map((f) => {
            if (f.t < 1500) return f;
            const poses = [b, ...(f.poses ?? [f.lm])];
            return { ...f, lm: poses[0], poses };
          }),
      });
      expect(run.result.status).toBe("measured");
      expect(Math.abs(run.result.value! - 140)).toBeLessThanOrEqual(5);
      // B (index 0 once there) is never the measured person.
      for (const f of run.frames)
        if (f.t >= 1500 && subjectOf(f) !== undefined) expect(subjectOf(f)).not.toBe(0);
      expect(run.runner.lock.generation).toBe(1);
    });

  it("D-038 item 2: A leaves mid try while B stands there: B is never measured, no start pose on B", () => {
    const b = person({ x: 0.14, height: 0.7 }, 9 / 16);
    let leftAt = Infinity;
    const run = runRom(spec, {
      runner: { subject: lockOf() },
      frames: (frames) => {
        const cut = frames[Math.floor(frames.length / 3)].t;
        leftAt = cut;
        return frames.map((f) => {
          const own = f.poses ?? [f.lm];
          const poses = f.t < cut ? [...own, b] : [b];
          return { ...f, lm: poses[0], poses } as Frame;
        });
      },
    });
    const phases = run.events.flatMap((e) => (e.kind === "phase" ? [{ phase: e.phase, t: e.t }] : []));
    expect(phases.some((p) => p.phase === "calibrating" && p.t > leftAt)).toBe(false);
    expect(run.holds.every((h) => h.t < leftAt)).toBe(true);
    expect(run.events.some((e) => e.kind === "live" && e.t > leftAt + 100)).toBe(false);
    for (const f of run.frames) if (f.t > leftAt && subjectOf(f) !== undefined) expect(subjectOf(f)).toBe(-1);
    expect(run.runner.lock.generation).toBe(1);
  });

  it("the v1 lock (not held, 2 s): A leaves for longer while B stands there: the start pose is taken again, on B", () => {
    const b = person({ x: 0.14, height: 0.7 }, 9 / 16);
    let leftAt = Infinity;
    const run = runRom(spec, {
      runner: { subject: new SubjectLock(SUBJECT_RULES, { anchor: "body", ignoreBehind: true }) },
      frames: (frames) => {
        // A is followed until the first attempt is under way, then leaves; B stands still.
        const cut = frames[Math.floor(frames.length / 3)].t;
        leftAt = cut;
        return frames.map((f) => {
          const own = f.poses ?? [f.lm];
          const poses = f.t < cut ? [...own, b] : [b];
          return { ...f, lm: poses[0], poses } as Frame;
        });
      },
    });
    const phases = run.events.flatMap((e) => (e.kind === "phase" ? [{ phase: e.phase, t: e.t }] : []));
    // The start pose is asked again after the release, never a hold read from B against A's start pose.
    expect(phases.some((p) => p.phase === "calibrating" && p.t >= leftAt + SUBJECT_RULES.releaseMs)).toBe(
      true,
    );
    expect(run.holds.every((h) => h.t < leftAt)).toBe(true);
    expect(run.runner.lock.generation).toBe(2);
  });
});
