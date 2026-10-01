/**
 * The safety screens as rendered markup (UX spec S36 to S49, 0.5, 3.0, 5.7; Q22, 7.2-1; D-016), in
 * Arabic and English: every screen is registered, safety screens have no Back and no Exit, the 997
 * call is a tel: link with the spaced digits as its name and comes first, the ambulance number is text
 * in the page's digits, S43 is a calm alert dialog with two answers, the answers keep the data order,
 * and the booth lines show where they apply.
 */
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  initialModel,
  testsOf,
  type FlowModel,
  type FlowState,
} from "../src/features/assessment/flowMachine";
import { SAFETY_SCREENS } from "../src/features/assessment/safety";
import { SAFETY_SCREEN_IDS, type ScreenProps } from "../src/features/assessment/screenTypes";
import { OVERLAYS, SCREENS, overlayFor, screenFor } from "../src/features/assessment/screens";
import { TextWithTimes } from "../src/features/assessment/safety/parts";
import { CheckRoot } from "../src/features/assessment/shared/CheckRoot";
import type { CheckUi } from "../src/features/assessment/shared/CheckUi";
import type { ProtocolItem } from "../src/medical/assessment";
import { CHECK_DATA } from "../src/movements/assessments";

const item = (testId: ProtocolItem["testId"], side: ProtocolItem["side"], order: number): ProtocolItem => ({
  testId,
  side,
  version: 1,
  order,
  band: "default",
});
const PROTOCOL = [
  item("shoulder_abduction", "left", 1),
  item("shoulder_abduction", "right", 2),
  item("trunk_control_seated", "left", 3),
  item("trunk_control_seated", "right", 4),
  item("chair_stand_30s", "none", 5),
];

function model(state: FlowState, overlay: FlowModel["overlay"] = null, guest = true): FlowModel {
  const m = initialModel({
    mode: guest ? "guest" : "signedIn",
    booth: guest,
    homeOpen: true,
    desktop: false,
  });
  return {
    ...m,
    state,
    overlay,
    data: {
      ...m.data,
      env: {
        setting: guest ? "booth" : "home",
        ctx: {
          position: "chair",
          support: "none",
          pain: [],
          restrictions: [],
          conditions: [],
          clearance: "yes",
        },
        setup: null,
        firstCheck: true,
        unresolvedChangeReported: false,
        lastCheckLasting: false,
        baseTests: ["shoulder_abduction", "trunk_control_seated", "chair_stand_30s"],
      },
      protocol: PROTOCOL,
      tests: testsOf(PROTOCOL),
      outcomes: { "chair_stand_30s:none": { status: "measured", value: 11 } },
    },
  };
}

function render(
  Screen: ComponentType<ScreenProps>,
  m: FlowModel,
  ui: Partial<CheckUi> & Pick<CheckUi, "lang"> = { lang: "ar" },
): string {
  const props: ScreenProps = {
    model: m,
    dispatch: () => undefined,
    api: {} as ScreenProps["api"],
    retryCamera: () => undefined,
    retrySave: () => undefined,
  };
  return renderToStaticMarkup(createElement(CheckRoot, { ui, children: createElement(Screen, props) }));
}

const safety = (screen: string, kind: string, extra = {}) =>
  ({ kind: "safety", safety: kind, screen, alsoShow: [], faintAnswered: false, ...extra }) as FlowState;

describe("the registry (screens.ts reads only safety/index.ts)", () => {
  it("registers a real screen for every safety id, and the two safety overlays", () => {
    for (const id of SAFETY_SCREEN_IDS) {
      expect(SAFETY_SCREENS[id], id).toBeTypeOf("function");
      expect((SAFETY_SCREENS[id] as { displayName?: string }).displayName ?? "").not.toMatch(/^Stub/);
      expect(SCREENS[id]).toBe(SAFETY_SCREENS[id]);
    }
    expect([OVERLAYS.S41, OVERLAYS.S43]).toEqual([SAFETY_SCREENS.S41, SAFETY_SCREENS.S43]);
  });
});

