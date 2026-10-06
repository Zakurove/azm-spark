/**
 * The walk's two calls (product v7 contract section 4, stream C, step C4): the person's intake (the
 * walking aid, the height and the body map, for the walk's setup) and POST /api/focus/:id/gait with
 * the setup and the analysis, as the focus check's other calls send them (the X-Azm-Request header and
 * this tab's booth pass, C-14). Never throws: a refusal carries its status and code, no network is
 * status 0. Landmarks never leave the phone except the derived numbers and one replay cycle (C-12).
 */
import type { GaitStoredView } from "../../medical/gait-types";
import type { Intake } from "../../medical/plan";
import { tabBoothPass } from "../focus/api";
import type { GaitBody } from "./controller";

export type GaitCallResult<T> = { ok: true; value: T } | { ok: false; status: number; code: string };

export interface GaitApiOptions {
  fetch?: typeof fetch;
  origin?: string;
  headers?: Record<string, string>;
  boothPass?: () => string | null;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  opts: GaitApiOptions,
): Promise<GaitCallResult<T>> {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const pass = (opts.boothPass ?? tabBoothPass)();
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
    return { ok: false, status: 0, code: "NETWORK" };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.ok) return { ok: true, value: json as T };
  const code =
    json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
      ? (json as { error: string }).error
      : "SERVER";
  return { ok: false, status: res.status, code };
}

/** The signed in person's intake, or null (GET /api/auth/me). */
export async function readIntake(opts: GaitApiOptions = {}): Promise<Intake | null> {
  const r = await call<{ intake?: Intake | null }>("GET", "/auth/me", undefined, opts);
  return r.ok ? (r.value?.intake ?? null) : null;
}

/**
 * POST /api/focus/:id/gait. A network failure is tried twice more at once; an answer from the server
 * (saved or refused) is final.
 */
export async function saveGait(
  checkId: string,
  body: GaitBody,
  opts: GaitApiOptions = {},
): Promise<GaitCallResult<GaitStoredView>> {
  let r: GaitCallResult<GaitStoredView> = { ok: false, status: 0, code: "NETWORK" };
  for (let i = 0; i < 3; i++) {
    r = await call<GaitStoredView>("POST", `/focus/${encodeURIComponent(checkId)}/gait`, body, opts);
    if (r.ok || r.status !== 0) break;
  }
  return r;
}
