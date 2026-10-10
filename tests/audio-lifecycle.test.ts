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
// D-038 item 3: no exercise plays a recorded line (no counts any more); the v1 check's lines remain.
it("does not speak a pending cue after stopping or muting", async () => {
  const player = new CuePlayer("ar");
  const first = player.line("check_go", "info");
  player.stop();
  pending[0].onerror();
  await first;
  expect(speak).not.toHaveBeenCalled();
  const next = player.line("check_saved", "info");
  player.muted = true;
  pending[1].oncanplaythrough();
  await next;
  expect(pending[1].play).not.toHaveBeenCalled();
});
it("pauses an active recording on stop", async () => {
  const player = new CuePlayer("ar"),
    run = player.line("check_go", "info");
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
    run = player.line("check_go", "info");
  pending[0].onerror();
  await run;
  expect(speak).not.toHaveBeenCalled();
});
it("never lets a lower line cut off an active safety instruction", async () => {
  const player = new CuePlayer("ar"),
    warning = player.line("check_stop_now", "safety");
  pending[0].oncanplaythrough();
  await warning;
  expect(await player.line("check_go", "info")).toBe(false);
  expect(pending).toHaveLength(1);
  expect(pending[0].pause).not.toHaveBeenCalled();
});
it("interrupts a line immediately for safety", async () => {
  const player = new CuePlayer("ar"),
    line = player.line("check_go", "info");
  pending[0].oncanplaythrough();
  await line;
  const warning = player.line("check_stop_now", "safety");
  expect(pending[0].pause).toHaveBeenCalledOnce();
  pending[1].oncanplaythrough();
  await warning;
  expect(pending[1].play).toHaveBeenCalledOnce();
});
it("has no counts, cue lines or coach hold any more (D-038 item 3)", () => {
  const p = CuePlayer.prototype as unknown as Record<string, unknown>;
  expect(p.count).toBeUndefined();
  expect(p.cue).toBeUndefined();
  const c = CuePlayer as unknown as Record<string, unknown>;
  expect(c.holdForCoach).toBeUndefined();
  expect(c.onActivity).toBeUndefined();
});
it("says when a line ends (onEnd): at its end, when it is cut off, never for a line that did not start", async () => {
  const player = new CuePlayer("ar");
  const ends: string[] = [];
  const run = player.line("check_go", "info", () => ends.push("one"));
  pending[0].oncanplaythrough();
  expect(await run).toBe(true);
  (pending[0] as unknown as { onended: () => void }).onended();
  expect(ends).toEqual(["one"]);
  // Cut off by stop: a paused element fires no ended event, the player says it ended.
  const second = player.line("check_saved", "info", () => ends.push("two"));
  pending[1].oncanplaythrough();
  await second;
  player.stop();
  expect(ends).toEqual(["one", "two"]);
  // Did not start (muted): no end.
  player.muted = true;
  expect(await player.line("check_go", "info", () => ends.push("three"))).toBe(false);
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
