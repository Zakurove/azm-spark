/**
 * Step A6 (product v7 contract 1.2 and C-10, section 9, D-024 item 5): focusCameraSession, the camera
 * of the focus check. One camera for the whole check; the pose model is chosen per block by a 2 s
 * probe at the block's setup card: Full when it sustains the block's floor (range 15 fps, gait the
 * data's 25), else Lite on the same camera. The outcome is kept per device for 14 days, so the next
 * check loads one file per block; a miss after a pass in the same check is thermal (Lite to the end of
 * the check, not kept), and thermalFallback() asks for Lite from the next block, never mid attempt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ files: vi.fn(), create: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: mocks.files },
  PoseLandmarker: { createFromOptions: mocks.create },
}));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FocusCameraContext,
  focusCameraSession,
  useFocusCamera,
  MODEL_MEMORY_DAYS,
  MODEL_MEMORY_KEY,
  PROBE_FLOOR_FPS,
  PROBE_MS,
  rememberedModel,
  type FocusCamera,
  type FocusCameraOptions,
  type PoseModel,
} from "../../src/features/focus/camera";
import type { PoseSource } from "../../src/app/poseSource";
import { CHECK_DATA } from "../../src/movements/assessments";
import { GAIT_DATA } from "../../src/movements/gait";
import { ROM_DATA } from "../../src/movements/rom";
import type { Frame } from "../../src/engine/types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 4, 9, 0, 0);

class FakeSource implements PoseSource {
  started = false;
  stopped = false;
  camera: MediaStream | null = null;
  private onFrame: ((f: Frame) => void) | null = null;
  constructor(
    readonly model: PoseModel,
    private stream: () => Promise<MediaStream>,
    readonly kind: "camera" | "trace" = "camera",
  ) {}
  async start(onFrame: (f: Frame) => void): Promise<void> {
    if (this.kind === "camera") this.camera = await this.stream();
    this.started = true;
    this.onFrame = onFrame;
  }
  stop(): void {
    this.stopped = true;
    this.onFrame = null;
  }
  /** Frames at `fps` for `ms`, from `from`. */
  play(fps: number, ms = PROBE_MS + 100, from = 1000): void {
    for (let t = from; t <= from + ms; t += 1000 / fps) this.onFrame?.({ t, lm: [], poses: [] });
  }
  /** Camera frames at `fps`, the model keeping only those `keep` says (a lossy stream). */
  playSome(fps: number, keep: (k: number) => boolean, ms = PROBE_MS + 100, from = 1000): void {
    let k = 0;
    for (let t = from; t <= from + ms; t += 1000 / fps, k++)
      if (keep(k)) this.onFrame?.({ t, lm: [], poses: [] });
  }
}

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

let getUserMedia: ReturnType<typeof vi.fn>;
const track = { stop: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("document", {
    createElement: () => ({ setAttribute: vi.fn(), muted: false, playsInline: false, srcObject: null }),
  });
});
afterEach(() => vi.unstubAllGlobals());

function camera(opts: Partial<FocusCameraOptions> & { kind?: "camera" | "trace" } = {}) {
  const sources: FakeSource[] = [];
  const storage = (opts.storage as MemoryStorage | undefined) ?? new MemoryStorage();
  const cam = focusCameraSession({
    storage,
    now: () => NOW,
    createSource: (_video, stream, model) => {
      const s = new FakeSource(model, stream, opts.kind);
      sources.push(s);
      return s;
    },
    ...opts,
  });
  const release = cam.session.acquire();
  /** Source n runs, and the probe that started it (if any) has gone on to listen for frames. */
  const running = async (n: number) => {
    await vi.waitFor(() => expect(sources[n - 1]?.started).toBe(true));
    await settle();
  };
  return { cam, sources, storage, release, running };
}

