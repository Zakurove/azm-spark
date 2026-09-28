/**
 * The movement check flow as a pure state machine (UX spec v1.1, Appendix A; maps 2.1 to 2.12).
 *
 *   flowReducer(model, event) -> model      no DOM, no network, no clock: `now` comes in the event
 *
 * The model holds one screen state at a time (`state`), an optional overlay over it (`overlay`:
 * the leave dialog S15, the skip dialog, the stop list S41, the check in S43, "go on" S44 and the
 * no response alarm S45), the flow data (`data`) and a list of network effects for the hook to run
 * (`effects`). Safety routing uses the pure modules of src/medical (evaluatePrecheck, betweenTests,
 * stopRoute) on the phone and never waits for the network: a safety screen is the next state of
 * the event that asks for it. The guest flow emits no network effect at all (contract v3 I).
 *
 * Effects are data. `start` and `resume` are awaited by the `starting` state (their answers come
 * back as START_RESULT and RESUME_RESULT), and `endForm` asks the server for the form of the end
 * question (END_FORM, the general form until it answers); every other effect is sent in the
 * background through the ordered outbox of the hook (resultQueue.ts): results, skips, stops, the
 * pain question between tests, the end and faint answers, alarms, the adult confirmation, the
 * completion and the background start or resume of a postponed or emergency pre-check. The screen
 * never waits for any of them: the phone has already decided and shown it (UX spec 0.7), and the
 * outbox keeps retrying until the server has the lock, the stop and the results, in the order they
 * happened. A check the server closed itself (a stop that ends it, the pain question, an end yes, a
 * re-ask that postpones, or no test left today, O21) is never completed by the phone.
 */
import {
  betweenTests,
  emergencyAlsoShow,
  endOfCheck,
  evaluatePrecheck,
  evaluateResume,
  faintFollowUp,
  lockEndsAt,
  parseQuestionId,
  possibleQuestions,
  resumeQuestions,
  stopRoute,
  visibleQuestions,
  type AnswerValue,
  type Answers,
  type CheckInConfig,
  type PrecheckEnv,
  type PrecheckOutcome,
  type RemainingTest,
  type SkipItem,
  type TestInstance,
  type TestSide,
} from "../../medical/precheck";
import {
  baseSelection,
  baseTests,
  finalizeProtocol,
  guestContext,
  isBlocked,
  sideLeanOnly,
  type CheckContext,
  type GuestSteps,
  type ProtocolItem,
  type SelectionItem,
} from "../../medical/assessment";
import { precheckItem, testDef } from "../../movements/assessments";
import { ENGINE_VERSION } from "../../engine/modes";
import type {
  CheckPosition,
  LockKind,
  ScreenId as DataScreenId,
  Setting,
  Side,
  StopOptionId,
  Support,
  TestId,
} from "../../movements/types";
import type { AlarmBody, FaintBody, HelperBriefing, LockWhen, TestRef } from "./api";

/* =================================================================== types */

export type FlowMode = "guest" | "signedIn";
export type SoundMode = "voice" | "captionsOnly" | "screenReader";
export type GuestPath = "quick" | "full";
export type GuestStep = 1 | 2 | 3 | 4 | 5 | 6;
export type SafetyKind = "emergency" | "ad" | "faint" | "fall" | "seekCare" | "pain";
export type CameraProblem = "denied" | "none" | "busy" | "stopped";
export type PrepKind = "grip" | "load" | "helper" | "primer";
export type CamKind =
  | "cam.setup"
  | "cam.calibrate"
  | "cam.practice"
  | "cam.countdown"
  | "cam.measure"
  | "cam.saved"
  | "cam.retry"
  | "cam.rest";
/**
 * Why a rest runs (S34j): between attempts, after the practice (chair stand), the seated minute after
 * the chair stand, before a redo (S44), between the sides of the arm raise and the arm curl (S34k),
 * and before the one repeat of a timed test after a quality failure (S34i, 120 s).
 */
export type RestPurpose = "attempt" | "practice" | "seated" | "redo" | "sideChange" | "retryRest";
export type AfterKind = "contact" | "pushed" | "count";
export type BetweenAnswer = "same" | "more" | "much";
/**
 * Where the person goes when the flow ends: Today, the landing, the example page (S54), a workout to
 * try, the demo (/demo), the health profile, My results (S53), sign in (the session ended) or the
 * booth staff screen (S55, the booth code is no longer valid).
 */
export type ExitTarget =
  "today" | "landing" | "example" | "try" | "demo" | "healthEdit" | "results" | "signIn" | "boothStaff";
/** Why the start or resume call did not start the check (contract v2 E, v3 I, round 3). */
export type StartError =
  | "offline"
  | "network"
  | "server"
  | "HOME_CLOSED"
  | "TOO_SOON"
  | "REVIEW"
  | "PLAN_REQUIRED"
  | "BOOTH_CODE"
  | "RATE_LIMIT"
  | "START_INVALID"
  | "PRECHECK_INCOMPLETE"
  | "ADULT_REQUIRED"
  | "NOT_OFFERED"
  | "NOT_OPEN"
  | "AUTH";

/** A full check, or the side lean only session (Q12 (2)). */
export type CheckSession = "full" | "side_lean_only";

/** Start errors a retry can fix; the others never pass on a retry (they route instead). */
export const RETRYABLE_START_ERRORS: readonly StartError[] = ["offline", "network", "server", "RATE_LIMIT"];

/** Where the flow goes after a skip notice or a stop: computed when the skip happens. */
export type Continuation =
  | { to: "side"; i: number; side: number }
  | { to: "test"; i: number }
  | { to: "guestAfterTest"; i: number }
  | { to: "endQuestion" }
  | { to: "results" };

export interface SkipRow {
  testId: TestId;
  side: TestSide;
  reason: string;
}

export type FlowState =
  | { kind: "entry"; error?: "context" | null }
  | { kind: "boothOnly" }
  | { kind: "desktopGate" }
  | { kind: "guestWelcome" }
  | { kind: "adultGate" }
  | { kind: "adultEnd" }
  | { kind: "guestSetup"; step: GuestStep }
  | { kind: "guestStaff" }
  | { kind: "consent" }
  | { kind: "context" }
  /** O6 (2): the line before the re-ask of a resumed check (shown on the notice screen, S16). */
  | { kind: "resumeNotice" }
  | { kind: "intro" }
  | { kind: "soundCheck" }
  | { kind: "precheckNotice" }
  | { kind: "question"; id: string }
  | { kind: "confirmPostpone"; id: string; value: AnswerValue }
  | { kind: "starting"; lastQuestion: string | null; error: StartError | null; attempt: number }
  | { kind: "warnings" }
  | { kind: "plan" }
  | { kind: "test.instruction"; i: number }
  | { kind: "test.grip" | "test.load" | "test.helper" | "test.primer"; i: number; stepDown?: boolean }
  | { kind: "test.practiceCheck"; i: number; side: number }
  | { kind: "cam.setup"; i: number; side: number }
  | { kind: "cam.calibrate"; i: number; side: number; offer: boolean }
  | { kind: "cam.practice"; i: number; side: number }
  | { kind: "cam.countdown"; i: number; side: number }
  | { kind: "cam.measure"; i: number; side: number }
  | { kind: "cam.saved"; i: number; side: number }
  | { kind: "cam.retry"; i: number; side: number; issue: string; exhausted: boolean }
  | { kind: "cam.rest"; i: number; side: number; purpose: RestPurpose }
  | { kind: "after.contact" | "after.pushed" | "after.count"; i: number; side: number }
  | { kind: "between"; i: number; side: number; scope: "side" | "test"; via: "test" | "stop" }
  | { kind: "skipNotice"; rows: SkipRow[]; then: Continuation }
  | { kind: "guestAfterTest"; next: number }
  | { kind: "stopDone"; i: number; restSec: 0 | 60; reason: string }
  | {
      kind: "faintAsk";
      /** The screen "no" returns to (S38 after a faint stop, S39 after a fall stop); S38 by default. */
      back?: { safety: SafetyKind; screen: DataScreenId; alsoShow: DataScreenId[] };
    }
  /** S49: the general form until the server names a side (GET /:id/end, Q23 (7), O37). */
  | { kind: "endQuestion"; side?: Side | null; chronicNote?: boolean }
  | {
      kind: "safety";
      safety: SafetyKind;
      screen: DataScreenId;
      alsoShow: DataScreenId[];
      faintAnswered: boolean;
      /** The faint follow up (S38b, sf_faint_loc) is asked before leaving: faint and fall stops (O42). */
      askFaint?: boolean;
    }
  | { kind: "postponed"; reason: string; screen: DataScreenId | null; alsoShow: DataScreenId[] }
  | { kind: "paused"; until: number | null; releasable: boolean; when?: LockWhen | null }
  | { kind: "cam.problem"; problem: CameraProblem; returnTo: FlowState }
  | { kind: "results" }
  | { kind: "exit"; to: ExitTarget };

export type FlowStateKind = FlowState["kind"];

/** What a check in (S43) or the alarm (S45) opened over. */
export type CheckInFrom = "test" | "stopList" | "faintAsk" | "endQuestion";
/** Overlays a camera trigger replaces and gives back after "I am fine" (section 4.8). */
export type ResumableOverlay =
  { kind: "skipDialog" } | { kind: "goOn"; afterAlarm: boolean; canRedo: boolean };

export type Overlay =
  | { kind: "leave" }
  | { kind: "skipDialog" }
  | { kind: "stopList"; takeYourTime: boolean }
  | {
      kind: "checkIn";
      from: CheckInFrom;
      trigger: string;
      /** From a test: the state was an attempt, so "go on" (S44) and its redo apply. */
      attempt?: boolean;
      resume?: ResumableOverlay;
    }
  /** canRedo: redo only after a check in during an attempt; never re-measure a finished side. */
  | { kind: "goOn"; afterAlarm: boolean; canRedo: boolean }
  | { kind: "alarm"; from: CheckInFrom; attempt?: boolean };

/** One test of today's protocol with the sides that run (skipped sides left out). */
export interface TestRun {
  testId: TestId;
  sides: ProtocolItem[];
}

/** What happened to one test side. `payload` is the result the camera stream measured. */
export interface SideOutcome {
  status: "measured" | "skipped" | "notMeasured";
  reason?: string;
  value?: number | null;
  payload?: unknown;
}

/** Attempts, retries and phases of the side being measured. */
export interface SideRun {
  calibrated: boolean;
  practiced: boolean;
  saved: number;
  retriesUsed: number;
}

/** The device facts sent with the start call and every result (contract v2 E). */
export interface DeviceInfo {
  model: "lite" | "full" | "heavy";
  aspect: number;
  fps: number;
  engineVersion: string;
  appVersion: string;
}

/** Everything the flow needs to know before it starts. */
export interface FlowConfig {
  mode: FlowMode;
  /** This device is in verified booth mode (S55, S55b, contract v3 I). */
  booth: boolean;
  /** Home checks are open (server flag AZM_CHECK_HOME, contract v3 I). */
  homeOpen: boolean;
  /** No touch and wider than 1024 px: offer the phone first (S04). */
  desktop: boolean;
  /** The side lean only session from S01 leanRepeat (Q12 (2)); a full check by default. */
  session?: CheckSession;
}

/** The signed in context (GET /api/assessments/context), normalised by api.ts. */
export interface SignedInContext {
  ctx: CheckContext | null;
  blocked: string | null;
  setting: Setting;
  setup: PrecheckEnv["setup"];
  firstCheck: boolean;
  completedBefore: boolean;
  unresolvedChangeReported: boolean;
  /** Q33 (3): a faint stop is not yet cleared by pc_faint_since (PrecheckEnv.faintReportedUnresolved). */
  faintReportedUnresolved?: boolean;
  lastCheckLasting: boolean;
  sideLeanDoneAtHome?: boolean;
  neededArmsLastStand?: boolean;
  baseTests: string[];
  lock: { until: number | null; releasable: boolean; when?: LockWhen | null } | null;
  /** Epoch ms before which no new check may start (48 hours after the last one), or null. */
  earliestNext?: number | null;
  /** H9: a start now is early (S01 shows scr_early_start before opening the flow). */
  early?: boolean;
  /** Q12 (2): the side lean only session offer, or null. */
  sideLeanRepeat?: { from: number; to: number; baseTests: TestId[] } | null;
  /** O6: the open check that may still resume, or null. */
  openCheck?: { id: string; setting: Setting; resumeUntil: number } | null;
  consent: boolean;
  homeOpen: boolean;
  /** Q2 (5), Q32 (6): the account holds the adult confirmation; without it S05a asks (and posts it). */
  adultConfirmed: boolean;
}

