/**
 * Dev only: replays every real model smoke run of a folder through the current RomRunner
 * (tests/v7/b-replay.ts), on demand, never in CI:
 *
 *   AZM_REPLAY_DIR=<smoke results folder with frames=1 runs> \
 *   AZM_REPLAY_TRUTH_DIR=<the videos folder with <id>.truth.json> \
 *   AZM_REPLAY_OUT=<file for one JSON line per run> npx vitest run tests/v7/b-replay-dev.test.ts
 */
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { replay, type ReplayInput } from "./b-replay";

const DIR = process.env.AZM_REPLAY_DIR;
const TRUTH = process.env.AZM_REPLAY_TRUTH_DIR;
const OUT = process.env.AZM_REPLAY_OUT;

describe.skipIf(!DIR)("real model smoke runs, replayed off line", () => {
  const files = DIR && existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".json")) : [];
  for (const f of files)
    it(f, () => {
      const run = JSON.parse(readFileSync(join(DIR!, f), "utf8"));
      const res = run.result;
      if (!res.rom || !res.landmarks?.poses) return;
      const input: ReplayInput = {
        movement: res.spec.movement,
        side: res.spec.side,
        position: res.spec.position,
        model: res.model.used,
        aspect: res.landmarks.aspect ?? (res.camera.width ?? 1) / (res.camera.height ?? 1),
        poses: res.landmarks.poses,
      };
      const report = replay(input);
      const id = f.replace(/-(full|lite|auto)\.json$/, "");
      const truthFile = TRUTH ? join(TRUTH, `${id}.truth.json`) : null;
      const truth = truthFile && existsSync(truthFile) ? JSON.parse(readFileSync(truthFile, "utf8")) : null;
      const r = report.result;
      const line = {
        run: f,
        truth: truth?.endDeg ?? null,
        status: r?.status,
        reason: r?.reason,
        value: r?.value,
        diff: r?.value != null && truth ? Math.round((r.value - truth.endDeg) * 10) / 10 : null,
        nValid: r?.nValid,
        issues: r?.quality.issues,
        retries: r?.quality.retries,
        holds: report.holds.map((h) => h.deg),
        attempts: report.attempts.map((a) => `${a.index}:${a.outcome}:${a.value}:${a.reasons.join("+")}`),
        cues: report.cues,
        flags: r?.flags,
        paused: r?.quality.maxPausedShare,
      };
      if (OUT) appendFileSync(OUT, JSON.stringify(line) + "\n");
      expect(report.status).not.toBe("error");
    });
});
