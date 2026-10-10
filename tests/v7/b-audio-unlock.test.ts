/**
 * D-026 item 5 (change log DG-5): the focus shell never switches the audio session while the coach is
 * live. Since D-036 item 1 it has no voice of its own to unlock: its taps start the Live coach's audio
 * context only, and never call the v1 flow's unlockAudio() (src/features/assessment/flow/voice.ts),
 * which sets the session to playback inside a tap.
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

  it("unlocks the coach's audio inside the taps that start the check, Ready and the sound button (D-036 item 1)", () => {
    const app = readFileSync(join(DIR, "FocusApp.tsx"), "utf8");
    // Only the Live coach speaks: its audio context starts from a tap (iOS); no phone voice to unlock.
    expect(app.match(/unlockCoachAudio\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(app.match(/unlockSound\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(app).not.toMatch(/PhoneVoice|CuePlayer|speechSynthesis/);
  });
});
