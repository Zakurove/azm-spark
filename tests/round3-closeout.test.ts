/**
 * The round 3 closeout panel (council/decisions-ux-round.md, R3C-01 to R3C-39) in the flow machine:
 *   R3C-01  one 30 s no answer timer on S44 after the alarm and after a camera fine, once per episode;
 *   R3C-02  no redo after a no response alarm; a second one ends testing (S41, S49, results, lock);
 *   R3C-04  no redo after sway; a timed redo is the side's one repeat, offered while it is unused;
 *   R3C-08  a hips drop fine on S49 opens S41, and S49 is asked again unless the route is S36;
 *   R3C-20  S42 knows the tired answer (its own reason line);
 *   R3C-21  S49 after a stop or any started test.
 */
import { describe, expect, it } from "vitest";
import {
  RETRIES,
  type FlowEffect,
  type FlowEvent,
  type FlowModel,
  type FlowState,
} from "../src/features/assessment/flowMachine";
import { overlayFor } from "../src/features/assessment/screens";
import { contextOf, guestAtPlan, NOW, play, signedStarted, withState } from "./flow-walks";

const cam = (kind: FlowState["kind"], i = 0, side = 0, extra: Record<string, unknown> = {}) =>
  ({ kind, i, side, ...extra }) as FlowState;

/** A signed in first check at home at its plan: arm raise (0), side lean (1), arm curl (2). */
function signedPlan(): FlowModel {
  const m = signedStarted(contextOf({ position: "chair" }));
  return m.state.kind === "warnings" ? play(m, { type: "CONTINUE" }) : m;
}

const alarms = (m: FlowModel) =>
  m.effects.filter((e): e is Extract<FlowEffect, { type: "alarm" }> => e.type === "alarm");

const noResponse: FlowEvent[] = [{ type: "TRIGGER", trigger: "no_movement" }, { type: "CHECKIN_TIMEOUT" }];

describe("R3C-01: the extra 30 s no answer timer on S44", () => {
  const measuring = withState(signedPlan(), cam("cam.measure"));

  it("runs after the no response alarm and after a camera fine, never after a tap on S43 (O14)", () => {
    const afterAlarm = play(measuring, ...noResponse, { type: "FINE", via: "button" });
    expect(afterAlarm.overlay).toEqual({ kind: "goOn", afterAlarm: true, canRedo: false, timer: true });
    const raised = play(
      measuring,
      { type: "TRIGGER", trigger: "left_frame" },
      { type: "FINE", via: "raisedHand" },
    );
    expect(raised.overlay).toEqual({ kind: "goOn", afterAlarm: false, canRedo: true, timer: true });
    const zone = play(measuring, { type: "TRIGGER", trigger: "left_frame" }, { type: "FINE", via: "zone" });
    expect(zone.overlay).toMatchObject({ timer: true });
    const tapped = play(
      measuring,
      { type: "TRIGGER", trigger: "left_frame" },
      { type: "FINE", via: "button" },
    );
    expect(tapped.overlay).toEqual({ kind: "goOn", afterAlarm: false, canRedo: true });
  });

  it("runs out into S43 with no_answer; fine gives S44 back with no further timer in that episode", () => {
    const goOn = play(measuring, ...noResponse, { type: "FINE", via: "button" });
    const again = play(goOn, { type: "TRIGGER", trigger: "no_answer" });
    expect(again.overlay).toMatchObject({ kind: "checkIn", trigger: "no_answer" });
    expect(overlayFor(again)).toBe("S43");
    const back = play(again, { type: "FINE", via: "raisedHand" });
    expect(back.overlay).toEqual({ kind: "goOn", afterAlarm: true, canRedo: false });
  });

  it("no answer in that check in opens S45 again: the second no response alarm (R3C-02)", () => {
    const goOn = play(measuring, ...noResponse, { type: "FINE", via: "button" });
    const second = play(goOn, { type: "TRIGGER", trigger: "no_answer" }, { type: "CHECKIN_TIMEOUT" });
    expect(overlayFor(second)).toBe("S45");
    expect(second.data.noResponseAlarms).toBe(2);
  });
});

