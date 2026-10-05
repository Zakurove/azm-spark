/**
 * The v7 runtime data against its types (product v7 contract 2.1, 8.1 A "runtime data parity"):
 * every literal id list of the type files equals the ids in the data, in both directions; every
 * reference inside the data resolves (norm ids, citations, landmark roles, compensation ids, region
 * ids, copy keys); the typed accessors return the data and fail on unknown ids. The compile time
 * shape check lives in each index.ts (`raw satisfies WidenV7<...>`); the unions declared twice (a
 * union in a contract type file and an id list beside the data) are checked equal at compile time
 * here.
 */
import { describe, expect, it } from "vitest";
import library from "../../src/exercises/library.json";
import { CHECK_CUE_IDS } from "../../src/movements/types";
import type { CompensationCheck, RomEvent } from "../../src/engine/rom/types";
import { conditions } from "../../src/medical/plan";
import { AXIAL_REGIONS, PROBLEM_TYPES, REGION_IDS, type RegionId } from "../../src/medical/body-map";
import type { CausePath } from "../../src/medical/rom-types";
import type {
  Confidence,
  ContributorId,
  GaitDerivedSignId,
  GaitPatternId,
  GaitPatternResult,
  GaitStatus,
  NotAssessedReason,
} from "../../src/medical/gait-types";
import type { DoseProfileId, ExercisePosition, TargetAction } from "../../src/medical/target-types";
import type { GaitMetricId, GaitView } from "../../src/engine/gait/types";
import {
  NORMS_VERSION,
  ROM_DATA,
  ROM_ENGINE_VERSION,
  ROM_RULES_VERSION,
  defaultDef,
  movementDef,
  regionRow,
  compensationDef,
  retestBand,
  romCopy,
  romCue,
  romResultLine,
} from "../../src/movements/rom";
import {
  COMPENSATION_IDS,
  DEFAULT_ONLY_IDS,
  ROM_COPY_KEYS,
  ROM_CUE_IDS,
  ROM_MOVEMENT_IDS,
  ROM_POSITION_IDS,
  ROM_REASON_IDS,
  ROM_RESULT_KEYS,
  ROM_SAFETY_IDS,
  type LandmarkRef,
  type RomCueId,
  type RomMovementId,
} from "../../src/movements/rom/types";
import {
  GAIT_DATA,
  GAIT_ENGINE_VERSION,
  GAIT_RULES_VERSION,
  gaitFinding,
  gaitPattern,
} from "../../src/movements/gait";
import {
  GAIT_CONTRIBUTOR_IDS,
  GAIT_COPY_METRIC_KEYS,
  GAIT_COPY_PATTERN_KEYS,
  GAIT_COPY_TARGET_KEYS,
  GAIT_DERIVED_SIGN_IDS,
  GAIT_METRIC_IDS,
  GAIT_PATTERN_IDS,
  GAIT_QUALITY_COPY_KEYS,
  GAIT_REFERRAL_IDS,
  GAIT_SETUP_COPY_KEYS,
  GAIT_UNUSED_METRIC_IDS,
} from "../../src/movements/gait/types";
import { TARGETS_DATA, TARGETS_VERSION, doseProfile } from "../../src/movements/targets";
import { movementDef as movementDefOf } from "../../src/movements/rom";
import { DOSE_PROFILE_IDS, HIP_END_RANGE_IDS, WHY_LINE_IDS } from "../../src/movements/targets/types";
import {
  HIP_END_RANGE_IDS as EXPORT_HIP_IDS,
  REGION_IDS as EXPORT_REGION_IDS,
} from "../../scripts/clinical/export-v7.mjs";

/* --------------------------------- the compensation cue types (D-024 item 2) */

// A compensation's cue and the runner's cue event take a v1 arm raise line (tsc checks these).
const _abdSide: CompensationCheck["cue"] = "test_abd_side";
const _abdStill: Extract<RomEvent, { kind: "cue" }> = { kind: "cue", cue: "test_abd_still", t: 0 };
void [_abdSide, _abdStill];

/* ------------------------------------------- compile time union checks */

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const unions: true[] = [
  true satisfies Equal<GaitMetricId, (typeof GAIT_METRIC_IDS)[number]>,
  true satisfies Equal<GaitPatternId, (typeof GAIT_PATTERN_IDS)[number]>,
  true satisfies Equal<ContributorId, (typeof GAIT_CONTRIBUTOR_IDS)[number]>,
  true satisfies Equal<DoseProfileId, (typeof DOSE_PROFILE_IDS)[number]>,
  true satisfies Equal<RomCueId, (typeof ROM_CUE_IDS)[number]>,
  true satisfies Equal<GaitDerivedSignId, (typeof GAIT_DERIVED_SIGN_IDS)[number]>,
];

