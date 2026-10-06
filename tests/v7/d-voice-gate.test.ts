/**
 * D-030 item 2, D5-8: the camera set's own voice goes on the coach's microphone gate (bridge rules 1
 * and 3). Session.tsx says its corrections, counts and safety line through its own CuePlayer; every
 * CuePlayer now reports each line it plays from its start to its end (CuePlayer.onActivity), and the
 * coach's local voice (CueVoice) counts them as playing: the microphone closes while the app speaks,
 * and the bridge's stop line is not said over the set's own safety line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CuePlayer } from "../../src/app/audio";
import { CueVoice, type CueLike } from "../../src/features/coach-agent/LocalVoice";
import type { Severity } from "../../src/engine/types";

type FakeAudio = { src: string; onended?: () => void; play: ReturnType<typeof vi.fn> };
let made: FakeAudio[];

beforeEach(() => {
  made = [];
  vi.stubGlobal(
    "Audio",
    class {
      src = "";
      onerror = () => {};
      oncanplaythrough = () => {};
      onended?: () => void;
      pause = vi.fn();
      play = vi.fn().mockResolvedValue(undefined);
      currentTime = 0;
      playbackRate = 1;
      constructor(src?: string) {
        this.src = src ?? "";
        made.push(this as unknown as FakeAudio);
      }
      load() {
        queueMicrotask(() => this.oncanplaythrough());
      }
    },
  );
  vi.stubGlobal("speechSynthesis", { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [] });
});
afterEach(() => vi.unstubAllGlobals());

describe("CuePlayer.onActivity", () => {
  it("reports each line of any player from its start to its end, and stops after unsubscribing", async () => {
    const seen: [boolean, Severity][] = [];
    const off = CuePlayer.onActivity((playing, severity) => seen.push([playing, severity]));
    const set = new CuePlayer("en");
    expect(await set.count(1)).toBe(true);
    expect(seen).toEqual([[true, "praise"]]);
    made.find((a) => a.play.mock.calls.length)!.onended!();
    expect(seen).toEqual([
      [true, "praise"],
      [false, "praise"],
    ]);
    // Another player's safety line, cut by a stop, ends too.
    const other = new CuePlayer("en");
    expect(await other.cue("stop_rest", "safety")).toBe(true);
    other.stop();
    expect(seen.slice(2)).toEqual([
      [true, "safety"],
      [false, "safety"],
    ]);
    off();
    expect(await set.count(2)).toBe(true);
    expect(seen).toHaveLength(4);
  });
});

/** A player that never plays (the CueVoice's own lines are not part of these tests). */
const SILENT: CueLike = { line: async () => false, stop: () => undefined };

describe("CueVoice and the app's own voice", () => {
  function voiceWithSource() {
    let emit: ((playing: boolean, severity: Severity) => void) | null = null;
    let subscribed = 0;
    const source = (fn: (playing: boolean, severity: Severity) => void) => {
      emit = fn;
      subscribed++;
      return () => {
        emit = null;
      };
    };
    const voice = new CueVoice(SILENT, source);
    return { voice, emit: (p: boolean, s: Severity) => emit?.(p, s), subscribed: () => subscribed };
  }

  it("counts a line of any player as playing while the coach listens, for the mic gate", () => {
    const { voice, emit, subscribed } = voiceWithSource();
    expect(subscribed()).toBe(0);
    const seen: boolean[] = [];
    const off = voice.onPlaying((p) => seen.push(p));
    expect(subscribed()).toBe(1);
    emit(true, "warn");
    expect(voice.playing).toBe(true);
    expect(voice.playingSafety).toBe(false);
    emit(true, "praise");
    emit(false, "warn");
    expect(voice.playing).toBe(true);
    emit(false, "praise");
    expect(voice.playing).toBe(false);
    expect(seen).toEqual([true, false]);
    off();
    emit(true, "warn");
    expect(voice.playing).toBe(false);
  });

  it("says the set's own safety line is playing, so the bridge does not say its stop line over it", () => {
    const { voice, emit } = voiceWithSource();
    voice.onPlaying(() => undefined);
    emit(true, "safety");
    expect(voice.playingSafety).toBe(true);
    emit(false, "safety");
    expect(voice.playingSafety).toBe(false);
  });
});
