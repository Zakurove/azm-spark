/**
 * The program build animation (D-032 item 4): its plan and every drawn position, pure and free of the
 * DOM, so the beats, their order, the summary handling and the drawing are tested in node
 * (tests/v7/program-build.test.ts). Times are in ms from the start. Positions are in the stage's units
 * (360 by 420), drawn left to right; the stage is mirrored for Arabic, so the walk, the cards and the
 * week read in the page's direction.
 *
 * One caption a beat (programBuildCopy.ts):
 *   history      the body of the health form's body map is scanned in, the affected joints light up in
 *                purple, and two records (the condition, the body map) slide in and link to them;
 *   camera       a pose skeleton of tracked points snaps onto the body and raises an arm, a gold angle
 *                arc sweeps with it and a hold ring fills at the top (the range of motion check);
 *   walk         the skeleton turns side on and takes two steps while timing bars stream below it,
 *                gold for the right foot and purple for the left (the walk);
 *   historyUsed  in place of the walk when there was none: the records come back and are read again;
 *   engineer     everything flows as light into a gold and purple core of turning rings, then the
 *                exercise cards (stretch, strengthen, walk) drop into the seven days of a week.
 * Nothing drawn holds text or a number, so nothing looks like a result of the person's own.
 */

/** What the flow knows once the program is built; the animation uses it lightly. */
export interface BuildSummary {
  /** Joints measured with the camera: about this many light up; none leaves the camera beat out. */
  joints: number;
  /** A walk was measured: the walk beat; otherwise a short beat on the medical history. */
  walk: boolean;
  /** Exercises in the program: about this many cards drop into the week. */
  exercises: number;
}

export type BeatId = "history" | "camera" | "walk" | "historyUsed" | "engineer";
export interface Beat {
  id: BeatId;
  start: number;
  end: number;
}
export type CardKind = "stretch" | "strengthen" | "walk";
export interface BuildCard {
  kind: CardKind;
  /** The day of the week, 0 to 6 in reading order. */
  day: number;
  /** 0, or 1 for a second card on the same day. */
  row: number;
}
export interface BuildPlan {
  beats: readonly Beat[];
  /** How many joints light up (0 to MAX_JOINTS). */
  joints: number;
  cards: readonly BuildCard[];
  /** The rows of cards a day holds: 1, or 2 when there are more cards than days. */
  rows: number;
  /** «برنامجك جاهز» and Continue. */
  end: number;
  /** The rings have come to rest: the frame loop stops (and the reduced motion still is drawn). */
  settle: number;
}

export const BEAT_MS: Readonly<Record<BeatId, number>> = {
  history: 1400,
  camera: 1500,
  walk: 1400,
  historyUsed: 900,
  engineer: 1800,
};
export const DEFAULT_SUMMARY: Readonly<BuildSummary> = { joints: 3, walk: true, exercises: 6 };
export const MAX_JOINTS = 8;
export const MIN_CARDS = 3;
export const MAX_CARDS = 10;
export const SETTLE_MS = 1600;
/** The most one frame may advance: a hidden tab or a stalled phone resumes where it was. */
export const MAX_FRAME_MS = 64;
/** The days the cards take: every other day first, then the days between. */
const DAY_ORDER = [0, 2, 4, 6, 1, 3, 5] as const;

const whole = (n: number, fallback: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback);

export function buildPlan(summary?: BuildSummary): BuildPlan {
  const s = summary ?? DEFAULT_SUMMARY;
  const joints = Math.min(MAX_JOINTS, whole(s.joints, DEFAULT_SUMMARY.joints));
  const walk = s.walk === true;
  const order: BeatId[] = ["history"];
  if (joints > 0) order.push("camera");
  order.push(walk ? "walk" : "historyUsed", "engineer");
  let at = 0;
  const beats = order.map((id) => {
    const beat = { id, start: at, end: at + BEAT_MS[id] };
    at = beat.end;
    return beat;
  });
  const kinds: CardKind[] = walk ? ["stretch", "strengthen", "walk"] : ["stretch", "strengthen"];
  const n = Math.min(MAX_CARDS, Math.max(MIN_CARDS, whole(s.exercises, DEFAULT_SUMMARY.exercises)));
  const cards = Array.from({ length: n }, (_, i) => ({
    kind: kinds[i % kinds.length],
    day: DAY_ORDER[i % 7],
    row: i < 7 ? 0 : 1,
  }));
  return { beats, joints, cards, rows: n > 7 ? 2 : 1, end: at, settle: at + SETTLE_MS };
}

