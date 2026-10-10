/**
 * D-036 items 1 and 2 (Nasser's third phone test of v7.2):
 *   - the Live coach presses the screen's own button when the person says they are ready, want to
 *     start, go on, see the next step or try again: next_step with the person's intent presses what
 *     the screen registered (ScreenActions), the same call as the tap, and answers what it pressed;
 *   - the answer guard (S0-2) takes a press only on the person's own words on that very screen: never
 *     the model on its own, never a second call after a press, never words said 10 s before;
 *   - it never presses Stop, an emergency action, a question, a pain score, the walking pad's safety
 *     checklist or a timer, and never anything over the stop list or a pain stop;
 *   - only the Live coach speaks: no phone speech anywhere in the app, and no recorded line while a
 *     Live coach session is on.
 * The range steps run on the real RomController, the walk on the real GaitController, and a coached
 * range block end to end on CoachSession with FakeLiveTransport (fake timers: Date.now is its clock).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AGAIN,
  COACH_INTENTS,
  GO_ON,
  NOTHING_TO_PRESS,
  PRESS_SAY,
  ScreenActions,
  pressNextStep,
} from "../../src/coach/actions";
import type { CoachHost, TransportEvent } from "../../src/coach/types";
import { RomController } from "../../src/features/focus/romController";
import { romScreenActions } from "../../src/features/focus/coachActions";
import { GaitController, STEP_KIND, type GaitStepId } from "../../src/features/gait/controller";
import { GAIT_PRESS, gaitScreenActions } from "../../src/features/gait/coachActions";
import { workoutButton } from "../../src/features/coach-agent/workoutCoach";
import { CoachSession, type CoachDeps } from "../../src/features/coach-agent/session";
import { FakeLiveTransport } from "../../src/features/coach-agent/fake";
import { SilentSpeaker } from "../../src/features/coach-agent/e2eCoach";
import { SILENT_VOICE } from "../../src/features/coach-agent/LocalVoice";
import type { ScreenEntry } from "../../src/features/coach-agent/useScreenActions";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { buildRomProtocol, type RomProtocol } from "../../src/medical/rom-protocol";
import { entry, intake, today } from "./a-fixtures";
import { runBlock } from "./b-shell-driver";
import { item as romItem } from "./b-driver";
import { fixtureFrames } from "../fixtures/format";
import { generate } from "../fixtures/gen";
import { romSpec } from "../fixtures/rom/build";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckRoot } from "../../src/features/assessment/shared/CheckRoot";
import { StopListScreen } from "../../src/features/focus/Screens";
import { setupLine } from "../../src/features/gait/copy";

/** The page's registration of a screen's buttons (useScreenActions), with the same key and alive. */
function register(actions: ScreenActions, e: ScreenEntry | null): void {
  if (e) actions.show(e.key, () => e.actions, e.alive);
}

/* ---------------------------------------------------------- the registry */

