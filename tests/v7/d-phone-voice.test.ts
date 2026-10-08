/**
 * D-034 item 3: one voice control. With the sound on and no Live coach, every v7 line is spoken with
 * the phone's own speech (SpeechSynthesis): an Arabic voice, ar-SA first, for the Arabic interface, an
 * English one for the English interface, local voices only. iOS lets speech play only after a first
 * utterance a tap started, so the check's taps unlock it. The lines report to CuePlayer's activity, so
 * the Live coach's microphone gate hears the app's own voice as it does for the voice packs.
 */
import { afterEach, describe, expect, it } from "vitest";
import { CuePlayer } from "../../src/app/audio";
import { PhoneVoice, pickVoice, type SpeechPort } from "../../src/features/coach-agent/phoneVoice";

interface FakeVoice {
  lang: string;
  localService: boolean;
  name: string;
}
interface Said {
  text: string;
  lang: string;
  voice: string | null;
  volume: number;
  end(): void;
}

/** A SpeechSynthesis stand in: records each utterance; `end` finishes it. */
function fakeSpeech(voices: FakeVoice[]) {
  const said: Said[] = [];
  let cancelled = 0;
  const port: SpeechPort = {
    getVoices: () => voices as unknown as SpeechSynthesisVoice[],
    speak: (u) => {
      said.push({
        text: u.text,
        lang: u.lang,
        voice: (u.voice as unknown as FakeVoice | null)?.name ?? null,
        volume: u.volume,
        end: () => u.onend?.(new Event("end") as SpeechSynthesisEvent),
      });
    },
    cancel: () => {
      cancelled++;
    },
  };
  return { port, said, cancelled: () => cancelled };
}

