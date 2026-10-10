/**
 * A synthetic walker for the gait engine tests (product v7 contract 8.3, stream C): landmark frames
 * of a walk seen by a phone, with the walk's truth. Deterministic for a spec (seeded). Clearly
 * synthetic; never shown as a person.
 *
 * How it walks. Each foot is a rigid triangle (heel, ankle, foot index) that rolls over the heel from
 * initial contact (IC) to foot flat, stays flat, then rolls over the toe to toe off (TO); in swing the
 * heel travels to the next contact fast through mid swing and brakes only in the last moments (so
 * d·(heel − mid hip) peaks a few milliseconds before IC, and the foot index is furthest behind the
 * hip a few milliseconds after TO); it lifts and lands with no vertical speed. Contacts sit a step apart on the walking line, IC at
 * phase 0 and TO at the stance share. The pelvis moves at the walking speed and bobs (lowest in double
 * support, never higher than both legs reach with a knee bent 3 degrees); the knees come from two bone
 * inverse kinematics. During the single stance of a side the other side's hip drops (pelvicDrop) and
 * the trunk leans toward the stance side (trunkLean). On the walking pad the same walk is seen with the
 * pelvis held still (the belt carries the feet back).
 *
 * The camera is a level pinhole (optionally rolled) whose short side spans 50 degrees, as
 * tests/fixtures/gen.ts and the engine's camera model: 1280x720 landscape for side views, 720x1280
 * portrait for front views, normalized as MediaPipe does. Visibility imitates the model: the far side
 * of a profile lower, the face low when walking away, anything outside the picture or behind the
 * camera very low, nothing while the walker is gone. Options: Gaussian landmark noise, frame time
 * jitter and dropped frames, leg label swaps, away passes labelled as if facing the phone, occlusions.
 */
import type { GaitFrame, GaitSetup, GaitView } from "../../../src/engine/gait/types";
import type { Landmark } from "../../../src/engine/types";
import { rng } from "../gen";

export type Side = "left" | "right";
/** A point in the room, metres: x right in the picture, y up, z toward the camera. */
export type V = [number, number, number];

export interface WalkSpec {
  seed?: number;
  view: GaitView;
  /** Pad views: the walk's length in seconds. */
  durationSec?: number;
  fps?: number;
  /** Uniform jitter of the frame times, ms. */
  jitterMs?: number;
  /** Every n-th frame is not delivered. */
  dropEvery?: number;
  heightM?: number;
  /** Walking speed (overground) or belt speed (pad), m/s. */
  speed?: number;
  /** Steps per minute. */
  cadence?: number;
  /** Stance share of the cycle. */
  stance?: number;
  stepWidthM?: number;
  /** Pad side views: the side nearest the phone. */
  nearSide?: Side;
  /** Overground side: passes, alternating directions. Overground front: toward passes, each followed by an away pass. */
  passes?: number;
  /** Overground: each pass starts up to this many metres earlier or later along its line (seeded), so its steps land at other places in the picture. */
  passShiftM?: number;
  /**
   * Overground at home (D-035 item 2): the walker stops and turns inside the picture and never leaves
   * it. Side: passes across a path `pathM` long (default 3), centred on the phone's axis, a turn in
   * place facing the phone at each end. Front: a phone standing against a wall; passes toward it from
   * `farM` (default 5) to `nearM` (default 1.2) in front of it, a turn in place there, and away again,
   * with a turn at the far end. `turnSec` is each turn's time (default 1.6).
   */
  home?: { pathM?: number; nearM?: number; farM?: number; turnSec?: number };
  /**
   * Overground side, out of the picture to turn: the path's length (default 9.6 m) and each turn's
   * time out of the picture (default 1.5 s); each pass then starts at a seeded phase of the gait cycle.
   */
  sidePath?: { pathM?: number; turnSec?: number };
  rollDeg?: number;
  /** Landmark noise, sd in units of the picture height. */
  noise?: number;
  /**
   * The phone: its distance, lens height and sideways offset (m); `portrait` holds a side view's
   * phone upright (720x1280: the picture about 2.8 m wide at 3 m, so a pass across it is about 5 steps).
   */
  camera?: { distance?: number; height?: number; lateral?: number; portrait?: boolean };
  /** Leg labels exchanged in these ranges of walk time (seconds). */
  swaps?: { from: number; to: number }[];
  /** Away passes labelled as if facing the phone (every left and right label exchanged). */
  awayLabelsAsToward?: boolean;
  occlude?: { from: number; to: number; landmarks: number[]; visibility?: number }[];
  /** Degrees the other side's hip drops during the single stance of this side (default 4). */
  pelvicDrop?: Partial<Record<Side, number>>;
  /** Peak lateral trunk lean toward the stance side, degrees (default 2), for both sides or per side. */
  trunkLean?: number | Partial<Record<Side, number>>;
  /** Forward trunk inclination, degrees (default 3). */
  trunkForward?: number;
  /** Peak heel lift in swing as a share of the height (default 0.04: a swing knee peak near 65 degrees). */
  swingLift?: number;
  /** Seconds of the standing calibration (default 3). */
  standingSec?: number;
  /** First walk frame time, ms (default 10000). */
  startMs?: number;
  // The pattern modifiers (gait-rules 5.1 to 5.11, step C2). Each is per side and off by default.
  /** Stance share of the side's cycle (default `stance`): the other leg swings for 1 minus it. */
  stanceBy?: Partial<Record<Side, number>>;
  /** Peak heel lift in the side's swing, share of the height (default `swingLift`). */
  liftBy?: Partial<Record<Side, number>>;
  /** Extra lift late in the side's swing, share of the height: the foot carried high and set down from above (a high step). */
  highStep?: Partial<Record<Side, number>>;
  /** Foot pitch at the side's initial contact, degrees (default 18, heel first; 0 or less lands flat or toe first). */
  contactPitch?: Partial<Record<Side, number>>;
  /** The foot's turn over the toe at the side's toe off, degrees (default 35): less lifts the ankle less in early swing. */
  toeOffPitch?: Partial<Record<Side, number>>;
  /** Knee angle held through the side's single stance, degrees: bent (positive) or past straight (negative). */
  stanceKnee?: Partial<Record<Side, number>>;
  /** Knee angle held from the side's initial contact to the other side's toe off, degrees. */
  loadingKnee?: Partial<Record<Side, number>>;
  /** Largest knee bend in the side's swing, degrees: the pelvis rises over the other foot to keep it (vaulting). */
  swingKnee?: Partial<Record<Side, number>>;
  /** Metres the pelvis lags at the side's toe off (and leads at the other side's): the leg reaches less far behind. */
  pelvisLag?: Partial<Record<Side, number>>;
  /** Metres each of the side's contacts lands further ahead: its step longer, the other side's shorter. */
  contactShift?: Partial<Record<Side, number>>;
  /** Peak arm swing each way, degrees (default 20). */
  armSwing?: number;
}

