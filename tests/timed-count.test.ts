/**
 * Timed count runners, arm_curl_30s (spec 4.2) and chair_stand_30s (spec 4.4), contract v2 F part
 * 3, on generated landmark recordings (tests/fixtures/gen.ts) with ground truth counts, for every
 * profile at 9:16, 16:9 and 1:1.
 */
import { describe, expect, it } from "vitest";
import {
  applyCountSource,
  ArmCurlRunner,
  BendTracker,
  ChairStandRunner,
  createRunner,
  LineCounter,
  practiceDiffers,
  StandTracker,
  TIMED_RULES,
  type SideResult,
  type TestEvent,
} from "../src/engine/modes";
import { CHECK_CUE_IDS } from "../src/movements/types";
import { testDef } from "../src/movements/assessments";
import { FIXTURE_ROOT, fixtureFrames, loadFixture } from "./fixtures/format";
import { join } from "node:path";
import {
  curlRepTime,
  standRepTime,
  type AspectName,
  type GenSpec,
  type GenTruth,
  type MotionSpec,
  type Profile,
} from "./fixtures/gen";
import { ASPECTS, framesOf, mirrorFrames, spec } from "./fixtures/runners";
import {
  CROSSED,
  drive,
  FAST,
  curlPractice,
  curlTrial,
  curlTruth,
  standPractice,
  standTrial,
  standTruth,
  twoPass,
  type TwoPass,
} from "./fixtures/timed";

type Side = "left" | "right";
const CURL = testDef("arm_curl_30s");
const STAND = testDef("chair_stand_30s");

const res = (c: { run: { result: { results: SideResult[] } } }) => c.run.result.results[0];

function framesOfCurl(
  motions: MotionSpec[],
  seed: number,
  profile: Profile = "chair",
  aspect: AspectName = "9:16",
  durationSec = 45,
  extra: Partial<GenSpec> = {},
) {
  return framesOf(spec("arm_curl_30s", profile, aspect, motions, durationSec, seed, { fps: 20, ...extra }));
}
const ofKind = <K extends TestEvent["kind"]>(events: TestEvent[], kind: K) =>
  events.filter((e): e is Extract<TestEvent, { kind: K }> => e.kind === kind);

/** The two time up lines of revision 1.1 (check_time_stop is retired). */
const TIME_UP: readonly string[] = ["check_time_up_curl", "check_time_up_stand"];

/** The spoken cues from check_go to the time up line, in order (the first trial). */
function trialCues(events: TestEvent[]): string[] {
  const cues = ofKind(events, "cue").map((e) => e.cue);
  const go = cues.indexOf("check_go");
  const end = cues.findIndex((c, i) => i > go && TIME_UP.includes(c));
  return cues.slice(go, end + 1);
}

/* ------------------------------------------------------------------ arm curl */

/** Each profile with the arm it tests (the weaker arm for the weaker profiles, spec 4.2 order). */
const CURL_CASES: { profile: Profile; side: Side }[] = [
  { profile: "chair", side: "right" },
  { profile: "wheelchair", side: "left" },
  { profile: "standing", side: "right" },
  { profile: "weaker_left", side: "left" },
  { profile: "weaker_right", side: "right" },
];

function curlCase(
  profile: Profile,
  aspect: AspectName,
  side: Side,
  seed: number,
  over: Partial<TwoPass> = {},
) {
  return twoPass({
    test: "arm_curl_30s",
    profile,
    aspect,
    seed,
    side,
    practice: curlPractice(side),
    trial: (go) => curlTrial(side, go, seed),
    opts: { variant: "arm_only" },
    ...over,
  });
}

describe("arm_curl_30s: counts within 1 of the ground truth for every profile and aspect", () => {
  let seed = 600;
  for (const c of CURL_CASES) {
    for (const aspect of ASPECTS) {
      const s = seed++;
      it(`${c.profile}, ${c.side} arm, ${aspect}`, () => {
        const k = curlCase(c.profile, aspect, c.side, s);
        const truth = curlTruth(k.trial, k.goSec);
        const r = res(k);
        expect(k.run.result.completed).toBe(true);
        expect(r.status).toBe("measured");
        expect(truth).toBeGreaterThanOrEqual(10);
        expect(Math.abs(r.value! - truth)).toBeLessThanOrEqual(1);
        expect(r.nValid).toBe(1);
        expect(r.attempts).toHaveLength(1);
        expect(r.practice).toHaveLength(2);
        expect(r.detail.countSource).toBe("auto");
        expect(r.detail.partial).toBe(0);
        expect(r.detail.stoppedEarly).toBe(false);
        expect(r.detail.secondsCompleted).toBe(30);
        expect(r.detail.view).toBe("side");
        expect(r.quality.ok).toBe(true);
        expect(r.quality.medianFps).toBe(20);
        // The rep events count up by one to the value, never spoken.
        const reps = k.run.events.filter((e) => e.kind === "rep");
        expect(reps.map((e) => (e as { count: number }).count)).toEqual(
          Array.from({ length: r.value! }, (_, i) => i + 1),
        );
        // Hips hidden by the wheelchair: the compensation is unknown, never guessed.
        expect(r.detail.compensated).toBe(c.profile === "wheelchair" ? "unknown" : 0);
      });
    }
  }
});

/** Regular trial curl reps from go + 1 s: one every `every` s, each `dur` s long. */
function regularCurls(
  side: Side,
  go: number,
  lastStart: number,
  every = 2.2,
  dur = 1.8,
  top = 140,
): MotionSpec[] {
  const out: MotionSpec[] = [];
  for (let t = go + 1; t <= lastStart + 1e-9; t += every)
    out.push({ kind: "curl_rep", side, start: t, dur, top });
  return out;
}

/** Start of a curl rep of `dur` s whose 0.8 share of its bend comes at `crossAt`. */
const curlStartFor = (crossAt: number, dur: number) =>
  crossAt - (dur * Math.acos(1 - 2 * 0.8)) / (2 * Math.PI);