describe("S36 to S40b", () => {
  for (const lang of ["ar", "en"] as const) {
    it(`S36 (${lang}): no Back or Exit, the 40 px heading, the 64 px number, the tel:997 link named digit by digit`, () => {
      const m = model(safety("scr_emergency", "emergency"));
      const html = render(SCREENS[screenFor(m)!], m, { lang, booth: true });
      expect(html).toContain('data-screen="S36"');
      expect(html).not.toContain("check-back");
      expect(html).not.toContain("check-exit");
      expect(html).toContain("check-safety-heading");
      expect(html).toContain('href="tel:997"');
      expect(html).toContain(lang === "ar" ? 'aria-label="اتصل بالرقم ٩ ٩ ٧"' : 'aria-label="Call 9 9 7"');
      expect(html).toContain(`<bdi class="safety-number-value">${lang === "ar" ? "٩٩٧" : "997"}</bdi>`);
      // The call comes first in the footer, before the way out.
      const footer = html.slice(html.indexOf("check-footer"));
      expect(footer.indexOf("tel:997")).toBeLessThan(footer.indexOf("<button"));
      // Every sentence of the text is on the screen; at the booth the staff line.
      for (const s of CHECK_DATA.screens.scr_emergency[lang].split(/(?<=[.!?؟])\s+/u))
        expect(html.replace(/<[^>]+>/g, "")).toContain(
          lang === "ar" ? s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]) : s,
        );
      expect(html).toContain(
        lang === "ar" ? "فريقنا قريب منك في الجناح." : "Our team is close by at the booth.",
      );
      expect(html).toContain("check-booth-badge");
    });
  }

  it("keeps a clock time whole in the paused line (Arabic: one left to right run, never ٠٦:٩)", () => {
    const html = renderToStaticMarkup(
      createElement(CheckRoot, {
        ui: { lang: "ar" },
        children: createElement(TextWithTimes, { text: "يمكنك المحاولة غدًا بعد الساعة 9:06 صباحًا." }),
      }),
    );
    expect(html).toContain('<bdi dir="ltr">٩:٠٦</bdi>');
    expect(html).not.toContain("<bdi>٩</bdi>");
    const en = renderToStaticMarkup(
      createElement(CheckRoot, {
        ui: { lang: "en" },
        children: createElement(TextWithTimes, { text: "Try again tomorrow after 9:06 am." }),
      }),
    );
    // English is left to right already: the time is plain text.
    expect(en).toContain("after 9:06 am.");
  });

  it("S36 signed in shows the kept line and the paused line with its {when}", () => {
    const base = model(safety("scr_emergency", "emergency"), null, false);
    const m: FlowModel = {
      ...base,
      data: { ...base.data, lock: { reason: "stop_symptom", until: Date.now() + 14 * 3600e3 } },
    };
    const html = render(SCREENS.S36, m, { lang: "en" });
    expect(html).toContain("Results of the tests you finished are kept.");
    expect(html).toMatch(/after \d{1,2}:\d{2}/);
    expect(html).toContain("Return to Today");
  });

  it("S40a has the 937 advice call and no 997 (D-016); S40b has no call and Continue toward the end question", () => {
    const seek = render(SCREENS.S40a, model(safety("scr_stop_seek_care", "seekCare")), { lang: "en" });
    expect(seek).not.toContain("tel:997");
    expect(seek).toContain('href="tel:937"');
    const pain = render(SCREENS.S40b, model(safety("scr_stop_pain", "pain")), { lang: "en" });
    expect(pain).not.toContain("tel:");
    expect(pain).toContain(">Continue</button>");
  });

  it("S38 and S39 show no camera line (the camera is off here), no 997 (D-016), and continue to the faint question", () => {
    const faint = render(SCREENS.S38, model(safety("scr_faint", "faint")), { lang: "en" });
    expect(faint).toContain('data-screen="S38"');
    expect(faint).not.toContain("Camera on");
    expect(faint).toContain(">Continue</button>");
    expect(faint).not.toContain("tel:");
    const fall = render(SCREENS.S39, model(safety("scr_fall_seated", "fall", { askFaint: true })), {
      lang: "ar",
    });
    expect(fall).toContain('data-safety-screen="scr_fall_seated"');
    expect(fall).not.toContain("safety-number-value");
    expect(fall).not.toContain("tel:");
    expect(fall).not.toContain("٩٩٧");
  });

  it("S38b asks the faint question with no 997 call (D-016)", () => {
    const m = model({ kind: "faintAsk", back: { safety: "faint", screen: "scr_faint", alsoShow: [] } });
    const html = render(SCREENS.S38b, m, { lang: "en" });
    expect(html).toContain('data-screen="S38b"');
    expect(html).not.toContain("tel:");
  });
});

