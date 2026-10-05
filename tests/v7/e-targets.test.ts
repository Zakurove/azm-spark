/**
 * Step E2 (product v7 contract 2.10, 8.1 E): collectTargets, from the range findings (B4's romFindings)
 * and the walk's patterns (C3's evaluateGait) to the target requests of the program, by the signed off
 * exercise targets mapping (exercise-targets 5.1 to 5.7, TARGETS_DATA.mapping): gradeRules, every cause
 * path, romMovements, gaitStatusRules, regionDefaultRule, the wheelchair shoulder block, the neck and
 * arthritis add ons, and the merge. Every number is the data's; the rules the data writes in words are
 * code, each held to its words here.
 */
import { describe, expect, it } from "vitest";
import {
  ARTHRITIS_MUSCLES,
  NECK_ADD_ON,
  PAINFUL_JOINT_MUSCLES,
  RESIDUAL_TARGETS,
  SEATED_KNEE_TARGETS,
  SELF_ASSISTED_SHOULDER,
  TARGET_EVIDENCE,
  collectTargets,
  findingsOnMap,
} from "../../src/medical/targets";
import type { Intake } from "../../src/medical/plan";
import type { CausePath, RomFinding } from "../../src/medical/rom-types";
import type { TargetRequest } from "../../src/medical/target-types";
import { TARGETS_DATA } from "../../src/movements/targets";
import { entry, finding, intake, pattern } from "./e-fixtures";

const MAPPING = TARGETS_DATA.mapping;
const collect = (input: Partial<Parameters<typeof collectTargets>[0]>) =>
  collectTargets({ intake: intake(), rom: [], gait: [], ...input });
const target = (out: { targets: TargetRequest[] }, id: string, side?: TargetRequest["side"]) =>
  out.targets.find((t) => t.id === id && (side === undefined || t.side === side));
const ids = (out: { targets: TargetRequest[] }) =>
  out.targets.map((t) => `${t.id}@${t.side}:${t.priority}`).sort();
const romRow = (movement: string) => MAPPING.romMovements.find((m) => m.movement === movement)!;

