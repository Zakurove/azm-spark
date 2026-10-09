/**
 * Step G1 (product v7 contract 8.4): the two smoke video scenarios and their truth
 * (scripts/smoke/scenarios.mjs): one range movement (the arm raise to the side, seated, front view)
 * and one gait view (the walking pad, side view). The truth is computed from the same kinematics the
 * renderer draws, so it is exact for the rendered person.
 */
import { describe, expect, it } from "vitest";
import { armAbductionDeg, J, skeleton } from "../../scripts/smoke/humanoid.mjs";
import {
  SCENARIOS,
  feetDown,
  framePoints,
  movementTruthDeg,
  scenarioTruth,
  smokeQuery,
} from "../../scripts/smoke/scenarios.mjs";
import gaitData from "../../src/movements/gait/gait-v7.json";
import romData from "../../src/movements/rom/rom-v7.json";

const rom = SCENARIOS["rom-shoulder-abduction-right"];
const gait = SCENARIOS["gait-pad-side"];

describe("the range scenario: the right arm raised to the side, seated, front view", () => {
  const truth = scenarioTruth(rom);
  const def = romData.movements.find((m) => m.id === "shoulder_abduction")!;

  it("is a movement, position and view of the data", () => {
    expect(truth.kind).toBe("rom");
    expect(truth.movement).toBe("shoulder_abduction");
    expect(def.positions.map((p) => p.id)).toContain(truth.position);
    expect(truth.view).toBe(def.view);
    // The phone 2 to 3 m away, at chest height (the movement's camera text).
    const [near, far] = ([] as number[]).concat(def.distanceM);
    expect(rom.camera.pos[2]).toBeGreaterThanOrEqual(near);
    expect(rom.camera.pos[2]).toBeLessThanOrEqual(far ?? near);
  });

  it("holds the end angle in every loop, with the arm at rest between raises", () => {
    for (const hold of truth.holds) {
      for (const t of [hold.from + 0.01, (hold.from + hold.to) / 2, hold.to - 0.01])
        expect(armAbductionDeg(skeleton(rom.poseAt(t)), "right")).toBeCloseTo(truth.endDeg, 6);
    }
    expect(armAbductionDeg(skeleton(rom.poseAt(0)), "right")).toBeCloseTo(truth.startDeg, 6);
    expect(armAbductionDeg(skeleton(rom.poseAt(rom.seconds - 0.01)), "right")).toBeCloseTo(truth.startDeg, 6);
    // The left arm never moves.
    expect(armAbductionDeg(skeleton(rom.poseAt(truth.holds[0].from)), "left")).toBeCloseTo(truth.startDeg, 6);
  });

  it("gives the picture's angle too, on the movement's own landmarks", () => {
    // ang(E - S, MHf - MS) on the projected joints: within 2 degrees of the posed angle when the
    // person faces the phone squarely.
    expect(Math.abs(truth.projected.endDeg - truth.endDeg)).toBeLessThan(2);
    expect(Math.abs(truth.projected.startDeg - truth.startDeg)).toBeLessThan(2);
  });

  it("keeps the whole body and the raised arm in the picture", () => {
    for (const t of [0, 4.2, 7, 11]) {
      const s = skeleton(rom.poseAt(t));
      for (const p of framePoints(rom, s)) {
        expect(p.x).toBeGreaterThan(0.02);
        expect(p.x).toBeLessThan(0.98);
        expect(p.y).toBeGreaterThan(0.02);
        expect(p.y).toBeLessThan(0.98);
      }
    }
  });
});

