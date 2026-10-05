/**
 * The joints of a check for the 48 hour minimum (src/medical/check-joints.ts; product v7 contract
 * section 4, CT-3, D-025 item 5): «the 48 hour rule applies only between checks that share a joint; a
 * different joint can be checked at any time, in both directions between v1 and v7 checks». A joint is
 * a body map cell; each check's joints are the regions it measures.
 */
import { describe, expect, it } from "vitest";
import {
  GAIT_JOINT_REGIONS,
  V1_AREA_JOINTS,
  V1_CHECK_JOINTS,
  focusPlanJoints,
  focusStoredJoints,
  jointOf,
  sharedUntil,
  v1ResultJoints,
} from "../../src/medical/check-joints";
import { MIN_HOURS_BETWEEN_CHECKS } from "../../src/medical/assessment";
import { CHECK_DATA } from "../../src/movements/assessments";
import { TEST_ID_LIST } from "../../src/movements/types";
import type { RomProtocol, RomProtocolItem } from "../../src/medical/rom-protocol";
import { entry, intake, today } from "./a-fixtures";
import { buildRomProtocol } from "../../src/medical/rom-protocol";
import type { BodyMapKey, RegionEntry } from "../../src/medical/body-map";

const HOUR = 3_600_000;
const set = (...xs: BodyMapKey[]) => new Set<BodyMapKey>(xs);

function protocolOf(regions: RegionEntry[], over: Partial<RomProtocol> = {}) {
  const p = buildRomProtocol({
    intake: intake({ regions }),
    setting: "booth",
    today: today(),
    maxMeasured: 20,
  });
  return { ...p, ...over };
}

describe("a joint is a body map cell", () => {
  it("names a limb joint by its side and an axial region once", () => {
    expect(jointOf("knee", "right")).toBe("knee:right");
    expect(jointOf("shoulder", "left")).toBe("shoulder:left");
    // The neck and the back or trunk are one joint each, whatever direction a movement bends.
    expect(jointOf("neck", "none")).toBe("neck:axial");
    expect(jointOf("back_trunk", "left")).toBe("back_trunk:axial");
    expect(() => jointOf("knee", "none")).toThrow();
  });
});

describe("the joints a v1 check loads (check-v1 areas[].loads)", () => {
  it("maps every v1 area to body map cells, and only those", () => {
    expect(Object.keys(V1_AREA_JOINTS).sort()).toEqual(CHECK_DATA.areas.map((a) => a.id).sort());
    expect(V1_AREA_JOINTS).toEqual({
      shoulder_right: ["shoulder:right"],
      shoulder_left: ["shoulder:left"],
      elbow_right: ["elbow:right"],
      elbow_left: ["elbow:left"],
      wrist_right: ["forearm_wrist:right"],
      wrist_left: ["forearm_wrist:left"],
      back: ["back_trunk:axial"],
      hip: ["hip:right", "hip:left"],
      knee: ["knee:right", "knee:left"],
      ankle_foot: ["ankle_foot:right", "ankle_foot:left"],
    });
  });

  it("reads a result's joints from the areas that list its test, side and variant", () => {
    expect(v1ResultJoints({ testId: "shoulder_abduction", side: "right", variant: null })).toEqual(
      set("shoulder:right"),
    );
    expect(v1ResultJoints({ testId: "arm_curl_30s", side: "left", variant: null })).toEqual(
      set("shoulder:left", "elbow:left", "forearm_wrist:left"),
    );
    expect(v1ResultJoints({ testId: "trunk_control_seated", side: "left", variant: null })).toEqual(
      set("back_trunk:axial", "hip:right", "hip:left"),
    );
    // The chair stand loads the back and both legs; with the hands allowed it loads the arms too.
    expect(v1ResultJoints({ testId: "chair_stand_30s", side: "none", variant: null })).toEqual(
      set(
        "back_trunk:axial",
        "hip:right",
        "hip:left",
        "knee:right",
        "knee:left",
        "ankle_foot:right",
        "ankle_foot:left",
      ),
    );
    expect(v1ResultJoints({ testId: "chair_stand_30s", side: "none", variant: "arms_assisted" })).toContain(
      "elbow:right",
    );
  });

  it("gives a v1 check every joint its tests can load: never the neck", () => {
    const all = new Set<BodyMapKey>();
    for (const t of TEST_ID_LIST)
      for (const side of ["left", "right", "none"] as const)
        for (const variant of [null, "arms_assisted"] as const)
          for (const j of v1ResultJoints({ testId: t, side, variant })) all.add(j);
    expect(V1_CHECK_JOINTS).toEqual(all);
    expect(V1_CHECK_JOINTS.has("neck:axial")).toBe(false);
    expect(V1_CHECK_JOINTS.size).toBe(13);
  });
});

