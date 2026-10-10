/**
 * The step kind rules every coach host applies to the control tools (product v7 contract C-16 and the
 * 2.11 host table, stream D, step D4), shared by the session host (D), and open to the focus
 * RomController (B3) and the GaitController (C4), so the coach can never restart a pause made on the
 * screen or anything after a safety stop. Each function returns the refusal to send back, or null when
 * the host should apply the call. next_step is no longer a step kind rule: it presses the screen's own
 * button on the person's spoken words (D-036 item 2, src/coach/actions.ts pressNextStep). Pure, no DOM.
 */
import type { CoachStepKind, CoachStopReason, ToolResult } from "../../coach/types";

/** Who paused the step: the coach (resume may end it) or the screen (only the screen ends it). */
export type PausedBy = "coach" | "screen" | null;

/** What the control rules read from a host. */
export interface HostControl {
  step: { kind: CoachStepKind; finished: boolean };
  pausedBy: PausedBy;
  /** A safety stop ended the activity; the coach never resumes it (rule 1, C-16). */
  stopped: boolean;
}

/** The copy key that asks the person to tap the button on the screen. */
export const TAP_TO_CONFIRM = "tap_to_confirm";

/** The stop reasons that put the emergency options first in the stop list (2.11 host table, stop). */
export const EMERGENCY_REASONS: readonly CoachStopReason[] = [
  "chest",
  "stroke_signs",
  "faint",
  "breath",
  "fall",
];

/** pause: an active or timer step that is not paused yet, never after a safety stop. */
export function pauseRefusal(s: HostControl): ToolResult | null {
  if (s.stopped) return { accepted: false, reason: "safety_stop" };
  if (s.step.kind !== "active" && s.step.kind !== "timer") return { accepted: false, reason: "not_allowed" };
  if (s.pausedBy) return { accepted: false, reason: "not_allowed" };
  return null;
}

/** resume: only a pause the coach made, never after a safety stop. */
export function resumeRefusal(s: HostControl): ToolResult | null {
  if (s.stopped) return { accepted: false, reason: "safety_stop" };
  if (s.pausedBy === "screen") return { accepted: false, reason: "paused_on_screen" };
  if (s.pausedBy !== "coach") return { accepted: false, reason: "not_allowed" };
  return null;
}
