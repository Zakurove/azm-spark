/**
 * The range of motion mannequin of tests/fixtures/gen.ts (product v7 contract 8.2 and 7, stream B,
 * step B2): the new joint states leave every existing fixture byte identical; each of the 16 measured
 * movements reads its true angle in pixel space in every position, side and phone shape, filmed where
 * its data and instructions put the phone, with the quality gate passing; the postures (lying on the
 * back, the heel sliding on the bed, the planted lunge, hands on a support) and each compensation the
 * fixtures script move what their checks measure. Noise free here; the acceptance runs are in
 * tests/v7/b-fixtures-*.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toPixelSpace } from "../../src/engine/geometry";
import { QualityMonitor } from "../../src/engine/quality";
import { MOVEMENT_ANGLES, calibrate } from "../../src/engine/rom/angles";
import { distanceBand, romQualityConfig } from "../../src/engine/rom/quality";
import type { Frame, Landmark } from "../../src/engine/types";
import { movementDef } from "../../src/movements/rom";
import { ROM_MOVEMENT_IDS, type RomMovementId, type RomPositionId } from "../../src/movements/rom/types";
import { CATALOG } from "../fixtures/catalog";
import { FIXTURE_ROOT, fixtureFrames, stringifyFixture } from "../fixtures/format";
import {
  generate,
  ROM_DISTANCE_M,
  ROM_FACE_NOISE_SHARE,
  ROM_REP,
  ROM_VIEW,
  romAngleAt,
  romRestDeg,
  type AspectName,
  type GenSpec,
  type MotionSpec,
  type RomOffset,
} from "../fixtures/gen";
import { endAngle, matrixSides, romSpec } from "./b-fixtures";

type Side = "left" | "right";
const DEG = 180 / Math.PI;
type P = { x: number; y: number };
const angleOf = (a: P, b: P) => Math.atan2(b.y - a.y, b.x - a.x) * DEG;
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
/** Smallest turn between two directions, degrees. */
const turn = (a: number, b: number) => Math.abs(((((a - b + 180) % 360) + 360) % 360) - 180);

/** A noise free fixture: still for 1.5 s, one repetition to `peak`, held. */
function still(
  movement: RomMovementId,
  position: RomPositionId,
  side: "left" | "right" | "none",
  aspect: AspectName,
  peak: number,
  extra: { cameraSide?: Side; motions?: MotionSpec[]; rom?: Partial<NonNullable<GenSpec["rom"]>> } = {},
): GenSpec {
  return {
    ...romSpec({
      name: `still/${movement}/${position}/${side}/${aspect}/${peak}`,
      movement,
      position,
      side,
      cameraSide: extra.cameraSide,
      aspect,
      peak,
      reps: 1,
      starts: [1.5],
      noise: 0,
      motions: extra.motions,
      rom: extra.rom,
      rep: { rise: ROM_REP.rise, lower: ROM_REP.lower },
    }),
    durationSec: 1.5 + ROM_REP.rise + ROM_REP.hold,
  };
}

/** Pixel space subject landmarks of the frame at `sec`. */
function at(frames: Frame[], sec: number): Landmark[] {
  const f = frames.find((x) => x.t >= sec * 1000)!;
  return toPixelSpace(f.lm, f.aspect);
}

describe("the v1 fixtures", () => {
  it("every catalogued file regenerates byte identical (new joint states only, contract 1.2 and 7)", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(12);
    for (const entry of CATALOG) {
      const text = readFileSync(join(FIXTURE_ROOT, entry.file), "utf8");
      expect(stringifyFixture(generate(entry.spec)), entry.file).toBe(text);
    }
  });
});

describe("the camera of each movement is its data's", () => {
  for (const id of ROM_MOVEMENT_IDS)
    it(id, () => {
      const def = movementDef(id);
      expect(ROM_VIEW[id]).toBe(def.view);
      const [lo, hi] = distanceBand(def);
      expect(ROM_DISTANCE_M[id]).toBeGreaterThanOrEqual(lo);
      expect(ROM_DISTANCE_M[id]).toBeLessThanOrEqual(hi);
    });
});

