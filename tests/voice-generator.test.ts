/**
 * Voice text fixes and render gates of the voice audition decision (local-docs, 28 Sep 2026):
 * fix 2 (stop_rest without the wasl junction), fix 3 (sit_tall «وضعية جلوسك»), fix 7 (an English
 * text for speech only so the welcome says "Azm"), fix 8 (style brief "unhurried, gentle, steady",
 * the pace gate and the transcript gate). No audio is rendered here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import {
  arLetters,
  INSTRUCTIONS,
  inputFor,
  PACE_GATE,
  paceGate,
  packEntry,
  packName,
  packVoices,
  parseArgs,
  spokenWords,
  styleFor,
  transcriptGate,
  withPack,
} from "../scripts/generate-voice.mjs";
import index from "../public/cues/packs/index.json";
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

describe("a missing recording (D-036 item 1)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is never spoken with the phone's speech, even with a voice on the device", async () => {
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
    expect(await run).toBe(false);
    expect(spoken).toEqual([]);
  });
});

describe("voice packs from the generator (D-016 item 5)", () => {
  it("renders into a named pack, with voices, a subset and a dry run", () => {
    expect(
      parseArgs(["--pack", "gemini-achird", "--voice-ar", "Achird", "--voice-en", "Achird", "--dry-run"]),
    ).toMatchObject({
      pack: "gemini-achird",
      voices: { ar: "Achird", en: "Achird" },
      dryRun: true,
      only: null,
    });
    expect(parseArgs(["--pack", "gemini-charon", "--only", "preview, check_go"]).only).toEqual([
      "preview",
      "check_go",
    ]);
    expect(() => parseArgs(["--voice-ar", "Achird"])).toThrow(/--pack/);
    expect(() => parseArgs(["--pack", "Gemini Achird"])).toThrow(/pack id/);
    expect(() => parseArgs(["--pack", "x", "--out", "public/cues"])).toThrow(/unknown option/);
  });

  it("keeps one voice per pack: a new pack names both, an existing pack keeps its own", () => {
    expect(packVoices(undefined, { ar: "Charon", en: "Charon" })).toEqual({ ar: "Charon", en: "Charon" });
    expect(() => packVoices(undefined, { ar: "Charon", en: null })).toThrow(/--voice-ar and --voice-en/);
    const achird = {
      id: "gemini-achird",
      provider: "Google Gemini",
      voices: { ar: "Achird", en: "Achird" },
    };
    expect(packVoices(achird, { ar: null, en: null })).toEqual({ ar: "Achird", en: "Achird" });
    expect(() => packVoices(achird, { ar: "Charon", en: null })).toThrow(/new --pack/);
    expect(() => packVoices(index.packs[0], { ar: null, en: null })).toThrow(/new --pack/);
  });

  it("lists a pack with its count of lines in both languages and whether it is complete", () => {
    const has = (lang: string, id: string) => id !== "b" || lang === "ar";
    expect(packEntry("gemini-schedar", { ar: "Schedar", en: "Schedar" }, ["a", "b", "c"], has)).toEqual({
      id: "gemini-schedar",
      provider: "Google Gemini",
      voices: { ar: "Schedar", en: "Schedar" },
      cueCount: 2,
      complete: false,
    });
    expect(packEntry("mix", { ar: "Algieba", en: "Achird" }, ["a"], () => true)).toMatchObject({
      complete: true,
    });
  });

  it("names a new pack by its place, Arabic first, and a pack keeps its name (C40)", () => {
    expect(packName(2)).toEqual({ ar: "الصوت ٢", en: "Voice 2" });
    const entry = (id: string) => ({ id, provider: "Google Gemini", voices: { ar: "x", en: "x" } }) as never;
    const added = withPack(index, entry("gemini-achird"));
    expect(added.packs.map((p) => p.name)).toEqual([index.packs[0].name, packName(2)]);
    const renamed = {
      ...added,
      packs: [added.packs[0], { ...added.packs[1], name: { ar: "هادئ", en: "Calm" } }],
    };
    expect(withPack(renamed, entry("gemini-achird")).packs[1].name).toEqual({ ar: "هادئ", en: "Calm" });
  });

  it("adds a pack to the index, replaces it in place, and keeps the default", () => {
    const entry = (id: string, cueCount: number) => ({ id, cueCount }) as never;
    const once = withPack(index, entry("gemini-achird", 1));
    expect(once.default).toBe("openai-ash");
    expect(once.packs.map((p) => p.id)).toEqual(["openai-ash", "gemini-achird"]);
    const twice = withPack(once, entry("gemini-achird", 108));
    expect(twice.packs.map((p) => [p.id, p.cueCount])).toEqual([
      ["openai-ash", 35],
      ["gemini-achird", 108],
    ]);
    expect(withPack(null, entry("gemini-charon", 1)).default).toBe("gemini-charon");
  });

  it("the installed index matches the packs on disk", () => {
    const ids = Object.keys(script);
    expect(index.packs.map((p) => p.id)).toContain(index.default);
    for (const pack of index.packs) {
      const dir = `public/cues/packs/${pack.id}`;
      const files = (lang: string) => new Set(readdirSync(`${dir}/${lang}`));
      const [ar, en] = [files("ar"), files("en")];
      // Every pack carries the welcome, the coach settings sample.
      expect(ar.has("preview.mp3") && en.has("preview.mp3"), pack.id).toBe(true);
      expect(existsSync(`${dir}/manifest.json`), pack.id).toBe(true);
      const count = ids.filter((id) => ar.has(`${id}.mp3`) && en.has(`${id}.mp3`)).length;
      expect(pack.cueCount, pack.id).toBe(count);
      expect(pack.complete, pack.id).toBe(count === ids.length);
    }
  });
});
