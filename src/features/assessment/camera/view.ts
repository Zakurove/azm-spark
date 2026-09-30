/**
 * The words of the camera screens (UX spec S34c to S34k): which copy key and which cue go with each
 * setup issue, retry fix, phase and chip. Pure: no DOM. Interface copy comes from src/i18n; every
 * clinical line comes from the check data (cues, reasons).
 */
import type { I18nKey } from "../../../i18n";
import type { QualityIssue, SetupIssue, Tilt } from "../../../engine/quality";
import { viewCue } from "../../../engine/quality";
import type { CheckCueId, Side, TestId } from "../../../movements/types";

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

export type ChipId = "level" | "distance" | "framing" | "light" | "people" | "view";
export type ChipState = "ok" | "fix" | "na";
/** Always 6 chips, fixed order (S34c). */
export const CHIP_ORDER: readonly ChipId[] = ["level", "distance", "framing", "light", "people", "view"];
export const CHIP_KEY: Record<ChipId, I18nKey> = {
  level: "assessment.setup.chip.level",
  distance: "assessment.setup.chip.distance",
  framing: "assessment.setup.chip.framing",
  light: "assessment.setup.chip.light",
  people: "assessment.setup.chip.people",
  view: "assessment.setup.chip.view",
};
export const CHIP_STATE_KEY: Record<ChipState, I18nKey> = {
  ok: "assessment.setup.chipOk",
  fix: "assessment.setup.chipFix",
  na: "assessment.setup.chipNA",
};

const CHIP_OF: Record<ScreenSetupIssue, ChipId> = {
  no_person: "framing",
  framing: "framing",
  blocked: "framing",
  second_person: "people",
  tilt: "level",
  motion: "level",
  too_close: "distance",
  too_far: "distance",
  arm_room: "distance",
  wrong_view: "view",
  light: "light",
};

/** The six chips of a setup result: the level chip is "Not available" without a tilt reading. */
export function setupChips(
  issues: readonly ScreenSetupIssue[],
  tilt: Tilt | null,
): Record<ChipId, ChipState> {
  const out: Record<ChipId, ChipState> = {
    level: tilt ? "ok" : "na",
    distance: "ok",
    framing: "ok",
    light: "ok",
    people: "ok",
    view: "ok",
  };
  for (const i of issues) {
    const chip = CHIP_OF[i];
    if (chip === "level" && i === "motion") continue;
    out[chip] = "fix";
  }
  // Without a person nothing else can be judged yet: the framing chip asks for a fix and the others
  // (all but the phone level, read from the phone itself) are not available, never a green tick.
  if (issues.includes("no_person"))
    for (const c of ["distance", "light", "people", "view"] as const) out[c] = "na";
  return out;
}

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
