/**
 * Norms lookup and grading (product v7 contract 2.4, 8.1 A "norms (limits parity, selection
 * examples)"; rom-protocol 4.3 and 5). Every norm row's band computed by the rule (z on the spread of
 * camera readings, the 25% SD cap, the functional floors) equals the limits the clinical table
 * exported within 0.5 degrees; the normSelection examples pick the documented rows; gradeValue and
 * gradeMeasurement follow thresholds.* word for word.
 *
 * Constants that live only in the prose of the clinical source (the SD cap, the 20 degree percent rule,
 * the 120 degree arm raise over read, the phone bias) are checked against it when AZM_CLINICAL_V7 names
 * the clinical folder, as tests/v7/a-export.test.ts does.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARM_RAISES,
  ELEVATION_OVER_READ_ABOVE,
  PERCENT_OF_NORMAL_MIN_N,
  PHONE_BIAS,
  SD_CAP,
  gradeBand,
  gradeMeasurement,
  gradeValue,
  normFor,
  typicalValue,
  type NormPick,
} from "../../src/medical/rom-norms";
import type { Intake, Sex } from "../../src/medical/plan";
import type { RomFlag, RomMeasureResult } from "../../src/engine/rom/types";
import { ROM_DATA, movementDef } from "../../src/movements/rom";
import {
  DEFAULT_ONLY_IDS,
  ROM_MOVEMENT_IDS,
  type JointMovementId,
  type RomMovementId,
  type RomPositionId,
} from "../../src/movements/rom/types";

const pick = (
  m: JointMovementId,
  position: RomPositionId | null,
  sex: Sex,
  age: number,
  side?: "left" | "right",
): NormPick => {
  const p = normFor(m, position, sex, age, side);
  if (!p) throw new Error(`no norm for ${m} ${position}`);
  return p;
};
const band = (p: NormPick) => [p.row.ageMin, p.row.ageMax];

/** The positions of a movement graded against a norm (the floors with a position apply only there). */
const usesOf = (normId: string) =>
  ROM_DATA.movements.flatMap((m) => m.positions.filter((p) => p.normId === normId).map((p) => ({ m, p })));

/* ------------------------------------------------------------ selection */

