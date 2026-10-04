/**
 * A procedural humanoid for the real model smoke videos (product v7 contract 8.4, stream G, step G1).
 *
 * Contract 8.4 asks for rendered videos "posed at known angles, for exact truth". This draws a
 * person from a joint angle skeleton with smooth signed distance shapes, ray marched in a WebGL 2
 * fragment shader: skin, a cream shirt, dark trousers, white shoes, hair and a face in profile, a
 * chair for seated movements and a walking pad deck. No mesh, texture or motion capture is used. The
 * round cone and ellipsoid distance functions and the polynomial smooth minimum are the closed forms
 * Inigo Quilez publishes in his articles (iquilezles.org, "distance functions" and "smooth minimum"),
 * written here from the formulas; no file was copied. MediaPipe Pose tracks the figure like a person
 * (checked with both models).
 *
 *   skeleton(pose)           the joints in metres (y up, the floor at 0), from the pose angles;
 *                            Node and browser, pure
 *   project(point, cam, w, h) a joint's place in the picture, normalised like MediaPipe landmarks
 *   createRenderer(canvas)   the shader; browser only (scripts/smoke/render.mjs drives it)
 *
 * Dev only: nothing here ships in the app.
 */

/** Joint indices of `skeleton().joints` (and of the shader's uJ array). */
export const J = Object.freeze({
  PELVIS: 0,
  HIP_L: 1,
  HIP_R: 2,
  KNEE_L: 3,
  KNEE_R: 4,
  ANK_L: 5,
  ANK_R: 6,
  HEEL_L: 7,
  HEEL_R: 8,
  TOE_L: 9,
  TOE_R: 10,
  NECK: 11,
  HEAD: 12,
  SH_L: 13,
  SH_R: 14,
  ELB_L: 15,
  ELB_R: 16,
  WR_L: 17,
  WR_R: 18,
  HAND_L: 19,
  HAND_R: 20,
});
export const JOINT_COUNT = 21;

/** Segment lengths and half widths in metres (an adult of about 1.75 m). */
export const BODY = Object.freeze({
  thigh: 0.44,
  shank: 0.43,
  upperArm: 0.29,
  foreArm: 0.26,
  hand: 0.17,
  hipHalf: 0.09,
  shoulderHalf: 0.185,
  trunk: 0.5,
  neckToHead: 0.17,
  /** Thigh radius at the hip: the seat top sits this far under the hip joints. */
  thighRadius: 0.088,
  /** Shoe sole radius under the heel and toe points. */
  sole: 0.038,
});

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
/** A direction `angle` degrees from `from` toward `toward` (both unit and orthogonal). */
const turn = (from, toward, angle) => add(mul(from, Math.cos(rad(angle))), mul(toward, Math.sin(rad(angle))));

const UP = [0, 1, 0];
const DOWN = [0, -1, 0];

/**
 * A person standing still, facing `fwd`: the pose object of `skeleton`.
 *   hip, knee, ankle: flexion, flexion and dorsiflexion per side (degrees)
 *   shoulderAbd, shoulderFlex, elbow: the arm (degrees); trunkLean forward, headPitch down (degrees)
 *   at: the pelvis ground position [x, z]; floorY: the height of what the feet stand on
 */
export function standingPose(fwd, at = [0, 0]) {
  return {
    fwd,
    at,
    floorY: 0,
    hip: { l: 0, r: 0 },
    knee: { l: 3, r: 3 },
    ankle: { l: 0, r: 0 },
    shoulderAbd: { l: 8, r: 8 },
    shoulderFlex: { l: 0, r: 0 },
    elbow: { l: 8, r: 8 },
    trunkLean: 0,
    headPitch: 0,
  };
}

/**
 * The joints of a pose, in metres. The pelvis height is set so that the lowest sole point rests on
 * `floorY`. Legs move in the sagittal plane (flexion and extension); the arm is abducted toward the
 * side, then flexed toward the front.
 */