describe("each movement reads its true angle in pixel space, and passes the quality gate", () => {
  for (const id of ROM_MOVEMENT_IDS) {
    const def = movementDef(id);
    for (const { id: position } of def.positions)
      for (const { side, cameraSide } of matrixSides(id))
        it(`${id}, ${position}, ${side === "none" ? `${cameraSide} side to the phone` : side}`, () => {
          for (const aspect of ["9:16", "16:9"] as const)
            for (const percent of [25, 100]) {
              const truth = endAngle(id, position, percent, side);
              const fx = generate(still(id, position, side, aspect, truth, { cameraSide }));
              const frames = fixtureFrames(fx);
              const ctx = { side, mirrored: false, rollDeg: 0 };
              const cal = calibrate(
                id,
                frames.filter((f) => f.t < 1000).map((f) => ({ px: toPixelSpace(f.lm, f.aspect) })),
                ctx,
              );
              expect(cal, `${aspect} calibration`).not.toBeNull();
              // The start pose reads the rest angle (the lunge and the abduction read 0 at or behind it).
              expect(Math.abs(cal!.startDeg - romRestDeg(id, position))).toBeLessThanOrEqual(1);
              const end = 1.5 + ROM_REP.rise + 0.5;
              const a = MOVEMENT_ANGLES[id](at(frames, end), { ...ctx, calibration: cal! });
              expect(a, `${aspect} ${percent}%`).not.toBeNull();
              expect(Math.abs(a! - truth), `${aspect} ${percent}%: ${a} for ${truth}`).toBeLessThanOrEqual(1);
              expect(romAngleAt(fx.meta.spec!, end)).toBeCloseTo(truth, 6);
              // The quality gate over the repetition: view, distance, framing and visibility.
              const q = new QualityMonitor(romQualityConfig(def, side, { cameraSide: cameraSide ?? null }));
              for (const f of frames) q.feed({ t: f.t, lm: f.lm, aspect: f.aspect });
              expect(q.report().issues, `${aspect} ${percent}%`).toEqual([]);
            }
        });
  }
});

describe("the truth of a range of motion fixture", () => {
  it("names each repetition's plateau and end angle, and the start pose's angle", () => {
    const spec = romSpec({
      name: "truth",
      movement: "knee_flexion",
      position: "lying_back",
      side: "right",
      aspect: "9:16",
      peak: [100, 110, 120],
      reps: 3,
      rep: { rise: 2, hold: 4, lower: 2 },
      motions: [{ kind: "rom_offset", offset: { pitch: 5 }, start: 20, rise: 1, hold: 2, back: 1 }],
    });
    const t = generate(spec).truth.rom!;
    expect(t).toMatchObject({ movement: "knee_flexion", position: "lying_back", side: "right", restDeg: 0 });
    expect(t.reps.map((r) => [r.start, r.plateauFrom, r.plateauTo, r.end, r.peakDeg])).toEqual([
      [1.5, 3.5, 7.5, 9.5, 100],
      [17.5, 19.5, 23.5, 25.5, 110],
      [33.5, 35.5, 39.5, 41.5, 120],
    ]);
    expect(t.compensations).toEqual([{ kind: "offset", from: 20, to: 24 }]);
    expect(romAngleAt(spec, 21)).toBeCloseTo(110, 6);
    expect(romAngleAt(spec, 12)).toBeCloseTo(0, 6);
  });
});

