/**
 * Check in detectors (spec 4.0 "Check in", contract v2 section F): the camera triggers, the raised
 * hand fine signal and the timing of the check in conversation, from the check data.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_ROOT, fixtureFrames, loadFixture, type Fixture } from "./fixtures/format";
import { framesIn, generate, type GenSpec, type GenTruth } from "./fixtures/gen";
import { leanDeg } from "../src/engine/body";
import {
  CHECKIN_CUE,
  CHECKIN_TIMING,
  CHECKIN_TUNING,
  CheckInDetector,
  CheckInFlow,
  checkInReference,
  NO_RESPONSE_SCREEN,
  RaisedHandDetector,
  shoulderLineDeg,
  swayMeasureFor,
  wristAboveShoulder,
  type CheckInFeedOptions,
  type CheckInTrigger,
  type SwayMeasure,
} from "../src/engine/checkin";
import { toPixelSpace } from "../src/engine/geometry";
import { emptyPose, posesOf, SubjectLock } from "../src/engine/subject";
import { LM } from "../src/engine/types";
import { CHECK_DATA, screenText } from "../src/movements/assessments";

const disk = (file: string) => loadFixture<GenTruth>(join(FIXTURE_ROOT, file));

/** Runs the detector over a fixture through the subject lock, reference from the first frame. */
function detect(fx: Fixture<GenTruth>, measure: SwayMeasure = "trunk", opts: CheckInFeedOptions = {}) {
  const frames = fixtureFrames(fx);
  const lock = new SubjectLock();
  lock.lock(posesOf(frames[0]), frames[0].aspect);
  const d = new CheckInDetector({}, { swayMeasure: measure });
  d.setReference(checkInReference(frames[0].lm, frames[0].aspect));
  const events: { trigger: CheckInTrigger; t: number }[] = [];
  for (const f of frames) {
    const pick = lock.pickFrame(f);
    for (const trigger of d.feed(f.t, pick.lm, f.aspect, opts)) events.push({ trigger, t: f.t / 1000 });
  }
  return events;
}

const spec = (s: Partial<GenSpec>): GenSpec => ({
  test: "shoulder_abduction",
  profile: "chair",
  aspect: "9:16",
  fps: 15,
  durationSec: 4,
  seed: 41,
  ...s,
});

describe("check in timing comes from the check data", () => {
  const checkIn = CHECK_DATA.stopRouting.checkIn;

  it("uses the data's numbers and the numbers in its rules", () => {
    expect(CHECKIN_TIMING.noAnswerSec).toBe(30);
    expect(CHECKIN_TIMING.noAnswerSec).toBe(CHECK_DATA.stopRouting.noAnswerSec);
    expect(CHECK_DATA.stopRouting.noAnswer).toMatch(/within 30 s/);
    expect(CHECKIN_TIMING.noResponseSec).toBe(15);
    expect(CHECKIN_TIMING.noResponseSec).toBe(checkIn.noResponseSec);
    expect(checkIn.triggers.join(" ")).toMatch(/no movement for 10 s during a test/);
    expect(CHECKIN_TIMING.noMovementSec).toBe(10);
    expect(checkIn.okWhen.join(" ")).toMatch(/a wrist held above the same shoulder for 1 s/);
    expect(CHECKIN_TIMING.raisedHandSec).toBe(1);
    // Revision 1.1: the five camera and stop list triggers, the faint follow up without an answer, and
    // the two phase 2 fall watch triggers (O42).
    expect(checkIn.triggers).toHaveLength(8);
    expect(checkIn.tune_at_booth).toBe(true);
  });

  it("asks with check_are_you_ok and falls back to the screen that asks for a tap, with no 997 (D-016)", () => {
    expect(CHECKIN_CUE).toBe("check_are_you_ok");
    expect(CHECKIN_CUE).toBe(checkIn.cueSelection.booth.raiseAllowed);
    expect(checkIn.noResponse).toMatch(/scr_no_response/);
    expect(NO_RESPONSE_SCREEN).toBe("scr_no_response");
    expect(screenText(NO_RESPONSE_SCREEN, "en")).not.toMatch(/997/);
    // O34-4 (6): only the «أنا بخير» button counts as a tap.
    expect(screenText(NO_RESPONSE_SCREEN, "en")).toMatch(/tap “I am fine”/);
  });
});

