/**
 * The S34 view rendered to markup for every preview state, in Arabic and English (no DOM): STOP is
 * first, the copy has no dash characters, Arabic shows Arabic Indic digits, the side lean and the
 * arm raise show no measured value during the test (O3, O4, O28), and the timed count is never
 * a spoken line.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Lang } from "../src/app/i18n";
import CameraPreview from "../src/features/assessment/camera/e2e/CameraPreview";
import { PREVIEW_NAMES, PREVIEWS } from "../src/features/assessment/camera/e2e/previews";
import { SHOW_LIVE_DEGREES } from "../src/features/assessment/camera/CameraScreen";
import { testsOf, type FlowModel } from "../src/features/assessment/flowMachine";
import type { ProtocolItem } from "../src/medical/assessment";
import { CheckRoot } from "../src/features/assessment/shared/CheckRoot";
import { atSetup } from "./s34-harness";

const item = (testId: string, side: "left" | "right" | "none", order: number, variant?: string) =>
  ({ testId, side, version: 1, order, band: "default", ...(variant ? { variant } : {}) }) as ProtocolItem;
const PROTOCOL: ProtocolItem[] = [
  item("shoulder_abduction", "left", 1),
  item("shoulder_abduction", "right", 2),
  item("arm_curl_30s", "left", 3, "arm_only"),
  item("arm_curl_30s", "right", 4, "arm_only"),
  item("trunk_control_seated", "left", 5),
  item("trunk_control_seated", "right", 6),
  item("chair_stand_30s", "none", 7, "standard"),
];

function model(): FlowModel {
  const m = atSetup("shoulder_abduction");
  return { ...m, data: { ...m.data, protocol: PROTOCOL, tests: testsOf(PROTOCOL) } };
}

function render(name: string, lang: Lang): string {
  const m = model();
  const screen = createElement(CameraPreview, {
    name,
    model: m,
    dispatch: () => undefined,
    api: {} as never,
    retryCamera: () => undefined,
    retrySave: () => undefined,
  });
  return renderToStaticMarkup(
    createElement(CheckRoot, { ui: { lang, booth: true, guest: true }, children: screen }),
  );
}

/** The visible text of markup: tags and visually hidden parts dropped. */
function text(html: string): string {
  return html
    .replace(/<span class="check-visually-hidden">[^<]*<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ");
}

const DASH = /[‒-―−]|\p{L}-\p{L}/u;

describe("S34 view, every preview state in both languages", () => {
  for (const lang of ["ar", "en"] as const) {
    it(`renders every state in ${lang} with STOP first and no dash characters`, () => {
      for (const name of PREVIEW_NAMES) {
        const html = render(name, lang);
        // STOP is the first control of the page (principle 6), whatever the part shows.
        const first = html.indexOf("<button");
        expect(html.slice(first, first + 120), name).toContain("s34-stop");
        expect(text(html), name).not.toMatch(DASH);
        if (lang === "ar") expect(text(html).replace(/\bT6\b/g, ""), name).not.toMatch(/[0-9]/);
      }
    });
  }

  it("the side lean shows no number at all, the arm raise no degrees (O3, O4, C29)", () => {
    expect(SHOW_LIVE_DEGREES).toBe(false);
    for (const name of PREVIEW_NAMES) {
      const p = PREVIEWS[name];
      const html = render(name, "en");
      if (p.test === "shoulder_abduction") expect(html, name).not.toContain("s34-degrees");
      if (p.test === "trunk_control_seated" && name.startsWith("lean-")) {
        const card = html.slice(html.indexOf(">", html.indexOf("s34-lean-panel")));
        expect(text(card), name).not.toMatch(/\d/);
      }
    }
  });

  it("the rest names what comes next after a colon, so a label keeps its capital (English)", () => {
    expect(text(render("rest-side", "en"))).toMatch(/After the rest:\s+Your right arm/);
    expect(text(render("rest-attempt", "en"))).toMatch(/After the rest:\s+Try 2 of 3/);
    expect(text(render("rest-side", "en"))).not.toContain("After the rest,");
  });

  it("a saved attempt shows the check and Saved, never its value (O28)", () => {
    const html = render("saved-range", "en");
    expect(text(html)).toContain("Saved");
    expect(text(html)).not.toMatch(/\d+\s*°/);
    expect(text(html.slice(html.indexOf(">", html.indexOf("s34-card"))))).not.toMatch(/\d/);
  });

  it("the setup check shows one line, the first fix or Ready, and no chips (C28)", () => {
    const html = render("setup-close", "en");
    expect(html).not.toContain("s34-chip");
    const card = text(html.slice(html.indexOf("s34-card")));
    expect(card).toContain("Too close");
    expect(card).not.toContain("Light");
    expect(text(render("setup-ready", "en"))).toContain("Ready");
  });

  it("the retry shows the reason and the countdown; Skip is a text link, no Try now (C30)", () => {
    const raw = render("retry-plane", "en");
    const html = text(raw);
    expect(html).toContain("Raise it out to the side");
    expect(html).toContain("Starting in 4 seconds");
    expect(html).toContain("Skip this test");
    expect(raw).toContain("check-text-button s34-text-button");
    for (const gone of ["Try now", "Two more tries", "Let’s try", "Try again"])
      expect(html).not.toContain(gone);
    // The card says the fix, so no caption repeats it above.
    expect(raw).not.toContain("s34-caption");
    const timed = text(render("retry-timed", "en"));
    expect(timed).toContain("We will try again after two minutes of rest.");
  });

  it("a caption is one line: the short form with a voice, the sentence when none is heard (C29)", () => {
    const ar = render("setup-close", "ar");
    expect(ar).toContain("s34-caption-short");
    expect(ar).not.toContain("s34-caption-text");
    expect(text(ar)).toContain("ابتعد قليلًا");
    const coach = render("range-coach", "en");
    expect(text(coach)).toContain("Sideways not forward");
    expect(text(coach)).not.toContain("Raise your arm out to the side, not in front of you.");
    // Captions only (Large captions) and a blocked voice: the sentence, large, without the short form.
    for (const name of ["timed-large", "setup-sound-blocked"]) {
      const html = render(name, "en");
      expect(html, name).toContain("s34-caption-text");
      expect(html, name).not.toContain("s34-caption-short");
    }
    // A sentence that carries a safety limit is always the line on screen.
    const lean = text(render("lean-left", "en"));
    expect(lean).toContain("only as far as you are sure you can come back from on your own");
  });

  it("no caption repeats the instruction the card already shows (C29, R-10)", () => {
    // The card's word is the instruction: Go, Hold it there, Lower slowly, Hold there a moment, Come
    // back to the middle, Rest, Saved; the phone held sideways: the card says to turn it upright.
    for (const lang of ["ar", "en"] as const)
      for (const name of [
        "go",
        "countdown",
        "range-hold",
        "range-lower",
        "lean-pause",
        "lean-return",
        "lean-coach",
        "rest-attempt",
        "rest-side",
        "saved-range",
        "landscape",
      ])
        expect(render(name, lang), `${name} ${lang}`).not.toContain("s34-caption");
    // A caption that says more than the card's word stays: the raise to the side, the lean with its
    // safety limit, a coaching line, the time up line (sit down slowly), the go of a running trial.
    for (const name of [
      "practice-range",
      "range-raise",
      "lean-left",
      "range-coach",
      "timed-timeup",
      "saved-timed",
      "timed-curl",
    ])
      expect(render(name, "en"), name).toContain("s34-caption");
  });

  it("the top bar holds the counter, the booth badge and Sound; the pills on their own row (C29)", () => {
    const html = render("setup-sound-blocked", "en");
    const top = html.slice(html.indexOf("s34-top"), html.indexOf("</header>"));
    expect(top).not.toContain("Large captions");
    expect(top).not.toContain("s34-camera-on");
    expect(top.indexOf("Tap to turn on the sound")).toBeGreaterThan(top.indexOf("s34-top-note"));
    expect(top.indexOf("s34-top-note")).toBeGreaterThan(top.indexOf("s34-top-tools"));
    // The side is named once, in the value card: no marker over the picture.
    expect(render("range-raise", "en")).not.toContain("s34-arm-marker");
  });

  it("the helper strip shows for a test that counts on a helper; the booth badge always at the booth", () => {
    expect(text(render("timed-stand", "en"))).toContain("Helper beside you");
    expect(render("timed-curl", "en")).not.toContain("s34-helper");
    expect(text(render("timed-curl", "en"))).toContain("Azm booth");
  });
});
