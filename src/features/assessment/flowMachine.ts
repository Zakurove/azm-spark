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
 * Effects are data. `start` is awaited by the `starting` state (its answer comes back as
 * START_RESULT); every other effect is sent in the background. Safety answers (a postponed or
 * emergency pre-check, a stop, the pain question between tests) are sent directly and never queued
 * offline: the phone has already decided and shown the screen (task rule; UX spec 0.7 is narrowed
 * here). Results and the completion of a check may be queued (api.ts, ResultQueue).
 */
import {
  betweenTests,
  evaluatePrecheck,
  lockEndsAt,
  parseQuestionId,
  stopRoute,
  visibleQuestions,
  type AnswerValue,
  type Answers,
  type PrecheckEnv,
  type PrecheckOutcome,
  type TestInstance,
  type TestSide,
} from "../../medical/precheck";
import {
  baseSelection,
  baseTests,
  finalizeProtocol,
  guestContext,
  isBlocked,
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
  StopOptionId,
  Support,
  TestId,
} from "../../movements/types";

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
export type RestPurpose = "attempt" | "practice" | "seated" | "redo" | "sideChange";
export type AfterKind = "contact" | "pushed" | "count";
export type BetweenAnswer = "same" | "more" | "much";
export type ExitTarget = "today" | "landing" | "example" | "try" | "healthEdit" | "results";
/** Why the start call did not start the check (contract v2 E, v3 I). */
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
  | "PRECHECK_INCOMPLETE";

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
  | { kind: "faintAsk" }
  | { kind: "endQuestion" }
  | {
      kind: "safety";
      safety: SafetyKind;
      screen: DataScreenId;
      alsoShow: DataScreenId[];
      faintAnswered: boolean;
    }
  | { kind: "postponed"; reason: string; screen: DataScreenId | null; alsoShow: DataScreenId[] }
  | { kind: "paused"; until: number | null; releasable: boolean }
  | { kind: "cam.problem"; problem: CameraProblem; returnTo: FlowState }
  | { kind: "results" }
  | { kind: "exit"; to: ExitTarget };

export type FlowStateKind = FlowState["kind"];

export type Overlay =
  | { kind: "leave" }
  | { kind: "skipDialog" }
  | { kind: "stopList"; takeYourTime: boolean }
  | { kind: "checkIn"; from: "test" | "stopList" | "faintAsk"; trigger: string }
  | { kind: "goOn"; afterAlarm: boolean }
  | { kind: "alarm"; from: "test" | "stopList" | "faintAsk" };

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
  /** This device is in verified booth mode (S55, contract v3 I). */
  booth: boolean;
  /** Home checks are open (server flag AZM_CHECK_HOME, contract v3 I). */
  homeOpen: boolean;
  /** No touch and wider than 1024 px: offer the phone first (S04). */
  desktop: boolean;
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
  lastCheckLasting: boolean;
  sideLeanDoneAtHome?: boolean;
  neededArmsLastStand?: boolean;
  baseTests: string[];
  lock: { until: number | null; releasable: boolean } | null;
  consent: boolean;
  homeOpen: boolean;
  /** SPEC-GAP: adult-confirmed-field. The context has no adult confirmation yet; missing means ask (S05a). */
  adultConfirmed?: boolean;
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
}

export type FlowEffect =
  | { id: number; type: "start"; answers: Answers; setting: Setting }
  | { id: number; type: "startBackground"; answers: Answers; setting: Setting }
  | { id: number; type: "stop"; checkId: string; option: StopOptionId }
  | { id: number; type: "between"; checkId: string; testId: TestId; side: TestSide; answer: BetweenAnswer }
  | { id: number; type: "result"; checkId: string; body: ResultPayload }
  | { id: number; type: "complete"; checkId: string };

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
}

/** A start call result (api.ts maps the HTTP answer to this). */
export type StartResult =
  | {
      ok: true;
      id: string;
      kind: "baseline" | "retest";
      protocol: ProtocolItem[];
      warnings: string[];
      helperRequired: string[];
    }
  | {
      ok: false;
      code: "POSTPONE";
      status: "postpone" | "emergency" | "ad";
      reason: string;
      screen: DataScreenId | null;
      alsoShow: DataScreenId[];
      lock: { until: number | null } | null;
    }
  | { ok: false; code: "LOCKED"; until: number | null; releasable: boolean }
  | { ok: false; code: "CONSENT_REQUIRED" }
  | { ok: false; code: StartError };

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