describe("R3C-02: no redo after a no response alarm, and a second alarm ends testing", () => {
  const signed = signedPlan();
  const measuring = withState(signed, cam("cam.measure"));

  it("S44 after the alarm never offers the redo; after a check in without an alarm it keeps it", () => {
    const afterAlarm = play(measuring, ...noResponse, { type: "FINE", via: "button" });
    expect(afterAlarm.overlay).toMatchObject({ kind: "goOn", afterAlarm: true, canRedo: false });
    expect(play(afterAlarm, { type: "REDO" }).state.kind).toBe("cam.measure");
    const plain = play(
      measuring,
      { type: "TRIGGER", trigger: "no_movement" },
      { type: "FINE", via: "button" },
    );
    expect(plain.overlay).toMatchObject({ kind: "goOn", canRedo: true });
  });

  it("the help form is not a no response alarm: its fine goes to S41 and counts for neither rule", () => {
    const help = play(measuring, { type: "TRIGGER", trigger: "sway" }, { type: "NEED_HELP" });
    expect(help.data.noResponseAlarms).toBe(0);
    expect(play(help, { type: "FINE", via: "button" }).overlay).toEqual({
      kind: "stopList",
      takeYourTime: false,
    });
    // A later no response alarm is the first one: its fine gives S44.
    const later = play(withState(help, cam("cam.measure", 0, 1)), ...noResponse, {
      type: "FINE",
      via: "button",
    });
    expect(later.overlay).toMatchObject({ kind: "goOn", afterAlarm: true });
  });

  it("a second alarm: fine opens S41, never S44; the check takes the stop_symptom next day lock", () => {
    const first = play(measuring, ...noResponse, { type: "FINE", via: "button" }, { type: "SKIP_TEST" });
    const next = withState(first, cam("cam.measure", 1, 0));
    const second = play(next, ...noResponse);
    expect(second.data.noResponseAlarms).toBe(2);
    expect(second.data.testingEnded).toBe(true);
    expect(second.data.noResponseAlarm).toBe(true);
    // The server closes the check with the lock, as a stop that ends it (the alarm post says so).
    expect(alarms(second).at(-1)?.body).toMatchObject({ kind: "no_response", endsCheck: true });
    expect(alarms(first).every((a) => a.body.endsCheck === undefined)).toBe(true);
    expect(second.data.closed).toBe(true);
    expect(second.data.lock?.reason).toBe("stop_symptom");
    expect(second.data.lock?.until).toBeGreaterThan(NOW);
    const fine = play(second, { type: "FINE", via: "button" });
    expect(fine.overlay).toEqual({ kind: "stopList", takeYourTime: false });
  });

  it("whatever reason is chosen, S42 offers no next test and the check ends through S49", () => {
    const first = play(measuring, ...noResponse, { type: "FINE", via: "button" }, { type: "SKIP_TEST" });
    const second = play(withState(first, cam("cam.measure", 1, 0)), ...noResponse, {
      type: "FINE",
      via: "zone",
    });
    const tired = play(second, { type: "STOP_OPTION", option: "tired" });
    expect(tired.state).toMatchObject({ kind: "stopDone", option: "tired" });
    expect(play(tired, { type: "STOP_NEXT" }).state.kind).toBe("endQuestion");
    const choice = play(second, { type: "STOP_OPTION", option: "choice" });
    expect(play(choice, { type: "STOP_NEXT" }).state.kind).toBe("endQuestion");
    const pain = play(second, { type: "STOP_OPTION", option: "pain" });
    expect(pain.state).toMatchObject({ kind: "between", via: "stop" });
    expect(play(pain, { type: "BETWEEN_ANSWER", value: "same" }).state.kind).toBe("endQuestion");
    // The flag stays: a faint answer takes the emergency route (R3C-23).
    const faint = play(second, { type: "STOP_OPTION", option: "faint" }, { type: "FAINT_ASK" });
    expect(play(faint, { type: "FAINT_ANSWER", value: "no" }).state).toMatchObject({ safety: "emergency" });
  });

  it("a guest's second alarm ends testing too, with the lock kept on the phone", () => {
    const g = withState(guestAtPlan(), cam("cam.measure"));
    const first = play(g, ...noResponse, { type: "FINE", via: "button" }, { type: "SKIP_TEST" });
    const second = play(withState(first, cam("cam.measure", 1, 0)), ...noResponse);
    expect(second.effects).toEqual([]);
    expect(second.data.testingEnded).toBe(true);
    expect(second.data.lock?.reason).toBe("stop_symptom");
    const done = play(second, { type: "FINE", via: "button" }, { type: "STOP_OPTION", option: "choice" });
    expect(play(done, { type: "STOP_NEXT" }).state.kind).toBe("endQuestion");
  });
});

