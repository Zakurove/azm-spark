/**
 * buildRomProtocol (product v7 contract 2.5, 8.1 A): the region table, one case per problem type rule
 * (rom-protocol 2.2), per limb loss level (2.4), per position gate (2.5) and per safety id (section 6),
 * the cap of 8 and the showcase cap, block order (C-13), sitBeforeStand, the region red flags of the
 * day (rf_region) and a retest like with like. Parity tests read the region table, the limb loss
 * levels, the cap and the safety ids from the ROM data.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LIMB_LOSS_PRESENT_REGIONS,
  MAX_MEASURED_PER_CHECK,
  MOVEMENT_RUN_ORDER,
  PAIN_TODAY_SKIP_AT,
  ROM_SAFETY_RULES,
  buildRomProtocol,
  globalGate,
  standingGate,
  type RomProtocol,
  type RomProtocolInput,
} from "../../src/medical/rom-protocol";
import { contextFromIntake, intakeExclusion, isBlocked } from "../../src/medical/assessment";
import { painOptions, type Plan } from "../../src/medical/plan";
import type { RegionId } from "../../src/medical/body-map";
import { REGION_IDS } from "../../src/medical/body-map";
import { ROM_DATA, ROM_RULES_VERSION, regionRow } from "../../src/movements/rom";
import { ROM_MOVEMENT_IDS, ROM_SAFETY_IDS, type RomMovementId } from "../../src/movements/rom/types";
import { TARGETS_DATA } from "../../src/movements/targets";
import { PAIN_STOP } from "../../src/medical/pain-rule";
import { entry, intake, itemOf, keys, notMeasuredOf, running, today, type V7Intake } from "./a-fixtures";

const build = (h: V7Intake, over: Partial<Omit<RomProtocolInput, "intake">> = {}): RomProtocol =>
  buildRomProtocol({ intake: h, setting: "booth", today: today(), ...over });

const LEG: RegionId[] = ["hip", "knee", "ankle_foot"];
const ARM: RegionId[] = ["shoulder", "elbow", "forearm_wrist"];

/* ----------------------------------------------------------- region table */

describe("region table: the affected regions only, affected side only", () => {
  it("measures each region's measure and caution movements on the affected side", () => {
    for (const region of REGION_IDS) {
      const row = regionRow(region);
      const axial = region === "neck" || region === "back_trunk";
      const p = build(intake({ regions: [entry(region, axial ? "axial" : "left", ["stiffness"])] }), {
        maxMeasured: 20,
      });
      const measured = [...row.measure, ...row.caution].sort();
      const got = [...new Set([...p.items, ...p.deferred].map((i) => i.movementId))].sort();
      expect(got, region).toEqual(measured);
      for (const it of [...p.items, ...p.deferred]) {
        expect(it.region).toBe(region);
        if (!axial) expect(it.side).toBe("left");
      }
      // Default only movements of an affected region: stored as not measured, never typical (A01).
      expect(p.notMeasured.map((n) => n.movementId).sort(), region).toEqual([...row.default].sort());
      for (const n of p.notMeasured) {
        expect(n).toMatchObject({ source: "not_measured_camera", reason: "not_measured_camera", region });
        expect(n.side).toBe(axial ? "none" : "left");
      }
    }
  });

  it("both sides make one item per side; the other regions are not touched", () => {
    const p = build(intake({ regions: [entry("knee", "both", ["pain"])] }));
    expect(keys(p.items)).toEqual([
      "knee_flexion:right",
      "knee_flexion:left",
      "knee_extension:right",
      "knee_extension:left",
    ]);
    expect(p.notMeasured).toEqual([]);
  });

  it("axial regions: lateral bends in both directions, the others once (side none)", () => {
    const neck = build(intake({ regions: [entry("neck", "axial", ["stiffness"])] }));
    expect(keys(neck.items)).toEqual([
      "neck_lateral_flexion:right",
      "neck_lateral_flexion:left",
      "neck_flexion:none",
      "neck_extension:none",
    ]);
    expect(notMeasuredOf(neck, "neck_rotation", "none")).toBeDefined();
    const back = build(intake({ regions: [entry("back_trunk", "axial", ["stiffness"])] }));
    expect(keys(back.items)).toEqual([
      "trunk_flexion:none",
      "trunk_lateral_flexion:right",
      "trunk_lateral_flexion:left",
    ]);
  });

  it("each item carries its movement's data: position, block, priority, verdict, norm, approximate", () => {
    const p = build(
      intake({ regions: [entry("shoulder", "right", ["stiffness"]), entry("knee", "right", ["stiffness"])] }),
    );
    expect(itemOf(p, "shoulder_flexion")).toMatchObject({
      region: "shoulder",
      position: "seated",
      block: "seated",
      priority: "core",
      verdict: "measure",
      normId: "gill_shoulder_flexion",
      graded: true,
      askCanMove: false,
      helperRequired: false,
      approximate: true, // arm raises: approximate in the person's view as well (B17)
    });
    expect(itemOf(p, "shoulder_extension")).toMatchObject({
      verdict: "caution",
      priority: "extended",
      approximate: true,
    });
    expect(itemOf(p, "knee_flexion")).toMatchObject({
      position: "lying_back",
      block: "lying",
      normId: "mckay_knee_flexion",
      approximate: false,
    });
    expect(p.rulesVersion).toBe(ROM_RULES_VERSION);
  });

  it("no body map regions: nothing to measure", () => {
    const p = build(intake({ regions: [] }));
    expect(p).toEqual({
      rulesVersion: ROM_RULES_VERSION,
      items: [],
      deferred: [],
      notMeasured: [],
      sitBeforeStand: false,
    });
  });
});

/* ---------------------------------------------------- problem type rules */

