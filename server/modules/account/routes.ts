import type { Route } from "../../http/types";
import { confirmAdult } from "./store";

/**
 * POST /api/account/adult { confirmed: true } → { adultConfirmed: true, confirmedAt } (UX spec S05a,
 * Q2 (5), Q32 (6)). A person under 18 answers the other row, which stores and sends nothing.
 */
export const accountRoutes: Route[] = [
  {
    method: "POST",
    path: /^\/api\/account\/adult$/,
    auth: "user",
    handle({ db, user, body, json }) {
      const extra = Object.keys(body).filter((k) => k !== "confirmed");
      if (extra.length) return json(400, { error: "ADULT_INVALID", field: "body" });
      if (body.confirmed !== true) return json(400, { error: "ADULT_INVALID", field: "confirmed" });
      json(200, { adultConfirmed: true, confirmedAt: confirmAdult(db, user!.id, Date.now()) });
    },
  },
];
