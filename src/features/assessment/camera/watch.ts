/**
 * The camera behind the answer screens of a test side (UX spec 4.8 "answer zone states": S29 practice
 * check, S47 pain question, S48 contact, pushed and count questions). The screens of other streams
 * call useCameraWatch(model, dispatch): the check's camera stays on, and the controller of the test
 * side keeps the check in armed with sway and hips drop (no movement and left frame off), and takes a
 * raised hand as fine while S43 or S45 is open. Nothing runs when no camera sequence ran for the side.
 */
import { useEffect, useRef } from "react";
import type { FlowEvent, FlowModel } from "../flowMachine";
import { existingController } from "./registry";
import { useCameraSession } from "./session";

export function useCameraWatch(model: FlowModel, dispatch: (e: FlowEvent) => void): void {
  const ctrl = existingController(model);
  const ref = useRef({ ctrl, dispatch });
  ref.current = { ctrl, dispatch };
  useEffect(() => {
    ctrl?.sync(model, performance.now());
  }, [model, ctrl]);
  useCameraSession((f) => {
    const { ctrl: c, dispatch: d } = ref.current;
    if (!c) return;
    for (const e of c.watch(f, f.t).events) d(e);
  }, !!ctrl);
}
