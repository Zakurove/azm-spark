/**
 * The coach's two server calls and the install's device id (product v7 contract 5.1 and 5.2, stream
 * D, step D4). The token request carries no free text (C-12): the block, the segment, the language,
 * the check or workout, the device id and the pause length. The usage report goes with fetch,
 * keepalive and the X-Azm-Request header, never navigator.sendBeacon (it cannot set the header, and the
 * origin check would answer 403). The wire types are the server's (server/modules/agent/types.ts).
 */
import type { TokenRequest, TokenResponse, UsageReport } from "../../../server/modules/agent/types";
import type { StopOptionId } from "../../movements/types";
import { tabBoothPass } from "../focus/api";
import type { MintResult } from "./session";

/** localStorage key of the random per install id (5.1 deviceId). */
export const DEVICE_KEY = "azm.device";
const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** The token response as 5.1 writes it; anything else is a failed mint. */
function isTokenResponse(v: unknown): v is TokenResponse {
  if (!isRecord(v)) return false;
  const history = v.history;
  return (
    typeof v.sessionId === "string" &&
    typeof v.token === "string" &&
    /^auth_tokens\/\S+$/.test(v.token) &&
    typeof v.model === "string" &&
    (v.apiVersion === "v1beta" || v.apiVersion === "v1alpha") &&
    typeof v.expiresAt === "string" &&
    typeof v.newSessionExpiresAt === "string" &&
    Array.isArray(history) &&
    history.length > 0 &&
    history.every(
      (h) => isRecord(h) && (h.role === "user" || h.role === "model") && typeof h.text === "string",
    )
  );
}

/** POST /api/agent/token. Never throws: a refusal carries its status and code, no network is status 0. */
export async function mintCoachToken(
  req: TokenRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<MintResult> {
  let res: Response;
  try {
    res = await fetchImpl("/api/agent/token", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Azm-Request": "1" },
      body: JSON.stringify(req),
    });
  } catch {
    return { ok: false, status: 0, error: "NETWORK" };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const error = isRecord(body) && typeof body.error === "string" ? body.error : "SERVER";
    return { ok: false, status: res.status, error };
  }
  if (!isTokenResponse(body)) return { ok: false, status: 502, error: "TOKEN_FAILED" };
  const date = Date.parse(res.headers.get("date") ?? "");
  return { ok: true, token: body, serverDate: Number.isFinite(date) ? date : null };
}

/** POST /api/agent/usage (5.2): at the end of a segment, at a fallback and when the page hides. */
export function sendUsageReport(r: UsageReport, fetchImpl: typeof fetch = fetch): void {
  try {
    void fetchImpl("/api/agent/usage", {
      method: "POST",
      keepalive: true,
      credentials: "same-origin",
      headers: { "X-Azm-Request": "1", "Content-Type": "application/json" },
      body: JSON.stringify(r),
    }).catch(() => undefined);
  } catch {
    /* a missing report leaves the reservation counted (5.2) */
  }
}

let pageId: string | null = null;

/** 24 characters of [A-Za-z0-9_-] from 18 random bytes. */
function randomId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** The random per install id (localStorage azm.device); one per page when storage is blocked. */
export function coachDeviceId(
  storage: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage === "undefined"
    ? null
    : localStorage,
): string {
  try {
    const kept = storage?.getItem(DEVICE_KEY);
    if (kept && DEVICE_ID.test(kept)) return kept;
    const id = randomId();
    storage?.setItem(DEVICE_KEY, id);
    if (storage) return id;
  } catch {
    /* storage blocked */
  }
  pageId ??= randomId();
  return pageId;
}

/** GET /api/agent/status (step D5): the coach can run now, and the person gave the live_coach consent. */
export interface CoachStatus {
  available: boolean;
  consent: boolean;
}

/** The coach's status, or null when it cannot be read (offline, signed out, a build without v7). */
export async function readCoachStatus(fetchImpl: typeof fetch = fetch): Promise<CoachStatus | null> {
  try {
    const res = await fetchImpl("/api/agent/status", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      // D-034 item 3: never silent.
      console.warn("[azm coach] status refused", { status: res.status });
      return null;
    }
    const body: unknown = await res.json();
    const status =
      isRecord(body) && typeof body.available === "boolean" && typeof body.consent === "boolean"
        ? { available: body.available, consent: body.consent }
        : null;
    if (!status?.available || !status.consent) console.info("[azm coach] status", status ?? body);
    return status;
  } catch (e) {
    console.warn("[azm coach] status failed", { message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** POST /api/consents for live_coach version 1 (C-8): true once the server kept it. */
export async function giveCoachConsent(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl("/api/consents", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Azm-Request": "1" },
      body: JSON.stringify({ kind: "live_coach", version: 1 }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * POST /api/agent/stop (D-030 D5-7): the person's stop list answer in a coached workout, so the server
 * sets the stop's next day lock as a check's stop does. A lost call is tried twice more at once; any
 * answer from the server is final. True once the server kept it. Never throws.
 */
export async function sendWorkoutStop(
  workoutId: string,
  option: StopOptionId,
  fetchImpl: typeof fetch = fetch,
  boothPass: () => string | null = tabBoothPass,
): Promise<boolean> {
  const pass = boothPass();
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetchImpl("/api/agent/stop", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Azm-Request": "1",
          ...(pass ? { "X-Azm-Booth": pass } : {}),
        },
        body: JSON.stringify({ workoutId, option }),
      });
      return res.ok;
    } catch {
      /* no network: once more */
    }
  }
  return false;
}