describe("arm_curl_30s counting rules (spec 4.2)", () => {
  it("does not count partial bends (peak p between 0.50 and 0.80) and stores them in detail.partial", () => {
    // Full bends, partial bends (65 percent of the practice bend) and small bends (30 percent).
    const top = (i: number) => (i % 3 === 0 ? 140 : i % 3 === 1 ? 5 + 0.65 * 135 : 5 + 0.3 * 135);
    const k = curlCase("chair", "9:16", "right", 640, { trial: (go) => curlTrial("right", go, 640, top) });
    const r = res(k);
    const inTrial = k.trial.filter((m) => m.kind === "curl_rep" && m.start < k.goSec + 29);
    const partial = inTrial.filter(
      (m) => m.kind === "curl_rep" && Math.abs(m.top! - (5 + 0.65 * 135)) < 1e-6,
    );
    expect(r.value).toBe(curlTruth(k.trial, k.goSec));
    expect(r.detail.partial).toBe(partial.length);
    expect(partial.length).toBeGreaterThanOrEqual(3);
  });

  it("counts a rep whose count line crossing comes before 30.0 s after go", () => {
    const dur = 1.8;
    const k = curlCase("chair", "9:16", "right", 641, {
      trial: (go) => [
        ...regularCurls("right", go, go + 25),
        { kind: "curl_rep", side: "right", start: curlStartFor(go + 29.7, dur), dur },
      ],
    });
    const r = res(k);
    expect(r.value).toBe(curlTruth(k.trial, k.goSec));
    expect(r.value).toBe(k.trial.length);
    const crossings = k.trial.flatMap((m) => (m.kind === "curl_rep" ? [curlRepTime(m, 0.8)!] : []));
    expect(r.detail.first10sCount).toBe(crossings.filter((x) => x < k.goSec + 10).length);
    expect(r.detail.last10sCount).toBe(crossings.filter((x) => x >= k.goSec + 20).length);
  });

  it("does not count a rep whose count line crossing comes after 30.0 s (no more than halfway rule)", () => {
    const dur = 1.8;
    const k = curlCase("chair", "9:16", "right", 642, {
      trial: (go) => [
        ...regularCurls("right", go, go + 25),
        { kind: "curl_rep", side: "right", start: curlStartFor(go + 30.25, dur), dur },
      ],
    });
    const r = res(k);
    expect(r.value).toBe(k.trial.length - 1);
    expect(r.value).toBe(curlTruth(k.trial, k.goSec));
    expect(r.detail.halfwayCredited).toBeUndefined();
    // The last rep event comes before the stop.
    const stop = k.run.events.find((e) => e.kind === "cue" && e.cue === "check_time_up_curl")!;
    const reps = ofKind(k.run.events, "rep");
    expect(reps[reps.length - 1].t).toBeLessThan(stop.t);
    expect(stop.t - k.run.go!).toBeGreaterThanOrEqual(30000);
  });

  it("counts compensated reps, flags them in detail.compensated and never scolds", () => {
    // Every other rep swings the upper arm 35 degrees forward, or bends the trunk 20 degrees.
    const k = curlCase("chair", "9:16", "right", 643, {
      trial: (go) => {
        const reps = regularCurls("right", go, go + 27, 2.4, 1.8);
        const extra: MotionSpec[] = reps.flatMap((m, i): MotionSpec[] => {
          if (m.kind !== "curl_rep" || i % 2 === 0) return [];
          return i % 4 === 1
            ? [
                {
                  kind: "arm_raise",
                  side: "right",
                  peak: 35,
                  plane: 90,
                  start: m.start,
                  rise: 0.9,
                  hold: 0,
                  lower: 0.9,
                },
              ]
            : [{ kind: "bend", deg: 20, start: m.start, rise: 0.9, hold: 0, back: 0.9 }];
        });
        return [...reps, ...extra];
      },
    });
    const r = res(k);
    const reps = k.trial.filter((m) => m.kind === "curl_rep");
    expect(r.value).toBe(reps.length);
    expect(r.detail.compensated).toBe(Math.floor(reps.length / 2));
    expect(r.flags).not.toContain("compensated");
    // No voice at all during the trial beyond go, ten left and stop.
    const go = k.run.go!;
    const cues = k.run.events.filter((e) => e.kind === "cue" && e.t >= go && e.t <= go + 30000);
    expect(cues.map((e) => (e as { cue: string }).cue)).toEqual([
      "check_go",
      "check_ten_left",
      "check_time_up_curl",
    ]);
  });

  it("asks a third practice bend when the two excursions differ by more than 15 percent", () => {
    const k = curlCase("chair", "9:16", "right", 644, {
      practice: [
        { kind: "curl_rep", side: "right", start: 2, dur: 3, top: 140 },
        { kind: "curl_rep", side: "right", start: 5.5, dur: 3, top: 95 },
        { kind: "curl_rep", side: "right", start: 9.5, dur: 3, top: 140 },
      ],
    });
    const r = res(k);
    expect(r.practice).toHaveLength(3);
    expect(practiceDiffers(Number(r.practice[0].detail.X), Number(r.practice[1].detail.X))).toBe(true);
    const practiceCues = k.run.events.filter(
      (e) => e.kind === "cue" && e.cue === "test_curl_full" && e.t > 5000 && e.t < 12000,
    );
    expect(practiceCues).toHaveLength(1);
    // F is the most flexed of all the practice bends.
    expect(Number(r.detail.rangeHi)).toBeCloseTo(Math.min(...r.practice.map((p) => Number(p.detail.F))), 1);
    expect(r.value).toBe(curlTruth(k.trial, k.goSec));
  });

  it("runs the setup check and the practice again when X is under 30 degrees, then measures", () => {
    const small = 5 + 25;
    const k = curlCase("chair", "9:16", "right", 645, {
      practice: [
        { kind: "curl_rep", side: "right", start: 2, dur: 3, top: small },
        { kind: "curl_rep", side: "right", start: 5.5, dur: 3, top: small },
        { kind: "curl_rep", side: "right", start: 12, dur: 3, top: 140 },
        { kind: "curl_rep", side: "right", start: 15.5, dur: 3, top: 140 },
      ],
      durationSec: 62,
    });
    const r = res(k);
    const phases = ofKind(k.run.events, "phase").map((e) => e.phase);
    expect(phases).toContain("setup");
    expect(phases.filter((p) => p === "practice")).toHaveLength(2);
    expect(r.status).toBe("measured");
    expect(r.practice).toHaveLength(4);
    expect(Number(r.detail.rangeLo) - Number(r.detail.rangeHi)).toBeGreaterThan(120);
    expect(r.value).toBe(curlTruth(k.trial, k.goSec));
  });

  it("does not measure today when X stays under 30 degrees after the setup check", () => {
    const small = 5 + 25;
    const { frames } = framesOfCurl(
      [2, 5.5, 12, 15.5].map((start) => ({ kind: "curl_rep", side: "right", start, dur: 3, top: small })),
      646,
    );
    const r = new ArmCurlRunner(CURL, "right", { ...FAST, variant: "arm_only" });
    const run = drive(r, frames);
    const out = run.result.results[0];
    expect(out.status).toBe("not_measured");
    expect(out.reason).toBe("quality");
    expect(out.value).toBeNull();
    expect(run.cues.filter((c) => c === "test_curl_full").length).toBeGreaterThanOrEqual(2);
    expect(run.cues).not.toContain("check_go");
  });
});

describe("arm_curl_30s later checks (D-009 fixedRange)", () => {
  /** The baseline check of a series and its stored range. */
  function baseline(seed: number) {
    const k = curlCase("chair", "9:16", "right", seed);
    const r = res(k);
    return { k, range: [Number(r.detail.rangeLo), Number(r.detail.rangeHi)] as [number, number] };
  }

  it("counts against the baseline X anchored at today's resting angle, without a flag for the same movement", () => {
    const { range } = baseline(650);
    const k = curlCase("chair", "16:9", "right", 651, { opts: { variant: "arm_only", fixedRange: range } });
    const r = res(k);
    expect(r.flags).not.toContain("range_below_baseline");
    expect(r.value).toBe(curlTruth(k.trial, k.goSec));
    // X is the baseline's; the anchor is today's resting angle.
    expect(Number(r.detail.rangeLo) - Number(r.detail.rangeHi)).toBeCloseTo(range[0] - range[1], 0);
    expect(k.run.asks).not.toContain("practice_check");
  });

  it("flags range_below_baseline, cues test_curl_full and the setup check, then counts against the baseline line", () => {
    const { range } = baseline(652);
    // Today the bends reach only about 70 percent of the baseline excursion (a loose sleeve, a
    // different view): the practice misses the count line.
    const top = 5 + 0.7 * 135;
    const k = curlCase("chair", "9:16", "right", 653, {
      practice: curlPractice("right", top),
      trial: (go) => curlTrial("right", go, 653, top),
      opts: { variant: "arm_only", fixedRange: range },
      durationSec: 60,
    });
    const r = res(k);
    expect(r.flags).toContain("range_below_baseline");
    const phases = ofKind(k.run.events, "phase").map((e) => e.phase);
    expect(phases.indexOf("setup")).toBeGreaterThan(phases.indexOf("practice"));
    expect(k.run.cues.filter((c) => c === "test_curl_full").length).toBeGreaterThanOrEqual(2);
    expect(r.status).toBe("measured");
    // Against the baseline line these bends are partial: none counts.
    expect(r.value).toBe(0);
    // Each bend that came back under the return line before the stop is partial.
    const back = k.trial.filter(
      (m) =>
        m.kind === "curl_rep" && m.start + (m.dur ?? 2) * (1 - Math.acos(0.6) / (2 * Math.PI)) < k.goSec + 30,
    );
    expect(Math.abs(Number(r.detail.partial) - back.length)).toBeLessThanOrEqual(1);
    expect(back.length).toBeGreaterThanOrEqual(10);

    // At a baseline the same movement makes its own range and every bend counts.
    const own = curlCase("chair", "9:16", "right", 653, {
      practice: curlPractice("right", top),
      trial: (go) => curlTrial("right", go, 653, top),
      opts: { variant: "arm_only" },
    });
    expect(res(own).value).toBe(curlTruth(own.trial, own.goSec, top));
  });
});

