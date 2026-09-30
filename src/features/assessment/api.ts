/**
 * Typed client for the movement check endpoints (contract v2 E, v3 I, the round 3 server contract):
 * assessments, the follow up routes (end, faint, alarm, resume), consents, the adult confirmation,
 * progress and the booth passes (O17).
 *
 * Every call returns an ApiResult instead of throwing, so a screen always has a typed way forward:
 *   { ok: true, value }                                 the 2xx body
 *   { ok: false, error: { kind: "offline" } }           navigator.onLine is false; nothing was sent
 *   { ok: false, error: { kind: "network" } }           fetch failed (the offline banner shows)
 *   { ok: false, error: { kind: "http", status, code, body } }   an { error: CODE } answer
 * `conflict(error)` reads the 409 and 403 codes the flow acts on: LOCKED, POSTPONE, HOME_CLOSED,
 * NOT_OPEN, CONSENT_REQUIRED, ADULT_REQUIRED, NOT_OFFERED, STOPPED, TOO_SOON, SKIPPED, NO_RESULTS,
 * NOT_DUE, CONSENT_VERSION.
 *
 * Every lock the server sends (the context, 409 LOCKED, the POSTPONE lock and the stop, between,
 * end and faint answers) is a LockView: when it ends, whether the care team answer releases it and
 * its {when} line, never a reason (Q25 (c)).
 *
 * The phone evaluates the pre-check, the stop list, the pain question between tests, the faint
 * follow up and the end question with the pure modules first and shows the screen at once. Only the
 * start call of a check that goes ahead and the resume call are awaited; every other call goes
 * through the ordered outbox of resultQueue.ts, which keeps it until the server has it.
 *
 * The guest flow never calls this client (contract v3 I).
 */
import { estimateMinutes, type ProtocolItem } from "../../medical/assessment";
import type { Answers, CheckInConfig, ClockTime, SkipItem, TestSide } from "../../medical/precheck";
import type { PausedWhenId, ScreenId, Setting, Side, StopOptionId, TestId } from "../../movements/types";
import type { SeriesView } from "../../medical/series";
import { ENGINE_VERSION } from "../../engine/modes";
import { HOME_GATE2_READY } from "../../medical/gates";

/**
 * The client guard of home gate 2 (R3C-10 (7)): home checks are open only when the server says so
 * and the client has built gate 2 (the answer zones, the fine zone and the fall watch), so a server
 * flag alone never opens a home check with the interim cue that names no box. As on the server
 * (homeChecksOpen), the unit tests and the E2E builds render the home screens with the flag alone;
 * neither mode exists in a production build (MODE and VITE_E2E are replaced at build time).
 */
const HOME_READY = HOME_GATE2_READY || import.meta.env.VITE_E2E === "1" || import.meta.env.MODE === "test";
export const homeOpenOf = (c: { homeOpen?: boolean | null }, ready: boolean = HOME_READY): boolean =>
  c.homeOpen === true && ready;
import type {
  BetweenAnswer,
  CheckSession,
  CurlLoad,
  DeviceInfo,
  ResultPayload,
  ResumeCheck,
  SignedInContext,
  StartError,
  StartResult,
} from "./flowMachine";

/* ------------------------------------------------------------------ transport */

export type ApiFailure =
  | { kind: "offline" }
  | { kind: "network" }
  | { kind: "http"; status: number; code: string; body: Record<string, unknown> };

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiFailure };

export interface Transport {
  fetch: typeof fetch;
  /** navigator.onLine, or true where it is not known. */
  online(): boolean;
}

export interface CheckApiOptions {
  transport?: Partial<Transport>;
  /** Called when a request fails with a network error (useOnline shows the banner, UX spec 0.7). */
  onNetworkError?: () => void;
  /** Called after any answer from the server (the connection works). */
  onReachable?: () => void;
}

const browserTransport = (): Transport => ({
  fetch: (...args) => fetch(...args),
  online: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
});

