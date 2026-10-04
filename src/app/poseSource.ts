import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { sanitizePose } from "../engine/body";
import { Frame, Landmark } from "../engine/types";
import { TRACES, TraceOpts } from "../engine/traces";

/** A source of pose frames: real camera+model, or synthetic trace playback (demo/offline/tests). */
export interface PoseSource {
  start(onFrame: (f: Frame) => void): Promise<void>;
  stop(): void;
  /** the element to paint behind the overlay, if any */
  video?: HTMLVideoElement;
  kind: "camera" | "trace";
}

export type CameraStatus = "model" | "camera";

const coarsePointer = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
/** Phones get the lite model: roughly 40% smaller and fast enough on mobile GPUs. */
const defaultModel = (): "lite" | "full" => (coarsePointer() ? "lite" : "full");
/** The file of a pose model; without one, the v1 choice (Lite on a phone, Full elsewhere). */
export const poseModelUrl = (model: "lite" | "full" = defaultModel()) =>
  `/models/pose_landmarker_${model}.task`;

/**
 * Warms the HTTP cache while the person reads the setup guide, so the session starts quickly. Without
 * a model, the one the v1 choice loads.
 */
export function preloadPoseAssets(model?: "lite" | "full") {
  try {
    void fetch(poseModelUrl(model)).catch(() => undefined);
  } catch {
    /* offline or unsupported */
  }
}

/**
 * Opens the front camera as every camera source of the app does; `video` adds constraints (the
 * focus check asks for the frame rate of its gait capture).
 */
export function openCamera(video: MediaTrackConstraints = {}): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user", ...video },
    audio: false,
  });
}

const emptyFrame = (t: number, aspect?: number): Frame => ({
  t,
  lm: Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 })),
  aspect,
});

/** videoWidth ÷ videoHeight of the live video, or undefined while the size is unknown (D-003). */
export function videoAspect(v: Pick<HTMLVideoElement, "videoWidth" | "videoHeight">): number | undefined {
  return v.videoWidth > 0 && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : undefined;
}

export interface CameraPoseOptions {
  /**
   * How many people the model looks for. Workouts and the trial keep the default of 1. The
   * movement check passes 2 (CHECK_DATA.engine.pose.numPoses, spec 4.0) and picks its subject
   * from `Frame.poses` with SubjectLock.
   */
  numPoses?: number;
  /**
   * The pose model to load (product v7 C-10: the focus check measures with Full when the device
   * sustains the floor, else Lite). Absent: the v1 choice, Lite on a phone and Full elsewhere.
   */
  model?: "lite" | "full";
  /**
   * A camera the source borrows instead of opening its own: called once the model has loaded (so
   * leaving during the download never asks for the camera), it gives an open stream that its caller
   * owns. stop() leaves the stream running and on the video, so the owner can start another source on
   * the same camera (the focus check's Lite fallback, C-10). Absent: the source opens its own camera
   * and closes it on stop().
   */
  stream?: () => Promise<MediaStream>;
}

type RawLandmark = { x: number; y: number; z: number; visibility?: number };
/** The model's landmarks; a point that is not a finite number is marked unseen (sanitizePose). */
const toLandmarks = (pose: RawLandmark[]): Landmark[] =>
  sanitizePose(pose.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 1 })));

export class CameraPoseSource implements PoseSource {
  kind = "camera" as const;
  video: HTMLVideoElement;
  onStatus?: (status: CameraStatus) => void;
  readonly numPoses: number;
  /** The model the source loads (CameraPoseOptions.model, or the v1 choice). */
  readonly model: "lite" | "full";
  private readonly borrowed: (() => Promise<MediaStream>) | null;
  private landmarker: PoseLandmarker | null = null;
  private raf = 0;
  private stream: MediaStream | null = null;
  private running = false;
  private cancelled = false;