describe("arm_curl_30s load practice check (spec 4.2)", () => {
  it("asks the practice check at the baseline with a load and waits for the answer", () => {
    const k = curlCase("chair", "9:16", "right", 660, { opts: { variant: "held" } });
    expect(k.run.asks).toEqual(["practice_check"]);
    const ask = ofKind(k.run.events, "ask")[0];
    expect(ask.side).toBe("right");
    // The grip line is spoken before the practice with a load.
    expect(k.run.cues.slice(0, 5)).toContain("test_curl_grip");
    expect(res(k).variant).toBe("held");
  });

  it("runs the practice again with the lighter load after a no", () => {
    const k = curlCase("chair", "9:16", "right", 661, {
      opts: { variant: "held" },
      answers: { practiceCheck: "arm_only" },
      practice: [
        ...curlPractice("right"),
        ...[11, 14.5].map((start) => ({ kind: "curl_rep" as const, side: "right" as const, start, dur: 3 })),
      ],
      durationSec: 60,
    });
    // One question, answered no with the step down to no weight: no second question.
    expect(k.run.asks).toEqual(["practice_check"]);
    const r = res(k);
    expect(r.variant).toBe("arm_only");
    expect(r.practice).toHaveLength(4);
    expect(r.value).toBe(curlTruth(k.trial, k.goSec));
  });

  it("asks nothing with no weight", () => {
    const k = curlCase("chair", "9:16", "right", 662);
    expect(k.run.asks).toEqual([]);
    expect(k.run.cues).not.toContain("test_curl_grip");
  });
});

describe("timed trial voice and timer (spec 4.0 D-009)", () => {
  it("speaks only go, ten seconds left and stop in the trial; counts are shown, time once per second", () => {
    const k = curlCase("wheelchair", "16:9", "left", 670);
    const go = k.run.go!;
    const inTrial = k.run.events.filter((e) => e.t >= go && e.t <= go + 30100);
    const cues = inTrial.filter((e) => e.kind === "cue").map((e) => (e as { cue: string }).cue);
    expect(cues).toEqual(["check_go", "check_ten_left", "check_time_up_curl"]);
    const ten = inTrial.find((e) => e.kind === "cue" && e.cue === "check_ten_left")!;
    expect(ten.t - go).toBeGreaterThanOrEqual(20000);
    expect(ten.t - go).toBeLessThan(20000 + 60);
    const times = ofKind(inTrial, "time").map((e) => e.remainingSec);
    expect(times).toEqual(Array.from({ length: 31 }, (_, i) => 30 - i));
    // Before go: the countdown, shown and not spoken.
    const ready = ofKind(k.run.events, "phase").find((e) => e.phase === "ready")!;
    const countdown = ofKind(k.run.events, "time").filter((e) => e.t >= ready.t && e.t < go);
    expect(countdown.map((e) => e.remainingSec)).toEqual([3, 2, 1]);
    expect(k.run.cues.slice(-4)).toEqual(
      ["check_ready", "check_go", "check_ten_left", "check_time_up_curl"].slice(-4),
    );
  });
});

describe("arm_curl_30s quality: occlusion, a second person, the repeat (spec 4.2, 4.0)", () => {
  /** The wrist hidden (a wheel or armrest) from go + 5 to go + 15 s: a third of the trial unscored. */
  const hidden = (goSec: number) => [
    { landmarks: [16, 18, 20, 22], from: goSec + 5, to: goSec + 15, visibility: 0.2 },
  ];

  function occluded(seed: number, repeat: boolean) {
    // Pass 1 finds go; pass 2 adds the occlusion and finds the second go (after the repeat); pass 3
    // adds the reps of the second trial.
    const base = {
      test: "arm_curl_30s" as const,
      profile: "chair" as Profile,
      aspect: "9:16" as AspectName,
      seed,
      side: "right" as Side,
      opts: { variant: "arm_only" as const },
    };
    const first = twoPass({
      ...base,
      practice: curlPractice("right"),
      trial: () => [],
      durationSec: 95,
      answers: { repeat },
    });
    const go1 = first.goSec;
    const occlusions = hidden(go1);
    const second = twoPass({
      ...base,
      practice: curlPractice("right"),
      trial: (go) => curlTrial("right", go, seed, 140, 31),
      extra: { occlusions },
      durationSec: 95,
      answers: { repeat },
    });
    const gos = second.run.events
      .filter((e) => e.kind === "cue" && e.cue === "check_go")
      .map((e) => e.t / 1000);
    if (!repeat) return { first: second, gos, third: null };
    const go2 = gos[1];
    const third = twoPass({
      ...base,
      practice: [...curlPractice("right"), ...curlTrial("right", go1, seed, 140, 31)],
      trial: () => curlTrial("right", go2, seed + 1),
      extra: { occlusions },
      durationSec: 95,
      answers: { repeat },
    });
    return { first: second, gos, third, go2 };
  }

  it("fails the quality gate with over 20 percent unscored, prompts on screen, and offers one repeat", () => {
    const { first } = occluded(680, false);
    const r = res(first);
    expect(first.run.asks).toEqual(["repeat"]);
    expect(r.status).toBe("not_measured");
    expect(r.reason).toBe("quality");
    expect(r.value).toBeNull();
    expect(r.retried).toHaveLength(1);
    expect(Number(r.retried[0].detail.unscoredShare)).toBeGreaterThan(0.2);
    expect(r.retried[0].reasons).toContain("not_visible");
    // The visibility line is shown, never spoken, during the trial.
    const go = first.run.go!;
    const prompts = ofKind(first.run.events, "prompt").filter((e) => e.t > go && e.t < go + 30000);
    expect(prompts.length).toBeGreaterThanOrEqual(1);
    expect(prompts[0].cue).toBe("check_sleeves");
    const trialCues = first.run.events.filter((e) => e.kind === "cue" && e.t > go && e.t < go + 30000);
    expect(trialCues.map((e) => (e as { cue: string }).cue)).toEqual(["check_ten_left"]);
  });

  it("measures the repeat after the rest when the person takes it", () => {
    const { third, go2 } = occluded(681, true);
    const r = res(third!);
    expect(third!.run.asks).toEqual(["repeat"]);
    expect(r.status).toBe("measured");
    expect(r.retried).toHaveLength(1);
    expect(r.attempts).toHaveLength(1);
    expect(r.value).toBe(curlTruth(third!.trial, go2!));
    // A second go, after the 2 minute rest (shortened by the test options) and a new resting angle.
    const gos = third!.run.events.filter((e) => e.kind === "cue" && e.cue === "check_go");
    expect(gos).toHaveLength(2);
  });

  it("pauses scoring while a second person crosses, with the one person line shown and not spoken", () => {
    const seed = 682;
    const first = twoPass({
      test: "arm_curl_30s",
      profile: "chair",
      aspect: "9:16",
      seed,
      side: "right",
      practice: curlPractice("right"),
      trial: () => [],
      opts: { variant: "arm_only" },
    });
    const go = first.goSec;
    const k = twoPass({
      test: "arm_curl_30s",
      profile: "chair",
      aspect: "9:16",
      seed,
      side: "right",
      practice: curlPractice("right"),
      trial: (g) => curlTrial("right", g, seed),
      opts: { variant: "arm_only" },
      extra: { helper: { x: -1.4, z: 0.7, walk: { toX: 1.4, start: go + 12, speed: 2.8 } }, shuffle: true },
    });
    const r = res(k);
    const prompts = ofKind(k.run.events, "prompt");
    expect(prompts.some((p) => p.cue === "check_one_person")).toBe(true);
    const trialCues = k.run.events.filter(
      (e) => e.kind === "cue" && e.t > k.run.go! && e.t < k.run.go! + 30000,
    );
    expect(trialCues.map((e) => (e as { cue: string }).cue)).toEqual(["check_ten_left"]);
    expect(r.status).toBe("measured");
    expect(Number(r.detail.unscoredShare)).toBeGreaterThan(0);
    expect(Math.abs(r.value! - curlTruth(k.trial, k.goSec))).toBeLessThanOrEqual(1);
  });

  it("fails the 20 fps floor of the timed tests at 15 fps", () => {
    const { frames } = framesOfCurl(
      [...curlPractice("right"), ...curlTrial("right", 13, 683)],
      683,
      "chair",
      "9:16",
      50,
      { fps: 15 },
    );
    const run = drive(new ArmCurlRunner(CURL, "right", { ...FAST, variant: "arm_only" }), frames, {
      repeat: false,
    });
    const r = run.result.results[0];
    expect(run.asks).toEqual(["repeat"]);
    expect(r.status).toBe("not_measured");
    expect(r.retried[0].reasons).toContain("low_fps");
  });
});

