/**
 * D-026 item 5 (change log DG-5): the focus shell never switches the audio session while the coach is
 * live. It unlocks the voice with CuePlayer.unlock (src/app/audio.ts), which D's hunk keeps from
 * resetting a live coach's play-and-record session, and never with the v1 flow's unlockAudio()
 * (src/features/assessment/flow/voice.ts), which sets the session to playback inside a tap.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "../../src/features/focus");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("the focus shell and the audio session (DG-5)", () => {
  it("never imports or calls the v1 flow's unlockAudio", () => {
    const bad = files(DIR).filter((p) => {
      const src = readFileSync(p, "utf8");
      return /assessment\/flow\/voice/.test(src) || /\bunlockAudio\s*\(/.test(src);
    });
    expect(bad).toEqual([]);
  });

  it("unlocks the voice with CuePlayer.unlock inside the taps that start the check and turn the sound on", () => {
    const app = readFileSync(join(DIR, "FocusApp.tsx"), "utf8");
    expect(app.match(/CuePlayer\.unlock\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
