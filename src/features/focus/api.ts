/**
 * The focus check's calls (product v7 contract section 4): the intake (GET /api/auth/me), the context,
 * the focus_check consent, the start, each range result, a stop and the complete call, and the
 * findings' reads (the person's checks, GET /api/focus, and a check's profile, GET
 * /api/focus/profile). Every call
 * returns an ApiResult instead of throwing (the v1 check's shape, src/features/assessment/api.ts), so
 * a screen always has a typed way forward. A booth pass of this tab travels as X-Azm-Booth (C-14): the
 * focus routes accept a signed in booth check only with it, and the context previews the booth's
 * protocol with it.
 */
import type { ApiResult, LockView } from "../assessment/api";
import { readBoothPass } from "../assessment/boothMode";
import type { RomMeasureResult } from "../../engine/rom/types";
import type { GaitStoredView } from "../../medical/gait-types";
import type { Intake } from "../../medical/plan";
import type { MeasurementGrade } from "../../medical/rom-norms";
import type { BodyMapKey } from "../../medical/body-map";
import type { GaitChange } from "../../medical/rom-profile";
import type { BodyMapColour, RomChange, RomFinding, RomProfile } from "../../medical/rom-types";
import type { RomSide, RomMovementId } from "../../movements/rom/types";
import type { StopOptionId } from "../../movements/types";
import type { FocusContext, FocusStopRoute, StartResponse } from "./flow";

export interface RomSaved {
  saved: true;
  grade: MeasurementGrade;
  typical: number | null;
}

export interface FocusComplete {
  status: "completed";
  profile: RomProfile;
  findings: RomFinding[];
  gait: GaitStoredView | null;
}

/** GET /api/focus/profile (contract section 4): a completed check's profile, findings, body map, walk and changes. */
export interface FocusProfile {
  profile: RomProfile;
  findings: RomFinding[];
  bodyMap: Partial<Record<BodyMapKey, BodyMapColour>>;
  gait: GaitStoredView | null;
  changes: RomChange[];
  gaitChanges: GaitChange[];
}

/** One of the person's focus checks (GET /api/focus). */
export interface FocusCheckSummary {
  id: string;
  kind: "baseline" | "retest";
  setting: "home" | "booth";
  status: "open" | "completed" | "ended_early" | "abandoned";
  started: number;
  completed: number | null;
  measured: number;
  gait: boolean;
}

export interface FocusApi {
  me(): Promise<ApiResult<{ intake: Intake | null }>>;
  context(): Promise<ApiResult<FocusContext>>;
  consent(): Promise<ApiResult<unknown>>;
  start(body: unknown): Promise<ApiResult<StartResponse>>;
  saveRom(id: string, result: RomMeasureResult): Promise<ApiResult<RomSaved>>;
  stop(
    id: string,
    option: StopOptionId,
    ref: { movementId: RomMovementId; side: RomSide } | null,
  ): Promise<ApiResult<{ route: FocusStopRoute; lock: LockView | null }>>;
  complete(id: string): Promise<ApiResult<FocusComplete>>;
  /** A completed check's findings; null reads the latest completed check. */
  profile(checkId: string | null): Promise<ApiResult<FocusProfile>>;
  /** The person's focus checks, newest first. */
  checks(): Promise<ApiResult<{ checks: FocusCheckSummary[] }>>;
  /**
   * D-032 item 3: the week built from the latest completed check (POST /api/program/targets), the
   * program of a person whose program waited for the check.
   */
  programTargets(): Promise<ApiResult<unknown>>;
  /** D-032 item 3: the history builds the program (POST /api/program/history). */
  programHistory(): Promise<ApiResult<{ ok: true }>>;
}

export interface FocusApiOptions {
  fetch?: typeof fetch;
  /** The API's origin (tests); the page's own by default. */
  origin?: string;
  /** Extra headers for every call (tests: the session cookie). */
  headers?: Record<string, string>;
  /** The booth pass to send; by default this tab's staff pass (boothMode.ts). */
  boothPass?: () => string | null;
  online?: () => boolean;
}

/** This tab's staff booth session, or null (an E2E override pass has none to send). */
export function tabBoothPass(): string | null {
  const pass = readBoothPass();
  return pass?.kind === "staff" ? pass.session : null;
}

export function createFocusApi(opts: FocusApiOptions = {}): FocusApi {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const online = opts.online ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const booth = opts.boothPass ?? tabBoothPass;

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResult<T>> {
    if (!online()) return { ok: false, error: { kind: "offline" } };
    const pass = booth();
    let res: Response;
    try {
      res = await doFetch(`${opts.origin ?? ""}/api${path}`, {
        method,
        credentials: "same-origin",
        headers: {
          ...(method === "GET"
            ? { Accept: "application/json" }
            : { "Content-Type": "application/json", "X-Azm-Request": "1" }),
          ...(pass ? { "X-Azm-Booth": pass } : {}),
          ...opts.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, error: { kind: "network" } };
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (res.ok) return { ok: true, value: json as T };
    const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const code = typeof obj.error === "string" ? obj.error : "SERVER";
    return { ok: false, error: { kind: "http", status: res.status, code, body: obj } };
  }

  return {
    me: () => call("GET", "/auth/me"),
    context: () => call("GET", "/focus/context"),
    consent: () => call("POST", "/consents", { kind: "focus_check", version: 1 }),
    start: (body) => call("POST", "/focus", body),
    saveRom: (id, result) => call("POST", `/focus/${id}/rom`, result),
    stop: (id, option, ref) =>
      call(
        "POST",
        `/focus/${id}/stop`,
        ref ? { option, movementId: ref.movementId, side: ref.side } : { option },
      ),
    complete: (id) => call("POST", `/focus/${id}/complete`, {}),
    profile: (checkId) =>
      call(
        "GET",
        checkId === null ? "/focus/profile" : `/focus/profile?checkId=${encodeURIComponent(checkId)}`,
      ),
    checks: () => call("GET", "/focus"),
    programTargets: () => call("POST", "/program/targets", {}),
    programHistory: () => call("POST", "/program/history", {}),
  };
}