export function skeleton(pose) {
  const F = norm([pose.fwd[0], 0, pose.fwd[2]]);
  const R = cross(F, UP);
  const joints = Array.from({ length: JOINT_COUNT }, () => [0, 0, 0]);

  const legs = (P) => {
    const out = {};
    for (const [s, sign] of [
      ["l", -1],
      ["r", 1],
    ]) {
      const hip = add(P, mul(R, sign * BODY.hipHalf));
      const thighDir = turn(DOWN, F, pose.hip[s]);
      const knee = add(hip, mul(thighDir, BODY.thigh));
      const shankAngle = pose.hip[s] - pose.knee[s];
      const ankle = add(knee, mul(turn(DOWN, F, shankAngle), BODY.shank));
      const pitch = shankAngle + pose.ankle[s];
      const footDir = turn(F, UP, pitch);
      const footUp = turn(UP, mul(F, -1), pitch);
      const heel = add(add(ankle, mul(footDir, -0.06)), mul(footUp, -0.055));
      const toe = add(add(ankle, mul(footDir, 0.17)), mul(footUp, -0.05));
      out[s] = { hip, knee, ankle, heel, toe, footUp };
    }
    return out;
  };

  const trial = legs([pose.at[0], 1, pose.at[1]]);
  let lowest = Infinity;
  for (const g of [trial.l, trial.r])
    for (const p of [g.heel, g.toe]) lowest = Math.min(lowest, p[1] - BODY.sole * g.footUp[1]);
  const P = [pose.at[0], 1 - lowest + (pose.floorY ?? 0), pose.at[1]];
  const lg = legs(P);
  /** The lowest sole point of each foot (the floor is the lowest of the two). */
  const soleY = {
    l: Math.min(...[lg.l.heel, lg.l.toe].map((p) => p[1] - BODY.sole * lg.l.footUp[1])),
    r: Math.min(...[lg.r.heel, lg.r.toe].map((p) => p[1] - BODY.sole * lg.r.footUp[1])),
  };
  joints[J.PELVIS] = P;
  joints[J.HIP_L] = lg.l.hip;
  joints[J.HIP_R] = lg.r.hip;
  joints[J.KNEE_L] = lg.l.knee;
  joints[J.KNEE_R] = lg.r.knee;
  joints[J.ANK_L] = lg.l.ankle;
  joints[J.ANK_R] = lg.r.ankle;
  joints[J.HEEL_L] = lg.l.heel;
  joints[J.HEEL_R] = lg.r.heel;
  joints[J.TOE_L] = lg.l.toe;
  joints[J.TOE_R] = lg.r.toe;

  const trunkDir = turn(UP, F, pose.trunkLean ?? 0);
  const neck = add(P, mul(trunkDir, BODY.trunk));
  joints[J.NECK] = neck;
  joints[J.HEAD] = add(neck, mul(turn(UP, F, (pose.trunkLean ?? 0) * 0.5), BODY.neckToHead));
  const shoulderLine = add(neck, mul(trunkDir, -0.045));
  const trunkDown = mul(trunkDir, -1);

  for (const [s, sign, i] of [
    ["l", -1, 0],
    ["r", 1, 1],
  ]) {
    const sh = add(shoulderLine, mul(R, sign * BODY.shoulderHalf));
    const side = mul(R, sign);
    // Abduction in the frontal plane of the trunk, then flexion toward the front.
    const abd = turn(trunkDown, side, pose.shoulderAbd?.[s] ?? 0);
    const upper = norm(turn(abd, F, pose.shoulderFlex?.[s] ?? 0));
    // The elbow bends toward the front of the upper arm (up when the arm points forward).
    let bend = sub(F, mul(upper, dot(F, upper)));
    bend = Math.hypot(...bend) < 1e-6 ? UP : norm(bend);
    const fore = turn(upper, bend, pose.elbow?.[s] ?? 0);
    const el = add(sh, mul(upper, BODY.upperArm));
    const wr = add(el, mul(fore, BODY.foreArm));
    joints[J.SH_L + i] = sh;
    joints[J.ELB_L + i] = el;
    joints[J.WR_L + i] = wr;
    joints[J.HAND_L + i] = add(wr, mul(fore, BODY.hand));
  }

  const headF = norm(turn(F, DOWN, pose.headPitch ?? 0));
  const headU = norm(cross(cross(headF, UP), headF));
  // Seated when the thighs are near level: the seat top under the thighs.
  const seated = Math.min(pose.hip.l, pose.hip.r) >= 70;
  const seatY = seated ? Math.min(lg.l.hip[1], lg.r.hip[1]) - BODY.thighRadius : null;
  return { joints, headF, headU, trunkF: F, right: R, seatY, soleY };
}

