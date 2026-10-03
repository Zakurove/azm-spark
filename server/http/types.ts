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
  /**
   * The client address the rate limits key on: the X-Forwarded-For entry the trusted proxy appended
   * (AZM_TRUSTED_PROXIES hops from the right, default 1), else the socket (server/api.ts clientAddress).
   */
  ip: string;
  json(status: number, v: unknown): void;
  /** Counts one call under `key`; true once more than `max` calls fall in the window (default 15 minutes). */
  limited(key: string, max?: number, windowMs?: number): boolean;
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
  /**
   * A route that takes a body larger than the 64 KB default (booth v2: the report photo). Called from
   * the headers alone, BEFORE any body is buffered: the larger cap in bytes, or a refusal that ends
   * the request at once. A route without it keeps the default cap.
   */
  bodyLimit?(ctx: BodyGate): number | { status: number; error: string };
}

/** What a route's bodyLimit may read: the headers, the database and the rate limits, never the body. */
export interface BodyGate {
  req: IncomingMessage;
  db: DatabaseSync;
  ip: string;
  limited: RouteContext["limited"];
}
