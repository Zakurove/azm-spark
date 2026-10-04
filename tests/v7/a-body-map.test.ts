/**
 * The v7 body map (product v7 contract 2.2, 8.1 A): the condition questions and the regions they fill
 * (rom-protocol 2.3, one table case per answer), the merge of filled, reported and marked regions,
 * the validation the server applies to every saved intake, the follow up questions of each region
 * (rom-protocol 2.2 and 6) and the safety answers of RomIntakeFlags.
 *
 * The fill table and the question rules are prose in the clinical source, so they live in code
 * (C-1). With AZM_CLINICAL_V7 set to the clinical folder, the prose they were written from is
 * compared with the source, so a clinical change cannot leave the code behind unnoticed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AXIAL_REGIONS,
  LIMB_REGIONS,
  PROBLEM_TYPES,
  REGION_IDS,
  REGION_MOVEMENTS,
  REGION_PAIN_IDS,
  SINCE_BUCKETS,
  autoFillQuestions,
  autoFillRegions,
  entryCells,
  finalizeRegion,
  finalizeRomFlags,
  mergeRegionDrafts,
  mergeRegions,
  painIdsFromRegions,
  regionQuestions,
  romFlagQuestions,
  validateRegions,
  type AutoFillAnswer,
  type RegionDraft,
  type RegionEntry,
  type RegionId,
  type RomFlagContext,
} from "../../src/medical/body-map";
import { conditions, painOptions } from "../../src/medical/plan";
import { ROM_DATA, movementDef } from "../../src/movements/rom";
import { ROM_MOVEMENT_IDS } from "../../src/movements/rom/types";

const entry = (
  region: RegionId,
  side: RegionEntry["side"],
  problems: RegionEntry["problems"],
  extra: Partial<RegionEntry> = {},
): RegionEntry => ({ region, side, problems, origin: "person", ...extra });

/** The six limb regions on one side, as the condition fill writes them. */
const limbs = (
  side: RegionEntry["side"],
  problems: RegionEntry["problems"],
  regions: readonly RegionId[] = LIMB_REGIONS,
): RegionEntry[] => regions.map((region) => ({ region, side, problems, origin: "condition" as const }));

describe("autoFillQuestions (conditionAutoMap)", () => {
  it("asks the questions of the person's conditions in the order of the data", () => {
    const qs = autoFillQuestions(["arthritis", "stroke"]);
    expect(qs.map((q) => q.condition)).toEqual(["stroke", "arthritis"]);
    const row = ROM_DATA.conditionAutoMap.find((r) => r.condition === "stroke")!;
    expect(qs[0]).toEqual({ condition: "stroke", ask: row.ask, answers: row.answers });
    expect(qs[0].answers.map((a) => a.en)).toEqual(["Right", "Left"]);
  });

  it("asks nothing for conditions without a question", () => {
    for (const c of [["none"], ["cardiac"], ["cfs_moderate", "other"], []])
      expect(autoFillQuestions(c)).toEqual([]);
  });

  it("has a question for every condition the data maps, with its answers", () => {
    const asked = ROM_DATA.conditionAutoMap.filter((r) => r.ask.ar !== "" && r.ask.en !== "");
    expect(asked.map((r) => r.condition)).toEqual([
      "stroke",
      "cerebral_palsy",
      "ms",
      "parkinsons",
      "sci_complete",
      "sci_incomplete",
      "lower_limb_unilateral",
      "upper_limb_unilateral",
      "arthritis",
    ]);
    for (const r of asked) {
      expect(conditions).toContain(r.condition);
      expect(autoFillQuestions([r.condition])).toEqual([
        { condition: r.condition, ask: r.ask, answers: r.answers },
      ]);
    }
  });
});

