/**
 * D-034 item 1, Nasser's first real test of v7.0: on his iPhone, seated at home about 1.2 to 1.5 m
 * from the phone, every range movement ended «not measured». The stored issues were too_close on every
 * movement, with wrong_view, out_of_frame, paused and not_visible on the arm raise to the front and the
 * elbow; the frame rate was 43 to 59 fps; the dial jumped to 180 and stopped; his legs were not in the
 * picture.
 *
 * These fixtures put the generator's seated person where he was: a phone front camera's 4:3 picture
 * held upright, its lens narrower than the app's assumption (42 degrees across the short side, so the
 * distance proxy reads the person closer still), 1.2 to 1.5 m away near head height, the legs out of
 * the picture and the hips at its bottom edge or below it. Where the model would have to guess a
 * landmark outside the picture, its place drifts (offFrame). Each must be measured within the 8.2
 * tolerance (5 degrees of the generator's truth), at 30 and 60 fps, with single frame landmark jumps
 * too; a person whose measured arm is truly out of the picture is still not measured (quality).
 * Clearly synthetic.
 */
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GenSpec } from "../fixtures/gen";
import { RUNNER_RULES } from "../../src/engine/rom/runner";
import type { RomMovementId, RomPositionId } from "../../src/movements/rom/types";
import { MATRIX_JITTER_MS, romSpec, runRom, VALUE_TOLERANCE_DEG, type RomRun } from "./b-fixtures";

/** The home phone: a 4:3 picture held upright, a lens of 42 degrees across, at `distance` and `height` m. */
const home = (distance: number, height: number) => ({ distance, height, fovShortDeg: 42 });

/** How far a model's guess of a landmark outside the picture wanders, frame to frame (share of the height). */
const OFF_FRAME = { noise: 0.04 };

interface HomeCase {
  name: string;
  movement: RomMovementId;
  position?: RomPositionId;
  peak: number;
  camera: { distance: number; height: number; fovShortDeg: number };
  fps: number;
  /** The person turned from the movement's view (degrees of yaw), with broader shoulders: reads oblique. */
  turned?: { yaw: number; shoulderScale: number };
  glitches?: GenSpec["glitches"];
  /** Expected: measured within tolerance (default), or not measured for quality. */
  expect?: "not_measured";
}

const CASES: HomeCase[] = [
  // The arm raise to the front, side view: the near hip at the bottom edge (inside the picture, in its margin).
  {
    name: "shoulder_flexion, hips at the edge, 1.3 m",
    movement: "shoulder_flexion",
    peak: 150,
    camera: home(1.3, 1.14),
    fps: 30,
  },
  // The hips below the picture: the model guesses them (gravity reference).
  {
    name: "shoulder_flexion, hips out of the picture, 1.3 m",
    movement: "shoulder_flexion",
    peak: 150,
    camera: home(1.3, 1.2),
    fps: 30,
  },
  {
    name: "shoulder_flexion, hips at the edge, 1.3 m, 60 fps",
    movement: "shoulder_flexion",
    peak: 150,
    camera: home(1.3, 1.14),
    fps: 60,
  },
  // Sitting a little turned toward the phone, broad shoulders: the view reads oblique, the plane is fine.
  {
    name: "shoulder_flexion, turned 28 degrees toward the phone, 1.4 m",
    movement: "shoulder_flexion",
    peak: 150,
    camera: home(1.4, 1.1),
    fps: 30,
    turned: { yaw: -62, shoulderScale: 1.25 },
  },
  // A one frame jump of the nose behind the head while the arm moves (the face side flips: 180).
  {
    name: "shoulder_flexion, one frame nose jumps, 1.3 m",
    movement: "shoulder_flexion",
    peak: 150,
    camera: home(1.3, 1.14),
    fps: 30,
    glitches: { every: 17, from: 5, landmarks: [0], dx: -0.35, dy: 0 },
  },
  // The arm raise to the side, front view: the raised hand leaves the picture, the elbow stays in.
  {
    name: "shoulder_abduction, 1.45 m",
    movement: "shoulder_abduction",
    peak: 140,
    camera: home(1.45, 1.15),
    fps: 30,
  },
  {
    name: "shoulder_abduction, 1.45 m, 60 fps",
    movement: "shoulder_abduction",
    peak: 140,
    camera: home(1.45, 1.15),
    fps: 60,
  },
  // The elbow bend, side view, the phone at shoulder height: the shanks and feet out of the picture.
  {
    name: "elbow_flexion, 1.3 m",
    movement: "elbow_flexion",
    peak: 135,
    camera: home(1.3, 0.95),
    fps: 30,
  },
  {
    name: "elbow_flexion, 1.3 m, 60 fps",
    movement: "elbow_flexion",
    peak: 135,
    camera: home(1.3, 0.95),
    fps: 60,
  },
  // A one frame jump of the wrist up to the shoulder (the elbow reads folded for a frame).
  {
    name: "elbow_flexion, one frame wrist jumps, 1.3 m, 60 fps",
    movement: "elbow_flexion",
    peak: 135,
    camera: home(1.3, 0.95),
    fps: 60,
    glitches: { every: 29, from: 7, landmarks: [16], dx: 0, dy: -0.35 },
  },
  {
    name: "elbow_extension, 1.3 m",
    movement: "elbow_extension",
    peak: 2,
    camera: home(1.3, 0.95),
    fps: 30,
  },
  {
    name: "shoulder_extension, near the front of the chair, 1.3 m",
    movement: "shoulder_extension",
    position: "seated_forward",
    peak: 50,
    camera: home(1.3, 1.05),
    fps: 30,
  },
  // Truly out of the picture: the phone so high and close that the bent elbow's wrist never shows.
  {
    name: "elbow_flexion, the hand below the picture, 0.9 m",
    movement: "elbow_flexion",
    peak: 135,
    camera: home(0.9, 1.25),
    fps: 30,
    expect: "not_measured",
  },
];

