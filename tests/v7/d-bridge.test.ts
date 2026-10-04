/**
 * Stream D, step D4: the event bridge (product v7 contract 2.11 EventBridge, bridge rules 1 to 5 and
 * the "two P1 events without coach audio" trigger of rule 6; 8.6). The transport records what is sent,
 * the local voice is a fake that plays until the test ends its line, and every time is explicit.
 */
import { describe, expect, it, vi } from "vitest";
import { EventBridge, LOCAL_ASK, P0_LINE } from "../../src/features/coach-agent/bridge";
import { BRIDGE_DEFAULTS, MIC_REOPEN_MS, formatEvent } from "../../src/coach/events";
import type { BridgeEvent, CoachMode, LocalVoice } from "../../src/coach/types";
import type { Severity } from "../../src/engine/types";

const T0 = 50_000;

class FakeVoice implements LocalVoice {
  said: { line: string; severity: Severity }[] = [];
  private fns = new Set<(p: boolean) => void>();
  private active = 0;
  get playing() {
    return this.active > 0;
  }
  say(line: string, severity: Severity) {
    this.said.push({ line, severity });
    this.active++;
    if (this.active === 1) for (const fn of this.fns) fn(true);
  }
  /** The line playing now ends. */
  end() {
    if (this.active === 0) return;
    this.active--;
    if (this.active === 0) for (const fn of this.fns) fn(false);
  }
  stopAll() {
    this.active = 1;
    this.end();
  }
  onPlaying(fn: (p: boolean) => void) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
}

function setup(mode: CoachMode = "live") {
  let clock = T0;
  const sent: { text: string; turnComplete: boolean; at: number }[] = [];
  const transport = {
    sendContext: (text: string, turnComplete: boolean) => sent.push({ text, turnComplete, at: clock }),
    audioStreamEnd: vi.fn(),
  };
  const local = new FakeVoice();
  const hooks = {
    now: () => clock,
    flushCoach: vi.fn(),
    micGate: vi.fn(),
    duck: vi.fn(),
    onFallback: vi.fn(),
    onAskedLocally: vi.fn(),
    onFirstAudio: vi.fn(),
  };
  const bridge = new EventBridge(transport, local, {}, hooks);
  bridge.setMode(mode);
  const at = (ms: number) => {
    clock = T0 + ms;
    return clock;
  };
  /** Ticks every 50 ms up to `ms` after T0. */
  const run = (ms: number) => {
    for (let t = clock - T0 + 50; t <= ms; t += 50) bridge.tick(at(t));
  };
  const line = (e: BridgeEvent) => formatEvent(e, T0);
  return { bridge, sent, transport, local, hooks, at, run, line };
}

const hold = (t: number): BridgeEvent => ({
  p: 1,
  type: "end_range_hold",
  holdId: "h1",
  movement: "shoulder_flexion",
  side: "right",
  deg: 118,
  typical: 166,
  t,
});
const askPain = (t: number): BridgeEvent => ({
  p: 1,
  type: "ask_pain",
  movement: "knee_flexion",
  side: "left",
  t,
});
const stop = (t: number): BridgeEvent => ({ p: 0, type: "safety_stop", reason: "pain_stop", t });
const saved = (t: number): BridgeEvent => ({
  p: 3,
  type: "attempt_saved",
  movement: "shoulder_flexion",
  side: "right",
  deg: 117,
  t,
});
const reps = (t: number, count: number, exercise = "sit_to_stand"): BridgeEvent => ({
  p: 3,
  type: "reps",
  exercise,
  count,
  target: 10,
  t,
});
const lean = (t: number): BridgeEvent => ({ p: 2, type: "compensation", kind: "trunk_lean", value: 14, t });

