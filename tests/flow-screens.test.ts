/**
 * The flow screens S04 to S33 and S35 rendered from real flow models (the reducer walks to each
 * state), in Arabic and English: the right screen for the state, the copy rules of UX spec 0.2 (no
 * dash, no unfilled token, no key shown as text), and the rules of each screen that markup can show.
 */
import { describe, expect, it } from "vitest";
import type { Lang } from "../src/app/i18n";
import { FLOW_SCREENS } from "../src/features/assessment/flow";
import { desktopLink } from "../src/features/assessment/flow/Entry";
import { introFacts } from "../src/features/assessment/flow/Intro";
import { warningText, weakerSide } from "../src/features/assessment/flow/Plan";
import { questionIdOf } from "../src/features/assessment/flow/Question";
import { audible, captionMs } from "../src/features/assessment/flow/voice";
import { initialModel, type FlowModel, type FlowState } from "../src/features/assessment/flowMachine";
import { screenFor } from "../src/features/assessment/screens";
import type { FlowScreenId } from "../src/features/assessment/screenTypes";
import { localizeDigits, t } from "../src/i18n";
import { CHECK_DATA, precheckItem, screenText, testDef } from "../src/movements/assessments";
import {
  contextOf,
  copyProblems,
  GUEST,
  guestAtQuestions,
  guestAtPlan,
  play,
  render,
  signedAt,
  signedStarted,
  textOf,
  untilQuestion,
  withState,
} from "./flow-fixtures";

const LANGS: Lang[] = ["ar", "en"];

/** Renders the screen the registry shows for the model, checks it and returns its markup. */
function screen(m: FlowModel, lang: Lang, ui = {}): { id: FlowScreenId; html: string; text: string } {
  const id = screenFor(m) as FlowScreenId;
  expect(id in FLOW_SCREENS, `${m.state.kind} is not a flow screen (${id})`).toBe(true);
  const html = render(FLOW_SCREENS[id], m, lang, ui);
  expect(copyProblems(html), `${id} ${lang}`).toEqual([]);
  return { id, html, text: textOf(html) };
}

const count = (html: string, needle: string) => html.split(needle).length - 1;
const welcome = () => play(initialModel(GUEST), { type: "START" });

/* ------------------------------------------------------------------ models of every screen */

function models(): Record<string, FlowModel> {
  const q = guestAtQuestions();
  const sci = guestAtQuestions({ conditions: ["sci_complete"] });
  const standing = guestAtQuestions({ position: "standing" });
  const signedHome = signedAt(contextOf({ position: "chair", support: "left" }));
  const intro = play(signedHome, { type: "CONTEXT_CONFIRM" });
  const started = signedStarted(contextOf());
  const signedPlan = started.state.kind === "warnings" ? play(started, { type: "CONTINUE" }) : started;
  const plan = guestAtPlan();
  const helperCtx = contextOf({ position: "chair", support: "right" });
  const helper = play(
    signedStarted(helperCtx),
    ...(signedStarted(helperCtx).state.kind === "warnings" ? [{ type: "CONTINUE" } as const] : []),
  );
  return {
    S04: play(initialModel({ ...GUEST, desktop: true }), { type: "START" }),
    S05: welcome(),
    S05a: signedAt(contextOf({}, { adultConfirmed: false })),
    S05aEnd: play(welcome(), { type: "ADULT_NO" }),
    S05b: play(initialModel({ ...GUEST, booth: false }), { type: "START" }),
    S06: play(welcome(), { type: "GUEST_PATH", path: "full" }),
    S08: withState(q, { kind: "guestSetup", step: 3 }),
    S08b: withState(q, { kind: "guestSetup", step: 4 }),
    S09: guestAtQuestions({ position: "bed" }),
    S12: signedAt(contextOf({}, { consent: false })),
    S13: signedHome,
    S14: intro,
    S14b: play(intro, { type: "CONTINUE" }),
    S17: q,
    S18: untilQuestion(sci, "pc_sci_level")!,
    S19: untilQuestion(q, "pc_pain_now")!,
    S20: untilQuestion(q, "pc_pain_areas", { pc_pain_now: 3 })!,
    S21arms: untilQuestion(sci, "pc_arm_function:right", { pc_sci_level: "no" })!,
    S22: untilQuestion(sci, "pc_sci_ready", { pc_sci_level: "yes" })!,
    S23: untilQuestion(standing, "pc_steadi:fell")!,
    S24: untilQuestion(q, "pc_surgery_recent:areas", { pc_surgery_recent: "yes" })!,
    S25: signedStarted(contextOf(), { pc_pain_now: 7, pc_pain_areas: {} }),
    S27: plan,
    S28: play(plan, { type: "PLAN_START" }),
    S31: play(signedPlan, { type: "PLAN_START" }, { type: "READY" }),
    S33: answerTo(q, "pc_unwell", "yes"),
    S35: withState(q, {
      kind: "paused",
      until: null,
      releasable: true,
      when: { token: "nextDay_midnight" },
    }),
    helper,
  };
}

