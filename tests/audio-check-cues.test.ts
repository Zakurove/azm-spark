/**
 * Movement check cues in the CuePlayer: every check cue id is a voice line. A line whose MP3 does not
 * exist is not said: the phone's own speech is never used (D-036 item 1), even on a phone that has it
 * (the stub below records any use). While a Live coach session is on, no recording plays at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CuePlayer, isVoiceLine } from "../src/app/audio";
import voiceScript from "../src/app/voice-script.json";
import { CHECK_DATA } from "../src/movements/assessments";

type FakeAudio = {
  src?: string;
  onerror: () => void;
  oncanplaythrough: () => void;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
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

describe("a missing recording (D-036 item 1: never the phone's speech)", () => {
  it("asks for the MP3, and when it is missing says nothing (the caption carries the line)", async () => {
    for (const [lang, id] of [
      ["ar", "check_are_you_ok"],
      ["en", "test_trunk_to_middle"],
    ] as const) {
      pending = [];
      const player = new CuePlayer(lang);
      const run = player.line(id, "safety");
      expect(pending[0].src).toBe(`/cues/packs/openai-ash/${lang}/${id}.mp3`);
      pending[0].onerror();
      expect(await run).toBe(false);
    }
    expect(spoken).toEqual([]);
  });

  it("plays the recording when it exists", async () => {
    const player = new CuePlayer("ar");
    const run = player.line("check_go");
    pending[0].oncanplaythrough();
    expect(await run).toBe(true);
    expect(pending[0].play).toHaveBeenCalledOnce();
    expect(spoken).toEqual([]);
  });

  it("frees the player after a missing line, so the next line plays", async () => {
    const player = new CuePlayer("ar");
    const missing = player.line("check_stop_now", "safety");
    pending[0].onerror();
    expect(await missing).toBe(false);
    const next = player.line("check_go");
    pending[1].oncanplaythrough();
    expect(await next).toBe(true);
    expect(spoken).toEqual([]);
  });
});

describe("no recording while a Live coach session is on (D-036 item 1)", () => {
  afterEach(() => CuePlayer.holdForCoach(false));

  it("refuses every line and count while held, stops a line playing, and plays again once released", async () => {
    const player = new CuePlayer("ar");
    const playing = player.line("check_go");
    pending[0].oncanplaythrough();
    expect(await playing).toBe(true);
    const ends: boolean[] = [];
    const off = CuePlayer.onActivity((p) => ends.push(p));
    CuePlayer.holdForCoach(true);
    // The line playing is cut (its end is reported; so are the lines earlier tests left playing) and
    // nothing new starts.
    expect(pending[0].pause).toHaveBeenCalled();
    expect(ends.length).toBeGreaterThan(0);
    expect(ends.every((p) => p === false)).toBe(true);
    expect(CuePlayer.coachHeld).toBe(true);
    expect(await player.line("check_ready")).toBe(false);
    expect(await player.count(3)).toBe(false);
    expect(await new CuePlayer("en").cue("stop_rest", "safety")).toBe(false);
    CuePlayer.holdForCoach(false);
    expect(CuePlayer.coachHeld).toBe(false);
    const after = player.line("check_ready");
    pending.at(-1)!.oncanplaythrough();
    expect(await after).toBe(true);
    off();
    expect(spoken).toEqual([]);
  });

  it("counts each session once: two sessions on, one off still holds", () => {
    CuePlayer.holdForCoach(true);
    CuePlayer.holdForCoach(true);
    CuePlayer.holdForCoach(false);
    expect(CuePlayer.coachHeld).toBe(true);
    CuePlayer.holdForCoach(false);
    expect(CuePlayer.coachHeld).toBe(false);
    CuePlayer.holdForCoach(false);
    expect(CuePlayer.coachHeld).toBe(false);
  });
});