export interface GuestAnswers {
  position?: CheckPosition | "bed";
  support?: Support;
  conditions?: string[];
  clearance?: "yes" | "no" | "unsure";
  pain?: string[];
  restrictions?: string[];
}

export interface FlowData {
  config: FlowConfig;
  setting: Setting;
  device: DeviceInfo;
  guestPath: GuestPath | null;
  guest: GuestAnswers;
  signedIn: SignedInContext | null;
  env: PrecheckEnv | null;
  base: SelectionItem[];
  /** Raw pre-check answers: on the phone only, cleared once the protocol is frozen. */
  answers: Answers;
  soundMode: SoundMode | null;
  /** The proceed outcome of the pre-check (warnings, helpers), on the phone. */
  warnings: DataScreenId[];
  helperRequired: TestId[];
  protocol: ProtocolItem[];
  tests: TestRun[];
  checkId: string | null;
  checkKind: "baseline" | "retest" | null;
  outcomes: Record<string, SideOutcome>;
  cameraUsed: boolean;
  desktopPassed: boolean;
  run: SideRun;
  /** A lock set on the phone (guest: for this visit only; signed in: until the server confirms). */
  lock: { reason: string; until: number | null } | null;
  /** The server has closed this check itself: the phone never completes it. */
  closed: boolean;
  /** The inputs of the check in from the start or resume answer (O34), or null. */
  checkIn: CheckInConfig | null;
  /** The helper briefing of each test that runs with a helper (Q11, O34-2 (2)). */
  helperBriefing: HelperBriefing;
  /** The test side the last stop named (the faint answer names its test, Q33 (3)). */
  stopped: TestRef | null;
  /** A no response alarm (S45) happened in this check: a faint answer then takes the emergency route. */
  noResponseAlarm: boolean;
  /** A resumed check is in its re-ask (O6 (2)): the questions and the rules of evaluateResume. */
  resuming: boolean;
}

export type FlowEffect =
  | { id: number; type: "start"; answers: Answers; setting: Setting; session?: CheckSession }
  | { id: number; type: "startBackground"; answers: Answers; setting: Setting; session?: CheckSession }
  /** The stop names the test side running, or during a rest the next one (resultOnStop). */
  | { id: number; type: "stop"; checkId: string; option: StopOptionId; ref: TestRef | null }
  | { id: number; type: "between"; checkId: string; testId: TestId; side: TestSide; answer: BetweenAnswer }
  | { id: number; type: "result"; checkId: string; body: ResultPayload }
  | { id: number; type: "end"; checkId: string; answer: "yes" | "no" }
  /** GET /api/assessments/:id/end: the side form of the end question (answered with END_FORM). */
  | { id: number; type: "endForm"; checkId: string }
  | { id: number; type: "faint"; checkId: string; body: FaintBody }
  | { id: number; type: "alarm"; checkId: string; body: AlarmBody }
  | { id: number; type: "adult" }
  | { id: number; type: "resume"; checkId: string; answers: Answers }
  | { id: number; type: "resumeBackground"; checkId: string; answers: Answers }
  | { id: number; type: "complete"; checkId: string }
  /** The booth pass was refused: this tab leaves booth mode until staff turn it on again. */
  | { id: number; type: "clearBoothPass" };

/** The body of POST /api/assessments/:id/results (contract v2 E; server validate.ts ResultBody). */
export interface ResultPayload {
  testId: TestId;
  side: TestSide;
  value: number | null;
  unit: string;
  attempts: { value: number | null; valid: boolean; durationSec?: number; flags?: string[] }[];
  quality: Record<string, unknown>;
  detail: Record<string, number | boolean | string>;
  flags: string[];
  nValid: number;
  median: number | null;
  skippedReason: string | null;
  variant: string | null;
  poseModel: DeviceInfo["model"];
  movementVersion: number;
  engineVersion: string;
  /** Quality retries used on this test side (0 to 20), counted once by the server (Q2 (6)). */
  qualityRetries?: number;
}

export interface FlowModel {
  state: FlowState;
  overlay: Overlay | null;
  data: FlowData;
  effects: FlowEffect[];
  nextEffectId: number;
}

/** An open check to continue (S01 resume, O6): its frozen protocol and what is already done. */
export interface ResumeCheck {
  id: string;
  kind: "baseline" | "retest";
  protocol: ProtocolItem[];
  outcomes: Record<string, SideOutcome>;
  /** The check's setting (booth only inside a valid visitor token, O6 (1)); the tab's by default. */
  setting?: Setting;
  /** The check's setup with today's updates (the SCI level answered earlier today). */
  setup?: PrecheckEnv["setup"];
}

/** A start call result (api.ts maps the HTTP answer to this). */
export type StartResult =
  | {
      ok: true;
      id: string;
      kind: "baseline" | "retest";
      /** O21: ended_early when no test runs today (the server closed the check). */
      status?: "open" | "ended_early";
      protocol: ProtocolItem[];
      warnings: string[];
      helperRequired: string[];
      checkIn?: CheckInConfig | null;
      helperBriefing?: HelperBriefing;
    }
  | {
      ok: false;
      code: "POSTPONE";
      status: "postpone" | "emergency" | "ad";
      reason: string;
      screen: DataScreenId | null;
      alsoShow: DataScreenId[];
      lock: { until: number | null; when?: LockWhen | null } | null;
    }
  | { ok: false; code: "LOCKED"; until: number | null; releasable: boolean; when?: LockWhen | null }
  | { ok: false; code: "CONSENT_REQUIRED" }
  | { ok: false; code: StartError };

/** A resume call result (O6): the new skips of the remaining tests, or why it did not resume. */
export type ResumeResult =
  | {
      ok: true;
      skips: SkipItem[];
      warnings: string[];
      helperRequired: string[];
      checkIn: CheckInConfig | null;
    }
  | Exclude<StartResult, { ok: true }>;

type At = { now?: number };

export type FlowEvent = At &
  (
    | { type: "START" }
    | { type: "RESUME"; context: SignedInContext; check: ResumeCheck }
    | { type: "CONTEXT_LOADED"; context: SignedInContext }
    | { type: "CONTEXT_FAILED" }
    | { type: "CONTINUE" }
    | { type: "EXAMPLE" }
    | { type: "TRY_WORKOUT" }
    | { type: "DEMO" }
    | { type: "GUEST_PATH"; path: GuestPath }
    | { type: "ADULT_YES" }
    | { type: "ADULT_NO" }
    | { type: "RESTART" }
    | { type: "GUEST_ANSWER"; step: GuestStep; value: string | string[] }
    | { type: "GUEST_NEXT" }
    | { type: "CONSENT_ACCEPTED" }
    | { type: "NOT_NOW" }
    | { type: "CONTEXT_CONFIRM" }
    | { type: "CONTEXT_EDIT" }
    | { type: "SOUND_RESULT"; mode: SoundMode }
    | { type: "PRECHECK_START" }
    | { type: "ANSWER"; id: string; value: AnswerValue }
    | { type: "CONFIRM_YES" }
    | { type: "CONFIRM_CHANGE" }
    | { type: "START_RESULT"; result: StartResult }
    | { type: "RESUME_RESULT"; result: ResumeResult }
    | { type: "END_FORM"; side: Side | null; chronicNote: boolean }
    | { type: "RETRY" }
    | { type: "PLAN_START" }
    | { type: "READY" }
    | { type: "CHAIR_GATE_NO" }
    | { type: "PREP_NEXT" }
    | { type: "CAMERA_ERROR"; problem: CameraProblem }
    | { type: "SETUP_OK" }
    | { type: "MOTION_REFUSED" }
    | { type: "CALIBRATED" }
    | { type: "CALIBRATION_STILL" }
    | { type: "PRACTICE_DONE"; withLoad?: boolean }
    | { type: "PRACTICE_OK" }
    | { type: "PRACTICE_HEAVY" }
    | { type: "GO" }
    | { type: "ATTEMPT_OK" }
    | { type: "QUALITY_FAIL"; issue: string }
    | { type: "PHONE_MOVED" }
    | { type: "ARMS_USED" }
    | { type: "TRIGGER"; trigger: string }
    | { type: "SAVED_NEXT"; after?: AfterKind }
    | { type: "REST_DONE" }
    | { type: "AFTER_ANSWER"; value: boolean | number }
    | { type: "BETWEEN_ANSWER"; value: BetweenAnswer }
    | { type: "SIDE_RESULT"; testId: TestId; side: TestSide; outcome: SideOutcome; body?: ResultPayload }
    | { type: "SKIP" }
    | { type: "SKIP_CONFIRM" }
    | { type: "SKIP_CANCEL" }
    | { type: "GUEST_NEXT_TEST" }
    | { type: "GUEST_RESULTS" }
    | { type: "STOP" }
    | { type: "STOP_OPTION"; option: StopOptionId | "mistake" }
    | { type: "STOP_NO_INPUT" }
    | { type: "STOP_NEXT" }
    | { type: "STOP_END" }
    | { type: "CHANGE_REASON" }
    | { type: "FINE"; via: "zone" | "raisedHand" | "button" | "speech" }
    | { type: "WANT_STOP" }
    | { type: "NEED_HELP" }
    | { type: "CHECKIN_TIMEOUT" }
    | { type: "REDO" }
    | { type: "SKIP_TEST" }
    | { type: "CALL" }
    | { type: "FAINT_ASK" }
    | { type: "FAINT_ANSWER"; value: "yes" | "no" | "unsure" }
    | { type: "FAINT_TIMEOUT" }
    | { type: "END_ANSWER"; yes: boolean }
    | { type: "RECHECK" }
    | { type: "RELEASE" }
    | { type: "LATER" }
    | { type: "EXIT" }
    | { type: "PROGRESS" }
    | { type: "NEW_VISITOR" }
    | { type: "BACK" }
    | { type: "LEAVE" }
    | { type: "LEAVE_STAY" }
    | { type: "LEAVE_CONFIRM" }
    | { type: "SAFETY"; screen: DataScreenId; alsoShow?: DataScreenId[]; lock?: LockKind | null }
    | { type: "STAFF_RESET" }
    | { type: "EFFECT_DONE"; id: number }
  );

export type FlowEventType = FlowEvent["type"];

/* ================================================================ constants */

/** Screens shown with their test (S28) or at the helper briefing (S26), not before the check (S25). */
const WARNINGS_AT_TEST: readonly string[] = [
  "warn_sci_t6",
  "warn_weak_shoulder",
  "scr_helper_brief_stand",
  "scr_helper_brief_trunk",
];
/** Retries per side after a failed quality gate (spec 2.10): range tests and the side lean 2, timed 1. */
export const RETRIES: Record<TestId, number> = {
  shoulder_abduction: 2,
  trunk_control_seated: 2,
  arm_curl_30s: 1,
  chair_stand_30s: 1,
};
/**
 * Skip reasons the server accepts in a result (server/modules/assessments/validate.ts,
 * CLIENT_SKIP_REASONS; tests/check-api-client.test.ts keeps the two lists equal). A skip with any
 * other reason is kept on the phone and shown with the results, but not posted.
 */
export const POSTABLE_SKIP_REASONS: readonly string[] = [
  "by_choice",
  "quality",
  "stopped_symptom",
  "needed_arms",
  "needed_support",
  "armrests_needed",
  "motion_needed",
  "chair_needed",
  "helper_needed",
];

const EMPTY_RUN: SideRun = { calibrated: false, practiced: false, saved: 0, retriesUsed: 0 };

export const DEFAULT_DEVICE: DeviceInfo = {
  model: "lite",
  aspect: 0.5625,
  fps: 30,
  engineVersion: ENGINE_VERSION,
  appVersion: "0.1.0",
};

/* ================================================================ creation */

export function initialModel(config: FlowConfig, device: DeviceInfo = DEFAULT_DEVICE): FlowModel {
  return {
    state: { kind: "entry", error: null },
    overlay: null,
    data: emptyData(config, device),
    effects: [],
    nextEffectId: 1,
  };
}

