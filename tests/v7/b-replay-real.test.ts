/**
 * The real model's landmarks of the seated home videos (D-034 item 1), replayed through the runner as
 * the smoke page drives it (tests/v7/b-replay.ts). Each file is one real model smoke run of a rendered
 * video (scripts/smoke/render.mjs: the procedural humanoid, no person), every pose of every frame kept
 * with frames=1 and rounded to 0.001 (tests/fixtures/rom/real/*.json.gz). Before D-034 the arm raise
 * to the side failed every attempt as too close, and the Lite run below paused 84 to 94 percent of its
 * frames on the guessed hips; the bar is contract 8.4's: within 10 degrees of the goniometer.
 */
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SubjectLock, SUBJECT_RULES } from "../../src/engine/subject";
import { replay, replayFrames, type ReplayInput } from "./b-replay";

const DIR = join(__dirname, "../fixtures/rom/real");

interface RealRun extends ReplayInput {
  name: string;
  note: string;
  truthDeg: number;
  projectedDeg: number;
}

const load = (file: string): RealRun =>
  JSON.parse(gunzipSync(readFileSync(join(DIR, file))).toString("utf8"));

/** Contract 8.4: within 10 degrees of the goniometer. */
const BAR_DEG = 10;

describe("the real model on the seated home videos, replayed (D-034 item 1)", () => {
  it("has the six measured runs and the lock run", () => {
    expect(readdirSync(DIR).sort()).toEqual([
      "elbow-flexion-1.3m-full.json.gz",
      "elbow-flexion-jitter-1.3m-full.json.gz",
      "lock-hips-guessed-lite.json.gz",
      "shoulder-abduction-1.45m-full.json.gz",
      "shoulder-flexion-1.3m-full.json.gz",
      "shoulder-flexion-1.5m-full.json.gz",
      "shoulder-flexion-drift-1.5m-full.json.gz",
    ]);
  });

  for (const file of [
    "shoulder-abduction-1.45m-full.json.gz",
    "shoulder-flexion-1.3m-full.json.gz",
    "shoulder-flexion-1.5m-full.json.gz",
    "elbow-flexion-1.3m-full.json.gz",
    // D-035: a person never perfectly still, the arm raise drifting out to the side.
    "elbow-flexion-jitter-1.3m-full.json.gz",
    "shoulder-flexion-drift-1.5m-full.json.gz",
  ])
    it(`${file}: measured within the 8.4 bar, nothing repeated`, () => {
      const run = load(file);
      const report = replay(run);
      const r = report.result!;
      expect({
        status: r.status,
        reason: r.reason,
        issues: r.quality.issues,
        retries: r.quality.retries,
      }).toEqual({ status: "measured", reason: null, issues: [], retries: 0 });
      // D-035: one valid attempt records the value.
      expect(r.nValid).toBe(1);
      expect(Math.abs(r.value! - run.truthDeg), `${r.value} for ${run.truthDeg}`).toBeLessThanOrEqual(
        BAR_DEG,
      );
      expect(r.quality.maxPausedShare).toBeLessThan(SUBJECT_RULES.maxPausedShare);
    });

  for (const file of [
    "shoulder-abduction-1.45m-full.json.gz",
    "shoulder-flexion-1.3m-full.json.gz",
    "shoulder-flexion-1.5m-full.json.gz",
    "elbow-flexion-1.3m-full.json.gz",
    // D-035: a person never perfectly still, the arm raise drifting out to the side.
    "elbow-flexion-jitter-1.3m-full.json.gz",
    "shoulder-flexion-drift-1.5m-full.json.gz",
  ])
    it(`${file}: nobody answering the maximum question, still measured (D-035)`, () => {
      const run = load(file);
      // No answer ever comes: the question's timeout is the answer.
      const report = replay(run, 1e9);
      const r = report.result!;
      const file2 = process.env.AZM_MVP_REPORT;
      if (file2)
        appendFileSync(
          file2,
          JSON.stringify({
            name: `replay ${file}, no answer`,
            truth: run.truthDeg,
            status: r.status,
            reason: r.reason,
            value: r.value,
            nValid: r.nValid,
            repeats: report.attempts
              .filter((a) => a.outcome === "retry" || a.outcome === "invalid")
              .map((a) => a.reasons.join("+")),
            answers: r.attempts.map((a) => `${a.answer}/${a.answerSource}`),
          }) + "\n",
        );
      expect({ status: r.status, reason: r.reason }).toEqual({ status: "measured", reason: null });
      expect(r.attempts.map((a) => [a.answer, a.answerSource])).toEqual([["yes", "timeout"]]);
      expect(Math.abs(r.value! - run.truthDeg), `${r.value} for ${run.truthDeg}`).toBeLessThanOrEqual(
        BAR_DEG,
      );
    });

  it("the guessed hips swing with the arm: v1's hip anchor pauses most of the run, the body anchor does not", () => {
    const run = load("lock-hips-guessed-lite.json.gz");
    const frames = replayFrames(run);
    const paused = (lock: SubjectLock) => {
      lock.lock(frames.find((f) => f.poses!.length)!.poses!, run.aspect);
      const reasons: Record<string, number> = {};
      for (const f of frames) {
        const p = lock.pickFrame(f);
        if (p.paused) reasons[p.reason!] = (reasons[p.reason!] ?? 0) + 1;
      }
      return { share: lock.pausedShare, reasons };
    };
    const v1 = paused(new SubjectLock());
    // Over half the run before D-037 item 4; since then the lock is released after 2 s unseen and
    // taken again on the person in the picture, so the hip anchor pauses in 2 s runs.
    expect(v1.share).toBeGreaterThan(0.15);
    expect(v1.reasons.jump).toBeGreaterThan(0);
    const body = paused(new SubjectLock(SUBJECT_RULES, { anchor: "body" }));
    // Only the frames where the model found nobody.
    expect(Object.keys(body.reasons)).toEqual(["lost"]);
    expect(body.share).toBeLessThan(0.01);
    // Through the runner: holds found, never paused or out of the picture for the hips.
    const report = replay(run);
    expect(report.holds.length).toBeGreaterThan(0);
    expect(report.result!.quality.issues).not.toContain("paused");
    expect(report.result!.quality.issues).not.toContain("out_of_frame");
  });
});