/** The pre-check question counter: n of the questions visible now (O9 asks for possibleQuestions). */
// SPEC-GAP: possible-questions. The counter total is the number of visible questions, which can grow
// when a follow up opens; the spec asks for possibleQuestions (O33), not in src/medical yet.
export function questionCounter(m: FlowModel): { n: number; total: number } | null {
  const s = m.state;
  const id = s.kind === "question" || s.kind === "confirmPostpone" ? s.id : null;
  if (!id || !m.data.env) return null;
  const visible = visibleQuestions(m.data.env, m.data.answers);
  const at = visible.indexOf(id);
  return { n: at < 0 ? visible.length : at + 1, total: visible.length };
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
      return { kind: "intro" };
    case "precheckNotice":
      return { kind: "soundCheck" };
    case "question": {
      const env = m.data.env;
      if (!env) return null;
      const visible = visibleQuestions(env, m.data.answers);
      const at = visible.indexOf(s.id);
      return at > 0 ? { kind: "question", id: visible[at - 1] } : { kind: "precheckNotice" };
    }
    case "confirmPostpone":
      return { kind: "question", id: s.id };
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
      // Check in triggers are armed per state by the camera screens (section 4.8); the flow opens S43
      // over any state with the camera running, unless another overlay is already open.
      if (!cameraRunning(m.state) || m.overlay) return m;
      return { ...m, overlay: { kind: "checkIn", from: "test", trigger: e.trigger } };
    case "STOP":
      if (!cameraRunning(m.state) || m.overlay?.kind === "stopList") return m;
      if (m.overlay?.kind === "alarm") return m; // the alarm is left only with "I am fine" (S45)
      return { ...m, overlay: { kind: "stopList", takeYourTime: false } };
    case "BACK": {
      if (m.overlay) return m;
      const target = backTarget(m);
      return target ? go(m, target) : m;
    }
  }
  if (m.overlay) return overlayReducer(m, e, now);
  return stateReducer(m, e, now);
}

