import type { Route } from "../http/types";
import { healthRoutes } from "./health/routes";

/** Every module route, matched in order before the legacy routes in server/api.ts. */
export const moduleRoutes: readonly Route[] = [...healthRoutes];
