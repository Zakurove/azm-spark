import { Frame, Landmark, LM } from "./types";

/**
 * Synthetic landmark-trace generator.
 * Purposes: (1) golden-trace unit tests, (2) offline demo mode driving the full
 * pipeline (overlay, FSM, cues) with no camera, (3) stage fallback.
 *
 * The figures use fixed, human segment lengths (arms never stretch), eased
 * sinusoidal motion with a subtle breathing sway, and poses that match each
 * exercise's camera instruction (the curl is a SIDE view, per its framing text).
 * Coordinates are normalized image space (y down). Clearly synthetic — never
 * presented as a real user.
 */

function lm(x: number, y: number, visibility = 0.95): Landmark {
  return { x, y, z: 0, visibility };
}

function blank(): Landmark[] {
  return Array.from({ length: 33 }, () => lm(0, 0, 0));
}

export interface TraceOpts {
  reps?: number;
  fps?: number;
  repSec?: number;
  /** 0..1 fraction of full range actually achieved (partial reps) */
  effort?: number;
  /** degrees of trunk lean injected for later reps (compensation demo) */
  leanDeg?: number;
  /** rep index at which the lean begins (default: halfway through the set) */
  leanFromRep?: number;
  /** right arm lags left by this fraction (asymmetry demo) */
  asymmetry?: number;
  /** seconds of idle hold before reps start */
  leadInSec?: number;
}

const DEG = Math.PI / 180;

/** eased 0→1→0 cycle (smooth start/stop, brief holds at the extremes) */
function cyc(p: number): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * Math.min(1, Math.max(0, p)));
}

interface Pose {
  cx: number;
  shoulderY: number;
  trunkLen: number;
  shoulderHalf: number;
  hipHalf: number;
  lean: number; // radians, +ve = to the viewer's right
  sway: number; // breathing offset
}

/** Places head, neck base, shoulders and hips with the trunk rotated about the hip midpoint. */
function buildTrunk(L: Landmark[], p: Pose): { sh: (s: 1 | -1) => { x: number; y: number } } {
  const hipY = p.shoulderY + p.trunkLen;
  const hip = { x: p.cx, y: hipY };
  const rot = (x: number, y: number) => {
    const dx = x - hip.x, dy = y - hip.y;
    return { x: hip.x + dx * Math.cos(p.lean) - dy * Math.sin(p.lean), y: hip.y + dx * Math.sin(p.lean) + dy * Math.cos(p.lean) };
  };
  const shL = rot(p.cx - p.shoulderHalf, p.shoulderY + p.sway);
  const shR = rot(p.cx + p.shoulderHalf, p.shoulderY + p.sway);
  const headC = rot(p.cx, p.shoulderY - p.trunkLen * 0.52 + p.sway);
  const headR = p.trunkLen * 0.19;

  L[LM.nose] = lm(headC.x, headC.y + headR * 0.25);
  L[LM.l_eye] = lm(headC.x - headR * 0.35, headC.y - headR * 0.1);
  L[LM.r_eye] = lm(headC.x + headR * 0.35, headC.y - headR * 0.1);
  L[LM.l_ear] = lm(headC.x - headR * 0.85, headC.y);
  L[LM.r_ear] = lm(headC.x + headR * 0.85, headC.y);
  L[LM.l_shoulder] = lm(shL.x, shL.y);
  L[LM.r_shoulder] = lm(shR.x, shR.y);
  L[LM.l_hip] = lm(p.cx - p.hipHalf, hipY, 0.85);
  L[LM.r_hip] = lm(p.cx + p.hipHalf, hipY, 0.85);
  return { sh: (s) => (s === -1 ? shL : shR) };
}

/** Arm with fixed segment lengths, angles measured from straight-down. */
function placeArm(
  L: Landmark[],
  side: 1 | -1,
  shoulder: { x: number; y: number },
  uaAngle: number, // upper-arm angle from straight-down, outward +
  faAngle: number, // forearm angle from straight-down, outward +
  upperLen: number,
  foreLen: number,
  lateral = 1, // 1 = frontal plane (x spread), <1 compresses toward sagittal view
): void {
  const ex = shoulder.x + side * Math.sin(uaAngle) * upperLen * lateral;
  const ey = shoulder.y + Math.cos(uaAngle) * upperLen;
  const wx = ex + side * Math.sin(faAngle) * foreLen * lateral;
  const wy = ey + Math.cos(faAngle) * foreLen;
  const E = side === -1 ? LM.l_elbow : LM.r_elbow;
  const W = side === -1 ? LM.l_wrist : LM.r_wrist;
  L[E] = lm(ex, ey);
  L[W] = lm(wx, wy);
}

