/**
 * Quality gate v2 for the movement check (architecture section 5, contract v2 section F, spec 4.0).
 * Pure TS, no DOM.
 *
 * `QualityMonitor` watches one attempt and says whether it can be scored:
 *   - gate landmarks of the test (per side) at the test's minVisibility in at least 90 percent of
 *     frames; optional landmarks never fail an attempt, their visible share is only reported, so a
 *     flag that needs them can be stored as unknown;
 *   - window gate landmarks (hips in the abduction calibration in trunk reference mode, hips in the
 *     side lean's upright window) only in the frames the runner marks as window frames;
 *   - the view (front, side, oblique or unknown, from pixel space shoulder width ÷ trunk length)
 *     is one the test accepts;
 *   - gate landmarks inside a 3 percent margin;
 *   - median fps at or above the floor of the test kind (12 for the range test and the side lean,
 *     20 for the timed tests, CHECK_DATA.engine.model.minFps);
 *   - paused frames of the subject lock at most 10 percent, and no touch by a second person;
 *   - the distance proxy (trunk length ÷ frame height) inside the test's setup distance.
 * Each issue maps to one retry cue of the check data (`retryCue`).
 *
 * `setupCheck` is the live check before recording starts (spec 4.0): one person in the chair (a
 * helper at the side is fine), framing, distance, the view, light (a proxy from landmark
 * visibility) and, when the device reports its orientation, the phone level within 5 degrees.
 */
import { CHECK_DATA, cueLine } from "../movements/assessments";
import type { CheckCueId, CueLine, TestDef, TestId } from "../movements/types";
import {
  armPx,
  isPerson,
  overlapShare,
  poseBox,
  shoulderPx,
  trunkPx,
  upperArmPx,
  VIEW_RATIO,
  visible,
} from "./body";
import { effectiveAspect, toPixelSpace } from "./geometry";
import { nearestCentre, SUBJECT_RULES, type SubjectPick } from "./subject";
import { Frame, Landmark, LM } from "./types";

export { VIEW_RATIO } from "./body";

export type ViewClass = "front" | "side" | "oblique" | "unknown";
export type TestSide = "left" | "right" | "none";

export const QUALITY_RULES = {
  // SPEC-GAP: vis-share. The side lean's own rule rejects an attempt only with more than 20 percent
  // of frames under 0.5, and the arm curl fails over 20 percent unscored time. Both hold whenever
  // the general 90 percent rule and the 10 percent pause rule hold, so the stricter general rule is
  // applied to every test.
  /**
   * Gate landmarks at the test minimum in at least 90 percent of frames (engine.landmarks and
   * architecture section 5).
   */
  minVisibleShare: 0.9,
  /** Landmarks inside a 3 percent margin of the frame (architecture section 5). */
  margin: 0.03,
  // SPEC-GAP: inframe-share. The spec asks for landmarks inside the margin but gives no share of
  // frames; the visibility share (90 percent) is used.
  minInFrameShare: 0.9,
  /** Spec 4.0: over 10 percent paused frames fails the attempt. */
  maxPausedShare: SUBJECT_RULES.maxPausedShare,
  /** At least this share of frames must give a view ratio, otherwise the view is unknown. */
  minViewShare: 0.5,
} as const;

// SPEC-GAP: distance-band. The architecture names the proxy (trunk length ÷ frame height) but no
// values. The distance is estimated with the spec's own assumption (about 50 degrees across the
// short side of the picture, spec 4.0 calc) and a nominal adult trunk of 0.5 m, then compared with
// each test's setup distance with a 25 percent allowance for body size and lens, never beyond the
// model's 4 m limit. Tune at booth.
/**
 * Camera assumptions for the distance proxy.
 */
export const CAMERA_MODEL = {
  shortSideFovDeg: 50,
  nominalTrunkM: 0.5,
  distanceTolerance: 0.25,
  maxDistanceM: 4,
} as const;

// SPEC-GAP: view-no-hips. When no hip is visible (armrests or a wheel hide them) the trunk length
// for the view ratio and the distance proxy comes from the longest visible upper arm times this
// nominal ratio, so hidden hips alone never fail an attempt (spec 4.2: the rear wheel often hides
// the hip in a wheelchair side view).
export const TRUNK_PER_UPPER_ARM = 1.6;

