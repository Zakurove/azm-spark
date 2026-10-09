/**
 * The walk lab's real model smoke (D-035 item 4; contract 8.4): Playwright's Chromium plays each walk
 * at home as the camera (--use-file-for-fake-video-capture), the walk lab (/?gaitlab=side|front, its
 * query from the truth's smokeQuery, auto=1) runs the capture with the real pose model, and its result
 * is judged against the rendered truth: a reading (full or timing only) with the cadence within 5%.
 * On demand, never in CI:
 *
 *   AZM_SMOKE_VIDEOS=/Users/nasser/Development/Azm6.0/local-docs/qa/v7/videos-home AZM_SMOKE_PORT=5942 \
 *     npx playwright test -c e2e/v7-gaitlab-smoke.config.ts
 *
 *   AZM_SMOKE_VIDEOS    the videos: <id>.truth.json (with a lab) beside <id>.mp4 or .y4m; unset, skips
 *   AZM_SMOKE_OUT       where gaitlab-smoke-<date>.md and its JSON go (default: the videos' parent)
 *   AZM_SMOKE_MODELS    full,lite (default)
 *   AZM_SMOKE_FIXTURES  a folder to write each run's kept landmarks as <id>-<model>.smoke (format
 *                       azm-gait-smoke-2, tests/fixtures/gait/smoke.ts loadHomeSmoke)
 *   AZM_SMOKE_GATE=1    fail on the bar (a reading with the cadence within 5%); else it is reported
 */
