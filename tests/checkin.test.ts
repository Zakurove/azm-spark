/**
 * The optional check in (D-016; stopRouting.checkIn): its numbers from the check data and its two
 * camera triggers, the person out of the picture for 5 s and no movement for 10 s.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_ROOT, fixtureFrames, loadFixture, type Fixture } from "./fixtures/format";
import { generate, type GenSpec, type GenTruth } from "./fixtures/gen";
import {
  CHECKIN_TIMING,
  CheckInDetector,
  type CheckInFeedOptions,
  type CheckInTrigger,
} from "../src/engine/checkin";
import { emptyPose, posesOf, SubjectLock } from "../src/engine/subject";
import { CHECK_DATA, cueLine, screenText } from "../src/movements/assessments";

const disk = (file: string) => loadFixture<GenTruth>(join(FIXTURE_ROOT, file));

/** Runs the detector over a fixture through the subject lock. */
function detect(fx: Fixture<GenTruth>, opts: CheckInFeedOptions = {}) {
  const frames = fixtureFrames(fx);
  const lock = new SubjectLock();
  lock.lock(posesOf(frames[0]), frames[0].aspect);
  const d = new CheckInDetector();
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

describe("the check in comes from the check data (D-016)", () => {
  const checkIn = CHECK_DATA.stopRouting.checkIn;

  it("uses the data's numbers and the numbers in its rules", () => {
    expect(CHECKIN_TIMING).toEqual({ leftFrameSec: 5, noMovementSec: 10, noAnswerSec: 30 });
    expect(checkIn.triggers).toEqual([
      "during a camera test, the person leaves the picture for 5 s",
      "during a camera test, no movement for 10 s",
    ]);
    expect(checkIn.noAnswer).toMatch(/within 30 s: one gentle chime/);
    expect(checkIn.noAnswer).toMatch(/no alarm, no repeat and no escalation/);
    expect(checkIn.setting).toMatch(/off by default/);
    expect(checkIn.setting).toMatch(/At the booth it is off and not shown/);
  });

  it("asks with one cue, whose question is the heading, and names the button to tap", () => {
    expect(checkIn.cue).toBe("check_are_you_ok");
    expect(cueLine(checkIn.cue).ar).toBe("هل أنت بخير؟ إذا كنت بخير، فالمس «أنا بخير».");
    expect(cueLine(checkIn.cue).en).toBe("Are you all right? If you are fine, tap “I am fine”.");
    // The cue never asks for a raised hand, a box or a spoken answer, and never names our team.
    for (const lang of ["ar", "en"] as const)
      expect(cueLine(checkIn.cue)[lang]).not.toMatch(/ارفع|مربع|قل|فريقنا|raise|box|say|team/i);
  });

  it("after 30 s shows one line to call someone nearby, with no 997 (D-016)", () => {
    expect(screenText("scr_no_response", "ar")).toBe(
      "إذا احتجت إلى مساعدة وكان بالقرب منك أحد، فنادِه الآن.",
    );
    expect(screenText("scr_no_response", "en")).toBe(
      "If you need help and anyone is near you, call out to them now.",
    );
    expect(screenText("scr_no_response", "en")).not.toMatch(/997/);
  });

  it("keeps none of the removed forms: zones, fall watch, helper, raised hand or rehearsal cues", () => {
    const ids = CHECK_DATA.cues.map((c) => c.id as string);
    expect(ids.filter((id) => id.startsWith("check_are_you_ok"))).toEqual(["check_are_you_ok"]);
    expect(ids).not.toContain("check_answer_zone");
    expect(ids).not.toContain("check_fine_practice");
    expect(Object.keys(checkIn).sort()).toEqual(
      [
        "answers",
        "cue",
        "decision",
        "leftFrameSec",
        "noAnswer",
        "noAnswerSec",
        "noMovementSec",
        "off",
        "setting",
        "triggers",
      ].sort(),
    );
  });
});

describe("CheckInDetector", () => {
  it("stays quiet through a normal arm raise, a normal side lean and normal chair stands", () => {
    expect(detect(disk("shoulder_abduction/chair/raise-right-9x16.json"))).toEqual([]);
    expect(detect(disk("shoulder_abduction/wheelchair/raise-left-16x9.json"))).toEqual([]);
    expect(detect(disk("trunk_control_seated/wheelchair/lean-left-occluded-9x16.json"))).toEqual([]);
    expect(detect(disk("chair_stand_30s/standing/stands-9x16.json"))).toEqual([]);
    expect(detect(disk("arm_curl_30s/chair/curl-right-9x16.json"))).toEqual([]);
  });

  it("sees the person out of the picture for 5 s, once, and again only after they were seen", () => {
    const d = new CheckInDetector();
    const out: { trigger: CheckInTrigger; t: number }[] = [];
    const feed = (t: number, lm: Parameters<CheckInDetector["feed"]>[1], aspect?: number) => {
      for (const trigger of d.feed(t, lm, aspect)) out.push({ trigger, t });
    };
    for (let t = 0; t <= 7000; t += 100) feed(t, null);
    expect(out).toEqual([{ trigger: "left_frame", t: 5000 }]);
    // Seen again for a moment re-arms it; an empty pose is nobody.
    const f = fixtureFrames(generate(spec({ durationSec: 1 })))[0];
    for (let t = 7100; t <= 7500; t += 100) feed(t, f.lm, f.aspect);
    for (let t = 7600; t <= 12_600; t += 100) feed(t, emptyPose());
    expect(out.map((e) => e.t)).toEqual([5000, 12_600]);
  });

  it("sees a walk out of the picture after 5 s out of view", () => {
    const fx = generate(spec({ durationSec: 9, subject: { motions: [{ kind: "leave", at: 1, speed: 1 }] } }));
    const events = detect(fx);
    expect(events.map((e) => e.trigger)).toEqual(["left_frame"]);
    expect(events[0].t).toBeGreaterThan(6);
  });

  it("does not watch the picture where the left frame rule is off", () => {
    const d = new CheckInDetector();
    const out: CheckInTrigger[] = [];
    for (let t = 0; t <= 8000; t += 100) out.push(...d.feed(t, null, undefined, { leftFrame: false }));
    expect(out).toEqual([]);
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
    expect(detect(still, { movement: false })).toEqual([]);
  });

  it("starts afresh after reset", () => {
    const d = new CheckInDetector();
    for (let t = 0; t <= 4000; t += 100) d.feed(t, null);
    d.reset();
    const out: CheckInTrigger[] = [];
    for (let t = 4100; t <= 8000; t += 100) out.push(...d.feed(t, null));
    expect(out).toEqual([]);
    for (let t = 8100; t <= 9100; t += 100) out.push(...d.feed(t, null));
    expect(out).toEqual(["left_frame"]);
  });
});