// A pattern's evidence names a metric or a derived sign (D-024 item 3; tsc checks it).
const _derived: GaitPatternResult["evidence"][number] = {
  metric: "pillar1_hip_extension",
  value: -2,
  threshold: 0,
  share: null,
};
void _derived;

const sorted = (xs: Iterable<string>) => [...xs].sort();
const GAIT_VIEWS: readonly GaitView[] = ["front", "back", "side", "pad_side", "pad_front"];
const GAIT_STATUSES: readonly GaitStatus[] = ["possible", "likely", "not_seen", "not_assessed"];
const CONFIDENCES: readonly Confidence[] = ["low", "moderate", "high"];
const NOT_ASSESSED: readonly NotAssessedReason[] = [
  "wrong_view",
  "gate_failed",
  "aid_or_orthosis",
  "prosthetic_side",
  "no_height",
  "pad_rule_off",
  "slow_speed",
  "knee_orthosis_on_S",
  "handrail_held",
  "clearance_needed",
  "parkinsons_flat_contact",
  "crouch_or_short_steps_on_S",
];
const CAUSE_PATHS: readonly CausePath[] = [
  "post_op_early",
  "umn",
  "pd",
  "rehab",
  "tight",
  "weak",
  "pain_irritable",
  "pain_stable",
  "unknown",
];
const ACTIONS: readonly TargetAction[] = ["stretch", "strengthen", "mobility", "balance", "practice"];
const POSITIONS: readonly ExercisePosition[] = [
  "seated",
  "seated_forward",
  "standing",
  "standing_supported",
  "lying_back",
  "lying_side",
  "floor",
];
const TARGET_ID = new RegExp(`^(${ACTIONS.join("|")}):[a-z0-9_]+$`);

function isLandmarkRef(v: unknown): v is LandmarkRef {
  const idx = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 32;
  if (idx(v)) return true;
  if (Array.isArray(v)) return v.length === 2 && v.every(idx);
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if ("left" in o) return Object.keys(o).length === 2 && idx(o.left) && idx(o.right);
  if ("mid" in o)
    return (
      Array.isArray(o.mid) &&
      o.mid.length === 2 &&
      o.mid.every(idx) &&
      [undefined, true].includes(o.fixed as never)
    );
  return Object.keys(o).length === 1 && (o.other === "hip" || o.other === "knee");
}

/* ------------------------------------------------------------------ ROM */

