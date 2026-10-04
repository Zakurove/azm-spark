/**
 * Normal values for range of motion by sex and age, and the grade of a measured value (product v7
 * contract 2.4; rom-protocol sections 4 and 5). Pure, no DOM: the client shows the grade and the
 * server recomputes and stores it (C-3).
 *
 *   normFor           rom-protocol 4.3 normSelection: the position's norm, the side row, the sex row
 *                     (any for both), the age band or the nearest band (tie: the older)
 *   typicalValue      the typical default: the row mean rounded to whole degrees (4.3 rule 5)
 *   gradeValue        thresholds: z on the spread of camera readings in healthy people, the functional
 *                     floors, within normal above typical (5.1)
 *   gradeBand         the same rule written as the value bands of a row (the limits of 5.2)
 *   gradeMeasurement  what the server stores with a measurement (C-3, 5.3 painPrecedence)
 *
 * Rules before AI: the norm rows, their limits, σm, the z cut points and the functional floors are read
 * from the ROM data (ROM_DATA.norms, thresholds.functionalFloor, engine). The few numbers the clinical
 * source writes only in prose (the SD cap, the 20 degree percent rule, the 120 degree arm raise over
 * read, the phone bias) are code constants below, each quoting its text; tests/v7/a-norms.test.ts
 * checks them against the clinical source and checks every exported limit against the rule.
 */
import { ROM_DATA, defaultDef, movementDef } from "../movements/rom";
import { DEFAULT_ONLY_IDS, ROM_MOVEMENT_IDS } from "../movements/rom/types";
import type { Intake, Sex } from "./plan";
import type { RomFindingId, StoredRomRow } from "./rom-types";
import type { RomFlag, RomMeasureResult } from "../engine/rom/types";
import type {
  DefaultOnlyId,
  Evidence,
  JointMovementId,
  RomFunctionalFloor,
  RomMovementDef,
  RomMovementId,
  RomPositionId,
} from "../movements/rom/types";

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

/* ------------------------------------------------------------ constants */

/**
 * Phone bias b against each norm's instrument (thresholds.terms.b): «0 until the bench check (section
 * 8)». The team bench check sets Azm's own b per movement and position; z is stored with every value so
 * the grades can be recomputed then without measuring again (5.1 why 10).
 */
export const PHONE_BIAS: Record<RomMovementId, number> = Object.freeze(
  Object.fromEntries(ROM_MOVEMENT_IDS.map((id) => [id, 0])) as Record<RomMovementId, number>,
);

/**
 * thresholds.SDeff: «SD, capped at 12.5% of N for movements with N of 90 degrees or more». The exported
 * limits already carry SDeff; this states the rule tests/v7/a-norms.test.ts checks them against.
 */
export const SD_CAP: { readonly fraction: number; readonly fromMeanDeg: number } = Object.freeze({
  fraction: 0.125,
  fromMeanDeg: 90,
});

/** thresholds.percentOfNormal: «round(100 x value / N) for flexion and signed movements with N of 20 degrees or more». */
export const PERCENT_OF_NORMAL_MIN_N = 20;

/** thresholds.approximate: «values above 120 degrees on the arm raises (elevationOverRead)». */
export const ELEVATION_OVER_READ_ABOVE = 120;

/** The arm raises of thresholds.approximate: to the front and to the side. */
export const ARM_RAISES: readonly RomMovementId[] = Object.freeze(["shoulder_flexion", "shoulder_abduction"]);

/**
 * A norm with rows per side used without a tested side (a default value): the right row, the side the
 * single side norms report (Gill: the right arm; CDC: the right side).
 */
const SIDE_WITHOUT_TESTED_SIDE = "right";

/* ------------------------------------------------------------ selection */

const NORMS = new Map(ROM_DATA.norms.map((n) => [n.id, n]));
const DEFAULT_ONLY: ReadonlySet<string> = new Set(DEFAULT_ONLY_IDS);
const isDefaultOnly = (id: JointMovementId): id is DefaultOnlyId => DEFAULT_ONLY.has(id);

