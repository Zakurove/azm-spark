/**
 * Quality gate v2 (architecture section 5, contract v2 section F, spec 4.0): per test gate and
 * optional landmarks, view classes, in frame share, fps floors, pausedShare, distance, retry cues,
 * and the live setup check.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG } from "./fixtures/catalog";
import { FIXTURE_ROOT, fixtureFrames, loadFixture, type Fixture } from "./fixtures/format";
import { expectedViewOf, generate, type GenSpec, type GenTruth } from "./fixtures/gen";
import {
  ACCEPTED_VIEWS,
  classifyView,
  distanceIssue,
  estimateDistanceM,
  estimateTurnDeg,
  phoneTilt,
  QUALITY_RULES,
  QualityMonitor,
  qualityConfig,
  retryCue,
  retryLine,
  setupCheck,
  setupConfig,
  viewOfRatio,
  viewRatio,
  VIEW_RATIO,
  type QualityIssue,
  type QualityOptions,
  type SetupFrame,
  type SetupOptions,
  type TestSide,
} from "../src/engine/quality";
import { posesOf, SubjectLock } from "../src/engine/subject";
import { emptyPose } from "../src/engine/subject";
import { LM } from "../src/engine/types";
import { CHECK_DATA, cueLine, isCheckCueId, testDef, TEST_IDS } from "../src/movements/assessments";
import type { TestId } from "../src/movements/types";

const disk = (file: string) => loadFixture<GenTruth>(join(FIXTURE_ROOT, file));

/** Feeds a fixture through the subject lock into a quality monitor, like a runner would. */
function gate(
  fx: Fixture<GenTruth>,
  testId: TestId,
  side: TestSide,
  opts: QualityOptions & { windowFrames?: number; every?: number } = {},
) {
  const frames = fixtureFrames(fx).filter((_, i) => i % (opts.every ?? 1) === 0);
  const lock = new SubjectLock();
  lock.lock(posesOf(frames[0]), frames[0].aspect);
  const monitor = new QualityMonitor(qualityConfig(testDef(testId), side, opts));
  frames.forEach((f, i) => monitor.feedPick(f, lock.pickFrame(f), i < (opts.windowFrames ?? 0)));
  return monitor.report();
}

const spec = (s: Partial<GenSpec> & Pick<GenSpec, "test">): GenSpec => ({
  profile: "chair",
  aspect: "9:16",
  fps: 15,
  durationSec: 3,
  seed: 31,
  ...s,
});