describe("gradeRules (exercise-targets 5.3)", () => {
  it("a mild limit on the weak path: the movement's mobility and strengthening at priority 2", () => {
    const out = collect({ rom: [finding("knee_flexion", "right")] });
    expect(ids(out)).toEqual(["mobility:knee_flexion@right:2", "strengthen:hamstrings@right:2"]);
    expect(target(out, "mobility:knee_flexion")!.reasons).toEqual([
      { kind: "rom", movementId: "knee_flexion", side: "right", finding: "mild", path: "weak" },
    ]);
  });

  it("takes the finding's priority as B4 gives it: marked 3, provisional one lower", () => {
    const marked = collect({ rom: [finding("knee_flexion", "left", { finding: "marked", priority: 3 })] });
    expect(target(marked, "strengthen:hamstrings", "left")!.priority).toBe(3);
    const provisional = collect({
      rom: [finding("knee_flexion", "left", { finding: "marked", priority: 2, provisional: true })],
    });
    expect(target(provisional, "strengthen:hamstrings", "left")!.priority).toBe(2);
  });

  it("a mild lunge adds targets only on the tight, pain or rehab paths (review B03)", () => {
    const lunge = (path: CausePath) =>
      collect({ rom: [finding("ankle_dorsiflexion_lunge", "right", { path })] }).targets.length;
    expect(MAPPING.gradeRules.find((r) => r.finding === "mildlyLimited")!.targets).toMatch(
      /for the lunge only on the tight, pain or rehab paths/,
    );
    for (const path of ["tight", "pain_irritable", "pain_stable", "rehab"] as const)
      expect(lunge(path), path).toBeGreaterThan(0);
    for (const path of ["weak", "umn", "pd", "unknown"] as const) expect(lunge(path), path).toBe(0);
    // A marked lunge follows its path.
    expect(
      collect({ rom: [finding("ankle_dorsiflexion_lunge", "right", { finding: "marked", priority: 3 })] })
        .targets.length,
    ).toBeGreaterThan(0);
  });

  it("the leg back adds targets only below 0 (possible flexion contracture, review B14)", () => {
    expect(romRow("hip_extension").targetsWhenBelow).toBe(0);
    expect(collect({ rom: [finding("hip_extension", "right", { value: 5 })] }).targets).toEqual([]);
    expect(collect({ rom: [finding("hip_extension", "right", { value: 0 })] }).targets).toEqual([]);
    expect(
      ids(
        collect({ rom: [finding("hip_extension", "right", { value: -4, path: "tight", cause: "tight" })] }),
      ),
    ).toEqual(["mobility:hip_extension@right:2", "stretch:hip_flexors@right:2"]);
    // A pain limited leg back follows the pain path whatever the value.
    const pain = collect({
      rom: [
        finding("hip_extension", "right", {
          finding: "pain_limited",
          priority: 3,
          value: 8,
          path: "pain_irritable",
        }),
      ],
    });
    expect(ids(pain)).toEqual(["mobility:hip_extension@right:3"]);
  });

  it("a seated knee lack above 52: knee straightening and the hamstrings at priority 1, and refer_measure", () => {
    const row = MAPPING.gradeRules.find((r) => r.finding.startsWith("noNormPosition"))!;
    expect(row.targets).toContain(
      `${SEATED_KNEE_TARGETS.join(" and ")} at priority ${row.seatedLackPriority}`,
    );
    const out = collect({
      rom: [
        finding("knee_extension", "right", { finding: "no_grade", priority: 1, value: 60, path: "weak" }),
      ],
    });
    expect(ids(out)).toEqual(["mobility:knee_extension@right:1", "stretch:hamstrings@right:1"]);
    expect(out.referrals).toEqual(["refer:measure"]);
  });

  it("a residual joint after limb loss: the hip's leg back or the knee's straightening, and refer_measure", () => {
    const row = MAPPING.gradeRules.find((r) => r.finding.includes("residual joint"))!;
    expect(row.targets).toBe(
      `${RESIDUAL_TARGETS.hip} above an above knee loss; ${RESIDUAL_TARGETS.knee} above a below knee loss; refer_measure`,
    );
    const residual = (movementId: RomFinding["movementId"]) =>
      finding(movementId, "left", { finding: "unknown", priority: 1, value: null, path: "rehab" });
    const knee = collect({ rom: [residual("knee_flexion"), residual("knee_extension")] });
    expect(ids(knee)).toEqual(["mobility:knee_extension@left:1"]);
    // Both residual movements of the joint are the one target's reasons.
    expect(target(knee, "mobility:knee_extension")!.reasons).toHaveLength(2);
    expect(knee.referrals).toEqual(["refer:measure"]);
    const hip = collect({
      rom: [residual("hip_flexion"), residual("hip_extension"), residual("hip_abduction")],
    });
    expect(ids(hip)).toEqual(["mobility:hip_extension@left:1"]);
    // The data names no target above an arm loss: the line only.
    const elbow = collect({ rom: [residual("elbow_flexion")] });
    expect(elbow.targets).toEqual([]);
    expect(elbow.referrals).toEqual(["refer:measure"]);
  });

  it("a joint the person cannot move: no active exercise, the care team line; the shoulder's self assisted slides", () => {
    const row = MAPPING.gradeRules.find((r) => r.finding === "no_active_movement")!;
    expect(row.targets).toContain(
      `for the shoulder only, ${SELF_ASSISTED_SHOULDER.join(", ")} with the other hand helping`,
    );
    expect(row.targets).toContain("show refer_care_team");
    const none = (movementId: RomFinding["movementId"]) =>
      finding(movementId, "right", { finding: "unknown", priority: 1, value: null, noActiveMovement: true });
    const elbow = collect({ rom: [none("elbow_flexion")] });
    expect(elbow.targets).toEqual([]);
    expect(elbow.referrals).toEqual(["refer:care_team"]);
    const shoulder = collect({ rom: [none("shoulder_flexion")] });
    expect(ids(shoulder)).toEqual(["mobility:shoulder_flexion@right:1"]);
    expect(shoulder.referrals).toEqual(["refer:care_team"]);
  });
});

