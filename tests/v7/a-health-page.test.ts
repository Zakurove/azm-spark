/**
 * My condition, the health page of App.tsx (D-024 item 5, A2-15): in a VITE_V7 build a v7 intake
 * shows its own rows (sex, walking, height and the body map) after mobility, as the intake's review
 * step lists them (IntakeV7Review, from the same lazy chunk), and they replace the pain row, which a
 * v7 intake writes from the body map. An intake saved before v7, and every intake in a default
 * build, keeps the rows exactly as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { createElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import type { Intake } from "../../src/medical/plan";
import { labels } from "../../src/app/platform-copy";
import { tV7 } from "../../src/i18n/v7";

const v1: Intake = {
  age: 58,
  conditions: ["stroke"],
  diagnosisNotes: "",
  medications: "",
  mobility: "standing",
  support: "right",
  pain: ["knee"],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: ["chair"],
  goal: "habit",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
};
const v7: Intake = {
  ...v1,
  sex: "female",
  regions: [{ region: "knee", side: "right", problems: ["pain", "weakness"], origin: "person" }],
  walking: { status: "with_aid", aid: "cane" },
  heightCm: 163,
};

/** The page's answers once every lazy part has loaded (the v7 rows come from the IntakeV7 chunk). */
async function answers(build: "v7" | "default", lang: "ar" | "en", intake: Intake): Promise<string> {
  vi.stubGlobal("location", { search: "", pathname: "/" });
  vi.stubEnv("VITE_V7", build === "v7" ? "1" : "");
  vi.resetModules();
  const { HealthAnswers } = await import("../../src/app/App");
  return new Promise((resolve, reject) => {
    let html = "";
    const out = new PassThrough();
    out.on("data", (chunk) => (html += chunk));
    out.on("end", () => resolve(html));
    const stream = renderToPipeableStream(createElement(HealthAnswers, { lang, h: intake }), {
      onAllReady: () => stream.pipe(out),
      onError: reject,
    });
  });
}
const terms = (html: string) => [...html.matchAll(/<dt>([^<]*)<\/dt>/g)].map((m) => m[1]);
const plain = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

describe("My condition (A2-15)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("shows a v7 intake's own rows after mobility in a v7 build, in place of the pain row", async () => {
    for (const lang of ["ar", "en"] as const) {
      const c = labels(lang);
      const html = await answers("v7", lang, v7);
      expect(terms(html), lang).toEqual([
        c.age,
        c.condition,
        c.mobility,
        tV7(lang, "intake7.review.sex"),
        tV7(lang, "intake7.review.walking"),
        tV7(lang, "intake7.review.height"),
        tV7(lang, "intake7.review.regions"),
        c.restriction,
        c.clearance,
        c.medications,
        c.diagnosis,
      ]);
      const text = plain(html);
      expect(text).toContain(tV7(lang, "intake7.sex.female"));
      expect(text).toContain(tV7(lang, "intake7.walking.cane"));
      expect(text).toContain(tV7(lang, "intake7.review.heightValue", { cm: 163 }));
    }
  });

  it("keeps the rows of an intake saved before v7, the pain row included", async () => {
    const c = labels("en");
    expect(terms(await answers("v7", "en", v1))).toEqual([
      c.age,
      c.condition,
      c.mobility,
      c.pain,
      c.restriction,
      c.clearance,
      c.medications,
      c.diagnosis,
    ]);
  });

  it("keeps a default build's rows as before, whatever the intake", async () => {
    const c = labels("ar");
    for (const intake of [v1, v7])
      expect(terms(await answers("default", "ar", intake))).toEqual([
        c.age,
        c.condition,
        c.mobility,
        c.pain,
        c.restriction,
        c.clearance,
        c.medications,
        c.diagnosis,
      ]);
  });
});
