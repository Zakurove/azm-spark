/**
 * Trunk control runner, trunk_control_seated (spec 4.3, contract v2 F), on generated landmark
 * recordings (tests/fixtures/gen.ts) of every profile at 9:16, 16:9 and 1:1.
 */
import { describe, expect, it } from "vitest";
import { createRunner, TRUNK_RULES, TrunkControlRunner, type RunnerOptions } from "../src/engine/modes";
import { CHECK_DATA, testDef } from "../src/movements/assessments";
import type { AspectName, GenSpec, MotionSpec, Profile } from "./fixtures/gen";
import {
  ASPECTS,
  editSubject,
  framesOf,
  HANDS_ON_THIGHS,
  LEAN,
  leanOrder,
  leans,
  leanStarts,
  mirrorFrames,
  run,
  spec,
} from "./fixtures/runners";

const DEF = testDef("trunk_control_seated");
type Side = "left" | "right";

const ORDER_R = leanOrder("right");
const ORDER_L = leanOrder("left");
const durationFor = (n: number) => leanStarts(n)[n - 1] + 9;

function trunk(
  profile: Profile,
  aspect: AspectName,
  motions: MotionSpec[],
  seed: number,
  extra: Partial<GenSpec> = {},
  durationSec = durationFor(8),
) {
  return framesOf(
    spec("trunk_control_seated", profile, aspect, motions, durationSec, seed, {
      wheelchairHips: "visible",
      ...extra,
      subject: { arms: HANDS_ON_THIGHS, ...extra.subject },
    }),
  );
}

function measure(
  frames: ReturnType<typeof trunk>["frames"],
  first: Side | "none" = "none",
  opts: RunnerOptions = {},
) {
  return run(new TrunkControlRunner(DEF, first, opts), frames, { rollDeg: 0 });
}

const PROFILE_CASES: { profile: Profile; first: Side | "none"; order: Side[] }[] = [
  { profile: "chair", first: "none", order: ORDER_R },
  { profile: "wheelchair", first: "none", order: ORDER_R },
  { profile: "standing", first: "none", order: ORDER_R },
  // The stronger side first: weaker left leans right first, weaker right leans left first.
  { profile: "weaker_left", first: "right", order: ORDER_R },
  { profile: "weaker_right", first: "left", order: ORDER_L },
];

describe("trunk_control_seated: the known true lean is recovered within 2 degrees", () => {
  let seed = 400;
  for (const c of PROFILE_CASES) {
    for (const aspect of ASPECTS) {
      const s = seed++;
      it(`${c.profile}, ${aspect}, both sides`, () => {
        const { frames } = trunk(c.profile, aspect, leans(c.order, 20), s);
        const r = measure(frames, c.first);
        expect(r.result.completed).toBe(true);
        for (const side of ["left", "right"] as const) {
          const res = r.side(side);
          expect(res.status).toBe("measured");
          expect(res.nValid).toBe(3);
          expect(res.practice).toHaveLength(1);
          expect(Math.abs(res.value! - 20)).toBeLessThanOrEqual(2);
          for (const a of res.attempts) expect(Math.abs(a.value! - 20)).toBeLessThanOrEqual(2);
          expect(res.detail.pivot).toBe("visible_hip");
          expect(res.detail.returnSec as number).toBeGreaterThan(0);
          expect(res.flags).not.toContain("upright_unsteady");
        }
        // Leans alternate from the stronger side.
        const asked = r.events.flatMap((e) =>
          e.kind === "phase" && (e.phase === "practice" || e.phase === "attempt") ? [e.side] : [],
        );
        expect(asked).toEqual(c.order);
      });
    }
  }

  for (const peak of [8, 15, 26]) {
    it(`a lean of ${peak} degrees reads ${peak}`, () => {
      const { frames } = trunk("chair", "9:16", leans(ORDER_R, peak), 430 + peak);
      const r = measure(frames);
      for (const side of ["left", "right"] as const)
        expect(Math.abs(r.side(side).value! - peak)).toBeLessThanOrEqual(2);
    });
  }

  it("the lean is relative to the person's own upright posture (a habitual lean is absorbed)", () => {
    const habitual: MotionSpec = {
      kind: "side_lean",
      toward: "left",
      peak: 6,
      start: 0,
      rise: 0.01,
      hold: 500,
      back: 1,
    };
    const { frames } = trunk("chair", "16:9", [habitual, ...leans(ORDER_R, 18)], 433);
    const r = measure(frames);
    expect(Math.abs(r.side("right").value! - 18)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.side("left").value! - 18)).toBeLessThanOrEqual(2);
    expect(Math.abs((r.side("left").detail.upright as number) - 6)).toBeLessThanOrEqual(1);
  });
});

