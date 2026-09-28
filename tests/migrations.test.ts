import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createServer } from "node:http";
import { Worker } from "node:worker_threads";
import { scryptSync } from "node:crypto";
import { runMigrations } from "../server/db/migrate";
import { backupDatabase, BACKUPS_KEPT, STALE_PART_MS } from "../server/db/backup";
import { migrations, type Migration } from "../server/db/migrations";
import { createApi } from "../server/api";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type Db = InstanceType<typeof DatabaseSync>;

// The startup DDL of Azm 5.0 (server/api.ts before migrations), verbatim, to build a legacy file.
const LEGACY_DDL = `PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),intake TEXT NOT NULL,plan TEXT NOT NULL,version INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS workouts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),plan TEXT NOT NULL,version INTEGER NOT NULL,demo INTEGER NOT NULL,position INTEGER DEFAULT 0,ended INTEGER DEFAULT 0,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS results(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),workout_id TEXT NOT NULL,position INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(workout_id,position));`;
const TABLES = ["users", "sessions", "profiles", "workouts", "results"];
/** Tables of 002_movement_check and 003_council. */
const CHECK_TABLES = [
  "adult_confirmations",
  "assessment_results",
  "assessments",
  "booth_passes",
  "check_locks",
  "check_state",
  "consents",
  "product_counts",
  "safety_events",
];
const VERSIONS = migrations.map((m) => m.version);
const LATEST = VERSIONS[VERSIONS.length - 1];
/** A migration after every real one, for the tests that add their own. */
const extra = (offset: number, name: string, sql = `CREATE TABLE ${name}(x INTEGER);`): Migration => ({
  version: LATEST + offset,
  name,
  sql,
});
const PASSWORD = "legacy-password-4417";
const BAD: Migration = {
  version: 99,
  name: "broken",
  sql: "CREATE TABLE partial_table(x INTEGER); INSERT INTO missing_table VALUES(1);",
};