describe("problem type rules (rom-protocol 2.2)", () => {
  it("weakness: can_move_ask before each movement of that region and side", () => {
    const p = build(
      intake({ regions: [entry("elbow", "right", ["weakness"]), entry("knee", "right", ["stiffness"])] }),
    );
    expect(itemOf(p, "elbow_extension").askCanMove).toBe(true);
    expect(itemOf(p, "elbow_flexion").askCanMove).toBe(true);
    expect(itemOf(p, "knee_flexion").askCanMove).toBe(false);
  });

  it("injury in the last 6 weeks: region not measured (acute_injury); older: measured", () => {
    const recent = build(
      intake({
        regions: [
          entry("knee", "right", ["injury"], { injury: { since: "lt6w" } }),
          entry("knee", "left", ["stiffness"]),
        ],
      }),
    );
    expect(itemOf(recent, "knee_flexion", "right").skipped).toBe("acute_injury");
    expect(itemOf(recent, "knee_extension", "right").skipped).toBe("acute_injury");
    expect(itemOf(recent, "knee_flexion", "left").skipped).toBeUndefined();
    for (const since of ["6w_3m", "3m_6m", "gt6m"] as const) {
      const older = build(intake({ regions: [entry("knee", "right", ["injury"], { injury: { since } })] }));
      expect(running(older).length, since).toBe(2);
    }
  });

  it("an Achilles tear or repair in the last 6 months: the knee to wall lunge is not measured", () => {
    const p = build(
      intake({
        regions: [entry("ankle_foot", "left", ["injury"], { injury: { since: "3m_6m", achilles: true } })],
      }),
    );
    expect(itemOf(p, "ankle_dorsiflexion_lunge", "left").skipped).toBe("achilles");
  });

  it("pain: today's score 6 or more skips the region (pain_today); 5 or less measures", () => {
    expect(PAIN_TODAY_SKIP_AT).toBe(PAIN_STOP.atOrAbove);
    const h = intake({ regions: [entry("shoulder", "right", ["pain"])] });
    const six = build(h, { today: today({ painByRegion: { shoulder: 6 } }) });
    expect(six.items.every((i) => i.skipped === "pain_today")).toBe(true);
    const five = build(h, { today: today({ painByRegion: { shoulder: 5 } }) });
    expect(five.items.some((i) => i.skipped)).toBe(false);
  });

  it("stiffness: measured normally", () => {
    const p = build(intake({ regions: [entry("hip", "right", ["stiffness"])] }));
    expect(running(p).map((i) => i.movementId)).toEqual(["hip_extension", "hip_abduction", "hip_flexion"]);
    expect(p.items.every((i) => !i.askCanMove)).toBe(true);
  });

  it("after surgery under 3 months: not measured unless the team allowed active movement", () => {
    for (const cleared of ["no", "unsure"] as const) {
      const p = build(
        intake({
          regions: [
            entry("shoulder", "left", ["after_surgery"], { surgery: { since: "6w_3m", cleared, avoid: [] } }),
          ],
        }),
      );
      expect(
        p.items.every((i) => i.skipped === "surgery_not_cleared"),
        cleared,
      ).toBe(true);
    }
    const ok = build(
      intake({
        regions: [
          entry("shoulder", "left", ["after_surgery"], {
            surgery: { since: "lt6w", cleared: "yes", avoid: ["shoulder_abduction"] },
          }),
        ],
      }),
    );
    expect(itemOf(ok, "shoulder_abduction", "left").skipped).toBe("surgery_precaution");
    expect(itemOf(ok, "shoulder_flexion", "left").skipped).toBeUndefined();
    const older = build(
      intake({
        regions: [
          entry("shoulder", "left", ["after_surgery"], {
            surgery: { since: "3m_6m", cleared: "no", avoid: [] },
          }),
        ],
      }),
    );
    expect(older.items.some((i) => i.skipped)).toBe(false);
  });

  it("limb loss: measured only where every landmark lies on a present part (2.4)", () => {
    const p = build(
      intake({
        conditions: ["lower_limb_unilateral"],
        regions: [entry("hip", "right", ["limb_loss"], { limbLoss: { level: "below_knee" } })],
      }),
      { today: today({ prosthesisOn: true }) },
    );
    expect(
      running(p)
        .map((i) => i.movementId)
        .sort(),
    ).toEqual(["hip_abduction", "hip_extension", "hip_flexion"]);
  });
});

/* ----------------------------------------------------------- limb loss */

