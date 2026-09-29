/**
 * Timing of the stop list, the check in, the alarm and the answer questions (UX spec 2.6, 4.7, 4.8,
 * S38b, S41, S43, S45, S47), from the council values in the check data and the engine (CHECKIN_TIMING).
 * Every timer can end in an alarm, so none is shortened here; the Playwright specs drive them with a
 * fake clock (page.clock), never with a shorter value.
 */
import { CHECKIN_TIMING } from "../../../engine/checkin";
import { CHECK_DATA, stopFollowUp } from "../../../movements/assessments";

export const SAFETY_TIMING = {
  /** S41: no answer to the stop list within 30 s runs the check in (Q31 (2)). */
  stopListNoAnswerMs: CHECK_DATA.stopRouting.noAnswerSec * 1000,
  /** S38b: no answer to the faint question within 30 s runs the check in (Q33 (3)). */
  faintNoAnswerMs: stopFollowUp("sf_faint_loc").noAnswerSec * 1000,
  /** S43: a soft chime and the cue again (O34-3, 4.8). */
  checkInRepeatMs: CHECKIN_TIMING.repeatSec * 1000,
  /** S43: no response within 15 s opens the alarm (Q31, tune at the booth). */
  checkInAlarmMs: CHECKIN_TIMING.noResponseSec * 1000,
  /** S45: the tone starts at 30% and fades in to full over 3 s (startle and spasm, S45). */
  alarmFadeMs: 3000,
  alarmStartVolume: 0.3,
  /** Android: vibrate 600 ms on, 300 ms off, repeating (S45). */
  vibration: [600, 300] as const,
  /** S38: the faint question 20 s after S38 opened, or when its speech ends, whichever is first. */
  faintAskAfterMs: 20_000,
  /** Answer zones: the chosen answer is read back for 3 s, then commits (4.7). */
  readBackMs: 3000,
  /** The speech of a screen starts 800 ms after focus moves to its heading (S36, 4.3). */
  speechDelayMs: 800,
  /** S42: the rest after a stop for tiredness or something else (check_rest_minute). */
  stopRestSec: 60,
  /** S41: a row press within 600 ms of a list opened by a press (a double tap on STOP) is ignored. */
  stopArmMs: 600,
  /** S45: «أنا بخير» within 800 ms of an alarm opened by a press, near that press, is ignored (DoD). */
  fineArmMs: 800,
  /** How near the opening press a second press counts as the same double tap (a finger, a tremor). */
  armRadiusPx: 32,
} as const;

/**
 * A fine given to the camera (the zone, a raised hand) rather than by a tap or speech: one extra 30 s
 * no answer timer follows it (O34-1 (6)); after a tap none does (O14).
 */
export const cameraFine = (via: string | undefined): boolean => via === "zone" || via === "raisedHand";

/**
 * How the last "I am fine" was given (the button, the zone, a raised hand), noted where FINE is sent:
 * the check in and alarm buttons, and the camera screens for a camera fine. S44 reads it when it opens,
 * because the flow's "go on" overlay does not keep it (O34-1 (6)).
 */
let lastFine: string | null = null;
export function noteFine(via: string): void {
  lastFine = via;
}
export function lastFineVia(): string | null {
  return lastFine;
}
