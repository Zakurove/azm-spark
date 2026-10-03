/**
 * Booth v2, contract A5: the counting voice never queues more than one line. A count that arrives
 * while a line plays waits as the only queued count (a newer count replaces it), and it plays when
 * the line ends; counts never wait behind a safety line.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CuePlayer } from "../src/app/audio";

type FakeAudio = {
  src: string;
  onerror: () => void;
  oncanplaythrough: () => void;
  onended?: () => void;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
};
let made: FakeAudio[];
beforeEach(() => {
  made = [];
  vi.stubGlobal(
    "Audio",
    class {
      src = "";
      onerror = () => {};
      oncanplaythrough = () => {};
      pause = vi.fn();
      play = vi.fn().mockResolvedValue(undefined);
      constructor(src?: string) {
        this.src = src ?? "";
        made.push(this as unknown as FakeAudio);
      }
      load() {
        // every recording loads at once
        queueMicrotask(() => this.oncanplaythrough());
      }
    },
  );
  vi.stubGlobal("speechSynthesis", { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [] });
});
afterEach(() => vi.unstubAllGlobals());

const said = () =>
  made
    .filter((a) => a.play.mock.calls.length && /count_\d+/.test(a.src))
    .map((a) => a.src.match(/count_(\d+)/)![1]);

it("keeps at most one count waiting, the newest, and plays it when the line ends", async () => {
  const player = new CuePlayer("en");
  expect(await player.count(1)).toBe(true);
  const playing = made.find((a) => a.play.mock.calls.length)!;
  // two more reps land while "one" is still being said
  expect(await player.count(2)).toBe(false);
  expect(await player.count(3)).toBe(false);
  expect(said()).toEqual(["1"]);
  playing.onended!();
  await vi.waitFor(() => expect(said()).toEqual(["1", "3"]));
  // nothing else was queued
  made.find((a) => a.src.includes("count_3") && a.play.mock.calls.length)!.onended!();
  await new Promise((r) => setTimeout(r, 10));
  expect(said()).toEqual(["1", "3"]);
});

it("drops the waiting count on stop and never queues it behind a safety line", async () => {
  const player = new CuePlayer("en");
  await player.count(1);
  await player.count(2);
  player.stop();
  await new Promise((r) => setTimeout(r, 10));
  expect(said()).toEqual(["1"]);
  await player.cue("stop_rest", "safety");
  expect(await player.count(3)).toBe(false);
  made.find((a) => a.src.includes("stop_rest"))!.onended!();
  await new Promise((r) => setTimeout(r, 10));
  expect(said()).toEqual(["1"]);
});