/** Setup check thresholds (spec 4.0 and the test setups). */
export const SETUP_RULES = {
  /** Phone level within 5 degrees (roll and pitch) when the device reports its orientation. */
  tiltMaxDeg: 5,
  /** The side lean warns above 3 degrees of tilt (spec 4.3 setup). */
  trunkTiltWarnDeg: 3,
  // SPEC-GAP: light-proxy. The spec asks for a light check but no measure. The proxy is the mean of
  // the 5 highest visibilities among nose, eyes, ears, shoulders, elbows and hips (5 of them show
  // clearly in any view in good light, and dim light lowers all of them). Tune at booth.
  lightMin: 0.7,
  /** Spec 4.1: each shoulder needs at least 1.3 arm lengths of room to its frame edge. */
  armRoomFactor: 1.3,
  /** An issue counts when it holds in more than this share of the setup frames. */
  majority: 0.5,
} as const;

/* -------------------------------------------------------------------- view */

/** Trunk length for the view and distance measures (pixel space), with the upper arm fallback. */
function trunkRef(p: Landmark[]): number | null {
  if (visible(p, LM.l_hip) || visible(p, LM.r_hip)) {
    const t = trunkPx(p);
    return t > 1e-3 ? t : null;
  }
  let arm = 0;
  if (visible(p, LM.l_shoulder) && visible(p, LM.l_elbow)) arm = Math.max(arm, upperArmPx(p, "left"));
  if (visible(p, LM.r_shoulder) && visible(p, LM.r_elbow)) arm = Math.max(arm, upperArmPx(p, "right"));
  return arm > 1e-3 ? arm * TRUNK_PER_UPPER_ARM : null;
}

function ratioOfPixel(p: Landmark[]): number | null {
  // One visible shoulder is enough: in a side view the model still places the far shoulder.
  if (!visible(p, LM.l_shoulder) && !visible(p, LM.r_shoulder)) return null;
  const t = trunkRef(p);
  return t === null ? null : shoulderPx(p) / t;
}

/** Pixel space shoulder width ÷ trunk length, or null when it cannot be measured. */
export function viewRatio(lm: Landmark[], aspect?: number): number | null {
  if (!isPerson(lm)) return null;
  return ratioOfPixel(toPixelSpace(lm, aspect));
}

export function viewOfRatio(r: number | null): ViewClass {
  if (r === null || !Number.isFinite(r)) return "unknown";
  if (r >= VIEW_RATIO.frontMin) return "front";
  if (r <= VIEW_RATIO.sideMax) return "side";
  return "oblique";
}

/** The camera view of one pose (architecture section 5), in pixel space. */
export function classifyView(lm: Landmark[], aspect?: number): ViewClass {
  return viewOfRatio(viewRatio(lm, aspect));
}

/**
 * Estimated turn of the body away from square on, in degrees (0 front, 90 side), from the view
 * ratio and a nominal adult. For the record only (the arm curl stores its view angle class).
 */
export function estimateTurnDeg(ratio: number): number {
  const c = Math.min(1, Math.max(0, ratio / VIEW_RATIO.nominalFront));
  return (Math.acos(c) * 180) / Math.PI;
}

/**
 * Views each test accepts (spec 4.1 to 4.4, contract v2 F): the arm raise and the side lean are
 * front views; the arm curl is a side view, and "side" includes the anterolateral view up to 30
 * degrees; the chair stand is filmed at 45 degrees and accepts oblique, front or unknown, never a
 * pure side view.
 */
export const ACCEPTED_VIEWS: Record<TestId, readonly ViewClass[]> = {
  shoulder_abduction: ["front"],
  arm_curl_30s: ["side"],
  trunk_control_seated: ["front"],
  chair_stand_30s: ["front", "oblique", "unknown"],
};

/* ---------------------------------------------------------------- distance */

/**
 * Estimated phone distance in metres from the trunk length as a share of the frame height, with
 * CAMERA_MODEL. In portrait the short side (50 degrees) is the width; in landscape it is the height.
 */