describe("CheckInDetector", () => {
  it("stays quiet through a normal arm raise, a normal side lean and normal chair stands", () => {
    expect(detect(disk("shoulder_abduction/chair/raise-right-9x16.json"))).toEqual([]);
    expect(detect(disk("shoulder_abduction/wheelchair/raise-left-16x9.json"))).toEqual([]);
    expect(detect(disk("trunk_control_seated/wheelchair/lean-left-occluded-9x16.json"))).toEqual([]);
    expect(
      detect(disk("chair_stand_30s/standing/stands-9x16.json"), swayMeasureFor("chair_stand_30s")),
    ).toEqual([]);
    expect(detect(disk("arm_curl_30s/chair/curl-right-9x16.json"), swayMeasureFor("arm_curl_30s"))).toEqual(
      [],
    );
  });

  it("sees hips dropping toward the floor, once", () => {
    const fx = disk("chair_stand_30s/weaker_right/fall-16x9.json");
    const events = detect(fx, swayMeasureFor("chair_stand_30s"));
    const drops = events.filter((e) => e.trigger === "hips_drop");
    expect(drops).toHaveLength(1);
    expect(drops[0].t).toBeGreaterThan(1.5);
    expect(drops[0].t).toBeLessThan(2.5);
    expect(events.every((e) => e.t > 1.5)).toBe(true);
    expect(events.filter((e) => e.trigger === "sway").length).toBeLessThanOrEqual(1);

    const seated = detect(
      generate(spec({ profile: "wheelchair", subject: { motions: [{ kind: "fall", at: 1.5 }] } })),
    );
    expect(seated.map((e) => e.trigger)).toContain("hips_drop");
  });

  it("sees a big sideways sway in a front view", () => {
    const fx = generate(spec({ subject: { motions: [{ kind: "sway", at: 1.5, peak: 35, dur: 1.5 }] } }));
    const events = detect(fx);
    expect(events.map((e) => e.trigger)).toEqual(["sway"]);
    const window = framesIn(fx, "sway");
    expect(window.size).toBeGreaterThan(0);
    expect(events[0].t).toBeGreaterThan(1.5);
    expect(events[0].t).toBeLessThan(3);
  });

  it("measures the chair stand's sway on the shoulder line, as the trunk line mixes in the forward bend", () => {
    const fx = disk("chair_stand_30s/standing/stands-9x16.json");
    const frames = fixtureFrames(fx);
    const ref = checkInReference(frames[0].lm, frames[0].aspect)!;
    let trunk = 0;
    let shoulders = 0;
    for (const f of frames) {
      const p = toPixelSpace(f.lm, f.aspect);
      trunk = Math.max(trunk, Math.abs(leanDeg(p) - ref.lean));
      shoulders = Math.max(shoulders, Math.abs(shoulderLineDeg(p)! - ref.shoulders!));
    }
    expect(trunk).toBeGreaterThan(CHECKIN_TUNING.swayDeg);
    expect(shoulders).toBeLessThan(CHECKIN_TUNING.swayDeg);

    for (const aspect of ["9:16", "16:9"] as const) {
      for (const profile of ["standing", "weaker_right"] as const) {
        const sway = generate(
          spec({
            test: "chair_stand_30s",
            profile,
            aspect,
            fps: 20,
            subject: { motions: [{ kind: "sway", at: 1.5, peak: 30, dur: 1.5 }] },
          }),
        );
        expect(
          detect(sway, "shoulders").map((e) => e.trigger),
          `${aspect} ${profile}`,
        ).toEqual(["sway"]);
      }
    }
  });

  it("lets the side lean set its own sway limit per frame, or switch the rule off", () => {
    const fx = disk("trunk_control_seated/wheelchair/lean-left-occluded-9x16.json");
    expect(detect(fx, "trunk", { swayDeg: 15 }).map((e) => e.trigger)).toEqual(["sway"]);
    const big = generate(
      spec({
        test: "trunk_control_seated",
        subject: { motions: [{ kind: "side_lean", toward: "right", peak: 32 }] },
      }),
    );
    expect(detect(big).map((e) => e.trigger)).toEqual(["sway"]);
    expect(detect(big, "trunk", { sway: false })).toEqual([]);
    expect(detect(big, "trunk", { swayDeg: 40 })).toEqual([]);
  });

  it("sees the person leave the frame, and a lost subject counts as gone", () => {
    const fx = generate(spec({ durationSec: 6, subject: { motions: [{ kind: "leave", at: 1, speed: 1 }] } }));
    const events = detect(fx);
    expect(events.map((e) => e.trigger)).toEqual(["left_frame"]);
    expect(events[0].t).toBeGreaterThan(2);

    const d = new CheckInDetector();
    const out: CheckInTrigger[] = [];
    for (let t = 0; t <= 1500; t += 100) out.push(...d.feed(t, null));
    expect(out).toEqual(["left_frame"]);
    // Back in the picture for a second re-arms it.
    const f = fixtureFrames(generate(spec({ durationSec: 1 })))[0];
    for (let t = 1600; t <= 2700; t += 100) out.push(...d.feed(t, f.lm, f.aspect));
    for (let t = 2800; t <= 4000; t += 100) out.push(...d.feed(t, emptyPose()));
    expect(out).toEqual(["left_frame", "left_frame"]);
  });

  it("sees no movement for 10 s during a test, and only then", () => {
    const still = generate(spec({ fps: 10, durationSec: 12 }));
    const events = detect(still);
    expect(events.map((e) => e.trigger)).toEqual(["no_movement"]);
    expect(events[0].t).toBeGreaterThanOrEqual(10);
    expect(events[0].t).toBeLessThan(10.6);

    const wheelchair = detect(
      generate(spec({ profile: "wheelchair", aspect: "16:9", fps: 10, durationSec: 12 })),
    );
    expect(wheelchair.map((e) => e.trigger)).toEqual(["no_movement"]);

    const moved = generate(
      spec({
        fps: 10,
        durationSec: 12,
        subject: { motions: [{ kind: "arm_raise", side: "left", peak: 60, start: 4 }] },
      }),
    );
    expect(detect(moved)).toEqual([]);
    expect(detect(still, "trunk", { movement: false })).toEqual([]);
  });

  it("at home in an answer state, sees no movement for 60 s as answer_still, and only when armed (R3C-05)", () => {
    const still = generate(spec({ fps: 5, durationSec: 62 }));
    const answer = { movement: false, leftFrame: false, answerStill: true };
    const events = detect(still, "trunk", answer);
    expect(events.map((e) => e.trigger)).toEqual(["answer_still"]);
    expect(events[0].t).toBeGreaterThanOrEqual(60);
    expect(events[0].t).toBeLessThan(61);
    // Off by default (the booth row, and the answer states before the grace has passed).
    expect(detect(still, "trunk", { movement: false, leftFrame: false })).toEqual([]);
    const moved = generate(
      spec({
        fps: 5,
        durationSec: 62,
        subject: { motions: [{ kind: "arm_raise", side: "left", peak: 60, start: 30 }] },
      }),
    );
    expect(detect(moved, "trunk", answer)).toEqual([]);
    // A touch or a zone entry starts the window again.
    const frames = fixtureFrames(still);
    const d = new CheckInDetector();
    d.setReference(checkInReference(frames[0].lm, frames[0].aspect));
    const out: CheckInTrigger[] = [];
    for (const f of frames) {
      if (f.t === 30_000) d.resetAnswerStill();
      out.push(...d.feed(f.t, f.lm, f.aspect, answer));
    }
    expect(out).toEqual([]);
    expect(CHECKIN_TIMING.answerStillSec).toBe(60);
  });

  it("needs a reference for the hips and sway rules", () => {
    const fx = generate(spec({ subject: { motions: [{ kind: "fall", at: 1 }] } }));
    const d = new CheckInDetector();
    const out: CheckInTrigger[] = [];
    for (const f of fixtureFrames(fx)) out.push(...d.feed(f.t, f.lm, f.aspect));
    expect(out).toEqual([]);
    expect(checkInReference(emptyPose())).toBeNull();
    d.setReference(checkInReference(fixtureFrames(fx)[0].lm, fixtureFrames(fx)[0].aspect));
    expect(d.reference).not.toBeNull();
    d.reset();
    expect(d.reference).not.toBeNull();
  });
});

