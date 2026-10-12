/**
 * D-039 item 4: the coach's tap unlock sets the iOS audio session to "playback" (unless the
 * microphone's play-and-record is on), so the silent switch never mutes the coach's voice. It was set
 * by CuePlayer.unlock beside it until the voice clips were removed (D-038 item 3).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { unlockCoachAudio } from "../../src/features/coach-agent/audio/context";

describe("unlockCoachAudio and the iOS audio session (D-039 item 4)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sets playback from the default", () => {
    const nav = { audioSession: { type: "auto" } };
    vi.stubGlobal("navigator", nav);
    unlockCoachAudio();
    expect(nav.audioSession.type).toBe("playback");
  });

  it("leaves play-and-record while the microphone runs", () => {
    const nav = { audioSession: { type: "play-and-record" } };
    vi.stubGlobal("navigator", nav);
    unlockCoachAudio();
    expect(nav.audioSession.type).toBe("play-and-record");
  });

  it("never throws without an audio session or Web Audio", () => {
    vi.stubGlobal("navigator", {});
    expect(() => unlockCoachAudio()).not.toThrow();
  });
});