function emptyData(config: FlowConfig, device: DeviceInfo): FlowData {
  return {
    config,
    setting: config.mode === "guest" ? "booth" : config.booth ? "booth" : "home",
    device,
    guestPath: null,
    guest: {},
    signedIn: null,
    env: null,
    base: [],
    answers: {},
    soundMode: null,
    warnings: [],
    helperRequired: [],
    protocol: [],
    tests: [],
    checkId: null,
    checkKind: null,
    outcomes: {},
    cameraUsed: false,
    desktopPassed: false,
    run: { ...EMPTY_RUN },
    lock: null,
    closed: false,
    checkIn: null,
    helperBriefing: {},
    stopped: null,
    noResponseAlarm: false,
    resuming: false,
  };
}

/* ================================================================ selectors */

export const outcomeKey = (testId: string, side: string) => `${testId}:${side}`;

const isCamKind = (k: FlowStateKind): k is CamKind => k.startsWith("cam.") && k !== "cam.problem";

/** States during which the camera runs (STOP is shown, principle 6). */
export function cameraRunning(s: FlowState): boolean {
  return (
    isCamKind(s.kind) ||
    s.kind.startsWith("after.") ||
    s.kind === "between" ||
    s.kind === "test.practiceCheck"
  );
}

/** States of an attempt in progress: a check in over them may lead to "go on" and a redo (S44). */
const ATTEMPT_KINDS: readonly FlowStateKind[] = [
  "cam.setup",
  "cam.calibrate",
  "cam.practice",
  "cam.countdown",
  "cam.measure",
  "cam.retry",
  "test.practiceCheck",
];
export function isAttemptState(s: FlowState): boolean {
  return ATTEMPT_KINDS.includes(s.kind);
}

/**
 * States on which the camera check in triggers are armed (section 4.8): every state with the camera
 * running, and the answer zone questions after a faint (S38b) and at the end (S49). STOP keeps its
 * own set (cameraRunning).
 */
export function armedForCheckIn(s: FlowState): boolean {
  return cameraRunning(s) || s.kind === "faintAsk" || s.kind === "endQuestion";
}

/** Safety screens: no Back, no Exit, no idle reset (S36 to S45). */
export function isSafetyState(s: FlowState): boolean {
  return s.kind === "safety" || s.kind === "faintAsk";
}

/** Whether the leave control (S15) is offered on this state. */
export function canLeave(m: FlowModel): boolean {
  const k = m.state.kind;
  if (m.overlay) return false;
  if (cameraRunning(m.state) || isSafetyState(m.state)) return false;
  return !["exit", "entry", "results", "postponed", "paused", "boothOnly", "guestStaff", "adultEnd"].includes(
    k,
  );
}

/** The test and side a state is about, if any. */
export function currentTest(m: FlowModel): { i: number; side: number } | null {
  const s = m.state as { i?: number; side?: number };
  if (typeof s.i !== "number") return null;
  return { i: s.i, side: typeof s.side === "number" ? s.side : 0 };
}

/**
 * The pre-check question counter (O9): n of every question that can still appear today
 * (possibleQuestions), so the total only shrinks as answers come in. The O6 re-ask counts its own
 * questions.
 */
export function questionCounter(m: FlowModel): { n: number; total: number } | null {
  const s = m.state;
  const id = s.kind === "question" || s.kind === "confirmPostpone" ? s.id : null;
  const d = m.data;
  if (!id || !d.env) return null;
  const visible = questionsNow(d, d.answers);
  const at = visible.indexOf(id);
  const n = at < 0 ? visible.length : at + 1;
  const possible = d.resuming ? visible.length : possibleQuestions(d.env, d.answers).length;
  return { n, total: Math.max(n, possible) };
}

/** "Test n of total" (S28 and the camera top bar). */
export function testCounter(m: FlowModel): { n: number; total: number } | null {
  const t = currentTest(m);
  return t ? { n: t.i + 1, total: m.data.tests.length } : null;
}

/** The previous state for Back, or null where Back is not allowed. */
export function backTarget(m: FlowModel): FlowState | null {
  const s = m.state;
  const guest = m.data.config.mode === "guest";
  switch (s.kind) {
    case "adultGate":
      return guest ? { kind: "guestWelcome" } : null;
    case "guestSetup":
      return s.step === 1
        ? { kind: "guestWelcome" }
        : { kind: "guestSetup", step: (s.step - 1) as GuestStep };
    case "intro":
      return guest ? { kind: "guestSetup", step: 6 } : { kind: "context" };
    case "soundCheck":
      return m.data.resuming ? { kind: "resumeNotice" } : { kind: "intro" };
    case "precheckNotice":
      return { kind: "soundCheck" };
    case "question": {
      if (!m.data.env) return null;
      const visible = questionsNow(m.data, m.data.answers);
      const at = visible.indexOf(s.id);
      if (at > 0) return { kind: "question", id: visible[at - 1] };
      return m.data.resuming ? { kind: "soundCheck" } : { kind: "precheckNotice" };
    }
    case "confirmPostpone":
      // Back from the confirm clears the answer that would postpone (stateReducer BACK).
      return { kind: "question", id: s.id };
    case "cam.problem":
      // S32 Back: to the screen it came from (the camera primer, S31), which asks again.
      return s.returnTo;
    case "test.grip":
    case "test.load":
    case "test.helper":
    case "test.primer": {
      const steps = prepSteps(m.data, s.i);
      const at = steps.indexOf(s.kind.slice(5) as PrepKind);
      return at > 0 ? prepState(steps[at - 1], s.i) : { kind: "test.instruction", i: s.i };
    }
    default:
      return null;
  }
}

/** The preparation screens of a test in order (map 2.3): grip, load, helper, camera primer. */
export function prepSteps(d: FlowData, i: number): PrepKind[] {
  const run = d.tests[i];
  if (!run) return [];
  const out: PrepKind[] = [];
  if (
    run.testId === "arm_curl_30s" &&
    d.setting === "home" &&
    run.sides.some((s) => s.variant !== "arm_only")
  ) {
    if (d.env?.firstCheck) out.push("grip");
    out.push("load");
  }
  if (d.setting === "home" && run.sides.some((s) => s.helperRequired)) out.push("helper");
  if (!d.cameraUsed) out.push("primer");
  return out;
}

const prepState = (p: PrepKind, i: number): FlowState => ({ kind: `test.${p}`, i }) as FlowState;

/** Today's tests from the frozen protocol: runnable sides only, tests without one left out. */
export function testsOf(protocol: readonly ProtocolItem[]): TestRun[] {
  const out: TestRun[] = [];
  for (const item of [...protocol].sort((a, b) => a.order - b.order)) {
    if (item.skipped) continue;
    const last = out[out.length - 1];
    if (last && last.testId === item.testId) last.sides.push(item);
    else out.push({ testId: item.testId, sides: [item] });
  }
  return out;
}

/** The screen of a data screen id on the safety path. */
export function safetyKindOf(screen: string): SafetyKind | null {
  switch (screen) {
    case "scr_emergency":
      return "emergency";
    case "scr_ad":
      return "ad";
    case "scr_faint":
    case "scr_faint_sci":
      return "faint";
    case "scr_fall":
    case "scr_fall_seated":
      return "fall";
    case "scr_stop_seek_care":
      return "seekCare";
    case "scr_stop_pain":
      return "pain";
    default:
      return null;
  }
}

/* ================================================================ reducer */

export function flowReducer(m: FlowModel, e: FlowEvent): FlowModel {
  const now = e.now ?? 0;
  // Events that apply in every state.
  switch (e.type) {
    case "EFFECT_DONE":
      return { ...m, effects: m.effects.filter((x) => x.id !== e.id) };
    case "SAFETY": {
      const kind = safetyKindOf(e.screen);
      if (!kind || m.state.kind === "exit") return m;
      const withLock = e.lock ? setLock(m, "server", lockEndsAt(e.lock, now)) : m;
      return toSafety(withLock, kind, e.screen, e.alsoShow ?? []);
    }
    case "STAFF_RESET":
      if (!m.data.config.booth || m.state.kind === "exit") return m;
      return m.data.config.mode === "guest" ? restartGuest(m) : go(m, { kind: "exit", to: "today" });
    case "SIDE_RESULT":
      return recordSide(m, e.testId, e.side, e.outcome, e.body);
    case "LEAVE":
      return canLeave(m) ? { ...m, overlay: { kind: "leave" } } : m;
    case "TRIGGER":
      return trigger(m, e.trigger);
    case "STOP":
      if (!cameraRunning(m.state) || m.overlay?.kind === "stopList") return m;
      if (m.overlay?.kind === "alarm") return m; // the alarm is left only with "I am fine" (S45)
      return { ...m, overlay: { kind: "stopList", takeYourTime: false } };
    case "BACK": {
      if (m.overlay) return m;
      const target = backTarget(m);
      if (!target) return m;
      // Back from the confirm in place drops the answer that would postpone (S17), as "change" does.
      if (m.state.kind === "confirmPostpone") return go(withoutAnswer(m, m.state.id), target);
      return go(m, target);
    }
  }
  if (m.overlay) return overlayReducer(m, e, now);
  return stateReducer(m, e, now);
}

/* ------------------------------------------------------------ overlays */

/**
 * A camera check in trigger (section 4.8), armed per state by the camera screens. S43 opens over any
 * armed state, also over the stop list (fine returns to it), and over S44 or the skip dialog, which it
 * replaces and gives back after "I am fine". It is ignored only while S43 or the alarm is open.
 */
function trigger(m: FlowModel, name: string): FlowModel {
  if (!armedForCheckIn(m.state)) return m;
  const o = m.overlay;
  if (o && (o.kind === "checkIn" || o.kind === "alarm" || o.kind === "leave")) return m;
  const from: CheckInFrom =
    m.state.kind === "faintAsk"
      ? "faintAsk"
      : m.state.kind === "endQuestion"
        ? "endQuestion"
        : o?.kind === "stopList"
          ? "stopList"
          : "test";
  const resume: ResumableOverlay | undefined =
    o?.kind === "goOn" || o?.kind === "skipDialog" ? (o as ResumableOverlay) : undefined;
  return {
    ...m,
    overlay: {
      kind: "checkIn",
      from,
      trigger: name,
      ...(from === "test" ? { attempt: isAttemptState(m.state) } : {}),
      ...(resume ? { resume } : {}),
    },
  };
}

function overlayReducer(m: FlowModel, e: FlowEvent, now: number): FlowModel {
  const o = m.overlay!;
  const close = (x: FlowModel): FlowModel => ({ ...x, overlay: null });
  switch (o.kind) {
    case "leave":
      if (e.type === "LEAVE_STAY") return close(m);
      if (e.type === "LEAVE_CONFIRM") return leaveFlow(close(m));
      return m;
    case "skipDialog":
      if (e.type === "SKIP_CANCEL") return close(m);
      if (e.type === "SKIP_CONFIRM") return skipCurrentTest(close(m), "by_choice");
      return m;
    case "stopList":
      if (e.type === "STOP_OPTION") return stopOption(close(m), e.option, now);
      if (e.type === "STOP_NO_INPUT")
        return { ...m, overlay: { kind: "checkIn", from: "stopList", trigger: "no_answer" } };
      return m;
    case "checkIn":
      if (e.type === "FINE") {
        // Back to what the trigger replaced (S44 or the skip dialog), or by origin: the stop list with
        // "Take your time", the question it opened over (S38b, S49), "go on" (S44) after an attempt,
        // or simply the state (a rest, S47, S48, a saved attempt: nothing is measured again).
        if (o.resume) return { ...m, overlay: o.resume };
        if (o.from === "stopList") return { ...m, overlay: { kind: "stopList", takeYourTime: true } };
        if (o.from === "faintAsk" || o.from === "endQuestion") return close(m);
        return o.attempt ? { ...m, overlay: { kind: "goOn", afterAlarm: false, canRedo: true } } : close(m);
      }
      if (e.type === "WANT_STOP") return { ...m, overlay: { kind: "stopList", takeYourTime: false } };
      if (e.type === "NEED_HELP" || e.type === "CHECKIN_TIMEOUT")
        return {
          ...alarm(m, e.type === "NEED_HELP" ? "help_requested" : "no_response"),
          overlay: {
            kind: "alarm",
            from: o.from,
            ...(o.from === "test" ? { attempt: o.attempt === true } : {}),
          },
        };
      return m;
    case "goOn": {
      if (e.type === "REDO") {
        const t = currentTest(m);
        // Redo only repeats an attempt in progress; after a finished side it just goes on (M23).
        if (!t || !o.canRedo) return close(m);
        return go(close(m), { kind: "cam.rest", i: t.i, side: t.side, purpose: "redo" });
      }
      if (e.type === "SKIP_TEST") return skipCurrentTest(close(m), "by_choice");
      if (e.type === "NEED_HELP")
        return {
          ...alarm(m, "help_requested"),
          overlay: { kind: "alarm", from: "test", attempt: o.canRedo },
        };
      if (e.type === "WANT_STOP" || e.type === "STOP_END")
        return { ...m, overlay: { kind: "stopList", takeYourTime: false } };
      return m;
    }
    case "alarm":
      // Only "I am fine" (button, zone or raised hand) leaves the alarm; a call keeps it (S45). Over a
      // question (the faint follow up S38b, the end question S49) "fine" returns to it; otherwise to
      // "go on" in its after alarm form (S44), with a redo only after an attempt.
      if (e.type === "FINE")
        return o.from === "faintAsk" || o.from === "endQuestion"
          ? close(m)
          : { ...m, overlay: { kind: "goOn", afterAlarm: true, canRedo: o.attempt === true } };
      return m;
  }
}