describe("limb loss levels (rom-protocol 2.4)", () => {
  const lossOf = (level: "below_knee" | "above_knee" | "below_elbow" | "above_elbow", regions: RegionId[]) =>
    build(
      intake({
        conditions: [level.endsWith("knee") ? "lower_limb_unilateral" : "upper_limb_unilateral"],
        regions: regions.map((r) => entry(r, "left", ["limb_loss"], { limbLoss: { level } })),
      }),
      { today: today({ prosthesisOn: true }), maxMeasured: 20 },
    );
  const sourceOf = (p: RomProtocol, m: string) => notMeasuredOf(p, m, "left");

  it("follows the data's measured and not measured lists for every level", () => {
    for (const lvl of ROM_DATA.limbLoss.levels) {
      const leg = lvl.level.endsWith("knee");
      const p = lossOf(lvl.level, leg ? LEG : ARM);
      const measured = [...p.items, ...p.deferred].map((i) => i.movementId).sort();
      expect(measured, lvl.level).toEqual([...lvl.measured].sort());
      for (const [m, reason] of Object.entries(lvl.notMeasured)) {
        const n = sourceOf(p, m);
        expect(n, `${lvl.level} ${m}`).toBeDefined();
        if (reason === "limb_absent")
          expect(n).toMatchObject({ source: "not_applicable", reason: "limb_absent" });
        else expect(n).toMatchObject({ source: "not_measured_camera", reason: "not_measured_camera" });
      }
    }
  });

  it("below the knee: hip measured, the residual knee not measured by camera, the ankle absent", () => {
    const p = lossOf("below_knee", ["hip", "knee"]);
    expect(sourceOf(p, "knee_flexion")).toMatchObject({ source: "not_measured_camera" });
    expect(sourceOf(p, "ankle_dorsiflexion_lunge")).toMatchObject({
      source: "not_applicable",
      reason: "limb_absent",
    });
    // The absent ankle never takes a default, even off the body map.
    expect(sourceOf(p, "ankle_plantarflexion")).toMatchObject({
      source: "not_applicable",
      reason: "limb_absent",
    });
    expect(sourceOf(p, "hip_internal_rotation")).toMatchObject({ source: "not_measured_camera" });
  });

  it("above the knee: nothing measured; the residual hip not measured by camera; knee and ankle absent", () => {
    const p = lossOf("above_knee", ["hip"]);
    expect(p.items).toEqual([]);
    expect(sourceOf(p, "hip_extension")).toMatchObject({ source: "not_measured_camera" });
    expect(sourceOf(p, "knee_extension")).toMatchObject({ source: "not_applicable", reason: "limb_absent" });
    expect(sourceOf(p, "ankle_dorsiflexion_nwb")).toMatchObject({ source: "not_applicable" });
  });

  it("below the elbow: the shoulder measured, the residual elbow not by camera, forearm and wrist absent", () => {
    const p = lossOf("below_elbow", ["shoulder", "elbow"]);
    expect(
      running(p)
        .map((i) => i.movementId)
        .sort(),
    ).toEqual(["shoulder_abduction", "shoulder_extension", "shoulder_flexion"]);
    expect(sourceOf(p, "elbow_flexion")).toMatchObject({ source: "not_measured_camera" });
    expect(sourceOf(p, "wrist_flexion")).toMatchObject({ source: "not_applicable", reason: "limb_absent" });
  });

  it("above the elbow: nothing measured; the residual shoulder not by camera; elbow and forearm absent", () => {
    const p = lossOf("above_elbow", ["shoulder"]);
    expect(p.items).toEqual([]);
    expect(sourceOf(p, "shoulder_flexion")).toMatchObject({ source: "not_measured_camera" });
    expect(sourceOf(p, "elbow_extension")).toMatchObject({ source: "not_applicable" });
    expect(sourceOf(p, "forearm_supination")).toMatchObject({ source: "not_applicable" });
  });

  it("the present regions agree with the data: absent regions hold only limb_absent movements", () => {
    for (const lvl of ROM_DATA.limbLoss.levels) {
      const limb = lvl.level.endsWith("knee") ? LEG : ARM;
      const present = LIMB_LOSS_PRESENT_REGIONS[lvl.level];
      for (const region of limb) {
        const row = regionRow(region);
        for (const m of [...row.measure, ...row.caution]) {
          const absent = lvl.notMeasured[m] === "limb_absent";
          expect(absent, `${lvl.level} ${m}`).toBe(!present.includes(region));
          if (present.includes(region))
            expect(lvl.measured.includes(m) || lvl.notMeasured[m] === "not_measured_camera").toBe(true);
        }
      }
    }
  });

  it("standing tests after lower limb loss only with the prosthesis on (limb_loss_standing)", () => {
    const h = intake({
      conditions: ["lower_limb_unilateral"],
      regions: [entry("hip", "left", ["limb_loss"], { limbLoss: { level: "below_knee" } })],
    });
    const off = build(h, { today: today({ prosthesisOn: false }) });
    expect(itemOf(off, "hip_extension", "left").skipped).toBe("standing_not_allowed");
    expect(itemOf(off, "hip_flexion", "left").skipped).toBeUndefined(); // lying
    const on = build(h, { today: today({ prosthesisOn: true }) });
    expect(itemOf(on, "hip_extension", "left").skipped).toBeUndefined();
  });
});

/* ------------------------------------------------------------ positions */

