/**
 * The v7 intake fields (product v7 contract 2.2, 8.1 A): validateIntake keeps accepting an intake
 * without them, and validates each one when it is present (sex, regions, walking, heightCm,
 * romFlags), with the cross field rules: mobility bed walks no, and the pain mirror (every body map
 * entry with pain or injury in a region with a v1 pain id appears in pain[], which the v1 pool reads).
 */
import { describe, expect, it } from "vitest";
import { createPlan, hasV7Fields, validateIntake, type Intake } from "../../src/medical/plan";
import type { RegionEntry } from "../../src/medical/body-map";

const v1: Intake = {
  age: 58,
  conditions: ["stroke"],
  diagnosisNotes: "",
  medications: "",
  mobility: "standing",
  support: "right",
  pain: [],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: [],
  goal: "mobility",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
};

const weakRight: RegionEntry[] = (
  ["shoulder", "elbow", "forearm_wrist", "hip", "knee", "ankle_foot"] as const
).map((region) => ({ region, side: "right", problems: ["weakness"], origin: "condition" }));

/** The showcase persona's intake (D-020): weaker right side after a stroke, walks without an aid. */
const v7: Intake = {
  ...v1,
  sex: "male",
  regions: weakRight,
  walking: { status: "without_aid" },
  heightCm: 172,
  romFlags: { osteoporosis: false, neckCaution: false, sitUnsupported: "yes", footLift: { right: true } },
};

const valid = (patch: Record<string, unknown>) => validateIntake({ ...v7, ...patch });

describe("intakes saved before v7", () => {
  it("pass exactly as before, and plan the same", () => {
    expect(validateIntake(v1)).toBe(true);
    expect(hasV7Fields(v1)).toBe(false);
    for (const patch of [{ consent: false }, { age: 17 }, { pain: ["soul"] }, { mobility: "flying" }])
      expect(validateIntake({ ...v1, ...patch })).toBe(false);
    const stripped: Record<string, unknown> = { ...v7 };
    for (const k of ["sex", "regions", "walking", "heightCm", "romFlags"]) delete stripped[k];
    expect(stripped).toEqual(v1);
    expect(createPlan(v7)).toEqual(createPlan(v1));
  });
});

describe("the v7 fields", () => {
  it("accept the full v7 intake, which has every field the focus check needs", () => {
    expect(validateIntake(v7)).toBe(true);
    expect(hasV7Fields(v7)).toBe(true);
  });

  it("are each optional on their own", () => {
    expect(validateIntake({ ...v1, sex: "female" })).toBe(true);
    expect(hasV7Fields({ ...v1, sex: "female" })).toBe(false);
    expect(validateIntake({ ...v1, regions: [] })).toBe(true);
    expect(hasV7Fields({ ...v1, sex: "female", regions: [], walking: { status: "no" } })).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ["an unknown sex", { sex: "other" }],
    ["a null sex", { sex: null }],
    ["regions that are not a list", { regions: {} }],
    [
      "an invalid region entry",
      { regions: [{ region: "knee", side: "axial", problems: ["pain"], origin: "person" }] },
    ],
    ["walking without a status", { walking: {} }],
    ["an unknown walking status", { walking: { status: "sometimes" } }],
    ["walking with an aid but no aid", { walking: { status: "with_aid" } }],
    ["an unknown aid", { walking: { status: "with_aid", aid: "wheelchair" } }],
    ["an aid without the with_aid status", { walking: { status: "without_aid", aid: "cane" } }],
    ["an unknown walking key", { walking: { status: "no", since: 3 } }],
    ["a height under 120", { heightCm: 119 }],
    ["a height over 220", { heightCm: 221 }],
    ["a height that is not whole", { heightCm: 170.5 }],
    ["a height as text", { heightCm: "170" }],
    ["flags without the bones answer", { romFlags: { neckCaution: false } }],
    ["flags with an unknown key", { romFlags: { osteoporosis: false, neckCaution: false, dizzy: true } }],
    [
      "an unknown arthritis type answer",
      { romFlags: { osteoporosis: false, neckCaution: false, inflammatoryArthritis: "maybe" } },
    ],
    [
      "a neck clearance as text",
      { romFlags: { osteoporosis: false, neckCaution: false, neckCleared: "yes" } },
    ],
    [
      "a foot lift for a third foot",
      { romFlags: { osteoporosis: false, neckCaution: false, footLift: { middle: true } } },
    ],
    [
      "a foot lift as text",
      { romFlags: { osteoporosis: false, neckCaution: false, footLift: { left: "yes" } } },
    ],
    [
      "an unknown sitting balance answer",
      { romFlags: { osteoporosis: false, neckCaution: false, sitUnsupported: 1 } },
    ],
    [
      "a chair transfer as text",
      { romFlags: { osteoporosis: false, neckCaution: false, transferChair: "no" } },
    ],
  ])("reject %s", (_why, patch) => {
    expect(valid(patch)).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    ["female", { sex: "female" }],
    ["walking no", { walking: { status: "no" } }],
    ...(["cane", "crutches", "walker", "other"] as const).map((aid): [string, Record<string, unknown>] => [
      `walking with a ${aid}`,
      { walking: { status: "with_aid", aid } },
    ]),
    ["a height of 120", { heightCm: 120 }],
    ["a height of 220", { heightCm: 220 }],
    ["no height", { heightCm: undefined }],
    ["the smallest flags", { romFlags: { osteoporosis: true, neckCaution: true } }],
    [
      "every flag",
      {
        romFlags: {
          osteoporosis: false,
          neckCaution: false,
          inflammatoryArthritis: "unsure",
          neckCleared: true,
          footLift: { left: false, right: true },
          transferChair: false,
          sitUnsupported: "no",
        },
      },
    ],
  ])("accept %s", (_why, patch) => {
    expect(valid(patch)).toBe(true);
  });
});