/**
 * The alarm opens (S45): a signed in check posts it for the anonymous count (O34-5), during the check
 * and in the fall watch after a stop. A no response alarm is remembered: a faint answer after it
 * takes the emergency route (Q33 (3)).
 */
// SPEC-GAP: faint-after-alarm-scope. Q33 (3) says a faint stop "after a no response alarm"; any no
// response alarm earlier in the same check counts (the safer reading).
function alarm(m: FlowModel, kind: AlarmBody["kind"]): FlowModel {
  const d = m.data;
  const next = kind === "no_response" ? { ...m, data: { ...d, noResponseAlarm: true } } : m;
  if (d.config.mode !== "signedIn" || !d.checkId) return next;
  const t = currentTest(m);
  const testId = t ? d.tests[t.i]?.testId : undefined;
  return emit(next, { type: "alarm", checkId: d.checkId, body: { kind, ...(testId ? { testId } : {}) } });
}

/* ------------------------------------------------------------ states */

function stateReducer(m: FlowModel, e: FlowEvent, now: number): FlowModel {
  const s = m.state;
  const d = m.data;
  const guest = d.config.mode === "guest";
  switch (s.kind) {
    case "entry":
      if (e.type === "START") return guest ? routeGuestStart(m) : m;
      if (e.type === "CONTEXT_LOADED") return routeSignedInStart(withContext(m, e.context), now);
      if (e.type === "CONTEXT_FAILED") return go(m, { kind: "entry", error: "context" });
      if (e.type === "RESUME" && !guest) return resume(withContext(m, e.context), e.check, now);
      if (e.type === "RETRY") return go(m, { kind: "entry", error: null });
      return m;

    case "boothOnly":
      if (e.type === "EXAMPLE") return go(m, { kind: "exit", to: "example" });
      // "Watch a demo" (UX spec S05b, map 2.1); a workout to try stays available to the landing.
      if (e.type === "DEMO") return go(m, { kind: "exit", to: "demo" });
      if (e.type === "TRY_WORKOUT") return go(m, { kind: "exit", to: "try" });
      if (e.type === "EXIT") return go(m, { kind: "exit", to: "landing" });
      return m;

    case "desktopGate":
      if (e.type === "CONTINUE") {
        const passed = { ...m, data: { ...d, desktopPassed: true } };
        return guest ? routeGuestStart(passed) : routeSignedInStart(passed, now);
      }
      return m;

    case "guestWelcome":
      if (e.type === "GUEST_PATH")
        return go({ ...m, data: { ...d, guestPath: e.path } }, { kind: "adultGate" });
      if (e.type === "EXAMPLE") return go(m, { kind: "exit", to: "example" });
      return m;

    case "adultGate":
      if (e.type === "ADULT_YES") {
        if (guest) return go(m, { kind: "guestSetup", step: 1 });
        // The account keeps the confirmation (POST /api/account/adult); the start needs it (403
        // ADULT_REQUIRED brings the person back here).
        const si = d.signedIn ? { ...d.signedIn, adultConfirmed: true } : null;
        return emit(go({ ...m, data: { ...d, signedIn: si } }, { kind: "context" }), { type: "adult" });
      }
      if (e.type === "ADULT_NO") return go(m, { kind: "adultEnd" });
      return m;

    case "adultEnd":
      if (e.type === "RESTART" && guest) return restartGuest(m);
      if (e.type === "EXIT") return go(m, { kind: "exit", to: guest ? "landing" : "today" });
      return m;

    case "guestSetup":
      if (e.type === "GUEST_ANSWER" && e.step === s.step) {
        const next = { ...m, data: { ...d, guest: setGuestAnswer(d.guest, s.step, e.value) } };
        // Single choice steps submit on tap (Q18 (2)); multiple choice steps wait for Next.
        return GUEST_MULTI.includes(s.step) ? next : guestAdvance(next, s.step);
      }
      if (e.type === "GUEST_NEXT") {
        const v = guestValue(d.guest, s.step);
        if (v === undefined || (Array.isArray(v) && v.length === 0)) return m;
        return guestAdvance(m, s.step);
      }
      return m;

    case "guestStaff":
      if (e.type === "RESTART") return restartGuest(m);
      if (e.type === "EXAMPLE") return go(m, { kind: "exit", to: "example" });
      return m;

    case "consent":
      if (e.type === "CONSENT_ACCEPTED") {
        const si = d.signedIn ? { ...d.signedIn, consent: true } : null;
        const next = { ...m, data: { ...d, signedIn: si } };
        return go(next, si?.adultConfirmed ? { kind: "context" } : { kind: "adultGate" });
      }
      if (e.type === "NOT_NOW") return go(m, { kind: "exit", to: "today" });
      return m;

    case "context":
      if (e.type === "CONTEXT_CONFIRM") return go(m, { kind: "intro" });
      if (e.type === "CONTEXT_EDIT") return go(m, { kind: "exit", to: "healthEdit" });
      return m;

    case "resumeNotice":
      if (e.type === "CONTINUE") return go(m, { kind: "soundCheck" });
      return m;

    case "intro":
      if (e.type === "CONTINUE") return go(m, { kind: "soundCheck" });
      return m;

    case "soundCheck":
      if (e.type === "SOUND_RESULT") {
        const next = { ...m, data: { ...d, soundMode: e.mode } };
        // O6 (2): after the sound check a resumed check asks its questions again at once.
        return d.resuming ? firstQuestion(next, now) : go(next, { kind: "precheckNotice" });
      }
      return m;

    case "precheckNotice":
      if (e.type === "PRECHECK_START") return firstQuestion(m, now);
      return m;

    case "question":
      if (e.type === "ANSWER" && e.id === s.id) return answer(m, s.id, e.value, now);
      return m;

    case "confirmPostpone":
      if (e.type === "CONFIRM_YES") {
        const outcome = outcomeNow(d, d.answers, now);
        if (outcome.status !== "postpone") return go(m, { kind: "question", id: s.id });
        return postpone(m, outcome, now);
      }
      if (e.type === "CONFIRM_CHANGE") return go(withoutAnswer(m, s.id), { kind: "question", id: s.id });
      return m;

    case "starting":
      if (e.type === "START_RESULT" && !d.resuming) return startResult(m, e.result, now);
      if (e.type === "RESUME_RESULT" && d.resuming) return resumeResult(m, e.result, now);
      if (e.type === "RETRY" && s.error !== null && RETRYABLE_START_ERRORS.includes(s.error)) {
        const next = go(m, {
          kind: "starting",
          lastQuestion: s.lastQuestion,
          error: null,
          attempt: s.attempt + 1,
        });
        return emit(next, startEffect(d));
      }
      if (e.type === "EXIT" && s.error !== null) return go(m, { kind: "exit", to: "today" });
      return m;

    case "warnings":
      if (e.type === "CONTINUE") return go(m, { kind: "plan" });
      return m;

    case "plan":
      if (e.type === "PLAN_START") {
        // The first test with a side still to run (a resumed check goes on where it stopped, O6 (3)).
        const i = nextRunnableTest(m, 0);
        if (i === null) return leaveFlow(m);
        return go(m, { kind: "test.instruction", i });
      }
      return m;

    case "test.instruction":
      if (e.type === "READY") return nextPrep(m, s.i, null);
      if (e.type === "CHAIR_GATE_NO") return skipTest(m, s.i, 0, "chair_needed");
      if (e.type === "SKIP") return { ...m, overlay: { kind: "skipDialog" } };
      return m;

    case "test.grip":
    case "test.load":
    case "test.helper":
    case "test.primer": {
      if (e.type === "PREP_NEXT") {
        const used = s.kind === "test.primer" ? { ...m, data: { ...d, cameraUsed: true } } : m;
        if (s.kind === "test.load" && s.stepDown) {
          return go(used, { kind: "cam.setup", i: s.i, side: sideOf(m) });
        }
        return nextPrep(used, s.i, s.kind.slice(5) as PrepKind);
      }
      if (e.type === "CAMERA_ERROR") return go(m, { kind: "cam.problem", problem: e.problem, returnTo: s });
      return m;
    }

    case "test.practiceCheck":
      if (e.type === "PRACTICE_OK")
        return go(withRun(m, { practiced: true }), { kind: "cam.setup", i: s.i, side: s.side });
      if (e.type === "PRACTICE_HEAVY")
        return go(withRun(m, { practiced: false }), { kind: "test.load", i: s.i, stepDown: true });
      return m;

    case "cam.setup":
    case "cam.calibrate":
    case "cam.practice":
    case "cam.countdown":
    case "cam.measure":
    case "cam.saved":
    case "cam.retry":
    case "cam.rest":
      return camReducer(m, s, e);

    case "after.contact":
    case "after.pushed":
    case "after.count":
      if (e.type === "AFTER_ANSWER") return afterAnswer(m, s, e.value);
      return m;

    case "between":
      if (e.type === "BETWEEN_ANSWER") return betweenAnswer(m, s, e.value, now);
      return m;

    case "skipNotice":
      if (e.type === "CONTINUE") return continueTo(m, s.then);
      return m;

    case "guestAfterTest":
      if (e.type === "GUEST_NEXT_TEST") return go(m, { kind: "test.instruction", i: s.next });
      if (e.type === "GUEST_RESULTS") return toEndQuestion(m);
      return m;

    case "stopDone":
      if (e.type === "STOP_NEXT") return continueTo(m, afterTest(m, s.i));
      if (e.type === "STOP_END") return continueTo(m, finish(m));
      if (e.type === "CHANGE_REASON") return { ...m, overlay: { kind: "stopList", takeYourTime: false } };
      return m;

    case "faintAsk":
      if (e.type === "FAINT_ANSWER") {
        // sf_faint_loc (Q33 (3), O42) with the pure rule the server runs (faintFollowUp): yes or not
        // sure, or any answer after a no response alarm, opens the emergency screen; no returns to
        // the screen of the stop. The answer is posted (POST /:id/faint) with the stopped test.
        const out = faintFollowUp(e.value, now, { afterNoResponse: d.noResponseAlarm });
        let next = m;
        if (!guest && d.checkId) {
          const body: FaintBody = {
            answer: e.value,
            ...(d.noResponseAlarm ? { afterNoResponse: true } : {}),
            ...(d.stopped ? { testId: d.stopped.testId } : {}),
          };
          next = emit(next, { type: "faint", checkId: d.checkId, body });
        }
        if (out.lock?.until) next = setLock(next, out.lock.reason, lockEndsAt(out.lock.until, now));
        if (out.status === "emergency")
          return toSafety(next, "emergency", out.screen ?? "scr_emergency", emergencyAlsoShow(stopEnv(d)));
        const back = s.back ?? { safety: "faint" as const, screen: "scr_faint" as const, alsoShow: [] };
        return go(next, { kind: "safety", ...back, faintAnswered: true, askFaint: true });
      }
      if (e.type === "FAINT_TIMEOUT")
        return { ...m, overlay: { kind: "checkIn", from: "faintAsk", trigger: "no_answer" } };
      return m;

    case "endQuestion":
      if (e.type === "END_FORM")
        return go(m, { kind: "endQuestion", side: e.side, chronicNote: e.chronicNote });
      if (e.type === "END_ANSWER") {
        // ec_symptoms (Q23 (7)) with the pure rule the server runs (endOfCheck). The answer is posted
        // first (POST /:id/end); a no then completes the check, a yes has the server close it.
        const answer = e.yes ? "yes" : "no";
        const out = endOfCheck(answer, now);
        let next = m;
        if (!guest && d.checkId) next = emit(next, { type: "end", checkId: d.checkId, answer });
        if (out.status !== "emergency") return go(completeCheck(next), { kind: "results" });
        let closed = closeCheck(next);
        if (out.lock?.until) closed = setLock(closed, out.lock.reason, lockEndsAt(out.lock.until, now));
        return toSafety(closed, "emergency", out.screen ?? "scr_emergency", emergencyAlsoShow(stopEnv(d)));
      }
      return m;

    case "safety": {
      // The faint follow up (S38b) comes after every faint and fall stop (O42), before leaving.
      const ask = (s.askFaint === true || s.safety === "faint") && !s.faintAnswered;
      const faintAsk: FlowState = {
        kind: "faintAsk",
        back: { safety: s.safety, screen: s.screen, alsoShow: s.alsoShow },
      };
      if (e.type === "FAINT_ASK" && ask) return go(m, faintAsk);
      if (e.type === "EXIT") {
        if (ask) return go(m, faintAsk);
        // Map 2.3: after S40b (much more pain) the end question when any result exists.
        if (s.safety === "pain" && finish(m).to === "endQuestion") return toEndQuestion(m);
        return guest ? restartGuest(m) : go(m, { kind: "exit", to: "today" });
      }
      return m;
    }

    case "postponed":
      if (e.type === "RECHECK" && s.reason === "sci_ready") {
        const answers = { ...d.answers };
        delete answers.pc_sci_ready;
        return go({ ...m, data: { ...d, answers } }, { kind: "question", id: "pc_sci_ready" });
      }
      if (e.type === "EXIT") return guest ? restartGuest(m) : go(m, { kind: "exit", to: "today" });
      return m;

    case "paused":
      // SPEC-GAP: release-question. The care team release opens the pre-check at pc_change_cleared
      // (Appendix A); whether that question is visible for this person is decided by src/medical.
      if (e.type === "RELEASE" && s.releasable && d.env)
        return go({ ...m, data: { ...d, answers: {} } }, { kind: "question", id: "pc_change_cleared" });
      if (e.type === "EXIT") return go(m, { kind: "exit", to: guest ? "landing" : "today" });
      return m;

    case "cam.problem":
      if (e.type === "RETRY") return go(m, s.returnTo);
      if (e.type === "LATER") return go(m, { kind: "exit", to: guest ? "landing" : "today" });
      // "Watch a demo" for guests (map 2.9).
      if (e.type === "DEMO" && guest) return go(m, { kind: "exit", to: "demo" });
      return m;

    case "results":
      if (e.type === "EXIT") return go(m, { kind: "exit", to: guest ? "landing" : "today" });
      if (e.type === "PROGRESS" && !guest) return go(m, { kind: "exit", to: "results" });
      if (e.type === "NEW_VISITOR" && guest) return restartGuest(m);
      return m;

    case "exit":
      return m;
  }
}