describe("ScreenActions: the buttons of the screen showing now", () => {
  const button = (name: string, intents = GO_ON, press: () => boolean | void = () => true) => ({
    name,
    intents,
    say: PRESS_SAY.starting,
    press,
  });

  it("presses the button that answers the intent and says what it pressed", () => {
    const a = new ScreenActions();
    const pressed: string[] = [];
    a.show("result", () => [
      button("again", AGAIN, () => void pressed.push("again")),
      button("next", GO_ON, () => void pressed.push("next")),
    ]);
    expect(a.press("again")).toEqual({ accepted: true, say: "starting", data: { pressed: "again" } });
    for (const intent of GO_ON) expect(a.press(intent)).toMatchObject({ data: { pressed: "next" } });
    expect(pressed).toEqual(["again", "next", "next", "next", "next"]);
  });

  it("presses nothing for an intent with no button, a waiting button or a button that could not act", () => {
    const a = new ScreenActions();
    expect(a.press("ready")).toEqual(NOTHING_TO_PRESS);
    expect(NOTHING_TO_PRESS).toEqual({ accepted: false, reason: "not_allowed", say: "tap_to_confirm" });
    a.show("setup", () => [button("ready")]);
    expect(a.press("again")).toEqual(NOTHING_TO_PRESS);
    a.show("setup", () => [{ ...button("ready"), waiting: true }]);
    expect(a.press("ready")).toEqual({ accepted: false, reason: "wrong_phase", say: "one_moment" });
    a.show("setup", () => [button("ready", GO_ON, () => false)]);
    expect(a.press("ready")).toEqual({ accepted: false, reason: "wrong_phase" });
    a.show("setup", () => [
      button("ready", GO_ON, () => {
        throw new Error("gone");
      }),
    ]);
    expect(a.press("ready")).toEqual({ accepted: false, reason: "not_allowed" });
  });

  it("is a new screen for a new key, the same for the same key, and gone once taken away or passed", () => {
    const a = new ScreenActions();
    expect(a.current).toBeNull();
    const offBlock = a.show("block", () => [button("ready")]);
    const block = a.current;
    expect(block).not.toBeNull();
    a.show("block", () => [button("ready")]);
    expect(a.current).toBe(block);
    let here = true;
    a.show(
      "setup",
      () => [button("ready")],
      () => here,
    );
    const setup = a.current;
    expect(setup).not.toBe(block);
    expect(a.key).toBe("setup");
    // The old screen's take away does not take the new one's.
    offBlock();
    expect(a.current).toBe(setup);
    // The app moved past the screen before the page took its buttons away: nothing to press.
    here = false;
    expect(a.current).toBeNull();
    expect(a.list()).toEqual([]);
    expect(a.press("ready")).toEqual(NOTHING_TO_PRESS);
  });

  it("never presses over a safety step or after a safety stop", () => {
    const a = new ScreenActions();
    const press = vi.fn(() => true);
    a.show("x", () => [button("ready", GO_ON, press)]);
    const refused = { accepted: false, reason: "safety_stop", say: "tap_to_confirm" };
    expect(pressNextStep(a, { step: { kind: "safety" }, stopped: false }, "ready")).toEqual(refused);
    expect(pressNextStep(a, { step: { kind: "info" }, stopped: true }, "ready")).toEqual(refused);
    expect(press).not.toHaveBeenCalled();
    expect(pressNextStep(a, { step: { kind: "confirm" }, stopped: false }, "ready")).toMatchObject({
      accepted: true,
    });
  });

  it("knows only the intents of going on and of trying again: never stop, pause, skip or an answer", () => {
    expect(COACH_INTENTS).toEqual(["ready", "start", "next", "continue", "again"]);
    expect(GO_ON).toEqual(["ready", "start", "next", "continue"]);
    expect(AGAIN).toEqual(["again"]);
  });
});

/* ------------------------------------------------------- the range steps */

const KNEE = intake({ regions: [entry("knee", "right", ["stiffness"])] });

function rom(block: "lying" | "seated" = "lying"): RomController {
  const protocol: RomProtocol = buildRomProtocol({ intake: KNEE, setting: "booth", today: today() });
  const ctl = new RomController({ protocol, painByRegion: {}, intake: KNEE, lang: "ar", restSec: 1 });
  ctl.startBlock(block, 0);
  return ctl;
}
const romButtons = (ctl: RomController, blockWaiting = false) =>
  romScreenActions(ctl, { clock: () => 1000, blockWaiting });
const names = (e: ScreenEntry | null) => e?.actions.map((a) => [a.name, [...a.intents]]) ?? null;

