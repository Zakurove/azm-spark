/**
 * Range test runner, shoulder_abduction (spec 4.1, contract v2 F), on generated landmark
 * recordings (tests/fixtures/gen.ts) of every profile at 9:16, 16:9 and 1:1.
 */
import { describe, expect, it } from "vitest";
import {
  createRunner,
  RANGE_RULES,
  RangeTestRunner,
  type SideResult,
  type TestEvent,
} from "../src/engine/modes";
import { CHECK_DATA, testDef } from "../src/movements/assessments";
import type { AspectName, GenSpec, MotionSpec, Profile } from "./fixtures/gen";
import {
  ASPECTS,
  editSubject,
  framesOf,
  mirrorFrames,
  raises,
  raiseStarts,
  RAISE,
  run,
  spec,
} from "./fixtures/runners";

const DEF = testDef("shoulder_abduction");
type Side = "left" | "right";

/** Practice plus 3 scored raises. */
const FOUR = raiseStarts(4);
const DURATION = FOUR[3] + 12;

function abd(
  profile: Profile,
  aspect: AspectName,
  motions: MotionSpec[],
  seed: number,
  extra: Partial<GenSpec> = {},
  durationSec = DURATION,
) {
  return framesOf(spec("shoulder_abduction", profile, aspect, motions, durationSec, seed, extra));
}

function measure(frames: ReturnType<typeof abd>["frames"], side: Side, opts = {}, env = { rollDeg: 0 }) {
  const r = run(new RangeTestRunner(DEF, side, opts), frames, env);
  return { ...r, res: r.side(side) };
}

const valid = (r: SideResult) => r.attempts.filter((a) => a.outcome === "valid");

/** Each profile with the arm it raises and the asked peak. */
const PROFILE_CASES: { profile: Profile; side: Side; peak: number }[] = [
  { profile: "chair", side: "right", peak: 150 },
  { profile: "wheelchair", side: "left", peak: 140 },
  { profile: "standing", side: "right", peak: 165 },
  { profile: "weaker_left", side: "left", peak: 150 },
  { profile: "weaker_right", side: "right", peak: 150 },
];

describe("shoulder_abduction: the known true peak is recovered within 2 degrees", () => {
  let seed = 200;
  for (const c of PROFILE_CASES) {
    for (const aspect of ASPECTS) {
      const s = seed++;
      it(`${c.profile}, ${c.side} arm, ${aspect}`, () => {
        const { fx, frames } = abd(c.profile, aspect, raises(c.side, c.peak, FOUR), s);
        const truth = fx.truth.armPeakDeg[c.side];
        const { res, result } = measure(frames, c.side);
        expect(result.completed).toBe(true);
        expect(res.status).toBe("measured");
        expect(res.nValid).toBe(3);
        expect(res.attempts).toHaveLength(3);
        expect(res.practice).toHaveLength(1);
        expect(res.retried).toHaveLength(0);
        expect(Math.abs(res.value! - truth)).toBeLessThanOrEqual(2);
        expect(Math.abs(res.median! - truth)).toBeLessThanOrEqual(2);
        for (const a of res.attempts) expect(Math.abs(a.value! - truth)).toBeLessThanOrEqual(2);
        // Hips hidden by the wheelchair at calibration: the gravity reference, from the phone roll.
        const gravity = c.profile === "wheelchair";
        expect(res.detail.reference).toBe(gravity ? "gravity" : "trunk");
        expect(res.flags.includes("gravity_reference")).toBe(gravity);
        expect(res.flags).not.toContain("inconsistent");
        expect(res.quality.ok).toBe(true);
        expect(res.quality.medianFps).toBeCloseTo(15, 0);
      });
    }
  }

  for (const peak of [45, 90, 120, 175]) {
    it(`a raise to ${peak} degrees reads ${peak}`, () => {
      const { fx, frames } = abd("chair", "9:16", raises("right", peak, FOUR), 230 + peak);
      const { res } = measure(frames, "right");
      expect(Math.abs(res.value! - fx.truth.armPeakDeg.right)).toBeLessThanOrEqual(2);
      expect(res.nValid).toBe(3);
      // Below 70 degrees the plane window is never reached: the check cannot run (R3C-36 (9)).
      expect(res.attempts[0].flags.includes("planeUnchecked")).toBe(peak < 70);
    });
  }
});

