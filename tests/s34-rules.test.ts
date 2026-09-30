/**
 * The pure rules of the camera screens (UX spec S34, 4.3, 4.8): check in arming, the cue queue and
 * its priorities, captions (short form and full sentence, never arTts), setup chips, retry fixes, and
 * the result payload as the server takes it.
 */
import { describe, expect, it } from "vitest";
import { DETAIL_SPEC } from "../server/modules/assessments/validate";
import { armingFor, camPart, type ArmingInput } from "../src/features/assessment/camera/arming";
import {
  captionOf,
  cueClass,
  CueQueue,
  cueSeverity,
  SPOKEN_EXTRA_MS,
} from "../src/features/assessment/camera/cues";
import { RESULT_DETAIL_KEYS } from "../src/features/assessment/camera/payload";
import {
  fixOf,
  retryIssueOf,
  SETUP_ISSUE_ORDER,
  setupChips,
  setupIssueCue,
  viewDiagramFor,
} from "../src/features/assessment/camera/view";
import { cueLine } from "../src/movements/assessments";

const base = (o: Partial<ArmingInput>): ArmingInput => ({
  part: "attempt",
  testId: "shoulder_abduction",
  now: 100_000,
  cueEndsAt: 0,
  goAt: null,
  endCueAt: null,
  standEndedAt: null,
  graceSec: 3,
  standLeftFrameSec: 60,
  ...o,
});

describe("check in arming (UX spec 4.8, O34-6)", () => {
  it("setup, calibration and the countdown: no movement and left frame off, sway on", () => {
    for (const part of ["setup", "calibrate", "countdown"] as const)
      expect(armingFor(base({ part }))).toEqual({ sway: true, movement: false, leftFrame: false });
  });

  it("practice and a scored attempt: all on once the cue ended plus 3 s", () => {
    for (const part of ["practice", "attempt"] as const) {
      expect(armingFor(base({ part }))).toEqual({ sway: true, movement: true, leftFrame: true });
      expect(armingFor(base({ part, cueEndsAt: 98_000 }))).toMatchObject({
        movement: false,
        leftFrame: true,
      });
    }
  });

  it("hold and pause there: no movement paused, left frame on", () => {
    expect(armingFor(base({ part: "hold" }))).toEqual({ sway: true, movement: false, leftFrame: true });
  });

  it("saved, retry and rests: left frame off, except the first 60 s after the chair stand", () => {
    for (const part of ["saved", "retry", "rest"] as const)
      expect(armingFor(base({ part }))).toEqual({ sway: true, movement: false, leftFrame: false });
    const stand = { testId: "chair_stand_30s" as const, part: "rest" as const };
    expect(armingFor(base({ ...stand, standEndedAt: 50_000 })).leftFrame).toBe(true);
    expect(armingFor(base({ ...stand, standEndedAt: 30_000 })).leftFrame).toBe(false);
  });

  it("timed tests: no movement from go plus 3 s, and off from the end cue", () => {
    const curl = { testId: "arm_curl_30s" as const };
    expect(armingFor(base({ ...curl, goAt: 98_000 })).movement).toBe(false);
    expect(armingFor(base({ ...curl, goAt: 90_000 })).movement).toBe(true);
    expect(armingFor(base({ ...curl, goAt: 60_000, endCueAt: 95_000 })).movement).toBe(false);
  });

  it("the side lean passes its own sway limit while leaning", () => {
    const lean = { testId: "trunk_control_seated" as const, leanSwayDeg: 40 };
    expect(armingFor(base({ ...lean, part: "attempt" })).swayDeg).toBe(40);
    expect(armingFor(base({ ...lean, part: "rest" })).swayDeg).toBeUndefined();
  });

  it("maps the flow state and the runner phase to a part", () => {
    expect(camPart("cam.setup", null, false)).toBe("setup");
    expect(camPart("cam.setup", "ready", false)).toBe("countdown");
    expect(camPart("cam.measure", "attempt", false)).toBe("attempt");
    expect(camPart("cam.measure", "attempt", true)).toBe("hold");
    expect(camPart("cam.measure", "rest", false)).toBe("rest");
    expect(camPart("cam.practice", "practice", false)).toBe("practice");
    expect(camPart("cam.practice", "calibrating", false)).toBe("calibrate");
    expect(camPart("cam.retry", "rest", false)).toBe("retry");
  });
});

