/**
 * The camera of the focus check (product v7 contract 1.2, C-10, section 9): one camera session for
 * the whole check, with the pose model chosen per block.
 *
 *   - Every block's setup card runs `probe(kind)`: 2 s of processed frames. Full stays when its
 *     median processed frame rate (the measure the attempt gate and the gait data use) sustains the
 *     block's floor: 15 fps for a range block (C-10, above the engine floor of 12 that fails an
 *     attempt) and the gait data's 25 fps for the gait capture. Else only the pose source is rebuilt
 *     with Lite on the same camera (CameraSession.replaceSource); the Lite file downloads only then.
 *   - The outcome is kept per device and per kind for 14 days (`localStorage` `azm.poseModel`, every
 *     access in try and catch), so the next check starts each block on the model it can sustain and
 *     loads one file for it. A miss at the range floor is a miss at the gait floor too; a pass at the
 *     gait floor is a pass at the range floor.
 *   - A miss after Full sustained the same or a higher floor earlier in the check is thermal: Lite to
 *     the end of the check, and nothing is kept. `thermalFallback()` asks for the same from the
 *     controllers; the swap happens at the next probe, a block boundary, never mid attempt.
 *   - The model is recorded with every measurement and every gait view (`model` when it starts; the
 *     runner's flag `modelLite`), never once for the check.
 *
 * Video never leaves the phone: the frames go to the engine in memory and nothing is recorded. On a
 * VITE_E2E=1 build, ?e2eFixture=<name> plays fixture frames instead of the camera, as in the v1
 * check; a fixture is never probed into Lite and nothing is kept for it.
 */
import { capture } from "../../movements/gait/gait-v7.json";
import { CHECK_DATA } from "../../movements/assessments";
import { CameraPoseSource, preloadPoseAssets, type PoseSource } from "../../app/poseSource";
import { CameraSession, type PoseSourceFactory } from "../assessment/camera/session";

export type PoseModel = "lite" | "full";
/** The block a probe is for: a range block or the gait capture. */
export type ProbeKind = "rom" | "gait";

/** The processed frame rate Full must sustain in the probe (C-10, section 9). */
export const PROBE_FLOOR_FPS: Readonly<Record<ProbeKind, number>> = {
  rom: 15,
  gait: capture.common.processedFps.full,
};
/** The probe's length (C-10). */
export const PROBE_MS = 2000;
/** Where the probe outcome is kept on the device (C-10), and for how long. */
export const MODEL_MEMORY_KEY = "azm.poseModel";
export const MODEL_MEMORY_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const KINDS: readonly ProbeKind[] = ["rom", "gait"];

type Store = Pick<Storage, "getItem" | "setItem">;
type Memory = Partial<Record<ProbeKind, { model: PoseModel; at: number }>>;

function readMemory(storage: Store | null): Memory {
  try {
    const raw = storage?.getItem(MODEL_MEMORY_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Memory) : {};
  } catch {
    return {};
  }
}

/** The model kept for a kind on this device, or null: none, older than 14 days, or unreadable. */
export function rememberedModel(kind: ProbeKind, now: number, storage: Store | null): PoseModel | null {
  const entry = readMemory(storage)[kind];
  if (!entry || (entry.model !== "lite" && entry.model !== "full") || typeof entry.at !== "number")
    return null;
  return entry.at <= now && now - entry.at <= MODEL_MEMORY_DAYS * DAY_MS ? entry.model : null;
}

