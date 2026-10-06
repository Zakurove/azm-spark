/**
 * Step E2 (product v7 contract 2.10, 8.1 E): whyLine, the one line that says why an exercise is in the
 * program, from the signed off templates (exercise-targets 5.9 whyLines), Arabic first with complete
 * English: the range finding's line with the movement and its side, the pattern's own line of the walk,
 * the region and the wheelchair lines, and why_both for an exercise that serves two results. Every line
 * passes the wording rules and keeps no placeholder.
 */
import { describe, expect, it } from "vitest";
import { wordingProblems } from "../../scripts/wording-rules.mjs";
import { gaitPatternLines } from "../../src/medical/gait-rules";
import type { GaitPatternId } from "../../src/medical/gait-types";
import type { CausePath } from "../../src/medical/rom-types";
import type { TargetReason } from "../../src/medical/target-types";
import { whyLine } from "../../src/medical/targets";
import { GAIT_DATA } from "../../src/movements/gait";
import { ROM_DATA } from "../../src/movements/rom";
import { TARGETS_DATA } from "../../src/movements/targets";

const template = (id: string) => TARGETS_DATA.whyLines.find((w) => w.id === id)!;
const rom = (over: Partial<Extract<TargetReason, { kind: "rom" }>> = {}): TargetReason => ({
  kind: "rom",
  movementId: "knee_flexion",
  side: "right",
  finding: "mild",
  path: "weak",
  ...over,
});
const gait = (over: Partial<Extract<TargetReason, { kind: "gait" }>> = {}): TargetReason => ({
  kind: "gait",
  pattern: "reduced_extension",
  label: "reduced_extension",
  side: "right",
  status: "likely",
  confidence: "high",
  ...over,
});

describe("a range finding's line", () => {
  it("names the movement and the side (why_rom_limited)", () => {
    expect(template("why_rom_limited").ar).toBe(
      "لأن نتيجة {movement_ar} في الجهة {sideF} كانت أقل من المعتاد، أضفنا هذا التمرين.",
    );
    expect(whyLine([rom()])).toEqual({
      ar: "لأن نتيجة ثني الركبة في الجهة اليمنى كانت أقل من المعتاد، أضفنا هذا التمرين.",
      en: "Because your knee bend on the right side was below typical, we added this exercise.",
    });
    expect(whyLine([rom({ movementId: "shoulder_flexion", side: "left" })]).en).toBe(
      "Because your arm raise to the front on the left side was below typical, we added this exercise.",
    );
  });

  it("an axial movement without a side (why_rom_limited_axial), a side bend with its direction", () => {
    expect(whyLine([rom({ movementId: "trunk_flexion", side: "none" })])).toEqual({
      ar: "لأن نتيجة الانحناء إلى الأمام كانت أقل من المعتاد، أضفنا هذا التمرين.",
      en: "Because your bending forward was below typical, we added this exercise.",
    });
    expect(whyLine([rom({ movementId: "trunk_lateral_flexion", side: "left" })]).ar).toBe(
      "لأن نتيجة الميل إلى الجانب في الجهة اليسرى كانت أقل من المعتاد، أضفنا هذا التمرين.",
    );
  });

  it("a movement that stopped with pain, or a pain path (why_rom_pain)", () => {
    const pain = {
      ar: "لأن ثني الركبة توقف بسبب الألم، أضفنا حركة لطيفة ضمن المدى المريح لك.",
      en: "Because your knee bend stopped with pain, we added a gentle movement within your comfortable range.",
    };
    expect(whyLine([rom({ finding: "pain_limited", path: "pain_irritable" })])).toEqual(pain);
    expect(whyLine([rom({ finding: "mild", path: "pain_stable" })])).toEqual(pain);
  });

  it("a joint the camera could not grade reads as the region's line; a shoulder that could not move as limited", () => {
    const region = { ar: template("why_region").ar, en: template("why_region").en };
    expect(
      whyLine([rom({ movementId: "knee_extension", finding: "unknown", path: "rehab", side: "left" })]),
    ).toEqual(region);
    expect(whyLine([rom({ movementId: "knee_extension", finding: "no_grade" })])).toEqual(region);
    expect(whyLine([rom({ movementId: "shoulder_flexion", finding: "unknown", path: "umn" })]).en).toBe(
      "Because your arm raise to the front on the right side was below typical, we added this exercise.",
    );
  });
});

describe("a pattern's line", () => {
  it("is the walk's own line on its side, then «لذلك أضفنا هذا التمرين.»", () => {
    const line = GAIT_DATA.copy.patterns.reduced_extension;
    expect(whyLine([gait()])).toEqual({
      ar: `${line.ar.replace("{side_ar}", GAIT_DATA.copy.placeholders.side_ar[0])} لذلك أضفنا هذا التمرين.`,
      en: `${line.en.replace("{side_en}", "right")} So we added this exercise.`,
    });
  });

  it("leaves out «we will check this again» of a possible pattern at low confidence", () => {
    const w = whyLine([gait({ status: "possible", confidence: "low", side: "left" })]);
    expect(w.en).not.toContain(GAIT_DATA.copy.patterns.possible_suffix.en);
    expect(w.en).toContain("your left leg");
  });
});