describe("the 0.5 s sustained peak", () => {
  /** A raise to 90 held 4 s with a spike to 150 lasting `spikeSec` in all (ramps included) in the hold. */
  function spiky(spikeSec: number): MotionSpec[] {
    const ramp = 0.02;
    return FOUR.flatMap((start) => [
      { kind: "arm_raise", side: "right", peak: 90, start, rise: 3, hold: 4, lower: 3 } as MotionSpec,
      {
        kind: "arm_raise",
        side: "right",
        peak: 150,
        start: start + 4.2,
        rise: ramp,
        hold: spikeSec - 2 * ramp,
        lower: ramp,
      },
    ]);
  }

  for (const [fps, spikeSec] of [
    [15, 0.3],
    [15, 0.45],
    [30, 0.3],
    [30, 0.45],
    [12, 0.4],
  ] as const) {
    it(`a ${spikeSec} s spike does not count at ${fps} fps`, () => {
      const { frames } = abd("chair", "9:16", spiky(spikeSec), 240 + fps, { fps }, DURATION + 3);
      const { res, events } = measure(frames, "right");
      expect(res.nValid).toBe(3);
      // The value is the 90 degree hold (within the landmark noise at the spike's edges), never the spike.
      for (const a of res.attempts) {
        expect(a.value!).toBeGreaterThanOrEqual(88);
        expect(a.value!).toBeLessThanOrEqual(95);
      }
      // The live number shows the spike, the held peak never does.
      const live = events.filter((e): e is Extract<TestEvent, { kind: "live" }> => e.kind === "live");
      const peaks = events.filter((e): e is Extract<TestEvent, { kind: "peak" }> => e.kind === "peak");
      expect(Math.max(...live.map((e) => e.value))).toBeGreaterThan(130);
      expect(Math.max(...peaks.map((e) => e.value))).toBeLessThanOrEqual(95);
    });
  }

  it("a top held for 0.7 s counts", () => {
    const { frames } = abd("chair", "9:16", spiky(0.7), 241, {}, DURATION + 3);
    const { res } = measure(frames, "right");
    for (const a of res.attempts) expect(Math.abs(a.value! - 150)).toBeLessThanOrEqual(3);
  });
});