describe("positions (rom-protocol 2.5)", () => {
  it("standing gate: the v1.1 chair stand exclusions", () => {
    const hip = (over: Parameters<typeof intake>[0], setting: "home" | "booth" = "booth") =>
      itemOf(
        buildRomProtocol({
          intake: intake({ regions: [entry("hip", "right", ["stiffness"])], ...over }),
          setting,
          today: today({ helperPresent: true }),
        }),
        "hip_extension",
      ).skipped;
    expect(hip({})).toBeUndefined();
    expect(hip({ mobility: "seated" })).toBe("standing_not_allowed");
    expect(hip({ mobility: "wheelchair" })).toBe("standing_not_allowed");
    expect(hip({ pain: ["knee"] })).toBe("standing_not_allowed");
    expect(hip({ pain: ["back"] })).toBe("standing_not_allowed");
    expect(hip({ pain: ["shoulder"] })).toBeUndefined();
    expect(hip({ restrictions: ["no_weight_bearing"] })).toBe("standing_not_allowed");
    expect(hip({ restrictions: ["balance_support"] }, "home")).toBe("standing_not_allowed");
    expect(hip({ restrictions: ["balance_support"] }, "booth")).toBeUndefined();
    expect(hip({ conditions: ["sci_complete"] })).toBe("standing_not_allowed");
    expect(hip({ conditions: ["arthritis"], clearance: "unsure" })).toBe("standing_not_allowed");
    expect(hip({ conditions: ["arthritis"], clearance: "no" }, "home")).toBe("standing_not_allowed");
  });

  it("the standing gate agrees with the v1 chair stand intake exclusion where the two rules are the same", () => {
    const cases: Parameters<typeof intake>[0][] = [
      {},
      ...painOptions.map((p) => ({ pain: [p] })),
      { restrictions: ["no_weight_bearing"] },
      { restrictions: ["balance_support"] },
      { restrictions: ["no_overhead"] },
      { conditions: ["sci_complete"], clearance: "yes" },
      { conditions: ["arthritis"], clearance: "no" },
      { conditions: ["ms"] },
      { clearance: "unsure" },
    ];
    for (const c of cases) {
      const h = intake(c);
      const ctx = contextFromIntake(h, { status: "ready", reasons: [] } as unknown as Plan, "home");
      if (isBlocked(ctx)) continue;
      const v1 = intakeExclusion("chair_stand_30s", ctx, "home", null);
      expect(standingGate(h, "home", today()) !== null, JSON.stringify(c)).toBe(v1 !== undefined);
    }
  });

  it("standing supported: a helper for the lunge on a weak or upper motor neuron leg, and for the standing hip tests when both legs are affected", () => {
    const lunge = (h: V7Intake, setting: "home" | "booth", helperPresent?: boolean) =>
      itemOf(
        buildRomProtocol({ intake: h, setting, today: today({ helperPresent }) }),
        "ankle_dorsiflexion_lunge",
      );
    const weak = intake({ regions: [entry("ankle_foot", "right", ["weakness"])] });
    expect(lunge(weak, "booth")).toMatchObject({ helperRequired: true });
    expect(lunge(weak, "booth").skipped).toBeUndefined(); // staff stand beside at the booth
    expect(lunge(weak, "home", true).skipped).toBeUndefined();
    expect(lunge(weak, "home", false).skipped).toBe("helper_needed");
    const stroke = intake({ conditions: ["stroke"], regions: [entry("ankle_foot", "right", ["stiffness"])] });
    expect(lunge(stroke, "booth").helperRequired).toBe(true);
    const stiff = intake({ regions: [entry("ankle_foot", "right", ["stiffness"])] });
    expect(lunge(stiff, "home").helperRequired).toBe(false);

    const both = build(
      intake({ regions: [entry("hip", "right", ["stiffness"]), entry("knee", "left", ["stiffness"])] }),
    );
    expect(itemOf(both, "hip_extension").helperRequired).toBe(true);
    expect(itemOf(both, "hip_abduction").helperRequired).toBe(true);
    expect(itemOf(both, "hip_flexion").helperRequired).toBe(false);
    const one = build(intake({ regions: [entry("hip", "right", ["stiffness"])] }));
    expect(itemOf(one, "hip_extension").helperRequired).toBe(false);
  });

  it("balance_support at the booth: standing with someone beside", () => {
    const p = build(
      intake({ restrictions: ["balance_support"], regions: [entry("hip", "right", ["stiffness"])] }),
    );
    expect(itemOf(p, "hip_extension")).toMatchObject({ helperRequired: true });
    expect(itemOf(p, "hip_extension").skipped).toBeUndefined();
  });

  it("lying: knee and hip bends on the back; a wheelchair user needs a safe transfer", () => {
    const h = (over: Parameters<typeof intake>[0]) =>
      intake({
        regions: [entry("knee", "right", ["stiffness"]), entry("hip", "right", ["stiffness"])],
        ...over,
      });
    const walker = build(h({}));
    expect(itemOf(walker, "knee_flexion").position).toBe("lying_back");
    expect(itemOf(walker, "hip_flexion").position).toBe("lying_back");
    const chair = build(h({ mobility: "wheelchair", romFlags: { osteoporosis: false, neckCaution: false } }));
    expect(itemOf(chair, "knee_flexion")).toMatchObject({
      position: "lying_back",
      skipped: "standing_not_allowed",
    });
    expect(itemOf(chair, "knee_extension")).toMatchObject({
      position: "seated",
      graded: false,
      normId: null,
    });
    expect(itemOf(chair, "hip_flexion")).toMatchObject({ position: "seated", graded: false });
    const transfers = build(
      h({
        mobility: "wheelchair",
        romFlags: { osteoporosis: false, neckCaution: false, transferChair: true },
      }),
    );
    expect(itemOf(transfers, "knee_flexion").position).toBe("lying_back");
    expect(itemOf(transfers, "knee_flexion").skipped).toBeUndefined();
  });

  it("seated forward (arm back): only with sitting balance; a wheelchair user also after a transfer", () => {
    const shoulder = [entry("shoulder", "right", ["stiffness"])];
    const ext = (over: Parameters<typeof intake>[0], t = today()) =>
      itemOf(
        buildRomProtocol({ intake: intake({ regions: shoulder, ...over }), setting: "booth", today: t }),
        "shoulder_extension",
      );
    expect(ext({}).position).toBe("seated_forward");
    // Sitting balance no: the arm back is measured standing with support when the standing gate allows.
    const flags = { osteoporosis: false, neckCaution: false };
    expect(ext({ romFlags: { ...flags, sitUnsupported: "no" } })).toMatchObject({
      position: "standing_supported",
    });
    expect(ext({ mobility: "seated", romFlags: { ...flags, sitUnsupported: "unsure" } })).toMatchObject({
      skipped: "sitting_balance",
    });
    // Not asked: yes for everyone, no with SCI (asked of everyone else with SCI; not asked at neck level).
    expect(ext({ mobility: "seated" }).position).toBe("seated_forward");
    expect(ext({ mobility: "wheelchair", conditions: ["sci_incomplete"] }).skipped).toBe("sitting_balance");
    // A wheelchair user: transfer_chair_ask yes and pc_transfer_chair yes today.
    const chair = {
      mobility: "wheelchair" as const,
      romFlags: { ...flags, sitUnsupported: "yes" as const, transferChair: true },
    };
    expect(ext(chair, today({ transferChair: true }))).toMatchObject({ position: "seated_forward" });
    expect(ext(chair, today({ transferChair: false })).skipped).toBe("sitting_balance");
    expect(
      ext({ ...chair, romFlags: { ...chair.romFlags, transferChair: false } }, today({ transferChair: true }))
        .skipped,
    ).toBe("sitting_balance");
  });

  it("seated forward bend only with sitting balance; standing people bend standing", () => {
    const back = [entry("back_trunk", "axial", ["stiffness"])];
    const bend = (over: Parameters<typeof intake>[0]) =>
      itemOf(build(intake({ regions: back, ...over })), "trunk_flexion", "none");
    expect(bend({})).toMatchObject({ position: "standing_supported", graded: true });
    expect(bend({ mobility: "seated" })).toMatchObject({ position: "seated", graded: false });
    expect(
      bend({
        mobility: "seated",
        romFlags: { osteoporosis: false, neckCaution: false, sitUnsupported: "no" },
      }),
    ).toMatchObject({
      skipped: "sitting_balance",
    });
  });

  it("seated side bend: on armrests when the person does not stand; balance_support at home fails the side lean gate", () => {
    const back = [entry("back_trunk", "axial", ["stiffness"])];
    const lean = (over: Parameters<typeof intake>[0], setting: "home" | "booth" = "booth") =>
      itemOf(
        buildRomProtocol({ intake: intake({ regions: back, ...over }), setting, today: today() }),
        "trunk_lateral_flexion",
      );
    expect(lean({}).position).toBe("standing");
    expect(lean({ mobility: "wheelchair" })).toMatchObject({
      position: "seated_armrests",
      graded: false,
      block: "seated",
    });
    expect(lean({ mobility: "wheelchair", restrictions: ["balance_support"] }, "home").skipped).toBe(
      "seated_lean_gate",
    );
    expect(
      lean({ mobility: "wheelchair", restrictions: ["balance_support"] }, "booth").skipped,
    ).toBeUndefined();
  });

  it("Parkinson's: the hip bend and the forward bend only seated (A10)", () => {
    const p = build(
      intake({
        conditions: ["parkinsons"],
        regions: [entry("hip", "right", ["stiffness"]), entry("back_trunk", "axial", ["stiffness"])],
      }),
      { maxMeasured: 20 },
    );
    expect(itemOf(p, "hip_flexion")).toMatchObject({ position: "seated", graded: false });
    expect(itemOf(p, "trunk_flexion", "none")).toMatchObject({ position: "seated", graded: false });
    expect(itemOf(p, "hip_extension").position).toBe("standing_supported");
  });
});

