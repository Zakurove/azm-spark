/**
 * The spoken side of the safety screens (UX spec S36, 3.0, 4.3; council O12 (4), O24-2, 7.2-12): the
 * sentence split of display and speech lines, the O12 interim gate on Arabic synthesis, the sequence
 * player (every line shown in order, spoken when a voice may read it, never stuck on a voice that does
 * not end), and the alarm and chime tones made on the phone.
 */
import { describe, expect, it } from "vitest";
import { CHECK_DATA, cueLine } from "../src/movements/assessments";
import type { ScreenId } from "../src/movements/types";
import {
  copyLine,
  cueSpeech,
  pairSentences,
  readMs,
  screenLines,
  screenVoiceAllowed,
  splitSentences,
  spokenNumbers,
  SYNTH_APPROVED,
} from "../src/features/assessment/safety/speech";
import {
  SequencePlayer,
  speakLimitMs,
  type SpeechDeps,
} from "../src/features/assessment/safety/speechPlayer";
import {
  ALARM_SEGMENTS,
  alarmUri,
  base64,
  CHIME_SEGMENTS,
  chimeUri,
  TONE_RATE,
  toneSamples,
  wavBytes,
} from "../src/features/assessment/safety/tones";

const SAFETY_SCREENS: ScreenId[] = [
  "scr_emergency",
  "scr_ad",
  "scr_faint",
  "scr_faint_sci",
  "scr_fall",
  "scr_fall_seated",
  "scr_stop_seek_care",
  "scr_stop_pain",
  "scr_no_response",
];

describe("sentences of the safety texts (7.2-12)", () => {
  it("splits at full stops and question marks, Arabic and Latin, and keeps the punctuation", () => {
    expect(splitSentences("هل أنت بخير؟ إذا احتجت إلى مساعدة، فاتصل. وإذا كان")).toEqual([
      "هل أنت بخير؟",
      "إذا احتجت إلى مساعدة، فاتصل.",
      "وإذا كان",
    ]);
    expect(splitSentences("Stop now. Call 997 for an ambulance. If someone is with you, tell them.")).toEqual(
      ["Stop now.", "Call 997 for an ambulance.", "If someone is with you, tell them."],
    );
  });

  it("splits every safety screen's display text and its arTts into the same number of sentences", () => {
    for (const id of SAFETY_SCREENS) {
      const s = CHECK_DATA.screens[id] as { ar: string; arTts: string };
      expect(splitSentences(s.arTts).length, id).toBe(splitSentences(s.ar).length);
    }
  });

  it("reads 997 and 937 digit by digit in English speech (Q22)", () => {
    expect(spokenNumbers("Call 997, or the Ministry of Health on 937.")).toBe(
      "Call 9 9 7, or the Ministry of Health on 9 3 7.",
    );
    expect(spokenNumbers("In 1997")).toBe("In 1997");
  });

  it("rides the whole speech on the first sentence when the two split differently", () => {
    const lines = pairSentences("One. Two.", "Only one", "info", "b");
    expect(lines.map((l) => l.speech)).toEqual(["Only one", null]);
    expect(lines.map((l) => l.mark)).toEqual(["b:0", "b:1"]);
  });
});

