import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SportPath from "../src/app/SportPath";
import { createPlan, type Intake } from "../src/medical/plan";
import { DEMANDS, sportById } from "../src/medical/sports";
import { engineWeekly, libraryById } from "../src/medical/weekly";
import { EXERCISES } from "../src/exercises/defs";

const saad: Intake = {
  age: 22,
  conditions: ["sci_incomplete"],
  diagnosisNotes: "",
  medications: "",
  mobility: "wheelchair",
  support: "none",
  pain: [],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: ["weights"],
  goal: "sport",
  sport: "wheelchair_basketball",
  days: [0, 2, 4],
  time: "17:00",
  sessionMinutes: 40,
  consent: true,
};
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the sport path card (booth v2, B5)", () => {
  const plan = createPlan(saad);
  const weekly = engineWeekly(saad, plan)!;
  const sport = sportById("wheelchair_basketball")!;

  it("names the path, every demand, the exercises that build it, and what comes later", () => {
    const head = { ar: "طريقك إلى كرة السلة على الكراسي المتحركة", en: "Your path to wheelchair basketball" };
    const later = {
      ar: "الأندية واختبارات الجاهزية تأتي لاحقًا في طريقك.",
      en: "Clubs and readiness checks come later on your path.",
    };
    for (const lang of ["ar", "en"] as const) {
      const html = renderToStaticMarkup(createElement(SportPath, { lang, sport, plan, weekly }));
      const text = plain(html);
      expect(text).toContain(head[lang]);
      for (const d of sport.demands) expect(text).toContain(DEMANDS[d][lang]);
      expect(text).toContain(EXERCISES.find((e) => e.id === "seated_shoulder_press")!.name[lang]);
      const firstExtra = libraryById(weekly.days[0].extra[0].id)!;
      expect(text).toContain(firstExtra.name[lang]);
      expect(text).toContain(later[lang]);
      expect(html.match(/<li/g)).toHaveLength(sport.demands.length);
    }
  });

  it("shows the camera movements while the weekly plan is being written", () => {
    const html = renderToStaticMarkup(createElement(SportPath, { lang: "en", sport, plan, weekly: null }));
    expect(plain(html)).toContain("Seated Shoulder Press");
    expect(html).toContain("sport-path-wait");
  });
});