/** A turn of the event loop: every pending continuation (a probe starting to listen) has run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const memory = (s: MemoryStorage) => JSON.parse(s.data.get(MODEL_MEMORY_KEY) ?? "{}");

describe("the probe's numbers", () => {
  it("are C-10's: range 15 fps above the engine floor, gait the data's full floor, 2 s, 14 days", () => {
    expect(PROBE_FLOOR_FPS.rom).toBe(15);
    expect(PROBE_FLOOR_FPS.rom).toBeGreaterThan(ROM_DATA.engine.fpsMin);
    expect(PROBE_FLOOR_FPS.gait).toBe(GAIT_DATA.capture.common.processedFps.full);
    expect(PROBE_MS).toBe(2000);
    expect(MODEL_MEMORY_KEY).toBe("azm.poseModel");
    expect(MODEL_MEMORY_DAYS).toBe(14);
  });
});

describe("focusCameraSession", () => {
  it("starts Full on every device and keeps it when the probe sustains the floor", async () => {
    const { cam, sources, storage, running } = camera();
    expect(cam.model).toBe("full");
    await running(1);
    expect(sources[0].model).toBe("full");
    const probe = cam.probe("rom");
    await vi.waitFor(() => expect(sources).toHaveLength(1));
    sources[0].play(30);
    expect(await probe).toEqual({ model: "full", fps: 30, switched: false });
    expect(sources).toHaveLength(1);
    expect(memory(storage)).toEqual({ rom: { model: "full", at: NOW } });
  });

  it("swaps only the pose source for Lite when Full misses the floor, on the same camera", async () => {
    const { cam, sources, storage, running } = camera();
    await running(1);
    const probe = cam.probe("rom");
    await settle();
    sources[0].play(10);
    expect(await probe).toEqual({ model: "lite", fps: 10, switched: true });
    expect(cam.model).toBe("lite");
    expect(sources).toHaveLength(2);
    expect(sources[0].stopped).toBe(true);
    expect(sources[1].model).toBe("lite");
    expect(sources[1].started).toBe(true);
    // The camera opened once and was never closed.
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(sources[1].camera).toBe(sources[0].camera);
    expect(track.stop).not.toHaveBeenCalled();
    // A miss at the range floor is a miss at the higher gait floor too.
    expect(memory(storage)).toEqual({ rom: { model: "lite", at: NOW }, gait: { model: "lite", at: NOW } });
  });

  it("loads one file in the next check: Lite at once while the outcome is under 14 days old", async () => {
    const storage = new MemoryStorage();
    const fetch = vi.fn(async () => new Response(""));
    vi.stubGlobal("fetch", fetch);
    storage.setItem(
      MODEL_MEMORY_KEY,
      JSON.stringify({
        rom: { model: "lite", at: NOW - 13 * DAY },
        gait: { model: "lite", at: NOW - 13 * DAY },
      }),
    );
    const { cam, sources, running } = camera({ storage });
    cam.preload("rom");
    expect(fetch.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["/models/pose_landmarker_lite.task"]);
    expect(cam.model).toBe("lite");
    await running(1);
    expect(sources[0].model).toBe("lite");
    const probe = cam.probe("rom");
    await settle();
    sources[0].play(11);
    expect(await probe).toEqual({ model: "lite", fps: 11, switched: false });
    expect(sources).toHaveLength(1);
  });

  it("tries Full again once the outcome is older than 14 days, or unreadable", () => {
    const storage = new MemoryStorage();
    storage.setItem(MODEL_MEMORY_KEY, JSON.stringify({ rom: { model: "lite", at: NOW - 15 * DAY } }));
    expect(rememberedModel("rom", NOW, storage)).toBeNull();
    expect(camera({ storage }).cam.model).toBe("full");
    storage.setItem(MODEL_MEMORY_KEY, "{not json");
    expect(rememberedModel("rom", NOW, storage)).toBeNull();
    storage.setItem(MODEL_MEMORY_KEY, JSON.stringify({ rom: { model: "heavy", at: NOW } }));
    expect(rememberedModel("rom", NOW, storage)).toBeNull();
    storage.setItem(MODEL_MEMORY_KEY, JSON.stringify({ rom: { model: "lite", at: NOW - DAY } }));
    expect(rememberedModel("rom", NOW, storage)).toBe("lite");
    expect(rememberedModel("gait", NOW, storage)).toBeNull();
  });

  it("chooses per block: Lite for gait under its floor, Full again for the lying range block", async () => {
    const { cam, sources, storage, running } = camera();
    await running(1);
    let probe = cam.probe("rom");
    await settle();
    sources[0].play(20);
    expect(await probe).toEqual({ model: "full", fps: 20, switched: false });
    probe = cam.probe("gait");
    await settle();
    sources[0].play(20, PROBE_MS + 100, 5000);
    expect(await probe).toEqual({ model: "lite", fps: 20, switched: true });
    expect(memory(storage)).toEqual({ rom: { model: "full", at: NOW }, gait: { model: "lite", at: NOW } });
    // The lying block after gait (C-13): Full again, built at the block's start.
    probe = cam.probe("rom");
    await running(3);
    expect(sources[2].model).toBe("full");
    sources[2].play(20, PROBE_MS + 100, 9000);
    expect(await probe).toEqual({ model: "full", fps: 20, switched: false });
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it("reads the mean rate over the window: a model that keeps 3 of 4 frames at 30 fps is Lite for gait (D-026 item 6)", async () => {
    const { cam, sources, running } = camera();
    await running(1);
    const probe = cam.probe("gait");
    await settle();
    sources[0].playSome(30, (k) => k % 4 !== 3);
    const out = await probe;
    expect(out).toMatchObject({ model: "lite", switched: true });
    expect(out.fps!).toBeGreaterThan(22);
    expect(out.fps!).toBeLessThan(23);
  });

  it("treats a miss after a pass in the same check as thermal: Lite to the end, nothing kept", async () => {
    const { cam, sources, storage, running } = camera();
    await running(1);
    let probe = cam.probe("rom");
    await settle();
    sources[0].play(30);
    await probe;
    probe = cam.probe("rom");
    await settle();
    sources[0].play(12, PROBE_MS + 100, 5000);
    expect(await probe).toEqual({ model: "lite", fps: 12, switched: true });
    expect(memory(storage)).toEqual({ rom: { model: "full", at: NOW } });
    // Every later block of the check stays Lite.
    probe = cam.probe("rom");
    await settle();
    sources[1].play(30, PROBE_MS + 100, 9000);
    expect(await probe).toEqual({ model: "lite", fps: 30, switched: false });
    expect(sources).toHaveLength(2);
  });

  it("thermalFallback() changes nothing mid block: Lite from the next probe, nothing kept", async () => {
    const { cam, sources, storage, running } = camera();
    await running(1);
    cam.thermalFallback();
    expect(cam.model).toBe("full");
    expect(sources).toHaveLength(1);
    const probe = cam.probe("rom");
    await running(2);
    expect(sources[1].model).toBe("lite");
    sources[1].play(30, PROBE_MS + 100, 5000);
    expect(await probe).toEqual({ model: "lite", fps: 30, switched: false });
    expect(memory(storage)).toEqual({});
  });

  it("never switches or keeps anything for fixture frames (an E2E source)", async () => {
    const { cam, sources, storage, running } = camera({ kind: "trace" });
    await running(1);
    const probe = cam.probe("gait");
    await settle();
    sources[0].play(15);
    expect(await probe).toEqual({ model: "full", fps: 15, switched: false });
    expect(sources).toHaveLength(1);
    expect(memory(storage)).toEqual({});
  });

  it("measures nothing while the camera is not running, and keeps the model when it fails", async () => {
    const storage = new MemoryStorage();
    const idle = focusCameraSession({
      storage,
      now: () => NOW,
      createSource: () => new FakeSource("full", vi.fn()),
    });
    expect(await idle.probe("rom")).toEqual({ model: "full", fps: null, switched: false });
    const { cam, sources, running } = camera({ storage });
    await running(1);
    const probe = cam.probe("rom");
    await settle();
    sources[0].play(5, 300);
    cam.session.stop();
    expect(await probe).toEqual({ model: "full", fps: 5, switched: false });
    expect(memory(storage)).toEqual({});
  });

  it("works when storage throws (private mode), keeping nothing", async () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const { cam, sources, running } = camera({ storage: storage as unknown as MemoryStorage });
    expect(cam.model).toBe("full");
    await running(1);
    const probe = cam.probe("rom");
    await settle();
    sources[0].play(10);
    expect(await probe).toEqual({ model: "lite", fps: 10, switched: true });
  });
});

describe("the default pose source", () => {
  it("is the camera with two poses and the chosen model, on the session's camera at the gait frame rate", async () => {
    let loop: FrameRequestCallback | undefined;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        loop = cb;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const video = {
      setAttribute: vi.fn(),
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
      currentTime: 1,
      videoWidth: 720,
      videoHeight: 1280,
    };
    vi.stubGlobal("document", { createElement: () => video });
    mocks.files.mockResolvedValue({});
    mocks.create.mockResolvedValue({ close: vi.fn(), detectForVideo: () => ({ landmarks: [] }) });
    const cam = focusCameraSession({ storage: new MemoryStorage(), now: () => NOW });
    const frames: Frame[] = [];
    cam.session.onFrame((f) => frames.push(f));
    cam.session.acquire();
    await vi.waitFor(() => expect(loop).toBeDefined());
    loop!(1);
    expect(frames).toHaveLength(1);
    const options = mocks.create.mock.calls[0][1] as {
      baseOptions: { modelAssetPath: string };
      numPoses: number;
    };
    expect(options.baseOptions.modelAssetPath).toBe("/models/pose_landmarker_full.task");
    expect(options.numPoses).toBe(CHECK_DATA.engine.pose.numPoses);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(getUserMedia.mock.calls[0][0].video.frameRate).toEqual({
      ideal: GAIT_DATA.capture.common.cameraFps,
    });
    cam.session.stop();
    expect(track.stop).toHaveBeenCalled();
  });
});

describe("one focus camera for the screens of a check", () => {
  /** Renders a screen that reads the camera, as C's GaitStep does (2.8.4 gives it no camera prop). */
  function seen(provided: FocusCamera | null): FocusCamera[] {
    const got: FocusCamera[] = [];
    const Screen = () => {
      got.push(useFocusCamera());
      return null;
    };
    const screen = createElement(Screen);
    renderToStaticMarkup(
      provided ? createElement(FocusCameraContext.Provider, { value: provided }, screen) : screen,
    );
    return got;
  }

  it("gives a screen the camera the shell provides", () => {
    const cam = focusCameraSession({ storage: null, now: () => NOW });
    expect(seen(cam)).toEqual([cam]);
  });

  it("makes one for a screen shown on its own", () => {
    const [own] = seen(null);
    expect(own.session).toBeDefined();
    expect(typeof own.probe).toBe("function");
    expect(own.model).toBe("full");
  });
});
