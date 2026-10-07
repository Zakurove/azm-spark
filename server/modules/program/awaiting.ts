/**
 * The tests come before the program (D-032 item 3): a person whose first profile was saved with
 * AZM_V7=1 has no program until the movement check. Stored in check_first (migration 006):
 *
 *   markAwaiting     the first profile of a person, saved with AZM_V7=1
 *   isAwaiting       waiting now: a row not cleared, and no completed focus check (a check that
 *                    completed always ends the wait, also before its week is built)
 *   clearAwaiting    the program is built: from the check's findings (POST /api/program/targets), or
 *                    from the history (POST /api/program/history: nothing can be measured, or no camera)
 *   programFrom      how the wait ended, or null (never waited, or still waiting)
 *
 * People who had a program before this change have no row: they keep their program. Nothing here
 * logs, and nothing here reads or writes the profile itself.
 */
import type { DatabaseSync } from "node:sqlite";

export type ProgramFrom = "check" | "history";

interface Row {
  since: number;
  cleared: number | null;
  cleared_by: ProgramFrom | null;
}

function rowOf(db: DatabaseSync, userId: string): Row | null {
  return (
    (db.prepare("SELECT since, cleared, cleared_by FROM check_first WHERE user_id=?").get(userId) as
      Row | undefined) ?? null
  );
}

/** A first profile saved with AZM_V7=1: the program waits for the check (once per person). */
export function markAwaiting(db: DatabaseSync, userId: string, now: number): void {
  db.prepare("INSERT INTO check_first(user_id, since) VALUES(?, ?) ON CONFLICT(user_id) DO NOTHING").run(
    userId,
    now,
  );
}

/** The program waits for the check: a row not cleared and no completed focus check. */
export function isAwaiting(db: DatabaseSync, userId: string): boolean {
  const r = rowOf(db, userId);
  if (!r || r.cleared !== null) return false;
  const done = db
    .prepare("SELECT 1 FROM focus_checks WHERE user_id=? AND status='completed' LIMIT 1")
    .get(userId);
  return !done;
}

/** The program is built, from the check or from the history: the wait ends (a row only, once). */
export function clearAwaiting(db: DatabaseSync, userId: string, from: ProgramFrom, now: number): boolean {
  const r = db
    .prepare("UPDATE check_first SET cleared=?, cleared_by=? WHERE user_id=? AND cleared IS NULL")
    .run(now, from, userId);
  return Number(r.changes) > 0;
}

/** How the wait ended (the check's findings or the history), or null. */
export function programFrom(db: DatabaseSync, userId: string): ProgramFrom | null {
  return rowOf(db, userId)?.cleared_by ?? null;
}