describe("normFor (rom-protocol 4.3 normSelection)", () => {
  it("ages 18 and 19 use 20 to 59 (McKay) or 20 to 24 (Gill), flagged ageOutsideBand", () => {
    for (const age of [18, 19]) {
      const mckay = pick("knee_flexion", "lying_back", "male", age);
      expect(mckay.norm.id).toBe("mckay_knee_flexion");
      expect(band(mckay)).toEqual([20, 59]);
      expect(mckay.flags).toContain("ageOutsideBand");
      const gill = pick("shoulder_flexion", "seated", "female", age);
      expect(gill.norm.id).toBe("gill_shoulder_flexion");
      expect(band(gill)).toEqual([20, 24]);
      expect(gill.row.sex).toBe("female");
      expect(gill.flags).toEqual(["ageOutsideBand"]);
    }
  });

  it("age 72 uses CDC 45 to 69", () => {
    const p = pick("hip_extension", "standing_supported", "female", 72);
    expect(p.norm.id).toBe("cdc_hip_extension");
    expect(band(p)).toEqual([45, 69]);
    expect(p.flags).toEqual(["ageOutsideBand"]);
  });

  it("neck lateral flexion: 46 uses 18 to 29, 47 is a tie so the older band, 48 to 64 use 65 plus", () => {
    expect(band(pick("neck_lateral_flexion", "seated", "male", 46, "left"))).toEqual([18, 29]);
    expect(band(pick("neck_lateral_flexion", "seated", "male", 47, "left"))).toEqual([65, null]);
    expect(band(pick("neck_lateral_flexion", "seated", "female", 48, "right"))).toEqual([65, null]);
    expect(band(pick("neck_lateral_flexion", "seated", "female", 64, "right"))).toEqual([65, null]);
    expect(band(pick("neck_lateral_flexion", "seated", "female", 30, "right"))).toEqual([18, 29]);
    const inBand = pick("neck_lateral_flexion", "seated", "male", 25, "right");
    expect(inBand.flags).toEqual(["sexAny"]);
    expect(pick("neck_lateral_flexion", "seated", "male", 47, "right").flags).toEqual([
      "ageOutsideBand",
      "sexAny",
    ]);
  });

  it("a band with no upper age holds every older age", () => {
    const p = pick("knee_flexion", "lying_back", "female", 97);
    expect(band(p)).toEqual([60, null]);
    expect(p.flags).toEqual([]);
  });

  it("the tested side's row when the norm has sides", () => {
    const left = pick("shoulder_extension", "seated_forward", "female", 25, "left");
    const right = pick("shoulder_extension", "standing_supported", "female", 25, "right");
    expect(left.row.side).toBe("left");
    expect(left.row.mean).toBe(55.3);
    expect(right.row.side).toBe("right");
    expect(right.row.mean).toBe(56.3);
    expect(pick("neck_lateral_flexion", "seated", "male", 70, "left").row.mean).toBe(29);
    // Without a side, the right row (the side single side norms report).
    expect(pick("shoulder_extension", "seated_forward", "female", 25).row.side).toBe("right");
  });

  it("a norm with only sex any is used for both, flagged sexAny", () => {
    for (const sex of ["male", "female"] as const) {
      const p = pick("hip_abduction", "standing_supported", sex, 40);
      expect(p.norm.id).toBe("boone_hip_abduction");
      expect(p.row.sex).toBe("any");
      expect(p.flags).toEqual(["sexAny"]);
    }
  });

  it("a position with normId null has no norm; a position the movement does not use has none either", () => {
    expect(normFor("knee_flexion", "standing_supported", "male", 40)).toBeNull();
    expect(normFor("knee_extension", "seated", "male", 40)).toBeNull();
    expect(normFor("trunk_lateral_flexion", "seated_armrests", "female", 40)).toBeNull();
    expect(normFor("knee_flexion", "seated", "male", 40)).toBeNull();
  });

  it("position null: the first graded position for a measured movement, the default only movement's norm", () => {
    expect(pick("hip_flexion", null, "male", 40).norm.id).toBe("mckay_hip_flexion");
    expect(pick("knee_extension", null, "male", 40).norm.id).toBe("mckay_knee_extension");
    for (const id of DEFAULT_ONLY_IDS) {
      const def = ROM_DATA.defaultMovements.find((d) => d.id === id)!;
      expect(pick(id, null, "female", 50).norm.id).toBe(def.normId);
    }
  });

  it("finds a row for every movement, sex and adult age", () => {
    for (const id of [...ROM_MOVEMENT_IDS, ...DEFAULT_ONLY_IDS])
      for (const sex of ["male", "female"] as const)
        for (const age of [18, 20, 35, 59, 60, 64, 65, 70, 85, 100])
          for (const side of ["left", "right", undefined] as const)
            expect(normFor(id, null, sex, age, side), `${id} ${sex} ${age} ${side}`).not.toBeNull();
  });
});

describe("typicalValue", () => {
  it("is the row mean rounded to whole degrees", () => {
    expect(typicalValue("knee_flexion", "male", 40)).toBe(136);
    expect(typicalValue("shoulder_flexion", "female", 62)).toBe(147); // 146.5
    expect(typicalValue("shoulder_flexion", "male", 22)).toBe(171); // 170.8
    expect(typicalValue("elbow_extension", "female", 30)).toBe(-4); // lack: past straight
    expect(typicalValue("neck_lateral_flexion", "male", 70, "left")).toBe(29);
    expect(typicalValue("forearm_pronation", "female", 50)).toBe(81); // 81.1
    expect(typicalValue("wrist_flexion", "male", 30)).toBe(80);
  });
});

/* -------------------------------------------------------- limits parity */

