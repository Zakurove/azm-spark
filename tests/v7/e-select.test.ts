/**
 * Step E2 (product v7 contract 2.10, 8.1 E): selectForTargets, the exercises of the program for the
 * collected targets (exercise-targets 5.8 steps 1 and 4 to 8): the eligible pool (programPool) with the
 * check's own contraindications (the range profile, the gait plan, the kept day answers and the walk,
 * D-026 item 9), the position fit (seated forms for people who do not stand, the wheelchair rules), pain
 * friendly items on the pain paths, the caps (2 items a finding, half a session's slots), the region
 * filters last, the session order and the dose profiles with the hold of the steps (E1-8); the camera's
 * sit to stand is never a card beside the camera movement (E1-7).
 */
import { describe, expect, it } from "vitest";
import { wordingProblems } from "../../scripts/wording-rules.mjs";
import { regionOfTarget } from "../../src/medical/contraindications";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { createPlan, type Intake, type Plan } from "../../src/medical/plan";
import { LIBRARY, libraryById, programPool } from "../../src/medical/pool";
import type { RomProfile, RomProfileEntry } from "../../src/medical/rom-types";
import type { TargetRequest, TargetedItem } from "../../src/medical/target-types";
import {
  PAIN_STABLE_ISOMETRICS,
  SESSION_SLOTS,
  collectTargets,
  findingSlots,
  selectForTargets,
  type TargetContext,
} from "../../src/medical/targets";
import { TARGETS_DATA, doseProfile } from "../../src/movements/targets";
import { FAHD, entry, finding, intake, pattern } from "./e-fixtures";

const NUMBERS = TARGETS_DATA.mapping.selectionNumbers;
const req = (over: Partial<TargetRequest> & Pick<TargetRequest, "id">): TargetRequest => ({
  side: "right",
  priority: 2,
  painFriendlyOnly: false,
  reasons: [{ kind: "rom", movementId: "knee_flexion", side: "right", finding: "mild", path: "weak" }],
  evidence: "High",
  ...over,
});
const planOf = (h: Intake): Plan => {
  const p = createPlan(h);
  if (p.status !== "ready") throw new Error(`plan in review: ${p.reasons.join(", ")}`);
  return p;
};
const select = (h: Intake, targets: TargetRequest[], ctx: TargetContext = {}, plan = planOf(h)) =>
  selectForTargets(h, plan, programPool(h), targets, ctx);
const itemFor = (out: { items: TargetedItem[] }, id: string) =>
  out.items.find((i) => i.targets.includes(id as never));
const positionsOf = (id: string) => libraryById(id)!.positions ?? [];
const SEATED = ["seated", "seated_forward"];
const STANDING = ["standing", "standing_supported"];

describe("the items of a target", () => {
  it("picks an item that covers the target, its primary role first, and carries its reasons and why", () => {
    const out = select(intake(), [req({ id: "strengthen:quadriceps" })]);
    const item = itemFor(out, "strengthen:quadriceps")!;
    const e = libraryById(item.exerciseId)!;
    expect(e.targets!.find((t) => t.id === "strengthen:quadriceps")!.role).toBe("primary");
    expect(item.reasons).toEqual([
      { kind: "rom", movementId: "knee_flexion", side: "right", finding: "mild", path: "weak" },
    ]);
    expect(item.why.en).toBe(
      "Because your knee bend on the right side was below typical, we added this exercise.",
    );
    expect(item.dose).toMatchObject({
      id: item.exerciseId,
      targets: ["strengthen:quadriceps"],
      why: item.why,
    });
    expect(item.dose.reasonRefs).toEqual(item.reasons);
    expect(out.unmet).toEqual([]);
  });

  it("one exercise that covers two chosen targets fills one slot and carries every reason", () => {
    const knee = {
      kind: "rom" as const,
      movementId: "knee_extension" as const,
      side: "right" as const,
      finding: "mild" as const,
      path: "weak" as const,
    };
    const out = select(intake(), [
      req({ id: "mobility:knee_extension", reasons: [knee] }),
      req({ id: "strengthen:quadriceps", reasons: [knee] }),
    ]);
    // seated_leg_extensions has both as primary targets.
    const both = out.items.filter(
      (i) => i.targets.includes("mobility:knee_extension") && i.targets.includes("strengthen:quadriceps"),
    );
    expect(both.length).toBeGreaterThan(0);
  });

  it("reports a target no safe item covers as unmet", () => {
    const support = intake({ restrictions: ["balance_support"] });
    const out = select(support, [
      req({
        id: "balance:single_leg_stance",
        reasons: [
          {
            kind: "gait",
            pattern: "trendelenburg",
            label: "trendelenburg",
            side: "right",
            status: "likely",
            confidence: "high",
          },
        ],
      }),
    ]);
    expect(out.items).toEqual([]);
    expect(out.unmet.map((t) => t.id)).toEqual(["balance:single_leg_stance"]);
  });
});

