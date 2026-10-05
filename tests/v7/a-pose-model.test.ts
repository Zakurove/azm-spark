/**
 * D-026 item 6 (change log GG-1): the pose model file is fetched once and shared between the preload
 * and the pose source, and the source takes the CPU only on a real GPU error.
 *
 * G1 saw the setup card's preload and the source's own model load fetch the 9.4 MB file at once;
 * Chromium failed one of them (ERR_CACHE_WRITE_FAILURE), and the source read that failure as no GPU
 * and ran the model on the CPU, slower and recorded nowhere. Now:
 *   - the source takes the preload's bytes (modelAssetBuffer), waiting for a preload still running,
 *     so the file is never fetched twice at once; with no preload, or one that failed, MediaPipe loads
 *     the file itself (modelAssetPath), as before;
 *   - a file that did not load (the model, the WebAssembly loader or its binary) is no reason for the
 *     CPU: the source fails, and the camera screens offer to try again;
 *   - the delegate that loaded, and why the GPU did not, reach the perf data (the ?perf=1 overlay and
 *     the smoke page read the same hooks).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ files: vi.fn(), create: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: mocks.files },
  PoseLandmarker: { createFromOptions: mocks.create },
}));

import { PoseLandmarker } from "@mediapipe/tasks-vision";
import { CameraPoseSource, isLoadError, preloadPoseAssets } from "../../src/app/poseSource";
import { PerfMeter } from "../../src/features/smoke/perf";
import { attachMeter, type ProbeEnv } from "../../src/features/smoke/perfProbe";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const video = () =>
  ({
    srcObject: null,
    play: vi.fn().mockResolvedValue(undefined),
    currentTime: 1,
    videoWidth: 720,
    videoHeight: 1280,
  }) as unknown as HTMLVideoElement;

const landmarker = () => ({ close: vi.fn(), detectForVideo: () => ({ landmarks: [] }) });

type Options = {
  baseOptions: { modelAssetPath?: string; modelAssetBuffer?: Uint8Array; delegate: "GPU" | "CPU" };
};
const created = () => mocks.create.mock.calls.map((c) => (c[1] as Options).baseOptions);

/** The model file as the server sends it. */
const FILE = new Uint8Array([7, 1, 7, 2, 7, 3]);
let fetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.mockResolvedValue({});
  mocks.create.mockImplementation(async () => landmarker());
  fetch = vi.fn(async () => new Response(FILE.slice()));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("one fetch of the model file, shared by the preload and the source", () => {
  it("loads the preload's bytes instead of fetching the file again", async () => {
    preloadPoseAssets("full");
    const src = new CameraPoseSource(video(), { model: "full" });
    await src.start(vi.fn());
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(["/models/pose_landmarker_full.task"]);
    expect(created()).toHaveLength(1);
    expect(created()[0].modelAssetPath).toBeUndefined();
    expect([...created()[0].modelAssetBuffer!]).toEqual([...FILE]);
    expect(created()[0].delegate).toBe("GPU");
    src.stop();
  });

  it("waits for a preload still downloading when the camera opens, and never fetches a second time", async () => {
    const download = deferred<Response>();
    fetch.mockImplementationOnce(() => download.promise);
    preloadPoseAssets("lite");
    const src = new CameraPoseSource(video(), { model: "lite" });
    const run = src.start(vi.fn());
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.create).not.toHaveBeenCalled();
    download.resolve(new Response(FILE.slice()));
    await run;
    expect(fetch).toHaveBeenCalledOnce();
    expect([...created()[0].modelAssetBuffer!]).toEqual([...FILE]);
    src.stop();
  });

  it("takes a preload once: a later source of the same model loads the file itself", async () => {
    preloadPoseAssets("full");
    const first = new CameraPoseSource(video(), { model: "full" });
    await first.start(vi.fn());
    first.stop();
    const second = new CameraPoseSource(video(), { model: "full" });
    await second.start(vi.fn());
    second.stop();
    expect(fetch).toHaveBeenCalledOnce();
    expect(created()[1]).toMatchObject({ modelAssetPath: "/models/pose_landmarker_full.task" });
    expect(created()[1].modelAssetBuffer).toBeUndefined();
  });

  it("leaves the file to MediaPipe after a failed preload, one fetch at a time", async () => {
    fetch.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    preloadPoseAssets("full");
    await new Promise((r) => setTimeout(r, 0));
    const src = new CameraPoseSource(video(), { model: "full" });
    await src.start(vi.fn());
    expect(created()).toEqual([
      expect.objectContaining({ modelAssetPath: "/models/pose_landmarker_full.task", delegate: "GPU" }),
    ]);
    src.stop();
  });

  it("starts one download for two preloads of the same file", () => {
    preloadPoseAssets("lite");
    preloadPoseAssets("lite");
    expect(fetch).toHaveBeenCalledOnce();
    // Taken by a source, so the next test starts clean.
    return new CameraPoseSource(video(), { model: "lite" }).start(vi.fn());
  });

  it("never fetches or opens the camera for a source stopped while the preload downloads", async () => {
    const download = deferred<Response>();
    fetch.mockImplementationOnce(() => download.promise);
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    preloadPoseAssets("full");
    const src = new CameraPoseSource(video(), { model: "full" });
    const run = src.start(vi.fn());
    await new Promise((r) => setTimeout(r, 0));
    src.stop();
    download.resolve(new Response(FILE.slice()));
    await run;
    expect(mocks.create).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("the CPU only on a real GPU error", () => {
  const LOAD_FAILURES: [string, unknown][] = [
    ["Chromium's failed fetch", new TypeError("Failed to fetch")],
    ["WebKit's failed fetch", new TypeError("Load failed")],
    ["Gecko's failed fetch", new TypeError("NetworkError when attempting to fetch resource.")],
    ["MediaPipe's model fetch", new Error("Failed to fetch model: /models/pose_landmarker_full.task (503)")],
    [
      "the WebAssembly binary",
      new Error(
        "Aborted(both async and sync fetching of the wasm failed). Build with -sASSERTIONS for more info.",
      ),
    ],
    ["the WebAssembly loader script", new Event("error")],
  ];

  it.each(LOAD_FAILURES)("reads %s as a file that did not load", (_name, err) => {
    expect(isLoadError(err)).toBe(true);
  });

  it.each([
    "Failed to obtain WebGL context from the provided canvas. `getContext()` should only be invoked with `webgl` or `webgl2`.",
    "Couldn't create webGL 2 context.",
    "emscripten_webgl_create_context() returned error 0",
    "Cannot read properties of null (reading 'getExtension')",
  ])("reads a GPU failure as one: %s", (message) => {
    expect(isLoadError(new Error(message))).toBe(false);
  });

  it.each(LOAD_FAILURES)("fails without the CPU when %s does not load", async (_name, err) => {
    mocks.create.mockImplementationOnce(async () => {
      throw err;
    });
    const src = new CameraPoseSource(video(), { model: "full" });
    await expect(src.start(vi.fn())).rejects.toBe(err);
    expect(created().map((o) => o.delegate)).toEqual(["GPU"]);
  });

  it("takes the CPU, with the same bytes, when the GPU itself fails", async () => {
    mocks.create.mockImplementationOnce(async () => {
      throw new Error("Failed to obtain WebGL context from the provided canvas.");
    });
    preloadPoseAssets("full");
    const src = new CameraPoseSource(video(), { model: "full" });
    await src.start(vi.fn());
    expect(created().map((o) => o.delegate)).toEqual(["GPU", "CPU"]);
    expect([...created()[1].modelAssetBuffer!]).toEqual([...FILE]);
    expect(created()[1].modelAssetBuffer).toBe(created()[0].modelAssetBuffer);
    expect(fetch).toHaveBeenCalledOnce();
    src.stop();
  });
});

describe("the delegate in the perf data", () => {
  function env(): ProbeEnv {
    return {
      poseProto: null,
      poseClass: PoseLandmarker as unknown as ProbeEnv["poseClass"],
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      observe: () => null,
      every: () => () => undefined,
      heapMB: () => null,
    };
  }

  it("records the GPU when it loads", async () => {
    const meter = new PerfMeter();
    const detach = attachMeter(meter, env());
    const src = new CameraPoseSource(video(), { model: "lite" });
    await src.start(vi.fn());
    await Promise.resolve();
    expect(meter.snapshot()).toMatchObject({ delegate: "GPU", delegateError: null });
    src.stop();
    detach();
  });

  it("records the CPU and why the GPU failed", async () => {
    mocks.create.mockImplementationOnce(async () => {
      throw new Error("Couldn't create webGL 2 context.");
    });
    const meter = new PerfMeter();
    const detach = attachMeter(meter, env());
    const src = new CameraPoseSource(video(), { model: "lite" });
    await src.start(vi.fn());
    await Promise.resolve();
    expect(meter.snapshot()).toMatchObject({
      delegate: "CPU",
      delegateError: "GPU: Couldn't create webGL 2 context.",
    });
    src.stop();
    detach();
  });

  it("records a file that did not load as the GPU's failure, and no CPU", async () => {
    mocks.create.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    const meter = new PerfMeter();
    const detach = attachMeter(meter, env());
    const src = new CameraPoseSource(video(), { model: "lite" });
    await expect(src.start(vi.fn())).rejects.toThrow("Failed to fetch");
    await Promise.resolve();
    expect(meter.snapshot()).toMatchObject({ delegate: null, delegateError: "GPU: Failed to fetch" });
    detach();
  });
});