import { chromium, expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { platform } from "node:os";
import { y4mArgs } from "../scripts/smoke/y4m.mjs";
import type { GaitLabState } from "../src/features/gait/GaitLab";
import { findVideos } from "./v7-smoke-report";

interface LabTruth {
  id: string;
  kind: "gait";
  lab?: "side" | "front";
  fps: number;
  cadenceSpm: number;
  strideTimeS: number;
  heightCm: number;
  seconds: number;
  events: { side: "left" | "right"; type: "ic"; t: number }[];
  smokeQuery?: string;
}

const VIDEOS = process.env.AZM_SMOKE_VIDEOS ? resolve(process.env.AZM_SMOKE_VIDEOS) : null;
const OUT = resolve(process.env.AZM_SMOKE_OUT ?? (VIDEOS ? dirname(VIDEOS) : tmpdir()));
const MODELS = (process.env.AZM_SMOKE_MODELS ?? "full,lite").split(",").filter(Boolean);
const GATE = process.env.AZM_SMOKE_GATE === "1";
const FIXTURES = process.env.AZM_SMOKE_FIXTURES ? resolve(process.env.AZM_SMOKE_FIXTURES) : null;
const DATE = new Date().toLocaleDateString("en-CA");
const RESULTS = join(OUT, `gaitlab-smoke-${DATE}`);
const TMP = join(tmpdir(), `azm-smoke-${process.env.AZM_SMOKE_RUN ?? process.pid}`, "y4m");

const videos = VIDEOS ? findVideos(VIDEOS).filter((v) => (v.truth as unknown as LabTruth).lab) : [];
const rows: string[] = [];

test.describe("the walk lab on rendered walks at home (D-035 item 4)", () => {
  if (!videos.length)
    test("the walk lab's videos", () => {
      test.skip(!VIDEOS, "AZM_SMOKE_VIDEOS is not set: the smoke runs on demand with its videos");
      throw new Error(`No <id>.truth.json with a lab and a video beside it in ${VIDEOS}`);
    });

  test.afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    if (!rows.length) return;
    mkdirSync(OUT, { recursive: true });
    const md = [
      `# The walk lab's real model smoke, ${DATE}`,
      "",
      `Videos ${VIDEOS}; results ${RESULTS} (one JSON per run). Chromium's fake camera plays each rendered walk; the walk lab (/?gaitlab, auto=1) runs the capture with the real model. Bar: a reading (full or timing only) with the cadence within 5% of the truth.`,
      "",
      "| Video | Model | Level | Cadence | Clean cycles R/L | Passes | Legs seen | fps | Verdict | Bar |",
      "|---|---|---|---|---|---|---|---|---|---|",
      ...rows,
      "",
    ].join("\n");
    writeFileSync(join(OUT, `gaitlab-smoke-${DATE}.md`), md);
  });

  for (const v of videos)
    for (const model of MODELS)
      test(`${v.id}, ${model}`, async ({ baseURL }) => {
        const truth = v.truth as unknown as LabTruth;
        test.setTimeout((truth.seconds * 3 + 180) * 1000);
        mkdirSync(TMP, { recursive: true });
        const y4m = v.video.endsWith(".y4m") ? v.video : join(TMP, `${v.id}.y4m`);
        if (y4m !== v.video) {
          const run = spawnSync("ffmpeg", y4mArgs({ input: v.video, output: y4m, fps: truth.fps }), {
            stdio: "inherit",
          });
          expect(run.status).toBe(0);
        }
        const browser = await chromium.launch({
          channel: process.env.AZM_SMOKE_CHANNEL ?? "chromium",
          headless: process.env.AZM_SMOKE_HEADED !== "1",
          args: [
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
          ],
        });
        const errors: string[] = [];
        try {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
          page.on("pageerror", (e) => errors.push(e.message));
          const posts: string[] = [];
          page.on("request", (r) => {
            if (r.method() !== "GET" && r.url().includes("/api/")) posts.push(r.url());
          });
          const query = truth.smokeQuery ?? `gaitlab=${truth.lab}&auto=1`;
          await page.goto(`${baseURL}/?${query}&model=${model}&lang=en${FIXTURES ? "&frames=1" : ""}`);
          await page.waitForFunction(
            () => (window as unknown as { __azmGaitLab?: GaitLabState }).__azmGaitLab?.status === "done",
            undefined,
            { timeout: (truth.seconds * 3 + 120) * 1000, polling: 1000 },
          );
          const state = await page.evaluate(
            () => (window as unknown as { __azmGaitLab: GaitLabState }).__azmGaitLab,
          );
          const r = state.result!;
          const err = r.cadence === null ? null : Math.abs(r.cadence / truth.cadenceSpm - 1);
          const ok = r.level !== "none" && err !== null && err <= 0.05;
          const d = r.diagnostics[0];
          rows.push(
            `| ${v.id} | ${model} | ${r.level} | ${r.cadence ?? "none"} (truth ${truth.cadenceSpm}${err === null ? "" : `, ${(err * 100).toFixed(1)}%`}) | ${r.cleanCycles.right}/${r.cleanCycles.left} | ${d?.passes ?? 0} | ${d?.visibleShare ?? "none"} | ${d?.fps ?? "none"} | ${r.verdict} | ${ok ? "✓" : "✗"} |`,
          );
          mkdirSync(RESULTS, { recursive: true });
          writeFileSync(
            join(RESULTS, `${v.id}-${model}.json`),
            JSON.stringify({ truth: v.truthFile, ok, errors, result: r }, null, 1) + "\n",
          );
          if (FIXTURES && state.frames?.length) {
            mkdirSync(FIXTURES, { recursive: true });
            const rec = state.frames[0];
            writeFileSync(
              join(FIXTURES, `${v.id}-${model}.smoke`),
              JSON.stringify({
                format: "azm-gait-smoke-2",
                source: `The walk lab's real model smoke (D-035 item 4), ${DATE}: MediaPipe Pose ${model} in Chromium on the GPU, the subject's landmarks of the rendered procedural humanoid of scripts/smoke (no person, no third party asset), ${v.id}`,
                model,
                lab: truth.lab,
                aspect: rec.aspect,
                heightCm: truth.heightCm,
                landmarks: [0, 2, 5, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
                truth: { cadence: truth.cadenceSpm, strideSec: truth.strideTimeS },
                result: { level: r.level, cadence: r.cadence, cleanCycles: r.cleanCycles },
                standing: rec.standing,
                frames: rec.frames,
              }) + "\n",
            );
          }
          expect(errors).toEqual([]);
          expect(posts).toEqual([]);
          if (GATE) expect(ok, r.verdict).toBe(true);
        } finally {
          await browser.close();
          if (y4m !== v.video) rmSync(y4m, { force: true });
        }
      });
});