export function estimateDistanceM(trunkOverHeight: number, aspect?: number): number {
  const a = effectiveAspect(aspect);
  const shortTan = Math.tan(((CAMERA_MODEL.shortSideFovDeg / 2) * Math.PI) / 180);
  const verticalTan = a < 1 ? shortTan / a : shortTan;
  return CAMERA_MODEL.nominalTrunkM / (Math.max(trunkOverHeight, 1e-6) * 2 * verticalTan);
}

/** too_close, too_far or null for an estimated distance against a test's setup distance. */
export function distanceIssue(
  estimateM: number | null,
  band: readonly [number, number],
): "too_close" | "too_far" | null {
  if (estimateM === null) return null;
  const tol = CAMERA_MODEL.distanceTolerance;
  if (estimateM < band[0] * (1 - tol)) return "too_close";
  if (estimateM > Math.min(CAMERA_MODEL.maxDistanceM, band[1] * (1 + tol))) return "too_far";
  return null;
}

/* ------------------------------------------------------------ attempt gate */

export type QualityIssue =
  "not_visible" | "out_of_frame" | "wrong_view" | "too_close" | "too_far" | "low_fps" | "paused" | "touched";

/**
 * Issues in the order their retry messages are worth giving: a second person first (their cause
 * is the most specific), then the picture (out of frame, then the view, then what the camera
 * cannot see), then distance and speed. A view that could not be read (unknown) follows the
 * visibility issue that caused it.
 */
const ISSUE_ORDER: QualityIssue[] = [
  "paused",
  "touched",
  "out_of_frame",
  "wrong_view",
  "not_visible",
  "too_close",
  "too_far",
  "low_fps",
];
const ISSUE_ORDER_VIEW_UNKNOWN: QualityIssue[] = [
  "paused",
  "touched",
  "out_of_frame",
  "not_visible",
  "wrong_view",
  "too_close",
  "too_far",
  "low_fps",
];

export interface QualityConfig {
  testId: TestId;
  side: TestSide;
  /** Landmarks that alone can fail an attempt. */
  gate: number[];
  /** Gate landmarks only in window frames (calibration or upright window). */
  windowGate: number[];
  /** Landmarks that feed flags; never fail an attempt. */
  optional: number[];
  minVisibility: number;
  views: readonly ViewClass[];
  minFps: number;
  /** The test's setup distance in metres. */
  distanceM: readonly [number, number];
  minVisibleShare: number;
  minInFrameShare: number;
  margin: number;
  maxPausedShare: number;
}

export interface QualityOptions {
  /**
   * Shoulder abduction only: the hips are gate landmarks in the calibration frames when the angle
   * uses the trunk reference (spec 4.1). The runner passes false in gravity reference mode.
   * Default true (the stricter gate).
   */
  trunkReference?: boolean;
}

/** The quality gate of one test and side, from the check data (requiredLandmarks, minFps, setup). */
export function qualityConfig(def: TestDef, side: TestSide, opts: QualityOptions = {}): QualityConfig {
  let gate: number[];
  let windowGate: number[] = [];
  switch (def.id) {
    case "shoulder_abduction":
      if (side === "none") throw new Error("shoulder_abduction needs a side");
      gate = def.requiredLandmarks.gate[side];
      if (opts.trunkReference !== false) windowGate = def.requiredLandmarks.gateCalibrationTrunkMode;
      break;
    case "arm_curl_30s":
      if (side === "none") throw new Error("arm_curl_30s needs a side");
      gate = def.requiredLandmarks.gate[side];
      break;
    case "trunk_control_seated":
      gate = def.requiredLandmarks.gate;
      windowGate = def.requiredLandmarks.gateUprightWindow;
      break;
    case "chair_stand_30s":
      gate = def.requiredLandmarks.gate;
      break;
  }
  return {
    testId: def.id,
    side,
    gate: [...gate],
    windowGate: [...windowGate],
    optional: [...def.requiredLandmarks.optional],
    minVisibility: def.requiredLandmarks.minVisibility,
    views: ACCEPTED_VIEWS[def.id],
    minFps: CHECK_DATA.engine.model.minFps[def.kind],
    distanceM: [def.setup.distanceM[0], def.setup.distanceM[1]],
    minVisibleShare: QUALITY_RULES.minVisibleShare,
    minInFrameShare: QUALITY_RULES.minInFrameShare,
    margin: QUALITY_RULES.margin,
    maxPausedShare: QUALITY_RULES.maxPausedShare,
  };
}