/* ------------------------------------------------------------ overlays */

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
        if (o.from === "stopList") return { ...m, overlay: { kind: "stopList", takeYourTime: true } };
        if (o.from === "faintAsk") return close(m);
        return { ...m, overlay: { kind: "goOn", afterAlarm: false } };
      }
      if (e.type === "WANT_STOP") return { ...m, overlay: { kind: "stopList", takeYourTime: false } };
      if (e.type === "NEED_HELP" || e.type === "CHECKIN_TIMEOUT")
        return { ...m, overlay: { kind: "alarm", from: o.from } };
      return m;
    case "goOn": {
      if (e.type === "REDO") {
        const t = currentTest(m);
        if (!t) return close(m);
        return go(close(m), { kind: "cam.rest", i: t.i, side: t.side, purpose: "redo" });
      }
      if (e.type === "SKIP_TEST") return skipCurrentTest(close(m), "by_choice");
      if (e.type === "NEED_HELP") return { ...m, overlay: { kind: "alarm", from: "test" } };
      if (e.type === "WANT_STOP" || e.type === "STOP_END")
        return { ...m, overlay: { kind: "stopList", takeYourTime: false } };
      return m;
    }
    case "alarm":
      // Only "I am fine" (button, zone or raised hand) leaves the alarm; a call keeps it (S45). After a
      // faint the check has ended, so "fine" returns to the faint question (S38b) instead of S44.
      if (e.type === "FINE")
        return o.from === "faintAsk" ? close(m) : { ...m, overlay: { kind: "goOn", afterAlarm: true } };
      return m;
  }
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
      if (e.type === "RESUME" && !guest) return resume(withContext(m, e.context), e.check);
      if (e.type === "RETRY") return go(m, { kind: "entry", error: null });
      return m;

    case "boothOnly":
      if (e.type === "EXAMPLE") return go(m, { kind: "exit", to: "example" });
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
        const si = d.signedIn ? { ...d.signedIn, adultConfirmed: true } : null;
        return go({ ...m, data: { ...d, signedIn: si } }, { kind: "context" });
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

    case "intro":
      if (e.type === "CONTINUE") return go(m, { kind: "soundCheck" });
      return m;

    case "soundCheck":
      if (e.type === "SOUND_RESULT")
        return go({ ...m, data: { ...d, soundMode: e.mode } }, { kind: "precheckNotice" });
      return m;

    case "precheckNotice":
      if (e.type === "PRECHECK_START") return firstQuestion(m, now);
      return m;

    case "question":
      if (e.type === "ANSWER" && e.id === s.id) return answer(m, s.id, e.value, now);
      return m;

    case "confirmPostpone":
      if (e.type === "CONFIRM_YES") {
        const outcome = evaluatePrecheck(d.env!, d.answers, now);
        if (outcome.status !== "postpone") return go(m, { kind: "question", id: s.id });
        return postpone(m, outcome, now);
      }
      if (e.type === "CONFIRM_CHANGE") {
        const answers = { ...d.answers };
        delete answers[s.id];
        return go({ ...m, data: { ...d, answers } }, { kind: "question", id: s.id });
      }
      return m;

    case "starting":
      if (e.type === "START_RESULT") return startResult(m, e.result, now);
      if (e.type === "RETRY" && s.error !== null) {
        const next = go(m, {
          kind: "starting",
          lastQuestion: s.lastQuestion,
          error: null,
          attempt: s.attempt + 1,
        });
        return emit(next, { type: "start", answers: d.answers, setting: d.setting });
      }
      if (e.type === "EXIT" && s.error !== null) return go(m, { kind: "exit", to: "today" });
      return m;

    case "warnings":
      if (e.type === "CONTINUE") return go(m, { kind: "plan" });
      return m;

    case "plan":
      if (e.type === "PLAN_START") {
        if (d.tests.length === 0) return leaveFlow(m);
        return go(m, { kind: "test.instruction", i: 0 });
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
      if (e.type === "GUEST_RESULTS") return go(m, { kind: "endQuestion" });
      return m;

    case "stopDone":
      if (e.type === "STOP_NEXT") return continueTo(m, afterTest(m, s.i));
      if (e.type === "STOP_END") return continueTo(m, finish(m));
      if (e.type === "CHANGE_REASON") return { ...m, overlay: { kind: "stopList", takeYourTime: false } };
      return m;

    case "faintAsk":
      if (e.type === "FAINT_ANSWER") {
        if (e.value === "no")
          return go(m, {
            kind: "safety",
            safety: "faint",
            screen: "scr_faint",
            alsoShow: [],
            faintAnswered: true,
          });
        return toSafety(m, "emergency", "scr_emergency", []);
      }
      if (e.type === "FAINT_TIMEOUT")
        return { ...m, overlay: { kind: "checkIn", from: "faintAsk", trigger: "no_answer" } };
      return m;

    case "endQuestion":
      if (e.type === "END_ANSWER") {
        const done = completeCheck(m);
        if (!e.yes) return go(done, { kind: "results" });
        // SPEC-GAP: end-question-lock. A yes routes like pc_urgent (next day lock, map 2.7); contract E
        // has no route for it, so the lock is kept on the phone and the results stay stored.
        const locked = setLock(done, "urgent", lockEndsAt("next_day", now));
        return toSafety(locked, "emergency", "scr_emergency", []);
      }
      return m;

    case "safety":
      if (e.type === "FAINT_ASK" && s.safety === "faint" && !s.faintAnswered)
        return go(m, { kind: "faintAsk" });
      if (e.type === "EXIT") {
        if (s.safety === "faint" && !s.faintAnswered) return go(m, { kind: "faintAsk" });
        return guest ? restartGuest(m) : go(m, { kind: "exit", to: "today" });
      }
      return m;

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
      if (e.type === "TRY_WORKOUT") return go(m, { kind: "exit", to: "try" });
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
      // SPEC-GAP: motion-needed. The reason id motion_needed is a data request (O33 (6)); the side and the
      // rest of the test are skipped with it on the phone and not posted until the server knows it.
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
        // A moved phone discards the attempt without using a retry; in a timed trial it ends the trial,
        // which is repeated once as a quality failure (map 2.12).
        return timed ? qualityFail(m, i, side, testId, "phone_moved") : go(m, { kind: "cam.setup", i, side });
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
      if (e.type === "RETRY" && !s.exhausted) return go(m, { kind: "cam.setup", i, side });
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
  const reset = { ...m, data: { ...m.data, run: { ...EMPTY_RUN } } };
  return go(reset, { kind: "cam.setup", i, side: side + 1 });
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
    const locked = out.lock?.until ? setLock(next, out.lock.reason, lockEndsAt(out.lock.until, now)) : next;
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
    case "side": {
      const reset = { ...m, data: { ...m.data, run: { ...EMPTY_RUN } } };
      return go(reset, { kind: "cam.setup", i: c.i, side: c.side });
    }
    case "test": {
      const reset = { ...m, data: { ...m.data, run: { ...EMPTY_RUN } } };
      return go(reset, { kind: "test.instruction", i: c.i });
    }
    case "guestAfterTest":
      return go({ ...m, data: { ...m.data, run: { ...EMPTY_RUN } } }, { kind: "guestAfterTest", next: c.i });
    case "endQuestion":
      return go(m, { kind: "endQuestion" });
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
  const env = stopEnv(d);
  if (!env) return m;
  const route = stopRoute(option, env);
  let next = m;
  if (d.config.mode === "signedIn" && d.checkId)
    next = emit(next, { type: "stop", checkId: d.checkId, option });
  if (route.lock?.until) next = setLock(next, route.lock.reason, lockEndsAt(route.lock.until, now));
  const kind = route.screen ? safetyKindOf(route.screen) : null;
  if (route.screen && kind) {
    if (t) next = markRestOfTest(next, t.i, t.side, route.reason);
    return toSafety(next, kind, route.screen, route.alsoShow);
  }
  if (!t) return next;
  if (route.then === "bt_pain_after") {
    const marked = markRestOfTest(next, t.i, t.side, route.reason);
    return go(marked, { kind: "between", i: t.i, side: t.side, scope: "test", via: "stop" });
  }
  const marked = markRestOfTest(next, t.i, t.side, route.reason);
  return go(marked, { kind: "stopDone", i: t.i, restSec: route.afterRest ? 60 : 0, reason: route.reason });
}

