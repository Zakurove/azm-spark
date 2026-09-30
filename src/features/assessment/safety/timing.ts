/**
 * Timing of the safety screens and the answer questions (UX spec S38, S41, S42, S43, 4.3, 4.7), from
 * the values in the check data. The Playwright specs drive the timers with a fake clock (page.clock),
 * never with a shorter value.
 */
import { CHECKIN_TIMING } from "../../../engine/checkin";

export const SAFETY_TIMING = {
  /** S43: no answer to the optional check in within 30 s plays one gentle chime (D-016). */
  checkInNoAnswerMs: CHECKIN_TIMING.noAnswerSec * 1000,
  /** S38: the faint question 20 s after S38 opened (R3C-07 (1)). */
  faintAskAfterMs: 20_000,
  /** S38: a sentence being spoken at 20 s is finished first, at most this long (R3C-07 (2)). */
  faintAskSentenceMs: 5_000,
  /** Answer buttons: the chosen answer is read back for 3 s, then commits (4.7). */
  readBackMs: 3000,
  /** The speech of a screen starts 800 ms after focus moves to its heading (S36, 4.3). */
  speechDelayMs: 800,
  /** S42: the rest after a stop for tiredness or something else (check_rest_minute). */
  stopRestSec: 60,
  /**
   * The guard against a double tap: on a screen opened by a press (S41 after STOP, S41 and S43 after
   * a tap there), a press within 600 ms of it opening is ignored (R3C-03 (6)).
   */
  stopArmMs: 600,
} as const;
