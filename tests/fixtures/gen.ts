/**
 * Fixture generator: physically plausible landmark recordings for the movement check engine
 * (contract v2 section F). Deterministic for a given spec (seeded), so a spec is a fixture.
 *
 * How it works. Each person is a small 3D mannequin in metres with fixed segment lengths (adult
 * proportions: shoulders 0.34 m apart, trunk 0.5 m, upper arm 0.3 m, forearm 0.26 m, thigh 0.43 m,
 * shank 0.42 m). Joint states (trunk lean and bend, rising from the seat, arm elevation, elbow
 * bend, a pelvis that drops) come from motion specs over time. The mannequin is turned (yaw) and
 * placed in the room, then projected through a level pinhole camera whose short side spans 50
 * degrees (the spec's own assumption, spec 4.0) onto a 720x1280 (9:16), 1280x720 (16:9) or 960x960
 * (1:1) image,
 * and normalized as MediaPipe does (x ÷ width, y ÷ height). Angles in the fixtures are therefore
 * only true in pixel space (D-003), as on a real phone.
 *
 * What the model would report is imitated: visibility falls for the far side of a turned body,
 * for landmarks outside the image, for hips hidden by a wheelchair, for a person hidden behind a
 * nearer one, and in scripted occlusions; a pose is left out when too little of it is in the image
 * or it is mostly hidden. Optional: a second person (helper) who stands, walks between the phone
 * and the subject, hovers a hand near the subject or touches the subject; Gaussian landmark noise;
 * a moving phone (the whole image jitters, or jolts); dim light; the model's pose order shuffled
 * per frame; the camera's timing (jittered frame times, dropped frames, short gaps at a steady
 * rhythm and stalls), as a phone delivers frames, with the body always drawn at the frame's own
 * time.
 *
 * The subject can also rest the arms in a given pose (hands on the thighs), hold the other arm
 * (an assisted lift), turn, bend forward or slide the pelvis sideways, for the engine mode tests.
 * For the timed counts, single curl and stand reps (`curl_rep`, `stand_rep`) each have their own
 * timing and depth, a stand can end bent forward or push on the thighs with the hands, and
 * `truth.reps` lists them; `curlRepTime` and `standRepTime` give when a rep reaches a share of its
 * movement, for ground truth counts.
 *
 * Profiles: chair (steady chair), wheelchair (higher seat, footplates, hips mostly hidden unless a
 * front view shows them, wheelchairHips),
 * standing (a chair for the chair stand), weaker_left and weaker_right (that arm reaches 60
 * percent of the asked range and rests a little bent). Clearly synthetic; never shown as a person.
 */
import { LM, type Landmark } from "../../src/engine/types";
import type { RomMovementId, RomPositionId, RomSide } from "../../src/movements/rom/types";
import type { Fixture } from "./format";

export type Profile = "chair" | "wheelchair" | "standing" | "weaker_left" | "weaker_right";
export type AspectName = "9:16" | "16:9" | "1:1";
type Side = "left" | "right";

export const PROFILES: readonly Profile[] = [
  "chair",
  "wheelchair",
  "standing",
  "weaker_left",
  "weaker_right",
];
export const FRAME_SIZE: Record<AspectName, { w: number; h: number }> = {
  "9:16": { w: 720, h: 1280 },
  "16:9": { w: 1280, h: 720 },
  "1:1": { w: 960, h: 960 },
};
export const aspectOf = (a: AspectName) => FRAME_SIZE[a].w / FRAME_SIZE[a].h;

/* ------------------------------------------------------------------ vectors */

/** World: x toward the image right, y up, z toward the camera. Local: l (the person's left), u, f (forward). */
type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => {
  const n = len(a);
  return n > 1e-9 ? mul(a, 1 / n) : [0, 0, 0];
};
/** Part of `a` orthogonal to the unit vector `d`. */
const ortho = (a: V, d: V): V => sub(a, mul(d, dot(a, d)));
const D2R = Math.PI / 180;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/* ---------------------------------------------------------------- randomness */

/** Seeded random numbers in [0, 1) (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/* ---------------------------------------------------------------------- body */

export interface BodyDims {
  shoulderHalf: number;
  hipHalf: number;
  trunk: number;
  upperArm: number;
  forearm: number;
  hand: number;
  thigh: number;
  shank: number;
  /** Hip joint above the seat surface. */
  hipAboveSeat: number;
}
export const ADULT: BodyDims = {
  shoulderHalf: 0.17,
  hipHalf: 0.1,
  trunk: 0.5,
  upperArm: 0.3,
  forearm: 0.26,
  hand: 0.08,
  thigh: 0.43,
  shank: 0.42,
  hipAboveSeat: 0.08,
};

/** One arm: elevation from hanging (0) to overhead (180), in a plane 0 (to the side) to 90 (to the front). */
export interface ArmState {
  elev: number;
  plane: number;
  /** Elbow bend, 0 straight. */
  elbow: number;
  /** 0 bends the forearm forward, 1 bends it toward the midline (arms crossed). */
  across: number;
}

export interface PoseState {
  /** Pelvis on the floor plan, metres (world x and z). */
  x: number;
  z: number;
  /** Turn, degrees: positive turns the person's left side toward the camera. */
  yaw: number;
  /** 0 seated, 1 standing upright. */
  stand: number;
  /** Sideways trunk lean, degrees, positive toward the person's left. */
  lean: number;
  /** Forward trunk bend, degrees. */
  pitch: number;
  /** Metres the pelvis sinks below where it should be (a slide or a fall). */
  drop: number;
  arms: Record<Side, ArmState>;
  /** A hand that reaches a world point (inverse kinematics), overriding that arm. */
  reach?: { hand: Side; target: V };
  /** The subject's own hand holds the other arm at the elbow (an assisted lift). */
  assist?: { hand: Side };
  /** Hands pushing on the thighs (a chair stand with the hands). */
  push?: Side[];
  /** v7 range of motion: the posture and the joints of the mannequin (RomState), when the spec has `rom`. */
  rom?: RomState;
}

interface Setting {
  seat: number;
  ankleHeight: number;
  footForward: number;
  standing: boolean;
}
const SETTINGS: Record<"chair" | "wheelchair", Setting> = {
  chair: { seat: 0.46, ankleHeight: 0.08, footForward: 0.42, standing: false },
  wheelchair: { seat: 0.5, ankleHeight: 0.16, footForward: 0.46, standing: false },
};

/* ------------------------------------------------------------------- motions */

export type MotionSpec =
  | {
      kind: "arm_raise";
      side: Side;
      peak: number;
      plane?: number;
      start?: number;
      rise?: number;
      hold?: number;
      lower?: number;
    }
  | { kind: "curl"; side: Side; reps: number; repSec?: number; start?: number; top?: number }
  /**
   * One elbow bend from rest to `top` degrees of bend (default 140) and back, over `dur` seconds
   * (default 2), with a cosine profile.
   */
  | { kind: "curl_rep"; side: Side; start: number; dur?: number; top?: number }
  /**
   * One stand from the seat: up to `peak` of a full stand (default 1) over `rise` s (default 1),
   * held `hold` s (default 0.4), down over `sit` s (default 1). The trunk bends forward `pitch`
   * degrees mid rise (default 40) and ends `topPitch` degrees forward at the top (default 0). With
   * `push`, those hands push on the thighs while the person is off the seat.
   */
  | {
      kind: "stand_rep";
      start: number;
      rise?: number;
      hold?: number;
      sit?: number;
      peak?: number;
      pitch?: number;
      topPitch?: number;
      push?: Side[];
    }
  | {
      kind: "side_lean";
      toward: Side;
      peak: number;
      start?: number;
      rise?: number;
      hold?: number;
      back?: number;
    }
  | { kind: "chair_stand"; reps: number; repSec?: number; start?: number; crossed?: boolean }
  | { kind: "fall"; at: number; dur?: number }
  | { kind: "sway"; at: number; peak?: number; dur?: number; toward?: Side }
  | { kind: "leave"; at: number; speed?: number; dir?: 1 | -1 }
  | { kind: "raise_hand"; side: Side; from: number; to: number }
  /** The hand holds the other arm at the elbow between from and to (an assisted lift). */
  | { kind: "assist"; hand: Side; from: number; to: number }
  /** The body turns by `deg` (yaw, positive turns the left side toward the camera), then back. */
  | { kind: "turn"; deg: number; start?: number; rise?: number; hold?: number; back?: number }
  /** The trunk bends forward by `deg`, then back. */
  | { kind: "bend"; deg: number; start?: number; rise?: number; hold?: number; back?: number }
  /** The pelvis slides sideways by `dx` metres (world x, toward the image right), then back. */
  | { kind: "slide"; dx: number; start?: number; rise?: number; hold?: number; back?: number }
  | RomMotionSpec;

/** 0 → 1 → hold → 0 envelope. */
function envelope(t: number, start: number, rise: number, hold: number, back: number): number {
  if (t < start) return 0;
  if (t < start + rise) return smooth((t - start) / rise);
  if (t < start + rise + hold) return 1;
  return 1 - smooth((t - start - rise - hold) / back);
}

