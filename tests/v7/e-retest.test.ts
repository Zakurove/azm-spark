/**
 * D-029 item 1, E2-5: the re-test rule (exercise-targets 5.8 step 9, sessionLines): «a range target is
 * removed only when the change rule of rom-protocol 5.3 is met (beyond the MDC band) and the new grade
 * is within normal (review B15); a gait target when not seen at two checks; strengthening stays at
 * priority 1 as maintenance». retestState folds the person's completed checks in order, so each check
 * passes on what its own program followed: its results and those it kept.
 */
import { describe, expect, it } from "vitest";
import type { GaitPatternResult, GaitSupportFinding } from "../../src/medical/gait-types";
import type { RomChange, RomFinding, RomProfile, RomProfileEntry } from "../../src/medical/rom-types";
import { collectTargets, retestState, type CheckResults } from "../../src/medical/targets";
import { TARGETS_DATA } from "../../src/movements/targets";
import { finding, intake, pattern } from "./e-fixtures";

const NUMBERS = TARGETS_DATA.mapping.selectionNumbers;
const WALKER = intake();

const check = (over: Partial<CheckResults> = {}): CheckResults => ({
  rom: [],
  profile: null,
  changes: [],
  gait: null,
  support: [],
  walkViews: [],
  ...over,
});
const entry = (
  f: Pick<RomFinding, "movementId" | "side">,
  grade: RomProfileEntry["finding"],
): RomProfileEntry => ({
  movementId: f.movementId,
  side: f.side,
  region: "knee",
  source: "measured",
  kind: "flexion",
  value: 130,
  typical: 132,
  percentOfNormal: 98,
  z: -0.2,
  finding: grade,
  gradeIgnoringPain: null,
  painLimited: false,
  painLevel: null,
  cause: null,
  provisional: false,
  approximate: false,
  noActiveMovement: false,
  flags: [],
  reason: null,
  measuredAt: 5,
  checkId: "c2",
});
const profile = (entries: RomProfileEntry[]): RomProfile => ({
  sex: "female",
  age: 52,
  normsVersion: "n",
  created: 5,
  entries,
});
const change = (
  f: Pick<RomFinding, "movementId" | "side">,
  direction: RomChange["direction"],
): RomChange => ({
  movementId: f.movementId,
  side: f.side,
  first: 80,
  latest: 130,
  bandDeg: 10,
  direction,
});

const knee = finding("knee_flexion", "right", { finding: "mild", priority: 2, path: "weak" });
const shoulder = finding("shoulder_flexion", "right", { finding: "marked", priority: 3, path: "weak" });
/** Measured again within normal, with a change beyond the band («better»). */
const resolved = check({ profile: profile([entry(knee, "within")]), changes: [change(knee, "better")] });

const shortStance = pattern({
  pattern: "shorter_stance",
  label: "short_stance",
  side: "right",
  targets: [
    { id: "strengthen:hip_abductors", side: "right" },
    { id: "balance:single_leg_stance", side: "right" },
    { id: "practice:walking", side: "both" },
  ],
});
const notSeen = (p: GaitPatternResult): GaitPatternResult => ({
  ...p,
  label: p.pattern,
  side: "none",
  status: "not_seen",
  confidence: null,
  targets: [],
});
const notAssessed = (p: GaitPatternResult): GaitPatternResult => ({
  ...notSeen(p),
  status: "not_assessed",
  notAssessed: "wrong_view",
});
const slow: GaitSupportFinding = { id: "slow_speed", side: "none", value: 0.6, status: null };

