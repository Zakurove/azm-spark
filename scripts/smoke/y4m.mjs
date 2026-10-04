/**
 * Y4M for Chromium's fake camera (product v7 contract 8.4, stream G, step G1).
 *
 * Playwright's Chromium plays a recorded video as the camera with
 *   --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<file>.y4m
 * and loops it at the frame rate of the file's header. Its Y4M reader takes 4:2:0 progressive
 * frames, so the conversion asks ffmpeg for exactly that (yuv420p, yuv4mpegpipe) at a fixed frame
 * rate, with even sizes (the chroma planes halve both sides).
 *
 * The file format (one stream header line, then per frame "FRAME\n" and the Y, U and V planes) is
 * the YUV4MPEG2 format of the mjpegtools and ffmpeg projects. Dev only: nothing here ships.
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";

const positive = (name, v) => {
  if (v === undefined) return;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new Error(`y4m: ${name} must be a positive number`);
};
const even = (v) => Math.max(2, Math.floor(v / 2) * 2);

/**
 * ffmpeg arguments that turn any video ffmpeg reads into a Y4M file for Chromium's fake camera.
 * `width` and `height` scale the picture (one of them alone keeps the aspect); `start` and `seconds`
 * cut a window (seconds into the input).
 */
export function y4mArgs({ input, output, fps = 30, width, height, start, seconds }) {
  positive("fps", fps);
  positive("width", width);
  positive("height", height);
  positive("seconds", seconds);
  if (start !== undefined && (typeof start !== "number" || !Number.isFinite(start) || start < 0))
    throw new Error("y4m: start must be zero or more");
  const filters = [];
  if (width !== undefined || height !== undefined)
    filters.push(`scale=${width !== undefined ? even(width) : -2}:${height !== undefined ? even(height) : -2}`);
  // Without a scale, an odd source size still has to become even for 4:2:0.
  else filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2");
  filters.push(`fps=${fps}`, "setsar=1");
  return [
    ...["-hide_banner", "-loglevel", "error", "-y"],
    ...(start !== undefined ? ["-ss", String(start)] : []),
    ...["-i", input],
    ...(seconds !== undefined ? ["-t", String(seconds)] : []),
    ...["-an", "-vf", filters.join(",")],
    ...["-pix_fmt", "yuv420p", "-f", "yuv4mpegpipe", output],
  ];
}

/** The stream header of a Y4M file: "YUV4MPEG2 W<w> H<h> F<n>:<d> I<p|t|b|m> A<a>:<b> C<chroma> ...". */
export function parseY4mHeader(line) {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== "YUV4MPEG2") throw new Error("y4m: the file does not start with YUV4MPEG2");
  const out = { width: NaN, height: NaN, fps: NaN, fpsRatio: [NaN, NaN], interlace: "p", chroma: "420jpeg" };
  for (const t of tokens.slice(1)) {
    const v = t.slice(1);
    switch (t[0]) {
      case "W":
        out.width = Number(v);
        break;
      case "H":
        out.height = Number(v);
        break;
      case "F": {
        const [n, d] = v.split(":").map(Number);
        out.fpsRatio = [n, d];
        out.fps = n / d;
        break;
      }
      case "I":
        out.interlace = v;
        break;
      case "C":
        out.chroma = v;
        break;
      default:
        break;
    }
  }
  if (!(out.width > 0)) throw new Error("y4m: no width in the header");
  if (!(out.height > 0)) throw new Error("y4m: no height in the header");
  if (!(out.fps > 0)) throw new Error("y4m: no frame rate in the header");
  return out;
}

/** What Chromium's file capture would not play: interlaced frames, chroma other than 4:2:0, odd sizes. */
export function y4mProblems(header) {
  const problems = [];
  if (header.interlace !== "p") problems.push("interlaced");
  if (!header.chroma.startsWith("420")) problems.push(`chroma ${header.chroma}, not 4:2:0`);
  if (header.width % 2 || header.height % 2) problems.push(`odd size ${header.width}x${header.height}`);
  return problems;
}

/** Bytes of one 4:2:0 frame's planes. */
export const y4mFrameBytes = (width, height) => width * height + 2 * (width / 2) * (height / 2);

/** Whole frames in a file of `fileSize` bytes whose header line takes `headerBytes` ("FRAME\n" each). */
export const y4mFrameCount = (fileSize, headerBytes, width, height) =>
  Math.floor((fileSize - headerBytes) / (6 + y4mFrameBytes(width, height)));

/** The header, the frame count and the problems of a Y4M file on disk. */
export function readY4mInfo(file) {
  const fd = openSync(file, "r");
  let line;
  try {
    const buf = Buffer.alloc(512);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const end = buf.subarray(0, n).indexOf(0x0a);
    if (end < 0) throw new Error("y4m: no header line in the first 512 bytes");
    line = buf.subarray(0, end).toString("latin1");
  } finally {
    closeSync(fd);
  }
  const header = parseY4mHeader(line);
  const headerBytes = Buffer.byteLength(line, "latin1") + 1;
  const size = statSync(file).size;
  const frames = y4mFrameCount(size, headerBytes, header.width, header.height);
  return { header, headerBytes, frames, seconds: frames / header.fps, bytes: size, problems: y4mProblems(header) };
}
