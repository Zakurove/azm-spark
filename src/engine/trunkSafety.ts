import { CueId, ExerciseDef, PRF } from "./types";

/**
 * The workout trunk safety stop (S0, council decisions 2026-09-28). Pure TS, no DOM.
 *
 * `trunk_lean` is the signed trunk angle from vertical in the image plane, in true degrees (pixel
 * space, D-003); positive means the shoulders are toward the image right of the hips. Two limits,
 * whichever is reached first stops the set:
 *   (a) relative: 15 degrees or more away from the calibrated posture (the calibration median of
 *       trunk_lean), in either direction;
 *   (b) absolute, from vertical: the press (front view, sideways lean) 25 degrees either way; the
 *       curl (side view) 25 degrees forward and 30 degrees backward (toward the backrest, a recline
 *       or a tilt in space wheelchair).
 * The curl's forward direction is taken at calibration from the side of the mid shoulder the nose
 * is on (`nose_offset`, landmark 0): nose to the image right means a forward lean is positive.
 * A calibrated posture at or beyond limit (b) in its direction blocks the set start.
 */

/** Below this |nose_offset| (trunk lengths) the face side is not trusted. */
// R3C-37 (4) (S0-direction-unknown, confirmed 2026-09-30). The council gives no rule when the nose is not seen at
// calibration or sits on the mid shoulder line. Safest reading: the forward cap (the lower one)
// applies in both directions.
export const NOSE_SIDE_MIN = 0.02;

export type TrunkStopId = "trunk_safety" | "trunk_safety_cap";
/** Rule id of the flag raised when the calibrated posture blocks the set start. */
export const PRESET_BLOCK_ID = "trunk_preset_block";

export interface TrunkStopLimits {
  /** Calibrated posture (degrees), 0 when calibration saw no trunk. */
  base: number;
  /** +1: forward lean is positive trunk_lean; -1: negative; 0: not known (front view or unseen). */
  forward: 1 | -1 | 0;
  /** Relative limits (a): base ± relativeDeg. */
  relLo: number;
  relHi: number;
  /** Absolute limits (b), signed. */
  capLo: number;
  capHi: number;
  /** The limits that act: the stop fires at trunk_lean >= hi or <= lo. */
  lo: number;
  hi: number;
}

/** The side a side view faces, from the calibration median of nose_offset. */
export function forwardSign(noseOffset: number | undefined): 1 | -1 | 0 {
  if (noseOffset === undefined || !Number.isFinite(noseOffset)) return 0;
  if (noseOffset >= NOSE_SIDE_MIN) return 1;
  if (noseOffset <= -NOSE_SIDE_MIN) return -1;
  return 0;
}

/** The stop limits of an exercise for one calibration, or null when it has no trunk stop. */
export function trunkStopLimits(def: ExerciseDef, prf: PRF): TrunkStopLimits | null {
  const s = def.trunkSafety;
  if (!s) return null;
  const b = prf.baselines.trunk_lean;
  // R3C-37 (5) (S0-no-baseline, confirmed 2026-09-30). The framing gate needs both shoulders and hips, so calibration always
  // sees the trunk; if it did not, the posture is taken as upright, so the relative stop acts at
  // 15 degrees from vertical, stricter than either cap.
  const base = b !== undefined && Number.isFinite(b) ? b : 0;
  let forward: 1 | -1 | 0 = 0;
  let capLo: number;
  let capHi: number;
  if (s.cap.view === "front") {
    capLo = -s.cap.eitherDeg;
    capHi = s.cap.eitherDeg;
  } else {
    forward = forwardSign(prf.baselines.nose_offset);
    const { forwardDeg, backwardDeg } = s.cap;
    if (forward === 1) {
      capHi = forwardDeg;
      capLo = -backwardDeg;
    } else if (forward === -1) {
      capHi = backwardDeg;
      capLo = -forwardDeg;
    } else {
      const strict = Math.min(forwardDeg, backwardDeg);
      capHi = strict;
      capLo = -strict;
    }
  }
  const relLo = base - s.relativeDeg;
  const relHi = base + s.relativeDeg;
  return {
    base,
    forward,
    relLo,
    relHi,
    capLo,
    capHi,
    lo: Math.max(relLo, capLo),
    hi: Math.min(relHi, capHi),
  };
}

/**
 * The pre-set block: the cue to play when the calibrated posture is already at or beyond the
 * absolute limit in its direction (press 25 degrees either way; curl 25 forward or 30 backward),
 * or null when the set may start.
 */
export function presetBlock(def: ExerciseDef, prf: PRF): CueId | null {
  const lim = trunkStopLimits(def, prf);
  if (!lim) return null;
  return lim.base >= lim.capHi || lim.base <= lim.capLo ? def.trunkSafety!.presetCue : null;
}

/** Which stop a trunk angle reaches, or null. The absolute limit is named when it is reached. */
export function trunkStopFor(lim: TrunkStopLimits, lean: number): TrunkStopId | null {
  if (!Number.isFinite(lean)) return null;
  if (lean >= lim.capHi || lean <= lim.capLo) return "trunk_safety_cap";
  if (lean >= lim.relHi || lean <= lim.relLo) return "trunk_safety";
  return null;
}

/**
 * The absolute limit (b) on its own, before any calibration (S0: it is from vertical and does not
 * depend on the calibrated posture): press 25 degrees either way; curl 25 forward and 30 backward,
 * with the forward direction from this frame's face side, or 25 both ways when it cannot be read
 * (R3C-37 (4) (S0-direction-unknown, confirmed 2026-09-30)). Null when the exercise has no trunk stop or the cap is not reached.
 */
export function capStopFor(def: ExerciseDef, lean: number, noseOffset?: number): TrunkStopId | null {
  const s = def.trunkSafety;
  if (!s || !Number.isFinite(lean)) return null;
  let capLo: number;
  let capHi: number;
  if (s.cap.view === "front") {
    capLo = -s.cap.eitherDeg;
    capHi = s.cap.eitherDeg;
  } else {
    const forward = forwardSign(noseOffset);
    const { forwardDeg, backwardDeg } = s.cap;
    const strict = Math.min(forwardDeg, backwardDeg);
    capHi = forward === 1 ? forwardDeg : forward === -1 ? backwardDeg : strict;
    capLo = forward === 1 ? -backwardDeg : forward === -1 ? -forwardDeg : -strict;
  }
  return lean >= capHi || lean <= capLo ? "trunk_safety_cap" : null;
}
