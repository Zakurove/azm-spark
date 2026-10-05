/**
 * Landmark fixtures for the movement check engine (contract v2 section F).
 *
 * A fixture is one short camera recording, as landmarks only (video never leaves the phone):
 *
 *   {
 *     meta:   { test, profile, aspect, fps, notes, source, spec? },
 *     truth:  { ...what the recording is known to contain },
 *     frames: [{ t, poses: [[33 landmarks], ...] }, ...]
 *   }
 *
 *   - meta.test      test id (shoulder_abduction, arm_curl_30s, trunk_control_seated, chair_stand_30s)
 *   - meta.profile   chair, wheelchair, standing, weaker_left or weaker_right
 *   - meta.aspect    videoWidth ÷ videoHeight (9:16 is 0.5625, 16:9 is 1.7778)
 *   - meta.fps       nominal frame rate
 *   - meta.source    "generated" (tests/fixtures/gen.ts, with meta.spec to regenerate it) or
 *                    "recorded" (landmarks saved on a real phone at the booth)
 *   - truth          ground truth, free form per fixture (generated fixtures use GenTruth)
 *   - frames[i].t    milliseconds from the start
 *   - frames[i].poses every pose the model returned, in the model's order, each 33 MediaPipe
 *                    landmarks normalized to the image (x ÷ width, y ÷ height)
 *
 * On disk a landmark is the tuple [x, y, z, visibility] (x and y to 4 decimals, about a tenth of a
 * pixel on a 1280 pixel side; z to 3; visibility to 2), which keeps the files small; in memory it
 * is the engine's Landmark. Files live at tests/fixtures/<test>/<profile>/<case>.json, written by
 * `stringifyFixture` with one frame per line (prettier leaves them alone, see .prettierignore).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Landmark } from "../../src/engine/types";
import type { GenSpec } from "./gen";
import { TEST_IDS } from "../../src/movements/assessments";

export const FIXTURE_ROOT = dirname(fileURLToPath(import.meta.url));

export interface FixtureMeta {
  test: string;
  profile: string;
  aspect: number;
  fps: number;
  notes: string;
  source: "generated" | "recorded";
  /** The generator input, for generated fixtures. */
  spec?: GenSpec;
}

export interface FixtureFrame {
  t: number;
  poses: Landmark[][];
}

export interface Fixture<T = Record<string, unknown>> {
  meta: FixtureMeta;
  truth: T;
  frames: FixtureFrame[];
}

export type LandmarkTuple = [number, number, number, number];

export interface FixtureFile<T = Record<string, unknown>> {
  meta: FixtureMeta;
  truth: T;
  frames: { t: number; poses: LandmarkTuple[][] }[];
}

// `+ 0` turns -0 into 0, so a file never holds "-0".
const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0;
const r3 = (x: number) => Math.round(x * 1e3) / 1e3 + 0;
const r2 = (x: number) => Math.round(x * 1e2) / 1e2 + 0;

export function serializeFixture<T>(fx: Fixture<T>): FixtureFile<T> {
  return {
    meta: fx.meta,
    truth: fx.truth,
    frames: fx.frames.map((f) => ({
      t: f.t,
      poses: f.poses.map((p) => p.map((q) => [r4(q.x), r4(q.y), r3(q.z), r2(q.visibility)] as LandmarkTuple)),
    })),
  };
}

/** The file text: meta and truth on one line each, then one frame per line. */
export function stringifyFixture<T>(fx: Fixture<T>): string {
  const o = serializeFixture(fx);
  const frames = o.frames.map((f) => `    ${JSON.stringify(f)}`).join(",\n");
  return `{\n  "meta": ${JSON.stringify(o.meta)},\n  "truth": ${JSON.stringify(o.truth)},\n  "frames": [\n${frames}\n  ]\n}\n`;
}

/** The fixture as it reads back from disk (rounded), for comparing with a file. */
export function roundTrip<T>(fx: Fixture<T>): Fixture<T> {
  return parseFixture(JSON.parse(JSON.stringify(serializeFixture(fx)))) as Fixture<T>;
}

function fail(msg: string): never {
  throw new Error(`Invalid fixture: ${msg}`);
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Validates a parsed fixture file and returns it with Landmark objects. */
export function parseFixture(json: unknown): Fixture {
  const o = json as FixtureFile;
  if (!o || typeof o !== "object") fail("not an object");
  const m = o.meta;
  if (!m || typeof m !== "object") fail("meta missing");
  if (typeof m.test !== "string" || typeof m.profile !== "string")
    fail("meta.test and meta.profile are strings");
  if (!isNum(m.aspect) || m.aspect <= 0) fail("meta.aspect is a positive number");
  if (!isNum(m.fps) || m.fps <= 0) fail("meta.fps is a positive number");
  if (typeof m.notes !== "string") fail("meta.notes is a string");
  if (m.source !== "generated" && m.source !== "recorded") fail("meta.source is generated or recorded");
  if (!o.truth || typeof o.truth !== "object") fail("truth missing");
  if (!Array.isArray(o.frames) || !o.frames.length) fail("frames missing");
  let last = -Infinity;
  const frames = o.frames.map((f, i) => {
    if (!isNum(f.t) || f.t < last) fail(`frame ${i}: t must be a number that never goes back`);
    last = f.t;
    if (!Array.isArray(f.poses)) fail(`frame ${i}: poses missing`);
    return {
      t: f.t,
      poses: f.poses.map((p, j) => {
        if (!Array.isArray(p) || p.length !== 33) fail(`frame ${i} pose ${j}: 33 landmarks`);
        return p.map((q, k) => {
          if (!Array.isArray(q) || q.length !== 4 || !q.every(isNum))
            fail(`frame ${i} pose ${j} landmark ${k}: [x, y, z, visibility]`);
          if (q[3] < 0 || q[3] > 1) fail(`frame ${i} pose ${j} landmark ${k}: visibility 0 to 1`);
          return { x: q[0], y: q[1], z: q[2], visibility: q[3] };
        });
      }),
    };
  });
  return { meta: m, truth: o.truth, frames };
}

/** Reads and validates a fixture file. `T` is the truth shape the caller expects (not checked). */
export function loadFixture<T = Record<string, unknown>>(path: string): Fixture<T> {
  return parseFixture(JSON.parse(readFileSync(path, "utf8"))) as Fixture<unknown> as Fixture<T>;
}

/** Every fixture file under the root, as absolute paths, sorted. */
export function listFixtures(root = FIXTURE_ROOT): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".json")) out.push(p);
    }
  };
  walk(root);
  return out;
}

/**
 * The movement check fixtures: the .json files under the folders of the v1 tests only
 * (tests/fixtures/<test>/<profile>/<case>.json). The v7 fixtures beside them (gait/, rom/) have their
 * own formats and loaders, so they may be JSON too (CG-23, D-027 item 5).
 */
export function listCheckFixtures(root = FIXTURE_ROOT): string[] {
  return TEST_IDS.flatMap((test) => {
    const dir = join(root, test);
    return existsSync(dir) ? listFixtures(dir) : [];
  });
}

const EMPTY = (): Landmark[] => Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));

/** The fixture as engine frames: poses set, lm the first pose (as CameraPoseSource does), aspect set. */
export function fixtureFrames(fx: Fixture<unknown>): Frame[] {
  return fx.frames.map((f) => ({
    t: f.t,
    lm: f.poses[0] ?? EMPTY(),
    poses: f.poses,
    aspect: fx.meta.aspect,
  }));
}