describe("the cause paths (exercise-targets 5.1, mapping.paths)", () => {
  const knee = (path: CausePath, over: Partial<RomFinding> = {}) =>
    collect({ rom: [finding("knee_flexion", "right", { path, ...over })] });

  it("reads each path's actions from the data", () => {
    expect(MAPPING.paths.map((p) => [p.path, p.actions])).toEqual([
      ["post_op_early", ["mobility"]],
      ["umn", ["mobility", "strengthen"]],
      ["pd", ["strengthen", "mobility"]],
      ["rehab", ["mobility", "strengthen"]],
      ["tight", ["mobility", "stretch"]],
      ["weak", ["mobility", "strengthen"]],
      ["pain_irritable", ["mobility"]],
      ["pain_stable", ["mobility", "strengthen"]],
      ["unknown", ["mobility", "strengthen"]],
    ]);
  });

  it("post_op_early: unloaded range from the pain friendly set only", () => {
    const out = knee("post_op_early");
    expect(ids(out)).toEqual(["mobility:knee_flexion@right:2"]);
    expect(out.targets.every((t) => t.painFriendlyOnly)).toBe(true);
  });

  it("umn: strengthening at the finding's priority; a stretch at priority 1 only after the tight answer", () => {
    expect(ids(knee("umn"))).toEqual(["mobility:knee_flexion@right:2", "strengthen:hamstrings@right:2"]);
    expect(ids(knee("umn", { cause: "tight" }))).toEqual([
      "mobility:knee_flexion@right:2",
      "strengthen:hamstrings@right:2",
      "stretch:quadriceps@right:1",
    ]);
  });

  it("pd and rehab: range and strengthening, a stretch at priority 1", () => {
    for (const path of ["pd", "rehab"] as const)
      expect(ids(knee(path)), path).toEqual([
        "mobility:knee_flexion@right:2",
        "strengthen:hamstrings@right:2",
        "stretch:quadriceps@right:1",
      ]);
  });

  it("tight: range and stretch; strengthening at low priority when the grade is marked", () => {
    expect(ids(knee("tight", { cause: "tight" }))).toEqual([
      "mobility:knee_flexion@right:2",
      "stretch:quadriceps@right:2",
    ]);
    expect(ids(knee("tight", { cause: "tight", finding: "marked", priority: 3 }))).toEqual([
      "mobility:knee_flexion@right:3",
      "strengthen:hamstrings@right:1",
      "stretch:quadriceps@right:3",
    ]);
  });

  it("weak: no stretch unless the person also reports tightness there", () => {
    expect(ids(knee("weak"))).toEqual(["mobility:knee_flexion@right:2", "strengthen:hamstrings@right:2"]);
    const stiff = collectTargets({
      intake: intake({ regions: [entry("knee", "right", ["weakness", "stiffness"])] }),
      rom: [finding("knee_flexion", "right", { path: "weak" })],
      gait: [],
    });
    expect(ids(stiff)).toEqual([
      "mobility:knee_flexion@right:2",
      "strengthen:hamstrings@right:2",
      "stretch:quadriceps@right:1",
    ]);
  });

  it("pain_irritable: gentle range only; pain_stable: range and strengthening, pain friendly items", () => {
    const irritable = knee("pain_irritable", { finding: "pain_limited", priority: 3 });
    expect(ids(irritable)).toEqual(["mobility:knee_flexion@right:3"]);
    const stable = knee("pain_stable", { finding: "pain_limited", priority: 3 });
    expect(ids(stable)).toEqual(["mobility:knee_flexion@right:3", "strengthen:hamstrings@right:3"]);
    for (const out of [irritable, stable]) expect(out.targets.every((t) => t.painFriendlyOnly)).toBe(true);
  });

  it("unknown: range and strengthening, a stretch at low priority", () => {
    expect(ids(knee("unknown"))).toEqual([
      "mobility:knee_flexion@right:2",
      "strengthen:hamstrings@right:2",
      "stretch:quadriceps@right:1",
    ]);
  });

  it("the other paths are not pain friendly only", () => {
    for (const path of ["umn", "pd", "rehab", "tight", "weak", "unknown"] as const)
      expect(
        knee(path).targets.some((t) => t.painFriendlyOnly),
        path,
      ).toBe(false);
  });
});