describe("the O12 (4) interim gate on Arabic speech synthesis", () => {
  it("reads no Arabic safety screen until Nasser approves it by ear; English is read", () => {
    expect(SYNTH_APPROVED.size).toBe(0);
    for (const id of SAFETY_SCREENS) {
      expect(screenVoiceAllowed(id, "ar"), id).toBe(false);
      expect(screenVoiceAllowed(id, "en"), id).toBe(true);
      const ar = screenLines(id, "ar");
      expect(ar.every((l) => l.speech === null)).toBe(true);
      // The display text still shows, sentence by sentence.
      expect(ar.map((l) => l.display).join(" ")).toBe(splitSentences(CHECK_DATA.screens[id].ar).join(" "));
      const en = screenLines(id, "en");
      expect(en.every((l) => typeof l.speech === "string")).toBe(true);
      expect(en.some((l) => /\b997\b/.test(l.speech!))).toBe(false);
    }
  });

  it("reads an approved screen from its vocalised arTts, never the bare display text", () => {
    const lines = screenLines("scr_emergency", "ar", { voice: true });
    const tts = splitSentences((CHECK_DATA.screens.scr_emergency as { arTts: string }).arTts);
    expect(lines.map((l) => l.speech)).toEqual(tts);
    expect(lines[2].speech).toContain("تِسْعَةْ، تِسْعَةْ، سَبْعَةْ");
  });

  it("speaks check cues from their arTts, and never voices unvocalised Arabic copy", () => {
    expect(cueSpeech("check_stop_now", "ar").speech).toBe(cueLine("check_stop_now").arTts);
    expect(cueSpeech("check_urgent_call", "en").speech).toBe("If you need urgent help, call 9 9 7.");
    expect(copyLine("ar", "خذ وقتك.").speech).toBeNull();
    expect(copyLine("en", "Take your time.").speech).toBe("Take your time.");
  });

  it("keeps a caption up for its reading time when no voice reads it", () => {
    expect(readMs("Stop.")).toBe(1800);
    expect(readMs("x".repeat(60))).toBe(3900);
    expect(readMs("x".repeat(1000))).toBe(9000);
  });
});

/** A fake page: a clock, and a voice that ends a line when told to. */
function fakeDeps(opts: { voice: boolean; loading?: boolean }) {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const spoken: string[] = [];
  let pending: (() => void) | null = null;
  const voice = opts.voice ? ({ lang: "en-GB" } as SpeechSynthesisVoice) : null;
  const deps: SpeechDeps = {
    // The voice list is known at once, unless the test models a list that is still loading.
    voiceNow: () => (opts.loading ? undefined : voice),
    voiceFor: async () => voice,
    speak(text, _lang, _voice, done) {
      spoken.push(text);
      pending = done;
    },
    cancel() {
      const p = pending;
      pending = null;
      p?.();
    },
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout(id) {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    deps,
    spoken,
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        now = next.at;
        next.fn();
        await flush();
      }
      now = end;
      await flush();
    },
    async endLine() {
      const p = pending;
      pending = null;
      p?.();
      await flush();
    },
  };
}

const LINES = [
  { display: "Stop now.", speech: "Stop now.", severity: "safety" as const },
  { display: "Shown only.", speech: null, severity: "safety" as const },
  { display: "Call 997.", speech: "Call 9 9 7.", severity: "safety" as const },
];