describe("autoFillRegions (rom-protocol 2.3, one case per answer)", () => {
  const cases: { answer: AutoFillAnswer; regions: RegionEntry[] }[] = [
    { answer: { condition: "stroke", weakerSide: "right" }, regions: limbs("right", ["weakness"]) },
    { answer: { condition: "stroke", weakerSide: "left" }, regions: limbs("left", ["weakness"]) },
    {
      answer: { condition: "cerebral_palsy", pattern: "one_side", side: "left" },
      regions: limbs("left", ["weakness", "stiffness"]),
    },
    {
      answer: { condition: "cerebral_palsy", pattern: "both_legs" },
      regions: limbs("both", ["weakness", "stiffness"], ["hip", "knee", "ankle_foot"]),
    },
    {
      answer: { condition: "cerebral_palsy", pattern: "all_limbs" },
      regions: limbs("both", ["weakness", "stiffness"]),
    },
    {
      answer: { condition: "ms", limbs: ["right_arm"] },
      regions: limbs("right", ["weakness"], ["shoulder", "elbow", "forearm_wrist"]),
    },
    {
      answer: { condition: "ms", limbs: ["left_leg", "right_leg"] },
      regions: limbs("both", ["weakness"], ["hip", "knee", "ankle_foot"]),
    },
    {
      answer: { condition: "ms", limbs: ["right_arm", "left_leg"] },
      regions: [
        ...limbs("right", ["weakness"], ["shoulder", "elbow", "forearm_wrist"]),
        ...limbs("left", ["weakness"], ["hip", "knee", "ankle_foot"]),
      ],
    },
    {
      answer: { condition: "parkinsons", confirmed: true },
      regions: [
        { region: "neck", side: "axial", problems: ["stiffness"], origin: "condition" },
        { region: "back_trunk", side: "axial", problems: ["stiffness"], origin: "condition" },
        { region: "shoulder", side: "both", problems: ["stiffness"], origin: "condition" },
        { region: "hip", side: "both", problems: ["stiffness"], origin: "condition" },
      ],
    },
    { answer: { condition: "sci_complete", level: "neck" }, regions: limbs("both", ["weakness"]) },
    {
      answer: { condition: "sci_complete", level: "back" },
      regions: limbs("both", ["weakness"], ["hip", "knee", "ankle_foot"]),
    },
    { answer: { condition: "sci_incomplete", level: "neck" }, regions: limbs("both", ["weakness"]) },
    {
      answer: { condition: "sci_incomplete", level: "back" },
      regions: limbs("both", ["weakness"], ["hip", "knee", "ankle_foot"]),
    },
    {
      answer: { condition: "lower_limb_unilateral", side: "right", level: "below_knee" },
      regions: ["hip", "knee"].map((region) => ({
        region: region as RegionId,
        side: "right" as const,
        problems: ["limb_loss" as const],
        origin: "condition" as const,
        limbLoss: { level: "below_knee" as const },
      })),
    },
    {
      answer: { condition: "lower_limb_unilateral", side: "left", level: "above_knee" },
      regions: [
        {
          region: "hip",
          side: "left",
          problems: ["limb_loss"],
          origin: "condition",
          limbLoss: { level: "above_knee" },
        },
      ],
    },
    {
      answer: { condition: "upper_limb_unilateral", side: "left", level: "below_elbow" },
      regions: ["shoulder", "elbow"].map((region) => ({
        region: region as RegionId,
        side: "left" as const,
        problems: ["limb_loss" as const],
        origin: "condition" as const,
        limbLoss: { level: "below_elbow" as const },
      })),
    },
    {
      answer: { condition: "upper_limb_unilateral", side: "right", level: "above_elbow" },
      regions: [
        {
          region: "shoulder",
          side: "right",
          problems: ["limb_loss"],
          origin: "condition",
          limbLoss: { level: "above_elbow" },
        },
      ],
    },
  ];

  it.each(cases.map((c) => [JSON.stringify(c.answer), c] as const))("%s", (_name, { answer, regions }) => {
    const filled = autoFillRegions([answer]);
    expect(filled).toEqual(regions);
    expect(validateRegions(filled)).toBe(true);
  });

  it("keeps the suggested Parkinson's map when the person wants to change it (the map opens for edits)", () => {
    expect(autoFillRegions([{ condition: "parkinsons", confirmed: false }])).toEqual(
      autoFillRegions([{ condition: "parkinsons", confirmed: true }]),
    );
  });

  it("never fills the back or trunk for cerebral palsy or a spinal cord injury (review A02)", () => {
    for (const answer of [
      { condition: "cerebral_palsy", pattern: "all_limbs" },
      { condition: "sci_complete", level: "neck" },
      { condition: "sci_incomplete", level: "back" },
    ] as AutoFillAnswer[])
      expect(autoFillRegions([answer]).some((e) => e.region === "back_trunk")).toBe(false);
  });

  it("merges the answers of several conditions per region and side", () => {
    const filled = autoFillRegions([
      { condition: "stroke", weakerSide: "right" },
      { condition: "cerebral_palsy", pattern: "both_legs" },
    ]);
    expect(filled).toEqual([
      ...limbs("right", ["weakness"], ["shoulder", "elbow", "forearm_wrist"]),
      ...limbs("both", ["weakness", "stiffness"], ["hip", "knee", "ankle_foot"]),
    ]);
    expect(autoFillRegions([])).toEqual([]);
  });
});

