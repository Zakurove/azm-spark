/**
 * Step A6 (product v7 contract 7 and C-10, D-024 item 5): CameraPoseSource takes the pose model to
 * load (`CameraPoseOptions.model`) and a camera it borrows (`CameraPoseOptions.stream`), so the focus
 * check's camera session can replace a Full source with a Lite one and keep the camera open. Without
 * the options the source is the v1 one: phones load Lite, other devices Full, and the source opens
 * and closes its own camera after its model (tests/camera-lifecycle.test.ts and
 * tests/pose-source-poses.test.ts hold as written).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ files: vi.fn(), create: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: mocks.files },
  PoseLandmarker: { createFromOptions: mocks.create },
}));

import { CameraPoseSource, poseModelUrl, preloadPoseAssets } from "../../src/app/poseSource";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const video = () =>
  ({
    srcObject: null,
    play: vi.fn().mockResolvedValue(undefined),
    currentTime: 1,
    videoWidth: 720,
    videoHeight: 1280,
  }) as unknown as HTMLVideoElement;

/** A phone (coarse pointer) or a desktop (fine pointer). */
const pointer = (coarse: boolean) =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: coarse })),
  );

const track = () => ({ stop: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.mockResolvedValue({});
  mocks.create.mockResolvedValue({ close: vi.fn(), detectForVideo: () => ({ landmarks: [] }) });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

const loaded = () =>
  (mocks.create.mock.calls[0][1] as { baseOptions: { modelAssetPath: string } }).baseOptions;

describe("CameraPoseOptions.model", () => {
  it("loads the model it is given on any device", async () => {
    for (const [coarse, model] of [
      [true, "full"],
      [false, "lite"],
      [true, "lite"],
      [false, "full"],
    ] as const) {
      vi.clearAllMocks();
      pointer(coarse);
      vi.stubGlobal("navigator", {
        mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track()] }) },
      });
      const src = new CameraPoseSource(video(), { model });
      expect(src.model).toBe(model);
      await src.start(vi.fn());
      expect(loaded().modelAssetPath).toBe(`/models/pose_landmarker_${model}.task`);
      src.stop();
    }
  });

  it("keeps the v1 choice without it: Lite on a phone, Full elsewhere", async () => {
    for (const [coarse, model] of [
      [true, "lite"],
      [false, "full"],
    ] as const) {
      vi.clearAllMocks();
      pointer(coarse);
      vi.stubGlobal("navigator", {
        mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track()] }) },
      });
      expect(poseModelUrl()).toBe(`/models/pose_landmarker_${model}.task`);
      const src = new CameraPoseSource(video());
      expect(src.model).toBe(model);
      await src.start(vi.fn());
      expect(loaded().modelAssetPath).toBe(`/models/pose_landmarker_${model}.task`);
      src.stop();
    }
  });

  it("names the file of a model, and preloads the one asked for", () => {
    pointer(true);
    expect(poseModelUrl("full")).toBe("/models/pose_landmarker_full.task");
    expect(poseModelUrl("lite")).toBe("/models/pose_landmarker_lite.task");
    const fetch = vi.fn((_url: string) => Promise.resolve(new Response("")));
    vi.stubGlobal("fetch", fetch);
    preloadPoseAssets("full");
    preloadPoseAssets();
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      "/models/pose_landmarker_full.task",
      "/models/pose_landmarker_lite.task",
    ]);
  });
});

describe("CameraPoseOptions.stream (a borrowed camera)", () => {
  it("uses the camera it is given, after its model, and never opens its own", async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const order: string[] = [];
    mocks.create.mockImplementation(async () => {
      order.push("model");
      return { close: vi.fn(), detectForVideo: () => ({ landmarks: [] }) };
    });
    const camera = { getTracks: () => [track()] } as unknown as MediaStream;
    const stream = vi.fn(async () => {
      order.push("camera");
      return camera;
    });
    const v = video();
    const src = new CameraPoseSource(v, { model: "full", stream });
    await src.start(vi.fn());
    expect(order).toEqual(["model", "camera"]);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(v.srcObject).toBe(camera);
    expect(v.play).toHaveBeenCalled();
  });

  it("leaves the borrowed camera running and on the video when it stops", async () => {
    const tracks = [track(), track()];
    const camera = { getTracks: () => tracks } as unknown as MediaStream;
    const close = vi.fn();
    mocks.create.mockResolvedValue({ close, detectForVideo: () => ({ landmarks: [] }) });
    const v = video();
    const src = new CameraPoseSource(v, { model: "lite", stream: async () => camera });
    await src.start(vi.fn());
    src.stop();
    expect(close).toHaveBeenCalledOnce();
    for (const t of tracks) expect(t.stop).not.toHaveBeenCalled();
    expect(v.srcObject).toBe(camera);
  });

  it("never asks for the camera after leaving during the model download", async () => {
    const model = deferred<any>();
    mocks.create.mockReturnValue(model.promise);
    const stream = vi.fn();
    const src = new CameraPoseSource(video(), { model: "full", stream });
    const run = src.start(vi.fn());
    await Promise.resolve();
    src.stop();
    const close = vi.fn();
    model.resolve({ close });
    await run;
    expect(close).toHaveBeenCalledOnce();
    expect(stream).not.toHaveBeenCalled();
  });

  it("does not take a camera that arrives after it stopped, and leaves it to its owner", async () => {
    const arrives = deferred<MediaStream>();
    const stop = vi.fn();
    const v = video();
    const src = new CameraPoseSource(v, { model: "full", stream: () => arrives.promise });
    const run = src.start(vi.fn());
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalled());
    await Promise.resolve();
    src.stop();
    arrives.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await run;
    expect(stop).not.toHaveBeenCalled();
    expect(v.srcObject).toBe(null);
  });
});