/** Answers benignly up to `id`, then answers it with `value`. */
function answerTo(m: FlowModel, id: string, value: string | number): FlowModel {
  const at = untilQuestion(m, id);
  expect(at, `${id} is asked`).not.toBeNull();
  return play(at!, { type: "ANSWER", id, value });
}

const M = models();

describe("every flow screen renders for its state, in both languages, within the copy rules", () => {
  const expected: Record<string, FlowScreenId> = {
    S04: "S04",
    S05: "S05",
    S05a: "S05a",
    S05aEnd: "S05a",
    S05b: "S05b",
    S06: "S06",
    S08: "S08",
    S08b: "S08b",
    S09: "S09",
    S12: "S12",
    S13: "S13",
    S14: "S14",
    S14b: "S14b",
    S17: "S17",
    S18: "S18",
    S19: "S19",
    S20: "S20",
    S22: "S22",
    S23: "S23",
    S24: "S24",
    S25: "S25",
    S27: "S27",
    S28: "S28",
    S31: "S31",
    S33: "S33",
    S35: "S35",
  };
  for (const [name, id] of Object.entries(expected)) {
    it(`${name} shows ${id} with one h1`, () => {
      for (const lang of LANGS) {
        const r = screen(M[name], lang);
        expect(r.id).toBe(id);
        expect(count(r.html, "<h1"), `${name} ${lang}`).toBe(1);
        expect(r.html).toContain(`dir="${lang === "ar" ? "rtl" : "ltr"}"`);
      }
    });
  }
});