/** The 3D abduction of an arm: the angle between the upper arm and the trunk's downward line. */
export function armAbductionDeg(skel, side) {
  const j = skel.joints;
  const sh = side === "right" ? j[J.SH_R] : j[J.SH_L];
  const el = side === "right" ? j[J.ELB_R] : j[J.ELB_L];
  const down = norm(sub(j[J.PELVIS], j[J.NECK]));
  const arm = norm(sub(el, sh));
  return deg(Math.acos(Math.max(-1, Math.min(1, dot(arm, down)))));
}

/** The camera's axes: forward, right and up (the shader builds the same). */
function cameraAxes(cam) {
  const fw = norm(sub(cam.target, cam.pos));
  const rt = norm(cross(fw, UP));
  return { fw, rt, up: cross(rt, fw) };
}

/**
 * Where a point lands in a w x h picture, normalised like MediaPipe landmarks (x ÷ w, y ÷ h, y down)
 * with its depth along the view; the shader's pinhole: vertical field of view `cam.fovY` degrees.
 */
export function project(point, cam, w, h) {
  const { fw, rt, up } = cameraAxes(cam);
  const d = sub(point, cam.pos);
  const z = dot(d, fw);
  const f = 1 / Math.tan(rad(cam.fovY) / 2);
  const u = (0.5 * f * dot(d, rt)) / z;
  const v = (0.5 * f * dot(d, up)) / z;
  const r = (x) => Math.round(x * 1e12) / 1e12;
  return { x: r((u * h + w / 2) / w), y: r((h / 2 - v * h) / h), depth: r(z) };
}

/* ------------------------------------------------------------------------- the shader (browser) */

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec3 uCamPos, uCamTarget;
uniform float uFovY;
uniform vec3 uJ[21];
uniform vec3 uHeadF, uHeadU, uTrunkF, uRight;
uniform vec3 uBoxMin, uBoxMax;
uniform vec4 uChair;   // xyz: the seat's back centre at the seat top; w: 1 when drawn
uniform vec4 uPad;     // x: deck top height, y: half length along forward, z: half width; w: 1 when drawn
uniform vec3 uWall, uFloor;
uniform float uWallZ;
out vec4 outColor;

float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a; float l2 = dot(ba, ba); float rr = r1 - r2; float a2 = l2 - rr * rr; float il2 = 1.0 / l2;
  vec3 pa = p - a; float y = dot(pa, ba); float z = y - l2;
  vec3 xv = pa * l2 - ba * y; float x2 = dot(xv, xv);
  float y2 = y * y * l2; float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
float sdEll(vec3 p, vec3 r) { float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-6); }
float sdBox(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }

// materials: 1 skin, 2 shirt, 3 trousers, 4 shoe, 5 hair, 6 eye, 7 lips, 8 chair, 9 pad
vec2 U(vec2 d, float dist, float m) { return dist < d.x ? vec2(dist, m) : d; }
vec2 SU(vec2 d, float dist, float m, float k) { float s = smin(d.x, dist, k); return vec2(s, dist < d.x ? m : d.y); }