describe("arm_curl_30s views and sides (spec 4.2 setup, 4.0 side labelling)", () => {
  it("stores the anterolateral view up to 30 degrees toward the front, and the side view", () => {
    const side = curlCase("chair", "9:16", "right", 690);
    expect(res(side).detail.view).toBe("side");
    expect(Number(res(side).detail.viewAngle)).toBeLessThan(10);
    // Right side to the phone is yaw -90; 25 degrees toward the front is -65.
    const ant = curlCase("wheelchair", "9:16", "right", 691, { extra: { subject: { yaw: -65 } } });
    const r = res(ant);
    expect(r.status).toBe("measured");
    expect(r.detail.view).toBe("anterolateral");
    expect(Math.abs(Number(r.detail.viewAngle) - 25)).toBeLessThanOrEqual(8);
    expect(Math.abs(r.value! - curlTruth(ant.trial, ant.goSec))).toBeLessThanOrEqual(1);
  });

  it("asks the person to turn and never measures a front view", () => {
    const { frames } = framesOfCurl(
      [...curlPractice("right"), ...curlTrial("right", 13, 692)],
      692,
      "chair",
      "9:16",
      45,
      {
        subject: { yaw: 0 },
      },
    );
    const run = drive(new ArmCurlRunner(CURL, "right", { ...FAST, variant: "arm_only" }), frames);
    const r = run.result.results[0];
    expect(run.cues).toContain("check_right_side_to_phone");
    expect(r.status).toBe("not_measured");
    expect(r.reason).toBe("quality");
  });

  it("counts the same on a mirrored camera when told, and does not score the other arm when not told", () => {
    const plain = curlCase("chair", "9:16", "right", 693);
    const mirrored = curlCase("chair", "9:16", "right", 693, {
      frames: (f) => mirrorFrames(f),
      opts: { variant: "arm_only", mirrored: true },
    });
    expect(res(mirrored).value).toBe(res(plain).value);
    const { frames } = framesOfCurl([...curlPractice("right"), ...curlTrial("right", 13, 693)], 693);
    const wrong = drive(
      new ArmCurlRunner(CURL, "right", { ...FAST, variant: "arm_only" }),
      mirrorFrames(frames),
    );
    expect(wrong.result.results[0].status).toBe("not_measured");
    expect(wrong.cues).toContain("check_right_side_to_phone");
  });
});

describe("arm_curl_30s stopped early", () => {
  it("returns a censored lower bound when finish() comes during the trial (the UI stores no score)", () => {
    const k = curlCase("chair", "9:16", "right", 695);
    const frames = k.frames.filter((f) => f.t <= k.run.go! + 12000);
    const run = drive(new ArmCurlRunner(CURL, "right", { ...FAST, variant: "arm_only" }), frames);
    const r = run.result.results[0];
    expect(run.result.completed).toBe(false);
    expect(r.status).toBe("stopped");
    expect(r.censored).toBe(true);
    expect(r.detail.censored).toBe(true);
    expect(r.detail.stoppedEarly).toBe(true);
    expect(Number(r.detail.secondsCompleted)).toBeCloseTo(12, 0);
    expect(r.attempts[0].censored).toBe(true);
    expect(r.attempts[0].outcome).toBe("invalid");
    const crossed = k.trial.filter(
      (m) => m.kind === "curl_rep" && curlRepTime(m, 0.8)! < k.goSec + 11.8,
    ).length;
    expect(Math.abs(r.value! - crossed)).toBeLessThanOrEqual(1);
  });
});

/* --------------------------------------------------------------- chair stand */

function standCase(profile: Profile, aspect: AspectName, seed: number, over: Partial<TwoPass> = {}) {
  return twoPass({
    test: "chair_stand_30s",
    profile,
    aspect,
    seed,
    practice: standPractice(),
    trial: (go) => standTrial(go, seed),
    extra: { subject: { arms: CROSSED } },
    ...over,
  });
}

/** Regular trial stands from go + 1 s, one every `every` s. */
function regularStands(
  go: number,
  lastStart: number,
  every = 2.6,
  extra: Partial<StandRep> = {},
): MotionSpec[] {
  const out: MotionSpec[] = [];
  for (let t = go + 1; t <= lastStart + 1e-9; t += every)
    out.push({ kind: "stand_rep", start: t, rise: 0.9, hold: 0.2, sit: 0.9, ...extra });
  return out;
}
type StandRep = Extract<MotionSpec, { kind: "stand_rep" }>;

describe("chair_stand_30s: counts within 1 of the ground truth for every profile and aspect", () => {
  let seed = 700;
  for (const profile of ["standing", "weaker_left", "weaker_right"] as Profile[]) {
    for (const aspect of ASPECTS) {
      const s = seed++;
      it(`${profile}, ${aspect}`, () => {
        const k = standCase(profile, aspect, s);
        const truth = standTruth(k.trial, k.goSec);
        const r = res(k);
        expect(k.run.result.completed).toBe(true);
        expect(r.side).toBe("none");
        expect(r.variant).toBe("standard");
        expect(r.status).toBe("measured");
        expect(truth).toBeGreaterThanOrEqual(9);
        expect(Math.abs(r.value! - truth)).toBeLessThanOrEqual(1);
        expect(r.detail.countSource).toBe("auto");
        expect(r.detail.halfwayCredited).toBe(false);
        expect(r.detail.stoppedEarly).toBe(false);
        expect(Number(r.detail.rise)).toBeGreaterThan(0.5);
        expect(r.detail.riseToday).toBe(r.detail.rise);
        expect(Number(r.detail.rangeHi) - Number(r.detail.rangeLo)).toBeCloseTo(Number(r.detail.rise), 2);
        expect(r.practice).toHaveLength(2);
        expect(r.quality.ok).toBe(true);
        expect(r.flags).not.toContain("arms_used");
        // Filmed at 45 degrees, so the sideways lean cannot be measured (spec 4.4 flags).
        expect(r.flags).toContain("lean_unknown");
        expect(trialCues(k.run.events)).toEqual(["check_go", "check_ten_left", "check_time_up_stand"]);
        expect(k.run.cues[k.run.cues.length - 1]).toBe("check_sit_minute");
      });
    }
  }
});

