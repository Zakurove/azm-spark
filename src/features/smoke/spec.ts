/**
 * The options of a real model smoke run (product v7 contract 8.4 and A6a-5, stream G, step G1): the
 * smoke page gets the run's name from ?e2eSmoke=<name> and reads everything else from its own URL,
 * checked against the runtime data. The harness (e2e/v7-model-smoke.spec.ts) builds the query from
 * the video's truth sidecar (scripts/smoke/scenarios.mjs smokeQuery). Pure.
 *
 *   kind=rom   movement, side (left, right, or none for an axial movement without directions),
 *              position (default the movement's first), mirrored=1, timeoutSec (default 150),
 *              traceSec (the angle trace's shortest run, default 30), answer=none (nobody answers
 *              the maximum question: its timeout is the answer, D-035; default yes after 600 ms)
 *   kind=gait  view, nearSide (pad side views), mode (overground or walking_pad), padKmh (pad
 *              views), heightCm, and the video's windows in seconds from its first frame:
 *              standFrom, standTo (the standing calibration), walkFrom, walkTo (the walk)
 *   both       model=full|lite|auto (auto runs the focus camera's probe, C-10; default full),
 *              frames=1 (keep the subject's landmarks in the result, for replay off line),
 *              preloadMs (how long the camera waits after the model preload, as the setup card
 *              gives it time; default 3000, 0 opens the camera at once)
 */
import {
  ROM_MOVEMENT_IDS,
  type RomMovementId,
  type RomPositionId,
  type RomSide,
} from "../../movements/rom/types";
import { movementDef } from "../../movements/rom";
import type { GaitView } from "../../engine/gait/types";
import type { GaitMode } from "../../medical/gait-eligibility";

export type SmokeModel = "lite" | "full" | "auto";

interface SmokeCommon {
  name: string;
  model: SmokeModel;
  /** Keep the subject's landmarks in the result (for replay off line). */
  frames: boolean;
  /** How long the camera opens after the model preload starts, ms (the setup card's time). */
  preloadMs: number;
}

export interface RomSmokeSpec extends SmokeCommon {
  kind: "rom";
  movement: RomMovementId;
  side: RomSide;
  position: RomPositionId;
  mirrored: boolean;
  /** The run stops after this long whatever the runner does (s). */
  timeoutSec: number;
  /** The angle trace runs at least this long (s), so a run without a runner still reads the video. */
  traceSec: number;
  /** D-035: "none" never answers the maximum question (Nasser's silence); "yes" after 600 ms. */
  answer: "yes" | "none";
}

export interface GaitSmokeSpec extends SmokeCommon {
  kind: "gait";
  view: GaitView;
  nearSide: "left" | "right" | null;
  mode: GaitMode;
  padKmh: number | null;
  heightCm: number | null;
  standFrom: number;
  standTo: number;
  walkFrom: number;
  walkTo: number;
}

export type SmokeSpec = RomSmokeSpec | GaitSmokeSpec;
export type SmokeSpecResult = { ok: true; spec: SmokeSpec } | { ok: false; error: string };

const MODELS: readonly SmokeModel[] = ["full", "lite", "auto"];
const VIEWS: readonly GaitView[] = ["front", "back", "side", "pad_side", "pad_front"];
const MODES: readonly GaitMode[] = ["overground", "walking_pad"];

class SpecError extends Error {}

function pick<T extends string>(q: URLSearchParams, key: string, allowed: readonly T[], fallback?: T): T {
  const v = q.get(key);
  if (v === null || v === "") {
    if (fallback !== undefined) return fallback;
    throw new SpecError(`${key} is required (${allowed.join(", ")})`);
  }
  if (!(allowed as readonly string[]).includes(v))
    throw new SpecError(`${key} ${v} is not one of ${allowed.join(", ")}`);
  return v as T;
}

function num(
  q: URLSearchParams,
  key: string,
  opts: { min?: number; positive?: boolean } = {},
): number | null {
  const v = q.get(key);
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || (opts.positive && n <= 0) || (opts.min !== undefined && n < opts.min))
    throw new SpecError(`${key} ${v} is not a ${opts.positive ? "positive " : ""}number`);
  return n;
}

function required(q: URLSearchParams, key: string): number {
  const n = num(q, key, { min: 0 });
  if (n === null) throw new SpecError(`${key} is required`);
  return n;
}

function romSpec(q: URLSearchParams, common: SmokeCommon): RomSmokeSpec {
  const movement = pick(q, "movement", ROM_MOVEMENT_IDS);
  const def = movementDef(movement);
  const sides: RomSide[] = !def.axial || def.bothDirections ? ["left", "right"] : ["none"];
  const side = pick(q, "side", sides);
  const positions = def.positions.map((p) => p.id);
  const position = pick(q, "position", positions, positions[0]);
  return {
    ...common,
    kind: "rom",
    movement,
    side,
    position,
    mirrored: q.get("mirrored") === "1",
    timeoutSec: num(q, "timeoutSec", { positive: true }) ?? 150,
    traceSec: num(q, "traceSec", { positive: true }) ?? 30,
    answer: q.get("answer") === "none" ? "none" : "yes",
  };
}

function gaitSpec(q: URLSearchParams, common: SmokeCommon): GaitSmokeSpec {
  const view = pick(q, "view", VIEWS);
  const pad = view === "pad_side" || view === "pad_front";
  const mode = pick(q, "mode", MODES);
  if (pad !== (mode === "walking_pad")) throw new SpecError(`mode ${mode} does not fit the view ${view}`);
  const near = q.get("nearSide");
  const nearSide = near === null || near === "" ? null : pick(q, "nearSide", ["left", "right"] as const);
  const padKmh = num(q, "padKmh", { positive: true });
  if (pad && padKmh === null) throw new SpecError("padKmh is required on a pad view");
  const w = {
    standFrom: required(q, "standFrom"),
    standTo: required(q, "standTo"),
    walkFrom: required(q, "walkFrom"),
    walkTo: required(q, "walkTo"),
  };
  if (!(w.standFrom < w.standTo && w.standTo <= w.walkFrom && w.walkFrom < w.walkTo))
    throw new SpecError("the window times must run standFrom < standTo <= walkFrom < walkTo");
  return {
    ...common,
    kind: "gait",
    view,
    nearSide,
    mode,
    padKmh,
    heightCm: num(q, "heightCm", { positive: true }),
    ...w,
  };
}

/** The run's options from the page's query (`location.search`), or why they cannot run. */
export function parseSmokeSpec(name: string, search: string): SmokeSpecResult {
  const q = new URLSearchParams(search);
  try {
    const kind = pick(q, "kind", ["rom", "gait"] as const);
    const common: SmokeCommon = {
      name,
      model: pick(q, "model", MODELS, "full"),
      frames: q.get("frames") === "1",
      preloadMs: num(q, "preloadMs", { min: 0 }) ?? 3000,
    };
    return { ok: true, spec: kind === "rom" ? romSpec(q, common) : gaitSpec(q, common) };
  } catch (err) {
    if (err instanceof SpecError) return { ok: false, error: err.message };
    throw err;
  }
}
