/**
 * Shared builders for the step A4 tests (rom protocol, gait eligibility, pre-check bridge): a v7
 * intake with every v1 field, body map entries and the day's answers. Not a test file.
 */
import type { Intake } from "../../src/medical/plan";
import type { RegionEntry, RegionId, RegionSide, ProblemType } from "../../src/medical/body-map";
import type {
  FocusToday,
  RomProtocol,
  RomProtocolInput,
  RomProtocolItem,
} from "../../src/medical/rom-protocol";

export type V7Intake = RomProtocolInput["intake"];

export const baseIntake: V7Intake = {
  age: 45,
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
  sex: "male",
  regions: [],
  walking: { status: "without_aid" },
};

export const intake = (over: Partial<Intake> = {}): V7Intake => ({ ...baseIntake, ...over }) as V7Intake;

export const entry = (
  region: RegionId,
  side: RegionSide,
  problems: ProblemType[],
  extra: Partial<RegionEntry> = {},
): RegionEntry => ({ region, side, problems, origin: "person", ...extra });

export const today = (over: Partial<FocusToday> = {}): FocusToday => ({
  painByRegion: {},
  redFlagRegions: [],
  ...over,
});

/** "movement:side" of each item, in protocol order. */
export const keys = (items: readonly RomProtocolItem[]) => items.map((i) => `${i.movementId}:${i.side}`);
/** The items that run today (not skipped). */
export const running = (p: RomProtocol) => p.items.filter((i) => !i.skipped);
export const itemOf = (p: RomProtocol, movementId: string, side = "right"): RomProtocolItem => {
  const all = [...p.items, ...p.deferred];
  const it = all.find((i) => i.movementId === movementId && i.side === side);
  if (!it) throw new Error(`no item ${movementId}:${side} in ${keys(all).join(", ")}`);
  return it;
};
export const notMeasuredOf = (p: RomProtocol, movementId: string, side = "right") =>
  p.notMeasured.find((n) => n.movementId === movementId && n.side === side);
