/**
 * S57 booth tools, the pure rules (UX spec S57, council O15, Q19 (4)):
 *
 *   idle reset      idle means no touch (and nobody seen by the camera when it runs). S50 asks after
 *                   3 minutes, the other screens that allow it after 5 minutes; a 30 s countdown then
 *                   starts the next visitor. Never on camera, stop list, safety screens (S33, S35
 *                   to S42, S38b) or the end question.
 *   staff reset     a 1.5 s press on the booth badge or the staff shortcut key asks to start for the
 *                   next visitor from any screen, camera screens included, and logs no stop.
 *
 * The flow itself clears the visit (flowMachine STAFF_RESET: the guest flow starts again with nothing
 * of the last visitor, booth mode stays); these rules only decide when that is offered.
 */
import { cameraRunning, type FlowModel, type FlowStateKind } from "../flowMachine";
import { parseNumberInput } from "../shared/format";

/** O15: S50 (guest results) asks after 3 minutes idle. */
export const IDLE_RESULTS_MS = 3 * 60 * 1000;
/** O15: the other screens that allow the idle reset ask after 5 minutes. */
export const IDLE_OTHER_MS = 5 * 60 * 1000;
/** The spoken countdown before the reset (S57). */
export const IDLE_COUNTDOWN_MS = 30 * 1000;
/** S57: the press on the booth badge that opens the staff reset. */
export const LONG_PRESS_MS = 1500;

/**
 * Screens where the idle reset may run (S57: S05 to S31 before the camera, S46, S46b, and S50), by
 * flow state. Every other state never resets itself; staff clear it with the staff reset.
 */
const IDLE_STATES: ReadonlySet<FlowStateKind> = new Set<FlowStateKind>([
  "guestWelcome", // S05
  "adultGate", // S05a
  "adultEnd", // S05a end card
  "guestSetup", // S06 to S11
  "guestStaff", // S09
  "intro", // S14
  "soundCheck", // S14b
  "precheckNotice", // S16
  "question", // S17 to S24
  "starting", // the last question, busy
  "warnings", // S25
  "plan", // S27
  "test.instruction", // S28
  "test.grip", // S29 grip
  "test.load", // S30
  "test.helper", // S26
  "test.primer", // S31
  "skipNotice", // S46
  "guestAfterTest", // S46b
  "results", // S50
]);

/** Overlays that are part of the safety path: no idle reset while one is open. */
const SAFETY_OVERLAYS = new Set(["stopList"]);

/**
 * A visitor pass that ends (10 minutes hidden, S55b) clears the pass, but the page does not reload
 * over a safety screen (S36 to S40, S38b), S33, or the stop list: wiping
 * emergency or AD instructions off the phone as the person returns to it is a safety failure. The
 * reload runs once the person has left the screen (R3C-35).
 */
export function reloadWaits(m: FlowModel): boolean {
  const o = m.overlay?.kind;
  if (o === "stopList") return true;
  const k = m.state.kind;
  return k === "safety" || k === "faintAsk" || k === "postponed";
}

/**
 * How long this screen waits before asking "Are you still here?", or null where the idle reset never
 * applies. Only the guest check at the booth resets itself: a visitor's own phone (a signed in check
 * with a booth token) is theirs, so staff use the staff reset there.
 */
// R3C-31 (2) (idle-signed-in, confirmed 2026-09-30). S57 names the booth screens; a signed in visitor's own phone is not reset
// by the idle timer (the staff reset still works there), the reading that never clears a person's own
// check without them.
export function idleWaitMs(m: FlowModel): number | null {
  const d = m.data;
  if (!d.config.booth || d.config.mode !== "guest") return null;
  if (m.overlay && SAFETY_OVERLAYS.has(m.overlay.kind)) return null;
  const s = m.state;
  if (!IDLE_STATES.has(s.kind) || cameraRunning(s)) return null;
  return s.kind === "results" ? IDLE_RESULTS_MS : IDLE_OTHER_MS;
}

export type IdlePhase =
  { kind: "watching"; since: number } | { kind: "asking"; deadline: number } | { kind: "reset" };

/**
 * One step of the idle timer. `last` is the last touch or key press (or the moment the screen
 * changed); `personSeen` is true while the camera sees someone (it keeps the booth awake).
 */
export function idleStep(
  phase: IdlePhase,
  o: { now: number; last: number; waitMs: number | null; personSeen?: boolean },
): IdlePhase {
  if (o.waitMs === null) return { kind: "watching", since: o.now };
  if (phase.kind === "reset") return phase;
  if (phase.kind === "asking") return o.now >= phase.deadline ? { kind: "reset" } : phase;
  const since = Math.max(o.last, phase.since);
  if (o.personSeen) return { kind: "watching", since: o.now };
  return o.now - since >= o.waitMs ? { kind: "asking", deadline: o.now + IDLE_COUNTDOWN_MS } : phase;
}

/** Whole seconds left on the countdown, never below zero. */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * The staff shortcut key (S57): Alt and Shift with N (for a New visitor), by the physical key so it
 * works on Arabic and English keyboards alike.
 */
// R3C-34 (staff-shortcut-key, confirmed 2026-09-30). S57 asks for "a staff shortcut key" without naming it.
export function isStaffShortcut(e: {
  code?: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return e.code === "KeyN" && e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey;
}

/** The staff count correction (S57, S34h): a whole count from 0 to 60 (S48 stepper range). */
export const COUNT_RANGE: readonly [number, number] = [0, 60];

/** A count typed by staff (digits normalised, 0.2), or null when it is not a whole count in range. */
export function parseStaffCount(raw: string): number | null {
  const n = parseNumberInput(raw);
  if (n === null || !Number.isInteger(n) || n < COUNT_RANGE[0] || n > COUNT_RANGE[1]) return null;
  return n;
}
