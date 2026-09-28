/**
 * Booth passes (O17): the staff device session of the booth day and the one check visitor tokens.
 * A pass is random (32 bytes); only its SHA-256 is stored, with its kind, end and whether a check
 * has used it. No user id, device or IP, so nothing links a pass to a person.
 */
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type PassKind = "staff" | "visitor";

const hash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export const PASS = /^[0-9a-f]{64}$/;

function prune(db: DatabaseSync, now: number) {
  db.prepare("DELETE FROM booth_passes WHERE expires<=?").run(now);
}

export function createPass(db: DatabaseSync, kind: PassKind, expires: number, now: number): string {
  prune(db, now);
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO booth_passes(token_hash,kind,expires,used) VALUES(?,?,?,0)").run(
    hash(token),
    kind,
    expires,
  );
  return token;
}

/** A pass of this kind that has not ended or been used: its end, or null. */
export function validPass(db: DatabaseSync, token: unknown, kind: PassKind, now: number): number | null {
  if (typeof token !== "string" || !PASS.test(token)) return null;
  prune(db, now);
  const r = db
    .prepare("SELECT expires FROM booth_passes WHERE token_hash=? AND kind=? AND used=0 AND expires>?")
    .get(hash(token), kind, now) as { expires: number } | undefined;
  return r ? Number(r.expires) : null;
}

/**
 * Redeems a visitor token on one phone (O17, S55b): the token is spent at once and swapped for a new
 * visitor pass with the same end, which only that phone holds. A second redeem of the same token (a
 * QR link sent on to other phones) finds nothing. Returns the phone's pass and its end, or null.
 */
export function swapPass(
  db: DatabaseSync,
  token: unknown,
  now: number,
): { token: string; expires: number } | null {
  const expires = validPass(db, token, "visitor", now);
  if (expires === null) return null;
  const spent = db
    .prepare("DELETE FROM booth_passes WHERE token_hash=? AND kind='visitor' AND used=0 AND expires>?")
    .run(hash(token as string), now);
  if (Number(spent.changes) !== 1) return null;
  return { token: createPass(db, "visitor", expires, now), expires };
}

/** Uses a visitor token for one check; false when it was used, has ended or never existed. */
export function usePass(db: DatabaseSync, token: string, now: number): boolean {
  const out = db
    .prepare("UPDATE booth_passes SET used=1 WHERE token_hash=? AND kind='visitor' AND used=0 AND expires>?")
    .run(hash(token), now);
  return Number(out.changes) === 1;
}
