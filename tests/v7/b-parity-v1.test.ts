/**
 * Parity of the v7 runner's shoulder_abduction with the v1 RangeTestRunner (product v7 contract 7 and
 * 8.2: «v7 shoulder_abduction within 2 degrees of v1 RangeTestRunner on the six existing
 * tests/fixtures/shoulder_abduction/** files»).
 *
 * The six files are single 4 to 5 s recordings whose raise starts 0.5 s in, so neither runner has its
 * still second before the lift (v1 measures none of them as recorded). Both runners read them with a
 * still lead in (the first frame held 1.5 s). Then:
 *   - the measurement: on every file with a raise, v7's value of the lift (the Hampel filter then the
 *     median of the raw v7 angles over the lift's hold second) is within 2 degrees of v1's value;
 *   - the runner: v7's hold rule records that lift within 2 degrees of v1, on every file with a raise.
 *     Through v1's 0.3 s median the hold signal of chair/raise-right's 1 s hold at 15 fps in a portrait
 *     picture was wider than the band (change log B1-3); the hold signal's 0.5 s median (D-026 item 5,
 *     step B2) holds it. A file without a raise records nothing in either runner.
 * And whole checks generated from the same profiles (practice and three raises, both phone shapes at
 * 30 fps, and at v1's 15 fps in landscape): v7's best value, median and every attempt within 2 degrees
 * of v1's.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { RangeTestRunner } from "../../src/engine/modes";
import { toPixelSpace } from "../../src/engine/geometry";
import { MOVEMENT_ANGLES, type AngleContext } from "../../src/engine/rom/angles";
import { holdValue } from "../../src/engine/rom/hold";
import { RomRunner, RUNNER_RULES } from "../../src/engine/rom/runner";
import type { RomEvent } from "../../src/engine/rom/types";
import type { Frame } from "../../src/engine/types";
import { testDef } from "../../src/movements/assessments";
import { movementDef } from "../../src/movements/rom";
import { FIXTURE_ROOT, fixtureFrames, loadFixture } from "../fixtures/format";
import type { AspectName, GenTruth, Profile } from "../fixtures/gen";
import { framesOf, raises, raiseStarts, run, spec } from "../fixtures/runners";
import { item } from "./b-driver";

type Side = "left" | "right";
const V1 = testDef("shoulder_abduction");

/** The v7 runner over frames, answering «نعم» at each hold. */
function runV7(frames: Frame[], side: Side) {
  const r = new RomRunner({
    item: item("shoulder_abduction", side),
    def: movementDef("shoulder_abduction"),
    askCauseBelow: null,
    poseModel: "full",
  });
  const events: RomEvent[] = [...r.start(frames[0].t)];
  for (const f of frames) {
    const evs = r.feed(f, { rollDeg: 0 });
    events.push(...evs);
    for (const e of evs)
      if (e.kind === "hold") events.push(...r.answerMax(e.hold.holdId, "yes", "button", f.t).events);
  }
  return { r, events, res: r.finish(frames[frames.length - 1].t) };
}

/* ------------------------------------------------------------------ the six files */

/** The first frame held `sec` seconds before the recording (a still start pose for both runners). */
function leadIn(frames: Frame[], fps: number, sec = 1.5): { frames: Frame[]; shiftMs: number } {
  const n = Math.round(sec * fps);
  const shiftMs = (n * 1000) / fps;
  const lead = Array.from({ length: n }, (_, k) => ({ ...frames[0], t: (k * 1000) / fps }));
  return { frames: [...lead, ...frames.map((f) => ({ ...f, t: f.t + shiftMs }))], shiftMs };
}

const FILES = [
  "chair/raise-right-9x16.json",
  "chair/helper-touch-9x16.json",
  "standing/phone-shake-16x9.json",
  "weaker_left/helper-beside-9x16.json",
  "weaker_right/helper-crossing-16x9.json",
  "wheelchair/raise-left-16x9.json",
];