/** The beat playing at `t`; null once the program is ready. */
export const beatAt = (plan: BuildPlan, t: number): Beat | null => plan.beats.find((b) => t < b.end) ?? null;
const beatOf = (plan: BuildPlan, id: BeatId) => plan.beats.find((b) => b.id === id);

/**
 * The animation's clock and its one way out: Skip (any time) and Continue (once ready) each end it by
 * calling `done` exactly once. The component advances it once a frame.
 */
export class BuildDirector {
  t: number;
  private closed = false;
  constructor(
    readonly plan: BuildPlan,
    private readonly done: () => void,
    still = false,
  ) {
    this.t = still ? plan.settle : 0;
  }
  get finished() {
    return this.t >= this.plan.end;
  }
  get beat() {
    return beatAt(this.plan, this.t);
  }
  /** One frame of `dt` ms (at most MAX_FRAME_MS); false once everything has come to rest. */
  tick(dt: number): boolean {
    this.t = Math.min(this.plan.settle, this.t + Math.min(MAX_FRAME_MS, Math.max(0, dt)));
    return this.t < this.plan.settle;
  }
  /** Reduced motion turned on midway: straight to the still. */
  toStill() {
    this.t = this.plan.settle;
  }
  skip() {
    this.close();
  }
  continue() {
    if (this.finished) this.close();
  }
  private close() {
    if (this.closed) return;
    this.closed = true;
    this.done();
  }
}

/* ------------------------------------------------------------------ motion */

export const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Progress (0 to 1) of a move that starts at `at` and lasts `ms`. */
export const step = (u: number, at: number, ms: number) => clamp01((u - at) / ms);
export const easeOut = (k: number) => 1 - (1 - k) ** 3;
export const easeInOut = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
const easeSine = (k: number) => (1 - Math.cos(Math.PI * k)) / 2;
/** Ends a touch past 1 and settles back: a soft landing. */
export const easeBack = (k: number) => 1 + 2.6 * (k - 1) ** 3 + 1.6 * (k - 1) ** 2;
const rad = (d: number) => (d * Math.PI) / 180;
const mod1 = (x: number) => x - Math.floor(x);
/** A bell around `c` on a looping phase. */
function bump(p: number, c: number, w: number) {
  const d = Math.abs(mod1(p) - c);
  return Math.exp(-((Math.min(d, 1 - d) / w) ** 2));
}
function bezier(a: Pt, b: Pt, c: Pt, k: number): Pt {
  const m = 1 - k;
  return [m * m * a[0] + 2 * m * k * b[0] + k * k * c[0], m * m * a[1] + 2 * m * k * b[1] + k * k * c[1]];
}
/** A seeded random sequence (mulberry32): the same sparks in every render and every test. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ the body */

export type Pt = readonly [number, number];
export const STAGE = { w: 360, h: 420 } as const;
/** The body map's figure (BodyMap.tsx draws it in 240 by 440) as it stands on the stage. */
export const FIGURE = { x: 96, y: 34, s: 0.7 } as const;
/** The soft light the body stands on. */
export const PEDESTAL = { x: 180, y: 337, rx: 100, ry: 13 } as const;
const onStage = (x: number, y: number): Pt => [FIGURE.x + x * FIGURE.s, FIGURE.y + y * FIGURE.s];

/** The joints that light up, in order: the person's right on your left, as the body map's front view. */
const SPOTS: readonly Pt[] = [
  onStage(80, 104), // right shoulder: the arm the camera beat raises
  onStage(147, 338), // left knee
  onStage(95, 262), // right hip
  onStage(58, 168), // right elbow
  onStage(149, 410), // left ankle
  onStage(45, 232), // right wrist
  onStage(120, 70), // neck
  onStage(160, 104), // left shoulder
];
export const jointSpots = (n: number): Pt[] => SPOTS.slice(0, n);

