/**
 * Step C4: the walk's screens and the gait card, rendered on the server. Each step of an overground
 * and a pad walk shows its own screen (the phone's placement drawing on the placement steps; no red STOP
 * since D-034 item 4, the shell's X stops the walk; «لن أمشي اليوم» hidden once set up), in Arabic and
 * English with no missing copy; the card shows the pattern lines only while provisional (C-13), the
 * possible reasons, program lines and referrals once final, the approximate label on a result read
 * against the interim norms (CG-16, AP-12), the no pattern line, and the quality notes.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GaitController, type GaitStepId } from "../../src/features/gait/controller";
import { GaitScreen, instructionText, fixtureFor } from "../../src/features/gait/GaitCapture";
import { GaitFindingsCard, keyNumbers } from "../../src/features/gait/GaitFindingsCard";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import type { GaitPatternResult, GaitStoredView } from "../../src/medical/gait-types";
import { GAIT_DATA } from "../../src/movements/gait";
import { romResultLine } from "../../src/movements/rom";

const PLAN: GaitPlan = {
  offered: true,
  modes: ["overground", "walking_pad"],
  defaultMode: "overground",
  padAllowed: true,
  helperRequired: true,
  antalgicOnly: false,
  staticStance: true,
  views: {
    overground: ["front", "back", "side"],
    walking_pad: [
      { view: "pad_side", nearSide: "right" },
      { view: "pad_side", nearSide: "left" },
      { view: "pad_front" },
    ],
  },
};

const render = (ctl: GaitController, lang: "ar" | "en") =>
  renderToStaticMarkup(
    createElement(GaitScreen, {
      lang,
      ctl,
      now: 0,
      clock: () => 0,
      stage: (compact: boolean) =>
        createElement("div", { className: compact ? "stage is-compact" : "stage" }),
    }),
  );

/** Walks a controller through its steps by taps, rendering each; stops at the first recording. */
function screens(mode: "overground" | "walking_pad", lang: "ar" | "en") {
  const ctl = new GaitController({ plan: PLAN, poseModel: () => "full" });
  ctl.start(0);
  const out: { id: GaitStepId; html: string }[] = [];
  for (let i = 0; i < 30; i++) {
    const s = ctl.current.id;
    out.push({ id: s, html: render(ctl, lang) });
    if (s === "mode") ctl.chooseMode(mode, 0);
    else if (s === "gear") ctl.setGear({ shoes: true, brace: null }, 0);
    else if (s === "stand") break;
    else if (!ctl.confirm(0)) break;
  }
  return { ctl, out };
}

const TEXT = (html: string) => html.replace(/<[^>]+>/g, " ");