/* ------------------------------------------------------------ camera states */

function camReducer(
  m: FlowModel,
  s: Extract<FlowState, { i: number; side: number }>,
  e: FlowEvent,
): FlowModel {
  const { i, side } = s;
  const d = m.data;
  const testId = d.tests[i]?.testId;
  if (!testId) return m;
  const def = testDef(testId);
  const timed = def.kind === "timed_count";
  if (e.type === "CAMERA_ERROR")
    return go(m, { kind: "cam.problem", problem: e.problem, returnTo: { kind: "cam.setup", i, side } });
  switch (s.kind) {
    case "cam.setup":
      if (e.type === "SETUP_OK") {
        const r = d.run;
        if (!r.calibrated) return go(m, { kind: "cam.calibrate", i, side, offer: false });
        if (!r.practiced) return go(m, { kind: "cam.practice", i, side });
        return go(m, timed ? { kind: "cam.countdown", i, side } : { kind: "cam.measure", i, side });
      }
      if (e.type === "SKIP") return { ...m, overlay: { kind: "skipDialog" } };
      // O33 (6): without the motion sensor the side and the rest of the test are skipped (posted).
      if (e.type === "MOTION_REFUSED") return skipTest(m, i, side, "motion_needed");
      return m;
    case "cam.calibrate":
      if (e.type === "CALIBRATED")
        return go(withRun(m, { calibrated: true }), { kind: "cam.practice", i, side });
      if (e.type === "CALIBRATION_STILL") return go(m, { kind: "cam.calibrate", i, side, offer: true });
      if (e.type === "RETRY") return go(m, { kind: "cam.calibrate", i, side, offer: false });
      if (e.type === "SKIP") return { ...m, overlay: { kind: "skipDialog" } };
      return m;
    case "cam.practice": {
      if (e.type !== "PRACTICE_DONE") return m;
      const practiced = withRun(m, { practiced: true });
      const withLoad = e.withLoad ?? (testId === "arm_curl_30s" && prepSteps(d, i).includes("load"));
      if (testId === "arm_curl_30s" && withLoad) return go(m, { kind: "test.practiceCheck", i, side });
      if (testId === "chair_stand_30s")
        return go(practiced, { kind: "cam.rest", i, side, purpose: "practice" });
      return go(practiced, timed ? { kind: "cam.countdown", i, side } : { kind: "cam.measure", i, side });
    }
    case "cam.countdown":
      if (e.type === "GO") return go(m, { kind: "cam.measure", i, side });
      return m;
    case "cam.measure":
      if (e.type === "ATTEMPT_OK")
        return go(withRun(m, { saved: d.run.saved + 1 }), { kind: "cam.saved", i, side });
      if (e.type === "QUALITY_FAIL") return qualityFail(m, i, side, testId, e.issue);
      if (e.type === "PHONE_MOVED") {
        // A moved phone discards the attempt without using a retry and calibrates again from the new
        // picture (map 2.12, engine c472e9c); in a timed trial it ends the trial, which is repeated once
        // as a quality failure, also after a new calibration.
        const recal = withRun(m, { calibrated: false });
        return timed
          ? qualityFail(recal, i, side, testId, "phone_moved")
          : go(recal, { kind: "cam.setup", i, side });
      }
      if (e.type === "ARMS_USED") return go(m, { kind: "after.pushed", i, side });
      return m;
    case "cam.saved":
      if (e.type === "SAVED_NEXT") {
        if (d.run.saved < def.attempts) return go(m, { kind: "cam.rest", i, side, purpose: "attempt" });
        return sideComplete(m, i, side, true, e.after);
      }
      return m;
    case "cam.retry":
      // A timed test repeats once after a 2 minute rest (S34i, map 2.10); the others set up again.
      if (e.type === "RETRY" && !s.exhausted)
        return go(
          m,
          timed ? { kind: "cam.rest", i, side, purpose: "retryRest" } : { kind: "cam.setup", i, side },
        );
      if (e.type === "CONTINUE" && s.exhausted) {
        const marked = recordSide(m, testId, d.tests[i].sides[side].side, {
          status: "notMeasured",
          reason: "quality",
        });
        return sideComplete(marked, i, side, false);
      }
      if (e.type === "SKIP") return { ...m, overlay: { kind: "skipDialog" } };
      return m;
    case "cam.rest":
      if (e.type !== "REST_DONE") return m;
      switch (s.purpose) {
        case "attempt":
          return go(m, { kind: "cam.measure", i, side });
        case "seated":
          return go(m, { kind: "between", i, side, scope: "test", via: "test" });
        case "practice":
        case "redo":
        case "sideChange":
        case "retryRest":
          return go(m, { kind: "cam.setup", i, side });
      }
  }
  return m;
}

function qualityFail(m: FlowModel, i: number, side: number, testId: TestId, issue: string): FlowModel {
  const used = m.data.run.retriesUsed;
  if (used < RETRIES[testId])
    return go(withRun(m, { retriesUsed: used + 1 }), { kind: "cam.retry", i, side, issue, exhausted: false });
  return go(m, { kind: "cam.retry", i, side, issue, exhausted: true });
}

/**
 * A side is finished (measured or not measured). Arm raise and arm curl ask the pain question for
 * the side (S47); the side lean asks the contact question per measured side (S48), then S47 once
 * for the test (O31); the chair stand rests seated for a minute, then S47.
 */
function sideComplete(
  m: FlowModel,
  i: number,
  side: number,
  measured: boolean,
  after?: AfterKind,
): FlowModel {
  const testId = m.data.tests[i].testId;
  if (after && measured) return go(m, { kind: `after.${after}`, i, side } as FlowState);
  switch (testId) {
    case "trunk_control_seated":
      if (measured) return go(m, { kind: "after.contact", i, side });
      return hasNextSide(m, i, side)
        ? nextSide(m, i, side)
        : go(m, { kind: "between", i, side, scope: "test", via: "test" });
    case "chair_stand_30s":
      return measured
        ? go(m, { kind: "cam.rest", i, side, purpose: "seated" })
        : go(m, { kind: "between", i, side, scope: "test", via: "test" });
    default:
      return go(m, { kind: "between", i, side, scope: "side", via: "test" });
  }
}

function afterAnswer(
  m: FlowModel,
  s: Extract<FlowState, { kind: `after.${AfterKind}` }>,
  value: boolean | number,
): FlowModel {
  const { i, side } = s;
  if (s.kind === "after.pushed" && value === true) {
    // Pushed with the hands: the stand stops with needed_arms, which is fine (spec 4.4).
    return skipTest(m, i, side, "needed_arms");
  }
  if (s.kind === "after.contact") {
    return hasNextSide(m, i, side)
      ? nextSide(m, i, side)
      : go(m, { kind: "between", i, side, scope: "test", via: "test" });
  }
  const testId = m.data.tests[i].testId;
  if (testId === "chair_stand_30s") return go(m, { kind: "cam.rest", i, side, purpose: "seated" });
  return go(m, { kind: "between", i, side, scope: "side", via: "test" });
}

function hasNextSide(m: FlowModel, i: number, side: number): boolean {
  return side + 1 < m.data.tests[i].sides.length && !isDone(m, i, side + 1);
}

function nextSide(m: FlowModel, i: number, side: number): FlowModel {
  return toSide(m, i, side + 1);
}

/** Tests with a rest between their sides (S34j side change: abduction 20 s, arm curl at least 60 s). */
const SIDE_CHANGE_REST: readonly TestId[] = ["shoulder_abduction", "arm_curl_30s"];

/**
 * The next side of test i (S34k). The arm raise calibrates once per check, so its second side goes
 * straight to the practice lift; the other tests calibrate for each side. Tests with a side change
 * rest (S34j) rest first, then set up.
 */
function toSide(m: FlowModel, i: number, side: number): FlowModel {
  const testId = m.data.tests[i]?.testId;
  const keep = testId === "shoulder_abduction" && m.data.run.calibrated;
  const run: SideRun = { ...EMPTY_RUN, calibrated: keep };
  const next = { ...m, data: { ...m.data, run } };
  if (testId && SIDE_CHANGE_REST.includes(testId))
    return go(next, { kind: "cam.rest", i, side, purpose: "sideChange" });
  return go(next, { kind: "cam.setup", i, side });
}

/** A side already has an outcome today (skipped by the pain question, for example). */
function isDone(m: FlowModel, i: number, side: number): boolean {
  const item = m.data.tests[i]?.sides[side];
  return !!item && outcomeKey(item.testId, item.side) in m.data.outcomes;
}

/* ------------------------------------------------------------ between tests (S47) */