describe("the range steps' buttons (FocusApp)", () => {
  it("the block card's Ready, waiting for the camera's probe as its button does, then its tap", () => {
    const ctl = rom();
    expect(names(romButtons(ctl))).toEqual([["ready", GO_ON]]);
    expect(romButtons(ctl, true)!.actions[0].waiting).toBe(true);
    // Waiting: the press does nothing, as the disabled button.
    expect(romButtons(ctl, true)!.actions[0].press()).toBe(false);
    expect(ctl.current.kind).toBe("block");
    romButtons(ctl)!.actions[0].press();
    expect(ctl.current.kind).toBe("setup");
  });

  it("the setup card's Ready starts the movement, as the tap does", () => {
    const ctl = rom();
    ctl.ready(0);
    const e = romButtons(ctl)!;
    expect(e.key).toMatch(/^setup:knee_/);
    expect(names(e)).toEqual([["ready", GO_ON]]);
    expect(e.actions[0].say).toBe("starting");
    e.actions[0].press();
    expect(ctl.current.kind).toBe("measure");
    // The movement's own step is gone: the setup's press is stale.
    expect(e.alive!()).toBe(false);
  });

  it("the result card's Next, and its Try again only while one more try is offered", () => {
    const ctl = rom();
    runBlock(ctl, { until: (c) => c.current.kind === "result" }, 300);
    const e = romButtons(ctl)!;
    const want = ctl.canTryAgain
      ? [
          ["again", AGAIN],
          ["next", GO_ON],
        ]
      : [["next", GO_ON]];
    expect(names(e)).toEqual(want);
    e.actions.at(-1)!.press();
    expect(ctl.current.kind).not.toBe("result");
  });

  it("no button on a measurement, its questions and rests, a pain stop, the re-ask or the running sit minute", () => {
    const ctl = rom();
    const seen = new Set<string>();
    runBlock(
      ctl,
      {
        until: (c) => {
          const k = c.current.kind === "measure" ? `measure:${c.phase}` : c.current.kind;
          if (c.current.kind === "measure" || c.current.kind === "rest") {
            seen.add(k);
            expect(romButtons(c), k).toBeNull();
          }
          if (c.current.kind === "sit" && c.current.standing === undefined) {
            seen.add("sit");
            expect(romButtons(c)).toBeNull();
          }
          return c.current.kind === "sit" && c.current.standing !== undefined;
        },
      },
      400,
    );
    expect([...seen]).toEqual(expect.arrayContaining(["measure:calibrating", "measure:ask_max", "sit"]));
    // Once the minute is over, «متابعة».
    expect(names(romButtons(ctl))).toEqual([["next", GO_ON]]);
    // A pain stop and the re-ask after it.
    const pain = rom();
    runBlock(pain, { until: (c) => c.phase === "attempt" }, 300);
    pain.handleTool("mark_pain", { level: 8 });
    expect(pain.current.kind).toBe("pain_stop");
    expect(romButtons(pain)).toBeNull();
    pain.acknowledge(1);
    pain.next(2);
    expect(pain.current.kind).toBe("reask");
    expect(romButtons(pain)).toBeNull();
  });

  it("goes stale under the stop list", () => {
    const ctl = rom();
    const e = romButtons(ctl)!;
    ctl.requestStop(5);
    expect(e.alive!()).toBe(false);
  });
});

/* -------------------------------------------------------------- the walk */

const WALK: GaitPlan = {
  offered: true,
  modes: ["overground", "walking_pad"],
  defaultMode: "overground",
  padAllowed: true,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: false,
  views: {
    overground: ["front", "back", "side"],
    walking_pad: [{ view: "pad_side", nearSide: "right" }],
  },
};

function gait(): GaitController {
  const ctl = new GaitController({
    plan: WALK,
    painBefore: null,
    intake: { walking: { status: "without_aid" }, heightCm: 172, regions: [] },
    poseModel: () => "full",
    warmUpSec: 2,
  });
  ctl.start(1000);
  return ctl;
}

