/**
 * One real model smoke run (product v7 contract 8.4, stream G, step G1), the work of the smoke page
 * kept out of the component so it runs on a fake camera in tests.
 *
 *   range  the focus camera (C-10) on the block's model; optionally its probe first (model=auto);
 *          B's RomRunner driven as a person at the buttons (romDriver.ts) and the page's own angle
 *          trace (romTrace.ts) on every frame; it ends when the runner is done, or after traceSec
 *          when the runner is not built, or at timeoutSec.
 *   gait   the same camera; the subject's frames of the video's standing and walk windows
 *          (gaitCapture.ts); after the walk C's analyseGaitView on them (never during capture, as
 *          in the app), timed, and the harness's tracking check.
 *
 * The result is plain JSON for the harness (e2e/v7-model-smoke.spec.ts). Video never leaves the
 * page: only landmarks and numbers are in the result (the landmarks only with frames=1, for replay
 * off line on the developer's machine).
 */
import type { FocusCamera, PoseModel, ProbeResult } from "../focus/camera";
import type { RomProtocolItem, RomBlock } from "../../medical/rom-protocol";
import { movementDef } from "../../movements/rom";
import type { RomPositionId } from "../../movements/rom/types";
import type { RomRunnerOptions } from "../../engine/rom/types";
import type { GaitSetup, GaitViewInput, GaitViewResult } from "../../engine/gait/types";
import { SUBJECT_RULES, SubjectLock } from "../../engine/subject";
import type { Frame } from "../../engine/types";
import { BUDGETS } from "./budgets";
import { GaitCapture, harnessCadence, trackingShare, type HarnessCadence } from "./gaitCapture";
import { medianFps, type PerfMeter, type PerfSnapshot } from "./perf";
import { RomSmokeDriver, type RomDriverReport, type RomRunnerLike } from "./romDriver";
import { RomAngleTrace, type RomTraceSummary } from "./romTrace";
import type { GaitSmokeSpec, RomSmokeSpec, SmokeSpec } from "./spec";

/** What a run needs of the focus camera (focusCameraSession in the page, a fake in tests). */
export type SmokeCamera = Pick<FocusCamera, "model" | "preload" | "probe"> & {
  session: Pick<FocusCamera["session"], "acquire" | "onFrame" | "onStatus" | "status" | "video">;
};

export interface SmokeDeps {
  camera: SmokeCamera;
  /** new RomRunner(opts) (B); throws while B's runner is not built. */
  createRunner(opts: RomRunnerOptions): RomRunnerLike;
  /** analyseGaitView (C); throws while C's engine is not built. */
  analyse(input: GaitViewInput): GaitViewResult;
  /** The run's own measures (attached to the page's hooks by the page). */
  meter: PerfMeter;
  /** The WebGL renderer, to tell the GPU from a software fallback. */
  gpu: string | null;
  now?: () => number;
  /** Each runner feed and the analysis, for User Timing (azm:rom_feed, azm:gait_analyse). */
  onMeasure?: (name: string, ms: number) => void;
}

/** A runner or engine that could not run: not built yet (a placeholder), or failed. */
export interface NotRun {
  status: "not_built" | "error";
  error: string;
}

export interface SmokeLive {
  status: "starting" | "probing" | "running" | "done" | "error";
  frames: number;
  seconds: number;
  fps: number | null;
  model: PoseModel;
  /** Range: the last angle the trace read. Gait: the window the capture is in. */
  detail: string | null;
}

export interface SmokeResult {
  version: 1;
  name: string;
  spec: SmokeSpec;
  status: "done" | "error";
  error?: string;
  startedAt: string;
  /** Wall time of the run, s. */
  seconds: number;
  /**
   * The picture the model saw (the video element), the frames and their median rate, and the camera
   * track's settings (a fake camera gives the file's size or a crop of it that fits the app's camera
   * constraints).
   */
  camera: {
    width: number | null;
    height: number | null;
    frames: number;
    fps: number | null;
    track: { width?: number; height?: number; frameRate?: number; resizeMode?: string } | null;
  };
  model: { requested: SmokeSpec["model"]; used: PoseModel; probe: ProbeResult | null };
  gpu: string | null;
  perf: PerfSnapshot;
  budgets: typeof BUDGETS;
  rom?: { runner: RomDriverReport | NotRun; trace: RomTraceSummary };
  gait?: {
    capture: ReturnType<GaitCapture["stats"]>;
    engine: (NotRun & { analyseMs?: number }) | { status: "done"; analyseMs: number; result: GaitViewResult };
    harness: HarnessCadence;
    tracking: ReturnType<typeof trackingShare>;
  };
  /**
   * frames=1: the subject's landmarks, [ms from the first frame, [x, y, visibility] x 33]; and every
   * frame as the camera gave it, every pose the model returned (none when it found nobody), with the
   * picture's aspect, so a run replays off line through the runners exactly (D-034 item 1).
   */
  landmarks?: {
    frames: [number, [number, number, number][]][];
    poses?: [number, [number, number, number][][]][];
    aspect?: number | null;
  };
}

