/**
 * The compensation checks of the 16 measured movements (product v7 contract 2.6, stream B, step B1) and
 * the tracker the RomRunner runs them with. Pure, no DOM.
 *
 * Each check is a code constant quoting its clinical text (rom-protocol.json movements[].compensations:
 * check, cue and invalid, which the export leaves in local-docs). Its numbers are read from the runtime
 * data (compensationDef: cueAt, invalidAt, flagAt, effect, unit, when, windowDeg, forSeconds, orInvalid,
 * orFlag; change log FZ-2: the A type CompensationCheck carries cueAt, invalidAt and cue, and the tracker
 * reads the rest from the same definition, so no number is written twice). tests/v7/b-compensations.test.ts
 * holds the ids, cues and numbers to the data and, with AZM_CLINICAL_V7, every check text to its quote.
 *
 * rom-protocol 1.1 step 7: «Compensation checks run through the attempt (section 3). A cue plays at most
 * once per attempt; an invalid attempt is coached, not stored, and repeated (up to 2 extra), then not
 * measured today (quality) as in v1.1.»
 *
 * How the tracker reads a check (engineering readings, no new clinical number):
 *   - Every per frame value passes v1's running median (RANGE_RULES.medianSec) and counts once it has held
 *     for the check's forSeconds, else v1's persistence (RANGE_RULES.persistSec): one landmark glitch never
 *     cues or invalidates an attempt (v1 SPEC-GAP frame-persistence).
 *   - «change from the start pose»: against the median of the same measure over the calibration frames,
 *     or against the calibration's own medians (RomCalibration trunkLine, segmentPx).
 *   - effect invalid: the attempt is invalid once the value passes invalidAt (at any frame, at the hold or
 *     over the window, as the check's `at` says); the cue plays at cueAt, or when the check fires.
 *   - effect flag: the cue plays when the value passes cueAt (or the flag level); the flag is read at the
 *     hold, the median of the hold window against flagAt (or cueAt when the data writes only a cue level,
 *     «> 20 degrees: knee_straight», «Flag only»).
 *   - effect log: the cue plays when the check fires; nothing is recorded.
 *   - A check the data writes with no number (the side arm raise's assisted lift and shrug) fires on v1's
 *     own reading of the words (RANGE_RULES). The forward bend's hands on the thighs reads v1's near
 *     reading from the data since the sign off (flagAt 0.25 shoulder widths, below; B1-2).
 *   - The arm raises' assisted lift and shrug count only while the arm is raised (v1: at or above
 *     RANGE_RULES.relaxedMaxDeg, the start of a lift).
 */
import type { Landmark } from "../types";
import { finitePoint, segmentDistance, visible, type Pt } from "../body";
import {
  acrossVector,
  cross,
  dot,
  downVector,
  leanFromVertical,
  median,
  norm,
  Persist,
  RunningMedian,
  sub,
} from "../modes/common";
import { RANGE_RULES } from "../modes/rangeTest";
import { SUBJECT_RULES } from "../subject";
import type { AngleContext } from "./angles";
import { cameraSide, EAR_LINE_MIN_VISIBILITY } from "./angles";
import type { CompensationCheck } from "./types";
import { ROM_DATA, compensationDef, movementDef } from "../../movements/rom";
import type {
  CompensationId,
  RomCompensationDef,
  RomMovementDef,
  RomMovementId,
  RomPositionId,
} from "../../movements/rom/types";

/* ------------------------------------------------------------------------------ geometry */

type Side = "left" | "right";
const DEG = 180 / Math.PI;
const VIS = ROM_DATA.engine.visibilityMin;

const ID = {
  ear: { left: 7, right: 8 },
  eye: { left: 2, right: 5 },
  shoulder: { left: 11, right: 12 },
  elbow: { left: 13, right: 14 },
  wrist: { left: 15, right: 16 },
  pinky: { left: 17, right: 18 },
  index: { left: 19, right: 20 },
  thumb: { left: 21, right: 22 },
  hip: { left: 23, right: 24 },
  knee: { left: 25, right: 26 },
  ankle: { left: 27, right: 28 },
  heel: { left: 29, right: 30 },
  toe: { left: 31, right: 32 },
} as const;
type Part = keyof typeof ID;