describe("rule 1: a P0 acts first and closes the bridge to all but P0", () => {
  it("flushes the coach, says the local stop line, then sends the event with turnComplete true", () => {
    const s = setup();
    s.bridge.push(saved(T0 + 10), s.at(10));
    s.bridge.push(stop(T0 + 100), s.at(100));
    expect(s.hooks.flushCoach).toHaveBeenCalledTimes(1);
    expect(s.local.said).toEqual([{ line: P0_LINE, severity: "safety" }]);
    expect(P0_LINE).toBe("stop_rest");
    // The context waiting goes first, silently, then the stop.
    expect(s.sent).toEqual([
      { text: s.line(saved(T0 + 10)), turnComplete: false, at: T0 + 100 },
      { text: s.line(stop(T0 + 100)), turnComplete: true, at: T0 + 100 },
    ]);
  });

  it("leaves the host's own safety line alone", () => {
    const s = setup();
    s.local.say("rom_pain_stop", "safety");
    s.bridge.push(stop(T0), s.at(0));
    expect(s.local.said.map((x) => x.line)).toEqual(["rom_pain_stop"]);
  });

  it("is sent at once even right after a P1, and cancels the question's local fallback", () => {
    const s = setup();
    s.bridge.push(hold(T0), s.at(0));
    s.bridge.push(stop(T0 + 300), s.at(300));
    expect(s.sent.map((x) => x.turnComplete)).toEqual([true, true]);
    s.run(5000);
    expect(s.local.said.map((x) => x.line)).toEqual([P0_LINE]);
  });

  it("passes only P0 until the app reopens it", () => {
    const s = setup();
    s.bridge.push(stop(T0), s.at(0));
    s.local.end();
    s.bridge.push(hold(T0 + 2500), s.at(2500));
    s.bridge.push(lean(T0 + 2600), s.at(2600));
    s.bridge.push(saved(T0 + 2700), s.at(2700));
    s.run(9000);
    expect(s.sent).toHaveLength(1);
    expect(s.local.said).toHaveLength(1);
    s.bridge.push({ p: 0, type: "red_flag", screen: "scr_emergency", t: T0 + 9100 }, s.at(9100));
    expect(s.sent).toHaveLength(2);
    s.bridge.reopen(s.at(9200));
    s.bridge.push(askPain(T0 + 11_500), s.at(11_500));
    expect(s.sent.at(-1)).toMatchObject({ text: s.line(askPain(T0 + 11_500)), turnComplete: true });
  });

  it("speaks the stop line in local mode too, and sends nothing", () => {
    const s = setup("local");
    s.bridge.push(stop(T0), s.at(0));
    expect(s.local.said).toEqual([{ line: P0_LINE, severity: "safety" }]);
    expect(s.sent).toEqual([]);
  });
});

describe("rule 2: a P1 question goes to the coach, and to the local voice when the coach is late", () => {
  it("sends the question with turnComplete true and stays quiet when the coach speaks in time", () => {
    const s = setup();
    s.bridge.push(hold(T0), s.at(0));
    expect(s.sent).toEqual([{ text: s.line(hold(T0)), turnComplete: true, at: T0 }]);
    s.run(700);
    s.bridge.coachSpeaking(true, s.at(700));
    s.run(5000);
    expect(s.local.said).toEqual([]);
    expect(s.hooks.onFirstAudio).toHaveBeenCalledWith(700);
  });

  it("asks with the local voice 1.5 s after the question and tells the coach silently", () => {
    const s = setup();
    expect(BRIDGE_DEFAULTS.localFallbackMs).toBe(1500);
    s.bridge.push(hold(T0), s.at(0));
    s.run(1450);
    expect(s.local.said).toEqual([]);
    s.run(1500);
    expect(s.local.said).toEqual([{ line: "rom_ask_max", severity: "warn" }]);
    expect(s.hooks.onAskedLocally).toHaveBeenCalledTimes(1);
    expect(s.sent.at(-1)).toEqual({
      text: formatEvent({ p: 3, type: "asked_locally", what: "ask_max", t: T0 + 1500 }, T0),
      turnComplete: false,
      at: T0 + 1500,
    });
    // Late coach audio does not count as the coach voicing it.
    s.bridge.coachSpeaking(true, s.at(1600));
    expect(s.hooks.onFirstAudio).not.toHaveBeenCalled();
  });

  it("maps every question to its local line and asked_locally name", () => {
    expect(LOCAL_ASK).toEqual({
      end_range_hold: { line: "rom_ask_max", what: "ask_max" },
      ask_pain: { line: "rom_pain_ask", what: "ask_pain" },
      ask_cause: { line: "rom_what_stopped_ask", what: "ask_cause" },
      ask_can_move: { line: "rom_can_move_ask", what: "ask_can_move" },
    });
    const s = setup("local");
    s.bridge.push({ p: 1, type: "ask_can_move", movement: "neck_flexion", side: "none", t: T0 }, s.at(0));
    s.bridge.push({ p: 1, type: "ask_cause", movement: "neck_flexion", side: "none", t: T0 + 10 }, s.at(10));
    expect(s.local.said.map((x) => x.line)).toEqual(["rom_can_move_ask", "rom_what_stopped_ask"]);
  });

  it("asks at once in local mode and sends nothing", () => {
    const s = setup("local");
    s.bridge.push(askPain(T0), s.at(0));
    expect(s.local.said).toEqual([{ line: "rom_pain_ask", severity: "warn" }]);
    s.run(6000);
    expect(s.sent).toEqual([]);
  });

  it("while connecting, sends the question when the session goes live in time", () => {
    const s = setup("connecting");
    s.bridge.push(hold(T0), s.at(0));
    s.run(900);
    expect(s.sent).toEqual([]);
    s.bridge.setMode("live");
    expect(s.sent).toEqual([{ text: s.line(hold(T0)), turnComplete: true, at: T0 + 900 }]);
    // The person waits from the hold, so the coach still has to speak by 1.5 s after it.
    s.run(1300);
    s.bridge.coachSpeaking(true, s.at(1300));
    s.run(3000);
    expect(s.local.said).toEqual([]);
    expect(s.hooks.onFirstAudio).toHaveBeenCalledWith(400);
  });

  it("while connecting, asks locally at 1.5 s and tells the coach silently once live", () => {
    const s = setup("connecting");
    s.bridge.push(hold(T0), s.at(0));
    s.run(1500);
    expect(s.local.said.map((x) => x.line)).toEqual(["rom_ask_max"]);
    s.at(2200);
    s.bridge.setMode("live");
    expect(s.sent).toEqual([
      {
        text: [
          s.line(hold(T0)),
          formatEvent({ p: 3, type: "asked_locally", what: "ask_max", t: T0 + 1500 }, T0),
        ].join("\n"),
        turnComplete: false,
        at: T0 + 2200,
      },
    ]);
  });
});

