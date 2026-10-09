/**
 * The smoke video scenarios (product v7 contract 8.4, stream G, step G1): what the procedural
 * humanoid (humanoid.mjs) does in each rendered video, and the truth that goes beside it.
 *
 *   rom-shoulder-abduction-right   the right arm raised to the side, seated on a chair, front view
 *                                  (rom-protocol shoulder_abduction: seated, front, 2 to 3 m, the
 *                                  phone at chest height); a 14 s loop: still, raise, hold at the end
 *                                  angle, lower, rest. Chromium loops the file, so every loop is one
 *                                  attempt.
 *   gait-pad-side                  a walk on the walking pad seen from the side (gait-rules capture
 *                                  walking_pad.side: 2.5 to 3.5 m, lens 0.8 to 1.3 m, 30 s per view
 *                                  after the 3 s standing calibration).
 *   rom-seated-*                   Nasser's first real test at home (D-034 item 1): seated 1.2 to 1.5 m
 *                                  from a phone in portrait (3:4, a front camera's narrower picture), so
 *                                  the legs are out of the picture: the arm raise to the front to 120
 *                                  (side view, 1.3 m, the lens near head height, the hips below the
 *                                  picture) and to 150 (1.5 m, the lens at shoulder height, the feet
 *                                  out of the picture), the arm raise to the side to 140 (front view, the hips at the
 *                                  picture's bottom edge, the raised hand out of it) and the elbow bend
 *                                  to 135 (side view sitting 30 degrees turned toward the phone, as
 *                                  people do; the view still reads side, the lens at shoulder height,
 *                                  the feet out of the picture). The same 14 s loop. Chromium's fake
 *                                  camera gives 30 fps whatever the file; 60 fps is covered by the
 *                                  generated fixtures (tests/v7/b-fixtures-home.test.ts).
 *   gait-home-side                 D-035 item 2, the walk at home, side view: a phone on a shelf 3 m
 *                                  from the walking line, landscape; six passes across the whole
 *                                  picture and back (about 3.7 m), each ending in a stop and a turn in
 *                                  place inside the picture; 104 steps a minute; each frame drawn at its
 *                                  30 fps time plus up to 8 ms of jitter (a phone's uneven frames).
 *   gait-home-wall                 D-035 item 2, the walk at home, front view: a phone standing against
 *                                  a wall at 1 m, portrait; four walks toward it from 5 m, each turning
 *                                  in place 1.6 m before the phone and walking back, with a turn at the
 *                                  far end; 108 steps a minute; nobody leaves the picture.
 *
 * The truth is computed from the same kinematics the renderer draws, so it is exact for the rendered
 * person: the arm's 3D abduction (the goniometer) and the same angle on the projected joints (the
 * picture); the walk's cadence, strides and contact events. The movement and the walk are test input
 * design, not clinical numbers: the end angle and the cadence are chosen inside ordinary ranges and
 * nothing in the app reads them. Dev only.
 */
import { BODY, J, armAbductionDeg, elbowFlexionDeg, project, skeleton, standingPose } from "./humanoid.mjs";

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const clamp01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
/** Smooth start and end (half cosine). */
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));
const lerp = (a, b, s) => a + (b - a) * s;
const round = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;

/* ------------------------------------------------------------------ the range scenario */

function romShoulderAbduction({ id, side, startDeg, endDeg }) {
  /** One attempt per loop (seconds). */
  const phases = { still: 3, raise: 2.5, hold: 4, lower: 2.5, rest: 2 };
  const seconds = Object.values(phases).reduce((a, b) => a + b, 0);
  const at = {};
  let t0 = 0;
  for (const [k, v] of Object.entries(phases)) {
    at[k] = [t0, t0 + v];
    t0 += v;
  }
  const abduction = (t) => {
    const x = ((t % seconds) + seconds) % seconds;
    if (x < at.raise[0]) return startDeg;
    if (x < at.hold[0]) return lerp(startDeg, endDeg, ease((x - at.raise[0]) / phases.raise));
    if (x < at.lower[0]) return endDeg;
    if (x < at.rest[0]) return lerp(endDeg, startDeg, ease((x - at.lower[0]) / phases.lower));
    return startDeg;
  };
  const poseAt = (t) => {
    const a = abduction(t);
    const moving = side === "right" ? "r" : "l";
    const still = moving === "r" ? "l" : "r";
    return {
      ...standingPose([0, 0, 1]),
      hip: { l: 90, r: 90 },
      knee: { l: 90, r: 90 },
      ankle: { l: 0, r: 0 },
      // Thumb up, elbow straight: the arm turns in the frontal plane only.
      shoulderAbd: { [moving]: a, [still]: startDeg },
      elbow: { [moving]: 4, [still]: 8 },
    };
  };
  return {
    id,
    kind: "rom",
    width: 540,
    height: 960,
    fps: 30,
    seconds,
    loops: true,
    // Facing the phone 3 m away at chest height, level (portrait, a phone front camera's 70 degrees).
    camera: { pos: [0, 0.9, 3], target: [0, 0.9, 0], fovY: 70 },
    scene: { chair: true, wallZ: -1.4 },
    poseAt,
    meta: { movement: "shoulder_abduction", side, position: "seated", view: "front", startDeg, endDeg, phases: at },
  };
}

