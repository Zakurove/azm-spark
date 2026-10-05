/**
 * Wave 2 fix (engine review finding 5): the C-10 model probe of a block's card is awaited before the
 * block measures. «جاهز» waits from the card's first frame until the probe of that block ends, so a quick
 * tap never skips the probe nor lets its switch to Lite rebuild the pose source during an attempt; a
 * camera that failed or never started holds nothing.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { blockWaitsForProbe } from "../../src/features/focus/FocusApp";
import { BlockCard } from "../../src/features/focus/RangeScreens";
import { buildRomProtocol } from "../../src/medical/rom-protocol";
import { entry, intake, today } from "./a-fixtures";

describe("the block card waits for the model probe (C-10)", () => {
  it("waits while the camera starts and the probe runs, and not once it ended or without a camera", () => {
    expect(blockWaitsForProbe("0", "camera", null)).toBe(true);
    expect(blockWaitsForProbe("0", "model", null)).toBe(true);
    expect(blockWaitsForProbe("0", "running", null)).toBe(true);
    expect(blockWaitsForProbe("0", "running", { key: "0", done: false })).toBe(true);
    expect(blockWaitsForProbe("0", "running", { key: "0", done: true })).toBe(false);
    // The probe of an earlier block does not open a later one.
    expect(blockWaitsForProbe("2", "running", { key: "0", done: true })).toBe(true);
    expect(blockWaitsForProbe("0", "error", null)).toBe(false);
    expect(blockWaitsForProbe("0", "idle", null)).toBe(false);
    expect(blockWaitsForProbe(null, "running", null)).toBe(false);
  });

  it("shows «جاهز» disabled with the camera line while it waits", () => {
    const p = buildRomProtocol({
      intake: intake({ regions: [entry("knee", "right", ["stiffness"])] }),
      setting: "booth",
      today: today(),
    });
    const items = p.items.filter((i) => i.block === "lying");
    const html = (waiting: boolean) =>
      renderToStaticMarkup(
        createElement(BlockCard, {
          lang: "ar",
          block: "lying",
          items,
          helper: false,
          stage: null,
          waiting,
          onReady: () => {},
        }),
      );
    expect(html(true)).toMatch(/<button[^>]*disabled=""[^>]*data-action="ready"/);
    expect(html(true)).toContain("لحظة، نجهّز الكاميرا.");
    expect(html(false)).not.toMatch(/disabled=""/);
  });
});