describe("validity rules (spec 4.1)", () => {
  const lean = (deg: number): MotionSpec[] =>
    FOUR.slice(1).map((start) => ({
      kind: "side_lean",
      toward: "left",
      peak: deg,
      start: start + 1,
      rise: 1.5,
      hold: 3,
      back: 1.5,
    }));

  it("a trunk lean over 10 degrees invalidates the attempt and cues test_abd_still", () => {
    const { frames } = abd("chair", "9:16", [...raises("right", 150, FOUR), ...lean(13)], 250);
    const { res, cues } = measure(frames, "right");
    expect(res.attempts).toHaveLength(3);
    for (const a of res.attempts) {
      expect(a.outcome).toBe("invalid");
      expect(a.reasons).toContain("trunk_lean");
      expect(a.detail.trunkLeanMax as number).toBeGreaterThan(10);
    }
    expect(cues).toContain("test_abd_still");
    expect(res.nValid).toBe(0);
    expect(res.value).toBeNull();
    expect(res.status).toBe("not_measured");
  });

  it("a lean between 5 and 10 degrees only coaches; the angle against the trunk stays true", () => {
    const { fx, frames } = abd("chair", "16:9", [...raises("right", 150, FOUR), ...lean(7.5)], 251);
    const { res, cues } = measure(frames, "right");
    expect(cues).toContain("test_abd_still");
    expect(res.nValid).toBe(3);
    expect(Math.abs(res.value! - fx.truth.armPeakDeg.right)).toBeLessThanOrEqual(2);
  });

  it("gravity reference: a sideways shift of the shoulders over 0.15 shoulder widths invalidates", () => {
    const { frames } = abd("wheelchair", "9:16", [...raises("left", 140, FOUR), ...lean(-12)], 252);
    const { res } = measure(frames, "left");
    expect(res.detail.reference).toBe("gravity");
    for (const a of res.attempts) expect(a.reasons).toContain("trunk_lean");
  });

  it("a lift in front of the body (flexion plane) is plane_flexion and cues test_abd_side", () => {
    const { frames } = abd("chair", "9:16", raises("right", 150, FOUR, 75), 253);
    const { res, cues } = measure(frames, "right");
    expect(cues).toContain("test_abd_side");
    for (const a of res.attempts) {
      expect(a.outcome).toBe("invalid");
      expect(a.reasons).toContain("plane_flexion");
    }
  });

  it("a lift in a 45 degree plane fails the plane check", () => {
    const { frames } = abd("chair", "16:9", raises("right", 150, FOUR, 45), 254);
    const { res } = measure(frames, "right");
    for (const a of res.attempts) {
      expect(a.outcome).toBe("invalid");
      expect(a.reasons.some((r) => r === "plane_flexion" || r === "plane_unconfirmed")).toBe(true);
    }
  });

  it("the other hand holding the tested arm is an assisted lift: invalid", () => {
    const assist: MotionSpec[] = FOUR.slice(1).map((start) => ({
      kind: "assist",
      hand: "left",
      from: start + 0.5,
      to: start + RAISE.rise + RAISE.hold + 1,
    }));
    const { frames } = abd("chair", "9:16", [...raises("right", 120, FOUR), ...assist], 255);
    const { res } = measure(frames, "right");
    for (const a of res.attempts) expect(a.reasons).toContain("assisted");
    expect(res.nValid).toBe(0);
  });

  it("a trunk rotation shrinking the shoulder width over 15 percent is invalid", () => {
    const turn: MotionSpec[] = FOUR.slice(1).map((start) => ({
      kind: "turn",
      deg: 38,
      start: start + 0.5,
      rise: 1,
      hold: 4,
      back: 1,
    }));
    const { frames } = abd("chair", "9:16", [...raises("right", 130, FOUR), ...turn], 256);
    const { res } = measure(frames, "right");
    for (const a of res.attempts) {
      expect(a.reasons).toContain("trunk_rotation");
      expect(a.detail.shoulderShrinkMax as number).toBeGreaterThan(0.15);
    }
  });

  it("an elbow bent under 150 degrees flags bentElbow and stays valid", () => {
    const { frames } = abd("chair", "9:16", raises("right", 140, FOUR), 257, {
      // Bent in the picture plane; a bend toward the camera cannot be seen from the front.
      subject: { arms: { right: { elbow: 45, across: 1 } } },
    });
    const { res } = measure(frames, "right");
    expect(res.nValid).toBe(3);
    expect(res.flags).toContain("bentElbow");
    expect(res.detail.bentElbow).toBe(true);
    expect(res.attempts[0].detail.elbowDeg).toBeLessThan(150);
  });

  it("a straight elbow does not flag, and the elbow reads unknown when the wrist is unseen", () => {
    const { frames } = abd("chair", "9:16", raises("right", 140, FOUR), 258, {
      occlusions: [{ landmarks: [16], from: 0, to: DURATION }],
    });
    const { res } = measure(frames, "right");
    expect(res.nValid).toBe(3);
    expect(res.detail.bentElbow).toBe("unknown");
    expect(res.flags).not.toContain("bentElbow");
  });

  it("valid attempts spreading over 15 degrees flag inconsistent; best and median are stored", () => {
    const { frames } = abd("chair", "9:16", raises("right", [150, 120, 150, 135], FOUR), 259);
    const { res } = measure(frames, "right");
    expect(res.nValid).toBe(3);
    expect(res.flags).toContain("inconsistent");
    expect(Math.abs(res.value! - 150)).toBeLessThanOrEqual(2);
    expect(Math.abs(res.median! - 135)).toBeLessThanOrEqual(2);
    expect(res.detail.spreadDeg as number).toBeGreaterThan(15);
  });

  it("an arm past the vertical is clamped at 180 and flagged pastVertical, never folded back", () => {
    const { frames } = abd("chair", "9:16", raises("right", 195, FOUR), 260);
    const { res } = measure(frames, "right");
    expect(res.value).toBe(180);
    expect(res.flags).toContain("pastVertical");
    expect(res.detail.pastVertical).toBe(true);
  });

  it("a shoulder lifted toward the ear cues test_abd_relax_shoulder (coaching only)", () => {
    const base = abd("chair", "9:16", raises("right", 140, FOUR), 261);
    // Bring the right ear down toward the right shoulder while the arm is up (a shrug seen from the front).
    const frames = editSubject(base.fx, base.frames, (p, t) => {
      const up = FOUR.some((s) => t / 1000 > s + 1.5 && t / 1000 < s + RAISE.rise + RAISE.hold + 0.5);
      if (up) p[8] = { ...p[8], y: p[8].y + 0.6 * (p[12].y - p[8].y) };
      return p;
    });
    const { res, cues } = measure(frames, "right");
    expect(cues).toContain("test_abd_relax_shoulder");
    expect(res.nValid).toBe(3);
    expect(res.attempts[0].detail.shrug as number).toBeGreaterThan(RANGE_RULES.shrugCue);
  });
});

