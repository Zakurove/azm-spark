/**
 * Step E3 (E1-8, D-026 item 9; contract 1.2.1, src/app/GuidedCard.tsx): the guided card of a targeted
 * item shows its steps with the hold its dose resolved («30 ثانية», «لحظة» on the pain path) in place of
 * the {hold_ar} and {hold_en} placeholders, the exercise's own cautions, and the NIA credit line of a
 * text adapted from NIA, in both languages. A card of the v1 library shows exactly what it did.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GuidedCard from "../../src/app/GuidedCard";
import { libraryById } from "../../src/medical/pool";
import type { WeeklyItem } from "../../src/medical/weekly";

const card = (lang: "ar" | "en", item: WeeklyItem) =>
  renderToStaticMarkup(
    createElement(GuidedCard, {
      lang,
      item,
      slot: "cooldown",
      position: 7,
      total: 8,
      restSeconds: 45,
      onDone: () => undefined,
      onSkip: () => undefined,
      onExit: () => undefined,
    }),
  );
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the guided card of a targeted item", () => {
  it("fills the steps' hold from the item", () => {
    const item: WeeklyItem = {
      id: "chin_to_chest",
      sets: 2,
      holdSeconds: 30,
      hold: { ar: "30 ثانية", en: "30 seconds" },
      why: { ar: "سبب", en: "A reason" },
    };
    expect(libraryById("chin_to_chest")!.steps.en.join(" ")).toContain("{hold_en}");
    const en = text(card("en", item));
    expect(en).toContain("Hold for 30 seconds without pulling your head with your hands.");
    expect(en).not.toContain("{hold");
    const ar = text(card("ar", item));
    expect(ar).toContain("30 ثانية");
    expect(ar).not.toContain("{hold");
    // A hold stored before D-036 in Arabic Indic digits shows in Western digits.
    const stored = text(card("ar", { ...item, hold: { ar: "٣٠ ثانية", en: "30 seconds" } }));
    expect(stored).toContain("30 ثانية");
    expect(stored).not.toMatch(/[٠-٩]/);
    const pain = text(
      card("en", { ...item, holdSeconds: undefined, reps: 5, hold: { ar: "لحظة", en: "a moment" } }),
    );
    expect(pain).toContain("Hold for a moment");
  });

  it("shows the exercise's cautions and the NIA credit line, in both languages", () => {
    const chin = libraryById("chin_to_chest")!;
    const walk = libraryById("wall_hand_walk")!;
    expect(chin.cautions).toBeDefined();
    expect(walk.credit).toBeDefined();
    for (const lang of ["ar", "en"] as const) {
      const a = card(lang, {
        id: "chin_to_chest",
        sets: 1,
        holdSeconds: 30,
        hold: { ar: "30 ثانية", en: "30 seconds" },
      });
      expect(text(a)).toContain(chin.cautions![lang]);
      expect(a).toContain('data-note="caution"');
      const b = card(lang, {
        id: "wall_hand_walk",
        sets: 2,
        holdSeconds: 30,
        hold: { ar: "30 ثانية", en: "30 seconds" },
      });
      expect(text(b)).toContain(walk.credit![lang]);
      expect(b).toContain('data-note="credit"');
    }
  });

  it("a timer of a minute or more shows minutes and seconds, as the session's clock (D-029 item 1, E3-7)", () => {
    const face = (html: string) => /<span class="gcard-ring-face">(.*?)<\/span>/.exec(html)![1];
    const walk: WeeklyItem = { id: "walking_practice", sets: 1, holdSeconds: 600 };
    expect(text(face(card("en", walk)))).toBe(" 10:00 minutes ");
    expect(text(face(card("ar", walk)))).toBe(" 10:00 دقيقة ");
    expect(face(card("ar", walk))).toContain("<bdi>");
    const minute: WeeklyItem = { id: "wall_hand_walk", sets: 1, holdSeconds: 60 };
    expect(text(face(card("en", minute)))).toBe(" 1:00 minutes ");
    // Under a minute the seconds read as before.
    const hold: WeeklyItem = { id: "wall_hand_walk", sets: 1, holdSeconds: 30 };
    expect(text(face(card("en", hold)))).toBe(" 30 seconds ");
    expect(text(face(card("ar", hold)))).toBe(" 30 ثانية ");
  });

  it("a card of the v1 library shows no caution or credit, and its steps as they are", () => {
    const item: WeeklyItem = { id: "seated_marching", sets: 2, reps: 8 };
    const html = card("en", item);
    expect(html).not.toContain('data-note="caution"');
    expect(html).not.toContain('data-note="credit"');
    for (const s of libraryById("seated_marching")!.steps.en) expect(text(html)).toContain(s);
  });
});
