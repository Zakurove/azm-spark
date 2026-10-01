/**
 * C48: the workout opens on one setup screen with no timer. The attestation is one line from the
 * copy files, confirmed by one tap on «أنا جاهز» with no checkbox. The placement guide shows in full
 * on the first session and as one line with a link after that. The warm up has its own screen with
 * a timer and no set label, and the program lists each exercise once («ضغط الكتف جالسًا · ٣ × ٩»).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Workout, { type WorkoutRun } from "../src/app/Workout";
import { defaults } from "../src/app/experience";
import { labels } from "../src/app/platform-copy";
import { camCopy } from "../src/app/camera-copy";
import type { Plan } from "../src/medical/plan";

// The camera stage reads the page address when it loads; these screens come before it.
vi.mock("../src/app/Session", () => ({ default: () => null }));

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
    {
      exerciseId: "seated_biceps_curl",
      setup: { position: "chair", support: "none" },
      sets: 2,
      reps: 10,
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

const render = (lang: "ar" | "en", run: Partial<WorkoutRun> = {}, firstSession = false) =>
  renderToStaticMarkup(
    createElement(Workout, {
      run: { id: "w1", demo: false, plan, ...run },
      lang,
      firstSession,
      preferences: defaults,
      onPreferences: () => undefined,
      onExit: () => undefined,
    }),
  );

describe("the workout start (C48)", () => {
  it("opens on one setup screen: no timer, no set label, no checkbox, the attestation line and «أنا جاهز»", () => {
    for (const lang of ["ar", "en"] as const) {
      const c = labels(lang);
      const html = render(lang, {}, true);
      expect(html).not.toContain('role="timer"');
      expect(html).not.toContain('type="checkbox"');
      expect(html).not.toContain("section-kicker");
      expect(html).toContain(c.attest);
      expect(html).toContain(c.ready);
      expect(html).not.toContain("disabled");
    }
    expect(labels("ar").ready).toBe("أنا جاهز");
    expect(labels("ar").attest).toBe("لم تتغير حالتي الطبية منذ آخر إجاباتي، ولا أشعر بأعراض جديدة.");
    expect(labels("en").attest).toBe(
      "My medical condition has not changed since my last answers, and I have no new symptoms.",
    );
  });

  it("shows the placement guide in full on the first session, and one line with a link after that", () => {
    const first = render("ar", {}, true);
    expect(first).toContain("place-tips");
    const later = render("ar");
    expect(later).not.toContain("place-tips");
    expect(later).toContain(camCopy("ar").placeTitle);
    expect(later).toContain(labels("ar").showSteps);
  });

  it("starts a demo on the warm up, with its timer and no set label", () => {
    const html = render("en", { demo: true });
    expect(html).toContain('role="timer"');
    expect(html).toContain(labels("en").warmup);
    expect(html).not.toContain("section-kicker");
    expect(html).not.toContain(labels("en").attest);
  });

  it("lists each exercise once as name · sets × reps", () => {
    const html = render("ar");
    expect(html.split("ضغط الكتف جالسًا").length - 1).toBe(1);
    expect(html).toContain("ضغط الكتف جالسًا · ٣ × ٩");
    expect(render("en")).toContain("Seated Shoulder Press · 3 × 9");
  });

  it("shows the set label on the rest between sets", () => {
    const html = render("en", { nextIndex: 1 });
    expect(html).toContain("section-kicker");
    expect(html).toContain(labels("en").restTitle);
  });
});