/** The norm id of a position (4.3 rule 1), the first graded position for null, or the default only norm. */
function normIdFor(movement: JointMovementId, position: RomPositionId | null): string | null {
  if (isDefaultOnly(movement)) return defaultDef(movement).normId;
  const def = movementDef(movement);
  if (position === null) return def.positions.find((p) => p.graded)?.normId ?? null;
  return def.positions.find((p) => p.id === position)?.normId ?? null;
}

/** Years from the age to the band's nearest edge; 0 inside the band. A null ageMax has no upper edge. */
function ageDistance(age: number, row: NormRow): number {
  if (age < row.ageMin) return row.ageMin - age;
  if (row.ageMax !== null && age > row.ageMax) return age - row.ageMax;
  return 0;
}

/**
 * normSelection of rom-protocol 4.3: the position's normId, the side row when the norm has sides, the
 * sex row (any for both), the age band or the nearest band (tie: the older), flag ageOutsideBand. Null
 * for a position with normId null or a position the movement does not use. Position null picks the
 * movement's first graded position (the typical default); a default only movement uses its own norm.
 * Without a side, a norm with rows per side uses the right row.
 */
export function normFor(
  movement: JointMovementId,
  position: RomPositionId | null,
  sex: Sex,
  age: number,
  side?: "left" | "right",
): NormPick | null {
  const id = normIdFor(movement, position);
  const norm = id === null ? undefined : NORMS.get(id);
  if (!norm) return null;
  let rows = norm.rows;
  if (rows.some((r) => r.side !== undefined)) {
    const tested = side ?? SIDE_WITHOUT_TESTED_SIDE;
    rows = rows.filter((r) => r.side === tested);
  }
  let candidates = rows.filter((r) => r.sex === sex);
  const sexAny = candidates.length === 0;
  if (sexAny) candidates = rows.filter((r) => r.sex === "any");
  if (candidates.length === 0) return null;
  let row = candidates[0];
  let distance = ageDistance(age, row);
  for (const r of candidates.slice(1)) {
    const d = ageDistance(age, r);
    // On a tie the older band: fewer false limitations (4.3 rule 4).
    if (d < distance || (d === distance && r.ageMin > row.ageMin)) {
      row = r;
      distance = d;
    }
  }
  const flags: NormPick["flags"] = [];
  if (distance > 0) flags.push("ageOutsideBand");
  if (sexAny) flags.push("sexAny");
  return { norm, row, flags };
}

/** The typical default: round(row mean) of the movement's first graded position, or the default only movement's norm. */
export function typicalValue(
  movement: JointMovementId,
  sex: Sex,
  age: number,
  side?: "left" | "right",
): number | null {
  const pick = normFor(movement, null, sex, age, side);
  return pick ? Math.round(pick.row.mean) : null;
}

/* -------------------------------------------------------------- grading */

const RANK: Record<RomGrade, number> = { within: 0, mild: 1, marked: 2 };
const worse = (a: RomGrade, b: RomGrade): RomGrade => (RANK[a] >= RANK[b] ? a : b);

/** The functional floor of thresholds.functionalFloor, when it applies to the position graded by this norm. */
function floorFor(def: RomMovementDef, pick: NormPick): RomFunctionalFloor | null {
  const floor = ROM_DATA.thresholds.functionalFloor[def.id];
  if (!floor) return null;
  if (floor.position && !def.positions.some((p) => p.id === floor.position && p.normId === pick.norm.id))
    return null;
  return floor;
}

interface Spread {
  /** N: the row mean (the typical lack for lack movements). */
  n: number;
  b: number;
  /** √(SDeff² + σm²): σm alone when the SD is unknown. */
  sdObs: number;
  zWithin: number;
  zMarked: number;
  /** «markedlyLimited ... not used when N − 3 × SDobserved is 0 or less for a movement that cannot go below 0». */
  zMarkedUsed: boolean;
}

