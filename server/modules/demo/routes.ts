/**
 * POST /api/demo/start {} (the booth demo, /demo): signs out whoever this browser was signed in as
 * and signs in a fresh demo person (store.ts), with the session cookie of a normal sign in. Public,
 * behind AZM_V7 (server/modules/index.ts), and rate limited so the public link cannot fill the
 * database: 30 demo people per address and 200 in all every 15 minutes.
 *
 * → 200 { user, intake, plan, awaitingCheck, demo: true }, the account state of a sign in.
 */
import type { Route } from "../../http/types";
import { sessionCookie, sessionToken, sessionValue } from "../../http/session";
import { isAwaiting } from "../program/awaiting";
import { createDemoPerson, DEMO_INTAKE, DEMO_SESSION_MS } from "./store";

const WINDOW_MS = 15 * 60 * 1000;
/** Demo people one address may create in 15 minutes (a booth phone: one every 30 s). */
export const DEMO_PER_IP = 30;
/** Demo people every address together may create in 15 minutes. */
export const DEMO_ALL = 200;

export const demoRoutes: Route[] = [
  {
    method: "POST",
    path: /^\/api\/demo\/start$/,
    auth: "public",
    handle({ req, res, db, body, ip, json, limited }) {
      if (Object.keys(body).length) return json(400, { error: "DEMO_INVALID", field: "body" });
      if (limited(`demo:${ip}`, DEMO_PER_IP, WINDOW_MS) || limited("demo:all", DEMO_ALL, WINDOW_MS))
        return json(429, { error: "RATE_LIMIT" });
      const now = Date.now();
      // The visitor before is signed out: their session ends here.
      const old = sessionValue(req);
      if (old) db.prepare("DELETE FROM sessions WHERE token=? OR expires<?").run(sessionToken(old), now);
      const person = createDemoPerson(db, now);
      res.setHeader("Set-Cookie", sessionCookie(person.session, Math.round(DEMO_SESSION_MS / 1000)));
      json(200, {
        user: { id: person.id, name: person.name, email: person.email, role: "member" },
        intake: DEMO_INTAKE,
        plan: person.plan,
        awaitingCheck: isAwaiting(db, person.id),
        demo: true,
      });
    },
  },
];
