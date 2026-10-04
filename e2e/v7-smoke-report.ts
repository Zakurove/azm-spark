/**
 * The report of the real model smoke harness (product v7 contract 8.4, stream G, step G1), used by
 * e2e/v7-model-smoke.spec.ts. Pure Node.
 *
 *   findVideos       the runs: every <id>.truth.json in the videos folder with a video beside it
 *                    (<id>.y4m first, else .mp4, .mov, .webm or .mkv, converted for the run)
 *   evaluate         the pass bar of the gate (8.4): a measure class movement within 10 degrees of the
 *                    goniometer (the truth's endDeg), a caution class one reported; the gait engine's
 *                    cadence within 5 percent and at least 6 clean cycles a side (gait data
 *                    capture.minimumCycles); zero crashes; the frame rate recorded. The page's own
 *                    readings (the angle trace, the tracking cadence) are shown beside them on the same
 *                    bars, as diagnostics of the model and the video, not as the gate.
 *   summaryMarkdown  local-docs/qa/v7/smoke-<date>.md
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import rom from "../src/movements/rom/rom-v7.json" with { type: "json" };
import gait from "../src/movements/gait/gait-v7.json" with { type: "json" };
import type { SmokeResult } from "../src/features/smoke/run";
import type { GaitTruth, RomTruth, Truth } from "../scripts/smoke/scenarios.mjs";

/** Range: within this many degrees of the goniometer (8.4). */
export const RANGE_BAR_DEG = 10;
/** Gait: cadence within this share of the truth (8.4). */
export const CADENCE_BAR = 0.05;
/** Gait: clean cycles a side (8.4 "at least 6 cycles"; gait data capture.minimumCycles). */
export const MIN_CYCLES: number = gait.capture.minimumCycles.perSidePerViewGroup;

const VIDEO_EXTS = [".y4m", ".mp4", ".mov", ".webm", ".mkv"];

export interface SmokeVideo {
  id: string;
  truthFile: string;
  video: string;
  truth: Truth;
}

/** Every truth sidecar with a video beside it, by id. */
export function findVideos(dir: string): SmokeVideo[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".truth.json"))
    .sort()
    .flatMap((f) => {
      const id = f.slice(0, -".truth.json".length);
      const video = VIDEO_EXTS.map((ext) => join(dir, id + ext)).find((p) => existsSync(p));
      if (!video) return [];
      const truthFile = join(dir, f);
      return [{ id, truthFile, video, truth: JSON.parse(readFileSync(truthFile, "utf8")) as Truth }];
    });
}

export interface RunRecord {
  id: string;
  model: string;
  truth: Truth;
  result: SmokeResult;
  /** Uncaught page errors (a crash even when the run reported done). */
  pageErrors: string[];
  /** The run's JSON file, from the results folder. */
  file: string;
}

export interface Verdict {
  check: string;
  /** true passes, false fails, null not judged (reported only, or not run). */
  ok: boolean | null;
  value: string;
  bar: string;
}

const num = (x: number) => String(Math.round(x * 10) / 10);
const pct = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;

function movementClass(id: string): "measure" | "caution" | null {
  const m = rom.movements.find((d) => d.id === id);
  return m ? (m.verdict as "measure" | "caution") : null;
}