describe("why_both and the other lines", () => {
  it("joins two results in one line", () => {
    const w = whyLine([rom(), gait({ pattern: "stiff_knee", label: "stiff_knee" })]);
    expect(
      w.ar.startsWith(
        "يدعم هذا التمرين نتيجتين: نتيجة ثني الركبة في الجهة اليمنى كانت أقل من المعتاد، وقد تشير طريقة مشيك",
      ),
    ).toBe(true);
    expect(w.en).toBe(
      "This exercise supports two results: your knee bend on the right side was below typical, and your walk may suggest that your right knee bends less than usual when you swing your leg forward.",
    );
    // The same reason twice is one result.
    expect(whyLine([rom(), rom()])).toEqual(whyLine([rom()]));
  });

  it("the region and the wheelchair lines, which are not results, take the first reason's line", () => {
    expect(whyLine([{ kind: "region_default", region: "shoulder", side: "right" }]).en).toBe(
      template("why_region").en,
    );
    const block: TargetReason = { kind: "mobility_default", block: "wheelchair_shoulder" };
    expect(whyLine([block])).toEqual({
      ar: template("why_wheelchair_shoulder").ar,
      en: template("why_wheelchair_shoulder").en,
    });
    expect(whyLine([block, rom()]).en).toBe(template("why_wheelchair_shoulder").en);
  });

  it("the arthritis add on says why_arthritis (D-029 item 1, E2-9)", () => {
    const line = template("why_arthritis");
    expect(line.ar).toBe("لأنك ذكرت أن التهاب المفاصل جزء من حالتك الطبية، أضفنا هذا التمرين.");
    expect(line.en).toBe(
      "Because you told us arthritis is part of your medical condition, we added this exercise.",
    );
    // The add on's reasons lead with its own, then the range finding it was added to.
    expect(whyLine([{ kind: "arthritis", region: "knee" }, rom({ finding: "pain_limited" })])).toEqual({
      ar: line.ar,
      en: line.en,
    });
    // A target the finding asks for itself keeps the finding's line.
    expect(whyLine([rom(), { kind: "arthritis", region: "knee" }])).toEqual(whyLine([rom()]));
    expect(whyLine([])).toEqual({ ar: "", en: "" });
  });
});

describe("every line", () => {
  const PATHS: CausePath[] = [
    "post_op_early",
    "umn",
    "pd",
    "rehab",
    "tight",
    "weak",
    "pain_irritable",
    "pain_stable",
    "unknown",
  ];
  const reasons: TargetReason[][] = [];
  for (const m of ROM_DATA.movements)
    for (const side of m.region === "neck" || m.region === "back_trunk"
      ? (["none", "left", "right"] as const)
      : (["left", "right"] as const))
      for (const path of PATHS)
        for (const finding of ["mild", "marked", "pain_limited", "unknown", "no_grade"] as const)
          reasons.push([rom({ movementId: m.id, side, path, finding })]);
  for (const p of GAIT_DATA.patterns) {
    const labels = Array.isArray(p.targets) ? [p.id] : Object.keys(p.targets);
    for (const label of labels)
      for (const side of ["left", "right", "both"] as const)
        for (const [status, confidence] of [
          ["likely", "high"],
          ["possible", "low"],
        ] as const)
          reasons.push([gait({ pattern: p.id as GaitPatternId, label, side, status, confidence })]);
  }
  reasons.push([rom(), gait()], [{ kind: "region_default", region: "neck", side: "axial" }]);

  it("has no placeholder left and passes the wording rules, in both languages", () => {
    for (const r of reasons) {
      const w = whyLine(r);
      for (const lang of ["ar", "en"] as const) {
        expect(w[lang], JSON.stringify(r)).not.toBe("");
        expect(w[lang], JSON.stringify(r)).not.toMatch(/[{}]/);
        expect(wordingProblems(w[lang]), w[lang]).toEqual([]);
      }
    }
  });

  it("says «قد تشير» or «may suggest» for every pattern, as the gait rules do (no diagnosis)", () => {
    for (const p of GAIT_DATA.patterns) {
      const label = Array.isArray(p.targets) ? p.id : Object.keys(p.targets)[0];
      const line = gaitPatternLines({
        pattern: p.id as GaitPatternId,
        label,
        side: "right",
        status: "likely",
        confidence: "high",
        evidence: [],
        contributors: [],
        targets: [],
        referrals: [],
      }).pattern;
      const w = whyLine([gait({ pattern: p.id as GaitPatternId, label })]);
      expect(w.ar).toContain(line.ar);
      expect(w.en).toMatch(/may suggest/);
    }
  });
});