let dir: string;
const opened: Db[] = [];
const openDb = (file: string) => {
  const db = new DatabaseSync(file);
  opened.push(db);
  return db;
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "azm-migrations-"));
});
afterEach(() => {
  for (const db of opened.splice(0)) if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function legacyFile(name = "azm.sqlite") {
  const file = join(dir, name);
  const db = new DatabaseSync(file);
  db.exec(LEGACY_DDL);
  const salt = "a1".repeat(16);
  const hash = scryptSync(PASSWORD, salt, 64).toString("hex");
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    "u1",
    "legacy@example.test",
    "Legacy Member",
    `${salt}:${hash}`,
    1,
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("f".repeat(64), "u1", Date.now() + 86400000);
  db.prepare("INSERT INTO profiles VALUES(?,?,?,?)").run(
    "u1",
    '{"mobility":"seated"}',
    '{"status":"ready"}',
    3,
  );
  db.prepare("INSERT INTO workouts VALUES(?,?,?,?,?,?,?,?)").run(
    "w1",
    "u1",
    '{"exercises":[]}',
    3,
    0,
    2,
    1,
    5,
  );
  db.prepare("INSERT INTO results VALUES(?,?,?,?,?)").run("r1", "u1", "w1", 0, '{"reps":{"valid":4}}');
  db.close();
  return file;
}
const dump = (db: Db) =>
  Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const tableSql = (db: Db) =>
  db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
    )
    .all();
const tableNames = (db: Db) => (tableSql(db) as { name: string }[]).map((t) => t.name);
const logged = (db: Db) =>
  tableNames(db).includes("schema_migrations")
    ? (
        db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[]
      ).map((r) => r.version)
    : [];
const backupsIn = (d: string) => (existsSync(d) ? readdirSync(d).sort() : []);
const mode = (p: string) => statSync(p).mode & 0o777;

describe("runMigrations", () => {
  it("gives a fresh file database the latest schema without a backup", () => {
    const file = join(dir, "fresh.sqlite");
    const out = runMigrations(openDb(file), { dbPath: file });
    expect(out).toEqual({ applied: VERSIONS, backup: null, schema: LATEST });
    expect(VERSIONS).toEqual([1, 2, 3]);
    expect(tableNames(openDb(file))).toEqual([...TABLES, ...CHECK_TABLES, "schema_migrations"].sort());
    expect(existsSync(join(dir, "backups"))).toBe(false);
  });

  it("migrates a legacy database with every row intact after a private backup", () => {
    const file = legacyFile();
    const before = dump(openDb(file));
    const legacySchema = tableSql(openDb(file));
    const db = openDb(file);
    const out = runMigrations(db, { dbPath: file });
    expect(out.applied).toEqual(VERSIONS);
    expect(out.schema).toBe(LATEST);
    expect(dump(db)).toEqual(before);
    for (const t of TABLES) expect(dump(db)[t]).toHaveLength(1);
    // IF NOT EXISTS left the legacy tables alone, and a fresh database gets the very same schema text.
    expect(tableSql(db).filter((t: any) => TABLES.includes(t.name))).toEqual(legacySchema);
    const fresh = join(dir, "fresh.sqlite");
    runMigrations(openDb(fresh), { dbPath: fresh });
    expect(tableSql(openDb(fresh))).toEqual(tableSql(db));

    const backup = out.backup!;
    expect(backup).toBe(join(dir, "backups", basename(backup)));
    expect(basename(backup)).toMatch(/^azm-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-pre-1\.sqlite$/);
    expect(mode(backup)).toBe(0o600);
    expect(mode(join(dir, "backups"))).toBe(0o700);
    const copy = openDb(backup);
    expect(dump(copy)).toEqual(before);
    expect(tableNames(copy)).not.toContain("schema_migrations"); // taken before any write
  });

  it("brings a legacy database and a schema 1 database to the latest schema with every old row intact", () => {
    // Straight from the Azm 5.0 file: 001 to 003 in one transaction, after one backup.
    const legacy = legacyFile();
    const before = dump(openDb(legacy));
    const db = openDb(legacy);
    const out = runMigrations(db, { dbPath: legacy });
    expect(out.applied).toEqual([1, 2, 3]);
    expect(out.schema).toBe(3);
    expect(dump(db)).toEqual(before);
    for (const t of CHECK_TABLES)
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n).toBe(0);

    // A database at schema 1 gets 002 and 003, after a pre-2 backup.
    const one = legacyFile("one.sqlite");
    const oneDb = openDb(one);
    runMigrations(oneDb, { dbPath: one, migrations: migrations.filter((m) => m.version === 1) });
    oneDb.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run("u2", "second@example.test", "Second", "x:y", 2);
    const atOne = dump(oneDb);
    const up = runMigrations(oneDb, { dbPath: one });
    expect(up.applied).toEqual([2, 3]);
    expect(up.schema).toBe(3);
    expect(logged(oneDb)).toEqual([1, 2, 3]);
    expect(dump(oneDb)).toEqual(atOne);
    expect(basename(up.backup!)).toMatch(/-pre-2\.sqlite$/);
    expect(dump(openDb(up.backup!))).toEqual(atOne);
    expect(tableNames(openDb(up.backup!))).not.toContain("assessments");
    // Both roads give the same schema text as a fresh database.
    const fresh = join(dir, "fresh.sqlite");
    runMigrations(openDb(fresh), { dbPath: fresh });
    expect(tableSql(oneDb)).toEqual(tableSql(openDb(fresh)));
    expect(tableSql(db)).toEqual(tableSql(openDb(fresh)));
  });

  it("keeps the safety log free of any user id and cascades results with their check", () => {
    const db = openDb(":memory:");
    runMigrations(db, { dbPath: ":memory:" });
    const columns = (t: string) =>
      (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    // Q25 (a): the safety log and the product counts hold a day, ids and counts, never a user id.
    expect(columns("safety_events")).toEqual(["day", "reason", "test_id", "setting", "count"]);
    expect(columns("product_counts")).toEqual(["day", "metric", "key", "setting", "count"]);
    expect(columns("booth_passes")).toEqual(["token_hash", "kind", "expires", "used"]);
    // Q25 (c): the lock record keeps no reason id.
    expect(columns("check_locks")).toEqual(["user_id", "until", "releasable_by_clearance"]);
    db.prepare("INSERT INTO users VALUES('u1','a@example.test','A','x:y',1)").run();
    db.prepare(
      "INSERT INTO assessments(id,user_id,kind,setting,series_meta,setup,protocol,precheck,device,started) VALUES('a1','u1','baseline','home','{}','{}','[]','{}','{}',1)",
    ).run();
    db.prepare(
      "INSERT INTO assessment_results(id,assessment_id,user_id,test_id,side,value,unit,band,attempts,quality,detail,flags,n_valid,series_key,pose_model,movement_version,engine_version,created) VALUES('r1','a1','u1','shoulder_abduction','left',90,'deg','default','[]','{}','{}','[]',1,'k','full',1,'e1',1)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO assessment_results(id,assessment_id,user_id,test_id,side,value,unit,band,attempts,quality,detail,flags,n_valid,series_key,pose_model,movement_version,engine_version,created) VALUES('r2','a1','u1','shoulder_abduction','left',95,'deg','default','[]','{}','{}','[]',1,'k','full',1,'e1',1)",
        )
        .run(),
    ).toThrow(/UNIQUE/);
    expect(() =>
      db
        .prepare(
          "INSERT INTO assessments(id,user_id,kind,setting,series_meta,setup,protocol,precheck,device,started) VALUES('a2','u1','baseline','home','{}','{}','[]','{}','{}',1)",
        )
        .run(),
    ).not.toThrow();
    expect(() => db.prepare("UPDATE assessments SET status='done' WHERE id='a2'").run()).toThrow(/CHECK/);
    db.prepare("DELETE FROM assessments WHERE id='a1'").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM assessment_results").get()).toEqual({ n: 0 });
  });

  it("brings a schema 2 database to schema 3 minimised: locks and ended reasons lose the reason", () => {
    const file = join(dir, "two.sqlite");
    const db = openDb(file);
    runMigrations(db, { dbPath: file, migrations: migrations.filter((m) => m.version <= 2) });
    db.exec(`INSERT INTO users VALUES('u1','a@example.test','A','x:y',1);
      INSERT INTO users VALUES('u2','b@example.test','B','x:y',1);
      INSERT INTO check_locks(user_id,reason,until) VALUES('u1','recent_change',100),('u2','pain',200);
      INSERT INTO safety_events(day,reason,setting,count) VALUES('2026-09-30','precheck:unwell','home',3),
        ('2026-09-30','stop:fall','booth',1);
      INSERT INTO check_state(user_id,change_reported) VALUES('u1','2026-09-30');
      INSERT INTO assessments(id,user_id,kind,setting,status,series_meta,setup,protocol,precheck,device,started,ended_reason)
        VALUES('a1','u1','baseline','home','ended_early','{}','{}','[]','{}','{}',1,'stop:chest'),
        ('a2','u1','baseline','home','ended_early','{}','{}','[]','{}','{}',2,'between:much'),
        ('a3','u2','baseline','home','abandoned','{}','{}','[]','{}','{}',3,'postponed'),
        ('a4','u2','baseline','home','abandoned','{}','{}','[]','{}','{}',4,'stale');`);
    const out = runMigrations(db, { dbPath: file });
    expect(out.applied).toEqual([3]);
    expect(basename(out.backup!)).toMatch(/-pre-3\.sqlite$/);
    expect(db.prepare("SELECT * FROM check_locks ORDER BY user_id").all()).toEqual([
      { user_id: "u1", until: 100, releasable_by_clearance: 1 },
      { user_id: "u2", until: 200, releasable_by_clearance: 0 },
    ]);
    expect(db.prepare("SELECT * FROM safety_events ORDER BY reason").all()).toEqual([
      { day: "2026-09-30", reason: "precheck:unwell", test_id: "precheck", setting: "home", count: 3 },
      { day: "2026-09-30", reason: "stop:fall", test_id: "none", setting: "booth", count: 1 },
    ]);
    expect(db.prepare("SELECT id, ended_reason, active FROM assessments ORDER BY id").all()).toEqual([
      { id: "a1", ended_reason: "stop", active: null },
      { id: "a2", ended_reason: "stop", active: null },
      { id: "a3", ended_reason: "replaced", active: null },
      { id: "a4", ended_reason: "stale", active: null },
    ]);
    expect(db.prepare("SELECT change_reported, faint_reported FROM check_state").get()).toEqual({
      change_reported: "2026-09-30",
      faint_reported: null,
    });
    // Same schema text as a fresh database.
    const fresh = join(dir, "fresh.sqlite");
    runMigrations(openDb(fresh), { dbPath: fresh });
    expect(tableSql(db)).toEqual(tableSql(openDb(fresh)));
  });

  it("is a no op when re-run and writes no new backup", () => {
    const file = legacyFile();
    expect(runMigrations(openDb(file), { dbPath: file }).backup).not.toBeNull();
    const backups = backupsIn(join(dir, "backups"));
    expect(backups).toHaveLength(1);
    const db = openDb(file);
    const before = dump(db);
    expect(runMigrations(db, { dbPath: file })).toEqual({ applied: [], backup: null, schema: LATEST });
    expect(runMigrations(db, { dbPath: file })).toEqual({ applied: [], backup: null, schema: LATEST });
    expect(backupsIn(join(dir, "backups"))).toEqual(backups);
    expect(dump(db)).toEqual(before);
    expect(logged(db)).toEqual(VERSIONS);
  });

  it("rolls a failing batch back completely on a fresh database", () => {
    const file = join(dir, "fresh.sqlite");
    const db = openDb(file);
    const good = extra(1, "extra");
    expect(() => runMigrations(db, { dbPath: file, migrations: [...migrations, good, BAD] })).toThrow(
      /missing_table/,
    );
    expect(db.isTransaction).toBe(false);
    expect(tableNames(db)).toEqual([]); // not even the baseline or schema_migrations survived
    expect(logged(db)).toEqual([]);
  });

  it("rolls a failing migration back on a migrated legacy database and keeps its data", () => {
    const file = legacyFile();
    const db = openDb(file);
    runMigrations(db, { dbPath: file });
    const before = dump(db);
    expect(() => runMigrations(db, { dbPath: file, migrations: [...migrations, BAD] })).toThrow();
    expect(tableNames(db)).not.toContain("partial_table");
    expect(logged(db)).toEqual(VERSIONS);
    expect(dump(db)).toEqual(before);
    expect(backupsIn(join(dir, "backups")).some((f) => f.endsWith("-pre-99.sqlite"))).toBe(true);
  });

  it("rejects an unordered migration list before touching the database", () => {
    const file = join(dir, "fresh.sqlite");
    const db = openDb(file);
    expect(() => runMigrations(db, { dbPath: file, migrations: [BAD, ...migrations] })).toThrow(/ascending/);
    expect(tableNames(db)).toEqual([]);
  });

  it("refuses a database whose schema is newer than this build, without a backup", () => {
    const file = legacyFile();
    const db = openDb(file);
    runMigrations(db, { dbPath: file });
    // A later build applied the next migration; this build does not know it (a rollback).
    db.exec("CREATE TABLE future_table(x INTEGER)");
    db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,'future',1)").run(LATEST + 1);
    const backups = backupsIn(join(dir, "backups"));
    const before = dump(db);
    expect(() => runMigrations(db, { dbPath: file })).toThrow(
      new RegExp(`schema ${LATEST + 1} is newer than this build \\(${LATEST}\\)`),
    );
    expect(dump(db)).toEqual(before);
    expect(logged(db)).toEqual([...VERSIONS, LATEST + 1]);
    expect(backupsIn(join(dir, "backups"))).toEqual(backups);
    db.close();
    expect(() => createApi(file)).toThrow(/newer than this build/);
  });

  it("refuses a database that recorded a migration this build does not have", () => {
    const file = join(dir, "fresh.sqlite");
    const db = openDb(file);
    const second = extra(1, "second");
    const third = extra(2, "third");
    runMigrations(db, { dbPath: file, migrations: [...migrations, second] });
    // A build whose list skips a recorded migration must not treat the database as current and
    // apply the next one on top.
    expect(() => runMigrations(db, { dbPath: file, migrations: [...migrations, third] })).toThrow(
      new RegExp(`unknown migration ${LATEST + 1}`),
    );
    expect(tableNames(db)).not.toContain("third");
    expect(logged(db)).toEqual([...VERSIONS, LATEST + 1]);
  });

  it("never backs up an in memory database", () => {
    const db = openDb(":memory:");
    db.exec(LEGACY_DDL);
    expect(runMigrations(db, { dbPath: ":memory:" })).toEqual({
      applied: VERSIONS,
      backup: null,
      schema: LATEST,
    });
  });
});

