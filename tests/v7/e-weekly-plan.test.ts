/**
 * Step E3 (contract 1.2: src/app/WeeklyPlan.tsx, «exercise -> finding links»): the Program tab's week
 * marks each exercise the findings chose, «من نتائجك» / "From your results", and inside it says why in
 * one line, with the way to the result behind it in a VITE_V7=1 build; its steps read with the hold its
 * dose resolved. A week of the v1 rules shows exactly what it did.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WeeklyPlanView from "../../src/app/WeeklyPlan";
import { createPlan } from "../../src/medical/plan";
import { targetedWeekly } from "../../src/medical/targets";
import { engineWeekly, libraryById } from "../../src/medical/weekly";
import { FAHD, finding } from "./e-fixtures";

const REF = {
  checkId: "0f0e0d0c-0b0a-4908-8706-050403020100",
  romVersion: "r",
  gaitVersion: null,
  targetsVersion: "t",
  created: 5,
};
const plan = createPlan(FAHD);
const targeted = targetedWeekly(
  FAHD,
  plan,
  [
    finding("shoulder_flexion", "right", { finding: "marked", priority: 3, path: "umn" }),
    finding("knee_flexion", "right", { finding: "mild", priority: 2, path: "tight", cause: "tight" }),
  ],
  [],
  REF,
)!;
const render = (lang: "ar" | "en", weekly = targeted) =>
  renderToStaticMarkup(
    createElement(WeeklyPlanView, { lang, plan: { ...plan, weekly }, onLoaded: () => undefined }),
  );
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/** The day the week opens on: the first training day from today (WeeklyPlanView's dayIdx). */
const shown = Math.max(
  0,
  plan.days.findIndex((d) => d >= new Date().getDay()),
);

describe("the Program tab's week with the findings' exercises", () => {
  it("marks each exercise the findings chose and says why in one line", () => {
    const first = targeted.days[shown];
    const items = [...first.warmup, ...first.extra, ...first.cooldown];
    const chosen = items.filter((i) => i.why);
    expect(chosen.length).toBeGreaterThan(0);
    for (const lang of ["ar", "en"] as const) {
      const html = render(lang);
      expect(html.match(/data-from-results/g)?.length).toBe(chosen.length);
      for (const i of chosen) expect(text(html)).toContain(i.why![lang]);
      expect(text(html)).toContain(lang === "ar" ? "من نتائجك" : "From your results");
    }
  });

  it("reads each step whole, with the hold of the item", () => {
    for (const lang of ["ar", "en"] as const) expect(render(lang)).not.toMatch(/\{hold_/);
  });

  it("says a held dose as the program page does: Arabic counts its seconds, a walk reads in minutes", () => {
    // An isometric hold of the pain stable path (5 seconds, 10 times) and walking practice (10 minutes).
    const weekly = {
      ...targeted,
      days: targeted.days.map((d, i) =>
        i === shown
          ? {
              ...d,
              warmup: [{ id: "quad_set", sets: 10, holdSeconds: 5 }, ...d.warmup.slice(1)],
              extra: [{ id: "walking_practice", sets: 1, holdSeconds: 600 }, ...d.extra.slice(1)],
            }
          : d,
      ),
    };
    const ar = text(render("ar", weekly)),
      en = text(render("en", weekly));
    expect(ar).toContain("10 مرات × 5 ثوانٍ");
    expect(ar).toContain("10 دقائق");
    expect(ar).not.toContain("5 ثانية");
    expect(en).toContain("10 × 5 sec");
    expect(en).toContain("10 minutes");
    expect(en).not.toContain("600 sec");
  });

  it("a week of the v1 rules shows no mark and no why", () => {
    const v1 = engineWeekly(FAHD, plan)!;
    const html = render("en", v1);
    expect(html).not.toContain("data-from-results");
    expect(html).not.toContain("From your results");
    const id = v1.days[shown].extra[0].id;
    expect(text(html)).toContain(libraryById(id)!.name.en);
  });
});