describe("the position fit (exercise-targets 5.8 step 4)", () => {
  it("a person who does not stand gets seated forms only", () => {
    const seated = intake({ mobility: "seated", walking: { status: "no" } });
    for (const id of [
      "strengthen:quadriceps",
      "strengthen:hip_abductors",
      "mobility:knee_flexion",
      "strengthen:hamstrings",
    ]) {
      const item = itemFor(select(seated, [req({ id: id as TargetRequest["id"] })]), id);
      expect(item, id).toBeDefined();
      expect(
        positionsOf(item!.exerciseId).some((p) => SEATED.includes(p)),
        id,
      ).toBe(true);
    }
    // glute_squeeze and quad_set keep their seated form (review C14).
    const quad = select(seated, [req({ id: "strengthen:quadriceps", painFriendlyOnly: true })]);
    expect(["seated_leg_extensions", "quad_set"]).toContain(
      itemFor(quad, "strengthen:quadriceps")!.exerciseId,
    );
  });

  it("a person who stands gets a standing item for a weight bearing target, the seated item otherwise", () => {
    const stands = intake();
    const hip = itemFor(
      select(stands, [req({ id: "strengthen:hip_abductors" })]),
      "strengthen:hip_abductors",
    )!;
    expect(positionsOf(hip.exerciseId).some((p) => STANDING.includes(p))).toBe(true);
    const elbow = itemFor(
      select(stands, [
        req({
          id: "strengthen:elbow_flexors",
          reasons: [
            { kind: "rom", movementId: "elbow_flexion", side: "right", finding: "mild", path: "weak" },
          ],
        }),
      ]),
      "strengthen:elbow_flexors",
    )!;
    expect(positionsOf(elbow.exerciseId)).toContain("seated");
  });

  it("a wheelchair user gets wheelchair friendly items only, unless the transfer to a steady chair is yes", () => {
    const chair = intake({ mobility: "wheelchair", walking: { status: "no" }, equipment: ["bands"] });
    const out = select(chair, [req({ id: "strengthen:hamstrings" })]);
    for (const i of out.items) expect(libraryById(i.exerciseId)!.tags).toContain("wheelchair_friendly");
    expect(out.unmet.map((t) => t.id)).toEqual(["strengthen:hamstrings"]);
    const transfer = { ...chair, romFlags: { osteoporosis: false, neckCaution: false, transferChair: true } };
    expect(
      itemFor(select(transfer, [req({ id: "strengthen:hamstrings" })]), "strengthen:hamstrings"),
    ).toBeDefined();
  });

  it("items near the front of a chair only for a person who sits without the backrest (sitting_balance)", () => {
    const sits = intake({
      mobility: "seated",
      walking: { status: "no" },
      romFlags: { osteoporosis: false, neckCaution: false, sitUnsupported: "no" },
    });
    const out = select(sits, [req({ id: "stretch:hamstrings" })]);
    for (const i of out.items) expect(positionsOf(i.exerciseId)).not.toEqual(["seated_forward"]);
  });

  it("pain friendly items only on a pain path; the pain_stable strengthening isometrics first", () => {
    expect(TARGETS_DATA.mapping.paths.find((p) => p.path === "pain_stable")!.plus).toContain(
      `isometrics marked pain friendly first (${PAIN_STABLE_ISOMETRICS.join(", ")})`,
    );
    const pain = {
      kind: "rom" as const,
      movementId: "knee_flexion" as const,
      side: "right" as const,
      finding: "pain_limited" as const,
      path: "pain_stable" as const,
    };
    const out = select(intake(), [
      req({ id: "mobility:knee_flexion", painFriendlyOnly: true, priority: 3, reasons: [pain] }),
      req({ id: "strengthen:quadriceps", painFriendlyOnly: true, priority: 3, reasons: [pain] }),
    ]);
    for (const i of out.items) expect(libraryById(i.exerciseId)!.painFriendly, i.exerciseId).toBe(true);
    expect(itemFor(out, "strengthen:quadriceps")!.exerciseId).toBe("quad_set");
  });

  it("a shoulder that cannot move on its own gets the self assisted table slides only", () => {
    const out = select(intake(), [
      req({
        id: "mobility:shoulder_flexion",
        priority: 1,
        reasons: [
          { kind: "rom", movementId: "shoulder_flexion", side: "right", finding: "unknown", path: "umn" },
        ],
      }),
    ]);
    expect(out.items.map((i) => i.exerciseId)).toEqual(["table_slides"]);
  });
});