describe("side labelling (spec 4.0)", () => {
  it("the wrong arm raised is retried with check_try_again and never scored", () => {
    const starts = raiseStarts(5);
    const motions = [
      ...raises("right", 150, [starts[0]]),
      ...raises("left", 150, [starts[1]]),
      ...raises("right", 150, starts.slice(2)),
    ];
    const { fx, frames } = abd("chair", "9:16", motions, 270, {}, starts[4] + 12);
    const { res, events } = measure(frames, "right");
    expect(res.retried).toHaveLength(1);
    expect(res.retried[0].reasons).toEqual(["wrong_arm"]);
    const retryAt = events.find((e) => e.kind === "attempt" && e.outcome === "retry")!.t;
    expect(events.some((e) => e.kind === "cue" && e.cue === "check_try_again" && e.t === retryAt)).toBe(true);
    expect(res.attempts).toHaveLength(3);
    expect(res.nValid).toBe(3);
    expect(Math.abs(res.value! - fx.truth.armPeakDeg.right)).toBeLessThanOrEqual(2);
  });

  it("the wrong arm every time runs out of retries: not measured today (quality)", () => {
    const starts = raiseStarts(5);
    const { frames } = abd("chair", "9:16", raises("left", 150, starts), 271, {}, starts[4] + 12);
    const { res } = measure(frames, "right");
    expect(res.status).toBe("not_measured");
    expect(res.reason).toBe("quality");
    expect(res.retried.length).toBe(DEF.maxRetries + 1);
    expect(res.attempts).toHaveLength(0);
  });

  it("a mirrored camera: the person's left arm is measured with mirrored set, and retried without", () => {
    const { fx, frames } = abd("chair", "9:16", raises("left", 150, FOUR), 272);
    const mirrored = mirrorFrames(frames);
    const ok = measure(mirrored, "left", { mirrored: true }).res;
    expect(ok.nValid).toBe(3);
    expect(Math.abs(ok.value! - fx.truth.armPeakDeg.left)).toBeLessThanOrEqual(2);
    // Without the flag the model's labels say the right arm moved.
    const wrong = measure(mirrored, "left").res;
    expect(wrong.status).toBe("not_measured");
    expect(wrong.retried.every((a) => a.reasons.includes("wrong_arm"))).toBe(true);
  });
});

describe("references and occlusion", () => {
  it("hips hidden after calibration: the fixed mid hip keeps the trunk reference", () => {
    const base = abd("chair", "9:16", raises("right", 150, FOUR), 280, {
      occlusions: [{ landmarks: [23, 24], from: 1.2, to: DURATION, visibility: 0.1 }],
    });
    // The model's guesses for the hidden hips drift away; the runner must not follow them.
    const frames = editSubject(base.fx, base.frames, (p, t) => {
      const drift = (Math.max(0, t - 1200) / 1000) * 0.003;
      for (const k of [23, 24]) p[k] = { ...p[k], x: p[k].x + drift, y: p[k].y - drift };
      return p;
    });
    const { res } = measure(frames, "right");
    expect(res.detail.reference).toBe("trunk");
    expect(res.nValid).toBe(3);
    expect(Math.abs(res.value! - base.fx.truth.armPeakDeg.right)).toBeLessThanOrEqual(2);
  });

  it("hips never seen and no orientation reading: gravity mode is not allowed (quality)", () => {
    const { frames } = abd("wheelchair", "9:16", raises("left", 140, FOUR), 281);
    const r = run(new RangeTestRunner(DEF, "left"), frames, {});
    const res = r.side("left");
    expect(res.status).toBe("not_measured");
    expect(res.reason).toBe("quality");
    expect(res.attempts).toHaveLength(0);
    expect(r.result.completed).toBe(true);
  });

  it("gravity reference subtracts the phone roll and stores it per attempt", () => {
    const { fx, frames } = abd("wheelchair", "16:9", raises("left", 140, FOUR), 282, {
      camera: { rollDeg: 4 },
    });
    const truth = fx.truth.armPeakDeg.left;
    const good = measure(frames, "left", {}, { rollDeg: 4 }).res;
    expect(Math.abs(good.value! - truth)).toBeLessThanOrEqual(2);
    expect(good.attempts[0].detail.phoneRollDeg).toBe(4);
    const unaware = measure(frames, "left", {}, { rollDeg: 0 }).res;
    expect(Math.abs(unaware.value! - truth)).toBeGreaterThan(2.5);
  });
});