describe("shoulder line", () => {
  it("is level for an upright person, turns with a sideways lean and has no direction side on", () => {
    const front = fixtureFrames(generate(spec({ durationSec: 0.2, noise: 0 })))[0];
    expect(Math.abs(shoulderLineDeg(toPixelSpace(front.lm, front.aspect))!)).toBeLessThan(1);
    const lean = fixtureFrames(
      generate(
        spec({
          durationSec: 3,
          noise: 0,
          subject: {
            motions: [{ kind: "side_lean", toward: "left", peak: 20, start: 0, rise: 0.5, hold: 3 }],
          },
        }),
      ),
    )[30];
    expect(Math.abs(shoulderLineDeg(toPixelSpace(lean.lm, lean.aspect))!)).toBeCloseTo(20, 0);
    const side = fixtureFrames(
      generate(spec({ test: "arm_curl_30s", durationSec: 0.2, subject: { yaw: -90 } })),
    )[0];
    expect(shoulderLineDeg(toPixelSpace(side.lm, side.aspect))).toBeNull();
  });

  it("is used for the chair stand only", () => {
    expect(swayMeasureFor("chair_stand_30s")).toBe("shoulders");
    expect(swayMeasureFor("shoulder_abduction")).toBe("trunk");
    expect(swayMeasureFor("trunk_control_seated")).toBe("trunk");
    expect(swayMeasureFor("arm_curl_30s")).toBe("trunk");
  });
});