export const LANDMARKS = [
  "head",
  "nose",
  "shR",
  "shL",
  "elR",
  "elL",
  "wrR",
  "wrL",
  "hipR",
  "hipL",
  "knR",
  "knL",
  "anR",
  "anL",
  "toeR",
  "toeL",
] as const;
export type Landmark = (typeof LANDMARKS)[number];
export type Pose = Record<Landmark, Pt>;
export const BONES: readonly (readonly [Landmark, Landmark])[] = [
  ["shR", "shL"],
  ["shR", "elR"],
  ["elR", "wrR"],
  ["shL", "elL"],
  ["elL", "wrL"],
  ["shR", "hipR"],
  ["shL", "hipL"],
  ["hipR", "hipL"],
  ["hipR", "knR"],
  ["knR", "anR"],
  ["anR", "toeR"],
  ["hipL", "knL"],
  ["knL", "anL"],
  ["anL", "toeL"],
];
export const HEAD_R = 9;
const RIGHT_ARM: Landmark[] = ["shR", "elR", "wrR"];
const RIGHT_LEG: Landmark[] = ["hipR", "knR", "anR", "toeR"];

/** The skeleton standing on the body map's figure, arms resting. */
const FRONT: Pose = {
  head: onStage(120, 38),
  nose: onStage(120, 44),
  shR: onStage(80, 104),
  shL: onStage(160, 104),
  elR: onStage(58, 168),
  elL: onStage(182, 168),
  wrR: onStage(45, 232),
  wrL: onStage(195, 232),
  hipR: onStage(100, 252),
  hipL: onStage(140, 252),
  knR: onStage(95, 336),
  knL: onStage(145, 336),
  anR: onStage(92, 404),
  anL: onStage(148, 404),
  toeR: onStage(86, 418),
  toeL: onStage(154, 418),
};
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const UPPER = dist(FRONT.shR, FRONT.elR);
const FORE = dist(FRONT.elR, FRONT.wrR);
const THIGH = dist(FRONT.hipR, FRONT.knR);
const SHANK = dist(FRONT.knR, FRONT.anR);
const FOOT = 13;
const TORSO = FRONT.hipR[1] - FRONT.shR[1];
const HEAD_UP = FRONT.shR[1] - FRONT.head[1];
/** The angle of a right upper arm from straight down, in degrees (shoulder abduction, front view). */
export const armAngle = (p: Pose) => (Math.atan2(p.shR[0] - p.elR[0], p.elR[1] - p.shR[1]) * 180) / Math.PI;
export const ARM_REST = armAngle(FRONT);
export const ARM_TOP = 140;
const FORE_BEND =
  (Math.atan2(FRONT.elR[0] - FRONT.wrR[0], FRONT.wrR[1] - FRONT.elR[1]) * 180) / Math.PI - ARM_REST;

/** The front skeleton with its right arm raised to the side by `abduction` degrees. */
export function frontPose(abduction: number): Pose {
  const sh = FRONT.shR;
  const a = rad(abduction);
  const el: Pt = [sh[0] - UPPER * Math.sin(a), sh[1] + UPPER * Math.cos(a)];
  const b = a + rad(FORE_BEND * (1 - 0.7 * clamp01((abduction - ARM_REST) / (ARM_TOP - ARM_REST))));
  return { ...FRONT, elR: el, wrR: [el[0] - FORE * Math.sin(b), el[1] + FORE * Math.cos(b)] };
}

/** The ground line of the side view: higher than the front view's feet, so the timing lanes fit below. */
export const GROUND = 296;
const PELVIS_X = 176;
const LEAN = rad(4);
/** One leg at its phase of a stride (0 is the heel landing), from its hip; flex is the hip's angle. */
function legAt(psi: number) {
  const p = mod1(psi);
  const flex = 6 + 22 * Math.cos(2 * Math.PI * p);
  const h = rad(flex);
  const k = rad(5 + 9 * bump(p, 0.15, 0.1) + 55 * bump(p, 0.72, 0.13));
  const knee: Pt = [THIGH * Math.sin(h), THIGH * Math.cos(h)];
  const s = h - k;
  const ankle: Pt = [knee[0] + SHANK * Math.sin(s), knee[1] + SHANK * Math.cos(s)];
  const f = s + rad(90 - 18 * bump(p, 0.64, 0.08));
  const toe: Pt = [ankle[0] + FOOT * Math.sin(f), ankle[1] + FOOT * Math.cos(f)];
  return { flex, knee, ankle, toe };
}
/** A foot is on the ground for this part of its stride. */
export const STANCE = 0.62;
/** How far the ground moves under the walker in one stride (a walking pad: the walker stays). */
export const BELT = (legAt(0).ankle[0] - legAt(STANCE).ankle[0]) / STANCE;
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
function armAt(sh: Pt, swing: number) {
  const s = rad(swing);
  const el: Pt = [sh[0] + UPPER * Math.sin(s), sh[1] + UPPER * Math.cos(s)];
  const f = s + rad(28);
  return { el, wr: [el[0] + FORE * Math.sin(f), el[1] + FORE * Math.cos(f)] as Pt };
}