function rangeVerdicts(truth: RomTruth, result: SmokeResult): Verdict[] {
  const out: Verdict[] = [];
  const runner = result.rom?.runner;
  const cls = movementClass(truth.movement);
  const bar =
    cls === "caution" ? "caution class: reported" : `within ${RANGE_BAR_DEG} degrees of the goniometer`;
  if (!runner) out.push({ check: "range", ok: false, value: "no runner report", bar });
  else if (runner.status === "not_built") out.push({ check: "range", ok: null, value: "not built (B)", bar });
  else if (runner.status === "error" && !("result" in runner && runner.result))
    out.push({ check: "range", ok: false, value: "error" in runner ? String(runner.error) : "error", bar });
  else {
    const res = "result" in runner ? runner.result : null;
    const v = res?.value ?? null;
    if (v === null)
      out.push({
        check: "range",
        ok: false,
        value: `not measured: ${res?.reason ?? res?.status ?? "no result"}`,
        bar,
      });
    else {
      const diff = Math.abs(v - truth.endDeg);
      out.push({
        check: "range",
        ok: cls === "caution" ? null : diff <= RANGE_BAR_DEG,
        value: `${num(v)} (truth ${num(truth.endDeg)}, ${num(diff)})`,
        bar,
      });
    }
  }
  const hold = result.rom?.trace.holdDeg ?? null;
  out.push(
    hold === null
      ? { check: "page reading", ok: false, value: "no angle read", bar: `harness, ${RANGE_BAR_DEG} degrees` }
      : {
          check: "page reading",
          ok: Math.abs(hold - truth.endDeg) <= RANGE_BAR_DEG,
          value: `${num(hold)} (truth ${num(truth.endDeg)}, ${num(Math.abs(hold - truth.endDeg))})`,
          bar: `harness, ${RANGE_BAR_DEG} degrees`,
        },
  );
  return out;
}

function gaitVerdicts(truth: GaitTruth, result: SmokeResult): Verdict[] {
  const out: Verdict[] = [];
  const engine = result.gait?.engine;
  const cadenceBar = `within ${pct(CADENCE_BAR)} of the truth`;
  const cyclesBar = `at least ${MIN_CYCLES} clean cycles a side`;
  if (!engine || engine.status !== "done") {
    const value = !engine
      ? "no engine report"
      : engine.status === "not_built"
        ? "not built (C)"
        : engine.error;
    const ok = engine?.status === "not_built" ? null : false;
    out.push(
      { check: "cadence", ok, value, bar: cadenceBar },
      { check: "cycles", ok, value, bar: cyclesBar },
    );
  } else {
    const cadence = engine.result.metrics.cadence?.value ?? null;
    if (cadence === null) out.push({ check: "cadence", ok: false, value: "no cadence", bar: cadenceBar });
    else {
      const err = Math.abs(cadence - truth.cadenceSpm) / truth.cadenceSpm;
      out.push({
        check: "cadence",
        ok: err <= CADENCE_BAR,
        value: `${num(cadence)} (truth ${num(truth.cadenceSpm)}, ${pct(err)})`,
        bar: cadenceBar,
      });
    }
    const c = engine.result.quality.cleanCycles;
    out.push({
      check: "cycles",
      ok: c.left >= MIN_CYCLES && c.right >= MIN_CYCLES,
      value: `left ${c.left}, right ${c.right}`,
      bar: cyclesBar,
    });
  }
  const h = result.gait?.harness.cadenceSpm ?? null;
  out.push(
    h === null
      ? {
          check: "tracking cadence",
          ok: false,
          value: "no period found",
          bar: `harness, ${pct(CADENCE_BAR)}`,
        }
      : {
          check: "tracking cadence",
          ok: Math.abs(h - truth.cadenceSpm) / truth.cadenceSpm <= CADENCE_BAR,
          value: `${num(h)} (truth ${num(truth.cadenceSpm)}, ${pct(Math.abs(h - truth.cadenceSpm) / truth.cadenceSpm)})`,
          bar: `harness, ${pct(CADENCE_BAR)}`,
        },
  );
  return out;
}

/** The checks of one run. */
export function evaluate(run: RunRecord): Verdict[] {
  const r = run.result;
  const crash = r.status !== "done" ? (r.error ?? "error") : run.pageErrors.length ? run.pageErrors[0] : null;
  const out: Verdict[] = [
    { check: "crash free", ok: crash === null, value: crash ?? "yes", bar: "zero crashes" },
    {
      check: "frame rate",
      ok: r.camera.frames > 0 && r.camera.fps !== null,
      value: r.camera.fps !== null ? `${num(r.camera.fps)} fps` : "no frames",
      bar: "recorded",
    },
  ];
  if (run.truth.kind === "rom") out.push(...rangeVerdicts(run.truth, r));
  else out.push(...gaitVerdicts(run.truth, r));
  return out;
}