describe("postures", () => {
  it("lying on the back: the body level, face up, the head toward the picture's left with the right side to the phone", () => {
    const frames = fixtureFrames(generate(still("hip_flexion", "lying_back", "right", "16:9", 0)));
    const px = at(frames, 1);
    expect(Math.abs(px[12].y - px[24].y)).toBeLessThan(0.01);
    expect(px[12].x).toBeLessThan(px[24].x);
    expect(px[0].y).toBeLessThan(px[8].y);
    // The near (right) side is seen, the far side hardly.
    expect(frames[10].lm[24].visibility).toBeGreaterThan(0.9);
    expect(frames[10].lm[23].visibility).toBeLessThan(0.6);
  });

  it("the heel slides along the bed while the knee bends; with the towel it stays a little higher", () => {
    const slide = fixtureFrames(generate(still("knee_flexion", "lying_back", "right", "16:9", 120)));
    const ankle = (f: Landmark[]) => f[28].y;
    expect(Math.abs(ankle(at(slide, 1)) - ankle(at(slide, 5)))).toBeLessThan(0.002);
    expect(dist(at(slide, 1)[28], at(slide, 5)[28])).toBeGreaterThan(0.05);
    const towel = fixtureFrames(generate(still("knee_extension", "lying_back", "right", "16:9", 0)));
    expect(at(towel, 5)[28].y).toBeLessThan(at(towel, 5)[24].y);
    expect(at(slide, 1)[28].y).toBeGreaterThan(at(slide, 1)[24].y);
  });

  it("the lunge keeps the front foot planted while the shank tips forward", () => {
    const frames = fixtureFrames(
      generate(still("ankle_dorsiflexion_lunge", "standing_supported", "right", "9:16", 35)),
    );
    const a = at(frames, 1);
    const b = at(frames, 5);
    expect(dist(a[32], b[32])).toBeLessThan(1e-9);
    expect(dist(a[30], b[30])).toBeLessThan(1e-9);
    expect(b[26].x - a[26].x).toBeGreaterThan(0.03);
    // The heel stays on the floor: the foot level.
    expect(Math.abs(angleOf(b[30], b[32]) - angleOf(a[30], a[32]))).toBeLessThan(1e-6);
  });

  it("standing supported: the hands stay on the counter while the leg moves", () => {
    const frames = fixtureFrames(generate(still("hip_extension", "standing_supported", "right", "9:16", 20)));
    for (const w of [15, 16]) expect(dist(at(frames, 1)[w], at(frames, 5)[w])).toBeLessThan(1e-9);
    expect(dist(at(frames, 1)[26], at(frames, 5)[26])).toBeGreaterThan(0.02);
  });

  it("the forward bend lets the arms hang straight down", () => {
    const px = at(
      fixtureFrames(generate(still("trunk_flexion", "standing_supported", "none", "16:9", 80))),
      5,
    );
    expect(Math.abs(angleOf(px[12], px[14]) - 90)).toBeLessThan(6);
  });

  it("far side points are seen when a spec says so (a far limb in the clear)", () => {
    const spec = still("hip_flexion", "lying_back", "right", "16:9", 0, { rom: { farSeen: [23, 25, 27] } });
    const f = fixtureFrames(generate(spec))[10];
    for (const i of [23, 25, 27]) expect(f.lm[i].visibility).toBeGreaterThan(0.9);
    expect(f.lm[29].visibility).toBeLessThan(0.6);
  });

  it("the face points take their own noise", () => {
    const spec = {
      ...still("neck_flexion", "seated", "none", "9:16", 0),
      noise: 0.003,
      noiseFace: 0.003 * ROM_FACE_NOISE_SHARE,
    };
    const frames = fixtureFrames(generate(spec));
    const clean = fixtureFrames(generate({ ...spec, noise: 0, noiseFace: 0 }));
    const sd = (i: number) => {
      const d = frames.map((f, k) => f.lm[i].y - clean[k].lm[i].y);
      return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
    };
    expect(sd(8) / 0.003).toBeCloseTo(ROM_FACE_NOISE_SHARE, 1);
    expect(sd(12) / 0.003).toBeCloseTo(1, 1);
    expect(ROM_FACE_NOISE_SHARE).toBeCloseTo(0.035 / 0.079, 9);
  });
});

