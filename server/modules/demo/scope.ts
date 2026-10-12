/**
 * Whether the request being handled is a demo person's (the booth demo at /demo): server/api.ts runs
 * every request in a scope and marks it once the session is read. The anonymous daily counts
 * (countProduct, countSafetyEvent) skip a demo request, so a booth demo never reaches the product or
 * safety numbers. Outside a request (a test calling a store directly) nothing is skipped.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const scope = new AsyncLocalStorage<{ demo: boolean }>();

/** Runs one request in its own scope, not a demo until marked. */
export function inRequestScope<T>(run: () => T): T {
  return scope.run({ demo: false }, run);
}

/** Marks the request in hand as a demo person's (or not). */
export function markDemoRequest(demo: boolean): void {
  const s = scope.getStore();
  if (s) s.demo = demo;
}

/** True while handling a demo person's request. */
export function isDemoRequest(): boolean {
  return scope.getStore()?.demo === true;
}