function betweenAnswer(
  m: FlowModel,
  s: Extract<FlowState, { kind: "between" }>,
  value: BetweenAnswer,
  now: number,
): FlowModel {
  const d = m.data;
  const run = d.tests[s.i];
  const item = run.sides[s.side];
  const done: TestInstance = instanceOf(item);
  const remaining = remainingInstances(
    m,
    s.i,
    s.scope === "side" && s.via === "test" ? s.side : run.sides.length - 1,
  );
  const out = betweenTests({ bt_pain_after: value }, done, remaining);
  let next = m;
  if (d.config.mode === "signedIn" && d.checkId)
    next = emit(next, {
      type: "between",
      checkId: d.checkId,
      testId: item.testId,
      side: item.side,
      answer: value,
    });
  if (out.status === "end") {
    // The server ends the check itself (ended early), so the phone never completes it.
    const ended = d.config.mode === "signedIn" ? closeCheck(next) : next;
    const locked = out.lock?.until ? setLock(ended, out.lock.reason, lockEndsAt(out.lock.until, now)) : ended;
    return toSafety(locked, "pain", out.screen ?? "scr_stop_pain", []);
  }
  const then: Continuation =
    s.via === "test" && s.scope === "side" && hasNextSide(next, s.i, s.side)
      ? { to: "side", i: s.i, side: s.side + 1 }
      : afterTest(next, s.i);
  if (out.status === "skip") {
    const rows: SkipRow[] = out.skips.map((k) => ({ testId: k.testId, side: k.side, reason: k.reason }));
    let marked = next;
    for (const r of rows)
      marked = recordSide(marked, r.testId, r.side, { status: "skipped", reason: r.reason });
    // The continuation is computed again: the skipped sides are no longer next.
    const after =
      s.via === "test" && s.scope === "side" && hasNextSide(marked, s.i, s.side)
        ? ({ to: "side", i: s.i, side: s.side + 1 } as Continuation)
        : afterTest(marked, s.i);
    return go(marked, { kind: "skipNotice", rows, then: after });
  }
  return continueTo(next, then);
}

function instanceOf(item: ProtocolItem): TestInstance {
  const t: TestInstance = { testId: item.testId, side: item.side };
  if (item.variant) t.variant = item.variant;
  if (item.pushHand) t.pushHand = item.pushHand;
  return t;
}

/** Test sides still to run after test i side `side`, without the ones already decided today. */
function remainingInstances(m: FlowModel, i: number, side: number): TestInstance[] {
  const out: TestInstance[] = [];
  m.data.tests.forEach((run, ti) =>
    run.sides.forEach((item, si) => {
      if (ti < i || (ti === i && si <= side)) return;
      if (outcomeKey(item.testId, item.side) in m.data.outcomes) return;
      out.push(instanceOf(item));
    }),
  );
  return out;
}

/* ------------------------------------------------------------ continuations */

/** Where the flow goes once test i is over (map 2.3). */
function afterTest(m: FlowModel, i: number): Continuation {
  const next = nextRunnableTest(m, i + 1);
  if (next === null) return finish(m);
  const finished = m.data.tests[i]?.sides.some(
    (item) => m.data.outcomes[outcomeKey(item.testId, item.side)]?.status === "measured",
  );
  if (m.data.config.mode === "guest" && finished) return { to: "guestAfterTest", i: next };
  return { to: "test", i: next };
}

function nextRunnableTest(m: FlowModel, from: number): number | null {
  for (let j = from; j < m.data.tests.length; j++) {
    if (m.data.tests[j].sides.some((_, si) => !isDone(m, j, si))) return j;
  }
  return null;
}

/** The end of the check: the end question when anything was measured or tried, else the results. */
function finish(m: FlowModel): Continuation {
  const tried = Object.values(m.data.outcomes).some(
    (o) => o.status === "measured" || o.status === "notMeasured",
  );
  return tried ? { to: "endQuestion" } : { to: "results" };
}

function continueTo(m: FlowModel, c: Continuation): FlowModel {
  switch (c.to) {
    case "side":
      return toSide(m, c.i, c.side);
    case "test": {
      const reset = { ...m, data: { ...m.data, run: { ...EMPTY_RUN } } };
      return go(reset, { kind: "test.instruction", i: c.i });
    }
    case "guestAfterTest":
      return go({ ...m, data: { ...m.data, run: { ...EMPTY_RUN } } }, { kind: "guestAfterTest", next: c.i });
    case "endQuestion":
      return toEndQuestion(m);
    case "results":
      return go(completeCheck(m), { kind: "results" });
  }
}

/* ------------------------------------------------------------ skips */

/** Skips the current side and the rest of test i with a reason, then shows S46. */
function skipTest(m: FlowModel, i: number, fromSide: number, reason: string): FlowModel {
  const run = m.data.tests[i];
  if (!run) return m;
  let next = m;
  const rows: SkipRow[] = [];
  run.sides.forEach((item, si) => {
    if (si < fromSide || isDone(next, i, si)) return;
    rows.push({ testId: item.testId, side: item.side, reason });
    next = recordSide(next, item.testId, item.side, { status: "skipped", reason });
  });
  return go(next, { kind: "skipNotice", rows, then: afterTest(next, i) });
}

function skipCurrentTest(m: FlowModel, reason: string): FlowModel {
  const t = currentTest(m);
  if (!t) return m;
  return skipTest(m, t.i, t.side, reason);
}

/* ------------------------------------------------------------ stop list (S41) */

function stopOption(m: FlowModel, option: StopOptionId | "mistake", now: number): FlowModel {
  const d = m.data;
  const t = currentTest(m);
  if (option === "mistake") {
    // "I pressed Stop by mistake": back to the setup check, same attempt, no retry used, not logged.
    const s = m.state;
    if (isCamKind(s.kind) && t) return go(m, { kind: "cam.setup", i: t.i, side: t.side });
    return m;
  }
  // Without the context (a resumed check whose context is blocked, for example) the routing never
  // fails open: it reads the most conservative person (stopEnv).
  const env = stopEnv(d);
  const route = stopRoute(option, env);
  // The stop names the test side running, or during a rest the next one to run (resultOnStop): the
  // server writes that side's skip row itself (flag stopped) and refuses a later score for it. The
  // other sides left in the stopped test are recorded too and their skips posted first, so they
  // reach the server before a stop that ends the check (the outbox sends in order).
  const anchor = t ? openSideFrom(m, t.i, t.side) : null;
  const ref: TestRef | null =
    t && anchor !== null
      ? { testId: d.tests[t.i].sides[anchor].testId, side: d.tests[t.i].sides[anchor].side }
      : null;
  let next = t ? markRestOfTest(m, t.i, t.side, route.reason, anchor) : m;
  next = { ...next, data: { ...next.data, stopped: ref ?? (t ? stoppedTestOf(m, t.i) : null) } };
  if (d.config.mode === "signedIn" && d.checkId) {
    next = emit(next, { type: "stop", checkId: d.checkId, option, ref });
    if (route.endsCheck) next = closeCheck(next);
  }
  if (route.lock?.until) next = setLock(next, route.lock.reason, lockEndsAt(route.lock.until, now));
  const kind = route.screen ? safetyKindOf(route.screen) : null;
  if (route.screen && kind) {
    // O12 (1): scr_ad joins scr_emergency for SCI, as the server's answer does.
    const alsoShow =
      route.screen === "scr_emergency"
        ? [...new Set([...route.alsoShow, ...emergencyAlsoShow(env)])]
        : route.alsoShow;
    const safety = toSafety(next, kind, route.screen, alsoShow);
    // Faint and fall stops ask the faint follow up (S38b) before leaving (O42).
    return route.then === "sf_faint_loc" && safety.state.kind === "safety"
      ? { ...safety, state: { ...safety.state, askFaint: true } }
      : safety;
  }
  if (!t) return next;
  if (route.then === "bt_pain_after")
    return go(next, { kind: "between", i: t.i, side: t.side, scope: "test", via: "stop" });
  return go(next, { kind: "stopDone", i: t.i, restSec: route.afterRest ? 60 : 0, reason: route.reason });
}

/**
 * The stopped test stores no score: its current and remaining sides get the stop reason. The side the
 * stop names (`anchor`) is kept on the phone only: the stop itself writes its row on the server.
 */
function markRestOfTest(
  m: FlowModel,
  i: number,
  fromSide: number,
  reason: string,
  anchor: number | null,
): FlowModel {
  let next = m;
  m.data.tests[i]?.sides.forEach((item, si) => {
    if (si < fromSide || isDone(next, i, si)) return;
    next = recordSide(next, item.testId, item.side, { status: "skipped", reason }, undefined, si !== anchor);
  });
  return next;
}

/** The first side of test i from `from` without an outcome today, or null. */
function openSideFrom(m: FlowModel, i: number, from: number): number | null {
  const sides = m.data.tests[i]?.sides ?? [];
  for (let si = from; si < sides.length; si++) if (!isDone(m, i, si)) return si;
  return null;
}

/** The test a stop happened in, for the faint answer when the stop named no side (S47 after it). */
function stoppedTestOf(m: FlowModel, i: number): TestRef | null {
  const item = m.data.tests[i]?.sides[0];
  return item ? { testId: item.testId, side: item.side } : null;
}

/**
 * The environment of the stop routing: the context with today's setup. Without one (the context is
 * blocked or was never loaded) the most conservative reading: seated (the seated fall screen), SCI at
 * T6 or above (the SCI faint line and the AD option), so no symptom stop is ever left unrouted.
 */
export function stopEnv(d: FlowData): PrecheckEnv {
  if (d.env) return d.env;
  return {
    setting: d.setting,
    ctx: {
      position: "chair",
      support: "none",
      pain: [],
      restrictions: [],
      conditions: ["sci_complete"],
      clearance: "unsure",
    },
    setup: { sciT6: true },
    firstCheck: false,
    unresolvedChangeReported: false,
    lastCheckLasting: false,
    baseTests: [],
  };
}

/** The pre-check answers without one question (S17 change my answer, Back from the confirm). */
function withoutAnswer(m: FlowModel, id: string): FlowModel {
  const answers = { ...m.data.answers };
  delete answers[id];
  return { ...m, data: { ...m.data, answers } };
}

/* ------------------------------------------------------------ pre-check */

/**
 * The test sides a resumed check still has to run (O6 (2)): not skipped at the start and without an
 * outcome today, with the helper each requires.
 */
function remainingOf(d: FlowData): RemainingTest[] {
  return d.protocol
    .filter((i) => !i.skipped && !(outcomeKey(i.testId, i.side) in d.outcomes))
    .map((i) => ({ testId: i.testId, helperRequired: i.helperRequired === true }));
}

/** The questions visible now: the pre-check, or while resuming the O6 re-ask (resumeQuestions). */
export function questionsNow(d: FlowData, answers: Answers): string[] {
  if (!d.env) return [];
  return d.resuming ? resumeQuestions(d.env, answers, remainingOf(d)) : visibleQuestions(d.env, answers);
}

/** The outcome of the answers now: the pre-check, or while resuming evaluateResume (as the server). */
function outcomeNow(d: FlowData, answers: Answers, now: number): PrecheckOutcome {
  return d.resuming
    ? evaluateResume(d.env!, answers, remainingOf(d), now)
    : evaluatePrecheck(d.env!, answers, now);
}

function firstQuestion(m: FlowModel, now: number): FlowModel {
  if (!m.data.env) return m;
  const visible = questionsNow(m.data, m.data.answers);
  if (visible.length === 0) return proceed(m, outcomeNow(m.data, m.data.answers, now), null);
  return go(m, { kind: "question", id: visible[0] });
}

/** Answers that belong to questions no longer visible are dropped (S17 Back rule). */
function prune(d: FlowData, answers: Answers): Answers {
  let current = answers;
  for (let round = 0; round < 6; round++) {
    const visible = new Set(questionsNow(d, current));
    const kept: Answers = {};
    for (const [k, v] of Object.entries(current)) if (visible.has(k)) kept[k] = v;
    if (Object.keys(kept).length === Object.keys(current).length) return kept;
    current = kept;
  }
  return current;
}

function answer(m: FlowModel, id: string, value: AnswerValue, now: number): FlowModel {
  const d = m.data;
  const answers = prune(d, { ...d.answers, [id]: value });
  const next = { ...m, data: { ...d, answers } };
  const outcome = outcomeNow(d, answers, now);
  // Emergency and AD route at once, with no confirm (S17 exception 2).
  if (outcome.status === "emergency" || outcome.status === "ad") return terminal(next, outcome, now);
  if (outcome.status === "postpone") {
    // The confirm in place opens on the question whose answer postpones: this one when it changed the
    // outcome, else the earlier answer that still postpones (never a trap on an unrelated question).
    const culprit = postponingQuestion(d, answers, id, now);
    return go(next, { kind: "confirmPostpone", id: culprit, value: answers[culprit] });
  }
  const visible = questionsNow(d, answers);
  const at = visible.indexOf(id);
  const following = at >= 0 ? visible[at + 1] : undefined;
  if (following) return go(next, { kind: "question", id: following });
  const missing = visible.find((q) => !(q in answers));
  if (missing) return go(next, { kind: "question", id: missing });
  if (outcome.status !== "proceed") return go(next, { kind: "question", id });
  return proceed(next, outcome, id);
}

