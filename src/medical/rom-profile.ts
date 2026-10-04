/**
 * The range of motion profile and findings (product v7 contract 2.7, stream B, step B4):
 * buildRomProfile, romFindings, bodyMapSummary and compareRom. Pure, no DOM: the server builds the
 * profile from the stored rows (C-3, C-4) and the findings page shows it.
 *
 * Placeholder of step A5 (contract 1.3), replaced by B4. buildRomProfile lists every joint movement
 * and side: the check's stored rows with their own source (the measured rows and the not measured
 * rows that complete and an ending stop write, section 4), and a computed default for every other
 * movement (C-4). It leaves `typical` null: typicalValue (rom-norms.ts) lands with step A4 and B4
 * fills it with the rest of the profile rules. romFindings and compareRom return no finding and no
 * change, and bodyMapSummary colours nothing.
 */
import type { Intake, Sex } from "./plan";
import type { BodyMapKey, RegionId } from "./body-map";
import type {
  BodyMapColour,
  RomChange,
  RomFinding,
  RomProfile,
  RomProfileEntry,
  StoredRomRow,
} from "./rom-types";
import { NORMS_VERSION, ROM_DATA } from "../movements/rom";
import type { JointMovementId, RomKind, RomSide } from "../movements/rom/types";

/** Regions without a left and right (the body map's axial cells). */
const AXIAL: readonly RegionId[] = ["neck", "back_trunk"];

/** Every joint movement with its region, kind and the sides it has in a profile. */
function jointMovements(): { id: JointMovementId; region: RegionId; kind: RomKind; sides: RomSide[] }[] {
  const limb: RomSide[] = ["left", "right"];
  const measured = ROM_DATA.movements.map((m) => ({
    id: m.id as JointMovementId,
    region: m.region,
    kind: m.kind,
    // Axial lateral movements are measured in both directions: the side is the direction of the bend.
    sides: AXIAL.includes(m.region) ? (m.bothDirections ? limb : (["none"] as RomSide[])) : limb,
  }));
  const defaults = ROM_DATA.defaultMovements.map((d) => ({
    id: d.id as JointMovementId,
    region: d.region,
    kind: "flexion" as RomKind,
    sides: AXIAL.includes(d.region) ? (["none"] as RomSide[]) : limb,
  }));
  return [...measured, ...defaults];
}

function storedEntry(row: StoredRomRow, region: RegionId, kind: RomKind): RomProfileEntry {
  return {
    movementId: row.movementId,
    side: row.side,
    region,
    source: row.source,
    kind,
    value: row.value,
    typical: null,
    percentOfNormal: row.percentNormal,
    z: row.norm?.z ?? null,
    finding: row.finding,
    gradeIgnoringPain: row.gradeIgnoringPain,
    painLimited: row.pain,
    painLevel: row.painLevel,
    cause: row.cause,
    provisional: row.flags.includes("provisional"),
    approximate: row.flags.includes("approximate"),
    noActiveMovement: row.reason === "no_active_movement",
    flags: [...row.flags],
    reason: row.reason,
    measuredAt: row.source === "measured" ? row.created : null,
    checkId: row.checkId,
  };
}

function defaultEntry(id: JointMovementId, side: RomSide, region: RegionId, kind: RomKind): RomProfileEntry {
  return {
    movementId: id,
    side,
    region,
    source: "default",
    kind,
    value: null,
    typical: null,
    percentOfNormal: null,
    z: null,
    finding: "default",
    gradeIgnoringPain: null,
    painLimited: false,
    painLevel: null,
    cause: null,
    provisional: false,
    approximate: false,
    noActiveMovement: false,
    flags: [],
    reason: null,
    measuredAt: null,
    checkId: null,
  };
}

/** Every joint movement and side: stored rows, plus computed defaults for the rest (C-4). */
export function buildRomProfile(input: {
  intake: Intake & { sex: Sex };
  rows: readonly StoredRomRow[];
  now: number;
}): RomProfile {
  const entries: RomProfileEntry[] = [];
  for (const m of jointMovements())
    for (const side of m.sides) {
      const row = input.rows.find((r) => r.movementId === m.id && r.side === side);
      entries.push(row ? storedEntry(row, m.region, m.kind) : defaultEntry(m.id, side, m.region, m.kind));
    }
  return {
    sex: input.intake.sex,
    age: input.intake.age,
    normsVersion: NORMS_VERSION,
    created: input.now,
    entries,
  };
}

export function romFindings(_profile: RomProfile, _intake: Intake): RomFinding[] {
  return [];
}

export function bodyMapSummary(_profile: RomProfile): Partial<Record<BodyMapKey, BodyMapColour>> {
  return {};
}

/** retest rule: best and median both beyond the MDC band (never below 10) in the same direction. */
export function compareRom(
  _first: readonly StoredRomRow[],
  _latest: readonly StoredRomRow[],
  _conditions: readonly string[],
): RomChange[] {
  return [];
}
