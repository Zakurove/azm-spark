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
import { LR_ALL, type Side } from "./gen-gait";

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

/**
 * G1's real model pad walk made into an overground side walk, for the near limb rule's fail safe
 * (D-026 item 6, W2-15): the walk cut into passes of passSec, each moved across the picture at the
 * belt speed (the near heel's median backward drift in mid stance, so a stance foot stands still),
 * every second pass mirrored with its left and right labels exchanged (the walk back, the other leg
 * near), the walker out of the picture for 1.5 s between passes. The real model's far leg errors stay
 * as they were (GG-4: the far leg laid on the near one, the swap rule carrying it into the near track).
 */
export function overgroundFromPad(
  name: "gait-pad-side-full" | "gait-pad-side-lite",
  passSec: number,
  passes: number,
): SmokeWalk {
  const s = loadSmoke(name);
  const heel = s.nearSide === "right" ? 30 : 29;
  const nearTos = s.truth.tos.filter((e) => e.side === s.nearSide).map((e) => e.t);
  const drift: number[] = [];
  for (const ic of s.truth.ics.filter((e) => e.side === s.nearSide).map((e) => e.t)) {
    const to = nearTos.find((t) => t > ic);
    const a = to === undefined ? undefined : s.frames.find((f) => f.t >= ic + 150);
    const b = to === undefined ? undefined : [...s.frames].reverse().find((f) => f.t <= to - 150);
    if (a && b && b.t > a.t) drift.push((a.lm[heel].x - b.lm[heel].x) / ((b.t - a.t) / 1000));
  }
  drift.sort((x, y) => x - y);
  const belt = drift[Math.floor(drift.length / 2)];
  const other = (side: Side): Side => (side === "left" ? "right" : "left");
  const frames: GaitFrame[] = [];
  const ics: { side: Side; t: number }[] = [];
  const tos: { side: Side; t: number }[] = [];
  const t0 = s.frames[0].t;
  const gapMs = 1500;
  let clock = 0;
  for (let i = 0; i < passes; i++) {
    const from = t0 + i * passSec * 1000;
    const to = from + passSec * 1000;
    const mid = (from + to) / 2;
    const back = i % 2 === 1;
    for (const f of s.frames) {
      if (f.t < from || f.t >= to) continue;
      let lm = f.lm.map((q) => ({ ...q, x: q.x + (belt * (f.t - mid)) / 1000 }));
      if (back) {
        lm = lm.map((q) => ({ ...q, x: 1 - q.x }));
        for (const [a, b] of LR_ALL) [lm[a], lm[b]] = [lm[b], lm[a]];
      }
      lm = lm.map((q) => (q.x < 0 || q.x > 1 ? { ...q, visibility: 0.1 } : q));
      frames.push({ t: clock + (f.t - from), lm, aspect: f.aspect });
    }
    const map = (e: { side: Side; t: number }) => ({
      side: back ? other(e.side) : e.side,
      t: clock + e.t - from,
    });
    ics.push(...s.truth.ics.filter((e) => e.t >= from && e.t < to).map(map));
    tos.push(...s.truth.tos.filter((e) => e.t >= from && e.t < to).map(map));
    clock += passSec * 1000;
    for (let t = 0; t < gapMs; t += 1000 / 30) {
      const lm = s.frames[0].lm.map((q) => ({ ...q, x: -0.5, visibility: 0.05 }));
      frames.push({ t: clock + t, lm, aspect: s.frames[0].aspect });
    }
    clock += gapMs;
  }
  return {
    model: s.model,
    nearSide: s.nearSide,
    setup: { ...s.setup, mode: "overground", padSpeedKmh: null, handrail: null, familiarised: null },
    standing: s.standing,
    frames,
    truth: { cadence: s.truth.cadence, ics, tos },
  };
}
