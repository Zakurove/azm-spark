/**
 * Step G1 (product v7 contract 8.4): one real model smoke run (src/features/smoke/run.ts), here on a
 * fake focus camera that plays fixture frames. In the browser the camera is the real focus camera
 * (focusCameraSession, the real CameraPoseSource on Chromium's fake camera) and the runners are B's
 * and C's; a runner that is not built yet is reported as such while the page's own readings run.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SmokeRun, romItem, type SmokeCamera } from "../../src/features/smoke/run";
import { parseSmokeSpec, type SmokeSpec } from "../../src/features/smoke/spec";
import { PerfMeter } from "../../src/features/smoke/perf";
import type { RomRunnerLike } from "../../src/features/smoke/romDriver";
import type { Frame, Landmark } from "../../src/engine/types";
import type { GaitViewInput, GaitViewResult } from "../../src/engine/gait/types";
import type { RomRunnerOptions } from "../../src/engine/rom/types";
import { fixtureFrames, loadFixture } from "../fixtures/format";

const spec = (query: string): SmokeSpec => {
  const r = parseSmokeSpec("test-run", query);
  if (!r.ok) throw new Error(r.error);
  return r.spec;
};

/** A focus camera stand in: frames are pushed by the test, the probe answers at once. */
function fakeCamera(model: "full" | "lite" = "full") {
  const frames = new Set<(f: Frame) => void>();
  const statuses = new Set<(s: string, e: string | null) => void>();
  const calls: string[] = [];
  const cam = {
    model,
    session: {
      status: "idle",
      video: null,
      acquire() {
        calls.push("acquire");
        cam.session.status = "running";
        return () => calls.push("release");
      },
      onFrame(fn: (f: Frame) => void) {
        frames.add(fn);
        return () => frames.delete(fn);
      },
      onStatus(fn: (s: string, e: string | null) => void) {
        statuses.add(fn);
        return () => statuses.delete(fn);
      },
    },
    preload(kind: string) {
      calls.push(`preload ${kind}`);
    },
    async probe(kind: string) {
      calls.push(`probe ${kind}`);
      return { model, fps: 29.8, switched: false };
    },
  };
  return {
    camera: cam as unknown as SmokeCamera,
    calls,
    emit: (f: Frame) => frames.forEach((fn) => fn(f)),
    fail: () => statuses.forEach((fn) => fn("error", "denied")),
    get listeners() {
      return frames.size;
    },
  };
}