describe("every norm row's band equals the exported limits (within 0.5 degrees)", () => {
  const graded = ROM_DATA.norms.filter((n) => n.graded);

  it("every graded position points to a graded norm whose rows all carry limits", () => {
    for (const m of ROM_DATA.movements)
      for (const p of m.positions) {
        if (!p.graded) {
          expect(p.normId, `${m.id} ${p.id}`).toBeNull();
          continue;
        }
        const norm = ROM_DATA.norms.find((n) => n.id === p.normId);
        expect(norm?.graded, `${m.id} ${p.id}`).toBe(true);
        expect(norm!.movement).toBe(m.id);
        for (const r of norm!.rows) expect(r.limits, `${norm!.id}`).not.toBeNull();
      }
    for (const n of ROM_DATA.norms.filter((x) => !x.graded))
      for (const r of n.rows) expect(r.limits, n.id).toBeNull();
  });

  it("σm of each row is the movement's σm and never below its class floor", () => {
    const floor = ROM_DATA.engine.sigmaMFloor;
    for (const n of graded) {
      const def = movementDef(n.movement as RomMovementId);
      expect(def.sigmaM).toBeGreaterThanOrEqual(floor[def.verdict]);
      for (const r of n.rows) expect(r.limits!.sigmaM, n.id).toBe(def.sigmaM);
    }
  });

  it("SDeff is the SD used, capped at 12.5% of N for N of 90 degrees or more", () => {
    for (const n of graded)
      for (const r of n.rows) {
        const l = r.limits!;
        expect(l.sdUsed, n.id).toBe(r.sdUsed ?? r.sd);
        if (l.sdUsed === null) {
          expect(l.sdEff).toBeNull();
          expect(l.flag).toBe("sdUnknown");
          continue;
        }
        const capped = r.mean >= SD_CAP.fromMeanDeg && l.sdUsed > SD_CAP.fraction * r.mean;
        expect(l.capApplied, `${n.id} ${r.sex} ${r.ageMin}`).toBe(capped);
        const sdEff = capped ? SD_CAP.fraction * r.mean : l.sdUsed;
        // The table writes SDs to one decimal: within half of that, plus float noise.
        const oneDecimal = 0.05 + 1e-9;
        expect(Math.abs(l.sdEff! - sdEff), `${n.id} ${r.sex} ${r.ageMin}`).toBeLessThanOrEqual(oneDecimal);
        expect(Math.abs(l.sdObserved! - Math.hypot(sdEff, l.sigmaM))).toBeLessThanOrEqual(oneDecimal);
      }
  });

  it("withinFrom and markedBelow (withinUpTo and markedAbove for lack movements)", () => {
    let rows = 0;
    for (const n of graded)
      for (const { m, p } of usesOf(n.id))
        for (const sex of ["male", "female"] as const)
          for (const r of n.rows) {
            if (r.sex !== "any" && r.sex !== sex) continue;
            const age = r.ageMin;
            const side = r.side;
            const got = gradeBand(m, pick(m.id, p.id, sex, age, side));
            const l = r.limits!;
            const where = `${n.id} ${r.sex} ${r.ageMin} ${side ?? ""}`;
            if (got.kind === "lack") {
              expect(Math.abs(got.withinUpTo - l.withinUpTo!), where).toBeLessThanOrEqual(0.5);
              if (l.markedAbove === null) expect(got.markedAbove, where).toBeNull();
              else expect(Math.abs(got.markedAbove! - l.markedAbove!), where).toBeLessThanOrEqual(0.5);
            } else {
              expect(Math.abs(got.withinFrom - l.withinFrom!), where).toBeLessThanOrEqual(0.5);
              if (l.markedBelow === null) expect(got.markedBelow, where).toBeNull();
              else expect(Math.abs(got.markedBelow! - l.markedBelow!), where).toBeLessThanOrEqual(0.5);
            }
            rows++;
          }
    expect(rows).toBeGreaterThan(100);
  });

  it("floorApplied marks exactly the rows a functional floor moved", () => {
    for (const n of graded)
      for (const { m, p } of usesOf(n.id))
        for (const r of n.rows) {
          const sex = r.sex === "any" ? "male" : r.sex;
          const b = gradeBand(m, pick(m.id, p.id, sex, r.ageMin, r.side));
          expect(b.floorMoved, `${n.id} ${r.sex} ${r.ageMin}`).toBe(r.limits!.floorApplied);
        }
  });

  it("the movement's absoluteFloor says the same as thresholds.functionalFloor on whole degrees", () => {
    const floors = ROM_DATA.thresholds.functionalFloor;
    const hip = movementDef("hip_extension").absoluteFloor!;
    const hipFloor = floors.hip_extension!;
    for (let v = -30; v <= 30; v++) {
      expect(v < hip.mildBelow!, `${v}`).toBe(v < hipFloor.withinMin!);
      expect(v <= hip.markedAtOrBelow!, `${v}`).toBe(v < hipFloor.markedBelow!);
    }
    const knee = movementDef("knee_extension").absoluteFloor!;
    const kneeFloor = floors.knee_extension!;
    expect([knee.lackMildFrom, knee.lackMarkedFrom, knee.position]).toEqual([
      kneeFloor.lackMildFrom,
      kneeFloor.lackMarkedFrom,
      kneeFloor.position,
    ]);
  });

  it("marked is not used only where N - 3 x SDobserved is 0 or less for a movement that cannot go below 0", () => {
    for (const n of graded)
      for (const r of n.rows) {
        const def = movementDef(n.movement as RomMovementId);
        const l = r.limits!;
        const sdObs = Math.hypot(l.sdEff ?? 0, l.sigmaM);
        const floor = ROM_DATA.thresholds.functionalFloor[def.id];
        const zMarkedUsed = def.kind === "lack" || def.canBeNegative || r.mean + l.zMarked * sdObs > 0;
        const floorMarked = def.kind === "lack" ? floor?.lackMarkedFrom : floor?.markedBelow;
        const none = !zMarkedUsed && (floorMarked === undefined || floorMarked === null);
        expect(def.kind === "lack" ? l.markedAbove === null : l.markedBelow === null, n.id).toBe(none);
      }
  });
});

