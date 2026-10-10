/**
 * The buttons the live coach may press for the person (D-036 item 2): on the person's spoken words
 * («جاهز», «يلا», «التالي», «مرة ثانية», "I'm ready", "next", "again"), next_step presses the button on
 * the screen that answers that intent, exactly as a tap would, and the host answers what it pressed so
 * the coach can say it in a few words ("starting now").
 *
 * Each screen registers its own buttons here while it shows (ScreenActions.show): what the button does,
 * the intents it answers, and the copy key of what happened. A screen with nothing the coach may press
 * (a question, a pain score, the stop list, the emergency screen, a safety checklist) registers nothing,
 * so next_step can never answer a question or a safety step for the person, nor press Stop. The host
 * still refuses every press over a safety step (pressNextStep).
 *
 * The answer guard (S0-2, tools.ts AnswerGuard) takes a press only when the person spoke while this very
 * screen showed: `current` is the id of the screen showing now, and it is null as soon as the app has
 * moved past it (`alive`), so a second call that arrives after the first press never presses the next
 * screen's button. Pure, no DOM.
 */
import type { CoachIntent, ToolResult } from "./types";

/** next_step's intents, as the declaration lists them. */
export const COACH_INTENTS: readonly CoachIntent[] = ["ready", "start", "next", "continue", "again"];
/** The intents of going on: a Ready, Start, Next or Continue button answers each of them. */
export const GO_ON: readonly CoachIntent[] = ["ready", "start", "next", "continue"];
/** A try again button. */
export const AGAIN: readonly CoachIntent[] = ["again"];

/** The copy keys a press answers with (the coach says them in its own words). */
export const PRESS_SAY = {
  /** The step starts now. */
  starting: "starting",
  /** The next step is on the screen. */
  next: "next_one",
  /** One more try. */
  again: "trying_again",
  /** They go on. */
  continuing: "continuing",
  /** The button waits for the app (the camera is getting ready): ask them to wait a moment. */
  wait: "one_moment",
} as const;

/** One button of the screen the coach may press. */
export interface ScreenAction {
  /** The button's name on the screen (its data-action): ready, start, next, try_again, continue. */
  name: string;
  /** The spoken intents it answers. */
  intents: readonly CoachIntent[];
  /** The copy key of what happened once pressed (PRESS_SAY). */
  say: string;
  /** Disabled like its button (the camera still getting ready): the press is refused, one_moment. */
  waiting?: boolean;
  /** What the button does on a tap; false when it could not act now. */
  press(): boolean | void;
}

interface Entry {
  id: number;
  key: string;
  actions: () => readonly ScreenAction[];
  alive: () => boolean;
}

/** The refusal of a press with nothing on the screen for it: the person taps, or says it again. */
export const NOTHING_TO_PRESS: ToolResult = { accepted: false, reason: "not_allowed", say: "tap_to_confirm" };

export class ScreenActions {
  private entry: Entry | null = null;
  private seq = 0;

  /**
   * The screen `key` shows these buttons; `alive` is false once the app has moved past the screen
   * (before the page could take its buttons away). The same key keeps its id (a new render of the
   * screen); another key is a new screen. Returns the way to take them away again.
   */
  show(key: string, actions: () => readonly ScreenAction[], alive: () => boolean = () => true): () => void {
    if (this.entry?.key === key) {
      this.entry.actions = actions;
      this.entry.alive = alive;
    } else this.entry = { id: ++this.seq, key, actions, alive };
    const id = this.entry.id;
    return () => {
      if (this.entry?.id === id) this.entry = null;
    };
  }

  /** The id of the screen showing now with its buttons, or null (none, or the app moved past it). */
  get current(): number | null {
    const e = this.entry;
    if (!e) return null;
    try {
      return e.alive() ? e.id : null;
    } catch {
      return null;
    }
  }

  /** The screen's key, for the snapshot and the tests. */
  get key(): string | null {
    return this.current === null ? null : (this.entry?.key ?? null);
  }

  /** The buttons of the screen showing now (none once the app moved past it). */
  list(): readonly ScreenAction[] {
    if (this.current === null) return [];
    try {
      return this.entry?.actions() ?? [];
    } catch {
      return [];
    }
  }

  /** The button that answers `intent` on the screen now, or null. */
  find(intent: CoachIntent): ScreenAction | null {
    return this.list().find((a) => a.intents.includes(intent)) ?? null;
  }

  /** Presses the button for `intent`, as a tap would; the answer says what happened. Never throws. */
  press(intent: CoachIntent): ToolResult {
    const action = this.find(intent);
    if (!action) return NOTHING_TO_PRESS;
    if (action.waiting) return { accepted: false, reason: "wrong_phase", say: PRESS_SAY.wait };
    let done: boolean | void;
    try {
      done = action.press();
    } catch {
      return { accepted: false, reason: "not_allowed" };
    }
    if (done === false) return { accepted: false, reason: "wrong_phase" };
    return { accepted: true, say: action.say, data: { pressed: action.name } };
  }
}

/**
 * next_step on a host (D-036 item 2, replacing C-16 for setup and next steps): never over a safety
 * step or after a safety stop (the stop list, a pain stop, the emergency screen stay the person's),
 * else the screen's button for the intent.
 */
export function pressNextStep(
  actions: ScreenActions,
  s: { step: { kind: string }; stopped: boolean },
  intent: CoachIntent,
): ToolResult {
  if (s.stopped || s.step.kind === "safety")
    return { accepted: false, reason: "safety_stop", say: "tap_to_confirm" };
  return actions.press(intent);
}
