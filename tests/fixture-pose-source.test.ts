/**
 * Contract v3 K: FixturePoseSource plays fixture frames with poses and aspect, and exists only on a
 * VITE_E2E=1 build. The production build is made here (vite build, about a second) and searched for
 * the source's name in every emitted file; the E2E build must contain it, so the search is proven to
 * find the marker when the code is there.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { build } from "vite";
import {
  FIXTURE_NAMES,
  FIXTURE_SOURCE_NAME,
  FixturePoseSource,
  fixtureFrames,
  fixtureSpec,
} from "../src/features/assessment/e2e/FixturePoseSource";
import type { Frame } from "../src/engine/types";

const ROOT = join(__dirname, "..");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

/** input: an entry module instead of index.html (the pose source factory on its own). */
async function bundle(e2e: boolean, input?: string): Promise<string> {
  const outDir = mkdtempSync(join(tmpdir(), e2e ? "azm-e2e-build-" : "azm-prod-build-"));
  dirs.push(outDir);
  const before = process.env.VITE_E2E;
  if (e2e) process.env.VITE_E2E = "1";
  else delete process.env.VITE_E2E;
  try {
    await build({
      root: ROOT,
      configFile: join(ROOT, "vite.config.ts"),
      logLevel: "silent",
      mode: "production",
      build: {
        outDir,
        emptyOutDir: true,
        copyPublicDir: false,
        ...(input
          ? { rolldownOptions: { input: join(ROOT, input), preserveEntrySignatures: "strict" as const } }
          : {}),
      },
    });
  } finally {
    if (before === undefined) delete process.env.VITE_E2E;
    else process.env.VITE_E2E = before;
  }
  return filesUnder(outDir)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

describe("FixturePoseSource in the bundles", () => {
  it("the production build contains no FixturePoseSource", async () => {
    const prod = await bundle(false);
    expect(prod.length).toBeGreaterThan(10_000);
    expect(prod).not.toContain(FIXTURE_SOURCE_NAME);
    expect(prod).not.toContain("e2eFixture");
    expect(prod).not.toContain("e2eGallery");
    expect(prod).not.toContain("e2eDispatch");
  }, 60_000);

  it("the E2E build contains it (the search finds the marker when the code is there)", async () => {
    const e2e = await bundle(true);
    expect(e2e).toContain(FIXTURE_SOURCE_NAME);
  }, 60_000);

  // The camera screens import createCheckPoseSource; its E2E branch must go even when the factory
  // itself is in the production bundle.
  it("the pose source factory keeps the camera and drops the fixture branch in production", async () => {
    const factory = "src/features/assessment/poseSourceFactory.ts";
    const prod = await bundle(false, factory);
    expect(prod).toContain("getUserMedia");
    expect(prod).not.toContain(FIXTURE_SOURCE_NAME);
    expect(await bundle(true, factory)).toContain(FIXTURE_SOURCE_NAME);
  }, 60_000);
});

describe("FixturePoseSource playback", () => {
  it("knows the catalogue, the presets and the empty room", () => {
    expect(FIXTURE_NAMES).toContain("shoulder_abduction/chair/raise-right-9x16");
    expect(FIXTURE_NAMES).toContain("seated-still");
    expect(FIXTURE_NAMES).toContain("empty");
    expect(fixtureSpec("nope")).toBeNull();
    expect(() => fixtureFrames("nope")).toThrow(RangeError);
  });

  it("frames carry poses and the aspect, with lm the first pose", () => {
    const frames = fixtureFrames("shoulder_abduction/wheelchair/raise-left-16x9");
    expect(frames.length).toBeGreaterThan(30);
    expect(frames[0].aspect).toBeCloseTo(16 / 9, 3);
    expect(frames[0].poses?.[0]).toBe(frames[0].lm);
    const empty = fixtureFrames("empty");
    expect(empty.every((f) => f.poses?.length === 0)).toBe(true);
  });

  it("plays in real time, in order, and loops or stops", async () => {
    let now = 0;
    const ticks: (() => void)[] = [];
    const clock = {
      now: () => now,
      every: (_: number, fn: () => void) => (ticks.push(fn), () => void ticks.splice(0)),
    };
    const got: Frame[] = [];
    const once = new FixturePoseSource("seated-still", { loop: false, clock });
    await once.start((f) => got.push(f));
    now = 1000;
    ticks[0]();
    const firstSecond = got.length;
    expect(firstSecond).toBeGreaterThan(10);
    expect(firstSecond).toBeLessThan(20);
    expect(got.every((f, i) => i === 0 || f.t >= got[i - 1].t)).toBe(true);
    now = 60_000;
    ticks[0]?.();
    expect(got.length).toBe(once.frames.length);
    expect(ticks).toHaveLength(0);

    const looped: Frame[] = [];
    const loop = new FixturePoseSource("seated-still", {
      clock: { ...clock, every: (_: number, fn: () => void) => (ticks.push(fn), () => undefined) },
    });
    now = 0;
    await loop.start((f) => looped.push(f));
    now = 13_000;
    ticks[0]();
    expect(looped.length).toBeGreaterThan(loop.frames.length * 2);
  });
});