describe("the check's own contraindications (D-026 item 9)", () => {
  const sideBend = [
    req({
      id: "mobility:trunk_lateral_flexion",
      side: "left",
      reasons: [
        { kind: "rom", movementId: "trunk_lateral_flexion", side: "left", finding: "mild", path: "tight" },
      ],
    }),
  ];
  const leans = ["side_bend", "seated_side_reach"];
  const sideBendItems = (ctx: TargetContext, h = intake({ mobility: "seated", walking: { status: "no" } })) =>
    select(h, sideBend, ctx).items.map((i) => i.exerciseId);

  it("the day's pusher, armrests and seated lean answers close the seated side bends", () => {
    expect(sideBendItems({ today: { painByRegion: {} } }).some((id) => leans.includes(id))).toBe(true);
    for (const today of [
      { painByRegion: {}, pusher: true },
      { painByRegion: {}, armrests: false },
      { painByRegion: {}, seatedLean: { fellSitting: true } },
      { painByRegion: {}, seatedLean: { pressureSore: true } },
      { painByRegion: {}, seatedLean: { sitsUnsupported: "unsure" as const } },
      { painByRegion: { back_trunk: 6 } },
    ])
      expect(
        sideBendItems({ today }).some((id) => leans.includes(id)),
        JSON.stringify(today),
      ).toBe(false);
  });

  it("the walk's recurvatum closes the knee straightening stretch on a footstool", () => {
    const t = [
      req({
        id: "stretch:hamstrings",
        reasons: [
          { kind: "rom", movementId: "knee_extension", side: "right", finding: "mild", path: "tight" },
        ],
      }),
    ];
    const h = intake();
    const without = select(h, t).items.map((i) => i.exerciseId);
    expect(without).toContain("knee_straighten_stretch_stool");
    const recurvatum = pattern({
      pattern: "recurvatum",
      side: "right",
      status: "possible",
      confidence: "low",
    });
    expect(select(h, t, { gait: [recurvatum] }).items.map((i) => i.exerciseId)).not.toContain(
      "knee_straighten_stretch_stool",
    );
  });

  it("a leg limb loss without the prosthesis today closes the standing forms", () => {
    const h = intake({
      conditions: ["lower_limb_unilateral"],
      regions: [entry("ankle_foot", "left", ["limb_loss"], { limbLoss: { level: "below_knee" } })],
    });
    const t = [req({ id: "strengthen:hip_abductors", side: "left" })];
    const on = select(h, t, { today: { painByRegion: {}, prosthesisOn: true } }).items;
    const off = select(h, t, { today: { painByRegion: {}, prosthesisOn: false } }).items;
    expect(on.some((i) => positionsOf(i.exerciseId).some((p) => STANDING.includes(p)))).toBe(true);
    expect(off.every((i) => !positionsOf(i.exerciseId).every((p) => STANDING.includes(p)))).toBe(true);
  });

  it("the profile's red flag region and weak shoulder (v7Contraindications with the profile)", () => {
    const entryOf = (over: Partial<RomProfileEntry>): RomProfileEntry => ({
      movementId: "shoulder_flexion",
      side: "right",
      region: "shoulder",
      source: "not_measured_today",
      kind: "flexion",
      value: null,
      typical: null,
      percentOfNormal: null,
      z: null,
      finding: "not_today",
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
      checkId: "c1",
      ...over,
    });
    const profile = (reason: RomProfileEntry["reason"]): RomProfile => ({
      sex: "female",
      age: 52,
      normsVersion: "n",
      created: 1,
      entries: [entryOf({ reason })],
    });
    const t = [req({ id: "mobility:shoulder_flexion" })];
    expect(select(intake(), t, { profile: profile("red_flag") }).items).toEqual([]);
    const weak = select(intake(), [req({ id: "strengthen:shoulder_flexors" })], {
      profile: profile("weak_shoulder"),
    });
    for (const i of weak.items)
      expect(libraryById(i.exerciseId)!.v7Contraindications ?? []).not.toContain("weak_shoulder");
  });

  it("the gait plan's walk and pad answers", () => {
    const plan: GaitPlan = {
      offered: false,
      reason: "not_walking",
      modes: [],
      defaultMode: "overground",
      padAllowed: false,
      helperRequired: false,
      antalgicOnly: false,
      staticStance: false,
      views: { overground: [], walking_pad: [] },
    };
    const out = select(intake(), [req({ id: "practice:walking", side: "both" })], { gaitPlan: plan });
    expect(out.items.map((i) => i.exerciseId)).not.toContain("walking_practice");
  });
});

