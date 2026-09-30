/**
 * The left frame carry of the optional check in (UX spec 4.8, D-016): with the setting on, a person
 * who walks out of the picture during a scored attempt or the practice opens the check in, even when
 * the runner ends the attempt before they are fully out. Nothing is asked where no part is armed.
 */
import { describe, expect, it } from "vitest";
import { CameraController, camTestOf, IDLE_ENV } from "../src/features/assessment/camera/controller";
import { camTiming } from "../src/features/assessment/camera/timing";
import type { Frame, Landmark } from "../src/engine/types";
import type { TestId } from "../src/movements/types";
import { atSetup, checkInOn, runFixture } from "./s34-harness";

const mapPoses = (f: Frame, fn: (p: Landmark[]) => Landmark[]): Frame => {
  const poses = (f.poses ?? [f.lm]).map(fn);
  return { ...f, lm: fn(f.lm), poses };
};

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
        const run = runFixture(checkInOn(atSetup(w.testId, w.position)), w.fixture, 150, {
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
        expect(run.model.overlay).toEqual({ kind: "checkIn" });
        expect(run.events).toContainEqual({ type: "TRIGGER", trigger: "left_frame" });
      });
    }
  }

  it("a person who stays out of the picture on the setup check is not asked (no armed part)", () => {
    const m = checkInOn(atSetup("shoulder_abduction"));
    const ctrl = new CameraController(m, camTestOf(m)!, { timing: camTiming(true) });
    const triggers = [];
    for (let t = 1000; t <= 12_000; t += 100)
      triggers.push(
        ...ctrl.frame({ t, lm: [], poses: [] }, IDLE_ENV, t).events.filter((e) => e.type === "TRIGGER"),
      );
    expect(triggers).toEqual([]);
  });
});
