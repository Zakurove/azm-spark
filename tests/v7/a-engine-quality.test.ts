/**
 * Step A6 (product v7 contract 7, D-024 item 5, Gate A review 2 item 2): the quality gate takes a
 * config without a v1 test. `QualityConfig.testId` and `SetupConfig.testId` are `TestId | null`; with
 * null the attempt report and the setup result give every issue as before and no cue (v7 maps
 * `issues[0]` to its own line). With a v1 test nothing changes: the v1 tests in
 * tests/quality-gate.test.ts hold as written, and the cases here compare a null config with the same
 * config under its v1 test, frame for frame.
 */
import { describe, expect, it } from "vitest";
import { fixtureFrames } from "../fixtures/format";
import { generate, type GenSpec } from "../fixtures/gen";
import {
  QUALITY_RULES,
  QualityMonitor,
  qualityConfig,
  setupCheck,
  setupConfig,
  type QualityConfig,
  type SetupConfig,
  type SetupFrame,
} from "../../src/engine/quality";
import { posesOf, SubjectLock } from "../../src/engine/subject";
import { LM } from "../../src/engine/types";
import { testDef } from "../../src/movements/assessments";
import type { TestId } from "../../src/movements/types";

const spec = (s: Partial<GenSpec> & Pick<GenSpec, "test">): GenSpec => ({
  profile: "chair",
  aspect: "9:16",
  fps: 15,
  durationSec: 3,
  seed: 61,
  ...s,
});

/** A range of motion style config (knee, side view) with no v1 test: the shape B's romQualityConfig builds. */
const kneeConfig = (over: Partial<QualityConfig> = {}): QualityConfig => ({
  testId: null,
  side: "right",
  gate: [LM.r_hip, LM.r_knee, LM.r_ankle],
  windowGate: [],
  optional: [],
  minVisibility: 0.6,
  views: ["side"],
  minFps: 12,
  distanceM: [2, 3],
  minVisibleShare: QUALITY_RULES.minVisibleShare,
  minInFrameShare: QUALITY_RULES.minInFrameShare,
  margin: QUALITY_RULES.margin,
  maxPausedShare: QUALITY_RULES.maxPausedShare,
  ...over,
});

function feed(config: QualityConfig, g: GenSpec, every = 1) {
  const frames = fixtureFrames(generate(g)).filter((_, i) => i % every === 0);
  const lock = new SubjectLock();
  lock.lock(posesOf(frames[0]), frames[0].aspect);
  const monitor = new QualityMonitor(config);
  for (const f of frames) monitor.feedPick(f, lock.pickFrame(f));
  return monitor.report();
}

/** The report without its cue, to compare a null config with the same config under a v1 test. */
const withoutCue = ({ cue: _cue, ...rest }: ReturnType<QualityMonitor["report"]>) => rest;

describe("QualityMonitor with no v1 test (testId null)", () => {
  it("reports every issue as the v1 config does, with no cue", () => {
    const cases: [TestId, "left" | "right" | "none", GenSpec, number][] = [
      // A front view for a side view test: wrong_view.
      ["arm_curl_30s", "right", spec({ test: "arm_curl_30s", fps: 30, subject: { yaw: 0 } }), 1],
      // Every third frame: low_fps (5 fps against the floor of 12 or 20).
      ["shoulder_abduction", "right", spec({ test: "shoulder_abduction" }), 3],
      ["chair_stand_30s", "none", spec({ test: "chair_stand_30s", profile: "standing" }), 3],
      ["trunk_control_seated", "none", spec({ test: "trunk_control_seated" }), 3],
    ];
    for (const [id, side, g, every] of cases) {
      const v1 = qualityConfig(testDef(id), side);
      const a = feed(v1, g, every);
      const b = feed({ ...v1, testId: null }, g, every);
      expect(a.issues.length, id).toBeGreaterThan(0);
      expect(a.cue, id).not.toBeNull();
      expect(withoutCue(b), id).toEqual(withoutCue(a));
      expect(b.cue, id).toBeNull();
    }
  });

  it("gives no cue for an attempt the camera never saw, and passes a clean one", () => {
    const monitor = new QualityMonitor(kneeConfig());
    for (let i = 0; i < 30; i++) monitor.feed({ t: (i * 1000) / 15, lm: null, aspect: 9 / 16 });
    const r = monitor.report();
    expect(r.ok).toBe(false);
    expect(r.issues).toContain("not_visible");
    expect(r.cue).toBeNull();
    // A clean front attempt under a front config with no v1 test is ok, as with one.
    const clean = feed(
      kneeConfig({ views: ["front"], gate: [LM.l_shoulder, LM.r_shoulder], distanceM: [0.5, 4] }),
      spec({ test: "shoulder_abduction" }),
    );
    expect(clean.issues).toEqual([]);
    expect(clean.ok).toBe(true);
    expect(clean.cue).toBeNull();
  });

  it("keeps the v1 cue of every v1 test (testId set)", () => {
    const r = feed(
      qualityConfig(testDef("arm_curl_30s"), "right"),
      spec({ test: "arm_curl_30s", fps: 30, subject: { yaw: 0 } }),
    );
    expect(r.issues).toEqual(["wrong_view"]);
    expect(r.cue).toBe("check_right_side_to_phone");
  });
});

describe("setupCheck with no v1 test (testId null)", () => {
  const frames = (g: GenSpec): SetupFrame[] =>
    fixtureFrames(generate(g)).map((f) => ({ t: f.t, poses: posesOf(f), aspect: f.aspect }));

  it("finds the same issues as the v1 config, with no cue", () => {
    const cases: [TestId, "left" | "right" | "none", GenSpec][] = [
      ["arm_curl_30s", "left", spec({ test: "arm_curl_30s" })],
      ["chair_stand_30s", "none", spec({ test: "chair_stand_30s", profile: "standing" })],
    ];
    for (const [id, side, g] of cases) {
      const v1: SetupConfig = setupConfig(testDef(id), side);
      const a = setupCheck(frames(g), v1, { tilt: { rollDeg: 9, pitchDeg: 0 } });
      const b = setupCheck(frames(g), { ...v1, testId: null }, { tilt: { rollDeg: 9, pitchDeg: 0 } });
      expect(a.issues.length, id).toBeGreaterThan(0);
      expect(a.cue, id).not.toBeNull();
      expect({ ...b, cue: a.cue }, id).toEqual(a);
      expect(b.cue, id).toBeNull();
    }
  });

  it("gives no cue for an empty room", () => {
    const cfg: SetupConfig = { ...setupConfig(testDef("shoulder_abduction"), "right"), testId: null };
    const r = setupCheck([{ t: 0, poses: [] }], cfg);
    expect(r.issues).toEqual(["no_person"]);
    expect(r.cue).toBeNull();
    expect(setupCheck([{ t: 0, poses: [] }], { ...cfg, testId: "shoulder_abduction" }).cue).toBe(
      "check_whole_body",
    );
  });
});
