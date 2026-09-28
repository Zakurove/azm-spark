/**
 * Movement check cues in the CuePlayer: every check cue id is a voice line, and while its MP3 does
 * not exist yet the line falls back to a voice on the device, in the right language and with the
 * vocalized arTts text in Arabic (contract v2, section A).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CuePlayer, isVoiceLine } from "../src/app/audio";
import voiceScript from "../src/app/voice-script.json";
import { CHECK_DATA, cueLine } from "../src/movements/assessments";

type FakeAudio = {
  src?: string;
  onerror: () => void;
  oncanplaythrough: () => void;
  play: ReturnType<typeof vi.fn>;
};
type Voice = { lang: string; localService: boolean; name: string };
let pending: FakeAudio[];
let spoken: { text: string; lang?: string; voice?: Voice }[];
let voices: Voice[];
let listeners: (() => void)[];

beforeEach(() => {
  pending = [];
  spoken = [];
  listeners = [];
  voices = [
    { lang: "ar-EG", localService: true, name: "Arabic Egypt" },
    { lang: "ar-SA", localService: true, name: "Arabic Saudi" },
    { lang: "en-US", localService: true, name: "English US" },
    { lang: "en-GB", localService: true, name: "English UK" },
  ];
  vi.stubGlobal(
    "Audio",
    class {
      onerror = () => {};
      oncanplaythrough = () => {};
      pause = vi.fn();
      play = vi.fn().mockResolvedValue(undefined);
      constructor(public src?: string) {}
      load() {
        pending.push(this);
      }
    },
  );
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      lang?: string;
      voice?: Voice;
      constructor(public text: string) {}
    },
  );
  vi.stubGlobal("speechSynthesis", {
    cancel: vi.fn(),
    speak: (u: { text: string; lang?: string; voice?: Voice }) => spoken.push(u),
    getVoices: () => voices,
    addEventListener: (_: string, f: () => void) => listeners.push(f),
    removeEventListener: (_: string, f: () => void) => (listeners = listeners.filter((l) => l !== f)),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("check cues in the voice script", () => {
  it("has every check cue with the text of the check data, after the unchanged workout cues", () => {
    const ids = Object.keys(voiceScript);
    expect(ids.slice(0, 35)).toContain("stop_rest");
    expect(ids.slice(-CHECK_DATA.cues.length)).toEqual(CHECK_DATA.cues.map((c) => c.id));
    for (const c of CHECK_DATA.cues) {
      expect(isVoiceLine(c.id), c.id).toBe(true);
      expect(voiceScript[c.id as keyof typeof voiceScript]).toEqual({ ar: c.ar, en: c.en, arTts: c.arTts });
    }
    expect(isVoiceLine("check_missing")).toBe(false);
    expect(isVoiceLine("toString")).toBe(false);
  });
});

describe("speech fallback for a missing recording", () => {
  it("asks for the MP3 first, then speaks the arTts text with an Arabic Saudi voice", async () => {
    const player = new CuePlayer("ar");
    const run = player.line("check_are_you_ok", "safety");
    expect(pending[0].src).toBe("/cues/ar/check_are_you_ok.mp3");
    pending[0].onerror();
    expect(await run).toBe(true);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe(cueLine("check_are_you_ok").arTts);
    expect(spoken[0].text).not.toBe(cueLine("check_are_you_ok").ar);
    expect(spoken[0].lang).toBe("ar-SA");
    expect(spoken[0].voice?.name).toBe("Arabic Saudi");
  });

  it("speaks the English text with an English voice in English", async () => {
    const player = new CuePlayer("en");
    const run = player.line("test_trunk_to_middle");
    expect(pending[0].src).toBe("/cues/en/test_trunk_to_middle.mp3");
    pending[0].onerror();
    await run;
    expect(spoken).toEqual([
      expect.objectContaining({ text: "Slowly now, come back to the middle.", lang: "en-GB" }),
    ]);
    expect(spoken[0].voice?.name).toBe("English UK");
  });

  it("uses any local voice of the language when the exact one is missing", async () => {
    voices = voices.filter((v) => v.lang !== "ar-SA");
    const player = new CuePlayer("ar");
    const run = player.line("check_go");
    pending[0].onerror();
    await run;
    expect(spoken[0].voice?.name).toBe("Arabic Egypt");
    expect(spoken[0].lang).toBe("ar-SA");
  });

  it("plays the recording when it exists", async () => {
    const player = new CuePlayer("ar");
    const run = player.line("check_go");
    pending[0].oncanplaythrough();
    expect(await run).toBe(true);
    expect(pending[0].play).toHaveBeenCalledOnce();
    expect(spoken).toEqual([]);
  });

  it("waits for a voice list that loads late", async () => {
    const all = voices;
    voices = [];
    const player = new CuePlayer("ar");
    const run = player.line("check_stop_now", "safety");
    pending[0].onerror();
    await Promise.resolve();
    await Promise.resolve();
    expect(listeners).toHaveLength(1);
    voices = all;
    listeners[0]();
    expect(await run).toBe(true);
    expect(spoken[0].text).toBe(cueLine("check_stop_now").arTts);
    expect(listeners).toHaveLength(0);
  });

  it("gives up quietly when no voice arrives, and never speaks after a stop", async () => {
    vi.useFakeTimers();
    voices = [];
    const player = new CuePlayer("ar");
    const run = player.line("check_go");
    pending[0].onerror();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await run).toBe(false);
    expect(spoken).toEqual([]);

    const again = player.line("check_ready");
    pending[1].onerror();
    await vi.advanceTimersByTimeAsync(0);
    player.stop();
    voices = [{ lang: "ar-SA", localService: true, name: "Arabic Saudi" }];
    listeners.forEach((l) => l());
    expect(await again).toBe(false);
    expect(spoken).toEqual([]);
  });

  it("never uses a remote voice", async () => {
    voices = [{ lang: "ar-SA", localService: false, name: "Cloud Arabic" }];
    const player = new CuePlayer("ar");
    const run = player.line("check_go");
    pending[0].onerror();
    expect(await run).toBe(false);
    expect(spoken).toEqual([]);
  });
});