describe("the walk's buttons (GaitCapture)", () => {
  it("the setup's Start and Ready, I have finished, walk again, try once more or go on, a failed save and the result's Continue", () => {
    expect(Object.keys(GAIT_PRESS).sort()).toEqual(
      [
        "clear_path",
        "done",
        "intro",
        "nothing",
        "pad_on",
        "pad_start",
        "place",
        "retry",
        "save_error",
        "stance_place",
        "walk",
        "walk_again",
      ].sort(),
    );
    const retry = GAIT_PRESS.retry as readonly { name: string; intents: readonly string[] }[];
    expect(retry.map((p) => [p.name, p.intents])).toEqual([
      ["try_again", ["again", "ready", "start"]],
      ["go_on", ["next", "continue"]],
    ]);
    expect((GAIT_PRESS.walk as { intents: readonly string[] }).intents).toEqual(["next", "continue"]);
    expect((GAIT_PRESS.walk_again as { intents: readonly string[] }).intents).toEqual(["again", ...GO_ON]);
  });

  it("on the calm re-record, try again records once more and go on keeps what was recorded", () => {
    const retry = vi.fn((_again: boolean, _t: number) => true);
    const step = { id: "retry" as const, rec: "overground_side" as const };
    const ctl = { current: step, stopList: null, stopped: false, retry } as unknown as GaitController;
    const e = gaitScreenActions(ctl, () => 2000)!;
    const a = new ScreenActions();
    a.show(e.key, () => e.actions, e.alive);
    expect(a.press("again")).toMatchObject({ accepted: true, say: "trying_again" });
    expect(a.press("continue")).toMatchObject({ accepted: true, say: "continuing" });
    expect(retry.mock.calls).toEqual([
      [true, 2000],
      [false, 2000],
    ]);
  });

  it("while walking, «I have finished» reads the recording now", () => {
    const finishWalk = vi.fn((_t: number) => true);
    const step = { id: "walk" as const, rec: "overground_side" as const };
    const ctl = { current: step, stopList: null, stopped: false, finishWalk } as unknown as GaitController;
    const e = gaitScreenActions(ctl, () => 3000)!;
    const a = new ScreenActions();
    a.show(e.key, () => e.actions, e.alive);
    expect(a.press("again")).toMatchObject({ accepted: false });
    expect(a.press("next")).toMatchObject({ accepted: true, say: "continuing" });
    expect(finishWalk.mock.calls).toEqual([[3000]]);
  });

  it("never the pad's safety checklist or its stop, a question, a recording, a timer or a safety step", () => {
    const never: GaitStepId[] = [
      "pad_check",
      "pad_stop",
      "mode",
      "gear",
      "pad_details",
      "stand",
      "stance",
      "pad_warm_up",
      "saving",
      "pain_stop",
      "stopped",
    ];
    for (const id of never) expect(GAIT_PRESS[id], id).toBeUndefined();
    for (const id of Object.keys(GAIT_PRESS) as GaitStepId[]) expect(STEP_KIND[id], id).not.toBe("safety");
  });

  it("each press is the tap: the intro's Start, then the clear path's Ready", () => {
    const ctl = gait();
    expect(ctl.current.id).toBe("intro");
    const intro = gaitScreenActions(ctl, () => 1100)!;
    expect(names(intro)).toEqual([["start", GO_ON]]);
    expect(intro.actions[0].press()).toBe(true);
    expect(ctl.current.id).toBe("mode");
    expect(intro.alive!()).toBe(false);
    expect(gaitScreenActions(ctl, () => 1100)).toBeNull();
    ctl.chooseMode("overground", 1200);
    ctl.setGear({ shoes: true, brace: null }, 1300);
    expect(ctl.current.id).toBe("clear_path");
    gaitScreenActions(ctl, () => 1400)!.actions[0].press();
    expect(ctl.current.id).toBe("place");
    expect(names(gaitScreenActions(ctl, () => 1500))).toEqual([["ready", GO_ON]]);
  });

  it("the pad's safety checklist shows no button for the coach, and nothing shows under the stop list", () => {
    const ctl = gait();
    ctl.confirm(1100);
    ctl.chooseMode("walking_pad", 1200);
    ctl.setGear({ shoes: true, brace: null }, 1300);
    expect(ctl.current.id).toBe("pad_check");
    expect(gaitScreenActions(ctl, () => 1400)).toBeNull();
    ctl.confirm(1400);
    expect(ctl.current.id).toBe("place");
    const place = gaitScreenActions(ctl, () => 1500)!;
    ctl.requestStop(1500);
    expect(place.alive!()).toBe(false);
    expect(gaitScreenActions(ctl, () => 1600)).toBeNull();
  });
});

/* ----------------------------------------------------------- the workout */

describe("the workout's buttons (Workout and CoachedWorkout)", () => {
  it("Start training, Next set and Finish once their timer ran out, and Exit; never the setup's attestation", () => {
    const press = () => undefined;
    expect(workoutButton("setup", 0, press)).toBeNull();
    expect(workoutButton("intro", 0, press)?.name).toBe("start");
    expect(workoutButton("warmup", 30, press)).toBeNull();
    expect(workoutButton("warmup", 0, press)?.name).toBe("start");
    expect(workoutButton("rest", 12, press)).toBeNull();
    expect(workoutButton("rest", 0, press)?.name).toBe("next_set");
    expect(workoutButton("cooldown", 60, press)).toBeNull();
    expect(workoutButton("cooldown", 0, press)?.name).toBe("finish");
    expect(workoutButton("done", 0, press)?.name).toBe("exit");
    // A camera set and a guided card keep their own controls (the set offers its own Continue).
    expect(workoutButton("set", 0, press)).toBeNull();
    expect(workoutButton("card", 0, press)).toBeNull();
  });

  it("offers a camera set's Continue program only after the summary, never after its safety stop", () => {
    const src = readFileSync(join(__dirname, "../../src/app/Session.tsx"), "utf8");
    expect(src).toMatch(/const canGoOn = end === "summary" && !trial && !safetyStop && !!props\.onContinue;/);
  });
});

