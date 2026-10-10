/**
 * The walk's buttons the live coach may press on the person's spoken words (D-036 item 2): the
 * intro's Start, the clear path's and the phone placement's Ready, the pad's «the person is on the
 * belt» and «I am walking», «I have finished» while walking, the stance's place, walk again after a
 * pain report below the stop rule, the calm «try once more» (again) or its go on, a failed save's try
 * again, and «متابعة» on the result. Each press is the controller call the button makes on a tap.
 *
 * Never: the walking pad's safety checklist and «the pad has stopped» (safety confirmations the person
 * or the helper taps), the mode, the shoes and brace, the front view offer and the pad's speed
 * (questions), a recording, a pain stop or the stop list. Pure, no DOM.
 */
import { AGAIN, GO_ON, PRESS_SAY, type ScreenAction } from "../../coach/actions";
import type { ScreenEntry } from "../coach-agent/useScreenActions";
import type { GaitController, GaitStepId } from "./controller";

/** What a step's button does, said and answered (the steps not listed have none the coach may press). */
type GaitPress = Omit<ScreenAction, "press" | "waiting"> & { press(ctl: GaitController, t: number): boolean };

const confirm = (ctl: GaitController, t: number) => ctl.confirm(t);
const leave = (ctl: GaitController) => {
  ctl.leave();
  return ctl.leaving;
};

export const GAIT_PRESS: Partial<Record<GaitStepId, GaitPress | readonly GaitPress[]>> = {
  intro: { name: "start", intents: GO_ON, say: PRESS_SAY.starting, press: confirm },
  clear_path: { name: "ready", intents: GO_ON, say: PRESS_SAY.next, press: confirm },
  place: { name: "ready", intents: GO_ON, say: PRESS_SAY.starting, press: confirm },
  pad_on: { name: "ready", intents: GO_ON, say: PRESS_SAY.next, press: confirm },
  pad_start: { name: "ready", intents: GO_ON, say: PRESS_SAY.starting, press: confirm },
  walk_again: { name: "walk_again", intents: [...AGAIN, ...GO_ON], say: PRESS_SAY.starting, press: confirm },
  // «I have finished» (D-036 item 6): the recording is read now with what it holds.
  walk: {
    name: "finish",
    intents: ["next", "continue"],
    say: PRESS_SAY.continuing,
    press: (ctl, t) => ctl.finishWalk(t),
  },
  // The calm «try once more»: again walks it again; next or continue goes on with what it holds.
  retry: [
    {
      name: "try_again",
      intents: [...AGAIN, "ready", "start"],
      say: PRESS_SAY.again,
      press: (ctl, t) => ctl.retry(true, t),
    },
    {
      name: "go_on",
      intents: ["next", "continue"],
      say: PRESS_SAY.continuing,
      press: (ctl, t) => ctl.retry(false, t),
    },
  ],
  stance_place: { name: "ready", intents: GO_ON, say: PRESS_SAY.starting, press: confirm },
  save_error: {
    name: "save_again",
    intents: AGAIN,
    say: PRESS_SAY.again,
    press: (ctl, t) => ctl.saveAgain(t),
  },
  nothing: { name: "continue", intents: GO_ON, say: PRESS_SAY.continuing, press: leave },
  done: { name: "continue", intents: GO_ON, say: PRESS_SAY.continuing, press: leave },
};

/** The buttons of the walk's step now, keyed by the step, or null when the coach may press nothing. */
export function gaitScreenActions(ctl: GaitController, clock: () => number): ScreenEntry | null {
  const step = ctl.current;
  const entry = GAIT_PRESS[step.id];
  if (!entry || ctl.stopList || ctl.stopped) return null;
  const presses: readonly GaitPress[] = Array.isArray(entry) ? entry : [entry as GaitPress];
  return {
    key: `${step.id}:${step.rec ?? "none"}`,
    alive: () => ctl.current === step && !ctl.stopList && !ctl.stopped,
    actions: presses.map((p) => ({
      name: p.name,
      intents: p.intents,
      say: p.say,
      press: () => p.press(ctl, clock()),
    })),
  };
}