function spreadOf(def: RomMovementDef, pick: NormPick): Spread {
  const limits = pick.row.limits;
  if (!limits) throw new Error(`Norm ${pick.norm.id} has no limits: it does not grade`);
  const n = pick.row.mean;
  const b = PHONE_BIAS[def.id];
  const sdObs = Math.hypot(limits.sdEff ?? 0, limits.sigmaM);
  const zMarkedUsed = def.kind === "lack" || def.canBeNegative || n + b + limits.zMarked * sdObs > 0;
  return { n, b, sdObs, zWithin: limits.zWithin, zMarked: limits.zMarked, zMarkedUsed };
}

function floorGrade(def: RomMovementDef, floor: RomFunctionalFloor | null, value: number): RomGrade {
  if (!floor) return "within";
  if (def.kind === "lack") {
    if (floor.lackMarkedFrom !== undefined && value >= floor.lackMarkedFrom) return "marked";
    if (floor.lackMildFrom !== undefined && value >= floor.lackMildFrom) return "mild";
    return "within";
  }
  if (floor.markedBelow !== undefined && floor.markedBelow !== null && value < floor.markedBelow)
    return "marked";
  if (floor.withinMin !== undefined && floor.withinMin !== null && value < floor.withinMin) return "mild";
  return "within";
}

const overRead = (id: RomMovementId, value: number) =>
  ARM_RAISES.includes(id) && value > ELEVATION_OVER_READ_ABOVE;

/**
 * thresholds.approximate: «Caution movements, gravity mode, values above 120 degrees on the arm raises
 * (elevationOverRead) and the lunge carry label_approximate»; the arm raise and lunge grades are
 * approximate in the person's view as well (review B17 fallback, approximateInPersonView), so they are
 * approximate at every value.
 */
function isApproximate(def: RomMovementDef, value: number, flags: readonly RomFlag[]): boolean {
  return (
    def.verdict === "caution" ||
    def.approximateInPersonView ||
    flags.includes("gravityMode") ||
    flags.includes("approximate") ||
    flags.includes("elevationOverRead") ||
    overRead(def.id, value)
  );
}

/**
 * z = (value - (N + b)) / sqrt(SDeff^2 + sigmaM^2), sign reversed for lack; the functional floors of
 * thresholds.functionalFloor; values above N are within. The grade is the worse of the z grade and the
 * floor grade: «the grade is the worse of the z grade and the floor». Above N, z gives no finding (no
 * hypermobility finding in v7), but a floor still holds: in the oldest Gill bands N is under the 120
 * degree floor, and the exported limits there are within normal from 120.
 */
export function gradeValue(
  def: RomMovementDef,
  pick: NormPick,
  value: number,
  flags: readonly RomFlag[],
): GradeResult {
  const s = spreadOf(def, pick);
  const z = def.kind === "lack" ? (s.n + s.b - value) / s.sdObs : (value - (s.n + s.b)) / s.sdObs;
  const zGrade: RomGrade = z >= s.zWithin ? "within" : z >= s.zMarked || !s.zMarkedUsed ? "mild" : "marked";
  const fGrade = floorGrade(def, floorFor(def, pick), value);
  return {
    grade: worse(zGrade, fGrade),
    z,
    percentOfNormal:
      def.kind !== "lack" && s.n >= PERCENT_OF_NORMAL_MIN_N ? Math.round((100 * value) / s.n) : null,
    floorBroken: fGrade === "within" ? null : fGrade,
    approximate: isApproximate(def, value, flags),
  };
}

/**
 * The value bands of a norm row by the same rule as gradeValue (the limits of rom-protocol 5.2, exact,
 * not rounded): within normal from (up to, for lack movements) and marked below (above), null where the
 * marked level is not used; floorMoved when a functional floor moved a limit.
 */
export type GradeBand =
  | { kind: "flexion" | "signed"; withinFrom: number; markedBelow: number | null; floorMoved: boolean }
  | { kind: "lack"; withinUpTo: number; markedAbove: number | null; floorMoved: boolean };