describe("R3C-04: the redo after sway and the one repeat of a timed test", () => {
  const signed = signedPlan();

  it("no redo after a sway check in; the redo stays after no movement and left frame", () => {
    const measuring = withState(signed, cam("cam.measure"));
    const fine = (trigger: string) =>
      play(measuring, { type: "TRIGGER", trigger }, { type: "FINE", via: "button" }).overlay;
    expect(fine("sway")).toMatchObject({ kind: "goOn", canRedo: false });
    expect(fine("no_movement")).toMatchObject({ kind: "goOn", canRedo: true });
    expect(fine("left_frame")).toMatchObject({ kind: "goOn", canRedo: true });
  });

  it("a timed redo is that side's one repeat: offered while unused, and it uses it", () => {
    const curl = withState(signed, cam("cam.measure", 2, 0));
    const goOn = play(curl, { type: "TRIGGER", trigger: "no_movement" }, { type: "FINE", via: "button" });
    expect(goOn.overlay).toMatchObject({ kind: "goOn", canRedo: true });
    const redo = play(goOn, { type: "REDO" });
    expect(redo.state).toMatchObject({ kind: "cam.rest", purpose: "redo" });
    expect(redo.data.run.retriesUsed).toBe(RETRIES.arm_curl_30s);
    // A failed redo is not measured today (quality): no quality repeat follows.
    expect(play(redo, { type: "REST_DONE" }).state.kind).toBe("cam.setup");
    const failed = play(
      { ...redo, state: cam("cam.measure", 2, 0) },
      { type: "QUALITY_FAIL", issue: "out_of_frame" },
    );
    expect(failed.state).toMatchObject({ kind: "cam.retry", exhausted: true });
    // With the repeat used, S44 offers no redo.
    const used = { ...curl, data: { ...curl.data, run: { ...curl.data.run, retriesUsed: 1 } } };
    const again = play(used, { type: "TRIGGER", trigger: "no_movement" }, { type: "FINE", via: "button" });
    expect(again.overlay).toMatchObject({ kind: "goOn", canRedo: false });
  });

  it("a range test redo uses no retry", () => {
    const measuring = withState(signed, cam("cam.measure"));
    const redo = play(
      measuring,
      { type: "TRIGGER", trigger: "left_frame" },
      { type: "FINE", via: "button" },
      {
        type: "REDO",
      },
    );
    expect(redo.state).toMatchObject({ kind: "cam.rest", purpose: "redo" });
    expect(redo.data.run.retriesUsed).toBe(0);
  });
});

