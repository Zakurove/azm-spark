/**
 * FixturePoseSource (contract v3 K): plays landmark fixture frames as if they came from the camera,
 * in real time, with `poses` and `aspect` set as CameraPoseSource sets them, so the browser flows of
 * e2e/ run the real check screens and engine without a camera.
 *
 * It exists only on a VITE_E2E=1 build: poseSourceFactory.ts imports this module inside an
 * `import.meta.env.VITE_E2E === "1"` branch, which the production build removes, and
 * tests/fixture-pose-source.test.ts proves that no production file holds its name.
 *
 * Fixtures are the generator specs of tests/fixtures/catalog.ts, selected by ?e2eFixture=<name>
 * where the name is the catalogue file without .json (for example
 * shoulder_abduction/chair/raise-right-9x16), one of the presets below, or one of the S34 camera
 * scripts of camera/e2e/fixtures.ts (abd, lean, curl, stand, leave and crowd, each as -9x16 and
 * -16x9: a person who sits still, then moves, lap after lap).
 */
import type { PoseSource } from "../../../app/poseSource";
import type { Frame, Landmark } from "../../../engine/types";
import { CATALOG } from "../../../../tests/fixtures/catalog";
import { generate, type GenSpec } from "../../../../tests/fixtures/gen";
import { gaitFixtureFrames } from "../../../../tests/fixtures/gait/catalog";
import { CAM_FIXTURES } from "../camera/e2e/fixtures";

/** The marker the bundle test looks for. */
export const FIXTURE_SOURCE_NAME = "FixturePoseSource";

/** Presets beyond the catalogue: a person sitting still in front of the phone, and an empty room. */
const PRESETS: Record<string, GenSpec> = {
  "seated-still": {
    test: "shoulder_abduction",
    profile: "chair",
    aspect: "9:16",
    fps: 15,
    durationSec: 6,
    seed: 501,
    notes: "One person on a chair, front view, sitting still.",
  },
  "seated-raise": {
    test: "shoulder_abduction",
    profile: "chair",
    aspect: "9:16",
    fps: 15,
    durationSec: 8,
    seed: 502,
    subject: { motions: [{ kind: "arm_raise", side: "right", peak: 140 }] },
    notes: "One person on a chair raising the right arm to 140 degrees.",
  },
};

export const FIXTURE_NAMES: readonly string[] = [
  ...Object.keys(PRESETS),
  ...Object.keys(CAM_FIXTURES),
  ...CATALOG.map((c) => c.file.replace(/\.json$/, "")),
  "empty",
];

/** The generator spec of a fixture name, or null ("empty" plays frames without a person). */
export function fixtureSpec(name: string): GenSpec | null {
  if (PRESETS[name]) return PRESETS[name];
  if (CAM_FIXTURES[name]) return CAM_FIXTURES[name];
  const entry = CATALOG.find((c) => c.file.replace(/\.json$/, "") === name);
  return entry ? entry.spec : null;
}

const EMPTY = (): Landmark[] => Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));

/** The frames of a fixture as the engine sees them (lm is the first pose, as the camera sets it). */
export function fixtureFrames(name: string): Frame[] {
  if (name === "empty") {
    return Array.from({ length: 90 }, (_, i) => ({
      t: (i * 1000) / 15,
      lm: EMPTY(),
      poses: [],
      aspect: 0.5625,
    }));
  }
  // v7 gait fixtures (product v7 contract 8.3, stream C): a name starting gait/ is read from
  // tests/fixtures/gait/catalog.ts, frames as the engine sees them.
  if (name.startsWith("gait/")) {
    const frames = gaitFixtureFrames(name);
    if (!frames) throw new RangeError(`Unknown e2e fixture ${name}`);
    return frames;
  }
  const spec = fixtureSpec(name);
  if (!spec) throw new RangeError(`Unknown e2e fixture ${name}`);
  const fx = generate(spec);
  return fx.frames.map((f) => ({
    t: f.t,
    lm: f.poses[0] ?? EMPTY(),
    poses: f.poses,
    aspect: fx.meta.aspect,
  }));
}

export interface FixtureClock {
  now(): number;
  every(ms: number, fn: () => void): () => void;
}

const realClock: FixtureClock = {
  now: () => performance.now(),
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

export class FixturePoseSource implements PoseSource {
  readonly kind = "trace" as const;
  readonly sourceName = FIXTURE_SOURCE_NAME;
  private cancel: (() => void) | null = null;
  readonly frames: Frame[];
  /** One lap (ms): the spec's duration when it has one, else the last frame plus one frame time. */
  private readonly lapMs: number | null;

  constructor(
    readonly fixture: string,
    private opts: { loop?: boolean; clock?: FixtureClock } = {},
  ) {
    this.frames = fixtureFrames(fixture);
    const spec = fixtureSpec(fixture);
    this.lapMs = spec ? spec.durationSec * 1000 : null;
  }

  /** Delivers every frame whose time has come, in order; loops unless told not to. */
  async start(onFrame: (f: Frame) => void): Promise<void> {
    const clock = this.opts.clock ?? realClock;
    const loop = this.opts.loop ?? true;
    const frames = this.frames;
    if (frames.length === 0) return;
    const duration = Math.max(this.lapMs ?? 0, frames[frames.length - 1].t + 1000 / 15);
    const t0 = clock.now();
    let next = 0;
    let lap = 0;
    this.cancel = clock.every(1000 / 60, () => {
      const elapsed = clock.now() - t0;
      while (true) {
        const f = frames[next];
        const at = lap * duration + f.t;
        if (at > elapsed) break;
        onFrame({ ...f, t: t0 + at });
        next += 1;
        if (next === frames.length) {
          if (!loop) {
            this.stop();
            return;
          }
          next = 0;
          lap += 1;
        }
      }
    });
  }

  stop(): void {
    this.cancel?.();
    this.cancel = null;
  }
}