/**
 * Opens `file` in a worker thread (a second connection, like a second process starting on the same
 * database), takes the write lock, runs `sql` inside it, holds the lock for `holdMs` and commits.
 * Resolves once the worker holds the lock; `done` settles when it has committed.
 */
async function holdWriteLock(file: string, sql: string, holdMs: number) {
  const flag = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(
    `const { workerData: w } = require("node:worker_threads");
     const { DatabaseSync } = require("node:sqlite");
     const db = new DatabaseSync(w.file);
     db.exec("BEGIN IMMEDIATE");
     db.exec(w.sql);
     Atomics.store(w.flag, 0, 1);
     Atomics.notify(w.flag, 0);
     Atomics.wait(w.flag, 0, 1, w.holdMs);
     db.exec("COMMIT");
     db.close();`,
    { eval: true, workerData: { file, sql, flag, holdMs } },
  );
  const done = new Promise<void>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker exit ${code}`))));
  });
  while (Atomics.load(flag, 0) === 0) await new Promise((r) => setTimeout(r, 5));
  return { done };
}

describe("runMigrations with a second connection", () => {
  it("waits for another starter's migration and then finds nothing to apply", async () => {
    const file = legacyFile();
    // The other starter applies every migration under its write lock and commits 300 ms later.
    const other = await holdWriteLock(
      file,
      `${migrations.map((m) => m.sql).join("\n")}
       CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at INTEGER NOT NULL);
       ${migrations.map((m) => `INSERT INTO schema_migrations(version,name,applied_at) VALUES(${m.version},'${m.name}',1);`).join("\n")}`,
      300,
    );
    const db = openDb(file);
    const before = dump(db);
    const out = runMigrations(db, { dbPath: file });
    await other.done;
    expect(out.applied).toEqual([]);
    expect(out.schema).toBe(LATEST);
    expect(logged(db)).toEqual(VERSIONS);
    expect(dump(db)).toEqual(before);
  });

  it("waits for a plain write lock and then migrates", async () => {
    const file = legacyFile();
    const other = await holdWriteLock(file, "UPDATE users SET name='Held' WHERE id='u1';", 300);
    const db = openDb(file);
    const out = runMigrations(db, { dbPath: file });
    await other.done;
    expect(out.applied).toEqual(VERSIONS);
    expect(logged(db)).toEqual(VERSIONS);
    expect((db.prepare("SELECT name FROM users").get() as { name: string }).name).toBe("Held");
  });
});

describe("backupDatabase", () => {
  it("keeps only the newest five backups and leaves other files alone", () => {
    const file = legacyFile();
    const db = openDb(file);
    const made = Array.from({ length: BACKUPS_KEPT + 2 }, (_, i) => backupDatabase(db, file, `run-${i}`));
    writeFileSync(join(dir, "backups", "notes.txt"), "keep me");
    backupDatabase(db, file, "last");
    const kept = backupsIn(join(dir, "backups")).filter((f) => f.endsWith(".sqlite"));
    expect(BACKUPS_KEPT).toBe(5);
    expect(kept).toHaveLength(5);
    expect(kept.slice(0, 4)).toEqual(made.slice(-4).map((p) => basename(p)));
    expect(kept[4]).toMatch(/-last\.sqlite$/);
    expect(existsSync(join(dir, "backups", "notes.txt"))).toBe(true);
    for (const f of kept) expect(mode(join(dir, "backups", f))).toBe(0o600);
  });

  it("keeps the newest backup before each migration through a crash loop", () => {
    const file = legacyFile();
    const second = extra(1, "second");
    const third = extra(2, "third");
    const failing: Migration = { ...BAD, version: LATEST + 3 };
    const db = openDb(file);
    runMigrations(db, { dbPath: file }); // pre-1: the untouched legacy data
    runMigrations(db, { dbPath: file, migrations: [...migrations, second] }); // pre-(LATEST + 1)
    const pre3 = runMigrations(db, { dbPath: file, migrations: [...migrations, second, third] }).backup!;
    // The last migration fails at every start and the host keeps restarting the server.
    for (let i = 0; i < BACKUPS_KEPT + 2; i++) {
      expect(() =>
        runMigrations(db, { dbPath: file, migrations: [...migrations, second, third, failing] }),
      ).toThrow(/missing_table/);
    }
    const kept = backupsIn(join(dir, "backups"));
    const labels = kept.map((f) => f.replace(/^azm-[^Z]+Z-/, "").replace(/\.sqlite$/, ""));
    expect(labels).toEqual([
      "pre-1",
      `pre-${LATEST + 1}`,
      `pre-${LATEST + 2}`,
      ...Array(BACKUPS_KEPT).fill(`pre-${LATEST + 3}`),
    ]);
    expect(kept).toContain(basename(pre3));
    expect(tableNames(openDb(pre3))).toContain("second");
    expect(tableNames(openDb(pre3))).not.toContain("third");
    expect(dump(openDb(join(dir, "backups", kept[0])))).toEqual(dump(db));
  });

  it("gives concurrent backups of one database distinct names and never fails", async () => {
    const file = legacyFile();
    const go = new Int32Array(new SharedArrayBuffer(4));
    // Three threads back up the same file at the same moment, as parallel starters would. Node
    // strips the types of backup.ts, which imports only node builtins.
    const workers = [0, 1, 2].map(
      () =>
        new Worker(
          `const { workerData: w } = require("node:worker_threads");
           const { DatabaseSync } = require("node:sqlite");
           (async () => {
             const { backupDatabase } = await import(w.backup);
             const db = new DatabaseSync(w.file, { timeout: 10000 });
             Atomics.wait(w.go, 0, 0);
             for (let i = 0; i < 20; i++) backupDatabase(db, w.file, "pre-1");
             db.close();
           })().catch((e) => { console.error(e); process.exit(1); });`,
          { eval: true, workerData: { file, go, backup: join(__dirname, "../server/db/backup.ts") } },
        ),
    );
    const exits = workers.map((w) => new Promise<number>((r) => w.once("exit", r)));
    await new Promise((r) => setTimeout(r, 200));
    Atomics.store(go, 0, 1);
    Atomics.notify(go, 0);
    expect(await Promise.all(exits)).toEqual([0, 0, 0]);
    const kept = backupsIn(join(dir, "backups"));
    expect(kept).toHaveLength(BACKUPS_KEPT);
    for (const f of kept) expect(dump(openDb(join(dir, "backups", f)))).toEqual(dump(openDb(file)));
  });

  it("never prunes a copy another starter is still writing, and removes one a dead process left", () => {
    const file = legacyFile();
    const db = openDb(file);
    backupDatabase(db, file, "first");
    const backups = join(dir, "backups");
    // A copy in progress in another process, and one left by a process that died mid copy.
    const writing = join(backups, `.azm-${"1".repeat(8)}-1111-4111-8111-${"1".repeat(12)}.part`);
    const dead = join(backups, `.azm-${"2".repeat(8)}-2222-4222-8222-${"2".repeat(12)}.part`);
    writeFileSync(writing, "partial copy", { mode: 0o600 });
    writeFileSync(dead, "partial copy", { mode: 0o600 });
    const old = (Date.now() - STALE_PART_MS - 60_000) / 1000;
    utimesSync(dead, old, old);
    for (let i = 0; i < BACKUPS_KEPT + 2; i++) backupDatabase(db, file, `run-${i}`);
    expect(existsSync(writing)).toBe(true);
    expect(existsSync(dead)).toBe(false);
    const kept = backupsIn(backups).filter((f) => f.endsWith(".sqlite"));
    expect(kept).toHaveLength(BACKUPS_KEPT);
    // No part file of this process is left behind, and part files never count as backups.
    expect(backupsIn(backups).filter((f) => f.endsWith(".part"))).toEqual([basename(writing)]);
  });

  it("leaves no part file and no backup behind when the copy fails", () => {
    const file = legacyFile();
    // A database whose VACUUM INTO fails part way, as on a full disk.
    const failing = {
      isTransaction: false,
      prepare: () => ({
        run: () => {
          throw new Error("disk full");
        },
      }),
    } as unknown as Db;
    expect(() => backupDatabase(failing, file, "full")).toThrow(/disk full/);
    expect(backupsIn(join(dir, "backups"))).toEqual([]);
  });

  it("stores paths with quotes safely and refuses to run inside a transaction", () => {
    const src = legacyFile();
    const legacy = openDb(src);
    // A database path whose folder contains a quote: VACUUM INTO uses a bound parameter.
    const quoted = join(dir, "o'brien", "azm.sqlite");
    const out = backupDatabase(legacy, quoted, "Quote Test!");
    expect(out.startsWith(join(dir, "o'brien", "backups"))).toBe(true);
    expect(basename(out)).toMatch(/-quote-test\.sqlite$/);
    expect(dump(openDb(out))).toEqual(dump(legacy));
    legacy.exec("BEGIN");
    expect(() => backupDatabase(legacy, src, "tx")).toThrow(/transaction/);
    legacy.exec("ROLLBACK");
  });
});

describe("createApi on a legacy file", () => {
  it("migrates at startup and the legacy member still signs in", async () => {
    const file = legacyFile();
    const service = createApi(file);
    const server = createServer((req, res) => void service.handle(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    try {
      const login = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json", "X-Azm-Request": "1" },
        body: JSON.stringify({ email: "legacy@example.test", password: PASSWORD }),
      });
      expect(login.status).toBe(200);
      const data = await login.json();
      expect(data.plan).toMatchObject({ status: "ready", version: 3 });
      expect(await (await fetch(`${origin}/api/health`)).json()).toMatchObject({ ok: true, schema: LATEST });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      service.close();
    }
    expect(backupsIn(join(dir, "backups"))).toHaveLength(1);
    expect(mode(file)).toBe(0o600);
  });
});
