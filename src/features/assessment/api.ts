/**
 * Typed client for the movement check endpoints (contract v2 E, v3 I): assessments, consents,
 * progress and booth.
 *
 * Every call returns an ApiResult instead of throwing, so a screen always has a typed way forward:
 *   { ok: true, value }                                 the 2xx body
 *   { ok: false, error: { kind: "offline" } }           navigator.onLine is false; nothing was sent
 *   { ok: false, error: { kind: "network" } }           fetch failed (the offline banner shows)
 *   { ok: false, error: { kind: "http", status, code, body } }   an { error: CODE } answer
 * `conflict(error)` reads the 409 and 403 codes the flow acts on: LOCKED, POSTPONE, HOME_CLOSED,
 * NOT_OPEN, CONSENT_REQUIRED, TOO_SOON, SKIPPED, NO_RESULTS, NOT_DUE, CONSENT_VERSION.
 *
 * The phone evaluates the pre-check, the stop list and the pain question between tests with the pure
 * modules first and shows the screen at once. Only the start call of a check that goes ahead is
 * awaited (`startCheck`); every other call (results, skips, stops, the pain question, the completion
 * and the background start of a postponed or emergency pre-check) goes through the ordered outbox of
 * resultQueue.ts, which keeps it until the server has it.
 *
 * The guest flow never calls this client (contract v3 I).
 */
