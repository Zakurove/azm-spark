/**
 * The session cookie (server/api.ts signs in and out with it; the booth demo's route too): HttpOnly,
 * SameSite Strict, Secure in production. Only the SHA-256 of its value is stored (sessions.token).
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const SESSION_COOKIE = "azm_session";

/** The Set-Cookie value for a session (an empty value with age 0 signs out). */
export function sessionCookie(value: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

/** The request's session cookie value, or "". */
export function sessionValue(req: IncomingMessage): string {
  return (
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1) ?? ""
  );
}

/** The stored token of a session value. */
export const sessionToken = (value: string) => createHash("sha256").update(value).digest("hex");