/* -------------------------------------------------------------- grading */

const flagsNone: readonly RomFlag[] = [];

describe("gradeValue (thresholds)", () => {
  const flex = movementDef("shoulder_flexion");
  const men40 = pick("shoulder_flexion", "seated", "male", 42); // N 165.5, SDeff 15.7, σm 5.1

  it("z = (value - (N + b)) / sqrt(SDeff² + σm²), within from -1.96, marked below -3", () => {
    const sdObs = Math.hypot(15.7, 5.1);
    const g = gradeValue(flex, men40, 140, flagsNone);
    expect(g.z).toBeCloseTo((140 - 165.5) / sdObs, 10);
    expect(g.grade).toBe("within");
    expect(gradeValue(flex, men40, 130, flagsNone).grade).toBe("mild");
    expect(gradeValue(flex, men40, 110, flagsNone).grade).toBe("marked");
    expect(PHONE_BIAS.shoulder_flexion).toBe(0);
  });

  it("values above N are within; no finding for being above typical", () => {
    const g = gradeValue(flex, men40, 180, flagsNone);
    expect(g.grade).toBe("within");
    expect(g.z).toBeGreaterThan(0);
    expect(g.floorBroken).toBeNull();
  });

  it("the functional floors make the grade the worse of the two", () => {
    const old = pick("shoulder_flexion", "seated", "female", 88); // N 124.1
    const mild = gradeValue(flex, old, 119, flagsNone);
    expect(mild.z).toBeGreaterThan(-1.96);
    expect(mild.grade).toBe("mild");
    expect(mild.floorBroken).toBe("mild");
    const marked = gradeValue(flex, old, 89, flagsNone);
    expect(marked.grade).toBe("marked");
    expect(marked.floorBroken).toBe("marked");
    expect(gradeValue(flex, old, 120, flagsNone).grade).toBe("within");
  });

  it("hip extension: below 0 at least mild, -10 or less marked, whatever z says", () => {
    const hip = movementDef("hip_extension");
    const p = pick("hip_extension", "standing_supported", "male", 30); // N 17.1
    expect(gradeValue(hip, p, 0, flagsNone).grade).toBe("within");
    expect(gradeValue(hip, p, -1, flagsNone)).toMatchObject({ grade: "mild", floorBroken: "mild" });
    expect(gradeValue(hip, p, -9, flagsNone).grade).toBe("mild");
    expect(gradeValue(hip, p, -10, flagsNone)).toMatchObject({ grade: "marked", floorBroken: "marked" });
    expect(gradeValue(hip, p, -10, flagsNone).z).toBeGreaterThan(-3);
    expect(gradeValue(hip, p, 10, flagsNone).percentOfNormal).toBeNull(); // N under 20
  });

  it("lack movements reverse the sign: a larger lack gives a lower z; the lying floor applies", () => {
    const knee = movementDef("knee_extension");
    const p = pick("knee_extension", "lying_back", "male", 40); // N -1, SDeff 2.3, σm 5.1
    const sdObs = Math.hypot(2.3, 5.1);
    const g = gradeValue(knee, p, 9, flagsNone);
    expect(g.z).toBeCloseTo(-(9 - -1) / sdObs, 10);
    expect(g.grade).toBe("within");
    expect(gradeValue(knee, p, 12, flagsNone).grade).toBe("mild");
    expect(gradeValue(knee, p, 18, flagsNone).grade).toBe("marked");
    expect(gradeValue(knee, p, -5, flagsNone).grade).toBe("within"); // past straight
    expect(g.percentOfNormal).toBeNull();
  });

  it("only within and limited where the range is small (no marked level)", () => {
    const neck = movementDef("neck_extension");
    const p = pick("neck_extension", "seated", "male", 66); // N 40, marked not used
    expect(p.row.limits!.markedBelow).toBeNull();
    expect(gradeValue(neck, p, 0, flagsNone).grade).toBe("mild");
    expect(gradeValue(neck, p, -10, flagsNone).grade).toBe("mild");
  });

  it("an unknown SD uses σm alone", () => {
    const trunk = movementDef("trunk_flexion");
    const p = pick("trunk_flexion", "standing_supported", "female", 50); // N 111, sdEff null, σm 7.7
    const g = gradeValue(trunk, p, 100, flagsNone);
    expect(g.z).toBeCloseTo((100 - 111) / 7.7, 10);
    expect(g.grade).toBe("within");
  });

  it("percent of normal: round(100 x value / N) for flexion with N of 20 degrees or more", () => {
    expect(gradeValue(flex, men40, 132, flagsNone).percentOfNormal).toBe(80); // 79.76
    const ankle = movementDef("ankle_dorsiflexion_lunge");
    expect(
      gradeValue(ankle, pick(ankle.id, "standing_supported", "female", 30), 20, flagsNone).percentOfNormal,
    ).toBe(69); // 20 / 29
  });

  it("approximate: caution movements, gravity mode, arm raises above 120, and the arm raises and lunge in every view", () => {
    const elbow = movementDef("elbow_flexion"); // caution
    expect(gradeValue(elbow, pick(elbow.id, "seated", "male", 40), 140, flagsNone).approximate).toBe(true);
    const kneeFlex = movementDef("knee_flexion"); // measure, not shown approximate
    const kp = pick(kneeFlex.id, "lying_back", "male", 40);
    expect(gradeValue(kneeFlex, kp, 130, flagsNone).approximate).toBe(false);
    expect(gradeValue(kneeFlex, kp, 130, ["gravityMode"]).approximate).toBe(true);
    expect(gradeValue(flex, men40, 100, flagsNone).approximate).toBe(true);
    expect(movementDef("ankle_dorsiflexion_lunge").approximateInPersonView).toBe(true);
  });
});