function remember(kinds: readonly ProbeKind[], model: PoseModel, now: number, storage: Store | null): void {
  try {
    const memory = readMemory(storage);
    for (const kind of kinds) memory[kind] = { model, at: now };
    storage?.setItem(MODEL_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    /* private mode or blocked storage: nothing is kept */
  }
}

function deviceStorage(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 1000 ÷ the median gap between frames (as QualityMonitor's fps), to 0.1; null under two frames. */
function medianFps(times: readonly number[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) gaps.push(times[i] - times[i - 1]);
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  const m = gaps.length >> 1;
  const gap = gaps.length % 2 ? gaps[m] : (gaps[m - 1] + gaps[m]) / 2;
  return Math.round(10000 / gap) / 10;
}

/** Builds a pose source with the model the block needs, on the session's camera (`stream`). */
export type FocusSourceFactory = (
  video: HTMLVideoElement,
  stream: () => Promise<MediaStream>,
  model: PoseModel,
) => PoseSource | Promise<PoseSource>;

export interface FocusCameraOptions {
  /**
   * Builds each pose source. Default: the camera with the check's two poses (SubjectLock, as in the
   * v1 check) and the chosen model, or on a VITE_E2E=1 build ?e2eFixture=<name>.
   */
  createSource?: FocusSourceFactory;
  /** Where the outcome is kept; default localStorage, null keeps nothing. */
  storage?: Store | null;
  /** The clock of the 14 days; default Date.now. */
  now?: () => number;
}

export interface ProbeResult {
  /** The model of the block: record it with each measurement and gait view (C-10). */
  model: PoseModel;
  /** Median processed frames per second over the probe; null when no two frames came. */
  fps: number | null;
  /** The probe rebuilt the pose source with Lite. */
  switched: boolean;
}

export interface FocusCamera {
  /** The check's camera: acquire it while a screen shows it (useCameraSession's `session`). */
  readonly session: CameraSession;
  /** The model of the current pose source. */
  readonly model: PoseModel;
  /**
   * Warms the HTTP cache with the model the block will start on (Full unless this device keeps Lite
   * for it), during the setup card. Before the camera starts, the session starts on that model.
   */
  preload(kind: ProbeKind): void;
  /**
   * The block's probe, at its setup card while the session is acquired: starts the block on its
   * model, measures 2 s of frames and falls back to Lite when Full misses the floor. Resolves at
   * once with no frames while the camera is not running, and keeps the model when it stops.
   */
  probe(kind: ProbeKind): Promise<ProbeResult>;
  /** Thermal fallback (C-10): Lite from the next probe to the end of the check, never mid attempt. */
  thermalFallback(): void;
}

async function defaultSource(
  video: HTMLVideoElement,
  stream: () => Promise<MediaStream>,
  model: PoseModel,
): Promise<PoseSource> {
  if (import.meta.env.VITE_E2E === "1") {
    const name = new URLSearchParams(location.search).get("e2eFixture");
    if (name) {
      const { FixturePoseSource } = await import("../assessment/e2e/FixturePoseSource");
      return new FixturePoseSource(name);
    }
  }
  return new CameraPoseSource(video, { numPoses: CHECK_DATA.engine.pose.numPoses, model, stream });
}

/** The camera of one focus check (C-10). */
export function focusCameraSession(opts: FocusCameraOptions = {}): FocusCamera {
  const create = opts.createSource ?? defaultSource;
  const storage = opts.storage === undefined ? deviceStorage() : opts.storage;
  const now = opts.now ?? Date.now;
  /** Kinds Full missed in this check (a device outcome), and the highest floor it sustained. */
  const missed = new Set<ProbeKind>();
  let sustained = 0;
  let thermal = false;
  let built = false;
  let sourceKind: PoseSource["kind"] | null = null;

  const planned = (kind: ProbeKind): PoseModel =>
    thermal || missed.has(kind) || rememberedModel(kind, now(), storage) === "lite" ? "lite" : "full";
  let model: PoseModel = planned("rom");

  const factory: PoseSourceFactory = async (video, stream) => {
    built = true;
    const source = await create(video, stream, model);
    sourceKind = source.kind;
    return source;
  };
  const session = new CameraSession(factory, {
    camera: { frameRate: { ideal: capture.common.cameraFps } },
  });

  /** 2 s of frames from the first one; incomplete when the camera stops or stalls first. */
  const measure = () =>
    new Promise<{ fps: number | null; complete: boolean }>((resolve) => {
      if (session.status === "idle" || session.status === "error")
        return resolve({ fps: null, complete: false });
      const times: number[] = [];
      let backstop: ReturnType<typeof setTimeout> | null = null;
      let done = false;
      const finish = (complete: boolean) => {
        if (done) return;
        done = true;
        offFrame();
        offStatus();
        if (backstop) clearTimeout(backstop);
        resolve({ fps: medianFps(times), complete });
      };
      const offFrame = session.onFrame((f) => {
        // Frames that stall past twice the probe end it unfinished (the camera error screens take over).
        if (!times.length) backstop = setTimeout(() => finish(false), 2 * PROBE_MS);
        times.push(f.t);
        if (f.t - times[0] >= PROBE_MS) finish(true);
      });
      const offStatus = session.onStatus((s) => {
        if (s === "idle" || s === "error") finish(false);
      });
    });

  const use = async (next: PoseModel) => {
    if (next === model) return;
    model = next;
    await session.replaceSource();
  };

  return {
    session,
    get model() {
      return model;
    },
    preload(kind) {
      const m = planned(kind);
      if (!built) model = m;
      preloadPoseAssets(m);
    },
    async probe(kind) {
      await use(planned(kind));
      const { fps, complete } = await measure();
      if (!complete || fps === null || sourceKind !== "camera" || model === "lite")
        return { model, fps, switched: false };
      const floor = PROBE_FLOOR_FPS[kind];
      if (fps >= floor) {
        sustained = Math.max(sustained, floor);
        remember(
          KINDS.filter((k) => PROBE_FLOOR_FPS[k] <= floor),
          "full",
          now(),
          storage,
        );
        return { model, fps, switched: false };
      }
      if (sustained >= floor) thermal = true;
      else {
        const slower = KINDS.filter((k) => PROBE_FLOOR_FPS[k] >= floor);
        for (const k of slower) missed.add(k);
        remember(slower, "lite", now(), storage);
      }
      await use("lite");
      return { model, fps, switched: true };
    },
    thermalFallback() {
      thermal = true;
    },
  };
}