describe("rule 3: corrections are local, the coach hears them silently, and the mic closes", () => {
  it("sends a P2 at once with turnComplete false and never speaks it", () => {
    const s = setup();
    s.bridge.push(lean(T0), s.at(0));
    expect(s.sent).toEqual([{ text: s.line(lean(T0)), turnComplete: false, at: T0 }]);
    expect(s.local.said).toEqual([]);
  });

  it("closes the mic and ends the audio stream while a local line plays, and reopens it 300 ms after", () => {
    const s = setup();
    expect(MIC_REOPEN_MS).toBe(300);
    s.local.say("rom_no_lean", "warn");
    expect(s.hooks.micGate).toHaveBeenLastCalledWith(false);
    expect(s.transport.audioStreamEnd).toHaveBeenCalledTimes(1);
    expect(s.hooks.duck).toHaveBeenLastCalledWith(true);
    expect(s.bridge.micOpen).toBe(false);
    s.at(1000);
    s.local.end();
    expect(s.hooks.duck).toHaveBeenLastCalledWith(false);
    s.bridge.tick(s.at(1299));
    expect(s.bridge.micOpen).toBe(false);
    s.bridge.tick(s.at(1300));
    expect(s.bridge.micOpen).toBe(true);
    expect(s.hooks.micGate).toHaveBeenLastCalledWith(true);
  });

  it("keeps the mic closed when another line starts within the 300 ms", () => {
    const s = setup();
    s.local.say("rom_no_lean", "warn");
    s.at(1000);
    s.local.end();
    s.at(1200);
    s.local.say("rom_keep_back", "warn");
    s.bridge.tick(s.at(1400));
    expect(s.bridge.micOpen).toBe(false);
    s.at(2000);
    s.local.end();
    s.bridge.tick(s.at(2300));
    expect(s.bridge.micOpen).toBe(true);
    expect(s.hooks.micGate.mock.calls.map((c) => c[0])).toEqual([false, true]);
  });
});

describe("rule 4: context is coalesced every 5 s, silently", () => {
  it("joins the P3 lines of 5 s into one silent send", () => {
    const s = setup();
    s.bridge.push(saved(T0 + 100), s.at(100));
    s.bridge.push({ p: 3, type: "step_start", label: "shoulder_flexion_right", t: T0 + 200 }, s.at(200));
    s.run(4950);
    expect(s.sent).toEqual([]);
    s.run(5000);
    expect(s.sent).toEqual([
      {
        text: [
          s.line(saved(T0 + 100)),
          s.line({ p: 3, type: "step_start", label: "shoulder_flexion_right", t: T0 + 200 }),
        ].join("\n"),
        turnComplete: false,
        at: T0 + 5000,
      },
    ]);
  });

  it("never sends a rep count to start a turn, and keeps only the latest count of an exercise", () => {
    const s = setup();
    for (let i = 1; i <= 6; i++) s.bridge.push(reps(T0 + i * 400, i), s.at(i * 400));
    s.bridge.push(reps(T0 + 2600, 2, "wall_push"), s.at(2600));
    s.run(5000);
    expect(s.sent).toEqual([
      {
        text: [s.line(reps(T0 + 2400, 6)), s.line(reps(T0 + 2600, 2, "wall_push"))].join("\n"),
        turnComplete: false,
        at: T0 + 5000,
      },
    ]);
  });
});