describe("gradeValue and gradeBand agree on every whole degree of every graded row", () => {
  it("within from (up to), mild between, marked below (above)", () => {
    for (const n of ROM_DATA.norms.filter((x) => x.graded))
      for (const { m, p } of usesOf(n.id))
        for (const r of n.rows) {
          const sex = r.sex === "any" ? "female" : r.sex;
          const pk = pick(m.id, p.id, sex, r.ageMin, r.side);
          const b = gradeBand(m, pk);
          for (let v = -40; v <= 200; v++) {
            const g = gradeValue(m, pk, v, []).grade;
            const expected =
              b.kind === "lack"
                ? v <= b.withinUpTo
                  ? "within"
                  : b.markedAbove !== null && v > b.markedAbove
                    ? "marked"
                    : "mild"
                : v >= b.withinFrom
                  ? "within"
                  : b.markedBelow !== null && v < b.markedBelow
                    ? "marked"
                    : "mild";
            expect(g, `${n.id} ${r.sex} ${r.ageMin} ${r.side ?? ""} value ${v}`).toBe(expected);
          }
        }
  });
});

/* -------------------------------------------------------- the server grade */

const intake = (sex: Sex, age: number) => ({ sex, age }) as Intake & { sex: Sex };
const result = (over: Partial<RomMeasureResult>): RomMeasureResult => ({
  movementId: "knee_flexion",
  side: "right",
  position: "lying_back",
  status: "measured",
  reason: null,
  value: 120,
  median: 118,
  nValid: 3,
  painLimited: false,
  painLevel: null,
  painBefore: 0,
  cause: null,
  attempts: [],
  practice: [],
  retries: 0,
  flags: [],
  quality: { ok: true, retries: 0, issues: [], medianFps: 25, maxPausedShare: 0 },
  poseModel: "full",
  movementVersion: 1,
  engineVersion: "rom_engine_1",
  durationSec: 60,
  ...over,
});