/**
 * A seated range movement at home (D-034 item 1): the person on a chair, one arm moving through the
 * 14 s loop of romShoulderAbduction, the phone `camera` away. Side views turn the tested side to the
 * phone (the camera looks along -z from +z, so facing +x shows the right side). The tested arm's
 * angle at time t is the movement's: the arm's elevation in the sagittal plane (shoulder_flexion), in
 * the frontal plane (shoulder_abduction), or the elbow's bend with the arm by the side (elbow_flexion).
 */
function romSeated({ id, movement, side, startDeg, endDeg, camera, width, height, fps, turnDeg = 0 }) {
  const phases = { still: 3, raise: 2.5, hold: 4, lower: 2.5, rest: 2 };
  const seconds = Object.values(phases).reduce((a, b) => a + b, 0);
  const at = {};
  let t0 = 0;
  for (const [k, v] of Object.entries(phases)) {
    at[k] = [t0, t0 + v];
    t0 += v;
  }
  const angle = (t) => {
    const x = ((t % seconds) + seconds) % seconds;
    if (x < at.raise[0]) return startDeg;
    if (x < at.hold[0]) return lerp(startDeg, endDeg, ease((x - at.raise[0]) / phases.raise));
    if (x < at.lower[0]) return endDeg;
    if (x < at.rest[0]) return lerp(endDeg, startDeg, ease((x - at.lower[0]) / phases.lower));
    return startDeg;
  };
  const view = movement === "shoulder_abduction" ? "front" : "side";
  // A side view may sit turned toward the phone by turnDeg (the view still reads side under 36 degrees).
  const turn = (turnDeg * Math.PI) / 180;
  const fwd =
    view === "front"
      ? [0, 0, 1]
      : side === "right"
        ? [Math.cos(turn), 0, Math.sin(turn)]
        : [-Math.cos(turn), 0, Math.sin(turn)];
  const moving = side === "right" ? "r" : "l";
  const still = moving === "r" ? "l" : "r";
  const poseAt = (t) => {
    const a = angle(t);
    const base = {
      ...standingPose(fwd),
      hip: { l: 90, r: 90 },
      knee: { l: 90, r: 90 },
      ankle: { l: 0, r: 0 },
      shoulderAbd: { l: 6, r: 6 },
      shoulderFlex: { l: 0, r: 0 },
      elbow: { l: 8, r: 8 },
    };
    if (movement === "shoulder_flexion")
      // Thumb up, elbow straight: the arm turns in the sagittal plane only.
      return {
        ...base,
        shoulderAbd: { [moving]: 0, [still]: 6 },
        shoulderFlex: { [moving]: a, [still]: 0 },
        elbow: { [moving]: 4, [still]: 8 },
      };
    if (movement === "shoulder_abduction")
      return { ...base, shoulderAbd: { [moving]: a, [still]: startDeg }, elbow: { [moving]: 4, [still]: 8 } };
    // elbow_flexion: the upper arm by the side, the forearm turning forward and up.
    return { ...base, shoulderAbd: { [moving]: 0, [still]: 6 }, elbow: { [moving]: a, [still]: 8 } };
  };
  return {
    id,
    kind: "rom",
    width,
    height,
    fps,
    seconds,
    loops: true,
    camera,
    scene: { chair: true, wallZ: -1.4 },
    poseAt,
    meta: { movement, side, position: "seated", view, startDeg, endDeg, phases: at, turnDeg },
  };
}

/** The home phone of the seated scenarios: portrait 3:4, level, a 56 degree tall picture (a front camera's 4:3 crop). */
const homeCamera = (distance, height) => ({ pos: [0, height, distance], target: [0, height, 0], fovY: 56 });

/* ------------------------------------------------------------------ the gait scenario */

/** Foot geometry of humanoid.mjs: the heel and toe points from the ankle, and the sole under them. */
const FOOT = { heelBack: 0.06, heelDown: 0.055, toeFwd: 0.17, toeDown: 0.05 };

/**
 * The ankle that puts a sole point on the floor (y 0) at x, with the foot pitched `pitch` degrees
 * (toe up positive): `point` is "heel" or "toe" (the skeleton's sole spheres).
 */
