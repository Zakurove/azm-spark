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

  it("the side lean shows no number but the try counter, the arm raise no degrees (O3, O4)", () => {
    expect(SHOW_LIVE_DEGREES).toBe(false);
    for (const name of PREVIEW_NAMES) {
      const p = PREVIEWS[name];
      const html = render(name, "en");
      if (p.test === "shoulder_abduction") expect(html, name).not.toContain("s34-degrees");
      if (p.test === "trunk_control_seated" && name.startsWith("lean-")) {
        const card = html.slice(html.indexOf(">", html.indexOf("s34-lean-panel")));
        const digits = text(card).replace(/\d+ of \d+/g, "");
        expect(digits, name).not.toMatch(/\d/);
      }
    }
  });

  it("a saved attempt shows the check and Saved, never its value (O28)", () => {
    const html = render("saved-range", "en");
    expect(text(html)).toContain("Saved");
    expect(text(html)).not.toMatch(/\d+\s*°/);
    expect(text(html.slice(html.indexOf(">", html.indexOf("s34-card"))))).not.toMatch(/\d/);
  });

  it("the setup check always shows six chips with a word and a state in their names", () => {
    const html = render("setup-close", "en");
    expect(html.match(/class="s34-chip /g)).toHaveLength(6);
    expect(html).toContain('aria-label="Distance, Needs adjusting"');
    expect(html).toContain('aria-label="Phone level, Not available"');
  });

  it("the retry tells the fix, the tries left and the restart, with Try now and Skip", () => {
    const html = text(render("retry-plane", "en"));
    expect(html).toContain("Raise it out to the side");
    expect(html).toContain("Two more tries");
    expect(html).toContain("Starting in 4 seconds");
    expect(html).toContain("Try now");
    expect(html).toContain("Skip this test");
    const timed = text(render("retry-timed", "en"));
    expect(timed).toContain("We will try again after two minutes of rest.");
  });

  it("captions carry the short form and the full sentence of the check data", () => {
    const ar = render("setup-close", "ar");
    expect(ar).toContain("s34-caption-short");
    expect(text(ar)).toContain("ابتعد قليلًا");
    const en = text(render("range-hold", "en"));
    expect(en).toContain("Hold your arm there.");
  });

  it("the helper strip shows for a test that counts on a helper; the booth badge always at the booth", () => {
    expect(text(render("timed-stand", "en"))).toContain("Helper beside you");
    expect(render("timed-curl", "en")).not.toContain("s34-helper");
    expect(text(render("timed-curl", "en"))).toContain("Azm booth");
  });
});
