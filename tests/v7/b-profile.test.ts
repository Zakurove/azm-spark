/**
 * Step B4, contract 2.7 and 8.1 B: the range of motion profile and its findings
 * (src/medical/rom-profile.ts): buildRomProfile (stored rows under their own source, the typical
 * default computed on read for a region that is not on the body map, never typical inside one),
 * romFindings (every causeResolution order of exercise-targets 5.1, the 5.3 priorities, the lines of
 * rom-protocol 7.4), bodyMapSummary and compareRom (the retest rule, rom-protocol 5.3), and the gait
 * retest rule the profile route returns (gait-rules retest.realChange).
 *
 * The rows are graded by the server's own pure grade (gradeMeasurement, C-3), so every value here is
 * read through the norms of the data, never written by hand.
 */
import { describe, expect, it } from "vitest";
import {
  NEUROLOGICAL_CONDITIONS,
  PROFILE_MOVEMENTS,
  UMN_CONDITIONS,
  bodyMapSummary,
  buildRomProfile,
  causePath,
  compareGait,
  compareRom,
  findingPriority,
  profileCell,
  retestBandDeg,
  romFindings,
  type GaitCompared,
} from "../../src/medical/rom-profile";
import { gradeBand, gradeMeasurement, normFor, typicalValue } from "../../src/medical/rom-norms";
import type { Intake, Sex } from "../../src/medical/plan";
import type { RegionEntry } from "../../src/medical/body-map";
import { REGION_IDS } from "../../src/medical/body-map";
import type { RomProfile, RomProfileEntry, StoredRomRow } from "../../src/medical/rom-types";
import type { RomFlag, RomMeasureResult } from "../../src/engine/rom/types";
import {
  NORMS_VERSION,
  ROM_DATA,
  defaultDef,
  movementDef,
  romCopy,
  romResultLine,
} from "../../src/movements/rom";
import { DEFAULT_ONLY_IDS, ROM_MOVEMENT_IDS } from "../../src/movements/rom/types";
import type { JointMovementId, RomMovementId, RomPositionId, RomSide } from "../../src/movements/rom/types";
import { TARGETS_DATA } from "../../src/movements/targets";
import { GAIT_DATA } from "../../src/movements/gait";
import { CHECK_DATA } from "../../src/movements/assessments";
import type { GaitMetricId, GaitMetricValue } from "../../src/engine/gait/types";

/* ---------------------------------------------------------------- people */

function intakeOf(over: Partial<Intake> = {}): Intake & { sex: Sex } {
  return {
    age: 58,
    conditions: [],
    diagnosisNotes: "",
    medications: "",
    mobility: "standing",
    support: "none",
    pain: [],
    restrictions: [],
    symptoms: "no",
    recentChange: "no",
    clearance: "yes",
    equipment: ["chair"],
    goal: "habit",
    days: [0, 2, 4],
    time: "09:00",
    sessionMinutes: 30,
    consent: true,
    sex: "male",
    regions: [],
    walking: { status: "without_aid" },
    ...over,
  } as Intake & { sex: Sex };
}

const entry = (
  region: RegionEntry["region"],
  side: RegionEntry["side"],
  problems: RegionEntry["problems"],
  over: Partial<RegionEntry> = {},
): RegionEntry => ({ region, side, problems, origin: "person", ...over });

/** Fahd (D-025 CT-1): weaker right side after a stroke, the condition's regions on the map. */
const FAHD = intakeOf({
  conditions: ["stroke"],
  support: "right",
  regions: [
    entry("shoulder", "right", ["weakness"], { origin: "condition" }),
    entry("elbow", "right", ["weakness"], { origin: "condition" }),
    entry("knee", "right", ["weakness"], { origin: "condition" }),
  ],
});

/* ------------------------------------------------------------------ rows */

let rowId = 0;

/** A measured result graded by the server's own grade (C-3), stored as A's rom route stores it. */
function measured(
  intake: Intake & { sex: Sex },
  movementId: RomMovementId,
  side: RomSide,
  position: RomPositionId,
  value: number,
  over: Partial<RomMeasureResult> = {},
  row: Partial<StoredRomRow> = {},
): StoredRomRow {
  const def = movementDef(movementId);
  const result = {
    movementId,
    side,
    position,
    status: "measured",
    reason: null,
    value,
    median: value,
    nValid: 3,
    painLimited: false,
    painLevel: null,
    painBefore: 0,
    cause: null,
    attempts: [],
    practice: [],
    retries: 0,
    flags: [],
    quality: { ok: true, retries: 0, issues: [], medianFps: 28, maxPausedShare: 0 },
    poseModel: "full",
    movementVersion: def.version,
    engineVersion: "rom_engine_1",
    durationSec: 40,
    ...over,
  } as RomMeasureResult;
  const g = gradeMeasurement(result, intake);
  const v = result.status === "not_measured" ? null : result.value;
  return {
    id: `row${++rowId}`,
    checkId: "check1",
    movementId,
    side,
    position,
    value: v,
    source: v === null ? "not_measured_today" : "measured",
    reason: result.reason,
    pain: result.painLimited,
    painLevel: result.painLevel,
    painBefore: result.painBefore,
    cause: result.cause,
    percentNormal: g.percentNormal,
    finding: g.finding,
    gradeIgnoringPain: g.gradeIgnoringPain,
    norm: g.norm,
    median: result.median,
    nValid: result.nValid,
    flags: g.flags,
    poseModel: result.poseModel,
    movementVersion: result.movementVersion,
    normsVersion: NORMS_VERSION,
    engineVersion: result.engineVersion,
    created: 1_000_000 + rowId,
    ...row,
  };
}

/** A not measured row as complete or a stop writes it (section 4). */
function notMeasured(
  movementId: JointMovementId,
  side: RomSide,
  source: StoredRomRow["source"],
  reason: StoredRomRow["reason"],
  finding: StoredRomRow["finding"],
): StoredRomRow {
  return {
    id: `row${++rowId}`,
    checkId: "check1",
    movementId,
    side,
    position: null,
    value: null,
    source,
    reason,
    pain: false,
    painLevel: null,
    painBefore: null,
    cause: null,
    percentNormal: null,
    finding,
    gradeIgnoringPain: null,
    norm: null,
    median: null,
    nValid: 0,
    flags: [],
    poseModel: null,
    movementVersion: null,
    normsVersion: NORMS_VERSION,
    engineVersion: null,
    created: 1_000_000 + rowId,
  };
}

