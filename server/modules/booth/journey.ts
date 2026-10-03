/**
 * The booth v2 journey (contract C2 and C8): the report reading and the program of the booth, for a
 * valid booth pass only (a staff phone after the daily code). Nothing is stored and nothing is logged:
 * the photo, the reading, the intake and the plan exist only for the answer.
 *
 *   POST /api/booth/report { session, kind: "image", image, lang }
 *        the same extractReport as at home. The pass also travels as X-Azm-Booth, so the photo's
 *        larger body cap is granted from the headers before anything is buffered (bodyLimit).
 *        30 reads per pass in 15 minutes. → the sanitized extraction; 503 without a reading engine,
 *        502 when it fails (the booth then shows its own reading of Saad's sample report).
 *   POST /api/booth/plan { session, intake }
 *        createPlan, then the weekly plan (the model arranges what the rules allowed, with the rules
 *        fallback; null when the plan is in review). 30 per pass in 15 minutes. → { plan, weekly }
 */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Route } from "../../http/types";
import { createPlan, validateIntake } from "../../../src/medical/plan";
import { extractReport, validReportBody } from "../../report";
import { createWeekly } from "../../weekly-ai";
import { boothWindow } from "./config";
import { validPass } from "./store";

const WINDOW_MS = 15 * 60 * 1000;
/** Contract C2: 30 report reads per pass in 15 minutes. */
export const READS_PER_PASS = 30;
/** Contract C8: the program is rate limited like the reading. */
export const PLANS_PER_PASS = 30;
/** The report photo's body cap: the image (at most 4 MB decoded, validReportBody) in base64 JSON. */
const PHOTO_BODY = 6 * 1024 * 1024;

const REFUSED = { status: 401, error: "BOOTH_REQUIRED" } as const;

/** A staff pass that holds now (the booth is open and the pass has not ended). */
function holds(db: DatabaseSync, session: unknown, now = Date.now()): session is string {
  return boothWindow(now).open && validPass(db, session, now) !== null;
}

/** The rate limit key of a pass: its digest, so no raw pass is kept even in memory. */
const passKey = (kind: string, session: string) =>
  `booth-${kind}:${createHash("sha256").update(session, "utf8").digest("hex").slice(0, 32)}`;

const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export const journeyRoutes: Route[] = [
  {
    method: "POST",
    path: /^\/api\/booth\/report$/,
    auth: "public",
    bodyLimit({ req, db, limited }) {
      const session = header(req.headers["x-azm-booth"]);
      if (!holds(db, session)) return REFUSED;
      if (limited(passKey("report", session), READS_PER_PASS, WINDOW_MS))
        return { status: 429, error: "RATE_LIMIT" };
      return PHOTO_BODY;
    },
    async handle({ req, db, body, json }) {
      const session = header(req.headers["x-azm-booth"]);
      if (body.session !== session || !holds(db, body.session)) return json(401, { error: REFUSED.error });
      const { session: _session, ...rest } = body as Record<string, unknown>;
      void _session;
      const extra = Object.keys(rest).some((k) => !["kind", "image", "lang"].includes(k));
      if (extra || rest.kind !== "image" || !validReportBody(rest))
        return json(400, { error: "REPORT_INVALID" });
      const key = process.env.OPENAI_API_KEY;
      if (!key) return json(503, { error: "EXTRACTION_UNAVAILABLE" });
      try {
        json(200, await extractReport(rest, key));
      } catch {
        // Nothing is logged at the booth: the phone shows its own reading of the sample report.
        json(502, { error: "ENGINE_FAILED" });
      }
    },
  },
  {
    method: "POST",
    path: /^\/api\/booth\/plan$/,
    auth: "public",
    async handle({ db, body, json, limited }) {
      if (!holds(db, body.session)) return json(401, { error: REFUSED.error });
      if (limited(passKey("plan", body.session), PLANS_PER_PASS, WINDOW_MS))
        return json(429, { error: "RATE_LIMIT" });
      if (Object.keys(body).some((k) => k !== "session" && k !== "intake"))
        return json(400, { error: "INTAKE_INVALID" });
      const intake = body.intake;
      if (!validateIntake(intake)) return json(400, { error: "INTAKE_INVALID" });
      const plan = createPlan(intake);
      const weekly =
        plan.status === "ready" ? await createWeekly(intake, plan, process.env.OPENAI_API_KEY) : null;
      json(200, { plan, weekly });
    },
  },
];
