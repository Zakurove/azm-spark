import type { Route } from "../../http/types";

// Liveness for load balancers and the booth checklist. Reads only the schema version: no user
// data, no dependency versions. A broken database makes the query throw, which answers 500.
export const healthRoutes: Route[] = [
  {
    method: "GET",
    path: /^\/api\/health$/,
    auth: "public",
    handle({ db, res, json }) {
      const { v } = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as {
        v: number | null;
      };
      res.setHeader("Cache-Control", "no-store");
      json(200, { ok: true, schema: Number(v ?? 0), uptimeSec: Math.floor(process.uptime()) });
    },
  },
];
