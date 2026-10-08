/**
 * D-034 item 3: one voice control, the speaker button; on by default in a v7 build, the person's
 * choice kept per device.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSound, saveSound, SOUND_KEY } from "../../src/features/coach-agent/sound";

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("the sound switch", () => {
  it("is on by default in a v7 build, off before v7", () => {
    expect(readSound(true, store())).toBe(true);
    expect(readSound(false, store())).toBe(false);
  });

  it("keeps the person's choice on this device", () => {
    const s = store();
    saveSound(false, s);
    expect(s.m.get(SOUND_KEY)).toBe("off");
    expect(readSound(true, s)).toBe(false);
    saveSound(true, s);
    expect(readSound(false, s)).toBe(true);
  });

  it("falls back to the default when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSound(true, blocked)).toBe(true);
    expect(() => saveSound(false, blocked)).not.toThrow();
  });
});

describe("the focus check and the walk follow the one switch (D-034 item 3)", () => {
  const read = (f: string) => readFileSync(join(__dirname, "../../src/features", f), "utf8");
  it("runs the Live coach on the sound switch, never on the separate Live coach setting", () => {
    const app = read("focus/FocusApp.tsx");
    expect(app).not.toMatch(/readPreferences|\.liveCoach/);
    expect(app).toMatch(/readSound\(\)/);
    expect(app).toMatch(/preference: soundOn/);
    // The status is read once the check started (its start records the live_coach consent).
    expect(app).toMatch(/useCoachStatus\(soundOn && checkId !== null, checkId\)/);
    expect(app).toMatch(/sound=\{soundOn\}/);
  });

  it("speaks the walk's lines with the phone's own voice on the shell's switch", () => {
    const walk = read("gait/GaitCapture.tsx");
    expect(walk).not.toMatch(/readPreferences|new CuePlayer/);
    expect(walk).toMatch(/new PhoneVoice\(lang\)/);
    expect(walk).toMatch(/props\.sound === true/);
  });
});
