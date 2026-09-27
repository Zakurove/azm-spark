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
    expect(checkIn.triggers).toHaveLength(5);
    expect(checkIn.tune_at_booth).toBe(true);
  });

  it("asks with check_are_you_ok and falls back to the 997 screen that asks for a tap", () => {
    expect(CHECKIN_CUE).toBe("check_are_you_ok");
    expect(CHECKIN_CUE).toBe(checkIn.cue);
    expect(checkIn.noResponse).toMatch(/scr_no_response/);
    expect(NO_RESPONSE_SCREEN).toBe("scr_no_response");
    expect(screenText(NO_RESPONSE_SCREEN, "en")).toMatch(/997/);
    expect(screenText(NO_RESPONSE_SCREEN, "en")).toMatch(/Tap here/);
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
  it("asks on a trigger, once, and closes on a fine signal", () => {
    const flow = new CheckInFlow();
    expect(flow.fine("tap", 0)).toBeNull();
    expect(flow.raise("sway", 1000)).toEqual({
      kind: "ask",
      cue: "check_are_you_ok",
      trigger: "sway",
      t: 1000,
    });
    expect(flow.phase).toBe("asking");
    expect(flow.raise("hips_drop", 1200)).toBeNull();
    expect(flow.trigger).toBe("sway");
    expect(flow.fine("raised_hand", 3000)).toEqual({
      kind: "fine",
      via: "raised_hand",
      trigger: "sway",
      t: 3000,
    });
    expect(flow.phase).toBe("idle");
    expect(flow.trigger).toBeNull();
  });

  it("raises the alarm after 15 s without a response, and only a tap closes that screen", () => {
    const flow = new CheckInFlow();
    flow.raise("left_frame", 0);
    expect(flow.tick(14_999)).toBeNull();
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
    expect(flow.fine("raised_hand", 43_000)).toBeNull();
    expect(flow.fine("speech", 43_500)).toBeNull();
    expect(flow.fine("tap", 44_000)).toEqual({ kind: "fine", via: "tap", trigger: "left_frame", t: 44_000 });
    expect(flow.phase).toBe("idle");
  });

  it("runs the check in when the stop list gets no answer within 30 s", () => {
    const flow = new CheckInFlow();
    flow.openStopList(5000);
    expect(flow.phase).toBe("stop_list");
    expect(flow.tick(34_999)).toBeNull();
    expect(flow.tick(35_000)).toEqual({
      kind: "ask",
      cue: "check_are_you_ok",
      trigger: "no_answer",
      t: 35_000,
    });
    expect(flow.tick(49_999)).toBeNull();
    expect(flow.tick(50_000)?.kind).toBe("no_response");

    const answered = new CheckInFlow();
    answered.openStopList(0);
    answered.answerStopList();
    expect(answered.phase).toBe("idle");
    expect(answered.tick(60_000)).toBeNull();
    answered.raise("no_movement", 61_000);
    answered.reset();
    expect(answered.phase).toBe("idle");
  });

  it("asks from the stop list when a camera trigger comes first", () => {
    const flow = new CheckInFlow();
    flow.openStopList(0);
    expect(flow.raise("hips_drop", 2000)?.kind).toBe("ask");
    expect(flow.tick(16_999)).toBeNull();
    expect(flow.tick(17_000)?.kind).toBe("no_response");
  });
});
