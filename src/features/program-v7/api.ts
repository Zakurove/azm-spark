/**
 * The program's calls (product v7 contract section 4, stream E): POST /api/program/targets, the week
 * built from a completed focus check's findings, with the person's account (GET /api/auth/me) and
 * checks (GET /api/focus) beside it. Every call returns an ApiResult instead of throwing, as the focus
 * check's calls do (src/features/focus/api.ts), so a screen always has a typed way forward.
 */
import type { ApiResult } from "../assessment/api";
import type { Intake, Plan } from "../../medical/plan";
import type { ReferralId, TargetRequest } from "../../medical/target-types";
import type { WeeklyPlan } from "../../medical/weekly";
import { createFocusApi, type FocusCheckSummary } from "../focus/api";

/** The answer of POST /api/program/targets (contract section 4). */
export interface ProgramTargets {
  weekly: WeeklyPlan;
  version: number;
  targets: TargetRequest[];
  referrals: ReferralId[];
  unmet: TargetRequest[];
}

export interface ProgramApi {
  /** The week built from the findings of the latest completed check, or of the one named. */
  targets(checkId?: string): Promise<ApiResult<ProgramTargets>>;
  me(): Promise<ApiResult<{ intake: Intake | null; plan: Plan | null }>>;
  /** The person's focus checks, newest first. */
  checks(): Promise<ApiResult<{ checks: FocusCheckSummary[] }>>;
}

export interface ProgramApiOptions {
  fetch?: typeof fetch;
  /** The API's origin (tests); the page's own by default. */
  origin?: string;
  online?: () => boolean;
}

export function createProgramApi(opts: ProgramApiOptions = {}): ProgramApi {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const online = opts.online ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const focus = createFocusApi({ fetch: doFetch, origin: opts.origin, online, boothPass: () => null });

  async function targets(checkId?: string): Promise<ApiResult<ProgramTargets>> {
    if (!online()) return { ok: false, error: { kind: "offline" } };
    let res: Response;
    try {
      res = await doFetch(`${opts.origin ?? ""}/api/program/targets`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Azm-Request": "1" },
        body: JSON.stringify(checkId === undefined ? {} : { checkId }),
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
    if (res.ok) return { ok: true, value: json as ProgramTargets };
    const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const code = typeof obj.error === "string" ? obj.error : "SERVER";
    return { ok: false, error: { kind: "http", status: res.status, code, body: obj } };
  }

  return {
    targets,
    me: () => focus.me() as Promise<ApiResult<{ intake: Intake | null; plan: Plan | null }>>,
    checks: () => focus.checks(),
  };
}