describe("romMovements (exercise-targets 5.2)", () => {
  it("every graded movement's targets on the weak path are its mobility and strengthening lists", () => {
    for (const row of MAPPING.romMovements) {
      if (row.movement === "hip_extension") continue;
      const side = ["trunk_flexion", "neck_flexion", "neck_extension"].includes(row.movement)
        ? "none"
        : "right";
      const out = collect({ rom: [finding(row.movement, side, { finding: "marked", priority: 3 })] });
      for (const id of [...row.mobility, ...row.strengthen])
        expect(
          out.targets.some((t) => t.id === id),
          `${row.movement} ${id}`,
        ).toBe(true);
    }
  });

  it("a side bend: range and stretch toward that side, strengthening both sides", () => {
    const out = collect({
      rom: [
        finding("trunk_lateral_flexion", "left", {
          path: "tight",
          cause: "tight",
          finding: "marked",
          priority: 3,
        }),
      ],
    });
    expect(romRow("trunk_lateral_flexion").side).toMatch(/strengthen both sides/);
    expect(ids(out)).toEqual([
      "mobility:trunk_lateral_flexion@left:3",
      "strengthen:trunk_side@both:1",
      "stretch:trunk_side@left:3",
    ]);
  });

  it("an axial movement has no side", () => {
    const out = collect({ rom: [finding("trunk_flexion", "none")] });
    expect(ids(out)).toEqual(["mobility:trunk_flexion@none:2", "strengthen:abdominals@none:2"]);
  });
});

describe("the neck add on (review C16)", () => {
  it("adds deep neck flexor and shoulder blade strengthening at priority 2, whatever the end range answer", () => {
    expect(MAPPING.neckAddOn).toContain(
      `adds ${NECK_ADD_ON.targets.join(" and ")} at priority ${MAPPING.neckAddOnPriority} on every path except ${NECK_ADD_ON.exceptPaths.join(" and ")}`,
    );
    const out = collect({ rom: [finding("neck_flexion", "none", { path: "tight", cause: "tight" })] });
    expect(ids(out)).toEqual([
      "mobility:neck_flexion@none:2",
      "strengthen:neck_deep_flexors@none:2",
      "strengthen:scapular_retractors@both:2",
      "stretch:neck_back@none:2",
    ]);
  });

  it("is not added on the irritable pain path or early after surgery", () => {
    for (const path of NECK_ADD_ON.exceptPaths) {
      const out = collect({ rom: [finding("neck_extension", "none", { path })] });
      expect(
        out.targets.map((t) => t.id),
        path,
      ).toEqual(["mobility:neck_extension"]);
    }
  });
});

describe("the arthritis add on (review C08)", () => {
  const withArthritis = (rom: RomFinding[], over = {}) =>
    collectTargets({ intake: intake({ conditions: ["arthritis"], ...over }), rom, gait: [] });

  it("names the muscles around each joint as the data writes them", () => {
    expect(MAPPING.arthritisAddOn).toContain(
      `(knee: ${ARTHRITIS_MUSCLES.knee.map((m) => m.split(":")[1].replace(/_/g, " ")).join(" and ")}; hip: ${ARTHRITIS_MUSCLES.hip
        .map((m) => m.split(":")[1].replace(/_/g, " "))
        .join(" and ")}; shoulder: ${ARTHRITIS_MUSCLES.shoulder
        .map((m) => m.split(":")[1].replace(/_/g, " "))
        .join(
          " and ",
        )} and the shoulder muscles that move the limited direction) and walking practice for people who walk`,
    );
  });

  it("a knee finding adds the thigh front and the hip side at the finding's priority, and walking practice", () => {
    const out = withArthritis([
      finding("knee_flexion", "right", { path: "tight", cause: "tight", finding: "marked", priority: 3 }),
    ]);
    expect(target(out, "strengthen:quadriceps", "right")!.priority).toBe(3);
    expect(target(out, "strengthen:hip_abductors", "right")!.priority).toBe(3);
    expect(target(out, "practice:walking")!.priority).toBe(3);
    expect(target(out, "strengthen:quadriceps", "right")!.reasons).toContainEqual({
      kind: "arthritis",
      region: "knee",
    });
  });

  it("no walking practice for a person who does not walk", () => {
    const out = withArthritis([finding("knee_flexion", "right")], {
      walking: { status: "no" },
      mobility: "seated",
    });
    expect(target(out, "practice:walking")).toBeUndefined();
  });

  it("a shoulder finding adds the shoulder blade muscles and the muscles of the limited direction", () => {
    const out = withArthritis([finding("shoulder_abduction", "left", { path: "tight", cause: "tight" })]);
    expect(target(out, "strengthen:scapular_retractors", "left")).toBeDefined();
    expect(target(out, "strengthen:shoulder_abductors", "left")).toBeDefined();
  });

  it("only with arthritis, and only around the knee, the hip and the shoulder", () => {
    expect(
      target(
        collect({ rom: [finding("knee_flexion", "right", { path: "tight" })] }),
        "strengthen:quadriceps",
      ),
    ).toBeUndefined();
    const elbow = withArthritis([finding("elbow_flexion", "right", { path: "tight", cause: "tight" })]);
    expect(elbow.targets.every((t) => t.reasons.every((r) => r.kind !== "arthritis"))).toBe(true);
  });
});

