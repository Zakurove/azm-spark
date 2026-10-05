/**
 * Stream D, step D4: the coach's client parts around the session (product v7 contract 5.1, 5.2,
 * 2.11 LocalVoice and useCoach, bridge rule 3): the token request and the usage report as the routes
 * expect them (fetch with keepalive and X-Azm-Request, never sendBeacon), the install's device id, the
 * local voice over CuePlayer (playing from the request to the end of the line, for the mic gate), the
 * audio session hunk of app/audio.ts, and useCoach's states before a session exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEVICE_KEY,
  coachDeviceId,
  mintCoachToken,
  sendUsageReport,
} from "../../src/features/coach-agent/api";
import { CueVoice, type CueLike } from "../../src/features/coach-agent/LocalVoice";
import { CoachSession } from "../../src/features/coach-agent/session";
import { E2E_COACH_SESSION_ID, SilentSpeaker, e2eCoachDeps } from "../../src/features/coach-agent/e2eCoach";
import {
  setCoachAudioSession,
  useCoach,
  userTiming,
  type CoachControl,
} from "../../src/features/coach-agent/useCoach";
import { CuePlayer } from "../../src/app/audio";
import type { TokenRequest, TokenResponse, UsageReport } from "../../server/modules/agent/types";
import type { CoachOptions } from "../../src/coach/types";
import { FakeVoice, RefRomHost } from "./d-coach-harness";

const REQ: TokenRequest = {
  block: "rom",
  segment: "rom:seated:1",
  lang: "ar",
  ref: { checkId: "0b6f1c1e-1d2a-4c8e-9a1b-2f3c4d5e6f70" },
  deviceId: "device_abcdefghijklmnop",
};
const TOKEN: TokenResponse = {
  sessionId: "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  token: "auth_tokens/abc",
  model: "gemini-3.8-live",
  apiVersion: "v1beta",
  voice: "Achird",
  expiresAt: "2026-10-04T09:12:00.000Z",
  newSessionExpiresAt: "2026-10-04T09:02:00.000Z",
  history: [
    { role: "user", text: "[CTX block=rom]" },
    { role: "model", text: "جاهز." },
  ],
  minutesLeft: 30,
};
const REPORT: UsageReport = {
  sessionId: TOKEN.sessionId,
  connectMs: 900,
  durationSec: 60,
  turns: 3,
  toolCalls: { confirm_max: { ok: 1, rejected: 0 } },
  promptTokens: 4000,
  responseTokens: 300,
  firstAudioMs: { p50: 650, p90: 800 },
  endReason: "done",
};

function response(status: number, body: unknown, date: string | null = "Sun, 04 Oct 2026 09:00:00 GMT") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === "date" ? date : null) },
    json: async () => body,
  } as unknown as Response;
}

describe("POST /api/agent/token from the phone (5.1)", () => {
  it("sends the request as JSON with X-Azm-Request and reads the server's Date", async () => {
    const fetchImpl = vi.fn(async () => response(200, TOKEN));
    const r = await mintCoachToken(REQ, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("/api/agent/token", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Azm-Request": "1" },
      body: JSON.stringify(REQ),
    });
    expect(r).toEqual({ ok: true, token: TOKEN, serverDate: Date.UTC(2026, 9, 4, 9, 0, 0) });
  });

  it("passes a refusal's status and code, and turns a broken answer or no network into a failure", async () => {
    const refused = await mintCoachToken(REQ, (async () =>
      response(429, { error: "BUDGET", minutesLeft: 0 })) as unknown as typeof fetch);
    expect(refused).toEqual({ ok: false, status: 429, error: "BUDGET" });
    const broken = await mintCoachToken(REQ, (async () =>
      response(200, { ...TOKEN, token: "not a token", history: [] })) as unknown as typeof fetch);
    expect(broken).toEqual({ ok: false, status: 502, error: "TOKEN_FAILED" });
    const offline = await mintCoachToken(REQ, (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch);
    expect(offline).toEqual({ ok: false, status: 0, error: "NETWORK" });
    const noDate = await mintCoachToken(REQ, (async () =>
      response(200, TOKEN, null)) as unknown as typeof fetch);
    expect(noDate).toMatchObject({ ok: true, serverDate: null });
  });
});

describe("POST /api/agent/usage from the phone (5.2)", () => {
  it("is a fetch with keepalive, same origin credentials and the X-Azm-Request header", () => {
    const fetchImpl = vi.fn(async () => response(200, { ok: true }));
    sendUsageReport(REPORT, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("/api/agent/usage", {
      method: "POST",
      keepalive: true,
      credentials: "same-origin",
      headers: { "X-Azm-Request": "1", "Content-Type": "application/json" },
      body: JSON.stringify(REPORT),
    });
  });

  it("never throws, and never uses sendBeacon", async () => {
    const beacon = vi.fn();
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    expect(() =>
      sendUsageReport(REPORT, (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch),
    ).not.toThrow();
    await Promise.resolve();
    expect(beacon).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("the device id (5.1 deviceId)", () => {
  it("is random per install, 16 to 64 of [A-Za-z0-9_-], and kept", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    };
    const id = coachDeviceId(storage);
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(data.get(DEVICE_KEY)).toBe(id);
    expect(coachDeviceId(storage)).toBe(id);
    data.set(DEVICE_KEY, "bad id!");
    const fresh = coachDeviceId(storage);
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(fresh).not.toBe(id);
  });

  it("still gives one id for the page when storage throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const a = coachDeviceId(broken);
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(coachDeviceId(broken)).toBe(a);
  });
});

/* ---------------------------------------------------- the local voice */