export interface WalkTruth {
  /** Events while the heel is in the picture, ms. */
  ics: { side: Side; t: number }[];
  tos: { side: Side; t: number }[];
  strideSec: number;
  stepSec: number;
  cadence: number;
  /** Contact spacing along the line, m. */
  stepLengthM: number;
  /** The heel landmarks' separation along the line at IC (the engine's step length), m. */
  heelSepAtIcM: number;
  speed: number;
  heightM: number;
  aspect: number;
  /** The model's sagittal angles, degrees (the same each cycle), of the left leg. */
  kneeSwingPeak: number;
  kneeStanceMin: number;
  kneeLoadingPeak: number;
  thighSwingPeak: number;
  /** Each leg's: the sagittal angles above, the trailing limb angle's peak over its standing value, the foot pitch at contact, and its single support (the other leg's swing), s. */
  sides: Record<
    Side,
    {
      kneeSwingPeak: number;
      kneeStanceMin: number;
      kneeLoadingPeak: number;
      thighSwingPeak: number;
      tlaPeak: number;
      pitchAtIc: number;
      singleSupportSec: number;
    }
  >;
  /** Peak drop of the other side's hip in each side's single stance, degrees. */
  pelvicDrop: Record<Side, number>;
  /** Walking passes, ms, with the direction in the picture or the facing. */
  passes: { from: number; to: number; kind: "right" | "left" | "toward" | "away" | "pad" }[];
}

export interface Walk {
  frames: GaitFrame[];
  standing: GaitFrame[];
  truth: WalkTruth;
}

const D2R = Math.PI / 180;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => {
  const n = len(a);
  return n > 1e-12 ? mul(a, 1 / n) : [0, 0, 0];
};
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const smoothstep = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
export function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
const UP: V = [0, 1, 0];

/** Body proportions of a 1.70 m adult, scaled by height. */
function bodyOf(heightM: number) {
  const s = heightM / 1.7;
  return {
    s,
    thigh: 0.4165 * s,
    shank: 0.418 * s,
    hipHalf: 0.085 * s,
    shoulderHalf: 0.175 * s,
    trunk: 0.49 * s,
    upperArm: 0.3 * s,
    forearm: 0.25 * s,
    /** The foot in its own frame (forward, up) from the heel's floor contact. */
    heel: [0, 0.03 * s] as [number, number],
    ankle: [0.06 * s, 0.075 * s] as [number, number],
    toe: [0.22 * s, 0.02 * s] as [number, number],
    noseUp: 0.16 * s,
    noseFwd: 0.094 * s,
  };
}
type Body = ReturnType<typeof bodyOf>;

interface Gait {
  speed: number;
  strideSec: number;
  stride: number;
  stance: number;
  stepWidth: number;
  liftM: number;
  /** Each leg's stance share, heel lift (m), pitch at contact and at toe off (rad) and contact shift (m). */
  leg: Record<
    Side,
    { stance: number; liftM: number; highM: number; pIc: number; pTo: number; shift: number }
  >;
}

interface FootPose {
  heel: [number, number];
  ankle: [number, number];
  toe: [number, number];
}

/**
 * Share of the swing's forward travel done at a share of the swing: the heel's speed follows
 * sqrt(sin(π τ)), fast through mid swing and braking only in the last moments, as a real foot does
 * before contact; it falls below the pelvis's speed about 2% of the swing before IC.
 */
const TRAVEL: Float64Array = (() => {
  const n = 2000;
  const out = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const mid = (i - 0.5) / n;
    out[i] = out[i - 1] + Math.sqrt(Math.sin(Math.PI * mid)) / n;
  }
  for (let i = 0; i <= n; i++) out[i] /= out[n];
  return out;
})();
function swingTravel(tau: number): number {
  const f = Math.min(1, Math.max(0, tau)) * (TRAVEL.length - 1);
  const i = Math.min(TRAVEL.length - 2, Math.floor(f));
  return TRAVEL[i] + (f - i) * (TRAVEL[i + 1] - TRAVEL[i]);
}

const P_IC = 18 * D2R;
const P_TO = 35 * D2R;
const FLAT_AT = 0.1;

/** The foot's points (forward along the line, up) at a phase of its cycle whose IC is at `contact`. */
function footAt(b: Body, g: Gait, side: Side, phase: number, contact: number): FootPose {
  const { stance, liftM, highM, pIc, pTo } = g.leg[side];
  const riseAt = stance - 0.25;
  const turn = (pt: [number, number], pivot: [number, number], local: [number, number], p: number) => {
    const dx = pt[0] - local[0];
    const dy = pt[1] - local[1];
    return [
      pivot[0] + dx * Math.cos(p) - dy * Math.sin(p),
      pivot[1] + dx * Math.sin(p) + dy * Math.cos(p),
    ] as [number, number];
  };
  const place = (pivot: [number, number], local: [number, number], p: number): FootPose => ({
    heel: turn(b.heel, pivot, local, p),
    ankle: turn(b.ankle, pivot, local, p),
    toe: turn(b.toe, pivot, local, p),
  });
  const toeContact: [number, number] = [b.toe[0], 0];
  // Heel first the foot turns about the heel's floor point down to flat; flat or toe first (pIc 0 or
  // less) about the toe's.
  const landing = (at: number, p: number): FootPose =>
    pIc >= 0 ? place([at, 0], [0, 0], p) : place([at + toeContact[0], 0], toeContact, p);
  if (phase < stance) {
    if (phase < FLAT_AT) return landing(contact, pIc * (1 - smoothstep(phase / FLAT_AT)));
    if (phase < riseAt) return place([contact, 0], [0, 0], 0);
    const p = -pTo * smoothstep((phase - riseAt) / (stance - riseAt));
    return place([contact + toeContact[0], 0], toeContact, p);
  }
  // Swing: the heel from its TO position to the next IC position; the pitch from minus the toe off pitch to the
  // contact's, arriving with no turning speed, so the heel's speed at IC is the pelvis's.
  const tau = (phase - stance) / (1 - stance);
  const start = place([contact + toeContact[0], 0], toeContact, -pTo);
  const end = landing(contact + g.stride, pIc);
  const p = -pTo + (pIc + pTo) * (1 - (1 - tau) ** 2);
  const x = start.heel[0] + (end.heel[0] - start.heel[0]) * swingTravel(tau);
  const bump = Math.sin(Math.PI * tau ** 0.576) ** 2;
  let y = start.heel[1] + (end.heel[1] - start.heel[1]) * smoothstep(tau) + liftM * bump;
  // A high step peaks late in the swing (near 70% of it), the foot then set down from above.
  if (highM) y += highM * Math.sin(Math.PI * tau ** 1.9) ** 2;
  return place([x, y], b.heel, p);
}

function twoBone(h: V, a: V, l1: number, l2: number, pole: V): { knee: V; ankle: V } {
  let d = sub(a, h);
  let dist = len(d);
  const maxR = l1 + l2 - 1e-6;
  let ankle = a;
  if (dist > maxR) {
    d = mul(unit(d), maxR);
    dist = maxR;
    ankle = add(h, d);
  }
  const u = unit(d);
  const w = unit(sub(pole, mul(u, dot(pole, u))));
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const alpha = Math.acos(cosA);
  return { knee: add(h, add(mul(u, l1 * Math.cos(alpha)), mul(w, l1 * Math.sin(alpha)))), ankle };
}