const noise = () => (Math.random() - 0.5) * 0.003;
function addNoise(L: Landmark[]): void {
  for (const i of [LM.l_shoulder, LM.r_shoulder, LM.l_elbow, LM.r_elbow, LM.l_wrist, LM.r_wrist, LM.l_hip, LM.r_hip]) {
    if (L[i].visibility > 0) {
      L[i] = { ...L[i], x: L[i].x + noise(), y: L[i].y + noise() };
    }
  }
}

function repClock(sec: number, leadInSec: number, repSec: number, reps: number) {
  const repIdx = sec < leadInSec ? -1 : Math.floor((sec - leadInSec) / repSec);
  const phase = sec < leadInSec ? 0 : ((sec - leadInSec) / repSec) % 1;
  const active = repIdx >= 0 && repIdx < reps;
  return { repIdx, lift: active ? cyc(phase) : 0 };
}

/**
 * Seated shoulder press, front view, wheelchair user.
 * Racked: elbows out beside the ribs, wrists at shoulder height (elbow ≈ 95°).
 * Top: arms nearly vertical overhead (elbow ≈ 170°).
 */
export function seatedPressTrace(o: TraceOpts = {}): Frame[] {
  const { reps = 8, fps = 30, repSec = 2.4, effort = 1, leanDeg = 0, asymmetry = 0, leadInSec = 1.2, leanFromRep } = o;
  const frames: Frame[] = [];
  const total = Math.round((leadInSec + reps * repSec + 1) * fps);
  const UA = 0.135, FA = 0.125;

  for (let f = 0; f < total; f++) {
    const sec = f / fps;
    const { repIdx, lift } = repClock(sec, leadInSec, repSec, reps);
    const leanStart = leanFromRep ?? Math.floor(reps / 2);
    const leanActive = leanDeg !== 0 && repIdx >= leanStart;
    const L = blank();
    const { sh } = buildTrunk(L, {
      cx: 0.5,
      shoulderY: 0.4,
      trunkLen: 0.225,
      shoulderHalf: 0.082,
      hipHalf: 0.06,
      lean: (leanActive ? leanDeg : 0) * DEG * Math.min(1, lift * 1.6),
      sway: 0.0025 * Math.sin((sec / 3.6) * 2 * Math.PI),
    });
    for (const s of [-1, 1] as const) {
      const e = s === 1 ? Math.max(0, effort - asymmetry * effort) : effort;
      const l = lift * e;
      // upper arm: 62° (racked, elbow beside ribs) → 168° (overhead)
      const ua = (62 + 106 * l) * DEG;
      // forearm: vertical up in the rack (185° ≈ slightly inward), stays up
      const fa = (196 - 22 * l) * DEG;
      placeArm(L, s, sh(s), ua, fa, UA, FA);
    }
    // wheelchair occludes the legs — low visibility, the overlay draws the chair instead
    L[LM.l_knee] = lm(0.44, 0.68, 0.25);
    L[LM.r_knee] = lm(0.56, 0.68, 0.25);
    L[LM.l_ankle] = lm(0.44, 0.8, 0.15);
    L[LM.r_ankle] = lm(0.56, 0.8, 0.15);
    addNoise(L);
    frames.push({ t: (f / fps) * 1000, lm: L });
  }
  return frames;
}

/**
 * Seated biceps curl, SIDE view (matches the camera instruction — a frontal
 * curl collapses in 2D). Both arms overlap in profile and move together.
 */
