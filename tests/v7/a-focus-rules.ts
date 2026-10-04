/**
 * Test rules for the focus route tests (tests/v7/a-focus-routes.test.ts): small deterministic stand
 * ins with the contract signatures of FocusRules (server/modules/focus/precheck.ts), so the routes'
 * own behaviour (order of checks, error codes, transactions, stored rows, the server's grade) is
 * tested before steps A2 and A4 bind the real rules at Gate A. They follow the contract's shapes and
 * the data's ids; their clinical choices are simplified and never shipped.
 */
import { REGION_IDS, type RegionEntry, type RegionId } from "../../src/medical/body-map";
import type { FocusRules } from "../../server/modules/focus/precheck";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import type { Intake } from "../../src/medical/plan";
import type { PrecheckOutcome } from "../../src/medical/precheck";
import type { RomBlock, RomNotMeasured, RomProtocol, RomProtocolItem } from "../../src/medical/rom-protocol";
import { ROM_DATA, ROM_RULES_VERSION, movementDef, regionRow } from "../../src/movements/rom";
import type { RomPositionId, RomSide } from "../../src/movements/rom/types";
import type { TestId } from "../../src/movements/types";

/** The typical value every movement has in the test rules. */
export const TEST_TYPICAL = 150;

const BLOCK_ORDER: RomBlock[] = ["seated", "standing", "lying"];
const blockOf = (p: RomPositionId): RomBlock =>
  p === "lying_back" ? "lying" : p === "standing" || p === "standing_supported" ? "standing" : "seated";
const LEG_OR_BACK: readonly RegionId[] = ["hip", "knee", "ankle_foot", "back_trunk"];

function sidesOf(e: RegionEntry, bothDirections: boolean): RomSide[] {
  if (e.side === "axial") return bothDirections ? ["left", "right"] : ["none"];
  return e.side === "both" ? ["left", "right"] : [e.side];
}

/** The core and extended movements of each region of the body map, capped, in block order. */
export function testProtocol(input: Parameters<FocusRules["buildRomProtocol"]>[0]): RomProtocol {
  const { intake, today } = input;
  const cap = input.maxMeasured ?? 8;
  const all: Omit<RomProtocolItem, "order">[] = [];
  const notMeasured: RomNotMeasured[] = [];
  for (const e of intake.regions) {
    const row = regionRow(e.region);
    const pain = today.painByRegion[e.region] ?? 0;
    const skip = today.redFlagRegions.includes(e.region) ? "red_flag" : pain >= 6 ? "pain_today" : undefined;
    for (const id of [...row.core, ...row.extended]) {
      const def = movementDef(id);
      const pos = def.positions[0];
      for (const side of sidesOf(e, def.bothDirections === true))
        all.push({
          movementId: id,
          side,
          region: e.region,
          position: pos.id,
          block: blockOf(pos.id),
          priority: def.priority,
          verdict: def.verdict,
          normId: pos.normId,
          graded: pos.graded,
          askCanMove: e.problems.includes("weakness"),
          helperRequired: false,
          approximate: def.approximateInPersonView,
          ...(skip ? { skipped: skip } : {}),
        });
    }
    for (const id of row.default)
      for (const side of sidesOf(e, false))
        notMeasured.push({
          movementId: id,
          side,
          region: e.region,
          source: skip ? "not_measured_today" : "not_measured_camera",
          reason: skip ?? "default_camera",
        });
  }
  const ordered = BLOCK_ORDER.flatMap((b) => all.filter((i) => i.block === b));
  const runnable = ordered.filter((i) => !i.skipped);
  const kept = new Set(runnable.slice(0, cap));
  const items = ordered.filter((i) => i.skipped || kept.has(i)).map((i, n) => ({ ...i, order: n + 1 }));
  const deferred = runnable.slice(cap).map((i, n) => ({ ...i, order: items.length + n + 1 }));
  return {
    rulesVersion: ROM_RULES_VERSION,
    items,
    deferred,
    notMeasured,
    sitBeforeStand: items.some((i) => i.block === "lying" && !i.skipped),
  };
}