vec2 person(vec3 p) {
  vec2 d = vec2(1e9, 0.0);
  vec3 up = normalize(uJ[11] - uJ[0]);
  vec3 tf = normalize(uTrunkF - up * dot(uTrunkF, up));
  vec3 tr = cross(tf, up);
  vec3 q = p - uJ[0]; vec3 lq = vec3(dot(q, tf), dot(q, up), dot(q, tr));
  float tl = length(uJ[11] - uJ[0]);
  float pelvis = sdEll(lq - vec3(-0.005, 0.02, 0.0), vec3(0.105, 0.115, 0.165));
  float abd = sdEll(lq - vec3(0.0, tl * 0.36, 0.0), vec3(0.1, 0.17, 0.148));
  float chest = sdEll(lq - vec3(0.008, tl * 0.72, 0.0), vec3(0.112, 0.2, 0.172));
  d = U(d, pelvis, 3.0);
  d = SU(d, abd, 2.0, 0.06);
  d = SU(d, chest, 2.0, 0.06);
  d = SU(d, sdRoundCone(p, uJ[13], uJ[14], 0.058, 0.058), 2.0, 0.05);
  vec3 hf = uHeadF; vec3 hu = uHeadU; vec3 hr = cross(hf, hu);
  d = SU(d, sdRoundCone(p, uJ[11], uJ[12] - hu * 0.05, 0.058, 0.05), 1.0, 0.03);
  vec3 h = p - uJ[12]; vec3 lh = vec3(dot(h, hf), dot(h, hu), dot(h, hr));
  vec3 lhm = vec3(lh.x, lh.y, abs(lh.z));
  float head = smin(sdEll(lh, vec3(0.098, 0.118, 0.082)), sdEll(lh - vec3(0.03, -0.062, 0.0), vec3(0.074, 0.058, 0.066)), 0.04);
  head = smin(head, sdRoundCone(lh, vec3(0.086, 0.0, 0.0), vec3(0.113, -0.033, 0.0), 0.011, 0.014), 0.012);
  head = smin(head, sdEll(lhm - vec3(-0.004, -0.004, 0.08), vec3(0.022, 0.033, 0.013)), 0.01);
  d = SU(d, head, 1.0, 0.02);
  d = U(d, sdRoundCone(lhm, vec3(0.093, -0.058, 0.0), vec3(0.083, -0.058, 0.022), 0.0075, 0.005), 7.0);
  d = U(d, length(lhm - vec3(0.081, 0.018, 0.034)) - 0.0135, 6.0);
  d = U(d, sdRoundCone(lhm, vec3(0.089, 0.042, 0.016), vec3(0.082, 0.045, 0.052), 0.0065, 0.0055), 5.0);
  float hair = sdEll(lh - vec3(-0.012, 0.024, 0.0), vec3(0.106, 0.116, 0.089));
  hair = max(hair, (0.82 * lh.x - lh.y - 0.006) / 1.293);
  d = U(d, hair, 5.0);
  for (int s = 0; s < 2; s++) {
    vec3 sh = uJ[13 + s], el = uJ[15 + s], wr = uJ[17 + s], hd = uJ[19 + s];
    d = SU(d, sdRoundCone(p, sh, mix(sh, el, 0.45), 0.06, 0.054), 2.0, 0.03);
    d = SU(d, sdRoundCone(p, sh + (el - sh) * 0.2, el, 0.047, 0.04), 1.0, 0.01);
    d = SU(d, sdRoundCone(p, el, wr, 0.041, 0.029), 1.0, 0.02);
    d = SU(d, sdRoundCone(p, wr, hd, 0.031, 0.024), 1.0, 0.015);
  }
  for (int s = 0; s < 2; s++) {
    vec3 hp = uJ[1 + s], kn = uJ[3 + s], an = uJ[5 + s], he = uJ[7 + s], to = uJ[9 + s];
    d = SU(d, sdRoundCone(p, hp, kn, 0.088, 0.058), 3.0, 0.06);
    d = SU(d, sdRoundCone(p, kn, an + (an - kn) * 0.02, 0.057, 0.044), 3.0, 0.02);
    vec3 fdir = normalize(to - he);
    float shoe = sdRoundCone(p, he + fdir * 0.035, to - fdir * 0.03, 0.05, 0.038);
    shoe = smin(shoe, sdRoundCone(p, an, he + fdir * 0.05, 0.05, 0.05), 0.03);
    d = SU(d, shoe, 4.0, 0.015);
  }
  return d;
}

