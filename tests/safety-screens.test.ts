/**
 * The safety screens as rendered markup (UX spec S36 to S49, 0.5, 3.0, 5.7; Q22, O34-4, 7.2-1), in
 * Arabic and English: every screen is registered, safety screens have no Back and no Exit, the 997
 * call is a tel: link with the spaced digits as its name and comes first, the ambulance number is text
 * in the page's digits, S43 and S45 are alert dialogs whose only fine control is the fine button, the
 * answer zones keep the data order, and booth and sound off lines show where they apply.
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
  };
  return renderToStaticMarkup(createElement(CheckRoot, { ui, children: createElement(Screen, props) }));
}

const safety = (screen: string, kind: string, extra = {}) =>
  ({ kind: "safety", safety: kind, screen, alsoShow: [], faintAnswered: false, ...extra }) as FlowState;

describe("the registry (screens.ts reads only safety/index.ts)", () => {
  it("registers a real screen for every safety id, and the four overlays", () => {
    for (const id of SAFETY_SCREEN_IDS) {
      expect(SAFETY_SCREENS[id], id).toBeTypeOf("function");
      expect((SAFETY_SCREENS[id] as { displayName?: string }).displayName ?? "").not.toMatch(/^Stub/);
      expect(SCREENS[id]).toBe(SAFETY_SCREENS[id]);
    }
    expect([OVERLAYS.S41, OVERLAYS.S43, OVERLAYS.S44, OVERLAYS.S45]).toEqual([
      SAFETY_SCREENS.S41,
      SAFETY_SCREENS.S43,
      SAFETY_SCREENS.S44,
      SAFETY_SCREENS.S45,
    ]);
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

  it("S40a has 997 then 937; S40b has no call and Continue toward the end question", () => {
    const seek = render(SCREENS.S40a, model(safety("scr_stop_seek_care", "seekCare")), { lang: "en" });
    expect(seek.indexOf("tel:997")).toBeGreaterThan(0);
    expect(seek.indexOf("tel:937")).toBeGreaterThan(seek.indexOf("tel:997"));
    const pain = render(SCREENS.S40b, model(safety("scr_stop_pain", "pain")), { lang: "en" });
    expect(pain).not.toContain("tel:");
    expect(pain).toContain(">Continue</button>");
  });

  it("S38 and S39 show no camera line (the camera is off here) and continue to the faint question", () => {
    const faint = render(SCREENS.S38, model(safety("scr_faint", "faint")), { lang: "en" });
    expect(faint).toContain('data-screen="S38"');
    expect(faint).not.toContain("Camera on");
    expect(faint).toContain(">Continue</button>");
    const fall = render(SCREENS.S39, model(safety("scr_fall_seated", "fall", { askFaint: true })), {
      lang: "ar",
    });
    expect(fall).toContain('data-safety-screen="scr_fall_seated"');
    expect(fall).toContain("safety-number-value");
  });
});

describe("S41 to S45", () => {
  it("S41 is a modal dialog with the two groups and one button per option, urgent first", () => {
    const m = model({ kind: "cam.measure", i: 0, side: 0 }, { kind: "stopList", takeYourTime: false });
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

  it("S43 is an alert dialog: three answers, the fine one largest, STOP inside after a gap", () => {
    const m = model(
      { kind: "cam.measure", i: 0, side: 0 },
      { kind: "checkIn", from: "test", trigger: "sway", attempt: true },
    );
    const html = render(OVERLAYS.S43, m, { lang: "ar", booth: true });
    expect(html).toContain('role="alertdialog"');
    expect([...html.matchAll(/data-value="([a-z]+)"/g)].map((x) => x[1])).toEqual(["fine", "stop", "help"]);
    expect(html).toContain('class="safety-zone is-large"');
    expect(html).toContain("safety-stop-zone has-gap");
    expect(html).toContain("هل أنت بخير؟");
  });

  it("S44 after the alarm puts 997 and the number first; redo only after an attempt", () => {
    const m = model(
      { kind: "cam.measure", i: 0, side: 0 },
      { kind: "goOn", afterAlarm: true, canRedo: false },
    );
    const html = render(OVERLAYS.S44, m, { lang: "en" });
    expect(html.indexOf("tel:997")).toBeLessThan(html.indexOf("Do you want to go on?"));
    expect(html).not.toContain('data-value="redo"');
    const redo = render(
      OVERLAYS.S44,
      model({ kind: "cam.measure", i: 0, side: 0 }, { kind: "goOn", afterAlarm: false, canRedo: true }),
      {
        lang: "en",
      },
    );
    expect(redo).toContain('data-value="redo"');
    expect(redo).not.toContain("tel:997");
  });

  it("S45: the heading, 997 first, the body, the 120 px fine button; staff and sound off lines", () => {
    const m = model({ kind: "cam.measure", i: 0, side: 0 }, { kind: "alarm", from: "test", attempt: true });
    const off = { on: false, toggle: () => undefined };
    const html = render(OVERLAYS.S45, m, { lang: "en", booth: true, sound: off });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain(">Are you all right?</h1>");
    expect(html.indexOf("tel:997")).toBeLessThan(html.indexOf("safety-sentences"));
    expect(html).toContain("safety-fine");
    expect(html).toContain("Staff, please check on this visitor now.");
    expect(html).toContain("The alert tone still sounds");
    // The only buttons: Sound and I am fine (the call is a link).
    expect([...html.matchAll(/<button/g)]).toHaveLength(2);
    const help = render(
      OVERLAYS.S45,
      model({ kind: "cam.measure", i: 0, side: 0 }, { kind: "alarm", from: "test", help: true }),
      {
        lang: "ar",
      },
    );
    expect(help).toContain(">اطلب المساعدة الآن</h1>");
    expect(help).not.toContain("نرجو من الفريق");
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
        rows: [{ testId: "chair_stand_30s", side: "none", reason: "by_choice" }],
        then: { to: "endQuestion" },
      }),
      { lang: "en" },
    );
    expect(skip).toContain("That is fine. We will skip this test.");
    expect(skip).toContain("Chair stands in 30 seconds");
    const after = render(SCREENS.S46b, model({ kind: "guestAfterTest", next: 1 }), { lang: "en" });
    expect([...after.matchAll(/class="cta"/g)]).toHaveLength(2);
    expect(after).toContain("The next test is “Seated side lean”.");
  });
});
