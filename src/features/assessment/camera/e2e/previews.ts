/**
 * The static previews of S34 (E2E builds only, contract v3 K): one fixed state per name, drawn by
 * CameraPreview.tsx for the review screenshots (e2e/camera-shots.spec.ts). Pure data, so the spec can
 * list the names without loading the screen.
 */
import type { I18nKey } from "../../../../i18n";
import type { CheckCueId, CheckPosition, TestId } from "../../../../movements/types";
import type { FlowState } from "../../flowMachine";
import type { CamSnapshot, SetupView } from "../controller";
import type { CueSeverity } from "../cues";
import type { CamError, CamStatus } from "../session";
import type { AttemptDot } from "../view";

export type Caption = { cue: CheckCueId } | { key: I18nKey; severity: CueSeverity };

export interface Preview {
  test: TestId;
  side?: number;
  state: (i: number, side: number) => FlowState;
  snap?: Partial<Omit<CamSnapshot, "setup">> & { setup?: Partial<SetupView> };
  caption?: Caption;
  session?: { status: CamStatus; error?: CamError };
  landscape?: boolean;
  large?: boolean;
  tips?: boolean;
  /** Quality retries used on the side (the retry panel counts the tries left from it). */
  retriesUsed?: number;
  helper?: boolean;
  position?: CheckPosition;
  motion?: boolean;
  /** The fixture script and the second of it drawn as the person. */
  fixture: string;
  at: number;
}

const setup = (i: number, side: number): FlowState => ({ kind: "cam.setup", i, side });
const calibrate = (i: number, side: number): FlowState => ({ kind: "cam.calibrate", i, side, offer: false });
const practice = (i: number, side: number): FlowState => ({ kind: "cam.practice", i, side });
const countdown = (i: number, side: number): FlowState => ({ kind: "cam.countdown", i, side });
const measure = (i: number, side: number): FlowState => ({ kind: "cam.measure", i, side });
const saved = (i: number, side: number): FlowState => ({ kind: "cam.saved", i, side });
const retry =
  (issue: string, exhausted = false) =>
  (i: number, side: number): FlowState => ({ kind: "cam.retry", i, side, issue, exhausted });
const rest =
  (purpose: "attempt" | "practice" | "seated" | "redo" | "sideChange" | "retryRest") =>
  (i: number, side: number): FlowState => ({ kind: "cam.rest", i, side, purpose });

const dots = (...d: AttemptDot[]): AttemptDot[] => d;
const P = (s: AttemptDot = "pending") => s;