function homeSpec(c: HomeCase): GenSpec {
  const base = romSpec({
    name: `rom/home/${c.name}`,
    movement: c.movement,
    position: c.position ?? "seated",
    side: "right",
    aspect: "3:4",
    peak: c.peak,
    fps: c.fps,
    jitterMs: MATRIX_JITTER_MS,
  });
  return {
    ...base,
    camera: c.camera,
    offFrame: OFF_FRAME,
    ...(c.glitches ? { glitches: c.glitches } : {}),
    subject: {
      ...base.subject,
      ...(c.turned ? { yaw: c.turned.yaw, shoulderScale: c.turned.shoulderScale } : {}),
    },
  };
}

/** The live dial's readings while the person rests between attempts (the true angle near the start pose). */
function restLive(run: RomRun): number[] {
  const reps = run.fx.truth.rom!.reps;
  const rest = run.fx.truth.rom!.restDeg;
  const resting = (t: number) => {
    const s = t / 1000;
    // Before the first repetition, and between one's end and the next one's start.
    return reps.every((r, k) => s < r.start - 0.2 || (s > r.end + 0.5 && (reps[k + 1]?.start ?? 1e9) > s));
  };
  return run.events.flatMap((e) => (e.kind === "live" && resting(e.t) ? [Math.abs(e.deg - rest)] : []));
}

/** One line per case for the before and after table (AZM_HOME_REPORT=<file>). */
function report(c: HomeCase, run: RomRun) {
  const file = process.env.AZM_HOME_REPORT;
  if (!file) return;
  const r = run.result;
  const repeats = run.records
    .filter((a) => a.outcome === "retry" || a.outcome === "invalid")
    .map((a) => a.reasons.join("+"));
  const rest = restLive(run);
  appendFileSync(
    file,
    JSON.stringify({
      name: c.name,
      truth: c.peak,
      status: r.status,
      reason: r.reason,
      value: r.value,
      nValid: r.nValid,
      issues: r.quality.issues,
      repeats,
      flags: r.flags,
      restLiveMax: rest.length ? Math.round(Math.max(...rest)) : null,
    }) + "\n",
  );
}

describe("seated at home, 1.2 to 1.5 m, the legs out of the picture (D-034 item 1)", () => {
  for (const c of CASES)
    it(c.name, () => {
      const run = runRom(homeSpec(c));
      report(c, run);
      const r = run.result;
      if (c.expect === "not_measured") {
        expect(r.status).toBe("not_measured");
        expect(r.reason).toBe("quality");
        expect(r.value).toBeNull();
        return;
      }
      expect({ status: r.status, reason: r.reason, issues: r.quality.issues }).toEqual({
        status: "measured",
        reason: null,
        issues: [],
      });
      // D-035: one valid attempt records the value.
      expect(r.nValid).toBe(RUNNER_RULES.validAttempts);
      for (const a of r.attempts)
        expect(Math.abs(a.value! - c.peak), `attempt ${a.index}`).toBeLessThanOrEqual(VALUE_TOLERANCE_DEG);
      // The dial never jumps away from a resting arm (a one frame landmark jump is not an angle).
      const rest = restLive(run);
      expect(rest.length).toBeGreaterThan(0);
      expect(Math.max(...rest)).toBeLessThan(15);
    });
});
