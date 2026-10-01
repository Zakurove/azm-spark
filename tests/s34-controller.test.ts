/**
 * The camera sequence of one test (UX spec S34): the CameraController between the engine runners and
 * the flow, driven by fixture frames through the real flow reducer (tests/s34-harness.ts). Each test
 * kind runs from the setup check to the end of its side in both phone shapes (9:16 and 16:9).
 */
import { describe, expect, it } from "vitest";
import { checkResult } from "../server/modules/assessments/validate";
import {
  flowReducer,
  type FlowEvent,
  type FlowModel,
  type ResultPayload,
} from "../src/features/assessment/flowMachine";
import {
  CameraController,
  camTestOf,
  IDLE_ENV,
  triesLeft,
} from "../src/features/assessment/camera/controller";
import { camTiming } from "../src/features/assessment/camera/timing";
import type { TestId } from "../src/movements/types";
import { atSetup, checkInOn, framesOf, NOW, play, runFixture } from "./s34-harness";

const camKind = (m: FlowModel) => m.state.kind.startsWith("cam.");

type Case = { testId: TestId; fixture: string; position: "chair" | "standing"; end: string };
const CASES: Case[] = [
  { testId: "shoulder_abduction", fixture: "abd", position: "chair", end: "between" },
  { testId: "trunk_control_seated", fixture: "lean", position: "chair", end: "after.contact" },
  { testId: "arm_curl_30s", fixture: "curl", position: "chair", end: "between" },
  { testId: "chair_stand_30s", fixture: "stand", position: "standing", end: "between" },
];

const bodyOf = (events: FlowEvent[]): ResultPayload | undefined => {
  const e = events.find((x) => x.type === "SIDE_RESULT") as
    Extract<FlowEvent, { type: "SIDE_RESULT" }> | undefined;
  return e?.body;
};

describe("S34 camera sequence with fixture poses, each test kind and both aspects", () => {
  for (const c of CASES) {
    for (const aspect of ["9x16", "16x9"]) {
      it(`${c.testId} at ${aspect}: setup, calibrate, practice, attempts, saved, then ${c.end}`, () => {
        const start = atSetup(c.testId, c.position);
        const run = runFixture(start, `${c.fixture}-${aspect}`, 150, { stopWhen: (m) => !camKind(m) });
        expect(run.model.state.kind).toBe(c.end);
        const kinds = run.kinds;
        expect(kinds[0]).toBe("cam.setup");
        expect(kinds).toContain("cam.calibrate");
        expect(kinds).toContain("cam.practice");
        expect(kinds).toContain("cam.measure");
        expect(kinds).toContain("cam.saved");
        const timed = c.testId === "arm_curl_30s" || c.testId === "chair_stand_30s";
        if (timed) expect(kinds).toContain("cam.countdown");
        else expect(kinds).not.toContain("cam.countdown");

        // The side is measured and its result is derived numbers only, accepted by the server.
        const outcome = Object.values(run.model.data.outcomes)[0];
        expect(outcome.status).toBe("measured");
        const body = bodyOf(run.events)!;
        expect(body).toBeDefined();
        expect(body.value).toBeGreaterThan(0);
        const item = start.data.tests[(start.state as { i: number }).i].sides[0];
        const checked = checkResult(body as unknown as Record<string, unknown>, {
          item,
          setting: "booth",
          conditions: [],
        });
        expect(checked).toMatchObject({ ok: true });
        expect(JSON.stringify(body)).not.toMatch(/landmark|frame|video/i);

        // Counts are never spoken (D-009): the only numbers said are the countdown before go.
        const spoken = run.cues.filter((x) => !x.startsWith("("));
        expect(spoken.filter((x) => /^count_/.test(x)).every((x) => /^count_[123]$/.test(x))).toBe(true);
        if (timed) {
          expect(spoken).toContain("check_go");
          expect(spoken.indexOf("count_1")).toBeLessThan(spoken.indexOf("check_go"));
        }
      });
    }
  }

  it("the arm raise value is close to the fixture's 140 degrees, and the side lean shows no number", () => {
    const abd = runFixture(atSetup("shoulder_abduction"), "abd-9x16", 150, { stopWhen: (m) => !camKind(m) });
    const v = Object.values(abd.model.data.outcomes)[0].value!;
    expect(Math.abs(v - 140)).toBeLessThanOrEqual(8);

    const lives: (number | null)[] = [];
    runFixture(atSetup("trunk_control_seated"), "lean-9x16", 150, {
      stopWhen: (m) => !camKind(m),
      after: (ctrl) => lives.push(ctrl.snapshot().live),
    });
    expect(lives.length).toBeGreaterThan(100);
    expect(lives.every((x) => x === null)).toBe(true);
  });

  it("the range test shows its phases in order and saves three attempts", () => {
    const words: string[] = [];
    const run = runFixture(atSetup("shoulder_abduction"), "abd-16x9", 150, {
      stopWhen: (m) => !camKind(m),
      after: (ctrl) => {
        const w = ctrl.snapshot().phaseWord;
        if (w && words[words.length - 1] !== w) words.push(w);
      },
    });
    expect(words).toEqual(expect.arrayContaining(["still", "raise", "hold", "lower", "saved"]));
    expect(words.indexOf("raise")).toBeLessThan(words.indexOf("hold"));
    expect(words.indexOf("hold")).toBeLessThan(words.indexOf("lower"));
    expect(run.events.filter((e) => e.type === "ATTEMPT_OK")).toHaveLength(3);
  });

  it("the timed count freezes once the time is up and the timer counts down from 30", () => {
    const remaining: number[] = [];
    let frozen: number | null = null;
    runFixture(atSetup("arm_curl_30s"), "curl-9x16", 150, {
      stopWhen: (m) => !camKind(m),
      after: (ctrl) => {
        const s = ctrl.snapshot();
        if (s.trialRemaining !== null) remaining.push(s.trialRemaining);
        if (s.timeUp && frozen === null) frozen = s.count;
        if (frozen !== null) expect(s.count).toBe(frozen);
      },
    });
    expect(Math.max(...remaining)).toBe(30);
    expect(Math.min(...remaining)).toBe(0);
    expect(frozen).not.toBeNull();
  });
});