import type { ProtocolItem } from "../../medical/assessment";
import type { Answers, TestSide } from "../../medical/precheck";
import type { ScreenId, Setting, StopOptionId, TestId } from "../../movements/types";
import type { SeriesView } from "../../../server/modules/progress/series";
import { ENGINE_VERSION } from "../../engine/modes";
import type {
  BetweenAnswer,
  DeviceInfo,
  ResultPayload,
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

/** GET /api/assessments/context as the server sends it (server/modules/assessments/routes.ts). */
export interface ContextResponse {
  ctx?: SignedInContext["ctx"];
  blocked?: string;
  setting: Setting;
  setup: SignedInContext["setup"];
  firstCheck: boolean;
  completedBefore: boolean;
  unresolvedChangeReported: boolean;
  lastCheckLasting: boolean;
  sideLeanDoneAtHome?: boolean;
  neededArmsLastStand?: boolean;
  lastPdDoseBucket: string | null;
  lock: { reason: string; until: number | null; releasableByClearance?: boolean } | null;
  retestDue: number | null;
  earliestNext: number | null;
  followUpDue: boolean;
  consent: boolean;
  consentVersion: number;
  baselineRanges: Record<string, [number, number]>;
  baseTests: string[];
  /** Contract v3 I: home checks open (AZM_CHECK_HOME). Missing on a v2 server means closed. */
  homeOpen?: boolean;
  /** SPEC-GAP: adult-confirmed-field (UX spec Q32); missing means not confirmed. */
  adultConfirmed?: boolean;
}

export interface StartBody {
  answers: Answers;
  device: DeviceInfo;
  setting: Setting;
  boothCode?: string;
  faceCovered?: boolean;
}

export interface StartOk {
  id: string;
  kind: "baseline" | "retest";
  setting: Setting;
  protocol: ProtocolItem[];
  warnings: string[];
  helperRequired: string[];
}

export interface StopResponse {
  option: StopOptionId;
  screen: ScreenId | null;
  alsoShow: ScreenId[];
  endsCheck: boolean;
  lock: { reason: string; until: number | null } | null;
  reason: string;
  then: "bt_pain_after" | null;
  afterRest: boolean;
}

export interface BetweenResponse {
  status: "continue" | "skip" | "end";
  skips: { testId: TestId; side: TestSide; reason: string }[];
  screen: ScreenId | null;
  lock: { reason: string; until: number | null } | null;
}

export interface CompleteResponse {
  id: string;
  completed: number;
  symptomAsk: string[];
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
  status: "open" | "completed" | "ended_early" | "abandoned";
  started: number;
  completed: number | null;
  endedReason: string | null;
  setup: SignedInContext["setup"];
  protocol: ProtocolItem[];
  results: (ResultPayload & { band: string; seriesKey: string; created: number })[];
}

export interface ProgressResponse {
  tests: SeriesView[];
  retestDue: number | null;
  earliestNext: number | null;
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

/* ------------------------------------------------------------------ the client */

export interface CheckApi {
  getContext(setting?: Setting): Promise<ApiResult<ContextResponse>>;
  startCheck(body: StartBody): Promise<ApiResult<StartOk>>;
  postResult(id: string, body: ResultPayload): Promise<ApiResult<{ saved: true }>>;
  postStop(id: string, option: StopOptionId): Promise<ApiResult<StopResponse>>;
  postBetween(
    id: string,
    testId: TestId,
    side: TestSide,
    answer: BetweenAnswer,
  ): Promise<ApiResult<BetweenResponse>>;
  complete(id: string): Promise<ApiResult<CompleteResponse>>;
  postAfter(answer: "usual" | "settled" | "lasting"): Promise<ApiResult<AfterResponse>>;
  listChecks(): Promise<ApiResult<{ assessments: StoredCheck[] }>>;
  getProgress(): Promise<ApiResult<ProgressResponse>>;
  acceptConsent(version: number): Promise<ApiResult<ConsentResponse>>;
  revokeConsent(): Promise<ApiResult<{ kind: string; revoked: true }>>;
  boothVerify(code: string): Promise<ApiResult<{ ok: boolean }>>;
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

  return {
    getContext: (setting) =>
      call<ContextResponse>("GET", `/assessments/context${setting === "booth" ? "?setting=booth" : ""}`),
    startCheck: (body) => call<StartOk>("POST", "/assessments", body),
    postResult: (id, body) => call("POST", `/assessments/${id}/results`, body),
    postStop: (id, option) => call<StopResponse>("POST", `/assessments/${id}/stop`, { option }),
    postBetween: (id, testId, side, answer) =>
      call<BetweenResponse>("POST", `/assessments/${id}/between`, { testId, side, answer }),
    complete: (id) => call<CompleteResponse>("POST", `/assessments/${id}/complete`, {}),
    postAfter: (answer) => call<AfterResponse>("POST", "/assessments/after", { answer }),
    listChecks: () => call("GET", "/assessments"),
    getProgress: () => call<ProgressResponse>("GET", "/progress"),
    acceptConsent: (version) =>
      call<ConsentResponse>("POST", "/consents", { kind: "movement_check", version }),
    revokeConsent: () => call("DELETE", "/consents/movement_check"),
    boothVerify: (code) => call<{ ok: boolean }>("POST", "/booth/verify", { code }),
  };
}

/* ------------------------------------------------------------------ conflicts */

/** The 409 and 403 answers the check acts on, read from an ApiFailure. */
export type Conflict =
  | { code: "LOCKED"; until: number | null; releasable: boolean }
  | {
      code: "POSTPONE";
      status: "postpone" | "emergency" | "ad";
      reason: string;
      screen: ScreenId | null;
      alsoShow: ScreenId[];
      lock: { reason: string; until: number | null } | null;
    }
  | { code: "HOME_CLOSED" }
  | { code: "NOT_OPEN"; status: string | null }
  | { code: "CONSENT_REQUIRED" }
  | { code: "CONSENT_VERSION"; version: number | null }
  | { code: "TOO_SOON"; until: number | null }
  | { code: "SKIPPED"; reason: string | null }
  | { code: "NO_RESULTS" }
  | { code: "NOT_DUE" };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Whether a lock can be released by the care team answer (pc_change_cleared, S35). The UI never shows
 * the lock reason (Q25 (c)); only this flag leaves the client.
 */
// SPEC-GAP: lock-releasable. The UX spec asks the server for { until, releasableByClearance } without a
// reason; the v2 server sends the reason, so the client derives the flag (recent_change) and drops it.
export function lockReleasable(lock: { reason?: unknown; releasableByClearance?: unknown }): boolean {
  if (typeof lock.releasableByClearance === "boolean") return lock.releasableByClearance;
  return lock.reason === "recent_change";
}

export function conflict(error: ApiFailure): Conflict | null {
  if (error.kind !== "http") return null;
  const b = error.body;
  switch (error.code) {
    case "LOCKED":
      return { code: "LOCKED", until: num(b.until), releasable: lockReleasable(b) };
    case "POSTPONE": {
      const status = b.status === "emergency" || b.status === "ad" ? b.status : "postpone";
      const lock = b.lock && typeof b.lock === "object" ? (b.lock as Record<string, unknown>) : null;
      return {
        code: "POSTPONE",
        status,
        reason: str(b.reason) ?? "unwell",
        screen: (str(b.screen) as ScreenId | null) ?? null,
        alsoShow: Array.isArray(b.alsoShow)
          ? (b.alsoShow.filter((x) => typeof x === "string") as ScreenId[])
          : [],
        lock: lock ? { reason: str(lock.reason) ?? "", until: num(lock.until) } : null,
      };
    }
    case "HOME_CLOSED":
      return { code: "HOME_CLOSED" };
    case "NOT_OPEN":
      return { code: "NOT_OPEN", status: str(b.status) };
    case "CONSENT_REQUIRED":
      return { code: "CONSENT_REQUIRED" };
    case "CONSENT_VERSION":
      return { code: "CONSENT_VERSION", version: num(b.version) };
    case "TOO_SOON":
      return { code: "TOO_SOON", until: num(b.until) };
    case "SKIPPED":
      return { code: "SKIPPED", reason: str(b.reason) };
    case "NO_RESULTS":
      return { code: "NO_RESULTS" };
    case "NOT_DUE":
      return { code: "NOT_DUE" };
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
];

/** The start call answer as a flow event payload (START_RESULT). */
export function toStartResult(r: ApiResult<StartOk>): StartResult {
  if (r.ok) {
    return {
      ok: true,
      id: r.value.id,
      kind: r.value.kind,
      protocol: r.value.protocol,
      warnings: r.value.warnings,
      helperRequired: r.value.helperRequired,
    };
  }
  const e = r.error;
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
      lock: c.lock ? { until: c.lock.until } : null,
    };
  if (c?.code === "LOCKED") return { ok: false, code: "LOCKED", until: c.until, releasable: c.releasable };
  if (c?.code === "CONSENT_REQUIRED") return { ok: false, code: "CONSENT_REQUIRED" };
  // The session ended (401 AUTH_REQUIRED, or a 403 AUTH_ code): sign in again, never Try again.
  if (e.status === 401 || (e.status === 403 && e.code.startsWith("AUTH"))) return { ok: false, code: "AUTH" };
  const code = (START_ERRORS as readonly string[]).includes(e.code) ? (e.code as StartError) : "server";
  return { ok: false, code };
}

/** The context as the flow reads it (CONTEXT_LOADED). The lock reason stays out of the client. */
export function toSignedInContext(c: ContextResponse): SignedInContext {
  return {
    ctx: c.ctx ?? null,
    blocked: c.blocked ?? null,
    setting: c.setting,
    setup: c.setup ?? null,
    firstCheck: c.firstCheck,
    completedBefore: c.completedBefore,
    unresolvedChangeReported: c.unresolvedChangeReported,
    lastCheckLasting: c.lastCheckLasting,
    ...(c.sideLeanDoneAtHome !== undefined ? { sideLeanDoneAtHome: c.sideLeanDoneAtHome } : {}),
    ...(c.neededArmsLastStand !== undefined ? { neededArmsLastStand: c.neededArmsLastStand } : {}),
    baseTests: c.baseTests ?? [],
    lock: c.lock ? { until: c.lock.until, releasable: lockReleasable(c.lock) } : null,
    earliestNext: c.earliestNext ?? null,
    consent: c.consent,
    homeOpen: c.homeOpen === true,
    ...(c.adultConfirmed !== undefined ? { adultConfirmed: c.adultConfirmed } : {}),
  };
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
