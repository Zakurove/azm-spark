/**
 * Step D5: the coached workout's screens. The one tap pain question before a coached workout (D-025
 * CT-2): eleven numbers, each an answer, and a skip; the coach's caption line in each mode (voice and
 * captions together); and the camera set's engine events as the coach hears them (contract 2.11, the
 * WorkoutFlow row: a counted rep to P3, a correction to P2, the trunk safety stop to P0).
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PainQuestion } from "../../src/features/coach-agent/CoachedWorkout";
import { CoachCaption } from "../../src/features/coach-agent/CoachCaption";
import { tV7 } from "../../src/i18n/v7";
import { wordingProblems } from "../../scripts/wording-rules.mjs";
import type { CoachState } from "../../src/coach/types";
import type { EngineEvent } from "../../src/engine/types";

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const coachCopy = (lang: "ar" | "en", key: string) => tV7(lang, `coach.${key}` as never);

describe("the pain question before a coached workout (CT-2)", () => {
  it("offers 0 to 10, each one tap, and a skip, in the person's language", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = renderToStaticMarkup(createElement(PainQuestion, { lang, onAnswer: () => {} }));
      const values = [...html.matchAll(/data-value="(\d+)"/g)].map((m) => Number(m[1]));
      expect(values).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const text = plain(html);
      expect(text).toContain(coachCopy(lang, "workout.painTitle"));
      expect(text).toContain(coachCopy(lang, "workout.painSkip"));
      expect(html).toContain('role="dialog"');
      if (lang === "ar") expect(text).toContain("١٠");
    }
  });

  it("words its lines by the copy rules", () => {
    for (const lang of ["ar", "en"] as const)
      for (const key of ["painTitle", "painHint", "painSkip", "painOk", "paused", "goOn"])
        expect(wordingProblems(coachCopy(lang, `workout.${key}`)), `${key} ${lang}`).toEqual([]);
  });
});

describe("the coach's caption line", () => {
  const state = (over: Partial<CoachState>): Pick<CoachState, "mode" | "speaking" | "captions"> => ({
    mode: "live",
    speaking: false,
    captions: [],
    ...over,
  });
  const render = (over: Partial<CoachState>, lang: "ar" | "en" = "en") =>
    renderToStaticMarkup(createElement(CoachCaption, { coach: state(over), lang }));

  it("shows nothing while the coach is off", () => {
    expect(render({ mode: "off" })).toBe("");
  });

  it("says it connects, then shows its words while it speaks and nothing while it listens", () => {
    expect(plain(render({ mode: "connecting" }))).toBe(coachCopy("en", "status.connecting"));
    expect(render({ mode: "live" })).toBe("");
    expect(render({ mode: "live", captions: [{ who: "coach", text: "Ready." }] })).toBe("");
    const speaking = render({
      mode: "live",
      speaking: true,
      captions: [
        { who: "person", text: "It hurts a little" },
        { who: "coach", text: "Go on gently, within comfort." },
      ],
    });
    expect(plain(speaking)).toBe("Go on gently, within comfort.");
    expect(speaking).toContain('data-speaking="yes"');
    expect(speaking).not.toContain("aria-live");
  });

  it("says the buttons and the recorded voice go on when the coach cannot run", () => {
    expect(plain(render({ mode: "local" }, "ar"))).toBe(coachCopy("ar", "status.local"));
  });
});

describe("a camera set's events as the coach hears them", () => {
  it("is the count, the corrections and the trunk safety stop; a partial rep and the rest stay out", async () => {
    // The camera screen reads the page's address when it loads (its e2e trace).
    vi.stubGlobal("location", { search: "" });
    const { flowCoachEvents } = await import("../../src/app/Session");
    vi.unstubAllGlobals();
    const events: EngineEvent[] = [
      { kind: "rep", cls: "valid", count: 3, t: 10, durSec: 2, peakPct: 0.9 },
      { kind: "rep", cls: "partial", count: 3, t: 11, durSec: 1, peakPct: 0.4 },
      { kind: "flag", ruleId: "trunk_lean", cue: "sit_tall", severity: "warn", value: 14, t: 12 },
      { kind: "phase", phase: "lifting", t: 13 },
      { kind: "progress", pct: 0.5, t: 14 },
      { kind: "stop", ruleId: "trunk_safety", t: 15 },
    ];
    expect(flowCoachEvents(events, "seated_shoulder_press", 8, 500)).toEqual([
      { p: 3, type: "reps", exercise: "seated_shoulder_press", count: 3, target: 8, t: 500 },
      { p: 2, type: "compensation", kind: "sit_tall", value: 14, t: 500 },
      { p: 0, type: "safety_stop", reason: "trunk_safety", t: 500 },
    ]);
  });
});