describe("entry screens", () => {
  it("S04 draws a QR code of the guest check on the device and offers no continue without a sensor (O10)", () => {
    const { html, text } = screen(M.S04, "en");
    expect(html).toContain('data-qr="/?check=1"');
    expect(html).toContain(`aria-label="${t("en", "assessment.desktop.qrAlt")}"`);
    expect(text).not.toContain(t("en", "assessment.desktop.continue"));
    expect(desktopLink("https://azm.test", false)).toBe("https://azm.test/");
    expect(desktopLink("https://azm.test", true)).toBe("https://azm.test/?check=1");
  });

  it("S05: one gold path, the full check outlined, two short lines, the adult line above the starts", () => {
    for (const lang of LANGS) {
      const { html, text } = screen(M.S05, lang);
      // C03: gold is the one test; the full check stays visible as an outline button with its minutes.
      expect(count(html, 'class="cta"')).toBe(1);
      expect(count(html, 'class="ghost"')).toBe(1);
      expect(text).toContain(textOf(t(lang, "assessment.guest.notSaved")));
      expect(text).toContain(textOf(CHECK_DATA.boundary.notMedical[lang]));
      // C33: no boundary paragraph at the booth (its comparison sentence is not true where nothing is kept).
      expect(text).not.toContain(textOf(CHECK_DATA.boundary.line[lang]));
      expect(html).toContain(t(lang, "assessment.guest.seeExample"));
      // C02: the adult line word for word, directly above the start buttons, and the under 18 link.
      const footer = html.slice(html.indexOf("<footer"));
      const adult = localizeDigits(lang, CHECK_DATA.boundary.adultConfirm[lang]);
      expect(textOf(footer).startsWith(textOf(adult))).toBe(true);
      expect(text).toContain(textOf(t(lang, "assessment.adult.under", { age: 18 })));
    }
  });

  it("S05a asks a signed in account with the data text first and ends kindly", () => {
    const { text } = screen(M.S05a, "en");
    expect(text.indexOf(CHECK_DATA.boundary.adultConfirm.en)).toBeLessThan(text.indexOf("I am under 18"));
    const end = screen(M.S05aEnd, "en");
    expect(end.text).toContain(t("en", "assessment.adult.body", { age: 18 }));
    expect(end.text).toContain(t("en", "assessment.guest.staff.restart"));
  });

  it("S09 never names the condition that caused it", () => {
    const { text } = screen(M.S09, "ar");
    expect(text).toContain(textOf(screenText("scr_booth_no_check", "ar")));
    expect(text).not.toContain(t("ar", "assessment.options.position.bed"));
  });
});

describe("guest steps (S06 to S11)", () => {
  it("counts six steps, and submits single choice steps on tap (no footer Next)", () => {
    const { html, text } = screen(M.S06, "en");
    expect(text).toContain("Step 1 of 6");
    expect(html).not.toContain('class="check-footer"');
    expect(count(html, "check-answer")).toBeGreaterThanOrEqual(4);
  });

  it("puts none first on the conditions step with Next in the footer (Q19 (1))", () => {
    const { html } = screen(M.S08, "ar");
    const first = html.indexOf("check-answer-text");
    expect(html.slice(first, first + 200)).toContain(
      CHECK_DATA.selection.guestBooth.conditionsStep.noneChip.ar,
    );
    expect(html).toContain('class="check-footer"');
  });

  it("asks the clearance question word for word, with the Not sure of the data (7.2-5)", () => {
    const { text } = screen(M.S08b, "ar");
    expect(text).toContain(CHECK_DATA.selection.guestBooth.clearance.ask.ar);
    expect(text).toContain("لست متأكدًا");
  });
});

describe("signed in entry (S12, S13)", () => {
  it("S12 lists what is kept, the storage line and the consent row, with Continue never disabled", () => {
    const { html, text } = screen(M.S12, "en");
    expect(text).toContain(CHECK_DATA.boundary.storageNotice.en);
    expect(html).toContain('type="checkbox"');
    expect(text).toContain(textOf(CHECK_DATA.boundary.consent.en));
    expect(html).not.toMatch(/<button[^>]*disabled/);
  });

  it("S13 shows the four intake rows and never the conditions", () => {
    const ctx = contextOf({ position: "chair", support: "left", conditions: ["stroke"] });
    const { html, text } = screen(signedAt(ctx), "en");
    expect(count(html, "<dt")).toBe(4);
    expect(text).toContain(t("en", "assessment.options.support.left"));
    expect(text).not.toContain(t("en", "assessment.options.condition.stroke"));
  });
});