describe("the 0.5 s sustained peak", () => {
  it("a lean spike shorter than 0.5 s does not count", () => {
    const starts = leanStarts(8);
    const spikes: MotionSpec[] = ORDER_R.map((toward, i) => ({
      kind: "side_lean",
      toward,
      peak: 14,
      start: starts[i] + 2.2,
      rise: 0.02,
      hold: 0.26,
      back: 0.02,
    }));
    const { frames } = trunk("chair", "9:16", [...leans(ORDER_R, 10), ...spikes], 440);
    const r = measure(frames);
    for (const side of ["left", "right"] as const)
      for (const a of r.side(side).attempts) {
        expect(a.value!).toBeGreaterThanOrEqual(8);
        expect(a.value!).toBeLessThanOrEqual(13);
      }
  });
});

describe("side labelling (spec 4.3 wrong_side)", () => {
  it("a lean to the other side is not stored as 0: the asked side is cued again and retried", () => {
    // Practice right, practice left, then asked right the person leans left.
    const order: Side[] = ["right", "left", "left", "right", "left", "right", "left", "right", "left"];
    const { frames } = trunk("chair", "9:16", leans(order, 20), 450, {}, durationFor(9));
    const r = measure(frames);
    const right = r.side("right");
    expect(right.retried).toHaveLength(1);
    expect(right.retried[0].reasons).toEqual(["wrong_side"]);
    expect(right.attempts.every((a) => a.value !== 0)).toBe(true);
    const retryAt = r.events.find((e) => e.kind === "attempt" && e.outcome === "retry")!.t;
    const cuesAtRetry = r.events
      .filter((e) => e.kind === "cue" && e.t === retryAt)
      .map((e) => (e as { cue: string }).cue);
    expect(cuesAtRetry).toEqual(["test_trunk_lean_right"]);
    expect(r.events.some((e) => e.kind === "phase" && e.phase === "recentre" && e.t === retryAt)).toBe(true);
    for (const side of ["left", "right"] as const) {
      expect(r.side(side).nValid).toBe(3);
      expect(Math.abs(r.side(side).value! - 20)).toBeLessThanOrEqual(2);
    }
  });

  it("a mirrored camera: measured with mirrored set, every lean reads as the wrong side without", () => {
    const { frames } = trunk("chair", "9:16", leans(ORDER_R, 20), 451);
    const ok = measure(mirrorFrames(frames), "none", { mirrored: true });
    for (const side of ["left", "right"] as const)
      expect(Math.abs(ok.side(side).value! - 20)).toBeLessThanOrEqual(2);
    // The person leans the way they are asked each time: right until the right side runs out of
    // retries (the practice plus 2), then left.
    const asked: Side[] = ["right", "right", "right", "left", "left", "left"];
    const again = trunk("chair", "9:16", leans(asked, 20), 452, {}, durationFor(6));
    const wrong = measure(mirrorFrames(again.frames));
    expect(wrong.result.completed).toBe(true);
    for (const side of ["left", "right"] as const) {
      expect(wrong.side(side).status).toBe("not_measured");
      expect(wrong.side(side).retried.every((a) => a.reasons.includes("wrong_side"))).toBe(true);
    }
  });
});