/** The stopped test stores no score: its current and remaining sides get the stop reason. */
function markRestOfTest(m: FlowModel, i: number, fromSide: number, reason: string): FlowModel {
  let next = m;
  m.data.tests[i]?.sides.forEach((item, si) => {
    if (si < fromSide || isDone(next, i, si)) return;
    next = recordSide(next, item.testId, item.side, { status: "skipped", reason });
  });
  return next;
}

/** The environment of the stop routing: the context with today's setup. */
function stopEnv(d: FlowData): PrecheckEnv | null {
  return d.env;
}

/* ------------------------------------------------------------ pre-check */

function firstQuestion(m: FlowModel, now: number): FlowModel {
  const env = m.data.env;
  if (!env) return m;
  const visible = visibleQuestions(env, m.data.answers);
  if (visible.length === 0) return proceed(m, evaluatePrecheck(env, m.data.answers, now), null);
  return go(m, { kind: "question", id: visible[0] });
}

/** Answers that belong to questions no longer visible are dropped (S17 Back rule). */
function prune(env: PrecheckEnv, answers: Answers): Answers {
  let current = answers;
  for (let round = 0; round < 6; round++) {
    const visible = new Set(visibleQuestions(env, current));
    const kept: Answers = {};
    for (const [k, v] of Object.entries(current)) if (visible.has(k)) kept[k] = v;
    if (Object.keys(kept).length === Object.keys(current).length) return kept;
    current = kept;
  }
  return current;
}

function answer(m: FlowModel, id: string, value: AnswerValue, now: number): FlowModel {
  const env = m.data.env!;
  const answers = prune(env, { ...m.data.answers, [id]: value });
  const next = { ...m, data: { ...m.data, answers } };
  const outcome = evaluatePrecheck(env, answers, now);
  // Emergency and AD route at once, with no confirm (S17 exception 2).
  if (outcome.status === "emergency" || outcome.status === "ad") return terminal(next, outcome, now);
  if (outcome.status === "postpone") return go(next, { kind: "confirmPostpone", id, value });
  const visible = visibleQuestions(env, answers);
  const at = visible.indexOf(id);
  const following = at >= 0 ? visible[at + 1] : undefined;
  if (following) return go(next, { kind: "question", id: following });
  const missing = visible.find((q) => !(q in answers));
  if (missing) return go(next, { kind: "question", id: missing });
  if (outcome.status !== "proceed") return go(next, { kind: "question", id });
  return proceed(next, outcome, id);
}

