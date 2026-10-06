import { afterEach, expect, it, vi } from "vitest";
import { defaults, readPreferences, insight, savePreferences } from "../src/app/experience";
import { sessionCsv } from "../src/app/History";
import { SavedSession } from "../src/app/product";
afterEach(() => vi.unstubAllGlobals());
it("recovers from malformed or unavailable stored preferences", () => {
  // Booth v2 A6: the voice is off by default.
  // v7 (contract D5): the live coach is off by default, with the shortest pause.
  const fallback = {
    voice: "off",
    safetyCheckIn: false,
    voicePack: "",
    checkSound: "",
    liveCoach: false,
    coachPause: 800,
  };
  vi.stubGlobal("localStorage", { getItem: () => "{broken" });
  expect(readPreferences()).toEqual(fallback);
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({
        voice: "remote",
        pace: 8,
        focus: "yes",
        safetyCheckIn: "yes",
        voicePack: ["x"],
        checkSound: "captionsOnly",
        liveCoach: "yes",
        coachPause: 900,
      }),
  });
  expect(readPreferences()).toEqual(fallback);
});
it("keeps the voice on or off as chosen on this device since booth v2 (A6)", () => {
  for (const [stored, voice] of [
    ["off", "off"],
    ["full", "full"],
  ] as const) {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ voice: stored, voiceV: 2 }),
    });
    expect(readPreferences()).toEqual({
      voice,
      safetyCheckIn: false,
      voicePack: "",
      checkSound: "",
      liveCoach: false,
      coachPause: 800,
    });
  }
});
it("reads a voice stored before booth v2 as off: earlier builds saved their default with any setting", () => {
  // The C40 build stored voice "full" (its default) whenever any coach setting changed, and the
  // guidance only mode of a build before it stored "essential": neither was a choice of the voice.
  for (const stored of ["off", "full", "essential"]) {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ voice: stored, pace: 0.85, focus: true, voicePack: "x" }),
    });
    expect(readPreferences()).toEqual({
      voice: "off",
      safetyCheckIn: false,
      voicePack: "x",
      checkSound: "",
      liveCoach: false,
      coachPause: 800,
    });
  }
});
it("saves the voice with its marker, so the choice is kept", () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
  expect(defaults.voice).toBe("off");
  savePreferences({ ...defaults, voice: "full" });
  expect(readPreferences().voice).toBe("full");
  savePreferences({ ...defaults, voice: "off" });
  expect(readPreferences().voice).toBe("off");
});
it("keeps the movement check's optional check in per device, off by default (D-016)", () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  expect(readPreferences().safetyCheckIn).toBe(false);
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ safetyCheckIn: true }) });
  expect(readPreferences().safetyCheckIn).toBe(true);
});
it("exports partial attempts separately and preserves unknown effort", () => {
  const s = {
    endedAt: 1000,
    exerciseId: "sit_to_stand",
    reps: { valid: 2, compensated: 1, partial: 4 },
  } as SavedSession;
  // Booth v2 (D): the export names each row's mode and keeps a held card's seconds in its own column.
  expect(sessionCsv([s]).split("\r\n")[1]).toBe("1970-01-01T00:00:01.000Z,sit_to_stand,3,2,1,4,,,camera,");
});
it("does not congratulate an empty session", () => {
  expect(insight({ valid: 0, compensated: 0, partial: 0 }, "en")).toMatch(/No repetitions/);
  expect(insight({ valid: 2, compensated: 1, partial: 0 }, "en")).toMatch(/flags/);
});
