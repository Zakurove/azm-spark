/**
 * D-037 item 1 (Nasser's fourth real test: he stands far from the phone and cannot read it, and the
 * coach pressed the buttons but never said the instructions): the say lines. Each range and walk step
 * hands the coach the screen's own words (the setup with the side or the front to the phone, the
 * movement, the corrections, the walk's setup, instruction and count), and the bridge sends them with
 * turnComplete true once the coach is free (bridge rule 9), so the coach says them without being asked.
 * Tests: the line's format, the bridge's timing, the RomController's and the GaitController's lines on
 * each step, and a whole coach segment (CoachSession on FakeLiveTransport) with the real range host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAY_TEXT_MAX, SAY_TIMING, formatEvent, sayText, triggersTurn } from "../../src/coach/events";
import type { BridgeEvent, CoachMode, CoachSay } from "../../src/coach/types";
import { EventBridge } from "../../src/features/coach-agent/bridge";
import { FakeLiveTransport } from "../../src/features/coach-agent/fake";
import { CoachSession, type CoachDeps } from "../../src/features/coach-agent/session";
import { romScreenActions } from "../../src/features/focus/coachActions";
import { romFacing, setupLines } from "../../src/features/focus/coachSay";
import { lineText } from "../../src/features/focus/copy";
import { RomController, SETUP_SAY_AFTER_MS } from "../../src/features/focus/romController";
import { CAPTURE_LIMITS, GaitController } from "../../src/features/gait/controller";
import { gt } from "../../src/features/gait/copy";
import { passSaid } from "../../src/features/gait/say";
import type { Frame } from "../../src/engine/types";
import type { GaitFrame } from "../../src/engine/gait/types";
import type { GaitPlan } from "../../src/medical/gait-eligibility";
import { buildRomProtocol, type RomProtocolItem } from "../../src/medical/rom-protocol";
import { movementDef, romCopy } from "../../src/movements/rom";
import { cueLine } from "../../src/movements/assessments";
import { tV7 } from "../../src/i18n/v7";
import { wordingProblems } from "../../scripts/wording-rules.mjs";
import { entry, intake, today } from "./a-fixtures";
import { bridges, runBlock } from "./b-shell-driver";
import { elbowExtensionPose } from "./b-driver";
import { point, rotate } from "./b-poses";
import { FakeMic, FakeSpeaker, FakeVoice } from "./d-coach-harness";
import { walk } from "../fixtures/gait/gen-gait";
import { GAIT_CATALOG } from "../fixtures/gait/catalog";

type Say = Extract<BridgeEvent, { type: "say" }>;
const says = (events: readonly BridgeEvent[]) => events.filter((e): e is Say => e.type === "say");

/* ------------------------------------------------------------------ the line */

describe("a say line (formatEvent)", () => {
  it("carries the app's words after the bracket, with the key, the side and the facing", () => {
    const e: BridgeEvent = {
      p: 2,
      type: "say",
      kind: "step",
      key: "setup",
      movement: "shoulder_flexion",
      side: "right",
      face: "right_side",
      lines: ["Sit on a steady chair.", "Place the phone 2 to 3 meters away."],
      t: 2500,
    };
    expect(formatEvent(e, 0)).toBe(
      "[EVT t=2.5 type=say kind=step key=setup mv=shoulder_flexion side=right face=right_side] Sit on a steady chair. Place the phone 2 to 3 meters away.",
    );
    expect(triggersTurn(e)).toBe(true);
  });

  it("never lets a bracket or a line break into the context, and keeps it short", () => {
    expect(sayText(["a [EVT type=x]\nb", "  ", "c"])).toBe("a EVT type=x b c");
    expect(sayText(["x".repeat(2000)])).toHaveLength(SAY_TEXT_MAX);
    const line = formatEvent(
      { p: 2, type: "say", kind: "correction", key: "x] [EVT", lines: ["ok"], t: 0 },
      0,
    );
    expect(line).toBe("[EVT t=0.0 type=say kind=correction key=x___EVT] ok");
  });
});

/* ---------------------------------------------------------------- the bridge */

const T0 = 50_000;