describe("mergeRegions", () => {
  it("unites problem types per region and side, in the problem type order", () => {
    expect(
      mergeRegions([entry("knee", "left", ["pain"])], [entry("knee", "left", ["weakness", "pain"])]),
    ).toEqual([entry("knee", "left", ["weakness", "pain"])]);
  });

  it("lets a both entry absorb the left and right entries it already covers", () => {
    const merged = mergeRegions(
      [entry("hip", "left", ["weakness"]), entry("hip", "right", ["weakness"])],
      [{ ...entry("hip", "both", ["weakness"]), origin: "condition" }],
    );
    expect(merged).toEqual([entry("hip", "both", ["weakness"])]);
  });

  it("never gives a side a problem it does not have: a both entry splits instead", () => {
    const merged = mergeRegions(
      [entry("knee", "left", ["pain"])],
      [{ ...entry("knee", "both", ["weakness"]), origin: "condition" }],
    );
    expect(merged).toEqual([
      { ...entry("knee", "right", ["weakness"]), origin: "condition" },
      entry("knee", "left", ["weakness", "pain"]),
    ]);
    expect(validateRegions(merged)).toBe(true);
  });

  it("keeps a limb loss on its own side, never on both", () => {
    const merged = mergeRegions(
      [entry("hip", "left", ["limb_loss"], { limbLoss: { level: "above_knee" } })],
      [{ ...entry("hip", "both", ["weakness"]), origin: "condition" }],
    );
    expect(merged).toEqual([
      { ...entry("hip", "right", ["weakness"]), origin: "condition" },
      entry("hip", "left", ["weakness", "limb_loss"], { limbLoss: { level: "above_knee" } }),
    ]);
    expect(validateRegions(merged)).toBe(true);
  });

  it("keeps the answers of the base entry, and its origin", () => {
    const base = entry("knee", "right", ["injury"], { injury: { since: "lt6w" } });
    const merged = mergeRegions(
      [base],
      [{ ...entry("knee", "right", ["injury", "pain"]), origin: "report" }],
    );
    expect(merged).toEqual([{ ...base, problems: ["injury", "pain"] }]);
  });

  it("keeps a left and a right entry apart when no both entry joins them", () => {
    const merged = mergeRegions([entry("knee", "left", ["pain"])], [entry("knee", "right", ["pain"])]);
    expect(merged).toEqual([entry("knee", "right", ["pain"]), entry("knee", "left", ["pain"])]);
  });

  it("orders the result by region, then right before left, and is stable on its own output", () => {
    const merged = mergeRegions(
      [entry("knee", "left", ["pain"]), entry("neck", "axial", ["stiffness"])],
      [entry("shoulder", "right", ["weakness"]), entry("knee", "right", ["stiffness"])],
    );
    expect(merged.map((e) => `${e.region}:${e.side}`)).toEqual([
      "neck:axial",
      "shoulder:right",
      "knee:right",
      "knee:left",
    ]);
    expect(mergeRegions(merged, [])).toEqual(merged);
    expect(mergeRegions([], merged)).toEqual(merged);
  });

  it("merges entries still being answered the same way (the intake form's working state)", () => {
    const drafts: RegionDraft[] = [{ region: "hip", side: "left", problems: [], origin: "person" }];
    expect(
      mergeRegionDrafts(drafts, [
        { region: "hip", side: "both", problems: ["weakness"], origin: "condition" },
      ]),
    ).toEqual([{ region: "hip", side: "both", problems: ["weakness"], origin: "person" }]);
  });
});

