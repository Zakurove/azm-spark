/**
 * D-026 item 5 and DG-7: the real gait host, C4's GaitController, runs through stream D's coach segment
 * (CoachSession with FakeLiveTransport and the fakes of tests/v7/d-coach-harness.ts), as the gait step
 * runs it: the controller's bridge events go to session.push, and the model's tool calls reach the
 * controller through D's executor (the S0-2 answer guard first). The 2.11 gait row: any mark_pain ends
 * the recording, the shared rule ends the test, and the coach can never pass a step the person or the
 * helper must tap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLiveTransport } from "../../src/features/coach-agent/fake";
import { CoachSession, type CoachDeps } from "../../src/features/coach-agent/session";
import { GaitController } from "../../src/features/gait/controller";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { walk } from "../fixtures/gait/gen-gait";
import { GAIT_CATALOG } from "../fixtures/gait/catalog";
import { FakeMic, FakeSpeaker, FakeVoice } from "./d-coach-harness";

const T0 = Date.UTC(2026, 9, 6, 9, 0, 0);
const CHECK = "0b6f1c1e-1d2a-4c8e-9a1b-2f3c4d5e6f70";
const PLAN: GaitPlan = {
  offered: true,
  modes: ["overground"],
  defaultMode: "overground",
  padAllowed: false,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: false,
  views: { overground: ["side"], walking_pad: [] },
};

function setup(painBefore: number | null) {
  const ctl = new GaitController({ plan: PLAN, painBefore, poseModel: () => "full" });
  const transports: FakeLiveTransport[] = [];
  const voice = new FakeVoice();
  const deps: CoachDeps = {
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
          expiresAt: new Date(now + 8 * 60_000).toISOString(),
          newSessionExpiresAt: new Date(now + 120_000).toISOString(),
          history: [{ role: "user", text: "[CTX block=gait segment=gait lang=ar helper=yes]" }],
          minutesLeft: 30,
        },
      };
    },
    report() {},
    transport() {
      const t = new FakeLiveTransport({ setupMs: 900 });
      transports.push(t);
      return t;
    },
    mic: () => new FakeMic(),
    speaker: () => new FakeSpeaker(),
    deviceId: () => "device_abcdefghijklmnop",
    tickMs: 50,
  };
  const session = new CoachSession(
    { block: "gait", segment: "gait", lang: "ar", ref: { checkId: CHECK }, host: ctl, local: voice },
    deps,
  );
  // The gait step hands every controller event to the segment (useCoach.push).
  ctl.onBridge((e) => session.push(e));
  const live = () => transports[transports.length - 1];
  const call = (id: string, name: string, args: unknown) =>
    live().emit({ type: "toolCall", calls: [{ id, name, args }] });
  const reply = (id: string) =>
    live()
      .sent.flatMap((s) => (s.kind === "toolResponse" ? s.responses : []))
      .find((r) => r.id === id)?.response;
  return { ctl, session, live, call, reply };
}

const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers({ now: T0 }));
afterEach(() => vi.useRealTimers());

/** The person walks: the setup taps, the standing, a few seconds of the first side pass. */
function walkABit(ctl: GaitController) {
  const t = performance.now();
  ctl.start(t);
  ctl.confirm(t);
  ctl.setGear({ shoes: true, brace: null }, t);
  ctl.confirm(t);
  ctl.confirm(t);
  const w = walk(GAIT_CATALOG.find((e) => e.name === "overground-side")!.spec);
  for (const f of [...w.standing, ...w.frames.slice(0, 120)])
    ctl.feed({ t: f.t, lm: f.lm, poses: [f.lm], aspect: f.aspect }, { rollDeg: 0 });
}

describe("the GaitController through D's coach segment (DG-7)", () => {
  it("ends the recording on a spoken pain below the rule and waits for the person's tap", async () => {
    const h = setup(3);
    h.session.start();
    await run(900);
    expect(h.session.getSnapshot().mode).toBe("live");
    walkABit(h.ctl);
    expect(h.ctl.current.id).toBe("walk");
    // The coach makes up a pain nobody spoke of: refused (S0-2), the walk goes on.
    h.call("c1", "mark_pain", { level: 4 });
    expect(h.reply("c1")).toMatchObject({ accepted: false, reason: "no_answer_heard" });
    expect(h.ctl.current.id).toBe("walk");
    // The person says it hurts, 4: the recording ends, a tap walks on.
    h.live().emit({ type: "inputTranscript", text: "يؤلمني قليلًا، أربعة", final: true });
    await run(400);
    h.call("c2", "mark_pain", { level: 4 });
    expect(h.reply("c2")).toEqual({ accepted: true, say: "pain_ok", data: { action: "recording_ended" } });
    expect(h.ctl.current.id).toBe("walk_again");
    h.call("c3", "next_step", {});
    expect(h.reply("c3")).toEqual({ accepted: false, reason: "not_allowed", say: "tap_to_confirm" });
    expect(h.ctl.current.id).toBe("walk_again");
    h.session.end("done");
  });

  it("ends the test at the shared rule, tells the coach first (P0), and nothing resumes", async () => {
    const h = setup(null);
    h.session.start();
    await run(900);
    walkABit(h.ctl);
    h.live().emit({ type: "inputTranscript", text: "ركبتي تؤلمني كثيرًا", final: true });
    await run(300);
    h.call("c1", "mark_pain", { level: 7 });
    expect(h.reply("c1")).toEqual({ accepted: true, say: "pain_stop", data: { action: "stop_test" } });
    expect(h.ctl.outcome).toBe("pain_limited");
    const p0 = h
      .live()
      .sent.flatMap((s) => (s.kind === "context" ? [s] : []))
      .find((s) => s.text.includes("type=safety_stop"));
    expect(p0?.turnComplete).toBe(true);
    h.call("c2", "resume", {});
    expect(h.reply("c2")).toMatchObject({ accepted: false, reason: "safety_stop" });
    h.session.end("done");
  });

  it("refuses next_step on the clear path, a confirm step", async () => {
    const h = setup(null);
    h.session.start();
    await run(900);
    const t = performance.now();
    h.ctl.start(t);
    h.ctl.confirm(t);
    h.ctl.setGear({ shoes: true, brace: null }, t);
    expect(h.ctl.current.id).toBe("clear_path");
    h.call("c1", "next_step", {});
    expect(h.reply("c1")).toEqual({ accepted: false, reason: "not_allowed", say: "tap_to_confirm" });
    expect(h.ctl.current.id).toBe("clear_path");
    h.session.end("done");
  });
});