const BLOCK: Record<RomPositionId, RomBlock> = {
  seated: "seated",
  seated_forward: "seated",
  seated_armrests: "seated",
  standing: "standing",
  standing_supported: "standing",
  lying_back: "lying",
};

/** The protocol item of a range run (as buildRomProtocol would plan it, without a can move question). */
export function romItem(spec: RomSmokeSpec): RomProtocolItem {
  const def = movementDef(spec.movement);
  const pos = def.positions.find((p) => p.id === spec.position)!;
  return {
    movementId: spec.movement,
    side: spec.side,
    region: def.region,
    position: spec.position,
    block: BLOCK[spec.position],
    order: 0,
    priority: def.priority,
    verdict: def.verdict,
    normId: pos.normId,
    graded: pos.graded,
    askCanMove: false,
    helperRequired: false,
    approximate: def.verdict === "caution" || def.approximateInPersonView,
  };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** A placeholder of Gate A throws "... is not built yet (stream B)"; anything else is a failure. */
const notRun = (err: unknown): NotRun => ({
  status: /not built/.test(message(err)) ? "not_built" : "error",
  error: message(err),
});

/** The settings of the camera track on a video element (width, height, frame rate, resize mode). */
function trackSettings(video: HTMLVideoElement | null): SmokeResult["camera"]["track"] {
  try {
    const stream = video?.srcObject as MediaStream | null | undefined;
    const s = stream?.getVideoTracks?.()[0]?.getSettings?.();
    if (!s) return null;
    const { width, height, frameRate, resizeMode } = s as MediaTrackSettings & { resizeMode?: string };
    return { width, height, frameRate, resizeMode };
  } catch {
    return null;
  }
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const r2 = (v: number) => Math.round(v * 100) / 100;

export class SmokeRun {
  private readonly now: () => number;
  private readonly startWall: number;
  private readonly startedAt = new Date().toISOString();
  private readonly times: number[] = [];
  private readonly landmarks: [number, [number, number, number][]][] = [];
  private readonly allPoses: [number, [number, number, number][][]][] = [];
  private aspect: number | null = null;
  private readonly listeners = new Set<(live: SmokeLive) => void>();
  private live: SmokeLive;
  private probe: ProbeResult | null = null;
  private firstT: number | null = null;
  private videoSize: { width: number | null; height: number | null } = { width: null, height: null };
  private track: SmokeResult["camera"]["track"] = null;
  private finish: ((r: SmokeResult) => void) | null = null;
  private cleanup: (() => void)[] = [];
  private ended: SmokeResult | null = null;
  // range
  private trace: RomAngleTrace | null = null;
  private driver: RomSmokeDriver | null = null;
  private runnerNotRun: NotRun | null = null;
  private tracking = false;
  // gait
  private capture: GaitCapture | null = null;
  /** The subject of the landmark dump: the range runner's lock (the body anchor, D-034 item 1). */
  private dumpLock = new SubjectLock(SUBJECT_RULES, { anchor: "body" });

  constructor(
    private readonly spec: SmokeSpec,
    private readonly deps: SmokeDeps,
  ) {
    this.now = deps.now ?? (() => performance.now());
    this.startWall = this.now();
    this.live = {
      status: "starting",
      frames: 0,
      seconds: 0,
      fps: null,
      model: deps.camera.model,
      detail: null,
    };
  }

  /** Live numbers for the page, about every frame. */
  onUpdate(fn: (live: SmokeLive) => void): () => void {
    this.listeners.add(fn);
    fn(this.live);
    return () => this.listeners.delete(fn);
  }

  /**
   * Starts the run; resolves with its result when it ends. The model preload starts first and the
   * camera opens `preloadMs` later, as the setup card gives it time in the app (two fetches of the
   * model at once can fail in Chromium, and the pose source then falls back to the CPU).
   */
  start(): Promise<SmokeResult> {
    const done = new Promise<SmokeResult>((resolve) => (this.finish = resolve));
    const cam = this.deps.camera;
    const kind = this.spec.kind;
    if (kind === "gait") this.capture = new GaitCapture(this.spec as GaitSmokeSpec);
    cam.preload(kind);
    const open = () => {
      if (this.ended) return;
      const release = cam.session.acquire();
      const offStatus = cam.session.onStatus((s, e) => {
        if (s === "error") this.end("error", `camera ${e ?? "error"}`);
      });
      const offFrame = cam.session.onFrame((f) => this.frame(f));
      this.cleanup.push(offFrame, offStatus, release);
    };
    if (this.spec.preloadMs > 0) {
      const timer = setTimeout(open, this.spec.preloadMs);
      this.cleanup.push(() => clearTimeout(timer));
    } else open();
    return done;
  }

  /** Stops the run now (the page left): the result says so. */
  stop(): void {
    this.end("error", "stopped before the end");
  }

  private emit(patch: Partial<SmokeLive>): void {
    this.live = { ...this.live, ...patch };
    for (const fn of this.listeners) fn(this.live);
  }

  private frame(f: Frame): void {
    if (this.ended) return;
    const first = this.firstT === null;
    if (first) {
      this.firstT = f.t;
      const v = this.deps.camera.session.video;
      if (v && v.videoWidth > 0) this.videoSize = { width: v.videoWidth, height: v.videoHeight };
      this.track = trackSettings(v);
    }
    const elapsed = (f.t - this.firstT!) / 1000;
    if (this.spec.kind === "rom") this.romFrame(f, elapsed, first);
    else this.gaitFrame(f, elapsed, first);
  }

  private count(f: Frame, elapsed: number, detail: string | null): void {
    this.times.push(f.t);
    if (this.spec.frames) this.keepLandmarks(f);
    this.emit({
      status: this.live.status === "probing" ? "probing" : "running",
      frames: this.times.length,
      seconds: Math.round(elapsed * 10) / 10,
      fps: this.times.length % 15 === 0 ? medianFps(this.times.slice(-90)) : this.live.fps,
      model: this.deps.camera.model,
      detail,
    });
  }

  private keepLandmarks(f: Frame): void {
    const all = f.poses ?? (f.lm.length ? [f.lm] : []);
    this.aspect ??= f.aspect ?? null;
    this.allPoses.push([
      Math.round(f.t - this.firstT!),
      all.map((pose) => pose.map((p) => [r4(p.x), r4(p.y), r2(p.visibility)])),
    ]);
    if (!this.dumpLock.locked) {
      const poses = f.poses ?? (f.lm.length ? [f.lm] : []);
      if (!poses.length || !this.dumpLock.lock(poses, f.aspect)) return;
    }
    const lm = this.dumpLock.pickFrame(f).lm;
    if (!lm) return;
    this.landmarks.push([
      Math.round(f.t - this.firstT!),
      lm.map((p) => [r4(p.x), r4(p.y), r2(p.visibility)]),
    ]);
  }

  /* ------------------------------------------------------------------ range */

  private romFrame(f: Frame, elapsed: number, first: boolean): void {
    const spec = this.spec as RomSmokeSpec;
    if (first) {
      if (spec.model === "auto") {
        this.emit({ status: "probing" });
        void this.deps.camera.probe("rom").then(
          (p) => {
            this.probe = p;
            this.startRom(f.t);
          },
          (err) => this.end("error", `probe: ${message(err)}`),
        );
      } else this.startRom(f.t);
    }
    if (!this.tracking) return;
    this.trace!.push(f);
    this.driver?.feed(f);
    const last = this.trace!.summary();
    this.count(f, elapsed, last.series.length ? `${last.series[last.series.length - 1][1]}°` : null);
    const runEnd = this.driver ? this.driver.done : elapsed >= spec.traceSec;
    if (runEnd) this.end("done");
    else if (elapsed >= spec.timeoutSec) this.end("done", undefined, "timeout");
  }

  private startRom(t: number): void {
    if (this.ended) return;
    const spec = this.spec as RomSmokeSpec;
    this.trace = new RomAngleTrace({ movement: spec.movement, side: spec.side, mirrored: spec.mirrored });
    try {
      const runner = this.deps.createRunner({
        item: romItem(spec),
        def: movementDef(spec.movement),
        mirrored: spec.mirrored,
        // The runner's own subject lock, as the app's range controller gives it none.
        painBefore: 0,
        // The run never asks what stopped the person (open question 8: null switches it off).
        askCauseBelow: null,
        poseModel: this.deps.camera.model,
      });
      this.driver = new RomSmokeDriver(runner, {
        now: this.now,
        onFeed: (ms) => this.deps.onMeasure?.("azm:rom_feed", ms),
      });
      this.driver.start(t);
    } catch (err) {
      this.runnerNotRun = notRun(err);
      this.driver = null;
    }
    this.tracking = true;
    this.emit({ status: "running", model: this.deps.camera.model });
  }

  /* ------------------------------------------------------------------ gait */

  private gaitFrame(f: Frame, elapsed: number, first: boolean): void {
    if (first && this.spec.model === "auto") {
      this.emit({ status: "probing" });
      void this.deps.camera.probe("gait").then(
        (p) => {
          this.probe = p;
          this.emit({ status: "running", model: this.deps.camera.model });
        },
        (err) => this.end("error", `probe: ${message(err)}`),
      );
    }
    const phase = this.capture!.push(f);
    if (phase === "done") {
      this.end("done");
      return;
    }
    this.count(f, elapsed, phase);
  }

  /* ------------------------------------------------------------------ end */

  private end(status: "done" | "error", error?: string, runnerStatus?: "timeout"): void {
    if (this.ended) return;
    for (const fn of this.cleanup.splice(0)) fn();
    const spec = this.spec;
    const t = this.times.length ? this.times[this.times.length - 1] : this.now();
    const result: SmokeResult = {
      version: 1,
      name: spec.name,
      spec,
      status,
      ...(error ? { error } : {}),
      startedAt: this.startedAt,
      seconds: Math.round((this.now() - this.startWall) / 100) / 10,
      camera: { ...this.videoSize, frames: this.times.length, fps: medianFps(this.times), track: this.track },
      model: { requested: spec.model, used: this.deps.camera.model, probe: this.probe },
      gpu: this.deps.gpu,
      perf: this.deps.meter.snapshot(),
      budgets: BUDGETS,
    };
    if (spec.kind === "rom") {
      result.rom = {
        runner: this.driver
          ? this.driver.report(t, runnerStatus ?? (status === "error" ? "stopped" : undefined))
          : (this.runnerNotRun ?? { status: "error", error: error ?? "the runner did not start" }),
        trace: (
          this.trace ??
          new RomAngleTrace({ movement: spec.movement, side: spec.side, mirrored: spec.mirrored })
        ).summary(),
      };
    } else {
      result.gait = this.gaitResult(spec);
    }
    if (spec.frames) result.landmarks = { frames: this.landmarks, poses: this.allPoses, aspect: this.aspect };
    this.ended = result;
    this.emit({ status: status === "done" ? "done" : "error" });
    this.finish?.(result);
  }

  private gaitResult(spec: GaitSmokeSpec): NonNullable<SmokeResult["gait"]> {
    const cap = this.capture!;
    const walk = cap.walk();
    const pad = spec.mode === "walking_pad";
    const setup: GaitSetup = {
      mode: spec.mode,
      aid: "none",
      orthosis: {},
      prosthesis: null,
      shoes: true,
      heightCm: spec.heightCm,
      padSpeedKmh: spec.padKmh,
      padCorrection: null,
      handrail: pad ? "none" : null,
      familiarised: pad ? true : null,
    };
    let engine: NonNullable<SmokeResult["gait"]>["engine"];
    const t0 = this.now();
    try {
      const result = this.deps.analyse({
        view: spec.view,
        ...(spec.nearSide ? { nearSide: spec.nearSide } : {}),
        setup,
        standing: cap.standing(),
        frames: walk,
        poseModel: this.deps.camera.model,
        rollDeg: null,
      });
      const ms = this.now() - t0;
      this.deps.onMeasure?.("azm:gait_analyse", ms);
      engine = { status: "done", analyseMs: Math.round(ms * 10) / 10, result };
    } catch (err) {
      engine = notRun(err);
    }
    return {
      capture: cap.stats(),
      engine,
      harness: harnessCadence(walk, spec.view),
      tracking: trackingShare(walk),
    };
  }
}
