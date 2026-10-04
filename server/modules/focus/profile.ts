/**
 * GET /api/focus/profile?checkId= (product v7 contract section 4, stream B, step B4): the range
 * profile and findings of the latest completed focus check (or the one named), the body map
 * summary, the gait card and the changes against the first check. Registered behind AZM_V7 by
 * server/modules/index.ts, so this file never checks the flag itself.
 *
 * Placeholder of step A5 (contract 1.3): no route yet.
 */
import type { Route } from "../../http/types";

export const profileRoutes: Route[] = [];