/* ------------------------------------------------------------------ response types */

/** {when} of scr_paused_today (Q33 (4)): the pausedWhenTokens line and, for the clock forms, the time. */
export interface LockWhen {
  token: PausedWhenId;
  time?: ClockTime;
}

/** A lock as every server answer sends it (Q25 (c)): no reason. */
export interface LockView {
  until: number;
  releasableByClearance: boolean;
  when: LockWhen;
}

/** The open check that may still resume (O6): within 30 minutes of its last activity. */
export interface OpenCheck {
  id: string;
  setting: Setting;
  resumeUntil: number;
}

/** The side lean only session offer (Q12 (2)): 48 hours to 7 days after the first home check. */
export interface SideLeanRepeat {
  from: number;
  to: number;
  baseTests: TestId[];
}

/** GET /api/assessments/context as the server sends it (server/modules/assessments/routes.ts). */
export interface ContextResponse {
  ctx?: SignedInContext["ctx"];
  blocked?: string;
  setting: Setting;
  setup: SignedInContext["setup"];
  firstCheck: boolean;
  completedBefore: boolean;
  unresolvedChangeReported: boolean;
  /** Q33 (3): a faint stop set faintReported and no pc_faint_since answer has cleared it yet. */
  faintReportedUnresolved: boolean;
  lastCheckLasting: boolean;
  sideLeanDoneAtHome?: boolean;
  neededArmsLastStand?: boolean;
  lastPdDoseBucket: string | null;
  lock: LockView | null;
  /** H9: due from the last completed home full check; null after booth only checks. */
  retestDue: number | null;
  /** H9: 48 hours after any completed check (booth and the side lean session included). */
  earliestNext: number | null;
  /** H9: a start now is early (scr_early_start on S01). */
  early: boolean;
  sideLeanRepeat: SideLeanRepeat | null;
  openCheck: OpenCheck | null;
  followUpDue: boolean;
  consent: boolean;
  consentVersion: number;
  baselineRanges: Record<string, [number, number]>;
  baseTests: string[];
  /** Contract v3 I: home checks open (AZM_CHECK_HOME). */
  homeOpen: boolean;
  /** Q2 (5), Q32 (6): the account holds the adult confirmation (S05a). */
  adultConfirmed: boolean;
  /** Q5, Q26: the load of each arm's current home arm curl series (or the heavier one chosen). */
  lastLoads?: Partial<Record<"left" | "right", CurlLoad>> | null;
}

export interface StartBody {
  answers: Answers;
  device: DeviceInfo;
  setting: Setting;
  /** O17: the one check booth pass of a signed in booth start (the code never leaves staff devices). */
  boothToken?: string;
  /** Q12 (2): the side lean only session; a full check by default. */
  session?: CheckSession;
  faceCovered?: boolean;
}

/** The helper briefing of each test that runs with a helper (Q11, O34-2 (2)). */
export type HelperBriefing = Partial<Record<TestId, string | Record<string, unknown>>>;

export interface StartOk {
  id: string;
  kind: "baseline" | "retest";
  setting: Setting;
  /** O21: ended_early when no test runs today (the server has closed the check). */
  status: "open" | "ended_early";
  protocol: ProtocolItem[];
  warnings: string[];
  helperRequired: string[];
  /** The inputs of the check in (O34): raised hand allowed, no arm signal, the fine zone side. */
  checkIn: CheckInConfig | null;
  helperBriefing: HelperBriefing;
}

/** The test side a stop, a faint answer or an alarm is about (resultOnStop, O43). */
export interface TestRef {
  testId: TestId;
  side: TestSide;
}

export interface StopResponse {
  option: StopOptionId;
  screen: ScreenId | null;
  alsoShow: ScreenId[];
  endsCheck: boolean;
  lock: LockView | null;
  reason: string;
  then: "bt_pain_after" | "sf_faint_loc" | null;
  afterRest: boolean;
}