describe("S34c setup check", () => {
  const setupRun = (fixture: string, seconds: number, env = {}) => {
    let snap = null as ReturnType<CameraController["snapshot"]> | null;
    const run = runFixture(atSetup("shoulder_abduction"), fixture, seconds, {
      env: () => env,
      after: (ctrl) => (snap = ctrl.snapshot()),
    });
    return { run, snap: snap! };
  };

  it("with nobody in the picture: we cannot see you yet, the framing chip needs adjusting, no start", () => {
    const { run, snap } = setupRun("fx:empty", 8);
    expect(run.model.state.kind).toBe("cam.setup");
    expect(snap.setup.issues[0]).toBe("no_person");
    expect(snap.setup.chips.framing).toBe("fix");
    expect(snap.setup.chips.level).toBe("na");
    expect(run.cues).toContain("check_whole_body");
    expect(run.events.some((e) => e.type === "SETUP_OK")).toBe(false);
  });

  it("the issue cue is replayed at most every 6 s while it stays", () => {
    const { run } = setupRun("fx:empty", 20);
    const n = run.cues.filter((x) => x === "check_whole_body").length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(4);
  });

  it("another person overlapping in the middle: someone else in the middle, one person cue, no start", () => {
    const { run, snap } = setupRun("crowd-9x16", 8);
    expect(run.model.state.kind).toBe("cam.setup");
    expect(snap.setup.issues).toContain("second_person");
    expect(snap.setup.chips.people).toBe("fix");
    expect(run.cues).toContain("check_one_person");
  });

  it("a phone held sideways never starts the test", () => {
    const { run } = setupRun("abd-9x16", 8, { landscape: true });
    expect(run.model.state.kind).toBe("cam.setup");
  });

  it("all checks passing for 2 s starts calibration, and the first test says how to stop once", () => {
    const { run } = setupRun("abd-9x16", 5);
    expect(run.kinds.slice(0, 2)).toEqual(["cam.setup", "cam.calibrate"]);
    // B2: at the booth the line names the team (test.stopBooth, C04), never the home line.
    expect(run.notes.filter((k) => k === "assessment.test.stopBooth")).toHaveLength(1);
    expect(run.notes).not.toContain("assessment.intro.howToStop");
    expect(run.notes).toContain("assessment.camera.motionOff");
  });

  it("a helper at the side is accepted and said once", () => {
    const run = runFixture(
      atSetup("shoulder_abduction"),
      "fx:shoulder_abduction/weaker_left/helper-beside-9x16",
      6,
    );
    expect(run.notes.filter((k) => k === "assessment.setup.helperOk").length).toBeLessThanOrEqual(1);
  });
});