/** The skeleton side on, walking toward the reading direction, at `phase` strides. */
export function sidePose(phase: number): Pose {
  const r = legAt(phase);
  const l = legAt(phase + 0.5);
  const low = Math.max(r.ankle[1], r.toe[1], l.ankle[1], l.toe[1]);
  const py = GROUND - low;
  const hipR: Pt = [PELVIS_X + 1.5, py + 0.5];
  const hipL: Pt = [PELVIS_X - 2.5, py - 1];
  const sc: Pt = [PELVIS_X + TORSO * Math.sin(LEAN), py - TORSO * Math.cos(LEAN)];
  const head: Pt = [sc[0] + 5, sc[1] - HEAD_UP + 1];
  const shR: Pt = [sc[0] + 1.5, sc[1] + 0.5];
  const shL: Pt = [sc[0] - 2.5, sc[1] - 1];
  const armR = armAt(shR, -0.7 * (r.flex - 6));
  const armL = armAt(shL, -0.7 * (l.flex - 6));
  return {
    head,
    nose: [head[0] + 4.5, head[1] + 1.5],
    shR,
    shL,
    elR: armR.el,
    elL: armL.el,
    wrR: armR.wr,
    wrL: armL.wr,
    hipR,
    hipL,
    knR: add(hipR, r.knee),
    knL: add(hipL, l.knee),
    anR: add(hipR, r.ankle),
    anL: add(hipL, l.ankle),
    toeR: add(hipR, r.toe),
    toeL: add(hipL, l.toe),
  };
}

function lerpPose(a: Pose, b: Pose, k: number): Pose {
  const out = {} as Record<Landmark, Pt>;
  for (const l of LANDMARKS) out[l] = [lerp(a[l][0], b[l][0], k), lerp(a[l][1], b[l][1], k)];
  return out;
}

const f2 = (n: number) => Math.round(n * 100) / 100;
/** An angle wedge at `c` of radius `r`, from straight down to `deg` toward your left. */
export function arcWedge(c: Pt, r: number, deg: number): string {
  const a = rad(deg);
  return `M${f2(c[0])} ${f2(c[1])}L${f2(c[0])} ${f2(c[1] + r)}A${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${f2(c[0] - r * Math.sin(a))} ${f2(c[1] + r * Math.cos(a))}Z`;
}
/** A goniometer's marks outside that wedge, every `every` degrees up to `deg`. */
export function arcTicks(c: Pt, r1: number, r2: number, deg: number, every: number): string {
  let d = "";
  for (let a = every; a < deg - 3; a += every) {
    const s = Math.sin(rad(a));
    const k = Math.cos(rad(a));
    d += `M${f2(c[0] - r1 * s)} ${f2(c[1] + r1 * k)}L${f2(c[0] - r2 * s)} ${f2(c[1] + r2 * k)}`;
  }
  return d;
}

/* ------------------------------------------------------------------ the beats' timing */

const LEVEL_MS = 320;
/** A layer's opacity: each beat has its level, reached in `ms` from the level of the beat before. */
function level(plan: BuildPlan, t: number, levels: Partial<Record<BeatId, number>>, ms = LEVEL_MS) {
  const i = plan.beats.findIndex((b) => t < b.end);
  if (i < 0) return levels.engineer ?? 0;
  const to = levels[plan.beats[i].id] ?? 0;
  const from = i === 0 ? 0 : (levels[plan.beats[i - 1].id] ?? 0);
  return lerp(from, to, easeInOut(step(t, plan.beats[i].start, ms)));
}

/** history: the scan line comes down the body. */
const SCAN = { from: 36, to: 348, at: 80, ms: 860 } as const;
const scanY = (u: number) => lerp(SCAN.from, SCAN.to, easeSine(step(u, SCAN.at, SCAN.ms)));
/** When the scan line reaches `y`. */
const scanTime = (y: number) =>
  SCAN.at + (SCAN.ms * Math.acos(1 - 2 * clamp01((y - SCAN.from) / (SCAN.to - SCAN.from)))) / Math.PI;

