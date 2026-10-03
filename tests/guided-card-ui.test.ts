/**
 * Booth v2, contract D (guided cards), the screens: the session list in its parts, a demo opening on
 * the first warm up card, the camera part opened by one screen between the cards, the card itself (its
 * glyph, numbered steps, a timer for a hold or a tap counter for reps, the set, Skip), and the history
 * and export of a card done. Walked in a browser by e2e/guided-cards.spec.ts.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Workout, { type WorkoutRun } from "../src/app/Workout";
import GuidedCard from "../src/app/GuidedCard";
import History, { sessionCsv } from "../src/app/History";
import { defaults } from "../src/app/experience";
import { labels } from "../src/app/platform-copy";
import { guidedCopy } from "../src/app/guided-copy";
import { createPlan, type Intake } from "../src/medical/plan";
import { engineWeekly, libraryById } from "../src/medical/weekly";
import { planRest, sessionDay, sessionSteps } from "../src/medical/session";
import type { GuidedRecord } from "../src/app/product";

vi.mock("../src/app/Session", () => ({ default: () => null }));

const intake: Intake = {
  age: 40,
  conditions: ["none"],
  diagnosisNotes: "",
  medications: "",
  mobility: "seated",
  support: "none",
  pain: [],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: [],
  goal: "habit",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
};
const plan = createPlan(intake);
const today = sessionDay(engineWeekly(intake, plan)!, 0, planRest(plan))!;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const render = (lang: "ar" | "en", run: Partial<WorkoutRun> = {}) =>
  renderToStaticMarkup(
    createElement(Workout, {
      run: { id: "w1", demo: false, plan, today, ...run },
      lang,
      preferences: defaults,
      onPreferences: () => undefined,
      onExit: () => undefined,
    }),
  );

describe("a session with guided cards (D)", () => {
  it("lists the session in its parts, each exercise once with its dose", () => {
    for (const lang of ["ar", "en"] as const) {
      const g = guidedCopy(lang);
      const html = render(lang);
      expect(html).toContain(labels(lang).attest);
      for (const h of [g.slot.warmup, g.cameraKicker, g.slot.extra, g.slot.cooldown])
        expect(html).toContain(`<h3 class="workout-queue-group">${h}</h3>`);
      for (const item of [...today.warmup, ...today.extra, ...today.cooldown])
        expect(text(html).split(libraryById(item.id)!.name[lang]).length - 1).toBe(1);
    }
    // a hold reads in seconds, a counted exercise as sets × reps
    const hold = today.warmup.find((i) => i.holdSeconds)!;
    expect(text(render("en"))).toContain(`${libraryById(hold.id)!.name.en} · ${hold.holdSeconds} sec`);
  });

  it("opens a demo on the first warm up card", () => {
    const html = render("en", { demo: true });
    expect(html).toContain('class="gcard"');
    expect(html).toContain(libraryById(today.warmup[0].id)!.name.en);
    expect(html).toContain(guidedCopy("en").slot.warmup);
    expect(html).toContain("1 of ");
  });

  it("opens the camera part with one screen after the warm up cards, and rests between its sets", () => {
    const steps = sessionSteps(plan, today);
    const firstCamera = steps.findIndex((s) => s.kind === "camera");
    const intro = render("ar", { nextIndex: firstCamera });
    expect(intro).toContain(guidedCopy("ar").cameraKicker);
    expect(intro).toContain("ضغط الكتف جالسًا");
    expect(intro).toContain(labels("ar").startTraining);
    expect(intro).not.toContain('role="timer"');
    const rest = render("en", { nextIndex: firstCamera + 1 });
    expect(rest).toContain(labels("en").restTitle);
    expect(rest).toContain('role="timer"');
  });

  it("keeps the timers around the camera sets for a workout started before the cards", () => {
    const html = render("en", { demo: true, today: undefined });
    expect(html).toContain(labels("en").warmup);
    expect(html).toContain('role="timer"');
    expect(html).not.toContain("workout-queue-group");
  });
});

describe("the guided card (D)", () => {
  const card = (lang: "ar" | "en", item: (typeof today.warmup)[number], slot: "warmup" | "extra" = "extra") =>
    renderToStaticMarkup(
      createElement(GuidedCard, {
        lang,
        item,
        slot,
        position: 3,
        total: 9,
        restSeconds: 45,
        onDone: () => undefined,
        onSkip: () => undefined,
        onExit: () => undefined,
      }),
    );

  it("counts reps with a tap, set by set, with numbered steps and its glyph", () => {
    const item = { id: "seated_marching", sets: 2, reps: 8 };
    for (const lang of ["ar", "en"] as const) {
      const g = guidedCopy(lang);
      const html = card(lang, item);
      const ex = libraryById(item.id)!;
      expect(html).toContain(ex.name[lang]);
      expect(html).toContain('data-kind="counter"');
      expect(html).toContain('class="ex-art ex-art-card"');
      expect(html.match(/class="gcard-num"/g)).toHaveLength(ex.steps[lang].length);
      expect(html).toContain(g.tapHint);
      expect(html).toContain(g.skipExercise);
      expect(html).not.toContain('role="timer"');
    }
    const en = card("en", item);
    expect(en).toContain("Set 1 of 2");
    expect(en).toContain('aria-label="Count a rep, 0 of 8"');
    expect(en).toContain("of 8");
    expect(card("ar", item)).toContain("المجموعة ١ من ٢");
    expect(en).toContain("3 of 9");
  });

  it("times a hold with Start, and shows its seconds", () => {
    const item = { id: "neck_stretches", sets: 1, holdSeconds: 25 };
    const html = card("en", item, "warmup");
    expect(html).toContain('data-kind="timer"');
    expect(html).toContain('role="timer"');
    expect(html).toContain(">25<");
    expect(html).toContain(guidedCopy("en").start);
    expect(html).toContain(guidedCopy("en").slot.warmup);
    expect(card("ar", item, "warmup")).toContain(">٢٥<");
  });

  it("names the equipment a card needs", () => {
    const html = card("ar", { id: "resistance_band_rows", sets: 2, reps: 8 });
    expect(html).toContain(guidedCopy("ar").equipment.resistance_bands);
  });
});

describe("a card done, in My results and the export (D)", () => {
  const held: GuidedRecord = {
    mode: "guided",
    exerciseId: "neck_stretches",
    slot: "warmup",
    startedAt: 1000,
    endedAt: 61_000,
    rpe: 3,
    dose: { sets: 1, holdSeconds: 25 },
    done: { sets: 1, seconds: 25 },
  };
  const counted: GuidedRecord = {
    ...held,
    exerciseId: "seated_marching",
    slot: "extra",
    dose: { sets: 2, reps: 8 },
    done: { sets: 2, reps: 16 },
    rpe: undefined,
  };

  it("shows the seconds held or the reps done", () => {
    const html = renderToStaticMarkup(createElement(History, { lang: "en", records: [held, counted] }));
    expect(html).toContain(libraryById("neck_stretches")!.name.en);
    expect(html).toContain(guidedCopy("en").heldSeconds);
    expect(html).toContain(guidedCopy("en").repsDone);
    expect(html).toContain('data-mode="guided"');
  });

  it("exports a card's reps or held seconds, its effort and its mode", () => {
    const rows = sessionCsv([held, counted]).split("\r\n");
    expect(rows[0]).toContain(",mode,held_seconds");
    expect(rows[1]).toBe("1970-01-01T00:01:01.000Z,neck_stretches,,,,,,3,guided,25");
    expect(rows[2]).toBe("1970-01-01T00:01:01.000Z,seated_marching,16,,,,,,guided,");
  });
});
