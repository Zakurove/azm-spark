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
import { conditions } from "../../src/medical/plan";
import { AXIAL_REGIONS, PROBLEM_TYPES, REGION_IDS, type RegionId } from "../../src/medical/body-map";
import type { CausePath } from "../../src/medical/rom-types";
import type {
  Confidence,
  ContributorId,
  GaitPatternId,
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
import { GAIT_DATA, GAIT_ENGINE_VERSION, GAIT_RULES_VERSION } from "../../src/movements/gait";
import {
  GAIT_CONTRIBUTOR_IDS,
  GAIT_COPY_METRIC_KEYS,
  GAIT_COPY_PATTERN_KEYS,
  GAIT_COPY_TARGET_KEYS,
  GAIT_METRIC_IDS,
  GAIT_PATTERN_IDS,
  GAIT_QUALITY_COPY_KEYS,
  GAIT_REFERRAL_IDS,
  GAIT_SETUP_COPY_KEYS,
  GAIT_UNUSED_METRIC_IDS,
} from "../../src/movements/gait/types";
import { TARGETS_DATA, TARGETS_VERSION } from "../../src/movements/targets";
import { DOSE_PROFILE_IDS, HIP_END_RANGE_IDS, WHY_LINE_IDS } from "../../src/movements/targets/types";
import {
  HIP_END_RANGE_IDS as EXPORT_HIP_IDS,
  REGION_IDS as EXPORT_REGION_IDS,
} from "../../scripts/clinical/export-v7.mjs";

/* ------------------------------------------- compile time union checks */

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const unions: true[] = [
  true satisfies Equal<GaitMetricId, (typeof GAIT_METRIC_IDS)[number]>,
  true satisfies Equal<GaitPatternId, (typeof GAIT_PATTERN_IDS)[number]>,
  true satisfies Equal<ContributorId, (typeof GAIT_CONTRIBUTOR_IDS)[number]>,
  true satisfies Equal<DoseProfileId, (typeof DOSE_PROFILE_IDS)[number]>,
  true satisfies Equal<RomCueId, (typeof ROM_CUE_IDS)[number]>,
];

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
    expect(ROM_DATA.signoff.approved).toBe(false);
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

  it("serves its versions", () => {
    expect(GAIT_RULES_VERSION).toBe(`gait_rules_${GAIT_DATA.version}`);
    expect(GAIT_ENGINE_VERSION).toBe("gait_engine_1");
    expect(GAIT_DATA.signoff.approved).toBe(false);
  });
});

/* -------------------------------------------------------------- targets */

describe("exercise targets runtime data (targets-v7.json)", () => {
  const LIBRARY_IDS = new Set((library as { id: string }[]).map((e) => e.id));

  it("lists exactly the dose profiles and why lines", () => {
    expect(TARGETS_DATA.dose.profiles.map((p) => p.id)).toEqual([...DOSE_PROFILE_IDS]);
    expect(TARGETS_DATA.whyLines.map((w) => w.id)).toEqual([...WHY_LINE_IDS]);
    expect(TARGETS_DATA.taxonomy.actions.map((a) => a.id)).toEqual([...ACTIONS]);
    expect(TARGETS_DATA.mapping.paths.map((p) => p.path)).toEqual([...CAUSE_PATHS]);
    for (const c of TARGETS_DATA.mapping.causeResolution)
      expect(CAUSE_PATHS, c.path).toContain(/^[a-z_]+/.exec(c.path)?.[0]);
    expect(TARGETS_DATA.mapping.causeResolution.map((c) => c.order)).toEqual(
      TARGETS_DATA.mapping.causeResolution.map((_, i) => i + 1),
    );
    expect(TARGETS_DATA.mapping.romMovements.map((r) => r.movement)).toEqual([...ROM_MOVEMENT_IDS]);
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

  it("serves its version", () => {
    expect(TARGETS_VERSION).toBe(`targets_${TARGETS_DATA.version}`);
    expect(TARGETS_DATA.signoff.approved).toBe(false);
  });
});