describe("the walk's screens", () => {
  for (const lang of ["ar", "en"] as const)
    for (const mode of ["overground", "walking_pad"] as const)
      it(`shows each setup step of a ${mode} walk (${lang})`, () => {
        const { out } = screens(mode, lang);
        const ids = out.map((o) => o.id);
        expect(ids[0]).toBe("intro");
        expect(ids).toContain("place");
        for (const o of out) {
          expect(o.html).toContain(`data-step="${o.id}"`);
          expect(TEXT(o.html)).not.toMatch(/undefined|gait\.[a-z]/);
          // Arabic first: an Arabic screen holds Arabic letters.
          if (lang === "ar") expect(o.html).toMatch(/[؀-ۿ]/);
        }
        const place = out.find((o) => o.id === "place")!.html;
        expect(place).toContain('role="img"');
        expect(place).toContain("gx-placement");
        // D-034 item 4: no red STOP; the shell's X stops the walk. Item 5: the phone's setup says
        // nothing has started, and its Ready is in the sticky bar.
        expect(place).not.toContain("safety-stop");
        expect(place).toContain('data-state="not-started"');
        expect(place).toMatch(/<div class="fx-actions is-sticky">(?:(?!<\/div>).)*data-action="ready"/s);
        // The intro names the helper the plan needs and the stop line.
        const intro = out[0].html;
        expect(intro).toContain(GAIT_DATA.copy.setup.helper_needed[lang]);
        expect(intro).toContain(GAIT_DATA.copy.setup.stop_any_time[lang]);
        if (mode === "walking_pad") {
          for (const id of ["pad_check", "pad_on"] as const) expect(ids).toContain(id);
          // D-032 item 2: every pad safety step on one checklist with one Ready.
          const check = out.find((o) => o.id === "pad_check")!.html;
          expect(check).toContain(GAIT_DATA.copy.setup.pad_key[lang]);
          expect(check).toContain(GAIT_DATA.copy.setup.pad_auto_off[lang]);
          expect(check.match(/data-action="ready"/g)).toHaveLength(1);
        } else
          expect(out.find((o) => o.id === "clear_path")!.html).toContain(
            GAIT_DATA.copy.setup.clear_path[lang],
          );
      });

  it("hides the slot's skip once the person is set up to walk, with no red STOP (D-034 item 4)", () => {
    const { ctl, out } = screens("walking_pad", "ar");
    expect(out[0].html).toContain('data-skip="on"');
    expect(ctl.current.id).toBe("stand");
    const stand = render(ctl, "ar");
    expect(stand).toContain('data-skip="off"');
    expect(stand).not.toContain("safety-stop");
    expect(out.find((o) => o.id === "pad_on")!.html).toContain('data-skip="off"');
  });

  it("names the near side on the pad's side placement, and the instruction text follows the step", () => {
    const ctl = new GaitController({ plan: PLAN, poseModel: () => "full" });
    ctl.start(0);
    ctl.confirm(0);
    ctl.chooseMode("walking_pad", 0);
    ctl.setGear({ shoes: true, brace: null }, 0);
    // The pad safety checklist: one Ready (D-032 item 2).
    expect(ctl.current.id).toBe("pad_check");
    ctl.confirm(0);
    expect(ctl.current).toEqual({ id: "place", rec: "pad_side_a" });
    expect(render(ctl, "ar")).toContain("ضع الهاتف على جهتك اليمنى");
    expect(render(ctl, "en")).toContain("Place the phone on your right side");
    expect(instructionText(ctl, "en")).toContain("about 3 metres away");
    expect(fixtureFor(ctl)).toBe("gait/pad-side-right");
  });
});

describe("the pad's second side view (D-030 C4-3)", () => {
  it("says the helper moves the phone while the belt is stopped, then the belt starts again", () => {
    const ctl = new GaitController({ plan: PLAN, poseModel: () => "full" });
    ctl.start(0);
    ctl.confirm(0);
    ctl.chooseMode("walking_pad", 0);
    const at = ctl.plannedSteps.findIndex((x) => x.id === "place" && x.rec === "pad_side_b");
    (ctl as unknown as { go(index: number, now: number): void }).go(at, 0);
    expect(ctl.current).toEqual({ id: "place", rec: "pad_side_b" });
    for (const lang of ["ar", "en"] as const)
      expect(TEXT(render(ctl, lang))).toContain(GAIT_DATA.copy.setup.pad_other_side[lang]);
    expect(GAIT_DATA.copy.setup.pad_other_side.en).not.toMatch(/keep walking/i);
  });
});

/* ------------------------------------------------------------ the card */

function pattern(over: Partial<GaitPatternResult> = {}): GaitPatternResult {
  return {
    pattern: "trendelenburg",
    label: "trendelenburg",
    side: "right",
    status: "possible",
    confidence: "moderate",
    evidence: [],
    contributors: ["weak_hip_abductors"],
    targets: [{ id: "strengthen:hip_abductors" as never, side: "right" }],
    referrals: ["refer_new_or_worse"],
    lines: {
      pattern: {
        ar: "قد تشير طريقة مشيك إلى أن حوضك ينخفض.",
        en: "Your walk may suggest that your hips dip.",
      },
      reasons: { ar: "ومن الأسباب الممكنة ضعف.", en: "Possible reasons include weaker hip muscles." },
      targets: [{ ar: "لذلك أضفنا إلى برنامجك تمارين.", en: "So we added exercises to your program." }],
      confidence: { ar: "مدى تأكدنا: متوسط", en: "How sure we are: Moderate" },
    },
    ...over,
  };
}

