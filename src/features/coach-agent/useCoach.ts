/**
 * The live coach hook (product v7 contract 2.11, stream D, step D4): one Live session per coach
 * segment (C-6), prewarmed when the segment's setup card shows, with the event bridge, the tool
 * executor and the local voice fallback. The coach is an enhancement, never a dependency (C-5).
 *
 * Placeholder of step A5 (contract 1.3), replaced by D4: the coach is always off, so every host
 * runs on its buttons and the local voice pack.
 */
import type { CoachOptions, CoachState } from "../../coach/types";

/**
 * null options: coach off (preference off, no consent, flag off, or offline). Prewarms (token and
 * connect) when the segment's setup card shows (bridge rule 8).
 */
export function useCoach(_opts: CoachOptions | null): CoachState {
  return { mode: "off", push() {}, speaking: false, captions: [], end() {} };
}