function applyMotion(m: MotionSpec, t: number, s: PoseState): void {
  switch (m.kind) {
    case "arm_raise": {
      const a = s.arms[m.side];
      const e = envelope(t, m.start ?? 0.5, m.rise ?? 1.5, m.hold ?? 1, m.lower ?? 1.5);
      a.elev += (m.peak - a.elev) * e;
      if (e > 0) a.plane = m.plane ?? 0;
      return;
    }
    case "curl": {
      const a = s.arms[m.side];
      const start = m.start ?? 0.5;
      const rep = m.repSec ?? 2;
      if (t >= start && t <= start + m.reps * rep) {
        const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * (t - start)) / rep);
        a.elbow += ((m.top ?? 140) - a.elbow) * k;
      }
      return;
    }
    case "curl_rep": {
      const k = curlRepShare(m, t);
      if (k > 0) {
        const a = s.arms[m.side];
        a.elbow += ((m.top ?? 140) - a.elbow) * k;
      }
      return;
    }
    case "stand_rep": {
      const st = standRepLevel(m, t);
      if (st <= 0) return;
      s.stand = Math.max(s.stand, st);
      s.pitch += (m.pitch ?? 40) * Math.sin(Math.PI * st) + (m.topPitch ?? 0) * st;
      if (m.push?.length) s.push = [...m.push];
      return;
    }
    case "side_lean": {
      const e = envelope(t, m.start ?? 0.5, m.rise ?? 1.5, m.hold ?? 1, m.back ?? 1.5);
      s.lean += (m.toward === "left" ? 1 : -1) * m.peak * e;
      return;
    }
    case "chair_stand": {
      if (m.crossed ?? true) {
        for (const side of ["left", "right"] as const)
          s.arms[side] = { elev: 25, plane: 70, elbow: 115, across: 1 };
      }
      const start = m.start ?? 0.5;
      const rep = m.repSec ?? 2.5;
      if (t < start || t > start + m.reps * rep) return;
      const ph = ((t - start) % rep) / rep;
      const st = ph < 0.4 ? smooth(ph / 0.4) : ph < 0.5 ? 1 : ph < 0.9 ? 1 - smooth((ph - 0.5) / 0.4) : 0;
      s.stand = st;
      s.pitch += 40 * Math.sin(Math.PI * st);
      return;
    }
    case "fall": {
      const e = smooth((t - m.at) / (m.dur ?? 0.6));
      s.drop += 0.44 * e;
      s.lean += 25 * e;
      s.pitch += 20 * e;
      return;
    }
    case "sway": {
      const dur = m.dur ?? 1;
      if (t >= m.at && t <= m.at + dur) {
        s.lean += (m.toward === "right" ? -1 : 1) * (m.peak ?? 35) * Math.sin((Math.PI * (t - m.at)) / dur);
      }
      return;
    }
    case "leave":
      s.x += (m.dir ?? 1) * (m.speed ?? 0.8) * Math.max(0, t - m.at);
      return;
    case "raise_hand": {
      const e = envelope(t, m.from, 0.3, Math.max(0, m.to - m.from - 0.6), 0.3);
      const a = s.arms[m.side];
      a.elev += (170 - a.elev) * e;
      a.plane = 20 * e;
      a.elbow *= 1 - e;
      return;
    }
    case "assist":
      if (t >= m.from && t <= m.to) s.assist = { hand: m.hand };
      return;
    case "turn":
      s.yaw += m.deg * envelope(t, m.start ?? 0.5, m.rise ?? 1, m.hold ?? 1, m.back ?? 1);
      return;
    case "bend":
      s.pitch += m.deg * envelope(t, m.start ?? 0.5, m.rise ?? 1, m.hold ?? 1, m.back ?? 1);
      return;
    case "slide":
      s.x += m.dx * envelope(t, m.start ?? 0.5, m.rise ?? 1, m.hold ?? 1, m.back ?? 1);
      return;
    case "rom_rep":
    case "rom_wander":
    case "rom_offset":
    case "rom_hand":
      applyRomMotion(m, t, s);
      return;
  }
}

/** Share of a curl rep's bend at time t (0 at rest, 1 at its top). */
export function curlRepShare(m: Extract<MotionSpec, { kind: "curl_rep" }>, t: number): number {
  const dur = m.dur ?? 2;
  if (t < m.start || t > m.start + dur) return 0;
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * (t - m.start)) / dur);
}

/** First time a curl rep reaches `share` of its bend (seconds), null when it never does. */
export function curlRepTime(m: Extract<MotionSpec, { kind: "curl_rep" }>, share: number): number | null {
  if (share < 0 || share > 1) return null;
  return m.start + ((m.dur ?? 2) * Math.acos(1 - 2 * share)) / (2 * Math.PI);
}

/** Stand level of a stand rep at time t (0 seated, 1 standing fully). */
export function standRepLevel(m: Extract<MotionSpec, { kind: "stand_rep" }>, t: number): number {
  const rise = m.rise ?? 1;
  const hold = m.hold ?? 0.4;
  const sit = m.sit ?? 1;
  const peak = m.peak ?? 1;
  if (t < m.start) return 0;
  if (t < m.start + rise) return peak * smooth((t - m.start) / rise);
  if (t < m.start + rise + hold) return peak;
  return peak * (1 - smooth((t - m.start - rise - hold) / sit));
}

/** First time a stand rep reaches `level` of a full stand on the way up (seconds), null when it never does. */
export function standRepTime(m: Extract<MotionSpec, { kind: "stand_rep" }>, level: number): number | null {
  const peak = m.peak ?? 1;
  if (level > peak) return null;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (peak * smooth(mid) < level) lo = mid;
    else hi = mid;
  }
  return m.start + hi * (m.rise ?? 1);
}

/* ------------------------------------------------------------------ skeleton */