describe("the camera's sit to stand (E1-7)", () => {
  it("is never a card when the plan's camera part has sit_to_stand", () => {
    const h = intake({ goal: "mobility" });
    const plan = planOf(h);
    expect(plan.exercises.map((e) => e.exerciseId)).toContain("sit_to_stand");
    const t = [
      req({ id: "strengthen:quadriceps" }),
      req({ id: "practice:sit_to_stand" as TargetRequest["id"] }),
    ];
    const out = select(h, t, {}, plan);
    expect(out.items.map((i) => i.exerciseId)).not.toContain("sit_to_stand");
    const noCamera = { ...plan, exercises: plan.exercises.filter((e) => e.exerciseId !== "sit_to_stand") };
    expect(
      select(h, [req({ id: "practice:sit_to_stand" as TargetRequest["id"] })], {}, noCamera).items.map(
        (i) => i.exerciseId,
      ),
    ).toContain("sit_to_stand");
  });
});

describe("the caps (exercise-targets 5.8 step 5)", () => {
  it("at most 2 items for one finding", () => {
    expect(NUMBERS.itemsPerFindingMax).toBe(2);
    const reason = {
      kind: "rom" as const,
      movementId: "knee_flexion" as const,
      side: "right" as const,
      finding: "marked" as const,
      path: "rehab" as const,
    };
    const out = select(intake(), [
      req({ id: "mobility:knee_flexion", priority: 3, reasons: [reason] }),
      req({ id: "strengthen:hamstrings", priority: 3, reasons: [reason] }),
      req({ id: "stretch:quadriceps", priority: 1, reasons: [reason] }),
    ]);
    expect(out.items.length).toBeLessThanOrEqual(NUMBERS.itemsPerFindingMax);
    // The cap is shared among the finding's actions: its range work is never left out.
    expect(itemFor(out, "mobility:knee_flexion")).toBeDefined();
    expect(itemFor(out, "strengthen:hamstrings")).toBeDefined();
  });

  it("the arthritis add on has its own cap: a painful knee keeps its gentle range work", () => {
    const h = intake({
      conditions: ["arthritis"],
      regions: [entry("knee", "left", ["pain"])],
      pain: ["knee"],
    });
    const targets = collectTargets({
      intake: h,
      rom: [
        finding("knee_flexion", "left", { finding: "pain_limited", priority: 3, path: "pain_irritable" }),
      ],
      gait: [],
    }).targets;
    const out = select(h, targets);
    expect(itemFor(out, "mobility:knee_flexion")).toBeDefined();
    expect(itemFor(out, "strengthen:quadriceps")).toBeDefined();
    for (const i of out.items) expect(libraryById(i.exerciseId)!.painFriendly, i.exerciseId).toBe(true);
    // The add on's items say why_arthritis, the knee's own range work its pain line (E2-9).
    const arthritis = TARGETS_DATA.whyLines.find((w) => w.id === "why_arthritis")!;
    expect(itemFor(out, "strengthen:quadriceps")!.why.en).toBe(arthritis.en);
    expect(itemFor(out, "mobility:knee_flexion")!.why.en).not.toBe(arthritis.en);
  });

  it("a finding with one action and two items a grade takes both (a pain limited range)", () => {
    const pain = {
      kind: "rom" as const,
      movementId: "knee_flexion" as const,
      side: "right" as const,
      finding: "pain_limited" as const,
      path: "pain_irritable" as const,
    };
    const out = select(intake(), [
      req({ id: "mobility:knee_flexion", priority: 3, painFriendlyOnly: true, reasons: [pain] }),
    ]);
    expect(out.items.filter((i) => i.targets.includes("mobility:knee_flexion"))).toHaveLength(2);
  });

  it("finding items fill at most half of a session's slots, rounded down: its cards and camera movements", () => {
    expect(SESSION_SLOTS).toBe(7);
    // Without a camera movement, 3 of the 7 cards; with two, 4 of the 9 exercises.
    expect(findingSlots({ exercises: [] })).toBe(Math.floor(SESSION_SLOTS * NUMBERS.findingSlotsShareMax));
    expect(findingSlots({ exercises: [] })).toBe(3);
    const h = FAHD;
    const perDay = findingSlots(planOf(h));
    expect(planOf(h).exercises).toHaveLength(2);
    expect(perDay).toBe(4);
    const targets = collectTargets({
      intake: h,
      rom: [
        finding("shoulder_flexion", "right", { finding: "marked", priority: 3, path: "umn" }),
        finding("elbow_extension", "right", { finding: "marked", priority: 3, path: "umn" }),
        finding("knee_flexion", "right", { finding: "marked", priority: 3, path: "umn" }),
        finding("knee_extension", "right", { finding: "mild", priority: 2, path: "umn" }),
      ],
      gait: [],
    }).targets;
    const out = select(h, targets);
    const ids = new Set(out.items.map((i) => i.exerciseId));
    for (const day of out.selection.days) {
      const finding = [...day.warmup, ...day.extra, ...day.cooldown].filter((id) => ids.has(id));
      expect(finding.length).toBeLessThanOrEqual(perDay);
    }
    expect(out.items.length).toBeGreaterThan(perDay);
  });
});