export function seatedCurlTrace(o: TraceOpts = {}): Frame[] {
  const { reps = 8, fps = 30, repSec = 2.2, effort = 1, leadInSec = 1.2 } = o;
  const frames: Frame[] = [];
  const total = Math.round((leadInSec + reps * repSec + 1) * fps);
  const UA = 0.135, FA = 0.125;

  for (let f = 0; f < total; f++) {
    const sec = f / fps;
    const { lift } = repClock(sec, leadInSec, repSec, reps);
    const L = blank();
    const { sh } = buildTrunk(L, {
      cx: 0.5,
      shoulderY: 0.4,
      trunkLen: 0.225,
      shoulderHalf: 0.012, // profile view — shoulders nearly overlap
      hipHalf: 0.01,
      lean: 0,
      sway: 0.0025 * Math.sin((sec / 3.6) * 2 * Math.PI),
    });
    // face the viewer's right: nose/eyes shifted forward
    const fwd = 0.055;
    L[LM.nose] = lm(L[LM.nose].x + fwd, L[LM.nose].y);
    L[LM.l_eye] = lm(L[LM.l_eye].x + fwd * 0.7, L[LM.l_eye].y);
    L[LM.r_eye] = lm(L[LM.r_eye].x + fwd * 0.7, L[LM.r_eye].y);
    for (const s of [-1, 1] as const) {
      const l = lift * effort;
      // upper arm hangs by the side (0° = straight down), drifting slightly forward at the top
      const ua = (4 + 6 * l) * DEG;
      // forearm swings forward-up: extended (hanging, elbow ≈175°) → curled (≈45°)
      const fa = (9 + 130 * l) * DEG;
      // lateral=1 but "outward" is now the forward (+x) direction for both arms
      placeArm(L, 1, sh(s), ua, fa, UA, FA);
      const E = s === -1 ? LM.l_elbow : LM.r_elbow;
      const W = s === -1 ? LM.l_wrist : LM.r_wrist;
      L[E] = { ...L[LM.r_elbow], x: L[LM.r_elbow].x + (s === -1 ? -0.006 : 0) };
      L[W] = { ...L[LM.r_wrist], x: L[LM.r_wrist].x + (s === -1 ? -0.006 : 0) };
    }
    // side-view wheelchair occludes legs
    L[LM.l_knee] = lm(0.58, 0.68, 0.25);
    L[LM.r_knee] = lm(0.59, 0.68, 0.25);
    L[LM.l_ankle] = lm(0.6, 0.8, 0.15);
    L[LM.r_ankle] = lm(0.61, 0.8, 0.15);
    addNoise(L);
    frames.push({ t: (f / fps) * 1000, lm: L });
  }
  return frames;
}

/** Sit-to-stand, 45° view: hips rise from chair height, arms reach forward on the rise. */
export function sitToStandTrace(o: TraceOpts = {}): Frame[] {
  const { reps = 5, fps = 30, repSec = 3.2, effort = 1, leadInSec = 1.2 } = o;
  const frames: Frame[] = [];
  const total = Math.round((leadInSec + reps * repSec + 1) * fps);
  const cx = 0.5;
  const UA = 0.13, FA = 0.12;

  for (let f = 0; f < total; f++) {
    const sec = f / fps;
    const { lift } = repClock(sec, leadInSec, repSec, reps);
    const rise = lift * effort; // 0 seated → 1 standing
    const L = blank();

    const ankleY = 0.88;
    const hipY = 0.64 - 0.17 * rise;
    const trunkLen = 0.22;
    const { sh } = buildTrunk(L, {
      cx,
      shoulderY: hipY - trunkLen,
      trunkLen,
      shoulderHalf: 0.075,
      hipHalf: 0.052,
      lean: (14 - 14 * rise) * DEG * 0.4, // forward fold while seated, upright when standing
      sway: 0.002 * Math.sin((sec / 3.6) * 2 * Math.PI),
    });
    // arms: hang at the sides seated → reach forward while rising
    for (const s of [-1, 1] as const) {
      const ua = (8 + 55 * Math.sin(Math.PI * rise)) * DEG; // swing forward mid-rise
      const fa = (10 + 55 * Math.sin(Math.PI * rise)) * DEG;
      placeArm(L, s, sh(s), ua, fa, UA, FA, 0.35);
    }
    // legs: knees forward when seated, straighten when standing
    const kneeX = 0.06 * (1 - rise);
    const kneeY = 0.755 - 0.02 * rise;
    L[LM.l_knee] = lm(cx - 0.05 + kneeX, kneeY);
    L[LM.r_knee] = lm(cx + 0.05 + kneeX, kneeY);
    L[LM.l_ankle] = lm(cx - 0.045, ankleY);
    L[LM.r_ankle] = lm(cx + 0.045, ankleY);
    addNoise(L);
    frames.push({ t: (f / fps) * 1000, lm: L });
  }
  return frames;
}

export const TRACES: Record<string, (o?: TraceOpts) => Frame[]> = {
  seated_shoulder_press: seatedPressTrace,
  seated_biceps_curl: seatedCurlTrace,
  sit_to_stand: sitToStandTrace,
};
