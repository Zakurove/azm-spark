import type { Route } from "../http/types";
import { accountRoutes } from "./account/routes";
import { agentRoutes } from "./agent/routes";
import { followUpRoutes } from "./assessments/follow-up";
import { assessmentRoutes } from "./assessments/routes";
import { boothRoutes } from "./booth/routes";
import { consentRoutes } from "./consents/routes";
import { profileRoutes } from "./focus/profile";
import { focusRoutes, v7Gate } from "./focus/routes";
import { healthRoutes } from "./health/routes";
import { programRoutes } from "./program/routes";
import { progressRoutes } from "./progress/routes";

/** The module routes of v1, unchanged by v7. */
export const v1ModuleRoutes: readonly Route[] = [
  ...healthRoutes,
  ...accountRoutes,
  ...boothRoutes,
  ...consentRoutes,
  ...assessmentRoutes,
  ...followUpRoutes,
  ...progressRoutes,
];

/**
 * The v7 routes (product v7 contract section 4): the focus check (A), its profile (B), the live
 * coach (D) and the program (E), each behind AZM_V7 (C-9: 404 NOT_FOUND while the flag is off).
 * `focus` lets the route tests run the focus routes with their own rules.
 */
export function v7ModuleRoutes(focus: readonly Route[] = focusRoutes): Route[] {
  return [...focus, ...profileRoutes, ...agentRoutes, ...programRoutes].map(v7Gate);
}

/** Every module route, matched in order before the legacy routes in server/api.ts. */
export const moduleRoutes: readonly Route[] = [...v1ModuleRoutes, ...v7ModuleRoutes()];