const mark = (v: Verdict | undefined) => (!v ? "" : `${v.value} ${v.ok === null ? "·" : v.ok ? "✓" : "✗"}`);
const modelName = (m: string) => (m === "full" ? "Full" : m === "lite" ? "Lite" : m === "auto" ? "Auto" : m);
const ms = (v: number | null) => (v === null ? "none" : `${num(v)} ms`);

function runSection(run: RunRecord): string[] {
  const r = run.result;
  const lines = [`### ${run.id}, ${modelName(run.model)}`, ""];
  const size = r.camera.width && r.camera.height ? ` (picture ${r.camera.width} x ${r.camera.height}` : "";
  const tr = r.camera.track;
  const track =
    tr && tr.width && tr.height
      ? `; track ${tr.width} x ${tr.height} at ${tr.frameRate ?? "?"} fps${tr.resizeMode ? ` (${tr.resizeMode})` : ""}`
      : "";
  const delegate = r.perf.delegate ? ` on the ${r.perf.delegate}` : "";
  const longs = r.perf.longTasks;
  lines.push(
    `- Status ${r.status}${r.error ? ` (${r.error})` : ""} in ${num(r.seconds)} s; ${r.camera.frames} frames at ${r.camera.fps ?? 0} fps${size}${track}${size ? ")" : ""}; model ${r.model.used}${delegate} (asked ${r.model.requested})${r.model.probe ? `, probe ${r.model.probe.fps} fps${r.model.probe.switched ? ", switched to Lite" : ""}` : ""}.`,
    `- Model time per frame p50 ${ms(r.perf.modelMs.p50)}, p95 ${ms(r.perf.modelMs.p95)}; long tasks ${longs.count}${longs.maxMs !== null ? ` (longest ${ms(longs.maxMs)})` : ""}, beyond the model's calls ${longs.beyondModel.count}${longs.beyondModel.maxMs !== null ? ` (longest ${ms(longs.beyondModel.maxMs)})` : ""}; heap ${r.perf.heapMB ?? "unknown"} MB${r.perf.heapGrowthMB !== null ? ` (growth ${r.perf.heapGrowthMB})` : ""}.`,
  );
  if (r.rom) {
    const runner = r.rom.runner;
    if (runner.status === "not_built" || !("frames" in runner))
      lines.push(
        `- Runner: ${runner.status === "not_built" ? "not built (B)" : runner.status}: ${"error" in runner ? runner.error : ""}.`,
      );
    else
      lines.push(
        `- Runner ${runner.status}: value ${runner.result?.value ?? "none"}, status ${runner.result?.status ?? "none"}, ${runner.holds.length} holds, ${runner.answers.length} answers; feed p95 ${ms(runner.feedMs.p95)}.`,
      );
    const t = r.rom.trace;
    const truth = run.truth as RomTruth;
    lines.push(
      `- Page reading: start ${t.startDeg ?? "none"}, held ${t.holdDeg ?? "none"} against the truth ${truth.endDeg} (picture ${truth.projected?.endDeg ?? "unknown"}); the subject in ${t.seenShare === null ? 0 : Math.round(t.seenShare * 100)}% of frames.`,
    );
  }
  if (r.gait) {
    const g = r.gait;
    const truth = run.truth as GaitTruth;
    lines.push(
      `- Capture: ${g.capture.standingFrames} standing frames, ${g.capture.walkFrames} walk frames at ${g.capture.walkFps ?? 0} fps; ankles seen ${Math.round((g.tracking.ankles ?? 0) * 100)}%, heels ${Math.round((g.tracking.heels ?? 0) * 100)}%, toes ${Math.round((g.tracking.toes ?? 0) * 100)}%.`,
      g.engine.status === "done"
        ? `- Engine: cadence ${g.engine.result.metrics.cadence?.value ?? "none"}, clean cycles left ${g.engine.result.quality.cleanCycles.left} and right ${g.engine.result.quality.cleanCycles.right}, analysis ${ms(g.engine.analyseMs)}.`
        : `- Engine: ${g.engine.status === "not_built" ? "not built (C)" : "error"}: ${g.engine.error}.`,
      `- Tracking cadence ${g.harness.cadenceSpm ?? "none"} (stride ${g.harness.strideS ?? "none"} s, strength ${g.harness.strength ?? "none"}) against the truth ${truth.cadenceSpm} (${truth.strides.left} and ${truth.strides.right} strides).`,
    );
  }
  lines.push(`- File: ${run.file}`, "");
  return lines;
}

