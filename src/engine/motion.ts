/**
 * The orientation sensor gate of the camera tests and the motion_needed skip (council UX round:
 * O10, O33 (j), (l), (6); revision 1.1 reasons.motion_needed; UX S31, S34c and map 2.9). Pure TS,
 * no DOM: the app reads `DeviceOrientationEvent` (beta, gamma), the result of
 * `DeviceOrientationEvent.requestPermission()` where it exists (iOS, asked inside the tap of the
 * camera primer), and the screen angle, and passes them here.
 *
 *   ok             a reading exists: the setup check runs its 5 degree level gate with `tilt`;
 *   waiting        no reading yet, within the short wait after permission;
 *   no_sensor      the device gives no orientation reading at all (most laptops and desktops):
 *                  camera tests never start there, the check shows S04 without the continue option;
 *   ask            the motion permission was refused, or not asked yet: the setup shows the motion
 *                  issue with the at the phone button «اسمح بقراءة الحركة», whose tap asks again;
 *   motion_needed  still refused after asking again (or no reading after it): the test is skipped
 *                  for the day with reason motion_needed, never quality. A same day skip: no
 *                  substitute is added.
 */
import { phoneTilt, type Tilt } from "./quality";

export type MotionPermission = "not_needed" | "prompt" | "granted" | "denied";

export interface OrientationReading {
  t: number;
  /** W3C DeviceOrientationEvent beta and gamma, degrees; null when the device has no sensor. */
  beta: number | null;
  gamma: number | null;
}

export type MotionGate =
  | { status: "ok"; tilt: Tilt }
  | { status: "waiting" }
  | { status: "no_sensor" }
  | { status: "ask" }
  | { status: "motion_needed" };

/** The skip reason id of revision 1.1 (reasons.motion_needed). */
export const MOTION_NEEDED = "motion_needed";

// SPEC-GAP: motion-wait. The spec does not say how long to wait for the first reading. Phones send
// one within a few frames of the permission; a device that sends nothing (or only nulls) for this
// long has no usable sensor.
export const MOTION_RULES = { firstReadingMs: 1000 } as const;

const usable = (r: OrientationReading) =>
  r.beta !== null && r.gamma !== null && Number.isFinite(r.beta) && Number.isFinite(r.gamma);

/** Tracks the permission and the readings of one check, and says what the camera test may do. */
export class MotionGateTracker {
  private perm: MotionPermission = "prompt";
  private since: number | null = null;
  private asked = false;
  private askedT: number | null = null;
  private awaitingAnswer = false;
  private last: OrientationReading | null = null;

  /** The permission result (iOS), or "not_needed" where the browser has no permission step. */
  permission(p: MotionPermission, t: number): void {
    this.perm = p;
    this.since ??= t;
    if (this.asked) {
      this.awaitingAnswer = false;
      this.askedT = t;
    }
  }

  /** The at the phone «اسمح بقراءة الحركة» tap asked again; its result comes with `permission`. */
  askedAgain(t: number): void {
    this.asked = true;
    this.askedT = t;
    this.awaitingAnswer = true;
  }

  reading(r: OrientationReading): void {
    if (usable(r)) this.last = r;
  }

  status(t: number, screenAngleDeg = 0): MotionGate {
    if (this.last)
      return { status: "ok", tilt: phoneTilt(this.last.beta!, this.last.gamma!, screenAngleDeg) };
    if (this.awaitingAnswer) return { status: "waiting" };
    if (this.perm === "prompt" || this.perm === "denied")
      return this.asked ? { status: "motion_needed" } : { status: "ask" };
    // Granted, or no permission step: wait briefly for the first reading.
    const from = this.asked && this.askedT !== null ? this.askedT : (this.since ?? t);
    if (t - from < MOTION_RULES.firstReadingMs) return { status: "waiting" };
    return this.asked ? { status: "motion_needed" } : { status: "no_sensor" };
  }
}
