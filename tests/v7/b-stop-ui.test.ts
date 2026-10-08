/**
 * D-034 item 4: no red STOP on any check or walk screen; the X at the top stays and opens the stop
 * and leave options (the leave dialog with «توقّف الآن», which opens the stop list). The stop list keeps
 * v1's guard against a double tap: a row counts only for a press that started on it after the list
 * opened, never within 600 ms of the press that opened it (useArmedPress, SAFETY_TIMING.stopArmMs).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckRoot } from "../../src/features/assessment/shared/CheckRoot";
import {
  BlockCard,
  PainStopScreen,
  ReaskScreen,
  SetupCard,
  TimerScreen,
} from "../../src/features/focus/RangeScreens";
import { LeaveDialog, StopListScreen } from "../../src/features/focus/Screens";
import { buildRomProtocol } from "../../src/medical/rom-protocol";
import { tV7 } from "../../src/i18n/v7";
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
const STOP = /safety-stop|fx-stopbar/;
const read = (f: string) => readFileSync(join(__dirname, "../../src", f), "utf8");

describe("no red STOP on the check's screens (D-034 item 4)", () => {
  it("is on none of the block card, the setup card, the re-ask, the pain stop and the timers", () => {
    const pages = [
      createElement(BlockCard, {
        lang: "ar",
        block: "lying",
        items,
        helper: false,
        stage: null,
        onReady: () => {},
      }),
      createElement(SetupCard, {
        lang: "ar",
        item: items[0],
        n: 1,
        total: 2,
        turnSide: false,
        onReady: () => {},
      }),
      createElement(ReaskScreen, { lang: "ar", item: items[0], onAnswer: () => {} }),
      createElement(PainStopScreen, { lang: "ar", item: items[0], onContinue: () => {} }),
      createElement(TimerScreen, { lang: "ar", kind: "rest", leftMs: 30_000, totalMs: 60_000 }),
    ];
    for (const el of pages) expect(inRoot(el)).not.toMatch(STOP);
  });

  it("is gone from the measurement, the walk and the shell's range steps", () => {
    expect(read("features/focus/RangeScreens.tsx")).not.toMatch(/StopButton|StopBar/);
    expect(read("features/gait/GaitCapture.tsx")).not.toMatch(/StopButton|StopBar/);
    expect(read("features/focus/FocusApp.tsx")).not.toMatch(/onStop=\{\(\) => session\.requestStop\(\)\}/);
  });

  it("the X opens the stop and leave options: «توقّف الآن», leave the check, stay", () => {
    const html = inRoot(
      createElement(LeaveDialog, { lang: "ar", onStay: () => {}, onLeave: () => {}, onStop: () => {} }),
    );
    expect(html).toContain(tV7("ar", "rom.shell.stopTitle"));
    expect(html).toMatch(/data-action="stop_now"/);
    expect(html).toMatch(/data-action="leave_confirm"/);
    expect(html).toMatch(/data-action="stay"/);
    expect(html.indexOf('data-action="stop_now"')).toBeLessThan(html.indexOf('data-action="leave_confirm"'));
  });
});

describe("the stop list's guard against a double tap (v1 S41)", () => {
  it("opens with no STOP under it (D-034 item 4: the X opened it)", () => {
    const html = inRoot(
      createElement(StopListScreen, {
        lang: "ar",
        env: { setting: "booth", ctx: { conditions: [], support: "none" } } as never,
        preselect: null,
        onChoose: () => {},
      }),
    );
    expect(html).toMatch(/class="fx-overlay"/);
    expect(html).not.toMatch(STOP);
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

describe("the lying block for a person alone (UI review)", () => {
  it("says on its card that someone beside taps for the person lying down", () => {
    const html = inRoot(
      createElement(BlockCard, {
        lang: "ar",
        block: "lying",
        items,
        helper: false,
        stage: null,
        onReady: () => {},
      }),
    );
    expect(html).toContain("وأنت مستلقٍ، يضغط مرافقك أو أحد أفراد فريقنا الأزرار عنك.");
    expect(html).toContain("مرافقي بجانبي، جاهز");
  });

  it("shows the last lying result in the sit minute, then the stand slowly line with the way on", async () => {
    const { TimerScreen } = await import("../../src/features/focus/RangeScreens");
    const result = { value: 4, status: "measured" } as never;
    const sitting = inRoot(
      createElement(TimerScreen, {
        lang: "ar",
        kind: "sit",
        leftMs: 30_000,
        totalMs: 60_000,
        last: { item: items[1], result },
      }),
    );
    expect(sitting).toContain("آخر حركة");
    expect(sitting).not.toContain("يمكنك الوقوف الآن ببطء");
    const standing = inRoot(
      createElement(TimerScreen, {
        lang: "ar",
        kind: "sit",
        leftMs: 0,
        totalMs: 60_000,
        standing: true,
        onNext: () => {},
      }),
    );
    expect(standing).toContain("يمكنك الوقوف الآن ببطء");
    expect(standing).toContain('data-action="next"');
  });
});
