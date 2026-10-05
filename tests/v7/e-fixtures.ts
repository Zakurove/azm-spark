/**
 * Shared builders of stream E's E2 and E3 tests (product v7 contract 2.10): range findings, gait
 * pattern results and intakes in the shapes stream B's romFindings and stream C's evaluateGait give
 * them. Not a test file.
 */
import type { GaitPatternResult } from "../../src/medical/gait-types";
import type { Intake } from "../../src/medical/plan";
import type { RomFinding } from "../../src/medical/rom-types";
import type { RegionEntry } from "../../src/medical/body-map";
import { movementDef } from "../../src/movements/rom";
import type { RomMovementId } from "../../src/movements/rom/types";

/** A range finding of romFindings (B4): a mild limit on the weak path unless told otherwise. */
export function finding(
  movementId: RomMovementId,
  side: RomFinding["side"],
  over: Partial<RomFinding> = {},
): RomFinding {
  return {
    movementId,
    side,
    region: movementDef(movementId).region,
    finding: "mild",
    path: "weak",
    cause: null,
    priority: 2,
    provisional: false,
    approximate: false,
    noActiveMovement: false,
    value: 90,
    typical: 120,
    percentOfNormal: 75,
    line: { ar: "", en: "" },
    ...over,
  };
}

/** A gait pattern result of evaluateGait (C3): likely at high confidence unless told otherwise. */
export function pattern(
  over: Partial<GaitPatternResult> & Pick<GaitPatternResult, "pattern">,
): GaitPatternResult {
  return {
    label: over.pattern,
    side: "right",
    status: "likely",
    confidence: "high",
    evidence: [],
    contributors: [],
    targets: [],
    referrals: [],
    lines: { pattern: { ar: "", en: "" }, reasons: null, targets: [], confidence: null },
    ...over,
  };
}

export const entry = (
  region: RegionEntry["region"],
  side: RegionEntry["side"],
  problems: RegionEntry["problems"],
  extra: Partial<RegionEntry> = {},
): RegionEntry => ({ region, side, problems, origin: "person", ...extra });

/** A v7 intake that stands and walks, with no condition and an empty body map unless told otherwise. */
export function intake(over: Partial<Intake> = {}): Intake {
  return {
    age: 52,
    conditions: ["none"],
    diagnosisNotes: "",
    medications: "",
    mobility: "standing",
    support: "none",
    pain: [],
    restrictions: [],
    symptoms: "no",
    recentChange: "no",
    clearance: "yes",
    equipment: [],
    goal: "mobility",
    days: [0, 2, 4],
    time: "18:00",
    sessionMinutes: 30,
    consent: true,
    sex: "female",
    walking: { status: "without_aid" },
    regions: [],
    romFlags: { osteoporosis: false, neckCaution: false },
    ...over,
  };
}

/** Fahd (D-025 CT-1): 58, weaker right side after a stroke two years ago, walks without an aid. */
export const FAHD = intake({
  age: 58,
  sex: "male",
  conditions: ["stroke"],
  support: "right",
  goal: "habit",
  regions: [
    entry("shoulder", "right", ["weakness"], { origin: "condition" }),
    entry("elbow", "right", ["weakness"], { origin: "condition" }),
    entry("knee", "right", ["weakness"], { origin: "condition" }),
  ],
});
