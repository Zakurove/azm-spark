#!/usr/bin/env node
/**
 * Renders a smoke video with its truth (product v7 contract 8.4, stream G, step G1). Dev only; needs
 * ffmpeg on the PATH and Playwright's Chromium (npx playwright install chromium).
 *
 *   node scripts/smoke/render.mjs <scenario|all> --out <dir> [--y4m] [--seconds N] [--scale 2]
 *                                                      [--truth-only]
 *
 *   <dir>/<scenario>.mp4          H.264, the scenario's size and frame rate
 *   <dir>/<scenario>.truth.json   the truth (scenarios.mjs scenarioTruth) and the smoke page query
 *   <dir>/<scenario>.joints.json  every joint projected into the picture per frame (normalised)
 *   <dir>/<scenario>.y4m          with --y4m: the file Chromium's fake camera plays (to-y4m.mjs)
 *
 * Scenarios: rom-shoulder-abduction-right, gait-pad-side (scenarios.mjs). Use the absolute path
 * /Users/nasser/Development/Azm6.0/local-docs/qa/v7/videos for <dir> (git ignored, never committed).
 * Each frame is drawn by the procedural humanoid's shader in Chromium on the GPU (Metal on macOS) at
 * `--scale` times the size and averaged down by ffmpeg, so edges are smooth like a camera picture.
 * --truth-only writes the truth and joints files again without rendering (the kinematics run in Node).
 */
import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { skeleton } from "./humanoid.mjs";
import { SCENARIOS, framePoints, scenarioTruth, smokeQuery } from "./scenarios.mjs";
import { readY4mInfo, y4mArgs } from "./y4m.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://azm-smoke-render.local";

function parse(argv) {
  const opts = { ids: [], out: undefined, y4m: false, seconds: undefined, scale: 2, truthOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--y4m") opts.y4m = true;
    else if (a === "--truth-only") opts.truthOnly = true;
    else if (a === "--seconds") opts.seconds = Number(argv[++i]);
    else if (a === "--scale") opts.scale = Number(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`render: unknown option ${a}`);
    else opts.ids.push(a);
  }
  if (!opts.out) throw new Error("render: --out <dir> is required");
  if (opts.ids.length === 1 && opts.ids[0] === "all") opts.ids = Object.keys(SCENARIOS);
  if (!opts.ids.length) throw new Error(`render: name a scenario (${Object.keys(SCENARIOS).join(", ")}) or all`);
  for (const id of opts.ids) if (!SCENARIOS[id]) throw new Error(`render: no scenario ${id}`);
  if (!(opts.scale >= 1 && opts.scale <= 4)) throw new Error("render: --scale is 1 to 4");
  return opts;
}