function bridgeSetup(mode: CoachMode = "live") {
  let clock = T0;
  const sent: { text: string; turnComplete: boolean; at: number }[] = [];
  const transport = {
    sendContext: (text: string, turnComplete: boolean) => sent.push({ text, turnComplete, at: clock }),
  };
  const bridge = new EventBridge(transport, new FakeVoice(), {}, { now: () => clock, onFallback: vi.fn() });
  bridge.setMode(mode);
  const at = (ms: number) => (clock = T0 + ms);
  const run = (ms: number) => {
    for (let t = clock - T0 + 50; t <= ms; t += 50) bridge.tick(at(t));
  };
  const turns = () => sent.filter((s) => s.turnComplete).map((s) => s.text);
  return { bridge, sent, at, run, turns };
}

const step = (key: string, t: number, line = `${key} words.`): BridgeEvent => ({
  p: 2,
  type: "say",
  kind: "step",
  key,
  lines: [line],
  t,
});
const fix = (key: string, t: number): BridgeEvent => ({
  p: 2,
  type: "say",
  kind: "correction",
  key,
  lines: [`${key}.`],
  t,
});
const count = (n: number, t: number): BridgeEvent => ({
  p: 2,
  type: "say",
  kind: "progress",
  key: `pass_${n}`,
  lines: [`Pass ${n} of 4`],
  t,
});
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