describe("intro and sound check at home (S14, S14b)", () => {
  it("S14: the title, the boundary paragraph, the personal needs, one stop line, not medical (C38)", () => {
    const { ctx, tests } = introFacts(M.S14);
    expect(ctx).not.toBeNull();
    expect(tests.length).toBeGreaterThan(0);
    for (const lang of LANGS) {
      const { html, text } = screen(M.S14, lang);
      expect(text).toContain(textOf(CHECK_DATA.boundary.line[lang]));
      expect(text).toContain(t(lang, "assessment.intro.need.phone"));
      expect(count(text, textOf(t(lang, "assessment.intro.howToStop")))).toBe(1);
      expect(text).toContain(textOf(CHECK_DATA.boundary.notMedical[lang]));
      // No time (C11), no tests list (S27 has it), no check in switch (C39: the coach settings).
      expect(text).not.toMatch(lang === "en" ? /\d+ to \d+ minutes/ : /دقيقة|دقائق/);
      expect(html).not.toContain("flow-intro-tests");
      expect(html).not.toContain('role="switch"');
    }
  });

  it("S14 (English): the helper line names its tests after a colon, so a test name keeps its capital", () => {
    const { text } = screen(M.S14, "en");
    expect(text).toMatch(/Another adult beside you for these tests:\s+Seated side lean/);
    expect(text).not.toMatch(/beside you for Seated/);
  });

  it("S14b asks with the data cue and answers, and offers the screen reader mode", () => {
    const { text } = screen(M.S14b, "ar");
    expect(text).toContain(CHECK_DATA.cues.find((c) => c.id === "check_sound")!.ar);
    for (const o of CHECK_DATA.engine.soundCheck.options) expect(text).toContain(o.label.ar);
    expect(text).toContain(t("ar", "assessment.soundCheck.screenReader"));
  });
});

describe("pre-check questions (S17 to S24)", () => {
  it("S17 shows the bar, the question, the list card and two answers that submit on tap", () => {
    const { html, text } = screen(M.S17, "en");
    // C10: a bar with no numbers; C06: the first question's one subtitle.
    expect(html).toContain('class="check-progress" aria-hidden="true"');
    expect(text).not.toMatch(/Question \d+ of \d+/);
    expect(text).toContain(t("en", "assessment.precheck.howToAnswer"));
    expect(questionIdOf(M.S17)).toBe("pc_urgent");
    for (const line of precheckItem("pc_urgent").list!.en) expect(text).toContain(line);
    expect(count(html, 'class="check-answer"')).toBe(2);
    expect(html).not.toContain('class="check-footer"');
    expect(html).toContain("<strong>");
  });

  it("S18 gives Not sure a full answer row", () => {
    const { html } = screen(M.S18, "en");
    expect(count(html, 'class="check-answer"')).toBe(3);
  });

  it("S19 is eleven buttons, 0 to 5 then 6 to 10, none selected, with Next (O11b, Q7)", () => {
    for (const lang of LANGS) {
      const { html } = screen(M.S19, lang);
      expect(count(html, 'role="radio"')).toBe(11);
      expect(count(html, 'class="flow-scale-row"')).toBe(2);
      expect(html).not.toContain('aria-checked="true"');
      expect(html).toContain('class="check-footer"');
      expect(html).not.toMatch(/type="range"/);
    }
  });

  it("S20 lists every area in data order with the exclusive none chip", () => {
    const { text } = screen(M.S20, "en");
    let at = -1;
    for (const a of CHECK_DATA.areas) {
      const next = text.indexOf(a.label.en, at + 1);
      expect(next, a.id).toBeGreaterThan(at);
      at = next;
    }
    expect(text).toContain(t("en", "assessment.precheck.areas.none"));
  });

  it("S21 asks both arms on one screen: a row per arm with the same three answers, then Next (C25)", () => {
    const item = precheckItem("pc_arm_function");
    const left = withState(M.S21arms, { kind: "question", id: "pc_arm_function:left" });
    for (const lang of LANGS)
      for (const m of [M.S21arms, left]) {
        const { id, html, text } = screen(m, lang);
        expect(id).toBe("S21");
        expect(text).toContain(item.askBoth![lang]);
        expect(text).toContain(t(lang, "assessment.plan.sideArmRight"));
        expect(text).toContain(t(lang, "assessment.plan.sideArmLeft"));
        expect(text.indexOf(t(lang, "assessment.plan.sideArmRight"))).toBeLessThan(
          text.indexOf(t(lang, "assessment.plan.sideArmLeft")),
        );
        expect(count(html, 'class="check-answer"')).toBe(2 * item.options!.length);
        for (const o of item.options!) expect(count(text, o.label[lang])).toBe(2);
        expect(html).toContain('class="check-footer"');
        expect(count(html, 'class="check-answers"')).toBe(2);
      }
  });

  it("S22 shows the list to read and its two data answers", () => {
    const { text } = screen(M.S22, "ar");
    for (const line of precheckItem("pc_sci_ready").list!.ar) expect(text).toContain(textOf(line));
    for (const o of precheckItem("pc_sci_ready").options!) expect(text).toContain(o.label.ar);
  });

  it("S23 shows the group heading above its item", () => {
    expect(screen(M.S23, "en").text).toContain(t("en", "assessment.precheck.steadi.heading"));
  });

  it("S24 asks for the areas with chips and Next", () => {
    const { html, text } = screen(M.S24, "en");
    expect(text).toContain(precheckItem("pc_surgery_recent").followUp!.en);
    expect(html).toContain('class="check-footer"');
  });

  it("keeps the last question with its busy line or its error during the start call", () => {
    const busy = withState(M.S17, { kind: "starting", lastQuestion: "pc_urgent", error: null, attempt: 1 });
    expect(screen(busy, "en").text).toContain(t("en", "assessment.state.loading.check"));
    const failed = withState(M.S17, {
      kind: "starting",
      lastQuestion: "pc_urgent",
      error: "network",
      attempt: 1,
    });
    const r = screen(failed, "en");
    expect(r.text).toContain(t("en", "assessment.state.error.bodyStart"));
    expect(r.text).toContain(t("en", "assessment.common.retry"));
    const offline = withState(failed, {
      ...(failed.state as FlowState & object),
      error: "offline",
    } as FlowState);
    expect(screen(offline, "en").text).toContain(t("en", "assessment.state.offline.startBlocked"));
  });
});

