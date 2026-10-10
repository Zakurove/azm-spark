/**
 * Voice packs (D-016 item 5): the coach settings choose an installed pack per device, the player asks
 * for the chosen pack's recording, then the default pack's, then speaks with a voice on the device.
 * The index here has two packs; tests/voice-generator.test.ts checks the installed index on disk.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("virtual:voice-packs", () => ({
  default: {
    default: "openai-ash",
    packs: [
      { id: "openai-ash", name: { ar: "الصوت 1", en: "Voice 1" }, provider: "OpenAI" },
      { id: "gemini-achird", name: { ar: "الصوت 2", en: "Voice 2" }, provider: "Google Gemini" },
    ],
  },
}));

import { CuePlayer, primeAudio } from "../src/app/audio";
import CoachSettings from "../src/app/CoachSettings";
import { defaults, readPreferences, type Preferences } from "../src/app/experience";
import { cueUrls, DEFAULT_PACK, installedPack, VOICE_PACKS } from "../src/app/voicePacks";
import { boothAssets } from "../src/features/assessment/booth/precache";

type FakeAudio = {
  src?: string;
  onerror: () => void;
  oncanplaythrough: () => void;
  play: ReturnType<typeof vi.fn>;
};
let created: FakeAudio[];
let spoken: string[];
let stored: Record<string, string>;

const choose = (voicePack: string) => (stored["azm.coach"] = JSON.stringify({ voicePack }));

beforeEach(() => {
  created = [];
  spoken = [];
  stored = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored[k] ?? null,
    setItem: (k: string, v: string) => void (stored[k] = v),
  });
  vi.stubGlobal(
    "Audio",
    class {
      onerror = () => {};
      oncanplaythrough = () => {};
      pause = vi.fn();
      play = vi.fn().mockResolvedValue(undefined);
      constructor(public src?: string) {
        created.push(this);
      }
      load() {}
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
    getVoices: () => [{ lang: "ar-SA", localService: true, name: "Arabic Saudi" }],
  });
});
afterEach(() => vi.unstubAllGlobals());

/** Lets the player move from one recording to the next. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the installed packs", () => {
  it("lists the packs of the index, with its default", () => {
    expect(VOICE_PACKS.map((p) => p.id)).toEqual(["openai-ash", "gemini-achird"]);
    expect(DEFAULT_PACK).toBe("openai-ash");
  });

  it("keeps an installed pack and follows the default for anything else", () => {
    expect(installedPack("gemini-achird")).toBe("gemini-achird");
    expect(installedPack("gemini-removed")).toBe("openai-ash");
    expect(installedPack("")).toBe("openai-ash");
    expect(installedPack(undefined)).toBe("openai-ash");
  });

  it("tries the chosen pack, then the default pack, once each", () => {
    expect(cueUrls("ar", "check_go", "gemini-achird")).toEqual([
      "/cues/packs/gemini-achird/ar/check_go.mp3",
      "/cues/packs/openai-ash/ar/check_go.mp3",
    ]);
    expect(cueUrls("en", "preview", "")).toEqual(["/cues/packs/openai-ash/en/preview.mp3"]);
    expect(cueUrls("en", "preview", "openai-ash")).toEqual(["/cues/packs/openai-ash/en/preview.mp3"]);
  });
});

describe("the chosen pack is stored per device", () => {
  it("follows the default until a pack is chosen", () => {
    expect(defaults.voicePack).toBe("");
    expect(readPreferences().voicePack).toBe("");
    choose("gemini-achird");
    expect(readPreferences().voicePack).toBe("gemini-achird");
    stored["azm.coach"] = JSON.stringify({ voicePack: 7 });
    expect(readPreferences().voicePack).toBe("");
  });
});

describe("playing from the chosen pack", () => {
  it("plays the chosen pack's recording", async () => {
    choose("gemini-achird");
    const run = new CuePlayer("ar").line("check_go");
    expect(created.map((a) => a.src)).toEqual(["/cues/packs/gemini-achird/ar/check_go.mp3"]);
    created[0].oncanplaythrough();
    expect(await run).toBe(true);
    expect(created[0].play).toHaveBeenCalledOnce();
  });

  it("falls back to the default pack for a line the chosen pack does not have", async () => {
    choose("gemini-achird");
    const run = new CuePlayer("ar").line("check_go");
    created[0].onerror();
    await tick();
    expect(created.map((a) => a.src)).toEqual([
      "/cues/packs/gemini-achird/ar/check_go.mp3",
      "/cues/packs/openai-ash/ar/check_go.mp3",
    ]);
    created[1].oncanplaythrough();
    expect(await run).toBe(true);
    expect(created[1].play).toHaveBeenCalledOnce();
    expect(spoken).toEqual([]);
  });

  it("says nothing when neither pack has the line: never the phone's speech (D-036 item 1)", async () => {
    choose("gemini-achird");
    const run = new CuePlayer("ar").line("check_go");
    created[0].onerror();
    await tick();
    created[1].onerror();
    expect(await run).toBe(false);
    expect(spoken).toEqual([]);
  });

  it("asks the default pack only once when no pack is chosen or the chosen one is gone", async () => {
    choose("gemini-removed");
    const run = new CuePlayer("en").line("preview");
    expect(created.map((a) => a.src)).toEqual(["/cues/packs/openai-ash/en/preview.mp3"]);
    created[0].onerror();
    await run;
    expect(created).toHaveLength(1);
  });

  it("plays another pack's sample in the settings before the choice is stored", async () => {
    const player = new CuePlayer("en");
    player.voicePack = "gemini-achird";
    void player.line("preview");
    expect(created[0].src).toBe("/cues/packs/gemini-achird/en/preview.mp3");
  });

  it("primes the audio with the chosen pack's welcome", () => {
    choose("gemini-achird");
    primeAudio("ar");
    expect(created[0].src).toBe("/cues/packs/gemini-achird/ar/preview.mp3");
  });

  it("keeps the chosen pack's check cues on a booth phone", () => {
    choose("gemini-achird");
    const assets = boothAssets();
    expect(assets).toContain("/cues/packs/gemini-achird/ar/check_are_you_ok.mp3");
    expect(assets).toContain("/cues/packs/gemini-achird/en/check_are_you_ok.mp3");
    expect(assets.some((u) => u.includes("/openai-ash/"))).toBe(false);
  });
});

describe("the voice choice in the coach settings", () => {
  const render = (lang: "ar" | "en", value: Preferences) =>
    renderToStaticMarkup(
      createElement(CoachSettings, { lang, value, onChange: () => undefined, onClose: () => undefined }),
    );
  const field = (html: string) => {
    const at = html.indexOf('data-setting="voice-pack"');
    return at < 0 ? "" : html.slice(at, html.indexOf("</fieldset>", at));
  };

  it("lists every installed pack by its friendly name, the default chosen until another is (C40)", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = field(render(lang, defaults));
      expect(html).toContain(lang === "ar" ? "اختر الصوت" : "Choose a voice");
      expect(html.match(/<button/g)).toHaveLength(2);
      expect(html).toMatch(new RegExp(`aria-pressed="true"[^>]*>${lang === "ar" ? "الصوت 1" : "Voice 1"}<`));
      expect(html).toMatch(new RegExp(`aria-pressed="false"[^>]*>${lang === "ar" ? "الصوت 2" : "Voice 2"}<`));
      expect(html).not.toMatch(/Ash|Achird/);
    }
    const chosen = field(render("en", { ...defaults, voicePack: "gemini-achird" }));
    expect(chosen).toMatch(/aria-pressed="true"[^>]*>Voice 2</);
  });

  it("has one voice switch and the check in switch, no pace, no focus view, no eyebrow (C40)", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = render(lang, defaults);
      expect(html.match(/role="switch"/g)).toHaveLength(2);
      expect(html).toMatch(
        /data-setting="voice"[^>]*>|role="switch" aria-checked="true" data-setting="voice"/,
      );
      expect(html).not.toMatch(/AZM COACH|eyebrow|focus-option/);
    }
    expect(render("en", { ...defaults, voice: "off" })).toContain(
      'aria-checked="false" data-setting="voice"',
    );
  });

  it("is not shown while a single pack is installed", async () => {
    vi.resetModules();
    vi.doMock("virtual:voice-packs", () => ({
      default: {
        default: "openai-ash",
        packs: [{ id: "openai-ash", name: { ar: "الصوت 1", en: "Voice 1" }, provider: "OpenAI" }],
      },
    }));
    const { default: Single } = await import("../src/app/CoachSettings");
    for (const lang of ["ar", "en"] as const) {
      const html = renderToStaticMarkup(
        createElement(Single, { lang, value: defaults, onChange: () => undefined, onClose: () => undefined }),
      );
      expect(html).toContain('data-setting="safety-check-in"');
      expect(html).not.toContain('data-setting="voice-pack"');
    }
  });
});