describe("ROM runtime data (rom-v7.json)", () => {
  it("has the union checks compiled", () => expect(unions.every(Boolean)).toBe(true));

  it("lists exactly the movement, default, position, reason, safety, copy, cue and result ids", () => {
    expect(ROM_DATA.movements.map((m) => m.id)).toEqual([...ROM_MOVEMENT_IDS]);
    // The contract fixes the order of DEFAULT_ONLY_IDS (2.3); the data lists them by region.
    expect(sorted(ROM_DATA.defaultMovements.map((m) => m.id))).toEqual(sorted(DEFAULT_ONLY_IDS));
    expect(Object.keys(ROM_DATA.positions)).toEqual([...ROM_POSITION_IDS]);
    expect(Object.keys(ROM_DATA.reasonIds)).toEqual([...ROM_REASON_IDS]);
    expect(ROM_DATA.safety.map((s) => s.id)).toEqual([...ROM_SAFETY_IDS]);
    expect(Object.keys(ROM_DATA.copy)).toEqual([...ROM_COPY_KEYS]);
    expect(Object.keys(ROM_DATA.cues)).toEqual([...ROM_CUE_IDS]);
    expect(ROM_CUE_IDS).toHaveLength(24);
    expect(Object.keys(ROM_DATA.results)).toEqual([...ROM_RESULT_KEYS]);
  });

  it("uses the canonical regions and problem types of the body map", () => {
    expect(ROM_DATA.regions.map((r) => r.id)).toEqual([...REGION_IDS]);
    expect(EXPORT_REGION_IDS).toEqual([...REGION_IDS]);
    expect(ROM_DATA.regions.filter((r) => r.axial).map((r) => r.id)).toEqual([...AXIAL_REGIONS]);
    expect(ROM_DATA.regionTable.map((r) => r.region)).toEqual([...REGION_IDS]);
    expect(ROM_DATA.problemTypes.map((p) => p.id)).toEqual([...PROBLEM_TYPES]);
  });

  it("gives every reason id its text, and every copy, cue and result line Arabic and English", () => {
    for (const [id, text] of Object.entries(ROM_DATA.reasonIds)) expect(text.trim(), id).not.toBe("");
    for (const group of [ROM_DATA.copy, ROM_DATA.cues, ROM_DATA.results, ROM_DATA.positions])
      for (const [k, line] of Object.entries(group)) {
        expect(line.ar.trim(), k).not.toBe("");
        expect(line.en.trim(), k).not.toBe("");
      }
  });

  it("covers every compensation id, and only those", () => {
    const used = new Set(ROM_DATA.movements.flatMap((m) => m.compensationIds));
    expect(sorted(used)).toEqual(sorted(COMPENSATION_IDS));
    expect(COMPENSATION_IDS).toHaveLength(25);
  });

  it("gives every movement a valid shape: landmarks, gate, optional roles, positions and region", () => {
    for (const m of ROM_DATA.movements) {
      const roles = Object.keys(m.landmarks);
      for (const [role, ref] of Object.entries(m.landmarks))
        expect(isLandmarkRef(ref), `${m.id} ${role}`).toBe(true);
      for (const g of m.gate)
        for (const r of typeof g === "string" ? [g] : g.anyOf)
          expect(roles, `${m.id} gate ${r}`).toContain(r);
      for (const r of m.optional) expect(roles, `${m.id} optional ${r}`).toContain(r);
      expect(m.positions.length).toBeGreaterThan(0);
      for (const p of m.positions) expect(ROM_POSITION_IDS).toContain(p.id);
      for (const k of Object.keys(m.variantInstructions ?? {}))
        expect(
          m.positions.map((p) => p.id),
          `${m.id} variant ${k}`,
        ).toContain(k);
      expect(m.instructions.ar.length).toBe(m.instructions.en.length);
      expect(["sagittal", "frontal"]).toContain(m.plane);
      expect(["measure", "caution"]).toContain(m.verdict);
      expect(["High", "Moderate", "Low", "Very low"]).toContain(m.cameraEvidence);
      expect(["flexion", "lack", "signed"]).toContain(m.kind);
      expect(["core", "extended"]).toContain(m.priority);
      expect(["front", "side"]).toContain(m.view);
      expect(m.axial).toBe(AXIAL_REGIONS.includes(m.region));
      const row = regionRow(m.region);
      expect([...row.measure, ...row.caution], `${m.id} in ${m.region}`).toContain(m.id);
      expect(row[m.verdict], `${m.id} verdict`).toContain(m.id);
      expect(row[m.priority], `${m.id} priority`).toContain(m.id);
      if (m.absoluteFloor?.position) expect(ROM_POSITION_IDS).toContain(m.absoluteFloor.position);
    }
    expect(ROM_DATA.movements.filter((m) => m.approximateInPersonView).map((m) => m.id)).toEqual([
      "shoulder_flexion",
      "shoulder_abduction",
      "ankle_dorsiflexion_lunge",
    ]);
  });

  it("lists each movement once in the region table, and the default only movements in their region", () => {
    const listed = ROM_DATA.regionTable.flatMap((r) => [...r.measure, ...r.caution]);
    expect(sorted(listed)).toEqual(sorted(ROM_MOVEMENT_IDS));
    expect(sorted(ROM_DATA.regionTable.flatMap((r) => [...r.core, ...r.extended]))).toEqual(
      sorted(ROM_MOVEMENT_IDS),
    );
    expect(sorted(ROM_DATA.regionTable.flatMap((r) => r.default))).toEqual(sorted(DEFAULT_ONLY_IDS));
    for (const d of ROM_DATA.defaultMovements) expect(regionRow(d.region).default).toContain(d.id);
  });

  it("resolves every norm id to a norm of the same movement, and every norm source to a citation", () => {
    const norms = new Map(ROM_DATA.norms.map((n) => [n.id, n]));
    expect(norms.size).toBe(ROM_DATA.norms.length);
    for (const m of ROM_DATA.movements)
      for (const p of m.positions)
        if (p.normId !== null) {
          expect(norms.get(p.normId)?.movement, `${m.id} ${p.id}`).toBe(m.id);
        } else expect(p.graded, `${m.id} ${p.id} without a norm`).toBe(false);
    for (const d of ROM_DATA.defaultMovements) expect(norms.get(d.normId)?.movement, d.id).toBe(d.id);
    const cited = new Set(ROM_DATA.citations.map((c) => c.id));
    for (const n of ROM_DATA.norms) {
      expect(n.source.length).toBeGreaterThan(0);
      for (const s of n.source) expect(cited, `${n.id} ${s}`).toContain(s);
      expect([...ROM_MOVEMENT_IDS, ...DEFAULT_ONLY_IDS]).toContain(n.movement);
    }
    expect(norms.get("neck_lateral_flexion")?.source).toEqual(["R7", "R8"]);
  });

  it("gives graded norm rows the limits of the movement's kind", () => {
    for (const n of ROM_DATA.norms) {
      const kind = (ROM_MOVEMENT_IDS as readonly string[]).includes(n.movement)
        ? movementDef(n.movement as RomMovementId).kind
        : null;
      for (const r of n.rows) {
        expect(["male", "female", "any"]).toContain(r.sex);
        expect(r.ageMax === null || r.ageMax >= r.ageMin).toBe(true);
        if (n.graded) expect(r.limits, `${n.id} ${r.sex} ${r.ageMin}`).not.toBeNull();
        if (!r.limits) continue;
        if (kind === "lack") {
          expect(r.limits.withinUpTo, n.id).toEqual(expect.any(Number));
          expect(r.limits).not.toHaveProperty("withinFrom");
        } else {
          expect(r.limits.withinFrom, n.id).toEqual(expect.any(Number));
          expect(r.limits).not.toHaveProperty("withinUpTo");
        }
        if (r.limits.sdEff === null) expect(r.limits.flag).toBe("sdUnknown");
      }
    }
  });

  it("maps limb loss, functional floors and the condition questions to known ids", () => {
    expect(ROM_DATA.limbLoss.levels.map((l) => l.level)).toEqual([
      "below_knee",
      "above_knee",
      "below_elbow",
      "above_elbow",
    ]);
    for (const l of ROM_DATA.limbLoss.levels) {
      for (const m of [...l.measured, ...Object.keys(l.notMeasured)]) expect(ROM_MOVEMENT_IDS).toContain(m);
      for (const r of Object.values(l.notMeasured)) expect(ROM_REASON_IDS).toContain(r);
    }
    for (const [m, f] of Object.entries(ROM_DATA.thresholds.functionalFloor)) {
      expect(ROM_MOVEMENT_IDS).toContain(m);
      if (f.position) expect(ROM_POSITION_IDS).toContain(f.position);
    }
    const asked = ROM_DATA.conditionAutoMap.filter((c) => c.ask.en !== "");
    for (const c of asked) expect(conditions as readonly string[], c.condition).toContain(c.condition);
  });

  it("resolves every compensation cue to a known line, v7 or v1 (D-024 item 2)", () => {
    const known = new Set<string>([...ROM_CUE_IDS, ...CHECK_CUE_IDS]);
    let cues = 0;
    for (const m of ROM_DATA.movements) {
      expect(
        m.compensations.map((c) => c.id),
        m.id,
      ).toEqual(m.compensationIds);
      for (const c of m.compensations) {
        if (c.cue === null) continue;
        cues++;
        expect(known.has(c.cue), `${m.id} ${c.id} ${c.cue}`).toBe(true);
      }
    }
    expect(cues).toBeGreaterThan(30);
    // The side arm raise keeps the v1 lines (no v7 cue says keep the arm out to the side).
    const abd = movementDef("shoulder_abduction").compensations;
    expect(abd.find((c) => c.id === "trunk_lean")?.cue).toBe("test_abd_still");
    expect(abd.find((c) => c.id === "plane")?.cue).toBe("test_abd_side");
  });

  it("gives every compensation its effect, unit and numbers, and every movement its camera distance", () => {
    const UNITS = [
      "deg",
      "ratio",
      "percent",
      "shank_lengths",
      "thigh_lengths",
      "shoulder_widths",
      "ear_distance_share",
    ];
    for (const m of ROM_DATA.movements) {
      const d = m.distanceM;
      expect(typeof d === "number" ? d > 0 : d.length === 2 && d[0] < d[1], m.id).toBe(true);
      for (const c of m.compensations) {
        const where = `${m.id} ${c.id}`;
        expect(["invalid", "flag", "log"], where).toContain(c.effect);
        if (c.unit !== null) expect(UNITS, where).toContain(c.unit);
        const numbers = [c.cueAt, c.invalidAt, c.flagAt].filter((v) => v !== null && v !== undefined);
        if (numbers.length) {
          expect(c.unit, where).not.toBeNull();
          expect(["above", "below"], where).toContain(c.when);
        }
        if (c.effect === "flag") expect(c.invalidAt, where).toBeNull();
        if (c.windowDeg) expect(c.windowDeg[0]).toBeLessThan(c.windowDeg[1]);
      }
    }
  });

  it("keeps the retest bands and the session cap as numbers (freeze step, D-024 item 4)", () => {
    const { retest, sessionOrder } = ROM_DATA;
    expect(retest.floorDeg).toBeGreaterThan(0);
    expect(retest.defaultDeg).toBeGreaterThanOrEqual(retest.floorDeg);
    for (const [key, band] of Object.entries(retest.bands)) {
      expect([...ROM_MOVEMENT_IDS, ...REGION_IDS] as string[], key).toContain(key);
      for (const v of [band.deg, band.neurologicalDeg, band.wideDeg])
        if (v !== undefined) expect(v, key).toBeGreaterThanOrEqual(retest.floorDeg);
      if (band.position)
        expect(
          movementDef(key as RomMovementId).positions.map((p) => p.id),
          key,
        ).toContain(band.position);
    }
    expect(Number.isInteger(sessionOrder.maxMeasured)).toBe(true);
    expect(sessionOrder.minutesPerMovement).toBeGreaterThan(0);
  });

  it("serves the freeze step's structures through typed accessors", () => {
    expect(compensationDef("shoulder_abduction", "plane")).toMatchObject({
      cue: "test_abd_side",
      invalidAt: 0.85,
    });
    expect(() => compensationDef("shoulder_flexion", "heel_lift")).toThrow(
      "Unknown range of motion compensation: shoulder_flexion heel_lift",
    );
    expect(retestBand("knee_extension")).toEqual({ deg: 11, position: "lying_back" });
    // FZ-1 (D-026 item 4): the home band 36 for both elbow movements, one band (the lab 33 is evidence).
    expect(retestBand("elbow")).toEqual({ neurologicalDeg: 36 });
    expect(retestBand("neck_flexion")).toBeNull();
  });

  it("serves the typed accessors and versions", () => {
    expect(movementDef("knee_extension").kind).toBe("lack");
    expect(defaultDef("neck_rotation").region).toBe("neck");
    expect(regionRow("knee").measure).toEqual(["knee_flexion", "knee_extension"]);
    expect(romCopy("ask_max").ar).not.toBe("");
    expect(romCue("keep_back").en).toBe("Keep your back against the chair.");
    expect(romResultLine("label_within").en).not.toBe("");
    expect(() => movementDef("wrist_flexion" as RomMovementId)).toThrow("Unknown range of motion movement");
    expect(() => regionRow("head" as RegionId)).toThrow("Unknown range of motion region");
    expect(ROM_RULES_VERSION).toBe(`rom_protocol_${ROM_DATA.specVersion}`);
    expect(NORMS_VERSION).toBe(`rom_norms_${ROM_DATA.specVersion}`);
    expect(ROM_ENGINE_VERSION).toBe("rom_engine_1");
  });

  it("is signed off (D-025): Nasser approved every recommendation on 2026-10-04, version 1.0.0", () => {
    expect(ROM_DATA.status).toBe("signed_off");
    expect(ROM_DATA.signoff).toMatchObject({ status: "signed_off", approved: true });
    expect(ROM_DATA.specVersion).toBe("1.0.0");
    expect(ROM_RULES_VERSION).toBe("rom_protocol_1.0.0");
  });
});

