/**
 * Booth staff mode (contract v3 I, O17, 7.2-11, UX spec S55 and S55b).
 *
 *   POST /api/booth/verify  { code }     public; 10 tries per IP in 15 minutes; → { ok } and, when
 *                                        ok, the staff device session of the booth day { session,
 *                                        expires }; { ok: false, closed: true } outside the booth
 *                                        days and hours
 *   POST /api/booth/token   { session }  a one check visitor token for 45 minutes at most, never past
 *                                        closing: { token, expires }; 403 BOOTH_SESSION
 *   POST /api/booth/redeem  { token }    the visitor's phone checks its token: { ok, expires? }
 *
 * A signed in booth check starts with boothCode (contract v3 I) or boothToken (O17), see
 * POST /api/assessments. Codes, sessions and tokens are never logged or stored in the clear.
 */
import type { Route } from "../../http/types";
import { boothCodeMatches, boothWindow } from "./config";
import { createPass, PASS, validPass } from "./store";

const WINDOW_MS = 15 * 60 * 1000;
/** Contract v3 I: 10 verify calls per IP in 15 minutes. */
export const VERIFY_PER_IP = 10;
/** Visitor phones share the venue's address, so the token routes allow more per IP. */
const PASS_CALLS_PER_IP = 60;
/** A visitor token covers one check and lasts at most 45 minutes (O17, S55b). */
export const VISITOR_TOKEN_MS = 45 * 60 * 1000;

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
      const bad = onlyKey(body, "code");
      if (bad) return json(400, { error: "BOOTH_INVALID", field: bad });
      if (typeof body.code !== "string" || body.code.length > 64)
        return json(400, { error: "BOOTH_INVALID", field: "code" });
      const now = Date.now();
      const ok = boothCodeMatches(body.code, now);
      const window = boothWindow(now);
      if (!window.open) return json(200, { ok: false, closed: true });
      if (!ok) return json(200, { ok: false });
      const session = createPass(db, "staff", window.closes, now);
      json(200, { ok: true, session, expires: window.closes });
    },
  },
  {
    method: "POST",
    path: /^\/api\/booth\/token$/,
    auth: "public",
    handle({ db, body, ip, json, limited }) {
      if (limited(`booth-token:${ip}`, PASS_CALLS_PER_IP, WINDOW_MS))
        return json(429, { error: "RATE_LIMIT" });
      const bad = onlyKey(body, "session");
      if (bad || typeof body.session !== "string" || !PASS.test(body.session))
        return json(403, { error: "BOOTH_SESSION" });
      const now = Date.now();
      const window = boothWindow(now);
      const staff = window.open ? validPass(db, body.session, "staff", now) : null;
      if (staff === null) return json(403, { error: "BOOTH_SESSION" });
      const expires = Math.min(now + VISITOR_TOKEN_MS, window.closes, staff);
      json(200, { token: createPass(db, "visitor", expires, now), expires });
    },
  },
  {
    method: "POST",
    path: /^\/api\/booth\/redeem$/,
    auth: "public",
    handle({ db, body, ip, json, limited }) {
      if (limited(`booth-redeem:${ip}`, PASS_CALLS_PER_IP, WINDOW_MS))
        return json(429, { error: "RATE_LIMIT" });
      if (onlyKey(body, "token")) return json(400, { error: "BOOTH_INVALID", field: "body" });
      const now = Date.now();
      const expires = boothWindow(now).open ? validPass(db, body.token, "visitor", now) : null;
      json(200, expires === null ? { ok: false } : { ok: true, expires });
    },
  },
];