describe("the days of each exercise (exercise-targets 2.1 daysPerWeek)", () => {
  const fahdTargets = () =>
    collectTargets({
      intake: FAHD,
      rom: [
        finding("shoulder_flexion", "right", { finding: "marked", priority: 3, path: "umn" }),
        finding("elbow_extension", "right", { finding: "marked", priority: 3, path: "umn" }),
        finding("knee_flexion", "right", { finding: "marked", priority: 3, path: "umn" }),
        finding("knee_extension", "right", { finding: "mild", priority: 2, path: "umn" }),
      ],
      gait: [],
    }).targets;
  const daysOf = (out: ReturnType<typeof select>, id: string) =>
    out.selection.days.filter((d) => [...d.warmup, ...d.extra, ...d.cooldown].includes(id)).length;

  it("does each exercise on at least 2 of the training days, rather than many exercises once", () => {
    const out = select(FAHD, fahdTargets());
    expect(out.items.length).toBeGreaterThan(0);
    for (const i of out.items) expect(daysOf(out, i.exerciseId), i.exerciseId).toBeGreaterThanOrEqual(2);
    // What no longer fits is unmet, never under dosed.
    expect(out.unmet.length).toBeGreaterThan(0);
  });

  it("never puts a strengthening exercise on two days in a row", () => {
    const h = { ...FAHD, days: [0, 1, 2, 3] };
    const plan = { ...planOf(FAHD), days: [0, 1, 2, 3] };
    const out = select(h, fahdTargets(), {}, plan);
    for (const i of out.items) {
      if (!i.targets[0].startsWith("strengthen:")) continue;
      const on = plan.days.filter((_, d) => {
        const day = out.selection.days[d];
        return [...day.warmup, ...day.extra, ...day.cooldown].includes(i.exerciseId);
      });
      for (let k = 1; k < on.length; k++) expect(on[k] - on[k - 1], i.exerciseId).toBeGreaterThan(1);
    }
  });

  it("walking practice comes on 3 days when the week has them", () => {
    const walk = [
      req({
        id: "practice:walking",
        side: "both",
        reasons: [
          {
            kind: "gait",
            pattern: "short_steps",
            label: "short_steps",
            side: "both",
            status: "likely",
            confidence: "high",
          },
        ],
      }),
    ];
    const out = select(intake(), walk);
    expect(daysOf(out, "walking_practice")).toBe(3);
  });
});

