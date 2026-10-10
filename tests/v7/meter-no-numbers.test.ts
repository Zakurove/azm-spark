/**
 * D-036 item 4: the live range meter shows no numbers. Nasser: «remove the numbers. Make it just a
 * range-of-motion meter». The live measurement (and the maximum question over it) carries no degree,
 * no tick label and no «°»; the meter is the typical band, the marker and the hold ring. The result
 * keeps its words, the degrees small. The meter moves from requestAnimationFrame, so a new angle no
 * longer renders the page (the controller does not notify for it).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckRoot } from "../../src/features/assessment/shared/CheckRoot";
import { bandShares, inBand, RangeMeter, scaleMax } from "../../src/features/focus/Dial";
import { MeasureScreen, ResultScreen } from "../../src/features/focus/RangeScreens";
import { RomController } from "../../src/features/focus/romController";
import { buildRomProtocol } from "../../src/medical/rom-protocol";
import { tV7 } from "../../src/i18n/v7";
import { entry, intake, today } from "./a-fixtures";
import { runBlock } from "./b-shell-driver";

const LANGS = ["ar", "en"] as const;
/** Any digit (Western, Arabic Indic, Persian) or the degree sign. */
const NUMBERISH = /[0-9٠-٩۰-۹°]/;

const inRoot = (lang: "ar" | "en", el: ReactElement) =>
  renderToStaticMarkup(
    createElement(CheckRoot, { ui: { lang }, page: false, className: "fx", children: el }),
  );
/** The text a person sees in some markup (tags dropped, attributes with them). */
const textOf = (html: string) => html.replace(/<[^>]*>/g, " ");
/** The markup of the range meter inside a screen (its own div, to the end of its legend). */
const meterOf = (html: string): string => {
  const at = html.indexOf('<div class="fx-meter ');
  expect(at, "the screen has a range meter").toBeGreaterThanOrEqual(0);
  let depth = 0;
  const re = /<(\/?)div\b[^>]*>/g;
  re.lastIndex = at;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(at, m.index + m[0].length);
  }
  throw new Error("unclosed meter");
};

const labels = (lang: "ar" | "en") => ({
  band: tV7(lang, "rom.measure.band"),
  you: tV7(lang, "rom.measure.you"),
  hold: tV7(lang, "rom.measure.hold"),
});

describe("the range meter on its own", () => {
  const cases = [
    { kind: "flexion", typical: 150, withinFrom: 128, withinUpTo: null },
    { kind: "lack", typical: 0, withinFrom: null, withinUpTo: 8 },
    { kind: "signed", typical: 45, withinFrom: 30, withinUpTo: null },
    { kind: "flexion", typical: null, withinFrom: null, withinUpTo: null },
  ] as const;
  for (const lang of LANGS)
    for (const c of cases)
      for (const mode of ["live", "held"] as const)
        it(`has no number, tick label or degree sign (${lang}, ${c.kind}, ${mode}, typical ${c.typical})`, () => {
          const html = renderToStaticMarkup(
            createElement(RangeMeter, {
              lang,
              mode,
              ...c,
              value: 117,
              read: () => ({ value: 117, hold: 0.6 }),
              labels: labels(lang),
            }),
          );
          expect(textOf(html)).not.toMatch(NUMBERISH);
          // No text inside the drawing at all (the old dial wrote the typical value on its scale).
          expect(html).not.toMatch(/<text\b/);
          expect(html).toContain('class="fx-meter-track"');
        });

  it("shades the typical band and keeps it on the scale", () => {
    const max = scaleMax("flexion", 150, 128);
    expect(bandShares("flexion", 128, null, max)).toEqual({ from: 128 / max, to: 1 });
    expect(bandShares("lack", null, 8, scaleMax("lack", 0, 8))).toEqual({ from: 0, to: 8 / 60 });
    expect(bandShares("flexion", null, null, max)).toBeNull();
    const html = renderToStaticMarkup(
      createElement(RangeMeter, {
        lang: "en",
        kind: "flexion",
        mode: "live",
        typical: 150,
        withinFrom: 128,
        withinUpTo: null,
        labels: labels("en"),
      }),
    );
    expect(html).toContain('class="fx-meter-band"');
    expect(html).toContain(labels("en").band);
  });

  it("knows when the person reaches the band (the gentle reached state)", () => {
    expect(inBand("flexion", 130, 128, null)).toBe(true);
    expect(inBand("flexion", 120, 128, null)).toBe(false);
    expect(inBand("lack", 5, null, 8)).toBe(true);
    expect(inBand("lack", 20, null, 8)).toBe(false);
    expect(inBand("flexion", null, 128, null)).toBe(false);
  });

  it("starts waiting before the joint is seen, and shows the hold ring full on the question", () => {
    const live = renderToStaticMarkup(
      createElement(RangeMeter, {
        lang: "ar",
        kind: "flexion",
        mode: "live",
        typical: 150,
        withinFrom: 128,
        withinUpTo: null,
        labels: labels("ar"),
      }),
    );
    expect(live).toMatch(/data-state="wait"/);
    const held = renderToStaticMarkup(
      createElement(RangeMeter, {
        lang: "ar",
        kind: "flexion",
        mode: "held",
        value: 140,
        typical: 150,
        withinFrom: 128,
        withinUpTo: null,
        labels: labels("ar"),
      }),
    );
    expect(held).toMatch(/data-state="done"/);
    expect(held).toMatch(/data-band="in"/);
    expect(held).toMatch(/class="fx-meter-ring"[^>]*stroke-dashoffset="0\.00"/);
  });
});