class FakePlayer implements CueLike {
  calls: { id: string; severity: string; onEnd?: () => void; started: (v: boolean) => void }[] = [];
  stops = 0;
  line(id: string, severity: "praise" | "info" | "warn" | "safety" = "info", onEnd?: () => void) {
    return new Promise<boolean>((started) => this.calls.push({ id, severity, onEnd, started }));
  }
  stop() {
    this.stops++;
  }
}

describe("CueVoice, the local voice over CuePlayer", () => {
  it("plays from the request to the end of the line, for the mic gate", async () => {
    const player = new FakePlayer();
    const voice = new CueVoice(player as unknown as CueLike);
    const seen: boolean[] = [];
    voice.onPlaying((p) => seen.push(p));
    voice.say("rom_ask_max", "warn");
    expect(voice.playing).toBe(true);
    expect(seen).toEqual([true]);
    expect(player.calls.map((c) => [c.id, c.severity])).toEqual([["rom_ask_max", "warn"]]);
    player.calls[0].started(true);
    await Promise.resolve();
    expect(voice.playing).toBe(true);
    player.calls[0].onEnd?.();
    expect(voice.playing).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it("ends a line the player refused, ignores unknown lines and says a playing line once", async () => {
    const player = new FakePlayer();
    const voice = new CueVoice(player as unknown as CueLike);
    voice.say("not_a_line", "info");
    expect(player.calls).toEqual([]);
    voice.say("rom_no_lean", "warn");
    voice.say("rom_no_lean", "warn");
    expect(player.calls).toHaveLength(1);
    player.calls[0].started(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(voice.playing).toBe(false);
  });

  it("keeps playing while a newer line plays after an older one was cut", async () => {
    const player = new FakePlayer();
    const voice = new CueVoice(player as unknown as CueLike);
    voice.say("rom_ask_max", "warn");
    voice.say("stop_rest", "safety");
    player.calls[0].onEnd?.();
    expect(voice.playing).toBe(true);
    player.calls[1].onEnd?.();
    expect(voice.playing).toBe(false);
  });

  it("stops every line", () => {
    const player = new FakePlayer();
    const voice = new CueVoice(player as unknown as CueLike);
    voice.say("rom_ask_max", "warn");
    voice.stopAll();
    expect(player.stops).toBe(1);
    expect(voice.playing).toBe(false);
  });
});

/* ------------------------------------------- the audio session (rule 3) */

describe("the audio session while the coach is live", () => {
  let nav: { audioSession: { type: string } };
  beforeEach(() => {
    nav = { audioSession: { type: "auto" } };
    vi.stubGlobal("navigator", nav);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is play-and-record while live and playback after", () => {
    setCoachAudioSession(true);
    expect(nav.audioSession.type).toBe("play-and-record");
    setCoachAudioSession(false);
    expect(nav.audioSession.type).toBe("playback");
  });

  it("is left alone by CuePlayer.unlock while the coach is live, and set to playback otherwise", () => {
    setCoachAudioSession(true);
    CuePlayer.unlock();
    expect(nav.audioSession.type).toBe("play-and-record");
    setCoachAudioSession(false);
    nav.audioSession.type = "auto";
    CuePlayer.unlock();
    expect(nav.audioSession.type).toBe("playback");
  });
});

/* ------------------------------------------------- the perf overlay */

describe("the coach's timings for the perf overlay (DG-1)", () => {
  afterEach(() => performance.clearMeasures());

  it("are User Timing measures named azm:*, which the overlay reads, and never throw", () => {
    const start = performance.now();
    userTiming("azm:coach_connect", start, 900);
    const [entry] = performance.getEntriesByName("azm:coach_connect", "measure");
    expect(entry.startTime).toBeCloseTo(start, 6);
    expect(entry.duration).toBeCloseTo(900, 6);
    expect(() => userTiming("azm:coach_first_audio", Number.NaN, -1)).not.toThrow();
    expect(performance.getEntriesByName("azm:coach_first_audio", "measure")).toEqual([]);
  });
});

/* ---------------------------------------------------------- useCoach */

describe("useCoach before a session exists", () => {
  function render(opts: CoachOptions | null): CoachControl {
    let out: CoachControl | null = null;
    function Probe() {
      out = useCoach(opts);
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    return out!;
  }

  it("is off with null options, and its functions do nothing", () => {
    const c = render(null);
    expect(c.mode).toBe("off");
    expect(c.speaking).toBe(false);
    expect(c.captions).toEqual([]);
    expect(() => {
      c.push({ p: 0, type: "safety_stop", reason: "user_stop", t: 0 });
      c.reopen();
      c.end("done");
    }).not.toThrow();
  });

  it("is connecting with options, before its effect starts the segment", () => {
    const c = render({
      block: "rom",
      segment: "rom:seated:1",
      lang: "ar",
      ref: { checkId: "0b6f1c1e-1d2a-4c8e-9a1b-2f3c4d5e6f70" },
      host: new RefRomHost(),
      local: new FakeVoice(),
    });
    expect(c.mode).toBe("connecting");
  });
});

/* ------------------------------------------------------- the e2e coach */

describe("the e2e coach (?e2eCoach=fake, VITE_E2E builds; D-026 item 8)", () => {
  it("mints the session the e2e seed writes and sends its usage report to the route", async () => {
    const hooks: Record<string, unknown> = {};
    const reports: UsageReport[] = [];
    const deps = e2eCoachDeps({ hooks, listen: () => () => undefined, report: (r) => reports.push(r) });
    const host = new RefRomHost();
    const session = new CoachSession(
      { block: "rom", segment: "rom:seated:1", lang: "ar", ref: REQ.ref, host, local: new FakeVoice() },
      deps,
    );
    session.start();
    await vi.waitFor(() => expect(session.getSnapshot().mode).toBe("live"), { timeout: 2000 });
    // The fake coach is driven from a spec through window.e2eCoach.
    const e2e = hooks.e2eCoach as { sent(): { kind: string }[] };
    expect(e2e.sent()[0]).toMatchObject({ kind: "history" });
    session.end("done");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ sessionId: E2E_COACH_SESSION_ID, endReason: "done" });
    // A row id the usage route takes (5.2).
    expect(E2E_COACH_SESSION_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("plays nothing through a silent speaker that is busy for as long as the chunks last", async () => {
    vi.useFakeTimers();
    try {
      const s = new SilentSpeaker(() => Date.now());
      const idle = vi.fn();
      s.onIdle(idle);
      s.play(new ArrayBuffer(48_000 * 0.5));
      expect(s.playing).toBe(true);
      vi.advanceTimersByTime(499);
      expect(s.playing).toBe(true);
      vi.advanceTimersByTime(1);
      expect(s.playing).toBe(false);
      expect(idle).toHaveBeenCalledTimes(1);
      s.play(new ArrayBuffer(48_000));
      s.flush();
      expect(s.playing).toBe(false);
      expect(idle).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
