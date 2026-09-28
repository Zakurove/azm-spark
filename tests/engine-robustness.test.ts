/**
 * The engine on a real phone's camera: frame gaps and stalls, jittered and dropped frames at 12 to
 * 60 fps, a landmark the model returns as NaN, a mirrored camera with the tested arm hidden, a
 * phone that moves after calibration, a subject lock shared by two runners, and a helper whose
 * hand hovers close beside the shoulder (review round 2 of the engine, spec 4.0 to 4.4).
 */
import { describe, expect, it } from "vitest";
import { type SideResult } from "../src/engine/modes";
import type { Profile } from "./fixtures/gen";
import {
  CROSSED,
  curlPractice,
  curlTrial,
  standPractice,
  standTrial,
  twoPass,
  type TwoPass,
} from "./fixtures/timed";

type Side = "left" | "right";
const res = (c: { run: { result: { results: SideResult[] } } }) => c.run.result.results[0];

function curlCase(seed: number, over: Partial<TwoPass> = {}, side: Side = "right") {
  return twoPass({
    test: "arm_curl_30s",
    profile: "chair",
    aspect: "9:16",
    seed,
    side,
    practice: curlPractice(side),
    trial: (go) => curlTrial(side, go, seed),
    opts: { variant: "arm_only" },
    ...over,
  });
}

function standCase(seed: number, over: Partial<TwoPass> = {}, profile: Profile = "standing") {
  return twoPass({
    test: "chair_stand_30s",
    profile,
    aspect: "9:16",
    seed,
    practice: standPractice(),
    trial: (go) => standTrial(go, seed),
    extra: { subject: { arms: CROSSED } },
    ...over,
  });
}

/** The go time of a case's practice pass (seconds), to place edits in the trial. */
const goOf = (c: Omit<TwoPass, "trial"> & { trial?: TwoPass["trial"] }) =>
  twoPass({ trial: () => [], ...c } as TwoPass).goSec;

/* ---------------------------------------------------- time without frames */

describe("time without frames in a timed trial is unscored (spec 4.2 occlusion)", () => {
  for (const seed of [600, 601, 602]) {
    it(`an 8 s camera stall in an arm curl fails the quality gate, seed ${seed}`, () => {
      const base = { test: "arm_curl_30s", profile: "chair", aspect: "9:16", seed, side: "right" } as const;
      const go = goOf({ ...base, practice: curlPractice("right"), opts: { variant: "arm_only" } });
      const k = curlCase(seed, { extra: { timing: { stalls: [{ from: go + 10, to: go + 18 }] } } });
      // The trial is never stored as a measured count: it is repeated or not measured.
      const trial = [...res(k).retried, ...res(k).attempts][0];
      expect(trial.outcome).toBe("retry");
      expect(trial.reasons).toEqual(["unscored"]);
      expect(trial.detail.unscoredShare).toBeGreaterThan(0.2);
      expect(k.run.asks).toContain("repeat");
    });
  }

  it("an 8 s stall in a chair stand fails the quality gate", () => {
    const seed = 710;
    const base = { test: "chair_stand_30s", profile: "standing", aspect: "9:16", seed } as const;
    const go = goOf({ ...base, practice: standPractice(), extra: { subject: { arms: CROSSED } } });
    const k = standCase(seed, {
      extra: { subject: { arms: CROSSED }, timing: { stalls: [{ from: go + 10, to: go + 18 }] } },
    });
    const trial = [...res(k).retried, ...res(k).attempts][0];
    expect(trial.outcome).toBe("retry");
    expect(trial.detail.unscoredShare).toBeGreaterThan(0.2);
  });

  it("a short stall under the limit keeps the trial and counts its time as unscored", () => {
    const seed = 603;
    const base = { test: "arm_curl_30s", profile: "chair", aspect: "9:16", seed, side: "right" } as const;
    const go = goOf({ ...base, practice: curlPractice("right"), opts: { variant: "arm_only" } });
    const k = curlCase(seed, { extra: { timing: { stalls: [{ from: go + 10, to: go + 12 }] } } });
    const r = res(k);
    expect(r.status).toBe("measured");
    // About 2 s of 30 s.
    expect(r.detail.unscoredShare).toBeGreaterThan(0.05);
    expect(r.detail.unscoredShare).toBeLessThan(0.1);
  });
});