/** The first graded position of a movement (its norm's position). */
const graded = (id: RomMovementId) => movementDef(id).positions.find((p) => p.graded)!.id;

/**
 * A value of a movement that grades as `want` for the person (read from the norm's band, so the test
 * follows the data): well inside within normal, between the limits for mild, past the marked limit.
 */
function valueFor(
  intake: Intake & { sex: Sex },
  id: RomMovementId,
  side: RomSide,
  want: "within" | "mild" | "marked",
): number {
  const def = movementDef(id);
  const pick = normFor(id, graded(id), intake.sex, intake.age, side === "none" ? undefined : side)!;
  const band = gradeBand(def, pick);
  if (band.kind === "lack") {
    if (want === "within") return Math.floor(band.withinUpTo) - 1;
    if (want === "marked") return Math.ceil(band.markedAbove!) + 2;
    return Math.round((band.withinUpTo + (band.markedAbove ?? band.withinUpTo + 20)) / 2);
  }
  if (want === "within") return Math.ceil(band.withinFrom) + 1;
  if (want === "marked") return Math.floor(band.markedBelow!) - 2;
  return Math.round((band.withinFrom + (band.markedBelow ?? band.withinFrom - 20)) / 2);
}

const at = (p: RomProfile, id: JointMovementId, side: RomSide) => {
  const e = p.entries.find((x) => x.movementId === id && x.side === side);
  if (!e) throw new Error(`no entry ${id} ${side}`);
  return e;
};

/* ---------------------------------------------------------- the profile */