describe("pivot and baseline", () => {
  it("hips hidden during the leans: the mid hip is fixed at its baseline place", () => {
    const base = trunk("wheelchair", "9:16", leans(ORDER_R, 20), 460, {
      occlusions: [{ landmarks: [23, 24], from: 3.5, to: 200, visibility: 0.1 }],
    });
    const frames = editSubject(base.fx, base.frames, (p, t) => {
      // The model's guesses for the hidden hips drift sideways (inside the picture).
      const drift = (Math.max(0, t - 3500) / 1000) * 0.002;
      for (const k of [23, 24]) p[k] = { ...p[k], x: p[k].x + drift };
      return p;
    });
    const r = measure(frames);
    for (const side of ["left", "right"] as const) {
      const res = r.side(side);
      expect(res.detail.pivot).toBe("fixed_pivot");
      expect(res.nValid).toBe(3);
      expect(Math.abs(res.value! - 20)).toBeLessThanOrEqual(2);
    }
  });

  it("hips not visible at the baseline: not measured today (quality) with a setup tip", () => {
    const { frames } = trunk("wheelchair", "9:16", leans(ORDER_R, 20), 461, { wheelchairHips: "hidden" });
    const r = measure(frames);
    expect(r.result.completed).toBe(true);
    for (const side of ["left", "right"] as const) {
      expect(r.side(side).status).toBe("not_measured");
      expect(r.side(side).reason).toBe("quality");
    }
    expect(r.cues).toContain("check_whole_body");
    expect(r.events.find((e) => e.kind === "done")!.t).toBeGreaterThanOrEqual(
      TRUNK_RULES.uprightSearchSec * 1000,
    );
  });

  /** Small side to side movement for the first `sec` seconds, amplitude `deg`. */
  const restless = (deg: number, sec: number): MotionSpec[] =>
    Array.from({ length: Math.round(sec / 1.2) }, (_, i) => ({
      kind: "side_lean",
      toward: i % 2 ? "left" : "right",
      peak: deg,
      start: i * 1.2,
      rise: 0.6,
      hold: 0,
      back: 0.6,
    }));

  it("no still window within 10 s: the steadiest 3 s, flagged upright_unsteady, with a wider band", () => {
    const starts = leanStarts(8, 13);
    const { frames } = trunk(
      "chair",
      "9:16",
      [...restless(5, 12), ...leans(ORDER_R, 20, starts)],
      462,
      {},
      starts[7] + 9,
    );
    const r = measure(frames);
    const res = r.side("right");
    expect(res.flags).toContain("upright_unsteady");
    const sdU = res.detail.uprightSd as number;
    expect(sdU).toBeGreaterThan(TRUNK_RULES.uprightStillSdDeg);
    expect(sdU).toBeLessThanOrEqual(TRUNK_RULES.uprightMaxSdDeg);
    expect(res.detail.band as number).toBeCloseTo(Math.max(3, 2 * sdU), 0);
    expect(r.events.some((e) => e.kind === "flag" && e.flag === "upright_unsteady")).toBe(true);
    expect(Math.abs(res.value! - 20)).toBeLessThanOrEqual(3);
  });

  it("an upright window SD over 5 degrees: not measured today", () => {
    const { frames } = trunk("chair", "9:16", restless(14, 12), 463, {}, 14);
    const r = measure(frames);
    expect(r.side("left").status).toBe("not_measured");
    expect(r.side("left").reason).toBe("quality");
    expect(r.cues).not.toContain("check_whole_body");
  });
});

describe("invalid rules", () => {
  const during = (make: (start: number) => MotionSpec) =>
    leanStarts(8)
      .slice(2)
      .map((s) => make(s + 0.5));

  it("a forward bend (trunk shortens, nose drops) is invalid", () => {
    const bends = during((start) => ({ kind: "bend", deg: 30, start, rise: 1.5, hold: 2, back: 1.5 }));
    const { frames } = trunk("chair", "9:16", [...leans(ORDER_R, 15), ...bends], 470);
    const r = measure(frames);
    for (const side of ["left", "right"] as const)
      for (const a of r.side(side).attempts) expect(a.reasons).toContain("forward_bend");
  });

  it("a rotation changing the shoulder width over 15 percent is invalid", () => {
    // 42 degrees: toward the camera the near shoulder looks bigger, which hides part of the turn.
    const turns = during((start) => ({ kind: "turn", deg: 42, start, rise: 1.5, hold: 2, back: 1.5 }));
    const { frames } = trunk("chair", "16:9", [...leans(ORDER_R, 15), ...turns], 471);
    const r = measure(frames);
    for (const side of ["left", "right"] as const)
      for (const a of r.side(side).attempts) expect(a.reasons).toContain("rotation");
  });

  it("the pelvis sliding over 0.25 shoulder widths is invalid and cues test_trunk_to_middle", () => {
    const slides = during((start) => ({ kind: "slide", dx: 0.13, start, rise: 1.5, hold: 2, back: 1.5 }));
    const { frames } = trunk("chair", "9:16", [...leans(ORDER_R, 15), ...slides], 472);
    const r = measure(frames);
    for (const side of ["left", "right"] as const)
      for (const a of r.side(side).attempts) {
        expect(a.reasons).toContain("hip_slide");
        expect(a.censored).toBe(false);
      }
    expect(r.cues).toContain("test_trunk_to_middle");
  });
});

