/**
 * Check in arming under the answer overlays and the left frame carry (UX spec 4.8, council O34-6 (3)):
 *   - sway and hips drop stay armed under S41 (the stop list), S44 (go on) and the skip dialog over a
 *     camera state, and under the stop list over S47 and S48; a trigger there opens S43, and "I am
 *     fine" gives the overlay back;
 *   - a person who walks out of the picture during a scored attempt or the practice opens the check in
 *     (left frame), even when the runner ends the attempt before they are fully out.
 */
import { describe, expect, it } from "vitest";
import { flowReducer, type FlowModel, type Overlay } from "../src/features/assessment/flowMachine";
import { CameraController, camTestOf, IDLE_ENV } from "../src/features/assessment/camera/controller";
import { camTiming } from "../src/features/assessment/camera/timing";
import type { Frame, Landmark } from "../src/engine/types";
import type { TestId } from "../src/movements/types";
import { atSetup, NOW, play, runFixture } from "./s34-harness";

/* ------------------------------------------------------------------ frame transforms */

const mapPoses = (f: Frame, fn: (p: Landmark[]) => Landmark[]): Frame => {
  const poses = (f.poses ?? [f.lm]).map(fn);
  return { ...f, lm: fn(f.lm), poses };
};

/** The upper body turned `deg` about the mid hip (in pixel space): a slump to the side. */
function slump(f: Frame, deg: number): Frame {
  const a = f.aspect ?? 1;
  const r = (deg * Math.PI) / 180;
  return mapPoses(f, (p) => {
    if (p.length < 33) return p;
    const hx = ((p[23].x + p[24].x) / 2) * a;
    const hy = (p[23].y + p[24].y) / 2;
    return p.map((q, i) => {
      if (i > 22) return q;
      const x = q.x * a - hx;
      const y = q.y - hy;
      return {
        ...q,
        x: (hx + x * Math.cos(r) - y * Math.sin(r)) / a,
        y: hy + x * Math.sin(r) + y * Math.cos(r),
      };
    });
  });
}

/** The whole body lower in the picture: a slide toward the floor. */
const drop = (f: Frame, dy: number): Frame => mapPoses(f, (p) => p.map((q) => ({ ...q, y: q.y + dy })));

/** A gradual walk out to the side over `ms`, from `t0`: points past the edge are not seen. */
function walkOut(f: Frame, t: number, t0: number, ms: number): Frame {
  const k = Math.max(0, Math.min(1, (t - t0) / ms));
  const dx = k * 1.3;
  return mapPoses(f, (p) =>
    p.map((q) => {
      const x = q.x + dx;
      return { ...q, x, visibility: x > 1 ? 0 : q.visibility };
    }),
  );
}

/* ------------------------------------------------------------------ the answer overlays */

type Open = { name: string; open(m: FlowModel): FlowModel; back: Overlay["kind"] };
const OVERLAYS: Open[] = [
  { name: "S41 stop list", open: (m) => play(m, { type: "STOP" }), back: "stopList" },
  {
    name: "S44 go on",
    open: (m) => ({ ...m, overlay: { kind: "goOn", afterAlarm: false, canRedo: true } }),
    back: "goOn",
  },
  { name: "skip dialog", open: (m) => ({ ...m, overlay: { kind: "skipDialog" } }), back: "skipDialog" },
];

describe("sway and hips drop stay armed under the answer overlays (4.8)", () => {
  for (const o of OVERLAYS) {
    for (const trigger of ["sway", "hips_drop"] as const) {
      it(`${trigger} under ${o.name} opens the check in, and fine gives ${o.back} back`, () => {
        let openedAt: number | null = null;
        const run = runFixture(atSetup("shoulder_abduction"), "fx:seated-still", 40, {
          stopWhen: (m) => m.overlay?.kind === "checkIn",
          before: (m, t) => {
            if (openedAt === null && m.state.kind === "cam.practice") {
              openedAt = t;
              return o.open(m);
            }
            return m;
          },
          frames: (t, f) =>
            openedAt !== null && t > openedAt + 1500
              ? trigger === "sway"
                ? slump(f, Math.min(40, ((t - openedAt - 1500) / 1000) * 40))
                : drop(f, Math.min(0.25, ((t - openedAt - 1500) / 1500) * 0.25))
              : f,
        });
        expect(openedAt).not.toBeNull();
        expect(run.model.overlay).toMatchObject({ kind: "checkIn", trigger });
        const fine = flowReducer(run.model, { now: NOW, type: "FINE", via: "button" });
        // A hips drop routes to the stop list whatever it opened over (O42).
        expect(fine.overlay?.kind).toBe(trigger === "hips_drop" ? "stopList" : o.back);
      });
    }
  }

  it("nothing fires under an overlay while the person sits still", () => {
    let openedAt: number | null = null;
    const run = runFixture(atSetup("shoulder_abduction"), "fx:seated-still", 60, {
      before: (m, t) => {
        if (openedAt === null && m.state.kind === "cam.practice") {
          openedAt = t;
          return play(m, { type: "STOP" });
        }
        return m;
      },
    });
    expect(run.model.overlay?.kind).toBe("stopList");
  });
});

