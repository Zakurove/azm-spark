/**
 * The camera of the check screens: one pose source for the whole camera sequence (UX spec S34,
 * contract v2 F, v3 K). It is kept across the screens of a test, so the answer screens between the
 * camera parts (S29, S47, S48) can keep watching with `useCameraSession`, and stops a few seconds
 * after the last screen that uses it lets go.
 *
 * Video never leaves the phone: the frames go to the engine in memory and nothing is recorded.
 *
 *   createCheckPoseSource (poseSourceFactory.ts)   the camera with numPoses 2, or on E2E builds
 *                                                  ?e2eFixture= (the camera scripts of e2e/fixtures.ts
 *                                                  are its presets)
 */
import { useEffect, useRef, useState } from "react";
import type { CameraPoseSource, PoseSource } from "../../../app/poseSource";
import type { Frame } from "../../../engine/types";
import { createCheckPoseSource } from "../poseSourceFactory";

export type CamStatus = "idle" | "model" | "camera" | "running" | "error";
/** Why the camera could not run: the flow's S32 kinds, or the model (tracking) failing to load. */
export type CamError = "denied" | "none" | "busy" | "stopped" | "model";

/** The kind of a getUserMedia or model failure (UX spec map 2.9). */
export function cameraErrorOf(err: unknown): CamError {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError")
    return "none";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "model";
}

async function createSource(video: HTMLVideoElement): Promise<PoseSource> {
  return createCheckPoseSource(video);
}

type FrameListener = (f: Frame) => void;
type StatusListener = (s: CamStatus, e: CamError | null) => void;

/** How long the camera stays on after the last screen let go (a screen change between parts). */
const LINGER_MS = 4000;
/** No frame for this long while running: the camera stopped (a lost track, a locked screen). */
const STALL_MS = 4000;

class CameraSession {
  status: CamStatus = "idle";
  error: CamError | null = null;
  video: HTMLVideoElement | null = null;
  lastFrameAt = 0;
  private source: PoseSource | null = null;
  private frames = new Set<FrameListener>();
  private statuses = new Set<StatusListener>();
  private refs = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  /** Starts the camera if needed; the returned function lets go of it. */
  acquire(): () => void {
    this.refs++;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (this.status === "idle" || this.status === "error") void this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs = Math.max(0, this.refs - 1);
      if (this.refs === 0) this.stopTimer = setTimeout(() => this.stop(), LINGER_MS);
    };
  }

  onFrame(fn: FrameListener): () => void {
    this.frames.add(fn);
    return () => this.frames.delete(fn);
  }

  onStatus(fn: StatusListener): () => void {
    this.statuses.add(fn);
    return () => this.statuses.delete(fn);
  }

  /** Try again after an error: a fresh source. */
  restart(): void {
    this.stop();
    if (this.refs > 0) void this.start();
  }

  /** Stops at once (the page was hidden, the flow left the camera). */
  stop(): void {
    this.generation++;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.source?.stop();
    this.source = null;
    if (this.status !== "error") this.set("idle", null);
  }

  /** No frame for a while although the camera runs: it stopped (S34 errors). */
  stalled(now: number): boolean {
    return this.status === "running" && this.lastFrameAt > 0 && now - this.lastFrameAt > STALL_MS;
  }

  private set(status: CamStatus, error: CamError | null): void {
    this.status = status;
    this.error = error;
    for (const fn of this.statuses) fn(status, error);
  }

  private async start(): Promise<void> {
    const gen = ++this.generation;
    this.lastFrameAt = 0;
    if (typeof document === "undefined") return;
    if (!this.video) {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      v.setAttribute("aria-hidden", "true");
      v.className = "s34-video";
      this.video = v;
    }
    this.set("model", null);
    try {
      const source = await createSource(this.video);
      if (gen !== this.generation) return source.stop();
      this.source = source;
      if (source.kind === "camera") {
        (source as CameraPoseSource).onStatus = (s) => {
          if (gen === this.generation && this.status !== "running")
            this.set(s === "model" ? "model" : "camera", null);
        };
      }
      await source.start((f) => {
        if (gen !== this.generation) return;
        this.lastFrameAt = performance.now();
        if (this.status !== "running") this.set("running", null);
        for (const fn of this.frames) fn(f);
      });
      if (gen === this.generation && this.status !== "running" && source.kind !== "camera")
        this.set("running", null);
    } catch (err) {
      if (gen !== this.generation) return;
      this.source?.stop();
      this.source = null;
      this.set("error", cameraErrorOf(err));
    }
  }
}

/** The one camera of the check. */
export const cameraSession = new CameraSession();

export interface CameraSessionState {
  status: CamStatus;
  error: CamError | null;
  video: HTMLVideoElement | null;
  /** A frame source without a picture (the E2E scripts): the skeleton is drawn on the page colour. */
  hasPicture: boolean;
}

/**
 * Uses the check's camera while the calling screen is shown; `onFrame` gets every frame. `enabled`
 * false (the E2E review screenshots) never starts it.
 */
export function useCameraSession(onFrame: (f: Frame) => void, enabled = true): CameraSessionState {
  const cb = useRef(onFrame);
  cb.current = onFrame;
  const [state, setState] = useState<{ status: CamStatus; error: CamError | null }>({
    status: cameraSession.status,
    error: cameraSession.error,
  });
  useEffect(() => {
    if (!enabled) return;
    const offStatus = cameraSession.onStatus((status, error) => setState({ status, error }));
    const offFrame = cameraSession.onFrame((f) => cb.current(f));
    const release = cameraSession.acquire();
    setState({ status: cameraSession.status, error: cameraSession.error });
    return () => {
      offStatus();
      offFrame();
      release();
    };
  }, [enabled]);
  const video = cameraSession.video;
  return { ...state, video, hasPicture: !!video?.srcObject };
}
