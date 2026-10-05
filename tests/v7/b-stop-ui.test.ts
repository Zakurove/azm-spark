/**
 * Wave 2 fixes (UI review): STOP is on every range step while the camera runs (the block card, the setup
 * card, the re-ask, the pain stop and the result card, as v1 has it on every camera, after and between
 * state), and the stop list keeps v1's guard against a double tap: a row counts only for a press that
 * started on it after the list opened, never within 600 ms of the press that opened it (useArmedPress,
 * SAFETY_TIMING.stopArmMs), and STOP stays visible and inert at its place with no row under it (S41).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckRoot } from "../../src/features/assessment/shared/CheckRoot";
import { BlockCard, PainStopScreen, ReaskScreen, SetupCard } from "../../src/features/focus/RangeScreens";
import { StopListScreen } from "../../src/features/focus/Screens";
import { buildRomProtocol } from "../../src/medical/rom-protocol";
import { entry, intake, today } from "./a-fixtures";

const inRoot = (el: ReactElement) =>
  renderToStaticMarkup(
    createElement(CheckRoot, { ui: { lang: "ar", booth: true }, page: false, className: "fx", children: el }),
  );

const items = buildRomProtocol({
  intake: intake({ regions: [entry("knee", "right", ["stiffness"])] }),
  setting: "booth",
  today: today(),
}).items.filter((i) => i.block === "lying");
const STOP = /class="safety-stop"[^>]*aria-label/;

describe("STOP on every range step while the camera runs", () => {
  const stop = () => {};
  it("is on the block card, the setup card, the re-ask and the pain stop", () => {
    const pages = [
      createElement(BlockCard, {
        lang: "ar",
        block: "lying",
        items,
        helper: false,
        stage: null,
        onReady: () => {},
        onStop: stop,
      }),
      createElement(SetupCard, {
        lang: "ar",
        item: items[0],
        n: 1,
        total: 2,
        turnSide: false,
        onReady: () => {},
        onStop: stop,
      }),
      createElement(ReaskScreen, { lang: "ar", item: items[0], onAnswer: () => {}, onStop: stop }),
      createElement(PainStopScreen, { lang: "ar", item: items[0], onContinue: () => {}, onStop: stop }),
    ];
    for (const el of pages) expect(inRoot(el)).toMatch(STOP);
  });

  it("is wired from the shell on every range step, the result card included", () => {
    const app = readFileSync(join(__dirname, "../../src/features/focus/FocusApp.tsx"), "utf8");
    expect(app.match(/onStop=\{\(\) => session\.requestStop\(\)\}/g)?.length).toBeGreaterThanOrEqual(7);
  });
});

describe("the stop list's guard against a double tap (v1 S41)", () => {
  it("keeps STOP visible and inert at its place, the list ending above it", () => {
    const html = inRoot(
      createElement(StopListScreen, {
        lang: "ar",
        env: { setting: "booth", ctx: { conditions: [], support: "none" } } as never,
        preselect: null,
        onChoose: () => {},
      }),
    );
    expect(html).toMatch(/class="fx-overlay has-stop"/);
    expect(html).toMatch(/fx-stopbar is-inert" aria-hidden="true"/);
    expect(html).not.toMatch(/<button[^>]*class="safety-stop"/);
  });

  it("counts a row only for an armed press (useArmedPress with SAFETY_TIMING.stopArmMs)", () => {
    const src = readFileSync(join(__dirname, "../../src/features/focus/Screens.tsx"), "utf8");
    const list = src.slice(
      src.indexOf("export function StopListScreen"),
      src.indexOf("export function LeaveDialog"),
    );
    expect(list).toMatch(/useArmedPress\(SAFETY_TIMING\.stopArmMs\)/);
    expect(list).toMatch(/if \(armed\(e\)\) onChoose\(o\.id\)/);
  });
});