describe("validateRegions", () => {
  const valid: RegionEntry[] = [
    entry("neck", "axial", ["stiffness"]),
    entry("shoulder", "right", ["after_surgery"], {
      surgery: {
        since: "6w_3m",
        cleared: "yes",
        avoid: ["shoulder_abduction"],
        stretchAllowed: "no",
        loadAllowed: "unsure",
      },
    }),
    entry("hip", "left", ["after_surgery"], {
      surgery: {
        since: "lt6w",
        cleared: "no",
        avoid: [],
        hipReplacement: true,
        hipAvoid: ["flex90", "cross"],
      },
    }),
    entry("knee", "both", ["pain", "injury"], { injury: { since: "gt6m" } }),
    entry("ankle_foot", "right", ["injury"], { injury: { since: "3m_6m", achilles: true } }),
    entry("elbow", "left", ["limb_loss"], { limbLoss: { level: "below_elbow" } }),
  ];

  it("accepts a complete map, and an empty one", () => {
    expect(validateRegions(valid)).toBe(true);
    expect(validateRegions([])).toBe(true);
  });

  const broken: [string, unknown][] = [
    ["not an array", { region: "neck" }],
    ["null", null],
    ["an unknown key", [{ ...entry("neck", "axial", ["pain"]), note: "x" }]],
    ["an unknown region", [entry("wrist" as RegionId, "left", ["pain"])]],
    ["a limb region with the axial side", [entry("knee", "axial", ["pain"])]],
    ["an axial region with a side", [entry("neck", "left", ["pain"])]],
    ["no problem type", [entry("knee", "left", [])]],
    ["a repeated problem type", [entry("knee", "left", ["pain", "pain"])]],
    ["an unknown problem type", [entry("knee", "left", ["ache" as never])]],
    ["an unknown origin", [{ ...entry("knee", "left", ["pain"]), origin: "doctor" }]],
    ["the same cell twice", [entry("knee", "left", ["pain"]), entry("knee", "left", ["stiffness"])]],
    [
      "both and one side of the same region",
      [entry("knee", "both", ["pain"]), entry("knee", "left", ["stiffness"])],
    ],
    [
      "an injury answer without the injury type",
      [entry("knee", "left", ["pain"], { injury: { since: "lt6w" } })],
    ],
    ["the injury type without its answer", [entry("knee", "left", ["injury"])]],
    ["an unknown since bucket", [entry("knee", "left", ["injury"], { injury: { since: "1y" as never } })]],
    [
      "achilles outside the ankle and foot",
      [entry("knee", "left", ["injury"], { injury: { since: "lt6w", achilles: true } })],
    ],
    [
      "an ankle injury without the achilles answer",
      [entry("ankle_foot", "left", ["injury"], { injury: { since: "lt6w" } })],
    ],
    ["the surgery type without its answers", [entry("knee", "left", ["after_surgery"])]],
    [
      "a movement to avoid from another region",
      [
        entry("knee", "left", ["after_surgery"], {
          surgery: { since: "lt6w", cleared: "yes", avoid: ["hip_flexion"] },
        }),
      ],
    ],
    [
      "a repeated movement to avoid",
      [
        entry("knee", "left", ["after_surgery"], {
          surgery: { since: "lt6w", cleared: "yes", avoid: ["knee_flexion", "knee_flexion"] },
        }),
      ],
    ],
    [
      "a hip replacement outside the hip",
      [
        entry("knee", "left", ["after_surgery"], {
          surgery: { since: "lt6w", cleared: "yes", avoid: [], hipReplacement: true },
        }),
      ],
    ],
    [
      "a recent hip surgery without the hip replacement answer",
      [entry("hip", "left", ["after_surgery"], { surgery: { since: "6w_3m", cleared: "yes", avoid: [] } })],
    ],
    [
      "hip limits without a hip replacement",
      [
        entry("hip", "left", ["after_surgery"], {
          surgery: { since: "lt6w", cleared: "yes", avoid: [], hipReplacement: false, hipAvoid: ["cross"] },
        }),
      ],
    ],
    [
      "no limits ticked with a limit",
      [
        entry("hip", "left", ["after_surgery"], {
          surgery: {
            since: "lt6w",
            cleared: "yes",
            avoid: [],
            hipReplacement: true,
            hipAvoid: ["none", "cross"],
          },
        }),
      ],
    ],
    [
      "an empty hip limit list",
      [
        entry("hip", "left", ["after_surgery"], {
          surgery: { since: "lt6w", cleared: "yes", avoid: [], hipReplacement: true, hipAvoid: [] },
        }),
      ],
    ],
    [
      "hip limits after 3 months",
      [
        entry("hip", "left", ["after_surgery"], {
          surgery: { since: "3m_6m", cleared: "yes", avoid: [], hipReplacement: true, hipAvoid: ["cross"] },
        }),
      ],
    ],
    [
      "the stretch answer after 3 months",
      [
        entry("knee", "left", ["after_surgery"], {
          surgery: { since: "gt6m", cleared: "yes", avoid: [], stretchAllowed: "yes" },
        }),
      ],
    ],
    [
      "an unknown cleared answer",
      [
        entry("knee", "left", ["after_surgery"], {
          surgery: { since: "gt6m", cleared: "maybe" as never, avoid: [] },
        }),
      ],
    ],
    [
      "limb loss on both sides of one entry",
      [entry("hip", "both", ["limb_loss"], { limbLoss: { level: "below_knee" } })],
    ],
    [
      "an arm level on a leg region",
      [entry("hip", "left", ["limb_loss"], { limbLoss: { level: "below_elbow" } })],
    ],
    ["the limb loss type without its level", [entry("hip", "left", ["limb_loss"])]],
    [
      "two limb loss levels on one leg",
      [
        entry("hip", "left", ["limb_loss"], { limbLoss: { level: "below_knee" } }),
        entry("knee", "left", ["limb_loss"], { limbLoss: { level: "above_knee" } }),
      ],
    ],
    [
      "more than 16 entries",
      Array.from({ length: 17 }, (_, i) => entry(REGION_IDS[i % 8], "axial", ["pain"])),
    ],
  ];
  it.each(broken)("rejects %s", (_why, v) => {
    expect(validateRegions(v)).toBe(false);
  });

  it("allows the same limb loss level on several regions of one side, and different sides apart", () => {
    expect(
      validateRegions([
        entry("hip", "left", ["limb_loss"], { limbLoss: { level: "below_knee" } }),
        entry("knee", "left", ["limb_loss"], { limbLoss: { level: "below_knee" } }),
        entry("hip", "right", ["limb_loss"], { limbLoss: { level: "above_knee" } }),
      ]),
    ).toBe(true);
  });
});

