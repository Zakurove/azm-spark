/**
 * The controller of the test side on screen, kept outside React (UX spec S34). The camera sequence of
 * one side leaves the camera screen for answers at the phone and comes back (the arm curl practice
 * check S29 and the load step, the chair stand pushed question S48), so the runner, its calibration
 * and the attempts done so far must outlive the screen. One controller per test side of a protocol:
 * a new side, a new test or a new check (a new protocol array) gets a new one.
 */
import type { FlowModel } from "../flowMachine";
import { CameraController, camTestOf } from "./controller";
import type { CamTiming } from "./timing";

const entries = new WeakMap<object, { side: number; ctrl: CameraController }>();
let current: CameraController | null = null;

/** The controller of the model's test side, or null outside a test side. */
export function controllerFor(model: FlowModel, timing: CamTiming): CameraController | null {
  const test = camTestOf(model);
  if (!test) return null;
  const run = model.data.tests[test.i];
  const found = entries.get(run);
  if (found && found.side === test.sideIndex) return found.ctrl;
  const ctrl = new CameraController(model, test, { timing });
  entries.set(run, { side: test.sideIndex, ctrl });
  if (current && current !== ctrl) current.dispose();
  current = ctrl;
  return ctrl;
}

/**
 * The controller of the model's test side if one runs already (the answer screens never start one).
 * On the faint screens after a stop (S38 until its question is answered, S38b) it is the controller
 * of the stopped test, so the check in there can take a raised hand (O30, Q33 (3)).
 */
export function existingController(model: FlowModel): CameraController | null {
  const test = camTestOf(model);
  if (!test) return faintScreen(model) ? faintController(model) : null;
  const found = entries.get(model.data.tests[test.i]);
  return found && found.side === test.sideIndex ? found.ctrl : null;
}

/** S38 before its question is answered, and S38b: the camera stays on (UX spec S38, O30). */
export function faintScreen(model: FlowModel): boolean {
  const s = model.state;
  return s.kind === "faintAsk" || (s.kind === "safety" && s.safety === "faint" && !s.faintAnswered);
}

function faintController(model: FlowModel): CameraController | null {
  const stopped = model.data.stopped;
  if (!current) return null;
  return !stopped || current.test.testId === stopped.testId ? current : null;
}