/* ------------------------------------------- a coached range block, end to end */

const T0 = Date.UTC(2026, 9, 10, 9, 0, 0);
const CHECK = "0b6f1c1e-1d2a-4c8e-9a1b-2f3c4d5e6f70";

function coached(host: CoachHost) {
  const transports: FakeLiveTransport[] = [];
  const holds: boolean[] = [];
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
          expiresAt: new Date(now + 12 * 60_000).toISOString(),
          newSessionExpiresAt: new Date(now + 120_000).toISOString(),
          history: [
            { role: "user", text: "[CTX block=rom segment=rom:lying:1 lang=ar helper=no]" },
            { role: "model", text: "جاهز." },
          ],
          minutesLeft: 30,
        },
      };
    },
    report: () => undefined,
    transport() {
      const t = new FakeLiveTransport({ setupMs: 300 });
      transports.push(t);
      return t;
    },
    mic: () => null,
    speaker: () => new SilentSpeaker(() => Date.now()),
    deviceId: () => "device_abcdefghijklmnop",
    holdVoice: (on) => holds.push(on),
    tickMs: 50,
  };
  const session = new CoachSession(
    {
      block: host.block,
      segment: "rom:lying:1",
      lang: "ar",
      ref: { checkId: CHECK },
      host,
      local: SILENT_VOICE,
    },
    deps,
  );
  const live = () => transports.at(-1)!;
  const emit = (e: TransportEvent) => live().emit(e);
  const said = (text: string) => emit({ type: "inputTranscript", text, final: true });
  const call = (id: string, name: string, args: unknown) =>
    emit({ type: "toolCall", calls: [{ id, name, args }] });
  const reply = (id: string) =>
    live()
      .sent.flatMap((s) => (s.kind === "toolResponse" ? s.responses : []))
      .find((r) => r.id === id)?.response;
  return { session, holds, said, call, reply };
}

describe("a coached range block: the person says «جاهز» and the coach presses Ready (D-036 item 2)", () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  it("presses the block's and the setup's Ready on the person's words only, and the flow advances", async () => {
    const ctl = rom();
    const show = () => register(ctl.actions, romScreenActions(ctl, { clock: () => 0, blockWaiting: false }));
    show();
    const h = coached(ctl);
    h.session.start();
    await vi.advanceTimersByTimeAsync(400);
    expect(h.session.getSnapshot().mode).toBe("live");

    // The model on its own: refused, the block card stays.
    h.call("own", "next_step", { intent: "ready" });
    expect(h.reply("own")).toEqual({ accepted: false, reason: "no_answer_heard", say: "ask_and_wait" });
    expect(ctl.current.kind).toBe("block");

    // «جاهز»: the block card's Ready is pressed, the movement's setup card shows.
    h.said("جاهز");
    h.call("ready1", "next_step", { intent: "ready" });
    expect(h.reply("ready1")).toEqual({ accepted: true, say: "starting", data: { pressed: "ready" } });
    expect(ctl.current.kind).toBe("setup");

    // A second call at once, before the page shows the setup's buttons: nothing is pressed.
    h.call("dup", "next_step", { intent: "ready" });
    expect(h.reply("dup")).toMatchObject({ accepted: false });
    show();
    // The words were said on the block card: they never press the setup's Ready.
    h.call("dup2", "next_step", { intent: "ready" });
    expect(h.reply("dup2")).toEqual({ accepted: false, reason: "no_answer_heard", say: "ask_and_wait" });
    expect(ctl.current.kind).toBe("setup");

    // «يلا»: the setup's Ready starts the movement.
    h.said("يلا نبدأ");
    h.call("start", "next_step", { intent: "start" });
    expect(h.reply("start")).toMatchObject({ accepted: true, say: "starting" });
    expect(ctl.current.kind).toBe("measure");

    // The coach's stop opens the stop list; no press ever goes over it.
    h.said("أبي أوقف");
    h.call("stop", "stop", { reason: "choice" });
    expect(h.reply("stop")).toMatchObject({ accepted: true, say: "tap_to_confirm" });
    expect(ctl.stopList).not.toBeNull();
    h.said("كمّل");
    h.call("over", "next_step", { intent: "continue" });
    expect(h.reply("over")).toMatchObject({ accepted: false });
    expect(ctl.stopList).not.toBeNull();
    h.session.end("done");
  });

  it("holds the recorded voice while the session is on, and lets it go at the end", async () => {
    const ctl = rom();
    const h = coached(ctl);
    h.session.start();
    await vi.advanceTimersByTimeAsync(400);
    expect(h.holds).toEqual([true]);
    h.session.end("done");
    expect(h.holds).toEqual([true, false]);
  });
});

