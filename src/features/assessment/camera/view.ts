/**
 * The words of the camera screens (UX spec S34c to S34k): which copy key and which cue go with each
 * setup issue, retry fix, phase and chip, and which caption shows over the card. Pure: no DOM. Interface copy comes from src/i18n; every
 * clinical line comes from the check data (cues, reasons).
 */
import type { I18nKey } from "../../../i18n";
import type { QualityIssue, SetupIssue } from "../../../engine/quality";
import { viewCue } from "../../../engine/quality";
import type { CheckCueId, Side, TestId } from "../../../movements/types";
import type { CamSnapshot } from "./controller";
import type { CueSeverity } from "./cues";

/* ------------------------------------------------------------ setup check (S34c) */

/** Setup issues of the screen: the engine's, plus blocked (P4 (5)) and motion (map 2.9). */
export type ScreenSetupIssue = SetupIssue | "blocked" | "motion";

export const SETUP_TITLE: Record<ScreenSetupIssue, I18nKey> = {
  no_person: "assessment.setup.issue.no_person",
  second_person: "assessment.setup.issue.second_person",
  tilt: "assessment.setup.issue.tilt",
  too_close: "assessment.setup.issue.too_close",
  too_far: "assessment.setup.issue.too_far",
  framing: "assessment.setup.issue.framing",
  arm_room: "assessment.setup.issue.arm_room",
  wrong_view: "assessment.setup.issue.wrong_view",
  light: "assessment.setup.issue.light",
  blocked: "assessment.setup.issue.blocked",
  motion: "assessment.setup.issue.motion",
};

/** The setup cue of a screen issue (S34c table). */
export function setupIssueCue(
  issue: ScreenSetupIssue,
  testId: TestId,
  side: "left" | "right" | "none",
  weaker: Side | null,
  engineCue: CheckCueId | null,
): CheckCueId | null {
  if (issue === "blocked") return "check_clear_view";
  // The motion issue is captioned with the motion access line (copy), never a cue.
  if (issue === "motion") return null;
  if (issue === "wrong_view") return viewCue(testId, side, weaker);
  return engineCue;
}

/** The top view diagram of the setup card, when the view is the first issue (S34c, S34j). */
export type ViewDiagram =
  "side_left" | "side_right" | "oblique_left" | "oblique_right" | "side_change_wheelchair";

export function viewDiagramFor(
  testId: TestId,
  side: "left" | "right" | "none",
  weaker: Side | null,
): ViewDiagram | null {
  if (testId === "arm_curl_30s") return side === "left" ? "side_left" : "side_right";
  if (testId === "chair_stand_30s") return weaker === "right" ? "oblique_left" : "oblique_right";
  return null;
}

/** The framing guide of the setup view (S34c, Appendix B framing guides). */
export function framingViewOf(testId: TestId): "front" | "side" | "oblique" {
  if (testId === "arm_curl_30s") return "side";
  if (testId === "chair_stand_30s") return "oblique";
  return "front";
}

/** The order of the S34c issue table: the first issue present is titled, captioned and cued. */
export const SETUP_ISSUE_ORDER: readonly ScreenSetupIssue[] = [
  "no_person",
  "second_person",
  "tilt",
  "too_close",
  "too_far",
  "framing",
  "arm_room",
  "blocked",
  "wrong_view",
  "light",
  "motion",
];

/* ------------------------------------------------------------ retry (S34i) */

export type FixId =
  | "paused"
  | "touched"
  | "out_of_frame"
  | "wrong_view"
  | "not_visible_arm"
  | "not_visible"
  | "too_close"
  | "too_far"
  | "low_fps"
  | "plane"
  | "lean"
  | "wrong_side"
  | "phone_moved"
  | "lean_form";

export const FIX_KEY: Record<FixId, I18nKey> = {
  paused: "assessment.retry.fix.paused",
  touched: "assessment.retry.fix.touched",
  out_of_frame: "assessment.retry.fix.out_of_frame",
  wrong_view: "assessment.retry.fix.wrong_view",
  not_visible_arm: "assessment.retry.fix.not_visible_arm",
  not_visible: "assessment.retry.fix.not_visible",
  too_close: "assessment.retry.fix.too_close",
  too_far: "assessment.retry.fix.too_far",
  low_fps: "assessment.retry.fix.low_fps",
  plane: "assessment.retry.fix.plane",
  lean: "assessment.retry.fix.lean",
  wrong_side: "assessment.retry.fix.wrong_side",
  phone_moved: "assessment.retry.fix.phone_moved",
  lean_form: "assessment.retry.fix.lean_form",
};