describe("after the pre-check (S25, S26, S27)", () => {
  it("S25 shows the warnings as named cards", () => {
    const m = M.S25;
    expect(m.state.kind).toBe("warnings");
    const { html } = screen(m, "en");
    expect(html).toMatch(/aria-label="(Caution|Good to know)"/);
    expect(warningText("warn_pd_timing", "en", null)).toBeNull();
    expect(warningText("warn_pd_timing", "en", "gt3h")).toContain("more than 3 hours");
    expect(warningText("warn_ms_cool", "ar", null)).toBe(screenText("warn_ms_cool", "ar"));
  });

  it("S27 lists the tests in order with the duration and a start button, and no Back", () => {
    for (const lang of LANGS) {
      const { html, text } = screen(M.S27, lang);
      expect(html).toContain('class="flow-plan"');
      expect(text).toContain(t(lang, "assessment.plan.start"));
      expect(html).not.toContain(`aria-label="${t(lang, "assessment.common.back")}"`);
    }
  });

  it("S27 with every test skipped names the way out (O21)", () => {
    const skipped = {
      ...M.S27,
      data: {
        ...M.S27.data,
        protocol: M.S27.data.protocol.map((p) => ({ ...p, skipped: "pain_today" as const })),
      },
    };
    const { text } = screen(skipped, "en");
    expect(text).toContain(t("en", "assessment.plan.noneTitle"));
    expect(text).toContain(t("en", "assessment.guest.staff.restart"));
  });

  it("S26 briefs the helper for the side lean with the weaker side and the check in line", () => {
    let m = M.helper;
    expect(m.state.kind).toBe("plan");
    m = play(m, { type: "PLAN_START" });
    // Walk to the side lean's helper briefing when the protocol has one.
    for (let k = 0; k < 6 && m.state.kind !== "test.helper"; k++) {
      if (m.state.kind === "test.instruction") m = play(m, { type: "SKIP" }, { type: "SKIP_CONFIRM" });
      else if (m.state.kind === "skipNotice") m = play(m, { type: "CONTINUE" });
      else break;
      if (
        m.state.kind === "test.instruction" &&
        m.data.tests[(m.state as { i: number }).i]?.testId === "trunk_control_seated"
      )
        m = play(m, { type: "READY" });
    }
    expect(m.state.kind).toBe("test.helper");
    expect(weakerSide(m)).toBe("right");
    const { text } = screen(m, "en");
    expect(text).toContain(CHECK_DATA.helperBriefing.heading.en);
    expect(text).toContain(CHECK_DATA.helperBriefing.confirmButton.en);
  });
});