describe("a second person", () => {
  it("a helper beside the person does not pause scoring", () => {
    const { fx, frames } = abd("weaker_left", "9:16", raises("left", 150, FOUR), 290, {
      helper: { x: -0.8, z: -0.3, yaw: 20 },
      shuffle: true,
    });
    const { res } = measure(frames, "left");
    expect(res.nValid).toBe(3);
    expect(res.quality.maxPausedShare).toBe(0);
    expect(Math.abs(res.value! - fx.truth.armPeakDeg.left)).toBeLessThanOrEqual(2);
  });

  it("a helper walking between the phone and the person pauses scoring and the attempt is repeated", () => {
    const starts = raiseStarts(5);
    const walkStart = starts[1] + 0.5;
    const { fx, frames } = abd(
      "weaker_right",
      "16:9",
      raises("right", 150, starts),
      291,
      { helper: { x: -1.6, z: 0.6, walk: { toX: 1.6, start: walkStart, speed: 0.4 } }, shuffle: true },
      starts[4] + 12,
    );
    const { res, events } = measure(frames, "right");
    const crossing = fx.truth.events.find((e) => e.kind === "crossing")!;
    // No live number while the helper is in the way: never when the model lost the subject, and a
    // gap of well over half a second while the helper passes.
    const live = events.filter((e) => e.kind === "live").map((e) => e.t);
    const hidden = new Set(frames.filter((_, i) => fx.truth.subjectIndex[i] < 0).map((f) => f.t));
    expect(hidden.size).toBeGreaterThan(0);
    for (const t of live) expect(hidden.has(t)).toBe(false);
    const inCrossing = live.filter((t) => t / 1000 >= crossing.from && t / 1000 <= crossing.to);
    const gaps = inCrossing.slice(1).map((t, i) => t - inCrossing[i]);
    expect(Math.max(...gaps)).toBeGreaterThan(700);
    expect(events.some((e) => e.kind === "cue" && e.cue === "check_one_person")).toBe(true);
    expect(res.retried).toHaveLength(1);
    expect(res.retried[0].reasons).toContain("paused");
    expect(res.nValid).toBe(3);
    expect(Math.abs(res.value! - fx.truth.armPeakDeg.right)).toBeLessThanOrEqual(2);
  });

  it("a helper touching the person fails the attempt", () => {
    const starts = raiseStarts(5);
    const { frames } = abd(
      "chair",
      "9:16",
      raises("right", 140, starts),
      292,
      {
        helper: {
          x: 0.55,
          z: -0.2,
          yaw: -30,
          touch: { from: starts[1] + 1, to: starts[1] + 3, shoulder: "left" },
        },
      },
      starts[4] + 12,
    );
    const { res } = measure(frames, "right");
    expect(res.retried[0].reasons).toContain("touched");
    expect(res.nValid).toBe(3);
  });
});