describe("region filters run last (review C01)", () => {
  it("a rotator cuff repair 5 weeks ago with weights in the intake gives no shoulder raises or presses", () => {
    const repair = entry("shoulder", "right", ["after_surgery"], {
      surgery: { since: "lt6w", cleared: "yes", avoid: [], stretchAllowed: "no", loadAllowed: "no" },
    });
    const h = intake({ equipment: ["weights", "bands"], goal: "strength", regions: [repair] });
    const targets = collectTargets({
      intake: h,
      rom: [finding("shoulder_flexion", "right", { finding: "marked", priority: 3, path: "post_op_early" })],
      gait: [],
    }).targets;
    const out = select(h, targets);
    const week = new Set(out.selection.days.flatMap((d) => [...d.warmup, ...d.extra, ...d.cooldown]));
    expect(week.size).toBeGreaterThan(0);
    for (const id of week) {
      const e = libraryById(id)!;
      const loaded = (e.targets ?? []).some(
        (t) => t.role === "primary" && regionOfTarget(t.id) === "shoulder" && !t.id.startsWith("mobility:"),
      );
      expect(loaded, id).toBe(false);
    }
    for (const id of [
      "seated_shoulder_press",
      "seated_lateral_raises",
      "seated_front_raises",
      "seated_arnold_press",
      "chest_press",
      "shoulder_wall_press",
      "wall_push_ups",
    ])
      expect(week.has(id), id).toBe(false);
  });
});