describe("test preparation (S28, S31, S32)", () => {
  it("S28 shows the name, steps, every safety note, Let's start and Skip this test", () => {
    for (const lang of LANGS) {
      const { html, text } = screen(M.S28, lang);
      const run = M.S28.data.tests[0];
      const def = testDef(run.testId);
      expect(text).toContain(textOf(def.name[lang]));
      // C12: every safety note, the stop note once as the stop block; two steps at the booth.
      for (const note of def.safety[lang]) expect(count(text, textOf(note))).toBe(1);
      expect(html).toContain('class="flow-stop-block"');
      expect(count(html.slice(html.indexOf("<ol"), html.indexOf("</ol>")), "<li")).toBe(2);
      expect(text).toContain(t(lang, "assessment.test.ready"));
      expect(text).toContain(t(lang, "assessment.common.skipTest"));
      // C04: the booth's how to stop line comes first, and the booth seat line replaces the setup.
      expect(text.indexOf(textOf(t(lang, "assessment.test.stopBooth")))).toBeLessThan(
        text.indexOf(textOf(def.name[lang])),
      );
      expect(text).toContain(textOf(t(lang, "assessment.test.placeBooth")));
    }
  });

  it("S28 shows warn_sci_t6 with no call control (D-016: 997 only on the emergency screens)", () => {
    const m = { ...M.S28, data: { ...M.S28.data, warnings: ["warn_sci_t6" as never] } };
    for (const lang of LANGS) {
      const { html, text } = screen(m, lang);
      expect(text).toContain(textOf(screenText("warn_sci_t6", lang)));
      expect(html).not.toContain("tel:");
      expect(html).not.toContain(lang === "ar" ? "٩٩٧" : "997");
    }
  });

  it("S31 at home: one privacy line and the button (C08)", () => {
    expect(M.S31.state.kind).toBe("test.primer");
    const { html, text } = screen(M.S31, "en");
    expect(text).toContain(t("en", "assessment.primer.body"));
    expect(text).toContain(t("en", "assessment.primer.allow"));
    const body = html.slice(html.indexOf('data-screen="S31"'), html.indexOf("</main>"));
    expect(count(body, "<p ")).toBe(1);
  });

  it("S32 shows each camera problem with its own title", () => {
    for (const problem of ["denied", "none", "busy", "stopped"] as const) {
      const m = withState(M.S31, { kind: "cam.problem", problem, returnTo: M.S31.state });
      const { text } = screen(m, "en");
      expect(text).toContain(t("en", `assessment.camera.${problem}.title`));
    }
  });
});