/** Emergency or AD from the pre-check: the safety screen now, the server told in the background. */
function terminal(m: FlowModel, outcome: PrecheckOutcome, now: number): FlowModel {
  let next = m;
  if (outcome.lock?.until) next = setLock(next, outcome.lock.reason, lockEndsAt(outcome.lock.until, now));
  if (m.data.config.mode === "signedIn")
    next = emit(next, { type: "startBackground", answers: m.data.answers, setting: m.data.setting });
  const screen = outcome.screen ?? (outcome.status === "ad" ? "scr_ad" : "scr_emergency");
  return toSafety(next, outcome.status === "ad" ? "ad" : "emergency", screen, outcome.alsoShow ?? []);
}

function postpone(m: FlowModel, outcome: PrecheckOutcome, now: number): FlowModel {
  let next = m;
  if (outcome.lock?.until) next = setLock(next, outcome.lock.reason, lockEndsAt(outcome.lock.until, now));
  if (m.data.config.mode === "signedIn")
    next = emit(next, { type: "startBackground", answers: m.data.answers, setting: m.data.setting });
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
    return emit(next, { type: "start", answers: d.answers, setting: d.setting });
  }
  // The guest check runs the same rules on the phone and stores nothing (contract v3 I).
  const protocol = finalizeProtocol(d.base, outcome, env.ctx, d.setting, null);
  return frozen(m, protocol, outcome.warnings, outcome.helperRequired, null, null);
}

/** The protocol is frozen: raw answers are dropped from the phone (spec 5.10). */
function frozen(
  m: FlowModel,
  protocol: ProtocolItem[],
  warnings: readonly string[],
  helperRequired: readonly string[],
  checkId: string | null,
  checkKind: FlowData["checkKind"],
): FlowModel {
  const before = warnings.filter((w) => !WARNINGS_AT_TEST.includes(w)) as DataScreenId[];
  const data: FlowData = {
    ...m.data,
    answers: {},
    protocol,
    tests: testsOf(protocol),
    warnings: warnings as DataScreenId[],
    helperRequired: helperRequired as TestId[],
    checkId,
    checkKind,
    run: { ...EMPTY_RUN },
  };
  return go({ ...m, data }, before.length ? { kind: "warnings" } : { kind: "plan" });
}

function startResult(m: FlowModel, r: StartResult, now: number): FlowModel {
  const s = m.state as Extract<FlowState, { kind: "starting" }>;
  if (r.ok) return frozen(m, r.protocol, r.warnings, r.helperRequired, r.id, r.kind);
  switch (r.code) {
    case "POSTPONE": {
      // The server is authoritative; the phone shows the stricter of the two (map 2.2).
      const withLock = r.lock?.until ? setLock(m, r.reason, r.lock.until) : m;
      if (r.status === "emergency" || r.status === "ad") {
        const screen = r.screen ?? (r.status === "ad" ? "scr_ad" : "scr_emergency");
        return toSafety(withLock, r.status === "ad" ? "ad" : "emergency", screen, r.alsoShow);
      }
      return go(withLock, { kind: "postponed", reason: r.reason, screen: r.screen, alsoShow: r.alsoShow });
    }
    case "LOCKED":
      return go(m, { kind: "paused", until: r.until, releasable: r.releasable });
    case "CONSENT_REQUIRED":
      return go(m, { kind: "consent" });
    default:
      void now;
      return go(m, { kind: "starting", lastQuestion: s.lastQuestion, error: r.code, attempt: s.attempt });
  }
}

/* ------------------------------------------------------------ entry routing */

