import type { DatabaseSync } from "node:sqlite";

/**
 * The adult confirmation (Q2 (5), Q32 (6)): only adults 18 or older create accounts or do the
 * movement check. It is kept once per account, with the time it was given (data map 2.1, profile:
 * "adult confirmation (18 or older) at account creation"), so a signed in person is asked once.
 */
export function adultConfirmedAt(db: DatabaseSync, userId: string): number | null {
  const r = db.prepare("SELECT confirmed_at FROM adult_confirmations WHERE user_id=?").get(userId) as
    { confirmed_at: number } | undefined;
  return r ? Number(r.confirmed_at) : null;
}

/** Stores the confirmation; the first time is kept. Returns the stored time. */
export function confirmAdult(db: DatabaseSync, userId: string, now: number): number {
  db.prepare(
    "INSERT INTO adult_confirmations(user_id,confirmed_at) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING",
  ).run(userId, now);
  return adultConfirmedAt(db, userId) ?? now;
}