/** The two records, the condition and the body map: their places and size. */
export const RECORDS: readonly Pt[] = [
  [10, 90],
  [256, 212],
];
export const RECORD = { w: 94, h: 60 } as const;
/** The camera's frame around the body. */
export const VIEW = { x: 14, y: 14, w: 332, h: 334 } as const;

/** camera: the arm rises, then holds while the ring fills. */
const RAISE = { at: 300, ms: 800 } as const;
const HOLD = { at: 1100, ms: 300 } as const;
export const cameraArm = (u: number) =>
  ARM_REST + (ARM_TOP - ARM_REST) * easeInOut(step(u, RAISE.at, RAISE.ms));

/** walk: the turn side on, then a stride a second. */
export const WALK_TURN_MS = 320;
export const STRIDE_MS = 1000;
export const walkPhase = (u: number) => Math.max(0, (u - WALK_TURN_MS) / STRIDE_MS);
export const LANES = { right: 320, left: 337 } as const;
/** Where a foot lands: the bars start here and stream back with the ground. */
export const NOW_X = PELVIS_X + legAt(0).ankle[0];
export const LANE_X0 = 36;

/** engineer: the core, the week and when each card leaves the core. */
export const CORE: Pt = [180, 160];
export const RINGS = [32, 47, 62] as const;
const SPIN = [0.12, -0.08, 0.045] as const;
export const WEEK = { x0: 22, w: 40, gap: 6 } as const;
/** The top of the days: lower for one card a day, higher for two. */
export const weekTop = (rows: number) => (rows > 1 ? 318 : 336);
/** A day's height: one card, or two stacked. */
export const slotHeight = (rows: number) => (rows > 1 ? 84 : 52);
/** Where card `i` of the plan sits in its day: alone it is centred, two share the day. */
export function cardSpot(plan: BuildPlan, i: number): Pt {
  const { day, row } = plan.cards[i];
  const stack = plan.cards.filter((c) => c.day === day).length;
  return [
    WEEK.x0 + day * (WEEK.w + WEEK.gap) + WEEK.w / 2,
    weekTop(plan.rows) + slotHeight(plan.rows) / 2 + (row - (stack - 1) / 2) * 34,
  ];
}
/** Where the cards leave the core: its lower edge, under the check. */
export const CARD_FROM: Pt = [CORE[0], CORE[1] + 24];
const CARD = { at: 640, gap: 72, ms: 460 } as const;
const CHECK_AT = 1480;

/* ------------------------------------------------------------------ the frame */

export interface Frame {
  body: { opacity: number; reveal: number; scanY: number; scan: number };
  joints: { at: Pt; on: number; pulse: number; opacity: number }[];
  records: {
    opacity: number;
    cards: { at: Pt; opacity: number; shimmer: number }[];
    /** draw: the line drawn in; flow: a dot of data running along it. */
    links: { from: Pt; to: Pt; draw: number; flow: number }[];
  };
  /** bottom: the frame's lower edge, raised for the walk so the timing lanes sit below it. */
  hud: { opacity: number; bottom: number; band: number; live: number };
  skeleton: SkeletonFrame | null;
  gait: GaitFrame | null;
  engine: EngineFrame | null;
}
export interface SkeletonFrame {
  pose: Pose;
  opacity: number;
  bones: number;
  /** Each landmark's size, in LANDMARKS order (they pop in as the camera finds them). */
  pop: number[];
  gold: Landmark[];
  reticles: { at: Pt; size: number; opacity: number }[];
  arc: { deg: number; opacity: number };
  hold: { at: Pt; progress: number; opacity: number; pulse: number };
}
export interface GaitFrame {
  opacity: number;
  bars: { leg: "right" | "left"; from: number; to: number }[];
  /** A foot landing: a ring on the ground that grows and fades (k from 0 to 1). */
  steps: { leg: "right" | "left"; at: Pt; k: number }[];
  /** Each ankle's recent path, newest last: the tracked point's trajectory. */
  trails: { leg: "right" | "left"; points: Pt[] }[];
  /** How far the ground has moved. */
  belt: number;
}
export interface EngineFrame {
  /** A spark of light and its tail along its path (oldest first). */
  sparks: { at: Pt; tail: Pt[]; r: number; opacity: number; gold: boolean }[];
  core: {
    glow: number;
    disc: number;
    rings: { scale: number; angle: number }[];
    /** What fed the program, riding the outer ring: the records, the pose, the steps. */
    badges: { kind: SourceKind; angle: number; scale: number }[];
    check: number;
    burst: number;
  };
  slots: { opacity: number; lift: number }[];
  cards: { at: Pt; scale: number; angle: number; opacity: number; landed: number }[];
}