function ankleOn(point, x, pitch) {
  const c = Math.cos(rad(pitch));
  const s = Math.sin(rad(pitch));
  if (point === "heel")
    return { x: x + FOOT.heelBack * c - FOOT.heelDown * s, y: BODY.sole * c + FOOT.heelBack * s + FOOT.heelDown * c };
  return { x: x - FOOT.toeFwd * c - FOOT.toeDown * s, y: BODY.sole * c - FOOT.toeFwd * s + FOOT.toeDown * c };
}

/** The lowest sole point of a foot with its ankle at a and pitch `pitch` (humanoid.mjs geometry). */
function soleLow(a, pitch) {
  const c = Math.cos(rad(pitch));
  const s = Math.sin(rad(pitch));
  const heel = a.y - FOOT.heelBack * s - FOOT.heelDown * c - BODY.sole * c;
  const toe = a.y + FOOT.toeFwd * s - FOOT.toeDown * c - BODY.sole * c;
  return Math.min(heel, toe);
}

/**
 * A treadmill walk in the sagittal plane, the pelvis still over the deck. Per leg at gait phase φ
 * (0 its initial contact): heel rocker to 0.1, foot flat to 0.4, forefoot rocker to toe off at 0.6
 * (the contact point carried back by the belt at v), then swing to the next contact, the ankle easing
 * from its toe off plantarflexion to neutral and the toe kept clear of the deck. The hip and knee come
 * from two link inverse kinematics on the ankle; the pelvis height sits under the stance legs' reach.
 */
function padWalker({ v, T, heelAhead, pitchIc, pitchTo }) {
  const ROCKER = { heelOff: 0.1, flatOff: 0.4, toeOff: 0.6 };
  const footLen = FOOT.heelBack + FOOT.toeFwd;
  const stance = (phi) => {
    const t = phi * T;
    if (phi < ROCKER.heelOff) {
      const pitch = lerp(pitchIc, 0, ease(phi / ROCKER.heelOff));
      return { ...ankleOn("heel", heelAhead - v * t, pitch), pitch };
    }
    if (phi < ROCKER.flatOff) return { ...ankleOn("heel", heelAhead - v * t, 0), pitch: 0 };
    const pitch = lerp(0, pitchTo, ease((phi - ROCKER.flatOff) / (ROCKER.toeOff - ROCKER.flatOff)));
    return { ...ankleOn("toe", heelAhead + footLen - v * t, pitch), pitch };
  };
  const L = { t: BODY.thigh, s: BODY.shank };
  const reach = (kneeDeg) => Math.sqrt(L.t ** 2 + L.s ** 2 + 2 * L.t * L.s * Math.cos(rad(kneeDeg)));
  /** The highest hip over an ankle with the knee bent at least `kneeDeg`. */
  const hipOver = (a, kneeDeg) => a.y + Math.sqrt(Math.max(0, reach(kneeDeg) ** 2 - a.x ** 2));
  // Mid stance with the knee at 7 degrees, 3 cm lower at double support, never past 4 degrees.
  const top = hipOver(stance(0.3), 7);
  const pelvisY = (phi) => {
    const dip = 0.03 * (0.5 + 0.5 * Math.cos(4 * Math.PI * (phi - 0.05)));
    let y = top - dip;
    for (const p of [phi, (phi + 0.5) % 1]) if (p < ROCKER.toeOff) y = Math.min(y, hipOver(stance(p), 4));
    return y;
  };
  /** Hip and knee flexion that put the ankle at a under a hip at height hipY (the knee forward). */
  const ik = (a, hipY) => {
    const dx = a.x;
    const dy = hipY - a.y;
    const d = Math.hypot(dx, dy);
    const cosKnee = (L.t ** 2 + L.s ** 2 - d ** 2) / (2 * L.t * L.s);
    const knee = 180 - deg(Math.acos(Math.max(-1, Math.min(1, cosKnee))));
    const alpha = deg(Math.acos(Math.max(-1, Math.min(1, (L.t ** 2 + d ** 2 - L.s ** 2) / (2 * L.t * d)))));
    return { hip: deg(Math.atan2(dx, dy)) + alpha, knee };
  };
  const withAnkle = (a, pitch, hipY) => {
    const { hip, knee } = ik(a, hipY);
    return { hip, knee, ankle: pitch - (hip - knee) };
  };
  const end = ROCKER.toeOff - 1e-9;
  const toeOff = stance(end);
  const contact = stance(0);
  const ankleTo = withAnkle(toeOff, toeOff.pitch, pelvisY(end)).ankle;
  const ankleIc = withAnkle(contact, contact.pitch, pelvisY(0)).ankle;
  const swing = (phi, hipY) => {
    const s = (phi - ROCKER.toeOff) / (1 - ROCKER.toeOff);
    const e = ease(s);
    const a = { x: lerp(toeOff.x, contact.x, e), y: lerp(toeOff.y, contact.y, e) + 0.06 * Math.sin(Math.PI * s) };
    const ankle = lerp(ankleTo, ankleIc, ease(Math.min(1, s * 1.8)));
    let out;
    for (let i = 0; i < 3; i++) {
      const { hip, knee } = ik(a, hipY);
      out = { hip, knee, ankle };
      // The toe clears the deck by 5 mm or more (late swing reaches the contact pose exactly).
      const low = soleLow(a, hip - knee + ankle);
      if (low >= 0.005 || s > 0.95) break;
      a.y += 0.005 - low;
    }
    return out;
  };
  const legAt = (phi, hipY) => {
    if (phi < ROCKER.toeOff) {
      const f = stance(phi);
      return withAnkle(f, f.pitch, hipY);
    }
    return swing(phi, hipY);
  };
  return {
    ROCKER,
    /** Joint angles of both legs at the right leg's phase φ. */
    angles(phi) {
      const y = pelvisY(phi);
      return { r: legAt(phi, y), l: legAt((phi + 0.5) % 1, y) };
    },
  };
}