describe("the pain mirror and the cells", () => {
  it("maps pain and injury entries to the v1 pain ids, in the v1 order", () => {
    expect(
      painIdsFromRegions([
        entry("knee", "left", ["injury"], { injury: { since: "gt6m" } }),
        entry("back_trunk", "axial", ["pain"]),
        entry("forearm_wrist", "both", ["pain"]),
        entry("shoulder", "right", ["weakness"]),
        entry("neck", "axial", ["pain"]),
        entry("ankle_foot", "right", ["pain"]),
      ]),
    ).toEqual(["wrist", "back", "knee"]);
    expect(Object.values(REGION_PAIN_IDS).sort()).toEqual([...painOptions].sort());
    expect(REGION_PAIN_IDS.neck).toBeUndefined();
    expect(REGION_PAIN_IDS.ankle_foot).toBeUndefined();
  });

  it("gives each entry its body map cells", () => {
    expect(entryCells({ region: "neck", side: "axial" })).toEqual(["neck:axial"]);
    expect(entryCells({ region: "knee", side: "both" })).toEqual(["knee:right", "knee:left"]);
    expect(entryCells({ region: "hip", side: "left" })).toEqual(["hip:left"]);
  });
});

describe("REGION_MOVEMENTS against the data (C-1 parity)", () => {
  it("lists the measure and caution movements of each region", () => {
    for (const region of REGION_IDS) {
      const row = ROM_DATA.regionTable.find((r) => r.region === region)!;
      expect(REGION_MOVEMENTS[region]).toEqual([...row.measure, ...row.caution]);
      for (const id of REGION_MOVEMENTS[region]) expect(movementDef(id).region).toBe(region);
    }
    expect(Object.values(REGION_MOVEMENTS).flat().sort()).toEqual([...ROM_MOVEMENT_IDS].sort());
  });

  it("knows the axial regions and the problem types of the data", () => {
    expect(ROM_DATA.regions.filter((r) => r.axial).map((r) => r.id)).toEqual([...AXIAL_REGIONS]);
    expect(ROM_DATA.problemTypes.map((p) => p.id)).toEqual([...PROBLEM_TYPES]);
    expect(LIMB_REGIONS).toEqual(REGION_IDS.filter((r) => !AXIAL_REGIONS.includes(r)));
  });
});