describe("repeatability (F1 criterion)", () => {
  it("the same recording gives the same result", () => {
    const { frames } = abd("chair", "9:16", raises("right", 150, FOUR), 300);
    const a = measure(frames, "right").res;
    const b = measure(frames, "right").res;
    expect(b).toEqual(a);
  });

  for (const c of PROFILE_CASES) {
    it(`${c.profile}: repeated recordings of the same movement stay within 5 degrees`, () => {
      const values: number[] = [];
      for (const [i, aspect] of (["9:16", "16:9", "1:1", "9:16", "16:9"] as const).entries()) {
        const { frames } = abd(c.profile, aspect, raises(c.side, c.peak, FOUR), 310 + i * 7);
        const res = measure(frames, c.side).res;
        values.push(res.value!, ...valid(res).map((a) => a.value!));
      }
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(5);
    });
  }
});

describe("check in triggers (spec 4.0)", () => {
  it("no movement for 10 s during an attempt, and leaving the frame, raise the check in", () => {
    // The practice lift only, then the person sits still through attempt 1 and leaves later.
    const motions: MotionSpec[] = [...raises("right", 140, [1.5]), { kind: "leave", at: 34 }];
    const { frames } = abd("chair", "9:16", motions, 330, {}, 38);
    const { events, res } = measure(frames, "right");
    const triggers = events.flatMap((e) => (e.kind === "checkin" ? [{ trigger: e.trigger, t: e.t }] : []));
    const still = triggers.find((x) => x.trigger === "no_movement");
    const attempt1 = events.find((e) => e.kind === "phase" && e.phase === "attempt")!.t;
    expect(still).toBeDefined();
    expect(still!.t - attempt1).toBeGreaterThanOrEqual(10_000);
    expect(triggers.some((x) => x.trigger === "left_frame" && x.t > 34_000)).toBe(true);
    // An attempt with no lift ends at its timeout and is measured as is.
    expect(res.attempts[0].value!).toBeLessThan(RANGE_RULES.relaxedMaxDeg);
  });
});

describe("flow and events", () => {
  const { frames } = abd("chair", "9:16", raises("right", 150, FOUR), 320);
  const r = measure(frames, "right");

  it("calibrates, practises once, then scores 3 attempts with rests between", () => {
    const phases = r.events.filter((e) => e.kind === "phase").map((e) => (e as { phase: string }).phase);
    expect(phases).toEqual([
      "calibrating",
      "practice",
      "rest",
      "attempt",
      "rest",
      "attempt",
      "rest",
      "attempt",
      "done",
    ]);
    expect(r.events[r.events.length - 1].kind).toBe("done");
    expect(r.cues.slice(0, 3)).toEqual(["test_abd_start", "check_right_arm", "test_abd_arms_rest"]);
    expect(r.cues.filter((c) => c === "check_saved")).toHaveLength(3);
    expect(r.cues.filter((c) => c === "test_abd_raise")).toHaveLength(4);
  });

  it("cues hold then lower in every attempt, in that order", () => {
    const attempts = r.events.filter(
      (e) => e.kind === "phase" && (e.phase === "practice" || e.phase === "attempt"),
    );
    for (const a of attempts) {
      const end = r.events.find((e) => e.kind === "attempt" && e.t > a.t)!.t;
      const cs = r.events
        .filter((e) => e.kind === "cue" && e.t >= a.t && e.t <= end)
        .map((e) => (e as { cue: string }).cue);
      expect(cs.indexOf("test_abd_hold")).toBeGreaterThan(-1);
      expect(cs.indexOf("test_abd_lower")).toBeGreaterThan(cs.indexOf("test_abd_hold"));
    }
  });

  it("counts the rest down once per whole second", () => {
    const times = r.events
      .filter((e) => e.kind === "time")
      .map((e) => (e as { remainingSec: number }).remainingSec);
    expect(times.slice(0, 5)).toEqual([5, 4, 3, 2, 1]);
  });

  it("every cue is a check cue of the data, and the test's own cues are in its cue list", () => {
    const ids = new Set(CHECK_DATA.cues.map((c) => c.id));
    for (const c of r.cues) expect(ids.has(c as never)).toBe(true);
    for (const c of r.cues.filter((c) => c.startsWith("test_"))) expect(DEF.cues).toContain(c);
  });

  it("peaks only grow within an attempt and live values stay between 0 and 180", () => {
    for (const e of r.events) if (e.kind === "live") expect(e.value).toBeGreaterThanOrEqual(0);
    for (const e of r.events) if (e.kind === "live") expect(e.value).toBeLessThanOrEqual(180);
    let last = -1;
    for (const e of r.events) {
      if (e.kind === "phase") last = -1;
      if (e.kind === "peak") {
        expect(e.value).toBeGreaterThan(last);
        last = e.value;
      }
    }
  });

  it("stores the per attempt detail of spec 4.1", () => {
    const a = r.res.attempts[0];
    for (const k of [
      "elbowDeg",
      "bentElbow",
      "pastVertical",
      "shrug",
      "planeZ",
      "planeOkSec",
      "trunkLeanMax",
    ])
      expect(a.detail).toHaveProperty(k);
    expect(a.detail.planeOkSec as number).toBeGreaterThanOrEqual(RANGE_RULES.planeMinSec);
    expect(r.res.detail).toMatchObject({ reference: "trunk", bentElbow: false, pastVertical: false });
    expect(r.res.unit).toBe("deg");
  });

  it("finish before the end reads stopped, with the attempts so far and their quality", () => {
    const cut = frames.filter((f) => f.t < 20000);
    const x = run(new RangeTestRunner(DEF, "right"), cut, { rollDeg: 0 });
    const res = x.side("right");
    expect(x.result.completed).toBe(false);
    expect(res.status).toBe("stopped");
    expect(res.practice).toHaveLength(1);
    expect(res.practice[0].quality.ok).toBe(true);
  });

  it("an elbow the camera cannot see after calibration is retried with the sleeves cue, then not measured", () => {
    const starts = raiseStarts(5);
    const { frames: f } = abd(
      "chair",
      "9:16",
      raises("right", 140, starts),
      321,
      { occlusions: [{ landmarks: [14], from: starts[1] - 1, to: 200 }] },
      120,
    );
    const x = measure(f, "right");
    expect(x.res.status).toBe("not_measured");
    expect(x.res.reason).toBe("quality");
    expect(x.res.quality.issues).toContain("not_visible");
    expect(x.cues).toContain("check_sleeves");
  });
});

