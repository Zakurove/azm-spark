import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";

/** A row of the users table as the session lookup returns it. Never send it to a client as is. */
export interface UserRow {
  id: string;
  email: string;
  name: string;
  password: string;
  created: number;
}

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  db: DatabaseSync;
  user: UserRow | null;
  body: any;
  params: Record<string, string>;
  json(status: number, v: unknown): void;
  limited(key: string, max?: number): boolean;
}

/**
 * A module route. `path` is matched against the URL pathname, so anchor it (^...$); named groups
 * become `params`. Module routes run after the origin check and body parsing and before the legacy
 * AUTH_REQUIRED gate; a user route is only called with a session (otherwise 401 AUTH_REQUIRED).
 */
export interface Route {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: RegExp;
  auth: "public" | "user";
  handle(ctx: RouteContext): Promise<void> | void;
}