/**
 * The issue a retry names, from the attempt's reasons (the quality issues in engine order, or the
 * runner's own reason): the first one decides the fix.
 */
export function retryIssueOf(reasons: readonly string[]): string {
  return reasons[0] ?? "out_of_frame";
}

const QUALITY: ReadonlySet<string> = new Set<QualityIssue>([
  "not_visible",
  "out_of_frame",
  "wrong_view",
  "too_close",
  "too_far",
  "low_fps",
  "paused",
  "touched",
]);

/**
 * The fix of a retry issue (S34i table): its title key and its cue. Arm tests read a hidden
 * landmark as a sleeve (retryCue); the side lean's forward bend, rotation and sliding ask to lean to
 * the side only; a wrong side or arm names the side asked for.
 */
export function fixOf(
  issue: string,
  testId: TestId,
  side: "left" | "right" | "none",
  weaker: Side | null,
): { fix: FixId; cue: CheckCueId | null } {
  const arm = testId === "shoulder_abduction" || testId === "arm_curl_30s";
  switch (issue) {
    case "paused":
      return { fix: "paused", cue: "check_one_person" };
    case "touched":
      // R3C-24: the controller speaks and captions assessment.retry.touchedHelper instead.
      return { fix: "touched", cue: null };
    case "out_of_frame":
      return { fix: "out_of_frame", cue: "check_whole_body" };
    case "wrong_view":
      return { fix: "wrong_view", cue: viewCue(testId, side, weaker) };
    case "not_visible":
      return arm
        ? { fix: "not_visible_arm", cue: "check_sleeves" }
        : { fix: "not_visible", cue: "check_whole_body" };
    case "too_close":
      return { fix: "too_close", cue: "check_move_back" };
    case "too_far":
      return { fix: "too_far", cue: "check_move_closer" };
    case "low_fps":
      return { fix: "low_fps", cue: "check_try_again" };
    case "plane_flexion":
      return { fix: "plane", cue: "test_abd_side" };
    case "trunk_lean":
      return { fix: "lean", cue: "test_abd_still" };
    case "wrong_arm":
      return { fix: "wrong_side", cue: side === "left" ? "check_left_arm" : "check_right_arm" };
    case "wrong_side":
      return {
        fix: "wrong_side",
        cue: side === "left" ? "test_trunk_lean_left" : "test_trunk_lean_right",
      };
    case "camera_moved":
    case "phone_moved":
      return { fix: "phone_moved", cue: "check_phone_still" };
    case "forward_bend":
    case "rotation":
    case "hip_slide":
      return { fix: "lean_form", cue: "test_trunk_seat" };
    case "unscored":
      return { fix: "not_visible", cue: "check_whole_body" };
    default:
      return QUALITY.has(issue)
        ? { fix: "out_of_frame", cue: "check_whole_body" }
        : { fix: "out_of_frame", cue: "check_try_again" };
  }
}

/* ------------------------------------------------------------ phases (S34d to S34k) */

export type PhaseWord =
  | "still"
  | "ready"
  | "go"
  | "raise"
  | "hold"
  | "lower"
  | "upright"
  | "leanLeft"
  | "leanRight"
  | "pause"
  | "return"
  | "centred"
  | "timeUp"
  | "rest"
  | "paused"
  | "saved";

export const PHASE_KEY: Record<PhaseWord, I18nKey> = {
  still: "assessment.hud.phase.still",
  ready: "assessment.hud.phase.ready",
  go: "assessment.hud.phase.go",
  raise: "assessment.hud.phase.raise",
  hold: "assessment.hud.phase.hold",
  lower: "assessment.hud.phase.lower",
  upright: "assessment.hud.phase.upright",
  leanLeft: "assessment.hud.phase.leanLeft",
  leanRight: "assessment.hud.phase.leanRight",
  pause: "assessment.hud.phase.pause",
  return: "assessment.hud.phase.return",
  centred: "assessment.hud.phase.centred",
  timeUp: "assessment.hud.phase.timeUp",
  rest: "assessment.hud.phase.rest",
  paused: "assessment.hud.phase.paused",
  saved: "assessment.hud.phase.saved",
};