describe("R3C-08: fine after a check in over S49", () => {
  const signed = signedPlan();
  const end = withState(signed, { kind: "endQuestion" });

  it("a hips drop fine opens S41; a chosen stop asks S49 again", () => {
    const list = play(end, { type: "TRIGGER", trigger: "hips_drop" }, { type: "FINE", via: "button" });
    expect(list.overlay).toEqual({ kind: "stopList", takeYourTime: false });
    expect(list.state.kind).toBe("endQuestion");
    const choice = play(list, { type: "STOP_OPTION", option: "choice" });
    expect(choice.overlay).toBeNull();
    expect(choice.state.kind).toBe("endQuestion");
    // Through the alarm as well.
    const alarmed = play(
      end,
      { type: "TRIGGER", trigger: "hips_drop" },
      { type: "CHECKIN_TIMEOUT" },
      {
        type: "FINE",
        via: "button",
      },
    );
    expect(alarmed.overlay).toEqual({ kind: "stopList", takeYourTime: false });
  });

  it("a fall is routed to S39 with its lock and the faint question, then S49 again", () => {
    const list = play(end, { type: "TRIGGER", trigger: "hips_drop" }, { type: "FINE", via: "button" });
    const fall = play(list, { type: "STOP_OPTION", option: "fall" });
    expect(fall.state).toMatchObject({ kind: "safety", safety: "fall", askFaint: true });
    expect(fall.data.lock?.until).toBeGreaterThan(NOW);
    const answered = play(fall, { type: "FAINT_ASK" }, { type: "FAINT_ANSWER", value: "no" });
    expect(answered.state).toMatchObject({ kind: "safety", safety: "fall", faintAnswered: true });
    expect(play(answered, { type: "EXIT" }).state.kind).toBe("endQuestion");
  });

  it("an emergency route never returns to S49", () => {
    const list = play(end, { type: "TRIGGER", trigger: "hips_drop" }, { type: "FINE", via: "button" });
    const chest = play(list, { type: "STOP_OPTION", option: "chest" });
    expect(chest.state).toMatchObject({ kind: "safety", safety: "emergency" });
    expect(play(chest, { type: "EXIT" }).state).toEqual({ kind: "exit", to: "today" });
  });

  it("after any other check in, fine returns to S49 with how it was given", () => {
    const back = play(end, { type: "TRIGGER", trigger: "sway" }, { type: "FINE", via: "raisedHand" });
    expect(back.overlay).toBeNull();
    expect(back.state).toEqual({ kind: "endQuestion", fineVia: "raisedHand" });
  });
});

describe("R3C-20 and R3C-21: S42 after tired, and S49 after a stop", () => {
  const signed = signedPlan();
  const measuring = withState(signed, cam("cam.measure"));

  it("STOP, tired, End gives S49 (UX S42: End goes to S49)", () => {
    const tired = play(measuring, { type: "STOP" }, { type: "STOP_OPTION", option: "tired" });
    expect(tired.state).toMatchObject({
      kind: "stopDone",
      option: "tired",
      reason: "stopped_symptom",
      restSec: 60,
    });
    expect(play(tired, { type: "STOP_END" }).state.kind).toBe("endQuestion");
  });

  it("a stop by choice with nothing measured still asks S49", () => {
    const choice = play(measuring, { type: "STOP" }, { type: "STOP_OPTION", option: "choice" });
    expect(choice.state).toMatchObject({ kind: "stopDone", option: "choice", reason: "by_choice" });
    expect(play(choice, { type: "STOP_END" }).state.kind).toBe("endQuestion");
  });

  it("a test started and then skipped asks S49; a check with no test started goes to the results", () => {
    const setup = withState(signed, cam("cam.setup", 2, 0));
    const skipped = play(
      { ...setup, data: { ...setup.data, started: true } },
      { type: "SKIP" },
      {
        type: "SKIP_CONFIRM",
      },
    );
    expect(skipped.state).toMatchObject({ kind: "skipNotice", then: { to: "endQuestion" } });
    const never = withState(signed, { kind: "test.instruction", i: 2 });
    const unstarted = { ...never, data: { ...never.data, started: false } };
    expect(unstarted.data.outcomes).toEqual({});
  });

  it("entering a camera state marks the check as started", () => {
    const instruction = withState(signed, { kind: "test.instruction", i: 0 });
    expect(instruction.data.started).toBe(false);
    const setup = withState(signed, cam("cam.setup"));
    const moved = play(setup, { type: "SETUP_OK" });
    expect(moved.data.started).toBe(true);
  });
});
