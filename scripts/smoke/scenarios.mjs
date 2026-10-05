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
 *
 * The truth is computed from the same kinematics the renderer draws, so it is exact for the rendered
 * person: the arm's 3D abduction (the goniometer) and the same angle on the projected joints (the
 * picture); the walk's cadence, strides and contact events. The movement and the walk are test input
 * design, not clinical numbers: the end angle and the cadence are chosen inside ordinary ranges and
 * nothing in the app reads them. Dev only.
 */
import { BODY, J, armAbductionDeg, project, skeleton, standingPose } from "./humanoid.mjs";

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

/* ------------------------------------------------------------------ catalogue and truth */

export const SCENARIOS = Object.freeze({
  "rom-shoulder-abduction-right": romShoulderAbduction({
    id: "rom-shoulder-abduction-right",
    side: "right",
    startDeg: 8,
    endDeg: 135,
  }),
  "gait-pad-side": gaitPadSide({ id: "gait-pad-side", cadence: 100, padKmh: 3 }),
});

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
    return {
      ...base,
      movement: m.movement,
      side: m.side,
      position: m.position,
      view: m.view,
      startDeg: round(armAbductionDeg(start, m.side), 3),
      endDeg: round(armAbductionDeg(holdMid, m.side), 3),
      holds: [{ from: m.phases.hold[0], to: m.phases.hold[1], deg: m.endDeg }],
      phases: m.phases,
      projected: {
        startDeg: round(projectedAbduction(sc, start, start, m.side), 3),
        endDeg: round(projectedAbduction(sc, holdMid, start, m.side), 3),
      },
      notes:
        "The video loops: every loop is still 3 s, raise 2.5 s, hold 4 s at the end angle, lower 2.5 s, rest 2 s. endDeg is the arm's 3D abduction (the goniometer); projected is ang(E - S, MHf - MS) on the projected joints with the mid hip of the start pose.",
    };
  }
  const m = sc.meta;
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