describe("gaitStatusRules (exercise-targets 5.4)", () => {
  const trendelenburg = (over = {}) =>
    pattern({
      pattern: "trendelenburg",
      side: "right",
      targets: [
        { id: "strengthen:hip_abductors", side: "right" },
        { id: "balance:single_leg_stance", side: "right" },
      ],
      referrals: ["refer_prosthetist"],
      ...over,
    });

  it("reads the rows of the data", () => {
    expect(MAPPING.gaitStatusRules.map((r) => [r.status, r.priority])).toEqual([
      ["likely, confidence moderate or high", 3],
      ["likely, confidence low; or possible, confidence moderate or high", 2],
      ["possible, confidence low", 1],
      ["not_seen, not_assessed, or below low (not shown)", null],
    ]);
  });

  it("likely at moderate or high confidence: every target at priority 3, with the referrals", () => {
    for (const confidence of ["moderate", "high"] as const) {
      const out = collect({ gait: [trendelenburg({ confidence })] });
      expect(ids(out)).toEqual(["balance:single_leg_stance@right:3", "strengthen:hip_abductors@right:3"]);
      expect(out.referrals).toEqual(["refer:prosthetist"]);
    }
  });

  it("likely at low confidence, or possible at moderate or high: every target at priority 2", () => {
    for (const [status, confidence] of [
      ["likely", "low"],
      ["possible", "moderate"],
      ["possible", "high"],
    ] as const)
      expect(ids(collect({ gait: [trendelenburg({ status, confidence })] }))).toEqual([
        "balance:single_leg_stance@right:2",
        "strengthen:hip_abductors@right:2",
      ]);
  });

  it("possible at low confidence: the first target only, at priority 1, and no referral", () => {
    const out = collect({ gait: [trendelenburg({ status: "possible", confidence: "low" })] });
    expect(ids(out)).toEqual(["strengthen:hip_abductors@right:1"]);
    expect(out.referrals).toEqual([]);
  });

  it("not seen, not assessed or below low: none", () => {
    for (const p of [
      trendelenburg({ status: "not_seen", confidence: null }),
      trendelenburg({ status: "not_assessed", confidence: null }),
      trendelenburg({ status: "possible", confidence: null }),
    ])
      expect(collect({ gait: [p] })).toEqual({ targets: [], referrals: [] });
  });

  it("keeps the reason of the pattern", () => {
    const out = collect({ gait: [trendelenburg()] });
    expect(target(out, "strengthen:hip_abductors")!.reasons).toEqual([
      {
        kind: "gait",
        pattern: "trendelenburg",
        label: "trendelenburg",
        side: "right",
        status: "likely",
        confidence: "high",
      },
    ]);
  });

  it("the painful joint's range is pain friendly only (antalgic, the Duchenne lean with hip pain)", () => {
    const antalgic = pattern({
      pattern: "shorter_stance",
      label: "antalgic",
      side: "left",
      targets: [
        { id: "mobility:knee_flexion", side: "left" },
        { id: "mobility:knee_extension", side: "left" },
        { id: "practice:gradual_loading", side: "left" },
      ],
    });
    const out = collect({ gait: [antalgic] });
    expect(target(out, "mobility:knee_flexion")!.painFriendlyOnly).toBe(true);
    expect(target(out, "practice:gradual_loading")!.painFriendlyOnly).toBe(false);
    const duchenne = pattern({
      pattern: "duchenne_lean",
      side: "left",
      targets: [
        { id: "strengthen:hip_abductors", side: "left" },
        { id: "mobility:hip_flexion", side: "left" },
      ],
    });
    expect(target(collect({ gait: [duchenne] }), "mobility:hip_flexion")!.painFriendlyOnly).toBe(true);
  });

  it("strengthens around a painful joint only once its pain is stable (exercise-targets 5.5)", () => {
    const alignment = TARGETS_DATA.taxonomy.gaitRulesAlignment.find(
      (a) => a.gaitTarget === "muscles_around_painful_joint",
    )!;
    expect(alignment.targetIds[0]).toBe(
      `resolved by the painful joint: hip = ${PAINFUL_JOINT_MUSCLES.hip.join(" + ")}; knee = ${PAINFUL_JOINT_MUSCLES.knee.join(
        " + ",
      )}; ankle or foot = ${PAINFUL_JOINT_MUSCLES.ankle_foot.join(" + ")} (proposal)`,
    );
    const antalgic = pattern({
      pattern: "shorter_stance",
      label: "antalgic",
      side: "right",
      targets: [
        { id: "mobility:knee_flexion", side: "right" },
        { id: "practice:gradual_loading", side: "right" },
      ],
    });
    const stable = finding("knee_flexion", "right", {
      finding: "pain_limited",
      priority: 3,
      path: "pain_stable",
    });
    const out = collect({ gait: [antalgic], rom: [stable] });
    expect(target(out, "strengthen:quadriceps", "right")).toBeDefined();
    expect(target(out, "strengthen:hamstrings", "right")!.reasons.map((r) => r.kind)).toContain("gait");
    const irritable = { ...stable, path: "pain_irritable" as const };
    expect(target(collect({ gait: [antalgic], rom: [irritable] }), "strengthen:quadriceps")).toBeUndefined();
    // No range finding for that joint: its pain is not shown to have settled.
    expect(target(collect({ gait: [antalgic] }), "strengthen:quadriceps")).toBeUndefined();
  });
});