export interface FrameFlags {
  /** A calibration or upright window frame: the window gate applies too. */
  gateWindow?: boolean;
  /** The subject lock paused scoring in this frame. */
  paused?: boolean;
  /** A second person touched the subject in this frame. */
  touching?: boolean;
}

export interface QualityReport {
  ok: boolean;
  frames: number;
  /** Share of frames with every gate landmark at the minimum visibility. */
  visibleShare: number;
  /** Same for the window gate over the window frames, null without window frames. */
  windowVisibleShare: number | null;
  /** Per optional landmark, share of frames at the minimum visibility (stored as unknown when low). */
  optionalVisibleShare: Record<string, number>;
  view: ViewClass;
  /** Median shoulder width ÷ trunk length, null when unknown. */
  viewRatio: number | null;
  viewOk: boolean;
  /** Share of frames with every gate landmark inside the margin. */
  inFrameShare: number;
  /** Median frames per second. */
  fps: number;
  pausedShare: number;
  touched: boolean;
  /** Median trunk length ÷ frame height, null when unknown. */
  distance: number | null;
  /** Estimated phone distance in metres, null when unknown. */
  distanceM: number | null;
  /** In the order to act on them; the first one gives `cue`. */
  issues: QualityIssue[];
  /** Gate landmarks under the minimum visibility in too many frames (empty when visible). */
  missing: number[];
  /** The retry cue for the first issue (retryCue), null when the attempt is ok. */
  cue: CheckCueId | null;
}

interface FrameRecord {
  t: number;
  /** Per gate landmark (config order). */
  gateVis: boolean[];
  /** Per window gate landmark (config order). */
  windowVis: boolean[];
  gateVisible: boolean;
  inWindow: boolean;
  windowVisible: boolean;
  inFrame: boolean;
  optional: boolean[];
  ratio: number | null;
  trunk: number | null;
  aspect: number;
  paused: boolean;
  touching: boolean;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

const inside = (q: Landmark | undefined, margin: number) =>
  !!q && q.x >= margin && q.x <= 1 - margin && q.y >= margin && q.y <= 1 - margin;

/** Watches the frames of one attempt; `report()` says whether the attempt can be scored. */
export class QualityMonitor {
  private records: FrameRecord[] = [];

  constructor(readonly config: QualityConfig) {}

  reset(): void {
    this.records = [];
  }

  /**
   * One frame of the attempt: the subject's landmarks (normalized, as the model gave them; null or
   * an empty pose when the subject was not found) and the frame's aspect ratio.
   */
  feed(frame: { t: number; lm: Landmark[] | null; aspect?: number }, flags: FrameFlags = {}): void {
    const c = this.config;
    const lm = frame.lm && isPerson(frame.lm) ? frame.lm : null;
    const aspect = effectiveAspect(frame.aspect);
    const vis = (i: number) => !!lm && visible(lm, i, c.minVisibility);
    const inWindow = !!flags.gateWindow;
    const px = lm ? toPixelSpace(lm, aspect) : null;
    const trunk = px ? trunkRef(px) : null;
    const gateVis = c.gate.map(vis);
    const windowVis = c.windowGate.map(vis);
    this.records.push({
      t: frame.t,
      gateVis,
      windowVis,
      gateVisible: gateVis.every(Boolean),
      inWindow,
      windowVisible: windowVis.every(Boolean),
      inFrame: !!lm && [...c.gate, ...(inWindow ? c.windowGate : [])].every((i) => inside(lm[i], c.margin)),
      optional: c.optional.map(vis),
      ratio: px ? ratioOfPixel(px) : null,
      trunk,
      aspect,
      paused: !!flags.paused,
      touching: !!flags.touching,
    });
  }

  /** Convenience: feed a Frame whose `lm` is already the subject's (see subjectFrame). */
  feedFrame(frame: Frame, flags: FrameFlags = {}): void {
    this.feed({ t: frame.t, lm: frame.lm, aspect: frame.aspect }, flags);
  }

