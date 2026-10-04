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
 *
 * `CameraSession` is exported for the v7 focus check (product v7 contract 7, C-10): a session is
 * built from a pose source factory, and the focus check's (src/features/focus/camera.ts) borrows the
 * session's camera, so it can replace a Full source with a Lite one without closing the camera.
 */
import { useEffect, useRef, useState } from "react";
import { openCamera, type CameraPoseSource, type PoseSource } from "../../../app/poseSource";
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

/**
 * Builds the pose source of a camera session. `stream` is the session's camera: it opens it on the
 * first call and gives the same open stream after, until the session stops, so a source that borrows
 * it (CameraPoseOptions.stream) can be replaced without closing the camera (`replaceSource`). A source
 * calls it only after its model has loaded, so leaving during the download never asks for the camera.
 * A factory that never calls it (the check's own) leaves the camera to its source, as before.
 */
export type PoseSourceFactory = (
  video: HTMLVideoElement,
  stream: () => Promise<MediaStream>,
) => PoseSource | Promise<PoseSource>;

export interface CameraSessionOptions {
  /** Constraints added to the session's camera (openCamera), for the sources that borrow it. */
  camera?: MediaTrackConstraints;
}

type FrameListener = (f: Frame) => void;
type StatusListener = (s: CamStatus, e: CamError | null) => void;

/** How long the camera stays on after the last screen let go (a screen change between parts). */
const LINGER_MS = 4000;
/** No frame for this long while running: the camera stopped (a lost track, a locked screen). */
const STALL_MS = 4000;

export class CameraSession {
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
  /** The session's own camera, once a source borrowed it; kept until the session stops. */
  private camera: Promise<MediaStream> | null = null;
  /** The same camera once open, so stop() closes it at once. */
  private cameraStream: MediaStream | null = null;
  private cameraGeneration = 0;

  constructor(
    private readonly createSource: PoseSourceFactory,
    private readonly options: CameraSessionOptions = {},
  ) {}

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
    this.closeCamera();
    if (this.status !== "error") this.set("idle", null);
  }

  /**
   * A new pose source from the factory in place of the running one, on the same camera (the focus
   * check's Lite fallback, product v7 C-10). The listeners stay; the status shows the model loading
   * until the new source's first frame. Idle or after an error there is nothing to replace: the next
   * start builds from the factory anyway.
   */
  async replaceSource(): Promise<void> {
    if (this.status === "idle" || this.status === "error") return;
    this.source?.stop();
    this.source = null;
    await this.start();
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

  /** The session's camera for a source that borrows it: opened once, then the same stream. */
  private readonly openStream = (): Promise<MediaStream> => {
    if (!this.camera) {
      const generation = this.cameraGeneration;
      const opening = openCamera(this.options.camera).then((stream) => {
        if (generation === this.cameraGeneration) {
          this.cameraStream = stream;
          return stream;
        }
        // The session stopped while the camera was opening (a permission prompt): close it at once.
        stream.getTracks().forEach((tr) => tr.stop());
        throw new DOMException("The camera session stopped", "AbortError");
      });
      this.camera = opening;
      // A camera that did not open (refused, busy) is asked for again on the next call.
      opening.catch(() => {
        if (this.camera === opening) this.camera = null;
      });
    }
    return this.camera;
  };

  /** Closes the session's camera; one still opening is closed when it opens (openStream). */
  private closeCamera(): void {
    this.cameraGeneration++;
    const stream = this.cameraStream;
    const opened = this.camera !== null;
    this.camera = null;
    this.cameraStream = null;
    if (!opened) return;
    if (this.video) this.video.srcObject = null;
    stream?.getTracks().forEach((tr) => tr.stop());
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
      const source = await this.createSource(this.video, this.openStream);
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
      this.closeCamera();
      this.set("error", cameraErrorOf(err));
    }
  }
}

/** The one camera of the check. */
export const cameraSession = new CameraSession((video) => createCheckPoseSource(video));

export interface CameraSessionState {
  status: CamStatus;
  error: CamError | null;
  video: HTMLVideoElement | null;
  /** A frame source without a picture (the E2E scripts): the skeleton is drawn on the page colour. */
  hasPicture: boolean;
}

/**
 * Uses the check's camera (or `session`, the focus check's) while the calling screen is shown;
 * `onFrame` gets every frame. `enabled` false (the E2E review screenshots) never starts it.
 */
export function useCameraSession(
  onFrame: (f: Frame) => void,
  enabled = true,
  session: CameraSession = cameraSession,
): CameraSessionState {
  const cb = useRef(onFrame);
  cb.current = onFrame;
  const [state, setState] = useState<{ status: CamStatus; error: CamError | null }>({
    status: session.status,
    error: session.error,
  });
  useEffect(() => {
    if (!enabled) return;
    const offStatus = session.onStatus((status, error) => setState({ status, error }));
    const offFrame = session.onFrame((f) => cb.current(f));
    const release = session.acquire();
    setState({ status: session.status, error: session.error });
    return () => {
      offStatus();
      offFrame();
      release();
    };
  }, [enabled, session]);
  const video = session.video;
  return { ...state, video, hasPicture: !!video?.srcObject };
}