describe("globalGate is the v1.1 gate of any camera test", () => {
  it("blocks exactly where the v1 check context is blocked at home", () => {
    const cases: Parameters<typeof intake>[0][] = [
      {},
      { conditions: ["cardiac"] },
      { conditions: ["other"] },
      { conditions: ["cfs_moderate"] },
      { mobility: "bed" },
      { restrictions: ["no_exercise"] },
      { symptoms: "yes" },
      { recentChange: "yes" },
      { conditions: ["stroke"], clearance: "unsure" },
      { conditions: ["stroke"], clearance: "yes" },
      { conditions: ["sci_complete"], clearance: "no" },
      { conditions: ["sci_incomplete"], clearance: "yes" },
      { conditions: ["ms"], clearance: "no" },
      { conditions: ["arthritis"], clearance: "unsure" },
      { conditions: ["parkinsons", "cardiac"] },
    ];
    for (const c of cases) {
      const h = intake(c);
      const v1 = contextFromIntake(h, { status: "ready", reasons: [] } as unknown as Plan, "home");
      expect(globalGate(h) !== null, JSON.stringify(c)).toBe(isBlocked(v1));
      if (isBlocked(v1))
        expect(globalGate(h) === "clearance_needed", JSON.stringify(c)).toBe(v1.blocked === "clearance");
    }
  });
});

/* ------------------------------------------------------- safety ids (22+1) */

