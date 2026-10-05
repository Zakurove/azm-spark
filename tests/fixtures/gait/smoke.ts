/**
 * The real model smoke's kept landmarks (product v7 contract 8.4, stream G, step G1; D-026 item 6,
 * GG-4): MediaPipe Pose (Full and Lite) on G1's rendered walking pad walk seen from the right side,
 * the procedural humanoid of scripts/smoke at 100 steps a minute with its exact events. A regression
 * for the pad side view on real model output, where the far leg is often hidden behind the near one.
 * Node only. Files: tests/fixtures/gait/smoke/<name>.smoke (JSON text; tests/fixtures.test.ts reads
 * every .json under tests/fixtures as a movement check fixture).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GaitFrame, GaitSetup } from "../../../src/engine/gait/types";
import type { Landmark } from "../../../src/engine/types";
import type { Side } from "./gen-gait";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "smoke");

interface SmokeFile {
  format: string;
  model: "full" | "lite";
  aspect: number;
  nearSide: Side;
  padKmh: number;
  heightCm: number;
  standingSec: [number, number];
  walkSec: [number, number];
  landmarks: number[];
  truth: { cadence: number; strideSec: number; events: [Side, "ic" | "to", number][] };
  frames: number[][];
}

export interface SmokeWalk {
  model: "full" | "lite";
  nearSide: Side;
  setup: GaitSetup;
  standing: GaitFrame[];
  frames: GaitFrame[];
  truth: { cadence: number; ics: { side: Side; t: number }[]; tos: { side: Side; t: number }[] };
}

export function loadSmoke(name: "gait-pad-side-full" | "gait-pad-side-lite"): SmokeWalk {
  const f = JSON.parse(readFileSync(join(DIR, `${name}.smoke`), "utf8")) as SmokeFile;
  if (f.format !== "azm-gait-smoke-1") throw new Error(`${name}: unknown smoke fixture format`);
  const frames: GaitFrame[] = f.frames.map(([t, ...v]) => {
    const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
    f.landmarks.forEach((id, i) => {
      lm[id] = { x: v[3 * i], y: v[3 * i + 1], z: 0, visibility: v[3 * i + 2] };
    });
    return { t, lm, aspect: f.aspect };
  });
  const within = ([a, b]: [number, number]) => frames.filter((x) => x.t >= a * 1000 && x.t <= b * 1000);
  const events = f.truth.events.map(([side, type, t]) => ({ side, type, t }));
  return {
    model: f.model,
    nearSide: f.nearSide,
    setup: {
      mode: "walking_pad",
      aid: "none",
      orthosis: {},
      prosthesis: null,
      shoes: true,
      heightCm: f.heightCm,
      padSpeedKmh: f.padKmh,
      padCorrection: null,
      handrail: "none",
      familiarised: true,
    },
    standing: within(f.standingSec),
    frames: within(f.walkSec),
    truth: {
      cadence: f.truth.cadence,
      ics: events.filter((e) => e.type === "ic"),
      tos: events.filter((e) => e.type === "to"),
    },
  };
}
