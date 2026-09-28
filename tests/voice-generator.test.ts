/**
 * Voice text fixes and render gates of the voice audition decision (local-docs, 28 Sep 2026):
 * fix 2 (stop_rest without the wasl junction), fix 3 (sit_tall «وضعية جلوسك»), fix 7 (an English
 * text for speech only so the welcome says "Azm"), fix 8 (style brief "unhurried, gentle, steady",
 * the pace gate and the transcript gate). No audio is rendered here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  arLetters,
  INSTRUCTIONS,
  inputFor,
  PACE_GATE,
  paceGate,
  spokenWords,
  styleFor,
  transcriptGate,
} from "../scripts/generate-voice.mjs";
import { CuePlayer } from "../src/app/audio";
import voiceScript from "../src/app/voice-script.json";

type Line = { ar: string; en: string; arTts?: string; enTts?: string };
const script = voiceScript as Record<string, Line>;

describe("voice script text fixes", () => {
  it("sit tall says «وضعية جلوسك» (fix 3)", () => {
    expect(script.sit_tall).toEqual({
      ar: "ثبّت جذعك، وعدّل وضعية جلوسك بهدوء.",
      en: "Steady your trunk. Adjust your sitting position.",
      arTts: "ثَبِّتْ جِذْعَكَ، وَعَدِّلْ وَضْعِيَّةَ جُلُوسِكَ بِهُدُوء.",
    });
  });

  it("stop and rest opens without a wasl junction (fix 2)", () => {
    expect(script.stop_rest).toEqual({
      ar: "توقف فورًا واسترح.",
      en: "Stop now and rest.",
      arTts: "تَوَقَّفْ فَوْرًا وَاسْتَرِحْ.",
    });
  });

  it("the English welcome is spoken so the brand name is heard, and shown unchanged (fix 7)", () => {
    expect(script.preview.en).toBe("Welcome to Azm. Move at your own pace, within your comfortable range.");
    expect(script.preview.enTts).toBe(
      "Welcome. This is Azm. Move at your own pace, within your comfortable range.",
    );
    // The Arabic welcome keeps its vocalized text (fix 6).
    expect(script.preview.arTts).toBe(
      "أَهْلًا بِكَ فِي عَزْم. تَحَرَّكْ عَلَى مَهْلِكَ، وَضِمْنَ الْمَدَى الْمُرِيحِ لَك.",
    );
  });

  it("every workout arTts says the same words as its display text", () => {
    for (const [id, line] of Object.entries(script)) {
      if (id.startsWith("check_") || id.startsWith("test_") || !line.arTts) continue;
      expect(spokenWords("ar", line.arTts), id).toEqual(spokenWords("ar", line.ar));
    }
  });

  it("the only enTts lines are the welcome", () => {
    expect(Object.keys(script).filter((id) => script[id].enTts !== undefined)).toEqual(["preview"]);
  });
});

describe("generator input and style", () => {
  it("reads arTts in Arabic and enTts ?? en in English", () => {
    expect(inputFor("ar", "sit_tall", script.sit_tall)).toBe(script.sit_tall.arTts);
    expect(inputFor("en", "preview", script.preview)).toBe(script.preview.enTts);
    expect(inputFor("en", "sit_tall", script.sit_tall)).toBe(script.sit_tall.en);
    expect(inputFor("ar", "x", { ar: "نص", en: "Text" })).toBe("نص");
    expect(inputFor("en", "count_3", script.count_3)).toBe("three");
  });

  it("asks for an unhurried, gentle, steady delivery in both languages (fix 8)", () => {
    for (const lang of ["ar", "en"] as const) {
      expect(INSTRUCTIONS[lang]).toMatch(/Unhurried, gentle, steady/);
      expect(styleFor(lang, "sit_tall")).toBe(INSTRUCTIONS[lang]);
      expect(styleFor(lang, "count_2")).toContain(INSTRUCTIONS.count);
    }
  });
});

describe("render gates", () => {
  it("pace: a long Arabic line faster than 6.3 letters per second is rendered again", () => {
    expect(PACE_GATE.maxArLettersPerSec).toBe(6.3);
    const line = script.set_done.arTts!;
    const n = arLetters(line);
    expect(n).toBeGreaterThanOrEqual(PACE_GATE.minLetters);
    expect(paceGate("ar", line, n / 7.0)).toMatch(/faster than 6.3/);
    expect(paceGate("ar", line, n / 5.5)).toBe("");
    expect(paceGate("ar", "وَاحِد", 0.2)).toBe(""); // short lines are exempt
    expect(paceGate("en", script.set_done.en, 0.5)).toBe("");
  });

  it("transcript: an added, dropped or changed word fails; case endings do not", () => {
    const sent = "اِرْفَعْ ذِرَاعَكَ جَانِبًا إِلَى أَعْلَى حَدٍّ تَسْتَطِيعُ";
    expect(transcriptGate("ar", sent, "ارفع ذراعك جانبا الى اعلى حد تستطيع")).toBe("");
    expect(transcriptGate("ar", sent, "اِرْفَعْ ذِرَاعَكْ جَانِبًا إلى أعلى حدّ تستطيعْ")).toBe("");
    expect(transcriptGate("ar", sent, "ارفع ذراعك جانبا الى اعلى حد تستطيعه")).toMatch(/heard/);
    expect(transcriptGate("ar", sent, "ارفع ذراعك الى اعلى حد تستطيع")).toMatch(/heard/);
    expect(transcriptGate("ar", script.stop_rest.arTts!, "توقف فوراً واسترح.")).toBe("");
    expect(transcriptGate("ar", script.sit_tall.arTts!, "ثبت جذعك وعدل جلستك بهدوء")).toMatch(/heard/);
    expect(transcriptGate("ar", sent, "")).toBe("no transcript");
    expect(transcriptGate("ar", sent, undefined)).toBe("no transcript");
  });

  it("transcript: the English welcome must say Azm", () => {
    const sent = inputFor("en", "preview", script.preview);
    expect(
      transcriptGate(
        "en",
        sent,
        "Welcome. This is Azm. Move at your own pace, within your comfortable range.",
      ),
    ).toBe("");
    expect(
      transcriptGate(
        "en",
        sent,
        "Welcome. Take it easy. Move at your own pace, within your comfortable range.",
      ),
    ).toMatch(/heard/);
    expect(transcriptGate("en", "three", "3")).toBe("");
    expect(transcriptGate("en", "Stop now and rest.", "stop now, and rest")).toBe("");
  });
});

describe("speech fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("speaks the enTts text in English when the recording is missing", async () => {
    const spoken: string[] = [];
    const pending: { onerror: () => void }[] = [];
    vi.stubGlobal(
      "Audio",
      class {
        onerror = () => {};
        oncanplaythrough = () => {};
        pause = vi.fn();
        play = vi.fn().mockResolvedValue(undefined);
        load() {
          pending.push(this);
        }
      },
    );
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        constructor(public text: string) {}
      },
    );
    vi.stubGlobal("speechSynthesis", {
      cancel: vi.fn(),
      speak: (u: { text: string }) => spoken.push(u.text),
      getVoices: () => [{ lang: "en-GB", localService: true, name: "English UK" }],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const run = new CuePlayer("en").line("preview");
    pending[0].onerror();
    expect(await run).toBe(true);
    expect(spoken).toEqual([script.preview.enTts]);
  });
});
