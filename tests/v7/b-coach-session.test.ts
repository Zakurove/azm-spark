/**
 * D-026 item 5 (change log DG-7): the real range host, the focus RomController, runs through stream D's
 * coach segment (CoachSession with FakeLiveTransport and the fakes of tests/v7/d-coach-harness.ts),
 * as the shell will once D5 wires useCoach: the controller's bridge events go to session.push, and the
 * model's tool calls reach the controller through D's executor (the S0-2 answer guard first).
 *
 * D's coach code is built on its own branch (wt/v7-d): its modules are loaded at run time and these
 * tests are skipped while they are absent, so this branch compiles alone and the tests run as soon as
 * the two streams meet (the merge, or the integration tree).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeEvent, ToolResult } from "../../src/coach/types";
import { RomController } from "../../src/features/focus/romController";
import { buildRomProtocol } from "../../src/medical/rom-protocol";
import { entry, intake, today } from "./a-fixtures";
import { bridges, runBlock } from "./b-shell-driver";

/* D's modules, loaded by path so this file compiles without them. */
interface SentLike {
  kind: string;
  text?: string;
  turnComplete?: boolean;
  responses?: { id: string; name: string; response: ToolResult }[];
}
interface TransportLike {
  sent: SentLike[];
  emit(e: unknown): void;
}
interface SessionLike {
  start(): void;
  push(e: BridgeEvent): void;
  end(reason: string): void;
  getSnapshot(): { mode: string };
}
type Ctor<T> = new (...args: never[]) => T;
interface DModules {
  CoachSession: new (opts: unknown, deps: unknown) => SessionLike;
  FakeLiveTransport: new (script?: unknown) => TransportLike;
  FakeMic: Ctor<object>;
  FakeSpeaker: Ctor<object>;
  FakeVoice: Ctor<{ said: { line: string }[] }>;
}