describe("the follow up questions of a region (rom-protocol 2.2 and 6)", () => {
  const draft = (d: Partial<RegionDraft> & Pick<RegionDraft, "region" | "problems">): RegionDraft => ({
    side: AXIAL_REGIONS.includes(d.region) ? "axial" : "left",
    origin: "person",
    ...d,
  });

  it("asks nothing more for weakness, pain and stiffness", () => {
    const d = draft({ region: "knee", problems: ["weakness", "pain", "stiffness"] });
    expect(regionQuestions(d)).toEqual([]);
    expect(finalizeRegion(d)).toEqual(d);
  });

  it("needs a problem type first", () => {
    expect(finalizeRegion(draft({ region: "knee", problems: [] }))).toBeNull();
  });

  it("asks when an injury happened, and the Achilles question on the ankle and foot", () => {
    expect(regionQuestions(draft({ region: "knee", problems: ["injury"] }))).toEqual(["injury_when"]);
    expect(regionQuestions(draft({ region: "ankle_foot", problems: ["injury"] }))).toEqual([
      "injury_when",
      "achilles_ask",
    ]);
    expect(
      finalizeRegion(draft({ region: "ankle_foot", problems: ["injury"], injury: { since: "lt6w" } })),
    ).toBeNull();
    expect(
      finalizeRegion(
        draft({ region: "ankle_foot", problems: ["injury"], injury: { since: "lt6w", achilles: false } }),
      ),
    ).toEqual(
      draft({ region: "ankle_foot", problems: ["injury"], injury: { since: "lt6w", achilles: false } }),
    );
  });

  it("asks the Achilles question after an ankle surgery too (rom-protocol 6 achilles, with or without surgery)", () => {
    const d = draft({ region: "ankle_foot", problems: ["after_surgery"], surgery: { since: "3m_6m" } });
    expect(regionQuestions(d)).toEqual(["surgery_when", "achilles_ask"]);
    // RegionEntry keeps the answer only under injury: a no lives in the draft, a yes adds the injury type.
    expect(finalizeRegion(d)).toBeNull();
    expect(finalizeRegion({ ...d, achillesAnswer: true })).toBeNull();
    expect(finalizeRegion({ ...d, achillesAnswer: false })).toEqual(
      draft({
        region: "ankle_foot",
        problems: ["after_surgery"],
        surgery: { since: "3m_6m", cleared: "yes", avoid: [] },
      }),
    );
    const both = draft({
      region: "ankle_foot",
      problems: ["injury", "after_surgery"],
      injury: { since: "3m_6m", achilles: true },
      surgery: { since: "3m_6m" },
    });
    expect(regionQuestions(both).filter((q) => q === "achilles_ask")).toHaveLength(1);
    expect(finalizeRegion(both)?.injury).toEqual({ since: "3m_6m", achilles: true });
  });

  it("asks only when for a surgery more than 3 months ago, and stores it as cleared with nothing to avoid", () => {
    for (const since of ["3m_6m", "gt6m"] as const) {
      const d = draft({ region: "shoulder", problems: ["after_surgery"], surgery: { since } });
      expect(regionQuestions(d)).toEqual(["surgery_when"]);
      expect(finalizeRegion(d)?.surgery).toEqual({ since, cleared: "yes", avoid: [] });
    }
  });

  it("asks clearance for a recent surgery, and nothing else when the team has not allowed movement", () => {
    const d = draft({
      region: "knee",
      problems: ["after_surgery"],
      surgery: { since: "lt6w", cleared: "unsure" },
    });
    expect(regionQuestions(d)).toEqual(["surgery_when", "surgery_cleared"]);
    expect(finalizeRegion(d)?.surgery).toEqual({ since: "lt6w", cleared: "unsure", avoid: [] });
  });

  it("asks what to avoid, stretching and loading once a recent surgery is cleared", () => {
    const d = draft({
      region: "knee",
      problems: ["after_surgery"],
      surgery: { since: "6w_3m", cleared: "yes" },
    });
    expect(regionQuestions(d)).toEqual([
      "surgery_when",
      "surgery_cleared",
      "surgery_avoid",
      "surgery_stretch_ask",
      "surgery_load_ask",
    ]);
    expect(finalizeRegion(d)).toBeNull();
    const done = {
      ...d,
      surgery: {
        ...d.surgery,
        avoid: ["knee_flexion" as const],
        stretchAllowed: "no" as const,
        loadAllowed: "yes" as const,
      },
    };
    expect(finalizeRegion(done)?.surgery).toEqual({
      since: "6w_3m",
      cleared: "yes",
      avoid: ["knee_flexion"],
      stretchAllowed: "no",
      loadAllowed: "yes",
    });
  });

  it("skips the movements question where the camera measures none (forearm and wrist)", () => {
    const d = draft({
      region: "forearm_wrist",
      problems: ["after_surgery"],
      surgery: { since: "lt6w", cleared: "yes", stretchAllowed: "yes", loadAllowed: "no" },
    });
    expect(regionQuestions(d)).not.toContain("surgery_avoid");
    expect(finalizeRegion(d)?.surgery?.avoid).toEqual([]);
  });

  it("asks about a hip replacement and its limits after a recent hip surgery, cleared or not", () => {
    const d = draft({
      region: "hip",
      problems: ["after_surgery"],
      surgery: { since: "lt6w", cleared: "no" },
    });
    expect(regionQuestions(d)).toEqual(["surgery_when", "surgery_cleared", "hip_replacement"]);
    const replaced = { ...d, surgery: { ...d.surgery, hipReplacement: true } };
    expect(regionQuestions(replaced)).toEqual([
      "surgery_when",
      "surgery_cleared",
      "hip_replacement",
      "hip_avoid_ask",
    ]);
    expect(finalizeRegion(replaced)).toBeNull();
    expect(
      finalizeRegion({ ...replaced, surgery: { ...replaced.surgery, hipAvoid: ["none"] } })?.surgery,
    ).toEqual({
      since: "lt6w",
      cleared: "no",
      avoid: [],
      hipReplacement: true,
      hipAvoid: ["none"],
    });
  });

  it("drops answers that no longer apply when an earlier answer changes", () => {
    const d = draft({
      region: "hip",
      problems: ["after_surgery"],
      surgery: {
        since: "gt6m",
        cleared: "yes",
        avoid: ["hip_extension"],
        hipReplacement: true,
        hipAvoid: ["cross"],
        stretchAllowed: "yes",
        loadAllowed: "yes",
      },
      injury: { since: "lt6w" },
    });
    expect(finalizeRegion(d)).toEqual(
      draft({
        region: "hip",
        problems: ["after_surgery"],
        surgery: { since: "gt6m", cleared: "yes", avoid: [] },
      }),
    );
  });

  it("asks the level of a limb loss on one side only", () => {
    const d = draft({ region: "knee", problems: ["limb_loss"] });
    expect(regionQuestions(d)).toEqual(["limb_loss_level"]);
    expect(finalizeRegion(d)).toBeNull();
    expect(finalizeRegion({ ...d, limbLoss: { level: "below_knee" } })?.limbLoss).toEqual({
      level: "below_knee",
    });
    expect(finalizeRegion({ ...d, limbLoss: { level: "below_elbow" } })).toBeNull();
    expect(finalizeRegion({ ...d, side: "both", limbLoss: { level: "below_knee" } })).toBeNull();
  });

  it("finalizes into entries the server accepts", () => {
    const finals = [
      finalizeRegion(
        draft({
          region: "ankle_foot",
          problems: ["injury", "pain"],
          injury: { since: "6w_3m", achilles: true },
        }),
      ),
      finalizeRegion(
        draft({ region: "neck", problems: ["after_surgery"], surgery: { since: "lt6w", cleared: "no" } }),
      ),
      finalizeRegion(draft({ region: "elbow", problems: ["limb_loss"], limbLoss: { level: "above_elbow" } })),
    ];
    expect(finals.every((f) => f !== null)).toBe(true);
    expect(validateRegions(finals)).toBe(true);
    for (const since of SINCE_BUCKETS)
      expect(
        validateRegions([
          finalizeRegion(
            draft({
              region: "hip",
              problems: ["after_surgery"],
              surgery: {
                since,
                cleared: "yes",
                avoid: [],
                hipReplacement: false,
                stretchAllowed: "no",
                loadAllowed: "no",
              },
            }),
          ),
        ]),
      ).toBe(true);
  });
});