export function gradeBand(def: RomMovementDef, pick: NormPick): GradeBand {
  const s = spreadOf(def, pick);
  const floor = floorFor(def, pick);
  if (def.kind === "lack") {
    const zUpTo = s.n + s.b - s.zWithin * s.sdObs;
    const zAbove = s.zMarkedUsed ? s.n + s.b - s.zMarked * s.sdObs : null;
    const mild = floor?.lackMildFrom;
    const marked = floor?.lackMarkedFrom;
    const withinUpTo = mild === undefined ? zUpTo : Math.min(zUpTo, mild);
    const markedAbove = marked === undefined ? zAbove : zAbove === null ? marked : Math.min(zAbove, marked);
    const floorMoved =
      (mild !== undefined && mild < zUpTo) || (marked !== undefined && (zAbove === null || marked < zAbove));
    return { kind: "lack", withinUpTo, markedAbove, floorMoved };
  }
  const zFrom = s.n + s.b + s.zWithin * s.sdObs;
  const zBelow = s.zMarkedUsed ? s.n + s.b + s.zMarked * s.sdObs : null;
  const min = floor?.withinMin ?? null;
  const below = floor?.markedBelow ?? null;
  const withinFrom = min === null ? zFrom : Math.max(zFrom, min);
  const markedBelow = below === null ? zBelow : zBelow === null ? below : Math.max(zBelow, below);
  const floorMoved = (min !== null && min > zFrom) || (below !== null && (zBelow === null || below > zBelow));
  return { kind: def.kind, withinFrom, markedBelow, floorMoved };
}

/* -------------------------------------------------------- the server grade */

/** Flags the server derives itself (C-3): the client's copies are replaced, never trusted. */
const DERIVED_FLAGS: readonly RomFlag[] = [
  "provisional",
  "approximate",
  "ageOutsideBand",
  "elevationOverRead",
];

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/**
 * What the server stores with each measurement (C-3), from the result and the intake: the norm pick, z,
 * grade and percent; the finding with painPrecedence (5.3: pain_limited when the end range was confirmed
 * with «it hurts» or a pain stop happened, the degree grade kept as gradeIgnoringPain); provisional
 * under engine.minValidForGrade valid attempts; approximate per thresholds.approximate; no_grade
 * without a norm. A result without a value is not graded: unknown when the person could not move the
 * joint on their own (no_active_movement, the program never counts it as typical), else not_today.
 */
export function gradeMeasurement(result: RomMeasureResult, intake: Intake & { sex: Sex }): MeasurementGrade {
  const def = movementDef(result.movementId);
  const measured = result.flags.filter((f) => !DERIVED_FLAGS.includes(f));
  const value = result.status === "not_measured" ? null : result.value;
  if (value === null) {
    const noMove = result.status === "not_measured" && result.reason === "no_active_movement";
    return {
      percentNormal: null,
      finding: noMove ? "unknown" : "not_today",
      gradeIgnoringPain: null,
      norm: null,
      flags: unique(measured),
    };
  }
  const side = result.side === "none" ? undefined : result.side;
  const pick = normFor(def.id, result.position, intake.sex, intake.age, side);
  const derived: RomFlag[] = [];
  if (result.nValid < ROM_DATA.engine.minValidForGrade) derived.push("provisional");
  if (isApproximate(def, value, measured)) derived.push("approximate");
  if (pick?.flags.includes("ageOutsideBand")) derived.push("ageOutsideBand");
  if (overRead(def.id, value)) derived.push("elevationOverRead");
  const flags = unique([...measured, ...derived]);
  if (!pick || !pick.norm.graded || !pick.row.limits) {
    return { percentNormal: null, finding: "no_grade", gradeIgnoringPain: null, norm: null, flags };
  }
  const g = gradeValue(def, pick, value, flags);
  const painLimited = result.painLimited || result.reason === "pain_stop";
  const { sex, ageMin, ageMax, side: rowSide } = pick.row;
  return {
    percentNormal: g.percentOfNormal,
    finding: painLimited ? "pain_limited" : g.grade,
    gradeIgnoringPain: g.grade,
    norm: {
      normId: pick.norm.id,
      row: rowSide === undefined ? { sex, ageMin, ageMax } : { sex, ageMin, ageMax, side: rowSide },
      z: g.z,
      mean: pick.row.mean,
      sdEff: pick.row.limits.sdEff,
      sigmaM: pick.row.limits.sigmaM,
      bias: PHONE_BIAS[def.id],
    },
    flags,
  };
}