/** Everything drawn at `t`. */
export function frameAt(plan: BuildPlan, t: number): Frame {
  const hist = plan.beats[0];
  const used = beatOf(plan, "historyUsed");
  const cam = beatOf(plan, "camera");
  const walk = beatOf(plan, "walk");
  const eng = beatOf(plan, "engineer")!;

  // The body, scanned in and dimmed while the skeleton works.
  const body = {
    opacity: level(plan, t, { history: 1, camera: 0.16, historyUsed: 1 }),
    reveal: t < hist.end ? scanY(t) + 1 : STAGE.h,
    scanY: scanY(t),
    scan: step(t, 40, 120) * (1 - step(t, 840, 160)),
  };

  const usedLate = used && t >= used.start ? t - used.start : -1;
  const jl = level(plan, t, { history: 1, camera: 0.6, historyUsed: 1 });
  const joints = jointSpots(plan.joints).map((at, j) => {
    const lit = scanTime(at[1]);
    const pulse = usedLate >= 0 ? step(usedLate, 260 + j * 70, 700) : step(t, lit, 700);
    return { at, on: step(t, lit, 260), pulse, opacity: jl };
  });

  // The records: in with the scan, and again (read once more) when there was no walk.
  const again = usedLate >= 0 && cam !== undefined;
  const recordIn = (i: number) =>
    again ? step(usedLate, 120 + i * 100, 380) : usedLate >= 0 ? 1 : step(t, 260 + i * 160, 420);
  const spots = jointSpots(plan.joints);
  const records = {
    opacity: level(plan, t, { history: 1, historyUsed: 1 }),
    cards: RECORDS.map((p, i) => {
      const k = recordIn(i);
      const at: Pt = [p[0] + (i === 0 ? -28 : 28) * (1 - easeOut(k)), p[1]];
      return { at, opacity: k, shimmer: usedLate >= 0 ? step(usedLate, 380 + i * 90, 420) : 0 };
    }),
    links: spots.length
      ? [
          {
            from: [RECORDS[0][0] + RECORD.w, RECORDS[0][1] + RECORD.h / 2] as Pt,
            to: spots[0],
            draw: usedLate >= 0 ? step(usedLate, 450, 300) : step(t, 700, 320),
            flow: usedLate >= 0 ? step(usedLate, 700, 320) : step(t, 1000, 360),
          },
          {
            from: [RECORDS[1][0], RECORDS[1][1] + RECORD.h / 2] as Pt,
            to: spots[Math.min(1, spots.length - 1)],
            draw: usedLate >= 0 ? step(usedLate, 520, 300) : step(t, 820, 320),
            flow: usedLate >= 0 ? step(usedLate, 780, 320) : step(t, 1120, 360),
          },
        ]
      : [],
  };

  // The camera's frame: its corners, faint scan lines and a band that sweeps down.
  const bottom = lerp(
    VIEW.y + VIEW.h,
    GROUND + 14,
    walk && t >= walk.start ? easeInOut(step(t, walk.start, WALK_TURN_MS)) : 0,
  );
  const hud = {
    opacity: level(plan, t, { camera: 1, walk: 1 }),
    bottom,
    band: VIEW.y + mod1(t / 1300) * (bottom - VIEW.y - 34),
    live: 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t / 170)),
  };

  return {
    body,
    joints,
    records,
    hud,
    skeleton: skeletonAt(plan, t, cam, walk, eng),
    gait: gaitAt(plan, t, walk, eng),
    engine: t >= eng.start ? engineAt(plan, t - eng.start) : null,
  };
}

