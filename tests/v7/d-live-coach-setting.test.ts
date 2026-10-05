/**
 * Step D5: the live coach's switch and its consent (product v7 contract C-5, C-8, C-12; D-022 S0-5;
 * D-026 item 3). The coach is «المدرّب المباشر» / "Live coach", off by default; its consent lists
 * exactly the C-12 data (the language and the part; the range items with their names, sides,
 * positions and rounded typical values; the walk's mode, views, aid and helper; the workout's
 * exercises and dose; the live events), says that the sides show which side of the body is worked
 * on and that typical values depend on sex and age, names what is never sent, and has one plain line
 * on Google's short retention. Rendered on the server.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LiveCoachSetting, {
  CONSENT_POINTS,
  LiveCoachConsent,
} from "../../src/features/coach-agent/LiveCoachSetting";
import { defaults } from "../../src/app/experience";
import { tV7 } from "../../src/i18n/v7";
import { disclaimersIn } from "../no-disclaimers";

const LANGS = ["ar", "en"] as const;
const consent = (lang: "ar" | "en") =>
  renderToStaticMarkup(
    createElement(LiveCoachConsent, { lang, saving: false, error: false, onAgree() {}, onLater() {} }),
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

describe("the live_coach consent (C-8, C-12, S0-5)", () => {
  it("lists what is sent, the sides, what is never sent and the retention, in that order", () => {
    expect([...CONSENT_POINTS]).toEqual([
      "sentPart",
      "sentRange",
      "sentWalk",
      "sentWorkout",
      "sentEvents",
      "sides",
      "never",
      "retention",
      "off",
    ]);
    for (const lang of LANGS) {
      const html = consent(lang);
      for (const k of CONSENT_POINTS) expect(html).toContain(`data-point="${k}"`);
      expect(text(html)).toContain(tV7(lang, "coach.consent.title"));
      expect(disclaimersIn(lang, text(html))).toEqual([]);
    }
  });

  it("names every C-12 item in plain words", () => {
    const en = (k: string) => tV7("en", `coach.consent.${k}` as never);
    expect(en("sentPart")).toMatch(/language.*part of the check or workout/);
    expect(en("sentRange")).toMatch(/names of the movements.*side.*position.*typical range.*rounded/);
    expect(en("sentWalk")).toMatch(/where you walk.*camera views.*walking aid.*helper/);
    expect(en("sentWorkout")).toMatch(/exercise names.*sets.*repetitions.*holds.*rest/);
    expect(en("sentEvents")).toMatch(/degrees.*pain scores from 0 to 10.*answers.*names of the steps/);
    expect(en("sides")).toMatch(/which side of your body.*sex and age/);
    expect(en("never")).toMatch(
      /name.*email.*age.*sex.*medical conditions.*medicines.*write yourself.*report.*findings.*reasons.*picture, video or points of your body/,
    );
    expect(en("intro")).toMatch(/Google.*outside the Kingdom.*your voice/);
    const ar = (k: string) => tV7("ar", `coach.consent.${k}` as never);
    expect(ar("intro")).toContain("خارج المملكة");
    expect(ar("sides")).toContain("جنسك وعمرك");
    for (const lang of LANGS) {
      // S0-5: one plain line on Google's short retention.
      expect(tV7(lang, "coach.consent.retention")).toMatch(
        lang === "en" ? /Google.*short time/ : /Google.*مدة قصيرة/,
      );
    }
  });
});

describe("the live coach's switch (C-5, D-026 item 3)", () => {
  const render = (
    lang: "ar" | "en",
    status: { available: boolean; consent: boolean } | null,
    liveCoach = false,
  ) =>
    renderToStaticMarkup(
      createElement(LiveCoachSetting, { lang, value: { ...defaults, liveCoach }, onChange() {}, status }),
    );

  it("is off by default and named «المدرّب المباشر» / Live coach", () => {
    for (const lang of LANGS) {
      const html = render(lang, { available: true, consent: false });
      expect(html).toContain('aria-checked="false"');
      expect(html).toContain(tV7(lang, "coach.name"));
      // The pause length shows only once the coach is on.
      expect(html).not.toContain('data-setting="coach-pause"');
    }
  });

  it("shows the pause length when on, and stays off and disabled while the coach is not available", () => {
    expect(render("en", { available: true, consent: true }, true)).toContain('data-setting="coach-pause"');
    const off = render("en", { available: false, consent: true }, true);
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain("disabled");
    expect(off).toContain(tV7("en", "coach.setting.unavailable"));
    expect(render("en", null)).toContain("disabled");
  });
});