describe("S34i retry and S34j rests (the screen's own timers)", () => {
  const T = 50_000;
  const retryModel = (exhausted: boolean): FlowModel => {
    const m = atSetup("shoulder_abduction");
    return {
      ...m,
      state: {
        kind: "cam.retry",
        i: (m.state as { i: number }).i,
        side: 0,
        issue: "plane_flexion",
        exhausted,
      },
    };
  };

  it("returns to the setup check after 6 s, and the count waits while a finger is on the screen", () => {
    const m = retryModel(false);
    const ctrl = new CameraController(m, camTestOf(m)!, { timing: camTiming() });
    const first = ctrl.sync(m, T);
    expect(first.cues.map((c) => c.id)).toContain("test_abd_side");
    // A finger on the screen: the count stops and starts again from 6 s when it lifts.
    expect(ctrl.tick(T + 3000, { ...IDLE_ENV, touching: true }).events).toEqual([]);
    expect(ctrl.snapshot(T + 3000).retry).toMatchObject({ counting: false, remaining: 6 });
    expect(ctrl.tick(T + 4000).events).toEqual([]);
    expect(ctrl.tick(T + 9000).events).toEqual([]);
    const out = ctrl.tick(T + 10_100);
    expect(out.events).toEqual([{ type: "RETRY" }]);
  });

  it("the retry count waits while a dialog is open over the stage", () => {
    const m = retryModel(false);
    const ctrl = new CameraController(m, camTestOf(m)!, { timing: camTiming() });
    ctrl.sync(m, T);
    const withDialog = flowReducer(m, { type: "SKIP", now: NOW });
    expect(withDialog.overlay?.kind).toBe("skipDialog");
    ctrl.sync(withDialog, T + 1000);
    expect(ctrl.tick(T + 8000).events).toEqual([]);
  });

  it("when no try is left the side is not measured today (quality) and the flow moves on", () => {
    const m = retryModel(true);
    const ctrl = new CameraController(m, camTestOf(m)!, { timing: camTiming() });
    ctrl.sync(m, T);
    const out = ctrl.tick(T + 6100);
    expect(out.events).toEqual([{ type: "CONTINUE" }]);
    const next = flowReducer(m, { type: "CONTINUE", now: NOW });
    const outcome = Object.values(next.data.outcomes)[0];
    expect(outcome).toMatchObject({ status: "notMeasured", reason: "quality" });
  });

  it("tries left follow the flow's retry budget", () => {
    expect(triesLeft("shoulder_abduction", 0)).toBe(2);
    expect(triesLeft("shoulder_abduction", 1)).toBe(1);
    expect(triesLeft("arm_curl_30s", 1)).toBe(0);
  });

  it("the side change rest of the arm raise lasts 20 s, then names the next arm", () => {
    const m0 = atSetup("shoulder_abduction");
    const i = (m0.state as { i: number }).i;
    const m: FlowModel = { ...m0, state: { kind: "cam.rest", i, side: 1, purpose: "sideChange" } };
    const ctrl = new CameraController(m, camTestOf(m)!, { timing: camTiming() });
    const enter = ctrl.sync(m, T);
    expect(enter.cues.map((c) => c.id)).toContain("check_rest_short");
    expect(ctrl.snapshot(T + 5000).rest).toEqual({ remaining: 15, total: 20 });
    expect(ctrl.tick(T + 19_000).events).toEqual([]);
    const out = ctrl.tick(T + 20_050);
    expect(out.events).toEqual([{ type: "REST_DONE" }]);
    const side = m.data.tests[i].sides[1].side;
    expect(out.cues.map((c) => c.id)).toContain(side === "left" ? "check_left_arm" : "check_right_arm");
  });

  it("the saved state lasts 1.5 s, without the attempt's value", () => {
    const m0 = atSetup("shoulder_abduction");
    const i = (m0.state as { i: number }).i;
    const m: FlowModel = { ...m0, state: { kind: "cam.saved", i, side: 0 } };
    const ctrl = new CameraController(m, camTestOf(m)!, { timing: camTiming() });
    ctrl.sync(m, T);
    expect(ctrl.snapshot(T).phaseWord).toBe("saved");
    expect(ctrl.snapshot(T).live).toBeNull();
    expect(ctrl.tick(T + 1000).events).toEqual([]);
    expect(ctrl.tick(T + 1600).events).toEqual([{ type: "SAVED_NEXT" }]);
  });
});