function skeletonAt(plan: BuildPlan, t: number, cam?: Beat, walk?: Beat, eng?: Beat): SkeletonFrame | null {
  const first = cam ?? walk;
  if (!first || t < first.start || (eng && t >= eng.start + LEVEL_MS)) return null;
  let pose: Pose;
  let gold: Landmark[] = [];
  let reticles: SkeletonFrame["reticles"] = [];
  const lock = (l: Landmark[], u: number, at: number) =>
    l.map((m) => ({
      at: pose[m],
      size: lerp(13, 7.5, easeOut(step(u, at, 240))),
      opacity: step(u, at, 120),
    }));
  if (walk && t >= walk.start) {
    const u = Math.min(t, walk.end) - walk.start;
    const turn = easeInOut(step(u, 0, WALK_TURN_MS));
    const from = frontPose(cam ? lerp(ARM_TOP, ARM_REST, turn) : ARM_REST);
    pose = lerpPose(from, sidePose(walkPhase(u)), turn);
    if (turn > 0.5) gold = RIGHT_LEG;
    reticles = lock(["anR", "anL"], u, WALK_TURN_MS);
  } else {
    const u = Math.min(t, cam!.end) - cam!.start;
    pose = frontPose(cameraArm(u));
    if (u >= RAISE.at) gold = RIGHT_ARM;
    reticles = lock(RIGHT_ARM, u, RAISE.at);
  }
  const s0 = t - first.start;
  const cu = cam ? t - cam.start : -1;
  const camOn = cam ? 1 - step(t, cam.end, 180) : 0;
  return {
    pose,
    opacity: level(plan, t, { camera: 1, walk: 1 }),
    bones: step(s0, 90, 260),
    pop: LANDMARKS.map((_, i) => easeBack(step(s0, 30 + i * 14, 240))),
    gold,
    reticles,
    arc: {
      deg: cam ? cameraArm(Math.min(cu, cam.end - cam.start)) : ARM_REST,
      opacity: step(cu, 320, 160) * camOn,
    },
    hold: {
      at: pose.wrR,
      progress: step(cu, HOLD.at, HOLD.ms),
      opacity: step(cu, HOLD.at - 40, 100) * camOn,
      pulse: step(cu, HOLD.at + HOLD.ms, 420),
    },
  };
}

function gaitAt(plan: BuildPlan, t: number, walk?: Beat, eng?: Beat): GaitFrame | null {
  if (!walk || t < walk.start || (eng && t >= eng.start + LEVEL_MS)) return null;
  const phase = walkPhase(Math.min(t, walk.end) - walk.start);
  const x = (p: number) => NOW_X - (phase - p) * BELT;
  const bars: GaitFrame["bars"] = [];
  const steps: GaitFrame["steps"] = [];
  for (const [leg, offset] of [
    ["right", 0],
    ["left", 0.5],
  ] as const) {
    for (let n = 0; n <= Math.ceil(phase) + 1; n++) {
      const from = Math.max(0, n - offset);
      const to = Math.min(phase, n - offset + STANCE);
      if (to > from && x(to) > LANE_X0) bars.push({ leg, from: Math.max(LANE_X0, x(from)), to: x(to) });
      const landed = n - offset;
      if (landed >= 0 && landed <= phase && phase - landed < 0.45)
        steps.push({ leg, at: [x(landed), GROUND], k: (phase - landed) / 0.45 });
    }
  }
  // The last third of a stride of each ankle, as the camera tracked it (from when the walk began).
  const trails: GaitFrame["trails"] = (["right", "left"] as const).map((leg) => ({
    leg,
    points: Array.from({ length: 9 }, (_, i) => Math.max(0, phase - (8 - i) * 0.04))
      .filter((p, i, all) => i === all.length - 1 || p < all[i + 1])
      .map((p) => sidePose(p)[leg === "right" ? "anR" : "anL"]),
  }));
  return { opacity: level(plan, t, { walk: 1 }), bars, steps, trails, belt: phase * BELT };
}