describe("regionDefaultRule (exercise-targets 5.6, review A01)", () => {
  const rows = MAPPING.regionDefaultRule.rows;
  const withMap = (regions: Intake["regions"], over = {}) =>
    collectTargets({ intake: intake({ regions, ...over }), rom: [], gait: [] });

  it("the wrist and hand with weakness: the wrist, the fingers, the forearm turn and the grip at priority 1", () => {
    const out = withMap([entry("forearm_wrist", "right", ["weakness"])]);
    expect(ids(out)).toEqual(rows[0].targets.map((t) => `${t}@right:1`).sort());
    expect(target(out, "mobility:wrist")!.reasons).toEqual([
      { kind: "region_default", region: "forearm_wrist", side: "right" },
    ]);
  });

  it("the wrist and hand with another problem type: the range targets, pain friendly with pain", () => {
    const out = withMap([entry("forearm_wrist", "both", ["pain"])]);
    expect(ids(out)).toEqual(rows[1].targets.map((t) => `${t}@both:1`).sort());
    expect(out.targets.every((t) => t.painFriendlyOnly)).toBe(true);
    expect(
      withMap([entry("forearm_wrist", "left", ["stiffness"])]).targets.every((t) => !t.painFriendlyOnly),
    ).toBe(true);
  });

  it("the shoulder, for any problem type: the outward turn", () => {
    expect(ids(withMap([entry("shoulder", "left", ["injury"], { injury: { since: "gt6m" } })]))).toEqual([
      "mobility:shoulder_external_rotation@left:1",
    ]);
  });

  it("the hip, not with hip precautions", () => {
    expect(ids(withMap([entry("hip", "right", ["stiffness"])]))).toEqual(["mobility:hip_rotation@right:1"]);
    const replaced = entry("hip", "right", ["after_surgery"], {
      surgery: { since: "lt6w", cleared: "yes", hipReplacement: true },
    });
    expect(withMap([replaced]).targets).toEqual([]);
  });

  it("the neck, on the body map or with Parkinson's, not with neck_caution", () => {
    expect(ids(withMap([entry("neck", "axial", ["stiffness"])]))).toEqual(["mobility:neck_rotation@none:1"]);
    expect(
      withMap([entry("neck", "axial", ["stiffness"])], {
        romFlags: { osteoporosis: false, neckCaution: true },
      }).targets,
    ).toEqual([]);
    const pd = withMap([], { conditions: ["parkinsons"] });
    expect(ids(pd)).toEqual([
      "mobility:neck_rotation@none:1",
      "mobility:trunk_extension@none:1",
      "mobility:trunk_rotation@none:1",
    ]);
  });

  it("the back: the trunk turn and back extension, extension only with osteoporosis", () => {
    expect(ids(withMap([entry("back_trunk", "axial", ["pain"])]))).toEqual([
      "mobility:trunk_extension@none:1",
      "mobility:trunk_rotation@none:1",
    ]);
    expect(
      ids(
        withMap([entry("back_trunk", "axial", ["pain"])], {
          romFlags: { osteoporosis: true, neckCaution: false },
        }),
      ),
    ).toEqual(["mobility:trunk_extension@none:1"]);
  });

  it("no region default for a part a limb loss took (the forearm after an above elbow loss)", () => {
    const loss = entry("elbow", "left", ["limb_loss"], { limbLoss: { level: "above_elbow" } });
    expect(withMap([loss, entry("forearm_wrist", "left", ["weakness"])]).targets).toEqual([]);
  });
});

