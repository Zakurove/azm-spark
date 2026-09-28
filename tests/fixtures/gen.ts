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
  | { kind: "slide"; dx: number; start?: number; rise?: number; hold?: number; back?: number };

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
    const S = out[side === "left" ? LM.l_shoulder : LM.r_shoulder];
    let E: V;
    let Wr: V;
    let fd: V;
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
    if (target) {
      const pole: V = pushing ? add(mul(lt, sg), mul(ft, -1)) : [0, -1, 0];
      const k = twoBone(S, target, dims.upperArm, dims.forearm, pole);
      E = k.mid;
      Wr = k.end;
      fd = unit(sub(Wr, E));
    } else {
      const a = s.arms[side];
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

  return out;
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
  /** A moving phone: the whole image jitters (amplitude as a share of the image height). */
  shake?: { amp: number; hz: number };
  /** The phone slips: the whole image shifts at `at` seconds and stays shifted (share of height). */
  jolts?: { at: number; dx: number; dy: number }[];
  /** Scripted occlusion of subject landmarks (seconds). */
  occlusions?: { landmarks: number[]; from: number; to: number; visibility?: number }[];
  /** Shuffle the pose order every frame, as the model does not keep it. */
  shuffle?: boolean;
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
}

/** Test specific camera placement from the spec setups (distance, lens height, turn of the person). */
function cameraDefaults(spec: GenSpec): { distance: number; height: number; yaw: number } {
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
    const s = baseState(spec.profile, yaw, spec.subject?.x ?? 0, spec.subject?.arms);
    for (const m of spec.subject?.motions ?? []) applyMotion(m, t, s);
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
        if (sd !== 0 && sd * towardCam < 0) v -= (0.5 * Math.max(0, Math.abs(towardCam) - 0.3)) / 0.7;
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
        x: q.x + (ox + gauss(r) * noise * noiseScale(k)) / aspect,
        y: q.y + oy + gauss(r) * noise * noiseScale(k),
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
