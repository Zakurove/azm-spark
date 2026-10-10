/**
 * D-030 item 2, E3-6: the session's exercise list (Workout.tsx) says a guided card's dose with the one
 * doseText of the week and the Program page (src/app/weekly-dose.ts): Arabic counts its seconds
 * («10 مرات × 5 ثوانٍ»), a whole number of minutes reads as minutes («10 دقائق», not 600 seconds), and
 * repetitions read in words. The camera movements keep «3 × 9».
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Workout from "../../src/app/Workout";
import { defaults } from "../../src/app/experience";
import { doseText } from "../../src/app/weekly-dose";
import type { Plan } from "../../src/medical/plan";
import type { SessionDay } from "../../src/medical/session";

vi.mock("../../src/app/Session", () => ({ default: () => null }));

const plan: Plan = {
  status: "ready",
  reasons: [],
  notes: [],
  exclusions: [],
  exercises: [
    {
      exerciseId: "seated_shoulder_press",
      setup: { position: "chair", support: "none" },
      sets: 3,
      reps: 9,
      restSeconds: 60,
      reason: "",
    },
  ],
  days: [0, 2, 4],
  time: "evening",
  warmUpMinutes: 5,
  coolDownMinutes: 5,
  estimatedMinutes: 30,
  recoveryHours: 48,
};

const today: SessionDay = {
  day: 0,
  warmup: [{ id: "chest_opener", sets: 10, holdSeconds: 5 }],
  extra: [
    { id: "wall_hand_walk", sets: 1, holdSeconds: 600 },
    { id: "standing_side_leg_raise", sets: 2, reps: 10 },
  ],
  cooldown: [{ id: "standing_thigh_stretch", sets: 1, holdSeconds: 30 }],
  restSeconds: 60,
};

const doses = (lang: "ar" | "en") =>
  [
    ...renderToStaticMarkup(
      createElement(Workout, {
        run: { id: "w1", demo: false, plan, today },
        lang,
        preferences: defaults,
        onPreferences: () => undefined,
        onExit: () => undefined,
      }),
    ).matchAll(/<span class="workout-dose">([^<]*)<\/span>/g),
  ].map((m) => m[1].replace(/^· /, "").replace(/&#x27;/g, "'"));

describe("the session's exercise list (E3-6)", () => {
  it("says each card's dose as the week and the Program page do, and keeps the camera's sets × reps", () => {
    for (const lang of ["ar", "en"] as const) {
      const cards = [...today.warmup, ...today.extra, ...today.cooldown].map((i) => doseText(i, lang));
      const shown = doses(lang);
      for (const d of cards) expect(shown, `${lang}: ${d}`).toContain(d);
      expect(shown).toContain(lang === "ar" ? "3 × 9" : "3 × 9");
    }
    expect(doses("ar")).toContain("10 مرات × 5 ثوانٍ");
    expect(doses("ar")).toContain("10 دقائق");
  });
});
