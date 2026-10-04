/**
 * Step G1 (product v7 contract 8.4): the video to Y4M conversion for Chromium's fake camera
 * (scripts/smoke/y4m.mjs and scripts/smoke/to-y4m.mjs). Chromium plays a 4:2:0 progressive Y4M file
 * through --use-file-for-fake-video-capture, looping it, at the frame rate of its header.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  parseY4mHeader,
  readY4mInfo,
  y4mArgs,
  y4mFrameBytes,
  y4mFrameCount,
  y4mProblems,
} from "../../scripts/smoke/y4m.mjs";

const ROOT = join(__dirname, "../..");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

describe("y4mArgs", () => {
  it("asks ffmpeg for 4:2:0 progressive Y4M at the frame rate, with even sizes", () => {
    const args = y4mArgs({ input: "in.mp4", output: "out.y4m", fps: 30, width: 540, height: 961 });
    expect(args.slice(0, 4)).toEqual(["-hide_banner", "-loglevel", "error", "-y"]);
    expect(args).toContain("in.mp4");
    expect(args[args.length - 1]).toBe("out.y4m");
    const vf = args[args.indexOf("-vf") + 1];
    // Chroma halves both sides: an odd size is rounded down to even.
    expect(vf).toContain("scale=540:960");
    expect(vf).toContain("fps=30");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv420p");
    expect(args[args.indexOf("-f") + 1]).toBe("yuv4mpegpipe");
  });

  it("keeps the picture's aspect when one side is given, and cuts a window", () => {
    const args = y4mArgs({ input: "a.mov", output: "b.y4m", width: 960, start: 2, seconds: 30 });
    expect(args[args.indexOf("-vf") + 1]).toContain("scale=960:-2");
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual(["-ss", "2"]);
    expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual(["-t", "30"]);
    // -ss before -i seeks the input; -t after it limits the output.
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args.indexOf("-t")).toBeGreaterThan(args.indexOf("-i"));
  });

  it("refuses a frame rate or size that is not a positive number", () => {
    expect(() => y4mArgs({ input: "a", output: "b", fps: 0 })).toThrow(/fps/);
    expect(() => y4mArgs({ input: "a", output: "b", width: -2 })).toThrow(/width/);
  });
});

describe("the Y4M header", () => {
  const line = "YUV4MPEG2 W540 H960 F30:1 Ip A1:1 C420jpeg XYSCSS=420JPEG";

  it("is read", () => {
    expect(parseY4mHeader(line)).toEqual({
      width: 540,
      height: 960,
      fps: 30,
      fpsRatio: [30, 1],
      interlace: "p",
      chroma: "420jpeg",
    });
    expect(parseY4mHeader("YUV4MPEG2 W960 H540 F30000:1001 C420").fps).toBeCloseTo(29.97, 2);
  });

  it("names what Chromium's file capture cannot play", () => {
    expect(y4mProblems(parseY4mHeader(line))).toEqual([]);
    expect(y4mProblems(parseY4mHeader("YUV4MPEG2 W540 H960 F30:1 It C420jpeg"))).toEqual(["interlaced"]);
    expect(y4mProblems(parseY4mHeader("YUV4MPEG2 W540 H960 F30:1 Ip C444"))).toEqual([
      "chroma 444, not 4:2:0",
    ]);
    expect(y4mProblems(parseY4mHeader("YUV4MPEG2 W541 H960 F30:1 Ip C420"))).toEqual(["odd size 541x960"]);
    expect(() => parseY4mHeader("RIFF W1 H1")).toThrow(/YUV4MPEG2/);
    expect(() => parseY4mHeader("YUV4MPEG2 H960 F30:1")).toThrow(/width/);
  });

  it("gives the frame size and the frame count of a file", () => {
    expect(y4mFrameBytes(540, 960)).toBe(540 * 960 * 1.5);
    const header = Buffer.byteLength(line + "\n");
    // Every frame is "FRAME\n" and the 4:2:0 planes.
    const size = header + 10 * (6 + 540 * 960 * 1.5);
    expect(y4mFrameCount(size, header, 540, 960)).toBe(10);
    expect(y4mFrameCount(size + 3, header, 540, 960)).toBe(10);
  });
});

describe("to-y4m (ffmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "azm-g1-y4m-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!hasFfmpeg)("converts a short video into a Y4M file Chromium can play", () => {
    const mp4 = join(dir, "pattern.mp4");
    execFileSync("ffmpeg", [
      ...["-hide_banner", "-loglevel", "error", "-y"],
      ...["-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=0.4"],
      ...["-pix_fmt", "yuv420p", mp4],
    ]);
    const out = join(dir, "pattern.y4m");
    const log = execFileSync(
      "node",
      [join(ROOT, "scripts/smoke/to-y4m.mjs"), mp4, "--out", out, "--fps", "30"],
      {
        encoding: "utf8",
      },
    );
    expect(log).toContain("pattern.y4m");
    const info = readY4mInfo(out);
    expect(info.header).toMatchObject({ width: 320, height: 240, fps: 30, interlace: "p" });
    expect(info.problems).toEqual([]);
    // 0.4 s at 30 fps.
    expect(info.frames).toBe(12);
    expect(statSync(out).size).toBe(info.headerBytes + 12 * (6 + y4mFrameBytes(320, 240)));
    expect(
      readFileSync(out)
        .subarray(info.headerBytes, info.headerBytes + 6)
        .toString(),
    ).toBe("FRAME\n");
  });
});
