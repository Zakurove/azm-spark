/**
 * Stream D, step D2: the coach's instruction and history inputs from stored state (product v7
 * contract 5.1 and C-12, server/modules/agent/context.ts): who is with the person, the walk's views
 * without the near side, the rest of a workout from its current step, and a person whose every
 * private field is set, of which nothing reaches the instruction or the history.
 */
import { describe, expect, it } from "vitest";
import {
  checkContext,
  helperPresent,
  remainingExercises,
  workoutContext,
} from "../../server/modules/agent/context";
import type { CheckSegment } from "../../server/modules/agent/segments";
import type { FocusCheck } from "../../server/modules/focus/store";
import type { RunPlan } from "../../server/guided";
import { buildHistory, buildInstruction } from "../../src/coach/instruction";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import type { Intake } from "../../src/medical/plan";
import type { RomProtocolItem } from "../../src/medical/rom-protocol";
import { typicalValue } from "../../src/medical/rom-norms";
import type { SessionStep } from "../../src/medical/session";
import type { WeeklyItem } from "../../src/medical/weekly";

const INTAKE: Intake = {
  age: 61,
  conditions: ["stroke", "parkinsons"],
  diagnosisNotes: "PRIVATE DIAGNOSIS NOTE",
  medications: "Warfarin PRIVATE MEDICATION",
  mobility: "standing",
  support: "right",
  pain: ["knee"],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: ["chair"],
  goal: "habit",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
  sex: "female",
  regions: [{ region: "shoulder", side: "right", problems: ["weakness"], origin: "condition" }],
  walking: { status: "with_aid", aid: "walker" },
  heightCm: 163,
};

const ITEM: RomProtocolItem = {
  movementId: "shoulder_flexion",
  side: "right",
  region: "shoulder",
  position: "seated",
  block: "seated",
  order: 1,
  priority: "core",
  verdict: "measure",
  normId: "PRIVATE_NORM_ID",
  graded: true,
  askCanMove: true,
  helperRequired: false,
  approximate: false,
};

const GAIT: GaitPlan = {
  offered: true,
  modes: ["overground", "walking_pad"],
  defaultMode: "overground",
  padAllowed: true,
  helperRequired: true,
  antalgicOnly: false,
  staticStance: false,
  views: {
    overground: ["front", "back", "side"],
    walking_pad: [
      { view: "pad_side", nearSide: "right" },
      { view: "pad_side", nearSide: "left" },
      { view: "pad_front" },
    ],
  },
};

function check(over: Partial<FocusCheck> = {}): FocusCheck {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    userId: "u1",
    kind: "baseline",
    setting: "home",
    status: "open",
    protocol: { rulesVersion: "r", items: [ITEM], deferred: [], notMeasured: [], sitBeforeStand: false },
    gaitPlan: GAIT,
    today: { painByRegion: { knee: 3 } },
    precheck: {},
    versions: { rom: "r", norms: "n", gait: "g", targets: "t", romEngine: "re", gaitEngine: "ge" },
    device: { os: "iOS", browser: "Safari" },
    intakeVersion: 1,
    started: 0,
    active: 0,
    completed: null,
    endedReason: null,
    ...over,
  };
}
const ROM_SEG: CheckSegment = { block: "rom", segment: "rom:seated:1", position: "seated", items: [ITEM] };
const GAIT_SEG: CheckSegment = { block: "gait", segment: "gait" };

describe("helperPresent", () => {
  it("is the day's pc_helper answer at home and always true at the booth, where the staff stand beside", () => {
    expect(helperPresent(check())).toBe(false);
    expect(helperPresent(check({ today: { painByRegion: {}, helperPresent: true } }))).toBe(true);
    expect(helperPresent(check({ setting: "booth" }))).toBe(true);
  });
});

describe("checkContext", () => {
  it("gives a range segment its block position and the items with the person's typical values", () => {
    const ctx = checkContext(check(), INTAKE, ROM_SEG, "en");
    expect(ctx.instruction).toEqual({ lang: "en", block: "rom", position: "seated", helperPresent: false });
    expect(ctx.history).toEqual({
      block: "rom",
      lang: "en",
      segment: "rom:seated:1",
      helperPresent: false,
      items: [
        {
          movement: "shoulder_flexion",
          side: "right",
          position: "seated",
          typical: typicalValue("shoulder_flexion", "female", 61, "right"),
        },
      ],
    });
    expect(checkContext(check(), { ...INTAKE, sex: undefined }, ROM_SEG, "en").history).toMatchObject({
      items: [{ typical: null }],
    });
  });

  it("sends no typical for a position without a graded norm (4.3 rule 7), never another position's", () => {
    const seatedBend: RomProtocolItem = {
      ...ITEM,
      movementId: "trunk_flexion",
      side: "none",
      region: "back_trunk",
      position: "seated",
      graded: false,
    };
    const seg = { ...ROM_SEG, items: [seatedBend] } as CheckSegment;
    expect(checkContext(check(), INTAKE, seg, "en").history).toMatchObject({
      items: [{ movement: "trunk_flexion", position: "seated", typical: null }],
    });
  });

  it("gives the walk its modes, the views without the near side (it would name the affected side), the aid and the helper", () => {
    const ctx = checkContext(check({ setting: "booth" }), INTAKE, GAIT_SEG, "ar");
    expect(ctx.instruction).toEqual({ lang: "ar", block: "gait", position: "walking", helperPresent: true });
    expect(ctx.history).toEqual({
      block: "gait",
      lang: "ar",
      segment: "gait",
      modes: ["overground", "walking_pad"],
      views: { overground: ["front", "back", "side"], walking_pad: ["pad_side", "pad_side", "pad_front"] },
      aid: "walker",
      helperPresent: true,
    });
    expect(
      checkContext(check(), { ...INTAKE, walking: { status: "without_aid" } }, GAIT_SEG, "ar").history,
    ).toMatchObject({ aid: "none" });
  });
});