/** Full Chromium with the GPU: headless shell rendering falls back to software GL on macOS. */
async function launch() {
  const args = ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"];
  if (process.platform === "darwin") args.push("--use-angle=metal");
  try {
    return await chromium.launch({ channel: "chromium", args });
  } catch {
    return chromium.launch({ args });
  }
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<canvas id="c"></canvas>
<script type="module">
import { createRenderer } from "${ORIGIN}/humanoid.mjs";
const canvas = document.getElementById("c");
let renderer = null;
window.setup = (w, h) => { canvas.width = w; canvas.height = h; renderer = createRenderer(canvas); return true; };
window.draw = (skel, cam, scene) => { renderer.render(skel, cam, scene); return canvas.toDataURL("image/png").slice(22); };
window.gpu = () => {
  const gl = canvas.getContext("webgl2");
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
};
window.ready = true;
</script></body></html>`;

/** The truth and joints files of a scenario (the kinematics only). */
function writeTruth(sc, opts, outDir, extra = {}) {
  const seconds = opts.seconds ?? sc.seconds;
  const frames = Math.round(seconds * sc.fps);
  const joints = [];
  for (let i = 0; i < frames; i++)
    joints.push(framePoints(sc, skeleton(sc.poseAt(i / sc.fps))).map((p) => [round4(p.x), round4(p.y)]));
  const truth = scenarioTruth(sc);
  // A truth may ask for its own query (D-035: answer=none); else the movement's.
  const out = { ...truth, frames, seconds, smokeQuery: truth.smokeQuery ?? smokeQuery(truth), ...extra };
  writeFileSync(join(outDir, `${sc.id}.truth.json`), JSON.stringify(out, null, 2) + "\n");
  writeFileSync(
    join(outDir, `${sc.id}.joints.json`),
    JSON.stringify({ id: sc.id, fps: sc.fps, order: "humanoid.mjs J", frames: joints }) + "\n",
  );
  return out;
}

async function renderOne(page, sc, opts, outDir) {
  const seconds = opts.seconds ?? sc.seconds;
  const frames = Math.round(seconds * sc.fps);
  const W = sc.width * opts.scale;
  const H = sc.height * opts.scale;
  await page.evaluate(([w, h]) => window.setup(w, h), [W, H]);
  const mp4 = join(outDir, `${sc.id}.mp4`);
  const ff = spawn(
    "ffmpeg",
    [
      ...["-hide_banner", "-loglevel", "error", "-y"],
      ...["-f", "image2pipe", "-framerate", String(sc.fps), "-c:v", "png", "-i", "-"],
      ...["-vf", `scale=${sc.width}:${sc.height}:flags=area`],
      ...["-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
      mp4,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = new Promise((res, rej) => ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg ${code}`)))));
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    const skel = skeleton(sc.poseAt(i / sc.fps));
    const png = await page.evaluate(([s, c, sc2]) => window.draw(s, c, sc2), [skel, sc.camera, sc.scene]);
    if (!ff.stdin.write(Buffer.from(png, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 150 === 0) process.stdout.write(`  ${sc.id}: frame ${i}/${frames}\r`);
  }
  ff.stdin.end();
  await done;
  const out = writeTruth(sc, opts, outDir, { renderSeconds: (Date.now() - t0) / 1000 });
  console.log(`  ${sc.id}: ${frames} frames, ${sc.width}x${sc.height} at ${sc.fps} fps -> ${mp4} (${out.renderSeconds.toFixed(1)} s)`);
  if (opts.y4m) {
    const y4m = join(outDir, `${sc.id}.y4m`);
    const run = spawnSync("ffmpeg", y4mArgs({ input: mp4, output: y4m, fps: sc.fps }), { stdio: "inherit" });
    if (run.status !== 0) throw new Error(`render: the Y4M conversion failed (${run.status})`);
    const info = readY4mInfo(y4m);
    if (info.problems.length) throw new Error(`render: ${y4m}: ${info.problems.join(", ")}`);
    console.log(`  ${sc.id}: ${y4m} (${info.frames} frames, ${(info.bytes / 1e6).toFixed(0)} MB)`);
  }
}

const round4 = (x) => Math.round(x * 1e4) / 1e4;

async function main() {
  const opts = parse(process.argv.slice(2));
  if (!opts.truthOnly && spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0)
    throw new Error("render: ffmpeg is not on the PATH");
  const outDir = resolve(opts.out);
  mkdirSync(outDir, { recursive: true });
  if (opts.truthOnly) {
    for (const id of opts.ids) {
      writeTruth(SCENARIOS[id], opts, outDir);
      console.log(`  ${id}: truth and joints written to ${outDir}`);
    }
    return;
  }
  const browser = await launch();
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error("page:", e.message));
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/") return route.fulfill({ contentType: "text/html", body: PAGE });
      if (path === "/humanoid.mjs")
        return route.fulfill({ contentType: "text/javascript", body: readFileSync(join(HERE, "humanoid.mjs")) });
      return route.fulfill({ status: 404, body: "" });
    });
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => window.ready === true);
    await page.evaluate(() => window.setup(64, 64));
    console.log(`GPU: ${await page.evaluate(() => window.gpu())}`);
    for (const id of opts.ids) await renderOne(page, SCENARIOS[id], opts, outDir);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