describe("aborts and censoring (coaching cues, not safeguards)", () => {
  it("at the first check a lean over 30 degrees aborts: censored at 30, shown as more than 30", () => {
    const { frames } = trunk("chair", "9:16", leans(ORDER_R, 36), 480);
    const r = measure(frames);
    expect(r.cues).toContain("test_trunk_to_middle");
    for (const side of ["left", "right"] as const) {
      const res = r.side(side);
      expect(res.value).toBe(30);
      expect(res.censored).toBe(true);
      expect(res.flags).toContain("censored");
      for (const a of res.attempts) {
        expect(a.censored).toBe(true);
        expect(a.detail.abort).toBe("limit");
      }
    }
  });

  it("at a later check the limit is this side's earlier best plus 15", () => {
    const { frames } = trunk("chair", "9:16", leans(ORDER_R, 30), 481);
    const r = measure(frames, "none", { firstCheck: false, previousBest: { right: 12, left: 20 } });
    expect(r.side("right").value).toBe(27);
    expect(r.side("right").censored).toBe(true);
    expect(r.side("left").censored).toBe(false);
    expect(Math.abs(r.side("left").value! - 30)).toBeLessThanOrEqual(2);
  });

  it("a later check with no earlier best for a side keeps the first check limit", () => {
    const x = new TrunkControlRunner(DEF, "none", { firstCheck: false, previousBest: { left: 20 } });
    expect(x.abortLimit("right")).toBe(30);
    expect(x.abortLimit("left")).toBe(35);
  });

  it("a lean faster than 45 degrees per second for over 0.2 s aborts and censors", () => {
    const starts = leanStarts(8);
    // 40 degrees in 0.6 s (a later check, limit 30 plus 15): over 45 degrees per second for about 0.45 s.
    const fast: MotionSpec[] = ORDER_R.map((toward, i) => ({
      kind: "side_lean",
      toward,
      peak: 40,
      start: starts[i],
      rise: 0.6,
      hold: 3,
      back: 2.5,
    }));
    const { frames } = trunk("chair", "9:16", fast, 482);
    const r = measure(frames, "none", { firstCheck: false, previousBest: { left: 30, right: 30 } });
    for (const side of ["left", "right"] as const)
      for (const a of r.side(side).attempts) {
        expect(a.detail.abort).toBe("speed");
        expect(a.censored).toBe(true);
      }
    expect(r.events.some((e) => e.kind === "flag" && e.flag === "abort_speed")).toBe(true);
  });

  it("a shoulder lost mid lean aborts", () => {
    const starts = leanStarts(8);
    const lost = starts.slice(2).map((s) => ({ landmarks: [11, 12], from: s + 2.4, to: s + 3.2 }));
    const { frames } = trunk("chair", "9:16", leans(ORDER_R, 20), 483, { occlusions: lost });
    const r = measure(frames);
    const aborted = [
      ...r.side("left").attempts,
      ...r.side("right").attempts,
      ...r.side("left").retried,
      ...r.side("right").retried,
    ];
    expect(aborted.some((a) => a.detail.abort === "loss")).toBe(true);
  });
});