describe("gradeMeasurement (what the server stores, C-3)", () => {
  it("stores the norm pick, z, grade and percent", () => {
    const g = gradeMeasurement(result({ value: 110 }), intake("male", 40));
    expect(g.finding).toBe("marked"); // z (110 - 136) / 8.0 < -3
    expect(g.gradeIgnoringPain).toBe("marked");
    expect(g.percentNormal).toBe(81);
    expect(g.norm).toMatchObject({
      normId: "mckay_knee_flexion",
      row: { sex: "male", ageMin: 20, ageMax: 59 },
      mean: 136,
      sdEff: 6.1,
      sigmaM: 5.1,
      bias: 0,
    });
    expect(g.norm!.z).toBeCloseTo((110 - 136) / Math.hypot(6.1, 5.1), 10);
    expect(g.flags).toEqual([]);
  });

  it("pain limited wins; the degree grade is kept as gradeIgnoringPain", () => {
    const g = gradeMeasurement(result({ value: 125, painLimited: true, painLevel: 4 }), intake("female", 30));
    expect(g.finding).toBe("pain_limited");
    expect(g.gradeIgnoringPain).toBe("within");
  });

  it("a pain stop with a recorded hold is pain limited too", () => {
    const g = gradeMeasurement(
      result({ status: "stopped", reason: "pain_stop", value: 100, painLimited: true, painLevel: 7 }),
      intake("female", 30),
    );
    expect(g.finding).toBe("pain_limited");
    expect(g.gradeIgnoringPain).toBe("marked");
  });

  it("provisional with 1 valid attempt (engine.minValidForGrade 2)", () => {
    expect(ROM_DATA.engine.minValidForGrade).toBe(2);
    expect(gradeMeasurement(result({ nValid: 1 }), intake("male", 40)).flags).toContain("provisional");
    expect(gradeMeasurement(result({ nValid: 2 }), intake("male", 40)).flags).not.toContain("provisional");
  });

  it("no_grade without a norm (a position with normId null): value and progress only", () => {
    const g = gradeMeasurement(
      result({ movementId: "knee_extension", position: "seated", value: 30 }),
      intake("male", 40),
    );
    expect(g).toEqual({
      percentNormal: null,
      finding: "no_grade",
      gradeIgnoringPain: null,
      norm: null,
      flags: [],
    });
  });

  it("not measured: not_today, or unknown when the person could not move the joint", () => {
    const quality = gradeMeasurement(
      result({ status: "not_measured", reason: "quality", value: null, nValid: 0 }),
      intake("male", 40),
    );
    expect(quality).toMatchObject({
      finding: "not_today",
      norm: null,
      percentNormal: null,
      gradeIgnoringPain: null,
    });
    const noMove = gradeMeasurement(
      result({ status: "not_measured", reason: "no_active_movement", value: null, nValid: 0 }),
      intake("male", 40),
    );
    expect(noMove.finding).toBe("unknown");
    const stopped = gradeMeasurement(
      result({ status: "stopped", reason: "pain_stop", value: null, nValid: 0, painLevel: 8 }),
      intake("male", 40),
    );
    expect(stopped.finding).toBe("not_today");
  });

  it("adds approximate, ageOutsideBand and the arm raise over read above 120 degrees", () => {
    const g = gradeMeasurement(
      result({ movementId: "shoulder_abduction", position: "seated", value: 150, flags: ["smallExcursion"] }),
      intake("female", 19),
    );
    expect(g.flags).toEqual(["smallExcursion", "approximate", "ageOutsideBand", "elevationOverRead"]);
    const low = gradeMeasurement(
      result({ movementId: "shoulder_abduction", position: "seated", value: ELEVATION_OVER_READ_ABOVE }),
      intake("female", 40),
    );
    expect(low.flags).toEqual(["approximate"]);
    expect(ARM_RAISES).toEqual(["shoulder_flexion", "shoulder_abduction"]);
  });

  it("a pain stop with a value is pain limited even when the client did not say so", () => {
    const g = gradeMeasurement(
      result({ status: "stopped", reason: "pain_stop", value: 125, painLimited: false, painLevel: 6 }),
      intake("female", 30),
    );
    expect(g.finding).toBe("pain_limited");
    expect(g.gradeIgnoringPain).toBe("within");
  });

  it("derives provisional, approximate, ageOutsideBand and the over read itself (the client's copies are not trusted)", () => {
    const g = gradeMeasurement(
      result({
        nValid: 3,
        flags: ["provisional", "approximate", "ageOutsideBand", "elevationOverRead", "wideHold"],
      }),
      intake("male", 40),
    );
    expect(g.flags).toEqual(["wideHold"]);
  });

  it("uses the tested side's row and the bend direction of axial movements", () => {
    const g = gradeMeasurement(
      result({ movementId: "neck_lateral_flexion", side: "left", position: "seated", value: 29 }),
      intake("female", 70),
    );
    expect(g.norm!.row).toEqual({ sex: "any", ageMin: 65, ageMax: null, side: "left" });
    const none = gradeMeasurement(
      result({ movementId: "trunk_flexion", side: "none", position: "standing_supported", value: 90 }),
      intake("female", 70),
    );
    expect(none.norm!.normId).toBe("esola_trunk_flexion");
    expect(none.norm!.sdEff).toBeNull();
  });
});