/* ------------------------------- the screens carry what only a voice said */

describe("the screens carry the lines no voice says any more (D-036 item 1)", () => {
  it("shows the range runner's view correction as the camera's caption", () => {
    const base = romSpec({
      name: "rom/d036/side-view",
      movement: "shoulder_abduction",
      position: "seated",
      side: "right",
      aspect: "16:9",
      peak: 140,
      fps: 30,
    });
    // The arm raise to the side filmed from its side: the runner says «face the phone» once.
    const frames = fixtureFrames(generate({ ...base, subject: { ...base.subject, yaw: -90 } }));
    const protocol: RomProtocol = {
      rulesVersion: "test",
      items: [romItem("shoulder_abduction", "right", { block: "seated", position: "seated" })],
      deferred: [],
      notMeasured: [],
      sitBeforeStand: false,
    };
    const ctl = new RomController({ protocol, painByRegion: {}, intake: null, lang: "en" });
    ctl.startBlock("seated", frames[0].t);
    ctl.ready(frames[0].t);
    ctl.ready(frames[0].t);
    expect(ctl.current.kind).toBe("measure");
    const captions = new Set<string>();
    for (const f of frames) {
      ctl.feed(f, { rollDeg: 0 });
      if (ctl.caption) captions.add(ctl.caption);
      if (ctl.current.kind !== "measure") break;
    }
    expect([...captions]).toContain("check_face_phone");
  });

  it("puts the walking pad's stop line on the stop list (GaitCapture hands it to the shell)", () => {
    const list = (note: string | null) =>
      renderToStaticMarkup(
        createElement(CheckRoot, {
          ui: { lang: "en" },
          page: false,
          className: "fx",
          children: createElement(StopListScreen, {
            lang: "en",
            env: { setting: "home", ctx: { conditions: [], support: "none" } } as never,
            preselect: null,
            note,
            onChoose: () => undefined,
          }),
        }),
      );
    const line = setupLine("pad_stop", "en");
    expect(line).toBe("Hold the support, and your helper will stop the pad.");
    expect(list(line)).toContain('data-note="safety"');
    expect(list(line)).toContain(line);
    expect(list(null)).not.toContain('data-note="safety"');
    const capture = readFileSync(join(__dirname, "../../src/features/gait/GaitCapture.tsx"), "utf8");
    expect(capture).toMatch(/if \(line === "gait_pad_stop"\) padStop\.current = true;/);
    expect(capture).toMatch(/setupLine\("pad_stop", lang\)/);
    const shell = readFileSync(join(__dirname, "../../src/features/focus/FocusApp.tsx"), "utf8");
    expect(shell).toMatch(/note=\{walkStopNote\}/);
  });
});

/* -------------------------------------------- no phone speech, anywhere */

describe("no phone speech anywhere in the app (D-036 item 1)", () => {
  const SRC = join(__dirname, "../../src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|js|mjs)$/.test(f) ? [p] : [];
    });

  it("has no speechSynthesis and no SpeechSynthesisUtterance in src", () => {
    const found = files(SRC).filter((p) => /speechSynthesis|SpeechSynthesis/.test(readFileSync(p, "utf8")));
    expect(found).toEqual([]);
  });

  it("has no phone voice module left", () => {
    const left = files(SRC).filter((p) => /phoneVoice|booth\/speech\.ts$/.test(p));
    expect(left).toEqual([]);
  });
});
