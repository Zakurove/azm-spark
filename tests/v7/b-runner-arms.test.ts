/**
 * D-026 item 5 (change log B1-12): the arm raises keep v1's wrong arm retry and camera moved
 * recalibration (src/engine/modes/rangeTest.ts, RANGE_RULES and pictureShift), so a focused check of
 * one side catches the other arm rising, and a picture that moved never biases the angles.
 *
 *   wrong arm      the asked arm stays relaxed while the other arm is held at wrongArmDeg or more for
 *                  v1's hold: the attempt is repeated within the 2 extra and the arm to use is named
 *   camera moved   the mid hip and the face both shift the same way by more than cameraMovedShoulderWidths
 *                  of the calibration: the attempt is repeated without using a retry, and the start pose
 *                  is taken again after the rest (front view; a side view has no shoulder width to read)
 */
import { describe, expect, it } from "vitest";
import { RANGE_RULES } from "../../src/engine/modes/rangeTest";
import { RUNNER_RULES } from "../../src/engine/rom/runner";
import type { RomEvent } from "../../src/engine/rom/types";
import { testDef } from "../../src/movements/assessments";
import { abductionPose, cuesOf, drive, item, kinds, runner } from "./b-driver";
import { checkRomResult } from "../../server/modules/focus/validate";
import { ROM_DATA } from "../../src/movements/rom";
import { MOVEMENT_CASES, movementPose } from "./b-person";
import { shift } from "./b-poses";

const ALL = Array.from({ length: 33 }, (_, i) => i);
const attemptsOf = (evs: RomEvent[]) => kinds(evs, "attempt").map((e) => e.record);

describe("the arm raises keep v1's rules", () => {
  it("reads v1's numbers", () => {
    expect(RUNNER_RULES.wrongArmDeg).toBe(RANGE_RULES.wrongArmDeg);
    expect(RUNNER_RULES.wrongArmHoldSec).toBe(testDef("shoulder_abduction").holdSec);
    expect(RUNNER_RULES.cameraMovedShoulderWidths).toBe(RANGE_RULES.cameraMovedShoulderWidths);
    expect(RUNNER_RULES.persistSec).toBe(RANGE_RULES.persistSec);
  });
});

describe("the wrong arm (v1 spec 4.0 side labelling)", () => {
  it("the other arm rising while the asked arm stays down repeats the attempt and names the arm to use", () => {
    const r = runner("shoulder_abduction");
    let wrong = true;
    const d = drive(
      r,
      { rest: 0, target: () => 120, pose: (deg) => abductionPose(deg, wrong ? "left" : "right") },
      120,
      {
        frame: (_t, evs) => {
          if (evs.some((e) => e.kind === "attempt" && e.record.reasons.includes("wrong_arm"))) wrong = false;
        },
      },
    );
    const [first] = attemptsOf(d.events);
    expect(first).toMatchObject({ index: 0, outcome: "retry", reasons: ["wrong_arm"], value: null });
    expect(cuesOf(d.events)).toContain("check_right_arm");
    const res = r.finish(d.t);
    expect(res.status).toBe("measured");
    expect(res.retries).toBe(1);
    expect(Math.abs(res.value! - 120)).toBeLessThanOrEqual(2);
    // A repeat stays an event: the stored result holds only reasons the server takes.
    expect([...res.attempts, ...res.practice].some((a) => a.reasons.includes("wrong_arm"))).toBe(false);
  });

  it("uses the 2 extra attempts: a person who keeps raising the other arm is not measured today (quality)", () => {
    const r = runner("shoulder_abduction", { side: "left" });
    const d = drive(r, { rest: 0, target: () => 120, pose: (deg) => abductionPose(deg, "right") }, 120);
    const res = r.finish(d.t);
    expect(res.status).toBe("not_measured");
    expect(res.reason).toBe("quality");
    expect(attemptsOf(d.events).filter((a) => a.reasons.includes("wrong_arm"))).toHaveLength(3);
    expect(cuesOf(d.events)).toContain("check_left_arm");
  });

  it("is not watched outside the arm raises", () => {
    const c = MOVEMENT_CASES.elbow_flexion;
    const r = runner("elbow_flexion");
    const d = drive(
      r,
      { rest: c.rest, target: () => c.target, pose: (deg) => movementPose("elbow_flexion", "right")(deg) },
      90,
    );
    expect(attemptsOf(d.events).some((a) => a.reasons.includes("wrong_arm"))).toBe(false);
    expect(r.finish(d.t).status).toBe("measured");
  });
});