describe("S34 pauses, STOP and check in triggers", () => {
  it("STOP opens the stop list and scoring pauses at once: the runner is not fed under the overlay", () => {
    let phaseAtStop: string | null = null;
    let stoppedAt: number | null = null;
    const run = runFixture(atSetup("shoulder_abduction"), "abd-9x16", 12, {
      before: (m, t) => {
        if (stoppedAt === null && m.state.kind === "cam.measure") {
          stoppedAt = t;
          return play(m, { type: "STOP" });
        }
        return m;
      },
      after: (ctrl, m) => {
        if (m.overlay?.kind === "stopList") {
          phaseAtStop ??= ctrl.snapshot().runnerPhase;
          expect(ctrl.snapshot().runnerPhase).toBe(phaseAtStop);
        }
      },
    });
    expect(stoppedAt).not.toBeNull();
    expect(run.model.overlay?.kind).toBe("stopList");
    expect(run.model.state.kind).toBe("cam.measure");
  });

  it("the person vanishing from the picture during the practice opens the check in when on (left frame)", () => {
    let goneAt: number | null = null;
    const run = runFixture(checkInOn(atSetup("shoulder_abduction")), "abd-9x16", 16, {
      stopWhen: (m) => m.overlay?.kind === "checkIn",
      before: (m, t) => {
        if (goneAt === null && m.state.kind === "cam.practice") goneAt = t + 500;
        return m;
      },
      frames: (t, f) =>
        goneAt !== null && t >= goneAt
          ? { ...f, poses: [], lm: f.lm.map((p) => ({ ...p, visibility: 0 })) }
          : f,
    });
    expect(run.model.overlay).toEqual({ kind: "checkIn" });
    expect(run.events).toContainEqual({ type: "TRIGGER", trigger: "left_frame" });
  });

  it("no movement for 10 s during the practice opens the check in when on (no movement)", () => {
    const run = runFixture(checkInOn(atSetup("shoulder_abduction")), "fx:seated-still", 30, {
      stopWhen: (m) => m.overlay?.kind === "checkIn",
    });
    expect(run.model.state.kind).toBe("cam.practice");
    expect(run.model.overlay).toEqual({ kind: "checkIn" });
    expect(run.events).toContainEqual({ type: "TRIGGER", trigger: "no_movement" });
  });

  it("with the check in off (the default, and always at the booth) nothing asks", () => {
    const run = runFixture(atSetup("shoulder_abduction"), "fx:seated-still", 30);
    expect(run.events.filter((e) => e.type === "TRIGGER")).toEqual([]);
    expect(run.model.overlay).toBeNull();
  });

  it("the setup check and the rests never ask about movement (4.8)", () => {
    const run = runFixture(atSetup("shoulder_abduction"), "fx:empty", 25);
    expect(run.model.overlay).toBeNull();
  });

  it("the phone moving during an attempt pauses scoring (paused, phone)", () => {
    const paused: (string | null)[] = [];
    runFixture(atSetup("shoulder_abduction"), "abd-9x16", 9, {
      env: (t) => ({ tilt: { rollDeg: t > 16_500 ? 12 : 0, pitchDeg: 0 } }),
      after: (ctrl) => paused.push(ctrl.snapshot().paused),
    });
    expect(paused).toContain("phone");
  });
});

/**
 * Map 2.12: a whole picture that moves during an attempt discards it without using a retry, goes back
 * to the setup check, calibrates again in the new picture and repeats the same attempt number. With
 * the real model the audit saw the flow loop setup, calibrate, practice, measure (acceptance F-1):
 * the discarded attempt brought back the copy of the runner from before the move, with the old
 * calibration, so every later attempt read the new picture as moved again.
 */
describe("map 2.12: the picture moves during a scored attempt", () => {
  it("calibrates once in the new picture, then saves the side's three attempts", () => {
    let shiftAt: number | null = null;
    const moved = (t: number) => shiftAt !== null && t >= shiftAt;
    const run = runFixture(atSetup("shoulder_abduction"), "abd-9x16", 240, {
      stopWhen: (m) => !camKind(m),
      after: (_ctrl, m, t) => {
        // One second into the first scored attempt, the phone slides: every landmark moves the same.
        if (shiftAt === null && m.state.kind === "cam.measure") shiftAt = t + 1000;
      },
      frames: (t, f) => {
        if (!moved(t)) return f;
        const shift = (p: (typeof f.lm)[number]) => ({ ...p, x: p.x + 0.08, y: p.y + 0.02 });
        const poses = (f.poses ?? [f.lm]).map((pose) => pose.map(shift));
        return { ...f, lm: poses[0], poses };
      },
    });
    expect(shiftAt).not.toBeNull();
    const phoneMoved = run.events.filter((e) => e.type === "PHONE_MOVED");
    expect(phoneMoved).toHaveLength(1);
    expect(run.events.filter((e) => e.type === "QUALITY_FAIL")).toHaveLength(0);
    expect(run.events.filter((e) => e.type === "ATTEMPT_OK")).toHaveLength(3);
    // The move used no retry: the value is there, with no quality retry counted.
    const body = bodyOf(run.events)!;
    expect(body.value).toBeGreaterThan(0);
    expect(body.nValid).toBe(3);
    expect(body.qualityRetries ?? 0).toBe(0);
    expect(run.cues).toContain("check_phone_still");
  });
});