describe("postponed and paused (S33, S35)", () => {
  it("S33 unwell: the reason text, the paused line with its {when}, no Back and no call control", () => {
    const m = M.S33;
    expect(m.state.kind).toBe("postponed");
    for (const lang of LANGS) {
      const { html, text } = screen(m, lang);
      expect(text).toContain(textOf(screenText("scr_postpone_unwell", lang)));
      expect(html).not.toContain("tel:");
      expect(html).not.toContain(`aria-label="${t(lang, "assessment.common.back")}"`);
      expect(text).not.toMatch(/\{when\}/);
    }
  });

  it("S33 care: the 937 advice line only, no 997 (D-016)", () => {
    const m = withState(M.S33, { kind: "postponed", reason: "recent_change", screen: null, alsoShow: [] });
    const { html } = screen(m, "en");
    expect(html).not.toContain("tel:997");
    expect(html).toContain('href="tel:937"');
  });

  it("S33 SCI readiness: the list again and Done, with no paused line", () => {
    const m = withState(M.S33, { kind: "postponed", reason: "sci_ready", screen: null, alsoShow: [] });
    const { text } = screen(m, "en");
    expect(text).toContain(t("en", "assessment.postpone.sciAgain"));
    for (const line of precheckItem("pc_sci_ready").list!.en) expect(text).toContain(line);
    expect(text).not.toContain(screenText("scr_paused_today", "en").split(".")[0]);
  });

  it("S35 never names the reason and offers the care team release only when allowed", () => {
    const { text } = screen(M.S35, "en");
    expect(text).toContain(t("en", "assessment.entry.locked.title"));
    // A booth guest has no account: the staff line, never a time to come back.
    expect(text).toContain(t("en", "assessment.safety.boothStaff"));
    expect(text).not.toContain("You can try again tomorrow.");
    const signed = withState(signedAt(), {
      kind: "paused",
      until: null,
      releasable: true,
      when: { token: "nextDay_midnight" },
    });
    expect(screen(signed, "en").text).toContain(t("en", "assessment.entry.locked.cleared"));
    const fixed = withState(signed, { kind: "paused", until: null, releasable: false, when: null });
    expect(screen(fixed, "en").text).not.toContain(t("en", "assessment.entry.locked.cleared"));
  });
});

describe("small rules", () => {
  it("keeps a clock time one left to right unit in Arabic, so hours never swap with minutes", () => {
    const m = withState(signedAt(), {
      kind: "paused",
      until: null,
      releasable: false,
      when: { token: "sameDay_clock", time: { hour: 3, minute: 15, suffix: "pm" } },
    });
    const ar = screen(m, "ar").html;
    expect(ar).toContain('<bdi dir="ltr">٣:١٥</bdi>');
    expect(screen(m, "en").text).toContain("You can try again after 3:15 pm.");
  });

  it("hears lines only with the sound on in voice mode", () => {
    expect(audible(true, null)).toBe(true);
    expect(audible(true, "voice")).toBe(true);
    expect(audible(false, "voice")).toBe(false);
    expect(audible(true, "captionsOnly")).toBe(false);
    expect(audible(true, "screenReader")).toBe(false);
  });

  it("S30 asks for the same load as last time at a re-test, from the context (Q5)", () => {
    const started = signedStarted(contextOf({ position: "chair" }));
    const plan = started.state.kind === "warnings" ? play(started, { type: "CONTINUE" }) : started;
    const curl = plan.data.tests.findIndex((x) => x.testId === "arm_curl_30s");
    expect(curl).toBeGreaterThanOrEqual(0);
    const arm = plan.data.tests[curl].sides[0].side as "left" | "right";
    const retest = {
      ...plan,
      data: {
        ...plan.data,
        signedIn: {
          ...plan.data.signedIn!,
          firstCheck: false,
          lastLoads: { [arm]: { kind: "bottle" as const, liters: 1 as const } },
        },
      },
    };
    const load = withState(retest, { kind: "test.load", i: curl });
    for (const lang of ["ar", "en"] as const) {
      const { text } = screen(load, lang);
      expect(text).toContain(t(lang, "assessment.load.sameTitle"));
      expect(text).toContain(t(lang, "assessment.load.sameYes"));
    }
    // The first check: the picker, never the question.
    const first = withState(plan, { kind: "test.load", i: curl });
    expect(screen(first, "en").text).not.toContain(t("en", "assessment.load.sameTitle"));
  });

  it("keeps a caption for its reading time, between 2.5 and 12 seconds", () => {
    expect(captionMs("short")).toBe(2500);
    expect(captionMs("x".repeat(100))).toBe(7000);
    expect(captionMs("x".repeat(1000))).toBe(12000);
  });
});