describe("the stop list over S47 and S48 keeps sway and hips drop armed (watch)", () => {
  for (const kind of ["after.contact", "after.pushed"] as const) {
    it(`a slump under the stop list over ${kind} opens the check in`, () => {
      // Calibrate on the setup and practice of the side lean, then move to the answer state.
      const start = atSetup("trunk_control_seated");
      const run = runFixture(start, "fx:seated-still", 20, {
        stopWhen: (m) => m.state.kind === "cam.practice",
      });
      const test = camTestOf(start)!;
      const ctrl = run.ctrl;
      let m: FlowModel = { ...run.model, overlay: null, state: { kind, i: test.i, side: test.sideIndex } };
      m = play(m, { type: "STOP" });
      expect(m.overlay?.kind).toBe("stopList");
      ctrl.sync(m, 40_000);
      const { frames } = { frames: runFrames() };
      let t = 40_000;
      let opened: FlowModel | null = null;
      for (let k = 0; k < 90 && !opened; k++) {
        t += 1000 / 15;
        const out = ctrl.watch(slump({ ...frames[k % frames.length], t }, 40), t);
        for (const e of out.events) {
          m = flowReducer(m, { now: NOW, ...e });
          if (m.overlay?.kind === "checkIn") opened = m;
        }
      }
      expect(opened?.overlay).toMatchObject({ kind: "checkIn", from: "stopList", trigger: "sway" });
    });
  }
});

/** A still seated person (the foundation fixture). */
function runFrames(): Frame[] {
  const run = { frames: [] as Frame[] };
  runFixture(atSetup("shoulder_abduction"), "fx:seated-still", 1, {
    frames: (_t, f) => {
      run.frames.push(f);
      return f;
    },
  });
  return run.frames;
}

/* ------------------------------------------------------------------ left frame carry */

type WalkCase = { testId: TestId; fixture: string; position: "chair" | "standing"; part: string };
const WALKS: WalkCase[] = [
  { testId: "shoulder_abduction", fixture: "abd-9x16", position: "chair", part: "cam.practice" },
  { testId: "shoulder_abduction", fixture: "abd-9x16", position: "chair", part: "cam.measure" },
  { testId: "trunk_control_seated", fixture: "lean-9x16", position: "chair", part: "cam.practice" },
  { testId: "trunk_control_seated", fixture: "lean-9x16", position: "chair", part: "cam.measure" },
  { testId: "arm_curl_30s", fixture: "curl-9x16", position: "chair", part: "cam.practice" },
  { testId: "arm_curl_30s", fixture: "curl-9x16", position: "chair", part: "cam.measure" },
  { testId: "chair_stand_30s", fixture: "stand-9x16", position: "standing", part: "cam.practice" },
  { testId: "chair_stand_30s", fixture: "stand-9x16", position: "standing", part: "cam.measure" },
];

describe("left frame: a gradual walk out during an armed part opens the check in (4.8)", () => {
  for (const w of WALKS) {
    for (const ms of [1500, 4000]) {
      it(`${w.testId} in ${w.part}, walking out over ${ms / 1000} s`, () => {
        let t0: number | null = null;
        const run = runFixture(atSetup(w.testId, w.position), w.fixture, 150, {
          fast: false,
          stopWhen: (m) => m.overlay?.kind === "checkIn",
          before: (m, t) => {
            // Walk out 1.5 s into the part (the runner is scoring by then).
            if (t0 === null && m.state.kind === w.part) t0 = t + 1500;
            return m;
          },
          frames: (t, f) => (t0 !== null && t >= t0 ? walkOut(f, t, t0, ms) : f),
        });
        expect(t0).not.toBeNull();
        expect(run.model.overlay).toMatchObject({ kind: "checkIn", trigger: "left_frame" });
      });
    }
  }

  it("a person who stays out of the picture on the setup check is not asked (no armed part)", () => {
    const ctrl = new CameraController(
      atSetup("shoulder_abduction"),
      camTestOf(atSetup("shoulder_abduction"))!,
      {
        timing: camTiming(true),
      },
    );
    const out = ctrl.frame({ t: 1000, lm: [], poses: [] }, IDLE_ENV, 1000);
    expect(out.events.filter((e) => e.type === "TRIGGER")).toEqual([]);
  });
});