describe("quality config comes from the check data", () => {
  it("takes gate, optional and minimum visibility per test and side", () => {
    const abd = testDef("shoulder_abduction");
    const left = qualityConfig(abd, "left");
    expect(left.gate).toEqual(abd.requiredLandmarks.gate.left);
    expect(left.windowGate).toEqual(abd.requiredLandmarks.gateCalibrationTrunkMode);
    expect(left.optional).toEqual(abd.requiredLandmarks.optional);
    expect(left.minVisibility).toBe(0.6);
    expect(qualityConfig(abd, "right").gate).toEqual([11, 12, 14]);
    expect(qualityConfig(abd, "left", { trunkReference: false }).windowGate).toEqual([]);
    expect(() => qualityConfig(abd, "none")).toThrow();
    const curl = testDef("arm_curl_30s");
    expect(qualityConfig(curl, "right").gate).toEqual([12, 14, 16]);
    expect(() => qualityConfig(curl, "none")).toThrow();
    const trunk = qualityConfig(testDef("trunk_control_seated"), "none");
    expect(trunk.gate).toEqual([11, 12]);
    expect(trunk.windowGate).toEqual([23, 24]);
    expect(trunk.minVisibility).toBe(0.5);
    const stand = qualityConfig(testDef("chair_stand_30s"), "none");
    expect(stand.gate).toEqual([11, 12, 23, 24]);
    expect(stand.optional).toContain(LM.l_wrist);
  });

  it("uses the fps floors of spec 4.0: 12 for the range tests and the side lean, 20 for the timed tests", () => {
    expect(CHECK_DATA.engine.model.minFps).toEqual({ range_test: 12, trunk_control: 12, timed_count: 20 });
    expect(qualityConfig(testDef("shoulder_abduction"), "left").minFps).toBe(12);
    expect(qualityConfig(testDef("trunk_control_seated"), "none").minFps).toBe(12);
    expect(qualityConfig(testDef("arm_curl_30s"), "left").minFps).toBe(20);
    expect(qualityConfig(testDef("chair_stand_30s"), "none").minFps).toBe(20);
  });

  it("uses the setup distance of each test and the general thresholds", () => {
    for (const id of TEST_IDS) {
      const c = qualityConfig(
        testDef(id),
        id === "shoulder_abduction" || id === "arm_curl_30s" ? "left" : "none",
      );
      expect(c.distanceM).toEqual(testDef(id).setup.distanceM);
      expect(c.margin).toBe(0.03);
      expect(c.minVisibleShare).toBe(0.9);
      expect(c.maxPausedShare).toBe(0.1);
    }
    expect(QUALITY_RULES.minInFrameShare).toBe(0.9);
  });

  it("accepts the views of spec 4.1 to 4.4", () => {
    expect(ACCEPTED_VIEWS.shoulder_abduction).toEqual(["front"]);
    expect(ACCEPTED_VIEWS.trunk_control_seated).toEqual(["front"]);
    expect(ACCEPTED_VIEWS.arm_curl_30s).toEqual(["side"]);
    expect([...ACCEPTED_VIEWS.chair_stand_30s].sort()).toEqual(["front", "oblique", "unknown"]);
    expect(ACCEPTED_VIEWS.chair_stand_30s).not.toContain("side");
    expect(testDef("chair_stand_30s").viewNote).toMatch(/accept front or unknown/);
    expect(testDef("arm_curl_30s").viewAllowance).toMatch(/up to 30 degrees/);
  });
});

describe("classifyView", () => {
  it("names the view of every fixture that has one, in pixel space", () => {
    for (const entry of CATALOG) {
      const fx = disk(entry.file);
      if (!fx.truth.expectedView) continue;
      const frames = fixtureFrames(fx);
      const lock = new SubjectLock();
      lock.lock(posesOf(frames[0]), frames[0].aspect);
      const pick = lock.pickFrame(frames[0]);
      expect(classifyView(pick.lm!, frames[0].aspect), entry.file).toBe(fx.truth.expectedView);
    }
  });

  for (const aspect of ["9:16", "16:9"] as const) {
    for (const profile of ["chair", "wheelchair", "weaker_right"] as const) {
      it(`follows the turn of the body at ${aspect}, ${profile}`, () => {
        for (const yaw of [0, 15, 25, 35, 40, 45, 50, 65, 75, 90, -20, -45, -90]) {
          const fx = generate(
            spec({ test: "shoulder_abduction", profile, aspect, durationSec: 0.6, subject: { yaw } }),
          );
          const frames = fixtureFrames(fx);
          const want = expectedViewOf(yaw);
          if (!want) continue;
          // The monitor classifies the median ratio of an attempt; one frame carries model jitter.
          const ratios = frames.map((f) => viewRatio(f.lm, f.aspect)!).sort((a, b) => a - b);
          expect(viewOfRatio(ratios[ratios.length >> 1]), `yaw ${yaw}`).toBe(want);
          if (yaw === 0 || Math.abs(yaw) === 90)
            expect(classifyView(frames[0].lm, frames[0].aspect)).toBe(want);
        }
      });
    }
  }

  it("keeps the anterolateral arm curl view (up to 30 degrees toward the front) a side view", () => {
    for (const aspect of ["9:16", "16:9"] as const) {
      for (const profile of ["chair", "wheelchair"] as const) {
        for (const yaw of [-60, -70, 60]) {
          const fx = generate(
            spec({ test: "arm_curl_30s", profile, aspect, durationSec: 0.4, subject: { yaw } }),
          );
          const f = fixtureFrames(fx)[0];
          expect(classifyView(f.lm, f.aspect), `${aspect} ${profile} ${yaw}`).toBe("side");
        }
      }
    }
  });

  it("needs the aspect ratio: a 16:9 front view read without it looks turned", () => {
    const f = fixtureFrames(
      generate(spec({ test: "shoulder_abduction", aspect: "16:9", durationSec: 0.2 })),
    )[0];
    expect(classifyView(f.lm, f.aspect)).toBe("front");
    expect(classifyView(f.lm)).not.toBe("front");
  });

  it("is unknown without a person or without shoulders", () => {
    expect(classifyView(emptyPose(), 0.5625)).toBe("unknown");
    const f = fixtureFrames(generate(spec({ test: "shoulder_abduction", durationSec: 0.2 })))[0];
    const noShoulders = f.lm.map((q, i) => (i === 11 || i === 12 ? { ...q, visibility: 0.1 } : q));
    expect(viewRatio(noShoulders, f.aspect)).toBeNull();
    expect(viewOfRatio(null)).toBe("unknown");
    expect(viewOfRatio(Number.NaN)).toBe("unknown");
  });

  it("has ordered thresholds and a turn estimate for the record", () => {
    expect(VIEW_RATIO.sideMax).toBeLessThan(VIEW_RATIO.frontMin);
    expect(viewOfRatio(VIEW_RATIO.frontMin)).toBe("front");
    expect(viewOfRatio(VIEW_RATIO.sideMax)).toBe("side");
    expect(viewOfRatio((VIEW_RATIO.frontMin + VIEW_RATIO.sideMax) / 2)).toBe("oblique");
    expect(estimateTurnDeg(VIEW_RATIO.nominalFront)).toBeCloseTo(0, 6);
    expect(estimateTurnDeg(0)).toBeCloseTo(90, 6);
    expect(estimateTurnDeg(VIEW_RATIO.nominalFront * Math.cos(Math.PI / 4))).toBeCloseTo(45, 6);
  });
});

