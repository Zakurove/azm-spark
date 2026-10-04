import type { Route } from "../../http/types";
import { revokeFocusChecks } from "../focus/store";
import { acceptConsent, CONSENT_VERSIONS, isConsentKind, revokeConsent } from "./store";

/**
 * The movement check consent (spec 2.1): explicit, for this purpose only, separate from the program
 * consent of the intake, stored with a timestamp and a version. Revoking it ends every open check
 * (no more results are stored under it); what was stored before stays with the person.
 */
// SPEC-GAP: consent-revoke. The spec does not say what revoking does; results need an active consent
// (403 CONSENT_REQUIRED) and open checks end as abandoned. Stored checks are not deleted here.
export const consentRoutes: Route[] = [
  {
    method: "POST",
    path: /^\/api\/consents$/,
    auth: "user",
    handle({ db, user, body, json }) {
      const keys = Object.keys(body);
      if (keys.some((k) => k !== "kind" && k !== "version"))
        return json(400, { error: "CONSENT_INVALID", field: "body" });
      const kind: unknown = body.kind;
      if (!isConsentKind(kind)) return json(400, { error: "CONSENT_INVALID", field: "kind" });
      if (body.version !== CONSENT_VERSIONS[kind])
        return json(409, { error: "CONSENT_VERSION", version: CONSENT_VERSIONS[kind] });
      const record = acceptConsent(db, user!.id, kind, Date.now());
      json(200, record);
    },
  },
  {
    method: "DELETE",
    path: /^\/api\/consents\/(?<kind>[a-z_]{1,40})$/,
    auth: "user",
    handle({ db, user, params, json }) {
      if (!isConsentKind(params.kind)) return json(404, { error: "NOT_FOUND" });
      const now = Date.now();
      db.exec("BEGIN IMMEDIATE");
      try {
        revokeConsent(db, user!.id, params.kind, now);
        // Only the movement check consent holds the checks.
        if (params.kind === "movement_check")
          db.prepare(
            "UPDATE assessments SET status='abandoned', ended_reason='consent_revoked' WHERE user_id=? AND status='open'",
          ).run(user!.id);
        // v7: the focus check consent holds the focus checks; live_coach keeps no server state.
        if (params.kind === "focus_check") revokeFocusChecks(db, user!.id);
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
      json(200, { kind: params.kind, revoked: true });
    },
  },
];