  constructor(video: HTMLVideoElement, opts: CameraPoseOptions = {}) {
    this.video = video;
    const n = opts.numPoses ?? 1;
    this.numPoses = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
    this.model = opts.model ?? defaultModel();
    this.borrowed = opts.stream ?? null;
  }

  async start(onFrame: (f: Frame) => void): Promise<void> {
    // Model first: leaving during the download must never trigger a camera permission prompt.
    this.onStatus?.("model");
    const vision = await FilesetResolver.forVisionTasks("/wasm");
    if (this.cancelled) return;
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: poseModelUrl(this.model), delegate },
      runningMode: "VIDEO" as const,
      numPoses: this.numPoses,
    });
    let landmarker: PoseLandmarker;
    try {
      landmarker = await PoseLandmarker.createFromOptions(vision, options("GPU"));
    } catch {
      if (this.cancelled) return;
      landmarker = await PoseLandmarker.createFromOptions(vision, options("CPU"));
    }
    if (this.cancelled) {
      landmarker.close();
      return;
    }
    this.landmarker = landmarker;

    this.onStatus?.("camera");
    const stream = this.borrowed ? await this.borrowed() : await openCamera();
    if (this.cancelled) {
      // A borrowed camera stays with its owner.
      if (!this.borrowed) stream.getTracks().forEach((tr) => tr.stop());
      return;
    }
    this.stream = stream;
    this.video.srcObject = stream;
    try {
      await this.video.play();
    } catch (err) {
      if (!this.cancelled) throw err;
    }
    if (this.cancelled) return;
    this.running = true;

    let lastVideoTime = -1;
    const loop = () => {
      if (!this.running) return;
      const v = this.video;
      if (v.currentTime !== lastVideoTime && v.videoWidth > 0) {
        lastVideoTime = v.currentTime;
        const t = performance.now();
        // Read on every frame: the size changes when a phone rotates.
        const aspect = videoAspect(v);
        try {
          const res = this.landmarker!.detectForVideo(v, t);
          // Every pose the model returned, never more than asked for; lm stays the first one.
          const poses = (res.landmarks ?? []).slice(0, this.numPoses).map(toLandmarks);
          if (poses[0]) {
            const world = res.worldLandmarks?.[0];
            onFrame({
              t,
              lm: poses[0],
              world: world ? toLandmarks(world) : undefined,
              aspect,
              poses,
            });
          } else {
            onFrame({ ...emptyFrame(t, aspect), poses: [] });
          }
        } catch {
          onFrame({ ...emptyFrame(t, aspect), poses: [] });
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.cancelled = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.landmarker?.close();
    this.landmarker = null;
    // A borrowed camera keeps running, and the video keeps showing it, for its owner's next source.
    if (!this.borrowed) {
      this.stream?.getTracks().forEach((tr) => tr.stop());
      this.video.srcObject = null;
    }
    this.stream = null;
  }
}

/** Plays a synthetic landmark trace in real time — the offline demo & stage fallback. */
export class TracePoseSource implements PoseSource {
  kind = "trace" as const;
  private timer = 0;
  private frames: Frame[] = [];

  constructor(
    private exerciseId: string,
    private opts: TraceOpts = {},
    private speed = 1,
  ) {}

  async start(onFrame: (f: Frame) => void): Promise<void> {
    const gen = TRACES[this.exerciseId] ?? TRACES.seated_shoulder_press;
    // long loop: generous rep count, looped
    this.frames = gen({ reps: 60, ...this.opts });
    const t0 = performance.now();
    const dur = this.frames[this.frames.length - 1].t;
    const step = () => {
      const t = ((performance.now() - t0) * this.speed) % dur;
      // find nearest frame (frames are uniform)
      const idx = Math.min(this.frames.length - 1, Math.floor((t / dur) * this.frames.length));
      const f = this.frames[idx];
      onFrame({ ...f, t: performance.now() });
      this.timer = requestAnimationFrame(step);
    };
    this.timer = requestAnimationFrame(step);
  }

  stop(): void {
    cancelAnimationFrame(this.timer);
  }
}