describe("the six v1 arm raise fixtures", () => {
  for (const file of FILES) {
    it(file, () => {
      const fx = loadFixture<GenTruth>(join(FIXTURE_ROOT, "shoulder_abduction", file));
      const side: Side = fx.truth.armPeakDeg.left > fx.truth.armPeakDeg.right ? "left" : "right";
      const { frames, shiftMs } = leadIn(fixtureFrames(fx), fx.meta.fps);
      const v1 = run(new RangeTestRunner(V1, side), frames, { rollDeg: 0 }).side(side);
      const v7 = runV7(frames, side);
      const v1Value = v1.practice[0]?.value ?? null;
      const raised = fx.truth.armPeakDeg[side] >= RUNNER_RULES.relaxedMaxDeg;
      if (!raised) {
        // No lift: v1 records nothing, and neither does v7 (no scored attempt; a practice value at rest at most).
        expect(v1Value).toBeNull();
        expect(v7.res.attempts).toEqual([]);
        for (const p of v7.res.practice) expect(p.value ?? 0).toBeLessThan(RUNNER_RULES.relaxedMaxDeg);
        return;
      }
      expect(v1Value).not.toBeNull();
      // The generator's raise: start 0.5 s, rise 1.5 s, hold 1 s (tests/fixtures/gen.ts arm_raise defaults).
      const from = shiftMs + 2000;
      const to = shiftMs + 3000;
      const cal = v7.r.calibration!;
      expect(cal).not.toBeNull();
      const ctx: AngleContext = { side, mirrored: false, rollDeg: 0, calibration: cal };
      const raw: number[] = [];
      frames.forEach((f, k) => {
        const index =
          k < frames.length - fx.frames.length
            ? fx.truth.subjectIndex[0]
            : fx.truth.subjectIndex[k - (frames.length - fx.frames.length)];
        const lm = f.poses![Math.max(index, 0)];
        const a = MOVEMENT_ANGLES.shoulder_abduction(toPixelSpace(lm, f.aspect), ctx);
        if (a !== null && f.t >= from && f.t <= to) raw.push(a);
      });
      // The measurement: v7's value of the lift equals v1's within 2 degrees.
      const value = Math.round(holdValue(raw)!);
      expect(Math.abs(value - v1Value!)).toBeLessThanOrEqual(2);
      // The runner: its hold rule records the lift within 2 degrees of v1.
      const recorded = v7.res.practice[0]?.value ?? null;
      expect(recorded).not.toBeNull();
      expect(Math.abs(recorded! - v1Value!)).toBeLessThanOrEqual(2);
    });
  }
});

/* ------------------------------------------------------------------ whole checks */

/** Each profile with the arm it raises and the asked peak (as tests/range-test.test.ts). */
const PROFILE_CASES: { profile: Profile; side: Side; peak: number }[] = [
  { profile: "chair", side: "right", peak: 150 },
  { profile: "wheelchair", side: "left", peak: 140 },
  { profile: "standing", side: "right", peak: 165 },
  { profile: "weaker_left", side: "left", peak: 150 },
  { profile: "weaker_right", side: "right", peak: 150 },
];
const FOUR = raiseStarts(4);

describe("whole checks: practice and three raises, v7 against v1", () => {
  const settings: { aspect: AspectName; fps: number }[] = [
    { aspect: "9:16", fps: 30 },
    { aspect: "16:9", fps: 30 },
    { aspect: "16:9", fps: 15 },
  ];
  let seed = 700;
  for (const c of PROFILE_CASES)
    for (const s of settings) {
      const sd = seed++;
      it(`${c.profile}, ${c.side} arm, ${s.aspect} at ${s.fps} fps`, () => {
        const { fx, frames } = framesOf(
          spec("shoulder_abduction", c.profile, s.aspect, raises(c.side, c.peak, FOUR), FOUR[3] + 12, sd, {
            fps: s.fps,
          }),
        );
        const v1 = run(new RangeTestRunner(V1, c.side), frames, { rollDeg: 0 }).side(c.side);
        const v7 = runV7(frames, c.side).res;
        expect(v1.status).toBe("measured");
        expect(v7.status).toBe("measured");
        expect(v7.nValid).toBe(3);
        expect(Math.abs(v7.value! - v1.value!)).toBeLessThanOrEqual(2);
        expect(Math.abs(v7.median! - v1.median!)).toBeLessThanOrEqual(2);
        v7.attempts.forEach((a, k) =>
          expect(Math.abs(a.value! - v1.attempts[k].value!)).toBeLessThanOrEqual(2),
        );
        // Both within 2 degrees of the generator's truth.
        expect(Math.abs(v7.value! - fx.truth.armPeakDeg[c.side])).toBeLessThanOrEqual(2);
        // The same reference: gravity in the wheelchair (hips hidden), the trunk otherwise.
        expect(v7.flags.includes("gravityMode")).toBe(v1.flags.includes("gravity_reference"));
      });
    }
});
