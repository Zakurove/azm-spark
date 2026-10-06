/**
 * D-030 item 2, C4-7: C's CSS no longer hides parts of B's walk slot. The walk tells the slot what to
 * show (walkChrome): the slot's title card on the walk's first card only, and its «لن أمشي اليوم»
 * while nothing was recorded and the person is not set up to walk; GaitSlot takes them as props.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GaitSlot } from "../../src/features/focus/Screens";
import { GaitController } from "../../src/features/gait/controller";
import { walkChrome } from "../../src/features/gait/GaitCapture";
import type { GaitPlan } from "../../src/medical/gait-eligibility";

const PLAN: GaitPlan = {
  offered: true,
  modes: ["overground", "walking_pad"],
  defaultMode: "overground",
  padAllowed: true,
  helperRequired: true,
  antalgicOnly: false,
  staticStance: true,
  views: {
    overground: ["front", "back", "side"],
    walking_pad: [
      { view: "pad_side", nearSide: "right" },
      { view: "pad_side", nearSide: "left" },
      { view: "pad_front" },
    ],
  },
};

const slot = (props: { hero?: boolean; skip?: boolean }) =>
  renderToStaticMarkup(
    createElement(GaitSlot, {
      lang: "en",
      onSkip: () => undefined,
      ...props,
      children: createElement("div", { id: "walk" }),
    }),
  );

describe("the walk's slot (B) and what the walk shows of it (C)", () => {
  it("shows its title card and its skip unless the walk says otherwise", () => {
    expect(slot({})).toContain("fx-hero");
    expect(slot({})).toContain('data-action="skip_walk"');
    expect(slot({ hero: false })).not.toContain("fx-hero");
    expect(slot({ skip: false })).not.toContain('data-action="skip_walk"');
    expect(slot({ hero: false, skip: false })).toContain('id="walk"');
  });

  it("gives the title card to the first card only, and the skip until the person is set up to walk", () => {
    const ctl = new GaitController({ plan: PLAN, poseModel: () => "full" });
    ctl.start(0);
    expect(walkChrome(ctl)).toEqual({ hero: true, skip: true });
    ctl.confirm(0);
    ctl.chooseMode("walking_pad", 0);
    expect(walkChrome(ctl)).toEqual({ hero: false, skip: true });
    ctl.setGear({ shoes: true, brace: null }, 0);
    for (let i = 0; i < 4 && ctl.current.id !== "pad_on"; i++) ctl.confirm(0);
    expect(ctl.current.id).toBe("pad_on");
    expect(walkChrome(ctl)).toEqual({ hero: false, skip: false });
  });

  it("leaves the slot's parts to the slot: no rule of gait.css reaches into it", () => {
    const css = readFileSync(join(__dirname, "../../src/features/gait/gait.css"), "utf8");
    expect(css).not.toMatch(/\.fx-gait\s*:has\(/);
    expect(css).not.toMatch(/\.fx-hero|\.fx-actions\s*\{/);
  });
});
