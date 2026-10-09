/**
 * The v7 parts of the intake (product v7 contract 1.2 and 2.2, src/app/IntakeV7.tsx), shortened by
 * D-034 item 5: the working state, the intake fields it writes (each undefined until complete), the
 * condition answers that fill the body map at once (rom-protocol 2.3; the person confirms with one
 * tap), the parts a person adds by hand (one quick choice; the injury and surgery questions only with
 * that problem), the report and earlier suggestions, the safety questions and the review rows.
 * Walked in a browser by e2e/v7-form.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import IntakeV7, {
  FILL_ANSWERS,
  IntakeV7About,
  IntakeV7Consent,
  IntakeV7Review,
  answerAchilles,
  applyFill,
  fillAnswers,
  fillQuestions,
  fillSummary,
  inferFill,
  initialUi,
  levelName,
  stepAnswers,
  suggestionsFor,
  supportOf,
  syncDrafts,
  type IntakeV7AboutProps,
  type IntakeV7Props,
  type V7Ui,
} from "../../src/app/IntakeV7";
import { autoFillRegions, type RegionEntry } from "../../src/medical/body-map";
import { ROM_DATA, romCopy } from "../../src/movements/rom";
import { labels } from "../../src/app/platform-copy";
import { tV7 } from "../../src/i18n/v7";

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const ctx = (conditions: string[] = ["none"], mobility = "standing") => ({ conditions, mobility });
const fresh = (conditions: string[] = ["none"]) => applyFill(initialUi({}, conditions), conditions);
const kneeLeftPain: RegionEntry = { region: "knee", side: "left", problems: ["pain"], origin: "person" };
const complete: V7Ui = {
  ...fresh(),
  sex: "female",
  walking: "with_aid",
  aid: "walker",
  height: "160",
  drafts: [kneeLeftPain],
  flags: { osteoporosis: false, neckCaution: false },
};
/** Fahd (CT-1): a stroke with the right side weaker. */
const fahd = (ui: Partial<V7Ui> = {}) =>
  applyFill({ ...fresh(["stroke"]), fill: { stroke: "right" }, ...ui }, ["stroke"]);
const strokeRight = autoFillRegions([{ condition: "stroke", weakerSide: "right" }]);

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

  it("asks the questions with answers to tap; arthritis titles the map, and Parkinson's is not asked", () => {
    expect(fillQuestions(["arthritis", "stroke", "cardiac"]).map((q) => q.condition)).toEqual(["stroke"]);
    expect(fillQuestions(["parkinsons"])).toEqual([]);
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
    // Both Parkinson's answers filled the same map: it fills without a question.
    expect(fillAnswers({}, ["parkinsons"])).toEqual([{ condition: "parkinsons", confirmed: true }]);
    expect(fillAnswers({}, ["none"])).toEqual([]);
  });
});