function stored(over: Partial<GaitStoredView> = {}): GaitStoredView {
  return {
    id: "g1",
    mode: "overground",
    views: [],
    metrics: {
      cadence: { id: "cadence", value: 104.4, n: 10, unit: "steps/min", grade: "A" },
      speed_mps: { id: "speed_mps", value: 1.123, n: 10, unit: "m/s", grade: "B" },
      step_length_m: { id: "step_length_m", value: 0.648, n: 10, unit: "m", grade: "B" },
    },
    patterns: [pattern()],
    findings: [],
    quality: { gatePassed: true, timingOnly: false, flags: [] },
    replay: null,
    provisional: false,
    rulesVersion: "gait_rules_1.0.0",
    created: 0,
    ...over,
  };
}

const card = (gait: GaitStoredView, lang: "ar" | "en" = "en") =>
  renderToStaticMarkup(createElement(GaitFindingsCard, { gait, lang }));

describe("the gait card", () => {
  it("shows the pattern lines only while provisional (C-13)", () => {
    const html = card(stored({ provisional: true }));
    expect(html).toContain("Your walk may suggest that your hips dip.");
    expect(html).toContain("How sure we are: Moderate");
    expect(html).not.toContain("Possible reasons include");
    expect(html).not.toContain("So we added");
    expect(html).not.toContain(GAIT_DATA.copy.referrals.refer_new_or_worse.en);
  });

  it("shows the possible reasons, the program lines and the referrals once final", () => {
    const html = card(stored());
    expect(html).toContain("Possible reasons include weaker hip muscles.");
    expect(html).toContain("So we added exercises to your program.");
    expect(html).toContain(GAIT_DATA.copy.referrals.refer_new_or_worse.en);
  });

  it("labels a result read against the interim norms as approximate (CG-16, AP-12)", () => {
    const html = card(
      stored({
        patterns: [
          pattern({ pattern: "short_steps", label: "short_steps", side: "both", flags: ["norm_interim"] }),
        ],
        findings: [{ id: "slow_speed", side: "none", value: 0.7, status: null, flags: ["norm_interim"] }],
      }),
    );
    const approx = romResultLine("label_approximate").en;
    expect(html.split(approx).length - 1).toBe(2);
    expect(html).toContain(GAIT_DATA.copy.metrics.slow_speed.en);
    expect(card(stored())).not.toContain(approx);
  });

  it("says no pattern was seen when none is shown, and that the walk was not clear when no view passed", () => {
    expect(card(stored({ patterns: [pattern({ status: "not_seen", confidence: null })] }), "ar")).toContain(
      GAIT_DATA.copy.patterns.no_pattern.ar,
    );
    const unclear = card(stored({ quality: { gatePassed: false, timingOnly: false, flags: [] } }));
    expect(unclear).toContain("We could not see your steps clearly enough this time.");
    expect(unclear).not.toContain("Your walk may suggest");
  });

  it("notes the handrail, timing only and the pad from the clinical copy", () => {
    const html = card(
      stored({
        mode: "walking_pad",
        quality: { gatePassed: true, timingOnly: true, flags: ["handrail_firm"] },
      }),
    );
    expect(html).toContain(GAIT_DATA.copy.quality.handrail_held.en);
    expect(html).toContain(GAIT_DATA.copy.quality.quality_timing_only.en);
    expect(html).toContain(GAIT_DATA.copy.quality.pad_compare.en);
  });

  it("gives the walk's key numbers in Western digits in both languages (D-036 item 3)", () => {
    expect(keyNumbers(stored(), "en").map((n) => n.value)).toEqual(["104", "1.12", "65"]);
    expect(keyNumbers(stored(), "ar").map((n) => n.value)).toEqual(["104", "1.12", "65"]);
    expect(keyNumbers(stored({ metrics: {} }), "en")).toEqual([]);
  });

  it("draws one step cycle when the walk kept one, never a picture", () => {
    const html = card(
      stored({
        replay: {
          side: "right",
          fps: 15,
          landmarks: [0, 11, 12, 23, 24, 25, 26, 27, 28],
          frames: [
            [
              [0.5, 0.1],
              [0.45, 0.25],
              [0.55, 0.25],
              [0.46, 0.5],
              [0.54, 0.5],
              [0.46, 0.7],
              [0.55, 0.7],
              [0.46, 0.9],
              [0.56, 0.9],
            ],
          ],
        },
      }),
    );
    expect(html).toContain("gx-replay");
    expect(html).toContain("gx-bone is-side");
    expect(html).not.toMatch(/<img|<video/);
  });
});