describe("chair_stand_30s counting rules (spec 4.4)", () => {
  it("counts a stand only at the count line with the shoulders over the hips, once per return to the seat", () => {
    const k = standCase("standing", "9:16", 720, {
      trial: (go) => {
        const out: MotionSpec[] = [];
        let t = go + 1;
        for (let i = 0; i < 9; i++) {
          if (i % 3 === 1)
            out.push({ kind: "stand_rep", start: t, rise: 0.9, hold: 0.3, sit: 0.9, peak: 0.6 });
          else if (i % 3 === 2)
            out.push({
              kind: "stand_rep",
              start: t,
              rise: 0.9,
              hold: 0.3,
              sit: 0.9,
              pitch: 20,
              topPitch: 60,
            });
          else out.push({ kind: "stand_rep", start: t, rise: 0.9, hold: 0.3, sit: 0.9 });
          t += 2.7;
        }
        // A hover: sitting only part of the way down, then up again, is one stand.
        out.push({ kind: "stand_rep", start: t, rise: 0.9, hold: 0.2, sit: 0.9, pitch: 20 });
        out.push({ kind: "stand_rep", start: t + 1.4, rise: 0.9, hold: 0.2, sit: 0.9, pitch: 20 });
        return out;
      },
    });
    const r = res(k);
    // 3 full stands, 3 partial (60 percent), 3 bent 60 degrees forward at the top, 1 hover pair.
    expect(r.value).toBe(4);
    expect(r.detail.partial).toBe(3);
  });

  function halfway(seed: number, last: Partial<StandRep> & { start: number }) {
    return standCase("standing", "9:16", seed, {
      trial: (go) => [
        ...regularStands(go, go + 25),
        { kind: "stand_rep", rise: 0.9, hold: 0.2, sit: 0.9, ...last, start: go + last.start },
      ],
    });
  }

  it("adds one stand when the person is rising and more than halfway up at 30.0 s", () => {
    const k = halfway(721, { start: 29.4 });
    const r = res(k);
    const full = k.trial.length - 1;
    expect(r.value).toBe(full + 1);
    expect(r.detail.halfwayCredited).toBe(true);
    // The stand reaches the count line only after 30.0 s.
    expect(standRepTime(k.trial[k.trial.length - 1] as StandRep, 0.85)! - k.goSec).toBeGreaterThan(30);
    expect(ofKind(k.run.events, "rep")).toHaveLength(full);
  });

  it("adds nothing when the person is less than halfway up at 30.0 s", () => {
    const k = halfway(722, { start: 29.75 });
    expect(res(k).value).toBe(k.trial.length - 1);
    expect(res(k).detail.halfwayCredited).toBe(false);
  });

  it("adds nothing when the person is sitting down from a counted stand at 30.0 s", () => {
    const k = halfway(723, { start: 28.4, sit: 1.5 });
    expect(res(k).value).toBe(k.trial.length);
    expect(res(k).detail.halfwayCredited).toBe(false);
  });

  it("adds nothing when an uncounted rise has stopped (not rising) at 30.0 s", () => {
    const k = halfway(724, { start: 28.6, peak: 0.7, hold: 3 });
    expect(res(k).value).toBe(k.trial.length - 1);
    expect(res(k).detail.halfwayCredited).toBe(false);
  });

  it("asks a third practice stand when the two rises differ by more than 15 percent; R is the largest", () => {
    const k = standCase("standing", "9:16", 725, {
      practice: [
        { kind: "stand_rep", start: 2, rise: 1.5, hold: 1.2, sit: 1.5 },
        { kind: "stand_rep", start: 7, rise: 1.5, hold: 1.2, sit: 1.5, peak: 0.7 },
        { kind: "stand_rep", start: 12.5, rise: 1.5, hold: 1.2, sit: 1.5 },
      ],
    });
    const r = res(k);
    expect(r.practice).toHaveLength(3);
    const rises = r.practice.map((p) => Number(p.detail.R));
    expect(practiceDiffers(rises[0], rises[1])).toBe(true);
    expect(Number(r.detail.rise)).toBeCloseTo(Math.max(...rises), 2);
    expect(k.run.cues.filter((c) => c === "test_stand_full")).toHaveLength(2);
    expect(r.value).toBe(standTruth(k.trial, k.goSec));
  });

  it("pauses after the first practice stand for Parkinson's with test_stand_dizzy", () => {
    const k = standCase("standing", "9:16", 726, {
      practice: [
        { kind: "stand_rep", start: 2, rise: 1.5, hold: 1.2, sit: 1.5 },
        { kind: "stand_rep", start: 11, rise: 1.5, hold: 1.2, sit: 1.5 },
      ],
      opts: { pausePractice: true },
      durationSec: 56,
    });
    const r = res(k);
    const dizzy = k.run.events.find((e) => e.kind === "cue" && e.cue === "test_stand_dizzy")!;
    expect(dizzy.t).toBeGreaterThan(5000);
    expect(dizzy.t).toBeLessThan(7000);
    const rest = ofKind(k.run.events, "phase").find((e) => e.phase === "rest")!;
    expect(rest.t).toBe(dizzy.t);
    expect(r.practice).toHaveLength(2);
    expect(r.flags).toContain("pd_pause");
    expect(r.value).toBe(standTruth(k.trial, k.goSec));
  });

  it("never measures a pure side view (the view gate of the chair stand)", () => {
    const { frames } = framesOf(
      spec("chair_stand_30s", "standing", "9:16", [...standPractice(), ...standTrial(16, 727)], 50, 727, {
        fps: 20,
        subject: { arms: CROSSED, yaw: -90 },
      }),
    );
    const run = drive(new ChairStandRunner(STAND, "none", FAST), frames);
    // No weaker side declared: the phone stands toward the right (spec 4.4 setup).
    expect(run.cues).toContain("check_phone_angle_right");
    expect(run.result.results[0].status).toBe("not_measured");
    expect(run.result.results[0].reason).toBe("quality");
  });
});

describe("chair_stand_30s later checks (D-009 fixedRange)", () => {
  function baselineRange(seed: number): [number, number] {
    const r = res(standCase("standing", "9:16", seed));
    return [Number(r.detail.rangeLo), Number(r.detail.rangeHi)];
  }

  it("measures h_sit again and counts against the baseline rise when today's rise matches", () => {
    const [lo, hi] = baselineRange(730);
    // A different h_sit in the stored range changes nothing: only the rise is taken from it.
    const k = standCase("standing", "16:9", 731, { opts: { fixedRange: [lo + 0.5, hi + 0.5] } });
    const r = res(k);
    expect(r.flags).not.toContain("range_mismatch");
    expect(Number(r.detail.rise)).toBeCloseTo(hi - lo, 2);
    expect(Math.abs(Number(r.detail.riseToday) / (hi - lo) - 1)).toBeLessThan(0.15);
    expect(r.value).toBe(standTruth(k.trial, k.goSec));
    const small = standCase("standing", "9:16", 732, { opts: { fixedRange: [lo, lo + 0.9 * (hi - lo)] } });
    expect(res(small).flags).not.toContain("range_mismatch");
    expect(res(small).value).toBe(standTruth(small.trial, small.goSec));
  });

  it("re-cues once, then flags range_mismatch and still counts against the baseline line", () => {
    const [lo, hi] = baselineRange(733);
    const R = 1.3 * (hi - lo);
    const k = standCase("standing", "9:16", 734, {
      practice: [...standPractice(), { kind: "stand_rep", start: 12.5, rise: 1.5, hold: 1.2, sit: 1.5 }],
      opts: { fixedRange: [lo, lo + R] },
      durationSec: 58,
    });
    const r = res(k);
    expect(k.run.cues.filter((c) => c === "test_stand_full")).toHaveLength(2);
    expect(r.practice).toHaveLength(3);
    expect(r.flags).toContain("range_mismatch");
    expect(Number(r.detail.rise)).toBeCloseTo(R, 2);
    // The baseline line is out of reach of today's full stands: none counts.
    expect(r.status).toBe("measured");
    expect(r.value).toBe(0);
  });
});