/* ----------------------------------------------------------------- gait */

describe("gait runtime data (gait-v7.json)", () => {
  it("lists exactly the metric, pattern, contributor and copy ids", () => {
    expect(GAIT_DATA.metrics.map((m) => m.id)).toEqual([...GAIT_METRIC_IDS, ...GAIT_UNUSED_METRIC_IDS]);
    expect(GAIT_DATA.patterns.map((p) => p.id)).toEqual([...GAIT_PATTERN_IDS]);
    expect(Object.keys(GAIT_DATA.copy.contributors)).toEqual([...GAIT_CONTRIBUTOR_IDS]);
    expect(Object.keys(GAIT_DATA.copy.metrics)).toEqual([...GAIT_COPY_METRIC_KEYS]);
    expect(Object.keys(GAIT_DATA.copy.patterns)).toEqual([...GAIT_COPY_PATTERN_KEYS]);
    expect(Object.keys(GAIT_DATA.copy.targets)).toEqual([...GAIT_COPY_TARGET_KEYS]);
    expect(Object.keys(GAIT_DATA.copy.referrals)).toEqual([...GAIT_REFERRAL_IDS]);
    expect(Object.keys(GAIT_DATA.copy.quality)).toEqual([...GAIT_QUALITY_COPY_KEYS]);
    expect(Object.keys(GAIT_DATA.copy.setup)).toEqual([...GAIT_SETUP_COPY_KEYS]);
    expect(GAIT_DATA.findings.map((f) => f.id)).toEqual([
      "flat_or_forefoot_contact",
      "slow_speed",
      "uneven_step_length",
    ]);
  });

  it("names every view as a gait view and every sign metric as a metric or a derived sign (D-024 item 3)", () => {
    const metrics = new Set<string>([...GAIT_METRIC_IDS, ...GAIT_UNUSED_METRIC_IDS]);
    for (const p of GAIT_DATA.patterns) {
      for (const v of p.views) expect(GAIT_VIEWS, `${p.id} ${v}`).toContain(v);
      for (const sign of p.signs)
        expect(
          metrics.has(sign.metric) || (GAIT_DERIVED_SIGN_IDS as readonly string[]).includes(sign.metric),
          `${p.id} ${sign.metric}`,
        ).toBe(true);
    }
    for (const f of GAIT_DATA.findings) for (const v of f.views) expect(GAIT_VIEWS).toContain(v);
    // The back view (away passes) gives the pelvic drop and the trunk lean (capture.overground.front).
    for (const id of ["pelvic_drop", "trunk_sway_range", "trunk_lean_peak"])
      expect(GAIT_DATA.metrics.find((m) => m.id === id)?.views, id).toContain("back");
    for (const id of ["trendelenburg", "duchenne_lean", "waddling"])
      expect(GAIT_DATA.patterns.find((p) => p.id === id)?.views, id).toEqual(["front", "back", "pad_front"]);
    const used = new Set(GAIT_DATA.patterns.flatMap((p) => p.signs.map((s) => s.metric)));
    for (const d of GAIT_DERIVED_SIGN_IDS) expect(used.has(d), d).toBe(true);
  });

  it("keeps the numbers of the gait rules (freeze step: preprocessing, events, capture, findings, speed rules)", () => {
    const step = (id: string) => GAIT_DATA.preprocessing.find((p) => p.step === id);
    expect(step("timestamps")?.hz).toBe(30);
    expect(step("outliers")?.hampel).toEqual({ window: 7, nSigma: 2 });
    expect(step("smoothing")?.butterworth).toEqual({ order: 4, cutoffHz: 5, filtfiltOrder: 2 });
    expect(GAIT_DATA.events.front.singleStanceWindowPct).toEqual([35, 90]);
    expect(GAIT_DATA.confidenceModel.firingSharePct).toBe(60);
    expect(GAIT_DATA.capture.staticSingleLegStance.measureLast_s).toBe(3);
    expect(GAIT_DATA.findings.find((f) => f.id === "uneven_step_length")?.thresholds).toEqual({
      possible: { sr_step_length_gte: 1.13 },
      likely: { sr_step_length_gte: 1.18 },
    });
    expect(
      GAIT_DATA.patterns.find((p) => p.id === "stiff_knee")?.thresholds.speed?.absoluteAloneFrom_mps,
    ).toBe(0.8);
  });

  it("matches the confidence model to the gait finding types", () => {
    expect(GAIT_DATA.confidenceModel.statuses).toEqual([...GAIT_STATUSES]);
    expect(GAIT_DATA.confidenceModel.levels).toEqual([...CONFIDENCES]);
    expect(GAIT_DATA.confidenceModel.notAssessedReasons).toEqual([...NOT_ASSESSED]);
    expect(Object.keys(GAIT_DATA.confidenceModel.capFromGrade)).toEqual(["A", "B", "B-", "C+", "C", "D"]);
  });

  it("resolves every metric view, pattern contributor, copy target and referral", () => {
    for (const m of GAIT_DATA.metrics) for (const v of m.views) expect(GAIT_VIEWS).toContain(v);
    const all = <T>(x: T[] | Record<string, T[]>) => (Array.isArray(x) ? x : Object.values(x).flat());
    for (const p of GAIT_DATA.patterns) {
      for (const c of all(p.contributors)) expect(GAIT_CONTRIBUTOR_IDS, `${p.id} ${c}`).toContain(c);
      for (const c of Object.keys(p.contributorRules ?? {}))
        expect(GAIT_CONTRIBUTOR_IDS, `${p.id} rule ${c}`).toContain(c);
      for (const t of all(p.copyTargets)) expect(GAIT_COPY_TARGET_KEYS, `${p.id} ${t}`).toContain(t);
      for (const r of p.referrals ?? []) expect(GAIT_REFERRAL_IDS).toContain(r);
      expect(CONFIDENCES).toContain(p.confidenceCap);
      for (const id of [p.bilateralId, p.unilateralId, ...Object.values(p.copyIds ?? {})].filter(Boolean))
        expect(GAIT_COPY_PATTERN_KEYS, `${p.id} ${id}`).toContain(id);
    }
    for (const f of GAIT_DATA.findings)
      for (const t of f.copyTargets) expect(GAIT_COPY_TARGET_KEYS).toContain(t);
    expect(GAIT_DATA.citations.map((c) => c.id)).toEqual(expect.arrayContaining(["Fang18", "Hollman11"]));
  });

  it("keeps the capture and error numbers the engine reads", () => {
    expect(GAIT_DATA.capture.common.processedFps).toEqual({ full: 25, timingOnly: 20 });
    expect(GAIT_DATA.capture.minimumCycles.perSidePerViewGroup).toBe(6);
    expect(GAIT_DATA.events.side.peaks.distance_s).toBe(0.4);
    expect(GAIT_DATA.errorMargins.knee_deg.value).toEqual(expect.any(Number));
    expect(GAIT_DATA.norms.fang18.bands.length).toBeGreaterThan(0);
    expect(GAIT_DATA.norms.hollman11.bands.length).toBeGreaterThan(0);
  });

  it("serves the patterns and support findings through typed accessors", () => {
    expect(gaitPattern("stiff_knee").thresholds.speed?.cappedNeedsDiffGte).toBe(15);
    expect(gaitFinding("uneven_step_length").thresholds).toMatchObject({
      likely: { sr_step_length_gte: 1.18 },
    });
    expect(() => gaitPattern("limp" as GaitPatternId)).toThrow("Unknown gait pattern: limp");
  });

  it("serves its versions", () => {
    expect(GAIT_RULES_VERSION).toBe(`gait_rules_${GAIT_DATA.version}`);
    expect(GAIT_ENGINE_VERSION).toBe("gait_engine_1");
  });

  it("is signed off (D-025), version 1.0.0", () => {
    expect(GAIT_DATA.status).toBe("signed_off");
    expect(GAIT_DATA.signoff.approved).toBe(true);
    expect(GAIT_DATA.version).toBe("1.0.0");
    expect(GAIT_RULES_VERSION).toBe("gait_rules_1.0.0");
  });
});