export interface BetweenResponse {
  status: "continue" | "skip" | "end";
  skips: { testId: TestId; side: TestSide; reason: string }[];
  screen: ScreenId | null;
  lock: LockView | null;
}

export interface CompleteResponse {
  id: string;
  completed: number;
}

/** GET /api/assessments/:id/end: the form of the end of check question (Q23 (7), O37). */
export interface EndForm {
  question: "ec_symptoms";
  side: Side | null;
  chronicNote: boolean;
}

export type EndAnswerResponse =
  | { status: "proceed" }
  | { status: "emergency"; screen: ScreenId; alsoShow: ScreenId[]; lock: LockView | null };

export type FaintAnswer = "yes" | "no" | "unsure";

export interface FaintBody {
  answer: FaintAnswer;
  /** The faint stop followed a no response alarm (Q33 (3)): the emergency route whatever the answer. */
  afterNoResponse?: boolean;
  testId?: TestId;
}

export interface FaintResponse {
  status: "emergency" | "recorded";
  screen: ScreenId | null;
  alsoShow: ScreenId[];
  lock: LockView | null;
}

export type AlarmKind = "no_response" | "help_requested";

export interface AlarmBody {
  kind: AlarmKind;
  testId?: TestId;
  /**
   * A second no response alarm in the check ends testing for today (R3C-02 (2)): the server closes the
   * check as a stop that ends it would, with the stop_symptom next day lock.
   */
  endsCheck?: true;
}

export interface ResumeOk {
  status: "proceed";
  skips: SkipItem[];
  warnings: string[];
  helperRequired: string[];
  checkIn: CheckInConfig | null;
}

export interface AfterResponse {
  recorded: true;
  screen: ScreenId | null;
  lastingUnresolved: boolean;
}

export interface StoredCheck {
  id: string;
  kind: "baseline" | "retest";
  setting: Setting;
  session: CheckSession;
  status: "open" | "completed" | "ended_early" | "abandoned";
  started: number;
  completed: number | null;
  /** Never names the stop option (Q25 (d)). */
  endedReason: "stop" | "stale" | "replaced" | "all_skipped" | "consent_revoked" | null;
  setup: SignedInContext["setup"];
  protocol: ProtocolItem[];
  results: (ResultPayload & { band: string; seriesKey: string; created: number })[];
}

export interface ProgressResponse {
  tests: SeriesView[];
  retestDue: number | null;
  earliestNext: number | null;
  early: boolean;
  sessions: { weeks: { start: number; done: number; planned: number }[] };
  validShare: number | null;
  avgEffort: number | null;
  activeMinutesPerWeek: number | null;
}

export interface ConsentResponse {
  kind: "movement_check";
  version: number;
  acceptedAt: number;
}

export interface AdultResponse {
  adultConfirmed: true;
  confirmedAt: number;
}

/** POST /api/booth/verify: the staff device session of the booth day, never the code. */
export type BoothVerifyResponse =
  { ok: true; session: string; expires: number } | { ok: false; closed?: true };

/**
 * POST /api/booth/redeem: the QR token is spent and swapped for this phone's own pass (O17, S55b), so
 * the link turns booth mode on for one phone only.
 */
export type BoothRedeemResponse = { ok: true; token: string; expires: number } | { ok: false };
/** POST /api/booth/check: this phone's pass still holds (checked, not used). */
export type BoothCheckResponse = { ok: true; expires: number } | { ok: false };

/* ------------------------------------------------------------------ the client */