const load = async (path: string): Promise<Record<string, unknown> | null> => {
  try {
    return (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

let D: DModules | null = null;
beforeAll(async () => {
  const [session, fake, harness] = await Promise.all([
    load("../../src/features/coach-agent/session"),
    load("../../src/features/coach-agent/fake"),
    load("./d-coach-harness"),
  ]);
  if (session && fake && harness)
    D = {
      CoachSession: session.CoachSession as DModules["CoachSession"],
      FakeLiveTransport: fake.FakeLiveTransport as DModules["FakeLiveTransport"],
      FakeMic: harness.FakeMic as DModules["FakeMic"],
      FakeSpeaker: harness.FakeSpeaker as DModules["FakeSpeaker"],
      FakeVoice: harness.FakeVoice as DModules["FakeVoice"],
    };
});

const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);
const CHECK = "0b6f1c1e-1d2a-4c8e-9a1b-2f3c4d5e6f70";
const KNEE = intake({ regions: [entry("knee", "right", ["stiffness"])] });
const KNEE_BEND = { movement: "knee_flexion" as const, side: "right" as const };

function setup(d: DModules) {
  const ctl = new RomController({
    protocol: buildRomProtocol({ intake: KNEE, setting: "booth", today: today() }),
    painByRegion: {},
    intake: KNEE,
    lang: "ar",
    restSec: 1,
  });
  const transports: TransportLike[] = [];
  const voice = new d.FakeVoice();
  const session = new d.CoachSession(
    { block: "rom", segment: "rom:lying:1", lang: "ar", ref: { checkId: CHECK }, host: ctl, local: voice },
    {
      now: () => Date.now(),
      wallNow: () => Date.now(),
      online: () => true,
      async mint() {
        const now = Date.now();
        return {
          ok: true,
          serverDate: now,
          token: {
            sessionId: "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
            token: "auth_tokens/t1",
            model: "gemini-3.8-live",
            apiVersion: "v1beta",
            voice: "Achird",
            expiresAt: new Date(now + 12 * 60_000).toISOString(),
            newSessionExpiresAt: new Date(now + 120_000).toISOString(),
            history: [{ role: "user", text: "[CTX block=rom segment=rom:lying:1 lang=ar helper=yes]" }],
            minutesLeft: 30,
          },
        };
      },
      report() {},
      transport() {
        const t = new d.FakeLiveTransport({ setupMs: 900 });
        transports.push(t);
        return t;
      },
      mic: () => new d.FakeMic(),
      speaker: () => new d.FakeSpeaker(),
      deviceId: () => "device_abcdefghijklmnop",
      tickMs: 50,
    },
  );
  const live = () => transports[transports.length - 1];
  /** The controller's events for the coach, as the shell hands them to useCoach.push. */
  const pipe = (events: BridgeEvent[]) => events.forEach((e) => session.push(e));
  const call = (id: string, name: string, args: unknown) =>
    live().emit({ type: "toolCall", calls: [{ id, name, args }] });
  const reply = (id: string) =>
    live()
      .sent.filter((s) => s.kind === "toolResponse")
      .flatMap((s) => s.responses ?? [])
      .find((r) => r.id === id)?.response;
  return { ctl, session, voice, live, pipe, call, reply };
}

const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers({ now: T0 }));
afterEach(() => vi.useRealTimers());

describe("the RomController through D's coach segment (DG-7)", () => {
  it("records the person's spoken yes at the hold, through the answer guard and the executor", async (ctx) => {
    if (!D) return ctx.skip();
    const h = setup(D);
    h.ctl.startBlock("lying", 0);
    h.session.start();
    await run(900);
    expect(h.session.getSnapshot().mode).toBe("live");
    // The person bends the knee to the first scored hold; the hold's P1 goes to the coach.
    const toHold = runBlock(
      h.ctl,
      { answerMax: () => null, until: (c) => c.phase === "ask_max" && c.attempt.index === 1 },
      300,
    );
    const p1 = bridges(toHold.events).filter((e) => e.type === "end_range_hold");
    h.pipe(p1.slice(-1));
    const asked = h
      .live()
      .sent.filter((s) => s.kind === "context")
      .at(-1)!;
    expect(asked.turnComplete).toBe(true);
    expect(asked.text).toContain("type=end_range_hold mv=knee_flexion side=right");
    // A yes the coach makes up before the person spoke is refused (S0-2) and the question stays open.
    h.call("c1", "confirm_max", { ...KNEE_BEND, answer: "yes" });
    expect(h.reply("c1")).toMatchObject({ accepted: false, reason: "no_answer_heard" });
    expect(h.ctl.phase).toBe("ask_max");
    // The person says yes; the coach's call records the hold.
    const deg = h.ctl.hold!.deg;
    h.live().emit({ type: "inputTranscript", text: "نعم", final: true });
    await run(800);
    h.call("c2", "confirm_max", { ...KNEE_BEND, answer: "yes" });
    expect(h.reply("c2")).toEqual({ accepted: true, say: "recorded", data: { recorded: true, deg } });
    expect(h.ctl.attempt.valid).toBe(1);
    expect(h.ctl.phase).toBe("rest");
    h.session.end("done");
  });

  it("refuses next_step on a confirmation and pauses only an active step; a spoken pain stops the movement", async (ctx) => {
    if (!D) return ctx.skip();
    const h = setup(D);
    h.ctl.startBlock("lying", 0);
    h.session.start();
    await run(900);
    h.call("c1", "next_step", {});
    expect(h.reply("c1")).toEqual({ accepted: false, reason: "not_allowed", say: "tap_to_confirm" });
    expect(h.ctl.current.kind).toBe("block");
    runBlock(h.ctl, { until: (c) => c.phase === "attempt" }, 120);
    h.live().emit({ type: "inputTranscript", text: "يؤلمني كثيرًا", final: true });
    await run(500);
    h.call("c2", "mark_pain", { level: 7 });
    expect(h.reply("c2")).toMatchObject({
      accepted: true,
      say: "pain_stop",
      data: { action: "stop_movement" },
    });
    expect(h.ctl.current.kind).toBe("pain_stop");
    h.call("c3", "resume", {});
    expect(h.reply("c3")).toMatchObject({ accepted: false });
    h.session.end("done");
  });
});