describe("chair_stand_30s arms and variants (spec 4.4)", () => {
  /** Stands that push on the thighs with both hands from the fourth stand on. */
  const pushingFromFourth = (go: number) =>
    regularStands(go, go + 26).map((m, i) =>
      i >= 3 ? { ...(m as StandRep), push: ["left", "right"] as Side[] } : m,
    );

  it("stops the standard version when arms are used, asks pushedAsk, and yes gives needed_arms with no score", () => {
    const k = standCase("standing", "9:16", 740, { trial: pushingFromFourth, answers: { pushed: true } });
    const r = res(k);
    expect(k.run.asks).toEqual(["pushed"]);
    expect(ofKind(k.run.events, "ask")[0].side).toBe("none");
    expect(r.status).toBe("not_measured");
    expect(r.reason).toBe("needed_arms");
    expect(r.value).toBeNull();
    expect(r.flags).toContain("arms_used");
    expect(r.detail.stoppedEarly).toBe(true);
    const secs = Number(r.detail.secondsCompleted);
    const fourth = k.trial[3] as StandRep;
    expect(secs).toBeGreaterThan(fourth.start - k.goSec);
    expect(secs).toBeLessThan(fourth.start - k.goSec + 1.2);
    const stop = k.run.cues.indexOf("check_stop_now");
    expect(stop).toBeGreaterThan(k.run.cues.indexOf("check_go"));
    expect(k.run.cues[k.run.cues.length - 1]).toBe("test_stand_hands_needed");
  });

  it("makes the attempt a quality failure, keeping the variant, when the person did not push", () => {
    const k = standCase("standing", "9:16", 741, { trial: pushingFromFourth, answers: { pushed: false } });
    const r = res(k);
    expect(r.status).toBe("not_measured");
    expect(r.reason).toBe("quality");
    expect(r.variant).toBe("standard");
    expect(k.run.cues).not.toContain("test_stand_hands_needed");
  });

  it("stops in the practice when the practice stands need the hands", () => {
    const { frames } = framesOf(
      spec("chair_stand_30s", "standing", "9:16", standPractice({ push: ["left", "right"] }), 20, 742, {
        fps: 20,
        subject: { arms: CROSSED },
      }),
    );
    const run = drive(new ChairStandRunner(STAND, "none", FAST), frames, { pushed: true });
    expect(run.asks).toEqual(["pushed"]);
    expect(run.cues).not.toContain("check_go");
    expect(run.result.results[0].reason).toBe("needed_arms");
  });

  it("counts the hands allowed version (hands_allowed runs as arms_assisted) and records the push hand", () => {
    const push = { push: ["right"] as Side[] };
    const k = standCase("weaker_left", "9:16", 743, {
      practice: standPractice(push),
      trial: (go) => standTrial(go, 743, () => push),
      opts: { variant: "hands_allowed", pushHand: "right" },
      extra: {},
    });
    const r = res(k);
    expect(r.variant).toBe("arms_assisted");
    expect(r.status).toBe("measured");
    expect(r.value).toBe(standTruth(k.trial, k.goSec));
    expect(r.flags).toContain("hands_used");
    expect(r.flags).not.toContain("arms_used");
    expect(r.detail.pushHand).toBe("right");
    expect(k.run.cues).toContain("test_stand_hands_ok");
    expect(k.run.cues).not.toContain("test_stand_arms_cross");
  });

  it("checks only the intact wrist in one_arm_cross (a missing limb is placed at an average position)", () => {
    // Right arm limb loss, on the side nearer the phone: the model puts the missing arm hanging by
    // the side, its wrist below the hips; the left hand is on the right shoulder.
    const arms = { left: CROSSED.left };
    const one = standCase("standing", "9:16", 744, {
      extra: { subject: { arms } },
      opts: { variant: "one_arm_cross", limbLossArm: "right" },
    });
    expect(res(one).status).toBe("measured");
    expect(one.run.asks).toEqual([]);
    expect(res(one).value).toBe(standTruth(one.trial, one.goSec));
    expect(one.run.cues).not.toContain("test_stand_arms_cross");
    // The same recording read as the standard version: the hanging wrist is taken as arms used.
    const std = drive(new ChairStandRunner(STAND, "none", FAST), one.frames, { pushed: true });
    expect(std.asks).toEqual(["pushed"]);
    expect(std.result.results[0].reason).toBe("needed_arms");
    // With the loss on the far side, the intact near hand pushing on its thigh is arms used.
    const pushing = standCase("standing", "9:16", 745, {
      extra: { subject: { arms: { right: CROSSED.right } } },
      trial: (go) =>
        regularStands(go, go + 26).map((m, i) =>
          i >= 2 ? { ...(m as StandRep), push: ["right"] as Side[] } : m,
        ),
      opts: { variant: "one_arm_cross", limbLossArm: "left" },
      answers: { pushed: true },
    });
    expect(pushing.run.asks).toEqual(["pushed"]);
    expect(res(pushing).reason).toBe("needed_arms");
  });

  it("stores arm use as unknown when the wrists are not seen clearly, never as arms used", () => {
    const k = standCase("standing", "9:16", 746, {
      trial: pushingFromFourth,
      extra: {
        subject: { arms: CROSSED },
        occlusions: [{ landmarks: [15, 16], from: 0, to: 60, visibility: 0.55 }],
      },
    });
    const r = res(k);
    expect(k.run.asks).toEqual([]);
    expect(r.status).toBe("measured");
    expect(r.flags).toContain("arm_use_unknown");
    expect(r.flags).not.toContain("arms_used");
  });

  it("plays test_stand_steady at each stand of the walking aid version and ends on reaching the support", () => {
    const k = standCase("standing", "9:16", 747, { opts: { variant: "arms_assisted_steady" } });
    const r = res(k);
    const go = k.run.go!;
    const practiceSteady = k.run.events.filter(
      (e) => e.kind === "cue" && e.cue === "test_stand_steady" && e.t < go,
    );
    expect(practiceSteady).toHaveLength(2);
    const trial = trialCues(k.run.events);
    expect(trial.filter((c) => c === "test_stand_steady")).toHaveLength(r.value!);
    expect(trial.filter((c) => c !== "test_stand_steady")).toEqual([
      "check_go",
      "check_ten_left",
      "check_time_up_stand",
    ]);

    // Reaching for the support in front ends the test: needed_support, no score.
    const runner = new ChairStandRunner(STAND, "none", { ...FAST, variant: "arms_assisted_steady" });
    runner.start(k.frames[0].t);
    let out: TestEvent[] = [];
    for (const f of k.frames) {
      runner.feed(f, { rollDeg: 0 });
      if (f.t >= go + 10000 && !runner.done) out = runner.reportSupport(f.t);
    }
    const s = runner.finish(k.frames[k.frames.length - 1].t).results[0];
    expect(out.some((e) => e.kind === "done")).toBe(true);
    expect(s.status).toBe("not_measured");
    expect(s.reason).toBe("needed_support");
    expect(s.value).toBeNull();
    expect(s.detail.stoppedEarly).toBe(true);
  });

  it("flags a lean toward the stronger side only in a front view", () => {
    // Weaker left: the stronger side is the right. Filmed square on, each stand leans 15 degrees right.
    const leanRight = (go: number) =>
      regularStands(go, go + 26).flatMap((m) => [
        m,
        {
          kind: "side_lean",
          toward: "right",
          peak: 15,
          start: (m as StandRep).start + 0.3,
          rise: 0.5,
          hold: 0.5,
          back: 0.5,
        } as MotionSpec,
      ]);
    const front = standCase("weaker_left", "9:16", 748, {
      trial: leanRight,
      opts: { weakerSide: "left" },
      extra: { subject: { arms: CROSSED, yaw: 0 } },
    });
    expect(res(front).flags).toContain("lean_stronger");
    expect(res(front).flags).not.toContain("lean_unknown");
    const upright = standCase("weaker_left", "9:16", 749, {
      opts: { weakerSide: "left" },
      extra: { subject: { arms: CROSSED, yaw: 0 } },
    });
    expect(res(upright).flags).not.toContain("lean_stronger");
    expect(res(upright).flags).not.toContain("lean_unknown");
  });

  it("stores the fast sit down and the pause flags without changing the count", () => {
    const k = standCase("standing", "9:16", 750, {
      trial: (go) => [...regularStands(go, go + 8, 2.6, { sit: 0.4 }), ...regularStands(go + 14, go + 26)],
    });
    const r = res(k);
    expect(r.flags).toContain("fast_sit");
    expect(r.flags).toContain("pause");
    expect(r.value).toBe(standTruth(k.trial, k.goSec));
  });
});