/** 0 outside the single stance of a side, rising to 1 in its middle (phase of that side's cycle). */
function singleStance(phase: number, stance: number): number {
  const s0 = stance - 0.5;
  return phase >= s0 && phase < 0.5 ? Math.sin((Math.PI * (phase - s0)) / (0.5 - s0)) : 0;
}

interface PoseState {
  /** Walking: seconds into the pass; standing: null. */
  tau: number | null;
  heading: V;
  /** The walking line's origin (walking) or the standing position (standing). */
  origin: V;
}

interface RoomPose {
  lm: V[];
  knee: Record<Side, number>;
  thigh: Record<Side, number>;
}

const LEG_IDS = {
  left: { hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  right: { hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
} as const;

/** A smooth weight on a cyclic phase: 1 on [a, b] (a may be below 0), falling to 0 over `ramp` outside. */
function plateau(phase: number, a: number, b: number, ramp: number): number {
  const wrap = (x: number) => ((x % 1) + 1) % 1;
  const x = wrap(phase - a);
  if (x <= b - a) return 1;
  return 1 - smoothstep(Math.min(x - (b - a), 1 - x) / ramp);
}

/** The knee flexion (degrees, 0 straight) that puts a leg's ankle at distance `dist` from its hip. */
function kneeForDist(b: Body, dist: number): number {
  const c = (dist * dist - b.thigh ** 2 - b.shank ** 2) / (2 * b.thigh * b.shank);
  return Math.acos(Math.min(1, Math.max(-1, c))) / D2R;
}

/** The hip to ankle distance of a leg whose knee is bent `k` degrees (either way). */
function distForKnee(b: Body, k: number): number {
  return Math.sqrt(b.thigh ** 2 + b.shank ** 2 + 2 * b.thigh * b.shank * Math.cos(k * D2R));
}

/** The walker's 33 landmarks in the room (x right, y up, z toward the camera). */
function roomPose(spec: WalkSpec, b: Body, g: Gait, st: PoseState): RoomPose {
  const f = unit(st.heading);
  const l = unit(cross(UP, f));
  const walking = st.tau !== null;
  const tau = st.tau ?? 0;
  const phaseOf = (side: Side) => {
    const off = side === "left" ? 0 : 0.5;
    return walking ? (((tau / g.strideSec - off) % 1) + 1) % 1 : 0.2;
  };
  const contactOf = (side: Side) => {
    if (!walking) return 0;
    const off = side === "left" ? 0 : 0.5;
    const at = (Math.floor(tau / g.strideSec - off) + off) * g.stride;
    return g.leg[side].shift ? at + g.leg[side].shift : at;
  };
  const feet = {
    left: footAt(b, g, "left", phaseOf("left"), contactOf("left")),
    right: footAt(b, g, "right", phaseOf("right"), contactOf("right")),
  };
  // The pelvis: midway between the contacts at the left IC (half a step behind the leading heel),
  // moving at the walking speed; a lag of a side holds it back at that side's toe off and ahead at
  // the other side's (a sine over the cycle).
  let forward = walking ? g.speed * tau - 0.25 * g.stride + b.ankle[0] : b.ankle[0];
  if (walking && spec.pelvisLag)
    for (const side of ["left", "right"] as const) {
      const lag = spec.pelvisLag[side] ?? 0;
      if (lag) forward += lag * Math.sin(2 * Math.PI * (phaseOf(side) - g.leg[side].stance - 0.25));
    }
  const standingHip = b.ankle[1] + b.shank + b.thigh;
  // A side's single stance is the other leg's swing.
  const single = {
    left: singleStance(phaseOf("left"), g.leg.right.stance),
    right: singleStance(phaseOf("right"), g.leg.left.stance),
  };
  const drop = {
    left: walking ? (spec.pelvicDrop?.left ?? 4) * single.left * D2R : 0,
    right: walking ? (spec.pelvicDrop?.right ?? 4) * single.right * D2R : 0,
  };
  // During the single stance of a side the other side's hip is lower: the hip line turns by `drop`.
  const hipUp = {
    left: b.hipHalf * (Math.sin(drop.left) - Math.sin(drop.right)),
    right: b.hipHalf * (Math.sin(drop.right) - Math.sin(drop.left)),
  };
  let pelvisY = walking
    ? standingHip - 0.025 * b.s - 0.02 * b.s * Math.cos(4 * Math.PI * phaseOf("left"))
    : standingHip;
  const reach = Math.sqrt(b.thigh ** 2 + b.shank ** 2 + 2 * b.thigh * b.shank * Math.cos(3 * D2R));
  for (const side of ["left", "right"] as const) {
    const lat = (side === "left" ? 1 : -1) * (b.hipHalf - g.stepWidth / 2);
    const h = Math.hypot(feet[side].ankle[0] - forward, lat);
    if (h < reach)
      pelvisY = Math.min(pelvisY, feet[side].ankle[1] + Math.sqrt(reach * reach - h * h) - hipUp[side]);
  }
  // Held knee angles: the pelvis height that bends the side's knee to the angle asked, blended in
  // from the walk's own over the window (the single stance for stanceKnee, from initial contact to
  // the other side's toe off for loadingKnee). Past straight the knee bends backwards.
  const backward = { left: false, right: false };
  if (walking && (spec.stanceKnee || spec.loadingKnee || spec.swingKnee))
    for (const side of ["left", "right"] as const) {
      const lat = (side === "left" ? 1 : -1) * (b.hipHalf - g.stepWidth / 2);
      const h = Math.hypot(feet[side].ankle[0] - forward, lat);
      const ph = phaseOf(side);
      const oppTo = g.leg[side === "left" ? "right" : "left"].stance - 0.5;
      const hold = (target: number, w: number, lowerOnly: boolean) => {
        if (w <= 0) return;
        const dy = pelvisY + hipUp[side] - feet[side].ankle[1];
        const own = kneeForDist(b, Math.hypot(h, dy));
        const k = (1 - w) * own + w * target;
        const d = distForKnee(b, Math.abs(k));
        if (d <= h) return;
        const y = feet[side].ankle[1] + Math.sqrt(d * d - h * h) - hipUp[side];
        pelvisY = lowerOnly ? Math.min(pelvisY, y) : y;
        if (k < 0) backward[side] = true;
      };
      const stanceK = spec.stanceKnee?.[side];
      if (stanceK !== undefined) {
        // Bent: held over the whole single stance (its minimum is read there); past straight: a bump
        // inside it (its peak is read there), passing straight on the way.
        const w =
          stanceK >= 0
            ? plateau(ph, oppTo - 0.02, 0.52, 0.06)
            : Math.sin(Math.PI * Math.min(1, Math.max(0, (ph - oppTo) / (0.5 - oppTo)))) ** 2;
        hold(stanceK, w, stanceK >= 0);
      }
      const loadK = spec.loadingKnee?.[side];
      // From late swing (the leg reaching straight for the floor) to the other side's toe off.
      if (loadK !== undefined) hold(loadK, plateau(ph, -0.06, Math.max(0, oppTo), 0.05), false);
      const swingK = spec.swingKnee?.[side];
      if (swingK !== undefined) {
        // Only ever up: a bend under the cap keeps the walk's own height.
        const own = g.leg[side].stance;
        const w = plateau(ph, own + 0.04, 0.98, 0.04);
        const dy = pelvisY + hipUp[side] - feet[side].ankle[1];
        if (w > 0 && kneeForDist(b, Math.hypot(h, dy)) > swingK) {
          const d = distForKnee(b, swingK);
          if (d > h) {
            const y = feet[side].ankle[1] + Math.sqrt(d * d - h * h) - hipUp[side];
            pelvisY = Math.max(pelvisY, (1 - w) * pelvisY + w * y);
          }
        }
      }
    }
  const at = (fw: number, upM: number, lat: number): V =>
    add(st.origin, add(mul(f, fw), add(mul(UP, upM), mul(l, lat))));
  const pelvis = at(forward, pelvisY, 0);
  const hips = {
    left: add(pelvis, add(mul(l, b.hipHalf), mul(UP, hipUp.left))),
    right: add(pelvis, add(mul(l, -b.hipHalf), mul(UP, hipUp.right))),
  };
  const lm: V[] = Array.from({ length: 33 }, () => pelvis);
  const knee = { left: 0, right: 0 };
  const thigh = { left: 0, right: 0 };
  for (const side of ["left", "right"] as const) {
    const ids = LEG_IDS[side];
    const lat = (side === "left" ? 1 : -1) * (g.stepWidth / 2);
    const ft = feet[side];
    const target = at(ft.ankle[0], ft.ankle[1], lat);
    const leg = twoBone(hips[side], target, b.thigh, b.shank, backward[side] ? mul(f, -1) : f);
    const shift = sub(leg.ankle, target);
    lm[ids.hip] = hips[side];
    lm[ids.knee] = leg.knee;
    lm[ids.ankle] = leg.ankle;
    lm[ids.heel] = add(at(ft.heel[0], ft.heel[1], lat), shift);
    lm[ids.toe] = add(at(ft.toe[0], ft.toe[1], lat), shift);
    const tv = sub(leg.knee, hips[side]);
    const sv = sub(leg.ankle, leg.knee);
    const th = Math.atan2(dot(tv, f), -dot(tv, UP)) / D2R;
    const sh = Math.atan2(dot(sv, f), -dot(sv, UP)) / D2R;
    thigh[side] = th;
    knee[side] = th - sh;
  }
  // Trunk, shoulders, arms and head.
  const fwd = (spec.trunkForward ?? 3) * D2R;
  const leanBy = typeof spec.trunkLean === "number" || spec.trunkLean === undefined ? null : spec.trunkLean;
  const lean = !walking
    ? 0
    : leanBy
      ? ((leanBy.left ?? 2) * single.left - (leanBy.right ?? 2) * single.right) * D2R
      : ((spec.trunkLean as number | undefined) ?? 2) * (single.left - single.right) * D2R;
  const trunkDir = unit(
    add(add(mul(UP, Math.cos(fwd) * Math.cos(lean)), mul(f, Math.sin(fwd))), mul(l, Math.sin(lean))),
  );
  const midShoulder = add(pelvis, mul(trunkDir, b.trunk));
  const across = unit(cross(trunkDir, f)); // toward the person's left
  const shoulders = {
    left: add(midShoulder, mul(across, b.shoulderHalf)),
    right: add(midShoulder, mul(across, -b.shoulderHalf)),
  };
  lm[11] = shoulders.left;
  lm[12] = shoulders.right;
  for (const side of ["left", "right"] as const) {
    const swing = walking ? -(spec.armSwing ?? 20) * Math.cos(2 * Math.PI * phaseOf(side)) * D2R : 0;
    const armDir = unit(add(mul(UP, -Math.cos(swing)), mul(f, Math.sin(swing))));
    const elbow = add(shoulders[side], mul(armDir, b.upperArm));
    const fore = unit(add(mul(UP, -Math.cos(swing + 15 * D2R)), mul(f, Math.sin(swing + 15 * D2R))));
    const wrist = add(elbow, mul(fore, b.forearm));
    lm[side === "left" ? 13 : 14] = elbow;
    lm[side === "left" ? 15 : 16] = wrist;
    for (const id of side === "left" ? [17, 19, 21] : [18, 20, 22])
      lm[id] = add(wrist, mul(fore, 0.06 * b.s));
  }
  const nose = add(midShoulder, add(mul(UP, b.noseUp), mul(f, b.noseFwd)));
  const face = (upM: number, fw: number, lat: number) =>
    add(nose, add(mul(UP, upM * b.s), add(mul(f, fw * b.s), mul(l, lat * b.s))));
  lm[0] = nose;
  lm[1] = face(0.03, -0.02, 0.02);
  lm[2] = face(0.03, -0.02, 0.03);
  lm[3] = face(0.03, -0.02, 0.04);
  lm[4] = face(0.03, -0.02, -0.02);
  lm[5] = face(0.03, -0.02, -0.03);
  lm[6] = face(0.03, -0.02, -0.04);
  lm[7] = face(0.02, -0.09, 0.075);
  lm[8] = face(0.02, -0.09, -0.075);
  lm[9] = face(-0.03, 0, 0.02);
  lm[10] = face(-0.03, 0, -0.02);
  return { lm, knee, thigh };
}

/** Left and right landmark pairs (MediaPipe ids). */
export const LR_ALL: [number, number][] = [
  [1, 4],
  [2, 5],
  [3, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];
export const LR_LEGS = LR_ALL.slice(11);
const SIDE_OF: number[] = Array.from({ length: 33 }, (_, i) => {
  for (const [a, b] of LR_ALL) {
    if (i === a) return 1;
    if (i === b) return -1;
  }
  return 0;
});

interface Segment {
  from: number;
  to: number;
  /** Walking passes hold a heading and a line origin; turns and absences hold neither. */
  /** phase: seconds into the gait cycle at the pass's start (home walks start on either foot). */
  pass?: { heading: V; origin: V; kind: WalkTruth["passes"][number]["kind"]; phase?: number };
  turn?: { at: V; fromHeading: V; toHeading: V; via?: V };
}

/** The phone: a level pinhole (optionally rolled) at `pos` looking along −z. */
export interface Camera {
  pos: V;
  w: number;
  h: number;
  f: number;
  roll: number;
}

export function cameraOf(spec: Pick<WalkSpec, "view" | "camera" | "rollDeg">): Camera {
  const c = spec.camera ?? {};
  const side = (spec.view === "side" || spec.view === "pad_side") && !c.portrait;
  const w = side ? 1280 : 720;
  const h = side ? 720 : 1280;
  const f = Math.min(w, h) / 2 / Math.tan(25 * D2R);
  const pos: V =
    spec.view === "side"
      ? [0, c.height ?? 1.0, c.distance ?? 3.5]
      : spec.view === "pad_side"
        ? [0, c.height ?? 1.0, c.distance ?? 3.0]
        : spec.view === "pad_front"
          ? [0, c.height ?? 1.0, c.distance ?? 2.0]
          : [c.lateral ?? 0.65, c.height ?? 0.9, 0];
  return { pos, w, h, f, roll: (spec.rollDeg ?? 0) * D2R };
}

export function project(cam: Camera, P: V): { x: number; y: number; z: number; behind: boolean } {
  const X = P[0] - cam.pos[0];
  const Y = P[1] - cam.pos[1];
  const D = cam.pos[2] - P[2];
  if (D < 0.05) return { x: 0.5, y: 0.5, z: 0, behind: true };
  let u = (cam.f * X) / D;
  let v = (-cam.f * Y) / D;
  if (cam.roll) {
    const c = Math.cos(cam.roll);
    const s = Math.sin(cam.roll);
    [u, v] = [u * c - v * s, u * s + v * c];
  }
  return { x: (u + cam.w / 2) / cam.w, y: (v + cam.h / 2) / cam.h, z: 0, behind: false };
}

/** The walk's segments (seconds of walk time) for its view. */
function segmentsOf(spec: WalkSpec, g: Gait): Segment[] {
  const out: Segment[] = [];
  if (spec.view === "pad_side" || spec.view === "pad_front") {
    const heading: V =
      spec.view === "pad_front" ? [0, 0, 1] : spec.nearSide === "left" ? [-1, 0, 0] : [1, 0, 0];
    // The pelvis stays on the camera's axis (the phone faces the middle of the belt).
    const origin = mul(heading, 0.25 * g.stride);
    out.push({ from: 0, to: spec.durationSec ?? 30, pass: { heading, origin, kind: "pad" } });
    return out;
  }
  const turnSec = spec.view === "side" ? (spec.sidePath?.turnSec ?? 1.5) : 1.5;
  let t = 0;
  // Its own random numbers, so a walk without shifts draws exactly as before; stratified, so the
  // passes' starts spread over the whole range.
  const shiftR = spec.passShiftM ? rng((spec.seed ?? 1) * 7919 + 13) : null;
  const n = spec.passes ?? 4;
  const order = Array.from({ length: 2 * n }, (_, i) => i);
  if (shiftR)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(shiftR() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  let drawn = 0;
  const shift = (heading: V): V => {
    if (!shiftR) return [0, 0, 0];
    const k = order[drawn++ % order.length];
    return mul(heading, (2 * ((k + shiftR()) / order.length) - 1) * spec.passShiftM!);
  };
  if (spec.home) return homeSegmentsOf(spec, g, spec.home);
  if (spec.view === "side") {
    const half = (spec.sidePath?.pathM ?? 9.6) / 2;
    // sidePath also starts each pass at a seeded phase of the gait cycle (a person's first step into
    // the picture lands on either foot), at the same place.
    const phaseR = spec.sidePath ? rng((spec.seed ?? 1) * 104729 + 11) : null;
    for (let i = 0; i < (spec.passes ?? 4); i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const dur = (2 * half) / g.speed;
      const phase = phaseR ? phaseR() * g.strideSec : 0;
      const heading: V = [dir, 0, 0];
      out.push({
        from: t,
        to: t + dur,
        pass: {
          heading,
          origin: add(add([-dir * half - dir * 0.6, 0, 0], shift(heading)), mul(heading, -g.speed * phase)),
          kind: dir > 0 ? "right" : "left",
          ...(phaseR ? { phase } : {}),
        },
      });
      t += dur;
      out.push({ from: t, to: t + turnSec });
      t += turnSec;
    }
    return out;
  }
  // Overground front: toward the phone from 6.6 m to 1.5 m behind it, a turn there (out of view),
  // away again, a turn at the far end (in view).
  const far = -6.6;
  const near = 1.5;
  for (let i = 0; i < (spec.passes ?? 4); i++) {
    const dur = (near - far) / g.speed;
    out.push({
      from: t,
      to: t + dur,
      pass: { heading: [0, 0, 1], origin: add([0, 0, far], shift([0, 0, 1])), kind: "toward" },
    });
    t += dur;
    out.push({ from: t, to: t + turnSec });
    t += turnSec;
    out.push({
      from: t,
      to: t + dur,
      pass: { heading: [0, 0, -1], origin: add([0, 0, near], shift([0, 0, -1])), kind: "away" },
    });
    t += dur;
    out.push({
      from: t,
      to: t + turnSec,
      turn: { at: [0, 0, far], fromHeading: [0, 0, -1], toHeading: [0, 0, 1] },
    });
    t += turnSec;
  }
  return out;
}

/**
 * The home walks (WalkSpec.home): every turn is in the picture, a stop and a turn in place. A pass
 * starts walking at once and ends walking at its turn point (the generator has no speeding up).
 */
function homeSegmentsOf(spec: WalkSpec, g: Gait, home: NonNullable<WalkSpec["home"]>): Segment[] {
  const out: Segment[] = [];
  const turnSec = home.turnSec ?? 1.6;
  const n = spec.passes ?? 4;
  // roomPose puts the pelvis at origin + heading · (speed · tau + lead) while walking and at
  // at + heading · ankle while standing: each pass starts where the last turn stood.
  const ankle = bodyOf(spec.heightM ?? 1.7).ankle[0];
  const lead = -0.25 * g.stride + ankle;
  // passShiftM also starts each pass at a seeded phase of the gait cycle, on either foot.
  const phaseR = spec.passShiftM ? rng((spec.seed ?? 1) * 104729 + 7) : null;
  const pass = (from: V, to: V, kind: WalkTruth["passes"][number]["kind"]) => {
    const heading = unit(sub(to, from));
    const dur = len(sub(to, from)) / g.speed;
    const phase = phaseR ? phaseR() * g.strideSec : 0;
    const origin = sub(from, mul(heading, lead + g.speed * phase));
    out.push({ from: t, to: t + dur, pass: { heading, origin, kind, phase } });
    t += dur;
    return heading;
  };
  const turnAt = (pelvis: V, fromHeading: V, via: V) => {
    out.push({
      from: t,
      to: t + turnSec,
      turn: { at: sub(pelvis, mul(fromHeading, ankle)), fromHeading, toHeading: mul(fromHeading, -1), via },
    });
    t += turnSec;
  };
  let t = 0;
  // passShiftM: each turn point moves up to this far along the path (seeded), so the feet land at other
  // places in each pass, as a person's do.
  const shiftR = spec.passShiftM ? rng((spec.seed ?? 1) * 7919 + 17) : null;
  const shift = () => (shiftR ? (2 * shiftR() - 1) * spec.passShiftM! : 0);
  if (spec.view === "side") {
    const half = (home.pathM ?? 3) / 2;
    let start: V = [-half, 0, 0];
    for (let i = 0; i < n; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const end: V = [dir * half + shift(), 0, 0];
      const heading = pass(start, end, dir > 0 ? "right" : "left");
      // A turn in place through facing the phone (+z).
      turnAt(end, heading, [0, 0, 1]);
      start = end;
    }
    return out;
  }
  const near: V = [0, 0, -(home.nearM ?? 1.2)];
  let far: V = [0, 0, -(home.farM ?? 5)];
  for (let i = 0; i < n; i++) {
    turnAt(near, pass(far, near, "toward"), [1, 0, 0]);
    const next: V = [0, 0, -(home.farM ?? 5) + shift()];
    turnAt(next, pass(near, next, "away"), [1, 0, 0]);
    far = next;
  }
  return out;
}

/** Visibility of each landmark as the model would report it. */
export function visibilityOf(
  lm: V[],
  heading: V,
  cam: Camera,
  proj: ReturnType<typeof project>[],
  r: () => number,
): number[] {
  const f = unit(heading);
  const l = unit(cross(UP, f));
  const pelvis = mul(add(lm[23], lm[24]), 0.5);
  const toCam = unit(sub(cam.pos, pelvis));
  const facing = dot(f, toCam);
  const leftNear = dot(l, toCam);
  return lm.map((_, k) => {
    const q = proj[k];
    if (q.behind) return 0;
    let v = 0.985 - 0.03 * r();
    const sd = SIDE_OF[k];
    if (sd !== 0 && Math.abs(leftNear) > 0.3 && sd * leftNear < 0) v = k >= 23 ? 0.88 : k >= 11 ? 0.8 : 0.45;
    if (k <= 10) {
      if (facing < -0.3) v = k === 7 || k === 8 ? 0.35 : 0.12;
      else if (facing < 0.3 && sd !== 0 && sd * leftNear < 0) v = k === 7 || k === 8 ? 0.3 : 0.55;
    }
    if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) v = 0.05 + 0.1 * r();
    return v;
  });
}

/** Generates a walk from a spec. Same spec, same walk. */
export function walk(spec: WalkSpec): Walk {
  const r = rng(spec.seed ?? 1);
  const heightM = spec.heightM ?? 1.7;
  const b = bodyOf(heightM);
  const speed = spec.speed ?? 1.2;
  const cadence = spec.cadence ?? 108;
  const strideSec = 120 / cadence;
  const stance = spec.stance ?? 0.6;
  const liftM = (spec.swingLift ?? 0.04) * heightM;
  const legOf = (side: Side) => ({
    stance: spec.stanceBy?.[side] ?? stance,
    liftM: spec.liftBy?.[side] !== undefined ? spec.liftBy[side]! * heightM : liftM,
    highM: (spec.highStep?.[side] ?? 0) * heightM,
    pIc: spec.contactPitch?.[side] !== undefined ? spec.contactPitch[side]! * D2R : P_IC,
    pTo: spec.toeOffPitch?.[side] !== undefined ? spec.toeOffPitch[side]! * D2R : P_TO,
    shift: spec.contactShift?.[side] ?? 0,
  });
  const g: Gait = {
    speed,
    strideSec,
    stride: speed * strideSec,
    stance,
    stepWidth: spec.stepWidthM ?? 0.1,
    liftM,
    leg: { left: legOf("left"), right: legOf("right") },
  };
  const cam = cameraOf(spec);
  const aspect = cam.w / cam.h;
  const fps = spec.fps ?? 30;
  const noise = spec.noise ?? 0;
  const startMs = spec.startMs ?? 10000;
  const segments = segmentsOf(spec, g);
  const total = segments[segments.length - 1].to;
  const pad = spec.view === "pad_side" || spec.view === "pad_front";

  const toFrame = (room: V[], heading: V, tMs: number, labels: (lm: Landmark[]) => void): GaitFrame => {
    const proj = room.map((P) => project(cam, P));
    const vis = visibilityOf(room, heading, cam, proj, r);
    const lm: Landmark[] = proj.map((q, k) => ({
      x: q.x + (gauss(r) * noise) / aspect,
      y: q.y + gauss(r) * noise,
      z: 0,
      visibility: Math.min(1, Math.max(0, vis[k])),
    }));
    labels(lm);
    return { t: tMs, lm, aspect };
  };
  const exchange = (lm: Landmark[], pairs: [number, number][]) => {
    for (const [a, c] of pairs) [lm[a], lm[c]] = [lm[c], lm[a]];
  };

  const frames: GaitFrame[] = [];
  let lastMs = -Infinity;
  const n = Math.floor(total * fps);
  for (let i = 0; i < n; i++) {
    if (spec.dropEvery && i % spec.dropEvery === spec.dropEvery - 1) continue;
    const jitter = spec.jitterMs ? (2 * r() - 1) * spec.jitterMs : 0;
    const tau = i / fps + jitter / 1000;
    const tMs = startMs + tau * 1000;
    if (tMs <= lastMs) continue;
    lastMs = tMs;
    // A jittered first frame before the walk's start belongs to its first segment.
    const found = segments.findIndex((s) => tau >= s.from && tau < s.to);
    const segIndex = found >= 0 ? found : tau < 0 && spec.home ? 0 : segments.length - 1;
    const seg = segments[segIndex];
    if (seg.pass) {
      const st: PoseState = {
        tau: tau - seg.from + (seg.pass.phase ?? 0),
        heading: seg.pass.heading,
        origin: seg.pass.origin,
      };
      let room = roomPose(spec, b, g, st).lm;
      if (pad) {
        const back = mul(unit(seg.pass.heading), -g.speed * (tau - seg.from));
        room = room.map((P) => add(P, back));
      }
      const away = seg.pass.kind === "away";
      frames.push(
        toFrame(room, seg.pass.heading, tMs, (lm) => {
          if (spec.swaps?.some((w) => tau >= w.from && tau < w.to)) exchange(lm, LR_LEGS);
          if (away && spec.awayLabelsAsToward) exchange(lm, LR_ALL);
          for (const o of spec.occlude ?? [])
            if (tau >= o.from && tau < o.to)
              for (const id of o.landmarks) lm[id].visibility = o.visibility ?? 0.1;
        }),
      );
    } else if (seg.turn) {
      const share = (tau - seg.from) / (seg.to - seg.from);
      const a = Math.PI * share;
      const via = seg.turn.via ?? [1, 0, 0];
      const heading = unit(add(mul(seg.turn.fromHeading, Math.cos(a)), mul(via, Math.sin(a))));
      const prev = segments[segIndex - 1]?.pass;
      const next = segments[segIndex + 1]?.pass;
      let room: V[];
      if (spec.home && prev) {
        // A home turn in place (WalkSpec.home): the last walking pose turned toward `via`, then the
        // next pass's first pose turned from it, so the legs never jump while the walker is side on.
        const before = share < 0.5 || !next;
        const prevSeg = segments[segIndex - 1];
        const pose = before
          ? roomPose(spec, b, g, { ...prev, tau: prevSeg.to - prevSeg.from + (prev.phase ?? 0) }).lm
          : roomPose(spec, b, g, { ...next!, tau: next!.phase ?? 0 }).lm;
        const from = before ? prev.heading : next!.heading;
        // The angle about the vertical that turns `from` to `heading`.
        const angle = Math.atan2(cross(from, heading)[1], dot(from, heading));
        const pivot = mul(add(pose[23], pose[24]), 0.5);
        const c = Math.cos(angle);
        const sn = Math.sin(angle);
        room = pose.map((P) => {
          const d = sub(P, pivot);
          return add(pivot, [d[0] * c + d[2] * sn, d[1], -d[0] * sn + d[2] * c]);
        });
      } else room = roomPose(spec, b, g, { tau: null, heading, origin: seg.turn.at }).lm;
      frames.push(toFrame(room, heading, tMs, () => {}));
    } else {
      // The walker is gone (a turn out of the picture): the model finds nobody.
      const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
      frames.push({ t: tMs, lm, aspect });
    }
  }

  // Standing calibration before the walk, in the view's position.
  const standingSec = spec.standingSec ?? 3;
  const standing: GaitFrame[] = [];
  const stHeading: V =
    spec.view === "side"
      ? [1, 0, 0]
      : spec.view === "pad_side"
        ? spec.nearSide === "left"
          ? [-1, 0, 0]
          : [1, 0, 0]
        : [0, 0, 1];
  let stOrigin: V = spec.view === "front" || spec.view === "back" ? [0, 0, -3] : [0, 0, 0];
  let stFacing = stHeading;
  const first = segments[0]?.pass;
  if (spec.home && first) {
    // A home walk starts from where its person stood still for the calibration, facing the way off.
    const lead = -0.25 * g.stride + b.ankle[0];
    const start = add(first.origin, mul(first.heading, g.speed * (first.phase ?? 0) + lead));
    stOrigin = sub(start, mul(first.heading, b.ankle[0]));
    stFacing = first.heading;
  }
  for (let i = 0; i < Math.floor(standingSec * fps); i++) {
    const tMs = startMs - (standingSec + 2) * 1000 + (i * 1000) / fps;
    const room = roomPose(spec, b, g, { tau: null, heading: stFacing, origin: stOrigin }).lm;
    standing.push(toFrame(room, stFacing, tMs, () => {}));
  }

  // Truth: events while the heel is in the picture; the model's angles over one cycle.
  const ics: WalkTruth["ics"] = [];
  const tos: WalkTruth["tos"] = [];
  const passes: WalkTruth["passes"] = [];
  for (const seg of segments) {
    if (!seg.pass) continue;
    passes.push({ from: startMs + seg.from * 1000, to: startMs + seg.to * 1000, kind: seg.pass.kind });
    for (const side of ["left", "right"] as const) {
      const off = side === "left" ? 0 : 0.5;
      const phase = seg.pass.phase ?? 0;
      for (let k = -1; ; k++) {
        const tIc = (k + off) * strideSec;
        if (tIc - phase > seg.to - seg.from) break;
        for (const [type, at] of [
          ["ic", tIc],
          ["to", tIc + g.leg[side].stance * strideSec],
        ] as const) {
          const tt = at - phase;
          if (tt < 0 || tt >= seg.to - seg.from) continue;
          const st: PoseState = { tau: at, heading: seg.pass.heading, origin: seg.pass.origin };
          let room = roomPose(spec, b, g, st).lm;
          if (pad) room = room.map((P) => add(P, mul(unit(seg.pass!.heading), -g.speed * tt)));
          const q = project(cam, room[LEG_IDS[side].heel]);
          if (q.behind || q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) continue;
          const e = { side, t: startMs + (seg.from + tt) * 1000 };
          (type === "ic" ? ics : tos).push(e);
        }
      }
    }
  }
  ics.sort((a, c) => a.t - c.t);
  tos.sort((a, c) => a.t - c.t);

  // One cycle of the model (every cycle is the same) for each leg from its IC: the knee's swing peak
  // (TO to IC), stance minimum (the single stance) and loading peak (IC to the other's TO), the
  // thigh's swing peak, and the trailing limb angle's peak (the other's IC to TO) over standing.
  const samples = 400;
  const line: PoseState = { tau: 0, heading: [1, 0, 0], origin: [0, 0, 0] };
  const stand = roomPose(spec, b, g, { tau: null, heading: [1, 0, 0], origin: [0, 0, 0] }).lm;
  const tlaOf = (lm: V[], side: Side) => {
    const d = sub(lm[LEG_IDS[side].hip], lm[LEG_IDS[side].ankle]);
    return Math.atan2(d[0], d[1]) / D2R;
  };
  const sideTruth = (side: Side): WalkTruth["sides"][Side] => {
    const own = g.leg[side].stance;
    const oppTo = g.leg[side === "left" ? "right" : "left"].stance - 0.5;
    let kneeSwing = -Infinity;
    let kneeStance = Infinity;
    let kneeLoad = -Infinity;
    let thighSwing = -Infinity;
    let tla = -Infinity;
    for (let i = 0; i <= samples; i++) {
      const ph = i / samples;
      const pose = roomPose(spec, b, g, { ...line, tau: (2 + (side === "left" ? 0 : 0.5) + ph) * strideSec });
      const k = pose.knee[side];
      if (ph >= own) {
        kneeSwing = Math.max(kneeSwing, k);
        thighSwing = Math.max(thighSwing, pose.thigh[side]);
      }
      if (ph >= oppTo && ph <= 0.5) kneeStance = Math.min(kneeStance, k);
      if (ph <= oppTo) kneeLoad = Math.max(kneeLoad, k);
      if (ph >= 0.5 && ph <= own) tla = Math.max(tla, tlaOf(pose.lm, side));
    }
    return {
      kneeSwingPeak: kneeSwing,
      kneeStanceMin: kneeStance,
      kneeLoadingPeak: kneeLoad,
      thighSwingPeak: thighSwing,
      tlaPeak: tla - tlaOf(stand, side),
      pitchAtIc: g.leg[side].pIc / D2R,
      singleSupportSec: (1 - g.leg[side === "left" ? "right" : "left"].stance) * strideSec,
    };
  };
  const sides = { left: sideTruth("left"), right: sideTruth("right") };
  const icPose = roomPose(spec, b, g, { ...line, tau: 2 * strideSec });
  const heelSep = icPose.lm[29][0] - icPose.lm[30][0];

  return {
    frames,
    standing,
    truth: {
      ics,
      tos,
      strideSec,
      stepSec: strideSec / 2,
      cadence,
      stepLengthM: g.stride / 2,
      heelSepAtIcM: heelSep,
      speed,
      heightM,
      aspect,
      kneeSwingPeak: sides.left.kneeSwingPeak,
      kneeStanceMin: sides.left.kneeStanceMin,
      kneeLoadingPeak: sides.left.kneeLoadingPeak,
      thighSwingPeak: sides.left.thighSwingPeak,
      sides,
      pelvicDrop: { left: spec.pelvicDrop?.left ?? 4, right: spec.pelvicDrop?.right ?? 4 },
      passes,
    },
  };
}

/** The setup of a walk, as the capture would give it. */
export function setupOf(spec: WalkSpec, over: Partial<GaitSetup> = {}): GaitSetup {
  const pad = spec.view === "pad_side" || spec.view === "pad_front";
  return {
    mode: pad ? "walking_pad" : "overground",
    aid: "none",
    orthosis: {},
    prosthesis: null,
    shoes: true,
    heightCm: Math.round((spec.heightM ?? 1.7) * 100),
    padSpeedKmh: pad ? (spec.speed ?? 1.2) * 3.6 : null,
    padCorrection: null,
    handrail: pad ? "none" : null,
    familiarised: pad ? true : null,
    ...over,
  };
}

export interface StanceSpec {
  seed?: number;
  /** The leg the person stands on. */
  side: Side;
  /** Degrees the lifted side's hip drops below the stance side's. */
  dropDeg: number;
  holdSec?: number;
  fps?: number;
  noise?: number;
  /** The lifted foot rises this many metres (0: both feet stay down). */
  liftM?: number;
  heightM?: number;
  /** Hips hidden from this many seconds into the hold. */
  hideHipsFrom?: number;
}

/**
 * The static single leg stance check (gait-rules 2.4): the person faces the phone (front view, 3 m)
 * and stands on `side` with the other foot lifted; the lifted side's hip drops by `dropDeg`.
 * Gives the double stance calibration and the hold.
 */
export function singleLegStance(spec: StanceSpec): { standing: GaitFrame[]; frames: GaitFrame[] } {
  const r = rng(spec.seed ?? 7);
  const heightM = spec.heightM ?? 1.7;
  const b = bodyOf(heightM);
  const leg = { stance: 0.6, liftM: 0, highM: 0, pIc: P_IC, pTo: P_TO, shift: 0 };
  const g: Gait = {
    speed: 1,
    strideSec: 1.1,
    stride: 1.1,
    stance: 0.6,
    stepWidth: 0.1,
    liftM: 0,
    leg: { left: leg, right: leg },
  };
  const view: WalkSpec = { view: "front" };
  const cam = cameraOf(view);
  const aspect = cam.w / cam.h;
  const fps = spec.fps ?? 30;
  const noise = spec.noise ?? 0;
  const heading: V = [0, 0, 1];
  const base = roomPose(view, b, g, { tau: null, heading, origin: [0, 0, -3] }).lm;
  const lifted = spec.side === "left" ? "right" : "left";
  const ids = LEG_IDS[lifted];
  const frame = (room: V[], tMs: number, hideHips: boolean): GaitFrame => {
    const proj = room.map((P) => project(cam, P));
    const vis = visibilityOf(room, heading, cam, proj, r);
    const lm: Landmark[] = proj.map((q, k) => ({
      x: q.x + (gauss(r) * noise) / aspect,
      y: q.y + gauss(r) * noise,
      z: 0,
      visibility: hideHips && (k === 23 || k === 24) ? 0.1 : Math.min(1, Math.max(0, vis[k])),
    }));
    return { t: tMs, lm, aspect };
  };
  const standing: GaitFrame[] = [];
  for (let i = 0; i < 3 * fps; i++) standing.push(frame(base, 1000 + (i * 1000) / fps, false));
  const frames: GaitFrame[] = [];
  const hold = spec.holdSec ?? 6;
  const lift = spec.liftM ?? 0.15 * b.s;
  const drop = spec.dropDeg * D2R;
  for (let i = 0; i < Math.round(hold * fps); i++) {
    const room = base.map((P) => [...P] as V);
    // The lifted side's hip drops: the hip line turns about the stance hip.
    room[ids.hip][1] -= 2 * b.hipHalf * Math.sin(drop);
    for (const id of [ids.knee]) room[id][1] += lift / 2;
    for (const id of [ids.ankle, ids.heel, ids.toe]) room[id][1] += lift;
    const tau = i / fps;
    frames.push(frame(room, 6000 + tau * 1000, spec.hideHipsFrom !== undefined && tau >= spec.hideHipsFrom));
  }
  return { standing, frames };
}

/**
 * The far leg as the real pose model reports it in a side view (G1's kept landmarks,
 * tests/fixtures/gait/smoke/gait-pad-side-full.smoke: the far knee under 0.5 in about 46% of frames, the
 * far ankle in about 12%). The walker's far leg is seen in every frame (visibilityOf gives it 0.88);
 * here the far knee, and the far ankle with its heel and foot index, go under the floor in the frames
 * where they are closest to the near ones in the picture (phase locked to the legs crossing), in those
 * shares of the frames that show a far side. Used for the near limb regressions of the side views.
 */
export const REAL_FAR_LEG = { knee: 0.46, ankle: 0.12 } as const;

/** The far leg of a walker's frame: the leg visibilityOf gives its far side value (0.88), or null. */
export function farLegOf(lm: readonly Landmark[]): Side | null {
  const far = (v: number) => v < 0.9 && v > 0.5;
  const near = (v: number) => v >= 0.95;
  if (far(lm[25].visibility) && near(lm[26].visibility)) return "left";
  if (far(lm[26].visibility) && near(lm[25].visibility)) return "right";
  return null;
}

export function withRealFarLeg(
  frames: readonly GaitFrame[],
  share: { knee: number; ankle: number } = REAL_FAR_LEG,
): GaitFrame[] {
  const farOf = farLegOf;
  const gaps = (pair: (s: Side) => [number, number]) => {
    const out: number[] = [];
    for (const f of frames) {
      const far = farOf(f.lm);
      if (!far) continue;
      const [a, b] = pair(far);
      out.push(Math.abs(f.lm[a].x - f.lm[b].x));
    }
    return out.sort((x, y) => x - y);
  };
  const knee = (s: Side): [number, number] => (s === "left" ? [25, 26] : [26, 25]);
  const ankle = (s: Side): [number, number] => (s === "left" ? [27, 28] : [28, 27]);
  const cut = (sorted: number[], q: number) =>
    sorted.length ? sorted[Math.floor(q * (sorted.length - 1))] : -1;
  const kneeCut = cut(gaps(knee), share.knee);
  const ankleCut = cut(gaps(ankle), share.ankle);
  return frames.map((f) => {
    const lm = f.lm.map((q) => ({ ...q }));
    const far = farOf(lm);
    if (!far) return { ...f, lm };
    const [fk, nk] = knee(far);
    const [fa, na] = ankle(far);
    if (Math.abs(lm[fk].x - lm[nk].x) <= kneeCut) lm[fk] = { ...lm[fk], visibility: 0.3 };
    if (Math.abs(lm[fa].x - lm[na].x) <= ankleCut)
      for (const id of far === "left" ? [27, 29, 31] : [28, 30, 32]) lm[id] = { ...lm[id], visibility: 0.3 };
    return { ...f, lm };
  });
}