describe("buildRomProfile: every joint movement and side (contract 2.7, C-4)", () => {
  it("lists every joint movement and side once, in body order", () => {
    const p = buildRomProfile({ intake: FAHD, rows: [], now: 7 });
    const keys = p.entries.map((e) => `${e.movementId}:${e.side}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const id of [...ROM_MOVEMENT_IDS, ...DEFAULT_ONLY_IDS])
      expect(
        p.entries.some((e) => e.movementId === id),
        id,
      ).toBe(true);
    // Limb movements have a right and a left; axial ones measured in both directions too; the other
    // axial ones have no side.
    expect(p.entries.filter((e) => e.movementId === "knee_flexion").map((e) => e.side)).toEqual([
      "right",
      "left",
    ]);
    expect(p.entries.filter((e) => e.movementId === "neck_lateral_flexion").map((e) => e.side)).toEqual([
      "right",
      "left",
    ]);
    expect(p.entries.filter((e) => e.movementId === "neck_rotation").map((e) => e.side)).toEqual(["none"]);
    expect(p.entries.filter((e) => e.movementId === "trunk_flexion").map((e) => e.side)).toEqual(["none"]);
    // Body order: the regions of the body map, the right side before the left.
    const regions = p.entries.map((e) => REGION_IDS.indexOf(e.region));
    expect([...regions].sort((a, b) => a - b)).toEqual(regions);
    expect(PROFILE_MOVEMENTS.length).toBe(ROM_MOVEMENT_IDS.length + DEFAULT_ONLY_IDS.length);
    expect(p).toMatchObject({ sex: "male", age: 58, normsVersion: NORMS_VERSION, created: 7 });
  });

  it("computes the typical default of a region that is not on the body map (rom-protocol 4.3 rule 5)", () => {
    const p = buildRomProfile({ intake: FAHD, rows: [], now: 7 });
    const flex = at(p, "shoulder_flexion", "left");
    const typical = typicalValue("shoulder_flexion", "male", 58, "left")!;
    expect(typical).toBeGreaterThan(90);
    expect(flex).toMatchObject({
      region: "shoulder",
      source: "default",
      finding: "default",
      kind: "flexion",
      value: typical,
      typical,
      percentOfNormal: 100,
      z: null,
      painLimited: false,
      provisional: false,
      noActiveMovement: false,
      reason: null,
      measuredAt: null,
      checkId: null,
    });
    // «null for lack movements»: the elbow straightening's default has no percent of normal.
    const lack = at(p, "elbow_extension", "left");
    expect(lack).toMatchObject({ source: "default", kind: "lack", percentOfNormal: null });
    expect(lack.typical).toBe(typicalValue("elbow_extension", "male", 58, "left"));
    // A default only movement of a region off the map takes its own norm (the wrist, the neck turn).
    const wrist = at(p, "wrist_flexion", "left");
    expect(wrist).toMatchObject({ source: "default", value: typicalValue("wrist_flexion", "male", 58) });
    expect(at(p, "neck_rotation", "none")).toMatchObject({
      source: "default",
      value: typicalValue("neck_rotation", "male", 58),
    });
    // The norm follows the person's sex and age.
    const older = buildRomProfile({ intake: { ...FAHD, sex: "female", age: 72 }, rows: [], now: 7 });
    expect(at(older, "knee_flexion", "left").typical).toBe(
      typicalValue("knee_flexion", "female", 72, "left"),
    );
  });

  it("never counts a movement of a region on the body map as typical (review A01, ROM-Q15)", () => {
    const intake = intakeOf({
      regions: [
        entry("shoulder", "right", ["stiffness"]),
        entry("neck", "axial", ["pain"]),
        entry("hip", "both", ["stiffness"]),
      ],
    });
    const p = buildRomProfile({ intake, rows: [], now: 7 });
    // A camera movement without a stored row: not measured today, no value, no typical value.
    expect(at(p, "shoulder_flexion", "right")).toMatchObject({
      source: "not_measured_today",
      finding: "not_today",
      value: null,
      typical: null,
      percentOfNormal: null,
      reason: null,
    });
    // A default only movement of the region: not measured by the camera, grey, never typical.
    expect(at(p, "shoulder_internal_rotation", "right")).toMatchObject({
      source: "not_measured_camera",
      finding: "unknown",
      value: null,
      typical: null,
      reason: "not_measured_camera",
    });
    // The other shoulder is not on the map: typical.
    expect(at(p, "shoulder_flexion", "left").source).toBe("default");
    // An axial entry covers every direction of its movements; "both" covers both sides.
    for (const side of ["right", "left"] as const) {
      expect(at(p, "neck_lateral_flexion", side).source).toBe("not_measured_today");
      expect(at(p, "hip_flexion", side).source).toBe("not_measured_today");
      expect(at(p, "hip_internal_rotation", side).source).toBe("not_measured_camera");
    }
    expect(at(p, "neck_flexion", "none").source).toBe("not_measured_today");
    expect(at(p, "neck_rotation", "none").source).toBe("not_measured_camera");
    expect(at(p, "trunk_flexion", "none").source).toBe("default");
    expect(p.entries.filter((e) => e.source !== "default" && e.typical !== null)).toEqual([]);
  });

  it("keeps a stored row under its own source, with the typical value it was graded against", () => {
    const value = valueFor(FAHD, "knee_flexion", "right", "mild");
    const row = measured(FAHD, "knee_flexion", "right", "lying_back", value, { nValid: 1, median: value });
    expect(row.finding).toBe("mild");
    const p = buildRomProfile({ intake: FAHD, rows: [row], now: 9 });
    expect(at(p, "knee_flexion", "right")).toMatchObject({
      source: "measured",
      region: "knee",
      kind: "flexion",
      value,
      typical: Math.round(row.norm!.mean),
      percentOfNormal: row.percentNormal,
      z: row.norm!.z,
      finding: "mild",
      gradeIgnoringPain: "mild",
      provisional: true,
      measuredAt: row.created,
      checkId: "check1",
      reason: null,
    });
    expect(at(p, "knee_flexion", "right").flags).toEqual(row.flags);
    // The arm raises are approximate in the person's view too (B17): the stored flag is carried.
    const arm = measured(FAHD, "shoulder_flexion", "right", "seated", 150);
    expect(
      at(buildRomProfile({ intake: FAHD, rows: [arm], now: 9 }), "shoulder_flexion", "right"),
    ).toMatchObject({ approximate: true });
  });

  it("gives a value measured in a position without a matched norm no typical value (value and progress only)", () => {
    const row = measured(FAHD, "knee_extension", "right", "seated", 30);
    expect(row.finding).toBe("no_grade");
    expect(
      at(buildRomProfile({ intake: FAHD, rows: [row], now: 9 }), "knee_extension", "right"),
    ).toMatchObject({
      source: "measured",
      value: 30,
      finding: "no_grade",
      typical: null,
      percentOfNormal: null,
      z: null,
    });
  });

  it("keeps the typical default of a joint the person could not move, flagged and never as a value (4.3 rule 9)", () => {
    const row = measured(FAHD, "elbow_extension", "right", "seated", 0, {
      status: "not_measured",
      reason: "no_active_movement",
      value: null,
      median: null,
      nValid: 0,
    });
    expect(row).toMatchObject({ source: "not_measured_today", finding: "unknown" });
    expect(
      at(buildRomProfile({ intake: FAHD, rows: [row], now: 9 }), "elbow_extension", "right"),
    ).toMatchObject({
      source: "not_measured_today",
      finding: "unknown",
      value: null,
      typical: typicalValue("elbow_extension", "male", 58, "right"),
      noActiveMovement: true,
      reason: "no_active_movement",
      measuredAt: null,
    });
  });

  it("keeps every stored row where it is, on the body map or not", () => {
    // A residual hip after a loss above the knee, marked on the knee: stored as the protocol wrote it.
    const intake = intakeOf({
      regions: [entry("knee", "right", ["limb_loss"], { limbLoss: { level: "above_knee" } })],
    });
    const rows = [
      notMeasured("hip_flexion", "right", "not_measured_camera", "not_measured_camera", "unknown"),
      notMeasured("knee_flexion", "right", "not_applicable", "limb_absent", "not_applicable"),
    ];
    const p = buildRomProfile({ intake, rows, now: 9 });
    expect(at(p, "hip_flexion", "right")).toMatchObject({
      source: "not_measured_camera",
      finding: "unknown",
    });
    expect(at(p, "knee_flexion", "right")).toMatchObject({
      source: "not_applicable",
      finding: "not_applicable",
      typical: null,
      value: null,
    });
    // The hip's other movements have no row and the hip is not on the map: typical.
    expect(at(p, "hip_internal_rotation", "right").source).toBe("default");
  });

  it("reads the last stored row of a movement and side", () => {
    const first = measured(FAHD, "knee_flexion", "right", "lying_back", 100, {}, { created: 10 });
    const later = measured(FAHD, "knee_flexion", "right", "lying_back", 120, {}, { created: 20 });
    expect(
      at(buildRomProfile({ intake: FAHD, rows: [later, first], now: 9 }), "knee_flexion", "right").value,
    ).toBe(120);
  });
});

/* ---------------------------------------------------------- the findings */

/** The profile entry of one stored row for this person (the rest of the profile as it comes). */
function entryOf(intake: Intake & { sex: Sex }, row: StoredRomRow): RomProfileEntry {
  return at(buildRomProfile({ intake, rows: [row], now: 9 }), row.movementId, row.side);
}

describe("romFindings: the limited results with their path, priority and line (exercise-targets 5)", () => {
  it("lists the limited, pain limited and unknown results, never within, typical, not today or not applicable", () => {
    const rows = [
      measured(
        FAHD,
        "knee_flexion",
        "right",
        "lying_back",
        valueFor(FAHD, "knee_flexion", "right", "within"),
      ),
      measured(
        FAHD,
        "knee_extension",
        "right",
        "lying_back",
        valueFor(FAHD, "knee_extension", "right", "mild"),
      ),
      measured(
        FAHD,
        "shoulder_flexion",
        "right",
        "seated",
        valueFor(FAHD, "shoulder_flexion", "right", "marked"),
      ),
      measured(FAHD, "shoulder_abduction", "right", "seated", 100, { painLimited: true, painLevel: 4 }),
      notMeasured("shoulder_extension", "right", "not_measured_today", "deferred", "not_today"),
      notMeasured("elbow_flexion", "right", "not_applicable", "limb_absent", "not_applicable"),
    ];
    const f = romFindings(buildRomProfile({ intake: FAHD, rows, now: 9 }), FAHD);
    expect(f.map((x) => [x.movementId, x.side, x.finding])).toEqual([
      ["shoulder_flexion", "right", "marked"],
      ["shoulder_abduction", "right", "pain_limited"],
      ["knee_extension", "right", "mild"],
    ]);
    const knee = f.find((x) => x.movementId === "knee_extension")!;
    const kneeEntry = entryOf(FAHD, rows[1]);
    expect(knee).toMatchObject({
      region: "knee",
      value: kneeEntry.value,
      typical: kneeEntry.typical,
      percentOfNormal: null,
      provisional: false,
      approximate: false,
      noActiveMovement: false,
      cause: null,
    });
  });

  it("gives each grade its priority: mild 2, marked and pain limited 3, one lower with one valid try", () => {
    const one = { nValid: 1 };
    const cases: [RomMovementId, number, Partial<RomMeasureResult>, 1 | 2 | 3][] = [
      ["knee_flexion", valueFor(FAHD, "knee_flexion", "right", "mild"), {}, 2],
      ["knee_flexion", valueFor(FAHD, "knee_flexion", "right", "marked"), {}, 3],
      ["knee_flexion", 100, { painLimited: true, painLevel: 3 }, 3],
      ["knee_flexion", valueFor(FAHD, "knee_flexion", "right", "mild"), one, 1],
      ["knee_flexion", valueFor(FAHD, "knee_flexion", "right", "marked"), one, 2],
      ["knee_flexion", 100, { painLimited: true, painLevel: 3, ...one }, 2],
    ];
    for (const [id, value, over, priority] of cases) {
      const e = entryOf(FAHD, measured(FAHD, id, "right", "lying_back", value, over));
      expect(findingPriority(e), `${value} ${JSON.stringify(over)}`).toBe(priority);
    }
  });

  it("reads the priorities from the targets data (5.3 gradeRules)", () => {
    const rule = (name: string) => TARGETS_DATA.mapping.gradeRules.find((r) => r.finding === name)!;
    expect(rule("mildlyLimited").priority).toBe(2);
    expect(rule("markedlyLimited").priority).toBe(3);
    expect(rule("painLimited").priority).toBe(3);
    expect(rule("provisional (1 valid attempt)").priority).toBe("one lower");
    expect(rule("not_measured_camera (residual joint after limb loss)").priority).toBe(1);
    expect(rule("noNormPosition (value and progress only)")).toMatchObject({
      seatedLackAbove: 52,
      seatedLackPriority: 1,
    });
    // The seated knee number is the same in the range data (refer_measure) and the targets data.
    const seated = movementDef("knee_extension").positions.find((p) => p.id === "seated")!;
    expect(seated.referMeasureLackAbove).toBe(
      rule("noNormPosition (value and progress only)").seatedLackAbove,
    );
  });

  describe("causeResolution, first match wins (exercise-targets 5.1)", () => {
    const mild = (intake: Intake & { sex: Sex }, id: RomMovementId, side: RomSide = "right") =>
      valueFor(intake, id, side, "mild");
    const pathOf = (
      intake: Intake & { sex: Sex },
      id: RomMovementId,
      over: Partial<RomMeasureResult> = {},
      side: RomSide = "right",
    ) =>
      causePath(
        entryOf(intake, measured(intake, id, side, graded(id), mild(intake, id, side), over)),
        intake,
      );

    it("reads the rules in the data's order", () => {
      expect(TARGETS_DATA.mapping.causeResolution.map((r) => [r.order, r.path])).toEqual([
        [1, "post_op_early"],
        [2, "umn"],
        [3, "pd"],
        [4, "tight"],
        [5, "weak"],
        [6, "pain_stable"],
        [7, "rehab"],
        [8, "weak"],
        [9, "tight"],
        [10, "weak"],
        [11, "pain_stable"],
        [12, "rehab"],
        [13, "unknown"],
      ]);
    });

    it("1: surgery in that region under 12 weeks, cleared for active movement: post_op_early", () => {
      const recent = (since: "lt6w" | "6w_3m" | "3m_6m") =>
        intakeOf({
          regions: [
            entry("knee", "right", ["after_surgery"], { surgery: { since, cleared: "yes", avoid: [] } }),
          ],
        });
      expect(pathOf(recent("lt6w"), "knee_flexion", { cause: "tight" })).toBe("post_op_early");
      expect(pathOf(recent("6w_3m"), "knee_flexion", { cause: "weak" })).toBe("post_op_early");
      // From 12 weeks the surgery is history (order 7), not early.
      expect(pathOf(recent("3m_6m"), "knee_flexion")).toBe("rehab");
      // The rule reads the data's number.
      expect(TARGETS_DATA.mapping.causeResolution[0].surgeryUnderWeeks).toBe(12);
    });

    it("2: stroke, MS, cerebral palsy or incomplete SCI on a limb the condition filled in: umn", () => {
      expect(pathOf(FAHD, "knee_flexion", { cause: "tight" })).toBe("umn");
      for (const c of ["ms", "cerebral_palsy", "sci_incomplete"])
        expect(pathOf({ ...FAHD, conditions: [c] }, "knee_flexion")).toBe("umn");
      // Complete SCI is not on the list; a region the person added is not the condition's.
      expect(pathOf({ ...FAHD, conditions: ["sci_complete"] }, "knee_flexion")).toBe("weak");
      const own = intakeOf({ conditions: ["stroke"], regions: [entry("knee", "right", ["weakness"])] });
      expect(pathOf(own, "knee_flexion")).toBe("weak");
      expect([...UMN_CONDITIONS]).toEqual(["stroke", "ms", "cerebral_palsy", "sci_incomplete"]);
      expect(TARGETS_DATA.mapping.causeResolution[1].if).toContain(
        "Stroke, MS, cerebral palsy or incomplete SCI",
      );
    });

    it("3: Parkinson's in the conditions: pd", () => {
      const pd = intakeOf({
        conditions: ["parkinsons"],
        regions: [entry("shoulder", "right", ["stiffness"], { origin: "condition" })],
      });
      expect(pathOf(pd, "shoulder_flexion", { cause: "weak" })).toBe("pd");
    });

    it("4: the answer tight: tight, or rehab with an injury over 6 weeks or surgery from 12 weeks", () => {
      const stiff = intakeOf({ regions: [entry("knee", "right", ["stiffness"])] });
      expect(pathOf(stiff, "knee_flexion", { cause: "tight" })).toBe("tight");
      const injured = (since: "6w_3m" | "gt6m") =>
        intakeOf({ regions: [entry("knee", "right", ["injury"], { injury: { since } })] });
      expect(pathOf(injured("6w_3m"), "knee_flexion", { cause: "tight" })).toBe("rehab");
      expect(pathOf(injured("gt6m"), "knee_flexion", { cause: "tight" })).toBe("rehab");
      const operated = intakeOf({
        regions: [entry("knee", "right", ["after_surgery"], { surgery: { since: "gt6m" } })],
      });
      expect(pathOf(operated, "knee_flexion", { cause: "tight" })).toBe("rehab");
      const alt = TARGETS_DATA.mapping.causeResolution[3].alternatives![0];
      expect(alt).toMatchObject({ path: "rehab", injuryOverWeeks: 6, surgeryFromWeeks: 12 });
    });

    it("5: the answer weak: weak", () => {
      const stiff = intakeOf({ regions: [entry("knee", "right", ["stiffness"])] });
      expect(pathOf(stiff, "knee_flexion", { cause: "weak" })).toBe("weak");
    });

    it("6: the answer pain or a pain limited result: pain_stable, irritable by the rise, the day's pain or a recent injury", () => {
      const sore = intakeOf({ regions: [entry("knee", "right", ["stiffness"])] });
      expect(pathOf(sore, "knee_flexion", { cause: "pain" })).toBe("pain_stable");
      // A pain limited result reads as the pain answer; a rise of 2 over the score before is irritable.
      expect(pathOf(sore, "knee_flexion", { painLimited: true, painLevel: 1 })).toBe("pain_stable");
      expect(pathOf(sore, "knee_flexion", { painLimited: true, painLevel: 2 })).toBe("pain_irritable");
      const recent = intakeOf({
        regions: [entry("knee", "right", ["injury"], { injury: { since: "6w_3m" } })],
      });
      expect(pathOf(recent, "knee_flexion", { cause: "pain" })).toBe("pain_irritable");
      const older = intakeOf({
        regions: [entry("knee", "right", ["injury"], { injury: { since: "3m_6m" } })],
      });
      expect(pathOf(older, "knee_flexion", { cause: "pain" })).toBe("pain_stable");
      const alt = TARGETS_DATA.mapping.causeResolution[5].alternatives![0];
      expect(alt).toMatchObject({
        path: "pain_irritable",
        painRiseGte: 2,
        painToday: [4, 5],
        injuryOrSurgeryUnderMonths: 3,
      });
    });

    it("6: today's pain 4 or 5 before the movement is irritable, with no pain score during it", () => {
      const sore = intakeOf({ regions: [entry("knee", "right", ["pain"])] });
      for (const before of [4, 5])
        expect(pathOf(sore, "knee_flexion", { cause: "pain", painLevel: null, painBefore: before })).toBe(
          "pain_irritable",
        );
      expect(pathOf(sore, "knee_flexion", { cause: "pain", painLevel: null, painBefore: 3 })).toBe(
        "pain_stable",
      );
      // The rise counts from the score before: 2 then 3 is a rise of 1.
      expect(pathOf(sore, "knee_flexion", { painLimited: true, painLevel: 3, painBefore: 2 })).toBe(
        "pain_stable",
      );
      // An unknown score before in a body map pain or injury region reads as irritable (the safe side).
      expect(pathOf(sore, "knee_flexion", { cause: "pain", painLevel: null, painBefore: null })).toBe(
        "pain_irritable",
      );
      const stiff = intakeOf({ regions: [entry("knee", "right", ["stiffness"])] });
      expect(pathOf(stiff, "knee_flexion", { cause: "pain", painLevel: null, painBefore: null })).toBe(
        "pain_stable",
      );
    });

    it("11: a body map pain region with today's pain 4 or 5 is irritable", () => {
      const sore = intakeOf({ regions: [entry("knee", "right", ["pain"])] });
      expect(pathOf(sore, "knee_flexion", { painBefore: 4 })).toBe("pain_irritable");
      expect(pathOf(sore, "knee_flexion", { painBefore: 5 })).toBe("pain_irritable");
      expect(pathOf(sore, "knee_flexion", { painBefore: 2 })).toBe("pain_stable");
    });

    it("7: an injury older than 6 weeks, or surgery from 12 weeks or with loading clearance: rehab", () => {
      const injured = intakeOf({
        regions: [entry("knee", "right", ["injury"], { injury: { since: "6w_3m" } })],
      });
      expect(pathOf(injured, "knee_flexion")).toBe("rehab");
      const loaded = intakeOf({
        regions: [
          entry("knee", "right", ["after_surgery"], {
            surgery: { since: "6w_3m", cleared: "no", avoid: [], loadAllowed: "yes" },
          }),
        ],
      });
      expect(pathOf(loaded, "knee_flexion")).toBe("rehab");
    });

    it("8: the side leg raise with no answer: weak, unless CP or MS is listed with tightness", () => {
      const stiff = intakeOf({ regions: [entry("hip", "right", ["stiffness"])] });
      expect(pathOf(stiff, "hip_abduction")).toBe("weak");
      expect(pathOf(stiff, "hip_flexion")).toBe("tight");
      const cp = intakeOf({ conditions: ["ms"], regions: [entry("hip", "right", ["stiffness"])] });
      expect(pathOf(cp, "hip_abduction")).toBe("tight");
    });

    it("9: stiffness without arthritis, injury or surgery: tight", () => {
      expect(pathOf(intakeOf({ regions: [entry("knee", "right", ["stiffness"])] }), "knee_flexion")).toBe(
        "tight",
      );
      const arthritis = intakeOf({
        conditions: ["arthritis"],
        regions: [entry("knee", "right", ["stiffness"])],
      });
      expect(pathOf(arthritis, "knee_flexion")).toBe("unknown");
    });

    it("10: weakness or paralysis: weak", () => {
      expect(pathOf(intakeOf({ regions: [entry("knee", "right", ["weakness"])] }), "knee_flexion")).toBe(
        "weak",
      );
    });

    it("11: pain on the body map: pain_stable, or irritable as order 6", () => {
      expect(pathOf(intakeOf({ regions: [entry("knee", "right", ["pain"])] }), "knee_flexion")).toBe(
        "pain_stable",
      );
      const recent = intakeOf({
        regions: [
          entry("knee", "right", ["pain", "after_surgery"], {
            surgery: { since: "lt6w", cleared: "no", avoid: [] },
          }),
        ],
      });
      expect(pathOf(recent, "knee_flexion")).toBe("pain_irritable");
    });

    it("12: limb loss, a present joint above the loss: rehab", () => {
      const below = intakeOf({
        regions: [entry("ankle_foot", "right", ["limb_loss"], { limbLoss: { level: "below_knee" } })],
      });
      expect(pathOf(below, "hip_flexion")).toBe("rehab");
      // The other leg is not above the loss.
      expect(pathOf(below, "hip_flexion", {}, "left")).toBe("unknown");
    });

    it("13: nothing above: unknown", () => {
      expect(pathOf(intakeOf(), "knee_flexion")).toBe("unknown");
    });
  });

  it("writes the line from the person's answer, then the path (rom-protocol 7.4)", () => {
    const line = (intake: Intake & { sex: Sex }, over: Partial<RomMeasureResult>) => {
      const row = measured(
        intake,
        "knee_flexion",
        "right",
        "lying_back",
        valueFor(intake, "knee_flexion", "right", "mild"),
        over,
      );
      return romFindings(buildRomProfile({ intake, rows: [row], now: 9 }), intake)[0].line;
    };
    const stiff = intakeOf({ regions: [entry("knee", "right", ["stiffness"])] });
    expect(line(stiff, { cause: "weak" })).toEqual(romResultLine("finding_weak"));
    expect(line(stiff, { cause: "tight" })).toEqual(romResultLine("finding_tight"));
    expect(line(stiff, { cause: "pain" })).toEqual(romResultLine("finding_pain"));
    expect(line(stiff, { painLimited: true, painLevel: 3 })).toEqual(romResultLine("finding_pain"));
    expect(line(stiff, {})).toEqual(romResultLine("finding_tight"));
    expect(line(FAHD, {})).toEqual(romResultLine("finding_weak"));
    expect(
      line(intakeOf({ conditions: ["parkinsons"], regions: [entry("knee", "right", ["stiffness"])] }), {}),
    ).toEqual(romResultLine("finding_tight"));
    // No line the data writes fits an unknown cause: none is shown (contract gap B4-G2).
    expect(line(intakeOf(), {})).toEqual({ ar: "", en: "" });
    expect(line(intakeOf({ regions: [entry("knee", "right", ["pain"])] }), {})).toEqual({ ar: "", en: "" });
  });

  it("lists a seated knee lack above 52 at priority 1 with refer_measure, and no other ungraded value", () => {
    const at60 = measured(FAHD, "knee_extension", "right", "seated", 60);
    const at52 = measured(FAHD, "knee_extension", "right", "seated", 52);
    const seatedHip = measured(FAHD, "hip_flexion", "right", "seated", 70);
    const f = (row: StoredRomRow) =>
      romFindings(buildRomProfile({ intake: FAHD, rows: [row], now: 9 }), FAHD);
    expect(f(at60)).toMatchObject([
      {
        movementId: "knee_extension",
        finding: "no_grade",
        priority: 1,
        value: 60,
        typical: null,
        line: romResultLine("refer_measure"),
      },
    ]);
    expect(f(at52)).toEqual([]);
    expect(f(seatedHip)).toEqual([]);
    // Lying knee straightening always has a norm row, so an ungraded knee straightening is the seated one.
    for (const sex of ["male", "female"] as const)
      for (let age = 18; age <= 100; age++) {
        const pick = normFor("knee_extension", "lying_back", sex, age, "right");
        expect(pick?.norm.graded && pick.row.limits !== null, `${sex} ${age}`).toBe(true);
      }
  });

  it("lists a residual joint the camera cannot measure, and a joint the person could not move, at priority 1", () => {
    const intake = intakeOf({
      regions: [entry("knee", "right", ["limb_loss"], { limbLoss: { level: "above_knee" } })],
    });
    const rows = [
      notMeasured("hip_flexion", "right", "not_measured_camera", "not_measured_camera", "unknown"),
      notMeasured("hip_internal_rotation", "right", "not_measured_camera", "not_measured_camera", "unknown"),
    ];
    const f = romFindings(buildRomProfile({ intake, rows, now: 9 }), intake);
    // The default only movement is left to the region default rule (5.6): no RomFinding.
    expect(f).toMatchObject([
      {
        movementId: "hip_flexion",
        finding: "unknown",
        priority: 1,
        path: "rehab",
        line: romResultLine("refer_measure"),
      },
    ]);
    const stuck = measured(FAHD, "elbow_extension", "right", "seated", 0, {
      status: "not_measured",
      reason: "no_active_movement",
      value: null,
      median: null,
      nValid: 0,
    });
    expect(romFindings(buildRomProfile({ intake: FAHD, rows: [stuck], now: 9 }), FAHD)).toMatchObject([
      {
        movementId: "elbow_extension",
        finding: "unknown",
        noActiveMovement: true,
        priority: 1,
        path: "umn",
        value: null,
        typical: typicalValue("elbow_extension", "male", 58, "right"),
        line: romCopy("no_active_movement"),
      },
    ]);
  });
});

/* ------------------------------------------------------- the body map */

describe("bodyMapSummary: one colour per body map cell", () => {
  it("colours each finding, grey for what was not measured, nothing for typical or absent joints", () => {
    const intake = intakeOf({
      regions: [
        entry("shoulder", "right", ["stiffness"]),
        entry("elbow", "right", ["stiffness"]),
        entry("knee", "both", ["pain"]),
        entry("hip", "right", ["stiffness"]),
        entry("ankle_foot", "left", ["limb_loss"], { limbLoss: { level: "below_knee" } }),
      ],
    });
    const rows = [
      measured(
        intake,
        "shoulder_flexion",
        "right",
        "seated",
        valueFor(intake, "shoulder_flexion", "right", "within"),
      ),
      measured(
        intake,
        "elbow_flexion",
        "right",
        "seated",
        valueFor(intake, "elbow_flexion", "right", "mild"),
      ),
      measured(
        intake,
        "knee_flexion",
        "right",
        "lying_back",
        valueFor(intake, "knee_flexion", "right", "marked"),
      ),
      measured(intake, "knee_flexion", "left", "lying_back", 100, { painLimited: true, painLevel: 4 }),
      measured(intake, "hip_flexion", "right", "seated", 80),
      // The protocol stores every movement of an absent joint as not applicable (2.4).
      ...(["ankle_dorsiflexion_lunge", "ankle_plantarflexion", "ankle_dorsiflexion_nwb"] as const).map((id) =>
        notMeasured(id, "left", "not_applicable", "limb_absent", "not_applicable"),
      ),
    ];
    const map = bodyMapSummary(buildRomProfile({ intake, rows, now: 9 }));
    expect(map).toEqual({
      "shoulder:right": "within",
      "elbow:right": "mild",
      "knee:right": "marked",
      "knee:left": "pain",
      // An ungraded value and the rest of the hip, not measured: grey.
      "hip:right": "grey",
    });
  });

  it("shows the strongest of a cell's results: pain, then marked, mild, within, grey", () => {
    const intake = intakeOf({
      regions: [entry("knee", "right", ["stiffness"]), entry("neck", "axial", ["stiffness"])],
    });
    const kneeRows = (a: StoredRomRow, b: StoredRomRow) =>
      bodyMapSummary(buildRomProfile({ intake, rows: [a, b], now: 9 }))["knee:right"];
    const flex = (g: "within" | "mild" | "marked") =>
      measured(intake, "knee_flexion", "right", "lying_back", valueFor(intake, "knee_flexion", "right", g));
    const ext = (g: "within" | "mild" | "marked") =>
      measured(
        intake,
        "knee_extension",
        "right",
        "lying_back",
        valueFor(intake, "knee_extension", "right", g),
      );
    const pain = measured(intake, "knee_extension", "right", "lying_back", 8, {
      painLimited: true,
      painLevel: 3,
    });
    expect(kneeRows(flex("marked"), pain)).toBe("pain");
    expect(kneeRows(flex("marked"), ext("mild"))).toBe("marked");
    expect(kneeRows(flex("within"), ext("mild"))).toBe("mild");
    expect(kneeRows(flex("within"), ext("within"))).toBe("within");
    expect(bodyMapSummary(buildRomProfile({ intake, rows: [flex("within")], now: 9 }))["knee:right"]).toBe(
      "within",
    );
    // The neck's directions share one cell.
    const neck = [
      measured(
        intake,
        "neck_lateral_flexion",
        "left",
        "seated",
        valueFor(intake, "neck_lateral_flexion", "left", "mild"),
      ),
      measured(intake, "neck_flexion", "none", "seated", valueFor(intake, "neck_flexion", "none", "within")),
    ];
    expect(bodyMapSummary(buildRomProfile({ intake, rows: neck, now: 9 }))["neck:axial"]).toBe("mild");
    expect(profileCell("neck", "left")).toBe("neck:axial");
    expect(profileCell("knee", "left")).toBe("knee:left");
  });
});

/* ------------------------------------------------------------ the retest */

describe("compareRom: the retest rule (rom-protocol 5.3, review B15)", () => {
  const row = (
    id: RomMovementId,
    value: number,
    median: number,
    over: Partial<StoredRomRow> = {},
    side: RomSide = "right",
  ): StoredRomRow => ({
    ...notMeasured(id, side, "measured", null, "within"),
    position: graded(id),
    value,
    median,
    nValid: 3,
    poseModel: "full",
    movementVersion: movementDef(id).version,
    engineVersion: "rom_engine_1",
    ...over,
  });

  it("calls a change only when the best and the median both pass the band in the same direction", () => {
    const first = [row("knee_flexion", 100, 98)];
    const one = (value: number, median: number, conditions: string[] = []) =>
      compareRom(first, [row("knee_flexion", value, median)], conditions)[0];
    expect(one(115, 112)).toEqual({
      movementId: "knee_flexion",
      side: "right",
      first: 100,
      latest: 115,
      bandDeg: 10,
      direction: "better",
    });
    expect(one(85, 86)).toMatchObject({ direction: "worse", first: 100, latest: 85 });
    // Only the best passed the band; or the median moved the other way; or exactly the band.
    expect(one(115, 105).direction).toBe("same");
    expect(one(111, 97).direction).toBe("same");
    expect(one(110, 108).direction).toBe("same");
    // A lack is better when it shrinks.
    const lack = compareRom([row("knee_extension", 25, 26)], [row("knee_extension", 8, 9)], []);
    expect(lack[0]).toMatchObject({ direction: "better", first: 25, latest: 8, bandDeg: 11 });
    expect(compareRom([row("knee_extension", 8, 9)], [row("knee_extension", 25, 26)], [])[0].direction).toBe(
      "worse",
    );
  });

  it("reads each movement's band from the data, never below 10", () => {
    const r = ROM_DATA.retest;
    expect(r).toMatchObject({ floorDeg: 10, defaultDeg: 10 });
    expect(retestBandDeg("knee_flexion", "lying_back", [])).toBe(10);
    // «on a limb affected by a neurological condition, shoulder flexion 18»
    expect(retestBandDeg("shoulder_flexion", "seated", [])).toBe(10);
    expect(retestBandDeg("shoulder_flexion", "seated", ["stroke"])).toBe(
      r.bands.shoulder_flexion!.neurologicalDeg,
    );
    expect(retestBandDeg("shoulder_flexion", "seated", ["stroke"])).toBe(18);
    // «elbow 36 (the home MDC95 ...), for both elbow movements» (FZ-1, D-026 item 4, the sign off).
    for (const id of ["elbow_extension", "elbow_flexion"] as const) {
      expect(retestBandDeg(id, "seated", ["ms"])).toBe(36);
      expect(retestBandDeg(id, "seated", ["ms"])).toBe(r.bands.elbow!.neurologicalDeg);
      expect(retestBandDeg(id, "seated", [])).toBe(10);
    }
    // «lunge 10»; «lying knee straightening 11», other positions the default.
    expect(retestBandDeg("ankle_dorsiflexion_lunge", "standing_supported", [])).toBe(10);
    expect(retestBandDeg("knee_extension", "lying_back", [])).toBe(11);
    expect(retestBandDeg("knee_extension", "seated", [])).toBe(10);
    // «The arm raise to the side keeps its v1.1 band (16, wide 20)», wide as v1.1 wideWhen.
    expect(retestBandDeg("shoulder_abduction", "seated", [])).toBe(16);
    expect(retestBandDeg("shoulder_abduction", "seated", ["parkinsons"])).toBe(20);
    for (const flag of ["inconsistent", "gravityMode", "bentElbow"] as RomFlag[])
      expect(retestBandDeg("shoulder_abduction", "seated", [], [flag])).toBe(20);
    expect(retestBandDeg("shoulder_abduction", "seated", [], ["provisional"])).toBe(16);
  });

  it("reads the neurological conditions of the v1.1 wide band", () => {
    expect([...NEUROLOGICAL_CONDITIONS]).toEqual([
      "stroke",
      "ms",
      "cerebral_palsy",
      "sci_complete",
      "sci_incomplete",
      "parkinsons",
    ]);
    const abduction = CHECK_DATA.tests.find((t) => t.id === "shoulder_abduction")!;
    const wideWhen = (abduction.noiseBandRules as unknown as { wideWhen: string[] }).wideWhen.join(" ");
    expect(wideWhen).toContain(
      "conditions include stroke, ms, cerebral_palsy, sci_complete, sci_incomplete or parkinsons",
    );
    expect(wideWhen).toContain(
      "either check has attempt spread over 15 degrees, gravity reference or bent elbow",
    );
  });

  it("compares like with like: the same position, pose model and movement version, against the earliest", () => {
    const latest = [row("knee_flexion", 125, 124)];
    expect(
      compareRom([row("knee_flexion", 100, 100, { position: "standing_supported" })], latest, []),
    ).toEqual([]);
    expect(compareRom([row("knee_flexion", 100, 100, { poseModel: "lite" })], latest, [])).toEqual([]);
    expect(compareRom([row("knee_flexion", 100, 100, { movementVersion: 99 })], latest, [])).toEqual([]);
    // The earliest stored first row is the starting point.
    const two = [
      row("knee_flexion", 120, 120, { created: 50 }),
      row("knee_flexion", 100, 100, { created: 40 }),
    ];
    expect(compareRom(two, latest, [])[0]).toMatchObject({ first: 100, direction: "better" });
    // Not measured rows and other sides are left out; the order is the body's.
    expect(
      compareRom(
        [row("knee_flexion", 100, 100), row("shoulder_flexion", 100, 100)],
        [
          notMeasured("knee_flexion", "right", "not_measured_today", "quality", "not_today"),
          row("shoulder_flexion", 140, 139),
          row("knee_flexion", 100, 100, {}, "left"),
        ],
        [],
      ),
    ).toMatchObject([{ movementId: "shoulder_flexion", direction: "better" }]);
  });
});

describe("compareGait: the gait retest rule (gait-rules retest.realChange)", () => {
  const metric = (id: GaitMetricId, value: number): GaitMetricValue => ({
    id,
    value,
    n: 12,
    unit: "",
    grade: "B",
  });
  const walk = (
    values: Partial<Record<GaitMetricId, number>>,
    over: Partial<GaitCompared> = {},
  ): GaitCompared => ({
    mode: "overground",
    setup: { aid: "none", orthosis: {}, padSpeedKmh: null },
    metrics: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, metric(k as GaitMetricId, v)])),
    ...over,
  });

  it("reads each metric's smallest real change from the data", () => {
    expect(GAIT_DATA.retest.realChange.map((r) => [r.metric, r.min])).toEqual([
      ["speed_mps", 0.1],
      ["step_length_m", 0.05],
      ["cadence", 5],
      ["symmetry_ratio", 0.06],
      ["knee_deg", 10],
      ["tla_deg", 8],
    ]);
    const first = walk({
      cadence: 100,
      speed_mps: 0.8,
      step_length_m: 0.5,
      sr_stance: 1.2,
      knee_swing_peak: 40,
      tla_peak: 10,
    });
    const latest = walk({
      cadence: 106,
      speed_mps: 0.9,
      step_length_m: 0.53,
      sr_stance: 1.1,
      knee_swing_peak: 52,
      tla_peak: 15,
    });
    expect(compareGait(first, latest)).toEqual([
      { metric: "speed_mps", first: 0.8, latest: 0.9, direction: "up" },
      { metric: "step_length_m", first: 0.5, latest: 0.53, direction: "same" },
      { metric: "cadence", first: 100, latest: 106, direction: "up" },
      { metric: "sr_stance", first: 1.2, latest: 1.1, direction: "down" },
      { metric: "knee_swing_peak", first: 40, latest: 52, direction: "up" },
      { metric: "tla_peak", first: 10, latest: 15, direction: "same" },
    ]);
  });

  it("compares like with like: the same mode, aid, orthoses and pad speed; a metric missing on either side is left out", () => {
    const first = walk({ cadence: 100 });
    expect(compareGait(first, walk({ cadence: 120 }, { mode: "walking_pad" }))).toEqual([]);
    expect(
      compareGait(first, walk({ cadence: 120 }, { setup: { aid: "cane", orthosis: {}, padSpeedKmh: null } })),
    ).toEqual([]);
    expect(
      compareGait(
        first,
        walk({ cadence: 120 }, { setup: { aid: "none", orthosis: { right: "afo" }, padSpeedKmh: null } }),
      ),
    ).toEqual([]);
    const pad = (speed: number) =>
      walk(
        { cadence: 100 },
        { mode: "walking_pad", setup: { aid: "none", orthosis: {}, padSpeedKmh: speed } },
      );
    expect(compareGait(pad(2.5), { ...pad(2.5), metrics: walk({ cadence: 108 }).metrics })).toHaveLength(1);
    expect(compareGait(pad(2.5), { ...pad(3), metrics: walk({ cadence: 108 }).metrics })).toEqual([]);
    expect(compareGait(walk({ cadence: 100, speed_mps: 1 }), walk({ cadence: 100 }))).toEqual([
      { metric: "cadence", first: 100, latest: 100, direction: "same" },
    ]);
  });
});

it("keeps every default only movement's region from the data", () => {
  for (const id of DEFAULT_ONLY_IDS) {
    const m = PROFILE_MOVEMENTS.find((x) => x.id === id)!;
    expect(m.region).toBe(defaultDef(id).region);
  }
});
