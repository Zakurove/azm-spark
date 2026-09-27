import type { DatabaseSync } from "node:sqlite";
import { backupDatabase } from "./backup";
import { migrations as allMigrations, type Migration } from "./migrations";

export interface MigrationOutcome {
  /** Versions applied by this call, in order. Empty when the schema was already current. */
  applied: number[];
  /** Path of the pre-migration backup, or null when none was needed. */
  backup: string | null;
  /** Highest applied version after this call (0 for an empty database). */
  schema: number;
}

const LOG_DDL =
  "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at INTEGER NOT NULL)";

/**
 * Throws when the database recorded a migration this build does not have: a schema newer than the
 * code (for example after rolling back to an older build) or a version missing from the list.
 * Running on such a schema could silently break constraints the newer code relies on.
 */
function assertKnownSchema(logged: ReadonlySet<number>, migrations: readonly Migration[]) {
  const latest = migrations.length ? migrations[migrations.length - 1].version : 0;
  const newest = Math.max(0, ...logged);
  if (newest > latest)
    throw new Error(`Database schema ${newest} is newer than this build (${latest}); refusing to start`);
  const known = new Set(migrations.map((m) => m.version));
  const unknown = [...logged].filter((v) => !known.has(v)).sort((a, b) => a - b);
  if (unknown.length)
    throw new Error(`Database has unknown migration ${unknown.join(", ")} for this build; refusing to start`);
}

/**
 * Brings `db` up to the latest schema. When migrations are pending and the database already holds
 * user tables, a backup of the untouched database is written first (never for ':memory:'). Then the
 * schema_migrations table and ALL pending migrations are applied in ONE transaction: on any error
 * everything rolls back, no version is recorded, and the error is rethrown so the server does not
 * start on a half migrated schema. A database that recorded a migration this build does not know
 * (a newer schema) is refused before anything is written.
 */
export function runMigrations(
  db: DatabaseSync,
  { dbPath, migrations = allMigrations }: { dbPath: string; migrations?: readonly Migration[] },
): MigrationOutcome {
  migrations.forEach((m, i) => {
    if (!Number.isInteger(m.version) || m.version < 1 || (i > 0 && m.version <= migrations[i - 1].version))
      throw new Error(`Migration versions must be positive and strictly ascending (at ${m.name})`);
  });
  db.exec("PRAGMA foreign_keys=ON");
  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'")
      .all() as { name: string }[]
  ).map((t) => t.name);
  const done = () =>
    new Set(
      (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) =>
        Number(r.version),
      ),
    );
  const schema = () => Math.max(0, ...done());
  const logged = tables.includes("schema_migrations") ? done() : new Set<number>();
  assertKnownSchema(logged, migrations);
  const pending = migrations.filter((m) => !logged.has(m.version));
  if (!pending.length) {
    db.exec(LOG_DDL); // a no-op unless an empty migration list meets a brand new database
    return { applied: [], backup: null, schema: schema() };
  }

  const hasUserTables = tables.some((t) => t !== "schema_migrations");
  const backup =
    hasUserTables && dbPath !== ":memory:" ? backupDatabase(db, dbPath, `pre-${pending[0].version}`) : null;

  const applied: number[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(LOG_DDL);
    const already = done(); // re-read under the write lock
    assertKnownSchema(already, migrations);
    const record = db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)");
    for (const m of migrations) {
      if (already.has(m.version)) continue;
      db.exec(m.sql);
      if (!db.isTransaction) throw new Error(`Migration ${m.version} ended the migration transaction`);
      record.run(m.version, m.name, Date.now());
      applied.push(m.version);
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
  return { applied, backup, schema: schema() };
}