export interface SummaryMeta {
  date: string;
  commit: string;
  browser: string;
  machine: string;
  videos: string;
  results: string;
}

/** The smoke summary, local-docs/qa/v7/smoke-<date>.md. */
export function summaryMarkdown(runs: RunRecord[], meta: SummaryMeta): string {
  const gpu = runs.find((r) => r.result.gpu)?.result.gpu ?? "unknown";
  const verdicts = runs.map((r) => ({ run: r, v: evaluate(r) }));
  const gate = verdicts.flatMap(({ v }) =>
    v.filter((x) => ["crash free", "frame rate", "range", "cadence", "cycles"].includes(x.check)),
  );
  const failed = gate.filter((x) => x.ok === false).length;
  const open = gate.filter((x) => x.ok === null).length;
  const lines = [
    `# v7 real model smoke, ${meta.date}`,
    "",
    `Contract 8.4 (stream G, step G1). Commit ${meta.commit}; ${meta.browser}; ${meta.machine}; GPU ${gpu}.`,
    `Videos ${meta.videos}; results ${meta.results} (one JSON per run).`,
    "",
    `Gate: ${failed ? `${failed} checks fail` : "no check fails"}${open ? `, ${open} not judged (a runner not built, or a caution class movement)` : ""}.`,
    "",
    "## Gate (contract 8.4)",
    "",
    "| Video | Model | Crash free | Frame rate | Range | Page reading | Cadence | Cycles | Tracking cadence |",
    "|---|---|---|---|---|---|---|---|---|",
    ...verdicts.map(({ run, v }) => {
      const at = (c: string) => mark(v.find((x) => x.check === c));
      return `| ${run.id} | ${modelName(run.model)} | ${at("crash free")} | ${at("frame rate")} | ${at("range")} | ${at("page reading")} | ${at("cadence")} | ${at("cycles")} | ${at("tracking cadence")} |`;
    }),
    "",
    "✓ passes, ✗ fails, · not judged. Range and cadence are the runners' values (B, C) on the 8.4 bars; the page reading and the tracking cadence are the page's own readings of the same video on the same bars, a check of the model and the video.",
    "",
    "## Runs",
    "",
    ...runs.flatMap(runSection),
    "## Lite against Full (contract 12 item 6)",
    "",
    "| Video | Full fps | Lite fps | Full reading | Lite reading |",
    "|---|---|---|---|---|",
    ...[...new Set(runs.map((r) => r.id))].map((id) => {
      const by = (m: string) => runs.find((r) => r.id === id && r.model === m);
      const reading = (r?: RunRecord) =>
        !r
          ? ""
          : r.result.rom
            ? `${r.result.rom.trace.holdDeg ?? "none"} deg`
            : r.result.gait
              ? `${r.result.gait.harness.cadenceSpm ?? "none"} spm`
              : "";
      const f = by("full");
      const l = by("lite");
      return `| ${id} | ${f?.result.camera.fps ?? ""} | ${l?.result.camera.fps ?? ""} | ${reading(f)} | ${reading(l)} |`;
    }),
    "",
  ];
  return lines.join("\n");
}