describe("the fixtures of the browser flows", () => {
  it("every test kind has a camera script in both phone shapes", () => {
    for (const k of ["abd", "lean", "curl", "stand", "leave", "crowd"])
      for (const a of ["9x16", "16x9"]) {
        const { frames, durationMs } = framesOf(`${k}-${a}`);
        expect(frames.length).toBeGreaterThan(50);
        expect(durationMs).toBeGreaterThan(5000);
        expect(frames[0].aspect).toBeCloseTo(a === "9x16" ? 9 / 16 : 16 / 9, 2);
      }
  });
});

describe("the redo rests after the check in paused an attempt (D-016)", () => {
  it("a timed redo rests 120 s with the repeat line, then repeats the trial with no new practice", () => {
    let redoAt: number | null = null;
    let restTotal: number | null = null;
    const phases: string[] = [];
    const run = runFixture(checkInOn(atSetup("arm_curl_30s")), "curl-9x16", 400, {
      fast: false,
      before: (m, t) => {
        if (redoAt === null && m.state.kind === "cam.measure" && m.overlay === null) {
          redoAt = t;
          return play(m, { type: "TRIGGER", trigger: "no_movement" }, { type: "FINE" });
        }
        return m;
      },
      after: (ctrl, m, t) => {
        const s = ctrl.snapshot();
        if (redoAt !== null && m.state.kind === "cam.rest" && restTotal === null)
          restTotal = s.rest?.total ?? null;
        if (redoAt !== null && t > redoAt && s.runnerPhase && phases[phases.length - 1] !== s.runnerPhase)
          phases.push(s.runnerPhase);
      },
      stopWhen: (m) => redoAt !== null && m.state.kind === "cam.measure" && m.overlay === null,
    });
    expect(redoAt).not.toBeNull();
    expect(restTotal).toBe(120);
    expect(run.notes).toContain("assessment.retry.after2min");
    expect(run.model.data.run.retriesUsed).toBe(1);
    // After the rest: the resting reference and the setup check again, never a new practice.
    expect(phases).not.toContain("practice");
    expect(run.model.state.kind).toBe("cam.measure");
  });

  it("a range test redo rests 60 s with check_rest_minute", () => {
    let redone = false;
    let restTotal: number | null = null;
    const run = runFixture(checkInOn(atSetup("shoulder_abduction")), "abd-9x16", 90, {
      fast: false,
      before: (m) => {
        if (!redone && m.state.kind === "cam.measure" && m.overlay === null) {
          redone = true;
          return play(m, { type: "TRIGGER", trigger: "left_frame" }, { type: "FINE" });
        }
        return m;
      },
      after: (ctrl, m) => {
        if (m.state.kind === "cam.rest" && restTotal === null)
          restTotal = ctrl.snapshot().rest?.total ?? null;
      },
      stopWhen: (m) => redone && m.state.kind === "cam.rest",
    });
    expect(redone).toBe(true);
    expect(restTotal).toBe(60);
    expect(run.cues).toContain("check_rest_minute");
  });
});

describe("the one_arm_cross arm line (R3C-26)", () => {
  it("shows the variant's own step line where test_stand_arms_cross would play, and speaks no arm cue", () => {
    const m = atSetup("chair_stand_30s", "standing");
    const i = m.data.tests.findIndex((t) => t.testId === "chair_stand_30s");
    const tests = m.data.tests.map((t, k) =>
      k === i ? { ...t, sides: t.sides.map((s) => ({ ...s, variant: "one_arm_cross" })) } : t,
    );
    const env = {
      ...m.data.env!,
      setup: { ...(m.data.env!.setup ?? {}), limbLoss: { arm: "left" as const } },
    };
    const start = { ...m, data: { ...m.data, tests, env } } as typeof m;
    const run = runFixture(start, "stand-9x16", 12);
    expect(run.notes).toContain(
      "text:Place your hand on the opposite shoulder. Keep your other arm, or your prosthesis if you wear one, close to your chest.",
    );
    expect(run.cues.filter((c) => c.includes("test_stand_arms_cross"))).toEqual([]);
  });
});
