/**
 * The v7 real model smoke (product v7 contract 8.4, stream G, step G1): Playwright's Chromium plays
 * each smoke video as the camera (--use-fake-device-for-media-stream
 * --use-file-for-fake-video-capture), the smoke page (/?e2eSmoke=<name>, VITE_E2E builds) runs the
 * real CameraPoseSource and the real runners on it, and the results are written as JSON and
 * summarised to <out>/smoke-<date>.md. On demand and before every staging deploy, never in CI:
 *
 *   AZM_SMOKE_VIDEOS=/Users/nasser/Development/Azm6.0/local-docs/qa/v7/videos \
 *     npx playwright test -c e2e/v7-smoke.config.ts
 *
 *   AZM_SMOKE_VIDEOS    the videos: <id>.truth.json beside <id>.y4m or <id>.mp4 (an mp4 is converted to
 *                       a temporary Y4M for its runs and removed after them); unset, every test skips
 *   AZM_SMOKE_OUT       where smoke-<date>.md and smoke-<date>/ go (default: the videos folder's parent,
 *                       local-docs/qa/v7)
 *   AZM_SMOKE_MODELS    full,lite (default); auto runs the focus camera's probe (C-10)
 *   AZM_SMOKE_ONLY      only these ids, comma separated
 *   AZM_SMOKE_FRAMES=1  keep the subject's landmarks in each run's JSON (replay off line)
 *   AZM_SMOKE_GATE=1    fail on the 8.4 pass bar (before a staging deploy); without it the bar is
 *                       reported, and a crash, a page error or a run without frames fails
 *   AZM_SMOKE_CHANNEL   the Chromium build (default chromium: full Chromium, GPU with Metal on macOS)
 *   AZM_SMOKE_HEADED=1  show the browser
 *
 * A truth sidecar (scripts/smoke/render.mjs writes it for a rendered video; for a recorded video it
 * is written by hand) holds: id, kind, fps, width, height, frames; for range movement, side, position,
 * view and endDeg (the goniometer at the end range); for gait view, nearSide, mode, padSpeedKmh,
 * heightCm, standing { from, to } and walk { from, to } in seconds from the video's start, cadenceSpm
 * (hand counted) and strides; and optionally smokeQuery. Videos of people stay in the git ignored
 * local-docs and are never committed (8.4).
 */
import { chromium, expect, test, type Browser } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { smokeQuery, type Truth } from "../scripts/smoke/scenarios.mjs";
import { readY4mInfo, y4mArgs } from "../scripts/smoke/y4m.mjs";
import type { SmokeState } from "../src/features/smoke/SmokePage";
import { evaluate, findVideos, summaryMarkdown, type RunRecord, type SmokeVideo } from "./v7-smoke-report";

const VIDEOS = process.env.AZM_SMOKE_VIDEOS ? resolve(process.env.AZM_SMOKE_VIDEOS) : null;
const OUT = resolve(process.env.AZM_SMOKE_OUT ?? (VIDEOS ? dirname(VIDEOS) : tmpdir()));
const MODELS = (process.env.AZM_SMOKE_MODELS ?? "full,lite")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const ONLY = process.env.AZM_SMOKE_ONLY?.split(",").map((s) => s.trim()) ?? null;
const GATE = process.env.AZM_SMOKE_GATE === "1";
const DATE = new Date().toLocaleDateString("en-CA");
const RESULTS = join(OUT, `smoke-${DATE}`);
const TMP = join(
  tmpdir(),
  process.env.AZM_SMOKE_RUN ? `azm-smoke-${process.env.AZM_SMOKE_RUN}` : `azm-smoke-${process.pid}`,
  "y4m",
);

const videos: SmokeVideo[] = VIDEOS ? findVideos(VIDEOS).filter((v) => !ONLY || ONLY.includes(v.id)) : [];
const records: RunRecord[] = [];
let browserName = "Chromium";

/** The Y4M of a video, converted once for its runs when it is not one already. */
const converted = new Map<string, { file: string; runsLeft: number }>();
function y4mOf(v: SmokeVideo): string {
  if (v.video.endsWith(".y4m")) return v.video;
  const known = converted.get(v.id);
  if (known) return known.file;
  mkdirSync(TMP, { recursive: true });
  const file = join(TMP, `${v.id}.y4m`);
  const t = v.truth as Truth & { frames?: number };
  // Raw 4:2:0 frames: width x height x 1.5 bytes each; keep half a gigabyte free besides.
  const need = t.width && t.height && t.frames ? t.width * t.height * 1.5 * t.frames : 0;
  const fs = statfsSync(TMP);
  const free = fs.bavail * fs.bsize;
  if (need && free < need + 5e8)
    throw new Error(
      `Not enough disk for ${v.id}.y4m: ${(need / 1e9).toFixed(2)} GB needed, ${(free / 1e9).toFixed(2)} GB free`,
    );
  const run = spawnSync("ffmpeg", y4mArgs({ input: v.video, output: file, fps: t.fps ?? 30 }), {
    stdio: "inherit",
  });
  if (run.status !== 0) throw new Error(`ffmpeg could not convert ${v.video} (${run.status})`);
  const info = readY4mInfo(file);
  if (info.problems.length) throw new Error(`${file}: ${info.problems.join(", ")}`);
  converted.set(v.id, { file, runsLeft: MODELS.length });
  return file;
}
function doneWith(v: SmokeVideo): void {
  const c = converted.get(v.id);
  if (!c) return;
  c.runsLeft--;
  if (c.runsLeft <= 0) {
    rmSync(c.file, { force: true });
    converted.delete(v.id);
  }
}

