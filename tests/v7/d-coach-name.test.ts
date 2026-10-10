/**
 * D-026 item 3 (change log F2-3, D-11), D's part: the live coach is «المدرّب المباشر» / "Live coach"
 * everywhere. D's copy (the coach namespace, src/i18n/{ar,en}/coach.json) holds the name once, for
 * the coach settings' switch and the live_coach consent (step D5 renders both), and the instruction
 * the server locks in the token gives the coach the same name. The recorded voice pack keeps its own
 * name, «صوت المدرّب» / "Coach voice", so the two never read as one.
 */
import { describe, expect, it } from "vitest";
import { buildInstruction, type InstructionInput } from "../../src/coach/instruction";
import type { CoachBlock } from "../../src/coach/types";
import { labels } from "../../src/app/platform-copy";
import { tV7 } from "../../src/i18n/v7";

const NAME = { ar: "المدرّب المباشر", en: "Live coach" } as const;
const VOICE_PACK = { ar: "صوت المدرّب", en: "Coach voice" } as const;
const LANGS = ["ar", "en"] as const;

describe("the live coach's name (D-026 item 3)", () => {
  it("is held once in D's copy", () => {
    for (const lang of LANGS) expect(tV7(lang, "coach.name")).toBe(NAME[lang]);
  });

  it("titles the live_coach consent", () => {
    expect(tV7("ar", "coach.consent.title")).toBe("قبل أن تشغّل «المدرّب المباشر»");
    expect(tV7("en", "coach.consent.title")).toBe("Before you turn on the Live coach");
    for (const lang of LANGS) expect(tV7(lang, "coach.consent.title")).toContain(NAME[lang]);
  });

  it("is the name the instruction gives the coach, in every block and language", () => {
    const input = (block: CoachBlock, lang: "ar" | "en"): InstructionInput =>
      block === "rom"
        ? { lang, block, position: "seated", helperPresent: false }
        : block === "gait"
          ? { lang, block, position: "walking", helperPresent: true }
          : { lang, block, position: null, helperPresent: false };
    for (const block of ["rom", "gait", "session"] as CoachBlock[]) {
      expect(buildInstruction(input(block, "ar"))).toContain(`«${tV7("ar", "coach.name")}»`);
      expect(buildInstruction(input(block, "en"))).toContain(`"${tV7("en", "coach.name")}"`);
    }
  });

  it("leaves the recorded voice pack its own name", () => {
    for (const lang of LANGS) {
      expect(labels(lang).neural).toBe(VOICE_PACK[lang]);
      expect(tV7(lang, "coach.name")).not.toBe(VOICE_PACK[lang]);
    }
  });
});