describe("return, contact and flags", () => {
  const RIGHT_ONLY: RunnerOptions = { sides: ["right"], skipPractice: true };

  it("no return within 10 s cues test_trunk_to_middle and flags no_return", () => {
    const starts = leanStarts(3, 4, 22);
    const motions: MotionSpec[] = starts.map((start, i) => ({
      kind: "side_lean",
      toward: "right",
      peak: 18,
      start,
      rise: LEAN.rise,
      hold: i === 0 ? 12 : LEAN.hold,
      back: LEAN.back,
    }));
    const { frames } = trunk("chair", "9:16", motions, 490, {}, starts[2] + 9);
    const r = measure(frames, "right", RIGHT_ONLY);
    const res = r.side("right");
    expect(res.attempts[0].flags).toContain("no_return");
    expect(res.attempts[0].detail.returnSec as number).toBeGreaterThan(10);
    expect(res.attempts[1].flags).not.toContain("no_return");
    expect(res.flags).toContain("no_return");
    expect(r.cues).toContain("test_trunk_to_middle");
    expect(r.result.results).toHaveLength(1);
  });

  it("asks the contact question after each side; yes censors that side, no answer is unknown", () => {
    const { frames } = trunk("chair", "9:16", leans(ORDER_R, 20), 491);
    const r = run(new TrunkControlRunner(DEF, "none"), frames, { rollDeg: 0 }, (x) =>
      (x as TrunkControlRunner).setContact("left", true),
    );
    const asks = r.events.filter((e) => e.kind === "ask");
    expect(asks.map((e) => (e as { side: string }).side)).toEqual(["right", "left"]);
    expect(r.side("left").censored).toBe(true);
    expect(r.side("left").flags).toContain("contact");
    expect(r.side("left").detail.contact).toBe(true);
    expect(r.side("right").censored).toBe(false);
    expect(r.side("right").detail.contact).toBe("unknown");
    expect(r.side("right").flags).toContain("contact_unknown");
    expect(DEF.metric.contactAsk.en).toMatch(/armrest/);
  });

  it("a straight arm on the leaning side at the peak flags arm_support_likely", () => {
    const { frames } = trunk("chair", "9:16", leans(ORDER_R, 20), 492, {
      subject: { arms: { left: { elev: 10, elbow: 5 }, right: { elev: 10, elbow: 5 } } },
    });
    const r = measure(frames);
    expect(r.side("right").flags).toContain("arm_support_likely");
    expect(r.side("right").detail.armSupportLikely).toBe(true);
    for (const a of r.side("left").attempts) expect(a.flags).toContain("arm_support_likely");
  });

  it("hands resting on the thighs flag wrist_support but not arm_support_likely", () => {
    const { frames } = trunk("chair", "9:16", leans(ORDER_R, 20), 493);
    const r = measure(frames);
    expect(r.side("right").attempts[0].flags).toContain("wrist_support");
    expect(r.side("right").flags).not.toContain("arm_support_likely");
    expect(r.side("right").detail.armSupportLikely).toBe(false);
  });

  it("a head tilt without a trunk lean flags head_only_tilt; a moving knee flags knee_or_foot_move", () => {
    const starts = leanStarts(8);
    const base = trunk("chair", "9:16", leans(ORDER_R, 6), 494);
    const frames = editSubject(base.fx, base.frames, (p, t) => {
      const s = t / 1000;
      if (starts.slice(2).some((a) => s > a + 0.5 && s < a + 4)) {
        // Tip the ears 20 degrees about the nose, move the left knee sideways.
        const c = Math.cos(0.35);
        const sn = Math.sin(0.35);
        for (const k of [7, 8]) {
          const dx = p[k].x - p[0].x;
          const dy = p[k].y - p[0].y;
          p[k] = { ...p[k], x: p[0].x + dx * c - dy * sn, y: p[0].y + dx * sn + dy * c };
        }
        p[25] = { ...p[25], x: p[25].x + 0.03 };
      }
      return p;
    });
    const r = measure(frames);
    const flags = r.side("right").attempts.flatMap((a) => a.flags);
    expect(flags).toContain("head_only_tilt");
    expect(flags).toContain("knee_or_foot_move");
  });
});

describe("a second person", () => {
  it("a helper beside the person does not pause scoring", () => {
    const { frames } = trunk("weaker_left", "9:16", leans(ORDER_R, 20), 500, {
      helper: { x: -0.75, z: -0.35, yaw: 20 },
      shuffle: true,
    });
    const r = measure(frames, "right");
    for (const side of ["left", "right"] as const) {
      expect(r.side(side).quality.maxPausedShare).toBe(0);
      expect(Math.abs(r.side(side).value! - 20)).toBeLessThanOrEqual(2);
    }
  });

  it("a helper walking between the phone and the person pauses scoring and the lean is repeated", () => {
    const order: Side[] = [...ORDER_R, "right"];
    const starts = leanStarts(9);
    const { frames } = trunk(
      "chair",
      "16:9",
      leans(order, 20),
      501,
      { helper: { x: -1.6, z: 0.6, walk: { toX: 1.6, start: starts[2] + 0.5, speed: 0.4 } }, shuffle: true },
      durationFor(9),
    );
    const r = measure(frames);
    const right = r.side("right");
    expect(right.retried[0].reasons).toContain("paused");
    expect(r.cues).toContain("check_one_person");
    expect(right.nValid).toBe(3);
    expect(Math.abs(right.value! - 20)).toBeLessThanOrEqual(2);
  });
});