describe("the gait scenario: the walking pad, side view", () => {
  const truth = scenarioTruth(gait);
  const pad = gaitData.capture.walking_pad.side;

  it("follows the pad side capture of the data", () => {
    expect(truth.kind).toBe("gait");
    expect(truth.view).toBe("pad_side");
    expect(truth.nearSide).toBe("right");
    expect(gait.camera.pos[1]).toBeGreaterThanOrEqual(pad.lensHeight_m[0]);
    expect(gait.camera.pos[1]).toBeLessThanOrEqual(pad.lensHeight_m[1]);
    expect(gait.camera.pos[2]).toBeGreaterThanOrEqual(pad.distance_m[0]);
    expect(gait.camera.pos[2]).toBeLessThanOrEqual(pad.distance_m[1]);
    expect(truth.walk.to - truth.walk.from).toBeGreaterThanOrEqual(pad.durationPerView_s);
    expect(truth.standing.to - truth.standing.from).toBeGreaterThanOrEqual(
      gaitData.capture.common.standingCalibration_s,
    );
  });

  it("walks at the cadence it states, one stride every 120 / cadence seconds per side", () => {
    expect(truth.cadenceSpm).toBe(100);
    expect(truth.strideTimeS).toBeCloseTo(1.2, 9);
    for (const side of ["left", "right"] as const) {
      const ic = truth.events.filter((e) => e.side === side && e.type === "ic").map((e) => e.t);
      expect(ic.length).toBeGreaterThanOrEqual(25);
      for (let i = 1; i < ic.length; i++) expect(ic[i] - ic[i - 1]).toBeCloseTo(truth.strideTimeS, 2);
      expect(truth.strides[side]).toBe(ic.length - 1);
    }
    // The sides alternate half a stride apart.
    const r = truth.events.find((e) => e.side === "right" && e.type === "ic")!.t;
    const l = truth.events.find((e) => e.side === "left" && e.type === "ic" && e.t > r)!.t;
    expect(l - r).toBeCloseTo(truth.strideTimeS / 2, 2);
  });

  it("puts each foot down at its initial contact and lifts it at toe off", () => {
    // Stance is 60 percent of the stride, with two double supports of 10 percent.
    expect(truth.stancePct).toBe(60);
    const T = truth.strideTimeS;
    for (const e of truth.events) {
      const before = feetDown(gait, e.t - 0.02 * T)[e.side];
      const after = feetDown(gait, e.t + 0.02 * T)[e.side];
      expect([e.side, e.type, e.t, before, after]).toEqual([
        e.side,
        e.type,
        e.t,
        e.type === "to",
        e.type === "ic",
      ]);
    }
    const r = truth.events.find((e) => e.side === "right" && e.type === "ic")!.t;
    // Double support after each contact, single support in mid stance.
    expect(feetDown(gait, r + 0.05 * T)).toEqual({ left: true, right: true });
    expect(feetDown(gait, r + 0.3 * T)).toEqual({ left: false, right: true });
    const s = skeleton(gait.poseAt(r + 0.02));
    // At initial contact the foot is ahead of the pelvis.
    expect(s.joints[J.ANK_R][0]).toBeGreaterThan(s.joints[J.PELVIS][0]);
  });

  it("stands still with both feet down before the walk", () => {
    const a = skeleton(gait.poseAt(truth.standing.from + 0.1));
    const b = skeleton(gait.poseAt(truth.standing.to - 0.1));
    for (const i of [J.ANK_L, J.ANK_R, J.WR_L, J.HEAD]) expect(a.joints[i]).toEqual(b.joints[i]);
  });
});

describe("the seated home scenarios (D-034 item 1)", () => {
  const SEATED = [
    "rom-seated-shoulder-flexion-right",
    "rom-seated-shoulder-flexion-right-150",
    "rom-seated-shoulder-abduction-right",
    "rom-seated-elbow-flexion-right",
  ] as const;
  /** The movement's gate landmarks of the right side, as humanoid joints. */
  const GATE: Record<string, number[]> = {
    shoulder_flexion: [J.SH_R, J.ELB_R],
    shoulder_abduction: [J.SH_L, J.SH_R, J.ELB_R],
    elbow_flexion: [J.SH_R, J.ELB_R, J.WR_R],
  };

  it("are the arm raise to the front (to 120 and to 150), the arm raise to the side and the elbow bend", () => {
    expect(Object.keys(SCENARIOS).filter((id) => id.startsWith("rom-seated-"))).toEqual([...SEATED]);
  });

  for (const id of SEATED)
    describe(id, () => {
      const sc = SCENARIOS[id];
      const truth = scenarioTruth(sc);
      const def = romData.movements.find((m) => m.id === truth.movement)!;

      it("is a movement, position and view of the data, 1.2 to 1.5 m from a 3:4 portrait phone", () => {
        expect(def.positions.map((p) => p.id)).toContain(truth.position);
        expect(truth.view).toBe(def.view);
        expect(sc.camera.pos[2]).toBeGreaterThanOrEqual(1.2);
        expect(sc.camera.pos[2]).toBeLessThanOrEqual(1.5);
        expect(sc.width / sc.height).toBeCloseTo(3 / 4, 9);
        // Closer than the data's distance: what the fix lets through.
        expect(sc.camera.pos[2]).toBeLessThan(([] as number[]).concat(def.distanceM)[0]);
      });

      it("holds the end angle in every loop (the goniometer), and the picture reads close to it", () => {
        for (const hold of truth.holds)
          for (const t of [hold.from + 0.01, (hold.from + hold.to) / 2, hold.to - 0.01])
            expect(movementTruthDeg(truth.movement, skeleton(sc.poseAt(t)), "right")).toBeCloseTo(
              truth.endDeg,
              6,
            );
        expect(movementTruthDeg(truth.movement, skeleton(sc.poseAt(0)), "right")).toBeCloseTo(
          truth.startDeg,
          6,
        );
        // Sitting 30 degrees turned moves the elbow bend's picture by 2 degrees; the others are exact.
        expect(Math.abs(truth.projected.endDeg - truth.endDeg)).toBeLessThan(2.5);
      });

      it("keeps the measured landmarks in the picture and the feet out of it", () => {
        for (let t = 0; t < sc.seconds; t += 0.5) {
          const p = framePoints(sc, skeleton(sc.poseAt(t)));
          for (const j of GATE[truth.movement]) {
            expect(p[j].x, `${t} s, joint ${j}`).toBeGreaterThan(0.03);
            expect(p[j].x).toBeLessThan(0.97);
            expect(p[j].y).toBeGreaterThan(0.03);
            expect(p[j].y).toBeLessThan(0.97);
          }
          for (const j of [J.ANK_L, J.ANK_R, J.HEEL_L, J.HEEL_R, J.TOE_L, J.TOE_R])
            expect(p[j].y > 1 || p[j].x > 1 || p[j].x < 0, `${t} s, joint ${j}`).toBe(true);
        }
      });
    });
});