const notBuilt = (what: string) => () => {
  throw new Error(`${what} is not built yet`);
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("romItem", () => {
  it("is the protocol item of the run's movement, side and position", () => {
    const s = spec("kind=rom&movement=shoulder_abduction&side=right");
    expect(romItem(s as Extract<SmokeSpec, { kind: "rom" }>)).toMatchObject({
      movementId: "shoulder_abduction",
      side: "right",
      region: "shoulder",
      position: "seated",
      block: "seated",
      verdict: "measure",
      normId: "gill_shoulder_abduction",
      graded: true,
      askCanMove: false,
      helperRequired: false,
      approximate: true,
    });
  });
});

describe("a range run", () => {
  const fx = loadFixture(join(__dirname, "../fixtures/shoulder_abduction/chair/raise-right-9x16.json"));
  // The 5 s fixture played three times in a row, as Chromium loops a video.
  const loop = fixtureFrames(fx);
  const frames: Frame[] = [0, 1, 2].flatMap((k) => loop.map((f) => ({ ...f, t: 1000 + k * 5000 + f.t })));

  it("reads the video with the page's trace and reports a runner that is not built", async () => {
    const cam = fakeCamera();
    const run = new SmokeRun(spec("kind=rom&movement=shoulder_abduction&side=right&traceSec=12"), {
      camera: cam.camera,
      createRunner: notBuilt("RomRunner"),
      analyse: notBuilt("analyseGaitView"),
      meter: new PerfMeter(10000),
      gpu: "test gpu",
    });
    const done = run.start();
    await flush();
    for (const f of frames) cam.emit(f);
    const result = await done;
    expect(result.status).toBe("done");
    expect(cam.calls).toEqual(["preload rom", "acquire", "release"]);
    expect(cam.listeners).toBe(0);
    expect(result.model).toEqual({ requested: "full", used: "full", probe: null });
    expect(result.gpu).toBe("test gpu");
    expect(result.rom!.runner).toEqual({ status: "not_built", error: "RomRunner is not built yet" });
    // The trace ran for traceSec of frames.
    expect(result.camera.frames).toBeGreaterThanOrEqual(12 * fx.meta.fps);
    expect(result.camera.frames).toBeLessThan(13 * fx.meta.fps);
    expect(result.camera.fps).toBeCloseTo(15, 0);
    expect(Math.abs(result.rom!.trace.holdDeg! - 150)).toBeLessThan(3);
    expect(result.gait).toBeUndefined();
    expect(result.landmarks).toBeUndefined();
  });

  it("drives a built runner to its end, with the options of the run", async () => {
    const cam = fakeCamera("lite");
    let seen: RomRunnerOptions | null = null;
    let fed = 0;
    const runner = {
      phase: "idle",
      done: false,
      start: () => [],
      feed() {
        fed++;
        if (fed === 40) runner.done = true;
        return [];
      },
      answerCanMove: () => [],
      answerMax: () => ({ accepted: true, events: [] }),
      answerPain: () => ({ accepted: true, action: "continue", events: [] }),
      answerCause: () => ({ accepted: true, events: [] }),
      stop: () => [],
      finish: () => ({ status: "measured", value: 148 }),
    };
    const run = new SmokeRun(
      spec("kind=rom&movement=shoulder_abduction&side=right&model=lite&traceSec=1&frames=1"),
      {
        camera: cam.camera,
        createRunner: (opts) => {
          seen = opts;
          return runner as unknown as RomRunnerLike;
        },
        analyse: notBuilt("analyseGaitView"),
        meter: new PerfMeter(10000),
        gpu: null,
      },
    );
    const done = run.start();
    await flush();
    for (const f of frames.slice(0, 60)) cam.emit(f);
    const result = await done;
    expect(seen).toMatchObject({ poseModel: "lite", askCauseBelow: null, painBefore: 0, mirrored: false });
    expect(seen!.item.movementId).toBe("shoulder_abduction");
    expect(result.rom!.runner).toMatchObject({ status: "done", result: { status: "measured", value: 148 } });
    expect(fed).toBe(40);
    // frames=1 keeps the subject's landmarks for replay off line.
    expect(result.landmarks!.frames.length).toBe(40);
    expect(result.landmarks!.frames[0][1]).toHaveLength(33);
  });

  it("probes the model first when asked to choose (model=auto)", async () => {
    const cam = fakeCamera();
    const run = new SmokeRun(spec("kind=rom&movement=shoulder_abduction&side=right&model=auto&traceSec=1"), {
      camera: cam.camera,
      createRunner: notBuilt("RomRunner"),
      analyse: notBuilt("analyseGaitView"),
      meter: new PerfMeter(10000),
      gpu: null,
    });
    const done = run.start();
    await flush();
    for (const f of frames.slice(0, 40)) {
      cam.emit(f);
      await flush();
    }
    const result = await done;
    expect(cam.calls.slice(0, 3)).toEqual(["preload rom", "acquire", "probe rom"]);
    expect(result.model).toEqual({
      requested: "auto",
      used: "full",
      probe: { model: "full", fps: 29.8, switched: false },
    });
  });

  it("ends with an error when the camera fails", async () => {
    const cam = fakeCamera();
    const run = new SmokeRun(spec("kind=rom&movement=shoulder_abduction&side=right"), {
      camera: cam.camera,
      createRunner: notBuilt("RomRunner"),
      analyse: notBuilt("analyseGaitView"),
      meter: new PerfMeter(10000),
      gpu: null,
    });
    const done = run.start();
    await flush();
    cam.fail();
    const result = await done;
    expect(result.status).toBe("error");
    expect(result.error).toContain("denied");
    expect(cam.calls).toContain("release");
  });
});

describe("a gait run", () => {
  const FPS = 30;
  const pose = (t: number): Landmark[] => {
    const p: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
    const swing = t < 4 ? 0 : 0.08 * Math.sin((2 * Math.PI * t) / 1.2);
    p[0] = { x: 0.52, y: 0.18, z: 0, visibility: 0.99 };
    for (const [i, x, y] of [
      [11, 0.5, 0.3],
      [12, 0.5, 0.3],
      [23, 0.5, 0.52],
      [24, 0.5, 0.52],
      [27, 0.5 + swing, 0.84],
      [28, 0.5 - swing, 0.84],
    ] as const)
      p[i] = { x, y, z: 0, visibility: 0.99 };
    return p;
  };
  const frames: Frame[] = Array.from({ length: 40 * FPS }, (_, i) => {
    const lm = pose(i / FPS);
    return { t: 500 + (1000 * i) / FPS, lm, poses: [lm], aspect: 16 / 9 };
  });
  const query =
    "kind=gait&view=pad_side&nearSide=right&mode=walking_pad&padKmh=3&heightCm=177.6&standFrom=0.5&standTo=3.5&walkFrom=5.2&walkTo=35.2";

  it("captures the windows, runs the engine on them and checks the tracking", async () => {
    const cam = fakeCamera();
    let input: GaitViewInput | null = null;
    const run = new SmokeRun(spec(query), {
      camera: cam.camera,
      createRunner: notBuilt("RomRunner"),
      analyse: (i) => {
        input = i;
        return {
          view: i.view,
          events: [],
          cycles: [],
          metrics: {},
          replay: null,
        } as unknown as GaitViewResult;
      },
      meter: new PerfMeter(10000),
      gpu: null,
    });
    const done = run.start();
    await flush();
    for (const f of frames) cam.emit(f);
    const result = await done;
    expect(cam.calls).toEqual(["preload gait", "acquire", "release"]);
    expect(input).not.toBeNull();
    expect(input!).toMatchObject({ view: "pad_side", nearSide: "right", poseModel: "full", rollDeg: null });
    expect(input!.setup).toEqual({
      mode: "walking_pad",
      aid: "none",
      orthosis: {},
      prosthesis: null,
      shoes: true,
      heightCm: 177.6,
      padSpeedKmh: 3,
      padCorrection: null,
      handrail: "none",
      familiarised: true,
    });
    expect(input!.standing.length).toBe(90);
    expect(input!.frames.length).toBe(900);
    expect(result.gait!.engine).toMatchObject({ status: "done", result: { view: "pad_side" } });
    expect(result.gait!.engine.analyseMs).toBeGreaterThanOrEqual(0);
    expect(result.gait!.harness.cadenceSpm).toBeCloseTo(100, 0);
    expect(result.gait!.tracking).toEqual({ ankles: 1, heels: 1, toes: 1 });
    expect(result.gait!.capture).toMatchObject({ standingFrames: 90, walkFrames: 900 });
  });

  it("reports an engine that is not built, with the tracking check", async () => {
    const cam = fakeCamera();
    const run = new SmokeRun(spec(query), {
      camera: cam.camera,
      createRunner: notBuilt("RomRunner"),
      analyse: notBuilt("The gait analysis"),
      meter: new PerfMeter(10000),
      gpu: null,
    });
    const done = run.start();
    await flush();
    for (const f of frames) cam.emit(f);
    const result = await done;
    expect(result.status).toBe("done");
    expect(result.gait!.engine).toEqual({ status: "not_built", error: "The gait analysis is not built yet" });
    expect(result.gait!.harness.cadenceSpm).toBeCloseTo(100, 0);
  });
});
