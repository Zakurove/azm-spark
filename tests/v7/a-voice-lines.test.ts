/**
 * The rom_* and gait_* lines of src/app/voice-script.json (product v7 contract 1.2 and 1.4, D-024
 * item 5): the lines the local voice pack plays during a focus check (P0 and P2 always, P1 when the
 * coach is off or late, C-5 and 2.11), Arabic first with English, in the same words as the
 * protocol's cues and screens. G renders them into the packs after the copy sign off.
 *
 *   rom_<cue id>      every correction cue of ROM_DATA.cues (P2)
 *   rom_<copy key>    the copy lines a range check speaks (ROM_SPOKEN below)
 *   gait_<key>        the gait setup and capture lines (GAIT_DATA.copy.setup and .quality)
 *
 * Intake questions, answer labels and findings page lines are read on screen only.
 */
import { describe, expect, it } from "vitest";
import voiceScript from "../../src/app/voice-script.json";
import { isVoiceLine } from "../../src/app/audio";
import { ROM_DATA } from "../../src/movements/rom";
import type { RomCopyKey } from "../../src/movements/rom/types";
import { GAIT_DATA } from "../../src/movements/gait";
import { CHECK_DATA } from "../../src/movements/assessments";

type Line = { ar: string; en: string; arTts?: string; enTts?: string };
const script = voiceScript as Record<string, Line>;
const ids = Object.keys(script);

/** The range check's spoken copy, in the order a check meets it. */
const ROM_SPOKEN: readonly RomCopyKey[] = [
  // The check's intro and the safety lines before a movement.
  "intro",
  "intro_no_diagnosis",
  "safety_always",
  "stop_line",
  "neck_stop_line",
  "support_line",
  "helper_line",
  "turn_side",
  "sit_before_stand",
  // The attempts.
  "practice",
  "again",
  "recorded",
  "keep_going",
  // The questions (P1, asked locally when the coach is off or has not started within 1.5 s).
  "can_move_ask",
  "ask_max",
  "pain_ask",
  "what_stopped_ask",
  // What happens next.
  "pain_stop",
  "no_active_movement",
  "not_today_safety",
];
/** The gait setup lines, but the two day questions (asked on screen with the pre-check). */
const GAIT_SETUP_SPOKEN = Object.keys(GAIT_DATA.copy.setup).filter(
  (k) => k !== "pc_walk_10m" && k !== "pc_pd_freezing",
);
const GAIT_QUALITY_SPOKEN = ["quality_retry", "pain_limited"] as const;

describe("the focus check's voice lines (rom_* and gait_*)", () => {
  it("has one rom_ line for every correction cue and every spoken copy line, and nothing else", () => {
    const rom = ids.filter((id) => id.startsWith("rom_"));
    expect(rom).toEqual([
      ...Object.keys(ROM_DATA.cues).map((id) => `rom_${id}`),
      ...ROM_SPOKEN.map((k) => `rom_${k}`),
    ]);
    // Cue ids and copy keys never share a name, so rom_<id> is one line.
    expect(Object.keys(ROM_DATA.cues).filter((id) => id in ROM_DATA.copy)).toEqual([]);
  });

  it("says each line in the words of the data, Arabic and English", () => {
    for (const [id, cue] of Object.entries(ROM_DATA.cues))
      expect(script[`rom_${id}`], id).toEqual({ ar: cue.ar, en: cue.en });
    for (const k of ROM_SPOKEN)
      expect(script[`rom_${k}`], k).toEqual({ ar: ROM_DATA.copy[k].ar, en: ROM_DATA.copy[k].en });
    for (const k of GAIT_SETUP_SPOKEN) {
      const line = GAIT_DATA.copy.setup[k as keyof typeof GAIT_DATA.copy.setup];
      expect(script[`gait_${k}`], k).toEqual({ ar: line.ar, en: line.en });
    }
    for (const k of GAIT_QUALITY_SPOKEN)
      expect(script[`gait_${k}`], k).toEqual({
        ar: GAIT_DATA.copy.quality[k].ar,
        en: GAIT_DATA.copy.quality[k].en,
      });
  });

  it("has one gait_ line for every setup line spoken during the walk and the two capture lines", () => {
    expect(ids.filter((id) => id.startsWith("gait_"))).toEqual([
      ...GAIT_SETUP_SPOKEN.map((k) => `gait_${k}`),
      ...GAIT_QUALITY_SPOKEN.map((k) => `gait_${k}`),
    ]);
    expect(GAIT_SETUP_SPOKEN).toContain("clear_path");
    expect(GAIT_SETUP_SPOKEN).toContain("helper_needed");
    expect(GAIT_SETUP_SPOKEN).not.toContain("pc_walk_10m");
  });

  it("speaks no line with a placeholder, and every line is a voice line of the player", () => {
    for (const id of ids.filter((i) => i.startsWith("rom_") || i.startsWith("gait_"))) {
      expect(isVoiceLine(id), id).toBe(true);
      for (const lang of ["ar", "en"] as const)
        expect(script[id][lang], `${id} ${lang}`).not.toMatch(/\{\w+\}/);
    }
  });

  it("keeps the workout lines first and the check cues last (the booth precache and the check tests)", () => {
    expect(ids.slice(-CHECK_DATA.cues.length)).toEqual(CHECK_DATA.cues.map((c) => c.id));
    const firstV7 = ids.findIndex((id) => id.startsWith("rom_"));
    expect(ids.slice(0, firstV7).every((id) => !/^(check|test|rom|gait)_/.test(id))).toBe(true);
    expect(
      ids.slice(firstV7, ids.length - CHECK_DATA.cues.length).every((id) => /^(rom|gait)_/.test(id)),
    ).toBe(true);
  });
});