describe("cues and captions (UX spec 4.3)", () => {
  it("captions show the short form and the display sentence, never the speech text", () => {
    const ar = captionOf("check_move_back", "ar");
    const line = cueLine("check_move_back");
    expect(ar.text).toBe(line.ar);
    expect(ar.text).not.toBe(line.arTts);
    expect(ar.short).toBe(line.short.ar);
    expect(captionOf("check_move_back", "en")).toMatchObject({ text: line.en, short: line.short.en });
  });

  it("severity: safety only for the stop and urgent lines and the check in, warn for coaching", () => {
    expect(cueSeverity("check_stop_now")).toBe("safety");
    expect(cueSeverity("check_are_you_ok")).toBe("safety");
    expect(cueSeverity("check_move_back")).toBe("warn");
    expect(cueSeverity("test_abd_side")).toBe("warn");
    expect(cueSeverity("test_abd_raise")).toBe("info");
    expect(cueSeverity("check_go")).toBe("info");
  });

  it("priority: safety, then check in, then setup, then timer, then retry, then phase", () => {
    const q = new CueQueue(() => "en");
    q.push({ id: "test_abd_raise", cls: "phase", speak: true, at: 0 });
    q.push({ id: "check_move_back", cls: "setup", speak: true, at: 0 });
    q.push({ id: "check_stop_now", cls: "safety", speak: true, at: 0 });
    expect(q.next(0)?.id).toBe("check_stop_now");
    // Lower classes wait until the line ends.
    expect(q.next(100)).toBeNull();
    const end = q.busyUntil;
    expect(q.next(end + 1)?.id).toBe("check_move_back");
  });

  it("a higher class interrupts a lower one; a stale line is dropped", () => {
    const q = new CueQueue(() => "ar");
    q.push({ id: "test_abd_raise", cls: "phase", speak: true, at: 0 });
    expect(q.next(0)?.interrupt).toBe(false);
    q.push({ id: "check_one_person", cls: "setup", speak: true, at: 10 });
    expect(q.next(10)).toMatchObject({ id: "check_one_person", interrupt: true });
    const q2 = new CueQueue(() => "ar");
    q2.push({ id: "count_3", cls: "phase", speak: true, at: 0, staleMs: 900 });
    expect(q2.next(2000)).toBeNull();
  });

  it("one setup line waits at a time: a newer issue replaces the waiting one", () => {
    const q = new CueQueue(() => "en");
    q.push({ id: "check_stop_now", cls: "safety", speak: true, at: 0 });
    q.next(0);
    q.push({ id: "check_move_back", cls: "setup", speak: true, at: 1 });
    q.push({ id: "check_move_closer", cls: "setup", speak: true, at: 2 });
    expect(q.next(q.busyUntil + 1)?.id).toBe("check_move_closer");
  });

  it("a spoken line lasts until its voice ends (CuePlayer onEnd), at most a little past the estimate", () => {
    const q = new CueQueue(() => "en");
    q.push({ id: "check_stop_now", cls: "safety", speak: true, at: 0 });
    q.push({ id: "check_move_back", cls: "setup", speak: true, at: 0 });
    q.next(0);
    const estimate = q.busyUntil;
    q.spoken("check_stop_now");
    expect(q.busyUntil).toBe(estimate + SPOKEN_EXTRA_MS);
    // Still playing past the estimate: the next line waits.
    expect(q.next(estimate + 100)).toBeNull();
    q.heardEnd("check_stop_now", estimate + 200);
    expect(q.next(estimate + 201)?.id).toBe("check_move_back");
    // An end heard before the voice was marked as started (a very short line) is kept.
    const q2 = new CueQueue(() => "en");
    q2.push({ id: "check_go", cls: "phase", speak: true, at: 0 });
    q2.next(0);
    q2.heardEnd("check_go", 50);
    q2.spoken("check_go");
    expect(q2.busyUntil).toBe(50);
  });

  it("classes by source", () => {
    expect(cueClass("check_whole_body", "setup")).toBe("setup");
    expect(cueClass("check_whole_body", "retry")).toBe("retry");
    expect(cueClass("check_are_you_ok", "runner")).toBe("checkin");
    expect(cueClass("check_urgent_call", "runner")).toBe("safety");
  });
});

