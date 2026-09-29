/**
 * Round 3 review fixes, the pure rules (UX spec S14, S16, S28, S33, S34, S42, S43; council O34-1,
 * Q31 (5) (6)):
 *   - home gate 2 in code: AZM_CHECK_HOME alone cannot open home checks before the zones ship;
 *   - the home check in names no answer box while the zones are not drawn;
 *   - S43 splits the cue after its question, and never repeats the short form;
 *   - a caption whose short form is the sentence itself is printed once;
 *   - setup chips judge nothing without a person;
 *   - a booth guest's pre-check notice keeps nothing; the booth chair stand has no home setup steps.
 */
import { describe, expect, it } from "vitest";
import { homeChecksOpen } from "../server/modules/booth/config";
import { selectCheckInCue } from "../src/engine/checkin";
import { captionOf, sameWords } from "../src/features/assessment/camera/cues";
import { setupChips } from "../src/features/assessment/camera/view";
import { precheckNotice } from "../src/features/assessment/flow/Intro";
import { instructionSteps } from "../src/features/assessment/flow/copy";
import { checkInView } from "../src/features/assessment/safety/content";
import type { FlowData } from "../src/features/assessment/flowMachine";
import { t } from "../src/i18n";
import { ANSWER_ZONES, HOME_GATE2_READY } from "../src/medical/gates";
import { CHECK_DATA, cueLine } from "../src/movements/assessments";

describe("home gate 2 in code (Q31 (5) (6))", () => {
  it("AZM_CHECK_HOME=1 alone never opens home checks before the zones and the fall watch ship", () => {
    expect(homeChecksOpen({ AZM_CHECK_HOME: "1" })).toBe(HOME_GATE2_READY);
    expect(homeChecksOpen({ AZM_CHECK_HOME: "" })).toBe(false);
    // The answer zones (and the fine zone) ship with the gate: never one without the other.
    expect(ANSWER_ZONES).toBe(HOME_GATE2_READY);
  });

  it("the unit tests of the home contract still run it with the flag (vitest only)", () => {
    expect(homeChecksOpen({ AZM_CHECK_HOME: "1", VITEST: "true", NODE_ENV: "test" })).toBe(true);
  });
});

describe("the check in cue while the zones are not drawn (O34-1, O34-4)", () => {
  const home = { setting: "home" as const, speech: false };
  it("at home without zones: no box is named; the raised hand where it may be asked for", () => {
    const raise = selectCheckInCue({ ...home, raiseAllowed: true, noArmSignal: false, zones: false });
    const noRaise = selectCheckInCue({ ...home, raiseAllowed: false, noArmSignal: false, zones: false });
    const helper = selectCheckInCue({ ...home, raiseAllowed: true, noArmSignal: true, zones: false });
    for (const id of [raise, noRaise, helper])
      for (const lang of ["ar", "en"] as const) {
        const line = cueLine(id as never)[lang];
        expect(line).not.toMatch(lang === "ar" ? /مربع/ : /box/);
      }
    expect(raise).toBe("check_are_you_ok_fall");
    expect(noRaise).toBe("check_are_you_ok_fall_noraise");
    expect(helper).toBe("check_are_you_ok_helper");
    // With the zones drawn (phase 2) the zone forms come back; the booth is unchanged.
    expect(selectCheckInCue({ ...home, raiseAllowed: true, noArmSignal: false, zones: true })).toBe(
      "check_are_you_ok_zone",
    );
    expect(
      selectCheckInCue({
        setting: "booth",
        speech: false,
        raiseAllowed: true,
        noArmSignal: false,
        zones: false,
      }),
    ).toBe("check_are_you_ok");
  });

  it("S43 puts the instruction after the question in the caption, never the question again", () => {
    for (const lang of ["ar", "en"] as const)
      for (const setting of ["booth", "home"] as const) {
        const d = {
          setting,
          checkIn: { raiseAllowed: true, noArmSignal: false, fineZoneSide: null },
        } as unknown as FlowData;
        const v = checkInView(d, lang);
        expect(v.instruction.length).toBeGreaterThan(0);
        expect(v.instruction).not.toContain(v.question);
        expect(sameWords(v.instruction.split(/(?<=[.!?؟])\s+/u)[0], v.short)).toBe(false);
      }
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