function gaitPadSide({ id, cadence, padKmh }) {
  const T = 120 / cadence;
  const v = padKmh / 3.6;
  const standSec = 4;
  const steadyStrides = 25;
  const walkFrom = standSec;
  const steadyFrom = walkFrom + T;
  const steadyTo = steadyFrom + steadyStrides * T;
  const seconds = round(steadyTo + T + 0.6, 6);
  const walker = padWalker({ v, T, heelAhead: 0.2, pitchIc: 12, pitchTo: -55 });
  const deck = 0.1;
  const amp = (t) =>
    t < walkFrom ? 0 : t < steadyFrom ? ease((t - walkFrom) / T) : t < steadyTo ? 1 : 1 - ease((t - steadyTo) / T);
  const poseAt = (t) => {
    const a = amp(t);
    const stand = standingPose([1, 0, 0]);
    if (a === 0) return { ...stand, floorY: deck };
    const phi = ((((t - walkFrom) / T) % 1) + 1) % 1;
    const w = walker.angles(phi);
    const mix = (s, k) => lerp(stand[k][s], w[s][k], a);
    // The arms swing with the opposite leg.
    const arm = (s) => lerp(0, 0.45 * (w[s === "r" ? "l" : "r"].hip - 8), a);
    return {
      ...stand,
      floorY: deck,
      hip: { l: mix("l", "hip"), r: mix("r", "hip") },
      knee: { l: mix("l", "knee"), r: mix("r", "knee") },
      ankle: { l: mix("l", "ankle"), r: mix("r", "ankle") },
      shoulderFlex: { l: arm("l"), r: arm("r") },
      elbow: { l: 8 + a * (6 + 0.3 * Math.max(0, arm("l"))), r: 8 + a * (6 + 0.3 * Math.max(0, arm("r"))) },
      trunkLean: 3 * a,
      headPitch: 2 * a,
    };
  };
  return {
    id,
    kind: "gait",
    width: 960,
    height: 540,
    fps: 30,
    seconds,
    loops: false,
    // Beside the pad 3 m away, the lens at 1 m, level (landscape).
    camera: { pos: [0, 1, 3], target: [0, 1, 0], fovY: 46 },
    scene: { pad: { deck, length: 1.3, width: 0.5 }, wallZ: -1.4 },
    poseAt,
    meta: {
      view: "pad_side",
      mode: "walking_pad",
      // Walking toward +x seen from +z: the right side faces the phone.
      nearSide: "right",
      cadenceSpm: cadence,
      strideTimeS: T,
      padSpeedKmh: padKmh,
      deck,
      standing: [0, standSec],
      walk: [steadyFrom, steadyTo],
      rocker: walker.ROCKER,
    },
  };
}

/* ------------------------------------------------------------------ the home walks (D-035) */

/**
 * The integral of the walk's amplitude over a pass of D seconds that eases in and out over R seconds
 * (0.5 - 0.5 cos), at tau seconds: the distance walked over v (the pelvis moves at v times it).
 */
function rampedDistance(tau, D, T) {
  const up = (x) => x / 2 - (T / (2 * Math.PI)) * Math.sin((Math.PI * x) / T);
  if (tau <= 0) return 0;
  if (tau < T) return up(tau);
  if (tau <= D - T) return T / 2 + (tau - T);
  const u = Math.min(tau, D) - (D - T);
  return T / 2 + (D - 2 * T) + (u - up(u));
}

/**
 * An overground walk at home: the pad walker's joint angles (padWalker) with the pelvis carried forward
 * at the walking speed, so the stance foot stays on the floor; each pass eases in and out over one
 * step (half a stride: people reach their pace within a step or two) and ends in a stop; a turn in place rotates the standing person through `via` (facing the
 * phone for a side walk). Passes start on alternating phases of the gait cycle (either foot first).
 * `points` are the pelvis's turn points on the floor [x, z], in order; the walk starts standing at the
 * first, facing the second.
 */