describe("the safety answers (RomIntakeFlags)", () => {
  const ctx = (c: Partial<RomFlagContext> = {}): RomFlagContext => ({
    conditions: ["none"],
    mobility: "standing",
    regions: [],
    ...c,
  });
  const ids = (c: Partial<RomFlagContext>) =>
    romFlagQuestions(ctx(c)).map((q) => (q.side ? `${q.id}:${q.side}` : q.id));

  it("asks the bones and neck questions of everyone (program wide exclusions)", () => {
    expect(ids({})).toEqual(["bones_ask", "neck_ask"]);
  });

  it("asks the arthritis type with arthritis, and the neck clearance after a yes or not sure", () => {
    expect(ids({ conditions: ["arthritis"] })).toEqual(["bones_ask", "neck_ask", "arthritis_type_ask"]);
    for (const a of ["yes", "unsure"] as const)
      expect(ids({ conditions: ["arthritis"], inflammatoryArthritis: a })).toContain("neck_cleared_ask");
    expect(ids({ conditions: ["arthritis"], inflammatoryArthritis: "no" })).not.toContain("neck_cleared_ask");
  });

  it("asks the chair transfer of wheelchair users", () => {
    expect(ids({ mobility: "wheelchair" })).toContain("transfer_chair_ask");
    expect(ids({ mobility: "seated" })).not.toContain("transfer_chair_ask");
  });

  it("asks sitting balance with a seated or wheelchair mobility or a listed condition (review C11)", () => {
    for (const c of [
      { mobility: "seated" },
      { mobility: "wheelchair" },
      ...["sci_complete", "sci_incomplete", "ms", "stroke", "cerebral_palsy", "parkinsons"].map((x) => ({
        conditions: [x],
      })),
    ])
      expect(ids(c)).toContain("sit_unsupported_ask");
    for (const c of [
      {},
      { conditions: ["arthritis"] },
      { mobility: "bed" },
      { mobility: "seated", sciNeck: true },
    ])
      expect(ids(c)).not.toContain("sit_unsupported_ask");
  });

  it("asks the foot lift for each side of a weak ankle and foot", () => {
    expect(ids({ regions: [entry("ankle_foot", "both", ["weakness"])] })).toEqual([
      "bones_ask",
      "neck_ask",
      "foot_lift_ask:right",
      "foot_lift_ask:left",
    ]);
    expect(ids({ regions: [entry("ankle_foot", "left", ["weakness", "pain"])] })).toContain(
      "foot_lift_ask:left",
    );
    expect(ids({ regions: [entry("ankle_foot", "left", ["pain"])] })).not.toContain("foot_lift_ask:left");
  });

  it("finalizes only complete answers, keeps the applicable ones and fills the unasked sitting balance", () => {
    expect(finalizeRomFlags({ osteoporosis: false }, ctx())).toBeNull();
    expect(finalizeRomFlags({ osteoporosis: false, neckCaution: true, transferChair: true }, ctx())).toEqual({
      osteoporosis: false,
      neckCaution: true,
    });
    const wheel = ctx({ mobility: "wheelchair", conditions: ["arthritis"], inflammatoryArthritis: "yes" });
    expect(
      finalizeRomFlags({ osteoporosis: true, neckCaution: false, inflammatoryArthritis: "yes" }, wheel),
    ).toBeNull();
    expect(
      finalizeRomFlags(
        {
          osteoporosis: true,
          neckCaution: false,
          inflammatoryArthritis: "yes",
          neckCleared: false,
          transferChair: false,
          sitUnsupported: "unsure",
        },
        wheel,
      ),
    ).toEqual({
      osteoporosis: true,
      neckCaution: false,
      inflammatoryArthritis: "yes",
      neckCleared: false,
      transferChair: false,
      sitUnsupported: "unsure",
    });
    expect(
      finalizeRomFlags(
        { osteoporosis: false, neckCaution: false },
        ctx({ conditions: ["sci_complete"], sciNeck: true }),
      ),
    ).toEqual({
      osteoporosis: false,
      neckCaution: false,
      sitUnsupported: "no",
    });
    expect(finalizeRomFlags({ osteoporosis: false, neckCaution: false }, ctx({ mobility: "bed" }))).toEqual({
      osteoporosis: false,
      neckCaution: false,
      sitUnsupported: "no",
    });
    const feet = ctx({ regions: [entry("ankle_foot", "both", ["weakness"])] });
    expect(
      finalizeRomFlags({ osteoporosis: false, neckCaution: false, footLift: { right: true } }, feet),
    ).toBeNull();
    expect(
      finalizeRomFlags(
        { osteoporosis: false, neckCaution: false, footLift: { right: true, left: false } },
        feet,
      ),
    ).toEqual({ osteoporosis: false, neckCaution: false, footLift: { right: true, left: false } });
  });
});

