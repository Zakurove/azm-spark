/**
 * The coach settings dialog carries the movement check's optional check in (D-016): a per device
 * switch, off by default, with its line, in Arabic and English.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CoachSettings from "../src/app/CoachSettings";
import { defaults, type Preferences } from "../src/app/experience";
import { t } from "../src/i18n";

const render = (lang: "ar" | "en", value: Preferences) =>
  renderToStaticMarkup(
    createElement(CoachSettings, { lang, value, onChange: () => undefined, onClose: () => undefined }),
  );

describe("the check in switch in the coach settings (D-016)", () => {
  it("is off by default, with the setting's label and line in both languages", () => {
    expect(defaults.safetyCheckIn).toBe(false);
    for (const lang of ["ar", "en"] as const) {
      const html = render(lang, defaults);
      const at = html.indexOf('data-setting="safety-check-in"');
      expect(at).toBeGreaterThan(-1);
      const button = html.slice(html.lastIndexOf("<button", at), html.indexOf("</button>", at));
      expect(button).toContain('aria-checked="false"');
      expect(button).toContain(t(lang, "assessment.checkin.setting"));
      expect(button).toContain(t(lang, "assessment.checkin.settingNote"));
    }
  });

  it("shows the stored setting", () => {
    const html = render("en", { ...defaults, safetyCheckIn: true });
    const at = html.indexOf('data-setting="safety-check-in"');
    expect(html.slice(html.lastIndexOf("<button", at), at)).toContain('aria-checked="true"');
  });
});