describe("the cross field rules", () => {
  it("1. mobility bed walks no", () => {
    expect(valid({ mobility: "bed", walking: { status: "no" } })).toBe(true);
    expect(valid({ mobility: "bed", walking: { status: "without_aid" } })).toBe(false);
    expect(valid({ mobility: "bed", walking: { status: "with_aid", aid: "walker" } })).toBe(false);
    // Without the v7 walking answer a bed intake is a v1 intake, unchanged.
    expect(validateIntake({ ...v1, mobility: "bed" })).toBe(true);
  });

  it("2. a wheelchair user may walk short distances, with or without an aid", () => {
    expect(valid({ mobility: "wheelchair", walking: { status: "with_aid", aid: "walker" } })).toBe(true);
    expect(valid({ mobility: "wheelchair", walking: { status: "without_aid" } })).toBe(true);
  });

  const map = (
    region: RegionEntry["region"],
    problems: RegionEntry["problems"],
    extra: Partial<RegionEntry> = {},
  ) => [
    {
      region,
      side: region === "neck" || region === "back_trunk" ? ("axial" as const) : ("left" as const),
      problems,
      origin: "person" as const,
      ...extra,
    },
  ];

  it.each<[RegionEntry["region"], string]>([
    ["shoulder", "shoulder"],
    ["elbow", "elbow"],
    ["forearm_wrist", "wrist"],
    ["back_trunk", "back"],
    ["hip", "hip"],
    ["knee", "knee"],
  ])("3. pain in %s needs the v1 pain id %s in pain[]", (region, id) => {
    expect(valid({ regions: map(region, ["pain"]), pain: [] })).toBe(false);
    expect(valid({ regions: map(region, ["pain"]), pain: [id] })).toBe(true);
    expect(valid({ regions: map(region, ["injury"], { injury: { since: "gt6m" } }), pain: [] })).toBe(false);
    expect(valid({ regions: map(region, ["injury"], { injury: { since: "gt6m" } }), pain: [id] })).toBe(true);
  });

  it("3. the neck and the ankle and foot have no v1 pain id; other problem types need none", () => {
    expect(valid({ regions: map("neck", ["pain"]), pain: [] })).toBe(true);
    expect(
      valid({
        regions: map("ankle_foot", ["injury"], { injury: { since: "lt6w", achilles: false } }),
        pain: [],
      }),
    ).toBe(true);
    expect(valid({ regions: map("knee", ["weakness", "stiffness"]), pain: [] })).toBe(true);
    // The mirror goes one way: pain[] may name more than the body map.
    expect(valid({ regions: [], pain: ["knee", "back"] })).toBe(true);
  });
});