function homeWalk({ id, view, cadence, stepM, points, turnSec, camera, width, height, fps, jitterMs, phases }) {
  const T = 120 / cadence;
  /** The ease in and out: one step. */
  const R = T / 2;
  const v = (stepM * cadence) / 60;
  const walker = padWalker({ v, T, heelAhead: 0.2, pitchIc: 12, pitchTo: -55 });
  const standSec = 4;
  const segs = [];
  let t = standSec;
  const dir = (a, b) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / d, 0, (b[1] - a[1]) / d];
  };
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i];
    const to = points[i + 1];
    const fwd = dir(from, to);
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const D = dist / v + R;
    segs.push({ kind: "walk", t0: t, t1: t + D, from, fwd, phase: phases[i % phases.length] });
    t += D;
    if (i + 2 < points.length) {
      const next = dir(to, points[i + 2]);
      segs.push({ kind: "turn", t0: t, t1: t + turnSec, at: to, fromFwd: fwd, toFwd: next });
      t += turnSec;
    }
  }
  const seconds = round(t + 1.5, 6);
  const first = segs[0];
  const yaw = (f) => Math.atan2(f[2], f[0]);
  const poseAt = (time) => {
    if (time < standSec) return { ...standingPose(first.fwd, first.from) };
    const seg = segs.find((s) => time >= s.t0 && time < s.t1) ?? segs[segs.length - 1];
    if (seg.kind === "turn" || time >= seg.t1) {
      if (seg.kind !== "turn") {
        const at = [seg.from[0] + seg.fwd[0] * (seg.t1 - seg.t0 - R) * v, seg.from[1] + seg.fwd[2] * (seg.t1 - seg.t0 - R) * v];
        return { ...standingPose(seg.fwd, at) };
      }
      // Turn in place: the facing turns through the phone's side (the shorter way for a side walk).
      const share = ease((time - seg.t0) / (seg.t1 - seg.t0));
      const a0 = yaw(seg.fromFwd);
      let d = yaw(seg.toFwd) - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      // Half a turn: through facing +z (the phone) for a side walk, through +x for a walk toward it.
      if (Math.abs(Math.abs(d) - Math.PI) < 1e-6) {
        const via = view === "side" ? [0, 0, 1] : [1, 0, 0];
        const mid = yaw(via);
        let h = mid - a0;
        while (h > Math.PI) h -= 2 * Math.PI;
        while (h < -Math.PI) h += 2 * Math.PI;
        d = Math.sign(h) * Math.PI;
      }
      const a = a0 + d * share;
      return { ...standingPose([Math.cos(a), 0, Math.sin(a)], seg.at) };
    }
    const tau = time - seg.t0;
    const D = seg.t1 - seg.t0;
    const amp = tau < R ? ease(tau / R) : tau > D - R ? 1 - ease((tau - (D - R)) / R) : 1;
    const s = rampedDistance(tau, D, R) * v;
    const at = [seg.from[0] + seg.fwd[0] * s, seg.from[1] + seg.fwd[2] * s];
    const stand = standingPose(seg.fwd, at);
    const phi = (((tau / T + seg.phase) % 1) + 1) % 1;
    const w = walker.angles(phi);
    const mix = (side, k) => lerp(stand[k][side], w[side][k], amp);
    const arm = (side) => lerp(0, 0.45 * (w[side === "r" ? "l" : "r"].hip - 8), amp);
    return {
      ...stand,
      hip: { l: mix("l", "hip"), r: mix("r", "hip") },
      knee: { l: mix("l", "knee"), r: mix("r", "knee") },
      ankle: { l: mix("l", "ankle"), r: mix("r", "ankle") },
      shoulderFlex: { l: arm("l"), r: arm("r") },
      elbow: { l: 8 + amp * (6 + 0.3 * Math.max(0, arm("l"))), r: 8 + amp * (6 + 0.3 * Math.max(0, arm("r"))) },
      trunkLean: 3 * amp,
      headPitch: 2 * amp,
    };
  };
  // Jitter: frame i is drawn at its time plus up to jitterMs (seeded), as a phone's uneven frames.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const jitter = Array.from({ length: Math.ceil(seconds * fps) + 2 }, () => (2 * rnd() - 1) * (jitterMs ?? 0));
  return {
    id,
    kind: "gait",
    width,
    height,
    fps,
    seconds,
    loops: false,
    camera,
    scene: { wallZ: camera.wallZ ?? -1.4 },
    poseAt,
    sampleAt: (i) => Math.max(0, i / fps + jitter[i] / 1000),
    meta: {
      home: true,
      view,
      lab: view,
      mode: "overground",
      cadenceSpm: cadence,
      strideTimeS: T,
      stepM,
      standing: [0, standSec],
      segs,
      rocker: walker.ROCKER,
      jitterMs: jitterMs ?? 0,
    },
  };
}

