import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GoalChoices } from "../src/app/IntakeForm";
import { SPORTS, sportsFor } from "../src/medical/sports";

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const render = (props: Partial<Parameters<typeof GoalChoices>[0]>) =>
  renderToStaticMarkup(
    createElement(GoalChoices, {
      lang: "ar",
      goal: "mobility",
      sport: undefined,
      mobility: "wheelchair",
      onGoal: () => {},
      onSport: () => {},
      ...props,
    }),
  );

describe("the goal step (booth v2, B3)", () => {
  it("offers four goals, «العودة إلى الرياضة» among them, as pressable cards", () => {
    const html = render({});
    for (const name of ["الحركة اليومية", "القوة والتحكّم", "الانتظام في التمرين", "العودة إلى الرياضة"])
      expect(plain(html)).toContain(name);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).not.toContain("<select");
    // No sport grid until the sport goal is chosen.
    expect(html).not.toContain("sport-grid");
  });

  it("shows the 13 sports with icons once Back to sport is chosen, those that suit the position first", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = render({ lang, goal: "sport", mobility: "wheelchair" });
      const text = plain(html);
      expect(html).toContain("sport-grid");
      const order = sportsFor("wheelchair").map((s) => text.indexOf(s.name[lang]));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(html.match(/class="sport-tile[^"]*"/g)).toHaveLength(SPORTS.length);
      expect(html.match(/<svg/g)!.length).toBeGreaterThanOrEqual(SPORTS.length + 4);
    }
  });

  it("marks the chosen sport, and nothing else in the grid", () => {
    const html = render({ goal: "sport", sport: "boccia" });
    const pressed = [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*>(.*?)<\/button>/g)].map((m) =>
      plain(m[1]).trim(),
    );
    expect(pressed).toEqual(["العودة إلى الرياضة", "البوتشيا"]);
  });
});