describe("S41 and S43", () => {
  it("S41 is a modal dialog with the two groups and one button per option, urgent first", () => {
    const m = model({ kind: "cam.measure", i: 0, side: 0 }, { kind: "stopList" });
    const html = render(OVERLAYS[overlayFor(m) as "S41"], m, { lang: "en", booth: true });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const options = [...html.matchAll(/data-option="([a-z_]+)"/g)].map((x) => x[1]);
    expect(options).toEqual([
      "chest",
      "stroke_signs",
      "faint",
      "breath",
      "fall",
      "pain",
      "tired",
      "choice",
      "other",
    ]);
    expect(html).toContain("Say your answer from where you are.");
    expect(html).not.toContain("check-exit");
  });

  it("S43 is a calm alert dialog: the question, the instruction, I am fine, then I want to stop", () => {
    const m = model({ kind: "cam.measure", i: 0, side: 0 }, { kind: "checkIn" }, false);
    for (const lang of ["ar", "en"] as const) {
      const html = render(OVERLAYS.S43, m, { lang });
      expect(html).toContain('role="alertdialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain(lang === "ar" ? ">هل أنت بخير؟</h1>" : ">Are you all right?</h1>");
      expect(html).toContain(lang === "ar" ? "فالمس «أنا بخير»" : "tap “I am fine”");
      // Sound, «أنا بخير» and «أريد التوقف»: nothing else to press, no call, no ring, no STOP.
      const buttons = [...html.matchAll(/<button[^>]*class="([^"]+)"/g)].map((x) => x[1]);
      expect(buttons).toEqual(["check-icon-button", "cta safety-fine", "ghost safety-want-stop"]);
      expect(html).not.toContain("tel:");
      expect(html).not.toContain("safety-ring");
      // The instruction until 30 s pass with no answer; then the line to call someone nearby.
      expect(html).toContain('<p class="check-body safety-checkin-line" role="status">');
      expect(html).not.toContain("data-help");
    }
  });
});

describe("S46 to S49", () => {
  it("S47 keeps the data order, STOP below, the side done line", () => {
    const html = render(SCREENS.S47, model({ kind: "between", i: 0, side: 0, scope: "side", via: "test" }), {
      lang: "en",
    });
    expect([...html.matchAll(/data-value="([a-z]+)"/g)].map((x) => x[1])).toEqual(["same", "more", "much"]);
    expect(html).toContain("Your left arm is done");
    expect(html).toContain("safety-stop");
  });

  it("S48 asks contact per side, pushed, and the count check with the count at 96 px", () => {
    const contact = render(SCREENS.S48, model({ kind: "after.contact", i: 1, side: 1 }), { lang: "ar" });
    expect(contact).toContain("الميل إلى يمينك");
    expect(contact).toContain("مسند الذراع");
    const pushed = render(SCREENS.S48, model({ kind: "after.pushed", i: 2, side: 0 }), { lang: "en" });
    expect(pushed).toContain("Did you push with your hands to stand up?");
    const count = render(SCREENS.S48, model({ kind: "after.count", i: 2, side: 0 }), { lang: "ar" });
    expect(count).toContain('<p class="safety-count"><bdi><bdi>١١</bdi></bdi></p>');
  });

  it("S49 asks the general form with the meaning words bold, Yes and No", () => {
    const html = render(SCREENS.S49, model({ kind: "endQuestion" }, null, false), { lang: "ar" });
    expect(html).toContain("<strong>اليوم</strong>");
    expect(html).toContain("<strong>جديد ومفاجئ</strong>");
    expect([...html.matchAll(/data-value="([a-z]+)"/g)].map((x) => x[1])).toEqual(["yes", "no"]);
  });

  it("S46 and S46b", () => {
    const skip = render(
      SCREENS.S46,
      model({
        kind: "skipNotice",
        rows: [{ testId: "chair_stand_30s", side: "none", reason: "needed_arms" }],
        then: { to: "endQuestion" },
      }),
      { lang: "en" },
    );
    expect(skip).toContain("You needed your hands, which is fine");
    expect(skip).toContain("Chair stands in 30 seconds");
    const after = render(SCREENS.S46b, model({ kind: "guestAfterTest", next: 1 }), { lang: "en" });
    expect([...after.matchAll(/class="cta"/g)]).toHaveLength(2);
    expect(after).toContain("The next test is “Seated side lean”.");
  });
});