/* -------------------------------------- constants only in the clinical prose */

describe.skipIf(!process.env.AZM_CLINICAL_V7)(
  "constants against the clinical source (AZM_CLINICAL_V7)",
  () => {
    const rom = () =>
      JSON.parse(readFileSync(join(process.env.AZM_CLINICAL_V7!, "rom-protocol.json"), "utf8")) as {
        thresholds: Record<string, unknown> & { terms: Record<string, string> };
      };

    it("SDeff cap: 12.5% of N for N of 90 degrees or more", () => {
      const t = rom().thresholds.SDeff as string;
      expect(t).toContain(
        `capped at ${SD_CAP.fraction * 100}% of N for movements with N of ${SD_CAP.fromMeanDeg} degrees or more`,
      );
    });

    it("percent of normal for N of 20 degrees or more", () => {
      const t = rom().thresholds.percentOfNormal as string;
      expect(t).toContain(
        `round(100 x value / N) for flexion and signed movements with N of ${PERCENT_OF_NORMAL_MIN_N} degrees or more`,
      );
    });

    it("arm raises above 120 degrees are approximate (elevationOverRead)", () => {
      const t = rom().thresholds.approximate as string;
      expect(t).toContain(
        `values above ${ELEVATION_OVER_READ_ABOVE} degrees on the arm raises (elevationOverRead)`,
      );
    });

    it("phone bias b is 0 until the bench check", () => {
      expect(rom().thresholds.terms.b).toContain("0 until the bench check");
      expect(new Set(Object.values(PHONE_BIAS))).toEqual(new Set([0]));
      expect(Object.keys(PHONE_BIAS).sort()).toEqual([...ROM_MOVEMENT_IDS].sort());
    });
  },
);