describe("RaisedHandDetector", () => {
  const raise = (from: number, to: number, side: "left" | "right" = "left") =>
    fixtureFrames(
      generate(spec({ durationSec: 4, subject: { motions: [{ kind: "raise_hand", side, from, to }] } })),
    );

  it("counts a wrist held above the same shoulder for 1 s", () => {
    for (const side of ["left", "right"] as const) {
      const d = new RaisedHandDetector();
      const frames = raise(1, 2.8, side);
      const firstAbove = frames.find((f) => wristAboveShoulder(f.lm, side))!.t;
      const firstFine = frames.find((f) => d.feed(f.t, f.lm))!.t;
      expect(firstFine - firstAbove).toBeGreaterThanOrEqual(1000);
      expect(firstFine - firstAbove).toBeLessThan(1100);
    }
  });

  it("ignores a hand raised for less than 1 s, a hidden wrist and nobody", () => {
    const d = new RaisedHandDetector();
    expect(raise(1, 1.9).some((f) => d.feed(f.t, f.lm))).toBe(false);
    d.reset();
    const hidden = raise(1, 2.8).map((f) => ({
      ...f,
      lm: f.lm.map((q, i) => (i === LM.l_wrist ? { ...q, visibility: 0.2 } : q)),
    }));
    expect(hidden.some((f) => d.feed(f.t, f.lm))).toBe(false);
    expect(d.feed(0, null)).toBe(false);
  });
});

