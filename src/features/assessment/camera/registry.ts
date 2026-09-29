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

/** The controller of the model's test side if one runs already (the answer screens never start one). */
export function existingController(model: FlowModel): CameraController | null {
  const test = camTestOf(model);
  if (!test) return null;
  const found = entries.get(model.data.tests[test.i]);
  return found && found.side === test.sideIndex ? found.ctrl : null;
}
