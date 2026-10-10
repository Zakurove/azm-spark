/**
 * D-038 item 2 in the camera source (app/poseSource.ts, CameraPoseOptions.looks): the looks of every
 * pose, read from a small copy of the picture 4 times a second (LOOK_SAMPLE), and the model made to
 * look for people again (REDETECT) when the screen's lock misses its person while the people the model
 * follows take every place it has. The model and the picture are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ files: vi.fn(), create: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: mocks.files },
  PoseLandmarker: { createFromOptions: mocks.create },
}));

import { CameraPoseSource, LOOK_SAMPLE, REDETECT } from "../src/app/poseSource";
import { markSubject } from "../src/engine/subject";
import type { Frame } from "../src/engine/types";
import { person } from "./fixtures/people";

const ASPECT = 720 / 1280;
let loop: FrameRequestCallback | undefined;
let now = 0;
/** Every canvas the source made (the look copy and the empty picture). */
let canvases: { width: number; height: number; drawn: number }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  canvases = [];
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
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("document", {
    createElement: () => {
      const c = { width: 0, height: 0, drawn: 0 };
      canvases.push(c);
      return Object.assign(c, {
        getContext: () => ({
          fillStyle: "",
          fillRect: () => undefined,
          drawImage: () => {
            c.drawn++;
          },
          // A grey picture with a dark coat where the first person stands.
          getImageData: (_x: number, _y: number, w: number, h: number) => {
            const data = new Uint8ClampedArray(w * h * 4).fill(150);
            for (let y = 0; y < h; y++)
              for (let x = 0; x < w * 0.5; x++) data.set([30, 30, 40, 255], (y * w + x) * 4);
            return { data };
          },
        }),
      });
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function start(opts: { numPoses: number; looks?: boolean }, onFrame: (f: Frame) => void) {
  const people = [person({ x: 0.3, height: 0.6 }, ASPECT), person({ x: 0.75, height: 0.55 }, ASPECT)];
  const detectForVideo = vi.fn(() => ({ landmarks: people.slice(0, opts.numPoses) }));
  mocks.create.mockResolvedValue({ close: vi.fn(), detectForVideo });
  const video = {
    srcObject: null,
    play: vi.fn().mockResolvedValue(undefined),
    currentTime: 0,
    videoWidth: 720,
    videoHeight: 1280,
  };
  const src = new CameraPoseSource(video as unknown as HTMLVideoElement, opts);
  await src.start(onFrame);
  /** Runs the loop for `ms` of 33 ms camera frames. */
  const play = (ms: number) => {
    for (const end = now + ms; now < end; now += 33) {
      video.currentTime += 1 / 30;
      loop!(now);
    }
  };
  return { src, detectForVideo, video, play };
}

describe("the looks (D-038 item 2)", () => {
  it("come with every pose a few times a second, read from a small copy of the picture", async () => {
    const frames: Frame[] = [];
    const { src, play } = await start({ numPoses: 2, looks: true }, (f) => frames.push(f));
    play(2000);
    src.stop();
    const sampled = frames.filter((f) => f.looks);
    // About every LOOK_SAMPLE.everyMs (the frames' clock).
    expect(sampled.length).toBeGreaterThanOrEqual(Math.floor(2000 / LOOK_SAMPLE.everyMs) - 1);
    expect(sampled.length).toBeLessThanOrEqual(Math.ceil(2000 / LOOK_SAMPLE.everyMs) + 1);
    for (const f of sampled) expect(f.looks).toHaveLength(f.poses!.length);
    // The picture is copied small (its width LOOK_SAMPLE.width), once a sample.
    const copy = canvases.find((c) => c.drawn > 0)!;
    expect(copy.width).toBe(LOOK_SAMPLE.width);
    expect(copy.drawn).toBe(sampled.length);
    // The first person in the dark coat, the second in grey: two different looks.
    const [a, b] = sampled[0].looks!;
    expect(a?.torso?.[0]).toBeLessThan(60);
    expect(b?.torso?.[0]).toBe(150);
  });

  it("are never read without the option (the v1 check)", async () => {
    const frames: Frame[] = [];
    const { src, play } = await start({ numPoses: 2 }, (f) => frames.push(f));
    play(1000);
    src.stop();
    expect(frames.some((f) => f.looks)).toBe(false);
    expect(canvases).toHaveLength(0);
  });
});

describe("looking for people again in a crowd (REDETECT)", () => {
  it("every place taken and the lock's person not among them: an empty picture to the model, at most once a second", async () => {
    const { src, detectForVideo, video, play } = await start({ numPoses: 2, looks: true }, (f) =>
      markSubject(f, -1),
    );
    play(3000);
    src.stop();
    const blanks = detectForVideo.mock.calls.filter((c) => (c as unknown[])[0] !== video);
    // After REDETECT.afterMs, then every REDETECT.everyMs.
    expect(blanks.length).toBeGreaterThanOrEqual(2);
    expect(blanks.length).toBeLessThanOrEqual(Math.ceil(3000 / REDETECT.everyMs));
    const times = blanks.map((c) => (c as unknown[])[1] as number);
    expect(times[0]).toBeGreaterThanOrEqual(REDETECT.afterMs);
    for (let i = 1; i < times.length; i++)
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(REDETECT.everyMs - 40);
    // Each empty picture goes just before a camera frame, its time a moment earlier.
    const calls = detectForVideo.mock.calls as unknown as [unknown, number][];
    calls.forEach((c, k) => {
      if (c[0] === video) return;
      expect(calls[k + 1][0]).toBe(video);
      expect(calls[k + 1][1]).toBeGreaterThan(c[1]);
    });
  });

  it("never while the lock sees its person, nor while the model has a free place", async () => {
    const seen = await start({ numPoses: 2, looks: true }, (f) => markSubject(f, 0));
    seen.play(3000);
    seen.src.stop();
    expect(seen.detectForVideo.mock.calls.every((c) => (c as unknown[])[0] === seen.video)).toBe(true);
    const free = await start({ numPoses: 3, looks: true }, (f) => markSubject(f, -1));
    free.play(3000);
    free.src.stop();
    expect(free.detectForVideo.mock.calls.every((c) => (c as unknown[])[0] === free.video)).toBe(true);
  });
});
