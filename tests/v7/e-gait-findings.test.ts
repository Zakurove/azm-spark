/**
 * D-029 item 1, E2-4: the walk's support findings give targets (exercise-targets 5.4, the gaitPatterns
 * rows «(finding)»): slow_speed practice:walking, uneven_step_length practice:even_steps, at priority 2
 * for likely and for a finding with one rule, 1 for possible, each with a why line from the gait copy
 * (why_gait with the finding's own line). flat_or_forefoot_contact gives none.
 */
import { describe, expect, it } from "vitest";
import { wordingProblems } from "../../scripts/wording-rules.mjs";
import type { GaitSupportFinding } from "../../src/medical/gait-types";
import { createPlan, type Intake } from "../../src/medical/plan";
import type { TargetReason } from "../../src/medical/target-types";
import { collectTargets, targetedBuild, whyLine } from "../../src/medical/targets";
import { servesResult } from "../../src/medical/weekly";
import { programItems } from "../../src/features/program-v7/program";
import { FAHD, intake, pattern } from "./e-fixtures";

const REF = { checkId: "c1", romVersion: "r", gaitVersion: "g", targetsVersion: "t", created: 5 };
const slow: GaitSupportFinding = {
  id: "slow_speed",
  side: "none",
  value: 0.62,
  status: null,
  flags: ["norm_interim"],
};
const uneven = (status: "possible" | "likely", side: "left" | "right" = "right"): GaitSupportFinding => ({
  id: "uneven_step_length",
  side,
  value: status === "likely" ? 1.2 : 1.14,
  status,
});
const flat: GaitSupportFinding = { id: "flat_or_forefoot_contact", side: "left", value: -2, status: null };

/** A person who stands and walks, with an empty body map (so no region default joins the targets). */
const WALKER = intake();
const collect = (
  support: GaitSupportFinding[],
  h: Intake = WALKER,
  gait = [] as ReturnType<typeof pattern>[],
) => collectTargets({ intake: h, rom: [], gait, support });
const reasonOf = (f: GaitSupportFinding): TargetReason => ({
  kind: "gait_finding",
  id: f.id,
  side: f.side,
  status: f.status,
});

describe("the walk's support findings give targets (E2-4)", () => {
  it("slow_speed: practice:walking at priority 2 (a finding with one rule)", () => {
    const { targets } = collect([slow]);
    expect(targets).toEqual([
      expect.objectContaining({
        id: "practice:walking",
        side: "both",
        priority: 2,
        painFriendlyOnly: false,
        reasons: [reasonOf(slow)],
      }),
    ]);
  });

  it("uneven_step_length: practice:even_steps, priority 2 when likely and 1 when possible", () => {
    expect(collect([uneven("likely")]).targets).toEqual([
      expect.objectContaining({ id: "practice:even_steps", side: "both", priority: 2 }),
    ]);
    expect(collect([uneven("possible", "left")]).targets).toEqual([
      expect.objectContaining({
        id: "practice:even_steps",
        priority: 1,
        reasons: [reasonOf(uneven("possible", "left"))],
      }),
    ]);
  });

  it("flat_or_forefoot_contact gives none", () => {
    expect(collect([flat]).targets).toEqual([]);
  });

  it("says why with the finding's own line from the gait copy", () => {
    expect(whyLine([reasonOf(slow)])).toEqual({
      ar: "سرعة مشيك أبطأ من المعتاد لمن هم في عمرك. لذلك أضفنا هذا التمرين.",
      en: "Your walking speed is slower than typical for your age. So we added this exercise.",
    });
    expect(whyLine([reasonOf(uneven("likely", "right"))])).toEqual({
      ar: "خطوة ساقك اليمنى أقصر من خطوة الساق الأخرى. لذلك أضفنا هذا التمرين.",
      en: "The step of your right leg is shorter than the step of your other leg. So we added this exercise.",
    });
    const left = whyLine([reasonOf(uneven("possible", "left"))]);
    expect(left.ar).toContain("ساقك اليسرى");
    expect(left.en).toContain("your left leg");
    for (const l of [whyLine([reasonOf(slow)]), left])
      for (const lang of ["ar", "en"] as const) expect(wordingProblems(l[lang])).toEqual([]);
  });

  it("one target with a pattern's same target: both reasons, the higher priority, why_both", () => {
    const steps = pattern({
      pattern: "short_steps",
      label: "short_steps",
      side: "both",
      status: "possible",
      confidence: "moderate",
      targets: [{ id: "practice:walking", side: "both" }],
    });
    const { targets } = collect([slow], WALKER, [steps]);
    const walking = targets.filter((t) => t.id === "practice:walking");
    expect(walking).toHaveLength(1);
    expect(walking[0].priority).toBe(2);
    expect(walking[0].reasons.map((r) => r.kind)).toEqual(["gait", "gait_finding"]);
    const line = whyLine(walking[0].reasons);
    expect(line.ar.startsWith("يدعم هذا التمرين نتيجتين:")).toBe(true);
    expect(line.ar).toContain("سرعة مشيك أبطأ من المعتاد لمن هم في عمرك");
    expect(line.en).toContain("your walking speed is slower than typical for your age");
  });

  it("the week: walking practice for a person who walks, said why, and linked to the walk's result", () => {
    const build = targetedBuild(FAHD, createPlan(FAHD), [], [], REF, { support: [slow] })!;
    const item = build.items.find((i) => i.reasons.some((r) => r.kind === "gait_finding"));
    expect(item).toBeDefined();
    expect(item!.targets).toContain("practice:walking");
    expect(item!.why.en).toBe(
      "Your walking speed is slower than typical for your age. So we added this exercise.",
    );
    expect(servesResult(item!.reasons)).toBe(true);
    const shown = programItems(build.weekly, "en").find((i) => i.id === item!.exerciseId);
    expect(shown?.result).toBe(true);
  });

  it("no walking practice for a person who does not walk: the target is unmet", () => {
    const h = intake({ mobility: "wheelchair", walking: { status: "no" } });
    const build = targetedBuild(h, createPlan(h), [], [], REF, { support: [slow] })!;
    expect(build.items.some((i) => i.reasons.some((r) => r.kind === "gait_finding"))).toBe(false);
    expect(build.unmet.map((t) => t.id)).toContain("practice:walking");
  });
});