const other = (s: Side): Side => (s === "left" ? "right" : "left");
const seen = (px: Landmark[], i: number) => visible(px, i, VIS);
const at = (px: Landmark[], i: number): Pt => ({ x: px[i].x, y: px[i].y });
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/** (-180, 180] */
const wrap = (a: number) => {
  const r = ((((a + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
};
/** Direction of a vector, degrees (picture axes, y down). */
const angleOf = (v: Pt) => wrap(Math.atan2(v.y, v.x) * DEG);
/** The turn from u to v, degrees, positive where u x v is positive. */
const turnFrom = (u: Pt, v: Pt) => wrap(Math.atan2(cross(u, v), dot(u, v)) * DEG);
/** ang(u, v) of the clinical conventions, 0 to 180. */
const ang = (u: Pt, v: Pt) => Math.atan2(Math.abs(cross(u, v)), dot(u, v)) * DEG;

/** The model side of a limb movement's tested side (swapped in a mirrored picture), null without a side. */
function limbSide(ctx: AngleContext): Side | null {
  if (ctx.side === "none") return null;
  return ctx.mirrored ? other(ctx.side) : ctx.side;
}

/** A side view's side: the tested side of a limb movement, the camera side of an axial one. */
function viewSide(def: RomMovementDef, px: Landmark[], ctx: AngleContext): Side | null {
  return def.axial ? cameraSide(px) : limbSide(ctx);
}

/** One sided landmark id, or null without a side. */
const idOf = (part: Part, side: Side | null) => (side === null ? null : ID[part][side]);

/** Seen points of sided parts for one side, or null when one is not seen. */
function pts(px: Landmark[], side: Side | null, ...parts: Part[]): Pt[] | null {
  if (side === null) return null;
  const out: Pt[] = [];
  for (const p of parts) {
    const i = ID[p][side];
    if (!seen(px, i)) return null;
    out.push(at(px, i));
  }
  return out;
}

/** Which side of the line through `a` along `d` the nose is on (1 or -1), at any visibility (orientation only, as angles.ts). */
function noseSide(px: Landmark[], a: Pt, d: Pt): 1 | -1 | null {
  if (!finitePoint(px[0])) return null;
  const s = Math.sign(cross(d, sub(px[0], a)));
  return s > 0 ? 1 : s < 0 ? -1 : null;
}

/** The start trunk line (shoulder minus hip) of the calibration, or null. */
function startTrunk(ctx: AngleContext): Pt | null {
  const tl = ctx.calibration.trunkLine;
  if (!tl) return null;
  const v = sub(tl.top, tl.base);
  return norm(v) > 1e-9 ? v : null;
}

/** The side's trunk line now (shoulder minus hip), both seen. */
function trunkNow(px: Landmark[], side: Side | null): Pt | null {
  const p = pts(px, side, "shoulder", "hip");
  return p ? sub(p[0], p[1]) : null;
}

/** The trunk axis now (mid shoulder minus mid hip), all four seen. */
function trunkAxis(px: Landmark[]): Pt | null {
  if (![11, 12, 23, 24].every((i) => seen(px, i))) return null;
  return sub(mid(at(px, 11), at(px, 12)), mid(at(px, 23), at(px, 24)));
}

/**
 * The trunk line's turn from its start, toward the face positive (the side of the line the nose is on),
 * in a side view; null without the start line, the side's shoulder and hip, or the nose.
 */
function trunkForward(px: Landmark[], side: Side | null, ctx: AngleContext): number | null {
  const t0 = startTrunk(ctx);
  const t = trunkNow(px, side);
  if (!t0 || !t) return null;
  const hip = at(px, ID.hip[side!]);
  const face = noseSide(px, hip, t);
  return face === null ? null : turnFrom(t0, t) * face;
}

/** The knee flexion of one side, 180 - ang(H - K, A - K), all three seen. */
function kneeFlexion(px: Landmark[], side: Side | null): number | null {
  const p = pts(px, side, "hip", "knee", "ankle");
  return p ? 180 - ang(sub(p[0], p[1]), sub(p[2], p[1])) : null;
}

/** A body width in pixels: the start shoulder width, at least SUBJECT_RULES.minWidthPerTrunk of the start trunk (side views). */
function bodyWidth(ctx: AngleContext): number | null {
  const s = ctx.calibration.segmentPx;
  const w = Math.max(s.shoulderWidth ?? 0, SUBJECT_RULES.minWidthPerTrunk * (s.trunk ?? 0));
  return w > 1e-9 ? w : null;
}

/** A length now over the calibration's median length of that segment. */
function lengthRatio(
  len: number | null,
  seg: keyof AngleContext["calibration"]["segmentPx"],
  ctx: AngleContext,
) {
  const ref = ctx.calibration.segmentPx[seg];
  return len === null || !ref ? null : len / ref;
}

/**
 * The far wrist reaches across to the tested limb: its depth (the model's z, smaller nearer the camera)
 * is nearer the tested joint's than its own side's joint's. False without depth (every z the same).
 */
function reachesAcross(px: Landmark[], wrist: number, tested: number, own: number): boolean {
  const z = (i: number) => px[i].z;
  if (![wrist, tested, own].every((i) => Number.isFinite(z(i)))) return false;
  if (z(tested) === z(own)) return false;
  return Math.abs(z(wrist) - z(tested)) < Math.abs(z(wrist) - z(own));
}

/** Seen wrists of both sides. */
function wrists(px: Landmark[]): Pt[] {
  return [15, 16].filter((i) => seen(px, i)).map((i) => at(px, i));
}

/* ------------------------------------------------------------------------------ the checks */

/** How a frame's measure becomes the value compared with the data's numbers. */
export type Compare =
  /** The measure itself (an angle, or a ratio already against the calibration). */
  | "value"
  /** The measure minus its start value (the median over the calibration frames). */
  | "change"
  /** |measure minus its start value|. */
  | "absChange"
  /** |the turn from the start direction| for a measure that is a direction in degrees. */
  | "absAngleChange"
  /** The measure over its start value. */
  | "ratioToStart"
  /** (1 - the measure over its start value) x 100. */
  | "shrinkPct"
  /** The start value minus the measure, a decrease (the shrug). */
  | "drop";

/** When an invalid check decides: every frame, over the hold window, or over the plane window. */
export type CheckAt = "frame" | "hold" | "window";

type Measure = (px: Landmark[], ctx: AngleContext) => number | null;

export interface CompensationSpec extends CompensationCheck {
  compare: Compare;
  at: CheckAt;
  /** The positions the check applies to (default all). */
  positions?: readonly RomPositionId[];
  /** Counts only while the movement angle is at least this (the arm raises: a lift, v1 RANGE_RULES.relaxedMaxDeg). */
  whileAngleFrom?: number;
  /** The data's second criterion (orInvalid, orFlag): its measure and comparison. */
  or?: { measure: Measure; compare: Compare };
  /** The side arm raise in gravity mode (v1 4.1): its own measure and v1's numbers. */
  gravity?: { measure: Measure; compare: Compare; cueAt: number; invalidAt: number };
  /** A check the data writes with no number: the level its measure fires at, and the source of that level. */
  detect?: { at: number; when: "above" | "below"; source: string };
  /**
   * The plane window checks: the window of the movement angle and the angles that count as passing
   * through it without a qualifying frame (v1 planeFlexionFrom and planeFlexionTo for the side arm raise);
   * `practiceReference`: the ratio is against v1's practice reference length.
   */
  window?: { passFrom: number; passTo: number; practiceReference: boolean };
  /** A start value split by the line the frame reads (the head turn: ears, or eyes when hidden). */
  baselineKey?: (px: Landmark[]) => string;
}

function spec(
  movement: RomMovementId,
  id: CompensationId,
  s: Omit<CompensationSpec, "id" | "cueAt" | "invalidAt" | "cue">,
): CompensationSpec {
  const d = compensationDef(movement, id);
  return { id, cueAt: d.cueAt, invalidAt: d.invalidAt, cue: d.cue, ...s };
}

const LIFTED = RANGE_RULES.relaxedMaxDeg;
/** A measure that is 1 when the check sees its sign and 0 otherwise fires above this. */
const BOOLEAN = 0.5;

/**
 * shoulder_flexion trunk_back: «Trunk line tilt backward, change from the start pose», «> 5 degrees: cue
 * keep_back», «> 10 degrees». The side's shoulder to hip line against the start trunk line, backward (away
 * from the nose) positive. Gravity mode: the hip estimate at any visibility, as the angle reads it.
 */
const trunkBack: Measure = (px, ctx) => {
  const s = limbSide(ctx);
  if (s === null) return null;
  if (!ctx.calibration.gravityMode) {
    const f = trunkForward(px, s, ctx);
    return f === null ? null : -f;
  }
  const t0 = startTrunk(ctx);
  const S = ID.shoulder[s];
  const H = ID.hip[s];
  if (!t0 || !seen(px, S) || !finitePoint(px[H])) return null;
  const t = sub(at(px, S), at(px, H));
  const face = noseSide(px, at(px, H), t);
  return face === null ? null : -turnFrom(t0, t) * face;
};

/** The tested upper arm's pixel length, shoulder and elbow seen. */
const upperArm: Measure = (px, ctx) => {
  const p = pts(px, limbSide(ctx), "shoulder", "elbow");
  return p ? dist(p[0], p[1]) : null;
};

/** The elbow angle ang(S - E, W - E), the three seen. */
const elbowAngle: Measure = (px, ctx) => {
  const p = pts(px, limbSide(ctx), "shoulder", "elbow", "wrist");
  return p ? ang(sub(p[0], p[1]), sub(p[2], p[1])) : null;
};

/**
 * shoulder_flexion assisted: «Other wrist within 0.25 shoulder widths of the tested elbow or wrist». The
 * other side's wrist to the nearer of the tested elbow and wrist, in body widths (bodyWidth: a side view's
 * pixel shoulder width shrinks, so at least the v1 side view reading of a width).
 */
const otherWristToArm: Measure = (px, ctx) => {
  const s = limbSide(ctx);
  const w = bodyWidth(ctx);
  if (s === null || w === null) return null;
  const ow = ID.wrist[other(s)];
  const el = ID.elbow[s];
  if (!seen(px, ow) || !seen(px, el)) return null;
  const targets = [at(px, el), ...(seen(px, ID.wrist[s]) ? [at(px, ID.wrist[s])] : [])];
  return Math.min(...targets.map((p) => dist(at(px, ow), p))) / w;
};

/**
 * shoulder_abduction trunk_lean: «Trunk axis lean change from calibration». v1 4.1 exactly (rangeTest.ts
 * measure): the line from the mid hip fixed at calibration to the mid shoulder against the vertical,
 * corrected by the roll, as a change from its calibration value.
 */
const abductionLean: Measure = (px, ctx) => {
  const hip = ctx.calibration.fixedHip;
  if (!hip || !seen(px, 11) || !seen(px, 12)) return null;
  return leanFromVertical(hip, mid(at(px, 11), at(px, 12)), ctx.rollDeg ?? 0);
};

/**
 * shoulder_abduction trunk_lean in gravity mode (v1 4.1, rangeTest.ts measure): the mid shoulder's shift
 * across the picture from its calibration place, over the start shoulder width, either way.
 */
const abductionGravityShift: Measure = (px, ctx) => {
  const top = ctx.calibration.trunkLine?.top;
  const w = ctx.calibration.segmentPx.shoulderWidth;
  if (!top || !w || ctx.rollDeg === null || !seen(px, 11) || !seen(px, 12)) return null;
  return Math.abs(dot(sub(mid(at(px, 11), at(px, 12)), top), acrossVector(ctx.rollDeg))) / w;
};

/** The pixel shoulder width, both shoulders seen. */
const shoulderWidth: Measure = (px) => (seen(px, 11) && seen(px, 12) ? dist(at(px, 11), at(px, 12)) : null);

/**
 * shoulder_abduction assisted: «Other hand near the tested arm». v1 4.1 (rangeTest.ts measure, SPEC-GAP
 * assist-distance): a seen wrist or hand point of the other side within RANGE_RULES.assistShoulderWidths
 * of the start shoulder width from the tested upper arm or forearm: 1, else 0.
 */
const abductionAssist: Measure = (px, ctx) => {
  const s = limbSide(ctx);
  const w = ctx.calibration.segmentPx.shoulderWidth;
  if (s === null || !w) return null;
  const S = ID.shoulder[s];
  const E = ID.elbow[s];
  const W = ID.wrist[s];
  if (!seen(px, S) || !seen(px, E)) return null;
  const near = RANGE_RULES.assistShoulderWidths * w;
  const o = other(s);
  const hand = [ID.wrist[o], ID.pinky[o], ID.index[o], ID.thumb[o]];
  const wristSeen = seen(px, W);
  const hit = hand.some(
    (h) =>
      seen(px, h) &&
      (segmentDistance(at(px, h), at(px, S), at(px, E)) < near ||
        (wristSeen && segmentDistance(at(px, h), at(px, E), at(px, W)) < near)),
  );
  return hit ? 1 : 0;
};

/**
 * shoulder_abduction shrug: «Ear to shoulder distance over resting shoulder width», shoulder_down
 * «(logging and coaching only)», invalid «never». v1 4.1 (rangeTest.ts measure): the tested side's ear to shoulder
 * distance over the start shoulder width; its drop from the start fires at RANGE_RULES.shrugCue.
 */
const earToShoulder: Measure = (px, ctx) => {
  const s = limbSide(ctx);
  const w = ctx.calibration.segmentPx.shoulderWidth;
  if (s === null || !w || !seen(px, ID.ear[s]) || !seen(px, ID.shoulder[s])) return null;
  return dist(at(px, ID.ear[s]), at(px, ID.shoulder[s])) / w;
};

/** The upper arm's direction in the picture (shoulder to elbow), degrees. */
const upperArmDirection: Measure = (px, ctx) => {
  const p = pts(px, limbSide(ctx), "shoulder", "elbow");
  return p ? angleOf(sub(p[1], p[0])) : null;
};

/** The forearm's pixel length over its start length. */
const forearmRatio: Measure = (px, ctx) => {
  const p = pts(px, limbSide(ctx), "elbow", "wrist");
  return lengthRatio(p ? dist(p[0], p[1]) : null, "forearm", ctx);
};

/** The side's trunk line direction (hip to shoulder), degrees. */
const trunkDirection =
  (def: () => RomMovementDef): Measure =>
  (px, ctx) => {
    const t = trunkNow(px, viewSide(def(), px, ctx));
    return t ? angleOf(t) : null;
  };

/** The trunk axis direction (mid hip to mid shoulder), degrees. */
const trunkAxisDirection: Measure = (px) => {
  const t = trunkAxis(px);
  return t ? angleOf(t) : null;
};

/** The thigh's pixel length over its start length. */
const thighRatio: Measure = (px, ctx) => {
  const p = pts(px, limbSide(ctx), "hip", "knee");
  return lengthRatio(p ? dist(p[0], p[1]) : null, "thigh", ctx);
};

/** The shank's pixel length over its start length. */
const shankRatio: Measure = (px, ctx) => {
  const p = pts(px, limbSide(ctx), "knee", "ankle");
  return lengthRatio(p ? dist(p[0], p[1]) : null, "shank", ctx);
};

/** The hip line's direction (23 to 24), degrees. */
const hipLine: Measure = (px) => (seen(px, 23) && seen(px, 24) ? angleOf(sub(at(px, 24), at(px, 23))) : null);

/** The shoulder line's direction (11 to 12), degrees. */
const shoulderLine: Measure = (px) =>
  seen(px, 11) && seen(px, 12) ? angleOf(sub(at(px, 12), at(px, 11))) : null;

/* The checks of each movement, in the data's order. */

const movement = (id: RomMovementId) => () => movementDef(id);

export const COMPENSATIONS: Record<RomMovementId, CompensationSpec[]> = {
  shoulder_flexion: [
    spec("shoulder_flexion", "trunk_back", { measure: trunkBack, compare: "value", at: "frame" }),
    // plane: «Upper arm pixel length in the 70 to 110 degree window, against the calibration length»,
    // «< 0.85 for the whole window (lift drifted toward the side)»: no frame of the window at 0.85 or more.
    spec("shoulder_flexion", "plane", {
      measure: (px, ctx) => lengthRatio(upperArm(px, ctx), "upperArm", ctx),
      compare: "value",
      at: "window",
      window: { passFrom: 70, passTo: 110, practiceReference: false },
    }),
    // bent_elbow: «Elbow angle ang(S - E, W - E)», «Flag only below 150 degrees (bentElbow; allowed where
    // spasticity needs it, then kept the same)».
    spec("shoulder_flexion", "bent_elbow", { measure: elbowAngle, compare: "value", at: "hold" }),
    spec("shoulder_flexion", "assisted", {
      measure: otherWristToArm,
      compare: "value",
      at: "frame",
      whileAngleFrom: LIFTED,
    }),
  ],
  shoulder_abduction: [
    spec("shoulder_abduction", "trunk_lean", {
      measure: abductionLean,
      compare: "absChange",
      at: "frame",
      gravity: {
        measure: abductionGravityShift,
        compare: "value",
        cueAt: RANGE_RULES.gravityLeanCue,
        invalidAt: RANGE_RULES.gravityLeanInvalid,
      },
    }),
    // plane: «Upper arm pixel length >= 0.85 of reference for 0.3 s within 70 to 110 degrees», «no such
    // frames (plane_flexion)»: v1 4.1, the reference from the practice lift, the pass from below 60 to
    // above 120 without a qualifying frame (RANGE_RULES.planeFlexionFrom and planeFlexionTo).
    spec("shoulder_abduction", "plane", {
      measure: upperArm,
      compare: "value",
      at: "window",
      window: {
        passFrom: RANGE_RULES.planeFlexionFrom,
        passTo: RANGE_RULES.planeFlexionTo,
        practiceReference: true,
      },
    }),
    // trunk_rotation: «Shoulder width shrink», «> 15%».
    spec("shoulder_abduction", "trunk_rotation", {
      measure: shoulderWidth,
      compare: "shrinkPct",
      at: "frame",
    }),
    spec("shoulder_abduction", "assisted", {
      measure: abductionAssist,
      compare: "value",
      at: "frame",
      whileAngleFrom: LIFTED,
      detect: { at: BOOLEAN, when: "above", source: "v1 RANGE_RULES.assistShoulderWidths" },
    }),
    // bent_elbow: «Elbow angle», «Flag only below 150 degrees».
    spec("shoulder_abduction", "bent_elbow", { measure: elbowAngle, compare: "value", at: "hold" }),
    spec("shoulder_abduction", "shrug", {
      measure: earToShoulder,
      compare: "drop",
      at: "frame",
      whileAngleFrom: LIFTED,
      detect: { at: RANGE_RULES.shrugCue, when: "above", source: "v1 RANGE_RULES.shrugCue" },
    }),
  ],
  shoulder_extension: [
    // trunk_forward: «Trunk line forward tilt, change from start», «> 5 degrees: no_lean», «> 10 degrees».
    spec("shoulder_extension", "trunk_forward", {
      measure: (px, ctx) => trunkForward(px, limbSide(ctx), ctx),
      compare: "value",
      at: "frame",
    }),
    // plane: «Upper arm pixel length at the end range against calibration», «< 0.85».
    spec("shoulder_extension", "plane", {
      measure: (px, ctx) => lengthRatio(upperArm(px, ctx), "upperArm", ctx),
      compare: "value",
      at: "hold",
    }),
    // bent_elbow: «Elbow angle», «Flag only below 150 degrees».
    spec("shoulder_extension", "bent_elbow", { measure: elbowAngle, compare: "value", at: "hold" }),
  ],
  elbow_extension: [
    // upper_arm_moves: «Upper arm angle from vertical, change from start», «> 10 degrees: elbow_by_side»,
    // «> 20 degrees».
    spec("elbow_extension", "upper_arm_moves", {
      measure: upperArmDirection,
      compare: "absAngleChange",
      at: "frame",
    }),
    // forearm_plane: «Forearm pixel length against calibration», «< 0.85 (forearm turned out of the image plane)».
    spec("elbow_extension", "forearm_plane", { measure: forearmRatio, compare: "value", at: "frame" }),
    // trunk: «Trunk line change», «> 10 degrees».
    spec("elbow_extension", "trunk", {
      measure: trunkDirection(movement("elbow_extension")),
      compare: "absAngleChange",
      at: "frame",
    }),
  ],
  elbow_flexion: [
    spec("elbow_flexion", "upper_arm_moves", {
      measure: upperArmDirection,
      compare: "absAngleChange",
      at: "frame",
    }),
    // forearm_plane: «Forearm pixel length against calibration», «< 0.85».
    spec("elbow_flexion", "forearm_plane", { measure: forearmRatio, compare: "value", at: "frame" }),
  ],
  hip_flexion: [
    // assisted: «A wrist within 0.3 thigh lengths of the tested knee at the end range», «yes (active range only)».
    // The tested side's wrist, and the other wrist only when it is on the near side of the body: in
    // the side view the far knee lies on the tested knee in the picture, so a far hand resting on the
    // far knee (a common way to sit) reads as «a wrist at the tested knee» whenever the lift is small.
    // The other wrist counts when its depth is nearer the tested knee's than its own knee's (a hand
    // reaching across to pull the tested knee); without depth it is left out (wave 2 fix, engine
    // review 6; contract gap W2-7).
    spec("hip_flexion", "assisted", {
      measure: (px, ctx) => {
        const s = limbSide(ctx);
        const thigh = ctx.calibration.segmentPx.thigh;
        if (s === null || !thigh || !seen(px, ID.knee[s])) return null;
        const knee = at(px, ID.knee[s]);
        const near: Pt[] = seen(px, ID.wrist[s]) ? [at(px, ID.wrist[s])] : [];
        const o = other(s);
        if (
          seen(px, ID.wrist[o]) &&
          seen(px, ID.knee[o]) &&
          reachesAcross(px, ID.wrist[o], ID.knee[s], ID.knee[o])
        )
          near.push(at(px, ID.wrist[o]));
        if (!near.length) return null;
        return Math.min(...near.map((p) => dist(p, knee))) / thigh;
      },
      compare: "value",
      at: "hold",
    }),
    // trunk_lift: «Trunk line angle change (shoulders lifting)», «> 10 degrees».
    spec("hip_flexion", "trunk_lift", {
      measure: trunkDirection(movement("hip_flexion")),
      compare: "absAngleChange",
      at: "frame",
    }),
    // other_leg: «Other thigh against trunk line, change from start», «> 10 degrees (invalid: pelvic tilt is
    // the main confound)». The other knee against the tested hip and shoulder (the two hips meet in a side view).
    spec("hip_flexion", "other_leg", {
      measure: (px, ctx) => {
        const s = limbSide(ctx);
        const p = pts(px, s, "hip", "shoulder");
        const k = idOf("knee", s === null ? null : other(s));
        if (!p || k === null || !seen(px, k)) return null;
        return 180 - ang(sub(at(px, k), p[0]), sub(p[1], p[0]));
      },
      compare: "absChange",
      at: "frame",
    }),
    // plane: «Thigh pixel length against calibration», «< 0.85 (knee fell outward)».
    spec("hip_flexion", "plane", { measure: thighRatio, compare: "value", at: "frame" }),
  ],
  hip_extension: [
    // trunk_tilt: «Trunk line tilt, forward or backward, change from start», «> 5 degrees: no_lean», «> 10 degrees».
    spec("hip_extension", "trunk_tilt", {
      measure: trunkDirection(movement("hip_extension")),
      compare: "absAngleChange",
      at: "frame",
    }),
    // knee_bend: «Tested knee flexion 180 - ang(H - K, A - K)», «> 20 degrees: knee_straight», «Flag only».
    spec("hip_extension", "knee_bend", {
      measure: (px, ctx) => kneeFlexion(px, limbSide(ctx)),
      compare: "value",
      at: "hold",
    }),
    // stance_knee: «Standing knee flexion», «Flag above 15 degrees».
    spec("hip_extension", "stance_knee", {
      measure: (px, ctx) => {
        const s = limbSide(ctx);
        return s === null ? null : kneeFlexion(px, other(s));
      },
      compare: "value",
      at: "hold",
    }),
    // plane: «Thigh pixel length against calibration», «< 0.85».
    spec("hip_extension", "plane", { measure: thighRatio, compare: "value", at: "frame" }),
  ],
  hip_abduction: [
    // trunk_lean: «Trunk axis (MH to MS) lean change from start», «> 5 degrees: no_lean», «> 10 degrees».
    spec("hip_abduction", "trunk_lean", {
      measure: trunkAxisDirection,
      compare: "absAngleChange",
      at: "frame",
    }),
    // hip_hike: «Hip line tilt change», «> 5 degrees: hips_level», «Flag only (the angle is measured against the hip line)».
    spec("hip_abduction", "hip_hike", { measure: hipLine, compare: "absAngleChange", at: "hold" }),
    // plane: «Thigh pixel length against calibration (forward swing shortens it)», «< 0.85».
    spec("hip_abduction", "plane", { measure: thighRatio, compare: "value", at: "frame" }),
  ],
  knee_flexion: [
    // assisted: «A wrist within 0.3 shank lengths of the tested ankle or knee», «yes». Read at the end range,
    // as the hip bend's (a hand pulls the heel in at the end; a hand resting by the hip lies near the
    // ankle in a side view only there).
    spec("knee_flexion", "assisted", {
      measure: (px, ctx) => {
        const s = limbSide(ctx);
        const shank = ctx.calibration.segmentPx.shank;
        const w = wrists(px);
        if (s === null || !shank || !w.length) return null;
        const targets = [ID.ankle[s], ID.knee[s]].filter((i) => seen(px, i)).map((i) => at(px, i));
        if (!targets.length) return null;
        return Math.min(...w.flatMap((p) => targets.map((q) => dist(p, q)))) / shank;
      },
      compare: "value",
      at: "hold",
    }),
    // plane: «Thigh and shank pixel lengths against calibration», «< 0.85 (knee fell sideways)».
    spec("knee_flexion", "plane", {
      measure: (px, ctx) => {
        const a = thighRatio(px, ctx);
        const b = shankRatio(px, ctx);
        return a === null || b === null ? null : Math.min(a, b);
      },
      compare: "value",
      at: "frame",
    }),
  ],
  knee_extension: [
    // plane: «Shank pixel length against calibration», «< 0.85 (leg rolled)».
    spec("knee_extension", "plane", { measure: shankRatio, compare: "value", at: "frame" }),
    // seated_lean_back: «Seated only: trunk line backward tilt change», «> 5 degrees: no_lean», «> 10 degrees».
    // Backward is away from the knee (in front of the trunk when seated).
    spec("knee_extension", "seated_lean_back", {
      measure: (px, ctx) => {
        const s = limbSide(ctx);
        const t0 = startTrunk(ctx);
        const t = trunkNow(px, s);
        if (!t0 || !t || s === null || !seen(px, ID.knee[s])) return null;
        const front = Math.sign(cross(t, sub(at(px, ID.knee[s]), at(px, ID.hip[s]))));
        return front === 0 ? null : -turnFrom(t0, t) * front;
      },
      compare: "value",
      at: "frame",
      positions: ["seated"],
    }),
  ],
  ankle_dorsiflexion_lunge: [
    // heel_lift: «Heel landmark rise from calibration as a share of shank length, or the heel to foot index
    // pitch change», «> 0.06 shank lengths for 0.3 s or more, or pitch change > 5 degrees (attempt rejected)».
    // The rise along true up (the phone roll), over the start shank length.
    spec("ankle_dorsiflexion_lunge", "heel_lift", {
      measure: (px, ctx) => {
        const s = limbSide(ctx);
        const shank = ctx.calibration.segmentPx.shank;
        if (s === null || !shank || !seen(px, ID.heel[s])) return null;
        const down = downVector(ctx.rollDeg ?? 0);
        return -dot(at(px, ID.heel[s]), down) / shank;
      },
      compare: "change",
      at: "frame",
      or: {
        measure: (px, ctx) => {
          const p = pts(px, limbSide(ctx), "heel", "toe");
          return p ? angleOf(sub(p[1], p[0])) : null;
        },
        compare: "absAngleChange",
      },
    }),
    // foot_turn: «Heel to foot index pixel length against calibration», «< 0.8 (foot turned out)».
    spec("ankle_dorsiflexion_lunge", "foot_turn", {
      measure: (px, ctx) => {
        const p = pts(px, limbSide(ctx), "heel", "toe");
        return p ? dist(p[0], p[1]) : null;
      },
      compare: "ratioToStart",
      at: "frame",
    }),
    // knee_plane: «Shank pixel length against calibration», «< 0.85 (knee drifted in or out)».
    spec("ankle_dorsiflexion_lunge", "knee_plane", { measure: shankRatio, compare: "value", at: "frame" }),
  ],
  trunk_lateral_flexion: [
    // trunk_rotation: «Shoulder width shrink against calibration», «> 15%».
    spec("trunk_lateral_flexion", "trunk_rotation", {
      measure: shoulderWidth,
      compare: "shrinkPct",
      at: "frame",
    }),
    // knee_bend: «Either knee flexion (standing)», «> 15 degrees».
    spec("trunk_lateral_flexion", "knee_bend", {
      measure: (px) => {
        const k = [kneeFlexion(px, "left"), kneeFlexion(px, "right")].filter((x): x is number => x !== null);
        return k.length ? Math.max(...k) : null;
      },
      compare: "value",
      at: "frame",
      positions: ["standing"],
    }),
    // pelvis_shift: «Hip line tilt change; mid hip sideways shift», «Flag above 5 degrees or 0.25 shoulder widths».
    spec("trunk_lateral_flexion", "pelvis_shift", {
      measure: hipLine,
      compare: "absAngleChange",
      at: "hold",
      or: {
        measure: (px, ctx) => {
          const w = ctx.calibration.segmentPx.shoulderWidth;
          if (!w || !seen(px, 23) || !seen(px, 24)) return null;
          return dot(mid(at(px, 23), at(px, 24)), acrossVector(ctx.rollDeg ?? 0)) / w;
        },
        compare: "absChange",
      },
    }),
  ],
  trunk_flexion: [
    // knee_bend: «Knee flexion 180 - ang(H - K, A - K)», «> 15 degrees». Standing only: seated knees are bent.
    spec("trunk_flexion", "knee_bend", {
      measure: (px) => kneeFlexion(px, cameraSide(px)),
      compare: "value",
      at: "frame",
      positions: ["standing_supported"],
    }),
    // hands_support: «Wrist resting on the thigh or knee», «Flag only». The nearer wrist's distance to the
    // camera side's thigh (hip to knee), in body widths; the data writes v1's near reading, flagAt 0.25
    // shoulder widths, when below (B1-2, D-026 item 4), and the tracker reads both from there.
    spec("trunk_flexion", "hands_support", {
      measure: (px, ctx) => {
        const s = cameraSide(px);
        const w = bodyWidth(ctx);
        const p = pts(px, s, "hip", "knee");
        const ws = wrists(px);
        if (!p || w === null || !ws.length) return null;
        return Math.min(...ws.map((q) => segmentDistance(q, p[0], p[1]))) / w;
      },
      compare: "value",
      at: "hold",
    }),
  ],
  neck_lateral_flexion: [
    // shoulder_hike: «Shoulder line tilt change», «> 5 degrees: shoulder_down», «> 10 degrees».
    spec("neck_lateral_flexion", "shoulder_hike", {
      measure: shoulderLine,
      compare: "absAngleChange",
      at: "frame",
    }),
    // head_turn: «Nose x offset from the ear midpoint, change as a share of ear distance», «> 0.15». The
    // offset along the ear line (the head's own left to right, so the measured tilt does not move it); the
    // eye line where an ear is hidden (the angle's own fallback), each against its own start value.
    spec("neck_lateral_flexion", "head_turn", {
      measure: (px) => {
        if (!seen(px, 0)) return null;
        const ears = visible(px, 7, EAR_LINE_MIN_VISIBILITY) && visible(px, 8, EAR_LINE_MIN_VISIBILITY);
        const [a, b] = ears ? [7, 8] : [2, 5];
        if (!ears && !(seen(px, a) && seen(px, b))) return null;
        const line = sub(at(px, b), at(px, a));
        const d = norm(line);
        if (d < 1e-9) return null;
        return dot(sub(at(px, 0), mid(at(px, a), at(px, b))), line) / (d * d);
      },
      compare: "absChange",
      at: "frame",
      baselineKey: (px) =>
        visible(px, 7, EAR_LINE_MIN_VISIBILITY) && visible(px, 8, EAR_LINE_MIN_VISIBILITY) ? "ears" : "eyes",
    }),
    // trunk_lean: «Trunk axis lean change», «> 5 degrees: no_lean», «> 10 degrees».
    spec("neck_lateral_flexion", "trunk_lean", {
      measure: trunkAxisDirection,
      compare: "absAngleChange",
      at: "frame",
    }),
  ],
  neck_flexion: [
    // trunk: «Trunk line change (subtracted, and also checked)», «> 5 degrees: keep_back», «> 10 degrees».
    spec("neck_flexion", "trunk", {
      measure: trunkDirection(movement("neck_flexion")),
      compare: "absAngleChange",
      at: "frame",
    }),
  ],
  neck_extension: [
    // trunk: «Trunk line backward change», «> 5 degrees: keep_back», «> 10 degrees». Backward: away from the nose.
    spec("neck_extension", "trunk", {
      measure: (px, ctx) => {
        const f = trunkForward(px, cameraSide(px), ctx);
        return f === null ? null : -f;
      },
      compare: "value",
      at: "frame",
    }),
  ],
};

/* ------------------------------------------------------------------------------ the tracker */

/** A level a check reached in an attempt (each check reaches each level at most once per attempt). */
export interface CompensationHit {
  id: CompensationId;
  level: "cue" | "invalid";
  /** The compared value (degrees, a ratio, a share or a percent, as the data's unit). */
  value: number;
  /** The line to play, null when the check has none. */
  cue: CompensationCheck["cue"];
  t: number;
}

/** What the checks read at the hold, over the hold window. */
export interface HoldVerdict {
  /** Checks that make the attempt invalid (frame, hold and window checks so far). */
  invalid: CompensationId[];
  /** Flag only checks that held over the hold window (bent_elbow is the RomFlag bentElbow). */
  flagged: CompensationId[];
  /** Lines of checks that fired at the hold. */
  hits: CompensationHit[];
}

export interface TrackerFrame {
  t: number;
  /** The subject's pixel space landmarks. */
  px: Landmark[];
  ctx: AngleContext;
  /** The movement angle of the frame, or null. */
  angle: number | null;
}

interface CheckState {
  spec: CompensationSpec;
  def: RomCompensationDef;
  /** Start values, by baseline key. */
  start: Map<string, number>;
  orStart: Map<string, number>;
  med: RunningMedian;
  orMed: RunningMedian;
  cuePersist: Persist;
  invalidPersist: Persist;
  /** The compared values of this attempt (for the hold window medians). */
  samples: { t: number; v: number | null; or: number | null }[];
  said: boolean;
  invalid: boolean;
  /** Plane window: qualifying seconds, any qualifying frame, below the pass start, longest length in the window. */
  okSec: number;
  okAny: boolean;
  below: boolean;
  lastT: number | null;
  windowMaxLen: number;
}

const valueOf = (c: Compare, m: number, start: number | undefined): number | null => {
  switch (c) {
    case "value":
      return m;
    case "change":
      return start === undefined ? null : m - start;
    case "absChange":
      return start === undefined ? null : Math.abs(m - start);
    case "absAngleChange":
      return start === undefined ? null : Math.abs(wrap(m - start));
    case "ratioToStart":
      return start === undefined || start <= 1e-9 ? null : m / start;
    case "shrinkPct":
      return start === undefined || start <= 1e-9 ? null : (1 - m / start) * 100;
    case "drop":
      return start === undefined ? null : start - m;
  }
};

const needsStart = (c: Compare) => c !== "value";

/** The angle median of directions (unwrapped around the first), or the plain median. */
function startOf(c: Compare, xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  if (c !== "absAngleChange") return median(xs) ?? undefined;
  const ref = xs[0];
  return wrap(median(xs.map((a) => ref + wrap(a - ref)))!);
}

/**
 * Runs the checks of one movement through the attempts (rom-protocol 1.1 step 7): the start values from
 * the calibration frames, the per frame levels with v1's median and persistence, the plane window, and
 * the checks read over the hold window.
 */
export class CompensationTracker {
  readonly specs: CompensationSpec[];
  private states: CheckState[];
  private gravity = false;
  /** v1's practice reference length of the side arm raise's plane check (pixels), once the practice ended. */
  private reference: number | null = null;
  private calibrationUpperArm: number | null = null;
  private practice = false;

  constructor(
    readonly def: RomMovementDef,
    readonly position: RomPositionId,
  ) {
    this.specs = COMPENSATIONS[def.id].filter((s) => !s.positions || s.positions.includes(position));
    this.states = this.specs.map((spec) => {
      const d = compensationDef(def.id, spec.id);
      const sec = d.forSeconds ?? RANGE_RULES.persistSec;
      return {
        spec,
        def: d,
        start: new Map(),
        orStart: new Map(),
        med: new RunningMedian(RANGE_RULES.medianSec * 1000),
        orMed: new RunningMedian(RANGE_RULES.medianSec * 1000),
        cuePersist: new Persist(sec),
        invalidPersist: new Persist(sec),
        samples: [],
        said: false,
        invalid: false,
        okSec: 0,
        okAny: false,
        below: false,
        lastT: null,
        windowMaxLen: 0,
      };
    });
  }

  /** The start values over the calibration frames (the still second the runner calibrated on). */
  calibrate(frames: { px: Landmark[] }[], ctx: AngleContext): void {
    this.gravity = ctx.calibration.gravityMode;
    this.calibrationUpperArm = ctx.calibration.segmentPx.upperArm ?? null;
    for (const st of this.states) {
      const { measure, compare } = this.active(st.spec);
      st.start = new Map();
      st.orStart = new Map();
      const keyOf = st.spec.baselineKey ?? (() => "");
      const groups = new Map<string, number[]>();
      const orGroups = new Map<string, number[]>();
      for (const { px } of frames) {
        const k = keyOf(px);
        const m = measure(px, ctx);
        if (m !== null && Number.isFinite(m)) groups.set(k, [...(groups.get(k) ?? []), m]);
        const o = st.spec.or?.measure(px, ctx) ?? null;
        if (o !== null && Number.isFinite(o)) orGroups.set(k, [...(orGroups.get(k) ?? []), o]);
      }
      if (needsStart(compare))
        for (const [k, xs] of groups) {
          const s = startOf(compare, xs);
          if (s !== undefined) st.start.set(k, s);
        }
      if (st.spec.or && needsStart(st.spec.or.compare))
        for (const [k, xs] of orGroups) {
          const s = startOf(st.spec.or.compare, xs);
          if (s !== undefined) st.orStart.set(k, s);
        }
    }
  }

  /** A new attempt: every check may cue and fire again (rom-protocol 1.1: a cue at most once per attempt). */
  startAttempt(practice: boolean): void {
    this.practice = practice;
    for (const st of this.states) {
      st.med.reset();
      st.orMed.reset();
      st.cuePersist.reset();
      st.invalidPersist.reset();
      st.samples = [];
      st.said = false;
      st.invalid = false;
      st.okSec = 0;
      st.okAny = false;
      st.below = false;
      st.lastT = null;
      st.windowMaxLen = 0;
    }
  }

  /** The practice lift ended: v1's reference length for the side arm raise's plane check. */
  endPractice(): void {
    for (const st of this.states) {
      if (!st.spec.window?.practiceReference || this.calibrationUpperArm === null) continue;
      this.reference = Math.max(this.calibrationUpperArm, st.windowMaxLen);
    }
  }

  /** The checks that made this attempt invalid so far. */
  get invalid(): CompensationId[] {
    return this.states.filter((s) => s.invalid).map((s) => s.spec.id);
  }

  /** The measure, comparison and cue and invalid levels in force (gravity mode of the side arm raise). */
  private active(spec: CompensationSpec): {
    measure: Measure;
    compare: Compare;
    cueAt: number | null;
    invalidAt: number | null;
  } {
    if (this.gravity && spec.gravity) return spec.gravity;
    return { measure: spec.measure, compare: spec.compare, cueAt: spec.cueAt, invalidAt: spec.invalidAt };
  }

  private when(st: CheckState): "above" | "below" {
    return st.spec.detect?.when ?? st.def.when ?? "above";
  }

  private passes(st: CheckState, v: number, level: number): boolean {
    return this.when(st) === "below" ? v < level : v > level;
  }

  /** The level the cue plays at: cueAt, else the level the check fires at. */
  private cueLevel(st: CheckState, a: ReturnType<CompensationTracker["active"]>): number | null {
    if (a.cueAt !== null) return a.cueAt;
    return this.fireLevel(st, a);
  }

  /** The level the check fires at: invalidAt (invalid), flagAt else cueAt (flag), or the detect level. */
  private fireLevel(st: CheckState, a: ReturnType<CompensationTracker["active"]>): number | null {
    if (st.spec.detect) return st.spec.detect.at;
    if (st.def.effect === "invalid") return a.invalidAt;
    if (st.def.effect === "flag") return st.def.flagAt ?? a.cueAt;
    return null;
  }

  /** The second criterion's level for the check's effect (orInvalid, orFlag). */
  private orLevel(st: CheckState): number | null {
    return st.def.orInvalid?.at ?? st.def.orFlag?.at ?? null;
  }

  /** One frame of an attempt: the levels reached now (each at most once per attempt). */
  frame(f: TrackerFrame): CompensationHit[] {
    const hits: CompensationHit[] = [];
    for (const st of this.states) {
      const a = this.active(st.spec);
      const key = (st.spec.baselineKey ?? (() => ""))(f.px);
      const lifted =
        st.spec.whileAngleFrom === undefined || (f.angle !== null && f.angle >= st.spec.whileAngleFrom);
      const m = lifted ? a.measure(f.px, f.ctx) : null;
      let v = m === null || !Number.isFinite(m) ? null : valueOf(a.compare, m, st.start.get(key));
      if (v !== null) v = st.med.push(f.t, v);
      else st.med.reset();
      let o: number | null = null;
      if (st.spec.or) {
        const om = lifted ? st.spec.or.measure(f.px, f.ctx) : null;
        o = om === null || !Number.isFinite(om) ? null : valueOf(st.spec.or.compare, om, st.orStart.get(key));
        if (o !== null) o = st.orMed.push(f.t, o);
        else st.orMed.reset();
      }
      st.samples.push({ t: f.t, v, or: o });
      if (st.spec.at === "window") {
        this.windowFrame(st, f, v, hits);
        continue;
      }
      const cueLevel = this.cueLevel(st, a);
      const orLevel = this.orLevel(st);
      const over = (x: number | null, level: number | null) =>
        x !== null && level !== null && this.passes(st, x, level);
      const orOver = o !== null && orLevel !== null && o > orLevel;
      if (st.cuePersist.update(f.t, over(v, cueLevel) || orOver) && !st.said && st.spec.cue !== null) {
        if (st.spec.at !== "hold" || st.def.effect !== "invalid") {
          st.said = true;
          hits.push({ id: st.spec.id, level: "cue", value: v ?? o ?? 0, cue: st.spec.cue, t: f.t });
        }
      }
      if (st.spec.at === "frame" && st.def.effect === "invalid" && !st.invalid) {
        const level = this.fireLevel(st, a);
        if (st.invalidPersist.update(f.t, over(v, level) || orOver)) {
          st.invalid = true;
          if (!st.said && st.spec.cue !== null) {
            st.said = true;
            hits.push({ id: st.spec.id, level: "cue", value: v ?? o ?? 0, cue: st.spec.cue, t: f.t });
          }
          hits.push({ id: st.spec.id, level: "invalid", value: v ?? o ?? 0, cue: st.spec.cue, t: f.t });
        }
      }
    }
    return hits;
  }

  /** The plane window: qualifying frames inside it, and the pass through it without one. */
  private windowFrame(st: CheckState, f: TrackerFrame, v: number | null, hits: CompensationHit[]): void {
    const w = st.spec.window!;
    const win = st.def.windowDeg ?? [w.passFrom, w.passTo];
    const level = st.def.invalidAt;
    const angle = f.angle;
    if (angle === null || v === null || level === null) {
      st.lastT = null;
      return;
    }
    const ratio = w.practiceReference
      ? v /
        (this.practice ? (this.calibrationUpperArm ?? v) : (this.reference ?? this.calibrationUpperArm ?? v))
      : v;
    const inWindow = angle >= win[0] && angle <= win[1];
    if (inWindow) st.windowMaxLen = Math.max(st.windowMaxLen, v);
    if (angle < w.passFrom) st.below = true;
    if (inWindow && ratio >= level) {
      st.okAny = true;
      if (st.lastT !== null && f.t - st.lastT <= RANGE_RULES.maxGapMs) st.okSec += (f.t - st.lastT) / 1000;
    }
    st.lastT = f.t;
    if (!st.invalid && st.below && angle > w.passTo && !st.okAny) {
      st.invalid = true;
      if (!st.said && st.spec.cue !== null) {
        st.said = true;
        hits.push({ id: st.spec.id, level: "cue", value: ratio, cue: st.spec.cue, t: f.t });
      }
      hits.push({ id: st.spec.id, level: "invalid", value: ratio, cue: st.spec.cue, t: f.t });
    }
  }

  /** The checks read at the hold, over the hold window [from, to], with the hold's angle. */
  atHold(from: number, to: number, holdDeg: number): HoldVerdict {
    const hits: CompensationHit[] = [];
    const flagged: CompensationId[] = [];
    for (const st of this.states) {
      const a = this.active(st.spec);
      const inHold = st.samples.filter((s) => s.t >= from && s.t <= to);
      const v = median(inHold.map((s) => s.v).filter((x): x is number => x !== null));
      const o = median(inHold.map((s) => s.or).filter((x): x is number => x !== null));
      const orLevel = this.orLevel(st);
      const fire = (x: number | null, level: number | null) =>
        x !== null && level !== null && this.passes(st, x, level);
      const fired = fire(v, this.fireLevel(st, a)) || (o !== null && orLevel !== null && o > orLevel);
      if (st.spec.at === "window") {
        const win = st.def.windowDeg ?? [st.spec.window!.passFrom, st.spec.window!.passTo];
        const need = st.def.forSeconds ?? 0;
        const short = need > 0 ? st.okSec < need : !st.okAny;
        if (!st.invalid && holdDeg >= win[0] && short) {
          st.invalid = true;
          this.hitAtHold(st, v ?? 0, to, hits);
        }
        continue;
      }
      if (st.def.effect === "invalid" && st.spec.at === "hold" && fired && !st.invalid) {
        st.invalid = true;
        this.hitAtHold(st, v ?? o ?? 0, to, hits);
      }
      if (st.def.effect === "flag" && fired) flagged.push(st.spec.id);
    }
    return { invalid: this.invalid, flagged, hits };
  }

  private hitAtHold(st: CheckState, value: number, t: number, hits: CompensationHit[]): void {
    if (!st.said && st.spec.cue !== null) {
      st.said = true;
      hits.push({ id: st.spec.id, level: "cue", value, cue: st.spec.cue, t });
    }
    hits.push({ id: st.spec.id, level: "invalid", value, cue: st.spec.cue, t });
  }
}

/** The movement's checks that apply in a position (for tests and the controller). */
export function checksFor(movementId: RomMovementId, position: RomPositionId): CompensationSpec[] {
  return COMPENSATIONS[movementId].filter((s) => !s.positions || s.positions.includes(position));
}