/** A minimal utterance (node has no SpeechSynthesisUtterance). */
class Utterance {
  text: string;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  volume = 1;
  rate = 1;
  onend: ((e: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((e: SpeechSynthesisErrorEvent) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}
const make = (t: string) => new Utterance(t) as unknown as SpeechSynthesisUtterance;

const MAJED = { lang: "ar-SA", localService: true, name: "Majed" };
const LAILA = { lang: "ar-EG", localService: true, name: "Laila" };
const DANIEL = { lang: "en-GB", localService: true, name: "Daniel" };
const REMOTE_AR = { lang: "ar-SA", localService: false, name: "Google العربية" };

afterEach(() => PhoneVoice.resetUnlockForTests());

describe("pickVoice: the phone's voice for the interface language", () => {
  it("takes ar-SA first, then any Arabic voice, for the Arabic interface", () => {
    expect(pickVoice([DANIEL, LAILA, MAJED], "ar")?.name).toBe("Majed");
    expect(pickVoice([DANIEL, LAILA], "ar")?.name).toBe("Laila");
    expect(pickVoice([{ lang: "ar_SA", localService: true, name: "Tarik" }], "ar")?.name).toBe("Tarik");
  });

  it("takes an English voice for the English interface", () => {
    expect(pickVoice([MAJED, DANIEL], "en")?.name).toBe("Daniel");
    expect(pickVoice([MAJED, { lang: "en-US", localService: true, name: "Samantha" }], "en")?.name).toBe(
      "Samantha",
    );
  });

  it("never takes a remote voice (it would send the line to a speech service)", () => {
    expect(pickVoice([REMOTE_AR], "ar")).toBeNull();
    expect(pickVoice([REMOTE_AR, LAILA], "ar")?.name).toBe("Laila");
  });

  it("finds none for Arabic on a phone with English voices only (the captions stay)", () => {
    expect(pickVoice([DANIEL], "ar")).toBeNull();
  });
});

describe("PhoneVoice: every v7 line with the phone's own speech", () => {
  it("speaks a voice line's words in the interface language, the vocalized Arabic for speech", async () => {
    const s = fakeSpeech([MAJED, DANIEL]);
    const v = new PhoneVoice("ar", { speech: s.port, utterance: make });
    expect(await v.line("rom_ask_max", "info")).toBe(true);
    expect(s.said[0]).toMatchObject({ lang: "ar-SA", voice: "Majed" });
    expect(s.said[0].text).toContain("أقصى");
    v.setLang("en");
    s.said[0].end();
    expect(await v.line("rom_ask_max", "info")).toBe(true);
    expect(s.said[1]).toMatchObject({
      text: "Is this as far as you can go?",
      lang: "en-GB",
      voice: "Daniel",
    });
  });

  it("speaks any interface text («لنبدأ»), and stays silent while muted", async () => {
    const s = fakeSpeech([MAJED]);
    const v = new PhoneVoice("ar", { speech: s.port, utterance: make });
    expect(await v.say("لنبدأ", "info")).toBe(true);
    expect(s.said.at(-1)?.text).toBe("لنبدأ");
    v.muted = true;
    expect(await v.say("لنبدأ", "info")).toBe(false);
    expect(await v.line("rom_ask_max", "info")).toBe(false);
    expect(s.said).toHaveLength(1);
  });

  it("does not speak an unknown line id, nor without a voice for the language", async () => {
    const s = fakeSpeech([DANIEL]);
    const v = new PhoneVoice("ar", { speech: s.port, utterance: make });
    expect(await v.line("no_such_line", "info")).toBe(false);
    expect(await v.line("rom_ask_max", "info")).toBe(false);
    expect(s.said).toHaveLength(0);
  });

  it("lets a safety line cut in, keeps a correction from cutting a question, and ends each line once", async () => {
    const s = fakeSpeech([MAJED]);
    const v = new PhoneVoice("ar", { speech: s.port, utterance: make });
    const ended: string[] = [];
    await v.line("rom_ask_max", "warn", () => ended.push("ask"));
    expect(await v.line("rom_keep_back", "info")).toBe(false);
    expect(await v.line("rom_pain_stop", "safety", () => ended.push("stop"))).toBe(true);
    expect(ended).toEqual(["ask"]);
    s.said.at(-1)!.end();
    s.said.at(-1)!.end();
    expect(ended).toEqual(["ask", "stop"]);
    expect(await v.line("rom_keep_back", "info")).toBe(true);
  });

  it("reports each line to CuePlayer's activity (the Live coach's microphone gate)", async () => {
    const s = fakeSpeech([MAJED]);
    const v = new PhoneVoice("ar", { speech: s.port, utterance: make });
    const seen: boolean[] = [];
    const off = CuePlayer.onActivity((playing) => seen.push(playing));
    await v.say("لنبدأ", "info");
    s.said[0].end();
    off();
    expect(seen).toEqual([true, false]);
  });

  it("unlocks iOS speech inside the tap: one silent utterance at once, never waiting", () => {
    const s = fakeSpeech([]);
    PhoneVoice.unlock({ speech: s.port, utterance: make });
    expect(s.said).toHaveLength(1);
    expect(s.said[0].volume).toBe(0);
    PhoneVoice.unlock({ speech: s.port, utterance: make });
    expect(s.said).toHaveLength(1);
  });

  it("stop cancels the phone's speech and ends the line", async () => {
    const s = fakeSpeech([MAJED]);
    const v = new PhoneVoice("ar", { speech: s.port, utterance: make });
    let ended = 0;
    await v.say("لنبدأ", "info", () => ended++);
    v.stop();
    expect(s.cancelled()).toBeGreaterThan(0);
    expect(ended).toBe(1);
  });
});

describe("PhoneVoice and the engine's queue", () => {
  it("cancels only to cut a line of its own that still plays (a cancel with nothing playing can drop the next line)", async () => {
    const s = fakeSpeech([MAJED]);
    const v = new PhoneVoice("ar", { speech: s.port, utterance: make });
    await v.say("لنبدأ", "info");
    expect(s.cancelled()).toBe(0);
    s.said[0].end();
    await v.line("rom_ask_max", "info");
    expect(s.cancelled()).toBe(0);
    await v.line("rom_pain_stop", "safety");
    expect(s.cancelled()).toBe(1);
  });
});