describe("the D-035 home scenarios: never perfectly still, nobody answering", () => {
  const MVP = [
    "rom-mvp-shoulder-flexion-drift-right",
    "rom-mvp-elbow-flexion-right",
    "rom-mvp-elbow-extension-right",
  ] as const;
  const GATE: Record<string, number[]> = {
    shoulder_flexion: [J.SH_R, J.ELB_R],
    elbow_flexion: [J.SH_R, J.ELB_R, J.WR_R],
    elbow_extension: [J.SH_R, J.ELB_R, J.WR_R],
  };

  it("are the drifting arm raise to the front and both elbow movements", () => {
    expect(Object.keys(SCENARIOS).filter((id) => id.startsWith("rom-mvp-"))).toEqual([...MVP]);
  });

  for (const id of MVP)
    describe(id, () => {
      const sc = SCENARIOS[id];
      const truth = scenarioTruth(sc);
      const def = romData.movements.find((m) => m.id === truth.movement)!;

      it("is a movement, position and view of the data, close to a 3:4 portrait phone, never answered", () => {
        expect(def.positions.map((p) => p.id)).toContain(truth.position);
        expect(truth.view).toBe(def.view);
        expect(sc.camera.pos[2]).toBeGreaterThanOrEqual(1.2);
        expect(sc.camera.pos[2]).toBeLessThanOrEqual(1.5);
        expect(sc.width / sc.height).toBeCloseTo(3 / 4, 9);
        expect(new URLSearchParams(truth.smokeQuery!).get("answer")).toBe("none");
        expect(new URLSearchParams(truth.smokeQuery!).get("movement")).toBe(truth.movement);
      });

      it("the truth reads the movement without the jitter; the picture moves with it", () => {
        const truthPose = sc.truthPoseAt!;
        const hold = truth.holds[0];
        for (const t of [hold.from + 0.01, (hold.from + hold.to) / 2, hold.to - 0.01])
          expect(movementTruthDeg(truth.movement, skeleton(truthPose(t)), "right")).toBeCloseTo(
            truth.endDeg,
            2,
          );
        // The person's own angle wobbles a little at the top (the tremor), never more than 2 degrees.
        const wobble = [0, 0.1, 0.2, 0.3, 0.4].map((dt) =>
          movementTruthDeg(truth.movement, skeleton(sc.poseAt(hold.from + 1 + dt)), "right"),
        );
        expect(Math.max(...wobble) - Math.min(...wobble)).toBeGreaterThan(0.5);
        for (const w of wobble) expect(Math.abs(w - truth.endDeg)).toBeLessThan(2.5);
        // Sitting turned (and the arm drifting out) moves the picture's angle a few degrees.
        expect(Math.abs(truth.projected.endDeg - truth.endDeg)).toBeLessThan(6);
      });

      it("keeps the measured landmarks in the picture and the feet out of it", () => {
        for (let t = 0; t < sc.seconds; t += 0.5) {
          const p = framePoints(sc, skeleton(sc.poseAt(t)));
          for (const j of GATE[truth.movement]) {
            expect(p[j].x, `${t} s, joint ${j}`).toBeGreaterThan(0.03);
            expect(p[j].x).toBeLessThan(0.97);
            expect(p[j].y).toBeGreaterThan(0.03);
            expect(p[j].y).toBeLessThan(0.97);
          }
          for (const j of [J.ANK_L, J.ANK_R, J.HEEL_L, J.HEEL_R, J.TOE_L, J.TOE_R])
            expect(p[j].y > 1 || p[j].x > 1 || p[j].x < 0, `${t} s, joint ${j}`).toBe(true);
        }
      });
    });
});

describe("smokeQuery", () => {
  it("gives the smoke page the run's options from the truth", () => {
    const q = new URLSearchParams(smokeQuery(scenarioTruth(rom)));
    expect(Object.fromEntries(q)).toMatchObject({
      kind: "rom",
      movement: "shoulder_abduction",
      side: "right",
      position: "seated",
    });
    const g = new URLSearchParams(smokeQuery(scenarioTruth(gait)));
    expect(Object.fromEntries(g)).toMatchObject({
      kind: "gait",
      view: "pad_side",
      nearSide: "right",
      mode: "walking_pad",
    });
    expect(Number(g.get("standFrom"))).toBeLessThan(Number(g.get("standTo")));
    expect(Number(g.get("walkTo")) - Number(g.get("walkFrom"))).toBeGreaterThanOrEqual(30);
    expect(Number(g.get("padKmh"))).toBeGreaterThan(0);
    // The rendered person's standing height, for the gait engine's metre scaling.
    expect(Number(g.get("heightCm"))).toBeGreaterThan(165);
    expect(Number(g.get("heightCm"))).toBeLessThan(185);
  });
});