describe("repeatability (F1 criterion)", () => {
  it("the same recording gives the same result", () => {
    const { frames } = trunk("chair", "9:16", leans(ORDER_R, 20), 510);
    expect(measure(frames).result).toEqual(measure(frames).result);
  });

  for (const c of PROFILE_CASES) {
    it(`${c.profile}: repeated recordings of the same leans stay within 5 degrees`, () => {
      const values: number[] = [];
      for (const [i, aspect] of (["9:16", "16:9", "1:1", "9:16", "16:9"] as const).entries()) {
        const { frames } = trunk(c.profile, aspect, leans(c.order, 20), 520 + i * 11);
        const r = measure(frames, c.first);
        for (const side of ["left", "right"] as const)
          values.push(...r.side(side).attempts.map((a) => a.value!));
      }
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(5);
    });
  }
});

describe("check in triggers (spec 4.0)", () => {
  it("a lean far beyond the abort limit is a big sway; a pelvis dropping toward the floor is a hips drop", () => {
    const starts = leanStarts(3);
    const motions: MotionSpec[] = [
      ...leans(["right"], 20, [starts[0]]),
      { kind: "sway", at: starts[1] + 1, peak: 50, dur: 3, toward: "left" },
      { kind: "fall", at: starts[2] + 1 },
    ];
    const { frames } = trunk("chair", "9:16", motions, 540, {}, starts[2] + 5);
    const r = measure(frames, "right", { sides: ["right", "left"] });
    const triggers = r.events.flatMap((e) => (e.kind === "checkin" ? [e.trigger] : []));
    expect(triggers).toContain("sway");
    expect(triggers).toContain("hips_drop");
  });
});