describe("createRunner", () => {
  it("builds the range test for shoulder_abduction and needs a side", () => {
    const r = createRunner(DEF, "left");
    expect(r).toBeInstanceOf(RangeTestRunner);
    expect(r.sides).toEqual(["left"]);
    expect(r.kind).toBe("range_test");
    expect(() => createRunner(DEF, "none")).toThrow(/side/);
  });

  it("builds the timed counts from timedCount.ts", () => {
    expect(createRunner(testDef("arm_curl_30s"), "right").kind).toBe("timed_count");
    expect(createRunner(testDef("chair_stand_30s"), "none").sides).toEqual(["none"]);
  });

  it("ties the runner's numbers to the spec data", () => {
    expect(DEF.holdSec).toBe(0.5);
    expect(DEF.practice).toBe(1);
    expect(DEF.attempts).toBe(3);
    expect(DEF.maxRetries).toBe(2);
    expect(DEF.validity.trunkLeanCoachDeg).toBe(5);
    expect(DEF.validity.trunkLeanInvalidDeg).toBe(10);
    expect(DEF.validity.upperArmLengthMinRatio).toBe(0.85);
    expect(DEF.validity.elbowFlagBelowDeg).toBe(150);
    expect(DEF.validity.attemptSpreadFlagDeg).toBe(15);
    expect(DEF.calibration).toMatch(/at least 1 s/);
    expect(DEF.metric.planeCheck).toMatch(/between 70 and 110 degrees/);
    expect(DEF.metric.planeCheck).toMatch(/below 60 to above 120/);
    expect(DEF.metric.planeCheck).toMatch(/at least 0\.3 s/);
    expect(DEF.metric.fallback).toMatch(/cue above 0\.08, invalid above 0\.15/);
    expect(RANGE_RULES.calibrationSec).toBe(1);
    expect(RANGE_RULES.planeMinSec).toBe(0.3);
    expect(RANGE_RULES.gravityLeanCue).toBe(0.08);
    expect(RANGE_RULES.gravityLeanInvalid).toBe(0.15);
  });
});

