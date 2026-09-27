import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const BACKUPS_KEPT = 5;
// azm-<ISO timestamp with ':' and '.' replaced by '-'>-<label>.sqlite, e.g.
// azm-2026-09-27T19-40-12-345Z-pre-2.sqlite. The fixed width timestamp makes name order time order.
const BACKUP_FILE = /^azm-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-([a-z0-9-]+)\.sqlite$/;
// A copy still being written: .azm-<uuid>.part. Neither pruning nor the choice of a backup name sees it.
const PART_FILE = /^\.azm-[0-9a-f-]{36}\.part$/;
/** A part file untouched for this long was left by a process that died while writing it. */
export const STALE_PART_MS = 60 * 60 * 1000;
// Label of the backup runMigrations writes before applying migration N.
const MIGRATION_LABEL = /^pre-\d+$/;
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[:.]/g, "-");

/**
 * Writes a consistent copy of `db` with VACUUM INTO to <dir of dbPath>/backups/, then prunes: the
 * newest BACKUPS_KEPT backups stay, and so does the newest pre-N backup for every migration N. A
 * migration that fails at every start (a crash loop under a restart policy) writes a new pre-N on
 * each start; without the second rule those copies would push out the only good copy from before
 * an earlier migration. The directory is 0700 and the file 0600 from the moment it exists. Must be
 * called outside a transaction (SQLite cannot VACUUM inside one). Returns the path.
 *
 * The copy is written under a temporary part name and gets its backup name only once complete, so a
 * second starter pruning the same folder can never remove a copy while it is being written, and a
 * copy cut short by a crash is never counted as a backup.
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
  // VACUUM INTO accepts an existing empty file, so create it 0600 first (no readable window).
  const part = join(dir, `.azm-${randomUUID()}.part`);
  writeFileSync(part, "", { mode: 0o600, flag: "wx" });
  let file: string;
  try {
    db.prepare("VACUUM INTO ?").run(part); // bound parameter: no quoting of the path needed
    chmodSync(part, 0o600);
    file = publish(dir, part, safeLabel);
  } finally {
    rmSync(part, { force: true });
  }
  prune(dir);
  return file;
}

/**
 * Gives a complete copy its backup name: one timestamp strictly after every existing backup, so
 * name order is time order and pruning by name keeps the newest copies. A hard link never replaces
 * an existing file: when another process took the same millisecond, EEXIST moves on to the next one.
 */
function publish(dir: string, part: string, label: string): string {
  const newest = readdirSync(dir)
    .map((f) => BACKUP_FILE.exec(f)?.[1])
    .filter((s): s is string => !!s)
    .sort()
    .pop();
  const last = newest ? Date.parse(newest.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, "T$1:$2:$3.$4Z")) : NaN;
  const ms = Number.isNaN(last) ? Date.now() : Math.max(Date.now(), last + 1);
  for (let attempt = 0; ; attempt++) {
    const file = join(dir, `azm-${stamp(ms + attempt)}-${label}.sqlite`);
    try {
      linkSync(part, file);
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 1000) throw error;
    }
  }
}

/** Keeps the newest BACKUPS_KEPT backups and the newest pre-N per migration; removes stale part files. */
function prune(dir: string): void {
  const names = readdirSync(dir);
  const backups = names.filter((f) => BACKUP_FILE.test(f)).sort();
  const keep = new Set(backups.slice(-BACKUPS_KEPT));
  const newestPerMigration = new Map<string, string>(); // names are in time order: the last wins
  for (const f of backups) {
    const label = BACKUP_FILE.exec(f)![2];
    if (MIGRATION_LABEL.test(label)) newestPerMigration.set(label, f);
  }
  for (const f of newestPerMigration.values()) keep.add(f);
  // force: a second process pruning the same folder may have removed it already.
  for (const old of backups) if (!keep.has(old)) rmSync(join(dir, old), { force: true });
  // A part file that is no longer written to belongs to a process that died mid copy.
  const now = Date.now();
  for (const f of names.filter((n) => PART_FILE.test(n))) {
    try {
      if (now - statSync(join(dir, f)).mtimeMs > STALE_PART_MS) rmSync(join(dir, f), { force: true });
    } catch {
      // Finished and removed by its own process in the meantime.
    }
  }
}