describe("flow and events", () => {
  const { frames } = trunk("chair", "9:16", leans(ORDER_R, 20), 530);
  const r = measure(frames);

  it("never shows a live number or a target (spec 4.3)", () => {
    expect(r.events.some((e) => e.kind === "live" || e.kind === "peak")).toBe(false);
  });

  it("runs baseline, practice per side, then alternating leans with rests and a return phase", () => {
    const phases = r.events.flatMap((e) => (e.kind === "phase" ? [e.phase] : []));
    expect(phases[0]).toBe("calibrating");
    expect(phases.filter((p) => p === "practice")).toHaveLength(2);
    expect(phases.filter((p) => p === "attempt")).toHaveLength(6);
    expect(phases.filter((p) => p === "return")).toHaveLength(8);
    expect(phases[phases.length - 1]).toBe("done");
    expect(r.cues.slice(0, 5)).toEqual([
      "test_trunk_start",
      "test_trunk_still",
      "test_trunk_seat",
      "test_trunk_light_touch",
      "test_trunk_lean_right",
    ]);
    expect(r.cues.filter((c) => c === "check_saved")).toHaveLength(6);
    expect(r.cues.filter((c) => c === "test_trunk_pause")).toHaveLength(8);
    expect(r.cues.filter((c) => c === "test_trunk_return")).toHaveLength(8);
  });

  it("every cue is a check cue of the data and in the test's cue list", () => {
    const ids = new Set(CHECK_DATA.cues.map((c) => c.id));
    for (const c of r.cues) {
      expect(ids.has(c as never)).toBe(true);
      expect([...DEF.cues, "check_whole_body", "check_one_person"]).toContain(c);
    }
  });

  it("stores the side detail of spec 4.3", () => {
    const res = r.side("left");
    for (const k of [
      "upright",
      "uprightSd",
      "band",
      "pivot",
      "contact",
      "censored",
      "returnSec",
      "shoulderShift",
    ])
      expect(res.detail).toHaveProperty(k);
    expect(res.median).toBeNull();
    expect(res.unit).toBe("deg");
    expect(res.detail.shoulderShift as number).toBeGreaterThan(0.2);
    expect(res.quality.medianFps).toBeCloseTo(15, 0);
  });

  it("skipPractice at runtime drops the practice without a second baseline (S34e)", () => {
    const runner = new TrunkControlRunner(DEF, "none");
    const events = [...runner.start(frames[0].t)];
    let skipped = false;
    for (const f of frames) {
      events.push(...runner.feed(f, { rollDeg: 0 }));
      if (!skipped && runner.phase === "practice") {
        skipped = true;
        events.push(...runner.skipPractice(f.t));
        // The first recorded lean starts at once.
        expect(runner.phase).toBe("attempt");
      }
    }
    const result = runner.finish(frames[frames.length - 1].t);
    expect(skipped).toBe(true);
    const phases = events.flatMap((e) => (e.kind === "phase" ? [e.phase] : []));
    expect(phases.filter((p) => p === "calibrating")).toHaveLength(1);
    expect(phases.filter((p) => p === "practice")).toHaveLength(1);
    for (const side of result.results) expect(side.practice ?? []).toHaveLength(0);
    // Skipped before the baseline: no practice lean is ever queued.
    const early = new TrunkControlRunner(DEF, "none");
    const e2 = [...early.start(frames[0].t), ...early.skipPractice(frames[0].t)];
    for (const f of frames) e2.push(...early.feed(f, { rollDeg: 0 }));
    expect(e2.some((e) => e.kind === "phase" && e.phase === "practice")).toBe(false);
  });

  it("skipPractice and sides narrow the run", () => {
    const x = measure(frames, "left", { sides: ["left"], skipPractice: true });
    expect(x.result.results.map((s) => s.side)).toEqual(["left"]);
    expect(x.side("left").practice).toHaveLength(0);
  });

  it("finish before the end reads stopped", () => {
    const x = measure(frames.filter((f) => f.t < 30000));
    expect(x.result.completed).toBe(false);
    for (const side of ["left", "right"] as const) expect(x.side(side).status).toBe("stopped");
  });

  it("createRunner builds the trunk runner from the stronger side", () => {
    const a = createRunner(DEF, "left");
    expect(a).toBeInstanceOf(TrunkControlRunner);
    expect(a.sides).toEqual(["left", "right"]);
    expect(createRunner(DEF, "none").sides).toEqual(["right", "left"]);
    expect(a.kind).toBe("trunk_control");
  });

  it("ties the runner's numbers to the spec text", () => {
    const m = DEF.metric;
    expect(m.upright).toMatch(/3 s still window \(still means SD of L at most 2 degrees\)/);
    expect(m.upright).toMatch(/within 10 s/);
    expect(m.upright).toMatch(/SD is over 5 degrees/);
    expect(m.returnBand).toMatch(/max\(3 degrees, 2 x SD/);
    expect(m.returnBand).toMatch(/for 1 s/);
    expect(m.returnBand).toMatch(/within 10 s/);
    expect(m.abort.join(" ")).toMatch(/over 45 degrees per second for more than 0\.2 s/);
    expect(m.abort.join(" ")).toMatch(/more than 15 degrees beyond/);
    expect(m.abort.join(" ")).toMatch(/lean over 30 degrees/);
    expect(m.invalidWhen.join(" ")).toMatch(/more than 15 percent/);
    expect(m.invalidWhen.join(" ")).toMatch(/0\.25 shoulder widths/);
    expect(m.flags.join(" ")).toMatch(/over 150 degrees/);
    expect(DEF.holdSec).toBe(0.5);
    expect(DEF.attempts).toBe(3);
    expect(DEF.practice).toBe(1);
    expect(DEF.requiredLandmarks.minVisibility).toBe(0.5);
    const R = TRUNK_RULES;
    expect([R.uprightWindowSec, R.uprightStillSdDeg, R.uprightSearchSec, R.uprightMaxSdDeg]).toEqual([
      3, 2, 10, 5,
    ]);
    expect([R.bandMinDeg, R.bandSdMultiple, R.returnHoldSec, R.noReturnSec]).toEqual([3, 2, 1, 10]);
    expect([R.abortSpeedDegPerSec, R.abortSpeedSec, R.abortBeyondBestDeg, R.abortFirstCheckDeg]).toEqual([
      45, 0.2, 15, 30,
    ]);
    expect([
      R.trunkShrinkInvalid,
      R.widthChangeInvalid,
      R.hipSlideShoulderWidths,
      R.armSupportElbowDeg,
    ]).toEqual([0.15, 0.15, 0.25, 150]);
  });
});