/** Continue an open check at the first test that still has a side to run (Appendix A: resume). */
function resume(m: FlowModel, c: ResumeCheck): FlowModel {
  const data: FlowData = {
    ...m.data,
    protocol: c.protocol,
    tests: testsOf(c.protocol),
    checkId: c.id,
    checkKind: c.kind,
    outcomes: { ...c.outcomes },
    answers: {},
    run: { ...EMPTY_RUN },
  };
  const next = { ...m, data };
  const i = nextRunnableTest(next, 0);
  return i === null ? go(next, { kind: "endQuestion" }) : go(next, { kind: "test.instruction", i });
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
  const env: PrecheckEnv | null = c.ctx
    ? {
        setting,
        ctx: c.ctx,
        setup: c.setup,
        firstCheck: c.firstCheck,
        unresolvedChangeReported: c.unresolvedChangeReported,
        lastCheckLasting: c.lastCheckLasting,
        baseTests: c.baseTests,
        completedBefore: c.completedBefore,
        ...(c.sideLeanDoneAtHome !== undefined ? { sideLeanDoneAtHome: c.sideLeanDoneAtHome } : {}),
        ...(c.neededArmsLastStand !== undefined ? { neededArmsLastStand: c.neededArmsLastStand } : {}),
      }
    : null;
  const base = c.ctx ? baseSelection(c.ctx, setting, c.setup) : [];
  const config = { ...d.config, homeOpen: c.homeOpen };
  return { ...m, data: { ...d, config, setting, signedIn: c, env, base } };
}

function routeSignedInStart(m: FlowModel, now: number): FlowModel {
  const d = m.data;
  const c = d.signedIn;
  if (!c) return m;
  if (c.blocked || !c.ctx) return go(m, { kind: "exit", to: "today" });
  // Home checks open only behind the flag; a booth tab runs booth checks (Q31 (6)).
  if (!d.config.homeOpen && !d.config.booth) return go(m, { kind: "exit", to: "today" });
  if (d.config.desktop && !d.desktopPassed) return go(m, { kind: "desktopGate" });
  if (c.lock && (c.lock.until === null || c.lock.until > now))
    return go(m, { kind: "paused", until: c.lock.until, releasable: c.lock.releasable });
  if (!c.consent) return go(m, { kind: "consent" });
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
 * cfs_moderate, no_exercise, and in v1 data stroke and SCI) goes to the team (S09); otherwise the
 * base selection for the booth, and the quick path keeps the arm raise only.
 */
// SPEC-GAP: guest-routing-b. v1.1 lets stroke and SCI guests do the seated arm raise only; the v1 data
// in src/movements blocks them in guestContext, so they talk to the team until the data is re-exported.
// SPEC-GAP: guest-sci-unsure. "SCI, type unknown" (a v1.1 option) is sent as both SCI types, the
// stricter reading of each rule.
export function guestSteps(g: GuestAnswers): GuestSteps | null {
  if (!g.position || !g.support) return null;
  const clean = (v: string[] | undefined) => (v ?? []).filter((x) => x !== "none");
  const conditions = clean(g.conditions).flatMap((c) =>
    c === "sci_unsure" ? ["sci_complete", "sci_incomplete"] : [c],
  );
  return {
    position: g.position,
    support: g.support,
    pain: clean(g.pain),
    restrictions: clean(g.restrictions),
    conditions: [...new Set(conditions)],
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

function toSafety(m: FlowModel, kind: SafetyKind, screen: DataScreenId, alsoShow: DataScreenId[]): FlowModel {
  return {
    ...go(m, { kind: "safety", safety: kind, screen, alsoShow, faintAnswered: false }),
    overlay: null,
  };
}

/** Records a side's outcome; a signed in check posts results and postable skips (queued). */
function recordSide(
  m: FlowModel,
  testId: TestId,
  side: TestSide,
  outcome: SideOutcome,
  body?: ResultPayload,
): FlowModel {
  const d = m.data;
  const next = { ...m, data: { ...d, outcomes: { ...d.outcomes, [outcomeKey(testId, side)]: outcome } } };
  if (d.config.mode !== "signedIn" || !d.checkId) return next;
  if (body) return emit(next, { type: "result", checkId: d.checkId, body });
  if (outcome.status === "skipped" && outcome.reason && POSTABLE_SKIP_REASONS.includes(outcome.reason)) {
    return emit(next, {
      type: "result",
      checkId: d.checkId,
      body: skipBody(d, testId, side, outcome.reason),
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

/** Completion of a signed in check that has at least one result or skip (queued). */
function completeCheck(m: FlowModel): FlowModel {
  const d = m.data;
  if (d.config.mode !== "signedIn" || !d.checkId) return m;
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
