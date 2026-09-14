import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { Frame } from "../engine/types";
import { TRACES, TraceOpts } from "../engine/traces";

/** A source of pose frames: real camera+model, or synthetic trace playback (demo/offline/tests). */
export interface PoseSource {
  start(onFrame: (f: Frame) => void): Promise<void>;
  stop(): void;
  /** the element to paint behind the overlay, if any */
  video?: HTMLVideoElement;
  kind: "camera" | "trace";
}

export class CameraPoseSource implements PoseSource {
  kind = "camera" as const;
  video: HTMLVideoElement;
  private landmarker: PoseLandmarker | null = null;
  private raf = 0;
  private stream: MediaStream | null = null;
  private running = false;
  private cancelled = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start(onFrame: (f: Frame) => void): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks("/wasm");
    if (this.cancelled) return;
    const landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "/models/pose_landmarker_full.task", delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 1,
    });
    if (this.cancelled) { landmarker.close(); return; }
    this.landmarker = landmarker;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
    if (this.cancelled) { stream.getTracks().forEach(tr => tr.stop()); return; }
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    if (this.cancelled) return;
    this.running = true;

    let lastVideoTime = -1;
    const loop = () => {
      if (!this.running) return;
      const v = this.video;
      if (v.currentTime !== lastVideoTime && v.videoWidth > 0) {
        lastVideoTime = v.currentTime;
        const t = performance.now();
        const res = this.landmarker!.detectForVideo(v, t);
        if (res.landmarks?.[0]) {
          onFrame({
            t,
            lm: res.landmarks[0].map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 1 })),
            world: res.worldLandmarks?.[0]?.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 1 })),
          });
        } else {
          onFrame({ t, lm: Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 })) });
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
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.landmarker?.close();
    this.landmarker = null;
    this.stream = null;
    this.video.srcObject = null;
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