export interface CheckApi {
  getContext(setting?: Setting): Promise<ApiResult<ContextResponse>>;
  startCheck(body: StartBody): Promise<ApiResult<StartOk>>;
  postResult(id: string, body: ResultPayload): Promise<ApiResult<{ saved: true }>>;
  /** The stop names the test side running, or during a rest the next one to run (resultOnStop). */
  postStop(id: string, option: StopOptionId, ref?: TestRef | null): Promise<ApiResult<StopResponse>>;
  postBetween(
    id: string,
    testId: TestId,
    side: TestSide,
    answer: BetweenAnswer,
  ): Promise<ApiResult<BetweenResponse>>;
  getEnd(id: string): Promise<ApiResult<EndForm>>;
  postEnd(id: string, answer: "yes" | "no"): Promise<ApiResult<EndAnswerResponse>>;
  postFaint(id: string, body: FaintBody): Promise<ApiResult<FaintResponse>>;
  postAlarm(id: string, body: AlarmBody): Promise<ApiResult<{ recorded: true }>>;
  resume(id: string, answers: Answers): Promise<ApiResult<ResumeOk>>;
  complete(id: string): Promise<ApiResult<CompleteResponse>>;
  postAfter(answer: "usual" | "settled" | "lasting"): Promise<ApiResult<AfterResponse>>;
  /** Q26: the choice of the heavier load offer of one arm (kept for its next check's S30). */
  postLoadStep(
    side: "left" | "right",
    choice: "heavier" | "same",
  ): Promise<ApiResult<{ side: string; choice: string; next: unknown }>>;
  listChecks(): Promise<ApiResult<{ assessments: StoredCheck[] }>>;
  getProgress(): Promise<ApiResult<ProgressResponse>>;
  acceptConsent(version: number): Promise<ApiResult<ConsentResponse>>;
  revokeConsent(): Promise<ApiResult<{ kind: string; revoked: true }>>;
  confirmAdult(): Promise<ApiResult<AdultResponse>>;
  boothVerify(code: string): Promise<ApiResult<BoothVerifyResponse>>;
  boothToken(session: string): Promise<ApiResult<{ token: string; expires: number }>>;
  boothRedeem(token: string): Promise<ApiResult<BoothRedeemResponse>>;
  boothCheck(token: string): Promise<ApiResult<BoothCheckResponse>>;
}