describe("the map fills itself from the condition (D-034 item 5)", () => {
  it("puts a right sided stroke's six parts on the map as weakness at once, waiting for one confirmation", () => {
    const ui = fahd();
    expect(ui.fillReady).toBe(true);
    expect(ui.drafts).toEqual(strokeRight);
    expect(ui.drafts.map((d) => `${d.region}:${d.side}:${d.problems.join("+")}:${d.origin}`)).toEqual([
      "shoulder:right:weakness:condition",
      "elbow:right:weakness:condition",
      "forearm_wrist:right:weakness:condition",
      "hip:right:weakness:condition",
      "knee:right:weakness:condition",
      "ankle_foot:right:weakness:condition",
    ]);
    expect(ui.confirmed).toBe(false);
    // Nothing is saved before the confirmation; once confirmed, the parts are the intake's regions.
    const flags = { osteoporosis: false, neckCaution: false, sitUnsupported: "yes" as const };
    expect(stepAnswers({ ...ui, flags }, ctx(["stroke"])).regions).toBeUndefined();
    expect(stepAnswers({ ...ui, flags, confirmed: true }, ctx(["stroke"])).regions).toEqual(strokeRight);
  });

  it("waits while a question has no answer, and keeps the same state when nothing changed", () => {
    const open = fresh(["stroke"]);
    expect(open.fillReady).toBe(false);
    expect(open.drafts).toEqual([]);
    expect(applyFill(open, ["stroke"])).toBe(open);
    const ui = fahd();
    expect(applyFill(ui, ["stroke"])).toBe(ui);
  });

  it("keeps the parts the person added, and replaces the filled parts when an answer changes", () => {
    const ui = fahd({ confirmed: true });
    const withKnee = { ...ui, drafts: [...ui.drafts, kneeLeftPain], confirmed: true };
    const left = applyFill({ ...withKnee, fill: { stroke: "left" } }, ["stroke"]);
    expect(left.confirmed).toBe(false);
    expect(left.drafts.filter((d) => d.origin === "condition").map((d) => d.side)).toEqual(
      Array(5).fill("left"),
    );
    // The person's left knee pain and the stroke's left knee weakness are one part, the person's.
    expect(left.drafts.find((d) => d.region === "knee")).toEqual({
      region: "knee",
      side: "left",
      problems: ["weakness", "pain"],
      origin: "person",
    });
    // Unticking the stroke takes its parts off, and keeps the person's own.
    const none = applyFill(withKnee, ["none"]);
    expect(none.drafts).toEqual([kneeLeftPain]);
  });

  it("takes sitting balance as no after a neck level spinal cord injury", () => {
    const ui = applyFill({ ...fresh(["sci_complete"]), fill: { sci_complete: "neck" } }, ["sci_complete"]);
    expect(ui.sciNeck).toBe(true);
    expect(
      stepAnswers(
        {
          ...ui,
          confirmed: true,
          flags: {
            osteoporosis: false,
            neckCaution: false,
            transferChair: true,
            footLift: { right: false, left: false },
          },
        },
        ctx(["sci_complete"], "wheelchair"),
      ).romFlags,
    ).toEqual({
      osteoporosis: false,
      neckCaution: false,
      transferChair: true,
      footLift: { right: false, left: false },
      sitUnsupported: "no",
    });
  });

  it("fills Parkinson's map without a question", () => {
    const ui = fresh(["parkinsons"]);
    expect(ui.fillReady).toBe(true);
    expect(ui.drafts.map((d) => `${d.region}:${d.side}`)).toEqual([
      "neck:axial",
      "back_trunk:axial",
      "shoulder:both",
      "hip:both",
    ]);
  });
});

describe("a saved map (editing the form)", () => {
  it("reads the condition answers back from the map, so nothing is asked again and the map stays as saved", () => {
    const saved = [...strokeRight.filter((e) => e.region !== "elbow"), kneeLeftPain];
    expect(inferFill(saved, ["stroke"])).toEqual({ stroke: "right" });
    const ui = initialUi({ regions: saved }, ["stroke"]);
    expect(ui).toMatchObject({ fillReady: true, confirmed: true, fill: { stroke: "right" } });
    expect(applyFill(ui, ["stroke"])).toBe(ui);
    expect(ui.drafts).toEqual(saved);
  });

  it("reads the answer that fits the map best: limbs of MS, the pattern of CP, a limb loss level", () => {
    const ms = autoFillRegions([{ condition: "ms", limbs: ["right_arm", "left_leg"] }]);
    expect(inferFill(ms, ["ms"])).toEqual({ ms: ["right_arm", "left_leg"] });
    const cp = autoFillRegions([{ condition: "cerebral_palsy", pattern: "all_limbs" }]);
    expect(inferFill(cp, ["cerebral_palsy"])).toEqual({ cerebral_palsy: { pattern: "all_limbs" } });
    const legs = autoFillRegions([{ condition: "cerebral_palsy", pattern: "both_legs" }]);
    expect(inferFill(legs, ["cerebral_palsy"])).toEqual({ cerebral_palsy: { pattern: "both_legs" } });
    const loss = autoFillRegions([{ condition: "lower_limb_unilateral", side: "left", level: "below_knee" }]);
    expect(inferFill(loss, ["lower_limb_unilateral"])).toEqual({
      lower_limb_unilateral: { side: "left", level: "below_knee" },
    });
  });

  it("leaves a question open when the map holds none of its answers", () => {
    expect(inferFill([kneeLeftPain], ["stroke"])).toEqual({});
    const ui = initialUi({ regions: [kneeLeftPain] }, ["stroke"]);
    expect(ui.fillReady).toBe(false);
    expect(initialUi({ regions: [] }, []).none).toBe(true);
  });
});

