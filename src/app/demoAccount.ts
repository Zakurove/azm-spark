/**
 * The booth demo's accounts (/demo; server/modules/demo): each visitor is a fresh account on this
 * reserved domain (RFC 2606 .invalid, never a real mailbox), which tags it as a demo. Shared by the
 * server and the client, which reuses a demo session it already holds.
 */
export const DEMO_DOMAIN = "demo.azm-spark.invalid";

/** True for a demo account's address. */
export function isDemoEmail(email: unknown): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${DEMO_DOMAIN}`);
}