interface Spark {
  from: Pt;
  via: Pt;
  delay: number;
  ms: number;
  r: number;
  gold: boolean;
}
const SPARKS = new WeakMap<BuildPlan, Spark[]>();
/** The light that flows into the core: from what was on the stage just before. */
function sparksOf(plan: BuildPlan): Spark[] {
  const known = SPARKS.get(plan);
  if (known) return known;
  const eng = beatOf(plan, "engineer")!;
  const f = frameAt(plan, eng.start - 1);
  const from: Pt[] = [];
  if (f.skeleton && f.skeleton.opacity > 0.3) for (const l of LANDMARKS) from.push(f.skeleton.pose[l]);
  if (f.gait && f.gait.opacity > 0.3)
    for (const b of f.gait.bars) {
      const y = LANES[b.leg];
      from.push([b.from, y], [(b.from + b.to) / 2, y], [b.to, y]);
    }
  if (f.records.opacity > 0.3)
    for (const c of f.records.cards)
      from.push(add(c.at, [22, 18]), add(c.at, [60, 30]), add(c.at, [80, 46]), add(c.at, [30, 48]));
  for (const j of f.joints) if (j.opacity > 0.3) from.push(j.at);
  if (f.body.opacity > 0.3 || !from.length) for (const l of LANDMARKS) from.push(FRONT[l]);
  const rand = seeded(0xa2e7);
  const sparks = Array.from({ length: 48 }, (_, i) => {
    const p = from[i % from.length];
    const start: Pt = [p[0] + (rand() - 0.5) * 12, p[1] + (rand() - 0.5) * 12];
    const mid: Pt = [(start[0] + CORE[0]) / 2, (start[1] + CORE[1]) / 2];
    // Part of a turn on the way in, all the same way round: the light swirls into the core.
    const bend = 0.32 + rand() * 0.2;
    const via: Pt = [mid[0] - (CORE[1] - start[1]) * bend, mid[1] + (CORE[0] - start[0]) * bend];
    return {
      from: start,
      via,
      delay: rand() * 300,
      ms: 400 + rand() * 220,
      r: 1.2 + rand() * 1.6,
      gold: i % 3 !== 2,
    };
  });
  SPARKS.set(plan, sparks);
  return sparks;
}

/** What the program was built from, as badges on the core: the records, the range of motion, the walk. */
export type SourceKind = "record" | "pose" | "steps";
const SOURCE: Partial<Record<BeatId, SourceKind>> = { history: "record", camera: "pose", walk: "steps" };
export const sourcesOf = (plan: BuildPlan): SourceKind[] =>
  plan.beats.flatMap((b) => (SOURCE[b.id] ? [SOURCE[b.id]!] : []));

/** The rings' turn: full speed while building, then slowing to rest by `settle`. */
function spin(u: number, speed: number) {
  const run = BEAT_MS.engineer;
  const tau = Math.min(SETTLE_MS, Math.max(0, u - run));
  return speed * (Math.min(u, run) + tau - (tau * tau) / (2 * SETTLE_MS));
}

function engineAt(plan: BuildPlan, u: number): EngineFrame {
  const sparks: EngineFrame["sparks"] = [];
  for (const s of sparksOf(plan)) {
    const k = (u - s.delay) / s.ms;
    if (k <= 0 || k >= 1) continue;
    const e = k * k;
    sparks.push({
      at: bezier(s.from, s.via, CORE, e),
      tail: [0.16, 0.1, 0.05].map((d) => bezier(s.from, s.via, CORE, Math.max(0, e - d))),
      r: s.r * (1 - 0.45 * e),
      opacity: Math.min(1, k * 5) * (1 - step(k, 0.82, 0.18)),
      gold: s.gold,
    });
  }
  const absorb = Math.exp(-(((u - 560) / 160) ** 2));
  return {
    sparks,
    core: {
      glow: easeOut(step(u, 120, 420)) * (1 + 0.22 * absorb),
      disc: easeBack(step(u, 160, 380)),
      rings: RINGS.map((_, i) => ({ scale: easeBack(step(u, 200 + i * 90, 460)), angle: spin(u, SPIN[i]) })),
      badges: sourcesOf(plan).map((kind, i, all) => ({
        kind,
        angle: -90 + (i * 360) / all.length + spin(u, SPIN[2]),
        scale: easeBack(step(u, 420 + i * 140, 380)),
      })),
      check: easeInOut(step(u, CHECK_AT, 300)),
      burst: step(u, CHECK_AT, 700),
    },
    slots: Array.from({ length: 7 }, (_, d) => {
      const k = step(u, 420 + d * 45, 300);
      return { opacity: k, lift: 1 - easeOut(k) };
    }),
    cards: plan.cards.map((_, i) => {
      const launch = CARD.at + i * CARD.gap;
      const k = step(u, launch, CARD.ms);
      const to = cardSpot(plan, i);
      const via: Pt = [lerp(CARD_FROM[0], to[0], 0.8), CARD_FROM[1] + 26];
      return {
        at: bezier(CARD_FROM, via, to, easeInOut(k)),
        scale: lerp(0.3, 1, easeBack(k)),
        angle: (1 - k) * (i % 2 ? 10 : -10),
        opacity: step(u, launch, 90),
        landed: step(u, launch + CARD.ms, 380),
      };
    }),
  };
}