/**
 * The question to confirm when the answers postpone: `id` when its answer made the difference,
 * otherwise the first visible answered question without which the check would not postpone.
 */
function postponingQuestion(d: FlowData, answers: Answers, id: string, now: number): string {
  const postpones = (a: Answers) => outcomeNow(d, prune(d, a), now).status === "postpone";
  const without = (q: string) => {
    const a = { ...answers };
    delete a[q];
    return a;
  };
  // Only a question with a postpone action can postpone (pc_urgent, for one, never does).
  const culprit = (q: string) =>
    q in answers && !!questionOf(q)?.item.actions.some((a) => a.do === "postpone") && !postpones(without(q));
  if (culprit(id)) return id;
  return questionsNow(d, answers).find(culprit) ?? id;
}

/**
 * The server is told in the background about a pre-check (or O6 re-ask) that the phone already
 * postponed or routed to a safety screen: the start call, or for a resumed check the resume call,
 * which closes it as ended early with its finished results kept (O6 (2)).
 */
function tellServer(m: FlowModel): FlowModel {
  const d = m.data;
  if (d.config.mode !== "signedIn") return m;
  if (d.resuming && d.checkId)
    return closeCheck(emit(m, { type: "resumeBackground", checkId: d.checkId, answers: d.answers }));
  const session = d.config.session ?? "full";
  return emit(m, {
    type: "startBackground",
    answers: d.answers,
    setting: d.setting,
    ...(session !== "full" ? { session } : {}),
  });
}

/** Emergency or AD from the pre-check: the safety screen now, the server told in the background. */
function terminal(m: FlowModel, outcome: PrecheckOutcome, now: number): FlowModel {
  let next = m;
  if (outcome.lock?.until) next = setLock(next, outcome.lock.reason, lockEndsAt(outcome.lock.until, now));
  next = tellServer(next);
  const screen = outcome.screen ?? (outcome.status === "ad" ? "scr_ad" : "scr_emergency");
  return toSafety(next, outcome.status === "ad" ? "ad" : "emergency", screen, outcome.alsoShow ?? []);
}

function postpone(m: FlowModel, outcome: PrecheckOutcome, now: number): FlowModel {
  let next = m;
  if (outcome.lock?.until) next = setLock(next, outcome.lock.reason, lockEndsAt(outcome.lock.until, now));
  next = tellServer(next);
  return go(next, {
    kind: "postponed",
    reason: outcome.reason ?? "unwell",
    screen: outcome.screen ?? null,
    alsoShow: outcome.alsoShow ?? [],
  });
}

function proceed(m0: FlowModel, outcome: PrecheckOutcome, lastQuestion: string | null): FlowModel {
  if (outcome.status !== "proceed" || !m0.data.env) return m0;
  // The stop routing reads today's setup (stopRoute: env.setup includes today's setupUpdates).
  const env0 = m0.data.env;
  const env: PrecheckEnv = { ...env0, setup: { ...env0.setup, ...outcome.setupUpdates } };
  const m = { ...m0, data: { ...m0.data, env } };
  const d = m.data;
  if (d.config.mode === "signedIn") {
    const next = go(m, { kind: "starting", lastQuestion, error: null, attempt: 1 });
    // (the start or resume call itself is awaited by the starting state)
    return emit(next, startEffect(d));
  }
  // The guest check runs the same rules on the phone and stores nothing (contract v3 I).
  const protocol = finalizeProtocol(d.base, outcome, env.ctx, d.setting, null);
  return frozen(m, protocol, outcome.warnings, outcome.helperRequired, null, null);
}

/** The start (or the resume) call of the answers on the phone. */
function startEffect(d: FlowData): DistributiveOmit<FlowEffect, "id"> {
  if (d.resuming && d.checkId) return { type: "resume", checkId: d.checkId, answers: d.answers };
  const session = d.config.session ?? "full";
  return {
    type: "start",
    answers: d.answers,
    setting: d.setting,
    ...(session !== "full" ? { session } : {}),
  };
}

/** The protocol is frozen: raw answers are dropped from the phone (spec 5.10). */
function frozen(
  m: FlowModel,
  protocol: ProtocolItem[],
  warnings: readonly string[],
  helperRequired: readonly string[],
  checkId: string | null,
  checkKind: FlowData["checkKind"],
  extra: Partial<FlowData> = {},
): FlowModel {
  const before = warnings.filter((w) => !WARNINGS_AT_TEST.includes(w)) as DataScreenId[];
  // A new check: nothing of an earlier one on this page carries over.
  const data: FlowData = {
    ...m.data,
    answers: {},
    outcomes: {},
    closed: false,
    stopped: null,
    noResponseAlarm: false,
    resuming: false,
    protocol,
    tests: testsOf(protocol),
    warnings: warnings as DataScreenId[],
    helperRequired: helperRequired as TestId[],
    checkId,
    checkKind,
    run: { ...EMPTY_RUN },
    ...extra,
  };
  return go({ ...m, data }, before.length ? { kind: "warnings" } : { kind: "plan" });
}

/** The paused screen (S35) of a lock: when it ends, the care team release and its {when}. */
function pausedOf(lock: { until: number | null; releasable: boolean; when?: LockWhen | null }): FlowState {
  return {
    kind: "paused",
    until: lock.until,
    releasable: lock.releasable,
    ...(lock.when ? { when: lock.when } : {}),
  };
}

function startResult(m: FlowModel, r: StartResult, now: number): FlowModel {
  const s = m.state as Extract<FlowState, { kind: "starting" }>;
  if (r.ok)
    return frozen(m, r.protocol, r.warnings, r.helperRequired, r.id, r.kind, {
      checkIn: r.checkIn ?? null,
      helperBriefing: r.helperBriefing ?? {},
      // O21: no test runs today; the server closed the check and started no clock.
      closed: r.status === "ended_early",
    });
  return startFailure(m, s, r, now);
}

/** A start or resume call that did not go ahead: the stricter screen, a pause, or where to go. */
function startFailure(
  m: FlowModel,
  s: Extract<FlowState, { kind: "starting" }>,
  r: Exclude<StartResult, { ok: true }>,
  now: number,
): FlowModel {
  switch (r.code) {
    case "POSTPONE": {
      // The server is authoritative; the phone shows the stricter of the two (map 2.2). A resumed
      // check that postpones is closed as ended early by the server (O6 (2)).
      const base = m.data.resuming ? closeCheck(m) : m;
      const withLock = r.lock?.until ? setLock(base, r.reason, r.lock.until) : base;
      if (r.status === "emergency" || r.status === "ad") {
        const screen = r.screen ?? (r.status === "ad" ? "scr_ad" : "scr_emergency");
        return toSafety(withLock, r.status === "ad" ? "ad" : "emergency", screen, r.alsoShow);
      }
      return go(withLock, { kind: "postponed", reason: r.reason, screen: r.screen, alsoShow: r.alsoShow });
    }
    case "LOCKED":
      return go(m, pausedOf(r));
    case "CONSENT_REQUIRED":
      // A resumed check whose consent was revoked meanwhile is not continued (S01 offers a new one).
      return go(m, m.data.resuming ? { kind: "exit", to: "today" } : { kind: "consent" });
    case "ADULT_REQUIRED": {
      // Q32 (6): the account has no adult confirmation (it was not saved): S05a asks again.
      const d = m.data;
      const si = d.signedIn ? { ...d.signedIn, adultConfirmed: false } : null;
      return go({ ...m, data: { ...d, signedIn: si } }, { kind: "adultGate" });
    }
    // Answers a retry cannot change route instead of offering Try again. NOT_OPEN: the resumed check
    // closed meanwhile (30 minutes idle, O6 (4)); S01 shows its results.
    case "TOO_SOON":
    case "HOME_CLOSED":
    case "REVIEW":
    case "PLAN_REQUIRED":
    case "START_INVALID":
    case "PRECHECK_INCOMPLETE":
    case "NOT_OFFERED":
    case "NOT_OPEN":
      // SPEC-GAP: start-final-errors. The spec has no screen for these; Today shows the entry card
      // variant that explains them (S01 tooSoon, homeSoon, blocked, endedEarly).
      void now;
      return go(m, { kind: "exit", to: "today" });
    case "BOOTH_CODE":
      // The booth pass was refused (the day, the hours, a used or ended token): booth mode ends on this
      // tab and staff turn it on again (S55, S55b); the effect clears the pass.
      return emit(go(m, { kind: "exit", to: "boothStaff" }), { type: "clearBoothPass" });
    case "AUTH":
      return go(m, { kind: "exit", to: "signIn" });
    default:
      return go(m, { kind: "starting", lastQuestion: s.lastQuestion, error: r.code, attempt: s.attempt });
  }
}

/* ------------------------------------------------------------ entry routing */

/**
 * Continue an open check (Appendix A: resume; O6), after the same gates as a new start: a blocked
 * context or closed home checks leave, a lock pauses, a missing consent asks for it. Then the O6 line
 * (S16), the sound check (S14b) and the day of questions again (resumeQuestions), which the server
 * evaluates on POST /:id/resume; the check goes on at the next unfinished test from its first attempt
 * (S28, O6 (3)). With nothing left to run, the end question and the results.
 */
function resume(m: FlowModel, c: ResumeCheck, now: number): FlowModel {
  const gate = entryGate(m, now);
  if (gate) return go(m, gate);
  const d = m.data;
  // O6 (1): a booth check resumes only inside booth mode (the visitor token), never at home.
  if (c.setting === "booth" && !d.config.booth) return go(m, { kind: "exit", to: "today" });
  // The environment of the running check, as the server builds it (runningEnv): its setting, its
  // setup with today's updates and its tests; the one time questions are not asked again.
  const env: PrecheckEnv | null = d.env
    ? {
        ...d.env,
        setting: c.setting ?? d.setting,
        setup: c.setup !== undefined ? c.setup : d.env.setup,
        firstCheck: false,
        unresolvedChangeReported: false,
        lastCheckLasting: false,
        baseTests: [...new Set(c.protocol.map((i) => i.testId))],
      }
    : null;
  const data: FlowData = {
    ...d,
    setting: c.setting ?? d.setting,
    env,
    protocol: c.protocol,
    tests: testsOf(c.protocol),
    checkId: c.id,
    checkKind: c.kind,
    outcomes: { ...c.outcomes },
    answers: {},
    run: { ...EMPTY_RUN },
    resuming: true,
  };
  const next = { ...m, data };
  if (nextRunnableTest(next, 0) === null)
    return toEndQuestion({ ...next, data: { ...data, resuming: false } });
  return go(next, { kind: "resumeNotice" });
}

/**
 * The resume call's answer (O6 (2), (3)): the new skips of the remaining tests (the server stored
 * them), today's warnings and check in inputs, then the next unfinished test from its first attempt.
 */
function resumeResult(m: FlowModel, r: ResumeResult, now: number): FlowModel {
  const s = m.state as Extract<FlowState, { kind: "starting" }>;
  if (!r.ok) {
    // Try again repeats the resume call; any other way out leaves the re-ask.
    const out = startFailure(m, s, r, now);
    return out.state.kind === "starting" ? out : { ...out, data: { ...out.data, resuming: false } };
  }
  let next: FlowModel = m;
  for (const k of r.skips)
    next = recordSide(next, k.testId, k.side, { status: "skipped", reason: k.reason }, undefined, false);
  const d = next.data;
  const warnings = r.warnings as DataScreenId[];
  const data: FlowData = {
    ...d,
    answers: {},
    resuming: false,
    warnings,
    helperRequired: r.helperRequired as TestId[],
    checkIn: r.checkIn ?? d.checkIn,
    run: { ...EMPTY_RUN },
  };
  const ready = { ...next, data };
  if (warnings.some((w) => !WARNINGS_AT_TEST.includes(w))) return go(ready, { kind: "warnings" });
  const i = nextRunnableTest(ready, 0);
  return i === null ? toEndQuestion(ready) : go(ready, { kind: "test.instruction", i });
}