describe("calibration with tremor or dyskinesia (O35)", () => {
  /**
   * The tested arm swings `amp` degrees each way around a point `offset` degrees out from where it
   * hangs, at `hz`, until `until` s (rotated about the shoulder in pixel space).
   */
  function tremor(
    fx: ReturnType<typeof abd>["fx"],
    frames: ReturnType<typeof abd>["frames"],
    side: Side,
    amp: number,
    hz: number,
    until: number,
    offset = 0,
  ) {
    const aspect = frames[0].aspect ?? 1;
    const [S, E, W] = side === "right" ? [12, 14, 16] : [11, 13, 15];
    return editSubject(fx, frames, (p, t) => {
      if (t / 1000 > until) return p;
      const d =
        (((offset + amp * Math.sin(2 * Math.PI * hz * (t / 1000))) * Math.PI) / 180) *
        (side === "right" ? 1 : -1);
      const turn = (k: number) => {
        const x = (p[k].x - p[S].x) * aspect;
        const y = p[k].y - p[S].y;
        p[k] = {
          ...p[k],
          x: p[S].x + (x * Math.cos(d) - y * Math.sin(d)) / aspect,
          y: p[S].y + x * Math.sin(d) + y * Math.cos(d),
        };
      };
      turn(E);
      turn(W);
      return p;
    });
  }
  const startsLate = raiseStarts(4, 26);

  it("widens the stillness tolerance after 10 s, and the widened calibration keeps the trunk reference within 3 degrees", () => {
    const { fx, frames } = abd(
      "chair",
      "9:16",
      raises("right", 150, startsLate),
      811,
      {},
      startsLate[3] + 12,
    );
    const still = new RangeTestRunner(DEF, "right");
    run(still, frames, { rollDeg: 0 });
    const moving = new RangeTestRunner(DEF, "right");
    // About 18 degrees of swing (a little less after the running median): more than the default
    // 10, within the widened 20.
    const r = run(moving, tremor(fx, frames, "right", 9, 1, 25, 10), { rollDeg: 0 });
    const calAt = moving.calibration!.t - frames[0].t;
    expect(still.calibration!.t - frames[0].t).toBeLessThan(3000);
    expect(calAt).toBeGreaterThanOrEqual(10000);
    expect(calAt).toBeLessThan(20000);
    expect(r.events.some((e) => e.kind === "ask")).toBe(false);
    expect(Math.abs(moving.calibration!.lean - still.calibration!.lean)).toBeLessThanOrEqual(3);
    expect(r.side("right").status).toBe("measured");
  });

  it("offers to try again at 20 s, and after a second round of 20 s the test is not measured (quality)", () => {
    // The arm never rests: a large swing out past the relaxed range every second.
    const { fx, frames } = abd("chair", "9:16", [], 812, {}, 50);
    const swinging = tremor(fx, frames, "right", 15, 1, 50, 20);
    const runner = new RangeTestRunner(DEF, "right");
    const events = [...runner.start(swinging[0].t)];
    let offerAt: number | null = null;
    for (const f of swinging) {
      const out = runner.feed(f, { rollDeg: 0 });
      events.push(...out);
      const ask = out.find((e) => e.kind === "ask");
      if (ask && offerAt === null) {
        offerAt = ask.t;
        expect(ask).toMatchObject({ ask: "calibration", side: "right" });
        events.push(...runner.retryCalibration(f.t));
      }
    }
    expect(offerAt! - swinging[0].t).toBeGreaterThanOrEqual(20000);
    expect(offerAt! - swinging[0].t).toBeLessThan(20500);
    const done = events.find((e) => e.kind === "done")!;
    expect(done.t - offerAt!).toBeGreaterThanOrEqual(20000);
    const res = runner.finish(swinging[swinging.length - 1].t).results[0];
    expect(res).toMatchObject({ status: "not_measured", reason: "quality" });
    expect(res.attempts).toEqual([]);
    expect(events.filter((e) => e.kind === "ask")).toHaveLength(1);
  });

  it("skip at the offer is finish: not measured today (quality), nothing scored", () => {
    const { fx, frames } = abd("chair", "9:16", [], 813, {}, 25);
    const runner = new RangeTestRunner(DEF, "right");
    const r = run(runner, tremor(fx, frames, "right", 15, 1, 25, 20), { rollDeg: 0 });
    expect(r.events.some((e) => e.kind === "ask" && e.ask === "calibration")).toBe(true);
    expect(r.side("right")).toMatchObject({ status: "not_measured", reason: "quality" });
  });
});