describe("the live measuring screen shows no numbers (D-036 item 4)", () => {
  const SHOULDER = intake({ regions: [entry("shoulder", "right", ["stiffness"])] });
  const protocol = buildRomProtocol({ intake: SHOULDER, setting: "booth", today: today() });
  const block = protocol.items.find((i) => !i.skipped)!.block;

  const atPhase = (phase: string, lang: "ar" | "en") => {
    const ctl = new RomController({ protocol, painByRegion: {}, intake: SHOULDER, lang, restSec: 1 });
    ctl.startBlock(block, 0);
    const run = runBlock(
      ctl,
      {
        until: (c) =>
          c.current.kind === "measure" &&
          c.phase === phase &&
          (phase !== "attempt" || (c.live !== null && Math.abs(c.live) > 20)),
      },
      120,
    );
    const s = ctl.current;
    if (s.kind !== "measure" || ctl.phase !== phase) throw new Error(`never reached ${phase}`);
    return { ctl, item: s.item, t: run.t };
  };
  const screen = (lang: "ar" | "en", phase: string) => {
    const { ctl, item, t } = atPhase(phase, lang);
    const html = inRoot(
      lang,
      createElement(MeasureScreen, {
        lang,
        ctl,
        item,
        n: 1,
        total: 3,
        video: null,
        frame: { current: null },
        clock: () => t,
        now: t,
      }),
    );
    return { html, ctl };
  };

  for (const lang of LANGS)
    for (const phase of ["calibrating", "attempt", "ask_max"] as const)
      it(`${phase} (${lang})`, () => {
        const { html, ctl } = screen(lang, phase);
        // The meter itself: no digit and no degree sign.
        expect(textOf(meterOf(html))).not.toMatch(NUMBERISH);
        // The whole screen: no degree sign, no number of the angle, no old dial or held number.
        expect(textOf(html)).not.toContain("°");
        expect(html).not.toMatch(/fx-dial-readout|fx-dial-typical|fx-dial-tick/);
        if (phase !== "calibrating") {
          const angle = phase === "ask_max" ? ctl.hold?.deg : ctl.live;
          expect(angle, "the angle is known on this screen").toEqual(expect.any(Number));
          const shown = String(Math.round(Math.abs(angle!)));
          expect(textOf(html)).not.toMatch(new RegExp(`(^|[^0-9])${shown}([^0-9]|$)`));
        }
        if (phase === "ask_max") expect(html).toMatch(/<div class="fx-held"><div class="fx-meter is-held"/);
      });

  it("a new angle does not render the page: the controller notifies phases, not frames", () => {
    const ctl = new RomController({ protocol, painByRegion: {}, intake: SHOULDER, lang: "en", restSec: 1 });
    ctl.startBlock(block, 0);
    // Notifications while the try runs (a phase change notifies once the phase has changed).
    let notified = 0;
    const off = ctl.subscribe(() => {
      if (ctl.phase === "attempt") notified++;
    });
    let moved = 0;
    let last: number | null = null;
    runBlock(
      ctl,
      {
        at: () => {
          if (ctl.phase === "attempt" && ctl.live !== last) moved++;
          last = ctl.live;
        },
        until: (c) => c.phase === "ask_max",
      },
      120,
    );
    off();
    expect(ctl.phase).toBe("ask_max");
    expect(moved).toBeGreaterThan(20);
    expect(notified).toBeLessThan(moved / 4);
  });
});

describe("the result keeps its words, with the degrees small (D-036 item 4)", () => {
  const KNEE = intake({ regions: [entry("knee", "right", ["stiffness"])] });
  const protocol = buildRomProtocol({ intake: KNEE, setting: "booth", today: today() });
  for (const lang of LANGS)
    it(`the meter settles on the value, the degrees under it (${lang})`, () => {
      const ctl = new RomController({ protocol, painByRegion: {}, intake: KNEE, lang, restSec: 1 });
      ctl.startBlock("lying", 0);
      runBlock(ctl, { until: (c) => c.current.kind === "result" }, 300);
      const s = ctl.current;
      if (s.kind !== "result") throw new Error("no result card");
      const html = inRoot(
        lang,
        createElement(ResultScreen, {
          lang,
          ctl,
          item: s.item,
          result: s.result,
          saved: null,
          intake: KNEE,
          last: false,
          onNext: () => {},
        }),
      );
      const meter = meterOf(html);
      expect(meter).toContain('data-mode="final"');
      expect(meter).toMatch(
        new RegExp(`<p class="fx-meter-degrees"><bdi dir="ltr">${Math.abs(s.result.value!)}°</bdi>`),
      );
      // The digits are Western in both languages (D-036 item 3).
      expect(textOf(html)).not.toMatch(/[٠-٩]/);
    });

  it("styles the degrees small, and no big readout is left", () => {
    const css = readFileSync(join(__dirname, "../../src/features/focus/focus.css"), "utf8");
    expect(css).toMatch(/\.fx-meter-degrees \{[^}]*font-size: 1rem;/);
    expect(css).not.toMatch(/\.fx-dial-readout/);
    expect(css).not.toMatch(/arabic-indic/);
  });
});