/** A home walk's contact events by design, in seconds: per pass, right IC at its phase 0, left at 0.5. */
function homeEvents(m) {
  const T = m.strideTimeS;
  const out = [];
  for (const s of m.segs) {
    if (s.kind !== "walk") continue;
    for (const [side, shift] of [
      ["right", 0],
      ["left", 0.5],
    ])
      for (let k = -1; ; k++) {
        const at = s.t0 + (k + shift - s.phase) * T;
        if (at > s.t1 + 1e-9) break;
        if (at < s.t0 - 1e-9) continue;
        out.push({ side, type: "ic", t: round(at, 6) });
      }
  }
  return out.sort((a, b) => a.t - b.t);
}

/* ------------------------------------------------------------------ catalogue and truth */

/**
 * The side walk's path: across the whole picture (about 3.7 m, the turns inside it), 3 m from the
 * phone; the wall walk's turn points.
 */
const SIDE_PATH = [
  [-1.85, 0],
  [1.85, 0],
  [-1.8, 0],
  [1.9, 0],
  [-1.85, 0],
  [1.8, 0],
  [-1.85, 0],
];
const WALL_PATH = [
  [0.2, -5],
  [0.2, -1.6],
  [0.2, -4.9],
  [0.2, -1.6],
  [0.2, -5.1],
  [0.2, -1.6],
  [0.2, -5],
  [0.2, -1.6],
  [0.2, -5],
];

export const SCENARIOS = Object.freeze({
  "rom-shoulder-abduction-right": romShoulderAbduction({
    id: "rom-shoulder-abduction-right",
    side: "right",
    startDeg: 8,
    endDeg: 135,
  }),
  "gait-pad-side": gaitPadSide({ id: "gait-pad-side", cadence: 100, padKmh: 3 }),
  "gait-home-side": homeWalk({
    id: "gait-home-side",
    view: "side",
    cadence: 104,
    stepM: 0.62,
    points: SIDE_PATH,
    turnSec: 1.8,
    // A phone on a shelf 3 m from the line, landscape, the lens at 1 m, a 46 degree tall picture.
    camera: { pos: [0, 1, 3], target: [0, 1, 0], fovY: 46, wallZ: -1.4 },
    width: 960,
    height: 540,
    fps: 30,
    jitterMs: 8,
    phases: [0, 0.35, 0.7, 0.15, 0.5, 0.85],
  }),
  "gait-home-wall": homeWalk({
    id: "gait-home-wall",
    view: "front",
    cadence: 108,
    stepM: 0.65,
    points: WALL_PATH,
    turnSec: 1.8,
    // A phone standing against a wall at 1 m, portrait, a front camera's 70 degree tall picture.
    camera: { pos: [0, 1, 0], target: [0, 1, -1], fovY: 70, wallZ: -6.5 },
    width: 540,
    height: 960,
    fps: 30,
    jitterMs: 0,
    phases: [0, 0.4, 0.75, 0.2, 0.55, 0.9, 0.3, 0.65],
  }),
  "rom-seated-shoulder-flexion-right": romSeated({
    id: "rom-seated-shoulder-flexion-right",
    movement: "shoulder_flexion",
    side: "right",
    startDeg: 4,
    endDeg: 120,
    camera: homeCamera(1.3, 1.22),
    width: 540,
    height: 720,
    fps: 30,
  }),
  "rom-seated-shoulder-flexion-right-150": romSeated({
    id: "rom-seated-shoulder-flexion-right-150",
    movement: "shoulder_flexion",
    side: "right",
    startDeg: 4,
    endDeg: 150,
    camera: homeCamera(1.5, 1.1),
    width: 540,
    height: 720,
    fps: 30,
  }),
  "rom-seated-shoulder-abduction-right": romSeated({
    id: "rom-seated-shoulder-abduction-right",
    movement: "shoulder_abduction",
    side: "right",
    startDeg: 8,
    endDeg: 140,
    camera: homeCamera(1.45, 1.22),
    width: 540,
    height: 720,
    fps: 30,
  }),
  "rom-seated-elbow-flexion-right": romSeated({
    id: "rom-seated-elbow-flexion-right",
    movement: "elbow_flexion",
    side: "right",
    startDeg: 6,
    endDeg: 135,
    camera: homeCamera(1.3, 0.95),
    width: 540,
    height: 720,
    fps: 30,
    turnDeg: 30,
  }),
});

/** The movement's angle on the 3D skeleton (the goniometer): the arm's elevation from the trunk, or the elbow's bend. */
export function movementTruthDeg(movement, skel, side) {
  return movement === "elbow_flexion" ? elbowFlexionDeg(skel, side) : armAbductionDeg(skel, side);
}

