#!/usr/bin/env node
/**
 * mp4 (or any video ffmpeg reads) to Y4M for Chromium's fake camera (product v7 contract 1.2 and 8.4,
 * stream G, step G1). Dev only; needs ffmpeg on the PATH.
 *
 *   node scripts/smoke/to-y4m.mjs <video> [--out <file.y4m>] [--fps 30] [--width W] [--height H]
 *                                         [--start S] [--seconds N]
 *
 * The output defaults to the input's name with .y4m beside it. The smoke videos and their Y4M files
 * live in /Users/nasser/Development/Azm6.0/local-docs/qa/v7/videos/ (git ignored, never committed):
 * pass that path, never a relative local-docs one (contract 1.1). A Y4M file is raw: about
 * width x height x 1.5 bytes per frame, so a 30 s walk at 960x540 is close to 0.7 GB. Keep the mp4
 * and convert again when needed.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { readY4mInfo, y4mArgs } from "./y4m.mjs";

function parse(argv) {
  const opts = { input: undefined };
  const num = (flag, v) => {
    const n = Number(v);
    if (v === undefined || !Number.isFinite(n)) throw new Error(`to-y4m: ${flag} needs a number`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.output = argv[++i];
    else if (a === "--fps") opts.fps = num(a, argv[++i]);
    else if (a === "--width") opts.width = num(a, argv[++i]);
    else if (a === "--height") opts.height = num(a, argv[++i]);
    else if (a === "--start") opts.start = num(a, argv[++i]);
    else if (a === "--seconds") opts.seconds = num(a, argv[++i]);
    else if (a.startsWith("--")) throw new Error(`to-y4m: unknown option ${a}`);
    else if (opts.input === undefined) opts.input = a;
    else throw new Error(`to-y4m: one input only (${a})`);
  }
  if (!opts.input) throw new Error("to-y4m: name the video to convert");
  return opts;
}

function main() {
  const opts = parse(process.argv.slice(2));
  const input = resolve(opts.input);
  if (!existsSync(input)) throw new Error(`to-y4m: no file ${input}`);
  const output = resolve(opts.output ?? join(dirname(input), `${basename(input, extname(input))}.y4m`));
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0)
    throw new Error("to-y4m: ffmpeg is not on the PATH");
  const run = spawnSync("ffmpeg", y4mArgs({ ...opts, input, output }), { stdio: ["ignore", "inherit", "inherit"] });
  if (run.status !== 0) throw new Error(`to-y4m: ffmpeg failed (${run.status})`);
  const info = readY4mInfo(output);
  if (info.problems.length) throw new Error(`to-y4m: ${output}: ${info.problems.join(", ")}`);
  const { width, height, fps } = info.header;
  const mb = (info.bytes / 1e6).toFixed(0);
  console.log(`${output}: ${width}x${height}, ${fps} fps, ${info.frames} frames (${info.seconds.toFixed(2)} s), ${mb} MB`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