describe("every safety id of rom-protocol 6", () => {
  it("has exactly one rule here, in data order", () => {
    expect(ROM_SAFETY_RULES.map((r) => r.id)).toEqual([...ROM_SAFETY_IDS]);
    expect(ROM_DATA.safety.map((s) => s.id)).toEqual([...ROM_SAFETY_IDS]);
    for (const r of ROM_SAFETY_RULES) expect(r.where.length, r.id).toBeGreaterThan(0);
  });

  const cases: Record<(typeof ROM_SAFETY_IDS)[number], () => void> = {
    global_gate: () => {
      for (const over of [
        { conditions: ["cardiac"] },
        { conditions: ["other"] },
        { conditions: ["cfs_moderate"] },
        { mobility: "bed" as const, walking: { status: "no" as const } },
        { restrictions: ["no_exercise"] },
        { symptoms: "yes" as const },
        { recentChange: "yes" as const },
      ]) {
        const h = intake({ regions: [entry("knee", "right", ["stiffness"])], ...over });
        expect(globalGate(h), JSON.stringify(over)).toBe("global_gate");
        // No range check: nothing is planned (the start route answers REVIEW before it builds one).
        expect(build(h).items, JSON.stringify(over)).toEqual([]);
      }
      const stroke = intake({
        conditions: ["stroke"],
        clearance: "unsure",
        regions: [entry("knee", "right", ["weakness"])],
      });
      expect(globalGate(stroke)).toBe("clearance_needed");
      const p = build(stroke);
      expect(p.items.length).toBe(2);
      expect(p.items.every((i) => i.skipped === "clearance_needed")).toBe(true);
      expect(globalGate(intake({ conditions: ["sci_incomplete"], clearance: "yes" }))).toBeNull();
      expect(globalGate(intake({ conditions: ["arthritis"], clearance: "no" }))).toBeNull();
    },
    after_surgery_recent: () => {
      const p = build(
        intake({
          regions: [
            entry("knee", "right", ["after_surgery"], {
              surgery: { since: "lt6w", cleared: "no", avoid: [] },
            }),
          ],
        }),
      );
      expect(p.items.map((i) => i.skipped)).toEqual(["surgery_not_cleared", "surgery_not_cleared"]);
    },
    after_surgery_precaution: () => {
      const p = build(
        intake({
          regions: [
            entry("knee", "right", ["after_surgery"], {
              surgery: { since: "6w_3m", cleared: "yes", avoid: ["knee_flexion"] },
            }),
          ],
        }),
      );
      expect(itemOf(p, "knee_flexion").skipped).toBe("surgery_precaution");
      expect(itemOf(p, "knee_extension").skipped).toBeUndefined();
    },
    hip_replacement_recent: () => {
      const hip = (hipAvoid?: ("flex90" | "cross" | "turn_in" | "back_out" | "none")[]) =>
        build(
          intake({
            regions: [
              entry("hip", "left", ["after_surgery"], {
                surgery: { since: "6w_3m", cleared: "yes", avoid: [], hipReplacement: true, hipAvoid },
              }),
            ],
          }),
        );
      for (const avoid of [undefined, [], ["none"], ["cross"], ["back_out"]] as const) {
        const p = hip(avoid as never);
        expect(itemOf(p, "hip_flexion", "left").skipped, JSON.stringify(avoid)).toBe(
          "hip_replacement_recent",
        );
      }
      // The hip precaution filters stay on (posterior and anterior lists) unless told of no limits.
      expect(itemOf(hip(undefined), "hip_extension", "left").skipped).toBe("surgery_precaution");
      expect(itemOf(hip([]), "hip_extension", "left").skipped).toBe("surgery_precaution");
      expect(itemOf(hip(["back_out"]), "hip_extension", "left").skipped).toBe("surgery_precaution");
      expect(itemOf(hip(["none"]), "hip_extension", "left").skipped).toBeUndefined();
      expect(itemOf(hip(["cross"]), "hip_extension", "left").skipped).toBeUndefined();
      expect(itemOf(hip(undefined), "hip_abduction", "left").skipped).toBeUndefined();
    },
    spine_surgery: () => {
      for (const region of ["neck", "back_trunk"] as const) {
        const p = build(
          intake({
            regions: [
              entry(region, "axial", ["after_surgery"], {
                surgery: { since: "6w_3m", cleared: "yes", avoid: [] },
              }),
            ],
          }),
        );
        expect(
          p.items.every((i) => i.skipped === "spine_surgery"),
          region,
        ).toBe(true);
      }
    },
    acute_injury: () => {
      const p = build(
        intake({ regions: [entry("elbow", "left", ["injury"], { injury: { since: "lt6w" } })] }),
      );
      expect(p.items.every((i) => i.skipped === "acute_injury")).toBe(true);
    },
    red_flags: () => {
      const h = intake({
        regions: [entry("ankle_foot", "right", ["pain"]), entry("shoulder", "right", ["pain"])],
      });
      const p = build(h, { today: today({ redFlagRegions: ["ankle_foot"] }) });
      expect(itemOf(p, "ankle_dorsiflexion_lunge").skipped).toBe("red_flag");
      expect(itemOf(p, "shoulder_flexion").skipped).toBeUndefined();
      // The default only movements of that region are kept for the record with the same reason.
      expect(notMeasuredOf(p, "ankle_plantarflexion")).toMatchObject({
        source: "not_measured_today",
        reason: "red_flag",
      });
      expect(notMeasuredOf(p, "shoulder_internal_rotation")).toMatchObject({ reason: "not_measured_camera" });
    },
    pain_today: () => {
      const p = build(intake({ regions: [entry("hip", "left", ["pain"])] }), {
        today: today({ painByRegion: { hip: 7 } }),
      });
      expect(p.items.every((i) => i.skipped === "pain_today")).toBe(true);
    },
    pain_during: () => {
      // The runner's rule (B): buildRomProtocol has nothing to plan; the shared rule is painStopRule.
      expect(ROM_SAFETY_RULES.find((r) => r.id === "pain_during")!.where).toContain("painStopRule");
    },
    achilles: () => {
      const p = build(
        intake({
          regions: [entry("ankle_foot", "left", ["injury"], { injury: { since: "6w_3m", achilles: true } })],
        }),
      );
      expect(itemOf(p, "ankle_dorsiflexion_lunge", "left").skipped).toBe("achilles");
    },
    osteoporosis: () => {
      const flags = { osteoporosis: true, neckCaution: false };
      for (const mobility of ["standing", "seated"] as const) {
        const p = build(
          intake({ mobility, romFlags: flags, regions: [entry("back_trunk", "axial", ["pain"])] }),
        );
        expect(itemOf(p, "trunk_flexion", "none").skipped, mobility).toBe("osteoporosis");
        expect(itemOf(p, "trunk_lateral_flexion").skipped).toBeUndefined();
      }
    },
    neck_caution: () => {
      const neck = [entry("neck", "axial", ["stiffness"])];
      const caution = build(intake({ regions: neck, romFlags: { osteoporosis: false, neckCaution: true } }));
      expect(caution.items.every((i) => i.skipped === "neck_caution")).toBe(true);
      const ra = (inflammatoryArthritis: "yes" | "no" | "unsure", neckCleared?: boolean) =>
        build(
          intake({
            conditions: ["arthritis"],
            regions: neck,
            romFlags: { osteoporosis: false, neckCaution: false, inflammatoryArthritis, neckCleared },
          }),
        ).items.every((i) => i.skipped === "neck_caution");
      expect(ra("yes")).toBe(true);
      expect(ra("unsure")).toBe(true);
      expect(ra("yes", true)).toBe(false);
      expect(ra("no")).toBe(false);
    },
    standing_tests: () => {
      const p = build(intake({ pain: ["knee"], regions: [entry("ankle_foot", "right", ["stiffness"])] }));
      expect(itemOf(p, "ankle_dorsiflexion_lunge").skipped).toBe("standing_not_allowed");
    },
    no_overhead: () => {
      const p = build(
        intake({ restrictions: ["no_overhead"], regions: [entry("shoulder", "right", ["stiffness"])] }),
      );
      expect(itemOf(p, "shoulder_flexion").skipped).toBe("no_overhead");
      expect(itemOf(p, "shoulder_abduction").skipped).toBe("no_overhead");
      expect(itemOf(p, "shoulder_extension").skipped).toBeUndefined();
    },
    weak_shoulder: () => {
      // pc_weak_shoulder is a v1 pre-check item: the bridge (applyPrecheckOutcome) skips the shoulder.
      expect(ROM_SAFETY_RULES.find((r) => r.id === "weak_shoulder")!.where).toContain("applyPrecheckOutcome");
    },
    sci_t6: () => {
      expect(ROM_SAFETY_RULES.find((r) => r.id === "sci_t6")!.where).toContain("evaluatePrecheck");
    },
    limb_loss: () => {
      const p = build(
        intake({
          conditions: ["upper_limb_unilateral"],
          regions: [entry("shoulder", "left", ["limb_loss"], { limbLoss: { level: "above_elbow" } })],
        }),
      );
      expect(p.items).toEqual([]);
      expect(notMeasuredOf(p, "elbow_flexion", "left")).toMatchObject({
        source: "not_applicable",
        reason: "limb_absent",
      });
    },
    never: () => {
      // Active movement only: no item asks a helper to move the limb; the runner records active range only (B).
      expect(ROM_SAFETY_RULES.find((r) => r.id === "never")!.where).toContain("RomRunner");
    },
    seated_side_lean_gate: () => {
      const p = build(
        intake({ mobility: "wheelchair", regions: [entry("back_trunk", "axial", ["stiffness"])] }),
      );
      expect(itemOf(p, "trunk_lateral_flexion").position).toBe("seated_armrests");
      expect(ROM_SAFETY_RULES.find((r) => r.id === "seated_side_lean_gate")!.where).toContain(
        "trunk_control_seated",
      );
    },
    sitting_balance: () => {
      const p = build(
        intake({
          mobility: "seated",
          romFlags: { osteoporosis: false, neckCaution: false, sitUnsupported: "no" },
          regions: [entry("shoulder", "left", ["stiffness"])],
        }),
      );
      expect(itemOf(p, "shoulder_extension", "left").skipped).toBe("sitting_balance");
    },
    sit_before_stand: () => {
      const lying = build(
        intake({ regions: [entry("knee", "right", ["stiffness"]), entry("hip", "right", ["stiffness"])] }),
      );
      expect(lying.sitBeforeStand).toBe(true);
      const blocks = running(lying).map((i) => i.block);
      // A standing test never follows a lying test.
      expect(blocks.lastIndexOf("standing")).toBeLessThan(blocks.indexOf("lying"));
      expect(build(intake({ regions: [entry("shoulder", "right", ["stiffness"])] })).sitBeforeStand).toBe(
        false,
      );
    },
    coach_end_range: () => {
      expect(ROM_SAFETY_RULES.find((r) => r.id === "coach_end_range")!.where).toContain("keepReaching");
    },
    limb_loss_standing: () => {
      const p = build(
        intake({
          conditions: ["lower_limb_unilateral"],
          regions: [
            entry("knee", "right", ["stiffness"]),
            entry("hip", "left", ["limb_loss"], { limbLoss: { level: "below_knee" } }),
          ],
        }),
        { today: today({ prosthesisOn: false }) },
      );
      expect(itemOf(p, "hip_extension", "left").skipped).toBe("standing_not_allowed");
    },
  };

  it.each([...ROM_SAFETY_IDS])("%s", (id) => cases[id]());
});