export const PREVIEWS: Record<string, Preview> = {
  // Loading and errors (S34 L and Er).
  "loading-model": {
    test: "shoulder_abduction",
    state: setup,
    session: { status: "model" },
    fixture: "abd",
    at: 1,
  },
  "loading-camera": {
    test: "shoulder_abduction",
    state: setup,
    session: { status: "camera" },
    fixture: "abd",
    at: 1,
  },
  "error-model": {
    test: "shoulder_abduction",
    state: setup,
    session: { status: "error", error: "model" },
    fixture: "abd",
    at: 1,
  },
  landscape: { test: "shoulder_abduction", state: setup, landscape: true, fixture: "abd", at: 1 },

  // S34c setup check.
  "setup-none": {
    test: "shoulder_abduction",
    state: setup,
    snap: { setup: { issues: ["no_person"] } },
    caption: { cue: "check_whole_body" },
    fixture: "abd",
    at: -1,
  },
  "setup-close": {
    test: "shoulder_abduction",
    state: setup,
    snap: { setup: { issues: ["too_close"] } },
    caption: { cue: "check_move_back" },
    fixture: "abd",
    at: 1,
  },
  "setup-second": {
    test: "shoulder_abduction",
    state: setup,
    snap: { setup: { issues: ["second_person"] } },
    caption: { cue: "check_one_person" },
    fixture: "crowd",
    at: 1,
  },
  "setup-view": {
    test: "arm_curl_30s",
    side: 1,
    state: setup,
    snap: { setup: { issues: ["wrong_view"] } },
    caption: { cue: "check_right_side_to_phone" },
    fixture: "curl",
    at: 1,
  },
  "setup-blocked": {
    test: "chair_stand_30s",
    state: setup,
    snap: { setup: { issues: ["blocked"] } },
    caption: { cue: "check_clear_view" },
    helper: true,
    fixture: "stand",
    at: 1,
  },
  "setup-motion": {
    test: "shoulder_abduction",
    state: setup,
    position: "wheelchair",
    motion: true,
    snap: { setup: { issues: ["motion"] } },
    caption: { key: "assessment.primer.motionWheelchair", severity: "warn" },
    fixture: "abd",
    at: 1,
  },
  "setup-ready": {
    test: "shoulder_abduction",
    state: setup,
    snap: { setup: { issues: [], ok: true, hold: 0.6 } },
    caption: { key: "assessment.setup.holdStill", severity: "info" },
    fixture: "abd",
    at: 1,
  },
  "setup-fixed": {
    test: "shoulder_abduction",
    state: setup,
    snap: { setup: { issues: [], ok: true, hold: 0.2, justFixed: true } },
    caption: { key: "assessment.setup.fixed", severity: "info" },
    fixture: "abd",
    at: 1,
  },
  "setup-helper": {
    test: "trunk_control_seated",
    state: setup,
    snap: { setup: { issues: [], ok: true, hold: 0.3, helperSeen: true } },
    caption: { key: "assessment.setup.helperOk", severity: "info" },
    helper: true,
    fixture: "lean",
    at: 1,
  },
  "setup-wait": {
    test: "shoulder_abduction",
    state: setup,
    snap: { setup: { issues: ["light"], waitedSec: 95 } },
    caption: { cue: "check_light" },
    fixture: "abd",
    at: 1,
  },

  // S34d calibrate.
  calibrate: {
    test: "shoulder_abduction",
    state: calibrate,
    snap: { part: "calibrate", runnerPhase: "calibrating", calibrateHold: 0.45, phaseWord: "still" },
    caption: { cue: "test_abd_arms_rest" },
    fixture: "abd",
    at: 1,
  },
  "calibrate-lean": {
    test: "trunk_control_seated",
    state: calibrate,
    snap: { part: "calibrate", runnerPhase: "calibrating", calibrateHold: 0.7, phaseWord: "upright" },
    caption: { cue: "test_trunk_still" },
    fixture: "lean",
    at: 1,
  },
  "calibrate-offer": {
    test: "shoulder_abduction",
    state: (i, side) => ({ kind: "cam.calibrate", i, side, offer: true }),
    snap: { part: "calibrate", calibrationOffer: true },
    caption: { key: "assessment.setup.stillness.body", severity: "info" },
    fixture: "abd",
    at: 1,
  },

  // S34e practice.
  "practice-range": {
    test: "shoulder_abduction",
    state: practice,
    snap: { part: "practice", runnerPhase: "practice", practice: true, phaseWord: "raise" },
    caption: { cue: "test_abd_raise" },
    fixture: "abd",
    at: 5,
  },
  // S34e: the practice of the left arm lifted the right arm twice; its fix shows (no retry is used).
  "practice-fix": {
    test: "shoulder_abduction",
    state: practice,
    snap: {
      part: "rest",
      runnerPhase: "rest",
      practice: true,
      practiceFix: { issue: "wrong_arm", remaining: 4, total: 6, last: false },
    },
    caption: { cue: "check_left_arm" },
    fixture: "abd",
    at: 1,
  },
  "practice-curl": {
    test: "arm_curl_30s",
    state: practice,
    snap: { part: "practice", runnerPhase: "practice", practice: true },
    caption: { cue: "check_practice" },
    fixture: "curl",
    at: 3.8,
  },
  "practice-lean": {
    test: "trunk_control_seated",
    state: practice,
    snap: { part: "practice", runnerPhase: "practice", practice: true, phaseWord: "leanRight" },
    caption: { cue: "test_trunk_lean_right" },
    fixture: "lean",
    at: 6,
  },

  // S34f countdown.
  countdown: {
    test: "arm_curl_30s",
    state: countdown,
    snap: { part: "countdown", runnerPhase: "ready", countdown: 3, phaseWord: "ready" },
    caption: { cue: "check_ready" },
    fixture: "curl",
    at: 1,
  },
  go: {
    test: "arm_curl_30s",
    state: measure,
    snap: { part: "attempt", runnerPhase: "attempt", countdown: "go", trialRemaining: 30 },
    caption: { cue: "check_go" },
    fixture: "curl",
    at: 1,
  },

  // S34g1 range test.
  "range-raise": {
    test: "shoulder_abduction",
    state: measure,
    snap: {
      part: "attempt",
      runnerPhase: "attempt",
      dots: dots("saved", P(), P()),
      attemptN: 2,
      phaseWord: "raise",
    },
    caption: { cue: "test_abd_raise" },
    fixture: "abd",
    at: 4.5,
  },
  "range-hold": {
    test: "shoulder_abduction",
    state: measure,
    snap: {
      part: "hold",
      runnerPhase: "attempt",
      dots: dots("saved", P(), P()),
      attemptN: 2,
      phaseWord: "hold",
      hold: 0.6,
      live: 138,
    },
    caption: { cue: "test_abd_hold" },
    fixture: "abd",
    at: 6,
  },
  "range-lower": {
    test: "shoulder_abduction",
    state: measure,
    snap: {
      part: "attempt",
      runnerPhase: "attempt",
      dots: dots("saved", P(), P()),
      attemptN: 2,
      phaseWord: "lower",
      hold: 1,
      holdDone: true,
    },
    caption: { cue: "test_abd_lower" },
    fixture: "abd",
    at: 7.5,
  },
  "range-coach": {
    test: "shoulder_abduction",
    state: measure,
    snap: {
      part: "attempt",
      runnerPhase: "attempt",
      dots: dots("saved", "retry", P()),
      attemptN: 2,
      phaseWord: "raise",
    },
    caption: { cue: "test_abd_side" },
    fixture: "abd",
    at: 5,
  },
  "range-paused": {
    test: "shoulder_abduction",
    state: measure,
    snap: {
      part: "attempt",
      runnerPhase: "attempt",
      dots: dots("saved", P(), P()),
      attemptN: 2,
      phaseWord: "raise",
      hold: 0.3,
      paused: "person",
    },
    caption: { cue: "check_one_person" },
    fixture: "crowd",
    at: 1,
  },

  // S34g2 timed count.
  "timed-curl": {
    test: "arm_curl_30s",
    side: 1,
    state: measure,
    snap: { part: "attempt", runnerPhase: "attempt", count: 12, trialRemaining: 18 },
    caption: { cue: "check_go" },
    fixture: "curl",
    at: 5,
  },
  "timed-stand": {
    test: "chair_stand_30s",
    state: measure,
    snap: { part: "attempt", runnerPhase: "attempt", count: 7, trialRemaining: 9 },
    caption: { cue: "check_ten_left" },
    helper: true,
    fixture: "stand",
    at: 3.6,
  },
  "timed-paused": {
    test: "arm_curl_30s",
    state: measure,
    snap: { part: "attempt", runnerPhase: "attempt", count: 6, trialRemaining: 21, paused: "person" },
    caption: { cue: "check_one_person" },
    fixture: "crowd",
    at: 1,
  },
  "timed-timeup": {
    test: "arm_curl_30s",
    state: measure,
    snap: {
      part: "attempt",
      runnerPhase: "attempt",
      count: 14,
      trialRemaining: 0,
      timeUp: true,
      phaseWord: "timeUp",
    },
    caption: { cue: "check_time_up_curl" },
    fixture: "curl",
    at: 1,
  },
  "timed-large": {
    test: "arm_curl_30s",
    state: measure,
    snap: { part: "attempt", runnerPhase: "attempt", count: 12, trialRemaining: 18 },
    caption: { cue: "check_go" },
    large: true,
    fixture: "curl",
    at: 5,
  },

  // S34g3 seated side lean.
  "lean-left": {
    test: "trunk_control_seated",
    state: measure,
    snap: {
      part: "attempt",
      runnerPhase: "attempt",
      leanDirection: "left",
      phaseWord: "leanLeft",
      dots: dots("saved", P(), P()),
      attemptN: 2,
    },
    caption: { cue: "test_trunk_lean_left" },
    fixture: "lean",
    at: 1,
  },
  "lean-pause": {
    test: "trunk_control_seated",
    side: 1,
    state: measure,
    snap: {
      part: "hold",
      runnerPhase: "attempt",
      leanDirection: "right",
      phaseWord: "pause",
      dots: dots("saved", "saved", P()),
      attemptN: 3,
    },
    caption: { cue: "test_trunk_pause" },
    fixture: "lean",
    at: 7,
  },
  "lean-return": {
    test: "trunk_control_seated",
    side: 1,
    state: measure,
    snap: {
      part: "attempt",
      runnerPhase: "return",
      leanDirection: "right",
      phaseWord: "return",
      dots: dots("saved", "saved", P()),
      attemptN: 3,
    },
    caption: { cue: "test_trunk_return" },
    fixture: "lean",
    at: 8.5,
  },
  "lean-coach": {
    test: "trunk_control_seated",
    side: 1,
    state: measure,
    snap: {
      part: "attempt",
      runnerPhase: "attempt",
      leanDirection: "right",
      phaseWord: "return",
      dots: dots("saved", P(), P()),
      attemptN: 2,
    },
    caption: { cue: "test_trunk_to_middle" },
    fixture: "lean",
    at: 7,
  },

  // S34h saved.
  "saved-range": {
    test: "shoulder_abduction",
    state: saved,
    snap: { part: "saved", dots: dots("saved", "saved", P()), attemptN: 3, phaseWord: "saved" },
    caption: { cue: "check_saved" },
    fixture: "abd",
    at: 1,
  },
  "saved-timed": {
    test: "chair_stand_30s",
    state: saved,
    snap: { part: "saved", count: 11, trialRemaining: 0, timeUp: true, phaseWord: "saved" },
    caption: { cue: "check_time_up_stand" },
    fixture: "stand",
    at: 1,
  },

  // S34i retry.
  "retry-plane": {
    test: "shoulder_abduction",
    state: retry("plane_flexion"),
    retriesUsed: 1,
    snap: {
      part: "retry",
      retry: { remaining: 4, total: 6, counting: true },
      dots: dots("saved", "retry", P()),
    },
    caption: { cue: "test_abd_side" },
    fixture: "abd",
    at: 1,
  },
  "retry-touched": {
    test: "trunk_control_seated",
    state: retry("touched"),
    retriesUsed: 2,
    snap: { part: "retry", retry: { remaining: 6, total: 6, counting: false } },
    caption: { cue: "check_one_person" },
    fixture: "lean",
    at: 1,
  },
  "retry-timed": {
    test: "arm_curl_30s",
    state: retry("out_of_frame"),
    retriesUsed: 1,
    snap: { part: "retry", retry: { remaining: 5, total: 6, counting: true } },
    caption: { cue: "check_whole_body" },
    fixture: "curl",
    at: 1,
  },
  "retry-exhausted": {
    test: "shoulder_abduction",
    state: retry("not_visible", true),
    retriesUsed: 2,
    snap: { part: "retry", retry: { remaining: 3, total: 6, counting: true } },
    caption: { cue: "check_sleeves" },
    fixture: "abd",
    at: 1,
  },

  // S34j rests and S34k next side.
  "rest-attempt": {
    test: "shoulder_abduction",
    state: rest("attempt"),
    snap: {
      part: "rest",
      runnerPhase: "rest",
      rest: { remaining: 6, total: 8 },
      dots: dots("saved", P(), P()),
    },
    caption: { cue: "check_rest_short" },
    fixture: "abd",
    at: 1,
  },
  "rest-side": {
    test: "shoulder_abduction",
    side: 1,
    state: rest("sideChange"),
    snap: { part: "rest", rest: { remaining: 14, total: 20 } },
    caption: { cue: "check_rest_short" },
    fixture: "abd",
    at: 1,
  },
  "rest-wheelchair": {
    test: "arm_curl_30s",
    side: 1,
    state: rest("sideChange"),
    position: "wheelchair",
    snap: { part: "rest", rest: { remaining: 42, total: 60 } },
    caption: { cue: "check_rest_minute" },
    fixture: "curl",
    at: 1,
  },
  "rest-seated": {
    test: "chair_stand_30s",
    state: rest("seated"),
    snap: { part: "rest", rest: { remaining: 48, total: 60 } },
    caption: { cue: "check_sit_minute" },
    fixture: "stand",
    at: 1,
  },

  // Setup tips over the stage.
  tips: {
    test: "shoulder_abduction",
    state: setup,
    snap: { setup: { issues: ["light"], waitedSec: 70 } },
    tips: true,
    fixture: "abd",
    at: 1,
  },
};

export const PREVIEW_NAMES = Object.keys(PREVIEWS);