vec2 props(vec3 p) {
  vec2 d = vec2(1e9, 0.0);
  if (uChair.w > 0.5) {
    vec3 f = normalize(vec3(uTrunkF.x, 0.0, uTrunkF.z)); vec3 r = uRight;
    vec3 c = uChair.xyz; vec3 q = p - c; vec3 l = vec3(dot(q, r), q.y, dot(q, f));
    // seat 0.46 x 0.42, 4 cm thick, its back edge 6 cm behind the pelvis; legs; a backrest
    float seat = sdBox(l - vec3(0.0, -0.02, 0.15), vec3(0.23, 0.02, 0.21), 0.01);
    vec3 lg = vec3(abs(l.x) - 0.2, l.y, abs(l.z - 0.15) - 0.18);
    float legs = sdBox(lg - vec3(0.0, -c.y * 0.5, 0.0), vec3(0.018, c.y * 0.5, 0.018), 0.005);
    float back = sdBox(l - vec3(0.0, 0.25, -0.05), vec3(0.22, 0.2, 0.015), 0.01);
    float posts = sdBox(vec3(abs(l.x) - 0.2, l.y - 0.2, l.z + 0.05), vec3(0.018, 0.22, 0.018), 0.005);
    d = U(d, min(min(seat, legs), min(back, posts)), 8.0);
  }
  if (uPad.w > 0.5) {
    vec3 f = normalize(vec3(uTrunkF.x, 0.0, uTrunkF.z)); vec3 r = uRight;
    vec3 q = p - vec3(uJ[0].x, 0.0, uJ[0].z); vec3 l = vec3(dot(q, r), q.y, dot(q, f));
    float deck = sdBox(l - vec3(0.0, uPad.x * 0.5, 0.0), vec3(uPad.z, uPad.x * 0.5, uPad.y), 0.02);
    d = U(d, deck, 9.0);
  }
  return d;
}

vec2 scene(vec3 p) { vec2 a = person(p); vec2 b = props(p); return a.x < b.x ? a : b; }

bool boxHit(vec3 ro, vec3 rd, out float t0, out float t1) {
  vec3 inv = 1.0 / rd; vec3 a = (uBoxMin - ro) * inv; vec3 b = (uBoxMax - ro) * inv;
  vec3 mn = min(a, b), mx = max(a, b);
  t0 = max(max(mn.x, mn.y), mn.z); t1 = min(min(mx.x, mx.y), mx.z);
  return t1 > max(t0, 0.0);
}
vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.0008, 0.0);
  return normalize(vec3(scene(p + e.xyy).x - scene(p - e.xyy).x, scene(p + e.yxy).x - scene(p - e.yxy).x, scene(p + e.yyx).x - scene(p - e.yyx).x));
}
float shadowRay(vec3 ro, vec3 rd) {
  float t0, t1; if (!boxHit(ro, rd, t0, t1)) return 1.0;
  float res = 1.0; float t = max(t0, 0.01);
  for (int i = 0; i < 48; i++) { float h = scene(ro + rd * t).x; res = min(res, 10.0 * h / t); t += clamp(h, 0.01, 0.2); if (res < 0.02 || t > t1) break; }
  return clamp(res, 0.0, 1.0);
}
float ao(vec3 p, vec3 n) {
  float o = 0.0, w = 1.0;
  for (int i = 1; i <= 5; i++) { float h = 0.012 * float(i) * float(i); o += w * (h - scene(p + n * h).x); w *= 0.7; }
  return clamp(1.0 - 2.5 * o, 0.0, 1.0);
}
vec3 matColor(float m) {
  if (m < 1.5) return vec3(0.56, 0.36, 0.25);
  if (m < 2.5) return vec3(0.93, 0.9, 0.85);
  if (m < 3.5) return vec3(0.13, 0.14, 0.18);
  if (m < 4.5) return vec3(0.93, 0.92, 0.89);
  if (m < 5.5) return vec3(0.05, 0.04, 0.04);
  if (m < 6.5) return vec3(0.04, 0.03, 0.03);
  if (m < 7.5) return vec3(0.42, 0.24, 0.2);
  if (m < 8.5) return vec3(0.52, 0.42, 0.33);
  return vec3(0.2, 0.2, 0.22);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 fw = normalize(uCamTarget - uCamPos); vec3 rt = normalize(cross(fw, vec3(0, 1, 0))); vec3 upv = cross(rt, fw);
  float f = 1.0 / tan(radians(uFovY) * 0.5);
  vec3 rd = normalize(uv.x * rt + uv.y * upv + f * fw * 0.5);
  vec3 ro = uCamPos;
  vec3 L = normalize(vec3(-0.45, 0.8, 0.55));
  vec3 col = uWall;
  float tFloor = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
  float tWall = rd.z < 0.0 ? (uWallZ - ro.z) / rd.z : 1e9;
  if (tFloor < tWall) {
    vec3 fp = ro + rd * tFloor;
    col = uFloor * (0.6 + 0.4 * shadowRay(fp + vec3(0, 0.002, 0), L));
  } else if (tWall < 1e8) {
    vec3 wp = ro + rd * tWall;
    col *= 0.82 + 0.18 * shadowRay(wp + vec3(0, 0, 0.002), L);
  }
  float t0, t1;
  if (boxHit(ro, rd, t0, t1)) {
    float t = max(t0, 0.0); vec2 h = vec2(1e9, 0.0); bool hit = false;
    for (int i = 0; i < 160; i++) {
      h = scene(ro + rd * t);
      if (h.x < 0.0004 * t) { hit = true; break; }
      t += h.x * 0.9; if (t > t1) break;
    }
    if (hit) {
      vec3 p = ro + rd * t; vec3 n = normalAt(p);
      vec3 base = matColor(h.y);
      float dif = max(dot(n, L), 0.0) * shadowRay(p + n * 0.003, L);
      float hemi = 0.5 + 0.5 * n.y;
      float occ = ao(p, n);
      float fill = max(dot(n, normalize(vec3(0.6, 0.2, 0.7))), 0.0);
      float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), 24.0) * (h.y < 1.5 ? 0.25 : 0.08);
      col = pow(base * (0.95 * dif + 0.35 * hemi * occ + 0.25 * fill * occ) + spec, vec3(0.92));
    }
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const VERT = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

