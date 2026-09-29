import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CuePlayer } from "../src/app/audio";
let pending: {
  onerror: () => void;
  oncanplaythrough: () => void;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
}[];
let speak: ReturnType<typeof vi.fn>;
beforeEach(() => {
  pending = [];
  speak = vi.fn();
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
    speak,
    getVoices: () => [{ lang: "ar-SA", localService: true }],
  });
});
afterEach(() => vi.unstubAllGlobals());
it("does not speak a pending cue after stopping or muting", async () => {
  const player = new CuePlayer("ar");
  const first = player.count(1);
  player.stop();
  pending[0].onerror();
  await first;
  expect(speak).not.toHaveBeenCalled();
  const next = player.count(2);
  player.muted = true;
  pending[1].oncanplaythrough();
  await next;
  expect(pending[1].play).not.toHaveBeenCalled();
});
it("pauses an active recording on stop", async () => {
  const player = new CuePlayer("ar"),
    run = player.count(1);
  pending[0].oncanplaythrough();
  await run;
  expect(pending[0].play).toHaveBeenCalledOnce();
  player.stop();
  expect(pending[0].pause).toHaveBeenCalledOnce();
});
it("only falls back to a local voice", async () => {
  vi.stubGlobal("speechSynthesis", {
    cancel: vi.fn(),
    speak,
    getVoices: () => [{ lang: "ar-SA", localService: false }],
  });
  const player = new CuePlayer("ar"),
    run = player.count(1);
  pending[0].onerror();
  await run;
  expect(speak).not.toHaveBeenCalled();
});
it("never lets a count cut off an active safety instruction", async () => {
  const player = new CuePlayer("ar"),
    warning = player.cue("stop_rest", "safety");
  pending[0].oncanplaythrough();
  await warning;
  expect(await player.count(1)).toBe(false);
  expect(pending).toHaveLength(1);
  expect(pending[0].pause).not.toHaveBeenCalled();
});
it("interrupts a count immediately for safety", async () => {
  const player = new CuePlayer("ar"),
    count = player.count(1);
  pending[0].oncanplaythrough();
  await count;
  const warning = player.cue("stop_rest", "safety");
  expect(pending[0].pause).toHaveBeenCalledOnce();
  pending[1].oncanplaythrough();
  await warning;
  expect(pending[1].play).toHaveBeenCalledOnce();
});
it("omits counts in guidance-only mode while retaining correction cues", async () => {
  const player = new CuePlayer("ar");
  player.guidanceOnly = true;
  expect(await player.count(1)).toBe(false);
  expect(pending).toHaveLength(0);
  const warning = player.cue("sit_tall");
  pending[0].oncanplaythrough();
  await warning;
  expect(pending[0].play).toHaveBeenCalledOnce();
});
it("says when a line ends (onEnd): at its end, when it is cut off, never for a line that did not start", async () => {
  const player = new CuePlayer("ar");
  const ends: string[] = [];
  const run = player.line("count_1", "info", () => ends.push("one"));
  pending[0].oncanplaythrough();
  expect(await run).toBe(true);
  (pending[0] as unknown as { onended: () => void }).onended();
  expect(ends).toEqual(["one"]);
  // Cut off by stop: a paused element fires no ended event, the player says it ended.
  const second = player.line("count_2", "info", () => ends.push("two"));
  pending[1].oncanplaythrough();
  await second;
  player.stop();
  expect(ends).toEqual(["one", "two"]);
  // Did not start (muted): no end.
  player.muted = true;
  expect(await player.line("count_3", "info", () => ends.push("three"))).toBe(false);
  expect(ends).toEqual(["one", "two"]);
});
it("unlocks audio with silence inside a tap (S01, S02)", () => {
  const made: { src: string; play: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal(
    "Audio",
    class {
      src = "";
      play = vi.fn().mockResolvedValue(undefined);
      constructor() {
        made.push(this);
      }
    },
  );
  CuePlayer.unlock();
  // One shared element plays a silent data URI; nothing is fetched and nothing is heard.
  const silent = made.find((a) => a.src.startsWith("data:audio/wav"));
  expect(silent?.play).toHaveBeenCalled();
});
