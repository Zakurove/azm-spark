import { afterEach, expect, it, vi } from "vitest";
import { defaults, readPreferences, insight, savePreferences } from "../src/app/experience";
import { sessionCsv } from "../src/app/History";
import { SavedSession } from "../src/app/product";
afterEach(() => vi.unstubAllGlobals());
it("recovers from malformed or unavailable stored preferences", () => {
  // Booth v2 A6: the voice is off by default.
  // v7 (contract D5): the live coach is off by default, with the shortest pause.
  const fallback = {
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
it("keeps no recorded coach voice setting any more (D-038 item 3): an old stored voice is ignored", () => {
  const store = new Map<string, string>([
    ["azm.coach", JSON.stringify({ voice: "full", voiceV: 2, voicePack: "x" })],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
  expect(readPreferences()).toEqual({
    safetyCheckIn: false,
    voicePack: "x",
    checkSound: "",
    liveCoach: false,
    coachPause: 800,
  });
  expect(defaults).not.toHaveProperty("voice");
  savePreferences({ ...defaults, liveCoach: true });
  expect(JSON.parse(store.get("azm.coach")!)).toEqual({ ...defaults, liveCoach: true });
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