describe("the rest of a workout", () => {
  const card = (id: string, over: Partial<WeeklyItem> = {}): WeeklyItem => ({
    id,
    sets: 2,
    reps: 10,
    ...over,
  });
  const press = {
    exerciseId: "seated_shoulder_press",
    setup: { position: "chair" as const, support: "none" as const },
    sets: 2,
    reps: 8,
    restSeconds: 60,
    reason: "PRIVATE REASON",
  };
  const steps: SessionStep[] = [
    { kind: "card", slot: "warmup", item: card("arm_circles", { reps: undefined }) },
    { kind: "camera", prescription: press, setNumber: 1 },
    { kind: "camera", prescription: press, setNumber: 2 },
    { kind: "card", slot: "extra", item: card("shoulder_stretch", { reps: undefined, holdSeconds: 20 }) },
    { kind: "card", slot: "cooldown", item: card("neck_stretches", { sets: 1, reps: 5 }) },
  ];

  it("lists each exercise once from the current step on, with the dose the screen shows", () => {
    expect(remainingExercises(steps, 0, 45)).toEqual([
      { exerciseId: "arm_circles", sets: 2, reps: 8, restSeconds: 45 },
      { exerciseId: "seated_shoulder_press", sets: 2, reps: 8, restSeconds: 60 },
      { exerciseId: "shoulder_stretch", sets: 2, holdSeconds: 20, restSeconds: 45 },
      { exerciseId: "neck_stretches", sets: 1, reps: 5, restSeconds: 45 },
    ]);
    expect(remainingExercises(steps, 2, 45).map((e) => e.exerciseId)).toEqual([
      "seated_shoulder_press",
      "shoulder_stretch",
      "neck_stretches",
    ]);
    expect(remainingExercises(steps, 9, 45)).toEqual([]);
  });

  it("makes a workout part with no position and no helper, from the stored plan's day", () => {
    const run = {
      status: "ready",
      reasons: [],
      notes: [],
      exclusions: [],
      exercises: [press],
      days: [0, 2, 4],
      time: "09:00",
      warmUpMinutes: 5,
      coolDownMinutes: 5,
      estimatedMinutes: 30,
      recoveryHours: 24,
      restSeconds: 60,
      today: {
        day: 0,
        warmup: [card("arm_circles")],
        extra: [],
        cooldown: [],
        restSeconds: 50,
      },
    } as RunPlan;
    const ctx = workoutContext(run, 0, "session:1", "en");
    expect(ctx.instruction).toEqual({ lang: "en", block: "session", position: null, helperPresent: false });
    expect(ctx.history).toEqual({
      block: "session",
      lang: "en",
      segment: "session:1",
      exercises: [
        { exerciseId: "arm_circles", sets: 2, reps: 10, restSeconds: 50 },
        { exerciseId: "seated_shoulder_press", sets: 2, reps: 8, restSeconds: 60 },
      ],
    });
  });

  it("C-12: sends nothing private of a person whose every field is set", () => {
    const why = { ar: "سبب خاص جدا", en: "PRIVATE WHY LINE" };
    const run = {
      status: "ready",
      reasons: ["PRIVATE PLAN REASON"],
      notes: ["PRIVATE PLAN NOTE"],
      exclusions: [{ exerciseId: "x", reason: "PRIVATE EXCLUSION" }],
      exercises: [press],
      days: [0],
      time: "09:00",
      warmUpMinutes: 5,
      coolDownMinutes: 5,
      estimatedMinutes: 30,
      recoveryHours: 24,
      today: {
        day: 0,
        warmup: [{ ...card("arm_circles"), why, note: why }],
        extra: [],
        cooldown: [],
        restSeconds: 50,
      },
    } as RunPlan;
    const contexts = (["ar", "en"] as const).flatMap((lang) => [
      checkContext(check({ today: { painByRegion: { knee: 7 } } }), INTAKE, ROM_SEG, lang),
      checkContext(check(), INTAKE, GAIT_SEG, lang),
      workoutContext(run, 0, "session:1", lang),
    ]);
    const sent = contexts
      .map((c) => [buildInstruction(c.instruction), ...buildHistory(c.history).map((t) => t.text)].join("\n"))
      .join("\n");
    for (const secret of ["PRIVATE", "Warfarin", "سبب خاص", "female", "parkinsons", "knee=7", "pain="])
      expect(sent, secret).not.toContain(secret);
    // No age, height, sex, condition list or pain score as a field or a number of its own.
    for (const word of [/\b61\b/, /\b163\b/, /\bage\b/i, /\bsex\b/i, /\bconditions\b/i, /\bheight/i])
      expect(sent, String(word)).not.toMatch(word);
  });
});
