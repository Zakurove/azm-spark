/**
 * Range of motion profile and findings types (product v7 contract 2.7). The functions live in
 * src/medical/rom-profile.ts (stream B): buildRomProfile, romFindings, bodyMapSummary, compareRom.
 * Pure types, no DOM.
 */
import type { Sex } from "./plan";
import type { RegionId } from "./body-map";
import type { RomGrade } from "./rom-norms";
import type { RomReasonId } from "./rom-protocol";
import type { LimitCause, RomFlag } from "../engine/rom/types";
import type {
  DefaultOnlyId,
  JointMovementId,
  RomKind,
  RomMovementId,
  RomPositionId,
  RomSide,
} from "../movements/rom/types";
import type { Text } from "../movements/types";

export type RomSource =
  "measured" | "default" | "not_measured_camera" | "not_measured_today" | "not_applicable";
export type RomFindingId =
  | "within"
  | "mild"
  | "marked"
  | "pain_limited"
  | "no_grade"
  | "default"
  | "unknown"
  | "not_today"
  | "not_applicable";
export type CausePath =
  "post_op_early" | "umn" | "pd" | "rehab" | "tight" | "weak" | "pain_irritable" | "pain_stable" | "unknown";

/** A row of rom_measurements as the store returns it (section 3). */
export interface StoredRomRow {
  id: string;
  checkId: string;
  movementId: RomMovementId | DefaultOnlyId;
  side: RomSide;
  position: RomPositionId | null;
  value: number | null;
  source: Exclude<RomSource, "default">;
  reason: RomReasonId | null;
  pain: boolean;
  painLevel: number | null;
  painBefore: number | null;
  cause: LimitCause | null;
  percentNormal: number | null;
  finding: RomFindingId;
  gradeIgnoringPain: RomGrade | null;
  /** ageMax and sdEff are null as in the norm rows (NormRow, NormLimits; change log, A1). */
  norm: {
    normId: string;
    row: { sex: Sex | "any"; ageMin: number; ageMax: number | null; side?: "left" | "right" };
    z: number;
    mean: number;
    sdEff: number | null;
    sigmaM: number;
    bias: number;
  } | null;
  median: number | null;
  nValid: number;
  flags: RomFlag[];
  /**
   * A not measured row has no pose model and no engine version, and a default only movement no
   * movement version: the section 3 columns are NULL (D-024, A5-5).
   */
  poseModel: "lite" | "full" | null;
  movementVersion: number | null;
  normsVersion: string;
  engineVersion: string | null;
  created: number;
}

export interface RomProfileEntry {
  movementId: JointMovementId;
  side: RomSide;
  region: RegionId;
  source: RomSource;
  kind: RomKind;
  value: number | null;
  typical: number | null;
  percentOfNormal: number | null;
  z: number | null;
  finding: RomFindingId;
  gradeIgnoringPain: RomGrade | null;
  painLimited: boolean;
  painLevel: number | null;
  /**
   * The region's pain score before the movement (today's pain or the same joint re-ask), as the stored
   * row keeps it; absent or null when unknown (a default or a row without one). causeResolution orders
   * 6 and 11 read «today's pain is 4 or 5» from it (contract gap B4-G1, accepted in the wave 2 fixes).
   */
  painBefore?: number | null;
  cause: LimitCause | null;
  /** 1 valid attempt */
  provisional: boolean;
  approximate: boolean;
  noActiveMovement: boolean;
  flags: RomFlag[];
  reason: RomReasonId | null;
  measuredAt: number | null;
  checkId: string | null;
}
export interface RomProfile {
  sex: Sex;
  age: number;
  normsVersion: string;
  created: number;
  entries: RomProfileEntry[];
}

export interface RomFinding {
  movementId: RomMovementId;
  side: RomSide;
  region: RegionId;
  finding: "mild" | "marked" | "pain_limited" | "no_grade" | "unknown";
  /** exercise-targets mapping.causeResolution */
  path: CausePath;
  cause: LimitCause | null;
  priority: 1 | 2 | 3;
  provisional: boolean;
  approximate: boolean;
  noActiveMovement: boolean;
  value: number | null;
  typical: number | null;
  percentOfNormal: number | null;
  /** results.finding_tight / finding_weak / finding_pain ... */
  line: Text;
}

export type BodyMapColour = "within" | "mild" | "marked" | "pain" | "grey" | "none";

export interface RomChange {
  movementId: RomMovementId;
  side: RomSide;
  first: number;
  latest: number;
  bandDeg: number;
  direction: "better" | "worse" | "same";
}
