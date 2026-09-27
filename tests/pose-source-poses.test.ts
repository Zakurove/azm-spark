/**
 * CameraPoseSource numPoses (spec 4.0, contract v2 section F): workouts keep one pose, the
 * movement check asks for two and gets every pose on the frame; Frame.lm stays the first pose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ files: vi.fn(), create: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: mocks.files },
  PoseLandmarker: { createFromOptions: mocks.create },
}));

import { CameraPoseSource } from "../src/app/poseSource";
import type { Frame } from "../src/engine/types";

const pose = (x: number, visibility?: number) =>
  Array.from({ length: 33 }, (_, i) => ({
    x,
    y: i / 40,
    z: 0,
    ...(visibility === undefined ? {} : { visibility }),
  }));

let loop: FrameRequestCallback | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.mockResolvedValue({});
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      loop = cb;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) },
  });
});
afterEach(() => vi.unstubAllGlobals());

async function run(result: unknown, opts?: { numPoses?: number }) {
  const detectForVideo = vi.fn(() => result);
  mocks.create.mockResolvedValue({ close: vi.fn(), detectForVideo });
  const video = {
    srcObject: null,
    play: vi.fn().mockResolvedValue(undefined),
    currentTime: 1,
    videoWidth: 720,
    videoHeight: 1280,
  } as unknown as HTMLVideoElement;
  const src = opts ? new CameraPoseSource(video, opts) : new CameraPoseSource(video);
  const frames: Frame[] = [];
  await src.start((f) => frames.push(f));
  loop!(1);
  src.stop();
  return { src, frames, options: mocks.create.mock.calls[0][1] as { numPoses: number } };
}

describe("CameraPoseSource numPoses", () => {
  it("asks the model for one pose by default, as workouts always have", async () => {
    const { src, frames, options } = await run({ landmarks: [pose(0.5, 0.9)] });
    expect(src.numPoses).toBe(1);
    expect(options.numPoses).toBe(1);
    expect(frames[0].poses).toHaveLength(1);
    expect(frames[0].lm).toBe(frames[0].poses![0]);
    expect(frames[0].lm[0]).toEqual({ x: 0.5, y: 0, z: 0, visibility: 0.9 });
    expect(frames[0].aspect).toBeCloseTo(720 / 1280, 9);
  });

  it("asks for two poses for the check and puts both on the frame, lm the first", async () => {
    const world = [pose(0.1)];
    const { frames, options } = await run(
      { landmarks: [pose(0.3), pose(0.7, 0.4)], worldLandmarks: world },
      { numPoses: 2 },
    );
    expect(options.numPoses).toBe(2);
    const f = frames[0];
    expect(f.poses).toHaveLength(2);
    expect(f.lm).toBe(f.poses![0]);
    expect(f.poses![1][0]).toEqual({ x: 0.7, y: 0, z: 0, visibility: 0.4 });
    // A missing visibility counts as seen, as before.
    expect(f.lm[0].visibility).toBe(1);
    expect(f.world![0]).toEqual({ x: 0.1, y: 0, z: 0, visibility: 1 });
  });

  it("never passes on more poses than it asked for", async () => {
    const { frames } = await run({ landmarks: [pose(0.3), pose(0.7)] });
    expect(frames[0].poses).toHaveLength(1);
  });

  it("sends an empty pose and no poses when nobody is found", async () => {
    const { frames } = await run({ landmarks: [] }, { numPoses: 2 });
    expect(frames[0].poses).toEqual([]);
    expect(frames[0].lm).toHaveLength(33);
    expect(frames[0].lm.every((p) => p.visibility === 0)).toBe(true);
  });

  it("falls back to one pose for a count that makes no sense", async () => {
    for (const n of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const video = { videoWidth: 1, videoHeight: 1 } as unknown as HTMLVideoElement;
      expect(new CameraPoseSource(video, { numPoses: n }).numPoses).toBe(1);
    }
    expect(new CameraPoseSource({} as HTMLVideoElement, { numPoses: 2.7 }).numPoses).toBe(2);
  });
});
