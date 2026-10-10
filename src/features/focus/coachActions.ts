/**
 * The range steps' buttons the live coach may press on the person's spoken words (D-036 item 2): the
 * block card's and the movement's «جاهز» (the movement then starts), the result's «التالي» and its
 * «حاول مرة أخرى» while one more try is offered, and «متابعة» once the sit before stand minute is over.
 * Each press is the same controller call as the button's tap. Nothing else: the same joint re-ask, the
 * measurement's questions (the maximum, the pain, what stopped you), a pain stop, the rests and the
 * stop list stay the person's taps and answers. Pure, no DOM.
 */
import { AGAIN, GO_ON, PRESS_SAY } from "../../coach/actions";
import type { ScreenEntry } from "../coach-agent/useScreenActions";
import { itemKey, type RomController } from "./romController";

export interface RomPressDeps {
  clock(): number;
  /** The block card's Ready waits for the camera's model probe (C-10), as its button does. */
  blockWaiting: boolean;
}

/** The buttons of the range step now, keyed by the step, or null when the coach may press nothing. */
export function romScreenActions(ctl: RomController, deps: RomPressDeps): ScreenEntry | null {
  const step = ctl.current;
  const alive = () => ctl.current === step && !ctl.stopList;
  switch (step.kind) {
    case "block":
      return {
        key: `block:${step.block}`,
        alive,
        actions: [
          {
            name: "ready",
            intents: GO_ON,
            say: PRESS_SAY.starting,
            waiting: deps.blockWaiting,
            press: () => !deps.blockWaiting && ctl.ready(deps.clock()),
          },
        ],
      };
    case "setup":
      return {
        key: `setup:${itemKey(step.item)}`,
        alive,
        actions: [
          {
            name: "ready",
            intents: GO_ON,
            say: PRESS_SAY.starting,
            press: () => ctl.ready(deps.clock()),
          },
        ],
      };
    case "result":
      return {
        key: `result:${itemKey(step.item)}`,
        alive,
        actions: [
          ...(ctl.canTryAgain
            ? [
                {
                  name: "again",
                  intents: AGAIN,
                  say: PRESS_SAY.again,
                  press: () => ctl.tryAgain(deps.clock()),
                },
              ]
            : []),
          { name: "next", intents: GO_ON, say: PRESS_SAY.next, press: () => ctl.next(deps.clock()) },
        ],
      };
    case "sit":
      // Only once the minute is over: before that it is a timer the coach never shortens.
      if (step.standing === undefined) return null;
      return {
        key: "sit:standing",
        alive,
        actions: [
          { name: "next", intents: GO_ON, say: PRESS_SAY.continuing, press: () => ctl.next(deps.clock()) },
        ],
      };
    default:
      return null;
  }
}