/**
 * The shader on a canvas (browser only). `render(skel, cam, scene)` draws one frame:
 *   scene.chair  draw the chair under a seated skeleton
 *   scene.pad    { deck: top height, length, width } the walking pad deck under the feet
 *   scene.wall, scene.floor colours; scene.wallZ the wall's depth (behind the person)
 */
export function createRenderer(canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error("humanoid: WebGL 2 is not available");
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(prog, n);
  return {
    gl,
    render(skel, cam, scene = {}) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u("uRes"), canvas.width, canvas.height);
      gl.uniform3fv(u("uCamPos"), cam.pos);
      gl.uniform3fv(u("uCamTarget"), cam.target);
      gl.uniform1f(u("uFovY"), cam.fovY);
      gl.uniform3fv(u("uJ"), new Float32Array(skel.joints.flat()));
      gl.uniform3fv(u("uHeadF"), skel.headF);
      gl.uniform3fv(u("uHeadU"), skel.headU);
      gl.uniform3fv(u("uTrunkF"), skel.trunkF);
      gl.uniform3fv(u("uRight"), skel.right);
      const pts = [...skel.joints];
      const P = skel.joints[J.PELVIS];
      const chair = !!scene.chair && skel.seatY !== null;
      // The seat's back centre: under the pelvis, 6 cm behind it.
      const seat = chair ? [P[0] - skel.trunkF[0] * 0.06, skel.seatY, P[2] - skel.trunkF[2] * 0.06] : [0, 0, 0];
      if (chair) pts.push([seat[0], 0, seat[2]], [seat[0], 1, seat[2]]);
      const pad = scene.pad ?? null;
      if (pad) pts.push([P[0] - pad.length, 0, P[2] - pad.length], [P[0] + pad.length, 0, P[2] + pad.length]);
      const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])) - 0.25);
      const hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])) + 0.25);
      gl.uniform3fv(u("uBoxMin"), lo);
      gl.uniform3fv(u("uBoxMax"), hi);
      gl.uniform4f(u("uChair"), seat[0], seat[1], seat[2], chair ? 1 : 0);
      gl.uniform4f(u("uPad"), pad?.deck ?? 0, (pad?.length ?? 0) / 2, (pad?.width ?? 0) / 2, pad ? 1 : 0);
      gl.uniform3fv(u("uWall"), scene.wall ?? [0.93, 0.92, 0.9]);
      gl.uniform3fv(u("uFloor"), scene.floor ?? [0.78, 0.75, 0.71]);
      gl.uniform1f(u("uWallZ"), scene.wallZ ?? -1.4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.finish();
    },
  };
}