export const ARM_KEY: Record<"left" | "right", I18nKey> = {
  left: "assessment.hud.armLeft",
  right: "assessment.hud.armRight",
};
export const SIDE_KEY: Record<"left" | "right", I18nKey> = {
  left: "assessment.hud.sideLeft",
  right: "assessment.hud.sideRight",
};

export type AttemptDot = "pending" | "saved" | "retry";
export const DOT_KEY: Record<AttemptDot, I18nKey> = {
  pending: "assessment.hud.dotPending",
  saved: "assessment.hud.dotSaved",
  retry: "assessment.hud.dotRetry",
};

/* ------------------------------------------------------------ one instruction on screen (C29) */

/** The card the stage shows (CameraView): a test's value card, or a part's own card. */
export type StageKind = "setup" | "range" | "timed" | "lean" | "rest" | "saved" | "retry" | "calibrate";

/**
 * The cues whose instruction the card already shows as its word (R-10). While the card shows that
 * word, the caption does not repeat it above the card; the voice still says the whole sentence. The
 * raise, the lean, the coaching lines and the time up lines keep their caption: their sentence says
 * more than the word (to the side, the safety limit, sit down slowly).
 */
export const CARD_SAYS: Partial<Record<CheckCueId, PhaseWord>> = {
  check_ready: "ready",
  check_go: "go",
  test_abd_hold: "hold",
  test_abd_lower: "lower",
  test_trunk_pause: "pause",
  test_trunk_return: "return",
  test_trunk_to_middle: "return",
  check_rest_short: "rest",
  check_rest_minute: "rest",
  check_saved: "saved",
};

type CardSnap = Pick<
  CamSnapshot,
  "part" | "phaseWord" | "rest" | "paused" | "countdown" | "runnerPhase" | "timeUp" | "practice"
>;

/** The word the stage's card shows now (panels.tsx), or null when it shows none. */
export function cardWordOf(stage: StageKind, snap: CardSnap): PhaseWord | null {
  const calibrating = snap.phaseWord === "upright" ? "upright" : "still";
  if (stage === "saved" || stage === "rest") return stage;
  if (stage === "calibrate") return calibrating;
  if (stage !== "range" && stage !== "timed" && stage !== "lean") return null;
  if (snap.part === "calibrate") return calibrating;
  if (stage === "lean")
    return snap.paused
      ? "paused"
      : snap.phaseWord === "rest" || (snap.part === "rest" && snap.phaseWord !== "saved")
        ? "centred"
        : snap.phaseWord;
  if (snap.part === "rest" && snap.rest) return "rest";
  if (stage === "range") return snap.paused ? "paused" : snap.phaseWord === "rest" ? null : snap.phaseWord;
  if (snap.countdown === "go") return "go";
  if (snap.countdown !== null && snap.runnerPhase === "ready") return "ready";
  if (snap.timeUp) return "timeUp";
  if (snap.paused) return "paused";
  return snap.runnerPhase === "attempt" || snap.practice ? null : snap.phaseWord;
}

/**
 * The caption over the card (C29: one instruction on screen). None when the card is the instruction
 * (the phone held sideways, S34i and the practice fix, whose reason is the fix) or when the card
 * shows the cue's word (CARD_SAYS). A safety line always shows.
 */
export function captionOverCard<C extends { cue?: CheckCueId; severity: CueSeverity }>(
  caption: C | null,
  card: { word: PhaseWord | null; only: boolean },
): C | null {
  if (!caption || caption.severity === "safety") return caption;
  if (card.only) return null;
  const said = caption.cue ? CARD_SAYS[caption.cue] : undefined;
  return said && said === card.word ? null : caption;
}

/**
 * Camera frames carry the time they were taken and the screen's clock ticks on its own, so a line of
 * the new part may be dated up to a frame or two before the tick that entered it.
 */
export const PART_GRACE_MS = 250;

/**
 * A caption belongs to the part of the test that asked for its line (R-11, as a caption belongs to
 * its screen, C14): a line asked before the current part began, such as the calibration's «اجلس
 * مستقيمًا» once the practice runs, is not shown. A safety line, and a line of copy with no time,
 * always show.
 */
export function captionOfPart<C extends { at?: number; severity: CueSeverity }>(
  caption: C | null,
  partSince: number,
): C | null {
  if (!caption || caption.severity === "safety" || caption.at === undefined) return caption;
  return caption.at >= partSince - PART_GRACE_MS ? caption : null;
}