/** Two bone inverse kinematics: the middle joint for a chain from `a` to `target`, bending toward `pole`. */
function twoBone(a: V, target: V, l1: number, l2: number, pole: V): { mid: V; end: V } {
  const toT = sub(target, a);
  const d = Math.min(Math.max(len(toT), Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
  const dir = unit(toT);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let p = unit(ortho(pole, dir));
  if (len(p) < 0.5) p = unit(ortho([0, -1, 0], dir));
  return { mid: add(add(a, mul(dir, x)), mul(p, h)), end: add(a, mul(dir, d)) };
}

/** World positions of the 33 landmarks of one person. */
function skeleton(s: PoseState, dims: BodyDims, setting: Setting): V[] {
  if (s.rom) return romSkeleton(s, s.rom, dims);
  const th = s.yaw * D2R;
  const Lw: V = [Math.cos(th), 0, Math.sin(th)];
  const Fw: V = [-Math.sin(th), 0, Math.cos(th)];
  const Uw: V = [0, 1, 0];
  const origin: V = [s.x, 0, s.z];
  const W = (l: number, u: number, f: number): V => add(origin, add(mul(Lw, l), add(mul(Uw, u), mul(Fw, f))));

  // Pelvis: from the seat to standing over the feet.
  const standH = setting.ankleHeight + dims.shank + dims.thigh - 0.02;
  const seatH = setting.seat + dims.hipAboveSeat;
  const st = clamp01(s.stand);
  const pelvisU = seatH + (standH - seatH) * st - s.drop;
  const pelvisF = (setting.footForward - 0.04) * smooth(st);
  const pelvis = W(0, pelvisU, pelvisF);

  // Trunk axes after the forward bend (about l) and the side lean (about f).
  const p = s.pitch * D2R;
  const la = s.lean * D2R;
  const U1: V = [0, Math.cos(p), Math.sin(p)];
  const L1: V = [1, 0, 0];
  const Ut: V = add(mul(U1, Math.cos(la)), mul(L1, Math.sin(la)));
  const Lt: V = sub(mul(L1, Math.cos(la)), mul(U1, Math.sin(la)));
  const Ft: V = [0, -Math.sin(p), Math.cos(p)];
  const toW = (v: V): V => add(mul(Lw, v[0]), add(mul(Uw, v[1]), mul(Fw, v[2])));
  const ut = toW(Ut);
  const lt = toW(Lt);
  const ft = toW(Ft);

  const midS = add(pelvis, mul(ut, dims.trunk));
  const at = (base: V, u: number, l: number, f: number): V =>
    add(base, add(mul(ut, u), add(mul(lt, l), mul(ft, f))));
  const out: V[] = Array.from({ length: 33 }, () => [0, 0, 0] as V);

  // Head.
  out[LM.nose] = at(midS, 0.2, 0, 0.1);
  out[1] = at(midS, 0.24, 0.02, 0.085);
  out[LM.l_eye] = at(midS, 0.24, 0.035, 0.08);
  out[3] = at(midS, 0.24, 0.05, 0.07);
  out[4] = at(midS, 0.24, -0.02, 0.085);
  out[LM.r_eye] = at(midS, 0.24, -0.035, 0.08);
  out[6] = at(midS, 0.24, -0.05, 0.07);
  out[LM.l_ear] = at(midS, 0.22, 0.075, 0);
  out[LM.r_ear] = at(midS, 0.22, -0.075, 0);
  out[9] = at(midS, 0.16, 0.025, 0.09);
  out[10] = at(midS, 0.16, -0.025, 0.09);

  // Shoulders, hips.
  out[LM.l_shoulder] = at(midS, 0, dims.shoulderHalf, 0);
  out[LM.r_shoulder] = at(midS, 0, -dims.shoulderHalf, 0);
  out[LM.l_hip] = add(pelvis, mul(Lw, dims.hipHalf));
  out[LM.r_hip] = add(pelvis, mul(Lw, -dims.hipHalf));

  // Legs (before the arms, so a pushing hand can reach the thigh): ankles stay on the floor (or
  // footplates), knees bend forward.
  for (const side of ["left", "right"] as const) {
    const sg = side === "left" ? 1 : -1;
    const H = out[side === "left" ? LM.l_hip : LM.r_hip];
    const A = W(sg * dims.hipHalf, setting.ankleHeight, setting.footForward);
    const k = twoBone(H, A, dims.thigh, dims.shank, Fw);
    const I = side === "left" ? { k: 25, a: 27, h: 29, f: 31 } : { k: 26, a: 28, h: 30, f: 32 };
    out[I.k] = k.mid;
    out[I.a] = k.end;
    out[I.h] = add(k.end, add(mul(Fw, -0.05), [0, -0.05, 0]));
    out[I.f] = add(k.end, add(mul(Fw, 0.17), [0, -0.06, 0]));
  }

  // Arms. An assisting hand is placed after the arm it holds.
  const armOrder: Side[] = s.assist?.hand === "left" ? ["right", "left"] : ["left", "right"];
  for (const side of armOrder) {
    const sg = side === "left" ? 1 : -1;
    const knee = out[side === "left" ? LM.l_knee : LM.r_knee];
    const hipJ = out[side === "left" ? LM.l_hip : LM.r_hip];
    // A pushing hand rests on top of its own thigh, 40 percent of the way from the knee to the hip.
    const pushing = !!s.push?.includes(side);
    const target: V | null =
      s.reach && s.reach.hand === side
        ? s.reach.target
        : s.assist && s.assist.hand === side
          ? out[side === "left" ? LM.r_elbow : LM.l_elbow]
          : pushing
            ? add(add(knee, mul(sub(hipJ, knee), 0.4)), [0, 0.06, 0])
            : null;
    const pole: V = pushing ? add(mul(lt, sg), mul(ft, -1)) : [0, -1, 0];
    placeArm(out, side, s.arms[side], target, pole, dims, { ut, lt, ft });
  }

  return out;
}

/**
 * One arm's elbow, wrist and hand points from its shoulder (already in `out`): reaching `target` (two
 * bone inverse kinematics, the elbow toward `pole`) or posed by the arm state in the trunk frame.
 */
function placeArm(
  out: V[],
  side: Side,
  a: ArmState,
  target: V | null,
  pole: V,
  dims: BodyDims,
  frame: { ut: V; lt: V; ft: V },
): void {
  const { ut, lt, ft } = frame;
  const sg = side === "left" ? 1 : -1;
  const S = out[side === "left" ? LM.l_shoulder : LM.r_shoulder];
  let E: V;
  let Wr: V;
  let fd: V;
  if (target) {
    const k = twoBone(S, target, dims.upperArm, dims.forearm, pole);
    E = k.mid;
    Wr = k.end;
    fd = unit(sub(Wr, E));
  } else {
    const e = a.elev * D2R;
    const ph = a.plane * D2R;
    const d = unit(
      add(mul(ut, -Math.cos(e)), mul(add(mul(lt, sg * Math.cos(ph)), mul(ft, Math.sin(ph))), Math.sin(e))),
    );
    E = add(S, mul(d, dims.upperArm));
    let b = unit(ortho(add(mul(ft, 1 - a.across), mul(lt, -sg * a.across)), d));
    if (len(b) < 0.5) b = unit(ortho(ut, d));
    const el = a.elbow * D2R;
    fd = unit(add(mul(d, Math.cos(el)), mul(b, Math.sin(el))));
    Wr = add(E, mul(fd, dims.forearm));
  }
  let n = unit(cross(fd, ut));
  if (len(n) < 0.5) n = lt;
  const I = side === "left" ? { e: 13, w: 15, p: 17, i: 19, t: 21 } : { e: 14, w: 16, p: 18, i: 20, t: 22 };
  out[I.e] = E;
  out[I.w] = Wr;
  out[I.p] = add(Wr, add(mul(fd, dims.hand * 0.9), mul(n, -0.02 * sg)));
  out[I.i] = add(Wr, add(mul(fd, dims.hand), mul(n, 0.02 * sg)));
  out[I.t] = add(Wr, add(mul(fd, dims.hand * 0.5), mul(n, 0.035 * sg)));
}

/** Which body side each landmark belongs to (+1 left, -1 right, 0 middle). */
const SIDE_OF: number[] = Array.from({ length: 33 }, (_, i) => {
  if (i === 0) return 0;
  if ([1, 2, 3, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31].includes(i)) return 1;
  return -1;
});

/* ---------------------------------------------------------------- the spec */

export interface HelperSpec {
  /** Pelvis position relative to the subject's, metres: x toward the image right, z toward the camera. */
  x: number;
  z: number;
  yaw?: number;
  /** Walks along x at constant z. */
  walk?: { toX: number; start: number; speed: number };
  /** Hand on the subject's shoulder between from and to (seconds). */
  touch?: { from: number; to: number; hand?: Side; shoulder?: Side };
  /** Hand held near the subject's shoulder without touching: finger tips `gapM` metres off it (default 0.2). */
  hover?: { from: number; to: number; hand?: Side; shoulder?: Side; gapM?: number };
}

export interface GenSpec {
  test: string;
  profile: Profile;
  aspect: AspectName;
  fps: number;
  durationSec: number;
  seed: number;
  camera?: { distance?: number; height?: number; x?: number; rollDeg?: number; mirror?: boolean };
  subject?: {
    yaw?: number;
    x?: number;
    /** Body size factor (1 = ADULT). */
    scale?: number;
    /** Shoulder width factor on top of scale (broad or narrow shoulders). */
    shoulderScale?: number;
    /** Resting arm pose per side, on top of the profile's (for example hands on the thighs). */
    arms?: Partial<Record<Side, Partial<ArmState>>>;
    motions?: MotionSpec[];
  };
  /**
   * Wheelchair hips: "hidden" (default) as in a side view, where the wheel and armrest hide them,
   * or "visible" as in a front view between the side guards.
   */
  wheelchairHips?: "hidden" | "visible";
  helper?: HelperSpec;
  /** Landmark noise, standard deviation as a share of the image height. Default 0.002. */
  noise?: number;
  /**
   * The noise of the face points (0 to 10: nose, eyes, ears, mouth), when it differs from `noise`
   * (default `noise`). A pose model places the face's sharp features more precisely than the joints
   * under clothing: the COCO keypoint evaluation's per keypoint spreads (ROM_FACE_NOISE_SHARE).
   */
  noiseFace?: number;
  /** A moving phone: the whole image jitters (amplitude as a share of the image height). */
  shake?: { amp: number; hz: number };
  /** The phone slips: the whole image shifts at `at` seconds and stays shifted (share of height). */
  jolts?: { at: number; dx: number; dy: number }[];
  /** Scripted occlusion of subject landmarks (seconds). */
  occlusions?: { landmarks: number[]; from: number; to: number; visibility?: number }[];
  /** Shuffle the pose order every frame, as the model does not keep it. */
  shuffle?: boolean;
  /**
   * v7 range of motion (product v7 contract 8.2): the movement, its position and side. The subject is
   * then posed by the range of motion mannequin (romSkeleton), the camera placed as the movement's
   * instructions say (romCamera), and `truth.rom` holds the true angles.
   */
  rom?: RomGenSpec;
  /**
   * Camera timing. By default frames come every 1000 ÷ fps ms exactly. `jitterMs` moves each frame
   * time by up to that many ms either way (uniform, seeded apart from the landmarks, so the same
   * frames get the same times); `dropShare` leaves out that share of frames at random; `gaps` leaves
   * out the frames after every `everySec` seconds so that the next frame comes `ms` later; `stalls`
   * leaves out every frame between `from` and `to` (seconds). The body is drawn at each frame's own
   * time, so the landmarks and the time stamp always agree.
   */
  timing?: {
    jitterMs?: number;
    dropShare?: number;
    gaps?: { everySec: number; ms: number; fromSec?: number };
    stalls?: { from: number; to: number }[];
  };
  /**
   * Light on the scene, 1 good (default) down to about 0.5 dim: every visibility the model reports
   * is scaled by it, as dim light lowers the model's confidence everywhere.
   */
  light?: number;
  notes?: string;
}

export interface GenTruth {
  yawDeg: number;
  distanceM: number;
  aspect: number;
  /** The view a classifier should report for a nominal adult, or null in the unsure bands. */
  expectedView: "front" | "side" | "oblique" | null;
  weakerSide: Side | null;
  /** Per frame, the index of the subject in poses, -1 when the model would not see it. */
  subjectIndex: number[];
  /** Per frame, the index of the helper in poses, -1 when absent. */
  helperIndex: number[];
  /** Scripted events in seconds: crossing, touch, hover, fall, sway, leave, raise_hand, jolt. */
  events: { kind: string; from: number; to: number }[];
  /** Highest arm elevation reached per side, degrees. */
  armPeakDeg: Record<Side, number>;
  /**
   * The single curl and stand reps of the script (curl_rep, stand_rep), in time order: `top` is
   * the curl's bend in degrees or the stand's share of a full stand; `push` when hands pushed.
   * Only present when the script has such reps.
   */
  reps?: { kind: "curl" | "stand"; start: number; end: number; top: number; push?: boolean }[];
  /** v7 range of motion specs only: the movement's true angles (RomTruth). */
  rom?: RomTruth;
}

/** Test specific camera placement from the spec setups (distance, lens height, turn of the person). */
function cameraDefaults(spec: GenSpec): { distance: number; height: number; yaw: number } {
  if (spec.rom) return romCamera(spec, spec.rom);
  const stronger: Side = spec.profile === "weaker_right" ? "left" : "right";
  switch (spec.test) {
    case "arm_curl_30s": {
      const curl = spec.subject?.motions?.find((m) => m.kind === "curl" || m.kind === "curl_rep") as
        { side: Side } | undefined;
      const side = curl?.side ?? "right";
      return { distance: 1.75, height: 0.9, yaw: side === "left" ? 90 : -90 };
    }
    case "trunk_control_seated":
      return { distance: 2.25, height: 0.95, yaw: 0 };
    case "chair_stand_30s":
      return {
        distance: spec.aspect === "16:9" ? 3 : 2.5,
        height: 0.55,
        yaw: stronger === "right" ? -45 : 45,
      };
    default:
      return { distance: 2.5, height: 0.95, yaw: 0 };
  }
}

export function expectedViewOf(yaw: number): GenTruth["expectedView"] {
  const a = Math.abs(yaw) % 180;
  const y = a > 90 ? 180 - a : a;
  if (y <= 25) return "front";
  if (y >= 40 && y <= 50) return "oblique";
  if (y >= 65) return "side";
  return null;
}

function baseState(
  profile: Profile,
  yaw: number,
  x: number,
  arms?: Partial<Record<Side, Partial<ArmState>>>,
): PoseState {
  const rest = (weak: boolean, side: Side): ArmState => ({
    elev: weak ? 3 : 5,
    plane: 0,
    elbow: weak ? 20 : 5,
    across: 0,
    ...arms?.[side],
  });
  return {
    x,
    z: 0,
    yaw,
    stand: 0,
    lean: 0,
    pitch: 0,
    drop: 0,
    arms: {
      left: rest(profile === "weaker_left", "left"),
      right: rest(profile === "weaker_right", "right"),
    },
  };
}

/* ----------------------------------------------------------------- generate */

interface Person {
  role: "subject" | "helper";
  world: V[];
  vis: number[];
}

/** Generates a fixture from a spec. Same spec, same fixture. */
export function generate(spec: GenSpec): Fixture<GenTruth> {
  const r = rng(spec.seed);
  const size = FRAME_SIZE[spec.aspect];
  const aspect = size.w / size.h;
  const cd = cameraDefaults(spec);
  const cam = {
    distance: spec.camera?.distance ?? cd.distance,
    height: spec.camera?.height ?? cd.height,
    x: spec.camera?.x ?? 0,
    roll: (spec.camera?.rollDeg ?? 0) * D2R,
    mirror: spec.camera?.mirror ?? false,
  };
  const f = Math.min(size.w, size.h) / 2 / Math.tan(25 * D2R);
  const yaw = spec.subject?.yaw ?? cd.yaw;
  const scale = spec.subject?.scale ?? 1;
  const dims: BodyDims = Object.fromEntries(
    Object.entries(ADULT).map(([k, v]) => [k, v * scale]),
  ) as unknown as BodyDims;
  dims.shoulderHalf *= spec.subject?.shoulderScale ?? 1;
  const setting = spec.profile === "wheelchair" ? SETTINGS.wheelchair : SETTINGS.chair;
  const helperDims = ADULT;
  const weak: Side | null =
    spec.profile === "weaker_left" ? "left" : spec.profile === "weaker_right" ? "right" : null;
  const noise = spec.noise ?? 0.002;
  const noiseFace = spec.noiseFace ?? noise;
  const hipsHidden = spec.profile === "wheelchair" && (spec.wheelchairHips ?? "hidden") === "hidden";
  const light = Math.min(1, Math.max(0, spec.light ?? 1));
  const n = Math.max(1, Math.round(spec.durationSec * spec.fps));

  const truth: GenTruth = {
    yawDeg: yaw,
    distanceM: cam.distance,
    aspect,
    expectedView: expectedViewOf(yaw),
    weakerSide: weak,
    subjectIndex: [],
    helperIndex: [],
    events: [],
    armPeakDeg: { left: 0, right: 0 },
  };
  if (spec.rom) truth.rom = romTruth(spec.rom, spec.subject?.motions ?? []);
  const farSeen = new Set(spec.rom?.farSeen ?? []);
  const reps: NonNullable<GenTruth["reps"]> = [];
  for (const m of spec.subject?.motions ?? []) {
    if (m.kind === "curl_rep")
      reps.push({ kind: "curl", start: m.start, end: m.start + (m.dur ?? 2), top: m.top ?? 140 });
    if (m.kind === "stand_rep")
      reps.push({
        kind: "stand",
        start: m.start,
        end: m.start + (m.rise ?? 1) + (m.hold ?? 0.4) + (m.sit ?? 1),
        top: m.peak ?? 1,
        ...(m.push?.length ? { push: true } : {}),
      });
  }
  if (reps.length) truth.reps = reps.sort((a, b) => a.start - b.start);
  for (const m of spec.subject?.motions ?? []) {
    if (m.kind === "fall") truth.events.push({ kind: "fall", from: m.at, to: m.at + (m.dur ?? 0.6) });
    if (m.kind === "sway") truth.events.push({ kind: "sway", from: m.at, to: m.at + (m.dur ?? 1) });
    if (m.kind === "leave") truth.events.push({ kind: "leave", from: m.at, to: spec.durationSec });
    if (m.kind === "raise_hand") truth.events.push({ kind: "raise_hand", from: m.from, to: m.to });
  }
  const h = spec.helper;
  if (h?.touch) truth.events.push({ kind: "touch", from: h.touch.from, to: h.touch.to });
  if (h?.hover) truth.events.push({ kind: "hover", from: h.hover.from, to: h.hover.to });
  for (const j of spec.jolts ?? []) truth.events.push({ kind: "jolt", from: j.at, to: j.at });
  let crossFrom: number | null = null;

  const project = (P: V, hipDepth: number) => {
    const X = P[0] - cam.x;
    const Y = P[1] - cam.height;
    const D = Math.max(cam.distance - P[2], 0.05);
    let u = f * (X / D);
    let v = -f * (Y / D);
    if (cam.roll) {
      const c = Math.cos(cam.roll);
      const s = Math.sin(cam.roll);
      [u, v] = [u * c - v * s, u * s + v * c];
    }
    u += size.w / 2;
    v += size.h / 2;
    if (cam.mirror) u = size.w - u;
    return { x: u / size.w, y: v / size.h, z: ((D - hipDepth) * f) / (hipDepth * size.w) };
  };

  const frames: Fixture<GenTruth>["frames"] = [];
  const times = frameTimes(spec, n);
  for (let i = 0; i < n; i++) {
    const tMs = times[i].tMs;
    // Without jitter the body is drawn at the exact frame time (the fixture files on disk).
    const t = spec.timing?.jitterMs ? tMs / 1000 : i / spec.fps;

    // Subject.
    const s = spec.rom
      ? romBaseState(spec.rom, yaw, spec.subject?.x)
      : baseState(spec.profile, yaw, spec.subject?.x ?? 0, spec.subject?.arms);
    for (const m of spec.subject?.motions ?? []) applyMotion(m, t, s);
    finishRomState(s);
    if (weak) {
      const rest = baseState(spec.profile, yaw, 0, spec.subject?.arms).arms[weak];
      const a = s.arms[weak];
      a.elev = rest.elev + (a.elev - rest.elev) * 0.6;
      a.elbow = rest.elbow + (a.elbow - rest.elbow) * 0.6;
    }
    truth.armPeakDeg.left = Math.max(truth.armPeakDeg.left, s.arms.left.elev);
    truth.armPeakDeg.right = Math.max(truth.armPeakDeg.right, s.arms.right.elev);
    const subjectWorld = skeleton(s, dims, setting);
    const people: Person[] = [{ role: "subject", world: subjectWorld, vis: [] }];

    // Helper.
    if (h) {
      let hx = (spec.subject?.x ?? 0) + h.x;
      if (h.walk && t >= h.walk.start) {
        const dir = Math.sign(h.walk.toX - h.x);
        hx =
          (spec.subject?.x ?? 0) +
          h.x +
          dir * Math.min(Math.abs(h.walk.toX - h.x), h.walk.speed * (t - h.walk.start));
      }
      const hs: PoseState = { ...baseState("chair", h.yaw ?? 0, hx), z: h.z, stand: 1 };
      // A touch puts the wrist on the outside of the shoulder, so the fingers lie on it. A hover
      // keeps the finger tips `gap` metres off that point: the wrist stands a hand length further out,
      // since the hand points along the forearm toward the shoulder.
      const reachFor = (
        w: { from: number; to: number; hand?: Side; shoulder?: Side },
        gap: number | null,
      ) => {
        if (t < w.from || t > w.to) return;
        const sh = subjectWorld[w.shoulder === "right" ? LM.r_shoulder : LM.l_shoulder];
        const other = subjectWorld[w.shoulder === "right" ? LM.l_shoulder : LM.r_shoulder];
        const out = unit(sub(sh, other));
        const off = gap === null ? 0.03 : 0.03 + gap + helperDims.hand;
        const hand = w.hand ?? (hx > (spec.subject?.x ?? 0) ? "right" : "left");
        hs.reach = { hand, target: add(sh, add(mul(out, off), [0, 0.04, 0])) };
      };
      if (h.touch) reachFor(h.touch, null);
      if (h.hover) reachFor(h.hover, h.hover.gapM ?? 0.2);
      people.push({
        role: "helper",
        world: skeleton(hs, helperDims, { ...SETTINGS.chair, standing: true }),
        vis: [],
      });
      const sx = subjectWorld[LM.l_hip][0] / 2 + subjectWorld[LM.r_hip][0] / 2;
      const crossing = h.z > 0.2 && Math.abs(hx - sx) < 0.6;
      if (crossing && crossFrom === null) crossFrom = t;
      if (!crossing && crossFrom !== null) {
        truth.events.push({ kind: "crossing", from: crossFrom, to: t });
        crossFrom = null;
      }
    }

    // Phone movement, the same for everyone in the frame.
    let ox = 0;
    let oy = 0;
    if (spec.shake) {
      const w = 2 * Math.PI * spec.shake.hz * t;
      ox += spec.shake.amp * (Math.sin(w) + 0.4 * Math.sin(2.3 * w + 1));
      oy += spec.shake.amp * 0.7 * (Math.sin(1.37 * w + 2) + 0.3 * Math.sin(3.1 * w));
    }
    for (const j of spec.jolts ?? []) {
      if (t >= j.at) {
        ox += j.dx;
        oy += j.dy;
      }
    }

    // Project, then decide what the model would see.
    const projected = people.map((pp) => {
      const hipD = cam.distance - (pp.world[LM.l_hip][2] + pp.world[LM.r_hip][2]) / 2;
      const lmks = pp.world.map((P) => project(P, hipD));
      const depth = cam.distance - pp.world.reduce((acc, P) => acc + P[2], 0) / 33;
      return { pp, lmks, depth };
    });

    const poses: { role: Person["role"]; lm: Landmark[] }[] = [];
    for (const pr of projected) {
      const { pp, lmks } = pr;
      // Far side of a turned body: the model sees it less well.
      const th = (pp.role === "subject" ? yaw : (h?.yaw ?? 0)) * D2R;
      const towardCam = Math.sin(th); // world z of the person's left axis
      const vis = lmks.map((q, k) => {
        let v = 0.985 - 0.03 * r();
        const sd = SIDE_OF[k];
        if (sd !== 0 && sd * towardCam < 0 && !(pp.role === "subject" && farSeen.has(k)))
          v -= (0.5 * Math.max(0, Math.abs(towardCam) - 0.3)) / 0.7;
        if (pp.role === "subject" && hipsHidden) {
          if (k === LM.l_hip || k === LM.r_hip) v = 0.25 + 0.15 * r();
          if (k === 25 || k === 26) v = Math.min(v, 0.55 + 0.1 * r());
        }
        if (pp.role === "subject") {
          for (const o of spec.occlusions ?? []) {
            if (t >= o.from && t <= o.to && o.landmarks.includes(k)) v = o.visibility ?? 0.1;
          }
        }
        if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) v = 0.05 + 0.1 * r();
        return v * light;
      });
      // Hidden behind a nearer person.
      let hidden = 0;
      for (const other of projected) {
        if (other === pr || other.depth >= pr.depth) continue;
        const pts = other.lmks.filter((q) => q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1);
        if (pts.length < 2) continue;
        const bx0 = Math.min(...pts.map((q) => q.x));
        const bx1 = Math.max(...pts.map((q) => q.x));
        const by0 = Math.min(...pts.map((q) => q.y));
        const by1 = Math.max(...pts.map((q) => q.y));
        const mx = (bx1 - bx0) * 0.15;
        lmks.forEach((q, k) => {
          if (q.x > bx0 + mx && q.x < bx1 - mx && q.y > by0 && q.y < by1) {
            vis[k] = Math.min(vis[k], 0.15 + 0.15 * r());
            hidden++;
          }
        });
      }
      const inFrame = lmks.filter((q) => q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1).length;
      if (inFrame < 8 || hidden > 0.6 * 33) {
        // The model would not return this pose; keep the random stream aligned.
        lmks.forEach(() => (gauss(r), gauss(r)));
        continue;
      }
      const noiseScale = (k: number) =>
        pp.role === "subject" && hipsHidden && (k === 23 || k === 24) ? 3 : 1;
      const lm: Landmark[] = lmks.map((q, k) => ({
        x: q.x + (ox + gauss(r) * (k <= 10 ? noiseFace : noise) * noiseScale(k)) / aspect,
        y: q.y + oy + gauss(r) * (k <= 10 ? noiseFace : noise) * noiseScale(k),
        z: q.z,
        visibility: Math.min(1, Math.max(0, vis[k])),
      }));
      poses.push({ role: pp.role, lm });
    }

    if (spec.shuffle && poses.length > 1 && r() < 0.5) poses.reverse();
    // A frame the camera did not deliver is drawn (the random stream stays aligned) but not kept.
    if (!times[i].kept) continue;
    truth.subjectIndex.push(poses.findIndex((p) => p.role === "subject"));
    truth.helperIndex.push(poses.findIndex((p) => p.role === "helper"));
    frames.push({ t: tMs, poses: poses.map((p) => p.lm) });
  }
  if (crossFrom !== null) truth.events.push({ kind: "crossing", from: crossFrom, to: spec.durationSec });
  truth.events.sort((a, b) => a.from - b.from);

  return {
    meta: {
      test: spec.test,
      profile: spec.profile,
      aspect,
      fps: spec.fps,
      notes: spec.notes ?? "",
      source: "generated",
      spec,
    },
    truth,
    frames,
  };
}

/**
 * Frame times (ms) of a spec and whether the camera delivers each frame (GenSpec.timing). The
 * timing has its own random stream, so the landmarks of a frame do not depend on it.
 */
function frameTimes(spec: GenSpec, n: number): { tMs: number; kept: boolean }[] {
  const tm = spec.timing ?? {};
  const r = rng((spec.seed ^ 0x5bd1e995) >>> 0);
  const out: { tMs: number; kept: boolean }[] = [];
  let prev = -Infinity;
  for (let i = 0; i < n; i++) {
    const base = (i * 1000) / spec.fps;
    const jitter = i > 0 && tm.jitterMs ? (2 * r() - 1) * tm.jitterMs : 0;
    // Times stay in order and at least 1 ms apart, as a camera's do.
    const tMs = Math.max(Math.round(base + jitter), prev + 1);
    prev = tMs;
    let kept = !(tm.dropShare && i > 0 && r() < tm.dropShare);
    const sec = tMs / 1000;
    const g = tm.gaps;
    if (g && sec > (g.fromSec ?? 0)) {
      const k = Math.floor(sec / g.everySec);
      const into = sec - k * g.everySec;
      if (k >= 1 && into > 1e-6 && into < g.ms / 1000 - 1e-6) kept = false;
    }
    if ((tm.stalls ?? []).some((st) => sec >= st.from && sec < st.to)) kept = false;
    out.push({ tMs, kept });
  }
  return out;
}

/** Frames (index) whose time in seconds falls inside an event of a kind, with a margin. */
export function framesIn(fx: Fixture<GenTruth>, kind: string, marginSec = 0): Set<number> {
  const out = new Set<number>();
  const evs = fx.truth.events.filter((e) => e.kind === kind);
  fx.frames.forEach((f, i) => {
    const t = f.t / 1000;
    if (evs.some((e) => t >= e.from - marginSec && t <= e.to + marginSec)) out.add(i);
  });
  return out;
}

/* ============================================================================================== */
/* v7 range of motion (product v7 contract 8.2, stream B, step B2)                                */
/* ============================================================================================== */

/**
 * The mannequin's new joint states for the 16 measured movements of rom-protocol.json, in the
 * positions they are measured in, and the compensations of its movements[].compensations. A spec
 * with `rom` poses the subject with romSkeleton instead of skeleton (whose output is unchanged: every
 * existing spec regenerates byte identical, tests/v7/b-gen-rom.test.ts):
 *
 *   - Positions (RomPositionId): seated (and seated_forward, seated_armrests) on the chair of the v1
 *     profiles, thighs forward and knees bent; standing (and standing_supported, hands on a counter
 *     or a wall where the instructions put them) with straight legs and the feet on the floor; lying
 *     on the back (lying_back) on a bed, the body turned so its front faces up.
 *   - Joints: the leg from the hip by forward kinematics (hip flexion, abduction and rotation, knee
 *     flexion, ankle), a heel that slides along the bed while the knee bends (lying), the knee to
 *     wall lunge with the front foot planted, the pelvis tilted in the frontal plane (a hip hike) or
 *     shifted, the upper body turned about the trunk axis, each shoulder raised (a hike or a shrug),
 *     the head on the neck (flexion, tilt, turn), and the arm model of the v1 mannequin.
 *   - The movement's own angle (RomState.angle, in the movement's convention: flexion, lack or
 *     signed) sets its joint (setRomAngle); the true angle of a repetition is the angle the
 *     mannequin is posed at, the clinical angle a goniometer would read in the movement's plane.
 *     Each rep's plateau (start, end) is in truth.rom.reps.
 *   - Compensations (rom_offset) add to any joint after the movement's own joint is set; a hand can
 *     hold a point of the body (rom_hand: an assisted lift, hands on the thighs).
 *
 * Numbers here are the mannequin's geometry and the camera placement of the movements' instructions
 * (rom-protocol movements[].camera and distanceM, held equal to the data by the tests), never a
 * clinical threshold. Clearly synthetic; never shown as a person.
 */

/** One leg's joints in degrees, posed from the hip in the pelvis frame. */
export interface LegState {
  /** The thigh turned forward from straight down along the trunk; negative behind it (hip extension). */
  hipFlex: number;
  /** The thigh turned out to the side. */
  hipAbd: number;
  /** Positive turns the front of the knee outward (external rotation). */
  hipRot: number;
  /** The shank turned back from the thigh's line; negative past straight. */
  knee: number;
  /** The foot turned up toward the shin from square to the shank. */
  ankle: number;
}

/** A body point a hand can hold: the knee, the ankle, the middle of the thigh, the elbow. */
export type BodyPart = "knee" | "ankle" | "thigh" | "elbow";

/** What a compensation moves, added to the posture (degrees, or metres for the shifts and rises). */
export interface RomOffset {
  /** The trunk bent forward at the hips (negative: back). */
  pitch?: number;
  /** The trunk bent toward the person's left. */
  lean?: number;
  /** The upper body turned about the trunk axis, positive turning the face toward the person's left. */
  twist?: number;
  /** The pelvis tilted in the frontal plane, positive raising the left hip. */
  pelvisRoll?: number;
  /** The pelvis moved toward the person's left, metres. */
  pelvisShift?: number;
  /** A shoulder raised along the trunk, metres. */
  shoulderRise?: Partial<Record<Side, number>>;
  /** The head: flexion (chin down), tilt toward the left shoulder, turn toward the left. */
  neck?: Partial<RomState["neck"]>;
  arms?: Partial<Record<Side, Partial<ArmState>>>;
  legs?: Partial<Record<Side, Partial<LegState>>>;
  /** The lunge's front leg: the knee drifting out of the leg's plane, the heel lifting, the foot turning out. */
  lunge?: Partial<{ kneeDriftDeg: number; heelLiftDeg: number; footTurnDeg: number }>;
}

/** A hand target: a fixed support in the room (a counter, a wall), or a point of the person's own body. */
type HandTarget = { kind: "support"; at: V } | { kind: "body"; part: BodyPart; side: Side };

export interface RomState {
  movement: RomMovementId;
  posture: RomPositionId;
  /** The tested side; the bend direction of the front view side bends; none for the axial side views. */
  side: RomSide;
  /** The movement's angle at the start pose, in its convention. */
  rest: number;
  /** The movement's angle now, in its convention (the rest angle plus the reps). */
  angle: number;
  pelvisRoll: number;
  pelvisShift: number;
  twist: number;
  shoulderRise: Record<Side, number>;
  neck: { flex: number; tilt: number; turn: number };
  legs: Record<Side, LegState>;
  /** Lying: the heel kept on the bed (or the towel) while the knee bends, the ankle this high above the hip joint (metres). */
  heelSlide: Partial<Record<Side, number>>;
  /** The knee to wall lunge, the front foot planted at its start place. */
  lunge: {
    side: Side;
    shankDeg: number;
    kneeDriftDeg: number;
    heelLiftDeg: number;
    footTurnDeg: number;
  } | null;
  hands: Partial<Record<Side, HandTarget>>;
  /** The arms hang straight down whatever the trunk does (the forward bend). */
  armsVertical: boolean;
  /** The compensations of this frame, added after the movement's own joint is set. */
  offset: Required<Omit<RomOffset, "shoulderRise" | "neck" | "arms" | "legs" | "lunge">> & {
    shoulderRise: Record<Side, number>;
    neck: RomState["neck"];
    arms: Record<Side, ArmState>;
    legs: Record<Side, LegState>;
    lunge: { kneeDriftDeg: number; heelLiftDeg: number; footTurnDeg: number };
  };
}

export interface RomGenSpec {
  movement: RomMovementId;
  position: RomPositionId;
  /** The tested side, the bend direction of the front view side bends, or none for the axial side views. */
  side: RomSide;
  /** The axial side views (side none): the person's side toward the phone. Default right. */
  cameraSide?: Side;
  /** The movement's angle at the start pose (default ROM_REST_DEG of the position). */
  rest?: number;
  /**
   * Far side landmarks the model sees as well as the near ones (MediaPipe ids): a far limb in the
   * clear, or a far hand crossing in front of the body. By default the far side of a side view is
   * reported at a low visibility, as the v1 mannequin does.
   */
  farSeen?: number[];
}

export interface RomTruth {
  movement: RomMovementId;
  position: RomPositionId;
  side: RomSide;
  /** The movement's true angle at the start pose. */
  restDeg: number;
  /**
   * The scripted repetitions in time order: the true end angle (`peakDeg`, the plateau's angle) and
   * the plateau, from the end of the rise to the start of the lowering (seconds).
   */
  reps: { start: number; plateauFrom: number; plateauTo: number; end: number; peakDeg: number }[];
  /** Scripted compensations (rom_offset) and hand holds (rom_hand), seconds. */
  compensations: { kind: "offset" | "hand"; from: number; to: number }[];
}

/** The range of motion motions (v7). */
export type RomMotionSpec =
  /**
   * One repetition: the movement's angle from the rest angle to `peak` over `rise` s (default 2),
   * held `hold` s (default ROM_REP.hold), back over `lower` s (default 2). `tremor` wobbles the held
   * angle (amplitude in degrees, frequency in Hz) from the end of the rise to the start of the return.
   */
  | {
      kind: "rom_rep";
      start: number;
      peak: number;
      rise?: number;
      hold?: number;
      lower?: number;
      tremor?: { amp: number; hz: number };
    }
  /** The angle never settles: rest + amp × (1 - cos(2π (t - from) / periodSec)) / 2, from `from` to `to` s. */
  | { kind: "rom_wander"; from: number; to: number; amp: number; periodSec: number }
  /** A compensation: the offset scaled by an envelope (default start 0.5, rise 1, hold 1, back 1). */
  | { kind: "rom_offset"; offset: RomOffset; start: number; rise?: number; hold?: number; back?: number }
  /** A hand holds a point of the body (the side `of`) between from and to s. */
  | { kind: "rom_hand"; hand: Side; part: BodyPart; of: Side; from: number; to: number };

/**
 * Rep timing defaults (seconds): a slow rise, a hold while the maximum question comes and is answered
 * (the instructions' «Hold for a moment»; the runner asks once the angle has held 1 s), a slow return.
 */
export const ROM_REP = { rise: 2, hold: 4, lower: 2 } as const;

/**
 * The face points' landmark noise as a share of the body's: a pose model places the face's sharp
 * features (eyes, ears) about three times more precisely than the shoulders. The per keypoint spreads
 * of the COCO keypoint evaluation (Object Keypoint Similarity, kpt_oks_sigmas in pycocotools
 * cocoeval.py of github.com/cocodataset/cocoapi, Simplified BSD licence: nose 0.026, eyes 0.025, ears
 * 0.035, shoulders 0.079): the ears' spread over the shoulders', the least precise face point the
 * neck angles read. Only the two numbers are used; no code is taken.
 */
export const COCO_KEYPOINT_SIGMA = { ears: 0.035, shoulders: 0.079 } as const;
export const ROM_FACE_NOISE_SHARE = COCO_KEYPOINT_SIGMA.ears / COCO_KEYPOINT_SIGMA.shoulders;

/** The view each movement is filmed in (rom-protocol movements[].view; tests hold it equal to the data). */
export const ROM_VIEW: Record<RomMovementId, "front" | "side"> = {
  shoulder_flexion: "side",
  shoulder_abduction: "front",
  shoulder_extension: "side",
  elbow_extension: "side",
  elbow_flexion: "side",
  hip_flexion: "side",
  hip_extension: "side",
  hip_abduction: "front",
  knee_flexion: "side",
  knee_extension: "side",
  ankle_dorsiflexion_lunge: "side",
  trunk_lateral_flexion: "front",
  trunk_flexion: "side",
  neck_lateral_flexion: "front",
  neck_flexion: "side",
  neck_extension: "side",
};

/**
 * The phone's distance per movement, metres: inside each movement's distanceM (rom-protocol
 * movements[].distanceM: 2 to 3 m, about 2 m for the elbow and the lunge, about 1.5 m for the neck;
 * tests hold each one inside the data's band).
 */
export const ROM_DISTANCE_M: Record<RomMovementId, number> = {
  shoulder_flexion: 2.5,
  shoulder_abduction: 2.5,
  shoulder_extension: 2.5,
  elbow_extension: 2,
  elbow_flexion: 2,
  hip_flexion: 2.5,
  hip_extension: 2.5,
  hip_abduction: 2.5,
  knee_flexion: 2.5,
  knee_extension: 2.5,
  ankle_dorsiflexion_lunge: 2,
  trunk_lateral_flexion: 2.5,
  trunk_flexion: 2.5,
  neck_lateral_flexion: 1.5,
  neck_flexion: 1.5,
  neck_extension: 1.5,
};

/** The bed: its top this high (metres); lying, the joint centres sit BED_JOINT above it. */
export const BED_TOP = 0.5;
const BED_JOINT = 0.1;
/** Standing: the ankle joint above the floor (the v1 chair setting's ankleHeight). */
const STAND_ANKLE = SETTINGS.chair.ankleHeight;

/** The movement's angle at the start pose, per position (rom-protocol movements[].startPose). */
export function romRestDeg(movement: RomMovementId, position: RomPositionId): number {
  switch (movement) {
    case "shoulder_flexion":
    case "shoulder_abduction":
    case "shoulder_extension":
      // «arm hanging by the side»: the rest arm of the v1 mannequin.
      return 5;
    case "elbow_flexion":
      // «upper arm by the side, elbow straight».
      return 5;
    case "elbow_extension":
      // «elbow bent to about a right angle with the forearm forward».
      return 90;
    case "hip_flexion":
      // Lying: «both legs straight»; seated: the thigh on the seat.
      return position === "seated" ? 90 : 0;
    case "knee_extension":
      // Lying: «the heel first slides up so the knee bends a little»; seated: the shank hanging.
      return position === "seated" ? 90 : 30;
    default:
      return 0;
  }
}

/**
 * The camera of a range of motion spec: the movement's distance and view, at the height its
 * instructions name (rom-protocol movements[].instructions), lowered where a landscape picture at
 * that height would cut a gate landmark off (the neck movements' hips at 1.5 m).
 */
function romCamera(spec: GenSpec, r: RomGenSpec): { distance: number; height: number; yaw: number } {
  const facing: Side = r.side === "none" ? (r.cameraSide ?? "right") : r.side;
  // A side view turns the tested side (or the camera side) to the phone: yaw -90 shows the right side.
  const yaw = ROM_VIEW[r.movement] === "front" ? 0 : facing === "left" ? 90 : -90;
  const seated = r.position.startsWith("seated");
  const landscape = FRAME_SIZE[spec.aspect].w > FRAME_SIZE[spec.aspect].h;
  let height: number;
  if (r.position === "lying_back")
    height = BED_TOP + BED_JOINT + 0.05; // «about the height of the bed»
  else if (r.movement.startsWith("neck"))
    // «the height of your head», seated; in landscape a little lower, as high as keeps the hips (a gate
    // landmark) in the picture at 1.5 m.
    height = landscape ? 1.05 : 1.2;
  else if (r.movement === "ankle_dorsiflexion_lunge")
    height = 0.7; // «so your feet show», 2 m away
  else if (r.movement === "trunk_flexion")
    height = seated ? 0.6 : 0.9; // «at hip height»
  else if (seated)
    height = 1; // shoulder or chest height, seated
  else if (r.movement === "trunk_lateral_flexion")
    height = 1.2; // «chest height ... head to knees»
  else height = 0.9; // «hip height, so your whole body shows»
  return { distance: ROM_DISTANCE_M[r.movement], height, yaw };
}

const zeroArm = (): ArmState => ({ elev: 0, plane: 0, elbow: 0, across: 0 });
const zeroLeg = (): LegState => ({ hipFlex: 0, hipAbd: 0, hipRot: 0, knee: 0, ankle: 0 });
function zeroOffset(): RomState["offset"] {
  return {
    pitch: 0,
    lean: 0,
    twist: 0,
    pelvisRoll: 0,
    pelvisShift: 0,
    shoulderRise: { left: 0, right: 0 },
    neck: { flex: 0, tilt: 0, turn: 0 },
    arms: { left: zeroArm(), right: zeroArm() },
    legs: { left: zeroLeg(), right: zeroLeg() },
    lunge: { kneeDriftDeg: 0, heelLiftDeg: 0, footTurnDeg: 0 },
  };
}

/** The start pose of a range of motion spec: the position's posture, the arms at rest or on their supports. */
function romBaseState(r: RomGenSpec, yaw: number, x: number | undefined): PoseState {
  const seated = r.position.startsWith("seated");
  const lying = r.position === "lying_back";
  const restArm = (): ArmState => ({ elev: 5, plane: 0, elbow: 5, across: 0 });
  const leg = (): LegState => ({ ...zeroLeg(), ...(seated ? { hipFlex: 90, knee: 90 } : {}) });
  const rest = r.rest ?? romRestDeg(r.movement, r.position);
  const rom: RomState = {
    movement: r.movement,
    posture: r.position,
    side: r.side,
    rest,
    angle: rest,
    pelvisRoll: 0,
    pelvisShift: 0,
    twist: 0,
    shoulderRise: { left: 0, right: 0 },
    neck: { flex: 0, tilt: 0, turn: 0 },
    legs: { left: leg(), right: leg() },
    heelSlide: {},
    lunge: null,
    hands: {},
    armsVertical: r.movement === "trunk_flexion",
    offset: zeroOffset(),
  };
  const tested: Side = r.side === "left" ? "left" : "right";
  const other: Side = tested === "left" ? "right" : "left";
  // Lying with the arms by the sides along the trunk.
  const arms: Record<Side, ArmState> = lying
    ? { left: { ...restArm(), elev: 8 }, right: { ...restArm(), elev: 8 } }
    : { left: restArm(), right: restArm() };
  // Supports the instructions name (positions standing_supported): hand targets in the body's start frame.
  if (r.position === "standing_supported") {
    switch (r.movement) {
      case "hip_extension":
        // «facing a kitchen counter or a heavy table with both hands on it».
        rom.hands = { left: supportAt(0.42, 0.2, 0.05), right: supportAt(0.42, -0.2, 0.05) };
        break;
      case "hip_abduction":
        // «the hand away from the leg you will move on a kitchen counter ... beside you».
        rom.hands = { [other]: supportAt(0, other === "left" ? 0.5 : -0.5, 0.05) };
        break;
      case "ankle_dorsiflexion_lunge":
        // «facing a wall with both hands on it»: at shoulder height, the wall 0.6 m in front of the pelvis.
        rom.hands = { left: supportAt(0.6, 0.2, 0.42), right: supportAt(0.6, -0.2, 0.42) };
        break;
      case "knee_flexion":
      case "shoulder_extension":
        // «holding a steady support»: the other hand on it, in front.
        rom.hands = { [other]: supportAt(0.42, other === "left" ? 0.2 : -0.2, 0.05) };
        break;
      default:
        // trunk_flexion: «a steady support close by in case you need it»: the arms hang.
        break;
    }
  }
  if (r.movement === "ankle_dorsiflexion_lunge")
    rom.lunge = { side: tested, shankDeg: 0, kneeDriftDeg: 0, heelLiftDeg: 0, footTurnDeg: 0 };
  return {
    x: x ?? 0,
    z: 0,
    yaw,
    stand: seated ? 0 : 1,
    lean: 0,
    pitch: 0,
    drop: 0,
    arms,
    rom,
  };
}

/** A support point, metres from the pelvis at the start: forward, toward the person's left, up. */
function supportAt(forward: number, left: number, up: number): HandTarget {
  // Resolved in romSkeleton against the start pelvis frame (the frame of the posture, before any movement).
  return { kind: "support", at: [left, up, forward] };
}

/** The scripted angle of a range of motion spec at time t (seconds): the rest angle plus the reps and the wander. */
export function romAngleAt(spec: GenSpec, t: number): number {
  const r = spec.rom;
  if (!r) throw new Error("romAngleAt: not a range of motion spec");
  const s = romBaseState(r, 0, 0);
  for (const m of spec.subject?.motions ?? []) applyRomMotion(m, t, s);
  return s.rom!.angle;
}

function applyRomMotion(m: MotionSpec, t: number, s: PoseState): void {
  const r = s.rom;
  if (!r) return;
  switch (m.kind) {
    case "rom_rep": {
      const rise = m.rise ?? ROM_REP.rise;
      const hold = m.hold ?? ROM_REP.hold;
      const e = envelope(t, m.start, rise, hold, m.lower ?? ROM_REP.lower);
      if (e <= 0) return;
      const held = t >= m.start + rise && t <= m.start + rise + hold;
      const wobble =
        m.tremor && held ? m.tremor.amp * Math.sin(2 * Math.PI * m.tremor.hz * (t - m.start - rise)) : 0;
      r.angle += (m.peak - r.rest) * e + wobble;
      return;
    }
    case "rom_wander": {
      if (t < m.from || t > m.to) return;
      r.angle += (m.amp * (1 - Math.cos((2 * Math.PI * (t - m.from)) / m.periodSec))) / 2;
      return;
    }
    case "rom_offset": {
      const e = envelope(t, m.start, m.rise ?? 1, m.hold ?? 1, m.back ?? 1);
      if (e <= 0) return;
      addOffset(r.offset, m.offset, e);
      return;
    }
    case "rom_hand":
      if (t >= m.from && t <= m.to) r.hands[m.hand] = { kind: "body", part: m.part, side: m.of };
      return;
    default:
      return;
  }
}

function addOffset(o: RomState["offset"], d: RomOffset, k: number): void {
  o.pitch += (d.pitch ?? 0) * k;
  o.lean += (d.lean ?? 0) * k;
  o.twist += (d.twist ?? 0) * k;
  o.pelvisRoll += (d.pelvisRoll ?? 0) * k;
  o.pelvisShift += (d.pelvisShift ?? 0) * k;
  for (const sd of ["left", "right"] as const) {
    o.shoulderRise[sd] += (d.shoulderRise?.[sd] ?? 0) * k;
    const a = d.arms?.[sd];
    if (a)
      for (const key of ["elev", "plane", "elbow", "across"] as const) o.arms[sd][key] += (a[key] ?? 0) * k;
    const l = d.legs?.[sd];
    if (l)
      for (const key of ["hipFlex", "hipAbd", "hipRot", "knee", "ankle"] as const)
        o.legs[sd][key] += (l[key] ?? 0) * k;
  }
  for (const key of ["flex", "tilt", "turn"] as const) o.neck[key] += (d.neck?.[key] ?? 0) * k;
  for (const key of ["kneeDriftDeg", "heelLiftDeg", "footTurnDeg"] as const)
    o.lunge[key] += (d.lunge?.[key] ?? 0) * k;
}

/** Lying, the heel kept on the bed (or the towel) at `ankleUp` above the hip joint: the knee's ankle height above the bed. */
const HEEL_ON_BED = -0.04;
const HEEL_ON_TOWEL = 0.04;

/**
 * The movement's own joint set to the state's angle (the movement's convention), the way its
 * instructions move it (rom-protocol movements[].instructions and variantInstructions).
 */
function setRomAngle(s: PoseState, r: RomState): void {
  const deg = r.angle;
  const side: Side = r.side === "left" ? "left" : "right";
  // Toward the person's left: the bend direction of the side bends.
  const toward = r.side === "left" ? 1 : -1;
  switch (r.movement) {
    case "shoulder_flexion":
      s.arms[side] = { ...s.arms[side], elev: deg, plane: 90, elbow: 5, across: 0 };
      return;
    case "shoulder_abduction":
      s.arms[side] = { ...s.arms[side], elev: deg, plane: 0, elbow: 5, across: 0 };
      return;
    case "shoulder_extension":
      s.arms[side] = { ...s.arms[side], elev: deg, plane: -90, elbow: 5, across: 0 };
      return;
    case "elbow_flexion":
    case "elbow_extension":
      // The upper arm by the side, the forearm bending forward (lack: degrees short of straight).
      s.arms[side] = { ...s.arms[side], elev: 2, plane: 90, elbow: deg, across: 0 };
      return;
    case "hip_flexion":
      // Lying: «Bend your knee and bring it toward your chest»; seated: «lift your knee toward your chest».
      r.legs[side] =
        r.posture === "lying_back"
          ? { ...r.legs[side], hipFlex: deg, knee: Math.min(140, 1.25 * Math.max(0, deg)) }
          : { ...r.legs[side], hipFlex: deg, knee: 90 };
      return;
    case "hip_extension":
      // «Keep your knee straight, and move your leg back».
      r.legs[side] = { ...r.legs[side], hipFlex: -deg, knee: 0 };
      return;
    case "hip_abduction":
      r.legs[side] = { ...r.legs[side], hipAbd: deg, knee: 0 };
      return;
    case "knee_flexion":
      // Lying: «Slide your heel along the bed toward your body»; standing: «bring your heel up behind you».
      r.legs[side] = { ...r.legs[side], knee: deg };
      if (r.posture === "lying_back") r.heelSlide[side] = HEEL_ON_BED;
      return;
    case "knee_extension":
      // Lying: «straighten it fully over a rolled towel under your ankle»; seated: «straighten your knee in front of you».
      if (r.posture === "lying_back") {
        r.legs[side] = { ...r.legs[side], knee: deg };
        r.heelSlide[side] = HEEL_ON_TOWEL;
      } else r.legs[side] = { ...r.legs[side], hipFlex: 90, knee: deg };
      return;
    case "ankle_dorsiflexion_lunge":
      if (r.lunge) r.lunge.shankDeg = deg;
      return;
    case "trunk_lateral_flexion":
      s.lean = toward * deg;
      return;
    case "trunk_flexion":
      s.pitch = deg;
      return;
    case "neck_lateral_flexion":
      r.neck.tilt = toward * deg;
      return;
    case "neck_flexion":
      r.neck.flex = deg;
      return;
    case "neck_extension":
      r.neck.flex = -deg;
      return;
  }
}

/** After the motions of a frame: the movement's joint, then the compensations on top. */
function finishRomState(s: PoseState): void {
  const r = s.rom;
  if (!r) return;
  setRomAngle(s, r);
  const o = r.offset;
  s.pitch += o.pitch;
  s.lean += o.lean;
  r.twist += o.twist;
  r.pelvisRoll += o.pelvisRoll;
  r.pelvisShift += o.pelvisShift;
  for (const sd of ["left", "right"] as const) {
    r.shoulderRise[sd] += o.shoulderRise[sd];
    const a = s.arms[sd];
    const da = o.arms[sd];
    s.arms[sd] = {
      elev: a.elev + da.elev,
      plane: a.plane + da.plane,
      elbow: a.elbow + da.elbow,
      across: a.across + da.across,
    };
    const l = r.legs[sd];
    const dl = o.legs[sd];
    r.legs[sd] = {
      hipFlex: l.hipFlex + dl.hipFlex,
      hipAbd: l.hipAbd + dl.hipAbd,
      hipRot: l.hipRot + dl.hipRot,
      knee: l.knee + dl.knee,
      ankle: l.ankle + dl.ankle,
    };
  }
  r.neck = {
    flex: r.neck.flex + o.neck.flex,
    tilt: r.neck.tilt + o.neck.tilt,
    turn: r.neck.turn + o.neck.turn,
  };
  if (r.lunge) {
    r.lunge.kneeDriftDeg += o.lunge.kneeDriftDeg;
    r.lunge.heelLiftDeg += o.lunge.heelLiftDeg;
    r.lunge.footTurnDeg += o.lunge.footTurnDeg;
  }
}

/** `v` turned by `deg` about the unit axis `k` (right hand rule, Rodrigues). */
function turnAbout(v: V, k: V, deg: number): V {
  if (!deg) return v;
  const a = deg * D2R;
  const c = Math.cos(a);
  return add(add(mul(v, c), mul(cross(k, v), Math.sin(a))), mul(k, dot(k, v) * (1 - c)));
}

/** The head landmarks in the trunk frame from mid shoulder (up, toward the left, forward), as the v1 mannequin places them. */
const HEAD_POINTS: [number, number, number, number][] = [
  [LM.nose, 0.2, 0, 0.1],
  [1, 0.24, 0.02, 0.085],
  [LM.l_eye, 0.24, 0.035, 0.08],
  [3, 0.24, 0.05, 0.07],
  [4, 0.24, -0.02, 0.085],
  [LM.r_eye, 0.24, -0.035, 0.08],
  [6, 0.24, -0.05, 0.07],
  [LM.l_ear, 0.22, 0.075, 0],
  [LM.r_ear, 0.22, -0.075, 0],
  [9, 0.16, 0.025, 0.09],
  [10, 0.16, -0.025, 0.09],
];
/** The head turns on the neck about a point this far above mid shoulder (metres). */
const NECK_PIVOT = 0.1;

interface LegFrame {
  Lp: V;
  Up: V;
  Fp: V;
}

/** One leg from its hip by forward kinematics: knee, ankle, heel and foot index. */
function legFK(H: V, j: LegState, sg: number, f: LegFrame, dims: BodyDims): { K: V; A: V; heel: V; toe: V } {
  const fl = j.hipFlex * D2R;
  const ab = j.hipAbd * D2R;
  const kn = j.knee * D2R;
  // The thigh: straight down, turned forward by the flexion, then out to the side by the abduction.
  const t1 = add(mul(f.Up, -Math.cos(fl)), mul(f.Fp, Math.sin(fl)));
  const k1 = add(mul(f.Fp, Math.cos(fl)), mul(f.Up, Math.sin(fl)));
  const t = unit(add(mul(t1, Math.cos(ab)), mul(f.Lp, sg * Math.sin(ab))));
  // The front of the knee: k1 (the abduction's own axis), turned outward about the thigh by the rotation.
  const out = mul(cross(t, k1), -1);
  const k = unit(add(mul(k1, Math.cos(j.hipRot * D2R)), mul(out, sg * Math.sin(j.hipRot * D2R))));
  const K = add(H, mul(t, dims.thigh));
  const sh = unit(sub(mul(t, Math.cos(kn)), mul(k, Math.sin(kn))));
  const A = add(K, mul(sh, dims.shank));
  // The foot square to the shank toward the front, turned up toward the shin by the ankle.
  const f0 = add(mul(k, Math.cos(kn)), mul(t, Math.sin(kn)));
  const an = j.ankle * D2R;
  const fd = unit(add(mul(f0, Math.cos(an)), mul(sh, -Math.sin(an))));
  return {
    K,
    A,
    heel: add(A, add(mul(fd, -0.05), mul(sh, 0.05))),
    toe: add(A, add(mul(fd, 0.17), mul(sh, 0.06))),
  };
}

/** Lying, the heel on the bed: the hip flexion that keeps the ankle `ankleUp` above the hip joint for this knee flexion. */
function heelSlideHip(kneeDeg: number, ankleUp: number, dims: BodyDims): number {
  const kn = kneeDeg * D2R;
  const height = (fl: number) => dims.thigh * Math.sin(fl) + dims.shank * Math.sin(fl - kn);
  let lo = -40 * D2R;
  let hi = 100 * D2R;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (height(mid) < ankleUp) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2 / D2R;
}

/** The ids of one leg's points. */
const LEG_IDS = { left: { k: 25, a: 27, h: 29, f: 31 }, right: { k: 26, a: 28, h: 30, f: 32 } } as const;

/** World positions of the 33 landmarks of the range of motion mannequin (contract 8.2). */
function romSkeleton(s: PoseState, r: RomState, dims: BodyDims): V[] {
  const th = s.yaw * D2R;
  const Lw: V = [Math.cos(th), 0, Math.sin(th)];
  const Fw: V = [-Math.sin(th), 0, Math.cos(th)];
  const Uw: V = [0, 1, 0];
  const lying = r.posture === "lying_back";
  const seated = r.posture.startsWith("seated");
  // The body's frame: upright, or lying on the back (the upright body turned back about its left axis).
  const Lb = Lw;
  const Ub: V = lying ? mul(Fw, -1) : Uw;
  const Fb: V = lying ? Uw : Fw;
  const frameW = (base: V, l: number, u: number, f: number): V =>
    add(base, add(mul(Lb, l), add(mul(Ub, u), mul(Fb, f))));
  const origin: V = [s.x, 0, s.z];
  const legLen = dims.thigh + dims.shank;
  const standH = STAND_ANKLE + legLen;

  // The pelvis at the start pose: on the seat, over straight legs, or on the bed (the body centred:
  // the head end reaches about 0.8 m from the pelvis, the heels about 0.95 m).
  const pelvis0: V = lying
    ? add([s.x, BED_TOP + BED_JOINT, s.z], mul(Ub, 0.075))
    : add(origin, mul(Uw, seated ? SETTINGS.chair.seat + dims.hipAboveSeat : standH));
  const out: V[] = Array.from({ length: 33 }, () => [0, 0, 0] as V);

  // The lunge: the front foot planted where it stood, the pelvis carried by the front leg.
  let pelvis = pelvis0;
  let lungeLeg: { K: V; A: V; heel: V; toe: V } | null = null;
  if (r.lunge) {
    const lg = r.lunge;
    const sg = lg.side === "left" ? 1 : -1;
    const A0: V = add([s.x, STAND_ANKLE, s.z], mul(Lb, sg * dims.hipHalf));
    const fdir = unit(
      add(mul(Fb, Math.cos(lg.footTurnDeg * D2R)), mul(Lb, sg * Math.sin(lg.footTurnDeg * D2R))),
    );
    const toe = add(A0, add(mul(fdir, 0.17), mul(Uw, -0.06)));
    const heel0 = add(A0, add(mul(fdir, -0.05), mul(Uw, -0.05)));
    // The heel lifting: the foot turned about the toe, heel up.
    const axis = unit(cross(Uw, fdir));
    const A = add(toe, turnAbout(sub(A0, toe), axis, lg.heelLiftDeg));
    const heel = add(toe, turnAbout(sub(heel0, toe), axis, lg.heelLiftDeg));
    // The shank tilted forward over the toes by the movement's angle, the knee drifting toward the midline.
    const ph = lg.shankDeg * D2R;
    const dr = lg.kneeDriftDeg * D2R;
    const sDir = unit(
      add(mul(add(mul(Uw, Math.cos(ph)), mul(Fb, Math.sin(ph))), Math.cos(dr)), mul(Lb, -sg * Math.sin(dr))),
    );
    const K = add(A, mul(sDir, dims.shank));
    // The thigh leaning back three quarters as much, so the hip sinks and comes forward behind the knee.
    const ps = 0.75 * ph;
    const H = add(K, mul(add(mul(Uw, Math.cos(ps)), mul(Fb, -Math.sin(ps))), dims.thigh));
    pelvis = sub(H, mul(Lb, sg * dims.hipHalf));
    lungeLeg = { K, A, heel, toe };
  }
  pelvis = add(pelvis, mul(Lb, r.pelvisShift));

  // The trunk: bent forward at the hips (pitch), to the side (lean), the upper body turned (twist).
  const p = s.pitch * D2R;
  const la = s.lean * D2R;
  const U1: V = [0, Math.cos(p), Math.sin(p)];
  const L1: V = [1, 0, 0];
  const Ut: V = add(mul(U1, Math.cos(la)), mul(L1, Math.sin(la)));
  const Lt: V = sub(mul(L1, Math.cos(la)), mul(U1, Math.sin(la)));
  const toW = (v: V): V => add(mul(Lb, v[0]), add(mul(Ub, v[1]), mul(Fb, v[2])));
  const ut = toW(Ut);
  const lt0 = toW(Lt);
  const ft0 = cross(lt0, ut);
  const lt = turnAbout(lt0, ut, r.twist);
  const ft = turnAbout(ft0, ut, r.twist);
  const midS = add(pelvis, mul(ut, dims.trunk));
  const at = (base: V, u: number, l: number, f: number): V =>
    add(base, add(mul(ut, u), add(mul(lt, l), mul(ft, f))));

  // The head on the neck: turned, tilted and bent about a point above mid shoulder.
  const neckAt = at(midS, NECK_PIVOT, 0, 0);
  for (const [i, u, l, f] of HEAD_POINTS) {
    let v = add(mul(ut, u - NECK_PIVOT), add(mul(lt, l), mul(ft, f)));
    v = turnAbout(v, ut, r.neck.turn);
    v = turnAbout(v, ft, -r.neck.tilt);
    v = turnAbout(v, lt, r.neck.flex);
    out[i] = add(neckAt, v);
  }

  // Shoulders (raised along the trunk by a hike or a shrug), hips (the pelvis tilted by a hip hike).
  out[LM.l_shoulder] = add(at(midS, 0, dims.shoulderHalf, 0), mul(ut, r.shoulderRise.left));
  out[LM.r_shoulder] = add(at(midS, 0, -dims.shoulderHalf, 0), mul(ut, r.shoulderRise.right));
  const roll = r.pelvisRoll * D2R;
  const Lp = add(mul(Lb, Math.cos(roll)), mul(Ub, Math.sin(roll)));
  const Up = sub(mul(Ub, Math.cos(roll)), mul(Lb, Math.sin(roll)));
  const legFrame: LegFrame = { Lp, Up, Fp: Fb };
  out[LM.l_hip] = add(pelvis, mul(Lp, dims.hipHalf));
  out[LM.r_hip] = add(pelvis, mul(Lp, -dims.hipHalf));

  // Legs.
  for (const side of ["left", "right"] as const) {
    const sg = side === "left" ? 1 : -1;
    const I = LEG_IDS[side];
    const H = out[side === "left" ? LM.l_hip : LM.r_hip];
    let leg: { K: V; A: V; heel: V; toe: V };
    if (lungeLeg && r.lunge?.side === side) leg = lungeLeg;
    else if (r.lunge) {
      // The back leg of the lunge: its foot on the floor behind (inverse kinematics, the knee forward).
      const B: V = add(add([s.x, STAND_ANKLE, s.z], mul(Lb, sg * dims.hipHalf)), mul(Fb, -0.3));
      const k = twoBone(H, B, dims.thigh, dims.shank, Fb);
      leg = {
        K: k.mid,
        A: k.end,
        heel: add(k.end, add(mul(Fb, -0.05), mul(Uw, -0.05))),
        toe: add(k.end, add(mul(Fb, 0.17), mul(Uw, -0.06))),
      };
    } else {
      const j = r.legs[side];
      const slide = r.heelSlide[side];
      // A heel on the bed: the hip follows the knee (a compensation's hip flexion adds to it).
      const joint =
        slide === undefined ? j : { ...j, hipFlex: heelSlideHip(j.knee, slide, dims) + j.hipFlex };
      leg = legFK(H, joint, sg, legFrame, dims);
    }
    out[I.k] = leg.K;
    out[I.a] = leg.A;
    out[I.h] = leg.heel;
    out[I.f] = leg.toe;
  }

  // Arms: on a support or a point of the body, or posed; an arm holding the other one goes last.
  const holdsElbow = (side: Side) => {
    const h = r.hands[side];
    return h?.kind === "body" && h.part === "elbow";
  };
  const order: Side[] = holdsElbow("left") ? ["right", "left"] : ["left", "right"];
  for (const side of order) {
    const h = r.hands[side];
    let target: V | null = null;
    if (h?.kind === "support") target = frameW(pelvis0, h.at[0], h.at[1], h.at[2]);
    else if (h?.kind === "body") {
      const o = h.side;
      if (h.part === "knee") target = out[LEG_IDS[o].k];
      else if (h.part === "ankle") target = out[LEG_IDS[o].a];
      else if (h.part === "elbow") target = out[o === "left" ? LM.l_elbow : LM.r_elbow];
      else {
        // The middle of the thigh, on its top.
        const hip = out[o === "left" ? LM.l_hip : LM.r_hip];
        target = add(add(out[LEG_IDS[o].k], mul(sub(hip, out[LEG_IDS[o].k]), 0.5)), mul(Fb, 0.06));
      }
    }
    const arm =
      r.armsVertical && !target
        ? { ...s.arms[side], elev: s.arms[side].elev + s.pitch, plane: 90 }
        : s.arms[side];
    placeArm(out, side, arm, target, [0, -1, 0], dims, { ut, lt, ft });
  }
  return out;
}

/** The truth of a range of motion spec: the rest angle, each rep's plateau and end angle, the scripted compensations. */
function romTruth(r: RomGenSpec, motions: MotionSpec[]): RomTruth {
  const rest = r.rest ?? romRestDeg(r.movement, r.position);
  const reps: RomTruth["reps"] = [];
  const compensations: RomTruth["compensations"] = [];
  for (const m of motions) {
    if (m.kind === "rom_rep") {
      const rise = m.rise ?? ROM_REP.rise;
      const hold = m.hold ?? ROM_REP.hold;
      reps.push({
        start: m.start,
        plateauFrom: m.start + rise,
        plateauTo: m.start + rise + hold,
        end: m.start + rise + hold + (m.lower ?? ROM_REP.lower),
        peakDeg: m.peak,
      });
    }
    if (m.kind === "rom_offset")
      compensations.push({
        kind: "offset",
        from: m.start,
        to: m.start + (m.rise ?? 1) + (m.hold ?? 1) + (m.back ?? 1),
      });
    if (m.kind === "rom_hand") compensations.push({ kind: "hand", from: m.from, to: m.to });
  }
  reps.sort((a, b) => a.start - b.start);
  return { movement: r.movement, position: r.position, side: r.side, restDeg: rest, reps, compensations };
}