describe("the joints of a focus check", () => {
  it("plans the cells of its range items that run, and the walk's regions when it walks", () => {
    const p = protocolOf([entry("knee", "right", ["stiffness"]), entry("neck", "axial", ["stiffness"])]);
    expect(focusPlanJoints(p, false)).toEqual(set("knee:right", "neck:axial"));
    expect([...GAIT_JOINT_REGIONS]).toEqual(["back_trunk", "hip", "knee", "ankle_foot"]);
    expect(focusPlanJoints(p, true)).toEqual(
      set(
        "knee:right",
        "neck:axial",
        "back_trunk:axial",
        "hip:right",
        "hip:left",
        "knee:left",
        "ankle_foot:right",
        "ankle_foot:left",
      ),
    );
  });

  it("leaves out skipped and deferred items: they measure nothing in this check", () => {
    const p = protocolOf([entry("knee", "right", ["stiffness"]), entry("neck", "axial", ["stiffness"])]);
    const skipped = p.items.map((i): RomProtocolItem =>
      i.region === "knee" ? { ...i, skipped: "pain_today" } : i,
    );
    expect(focusPlanJoints({ ...p, items: skipped }, false)).toEqual(set("neck:axial"));
    const deferred = {
      ...p,
      items: p.items.filter((i) => i.region !== "neck"),
      deferred: p.items.filter((i) => i.region === "neck"),
    };
    expect(focusPlanJoints(deferred, false)).toEqual(set("knee:right"));
  });

  it("stored: the cells of its rows with a value or attempts, and the walk's regions with a gait analysis", () => {
    const rows = [
      { movementId: "knee_flexion" as const, side: "right" as const, value: 120, attempts: 3 },
      // Tried and not measured (quality): the joint moved.
      { movementId: "shoulder_flexion" as const, side: "left" as const, value: null, attempts: 2 },
      // Never run (deferred, a safety skip, not in the set, the camera cannot measure it).
      { movementId: "neck_flexion" as const, side: "none" as const, value: null, attempts: 0 },
      { movementId: "neck_rotation" as const, side: "none" as const, value: null, attempts: 0 },
    ];
    expect(focusStoredJoints(rows, false)).toEqual(set("knee:right", "shoulder:left"));
    expect(focusStoredJoints([], true)).toEqual(
      set(
        "back_trunk:axial",
        "hip:right",
        "hip:left",
        "knee:right",
        "knee:left",
        "ankle_foot:right",
        "ankle_foot:left",
      ),
    );
  });
});

describe("sharedUntil: the 48 hour minimum counts only the checks that share a joint", () => {
  const until = (t: number) => t + MIN_HOURS_BETWEEN_CHECKS * HOUR;

  it("is null without a recent check sharing a joint, else the latest such check plus 48 hours", () => {
    const neck = set("neck:axial");
    const knee = set("knee:right");
    expect(sharedUntil([], knee)).toBeNull();
    expect(sharedUntil([{ completed: 10 * HOUR, joints: neck }], knee)).toBeNull();
    expect(sharedUntil([{ completed: 10 * HOUR, joints: set("knee:right", "neck:axial") }], knee)).toBe(
      until(10 * HOUR),
    );
    // The right knee and the left knee are different joints.
    expect(sharedUntil([{ completed: 10 * HOUR, joints: set("knee:left") }], knee)).toBeNull();
    // Of two checks that share a joint, the later one counts; one that shares none never does.
    expect(
      sharedUntil(
        [
          { completed: 4 * HOUR, joints: knee },
          { completed: 9 * HOUR, joints: set("knee:right", "hip:right") },
          { completed: 20 * HOUR, joints: neck },
        ],
        set("knee:right", "shoulder:right"),
      ),
    ).toBe(until(9 * HOUR));
  });

  it("works both ways between a v1 check and a focus check", () => {
    // A v1 check, then a focus check of the neck only: no joint in common.
    const v1 = { completed: 0, joints: V1_CHECK_JOINTS };
    expect(sharedUntil([v1], set("neck:axial"))).toBeNull();
    expect(sharedUntil([v1], set("knee:right"))).toBe(until(0));
    // A focus check of the neck, then a v1 check: none; of the knee: 48 hours.
    expect(sharedUntil([{ completed: 0, joints: set("neck:axial") }], V1_CHECK_JOINTS)).toBeNull();
    expect(sharedUntil([{ completed: 0, joints: set("knee:right") }], V1_CHECK_JOINTS)).toBe(until(0));
  });
});