export function createCheckApi(options: CheckApiOptions = {}): CheckApi {
  const t: Transport = { ...browserTransport(), ...options.transport };

  async function call<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    if (!t.online()) return { ok: false, error: { kind: "offline" } };
    let response: Response;
    try {
      const mutation = method !== "GET";
      response = await t.fetch(`/api${path}`, {
        method,
        credentials: "same-origin",
        headers: mutation
          ? { "Content-Type": "application/json", "X-Azm-Request": "1" }
          : { Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      options.onNetworkError?.();
      return { ok: false, error: { kind: "network" } };
    }
    options.onReachable?.();
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (response.ok) return { ok: true, value: json as T };
    const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const code = typeof obj.error === "string" ? obj.error : "SERVER";
    return { ok: false, error: { kind: "http", status: response.status, code, body: obj } };
  }

  const check = (id: string, tail: string) => `/assessments/${id}/${tail}`;
  return {
    getContext: (setting) =>
      call<ContextResponse>("GET", `/assessments/context${setting === "booth" ? "?setting=booth" : ""}`),
    startCheck: (body) => call<StartOk>("POST", "/assessments", body),
    postResult: (id, body) => call("POST", check(id, "results"), body),
    postStop: (id, option, ref) =>
      call<StopResponse>(
        "POST",
        check(id, "stop"),
        ref ? { option, testId: ref.testId, side: ref.side } : { option },
      ),
    postBetween: (id, testId, side, answer) =>
      call<BetweenResponse>("POST", check(id, "between"), { testId, side, answer }),
    getEnd: (id) => call<EndForm>("GET", check(id, "end")),
    // One path for the end, faint and alarm answers, so no URL names a safety event (Q25 (a)).
    postEnd: (id, answer) =>
      call<EndAnswerResponse>("POST", check(id, "answer"), { question: "end", answer }),
    postFaint: (id, body) => call<FaintResponse>("POST", check(id, "answer"), { question: "faint", ...body }),
    postAlarm: (id, body) => call("POST", check(id, "answer"), { question: "alarm", ...body }),
    resume: (id, answers) => call<ResumeOk>("POST", check(id, "resume"), { answers }),
    complete: (id) => call<CompleteResponse>("POST", check(id, "complete"), {}),
    postAfter: (answer) => call<AfterResponse>("POST", "/assessments/after", { answer }),
    postLoadStep: (side, choice) => call("POST", "/progress/load-step", { side, choice }),
    listChecks: () => call("GET", "/assessments"),
    getProgress: () => call<ProgressResponse>("GET", "/progress"),
    acceptConsent: (version) =>
      call<ConsentResponse>("POST", "/consents", { kind: "movement_check", version }),
    revokeConsent: () => call("DELETE", "/consents/movement_check"),
    confirmAdult: () => call<AdultResponse>("POST", "/account/adult", { confirmed: true }),
    boothVerify: (code) => call<BoothVerifyResponse>("POST", "/booth/verify", { code }),
    boothToken: (session) => call("POST", "/booth/token", { session }),
    boothRedeem: (token) => call<BoothRedeemResponse>("POST", "/booth/redeem", { token }),
    boothCheck: (token) => call<BoothCheckResponse>("POST", "/booth/check", { token }),
  };
}

/* ------------------------------------------------------------------ conflicts */

/** A lock as the flow keeps it: when it ends, whether the care team releases it and its {when}. */
export interface FlowLock {
  until: number | null;
  releasable: boolean;
  when: LockWhen | null;
}

/** The 409 and 403 answers the check acts on, read from an ApiFailure. */
export type Conflict =
  | ({ code: "LOCKED" } & FlowLock)
  | {
      code: "POSTPONE";
      status: "postpone" | "emergency" | "ad";
      reason: string;
      screen: ScreenId | null;
      alsoShow: ScreenId[];
      lock: FlowLock | null;
    }
  | { code: "HOME_CLOSED" }
  | { code: "NOT_OPEN"; status: string | null }
  | { code: "CONSENT_REQUIRED" }
  | { code: "ADULT_REQUIRED" }
  | { code: "NOT_OFFERED" }
  | { code: "STOPPED"; reason: string | null }
  | { code: "CONSENT_VERSION"; version: number | null }
  | { code: "TOO_SOON"; until: number | null }
  | { code: "SKIPPED"; reason: string | null }
  | { code: "NO_RESULTS" }
  | { code: "NOT_DUE" };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Whether a lock can be released by the care team answer (pc_change_cleared, S35). Only the server's
 * flag counts: the lock reason is never sent (Q25 (c)), and a lock without the flag is not released.
 */
export function lockReleasable(lock: { releasableByClearance?: unknown }): boolean {
  return lock.releasableByClearance === true;
}

/** {when} of a lock, or null when it does not fit (the screen then shows the lock without it). */
export function lockWhen(raw: unknown): LockWhen | null {
  const w = obj(raw);
  const token = w ? str(w.token) : null;
  if (!w || !token) return null;
  const t = obj(w.time);
  const hour = t ? num(t.hour) : null;
  const minute = t ? num(t.minute) : null;
  const suffix: ClockTime["suffix"] | null = t && (t.suffix === "am" || t.suffix === "pm") ? t.suffix : null;
  const time = hour !== null && minute !== null && suffix ? { time: { hour, minute, suffix } } : {};
  return { token: token as PausedWhenId, ...time };
}

/** A LockView (or the body of 409 LOCKED) as the flow keeps it. */
export function flowLock(raw: unknown): FlowLock | null {
  const l = obj(raw);
  if (!l) return null;
  return { until: num(l.until), releasable: lockReleasable(l), when: lockWhen(l.when) };
}

export function conflict(error: ApiFailure): Conflict | null {
  if (error.kind !== "http") return null;
  const b = error.body;
  switch (error.code) {
    case "LOCKED":
      return { code: "LOCKED", ...flowLock(b)! };
    case "POSTPONE": {
      const status = b.status === "emergency" || b.status === "ad" ? b.status : "postpone";
      return {
        code: "POSTPONE",
        status,
        reason: str(b.reason) ?? "unwell",
        screen: (str(b.screen) as ScreenId | null) ?? null,
        alsoShow: Array.isArray(b.alsoShow)
          ? (b.alsoShow.filter((x) => typeof x === "string") as ScreenId[])
          : [],
        lock: flowLock(b.lock),
      };
    }
    case "HOME_CLOSED":
    case "CONSENT_REQUIRED":
    case "ADULT_REQUIRED":
    case "NOT_OFFERED":
    case "NO_RESULTS":
    case "NOT_DUE":
      return { code: error.code };
    case "NOT_OPEN":
      return { code: "NOT_OPEN", status: str(b.status) };
    case "STOPPED":
      return { code: "STOPPED", reason: str(b.reason) };
    case "CONSENT_VERSION":
      return { code: "CONSENT_VERSION", version: num(b.version) };
    case "TOO_SOON":
      return { code: "TOO_SOON", until: num(b.until) };
    case "SKIPPED":
      return { code: "SKIPPED", reason: str(b.reason) };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ flow adapters */

const START_ERRORS: readonly StartError[] = [
  "HOME_CLOSED",
  "TOO_SOON",
  "REVIEW",
  "PLAN_REQUIRED",
  "BOOTH_CODE",
  "RATE_LIMIT",
  "START_INVALID",
  "PRECHECK_INCOMPLETE",
  "ADULT_REQUIRED",
  "NOT_OFFERED",
];

/** The failure of a start or resume call as a flow error. */
function failureOf(e: ApiFailure): Exclude<StartResult, { ok: true }> {
  if (e.kind === "offline") return { ok: false, code: "offline" };
  if (e.kind === "network") return { ok: false, code: "network" };
  const c = conflict(e);
  if (c?.code === "POSTPONE")
    return {
      ok: false,
      code: "POSTPONE",
      status: c.status,
      reason: c.reason,
      screen: c.screen,
      alsoShow: c.alsoShow,
      lock: c.lock ? { until: c.lock.until, when: c.lock.when } : null,
    };
  if (c?.code === "LOCKED")
    return { ok: false, code: "LOCKED", until: c.until, releasable: c.releasable, when: c.when };
  if (c?.code === "CONSENT_REQUIRED") return { ok: false, code: "CONSENT_REQUIRED" };
  if (c?.code === "NOT_OPEN") return { ok: false, code: "NOT_OPEN" };
  // The session ended (401 AUTH_REQUIRED, or a 403 AUTH_ code): sign in again, never Try again.
  if (e.status === 401 || (e.status === 403 && e.code.startsWith("AUTH"))) return { ok: false, code: "AUTH" };
  // The phone and the server did not agree on the re-ask questions: a retry cannot change that.
  if (e.code === "RESUME_INCOMPLETE") return { ok: false, code: "PRECHECK_INCOMPLETE" };
  if (e.code === "RESUME_INVALID") return { ok: false, code: "START_INVALID" };
  const code = (START_ERRORS as readonly string[]).includes(e.code) ? (e.code as StartError) : "server";
  return { ok: false, code };
}

/** The start call answer as a flow event payload (START_RESULT). */
export function toStartResult(r: ApiResult<StartOk>): StartResult {
  if (!r.ok) return failureOf(r.error);
  return {
    ok: true,
    id: r.value.id,
    kind: r.value.kind,
    status: r.value.status === "ended_early" ? "ended_early" : "open",
    protocol: r.value.protocol,
    warnings: r.value.warnings,
    helperRequired: r.value.helperRequired,
    checkIn: r.value.checkIn ?? null,
    helperBriefing: r.value.helperBriefing ?? {},
  };
}

/** The resume call answer (O6) as a flow event payload (RESUME_RESULT). */
export function toResumeResult(r: ApiResult<ResumeOk>):
  | {
      ok: true;
      skips: SkipItem[];
      warnings: string[];
      helperRequired: string[];
      checkIn: CheckInConfig | null;
    }
  | Exclude<StartResult, { ok: true }> {
  if (!r.ok) return failureOf(r.error);
  return {
    ok: true,
    skips: r.value.skips ?? [],
    warnings: r.value.warnings ?? [],
    helperRequired: r.value.helperRequired ?? [],
    checkIn: r.value.checkIn ?? null,
  };
}

/** The context as the flow reads it (CONTEXT_LOADED). The lock reason never reaches the client. */
export function toSignedInContext(c: ContextResponse): SignedInContext {
  const lock = c.lock ? flowLock(c.lock) : null;
  return {
    ctx: c.ctx ?? null,
    blocked: c.blocked ?? null,
    setting: c.setting,
    setup: c.setup ?? null,
    firstCheck: c.firstCheck,
    completedBefore: c.completedBefore,
    unresolvedChangeReported: c.unresolvedChangeReported,
    faintReportedUnresolved: c.faintReportedUnresolved === true,
    lastCheckLasting: c.lastCheckLasting,
    ...(c.sideLeanDoneAtHome !== undefined ? { sideLeanDoneAtHome: c.sideLeanDoneAtHome } : {}),
    ...(c.neededArmsLastStand !== undefined ? { neededArmsLastStand: c.neededArmsLastStand } : {}),
    baseTests: c.baseTests ?? [],
    lock,
    earliestNext: c.earliestNext ?? null,
    early: c.early === true,
    sideLeanRepeat: c.sideLeanRepeat ?? null,
    openCheck: c.openCheck ?? null,
    consent: c.consent,
    homeOpen: homeOpenOf(c),
    adultConfirmed: c.adultConfirmed === true,
    lastPdDoseBucket: c.lastPdDoseBucket ?? null,
    lastLoads: c.lastLoads ?? null,
  };
}

/**
 * The open check to continue (S01 resume, O6), from the context's openCheck and the list of checks:
 * its frozen protocol, its setup and the sides already done. Null when there is none, or the list does
 * not hold it (it closed meanwhile).
 */
export function resumeCheckOf(open: OpenCheck | null, checks: readonly StoredCheck[]): ResumeCheck | null {
  if (!open) return null;
  const c = checks.find((x) => x.id === open.id && x.status === "open");
  if (!c) return null;
  const outcomes: ResumeCheck["outcomes"] = {};
  for (const r of c.results) {
    // A side not measured after its quality retries was tried (the end question is asked).
    outcomes[`${r.testId}:${r.side}`] =
      r.skippedReason === null
        ? { status: "measured", value: r.value }
        : { status: r.skippedReason === "quality" ? "notMeasured" : "skipped", reason: r.skippedReason };
  }
  return {
    id: c.id,
    kind: c.kind,
    setting: c.setting,
    protocol: c.protocol,
    outcomes,
    setup: c.setup ?? null,
  };
}

/**
 * The minutes of a check at home for the offer after the intake (S02) and the S01 first card: the
 * computed estimate of the context's base tests (O40), before the pre-check (the upper reading).
 */
export function offerMinutes(c: Pick<ContextResponse, "baseTests" | "ctx">): [number, number] {
  const [from, to] = estimateMinutes(c.baseTests as TestId[], c.ctx ?? null, "home");
  return [from, to];
}

/** The app version sent with the device facts (package.json). */
export const APP_VERSION = "0.1.0";

/** Device facts for the start call and the results: the lite model on phones (poseSource.ts). */
export function deviceInfo(
  opts: { coarse: boolean; aspect?: number; fps?: number } = { coarse: true },
): DeviceInfo {
  return {
    model: opts.coarse ? "lite" : "full",
    aspect: opts.aspect && opts.aspect > 0.2 && opts.aspect < 5 ? opts.aspect : 0.5625,
    fps: opts.fps && opts.fps >= 1 && opts.fps <= 240 ? opts.fps : 30,
    engineVersion: ENGINE_VERSION,
    appVersion: APP_VERSION,
  };
}
