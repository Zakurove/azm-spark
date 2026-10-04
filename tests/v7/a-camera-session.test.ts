/**
 * Step A6 (product v7 contract 7 and C-10, D-024 item 5): the camera session of the check is the
 * exported `CameraSession`, built from a pose source factory. The factory gets the session's camera
 * as `stream()`: opened on the first call, the same open stream after, until the session stops. So a
 * source that borrows it can be replaced (`replaceSource`, the focus check's Lite fallback) without
 * closing the camera, and a factory that never calls it (the check's own, `cameraSession`) leaves the
 * camera to its source exactly as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CameraSession,
  cameraSession,
  type PoseSourceFactory,
} from "../../src/features/assessment/camera/session";
import type { PoseSource } from "../../src/app/poseSource";
import type { Frame } from "../../src/engine/types";

/** A source that plays frames on demand (`emit`), and borrows the session's camera when asked to. */
class FakeSource implements PoseSource {
  kind: "camera" | "trace";
  started = false;
  stopped = false;
  camera: MediaStream | null = null;
  private onFrame: ((f: Frame) => void) | null = null;
  constructor(
    readonly label: string,
    private stream: (() => Promise<MediaStream>) | null,
    kind: "camera" | "trace" = "camera",
  ) {
    this.kind = kind;
  }
  async start(onFrame: (f: Frame) => void): Promise<void> {
    if (this.stream) this.camera = await this.stream();
    this.started = true;
    this.onFrame = onFrame;
  }
  stop(): void {
    this.stopped = true;
    this.onFrame = null;
  }
  emit(t: number): void {
    this.onFrame?.({ t, lm: [], poses: [] });
  }
}

const track = () => ({ stop: vi.fn() });
let getUserMedia: ReturnType<typeof vi.fn>;
let opened: { getTracks: () => { stop: ReturnType<typeof vi.fn> }[] }[];

beforeEach(() => {
  opened = [];
  getUserMedia = vi.fn(async () => {
    const tracks = [track()];
    const stream = { getTracks: () => tracks };
    opened.push(stream);
    return stream;
  });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("document", {
    createElement: () => ({ setAttribute: vi.fn(), muted: false, playsInline: false, srcObject: null }),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A session whose factory borrows the camera (`borrow`) and keeps every source it built. */
function session(borrow = true, kind: "camera" | "trace" = "camera") {
  const sources: FakeSource[] = [];
  const factory: PoseSourceFactory = (_video, stream) => {
    const s = new FakeSource(`s${sources.length + 1}`, borrow ? stream : null, kind);
    sources.push(s);
    return s;
  };
  return { s: new CameraSession(factory), sources };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("CameraSession", () => {
  it("is the check's camera, built from the check's own source factory", () => {
    expect(cameraSession).toBeInstanceOf(CameraSession);
    expect(cameraSession.status).toBe("idle");
  });

  it("leaves the camera to a source that does not borrow it: the session opens none", async () => {
    const { s, sources } = session(false);
    const frames: number[] = [];
    s.onFrame((f) => frames.push(f.t));
    const release = s.acquire();
    await vi.waitFor(() => expect(sources[0]?.started).toBe(true));
    sources[0].emit(5);
    expect(frames).toEqual([5]);
    expect(s.status).toBe("running");
    expect(getUserMedia).not.toHaveBeenCalled();
    release();
    s.stop();
    expect(sources[0].stopped).toBe(true);
    expect(s.status).toBe("idle");
  });

  it("opens its camera once for the sources that borrow it, and keeps it across a replaced source", async () => {
    const { s, sources } = session();
    const frames: string[] = [];
    const statuses: string[] = [];
    s.onFrame((f) => frames.push(`${f.t}`));
    s.onStatus((st) => statuses.push(st));
    s.acquire();
    await vi.waitFor(() => expect(sources[0]?.started).toBe(true));
    sources[0].emit(1);
    expect(getUserMedia).toHaveBeenCalledOnce();
    const camera = sources[0].camera;
    expect(camera).toBe(opened[0]);

    await s.replaceSource();
    expect(sources).toHaveLength(2);
    expect(sources[0].stopped).toBe(true);
    expect(sources[1].started).toBe(true);
    // The same camera, never closed, never opened again.
    expect(sources[1].camera).toBe(camera);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(opened[0].getTracks()[0].stop).not.toHaveBeenCalled();
    // The old source's frames no longer count; the new one's reach the same listeners.
    sources[0].emit(2);
    sources[1].emit(3);
    expect(frames).toEqual(["1", "3"]);
    // The model loads again (status model) before the new source runs.
    expect(statuses.slice(-2)).toEqual(["model", "running"]);
  });

  it("closes its camera when it stops, and opens a fresh one on restart", async () => {
    const { s, sources } = session();
    s.acquire();
    await vi.waitFor(() => expect(sources[0]?.started).toBe(true));
    s.stop();
    expect(opened[0].getTracks()[0].stop).toHaveBeenCalledOnce();
    expect(s.video?.srcObject).toBe(null);
    s.acquire();
    await vi.waitFor(() => expect(sources[1]?.started).toBe(true));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(sources[1].camera).toBe(opened[1]);
  });

  it("closes a camera that opens after the session stopped (a permission prompt answered late)", async () => {
    let answer!: () => void;
    const tracks = [track()];
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ getTracks: () => tracks });
        }),
    );
    const { s, sources } = session();
    s.acquire();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    s.stop();
    answer();
    await settle();
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(sources[0].started).toBe(false);
    expect(s.status).toBe("idle");
  });

  it("asks for the camera again after it was refused", async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    const { s, sources } = session();
    s.acquire();
    await vi.waitFor(() => expect(s.status).toBe("error"));
    expect(s.error).toBe("denied");
    s.restart();
    await vi.waitFor(() => expect(sources[1]?.started).toBe(true));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(s.status).toBe("model");
    sources[1].emit(1);
    expect(s.status).toBe("running");
  });

  it("replaces nothing while it is idle: the next start builds from the factory", async () => {
    const { s, sources } = session();
    await s.replaceSource();
    expect(sources).toHaveLength(0);
    expect(s.status).toBe("idle");
  });

  it("asks the camera for the session's constraints", async () => {
    const sources: FakeSource[] = [];
    const s = new CameraSession(
      (_v, stream) => {
        const src = new FakeSource("s", stream);
        sources.push(src);
        return src;
      },
      { camera: { frameRate: { ideal: 30 } } },
    );
    s.acquire();
    await vi.waitFor(() => expect(sources[0]?.started).toBe(true));
    expect(getUserMedia.mock.calls[0][0]).toEqual({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user", frameRate: { ideal: 30 } },
      audio: false,
    });
  });
});
