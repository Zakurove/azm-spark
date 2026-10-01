/**
 * Booth staff sessions (O17): the device session of the booth day that a staff phone holds after the
 * code. A session is random (32 bytes); only its SHA-256 is stored, with its end. No user id, device
 * or IP, so nothing links a session to a person. The booth runs on staff phones only (C34).
 */
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const hash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

const PASS = /^[0-9a-f]{64}$/;

function prune(db: DatabaseSync, now: number) {
  db.prepare("DELETE FROM booth_passes WHERE expires<=?").run(now);
}

export function createPass(db: DatabaseSync, expires: number, now: number): string {
  prune(db, now);
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO booth_passes(token_hash,kind,expires,used) VALUES(?,'staff',?,0)").run(
    hash(token),
    expires,
  );
  return token;
}

/** A staff session that has not ended: its end, or null. */
export function validPass(db: DatabaseSync, token: unknown, now: number): number | null {
  if (typeof token !== "string" || !PASS.test(token)) return null;
  prune(db, now);
  const r = db
    .prepare("SELECT expires FROM booth_passes WHERE token_hash=? AND kind='staff' AND expires>?")
    .get(hash(token), now) as { expires: number } | undefined;
  return r ? Number(r.expires) : null;
}
