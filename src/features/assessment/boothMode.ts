/**
 * Booth mode on the phone (contract v3 I, O17, 7.2-11; UX spec S55).
 *
 * The booth runs on staff phones only (simplicity cut C34). The raw staff code never stays on a
 * phone: staff type the daily code on /?booth=1, POST /api/booth/verify answers the device session
 * of the booth day { session, expires }, and the tab keeps it in sessionStorage (`azm.booth`, it ends
 * with the tab) until closing time. Every visitor, signed in or not, runs the check there as a guest.
 */
import type { CheckApi } from "./api";

const KEY = "azm.booth";
/** A booth session as the server issues it: 64 hex characters (server/modules/booth/store.ts). */
const PASS = /^[0-9a-f]{64}$/;

export type BoothPass =
  | { kind: "staff"; session: string; expires: number }
  /** The E2E override (VITE_E2E builds only): booth mode without a server pass. */
  | { kind: "e2e" };

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The E2E override: a plain string in sessionStorage turns booth mode on in VITE_E2E builds only
 * (the Playwright smoke has no staff code). Production reads only a pass the server issued.
 */
const E2E_OVERRIDE = import.meta.env.VITE_E2E === "1";

function parse(raw: string, now: number): BoothPass | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return E2E_OVERRIDE && raw.length > 0 && raw.length <= 64 ? { kind: "e2e" } : null;
  }
  const p = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!p || typeof p.expires !== "number" || !(p.expires > now)) return null;
  if (p.kind === "staff" && typeof p.session === "string" && PASS.test(p.session))
    return { kind: "staff", session: p.session, expires: p.expires };
  return E2E_OVERRIDE && raw.length > 0 && raw.length <= 64 ? { kind: "e2e" } : null;
}

/** This tab's booth pass, or null (an expired pass is removed). */
export function readBoothPass(now = Date.now()): BoothPass | null {
  try {
    const s = storage();
    const raw = s?.getItem(KEY);
    if (!raw) return null;
    const pass = parse(raw, now);
    if (!pass) s?.removeItem(KEY);
    return pass;
  } catch {
    return null;
  }
}

/** Keeps the staff device session after a successful POST /api/booth/verify (never the code). */
export function saveStaffSession(session: string, expires: number): void {
  if (!PASS.test(session)) return;
  try {
    storage()?.setItem(KEY, JSON.stringify({ kind: "staff", session, expires }));
  } catch {
    /* private mode: booth mode lasts for this page only */
  }
}

export function clearBoothPass(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
}

/** This tab is in booth mode (a staff session, or the E2E override). */
export function isBoothMode(now = Date.now()): boolean {
  return readBoothPass(now) !== null;
}

/**
 * Whether the server still accepts this tab's session (the guest check asks whenever it opens
 * online). False only when the server refused it; a network error keeps booth mode, so a booth phone
 * works offline (O18). The E2E override is never checked.
 */
export async function boothPassHolds(api: Pick<CheckApi, "boothCheck">): Promise<boolean> {
  const pass = readBoothPass();
  if (!pass) return false;
  if (pass.kind === "e2e") return true;
  const r = await api.boothCheck(pass.session);
  return !(r.ok && r.value.ok === false);
}