describe("QualityMonitor", () => {
  it("passes a clean arm raise, with the hips seen at calibration", () => {
    const r = gate(disk("shoulder_abduction/chair/raise-right-9x16.json"), "shoulder_abduction", "right", {
      windowFrames: 10,
    });
    expect(r.issues).toEqual([]);
    expect(r).toMatchObject({
      ok: true,
      view: "front",
      viewOk: true,
      visibleShare: 1,
      inFrameShare: 1,
      cue: null,
    });
    expect(r.windowVisibleShare).toBe(1);
    expect(r.fps).toBeCloseTo(15, 0);
    expect(r.distanceM!).toBeGreaterThan(2.2);
    expect(r.distanceM!).toBeLessThan(2.8);
    expect(r.missing).toEqual([]);
    expect(Object.keys(r.optionalVisibleShare)).toEqual(["0", "7", "8", "15", "16", "23", "24"]);
  });

  it("passes the other fixtures that should pass", () => {
    const pass: [string, TestId, TestSide, QualityOptions?][] = [
      ["shoulder_abduction/weaker_left/helper-beside-9x16.json", "shoulder_abduction", "left"],
      ["shoulder_abduction/standing/phone-shake-16x9.json", "shoulder_abduction", "right"],
      [
        "shoulder_abduction/wheelchair/raise-left-16x9.json",
        "shoulder_abduction",
        "left",
        { trunkReference: false },
      ],
      ["arm_curl_30s/chair/curl-right-9x16.json", "arm_curl_30s", "right"],
      ["chair_stand_30s/standing/stands-9x16.json", "chair_stand_30s", "none"],
    ];
    for (const [file, id, side, opts] of pass) {
      const r = gate(disk(file), id, side, opts);
      expect(r.issues, file).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it("stores hidden optional landmarks as unknown without failing the attempt", () => {
    const r = gate(disk("shoulder_abduction/wheelchair/raise-left-16x9.json"), "shoulder_abduction", "left", {
      trunkReference: false,
    });
    expect(r.ok).toBe(true);
    expect(r.optionalVisibleShare["23"]).toBe(0);
    expect(r.optionalVisibleShare["24"]).toBe(0);
  });

  it("fails the trunk reference when the hips are hidden at calibration, asking for the whole body", () => {
    const r = gate(disk("shoulder_abduction/wheelchair/raise-left-16x9.json"), "shoulder_abduction", "left", {
      windowFrames: 10,
    });
    expect(r.issues).toEqual(["not_visible"]);
    expect(r.windowVisibleShare).toBe(0);
    expect(r.missing).toEqual([23, 24]);
    expect(r.cue).toBe("check_whole_body");
  });

  it("fails a gate landmark hidden in more than 10 percent of frames, never an optional one", () => {
    const fx = disk("trunk_control_seated/wheelchair/lean-left-occluded-9x16.json");
    const r = gate(fx, "trunk_control_seated", "none");
    expect(r.issues).toEqual(["not_visible"]);
    expect(r.visibleShare).toBeLessThan(0.9);
    expect(r.missing).toEqual([11]);
    expect(r.optionalVisibleShare["0"]).toBeLessThan(0.9);
    expect(r.cue).toBe("check_whole_body");
  });

  it("asks for fitted sleeves when only an elbow is hidden on an arm test", () => {
    const fx = generate(
      spec({
        test: "shoulder_abduction",
        subject: { motions: [{ kind: "arm_raise", side: "left", peak: 120 }] },
        occlusions: [{ landmarks: [LM.l_elbow], from: 1, to: 2 }],
      }),
    );
    const r = gate(fx, "shoulder_abduction", "left");
    expect(r.issues).toEqual(["not_visible"]);
    expect(r.missing).toEqual([13]);
    expect(r.cue).toBe("check_sleeves");
    expect(gate(fx, "shoulder_abduction", "right").ok).toBe(true);
  });

  it("fails an attempt when the tested arm leaves the frame", () => {
    const fx = generate(
      spec({
        test: "shoulder_abduction",
        subject: { x: 0.8, motions: [{ kind: "arm_raise", side: "left", peak: 100 }] },
      }),
    );
    const r = gate(fx, "shoulder_abduction", "left");
    expect(r.issues).toContain("out_of_frame");
    expect(r.inFrameShare).toBeLessThan(0.9);
  });

  it("holds the fps floor of the test kind", () => {
    const curl = disk("arm_curl_30s/chair/curl-right-9x16.json");
    expect(gate(curl, "arm_curl_30s", "right").fps).toBe(20);
    const slow = gate(curl, "arm_curl_30s", "right", { every: 2 });
    expect(slow.issues).toEqual(["low_fps"]);
    expect(slow.cue).toBe("check_try_again");
    const at12 = generate(spec({ test: "trunk_control_seated", fps: 12 }));
    expect(gate(at12, "trunk_control_seated", "none").issues).toEqual([]);
    const at10 = generate(spec({ test: "trunk_control_seated", fps: 10 }));
    expect(gate(at10, "trunk_control_seated", "none").issues).toEqual(["low_fps"]);
  });

  it("rejects a view the test does not accept, with the cue to turn", () => {
    const front = generate(spec({ test: "arm_curl_30s", subject: { yaw: 0, motions: [] } }));
    const r = gate(front, "arm_curl_30s", "right");
    expect(r.issues).toContain("wrong_view");
    expect(r.view).toBe("front");
    expect(retryCue("wrong_view", "arm_curl_30s", "right")).toBe("check_right_side_to_phone");
    expect(retryCue("wrong_view", "arm_curl_30s", "left")).toBe("check_left_side_to_phone");

    const standSide = generate(spec({ test: "chair_stand_30s", fps: 20, subject: { yaw: -90 } }));
    const s = gate(standSide, "chair_stand_30s", "none");
    expect(s.view).toBe("side");
    expect(s.issues).toContain("wrong_view");
    expect(s.cue).toBe("check_phone_angle_right");

    const standFront = generate(spec({ test: "chair_stand_30s", fps: 20, subject: { yaw: 0 } }));
    expect(gate(standFront, "chair_stand_30s", "none").viewOk).toBe(true);

    const leanTurned = generate(spec({ test: "trunk_control_seated", subject: { yaw: 45 } }));
    const l = gate(leanTurned, "trunk_control_seated", "none");
    expect(l.view).toBe("oblique");
    expect(l.cue).toBe("check_face_phone");
  });

  it("checks the distance against the test's setup distance", () => {
    const near = gate(
      generate(spec({ test: "trunk_control_seated", camera: { distance: 1.3 } })),
      "trunk_control_seated",
      "none",
    );
    expect(near.issues).toContain("too_close");
    expect(near.distanceM!).toBeLessThan(1.5);
    const far = gate(
      generate(spec({ test: "trunk_control_seated", camera: { distance: 3.6 } })),
      "trunk_control_seated",
      "none",
    );
    expect(far.issues).toEqual(["too_far"]);
    expect(far.cue).toBe("check_move_closer");
    const ok = gate(
      generate(spec({ test: "trunk_control_seated", camera: { distance: 2.2 } })),
      "trunk_control_seated",
      "none",
    );
    expect(ok.issues).toEqual([]);
    expect(ok.distanceM!).toBeCloseTo(2.2, 0);
  });

  it("fails an attempt paused more than 10 percent, or touched by a second person", () => {
    const crossing = gate(
      disk("shoulder_abduction/weaker_right/helper-crossing-16x9.json"),
      "shoulder_abduction",
      "right",
    );
    expect(crossing.issues[0]).toBe("paused");
    expect(crossing.pausedShare).toBeGreaterThan(0.1);
    expect(crossing.cue).toBe("check_one_person");
    expect(retryCue("paused", "shoulder_abduction", "right")).toBe("check_one_person");

    const touch = gate(
      disk("shoulder_abduction/chair/helper-touch-9x16.json"),
      "shoulder_abduction",
      "right",
    );
    expect(touch.touched).toBe(true);
    expect(touch.issues).toEqual(["touched"]);
    expect(touch.ok).toBe(false);
  });

  it("counts paused frames exactly at the limit", () => {
    const f = fixtureFrames(disk("shoulder_abduction/chair/raise-right-9x16.json"));
    const run = (paused: number) => {
      const m = new QualityMonitor(qualityConfig(testDef("shoulder_abduction"), "right"));
      f.slice(0, 50).forEach((fr, i) => m.feedFrame(fr, { paused: i < paused }));
      return m.report();
    };
    expect(run(5).issues).not.toContain("paused");
    expect(run(6).issues).toContain("paused");
  });

  it("reports nothing measurable without frames, and resets", () => {
    const m = new QualityMonitor(qualityConfig(testDef("chair_stand_30s"), "none"));
    const empty = m.report();
    expect(empty.ok).toBe(false);
    expect(empty.issues).toEqual(["not_visible"]);
    expect(empty.view).toBe("unknown");
    fixtureFrames(disk("chair_stand_30s/standing/stands-9x16.json")).forEach((f) => m.feedFrame(f));
    expect(m.report().ok).toBe(true);
    m.reset();
    expect(m.report().frames).toBe(0);
  });
});

describe("retry messages", () => {
  const issues: QualityIssue[] = [
    "not_visible",
    "out_of_frame",
    "wrong_view",
    "too_close",
    "too_far",
    "low_fps",
    "paused",
    "touched",
  ];

  it("maps every issue of every test to one existing check cue with Arabic and English", () => {
    for (const id of TEST_IDS) {
      for (const side of ["left", "right", "none"] as const) {
        for (const issue of issues) {
          const cue = retryCue(issue, id, side);
          expect(isCheckCueId(cue)).toBe(true);
          const line = retryLine(issue, id, side);
          expect(line.id).toBe(cue);
          expect(line.ar.length).toBeGreaterThan(0);
          expect(line.en.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("uses the cue that fixes each issue", () => {
    expect(retryCue("too_close", "trunk_control_seated", "none")).toBe("check_move_back");
    expect(retryCue("too_far", "trunk_control_seated", "none")).toBe("check_move_closer");
    expect(retryCue("out_of_frame", "chair_stand_30s", "none")).toBe("check_whole_body");
    expect(retryCue("not_visible", "chair_stand_30s", "none")).toBe("check_whole_body");
    expect(retryCue("not_visible", "arm_curl_30s", "left")).toBe("check_sleeves");
    expect(retryCue("not_visible", "arm_curl_30s", "left", [11])).toBe("check_whole_body");
    expect(retryCue("wrong_view", "shoulder_abduction", "left")).toBe("check_face_phone");
    expect(retryCue("touched", "chair_stand_30s", "none")).toBe("check_one_person");
    expect(cueLine("check_one_person").en).toMatch(/no one stands between you and the phone/);
  });
});

describe("distance proxy", () => {
  it("inverts the camera model and applies the 25 percent allowance", () => {
    // A 0.5 m trunk at 2.5 m in portrait (about 79 degrees top to bottom) fills about 12 percent.
    const vTan = Math.tan((25 * Math.PI) / 180) / 0.5625;
    expect(estimateDistanceM(0.5 / (2 * 2.5 * vTan), 0.5625)).toBeCloseTo(2.5, 6);
    expect(estimateDistanceM(0.5 / (2 * 2.5 * Math.tan((25 * Math.PI) / 180)), 16 / 9)).toBeCloseTo(2.5, 6);
    expect(distanceIssue(null, [2, 3])).toBeNull();
    expect(distanceIssue(1.5, [2, 3])).toBeNull();
    expect(distanceIssue(1.49, [2, 3])).toBe("too_close");
    expect(distanceIssue(3.75, [2, 3])).toBeNull();
    expect(distanceIssue(3.76, [2, 3])).toBe("too_far");
    // Never beyond the model's 4 m scope.
    expect(distanceIssue(4.1, [3, 3.5])).toBe("too_far");
  });
});

describe("setupCheck", () => {
  const frames = (s: GenSpec, n = 15): SetupFrame[] =>
    fixtureFrames(generate({ ...s, durationSec: Math.max(1, n / s.fps) }))
      .slice(0, n)
      .map((f) => ({ t: f.t, poses: f.poses!, aspect: f.aspect }));
  const check = (s: GenSpec, test: TestId, side: TestSide, opts?: SetupOptions) =>
    setupCheck(frames(s), setupConfig(testDef(test), side), opts);

  it("passes a good setup for each test", () => {
    const good: [GenSpec, TestId, TestSide][] = [
      [spec({ test: "shoulder_abduction" }), "shoulder_abduction", "left"],
      [
        spec({ test: "shoulder_abduction", profile: "wheelchair", aspect: "16:9" }),
        "shoulder_abduction",
        "right",
      ],
      [
        spec({ test: "arm_curl_30s", subject: { motions: [{ kind: "curl", side: "left", reps: 1 }] } }),
        "arm_curl_30s",
        "left",
      ],
      [spec({ test: "trunk_control_seated", profile: "wheelchair" }), "trunk_control_seated", "none"],
      [spec({ test: "chair_stand_30s", profile: "standing" }), "chair_stand_30s", "none"],
      [spec({ test: "chair_stand_30s", profile: "weaker_right", aspect: "16:9" }), "chair_stand_30s", "none"],
    ];
    for (const [s, id, side] of good) {
      const r = check(s, id, side, { tilt: { rollDeg: 1, pitchDeg: -2 } });
      expect(r.issues, `${id} ${s.profile} ${s.aspect}`).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.cue).toBeNull();
      expect(r.light!).toBeGreaterThan(0.9);
    }
  });

  it("needs the phone level within 5 degrees when the device reports it, and skips it otherwise", () => {
    const s = spec({ test: "shoulder_abduction" });
    expect(check(s, "shoulder_abduction", "left", { tilt: { rollDeg: 6, pitchDeg: 0 } })).toMatchObject({
      ok: false,
      issues: ["tilt"],
      cue: "check_phone_level",
    });
    expect(check(s, "shoulder_abduction", "left", { tilt: { rollDeg: 0, pitchDeg: -5.5 } }).issues).toEqual([
      "tilt",
    ]);
    expect(check(s, "shoulder_abduction", "left", { tilt: { rollDeg: 4.9, pitchDeg: 4.9 } }).ok).toBe(true);
    expect(check(s, "shoulder_abduction", "left", { tilt: null }).ok).toBe(true);
  });

  it("warns above 3 degrees for the side lean without blocking", () => {
    const r = check(spec({ test: "trunk_control_seated" }), "trunk_control_seated", "none", {
      tilt: { rollDeg: 4, pitchDeg: 0 },
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual(["tilt"]);
    expect(
      check(spec({ test: "shoulder_abduction" }), "shoulder_abduction", "left", {
        tilt: { rollDeg: 4, pitchDeg: 0 },
      }).warnings,
    ).toEqual([]);
  });

  it("needs a person, and one person in the chair: a helper at the side is fine", () => {
    const empty = setupCheck(
      [0, 100, 200].map((t) => ({ t, poses: [], aspect: 0.5625 })),
      setupConfig(testDef("shoulder_abduction"), "left"),
    );
    expect(empty).toMatchObject({ ok: false, issues: ["no_person"], cue: "check_whole_body" });
    expect(setupCheck([], setupConfig(testDef("shoulder_abduction"), "left")).issues).toEqual(["no_person"]);

    const side = check(
      spec({ test: "trunk_control_seated", helper: { x: -0.6, z: -0.2, yaw: 20 } }),
      "trunk_control_seated",
      "none",
    );
    expect(side.issues).toEqual([]);

    const between = check(
      spec({ test: "trunk_control_seated", helper: { x: 0.3, z: 0.6 } }),
      "trunk_control_seated",
      "none",
    );
    expect(between.issues).toEqual(["second_person"]);
    expect(between.cue).toBe("check_one_person");
    // A helper who hides the person completely is the only pose the model returns: the check
    // cannot tell, but the distance proxy still stops the setup.
    const hidden = check(
      spec({ test: "trunk_control_seated", helper: { x: 0.1, z: 0.8 } }),
      "trunk_control_seated",
      "none",
    );
    expect(hidden.ok).toBe(false);
  });

  it("needs room for both arms out to the side before the arm raise", () => {
    const r = check(spec({ test: "shoulder_abduction", subject: { x: 0.35 } }), "shoulder_abduction", "left");
    expect(r.issues).toContain("arm_room");
    expect(r.cue).toBe("check_move_back");
    const trunk = check(
      spec({ test: "trunk_control_seated", subject: { x: 0.35 } }),
      "trunk_control_seated",
      "none",
    );
    expect(trunk.issues).not.toContain("arm_room");
  });

  it("needs the framing of each test: the feet for the chair stand", () => {
    const cut = check(
      spec({
        test: "chair_stand_30s",
        profile: "standing",
        aspect: "16:9",
        camera: { distance: 2, height: 1.2 },
      }),
      "chair_stand_30s",
      "none",
    );
    expect(cut.issues).toContain("framing");
    expect(cut.cue).toBe("check_whole_body");
  });

  it("checks the distance, the view and the light", () => {
    const far = check(
      spec({ test: "trunk_control_seated", camera: { distance: 3.4 } }),
      "trunk_control_seated",
      "none",
    );
    expect(far.issues).toEqual(["too_far"]);
    expect(far.cue).toBe("check_move_closer");
    const turned = check(
      spec({ test: "chair_stand_30s", profile: "standing", subject: { yaw: -90 } }),
      "chair_stand_30s",
      "none",
    );
    expect(turned.view).toBe("side");
    expect(turned.issues).toContain("wrong_view");
    expect(turned.cue).toBe("check_phone_angle_right");
    const dim = check(spec({ test: "trunk_control_seated", light: 0.6 }), "trunk_control_seated", "none");
    expect(dim.issues).toEqual(["light"]);
    expect(dim.cue).toBe("check_light");
  });
});

describe("phoneTilt", () => {
  it("reads roll and pitch from device orientation angles", () => {
    const upright = phoneTilt(90, 0);
    expect(upright.rollDeg).toBeCloseTo(0, 6);
    expect(upright.pitchDeg).toBeCloseTo(0, 6);
    const rolled = phoneTilt(85, -90);
    expect(Math.abs(rolled.rollDeg)).toBeCloseTo(5, 6);
    expect(rolled.pitchDeg).toBeCloseTo(0, 6);
    expect(phoneTilt(80, 0).pitchDeg).toBeCloseTo(10, 6);
    expect(phoneTilt(0, 0).pitchDeg).toBeCloseTo(90, 6);
  });

  it("takes the screen orientation into account in landscape", () => {
    const level = phoneTilt(0, -90, 90);
    expect(level.rollDeg).toBeCloseTo(0, 6);
    expect(level.pitchDeg).toBeCloseTo(0, 6);
    expect(Math.abs(phoneTilt(90, 0, 90).rollDeg)).toBeCloseTo(90, 6);
  });
});
