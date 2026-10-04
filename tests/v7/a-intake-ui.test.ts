/**
 * The "Your body" step of the intake (product v7 contract 1.2 and 2.2, src/app/IntakeV7.tsx): its
 * working state, the intake fields it writes (each undefined until complete), the condition fill and
 * its confirmation (rom-protocol 2.3), the report and earlier suggestions, the cards and the safety
 * questions, and its review rows. Walked in a browser by stream G's v7 e2e.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import IntakeV7, {
  FILL_ANSWERS,
  answerAchilles,
  IntakeV7Review,
  confirmLine,
  fillAnswers,
  fillQuestions,
  initialUi,
  levelName,
  stepAnswers,
  suggestionsFor,
  syncDrafts,
  type IntakeV7Props,
  type V7Ui,
} from "../../src/app/IntakeV7";
import { autoFillRegions, type RegionEntry } from "../../src/medical/body-map";
import { ROM_DATA, romCopy } from "../../src/movements/rom";

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const ctx = (conditions: string[] = ["none"], mobility = "standing") => ({ conditions, mobility });
const fresh = (conditions: string[] = ["none"]) => initialUi({}, conditions);
const complete: V7Ui = {
  ...fresh(),
  sex: "female",
  walking: "with_aid",
  aid: "walker",
  height: "160",
  drafts: [{ region: "knee", side: "left", problems: ["pain"], origin: "person" }],
  flags: { osteoporosis: false, neckCaution: false },
};

describe("the condition answers against the data", () => {
  it("reads each answer of conditionAutoMap in the data's order", () => {
    const en = (c: string) =>
      ROM_DATA.conditionAutoMap.find((r) => r.condition === c)!.answers.map((a) => a.en);
    expect(en("stroke")).toEqual(["Right", "Left"]);
    expect(en("cerebral_palsy")).toEqual([
      "One side",
      "Both legs more than the arms",
      "Both arms and both legs",
    ]);
    expect(en("ms")).toEqual(["Right arm", "Left arm", "Right leg", "Left leg"]);
    expect(en("parkinsons")).toEqual(["Yes", "I want to change it"]);
    expect(en("sci_complete")).toEqual(["In the neck", "In the back or lower"]);
    expect(en("sci_incomplete")).toEqual(["In the neck", "In the back or lower"]);
    expect(en("lower_limb_unilateral")).toEqual(["Below the knee", "Above the knee"]);
    expect(en("upper_limb_unilateral")).toEqual(["Below the elbow", "Above the elbow"]);
    for (const [condition, values] of Object.entries(FILL_ANSWERS))
      expect(en(condition)).toHaveLength(values.length);
    expect(levelName("en", "above_knee")).toBe("Above the knee");
    expect(levelName("ar", "below_elbow")).toBe("تحت المرفق");
  });

  it("asks the questions with answers to tap; arthritis titles the map instead", () => {
    expect(fillQuestions(["arthritis", "stroke", "cardiac"]).map((q) => q.condition)).toEqual(["stroke"]);
  });

  it("turns complete answers into the fill, in question order, and nothing before that", () => {
    const conditions = ["stroke", "lower_limb_unilateral", "cerebral_palsy"];
    expect(fillAnswers({ stroke: "left" }, conditions)).toBeNull();
    expect(fillAnswers({ stroke: "left", cerebral_palsy: { pattern: "one_side" } }, conditions)).toBeNull();
    expect(
      fillAnswers(
        {
          stroke: "left",
          cerebral_palsy: { pattern: "one_side", side: "right" },
          lower_limb_unilateral: { side: "right", level: "above_knee" },
        },
        conditions,
      ),
    ).toEqual([
      { condition: "stroke", weakerSide: "left" },
      { condition: "cerebral_palsy", pattern: "one_side", side: "right" },
      { condition: "lower_limb_unilateral", side: "right", level: "above_knee" },
    ]);
    expect(fillAnswers({ ms: [] }, ["ms"])).toBeNull();
    expect(fillAnswers({ parkinsons: false }, ["parkinsons"])).toEqual([
      { condition: "parkinsons", confirmed: false },
    ]);
    expect(fillAnswers({}, ["none"])).toEqual([]);
  });
});

describe("the step's state and the fields it writes", () => {
  it("starts fresh with the condition questions, or from the saved answers", () => {
    expect(fresh(["stroke"]).fillStage).toBe("ask");
    expect(fresh(["arthritis"]).fillStage).toBe("done");
    const saved: RegionEntry[] = [{ region: "neck", side: "axial", problems: ["pain"], origin: "person" }];
    const ui = initialUi(
      {
        sex: "male",
        regions: saved,
        walking: { status: "with_aid", aid: "cane" },
        heightCm: 180,
        romFlags: { osteoporosis: true, neckCaution: false },
      },
      ["stroke"],
    );
    expect(ui).toMatchObject({
      sex: "male",
      walking: "with_aid",
      aid: "cane",
      height: "180",
      fillStage: "done",
      none: false,
    });
    expect(ui.drafts).toEqual(saved);
    expect(initialUi({ regions: [] }, []).none).toBe(true);
  });

  it("writes every field once the answers are complete", () => {
    expect(stepAnswers(complete, ctx())).toEqual({
      sex: "female",
      regions: [{ region: "knee", side: "left", problems: ["pain"], origin: "person" }],
      walking: { status: "with_aid", aid: "walker" },
      heightCm: 160,
      romFlags: { osteoporosis: false, neckCaution: false },
    });
  });

  it("keeps each field undefined until it is complete", () => {
    const open = stepAnswers(fresh(), ctx());
    expect(open).toEqual({
      sex: undefined,
      regions: undefined,
      walking: undefined,
      heightCm: undefined,
      romFlags: undefined,
    });
    expect(stepAnswers({ ...complete, aid: undefined }, ctx()).walking).toBeUndefined();
    expect(
      stepAnswers(
        { ...complete, drafts: [{ region: "knee", side: "left", problems: ["injury"], origin: "person" }] },
        ctx(),
      ).regions,
    ).toBeUndefined();
    expect(stepAnswers({ ...complete, fillStage: "confirm" }, ctx()).regions).toBeUndefined();
    expect(stepAnswers({ ...complete, flags: { osteoporosis: true } }, ctx()).romFlags).toBeUndefined();
  });

  it("walks no in bed, asks height of walkers only, and keeps a height out of range as typed", () => {
    expect(stepAnswers(complete, ctx(["none"], "bed"))).toMatchObject({
      walking: { status: "no" },
      heightCm: undefined,
    });
    expect(stepAnswers({ ...complete, walking: "no" }, ctx()).heightCm).toBeUndefined();
    expect(stepAnswers({ ...complete, height: "" }, ctx()).heightCm).toBeUndefined();
    expect(stepAnswers({ ...complete, height: "300" }, ctx()).heightCm).toBe(300);
  });

  it("writes an empty map for «لا يتأثر أي جزء من جسمي»", () => {
    expect(stepAnswers({ ...complete, drafts: [], none: true }, ctx()).regions).toEqual([]);
  });

  it("writes the safety answers the context asks, with sitting balance no after a neck level injury", () => {
    expect(
      stepAnswers({ ...complete, sciNeck: true }, ctx(["sci_complete"], "wheelchair")).romFlags,
    ).toBeUndefined();
    expect(
      stepAnswers(
        {
          ...complete,
          sciNeck: true,
          flags: { osteoporosis: false, neckCaution: false, transferChair: true },
        },
        ctx(["sci_complete"], "wheelchair"),
      ).romFlags,
    ).toEqual({ osteoporosis: false, neckCaution: false, transferChair: true, sitUnsupported: "no" });
  });
});

describe("the map's cells keep their answers", () => {
  it("keeps a cell still on the map, narrows a both entry, starts a new cell empty", () => {
    const both = {
      region: "knee" as const,
      side: "both" as const,
      problems: ["injury" as const],
      origin: "person" as const,
      injury: { since: "lt6w" as const },
    };
    const hip = {
      region: "hip" as const,
      side: "left" as const,
      problems: ["pain" as const],
      origin: "report" as const,
    };
    expect(
      syncDrafts(
        [both, hip],
        [
          { region: "knee", side: "right", problems: ["injury"], origin: "person" },
          { region: "hip", side: "left", problems: ["pain"], origin: "report" },
          { region: "neck", side: "axial", problems: [], origin: "person" },
        ],
      ),
    ).toEqual([
      { ...both, side: "right" },
      hip,
      { region: "neck", side: "axial", problems: [], origin: "person" },
    ]);
  });
});

describe("the confirmation of a filled map (confirm_regions)", () => {
  it("names the regions and the side when the fill has one side", () => {
    const drafts = autoFillRegions([{ condition: "stroke", weakerSide: "right" }]);
    expect(confirmLine("ar", drafts)).toBe(
      "سنقيس الكتف، والمرفق، والساعد والرسغ، والورك، والركبة، والكاحل والقدم في الجهة اليمنى. هل هذا مناسب؟",
    );
    expect(confirmLine("en", drafts)).toBe(
      "We will measure your shoulder, elbow, forearm and wrist, hip, knee, and ankle and foot on your right side. Is that right?",
    );
  });

  it("asks more generally when the fill has several sides", () => {
    const drafts = autoFillRegions([{ condition: "cerebral_palsy", pattern: "both_legs" }]);
    expect(confirmLine("en", drafts)).toBe("We will measure these parts of your body. Is that right?");
  });
});

describe("suggestions", () => {
  it("offers the report's regions, its pain areas no region covers, and earlier v1 pain areas", () => {
    const offers = suggestionsFor(
      { regions: [{ region: "knee", side: "left", problems: ["injury"] }], pain: ["knee", "back"] },
      ["wrist"],
    );
    expect(offers.report).toEqual([
      { key: "report:knee:left", region: "knee", side: "left", problems: ["injury"], origin: "report" },
      {
        key: "report:back_trunk:axial",
        region: "back_trunk",
        side: "axial",
        problems: ["pain"],
        origin: "report",
      },
    ]);
    expect(offers.earlier).toEqual([
      {
        key: "person:forearm_wrist:unknown",
        region: "forearm_wrist",
        side: "unknown",
        problems: ["pain"],
        origin: "person",
      },
    ]);
    expect(suggestionsFor(null, [])).toEqual({ report: [], earlier: [] });
  });
});

describe("the step on screen", () => {
  const render = (p: Partial<IntakeV7Props>) =>
    renderToStaticMarkup(
      createElement(IntakeV7, {
        lang: "ar",
        context: ctx(),
        value: {},
        ui: null,
        onUi: () => {},
        onChange: () => {},
        ...p,
      }),
    );

  it("asks sex, walking, the condition question, the map and the safety questions of a stroke", () => {
    const text = plain(render({ context: ctx(["stroke"]) }));
    for (const line of [
      romCopy("intro").ar,
      "الجنس",
      "هل تستطيع المشي؟",
      ROM_DATA.conditionAutoMap[0].ask.ar,
      "اعرض الأجزاء على الخريطة",
      romCopy("region_ask").ar,
      "لا يتأثر أي جزء من جسمي",
      romCopy("bones_ask").ar,
      romCopy("neck_ask").ar,
      romCopy("sit_unsupported_ask").ar,
    ])
      expect(text).toContain(line);
    expect(text).not.toContain(romCopy("transfer_chair_ask").ar);
    expect(text).not.toContain("طولك بالسنتيمتر");
  });

  it("asks no walking question in bed, and the chair transfer in a wheelchair", () => {
    expect(plain(render({ context: ctx(["none"], "bed") }))).not.toContain("هل تستطيع المشي؟");
    expect(plain(render({ context: ctx(["none"], "wheelchair"), lang: "en" }))).toContain(
      romCopy("transfer_chair_ask").en,
    );
  });

  it("titles the map with the arthritis question and asks its type", () => {
    const text = plain(render({ context: ctx(["arthritis"]), lang: "en" }));
    expect(text).toContain("Which of your joints does your medical condition affect?");
    expect(text).toContain(romCopy("arthritis_type_ask").en);
  });

  it("shows a card per region with its questions, and names the cards that miss answers", () => {
    const ui: V7Ui = {
      ...complete,
      drafts: [
        { region: "ankle_foot", side: "right", problems: ["injury"], origin: "person" },
        {
          region: "hip",
          side: "left",
          problems: ["after_surgery"],
          origin: "person",
          surgery: { since: "lt6w" },
        },
      ],
    };
    const html = render({ ui, lang: "en", showMissing: true });
    const text = plain(html);
    expect(text).toContain("Ankle and foot, right side");
    expect(text).toContain(romCopy("achilles_ask").en);
    expect(text).toContain(romCopy("surgery_cleared").en);
    expect(text).toContain("Was the surgery a hip replacement?");
    expect(html.match(/Finish the answers for this part\./g)).toHaveLength(2);
    // Limb loss is only offered on one side of a limb.
    expect(text).toContain("Limb loss");
    expect(
      plain(
        render({
          ui: { ...ui, drafts: [{ region: "neck", side: "axial", problems: [], origin: "person" }] },
        }),
      ),
    ).not.toContain("فقد طرف");
  });

  it("answers the Achilles question of an ankle surgery: a yes adds the injury type, a no stays in the form", () => {
    const d = {
      region: "ankle_foot" as const,
      side: "left" as const,
      problems: ["after_surgery" as const],
      origin: "person" as const,
      surgery: { since: "6w_3m" as const, cleared: "yes" as const },
    };
    expect(answerAchilles(d, false)).toEqual({ ...d, achillesAnswer: false });
    expect(answerAchilles(d, true)).toEqual({
      ...d,
      achillesAnswer: undefined,
      problems: ["injury", "after_surgery"],
      injury: { since: "6w_3m", achilles: true },
    });
  });

  it("asks an ankle surgery the Achilles question", () => {
    const ui: V7Ui = {
      ...complete,
      drafts: [
        {
          region: "ankle_foot",
          side: "left",
          problems: ["after_surgery"],
          origin: "person",
          surgery: { since: "gt6m" },
        },
      ],
    };
    const text = plain(render({ ui, lang: "en" }));
    expect(text).toContain(romCopy("achilles_ask").en);
    expect(stepAnswers(ui, ctx()).regions).toBeUndefined();
    expect(
      stepAnswers({ ...ui, drafts: [{ ...ui.drafts[0], achillesAnswer: false }] }, ctx()).regions,
    ).toEqual([
      {
        region: "ankle_foot",
        side: "left",
        problems: ["after_surgery"],
        origin: "person",
        surgery: { since: "gt6m", cleared: "yes", avoid: [] },
      },
    ]);
  });

  it("folds a complete card to one line with Change, and keeps an open one's questions", () => {
    const ui: V7Ui = {
      ...complete,
      drafts: [
        { region: "knee", side: "right", problems: ["weakness", "stiffness"], origin: "condition" },
        { region: "hip", side: "left", problems: [], origin: "person" },
      ],
    };
    const html = render({ ui, lang: "en" });
    expect(html).toMatch(/data-region="knee:right" data-folded="true"/);
    expect(html).toMatch(/data-region="hip:left" data-folded="false"/);
    const text = plain(html);
    expect(text).toContain("Knee, right side Change Remove Weakness or paralysis, Stiffness");
    expect(text.match(/What kind of problem is it in this part\?/g)).toHaveLength(1);
  });

  it("shows the confirmation after a fill, and the report's suggestions with Add", () => {
    const drafts = autoFillRegions([{ condition: "stroke", weakerSide: "left" }]);
    const text = plain(
      render({
        ui: { ...fresh(["stroke"]), drafts, fillStage: "confirm" },
        context: ctx(["stroke"]),
        report: { regions: [{ region: "neck", side: "axial", problems: ["pain"] }], pain: [] },
      }),
    );
    expect(text).toContain(confirmLine("ar", drafts));
    expect(text).toContain(romCopy("change_it").ar);
    expect(text).toContain("ذكر تقريرك هذه الأجزاء");
    expect(text).toContain("الرقبة");
    expect(text).toContain("أضف");
  });
});

describe("the review rows", () => {
  it("names sex, walking with its aid, height and each region with its problems", () => {
    const html = renderToStaticMarkup(
      createElement(IntakeV7Review, { lang: "en", value: stepAnswers(complete, ctx()) }),
    );
    expect(plain(html)).toContain("Sex Female");
    expect(plain(html)).toContain("Walking Yes, with an aid, Walker");
    expect(plain(html)).toContain("Height 160 cm");
    expect(plain(html)).toContain("Affected parts Knee, left side: Pain");
    const ar = plain(
      renderToStaticMarkup(createElement(IntakeV7Review, { lang: "ar", value: { regions: [] } })),
    );
    expect(ar).toContain("الأجزاء المتأثرة لا يوجد");
  });
});
