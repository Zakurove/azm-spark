/**
 * The runner after Nasser's first real test (D-034 item 1): one calm line when the picture is not the
 * movement's view (never a block), and a dial without one frame landmark jumps. Clearly synthetic.
 */
import { describe, expect, it } from "vitest";
import { PoseDespiker } from "../../src/engine/rom/despike";
import { PoseSmoother } from "../../src/engine/oneEuro";
import { toPixelSpace } from "../../src/engine/geometry";
import { MOVEMENT_ANGLES } from "../../src/engine/rom/angles";
import type { Landmark } from "../../src/engine/types";
import type { RomMovementId } from "../../src/movements/rom/types";
import { ROM_DATA } from "../../src/movements/rom";
import type { GenSpec } from "../fixtures/gen";
import { romSpec, runRom, type RomRun } from "./b-fixtures";

const VIEW_LINES = ["check_face_phone", "check_left_side_to_phone", "check_right_side_to_phone"];

function spec(movement: RomMovementId, peak: number, over: Partial<GenSpec> = {}): GenSpec {
  const base = romSpec({
    name: `rom/home-runner/${movement}`,
    movement,
    position: "seated",
    side: "right",
    aspect: "16:9",
    peak,
    fps: 30,
  });
  return { ...base, ...over, subject: { ...base.subject, ...over.subject } };
}

const viewLines = (run: RomRun) =>
  run.events.flatMap((e) => (e.kind === "cue" && VIEW_LINES.includes(e.cue) ? [e.cue] : []));

describe("a wrong view is one calm line, never a block (D-034 item 1)", () => {
  it("the arm raise to the side filmed from the side: «face the phone» once, while the start pose waits", () => {
    // Seen from its side the side arm raise hides the far shoulder (its mid shoulder is a gate), so the
    // start pose is never taken: the line still plays, and the view is never the reason.
    const run = runRom(spec("shoulder_abduction", 140, { subject: { yaw: -90 } }));
    expect(viewLines(run)).toEqual(["check_face_phone"]);
    expect(run.result.quality.issues).not.toContain("wrong_view");
  });

  it("the arm raise to the front filmed a little turned (reads oblique): «turn your right side» once, measured", () => {
    const run = runRom(spec("shoulder_flexion", 150, { subject: { yaw: -58, shoulderScale: 1.25 } }));
    expect(viewLines(run)).toEqual(["check_right_side_to_phone"]);
    expect(run.result.status).toBe("measured");
    expect(Math.abs(run.result.value! - 150)).toBeLessThanOrEqual(5);
    expect(run.result.quality.issues).toEqual([]);
  });

  it("the left arm turned: the line names the left side", () => {
    const base = romSpec({
      name: "rom/home-runner/left",
      movement: "elbow_flexion",
      position: "seated",
      side: "left",
      aspect: "16:9",
      peak: 130,
      fps: 30,
    });
    const run = runRom({ ...base, subject: { ...base.subject, yaw: 0 } });
    expect(viewLines(run)).toEqual(["check_left_side_to_phone"]);
  });

  it("the right view: no line", () => {
    for (const [movement, peak] of [
      ["shoulder_flexion", 150],
      ["shoulder_abduction", 140],
      ["elbow_flexion", 135],
    ] as const)
      expect(viewLines(runRom(spec(movement, peak))), movement).toEqual([]);
  });
});

describe("one frame landmark jumps never move the dial (D-034 item 1)", () => {
  /** A still pose, its right wrist jumping 0.3 of the height up in frame 6 only. */
  function stillFrames(): { t: number; lm: Landmark[] }[] {
    const lm: Landmark[] = Array.from({ length: 33 }, (_, i) => ({
      x: 0.5 + i * 0.001,
      y: 0.5,
      z: 0,
      visibility: 0.95,
    }));
    return Array.from({ length: 12 }, (_, k) => ({
      t: k * 33,
      lm: lm.map((q, i) => (i === 16 && k === 6 ? { ...q, y: q.y - 0.3 } : q)),
    }));
  }

  it("the despiker drops a one frame jump; the One Euro alone lets part of it through", () => {
    const d = new PoseDespiker(ROM_DATA.engine.visibilityMin);
    const e = new PoseSmoother();
    let despiked = 0;
    let euro = 0;
    for (const f of stillFrames()) {
      despiked = Math.max(despiked, Math.abs(d.push(f.lm, f.t)[16].y - 0.5));
      euro = Math.max(euro, Math.abs(e.smooth(f.lm, f.t)[16].y - 0.5));
    }
    expect(despiked).toBe(0);
    expect(euro).toBeGreaterThan(0.05);
  });

  it("a landmark the model does not see keeps its last seen place; a long gap starts again", () => {
    const d = new PoseDespiker(0.6);
    const lm = (y: number, v: number): Landmark[] =>
      Array.from({ length: 33 }, () => ({ x: 0.5, y, z: 0, visibility: v }));
    d.push(lm(0.5, 0.9), 0);
    d.push(lm(0.5, 0.9), 33);
    expect(d.push(lm(0.1, 0.2), 66)[0]).toMatchObject({ y: 0.5, visibility: 0.2 });
    // 300 ms later (over the 250 ms gap): the new place stands.
    expect(d.push(lm(0.3, 0.9), 366)[0].y).toBe(0.3);
  });

  it("the elbow bend with a wrist jump every 29 frames: the dial stays within 3 degrees of the held angle", () => {
    const s = spec("elbow_flexion", 135, {
      glitches: { every: 29, from: 7, landmarks: [16], dx: 0, dy: -0.3 },
    });
    const run = runRom(s);
    expect(run.result.status).toBe("measured");
    const reps = run.fx.truth.rom!.reps;
    const held = run.events.flatMap((e) =>
      e.kind === "live" &&
      reps.some((r) => e.t / 1000 >= r.plateauFrom + 0.5 && e.t / 1000 <= r.plateauTo - 0.2)
        ? [e.deg]
        : [],
    );
    expect(held.length).toBeGreaterThan(30);
    for (const deg of held) expect(Math.abs(deg - 135)).toBeLessThanOrEqual(3);
    // The old dial (the One Euro alone) on the same frames jumps by more than 10 degrees.
    const euro = new PoseSmoother();
    const cal = run.runner.calibration!;
    let worst = 0;
    for (const f of run.frames) {
      const lm = f.poses?.[run.fx.truth.subjectIndex[run.frames.indexOf(f)]] ?? f.lm;
      const a = MOVEMENT_ANGLES.elbow_flexion(toPixelSpace(euro.smooth(lm, f.t), f.aspect), {
        side: "right",
        mirrored: false,
        rollDeg: 0,
        calibration: cal,
      });
      const sec = f.t / 1000;
      if (a !== null && reps.some((r) => sec >= r.plateauFrom + 0.5 && sec <= r.plateauTo - 0.2))
        worst = Math.max(worst, Math.abs(a - 135));
    }
    expect(worst).toBeGreaterThan(10);
  });
});
