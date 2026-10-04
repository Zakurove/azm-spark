/**
 * Step G1 (product v7 contract 8.4): the smoke harness's report (e2e/v7-smoke-report.ts): which videos
 * it runs, the pass bar of the gate (range within 10 degrees of the goniometer for a measure class
 * movement, a caution class one reported; gait cadence within 5 percent and at least 6 cycles; zero
 * crashes; the frame rate recorded) and the summary written to local-docs/qa/v7/smoke-<date>.md.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { evaluate, findVideos, summaryMarkdown, type RunRecord } from "../../e2e/v7-smoke-report";
import type { SmokeResult } from "../../src/features/smoke/run";
import type { GaitTruth, RomTruth } from "../../scripts/smoke/scenarios.mjs";
import { wordingProblems } from "../../scripts/wording-rules.mjs";

const romTruth = {
  id: "rom-shoulder-abduction-right",
  kind: "rom",
  movement: "shoulder_abduction",
  side: "right",
  position: "seated",
  view: "front",
  startDeg: 8,
  endDeg: 135,
  projected: { startDeg: 8.2, endDeg: 134.6 },
} as unknown as RomTruth;

const gaitTruth = {
  id: "gait-pad-side",
  kind: "gait",
  view: "pad_side",
  cadenceSpm: 100,
  strides: { left: 24, right: 25 },
} as unknown as GaitTruth;

const base = {
  version: 1,
  status: "done",
  startedAt: "2026-10-04T18:00:00.000Z",
  seconds: 40,
  camera: { width: 540, height: 960, frames: 900, fps: 29.9 },
  model: { requested: "full", used: "full", probe: null },
  gpu: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4)",
  perf: {
    poseFps: 29.9,
    modelMs: { n: 900, p50: 12, p95: 18, max: 30 },
    frameMs: { n: 1, p50: 16.7, p95: 17, max: 17 },
    longTasks: { count: 0, maxMs: null },
    measures: {},
    heapMB: 80,
    heapGrowthMB: 4,
  },
  budgets: { romFps: 15, gaitFps: 25 },
};

const romResult = (runner: unknown, holdDeg = 133.4): SmokeResult =>
  ({
    ...base,
    name: "rom-shoulder-abduction-right",
    spec: { kind: "rom", model: "full" },
    rom: { runner, trace: { holdDeg, startDeg: 8.5, calibrated: true, seenShare: 1, series: [] } },
  }) as unknown as SmokeResult;

const gaitResult = (engine: unknown, harness = 99.6): SmokeResult =>
  ({
    ...base,
    name: "gait-pad-side",
    spec: { kind: "gait", model: "full" },
    camera: { ...base.camera, width: 960, height: 540 },
    gait: {
      engine,
      harness: { cadenceSpm: harness, strideS: 1.205, signal: "ankle_x", strength: 0.92 },
      tracking: { ankles: 0.99, heels: 0.98, toes: 0.97 },
      capture: { frames: 1056, subjectFrames: 1056, standingFrames: 90, walkFrames: 900, walkFps: 30 },
    },
  }) as unknown as SmokeResult;

const record = (truth: RomTruth | GaitTruth, result: SmokeResult, model = "full"): RunRecord => ({
  id: truth.id,
  model,
  truth,
  result,
  pageErrors: [],
  file: `${truth.id}-${model}.json`,
});

const verdict = (r: RunRecord, check: string) => evaluate(r).find((v) => v.check === check);

describe("evaluate", () => {
  it("passes a measure class movement within 10 degrees of the goniometer, fails one further", () => {
    const near = record(romTruth, romResult({ status: "done", result: { status: "measured", value: 128 } }));
    expect(verdict(near, "range")).toMatchObject({ ok: true, value: "128 (truth 135, 7)" });
    const far = record(romTruth, romResult({ status: "done", result: { status: "measured", value: 120 } }));
    expect(verdict(far, "range")?.ok).toBe(false);
    const none = record(
      romTruth,
      romResult({ status: "done", result: { status: "not_measured", value: null } }),
    );
    expect(verdict(none, "range")?.ok).toBe(false);
  });

  it("reports a caution class movement without a bar", () => {
    const caution = { ...romTruth, movement: "hip_abduction" } as RomTruth;
    const r = record(caution, romResult({ status: "done", result: { status: "measured", value: 30 } }));
    expect(verdict(r, "range")).toMatchObject({ ok: null });
    expect(verdict(r, "range")?.bar).toContain("caution");
  });

  it("marks a runner that is not built as not run, and keeps the page's own reading", () => {
    const r = record(
      romTruth,
      romResult({ status: "not_built", error: "RomRunner is not built yet (stream B)" }),
    );
    expect(verdict(r, "range")).toMatchObject({ ok: null, value: "not built (B)" });
    expect(verdict(r, "page reading")).toMatchObject({ ok: true, value: "133.4 (truth 135, 1.6)" });
    expect(verdict(r, "crash free")).toMatchObject({ ok: true });
    expect(verdict(r, "frame rate")).toMatchObject({ ok: true, value: "29.9 fps" });
  });

  it("checks the gait engine's cadence within 5 percent and 6 clean cycles a side", () => {
    const good = record(
      gaitTruth,
      gaitResult({
        status: "done",
        analyseMs: 80,
        result: { metrics: { cadence: { value: 102 } }, quality: { cleanCycles: { left: 20, right: 21 } } },
      }),
    );
    expect(verdict(good, "cadence")).toMatchObject({ ok: true, value: "102 (truth 100, 2.0%)" });
    expect(verdict(good, "cycles")).toMatchObject({ ok: true, value: "left 20, right 21" });
    const bad = record(
      gaitTruth,
      gaitResult({
        status: "done",
        analyseMs: 80,
        result: { metrics: { cadence: { value: 110 } }, quality: { cleanCycles: { left: 5, right: 21 } } },
      }),
    );
    expect(verdict(bad, "cadence")?.ok).toBe(false);
    expect(verdict(bad, "cycles")?.ok).toBe(false);
    const notBuilt = record(
      gaitTruth,
      gaitResult({ status: "not_built", error: "not built yet (stream C)" }),
    );
    expect(verdict(notBuilt, "cadence")).toMatchObject({ ok: null, value: "not built (C)" });
    expect(verdict(notBuilt, "tracking cadence")).toMatchObject({
      ok: true,
      value: "99.6 (truth 100, 0.4%)",
    });
  });

  it("fails a run that crashed or never got a frame", () => {
    const crashed = record(romTruth, {
      ...romResult({ status: "not_built", error: "x" }),
      status: "error",
      error: "camera denied",
    } as SmokeResult);
    expect(verdict(crashed, "crash free")).toMatchObject({ ok: false, value: "camera denied" });
    const pageError = {
      ...record(romTruth, romResult({ status: "not_built", error: "x" })),
      pageErrors: ["TypeError: x"],
    };
    expect(verdict(pageError, "crash free")?.ok).toBe(false);
    const noFrames = record(romTruth, {
      ...romResult({ status: "not_built", error: "x" }),
      camera: { ...base.camera, frames: 0, fps: null },
    } as SmokeResult);
    expect(verdict(noFrames, "frame rate")?.ok).toBe(false);
  });
});

describe("summaryMarkdown", () => {
  it("writes the gate table, each run, and Lite against Full", () => {
    const runs = [
      record(romTruth, romResult({ status: "not_built", error: "RomRunner is not built yet (stream B)" })),
      record(
        romTruth,
        romResult({ status: "not_built", error: "RomRunner is not built yet (stream B)" }, 131.2),
        "lite",
      ),
      record(
        gaitTruth,
        gaitResult({ status: "not_built", error: "The gait analysis is not built yet (stream C)" }),
      ),
      record(
        gaitTruth,
        gaitResult({ status: "not_built", error: "The gait analysis is not built yet (stream C)" }, 98.8),
        "lite",
      ),
    ];
    const md = summaryMarkdown(runs, {
      date: "2026-10-04",
      commit: "abc1234",
      browser: "Chromium 143",
      machine: "darwin arm64",
      videos: "/videos",
      results: "/results/smoke-2026-10-04",
    });
    expect(md).toMatch(/^# v7 real model smoke, 2026-10-04/);
    expect(md).toContain("| rom-shoulder-abduction-right | Full |");
    expect(md).toContain("| gait-pad-side | Lite |");
    expect(md).toContain("## Lite against Full");
    expect(md).toContain("not built (B)");
    expect(md).toContain("abc1234");
    // Prose follows the copy rules: no dash characters.
    expect(wordingProblems(md.replace(/[`|#*]/g, " ")).filter((p) => p === "dash character")).toEqual([]);
  });
});

describe("findVideos", () => {
  const dir = mkdtempSync(join(tmpdir(), "azm-g1-videos-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("takes every truth sidecar with a video beside it, the Y4M file first", () => {
    writeFileSync(join(dir, "a.truth.json"), JSON.stringify({ id: "a", kind: "rom" }));
    writeFileSync(join(dir, "a.mp4"), "");
    writeFileSync(join(dir, "b.truth.json"), JSON.stringify({ id: "b", kind: "gait" }));
    writeFileSync(join(dir, "b.mp4"), "");
    writeFileSync(join(dir, "b.y4m"), "");
    writeFileSync(join(dir, "c.truth.json"), JSON.stringify({ id: "c", kind: "gait" }));
    const found = findVideos(dir);
    expect(found.map((v) => [v.id, v.video.split("/").pop()])).toEqual([
      ["a", "a.mp4"],
      ["b", "b.y4m"],
    ]);
    expect(found[0].truth).toMatchObject({ id: "a", kind: "rom" });
  });
});
