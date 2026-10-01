/**
 * The booth staff session as the staff page reads it (contract v3 I, O17, 7.2-11; UX spec S55): what
 * the server's answer means for the screen, and the typed staff code.
 *
 * The raw staff code never stays on a phone: it goes from the input to POST /api/booth/verify and is
 * dropped. Only the server's pass is kept, by boothMode.ts (sessionStorage `azm.booth`, this tab only).
 */
import type { ApiResult, BoothVerifyResponse } from "../api";

/** A booth session as the server issues it (server/modules/booth/store.ts). */
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
