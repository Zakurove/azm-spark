/**
 * The focus check's intro (D-032 item 2, D-034 item 4): the safety lines once, and the start that
 * goes straight to the check (the day screen and its calm skip screen are gone since D-034 item 4).
 * Rendered on the server.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckRoot } from "../../src/features/assessment/shared/CheckRoot";
import { IntroScreen } from "../../src/features/focus/Screens";
import { ROM_DATA } from "../../src/movements/rom";
import { screenText } from "../../src/movements/assessments";

const TEXT = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/** A screen inside the check's root (the answers' context), as the focus app renders it. */
const inRoot = (lang: "ar" | "en", el: ReactElement) =>
  renderToStaticMarkup(
    createElement(CheckRoot, { ui: { lang }, page: false, className: "fx", children: el }),
  );

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