describe("rule 5: at most one model triggering event per 2 s, P0 exempt, P1 first", () => {
  it("holds a second question until 2 s after the first", () => {
    const s = setup();
    s.bridge.push(hold(T0), s.at(0));
    s.bridge.coachSpeaking(true, s.at(600));
    s.bridge.push(askPain(T0 + 1000), s.at(1000));
    expect(s.sent.filter((x) => x.turnComplete)).toHaveLength(1);
    s.run(1950);
    expect(s.sent.filter((x) => x.turnComplete)).toHaveLength(1);
    s.run(2000);
    expect(s.sent.filter((x) => x.turnComplete).map((x) => x.at)).toEqual([T0, T0 + 2000]);
  });

  it("sends the context waiting before the question, so the question comes last", () => {
    const s = setup();
    s.bridge.push(saved(T0 + 100), s.at(100));
    s.bridge.push(hold(T0 + 400), s.at(400));
    expect(s.sent.map((x) => x.turnComplete)).toEqual([false, true]);
    expect(s.sent[1].text).toBe(s.line(hold(T0 + 400)));
  });

  it("counts no P2, P3 or rep as a triggering event", () => {
    const s = setup();
    for (let i = 0; i < 20; i++) {
      s.bridge.push(reps(T0 + i * 200, i + 1), s.at(i * 200));
      s.bridge.push(lean(T0 + i * 200 + 50), s.at(i * 200 + 50));
    }
    s.run(10_000);
    expect(s.sent.filter((x) => x.turnComplete)).toEqual([]);
  });
});

describe("rule 6: two questions without coach audio fall back to the local voice", () => {
  it("reports fallback_slow at the second question the coach did not voice", () => {
    const s = setup();
    s.bridge.push(hold(T0), s.at(0));
    s.run(1500);
    expect(s.hooks.onFallback).not.toHaveBeenCalled();
    s.bridge.push(askPain(T0 + 4000), s.at(4000));
    s.run(5500);
    expect(s.hooks.onFallback).toHaveBeenCalledWith("fallback_slow");
  });

  it("starts the count again when the coach voices a question", () => {
    const s = setup();
    s.bridge.push(hold(T0), s.at(0));
    s.run(1500);
    s.bridge.push(askPain(T0 + 4000), s.at(4000));
    s.bridge.coachSpeaking(true, s.at(4600));
    s.run(8000);
    s.bridge.push(hold(T0 + 9000), s.at(9000));
    s.run(10_600);
    expect(s.hooks.onFallback).not.toHaveBeenCalled();
  });
});

describe("modes", () => {
  it("does nothing while off", () => {
    const s = setup("off");
    s.bridge.push(stop(T0), s.at(0));
    s.bridge.push(hold(T0 + 10), s.at(10));
    s.local.say("rom_no_lean", "warn");
    s.run(6000);
    expect(s.sent).toEqual([]);
    expect(s.local.said.map((x) => x.line)).toEqual(["rom_no_lean"]);
    expect(s.hooks.flushCoach).not.toHaveBeenCalled();
    expect(s.hooks.micGate).not.toHaveBeenCalled();
  });

  it("asks an open question at once when the session falls back to local", () => {
    const s = setup();
    s.bridge.push(hold(T0), s.at(0));
    s.at(600);
    s.bridge.setMode("local");
    expect(s.local.said.map((x) => x.line)).toEqual(["rom_ask_max"]);
    s.run(6000);
    expect(s.sent).toHaveLength(1);
  });

  it("keeps the corrections and context of a connecting session for when it is live", () => {
    const s = setup("connecting");
    s.bridge.push(lean(T0), s.at(0));
    s.bridge.push(saved(T0 + 100), s.at(100));
    expect(s.sent).toEqual([]);
    s.at(800);
    s.bridge.setMode("live");
    expect(s.sent).toEqual([
      { text: [s.line(lean(T0)), s.line(saved(T0 + 100))].join("\n"), turnComplete: false, at: T0 + 800 },
    ]);
  });

  it("stops listening to the local voice when disposed", () => {
    const s = setup();
    s.bridge.dispose();
    s.local.say("rom_no_lean", "warn");
    expect(s.hooks.micGate).not.toHaveBeenCalled();
  });
});
