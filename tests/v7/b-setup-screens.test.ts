/**
 * D-034 item 5, the camera setup: the block's card says nothing has started («جهّز هاتفك، لم نبدأ بعد»),
 * the movement's card says so too, their Ready is always on screen (sticky at the bottom, safe area
 * aware: a direct child of the step, never inside a column that starts below the fold), and the
 * measurement opens with «لنبدأ» before the first attempt. Rendered on the server.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckRoot } from "../../src/features/assessment/shared/CheckRoot";
import { BlockCard, MeasureScreen, ResultScreen, SetupCard } from "../../src/features/focus/RangeScreens";
import { RomController } from "../../src/features/focus/romController";
import { buildRomProtocol } from "../../src/medical/rom-protocol";
import { tV7 } from "../../src/i18n/v7";
import { entry, intake, today } from "./a-fixtures";

const inRoot = (lang: "ar" | "en", el: ReactElement) =>
  renderToStaticMarkup(
    createElement(CheckRoot, { ui: { lang }, page: false, className: "fx", children: el }),
  );

const KNEE = intake({ regions: [entry("knee", "right", ["stiffness"])] });
const protocol = buildRomProtocol({ intake: KNEE, setting: "booth", today: today() });
const items = protocol.items.filter((i) => i.block === "lying" && !i.skipped);

/** The Ready of a step: inside the sticky actions, which are a direct child of the step's split. */
const STICKY_READY =
  /<div class="fx-split"[^>]*>(?:(?!<div class="fx-split").)*<div class="fx-actions is-sticky"><button[^>]*data-action="ready"/s;

describe("the camera setup says nothing has started, with Ready always on screen (D-034 item 5)", () => {
  for (const lang of ["ar", "en"] as const) {
    it(`the block's card (${lang})`, () => {
      const html = inRoot(
        lang,
        createElement(BlockCard, {
          lang,
          block: "lying",
          items,
          helper: false,
          stage: null,
          onReady: () => {},
        }),
      );
      expect(html).toContain(tV7(lang, "rom.block.notStarted"));
      expect(html).toMatch(STICKY_READY);
      expect(html).not.toMatch(/fx-side[^>]*>(?:(?!<\/div>).)*data-action="ready"/s);
    });

    it(`the movement's card (${lang})`, () => {
      const html = inRoot(
        lang,
        createElement(SetupCard, {
          lang,
          item: items[0],
          n: 1,
          total: 2,
          turnSide: false,
          onReady: () => {},
        }),
      );
      expect(html).toContain(tV7(lang, "rom.setup.notStarted"));
      expect(html).toMatch(STICKY_READY);
    });

    it(`the measurement opens with «لنبدأ» while the start position is taken (${lang})`, () => {
      const ctl = new RomController({ protocol, painByRegion: {}, intake: KNEE, lang, restSec: 1 });
      ctl.startBlock("lying", 0);
      ctl.ready(10);
      ctl.ready(20);
      expect(ctl.phase).toBe("calibrating");
      const html = inRoot(
        lang,
        createElement(MeasureScreen, {
          lang,
          ctl,
          item: items[0],
          n: 1,
          total: 2,
          video: null,
          frame: { current: null },
          clock: () => 30,
          now: 30,
        }),
      );
      expect(html).toContain(tV7(lang, "rom.measure.letsStart"));
      expect(html).toContain(tV7(lang, "rom.measure.start"));
    });
  }

  it("keeps the sticky actions above the phone's home bar (safe area)", () => {
    const css = readFileSync(join(__dirname, "../../src/features/focus/focus.css"), "utf8");
    expect(css).toMatch(
      /\.fx-actions\.is-sticky \{[^}]*position: sticky;[^}]*bottom: 0;[^}]*env\(safe-area-inset-bottom\)/s,
    );
  });
});

describe("the result card offers one more try only when the person may take it (D-035 item 1)", () => {
  /** A controller on the knee bend's result card, measured with one valid attempt. */
  const atCard = async () => {
    const { runBlock } = await import("./b-shell-driver");
    const ctl = new RomController({ protocol, painByRegion: {}, intake: KNEE, lang: "en", restSec: 1 });
    ctl.startBlock("lying", 0);
    const run = runBlock(ctl, { until: (c) => c.current.kind === "result" }, 300);
    return { ctl, run };
  };
  const card = (lang: "ar" | "en", ctl: RomController, onAgain?: () => void) => {
    const s = ctl.current;
    if (s.kind !== "result") throw new Error("no result card");
    return inRoot(
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
        ...(onAgain ? { onAgain } : {}),
      }),
    );
  };

  for (const lang of ["ar", "en"] as const)
    it(`a quiet «try once more» beside Next, Next last (${lang})`, async () => {
      const { ctl } = await atCard();
      const html = card(lang, ctl, () => {});
      expect(html).toContain(tV7(lang, "rom.result.again"));
      expect(html).toMatch(/data-action="again"[^]*data-action="next"/);
      expect(html).toMatch(/class="fx-button is-quiet"[^>]*data-action="again"/);
    });

  it("never after the second try, nor without the shell's handler", async () => {
    const { ctl, run } = await atCard();
    expect(card("en", ctl)).not.toContain('data-action="again"');
    const { runBlock } = await import("./b-shell-driver");
    ctl.tryAgain(run.t + 100);
    runBlock(ctl, { until: (c) => c.current.kind === "result" }, 120, run.t + 100);
    expect(card("en", ctl, () => {})).not.toContain('data-action="again"');
  });
});