describe("the wheelchair shoulder care block (review C12)", () => {
  const block = MAPPING.mobilityDefaultRule.rows[0];
  const wheelchair = (over = {}, rom: RomFinding[] = []) =>
    collectTargets({
      intake: intake({ mobility: "wheelchair", walking: { status: "no" }, ...over }),
      rom,
      gait: [],
    });

  it("every wheelchair user whose arms move gets the block at priority 1, both shoulders", () => {
    const out = wheelchair();
    expect(ids(out)).toEqual(block.targets.map((t) => `${t}@both:${block.priority}`).sort());
    expect(target(out, "stretch:chest")!.reasons).toEqual([
      { kind: "mobility_default", block: "wheelchair_shoulder" },
    ]);
    expect(collect({}).targets).toEqual([]);
  });

  it("not for a side with an upper limb loss or a shoulder that cannot move on its own", () => {
    const loss = entry("elbow", "left", ["limb_loss"], { limbLoss: { level: "below_elbow" } });
    expect(wheelchair({ regions: [loss] }).targets.every((t) => t.side === "right")).toBe(true);
    const still = finding("shoulder_flexion", "right", {
      finding: "unknown",
      priority: 1,
      noActiveMovement: true,
      value: null,
    });
    const one = wheelchair({}, [still]);
    expect(
      one.targets
        .filter((t) => t.reasons.some((r) => r.kind === "mobility_default"))
        .every((t) => t.side === "left"),
    ).toBe(true);
    const both = wheelchair({ regions: [loss] }, [still]);
    expect(both.targets.some((t) => t.reasons.some((r) => r.kind === "mobility_default"))).toBe(false);
  });

  it("not with a region filter on the shoulder", () => {
    const surgery = entry("shoulder", "right", ["after_surgery"], {
      surgery: { since: "lt6w", cleared: "no" },
    });
    expect(
      wheelchair({ regions: [surgery] }).targets.some((t) =>
        t.reasons.some((r) => r.kind === "mobility_default"),
      ),
    ).toBe(false);
  });
});