describe("the fields it writes", () => {
  it("writes every field once the answers are complete, with the support side from the map", () => {
    expect(stepAnswers(complete, ctx())).toEqual({
      sex: "female",
      regions: [kneeLeftPain],
      walking: { status: "with_aid", aid: "walker" },
      heightCm: 160,
      romFlags: { osteoporosis: false, neckCaution: false },
      support: "none",
    });
    const flags = { osteoporosis: false, neckCaution: false, sitUnsupported: "yes" as const };
    expect(stepAnswers({ ...fahd({ confirmed: true }), flags }, ctx(["stroke"])).support).toBe("right");
  });

  it("keeps each field undefined until it is complete", () => {
    expect(stepAnswers(fresh(), ctx())).toEqual({
      sex: undefined,
      regions: undefined,
      walking: undefined,
      heightCm: undefined,
      romFlags: undefined,
      support: "none",
    });
    expect(stepAnswers({ ...complete, aid: undefined }, ctx()).walking).toBeUndefined();
    expect(
      stepAnswers(
        { ...complete, drafts: [{ region: "knee", side: "left", problems: ["injury"], origin: "person" }] },
        ctx(),
      ).regions,
    ).toBeUndefined();
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

  it("gives the support side of a weakness on one side only", () => {
    expect(supportOf(strokeRight)).toBe("right");
    expect(supportOf([{ region: "knee", side: "both", problems: ["weakness"] }])).toBe("none");
    expect(supportOf([{ region: "neck", side: "axial", problems: ["weakness"] }])).toBe("none");
    expect(supportOf([kneeLeftPain])).toBe("none");
    expect(supportOf([{ region: "hip", side: "left", problems: ["weakness", "pain"] }])).toBe("left");
    expect(supportOf([])).toBe("none");
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

describe("the summary of the filled parts", () => {
  it("names the problem, the side and the parts", () => {
    expect(fillSummary("ar", strokeRight)).toEqual([
      "ضعف في الجهة اليمنى: الكتف، والمرفق، والساعد والرسغ، والورك، والركبة، والكاحل والقدم",
    ]);
    expect(fillSummary("en", strokeRight)).toEqual([
      "Weakness on the right side: shoulder, elbow, forearm and wrist, hip, knee, and ankle and foot",
    ]);
  });

  it("groups by side and problem, with the axial parts on their own", () => {
    const pd = autoFillRegions([{ condition: "parkinsons", confirmed: true }]);
    expect(fillSummary("en", pd)).toEqual([
      "Stiffness: neck and back or trunk",
      "Stiffness on both sides: shoulder and hip",
    ]);
    const cp = autoFillRegions([{ condition: "cerebral_palsy", pattern: "both_legs" }]);
    expect(fillSummary("ar", cp)).toEqual(["ضعف وتيبّس في الجهتين: الورك، والركبة، والكاحل والقدم"]);
    // The parts the person added are not in it.
    expect(fillSummary("en", [kneeLeftPain])).toEqual([]);
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

describe("the first step on screen", () => {
  const render = (p: Partial<IntakeV7AboutProps>) =>
    renderToStaticMarkup(
      createElement(IntakeV7About, {
        lang: "ar",
        context: ctx(),
        value: {},
        ui: null,
        onUi: () => {},
        onChange: () => {},
        age: createElement("i", null, "[age]"),
        conditionField: createElement("i", null, "[conditions]"),
        mobilityField: createElement("i", null, "[mobility]"),
        ...p,
      }),
    );

  it("places age and sex, the conditions, the condition question, how the person exercises and walking", () => {
    const text = plain(render({ context: ctx(["stroke"]) }));
    const at = [
      "[age]",
      "الجنس",
      "[conditions]",
      ROM_DATA.conditionAutoMap[0].ask.ar,
      "[mobility]",
      "هل تستطيع المشي؟",
    ].map((line) => text.indexOf(line));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // No apply button: the answer fills the map at once.
    expect(text).not.toContain("اعرض الأجزاء على الخريطة");
    expect(text).not.toContain("طولك بالسنتيمتر");
  });

  it("asks no question of Parkinson's, and no walking question in bed", () => {
    const pd = ROM_DATA.conditionAutoMap.find((r) => r.condition === "parkinsons")!.ask.ar;
    expect(plain(render({ context: ctx(["parkinsons"]) }))).not.toContain(pd);
    expect(plain(render({ context: ctx(["none"], "bed") }))).not.toContain("هل تستطيع المشي؟");
  });

  it("asks the optional height of a walker", () => {
    const text = plain(render({ ui: { ...fresh(), walking: "without_aid" } }));
    expect(text).toContain("طولك بالسنتيمتر");
    expect(text).toContain("اختياري");
  });
});

describe("the second step on screen", () => {
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

  it("shows a stroke's filled parts in one line with one confirmation, and never asks their problem type", () => {
    const html = render({ ui: fahd(), context: ctx(["stroke"]), lang: "en" });
    const text = plain(html);
    expect(text).toContain("We filled in the map from your medical condition");
    expect(text).toContain(fillSummary("en", strokeRight)[0]);
    expect(html).toMatch(/class="intake7-confirm" aria-pressed="false"/);
    expect(text).toContain("These parts are right");
    expect(html).not.toContain('class="intake7-card"');
    expect(text).not.toContain("What is the problem in this part?");
    expect(text).not.toContain(romCopy("problem_ask").en);
    // The map lights the six parts.
    expect(html.match(/data-lit="true"/g)).toHaveLength(6);
  });

  it("asks one quick choice for a part added by hand, the most common problems first, and no limb loss", () => {
    const ui: V7Ui = {
      ...fahd({ confirmed: true }),
      drafts: [...strokeRight, { region: "knee", side: "left", problems: [], origin: "person" }],
    };
    const html = render({ ui, context: ctx(["stroke"]), lang: "en" });
    expect(html.match(/class="intake7-card"/g)).toHaveLength(1);
    expect(html).toContain('data-region="knee:left"');
    expect(plain(html)).toContain("Knee, left side");
    expect([...html.matchAll(/data-problem="([a-z_]+)"/g)].map((m) => m[1])).toEqual([
      "pain",
      "stiffness",
      "weakness",
      "injury",
      "after_surgery",
    ]);
  });

  it("asks the injury or surgery questions only with that problem, and names the parts that miss answers", () => {
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
        { region: "neck", side: "axial", problems: ["pain"], origin: "person" },
      ],
    };
    const html = render({ ui, lang: "en", showMissing: true });
    const text = plain(html);
    expect(text).toContain("Ankle and foot, right side");
    expect(text).toContain(romCopy("injury_when").en);
    expect(text).toContain(romCopy("achilles_ask").en);
    expect(text).toContain(romCopy("surgery_cleared").en);
    expect(text).toContain("Was the surgery a hip replacement?");
    expect(html.match(/Finish the answers for this part\./g)).toHaveLength(2);
    // A pain needs nothing more.
    const neck = render({ ui: { ...ui, drafts: [ui.drafts[2]] }, lang: "en" });
    expect(plain(neck)).not.toContain(romCopy("injury_when").en);
    expect(plain(neck)).not.toContain(romCopy("surgery_when").en);
  });

  it("asks the person to confirm the filled parts after a Continue that could not go on", () => {
    const text = plain(render({ ui: fahd(), context: ctx(["stroke"]), showMissing: true }));
    expect(text).toContain("أكّد المناطق، أو اضغط على الخريطة لتعديلها.");
  });

  it("keeps a chosen limb loss chip visible on a part that cannot hold one, so it can be unticked", () => {
    const ui: V7Ui = {
      ...complete,
      drafts: [{ region: "neck", side: "axial", problems: ["limb_loss"], origin: "report" }],
    };
    const html = render({ ui, lang: "en" });
    expect(html).toMatch(/aria-pressed="true"[^>]*>Limb loss/);
    expect(stepAnswers(ui, ctx()).regions).toBeUndefined();
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
        // 3 months or more: only when is stored (D-024, A2-8).
        surgery: { since: "gt6m" },
      },
    ]);
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

  it("offers «لا يتأثر أي جزء من جسمي» on an empty map, and the report's suggestions with Add", () => {
    const text = plain(
      render({ report: { regions: [{ region: "neck", side: "axial", problems: ["pain"] }], pain: [] } }),
    );
    expect(text).toContain("لا يتأثر أي جزء من جسمي");
    expect(text).toContain("ذكر تقريرك هذه الأجزاء");
    expect(text).toContain("أضف");
  });

  it("puts the form's own safety questions first, then the safety answers of the condition", () => {
    const html = render({
      context: ctx(["stroke"]),
      ui: fahd({ confirmed: true }),
      safety: createElement("i", null, "[warning signs]"),
    });
    const text = plain(html);
    const at = [
      "أسئلة لسلامتك",
      "[warning signs]",
      romCopy("bones_ask").ar,
      romCopy("neck_ask").ar,
      romCopy("sit_unsupported_ask").ar,
      romCopy("foot_lift_ask").ar,
    ].map((line) => text.indexOf(line));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).not.toContain(romCopy("transfer_chair_ask").ar);
  });

  it("lists the answer that lets the person go ahead first: no for bones and neck, yes for sitting and the foot (D-035 item 5)", () => {
    const html = render({ context: ctx(["stroke"]), ui: fahd({ confirmed: true }) });
    const first = (id: "bones_ask" | "neck_ask" | "sit_unsupported_ask" | "foot_lift_ask") => {
      const at = html.indexOf(romCopy(id).ar);
      expect(at, id).toBeGreaterThan(0);
      return plain(html.slice(at).match(/<button[^>]*>.*?<\/button>/s)![0]).trim();
    };
    expect(first("bones_ask")).toBe(romCopy("ans_no").ar);
    expect(first("neck_ask")).toBe(romCopy("ans_no").ar);
    expect(first("sit_unsupported_ask")).toBe(romCopy("ans_yes").ar);
    expect(first("foot_lift_ask")).toBe(romCopy("ans_yes").ar);
  });

  it("asks the chair transfer in a wheelchair, and titles the map with the arthritis question and its type", () => {
    expect(plain(render({ context: ctx(["none"], "wheelchair"), lang: "en" }))).toContain(
      romCopy("transfer_chair_ask").en,
    );
    const text = plain(render({ context: ctx(["arthritis"]), lang: "en" }));
    expect(text).toContain("Which of your joints does your medical condition affect?");
    expect(text).toContain(romCopy("arthritis_type_ask").en);
  });
});

describe("the consent (D-034 item 4: it covers the check)", () => {
  it("names the health answers, the movement and walk results with the video, and the Live coach", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = renderToStaticMarkup(createElement(IntakeV7Consent, { lang }));
      const lines = [...html.matchAll(/<span class="intake7-consent-line">([^<]*)<\/span>/g)].map(
        (m) => m[1],
      );
      expect(lines).toEqual(
        [labels(lang).consent, tV7(lang, "rom.formConsent"), tV7(lang, "coach.formConsent")].map((l) =>
          l.replace(/"/g, "&quot;"),
        ),
      );
    }
    expect(tV7("ar", "rom.formConsent")).toContain("والفيديو لا يغادر هاتفي");
  });
});

describe("the review rows (My condition)", () => {
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