describe("setup check words (S34c)", () => {
  it("always six chips in a fixed order; level is not available without a reading", () => {
    const chips = setupChips([], null);
    expect(Object.keys(chips)).toEqual(["level", "distance", "framing", "light", "people", "view"]);
    expect(chips.level).toBe("na");
    expect(setupChips([], { rollDeg: 1, pitchDeg: 0 }).level).toBe("ok");
  });

  it("each issue marks its chip; nobody seen marks the picture and judges nothing else", () => {
    expect(setupChips(["too_close"], null).distance).toBe("fix");
    expect(setupChips(["second_person"], null).people).toBe("fix");
    expect(setupChips(["wrong_view"], null).view).toBe("fix");
    expect(setupChips(["tilt"], { rollDeg: 9, pitchDeg: 0 }).level).toBe("fix");
    const none = setupChips(["no_person", "light", "too_far"], null);
    // Without a person no distance, light, people or view can be judged: never a green tick (review).
    expect(none).toMatchObject({ framing: "fix", light: "na", distance: "na", people: "na", view: "na" });
  });

  it("issue order follows the S34c table", () => {
    expect(SETUP_ISSUE_ORDER[0]).toBe("no_person");
    expect(SETUP_ISSUE_ORDER.indexOf("second_person")).toBeLessThan(SETUP_ISSUE_ORDER.indexOf("blocked"));
    expect(SETUP_ISSUE_ORDER.at(-1)).toBe("motion");
  });

  it("issue cues: blocked asks for a clear view, the view issue names the test's view, motion is a tip", () => {
    expect(setupIssueCue("blocked", "chair_stand_30s", "none", null, null)).toBe("check_clear_view");
    expect(setupIssueCue("wrong_view", "arm_curl_30s", "left", null, null)).toBe("check_left_side_to_phone");
    expect(setupIssueCue("wrong_view", "chair_stand_30s", "none", null, null)).toBe(
      "check_phone_angle_right",
    );
    expect(setupIssueCue("wrong_view", "chair_stand_30s", "none", "right", null)).toBe(
      "check_phone_angle_left",
    );
    expect(setupIssueCue("motion", "shoulder_abduction", "left", null, null)).toBeNull();
    expect(setupIssueCue("too_close", "shoulder_abduction", "left", null, "check_move_back")).toBe(
      "check_move_back",
    );
  });

  it("the top view diagram: the side for the arm curl, 45 degrees on the stronger side for the chair stand", () => {
    expect(viewDiagramFor("arm_curl_30s", "right", null)).toBe("side_right");
    expect(viewDiagramFor("chair_stand_30s", "none", null)).toBe("oblique_right");
    expect(viewDiagramFor("chair_stand_30s", "none", "right")).toBe("oblique_left");
    expect(viewDiagramFor("shoulder_abduction", "left", null)).toBeNull();
  });
});

describe("retry fixes (S34i)", () => {
  it("maps each issue to its fix and cue", () => {
    expect(fixOf("paused", "shoulder_abduction", "left", null)).toEqual({
      fix: "paused",
      cue: "check_one_person",
    });
    // R3C-24: a touch speaks the helper line (the UI), never check_one_person.
    expect(fixOf("touched", "shoulder_abduction", "left", null)).toEqual({ fix: "touched", cue: null });
    expect(fixOf("not_visible", "arm_curl_30s", "left", null)).toEqual({
      fix: "not_visible_arm",
      cue: "check_sleeves",
    });
    expect(fixOf("not_visible", "chair_stand_30s", "none", null)).toEqual({
      fix: "not_visible",
      cue: "check_whole_body",
    });
    expect(fixOf("plane_flexion", "shoulder_abduction", "left", null)).toEqual({
      fix: "plane",
      cue: "test_abd_side",
    });
    expect(fixOf("trunk_lean", "shoulder_abduction", "left", null)).toEqual({
      fix: "lean",
      cue: "test_abd_still",
    });
    expect(fixOf("wrong_arm", "shoulder_abduction", "right", null)).toEqual({
      fix: "wrong_side",
      cue: "check_right_arm",
    });
    expect(fixOf("wrong_side", "trunk_control_seated", "left", null)).toEqual({
      fix: "wrong_side",
      cue: "test_trunk_lean_left",
    });
    expect(fixOf("phone_moved", "arm_curl_30s", "left", null)).toEqual({
      fix: "phone_moved",
      cue: "check_phone_still",
    });
    for (const r of ["forward_bend", "rotation", "hip_slide"])
      expect(fixOf(r, "trunk_control_seated", "left", null)).toEqual({
        fix: "lean_form",
        cue: "test_trunk_seat",
      });
    expect(fixOf("low_fps", "chair_stand_30s", "none", null)).toEqual({
      fix: "low_fps",
      cue: "check_try_again",
    });
    expect(fixOf("too_far", "chair_stand_30s", "none", null).cue).toBe("check_move_closer");
  });

  it("the first reason decides", () => {
    expect(retryIssueOf(["plane_flexion", "trunk_lean"])).toBe("plane_flexion");
    expect(retryIssueOf([])).toBe("out_of_frame");
  });
});

describe("the result payload (contract v2 E)", () => {
  it("sends only the detail keys the server checks", () => {
    expect([...RESULT_DETAIL_KEYS].sort()).toEqual(Object.keys(DETAIL_SPEC).sort());
  });
});
