/**
 * The local voice of a coached segment (product v7 contract 2.11 LocalVoice, C-5, bridge rules 1 to 3,
 * stream D, step D4).
 *
 * There is none any more. The v7 checks have had none since D-036 item 1 (only the Live coach speaks;
 * with no coach the screens are silent and carry every instruction), and D-038 item 3 took the recorded
 * voice out of every exercise and workout too (the counts, the corrections, the stop line): every
 * coached segment gives the coach SILENT_VOICE. The bridge keeps its local voice rules for the
 * LocalVoice interface; with this voice they say nothing.
 */
import type { LocalVoice } from "../../coach/types";

/** No local voice at all (D-036 item 1, D-038 item 3): the screens carry every line, silently. */
export const SILENT_VOICE: LocalVoice = Object.freeze({
  say: () => undefined,
  stopAll: () => undefined,
  playing: false,
  playingSafety: false,
  onPlaying: () => () => undefined,
});