describe.skipIf(!process.env.AZM_CLINICAL_V7)(
  "the clinical prose the code was written from (AZM_CLINICAL_V7)",
  () => {
    const source = () =>
      JSON.parse(readFileSync(join(process.env.AZM_CLINICAL_V7!, "rom-protocol.json"), "utf8")) as {
        conditionAutoMap: {
          condition: string;
          regions: string;
          problem: string;
          answers: { map?: string }[];
        }[];
        positions: Record<string, { who: string }>;
      };

    it("fills the regions and problem types of conditionAutoMap", () => {
      const rows = Object.fromEntries(source().conditionAutoMap.map((r) => [r.condition, r]));
      const expected: Record<string, [string, string, (string | undefined)[]]> = {
        stroke: [
          "That side: shoulder, elbow, forearm and wrist, hip, knee, ankle and foot",
          "weakness (add stiffness if the person reports tightness)",
          [undefined, undefined],
        ],
        cerebral_palsy: [
          "By answer; suggested first answer: both legs",
          "stiffness and weakness",
          [
            "that side's arm and leg",
            "both hips, knees, ankles",
            "all limb regions; the person may add back or trunk",
          ],
        ],
        ms: [
          "Each chosen limb: arm = shoulder, elbow, forearm and wrist; leg = hip, knee, ankle and foot. Suggested: both legs",
          "weakness",
          [undefined, undefined, undefined, undefined],
        ],
        parkinsons: [
          "Neck, both shoulders, both hips, and back or trunk",
          "stiffness",
          [undefined, undefined],
        ],
        sci_complete: [
          "By level",
          "weakness",
          [
            "both arms and both legs; the person may add back or trunk",
            "both legs; the person may add back or trunk",
          ],
        ],
        sci_incomplete: ["By level, as complete", "weakness", [undefined, undefined]],
        lower_limb_unilateral: [
          "That side's hip (and knee if below the knee), per the limb loss rule",
          "limb_loss",
          [undefined, undefined],
        ],
        upper_limb_unilateral: [
          "That side's shoulder (and elbow region only for what is present), per the limb loss rule",
          "limb_loss",
          [undefined, undefined],
        ],
      };
      for (const [condition, [regions, problem, maps]] of Object.entries(expected)) {
        expect(rows[condition].regions, condition).toBe(regions);
        expect(rows[condition].problem, condition).toBe(problem);
        expect(
          rows[condition].answers.map((a) => a.map),
          condition,
        ).toEqual(maps);
      }
    });

    it("asks sitting balance as the seated_forward position says", () => {
      const who = source().positions.seated_forward.who;
      expect(who).toContain(
        "asked once in the intake with mobility wheelchair or seated, or with SCI, MS, stroke, CP or Parkinson's; taken as no without asking for mobility bed and SCI at neck level",
      );
    });
  },
);
