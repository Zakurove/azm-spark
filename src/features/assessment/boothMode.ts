/**
 * Booth mode on the phone (contract v3 I, O17, 7.2-11; UX spec S55, S55b).
 *
 * The raw staff code never stays on a phone. The tab keeps one booth pass in sessionStorage
 * (`azm.booth`, it ends with the tab):
 *
 *   staff     a booth owned phone: staff typed the daily code on /?booth=1 and POST /api/booth/verify
 *             answered the device session of the booth day { session, expires } (S55);
 *   visitor   a visitor's own phone: it opened /?boothToken=<token> from the staff QR and
 *             POST /api/booth/redeem spent that token and gave this phone its own one check pass
 *             { token, expires } (S55b), so the link works on one phone only.
 *
 * Either pass turns booth mode on for this tab until it expires (closing time, or 45 minutes for a
 * visitor token). A signed in booth start sends a one check `boothToken`: the visitor's own token, or
 * on a staff phone a new one from POST /api/booth/token. The visitor token also ends when the results
 * show and after the tab stays hidden for 10 minutes (S55b).
 */
import type { CheckApi } from "./api";

const KEY = "azm.booth";
/** A booth session or token as the server issues it: 64 hex characters (server/modules/booth/store.ts). */
const PASS = /^[0-9a-f]{64}$/;
/** S55b: a visitor token ends after the tab stays hidden for 10 minutes. */
export const VISITOR_HIDDEN_MS = 10 * 60 * 1000;

export type BoothPass =
  | { kind: "staff"; session: string; expires: number }
  | { kind: "visitor"; token: string; expires: number }
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
  if (p.kind === "visitor" && typeof p.token === "string" && PASS.test(p.token))
    return { kind: "visitor", token: p.token, expires: p.expires };
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

function save(pass: Exclude<BoothPass, { kind: "e2e" }>): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(pass));
  } catch {
    /* private mode: booth mode lasts for this page only */
  }
}

/** Keeps the staff device session after a successful POST /api/booth/verify (never the code). */
export function saveStaffSession(session: string, expires: number): void {
  if (PASS.test(session)) save({ kind: "staff", session, expires });
}

/** Keeps the visitor's one check token after a successful POST /api/booth/redeem. */
export function saveVisitorToken(token: string, expires: number): void {
  if (PASS.test(token)) save({ kind: "visitor", token, expires });
}

export function clearBoothPass(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
}

/** This tab is in booth mode (a staff session, a visitor token, or the E2E override). */
export function isBoothMode(now = Date.now()): boolean {
  return readBoothPass(now) !== null;
}

/**
 * The one check token for a signed in booth start (O17): the visitor's token, or on a staff phone a
 * new token from the staff session. Null without a pass or when the server refuses one; the start is
 * then refused with BOOTH_CODE and staff turn booth mode on again.
 */
export async function boothStartToken(api: Pick<CheckApi, "boothToken">): Promise<string | null> {
  const pass = readBoothPass();
  if (!pass || pass.kind === "e2e") return null;
  if (pass.kind === "visitor") return pass.token;
  const r = await api.boothToken(pass.session);
  return r.ok ? r.value.token : null;
}

/**
 * Whether the server still accepts this tab's pass (the guest check asks whenever it opens online).
 * False only when the server refused it; a network error keeps booth mode, so a booth phone works
 * offline (O18). The E2E override is never checked.
 */
// SPEC-GAP: booth-session-probe. The server has no route that only checks a staff session; the probe
// asks for a visitor token (45 minutes at most, unused) and discards it.
export async function boothPassHolds(api: Pick<CheckApi, "boothToken" | "boothCheck">): Promise<boolean> {
  const pass = readBoothPass();
  if (!pass) return false;
  if (pass.kind === "e2e") return true;
  if (pass.kind === "visitor") {
    // Checked, never redeemed: a redeem would spend the pass.
    const r = await api.boothCheck(pass.token);
    return !(r.ok && r.value.ok === false);
  }
  const r = await api.boothToken(pass.session);
  return !(!r.ok && r.error.kind === "http" && r.error.code === "BOOTH_SESSION");
}

/**
 * Redeems a visitor token from the staff QR (/?boothToken=, S55b) and keeps the pass the server gives
 * this phone in its place (the QR token is spent). Returns whether booth mode is now on for this tab.
 */
export async function redeemVisitorToken(
  api: Pick<CheckApi, "boothRedeem">,
  token: string,
): Promise<boolean> {
  if (!PASS.test(token)) return false;
  const r = await api.boothRedeem(token);
  if (!r.ok || !r.value.ok || !PASS.test(r.value.token)) return false;
  saveVisitorToken(r.value.token, r.value.expires);
  return true;
}

/**
 * S55b: a visitor token ends after the tab stays hidden for 10 minutes. Returns the listener's
 * removal. `onEnded` runs when the token was cleared.
 */
export function watchVisitorHidden(onEnded: () => void, now: () => number = Date.now): () => void {
  if (typeof document === "undefined") return () => undefined;
  let hiddenAt: number | null = null;
  const onChange = () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = now();
      return;
    }
    const was = hiddenAt;
    hiddenAt = null;
    if (was !== null && now() - was >= VISITOR_HIDDEN_MS && readBoothPass()?.kind === "visitor") {
      clearBoothPass();
      onEnded();
    }
  };
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