async function launch(y4m: string): Promise<Browser> {
  const args = [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-video-capture=${y4m}`,
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--ignore-gpu-blocklist",
    "--enable-gpu-rasterization",
    ...(platform() === "darwin" ? ["--use-angle=metal"] : []),
  ];
  const channel = process.env.AZM_SMOKE_CHANNEL ?? "chromium";
  return chromium.launch({
    channel: channel || undefined,
    args,
    headless: process.env.AZM_SMOKE_HEADED !== "1",
  });
}

function gitCommit(): string {
  const cwd = dirname(new URL(import.meta.url).pathname);
  const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).stdout.trim();
  const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd,
    encoding: "utf8",
  }).stdout.trim();
  return sha ? `${sha}${dirty ? " (with uncommitted changes)" : ""}` : "unknown";
}

test.describe("v7 real model smoke (contract 8.4)", () => {
  test.skip(!VIDEOS, "AZM_SMOKE_VIDEOS is not set: the smoke runs on demand with its videos, never in CI");

  test.afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    if (!records.length) return;
    mkdirSync(OUT, { recursive: true });
    const md = summaryMarkdown(records, {
      date: DATE,
      commit: gitCommit(),
      browser: browserName,
      machine: `${platform()} ${arch()}, ${cpus()[0]?.model ?? "unknown CPU"}`,
      videos: VIDEOS!,
      results: RESULTS,
    });
    writeFileSync(join(OUT, `smoke-${DATE}.md`), md);
  });

  for (const v of videos)
    for (const model of MODELS)
      test(`${v.id}, ${model}`, async ({ baseURL }) => {
        const truth = v.truth as Truth & { smokeQuery?: string; walk?: { to: number } };
        const limitSec = truth.kind === "rom" ? 240 : (truth.walk?.to ?? 60) + 120;
        test.setTimeout((limitSec + 90) * 1000);
        const y4m = y4mOf(v);
        const browser = await launch(y4m);
        browserName = `Chromium ${browser.version()}`;
        const pageErrors: string[] = [];
        try {
          const context = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            permissions: ["camera"],
          });
          const page = await context.newPage();
          page.on("pageerror", (e) => pageErrors.push(e.message));
          const query = truth.smokeQuery ?? smokeQuery(truth);
          const frames = process.env.AZM_SMOKE_FRAMES === "1" ? "&frames=1" : "";
          await page.goto(
            `${baseURL}/?e2eSmoke=${encodeURIComponent(v.id)}&${query}&model=${model}${frames}&lang=en`,
          );
          await page.waitForFunction(
            () => {
              const s = (window as Window & { __azmSmoke?: SmokeState }).__azmSmoke;
              return !!s && s.status !== "running";
            },
            undefined,
            { timeout: limitSec * 1000, polling: 1000 },
          );
          const state = await page.evaluate(
            () => (window as Window & { __azmSmoke?: SmokeState }).__azmSmoke!,
          );
          expect(state.result, state.error ?? "the page gave no result").toBeTruthy();
          const result = state.result!;
          mkdirSync(RESULTS, { recursive: true });
          const file = join(RESULTS, `${v.id}-${model}.json`);
          const run: RunRecord = { id: v.id, model, truth, result, pageErrors, file: relative(OUT, file) };
          const verdicts = evaluate(run);
          writeFileSync(
            file,
            JSON.stringify({ truth: relative(OUT, v.truthFile), verdicts, pageErrors, result }, null, 1) +
              "\n",
          );
          records.push(run);

          // Zero crashes, and the real model gave frames of the subject.
          expect(result.status, result.error).toBe("done");
          expect(pageErrors).toEqual([]);
          expect(result.camera.frames).toBeGreaterThan(30);
          if (result.rom) expect(result.rom.trace.seenShare ?? 0).toBeGreaterThan(0.5);
          if (result.gait) expect(result.gait.capture.walkFrames).toBeGreaterThan(30);
          if (GATE) expect(verdicts.filter((x) => x.ok === false)).toEqual([]);
        } finally {
          await browser.close();
          doneWith(v);
        }
      });
});
