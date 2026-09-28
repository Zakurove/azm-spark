import type { Route } from "../http/types";
import { accountRoutes } from "./account/routes";
import { followUpRoutes } from "./assessments/follow-up";
import { assessmentRoutes } from "./assessments/routes";
import { boothRoutes } from "./booth/routes";
import { consentRoutes } from "./consents/routes";
import { healthRoutes } from "./health/routes";
import { progressRoutes } from "./progress/routes";

/** Every module route, matched in order before the legacy routes in server/api.ts. */
export const moduleRoutes: readonly Route[] = [
  ...healthRoutes,
  ...accountRoutes,
  ...boothRoutes,
  ...consentRoutes,
  ...assessmentRoutes,
  ...followUpRoutes,
  ...progressRoutes,
];