describe("the sequence player", () => {
  it("shows every line in order, speaks the lines that have speech, and ends", async () => {
    const f = fakeDeps({ voice: true });
    const shown: [number, boolean][] = [];
    let ended = false;
    new SequencePlayer(f.deps).play(LINES, {
      lang: "en",
      soundOn: () => true,
      onLine: (i, speaking) => shown.push([i, speaking]),
      onEnd: () => (ended = true),
    });
    await f.advance(0);
    expect(shown).toEqual([[0, true]]);
    await f.endLine();
    expect(shown).toEqual([
      [0, true],
      [1, false],
    ]);
    await f.advance(readMs("Shown only."));
    expect(shown[2]).toEqual([2, true]);
    await f.endLine();
    expect(ended).toBe(true);
    expect(f.spoken).toEqual(["Stop now.", "Call 9 9 7."]);
  });

  it("steps through the text by reading time with the sound off or no local voice", async () => {
    for (const [voice, sound] of [
      [false, true],
      [true, false],
    ] as const) {
      const f = fakeDeps({ voice });
      const shown: [number, boolean][] = [];
      let ended = false;
      new SequencePlayer(f.deps).play(LINES, {
        lang: "ar",
        soundOn: () => sound,
        onLine: (i, speaking) => shown.push([i, speaking]),
        onEnd: () => (ended = true),
      });
      await f.advance(0);
      await f.advance(20_000);
      expect(shown).toEqual([
        [0, false],
        [1, false],
        [2, false],
      ]);
      expect(ended).toBe(true);
      expect(f.spoken).toEqual([]);
    }
  });

  it("shows the first line at once while the voice list loads, then speaks it", async () => {
    const f = fakeDeps({ voice: true, loading: true });
    const shown: [number, boolean][] = [];
    new SequencePlayer(f.deps).play([LINES[0]], {
      lang: "en",
      soundOn: () => true,
      onLine: (i, speaking) => shown.push([i, speaking]),
      onEnd: () => undefined,
    });
    expect(shown).toEqual([[0, false]]);
    await f.advance(0);
    expect(shown).toEqual([
      [0, false],
      [0, true],
    ]);
    expect(f.spoken).toEqual(["Stop now."]);
  });

  it("moves on when a voice never ends a line", async () => {
    const f = fakeDeps({ voice: true });
    const shown: number[] = [];
    new SequencePlayer(f.deps).play([LINES[0], LINES[2]], {
      lang: "en",
      soundOn: () => true,
      onLine: (i) => shown.push(i),
      onEnd: () => undefined,
    });
    await f.advance(0);
    await f.advance(speakLimitMs("Stop now.") + 1);
    expect(shown).toEqual([0, 1]);
  });

  it("stops at once, and after the Sound goes off keeps showing the rest without a voice", async () => {
    const f = fakeDeps({ voice: true });
    const shown: [number, boolean][] = [];
    let sound = true;
    const player = new SequencePlayer(f.deps);
    player.play(LINES, {
      lang: "en",
      soundOn: () => sound,
      onLine: (i, speaking) => shown.push([i, speaking]),
      onEnd: () => undefined,
    });
    await f.advance(0);
    sound = false;
    player.silence();
    await f.advance(20_000);
    expect(shown).toEqual([
      [0, true],
      [1, false],
      [2, false],
    ]);
    const g = fakeDeps({ voice: false });
    const seen: number[] = [];
    const p2 = new SequencePlayer(g.deps);
    p2.play(LINES, { lang: "en", soundOn: () => false, onLine: (i) => seen.push(i), onEnd: () => undefined });
    await g.advance(0);
    p2.stop();
    await g.advance(20_000);
    expect(seen).toEqual([0]);
  });
});

describe("the alarm and chime tones (S45, S43, S47)", () => {
  it("writes a 16 bit mono PCM WAV", () => {
    const bytes = wavBytes(toneSamples(ALARM_SEGMENTS));
    const text = (at: number, n: number) => String.fromCharCode(...bytes.slice(at, at + n));
    const v = new DataView(bytes.buffer);
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(TONE_RATE);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(bytes.length - 44);
  });

  it("alarm: 880 then 660 Hz, 0.5 s each, loud, starting and ending at zero (loops without a click)", () => {
    expect(ALARM_SEGMENTS.map((s) => [s.freq, s.ms])).toEqual([
      [880, 500],
      [660, 500],
    ]);
    const s = toneSamples(ALARM_SEGMENTS);
    expect(s.length).toBe(TONE_RATE);
    expect(Math.abs(s[0])).toBeLessThan(100);
    expect(Math.abs(s[s.length - 1])).toBeLessThan(100);
    const peak = Math.max(...Array.from(s, Math.abs));
    expect(peak).toBeGreaterThan(0.8 * 32767);
  });

  it("chime: two soft notes under 1 s, quieter than the alarm", () => {
    const s = toneSamples(CHIME_SEGMENTS);
    expect(s.length / TONE_RATE).toBeLessThan(1);
    expect(Math.max(...Array.from(s, Math.abs))).toBeLessThan(0.4 * 32767);
  });

  it("encodes base64 like the platform and serves both as data URIs (no network)", () => {
    const bytes = wavBytes(toneSamples(CHIME_SEGMENTS));
    expect(base64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(base64(new Uint8Array([1, 2]))).toBe("AQI=");
    expect(base64(new Uint8Array([1]))).toBe("AQ==");
    expect(alarmUri()).toMatch(/^data:audio\/wav;base64,UklGR/);
    expect(chimeUri()).toMatch(/^data:audio\/wav;base64,/);
    expect(alarmUri()).toBe(alarmUri());
  });
});