/* ------------------------------------------------------ red flags today */

describe("rf_region: region red flags today (contract 2.5)", () => {
  it("one red flag region skips its items with reason red_flag; the other regions still run", () => {
    const h = intake({ regions: [entry("knee", "both", ["pain"]), entry("elbow", "right", ["stiffness"])] });
    const p = build(h, { today: today({ redFlagRegions: ["knee"] }) });
    for (const it of p.items.filter((i) => i.region === "knee")) expect(it.skipped).toBe("red_flag");
    expect(itemOf(p, "elbow_extension").skipped).toBeUndefined();
  });

  it("red flag wins over every other reason", () => {
    const p = build(
      intake({ regions: [entry("knee", "right", ["injury"], { injury: { since: "lt6w" } })] }),
      { today: today({ redFlagRegions: ["knee"], painByRegion: { knee: 9 } }) },
    );
    expect(p.items.map((i) => i.skipped)).toEqual(["red_flag", "red_flag"]);
  });
});

/* ------------------------------------------------------- order and cap */

describe("session order and the cap (C-13, rom-protocol sessionOrder)", () => {
  // Fahd, the showcase placeholder: weaker right side after a stroke, walks without an aid.
  const fahd = intake({
    age: 58,
    conditions: ["stroke"],
    support: "right",
    clearance: "yes",
    regions: (["shoulder", "elbow", "forearm_wrist", "hip", "knee", "ankle_foot"] as const).map((r) => ({
      ...entry(r, "right", ["weakness"]),
      origin: "condition" as const,
    })),
  });

  it("at most MAX_MEASURED_PER_CHECK (8) run; core movements first; the rest are deferred", () => {
    expect(MAX_MEASURED_PER_CHECK).toBe(8);
    const p = build(fahd);
    expect(running(p).length).toBe(8);
    const core = [
      "shoulder_flexion",
      "shoulder_abduction",
      "elbow_extension",
      "hip_flexion",
      "knee_flexion",
      "knee_extension",
      "ankle_dorsiflexion_lunge",
    ];
    for (const m of core)
      expect(
        running(p).map((i) => i.movementId),
        m,
      ).toContain(m);
    expect(p.deferred.map((i) => i.movementId).sort()).toEqual([
      "hip_abduction",
      "hip_extension",
      "shoulder_extension",
    ]);
    expect(p.deferred.every((i) => i.priority === "extended" && i.skipped === undefined)).toBe(true);
  });

  it("blocks run seated, standing, lying; order numbers follow the run order", () => {
    const p = build(fahd);
    expect(keys(p.items)).toEqual([
      "shoulder_flexion:right",
      "shoulder_abduction:right",
      "elbow_extension:right",
      "elbow_flexion:right",
      "ankle_dorsiflexion_lunge:right",
      "hip_flexion:right",
      "knee_flexion:right",
      "knee_extension:right",
    ]);
    expect(p.items.map((i) => i.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(p.items.map((i) => i.block)).toEqual([
      "seated",
      "seated",
      "seated",
      "seated",
      "standing",
      "lying",
      "lying",
      "lying",
    ]);
    expect(p.deferred.map((i) => i.order)).toEqual([9, 10, 11]);
    expect(p.sitBeforeStand).toBe(true);
    expect(itemOf(p, "ankle_dorsiflexion_lunge").helperRequired).toBe(true);
  });

  it("the showcase cap of 2 keeps the first two core movements", () => {
    const p = build(fahd, { maxMeasured: 2 });
    expect(keys(running(p))).toEqual(["shoulder_flexion:right", "shoulder_abduction:right"]);
    expect(p.deferred.length).toBe(9);
    expect(p.sitBeforeStand).toBe(false);
  });

  it("skipped items stay in the protocol for the record and never count toward the cap", () => {
    const p = build({ ...fahd, restrictions: ["no_overhead"] });
    expect(p.items.filter((i) => i.skipped).map((i) => i.movementId)).toEqual([
      "shoulder_flexion",
      "shoulder_abduction",
    ]);
    expect(running(p).length).toBe(8);
  });

  it("each movement and side appears once across items, deferred and not measured", () => {
    for (const p of [build(fahd), build(fahd, { maxMeasured: 2 })]) {
      const all = [...p.items, ...p.deferred, ...p.notMeasured].map((i) => `${i.movementId}:${i.side}`);
      expect(new Set(all).size).toBe(all.length);
    }
  });
});

/* ---------------------------------------------------------- retest */

describe("retest: like with like", () => {
  it("keeps the baseline's position for a movement measured before when it is still allowed", () => {
    const h = intake({ regions: [entry("knee", "right", ["stiffness"])] });
    const baseline = build(h);
    const standingBend = {
      ...baseline,
      items: baseline.items.map((i) =>
        i.movementId === "knee_flexion"
          ? {
              ...i,
              position: "standing_supported" as const,
              block: "standing" as const,
              normId: null,
              graded: false,
            }
          : i,
      ),
    };
    const retest = build(h, { previous: standingBend });
    expect(itemOf(retest, "knee_flexion")).toMatchObject({
      position: "standing_supported",
      block: "standing",
      graded: false,
    });
    expect(itemOf(retest, "knee_extension").position).toBe("lying_back");
    // A previous position that is not allowed today is not forced.
    const seated = build({ ...h, mobility: "seated" }, { previous: standingBend });
    expect(itemOf(seated, "knee_flexion").position).toBe("lying_back");
  });

  it("a skipped baseline item does not fix the position", () => {
    const h = intake({ regions: [entry("knee", "right", ["stiffness"])] });
    const baseline = build(h);
    const prev = {
      ...baseline,
      items: baseline.items.map((i) => ({
        ...i,
        position: "standing_supported" as const,
        skipped: "pain_today" as const,
      })),
    };
    expect(itemOf(build(h, { previous: prev }), "knee_flexion").position).toBe("lying_back");
  });
});

/* ------------------------------------------------- constants and the data */

describe("code constants against the data", () => {
  it("the run order lists every measured movement once", () => {
    expect([...MOVEMENT_RUN_ORDER].sort()).toEqual([...ROM_MOVEMENT_IDS].sort());
  });

  it("the upper motor neuron conditions are the ones exercise-targets names for the umn path", () => {
    const row = TARGETS_DATA.mapping.causeResolution.find((r) => r.order === 2)!;
    expect(row.if).toContain("Stroke, MS, cerebral palsy or incomplete SCI");
    expect(row.path).toBe("umn");
  });

  it("the hip precaution answers map to the movements their copy names", () => {
    expect(ROM_DATA.copy.hip_avoid_flex90.en).toBe("Bending my hip past a right angle");
    expect(ROM_DATA.copy.hip_avoid_back_out.en).toBe("Taking my leg behind me or turning it out");
    expect(ROM_DATA.copy.hip_avoid_none.en).toBe("I was told no limits");
    const hipRule = ROM_DATA.safety.find((s) => s.id === "hip_replacement_recent")!;
    expect(hipRule.action).toContain("on by default (posterior and anterior lists)");
  });
});

/* --------------------------------------------- the clinical source (prose) */

describe.skipIf(!process.env.AZM_CLINICAL_V7)(
  "constants against the clinical source (AZM_CLINICAL_V7)",
  () => {
    const rom = () =>
      JSON.parse(readFileSync(join(process.env.AZM_CLINICAL_V7!, "rom-protocol.json"), "utf8")) as {
        sessionOrder: string;
        limbLoss: { levels: { level: keyof typeof LIMB_LOSS_PRESENT_REGIONS; present: string }[] };
        safety: { id: string; rule: string }[];
      };

    it("the cap: at most 8 measured movements per session", () => {
      expect(rom().sessionOrder).toContain(
        `At most ${MAX_MEASURED_PER_CHECK} measured movements per session`,
      );
      expect(rom().sessionOrder).toContain(
        "seated block (shoulder, elbow, neck, seated variants), then standing block",
      );
    });

    it("the present parts of each limb loss level", () => {
      const words: Record<RegionId, string> = {
        hip: "hip",
        knee: "knee",
        shoulder: "shoulder",
        elbow: "elbow",
        ankle_foot: "ankle",
        forearm_wrist: "wrist",
        neck: "neck",
        back_trunk: "back",
      };
      for (const lvl of rom().limbLoss.levels) {
        const present = LIMB_LOSS_PRESENT_REGIONS[lvl.level];
        const limb = lvl.level.endsWith("knee") ? LEG : ARM;
        for (const r of limb)
          expect(lvl.present.includes(words[r]), `${lvl.level} ${r}`).toBe(present.includes(r));
      }
    });

    it("the hip precaution lists (R63)", () => {
      const src = JSON.parse(
        readFileSync(join(process.env.AZM_CLINICAL_V7!, "rom-protocol.json"), "utf8"),
      ) as {
        safety: { id: string; evidence?: string }[];
      };
      const ev = src.safety.find((s) => s.id === "after_surgery_precaution")!.evidence ?? "";
      expect(ev).toContain("posterior: no flexion past 90, no internal rotation or adduction past neutral");
      expect(ev).toContain("anterior: no extension past 20, no external rotation past 50");
    });

    it("pain today: 6 or more", () => {
      const row = rom().safety.find((s) => s.id === "pain_today")!;
      expect(row.rule).toContain(`${PAIN_TODAY_SKIP_AT} or more out of 10`);
    });
  },
);

it("pain_today reads its threshold from the data", () => {
  const row = ROM_DATA.safety.find((s) => s.id === "pain_today")!;
  expect(row.rule).toContain(`${PAIN_TODAY_SKIP_AT} or more out of 10`);
});

// Every movement id the region table names is a measured movement id (compile time union check).
const _ids: RomMovementId[] = ROM_DATA.regionTable.flatMap((r) => [...r.measure, ...r.caution]);
void _ids;