describe("count source and the runner factory", () => {
  it("applies a staff or self count as a copy, keeping the engine count auto", () => {
    const k = standCase("standing", "9:16", 760);
    const r = res(k);
    const staff = applyCountSource(r, "staff", r.value! + 1);
    expect(staff.value).toBe(r.value! + 1);
    expect(staff.detail.countSource).toBe("staff");
    expect(r.detail.countSource).toBe("auto");
    expect(applyCountSource(r, "self", 3).detail.countSource).toBe("self");
    expect(() => applyCountSource(r, "self", 2.5)).toThrow();
    expect(() => applyCountSource(r, "self", 101)).toThrow();
  });

  it("builds the timed runners and refuses wrong sides and variants", () => {
    expect(createRunner(CURL, "left")).toBeInstanceOf(ArmCurlRunner);
    expect(createRunner(STAND, "none")).toBeInstanceOf(ChairStandRunner);
    expect(createRunner(CURL, "left").sides).toEqual(["left"]);
    expect(createRunner(STAND, "none").sides).toEqual(["none"]);
    expect(() => createRunner(CURL, "none")).toThrow(/side/);
    expect(() => createRunner(STAND, "left")).toThrow(/no sides/);
    expect(() => createRunner(CURL, "left", { variant: "standard" })).toThrow(/variant/);
    expect(() => createRunner(STAND, "none", { variant: "held" })).toThrow(/variant/);
    expect(() => createRunner(STAND, "none", { variant: "one_arm_cross" })).toThrow(/limbLossArm/);
    expect(createRunner(STAND, "none", { variant: "hands_allowed" })).toBeInstanceOf(ChairStandRunner);
  });
});

describe("timed count fixtures on disk (tests/fixtures, ground truth in the file)", () => {
  it("arm_curl_30s/weaker_left/trial-16x9.json: the count is the ground truth", () => {
    const fx = loadFixture<GenTruth>(join(FIXTURE_ROOT, "arm_curl_30s/weaker_left/trial-16x9.json"));
    const run = drive(new ArmCurlRunner(CURL, "left", { ...FAST, variant: "arm_only" }), fixtureFrames(fx));
    const r = run.result.results[0];
    const goSec = run.go! / 1000;
    const motions = fx.meta.spec!.subject!.motions!;
    const truth = curlTruth(motions, goSec);
    expect(fx.truth.reps).toHaveLength(motions.length);
    expect(truth).toBeGreaterThanOrEqual(13);
    expect(r.status).toBe("measured");
    expect(Math.abs(r.value! - truth)).toBeLessThanOrEqual(1);
    expect(r.value).toBe(truth);
    // The last bend's 80 percent point comes after 30.0 s: it is in the recording, not counted.
    const late = motions.filter((m) => m.kind === "curl_rep" && curlRepTime(m, 0.8)! >= goSec + 30);
    expect(late.length).toBeGreaterThanOrEqual(1);
  });

  it("chair_stand_30s/standing/hands-9x16.json: hand use stops the test at the fourth trial stand", () => {
    const fx = loadFixture<GenTruth>(join(FIXTURE_ROOT, "chair_stand_30s/standing/hands-9x16.json"));
    expect(fx.truth.reps!.filter((x) => x.push)).toHaveLength(2);
    const run = drive(new ChairStandRunner(STAND, "none", FAST), fixtureFrames(fx), { pushed: true });
    const r = run.result.results[0];
    expect(run.asks).toEqual(["pushed"]);
    expect(r.flags).toContain("arms_used");
    expect(r.reason).toBe("needed_arms");
    expect(r.value).toBeNull();
    const firstPush = fx.truth.reps!.find((x) => x.push)!;
    const ask = ofKind(run.events, "ask")[0];
    expect(ask.t / 1000).toBeGreaterThan(firstPush.start);
    expect(ask.t / 1000).toBeLessThan(firstPush.start + 1);
    // The three stands with the arms crossed were counted before the stop.
    expect(ofKind(run.events, "rep")).toHaveLength(3);
  });
});

describe("LineCounter, the counting rule of both tests", () => {
  const curl = () => new LineCounter(0.8, 0.2, 0.5);

  it("counts at the count line crossing only after the return line, with the crossing time interpolated", () => {
    const c = curl();
    expect(c.push(0, 0.5)).toBeNull(); // not armed yet: the rep did not start from the return line
    expect(c.push(100, 0.9)).toBeNull();
    expect(c.push(200, 0.1)).toBeNull();
    expect(c.push(300, 0.6)).toBeNull();
    const x = c.push(400, 1.0)!;
    expect(x.late).toBe(false);
    expect(x.t).toBeCloseTo(350, 6);
    expect(c.count).toBe(1);
    expect(c.times).toEqual([350]);
  });

  it("never counts a hover twice and counts a partial rise on its return", () => {
    const c = curl();
    for (const [t, p] of [
      [0, 0],
      [100, 0.9],
      [200, 0.5],
      [300, 0.95],
      [400, 0.1],
      [500, 0.65],
      [600, 0.15],
      [700, 0.3],
      [800, 0.1],
    ])
      c.push(t, p);
    expect(c.count).toBe(1);
    expect(c.partial).toBe(1);
  });

  it("does not count a crossing at or after the end, and waits for the extra condition", () => {
    const c = curl();
    c.push(0, 0);
    const late = c.push(1000, 1, true, 700)!;
    expect(late.late).toBe(true);
    expect(late.t).toBe(800);
    expect(c.count).toBe(0);
    const d = new LineCounter(0.85, 0.15, 0.5);
    d.push(0, 0);
    expect(d.push(100, 0.9, false)).toBeNull();
    expect(d.push(200, 0.95, true)!.t).toBe(200);
    expect(d.count).toBe(1);
  });

  it("reports an uncounted rise in progress (for the halfway rule)", () => {
    const c = new LineCounter(0.85, 0.15, 0.5);
    c.push(0, 0);
    expect(c.rising).toBe(false);
    c.push(100, 0.6);
    expect(c.rising).toBe(true);
    expect(c.risePeak).toBe(0.6);
    c.push(200, 0.9);
    expect(c.rising).toBe(false);
  });

  it("does not interpolate across a gap", () => {
    const c = curl();
    c.push(0, 0);
    c.push(100, 0.5);
    c.gap();
    expect(c.push(300, 0.9)!.t).toBe(300);
  });
});

