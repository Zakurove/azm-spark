/**
 * D-032 item 2: the focus check's day questions on one short screen, and the calm screen a yes to the
 * worry question opens. Rendered on the server: the items in their order with the data's words, Arabic
 * first with complete English, one button; the calm screen without a phone number (the ambulance
 * number stays on the emergency screen), with its way to that screen.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckRoot } from "../../src/features/assessment/shared/CheckRoot";
import { DayScreen, IntroScreen, SkipTodayScreen } from "../../src/features/focus/Screens";
import type { DayItem } from "../../src/medical/focus-precheck";
import { GAIT_DATA } from "../../src/movements/gait";
import { ROM_DATA } from "../../src/movements/rom";
import { screenText } from "../../src/movements/assessments";
import type { RegionId } from "../../src/medical/body-map";

const TEXT = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/** A screen inside the check's root (the answers' context), as the focus app renders it. */
const inRoot = (lang: "ar" | "en", el: ReactElement) =>
  renderToStaticMarkup(
    createElement(CheckRoot, { ui: { lang }, page: false, className: "fx", children: el }),
  );

function day(lang: "ar" | "en", items: DayItem[], areas: RegionId[] = ["knee"]) {
  return inRoot(lang, createElement(DayScreen, { lang, areas, itemsFor: () => items, onDone: () => {} }));
}

describe("the day's one screen (D-032 item 2)", () => {
  it("shows each item with the data's words, in order, and one button", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = day(lang, ["pain", "worry", "walk10m", "unsteady", "helper"]);
      const text = TEXT(html);
      const order = [
        ROM_DATA.copy.day_pain_ask[lang].split(/[.؟?]/)[0],
        ROM_DATA.copy.day_worry_ask[lang].split(/[،,]/)[0],
        GAIT_DATA.copy.setup.pc_walk_10m[lang].split(/[،,]/)[0],
        ROM_DATA.copy.day_unsteady_ask[lang].split(/[،,]/)[0],
        ROM_DATA.copy.day_helper_ask[lang],
      ];
      let at = -1;
      for (const line of order) {
        const i = text.indexOf(line);
        expect(i, `${lang}: ${line}`).toBeGreaterThan(at);
        at = i;
      }
      // The pain covers today's areas, with «no pain today»; the helper line says who is meant.
      expect(text).toContain(ROM_DATA.copy.day_pain_none[lang]);
      expect(text).toContain(ROM_DATA.regions.find((r) => r.id === "knee")![lang]);
      expect(text).toContain(ROM_DATA.copy.day_helper_note[lang]);
      // One screen, one button.
      expect(html.match(/data-action="start"/g)).toHaveLength(1);
      expect(html.match(/data-day="/g)).toHaveLength(5);
      if (lang === "ar") expect(text).toContain("كيف حالك اليوم؟");
    }
  });

  it("asks no pain question without an area, and asks only the worry question after its yes", () => {
    const worryOnly = day("en", ["worry"], []);
    expect(worryOnly).not.toContain('data-day="pain"');
    expect(worryOnly).toContain('data-day="worry"');
  });
});

describe("the calm skip screen (a yes to the worry question)", () => {
  const skip = (lang: "ar" | "en") =>
    inRoot(lang, createElement(SkipTodayScreen, { lang, onToday: () => {}, onUrgent: () => {} }));

  it("skips today and suggests the doctor if it is new, with no phone number and a way to the emergency screen", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = skip(lang);
      const text = TEXT(html);
      expect(text).toContain(ROM_DATA.copy.day_skip_title[lang]);
      expect(text).toContain(ROM_DATA.copy.day_skip_body[lang]);
      expect(text).toContain(ROM_DATA.copy.day_skip_urgent[lang]);
      expect(html).toContain('data-action="today"');
      expect(html).toContain('data-action="urgent"');
      // 997 stays on the emergency screen only (Nasser's proportionate safety); no 937 either.
      expect(text).not.toMatch(/997|٩٩٧|937|٩٣٧/);
      expect(html).not.toContain("tel:");
    }
  });
});

describe("the intro says the safety lines once (D-032 item 2)", () => {
  const intro = (sciWarning: boolean) =>
    inRoot(
      "en",
      createElement(IntroScreen, {
        lang: "en",
        protocol: { rulesVersion: "x", items: [], deferred: [], notMeasured: [], sitBeforeStand: false },
        gait: null,
        setting: "home",
        sciWarning,
        onStart: () => {},
      }),
    );

  it("carries warn_sci_t6 on its safety card only for a spinal cord injury", () => {
    const warn = screenText("warn_sci_t6", "en").slice(0, 40);
    expect(TEXT(intro(true))).toContain(warn);
    expect(TEXT(intro(false))).not.toContain(warn);
    expect(TEXT(intro(false))).toContain(ROM_DATA.copy.stop_line.en);
  });
});