describe("bridge rule 9: say lines go with turnComplete true once the coach is free", () => {
  it("a step's line goes at once to a free coach, after the waiting context", () => {
    const s = bridgeSetup();
    s.bridge.push({ p: 3, type: "step_start", label: "setup", t: T0 + 10 }, s.at(10));
    s.bridge.push(step("setup", T0 + 20), s.at(20));
    expect(s.sent).toEqual([
      { text: "[EVT t=0.0 type=step_start label=setup]", turnComplete: false, at: T0 + 20 },
      { text: "[EVT t=0.0 type=say kind=step key=setup] setup words.", turnComplete: true, at: T0 + 20 },
    ]);
  });

  it("waits while the coach speaks, and for the coach's reply to a tool call or to the person", () => {
    const s = bridgeSetup();
    s.bridge.coachSpeaking(true, s.at(0));
    s.bridge.push(step("setup", T0), s.at(10));
    s.run(1000);
    expect(s.turns()).toEqual([]);
    s.bridge.coachSpeaking(false, s.at(1100));
    s.run(1200);
    expect(s.turns()).toHaveLength(1);
    // A tool call (a press that opened the next step): its reply plays first.
    s.at(4000);
    s.bridge.awaitReply(T0 + 4000);
    s.bridge.push(step("move", T0 + 4000), T0 + 4000);
    s.run(4600);
    s.bridge.coachSpeaking(true, s.at(4700));
    s.run(6000);
    expect(s.turns()).toHaveLength(1);
    s.bridge.coachSpeaking(false, s.at(6100));
    s.run(6200);
    expect(s.turns()).toEqual([
      "[EVT t=0.0 type=say kind=step key=setup] setup words.",
      "[EVT t=4.0 type=say kind=step key=move] move words.",
    ]);
  });

  it("a reply that never comes holds a line at most SAY_TIMING.replyWaitMs", () => {
    const s = bridgeSetup();
    s.bridge.awaitReply(s.at(0));
    s.bridge.push(step("setup", T0), s.at(0));
    s.run(SAY_TIMING.replyWaitMs - 100);
    expect(s.turns()).toEqual([]);
    s.run(SAY_TIMING.replyWaitMs + 100);
    expect(s.turns()).toHaveLength(1);
  });

  it("keeps rule 5's 2 s between its own turns; a question never waits for a say line, and drops it", () => {
    const s = bridgeSetup();
    s.bridge.push(step("setup", T0), s.at(0));
    expect(s.turns()).toHaveLength(1);
    // The coach said the setup; a correction 1 s later waits for the 2 s gap.
    s.bridge.push(fix("check_face_phone", T0 + 1000), s.at(1000));
    expect(s.turns()).toHaveLength(1);
    // The question comes at once all the same, and the correction waiting is dropped.
    s.bridge.push(hold(T0 + 1200), s.at(1200));
    expect(s.turns().at(-1)).toContain("type=end_range_hold");
    s.run(8000);
    expect(s.turns()).toHaveLength(2);
  });

  it("a line waits for a question not voiced yet, and goes once the coach has asked it", () => {
    const s = bridgeSetup();
    s.bridge.push(hold(T0), s.at(0));
    s.bridge.push(step("rest", T0 + 100), s.at(100));
    s.run(1000);
    expect(s.turns()).toHaveLength(1);
    s.bridge.coachSpeaking(true, s.at(1100));
    s.bridge.coachSpeaking(false, s.at(2500));
    s.run(2600);
    expect(s.turns().at(-1)).toContain("type=say kind=step key=rest");
  });

  it("never says the same correction again within SAY_TIMING.correctionRepeatMs, and drops a stale one", () => {
    const s = bridgeSetup();
    s.bridge.push(fix("check_face_phone", T0), s.at(0));
    s.run(3000);
    s.bridge.push(fix("check_face_phone", T0 + 3000), s.at(3000));
    s.run(SAY_TIMING.correctionRepeatMs - 100);
    expect(s.turns()).toHaveLength(1);
    s.bridge.push(
      fix("check_face_phone", T0 + SAY_TIMING.correctionRepeatMs + 100),
      s.at(SAY_TIMING.correctionRepeatMs + 100),
    );
    expect(s.turns()).toHaveLength(2);
    // Another correction while the coach speaks, longer than it may wait: dropped.
    s.bridge.coachSpeaking(true, s.at(14_000));
    s.bridge.push(fix("check_phone_still", T0 + 14_000), s.at(14_000));
    s.run(14_000 + SAY_TIMING.correctionStaleMs + 100);
    s.bridge.coachSpeaking(false, s.at(19_000));
    s.run(20_000);
    expect(s.turns()).toHaveLength(2);
  });

  it("says the walk's count only if the coach is free at once; the step's line goes before it", () => {
    const s = bridgeSetup();
    s.bridge.coachSpeaking(true, s.at(0));
    s.bridge.push(count(2, T0), s.at(0));
    s.run(SAY_TIMING.progressStaleMs + 100);
    s.bridge.coachSpeaking(false, s.at(3000));
    s.run(3100);
    expect(s.turns()).toEqual([]);
    s.bridge.coachSpeaking(true, s.at(4000));
    s.bridge.push(count(3, T0 + 4000), s.at(4000));
    s.bridge.push(step("walk", T0 + 4000), s.at(4000));
    s.bridge.coachSpeaking(false, s.at(4500));
    s.run(4600);
    expect(s.turns()).toEqual(["[EVT t=4.0 type=say kind=step key=walk] walk words."]);
  });

  it("a new step drops the last step's line; while connecting the latest waits for the coach", () => {
    const s = bridgeSetup("connecting");
    s.bridge.push(step("block_seated", T0), s.at(0));
    s.bridge.push({ p: 3, type: "step_start", label: "setup", t: T0 + 100 }, s.at(100));
    s.bridge.push(step("setup", T0 + 100), s.at(100));
    expect(s.turns()).toEqual([]);
    s.at(900);
    s.bridge.setMode("live");
    expect(s.turns()).toEqual(["[EVT t=0.1 type=say kind=step key=setup] setup words."]);
  });

  it("says nothing in local mode or after a safety stop (the screens carry every line)", () => {
    const local = bridgeSetup("local");
    local.bridge.push(step("setup", T0), local.at(0));
    local.run(5000);
    expect(local.sent).toEqual([]);
    const s = bridgeSetup();
    s.bridge.coachSpeaking(true, s.at(0));
    s.bridge.push(step("setup", T0), s.at(0));
    s.bridge.push({ p: 0, type: "safety_stop", reason: "user_stop", t: T0 + 100 }, s.at(100));
    s.bridge.coachSpeaking(false, s.at(200));
    s.bridge.push(step("move", T0 + 300), s.at(300));
    s.run(8000);
    expect(s.turns()).toEqual(["[EVT t=0.1 type=safety_stop reason=user_stop]"]);
  });
});

/* ------------------------------------------------------------- the range host */

const SHOULDER = intake({ regions: [entry("shoulder", "right", ["stiffness"])] });
const ELBOW = intake({ regions: [entry("elbow", "right", ["stiffness"])] });

function rom(h: ReturnType<typeof intake>, lang: "ar" | "en" = "en") {
  return new RomController({
    protocol: buildRomProtocol({ intake: h, setting: "booth", today: today() }),
    painByRegion: {},
    intake: h,
    lang,
    restSec: 1,
  });
}

