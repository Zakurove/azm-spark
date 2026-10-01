/**
 * Booth staff mode (contract v3 I, O17, 7.2-11, UX spec S55). The booth runs on staff phones only
 * (simplicity cut C34): a visitor, signed in or not, runs the check there as a guest.
 *
 *   POST /api/booth/verify  { code }     public; 10 tries per IP and 30 in all in 15 minutes; → { ok } and, when
 *                                        ok, the staff device session of the booth day { session,
 *                                        expires }; { ok: false, closed: true } outside the booth
 *                                        days and hours
 *   POST /api/booth/check   { session }  whether the staff session still holds: { ok, expires? }
 *
 * Codes and sessions are never logged or stored in the clear.
 */
import type { Route } from "../../http/types";
import { boothCodeMatches, boothWindow } from "./config";
import { createPass, validPass } from "./store";

const WINDOW_MS = 15 * 60 * 1000;
/** Contract v3 I: 10 verify calls per IP in 15 minutes. */
export const VERIFY_PER_IP = 10;
/**
 * The verify calls of every address together in 15 minutes. Staff verify a handful of phones a day;
 * the cap keeps guessing across many addresses to a few thousand codes a day at most. It is checked
 * before the code, so it refuses the right code too and tells nothing.
 */
export const VERIFY_ALL = 30;
/** The session check runs whenever a booth phone opens the guest check. */
const CHECK_CALLS_PER_IP = 60;

function onlyKey(body: Record<string, unknown>, key: string): string | null {
  const extra = Object.keys(body).filter((k) => k !== key);
  return extra.length ? "body" : null;
}

export const boothRoutes: Route[] = [
  {
    method: "POST",
    path: /^\/api\/booth\/verify$/,
    auth: "public",
    handle({ db, body, ip, json, limited }) {
      // Every call counts, whatever it holds, so the code cannot be guessed faster by bad bodies.
      if (limited(`booth-verify:${ip}`, VERIFY_PER_IP, WINDOW_MS)) return json(429, { error: "RATE_LIMIT" });
      if (limited("booth-verify:all", VERIFY_ALL, WINDOW_MS)) return json(429, { error: "RATE_LIMIT" });
      const bad = onlyKey(body, "code");
      if (bad) return json(400, { error: "BOOTH_INVALID", field: bad });
      if (typeof body.code !== "string" || body.code.length > 64)
        return json(400, { error: "BOOTH_INVALID", field: "code" });
      const now = Date.now();
      const ok = boothCodeMatches(body.code, now);
      const window = boothWindow(now);
      if (!window.open) return json(200, { ok: false, closed: true });
      if (!ok) return json(200, { ok: false });
      const session = createPass(db, window.closes, now);
      json(200, { ok: true, session, expires: window.closes });
    },
  },
  {
    method: "POST",
    path: /^\/api\/booth\/check$/,
    auth: "public",
    handle({ db, body, ip, json, limited }) {
      if (limited(`booth-check:${ip}`, CHECK_CALLS_PER_IP, WINDOW_MS))
        return json(429, { error: "RATE_LIMIT" });
      if (onlyKey(body, "session")) return json(400, { error: "BOOTH_INVALID", field: "body" });
      const now = Date.now();
      const expires = boothWindow(now).open ? validPass(db, body.session, now) : null;
      json(200, expires === null ? { ok: false } : { ok: true, expires });
    },
  },
];