function routeGuestStart(m: FlowModel): FlowModel {
  const c = m.data.config;
  // /?check=1 runs only on a device in verified booth mode (contract v3 I, S05b).
  if (!c.booth) return go(m, { kind: "boothOnly" });
  if (c.desktop && !m.data.desktopPassed) return go(m, { kind: "desktopGate" });
  return go(m, { kind: "guestWelcome" });
}

function withContext(m: FlowModel, c: SignedInContext): FlowModel {
  const d = m.data;
  const setting: Setting = d.config.booth ? "booth" : "home";
  // The side lean only session asks the questions of its one test (server precheckEnv, Q12 (2)).
  const leanOnly = (d.config.session ?? "full") === "side_lean_only";
  const full = c.ctx ? baseSelection(c.ctx, setting, c.setup) : [];
  const base = leanOnly ? sideLeanOnly(full) : full;
  const env: PrecheckEnv | null = c.ctx
    ? {
        setting,
        ctx: c.ctx,
        setup: c.setup,
        firstCheck: c.firstCheck,
        unresolvedChangeReported: c.unresolvedChangeReported,
        lastCheckLasting: c.lastCheckLasting,
        baseTests: leanOnly ? baseTests(base) : c.baseTests,
        completedBefore: c.completedBefore,
        ...(c.sideLeanDoneAtHome !== undefined ? { sideLeanDoneAtHome: c.sideLeanDoneAtHome } : {}),
        ...(c.neededArmsLastStand !== undefined ? { neededArmsLastStand: c.neededArmsLastStand } : {}),
        ...(c.faintReportedUnresolved !== undefined
          ? { faintReportedUnresolved: c.faintReportedUnresolved }
          : {}),
      }
    : null;
  const config = { ...d.config, homeOpen: c.homeOpen };
  return { ...m, data: { ...d, config, setting, signedIn: c, env, base } };
}

/**
 * The gates every signed in start and resume passes, in order: a blocked context or closed home
 * checks leave, the 48 hour minimum leaves (S01 shows when), a lock pauses (S35), a missing consent
 * asks for it (S12). Null when the check may go on.
 */
function entryGate(m: FlowModel, now: number): FlowState | null {
  const d = m.data;
  const c = d.signedIn;
  if (!c) return { kind: "exit", to: "today" };
  if (c.blocked || !c.ctx) return { kind: "exit", to: "today" };
  // Home checks open only behind the flag; a booth tab runs booth checks (Q31 (6)).
  if (!d.config.homeOpen && !d.config.booth) return { kind: "exit", to: "today" };
  // The side lean only session runs at home and only inside its offer (Q12 (2), 409 NOT_OFFERED).
  if ((d.config.session ?? "full") === "side_lean_only" && (d.config.booth || !c.sideLeanRepeat))
    return { kind: "exit", to: "today" };
  if (c.earliestNext && c.earliestNext > now) return { kind: "exit", to: "today" };
  if (c.lock && (c.lock.until === null || c.lock.until > now)) return pausedOf(c.lock);
  if (!c.consent) return { kind: "consent" };
  return null;
}

function routeSignedInStart(m: FlowModel, now: number): FlowModel {
  const d = m.data;
  const c = d.signedIn;
  if (!c) return m;
  // Closed and blocked leave before the desktop interstitial; a lock or consent after it.
  const gate = entryGate(m, now);
  if (gate?.kind === "exit") return go(m, gate);
  if (d.config.desktop && !d.desktopPassed) return go(m, { kind: "desktopGate" });
  if (gate) return go(m, gate);
  if (!c.adultConfirmed) return go(m, { kind: "adultGate" });
  return go(m, { kind: "context" });
}

/* ------------------------------------------------------------ guest steps */

const GUEST_MULTI: readonly GuestStep[] = [3, 5, 6];
const GUEST_KEYS: Record<GuestStep, keyof GuestAnswers> = {
  1: "position",
  2: "support",
  3: "conditions",
  4: "clearance",
  5: "pain",
  6: "restrictions",
};

function guestValue(g: GuestAnswers, step: GuestStep): string | string[] | undefined {
  return g[GUEST_KEYS[step]];
}

function setGuestAnswer(g: GuestAnswers, step: GuestStep, value: string | string[]): GuestAnswers {
  const key = GUEST_KEYS[step];
  if (!GUEST_MULTI.includes(step)) return { ...g, [key]: Array.isArray(value) ? value[0] : value };
  const list = Array.isArray(value) ? value : [value];
  // "None" is exclusive and clears the other choices (S08, S10, S11).
  const exclusive =
    list.includes("none") && list[list.length - 1] === "none" ? ["none"] : list.filter((v) => v !== "none");
  return { ...g, [key]: [...new Set(exclusive)] };
}

function guestAdvance(m: FlowModel, step: GuestStep): FlowModel {
  if (step < 6) return go(m, { kind: "guestSetup", step: (step + 1) as GuestStep });
  return guestRouting(m);
}

/**
 * Guest routing on the phone (map 2.1, Q19 (5)) with guestContext: no check (bed, cardiac, other,
 * cfs_moderate, no_exercise) goes to the team (S09); stroke or SCI without clearance get the seated
 * arm raise only; otherwise the base selection for the booth, and the quick path keeps the arm raise
 * only. The guest's clearance answer counts (Q19 (2)); the "SCI, type unknown" chip (sci_unsure) is
 * passed as it is and takes the sci_complete rules in guestContext (O20).
 */
export function guestSteps(g: GuestAnswers): GuestSteps | null {
  if (!g.position || !g.support) return null;
  const clean = (v: string[] | undefined) => (v ?? []).filter((x) => x !== "none");
  return {
    position: g.position,
    support: g.support,
    pain: clean(g.pain),
    restrictions: clean(g.restrictions),
    conditions: [...new Set(clean(g.conditions))],
    clearance: g.clearance ?? null,
  };
}

function guestRouting(m: FlowModel): FlowModel {
  const d = m.data;
  const steps = guestSteps(d.guest);
  const ctx = steps ? guestContext(steps) : ({ blocked: "invalid_input" } as const);
  if (isBlocked(ctx)) return go(m, { kind: "guestStaff" });
  let base = baseSelection(ctx, "booth", null);
  if (d.guestPath === "quick") base = base.filter((b) => b.testId === "shoulder_abduction");
  const tests = baseTests(base);
  if (tests.length === 0) return go(m, { kind: "guestStaff" });
  const env: PrecheckEnv = {
    setting: "booth",
    ctx,
    setup: null,
    firstCheck: true,
    unresolvedChangeReported: false,
    lastCheckLasting: false,
    baseTests: tests,
  };
  return go({ ...m, data: { ...d, env, base, answers: {} } }, { kind: "intro" });
}

/** A new visitor: everything the last one entered is cleared (Q19 (4)); booth mode stays. */
function restartGuest(m: FlowModel): FlowModel {
  const fresh = initialModel(m.data.config, m.data.device);
  return routeGuestStart({ ...fresh, data: { ...fresh.data, desktopPassed: m.data.desktopPassed } });
}

/* ------------------------------------------------------------ helpers */

function go(m: FlowModel, state: FlowState): FlowModel {
  return { ...m, state };
}

function emit(m: FlowModel, effect: DistributiveOmit<FlowEffect, "id">): FlowModel {
  const withId = { ...effect, id: m.nextEffectId } as FlowEffect;
  return { ...m, effects: [...m.effects, withId], nextEffectId: m.nextEffectId + 1 };
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function withRun(m: FlowModel, run: Partial<SideRun>): FlowModel {
  return { ...m, data: { ...m.data, run: { ...m.data.run, ...run } } };
}

function sideOf(m: FlowModel): number {
  return currentTest(m)?.side ?? 0;
}

function nextPrep(m: FlowModel, i: number, after: PrepKind | null): FlowModel {
  const steps = prepSteps(m.data, i);
  const at = after === null ? -1 : steps.indexOf(after);
  const next = steps[at + 1];
  if (next) return go(m, prepState(next, i));
  const reset = { ...m, data: { ...m.data, run: { ...EMPTY_RUN } } };
  return go(reset, { kind: "cam.setup", i, side: firstOpenSide(m, i) });
}

function firstOpenSide(m: FlowModel, i: number): number {
  const sides = m.data.tests[i]?.sides ?? [];
  const at = sides.findIndex((_, si) => !isDone(m, i, si));
  return at < 0 ? 0 : at;
}

function setLock(m: FlowModel, reason: string, until: number | null): FlowModel {
  return { ...m, data: { ...m.data, lock: { reason, until } } };
}

/**
 * The end of check question (S49, Q23 (7)), asked before any result, a check ended early included. A
 * signed in check asks the server for its form (GET /:id/end: the side after a one sided large drop,
 * and the O37 line); the general form shows until it answers (END_FORM).
 */
function toEndQuestion(m: FlowModel): FlowModel {
  const next = go(m, { kind: "endQuestion" });
  const d = m.data;
  if (d.config.mode !== "signedIn" || !d.checkId) return next;
  return emit(next, { type: "endForm", checkId: d.checkId });
}

/** The server has closed the check itself: the phone never completes it. */
function closeCheck(m: FlowModel): FlowModel {
  return { ...m, data: { ...m.data, closed: true } };
}

function toSafety(m: FlowModel, kind: SafetyKind, screen: DataScreenId, alsoShow: DataScreenId[]): FlowModel {
  return {
    ...go(m, { kind: "safety", safety: kind, screen, alsoShow, faintAnswered: false }),
    overlay: null,
  };
}

/**
 * Records a side's outcome; a signed in check posts results and postable skips (queued), unless the
 * server already has the row (`post` false: the side a stop names, the skips of a resume). A result
 * carries the quality retries used on its side (Q2 (6)).
 */
function recordSide(
  m: FlowModel,
  testId: TestId,
  side: TestSide,
  outcome: SideOutcome,
  body?: ResultPayload,
  post = true,
): FlowModel {
  const d = m.data;
  const next = { ...m, data: { ...d, outcomes: { ...d.outcomes, [outcomeKey(testId, side)]: outcome } } };
  if (d.config.mode !== "signedIn" || !d.checkId || !post) return next;
  const retries = d.run.retriesUsed > 0 ? { qualityRetries: d.run.retriesUsed } : {};
  if (body) return emit(next, { type: "result", checkId: d.checkId, body: { ...retries, ...body } });
  // A side not measured (quality retries used up) is posted like a skip with its reason, so the
  // server keeps the P6 "not measured today" row and can complete the check.
  if (
    (outcome.status === "skipped" || outcome.status === "notMeasured") &&
    outcome.reason &&
    POSTABLE_SKIP_REASONS.includes(outcome.reason)
  ) {
    const body = skipBody(d, testId, side, outcome.reason);
    return emit(next, {
      type: "result",
      checkId: d.checkId,
      body: outcome.reason === "quality" ? { ...body, ...retries } : body,
    });
  }
  return next;
}

/** A skip result: no score and no attempts (spec 4.0; server checkResult). */
export function skipBody(d: FlowData, testId: TestId, side: TestSide, reason: string): ResultPayload {
  const def = testDef(testId);
  const item = d.protocol.find((p) => p.testId === testId && p.side === side);
  return {
    testId,
    side,
    value: null,
    unit: def.unit,
    attempts: [],
    quality: { ok: false },
    detail: {},
    flags: [],
    nValid: 0,
    median: null,
    skippedReason: reason,
    variant: null,
    poseModel: d.device.model,
    movementVersion: item?.version ?? def.version,
    engineVersion: d.device.engineVersion,
  };
}

/**
 * Completion of a signed in check that has at least one result or skip (queued); never for a check
 * the server closed itself.
 */
function completeCheck(m: FlowModel): FlowModel {
  const d = m.data;
  if (d.config.mode !== "signedIn" || !d.checkId || d.closed) return m;
  if (m.effects.some((x) => x.type === "complete")) return m;
  if (Object.keys(d.outcomes).length === 0) return m;
  return emit(m, { type: "complete", checkId: d.checkId });
}

/** Leaving (S15): a started check with a result or skip is closed as ended early (S15 note). */
function leaveFlow(m: FlowModel): FlowModel {
  const guest = m.data.config.mode === "guest";
  return go(completeCheck(m), { kind: "exit", to: guest ? "landing" : "today" });
}

/** Question ids for the question screen of a state: the data item and its part. */
export function questionOf(id: string) {
  const parsed = parseQuestionId(id);
  return parsed ? { item: precheckItem(parsed.base), part: parsed.part } : null;
}