  /** Convenience: feed a raw frame with the subject lock's pick for it (SubjectLock.pickFrame). */
  feedPick(frame: Frame, pick: SubjectPick, gateWindow = false): void {
    this.feed(
      { t: frame.t, lm: pick.lm, aspect: frame.aspect },
      { gateWindow, paused: pick.paused, touching: pick.touching },
    );
  }

  report(): QualityReport {
    const c = this.config;
    const r = this.records;
    const n = r.length;
    const share = (pred: (x: FrameRecord) => boolean, of: FrameRecord[] = r) =>
      of.length ? of.filter(pred).length / of.length : 0;

    const visibleShare = share((x) => x.gateVisible && (!x.inWindow || x.windowVisible));
    const windowFrames = r.filter((x) => x.inWindow);
    const windowVisibleShare =
      c.windowGate.length && windowFrames.length ? share((x) => x.windowVisible, windowFrames) : null;
    const optionalVisibleShare: Record<string, number> = {};
    c.optional.forEach((id, k) => (optionalVisibleShare[String(id)] = round(share((x) => x.optional[k]))));
    const inFrameShare = share((x) => x.inFrame);

    // Gate landmarks seen too rarely, which picks the retry message (a sleeve or the whole body).
    const gateShares = [
      ...c.gate.map((id, k) => ({ id, s: share((x) => x.gateVis[k]) })),
      ...(windowFrames.length
        ? c.windowGate.map((id, k) => ({ id, s: share((x) => x.windowVis[k], windowFrames) }))
        : []),
    ];
    let missing = gateShares.filter((g) => g.s < c.minVisibleShare).map((g) => g.id);
    const notVisible =
      !n || visibleShare < c.minVisibleShare || (windowVisibleShare ?? 1) < c.minVisibleShare;
    if (notVisible && !missing.length) missing = gateShares.filter((g) => g.s < 1).map((g) => g.id);
    missing = [...new Set(missing)].sort((a, b) => a - b);

    const ratios = r.map((x) => x.ratio).filter((x): x is number => x !== null);
    const ratio = n && ratios.length / n >= QUALITY_RULES.minViewShare ? median(ratios) : null;
    const view = viewOfRatio(ratio);
    const viewOk = c.views.includes(view);

    const dts: number[] = [];
    for (let i = 1; i < n; i++) if (r[i].t > r[i - 1].t) dts.push(r[i].t - r[i - 1].t);
    const dt = median(dts);
    const fps = dt ? 1000 / dt : 0;

    const trunks = r.map((x) => x.trunk).filter((x): x is number => x !== null);
    const distance = median(trunks);
    const aspect = median(r.map((x) => x.aspect)) ?? 1;
    const distanceM = distance === null ? null : estimateDistanceM(distance, aspect);

    const pausedShare = share((x) => x.paused);
    const touched = r.some((x) => x.touching);

    const found = new Set<QualityIssue>();
    if (notVisible) found.add("not_visible");
    if (n && inFrameShare < c.minInFrameShare) found.add("out_of_frame");
    if (n && !viewOk) found.add("wrong_view");
    const d = distanceIssue(distanceM, c.distanceM);
    if (d) found.add(d);
    if (n && fps < c.minFps) found.add("low_fps");
    if (pausedShare > c.maxPausedShare) found.add("paused");
    if (touched) found.add("touched");
    const issues = (view === "unknown" ? ISSUE_ORDER_VIEW_UNKNOWN : ISSUE_ORDER).filter((i) => found.has(i));

    return {
      ok: issues.length === 0,
      frames: n,
      visibleShare: round(visibleShare),
      windowVisibleShare: windowVisibleShare === null ? null : round(windowVisibleShare),
      optionalVisibleShare,
      view,
      viewRatio: ratio === null ? null : round(ratio),
      viewOk,
      inFrameShare: round(inFrameShare),
      fps: round(fps, 1),
      pausedShare: round(pausedShare),
      touched,
      distance: distance === null ? null : round(distance),
      distanceM: distanceM === null ? null : round(distanceM, 2),
      issues,
      missing,
      cue: issues.length ? retryCue(issues[0], c.testId, c.side, missing) : null,
    };
  }
}

/* ------------------------------------------------------------ retry cues */

/**
 * The cue that asks the person to turn the right way for a test. The chair stand phone stands at 45
 * degrees toward the stronger side (P4: check_phone_angle_right or _left); with no weaker side known,
 * toward the right.
 */
// SPEC-GAP: phone-angle-side. The runners do not know the weaker side yet (engine round), so the
// chair stand asks for the right side unless a caller passes `weaker`.
export function viewCue(testId: TestId, side: TestSide, weaker?: "left" | "right" | null): CheckCueId {
  switch (testId) {
    case "arm_curl_30s":
      return side === "left" ? "check_left_side_to_phone" : "check_right_side_to_phone";
    case "chair_stand_30s":
      return weaker === "right" ? "check_phone_angle_left" : "check_phone_angle_right";
    default:
      return "check_face_phone";
  }
}

const ARM_POINTS: readonly number[] = [LM.l_elbow, LM.r_elbow, LM.l_wrist, LM.r_wrist];

/**
 * The one retry message for a quality issue: a check cue (display text, TTS and English in the
 * check data). On the arm tests an elbow or wrist the camera cannot see usually means a loose
 * sleeve (spec 4.1 and 4.2 setup); any other missing gate landmark means a body part out of the
 * picture. `missing` is the report's list; without it the arm tests assume a sleeve.
 */
export function retryCue(
  issue: QualityIssue,
  testId: TestId,
  side: TestSide,
  missing?: readonly number[],
): CheckCueId {
  switch (issue) {
    case "not_visible": {
      if (testId !== "shoulder_abduction" && testId !== "arm_curl_30s") return "check_whole_body";
      const arms = !missing?.length || missing.every((i) => ARM_POINTS.includes(i));
      return arms ? "check_sleeves" : "check_whole_body";
    }
    case "out_of_frame":
      return "check_whole_body";
    case "wrong_view":
      return viewCue(testId, side);
    case "too_close":
      return "check_move_back";
    case "too_far":
      return "check_move_closer";
    case "low_fps":
      // SPEC-GAP: low-fps-cue. The check data has no cue for a slow device; a plain retry is used.
      return "check_try_again";
    case "paused":
      return "check_one_person";
    case "touched":
      // SPEC-GAP: touch-cue. No cue asks a helper not to touch; the one person cue is the closest.
      return "check_one_person";
  }
}

/** The retry cue line of an issue: Arabic display text, Arabic speech text and English. */
export function retryLine(
  issue: QualityIssue,
  testId: TestId,
  side: TestSide,
  missing?: readonly number[],
): CueLine {
  return cueLine(retryCue(issue, testId, side, missing));
}

/* ------------------------------------------------------------- setup check */

export type SetupIssue =
  | "no_person"
  | "second_person"
  | "tilt"
  | "too_close"
  | "too_far"
  | "framing"
  | "arm_room"
  | "wrong_view"
  | "light";

const SETUP_ORDER: SetupIssue[] = [
  "no_person",
  "second_person",
  "tilt",
  "too_close",
  "too_far",
  "framing",
  "arm_room",
  "wrong_view",
  "light",
];

export interface SetupConfig {
  testId: TestId;
  side: TestSide;
  /** Landmarks that must be inside the frame margin (the test's framing, spec 4.1 to 4.4). */
  framing: number[];
  views: readonly ViewClass[];
  distanceM: readonly [number, number];
  margin: number;
  tiltMaxDeg: number;
  /** A tilt above this (and within tiltMaxDeg) is a warning, never blocking. */
  tiltWarnDeg: number | null;
  /** Shoulder abduction: room for both arms out to the side and overhead (spec 4.1). */
  armRoom: boolean;
}

// SPEC-GAP: stand-headroom. "From the head at full stand" cannot be seen while the person sits
// for the setup; the in frame gate of the practice stands checks it.
/**
 * Framing per test, from the setup text of the spec:
 *   arm raise: head, both hands at full overhead reach, both hips;
 *   arm curl: head to hips plus the hanging hand, tested side;
 *   side lean: head to knees;
 *   chair stand: whole body to the feet.
 */
export function setupConfig(def: TestDef, side: TestSide): SetupConfig {
  let framing: number[];
  switch (def.id) {
    case "shoulder_abduction":
      framing = [LM.nose, 11, 12, 13, 14, 15, 16, 23, 24];
      break;
    case "arm_curl_30s":
      if (side === "none") throw new Error("arm_curl_30s needs a side");
      framing = side === "left" ? [LM.nose, 11, 13, 15, 23] : [LM.nose, 12, 14, 16, 24];
      break;
    case "trunk_control_seated":
      framing = [LM.nose, 11, 12, 23, 24, 25, 26];
      break;
    case "chair_stand_30s":
      framing = [LM.nose, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
      break;
  }
  return {
    testId: def.id,
    side,
    framing,
    views: ACCEPTED_VIEWS[def.id],
    distanceM: [def.setup.distanceM[0], def.setup.distanceM[1]],
    margin: QUALITY_RULES.margin,
    tiltMaxDeg: SETUP_RULES.tiltMaxDeg,
    tiltWarnDeg: def.id === "trunk_control_seated" ? SETUP_RULES.trunkTiltWarnDeg : null,
    armRoom: def.id === "shoulder_abduction",
  };
}

export interface SetupFrame {
  t: number;
  poses: Landmark[][];
  aspect?: number;
}

/** Phone tilt from level upright, in degrees: roll around the camera axis and pitch of that axis. */
export interface Tilt {
  rollDeg: number;
  pitchDeg: number;
}

export interface SetupOptions {
  /** From the device orientation, when available (see phoneTilt). Null or absent skips the check. */
  tilt?: Tilt | null;
}

export interface SetupResult {
  ok: boolean;
  /** In the order to fix them. */
  issues: SetupIssue[];
  /** Retry cue for the first issue. */
  cue: CheckCueId | null;
  /** Shown but never blocking (the side lean's tilt above 3 degrees). */
  warnings: SetupIssue[];
  view: ViewClass;
  distanceM: number | null;
  /** Light proxy from landmark visibility, 0 to 1. */
  light: number | null;
}

/** Room for the arms (spec 4.1): 1.3 arm lengths to each side edge, and the hands overhead in frame. */
function armRoomOk(p: Landmark[], aspect: number, margin: number): boolean {
  const l = { s: p[LM.l_shoulder], arm: armPx(p, "left") };
  const r = { s: p[LM.r_shoulder], arm: armPx(p, "right") };
  const [onLeft, onRight] = l.s.x <= r.s.x ? [l, r] : [r, l];
  const k = SETUP_RULES.armRoomFactor;
  const sideways = onLeft.s.x >= k * onLeft.arm && aspect - onRight.s.x >= k * onRight.arm;
  // SPEC-GAP: overhead-room. "Both hands at full overhead reach" in the frame: the highest shoulder
  // minus the longer arm stays inside the margin.
  const overhead = Math.min(l.s.y, r.s.y) - Math.max(l.arm, r.arm) >= margin;
  return sideways && overhead;
}

const LIGHT_POINTS = [0, 2, 5, 7, 8, 11, 12, 13, 14, 23, 24];
function lightProxy(lm: Landmark[]): number {
  const v = LIGHT_POINTS.map((i) => lm[i]?.visibility ?? 0).sort((a, b) => b - a);
  return v.slice(0, 5).reduce((s, x) => s + x, 0) / 5;
}

/** Retry cue for a setup issue. */
export function setupCue(issue: SetupIssue, testId: TestId, side: TestSide): CheckCueId {
  switch (issue) {
    case "no_person":
    case "framing":
      return "check_whole_body";
    case "second_person":
      return "check_one_person";
    case "tilt":
      return "check_phone_level";
    case "too_close":
    case "arm_room":
      return "check_move_back";
    case "too_far":
      return "check_move_closer";
    case "wrong_view":
      return viewCue(testId, side);
    case "light":
      return "check_light";
  }
}

/**
 * The live setup check over a short window of frames (for example the last second). An issue
 * counts when it holds in more than half of the frames. Recording starts only when `ok`.
 */
export function setupCheck(frames: SetupFrame[], cfg: SetupConfig, opts: SetupOptions = {}): SetupResult {
  const counts = new Map<SetupIssue, number>();
  const bump = (i: SetupIssue) => counts.set(i, (counts.get(i) ?? 0) + 1);
  const ratios: number[] = [];
  const trunks: number[] = [];
  const lights: number[] = [];
  const aspects: number[] = [];
  let seen = 0;

  for (const f of frames) {
    const a = effectiveAspect(f.aspect);
    aspects.push(a);
    const i = nearestCentre(f.poses, a);
    if (i < 0) {
      bump("no_person");
      continue;
    }
    seen++;
    const lm = f.poses[i];
    const p = toPixelSpace(lm, a);
    const box = poseBox(p);
    const crowded = f.poses.some((o, j) => {
      if (j === i || !isPerson(o)) return false;
      const ob = poseBox(toPixelSpace(o, a));
      return !!box && !!ob && overlapShare(box, ob) > SUBJECT_RULES.overlapMax;
    });
    if (crowded) bump("second_person");
    if (!cfg.framing.every((k) => inside(lm[k], cfg.margin))) bump("framing");
    if (cfg.armRoom && !armRoomOk(p, a, cfg.margin)) bump("arm_room");
    const r = ratioOfPixel(p);
    if (r !== null) ratios.push(r);
    const t = trunkRef(p);
    if (t !== null) trunks.push(t);
    lights.push(lightProxy(lm));
  }

  const n = frames.length;
  const found = new Set<SetupIssue>();
  const majority = (k: SetupIssue) => (counts.get(k) ?? 0) > SETUP_RULES.majority * n;
  if (!n || majority("no_person")) found.add("no_person");

  const view = viewOfRatio(
    seen && ratios.length / seen >= QUALITY_RULES.minViewShare ? median(ratios) : null,
  );
  const trunk = median(trunks);
  const distanceM = trunk === null ? null : estimateDistanceM(trunk, median(aspects) ?? 1);
  const light = median(lights);
  const warnings: SetupIssue[] = [];

  if (!found.has("no_person")) {
    for (const k of ["second_person", "framing", "arm_room"] as const) if (majority(k)) found.add(k);
    const d = distanceIssue(distanceM, cfg.distanceM);
    if (d) found.add(d);
    if (!cfg.views.includes(view)) found.add("wrong_view");
    if (light !== null && light < SETUP_RULES.lightMin) found.add("light");
  }
  const tilt = opts.tilt;
  if (tilt) {
    const worst = Math.max(Math.abs(tilt.rollDeg), Math.abs(tilt.pitchDeg));
    if (worst > cfg.tiltMaxDeg) found.add("tilt");
    else if (cfg.tiltWarnDeg !== null && worst > cfg.tiltWarnDeg) warnings.push("tilt");
  }

  const issues = SETUP_ORDER.filter((k) => found.has(k));
  return {
    ok: issues.length === 0,
    issues,
    cue: issues.length ? setupCue(issues[0], cfg.testId, cfg.side) : null,
    warnings,
    view,
    distanceM: distanceM === null ? null : round(distanceM, 2),
    light: light === null ? null : round(light),
  };
}

/**
 * Phone tilt from the W3C device orientation angles (beta and gamma, degrees) and the screen
 * orientation angle (0, 90, 180 or 270). Level upright is roll 0 and pitch 0, in portrait or in
 * landscape. The app reads the angles (a DOM API) and passes the result to setupCheck.
 */
export function phoneTilt(betaDeg: number, gammaDeg: number, screenAngleDeg = 0): Tilt {
  const rad = Math.PI / 180;
  const b = betaDeg * rad;
  const g = gammaDeg * rad;
  // World up in device axes (x right, y toward the top of the device, z out of the screen).
  const ux = -Math.sin(g) * Math.cos(b);
  const uy = Math.sin(b);
  const uz = Math.cos(g) * Math.cos(b);
  const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
  const rollDeg = wrap(Math.atan2(ux, uy) / rad - screenAngleDeg);
  const pitchDeg = Math.asin(Math.max(-1, Math.min(1, uz))) / rad;
  return { rollDeg, pitchDeg };
}