/** Gait for a person who walks, both modes at the booth (the pad side views first), none with a leg or back red flag. */
export function testGaitPlan(
  intake: Intake,
  today: { redFlagRegions: RegionId[] },
  setting: "home" | "booth",
): GaitPlan {
  const walks = intake.walking !== undefined && intake.walking.status !== "no";
  const flagged = today.redFlagRegions.some((r) => LEG_OR_BACK.includes(r));
  const pad = setting === "booth";
  return {
    offered: walks && !flagged,
    ...(!walks ? { reason: "not_walking" as const } : flagged ? { reason: "red_flag" as const } : {}),
    modes: walks && !flagged ? (pad ? ["overground", "walking_pad"] : ["overground"]) : [],
    defaultMode: "overground",
    padAllowed: pad,
    helperRequired: false,
    antalgicOnly: false,
    staticStance: true,
    views: {
      overground: ["side", "front"],
      walking_pad: pad
        ? [
            { view: "pad_side", nearSide: "right" },
            { view: "pad_side", nearSide: "left" },
            { view: "pad_front" },
          ]
        : [],
    },
  };
}

/** The v1 test ids whose pre-check items the day needs: the arm raise for seated items, the chair stand for standing items and gait. */
function proxyTests(protocol: RomProtocol, gait: GaitPlan | null): TestId[] {
  const out: TestId[] = [];
  const live = protocol.items.filter((i) => !i.skipped);
  if (live.some((i) => i.block === "seated")) out.push("shoulder_abduction");
  if (live.some((i) => i.block === "standing") || gait?.offered) out.push("chair_stand_30s");
  return out;
}

/** A stand in grade: within from 135, mild from 100, marked below, pain limited first (C-3). */
export const testGrade: FocusRules["gradeMeasurement"] = (result, intake) => {
  const v = result.value;
  const grade = v === null ? null : v >= 135 ? "within" : v >= 100 ? "mild" : "marked";
  return {
    percentNormal: v === null ? null : Math.round((100 * v) / TEST_TYPICAL),
    finding: v === null ? "unknown" : result.painLimited ? "pain_limited" : grade!,
    gradeIgnoringPain: grade,
    norm:
      v === null
        ? null
        : {
            normId: "test_norm",
            row: { sex: intake.sex, ageMin: 40, ageMax: 59 },
            z: Math.round(((v - TEST_TYPICAL) / 11.2) * 100) / 100,
            mean: TEST_TYPICAL,
            sdEff: 10,
            sigmaM: 5,
            bias: 0,
          },
    flags: [...result.flags, ...(result.nValid === 1 ? (["provisional"] as const) : [])],
  };
};

/** The test rules; `over` replaces any of them (spies, failures). */
export function testRules(over: Partial<FocusRules> = {}): FocusRules {
  return {
    hasV7Fields: (h): h is Intake & Required<Pick<Intake, "sex" | "regions" | "walking">> =>
      h.sex !== undefined && h.regions !== undefined && h.walking !== undefined,
    buildRomProtocol: testProtocol,
    gaitPlanFor: (intake, today, setting) => testGaitPlan(intake, today, setting),
    focusPrecheckEnv: (base, protocol, gait) => ({ ...base, baseTests: proxyTests(protocol, gait) }),
    applyPrecheckOutcome: (protocol, gait, outcome: PrecheckOutcome) => {
      const standingSkip = outcome.skips.find((s) => s.testId === "chair_stand_30s")?.reason;
      const helper = outcome.helperRequired.includes("chair_stand_30s");
      return {
        protocol: standingSkip
          ? {
              ...protocol,
              items: protocol.items.map((i) =>
                i.block === "standing" && !i.skipped ? { ...i, skipped: standingSkip } : i,
              ),
            }
          : protocol,
        gait: gait && standingSkip ? { ...gait, offered: false, reason: "global_gate" } : gait,
        helperRequired: helper ? ["rom_standing", "gait"] : [],
      };
    },
    gradeMeasurement: testGrade,
    typicalValue: () => TEST_TYPICAL,
    ...over,
  };
}

/** Every region id, for the fixtures that mark all of them. */
export const ALL_REGIONS = REGION_IDS;
/** The movement data, for fixtures that need a version. */
export const MOVEMENTS = ROM_DATA.movements;