describe("the camera moved (v1 map 2.12)", () => {
  it("a picture that shifts after the start pose repeats the attempt without a retry and takes the start pose again", () => {
    const r = runner("shoulder_abduction");
    let from: number | null = null;
    const d = drive(
      r,
      {
        rest: 0,
        target: () => 120,
        pose: (deg, t) => {
          const px = abductionPose(deg, "right");
          // The stand slides 0.04 of the picture (0.2 shoulder widths) over 0.4 s, and stays there.
          const dx = from === null || t < from ? 0 : 0.04 * Math.min(1, (t - from) / 400);
          return dx ? shift(px, ALL, dx, 0) : px;
        },
      },
      120,
      {
        at: (t, rr) => {
          if (from === null && rr.phase === "attempt") from = t + 300;
        },
      },
    );
    const moved = attemptsOf(d.events).find((a) => a.reasons.includes("camera_moved"));
    expect(moved).toMatchObject({ outcome: "retry", index: 1, value: null });
    expect(cuesOf(d.events)).toContain("check_phone_still");
    // After the rest the start pose is taken again in the new picture, then the same attempt.
    const after = d.phases.filter((p) => p.t >= moved!.t1).map((p) => `${p.phase}:${p.attempt}`);
    expect(after.slice(0, 3)).toEqual(["rest:1", "calibrating:1", "attempt:1"]);
    const res = r.finish(d.t);
    expect(res.status).toBe("measured");
    expect(res.retries).toBe(0);
    expect(res.nValid).toBe(1);
  });

  it("a picture that never settles stops after the server's bound of repeats (not measured, quality)", () => {
    const r = runner("shoulder_abduction");
    let shifts = 0;
    let since: number | null = null;
    const d = drive(
      r,
      {
        rest: 0,
        target: () => 120,
        pose: (deg, t) => {
          const px = abductionPose(deg, "right");
          const dx = since === null || t < since ? 0 : 0.04 * Math.min(1, (t - since) / 400);
          return shift(px, ALL, shifts * 0.04 + dx, 0);
        },
      },
      240,
      {
        at: (t, rr) => {
          // The stand slides again in every attempt, after each new start pose.
          if (rr.phase === "attempt" && since === null) since = t + 300;
          if (rr.phase === "calibrating" && since !== null) {
            shifts++;
            since = null;
          }
        },
      },
    );
    const res = r.finish(d.t);
    expect(res.status).toBe("not_measured");
    expect(res.reason).toBe("quality");
    expect(res.quality.retries).toBeLessThanOrEqual(RUNNER_RULES.maxRetries + 3);
  });
});

describe("the repeats a stored result can carry (the server's quality.retries bound)", () => {
  it("camera moves, then the wrong arm twice: the result stays within the bound the server accepts", () => {
    const r = runner("shoulder_abduction");
    let opened = 0;
    let wasAttempt = false;
    let shifts = 0;
    let since: number | null = null;
    const d = drive(
      r,
      {
        rest: 0,
        target: () => 120,
        pose: (deg, t) => {
          // Attempts 1 to 4: the stand slides after the start pose; 5 and 6: the left arm rises.
          const wrong = opened >= 5 && opened <= 6;
          const px = wrong ? abductionPose(deg, "left") : abductionPose(deg, "right");
          const dx = since === null || t < since ? 0 : 0.04 * Math.min(1, (t - since) / 400);
          return shift(px, ALL, shifts * 0.04 + dx, 0);
        },
      },
      400,
      {
        at: (t, rr) => {
          const inAttempt = rr.phase === "attempt";
          if (inAttempt && !wasAttempt) opened++;
          wasAttempt = inAttempt;
          if (inAttempt && opened <= 4 && since === null) since = t + 300;
          if (rr.phase === "calibrating" && since !== null) {
            shifts++;
            since = null;
          }
        },
      },
    );
    const res = r.finish(d.t);
    expect(attemptsOf(d.events).filter((a) => a.reasons.includes("camera_moved")).length).toBeGreaterThan(0);
    expect(res.quality.retries).toBeLessThanOrEqual(
      RUNNER_RULES.maxRetries + ROM_DATA.engine.scoredAttemptsMax,
    );
    expect(
      checkRomResult(res as unknown as Record<string, unknown>, item("shoulder_abduction", "right")),
    ).toMatchObject({ ok: true });
  });
});

describe("the lines of the two repeats", () => {
  it("each has its voice line and caption (v1's check lines)", async () => {
    const script = (await import("../../src/app/voice-script.json")).default as Record<string, unknown>;
    for (const line of ["check_left_arm", "check_right_arm", "check_phone_still"])
      expect(script[line], line).toBeDefined();
  });
});