/** Each compensation's offset, its measure on noise free frames before (1 s) and during it (5 s). */
describe("compensations move what their checks measure", () => {
  const during = (
    movement: RomMovementId,
    position: RomPositionId,
    side: "left" | "right" | "none",
    aspect: AspectName,
    peak: number,
    offset: RomOffset,
  ) => {
    const frames = fixtureFrames(
      generate(
        still(movement, position, side, aspect, peak, {
          motions: [{ kind: "rom_offset", offset, start: 1.5, rise: 1, hold: 10, back: 1 }],
        }),
      ),
    );
    return { before: at(frames, 1), after: at(frames, 5) };
  };
  const hold = (
    movement: RomMovementId,
    position: RomPositionId,
    side: Side,
    part: "knee" | "ankle" | "thigh" | "elbow",
    hand: Side,
    peak: number,
  ) => {
    const frames = fixtureFrames(
      generate(
        still(movement, position, side, "16:9", peak, {
          motions: [{ kind: "rom_hand", hand, part, of: side, from: 3, to: 10 }],
        }),
      ),
    );
    return at(frames, 5);
  };

  it("trunk bent forward or back (pitch): the side's trunk line turns by it", () => {
    const { before, after } = during("shoulder_flexion", "seated", "right", "16:9", 5, { pitch: -14 });
    expect(turn(angleOf(before[24], before[12]), angleOf(after[24], after[12]))).toBeCloseTo(14, 0);
  });

  it("trunk leaning to the side (lean): the trunk axis turns by it", () => {
    const { before, after } = during("shoulder_abduction", "seated", "right", "16:9", 5, { lean: 14 });
    const axis = (p: Landmark[]) => angleOf(mid(p[23], p[24]), mid(p[11], p[12]));
    expect(turn(axis(before), axis(after))).toBeCloseTo(14, 0);
  });

  it("the upper body turned (twist): the shoulder width shrinks by its cosine", () => {
    const { before, after } = during("trunk_lateral_flexion", "standing", "right", "16:9", 0, { twist: 40 });
    expect(dist(after[11], after[12]) / dist(before[11], before[12])).toBeCloseTo(Math.cos(40 / DEG), 1);
  });

  it("a hip hike (pelvis roll): the hip line tilts by it", () => {
    const { before, after } = during("hip_abduction", "standing_supported", "right", "16:9", 0, {
      pelvisRoll: 9,
    });
    expect(turn(angleOf(before[23], before[24]), angleOf(after[23], after[24]))).toBeCloseTo(9, 0);
  });

  it("a shoulder hike: the shoulder line tilts", () => {
    const { before, after } = during("neck_lateral_flexion", "seated", "right", "16:9", 0, {
      shoulderRise: { left: 0.08 },
    });
    expect(turn(angleOf(before[11], before[12]), angleOf(after[11], after[12]))).toBeGreaterThan(10);
  });

  it("a head turn: the nose moves along the ear line", () => {
    const { before, after } = during("neck_lateral_flexion", "seated", "right", "16:9", 0, {
      neck: { turn: 25 },
    });
    const off = (p: Landmark[]) => (p[0].x - mid(p[7], p[8]).x) / dist(p[7], p[8]);
    expect(Math.abs(off(after) - off(before))).toBeGreaterThan(0.15);
  });

  it("a hip out of the image plane in a side view (the knee falling out): the thigh's picture shortens", () => {
    const { before, after } = during("hip_flexion", "lying_back", "right", "16:9", 60, {
      legs: { right: { hipAbd: 40 } },
    });
    expect(dist(after[24], after[26]) / dist(before[24], before[26])).toBeLessThan(0.85);
  });

  it("the lunge: the heel lifting, the foot turning out, the knee drifting", () => {
    const heel = during("ankle_dorsiflexion_lunge", "standing_supported", "right", "16:9", 30, {
      lunge: { heelLiftDeg: 10 },
    });
    expect(heel.before[30].y - heel.after[30].y).toBeGreaterThan(0.01);
    const foot = during("ankle_dorsiflexion_lunge", "standing_supported", "right", "16:9", 30, {
      lunge: { footTurnDeg: 55 },
    });
    expect(dist(foot.after[30], foot.after[32]) / dist(foot.before[30], foot.before[32])).toBeLessThan(0.8);
    const knee = during("ankle_dorsiflexion_lunge", "standing_supported", "right", "16:9", 30, {
      lunge: { kneeDriftDeg: 40 },
    });
    expect(dist(knee.after[26], knee.after[28]) / dist(knee.before[26], knee.before[28])).toBeLessThan(0.85);
  });

  it("a bent knee or elbow: the joint bends by it", () => {
    const { after } = during("hip_extension", "standing_supported", "right", "16:9", 15, {
      legs: { right: { knee: 30 } },
    });
    const knee = 180 - Math.abs(turn(angleOf(after[26], after[24]), angleOf(after[26], after[28])));
    expect(knee).toBeCloseTo(30, 0);
    const arm = during("shoulder_flexion", "seated", "right", "16:9", 120, {
      arms: { right: { elbow: 40 } },
    }).after;
    expect(180 - turn(angleOf(arm[14], arm[12]), angleOf(arm[14], arm[16]))).toBeCloseTo(45, 0);
  });

  it("an assisted lift: the other hand holds the elbow; hands on the knee, the ankle or the thigh", () => {
    const elbow = hold("shoulder_flexion", "seated", "right", "elbow", "left", 100);
    expect(dist(elbow[15], elbow[14])).toBeLessThan(0.005);
    const knee = hold("hip_flexion", "lying_back", "right", "knee", "right", 110);
    expect(dist(knee[16], knee[26])).toBeLessThan(0.005);
    const thigh = hold("trunk_flexion", "standing_supported", "right", "thigh", "right", 60);
    expect(dist(thigh[16], mid(thigh[24], thigh[26]))).toBeLessThan(0.06);
  });
});
