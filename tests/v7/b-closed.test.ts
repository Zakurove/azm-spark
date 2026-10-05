/**
 * Wave 2 fix (copy review): the too soon screen names the date and time the next check opens (the last
 * completed check plus 48 hours), as v1's entry card does, never «tomorrow» for a check two days away;
 * «يمكنك» for permission (the copy glossary).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClosedScreen } from "../../src/features/focus/Screens";

const render = (lang: "ar" | "en", now: number, until: number) =>
  renderToStaticMarkup(
    createElement(ClosedScreen, {
      lang,
      why: "too_soon",
      until,
      now,
      onToday: () => {},
      onHealth: () => {},
    }),
  );

describe("the too soon screen", () => {
  // A check completed Monday 5 October 2026 at 10:00 in Riyadh, reopened at 15:00 the same day.
  const done = Date.UTC(2026, 9, 5, 7, 0);
  const now = done + 5 * 3_600_000;
  const until = done + 48 * 3_600_000;

  it("names the weekday, the date and the time it opens, never tomorrow", () => {
    const ar = render("ar", now, until);
    expect(ar).toContain("يمكنك أن تبدأ قياسك التالي ابتداءً من");
    expect(ar).toContain("الأربعاء");
    expect(ar).not.toContain("غدًا");
    const en = render("en", now, until);
    expect(en).toContain("You can start your next check from");
    expect(en).toContain("Wednesday");
    expect(en).toMatch(/10:00/);
    expect(en).not.toMatch(/tomorrow/i);
  });
});

describe("the intro on the booth path (D-017 item 1: no time is mentioned)", () => {
  it("shows no minutes at the booth, and the range's minutes at home", async () => {
    const { IntroScreen } = await import("../../src/features/focus/Screens");
    const { buildRomProtocol } = await import("../../src/medical/rom-protocol");
    const { entry, intake, today } = await import("./a-fixtures");
    const protocol = buildRomProtocol({
      intake: intake({ regions: [entry("knee", "right", ["stiffness"])] }),
      setting: "booth",
      today: today(),
    });
    const html = (setting: "home" | "booth") =>
      renderToStaticMarkup(
        createElement(IntroScreen, { lang: "ar", protocol, gait: null, setting, onStart: () => {} }),
      );
    expect(html("booth")).not.toContain('data-part="minutes"');
    expect(html("booth")).not.toMatch(/دقيق/);
    expect(html("home")).toContain('data-part="minutes"');
  });
});

describe("a body map whose joints the camera does not measure (copy review)", () => {
  it("closes before the intro with its own line, not the safety one", async () => {
    const { initialModel, reduce } = await import("../../src/features/focus/flow");
    const context = {
      intakeReady: true,
      setting: "booth" as const,
      homeOpen: false,
      adultConfirmed: true,
      consent: { focus_check: true, live_coach: false },
      env: {} as never,
      protocol: { rulesVersion: "x", items: [], deferred: [], notMeasured: [], sitBeforeStand: false },
      gait: null,
      lock: null,
      open: null,
      lastCompleted: null,
      earliestNext: null,
    };
    const m = reduce(initialModel(), { type: "LOADED", context, intake: null, now: 0 });
    expect(m.state).toEqual({ kind: "closed", why: "no_camera" });
    const html = renderToStaticMarkup(
      createElement(ClosedScreen, {
        lang: "ar",
        why: "no_camera",
        now: 0,
        onToday: () => {},
        onHealth: () => {},
      }),
    );
    expect(html).toContain("لا تقيس الكاميرا حاليًا حركة المفاصل التي حددتها على خريطة جسمك.");
    expect(html).not.toContain("حرصًا على سلامتك");
  });
});