/** The joints in the picture (normalised, y down), for framing checks and the landmark truth. */
export function framePoints(sc, skel) {
  return skel.joints.map((p) => project(p, sc.camera, sc.width, sc.height));
}

/** ang(E - S, MHf - MS) in pixel space on projected joints: the rom-protocol shoulder_abduction angle. */
function projectedAbduction(sc, skel, hipSkel, side) {
  const px = (p) => {
    const q = project(p, sc.camera, sc.width, sc.height);
    return [q.x * sc.width, q.y * sc.height];
  };
  const j = skel.joints;
  const S = px(side === "right" ? j[J.SH_R] : j[J.SH_L]);
  const E = px(side === "right" ? j[J.ELB_R] : j[J.ELB_L]);
  const L = px(j[J.SH_L]);
  const R = px(j[J.SH_R]);
  const MS = [(L[0] + R[0]) / 2, (L[1] + R[1]) / 2];
  const hl = px(hipSkel.joints[J.HIP_L]);
  const hr = px(hipSkel.joints[J.HIP_R]);
  const MH = [(hl[0] + hr[0]) / 2, (hl[1] + hr[1]) / 2];
  const u = [E[0] - S[0], E[1] - S[1]];
  const w = [MH[0] - MS[0], MH[1] - MS[1]];
  return deg(Math.acos((u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w))));
}

/** The angle at b from a to c, degrees, on two picture points [x, y]. */
const angleAt = (a, b, c) => {
  const u = [a[0] - b[0], a[1] - b[1]];
  const w = [c[0] - b[0], c[1] - b[1]];
  return deg(Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w))))));
};

/**
 * The movement's angle on the projected joints (rom-protocol definitions): shoulder_flexion
 * ang(E - S, H - S) with the same side's hip, elbow_flexion 180 - ang(S - E, W - E); the side arm raise
 * as projectedAbduction.
 */
function projectedMovement(sc, skel, startSkel, movement, side) {
  if (movement === "shoulder_abduction") return projectedAbduction(sc, skel, startSkel, side);
  const px = (p) => {
    const q = project(p, sc.camera, sc.width, sc.height);
    return [q.x * sc.width, q.y * sc.height];
  };
  const j = skel.joints;
  const r = side === "right";
  const S = px(j[r ? J.SH_R : J.SH_L]);
  const E = px(j[r ? J.ELB_R : J.ELB_L]);
  if (movement === "shoulder_flexion") return angleAt(E, S, px(j[r ? J.HIP_R : J.HIP_L]));
  return 180 - angleAt(S, E, px(j[r ? J.WR_R : J.WR_L]));
}

/** Whether each sole is on what the feet stand on (within 1 mm), from the rendered kinematics. */
export function feetDown(sc, t) {
  const s = skeleton(sc.poseAt(t));
  const floor = sc.meta.deck;
  return { left: s.soleY.l - floor < 0.001, right: s.soleY.r - floor < 0.001 };
}

/**
 * The walk's contact events by design: the right foot's initial contact at phase 0 of each stride,
 * its toe off at the walker's toe off phase, the left foot half a stride later. tests/v7 checks the
 * rendered soles against them.
 */
function designEvents(m) {
  const T = m.strideTimeS;
  const events = [];
  for (let k = 0; ; k++) {
    const ic = m.walk[0] + k * T;
    if (ic > m.walk[1] + 1e-9) break;
    for (const [side, shift] of [
      ["right", 0],
      ["left", 0.5],
    ]) {
      const at = ic + shift * T;
      const to = ic + (shift + m.rocker.toeOff - (shift ? 1 : 0)) * T;
      if (to >= m.walk[0] - 1e-9 && to <= m.walk[1] + 1e-9) events.push({ side, type: "to", t: round(to, 6) });
      if (at <= m.walk[1] + 1e-9) events.push({ side, type: "ic", t: round(at, 6) });
    }
  }
  return events.sort((a, b) => a.t - b.t || (a.type === "to" ? -1 : 1));
}

