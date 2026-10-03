/**
 * Normal values for range of motion by sex and age, and the grade of a measured value (product v7
 * contract 2.4; rom-protocol sections 4 and 5). Pure, no DOM: the client shows the grade and the
 * server recomputes and stores it (C-3).
 *
 * Step A1 commits the types; normFor, typicalValue, PHONE_BIAS, gradeValue and gradeMeasurement land
 * with step A4. The norm rows ship inside the ROM data (ROM_DATA.norms, NORMS_VERSION).
 */
import type { Sex } from "./plan";
import type { RomFindingId, StoredRomRow } from "./rom-types";
import type { RomFlag } from "../engine/rom/types";
import type { Evidence, JointMovementId } from "../movements/rom/types";

/**
 * The precomputed limits of a norm row (rom-protocol thresholds). Flexion and signed movements have
 * withinFrom and markedBelow; lack movements have withinUpTo and markedAbove (the exporter keeps what
 * the data has). sdUsed and sdEff are null when the source gives no SD (flag sdUnknown: only σm is
 * used). Contract gap (change log, A1): the contract named withinTo and typed sdEff, withinFrom and
 * markedBelow as always present.
 */
export interface NormLimits {
  sigmaM: number;
  sdUsed: number | null;
  sdEff: number | null;
  capApplied: boolean;
  floorApplied: boolean;
  sdObserved: number | null;
  zWithin: number;
  zMarked: number;
  /** flexion and signed movements */
  withinFrom?: number;
  markedBelow?: number | null;
  /** lack movements */
  withinUpTo?: number;
  markedAbove?: number | null;
  /** The source gives no SD: only σm is used, so a mild limitation may be over called. */
  flag?: "sdUnknown";
}
export interface NormRow {
  sex: Sex | "any";
  ageMin: number;
  /** null: no upper age (for example 60 and over). Contract gap (change log, A1): typed number. */
  ageMax: number | null;
  side?: "left" | "right";
  mean: number;
  sd: number | null;
  sdUsed: number | null;
  n: number | null;
  limits: NormLimits | null;
}
export interface NormDef {
  id: string;
  movement: JointMovementId;
  source: string[];
  /** Prose: the measuring position of the source ("standing", "not retrieved", ...). */
  position: string;
  strength: Evidence;
  graded: boolean;
  rows: NormRow[];
}
export interface NormPick {
  norm: NormDef;
  row: NormRow;
  flags: ("ageOutsideBand" | "sexAny")[];
}

export type RomGrade = "within" | "mild" | "marked";
export interface GradeResult {
  grade: RomGrade;
  z: number;
  /** round(100 x value / N) for flexion and signed movements with N of 20 degrees or more; null for lack movements. */
  percentOfNormal: number | null;
  floorBroken: "mild" | "marked" | null;
  approximate: boolean;
}

/**
 * What the server stores with each measurement (C-3), from the result and the intake: the norm pick, z, grade,
 * percent, finding with painPrecedence (pain_limited wins, the degree grade kept as gradeIgnoringPain),
 * provisional with 1 valid attempt, approximate per thresholds.approximate, no_grade without a norm.
 */
export interface MeasurementGrade {
  percentNormal: number | null;
  finding: RomFindingId;
  gradeIgnoringPain: RomGrade | null;
  norm: StoredRomRow["norm"];
  /** the result's flags plus provisional, approximate, ageOutsideBand */
  flags: RomFlag[];
}