/* -------------------------------------------------------------- targets */

describe("exercise targets runtime data (targets-v7.json)", () => {
  // The approved entries: E1 enters the new exercises into library.json as drafts (contract 2.10).
  const LIBRARY_IDS = new Set(
    (library as { id: string; status?: string }[]).filter((e) => e.status !== "draft").map((e) => e.id),
  );

  it("lists exactly the dose profiles and why lines", () => {
    expect(TARGETS_DATA.dose.profiles.map((p) => p.id)).toEqual([...DOSE_PROFILE_IDS]);
    expect(TARGETS_DATA.whyLines.map((w) => w.id)).toEqual([...WHY_LINE_IDS]);
    expect(TARGETS_DATA.taxonomy.actions.map((a) => a.id)).toEqual([...ACTIONS]);
    expect(TARGETS_DATA.mapping.paths.map((p) => p.path)).toEqual([...CAUSE_PATHS]);
    // One cause path id per row, and structured alternatives (D-023 item 6).
    for (const c of TARGETS_DATA.mapping.causeResolution) {
      expect(CAUSE_PATHS, c.path).toContain(c.path);
      for (const a of c.alternatives ?? []) {
        expect(CAUSE_PATHS, a.path).toContain(a.path);
        expect(a.when.trim(), `${c.order}`).not.toBe("");
      }
    }
    expect(TARGETS_DATA.mapping.causeResolution.filter((c) => c.alternatives).map((c) => c.order)).toEqual([
      4, 6, 11,
    ]);
    expect(TARGETS_DATA.mapping.causeResolution.map((c) => c.order)).toEqual(
      TARGETS_DATA.mapping.causeResolution.map((_, i) => i + 1),
    );
    expect(TARGETS_DATA.mapping.romMovements.map((r) => r.movement)).toEqual([...ROM_MOVEMENT_IDS]);
    // The numbers the mapping notes write (review material scanned by hand at the freeze step).
    const row = (m: string) => TARGETS_DATA.mapping.romMovements.find((r) => r.movement === m);
    expect(row("hip_extension")?.targetsWhenBelow).toBe(0);
    expect(row("knee_extension")).toMatchObject({ seatedLackAbove: 52, seatedLackPriority: 1 });
    // The same knee number in the range data and the grade rule.
    const seated = movementDefOf("knee_extension").positions.find((p) => p.id === "seated");
    expect(seated?.referMeasureLackAbove).toBe(row("knee_extension")?.seatedLackAbove);
    expect(TARGETS_DATA.mapping.gradeRules.find((g) => g.seatedLackAbove)?.seatedLackAbove).toBe(52);
  });

  it("writes every target id as <action>:<target>", () => {
    const ids = [
      ...TARGETS_DATA.libraryTags.flatMap((t) => t.targets.map((x) => x.id)),
      ...TARGETS_DATA.newExercises.flatMap((e) => e.targets.map((x) => x.id)),
      ...TARGETS_DATA.mapping.romMovements.flatMap((r) => [...r.mobility, ...r.stretch, ...r.strengthen]),
      ...TARGETS_DATA.mapping.mobilityDefaultRule.rows.flatMap((r) => r.targets),
      ...TARGETS_DATA.taxonomy.standingOnlyTargets,
      ...TARGETS_DATA.taxonomy.standingRelevantTargets,
    ];
    expect(ids.length).toBeGreaterThan(100);
    for (const id of ids) expect(id).toMatch(TARGET_ID);
  });

  it("tags existing library exercises and adds new ones as drafts with known positions, doses and hip ids", () => {
    for (const t of TARGETS_DATA.libraryTags) {
      expect(LIBRARY_IDS, t.id).toContain(t.id);
      for (const p of t.positions) expect(POSITIONS).toContain(p);
    }
    const newIds = TARGETS_DATA.newExercises.map((e) => e.id);
    expect(new Set(newIds).size).toBe(newIds.length);
    for (const e of TARGETS_DATA.newExercises) {
      expect(LIBRARY_IDS, `${e.id} is new`).not.toContain(e.id);
      expect(e.status).toBe("draft");
      for (const p of e.positions) expect(POSITIONS).toContain(p);
      for (const d of [e.dose.profile, e.dose.painProfile, e.dose.stretchProfile].filter(Boolean))
        expect(DOSE_PROFILE_IDS).toContain(d);
      for (const h of e.hipEndRange ?? []) expect(HIP_END_RANGE_IDS).toContain(h);
      // dose.text (renamed from note, D-023 item 7) keeps the numbers it writes beside it.
      expect(e.dose).not.toHaveProperty("note");
      for (const k of ["holdSeconds", "repetitions", "rounds"] as const)
        if (e.dose[k] !== undefined) expect(e.dose.text, `${e.id} ${k}`).toEqual(expect.any(String));
      expect(e.steps.ar.length).toBe(e.steps.en.length);
    }
    expect(EXPORT_HIP_IDS).toEqual([...HIP_END_RANGE_IDS]);
  });

  it("names each contraindication once, with the regions of the body map", () => {
    const ids = TARGETS_DATA.contraindicationVocabulary.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of TARGETS_DATA.mapping.regionDefaultRule.rows) expect(REGION_IDS).toContain(r.region);
    for (const g of [...TARGETS_DATA.taxonomy.muscleGroups, ...TARGETS_DATA.taxonomy.jointMovements])
      expect(REGION_IDS).toContain(g.region);
  });

  it("serves the dose profiles through a typed accessor", () => {
    expect(doseProfile("mobility_pain").numbers.painStop).toEqual({ atOrAbove: 6, riseAtOrAbove: 2 });
    expect(() => doseProfile("rest" as DoseProfileId)).toThrow("Unknown dose profile: rest");
  });

  it("serves its version", () => {
    expect(TARGETS_VERSION).toBe(`targets_${TARGETS_DATA.version}`);
  });

  it("is signed off (D-025), version 1.0.0; the new exercises stay drafts until the Arabic review (EX-Q15)", () => {
    expect(TARGETS_DATA.status).toBe("signed_off");
    expect(TARGETS_DATA.signoff.approved).toBe(true);
    expect(TARGETS_DATA.version).toBe("1.0.0");
    expect(TARGETS_VERSION).toBe("targets_1.0.0");
    expect(TARGETS_DATA.newExercises.every((e) => e.status === "draft")).toBe(true);
  });

  it("holds the D-025 grade rules: the residual knee or hip targets and the shoulder table slides, with no condition left", () => {
    const rule = (finding: string) => TARGETS_DATA.mapping.gradeRules.find((r) => r.finding === finding)!;
    // ROM-Q7 and review A13: active (the condition lived in the basis, which local-docs keeps).
    expect(rule("not_measured_camera (residual joint after limb loss)")).toMatchObject({
      targets:
        "mobility:hip_extension above an above knee loss; mobility:knee_extension above a below knee loss; refer_measure",
      perAction: 1,
      priority: 1,
    });
    // EX-Q5: self assisted shoulder table slides with the care team line; no item for other joints.
    const none = rule("no_active_movement").targets;
    expect(none).toContain("for the shoulder only, table_slides with the other hand helping");
    expect(none).toContain("show refer_care_team");
    expect(none).not.toMatch(/if the clinicians allow|open question/);
    expect(TARGETS_DATA.newExercises.find((e) => e.id === "table_slides")!.contraindications).toEqual([]);
  });
});