describe("the range steps hand the coach their words (RomController)", () => {
  it("the block's card, then each setup with its side to the phone, its distance, then the movement", () => {
    for (const lang of ["en", "ar"] as const) {
      const ctl = rom(SHOULDER, lang);
      ctl.startBlock("seated", 0);
      const block = says(bridges(ctl.drain()));
      expect(block).toEqual([expect.objectContaining({ kind: "step", key: "block_seated" })]);
      expect(block[0].lines[0]).toBe(tV7(lang, "rom.block.seatedTitle"));
      expect(ctl.explain()).toMatchObject({ key: "block_seated" });
      ctl.ready(100);
      const s = ctl.current;
      expect(s.kind).toBe("setup");
      if (s.kind !== "setup") return;
      const def = movementDef(s.item.movementId);
      const setup = says(bridges(ctl.drain()));
      expect(setup).toHaveLength(1);
      expect(setup[0]).toMatchObject({
        kind: "step",
        key: "setup",
        movement: s.item.movementId,
        side: s.item.side,
        face: romFacing(def, s.item.side),
      });
      // The data's own setup lines, side filled: the position, the facing and the phone's distance.
      expect(setup[0].lines).toEqual(setupLines(s.item, lang));
      const words = setup[0].lines.join(" ");
      expect(words).not.toMatch(/\{side/);
      if (def.view === "side" && s.item.side === "right")
        expect(words).toContain(lang === "ar" ? "جانبك الأيمن نحو الهاتف" : "right side");
      if (def.view === "front") expect(words).toMatch(lang === "ar" ? /واجه|مواجه/ : /facing the phone|face/);
      expect(words).toMatch(lang === "ar" ? /أمتار|متر/ : /meters? away|metres? away/);
      const { t: _t, ...line } = setup[0];
      expect(ctl.explain()).toEqual(line);
      // Ready: the measurement, with the movement itself.
      ctl.ready(200);
      const move = says(bridges(ctl.drain()));
      expect(move[0]).toMatchObject({ kind: "step", key: "move", movement: s.item.movementId });
      expect(move[0].lines[0]).toBe(tV7(lang, "rom.measure.start"));
      expect(move[0].lines).toContain(tV7(lang, "rom.measure.move"));
      expect(move[0].lines.at(-1)).toBe(romCopy("practice")[lang]);
      // Never a number of degrees, never a dash.
      for (const e of [...block, ...setup, ...move]) {
        expect(e.lines.join(" ")).not.toMatch(/°|degree|درجة/);
        for (const l of e.lines) expect(wordingProblems(l), l).toEqual([]);
      }
    }
  });

  it("every movement and position: a setup with its facing and its distance, a movement without its setup", () => {
    for (const def of [
      movementDef("shoulder_abduction"),
      movementDef("hip_flexion"),
      movementDef("knee_extension"),
    ])
      for (const position of def.positions.map((p) => p.id))
        for (const lang of ["ar", "en"] as const) {
          const item = { movementId: def.id, side: "left", position } as RomProtocolItem;
          const lines = setupLines(item, lang).join(" ");
          if (def.view === "front") expect(romFacing(def, "left")).toBe("phone");
          else expect(romFacing(def, "left")).toBe("left_side");
          expect(lines, `${def.id} ${position} ${lang}`).toMatch(
            lang === "ar" ? /متر|أمتار/ : /\d metres|\d meters/,
          );
          if (def.variantInstructions?.[position as keyof typeof def.variantInstructions])
            expect(lines).toContain(cueLine("check_left_side_to_phone")[lang]);
        }
    expect(romFacing(movementDef("trunk_flexion"), "none")).toBe("side");
  });

  it("the turn to the other side comes first on the setup of the other side", () => {
    const both = intake({ regions: [entry("elbow", "both", ["stiffness"])] });
    const ctl = rom(both);
    ctl.startBlock("seated", 0);
    const run = runBlock(ctl, { until: (c) => c.current.kind === "setup" && c.current.turnSide }, 400);
    const last = says(bridges(run.events))
      .filter((e) => e.key === "setup")
      .at(-1)!;
    expect(last.lines[0]).toBe(romCopy("turn_side").en);
    expect(last.face).toBe(last.side === "left" ? "left_side" : "right_side");
  });

  it("the rest after the practice and the next try are said; the hold is a question, never a say line", () => {
    const ctl = rom(SHOULDER);
    ctl.startBlock("seated", 0);
    const run = runBlock(ctl, { until: (c) => c.current.kind === "result" }, 200);
    const events = bridges(run.events);
    const keys = says(events).map((e) => e.key);
    expect(keys.slice(0, 5)).toEqual(["block_seated", "setup", "move", "rest", "again"]);
    expect(says(events).find((e) => e.key === "again")!.lines[0]).toBe(romCopy("again").en);
    // The question comes after the next try's line, never as one.
    const ask = events.findIndex((e) => e.type === "end_range_hold");
    expect(ask).toBeGreaterThan(events.findIndex((e) => e.type === "say" && e.key === "again"));
  });

  it("a correction the caption shows is said once (D-036 item 8's «only if asked» reversed)", () => {
    const ctl = rom(ELBOW);
    ctl.startBlock("seated", 0);
    let from = Infinity;
    const run = runBlock(
      ctl,
      {
        // The upper arm moves forward in the first scored try of elbow straightening.
        pose: (item, lack, t, c) => {
          if (item.movementId !== "elbow_extension") return null;
          if (c.phase === "attempt" && c.attempt.index === 1 && lack <= 60 && from === Infinity)
            from = t + 500;
          const px = elbowExtensionPose(lack);
          return t >= from ? rotate(px, [14, 16, 18, 20, 22], point(px, 12), -14) : px;
        },
        until: (c) => c.caption !== null,
      },
      200,
    );
    const fixes = says(bridges(run.events)).filter((e) => e.kind === "correction");
    expect(fixes).toEqual([
      expect.objectContaining({
        kind: "correction",
        key: ctl.caption,
        lines: [lineText(ctl.caption!, "en")],
      }),
    ]);
  });

  it("a setup issue is said once it lasts SETUP_SAY_AFTER_MS, never a passing one", () => {
    const ctl = rom(SHOULDER);
    ctl.startBlock("seated", 0);
    let seenAt: number | null = null;
    const run = runBlock(
      ctl,
      {
        people: (lm, _t, c) =>
          c.phase === "calibrating" ? [lm, lm.map((p) => ({ ...p, x: p.x + 0.04 }))] : [lm],
        at: (t, c) => {
          if (c.setupIssue !== null && seenAt === null) seenAt = t;
        },
        until: (c) => c.phase === "practice",
      },
      30,
    );
    const said = bridges(run.events).filter((e) => e.type === "say" && e.kind === "correction");
    expect(said).toEqual([
      // D-038 item 2: about the person only, never anyone else in the picture.
      expect.objectContaining({
        key: "unclear",
        lines: ["One moment, we’ll go on when we can see you clearly"],
      }),
    ]);
    expect(said[0].t - seenAt!).toBeGreaterThanOrEqual(SETUP_SAY_AFTER_MS - 100);
  });
});

/* ------------------------------------------------------------------- the walk */

const WALK_PLAN: GaitPlan = {
  offered: true,
  modes: ["overground"],
  defaultMode: "overground",
  padAllowed: false,
  helperRequired: false,
  antalgicOnly: false,
  staticStance: false,
  views: { overground: ["side"], walking_pad: [] },
};

function gait(lang: "ar" | "en" | null = "en") {
  const ctl = new GaitController({
    plan: WALK_PLAN,
    painBefore: null,
    intake: { walking: { status: "without_aid" }, heightCm: 172, regions: [] },
    poseModel: () => "full",
    ...(lang ? { lang } : {}),
  });
  const events: BridgeEvent[] = [];
  ctl.onBridge((e) => events.push(e));
  return { ctl, events };
}

const camera = (frames: readonly GaitFrame[], base: number): Frame[] =>
  frames.map((f) => ({ t: base + (f.t - frames[0].t), lm: f.lm, poses: [f.lm], aspect: f.aspect }));

describe("the walk hands the coach its words (GaitController)", () => {
  it("the phone's place, the stand and the walk across, side on to the phone; the count now and then", () => {
    const { ctl, events } = gait();
    let t = 1000;
    ctl.start(t);
    expect(says(events)[0]).toMatchObject({ key: "intro" });
    expect(says(events)[0].lines[0]).toContain("4 times");
    while (ctl.current.id !== "place" && t < 9000) {
      if (ctl.current.id === "gear") ctl.setGear({ shoes: true, brace: null }, t);
      else ctl.confirm(t);
      t += 100;
    }
    const place = says(events).at(-1)!;
    expect(place).toMatchObject({ kind: "step", key: "place_overground_side", face: "side" });
    expect(place.lines).toEqual([gt("en", "place.side1"), gt("en", "place.side2"), gt("en", "place.side3")]);
    expect(place.lines.join(" ")).toMatch(/hip height.*3 metres.*not walk toward it/s);
    const { t: _t, ...placeLine } = place;
    expect(ctl.explain()).toEqual(placeLine);
    ctl.confirm(t);
    expect(says(events).at(-1)).toMatchObject({ key: "stand_overground_side", face: "side" });
    const w = walk(GAIT_CATALOG.find((e) => e.name === "overground-side")!.spec);
    for (const f of camera(w.standing, t + 40)) {
      ctl.feed(f, { rollDeg: 0 });
      t = f.t;
    }
    expect(ctl.current.id).toBe("walk");
    expect(says(events).at(-1)).toMatchObject({
      key: "walk_overground_side",
      face: "side",
      lines: [gt("en", "walk.sideSay"), gt("en", "walk.sideBody")],
    });
    for (const f of camera(w.frames, t + 40)) {
      ctl.feed(f, { rollDeg: 0 });
      ctl.tick(f.t);
      t = f.t;
    }
    for (let i = 0; i < 3 && ctl.current.id === "walk"; i++)
      ctl.tick((t += CAPTURE_LIMITS.afterLastPassMs + 100));
    // The count: pass 2 and pass 3 of 4, never the first nor the last.
    const counts = says(events).filter((e) => e.kind === "progress");
    expect(counts.map((e) => e.lines[0])).toEqual(["Pass 2 of 4", "Pass 3 of 4"]);
    expect([1, 2, 3, 4].map((n) => passSaid(n, 4))).toEqual([false, true, true, false]);
  });

  it("a hint the screen shows is said as a correction; nothing without the screen's language", () => {
    const { ctl, events } = gait();
    let t = 1000;
    ctl.start(t);
    while (ctl.current.id !== "place" && t < 9000) {
      if (ctl.current.id === "gear") ctl.setGear({ shoes: true, brace: null }, t);
      else ctl.confirm(t);
      t += 100;
    }
    ctl.feed({ t, lm: [], poses: [], aspect: 1 }, { rollDeg: 20, tilt: { rollDeg: 20 } });
    expect(says(events).at(-1)).toMatchObject({
      kind: "correction",
      key: "hint_level",
      lines: [gt("en", "hint.level")],
    });
    const none = gait(null);
    none.ctl.start(1000);
    expect(says(none.events)).toEqual([]);
    expect(none.ctl.explain()).toBeNull();
  });

  it("every walk step's line keeps the wording rules in both languages", () => {
    for (const lang of ["ar", "en"] as const) {
      const { ctl, events } = gait(lang);
      ctl.start(1000);
      let t = 1000;
      while (ctl.current.id !== "place" && t < 9000) {
        if (ctl.current.id === "gear") ctl.setGear({ shoes: true, brace: null }, t);
        else ctl.confirm(t);
        t += 100;
      }
      ctl.confirm(t);
      for (const e of says(events))
        for (const l of e.lines) {
          expect(wordingProblems(l), l).toEqual([]);
          expect(l).not.toMatch(/\{\w+\}/);
        }
    }
  });
});

/* ------------------------------------------------- a whole segment with the coach */

describe("a range segment with the Live coach (CoachSession, FakeLiveTransport)", () => {
  const CHECK = "0b6f1c1e-1d2a-4c8e-9a1b-2f3c4d5e6f70";
  beforeEach(() => vi.useFakeTimers({ now: Date.UTC(2026, 9, 10, 9, 0, 0) }));
  afterEach(() => vi.useRealTimers());

  function segment() {
    const ctl = rom(SHOULDER, "ar");
    const transports: FakeLiveTransport[] = [];
    const speakers: FakeSpeaker[] = [];
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
            history: [{ role: "user", text: "[CTX block=rom segment=rom:seated:1 lang=ar helper=no]" }],
            minutesLeft: 30,
          },
        };
      },
      report() {},
      transport() {
        const t = new FakeLiveTransport({ setupMs: 500 });
        transports.push(t);
        return t;
      },
      mic: () => new FakeMic(),
      speaker: () => {
        const s = new FakeSpeaker();
        speakers.push(s);
        return s;
      },
      deviceId: () => "device_abcdefghijklmnop",
      tickMs: 50,
    };
    const session = new CoachSession(
      {
        block: "rom",
        segment: "rom:seated:1",
        lang: "ar",
        ref: { checkId: CHECK },
        host: ctl,
        local: new FakeVoice(),
      },
      deps,
    );
    // The shell: the controller's events to the coach, and the screen's buttons the coach may press.
    const pump = () => {
      for (const e of ctl.drain()) if (e.kind === "bridge") session.push(e.event);
      const entry = romScreenActions(ctl, { clock: () => Date.now(), blockWaiting: false });
      if (entry) ctl.actions.show(entry.key, () => entry.actions, entry.alive);
    };
    const live = () => transports[transports.length - 1];
    const turns = () =>
      live()
        .sent.flatMap((s) => (s.kind === "context" && s.turnComplete ? [s.text] : []))
        .filter((x) => x.includes("type=say"));
    /** The coach speaks for `ms`, then its voice ends. */
    const speak = async (ms: number) => {
      live().emit({ type: "audio", pcm24k: new ArrayBuffer(4800) });
      await vi.advanceTimersByTimeAsync(ms);
      speakers[0].idle();
      await vi.advanceTimersByTimeAsync(100);
    };
    return { ctl, session, pump, live, turns, speak };
  }

  it("says the block's card once live, then the setup with the side after the coach's own reply to «جاهز»", async () => {
    const h = segment();
    h.ctl.startBlock("seated", Date.now());
    h.pump();
    h.session.start();
    await vi.advanceTimersByTimeAsync(600);
    expect(h.session.getSnapshot().mode).toBe("live");
    // The block's line went out before the session could hear it: the session says the step now.
    expect(h.turns()).toHaveLength(1);
    expect(h.turns()[0]).toContain("type=say kind=step key=block_seated] حركات وأنت جالس");
    await h.speak(2500);
    // The person says «جاهز»; the coach presses Ready; its reply plays before the setup is said.
    h.live().emit({ type: "inputTranscript", text: "جاهز", final: true });
    await vi.advanceTimersByTimeAsync(300);
    h.live().emit({ type: "toolCall", calls: [{ id: "c1", name: "next_step", args: { intent: "ready" } }] });
    h.pump();
    expect(h.ctl.current.kind).toBe("setup");
    await vi.advanceTimersByTimeAsync(500);
    expect(h.turns()).toHaveLength(1);
    await h.speak(1200);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.turns()).toHaveLength(2);
    const setup = h.turns()[1];
    expect(setup).toContain("type=say kind=step key=setup mv=shoulder_flexion side=right face=right_side]");
    expect(setup).toContain("اجعل جانبك الأيمن نحو الهاتف");
    expect(setup).toContain("ضع الهاتف على بعد مترين إلى ثلاثة أمتار");
    // Ready again by voice: the measurement starts and its movement is said after the reply.
    await h.speak(3000);
    h.live().emit({ type: "inputTranscript", text: "يلا", final: true });
    await vi.advanceTimersByTimeAsync(300);
    h.live().emit({ type: "toolCall", calls: [{ id: "c2", name: "next_step", args: { intent: "start" } }] });
    h.pump();
    expect(h.ctl.current.kind).toBe("measure");
    await h.speak(800);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.turns()).toHaveLength(3);
    expect(h.turns()[2]).toContain(
      "type=say kind=step key=move mv=shoulder_flexion side=right face=right_side]",
    );
    expect(h.turns()[2]).toContain("ارفعها أمامك إلى أعلى ما تستطيع دون ألم");
    h.session.end("done");
  });

  it("a step whose line went out before the session existed is said once the session is live", async () => {
    const h = segment();
    h.ctl.startBlock("seated", Date.now());
    h.ctl.ready(Date.now());
    // The shell's coach was still off: the block's and the setup's lines reached nobody.
    h.ctl.drain();
    h.session.start();
    await vi.advanceTimersByTimeAsync(600);
    expect(h.turns()).toHaveLength(1);
    expect(h.turns()[0]).toContain(
      "type=say kind=step key=setup mv=shoulder_flexion side=right face=right_side]",
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.turns()).toHaveLength(1);
    h.session.end("done");
  });

  it("a host without a step to say gives the session nothing to say", () => {
    const ctl = rom(SHOULDER);
    expect(ctl.explain()).toBeNull();
    const line: CoachSay | null = ctl.explain();
    expect(line).toBeNull();
  });
});