describe("the re-test rule: range targets (E2-5)", () => {
  it("a first check passes on its own results", () => {
    const s = retestState([check({ rom: [knee] })]);
    expect(s.rom).toEqual([knee]);
    expect(s.maintenance).toEqual({ rom: [], gait: [] });
  });

  it("keeps a finding the retest did not measure (the showcase measures 2 movements)", () => {
    expect(retestState([check({ rom: [knee, shoulder] }), check({ rom: [shoulder] })]).rom).toEqual([
      shoulder,
      knee,
    ]);
  });

  it("a movement measured again and still limited follows the new finding", () => {
    const now = finding("knee_flexion", "right", { finding: "marked", priority: 3, path: "weak" });
    expect(retestState([check({ rom: [knee] }), check({ rom: [now] })]).rom).toEqual([now]);
  });

  it("keeps the target when the new grade is within normal but the change is within the band", () => {
    const same = check({ profile: profile([entry(knee, "within")]), changes: [change(knee, "same")] });
    expect(retestState([check({ rom: [knee] }), same]).rom).toEqual([knee]);
  });

  it("keeps the target when the change is better but no new grade is within normal", () => {
    const better = check({ profile: profile([]), changes: [change(knee, "better")] });
    expect(retestState([check({ rom: [knee] }), better]).rom).toEqual([knee]);
  });

  it("removes it once within normal and beyond the band: its strengthening stays at priority 1", () => {
    const s = retestState([check({ rom: [knee] }), resolved]);
    expect(s.rom).toEqual([]);
    expect(s.maintenance.rom).toEqual([knee]);
    const { targets } = collectTargets({ intake: WALKER, rom: s.rom, gait: [], maintenance: s.maintenance });
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t.id.startsWith("strengthen:")).toBe(true);
      expect(t.priority).toBe(NUMBERS.strengthenStaysAtPriority);
      expect(t.reasons[0]).toMatchObject({ kind: "rom", movementId: "knee_flexion", side: "right" });
    }
    const before = collectTargets({ intake: WALKER, rom: [knee], gait: [] }).targets;
    expect(targets.map((t) => t.id).sort()).toEqual(
      before
        .filter((t) => t.id.startsWith("strengthen:"))
        .map((t) => t.id)
        .sort(),
    );
  });

  it("a kept finding stays kept through a check that did not measure it either", () => {
    expect(retestState([check({ rom: [knee] }), check(), check()]).rom).toEqual([knee]);
  });

  it("maintenance stays, and gives way to a new finding when the movement is limited again", () => {
    expect(retestState([check({ rom: [knee] }), resolved, check()]).maintenance.rom).toEqual([knee]);
    const again = finding("knee_flexion", "right", { finding: "mild", priority: 2, path: "tight" });
    const s = retestState([check({ rom: [knee] }), resolved, check({ rom: [again] })]);
    expect(s.rom).toEqual([again]);
    expect(s.maintenance.rom).toEqual([]);
  });
});

describe("the re-test rule: gait targets (E2-5)", () => {
  it("keeps a pattern not seen at one check", () => {
    const s = retestState([check({ gait: [shortStance] }), check({ gait: [notSeen(shortStance)] })]);
    expect(s.gait).toEqual([shortStance]);
  });

  it("removes it when not seen at two checks: its strengthening stays at priority 1", () => {
    const s = retestState([
      check({ gait: [shortStance] }),
      check({ gait: [notSeen(shortStance)] }),
      check({ gait: [notSeen(shortStance)] }),
    ]);
    expect(NUMBERS.gaitTargetNotSeenChecks).toBe(2);
    expect(s.gait).toEqual([]);
    expect(s.maintenance.gait).toEqual([shortStance]);
    const { targets } = collectTargets({ intake: WALKER, rom: [], gait: [], maintenance: s.maintenance });
    expect(targets).toEqual([
      expect.objectContaining({ id: "strengthen:hip_abductors", side: "right", priority: 1 }),
    ]);
  });

  it("a check without a walk, or that could not assess the pattern, does not count", () => {
    const noWalk = retestState([
      check({ gait: [shortStance] }),
      check(),
      check({ gait: [notSeen(shortStance)] }),
    ]);
    expect(noWalk.gait).toEqual([shortStance]);
    const notRead = retestState([
      check({ gait: [shortStance] }),
      check({ gait: [notAssessed(shortStance)] }),
      check({ gait: [notSeen(shortStance)] }),
    ]);
    expect(notRead.gait).toEqual([shortStance]);
  });

  it("a pattern seen again follows the new result", () => {
    const now = { ...shortStance, status: "possible" as const, confidence: "moderate" as const };
    expect(retestState([check({ gait: [shortStance] }), check({ gait: [now] })]).gait).toEqual([now]);
  });

  it("a support finding: kept when the walk could assess it and did not see it once, removed at two", () => {
    const side = (support: GaitSupportFinding[] = []) => check({ gait: [], support, walkViews: ["side"] });
    expect(retestState([side([slow]), side()]).support).toEqual([slow]);
    expect(retestState([side([slow]), side(), side()]).support).toEqual([]);
    // A walk without the side view could not read the speed: it does not count.
    const front = check({ gait: [], walkViews: ["front"] });
    expect(retestState([side([slow]), front, side()]).support).toEqual([slow]);
  });
});