describe("practice trackers", () => {
  it("BendTracker finds each practice bend with its hanging angle, top and excursion", () => {
    const b = new BendTracker();
    const angle = (t: number) =>
      t < 1000 ? 175 : t < 3000 ? 175 - 135 * Math.sin((Math.PI * (t - 1000)) / 2000) : 175;
    for (let t = 0; t <= 4000; t += 50) b.push(t, angle(t));
    expect(b.bends).toHaveLength(1);
    expect(b.bends[0].E).toBeCloseTo(175, 6);
    expect(b.bends[0].F).toBeCloseTo(40, 0);
    expect(b.bends[0].X).toBeCloseTo(135, 0);
    // A dip under 15 degrees is not a bend.
    const small = new BendTracker();
    for (let t = 0; t <= 4000; t += 50) small.push(t, t > 1000 && t < 2000 ? 165 : 175);
    expect(small.bends).toHaveLength(0);
  });

  it("StandTracker takes the rise over the top of each practice stand", () => {
    const s = new StandTracker(1);
    const h = (t: number) =>
      t < 1000
        ? 1
        : t < 2000
          ? 1 + 0.8 * ((t - 1000) / 1000)
          : t < 3000
            ? 1.8
            : t < 4000
              ? 1.8 - 0.8 * ((t - 3000) / 1000)
              : 1;
    for (let t = 0; t <= 5000; t += 50) s.push(t, h(t), 1);
    expect(s.stands).toHaveLength(1);
    expect(s.stands[0].R).toBeCloseTo(0.8, 2);
    expect(s.stands[0].v).toBe(1);
  });

  it("practiceDiffers reads more than 15 percent of the larger value", () => {
    expect(practiceDiffers(100, 85)).toBe(false);
    expect(practiceDiffers(100, 84)).toBe(true);
    expect(practiceDiffers(0, 0)).toBe(false);
  });
});

describe("the runners' numbers are the spec's (spec 4.2, 4.4 and the check data)", () => {
  it("arm curl", () => {
    const m = CURL.metric;
    expect(CURL.durationSec).toBe(TIMED_RULES.trialSec);
    expect(CURL.practice).toBe(2);
    expect(CURL.attempts).toBe(1);
    expect(m.countLine).toMatch(/rises to 0\.80 or more after p was 0\.20 or less/);
    expect(TIMED_RULES.curlCountLine).toBe(0.8);
    expect(TIMED_RULES.curlReturnLine).toBe(0.2);
    expect(m.partial).toMatch(/between p 0\.50 and 0\.80/);
    expect(TIMED_RULES.curlPartialLine).toBe(0.5);
    expect(m.personalRange).toMatch(/more than 15 percent a third practice bend/);
    expect(m.personalRange).toMatch(/X under 30 degrees/);
    expect(TIMED_RULES.practiceDiff).toBe(0.15);
    expect(TIMED_RULES.curlMinExcursionDeg).toBe(30);
    expect(m.compensated).toMatch(/more than 20 degrees/);
    expect(m.compensated).toMatch(/more than 12 degrees/);
    expect(TIMED_RULES.curlUpperArmDeg).toBe(20);
    expect(TIMED_RULES.curlTrunkPitchDeg).toBe(12);
    expect(m.occlusion).toMatch(/over 20 percent of the 30 s is unscored/);
    expect(m.occlusion).toMatch(/one repeat after 2 minutes/);
    expect(TIMED_RULES.maxUnscoredShare).toBe(0.2);
    expect(TIMED_RULES.repeatRestSec).toBe(120);
    expect(m.endRule).toMatch(/before 30\.0 s after go/);
    expect(CURL.requiredLandmarks.minVisibility).toBe(0.6);
  });

  it("chair stand", () => {
    const m = STAND.metric;
    expect(STAND.durationSec).toBe(TIMED_RULES.trialSec);
    expect(STAND.practice).toBe(2);
    expect(STAND.restSec.afterPractice).toBe(TIMED_RULES.standPracticeRestSec);
    expect(m.countLine).toMatch(/reaches 0\.85 or more/);
    expect(m.countLine).toMatch(/after p was 0\.15 or less/);
    expect(m.countLine).toMatch(/at least 0\.9 times/);
    expect(TIMED_RULES.standCountLine).toBe(0.85);
    expect(TIMED_RULES.standReturnLine).toBe(0.15);
    expect(TIMED_RULES.shouldersOverHips).toBe(0.9);
    expect(m.personalRange).toMatch(/more than 15 percent, a third practice stand/);
    expect(m.d009).toMatch(/outside 0\.85 to 1\.15 times/);
    expect(TIMED_RULES.riseMatch).toEqual([0.85, 1.15]);
    expect(m.endRule).toMatch(/rising and p is 0\.50 or more, one stand is added/);
    expect(TIMED_RULES.standHalfwayLine).toBe(0.5);
    expect(STAND.variantRules[2]).toMatch(/visibility 0\.7 or more/);
    expect(STAND.variantRules[2]).toMatch(
      /within 0\.3 shoulder widths of the thigh line, for 0\.3 s or more while rising/,
    );
    expect(TIMED_RULES.armWristVisibility).toBe(0.7);
    expect(TIMED_RULES.armThighShoulderWidths).toBe(0.3);
    expect(TIMED_RULES.armSec).toBe(0.3);
    expect(STAND.requiredLandmarks.minVisibility).toBe(0.5);
  });

  it("emits only check cue ids of the data", () => {
    const k = curlCase("chair", "9:16", "right", 699, { opts: { variant: "held" } });
    const s = standCase("standing", "9:16", 799, {
      opts: { variant: "arms_assisted_steady", pausePractice: true },
      practice: [
        { kind: "stand_rep", start: 2, rise: 1.5, hold: 1.2, sit: 1.5 },
        { kind: "stand_rep", start: 11, rise: 1.5, hold: 1.2, sit: 1.5 },
      ],
      durationSec: 56,
    });
    for (const run of [k.run, s.run]) {
      for (const e of run.events) {
        if (e.kind === "cue" || e.kind === "prompt") expect(CHECK_CUE_IDS).toContain(e.cue);
      }
    }
  });
});

describe("resting references", () => {
  it("arm curl: takes the practice's hanging angle when the arm was held bent at calibration", () => {
    // The elbow is held bent at about 60 degrees for the first second (a slow bend at its top).
    const hold: MotionSpec = { kind: "curl_rep", side: "right", start: -1, dur: 5, top: 60 };
    const k = curlCase("chair", "9:16", "right", 697, {
      practice: [
        hold,
        ...[5, 8.5].map((start) => ({ kind: "curl_rep" as const, side: "right" as const, start, dur: 3 })),
      ],
      durationSec: 56,
    });
    const r = res(k);
    expect(Number(r.detail.rangeLo)).toBeGreaterThan(165);
    expect(r.value).toBe(curlTruth(k.trial, k.goSec));
  });

  it("chair stand: calibrates again seated when the first calibration caught the person standing", () => {
    const standing: MotionSpec = { kind: "stand_rep", start: -2, rise: 1, hold: 3, sit: 1.5 };
    const k = standCase("standing", "9:16", 797, {
      practice: [
        standing,
        ...[6, 11].map((start) => ({ kind: "stand_rep" as const, start, rise: 1.5, hold: 1.2, sit: 1.5 })),
      ],
      durationSec: 58,
    });
    const phases = ofKind(k.run.events, "phase").map((e) => e.phase);
    expect(phases.filter((p) => p === "calibrating").length).toBeGreaterThanOrEqual(2);
    const r = res(k);
    expect(r.status).toBe("measured");
    expect(Number(r.detail.rise)).toBeGreaterThan(0.6);
    expect(r.value).toBe(standTruth(k.trial, k.goSec));
  });
});

describe("chair_stand_30s stopped early", () => {
  it("returns a censored lower bound when finish() comes during the trial", () => {
    const k = standCase("standing", "9:16", 798);
    const frames = k.frames.filter((f) => f.t <= k.run.go! + 15000);
    const run = drive(new ChairStandRunner(STAND, "none", FAST), frames);
    const r = run.result.results[0];
    expect(r.status).toBe("stopped");
    expect(r.censored).toBe(true);
    expect(r.detail.stoppedEarly).toBe(true);
    expect(Number(r.detail.secondsCompleted)).toBeCloseTo(15, 0);
    const counted = k.trial.filter(
      (m) => m.kind === "stand_rep" && (standRepTime(m, 0.85) ?? Infinity) < k.goSec + 14.8,
    );
    expect(Math.abs(r.value! - counted.length)).toBeLessThanOrEqual(1);
  });
});
