import type { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const BACKUPS_KEPT = 5;
// azm-<ISO timestamp with ':' and '.' replaced by '-'>-<label>.sqlite, e.g.
// azm-2026-09-27T19-40-12-345Z-pre-2.sqlite. The fixed width timestamp makes name order time order.
const BACKUP_FILE = /^azm-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-[a-z0-9-]+\.sqlite$/;
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[:.]/g, "-");

/**
 * Writes a consistent copy of `db` with VACUUM INTO to <dir of dbPath>/backups/, then keeps only
 * the newest BACKUPS_KEPT backups. The directory is 0700 and the file 0600 from the moment it
 * exists. Must be called outside a transaction (SQLite cannot VACUUM inside one). Returns the path.
 */
export function backupDatabase(db: DatabaseSync, dbPath: string, label: string): string {
  if (dbPath === ":memory:") throw new Error("backupDatabase needs a database file");
  if (db.isTransaction) throw new Error("backupDatabase cannot run inside a transaction");
  const safeLabel =
    label
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "backup";
  const dir = join(dirname(dbPath), "backups");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  // One timestamp per backup, strictly after every existing one, so pruning by name never drops
  // the backup just written even when several are made within the same millisecond.
  const newest = readdirSync(dir)
    .map((f) => BACKUP_FILE.exec(f)?.[1])
    .filter((s): s is string => !!s)
    .sort()
    .pop();
  const last = newest ? Date.parse(newest.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, "T$1:$2:$3.$4Z")) : NaN;
  const ms = Number.isNaN(last) ? Date.now() : Math.max(Date.now(), last + 1);
  const file = join(dir, `azm-${stamp(ms)}-${safeLabel}.sqlite`);
  // VACUUM INTO accepts an existing empty file, so create it 0600 first (no readable window).
  writeFileSync(file, "", { mode: 0o600, flag: "wx" });
  try {
    db.prepare("VACUUM INTO ?").run(file); // bound parameter: no quoting of the path needed
    chmodSync(file, 0o600);
  } catch (error) {
    rmSync(file, { force: true });
    throw error;
  }
  const backups = readdirSync(dir)
    .filter((f) => BACKUP_FILE.test(f))
    .sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - BACKUPS_KEPT))) unlinkSync(join(dir, old));
  return file;
}
