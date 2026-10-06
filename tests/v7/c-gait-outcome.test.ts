/**
 * D-030 item 2, C4-5: the stored walk keeps its outcome, so the gait card can say the walk ended for
 * pain. The walk's body carries `analysis.outcome` (pain_limited or stopped; absent for a walk that
 * finished), the gait route accepts only those two, keeps it with the walk and answers it in the
 * stored view, and the card says the pain line for a pain limited walk.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkGaitBody } from "../../server/modules/focus/validate";
import { GaitFindingsCard } from "../../src/features/gait/GaitFindingsCard";
import { qualityLine } from "../../src/features/gait/copy";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import type { GaitStoredView } from "../../src/medical/gait-types";
import { gaitBody } from "./a-focus-bodies";

const PLAN: GaitPlan = {
  offered: true,
  modes: ["overground"],
  defaultMode: "overground",
  padAllowed: false,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: false,
  views: { overground: ["side", "front"], walking_pad: [] },
};

describe("the walk's outcome in the gait body", () => {
  it("is pain_limited or stopped, or absent", () => {
    for (const outcome of ["pain_limited", "stopped", undefined]) {
      const body = gaitBody(PLAN, "overground") as { analysis: Record<string, unknown> };
      if (outcome) body.analysis.outcome = outcome;
      expect(checkGaitBody(body as never, PLAN).ok, String(outcome)).toBe(true);
    }
    const bad = gaitBody(PLAN, "overground") as { analysis: Record<string, unknown> };
    bad.analysis.outcome = "bored";
    expect(checkGaitBody(bad as never, PLAN)).toEqual({ ok: false, field: "analysis.outcome" });
  });
});

describe("the gait card of a walk that ended for pain", () => {
  const view = (over: Partial<GaitStoredView> = {}): GaitStoredView => ({
    id: "g1",
    mode: "overground",
    views: [{ view: "side", metrics: {}, cleanCycles: { left: 4, right: 3 } }],
    metrics: {},
    patterns: [],
    findings: [],
    quality: { gatePassed: false, timingOnly: false, flags: [] },
    replay: null,
    provisional: true,
    rulesVersion: "gait_rules_test",
    created: 0,
    ...over,
  });
  const text = (g: GaitStoredView, lang: "ar" | "en") =>
    renderToStaticMarkup(createElement(GaitFindingsCard, { gait: g, lang })).replace(/<[^>]+>/g, " ");

  it("says the walk ended because of the pain, in both languages", () => {
    for (const lang of ["ar", "en"] as const) {
      expect(text(view({ outcome: "pain_limited" }), lang)).toContain(qualityLine("pain_limited", lang));
      expect(text(view(), lang)).not.toContain(qualityLine("pain_limited", lang));
      expect(text(view({ outcome: "stopped" }), lang)).not.toContain(qualityLine("pain_limited", lang));
    }
  });
});
