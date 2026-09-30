/**
 * Test harness of the camera screen (S34): a guest flow at the booth brought to the camera part of
 * one test, and a loop that plays a camera fixture through the CameraController and the real flow
 * reducer, as the screen does.
 */
import {
  flowReducer,
  initialModel,
  type FlowConfig,
  type FlowEvent,
  type FlowModel,
} from "../src/features/assessment/flowMachine";
import {
  CameraController,
  camTestOf,
  IDLE_ENV,
  type CamEnv,
  type CamOutput,
} from "../src/features/assessment/camera/controller";
import { camFixtureFrames } from "../src/features/assessment/camera/e2e/fixtures";
import { fixtureFrames } from "../src/features/assessment/e2e/FixturePoseSource";
import { camTiming } from "../src/features/assessment/camera/timing";
import type { Frame } from "../src/engine/types";
import type { TestId } from "../src/movements/types";
import { benign } from "./precheck-fixtures";

export const GUEST: FlowConfig = { mode: "guest", booth: true, homeOpen: false, desktop: false };
export const NOW = Date.UTC(2026, 8, 28, 9, 0, 0);

export function play(m: FlowModel, ...events: FlowEvent[]): FlowModel {
  return events.reduce((acc, e) => flowReducer(acc, { now: NOW, ...e }), m);
}

/** A guest at the booth through the steps and the pre-check to the plan. */
export function guestPlan(position: "chair" | "standing" | "wheelchair" = "chair"): FlowModel {
  let m = play(
    initialModel(GUEST),
    { type: "START" },
    { type: "GUEST_PATH", path: "full" },
    { type: "ADULT_YES" },
    { type: "GUEST_ANSWER", step: 1, value: position },
    { type: "GUEST_ANSWER", step: 2, value: "none" },
    { type: "GUEST_ANSWER", step: 3, value: ["none"] },
    { type: "GUEST_NEXT" },
    { type: "GUEST_ANSWER", step: 4, value: "yes" },
    { type: "GUEST_ANSWER", step: 5, value: ["none"] },
    { type: "GUEST_NEXT" },
    { type: "GUEST_ANSWER", step: 6, value: ["none"] },
    { type: "GUEST_NEXT" },
    { type: "CONTINUE" },
    { type: "SOUND_RESULT", mode: "voice" },
    { type: "PRECHECK_START" },
  );
  for (let k = 0; k < 60 && m.state.kind === "question"; k++) {
    const id = (m.state as { id: string }).id;
    m = play(m, { type: "ANSWER", id, value: benign(id) });
  }
  if (m.state.kind === "warnings") m = play(m, { type: "CONTINUE" });
  return m;
}

/** The optional check in switched on (D-016), as a person's setting would at home. */
export const checkInOn = (m: FlowModel): FlowModel => ({ ...m, data: { ...m.data, checkIn: true } });

/** The flow at the setup check of `testId` (its first side), the camera primer passed. */
export function atSetup(testId: TestId, position: "chair" | "standing" | "wheelchair" = "chair"): FlowModel {
  const m = guestPlan(position);
  const i = m.data.tests.findIndex((t) => t.testId === testId);
  if (i < 0) throw new Error(`${testId} is not in the ${position} plan`);
  return play(
    { ...m, state: { kind: "test.instruction", i } },
    { type: "READY" },
    ...(m.data.cameraUsed ? [] : [{ type: "PREP_NEXT" } as FlowEvent]),
  );
}

export interface Run {
  model: FlowModel;
  ctrl: CameraController;
  events: FlowEvent[];
  cues: string[];
  notes: string[];
  /** Flow state kinds in the order they were entered. */
  kinds: string[];
}

/**
 * Plays `fixture` in a loop for `seconds` through a controller for the model's test side, the way
 * the screen does: frames in, flow events applied with the real reducer, the model synced back.
 * `stopWhen` ends the run early; `onFrame` may change the model (answers at the phone).
 */
export function runFixture(
  start: FlowModel,
  fixture: string,
  seconds: number,
  opts: {
    stopWhen?: (m: FlowModel) => boolean;
    env?: (t: number) => Partial<CamEnv>;
    frames?: (t: number, f: Frame) => Frame;
    before?: (m: FlowModel, t: number) => FlowModel;
    /** After each frame: the controller and the model, for snapshots. */
    after?: (ctrl: CameraController, m: FlowModel, t: number) => void;
    fast?: boolean;
  } = {},
): Run {
  const { frames, durationMs } = framesOf(fixture);
  const test = camTestOf(start);
  if (!test) throw new Error("not a camera state");
  const ctrl = new CameraController(start, test, { timing: camTiming(opts.fast ?? true) });
  let model = start;
  const run: Run = { model, ctrl, events: [], cues: [], notes: [], kinds: [start.state.kind] };
  const apply = (out: CamOutput) => {
    for (const e of out.events) {
      run.events.push(e);
      model = flowReducer(model, { now: NOW, ...e });
      const k = model.state.kind;
      if (run.kinds[run.kinds.length - 1] !== k) run.kinds.push(k);
    }
    run.cues.push(...out.cues.map((c) => (c.speak ? c.id : `(${c.id})`)));
    run.notes.push(...out.notes.map((n) => n.key ?? `text:${n.text?.en ?? ""}`));
    if (out.events.length) apply(ctrl.sync(model, lastT));
  };
  const T0 = 10_000;
  let lastT = T0;
  apply(ctrl.sync(model, T0));
  for (let lap = 0; lap * durationMs < seconds * 1000; lap++) {
    for (const f0 of frames) {
      const t = T0 + lap * durationMs + f0.t;
      if (t - T0 > seconds * 1000) break;
      lastT = t;
      if (opts.before) {
        const next = opts.before(model, t);
        if (next !== model) {
          model = next;
          const k = model.state.kind;
          if (run.kinds[run.kinds.length - 1] !== k) run.kinds.push(k);
          apply(ctrl.sync(model, t));
        }
      }
      const f = opts.frames ? opts.frames(t, { ...f0, t }) : { ...f0, t };
      apply(ctrl.frame(f, { ...IDLE_ENV, ...(opts.env?.(t) ?? {}) }, t));
      run.model = model;
      opts.after?.(ctrl, model, t);
      if (opts.stopWhen?.(model)) return run;
    }
  }
  run.model = model;
  return run;
}

/**
 * The frames of a fixture: the camera scripts of the S34 browser flows (camera/e2e/fixtures.ts), or,
 * with the prefix "fx:", a name of the foundation FixturePoseSource (the catalogue and "empty").
 */
export function framesOf(name: string): { frames: Frame[]; durationMs: number } {
  if (!name.startsWith("fx:")) return camFixtureFrames(name);
  const frames = fixtureFrames(name.slice(3));
  const last = frames[frames.length - 1]?.t ?? 0;
  return { frames, durationMs: last + 1000 / 15 };
}