/** The truth sidecar of a scenario (JSON, beside the video). */
export function scenarioTruth(sc) {
  const base = {
    id: sc.id,
    kind: sc.kind,
    fps: sc.fps,
    width: sc.width,
    height: sc.height,
    seconds: sc.seconds,
    loops: sc.loops,
    camera: sc.camera,
    source:
      "Rendered by scripts/smoke/render.mjs: the procedural humanoid of scripts/smoke/humanoid.mjs (no third party asset), posed by scripts/smoke/scenarios.mjs.",
  };
  if (sc.kind === "rom") {
    const m = sc.meta;
    const start = skeleton(sc.poseAt(0));
    const holdMid = skeleton(sc.poseAt((m.phases.hold[0] + m.phases.hold[1]) / 2));
    const seated = sc.id.startsWith("rom-seated-");
    return {
      ...base,
      movement: m.movement,
      side: m.side,
      position: m.position,
      view: m.view,
      startDeg: round(movementTruthDeg(m.movement, start, m.side), 3),
      endDeg: round(movementTruthDeg(m.movement, holdMid, m.side), 3),
      holds: [{ from: m.phases.hold[0], to: m.phases.hold[1], deg: m.endDeg }],
      phases: m.phases,
      projected: {
        startDeg: round(projectedMovement(sc, start, start, m.movement, m.side), 3),
        endDeg: round(projectedMovement(sc, holdMid, start, m.movement, m.side), 3),
      },
      notes: seated
        ? `Seated at home (D-034 item 1): the phone ${sc.camera.pos[2]} m away at ${sc.camera.pos[1]} m, portrait 3:4, the legs out of the picture. The video loops: every loop is still 3 s, raise 2.5 s, hold 4 s at the end angle, lower 2.5 s, rest 2 s. endDeg is the movement's 3D angle (the goniometer); projected is the movement's angle on the projected joints.`
        : "The video loops: every loop is still 3 s, raise 2.5 s, hold 4 s at the end angle, lower 2.5 s, rest 2 s. endDeg is the arm's 3D abduction (the goniometer); projected is ang(E - S, MHf - MS) on the projected joints with the mid hip of the start pose.",
    };
  }
  const m = sc.meta;
  if (m.home) {
    const stand = skeleton(sc.poseAt(0));
    const events = homeEvents(m);
    const walks = m.segs.filter((s) => s.kind === "walk");
    return {
      ...base,
      view: m.view,
      lab: m.lab,
      mode: m.mode,
      cadenceSpm: m.cadenceSpm,
      strideTimeS: m.strideTimeS,
      heightCm: round((stand.joints[J.HEAD][1] + 0.14) * 100, 1),
      standing: { from: m.standing[0], to: m.standing[1] },
      walk: { from: round(walks[0].t0, 6), to: round(walks[walks.length - 1].t1, 6) },
      passes: walks.map((s) => ({ from: round(s.t0, 6), to: round(s.t1, 6) })),
      jitterMs: m.jitterMs,
      events,
      notes:
        "A walk at home (D-035 item 2): stand still for 4 s, then passes that ease in and out over one step and stop, each followed by a turn in place inside the picture. cadenceSpm is exact for every step (the steps keep their timing while they ease); events are the right and left initial contacts by design. Frames are drawn at their time plus the jitter.",
    };
  }
  const events = designEvents(m);
  // Standing height: the top of the hair (the head centre plus 0.14 m in humanoid.mjs) above the deck.
  const stand = skeleton(sc.poseAt(0));
  const heightCm = round((stand.joints[J.HEAD][1] + 0.14 - m.deck) * 100, 1);
  const ic = (side) => events.filter((e) => e.side === side && e.type === "ic");
  return {
    ...base,
    view: m.view,
    mode: m.mode,
    nearSide: m.nearSide,
    cadenceSpm: m.cadenceSpm,
    strideTimeS: m.strideTimeS,
    stancePct: round(100 * m.rocker.toeOff, 6),
    padSpeedKmh: m.padSpeedKmh,
    heightCm,
    standing: { from: m.standing[0], to: m.standing[1] },
    walk: { from: round(m.walk[0], 6), to: round(m.walk[1], 6) },
    strides: { left: ic("left").length - 1, right: ic("right").length - 1 },
    events,
    notes:
      "Stand still for the first 4 s, start over one stride, walk steadily in walk.from to walk.to, then stop over one stride. Events by design (initial contact at phase 0, toe off at 0.6); the rendered soles touch the deck at them (tests/v7/g-scenarios.test.ts). cadenceSpm and strides are exact.",
  };
}

/** The smoke page's options for a video (contract A6a-5: everything but the name comes from the page URL). */
export function smokeQuery(truth) {
  const q = new URLSearchParams();
  if (truth.lab) {
    // The walk lab (D-035 item 4) runs the capture itself: no windows, the person's height only.
    q.set("gaitlab", truth.lab);
    q.set("auto", "1");
    q.set("height", String(Math.round(truth.heightCm)));
    return q.toString();
  }
  q.set("kind", truth.kind);
  if (truth.kind === "rom") {
    q.set("movement", truth.movement);
    q.set("side", truth.side);
    q.set("position", truth.position);
  } else {
    q.set("view", truth.view);
    q.set("nearSide", truth.nearSide);
    q.set("mode", truth.mode);
    q.set("padKmh", String(truth.padSpeedKmh));
    q.set("heightCm", String(truth.heightCm));
    // The standing calibration inside the still start, the walk window of the truth.
    q.set("standFrom", String(truth.standing.from + 0.5));
    q.set("standTo", String(truth.standing.from + 3.5));
    q.set("walkFrom", String(truth.walk.from));
    q.set("walkTo", String(truth.walk.to));
  }
  return q.toString();
}
