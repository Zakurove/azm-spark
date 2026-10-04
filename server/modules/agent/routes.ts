/**
 * POST /api/agent/token and POST /api/agent/usage (product v7 contract 5.1 and 5.2, stream D):
 * the live coach's ephemeral token, its budget and the usage report. Registered behind AZM_V7 by
 * server/modules/index.ts (404 when the flag is off); D answers 503 AGENT_UNAVAILABLE when
 * AZM_AGENT_ENABLED is off or GEMINI_API_KEY is missing.
 *
 * Placeholder of step A5 (contract 1.3): no route yet.
 */
import type { Route } from "../../http/types";

export const agentRoutes: Route[] = [];
