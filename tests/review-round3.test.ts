/**
 * Round 3 review fixes, the pure rules (UX spec S14, S16, S28, S33, S34, S42; Q31 (6)):
 *   - the home gate in code: AZM_CHECK_HOME alone cannot open home checks before the build releases them;
 *   - a caption whose short form is the sentence itself is printed once;
 *   - setup chips judge nothing without a person;
 *   - a booth guest's pre-check notice keeps nothing; the booth chair stand has no home setup steps.
 */
import { describe, expect, it } from "vitest";
import { homeChecksOpen } from "../server/modules/booth/config";
import { captionOf, sameWords } from "../src/features/assessment/camera/cues";
import { homeOpenOf } from "../src/features/assessment/api";
import { setupChips } from "../src/features/assessment/camera/view";
import { precheckNotice } from "../src/features/assessment/flow/Intro";
import { instructionSteps } from "../src/features/assessment/flow/copy";
import { t } from "../src/i18n";
import { HOME_CHECKS_READY } from "../src/medical/gates";
import { CHECK_DATA } from "../src/movements/assessments";

describe("the home gate in code (Q31 (6))", () => {
  it("AZM_CHECK_HOME=1 alone never opens home checks before the build releases them", () => {
    expect(homeChecksOpen({ AZM_CHECK_HOME: "1" })).toBe(HOME_CHECKS_READY);
    expect(homeChecksOpen({ AZM_CHECK_HOME: "" })).toBe(false);
  });

  it("the unit tests of the home contract still run it with the flag (vitest only)", () => {
    expect(homeChecksOpen({ AZM_CHECK_HOME: "1", VITEST: "true", NODE_ENV: "test" })).toBe(true);
  });

  it("the client guard: homeOpen only with the server's flag and the build's release (R3C-10 (7))", () => {
    expect(homeOpenOf({ homeOpen: true }, HOME_CHECKS_READY)).toBe(HOME_CHECKS_READY);
    expect(homeOpenOf({ homeOpen: true }, false)).toBe(false);
    expect(homeOpenOf({ homeOpen: false }, true)).toBe(false);
    expect(homeOpenOf({}, true)).toBe(false);
    expect(homeOpenOf({ homeOpen: true }, true)).toBe(true);
  });
});

describe("captions and chips (S34, 4.3, S34c)", () => {
  it("a short form that is the sentence itself is printed once", () => {
    expect(captionOf("check_ready", "ar").short).toBeUndefined();
    expect(captionOf("check_ready", "en").short).toBeUndefined();
    expect(sameWords("بقيت عشر ثوانٍ", "بقيت عَشر ثوانٍ.")).toBe(true);
    expect(sameWords("ارفع ذراعك", "ارفع ذراعك إلى الجانب.")).toBe(false);
    expect(captionOf("test_abd_raise", "ar").short).toBeTruthy();
  });

  it("without a person only the picture asks for a fix; the rest cannot be judged yet", () => {
    const chips = setupChips(["no_person"], { rollDeg: 0, pitchDeg: 0 });
    expect(chips).toEqual({
      level: "ok",
      framing: "fix",
      distance: "na",
      light: "na",
      people: "na",
      view: "na",
    });
  });
});

describe("booth copy (S14, S16, S28)", () => {
  it("S16: a booth guest keeps nothing, so the notice never claims to keep answers", () => {
    for (const lang of ["ar", "en"] as const) {
      const full = CHECK_DATA.boundary.precheckNotice[lang];
      const guest = precheckNotice(lang, true);
      expect(guest.startsWith(full.split(/(?<=[.!?؟])\s+/u)[0])).toBe(true);
      expect(guest).not.toContain(full.split(/(?<=[.!?؟])\s+/u)[1]);
      expect(guest).toContain(
        CHECK_DATA.selection.guestBooth.conditionsStep.helper[lang].split(/(?<=[.!?؟])\s+/u)[1],
      );
      expect(precheckNotice(lang, false)).toBe(full);
    }
  });

  it("S28: the booth chair stand starts at the phone step (our team sets up the chair and support)", () => {
    for (const lang of ["ar", "en"] as const) {
      const home = instructionSteps("chair_stand_30s", "standard", false, lang);
      const booth = instructionSteps("chair_stand_30s", "standard", true, lang);
      expect(booth[0]).toBe(t(lang, "assessment.primer.placeBooth"));
      expect(booth).toHaveLength(home.length - 2);
      expect(booth).not.toContain(home[0]);
      expect(booth).not.toContain(home[1]);
    }
  });
});