describe("merge and order (exercise-targets 5.7, 5.8 step 3)", () => {
  it("the same target on the same side from a range finding and a pattern is one target with both reasons", () => {
    const out = collect({
      rom: [finding("hip_abduction", "right", { priority: 2 })],
      gait: [
        pattern({
          pattern: "trendelenburg",
          side: "right",
          targets: [{ id: "strengthen:hip_abductors", side: "right" }],
        }),
      ],
    });
    const t = target(out, "strengthen:hip_abductors", "right")!;
    expect(t.priority).toBe(3);
    expect(t.reasons.map((r) => r.kind)).toEqual(["rom", "gait"]);
    expect(out.targets.filter((x) => x.id === "strengthen:hip_abductors")).toHaveLength(1);
  });

  it("a target on another side stays its own", () => {
    const out = collect({
      rom: [finding("hip_abduction", "left")],
      gait: [
        pattern({
          pattern: "trendelenburg",
          side: "right",
          targets: [{ id: "strengthen:hip_abductors", side: "right" }],
        }),
      ],
    });
    expect(
      out.targets
        .filter((x) => x.id === "strengthen:hip_abductors")
        .map((t) => t.side)
        .sort(),
    ).toEqual(["left", "right"]);
  });

  it("sorts by priority, then by the evidence of the target (High first)", () => {
    const out = collect({
      rom: [
        finding("knee_flexion", "right", { path: "rehab", priority: 2 }),
        finding("shoulder_flexion", "left", {
          path: "tight",
          cause: "tight",
          finding: "marked",
          priority: 3,
        }),
      ],
    });
    const priorities = out.targets.map((t) => t.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
    const rank = (t: TargetRequest) => ["High", "Moderate", "Low", "Very low"].indexOf(t.evidence);
    for (let i = 1; i < out.targets.length; i++)
      if (out.targets[i].priority === out.targets[i - 1].priority)
        expect(rank(out.targets[i])).toBeGreaterThanOrEqual(rank(out.targets[i - 1]));
    expect(target(out, "strengthen:hamstrings")!.evidence).toBe(TARGET_EVIDENCE.strengthen);
  });

  it("lists each referral once, in order", () => {
    const out = collect({
      rom: [
        finding("knee_extension", "right", { finding: "no_grade", priority: 1, value: 60 }),
        finding("knee_extension", "left", { finding: "no_grade", priority: 1, value: 58 }),
      ],
      gait: [
        pattern({
          pattern: "steppage",
          side: "right",
          targets: [],
          referrals: ["refer_afo", "refer_new_or_worse"],
        }),
      ],
    });
    expect(out.referrals).toEqual(["refer:measure", "refer:afo", "refer:new_or_worse"]);
  });

  it("is deterministic", () => {
    const input = {
      intake: intake({ conditions: ["arthritis"], regions: [entry("knee", "right", ["pain"])] }),
      rom: [
        finding("knee_flexion", "right", {
          path: "pain_stable",
          finding: "pain_limited",
          priority: 3 as const,
        }),
      ],
      gait: [
        pattern({
          pattern: "trendelenburg",
          targets: [{ id: "strengthen:hip_abductors" as const, side: "right" as const }],
        }),
      ],
    };
    expect(collectTargets(input)).toEqual(collectTargets(input));
  });
});

describe("findingsOnMap (contract 2.10: the body map now)", () => {
  it("drops a range finding whose joint left the body map, keeps a residual joint while its limb loss stays", () => {
    const knee = finding("knee_flexion", "right");
    const shoulder = finding("shoulder_flexion", "right");
    const neck = finding("neck_flexion", "none");
    const h = intake({
      regions: [entry("shoulder", "right", ["weakness"]), entry("neck", "axial", ["stiffness"])],
    });
    expect(findingsOnMap([knee, shoulder, neck], h)).toEqual([shoulder, neck]);
    // A both sides entry covers each side.
    expect(findingsOnMap([knee], intake({ regions: [entry("knee", "both", ["pain"])] }))).toEqual([knee]);
    const residual = finding("knee_extension", "left", {
      finding: "unknown",
      priority: 1,
      value: null,
      path: "rehab",
    });
    const loss = entry("ankle_foot", "left", ["limb_loss"], { limbLoss: { level: "below_knee" } });
    expect(findingsOnMap([residual], intake({ regions: [loss] }))).toEqual([residual]);
    expect(findingsOnMap([residual], intake({ regions: [] }))).toEqual([]);
  });
});
