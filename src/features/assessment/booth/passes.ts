/**
 * The booth passes as the booth screens read them (contract v3 I, O17, 7.2-11; UX spec S55, S55b):
 * what each server answer means for the screen, the typed staff code, the visitor QR link, and the
 * mark a visitor's phone keeps once its one check token has ended.
 *
 * The raw staff code never stays on a phone: it goes from the input to POST /api/booth/verify and is
 * dropped. Only the server's pass is kept, by boothMode.ts (sessionStorage `azm.booth`, this tab only).
 */
import type { ApiResult, BoothRedeemResponse, BoothVerifyResponse } from "../api";

/** A booth session or token as the server issues it (server/modules/booth/store.ts). */
export const PASS_FORMAT = /^[0-9a-f]{64}$/;

/**
 * The staff code as typed (UX spec 0.2): Arabic Indic (٠ to ٩) and Persian (۰ to ۹) digits become
 * ASCII, spaces around it go. Letters stay as typed: the server compares the whole code.
 */
export function normalizeCode(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim();
}

export type VerifyOutcome =
  | { kind: "on"; session: string; expires: number }
  /** The code is not today's code. */
  | { kind: "wrong" }
  /** Outside the booth days and hours (O17): no code works now. */
  | { kind: "closed" }
  | { kind: "offline" }
  /** Too many tries (429): wait, then try again. */
  | { kind: "limited" }
  | { kind: "error" };

/** POST /api/booth/verify, read for S55. */
export function verifyOutcome(r: ApiResult<BoothVerifyResponse>): VerifyOutcome {
  if (!r.ok) {
    if (r.error.kind === "offline") return { kind: "offline" };
    if (r.error.kind === "http" && r.error.status === 429) return { kind: "limited" };
    return { kind: "error" };
  }
  const v = r.value;
  if (v.ok && PASS_FORMAT.test(v.session) && v.expires > Date.now())
    return { kind: "on", session: v.session, expires: v.expires };
  if (!v.ok && v.closed) return { kind: "closed" };
  if (!v.ok) return { kind: "wrong" };
  return { kind: "error" };
}

export type TokenOutcome =
  | { kind: "qr"; token: string; expires: number }
  /** 403 BOOTH_SESSION: the staff session has ended (closing time): booth mode ends on this phone. */
  | { kind: "sessionEnded" }
  | { kind: "offline" }
  | { kind: "error" };

/** POST /api/booth/token, read for the visitor QR of S55. */
export function tokenOutcome(r: ApiResult<{ token: string; expires: number }>): TokenOutcome {
  if (!r.ok) {
    if (r.error.kind === "offline") return { kind: "offline" };
    if (r.error.kind === "http" && r.error.code === "BOOTH_SESSION") return { kind: "sessionEnded" };
    return { kind: "error" };
  }
  const v = r.value;
  if (typeof v?.token === "string" && PASS_FORMAT.test(v.token) && typeof v.expires === "number")
    return { kind: "qr", token: v.token, expires: v.expires };
  return { kind: "error" };
}

export type RedeemOutcome =
  | { kind: "on"; token: string; expires: number }
  /** The token was spent, used, ended or never valid: booth.tokenEnded. */
  | { kind: "ended" }
  | { kind: "offline" }
  | { kind: "error" };

/** POST /api/booth/redeem, read for S55b. A token of the wrong form is ended without a call. */
export function redeemOutcome(r: ApiResult<BoothRedeemResponse>): RedeemOutcome {
  if (!r.ok) {
    if (r.error.kind === "offline") return { kind: "offline" };
    // 400 BOOTH_INVALID: the link was changed; nothing to try again.
    if (r.error.kind === "http" && r.error.status === 400) return { kind: "ended" };
    return { kind: "error" };
  }
  const v = r.value;
  if (v.ok && PASS_FORMAT.test(v.token) && v.expires > Date.now())
    return { kind: "on", token: v.token, expires: v.expires };
  return { kind: "ended" };
}

/**
 * The link of the visitor QR (S55): this site with the one check token. It is shown only as a QR
 * code, never as text (S55). Arabic first: the visitor's phone opens in Arabic and can switch.
 */
export function visitorLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/?boothToken=${token}`;
}

/* ------------------------------------------------------------------ the ended mark (S55b) */

/**
 * A visitor's phone keeps this mark (sessionStorage, this tab only) from the moment its token is
 * redeemed. When the pass is gone later (the results showed, 10 minutes hidden, 45 minutes), the
 * mark says booth mode has ended here, so the start actions show booth.tokenEnded instead (S55b):
 * a home check never runs under booth rules, and nobody wonders why the booth badge went away.
 */
const VISITOR_MARK = "azm.booth.visitor";

function session(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function markVisitorPhone(): void {
  try {
    session()?.setItem(VISITOR_MARK, "1");
  } catch {
    /* private mode: the mark lasts for this page only */
  }
}

export function wasVisitorPhone(): boolean {
  try {
    return session()?.getItem(VISITOR_MARK) === "1";
  } catch {
    return false;
  }
}

export function clearVisitorMark(): void {
  try {
    session()?.removeItem(VISITOR_MARK);
  } catch {
    /* nothing kept */
  }
}
