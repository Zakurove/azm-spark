import type { Route } from "../http/types";
import { assessmentRoutes } from "./assessments/routes";
import { consentRoutes } from "./consents/routes";
import { healthRoutes } from "./health/routes";
import { progressRoutes } from "./progress/routes";

/** Every module route, matched in order before the legacy routes in server/api.ts. */
export const moduleRoutes: readonly Route[] = [
  ...healthRoutes,
  ...consentRoutes,
  ...assessmentRoutes,
  ...progressRoutes,
];
