import * as registry from "./registry";

/**
 * A schema migration: a TS module (so esbuild bundles it) exporting { version, name, sql }.
 * `sql` runs inside the shared migration transaction, so it must not contain BEGIN/COMMIT
 * (trigger bodies are fine) or PRAGMA foreign_keys, which SQLite ignores inside a transaction.
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/** All migrations in ascending version order. */
export const migrations: readonly Migration[] = Object.values(registry).sort((a, b) => a.version - b.version);
