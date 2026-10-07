/**
 * Wave 2 fixes (UI review), checked on the source: the shell's keyboard and screen reader focus
 * (browser checks of the same are in the wave 2 entry of the contract change log).
 *   - The measurement's column stays mounted for the whole movement: Page keys <main> by the step, the
 *     phase only names data-screen (no replayed entrance, no lost focus at each phase).
 *   - STOP is first in the measurement's focus order and has focus when no question is open; a
 *     screen's heading takes focus when it opens (the day's one screen and its calm skip screen,
 *     QuestionText, FaintAskScreen).
 *   - The stop list and the leave dialog are modal (v1 CheckDialog's behaviour): inert page, focus on
 *     the heading, Tab kept inside, focus returned; Escape stays in the check on the leave dialog only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, "../../src/features/focus", f), "utf8");
const between = (src: string, a: string, b: string) =>
  src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));

describe("focus and modality in the focus shell", () => {
  it("keys the column by the step, the measurement's phase only naming data-screen", () => {
    const parts = read("parts.tsx");
    expect(parts).toMatch(/<main className="fx-main" key=\{key\}>/);
    expect(parts).toMatch(/const key = step \?\? screen;/);
    expect(read("FocusApp.tsx")).toMatch(/step: `measure:\$\{itemKey\(step\.item\)\}`/);
  });

  it("puts STOP first in the measurement and focuses it while no question is open", () => {
    const measure = between(read("RangeScreens.tsx"), "export function MeasureScreen", "function Question(");
    expect(measure.indexOf("<StopButton")).toBeLessThan(measure.indexOf("<Stage"));
    expect(measure).toMatch(/if \(!asking\) stopRef\.current\?\.focus/);
  });

  it("focuses each question's heading when it opens", () => {
    const screens = read("Screens.tsx");
    expect(between(screens, "export function DayScreen", "export function SkipTodayScreen")).toMatch(
      /useFocusOnMount/,
    );
    expect(between(screens, "export function SkipTodayScreen", "export function WalkPainScreen")).toMatch(
      /useFocusOnMount/,
    );
    expect(between(screens, "export function QuestionText", "export function StartingScreen")).toMatch(
      /useFocusOnMount/,
    );
    expect(between(screens, "export function FaintAskScreen", "const STOP_ICONS")).toMatch(/useFocusOnMount/);
  });

  it("makes the stop list and the leave dialog modal, Escape staying on the leave dialog only", () => {
    const screens = read("Screens.tsx");
    const list = between(screens, "export function StopListScreen", "export function LeaveDialog");
    expect(list).toMatch(/useModal\(undefined,/);
    expect(list).toMatch(/ref=\{modal\.ref\}/);
    const leave = between(
      screens,
      "export function LeaveDialog",
      "/* --------------------------------------------------------------- the end */",
    );
    expect(leave).toMatch(/useModal\(onStay\)/);
    expect(read("parts.tsx")).toMatch(/inertOutside\(el\)/);
  });
});

describe("the 2 m sizes on the measurement (v1 UX spec 4.1)", () => {
  it("fits the answers above STOP with v1's fold fitting, from the 2 m sizes down", () => {
    const measure = between(read("RangeScreens.tsx"), "export function MeasureScreen", "function Question(");
    expect(measure).toMatch(/useFoldFit\(root, 3,/);
    expect(measure).toMatch(/data-fit=\{fit\}/);
    expect(measure).toMatch(/className="fx-v1 fx-zones" data-fold/);
    const css = read("focus.css");
    // Level 0: the question and the zone labels at 40 px, zones of 120 px, the caption at 34 px.
    expect(css).toMatch(/\.azm-check\.fx \.fx-measure \.fx-ask \.fx-title,[^{]*\{\s*font-size: 2\.5rem;/);
    expect(css).toMatch(/\.azm-check\.fx \.fx-measure \.fx-zones \.safety-zone \{\s*min-height: 120px;/);
    expect(css).toMatch(/\.fx-measure \.fx-caption \{\s*font-size: 2\.125rem;/);
  });
});