describe("CheckInFlow", () => {
  it("asks on a trigger, once, repeats the cue at 7 s and closes on a fine signal", () => {
    const flow = new CheckInFlow();
    expect(flow.fine("button", 0)).toBeNull();
    expect(flow.raise("sway", 1000)).toEqual({
      kind: "ask",
      cue: "check_are_you_ok",
      trigger: "sway",
      origin: "test",
      t: 1000,
    });
    expect(flow.phase).toBe("asking");
    expect(flow.raise("hips_drop", 1200)).toBeNull();
    expect(flow.trigger).toBe("sway");
    expect(flow.tick(7999)).toBeNull();
    expect(flow.tick(8000)).toEqual({ kind: "repeat", cue: "check_are_you_ok", trigger: "sway", t: 8000 });
    expect(flow.tick(9000)).toBeNull();
    expect(flow.fine("raised_hand", 9500)).toEqual({
      kind: "fine",
      via: "raised_hand",
      trigger: "sway",
      origin: "test",
      afterAlarm: false,
      help: false,
      extraTimer: false,
      t: 9500,
    });
    expect(flow.phase).toBe("idle");
    expect(flow.trigger).toBeNull();
  });

  it("plays the cue chosen for the person", () => {
    const flow = new CheckInFlow({ cue: "check_are_you_ok_zone" });
    expect(flow.raise("no_movement", 0)).toMatchObject({ cue: "check_are_you_ok_zone" });
    expect(flow.tick(7000)).toMatchObject({ kind: "repeat", cue: "check_are_you_ok_zone" });
  });

  it("never counts a tap elsewhere as fine, in any state (O34-4)", () => {
    const flow = new CheckInFlow();
    flow.raise("left_frame", 0);
    expect(flow.fine("tap", 1000)).toBeNull();
    expect(flow.phase).toBe("asking");
    expect(flow.tick(15_000)?.kind).toBe("no_response");
    expect(flow.fine("tap", 16_000)).toBeNull();
    expect(flow.phase).toBe("no_response");
  });

  it("raises the alarm after 15 s without a response; the button, a camera fine or the phrase ends it", () => {
    for (const via of ["button", "raised_hand", "zone", "speech"] as const) {
      const flow = new CheckInFlow();
      flow.raise("left_frame", 0);
      expect(flow.tick(14_999)?.kind).not.toBe("no_response");
      expect(flow.tick(15_000)).toEqual({
        kind: "no_response",
        screen: "scr_no_response",
        trigger: "left_frame",
        t: 15_000,
      });
      expect(flow.phase).toBe("no_response");
      expect(flow.tick(40_000)).toBeNull();
      expect(flow.raise("sway", 41_000)).toBeNull();
      flow.openStopList(42_000);
      expect(flow.phase).toBe("no_response");
      expect(flow.fine(via, 44_000)).toMatchObject({
        kind: "fine",
        via,
        afterAlarm: true,
        trigger: "left_frame",
      });
      expect(flow.phase).toBe("idle");
    }
  });

  it("runs the check in when the stop list gets no answer within 30 s, and any input restarts it", () => {
    const flow = new CheckInFlow();
    flow.openStopList(5000);
    expect(flow.phase).toBe("question");
    expect(flow.question).toBe("S41");
    expect(flow.tick(34_999)).toBeNull();
    flow.activity(20_000);
    expect(flow.tick(49_999)).toBeNull();
    expect(flow.tick(50_000)).toEqual({
      kind: "ask",
      cue: "check_are_you_ok",
      trigger: "no_answer",
      origin: "S41",
      t: 50_000,
    });
    expect(flow.tick(64_999)?.kind).toBe("repeat");
    expect(flow.tick(65_000)?.kind).toBe("no_response");

    const answered = new CheckInFlow();
    answered.openStopList(0);
    answered.answerStopList();
    expect(answered.phase).toBe("idle");
    expect(answered.tick(60_000)).toBeNull();
    answered.raise("no_movement", 61_000);
    answered.reset();
    expect(answered.phase).toBe("idle");
  });

  it("runs the check in when the faint follow up gets no answer within 30 s", () => {
    const flow = new CheckInFlow();
    flow.openQuestion("S38b", 0);
    expect(flow.tick(30_000)).toMatchObject({ kind: "ask", trigger: "faint_no_answer", origin: "S38b" });
  });

  it("asks from the stop list when a camera trigger comes first", () => {
    const flow = new CheckInFlow();
    flow.openStopList(0);
    expect(flow.raise("hips_drop", 2000)).toMatchObject({ kind: "ask", origin: "S41" });
    expect(flow.tick(16_999)?.kind).not.toBe("no_response");
    expect(flow.tick(17_000)?.kind).toBe("no_response");
  });

  it("after a camera fine on S41, S38b or S44 runs one extra 30 s timer on that screen (O34-1 (6))", () => {
    const flow = new CheckInFlow();
    flow.openStopList(0);
    flow.tick(30_000); // no answer: the check in
    expect(flow.fine("zone", 32_000)).toMatchObject({ via: "zone", origin: "S41", extraTimer: true });
    expect(flow.phase).toBe("question");
    expect(flow.question).toBe("S41");
    expect(flow.tick(61_999)).toBeNull();
    expect(flow.tick(62_000)).toMatchObject({ kind: "ask", trigger: "no_answer", origin: "S41" });
    // A second camera fine on that screen ends its timers.
    expect(flow.fine("raised_hand", 63_000)).toMatchObject({ extraTimer: false });
    expect(flow.phase).toBe("idle");
    expect(flow.tick(200_000)).toBeNull();

    // Reopening the screen the flow returned to keeps its one extra timer; answering it ends it.
    const again = new CheckInFlow();
    again.openStopList(0);
    again.raise("sway", 1000);
    again.fine("zone", 2000);
    again.openStopList(2500);
    again.raise("sway", 10_000);
    expect(again.fine("zone", 11_000)).toMatchObject({ extraTimer: false });
    again.answerStopList();
    again.openStopList(20_000);
    again.raise("sway", 21_000);
    expect(again.fine("zone", 22_000)).toMatchObject({ extraTimer: true });

    // A fine by the button (or the phrase) sets no new timer (O14).
    const button = new CheckInFlow();
    button.openQuestion("S38b", 0);
    button.raise("sway", 1000);
    expect(button.fine("button", 2000)).toMatchObject({ origin: "S38b", extraTimer: false });
    expect(button.phase).toBe("idle");

    // S44 passes its origin; a check in from a test gets no extra timer.
    const goOn = new CheckInFlow();
    goOn.raise("sway", 0, "S44");
    expect(goOn.fine("raised_hand", 1000)).toMatchObject({ origin: "S44", extraTimer: true });
    expect(goOn.tick(31_000)).toMatchObject({ kind: "ask", origin: "S44", trigger: "no_answer" });
    const test = new CheckInFlow();
    test.raise("sway", 0);
    expect(test.fine("zone", 1000)).toMatchObject({ origin: "test", extraTimer: false });
    expect(test.phase).toBe("idle");
  });

  it("opens the alarm at once for «أحتاج مساعدة», and a fine there is the help variant (O34-5)", () => {
    const flow = new CheckInFlow();
    flow.raise("no_movement", 0);
    expect(flow.needHelp(3000)).toEqual({
      kind: "help",
      screen: "scr_no_response",
      trigger: "no_movement",
      t: 3000,
    });
    expect(flow.phase).toBe("no_response");
    expect(flow.needHelp(3500)).toBeNull();
    expect(flow.tick(60_000)).toBeNull();
    expect(flow.fine("button", 61_000)).toMatchObject({ help: true, afterAlarm: true });

    const fromGoOn = new CheckInFlow();
    expect(fromGoOn.needHelp(0, "S44")).toMatchObject({ kind: "help", trigger: null });
    expect(fromGoOn.fine("button", 1000)).toMatchObject({ origin: "S44", help: true });
  });
});
