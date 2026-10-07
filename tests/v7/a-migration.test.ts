/**
 * Migration 005 (product v7 contract section 3): the focus check tables. New tables only, so a
 * schema 4 database with v1 rows in every table keeps every row and every table definition byte for
 * byte; 005 runs once through the runner; the CHECK, UNIQUE and cascade rules of the contract hold;
 * and the coach session row has no column for a transcript, audio, event text or tool arguments.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../server/db/migrate";
import { migrations } from "../../server/db/migrations";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type Db = InstanceType<typeof DatabaseSync>;

const V7_TABLES = ["agent_sessions", "focus_checks", "gait_analyses", "rom_measurements"];

let dir: string;
const opened: Db[] = [];
const openDb = (file: string) => {
  const db = new DatabaseSync(file);
  opened.push(db);
  return db;
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "azm-migration-005-"));
});
afterEach(() => {
  for (const db of opened.splice(0)) if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

const tables = (db: Db) =>
  (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((t) => t.name);
/** Every definition (tables, indexes) with its text, as SQLite keeps it. */
const schemaText = (db: Db) =>
  db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
    )
    .all();
/** Every row of every table, in rowid order, as SQLite returns it. */
const dumpAll = (db: Db, names: readonly string[]) =>
  Object.fromEntries(names.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const columns = (db: Db, t: string) =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

/** A schema 4 database with a v1 row in every table. */
function schema4(file: string): Db {
  const db = openDb(file);
  runMigrations(db, { dbPath: file, migrations: migrations.filter((m) => m.version <= 4) });
  db.exec(`
    INSERT INTO users VALUES('u1','a@example.test','A','x:y',1);
    INSERT INTO users VALUES('u2','b@example.test','B','x:y',2);
    INSERT INTO sessions VALUES('${"f".repeat(64)}','u1',9999999999999);
    INSERT INTO profiles VALUES('u1','{"mobility":"seated","age":58}','{"status":"ready"}',3);
    INSERT INTO workouts VALUES('w1','u1','{"exercises":[]}',3,0,2,1,5);
    INSERT INTO results VALUES('r1','u1','w1',0,'{"reps":{"valid":4}}');
    INSERT INTO assessments(id,user_id,kind,setting,status,series_meta,setup,protocol,precheck,device,started,completed,ended_reason,active,resumable)
      VALUES('a1','u1','baseline','home','completed','{"position":"chair"}','{}','[]','{}','{"model":"full"}',10,20,NULL,15,1);
    INSERT INTO assessment_results(id,assessment_id,user_id,test_id,side,value,unit,band,attempts,quality,detail,flags,n_valid,series_key,pose_model,movement_version,engine_version,created)
      VALUES('ar1','a1','u1','shoulder_abduction','left',92.5,'deg','default','[]','{}','{}','[]',3,'k','full',1,'e1',12);
    INSERT INTO check_locks(user_id,until,releasable_by_clearance) VALUES('u2',500,1);
    INSERT INTO consents VALUES('c1','u1','movement_check',1,5,NULL);
    INSERT INTO safety_events(day,reason,test_id,setting,count) VALUES('2026-10-04','stop:tired','none','home',2);
    INSERT INTO check_state(user_id,change_reported,change_cleared,lasting_resolved,faint_reported) VALUES('u1','2026-10-01',NULL,NULL,NULL);
    INSERT INTO product_counts(day,metric,key,setting,count) VALUES('2026-10-04','checks_started','','home',4);
    INSERT INTO adult_confirmations VALUES('u1',1);
    INSERT INTO booth_passes VALUES('${"a".repeat(64)}','staff',999,0);`);
  return db;
}

/** One focus check row of u1 (the columns of section 3, nothing else). */
const focusCheck = (id = "f1", over: Record<string, string> = {}) => {
  const v = {
    kind: "'baseline'",
    setting: "'booth'",
    status: "'open'",
    ended_reason: "NULL",
    ...over,
  };
  return `INSERT INTO focus_checks(id,user_id,kind,setting,status,protocol,gait_plan,today,precheck,versions,device,intake_version,started,active,completed,ended_reason)
    VALUES('${id}','u1',${v.kind},${v.setting},${v.status},'{}',NULL,'{}','{}','{}','{}',1,100,100,NULL,${v.ended_reason})`;
};
const romRow = (id: string, over: Record<string, string> = {}) => {
  const v = {
    check: "'f1'",
    movement: "'knee_flexion'",
    side: "'left'",
    source: "'measured'",
    unit: "'deg'",
    pain: "0",
    pain_level: "NULL",
    pose_model: "'full'",
    grade: "'mild'",
    cause: "NULL",
    ...over,
  };
  return `INSERT INTO rom_measurements(id,user_id,check_id,movement_id,side,position,value,unit,source,reason,pain,pain_level,pain_before,cause,percent_normal,finding,grade_ignoring_pain,norm,median,n_valid,attempts,flags,quality,pose_model,movement_version,norms_version,engine_version,created)
    VALUES('${id}','u1',${v.check},${v.movement},${v.side},'lying_back',120,${v.unit},${v.source},NULL,${v.pain},${v.pain_level},NULL,${v.cause},85,'mild',${v.grade},NULL,118,3,'[]','[]','{}',${v.pose_model},1,'rom_norms_0.2.1','rom_engine_1',101)`;
};
const gaitRow = (id: string, check = "'f1'") =>
  `INSERT INTO gait_analyses(id,user_id,check_id,mode,views,setup,metrics,findings,quality,replay,pose_model,rules_version,engine_version,created)
    VALUES('${id}','u1',${check},'overground','[]','{}','{}','{}','{}',NULL,'full','gait_rules_0.2.1','gait_engine_1',102)`;
const agentRow = (id: string, segment = "rom:seated:1", ref = "f1") =>
  `INSERT INTO agent_sessions(id,user_id,block,segment,ref,day,device,model,instruction_version,minutes_reserved,minted)
    VALUES('${id}','u1','rom','${segment}','${ref}','2026-10-04','${"d".repeat(64)}','gemini-3.8-live','coach_si_1',4,103)`;

describe("migration 005 (focus check tables)", () => {
  it("is registered as version 5, named v7, after 004", () => {
    expect(migrations.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6]);
    const m = migrations[4];
    expect(m).toMatchObject({ version: 5, name: "v7" });
    // New tables only: no existing table is altered, dropped or rewritten.
    expect(m.sql).not.toMatch(/\b(ALTER|DROP)\s+TABLE|\bUPDATE\s+\w+\s+SET|\bDELETE\s+FROM|\bINSERT\s+INTO/i);
    expect(m.sql.match(/CREATE TABLE (\w+)/g)).toEqual(
      V7_TABLES.map((t) => `CREATE TABLE ${t}`).sort((a, b) => m.sql.indexOf(a) - m.sql.indexOf(b)),
    );
  });

  it("applies to a schema 4 database with v1 rows and leaves every row and definition byte identical", () => {
    const file = join(dir, "four.sqlite");
    const db = schema4(file);
    const before = tables(db);
    const rows = dumpAll(
      db,
      before.filter((t) => t !== "schema_migrations"),
    );
    const text = schemaText(db);
    // Migration 005 alone (006 has its own test, tests/v7/e-check-first.test.ts).
    const upTo5 = migrations.filter((m) => m.version <= 5);
    const out = runMigrations(db, { dbPath: file, migrations: upTo5 });
    expect(out.applied).toEqual([5]);
    expect(out.schema).toBe(5);
    expect(out.backup).not.toBeNull();
    expect(tables(db)).toEqual([...before, ...V7_TABLES].sort());
    expect(dumpAll(db, Object.keys(rows))).toEqual(rows);
    // Every definition of schema 4 is unchanged; only the four tables and their indexes are new.
    const after = schemaText(db) as { name: string; tbl_name: string }[];
    expect(after.filter((x) => !V7_TABLES.includes(x.tbl_name))).toEqual(text);
    expect(after.filter((x) => V7_TABLES.includes(x.tbl_name)).map((x) => x.name)).toEqual([
      "agent_sessions",
      "agent_sessions_day",
      "agent_sessions_user_day",
      "focus_checks",
      "focus_checks_user",
      "gait_analyses",
      "gait_analyses_user",
      "rom_measurements",
      "rom_measurements_user",
    ]);
    for (const t of V7_TABLES)
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n).toBe(0);
    // The upgraded file has the same schema text as a fresh one.
    const fresh = join(dir, "fresh.sqlite");
    runMigrations(openDb(fresh), { dbPath: fresh, migrations: upTo5 });
    expect(schemaText(openDb(fresh))).toEqual(schemaText(db));
  });

  it("is applied once through the runner", () => {
    const file = join(dir, "once.sqlite");
    const db = schema4(file);
    const upTo5 = migrations.filter((m) => m.version <= 5);
    expect(runMigrations(db, { dbPath: file, migrations: upTo5 }).applied).toEqual([5]);
    expect(runMigrations(db, { dbPath: file, migrations: upTo5 })).toEqual({
      applied: [],
      backup: null,
      schema: 5,
    });
    expect(runMigrations(db, { dbPath: file, migrations: upTo5 })).toEqual({
      applied: [],
      backup: null,
      schema: 5,
    });
    expect(db.prepare("SELECT version, name FROM schema_migrations WHERE version=5").all()).toEqual([
      { version: 5, name: "v7" },
    ]);
  });

  it("holds the contract's columns, checks, unique keys and cascades", () => {
    const db = openDb(":memory:");
    runMigrations(db, { dbPath: ":memory:" });
    db.exec("INSERT INTO users VALUES('u1','a@example.test','A','x:y',1)");
    expect(columns(db, "focus_checks")).toEqual([
      "id",
      "user_id",
      "kind",
      "setting",
      "status",
      "protocol",
      "gait_plan",
      "today",
      "precheck",
      "versions",
      "device",
      "intake_version",
      "started",
      "active",
      "completed",
      "ended_reason",
    ]);
    // No transcript, audio, event text or tool arguments: counts and times only (section 3).
    expect(columns(db, "agent_sessions")).toEqual([
      "id",
      "user_id",
      "block",
      "segment",
      "ref",
      "remints",
      "day",
      "device",
      "model",
      "instruction_version",
      "minutes_reserved",
      "minutes_used",
      "connect_ms",
      "turns",
      "tool_calls",
      "prompt_tokens",
      "response_tokens",
      "end_reason",
      "minted",
      "reported",
    ]);

    db.exec(focusCheck());
    expect(db.prepare("SELECT status FROM focus_checks WHERE id='f1'").get()).toEqual({ status: "open" });
    expect(() => db.exec(focusCheck("f2", { kind: "'first'" }))).toThrow(/CHECK/);
    expect(() => db.exec(focusCheck("f3", { setting: "'clinic'" }))).toThrow(/CHECK/);
    expect(() => db.exec(focusCheck("f4", { status: "'done'" }))).toThrow(/CHECK/);
    expect(() => db.exec(focusCheck("f5", { ended_reason: "'pain'" }))).toThrow(/CHECK/);
    for (const reason of ["stop", "stale", "replaced", "all_skipped", "consent_revoked"])
      expect(() =>
        db.exec(focusCheck(`f_${reason}`, { status: "'abandoned'", ended_reason: `'${reason}'` })),
      ).not.toThrow();

    db.exec(romRow("m1"));
    expect(() => db.exec(romRow("m2"))).toThrow(/UNIQUE/);
    expect(() => db.exec(romRow("m3", { side: "'right'", unit: "'cm'" }))).toThrow(/CHECK/);
    expect(() => db.exec(romRow("m4", { side: "'right'", source: "'default'" }))).toThrow(/CHECK/);
    expect(() => db.exec(romRow("m5", { side: "'right'", pain: "2" }))).toThrow(/CHECK/);
    expect(() => db.exec(romRow("m6", { side: "'right'", pain_level: "11" }))).toThrow(/CHECK/);
    expect(() => db.exec(romRow("m7", { side: "'right'", pose_model: "'heavy'" }))).toThrow(/CHECK/);
    expect(() => db.exec(romRow("m8", { side: "'right'", grade: "'severe'" }))).toThrow(/CHECK/);
    expect(() => db.exec(romRow("m9", { side: "'right'", cause: "'stiff'" }))).toThrow(/CHECK/);
    expect(() => db.exec(romRow("m10", { side: "'up'" }))).toThrow(/CHECK/);
    expect(() => db.exec(romRow("m11", { side: "'right'", check: "'missing'" }))).toThrow(/FOREIGN KEY/);
    // A not measured row: no value, no pose model, no grade.
    expect(() =>
      db.exec(
        romRow("m12", {
          movement: "'wrist_flexion'",
          side: "'right'",
          source: "'not_measured_camera'",
          pose_model: "NULL",
          grade: "NULL",
        }),
      ),
    ).not.toThrow();

    db.exec(gaitRow("g1"));
    // A gait analysis outside a check is allowed (check_id may be NULL).
    db.exec(gaitRow("g2", "NULL"));
    expect(() => db.exec(gaitRow("g3").replace("'overground'", "'treadmill'"))).toThrow(/CHECK/);

    db.exec(agentRow("s1"));
    expect(() => db.exec(agentRow("s2"))).toThrow(/UNIQUE/);
    db.exec(agentRow("s3", "rom:standing:1"));
    expect(() => db.exec(agentRow("s4").replace("'rom'", "'chat'"))).toThrow(/CHECK/);
    expect(
      db.prepare("SELECT remints, minutes_used, reported FROM agent_sessions WHERE id='s1'").get(),
    ).toEqual({
      remints: 0,
      minutes_used: null,
      reported: null,
    });

    // Deleting a check deletes its rows; gait analyses outside a check stay.
    db.exec("DELETE FROM focus_checks WHERE id='f1'");
    expect(db.prepare("SELECT COUNT(*) AS n FROM rom_measurements").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT id FROM gait_analyses").all()).toEqual([{ id: "g2" }]);
  });
});
