/**
 * Gait findings types (product v7 contract 2.9). evaluateGait lives in src/medical/gait-rules.ts
 * (stream C). Pure types, no DOM. Pattern lines say "your walk may suggest" and contributors are
 * "possible reasons", never facts (section 11).
 */
import type { Intake } from "./plan";
import type { RegionId } from "./body-map";
import type { GaitPlan, GaitMode } from "./gait-eligibility";
import type { RomProfile } from "./rom-types";
import type { TargetId } from "./target-types";
import type { GaitAnalysis, GaitMetricId, GaitView, GaitViewResult, ReplayCycle } from "../engine/gait/types";
import type { GaitData } from "../movements/gait/types";
import type { Text } from "../movements/types";

export type GaitPatternId =
  | "shorter_stance"
  | "trendelenburg"
  | "duchenne_lean"
  | "waddling"
  | "stiff_knee"
  | "steppage"
  | "crouch"
  | "recurvatum"
  | "quad_avoidance"
  | "reduced_extension"
  | "short_steps";
/**
 * Signs a pattern reads that are not metrics of one view (D-024 item 3): the between limb differences of
 * the knee and thigh swing peaks (stiff knee, steppage), and the Pillar 1 hip extension of the range
 * profile (reduced extension corroboration).
 */
export type GaitDerivedSignId =
  "knee_swing_peak_between_limb_diff" | "thigh_swing_peak_between_limb_diff" | "pillar1_hip_extension";
export type GaitStatus = "possible" | "likely" | "not_seen" | "not_assessed";
export type Confidence = "low" | "moderate" | "high";
export type NotAssessedReason =
  | "wrong_view"
  | "gate_failed"
  | "aid_or_orthosis"
  | "prosthetic_side"
  | "no_height"
  | "pad_rule_off"
  | "slow_speed"
  | "knee_orthosis_on_S"
  | "handrail_held"
  | "clearance_needed"
  | "parkinsons_flat_contact"
  | "crouch_or_short_steps_on_S";
/** weak_hip_abductors, tight_hip_flexors, ... */
export type ContributorId = keyof GaitData["copy"]["contributors"];

export interface GaitPatternResult {
  pattern: GaitPatternId;
  /** antalgic | short_stance | prosthetic_side | the pattern id */
  label: string;
  side: "left" | "right" | "both" | "none";
  status: GaitStatus;
  /** null below low (not shown) or when not assessed */
  confidence: Confidence | null;
  notAssessed?: NotAssessedReason;
  evidence: {
    /** A metric, or a derived sign (D-024 item 3). */
    metric: GaitMetricId | GaitDerivedSignId;
    side?: "left" | "right";
    value: number;
    threshold: number;
    share: number | null;
  }[];
  /** ordered by history and the ROM profile; "possible reasons", never facts */
  contributors: ContributorId[];
  targets: { id: TargetId; side: "left" | "right" | "both" | "none" }[];
  /** refer_prosthetist, refer_afo, refer_new_or_worse ... */
  referrals: string[];
  lines: { pattern: Text; reasons: Text | null; targets: Text[]; confidence: Text | null };
}
export interface GaitSupportFinding {
  id: "flat_or_forefoot_contact" | "slow_speed" | "uneven_step_length";
  side: "left" | "right" | "both" | "none";
  value: number;
}
export interface GaitFindingsInput {
  analysis: GaitAnalysis;
  intake: Intake;
  romProfile: RomProfile | null;
  today: { painByRegion: Partial<Record<RegionId, number>>; pdState?: "on" | "unsure" };
  plan: GaitPlan;
}

/** The response of POST /api/focus/:id/gait and the gait part of POST /api/focus/:id/complete and GET /api/focus/profile. */
export interface GaitStoredView {
  id: string;
  mode: GaitMode;
  views: {
    view: GaitView;
    nearSide?: "left" | "right";
    metrics: GaitViewResult["metrics"];
    cleanCycles: { left: number; right: number };
  }[];
  metrics: GaitAnalysis["combined"];
  /** lines recomputed on read in the person's language */
  patterns: GaitPatternResult[];
  findings: GaitSupportFinding[];
  quality: { gatePassed: boolean; timingOnly: boolean; flags: GaitAnalysis["flags"] };
  /** one cycle per analysis */
  replay: ReplayCycle | null;
  /** True from the gait POST until complete recomputes the patterns with the lying block's range rows (C-13). */
  provisional: boolean;
  rulesVersion: string;
  created: number;
}