describe("the session order and the dose (exercise-targets 2.1, 2.2, 5.8 steps 7 and 8)", () => {
  const h = intake({ age: 52 });
  const reason = (path: "weak" | "tight" | "pain_irritable" = "weak") => [
    {
      kind: "rom" as const,
      movementId: "knee_flexion" as const,
      side: "right" as const,
      finding: "mild" as const,
      path,
    },
  ];

  it("range of motion in the warm up, strengthening and balance in the day's exercises, held stretches last", () => {
    const out = select(h, [
      req({ id: "mobility:knee_flexion", reasons: reason() }),
      req({
        id: "strengthen:hip_abductors",
        reasons: [{ kind: "rom", movementId: "hip_abduction", side: "right", finding: "mild", path: "weak" }],
      }),
      req({
        id: "stretch:hip_flexors",
        reasons: [
          { kind: "rom", movementId: "hip_extension", side: "right", finding: "mild", path: "tight" },
        ],
      }),
    ]);
    const slot = (t: string) => itemFor(out, t)!.slot;
    expect(slot("mobility:knee_flexion")).toBe("warmup");
    expect(slot("strengthen:hip_abductors")).toBe("extra");
    expect(slot("stretch:hip_flexors")).toBe("cooldown");
    const day = out.selection.days[0];
    expect(day.warmup).toContain(itemFor(out, "mobility:knee_flexion")!.exerciseId);
    expect(day.cooldown).toContain(itemFor(out, "stretch:hip_flexors")!.exerciseId);
  });

  it("each profile's numbers: a held stretch 30 seconds twice under 65 and 60 seconds once from 65", () => {
    const stretch = doseProfile("stretch_hold").numbers;
    const young = itemFor(
      select(intake({ age: 52 }), [req({ id: "stretch:quadriceps", reasons: reason("tight") })]),
      "stretch:quadriceps",
    )!;
    // seated_knee_bend_slide's stretch, or standing_thigh_stretch: both held stretches here.
    expect(young.dose).toMatchObject({ holdSeconds: 30, sets: 2 });
    expect(stretch.holdSeconds).toEqual({ under65: 30, age65plus: 60 });
    const older = itemFor(
      select(intake({ age: 70 }), [req({ id: "stretch:quadriceps", reasons: reason("tight") })]),
      "stretch:quadriceps",
    )!;
    expect(older.dose).toMatchObject({ holdSeconds: 60, sets: 1 });
  });

  it("range repetitions, gentle range on the pain path, strength repetitions, isometric holds", () => {
    const range = itemFor(
      select(h, [req({ id: "mobility:knee_flexion", reasons: reason() })]),
      "mobility:knee_flexion",
    )!;
    expect(range.dose).toMatchObject({ reps: 10, sets: 1 });
    const pain = itemFor(
      select(h, [
        req({ id: "mobility:knee_flexion", painFriendlyOnly: true, reasons: reason("pain_irritable") }),
      ]),
      "mobility:knee_flexion",
    )!;
    expect(pain.dose).toMatchObject({ reps: 5, sets: 1 });
    const strength = itemFor(
      select(h, [req({ id: "strengthen:hamstrings", reasons: reason() })]),
      "strengthen:hamstrings",
    )!;
    const e = libraryById(strength.exerciseId)!;
    if (e.dose?.profile === "strength_isometric")
      expect(strength.dose).toMatchObject({ holdSeconds: 5, sets: 10 });
    else expect(strength.dose).toMatchObject({ reps: 10, sets: 1 });
  });

  it("walking practice and cued walking in minutes", () => {
    const walk = itemFor(
      select(h, [
        req({
          id: "practice:walking",
          side: "both",
          reasons: [
            {
              kind: "gait",
              pattern: "short_steps",
              label: "short_steps",
              side: "both",
              status: "likely",
              confidence: "high",
            },
          ],
        }),
      ]),
      "practice:walking",
    )!;
    expect(walk.exerciseId).toBe("walking_practice");
    expect(walk.dose).toMatchObject({ holdSeconds: 600, sets: 1 });
  });

  it("the plan's fatigue note lowers the sets and repetitions with the existing rules", () => {
    const ms = intake({ conditions: ["ms"], clearance: "yes" });
    const plan = planOf(ms);
    const out = select(ms, [req({ id: "mobility:knee_flexion", reasons: reason() })], {}, plan);
    const item = itemFor(out, "mobility:knee_flexion")!;
    if (plan.notes.includes("fatigue")) expect(item.dose.reps).toBeLessThan(10);
    else expect(item.dose.reps).toBe(10);
  });

  it("fills the steps' hold: 30 or 60 seconds, «لحظة» on the pain path (E1-8)", () => {
    const withHold = LIBRARY.filter((e) => e.steps.en.some((s) => s.includes("{hold_en}"))).map((e) => e.id);
    const t = [req({ id: "stretch:quadriceps", reasons: reason("tight") })];
    const item = itemFor(select(intake({ age: 40 }), t), "stretch:quadriceps")!;
    expect(withHold).toContain(item.exerciseId);
    expect(item.dose.hold).toEqual({ ar: "٣٠ ثانية", en: "30 seconds" });
    expect(itemFor(select(intake({ age: 66 }), t), "stretch:quadriceps")!.dose.hold).toEqual({
      ar: "٦٠ ثانية",
      en: "60 seconds",
    });
    const pain = itemFor(
      select(intake(), [
        req({ id: "mobility:knee_flexion", painFriendlyOnly: true, reasons: reason("pain_irritable") }),
      ]),
      "mobility:knee_flexion",
    )!;
    if (withHold.includes(pain.exerciseId)) expect(pain.dose.hold).toEqual({ ar: "لحظة", en: "a moment" });
    // An item without the placeholder carries none.
    const range = itemFor(select(h, [req({ id: "strengthen:quadriceps" })]), "strengthen:quadriceps")!;
    if (!withHold.includes(range.exerciseId)) expect(range.dose.hold).toBeUndefined();
  });
});

describe("every selection", () => {
  it("passes the wording rules in its why lines and keeps the pool's items only", () => {
    const h = FAHD;
    const targets = collectTargets({
      intake: h,
      rom: [
        finding("shoulder_flexion", "right", { finding: "marked", priority: 3, path: "umn" }),
        finding("knee_flexion", "right", { finding: "pain_limited", priority: 3, path: "pain_stable" }),
      ],
      gait: [
        pattern({
          pattern: "stiff_knee",
          targets: [
            { id: "strengthen:calf", side: "right" },
            { id: "practice:push_off", side: "right" },
          ],
        }),
      ],
    }).targets;
    const pool = new Set(programPool(h).map((e) => e.id));
    const out = select(h, targets);
    expect(out.items.length).toBeGreaterThan(0);
    for (const i of out.items) {
      expect(pool.has(i.exerciseId), i.exerciseId).toBe(true);
      for (const lang of ["ar", "en"] as const) expect(wordingProblems(i.why[lang])).toEqual([]);
    }
    expect(select(h, targets)).toEqual(out);
  });
});
